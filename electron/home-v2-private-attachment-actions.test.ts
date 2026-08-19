import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  decryptPrivateChatAttachmentForRecipient,
  decryptPrivateChatGroupAttachment,
  decryptQortalHubPrivateGroupImage,
  decryptQortalPrivateChatDirectAttachment,
  decryptQortalPrivateChatGroupAttachment,
  encryptPrivateChatDirectAttachment,
  encryptPrivateChatGroupAttachment,
  encryptQortalHubPrivateGroupImage,
  encryptQortalPrivateChatDirectAttachment,
  encryptQortalPrivateChatGroupAttachment,
  parsePrivateChatAttachmentEnvelope,
  parsePrivateChatAttachmentPayload,
  PRIVATE_CHAT_ATTACHMENT_MAX_ENVELOPE_BYTES,
  serializePrivateChatAttachmentPayload,
} from './home-v2-private-attachment-actions.js'

const fixtureRelativePath = 'src/test/resources/chat/interop/qenc-attachment-v2.json'
const configuredCoreRepository = process.env.QORTIUM_CORE_REPOSITORY?.trim()
const fixturePath = configuredCoreRepository
  ? path.resolve(configuredCoreRepository, fixtureRelativePath)
  : fileURLToPath(new URL(`../../qortium-core/${fixtureRelativePath}`, import.meta.url))
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
const qortalFixture = JSON.parse(readFileSync(fileURLToPath(new URL(
  '../scripts/fixtures/qortal-chat-interop-v1.json',
  import.meta.url,
)), 'utf8'))
const hex = (value: string) => Uint8Array.from(Buffer.from(value, 'hex'))
const asHex = (value: Uint8Array) => Buffer.from(value).toString('hex')

assert.equal(fixture.format, 'qortium-chat-attachment-v2')

const payload = {
  data: hex(fixture.payload.data),
  filename: fixture.payload.filename,
  mediaType: fixture.payload.mediaType,
}
assert.equal(
  asHex(await serializePrivateChatAttachmentPayload(payload)),
  fixture.payload.serialized,
  'QATT payload matches the independently generated Core fixture byte-for-byte',
)
assert.deepEqual(
  await parsePrivateChatAttachmentPayload(hex(fixture.payload.serialized)),
  payload,
  'QATT parser authenticates and restores encrypted metadata and bytes',
)

const qortalDirect = await encryptQortalPrivateChatDirectAttachment({
  contentKey: hex(fixture.direct.contentKey),
  contentNonce: hex(fixture.direct.contentNonce),
  ephemeralPrivateKey: hex(fixture.direct.ephemeralPrivateKey),
  payload,
  recipientPublicKey: hex(fixture.accounts.bob.publicKey),
  senderPublicKey: hex(fixture.accounts.alice.publicKey),
  wrapNonces: fixture.direct.recipientsInCanonicalKeyIdOrder.map((entry: { wrapNonce: string }) => hex(entry.wrapNonce)),
})
assert.equal(
  new TextDecoder().decode(qortalDirect.subarray(0, new TextEncoder().encode('qortalEncryptedDataQENC2:').length)),
  'qortalEncryptedDataQENC2:',
)
assert.equal(
  asHex(qortalDirect.subarray(new TextEncoder().encode('qortalEncryptedDataQENC2:').length)),
  fixture.direct.envelope,
  'Qortal direct attachment marker wraps the exact frozen Core QENC v2 vector',
)
assert.deepEqual(
  await decryptQortalPrivateChatDirectAttachment({
    envelope: qortalDirect,
    selectedAccountSecretKey: hex(fixture.accounts.bob.privateKey),
  }),
  payload,
  'Qortal direct QATT wrapper preserves recipient authentication and sender reopen crypto',
)

const qortalKeyRing = new Map([[1, { messageKey: hex(qortalFixture.privateGroup.messageKey) }]])
const qortalGroupNonce = hex(qortalFixture.privateGroup.encryptSingle.nonce)
const qortalGroup = await encryptQortalPrivateChatGroupAttachment({
  keyRing: qortalKeyRing,
  nonce: qortalGroupNonce,
  payload,
})
assert.equal(new TextDecoder().decode(qortalGroup.subarray(0, 30)), 'qortalGroupEncryptedDataQATT1:')
assert.deepEqual(
  await decryptQortalPrivateChatGroupAttachment({ envelope: qortalGroup, keyRing: qortalKeyRing }),
  payload,
  'Qortal generic private-group QATT wrapper authenticates encrypted metadata and bytes',
)
const hubImage = encryptQortalHubPrivateGroupImage({
  data: payload.data,
  keyRing: qortalKeyRing,
  nonce: qortalGroupNonce,
})
assert.equal(
  asHex(decryptQortalHubPrivateGroupImage({ ciphertext: hubImage, keyRing: qortalKeyRing })),
  fixture.payload.data,
  'Qortal Hub-compatible private-group image keeps encryptSingle type 2 semantics',
)

const directEnvelope = await encryptPrivateChatDirectAttachment({
  contentKey: hex(fixture.direct.contentKey),
  contentNonce: hex(fixture.direct.contentNonce),
  ephemeralPrivateKey: hex(fixture.direct.ephemeralPrivateKey),
  payload,
  recipientPublicKey: hex(fixture.accounts.bob.publicKey),
  senderPublicKey: hex(fixture.accounts.alice.publicKey),
  wrapNonces: fixture.direct.recipientsInCanonicalKeyIdOrder.map((entry: { wrapNonce: string }) => hex(entry.wrapNonce)),
})
assert.equal(asHex(directEnvelope), fixture.direct.envelope, 'QENC direct envelope matches Core fixture byte-for-byte')
assert.deepEqual(
  await decryptPrivateChatAttachmentForRecipient({
    envelope: directEnvelope,
    selectedAccountSecretKey: hex(fixture.accounts.alice.privateKey),
  }),
  payload,
  'QENC direct sender can reopen the attachment',
)
assert.deepEqual(
  await decryptPrivateChatAttachmentForRecipient({
    envelope: directEnvelope,
    selectedAccountSecretKey: hex(fixture.accounts.bob.privateKey),
  }),
  payload,
  'QENC direct recipient can decrypt the attachment',
)

const groupEnvelope = await encryptPrivateChatGroupAttachment({
  contentNonce: hex(fixture.group.contentNonce),
  epochId: hex(fixture.group.epochId),
  groupId: fixture.group.groupId,
  groupKey: hex(fixture.group.groupKey),
  keyId: hex(fixture.group.keyId),
  payload,
})
assert.equal(asHex(groupEnvelope), fixture.group.envelope, 'QENC group envelope matches Core fixture byte-for-byte')
assert.deepEqual(
  await decryptPrivateChatGroupAttachment({
    envelope: groupEnvelope,
    epochId: hex(fixture.group.epochId),
    groupId: fixture.group.groupId,
    groupKey: hex(fixture.group.groupKey),
    keyId: hex(fixture.group.keyId),
  }),
  payload,
  'QENC group attachment decrypts under the exact epoch and key context',
)

for (const testCase of fixture.negativeCases) {
  const source = testCase.source === 'direct.envelope'
    ? hex(fixture.direct.envelope)
    : testCase.source === 'group.envelope'
      ? hex(fixture.group.envelope)
      : hex(fixture.payload.serialized)
  const mutated = new Uint8Array(source)
  const mutation = testCase.mutation
  const offset = Number.isInteger(mutation.xorOffset)
    ? mutation.xorOffset
    : mutated.length - mutation.xorOffsetFromEnd
  mutated[offset] ^= mutation.xor
  if (testCase.id === 'payload-data-digest') {
    await assert.rejects(() => parsePrivateChatAttachmentPayload(mutated), /digest does not match/)
  } else if (testCase.id.startsWith('direct-')) {
    await assert.rejects(
      () => decryptPrivateChatAttachmentForRecipient({
        envelope: mutated,
        selectedAccountSecretKey: hex(fixture.accounts.alice.privateKey),
      }),
      /not an attachment recipient|authentication failed/,
    )
  } else {
    await assert.rejects(
      () => decryptPrivateChatGroupAttachment({
        envelope: mutated,
        epochId: hex(fixture.group.epochId),
        groupId: fixture.group.groupId,
        groupKey: hex(fixture.group.groupKey),
        keyId: hex(fixture.group.keyId),
      }),
      /group context does not match|authentication failed/,
    )
  }
}

assert.throws(
  () => parsePrivateChatAttachmentEnvelope(new Uint8Array(PRIVATE_CHAT_ATTACHMENT_MAX_ENVELOPE_BYTES + 1)),
  /invalid QENC v2 envelope/,
)
await assert.rejects(
  () => serializePrivateChatAttachmentPayload({ ...payload, filename: '../secret.png' }),
  /filename is invalid/,
)
await assert.rejects(
  () => serializePrivateChatAttachmentPayload({ ...payload, mediaType: 'image/png\ntext/html' }),
  /media type is invalid/,
)

console.log('Home v2 private-attachment QENC/QATT tests passed')
