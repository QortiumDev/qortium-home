import ed2curve from 'ed2curve'
import nacl from 'tweetnacl'

import { base58Decode, base58Encode } from './base58.js'

/**
 * Qortal's `qortalGroupEncryptedData` envelope, for the app-facing
 * ENCRYPT_DATA / DECRYPT_DATA family.
 *
 * THE FORMAT IS THE POINT. Data an app encrypts through Home must be readable
 * by every other Qortal client, and data those clients produced must be
 * readable here — otherwise "encryption support" would mean an app's data is
 * trapped in whichever wallet wrote it. Home already has multi-recipient
 * envelope encryption of its own for private chat attachments; it is
 * deliberately NOT reused here, because its wire format is Home's own.
 *
 * Layout, matching Qortal Hub's `encryptDataGroup`
 * (Qortal-Hub/src/qdn/encryption/group-encryption.ts):
 *
 *   "qortalGroupEncryptedData"   24 bytes, ASCII
 *   nonce                        24 bytes   secretbox nonce for the payload
 *   keyNonce                     24 bytes   secretbox nonce for every wrapped key
 *   senderPublicKey              32 bytes   ed25519, so a reader can derive the
 *                                           shared secret from their own key
 *   encryptedData                variable   secretbox(payload, nonce, messageKey)
 *   encryptedKeys                48 each    secretbox(messageKey, keyNonce, sharedSecret)
 *   count                         4 bytes   uint32 LITTLE-ENDIAN, recipient count
 *
 * Two details are easy to get wrong and are pinned by tests:
 *
 * - The SENDER's own public key is added to the recipient list and the list is
 *   deduplicated. Without it the sender cannot read back what they wrote, which
 *   is what an app expects when it encrypts its own stored data.
 * - The shared secret is the RAW X25519 scalar multiplication, not a hash of
 *   it. Home's direct-message key derivation SHA-256s the same value
 *   (deriveQortalDirectEncryptionKey), so reusing that here would produce
 *   ciphertext no other client can open.
 */

const ENVELOPE_PREFIX = 'qortalGroupEncryptedData'
const NONCE_LENGTH = 24
const KEY_NONCE_LENGTH = 24
const PUBLIC_KEY_LENGTH = 32
const MESSAGE_KEY_LENGTH = 32
// secretbox adds a 16-byte authenticator to the 32-byte message key.
const WRAPPED_KEY_LENGTH = MESSAGE_KEY_LENGTH + 16
const COUNT_LENGTH = 4
// A bound on recipients, so a hostile request cannot make Home do unbounded
// scalar multiplications. Qortal Hub does not bound this; Home does.
const MAX_RECIPIENTS = 256

function requireBytes(value: Uint8Array, length: number, label: string) {
  if (value.length !== length) throw new Error(`${label} must be ${length} bytes.`)
  return value
}

function textBytes(value: string) {
  return new TextEncoder().encode(value)
}

/**
 * The X25519 shared secret between an ed25519 private key and an ed25519
 * public key, exactly as Qortal computes it: raw, unhashed.
 */
function sharedSecret(senderPrivateKey: Uint8Array, recipientPublicKey: Uint8Array) {
  const curvePrivate = ed2curve.convertSecretKey(senderPrivateKey)
  const curvePublic = ed2curve.convertPublicKey(recipientPublicKey)
  if (!curvePublic) throw new Error('A recipient public key is not a valid ed25519 key.')
  const secret = nacl.scalarMult(curvePrivate, curvePublic)
  // An all-zero agreement means a small-order public key: the "shared" secret
  // would be one every holder of such a key could reproduce.
  if (secret.every((byte) => byte === 0)) {
    throw new Error('A recipient public key produced a degenerate shared secret.')
  }
  return secret
}

export type QortalEncryptedDataInput = {
  /** The plaintext, base64, exactly as the app supplied it. */
  readonly data64: string
  readonly recipientPublicKeys58: readonly string[]
  readonly senderPrivateKey: Uint8Array
  readonly senderPublicKey58: string
  /** Test seams: supplied so the layout can be pinned against fixed bytes. */
  readonly keyNonce?: Uint8Array
  readonly messageKey?: Uint8Array
  readonly nonce?: Uint8Array
}

export function encryptQortalGroupData(input: QortalEncryptedDataInput): string {
  const senderPublicKey = requireBytes(
    base58Decode(input.senderPublicKey58),
    PUBLIC_KEY_LENGTH,
    'Sender public key',
  )
  requireBytes(input.senderPrivateKey, 64, 'Sender private key')
  // The sender is always a recipient of their own data, and the list is
  // deduplicated so a repeated key does not produce a second wrapped copy.
  const recipients = [...new Set([...input.recipientPublicKeys58, input.senderPublicKey58])]
  if (recipients.length < 1 || recipients.length > MAX_RECIPIENTS) {
    throw new Error(`Encryption supports 1 to ${MAX_RECIPIENTS} recipients.`)
  }
  let payload: Uint8Array
  try {
    payload = Uint8Array.from(Buffer.from(input.data64, 'base64'))
  } catch {
    throw new Error('The data to encrypt must be base64.')
  }
  if (payload.length < 1) throw new Error('The data to encrypt is empty.')

  const messageKey = requireBytes(
    input.messageKey ?? nacl.randomBytes(MESSAGE_KEY_LENGTH),
    MESSAGE_KEY_LENGTH,
    'Message key',
  )
  const nonce = requireBytes(input.nonce ?? nacl.randomBytes(NONCE_LENGTH), NONCE_LENGTH, 'Nonce')
  const keyNonce = requireBytes(
    input.keyNonce ?? nacl.randomBytes(KEY_NONCE_LENGTH),
    KEY_NONCE_LENGTH,
    'Key nonce',
  )
  const encryptedData = nacl.secretbox(payload, nonce, messageKey)
  const wrappedKeys = recipients.map((recipient) => {
    const recipientPublicKey = requireBytes(
      base58Decode(recipient),
      PUBLIC_KEY_LENGTH,
      'Recipient public key',
    )
    const secret = sharedSecret(input.senderPrivateKey, recipientPublicKey)
    try {
      return nacl.secretbox(messageKey, keyNonce, secret)
    } finally {
      secret.fill(0)
    }
  })

  const prefix = textBytes(ENVELOPE_PREFIX)
  const size = prefix.length + NONCE_LENGTH + KEY_NONCE_LENGTH + PUBLIC_KEY_LENGTH +
    encryptedData.length + wrappedKeys.reduce((total, key) => total + key.length, 0) + COUNT_LENGTH
  const combined = new Uint8Array(size)
  let offset = 0
  const write = (bytes: Uint8Array) => {
    combined.set(bytes, offset)
    offset += bytes.length
  }
  write(prefix)
  write(nonce)
  write(keyNonce)
  write(senderPublicKey)
  write(encryptedData)
  for (const key of wrappedKeys) write(key)
  // uint32 LITTLE-ENDIAN, in the last four bytes. Qortal writes it through a
  // Uint32Array buffer, which is little-endian on every platform Qortal runs
  // on; spelling it out here keeps that from depending on host endianness.
  new DataView(combined.buffer).setUint32(size - COUNT_LENGTH, recipients.length, true)
  return Buffer.from(combined).toString('base64')
}

export type QortalDecryptedData = {
  readonly data64: string
  readonly senderPublicKey58: string
}

/**
 * Opens a `qortalGroupEncryptedData` envelope with the reader's own key.
 *
 * The reader is not told which wrapped key is theirs — Qortal's format does not
 * say — so every wrapped key is tried against the one shared secret the reader
 * can compute. A failure to open any of them means the data was not encrypted
 * to this account.
 */
export function decryptQortalGroupData(input: {
  readonly encryptedBase64: string
  readonly readerPrivateKey: Uint8Array
}): QortalDecryptedData {
  requireBytes(input.readerPrivateKey, 64, 'Reader private key')
  let combined: Uint8Array
  try {
    combined = Uint8Array.from(Buffer.from(input.encryptedBase64, 'base64'))
  } catch {
    throw new Error('The encrypted data must be base64.')
  }
  const prefix = textBytes(ENVELOPE_PREFIX)
  const headerLength = prefix.length + NONCE_LENGTH + KEY_NONCE_LENGTH + PUBLIC_KEY_LENGTH
  if (combined.length < headerLength + COUNT_LENGTH) {
    throw new Error('The encrypted data is not a Qortal encrypted envelope.')
  }
  for (let index = 0; index < prefix.length; index += 1) {
    if (combined[index] !== prefix[index]) {
      throw new Error('The encrypted data is not a Qortal encrypted envelope.')
    }
  }
  const view = new DataView(combined.buffer, combined.byteOffset, combined.byteLength)
  const count = view.getUint32(combined.length - COUNT_LENGTH, true)
  if (count < 1 || count > MAX_RECIPIENTS) {
    throw new Error('The encrypted envelope declares an unusable recipient count.')
  }
  const keysLength = count * WRAPPED_KEY_LENGTH
  const dataEnd = combined.length - COUNT_LENGTH - keysLength
  if (dataEnd <= headerLength) {
    throw new Error('The encrypted envelope is truncated.')
  }
  let cursor = prefix.length
  const nonce = combined.subarray(cursor, cursor += NONCE_LENGTH)
  const keyNonce = combined.subarray(cursor, cursor += KEY_NONCE_LENGTH)
  const senderPublicKey = combined.subarray(cursor, cursor += PUBLIC_KEY_LENGTH)
  const encryptedData = combined.subarray(headerLength, dataEnd)

  const secret = sharedSecret(input.readerPrivateKey, senderPublicKey)
  try {
    for (let index = 0; index < count; index += 1) {
      const start = dataEnd + index * WRAPPED_KEY_LENGTH
      const wrapped = combined.subarray(start, start + WRAPPED_KEY_LENGTH)
      const messageKey = nacl.secretbox.open(wrapped, keyNonce, secret)
      if (!messageKey) continue
      try {
        const payload = nacl.secretbox.open(encryptedData, nonce, messageKey)
        if (!payload) throw new Error('The encrypted payload could not be opened.')
        return {
          data64: Buffer.from(payload).toString('base64'),
          senderPublicKey58: base58Encode(senderPublicKey),
        }
      } finally {
        messageKey.fill(0)
      }
    }
  } finally {
    secret.fill(0)
  }
  throw new Error('This data was not encrypted for the selected account.')
}
