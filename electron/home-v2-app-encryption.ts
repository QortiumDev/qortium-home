import ed2curve from 'ed2curve'
import nacl from 'tweetnacl'

import { base58Decode, base58Encode } from './base58.js'

/**
 * Qortal's `qortalGroupEncryptedData` envelope, for the app-facing
 * ENCRYPT_DATA / DECRYPT_DATA family.
 *
 * NAMING, BECAUSE THE OBVIOUS READING IS WRONG. Despite the envelope's
 * `qortalGroupEncryptedData` marker, this is NOT Qortal's
 * `ENCRYPT_QORTAL_GROUP_DATA` action. This is Qortal Hub's `encryptDataGroup`,
 * which backs plain **`ENCRYPT_DATA`**: it wraps one message key to a LIST OF
 * RECIPIENT PUBLIC KEYS, and "group" in the marker means that set of readers.
 *
 * `ENCRYPT_QORTAL_GROUP_DATA` is a different mechanism entirely — it takes a
 * `groupId`, fetches the group's shared symmetric key from a DOCUMENT_PRIVATE
 * resource published by the group's admins, and encrypts with
 * `encryptSingle` (see Qortal-Hub/src/qortal/get.ts `encryptQortalGroupData`).
 * It shares no wire format with this file. These functions were originally
 * named after the marker, which put a plausible-looking but incorrect
 * implementation one autocomplete away from being wired to that action.
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
// A bound on how much work one ENCRYPT request may ask for. It deliberately
// does NOT apply when reading: Hub appends the sender to a caller's list and
// can emit 257, and refusing to open a structurally valid envelope Hub wrote
// would break the interoperability this format exists for. Limits belong on
// what Home is asked to DO, not on what it will READ.
const MAX_ENCRYPT_RECIPIENTS = 256
// Reading is still bounded, by the envelope's own length: a declared count
// that does not fit the bytes present is rejected below.
const MAX_ENVELOPE_BYTES = 32 * 1024 * 1024

function requireBytes(value: Uint8Array, length: number, label: string) {
  if (value.length !== length) throw new Error(`${label} must be ${length} bytes.`)
  return value
}

/**
 * Base64 primitives that work in BOTH runtimes.
 *
 * This module runs in the Electron main process AND, since ENCRYPT_DATA, in
 * the Android WebView through the vault in src/platform.ts. `Buffer` is a Node
 * global: on Android it is simply not defined, and every call here threw
 * "Buffer is not defined" at the first encrypt. Node's own unit tests could
 * not see that, because Node has it — only running on the device did.
 * `atob`/`btoa` exist in both runtimes, so they are what this uses now.
 */
function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function bytesToBase64(bytes: Uint8Array) {
  // Chunked: spreading 32MB of bytes into String.fromCharCode at once
  // overflows the call stack, and the envelope cap allows exactly that much.
  const CHUNK = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  return btoa(binary)
}

/**
 * Decodes base64 STRICTLY, and bounds the result.
 *
 * The explicit pattern check stays even though `atob` throws on characters
 * outside the alphabet: it also enforces the length and padding rules, and it
 * bounds the size BEFORE any allocation. The Node decoder this used to use
 * silently ignored stray characters and accepted corrupt input where Qortal
 * Hub's `atob` throws. Accepting what another client rejects is its own
 * interoperability bug, and for an envelope it means tampered input can decode
 * to a valid-looking structure.
 */
function decodeStrictBase64(value: string, label: string) {
  if (typeof value !== 'string') throw new Error(`${label} must be base64 text.`)
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error(`${label} is not valid base64.`)
  }
  // Bound BEFORE decoding: base64 is 4 characters per 3 bytes, so this caps
  // the allocation rather than discovering the size after paying for it.
  if (value.length / 4 * 3 > MAX_ENVELOPE_BYTES) {
    throw new Error(`${label} is too large.`)
  }
  const decoded = base64ToBytes(value)
  // A canonical round trip catches the residual cases the pattern allows,
  // such as a final quantum with non-zero padding bits.
  if (bytesToBase64(decoded) !== value) {
    throw new Error(`${label} is not canonical base64.`)
  }
  return new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength)
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
  try {
    const curvePublic = ed2curve.convertPublicKey(recipientPublicKey)
    if (!curvePublic) throw new Error('A recipient public key is not a valid ed25519 key.')
    return finishSharedSecret(nacl.scalarMult(curvePrivate, curvePublic))
  } finally {
    // The converted X25519 scalar is key material in its own right.
    curvePrivate.fill(0)
  }
}

function finishSharedSecret(secret: Uint8Array) {
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
}

/**
 * Deterministic construction, for pinning the wire layout against fixed bytes.
 *
 * Kept OUT of the production signature on purpose: reusing a nonce with the
 * same message key leaks the relationship between plaintexts, and an optional
 * parameter on the exported encryptor is an invitation to supply one. Callers
 * outside tests cannot reach this.
 */
export type QortalEncryptedDataTestSeams = {
  readonly keyNonce: Uint8Array
  readonly messageKey: Uint8Array
  readonly nonce: Uint8Array
}

export function encryptQortalPublicKeyEnvelope(input: QortalEncryptedDataInput): string {
  return encryptQortalPublicKeyEnvelopeInternal(input)
}

export function encryptQortalPublicKeyEnvelopeForTest(
  input: QortalEncryptedDataInput,
  seams: QortalEncryptedDataTestSeams,
): string {
  return encryptQortalPublicKeyEnvelopeInternal(input, seams)
}

function encryptQortalPublicKeyEnvelopeInternal(
  input: QortalEncryptedDataInput,
  seams?: QortalEncryptedDataTestSeams,
): string {
  const senderPublicKey = requireBytes(
    base58Decode(input.senderPublicKey58),
    PUBLIC_KEY_LENGTH,
    'Sender public key',
  )
  requireBytes(input.senderPrivateKey, 64, 'Sender private key')
  // The sender is always a recipient of their own data, and the list is
  // deduplicated so a repeated key does not produce a second wrapped copy.
  const recipients = [...new Set([...input.recipientPublicKeys58, input.senderPublicKey58])]
  if (recipients.length < 1 || recipients.length > MAX_ENCRYPT_RECIPIENTS) {
    throw new Error(`Encryption supports 1 to ${MAX_ENCRYPT_RECIPIENTS} recipients.`)
  }
  const payload = decodeStrictBase64(input.data64, 'The data to encrypt')

  const messageKey = requireBytes(
    seams?.messageKey ?? nacl.randomBytes(MESSAGE_KEY_LENGTH),
    MESSAGE_KEY_LENGTH,
    'Message key',
  )
  const nonce = requireBytes(seams?.nonce ?? nacl.randomBytes(NONCE_LENGTH), NONCE_LENGTH, 'Nonce')
  const keyNonce = requireBytes(
    seams?.keyNonce ?? nacl.randomBytes(KEY_NONCE_LENGTH),
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
  // The message key has done its work; a test-supplied one belongs to the
  // caller, so only a generated one is cleared here.
  if (!seams) messageKey.fill(0)
  return bytesToBase64(combined)
}

export type QortalDecryptedData = {
  readonly data64: string
  readonly senderPublicKey58: string
}

/**
 * Opens a `qortalGroupEncryptedData` envelope with the reader's own key.
 *
 * PROTOCOL LIMITATION, inherited from Qortal and not fixable here: the
 * authenticator covers the payload and each wrapped key individually, but NOT
 * the recipient block as a whole. Anyone can strip a 48-byte wrapped key and
 * decrement the trailing count; the remaining recipients still decrypt
 * normally. That cannot forge plaintext, but it means an opened envelope is
 * NOT evidence of who else could read it — callers must not treat the
 * recipient count as an authenticated fact.
 *
 * The reader is not told which wrapped key is theirs — Qortal's format does not
 * say — so every wrapped key is tried against the one shared secret the reader
 * can compute. A failure to open any of them means the data was not encrypted
 * to this account.
 */
export function decryptQortalPublicKeyEnvelope(input: {
  readonly encryptedBase64: string
  readonly readerPrivateKey: Uint8Array
}): QortalDecryptedData {
  requireBytes(input.readerPrivateKey, 64, 'Reader private key')
  const combined = decodeStrictBase64(input.encryptedBase64, 'The encrypted data')
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
  // Bounded by the envelope's own length rather than by a policy number: any
  // count whose key block actually fits is one Hub could legitimately have
  // written, and the dataEnd check below rejects the rest.
  if (count < 1 || count > (combined.length - headerLength - COUNT_LENGTH) / WRAPPED_KEY_LENGTH) {
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
          data64: bytesToBase64(payload),
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
