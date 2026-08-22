import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { observeCoreListenerOwners } from './core-listener-owner.js';
import {
  observeCurrentUserQortalProcesses,
  type CoreProcessObservation,
  type CoreProcessSnapshot,
} from './core-process-observation.js';
import { readCoreJarIdentityUncached, type CoreJarIdentity } from './core-jar-identity.js';
import { QORTAL_CORE_DESCRIPTOR } from './core-network-descriptor.js';
import {
  QortalCoreManager,
  type QortalJavaSelection,
  type QortalLaunchReceipt,
  type QortalRuntimeAuthority,
  type QortalRuntimeObservation,
  type QortalSpawnOptions,
} from './qortal-core-manager.js';
import type { QortalManagedInstallPaths } from './qortal-managed-install.js';
import { resolveEffectiveQortalSettings } from './qortal-settings-policy.js';

const READY_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 45_000;
const POLL_MS = 500;
const MAX_API_BYTES = 1024 * 1024;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

type SecureStat = {
  dev: number;
  ino: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
  mode: number;
  size: number;
  uid: number;
};

export type QortalCoreRuntimeOperations = {
  fetchValue(url: string, headers?: Record<string, string>): Promise<unknown>;
  getUid(): number | undefined;
  inspectListener(): ReturnType<typeof observeCoreListenerOwners>;
  inspectProcesses(paths: QortalManagedInstallPaths): Promise<CoreProcessObservation>;
  now(): number;
  readSecureFile(targetPath: string, maxBytes: number): Promise<{ bytes: Buffer; stats: SecureStat }>;
  readJarIdentity(targetPath: string): Promise<CoreJarIdentity | null>;
  realpath(targetPath: string): Promise<string>;
  spawn(command: string, args: readonly string[], options: QortalSpawnOptions): Promise<{
    pid: number;
    unref(): void;
  }>;
  wait(delayMs: number): Promise<void>;
};

async function fetchValue(url: string, headers?: Record<string, string>) {
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(5_000) });
  if (response.status !== 200) throw new Error(`Qortal API request failed with HTTP ${response.status}.`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Qortal API returned no response body.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > MAX_API_BYTES) { await reader.cancel(); throw new Error('Qortal API response exceeded its byte limit.'); }
    chunks.push(part.value);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(text) as unknown; } catch { return text; }
}

const DEFAULT_OPERATIONS: QortalCoreRuntimeOperations = {
  fetchValue,
  getUid: () => process.getuid?.(),
  inspectListener: async () => await observeCoreListenerOwners(12391),
  inspectProcesses: async (paths) => await observeCurrentUserQortalProcesses({ selectedJarPath: paths.jarPath }),
  now: Date.now,
  readSecureFile: async (targetPath, maxBytes) => {
    const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
    const handle = await open(targetPath, constants.O_RDONLY | noFollow);
    try {
      const before = await handle.stat() as SecureStat;
      const bytes = Buffer.alloc(maxBytes + 1);
      const read = await handle.read(bytes, 0, bytes.length, 0);
      if (read.bytesRead > maxBytes) throw new Error('The Qortal API key exceeded its byte limit.');
      const after = await handle.stat() as SecureStat;
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) {
        throw new Error('The Qortal API key changed while it was read.');
      }
      return { bytes: bytes.subarray(0, read.bytesRead), stats: after };
    } finally { await handle.close(); }
  },
  readJarIdentity: readCoreJarIdentityUncached,
  realpath,
  spawn: async (command, args, options) => await new Promise((resolve, reject) => {
    const child = spawn(command, [...args], options);
    child.once('error', reject);
    child.once('spawn', () => {
      if (!child.pid) return reject(new Error('Qortal spawn returned no PID.'));
      child.on('error', () => {});
      resolve({ pid: child.pid, unref: () => child.unref() });
    });
  }),
  wait: async (delayMs) => await new Promise((resolve) => setTimeout(resolve, delayMs)),
};

function samePath(left: string, right: string) {
  const normalize = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}

function missingPath(error: unknown) {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function canonicalizeProspectivePath(
  targetPath: string,
  resolvePath: QortalCoreRuntimeOperations['realpath'],
) {
  const suffix: string[] = [];
  let cursor = path.resolve(targetPath);
  while (true) {
    try {
      return path.join(await resolvePath(cursor), ...suffix);
    } catch (error) {
      if (!missingPath(error)) throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) return path.resolve(targetPath);
      suffix.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

function selectedProcess(snapshot: CoreProcessSnapshot, paths: QortalManagedInstallPaths) {
  const classification = snapshot.classification;
  return classification.kind === 'qortal-direct-jar' && classification.selected &&
    samePath(snapshot.canonicalCwd, paths.installPath) &&
    samePath(classification.canonicalJarPath, paths.jarPath) &&
    classification.rawSettingsArgument === 'settings.json';
}

function helperInInstall(snapshot: CoreProcessSnapshot, paths: QortalManagedInstallPaths) {
  return snapshot.classification.kind === 'qortal-updater-helper' && samePath(snapshot.canonicalCwd, paths.installPath);
}

function conflictingQortal(snapshot: CoreProcessSnapshot, paths: QortalManagedInstallPaths) {
  return snapshot.classification.kind === 'qortal-direct-jar' && !selectedProcess(snapshot, paths);
}

function parseBuildTimestamp(value: string) {
  if (!/^\d{14}$/.test(value)) return null;
  const parts = [value.slice(0, 4), value.slice(4, 6), value.slice(6, 8), value.slice(8, 10), value.slice(10, 12), value.slice(12, 14)].map(Number);
  const timestamp = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  const roundTrip = new Date(timestamp);
  return Number.isFinite(timestamp) && roundTrip.getUTCFullYear() === parts[0] &&
    roundTrip.getUTCMonth() === parts[1] - 1 && roundTrip.getUTCDate() === parts[2] &&
    roundTrip.getUTCHours() === parts[3] && roundTrip.getUTCMinutes() === parts[4] &&
    roundTrip.getUTCSeconds() === parts[5] ? Math.floor(timestamp / 1000) : null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validStatus(value: unknown) {
  const status = object(value);
  return !!status && typeof status.isMintingPossible === 'boolean' &&
    typeof status.isSynchronizing === 'boolean' && Number.isSafeInteger(status.height) && Number(status.height) >= 0 &&
    Number.isSafeInteger(status.numberOfConnections) && Number(status.numberOfConnections) >= 0 &&
    Number.isSafeInteger(status.numberOfDataConnections) && Number(status.numberOfDataConnections) >= 0 &&
    (status.syncPercent === undefined || status.syncPercent === null ||
      (Number.isSafeInteger(status.syncPercent) && Number(status.syncPercent) >= 0 && Number(status.syncPercent) <= 100));
}

function validInfo(value: unknown, identity: CoreJarIdentity) {
  const info = object(value);
  const expectedTimestamp = parseBuildTimestamp(identity.buildTimestamp ?? '');
  return !!info && info.buildVersion === `qortal-${identity.buildVersion}` &&
    expectedTimestamp !== null && info.buildTimestamp === expectedTimestamp && info.isTestNet === false &&
    typeof info.nodeId === 'string' && info.nodeId.length > 0 &&
    typeof info.type === 'string' && ['full', 'lite', 'toponly'].includes(info.type.toLowerCase());
}

function authorityFor(process: CoreProcessSnapshot, readiness: QortalRuntimeAuthority['readiness']): QortalRuntimeAuthority {
  const classification = process.classification;
  if (classification.kind !== 'qortal-direct-jar') throw new Error('Qortal process classification changed unexpectedly.');
  return { canonicalCwd: process.canonicalCwd, canonicalJarPath: classification.canonicalJarPath,
    listenerPort: 12391, owner: 'home-managed', pid: process.pid,
    rawSettingsArgument: classification.rawSettingsArgument ?? '', readiness,
    startIdentity: process.startIdentity };
}

function sameAuthority(authority: QortalRuntimeAuthority, process: CoreProcessSnapshot) {
  return process.pid === authority.pid && process.startIdentity === authority.startIdentity &&
    selectedProcess(process, { installPath: authority.canonicalCwd, jarPath: authority.canonicalJarPath } as QortalManagedInstallPaths);
}

export function createQortalCoreRuntimeOperations(
  paths: QortalManagedInstallPaths,
  resolveJava: () => Promise<QortalJavaSelection | null>,
  overrides: Partial<QortalCoreRuntimeOperations> = {},
) {
  const operations = { ...DEFAULT_OPERATIONS, ...overrides };

  const observeOnce = async (probeApi: boolean): Promise<QortalRuntimeObservation> => {
    let canonicalPaths: QortalManagedInstallPaths;
    try {
      const [installPath, jarPath] = await Promise.all([
        canonicalizeProspectivePath(paths.installPath, operations.realpath),
        canonicalizeProspectivePath(paths.jarPath, operations.realpath),
      ]);
      canonicalPaths = { ...paths, installPath, jarPath };
    } catch {
      return { reason: 'The managed Qortal runtime paths could not be proven.', state: 'unknown' };
    }
    const processes = await operations.inspectProcesses(paths);
    if (processes.kind === 'unknown') return { reason: processes.reason, state: 'unknown' };
    const listener = await operations.inspectListener();
    const processConfirmation = await operations.inspectProcesses(paths);
    if (processConfirmation.kind === 'unknown') return { reason: processConfirmation.reason, state: 'unknown' };
    if (listener.kind === 'unknown') return { reason: listener.reason, state: 'unknown' };
    if (
      processes.processes.some((item) => helperInInstall(item, canonicalPaths)) ||
      processConfirmation.processes.some((item) => helperInInstall(item, canonicalPaths))
    ) {
      return { reason: 'A Qortal updater/restart helper is active in the managed install.', state: 'unknown' };
    }
    const selected = processes.processes.filter((item) => selectedProcess(item, canonicalPaths));
    const confirmedSelected = processConfirmation.processes.filter((item) => selectedProcess(item, canonicalPaths));
    if (selected.length !== confirmedSelected.length || selected.some((item) =>
      !confirmedSelected.some((confirmed) => confirmed.pid === item.pid && confirmed.startIdentity === item.startIdentity))) {
      return { reason: 'Qortal process authority changed during listener observation.', state: 'unknown' };
    }
    const otherQortal = processes.processes.some((item) => conflictingQortal(item, canonicalPaths)) ||
      processConfirmation.processes.some((item) => conflictingQortal(item, canonicalPaths));
    if (selected.length === 0) {
      if (listener.kind !== 'absent' || otherQortal) return { reason: 'Qortal process/listener ownership is external or ambiguous.', state: 'unknown' };
      return { state: 'stopped' };
    }
    if (otherQortal) return { reason: 'A competing Qortal process was observed.', state: 'unknown' };
    if (selected.length !== 1) return { reason: 'Multiple managed Qortal processes were observed.', state: 'unknown' };
    const process = selected[0];
    if (listener.kind === 'absent') return { authority: authorityFor(process, 'not-ready'), state: 'running' };
    if (listener.pids.length !== 1 || listener.pids[0] !== process.pid) return { reason: 'Port 12391 is not owned only by the managed Qortal PID.', state: 'unknown' };
    if (!probeApi) return { authority: authorityFor(process, 'unknown'), state: 'running' };
    const identity = await operations.readJarIdentity(paths.jarPath);
    if (!identity) return { reason: 'The managed Qortal JAR identity is unavailable.', state: 'unknown' };
    try {
      const [info, status] = await Promise.all([
        operations.fetchValue(`${QORTAL_CORE_DESCRIPTOR.localApi.url}/admin/info`),
        operations.fetchValue(`${QORTAL_CORE_DESCRIPTOR.localApi.url}/admin/status`),
      ]);
      if (!validInfo(info, identity) || !validStatus(status)) return { reason: 'Qortal API identity/readiness did not match the managed runtime.', state: 'unknown' };
    } catch {
      return { authority: authorityFor(process, 'not-ready'), state: 'running' };
    }
    const afterProcesses = await operations.inspectProcesses(paths);
    const afterListener = await operations.inspectListener();
    const finalProcesses = await operations.inspectProcesses(paths);
    const selectedAfter = afterProcesses.kind === 'observed'
      ? afterProcesses.processes.filter((item) => selectedProcess(item, canonicalPaths))
      : [];
    if (afterProcesses.kind !== 'observed' || finalProcesses.kind !== 'observed' || afterListener.kind !== 'owners' ||
      afterListener.pids.length !== 1 || afterListener.pids[0] !== process.pid ||
      selectedAfter.length !== 1 || !sameAuthority(authorityFor(process, 'ready'), selectedAfter[0]) ||
      finalProcesses.processes.filter((item) => selectedProcess(item, canonicalPaths)).length !== 1 ||
      !finalProcesses.processes.some((item) => sameAuthority(authorityFor(process, 'ready'), item)) ||
      afterProcesses.processes.some((item) => helperInInstall(item, canonicalPaths)) ||
      finalProcesses.processes.some((item) => helperInInstall(item, canonicalPaths)) ||
      afterProcesses.processes.some((item) => conflictingQortal(item, canonicalPaths)) ||
      finalProcesses.processes.some((item) => conflictingQortal(item, canonicalPaths))) {
      return { reason: 'Qortal runtime authority changed during API validation.', state: 'unknown' };
    }
    return { authority: authorityFor(process, 'ready'), state: 'running' };
  };

  const inspectRuntime = async () => {
    const first = await observeOnce(true);
    if (first.state !== 'stopped') return first;
    const second = await observeOnce(false);
    return second.state === 'stopped' ? second : { reason: 'Qortal runtime changed during stopped-state confirmation.', state: 'unknown' } as QortalRuntimeObservation;
  };

  const waitUntil = async (predicate: (runtime: QortalRuntimeObservation) => boolean, timeoutMs: number) => {
    const deadline = operations.now() + timeoutMs;
    let runtime = await inspectRuntime();
    while (!predicate(runtime) && operations.now() < deadline) {
      await operations.wait(POLL_MS);
      runtime = await inspectRuntime();
    }
    return runtime;
  };

  return {
    inspectRuntime: async () => await inspectRuntime(),
    readApiKey: async (_paths: QortalManagedInstallPaths, authority: QortalRuntimeAuthority) => {
      const current = await inspectRuntime();
      if (current.state !== 'running' || current.authority.pid !== authority.pid || current.authority.startIdentity !== authority.startIdentity) return null;
      const effective = await resolveEffectiveQortalSettings('settings.json', { cwd: paths.installPath });
      if (effective.kind !== 'resolved') return null;
      const configured = effective.settings.apiKeyPath;
      if (configured !== undefined && (typeof configured !== 'string' || !configured.trim())) return null;
      const directory = path.resolve(paths.installPath, typeof configured === 'string' ? configured : '.');
      let canonicalDirectory: string;
      try { canonicalDirectory = await operations.realpath(directory); } catch { return null; }
      const keyPath = path.join(canonicalDirectory, 'apikey.txt');
      try {
        const secure = await operations.readSecureFile(keyPath, 128);
        const stats = secure.stats;
        const uid = operations.getUid();
        if (!stats.isFile() || stats.isSymbolicLink() || (process.platform !== 'win32' &&
          ((stats.mode & 0o777) !== 0o600 || (uid !== undefined && stats.uid !== uid)))) return null;
        const key = secure.bytes.toString('utf8');
        return decodeBase58(key)?.length === 16 ? key : null;
      } catch { return null; }
    },
    readLiveAutoUpdate: async () => {
      const before = await inspectRuntime();
      if (before.state !== 'running') return { authority: 'unknown' };
      const value = await operations.fetchValue(`${QORTAL_CORE_DESCRIPTOR.localApi.url}/admin/settings/autoUpdateEnabled`);
      const after = await inspectRuntime();
      return after.state === 'running' && after.authority.pid === before.authority.pid &&
        after.authority.startIdentity === before.authority.startIdentity ? value : { authority: 'changed' };
    },
    resolveJava: async () => await resolveJava(),
    spawnProcess: async (command: string, args: readonly string[], options: QortalSpawnOptions) => {
      const child = await operations.spawn(command, args, options);
      const runtime = await waitUntil((value) => value.state === 'running' && value.authority.pid === child.pid, 5_000);
      if (runtime.state !== 'running' || runtime.authority.pid !== child.pid) throw new Error('The spawned Qortal PID could not be assigned a stable start identity.');
      return { pid: child.pid, startIdentity: runtime.authority.startIdentity, unref: child.unref };
    },
    stopWithApiKey: async ({ apiKey, expectedAuthority, url }: { apiKey: string; expectedAuthority: QortalRuntimeAuthority; url: string }) => {
      const headers = { 'X-API-KEY': apiKey };
      const before = await inspectRuntime();
      if (before.state !== 'running' || before.authority.pid !== expectedAuthority.pid || before.authority.startIdentity !== expectedAuthority.startIdentity) throw new Error('Qortal authority changed before API-key validation.');
      const [apiKeyPath, bypass, keyValid] = await Promise.all([
        operations.fetchValue(`${QORTAL_CORE_DESCRIPTOR.localApi.url}/admin/settings/apiKeyPath`),
        operations.fetchValue(`${QORTAL_CORE_DESCRIPTOR.localApi.url}/admin/settings/localAuthBypassEnabled`),
        operations.fetchValue(`${QORTAL_CORE_DESCRIPTOR.localApi.url}/admin/apikey/test`, headers),
      ]);
      const effective = await resolveEffectiveQortalSettings('settings.json', { cwd: paths.installPath });
      const configured = effective.kind === 'resolved' && typeof effective.settings.apiKeyPath === 'string'
        ? effective.settings.apiKeyPath : '.';
      const configuredDirectory = await operations.realpath(path.resolve(paths.installPath, configured));
      if (typeof apiKeyPath !== 'string' || !samePath(path.resolve(paths.installPath, apiKeyPath || '.'), configuredDirectory) || bypass !== false || keyValid !== true) throw new Error('The Qortal API key is not bound to the managed runtime.');
      const final = await inspectRuntime();
      if (final.state !== 'running' || final.authority.pid !== expectedAuthority.pid || final.authority.startIdentity !== expectedAuthority.startIdentity) throw new Error('Qortal authority changed before stop.');
      if (await operations.fetchValue(url, headers) !== true) throw new Error('Qortal did not accept the stop request.');
    },
    waitForReadiness: async (_paths: QortalManagedInstallPaths, receipt: QortalLaunchReceipt) => await waitUntil(
      (runtime) => runtime.state === 'running' && runtime.authority.readiness === 'ready' && runtime.authority.pid === receipt.pid && runtime.authority.startIdentity === receipt.startIdentity,
      READY_TIMEOUT_MS,
    ),
    waitForStopped: async (_paths: QortalManagedInstallPaths, authority: QortalRuntimeAuthority) => await waitUntil(
      (runtime) => runtime.state === 'stopped' || (runtime.state === 'running' && (runtime.authority.pid !== authority.pid || runtime.authority.startIdentity !== authority.startIdentity)),
      STOP_TIMEOUT_MS,
    ),
  };
}

function decodeBase58(value: string) {
  if (!value) return null;
  let numeric = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) return null;
    numeric = numeric * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (numeric > 0n) {
    bytes.push(Number(numeric & 0xffn));
    numeric >>= 8n;
  }
  bytes.reverse();
  let leadingZeroes = 0;
  while (value[leadingZeroes] === '1') leadingZeroes += 1;
  return Uint8Array.from([...Array<number>(leadingZeroes).fill(0), ...bytes]);
}

export function createProductionQortalCoreManager(
  config: ConstructorParameters<typeof QortalCoreManager>[0],
  resolveJava: () => Promise<QortalJavaSelection | null>,
  overrides: Partial<QortalCoreRuntimeOperations> = {},
) {
  return new QortalCoreManager(config, createQortalCoreRuntimeOperations(config.paths, resolveJava, overrides));
}
