import assert from 'node:assert/strict';
import {
  buildGroupAvatarPath,
  buildSetGroupAvatarTransactionBody,
  getGroupAvatarGroupId,
  getGroupAvatarMaxBytes,
  getOptionalGroupAvatarSignature,
  GROUP_AVATAR_MAX_BYTES,
} from './qdn-group-avatar-input.js';
import {
  QDN_APP_BRIDGE_ACTIONS,
  QDN_GROUP_ACTIONS,
  QDN_PUBLIC_NODE_BRIDGE_ACTIONS,
} from './qdn-app-actions.js';

const signature = '1'.repeat(64);

assert.equal(getGroupAvatarGroupId('42'), 42);
assert.throws(() => getGroupAvatarGroupId(0), /positive integer/);
assert.equal(getOptionalGroupAvatarSignature(null), null);
assert.equal(getOptionalGroupAvatarSignature(signature), signature);
assert.throws(() => getOptionalGroupAvatarSignature('2'.repeat(64)), /64-byte/);
assert.throws(() => getOptionalGroupAvatarSignature('0'.repeat(64)), /base58/);
assert.equal(buildGroupAvatarPath(42), '/groups/42/avatar');
assert.equal(getGroupAvatarMaxBytes(undefined), GROUP_AVATAR_MAX_BYTES);
assert.equal(getGroupAvatarMaxBytes(GROUP_AVATAR_MAX_BYTES * 2), GROUP_AVATAR_MAX_BYTES);
assert.deepEqual(
  buildSetGroupAvatarTransactionBody({
    avatarSignature: signature,
    fee: 0,
    groupId: 42,
    ownerPublicKey: 'owner-public-key',
    timestamp: 123,
    txGroupId: 0,
  }),
  {
    type: 'SET_GROUP_AVATAR',
    timestamp: 123,
    txGroupId: 0,
    fee: 0,
    ownerPublicKey: 'owner-public-key',
    groupId: 42,
    avatarSignature: signature,
  },
);

assert(QDN_GROUP_ACTIONS.includes('SET_GROUP_AVATAR'));
assert(QDN_APP_BRIDGE_ACTIONS.includes('SET_GROUP_AVATAR'));
assert(QDN_APP_BRIDGE_ACTIONS.includes('FETCH_GROUP_AVATAR'));
assert(QDN_PUBLIC_NODE_BRIDGE_ACTIONS.includes('FETCH_GROUP_AVATAR'));
assert(!QDN_PUBLIC_NODE_BRIDGE_ACTIONS.includes('SET_GROUP_AVATAR'));

console.log('QDN group avatar contract tests passed.');
