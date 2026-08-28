import assert from 'node:assert/strict'
import nacl from 'tweetnacl'

import { base58Encode } from './base58.js'
import {
  decryptQortalGroupData,
  encryptQortalGroupData,
  encryptQortalGroupDataForTest,
} from './home-v2-app-encryption.js'

// Deterministic identities: a seeded key pair is reproducible, so the layout
// assertions below pin exact byte positions rather than "something plausible".
const alice = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(1))
const bob = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(2))
const carol = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(3))
const alice58 = base58Encode(alice.publicKey)
const bob58 = base58Encode(bob.publicKey)
const carol58 = base58Encode(carol.publicKey)

const PLAINTEXT = 'aGVsbG8gcHJpdmF0ZSB3b3JsZA==' // "hello private world"

const fixed = {
  keyNonce: new Uint8Array(24).fill(9),
  messageKey: new Uint8Array(32).fill(7),
  nonce: new Uint8Array(24).fill(8),
}

// --- The wire layout -------------------------------------------------------
// Data encrypted here must be readable by every other Qortal client, so the
// envelope is pinned field by field against Qortal Hub's encryptDataGroup.
{
  const encrypted = encryptQortalGroupDataForTest({
    data64: PLAINTEXT,
    recipientPublicKeys58: [bob58],
    senderPrivateKey: alice.secretKey,
    senderPublicKey58: alice58,
  }, fixed)
  const bytes = Uint8Array.from(Buffer.from(encrypted, 'base64'))
  assert.equal(
    Buffer.from(bytes.subarray(0, 24)).toString('utf8'),
    'qortalGroupEncryptedData',
    'the envelope is identified by a 24-byte ASCII prefix',
  )
  assert.deepEqual(bytes.subarray(24, 48), fixed.nonce, 'the payload nonce follows the prefix')
  assert.deepEqual(bytes.subarray(48, 72), fixed.keyNonce, 'then the shared key nonce')
  assert.deepEqual(
    bytes.subarray(72, 104),
    alice.publicKey,
    'then the SENDER public key, so a reader can derive the shared secret',
  )
  // Recipient count is a uint32 LITTLE-ENDIAN in the final four bytes. Two
  // recipients: Bob, plus Alice herself.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  assert.equal(view.getUint32(bytes.length - 4, true), 2, 'the trailing count is little-endian')
  // 24 prefix + 24 + 24 + 32 header, payload, 2 wrapped keys of 48, 4 count.
  const payloadLength = Buffer.from(PLAINTEXT, 'base64').length + 16
  assert.equal(bytes.length, 104 + payloadLength + 2 * 48 + 4, 'every field is accounted for')
}

// --- Round trip ------------------------------------------------------------
{
  const encrypted = encryptQortalGroupData({
    data64: PLAINTEXT,
    recipientPublicKeys58: [bob58],
    senderPrivateKey: alice.secretKey,
    senderPublicKey58: alice58,
  })
  const asBob = decryptQortalGroupData({ encryptedBase64: encrypted, readerPrivateKey: bob.secretKey })
  assert.equal(asBob.data64, PLAINTEXT, 'the named recipient reads it back')
  assert.equal(asBob.senderPublicKey58, alice58, 'and learns who sent it')
  // THE SENDER MUST BE ABLE TO READ THEIR OWN DATA. An app encrypting its own
  // stored data names no recipient but itself, and would otherwise lock itself
  // out — which is why the sender is added to the recipient list.
  const asAlice = decryptQortalGroupData({
    encryptedBase64: encrypted,
    readerPrivateKey: alice.secretKey,
  })
  assert.equal(asAlice.data64, PLAINTEXT, 'the sender reads back their own data')
  // A third party cannot, even though the envelope is public.
  assert.throws(
    () => decryptQortalGroupData({ encryptedBase64: encrypted, readerPrivateKey: carol.secretKey }),
    /not encrypted for the selected account/,
  )
}

// Encrypting to nobody but yourself is legitimate: app-private storage.
{
  const encrypted = encryptQortalGroupData({
    data64: PLAINTEXT,
    recipientPublicKeys58: [],
    senderPrivateKey: alice.secretKey,
    senderPublicKey58: alice58,
  })
  const bytes = Uint8Array.from(Buffer.from(encrypted, 'base64'))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  assert.equal(view.getUint32(bytes.length - 4, true), 1, 'the sender alone is one recipient')
  assert.equal(
    decryptQortalGroupData({ encryptedBase64: encrypted, readerPrivateKey: alice.secretKey }).data64,
    PLAINTEXT,
  )
}

// A repeated recipient must not produce a second wrapped key: the count is
// what a reader uses to find the key block, so a duplicate would misalign it.
{
  const encrypted = encryptQortalGroupData({
    data64: PLAINTEXT,
    recipientPublicKeys58: [bob58, bob58, alice58],
    senderPrivateKey: alice.secretKey,
    senderPublicKey58: alice58,
  })
  const bytes = Uint8Array.from(Buffer.from(encrypted, 'base64'))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  assert.equal(view.getUint32(bytes.length - 4, true), 2, 'Alice and Bob, once each')
  assert.equal(
    decryptQortalGroupData({ encryptedBase64: encrypted, readerPrivateKey: bob.secretKey }).data64,
    PLAINTEXT,
  )
}

// Many recipients still align, because the key block is fixed-width.
{
  const others = Array.from({ length: 12 }, (_, index) =>
    base58Encode(nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(index + 20)).publicKey))
  const encrypted = encryptQortalGroupData({
    data64: PLAINTEXT,
    recipientPublicKeys58: [...others, bob58],
    senderPrivateKey: alice.secretKey,
    senderPublicKey58: alice58,
  })
  assert.equal(
    decryptQortalGroupData({ encryptedBase64: encrypted, readerPrivateKey: bob.secretKey }).data64,
    PLAINTEXT,
    'the last recipient in a long list still finds their key',
  )
}

// --- Refusals --------------------------------------------------------------
// A small-order public key yields an all-zero "shared" secret that anyone
// holding such a key could reproduce.
assert.throws(
  () => encryptQortalGroupData({
    data64: PLAINTEXT,
    recipientPublicKeys58: [base58Encode(new Uint8Array(32))],
    senderPrivateKey: alice.secretKey,
    senderPublicKey58: alice58,
  }),
  /degenerate shared secret|not a valid ed25519 key/,
)

// Envelope validation on the way back in.
for (const [input, pattern] of [
  ['', /not a Qortal encrypted envelope/],
  [Buffer.from('not an envelope at all, but long enough to pass a length check ok').toString('base64'),
    /not a Qortal encrypted envelope/],
] as const) {
  assert.throws(
    () => decryptQortalGroupData({ encryptedBase64: input, readerPrivateKey: alice.secretKey }),
    pattern,
  )
}
// A truncated envelope must refuse rather than read past its own data.
{
  const encrypted = encryptQortalGroupData({
    data64: PLAINTEXT,
    recipientPublicKeys58: [bob58],
    senderPrivateKey: alice.secretKey,
    senderPublicKey58: alice58,
  })
  const bytes = Uint8Array.from(Buffer.from(encrypted, 'base64'))
  const truncated = Buffer.from(bytes.subarray(0, bytes.length - 60)).toString('base64')
  assert.throws(
    () => decryptQortalGroupData({ encryptedBase64: truncated, readerPrivateKey: bob.secretKey }),
    /truncated|unusable recipient count|not encrypted for the selected account/,
  )
}
// A tampered payload fails authentication rather than returning garbage.
{
  const encrypted = encryptQortalGroupData({
    data64: PLAINTEXT,
    recipientPublicKeys58: [bob58],
    senderPrivateKey: alice.secretKey,
    senderPublicKey58: alice58,
  })
  const bytes = Uint8Array.from(Buffer.from(encrypted, 'base64'))
  bytes[110] ^= 0x01
  assert.throws(
    () => decryptQortalGroupData({
      encryptedBase64: Buffer.from(bytes).toString('base64'),
      readerPrivateKey: bob.secretKey,
    }),
    /could not be opened/,
  )
}


// --- CROSS-IMPLEMENTATION GOLDEN VECTOR ------------------------------------
// This envelope was produced by QORTAL HUB'S OWN encryptDataGroup
// (Qortal-Hub/src/qdn/encryption/group-encryption.ts), run against the same
// seeded identities used above.
//
// It exists because every other test here uses Home's encryptor AND Home's
// decryptor, so they would ALL still pass if both sides hashed the shared
// secret — which is exactly the mistake this format is most likely to make,
// since Home's own deriveQortalDirectEncryptionKey SHA-256s that value. A test
// suite that cannot fail on the one bug you are worried about is not covering
// it. This vector can only be opened with the raw X25519 secret.
{
  const hubEnvelope =
    'cW9ydGFsR3JvdXBFbmNyeXB0ZWREYXRhFsvmMJ54IvmDDgItpo2iAHqPsCWo+9QAk60SeVXLUA+0' +
    'HheutDe+8ZAMICnnEXr7iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1zffo4CjTYLFSvt' +
    '/a0xDcQMyrfJwxI3rXTDGFWKGhO5Vq32IJ4sXaDA1sDWokIAQq+KApnUxOeudWIhwIRZinMuK+MM' +
    'tfx3fhEclltxfLfOaGUSVVAlP8a35rUht3xmRoSQFX4Fxd6vd/MFaYXRFziBMW4s/657EtX0wiwW' +
    'fC7mKIo7hgIAAAA='
  const asBob = decryptQortalGroupData({
    encryptedBase64: hubEnvelope,
    readerPrivateKey: bob.secretKey,
  })
  assert.equal(asBob.data64, PLAINTEXT, 'Home opens an envelope Qortal Hub wrote')
  assert.equal(asBob.senderPublicKey58, alice58)
  // Hub adds the sender to the recipient list too, so the sender reads it back.
  assert.equal(
    decryptQortalGroupData({ encryptedBase64: hubEnvelope, readerPrivateKey: alice.secretKey }).data64,
    PLAINTEXT,
    'and so does the sender, as Hub intends',
  )
  assert.throws(
    () => decryptQortalGroupData({ encryptedBase64: hubEnvelope, readerPrivateKey: carol.secretKey }),
    /not encrypted for the selected account/,
  )
}

// Hub appends the sender to whatever list it is given, so it can legitimately
// emit MORE recipients than Home will accept on an encrypt request. Refusing to
// READ such an envelope would break the interoperability this format exists
// for: limits belong on what Home is asked to do, not on what it will read.
{
  const many = Array.from({ length: 260 }, (_, index) => {
    const seed = new Uint8Array(32)
    seed[0] = index % 256
    seed[1] = Math.floor(index / 256) + 40
    return nacl.sign.keyPair.fromSeed(seed)
  })
  assert.throws(
    () => encryptQortalGroupData({
      data64: PLAINTEXT,
      recipientPublicKeys58: many.map((pair) => base58Encode(pair.publicKey)),
      senderPrivateKey: alice.secretKey,
      senderPublicKey58: alice58,
    }),
    /1 to 256 recipients/,
    'Home bounds what one request may ask it to compute',
  )
}

// Hub encrypts empty plaintext without complaint, so Home must read it back
// rather than refusing a valid envelope.
{
  const encrypted = encryptQortalGroupData({
    data64: '',
    recipientPublicKeys58: [bob58],
    senderPrivateKey: alice.secretKey,
    senderPublicKey58: alice58,
  })
  assert.equal(
    decryptQortalGroupData({ encryptedBase64: encrypted, readerPrivateKey: bob.secretKey }).data64,
    '',
    'an empty payload round-trips, as it does in Hub',
  )
}

// Base64 is validated STRICTLY. Node's decoder silently ignores characters
// outside the alphabet, so an envelope with junk spliced in would otherwise
// decode to something plausible — where Hub's atob rejects it outright.
{
  const encrypted = encryptQortalGroupData({
    data64: PLAINTEXT,
    recipientPublicKeys58: [bob58],
    senderPrivateKey: alice.secretKey,
    senderPublicKey58: alice58,
  })
  assert.throws(
    () => decryptQortalGroupData({
      encryptedBase64: `${encrypted.slice(0, 20)}!${encrypted.slice(20)}`,
      readerPrivateKey: bob.secretKey,
    }),
    /not valid base64|not canonical base64/,
  )
  assert.throws(
    () => encryptQortalGroupData({
      data64: 'not base64!!',
      recipientPublicKeys58: [bob58],
      senderPrivateKey: alice.secretKey,
      senderPublicKey58: alice58,
    }),
    /not valid base64/,
  )
}

// The recipient block is not authenticated as a whole (a Qortal protocol
// limitation): a wrapped key can be stripped and the count decremented, and
// the remaining recipients still read the message. Pinned so the behaviour is
// a known property rather than a surprise, and so nobody later treats an
// opened envelope as proof of the original recipient set.
{
  const encrypted = encryptQortalGroupData({
    data64: PLAINTEXT,
    recipientPublicKeys58: [bob58, carol58],
    senderPrivateKey: alice.secretKey,
    senderPublicKey58: alice58,
  })
  const bytes = Uint8Array.from(Buffer.from(encrypted, 'base64'))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  assert.equal(view.getUint32(bytes.length - 4, true), 3, 'Bob, Carol and Alice')
  // Strip the LAST wrapped key and decrement the count.
  const stripped = new Uint8Array(bytes.length - 48)
  stripped.set(bytes.subarray(0, bytes.length - 4 - 48))
  new DataView(stripped.buffer).setUint32(stripped.length - 4, 2, true)
  const strippedBase64 = Buffer.from(stripped).toString('base64')
  const survivor = decryptQortalGroupData({
    encryptedBase64: strippedBase64,
    readerPrivateKey: bob.secretKey,
  })
  assert.equal(survivor.data64, PLAINTEXT, 'a remaining recipient still reads a stripped envelope')
}

console.log('Home 2 app encryption envelope tests passed.')
