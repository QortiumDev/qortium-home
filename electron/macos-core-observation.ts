import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { CoreListenerOwnerObservation } from './core-listener-owner.js';
import {
  CORE_NATIVE_OBSERVER_SCHEMA,
  CORE_NATIVE_OBSERVER_SCHEMA_VERSION,
  runCoreNativeObserver,
  type CoreNativeDarwinProcessStartIdentity,
  type CoreNativeObserverEnvelope,
  type CoreNativeObserverArch,
  type CoreNativeObserverRequest,
  type CoreNativeObserverResult,
  type CoreNativeObserverRunnerOptions,
} from './core-native-observer.js';
import type { CoreProcessObservation, CoreProcessSnapshot } from './core-process-observation.js';
import { classifyQortalProcess } from './qortal-process-classification.js';

const BOOT_SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SIGNED_64_BIT = 9_223_372_036_854_775_807n;

export type MacosNativeObserverRunner = (
  request: CoreNativeObserverRequest,
  options: CoreNativeObserverRunnerOptions,
) => Promise<CoreNativeObserverResult>;

export type MacosCoreObservationOperations = {
  getCurrentEffectiveUid(): number | null;
  realpath(targetPath: string): Promise<string>;
  runNativeObserver: MacosNativeObserverRunner;
};

export type MacosCoreObservationOptions = {
  arch: CoreNativeObserverArch;
  helperPath: string;
  operations?: Partial<MacosCoreObservationOperations>;
};

export type ObserveMacosQortalProcessesOptions = MacosCoreObservationOptions & {
  selectedJarPath: string;
};

const DEFAULT_OPERATIONS: MacosCoreObservationOperations = {
  getCurrentEffectiveUid: () => process.geteuid?.() ?? process.getuid?.() ?? null,
  realpath: async (targetPath) => await realpath(targetPath),
  runNativeObserver: runCoreNativeObserver,
};

function processUnknown(reason: string): CoreProcessObservation {
  return { kind: 'unknown', processes: [], reason };
}

function listenerUnknown(reason: string): CoreListenerOwnerObservation {
  return { kind: 'unknown', reason };
}

function isCanonicalAbsolutePosixPath(value: unknown): value is string {
  return typeof value === 'string' && !value.includes('\0') && path.posix.isAbsolute(value) &&
    path.posix.normalize(value) === value;
}

function isEffectiveUid(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 0xffff_ffff;
}

function isPid(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 0x7fff_ffff;
}

function isDarwinStartIdentity(value: unknown): value is CoreNativeDarwinProcessStartIdentity {
  if (!value || typeof value !== 'object') return false;
  const identity = value as Partial<CoreNativeDarwinProcessStartIdentity>;
  if (identity.kind !== 'darwin' || typeof identity.seconds !== 'string' ||
    typeof identity.microseconds !== 'string' || !/^[1-9][0-9]*$/.test(identity.seconds) ||
    !/^(?:0|[1-9][0-9]*)$/.test(identity.microseconds) || identity.seconds.length > 19 ||
    identity.microseconds.length > 6) return false;
  return BigInt(identity.seconds) <= MAX_SIGNED_64_BIT && BigInt(identity.microseconds) <= 999_999n;
}

/** Opaque, collision-resistant process identity for comparisons within Home. */
export function formatMacosProcessStartIdentity(
  bootSessionId: string,
  identity: CoreNativeDarwinProcessStartIdentity,
): string | null {
  if (!BOOT_SESSION_UUID.test(bootSessionId) || !isDarwinStartIdentity(identity)) return null;
  return `darwin:boot=${bootSessionId.toLowerCase()}:seconds=${identity.seconds}:microseconds=${identity.microseconds.padStart(6, '0')}`;
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
  operations: MacosCoreObservationOperations,
) {
  if (!isCanonicalAbsolutePosixPath(selectedJarPath)) throw new Error('invalid-selected-jar-path');
  try {
    return await operations.realpath(selectedJarPath);
  } catch (error) {
    if (!targetMayNotExist(error)) throw error;
  }

  try {
    return path.posix.join(
      await operations.realpath(path.posix.dirname(selectedJarPath)),
      path.posix.basename(selectedJarPath),
    );
  } catch (error) {
    if (!targetMayNotExist(error)) throw error;
    return selectedJarPath;
  }
}

function commonEnvelopeIsValid(
  envelope: CoreNativeObserverEnvelope,
  mode: CoreNativeObserverRequest['mode'],
  options: MacosCoreObservationOptions,
  currentEffectiveUid: number,
) {
  return envelope.schema === CORE_NATIVE_OBSERVER_SCHEMA &&
    envelope.schemaVersion === CORE_NATIVE_OBSERVER_SCHEMA_VERSION && envelope.platform === 'darwin' &&
    envelope.arch === options.arch && envelope.mode === mode &&
    envelope.effectiveUid === currentEffectiveUid && BOOT_SESSION_UUID.test(envelope.bootSessionId);
}

function validatedEffectiveUid(
  operations: MacosCoreObservationOperations,
): number | null {
  try {
    const uid = operations.getCurrentEffectiveUid();
    return isEffectiveUid(uid) ? uid : null;
  } catch {
    return null;
  }
}

async function runObserver(
  request: CoreNativeObserverRequest,
  options: MacosCoreObservationOptions,
  operations: MacosCoreObservationOperations,
) {
  if (!isCanonicalAbsolutePosixPath(options.helperPath) ||
    (options.arch !== 'arm64' && options.arch !== 'x64')) return null;
  try {
    return await operations.runNativeObserver(request, {
      arch: options.arch,
      helperPath: options.helperPath,
      platform: 'darwin',
    });
  } catch {
    return null;
  }
}

/** Maps strongly validated native macOS evidence into the shared process shape. */
export async function observeMacosQortalProcesses(
  options: ObserveMacosQortalProcessesOptions,
): Promise<CoreProcessObservation> {
  const operations = { ...DEFAULT_OPERATIONS, ...options.operations };
  const currentEffectiveUid = validatedEffectiveUid(operations);
  if (currentEffectiveUid === null) {
    return processUnknown('The current effective user ID could not be determined.');
  }

  let canonicalSelectedJarPath: string;
  try {
    canonicalSelectedJarPath = await canonicalizeSelectedJarPath(options.selectedJarPath, operations);
    if (!isCanonicalAbsolutePosixPath(canonicalSelectedJarPath)) throw new Error('invalid-canonical-path');
  } catch {
    return processUnknown('The selected Qortal JAR path could not be proven.');
  }

  const result = await runObserver({ mode: 'processes' }, options, operations);
  if (!result || result.kind !== 'success') {
    return processUnknown('The macOS native observer could not prove process authority.');
  }
  const { envelope } = result;
  if (!commonEnvelopeIsValid(envelope, 'processes', options, currentEffectiveUid) ||
    envelope.mode !== 'processes' || envelope.status !== 'ok') {
    return processUnknown('The macOS native observer returned inconsistent process evidence.');
  }

  const snapshots: CoreProcessSnapshot[] = [];
  let previousPid = 0;
  try {
    for (const candidate of envelope.processes) {
      const startIdentity = formatMacosProcessStartIdentity(envelope.bootSessionId, candidate.startIdentity);
      if (!isPid(candidate.pid) || candidate.pid <= previousPid || !startIdentity ||
        !Array.isArray(candidate.argv) || candidate.argv.length < 1 ||
        candidate.argv.some((argument) => typeof argument !== 'string' || argument.includes('\0')) ||
        !isCanonicalAbsolutePosixPath(candidate.canonicalCwd) ||
        !isCanonicalAbsolutePosixPath(candidate.executablePath)) {
        return processUnknown('The macOS native observer returned inconsistent process evidence.');
      }
      const classification = await classifyQortalProcess({
        argv: candidate.argv,
        canonicalCwd: candidate.canonicalCwd,
        canonicalSelectedJarPath,
        operations,
        platform: 'darwin',
      });
      snapshots.push({
        argv: candidate.argv,
        canonicalCwd: candidate.canonicalCwd,
        classification,
        pid: candidate.pid,
        startIdentity,
      });
      previousPid = candidate.pid;
    }
  } catch {
    return processUnknown('The macOS process paths could not be proven.');
  }
  return { kind: 'observed', processes: snapshots };
}

/** Maps holder-bracketed native macOS listener evidence into the shared owner shape. */
export async function observeMacosCoreListenerOwners(
  port: number,
  options: MacosCoreObservationOptions,
): Promise<CoreListenerOwnerObservation> {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    return listenerUnknown('The listener port is invalid.');
  }
  const operations = { ...DEFAULT_OPERATIONS, ...options.operations };
  const currentEffectiveUid = validatedEffectiveUid(operations);
  if (currentEffectiveUid === null) {
    return listenerUnknown('The current effective user ID could not be determined.');
  }

  const result = await runObserver({ mode: 'listener', port }, options, operations);
  if (!result || result.kind !== 'success') {
    return listenerUnknown('The macOS native observer could not prove listener authority.');
  }
  const { envelope } = result;
  if (!commonEnvelopeIsValid(envelope, 'listener', options, currentEffectiveUid) ||
    envelope.mode !== 'listener' || envelope.port !== port) {
    return listenerUnknown('The macOS native observer returned inconsistent listener evidence.');
  }
  if (envelope.status === 'absent') return { kind: 'absent' };
  if (envelope.status !== 'owners' || envelope.pids.length < 1 ||
    envelope.holders.length !== envelope.pids.length) {
    return listenerUnknown('The macOS native observer returned inconsistent listener evidence.');
  }

  let previousPid = 0;
  const holderIdentities = new Set<string>();
  for (let index = 0; index < envelope.pids.length; ++index) {
    const pid = envelope.pids[index];
    const holder = envelope.holders[index];
    const startIdentity = holder
      ? formatMacosProcessStartIdentity(envelope.bootSessionId, holder.startIdentity)
      : null;
    if (!holder || !isPid(pid) || pid <= previousPid || holder.pid !== pid || !startIdentity ||
      holderIdentities.has(`${pid}:${startIdentity}`) || !Array.isArray(holder.socketIds) ||
      holder.socketIds.length < 1 || holder.socketIds.some((socketId) => typeof socketId !== 'string')) {
      return listenerUnknown('The macOS native observer returned inconsistent listener evidence.');
    }
    holderIdentities.add(`${pid}:${startIdentity}`);
    previousPid = pid;
  }
  return { kind: 'owners', pids: [...envelope.pids] };
}
