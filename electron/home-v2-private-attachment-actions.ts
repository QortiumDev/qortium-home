import ed2curve from 'ed2curve'
import nacl from 'tweetnacl'

import { computeQpgcKeyId } from './home-v2-private-group-chat-actions.js'
import {
  decryptQortalPrivateGroupAttachmentPayload,
  encryptQortalPrivateGroupAttachmentPayload,
  QORTAL_PRIVATE_GROUP_ATTACHMENT_TYPE,
  type QortalPrivateGroupKeyRing,
} from './home-v2-qortal-private-group-actions.js'

export const PRIVATE_CHAT_ATTACHMENT_MAX_ENVELOPE_BYTES = 1024 * 1024
export const PRIVATE_CHAT_ATTACHMENT_MAX_FILENAME_BYTES = 255
export const PRIVATE_CHAT_ATTACHMENT_MAX_MEDIA_TYPE_BYTES = 255

const QATT_MAGIC = new TextEncoder().encode('QATT')
const QATT_VERSION = 1
const QATT_FIXED_LENGTH = 46
const QENC_MAGIC = new TextEncoder().encode('QENC')
const QENC_VERSION = 2
const QENC_RECIPIENT_MODE = 1
const QENC_GROUP_MODE = 2
const QENC_AES_GCM = 1
const QENC_FIXED_HEADER_LENGTH = 10
const RECIPIENT_KEY_ID_LENGTH = 8
const CONTENT_NONCE_LENGTH = 12
const WRAP_NONCE_LENGTH = 12
const WRAPPED_KEY_LENGTH = 48
const RECIPIENT_PREFIX_LENGTH = 46
const RECIPIENT_ENTRY_LENGTH = 68
const GROUP_HEADER_LENGTH = 80
const PUBLIC_KEY_LENGTH = 32
const SECRET_KEY_LENGTH = 32
const CONTENT_KEY_LENGTH = 32

const CONTENT_AAD_DOMAIN = new TextEncoder().encode('QENC attachment content v2')
const RECIPIENT_WRAP_AAD_DOMAIN = new TextEncoder().encode('QENC attachment recipient wrap v2')
const RECIPIENT_WRAP_HKDF_SALT = new TextEncoder().encode('QENC attachment recipient hkdf salt v2')
const GROUP_CONTENT_INFO_DOMAIN = new TextEncoder().encode('QENC attachment group content v2')
const GROUP_CONTENT_HKDF_SALT = new TextEncoder().encode('QENC attachment group hkdf salt v2')
const QORTAL_DIRECT_PREFIX = new TextEncoder().encode('qortalEncryptedDataQENC2:')
const QORTAL_GROUP_PREFIX = new TextEncoder().encode('qortalGroupEncryptedDataQATT1:')

export type PrivateChatAttachmentPayload = Readonly<{
  data: Uint8Array
  filename: string
  mediaType: string
}>

export function sniffPrivateChatAttachmentMediaType(data: Uint8Array) {
  if (data.length >= 8 && equalBytes(data.subarray(0, 8), new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 6 && (new TextDecoder().decode(data.subarray(0, 6)) === 'GIF87a' || new TextDecoder().decode(data.subarray(0, 6)) === 'GIF89a')) return 'image/gif'
  if (
    data.length >= 12 &&
    new TextDecoder().decode(data.subarray(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(data.subarray(8, 12)) === 'WEBP'
  ) return 'image/webp'
  if (data.length >= 12 && new TextDecoder().decode(data.subarray(4, 12)).includes('ftypavif')) return 'image/avif'
  if (data.length >= 5 && new TextDecoder().decode(data.subarray(0, 5)) === '%PDF-') return 'application/pdf'
  return 'application/octet-stream'
}

export function isQortalHubCompatiblePrivateImageMediaType(value: string) {
  return ['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(value)
}

export type PrivateChatAttachmentEnvelope = Readonly<{
  ciphertext: Uint8Array
  contentNonce: Uint8Array
  epochId?: Uint8Array
  ephemeralPublicKey?: Uint8Array
  fixedHeader: Uint8Array
  groupId?: number
  keyId?: Uint8Array
  mode: 'group' | 'recipients'
  recipientEntries?: readonly Readonly<{
    keyId: Uint8Array
    wrapNonce: Uint8Array
    wrappedKey: Uint8Array
  }>[]
  variableHeader: Uint8Array
}>

function cryptoBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value)
}

function webCrypto() {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable.')
  return globalThis.crypto
}

function concatBytes(...values: readonly Uint8Array[]) {
  const result = new Uint8Array(values.reduce((sum, value) => sum + value.length, 0))
  let offset = 0
  for (const value of values) {
    result.set(value, offset)
    offset += value.length
  }
  return result
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function compareBytes(left: Uint8Array, right: Uint8Array) {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return left.length - right.length
}

function requireBytes(value: Uint8Array, expectedLength: number, label: string) {
  if (!(value instanceof Uint8Array) || value.length !== expectedLength) {
    throw new Error(`${label} must be ${expectedLength} bytes.`)
  }
  return value
}

function requirePositiveGroupId(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 0x7fff_ffff) {
    throw new Error('Private attachment groupId must be a positive signed 32-bit integer.')
  }
  return value
}

function uint16Bytes(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
    throw new Error('Private attachment length exceeds the unsigned 16-bit range.')
  }
  const result = new Uint8Array(2)
  new DataView(result.buffer).setUint16(0, value, false)
  return result
}

function uint32Bytes(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error('Private attachment length exceeds the unsigned 32-bit range.')
  }
  const result = new Uint8Array(4)
  new DataView(result.buffer).setUint32(0, value, false)
  return result
}

async function sha256(value: Uint8Array) {
  return new Uint8Array(await webCrypto().subtle.digest('SHA-256', cryptoBytes(value)))
}

async function hmacSha256(keyBytes: Uint8Array, value: Uint8Array) {
  const key = await webCrypto().subtle.importKey(
    'raw',
    cryptoBytes(keyBytes),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  return new Uint8Array(await webCrypto().subtle.sign('HMAC', key, cryptoBytes(value)))
}

async function hkdfSha256(input: Uint8Array, salt: Uint8Array, info: Uint8Array) {
  const prk = await hmacSha256(salt, input)
  try {
    return (await hmacSha256(prk, concatBytes(info, new Uint8Array([1])))).subarray(0, 32)
  } finally {
    prk.fill(0)
  }
}

async function aesGcm(
  operation: 'decrypt' | 'encrypt',
  keyBytes: Uint8Array,
  nonce: Uint8Array,
  associatedData: Uint8Array,
  value: Uint8Array,
) {
  requireBytes(keyBytes, CONTENT_KEY_LENGTH, 'Private attachment AES key')
  requireBytes(nonce, CONTENT_NONCE_LENGTH, 'Private attachment nonce')
  const key = await webCrypto().subtle.importKey('raw', cryptoBytes(keyBytes), 'AES-GCM', false, [operation])
  try {
    return new Uint8Array(await webCrypto().subtle[operation](
      {
        additionalData: cryptoBytes(associatedData),
        iv: cryptoBytes(nonce),
        name: 'AES-GCM',
        tagLength: 128,
      },
      key,
      cryptoBytes(value),
    ))
  } catch {
    throw new Error('Private attachment authentication failed.')
  }
}

function decodeUtf8(value: Uint8Array, label: string) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value)
  } catch {
    throw new Error(`Private attachment ${label} is not valid UTF-8.`)
  }
}

function hasControl(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
  })
}

function normalizeFilename(value: string) {
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\') || hasControl(value)) {
    throw new Error('Private attachment filename is invalid.')
  }
  const bytes = new TextEncoder().encode(value)
  if (bytes.length > PRIVATE_CHAT_ATTACHMENT_MAX_FILENAME_BYTES) {
    throw new Error('Private attachment filename is too long.')
  }
  return { bytes, value }
}

function normalizeMediaType(value: string) {
  const normalized = value ?? ''
  if (hasControl(normalized)) throw new Error('Private attachment media type is invalid.')
  const bytes = new TextEncoder().encode(normalized)
  if (bytes.length > PRIVATE_CHAT_ATTACHMENT_MAX_MEDIA_TYPE_BYTES) {
    throw new Error('Private attachment media type is too long.')
  }
  return { bytes, value: normalized }
}

export async function serializePrivateChatAttachmentPayload(input: PrivateChatAttachmentPayload) {
  if (!(input.data instanceof Uint8Array) || input.data.length < 1) {
    throw new Error('Private attachment data is missing.')
  }
  const filename = normalizeFilename(input.filename)
  const mediaType = normalizeMediaType(input.mediaType)
  return concatBytes(
    QATT_MAGIC,
    new Uint8Array([QATT_VERSION, 0]),
    uint16Bytes(filename.bytes.length),
    uint16Bytes(mediaType.bytes.length),
    uint32Bytes(input.data.length),
    await sha256(input.data),
    filename.bytes,
    mediaType.bytes,
    input.data,
  )
}

export async function parsePrivateChatAttachmentPayload(value: Uint8Array): Promise<PrivateChatAttachmentPayload> {
  if (!(value instanceof Uint8Array) || value.length < QATT_FIXED_LENGTH) {
    throw new Error('Private attachment payload is too short.')
  }
  if (!equalBytes(value.subarray(0, 4), QATT_MAGIC) || value[4] !== QATT_VERSION || value[5] !== 0) {
    throw new Error('Private attachment payload has unsupported framing.')
  }
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength)
  const filenameLength = view.getUint16(6, false)
  const mediaTypeLength = view.getUint16(8, false)
  const dataLength = view.getUint32(10, false)
  if (
    filenameLength < 1 ||
    filenameLength > PRIVATE_CHAT_ATTACHMENT_MAX_FILENAME_BYTES ||
    mediaTypeLength > PRIVATE_CHAT_ATTACHMENT_MAX_MEDIA_TYPE_BYTES ||
    dataLength < 1 ||
    QATT_FIXED_LENGTH + filenameLength + mediaTypeLength + dataLength !== value.length
  ) throw new Error('Private attachment payload has invalid lengths.')
  const filenameOffset = QATT_FIXED_LENGTH
  const mediaTypeOffset = filenameOffset + filenameLength
  const dataOffset = mediaTypeOffset + mediaTypeLength
  const filename = decodeUtf8(value.subarray(filenameOffset, mediaTypeOffset), 'filename')
  const mediaType = decodeUtf8(value.subarray(mediaTypeOffset, dataOffset), 'media type')
  normalizeFilename(filename)
  normalizeMediaType(mediaType)
  const data = new Uint8Array(value.subarray(dataOffset))
  if (!equalBytes(value.subarray(14, 46), await sha256(data))) {
    throw new Error('Private attachment data digest does not match.')
  }
  return Object.freeze({ data, filename, mediaType })
}

function signingKey(value: Uint8Array) {
  if (value.length === nacl.sign.seedLength) return nacl.sign.keyPair.fromSeed(value)
  if (value.length === nacl.sign.secretKeyLength) {
    return { publicKey: value.subarray(32, 64), secretKey: value }
  }
  throw new Error('Selected-account secret key must be a 32-byte seed or 64-byte Ed25519 key.')
}

function toX25519PublicKey(value: Uint8Array) {
  requireBytes(value, PUBLIC_KEY_LENGTH, 'Attachment recipient public key')
  const converted = ed2curve.convertPublicKey(value)
  if (!converted) throw new Error('Attachment recipient public key cannot be converted to X25519.')
  return converted
}

function toX25519SecretKey(value: Uint8Array) {
  const converted = ed2curve.convertSecretKey(signingKey(value).secretKey)
  if (!converted) throw new Error('Selected-account key cannot be converted to X25519.')
  return converted
}

async function recipientKeyId(publicKey: Uint8Array) {
  return (await sha256(requireBytes(publicKey, PUBLIC_KEY_LENGTH, 'Attachment recipient public key'))).subarray(0, 8)
}

export async function getPrivateChatAttachmentRecipientKeyId(publicKey: Uint8Array) {
  return new Uint8Array(await recipientKeyId(publicKey))
}

export async function assertPrivateChatAttachmentRecipients(
  envelope: Uint8Array,
  publicKeys: readonly Uint8Array[],
) {
  const parsed = parsePrivateChatAttachmentEnvelope(envelope)
  if (parsed.mode !== 'recipients' || !parsed.recipientEntries || parsed.recipientEntries.length !== publicKeys.length) {
    throw new Error('Private attachment recipients do not match the approved conversation.')
  }
  const expected = await Promise.all(publicKeys.map(recipientKeyId))
  expected.sort(compareBytes)
  if (expected.some((keyId, index) => !equalBytes(keyId, parsed.recipientEntries![index].keyId))) {
    throw new Error('Private attachment recipients do not match the approved conversation.')
  }
}

function fixedHeader(mode: number, variableHeaderLength: number) {
  return concatBytes(
    QENC_MAGIC,
    new Uint8Array([QENC_VERSION, mode, QENC_AES_GCM, 0]),
    uint16Bytes(variableHeaderLength),
  )
}

function contentAssociatedData(header: Uint8Array, variableHeader: Uint8Array) {
  return concatBytes(CONTENT_AAD_DOMAIN, header, variableHeader)
}

function recipientWrapAssociatedData(
  ephemeralPublicKey: Uint8Array,
  keyId: Uint8Array,
  contentNonce: Uint8Array,
) {
  return concatBytes(
    RECIPIENT_WRAP_AAD_DOMAIN,
    requireBytes(ephemeralPublicKey, PUBLIC_KEY_LENGTH, 'Attachment ephemeral public key'),
    requireBytes(keyId, RECIPIENT_KEY_ID_LENGTH, 'Attachment recipient keyId'),
    requireBytes(contentNonce, CONTENT_NONCE_LENGTH, 'Attachment content nonce'),
  )
}

export async function encryptPrivateChatAttachmentForRecipients(input: {
  contentKey?: Uint8Array
  contentNonce?: Uint8Array
  ephemeralPrivateKey?: Uint8Array
  payload: PrivateChatAttachmentPayload
  recipientPublicKeys: readonly Uint8Array[]
  wrapNonces?: readonly Uint8Array[]
}) {
  if (input.recipientPublicKeys.length < 1 || input.recipientPublicKeys.length > 256) {
    throw new Error('Private attachment recipient count is invalid.')
  }
  const payload = await serializePrivateChatAttachmentPayload(input.payload)
  const ephemeralPrivateKey = new Uint8Array(input.ephemeralPrivateKey ?? nacl.randomBytes(32))
  requireBytes(ephemeralPrivateKey, SECRET_KEY_LENGTH, 'Attachment ephemeral private key')
  const ephemeralPublicKey = nacl.scalarMult.base(ephemeralPrivateKey)
  const contentKey = new Uint8Array(input.contentKey ?? nacl.randomBytes(CONTENT_KEY_LENGTH))
  const contentNonce = new Uint8Array(input.contentNonce ?? nacl.randomBytes(CONTENT_NONCE_LENGTH))
  requireBytes(contentKey, CONTENT_KEY_LENGTH, 'Attachment content key')
  requireBytes(contentNonce, CONTENT_NONCE_LENGTH, 'Attachment content nonce')
  if (input.wrapNonces && input.wrapNonces.length !== input.recipientPublicKeys.length) {
    throw new Error('Private attachment wrap nonce count does not match.')
  }
  const recipients = await Promise.all(input.recipientPublicKeys.map(async (publicKey, index) => ({
    keyId: await recipientKeyId(publicKey),
    publicKey: new Uint8Array(publicKey),
    wrapNonce: new Uint8Array(input.wrapNonces?.[index] ?? nacl.randomBytes(WRAP_NONCE_LENGTH)),
  })))
  recipients.sort((left, right) => compareBytes(left.keyId, right.keyId))
  if (recipients.some((entry, index) => index > 0 && equalBytes(entry.keyId, recipients[index - 1].keyId))) {
    throw new Error('Private attachment recipient keyIds must be unique.')
  }
  const entries: Uint8Array[] = []
  try {
    for (const recipient of recipients) {
      requireBytes(recipient.wrapNonce, WRAP_NONCE_LENGTH, 'Attachment wrap nonce')
      const sharedSecret = nacl.scalarMult(ephemeralPrivateKey, toX25519PublicKey(recipient.publicKey))
      const associatedData = recipientWrapAssociatedData(ephemeralPublicKey, recipient.keyId, contentNonce)
      const wrappingKey = await hkdfSha256(sharedSecret, RECIPIENT_WRAP_HKDF_SALT, associatedData)
      try {
        const wrappedKey = await aesGcm('encrypt', wrappingKey, recipient.wrapNonce, associatedData, contentKey)
        requireBytes(wrappedKey, WRAPPED_KEY_LENGTH, 'Wrapped attachment content key')
        entries.push(concatBytes(recipient.keyId, recipient.wrapNonce, wrappedKey))
      } finally {
        sharedSecret.fill(0)
        wrappingKey.fill(0)
      }
    }
    const variableHeader = concatBytes(uint16Bytes(entries.length), contentNonce, ephemeralPublicKey, ...entries)
    const header = fixedHeader(QENC_RECIPIENT_MODE, variableHeader.length)
    const ciphertext = await aesGcm('encrypt', contentKey, contentNonce, contentAssociatedData(header, variableHeader), payload)
    const envelope = concatBytes(header, variableHeader, ciphertext)
    if (envelope.length > PRIVATE_CHAT_ATTACHMENT_MAX_ENVELOPE_BYTES) {
      throw new Error('Private attachment exceeds the 1 MiB encrypted envelope limit.')
    }
    return envelope
  } finally {
    ephemeralPrivateKey.fill(0)
    contentKey.fill(0)
  }
}

export async function encryptPrivateChatDirectAttachment(input: {
  contentKey?: Uint8Array
  contentNonce?: Uint8Array
  ephemeralPrivateKey?: Uint8Array
  payload: PrivateChatAttachmentPayload
  recipientPublicKey: Uint8Array
  senderPublicKey: Uint8Array
  wrapNonces?: readonly Uint8Array[]
}) {
  if (equalBytes(input.senderPublicKey, input.recipientPublicKey)) {
    throw new Error('Direct attachment participants must be distinct.')
  }
  return encryptPrivateChatAttachmentForRecipients({
    ...(input.contentKey ? { contentKey: input.contentKey } : {}),
    ...(input.contentNonce ? { contentNonce: input.contentNonce } : {}),
    ...(input.ephemeralPrivateKey ? { ephemeralPrivateKey: input.ephemeralPrivateKey } : {}),
    payload: input.payload,
    recipientPublicKeys: [input.senderPublicKey, input.recipientPublicKey],
    ...(input.wrapNonces ? { wrapNonces: input.wrapNonces } : {}),
  })
}

export function parsePrivateChatAttachmentEnvelope(value: Uint8Array): PrivateChatAttachmentEnvelope {
  if (!(value instanceof Uint8Array) || value.length > PRIVATE_CHAT_ATTACHMENT_MAX_ENVELOPE_BYTES || value.length < 26) {
    throw new Error('Private attachment has an invalid QENC v2 envelope.')
  }
  if (
    !equalBytes(value.subarray(0, 4), QENC_MAGIC) ||
    value[4] !== QENC_VERSION ||
    (value[5] !== QENC_RECIPIENT_MODE && value[5] !== QENC_GROUP_MODE) ||
    value[6] !== QENC_AES_GCM ||
    value[7] !== 0
  ) throw new Error('Private attachment has an invalid QENC v2 envelope.')
  const headerLength = new DataView(value.buffer, value.byteOffset, value.byteLength).getUint16(8, false)
  const ciphertextOffset = QENC_FIXED_HEADER_LENGTH + headerLength
  if (headerLength < 1 || ciphertextOffset + 16 > value.length) {
    throw new Error('Private attachment has an invalid QENC v2 envelope.')
  }
  const fixed = new Uint8Array(value.subarray(0, QENC_FIXED_HEADER_LENGTH))
  const variable = new Uint8Array(value.subarray(QENC_FIXED_HEADER_LENGTH, ciphertextOffset))
  const ciphertext = new Uint8Array(value.subarray(ciphertextOffset))
  if (value[5] === QENC_RECIPIENT_MODE) {
    if (variable.length < RECIPIENT_PREFIX_LENGTH + RECIPIENT_ENTRY_LENGTH) {
      throw new Error('Private attachment recipient header is truncated.')
    }
    const count = new DataView(variable.buffer, variable.byteOffset, variable.byteLength).getUint16(0, false)
    if (count < 1 || count > 256 || variable.length !== RECIPIENT_PREFIX_LENGTH + count * RECIPIENT_ENTRY_LENGTH) {
      throw new Error('Private attachment recipient header has an invalid count or length.')
    }
    const contentNonce = new Uint8Array(variable.subarray(2, 14))
    const ephemeralPublicKey = new Uint8Array(variable.subarray(14, 46))
    if (ephemeralPublicKey.every((byte) => byte === 0)) throw new Error('Attachment ephemeral public key is invalid.')
    const entries = []
    for (let index = 0; index < count; index += 1) {
      const offset = RECIPIENT_PREFIX_LENGTH + index * RECIPIENT_ENTRY_LENGTH
      const keyId = new Uint8Array(variable.subarray(offset, offset + 8))
      const wrapNonce = new Uint8Array(variable.subarray(offset + 8, offset + 20))
      const wrappedKey = new Uint8Array(variable.subarray(offset + 20, offset + 68))
      if (keyId.every((byte) => byte === 0) || (entries.length && compareBytes(entries.at(-1)!.keyId, keyId) >= 0)) {
        throw new Error('Private attachment recipient keyIds are invalid or non-canonical.')
      }
      entries.push(Object.freeze({ keyId, wrapNonce, wrappedKey }))
    }
    return Object.freeze({
      ciphertext,
      contentNonce,
      ephemeralPublicKey,
      fixedHeader: fixed,
      mode: 'recipients' as const,
      recipientEntries: Object.freeze(entries),
      variableHeader: variable,
    })
  }
  if (variable.length !== GROUP_HEADER_LENGTH) throw new Error('Private attachment group header has an invalid length.')
  const groupId = new DataView(variable.buffer, variable.byteOffset, variable.byteLength).getUint32(0, false)
  if (groupId < 1 || groupId > 0x7fff_ffff) throw new Error('Private attachment groupId is invalid.')
  const epochId = new Uint8Array(variable.subarray(4, 36))
  const keyId = new Uint8Array(variable.subarray(36, 68))
  const contentNonce = new Uint8Array(variable.subarray(68, 80))
  if (epochId.every((byte) => byte === 0) || keyId.every((byte) => byte === 0)) {
    throw new Error('Private attachment group context is invalid.')
  }
  return Object.freeze({
    ciphertext,
    contentNonce,
    epochId,
    fixedHeader: fixed,
    groupId,
    keyId,
    mode: 'group' as const,
    variableHeader: variable,
  })
}

export async function decryptPrivateChatAttachmentForRecipient(input: {
  envelope: Uint8Array
  selectedAccountSecretKey: Uint8Array
}) {
  const parsed = parsePrivateChatAttachmentEnvelope(input.envelope)
  if (parsed.mode !== 'recipients' || !parsed.ephemeralPublicKey || !parsed.recipientEntries) {
    throw new Error('Private attachment is not recipient encrypted.')
  }
  const localKey = signingKey(input.selectedAccountSecretKey)
  const localKeyId = await recipientKeyId(localKey.publicKey)
  const entry = parsed.recipientEntries.find((candidate) => equalBytes(candidate.keyId, localKeyId))
  if (!entry) throw new Error('Selected account is not an attachment recipient.')
  const curveSecretKey = toX25519SecretKey(input.selectedAccountSecretKey)
  const sharedSecret = nacl.scalarMult(curveSecretKey, parsed.ephemeralPublicKey)
  const associatedData = recipientWrapAssociatedData(parsed.ephemeralPublicKey, entry.keyId, parsed.contentNonce)
  const wrappingKey = await hkdfSha256(sharedSecret, RECIPIENT_WRAP_HKDF_SALT, associatedData)
  let contentKey: Uint8Array | null = null
  try {
    contentKey = await aesGcm('decrypt', wrappingKey, entry.wrapNonce, associatedData, entry.wrappedKey)
    const plaintext = await aesGcm(
      'decrypt',
      contentKey,
      parsed.contentNonce,
      contentAssociatedData(parsed.fixedHeader, parsed.variableHeader),
      parsed.ciphertext,
    )
    return parsePrivateChatAttachmentPayload(plaintext)
  } finally {
    curveSecretKey.fill(0)
    sharedSecret.fill(0)
    wrappingKey.fill(0)
    contentKey?.fill(0)
  }
}

async function groupContentInfo(groupId: number, epochId: Uint8Array, keyId: Uint8Array) {
  return concatBytes(
    GROUP_CONTENT_INFO_DOMAIN,
    uint32Bytes(requirePositiveGroupId(groupId)),
    requireBytes(epochId, 32, 'Private attachment epochId'),
    requireBytes(keyId, 32, 'Private attachment group keyId'),
  )
}

export async function encryptPrivateChatGroupAttachment(input: {
  contentNonce?: Uint8Array
  epochId: Uint8Array
  groupId: number
  groupKey: Uint8Array
  keyId: Uint8Array
  payload: PrivateChatAttachmentPayload
}) {
  requireBytes(input.groupKey, 32, 'Private attachment group key')
  if (!equalBytes(await computeQpgcKeyId(input.groupId, input.epochId, input.groupKey), input.keyId)) {
    throw new Error('Private attachment group key does not match keyId.')
  }
  const payload = await serializePrivateChatAttachmentPayload(input.payload)
  const contentNonce = new Uint8Array(input.contentNonce ?? nacl.randomBytes(12))
  const variableHeader = concatBytes(
    uint32Bytes(requirePositiveGroupId(input.groupId)),
    requireBytes(input.epochId, 32, 'Private attachment epochId'),
    requireBytes(input.keyId, 32, 'Private attachment group keyId'),
    requireBytes(contentNonce, 12, 'Private attachment content nonce'),
  )
  const header = fixedHeader(QENC_GROUP_MODE, variableHeader.length)
  const contentKey = await hkdfSha256(
    input.groupKey,
    GROUP_CONTENT_HKDF_SALT,
    await groupContentInfo(input.groupId, input.epochId, input.keyId),
  )
  try {
    const ciphertext = await aesGcm('encrypt', contentKey, contentNonce, contentAssociatedData(header, variableHeader), payload)
    const envelope = concatBytes(header, variableHeader, ciphertext)
    if (envelope.length > PRIVATE_CHAT_ATTACHMENT_MAX_ENVELOPE_BYTES) {
      throw new Error('Private attachment exceeds the 1 MiB encrypted envelope limit.')
    }
    return envelope
  } finally {
    contentKey.fill(0)
  }
}

export async function decryptPrivateChatGroupAttachment(input: {
  envelope: Uint8Array
  epochId: Uint8Array
  groupId: number
  groupKey: Uint8Array
  keyId: Uint8Array
}) {
  if (!equalBytes(await computeQpgcKeyId(input.groupId, input.epochId, input.groupKey), input.keyId)) {
    throw new Error('Private attachment group key does not match keyId.')
  }
  const parsed = parsePrivateChatAttachmentEnvelope(input.envelope)
  if (
    parsed.mode !== 'group' ||
    parsed.groupId !== input.groupId ||
    !parsed.epochId ||
    !parsed.keyId ||
    !equalBytes(parsed.epochId, input.epochId) ||
    !equalBytes(parsed.keyId, input.keyId)
  ) throw new Error('Private attachment group context does not match.')
  const contentKey = await hkdfSha256(
    requireBytes(input.groupKey, 32, 'Private attachment group key'),
    GROUP_CONTENT_HKDF_SALT,
    await groupContentInfo(input.groupId, input.epochId, input.keyId),
  )
  try {
    const plaintext = await aesGcm(
      'decrypt',
      contentKey,
      parsed.contentNonce,
      contentAssociatedData(parsed.fixedHeader, parsed.variableHeader),
      parsed.ciphertext,
    )
    return parsePrivateChatAttachmentPayload(plaintext)
  } finally {
    contentKey.fill(0)
  }
}

export async function encryptQortalPrivateChatDirectAttachment(input: {
  contentKey?: Uint8Array
  contentNonce?: Uint8Array
  ephemeralPrivateKey?: Uint8Array
  payload: PrivateChatAttachmentPayload
  recipientPublicKey: Uint8Array
  senderPublicKey: Uint8Array
  wrapNonces?: readonly Uint8Array[]
}) {
  const envelope = await encryptPrivateChatDirectAttachment(input)
  const result = concatBytes(QORTAL_DIRECT_PREFIX, envelope)
  if (result.length > PRIVATE_CHAT_ATTACHMENT_MAX_ENVELOPE_BYTES) {
    throw new Error('Encrypted Qortal direct attachment exceeds the 1 MiB resource limit.')
  }
  return result
}

export async function decryptQortalPrivateChatDirectAttachment(input: {
  envelope: Uint8Array
  selectedAccountSecretKey: Uint8Array
}) {
  if (!equalBytes(input.envelope.subarray(0, QORTAL_DIRECT_PREFIX.length), QORTAL_DIRECT_PREFIX)) {
    throw new Error('Qortal direct attachment prefix is invalid.')
  }
  return decryptPrivateChatAttachmentForRecipient({
    envelope: input.envelope.subarray(QORTAL_DIRECT_PREFIX.length),
    selectedAccountSecretKey: input.selectedAccountSecretKey,
  })
}

export function getQortalPrivateChatDirectQencEnvelope(envelope: Uint8Array) {
  if (!equalBytes(envelope.subarray(0, QORTAL_DIRECT_PREFIX.length), QORTAL_DIRECT_PREFIX)) {
    throw new Error('Qortal direct attachment prefix is invalid.')
  }
  return envelope.subarray(QORTAL_DIRECT_PREFIX.length)
}

export async function encryptQortalPrivateChatGroupAttachment(input: {
  keyRing: QortalPrivateGroupKeyRing
  nonce?: Uint8Array
  payload: PrivateChatAttachmentPayload
}) {
  const payload = await serializePrivateChatAttachmentPayload(input.payload)
  try {
    const ciphertext = encryptQortalPrivateGroupAttachmentPayload({
      keyRing: input.keyRing,
      ...(input.nonce ? { nonce: input.nonce } : {}),
      plaintext: payload,
      typeNumber: QORTAL_PRIVATE_GROUP_ATTACHMENT_TYPE,
    })
    const result = concatBytes(QORTAL_GROUP_PREFIX, new TextEncoder().encode(ciphertext))
    if (result.length > PRIVATE_CHAT_ATTACHMENT_MAX_ENVELOPE_BYTES) {
      throw new Error('Encrypted Qortal private-group attachment exceeds the 1 MiB resource limit.')
    }
    return result
  } finally {
    payload.fill(0)
  }
}

export async function decryptQortalPrivateChatGroupAttachment(input: {
  envelope: Uint8Array
  keyRing: QortalPrivateGroupKeyRing
}) {
  if (!equalBytes(input.envelope.subarray(0, QORTAL_GROUP_PREFIX.length), QORTAL_GROUP_PREFIX)) {
    throw new Error('Qortal private-group attachment prefix is invalid.')
  }
  let ciphertext: string
  try {
    ciphertext = new TextDecoder('utf-8', { fatal: true }).decode(input.envelope.subarray(QORTAL_GROUP_PREFIX.length))
  } catch {
    throw new Error('Qortal private-group attachment ciphertext is not valid UTF-8.')
  }
  const decrypted = decryptQortalPrivateGroupAttachmentPayload({ ciphertext, keyRing: input.keyRing })
  try {
    return await parsePrivateChatAttachmentPayload(decrypted.plaintext)
  } finally {
    decrypted.plaintext.fill(0)
  }
}

export function encryptQortalHubPrivateGroupImage(input: {
  data: Uint8Array
  keyRing: QortalPrivateGroupKeyRing
  nonce?: Uint8Array
}) {
  return new TextEncoder().encode(encryptQortalPrivateGroupAttachmentPayload({
    keyRing: input.keyRing,
    ...(input.nonce ? { nonce: input.nonce } : {}),
    plaintext: input.data,
    typeNumber: 2,
  }))
}

export function decryptQortalHubPrivateGroupImage(input: {
  ciphertext: Uint8Array
  keyRing: QortalPrivateGroupKeyRing
}) {
  let value: string
  try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(input.ciphertext)
  } catch {
    throw new Error('Qortal Hub private-group image ciphertext is not valid UTF-8.')
  }
  return decryptQortalPrivateGroupAttachmentPayload({ ciphertext: value, expectedType: 2, keyRing: input.keyRing }).plaintext
}
