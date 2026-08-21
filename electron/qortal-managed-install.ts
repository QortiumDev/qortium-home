import { randomBytes } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import type { CoreJarIdentity } from './core-jar-identity.js';
import type { CoreJarInstallTransactionContext } from './core-jar-install-transaction.js';
import {
  readCoreJarTargetState,
  type CoreJarTargetState,
} from './core-jar-target-state.js';
import {
  getCoreApiKeyPath,
  getCoreSettingsPath,
  QORTAL_CORE_DESCRIPTOR,
  resolveCoreDescriptorPaths,
  type CoreDescriptorPathContext,
} from './core-network-descriptor.js';
import {
  matchesQortalJarReleaseIdentity,
  type QortalJarRelease,
} from './qortal-release-policy.js';

const SETTINGS_CONTENTS = '{}\n';
const PRIVATE_FILE_MODE = 0o600;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_RELEASE_TAG = /^v[a-z0-9._-]+$/i;

type ManagedPathStat = {
  dev: number;
  ino: number;
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
  mode: number;
  uid: number;
};

type ManagedFileHandle = {
  close: () => Promise<void>;
  stat: () => Promise<ManagedPathStat>;
  sync: () => Promise<void>;
  write: (contents: string | Uint8Array) => Promise<void>;
};

export type QortalManagedInstallOperations = {
  getUid: () => number | undefined;
  lstat: (targetPath: string) => Promise<ManagedPathStat>;
  mkdir: (targetPath: string, options: { mode: number; recursive: true }) => Promise<unknown>;
  now: () => Date;
  openExclusive: (targetPath: string, mode: number) => Promise<ManagedFileHandle>;
  randomBytes: (size: number) => Uint8Array;
  readFile: (targetPath: string) => Promise<Buffer>;
  readTargetState: (targetPath: string) => Promise<CoreJarTargetState>;
  realpath: (targetPath: string) => Promise<string>;
  rename: (sourcePath: string, destinationPath: string) => Promise<void>;
  syncDirectory: (targetPath: string) => Promise<void>;
  unlink: (targetPath: string) => Promise<void>;
};

const DEFAULT_OPERATIONS: QortalManagedInstallOperations = {
  getUid: () => process.getuid?.(),
  lstat,
  mkdir,
  now: () => new Date(),
  openExclusive: async (targetPath, mode) => {
    const handle = await open(targetPath, 'wx', mode);

    return {
      close: () => handle.close(),
      stat: () => handle.stat(),
      sync: () => handle.sync(),
      write: async (contents) => {
        await handle.writeFile(contents);
      },
    };
  },
  randomBytes,
  readFile,
  readTargetState: readCoreJarTargetState,
  realpath,
  rename,
  syncDirectory: async (targetPath) => {
    if (process.platform === 'win32') return;
    const handle = await open(targetPath, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  unlink,
};

export type QortalManagedInstallPaths = {
  apiKeyPath: string;
  backupJarPath: string;
  basePath: string;
  candidateJarPath: string;
  currentMetadataPath: string;
  installPath: string;
  jarPath: string;
  runtimePath: string;
  settingsPath: string;
};

export type QortalManagedInstallRecordV1 = {
  installPath: string;
  installedAt: string;
  jarIdentity: CoreJarIdentity;
  jarPath: string;
  networkId: 'qortal';
  release: QortalJarRelease;
  settingsPath: string;
  source: 'home-managed';
  version: 1;
};

export type QortalManagedInstallKind = CoreJarInstallTransactionContext['kind'];

export type PrepareQortalManagedInstallInput = {
  identity: CoreJarIdentity;
  kind: QortalManagedInstallKind;
  paths: QortalManagedInstallPaths;
  release: QortalJarRelease;
};

export type QortalManagedInstallCallbacks = {
  afterRollback: (context: CoreJarInstallTransactionContext) => Promise<void>;
  afterSwap: (context: CoreJarInstallTransactionContext) => Promise<void>;
  record: QortalManagedInstallRecordV1;
};

type MetadataSnapshot = {
  bytes: Buffer;
  mode: number;
};

function getErrorCode(error: unknown) {
  return error instanceof Error && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

async function inspectPath(
  targetPath: string,
  operations: QortalManagedInstallOperations,
) {
  try {
    const stats = await operations.lstat(targetPath);
    return { kind: stats.isFile() ? 'file' : 'other', stats } as const;
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') {
      return { kind: 'missing', stats: null } as const;
    }

    throw error;
  }
}

function encodeBase58(bytes: Uint8Array) {
  if (bytes.length === 0) return '';

  let zeroCount = 0;

  while (zeroCount < bytes.length && bytes[zeroCount] === 0) {
    zeroCount += 1;
  }

  if (zeroCount === bytes.length) return '1'.repeat(zeroCount);

  const digits = [0];

  for (const byte of bytes.subarray(zeroCount)) {
    let carry = byte;

    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }

    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  return `${'1'.repeat(zeroCount)}${digits
    .reverse()
    .map((digit) => BASE58_ALPHABET[digit])
    .join('')}`;
}

function createApiKey(operations: QortalManagedInstallOperations) {
  const entropy = operations.randomBytes(16);

  if (entropy.byteLength !== 16) {
    throw new Error('Qortal API-key entropy must contain exactly 16 bytes.');
  }

  return encodeBase58(entropy);
}

async function createExclusiveFile(
  targetPath: string,
  contents: string | Uint8Array,
  mode: number,
  operations: QortalManagedInstallOperations,
  afterCreate: () => void,
) {
  const handle = await operations.openExclusive(targetPath, mode);
  afterCreate();
  const errors: unknown[] = [];

  try {
    await handle.write(contents);
    await handle.sync();
    const stats = await handle.stat();
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      (process.platform !== 'win32' &&
        ((stats.mode & 0o777) !== mode ||
          (operations.getUid() !== undefined && stats.uid !== operations.getUid())))
    ) {
      throw new Error(`The created Qortal file is not a private regular file: ${targetPath}.`);
    }
  } catch (error) {
    errors.push(error);
  }

  try {
    await handle.close();
  } catch (error) {
    errors.push(error);
  }

  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, `Unable to finish creating ${targetPath}.`);
  }
}

function assertManagedPathLayout(paths: QortalManagedInstallPaths) {
  const expected = resolveQortalManagedInstallPaths({
    appDataPath: path.dirname(paths.basePath),
    userDataPath: path.dirname(paths.basePath),
  });
  const pairs: Array<[string, string]> = [
    [paths.installPath, expected.installPath],
    [paths.runtimePath, expected.runtimePath],
    [paths.jarPath, expected.jarPath],
    [paths.settingsPath, expected.settingsPath],
    [paths.apiKeyPath, expected.apiKeyPath],
    [paths.currentMetadataPath, expected.currentMetadataPath],
    [paths.candidateJarPath, expected.candidateJarPath],
    [paths.backupJarPath, expected.backupJarPath],
  ];

  if (pairs.some(([actual, wanted]) => path.resolve(actual) !== path.resolve(wanted))) {
    throw new Error('The Qortal managed-install paths do not match the descriptor layout.');
  }
}

async function readSecureDirectoryIdentity(
  directoryPath: string,
  operations: QortalManagedInstallOperations,
) {
  const stats = await operations.lstat(directoryPath);
  const canonicalPath = await operations.realpath(directoryPath);
  const uid = operations.getUid();
  const normalized = (value: string) =>
    process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

  if (
    normalized(canonicalPath) !== normalized(directoryPath) ||
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    (process.platform !== 'win32' &&
      ((stats.mode & 0o022) !== 0 || (uid !== undefined && stats.uid !== uid)))
  ) {
    throw new Error(`The Qortal managed-install directory is not private: ${directoryPath}.`);
  }

  return { dev: stats.dev, ino: stats.ino };
}

export class QortalManagedInstallAtomicWriteError extends AggregateError {
  readonly destinationPath: string;
  readonly temporaryPath: string;

  constructor(
    primaryError: unknown,
    cleanupError: unknown,
    destinationPath: string,
    temporaryPath: string,
  ) {
    super(
      [primaryError, cleanupError],
      `Unable to atomically write ${destinationPath}; evidence remains at ${temporaryPath}.`,
    );
    this.name = 'QortalManagedInstallAtomicWriteError';
    this.destinationPath = destinationPath;
    this.temporaryPath = temporaryPath;
  }
}

async function writeFileAtomically(
  destinationPath: string,
  contents: string | Uint8Array,
  mode: number,
  operations: QortalManagedInstallOperations,
) {
  const entropy = operations.randomBytes(12);

  if (entropy.byteLength !== 12) {
    throw new Error('Atomic Qortal metadata writes require exactly 12 random bytes.');
  }

  const token = Buffer.from(entropy).toString('hex');
  const temporaryPath = `${destinationPath}.qortium-home-${token}.tmp`;
  let temporaryCreated = false;

  try {
    await createExclusiveFile(
      temporaryPath,
      contents,
      mode,
      operations,
      () => { temporaryCreated = true; },
    );
    await operations.rename(temporaryPath, destinationPath);
    temporaryCreated = false;
    await operations.syncDirectory(path.dirname(destinationPath));
  } catch (error) {
    if (temporaryCreated) {
      try {
        await operations.unlink(temporaryPath);
      } catch (cleanupError) {
        if (getErrorCode(cleanupError) === 'ENOENT') throw error;
        throw new QortalManagedInstallAtomicWriteError(
          error,
          cleanupError,
          destinationPath,
          temporaryPath,
        );
      }
    }

    throw error;
  }
}

function readString(value: unknown) {
  return isNonEmptyString(value) ? value : '';
}

export function parseQortalManagedInstallRecord(
  value: unknown,
  paths?: QortalManagedInstallPaths,
): QortalManagedInstallRecordV1 | null {
  if (
    !isObject(value) ||
    value.version !== 1 ||
    value.networkId !== 'qortal' ||
    value.source !== 'home-managed' ||
    !isObject(value.release) ||
    !isObject(value.release.asset) ||
    !isObject(value.jarIdentity)
  ) {
    return null;
  }

  const release = value.release;
  const asset = release.asset as Record<string, unknown>;
  const jarIdentity = value.jarIdentity;
  const assetName = asset.name;

  if (assetName !== 'qortal.jar') {
    return null;
  }

  const record: QortalManagedInstallRecordV1 = {
    installPath: readString(value.installPath),
    installedAt: readString(value.installedAt),
    jarIdentity: {
      buildTimestamp: typeof jarIdentity.buildTimestamp === 'string' ? jarIdentity.buildTimestamp : '',
      buildVersion: readString(jarIdentity.buildVersion),
      commit: typeof jarIdentity.commit === 'string' ? jarIdentity.commit : '',
      semver: readString(jarIdentity.semver),
    },
    jarPath: readString(value.jarPath),
    networkId: 'qortal',
    release: {
      asset: {
        digest: readString(asset.digest),
        downloadUrl: readString(asset.downloadUrl),
        name: assetName,
        size: typeof asset.size === 'number' ? asset.size : 0,
      },
      tagName: readString(release.tagName),
    },
    settingsPath: readString(value.settingsPath),
    source: 'home-managed',
    version: 1,
  };

  if (
    !record.installPath ||
    !record.installedAt ||
    !record.jarPath ||
    !record.settingsPath ||
    !record.release.tagName ||
    !SAFE_RELEASE_TAG.test(record.release.tagName) ||
    !SHA256_DIGEST.test(record.release.asset.digest) ||
    record.release.asset.downloadUrl !==
      `https://github.com/Qortal/qortal/releases/download/${record.release.tagName}/qortal.jar` ||
    !Number.isSafeInteger(record.release.asset.size) ||
    record.release.asset.size <= 0 ||
    !record.jarIdentity.buildVersion ||
    !record.jarIdentity.semver ||
    Number.isNaN(Date.parse(record.installedAt)) ||
    !matchesQortalJarReleaseIdentity(record.release, record.jarIdentity)
  ) {
    return null;
  }

  if (
    paths &&
    (path.resolve(record.installPath) !== path.resolve(paths.installPath) ||
      path.resolve(record.jarPath) !== path.resolve(paths.jarPath) ||
      path.resolve(record.settingsPath) !== path.resolve(paths.settingsPath))
  ) {
    return null;
  }

  return record;
}

export function resolveQortalManagedInstallPaths(
  context: CoreDescriptorPathContext,
): QortalManagedInstallPaths {
  const descriptorPaths = resolveCoreDescriptorPaths(QORTAL_CORE_DESCRIPTOR, context);
  const installPath = descriptorPaths.installPath;

  return {
    apiKeyPath: getCoreApiKeyPath(QORTAL_CORE_DESCRIPTOR, installPath),
    backupJarPath: path.join(installPath, '.qortium-home-qortal-backup.jar'),
    basePath: descriptorPaths.basePath,
    candidateJarPath: path.join(installPath, '.qortium-home-qortal-candidate.jar'),
    currentMetadataPath: descriptorPaths.currentCorePath,
    installPath,
    jarPath: path.join(installPath, QORTAL_CORE_DESCRIPTOR.package.jarFileName),
    runtimePath: descriptorPaths.runtimePath,
    settingsPath: getCoreSettingsPath(QORTAL_CORE_DESCRIPTOR, descriptorPaths),
  };
}

function assertCallbackContext(
  context: CoreJarInstallTransactionContext,
  input: PrepareQortalManagedInstallInput,
) {
  if (
    context.kind !== input.kind ||
    path.resolve(context.targetJarPath) !== path.resolve(input.paths.jarPath)
  ) {
    throw new Error('The Qortal install callback does not match the prepared transaction.');
  }
}

async function assertCurrentMetadataUnchanged(
  snapshot: MetadataSnapshot,
  currentMetadataPath: string,
  operations: QortalManagedInstallOperations,
) {
  const current = await operations.readFile(currentMetadataPath);

  if (!current.equals(snapshot.bytes)) {
    throw new Error('Qortal install metadata changed after transaction preparation.');
  }
}

export class QortalManagedInstallRollbackError extends AggregateError {
  readonly evidencePaths: readonly string[];

  constructor(errors: readonly unknown[], evidencePaths: readonly string[]) {
    super(errors, 'Unable to completely roll back the Qortal managed-install state.');
    this.name = 'QortalManagedInstallRollbackError';
    this.evidencePaths = evidencePaths;
  }
}

export async function prepareQortalManagedInstall(
  input: PrepareQortalManagedInstallInput,
  options: { operations?: Partial<QortalManagedInstallOperations> } = {},
): Promise<QortalManagedInstallCallbacks> {
  const operations: QortalManagedInstallOperations = {
    ...DEFAULT_OPERATIONS,
    ...options.operations,
  };

  assertManagedPathLayout(input.paths);

  if (!matchesQortalJarReleaseIdentity(input.release, input.identity)) {
    throw new Error('The Qortal release and JAR identity do not match.');
  }

  const paths = input.paths;
  const [baseIdentity, installIdentity] = await Promise.all([
    readSecureDirectoryIdentity(paths.basePath, operations),
    readSecureDirectoryIdentity(paths.installPath, operations),
  ]);
  const jarState = await inspectPath(paths.jarPath, operations);
  const metadataState = await inspectPath(paths.currentMetadataPath, operations);
  let previousMetadata: MetadataSnapshot | null = null;

  if (input.kind === 'initial-install') {
    const [settingsState, apiKeyState] = await Promise.all([
      inspectPath(paths.settingsPath, operations),
      inspectPath(paths.apiKeyPath, operations),
    ]);
    const conflicts = [
      [paths.jarPath, jarState.kind],
      [paths.settingsPath, settingsState.kind],
      [paths.apiKeyPath, apiKeyState.kind],
      [paths.currentMetadataPath, metadataState.kind],
    ].filter(([, state]) => state !== 'missing');

    if (conflicts.length > 0) {
      throw new Error(
        `A fresh Qortal managed install requires an empty target; refusing existing path ${conflicts[0][0]}.`,
      );
    }
  } else {
    if (jarState.kind !== 'file' || metadataState.kind !== 'file' || !metadataState.stats) {
      throw new Error('A Qortal managed update requires an existing JAR and current metadata file.');
    }

    const bytes = await operations.readFile(paths.currentMetadataPath);
    let parsed: unknown;

    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new Error('The current Qortal managed-install metadata is invalid.');
    }

    if (!parseQortalManagedInstallRecord(parsed, paths)) {
      throw new Error('The current Qortal managed-install metadata is invalid.');
    }

    previousMetadata = {
      bytes,
      mode: metadataState.stats.mode & 0o777,
    };
  }

  const installedAt = operations.now();

  if (Number.isNaN(installedAt.getTime())) {
    throw new Error('Unable to record a valid Qortal installation timestamp.');
  }

  const record: QortalManagedInstallRecordV1 = {
    installPath: paths.installPath,
    installedAt: installedAt.toISOString(),
    jarIdentity: { ...input.identity },
    jarPath: paths.jarPath,
    networkId: 'qortal',
    release: {
      asset: { ...input.release.asset },
      tagName: input.release.tagName,
    },
    settingsPath: paths.settingsPath,
    source: 'home-managed',
    version: 1,
  };
  const recordBytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
  const createdInitialPaths: string[] = [];
  let metadataMutationAttempted = false;

  const afterSwap = async (context: CoreJarInstallTransactionContext) => {
    assertCallbackContext(context, input);
    const [currentBaseIdentity, currentInstallIdentity] = await Promise.all([
      readSecureDirectoryIdentity(paths.basePath, operations),
      readSecureDirectoryIdentity(paths.installPath, operations),
    ]);
    if (
      currentBaseIdentity.dev !== baseIdentity.dev ||
      currentBaseIdentity.ino !== baseIdentity.ino ||
      currentInstallIdentity.dev !== installIdentity.dev ||
      currentInstallIdentity.ino !== installIdentity.ino
    ) {
      throw new Error('The Qortal managed-install directories changed during activation.');
    }
    const activeJarState = await operations.readTargetState(paths.jarPath);

    if (
      activeJarState.kind !== 'file' ||
      path.resolve(activeJarState.canonicalPath) !== path.resolve(paths.jarPath) ||
      activeJarState.size !== input.release.asset.size ||
      activeJarState.sha256 !== input.release.asset.digest ||
      JSON.stringify(activeJarState.identity) !== JSON.stringify(input.identity)
    ) {
      throw new Error('The activated Qortal JAR does not match its verified release identity.');
    }

    if (input.kind === 'initial-install') {
      await operations.mkdir(paths.installPath, { mode: 0o700, recursive: true });
      await createExclusiveFile(
        paths.settingsPath,
        SETTINGS_CONTENTS,
        PRIVATE_FILE_MODE,
        operations,
        () => createdInitialPaths.push(paths.settingsPath),
      );
      const apiKey = createApiKey(operations);
      await createExclusiveFile(
        paths.apiKeyPath,
        apiKey,
        PRIVATE_FILE_MODE,
        operations,
        () => createdInitialPaths.push(paths.apiKeyPath),
      );
      await operations.syncDirectory(paths.installPath);

      if ((await inspectPath(paths.currentMetadataPath, operations)).kind !== 'missing') {
        throw new Error('Qortal install metadata appeared after transaction preparation.');
      }
    } else if (previousMetadata) {
      await assertCurrentMetadataUnchanged(
        previousMetadata,
        paths.currentMetadataPath,
        operations,
      );
    }

    await operations.mkdir(paths.basePath, { mode: 0o700, recursive: true });
    metadataMutationAttempted = true;
    await writeFileAtomically(
      paths.currentMetadataPath,
      recordBytes,
      PRIVATE_FILE_MODE,
      operations,
    );
  };

  const afterRollback = async (context: CoreJarInstallTransactionContext) => {
    assertCallbackContext(context, input);
    const rollbackErrors: unknown[] = [];
    const evidencePaths: string[] = [];

    if (input.kind === 'initial-install') {
      if (metadataMutationAttempted) {
        try {
          const state = await inspectPath(paths.currentMetadataPath, operations);
          if (state.kind === 'file') {
            const bytes = await operations.readFile(paths.currentMetadataPath);
            if (!bytes.equals(recordBytes)) {
              throw new Error('Qortal install metadata changed before rollback cleanup.');
            }
            await operations.unlink(paths.currentMetadataPath);
            await operations.syncDirectory(paths.basePath);
          } else if (state.kind !== 'missing') {
            throw new Error('Qortal install metadata is not a regular file during rollback.');
          }
        } catch (error) {
          rollbackErrors.push(error);
          evidencePaths.push(paths.currentMetadataPath);
        }
      }
      for (const createdPath of [...createdInitialPaths].reverse()) {
        try {
          await operations.unlink(createdPath);
        } catch (error) {
          if (getErrorCode(error) !== 'ENOENT') {
            rollbackErrors.push(error);
            evidencePaths.push(createdPath);
          }
        }
      }
      try {
        await operations.syncDirectory(paths.installPath);
      } catch (error) {
        rollbackErrors.push(error);
        evidencePaths.push(paths.installPath);
      }
    } else if (previousMetadata && metadataMutationAttempted) {
      try {
        const state = await inspectPath(paths.currentMetadataPath, operations);
        if (state.kind !== 'file') {
          throw new Error('Qortal update metadata is missing or invalid during rollback.');
        }
        const currentBytes = await operations.readFile(paths.currentMetadataPath);
        if (currentBytes.equals(recordBytes)) {
          await writeFileAtomically(
            paths.currentMetadataPath,
            previousMetadata.bytes,
            previousMetadata.mode,
            operations,
          );
        } else if (!currentBytes.equals(previousMetadata.bytes)) {
          throw new Error('Qortal update metadata changed before rollback restoration.');
        }
      } catch (error) {
        rollbackErrors.push(error);
        evidencePaths.push(paths.currentMetadataPath);
      }
    }

    if (rollbackErrors.length > 0) {
      throw new QortalManagedInstallRollbackError(rollbackErrors, evidencePaths);
    }
  };

  return { afterRollback, afterSwap, record };
}
