import ed2curve from 'ed2curve'
import nacl from 'tweetnacl'

export const DIRECT_CHAT_MAX_DATA_SIZE = 4_000
export const QDM1_MAGIC = new TextEncoder().encode('QDM1')
export const QDM1_ENVELOPE_OVERHEAD = 84
export const QDM1_MAX_PLAINTEXT_SIZE = DIRECT_CHAT_MAX_DATA_SIZE - QDM1_ENVELOPE_OVERHEAD - 16

const QDM1_KEY_SALT = new TextEncoder().encode('QDM1 shared key hkdf salt v1')
const QDM1_MESSAGE_DOMAIN = new TextEncoder().encode('QDM1 message v1')
const QDM1_NONCE_LENGTH = 12
const QORTAL_DIRECT_NONCE_LENGTH = 24
const PUBLIC_KEY_LENGTH = 32

export type DirectChatCodec = 'qortal-legacy-v2' | 'qortium-qdm1-v1'

export type DirectChatDecryptResult =
  | { data: Uint8Array; status: 'DECRYPTED' }
  | { error: string; status: 'FAILED' | 'UNSUPPORTED' }

function concatBytes(...chunks: Uint8Array[]) {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function requireLength(value: Uint8Array, length: number, label: string) {
  if (value.length !== length) throw new Error(`${label} must be ${length} bytes.`)
  return value
}

function getEd25519SecretKey(value: Uint8Array) {
  if (value.length === nacl.sign.seedLength) return nacl.sign.keyPair.fromSeed(value).secretKey
  if (value.length === nacl.sign.secretKeyLength) return value
  throw new Error('Selected-account secret key must be a 32-byte seed or 64-byte Ed25519 key.')
}

function getWebCrypto() {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable.')
  return globalThis.crypto
}

function cryptoBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value)
}

function uint32Bytes(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error('Ciphertext length is outside the unsigned 32-bit range.')
  }
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

export function deriveDirectChatSharedSecret(
  selectedAccountSecretKey: Uint8Array,
  peerPublicKey: Uint8Array,
) {
  requireLength(peerPublicKey, PUBLIC_KEY_LENGTH, 'Peer public key')
  const secretKey = getEd25519SecretKey(selectedAccountSecretKey)
  const curveSecretKey = ed2curve.convertSecretKey(secretKey)
  const curvePublicKey = ed2curve.convertPublicKey(peerPublicKey)
  if (!curvePublicKey) throw new Error('Peer public key cannot be converted for direct-message encryption.')
  // Use the raw X25519 agreement output. tweetnacl.box.before additionally
  // applies HSalsa20 and therefore does not match either chain's protocol.
  const sharedSecret = nacl.scalarMult(curveSecretKey, curvePublicKey)
  curveSecretKey.fill(0)
  return sharedSecret
}

export function getQdm1AssociatedData(senderPublicKey: Uint8Array, recipientPublicKey: Uint8Array) {
  requireLength(senderPublicKey, PUBLIC_KEY_LENGTH, 'Sender public key')
  requireLength(recipientPublicKey, PUBLIC_KEY_LENGTH, 'Recipient public key')
  return concatBytes(QDM1_MESSAGE_DOMAIN, QDM1_MAGIC, senderPublicKey, recipientPublicKey)
}

export async function deriveQdm1SharedKey(
  sharedSecret: Uint8Array,
  senderPublicKey: Uint8Array,
  recipientPublicKey: Uint8Array,
) {
  requireLength(sharedSecret, 32, 'Direct-message shared secret')
  const crypto = getWebCrypto()
  const saltKey = await crypto.subtle.importKey(
    'raw',
    QDM1_KEY_SALT,
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', saltKey, cryptoBytes(sharedSecret)))
  try {
    const prkKey = await crypto.subtle.importKey(
      'raw',
      prk,
      { hash: 'SHA-256', name: 'HMAC' },
      false,
      ['sign'],
    )
    return new Uint8Array(await crypto.subtle.sign(
      'HMAC',
      prkKey,
      concatBytes(getQdm1AssociatedData(senderPublicKey, recipientPublicKey), new Uint8Array([1])),
    ))
  } finally {
    prk.fill(0)
  }
}

export function parseQdm1Envelope(envelope: Uint8Array) {
  if (envelope.length < QDM1_ENVELOPE_OVERHEAD + 16) {
    throw new Error('QDM1 envelope is truncated.')
  }
  if (!equalBytes(envelope.subarray(0, 4), QDM1_MAGIC)) {
    throw new Error('Direct message is not a QDM1 envelope.')
  }
  const ciphertextLength = new DataView(
    envelope.buffer,
    envelope.byteOffset + 80,
    4,
  ).getUint32(0, false)
  if (ciphertextLength < 16 || envelope.length !== QDM1_ENVELOPE_OVERHEAD + ciphertextLength) {
    throw new Error('QDM1 envelope has an invalid ciphertext length or trailing bytes.')
  }
  return {
    ciphertext: envelope.subarray(QDM1_ENVELOPE_OVERHEAD),
    nonce: envelope.subarray(68, 80),
    recipientPublicKey: envelope.subarray(36, 68),
    senderPublicKey: envelope.subarray(4, 36),
  }
}

export async function encryptQdm1Message(input: {
  nonce: Uint8Array
  plaintext: Uint8Array
  recipientPublicKey: Uint8Array
  selectedAccountSecretKey: Uint8Array
  senderPublicKey: Uint8Array
}) {
  requireLength(input.nonce, QDM1_NONCE_LENGTH, 'QDM1 nonce')
  requireLength(input.senderPublicKey, PUBLIC_KEY_LENGTH, 'Sender public key')
  requireLength(input.recipientPublicKey, PUBLIC_KEY_LENGTH, 'Recipient public key')
  if (input.plaintext.length < 1 || input.plaintext.length > QDM1_MAX_PLAINTEXT_SIZE) {
    throw new Error(`QDM1 plaintext must be between 1 and ${QDM1_MAX_PLAINTEXT_SIZE} bytes.`)
  }
  const sharedSecret = deriveDirectChatSharedSecret(
    input.selectedAccountSecretKey,
    input.recipientPublicKey,
  )
  try {
    const sharedKey = await deriveQdm1SharedKey(
      sharedSecret,
      input.senderPublicKey,
      input.recipientPublicKey,
    )
    try {
      const key = await getWebCrypto().subtle.importKey('raw', sharedKey, 'AES-GCM', false, ['encrypt'])
      const ciphertext = new Uint8Array(await getWebCrypto().subtle.encrypt(
        {
          additionalData: cryptoBytes(getQdm1AssociatedData(input.senderPublicKey, input.recipientPublicKey)),
          iv: cryptoBytes(input.nonce),
          name: 'AES-GCM',
          tagLength: 128,
        },
        key,
        cryptoBytes(input.plaintext),
      ))
      return concatBytes(
        QDM1_MAGIC,
        input.senderPublicKey,
        input.recipientPublicKey,
        input.nonce,
        uint32Bytes(ciphertext.length),
        ciphertext,
      )
    } finally {
      sharedKey.fill(0)
    }
  } finally {
    sharedSecret.fill(0)
  }
}

export async function decryptQdm1Message(input: {
  envelope: Uint8Array
  localPublicKey: Uint8Array
  selectedAccountSecretKey: Uint8Array
}) {
  requireLength(input.localPublicKey, PUBLIC_KEY_LENGTH, 'Local public key')
  const parsed = parseQdm1Envelope(input.envelope)
  const isSender = equalBytes(input.localPublicKey, parsed.senderPublicKey)
  const isRecipient = equalBytes(input.localPublicKey, parsed.recipientPublicKey)
  if (!isSender && !isRecipient) throw new Error('QDM1 envelope does not involve the selected account.')
  const peerPublicKey = isSender ? parsed.recipientPublicKey : parsed.senderPublicKey
  const sharedSecret = deriveDirectChatSharedSecret(input.selectedAccountSecretKey, peerPublicKey)
  try {
    const sharedKey = await deriveQdm1SharedKey(
      sharedSecret,
      parsed.senderPublicKey,
      parsed.recipientPublicKey,
    )
    try {
      const key = await getWebCrypto().subtle.importKey('raw', sharedKey, 'AES-GCM', false, ['decrypt'])
      return new Uint8Array(await getWebCrypto().subtle.decrypt(
        {
          additionalData: cryptoBytes(getQdm1AssociatedData(parsed.senderPublicKey, parsed.recipientPublicKey)),
          iv: cryptoBytes(parsed.nonce),
          name: 'AES-GCM',
          tagLength: 128,
        },
        key,
        cryptoBytes(parsed.ciphertext),
      ))
    } catch {
      throw new Error('QDM1 message authentication failed.')
    } finally {
      sharedKey.fill(0)
    }
  } finally {
    sharedSecret.fill(0)
  }
}

export async function deriveQortalDirectEncryptionKey(sharedSecret: Uint8Array) {
  requireLength(sharedSecret, 32, 'Direct-message shared secret')
  return new Uint8Array(await getWebCrypto().subtle.digest('SHA-256', cryptoBytes(sharedSecret)))
}

export async function encryptQortalDirectMessage(input: {
  lastReference: Uint8Array
  plaintext: Uint8Array
  peerPublicKey: Uint8Array
  selectedAccountSecretKey: Uint8Array
}) {
  requireLength(input.lastReference, 64, 'Qortal last reference')
  if (input.plaintext.length < 1 || input.plaintext.length + nacl.secretbox.overheadLength > DIRECT_CHAT_MAX_DATA_SIZE) {
    throw new Error(`Qortal direct-message plaintext must fit within ${DIRECT_CHAT_MAX_DATA_SIZE} encrypted bytes.`)
  }
  const sharedSecret = deriveDirectChatSharedSecret(input.selectedAccountSecretKey, input.peerPublicKey)
  try {
    const encryptionKey = await deriveQortalDirectEncryptionKey(sharedSecret)
    try {
      return nacl.secretbox(
        input.plaintext,
        input.lastReference.subarray(0, QORTAL_DIRECT_NONCE_LENGTH),
        encryptionKey,
      )
    } finally {
      encryptionKey.fill(0)
    }
  } finally {
    sharedSecret.fill(0)
  }
}

export async function decryptQortalDirectMessage(input: {
  ciphertext: Uint8Array
  lastReference: Uint8Array
  peerPublicKey: Uint8Array
  selectedAccountSecretKey: Uint8Array
}) {
  requireLength(input.lastReference, 64, 'Qortal last reference')
  if (input.ciphertext.length < nacl.secretbox.overheadLength || input.ciphertext.length > DIRECT_CHAT_MAX_DATA_SIZE) {
    throw new Error('Qortal direct-message ciphertext length is invalid.')
  }
  const sharedSecret = deriveDirectChatSharedSecret(input.selectedAccountSecretKey, input.peerPublicKey)
  try {
    const encryptionKey = await deriveQortalDirectEncryptionKey(sharedSecret)
    try {
      const plaintext = nacl.secretbox.open(
        input.ciphertext,
        input.lastReference.subarray(0, QORTAL_DIRECT_NONCE_LENGTH),
        encryptionKey,
      )
      if (!plaintext) throw new Error('Qortal direct-message authentication failed.')
      return plaintext
    } finally {
      encryptionKey.fill(0)
    }
  } finally {
    sharedSecret.fill(0)
  }
}

function requireDirectText(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Direct-message text must not be empty.')
  return value.trim()
}

function requireSpecialId(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error('Direct-message specialId must use 1 to 128 letters, numbers, underscores, or hyphens.')
  }
  return value
}

export function buildQortalDirectMessagePayload(input: {
  operation: 'delete' | 'edit' | 'initial' | 'reaction'
  repliedTo?: string | null
  specialId: string
  text?: string
  reaction?: string
  reactionState?: boolean
}) {
  const specialId = requireSpecialId(input.specialId)
  const repliedTo = typeof input.repliedTo === 'string' ? input.repliedTo : ''
  let payload: Record<string, unknown>
  if (input.operation === 'reaction') {
    if (typeof input.reaction !== 'string' || !input.reaction || input.reaction.length > 32) {
      throw new Error('Reaction content must be between 1 and 32 characters.')
    }
    if (typeof input.reactionState !== 'boolean') throw new Error('Reaction state is required.')
    payload = {
      content: input.reaction,
      contentState: input.reactionState,
      message: '',
      specialId,
      type: 'reaction',
      version: 2,
    }
  } else if (input.operation === 'delete') {
    // Qortal CHAT transactions are immutable. The interoperable delete is a
    // content-clearing version-2 edit, never an invalid/hidden transaction and
    // never a claim that the original transaction was erased.
    payload = {
      isEdited: true,
      message: '<p></p>',
      repliedTo: '',
      specialId,
      type: 'edit',
      version: 2,
    }
  } else {
    payload = {
      ...(input.operation === 'edit' ? { isEdited: true, type: 'edit' } : { type: '' }),
      message: requireDirectText(input.text),
      repliedTo,
      specialId,
      version: 2,
    }
  }
  const encoded = new TextEncoder().encode(JSON.stringify(payload))
  if (encoded.length + nacl.secretbox.overheadLength > DIRECT_CHAT_MAX_DATA_SIZE) {
    throw new Error(`Qortal direct-message payload must fit within ${DIRECT_CHAT_MAX_DATA_SIZE} encrypted bytes.`)
  }
  return new TextDecoder().decode(encoded)
}
