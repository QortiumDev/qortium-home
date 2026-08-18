import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  buildQortalDirectMessagePayload,
  decryptQdm1Message,
  decryptQortalDirectMessage,
  deriveDirectChatSharedSecret,
  deriveQdm1SharedKey,
  deriveQortalDirectEncryptionKey,
  encryptQdm1Message,
  encryptQortalDirectMessage,
  parseQdm1Envelope,
  QDM1_MAX_PLAINTEXT_SIZE,
} from './home-v2-direct-chat-actions.js'
import {
  decryptHomeV2DirectChatRow,
  normalizeHomeV2DirectChatReadRequest,
  normalizeHomeV2DirectChatWriteRequest,
} from './home-v2-direct-chat-contract.js'
import {
  buildUnsignedQortalDirectChatTransactionBytes,
  stampQortalGroupChatNonce,
} from './qortal-chat.js'
import { base58Decode, base58Encode } from './base58.js'
import { assertPublicChatTransaction } from './public-transaction-validation.js'

const hex = (value: string) => Uint8Array.from(Buffer.from(value, 'hex'))
const utf8 = (value: string) => new TextEncoder().encode(value)
const asHex = (value: Uint8Array) => Buffer.from(value).toString('hex')
const concat = (...chunks: Uint8Array[]) => Uint8Array.from(chunks.flatMap((chunk) => [...chunk]))
const int32 = (value: number) => {
  const result = new Uint8Array(4)
  new DataView(result.buffer).setInt32(0, value, false)
  return result
}
const int64 = (value: bigint) => {
  const result = new Uint8Array(8)
  new DataView(result.buffer).setBigInt64(0, value, false)
  return result
}

const coreFixtureRelativePath = 'src/test/resources/chat/interop/chat-crypto-v1.json'
const configuredCoreRepository = process.env.QORTIUM_CORE_REPOSITORY?.trim()
const coreFixturePath = configuredCoreRepository
  ? path.resolve(configuredCoreRepository, coreFixtureRelativePath)
  : fileURLToPath(new URL(`../../qortium-core/${coreFixtureRelativePath}`, import.meta.url))
const coreFixture = JSON.parse(readFileSync(coreFixturePath, 'utf8'))
const qortalFixture = JSON.parse(readFileSync(fileURLToPath(new URL(
  '../scripts/fixtures/qortal-chat-interop-v1.json',
  import.meta.url,
)), 'utf8'))

const aliceCoreSecret = hex(coreFixture.accounts.alice.privateKey)
const aliceCorePublic = hex(coreFixture.accounts.alice.publicKey)
const bobCoreSecret = hex(coreFixture.accounts.bob.privateKey)
const bobCorePublic = hex(coreFixture.accounts.bob.publicKey)

assert.equal(
  asHex(deriveDirectChatSharedSecret(aliceCoreSecret, bobCorePublic)),
  coreFixture.qdm1.sharedSecret,
  'QDM1 Ed25519-to-X25519 shared secret matches Core fixture',
)
assert.equal(
  asHex(deriveDirectChatSharedSecret(bobCoreSecret, aliceCorePublic)),
  coreFixture.qdm1.sharedSecret,
  'QDM1 shared secret is symmetric',
)
assert.equal(
  asHex(await deriveQdm1SharedKey(
    hex(coreFixture.qdm1.sharedSecret),
    aliceCorePublic,
    bobCorePublic,
  )),
  coreFixture.qdm1.sharedKey,
  'QDM1 domain-separated derived key matches Core fixture',
)
assert.equal(
  asHex(await encryptQdm1Message({
    nonce: hex(coreFixture.qdm1.nonce),
    plaintext: utf8(coreFixture.qdm1.plaintextUtf8),
    recipientPublicKey: bobCorePublic,
    selectedAccountSecretKey: aliceCoreSecret,
    senderPublicKey: aliceCorePublic,
  })),
  coreFixture.qdm1.envelope,
  'QDM1 deterministic envelope matches Core fixture byte-for-byte',
)
assert.equal(
  new TextDecoder().decode(await decryptQdm1Message({
    envelope: hex(coreFixture.qdm1.envelope),
    localPublicKey: bobCorePublic,
    selectedAccountSecretKey: bobCoreSecret,
  })),
  coreFixture.qdm1.plaintextUtf8,
  'QDM1 recipient decrypts the Core fixture',
)
assert.equal(
  new TextDecoder().decode(await decryptQdm1Message({
    envelope: hex(coreFixture.qdm1.envelope),
    localPublicKey: aliceCorePublic,
    selectedAccountSecretKey: aliceCoreSecret,
  })),
  coreFixture.qdm1.plaintextUtf8,
  'QDM1 sender can reopen their own sent message',
)

const tamperedQdm1 = hex(coreFixture.qdm1.envelope)
tamperedQdm1[tamperedQdm1.length - 1] ^= 1
await assert.rejects(
  () => decryptQdm1Message({
    envelope: tamperedQdm1,
    localPublicKey: bobCorePublic,
    selectedAccountSecretKey: bobCoreSecret,
  }),
  /authentication failed/,
)
assert.throws(
  () => parseQdm1Envelope(Uint8Array.from([...hex(coreFixture.qdm1.envelope), 0])),
  /trailing bytes/,
)
await assert.rejects(
  () => encryptQdm1Message({
    nonce: hex(coreFixture.qdm1.nonce),
    plaintext: new Uint8Array(QDM1_MAX_PLAINTEXT_SIZE + 1),
    recipientPublicKey: bobCorePublic,
    selectedAccountSecretKey: aliceCoreSecret,
    senderPublicKey: aliceCorePublic,
  }),
  /plaintext must be between/,
)

const qortal = qortalFixture.directMessage
const aliceQortalSecret = hex(qortalFixture.accounts.alice.privateKey)
const aliceQortalPublic = hex(qortalFixture.accounts.alice.publicKey)
const bobQortalSecret = hex(qortalFixture.accounts.bob.privateKey)
const bobQortalPublic = hex(qortalFixture.accounts.bob.publicKey)
const lastReference = hex(qortalFixture.common.lastReference)

assert.equal(
  asHex(deriveDirectChatSharedSecret(aliceQortalSecret, bobQortalPublic)),
  qortal.sharedSecret,
  'Qortal legacy Ed25519-to-X25519 shared secret matches Hub fixture',
)
assert.equal(
  asHex(await deriveQortalDirectEncryptionKey(hex(qortal.sharedSecret))),
  qortal.encryptionKey,
  'Qortal SHA-256 direct key matches Hub fixture',
)
assert.equal(
  asHex(await encryptQortalDirectMessage({
    lastReference,
    peerPublicKey: bobQortalPublic,
    plaintext: utf8(qortal.plaintext),
    selectedAccountSecretKey: aliceQortalSecret,
  })),
  qortal.ciphertext,
  'Qortal deterministic secretbox ciphertext matches Hub fixture',
)
assert.equal(
  new TextDecoder().decode(await decryptQortalDirectMessage({
    ciphertext: hex(qortal.ciphertext),
    lastReference,
    peerPublicKey: aliceQortalPublic,
    selectedAccountSecretKey: bobQortalSecret,
  })),
  qortal.plaintext,
  'Qortal recipient decrypts the Hub fixture',
)
const qortalUnsigned = buildUnsignedQortalDirectChatTransactionBytes({
  chatReference: qortalFixture.common.chatReferenceBase58,
  ciphertext: hex(qortal.ciphertext),
  lastReference,
  recipientAddress: hex(qortalFixture.common.recipientAddress),
  senderPublicKey: aliceQortalPublic,
  timestamp: qortalFixture.common.timestamp,
})
assert.equal(
  asHex(stampQortalGroupChatNonce(qortalUnsigned, qortalFixture.common.proofOfWorkNonce)),
  qortal.unsigned,
  'Qortal legacy direct transaction matches Hub fixture byte-for-byte',
)

const badQortal = hex(qortal.ciphertext)
badQortal[0] ^= 1
await assert.rejects(
  () => decryptQortalDirectMessage({
    ciphertext: badQortal,
    lastReference,
    peerPublicKey: aliceQortalPublic,
    selectedAccountSecretKey: bobQortalSecret,
  }),
  /authentication failed/,
)

const deletePayload = JSON.parse(buildQortalDirectMessagePayload({
  operation: 'delete',
  specialId: 'delete-1',
}))
assert.deepEqual(deletePayload, {
  isEdited: true,
  message: '<p></p>',
  repliedTo: '',
  specialId: 'delete-1',
  type: 'edit',
  version: 2,
}, 'Qortal direct delete is a valid content-clearing edit, not erasure')

const reactionPayload = JSON.parse(buildQortalDirectMessagePayload({
  operation: 'reaction',
  reaction: '👍',
  reactionState: true,
  specialId: 'reaction-1',
}))
assert.deepEqual(reactionPayload, {
  content: '👍',
  contentState: true,
  message: '',
  specialId: 'reaction-1',
  type: 'reaction',
  version: 2,
})

const aliceAddress = 'Qaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const bobAddress = 'Qbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const qdmRow = await decryptHomeV2DirectChatRow({
  encoding: 'BASE64',
  localAddress: bobAddress,
  localPublicKey: bobCorePublic,
  network: 'qortium',
  peerAddress: aliceAddress,
  peerPublicKey: aliceCorePublic,
  row: {
    data: Buffer.from(hex(coreFixture.qdm1.envelope)).toString('base64'),
    isEncrypted: true,
    isText: true,
    recipient: bobAddress,
    sender: aliceAddress,
    senderPublicKey: base58Encode(aliceCorePublic),
    txGroupId: 0,
  },
  selectedAccountSecretKey: bobCoreSecret,
})
assert.equal(
  Buffer.from(String(qdmRow.data), 'base64').toString('utf8'),
  coreFixture.qdm1.plaintextUtf8,
  'QDM1 row metadata remains intact while data is replaced with plaintext',
)
await assert.rejects(
  () => decryptHomeV2DirectChatRow({
    encoding: 'BASE64',
    localAddress: bobAddress,
    localPublicKey: bobCorePublic,
    network: 'qortium',
    peerAddress: aliceAddress,
    peerPublicKey: bobCorePublic,
    row: {
      data: Buffer.from(hex(coreFixture.qdm1.envelope)).toString('base64'),
      isEncrypted: true,
      isText: true,
      recipient: bobAddress,
      sender: aliceAddress,
      senderPublicKey: base58Encode(bobCorePublic),
      txGroupId: 0,
    },
    selectedAccountSecretKey: bobCoreSecret,
  }),
  /envelope keys do not match/,
)

const qortalRow = await decryptHomeV2DirectChatRow({
  encoding: 'BASE58',
  localAddress: bobAddress,
  localPublicKey: bobQortalPublic,
  network: 'qortal',
  peerAddress: aliceAddress,
  peerPublicKey: aliceQortalPublic,
  row: {
    data: Buffer.from(hex(qortal.ciphertext)).toString('base64'),
    isEncrypted: true,
    isText: true,
    recipient: bobAddress,
    reference: qortalFixture.common.lastReferenceBase58,
    sender: aliceAddress,
    senderPublicKey: base58Encode(aliceQortalPublic),
    txGroupId: 0,
  },
  selectedAccountSecretKey: bobQortalSecret,
})
assert.equal(
  new TextDecoder().decode(base58Decode(String(qortalRow.data))),
  qortal.plaintext,
  'Qortal row decrypt uses transaction reference, not chatReference, as nonce',
)

assert.deepEqual(
  normalizeHomeV2DirectChatReadRequest('qdnRequest', 'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES', {
    encoding: 'BASE64',
    limit: 20,
    otherAddress: bobAddress,
    reverse: true,
  }),
  {
    action: 'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
    encoding: 'BASE64',
    limit: 20,
    otherAddress: bobAddress,
    reverse: true,
  },
)
assert.throws(
  () => normalizeHomeV2DirectChatWriteRequest('qortalRequest', 'SEND_DIRECT_CHAT_MESSAGE', {
    message: qortal.plaintext,
    network: 'qortium',
    otherAddress: bobAddress,
  }),
  /authoritative qortal bridge/,
)
assert.deepEqual(
  normalizeHomeV2DirectChatWriteRequest('qortalRequest', 'SEND_DIRECT_CHAT_DELETE', {
    chatReference: qortalFixture.common.chatReferenceBase58,
    message: buildQortalDirectMessagePayload({ operation: 'delete', specialId: 'delete-1' }),
    otherAddress: bobAddress,
  }),
  {
    action: 'SEND_DIRECT_CHAT_DELETE',
    chatReference: qortalFixture.common.chatReferenceBase58,
    message: buildQortalDirectMessagePayload({ operation: 'delete', specialId: 'delete-1' }),
    otherAddress: bobAddress,
  },
)
assert.throws(
  () => normalizeHomeV2DirectChatWriteRequest('qdnRequest', 'SEND_DIRECT_CHAT_EDIT', {
    chatReference: qortalFixture.common.chatReferenceBase58,
    message: JSON.stringify({ unrelated: true }),
    otherAddress: bobAddress,
  }),
  /must contain non-delete, non-reaction content/,
)

const qdmRecipientAddress = hex(qortalFixture.common.recipientAddress)
const qdmUnsigned = concat(
  int32(18),
  int64(BigInt(qortalFixture.common.timestamp)),
  int32(0),
  aliceCorePublic,
  int32(0),
  new Uint8Array([1]),
  qdmRecipientAddress,
  int32(hex(coreFixture.qdm1.envelope).length),
  hex(coreFixture.qdm1.envelope),
  new Uint8Array([1, 1]),
  int64(0n),
  new Uint8Array([0]),
)
assert.doesNotThrow(() => assertPublicChatTransaction(qdmUnsigned, {
  data: hex(coreFixture.qdm1.envelope),
  encrypted: true,
  publicKey: aliceCorePublic,
  recipient: qdmRecipientAddress,
  timestamp: qortalFixture.common.timestamp,
  txGroupId: 0,
}))
const wrongRecipient = new Uint8Array(qdmRecipientAddress)
wrongRecipient[1] ^= 1
assert.throws(() => assertPublicChatTransaction(qdmUnsigned, {
  data: hex(coreFixture.qdm1.envelope),
  encrypted: true,
  publicKey: aliceCorePublic,
  recipient: wrongRecipient,
  timestamp: qortalFixture.common.timestamp,
  txGroupId: 0,
}), /changed the approved recipient/)

console.log('Home v2 direct-chat action tests passed')
