import { app, BrowserWindow, ipcMain } from 'electron';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import extract from 'extract-zip';
import { extract as extractTar } from 'tar';
import {
  prepareManagedLongLivedCommand,
  sanitizeManagedChildEnvironment,
} from './managed-child-process.js';

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
const DOWNLOAD_MAX_ATTEMPTS = 3;
const DOWNLOAD_RETRY_BASE_MS = 1_000;

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
  externalBinaryPath: string | null;
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

// A deterministic verification failure — the wrong bytes for a pinned hash (bad
// pin or tampering). Never retried, unlike transient network errors.
class ChecksumError extends Error {}

// Streamed download to a temp file with sha256 verification against the
// manifest's expected hex, then an atomic rename into place — so a half-finished
// or corrupt download can never be mistaken for a good binary.
async function downloadAndVerify(tag: string, entry: I2pdManifestEntry, destinationPath: string) {
  const url = `${I2PD_RELEASE_BASE}/${tag}/${entry.asset}`;
  const tempPath = `${destinationPath}.part`;
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

  try {
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      progressStream,
      createWriteStream(tempPath),
    );
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }

  const digest = hash.digest('hex');
  if (digest !== entry.sha256) {
    await rm(tempPath, { force: true });
    throw new ChecksumError(`Downloaded i2pd did not match the expected sha256 (got ${digest}).`);
  }

  await rename(tempPath, destinationPath);
}

// Retry transient download failures (network blips, 5xx, dropped streams) with
// exponential backoff + jitter. A ChecksumError is deterministic and is never
// retried.
async function downloadWithRetry(tag: string, entry: I2pdManifestEntry, destinationPath: string) {
  for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      await downloadAndVerify(tag, entry, destinationPath);
      return;
    } catch (error) {
      if (error instanceof ChecksumError || attempt === DOWNLOAD_MAX_ATTEMPTS) {
        throw error;
      }
      const delay = DOWNLOAD_RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 500);
      publishProgress({
        action: 'downloading',
        kind: 'info',
        message: `Download attempt ${attempt} failed; retrying in ${Math.round(delay / 1000)}s.`,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function extractArchive(archiveType: I2pdTarget['archiveType'], archivePath: string, destination: string) {
  if (archiveType === 'zip') {
    await extract(archivePath, { dir: destination });
    return;
  }
  await extractTar({ cwd: destination, file: archivePath });
}

// Remove stale version dirs after a successful install, keeping only the current
// one. Operates ONLY on versions/ — never on runtime/, which holds i2pd's router
// identity (router.keys) and netDb and must persist across binary updates.
async function pruneOldVersions(keepDirName: string) {
  const versionsPath = getI2pdVersionsPath();
  const entries = await readdir(versionsPath, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== keepDirName) {
      await rm(path.join(versionsPath, entry.name), { recursive: true, force: true }).catch(() => undefined);
    }
  }
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
  await downloadWithRetry(PINNED_RELEASE, entry, archivePath);

  publishProgress({ action: 'extracting', kind: 'info', message: 'Installing i2pd.', percent: 90 });
  const versionDirName = `${PINNED_RELEASE}-${target.key}`;
  const versionPath = path.join(getI2pdVersionsPath(), versionDirName);
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

  // Best-effort cleanup of superseded binaries (keeps runtime/ untouched).
  await pruneOldVersions(versionDirName);

  publishProgress({ action: 'idle', kind: 'success', message: 'i2pd installed.', percent: 100 });
  return getStatus();
}

// Generate a minimal, loopback-only i2pd config: SAM enabled for Core, proxies
// and web console off (never exposed), bandwidth headroom for the fallback.
async function writeI2pdConf() {
  const conf = [
    '# Generated by Qortium Home — do not edit; regenerated on each managed start.',
    `bandwidth = ${I2PD_BANDWIDTH_CLASS}`,
    // Log to i2pd's own file, not via Home's stdout pipe: the router is spawned
    // detached so it can outlive Home (it tracks Core's lifetime, not Home's
    // window), and a piped stdout would break the moment Home exits.
    'log = file',
    `logfile = ${getI2pdLogPath()}`,
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

async function readPidFile(): Promise<number | null> {
  try {
    const pid = Number.parseInt((await readFile(getI2pdPidPath(), 'utf8')).trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but we can't signal it — still alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// Is `pid` one of OUR i2pd processes? We match our runtime datadir on the command
// line (passed as --datadir=<runtime>) so a reused pid for an unrelated process
// isn't mistaken for ours. Best-effort liveness-only on Windows.
function isOurI2pd(pid: number): boolean {
  if (!isPidAlive(pid)) {
    return false;
  }
  if (process.platform === 'win32') {
    return true;
  }
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    return out.includes(getI2pdRuntimePath());
  } catch {
    return false;
  }
}

function findExternalI2pdBinaryPath(): string | null {
  if (process.platform === 'win32') {
    return null;
  }

  try {
    const out = execFileSync('ps', ['-eo', 'args='], { encoding: 'utf8' });
    const runtimePath = getI2pdRuntimePath();

    for (const rawLine of out.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.includes(runtimePath)) {
        continue;
      }

      const match = line.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
      const binaryPath = match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
      if (binaryPath && path.basename(binaryPath).startsWith('i2pd')) {
        return binaryPath;
      }
    }
  } catch {
    return null;
  }

  return null;
}

// The pid of the managed router we're responsible for: our live child, or an
// orphan we previously spawned (recovered from the pidfile after a Home restart
// or crash) so we can still stop it instead of treating it as someone else's.
async function getManagedPid(): Promise<number | null> {
  if (managedChild && managedChild.exitCode === null && !managedChild.killed && managedChild.pid) {
    return managedChild.pid;
  }
  const pid = await readPidFile();
  return pid !== null && isOurI2pd(pid) ? pid : null;
}

async function isManagedRunning(): Promise<boolean> {
  return (await getManagedPid()) !== null;
}

export async function getStatus(): Promise<I2pdStatus> {
  const target = getI2pdTarget();
  const installed = await readInstalledI2pd();
  const managedRunning = (await getManagedPid()) !== null;
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
    externalBinaryPath: mode === 'external' ? findExternalI2pdBinaryPath() : null,
  };
}

// Spawn the router child (no waiting). Returns once the process is launched.
async function launchI2pd(installed: InstalledI2pd) {
  await ensureLayout();
  await writeI2pdConf();

  // Spawn detached so the router survives Home closing: i2pd's lifetime should
  // track Core's, not Home's window. On Unix `detached` puts it in its own
  // process group so it doesn't receive Home's terminal signals; `unref` lets
  // Home exit without waiting on it. stdio is ignored because the router writes
  // its own logfile (see writeI2pdConf) — a piped stream would die with Home.
  const launch = prepareManagedLongLivedCommand(installed.binaryPath, [
    `--datadir=${getI2pdRuntimePath()}`,
    `--conf=${getI2pdConfPath()}`,
  ]);
  const child = spawn(launch.command, launch.args, {
    cwd: getI2pdRuntimePath(),
    env: sanitizeManagedChildEnvironment(),
    windowsHide: true,
    detached: true,
    stdio: 'ignore',
  });
  child.once('exit', () => {
    if (managedChild === child) {
      managedChild = null;
    }
  });
  child.unref();
  managedChild = child;
  if (child.pid !== undefined) {
    await writeFile(getI2pdPidPath(), String(child.pid), 'utf8').catch(() => undefined);
  }
}

// User-facing start: launch and wait for the SAM bridge so the UI reflects a
// usable router. (Tunnel build + LeaseSet publication — what Core needs for a
// session — take longer; this only confirms i2pd accepted SAM connections.)
export async function start(): Promise<I2pdStatus> {
  if (await isManagedRunning()) {
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
    if (!(await isManagedRunning())) {
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
  // Kill by pid so this works for both our live child and an orphan we adopted
  // from the pidfile after a restart.
  const pid = await getManagedPid();
  if (pid === null) {
    managedChild = null;
    await rm(getI2pdPidPath(), { force: true }).catch(() => undefined);
    return getStatus();
  }

  publishProgress({ action: 'stopping', kind: 'info', message: 'Stopping i2pd.', percent: 10 });

  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    if (!isPidAlive(pid)) {
      break;
    }
    try {
      process.kill(pid, signal);
    } catch {
      break;
    }
    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while (Date.now() < deadline && isPidAlive(pid)) {
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
    if (!getI2pdTarget() || (await isManagedRunning())) {
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
