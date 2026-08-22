import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  readCoreJarTargetState,
  type CoreJarTargetState,
} from './core-jar-target-state.js';
import type { QortalManagedInstallPaths } from './qortal-managed-install.js';

const MAX_RECORD_BYTES = 32 * 1024;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;

export type QortalInstallCandidateOrigin =
  | 'default-location'
  | 'home-managed'
  | 'qortal-hub'
  | 'running-process'
  | 'user-selected';

export type QortalInstallCandidateHint = {
  hubHint?: boolean;
  installPath: string;
  origin: QortalInstallCandidateOrigin;
  runningProcessMatch?: boolean;
};

export type QortalSettingsFileState = {
  canonicalPath: string;
  dev: number;
  ino: number;
  mtimeMs: number;
  size: number;
};

export type QortalInstallCandidate = {
  canonicalInstallPath: string;
  hubHint: boolean;
  jarState: Extract<CoreJarTargetState, { kind: 'file' }>;
  origins: readonly QortalInstallCandidateOrigin[];
  runningProcessMatch: boolean;
  settingsState: QortalSettingsFileState;
};

export type QortalInstallCandidateInspection =
  | { candidate: QortalInstallCandidate; kind: 'candidate' }
  | { kind: 'missing' }
  | { kind: 'unknown'; reason: string };

export type QortalInstallDiscovery =
  | { candidates: readonly QortalInstallCandidate[]; kind: 'observed' }
  | { candidates: readonly QortalInstallCandidate[]; kind: 'unknown'; reasons: readonly string[] };

export type QortalAdoptedInstallRecordV1 = {
  adoptedAt: string;
  adoptedJar: {
    buildVersion: string;
    canonicalPath: string;
    semver: string;
    sha256: string;
    size: number;
  };
  adoptedSettings: {
    canonicalPath: string;
    mtimeMs: number;
    size: number;
  };
  detectedBy: Exclude<QortalInstallCandidateOrigin, 'home-managed'>;
  installPath: string;
  jarPath: string;
  networkId: 'qortal';
  settingsPath: string;
  source: 'adopted';
  version: 1;
};

type FileStats = {
  dev: number;
  ino: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
  mode: number;
  mtimeMs: number;
  size: number;
  uid: number;
};

type RecordHandle = {
  close(): Promise<void>;
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  stat(): Promise<FileStats>;
};

export type QortalInstallSourceOperations = {
  getUid(): number | undefined;
  lstat(targetPath: string): Promise<FileStats>;
  openRecord(targetPath: string): Promise<RecordHandle>;
  readJarState(targetPath: string): Promise<CoreJarTargetState>;
  readSecureRecord?(targetPath: string, maxBytes: number): Promise<Buffer>;
  realpath(targetPath: string): Promise<string>;
};

export type QortalInstallSourceOptions = {
  operations?: Partial<QortalInstallSourceOperations>;
  platform?: NodeJS.Platform;
};

const DEFAULT_OPERATIONS: QortalInstallSourceOperations = {
  getUid: () => process.geteuid?.() ?? process.getuid?.(),
  lstat: async (targetPath) => await lstat(targetPath),
  openRecord: async (targetPath) => await open(targetPath, constants.O_RDONLY | constants.O_NOFOLLOW),
  readJarState: async (targetPath) => await readCoreJarTargetState(targetPath),
  realpath: async (targetPath) => await realpath(targetPath),
};

function errorCode(error: unknown) {
  return error instanceof Error && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  return Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function normalized(value: string, platform: NodeJS.Platform = process.platform) {
  const resolved = path.resolve(value);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(left: string, right: string, platform: NodeJS.Platform = process.platform) {
  return normalized(left, platform) === normalized(right, platform);
}

function pathInside(parent: string, child: string, platform: NodeJS.Platform = process.platform) {
  const relative = path.relative(normalized(parent, platform), normalized(child, platform));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function canonicalAbsolutePath(value: string) {
  return path.isAbsolute(value) && !value.includes('\0') && value === path.resolve(value);
}

function statsMatch(left: FileStats, right: FileStats) {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino &&
    left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function privateRecordStats(stats: FileStats, uid: number | undefined) {
  return stats.isFile() && !stats.isSymbolicLink() && Number.isSafeInteger(stats.size) &&
    stats.size >= 0 && stats.size <= MAX_RECORD_BYTES && (stats.mode & 0o077) === 0 &&
    (uid === undefined || stats.uid === uid);
}

async function readSettingsState(
  settingsPath: string,
  operations: QortalInstallSourceOperations,
): Promise<QortalSettingsFileState> {
  const initial = await operations.lstat(settingsPath);
  if (!initial.isFile() || initial.isSymbolicLink()) {
    throw new Error('The Qortal settings target is not a regular file.');
  }
  const canonicalPath = await operations.realpath(settingsPath);
  const canonical = await operations.lstat(canonicalPath);
  if (!samePath(settingsPath, canonicalPath) || !statsMatch(initial, canonical)) {
    throw new Error('The Qortal settings target is aliased or changed during inspection.');
  }
  return {
    canonicalPath,
    dev: canonical.dev,
    ino: canonical.ino,
    mtimeMs: canonical.mtimeMs,
    size: canonical.size,
  };
}

export function resolveQortalAdoptedInstallRecordPath(paths: QortalManagedInstallPaths) {
  return path.join(paths.basePath, 'adopted.json');
}

export async function inspectQortalInstallCandidate(
  hint: QortalInstallCandidateHint,
  managedPaths: QortalManagedInstallPaths,
  options: QortalInstallSourceOptions = {},
): Promise<QortalInstallCandidateInspection> {
  const operations = { ...DEFAULT_OPERATIONS, ...options.operations };
  const requestedPath = hint.installPath.trim();
  if (!requestedPath || !path.isAbsolute(requestedPath)) {
    return { kind: 'unknown', reason: 'A Qortal install candidate path was empty or relative.' };
  }
  try {
    const canonicalInstallPath = await operations.realpath(path.resolve(requestedPath));
    const installStats = await operations.lstat(canonicalInstallPath);
    if (!installStats.isDirectory() || installStats.isSymbolicLink()) {
      return { kind: 'unknown', reason: 'A Qortal install candidate was not a canonical directory.' };
    }
    if (pathInside(managedPaths.basePath, canonicalInstallPath) &&
        !samePath(canonicalInstallPath, managedPaths.installPath)) {
      return { kind: 'unknown', reason: 'A foreign Qortal install candidate was inside Home managed storage.' };
    }
    const jarPath = path.join(canonicalInstallPath, 'qortal.jar');
    const settingsPath = path.join(canonicalInstallPath, 'settings.json');
    const [jarState, settingsState] = await Promise.all([
      operations.readJarState(jarPath),
      readSettingsState(settingsPath, operations),
    ]);
    const finalInstallStats = await operations.lstat(canonicalInstallPath);
    if (!finalInstallStats.isDirectory() || finalInstallStats.isSymbolicLink() ||
        finalInstallStats.dev !== installStats.dev || finalInstallStats.ino !== installStats.ino) {
      return { kind: 'unknown', reason: 'The Qortal install candidate changed during inspection.' };
    }
    if (jarState.kind === 'missing') return { kind: 'missing' };
    if (!samePath(jarState.canonicalPath, jarPath)) {
      return { kind: 'unknown', reason: 'The Qortal JAR candidate was reached through an alias.' };
    }
    const source = samePath(canonicalInstallPath, managedPaths.installPath) ? 'home-managed' : hint.origin;
    return { candidate: {
      canonicalInstallPath,
      hubHint: hint.hubHint === true,
      jarState,
      origins: [source],
      runningProcessMatch: hint.runningProcessMatch === true,
      settingsState,
    }, kind: 'candidate' };
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { kind: 'missing' };
    return {
      kind: 'unknown',
      reason: `A Qortal install candidate could not be inspected: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function discoverQortalInstallCandidates(
  hints: readonly QortalInstallCandidateHint[],
  managedPaths: QortalManagedInstallPaths,
  options: QortalInstallSourceOptions = {},
): Promise<QortalInstallDiscovery> {
  const candidates = new Map<string, QortalInstallCandidate>();
  const reasons: string[] = [];
  for (const hint of hints) {
    const inspected = await inspectQortalInstallCandidate(hint, managedPaths, options);
    if (inspected.kind === 'unknown') {
      reasons.push(inspected.reason);
      continue;
    }
    if (inspected.kind === 'missing') continue;
    const key = normalized(inspected.candidate.jarState.canonicalPath);
    const existing = candidates.get(key);
    if (!existing) {
      candidates.set(key, inspected.candidate);
      continue;
    }
    candidates.set(key, {
      ...existing,
      hubHint: existing.hubHint || inspected.candidate.hubHint,
      origins: [...new Set([...existing.origins, ...inspected.candidate.origins])].sort(),
      runningProcessMatch: existing.runningProcessMatch || inspected.candidate.runningProcessMatch,
    });
  }
  const ordered = [...candidates.values()].sort((left, right) => {
    const leftManaged = left.origins.includes('home-managed');
    const rightManaged = right.origins.includes('home-managed');
    if (leftManaged !== rightManaged) return leftManaged ? -1 : 1;
    return normalized(left.canonicalInstallPath).localeCompare(normalized(right.canonicalInstallPath));
  });
  return reasons.length > 0
    ? { candidates: ordered, kind: 'unknown', reasons }
    : { candidates: ordered, kind: 'observed' };
}

export function createQortalAdoptedInstallRecord(
  candidate: QortalInstallCandidate,
  detectedBy: Exclude<QortalInstallCandidateOrigin, 'home-managed'>,
  now: Date = new Date(),
): QortalAdoptedInstallRecordV1 {
  if (candidate.origins.includes('home-managed')) {
    throw new Error('A Home-managed Qortal install cannot be recorded as adopted.');
  }
  if (Number.isNaN(now.getTime())) throw new Error('The Qortal adoption timestamp is invalid.');
  const identity = candidate.jarState.identity;
  if (!identity?.buildVersion || !identity.semver) {
    throw new Error('An adopted Qortal JAR requires a readable embedded identity.');
  }
  return {
    adoptedAt: now.toISOString(),
    adoptedJar: {
      buildVersion: identity.buildVersion,
      canonicalPath: candidate.jarState.canonicalPath,
      semver: identity.semver,
      sha256: candidate.jarState.sha256,
      size: candidate.jarState.size,
    },
    adoptedSettings: {
      canonicalPath: candidate.settingsState.canonicalPath,
      mtimeMs: candidate.settingsState.mtimeMs,
      size: candidate.settingsState.size,
    },
    detectedBy,
    installPath: candidate.canonicalInstallPath,
    jarPath: candidate.jarState.canonicalPath,
    networkId: 'qortal',
    settingsPath: candidate.settingsState.canonicalPath,
    source: 'adopted',
    version: 1,
  };
}

export function parseQortalAdoptedInstallRecord(value: unknown): QortalAdoptedInstallRecordV1 | null {
  if (!isObject(value) || !exactKeys(value, [
    'adoptedAt', 'adoptedJar', 'adoptedSettings', 'detectedBy', 'installPath', 'jarPath',
    'networkId', 'settingsPath', 'source', 'version',
  ]) || value.version !== 1 || value.networkId !== 'qortal' || value.source !== 'adopted' ||
      !isObject(value.adoptedJar) || !isObject(value.adoptedSettings) ||
      !exactKeys(value.adoptedJar, ['buildVersion', 'canonicalPath', 'semver', 'sha256', 'size']) ||
      !exactKeys(value.adoptedSettings, ['canonicalPath', 'mtimeMs', 'size'])) return null;
  const detectedBy = value.detectedBy;
  if (detectedBy !== 'default-location' && detectedBy !== 'qortal-hub' &&
      detectedBy !== 'running-process' && detectedBy !== 'user-selected') return null;
  const record = value as unknown as QortalAdoptedInstallRecordV1;
  if (typeof record.adoptedAt !== 'string' || Number.isNaN(Date.parse(record.adoptedAt)) ||
      new Date(record.adoptedAt).toISOString() !== record.adoptedAt ||
      typeof record.installPath !== 'string' || !canonicalAbsolutePath(record.installPath) ||
      typeof record.jarPath !== 'string' || !canonicalAbsolutePath(record.jarPath) ||
      typeof record.settingsPath !== 'string' || !canonicalAbsolutePath(record.settingsPath) ||
      typeof record.adoptedJar.buildVersion !== 'string' || !record.adoptedJar.buildVersion ||
      typeof record.adoptedJar.canonicalPath !== 'string' ||
      !canonicalAbsolutePath(record.adoptedJar.canonicalPath) ||
      typeof record.adoptedJar.semver !== 'string' || !record.adoptedJar.semver ||
      typeof record.adoptedJar.sha256 !== 'string' || !SHA256_DIGEST.test(record.adoptedJar.sha256) ||
      !Number.isSafeInteger(record.adoptedJar.size) || record.adoptedJar.size <= 0 ||
      typeof record.adoptedSettings.canonicalPath !== 'string' ||
      !canonicalAbsolutePath(record.adoptedSettings.canonicalPath) ||
      !Number.isFinite(record.adoptedSettings.mtimeMs) || record.adoptedSettings.mtimeMs < 0 ||
      !Number.isSafeInteger(record.adoptedSettings.size) || record.adoptedSettings.size < 0) return null;
  if (!samePath(record.jarPath, path.join(record.installPath, 'qortal.jar')) ||
      !samePath(record.settingsPath, path.join(record.installPath, 'settings.json')) ||
      !samePath(record.adoptedJar.canonicalPath, record.jarPath) ||
      !samePath(record.adoptedSettings.canonicalPath, record.settingsPath)) return null;
  return record;
}

export type QortalAdoptedInstallRecordRead =
  | { kind: 'missing' }
  | { kind: 'record'; record: QortalAdoptedInstallRecordV1 }
  | { kind: 'unknown'; reason: string };

export async function readQortalAdoptedInstallRecord(
  recordPath: string,
  options: QortalInstallSourceOptions = {},
): Promise<QortalAdoptedInstallRecordRead> {
  const operations = { ...DEFAULT_OPERATIONS, ...options.operations };
  if ((options.platform ?? process.platform) === 'win32') {
    if (!operations.readSecureRecord) {
      try {
        await operations.lstat(recordPath);
        return { kind: 'unknown', reason: 'Secure Windows adopted-install record reads are unavailable.' };
      } catch (error) {
        return errorCode(error) === 'ENOENT' ? { kind: 'missing' } : {
          kind: 'unknown',
          reason: `The adopted-install record could not be checked: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    try {
      const bytes = await operations.readSecureRecord(recordPath, MAX_RECORD_BYTES);
      if (bytes.byteLength > MAX_RECORD_BYTES) {
        return { kind: 'unknown', reason: 'The adopted-install record exceeded its byte limit.' };
      }
      let parsed: unknown;
      try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { return { kind: 'unknown', reason: 'The adopted-install record is malformed.' }; }
      const record = parseQortalAdoptedInstallRecord(parsed);
      return record ? { kind: 'record', record } :
        { kind: 'unknown', reason: 'The adopted-install record is invalid.' };
    } catch (error) {
      return errorCode(error) === 'ENOENT' ? { kind: 'missing' } : {
        kind: 'unknown',
        reason: `The adopted-install record could not be read securely: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  let handle: RecordHandle | null = null;
  try {
    const before = await operations.lstat(recordPath);
    const uid = operations.getUid();
    if (!privateRecordStats(before, uid)) {
      return { kind: 'unknown', reason: 'The adopted-install record is not a private regular file.' };
    }
    const canonicalPath = await operations.realpath(recordPath);
    if (!samePath(canonicalPath, recordPath)) {
      return { kind: 'unknown', reason: 'The adopted-install record path is aliased.' };
    }
    handle = await operations.openRecord(canonicalPath);
    const opened = await handle.stat();
    if (!statsMatch(before, opened) || !privateRecordStats(opened, uid)) {
      return { kind: 'unknown', reason: 'The adopted-install record changed while it was read.' };
    }
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead <= 0) break;
      offset += result.bytesRead;
    }
    const extra = Buffer.alloc(1);
    const extraRead = await handle.read(extra, 0, 1, offset);
    const after = await handle.stat();
    if (offset !== bytes.length || extraRead.bytesRead !== 0 || !statsMatch(opened, after) ||
        !privateRecordStats(after, uid)) {
      return { kind: 'unknown', reason: 'The adopted-install record changed while it was read.' };
    }
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { return { kind: 'unknown', reason: 'The adopted-install record is malformed.' }; }
    const record = parseQortalAdoptedInstallRecord(parsed);
    return record ? { kind: 'record', record } :
      { kind: 'unknown', reason: 'The adopted-install record is invalid.' };
  } catch (error) {
    return errorCode(error) === 'ENOENT' ? { kind: 'missing' } : {
      kind: 'unknown',
      reason: `The adopted-install record could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    if (handle) {
      try { await handle.close(); } catch { /* A read-only close failure does not validate the record. */ }
    }
  }
}

export async function inspectRecordedQortalAdoptedInstall(
  record: QortalAdoptedInstallRecordV1,
  managedPaths: QortalManagedInstallPaths,
  options: QortalInstallSourceOptions = {},
) {
  const inspected = await inspectQortalInstallCandidate({
    installPath: record.installPath,
    origin: record.detectedBy,
  }, managedPaths, options);
  if (inspected.kind !== 'candidate') return inspected;
  if (!samePath(inspected.candidate.jarState.canonicalPath, record.jarPath) ||
      !samePath(inspected.candidate.settingsState.canonicalPath, record.settingsPath) ||
      inspected.candidate.jarState.sha256 !== record.adoptedJar.sha256 ||
      inspected.candidate.jarState.size !== record.adoptedJar.size ||
      inspected.candidate.jarState.identity?.buildVersion !== record.adoptedJar.buildVersion ||
      inspected.candidate.jarState.identity?.semver !== record.adoptedJar.semver ||
      inspected.candidate.settingsState.mtimeMs !== record.adoptedSettings.mtimeMs ||
      inspected.candidate.settingsState.size !== record.adoptedSettings.size) {
    return { kind: 'unknown', reason: 'The adopted Qortal identity no longer matches its Home record.' } as const;
  }
  return inspected;
}
