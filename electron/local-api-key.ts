import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const API_KEY_FILE = 'apikey.txt';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

type PreviewApiKeyResult = {
  apiKey: string;
  created: boolean;
  path: string;
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
