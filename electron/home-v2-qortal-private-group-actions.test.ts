import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  appendQortalPrivateGroupKey,
  decryptQortalPrivateGroupBundle,
  decryptQortalPrivateGroupPayload,
  decryptQortalPrivateGroupStoredKeyRing,
  encryptQortalPrivateGroupBundle,
  encryptQortalPrivateGroupPayload,
  encryptQortalPrivateGroupStoredKeyRing,
  parseQortalPrivateGroupKeyRing,
  QORTAL_PRIVATE_GROUP_MAX_PLAINTEXT_BYTES,
  serializeQortalPrivateGroupKeyRing,
} from './home-v2-qortal-private-group-actions.js'

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL(
  '../scripts/fixtures/qortal-chat-interop-v1.json',
  import.meta.url,
)), 'utf8'))
const hex = (value: string) => Uint8Array.from(Buffer.from(value, 'hex'))
const utf8 = (value: string) => new TextEncoder().encode(value)
const text = (value: Uint8Array) => new TextDecoder().decode(value)

const aliceSecret = hex(fixture.accounts.alice.privateKey)
const alicePublic = hex(fixture.accounts.alice.publicKey)
const bobSecret = hex(fixture.accounts.bob.privateKey)
const bobPublic = hex(fixture.accounts.bob.publicKey)
const privateGroup = fixture.privateGroup
const keyRing = parseQortalPrivateGroupKeyRing(JSON.parse(privateGroup.bundlePlaintext))

assert.equal(
  text(serializeQortalPrivateGroupKeyRing(keyRing)),
  privateGroup.bundlePlaintext,
  'key-ring serialization is deterministic',
)

assert.equal(
  encryptQortalPrivateGroupBundle({
    bundleKey: hex(privateGroup.bundleEncryptionKey),
    bundleNonce: hex(privateGroup.bundleNonce),
    keyNonce: hex(privateGroup.keyNonce),
    keyRing,
    // Preserve the fixture's member ordering. Recipient wrappers are tried in
    // order and are not self-describing, matching the interoperable wire.
    memberPublicKeys: [bobPublic, alicePublic],
    selectedAccountSecretKey: aliceSecret,
    senderPublicKey: alicePublic,
  }),
  privateGroup.encryptedBundle,
  'clean-room key bundle matches the pinned Hub v3.0.0 fixture byte-for-byte',
)

for (const selectedAccountSecretKey of [aliceSecret, bobSecret]) {
  const decrypted = decryptQortalPrivateGroupBundle({
    encryptedBundle: privateGroup.encryptedBundle,
    selectedAccountSecretKey,
  })
  assert.equal(text(serializeQortalPrivateGroupKeyRing(decrypted.keyRing)), privateGroup.bundlePlaintext)
  assert.equal(decrypted.recipientCount, 2)
  assert.deepEqual(decrypted.senderPublicKey, alicePublic)
}

const singlePlaintext = Uint8Array.from(Buffer.from(privateGroup.singlePlaintextBase64, 'base64'))
assert.equal(
  encryptQortalPrivateGroupPayload({
    keyRing,
    nonce: hex(privateGroup.encryptSingle.nonce),
    plaintext: singlePlaintext,
    typeNumber: privateGroup.encryptSingle.typeNumber,
  }),
  privateGroup.encryptSingle.ciphertext,
  'new encryptSingle message matches the pinned Hub fixture',
)
assert.deepEqual(
  decryptQortalPrivateGroupPayload({ ciphertext: privateGroup.encryptSingle.ciphertext, keyRing }).plaintext,
  singlePlaintext,
)
assert.equal(
  encryptQortalPrivateGroupPayload({
    keyRing,
    nonce: hex(privateGroup.reaction.nonce),
    plaintext: utf8(fixture.publicGroup.payloads.reaction),
    typeNumber: privateGroup.reaction.typeNumber,
  }),
  privateGroup.reaction.ciphertext,
  'reaction type 102 matches the pinned Hub fixture',
)
assert.equal(
  decryptQortalPrivateGroupPayload({ ciphertext: privateGroup.reaction.ciphertext, keyRing }).typeNumber,
  102,
)
assert.equal(
  text(decryptQortalPrivateGroupPayload({ ciphertext: privateGroup.reaction.ciphertext, keyRing }).plaintext),
  fixture.publicGroup.payloads.reaction,
)

const oldRing = parseQortalPrivateGroupKeyRing({
  1: {
    messageKey: privateGroup.messageKeyBase64,
    nonce: Buffer.from(hex(privateGroup.oldEncryptSingle.nonce)).toString('base64'),
  },
})
assert.equal(
  encryptQortalPrivateGroupPayload({ keyRing: oldRing, plaintext: singlePlaintext }),
  privateGroup.oldEncryptSingle.ciphertext,
  'old encryptSingle message matches the pinned Hub fixture',
)
assert.deepEqual(
  decryptQortalPrivateGroupPayload({ ciphertext: privateGroup.oldEncryptSingle.ciphertext, keyRing: oldRing }).plaintext,
  singlePlaintext,
)

const appended = appendQortalPrivateGroupKey(keyRing, new Uint8Array(32).fill(0xa5))
assert.equal(appended.version, 2)
assert.equal(appended.keyRing.size, 2)

const stored = await encryptQortalPrivateGroupStoredKeyRing({
  groupId: fixture.common.groupId,
  keyRing,
  nonce: new Uint8Array(12).fill(0x44),
  publisherName: 'Alice',
  recipientCount: 2,
  resourceSignature: fixture.common.chatReferenceBase58,
  selectedAccountSecretKey: aliceSecret,
})
assert.equal(stored.network, 'qortal')
assert.equal(stored.recipientCount, 2)
assert.equal(JSON.stringify(stored).includes(privateGroup.messageKeyBase64), false)
assert.equal(JSON.stringify(stored).includes('messageKey'), false)
assert.equal(
  text(serializeQortalPrivateGroupKeyRing(await decryptQortalPrivateGroupStoredKeyRing({
    record: stored,
    selectedAccountSecretKey: aliceSecret,
  }))),
  privateGroup.bundlePlaintext,
)
await assert.rejects(
  () => decryptQortalPrivateGroupStoredKeyRing({ record: stored, selectedAccountSecretKey: bobSecret }),
  /another account/,
)
await assert.rejects(
  () => decryptQortalPrivateGroupStoredKeyRing({
    record: { ...stored, recipientCount: stored.recipientCount + 1 },
    selectedAccountSecretKey: aliceSecret,
  }),
  /authentication failed/,
)

const tamperedBundle = Uint8Array.from(Buffer.from(privateGroup.encryptedBundle, 'base64'))
tamperedBundle[24 + 24 + 24 + 32 + 5] ^= 1
assert.throws(
  () => decryptQortalPrivateGroupBundle({
    encryptedBundle: Buffer.from(tamperedBundle).toString('base64'),
    selectedAccountSecretKey: bobSecret,
  }),
  /not decryptable|invalid|authentication/,
)
const tamperedMessage = Uint8Array.from(Buffer.from(privateGroup.encryptSingle.ciphertext, 'base64'))
tamperedMessage[tamperedMessage.length - 1] ^= 1
assert.throws(
  () => decryptQortalPrivateGroupPayload({
    ciphertext: Buffer.from(tamperedMessage).toString('base64'),
    keyRing,
  }),
  /authentication failed/,
)
assert.throws(
  () => parseQortalPrivateGroupKeyRing({ 0: { messageKey: privateGroup.messageKeyBase64 } }),
  /version is invalid/,
)
assert.throws(
  () => encryptQortalPrivateGroupPayload({
    keyRing,
    plaintext: new Uint8Array(QORTAL_PRIVATE_GROUP_MAX_PLAINTEXT_BYTES + 1),
  }),
  /plaintext must be/,
)
const maxCiphertext = encryptQortalPrivateGroupPayload({
  keyRing,
  nonce: new Uint8Array(24).fill(7),
  plaintext: new Uint8Array(QORTAL_PRIVATE_GROUP_MAX_PLAINTEXT_BYTES),
})
assert.ok(Buffer.byteLength(maxCiphertext) <= 4_000)
const maxOldCiphertext = encryptQortalPrivateGroupPayload({
  keyRing: oldRing,
  plaintext: new Uint8Array(QORTAL_PRIVATE_GROUP_MAX_PLAINTEXT_BYTES),
})
assert.equal(Buffer.byteLength(maxOldCiphertext), 4_000)

console.log('Home v2 Qortal private-group action tests passed.')
