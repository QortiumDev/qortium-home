import assert from 'node:assert/strict';
import {
  QDN_BRIDGE_ERROR_KEY,
  decodeQdnBridgeError,
  encodeQdnBridgeError,
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

console.log('QDN bridge error envelope tests passed.');
