import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import nacl from 'tweetnacl'
import { base58Encode } from './base58.js'
import {
  QORTAL_GENERAL_CHAT_NONCE_OFFSET,
  buildUnsignedQortalGeneralChatBytes,
  buildUnsignedQortalGeneralWrapperBytes,
  createQortalGeneralChatFeedCache,
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

// A complete, signed wrapper row as the node's unconfirmed feed reports it.
function wrapperRow(bytes: Uint8Array, signature: Uint8Array, overrides: Record<string, unknown> = {}) {
  const { recipientAddress, senderKeyPair } = deriveQortalGeneralWrapperKeys(signature)
  const reference = new Uint8Array(64).fill(21)
  const timestamp = 1_700_000_000_100
  const nonce = 4242
  const outer = stampQortalGeneralChatNonce(buildUnsignedQortalGeneralWrapperBytes({
    data: bytes,
    lastReference: reference,
    recipient: recipientAddress,
    senderPublicKey: senderKeyPair.publicKey,
    timestamp,
  }), nonce)
  const outerSignature = nacl.sign.detached(outer, senderKeyPair.secretKey)
  return {
    amount: '0.00000000',
    data: base58Encode(bytes),
    fee: '0.00000000',
    isEncrypted: false,
    isText: false,
    nonce,
    recipient: recipientAddress,
    reference: base58Encode(reference),
    senderPublicKey: base58Encode(senderKeyPair.publicKey),
    signature: base58Encode(outerSignature),
    timestamp,
    txGroupId: 0,
    type: 'MESSAGE',
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
  // The OUTER transaction is verified too: a row that merely carries a valid
  // inner CHAT is not a wrapper unless its own bytes verify under the derived key.
  assert.equal(decodeQortalGeneralWrappedMessage(wrapperRow(bytes, signature, { nonce: 4243 })), null)
  assert.equal(decodeQortalGeneralWrappedMessage(wrapperRow(bytes, signature, { timestamp: 1_700_000_000_101 })), null)
  assert.equal(decodeQortalGeneralWrappedMessage(wrapperRow(bytes, signature, { reference: base58Encode(new Uint8Array(64).fill(22)) })), null)
  assert.equal(decodeQortalGeneralWrappedMessage(wrapperRow(bytes, signature, { signature: base58Encode(new Uint8Array(64).fill(1)) })), null)
  assert.equal(decodeQortalGeneralWrappedMessage(wrapperRow(bytes, signature, { type: 'CHAT' })), null)
  for (const missing of ['reference', 'nonce', 'timestamp', 'signature', 'isText', 'isEncrypted'] as const) {
    const row: Record<string, unknown> = wrapperRow(bytes, signature)
    delete row[missing]
    assert.equal(decodeQortalGeneralWrappedMessage(row), null, `missing ${missing}`)
  }
}

// A real wrapper as Qortal Hub 3.0.3 broadcast it (scripts/fixtures, captured
// from a public node's unconfirmed pool on 2026-09-14) decodes and verifies —
// the byte layout and derivation match the live protocol, not just our own
// builder.
{
  const row = JSON.parse(readFileSync(new URL('../scripts/fixtures/qortal-general-chat-wrapper-v1.json', import.meta.url), 'utf8'))
  const decoded = decodeQortalGeneralWrappedMessage(row)
  assert.ok(decoded, 'live Hub wrapper must decode')
  assert.equal(decoded.sender, 'QeFmVbrEowbWeZK2paHdu7r5mbUi82ACMh')
  assert.equal(decoded.timestamp, 1789316804473)
  assert.match(new TextDecoder().decode(decoded.data), /"version":3/)
  assert.equal(decodeQortalGeneralWrappedMessage({ ...row, nonce: row.nonce + 1 }), null)
}

// The derivation helper leaves no seed or unused secret behind.
{
  const { signature } = signedGeneralChat()
  const { senderKeyPair } = deriveQortalGeneralWrapperKeys(signature)
  assert.ok(senderKeyPair.secretKey.some((byte) => byte !== 0), 'the sender secret is handed to the caller intact')
  senderKeyPair.secretKey.fill(0)
}

// The feed cache reads a node's pool once per window, shares in-flight reads,
// and serves misses without touching the node again.
{
  const first = signedGeneralChat('first')
  const feed = [wrapperRow(first.bytes, first.signature)]
  let fetches = 0
  const cache = createQortalGeneralChatFeedCache(1_000)
  const fetchFeed = async () => { fetches += 1; return feed }
  const [a, b, c] = await Promise.all([
    cache.lookup('node-1', base58Encode(first.signature), fetchFeed, 0),
    cache.lookup('node-1', 'missing', fetchFeed, 0),
    cache.lookup('node-1', base58Encode(first.signature), fetchFeed, 0),
  ])
  assert.ok(a && c && b === null)
  assert.equal(fetches, 1)
  assert.equal(await cache.lookup('node-1', 'still-missing', fetchFeed, 500), null)
  assert.equal(fetches, 1)
  await cache.lookup('node-1', 'later', fetchFeed, Date.now() + 5_000)
  assert.equal(fetches, 2)
  await cache.lookup('node-2', 'other node', fetchFeed, 0)
  assert.equal(fetches, 3)
  // A failed read is not cached: the next lookup tries again.
  const failing = createQortalGeneralChatFeedCache(1_000)
  let attempts = 0
  const boom = async () => { attempts += 1; throw new Error('node down') }
  await assert.rejects(failing.lookup('node-x', 'sig', boom, 0), /node down/)
  await assert.rejects(failing.lookup('node-x', 'sig', boom, 0), /node down/)
  assert.equal(attempts, 2)
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
