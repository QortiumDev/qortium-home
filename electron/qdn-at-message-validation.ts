/**
 * Independent field-by-field verification of a Qortium AT MESSAGE (type 17).
 *
 * Core has no build endpoint for MESSAGE, so unlike the poll and name families
 * there are no node-provided bytes to check — the transformer in
 * qdn-at-message.ts is the only thing standing between the request and the
 * signature. That is precisely why this exists, and why it must not share code
 * with the builder: it re-reads the produced bytes and compares every field to
 * the approved inputs, so a serializer bug or an edit that quietly changed the
 * wire form cannot reach a signature. This is the same posture the group,
 * rating, and avatar families already have.
 *
 * Every constant the form fixes is asserted, not skipped: a MESSAGE that
 * carried a payment, or arrived encrypted, or claimed a different transaction
 * group, would be a different transaction than the one the user approved.
 */

const TYPE_MESSAGE = 17
const PUBLIC_KEY_LENGTH = 32
const ADDRESS_LENGTH = 25

function fail(field: string, detail: string): never {
  throw new Error(`MESSAGE transaction ${field} ${detail}.`)
}

class Reader {
  private offset = 0

  constructor(private readonly bytes: Uint8Array) {}

  private take(length: number, field: string) {
    if (this.offset + length > this.bytes.length) fail(field, 'is truncated')
    const slice = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return slice
  }

  readInt32(field: string) {
    const bytes = this.take(4, field)
    return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
  }

  readInt64(field: string) {
    const bytes = this.take(8, field)
    let value = 0n
    for (const byte of bytes) value = (value << 8n) | BigInt(byte)
    return value
  }

  readByte(field: string) {
    return this.take(1, field)[0]
  }

  readBytes(length: number, field: string) {
    return this.take(length, field)
  }

  finish() {
    if (this.offset !== this.bytes.length) fail('length', 'has trailing bytes')
  }
}

function assertBytesEqual(actual: Uint8Array, expected: Uint8Array, field: string) {
  if (actual.length !== expected.length) fail(field, 'has an unexpected length')
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== expected[index]) fail(field, 'does not match the approved value')
  }
}

export type QortiumAtMessageExpected = {
  /** The exact nonce expected in the bytes: 0 before stamping, the computed nonce after. */
  readonly nonce: number
  readonly messageBytes: Uint8Array
  readonly recipientBytes: Uint8Array
  readonly senderPublicKeyBytes: Uint8Array
  readonly timestamp: number
}

export function assertUnsignedQortiumAtMessageTransaction(
  bytes: Uint8Array,
  expected: QortiumAtMessageExpected,
) {
  const reader = new Reader(bytes)
  if (reader.readInt32('type') !== TYPE_MESSAGE) fail('type', 'is not a MESSAGE')
  if (reader.readInt64('timestamp') !== BigInt(expected.timestamp)) {
    fail('timestamp', 'does not match the approved value')
  }
  if (reader.readInt32('transaction group') !== 0) fail('transaction group', 'is not zero')
  assertBytesEqual(reader.readBytes(PUBLIC_KEY_LENGTH, 'sender'), expected.senderPublicKeyBytes, 'sender')
  if (reader.readInt32('nonce') !== expected.nonce) fail('nonce', 'does not match the computed value')
  if (reader.readByte('recipient flag') !== 1) fail('recipient flag', 'is not present')
  assertBytesEqual(reader.readBytes(ADDRESS_LENGTH, 'recipient'), expected.recipientBytes, 'recipient')
  // A MESSAGE from this path NEVER moves funds. Asserting zero is the whole
  // point: the prompt tells the user it carries no payment.
  if (reader.readInt64('amount') !== 0n) fail('amount', 'is not zero')
  const messageLength = reader.readInt32('message length')
  if (messageLength !== expected.messageBytes.length) fail('message length', 'does not match the approved text')
  assertBytesEqual(reader.readBytes(messageLength, 'message'), expected.messageBytes, 'message')
  if (reader.readByte('encrypted flag') !== 0) fail('encrypted flag', 'is not plaintext')
  if (reader.readByte('text flag') !== 1) fail('text flag', 'is not text')
  if (reader.readInt64('fee') !== 0n) fail('fee', 'is not zero')
  reader.finish()
}
