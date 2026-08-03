import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { movePath } from './filesystem-move.js';

type MoveOptions = {
  retryWindowsBusy?: boolean;
};

type CoreInstallTransactionOperations = {
  exists: (targetPath: string) => boolean;
  move: (sourcePath: string, destinationPath: string, options?: MoveOptions) => Promise<void>;
  remove: (targetPath: string) => Promise<void>;
};

type CoreInstallTransactionOptions = {
  activateCandidate: () => Promise<void>;
  backupPath: string;
  candidatePath: string;
  installPath: string;
  operations?: Partial<CoreInstallTransactionOperations>;
  restorePrevious: () => Promise<void>;
};

const DEFAULT_OPERATIONS: CoreInstallTransactionOperations = {
  exists: existsSync,
  move: movePath,
  remove: async (targetPath) => {
    // maxRetries makes rm itself tolerate transient Windows EBUSY/EPERM locks
    await rm(targetPath, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
  },
};

export async function runCoreInstallTransaction(options: CoreInstallTransactionOptions) {
  const operations: CoreInstallTransactionOperations = {
    ...DEFAULT_OPERATIONS,
    ...options.operations,
  };
  let backupInUse = false;
  let transactionSucceeded = false;

  // Both the candidate activation move and the backup restore move must
  // tolerate transient Windows locks (antivirus/indexer scans of freshly
  // written files), same as the install -> backup move below. An unretried
  // EPERM on the restore move is the worst case: it strands the machine
  // without any install.
  const moveReplacingDestination = async (sourcePath: string, destinationPath: string) => {
    await operations.remove(destinationPath);
    await operations.move(sourcePath, destinationPath, { retryWindowsBusy: true });
  };

  await operations.remove(options.backupPath);

  try {
    if (operations.exists(options.installPath)) {
      await operations.move(options.installPath, options.backupPath, {
        retryWindowsBusy: true,
      });
      backupInUse = true;
    }

    await moveReplacingDestination(options.candidatePath, options.installPath);
    await options.activateCandidate();
    transactionSucceeded = true;
  } catch (error) {
    if (backupInUse && operations.exists(options.backupPath)) {
      try {
        await moveReplacingDestination(options.backupPath, options.installPath);
        backupInUse = false;
        await options.restorePrevious();
      } catch {
        // If the filesystem restore failed, keep the unmoved backup for manual
        // recovery. If only the restored-state callback failed, the previous
        // files are already back in place. Failure cleanup never deletes either.
      }
    }

    throw error;
  } finally {
    if (transactionSucceeded && backupInUse) {
      await operations.remove(options.backupPath);
    }
  }
}
