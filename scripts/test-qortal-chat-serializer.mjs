import assert from 'node:assert/strict';
import {
  assertOpenQortalGroupMetadata,
  assertPositiveQortalGroupId,
  assertValidQortalChatSignature,
  buildQortalAccountGroupsPath,
  buildQortalGroupChatPayload,
  buildUnsignedQortalGroupChatTransactionBytes,
  QORTAL_CHAT_MAX_DATA_SIZE,
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
assert.deepEqual(
  assertOpenQortalGroupMetadata({ groupName: 'Test Group', isOpen: true }, fixture.txGroupId),
  { groupLabel: 'Test Group (1091)', groupName: 'Test Group' },
);
assert.throws(
  () => assertOpenQortalGroupMetadata({ groupName: 'Private Group', isOpen: false }, fixture.txGroupId),
  /private-group encryption is not supported yet/i,
);
assert.throws(
  () => assertOpenQortalGroupMetadata({ groupName: 'Unknown Group' }, fixture.txGroupId),
  /could not verify that this Qortal group is public/i,
);
assert.throws(
  () => assertOpenQortalGroupMetadata({ isOpen: 'true' }, fixture.txGroupId),
  /could not verify that this Qortal group is public/i,
);
assert.equal(unsignedBytes.length, 393);
assert.equal(base58Encode(unsignedBytes), fixture.expectedUnsignedBase58);

const stampedBytes = stampQortalGroupChatNonce(unsignedBytes, 12345);
assert.notDeepEqual(stampedBytes, unsignedBytes);
assert.deepEqual([...unsignedBytes.slice(QORTAL_GROUP_CHAT_NONCE_OFFSET, QORTAL_GROUP_CHAT_NONCE_OFFSET + 4)], [0, 0, 0, 0]);
assert.deepEqual([...stampedBytes.slice(QORTAL_GROUP_CHAT_NONCE_OFFSET, QORTAL_GROUP_CHAT_NONCE_OFFSET + 4)], [0, 0, 48, 57]);
assert.throws(() => assertValidQortalChatSignature('1111111111'), /64-byte signature/i);

console.log('Qortal CHAT serializer fixture passed.');
