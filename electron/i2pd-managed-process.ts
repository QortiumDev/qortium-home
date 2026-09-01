import { constants } from 'node:fs';
import { open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const LINUX_BOOT_ID_PATH = '/proc/sys/kernel/random/boot_id';
const MAX_PID_FILE_BYTES = 32;
const MAX_CMDLINE_BYTES = 16 * 1024;

export type I2pdManagedProcessIdentity = Readonly<{
  pid: number;
  startIdentity: string;
}>;

export type I2pdManagedProcessObservation =
  | Readonly<{ kind: 'absent' }>
  | Readonly<{ kind: 'owned'; process: I2pdManagedProcessIdentity }>
  | Readonly<{ kind: 'unknown'; reason: string }>;

export type I2pdManagedProcessOperations = Readonly<{
  getCurrentUserId(): number | null;
  readBootId(): Promise<string>;
  readProcessArgv(pid: number): Promise<readonly string[]>;
  readProcessExecutable(pid: number): Promise<string>;
  readProcessStartTicks(pid: number): Promise<string>;
  readProcessUserId(pid: number): Promise<number>;
  readSecurePidFile(pidPath: string, expectedUserId: number): Promise<string>;
  realpath(targetPath: string): Promise<string>;
}>;

export type ObserveManagedI2pdProcessOptions = Readonly<{
  binaryPath: string;
  confPath: string;
  operations?: Partial<I2pdManagedProcessOperations>;
  pidPath: string;
  platform?: NodeJS.Platform;
  runtimePath: string;
}>;

function errorCode(error: unknown) {
  return error instanceof Error && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function processDisappeared(error: unknown) {
  return errorCode(error) === 'ENOENT' || errorCode(error) === 'ESRCH';
}

function parsePositiveInteger(value: string) {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 0x7fffffff ? parsed : null;
}

/** Linux proc stat field 22, robust to spaces and closing parentheses in comm. */
export function parseI2pdLinuxProcessStartTicks(stat: string): string | null {
  const closingCommand = stat.lastIndexOf(') ');
  if (closingCommand < 0 || stat.indexOf('(') < 1) return null;
  const fields = stat.slice(closingCommand + 2).trim().split(/\s+/);
  const startTicks = fields[19] ?? '';
  return /^\d+$/.test(startTicks) ? startTicks : null;
}

function parseLinuxProcessUserId(status: string): number | null {
  const match = /^Uid:\s+(\d+)\s+(\d+)\s+/m.exec(status);
  if (!match || !/^\d+$/.test(match[2])) return null;
  const parsed = Number(match[2]);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function readBoundedFile(targetPath: string, maximumBytes: number) {
  const value = await readFile(targetPath);
  if (value.length > maximumBytes) {
    throw Object.assign(new Error(`${targetPath} exceeds its size limit.`), {
      code: 'EFBIG',
    });
  }
  return value;
}

const DEFAULT_OPERATIONS: I2pdManagedProcessOperations = {
  getCurrentUserId: () => process.geteuid?.() ?? process.getuid?.() ?? null,
  readBootId: async () => await readFile(LINUX_BOOT_ID_PATH, 'utf8'),
  readProcessArgv: async (pid) => (await readBoundedFile(
    `/proc/${pid}/cmdline`,
    MAX_CMDLINE_BYTES,
  )).toString('utf8').split('\0').filter(Boolean),
  readProcessExecutable: async (pid) => await realpath(`/proc/${pid}/exe`),
  readProcessStartTicks: async (pid) => {
    const stat = await readBoundedFile(`/proc/${pid}/stat`, MAX_CMDLINE_BYTES);
    const startTicks = parseI2pdLinuxProcessStartTicks(stat.toString('utf8'));
    if (!startTicks) throw new Error(`Linux process ${pid} has an invalid stat record.`);
    return startTicks;
  },
  readProcessUserId: async (pid) => {
    const status = await readBoundedFile(`/proc/${pid}/status`, MAX_CMDLINE_BYTES);
    const userId = parseLinuxProcessUserId(status.toString('utf8'));
    if (userId === null) throw new Error(`Linux process ${pid} has an invalid status record.`);
    return userId;
  },
  readSecurePidFile: async (pidPath, expectedUserId) => {
    const handle = await open(
      pidPath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.uid !== expectedUserId ||
        metadata.size < 1 || metadata.size > MAX_PID_FILE_BYTES ||
        (metadata.mode & 0o077) !== 0) {
        throw Object.assign(new Error('The managed i2pd PID file is not private.'), {
          code: 'EPERM',
        });
      }
      return await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
  },
  realpath: async (targetPath) => await realpath(targetPath),
};

function exactArguments(
  argv: readonly string[],
  binaryPath: string,
  runtimePath: string,
  confPath: string,
) {
  return argv.length === 3 &&
    argv[0] === binaryPath &&
    argv[1] === `--datadir=${runtimePath}` &&
    argv[2] === `--conf=${confPath}`;
}

/**
 * Recover lifecycle authority over an i2pd that a previous Home process
 * launched. Linux supplies stable process-start identity and executable
 * inspection through procfs; other platforms deliberately fail closed.
 */
export async function observeManagedI2pdProcess(
  options: ObserveManagedI2pdProcessOptions,
): Promise<I2pdManagedProcessObservation> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'linux') {
    return { kind: 'unknown', reason: `Strong i2pd process observation is unavailable on ${platform}.` };
  }

  const operations: I2pdManagedProcessOperations = {
    ...DEFAULT_OPERATIONS,
    ...options.operations,
  };
  const currentUserId = operations.getCurrentUserId();
  if (currentUserId === null || !Number.isSafeInteger(currentUserId) || currentUserId < 0) {
    return { kind: 'unknown', reason: 'The current effective user ID could not be determined.' };
  }

  let pidContents: string;
  try {
    pidContents = await operations.readSecurePidFile(options.pidPath, currentUserId);
  } catch (error) {
    if (processDisappeared(error)) return { kind: 'absent' };
    return {
      kind: 'unknown',
      reason: `The managed i2pd PID file could not be trusted: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const pid = parsePositiveInteger(pidContents.trim());
  if (!pid) return { kind: 'unknown', reason: 'The managed i2pd PID file is invalid.' };

  let bootId: string;
  let canonicalBinaryPath: string;
  try {
    [bootId, canonicalBinaryPath] = await Promise.all([
      operations.readBootId(),
      operations.realpath(path.resolve(options.binaryPath)),
    ]);
  } catch (error) {
    return {
      kind: 'unknown',
      reason: `Managed i2pd process observation could not be initialized: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  bootId = bootId.trim();
  if (!bootId || bootId.includes(':') || !/^[0-9a-f-]+$/i.test(bootId)) {
    return { kind: 'unknown', reason: 'The Linux boot identity is invalid.' };
  }

  let userIdBefore: number;
  let startTicksBefore: string;
  let executablePath: string;
  let argv: readonly string[];
  try {
    [userIdBefore, startTicksBefore, executablePath, argv] = await Promise.all([
      operations.readProcessUserId(pid),
      operations.readProcessStartTicks(pid),
      operations.readProcessExecutable(pid),
      operations.readProcessArgv(pid),
    ]);
  } catch (error) {
    if (processDisappeared(error)) return { kind: 'absent' };
    return {
      kind: 'unknown',
      reason: `Linux process ${pid} could not be inspected: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (userIdBefore !== currentUserId ||
    executablePath !== canonicalBinaryPath ||
    !exactArguments(
      argv,
      canonicalBinaryPath,
      path.resolve(options.runtimePath),
      path.resolve(options.confPath),
    )) {
    return { kind: 'absent' };
  }
  if (!/^\d+$/.test(startTicksBefore)) {
    return { kind: 'unknown', reason: `Linux process ${pid} has an invalid start identity.` };
  }

  let userIdAfter: number;
  let startTicksAfter: string;
  try {
    [userIdAfter, startTicksAfter] = await Promise.all([
      operations.readProcessUserId(pid),
      operations.readProcessStartTicks(pid),
    ]);
  } catch (error) {
    if (processDisappeared(error)) return { kind: 'absent' };
    return {
      kind: 'unknown',
      reason: `Linux process ${pid} could not be revalidated: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (userIdAfter !== currentUserId || startTicksAfter !== startTicksBefore) {
    return { kind: 'unknown', reason: `Linux process ${pid} changed identity while it was inspected.` };
  }

  return {
    kind: 'owned',
    process: { pid, startIdentity: `${bootId}:${startTicksBefore}` },
  };
}
