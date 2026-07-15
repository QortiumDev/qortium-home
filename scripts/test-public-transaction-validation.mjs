import assert from 'node:assert/strict';

import {
  assertPublicArbitraryTransaction,
  assertPublicChatTransaction,
  assertPublicCreatePollTransaction,
  assertPublicUpdatePollTransaction,
  assertPublicVoteOnPollTransaction,
} from '../dist-electron/public-transaction-validation.js';
import { parsePublicPollCapabilities } from '../dist-electron/public-poll-capabilities.js';
import { QDN_PUBLIC_NODE_BRIDGE_ACTIONS } from '../dist-electron/qdn-app-actions.js';

const encoder = new TextEncoder();

const capabilities = parsePublicPollCapabilities({
  actions: ['CREATE_POLL', 'VOTE_ON_POLL', 'UPDATE_POLL'],
  mempowFeeAlternativeDifficulty: 12,
  protocolVersion: 1,
});
assert.equal(capabilities.mempowFeeAlternativeDifficulty, 12);
assert.equal(QDN_PUBLIC_NODE_BRIDGE_ACTIONS.includes('VOTE_ON_POLL'), false);
assert.throws(() => parsePublicPollCapabilities({
  actions: ['VOTE_ON_POLL'],
  mempowFeeAlternativeDifficulty: 12,
  protocolVersion: 1,
}), /all poll write actions/);
assert.throws(() => parsePublicPollCapabilities({
  actions: ['CREATE_POLL', 'VOTE_ON_POLL', 'UPDATE_POLL'],
  mempowFeeAlternativeDifficulty: 0,
  protocolVersion: 1,
}), /compatible poll builder/);

function concat(...chunks) {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function int32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, false);
  return bytes;
}

function int64(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, BigInt(value), false);
  return bytes;
}

function sized(value) {
  const bytes = encoder.encode(value ?? '');
  return concat(int32(bytes.length), bytes);
}

function sequence(length, start) {
  return Uint8Array.from({ length }, (_, index) => (start + index) & 0xff);
}

const timestamp = 1_720_000_000_123;
const publicKey = sequence(32, 1);
const owner = sequence(25, 71);
const common = (type, group = 0) => concat(int32(type), int64(timestamp), int32(group), publicKey, int32(0));

const createBytes = concat(
  common(8, 7), owner, sized('Lunch?'), sized('Choose'), int32(2), sized('Soup'), sized('Salad'),
  new Uint8Array([3]), int64(timestamp + 1_000), int64(timestamp + 2_000), int64(0),
);
const createExpected = {
  description: 'Choose', endTime: timestamp + 2_000, owner, pollName: 'Lunch?',
  pollOptions: ['Soup', 'Salad'], publicKey, startTime: timestamp + 1_000, timestamp, txGroupId: 7,
};
assert.doesNotThrow(() => assertPublicCreatePollTransaction(createBytes, createExpected));
assert.throws(() => assertPublicCreatePollTransaction(concat(createBytes, new Uint8Array([1])), createExpected), /malformed poll times|trailing bytes/);
assert.throws(() => assertPublicCreatePollTransaction(createBytes, { ...createExpected, pollName: 'Dinner?' }), /poll name/);

const voteBytes = concat(common(9), int32(42), int32(2), int32(1), int32(3), int64(0));
const voteExpected = { optionIndexes: [1, 3], pollId: 42, publicKey, timestamp, txGroupId: 0 };
assert.doesNotThrow(() => assertPublicVoteOnPollTransaction(voteBytes, voteExpected));
assert.throws(() => assertPublicVoteOnPollTransaction(voteBytes, { ...voteExpected, optionIndexes: [1, 2] }), /option indexes/);

const updateBytes = concat(
  common(47), int32(42), sized('Lunch extended'), sized('Choose again'), int32(2), sized('Soup'), sized('Salad'),
  int64(timestamp + 3_000), int64(0),
);
const updateExpected = {
  endTime: timestamp + 3_000, newDescription: 'Choose again', newPollName: 'Lunch extended',
  newPollOptions: ['Soup', 'Salad'], pollId: 42, publicKey, timestamp, txGroupId: 0,
};
assert.doesNotThrow(() => assertPublicUpdatePollTransaction(updateBytes, updateExpected));
assert.throws(() => assertPublicUpdatePollTransaction(updateBytes, { ...updateExpected, newPollOptions: ['Soup', 'Stew'] }), /poll options/);

const message = encoder.encode('hello');
const chatReference = sequence(64, 120);
const chatBytes = concat(
  common(18, 9), new Uint8Array([0]), int32(message.length), message, new Uint8Array([0, 1]), int64(0),
  new Uint8Array([1]), chatReference,
);
const chatExpected = { chatReference, data: message, publicKey, timestamp, txGroupId: 9 };
assert.doesNotThrow(() => assertPublicChatTransaction(chatBytes, chatExpected));
assert.throws(() => assertPublicChatTransaction(chatBytes, { ...chatExpected, data: encoder.encode('other') }), /message/);

function arbitraryBytes({ method = 0, payments = 0, deleteShape = false } = {}) {
  const data = deleteShape ? new Uint8Array(0) : sequence(32, 33);
  return concat(
    common(10), sized('Polls'), sized('Polls'), int32(method), int32(0), int32(0), int32(payments),
    payments ? sequence(41, 4) : new Uint8Array(0), int32(1000), new Uint8Array([deleteShape ? 1 : 0]),
    int32(data.length), data, int32(deleteShape ? 0 : 1234), int32(0), int64(0),
  );
}
const arbitraryExpected = { identifier: 'Polls', method: 0, name: 'Polls', publicKey, service: 1000, txGroupId: 0 };
assert.doesNotThrow(() => assertPublicArbitraryTransaction(arbitraryBytes(), arbitraryExpected));
assert.throws(() => assertPublicArbitraryTransaction(arbitraryBytes({ payments: 1 }), arbitraryExpected), /payments/);
assert.doesNotThrow(() => assertPublicArbitraryTransaction(
  arbitraryBytes({ deleteShape: true, method: 2 }),
  { ...arbitraryExpected, method: 2 },
));
assert.throws(() => assertPublicArbitraryTransaction(
  arbitraryBytes({ method: 2 }),
  { ...arbitraryExpected, method: 2 },
), /non-tombstone/);

console.log('Public transaction validation tests passed.');
