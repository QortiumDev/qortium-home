import { createHash, randomBytes } from 'node:crypto';
import { lstat, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { CoreNetworkId } from './core-network-descriptor.js';

const LOCK_PAYLOAD_VERSION = 1 as const;
const MAX_LOCK_PAYLOAD_BYTES = 4_096;
const MAX_ACQUISITION_RACE_RETRIES = 3;

type LockFileStat = {
  dev: number;
  ino: number;
  mode: number;
  size: number;
  uid: number;
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
};

type LockFileHandle = {
  close: () => Promise<void>;
  read: (
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ) => Promise<{ bytesRead: number }>;
  stat: () => Promise<LockFileStat>;
  sync: () => Promise<void>;
  writeFile: (contents: string, options: { encoding: BufferEncoding }) => Promise<void>;
};

export type CoreOperationLockPidState = 'alive' | 'dead' | 'unknown';

export type CoreOperationLockOperations = {
  getPid: () => number;
  getUid: () => number | undefined;
  kill: (pid: number, signal: 0) => void;
  lstat: (targetPath: string) => Promise<LockFileStat>;
  now: () => Date;
  open: (targetPath: string, flags: string, mode?: number) => Promise<LockFileHandle>;
  probePid: (pid: number) => Promise<CoreOperationLockPidState>;
  randomBytes: (size: number) => Buffer;
  realpath: (targetPath: string) => Promise<string>;
  unlink: (targetPath: string) => Promise<void>;
};

export type CoreOperationLockRequest = {
  lockRoot: string;
  networkId: CoreNetworkId;
  op: string;
  targetPath: string;
};

export type CoreOperationLockIdentity = {
  canonicalTarget: string;
  key: string;
  lockPath: string;
};

export type CoreOperationLockContext = CoreOperationLockIdentity & {
  ownerToken: string;
};

export type CoreOperationLockOptions = {
  operations?: Partial<CoreOperationLockOperations>;
  platform?: NodeJS.Platform;
};

type CoreOperationLockPayload = {
  network: CoreNetworkId;
  op: string;
  pid: number;
  start: string;
  target: string;
  token: string;
  version: typeof LOCK_PAYLOAD_VERSION;
};

type LockSnapshot = {
  identity: { dev: number; ino: number };
  payload: CoreOperationLockPayload;
};

export class CoreOperationLockContentionError extends Error {
  constructor(
    readonly lockPath: string,
    readonly owner: CoreOperationLockPayload,
  ) {
    super(`Core operation target is locked by PID ${owner.pid} for ${owner.op}.`);
    this.name = 'CoreOperationLockContentionError';
  }
}

export class CoreOperationLockIntegrityError extends Error {
  constructor(message: string, readonly lockPath: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CoreOperationLockIntegrityError';
  }
}

export class CoreOperationLockReleaseError extends Error {
  readonly operationCompleted = true;

  constructor(readonly lockPath: string, cause: unknown) {
    super('The Core operation completed, but its filesystem lock could not be released.', { cause });
    this.name = 'CoreOperationLockReleaseError';
  }
}

export class CoreOperationLockCreationError extends AggregateError {
  readonly evidenceRetained = true;

  constructor(
    errors: readonly unknown[],
    readonly lockPath: string,
  ) {
    super(errors, `Core operation lock creation failed; evidence remains at ${lockPath}.`);
    this.name = 'CoreOperationLockCreationError';
  }
}

export class CoreOperationLockStaleError extends Error {
  readonly retained = true;

  constructor(
    readonly lockPath: string,
    readonly owner: CoreOperationLockPayload,
  ) {
    super(
      `Core operation lock belongs to dead PID ${owner.pid}; it was retained for explicit recovery.`,
    );
    this.name = 'CoreOperationLockStaleError';
  }
}

function getErrorCode(error: unknown) {
  return error instanceof Error && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

export function probeCoreOperationLockPid(
  pid: number,
  kill: (pid: number, signal: 0) => void = process.kill,
): CoreOperationLockPidState {
  try {
    kill(pid, 0);
    return 'alive';
  } catch (error) {
    const code = getErrorCode(error);
    if (code === 'EPERM') return 'alive';
    if (code === 'ESRCH') return 'dead';
    return 'unknown';
  }
}

const DEFAULT_OPERATIONS: CoreOperationLockOperations = {
  getPid: () => process.pid,
  getUid: () => process.getuid?.(),
  kill: process.kill,
  lstat: lstat as CoreOperationLockOperations['lstat'],
  now: () => new Date(),
  open: open as unknown as CoreOperationLockOperations['open'],
  probePid: async (pid) => probeCoreOperationLockPid(pid),
  randomBytes,
  realpath,
  unlink,
};

function normalizeCanonicalPath(targetPath: string, platform: NodeJS.Platform) {
  return platform === 'win32' ? targetPath.toLowerCase() : targetPath;
}

function sameFileIdentity(
  left: { dev: number; ino: number },
  right: { dev: number; ino: number },
) {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertOwnedMode(
  stats: Pick<LockFileStat, 'mode' | 'uid'>,
  targetPath: string,
  operations: CoreOperationLockOperations,
  platform: NodeJS.Platform,
) {
  if (platform === 'win32') return;

  if ((stats.mode & 0o777) !== 0o600) {
    throw new CoreOperationLockIntegrityError(
      'Core operation lock permissions are not exactly 0600.',
      targetPath,
    );
  }

  const uid = operations.getUid();
  if (uid !== undefined && stats.uid !== uid) {
    throw new CoreOperationLockIntegrityError(
      'Core operation lock is not owned by the current user.',
      targetPath,
    );
  }
}

async function validateLockRoot(
  lockRoot: string,
  operations: CoreOperationLockOperations,
  platform: NodeJS.Platform,
) {
  const resolvedRoot = path.resolve(lockRoot);
  let stats: LockFileStat;

  try {
    stats = await operations.lstat(resolvedRoot);
  } catch (error) {
    throw new CoreOperationLockIntegrityError(
      'Core operation lock root does not exist or cannot be inspected.',
      resolvedRoot,
      { cause: error },
    );
  }

  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new CoreOperationLockIntegrityError(
      'Core operation lock root must be a real directory, not a symlink.',
      resolvedRoot,
    );
  }

  const canonicalRoot = await operations.realpath(resolvedRoot).catch((error) => {
    throw new CoreOperationLockIntegrityError(
      'Core operation lock root cannot be canonicalized.',
      resolvedRoot,
      { cause: error },
    );
  });

  if (
    normalizeCanonicalPath(canonicalRoot, platform) !==
    normalizeCanonicalPath(resolvedRoot, platform)
  ) {
    throw new CoreOperationLockIntegrityError(
      'Core operation lock root must not traverse a symlink.',
      resolvedRoot,
    );
  }

  if (platform !== 'win32') {
    const uid = operations.getUid();
    if (uid !== undefined && stats.uid !== uid) {
      throw new CoreOperationLockIntegrityError(
        'Core operation lock root is not owned by the current user.',
        resolvedRoot,
      );
    }
    if ((stats.mode & 0o022) !== 0) {
      throw new CoreOperationLockIntegrityError(
        'Core operation lock root must not be writable by group or other users.',
        resolvedRoot,
      );
    }
  }

  return canonicalRoot;
}

async function canonicalizeTarget(
  targetPath: string,
  operations: CoreOperationLockOperations,
  platform: NodeJS.Platform,
) {
  const resolvedTarget = path.resolve(targetPath);

  try {
    const stats = await operations.lstat(resolvedTarget);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new CoreOperationLockIntegrityError(
        'Core operation target must be a regular file or an absent file in a real directory.',
        resolvedTarget,
      );
    }
    const canonicalTarget = await operations.realpath(resolvedTarget);
    const canonicalStats = await operations.lstat(canonicalTarget).catch((error) => {
      throw new CoreOperationLockIntegrityError(
        'The canonical Core operation target cannot be inspected.',
        resolvedTarget,
        { cause: error },
      );
    });

    if (
      canonicalStats.isSymbolicLink() ||
      !canonicalStats.isFile() ||
      !sameFileIdentity(stats, canonicalStats)
    ) {
      throw new CoreOperationLockIntegrityError(
        'The Core operation target changed while it was being canonicalized.',
        resolvedTarget,
      );
    }

    return normalizeCanonicalPath(canonicalTarget, platform);
  } catch (error) {
    if (error instanceof CoreOperationLockIntegrityError) throw error;
    if (getErrorCode(error) !== 'ENOENT') {
      throw new CoreOperationLockIntegrityError(
        'Core operation target cannot be inspected.',
        resolvedTarget,
        { cause: error },
      );
    }
  }

  const parentPath = path.dirname(resolvedTarget);
  const basename = path.basename(resolvedTarget);
  let parentStats: LockFileStat;

  try {
    parentStats = await operations.lstat(parentPath);
  } catch (error) {
    throw new CoreOperationLockIntegrityError(
      'The parent directory for the Core operation target does not exist.',
      resolvedTarget,
      { cause: error },
    );
  }

  if (!parentStats.isDirectory() && !parentStats.isSymbolicLink()) {
    throw new CoreOperationLockIntegrityError(
      'The parent of the Core operation target is not a directory.',
      resolvedTarget,
    );
  }

  const canonicalParent = await operations.realpath(parentPath).catch((error) => {
    throw new CoreOperationLockIntegrityError(
      'The parent directory for the Core operation target cannot be canonicalized.',
      resolvedTarget,
      { cause: error },
    );
  });
  const canonicalParentStats = await operations.lstat(canonicalParent).catch((error) => {
    throw new CoreOperationLockIntegrityError(
      'The canonical parent directory for the Core operation target cannot be inspected.',
      resolvedTarget,
      { cause: error },
    );
  });

  if (canonicalParentStats.isSymbolicLink() || !canonicalParentStats.isDirectory()) {
    throw new CoreOperationLockIntegrityError(
      'The canonical parent of the Core operation target is not a real directory.',
      resolvedTarget,
    );
  }

  return normalizeCanonicalPath(path.join(canonicalParent, basename), platform);
}

function createOperations(overrides?: Partial<CoreOperationLockOperations>) {
  const operations = { ...DEFAULT_OPERATIONS, ...overrides };

  // An injected kill seam should automatically drive the default tri-state
  // probe unless the caller supplied a complete probe of its own.
  if (overrides?.kill && !overrides.probePid) {
    operations.probePid = async (pid) => probeCoreOperationLockPid(pid, operations.kill);
  }

  return operations;
}

export async function resolveCoreOperationLockIdentity(
  request: CoreOperationLockRequest,
  options: CoreOperationLockOptions = {},
): Promise<CoreOperationLockIdentity> {
  const platform = options.platform ?? process.platform;
  const operations = createOperations(options.operations);
  const lockRoot = await validateLockRoot(request.lockRoot, operations, platform);
  const canonicalTarget = await canonicalizeTarget(request.targetPath, operations, platform);
  const key = createHash('sha256')
    .update(request.networkId)
    .update('\0')
    .update(canonicalTarget)
    .digest('hex');

  return {
    canonicalTarget,
    key,
    lockPath: path.join(lockRoot, `${key}.lock`),
  };
}

function parsePayload(
  raw: string,
  identity: CoreOperationLockIdentity,
  request: CoreOperationLockRequest,
): CoreOperationLockPayload {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new CoreOperationLockIntegrityError(
      'Core operation lock payload is malformed.',
      identity.lockPath,
      { cause: error },
    );
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CoreOperationLockIntegrityError(
      'Core operation lock payload is not an object.',
      identity.lockPath,
    );
  }

  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload).sort();
  const expectedKeys = ['network', 'op', 'pid', 'start', 'target', 'token', 'version'];
  const exactShape =
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]);
  const parsedStart = typeof payload.start === 'string' ? Date.parse(payload.start) : Number.NaN;

  if (
    !exactShape ||
    payload.version !== LOCK_PAYLOAD_VERSION ||
    payload.network !== request.networkId ||
    typeof payload.op !== 'string' ||
    payload.op.length < 1 ||
    payload.op.length > 128 ||
    !Number.isInteger(payload.pid) ||
    (payload.pid as number) <= 0 ||
    typeof payload.start !== 'string' ||
    !Number.isFinite(parsedStart) ||
    new Date(parsedStart).toISOString() !== payload.start ||
    typeof payload.target !== 'string' ||
    payload.target !== identity.canonicalTarget ||
    typeof payload.token !== 'string' ||
    !/^[0-9a-f]{64}$/.test(payload.token)
  ) {
    throw new CoreOperationLockIntegrityError(
      'Core operation lock payload does not exactly match this target.',
      identity.lockPath,
    );
  }

  return payload as CoreOperationLockPayload;
}

async function readExactly(handle: LockFileHandle, size: number) {
  const buffer = Buffer.alloc(size);
  let offset = 0;

  while (offset < size) {
    const { bytesRead } = await handle.read(buffer, offset, size - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }

  if (offset !== size) {
    throw new Error('Core operation lock changed while it was being read.');
  }

  return buffer.toString('utf8');
}

async function readLockSnapshot(
  identity: CoreOperationLockIdentity,
  request: CoreOperationLockRequest,
  operations: CoreOperationLockOperations,
  platform: NodeJS.Platform,
) {
  let pathStats: LockFileStat;

  try {
    pathStats = await operations.lstat(identity.lockPath);
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return null;
    throw new CoreOperationLockIntegrityError(
      'Core operation lock cannot be inspected.',
      identity.lockPath,
      { cause: error },
    );
  }

  if (pathStats.isSymbolicLink() || !pathStats.isFile()) {
    throw new CoreOperationLockIntegrityError(
      'Core operation lock must be a regular file, not a symlink.',
      identity.lockPath,
    );
  }

  let handle: LockFileHandle;
  try {
    handle = await operations.open(identity.lockPath, 'r');
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return null;
    throw new CoreOperationLockIntegrityError(
      'Core operation lock cannot be opened safely.',
      identity.lockPath,
      { cause: error },
    );
  }

  try {
    const handleStats = await handle.stat();
    if (!handleStats.isFile() || !sameFileIdentity(pathStats, handleStats)) {
      throw new CoreOperationLockIntegrityError(
        'Core operation lock changed while it was being opened.',
        identity.lockPath,
      );
    }
    assertOwnedMode(handleStats, identity.lockPath, operations, platform);

    if (handleStats.size < 1 || handleStats.size > MAX_LOCK_PAYLOAD_BYTES) {
      throw new CoreOperationLockIntegrityError(
        'Core operation lock payload exceeds its allowed size.',
        identity.lockPath,
      );
    }

    const payload = parsePayload(
      await readExactly(handle, handleStats.size),
      identity,
      request,
    );
    return {
      identity: { dev: handleStats.dev, ino: handleStats.ino },
      payload,
    } satisfies LockSnapshot;
  } finally {
    await handle.close();
  }
}

async function removeMatchingSnapshot(
  expected: LockSnapshot,
  identity: CoreOperationLockIdentity,
  request: CoreOperationLockRequest,
  operations: CoreOperationLockOperations,
  platform: NodeJS.Platform,
) {
  const current = await readLockSnapshot(identity, request, operations, platform);

  if (
    !current ||
    !sameFileIdentity(current.identity, expected.identity) ||
    current.payload.token !== expected.payload.token
  ) {
    throw new CoreOperationLockIntegrityError(
      'Core operation lock ownership changed before removal.',
      identity.lockPath,
    );
  }

  // Node does not expose a conditional unlink-by-inode primitive. The exact
  // snapshot check and immediate unlink are therefore bounded by the required
  // current-user-owned, non-group-writable lock root. Callers must still
  // revalidate their Core target while holding this lease before committing.
  await operations.unlink(identity.lockPath);
}

async function writeNewLock(
  request: CoreOperationLockRequest,
  identity: CoreOperationLockIdentity,
  operations: CoreOperationLockOperations,
  platform: NodeJS.Platform,
) {
  const token = operations.randomBytes(32).toString('hex');
  if (!/^[0-9a-f]{64}$/.test(token)) {
    throw new Error('Core operation lock random source returned an invalid token.');
  }

  const payload: CoreOperationLockPayload = {
    network: request.networkId,
    op: request.op,
    pid: operations.getPid(),
    start: operations.now().toISOString(),
    target: identity.canonicalTarget,
    token,
    version: LOCK_PAYLOAD_VERSION,
  };
  if (!Number.isInteger(payload.pid) || payload.pid <= 0) {
    throw new Error('Core operation lock process source returned an invalid PID.');
  }
  const serialized = `${JSON.stringify(payload)}\n`;
  if (Buffer.byteLength(serialized) > MAX_LOCK_PAYLOAD_BYTES) {
    throw new Error('Core operation lock payload is too large.');
  }

  let handle: LockFileHandle;
  try {
    handle = await operations.open(identity.lockPath, 'wx', 0o600);
  } catch (error) {
    if (getErrorCode(error) === 'EEXIST') return null;
    throw error;
  }

  let createdIdentity: { dev: number; ino: number } | null = null;
  let creationFailed = false;
  let creationError: unknown;
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new CoreOperationLockIntegrityError(
        'New Core operation lock is not a regular file.',
        identity.lockPath,
      );
    }
    assertOwnedMode(stats, identity.lockPath, operations, platform);
    createdIdentity = { dev: stats.dev, ino: stats.ino };
    await handle.writeFile(serialized, { encoding: 'utf8' });
    await handle.sync();
  } catch (error) {
    creationFailed = true;
    creationError = error;
  }

  try {
    await handle.close();
  } catch (error) {
    if (creationFailed) {
      creationError = new AggregateError(
        [creationError, error],
        'Creating and closing the Core operation lock both failed.',
      );
    } else {
      creationFailed = true;
      creationError = error;
    }
  }

  if (creationFailed) {
    const cleanupErrors: unknown[] = [];
    let evidenceRetained = true;
    if (createdIdentity) {
      try {
        const currentStats = await operations.lstat(identity.lockPath);
        if (sameFileIdentity(currentStats, createdIdentity)) {
          try {
            await operations.unlink(identity.lockPath);
            evidenceRetained = false;
          } catch (error) {
            cleanupErrors.push(error);
          }
        } else {
          cleanupErrors.push(
            new CoreOperationLockIntegrityError(
              'Core operation lock ownership changed during failed-creation cleanup.',
              identity.lockPath,
            ),
          );
        }
      } catch (error) {
        if (getErrorCode(error) === 'ENOENT') {
          evidenceRetained = false;
        } else {
          cleanupErrors.push(error);
        }
      }
    }

    if (evidenceRetained || cleanupErrors.length > 0) {
      throw new CoreOperationLockCreationError(
        [creationError, ...cleanupErrors],
        identity.lockPath,
      );
    }
    throw creationError;
  }

  return {
    identity: createdIdentity!,
    payload,
  } satisfies LockSnapshot;
}

function validateRequest(request: CoreOperationLockRequest) {
  if (
    typeof request.op !== 'string' ||
    request.op.length < 1 ||
    request.op.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(request.op)
  ) {
    throw new Error('Core operation name must contain between 1 and 128 characters.');
  }
}

export async function withCoreOperationLock<T>(
  request: CoreOperationLockRequest,
  operation: (context: CoreOperationLockContext) => Promise<T>,
  options: CoreOperationLockOptions = {},
): Promise<T> {
  const platform = options.platform ?? process.platform;
  validateRequest(request);
  const operations = createOperations(options.operations);
  const identity = await resolveCoreOperationLockIdentity(request, {
    ...options,
    operations,
  });
  let owned: LockSnapshot | null = null;

  for (let attempt = 0; attempt <= MAX_ACQUISITION_RACE_RETRIES; attempt += 1) {
    owned = await writeNewLock(request, identity, operations, platform);
    if (owned) break;

    const existing = await readLockSnapshot(identity, request, operations, platform);
    if (!existing) continue;

    const pidState = await operations.probePid(existing.payload.pid).catch(
      (): CoreOperationLockPidState => 'unknown',
    );
    if (pidState === 'alive') {
      throw new CoreOperationLockContentionError(identity.lockPath, existing.payload);
    }
    if (pidState !== 'dead') {
      throw new CoreOperationLockIntegrityError(
        'Core operation lock owner liveness cannot be proven.',
        identity.lockPath,
      );
    }

    // Node has no atomic conditional unlink that can remove a pathname only if
    // it still names this inode/token. Automatic reaping can therefore delete
    // a replacement lock acquired by another legitimate Home process. Retain
    // proven-dead locks and require an explicit recovery flow while all Home
    // contenders are stopped.
    throw new CoreOperationLockStaleError(identity.lockPath, existing.payload);
  }

  if (!owned) {
    throw new CoreOperationLockIntegrityError(
      'Core operation lock could not be acquired after bounded acquisition races.',
      identity.lockPath,
    );
  }

  let result: T | undefined;
  let operationFailed = false;
  let operationError: unknown;
  try {
    result = await operation({
      ...identity,
      ownerToken: owned.payload.token,
    });
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  let releaseFailed = false;
  let releaseError: unknown;
  try {
    await removeMatchingSnapshot(owned, identity, request, operations, platform);
  } catch (error) {
    releaseFailed = true;
    releaseError = error;
  }

  if (operationFailed) {
    if (releaseFailed) {
      throw new AggregateError(
        [operationError, releaseError],
        'The Core operation and its lock release both failed.',
      );
    }
    throw operationError;
  }

  if (releaseFailed) {
    throw new CoreOperationLockReleaseError(identity.lockPath, releaseError);
  }

  return result as T;
}
