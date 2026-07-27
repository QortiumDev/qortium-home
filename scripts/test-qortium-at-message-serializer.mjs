import assert from 'node:assert/strict';
import {
  assertValidQortiumAtAddress,
  buildUnsignedQortiumAtMessageTransactionBytes,
  getQortiumAtMessageRequest,
  QORTIUM_AT_MESSAGE_MAX_BYTES,
  QORTIUM_AT_MESSAGE_POW_DIFFICULTY,
  QORTIUM_MESSAGE_TRANSACTION_TYPE,
} from '../dist-electron/qdn-at-message.js';
import { base58Decode, base58Encode } from '../dist-electron/base58.js';

const fixture = {
  recipient: 'ASRUsCjk6fa5bujv3oWYmWaVqNtvxydpPH',
  senderPublicKey: 'FNoQheiUBkwbsTeVYT3A7RCAbFSQq6XdokEGv5JXi7uM',
  timestamp: 1783444426299,
};
const message = 'claim';

assert.equal(assertValidQortiumAtAddress(fixture.recipient), fixture.recipient);
assert.throws(
  () => assertValidQortiumAtAddress('QT4zHex8JEULmBhYmKd5UhpiNA46T5wUko'),
  /AT address/i,
);
assert.throws(
  () => assertValidQortiumAtAddress(`${fixture.recipient.slice(0, -1)}1`), /checksum/i);
assert.deepEqual(
  getQortiumAtMessageRequest({ action: 'SEND_MESSAGE', payload: { message, recipient: fixture.recipient } }),
  { message, recipient: fixture.recipient },
);
assert.throws(
  () => getQortiumAtMessageRequest({ action: 'SEND_MESSAGE', recipient: fixture.recipient }), /non-empty/i,
);
assert.throws(
  () => getQortiumAtMessageRequest({ action: 'SEND_MESSAGE', message, recipient: 'QT4zHex8JEULmBhYmKd5UhpiNA46T5wUko' }), /AT address/i);

const unsignedBytes = buildUnsignedQortiumAtMessageTransactionBytes({ ...fixture, message });
const view = new DataView(unsignedBytes.buffer, unsignedBytes.byteOffset, unsignedBytes.byteLength);
const recipient = base58Decode(fixture.recipient);

assert.equal(QORTIUM_MESSAGE_TRANSACTION_TYPE, 17);
assert.equal(QORTIUM_AT_MESSAGE_POW_DIFFICULTY, 12);
assert.equal(QORTIUM_AT_MESSAGE_MAX_BYTES, 4000);
assert.equal(unsignedBytes.length, 100 + Buffer.byteLength(message));
assert.equal(view.getInt32(0, false), 17);
assert.equal(view.getBigInt64(4, false), BigInt(fixture.timestamp));
assert.equal(view.getInt32(12, false), 0, 'MESSAGE must stay outside transaction groups');
assert.equal(view.getUint32(48, false), 0, 'MemoryPoW nonce starts cleared');
assert.equal(unsignedBytes[52], 1, 'MESSAGE must have an AT recipient');
assert.deepEqual([...unsignedBytes.slice(53, 78)], [...recipient]);
assert.equal(view.getBigInt64(78, false), 0n, 'MESSAGE must not carry a payment');
assert.equal(view.getInt32(86, false), Buffer.byteLength(message));
assert.equal(new TextDecoder().decode(unsignedBytes.slice(90, 95)), message);
assert.equal(unsignedBytes[95], 0, 'MESSAGE must not be encrypted');
assert.equal(unsignedBytes[96], 1, 'MESSAGE must be marked as text');
assert.equal(view.getBigInt64(97, false), 0n, 'MESSAGE must use fee=0 and MemoryPoW');
assert.equal(
  base58Encode(unsignedBytes),
  '111DsY3V2oBonzZUgu5fL6jhbjdneRYSPwDtJmGVfSqgbnVShELDvhr5MqWdtyhtLMbmV4gHrA8k5fbxrbUhMq9pKuCuePZoQ5Nd2M1yq8BsSp1RwUbuGzesvEPgwQ91oM9b1hk4UhhzK9',
);
assert.throws(
  () => buildUnsignedQortiumAtMessageTransactionBytes({ ...fixture, message: 'x'.repeat(4_001) }),
  /between 1 and 4,000 bytes/i,
);

console.log('Qortium AT MESSAGE serializer fixture passed.');
