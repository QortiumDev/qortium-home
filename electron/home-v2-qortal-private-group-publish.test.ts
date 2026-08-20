import assert from 'node:assert/strict'
import nacl from 'tweetnacl'

import { base58Encode } from './base58.js'
import {
  attestUnsignedQortalArbitraryPublish,
  attestUnsignedQortalPrivateGroupPublish,
  signAttestedQortalPrivateGroupPublish,
} from './home-v2-qortal-private-group-publish.js'

const concat = (...chunks: Uint8Array[]) => Uint8Array.from(chunks.flatMap((chunk) => [...chunk]))
const int32 = (value: number) => {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setInt32(0, value, false)
  return bytes
}
const int64 = (value: bigint) => {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigInt64(0, value, false)
  return bytes
}
const sized = (value: string) => {
  const bytes = new TextEncoder().encode(value)
  return concat(int32(bytes.length), bytes)
}

const seed = new Uint8Array(32).fill(7)
const keyPair = nacl.sign.keyPair.fromSeed(seed)
const timestamp = 1_786_000_000_000
const name = 'Alice'
const identifier = 'symmetric-qchat-group-12'
const secretLengthOffset = 4 + 8 + 4 + 64 + 32 + 4 + 4 + name.length + 4 + identifier.length + 4
const dataTypeOffset = 4 + 8 + 4 + 64 + 32 + 4 + 4 + name.length + 4 + identifier.length + 4 + 4 + 4 + 4 + 4
const unsigned = concat(
  int32(10),
  int64(BigInt(timestamp)),
  int32(0),
  new Uint8Array(64).fill(1),
  keyPair.publicKey,
  int32(0),
  sized(name),
  sized(identifier),
  int32(0),
  int32(0),
  int32(0),
  int32(0),
  int32(801),
  new Uint8Array([0]),
  int32(32),
  new Uint8Array(32).fill(3),
  int32(512),
  int32(0),
  int64(100_000n),
)
const expected = {
  bundleSize: 512,
  feeAtomic: 100_000n,
  identifier,
  lastReference: new Uint8Array(64).fill(1),
  name,
  senderPublicKey: keyPair.publicKey,
  timestampMaximum: timestamp + 1,
  timestampMinimum: timestamp - 1,
}
const attested = attestUnsignedQortalPrivateGroupPublish(base58Encode(unsigned), expected)
assert.deepEqual(attested.signingBytes, concat(unsigned.subarray(0, dataTypeOffset), unsigned.subarray(dataTypeOffset + 1)))
const signed = signAttestedQortalPrivateGroupPublish({
  selectedAccountSecretKey: seed,
  signingBytes: attested.signingBytes,
  unsignedBytes: attested.unsignedBytes,
})
assert.equal(nacl.sign.detached.verify(attested.signingBytes, signed.signedBytes.subarray(unsigned.length), keyPair.publicKey), true)
assert.equal(signed.signature.length > 64, true)
assert.equal(attestUnsignedQortalArbitraryPublish(base58Encode(unsigned), {
  dataSize: 512,
  feeAtomic: 100_000n,
  identifier,
  lastReference: new Uint8Array(64).fill(1),
  name,
  senderPublicKey: keyPair.publicKey,
  service: 801,
  timestampMaximum: timestamp + 1,
  timestampMinimum: timestamp - 1,
}).dataHash.length, 32)

const wrongService = Uint8Array.from(unsigned)
new DataView(wrongService.buffer).setInt32(dataTypeOffset - 4, 1, false)
assert.throws(
  () => attestUnsignedQortalPrivateGroupPublish(base58Encode(wrongService), expected),
  /service/,
)

const unexpectedSecret = Uint8Array.from(unsigned)
new DataView(unexpectedSecret.buffer).setInt32(secretLengthOffset, 1, false)
assert.throws(
  () => attestUnsignedQortalPrivateGroupPublish(base58Encode(unexpectedSecret), expected),
  /must not contain a secret/,
)

const unexpectedMetadata = Uint8Array.from(unsigned)
new DataView(unexpectedMetadata.buffer).setInt32(dataTypeOffset + 1 + 4 + 32 + 4, 1, false)
assert.throws(
  () => attestUnsignedQortalPrivateGroupPublish(base58Encode(unexpectedMetadata), expected),
  /must not contain metadata/,
)

console.log('Home v2 Qortal private-group publish tests passed.')
