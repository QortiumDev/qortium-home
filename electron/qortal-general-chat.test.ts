import assert from 'node:assert/strict'
import nacl from 'tweetnacl'
import { base58Encode } from './base58.js'
import {
  QORTAL_GENERAL_CHAT_NONCE_OFFSET,
  buildUnsignedQortalGeneralChatBytes,
  buildUnsignedQortalGeneralWrapperBytes,
  decodeQortalGeneralWrappedMessage,
  deriveQortalGeneralWrapperKeys,
  findQortalGeneralChatMessage,
  parseSignedQortalGeneralChatBytes,
  qortalPublicKeyToAddress,
  stampQortalGeneralChatNonce,
} from './qortal-general-chat.js'

// Same fixtures as qortium-chat's src/qortalGeneralChat.test.ts, so the two
// implementations are pinned to the same bytes and the same derived address.
function signedGeneralChat(message = '{"version":3,"messageText":"hello"}', chatReference?: string) {
  const keyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7))
  const unsigned = buildUnsignedQortalGeneralChatBytes({
    chatReference,
    lastReference: new Uint8Array(64).fill(11),
    message,
    senderPublicKey: base58Encode(keyPair.publicKey),
    timestamp: 1_700_000_000_000,
  })
  const stamped = stampQortalGeneralChatNonce(unsigned, 42)
  const signature = nacl.sign.detached(stamped, keyPair.secretKey)
  return { bytes: new Uint8Array([...stamped, ...signature]), keyPair, signature }
}

function wrapperRow(bytes: Uint8Array, signature: Uint8Array, overrides: Record<string, unknown> = {}) {
  const { recipientAddress, senderKeyPair } = deriveQortalGeneralWrapperKeys(signature)
  return {
    amount: 0,
    data: base58Encode(bytes),
    fee: 0,
    isEncrypted: false,
    isText: false,
    recipient: recipientAddress,
    senderPublicKey: base58Encode(senderKeyPair.publicKey),
    txGroupId: 0,
    ...overrides,
  }
}

// Address derivation matches the Qortal (version 58) address of the fixture key.
{
  const { keyPair } = signedGeneralChat()
  assert.equal(qortalPublicKeyToAddress(keyPair.publicKey), 'QM6xD1LM4BaidFGbjs1Q3PsSJ1cLXtw2HE')
}

// The signed inner CHAT parses, verifies, and keeps its nonce at the shared offset.
{
  const { bytes, keyPair, signature } = signedGeneralChat()
  const parsed = parseSignedQortalGeneralChatBytes(bytes)
  assert.equal(new DataView(parsed.signingBytes.buffer).getInt32(QORTAL_GENERAL_CHAT_NONCE_OFFSET), 42)
  assert.equal(parsed.timestamp, 1_700_000_000_000)
  assert.equal(parsed.chatReference, null)
  assert.deepEqual(parsed.publicKey, keyPair.publicKey)
  assert.deepEqual(parsed.signature, signature)
  assert.equal(new TextDecoder().decode(parsed.data), '{"version":3,"messageText":"hello"}')

  const tampered = new Uint8Array(bytes)
  tampered[121] ^= 1
  assert.throws(() => parseSignedQortalGeneralChatBytes(tampered), /Wrapped CHAT signature is invalid/)
}

// A chatReference round-trips through the inner CHAT.
{
  const reference = base58Encode(new Uint8Array(64).fill(3))
  const { bytes } = signedGeneralChat('{"type":"edit"}', reference)
  assert.equal(parseSignedQortalGeneralChatBytes(bytes).chatReference, reference)
}

// The wrapper sender/recipient derive deterministically from the inner
// signature, and a wrapper from any other key is refused.
{
  const { bytes, keyPair, signature } = signedGeneralChat()
  const decoded = decodeQortalGeneralWrappedMessage(wrapperRow(bytes, signature))
  assert.ok(decoded)
  assert.equal(decoded.sender, 'QM6xD1LM4BaidFGbjs1Q3PsSJ1cLXtw2HE')
  assert.equal(decoded.senderPublicKey, base58Encode(keyPair.publicKey))
  assert.equal(decoded.signature, base58Encode(signature))
  assert.equal(decoded.timestamp, 1_700_000_000_000)
  assert.equal(new TextDecoder().decode(decoded.data), '{"version":3,"messageText":"hello"}')

  assert.equal(
    decodeQortalGeneralWrappedMessage(wrapperRow(bytes, signature, { senderPublicKey: base58Encode(new Uint8Array(32).fill(9)) })),
    null,
  )
  assert.equal(decodeQortalGeneralWrappedMessage(wrapperRow(bytes, signature, { recipient: 'QM6xD1LM4BaidFGbjs1Q3PsSJ1cLXtw2HE' })), null)
  assert.equal(decodeQortalGeneralWrappedMessage(wrapperRow(bytes, signature, { amount: 1 })), null)
  assert.equal(decodeQortalGeneralWrappedMessage(wrapperRow(bytes, signature, { fee: '0.001' })), null)
  assert.equal(decodeQortalGeneralWrappedMessage(wrapperRow(bytes, signature, { isText: true })), null)
  assert.equal(decodeQortalGeneralWrappedMessage(wrapperRow(bytes, signature, { txGroupId: 1091 })), null)
  assert.equal(decodeQortalGeneralWrappedMessage({ data: 'not base58 at all!' }), null)
}

// The outer MESSAGE is fee-less, amount-zero, group 0, with the nonce at the same offset.
{
  const { bytes, signature } = signedGeneralChat()
  const { recipientAddress, senderKeyPair } = deriveQortalGeneralWrapperKeys(signature)
  const unsigned = buildUnsignedQortalGeneralWrapperBytes({
    data: bytes,
    lastReference: new Uint8Array(64).fill(13),
    recipient: recipientAddress,
    senderPublicKey: senderKeyPair.publicKey,
    timestamp: 1_700_000_000_100,
  })
  const stamped = stampQortalGeneralChatNonce(unsigned, 99)
  const view = new DataView(stamped.buffer)
  assert.equal(view.getInt32(0), 17)
  assert.equal(view.getInt32(12), 0)
  assert.equal(view.getInt32(QORTAL_GENERAL_CHAT_NONCE_OFFSET), 99)
  assert.equal(stamped[116], 1)
  assert.equal(stamped.at(-10), 0)
  assert.equal(stamped.at(-9), 0)
  // The wrapper signs with the derived key and verifies against it.
  const wrapperSignature = nacl.sign.detached(stamped, senderKeyPair.secretKey)
  assert.ok(nacl.sign.detached.verify(stamped, wrapperSignature, senderKeyPair.publicKey))
}

// Size guard fires before any proof-of-work.
{
  const keyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7))
  assert.throws(() => buildUnsignedQortalGeneralChatBytes({
    lastReference: new Uint8Array(64),
    message: 'x'.repeat(3_900),
    senderPublicKey: base58Encode(keyPair.publicKey),
    timestamp: 1_700_000_000_000,
  }), /too large for Qortal General Chat/)
  assert.throws(() => buildUnsignedQortalGeneralChatBytes({
    lastReference: new Uint8Array(64),
    message: '',
    senderPublicKey: base58Encode(keyPair.publicKey),
    timestamp: 1_700_000_000_000,
  }), /between 1 and 4000 bytes/)
}

// Feed lookup finds a wrapper by inner signature and ignores everything else.
{
  const first = signedGeneralChat('first')
  const second = signedGeneralChat('second')
  const feed = [
    { type: 'MESSAGE', txGroupId: 0, amount: 0, data: 'garbage' },
    wrapperRow(first.bytes, first.signature),
    wrapperRow(second.bytes, second.signature, { senderPublicKey: base58Encode(new Uint8Array(32).fill(1)) }),
    null,
    'string row',
  ]
  const found = findQortalGeneralChatMessage(feed, base58Encode(first.signature))
  assert.ok(found)
  assert.equal(new TextDecoder().decode(found.data), 'first')
  assert.equal(findQortalGeneralChatMessage(feed, base58Encode(second.signature)), null)
  assert.equal(findQortalGeneralChatMessage('not a feed', base58Encode(first.signature)), null)
}

console.log('qortal-general-chat tests passed')
