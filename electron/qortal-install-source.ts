import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  coreJarTargetStatesMatch,
  readCoreJarTargetState,
  type CoreJarTargetState,
} from './core-jar-target-state.js';
import type { QortalManagedInstallPaths } from './qortal-managed-install.js';

const MAX_RECORD_BYTES = 32 * 1024;
const MAX_SETTINGS_BYTES = 8 * 1024 * 1024;
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
  sha256: string;
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

// This tranche introduces persisted v1 records; the settings digest is part of
// that initial on-disk schema rather than a migration of a released format.
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
    sha256: string;
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

type RecordWriteHandle = {
  close(): Promise<void>;
  stat(): Promise<FileStats>;
  sync(): Promise<void>;
  writeFile(contents: string | Uint8Array): Promise<void>;
};

export type QortalInstallSourceOperations = {
  getUid(): number | undefined;
  link(sourcePath: string, destinationPath: string): Promise<void>;
  lstat(targetPath: string): Promise<FileStats>;
  mkdir(targetPath: string, options: { mode: number; recursive: true }): Promise<unknown>;
  now(): Date;
  openPrivate(targetPath: string, mode: number): Promise<RecordWriteHandle>;
  openRecord(targetPath: string): Promise<RecordHandle>;
  openSettings(targetPath: string): Promise<RecordHandle>;
  randomBytes(size: number): Uint8Array;
  readJarState(targetPath: string): Promise<CoreJarTargetState>;
  readSecureRecord?(targetPath: string, maxBytes: number): Promise<Buffer>;
  realpath(targetPath: string): Promise<string>;
  syncDirectory(targetPath: string): Promise<void>;
  unlink(targetPath: string): Promise<void>;
};

export type QortalInstallSourceOptions = {
  operations?: Partial<QortalInstallSourceOperations>;
  platform?: NodeJS.Platform;
};

const DEFAULT_OPERATIONS: QortalInstallSourceOperations = {
  getUid: () => process.geteuid?.() ?? process.getuid?.(),
  link,
  lstat: async (targetPath) => await lstat(targetPath),
  mkdir,
  now: () => new Date(),
  openPrivate: async (targetPath, mode) => await open(targetPath, 'wx', mode),
  openRecord: async (targetPath) => await open(targetPath, constants.O_RDONLY | constants.O_NOFOLLOW),
  openSettings: async (targetPath) => await open(targetPath,
    process.platform === 'win32' ? 'r' : constants.O_RDONLY | constants.O_NOFOLLOW),
  randomBytes,
  readJarState: async (targetPath) => await readCoreJarTargetState(targetPath),
  realpath: async (targetPath) => await realpath(targetPath),
  syncDirectory: async (targetPath) => {
    if (process.platform === 'win32') return;
    const handle = await open(targetPath, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  },
  unlink,
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
    stats.size >= 0 && stats.size <= MAX_RECORD_BYTES && (stats.mode & 0o7077) === 0 &&
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
  if (!Number.isSafeInteger(canonical.size) || canonical.size < 0 || canonical.size > MAX_SETTINGS_BYTES) {
    throw new Error('The Qortal settings target exceeded its byte limit.');
  }
  const handle = await operations.openSettings(canonicalPath);
  try {
    const opened = await handle.stat();
    if (!statsMatch(canonical, opened)) throw new Error('The Qortal settings target changed before it was read.');
    const digest = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < opened.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, opened.size - position), position);
      if (bytesRead <= 0) throw new Error('The Qortal settings target ended before its recorded size.');
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const [closedState, finalPathState] = await Promise.all([handle.stat(), operations.lstat(canonicalPath)]);
    if (!statsMatch(opened, closedState) || !statsMatch(opened, finalPathState)) {
      throw new Error('The Qortal settings target changed while it was read.');
    }
    return {
      canonicalPath,
      dev: opened.dev,
      ino: opened.ino,
      mtimeMs: opened.mtimeMs,
      sha256: `sha256:${digest.digest('hex')}`,
      size: opened.size,
    };
  } finally {
    await handle.close();
  }
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
  if (!candidate.origins.includes(detectedBy)) {
    throw new Error('The adopted Qortal detection source was not observed for this candidate.');
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
      sha256: candidate.settingsState.sha256,
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
      !exactKeys(value.adoptedSettings, ['canonicalPath', 'mtimeMs', 'sha256', 'size'])) return null;
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
      typeof record.adoptedSettings.sha256 !== 'string' || !SHA256_DIGEST.test(record.adoptedSettings.sha256) ||
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
      inspected.candidate.settingsState.sha256 !== record.adoptedSettings.sha256 ||
      inspected.candidate.settingsState.size !== record.adoptedSettings.size) {
    return { kind: 'unknown', reason: 'The adopted Qortal identity no longer matches its Home record.' } as const;
  }
  return inspected;
}

export type QortalAdoptedInstallPersistenceResult =
  | { kind: 'blocked'; reason: string }
  | { kind: 'persisted'; record: QortalAdoptedInstallRecordV1 }
  | { kind: 'unchanged'; record: QortalAdoptedInstallRecordV1 }
  | { kind: 'unknown'; reason: string };

type DirectoryIdentity = { dev: number; ino: number };

function identitiesMatch(left: DirectoryIdentity, right: DirectoryIdentity) {
  return left.dev === right.dev && left.ino === right.ino;
}

function candidateEvidenceMatches(
  selected: QortalInstallCandidate,
  current: QortalInstallCandidate,
  platform: NodeJS.Platform,
) {
  return samePath(selected.canonicalInstallPath, current.canonicalInstallPath, platform) &&
    coreJarTargetStatesMatch(selected.jarState, current.jarState, platform) &&
    samePath(selected.settingsState.canonicalPath, current.settingsState.canonicalPath, platform) &&
    selected.settingsState.dev === current.settingsState.dev &&
    selected.settingsState.ino === current.settingsState.ino &&
    selected.settingsState.mtimeMs === current.settingsState.mtimeMs &&
    selected.settingsState.sha256 === current.settingsState.sha256 &&
    selected.settingsState.size === current.settingsState.size;
}

function adoptedRecordsMatch(
  left: QortalAdoptedInstallRecordV1,
  right: QortalAdoptedInstallRecordV1,
) {
  return left.adoptedAt === right.adoptedAt && left.detectedBy === right.detectedBy &&
    left.installPath === right.installPath && left.jarPath === right.jarPath &&
    left.networkId === right.networkId && left.settingsPath === right.settingsPath &&
    left.source === right.source && left.version === right.version &&
    left.adoptedJar.buildVersion === right.adoptedJar.buildVersion &&
    left.adoptedJar.canonicalPath === right.adoptedJar.canonicalPath &&
    left.adoptedJar.semver === right.adoptedJar.semver &&
    left.adoptedJar.sha256 === right.adoptedJar.sha256 &&
    left.adoptedJar.size === right.adoptedJar.size &&
    left.adoptedSettings.canonicalPath === right.adoptedSettings.canonicalPath &&
    left.adoptedSettings.mtimeMs === right.adoptedSettings.mtimeMs &&
    left.adoptedSettings.sha256 === right.adoptedSettings.sha256 &&
    left.adoptedSettings.size === right.adoptedSettings.size;
}

async function reInspectSelectedCandidate(
  selected: QortalInstallCandidate,
  detectedBy: Exclude<QortalInstallCandidateOrigin, 'home-managed'>,
  managedPaths: QortalManagedInstallPaths,
  operations: QortalInstallSourceOperations,
  platform: NodeJS.Platform,
) {
  const inspected = await inspectQortalInstallCandidate({
    installPath: selected.canonicalInstallPath,
    origin: detectedBy,
  }, managedPaths, { operations, platform });
  return inspected.kind === 'candidate' && candidateEvidenceMatches(selected, inspected.candidate, platform)
    ? inspected.candidate
    : null;
}

async function ensurePrivateRecordDirectory(
  directoryPath: string,
  operations: QortalInstallSourceOperations,
  platform: NodeJS.Platform,
) {
  try {
    await operations.lstat(directoryPath);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
    await operations.mkdir(directoryPath, { mode: 0o700, recursive: true });
  }
  return await readPrivateRecordDirectory(directoryPath, operations, platform);
}

async function readPrivateRecordDirectory(
  directoryPath: string,
  operations: QortalInstallSourceOperations,
  platform: NodeJS.Platform,
) {
  const stats = await operations.lstat(directoryPath);
  const canonicalPath = await operations.realpath(directoryPath);
  const uid = operations.getUid();
  if (!stats.isDirectory() || stats.isSymbolicLink() ||
      !Number.isSafeInteger(stats.dev) || !Number.isSafeInteger(stats.ino) ||
      !samePath(canonicalPath, directoryPath, platform) ||
      (platform !== 'win32' && ((stats.mode & 0o7077) !== 0 || (uid !== undefined && stats.uid !== uid)))) {
    throw new Error('The Qortal adopted-install record directory is not private.');
  }
  return { dev: stats.dev, ino: stats.ino };
}

async function readDirectoryIdentity(
  directoryPath: string,
  expected: DirectoryIdentity,
  operations: QortalInstallSourceOperations,
  platform: NodeJS.Platform,
) {
  const current = await readPrivateRecordDirectory(directoryPath, operations, platform);
  if (!identitiesMatch(current, expected)) {
    throw new Error('The Qortal adopted-install record directory changed during persistence.');
  }
}

async function classifyExistingSelection(
  existing: QortalAdoptedInstallRecordRead,
  selected: QortalInstallCandidate,
  detectedBy: Exclude<QortalInstallCandidateOrigin, 'home-managed'>,
  managedPaths: QortalManagedInstallPaths,
  operations: QortalInstallSourceOperations,
  platform: NodeJS.Platform,
): Promise<QortalAdoptedInstallPersistenceResult | null> {
  if (existing.kind === 'missing') return null;
  if (existing.kind === 'unknown') {
    return { kind: 'blocked', reason: 'The existing adopted-install record is not securely usable.' };
  }
  const inspected = await inspectRecordedQortalAdoptedInstall(existing.record, managedPaths, {
    operations,
    platform,
  });
  if (inspected.kind !== 'candidate' || !candidateEvidenceMatches(selected, inspected.candidate, platform)) {
    return { kind: 'blocked', reason: 'A different or stale adopted-install record already exists.' };
  }
  const expected = createQortalAdoptedInstallRecord(
    inspected.candidate,
    detectedBy,
    new Date(existing.record.adoptedAt),
  );
  return adoptedRecordsMatch(existing.record, expected)
    ? { kind: 'unchanged', record: existing.record }
    : { kind: 'blocked', reason: 'A different or stale adopted-install record already exists.' };
}

async function removeOwnedTemporaryRecord(
  temporaryPath: string,
  identity: DirectoryIdentity | null,
  operations: QortalInstallSourceOperations,
) {
  if (!identity) return false;
  try {
    const current = await operations.lstat(temporaryPath);
    if (!current.isFile() || current.isSymbolicLink() ||
        current.dev !== identity.dev || current.ino !== identity.ino) return false;
    // Node has no unlink-by-inode primitive. The immediately preceding identity
    // check is bounded by the private, current-user-owned Home appData directory.
    await operations.unlink(temporaryPath);
    return true;
  } catch (error) {
    return errorCode(error) === 'ENOENT';
  }
}

export async function persistSelectedQortalAdoptedInstall(
  selected: QortalInstallCandidate,
  detectedBy: Exclude<QortalInstallCandidateOrigin, 'home-managed'>,
  managedPaths: QortalManagedInstallPaths,
  options: QortalInstallSourceOptions = {},
): Promise<QortalAdoptedInstallPersistenceResult> {
  const platform = options.platform ?? process.platform;
  const operations: QortalInstallSourceOperations = { ...DEFAULT_OPERATIONS, ...options.operations };
  if (selected.origins.includes('home-managed')) {
    return { kind: 'blocked', reason: 'A Home-managed Qortal install cannot be recorded as adopted.' };
  }
  if (!selected.origins.includes(detectedBy)) {
    return { kind: 'blocked', reason: 'The selected Qortal detection source was not observed.' };
  }
  if (platform === 'win32') {
    return { kind: 'blocked', reason: 'Secure Windows adopted-install record writes are unavailable.' };
  }
  if (!canonicalAbsolutePath(managedPaths.basePath)) {
    return { kind: 'blocked', reason: 'The Home appData path for adopted-install persistence is invalid.' };
  }

  const recordPath = resolveQortalAdoptedInstallRecordPath(managedPaths);
  const initialCandidate = await reInspectSelectedCandidate(
    selected,
    detectedBy,
    managedPaths,
    operations,
    platform,
  ).catch(() => null);
  if (!initialCandidate) {
    return { kind: 'blocked', reason: 'The selected Qortal install changed before it could be persisted.' };
  }

  const initialRecord = await readQortalAdoptedInstallRecord(recordPath, { operations, platform });
  const initialExisting = await classifyExistingSelection(
    initialRecord,
    initialCandidate,
    detectedBy,
    managedPaths,
    operations,
    platform,
  ).catch(() => ({ kind: 'blocked', reason: 'The existing adopted-install record could not be revalidated.' } as const));
  if (initialExisting) {
    if (initialExisting.kind === 'unchanged') {
      try { await readPrivateRecordDirectory(managedPaths.basePath, operations, platform); }
      catch {
        return { kind: 'unknown', reason: 'The Home appData directory could not be validated for persistence.' };
      }
    }
    return initialExisting;
  }

  let baseIdentity: DirectoryIdentity;
  try {
    baseIdentity = await ensurePrivateRecordDirectory(managedPaths.basePath, operations, platform);
  } catch {
    return { kind: 'unknown', reason: 'The Home appData directory could not be validated for persistence.' };
  }

  let record: QortalAdoptedInstallRecordV1;
  try {
    record = createQortalAdoptedInstallRecord(initialCandidate, detectedBy, operations.now());
  } catch {
    return { kind: 'unknown', reason: 'The adopted-install record could not be constructed safely.' };
  }
  const serialized = `${JSON.stringify(record)}\n`;
  const parsedSerialized = parseQortalAdoptedInstallRecord(JSON.parse(serialized));
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_BYTES || !parsedSerialized ||
      !adoptedRecordsMatch(parsedSerialized, record)) {
    return { kind: 'unknown', reason: 'The adopted-install record could not be serialized safely.' };
  }

  let entropy: Uint8Array;
  try { entropy = operations.randomBytes(12); }
  catch {
    return { kind: 'unknown', reason: 'The adopted-install temporary-name source failed.' };
  }
  if (entropy.byteLength !== 12) {
    return { kind: 'unknown', reason: 'The adopted-install temporary-name source was invalid.' };
  }
  const temporaryPath = path.join(
    managedPaths.basePath,
    `.adopted-${Buffer.from(entropy).toString('hex')}.tmp`,
  );
  let temporaryIdentity: DirectoryIdentity | null = null;
  let linked = false;

  try {
    const handle = await operations.openPrivate(temporaryPath, 0o600);
    let handleError: unknown;
    try {
      const before = await handle.stat();
      temporaryIdentity = { dev: before.dev, ino: before.ino };
      const uid = operations.getUid();
      if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o7777) !== 0o600 ||
          (uid !== undefined && before.uid !== uid)) {
        throw new Error('The adopted-install temporary record is not private.');
      }
      await handle.writeFile(serialized);
      await handle.sync();
      const after = await handle.stat();
      if (!after.isFile() || after.isSymbolicLink() ||
          after.dev !== before.dev || after.ino !== before.ino ||
          after.size !== Buffer.byteLength(serialized, 'utf8') || (after.mode & 0o7777) !== 0o600 ||
          (uid !== undefined && after.uid !== uid)) {
        throw new Error('The adopted-install temporary record changed while it was written.');
      }
    } catch (error) {
      handleError = error;
    }
    try { await handle.close(); } catch (error) {
      handleError = handleError ? new AggregateError([handleError, error]) : error;
    }
    if (handleError) throw handleError;

    const staged = await readQortalAdoptedInstallRecord(temporaryPath, { operations, platform });
    if (staged.kind !== 'record' || !adoptedRecordsMatch(staged.record, record)) {
      throw new Error('The adopted-install temporary record could not be verified.');
    }
    const finalCandidate = await reInspectSelectedCandidate(
      selected,
      detectedBy,
      managedPaths,
      operations,
      platform,
    );
    if (!finalCandidate) {
      const cleaned = await removeOwnedTemporaryRecord(temporaryPath, temporaryIdentity, operations);
      return cleaned
        ? { kind: 'blocked', reason: 'The selected Qortal install changed before persistence.' }
        : { kind: 'unknown', reason: 'The selected Qortal install changed and temporary cleanup was uncertain.' };
    }
    await readDirectoryIdentity(managedPaths.basePath, baseIdentity, operations, platform);
    const appeared = await readQortalAdoptedInstallRecord(recordPath, { operations, platform });
    const appearedResult = await classifyExistingSelection(
      appeared,
      finalCandidate,
      detectedBy,
      managedPaths,
      operations,
      platform,
    );
    if (appearedResult) {
      const cleaned = await removeOwnedTemporaryRecord(temporaryPath, temporaryIdentity, operations);
      return cleaned ? appearedResult : {
        kind: 'unknown', reason: 'A record appeared and temporary cleanup was uncertain.',
      };
    }

    try {
      // Linking an exclusive same-directory temp is an atomic no-clobber commit:
      // unlike rename(), it cannot replace a concurrently selected record.
      await operations.link(temporaryPath, recordPath);
      linked = true;
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
      const raced = await readQortalAdoptedInstallRecord(recordPath, { operations, platform });
      const racedResult = await classifyExistingSelection(
        raced,
        finalCandidate,
        detectedBy,
        managedPaths,
        operations,
        platform,
      );
      const cleaned = await removeOwnedTemporaryRecord(temporaryPath, temporaryIdentity, operations);
      return cleaned ? racedResult ?? {
        kind: 'unknown', reason: 'The adopted-install record race could not be classified.',
      } : { kind: 'unknown', reason: 'The adopted-install record raced and temporary cleanup was uncertain.' };
    }

    await operations.syncDirectory(managedPaths.basePath);
    const committed = await readQortalAdoptedInstallRecord(recordPath, { operations, platform });
    const committedCandidate = await reInspectSelectedCandidate(
      selected,
      detectedBy,
      managedPaths,
      operations,
      platform,
    );
    await readDirectoryIdentity(managedPaths.basePath, baseIdentity, operations, platform);
    if (committed.kind !== 'record' || !adoptedRecordsMatch(committed.record, record) || !committedCandidate) {
      throw new Error('The adopted-install record could not be revalidated after commit.');
    }
    const cleaned = await removeOwnedTemporaryRecord(temporaryPath, temporaryIdentity, operations);
    if (!cleaned) {
      return { kind: 'unknown', reason: 'The adopted-install record was committed but temporary cleanup was uncertain.' };
    }
    await operations.syncDirectory(managedPaths.basePath);
    return { kind: 'persisted', record: committed.record };
  } catch {
    const committedCleaned = linked
      ? await removeOwnedTemporaryRecord(recordPath, temporaryIdentity, operations)
      : true;
    const cleaned = await removeOwnedTemporaryRecord(temporaryPath, temporaryIdentity, operations);
    if (linked) {
      let rollbackSynced = false;
      if (committedCleaned && cleaned) {
        try { await operations.syncDirectory(managedPaths.basePath); rollbackSynced = true; }
        catch { rollbackSynced = false; }
      }
      return { kind: 'unknown', reason: committedCleaned && cleaned && rollbackSynced
        ? 'The adopted-install record commit could not be verified.'
        : 'The adopted-install record commit or durable cleanup could not be verified.' };
    }
    return { kind: 'unknown', reason: cleaned
      ? 'The adopted-install record could not be persisted.'
      : 'The adopted-install record failed and temporary cleanup was uncertain.' };
  }
}
