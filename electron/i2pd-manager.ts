import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, open, rename, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {
  installPinnedI2pd,
  readI2pdManagedInstall,
  type I2pdManagedInstall,
} from './i2pd-managed-install.js';
import {
  classifyI2pdRelease,
  getPinnedI2pdRelease,
  type I2pdPinnedRelease,
} from './i2pd-release-policy.js';
import {
  I2PD_SAM_MAX_REPLY_BYTES,
  isValidI2pdSamHelloReplyLine,
} from './i2pd-sam-protocol.js';
import {
  prepareManagedLongLivedCommand,
  sanitizeManagedChildEnvironment,
} from './managed-child-process.js';

// Desktop-only managed i2pd. The immutable installer owns release provenance
// and generation validation; this module owns only the child it spawned during
// this Home process. An already-running SAM router is treated as external and
// is never inspected, adopted, signalled, or identified by executable path.

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
  install: 'installed' | 'missing' | 'unknown';
  installedVersion: string | null;
  managedProcessActive: boolean;
  maintenance: 'install' | 'none' | 'start' | 'unavailable' | 'update';
  router:
    | 'external-running'
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

function publishProgress(progress: I2pdProgress) {
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

async function readInstalledI2pd(): Promise<I2pdManagedInstall | null> {
  return await readI2pdManagedInstall(managedInstallInput());
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

async function readStrictPinnedInstall(): Promise<I2pdManagedInstall | null> {
  const release = getPinnedI2pdRelease(process.platform, process.arch);
  if (!release) {
    throw new Error('Managed i2pd is unavailable on this platform.');
  }
  const installed = await readInstalledI2pd();
  if (!installed) return null;
  const decision = classifyI2pdRelease(
    installed.record.version,
    process.platform,
    process.arch,
  );
  if (decision.action !== 'none' || decision.reason !== 'installed-current' ||
    !installedMatchesPinnedRelease(installed, release)) {
    throw new Error('The managed i2pd installation is not the pinned release.');
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
  const runtimePath = installed.paths.runtimePath;
  const confPath = path.join(runtimePath, 'i2pd.conf');
  const tempPath = path.join(
    runtimePath,
    `.i2pd.conf.${randomBytes(16).toString('hex')}.tmp`,
  );
  const conf = [
    '# Generated by Qortium Home; regenerated on each managed start.',
    `bandwidth = ${I2PD_BANDWIDTH_CLASS}`,
    'log = file',
    'logfile = i2pd.log',
    '',
    '[sam]',
    'enabled = true',
    `address = ${DEFAULT_SAM_HOST}`,
    `port = ${DEFAULT_SAM_PORT}`,
    '',
    '[httpproxy]',
    'enabled = false',
    '',
    '[socksproxy]',
    'enabled = false',
    '',
    '[http]',
    'enabled = false',
    '',
  ].join('\n');

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
  const runtimePath = installed.paths.runtimePath;
  const confPath = path.join(runtimePath, 'i2pd.conf');
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

  const selected = await readStrictPinnedInstall();
  if (!selected) throw new Error('Install i2pd before starting it.');
  await writeI2pdConf(selected);

  // Recheck the collision after filesystem work, then re-read and re-hash the
  // exact active generation as the final asynchronous authority gate before
  // the synchronous command construction and spawn.
  if (await probeSamBridge()) return;
  const revalidated = await readStrictPinnedInstall();
  if (!revalidated || !sameInstalledGeneration(selected, revalidated)) {
    throw new Error('The managed i2pd installation changed before startup.');
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
  const managedOwned = child !== null;
  let installed: I2pdManagedInstall | null;
  try {
    installed = await readInstalledI2pd();
  } catch {
    return {
      install: 'unknown',
      installedVersion: managedOwned ? managedChildInstall?.record.version ?? null : null,
      managedProcessActive: managedOwned,
      maintenance: 'unavailable',
      router: managedOwned
        ? samReady ? 'managed-running' : 'managed-stopped'
        : samReady ? 'external-running' : 'unknown',
      supported: true,
    };
  }

  const reportedVersion = managedOwned
    ? managedChildInstall?.record.version ?? null
    : installed?.record.version ?? null;
  if (!installed) {
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
  const liveGenerationStillCurrent = !managedOwned || (
    managedChildInstall !== null &&
    sameInstalledGeneration(managedChildInstall, installed)
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
  const managedOwned = inspection.router === 'managed-running' ||
    currentManagedChild() !== null;
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
  if (currentManagedChild()) {
    throw new Error('Stop the managed i2pd router before installing an update.');
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

async function stopImpl(): Promise<I2pdStatus> {
  const child = currentManagedChild();
  if (!child) return await getStatus();

  publishProgress({
    action: 'stopping',
    kind: 'info',
    message: 'Stopping i2pd.',
    percent: 10,
  });
  if (!(await terminateManagedChild(child))) {
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
      if (inspection.maintenance !== 'start') return;
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

// App quit cannot safely queue behind a 60-second startup readiness wait: that
// would let Electron exit while the retained child remains alive. Revoke any
// launch before its final synchronous gate, then directly stop the one child
// whose ChildProcess authority this Home process still holds.
export async function stopRetainedChildForAppQuit(): Promise<void> {
  appShutdownRequested = true;
  const child = currentManagedChild();
  if (!child) return;
  if (!(await terminateManagedChild(child))) {
    throw new Error('Managed i2pd did not exit during Home shutdown.');
  }
}

export function registerI2pdManagerIpcHandlers() {
  ipcMain.handle('i2pd:getStatus', () => getStatus());
  ipcMain.handle('i2pd:install', () => install());
  ipcMain.handle('i2pd:start', () => start());
  ipcMain.handle('i2pd:stop', () => stop());
}
