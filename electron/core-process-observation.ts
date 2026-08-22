import { readFile, readdir, realpath } from 'node:fs/promises';
import {
  classifyQortalProcess,
  getQortalProcessPathApi,
  isPotentialQortalProcess,
  type QortalProcessClassification,
} from './qortal-process-classification.js';

export type { QortalProcessClassification } from './qortal-process-classification.js';

const LINUX_BOOT_ID_PATH = '/proc/sys/kernel/random/boot_id';

export type CoreProcessSnapshot = {
  argv: readonly string[];
  canonicalCwd: string;
  classification: QortalProcessClassification;
  pid: number;
  startIdentity: string;
};

export type CoreProcessObservation =
  | { kind: 'observed'; processes: readonly CoreProcessSnapshot[] }
  | { kind: 'unknown'; processes: readonly CoreProcessSnapshot[]; reason: string };

export type CoreProcessObservationOperations = {
  getCurrentUserId(): number | null;
  listProcessIds(): Promise<readonly number[]>;
  readBootId(): Promise<string>;
  readProcessArgv(pid: number): Promise<readonly string[]>;
  readProcessCwd(pid: number): Promise<string>;
  readProcessStartTicks(pid: number): Promise<string>;
  readProcessUserId(pid: number): Promise<number>;
  realpath(targetPath: string): Promise<string>;
};

export type ObserveCurrentUserQortalProcessesOptions = {
  operations?: Partial<CoreProcessObservationOperations>;
  platform?: NodeJS.Platform;
  selectedJarPath: string;
};

function errorCode(error: unknown) {
  return error instanceof Error && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function processDisappeared(error: unknown) {
  return errorCode(error) === 'ENOENT' || errorCode(error) === 'ESRCH';
}

function parsePositiveInteger(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Linux proc stat field 22, robust to spaces and closing parentheses in comm. */
export function parseLinuxProcessStartTicks(stat: string): string | null {
  const closingCommand = stat.lastIndexOf(') ');
  if (closingCommand < 0 || stat.indexOf('(') < 1) return null;

  // The fields after comm begin at field 3 (state). starttime is field 22,
  // therefore offset 19 in this tail.
  const fields = stat.slice(closingCommand + 2).trim().split(/\s+/);
  const startTicks = fields[19] ?? '';
  return /^\d+$/.test(startTicks) ? startTicks : null;
}

function parseLinuxProcessUserId(status: string): number | null {
  const match = /^Uid:\s+(\d+)\s+(\d+)\s+/m.exec(status);
  return match ? parsePositiveIntegerAllowZero(match[2]) : null;
}

function parsePositiveIntegerAllowZero(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

const DEFAULT_OPERATIONS: CoreProcessObservationOperations = {
  getCurrentUserId: () => process.geteuid?.() ?? process.getuid?.() ?? null,
  listProcessIds: async () => {
    const entries = await readdir('/proc', { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => Number(entry.name));
  },
  readBootId: async () => await readFile(LINUX_BOOT_ID_PATH, 'utf8'),
  readProcessArgv: async (pid) => (await readFile(`/proc/${pid}/cmdline`, 'utf8'))
    .split('\0')
    .filter(Boolean),
  readProcessCwd: async (pid) => await realpath(`/proc/${pid}/cwd`),
  readProcessStartTicks: async (pid) => {
    const startTicks = parseLinuxProcessStartTicks(await readFile(`/proc/${pid}/stat`, 'utf8'));
    if (!startTicks) throw new Error(`Linux process ${pid} has an invalid stat record.`);
    return startTicks;
  },
  readProcessUserId: async (pid) => {
    const userId = parseLinuxProcessUserId(await readFile(`/proc/${pid}/status`, 'utf8'));
    if (userId === null) throw new Error(`Linux process ${pid} has an invalid status record.`);
    return userId;
  },
  realpath: async (targetPath) => await realpath(targetPath),
};

function unknown(reason: string, processes: readonly CoreProcessSnapshot[] = []): CoreProcessObservation {
  return { kind: 'unknown', processes, reason };
}

async function canonicalizeSelectedJarPath(
  selectedJarPath: string,
  platform: NodeJS.Platform,
  operations: CoreProcessObservationOperations,
) {
  const pathApi = getQortalProcessPathApi(platform);
  const resolved = pathApi.resolve(selectedJarPath);
  try {
    return await operations.realpath(resolved);
  } catch (error) {
    if (!processDisappeared(error)) throw error;
  }

  // Initial-install observation runs before the selected JAR exists. Preserve
  // parent symlink/case canonicalization when possible, then use the absent
  // target's basename as its prospective canonical identity.
  try {
    return pathApi.join(
      await operations.realpath(pathApi.dirname(resolved)),
      pathApi.basename(resolved),
    );
  } catch (error) {
    if (!processDisappeared(error)) throw error;
    return resolved;
  }
}

/**
 * Uncached Linux process enumeration for lifecycle authority. Individual
 * processes that exit during the scan are ignored. Any other inability to
 * inspect a current-user process fails the whole observation closed.
 */
export async function observeCurrentUserQortalProcesses(
  options: ObserveCurrentUserQortalProcessesOptions,
): Promise<CoreProcessObservation> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'linux') {
    return unknown(`Strong process observation is unavailable on ${platform}.`);
  }

  const operations: CoreProcessObservationOperations = {
    ...DEFAULT_OPERATIONS,
    ...options.operations,
  };
  const currentUserId = operations.getCurrentUserId();
  if (currentUserId === null || !Number.isSafeInteger(currentUserId) || currentUserId < 0) {
    return unknown('The current effective user ID could not be determined.');
  }

  let bootId: string;
  let processIds: readonly number[];
  let canonicalSelectedJarPath: string;
  try {
    [bootId, processIds, canonicalSelectedJarPath] = await Promise.all([
      operations.readBootId(),
      operations.listProcessIds(),
      canonicalizeSelectedJarPath(options.selectedJarPath, platform, operations),
    ]);
  } catch (error) {
    return unknown(`Linux process observation could not be initialized: ${error instanceof Error ? error.message : String(error)}`);
  }
  bootId = bootId.trim();
  if (!bootId || bootId.includes(':') || !/^[0-9a-f-]+$/i.test(bootId)) {
    return unknown('The Linux boot identity is invalid.');
  }

  const snapshots: CoreProcessSnapshot[] = [];
  const uniqueProcessIds = [...new Set(processIds)]
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0)
    .sort((left, right) => left - right);

  for (const pid of uniqueProcessIds) {
    let userId: number;
    try {
      userId = await operations.readProcessUserId(pid);
    } catch (error) {
      if (processDisappeared(error)) continue;
      return unknown(
        `Linux process ${pid} could not be inspected: ${error instanceof Error ? error.message : String(error)}`,
        snapshots,
      );
    }
    if (userId !== currentUserId) continue;

    let startTicksBefore: string;
    try {
      startTicksBefore = await operations.readProcessStartTicks(pid);
    } catch (error) {
      if (processDisappeared(error)) continue;
      return unknown(`Linux process ${pid} has no readable start identity.`, snapshots);
    }
    if (!/^\d+$/.test(startTicksBefore)) {
      return unknown(`Linux process ${pid} has an invalid start identity.`, snapshots);
    }

    let argv: readonly string[];
    let canonicalCwd: string;
    let classification: QortalProcessClassification;
    try {
      argv = await operations.readProcessArgv(pid);
      if (!isPotentialQortalProcess(argv, platform)) {
        const [userIdAfter, startTicksAfter] = await Promise.all([
          operations.readProcessUserId(pid),
          operations.readProcessStartTicks(pid),
        ]);
        if (userIdAfter !== currentUserId || startTicksAfter !== startTicksBefore) {
          return unknown(`Linux process ${pid} changed identity while it was inspected.`, snapshots);
        }
        continue;
      }
      canonicalCwd = await operations.readProcessCwd(pid);
      classification = await classifyQortalProcess({
        argv,
        canonicalCwd,
        canonicalSelectedJarPath,
        operations,
        platform,
      });
    } catch (evidenceError) {
      try {
        const startTicksAfterError = await operations.readProcessStartTicks(pid);
        if (startTicksAfterError !== startTicksBefore) {
          return unknown(`Linux process ${pid} changed identity while it was inspected.`, snapshots);
        }
      } catch (identityError) {
        if (processDisappeared(identityError)) continue;
        return unknown(`Linux process ${pid} could not be revalidated after an evidence error.`, snapshots);
      }
      return unknown(
        `Linux process ${pid} evidence could not be read: ${evidenceError instanceof Error ? evidenceError.message : String(evidenceError)}`,
        snapshots,
      );
    }

    let userIdAfter: number;
    let startTicksAfter: string;
    try {
      userIdAfter = await operations.readProcessUserId(pid);
      startTicksAfter = await operations.readProcessStartTicks(pid);
    } catch (error) {
      if (processDisappeared(error)) continue;
      return unknown(`Linux process ${pid} could not be revalidated.`, snapshots);
    }
    if (startTicksBefore !== startTicksAfter) {
      return unknown(`Linux process ${pid} changed identity while it was inspected.`, snapshots);
    }
    if (userIdAfter !== currentUserId) {
      return unknown(`Linux process ${pid} changed effective user while it was inspected.`, snapshots);
    }

    snapshots.push({
      argv: [...argv],
      canonicalCwd,
      classification,
      pid,
      startIdentity: `${bootId}:${startTicksAfter}`,
    });
  }

  return { kind: 'observed', processes: snapshots };
}
