import assert from 'node:assert/strict';
import {
  buildAccountAvatarPath,
  buildAccountAvatarPublishResource,
  buildAvatarInfoPath,
  buildAvatarResourcePath,
  buildGroupAvatarPublishResource,
  buildLegacyAccountAvatarResource,
  buildLegacyGroupAvatarResource,
  buildSetAccountAvatarTransactionBody,
  buildGroupAvatarPendingResult,
  buildGroupAvatarPath,
  buildSetGroupAvatarTransactionBody,
  getGroupAvatarContentType,
  getGroupAvatarGroupId,
  getGroupAvatarMaxBytes,
  getGroupAvatarRetryAfterSeconds,
  getAvatarDescriptor,
  getAvatarDescriptorFromHeaders,
  getAvatarImageContentType,
  getOptionalAvatarPointer,
  GROUP_AVATAR_MAX_BYTES,
} from './qdn-group-avatar-input.js';
import {
  QDN_APP_BRIDGE_ACTIONS,
  QDN_GROUP_ACTIONS,
  QDN_PUBLIC_NODE_BRIDGE_ACTIONS,
} from './qdn-app-actions.js';

const pointer = { service: 'THUMBNAIL', name: 'alice', identifier: 'avatar' };

assert.equal(getGroupAvatarGroupId('42'), 42);
assert.throws(() => getGroupAvatarGroupId(0), /positive integer/);
assert.equal(getOptionalAvatarPointer(null), null);
assert.deepEqual(getOptionalAvatarPointer(pointer), pointer);
assert.deepEqual(getOptionalAvatarPointer({ service: 'THUMBNAIL', name: 'alice' }), {
  service: 'THUMBNAIL', name: 'alice', identifier: '',
});
assert.throws(() => getOptionalAvatarPointer('signature'), /object containing service/);
assert.throws(() => getOptionalAvatarPointer({ service: 'THUMBNAIL', name: '', identifier: 'avatar' }), /non-empty/);
assert.throws(() => getOptionalAvatarPointer({ service: 'THUMBNAIL', name: 'alice', identifier: 42 }), /object containing service/);
assert.equal(buildGroupAvatarPath(42), '/groups/42/avatar');
assert.equal(buildAccountAvatarPath('Qabc'), '/addresses/Qabc/avatar');
assert.equal(buildAvatarInfoPath('group', 42), '/groups/42/avatar/info');
assert.equal(buildAvatarInfoPath('account', 'Qabc'), '/addresses/Qabc/avatar/info');
assert.deepEqual(buildAccountAvatarPublishResource('alice'), { service: 'THUMBNAIL', name: 'alice', identifier: 'avatar' });
assert.deepEqual(buildGroupAvatarPublishResource('alice', 42), { service: 'THUMBNAIL', name: 'alice', identifier: 'qortium-group-avatar-v1-42' });
assert.deepEqual(buildLegacyAccountAvatarResource('alice', 'qortal-hub'), { service: 'THUMBNAIL', name: 'alice', identifier: 'qortal_avatar' });
assert.deepEqual(buildLegacyGroupAvatarResource('alice', 42), { service: 'THUMBNAIL', name: 'alice', identifier: 'qortal_group_avatar_42' });
assert.equal(buildAvatarResourcePath(buildLegacyAccountAvatarResource('alice', 'qortium')), '/arbitrary/THUMBNAIL/alice/avatar?async=true');
assert.equal(getGroupAvatarMaxBytes(undefined), GROUP_AVATAR_MAX_BYTES);
assert.equal(getGroupAvatarMaxBytes(GROUP_AVATAR_MAX_BYTES * 2), GROUP_AVATAR_MAX_BYTES);
assert.deepEqual(buildGroupAvatarPendingResult(42, '5'), {
  groupId: 42,
  status: 'PENDING',
  retryAfterSeconds: 5,
  source: 'POINTER',
  descriptor: null,
});
assert.equal(getGroupAvatarRetryAfterSeconds('Wed, 22 Jul 2026 16:00:05 GMT', Date.UTC(2026, 6, 22, 16, 0, 0)), 5);
assert.equal(getGroupAvatarRetryAfterSeconds('invalid'), null);
assert.equal(
  getGroupAvatarContentType('application/octet-stream', new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
  'application/octet-stream',
);
assert.equal(getAvatarImageContentType('application/octet-stream', new Uint8Array([0x25, 0x50, 0x44, 0x46])), null);
assert.equal(getAvatarImageContentType('image/png', new Uint8Array([0x25, 0x50, 0x44, 0x46])), null);
assert.equal(getAvatarImageContentType('image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
assert.equal(
  getAvatarImageContentType('application/octet-stream', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/png',
);
assert.deepEqual(getAvatarDescriptor({ service: 'THUMBNAIL', name: 'alice', identifier: 'avatar' }), {
  service: 'THUMBNAIL', name: 'alice', identifier: 'avatar',
});
assert.equal(getAvatarDescriptor({ service: '', name: 'alice' }), null);
assert.deepEqual(getAvatarDescriptor({ service: 'THUMBNAIL', name: 'alice', identifier: ' ' }), {
  service: 'THUMBNAIL', name: 'alice', identifier: ' ',
});
const descriptorHeaders = new Map([
  ['x-qortium-avatar-service', 'THUMBNAIL'],
  ['x-qortium-avatar-name', 'custom-publisher'],
  ['x-qortium-avatar-identifier', 'custom-identifier'],
]);
assert.deepEqual(
  getAvatarDescriptorFromHeaders((header) => descriptorHeaders.get(header)),
  { service: 'THUMBNAIL', name: 'custom-publisher', identifier: 'custom-identifier' },
);
descriptorHeaders.set('x-qortium-avatar-identifier', '');
assert.deepEqual(
  getAvatarDescriptorFromHeaders((header) => descriptorHeaders.get(header)),
  { service: 'THUMBNAIL', name: 'custom-publisher', identifier: '' },
);
assert.equal(
  getGroupAvatarContentType('application/octet-stream', new Uint8Array([0xff, 0xd8, 0xff, 0xe0])),
  'image/jpeg',
);
assert.deepEqual(
  buildSetAccountAvatarTransactionBody({ avatar: null, fee: 0, ownerPublicKey: 'owner-public-key', timestamp: 123 }),
  { type: 'SET_ACCOUNT_AVATAR', timestamp: 123, txGroupId: 0, fee: 0, ownerPublicKey: 'owner-public-key', avatar: null },
);
assert.equal(
  getGroupAvatarContentType('image/webp', new Uint8Array([0x01, 0x02, 0x03])),
  'image/webp',
);
assert.deepEqual(
  buildSetGroupAvatarTransactionBody({
    avatar: pointer,
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
    avatar: pointer,
  },
);

assert(QDN_GROUP_ACTIONS.includes('SET_GROUP_AVATAR'));
assert(QDN_APP_BRIDGE_ACTIONS.includes('SET_ACCOUNT_AVATAR'));
assert(QDN_APP_BRIDGE_ACTIONS.includes('FETCH_ACCOUNT_AVATAR'));
assert(QDN_APP_BRIDGE_ACTIONS.includes('SET_GROUP_AVATAR'));
assert(QDN_APP_BRIDGE_ACTIONS.includes('FETCH_GROUP_AVATAR'));
assert(QDN_PUBLIC_NODE_BRIDGE_ACTIONS.includes('FETCH_GROUP_AVATAR'));
assert(!QDN_PUBLIC_NODE_BRIDGE_ACTIONS.includes('SET_GROUP_AVATAR'));
assert(!QDN_PUBLIC_NODE_BRIDGE_ACTIONS.includes('SET_ACCOUNT_AVATAR'));

console.log('QDN group avatar contract tests passed.');
