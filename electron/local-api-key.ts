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

export function readRunningLocalCoreApiKey(): RunningCoreApiKeyResult | null {
  if (process.platform !== 'linux') {
    return null;
  }

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

  return apiKeys.size === 1 ? [...apiKeys.values()][0] : null;
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
