import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  QDN_BRIDGE_ERROR_KEY,
  QDN_BRIDGE_RESULT_KEY,
  decodeQdnBridgeError,
  decodeQdnBridgeResponse,
  encodeQdnBridgeError,
  encodeQdnBridgeResult,
} from './qdn-bridge-error.js';

const sourceError = Object.assign(new Error('Public node is read-only.'), { code: 'PUBLIC_NODE_READ_ONLY' });
const envelope = encodeQdnBridgeError(sourceError);
const decoded = decodeQdnBridgeError(envelope);

assert.equal(decoded?.message, 'Public node is read-only.');
assert.equal((decoded as Error & { code?: string })?.code, 'PUBLIC_NODE_READ_ONLY');
assert.equal(decodeQdnBridgeError(encodeQdnBridgeError(new Error('Plain error.')))?.message, 'Plain error.');
assert.equal(decodeQdnBridgeError({ value: true }), undefined);
assert.equal(decodeQdnBridgeError({ [QDN_BRIDGE_ERROR_KEY]: { message: 'nope' }, value: true }), undefined);
const successPayload = { accepted: true, result: { value: 1 } };
assert.equal(decodeQdnBridgeError(successPayload), undefined);
assert.deepEqual(successPayload, { accepted: true, result: { value: 1 } });
assert.deepEqual(decodeQdnBridgeResponse(encodeQdnBridgeResult(successPayload)), successPayload);
assert.deepEqual(
  decodeQdnBridgeResponse(encodeQdnBridgeResult({ [QDN_BRIDGE_ERROR_KEY]: { message: 'resource data' } })),
  { [QDN_BRIDGE_ERROR_KEY]: { message: 'resource data' } },
);
assert.deepEqual(
  decodeQdnBridgeResponse(encodeQdnBridgeResult({ [QDN_BRIDGE_RESULT_KEY]: 'resource data' })),
  { [QDN_BRIDGE_RESULT_KEY]: 'resource data' },
);
assert.throws(() => decodeQdnBridgeResponse({ accepted: true }), /Malformed QDN bridge response/);

// The QDN app preload runs sandboxed, where require() cannot resolve relative
// modules, so it inlines the envelope key literals instead of importing them.
// Pin the copies to the canonical constants, and keep the preload free of
// relative requires (one would abort the whole preload and strip qdnRequest
// from every QDN app — the Home 1.5.0 chat regression).
// Compiled tests run from dist-electron/, the source lives in electron/.
const preloadSourceUrl = [
  new URL('../electron/qdn-app-preload.cts', import.meta.url),
  new URL('./qdn-app-preload.cts', import.meta.url),
].find((url) => existsSync(url));
assert.ok(preloadSourceUrl, 'qdn-app-preload.cts source not found next to the test');
const preloadSource = readFileSync(preloadSourceUrl, 'utf8');
assert.ok(
  preloadSource.includes(`const QDN_BRIDGE_ERROR_KEY = '${QDN_BRIDGE_ERROR_KEY}';`),
  'qdn-app-preload.cts must inline the exact QDN_BRIDGE_ERROR_KEY literal',
);
assert.ok(
  preloadSource.includes(`const QDN_BRIDGE_RESULT_KEY = '${QDN_BRIDGE_RESULT_KEY}';`),
  'qdn-app-preload.cts must inline the exact QDN_BRIDGE_RESULT_KEY literal',
);
assert.ok(
  !/require\(\s*['"]\.{1,2}\//.test(preloadSource),
  'qdn-app-preload.cts must not require relative modules (sandboxed preload)',
);

console.log('QDN bridge error envelope tests passed.');
