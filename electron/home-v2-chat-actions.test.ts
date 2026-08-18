import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  assertHomeV2OpenPublicGroup,
  buildHomeV2QortiumPublicChatBuildBody,
  createHomeV2UnknownChatBroadcastResult,
  getHomeV2PublicChatActions,
  normalizeHomeV2ChatReference,
  normalizeHomeV2PublicChatReferenceTarget,
  normalizeHomeV2PublicChatRequest,
} from './home-v2-chat-actions.js'

const fixture = JSON.parse(readFileSync(
  new URL('../scripts/fixtures/qortal-chat-interop-v1.json', import.meta.url),
  'utf8',
)) as {
  accounts: {
    alice: { publicKeyBase58: string }
    bob: { publicKeyBase58: string }
  }
  common: { chatReferenceBase58: string; groupId: number }
  publicGroup: { payloads: { edit: string; reaction: string } }
}

const reference = fixture.common.chatReferenceBase58
const senderPublicKey = fixture.accounts.alice.publicKeyBase58
const otherPublicKey = fixture.accounts.bob.publicKeyBase58

assert.deepEqual(getHomeV2PublicChatActions('qdnRequest'), [
  'SEND_CHAT_MESSAGE',
  'SEND_CHAT_EDIT',
  'SEND_CHAT_DELETE',
  'SEND_CHAT_REACTION',
])
assert.deepEqual(getHomeV2PublicChatActions('qortalRequest'), [
  'SEND_CHAT_MESSAGE',
  'SEND_CHAT_EDIT',
  'SEND_CHAT_DELETE',
  'SEND_CHAT_REACTION',
])

assert.deepEqual(normalizeHomeV2PublicChatRequest('qdnRequest', 'SEND_CHAT_MESSAGE', {
  message: 'Hello',
  network: 'qortium',
  txGroupId: 0,
}), {
  action: 'SEND_CHAT_MESSAGE',
  chatReference: null,
  message: 'Hello',
  txGroupId: 0,
})
assert.equal(
  normalizeHomeV2PublicChatRequest('qdnRequest', 'SEND_CHAT_MESSAGE', {
    chatReference: reference,
    message: '{"message":"Legacy inferred edit"}',
    txGroupId: 12,
  }).action,
  'SEND_CHAT_EDIT',
)
assert.equal(
  normalizeHomeV2PublicChatRequest('qdnRequest', 'SEND_CHAT_MESSAGE', {
    chatReference: reference,
    message: '{"message":""}',
    txGroupId: 12,
  }).action,
  'SEND_CHAT_DELETE',
)
assert.equal(
  normalizeHomeV2PublicChatRequest('qdnRequest', 'SEND_CHAT_MESSAGE', {
    chatReference: reference,
    message: '{"message":"","type":"reaction","content":"👍","contentState":true}',
    txGroupId: 12,
  }).action,
  'SEND_CHAT_REACTION',
)
assert.throws(
  () => normalizeHomeV2PublicChatRequest('qortalRequest', 'SEND_CHAT_MESSAGE', {
    chatReference: reference,
    message: fixture.publicGroup.payloads.edit,
    txGroupId: 12,
  }),
  /explicit revision action/,
)
assert.throws(
  () => normalizeHomeV2PublicChatRequest('qdnRequest', 'SEND_CHAT_MESSAGE', {
    message: 'Wrong bridge',
    network: 'qortal',
    txGroupId: 12,
  }),
  /authoritative qortium bridge/,
)

assert.equal(
  normalizeHomeV2PublicChatRequest('qortalRequest', 'SEND_CHAT_EDIT', {
    chatReference: reference,
    message: fixture.publicGroup.payloads.edit,
    txGroupId: fixture.common.groupId,
  }).message,
  fixture.publicGroup.payloads.edit,
)
assert.equal(
  normalizeHomeV2PublicChatRequest('qortalRequest', 'SEND_CHAT_REACTION', {
    chatReference: reference,
    message: fixture.publicGroup.payloads.reaction,
    txGroupId: fixture.common.groupId,
  }).message,
  fixture.publicGroup.payloads.reaction,
)
const qortalDeletePayload = JSON.stringify({
  messageText: '<p></p>',
  version: 3,
  specialId: 'h1-public-delete',
  images: [],
  repliedTo: '',
  type: 'edit',
  isEdited: true,
})
assert.equal(
  normalizeHomeV2PublicChatRequest('qortalRequest', 'SEND_CHAT_DELETE', {
    chatReference: reference,
    message: qortalDeletePayload,
    txGroupId: fixture.common.groupId,
  }).message,
  qortalDeletePayload,
)
for (const invalidDeletePayload of [
  { messageText: '', version: 3, specialId: 'delete', images: [], repliedTo: '', type: 'edit', isEdited: true },
  { messageText: '<p></p>', version: 3, specialId: 'delete', images: [{}], repliedTo: '', type: 'edit', isEdited: true },
  { messageText: '<p></p>', version: 3, specialId: 'delete', images: [], repliedTo: '', type: 'delete', isEdited: true },
  { messageText: '<p></p>', version: 3, specialId: 'delete', images: [], repliedTo: '', type: 'edit', isEdited: true, hidden: true },
]) {
  assert.throws(
    () => normalizeHomeV2PublicChatRequest('qortalRequest', 'SEND_CHAT_DELETE', {
      chatReference: reference,
      message: JSON.stringify(invalidDeletePayload),
      txGroupId: fixture.common.groupId,
    }),
    /canonical empty Hub v3 edit envelope|unsupported fields/,
  )
}
assert.throws(
  () => normalizeHomeV2PublicChatRequest('qortalRequest', 'SEND_CHAT_EDIT', {
    chatReference: reference,
    message: '{"message":"not Hub v3"}',
    txGroupId: fixture.common.groupId,
  }),
  /Hub v3 edit/,
)
assert.throws(
  () => normalizeHomeV2PublicChatRequest('qortalRequest', 'SEND_CHAT_EDIT', {
    chatReference: reference,
    message: qortalDeletePayload,
    txGroupId: fixture.common.groupId,
  }),
  /non-empty Hub v3 edit/,
)
assert.throws(
  () => normalizeHomeV2PublicChatRequest('qortalRequest', 'SEND_CHAT_REACTION', {
    chatReference: reference,
    message: '{"message":"","type":"reaction","content":"👍","contentState":true}',
    txGroupId: fixture.common.groupId,
  }),
  /Hub specialId/,
)

assert.equal(normalizeHomeV2ChatReference(reference), reference)
assert.throws(() => normalizeHomeV2ChatReference('not-base58!'), /valid Base58/)
assert.throws(() => normalizeHomeV2ChatReference('111'), /64 bytes/)

assert.deepEqual(
  createHomeV2UnknownChatBroadcastResult(
    new Error('Node response timed out.'),
    reference,
    1_700_000_000_999,
  ),
  {
    accepted: false,
    error: 'Node response timed out.',
    errorType: 'BROADCAST_OUTCOME_UNKNOWN',
    outcome: 'unknown',
    retryable: false,
    signature: reference,
    timestamp: 1_700_000_000_999,
  },
)

assert.deepEqual(buildHomeV2QortiumPublicChatBuildBody({
  request: normalizeHomeV2PublicChatRequest('qdnRequest', 'SEND_CHAT_EDIT', {
    chatReference: reference,
    message: '{"message":"edited"}',
    txGroupId: 12,
  }),
  senderPublicKey,
  timestamp: 1_700_000_000_456,
}), {
  chatReference: reference,
  data: '2iVqqhntPfCa4sYdTM6fxFFV2bvC',
  fee: 0,
  isEncrypted: false,
  isText: true,
  senderPublicKey,
  timestamp: 1_700_000_000_456,
  txGroupId: 12,
})

const target = {
  chatReference: null,
  isEncrypted: false,
  isText: true,
  recipient: null,
  sender: 'Qsender',
  senderPublicKey,
  signature: reference,
  txGroupId: fixture.common.groupId,
}
assert.equal(normalizeHomeV2PublicChatReferenceTarget(target, {
  chatReference: reference,
  requireSenderOwnership: true,
  senderPublicKey,
  txGroupId: fixture.common.groupId,
}).senderPublicKey, senderPublicKey)
assert.throws(
  () => normalizeHomeV2PublicChatReferenceTarget(
    { ...target, senderPublicKey: otherPublicKey },
    {
      chatReference: reference,
      requireSenderOwnership: true,
      senderPublicKey,
      txGroupId: fixture.common.groupId,
    },
  ),
  /original sender/,
)
assert.doesNotThrow(() => normalizeHomeV2PublicChatReferenceTarget(
  { ...target, senderPublicKey: otherPublicKey },
  {
    chatReference: reference,
    requireSenderOwnership: false,
    senderPublicKey,
    txGroupId: fixture.common.groupId,
  },
))
assert.throws(
  () => normalizeHomeV2PublicChatReferenceTarget(
    { ...target, chatReference: reference },
    {
      chatReference: reference,
      requireOriginal: true,
      requireSenderOwnership: false,
      senderPublicKey,
      txGroupId: fixture.common.groupId,
    },
  ),
  /original message/,
)
for (const badTarget of [
  { ...target, txGroupId: 13 },
  { ...target, recipient: 'Qrecipient' },
  { ...target, isEncrypted: true },
  { ...target, isText: false },
]) {
  assert.throws(() => normalizeHomeV2PublicChatReferenceTarget(badTarget, {
    chatReference: reference,
    requireSenderOwnership: false,
    senderPublicKey,
    txGroupId: fixture.common.groupId,
  }))
}

assert.doesNotThrow(() => assertHomeV2OpenPublicGroup(null, 0, 'qortium'))
assert.doesNotThrow(() => assertHomeV2OpenPublicGroup(
  { groupId: 12, isOpen: true },
  12,
  'qortal',
))
assert.throws(
  () => assertHomeV2OpenPublicGroup({ groupId: 12, isOpen: false }, 12, 'qortium'),
  /private-group chat actions/,
)
assert.throws(
  () => assertHomeV2OpenPublicGroup({ groupId: 13, isOpen: true }, 12, 'qortal'),
  /verify the selected/,
)

console.log('Home v2 public chat action contract tests passed.')
