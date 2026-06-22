import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import extract from 'extract-zip';
import { extract as extractTar } from 'tar';

// Managed i2pd for desktop. Downloads a verified i2pd binary from our build repo
// (QortiumDev/qortium-i2pd), installs it under Home's managed data area, writes a
// loopback-only SAM config, and supervises it as a child process so Qortium Core
// can use I2P as a fallback transport over SAM v3 on 127.0.0.1:7656.
//
// Mirrors electron/core-manager.ts conventions (paths under appData, streamed
// download + sha256 verification, versioned install, progress broadcast, IPC
// group). Desktop-only — Android connects to a remote node and never manages a
// local Core or i2pd.
//
// SCAFFOLD STATUS — implemented: target resolution, manifest fetch, download +
// sha256 verify (against manifest.json), extract, chmod, config generation,
// existing-SAM detection, supervised start/stop, status. TODO before shipping:
//   - macOS: re-ad-hoc-sign after install if the signature is missing (CI ad-hoc
//     signs already and Node fetch doesn't quarantine, so usually fine).
//   - Readiness beyond "SAM port open" (Core itself verifies LeaseSet; Home could
//     surface warming-up vs reachable by scraping Core's I2P logs — see the 1.1.2
//     log strings: "I2P fallback up at", "up, destination ...; LeaseSet published").
//   - Lifecycle wiring: start i2pd before managed Core / stop on app quit.
//   - Preserve i2pd's own router keys across binary updates.
//   - Download retry/backoff + offline handling (cf. core-manager downloadFile).

const I2PD_REPOSITORY = 'QortiumDev/qortium-i2pd';
const I2PD_RELEASE_BASE = `https://github.com/${I2PD_REPOSITORY}/releases/download`;
const GITHUB_USER_AGENT = 'QortiumHome/1.0';
// The i2pd build this Home version manages. Bump to ship a newer router.
const PINNED_RELEASE = '2.60.0-q2';

const I2PD_DATA_DIR = 'qortium-i2pd';
const CURRENT_I2PD_FILE = 'current.json';

const DEFAULT_SAM_HOST = '127.0.0.1';
const DEFAULT_SAM_PORT = 7656;
// I2P fallback is a reachability path, not a fast one — give it bandwidth headroom
// (the default 'L' makes leaseset resolution fail; the plan calls for >= O/X).
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

// How i2pd is being provided: 'managed' = Home runs it; 'external' = some other
// SAM bridge is already listening (a standalone operator's i2pd / Whonix), which
// Home must not clobber; 'none' = no router available.
export type I2pdMode = 'managed' | 'external' | 'none';

export type I2pdStatus = {
  supported: boolean;
  installed: boolean;
  version: string | null;
  running: boolean;
  mode: I2pdMode;
  samHost: string;
  samPort: number;
  binaryPath: string | null;
};

type I2pdTarget = {
  os: 'linux' | 'macos' | 'windows';
  arch: string;
  /** manifest.json key, e.g. "linux-x86_64" / "macos-arm64" / "windows-x64". */
  key: string;
  archiveType: 'zip' | 'tar.gz';
  binaryName: 'i2pd' | 'i2pd.exe';
};

type I2pdManifestEntry = { asset: string; sha256: string };
type I2pdManifest = {
  version: string;
  builtFrom: string;
  targets: Record<string, I2pdManifestEntry>;
};

type InstalledI2pd = {
  version: string;
  target: string;
  asset: string;
  sha256: string;
  binaryPath: string;
  installedAt: string;
};

// Module-level supervision handle for the i2pd we spawned.
let managedChild: ChildProcess | null = null;

function publishProgress(progress: I2pdProgress) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('i2pd:progress', progress);
    }
  }
}

function getI2pdBasePath() {
  return path.join(app.getPath('appData'), I2PD_DATA_DIR);
}

function getI2pdDownloadsPath() {
  return path.join(getI2pdBasePath(), 'downloads');
}

function getI2pdVersionsPath() {
  return path.join(getI2pdBasePath(), 'versions');
}

// Runtime data dir for the router itself (i2pd datadir + generated conf + keys).
function getI2pdRuntimePath() {
  return path.join(getI2pdBasePath(), 'runtime');
}

function getI2pdConfPath() {
  return path.join(getI2pdRuntimePath(), 'i2pd.conf');
}

function getI2pdLogPath() {
  return path.join(getI2pdRuntimePath(), 'i2pd.log');
}

function getI2pdPidPath() {
  return path.join(getI2pdRuntimePath(), 'i2pd.pid');
}

function getCurrentI2pdPath() {
  return path.join(getI2pdBasePath(), CURRENT_I2PD_FILE);
}

// Maps this machine to a manifest target key, mirroring core-manager's Java
// platform/arch mapping (darwin->macos, win32->windows; x64->x86_64,
// arm64->aarch64 on Linux but arm64 on macOS, matching our release naming).
function getI2pdTarget(): I2pdTarget | null {
  const platform = process.platform;
  const arch = process.arch;

  const os: I2pdTarget['os'] | null =
    platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux' : null;
  if (!os) {
    return null;
  }

  let mappedArch: string | null = null;
  if (arch === 'x64') {
    mappedArch = 'x86_64';
  } else if (arch === 'arm64') {
    mappedArch = os === 'macos' ? 'arm64' : 'aarch64';
  }
  if (!mappedArch) {
    return null;
  }

  // We only build/publish windows-x64 today.
  if (os === 'windows' && mappedArch !== 'x86_64') {
    return null;
  }

  return {
    os,
    arch: mappedArch,
    key: `${os}-${mappedArch}`,
    archiveType: os === 'windows' ? 'zip' : 'tar.gz',
    binaryName: os === 'windows' ? 'i2pd.exe' : 'i2pd',
  };
}

async function ensureLayout() {
  await mkdir(getI2pdBasePath(), { recursive: true });
  await mkdir(getI2pdDownloadsPath(), { recursive: true });
  await mkdir(getI2pdVersionsPath(), { recursive: true });
  await mkdir(getI2pdRuntimePath(), { recursive: true });
}

async function fetchManifest(tag: string): Promise<I2pdManifest> {
  const url = `${I2PD_RELEASE_BASE}/${tag}/manifest.json`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': GITHUB_USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Could not fetch the i2pd release manifest (HTTP ${response.status}).`);
  }

  const manifest = (await response.json()) as I2pdManifest;
  if (!manifest || typeof manifest !== 'object' || !manifest.targets) {
    throw new Error('The i2pd release manifest was malformed.');
  }

  return manifest;
}

// Streamed download with sha256 verification against the manifest's expected hex.
async function downloadAndVerify(tag: string, entry: I2pdManifestEntry, destinationPath: string) {
  const url = `${I2PD_RELEASE_BASE}/${tag}/${entry.asset}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/octet-stream,*/*', 'User-Agent': GITHUB_USER_AGENT },
  });

  if (!response.ok || !response.body) {
    throw new Error(`i2pd download failed with HTTP ${response.status}.`);
  }

  const totalBytes = Number(response.headers.get('content-length')) || 0;
  const hash = createHash('sha256');
  let receivedBytes = 0;
  const progressStream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      hash.update(chunk);
      publishProgress({
        action: 'downloading',
        kind: 'info',
        message: `Downloading ${entry.asset}.`,
        percent: totalBytes ? Math.floor((receivedBytes / totalBytes) * 100) : undefined,
      });
      callback(null, chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    progressStream,
    createWriteStream(destinationPath),
  );

  const digest = hash.digest('hex');
  if (digest !== entry.sha256) {
    await rm(destinationPath, { force: true });
    throw new Error(`Downloaded i2pd did not match the expected sha256 (got ${digest}).`);
  }
}

async function extractArchive(archiveType: I2pdTarget['archiveType'], archivePath: string, destination: string) {
  if (archiveType === 'zip') {
    await extract(archivePath, { dir: destination });
    return;
  }
  await extractTar({ cwd: destination, file: archivePath });
}

async function readInstalledI2pd(): Promise<InstalledI2pd | null> {
  try {
    const raw = await readFile(getCurrentI2pdPath(), 'utf8');
    const parsed = JSON.parse(raw) as InstalledI2pd;
    if (parsed?.binaryPath && existsSync(parsed.binaryPath)) {
      return parsed;
    }
  } catch {
    // Not installed yet, or the record/binary is gone.
  }
  return null;
}

export async function install(): Promise<I2pdStatus> {
  const target = getI2pdTarget();
  if (!target) {
    throw new Error(`Managed i2pd is not available for ${process.platform}/${process.arch}.`);
  }

  await ensureLayout();
  publishProgress({ action: 'checking', kind: 'info', message: 'Checking the i2pd release.', percent: 2 });

  const manifest = await fetchManifest(PINNED_RELEASE);
  const entry = manifest.targets[target.key];
  if (!entry) {
    throw new Error(`The i2pd release ${PINNED_RELEASE} has no asset for ${target.key}.`);
  }

  const archivePath = path.join(getI2pdDownloadsPath(), entry.asset);
  await downloadAndVerify(PINNED_RELEASE, entry, archivePath);

  publishProgress({ action: 'extracting', kind: 'info', message: 'Installing i2pd.', percent: 90 });
  const versionPath = path.join(getI2pdVersionsPath(), `${PINNED_RELEASE}-${target.key}`);
  await rm(versionPath, { recursive: true, force: true });
  await mkdir(versionPath, { recursive: true });
  await extractArchive(target.archiveType, archivePath, versionPath);

  const binaryPath = path.join(versionPath, target.binaryName);
  if (!existsSync(binaryPath)) {
    throw new Error(`The i2pd archive did not contain ${target.binaryName}.`);
  }
  if (process.platform !== 'win32') {
    await chmod(binaryPath, 0o755);
  }
  // TODO(macos): if `codesign -dv` shows no signature, re-ad-hoc-sign here
  // (`codesign --force -s - <binaryPath>`) for Apple Silicon. CI already ad-hoc
  // signs and Node-fetched files aren't quarantined, so this is usually a no-op.

  const installed: InstalledI2pd = {
    version: PINNED_RELEASE,
    target: target.key,
    asset: entry.asset,
    sha256: entry.sha256,
    binaryPath,
    installedAt: new Date().toISOString(),
  };
  await writeFile(getCurrentI2pdPath(), JSON.stringify(installed, null, 2), 'utf8');

  publishProgress({ action: 'idle', kind: 'success', message: 'i2pd installed.', percent: 100 });
  return getStatus();
}

// Generate a minimal, loopback-only i2pd config: SAM enabled for Core, proxies
// and web console off (never exposed), bandwidth headroom for the fallback.
async function writeI2pdConf() {
  const conf = [
    '# Generated by Qortium Home — do not edit; regenerated on each managed start.',
    `bandwidth = ${I2PD_BANDWIDTH_CLASS}`,
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
  await writeFile(getI2pdConfPath(), conf, 'utf8');
}

// True when something is already listening on the SAM bridge (managed or not).
function probeSamBridge(host = DEFAULT_SAM_HOST, port = DEFAULT_SAM_PORT): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(SAM_PROBE_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function isManagedRunning() {
  return managedChild !== null && managedChild.exitCode === null && !managedChild.killed;
}

export async function getStatus(): Promise<I2pdStatus> {
  const target = getI2pdTarget();
  const installed = await readInstalledI2pd();
  const managedRunning = isManagedRunning();
  const samUp = managedRunning ? true : await probeSamBridge();

  const mode: I2pdMode = managedRunning ? 'managed' : samUp ? 'external' : 'none';

  return {
    supported: target !== null,
    installed: installed !== null,
    version: installed?.version ?? null,
    running: managedRunning || samUp,
    mode,
    samHost: DEFAULT_SAM_HOST,
    samPort: DEFAULT_SAM_PORT,
    binaryPath: installed?.binaryPath ?? null,
  };
}

// Spawn the router child (no waiting). Returns once the process is launched.
async function launchI2pd(installed: InstalledI2pd) {
  await ensureLayout();
  await writeI2pdConf();

  const logStream = createWriteStream(getI2pdLogPath(), { flags: 'a' });
  const child = spawn(
    installed.binaryPath,
    [`--datadir=${getI2pdRuntimePath()}`, `--conf=${getI2pdConfPath()}`],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);
  child.once('exit', () => {
    if (managedChild === child) {
      managedChild = null;
    }
  });
  managedChild = child;
  if (child.pid !== undefined) {
    await writeFile(getI2pdPidPath(), String(child.pid), 'utf8').catch(() => undefined);
  }
}

// User-facing start: launch and wait for the SAM bridge so the UI reflects a
// usable router. (Tunnel build + LeaseSet publication — what Core needs for a
// session — take longer; this only confirms i2pd accepted SAM connections.)
export async function start(): Promise<I2pdStatus> {
  if (isManagedRunning()) {
    return getStatus();
  }

  // Respect an existing SAM bridge (standalone operator / Whonix): don't start a
  // conflicting managed router.
  if (await probeSamBridge()) {
    return getStatus();
  }

  const installed = await readInstalledI2pd();
  if (!installed) {
    throw new Error('Install i2pd before starting it.');
  }

  publishProgress({ action: 'starting', kind: 'info', message: 'Starting i2pd.', percent: 10 });
  await launchI2pd(installed);

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isManagedRunning()) {
      throw new Error('i2pd exited during startup; see the i2pd log.');
    }
    if (await probeSamBridge()) {
      publishProgress({ action: 'idle', kind: 'success', message: 'i2pd is running.', percent: 100 });
      return getStatus();
    }
    await new Promise((resolve) => setTimeout(resolve, START_POLL_INTERVAL_MS));
  }

  throw new Error('i2pd did not open its SAM bridge in time.');
}

export async function stop(): Promise<I2pdStatus> {
  const child = managedChild;
  if (!child || !isManagedRunning()) {
    managedChild = null;
    return getStatus();
  }

  publishProgress({ action: 'stopping', kind: 'info', message: 'Stopping i2pd.', percent: 10 });

  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    if (!isManagedRunning()) {
      break;
    }
    try {
      child.kill(signal);
    } catch {
      break;
    }
    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while (Date.now() < deadline && isManagedRunning()) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  managedChild = null;
  await rm(getI2pdPidPath(), { force: true }).catch(() => undefined);
  publishProgress({ action: 'idle', kind: 'success', message: 'i2pd is stopped.', percent: 100 });
  return getStatus();
}

// Best-effort: bring up the managed router (if installed) before Core, so its SAM
// bridge is ready when Core looks for it. Never throws — I2P is a fallback and
// must not block Core startup (direct TCP stays active either way). No-op when
// i2pd isn't installed (the user enables it from Settings) or another SAM bridge
// is already up (start() handles that).
export async function startIfManaged(): Promise<void> {
  try {
    if (!getI2pdTarget() || isManagedRunning()) {
      return;
    }
    // Don't clobber an existing/operator router.
    if (await probeSamBridge()) {
      return;
    }
    const installed = await readInstalledI2pd();
    if (!installed) {
      return;
    }
    // Launch without waiting for SAM readiness — Core retries SAM on its own, so
    // this must not delay Core startup.
    await launchI2pd(installed);
  } catch {
    // Swallow — never block Core on the I2P fallback.
  }
}

// Best-effort stop of the router we started (app quit / managed Core stop). Only
// affects the child Home spawned; an external/operator router is left untouched.
export async function stopIfManaged(): Promise<void> {
  try {
    await stop();
  } catch {
    // Ignore — shutting down anyway.
  }
}

export function registerI2pdManagerIpcHandlers() {
  ipcMain.handle('i2pd:getStatus', () => getStatus());
  ipcMain.handle('i2pd:install', () => install());
  ipcMain.handle('i2pd:start', () => start());
  ipcMain.handle('i2pd:stop', () => stop());
}
