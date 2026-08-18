import nacl from 'tweetnacl'

import { deriveDirectChatSharedSecret } from './home-v2-direct-chat-actions.js'

export const QORTAL_PRIVATE_GROUP_BUNDLE_MARKER = new TextEncoder().encode('qortalGroupEncryptedData')
export const QORTAL_PRIVATE_GROUP_MAX_BUNDLE_BYTES = 2 * 1024 * 1024
export const QORTAL_PRIVATE_GROUP_MAX_KEY_VERSIONS = 4_096
export const QORTAL_PRIVATE_GROUP_MAX_MEMBERS = 4_096
// The encrypted payload is itself Base64 text inside a Qortal CHAT transaction.
// Old-format messages Base64-wrap the secretbox and then Base64-wrap the full
// version+ciphertext string again, so they are the worst case. This ceiling
// keeps both retained old messages and the newer binary form within Core's
// 4,000-byte CHAT data limit.
export const QORTAL_PRIVATE_GROUP_MAX_CHAT_DATA_BYTES = 4_000
export const QORTAL_PRIVATE_GROUP_MAX_PLAINTEXT_BYTES = 2_225

const PUBLIC_KEY_BYTES = 32
const MESSAGE_KEY_BYTES = 32
const NONCE_BYTES = 24
const WRAPPED_KEY_BYTES = MESSAGE_KEY_BYTES + nacl.secretbox.overheadLength
const KEY_VERSION_DIGITS = 10
const TYPE_DIGITS = 3
const STORAGE_NONCE_BYTES = 12
const STORAGE_SALT = new TextEncoder().encode('Qortal private group Home key store v1')
const STORAGE_DOMAIN = new TextEncoder().encode('Qortal private group key ring v1')

export type QortalPrivateGroupKeyEntry = {
  readonly messageKey: Uint8Array
  readonly nonce?: Uint8Array
}

export type QortalPrivateGroupKeyRing = ReadonlyMap<number, QortalPrivateGroupKeyEntry>

export type EncryptedQortalPrivateGroupKeyRing = {
  readonly accountPublicKey: string
  readonly ciphertext: string
  readonly groupId: number
  readonly network: 'qortal'
  readonly nonce: string
  readonly publisherName: string
  readonly recipientCount: number
  readonly resourceSignature: string
  readonly version: 1
}

function concatBytes(...chunks: readonly Uint8Array[]) {
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

function requireBytes(value: Uint8Array, length: number, label: string) {
  if (!(value instanceof Uint8Array) || value.length !== length) throw new Error(`${label} must be ${length} bytes.`)
  return value
}

function requireGroupId(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 0x7fff_ffff) {
    throw new Error('Qortal private-group groupId must be a positive signed 32-bit integer.')
  }
  return value
}

function requireRecipientCount(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > QORTAL_PRIVATE_GROUP_MAX_MEMBERS) {
    throw new Error(`Qortal private-group recipient count must be between 1 and ${QORTAL_PRIVATE_GROUP_MAX_MEMBERS}.`)
  }
  return value
}

function requireKeyVersion(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 9_999_999_999) {
    throw new Error('Qortal private-group key version must fit ten decimal digits.')
  }
  return value
}

function requireTypeNumber(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 999) {
    throw new Error('Qortal private-group payload type must fit three decimal digits.')
  }
  return value
}

function encodeBase64(value: Uint8Array) {
  if (typeof Buffer !== 'undefined') return Buffer.from(value).toString('base64')
  let binary = ''
  for (let index = 0; index < value.length; index += 0x8000) {
    binary += String.fromCharCode(...value.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

function decodeCanonicalBase64(value: unknown, label: string, maxBytes = QORTAL_PRIVATE_GROUP_MAX_BUNDLE_BYTES) {
  if (typeof value !== 'string' || value.length < 1 || value.length > Math.ceil(maxBytes / 3) * 4 + 8) {
    throw new Error(`${label} is missing or exceeds its encoded limit.`)
  }
  let bytes: Uint8Array
  try {
    if (typeof Buffer !== 'undefined') bytes = new Uint8Array(Buffer.from(value, 'base64'))
    else {
      const binary = atob(value)
      bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    }
  } catch {
    throw new Error(`${label} is not valid Base64.`)
  }
  if (bytes.length > maxBytes || encodeBase64(bytes) !== value) throw new Error(`${label} is not canonical Base64.`)
  return bytes
}

function getSigningKey(value: Uint8Array) {
  if (value.length === nacl.sign.seedLength) return nacl.sign.keyPair.fromSeed(value)
  if (value.length === nacl.sign.secretKeyLength) {
    return { publicKey: value.subarray(32, 64), secretKey: value }
  }
  throw new Error('Selected-account secret key must be a 32-byte seed or 64-byte Ed25519 key.')
}

function uniquePublicKeys(values: readonly Uint8Array[], senderPublicKey: Uint8Array) {
  const seen = new Set<string>()
  const result: Uint8Array[] = []
  for (const value of [...values, senderPublicKey]) {
    requireBytes(value, PUBLIC_KEY_BYTES, 'Qortal private-group member public key')
    const identity = encodeBase64(value)
    if (seen.has(identity)) continue
    seen.add(identity)
    result.push(new Uint8Array(value))
  }
  if (result.length < 1 || result.length > QORTAL_PRIVATE_GROUP_MAX_MEMBERS) {
    throw new Error(`Qortal private groups support 1 to ${QORTAL_PRIVATE_GROUP_MAX_MEMBERS} recipient keys in Home.`)
  }
  return result
}

function uint32LittleEndian(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new Error('Recipient count is invalid.')
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, true)
  return bytes
}

function parseAsciiDigits(bytes: Uint8Array, offset: number, length: number, label: string) {
  if (offset + length > bytes.length) throw new Error(`${label} is truncated.`)
  const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + length))
  if (!/^\d+$/.test(value)) throw new Error(`${label} must contain decimal digits.`)
  return Number(value)
}

function sortedRingEntries(keyRing: QortalPrivateGroupKeyRing) {
  const entries = [...keyRing.entries()].sort(([left], [right]) => left - right)
  if (entries.length < 1 || entries.length > QORTAL_PRIVATE_GROUP_MAX_KEY_VERSIONS) {
    throw new Error(`Qortal private-group key ring must contain 1 to ${QORTAL_PRIVATE_GROUP_MAX_KEY_VERSIONS} versions.`)
  }
  for (const [version, entry] of entries) {
    requireKeyVersion(version)
    requireBytes(entry.messageKey, MESSAGE_KEY_BYTES, `Qortal private-group key ${version}`)
    if (entry.nonce) requireBytes(entry.nonce, NONCE_BYTES, `Qortal private-group legacy nonce ${version}`)
  }
  return entries
}

export function parseQortalPrivateGroupKeyRing(value: unknown): QortalPrivateGroupKeyRing {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Qortal private-group key bundle must contain a JSON object.')
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length < 1 || entries.length > QORTAL_PRIVATE_GROUP_MAX_KEY_VERSIONS) {
    throw new Error(`Qortal private-group key ring must contain 1 to ${QORTAL_PRIVATE_GROUP_MAX_KEY_VERSIONS} versions.`)
  }
  const ring = new Map<number, QortalPrivateGroupKeyEntry>()
  for (const [rawVersion, rawEntry] of entries) {
    if (!/^[1-9]\d{0,9}$/.test(rawVersion)) throw new Error('Qortal private-group key version is invalid.')
    const version = requireKeyVersion(Number(rawVersion))
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      throw new Error(`Qortal private-group key ${version} is invalid.`)
    }
    const entry = rawEntry as Record<string, unknown>
    const allowed = new Set(['messageKey', 'nonce'])
    if (Object.keys(entry).some((key) => !allowed.has(key))) {
      throw new Error(`Qortal private-group key ${version} contains unsupported fields.`)
    }
    const messageKey = requireBytes(
      decodeCanonicalBase64(entry.messageKey, `Qortal private-group key ${version}`, MESSAGE_KEY_BYTES),
      MESSAGE_KEY_BYTES,
      `Qortal private-group key ${version}`,
    )
    const nonce = entry.nonce === undefined
      ? undefined
      : requireBytes(
          decodeCanonicalBase64(entry.nonce, `Qortal private-group legacy nonce ${version}`, NONCE_BYTES),
          NONCE_BYTES,
          `Qortal private-group legacy nonce ${version}`,
        )
    ring.set(version, { messageKey, ...(nonce ? { nonce } : {}) })
  }
  sortedRingEntries(ring)
  return ring
}

export function serializeQortalPrivateGroupKeyRing(keyRing: QortalPrivateGroupKeyRing) {
  const value: Record<string, { messageKey: string; nonce?: string }> = {}
  for (const [version, entry] of sortedRingEntries(keyRing)) {
    value[String(version)] = {
      messageKey: encodeBase64(entry.messageKey),
      ...(entry.nonce ? { nonce: encodeBase64(entry.nonce) } : {}),
    }
  }
  return new TextEncoder().encode(JSON.stringify(value))
}

export function appendQortalPrivateGroupKey(
  keyRing: QortalPrivateGroupKeyRing | null,
  messageKey: Uint8Array,
) {
  requireBytes(messageKey, MESSAGE_KEY_BYTES, 'New Qortal private-group message key')
  const next = new Map<number, QortalPrivateGroupKeyEntry>(keyRing ?? [])
  const highest = next.size ? Math.max(...next.keys()) : 0
  const version = requireKeyVersion(highest + 1)
  next.set(version, { messageKey: new Uint8Array(messageKey) })
  sortedRingEntries(next)
  return { keyRing: next as QortalPrivateGroupKeyRing, version }
}

export function encryptQortalPrivateGroupBundle(input: {
  readonly bundleKey?: Uint8Array
  readonly bundleNonce?: Uint8Array
  readonly keyNonce?: Uint8Array
  readonly keyRing: QortalPrivateGroupKeyRing
  readonly memberPublicKeys: readonly Uint8Array[]
  readonly selectedAccountSecretKey: Uint8Array
  readonly senderPublicKey: Uint8Array
}) {
  const signingKey = getSigningKey(input.selectedAccountSecretKey)
  requireBytes(input.senderPublicKey, PUBLIC_KEY_BYTES, 'Qortal private-group sender public key')
  if (!equalBytes(signingKey.publicKey, input.senderPublicKey)) throw new Error('Selected account does not match the bundle sender.')
  const recipients = uniquePublicKeys(input.memberPublicKeys, input.senderPublicKey)
  const plaintext = serializeQortalPrivateGroupKeyRing(input.keyRing)
  const bundleKey = input.bundleKey ?? globalThis.crypto.getRandomValues(new Uint8Array(MESSAGE_KEY_BYTES))
  const bundleNonce = input.bundleNonce ?? globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const keyNonce = input.keyNonce ?? globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  requireBytes(bundleKey, MESSAGE_KEY_BYTES, 'Qortal private-group bundle key')
  requireBytes(bundleNonce, NONCE_BYTES, 'Qortal private-group bundle nonce')
  requireBytes(keyNonce, NONCE_BYTES, 'Qortal private-group wrapping nonce')
  const encryptedData = nacl.secretbox(plaintext, bundleNonce, bundleKey)
  const wrappers: Uint8Array[] = []
  try {
    for (const recipientPublicKey of recipients) {
      const sharedSecret = deriveDirectChatSharedSecret(input.selectedAccountSecretKey, recipientPublicKey)
      try {
        wrappers.push(nacl.secretbox(bundleKey, keyNonce, sharedSecret))
      } finally {
        sharedSecret.fill(0)
      }
    }
    const envelope = concatBytes(
      QORTAL_PRIVATE_GROUP_BUNDLE_MARKER,
      bundleNonce,
      keyNonce,
      input.senderPublicKey,
      encryptedData,
      ...wrappers,
      uint32LittleEndian(recipients.length),
    )
    if (envelope.length > QORTAL_PRIVATE_GROUP_MAX_BUNDLE_BYTES) {
      throw new Error('Qortal private-group key bundle exceeds Home\'s size limit.')
    }
    return encodeBase64(envelope)
  } finally {
    plaintext.fill(0)
    if (!input.bundleKey) bundleKey.fill(0)
  }
}

export function decryptQortalPrivateGroupBundle(input: {
  readonly encryptedBundle: string
  readonly selectedAccountSecretKey: Uint8Array
}) {
  const envelope = decodeCanonicalBase64(
    input.encryptedBundle,
    'Qortal private-group key bundle',
    QORTAL_PRIVATE_GROUP_MAX_BUNDLE_BYTES,
  )
  const headerBytes = QORTAL_PRIVATE_GROUP_BUNDLE_MARKER.length + NONCE_BYTES + NONCE_BYTES + PUBLIC_KEY_BYTES
  if (envelope.length < headerBytes + nacl.secretbox.overheadLength + WRAPPED_KEY_BYTES + 4) {
    throw new Error('Qortal private-group key bundle is truncated.')
  }
  if (!equalBytes(envelope.subarray(0, QORTAL_PRIVATE_GROUP_BUNDLE_MARKER.length), QORTAL_PRIVATE_GROUP_BUNDLE_MARKER)) {
    throw new Error('Qortal private-group key bundle marker is invalid.')
  }
  const count = new DataView(envelope.buffer, envelope.byteOffset + envelope.length - 4, 4).getUint32(0, true)
  if (count < 1 || count > QORTAL_PRIVATE_GROUP_MAX_MEMBERS) throw new Error('Qortal private-group recipient count is invalid.')
  const wrappersLength = count * WRAPPED_KEY_BYTES
  const encryptedDataEnd = envelope.length - 4 - wrappersLength
  if (encryptedDataEnd < headerBytes + nacl.secretbox.overheadLength) {
    throw new Error('Qortal private-group recipient wrappers exceed the bundle length.')
  }
  const bundleNonce = envelope.subarray(QORTAL_PRIVATE_GROUP_BUNDLE_MARKER.length, QORTAL_PRIVATE_GROUP_BUNDLE_MARKER.length + NONCE_BYTES)
  const keyNonce = envelope.subarray(QORTAL_PRIVATE_GROUP_BUNDLE_MARKER.length + NONCE_BYTES, QORTAL_PRIVATE_GROUP_BUNDLE_MARKER.length + NONCE_BYTES * 2)
  const senderPublicKey = envelope.subarray(QORTAL_PRIVATE_GROUP_BUNDLE_MARKER.length + NONCE_BYTES * 2, headerBytes)
  const encryptedData = envelope.subarray(headerBytes, encryptedDataEnd)
  const wrappers = envelope.subarray(encryptedDataEnd, envelope.length - 4)
  const sharedSecret = deriveDirectChatSharedSecret(input.selectedAccountSecretKey, senderPublicKey)
  try {
    for (let index = 0; index < count; index += 1) {
      const wrapper = wrappers.subarray(index * WRAPPED_KEY_BYTES, (index + 1) * WRAPPED_KEY_BYTES)
      const bundleKey = nacl.secretbox.open(wrapper, keyNonce, sharedSecret)
      if (!bundleKey) continue
      try {
        const plaintext = nacl.secretbox.open(encryptedData, bundleNonce, bundleKey)
        if (!plaintext) continue
        try {
          if (plaintext.length > QORTAL_PRIVATE_GROUP_MAX_BUNDLE_BYTES) throw new Error('Decrypted Qortal private-group key ring is oversized.')
          let parsed: unknown
          try {
            parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext))
          } catch {
            throw new Error('Decrypted Qortal private-group key ring is not valid UTF-8 JSON.')
          }
          return {
            keyRing: parseQortalPrivateGroupKeyRing(parsed),
            recipientCount: count,
            senderPublicKey: new Uint8Array(senderPublicKey),
          }
        } finally {
          plaintext.fill(0)
        }
      } finally {
        bundleKey.fill(0)
      }
    }
  } finally {
    sharedSecret.fill(0)
  }
  throw new Error('Qortal private-group key bundle is not decryptable by the selected account.')
}

function highestKeyEntry(keyRing: QortalPrivateGroupKeyRing) {
  const entries = sortedRingEntries(keyRing)
  return entries[entries.length - 1]
}

export function encryptQortalPrivateGroupPayload(input: {
  readonly keyRing: QortalPrivateGroupKeyRing
  readonly nonce?: Uint8Array
  readonly plaintext: Uint8Array
  readonly typeNumber?: number
}) {
  if (input.plaintext.length < 1 || input.plaintext.length > QORTAL_PRIVATE_GROUP_MAX_PLAINTEXT_BYTES) {
    throw new Error(`Qortal private-group plaintext must be 1 to ${QORTAL_PRIVATE_GROUP_MAX_PLAINTEXT_BYTES} bytes.`)
  }
  const [version, entry] = highestKeyEntry(input.keyRing)
  const typeNumber = requireTypeNumber(input.typeNumber ?? 2)
  if (entry.nonce) {
    const encrypted = nacl.secretbox(input.plaintext, entry.nonce, entry.messageKey)
    const result = encodeBase64(new TextEncoder().encode(
      String(version).padStart(KEY_VERSION_DIGITS, '0') + encodeBase64(encrypted),
    ))
    if (new TextEncoder().encode(result).length > QORTAL_PRIVATE_GROUP_MAX_CHAT_DATA_BYTES) {
      throw new Error('Encrypted Qortal private-group message exceeds the CHAT data limit.')
    }
    return result
  }
  const nonce = input.nonce ?? globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  requireBytes(nonce, NONCE_BYTES, 'Qortal private-group message nonce')
  const encrypted = nacl.secretbox(input.plaintext, nonce, entry.messageKey)
  const result = encodeBase64(concatBytes(
    new TextEncoder().encode(String(version).padStart(KEY_VERSION_DIGITS, '0')),
    new TextEncoder().encode(String(typeNumber).padStart(TYPE_DIGITS, '0')),
    nonce,
    encrypted,
  ))
  if (new TextEncoder().encode(result).length > QORTAL_PRIVATE_GROUP_MAX_CHAT_DATA_BYTES) {
    throw new Error('Encrypted Qortal private-group message exceeds the CHAT data limit.')
  }
  return result
}

export function decryptQortalPrivateGroupPayload(input: {
  readonly ciphertext: string
  readonly keyRing: QortalPrivateGroupKeyRing
}) {
  const decoded = decodeCanonicalBase64(input.ciphertext, 'Qortal private-group message', 8 * 1024)
  if (decoded.length < KEY_VERSION_DIGITS + nacl.secretbox.overheadLength) {
    throw new Error('Qortal private-group message is truncated.')
  }
  const keyVersion = requireKeyVersion(parseAsciiDigits(decoded, 0, KEY_VERSION_DIGITS, 'Qortal private-group key version'))
  const entry = input.keyRing.get(keyVersion)
  if (!entry) throw new Error(`Qortal private-group key version ${keyVersion} is unavailable.`)
  let nonce: Uint8Array
  let encrypted: Uint8Array
  let typeNumber: number | null = null
  if (entry.nonce) {
    nonce = entry.nonce
    const encoded = new TextDecoder('utf-8', { fatal: true }).decode(decoded.subarray(KEY_VERSION_DIGITS))
    encrypted = decodeCanonicalBase64(encoded, 'Legacy Qortal private-group ciphertext', 8 * 1024)
  } else {
    const hasType = decoded.length >= KEY_VERSION_DIGITS + TYPE_DIGITS && decoded.subarray(10, 13).every((byte) => byte >= 48 && byte <= 57)
    if (hasType) {
      typeNumber = requireTypeNumber(parseAsciiDigits(decoded, KEY_VERSION_DIGITS, TYPE_DIGITS, 'Qortal private-group payload type'))
      if (typeNumber === 1) {
        const legacy = new TextDecoder('utf-8', { fatal: true }).decode(decoded)
        nonce = decodeCanonicalBase64(legacy.slice(13, 45), 'Legacy Qortal private-group nonce', NONCE_BYTES)
        encrypted = decodeCanonicalBase64(legacy.slice(45), 'Legacy Qortal private-group ciphertext', 8 * 1024)
      } else {
        if (decoded.length < KEY_VERSION_DIGITS + TYPE_DIGITS + NONCE_BYTES + nacl.secretbox.overheadLength) {
          throw new Error('Qortal private-group message is truncated.')
        }
        nonce = decoded.subarray(13, 37)
        encrypted = decoded.subarray(37)
      }
    } else {
      const legacy = new TextDecoder('utf-8', { fatal: true }).decode(decoded)
      nonce = decodeCanonicalBase64(legacy.slice(10, 42), 'Legacy Qortal private-group nonce', NONCE_BYTES)
      encrypted = decodeCanonicalBase64(legacy.slice(42), 'Legacy Qortal private-group ciphertext', 8 * 1024)
    }
  }
  if (encrypted.length < nacl.secretbox.overheadLength) throw new Error('Qortal private-group ciphertext is truncated.')
  const plaintext = nacl.secretbox.open(encrypted, nonce, entry.messageKey)
  if (!plaintext) throw new Error('Qortal private-group message authentication failed.')
  if (plaintext.length < 1 || plaintext.length > QORTAL_PRIVATE_GROUP_MAX_PLAINTEXT_BYTES) {
    throw new Error('Qortal private-group plaintext length is invalid.')
  }
  return { keyVersion, plaintext, typeNumber }
}

function getWebCrypto() {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable.')
  return globalThis.crypto
}

function cryptoBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value)
}

function uint32BigEndian(value: number) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, requireGroupId(value), false)
  return bytes
}

async function hmacSha256(key: Uint8Array, value: Uint8Array) {
  const cryptoKey = await getWebCrypto().subtle.importKey(
    'raw',
    cryptoBytes(key),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  return new Uint8Array(await getWebCrypto().subtle.sign('HMAC', cryptoKey, cryptoBytes(value)))
}

function keyRingAssociatedData(input: {
  readonly accountPublicKey: Uint8Array
  readonly groupId: number
  readonly publisherName: string
  readonly recipientCount: number
  readonly resourceSignature: string
}) {
  if (!/^[^\u0000-\u001f]{1,128}$/.test(input.publisherName)) throw new Error('Qortal private-group publisher name is invalid.')
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,128}$/.test(input.resourceSignature)) throw new Error('Qortal private-group resource signature is invalid.')
  return concatBytes(
    STORAGE_DOMAIN,
    requireBytes(input.accountPublicKey, PUBLIC_KEY_BYTES, 'Stored Qortal account public key'),
    uint32BigEndian(input.groupId),
    uint32BigEndian(requireRecipientCount(input.recipientCount)),
    new TextEncoder().encode(input.publisherName),
    new Uint8Array([0]),
    new TextEncoder().encode(input.resourceSignature),
  )
}

async function deriveStorageKey(secretKeyValue: Uint8Array, associatedData: Uint8Array) {
  const seed = secretKeyValue.length === nacl.sign.seedLength
    ? secretKeyValue
    : secretKeyValue.length === nacl.sign.secretKeyLength
      ? secretKeyValue.subarray(0, nacl.sign.seedLength)
      : null
  if (!seed) throw new Error('Selected-account secret key must be a 32-byte seed or 64-byte Ed25519 key.')
  const pseudorandomKey = await hmacSha256(STORAGE_SALT, seed)
  try {
    return await hmacSha256(pseudorandomKey, concatBytes(associatedData, new Uint8Array([1])))
  } finally {
    pseudorandomKey.fill(0)
  }
}

async function aesGcm(
  mode: 'decrypt' | 'encrypt',
  keyBytes: Uint8Array,
  nonce: Uint8Array,
  associatedData: Uint8Array,
  value: Uint8Array,
) {
  const key = await getWebCrypto().subtle.importKey('raw', cryptoBytes(keyBytes), 'AES-GCM', false, [mode])
  try {
    const output = await getWebCrypto().subtle[mode](
      { additionalData: cryptoBytes(associatedData), iv: cryptoBytes(nonce), name: 'AES-GCM', tagLength: 128 },
      key,
      cryptoBytes(value),
    )
    return new Uint8Array(output)
  } catch {
    throw new Error('Stored Qortal private-group key ring authentication failed.')
  }
}

export async function encryptQortalPrivateGroupStoredKeyRing(input: {
  readonly groupId: number
  readonly keyRing: QortalPrivateGroupKeyRing
  readonly nonce?: Uint8Array
  readonly publisherName: string
  readonly recipientCount: number
  readonly resourceSignature: string
  readonly selectedAccountSecretKey: Uint8Array
}): Promise<EncryptedQortalPrivateGroupKeyRing> {
  const signingKey = getSigningKey(input.selectedAccountSecretKey)
  const associatedData = keyRingAssociatedData({
    accountPublicKey: signingKey.publicKey,
    groupId: input.groupId,
    publisherName: input.publisherName,
    recipientCount: input.recipientCount,
    resourceSignature: input.resourceSignature,
  })
  const storageKey = await deriveStorageKey(input.selectedAccountSecretKey, associatedData)
  const nonce = input.nonce ?? getWebCrypto().getRandomValues(new Uint8Array(STORAGE_NONCE_BYTES))
  const plaintext = serializeQortalPrivateGroupKeyRing(input.keyRing)
  try {
    return {
      accountPublicKey: encodeBase64(signingKey.publicKey),
      ciphertext: encodeBase64(await aesGcm('encrypt', storageKey, nonce, associatedData, plaintext)),
      groupId: requireGroupId(input.groupId),
      network: 'qortal',
      nonce: encodeBase64(requireBytes(nonce, STORAGE_NONCE_BYTES, 'Qortal key-store nonce')),
      publisherName: input.publisherName,
      recipientCount: requireRecipientCount(input.recipientCount),
      resourceSignature: input.resourceSignature,
      version: 1,
    }
  } finally {
    plaintext.fill(0)
    storageKey.fill(0)
  }
}

export async function decryptQortalPrivateGroupStoredKeyRing(input: {
  readonly record: EncryptedQortalPrivateGroupKeyRing
  readonly selectedAccountSecretKey: Uint8Array
}) {
  const record = input.record
  if (!record || record.version !== 1 || record.network !== 'qortal') throw new Error('Stored Qortal private-group record is invalid.')
  const signingKey = getSigningKey(input.selectedAccountSecretKey)
  const accountPublicKey = requireBytes(
    decodeCanonicalBase64(record.accountPublicKey, 'Stored Qortal account public key', PUBLIC_KEY_BYTES),
    PUBLIC_KEY_BYTES,
    'Stored Qortal account public key',
  )
  if (!equalBytes(accountPublicKey, signingKey.publicKey)) throw new Error('Stored Qortal private-group record belongs to another account.')
  const associatedData = keyRingAssociatedData({
    accountPublicKey,
    groupId: record.groupId,
    publisherName: record.publisherName,
    recipientCount: record.recipientCount,
    resourceSignature: record.resourceSignature,
  })
  const storageKey = await deriveStorageKey(input.selectedAccountSecretKey, associatedData)
  let plaintext: Uint8Array | null = null
  try {
    plaintext = await aesGcm(
      'decrypt',
      storageKey,
      requireBytes(decodeCanonicalBase64(record.nonce, 'Stored Qortal key-ring nonce', STORAGE_NONCE_BYTES), STORAGE_NONCE_BYTES, 'Stored Qortal key-ring nonce'),
      associatedData,
      decodeCanonicalBase64(record.ciphertext, 'Stored Qortal key-ring ciphertext', QORTAL_PRIVATE_GROUP_MAX_BUNDLE_BYTES),
    )
    try {
      return parseQortalPrivateGroupKeyRing(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)))
    } catch (error) {
      if (error instanceof Error && /Qortal private-group/.test(error.message)) throw error
      throw new Error('Stored Qortal private-group key ring is invalid.')
    }
  } finally {
    plaintext?.fill(0)
    storageKey.fill(0)
  }
}
