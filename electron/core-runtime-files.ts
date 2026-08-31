import { constants, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { chmod, cp, link, lstat, mkdir, open, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const REWARD_NODE_IDENTITY_LENGTH = 32;
const REWARD_NODE_DIRECTORY_MODE = 0o700;
const REWARD_NODE_IDENTITY_MODE = 0o600;

function isMissingPathError(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function assertOwnerOnlyMode(mode: number, expected: number, label: string) {
  if (process.platform !== 'win32' && (mode & 0o777) !== expected) {
    throw new Error(`${label} must have owner-only permissions.`);
  }
}

async function readValidatedRewardIdentity(filePath: string, label: string) {
  const directoryPath = path.dirname(filePath);
  let directoryStat;

  try {
    directoryStat = await lstat(directoryPath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }

    throw error;
  }

  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error(`${label} parent must be a directory and cannot be a symbolic link.`);
  }

  let pathStat;

  try {
    pathStat = await lstat(filePath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }

    throw error;
  }

  if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
    throw new Error(`${label} must be a regular file and cannot be a symbolic link.`);
  }

  assertOwnerOnlyMode(pathStat.mode, REWARD_NODE_IDENTITY_MODE, label);

  const noFollowFlag = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
  const handle = await open(filePath, constants.O_RDONLY | noFollowFlag);

  try {
    const openedStat = await handle.stat();

    if (!openedStat.isFile() || openedStat.size !== REWARD_NODE_IDENTITY_LENGTH) {
      throw new Error(`${label} must contain exactly ${REWARD_NODE_IDENTITY_LENGTH} bytes.`);
    }

    if (
      process.platform !== 'win32' &&
      (openedStat.dev !== pathStat.dev || openedStat.ino !== pathStat.ino)
    ) {
      throw new Error(`${label} changed while it was being opened.`);
    }

    assertOwnerOnlyMode(openedStat.mode, REWARD_NODE_IDENTITY_MODE, label);

    const identity = await handle.readFile();

    if (identity.length !== REWARD_NODE_IDENTITY_LENGTH) {
      throw new Error(`${label} must contain exactly ${REWARD_NODE_IDENTITY_LENGTH} bytes.`);
    }

    return identity;
  } finally {
    await handle.close();
  }
}

async function prepareRewardNodeDirectory(directoryPath: string) {
  await mkdir(directoryPath, { recursive: true, mode: REWARD_NODE_DIRECTORY_MODE });

  const directoryStat = await lstat(directoryPath);

  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error('The runtime reward-node path must be a directory and cannot be a symbolic link.');
  }

  if (process.platform !== 'win32') {
    await chmod(directoryPath, REWARD_NODE_DIRECTORY_MODE);
    const securedStat = await lstat(directoryPath);
    assertOwnerOnlyMode(securedStat.mode, REWARD_NODE_DIRECTORY_MODE, 'The runtime reward-node directory');
  }
}

async function syncDirectory(directoryPath: string) {
  if (process.platform === 'win32') {
    return;
  }

  const directoryHandle = await open(directoryPath, constants.O_RDONLY);

  try {
    try {
      await directoryHandle.sync();
    } catch (error) {
      if (!['EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP'].includes((error as NodeJS.ErrnoException)?.code ?? '')) {
        throw error;
      }
    }
  } finally {
    await directoryHandle.close();
  }
}

async function publishRewardNodeIdentity(
  identity: Buffer,
  identityDirectory: string,
  identityPath: string,
  options: { existingTargetWins: boolean; targetLabel: string },
) {
  await prepareRewardNodeDirectory(identityDirectory);

  const temporaryIdentityPath = path.join(
    identityDirectory,
    `.identity.key.tmp-${process.pid}-${randomBytes(12).toString('hex')}`,
  );
  const temporaryHandle = await open(
    temporaryIdentityPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    REWARD_NODE_IDENTITY_MODE,
  );

  try {
    try {
      await temporaryHandle.writeFile(identity);
      await temporaryHandle.sync();
    } finally {
      await temporaryHandle.close();
    }

    if (process.platform !== 'win32') {
      await chmod(temporaryIdentityPath, REWARD_NODE_IDENTITY_MODE);
    }

    let publishedThisIdentity = false;

    try {
      await link(temporaryIdentityPath, identityPath);
      publishedThisIdentity = true;
      await syncDirectory(identityDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') {
        throw error;
      }
    }

    const publishedIdentity = await readValidatedRewardIdentity(identityPath, options.targetLabel);

    if (
      !publishedIdentity ||
      ((!options.existingTargetWins || publishedThisIdentity) && !publishedIdentity.equals(identity))
    ) {
      throw new Error(`${options.targetLabel} does not match the identity that Home needed to preserve.`);
    }
  } finally {
    await rm(temporaryIdentityPath, { force: true });
  }
}

function normalizeFilesystemPath(value: string) {
  return path.resolve(value);
}

export async function copyLegacyInstallListsToRuntime(previewPath: string, runtimePath: string) {
  const legacyListsPath = path.join(previewPath, 'lists');
  const targetListsPath = path.join(runtimePath, 'lists');

  if (
    !existsSync(legacyListsPath) ||
    normalizeFilesystemPath(legacyListsPath) === normalizeFilesystemPath(targetListsPath)
  ) {
    return;
  }

  const entries = await readdir(legacyListsPath, { withFileTypes: true });

  if (entries.length === 0) {
    return;
  }

  await mkdir(targetListsPath, { recursive: true });

  for (const entry of entries) {
    const sourceEntryPath = path.join(legacyListsPath, entry.name);
    const targetEntryPath = path.join(targetListsPath, entry.name);

    if (existsSync(targetEntryPath)) {
      continue;
    }

    await cp(sourceEntryPath, targetEntryPath, { recursive: entry.isDirectory() });
  }
}

export async function preserveLegacyRewardNodeIdentity(previewPath: string, runtimePath: string) {
  const legacyIdentityPath = path.join(previewPath, 'reward-node', 'identity.key');
  const runtimeIdentityDirectory = path.join(runtimePath, 'reward-node');
  const runtimeIdentityPath = path.join(runtimeIdentityDirectory, 'identity.key');

  if (normalizeFilesystemPath(legacyIdentityPath) === normalizeFilesystemPath(runtimeIdentityPath)) {
    await readValidatedRewardIdentity(runtimeIdentityPath, 'The reward-node identity');
    return;
  }

  // A valid runtime identity is authoritative. Never inspect or overwrite it
  // based on a stale install-local copy left behind for rollback compatibility.
  const existingRuntimeIdentity = await readValidatedRewardIdentity(
    runtimeIdentityPath,
    'The runtime reward-node identity',
  );

  if (existingRuntimeIdentity) {
    return;
  }

  const legacyIdentity = await readValidatedRewardIdentity(
    legacyIdentityPath,
    'The install-local reward-node identity',
  );

  if (!legacyIdentity) {
    return;
  }

  await publishRewardNodeIdentity(legacyIdentity, runtimeIdentityDirectory, runtimeIdentityPath, {
    existingTargetWins: true,
    targetLabel: 'The runtime reward-node identity',
  });
}

export async function mirrorRuntimeRewardNodeIdentityToPreview(runtimePath: string, previewPath: string) {
  const runtimeIdentityPath = path.join(runtimePath, 'reward-node', 'identity.key');
  const previewIdentityDirectory = path.join(previewPath, 'reward-node');
  const previewIdentityPath = path.join(previewIdentityDirectory, 'identity.key');

  if (normalizeFilesystemPath(runtimeIdentityPath) === normalizeFilesystemPath(previewIdentityPath)) {
    await readValidatedRewardIdentity(runtimeIdentityPath, 'The reward-node identity');
    return;
  }

  const runtimeIdentity = await readValidatedRewardIdentity(
    runtimeIdentityPath,
    'The runtime reward-node identity',
  );

  if (!runtimeIdentity) {
    return;
  }

  const existingPreviewIdentity = await readValidatedRewardIdentity(
    previewIdentityPath,
    'The install-local reward-node identity',
  );

  if (existingPreviewIdentity) {
    if (!existingPreviewIdentity.equals(runtimeIdentity)) {
      throw new Error('The install-local reward-node identity conflicts with the runtime identity.');
    }

    return;
  }

  await publishRewardNodeIdentity(runtimeIdentity, previewIdentityDirectory, previewIdentityPath, {
    existingTargetWins: false,
    targetLabel: 'The install-local reward-node identity',
  });
}

/**
 * Copies a wallets directory out of the install tree, which an install replaces
 * wholesale.
 *
 * Home never writes walletsPath -- qortium-core#295's PreviewRuntimeWallets
 * does, from preview/start.sh, and a Home-managed run inherits whatever is
 * already in the managed settings file. With no key present Core falls back to
 * a RELATIVE `wallets` default that resolves inside the install tree, which is
 * how wallet data ends up in a directory an install replaces wholesale. That
 * data is irreplaceable -- a crosschain wallet, not a cache -- and a managed
 * update must not destroy it merely because Home was not what created it.
 *
 * COPIES rather than moves: leaving the original in place costs disk until the
 * install replaces it, and that is the right trade for wallet data, because a
 * half-completed move is the one outcome worth ruling out. Unlike the sibling
 * preservation steps it does NOT skip an occupied destination -- see the
 * fail-closed comment below. qortium-core#295 performs the authoritative
 * migration, with byte verification and a settings rewrite; this is only a
 * guard for data that has not been through it.
 *
 * Only safe against a STOPPED Core, which the caller guarantees: it stops a
 * Home-owned Core and waits for the pid to exit, and an install is refused
 * outright while a Core that Home does not own is running.
 */
export async function copyLegacyInstallWalletsToRuntime(
  previewPath: string,
  runtimePath: string,
) {
  const legacyWalletsPath = path.join(previewPath, 'wallets');
  const targetWalletsPath = path.join(runtimePath, 'wallets');

  if (
    !existsSync(legacyWalletsPath) ||
    normalizeFilesystemPath(legacyWalletsPath) === normalizeFilesystemPath(targetWalletsPath)
  ) {
    return;
  }

  const entries = await readdir(legacyWalletsPath, { withFileTypes: true });

  if (entries.length === 0) {
    return;
  }

  await mkdir(targetWalletsPath, { recursive: true });

  for (const entry of entries) {
    const targetEntryPath = path.join(targetWalletsPath, entry.name);

    // FAIL CLOSED on a conflict. Skipping is what the sibling steps do, and it
    // is right for lists, which regenerate -- but here the caller DELETES the
    // legacy tree moments later, so a skip quietly destroys anything that
    // existed only in the skipped directory. Refusing the install leaves both
    // copies intact for qortium-core's PreviewRuntimeWallets, which reconciles
    // with byte comparison; this step has no business choosing a winner.
    //
    // Raised by the Core session in review, and they were right: the first
    // version of this skipped, and its test codified the skip.
    if (existsSync(targetEntryPath)) {
      throw new Error(
        `Two wallet directories exist for ${entry.name}: ${targetEntryPath} and ` +
          `${path.join(legacyWalletsPath, entry.name)}. Refusing to install, because ` +
          'continuing would delete the second. Reconcile them first -- starting Core ' +
          'through preview/start.sh migrates and verifies it.',
      );
    }

    await cp(path.join(legacyWalletsPath, entry.name), targetEntryPath, {
      recursive: entry.isDirectory(),
    });
  }
}

export async function preserveLegacyCoreRuntimeFiles(previewPath: string, runtimePath: string) {
  await preserveLegacyRewardNodeIdentity(previewPath, runtimePath);
  await copyLegacyInstallListsToRuntime(previewPath, runtimePath);
  await copyLegacyInstallWalletsToRuntime(previewPath, runtimePath);
}
