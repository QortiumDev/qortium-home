import nacl from 'tweetnacl'

import { base58Decode, base58Encode } from './base58.js'

const ARBITRARY_TRANSACTION_TYPE = 10
const DOCUMENT_PRIVATE_SERVICE = 801
const PUBLIC_KEY_BYTES = 32
const REFERENCE_BYTES = 64
const HASH_BYTES = 32
const MAX_NAME_BYTES = 400
const MAX_IDENTIFIER_BYTES = 64

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

export type QortalPrivateGroupPublishIntent = {
  readonly bundleSize: number
  readonly feeAtomic: bigint
  readonly identifier: string
  readonly lastReference: Uint8Array
  readonly name: string
  readonly senderPublicKey: Uint8Array
  readonly timestampMaximum: number
  readonly timestampMinimum: number
}

export function attestUnsignedQortalPrivateGroupPublish(
  unsignedBase58: string,
  expected: QortalPrivateGroupPublishIntent,
) {
  let unsignedBytes: Uint8Array
  try {
    unsignedBytes = base58Decode(unsignedBase58)
  } catch {
    throw new Error('Qortal private-group publish builder returned invalid Base58.')
  }
  if (unsignedBytes.length < 4 + 8 + 4 + REFERENCE_BYTES + PUBLIC_KEY_BYTES) {
    throw new Error('Qortal private-group publish builder returned truncated bytes.')
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
  if (reader.int32('method') !== 0) throw new Error('Qortal private-group bundles require a PUT transaction.')
  const secretLength = reader.int32('secret length')
  if (secretLength !== 0) throw new Error('Qortal private-group publish must not contain a secret.')
  const secret = reader.read(secretLength, 'secret')
  if (reader.int32('compression') !== 0) throw new Error('Qortal private-group bundles must not be compressed by the node.')
  if (reader.int32('payment count') !== 0) throw new Error('Qortal private-group publish must not contain payments.')
  if (reader.int32('service') !== DOCUMENT_PRIVATE_SERVICE) throw new Error('Qortal publish builder changed the resource service.')
  const dataTypeOffset = reader.offset
  if (reader.byte('data type') !== 0) throw new Error('Qortal private-group publish must use a staged DATA_HASH.')
  if (reader.int32('data length') !== HASH_BYTES) throw new Error('Qortal private-group publish has an invalid data hash length.')
  const dataHash = reader.read(HASH_BYTES, 'data hash')
  if (reader.int32('raw data size') !== expected.bundleSize) throw new Error('Qortal publish builder changed the encrypted bundle size.')
  const metadataHashLength = reader.int32('metadata hash length')
  if (metadataHashLength !== 0) throw new Error('Qortal private-group publish must not contain metadata.')
  const metadataHash = reader.read(metadataHashLength, 'metadata hash')
  const feeAtomic = reader.int64('fee')
  if (feeAtomic !== expected.feeAtomic) throw new Error('Qortal publish builder changed the approved fee.')
  reader.finish()
  // Qortal's DATA_HASH signing transform is byte-identical to the unsigned
  // transaction except that the one-byte raw/hash discriminator is omitted.
  const signingBytes = concatBytes(
    unsignedBytes.subarray(0, dataTypeOffset),
    unsignedBytes.subarray(dataTypeOffset + 1),
  )
  return Object.freeze({
    dataHash: new Uint8Array(dataHash),
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
