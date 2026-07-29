import { cp, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export const WINDOWS_BUSY_MOVE_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000] as const;

type MovePathOperations = {
  copy: (sourcePath: string, destinationPath: string) => Promise<void>;
  makeParent: (destinationPath: string) => Promise<void>;
  remove: (sourcePath: string) => Promise<void>;
  rename: (sourcePath: string, destinationPath: string) => Promise<void>;
  wait: (delayMs: number) => Promise<void>;
};

type MovePathOptions = {
  operations?: Partial<MovePathOperations>;
  platform?: NodeJS.Platform;
  retryDelaysMs?: readonly number[];
  retryWindowsBusy?: boolean;
};

const DEFAULT_OPERATIONS: MovePathOperations = {
  copy: async (sourcePath, destinationPath) => {
    await cp(sourcePath, destinationPath, { recursive: true });
  },
  makeParent: async (destinationPath) => {
    await mkdir(path.dirname(destinationPath), { recursive: true });
  },
  remove: async (sourcePath) => {
    await rm(sourcePath, { recursive: true, force: true });
  },
  rename,
  wait: async (delayMs) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  },
};

function getErrorCode(error: unknown) {
  return error instanceof Error && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function isWindowsBusyMoveError(error: unknown) {
  const code = getErrorCode(error);

  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
}

export async function movePath(
  sourcePath: string,
  destinationPath: string,
  options: MovePathOptions = {},
) {
  const operations: MovePathOperations = {
    ...DEFAULT_OPERATIONS,
    ...options.operations,
  };
  const platform = options.platform ?? process.platform;
  const retryDelaysMs = options.retryDelaysMs ?? WINDOWS_BUSY_MOVE_RETRY_DELAYS_MS;
  let retryIndex = 0;

  await operations.makeParent(destinationPath);

  while (true) {
    try {
      await operations.rename(sourcePath, destinationPath);
      return;
    } catch (error) {
      if (getErrorCode(error) === 'EXDEV') {
        await operations.copy(sourcePath, destinationPath);
        await operations.remove(sourcePath);
        return;
      }

      if (
        !options.retryWindowsBusy ||
        platform !== 'win32' ||
        !isWindowsBusyMoveError(error) ||
        retryIndex >= retryDelaysMs.length
      ) {
        throw error;
      }

      await operations.wait(retryDelaysMs[retryIndex]);
      retryIndex += 1;
    }
  }
}
