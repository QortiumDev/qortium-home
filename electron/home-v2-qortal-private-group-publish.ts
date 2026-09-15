import nacl from 'tweetnacl'

import { base58Decode, base58Encode } from './base58.js'

const ARBITRARY_TRANSACTION_TYPE = 10
const DOCUMENT_PRIVATE_SERVICE = 801
const PUBLIC_KEY_BYTES = 32
const REFERENCE_BYTES = 64
const HASH_BYTES = 32
const MAX_NAME_BYTES = 400
const MAX_IDENTIFIER_BYTES = 64
// Qortal's builder (ArbitraryDataTransactionBuilder / ArbitraryDataWriter)
// AES-256-encrypts every payload with a random key that travels in the
// transaction as the 32-byte "secret"; nodes use it when they serve the
// resource. Payloads whose ciphertext fits in 256 bytes go on chain as
// RAW_DATA with no zip; everything else is zipped, encrypted and referenced
// by DATA_HASH. The transaction's "size" is the ENCRYPTED artifact's size,
// so it is bounded against the approved source rather than matched exactly.
const QORTAL_SECRET_BYTES = 32
const QORTAL_MAX_ON_CHAIN_DATA_BYTES = 256
const QORTAL_COMPRESSION_NONE = 0
const QORTAL_COMPRESSION_ZIP = 1
const QORTAL_DATA_TYPE_DATA_HASH = 0
const QORTAL_DATA_TYPE_RAW_DATA = 1
const ARTIFACT_MARGIN_RATIO = 1.1
const ARTIFACT_MARGIN_FLAT_BYTES = 4096

export type QortalArbitraryDataType = 'DATA_HASH' | 'RAW_DATA'

/** The largest encrypted artifact Qortal may legitimately record for `sourceBytes` of approved data. */
export function maximumQortalArtifactBytes(sourceBytes: number) {
  return Math.ceil(sourceBytes * ARTIFACT_MARGIN_RATIO) + ARTIFACT_MARGIN_FLAT_BYTES
}

function concatBytes(...chunks: readonly Uint8Array[]) {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

class Reader {
  offset = 0
  constructor(readonly bytes: Uint8Array) {}
  read(length: number, label: string) {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.length) {
      throw new Error(`Qortal ARBITRARY transaction truncates ${label}.`)
    }
    const value = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return value
  }
  byte(label: string) { return this.read(1, label)[0] }
  int32(label: string) {
    const value = this.read(4, label)
    return new DataView(value.buffer, value.byteOffset, 4).getInt32(0, false)
  }
  int64(label: string) {
    const value = this.read(8, label)
    return new DataView(value.buffer, value.byteOffset, 8).getBigInt64(0, false)
  }
  sizedUtf8(maximum: number, label: string) {
    const length = this.int32(`${label} length`)
    if (length < 0 || length > maximum) throw new Error(`Qortal ARBITRARY ${label} length is invalid.`)
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(this.read(length, label))
    } catch {
      throw new Error(`Qortal ARBITRARY ${label} is not valid UTF-8.`)
    }
  }
  finish() {
    if (this.offset !== this.bytes.length) throw new Error('Qortal ARBITRARY transaction has trailing bytes.')
  }
}

/** Synchronous SHA-256 supplied by the host (node:crypto on desktop, asmcrypto in the Android bundle). */
export type QortalSha256 = (data: Uint8Array) => Uint8Array

export type QortalPrivateGroupPublishIntent = {
  readonly bundleSize: number
  readonly feeAtomic: bigint
  readonly sha256: QortalSha256
  readonly identifier: string
  readonly lastReference: Uint8Array
  readonly name: string
  readonly senderPublicKey: Uint8Array
  readonly timestampMaximum: number
  readonly timestampMinimum: number
}

export type QortalArbitraryPublishIntent = {
  readonly dataSize: number
  readonly feeAtomic: bigint
  readonly sha256: QortalSha256
  readonly identifier: string
  readonly lastReference: Uint8Array
  readonly name: string
  readonly senderPublicKey: Uint8Array
  readonly service: number
  readonly timestampMaximum: number
  readonly timestampMinimum: number
}

export function attestUnsignedQortalArbitraryPublish(
  unsignedBase58: string,
  expected: QortalArbitraryPublishIntent,
) {
  return attestUnsignedQortalPublish(unsignedBase58, expected)
}

export function attestUnsignedQortalPrivateGroupPublish(
  unsignedBase58: string,
  expected: QortalPrivateGroupPublishIntent,
) {
  return attestUnsignedQortalPublish(unsignedBase58, {
    dataSize: expected.bundleSize,
    feeAtomic: expected.feeAtomic,
    identifier: expected.identifier,
    lastReference: expected.lastReference,
    name: expected.name,
    senderPublicKey: expected.senderPublicKey,
    service: DOCUMENT_PRIVATE_SERVICE,
    sha256: expected.sha256,
    timestampMaximum: expected.timestampMaximum,
    timestampMinimum: expected.timestampMinimum,
  })
}

function attestUnsignedQortalPublish(
  unsignedBase58: string,
  expected: QortalArbitraryPublishIntent,
) {
  let unsignedBytes: Uint8Array
  try {
    unsignedBytes = base58Decode(unsignedBase58)
  } catch {
    throw new Error('Qortal publish builder returned invalid Base58.')
  }
  if (unsignedBytes.length < 4 + 8 + 4 + REFERENCE_BYTES + PUBLIC_KEY_BYTES) {
    throw new Error('Qortal publish builder returned truncated bytes.')
  }
  const reader = new Reader(unsignedBytes)
  if (reader.int32('transaction type') !== ARBITRARY_TRANSACTION_TYPE) throw new Error('Qortal publish builder changed the transaction type.')
  const timestamp = reader.int64('timestamp')
  if (timestamp < BigInt(expected.timestampMinimum) || timestamp > BigInt(expected.timestampMaximum)) {
    throw new Error('Qortal publish builder returned an unexpected timestamp.')
  }
  if (reader.int32('transaction group ID') !== 0) throw new Error('Qortal publish builder changed the transaction group ID.')
  const reference = reader.read(REFERENCE_BYTES, 'reference')
  if (!equalBytes(reference, expected.lastReference)) throw new Error('Qortal publish builder changed the account reference.')
  const senderPublicKey = reader.read(PUBLIC_KEY_BYTES, 'sender public key')
  if (!equalBytes(senderPublicKey, expected.senderPublicKey)) throw new Error('Qortal publish builder changed the sender public key.')
  const nonce = reader.int32('nonce')
  if (nonce !== 0) throw new Error('Qortal publish builder returned a nonzero nonce.')
  const name = reader.sizedUtf8(MAX_NAME_BYTES, 'name')
  const identifier = reader.sizedUtf8(MAX_IDENTIFIER_BYTES, 'identifier')
  if (name !== expected.name || identifier !== expected.identifier) throw new Error('Qortal publish builder changed the resource coordinate.')
  if (reader.int32('method') !== 0) throw new Error('Qortal public publishing requires a PUT transaction.')
  const secretLength = reader.int32('secret length')
  if (secretLength !== 0 && secretLength !== QORTAL_SECRET_BYTES) {
    throw new Error('Qortal publish builder returned a secret of unexpected length.')
  }
  const secret = reader.read(secretLength, 'secret')
  const compression = reader.int32('compression')
  if (compression !== QORTAL_COMPRESSION_NONE && compression !== QORTAL_COMPRESSION_ZIP) {
    throw new Error('Qortal publish builder returned an unknown compression.')
  }
  if (reader.int32('payment count') !== 0) throw new Error('Qortal public publish must not contain payments.')
  if (reader.int32('service') !== expected.service) throw new Error('Qortal publish builder changed the resource service.')
  const dataTypeOffset = reader.offset
  const dataTypeByte = reader.byte('data type')
  const dataType: QortalArbitraryDataType = dataTypeByte === QORTAL_DATA_TYPE_DATA_HASH
    ? 'DATA_HASH'
    : dataTypeByte === QORTAL_DATA_TYPE_RAW_DATA ? 'RAW_DATA' : (() => { throw new Error('Qortal publish builder returned an unknown data type.') })()
  const dataLengthOffset = reader.offset
  const dataLength = reader.int32('data length')
  if (dataType === 'DATA_HASH' && dataLength !== HASH_BYTES) throw new Error('Qortal public publish has an invalid data hash length.')
  if (dataType === 'RAW_DATA' && (dataLength < 1 || dataLength > QORTAL_MAX_ON_CHAIN_DATA_BYTES)) {
    throw new Error('Qortal public publish has an invalid on-chain data length.')
  }
  const data = reader.read(dataLength, 'data')
  const artifactSize = reader.int32('artifact size')
  if (dataType === 'RAW_DATA') {
    // On-chain data IS the artifact (IV + AES-CBC ciphertext of the source).
    if (artifactSize !== dataLength || compression !== QORTAL_COMPRESSION_NONE || artifactSize < expected.dataSize) {
      throw new Error('Qortal publish builder returned an inconsistent on-chain payload.')
    }
  } else if (artifactSize < 1 || artifactSize > maximumQortalArtifactBytes(expected.dataSize)) {
    throw new Error('Qortal publish builder returned an artifact that does not match the approved data size.')
  }
  const metadataHashLength = reader.int32('metadata hash length')
  if (metadataHashLength !== 0) throw new Error('Qortal public publish must not contain metadata.')
  const metadataHash = reader.read(metadataHashLength, 'metadata hash')
  const feeAtomic = reader.int64('fee')
  if (feeAtomic !== expected.feeAtomic) throw new Error('Qortal publish builder changed the approved fee.')
  reader.finish()
  // Qortal's signing transform (ArbitraryTransactionTransformer
  // .toBytesForSigningImpl) omits the one-byte raw/hash discriminator and,
  // for RAW_DATA, writes the SHA-256 digest of the on-chain bytes after the
  // untouched raw length field; DATA_HASH bytes are otherwise identical.
  const dataHash = dataType === 'DATA_HASH' ? new Uint8Array(data) : new Uint8Array(expected.sha256(new Uint8Array(data)))
  if (dataHash.length !== HASH_BYTES) throw new Error('The host SHA-256 provider returned an invalid digest.')
  const signingBytes = dataType === 'DATA_HASH'
    ? concatBytes(unsignedBytes.subarray(0, dataTypeOffset), unsignedBytes.subarray(dataTypeOffset + 1))
    : concatBytes(
        unsignedBytes.subarray(0, dataTypeOffset),
        unsignedBytes.subarray(dataLengthOffset, dataLengthOffset + 4),
        dataHash,
        unsignedBytes.subarray(dataLengthOffset + 4 + dataLength),
      )
  return Object.freeze({
    artifactSize,
    compression,
    dataHash,
    dataType,
    feeAtomic,
    identifier,
    metadataHash: new Uint8Array(metadataHash),
    name,
    reference: new Uint8Array(reference),
    secret: new Uint8Array(secret),
    signingBytes,
    timestamp: Number(timestamp),
    unsignedBytes,
  })
}

export function signAttestedQortalPrivateGroupPublish(input: {
  readonly selectedAccountSecretKey: Uint8Array
  readonly signingBytes: Uint8Array
  readonly unsignedBytes: Uint8Array
}) {
  const secretKey = input.selectedAccountSecretKey.length === nacl.sign.seedLength
    ? nacl.sign.keyPair.fromSeed(input.selectedAccountSecretKey).secretKey
    : input.selectedAccountSecretKey
  if (secretKey.length !== nacl.sign.secretKeyLength) throw new Error('Selected account signing key is invalid.')
  const signature = nacl.sign.detached(input.signingBytes, secretKey)
  return Object.freeze({
    signature: base58Encode(signature),
    signedBytes: concatBytes(input.unsignedBytes, signature),
  })
}
