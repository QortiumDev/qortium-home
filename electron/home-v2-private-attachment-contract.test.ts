import assert from 'node:assert/strict'

import { base58Encode } from './base58.js'
import { getHomeV2AppActions } from './home-v2-app-actions.js'
import {
  createHomeV2PrivateAttachmentDescriptor,
  HOME_V2_PRIVATE_ATTACHMENT_ACTIONS,
  normalizeHomeV2PrivateAttachmentAccessRequest,
  normalizeHomeV2PrivateAttachmentDescriptor,
  normalizeHomeV2PrivateAttachmentPublishRequest,
} from './home-v2-private-attachment-contract.js'

for (const protocol of ['qdnRequest', 'qortalRequest'] as const) {
  const actions = getHomeV2AppActions(protocol)
  for (const action of HOME_V2_PRIVATE_ATTACHMENT_ACTIONS) {
    assert.equal(actions.includes(action), true, `${protocol} must advertise ${action}`)
  }
}

const sourceToken = '123e4567-e89b-42d3-a456-426614174000'
const signature = base58Encode(new Uint8Array(64).fill(7))
const descriptor = createHomeV2PrivateAttachmentDescriptor({
  ciphertextHash: 'ab'.repeat(32),
  ciphertextSize: 512,
  codec: 'qenc-v2-direct',
  conversation: { kind: 'direct', otherAddress: 'Qaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  identifier: 'private-7ca1',
  name: 'Alice',
  network: 'qortium',
  service: 'QCHAT_ATTACHMENT_PRIVATE',
  transactionSignature: signature,
})

assert.deepEqual(normalizeHomeV2PrivateAttachmentPublishRequest('qdnRequest', {
  conversation: { kind: 'group', groupId: '12' },
  network: 'qortium',
  sourceToken,
}), {
  conversation: { kind: 'group', groupId: 12 },
  sourceToken,
})
assert.deepEqual(normalizeHomeV2PrivateAttachmentAccessRequest('qdnRequest', { descriptor }), { descriptor })
assert.throws(
  () => normalizeHomeV2PrivateAttachmentPublishRequest('qdnRequest', {
    bytesBase64: 'plaintext',
    conversation: { kind: 'group', groupId: 12 },
    sourceToken,
  }),
  /never paths or inline bytes/,
)
assert.throws(
  () => normalizeHomeV2PrivateAttachmentPublishRequest('qdnRequest', {
    conversation: { kind: 'group', groupId: 12 },
    network: 'qortal',
    sourceToken,
  }),
  /authoritative qortium bridge/,
)
assert.throws(
  () => normalizeHomeV2PrivateAttachmentDescriptor('qortalRequest', descriptor),
  /authoritative qortal bridge/,
)
assert.throws(
  () => normalizeHomeV2PrivateAttachmentDescriptor('qdnRequest', {
    ...descriptor,
    ciphertext: { ...descriptor.ciphertext, hash: 'ff'.repeat(32) },
    codec: 'qortal-qatt-direct-v1',
  }),
  /codec does not match/,
)
assert.throws(
  () => normalizeHomeV2PrivateAttachmentDescriptor('qdnRequest', {
    ...descriptor,
    resource: { ...descriptor.resource, identifier: '..' },
  }),
  /dot segments/,
)

const qortalImage = createHomeV2PrivateAttachmentDescriptor({
  ciphertextHash: 'cd'.repeat(32),
  ciphertextSize: 1_024,
  codec: 'qortal-hub-group-image-v1',
  conversation: { groupId: 12, kind: 'group' },
  identifier: 'grp-q-manager_0_group_12_1234',
  name: 'Alice',
  network: 'qortal',
  service: 'IMAGE',
  transactionSignature: signature,
})
assert.equal(qortalImage.codec, 'qortal-hub-group-image-v1')
assert.throws(
  () => normalizeHomeV2PrivateAttachmentDescriptor('qortalRequest', {
    ...qortalImage,
    resource: { ...qortalImage.resource, service: 'QCHAT_ATTACHMENT_PRIVATE' },
  }),
  /service does not match/,
)

console.log('Home v2 private-attachment contract tests passed')
