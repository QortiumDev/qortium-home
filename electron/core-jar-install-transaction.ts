import { lstat, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

const WINDOWS_BUSY_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000] as const;

type JarPathStat = {
  isFile: () => boolean;
};

export type CoreJarInstallTransactionOperations = {
  lstat: (targetPath: string) => Promise<JarPathStat>;
  rename: (sourcePath: string, destinationPath: string) => Promise<void>;
  unlink: (targetPath: string) => Promise<void>;
  wait: (delayMs: number) => Promise<void>;
};

export type CoreJarInstallKind = 'initial-install' | 'update';

export type CoreJarInstallTransactionContext = {
  kind: CoreJarInstallKind;
  targetJarPath: string;
};

export type CoreJarInstallTransactionResult = CoreJarInstallTransactionContext;

export type CoreJarInstallTransactionOptions = {
  afterRollback: (context: CoreJarInstallTransactionContext) => Promise<void>;
  afterSwap: (context: CoreJarInstallTransactionContext) => Promise<void>;
  backupJarPath: string;
  candidateJarPath: string;
  operations?: Partial<CoreJarInstallTransactionOperations>;
  platform?: NodeJS.Platform;
  retryDelaysMs?: readonly number[];
  targetJarPath: string;
};

const DEFAULT_OPERATIONS: CoreJarInstallTransactionOperations = {
  lstat,
  rename,
  unlink,
  wait: async (delayMs) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  },
};

function getErrorCode(error: unknown) {
  return error instanceof Error && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function isWindowsBusyError(error: unknown) {
  const code = getErrorCode(error);

  return code === 'EACCES' || code === 'EBUSY' || code === 'EPERM';
}

async function inspectPath(
  targetPath: string,
  operations: CoreJarInstallTransactionOperations,
) {
  try {
    const stats = await operations.lstat(targetPath);
    return stats.isFile() ? 'file' : 'other';
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return 'missing';
    throw error;
  }
}

function resolveSiblingPaths(options: CoreJarInstallTransactionOptions) {
  const candidateJarPath = path.resolve(options.candidateJarPath);
  const backupJarPath = path.resolve(options.backupJarPath);
  const targetJarPath = path.resolve(options.targetJarPath);
  const platform = options.platform ?? process.platform;
  const comparisonPath = (targetPath: string) =>
    platform === 'win32' ? targetPath.toLowerCase() : targetPath;
  const uniquePaths = new Set(
    [candidateJarPath, backupJarPath, targetJarPath].map(comparisonPath),
  );

  if (uniquePaths.size !== 3) {
    throw new Error('The target, candidate, and backup JAR paths must be distinct.');
  }

  const targetDirectory = comparisonPath(path.dirname(targetJarPath));

  if (
    comparisonPath(path.dirname(candidateJarPath)) !== targetDirectory ||
    comparisonPath(path.dirname(backupJarPath)) !== targetDirectory
  ) {
    throw new Error('The target, candidate, and backup JAR paths must be direct siblings.');
  }

  return { backupJarPath, candidateJarPath, targetJarPath };
}

export class CoreJarInstallRecoveryError extends AggregateError {
  readonly backupJarPath: string;
  readonly targetJarPath: string;

  constructor(
    primaryError: unknown,
    recoveryErrors: readonly unknown[],
    paths: { backupJarPath: string; targetJarPath: string },
  ) {
    super(
      [primaryError, ...recoveryErrors],
      `The JAR install failed and recovery was incomplete. The previous JAR may remain at ${paths.backupJarPath}.`,
    );
    this.name = 'CoreJarInstallRecoveryError';
    this.backupJarPath = paths.backupJarPath;
    this.targetJarPath = paths.targetJarPath;
  }
}

export class CoreJarInstallCleanupError extends Error {
  readonly backupJarPath: string;
  readonly cause: unknown;
  readonly committed = true;

  constructor(cause: unknown, backupJarPath: string) {
    super(`The JAR install committed, but its backup could not be removed at ${backupJarPath}.`);
    this.name = 'CoreJarInstallCleanupError';
    this.backupJarPath = backupJarPath;
    this.cause = cause;
  }
}

/**
 * Performs only the same-directory JAR swap. The caller must hold the single
 * install lock for these paths from its final policy/state revalidation until
 * this promise settles; backup-path ownership is not safe across concurrent
 * callers without that outer lock.
 */
export async function runCoreJarInstallTransaction(
  options: CoreJarInstallTransactionOptions,
): Promise<CoreJarInstallTransactionResult> {
  const paths = resolveSiblingPaths(options);
  const operations: CoreJarInstallTransactionOperations = {
    ...DEFAULT_OPERATIONS,
    ...options.operations,
  };
  const platform = options.platform ?? process.platform;
  const retryDelaysMs = options.retryDelaysMs ?? WINDOWS_BUSY_RETRY_DELAYS_MS;

  const retryWindowsBusy = async (operation: () => Promise<void>) => {
    let retryIndex = 0;

    while (true) {
      try {
        await operation();
        return;
      } catch (error) {
        if (
          platform !== 'win32' ||
          !isWindowsBusyError(error) ||
          retryIndex >= retryDelaysMs.length
        ) {
          throw error;
        }

        await operations.wait(retryDelaysMs[retryIndex]);
        retryIndex += 1;
      }
    }
  };

  const renameAtomically = async (sourcePath: string, destinationPath: string) => {
    // A direct rename either completes atomically or fails. In particular,
    // EXDEV is propagated: there is deliberately no copy-and-delete fallback.
    await retryWindowsBusy(async () => {
      await operations.rename(sourcePath, destinationPath);
    });
  };

  const unlinkWithRetry = async (targetPath: string) => {
    await retryWindowsBusy(async () => {
      await operations.unlink(targetPath);
    });
  };

  const candidateState = await inspectPath(paths.candidateJarPath, operations);
  const backupState = await inspectPath(paths.backupJarPath, operations);
  const targetState = await inspectPath(paths.targetJarPath, operations);

  if (candidateState !== 'file') {
    throw new Error('The candidate JAR must exist as a regular file.');
  }

  if (backupState !== 'missing') {
    throw new Error('The backup JAR path must not already exist.');
  }

  if (targetState === 'other') {
    throw new Error('The target JAR must be absent or a regular file.');
  }

  const context: CoreJarInstallTransactionContext = {
    kind: targetState === 'file' ? 'update' : 'initial-install',
    targetJarPath: paths.targetJarPath,
  };

  const cleanupCandidateAfterRecovery = async (primaryError: unknown) => {
    const recoveryErrors: unknown[] = [];

    try {
      if ((await inspectPath(paths.candidateJarPath, operations)) !== 'missing') {
        await unlinkWithRetry(paths.candidateJarPath);
      }
    } catch (error) {
      recoveryErrors.push(error);
    }

    if (recoveryErrors.length > 0) {
      throw new CoreJarInstallRecoveryError(primaryError, recoveryErrors, paths);
    }

    throw primaryError;
  };

  if (context.kind === 'update') {
    try {
      await renameAtomically(paths.targetJarPath, paths.backupJarPath);
    } catch (error) {
      await cleanupCandidateAfterRecovery(error);
    }
  }

  try {
    await renameAtomically(paths.candidateJarPath, paths.targetJarPath);
  } catch (error) {
    if (context.kind === 'update') {
      try {
        await renameAtomically(paths.backupJarPath, paths.targetJarPath);
      } catch (recoveryError) {
        // The old JAR is still the backup and the candidate remains staged.
        // Preserve both for explicit recovery instead of deleting either.
        throw new CoreJarInstallRecoveryError(error, [recoveryError], paths);
      }
    }

    await cleanupCandidateAfterRecovery(error);
  }

  try {
    await options.afterSwap(context);
  } catch (error) {
    const recoveryErrors: unknown[] = [];
    let filesystemRecovered = false;
    let metadataRecovered = false;

    try {
      // Move the failed candidate back to its staging name first. If restoring
      // the old JAR then fails, both JARs remain available for manual recovery.
      await renameAtomically(paths.targetJarPath, paths.candidateJarPath);

      if (context.kind === 'update') {
        await renameAtomically(paths.backupJarPath, paths.targetJarPath);
      }

      filesystemRecovered = true;
    } catch (recoveryError) {
      recoveryErrors.push(recoveryError);
    }

    if (filesystemRecovered) {
      try {
        await options.afterRollback(context);
        metadataRecovered = true;
      } catch (recoveryError) {
        recoveryErrors.push(recoveryError);
      }
    }

    if (filesystemRecovered && metadataRecovered) {
      try {
        await unlinkWithRetry(paths.candidateJarPath);
      } catch (recoveryError) {
        recoveryErrors.push(recoveryError);
      }
    }

    if (recoveryErrors.length > 0) {
      throw new CoreJarInstallRecoveryError(error, recoveryErrors, paths);
    }

    throw error;
  }

  if (context.kind === 'update') {
    try {
      await unlinkWithRetry(paths.backupJarPath);
    } catch (error) {
      // afterSwap has committed. Do not report this as a rolled-back update.
      throw new CoreJarInstallCleanupError(error, paths.backupJarPath);
    }
  }

  return context;
}
