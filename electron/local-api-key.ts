import { execFile, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  realpathSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  getCoreApiKeyPath,
  getCoreFallbackSettingsPath,
  getCoreLsofPidArgs,
  matchesCoreJarName,
  matchesCoreSettingsName,
  QORTIUM_CORE_DESCRIPTOR,
  resolveCoreApiKeyDirectory,
  resolveCoreProcessPaths,
  type CoreNetworkDescriptor,
} from './core-network-descriptor.js';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export type LocalApiKeyResult = {
  apiKey: string;
  created: boolean;
  path: string;
};

export type LocalApiKeyFileAccess = 'managed' | 'read-only';

type PreviewApiKeyResult = LocalApiKeyResult;

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

export function getLocalApiKeyPath(descriptor: CoreNetworkDescriptor, directory: string) {
  return getCoreApiKeyPath(descriptor, directory);
}

export function readLocalApiKey(
  descriptor: CoreNetworkDescriptor,
  directory: string,
  options: { access?: LocalApiKeyFileAccess } = {},
): LocalApiKeyResult | null {
  const apiKeyPath = getLocalApiKeyPath(descriptor, directory);

  if (!existsSync(apiKeyPath)) {
    return null;
  }

  try {
    const apiKey = readFileSync(apiKeyPath, 'utf8').trim();

    if (!apiKey) {
      return null;
    }

    if (options.access === 'managed') {
      restrictApiKeyFile(apiKeyPath);
    }

    return {
      apiKey,
      created: false,
      path: apiKeyPath,
    };
  } catch {
    return null;
  }
}

export function getPreviewApiKeyPath(previewPath: string) {
  return getLocalApiKeyPath(QORTIUM_CORE_DESCRIPTOR, previewPath);
}

export function readPreviewApiKey(previewPath: string): PreviewApiKeyResult | null {
  return readLocalApiKey(QORTIUM_CORE_DESCRIPTOR, previewPath, { access: 'managed' });
}

function getConfiguredApiKeyDirectory(
  descriptor: CoreNetworkDescriptor,
  settingsPath: string,
  cwd: string,
) {
  try {
    const parsedSettings: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'));

    return resolveCoreApiKeyDirectory(descriptor, parsedSettings, cwd);
  } catch {
    return cwd;
  }
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

export type RunningCoreApiKeyQuery = {
  descriptor: CoreNetworkDescriptor;
  expectedApiKeyDirectory?: string;
  expectedJarPath?: string;
  fileAccess?: LocalApiKeyFileAccess;
};

type CanonicalizePath = (value: string) => string | null;

function canonicalizeExistingPath(value: string): string | null {
  try {
    const canonical = realpathSync.native(value);

    return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  } catch {
    return null;
  }
}

function matchesExpectedPath(
  actualPath: string,
  expectedPath: string | undefined,
  canonicalize: CanonicalizePath = canonicalizeExistingPath,
) {
  const expectedValue = expectedPath?.trim();

  if (!expectedValue) {
    return true;
  }

  const actual = canonicalize(actualPath);
  const expected = canonicalize(expectedValue);

  return !!actual && !!expected && actual === expected;
}

export function matchesRunningCoreApiKeyQuery(
  result: RunningCoreApiKeyResult,
  query: RunningCoreApiKeyQuery,
  canonicalize: CanonicalizePath = canonicalizeExistingPath,
) {
  if (!matchesExpectedPath(result.jarPath, query.expectedJarPath, canonicalize)) {
    return false;
  }

  if (
    !matchesExpectedPath(
      result.apiKeyDirectory,
      query.expectedApiKeyDirectory,
      canonicalize,
    )
  ) {
    return false;
  }

  return true;
}

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

function findLocalCorePidViaLsof(query: RunningCoreApiKeyQuery): number | null {
  return parseLsofPidOutput(runLsof(getCoreLsofPidArgs(query.descriptor)));
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

function readRunningLocalCoreApiKeyViaLsof(query: RunningCoreApiKeyQuery): RunningCoreApiKeyResult | null {
  const pid = findLocalCorePidViaLsof(query);

  if (pid === null) {
    return null;
  }

  return deriveRunningCoreKeyFromProcessFiles(query, pid, getProcessFilesViaLsof(pid));
}

async function readRunningLocalCoreApiKeyViaLsofAsync(
  query: RunningCoreApiKeyQuery,
): Promise<RunningCoreApiKeyResult | null> {
  const pid = parseLsofPidOutput(await runLsofAsync(getCoreLsofPidArgs(query.descriptor)));

  if (pid === null) {
    return null;
  }

  const processFiles = parseLsofProcessFiles(await runLsofAsync(['-p', String(pid), '-Fn']));

  return deriveRunningCoreKeyFromProcessFiles(query, pid, processFiles);
}

export function deriveRunningCoreKeyFromProcessFiles(
  query: RunningCoreApiKeyQuery,
  pid: number,
  processFiles: { cwd: string; files: string[] } | null,
): RunningCoreApiKeyResult | null {
  try {
    if (!processFiles) {
      return null;
    }

    const { cwd, files } = processFiles;
    const jarPath = files.find(
      (file) =>
        matchesCoreJarName(query.descriptor, path.basename(file)) &&
        matchesExpectedPath(
          path.isAbsolute(file) ? file : path.resolve(cwd, file),
          query.expectedJarPath,
        ),
    );

    // Guard: only trust this PID if it actually has the selected network's core
    // jar open,
    // so an unrelated process listening on the port is never mistaken for the core.
    if (!jarPath) {
      return null;
    }

    const absoluteJarPath = path.isAbsolute(jarPath) ? jarPath : path.resolve(cwd, jarPath);
    const installDir = path.dirname(absoluteJarPath);

    // The Linux path reads the settings file referenced on the command line.
    // lsof does not expose the command line, so prefer an open settings file,
    // then fall back to the conventional settings.json next to the jar.
    const openSettingsPath = files.find((file) =>
      matchesCoreSettingsName(query.descriptor, path.basename(file)),
    );
    const settingsPath = openSettingsPath
      ? path.isAbsolute(openSettingsPath)
        ? openSettingsPath
        : path.resolve(cwd, openSettingsPath)
      : getCoreFallbackSettingsPath(query.descriptor, absoluteJarPath);

    const candidateDirectories: string[] = [];

    if (existsSync(settingsPath)) {
      candidateDirectories.push(
        getConfiguredApiKeyDirectory(query.descriptor, settingsPath, cwd),
      );
    }

    candidateDirectories.push(cwd, installDir);

    const seen = new Set<string>();

    for (const directory of candidateDirectories) {
      if (!directory || seen.has(directory)) {
        continue;
      }

      seen.add(directory);

      if (!matchesExpectedPath(directory, query.expectedApiKeyDirectory)) {
        continue;
      }

      const apiKey = readLocalApiKey(query.descriptor, directory, { access: query.fileAccess });

      if (apiKey) {
        const result = {
          ...apiKey,
          apiKeyDirectory: directory,
          cwd,
          jarPath: absoluteJarPath,
          pid,
          settingsPath,
        };

        if (matchesRunningCoreApiKeyQuery(result, query)) {
          return result;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

const RUNNING_CORE_KEY_CACHE_TTL_MS = 5_000;

function getCachePathIdentity(value: string | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return '*';
  }

  // Discovery/adoption supplies canonical target paths. Keep the cache key
  // lexical after that boundary so invalidation remains stable if the target is
  // moved or removed between lookup and invalidation.
  const resolved = path.resolve(trimmed);

  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function getRunningCoreApiKeyCacheKey(query: RunningCoreApiKeyQuery) {
  return JSON.stringify([
    query.descriptor.id,
    query.descriptor.processProbe.apiPort,
    query.fileAccess ?? 'read-only',
    getCachePathIdentity(query.expectedJarPath),
    getCachePathIdentity(query.expectedApiKeyDirectory),
  ]);
}

type RunningCoreApiKeyCacheDependencies = {
  computeAsync: (query: RunningCoreApiKeyQuery) => Promise<RunningCoreApiKeyResult | null>;
  computeSync: (query: RunningCoreApiKeyQuery) => RunningCoreApiKeyResult | null;
  now?: () => number;
  ttlMs?: number;
};

type RunningCoreApiKeyCacheSlot = {
  cached: { at: number; value: RunningCoreApiKeyResult | null } | null;
  generation: number;
  network: CoreNetworkDescriptor['id'];
  refresh: Promise<void> | null;
};

export function createRunningCoreApiKeyCache(dependencies: RunningCoreApiKeyCacheDependencies) {
  const now = dependencies.now ?? Date.now;
  const ttlMs = dependencies.ttlMs ?? RUNNING_CORE_KEY_CACHE_TTL_MS;
  const slots = new Map<string, RunningCoreApiKeyCacheSlot>();

  function getSlot(query: RunningCoreApiKeyQuery) {
    const key = getRunningCoreApiKeyCacheKey(query);
    let slot = slots.get(key);

    if (!slot) {
      slot = {
        cached: null,
        generation: 0,
        network: query.descriptor.id,
        refresh: null,
      };
      slots.set(key, slot);
    }

    return { key, slot };
  }

  function scheduleRefresh(query: RunningCoreApiKeyQuery) {
    const { key, slot } = getSlot(query);

    if (slot.refresh) {
      return;
    }

    const generation = slot.generation;
    const refresh = dependencies
      .computeAsync(query)
      .then((value) => {
        const current = slots.get(key);

        if (current === slot && current.generation === generation) {
          current.cached = { at: now(), value };
        }
      })
      .catch(() => undefined)
      .finally(() => {
        const current = slots.get(key);

        if (current === slot && current.refresh === refresh) {
          current.refresh = null;
        }
      });

    slot.refresh = refresh;
  }

  function read(query: RunningCoreApiKeyQuery) {
    const { slot } = getSlot(query);
    const cached = slot.cached;

    if (cached && now() - cached.at < ttlMs) {
      return cached.value;
    }

    if (cached) {
      scheduleRefresh(query);
      return cached.value;
    }

    const value = dependencies.computeSync(query);

    slot.cached = { at: now(), value };

    return value;
  }

  function invalidateSlot(slot: RunningCoreApiKeyCacheSlot) {
    slot.generation += 1;
    slot.cached = null;
    slot.refresh = null;
  }

  return {
    invalidate(query: RunningCoreApiKeyQuery) {
      const slot = slots.get(getRunningCoreApiKeyCacheKey(query));

      if (slot) {
        invalidateSlot(slot);
      }
    },
    invalidateNetwork(network: CoreNetworkDescriptor['id']) {
      for (const slot of slots.values()) {
        if (slot.network === network) {
          invalidateSlot(slot);
        }
      }
    },
    prewarm(query: RunningCoreApiKeyQuery) {
      scheduleRefresh(query);
    },
    read,
  };
}

const runningCoreApiKeyCache = createRunningCoreApiKeyCache({
  computeAsync: computeRunningCoreKeyAsync,
  computeSync: computeRunningCoreKeySync,
});

// Discovering the running core's key scans /proc and may shell out to lsof,
// which is slow on a busy core process. The result barely changes, but callers
// sit in hot paths (node status polls, per-request settings snapshots), so:
// serve a short-lived cache, refresh a stale cache asynchronously off the hot
// path (returning the stale value meanwhile), and only ever compute
// synchronously on the very first call so core start-guards stay correct at
// startup. Home's own core start/stop invalidates the cache explicitly.
export function readRunningLocalCoreApiKeyFor(
  query: RunningCoreApiKeyQuery,
): RunningCoreApiKeyResult | null {
  return runningCoreApiKeyCache.read(query);
}

export function readRunningLocalCoreApiKey(): RunningCoreApiKeyResult | null {
  return readRunningLocalCoreApiKeyFor({
    descriptor: QORTIUM_CORE_DESCRIPTOR,
    fileAccess: 'managed',
  });
}

export function invalidateRunningCoreApiKeyCacheFor(query: RunningCoreApiKeyQuery) {
  runningCoreApiKeyCache.invalidate(query);
}

export function invalidateRunningCoreApiKeyCachesForNetwork(network: CoreNetworkDescriptor['id']) {
  runningCoreApiKeyCache.invalidateNetwork(network);
}

export function invalidateRunningCoreApiKeyCache() {
  invalidateRunningCoreApiKeyCachesForNetwork(QORTIUM_CORE_DESCRIPTOR.id);
}

// Populates the cache off the main thread at startup so the first real
// consumer (status poll / settings snapshot) never pays the synchronous
// compute during the launch input burst.
export function prewarmRunningCoreApiKeyCacheFor(query: RunningCoreApiKeyQuery) {
  runningCoreApiKeyCache.prewarm(query);
}

export function prewarmRunningCoreApiKeyCache() {
  prewarmRunningCoreApiKeyCacheFor({
    descriptor: QORTIUM_CORE_DESCRIPTOR,
    fileAccess: 'managed',
  });
}

async function computeRunningCoreKeyAsync(
  query: RunningCoreApiKeyQuery,
): Promise<RunningCoreApiKeyResult | null> {
  if (process.platform !== 'linux') {
    return readRunningLocalCoreApiKeyViaLsofAsync(query);
  }

  const apiKeys = scanProcForRunningCoreKeys(query);

  if (apiKeys.size === 1) {
    return [...apiKeys.values()][0];
  }

  return readRunningLocalCoreApiKeyViaLsofAsync(query);
}

function computeRunningCoreKeySync(query: RunningCoreApiKeyQuery): RunningCoreApiKeyResult | null {
  if (process.platform !== 'linux') {
    return readRunningLocalCoreApiKeyViaLsof(query);
  }

  const apiKeys = scanProcForRunningCoreKeys(query);

  if (apiKeys.size === 1) {
    return [...apiKeys.values()][0];
  }

  // Fall back to lsof when the /proc scan is inconclusive (e.g. the core runs
  // under a different user whose /proc/<pid>/cwd is not readable).
  return readRunningLocalCoreApiKeyViaLsof(query);
}

function scanProcForRunningCoreKeys(
  query: RunningCoreApiKeyQuery,
): Map<string, RunningCoreApiKeyResult> {
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
      const coreProcessPaths = resolveCoreProcessPaths(query.descriptor, args, cwd);

      if (!coreProcessPaths) {
        continue;
      }

      if (!matchesExpectedPath(coreProcessPaths.jarPath, query.expectedJarPath)) {
        continue;
      }

      const apiKeyDirectory = getConfiguredApiKeyDirectory(
        query.descriptor,
        coreProcessPaths.settingsPath,
        cwd,
      );

      if (!matchesExpectedPath(apiKeyDirectory, query.expectedApiKeyDirectory)) {
        continue;
      }
      const apiKey = readLocalApiKey(query.descriptor, apiKeyDirectory, {
        access: query.fileAccess,
      });

      if (apiKey) {
        const result = {
          ...apiKey,
          apiKeyDirectory,
          cwd,
          jarPath: coreProcessPaths.jarPath,
          pid,
          settingsPath: coreProcessPaths.settingsPath,
        };

        if (matchesRunningCoreApiKeyQuery(result, query)) {
          apiKeys.set(apiKey.path, result);
        }
      }
    } catch {
      // Processes can exit while /proc is being scanned.
    }
  }

  return apiKeys;
}

export function ensureLocalApiKey(
  descriptor: CoreNetworkDescriptor,
  directory: string,
): LocalApiKeyResult {
  const existingApiKey = readLocalApiKey(descriptor, directory, { access: 'managed' });

  if (existingApiKey) {
    return existingApiKey;
  }

  const apiKey = generateApiKey();
  const apiKeyPath = getLocalApiKeyPath(descriptor, directory);

  mkdirSync(path.dirname(apiKeyPath), { recursive: true });
  writeFileSync(apiKeyPath, apiKey, { encoding: 'utf8', mode: 0o600 });
  restrictApiKeyFile(apiKeyPath);

  return {
    apiKey,
    created: true,
    path: apiKeyPath,
  };
}

export function ensurePreviewApiKey(previewPath: string): PreviewApiKeyResult {
  return ensureLocalApiKey(QORTIUM_CORE_DESCRIPTOR, previewPath);
}
