import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import nacl from 'tweetnacl'

import { base58Decode, base58Encode } from './base58.js'
import {
  attestUnsignedQortalArbitraryPublish,
  attestUnsignedQortalPrivateGroupPublish,
  maximumQortalArtifactBytes,
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
const sha256 = (data: Uint8Array) => new Uint8Array(createHash('sha256').update(data).digest())
const expected = {
  bundleSize: 512,
  feeAtomic: 100_000n,
  sha256,
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
  sha256,
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

// A secret is Qortal's transport key and is 32 bytes when present; any other
// length is not a Qortal builder.
const unexpectedSecret = Uint8Array.from(unsigned)
new DataView(unexpectedSecret.buffer).setInt32(secretLengthOffset, 1, false)
assert.throws(
  () => attestUnsignedQortalPrivateGroupPublish(base58Encode(unexpectedSecret), expected),
  /secret of unexpected length/,
)

// The artifact size is bounded against the approved source, not matched.
const oversizedArtifact = Uint8Array.from(unsigned)
new DataView(oversizedArtifact.buffer).setInt32(dataTypeOffset + 1 + 4 + 32, maximumQortalArtifactBytes(512) + 1, false)
assert.throws(
  () => attestUnsignedQortalPrivateGroupPublish(base58Encode(oversizedArtifact), expected),
  /does not match the approved data size/,
)

const unexpectedMetadata = Uint8Array.from(unsigned)
new DataView(unexpectedMetadata.buffer).setInt32(dataTypeOffset + 1 + 4 + 32 + 4, 1, false)
assert.throws(
  () => attestUnsignedQortalPrivateGroupPublish(base58Encode(unexpectedMetadata), expected),
  /must not contain metadata/,
)

// Transactions built by a real Qortal 6.1.x node (appnode.qortal.org, never
// broadcast): 32-byte secret on both, ZIP + DATA_HASH off chain, NONE +
// RAW_DATA on chain. Home's first attestation refused all of them ("must not
// contain a secret"), which left Qortal closed groups without a key bundle.
const fixture = JSON.parse(readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'fixtures', 'qortal-arbitrary-publish-v1.json'),
  'utf8',
)) as {
  cases: Array<{
    label: string
    unsignedBase58: string
    intent: { dataSize: number; feeAtomic: string; identifier: string; lastReference: string; name: string; senderPublicKey: string; service: number; timestamp: number }
    expect: { secretBytes: number; compression: number; dataType: 'DATA_HASH' | 'RAW_DATA'; dataLength: number; size: number }
  }>
}
assert.equal(fixture.cases.length, 2)
for (const testCase of fixture.cases) {
  const attestedCase = attestUnsignedQortalArbitraryPublish(testCase.unsignedBase58, {
    dataSize: testCase.intent.dataSize,
    feeAtomic: BigInt(testCase.intent.feeAtomic),
    sha256,
    identifier: testCase.intent.identifier,
    lastReference: base58Decode(testCase.intent.lastReference),
    name: testCase.intent.name,
    senderPublicKey: base58Decode(testCase.intent.senderPublicKey),
    service: testCase.intent.service,
    timestampMaximum: testCase.intent.timestamp,
    timestampMinimum: testCase.intent.timestamp,
  })
  assert.equal(attestedCase.secret.length, testCase.expect.secretBytes, testCase.label)
  assert.equal(attestedCase.compression, testCase.expect.compression, testCase.label)
  assert.equal(attestedCase.dataType, testCase.expect.dataType, testCase.label)
  assert.equal(attestedCase.artifactSize, testCase.expect.size, testCase.label)
  assert.equal(attestedCase.dataHash.length, 32, testCase.label)
  const raw = base58Decode(testCase.unsignedBase58)
  if (testCase.expect.dataType === 'DATA_HASH') {
    // Signing bytes = unsigned bytes minus the one discriminator byte.
    assert.equal(attestedCase.signingBytes.length, raw.length - 1, testCase.label)
  } else {
    // Signing bytes replace the on-chain payload with its SHA-256 digest.
    assert.equal(attestedCase.signingBytes.length, raw.length - 1 - testCase.expect.dataLength + 32, testCase.label)
    const digestOffset = attestedCase.signingBytes.length - 32 - 4 - 4 - 8
    const onChain = raw.subarray(raw.length - 8 - 4 - 4 - testCase.expect.dataLength, raw.length - 8 - 4 - 4)
    assert.deepEqual(
      attestedCase.signingBytes.subarray(digestOffset, digestOffset + 32),
      new Uint8Array(createHash('sha256').update(onChain).digest()),
      testCase.label,
    )
    assert.deepEqual(attestedCase.dataHash, new Uint8Array(createHash('sha256').update(onChain).digest()), testCase.label)
  }
  // The approved size still bounds the artifact: an on-chain payload smaller
  // than the approval, or an off-chain artifact past the repack margin, refuses.
  const inflated = Uint8Array.from(raw)
  new DataView(inflated.buffer).setInt32(raw.length - 8 - 4 - 4, maximumQortalArtifactBytes(testCase.intent.dataSize) + 1, false)
  assert.throws(() => attestUnsignedQortalArbitraryPublish(
    testCase.expect.dataType === 'DATA_HASH' ? base58Encode(inflated) : testCase.unsignedBase58,
    {
    dataSize: testCase.expect.dataType === 'DATA_HASH' ? testCase.intent.dataSize : testCase.expect.size + 1,
    feeAtomic: BigInt(testCase.intent.feeAtomic),
    sha256,
    identifier: testCase.intent.identifier,
    lastReference: base58Decode(testCase.intent.lastReference),
    name: testCase.intent.name,
    senderPublicKey: base58Decode(testCase.intent.senderPublicKey),
    service: testCase.intent.service,
    timestampMaximum: testCase.intent.timestamp,
    timestampMinimum: testCase.intent.timestamp,
    },
  ), testCase.expect.dataType === 'DATA_HASH' ? /does not match the approved data size/ : /inconsistent on-chain payload/, testCase.label)
}

console.log('Home v2 Qortal private-group publish tests passed.')
