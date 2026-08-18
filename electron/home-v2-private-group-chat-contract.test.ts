import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import nacl from 'tweetnacl'

import { base58Encode } from './base58.js'
import {
  normalizeHomeV2PrivateGroupChatReadRequest,
  normalizeHomeV2PrivateGroupChatWriteRequest,
  normalizeHomeV2QpgcControlPage,
  normalizeHomeV2QpgcGroupState,
  verifyHomeV2QpgcControlRecord,
} from './home-v2-private-group-chat-contract.js'

const hex = (value: string) => Uint8Array.from(Buffer.from(value, 'hex'))
const concat = (...chunks: Uint8Array[]) => Uint8Array.from(chunks.flatMap((chunk) => [...chunk]))
const int32 = (value: number) => {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setInt32(0, value, false)
  return bytes
}
const uint32 = (value: number) => {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}
const int64 = (value: number) => {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigInt64(0, BigInt(value), false)
  return bytes
}

const fixtureRelativePath = 'src/test/resources/chat/interop/chat-crypto-v1.json'
const configuredCoreRepository = process.env.QORTIUM_CORE_REPOSITORY?.trim()
const fixturePath = configuredCoreRepository
  ? path.resolve(configuredCoreRepository, fixtureRelativePath)
  : fileURLToPath(new URL(`../../qortium-core/${fixtureRelativePath}`, import.meta.url))
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
const qpgc = fixture.qpgc
const aliceSecret = hex(fixture.accounts.alice.privateKey)
const aliceKeyPair = nacl.sign.keyPair.fromSeed(aliceSecret)
const sortedMembers = [hex(fixture.accounts.alice.publicKey), hex(fixture.accounts.bob.publicKey)]
  .sort((left, right) => Buffer.compare(left, right))

const state = normalizeHomeV2QpgcGroupState({
  allPublicKeysKnown: true,
  available: true,
  epochId: base58Encode(hex(qpgc.epochId)),
  exists: true,
  isOpen: false,
  maxMessagePlaintextBytes: 3894,
  maxV1Members: 39,
  memberCount: 2,
  memberPublicKeys: sortedMembers.map(base58Encode),
  missingPublicKeyAddresses: [],
  qpgcVersion: 1,
  txGroupId: 12,
}, 12)
assert.equal(state.groupId, 12)
assert.equal(state.memberPublicKeys.length, 2)

const timestamp = 1_786_000_000_000
const envelope = hex(qpgc.keyAnnouncement.envelope)
const transaction = concat(
  int32(18),
  int64(timestamp),
  int32(12),
  aliceKeyPair.publicKey,
  uint32(17),
  new Uint8Array([0]),
  int32(envelope.length),
  envelope,
  new Uint8Array([1, 1]),
  int64(0),
  new Uint8Array([0]),
)
const signature = nacl.sign.detached(transaction, aliceKeyPair.secretKey)
const controlRecord = {
  chatReference: null,
  epochId: base58Encode(hex(qpgc.epochId)),
  keyId: base58Encode(hex(qpgc.keyId)),
  sender: 'outer-address-is-not-trusted',
  signature: base58Encode(signature),
  signedTransaction: base58Encode(concat(transaction, signature)),
  timestamp,
  txGroupId: 12,
  type: 'KEY_ANNOUNCEMENT',
}
const verified = verifyHomeV2QpgcControlRecord(controlRecord, state)
assert.equal(verified.envelope.type, 'KEY_ANNOUNCEMENT')
assert.deepEqual(normalizeHomeV2QpgcControlPage({
  controls: [controlRecord],
  hasMore: false,
  nextCursor: null,
  txGroupId: 12,
}, 12, state).controls, [verified])

const relayedTransaction = Uint8Array.from(transaction)
const bobKeyPair = nacl.sign.keyPair.fromSeed(hex(fixture.accounts.bob.privateKey))
relayedTransaction.set(bobKeyPair.publicKey, 16)
const relayedSignature = nacl.sign.detached(relayedTransaction, bobKeyPair.secretKey)
assert.equal(
  verifyHomeV2QpgcControlRecord({
    ...controlRecord,
    signature: base58Encode(relayedSignature),
    signedTransaction: base58Encode(concat(relayedTransaction, relayedSignature)),
  }, state).envelope.type,
  'KEY_ANNOUNCEMENT',
  'a verified relay may have a different outer sender from the announcement creator',
)

const tampered = { ...controlRecord, timestamp: timestamp + 1 }
assert.throws(() => verifyHomeV2QpgcControlRecord(tampered, state), /metadata does not match/)
const brokenSignature = Uint8Array.from(signature)
brokenSignature[0] ^= 1
assert.throws(() => verifyHomeV2QpgcControlRecord({
  ...controlRecord,
  signature: base58Encode(brokenSignature),
  signedTransaction: base58Encode(concat(transaction, brokenSignature)),
}, state), /outer CHAT signature is invalid/)

assert.deepEqual(
  normalizeHomeV2PrivateGroupChatReadRequest('qdnRequest', 'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES', {
    encoding: 'BASE64',
    groupId: 12,
    limit: 50,
    reverse: true,
    txGroupId: 12,
  }),
  { action: 'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES', encoding: 'BASE64', groupId: 12, limit: 50, reverse: true },
)
const revisionReference = base58Encode(new Uint8Array(64).fill(9))
assert.deepEqual(
  normalizeHomeV2PrivateGroupChatWriteRequest('qdnRequest', 'SEND_PRIVATE_GROUP_CHAT_DELETE', {
    chatReference: revisionReference,
    groupId: 12,
    message: JSON.stringify({ message: '' }),
  }),
  {
    action: 'SEND_PRIVATE_GROUP_CHAT_DELETE',
    chatReference: revisionReference,
    epochId: null,
    groupId: 12,
    keyId: null,
    limit: 1,
    message: JSON.stringify({ message: '' }),
  },
)
assert.throws(
  () => normalizeHomeV2PrivateGroupChatWriteRequest('qdnRequest', 'SEND_PRIVATE_GROUP_CHAT_DELETE', {
    chatReference: revisionReference,
    groupId: 12,
    message: JSON.stringify({ message: 'not deleted' }),
  }),
  /empty-message revision envelope/,
)
assert.throws(
  () => normalizeHomeV2PrivateGroupChatWriteRequest('qdnRequest', 'SEND_PRIVATE_GROUP_CHAT_REACTION', {
    chatReference: revisionReference,
    groupId: 12,
    message: JSON.stringify({ message: '', type: 'reaction' }),
  }),
  /reaction envelope/,
)
assert.deepEqual(
  normalizeHomeV2PrivateGroupChatWriteRequest('qdnRequest', 'REQUEST_PRIVATE_GROUP_CHAT_KEY', {
    groupId: 12,
    keyId: base58Encode(hex(qpgc.keyId)),
  }),
  {
    action: 'REQUEST_PRIVATE_GROUP_CHAT_KEY',
    chatReference: null,
    epochId: null,
    groupId: 12,
    keyId: base58Encode(hex(qpgc.keyId)),
    limit: 1,
    message: null,
  },
)
assert.throws(
  () => normalizeHomeV2PrivateGroupChatReadRequest('qortalRequest', 'GET_PRIVATE_GROUP_CHAT_STATE', { groupId: 12 }),
  /Qortium bridge/,
)
assert.throws(
  () => normalizeHomeV2PrivateGroupChatReadRequest('qdnRequest', 'GET_PRIVATE_GROUP_CHAT_STATE', {
    groupId: 12,
    txGroupId: 13,
  }),
  /must not conflict/,
)
assert.throws(
  () => normalizeHomeV2QpgcGroupState({
    ...{
      allPublicKeysKnown: true,
      available: true,
      epochId: base58Encode(hex(qpgc.epochId)),
      exists: true,
      isOpen: false,
      maxMessagePlaintextBytes: 3894,
      maxV1Members: 39,
      memberCount: 2,
      memberPublicKeys: [...sortedMembers].reverse().map(base58Encode),
      qpgcVersion: 1,
      txGroupId: 12,
    },
  }, 12),
  /strictly sorted/,
)

const desktopBridgeSource = readFileSync(new URL('../electron/home-v2-app-bridge.ts', import.meta.url), 'utf8')
const androidLiveSource = readFileSync(new URL('../src/home-v2-live/HomeV2LiveApp.tsx', import.meta.url), 'utf8')
const androidVaultSource = readFileSync(new URL('../src/platform.ts', import.meta.url), 'utf8')
const actionCatalogueSource = readFileSync(new URL('../electron/home-v2-app-actions.ts', import.meta.url), 'utf8')
for (const [label, source] of [
  ['desktop bridge', desktopBridgeSource],
  ['Android vault', androidVaultSource],
] as const) {
  assert.match(source, /\/chat\/private\/group\/state/,
    `${label} must bind QPGC encryption to Core's atomic group-state endpoint`)
  assert.match(source, /\/chat\/private\/group\/control/,
    `${label} must recover keys only from bounded, signed control records`)
  assert.match(source, /\/chat\/public\/build/,
    `${label} must use the public unsigned CHAT builder`)
  assert.match(source, /assertPublicChatTransaction/,
    `${label} must attest node-built bytes before local signing`)
  assert.match(source, /createHomeV2UnknownChatBroadcastResult/,
    `${label} must preserve ambiguous post-broadcast outcomes`)
}
assert.match(androidLiveSource, /readPrivateGroupChats/)
assert.match(androidLiveSource, /sendPrivateGroupChat/)
assert.match(androidLiveSource, /chat\.private-group\.read/)
assert.match(androidLiveSource, /chat\.private-group\.send/)
assert.match(androidVaultSource, /home-v2-qpgc-key-store-v1/)
assert.match(desktopBridgeSource, /home-v2-private-group-key-store/)
assert.match(actionCatalogueSource, /'SEND_PRIVATE_GROUP_CHAT_REACTION'/)
assert.match(actionCatalogueSource, /'GET_PRIVATE_GROUP_CHAT_STATE'/)

console.log('Home v2 private-group chat contract tests passed')
