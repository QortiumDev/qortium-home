import assert from 'node:assert/strict';
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

console.log('QDN bridge error envelope tests passed.');
