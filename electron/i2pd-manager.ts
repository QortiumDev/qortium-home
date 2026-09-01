import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, open, rename, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {
  activateTrustedI2pdGeneration,
  installPinnedI2pd,
  readI2pdLegacyManagedInstall,
  readTrustedI2pdManagedInstall,
  type I2pdManagedInstall,
} from './i2pd-managed-install.js';
import {
  observeManagedI2pdProcess,
  type I2pdManagedProcessIdentity,
} from './i2pd-managed-process.js';
import {
  classifyI2pdRelease,
  getPinnedI2pdRelease,
  getTrustedI2pdRelease,
  type I2pdPinnedRelease,
} from './i2pd-release-policy.js';
import { renderManagedI2pdConfig } from './i2pd-config.js';
import { runI2pdUpdateTransaction } from './i2pd-update-transaction.js';
import {
  I2PD_SAM_MAX_REPLY_BYTES,
  isValidI2pdSamHelloReplyLine,
} from './i2pd-sam-protocol.js';
import {
  prepareManagedLongLivedCommand,
  sanitizeManagedChildEnvironment,
} from './managed-child-process.js';

// Desktop-only managed i2pd. The immutable installer owns release provenance
// and generation validation. On Linux, this module can also recover authority
// over the exact managed process a previous Home session launched. A SAM router
// that cannot pass those strict process-identity checks remains external and is
// never signalled or identified across the renderer boundary.

const I2PD_DATA_DIR = 'qortium-i2pd';
const DEFAULT_SAM_HOST = '127.0.0.1';
const DEFAULT_SAM_PORT = 7656;
const I2PD_BANDWIDTH_CLASS = 'X';

const SAM_PROBE_TIMEOUT_MS = 2_000;
const START_TIMEOUT_MS = 60_000;
const START_POLL_INTERVAL_MS = 1_000;
const STOP_TIMEOUT_MS = 10_000;

export type I2pdProgressAction =
  | 'checking'
  | 'downloading'
  | 'extracting'
  | 'starting'
  | 'stopping'
  | 'idle';

export type I2pdProgress = {
  action: I2pdProgressAction;
  kind: 'info' | 'success' | 'error';
  message: string;
  percent?: number;
};

export type I2pdMode = 'managed' | 'external' | 'none';

// The path fields remain for the legacy renderer contract, but are always
// null. Host filesystem and process details must not cross this boundary.
export type I2pdStatus = {
  supported: boolean;
  installed: boolean;
  version: string | null;
  running: boolean;
  mode: I2pdMode;
  samHost: string;
  samPort: number;
  binaryPath: string | null;
  externalBinaryPath: string | null;
};

export type I2pdMaintenanceInspection = Readonly<{
  install: 'installed' | 'legacy' | 'missing' | 'unknown';
  installedVersion: string | null;
  managedProcessActive: boolean;
  maintenance: 'install' | 'migrate' | 'none' | 'start' | 'unavailable' | 'update';
  router:
    | 'external-running'
    | 'legacy-stopped'
    | 'managed-running'
    | 'managed-stopped'
    | 'missing'
    | 'unsupported'
    | 'unknown';
  supported: boolean;
}>;

let managedChild: ChildProcess | null = null;
// Immutable snapshot of the exact strict generation used by managedChild. It
// keeps status truthful if current.json is changed while that child is alive.
let managedChildInstall: I2pdManagedInstall | null = null;
let legacyI2pdRendererEventsEnabled = true;
let mutationTail: Promise<void> = Promise.resolve();
let installInFlight: Promise<I2pdStatus> | null = null;
let appShutdownRequested = false;

export function disableLegacyI2pdRendererEvents() {
  legacyI2pdRendererEventsEnabled = false;
}

/**
 * Home 2's own progress subscriber.
 *
 * Registered by the transport bridge rather than imported here, so this module
 * does not depend on Home 2. Same arrangement core-manager uses, and for the
 * same reason: Home 2 calls disableLegacyI2pdRendererEvents() at startup, so
 * anything behind that flag is invisible to it.
 */
let homeV2I2pdProgressListener: ((progress: I2pdProgress) => void) | null = null;

export function setHomeV2I2pdProgressListener(
  listener: ((progress: I2pdProgress) => void) | null,
) {
  homeV2I2pdProgressListener = listener;
}

function publishProgress(progress: I2pdProgress) {
  // Home 2 first, and deliberately NOT behind the legacy flag. Home 2 disables
  // the 1.x renderer events at startup; before this, that also silenced its own
  // router progress, so installing i2pd showed nothing at all.
  if (homeV2I2pdProgressListener) {
    try {
      homeV2I2pdProgressListener(progress);
    } catch {
      // A broken subscriber must never break an install.
    }
  }

  if (!legacyI2pdRendererEventsEnabled) return;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('i2pd:progress', progress);
    }
  }
}

function getI2pdBasePath() {
  return path.join(app.getPath('appData'), I2PD_DATA_DIR);
}

function managedInstallInput() {
  return {
    arch: process.arch,
    basePath: getI2pdBasePath(),
    platform: process.platform,
  } as const;
}

function managedRuntimePaths(installed: I2pdManagedInstall) {
  const runtimePath = installed.paths.runtimePath;
  return {
    confPath: path.join(runtimePath, 'i2pd.conf'),
    pidPath: path.join(runtimePath, 'i2pd.pid'),
    runtimePath,
  } as const;
}

async function observeInstalledI2pd(installed: I2pdManagedInstall) {
  // Linux procfs is the only process-observation backend strong enough to
  // recover signal authority. Other platforms retain the prior stopped versus
  // external status behaviour and never adopt a process across Home sessions.
  if (process.platform !== 'linux') return { kind: 'absent' as const };
  return await observeManagedI2pdProcess({
    binaryPath: installed.binaryPath,
    ...managedRuntimePaths(installed),
  });
}

/**
 * Opens the folder holding the MANAGED i2pd router, the same way #448 does for
 * the Core install: the path is resolved and used entirely inside the main
 * process, and the caller learns only whether a folder was opened. Revealing a
 * folder needs no path in the renderer, so this does not reopen the redaction
 * question.
 *
 * Managed only, and that is a limit on what Home KNOWS rather than caution. An
 * external router is found by connecting to a SAM port; Home never learns which
 * executable is behind it, and would have to inspect a process it did not start
 * to find out. There is nothing to open, so the control is simply unavailable.
 */
export async function revealHomeV2ManagedI2pd(): Promise<boolean> {
  const install = await readInstalledI2pd();
  if (!install) return false;
  const target = existsSync(install.binaryPath)
    ? install.binaryPath
    : install.paths.basePath;
  if (!existsSync(target)) return false;
  shell.showItemInFolder(target);
  return true;
}

async function readInstalledI2pd(): Promise<I2pdManagedInstall | null> {
  return await readTrustedI2pdManagedInstall(managedInstallInput());
}

async function readLegacyInstalledI2pd() {
  return await readI2pdLegacyManagedInstall(managedInstallInput());
}

function isLiveChild(child: ChildProcess | null): child is ChildProcess {
  return child !== null && child.exitCode === null && child.signalCode === null;
}

function relinquishManagedChild(child: ChildProcess) {
  if (managedChild !== child) return;
  managedChild = null;
  managedChildInstall = null;
}

function currentManagedChild(): ChildProcess | null {
  if (!managedChild) return null;
  if (isLiveChild(managedChild)) return managedChild;
  relinquishManagedChild(managedChild);
  return null;
}

function runMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(operation, operation);
  mutationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function installedMatchesPinnedRelease(
  installed: I2pdManagedInstall,
  release: I2pdPinnedRelease,
) {
  const { record } = installed;
  return record.version === release.version &&
    record.target === release.target &&
    record.archiveType === release.archiveType &&
    record.assetName === release.assetName &&
    record.archiveSha256 === release.sha256 &&
    record.archiveSize === release.size &&
    record.binaryName === release.binaryName;
}

async function readTrustedInstalledI2pd(): Promise<I2pdManagedInstall | null> {
  if (!getPinnedI2pdRelease(process.platform, process.arch)) {
    throw new Error('Managed i2pd is unavailable on this platform.');
  }
  const installed = await readInstalledI2pd();
  if (!installed) return null;
  const release = getTrustedI2pdRelease(
    installed.record.version,
    process.platform,
    process.arch,
  );
  if (!release || !installedMatchesPinnedRelease(installed, release)) {
    throw new Error('The managed i2pd installation is not a trusted release.');
  }
  return installed;
}

function sameInstalledGeneration(
  left: I2pdManagedInstall,
  right: I2pdManagedInstall,
) {
  return left.binaryPath === right.binaryPath &&
    left.generationPath === right.generationPath &&
    left.record.generation === right.record.generation &&
    left.record.binarySha256 === right.record.binarySha256 &&
    left.record.binarySize === right.record.binarySize &&
    left.record.installedAt === right.record.installedAt;
}

// A successful TCP connection is insufficient: another local service may own
// the port. Prove a SAM v3 endpoint with a bounded HELLO exchange instead.
function probeSamBridge(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: DEFAULT_SAM_HOST, port: DEFAULT_SAM_PORT });
    let settled = false;
    let received = Buffer.alloc(0);

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(SAM_PROBE_TIMEOUT_MS);
    socket.setNoDelay(true);
    socket.once('connect', () => {
      socket.write('HELLO VERSION MIN=3.0 MAX=3.3\n');
    });
    socket.on('data', (chunk: Buffer) => {
      if (received.length + chunk.length > I2PD_SAM_MAX_REPLY_BYTES) {
        finish(false);
        return;
      }
      received = Buffer.concat([received, chunk]);
      const newline = received.indexOf(0x0a);
      if (newline === -1) return;
      finish(isValidI2pdSamHelloReplyLine(received.subarray(0, newline)));
    });
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.once('end', () => finish(false));
    socket.once('close', () => finish(false));
  });
}

async function writeI2pdConf(installed: I2pdManagedInstall) {
  const { confPath, runtimePath } = managedRuntimePaths(installed);
  const tempPath = path.join(
    runtimePath,
    `.i2pd.conf.${randomBytes(16).toString('hex')}.tmp`,
  );
  const release = getTrustedI2pdRelease(
    installed.record.version,
    process.platform,
    process.arch,
  );
  if (!release || !installedMatchesPinnedRelease(installed, release)) {
    throw new Error('The managed i2pd configuration target is not trusted.');
  }
  const conf = renderManagedI2pdConfig(release, {
    bandwidthClass: I2PD_BANDWIDTH_CLASS,
    samHost: DEFAULT_SAM_HOST,
    samPort: DEFAULT_SAM_PORT,
  });

  let handle;
  try {
    handle = await open(tempPath, 'wx', 0o600);
    await handle.writeFile(conf, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (process.platform !== 'win32') await chmod(tempPath, 0o600);
    await rename(tempPath, confPath);
    if (process.platform !== 'win32') await chmod(confPath, 0o600);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function launchI2pd(installed: I2pdManagedInstall) {
  const { confPath, runtimePath } = managedRuntimePaths(installed);
  const launch = prepareManagedLongLivedCommand(installed.binaryPath, [
    `--datadir=${runtimePath}`,
    `--conf=${confPath}`,
  ]);
  const child = spawn(launch.command, [...launch.args], {
    cwd: runtimePath,
    env: sanitizeManagedChildEnvironment(),
    windowsHide: true,
    detached: true,
    stdio: 'ignore',
  });

  managedChild = child;
  managedChildInstall = installed;
  // An error event is not proof of exit (it can also report a failed signal).
  // Keep the listener to prevent an unhandled event, but relinquish authority
  // only on the process lifecycle's exit/close proof.
  child.once('error', () => undefined);
  child.once('exit', () => relinquishManagedChild(child));
  child.once('close', () => relinquishManagedChild(child));
  child.unref();
}

async function prepareAndLaunchManagedI2pd() {
  if (appShutdownRequested) throw new Error('Home is shutting down.');
  if (currentManagedChild()) return;
  if (await probeSamBridge()) return;

  const selected = await readTrustedInstalledI2pd();
  if (!selected) throw new Error('Install i2pd before starting it.');
  if ((await observeInstalledI2pd(selected)).kind === 'owned') return;
  await writeI2pdConf(selected);

  // Recheck the collision after filesystem work, then re-read and re-hash the
  // exact active generation as the final asynchronous authority gate before
  // the synchronous command construction and spawn.
  if (await probeSamBridge()) return;
  const revalidated = await readTrustedInstalledI2pd();
  if (!revalidated || !sameInstalledGeneration(selected, revalidated)) {
    throw new Error('The managed i2pd installation changed before startup.');
  }
  const observation = await observeInstalledI2pd(revalidated);
  if (observation.kind === 'owned') return;
  if (observation.kind === 'unknown') {
    throw new Error('Home could not safely determine whether managed i2pd is already running.');
  }
  if (appShutdownRequested) throw new Error('Home is shutting down.');
  launchI2pd(revalidated);
}

async function inspectMaintenanceImpl(): Promise<I2pdMaintenanceInspection> {
  const release = getPinnedI2pdRelease(process.platform, process.arch);
  if (!release) {
    return {
      install: 'missing',
      installedVersion: null,
      managedProcessActive: false,
      maintenance: 'unavailable',
      router: 'unsupported',
      supported: false,
    };
  }

  let child = currentManagedChild();
  const samReady = await probeSamBridge();
  // The child can exit while the bounded protocol probe is in flight.
  child = currentManagedChild();
  let installed: I2pdManagedInstall | null;
  try {
    installed = await readInstalledI2pd();
  } catch {
    return {
      install: 'unknown',
      installedVersion: child ? managedChildInstall?.record.version ?? null : null,
      managedProcessActive: child !== null,
      maintenance: 'unavailable',
      router: child
        ? samReady ? 'managed-running' : 'managed-stopped'
        : samReady ? 'external-running' : 'unknown',
      supported: true,
    };
  }

  let adoptedProcess: I2pdManagedProcessIdentity | null = null;
  let adoptionUnknown = false;
  if (!child && installed) {
    const observation = await observeInstalledI2pd(installed);
    if (observation.kind === 'owned') adoptedProcess = observation.process;
    adoptionUnknown = observation.kind === 'unknown';
  }
  const managedOwned = child !== null || adoptedProcess !== null;
  const reportedVersion = child
    ? managedChildInstall?.record.version ?? null
    : installed?.record.version ?? null;
  if (!installed) {
    if (!managedOwned) {
      const legacy = await readLegacyInstalledI2pd();
      if (legacy) {
        return {
          install: 'legacy',
          installedVersion: legacy.version,
          managedProcessActive: false,
          maintenance: samReady ? 'none' : 'migrate',
          router: samReady ? 'external-running' : 'legacy-stopped',
          supported: true,
        };
      }
    }
    return {
      install: managedOwned ? 'unknown' : 'missing',
      installedVersion: reportedVersion,
      managedProcessActive: managedOwned,
      maintenance: managedOwned ? 'unavailable' : 'install',
      router: managedOwned
        ? samReady ? 'managed-running' : 'managed-stopped'
        : samReady ? 'external-running' : 'missing',
      supported: true,
    };
  }

  const decision = classifyI2pdRelease(
    installed.record.version,
    process.platform,
    process.arch,
  );
  const current = decision.action === 'none' &&
    decision.reason === 'installed-current' &&
    installedMatchesPinnedRelease(installed, release);
  const liveGenerationStillCurrent = !child || (
    managedChildInstall !== null && sameInstalledGeneration(managedChildInstall, installed)
  );
  const maintenance = !liveGenerationStillCurrent
    ? 'unavailable' as const
    : decision.action === 'update'
      ? 'update' as const
      : current
        ? samReady ? 'none' as const : 'start' as const
        : 'unavailable' as const;

  return {
    install: 'installed',
    installedVersion: reportedVersion,
    managedProcessActive: managedOwned,
    maintenance,
    router: managedOwned
      ? samReady ? 'managed-running' : 'managed-stopped'
      : adoptionUnknown && !samReady ? 'unknown'
        : samReady ? 'external-running' : 'managed-stopped',
    supported: true,
  };
}

export async function inspectMaintenance(): Promise<I2pdMaintenanceInspection> {
  try {
    return await inspectMaintenanceImpl();
  } catch {
    const supported = getPinnedI2pdRelease(process.platform, process.arch) !== null;
    if (!supported) {
      return {
        install: 'missing',
        installedVersion: null,
        managedProcessActive: false,
        maintenance: 'unavailable',
        router: 'unsupported',
        supported: false,
      };
    }
    const managedOwned = currentManagedChild() !== null;
    return {
      install: 'unknown',
      installedVersion: managedOwned ? managedChildInstall?.record.version ?? null : null,
      managedProcessActive: managedOwned,
      maintenance: 'unavailable',
      router: managedOwned ? 'managed-stopped' : 'unknown',
      supported: true,
    };
  }
}

export async function getStatus(): Promise<I2pdStatus> {
  const inspection = await inspectMaintenance();
  const managedOwned = inspection.managedProcessActive;
  const mode: I2pdMode = managedOwned
    ? 'managed'
    : inspection.router === 'external-running'
      ? 'external'
      : 'none';
  return {
    supported: inspection.supported,
    installed: inspection.install === 'installed',
    version: inspection.installedVersion,
    running: inspection.router === 'managed-running' ||
      inspection.router === 'external-running',
    mode,
    samHost: DEFAULT_SAM_HOST,
    samPort: DEFAULT_SAM_PORT,
    binaryPath: null,
    externalBinaryPath: null,
  };
}

async function installImpl(): Promise<I2pdStatus> {
  if (!getPinnedI2pdRelease(process.platform, process.arch)) {
    throw new Error('Managed i2pd is unavailable on this platform.');
  }
  const installed = await readInstalledI2pd();
  const adopted = installed ? await observeInstalledI2pd(installed) : { kind: 'absent' as const };
  if (currentManagedChild() || adopted.kind === 'owned') {
    throw new Error('Stop the managed i2pd router before installing an update.');
  }
  if (adopted.kind === 'unknown') {
    throw new Error('Home could not safely determine whether managed i2pd is running.');
  }
  publishProgress({
    action: 'checking',
    kind: 'info',
    message: 'Checking the pinned i2pd release.',
    percent: 2,
  });
  publishProgress({
    action: 'downloading',
    kind: 'info',
    message: 'Downloading verified i2pd.',
    percent: 5,
  });
  await installPinnedI2pd(managedInstallInput());
  publishProgress({
    action: 'idle',
    kind: 'success',
    message: 'i2pd installed.',
    percent: 100,
  });
  return await getStatus();
}

export function install(): Promise<I2pdStatus> {
  if (installInFlight) return installInFlight;
  installInFlight = runMutation(installImpl);
  void installInFlight.finally(() => {
    installInFlight = null;
  }).catch(() => undefined);
  return installInFlight;
}

async function updateAndStartImpl(restartPreviousOnFailure: boolean): Promise<I2pdStatus> {
  if (typeof restartPreviousOnFailure !== 'boolean') {
    throw new Error('The i2pd rollback runtime state was invalid.');
  }
  const previous = await readTrustedInstalledI2pd();
  if (!previous) throw new Error('Install i2pd before updating it.');
  const decision = classifyI2pdRelease(
    previous.record.version,
    process.platform,
    process.arch,
  );
  if (decision.action !== 'update') {
    throw new Error('A strictly newer trusted i2pd release is not available.');
  }
  const observation = await observeInstalledI2pd(previous);
  if (currentManagedChild() || observation.kind === 'owned') {
    throw new Error('Stop the managed i2pd router before installing an update.');
  }
  if (observation.kind === 'unknown') {
    throw new Error('Home could not safely determine whether managed i2pd is running.');
  }

  return await runI2pdUpdateTransaction({
    installAndStart: async () => {
      await installPinnedI2pd(managedInstallInput());
      const status = await startImpl(true);
      if (!status.running || status.mode !== 'managed' ||
        status.version !== decision.release.version) {
        throw new Error('The updated i2pd router did not become the managed SAM service.');
      }
      return status;
    },
    restartPrevious: async () => {
      const restored = await startImpl(true);
      if (!restored.running || restored.mode !== 'managed' ||
        restored.version !== previous.record.version) {
        throw new Error('The previous i2pd router did not recover after rollback.');
      }
    },
    restartPreviousOnFailure,
    restorePrevious: async () => {
      await activateTrustedI2pdGeneration(managedInstallInput(), previous);
    },
    stopCandidate: async () => {
      await stopImpl();
    },
  });
}

export function updateAndStart(restartPreviousOnFailure: boolean): Promise<I2pdStatus> {
  return runMutation(() => updateAndStartImpl(restartPreviousOnFailure));
}

async function waitForSamReady(child: ChildProcess): Promise<I2pdStatus> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (currentManagedChild() !== child) {
      throw new Error('i2pd exited during startup.');
    }
    if (await probeSamBridge()) {
      publishProgress({
        action: 'idle',
        kind: 'success',
        message: 'i2pd is running.',
        percent: 100,
      });
      return await getStatus();
    }
    await new Promise((resolve) => setTimeout(resolve, START_POLL_INTERVAL_MS));
  }
  const stopped = await terminateManagedChild(child);
  throw new Error(stopped
    ? 'i2pd did not complete its SAM handshake in time and was stopped.'
    : 'i2pd did not complete its SAM handshake in time and remains supervised.');
}

async function startImpl(waitForReady: boolean): Promise<I2pdStatus> {
  if (appShutdownRequested) throw new Error('Home is shutting down.');
  const existing = currentManagedChild();
  if (existing) {
    return waitForReady ? await waitForSamReady(existing) : await getStatus();
  }
  if (await probeSamBridge()) return await getStatus();
  const installed = await readTrustedInstalledI2pd();
  if (installed) {
    const observation = await observeInstalledI2pd(installed);
    if (observation.kind === 'owned') {
      return waitForReady
        ? await waitForObservedSamReady(installed, observation.process)
        : await getStatus();
    }
    if (observation.kind === 'unknown') {
      throw new Error('Home could not safely determine whether managed i2pd is already running.');
    }
  }
  publishProgress({
    action: 'starting',
    kind: 'info',
    message: 'Starting i2pd.',
    percent: 10,
  });
  await prepareAndLaunchManagedI2pd();
  const child = currentManagedChild();
  if (!child || !waitForReady) return await getStatus();
  return await waitForSamReady(child);
}

export function start(): Promise<I2pdStatus> {
  return runMutation(() => startImpl(true));
}

async function waitForObservedSamReady(
  installed: I2pdManagedInstall,
  expected: I2pdManagedProcessIdentity,
): Promise<I2pdStatus> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const observation = await observeInstalledI2pd(installed);
    if (observation.kind !== 'owned' ||
      observation.process.pid !== expected.pid ||
      observation.process.startIdentity !== expected.startIdentity) {
      throw new Error('Managed i2pd exited or changed identity during startup.');
    }
    if (await probeSamBridge()) return await getStatus();
    await new Promise((resolve) => setTimeout(resolve, START_POLL_INTERVAL_MS));
  }
  throw new Error('Managed i2pd did not complete its SAM handshake in time.');
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (!isLiveChild(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('close', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(!isLiveChild(child)), timeoutMs);
    child.once('exit', onExit);
    child.once('close', onExit);
    if (!isLiveChild(child)) finish(true);
  });
}

async function terminateManagedChild(child: ChildProcess) {
  if (!isLiveChild(child)) {
    relinquishManagedChild(child);
    return true;
  }
  const signalSent = child.kill('SIGTERM');
  if (!signalSent && isLiveChild(child)) {
    throw new Error('Unable to send SIGTERM to the managed i2pd child.');
  }
  if (!(await waitForChildExit(child, STOP_TIMEOUT_MS))) return false;
  relinquishManagedChild(child);
  return true;
}

async function terminateObservedManagedProcess(
  installed: I2pdManagedInstall,
  expected: I2pdManagedProcessIdentity,
) {
  const revalidated = await observeInstalledI2pd(installed);
  if (revalidated.kind !== 'owned' ||
    revalidated.process.pid !== expected.pid ||
    revalidated.process.startIdentity !== expected.startIdentity) {
    throw new Error('Managed i2pd changed identity before it could be stopped.');
  }

  try {
    process.kill(expected.pid, 'SIGTERM');
  } catch (error) {
    if (error instanceof Error && 'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ESRCH') return true;
    throw new Error('Unable to send SIGTERM to the managed i2pd process.', { cause: error });
  }

  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const observation = await observeInstalledI2pd(installed);
    if (observation.kind !== 'owned' ||
      observation.process.pid !== expected.pid ||
      observation.process.startIdentity !== expected.startIdentity) {
      if (!(await probeSamBridge())) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, START_POLL_INTERVAL_MS));
  }
  return false;
}

async function stopImpl(): Promise<I2pdStatus> {
  const child = currentManagedChild();
  let installed: I2pdManagedInstall | null = null;
  let adoptedProcess: I2pdManagedProcessIdentity | null = null;
  if (!child) {
    installed = await readInstalledI2pd();
    if (!installed) return await getStatus();
    const observation = await observeInstalledI2pd(installed);
    if (observation.kind === 'unknown') {
      throw new Error('Home could not safely determine whether managed i2pd is running.');
    }
    if (observation.kind === 'absent') return await getStatus();
    adoptedProcess = observation.process;
  }

  publishProgress({
    action: 'stopping',
    kind: 'info',
    message: 'Stopping i2pd.',
    percent: 10,
  });
  const stopped = child
    ? await terminateManagedChild(child)
    : await terminateObservedManagedProcess(installed!, adoptedProcess!);
  if (!stopped) {
    throw new Error('Managed i2pd did not exit after SIGTERM; it remains supervised.');
  }
  publishProgress({
    action: 'idle',
    kind: 'success',
    message: 'i2pd is stopped.',
    percent: 100,
  });
  return await getStatus();
}

export function stop(): Promise<I2pdStatus> {
  return runMutation(stopImpl);
}

// Core integration is best-effort: I2P is an optional fallback. It still uses
// the strict record, collision, serialization, and child-ownership gates.
export async function startIfManaged(): Promise<void> {
  try {
    await runMutation(async () => {
      const inspection = await inspectMaintenance();
      if (inspection.install !== 'installed' || inspection.router !== 'managed-stopped' ||
        (inspection.maintenance !== 'start' && inspection.maintenance !== 'update')) return;
      await startImpl(false);
    });
  } catch {
    // Never block Core startup on the optional I2P fallback.
  }
}

export async function stopIfManaged(): Promise<void> {
  try {
    await runMutation(stopImpl);
  } catch {
    // Never block Core/app shutdown on the optional I2P fallback.
  }
}

// Stop accepting new router launches as soon as Home begins to quit. A launch
// already past its final synchronous gate is detached, unreferenced, and has a
// sanitized environment specifically so it can keep serving after Home exits.
// Do not signal that established router here: stopping it remains an explicit
// router/Core lifecycle action rather than a side effect of closing Home.
export function prepareForAppQuit(): void {
  appShutdownRequested = true;
}

export function registerI2pdManagerIpcHandlers() {
  ipcMain.handle('i2pd:getStatus', () => getStatus());
  ipcMain.handle('i2pd:install', () => install());
  ipcMain.handle('i2pd:start', () => start());
  ipcMain.handle('i2pd:stop', () => stop());
}
