import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  computeQpgcEpochId,
  computeQpgcKeyId,
  createQpgcKeyAnnouncement,
  createQpgcKeyRequest,
  createQpgcRotationRequest,
  decryptQpgcMessage,
  decryptQpgcStoredKey,
  deriveQpgcWrappingKey,
  encryptQpgcMessage,
  encryptQpgcStoredKey,
  parseQpgcEnvelope,
  QPGC_MAX_MEMBERS,
  QPGC_MAX_MESSAGE_PLAINTEXT_BYTES,
  serializeQpgcEnvelope,
  unwrapQpgcAnnouncementForRecipient,
  unwrapQpgcGroupKey,
  validateQpgcControlEnvelope,
  wrapQpgcGroupKey,
} from './home-v2-private-group-chat-actions.js'

const hex = (value: string) => Uint8Array.from(Buffer.from(value, 'hex'))
const asHex = (value: Uint8Array) => Buffer.from(value).toString('hex')
const utf8 = (value: string) => new TextEncoder().encode(value)

const fixtureRelativePath = 'src/test/resources/chat/interop/chat-crypto-v1.json'
const configuredCoreRepository = process.env.QORTIUM_CORE_REPOSITORY?.trim()
const fixturePath = configuredCoreRepository
  ? path.resolve(configuredCoreRepository, fixtureRelativePath)
  : fileURLToPath(new URL(`../../qortium-core/${fixtureRelativePath}`, import.meta.url))
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
const qpgc = fixture.qpgc
const aliceSecret = hex(fixture.accounts.alice.privateKey)
const alicePublic = hex(fixture.accounts.alice.publicKey)
const bobSecret = hex(fixture.accounts.bob.privateKey)
const bobPublic = hex(fixture.accounts.bob.publicKey)
const members = [bobPublic, alicePublic]

assert.equal(
  asHex(await computeQpgcEpochId(qpgc.groupId, members)),
  qpgc.epochId,
  'QPGC membership epoch matches the Core fixture regardless of input order',
)
assert.equal(
  asHex(await computeQpgcKeyId(qpgc.groupId, hex(qpgc.epochId), hex(qpgc.groupKey))),
  qpgc.keyId,
  'QPGC keyId matches the Core fixture',
)

assert.equal(
  asHex(await encryptQpgcMessage({
    epochId: hex(qpgc.epochId),
    groupId: qpgc.groupId,
    groupKey: hex(qpgc.groupKey),
    keyId: hex(qpgc.keyId),
    nonce: hex(qpgc.message.nonce),
    plaintext: utf8(qpgc.message.plaintextUtf8),
  })),
  qpgc.message.envelope,
  'QPGC deterministic message envelope matches Core byte-for-byte',
)
assert.equal(
  new TextDecoder().decode(await decryptQpgcMessage({
    envelope: hex(qpgc.message.envelope),
    groupKey: hex(qpgc.groupKey),
  })),
  qpgc.message.plaintextUtf8,
  'QPGC message decrypts with the matching group key',
)

assert.equal(
  asHex(await deriveQpgcWrappingKey(
    hex(qpgc.bobKeyWrap.sharedSecret),
    hex(qpgc.bobKeyWrap.associatedData),
  )),
  qpgc.bobKeyWrap.wrappingKey,
  'QPGC wrapper KDF matches Core',
)
assert.equal(
  asHex(await wrapQpgcGroupKey({
    announcerSecretKey: aliceSecret,
    epochId: hex(qpgc.epochId),
    groupId: qpgc.groupId,
    groupKey: hex(qpgc.groupKey),
    keyId: hex(qpgc.keyId),
    nonce: hex(qpgc.bobKeyWrap.nonce),
    recipientPublicKey: bobPublic,
  })),
  qpgc.bobKeyWrap.wrappedKey,
  'QPGC deterministic member wrapper matches Core',
)
assert.equal(
  asHex(await unwrapQpgcGroupKey({
    announcerPublicKey: alicePublic,
    epochId: hex(qpgc.epochId),
    groupId: qpgc.groupId,
    keyId: hex(qpgc.keyId),
    recipientSecretKey: bobSecret,
    wrappedKey: hex(qpgc.bobKeyWrap.wrappedKey),
  })),
  qpgc.groupKey,
  'QPGC recipient unwraps the deterministic group key',
)

const announcement = await createQpgcKeyAnnouncement({
  announcerSecretKey: aliceSecret,
  epochId: hex(qpgc.epochId),
  groupId: qpgc.groupId,
  groupKey: hex(qpgc.groupKey),
  memberPublicKeys: members,
  wrapperNonces: qpgc.keyAnnouncement.wrapperNoncesInSortedMemberOrder.map(hex),
})
assert.equal(asHex(announcement), qpgc.keyAnnouncement.envelope, 'QPGC key announcement matches Core byte-for-byte')
assert.equal(
  asHex(await unwrapQpgcAnnouncementForRecipient({
    announcement,
    memberPublicKeys: members,
    recipientSecretKey: bobSecret,
  })),
  qpgc.groupKey,
  'QPGC recipient unwraps a verified announcement',
)

const keyRequest = createQpgcKeyRequest({
  epochId: hex(qpgc.epochId),
  groupId: qpgc.groupId,
  keyId: hex(qpgc.keyId),
  requesterSecretKey: bobSecret,
})
assert.equal(asHex(keyRequest), qpgc.keyRequest.envelope, 'QPGC historical key request matches Core byte-for-byte')
assert.equal(
  asHex(createQpgcKeyRequest({
    epochId: hex(qpgc.epochId),
    groupId: qpgc.groupId,
    requesterSecretKey: bobSecret,
  })),
  qpgc.currentKeyRequest.envelope,
  'QPGC current-key request matches Core byte-for-byte',
)
assert.equal(
  asHex(createQpgcRotationRequest({
    epochId: hex(qpgc.epochId),
    groupId: qpgc.groupId,
    requesterSecretKey: bobSecret,
  })),
  qpgc.rotationRequest.envelope,
  'QPGC rotation request matches Core byte-for-byte',
)

for (const source of [announcement, keyRequest, hex(qpgc.rotationRequest.envelope)]) {
  const parsed = parseQpgcEnvelope(source)
  assert.equal(asHex(serializeQpgcEnvelope(parsed)), asHex(source), 'QPGC envelope parse/serialize is canonical')
  validateQpgcControlEnvelope({ envelope: parsed, memberPublicKeys: members })
}

const tamperedAnnouncement = Uint8Array.from(announcement)
tamperedAnnouncement[tamperedAnnouncement.length - 1] ^= 1
assert.throws(
  () => validateQpgcControlEnvelope({ envelope: tamperedAnnouncement, memberPublicKeys: members }),
  /signature is invalid/,
)
const tamperedMessage = hex(qpgc.message.envelope)
tamperedMessage[tamperedMessage.length - 1] ^= 1
await assert.rejects(
  () => decryptQpgcMessage({ envelope: tamperedMessage, groupKey: hex(qpgc.groupKey) }),
  /authentication failed/,
)
assert.throws(
  () => parseQpgcEnvelope(Uint8Array.from([...announcement, 0])),
  /trailing data/,
)
await assert.rejects(
  () => encryptQpgcMessage({
    epochId: hex(qpgc.epochId),
    groupId: qpgc.groupId,
    groupKey: hex(qpgc.groupKey),
    keyId: hex(qpgc.keyId),
    nonce: hex(qpgc.message.nonce),
    plaintext: new Uint8Array(QPGC_MAX_MESSAGE_PLAINTEXT_BYTES + 1),
  }),
  /plaintext must be between/,
)
await assert.rejects(
  () => computeQpgcEpochId(qpgc.groupId, Array.from({ length: QPGC_MAX_MEMBERS + 1 }, (_, index) => {
    const key = new Uint8Array(32)
    key[31] = index + 1
    return key
  })),
  /between 1 and 39/,
)

const storedKey = await encryptQpgcStoredKey({
  epochId: hex(qpgc.epochId),
  groupId: qpgc.groupId,
  groupKey: hex(qpgc.groupKey),
  keyId: hex(qpgc.keyId),
  nonce: hex(qpgc.message.nonce),
  selectedAccountSecretKey: bobSecret,
})
assert.equal(
  asHex((await decryptQpgcStoredKey({ record: storedKey, selectedAccountSecretKey: bobSecret })).groupKey),
  qpgc.groupKey,
  'QPGC at-rest record decrypts only under the selected account key',
)
await assert.rejects(
  () => decryptQpgcStoredKey({ record: storedKey, selectedAccountSecretKey: aliceSecret }),
  /different account/,
)
const tamperedStoredKey = { ...storedKey, ciphertext: `${storedKey.ciphertext.slice(0, -2)}AA` }
await assert.rejects(
  () => decryptQpgcStoredKey({ record: tamperedStoredKey, selectedAccountSecretKey: bobSecret }),
  /authentication failed|canonical Base64/,
)

console.log('Home v2 private-group chat crypto tests passed')
