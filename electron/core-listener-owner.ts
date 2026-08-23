import { readdir, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';

export type CoreListenerOwnerObservation =
  | { kind: 'absent' }
  | { kind: 'owners'; pids: readonly number[] }
  | { kind: 'unknown'; reason: string };

export type CoreListenerOwnerOperations = {
  getCurrentUserId(): number | null;
  listProcessIds(): Promise<readonly number[]>;
  readDirectory(targetPath: string): Promise<readonly string[]>;
  readText(targetPath: string): Promise<string>;
  readLink(targetPath: string): Promise<string>;
  readProcessUserId(pid: number): Promise<number>;
};

const DEFAULT_OPERATIONS: CoreListenerOwnerOperations = {
  getCurrentUserId: () => process.geteuid?.() ?? process.getuid?.() ?? null,
  listProcessIds: async () => (await readdir('/proc', { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^[1-9][0-9]*$/.test(entry.name))
    .map((entry) => Number(entry.name)),
  readDirectory: readdir,
  readLink: readlink,
  readProcessUserId: async (pid) => {
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    const match = /^Uid:\s+(\d+)\s+(\d+)\s+/m.exec(status);
    const uid = match ? Number(match[2]) : Number.NaN;
    if (!Number.isSafeInteger(uid) || uid < 0) throw new Error(`Linux process ${pid} has an invalid status record.`);
    return uid;
  },
  readText: async (targetPath) => await readFile(targetPath, 'utf8'),
};

function errorCode(error: unknown) {
  return error instanceof Error && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

export function parseLinuxListeningSocketInodes(table: string, port: number) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError('Listener port must be an integer from 1 through 65535.');
  }
  const expectedPort = port.toString(16).toUpperCase().padStart(4, '0');
  const inodes = new Set<string>();

  for (const line of table.split(/\r?\n/).slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10 || fields[3] !== '0A') continue;
    const separator = fields[1]?.lastIndexOf(':') ?? -1;
    if (separator < 0 || fields[1].slice(separator + 1).toUpperCase() !== expectedPort) continue;
    if (/^[1-9][0-9]*$/.test(fields[9])) inodes.add(fields[9]);
  }

  return inodes;
}

/** Linux-only listener-holder proof within Home's local-user trust boundary. */
export async function observeCoreListenerOwners(
  port: number,
  options: {
    operations?: Partial<CoreListenerOwnerOperations>;
    platform?: NodeJS.Platform;
    procRoot?: string;
  } = {},
): Promise<CoreListenerOwnerObservation> {
  if ((options.platform ?? process.platform) !== 'linux') {
    return { kind: 'unknown', reason: 'Strong listener ownership is currently Linux-only.' };
  }
  const operations = { ...DEFAULT_OPERATIONS, ...options.operations };
  const procRoot = path.resolve(options.procRoot ?? '/proc');
  const currentUserId = operations.getCurrentUserId();
  if (currentUserId === null || !Number.isSafeInteger(currentUserId) || currentUserId < 0) {
    return { kind: 'unknown', reason: 'The current effective user ID could not be determined.' };
  }
  let tcp: string;
  let tcp6: string;
  try {
    [tcp, tcp6] = await Promise.all([
      operations.readText(path.join(procRoot, 'net', 'tcp')),
      operations.readText(path.join(procRoot, 'net', 'tcp6')),
    ]);
  } catch {
    return { kind: 'unknown', reason: 'The Linux TCP listener tables could not be read.' };
  }
  const inodes = new Set([
    ...parseLinuxListeningSocketInodes(tcp, port),
    ...parseLinuxListeningSocketInodes(tcp6, port),
  ]);
  if (inodes.size === 0) return { kind: 'absent' };

  let processIds: readonly number[];
  try { processIds = await operations.listProcessIds(); }
  catch { return { kind: 'unknown', reason: 'Linux process IDs could not be enumerated for listener ownership.' }; }
  const owners = new Map<string, Set<number>>();
  for (const inode of inodes) owners.set(inode, new Set());

  await Promise.all([...new Set(processIds)].filter((pid) => Number.isSafeInteger(pid) && pid > 0).map(async (pid) => {
    try {
      if (await operations.readProcessUserId(pid) !== currentUserId) return;
    } catch (error) {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ESRCH') return;
      // Linux can deny same-user /proc details for non-dumpable processes.
      // A target socket that is held only there remains unmapped and fails
      // below; mapped co-holders that are visible to this user are reported.
      return;
    }
    const fdRoot = path.join(procRoot, String(pid), 'fd');
    let descriptors: readonly string[];
    try {
      descriptors = await operations.readDirectory(fdRoot);
    } catch (error) {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ESRCH') return;
      return;
    }
    await Promise.all(descriptors.map(async (descriptor) => {
      try {
        const target = await operations.readLink(path.join(fdRoot, descriptor));
        const match = /^socket:\[([1-9][0-9]*)\]$/.exec(target);
        if (match && owners.has(match[1])) owners.get(match[1])!.add(pid);
      } catch {
        // Individual descriptors routinely disappear while /proc is scanned.
      }
    }));
  }));

  if ([...owners.values()].some((pids) => pids.size === 0)) {
    return { kind: 'unknown', reason: 'A listener socket exists but its owning PID could not be proven.' };
  }
  return { kind: 'owners', pids: [...new Set([...owners.values()].flatMap((pids) => [...pids]))].sort((a, b) => a - b) };
}
