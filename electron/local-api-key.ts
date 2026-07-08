import { execFile, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const API_KEY_FILE = 'apikey.txt';
const LOCAL_CORE_API_PORT = 24891;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

type PreviewApiKeyResult = {
  apiKey: string;
  created: boolean;
  path: string;
};

export type RunningCoreApiKeyResult = PreviewApiKeyResult & {
  apiKeyDirectory: string;
  cwd: string;
  jarPath: string;
  pid: number;
  settingsPath: string;
};

function encodeBase58(bytes: Uint8Array) {
  if (bytes.length === 0) {
    return '';
  }

  let zeroCount = 0;

  while (zeroCount < bytes.length && bytes[zeroCount] === 0) {
    zeroCount += 1;
  }

  if (zeroCount === bytes.length) {
    return '1'.repeat(zeroCount);
  }

  const digits = [0];

  for (const byte of bytes.subarray(zeroCount)) {
    let carry = byte;

    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }

    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  return `${'1'.repeat(zeroCount)}${digits
    .reverse()
    .map((digit) => BASE58_ALPHABET[digit])
    .join('')}`;
}

function generateApiKey() {
  return encodeBase58(randomBytes(16));
}

function restrictApiKeyFile(filePath: string) {
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Best effort: Windows permission handling does not map cleanly to POSIX modes.
  }
}

export function getPreviewApiKeyPath(previewPath: string) {
  return path.join(previewPath, API_KEY_FILE);
}

export function readPreviewApiKey(previewPath: string): PreviewApiKeyResult | null {
  const apiKeyPath = getPreviewApiKeyPath(previewPath);

  if (!existsSync(apiKeyPath)) {
    return null;
  }

  try {
    const apiKey = readFileSync(apiKeyPath, 'utf8').trim();

    if (!apiKey) {
      return null;
    }

    restrictApiKeyFile(apiKeyPath);

    return {
      apiKey,
      created: false,
      path: apiKeyPath,
    };
  } catch {
    return null;
  }
}

function getQortiumCoreProcessPaths(args: string[], cwd: string) {
  const jarIndex = args.findIndex((arg) => arg === '-jar');
  const jarPath = jarIndex >= 0 ? args[jarIndex + 1] ?? '' : '';
  const settingsPath = jarIndex >= 0 ? args[jarIndex + 2] ?? '' : '';
  const jarName = path.basename(jarPath).toLowerCase();

  if (!jarName.startsWith('qortium') || !jarName.endsWith('.jar')) {
    return null;
  }

  if (!settingsPath) {
    return null;
  }

  return {
    jarPath: path.isAbsolute(jarPath) ? jarPath : path.resolve(cwd, jarPath),
    settingsPath: path.isAbsolute(settingsPath) ? settingsPath : path.resolve(cwd, settingsPath),
  };
}

function getConfiguredApiKeyDirectory(settingsPath: string, cwd: string) {
  try {
    const parsedSettings: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'));

    if (parsedSettings && typeof parsedSettings === 'object') {
      const apiKeyPath = (parsedSettings as { apiKeyPath?: unknown }).apiKeyPath;

      if (typeof apiKeyPath === 'string' && apiKeyPath.trim()) {
        return path.isAbsolute(apiKeyPath) ? apiKeyPath : path.resolve(cwd, apiKeyPath);
      }
    }
  } catch {
    return cwd;
  }

  return cwd;
}

function runLsof(args: string[]): string | null {
  try {
    return execFileSync('lsof', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // lsof may be absent, or exit non-zero when nothing matches.
    return null;
  }
}

// Async variant for cache refreshes: lsof over a busy core process can take
// hundreds of milliseconds, which must not block the Electron main thread
// (a blocked main thread stalls input delivery to the renderer).
function runLsofAsync(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('lsof', args, { encoding: 'utf8' }, (error, stdout) => {
      resolve(error ? null : stdout);
    });
  });
}

const LSOF_PID_ARGS = ['-nP', `-iTCP:${LOCAL_CORE_API_PORT}`, '-sTCP:LISTEN', '-t'];

function parseLsofPidOutput(output: string | null): number | null {
  if (!output) {
    return null;
  }

  for (const line of output.split('\n')) {
    const pid = Number(line.trim());

    if (Number.isInteger(pid) && pid > 0) {
      return pid;
    }
  }

  return null;
}

function findLocalCorePidViaLsof(): number | null {
  return parseLsofPidOutput(runLsof(LSOF_PID_ARGS));
}

function getProcessFilesViaLsof(pid: number): { cwd: string; files: string[] } | null {
  const output = runLsof(['-p', String(pid), '-Fn']);

  return parseLsofProcessFiles(output);
}

function parseLsofProcessFiles(output: string | null): { cwd: string; files: string[] } | null {
  if (!output) {
    return null;
  }

  // `lsof -F` emits one field per line, prefixed by a single-letter type.
  // `n` carries a path; `f` carries the file descriptor of the following `n`.
  const files: string[] = [];
  let cwd = '';
  let currentFd = '';

  for (const line of output.split('\n')) {
    const type = line[0];
    const value = line.slice(1);

    if (type === 'f') {
      currentFd = value;
    } else if (type === 'n') {
      if (currentFd === 'cwd' && !cwd) {
        cwd = value;
      }

      if (value) {
        files.push(value);
      }
    }
  }

  if (!cwd) {
    return null;
  }

  return { cwd, files };
}

function readRunningLocalCoreApiKeyViaLsof(): RunningCoreApiKeyResult | null {
  const pid = findLocalCorePidViaLsof();

  if (pid === null) {
    return null;
  }

  return deriveRunningCoreKeyFromProcessFiles(pid, getProcessFilesViaLsof(pid));
}

async function readRunningLocalCoreApiKeyViaLsofAsync(): Promise<RunningCoreApiKeyResult | null> {
  const pid = parseLsofPidOutput(await runLsofAsync(LSOF_PID_ARGS));

  if (pid === null) {
    return null;
  }

  const processFiles = parseLsofProcessFiles(await runLsofAsync(['-p', String(pid), '-Fn']));

  return deriveRunningCoreKeyFromProcessFiles(pid, processFiles);
}

function deriveRunningCoreKeyFromProcessFiles(
  pid: number,
  processFiles: { cwd: string; files: string[] } | null,
): RunningCoreApiKeyResult | null {
  try {
    if (!processFiles) {
      return null;
    }

    const { cwd, files } = processFiles;
    const jarPath = files.find((file) => {
      const name = path.basename(file).toLowerCase();

      return name.startsWith('qortium') && name.endsWith('.jar');
    });

    // Guard: only trust this PID if it actually has a Qortium core jar open,
    // so an unrelated process listening on the port is never mistaken for the core.
    if (!jarPath) {
      return null;
    }

    const absoluteJarPath = path.isAbsolute(jarPath) ? jarPath : path.resolve(cwd, jarPath);
    const installDir = path.dirname(absoluteJarPath);

    // The Linux path reads the settings file referenced on the command line.
    // lsof does not expose the command line, so prefer an open settings file,
    // then fall back to the conventional settings.json next to the jar.
    const openSettingsPath = files.find((file) => {
      const name = path.basename(file).toLowerCase();

      return name === 'settings.json' || (name.startsWith('settings') && name.endsWith('.json'));
    });
    const settingsPath = openSettingsPath
      ? path.isAbsolute(openSettingsPath)
        ? openSettingsPath
        : path.resolve(cwd, openSettingsPath)
      : path.join(installDir, 'settings.json');

    const candidateDirectories: string[] = [];

    if (existsSync(settingsPath)) {
      candidateDirectories.push(getConfiguredApiKeyDirectory(settingsPath, cwd));
    }

    candidateDirectories.push(cwd, installDir);

    const seen = new Set<string>();

    for (const directory of candidateDirectories) {
      if (!directory || seen.has(directory)) {
        continue;
      }

      seen.add(directory);

      const apiKey = readPreviewApiKey(directory);

      if (apiKey) {
        return {
          ...apiKey,
          apiKeyDirectory: directory,
          cwd,
          jarPath: absoluteJarPath,
          pid,
          settingsPath,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

const RUNNING_CORE_KEY_CACHE_TTL_MS = 5_000;
let runningCoreKeyCache: { at: number; value: RunningCoreApiKeyResult | null } | null = null;
let runningCoreKeyRefresh: Promise<void> | null = null;

// Discovering the running core's key scans /proc and may shell out to lsof,
// which is slow on a busy core process. The result barely changes, but callers
// sit in hot paths (node status polls, per-request settings snapshots), so:
// serve a short-lived cache, refresh a stale cache asynchronously off the hot
// path (returning the stale value meanwhile), and only ever compute
// synchronously on the very first call so core start-guards stay correct at
// startup. Home's own core start/stop invalidates the cache explicitly.
export function readRunningLocalCoreApiKey(): RunningCoreApiKeyResult | null {
  const cached = runningCoreKeyCache;

  if (cached && Date.now() - cached.at < RUNNING_CORE_KEY_CACHE_TTL_MS) {
    return cached.value;
  }

  if (cached) {
    scheduleRunningCoreKeyRefresh();
    return cached.value;
  }

  const value = computeRunningCoreKeySync();

  runningCoreKeyCache = { at: Date.now(), value };

  return value;
}

export function invalidateRunningCoreApiKeyCache() {
  runningCoreKeyCache = null;
  runningCoreKeyRefresh = null;
}

// Populates the cache off the main thread at startup so the first real
// consumer (status poll / settings snapshot) never pays the synchronous
// compute during the launch input burst.
export function prewarmRunningCoreApiKeyCache() {
  scheduleRunningCoreKeyRefresh();
}

function scheduleRunningCoreKeyRefresh() {
  if (runningCoreKeyRefresh) {
    return;
  }

  runningCoreKeyRefresh = computeRunningCoreKeyAsync()
    .then((value) => {
      runningCoreKeyCache = { at: Date.now(), value };
    })
    .catch(() => undefined)
    .finally(() => {
      runningCoreKeyRefresh = null;
    });
}

async function computeRunningCoreKeyAsync(): Promise<RunningCoreApiKeyResult | null> {
  if (process.platform !== 'linux') {
    return readRunningLocalCoreApiKeyViaLsofAsync();
  }

  const apiKeys = scanProcForRunningCoreKeys();

  if (apiKeys.size === 1) {
    return [...apiKeys.values()][0];
  }

  return readRunningLocalCoreApiKeyViaLsofAsync();
}

function computeRunningCoreKeySync(): RunningCoreApiKeyResult | null {
  if (process.platform !== 'linux') {
    return readRunningLocalCoreApiKeyViaLsof();
  }

  const apiKeys = scanProcForRunningCoreKeys();

  if (apiKeys.size === 1) {
    return [...apiKeys.values()][0];
  }

  // Fall back to lsof when the /proc scan is inconclusive (e.g. the core runs
  // under a different user whose /proc/<pid>/cwd is not readable).
  return readRunningLocalCoreApiKeyViaLsof();
}

function scanProcForRunningCoreKeys(): Map<string, RunningCoreApiKeyResult> {
  const apiKeys = new Map<string, RunningCoreApiKeyResult>();

  for (const entry of readdirSync('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) {
      continue;
    }

    const pid = Number(entry.name);

    try {
      const procPath = path.join('/proc', entry.name);
      const args = readFileSync(path.join(procPath, 'cmdline'), 'utf8')
        .split('\0')
        .filter(Boolean);
      const cwd = readlinkSync(path.join(procPath, 'cwd'));
      const coreProcessPaths = getQortiumCoreProcessPaths(args, cwd);

      if (!coreProcessPaths) {
        continue;
      }

      const apiKeyDirectory = getConfiguredApiKeyDirectory(coreProcessPaths.settingsPath, cwd);
      const apiKey = readPreviewApiKey(apiKeyDirectory);

      if (apiKey) {
        apiKeys.set(apiKey.path, {
          ...apiKey,
          apiKeyDirectory,
          cwd,
          jarPath: coreProcessPaths.jarPath,
          pid,
          settingsPath: coreProcessPaths.settingsPath,
        });
      }
    } catch {
      // Processes can exit while /proc is being scanned.
    }
  }

  return apiKeys;
}

export function ensurePreviewApiKey(previewPath: string): PreviewApiKeyResult {
  const existingApiKey = readPreviewApiKey(previewPath);

  if (existingApiKey) {
    return existingApiKey;
  }

  const apiKey = generateApiKey();
  const apiKeyPath = getPreviewApiKeyPath(previewPath);

  mkdirSync(path.dirname(apiKeyPath), { recursive: true });
  writeFileSync(apiKeyPath, apiKey, { encoding: 'utf8', mode: 0o600 });
  restrictApiKeyFile(apiKeyPath);

  return {
    apiKey,
    created: true,
    path: apiKeyPath,
  };
}
