import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isNodeApiKeyTransportSafe, normalizeNodeApiUrl } from './node-api-url.js';

assert.equal(normalizeNodeApiUrl('127.0.0.1:24891'), 'http://127.0.0.1:24891');
assert.equal(normalizeNodeApiUrl('localhost:24891'), 'http://localhost:24891');
assert.equal(normalizeNodeApiUrl('[::1]:24891'), 'http://[::1]:24891');

assert.equal(normalizeNodeApiUrl('node.example:24891'), 'https://node.example:24891');
assert.equal(normalizeNodeApiUrl('203.0.113.7:24891'), 'https://203.0.113.7:24891');
assert.equal(normalizeNodeApiUrl('[2001:db8::7]:24891'), 'https://[2001:db8::7]:24891');

assert.equal(normalizeNodeApiUrl('http://node.example:24891/path?ignored=true'), 'http://node.example:24891');
assert.equal(normalizeNodeApiUrl('https://127.0.0.1:24891/path'), 'https://127.0.0.1:24891');

assert.throws(() => normalizeNodeApiUrl(''), /required/);
assert.throws(() => normalizeNodeApiUrl('ftp://node.example:24891'), /HTTP or HTTPS/);
assert.throws(() => normalizeNodeApiUrl('https://user:password@node.example:24891'), /username or password/);

assert.equal(isNodeApiKeyTransportSafe('http://127.0.0.1:24891'), true);
assert.equal(isNodeApiKeyTransportSafe('http://localhost:24891'), true);
assert.equal(isNodeApiKeyTransportSafe('http://[::1]:24891'), true);
assert.equal(isNodeApiKeyTransportSafe('https://node.example:24891'), true);
assert.equal(isNodeApiKeyTransportSafe('http://node.example:24891'), false);
assert.equal(isNodeApiKeyTransportSafe('http://203.0.113.7:24891'), false);
assert.equal(isNodeApiKeyTransportSafe('not a URL'), false);

// Keep every desktop and Android API-key path on the same pure transport
// policy. The connection paths feed QDN reads; the protected paths handle
// settings/update requests.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const settingsSource = readFileSync(path.join(repoRoot, 'electron/node-settings.ts'), 'utf8');
const platformSource = readFileSync(path.join(repoRoot, 'src/platform.ts'), 'utf8');
const sendableBody = /function getSendableNodeApiKey[\s\S]*?\n\}/.exec(settingsSource)?.[0] ?? '';
const protectedBody = /function getProtectedNodeApiKey[\s\S]*?\n\}/.exec(settingsSource)?.[0] ?? '';

assert(sendableBody.includes('isNodeApiKeyTransportSafe(nodeApiUrl)'));
assert(protectedBody.includes('isNodeApiKeyTransportSafe(nodeApiUrl)'));
assert(!platformSource.includes('function normalizeNodeApiUrl('));
assert(platformSource.includes("import { isNodeApiKeyTransportSafe, normalizeNodeApiUrl }"));
assert(platformSource.includes('getSendablePlatformNodeApiKey(settings, nodeApiUrl)'));
assert(platformSource.includes('getProtectedPlatformNodeApiKey(settings, nodeApiUrl)'));
assert(!platformSource.includes("'X-API-KEY': settings.apiKey"));

console.log('Node API URL and API-key transport tests passed.');
