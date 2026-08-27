import assert from 'node:assert/strict';

import {
  assertPublicArbitraryTransaction,
  assertPublicBuyNameTransaction,
  assertPublicCancelSellNameTransaction,
  assertPublicChatTransaction,
  assertPublicCreatePollTransaction,
  assertPublicJoinGroupTransaction,
  assertPublicLeaveGroupTransaction,
  assertPublicRegisterNameTransaction,
  assertPublicSellNameTransaction,
  assertPublicUpdateNameTransaction,
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

// FIX #9 (security review): mutate EACH field of an otherwise-valid CHAT
// build response and confirm assertPublicChatTransaction rejects it. This is
// the signing-boundary guard that stops Home from ever signing bytes a node
// build response tampered with — every field the node controls must be
// independently checked, not just the ones covered above.
function buildChatBytes({
  type = 18,
  ts = timestamp,
  group = 9,
  key = publicKey,
  nonce = 0,
  hasRecipient = 0,
  data = message,
  encrypted = 0,
  text = 1,
  fee = 0n,
  hasReference = 1,
  reference = chatReference,
  trailing = new Uint8Array(0),
} = {}) {
  return concat(
    int32(type), int64(ts), int32(group), key, int32(nonce),
    new Uint8Array([hasRecipient]), int32(data.length), data,
    new Uint8Array([encrypted, text]), int64(fee),
    new Uint8Array([hasReference]),
    ...(hasReference ? [reference] : []),
    trailing,
  );
}
// The helper's defaults must reproduce the known-good fixture bytes exactly,
// or the mutation tests below would be exercising a different transaction
// shape than the one actually pinned above.
assert.deepEqual(buildChatBytes(), chatBytes);

assert.throws(() => assertPublicChatTransaction(buildChatBytes({ type: 19 }), chatExpected), /transaction type/);
assert.throws(() => assertPublicChatTransaction(buildChatBytes({ ts: timestamp + 1 }), chatExpected), /timestamp/);
assert.throws(() => assertPublicChatTransaction(buildChatBytes({ group: 10 }), chatExpected), /transaction group ID/);
assert.throws(() => assertPublicChatTransaction(buildChatBytes({ key: sequence(32, 2) }), chatExpected), /account public key/);
// The unsigned build bytes must carry a zero nonce; the validator rejects any
// preset nonce so a node cannot smuggle in pre-computed work.
assert.throws(() => assertPublicChatTransaction(buildChatBytes({ nonce: 1 }), chatExpected), /nonce/);
assert.throws(() => assertPublicChatTransaction(buildChatBytes({ data: encoder.encode('other') }), chatExpected), /message/);
assert.throws(() => assertPublicChatTransaction(buildChatBytes({ encrypted: 1 }), chatExpected), /encrypted flag/);
assert.throws(() => assertPublicChatTransaction(buildChatBytes({ text: 0 }), chatExpected), /text flag/);
assert.throws(() => assertPublicChatTransaction(buildChatBytes({ fee: 1n }), chatExpected), /fee/);
assert.throws(() => assertPublicChatTransaction(buildChatBytes({ hasRecipient: 1 }), chatExpected), /recipient/);
assert.throws(() => assertPublicChatTransaction(buildChatBytes({ hasReference: 0 }), chatExpected), /chat reference/);
assert.throws(() => assertPublicChatTransaction(buildChatBytes({ reference: sequence(64, 200) }), chatExpected), /chat reference/);
assert.throws(() => assertPublicChatTransaction(buildChatBytes({ trailing: new Uint8Array([9]) }), chatExpected), /trailing bytes/);
// A message claiming no chat reference, checked against an expectation that
// doesn't require one, must still succeed (hasReference:0 is legitimate on
// its own — only a MISMATCH against `expected` is rejected).
assert.doesNotThrow(() => assertPublicChatTransaction(
  buildChatBytes({ hasReference: 0 }),
  { ...chatExpected, chatReference: undefined },
));

const joinBytes = concat(common(31), int32(12), int64(0));
const joinExpected = { groupId: 12, publicKey, timestamp, txGroupId: 0 };
assert.doesNotThrow(() => assertPublicJoinGroupTransaction(joinBytes, joinExpected));
assert.throws(
  () => assertPublicJoinGroupTransaction(joinBytes, { ...joinExpected, groupId: 13 }),
  /group ID/,
);
assert.throws(
  () => assertPublicJoinGroupTransaction(concat(joinBytes.slice(0, -8), sequence(32, 9), int64(0)), joinExpected),
  /unapproved minting public key/,
);
const mintingPublicKey = sequence(32, 55);
assert.doesNotThrow(() => assertPublicJoinGroupTransaction(
  concat(joinBytes.slice(0, -8), mintingPublicKey, int64(0)),
  { ...joinExpected, mintingPublicKey },
));

const leaveBytes = concat(common(32), int32(12), int64(0));
assert.doesNotThrow(() => assertPublicLeaveGroupTransaction(leaveBytes, joinExpected));
assert.throws(
  () => assertPublicLeaveGroupTransaction(concat(leaveBytes, new Uint8Array([1])), joinExpected),
  /trailing bytes/,
);

function arbitraryBytes({ method = 0, payments = 0, deleteShape = false } = {}) {
  const data = deleteShape ? new Uint8Array(0) : sequence(32, 33);
  return concat(
    common(10), sized('Polls'), sized('Polls'), int32(method), int32(0), int32(0), int32(payments),
    payments ? sequence(41, 4) : new Uint8Array(0), int32(1000), new Uint8Array([deleteShape ? 1 : 0]),
    int32(data.length), data, int32(deleteShape ? 0 : 1234), int32(0), int64(0),
  );
}
const arbitraryExpected = { identifier: 'Polls', method: 0, name: 'Polls', publicKey, service: 1000, txGroupId: 0 };
const arbitraryDetails = assertPublicArbitraryTransaction(arbitraryBytes(), arbitraryExpected);
assert.equal(arbitraryDetails.compression, 0);
assert.equal(arbitraryDetails.dataType, 0);
assert.equal(arbitraryDetails.rawSize, 1234);
assert.deepEqual(arbitraryDetails.data, sequence(32, 33));
assert.throws(() => assertPublicArbitraryTransaction(arbitraryBytes({ payments: 1 }), arbitraryExpected), /payments/);
assert.doesNotThrow(() => assertPublicArbitraryTransaction(
  arbitraryBytes({ deleteShape: true, method: 2 }),
  { ...arbitraryExpected, method: 2 },
));
assert.throws(() => assertPublicArbitraryTransaction(
  arbitraryBytes({ method: 2 }),
  { ...arbitraryExpected, method: 2 },
), /non-tombstone/);

// ---- The five name verifiers (types 3-7, Home 2.1 names restoration) ----

// Exactly the 3-byte UTF-8 BOM as a sized field (int32(3) + EF BB BF).
const bomField = concat(int32(3), encoder.encode('\uFEFF'));

// REGISTER_NAME (type 3)
const registerBytes = concat(common(3), sized('alice'), sized('{"a":1}'), int64(0));
const registerExpected = { data: '{"a":1}', name: 'alice', publicKey, timestamp, txGroupId: 0 };
assert.doesNotThrow(() => assertPublicRegisterNameTransaction(registerBytes, registerExpected));
assert.throws(() => assertPublicRegisterNameTransaction(registerBytes, { ...registerExpected, name: 'bob' }), /name/);
assert.throws(() => assertPublicRegisterNameTransaction(registerBytes, { ...registerExpected, data: '' }), /name data/);
assert.throws(() => assertPublicRegisterNameTransaction(concat(registerBytes, new Uint8Array([0])), registerExpected), /trailing/);
assert.throws(() => assertPublicRegisterNameTransaction(concat(common(4), sized('alice'), sized('{"a":1}'), int64(0)), registerExpected), /transaction type/);
// A non-zero fee must be rejected.
assert.throws(() => assertPublicRegisterNameTransaction(concat(common(3), sized('alice'), sized('{"a":1}'), int64(1)), registerExpected), /fee/);
// BOM bypass: a builder that encoded U+FEFF into approved-empty data must be
// caught — the decoder now preserves the BOM so the comparison fails.
assert.throws(
  () => assertPublicRegisterNameTransaction(concat(common(3), sized('alice'), bomField, int64(0)), { ...registerExpected, data: '' }),
  /name data/,
);

// UPDATE_NAME (type 4) — optional primary presence + value bytes.
const updateNoPrimary = concat(common(4), sized('alice'), sized(''), sized(''), new Uint8Array([0]), int64(0));
const updateNoPrimaryExpected = { name: 'alice', newData: '', newName: '', primary: undefined, publicKey, timestamp, txGroupId: 0 };
assert.doesNotThrow(() => assertPublicUpdateNameTransaction(updateNoPrimary, updateNoPrimaryExpected));
// A hasPrimary=1 body must match an expected primary; presence mismatch fails.
assert.throws(() => assertPublicUpdateNameTransaction(updateNoPrimary, { ...updateNoPrimaryExpected, primary: true }), /primary presence/);
const updatePrimaryTrue = concat(common(4), sized('alice'), sized('new'), sized('{}'), new Uint8Array([1, 1]), int64(0));
assert.doesNotThrow(() => assertPublicUpdateNameTransaction(updatePrimaryTrue, { name: 'alice', newData: '{}', newName: 'new', primary: true, publicKey, timestamp, txGroupId: 0 }));
assert.throws(() => assertPublicUpdateNameTransaction(updatePrimaryTrue, { name: 'alice', newData: '{}', newName: 'new', primary: false, publicKey, timestamp, txGroupId: 0 }), /primary value/);
// A flag byte of 2 (Core would treat as true) must be refused.
assert.throws(() => assertPublicUpdateNameTransaction(concat(common(4), sized('alice'), sized(''), sized(''), new Uint8Array([2]), int64(0)), updateNoPrimaryExpected), /primary presence flag/);
assert.throws(() => assertPublicUpdateNameTransaction(concat(common(4), sized('alice'), sized('new'), sized('{}'), new Uint8Array([1, 2]), int64(0)), { name: 'alice', newData: '{}', newName: 'new', primary: true, publicKey, timestamp, txGroupId: 0 }), /primary value/);
// BOM in approved-unchanged newData is caught.
assert.throws(() => assertPublicUpdateNameTransaction(concat(common(4), sized('alice'), sized(''), bomField, new Uint8Array([0]), int64(0)), updateNoPrimaryExpected), /new name data/);

// SELL_NAME (type 5) — atomic amount + optional 25-byte recipient.
const recipient = sequence(25, 200);
const sellPublic = concat(common(5), sized('alice'), int64(150_000_000), new Uint8Array([0]), int64(0));
assert.doesNotThrow(() => assertPublicSellNameTransaction(sellPublic, { amount: 150_000_000n, name: 'alice', publicKey, timestamp, txGroupId: 0 }));
// A signed-negative int64 amount cannot compare equal to an approved positive.
assert.throws(() => assertPublicSellNameTransaction(concat(common(5), sized('alice'), int64(-1), new Uint8Array([0]), int64(0)), { amount: 150_000_000n, name: 'alice', publicKey, timestamp, txGroupId: 0 }), /sale amount/);
const sellRestricted = concat(common(5), sized('alice'), int64(0), new Uint8Array([1]), recipient, int64(0));
assert.doesNotThrow(() => assertPublicSellNameTransaction(sellRestricted, { amount: 0n, name: 'alice', recipient, publicKey, timestamp, txGroupId: 0 }));
// Presence-flag mismatch (recipient bytes present but none approved) fails.
assert.throws(() => assertPublicSellNameTransaction(sellRestricted, { amount: 0n, name: 'alice', publicKey, timestamp, txGroupId: 0 }), /allowed-buyer presence/);
assert.throws(() => assertPublicSellNameTransaction(sellRestricted, { amount: 0n, name: 'alice', recipient: sequence(25, 1), publicKey, timestamp, txGroupId: 0 }), /allowed buyer/);
assert.throws(() => assertPublicSellNameTransaction(concat(common(5), sized('alice'), int64(0), new Uint8Array([2]), int64(0)), { amount: 0n, name: 'alice', publicKey, timestamp, txGroupId: 0 }), /recipient presence flag/);

// Common-field binding: mutating type, timestamp, group, public key, or the
// nonce must be rejected (checked on REGISTER, representative of readCommon).
assert.throws(() => assertPublicRegisterNameTransaction(registerBytes, { ...registerExpected, timestamp: timestamp + 1 }), /timestamp/);
assert.throws(() => assertPublicRegisterNameTransaction(registerBytes, { ...registerExpected, txGroupId: 1 }), /transaction group/);
assert.throws(() => assertPublicRegisterNameTransaction(registerBytes, { ...registerExpected, publicKey: sequence(32, 9) }), /public key/);
// A nonzero nonce (a non-canonical unsigned build) must be rejected.
assert.throws(() => assertPublicRegisterNameTransaction(concat(int32(3), int64(timestamp), int32(0), publicKey, int32(1), sized('alice'), sized('{"a":1}'), int64(0)), registerExpected), /nonce/);
// Per-action name mutations across the family.
assert.throws(() => assertPublicUpdateNameTransaction(updatePrimaryTrue, { name: 'bob', newData: '{}', newName: 'new', primary: true, publicKey, timestamp, txGroupId: 0 }), /name/);
assert.throws(() => assertPublicUpdateNameTransaction(updatePrimaryTrue, { name: 'alice', newData: '{}', newName: 'other', primary: true, publicKey, timestamp, txGroupId: 0 }), /new name/);
assert.throws(() => assertPublicSellNameTransaction(sellPublic, { amount: 150_000_000n, name: 'bob', publicKey, timestamp, txGroupId: 0 }), /name/);

// CANCEL_SELL_NAME (type 6)
const cancelBytes = concat(common(6), sized('alice'), int64(0));
assert.doesNotThrow(() => assertPublicCancelSellNameTransaction(cancelBytes, { name: 'alice', publicKey, timestamp, txGroupId: 0 }));
assert.throws(() => assertPublicCancelSellNameTransaction(cancelBytes, { name: 'bob', publicKey, timestamp, txGroupId: 0 }), /name/);

// BUY_NAME (type 7) — atomic amount + mandatory 25-byte seller.
const seller = sequence(25, 90);
const buyBytes = concat(common(7), sized('alice'), int64(1_250_000_000), seller, int64(0));
assert.doesNotThrow(() => assertPublicBuyNameTransaction(buyBytes, { amount: 1_250_000_000n, name: 'alice', seller, publicKey, timestamp, txGroupId: 0 }));
assert.throws(() => assertPublicBuyNameTransaction(buyBytes, { amount: 1_250_000_001n, name: 'alice', seller, publicKey, timestamp, txGroupId: 0 }), /purchase amount/);
assert.throws(() => assertPublicBuyNameTransaction(buyBytes, { amount: 1_250_000_000n, name: 'alice', seller: sequence(25, 1), publicKey, timestamp, txGroupId: 0 }), /seller/);
assert.throws(() => assertPublicBuyNameTransaction(buyBytes, { amount: 1_250_000_000n, name: 'bob', seller, publicKey, timestamp, txGroupId: 0 }), /name/);
// Truncated (missing fee) fails.
assert.throws(() => assertPublicBuyNameTransaction(concat(common(7), sized('alice'), int64(1_250_000_000), seller), { amount: 1_250_000_000n, name: 'alice', seller, publicKey, timestamp, txGroupId: 0 }), /malformed bytes|fee/);

// ---- Group mutation verifiers (types 22/23/33/34/49) against bytes built
// INDEPENDENTLY with this script's own encoders — never the module's builder,
// so a shared builder/verifier bug cannot pass both sides. ----
{
  const { assertUnsignedHomeV2GroupMutationTransaction } = await import('../dist-electron/home-v2-group-mutation-actions.js');
  const gmCommon = (type) => concat(int32(type), int64(timestamp), int32(0), publicKey, int32(0));
  const createBytes = concat(
    gmCommon(22), sized('droids'), sized('A place'), new Uint8Array([1, 40]), int32(4), int32(12), int64(0),
  );
  const createPayload = {
    action: 'CREATE_GROUP',
    request: { approvalThreshold: 'PCT40', description: 'A place', groupName: 'droids', isOpen: true, maximumBlockDelay: 12, minimumBlockDelay: 4 },
  };
  const gmExpected = (payload, nonce) => ({ ...(nonce === undefined ? {} : { nonce }), payload, senderPublicKey: publicKey, timestamp });
  assert.doesNotThrow(() => assertUnsignedHomeV2GroupMutationTransaction(createBytes, gmExpected(createPayload)));
  assert.throws(() => assertUnsignedHomeV2GroupMutationTransaction(createBytes, gmExpected({
    ...createPayload, request: { ...createPayload.request, approvalThreshold: 'PCT60' },
  })), /approval threshold/);
  // A flag byte of 2 (Core would read as true) is refused outright.
  assert.throws(() => assertUnsignedHomeV2GroupMutationTransaction(concat(
    gmCommon(22), sized('droids'), sized('A place'), new Uint8Array([2, 40]), int32(4), int32(12), int64(0),
  ), gmExpected(createPayload)), /open flag/);

  const updateBytes = concat(
    gmCommon(23), int32(7), sized(''), sized('Renamed place'), new Uint8Array([0, 1]), int32(5), int32(10), int64(0),
  );
  const updatePayload = {
    action: 'UPDATE_GROUP', groupId: 7,
    resolved: { approvalThreshold: 'ONE', description: 'Renamed place', isOpen: false, maximumBlockDelay: 10, minimumBlockDelay: 5, newName: '' },
  };
  assert.doesNotThrow(() => assertUnsignedHomeV2GroupMutationTransaction(updateBytes, gmExpected(updatePayload)));
  assert.throws(() => assertUnsignedHomeV2GroupMutationTransaction(updateBytes, gmExpected({
    ...updatePayload, groupId: 8,
  })), /group/);

  const pendingSig = sequence(64, 30);
  const { default: fakeBase58 } = await import('../dist-electron/base58.js').then((m) => ({ default: m }));
  const pendingSig58 = fakeBase58.base58Encode(pendingSig);
  const approvalBytes = concat(gmCommon(33), pendingSig, new Uint8Array([1]), int64(0));
  const approvalPayload = { action: 'GROUP_APPROVAL', approval: true, pendingSignature: pendingSig58 };
  assert.equal(approvalBytes.length, 125);
  assert.doesNotThrow(() => assertUnsignedHomeV2GroupMutationTransaction(approvalBytes, gmExpected(approvalPayload)));
  assert.throws(() => assertUnsignedHomeV2GroupMutationTransaction(approvalBytes, gmExpected({
    ...approvalPayload, approval: false,
  })), /approval decision/);

  const setGroupBytes = concat(gmCommon(34), int32(5), int64(0));
  assert.equal(setGroupBytes.length, 64);
  assert.doesNotThrow(() => assertUnsignedHomeV2GroupMutationTransaction(setGroupBytes, gmExpected({ action: 'SET_GROUP', defaultGroupId: 5 })));

  const clearAvatarBytes = concat(gmCommon(49), int32(5), new Uint8Array([0]), int64(0));
  assert.equal(clearAvatarBytes.length, 65);
  assert.doesNotThrow(() => assertUnsignedHomeV2GroupMutationTransaction(clearAvatarBytes, gmExpected({ action: 'SET_GROUP_AVATAR', avatar: null, groupId: 5 })));
  const setAvatarBytes = concat(gmCommon(49), int32(5), new Uint8Array([1]), int32(410), sized('Alice'), sized('group-avatar'), int64(0));
  const avatarPayload = {
    action: 'SET_GROUP_AVATAR',
    avatar: { identifier: 'group-avatar', name: 'Alice', service: 'THUMBNAIL', serviceId: 410 },
    groupId: 5,
  };
  assert.doesNotThrow(() => assertUnsignedHomeV2GroupMutationTransaction(setAvatarBytes, gmExpected(avatarPayload)));
  assert.throws(() => assertUnsignedHomeV2GroupMutationTransaction(setAvatarBytes, gmExpected({
    ...avatarPayload, avatar: { ...avatarPayload.avatar, identifier: 'other' },
  })), /avatar identifier/);
  // Stamped bytes verify only with the exact nonce.
  const stamped = new Uint8Array(setGroupBytes);
  new DataView(stamped.buffer).setUint32(48, 777, false);
  assert.throws(() => assertUnsignedHomeV2GroupMutationTransaction(stamped, gmExpected({ action: 'SET_GROUP', defaultGroupId: 5 })), /nonce/);
  assert.doesNotThrow(() => assertUnsignedHomeV2GroupMutationTransaction(stamped, gmExpected({ action: 'SET_GROUP', defaultGroupId: 5 }, 777)));
  // Trailing bytes refused.
  assert.throws(() => assertUnsignedHomeV2GroupMutationTransaction(concat(setGroupBytes, new Uint8Array([0])), gmExpected({ action: 'SET_GROUP', defaultGroupId: 5 })), /trailing/);
}

// ---- Rating verifiers (types 45/46) against bytes built INDEPENDENTLY with
// this script's own encoders — never the module's builder, so a shared
// builder/verifier bug cannot pass both sides. ----
{
  const { assertUnsignedHomeV2RatingTransaction } = await import('../dist-electron/home-v2-rating-actions.js');
  const { default: base58 } = await import('../dist-electron/base58.js').then((m) => ({ default: m }));
  const targetKeyBytes = sequence(32, 9);
  const targetKey58 = base58.base58Encode(targetKeyBytes);
  const rCommon = (type) => concat(int32(type), int64(timestamp), int32(0), publicKey, int32(0));
  const senderKey58 = base58.base58Encode(publicKey);
  // RATE_ACCOUNT: 52 prefix + 32 target + category i32 + rating i32 + fee i64 = 100.
  const negative = new Uint8Array(4);
  new DataView(negative.buffer).setInt32(0, -2, false);
  const accountBytes = concat(rCommon(46), targetKeyBytes, int32(2), negative, int64(0));
  assert.equal(accountBytes.byteLength, 100);
  const accountPayload = { action: 'RATE_ACCOUNT', category: 'TRAINER', categoryValue: 2, rating: -2, targetPublicKey: targetKey58 };
  const rExpected = (payload, nonce) => ({ ...(nonce === undefined ? {} : { nonce }), payload, senderPublicKey: senderKey58, timestamp });
  assert.doesNotThrow(() => assertUnsignedHomeV2RatingTransaction(accountBytes, rExpected(accountPayload)));
  assert.throws(() => assertUnsignedHomeV2RatingTransaction(accountBytes, rExpected({ ...accountPayload, categoryValue: 1, category: 'PLAYER' })), /category/);
  assert.throws(() => assertUnsignedHomeV2RatingTransaction(accountBytes, rExpected({ ...accountPayload, rating: 2 })), /rating/);
  // RATE_RESOURCE with the default (null) identifier: 52 + 4 + 4+5 + 4 + 4 + 8 = 81.
  const resourceBytes = concat(rCommon(45), int32(800), sized('Alice'), int32(0), int32(9), int64(0));
  assert.equal(resourceBytes.byteLength, 81);
  const resourcePayload = { action: 'RATE_RESOURCE', identifier: null, name: 'Alice', rating: 9, service: 'DOCUMENT', serviceId: 800 };
  assert.doesNotThrow(() => assertUnsignedHomeV2RatingTransaction(resourceBytes, rExpected(resourcePayload)));
  assert.throws(() => assertUnsignedHomeV2RatingTransaction(resourceBytes, rExpected({ ...resourcePayload, serviceId: 700 })), /service/);
  assert.throws(() => assertUnsignedHomeV2RatingTransaction(resourceBytes, rExpected({ ...resourcePayload, identifier: 'doc-1' })), /identifier/);
  // Stamped bytes verify only with the exact nonce; trailing bytes refused.
  const stamped = new Uint8Array(accountBytes);
  new DataView(stamped.buffer).setUint32(48, 4242, false);
  assert.throws(() => assertUnsignedHomeV2RatingTransaction(stamped, rExpected(accountPayload)), /nonce/);
  assert.doesNotThrow(() => assertUnsignedHomeV2RatingTransaction(stamped, rExpected(accountPayload, 4242)));
  assert.throws(() => assertUnsignedHomeV2RatingTransaction(concat(accountBytes, new Uint8Array([0])), rExpected(accountPayload)), /trailing/);
}

console.log('Public transaction validation tests passed.');
