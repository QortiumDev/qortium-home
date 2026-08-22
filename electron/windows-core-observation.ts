import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { CoreListenerOwnerObservation } from './core-listener-owner.js';
import {
  CORE_NATIVE_OBSERVER_SCHEMA,
  CORE_NATIVE_OBSERVER_SCHEMA_VERSION,
  runCoreNativeObserver,
  type CoreNativeObserverRequest,
  type CoreNativeObserverResult,
  type CoreNativeObserverRunnerOptions,
  type CoreNativeWindowsObserverEnvelope,
  type CoreNativeWindowsProcessStartIdentity,
} from './core-native-observer.js';
import type { CoreProcessObservation, CoreProcessSnapshot } from './core-process-observation.js';
import { classifyQortalProcess } from './qortal-process-classification.js';

const MAX_UNSIGNED_64_BIT = 18_446_744_073_709_551_615n;
const MAX_IDENTIFIER_AUTHORITY = 281_474_976_710_655n;
const MAX_SUBAUTHORITY = 4_294_967_295n;

export type WindowsNativeObserverRunner = (
  request: CoreNativeObserverRequest,
  options: CoreNativeObserverRunnerOptions<'win32'>,
) => Promise<CoreNativeObserverResult<'win32'>>;

export type WindowsCoreObservationOperations = {
  realpath(targetPath: string): Promise<string>;
  runNativeObserver: WindowsNativeObserverRunner;
};

export type WindowsCoreObservationOptions = {
  helperPath: string;
  operations?: Partial<WindowsCoreObservationOperations>;
};

export type ObserveWindowsQortalProcessesOptions = WindowsCoreObservationOptions & {
  selectedJarPath: string;
};

export type WindowsSecureFileRead = {
  bytes: Buffer;
  stats: {
    dev: number;
    ino: number;
    isFile(): boolean;
    isSymbolicLink(): boolean;
    mode: number;
    size: number;
    uid: number;
  };
};

const DEFAULT_OPERATIONS: WindowsCoreObservationOperations = {
  realpath: async (targetPath) => await realpath(targetPath),
  runNativeObserver: runCoreNativeObserver,
};

function processUnknown(reason: string): CoreProcessObservation {
  return { kind: 'unknown', processes: [], reason };
}

function listenerUnknown(reason: string): CoreListenerOwnerObservation {
  return { kind: 'unknown', reason };
}

function isCanonicalAbsoluteWindowsPath(value: unknown): value is string {
  return typeof value === 'string' && !value.includes('\0') && path.win32.isAbsolute(value) &&
    path.win32.normalize(value) === value;
}

function canonicalWindowsNamespace(value: string) {
  const normalized = path.win32.normalize(value);
  if (normalized.toLowerCase().startsWith('\\\\?\\unc\\')) {
    return `\\\\${normalized.slice(8)}`;
  }
  return normalized.startsWith('\\\\?\\') ? normalized.slice(4) : normalized;
}

function normalizeWindowsPathIdentity(value: string) {
  return canonicalWindowsNamespace(value).toLowerCase();
}

function isPid(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 0xffff_ffff;
}

function isWindowsSid(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.split('-');
  if (parts.length < 4 || parts.length > 18 || parts[0] !== 'S' || parts[1] !== '1') return false;
  const decimalWithin = (part: string, maximum: bigint) =>
    /^(?:0|[1-9][0-9]*)$/.test(part) && BigInt(part) <= maximum;
  return decimalWithin(parts[2], MAX_IDENTIFIER_AUTHORITY) &&
    parts.slice(3).every((part) => decimalWithin(part, MAX_SUBAUTHORITY));
}

function isWindowsStartIdentity(value: unknown): value is CoreNativeWindowsProcessStartIdentity {
  if (!value || typeof value !== 'object') return false;
  const identity = value as Partial<CoreNativeWindowsProcessStartIdentity>;
  return identity.kind === 'windows' && typeof identity.fileTime === 'string' &&
    /^[1-9][0-9]*$/.test(identity.fileTime) && identity.fileTime.length <= 20 &&
    BigInt(identity.fileTime) <= MAX_UNSIGNED_64_BIT;
}

/** Opaque Windows process identity. FILETIME is the kernel process creation time. */
export function formatWindowsProcessStartIdentity(
  identity: CoreNativeWindowsProcessStartIdentity,
): string | null {
  return isWindowsStartIdentity(identity) ? `windows:filetime=${identity.fileTime}` : null;
}

function errorCode(error: unknown) {
  return error instanceof Error && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function targetMayNotExist(error: unknown) {
  return errorCode(error) === 'ENOENT' || errorCode(error) === 'ESRCH';
}

async function canonicalizeSelectedJarPath(
  selectedJarPath: string,
  operations: WindowsCoreObservationOperations,
) {
  if (!isCanonicalAbsoluteWindowsPath(selectedJarPath)) throw new Error('invalid-selected-jar-path');
  try {
    return await operations.realpath(selectedJarPath);
  } catch (error) {
    if (!targetMayNotExist(error)) throw error;
  }
  try {
    return path.win32.join(
      await operations.realpath(path.win32.dirname(selectedJarPath)),
      path.win32.basename(selectedJarPath),
    );
  } catch (error) {
    if (!targetMayNotExist(error)) throw error;
    return selectedJarPath;
  }
}

async function runObserver(
  request: CoreNativeObserverRequest,
  options: WindowsCoreObservationOptions,
  operations: WindowsCoreObservationOperations,
) {
  if (!isCanonicalAbsoluteWindowsPath(options.helperPath)) return null;
  try {
    return await operations.runNativeObserver(request, {
      arch: 'x64',
      helperPath: options.helperPath,
      platform: 'win32',
    });
  } catch {
    return null;
  }
}

function commonEnvelopeIsValid(envelope: CoreNativeWindowsObserverEnvelope, mode: CoreNativeObserverRequest['mode']) {
  return envelope.schema === CORE_NATIVE_OBSERVER_SCHEMA &&
    envelope.schemaVersion === CORE_NATIVE_OBSERVER_SCHEMA_VERSION && envelope.platform === 'win32' &&
    envelope.arch === 'x64' && envelope.mode === mode && isWindowsSid(envelope.effectiveSid);
}

/** Maps validated Windows x64 PEB evidence into the shared process shape. */
export async function observeWindowsQortalProcesses(
  options: ObserveWindowsQortalProcessesOptions,
): Promise<CoreProcessObservation> {
  const operations = { ...DEFAULT_OPERATIONS, ...options.operations };
  let canonicalSelectedJarPath: string;
  try {
    canonicalSelectedJarPath = canonicalWindowsNamespace(
      await canonicalizeSelectedJarPath(options.selectedJarPath, operations),
    );
    if (!isCanonicalAbsoluteWindowsPath(canonicalSelectedJarPath)) throw new Error('invalid-canonical-path');
  } catch {
    return processUnknown('The selected Qortal JAR path could not be proven.');
  }

  const result = await runObserver({ mode: 'processes' }, options, operations);
  if (!result || result.kind !== 'success') {
    return processUnknown('The Windows native observer could not prove process authority.');
  }
  const { envelope } = result;
  if (!commonEnvelopeIsValid(envelope, 'processes') || envelope.platform !== 'win32' ||
    envelope.mode !== 'processes' || envelope.status !== 'ok') {
    return processUnknown('The Windows native observer returned inconsistent process evidence.');
  }

  const snapshots: CoreProcessSnapshot[] = [];
  let previousPid = 0;
  try {
    for (const candidate of envelope.processes) {
      const startIdentity = formatWindowsProcessStartIdentity(candidate.startIdentity);
      if (!isPid(candidate.pid) || candidate.pid <= previousPid || !startIdentity ||
        !Array.isArray(candidate.argv) || candidate.argv.length < 1 ||
        candidate.argv.some((argument) => typeof argument !== 'string' || argument.includes('\0')) ||
        typeof candidate.rawCommandLine !== 'string' || candidate.rawCommandLine.length < 1 ||
        candidate.rawCommandLine.includes('\0') || !isCanonicalAbsoluteWindowsPath(candidate.canonicalCwd) ||
        !isCanonicalAbsoluteWindowsPath(candidate.executablePath)) {
        return processUnknown('The Windows native observer returned inconsistent process evidence.');
      }
      const canonicalCwd = canonicalWindowsNamespace(candidate.canonicalCwd);
      const executablePath = canonicalWindowsNamespace(candidate.executablePath);
      if (!isCanonicalAbsoluteWindowsPath(canonicalCwd) ||
        !isCanonicalAbsoluteWindowsPath(executablePath)) {
        return processUnknown('The Windows native observer returned inconsistent process evidence.');
      }
      const classification = await classifyQortalProcess({
        argv: candidate.argv,
        canonicalCwd,
        canonicalSelectedJarPath,
        operations: {
          realpath: async (targetPath) =>
            canonicalWindowsNamespace(await operations.realpath(targetPath)),
        },
        platform: 'win32',
      });
      snapshots.push({
        argv: candidate.argv,
        canonicalCwd,
        classification,
        pid: candidate.pid,
        startIdentity,
      });
      previousPid = candidate.pid;
    }
  } catch {
    return processUnknown('The Windows process paths could not be proven.');
  }
  return { kind: 'observed', processes: snapshots };
}

/** Maps identity-bracketed native Windows listener evidence into the shared owner shape. */
export async function observeWindowsCoreListenerOwners(
  port: number,
  options: WindowsCoreObservationOptions,
): Promise<CoreListenerOwnerObservation> {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    return listenerUnknown('The listener port is invalid.');
  }
  const operations = { ...DEFAULT_OPERATIONS, ...options.operations };
  const result = await runObserver({ mode: 'listener', port }, options, operations);
  if (!result || result.kind !== 'success') {
    return listenerUnknown('The Windows native observer could not prove listener authority.');
  }
  const { envelope } = result;
  if (!commonEnvelopeIsValid(envelope, 'listener') || envelope.platform !== 'win32' ||
    envelope.mode !== 'listener' || envelope.port !== port) {
    return listenerUnknown('The Windows native observer returned inconsistent listener evidence.');
  }
  if (envelope.status === 'absent') return { kind: 'absent' };
  if (envelope.status !== 'owners' || envelope.pids.length < 1 ||
    envelope.holders.length !== envelope.pids.length) {
    return listenerUnknown('The Windows native observer returned inconsistent listener evidence.');
  }

  let previousPid = 0;
  const holderIdentities = new Set<string>();
  for (let index = 0; index < envelope.pids.length; ++index) {
    const pid = envelope.pids[index];
    const holder = envelope.holders[index];
    const startIdentity = holder ? formatWindowsProcessStartIdentity(holder.startIdentity) : null;
    if (!holder || !isPid(pid) || pid <= previousPid || holder.pid !== pid || !startIdentity ||
      holderIdentities.has(`${pid}:${startIdentity}`)) {
      return listenerUnknown('The Windows native observer returned inconsistent listener evidence.');
    }
    holderIdentities.add(`${pid}:${startIdentity}`);
    previousPid = pid;
  }
  return { kind: 'owners', pids: [...envelope.pids] };
}

/** Reads a Windows runtime secret only through the helper's no-reparse, private-DACL boundary. */
export async function readWindowsSecureFile(
  targetPath: string,
  maxBytes: number,
  options: WindowsCoreObservationOptions,
): Promise<WindowsSecureFileRead> {
  if (!isCanonicalAbsoluteWindowsPath(targetPath) || !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 || maxBytes > 512 * 1024) {
    throw new Error('The Windows secure-file request is invalid.');
  }
  const operations = { ...DEFAULT_OPERATIONS, ...options.operations };
  const canonicalBefore = await operations.realpath(targetPath);
  if (!isCanonicalAbsoluteWindowsPath(canonicalBefore)) {
    throw new Error('The Windows secure-file path could not be proven.');
  }
  const result = await runObserver({ maxBytes, mode: 'secure-file', path: targetPath }, options, operations);
  if (!result || result.kind !== 'success' || result.envelope.mode !== 'secure-file') {
    throw new Error('The Windows native observer could not read the secure file.');
  }
  const canonicalAfter = await operations.realpath(targetPath);
  const expected = normalizeWindowsPathIdentity(canonicalBefore);
  if (!isCanonicalAbsoluteWindowsPath(canonicalAfter) ||
    normalizeWindowsPathIdentity(canonicalAfter) !== expected ||
    normalizeWindowsPathIdentity(result.envelope.canonicalPath) !== expected ||
    result.envelope.maxBytes !== maxBytes || result.envelope.size !== result.envelope.bytes.byteLength) {
    throw new Error('The Windows secure-file identity changed during validation.');
  }
  return {
    bytes: Buffer.from(result.envelope.bytes),
    stats: {
      dev: 0,
      ino: 0,
      isFile: () => true,
      isSymbolicLink: () => false,
      mode: 0o600,
      size: result.envelope.size,
      uid: 0,
    },
  };
}
