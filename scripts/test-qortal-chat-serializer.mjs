import assert from 'node:assert/strict';
import {
  assertOpenQortalGroupMetadata,
  assertPositiveQortalGroupId,
  assertValidQortalChatSignature,
  buildQortalAccountGroupsPath,
  buildQortalGroupChatPayload,
  buildUnsignedQortalGroupChatTransactionBytes,
  qortalChatPowDifficultyForBalance,
  qortalChatPowDifficultyForBalanceResponse,
  QORTAL_CHAT_MAX_DATA_SIZE,
  QORTAL_CHAT_POW_DIFFICULTY_ABOVE,
  QORTAL_CHAT_POW_DIFFICULTY_BELOW,
  QORTAL_CHAT_POW_QORT_THRESHOLD,
  QORTAL_GROUP_CHAT_NONCE_OFFSET,
  stampQortalGroupChatNonce,
} from '../dist-electron/qortal-chat.js';
import { base58Encode } from '../dist-electron/qortal-payment.js';

const fixture = {
  expectedUnsignedBase58:
    '111puKcvjXdF8UvKoESwyLhRBefn3bGErGgFpspw7do9J5G6E1EBAoimWR2W2ht2fXD679HkyQzgknWiXqLhSbkbBypnCYeoqXUNur5aR9deBN5YUgWniHijfYXGeHnToUMCncL2xxvz3qYyQnWVHcPnaRAre76qTH7oe3oTUDKY1ikFgrTeVTCfXEnTHcnPPCnuV4ZoFJkP1MdGFR2hzFrbRQJN3wePQMySDwdVAwgpbdHgKRK5E5Hn8VFaYm3q6MRtjJZwPFLbnmKUJzffFhEoSJ2GhB5j9CjSdjgGZ23htweWdvur8arpyBT4AjSKZ91vA6U7YHoU8ZSVqXeugD13syonEVb7NyLbenWXxeKyAx5UwBtingPbN1zroud8KQmzEYgippuTYLaM3hHkoJ2AafkFd5PJzo4zGVFEBbgkLVhbpQAeBVJf83jgNGcgJDKNEBGSyJscvSSK5Npac1N3ou5mC878MTAHcBWiN5hVAf4VqvG3URDrNtEdat7EcKz1hnzw4LaqHiCsCzbLZY3',
  lastReference: '4Y71jXwWnrCyC8mcEQE5n7o3d65iBf3w6c9MqdfwuGQHzu7XM1mWrJbRvtaoSjaHmKueeEXGwutyLZePwGXuNK2w',
  senderPublicKey: 'FNoQheiUBkwbsTeVYT3A7RCAbFSQq6XdokEGv5JXi7uM',
  timestamp: 1783444426299,
  txGroupId: 1091,
};

const message = buildQortalGroupChatPayload({
  specialId: 'test-special',
  text: 'Hello ChibiHub\nLine 2',
});
const unsignedBytes = buildUnsignedQortalGroupChatTransactionBytes({
  lastReference: fixture.lastReference,
  message,
  senderPublicKey: fixture.senderPublicKey,
  timestamp: fixture.timestamp,
  txGroupId: fixture.txGroupId,
});

assert.equal(QORTAL_CHAT_MAX_DATA_SIZE, 4000);
assert.equal(QORTAL_GROUP_CHAT_NONCE_OFFSET, 112);
assert.equal(assertPositiveQortalGroupId('1091'), fixture.txGroupId);
assert.throws(() => assertPositiveQortalGroupId(0), /positive integer/i);
assert.equal(
  buildQortalAccountGroupsPath('Qabc'),
  '/groups/member/Qabc?limit=0&reverse=true',
);
// FIX #6 (security review): assertOpenQortalGroupMetadata now also binds the
// response to the requested txGroupId, not just isOpen. Real Qortal group
// metadata always includes groupId (org.qortal.data.group.GroupData), so this
// fixture is updated to include it — a deliberate pin update, not a weakening.
assert.deepEqual(
  assertOpenQortalGroupMetadata({ groupId: fixture.txGroupId, groupName: 'Test Group', isOpen: true }, fixture.txGroupId),
  { groupLabel: 'Test Group (1091)', groupName: 'Test Group' },
);
assert.throws(
  () => assertOpenQortalGroupMetadata({ groupId: fixture.txGroupId, groupName: 'Private Group', isOpen: false }, fixture.txGroupId),
  /private-group encryption is not supported yet/i,
);
assert.throws(
  () => assertOpenQortalGroupMetadata({ groupName: 'Unknown Group' }, fixture.txGroupId),
  /could not verify that this Qortal group is public/i,
);
assert.throws(
  () => assertOpenQortalGroupMetadata({ groupId: fixture.txGroupId, isOpen: 'true' }, fixture.txGroupId),
  /could not verify that this Qortal group is public/i,
);
// groupId binding: isOpen:true for the WRONG group (or a missing groupId)
// must be rejected, even though isOpen itself checks out.
assert.throws(
  () => assertOpenQortalGroupMetadata({ groupId: fixture.txGroupId + 1, groupName: 'Other Group', isOpen: true }, fixture.txGroupId),
  /could not verify that this Qortal group is public/i,
);
assert.throws(
  () => assertOpenQortalGroupMetadata({ groupName: 'No Group Id', isOpen: true }, fixture.txGroupId),
  /could not verify that this Qortal group is public/i,
);
assert.throws(
  () => assertOpenQortalGroupMetadata({ groupId: '1092', groupName: 'String Mismatch', isOpen: true }, fixture.txGroupId),
  /could not verify that this Qortal group is public/i,
);
assert.doesNotThrow(
  () => assertOpenQortalGroupMetadata({ groupId: '1091', groupName: 'String Match', isOpen: true }, fixture.txGroupId),
);

// FIX #3 (security review): Qortal CHAT proof-of-work difficulty is set by
// Core purely from the sender's confirmed QORT balance (>= 4 QORT raw => 8
// leading-zero bits, else 18), not by height/timestamp.
assert.equal(QORTAL_CHAT_POW_QORT_THRESHOLD, 400_000_000n);
assert.equal(QORTAL_CHAT_POW_DIFFICULTY_ABOVE, 8);
assert.equal(QORTAL_CHAT_POW_DIFFICULTY_BELOW, 18);
assert.equal(qortalChatPowDifficultyForBalance(QORTAL_CHAT_POW_QORT_THRESHOLD), QORTAL_CHAT_POW_DIFFICULTY_ABOVE);
assert.equal(qortalChatPowDifficultyForBalance(QORTAL_CHAT_POW_QORT_THRESHOLD - 1n), QORTAL_CHAT_POW_DIFFICULTY_BELOW);
assert.equal(qortalChatPowDifficultyForBalance(QORTAL_CHAT_POW_QORT_THRESHOLD + 1n), QORTAL_CHAT_POW_DIFFICULTY_ABOVE);
assert.equal(qortalChatPowDifficultyForBalance(0n), QORTAL_CHAT_POW_DIFFICULTY_BELOW);
// number inputs (not just bigint) at/around the same threshold.
assert.equal(qortalChatPowDifficultyForBalance(400_000_000), QORTAL_CHAT_POW_DIFFICULTY_ABOVE);
assert.equal(qortalChatPowDifficultyForBalance(399_999_999), QORTAL_CHAT_POW_DIFFICULTY_BELOW);
assert.equal(qortalChatPowDifficultyForBalance(400_000_001), QORTAL_CHAT_POW_DIFFICULTY_ABOVE);
// response-shape fallback: anything that isn't a clean decimal QORT amount
// (missing, wrong type, malformed) falls back to the SAFER higher difficulty
// rather than throwing or silently under-computing — a slower send beats one
// Core rejects for insufficient proof-of-work.
assert.equal(qortalChatPowDifficultyForBalanceResponse('4.00000000'), QORTAL_CHAT_POW_DIFFICULTY_ABOVE);
assert.equal(qortalChatPowDifficultyForBalanceResponse('3.99999999'), QORTAL_CHAT_POW_DIFFICULTY_BELOW);
assert.equal(qortalChatPowDifficultyForBalanceResponse(4), QORTAL_CHAT_POW_DIFFICULTY_ABOVE);
assert.equal(qortalChatPowDifficultyForBalanceResponse(null), QORTAL_CHAT_POW_DIFFICULTY_BELOW);
assert.equal(qortalChatPowDifficultyForBalanceResponse(undefined), QORTAL_CHAT_POW_DIFFICULTY_BELOW);
assert.equal(qortalChatPowDifficultyForBalanceResponse({}), QORTAL_CHAT_POW_DIFFICULTY_BELOW);
assert.equal(qortalChatPowDifficultyForBalanceResponse('not-a-decimal'), QORTAL_CHAT_POW_DIFFICULTY_BELOW);
assert.equal(qortalChatPowDifficultyForBalanceResponse('4.123456789'), QORTAL_CHAT_POW_DIFFICULTY_BELOW);
assert.equal(unsignedBytes.length, 393);
assert.equal(base58Encode(unsignedBytes), fixture.expectedUnsignedBase58);

const stampedBytes = stampQortalGroupChatNonce(unsignedBytes, 12345);
assert.notDeepEqual(stampedBytes, unsignedBytes);
assert.deepEqual([...unsignedBytes.slice(QORTAL_GROUP_CHAT_NONCE_OFFSET, QORTAL_GROUP_CHAT_NONCE_OFFSET + 4)], [0, 0, 0, 0]);
assert.deepEqual([...stampedBytes.slice(QORTAL_GROUP_CHAT_NONCE_OFFSET, QORTAL_GROUP_CHAT_NONCE_OFFSET + 4)], [0, 0, 48, 57]);
assert.throws(() => assertValidQortalChatSignature('1111111111'), /64-byte signature/i);

console.log('Qortal CHAT serializer fixture passed.');
