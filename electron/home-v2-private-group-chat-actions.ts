import ed2curve from 'ed2curve'
import nacl from 'tweetnacl'

export const QPGC_MAX_MEMBERS = 39
export const QPGC_MAX_MESSAGE_PLAINTEXT_BYTES = 3_894
export const QPGC_WRAPPED_GROUP_KEY_LENGTH = 60

const QPGC_MAGIC = new TextEncoder().encode('QPGC')
const QPGC_VERSION = 1
const QPGC_KEY_ID_DOMAIN = new TextEncoder().encode('QPGC key id v1')
const QPGC_MESSAGE_AAD_DOMAIN = new TextEncoder().encode('QPGC message v1')
const QPGC_KEY_WRAP_AAD_DOMAIN = new TextEncoder().encode('QPGC key wrap v1')
const QPGC_KEY_WRAP_SALT = new TextEncoder().encode('QPGC key wrap hkdf salt v1')
const QPGC_ANNOUNCEMENT_DOMAIN = new TextEncoder().encode('QPGC key announcement v1')
const QPGC_KEY_REQUEST_DOMAIN = new TextEncoder().encode('QPGC key request v1')
const QPGC_ROTATION_REQUEST_DOMAIN = new TextEncoder().encode('QPGC rotation request v1')
const QPGC_EPOCH_DOMAIN = new TextEncoder().encode('QPGC epoch v1')
const QPGC_KEY_STORE_DOMAIN = new TextEncoder().encode('Home v2 QPGC key store v1')
const QPGC_KEY_STORE_SALT = new TextEncoder().encode('Home v2 QPGC key store salt v1')

const PUBLIC_KEY_LENGTH = 32
const EPOCH_ID_LENGTH = 32
const KEY_ID_LENGTH = 32
const GROUP_KEY_LENGTH = 32
const NONCE_LENGTH = 12
const SIGNATURE_LENGTH = 64

export type QpgcEnvelope =
  | {
      readonly ciphertext: Uint8Array
      readonly epochId: Uint8Array
      readonly groupId: number
      readonly keyId: Uint8Array
      readonly nonce: Uint8Array
      readonly type: 'MESSAGE'
    }
  | {
      readonly creatorPublicKey: Uint8Array
      readonly epochId: Uint8Array
      readonly groupId: number
      readonly keyId: Uint8Array
      readonly signature: Uint8Array
      readonly type: 'KEY_ANNOUNCEMENT'
      readonly wrappers: readonly QpgcKeyWrapper[]
    }
  | {
      readonly epochId: Uint8Array
      readonly groupId: number
      readonly keyId: Uint8Array | null
      readonly requesterPublicKey: Uint8Array
      readonly signature: Uint8Array
      readonly type: 'KEY_REQUEST'
    }
  | {
      readonly epochId: Uint8Array
      readonly groupId: number
      readonly requesterPublicKey: Uint8Array
      readonly signature: Uint8Array
      readonly type: 'ROTATION_REQUEST'
    }

export type QpgcKeyWrapper = {
  readonly recipientPublicKey: Uint8Array
  readonly wrappedKey: Uint8Array
}

export type EncryptedQpgcStoredKey = {
  readonly accountPublicKey: string
  readonly ciphertext: string
  readonly epochId: string
  readonly groupId: number
  readonly keyId: string
  readonly network: 'qortium'
  readonly nonce: string
  readonly version: 1
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

function uint32Bytes(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error('QPGC integer is outside the unsigned 32-bit range.')
  }
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function requireBytes(value: Uint8Array, length: number, label: string) {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new Error(`${label} must be ${length} bytes.`)
  }
  return value
}

function requireGroupId(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 0x7fff_ffff) {
    throw new Error('QPGC groupId must be a positive signed 32-bit integer.')
  }
  return value
}

function compareBytes(left: Uint8Array, right: Uint8Array) {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference = left[index] - right[index]
    if (difference) return difference
  }
  return left.length - right.length
}

function sortedPublicKeys(memberPublicKeys: readonly Uint8Array[]) {
  if (memberPublicKeys.length < 1 || memberPublicKeys.length > QPGC_MAX_MEMBERS) {
    throw new Error(`QPGC v1 requires between 1 and ${QPGC_MAX_MEMBERS} member public keys.`)
  }
  const seen = new Set<string>()
  const result = memberPublicKeys.map((publicKey) => {
    const copy = new Uint8Array(requireBytes(publicKey, PUBLIC_KEY_LENGTH, 'Member public key'))
    const key = bytesToHex(copy)
    if (/^0+$/.test(key)) throw new Error('Member public key must not be all zeroes.')
    if (seen.has(key)) throw new Error('QPGC member public keys must be unique.')
    seen.add(key)
    return copy
  })
  result.sort(compareBytes)
  return result
}

function getSigningKey(value: Uint8Array) {
  if (value.length === nacl.sign.seedLength) return nacl.sign.keyPair.fromSeed(value)
  if (value.length === nacl.sign.secretKeyLength) {
    return { publicKey: value.subarray(32, 64), secretKey: value }
  }
  throw new Error('Selected-account secret key must be a 32-byte seed or 64-byte Ed25519 key.')
}

function getRawSharedSecret(secretKeyValue: Uint8Array, peerPublicKey: Uint8Array) {
  requireBytes(peerPublicKey, PUBLIC_KEY_LENGTH, 'Peer public key')
  const signingKey = getSigningKey(secretKeyValue)
  const curveSecretKey = ed2curve.convertSecretKey(signingKey.secretKey)
  const curvePublicKey = ed2curve.convertPublicKey(peerPublicKey)
  if (!curvePublicKey) {
    curveSecretKey.fill(0)
    throw new Error('Peer public key cannot be converted for QPGC key wrapping.')
  }
  try {
    return nacl.scalarMult(curveSecretKey, curvePublicKey)
  } finally {
    curveSecretKey.fill(0)
  }
}

function getWebCrypto() {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable.')
  return globalThis.crypto
}

function cryptoBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value)
}

async function sha256(value: Uint8Array) {
  return new Uint8Array(await getWebCrypto().subtle.digest('SHA-256', cryptoBytes(value)))
}

async function hmacSha256(keyBytes: Uint8Array, value: Uint8Array) {
  const key = await getWebCrypto().subtle.importKey(
    'raw',
    cryptoBytes(keyBytes),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  return new Uint8Array(await getWebCrypto().subtle.sign('HMAC', key, cryptoBytes(value)))
}

async function aesGcm(
  operation: 'decrypt' | 'encrypt',
  keyBytes: Uint8Array,
  nonce: Uint8Array,
  associatedData: Uint8Array,
  value: Uint8Array,
) {
  requireBytes(keyBytes, GROUP_KEY_LENGTH, 'AES-256 key')
  requireBytes(nonce, NONCE_LENGTH, 'QPGC nonce')
  const key = await getWebCrypto().subtle.importKey('raw', cryptoBytes(keyBytes), 'AES-GCM', false, [operation])
  try {
    return new Uint8Array(await getWebCrypto().subtle[operation](
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
    throw new Error('QPGC message or key-wrapper authentication failed.')
  }
}

function qpgcMessageAssociatedData(groupId: number, epochId: Uint8Array, keyId: Uint8Array) {
  return concatBytes(
    QPGC_MESSAGE_AAD_DOMAIN,
    uint32Bytes(requireGroupId(groupId)),
    requireBytes(epochId, EPOCH_ID_LENGTH, 'QPGC epochId'),
    requireBytes(keyId, KEY_ID_LENGTH, 'QPGC keyId'),
  )
}

function qpgcKeyWrapAssociatedData(
  groupId: number,
  epochId: Uint8Array,
  keyId: Uint8Array,
  announcerPublicKey: Uint8Array,
  recipientPublicKey: Uint8Array,
) {
  return concatBytes(
    QPGC_KEY_WRAP_AAD_DOMAIN,
    uint32Bytes(requireGroupId(groupId)),
    requireBytes(epochId, EPOCH_ID_LENGTH, 'QPGC epochId'),
    requireBytes(keyId, KEY_ID_LENGTH, 'QPGC keyId'),
    requireBytes(announcerPublicKey, PUBLIC_KEY_LENGTH, 'Announcer public key'),
    requireBytes(recipientPublicKey, PUBLIC_KEY_LENGTH, 'Recipient public key'),
  )
}

export async function computeQpgcEpochId(groupId: number, memberPublicKeys: readonly Uint8Array[]) {
  const members = sortedPublicKeys(memberPublicKeys)
  return sha256(concatBytes(
    QPGC_EPOCH_DOMAIN,
    uint32Bytes(requireGroupId(groupId)),
    uint32Bytes(members.length),
    ...members,
  ))
}

export async function computeQpgcKeyId(groupId: number, epochId: Uint8Array, groupKey: Uint8Array) {
  return sha256(concatBytes(
    QPGC_KEY_ID_DOMAIN,
    uint32Bytes(requireGroupId(groupId)),
    requireBytes(epochId, EPOCH_ID_LENGTH, 'QPGC epochId'),
    requireBytes(groupKey, GROUP_KEY_LENGTH, 'QPGC group key'),
  ))
}

export async function deriveQpgcWrappingKey(sharedSecret: Uint8Array, associatedData: Uint8Array) {
  requireBytes(sharedSecret, 32, 'QPGC shared secret')
  const pseudorandomKey = await hmacSha256(QPGC_KEY_WRAP_SALT, sharedSecret)
  try {
    return await hmacSha256(pseudorandomKey, concatBytes(associatedData, new Uint8Array([1])))
  } finally {
    pseudorandomKey.fill(0)
  }
}

export async function wrapQpgcGroupKey(input: {
  readonly announcerSecretKey: Uint8Array
  readonly epochId: Uint8Array
  readonly groupId: number
  readonly groupKey: Uint8Array
  readonly keyId: Uint8Array
  readonly nonce: Uint8Array
  readonly recipientPublicKey: Uint8Array
}) {
  requireBytes(input.groupKey, GROUP_KEY_LENGTH, 'QPGC group key')
  requireBytes(input.nonce, NONCE_LENGTH, 'QPGC wrapper nonce')
  const signingKey = getSigningKey(input.announcerSecretKey)
  const associatedData = qpgcKeyWrapAssociatedData(
    input.groupId,
    input.epochId,
    input.keyId,
    signingKey.publicKey,
    input.recipientPublicKey,
  )
  const sharedSecret = getRawSharedSecret(input.announcerSecretKey, input.recipientPublicKey)
  try {
    const wrappingKey = await deriveQpgcWrappingKey(sharedSecret, associatedData)
    try {
      return concatBytes(
        input.nonce,
        await aesGcm('encrypt', wrappingKey, input.nonce, associatedData, input.groupKey),
      )
    } finally {
      wrappingKey.fill(0)
    }
  } finally {
    sharedSecret.fill(0)
  }
}

export async function unwrapQpgcGroupKey(input: {
  readonly announcerPublicKey: Uint8Array
  readonly epochId: Uint8Array
  readonly groupId: number
  readonly keyId: Uint8Array
  readonly recipientSecretKey: Uint8Array
  readonly wrappedKey: Uint8Array
}) {
  requireBytes(input.wrappedKey, QPGC_WRAPPED_GROUP_KEY_LENGTH, 'QPGC wrapped group key')
  const recipient = getSigningKey(input.recipientSecretKey)
  const associatedData = qpgcKeyWrapAssociatedData(
    input.groupId,
    input.epochId,
    input.keyId,
    input.announcerPublicKey,
    recipient.publicKey,
  )
  const sharedSecret = getRawSharedSecret(input.recipientSecretKey, input.announcerPublicKey)
  try {
    const wrappingKey = await deriveQpgcWrappingKey(sharedSecret, associatedData)
    try {
      const groupKey = await aesGcm(
        'decrypt',
        wrappingKey,
        input.wrappedKey.subarray(0, NONCE_LENGTH),
        associatedData,
        input.wrappedKey.subarray(NONCE_LENGTH),
      )
      if (!equalBytes(await computeQpgcKeyId(input.groupId, input.epochId, groupKey), input.keyId)) {
        groupKey.fill(0)
        throw new Error('Unwrapped QPGC group key does not match its keyId.')
      }
      return groupKey
    } finally {
      wrappingKey.fill(0)
    }
  } finally {
    sharedSecret.fill(0)
  }
}

export async function encryptQpgcMessage(input: {
  readonly epochId: Uint8Array
  readonly groupId: number
  readonly groupKey: Uint8Array
  readonly keyId: Uint8Array
  readonly nonce: Uint8Array
  readonly plaintext: Uint8Array
}) {
  if (input.plaintext.length < 1 || input.plaintext.length > QPGC_MAX_MESSAGE_PLAINTEXT_BYTES) {
    throw new Error(`QPGC plaintext must be between 1 and ${QPGC_MAX_MESSAGE_PLAINTEXT_BYTES} bytes.`)
  }
  const ciphertext = await aesGcm(
    'encrypt',
    input.groupKey,
    input.nonce,
    qpgcMessageAssociatedData(input.groupId, input.epochId, input.keyId),
    input.plaintext,
  )
  return serializeQpgcEnvelope({
    ciphertext,
    epochId: input.epochId,
    groupId: input.groupId,
    keyId: input.keyId,
    nonce: input.nonce,
    type: 'MESSAGE',
  })
}

export async function decryptQpgcMessage(input: {
  readonly envelope: Uint8Array | QpgcEnvelope
  readonly groupKey: Uint8Array
}) {
  const envelope = input.envelope instanceof Uint8Array ? parseQpgcEnvelope(input.envelope) : input.envelope
  if (envelope.type !== 'MESSAGE') throw new Error('QPGC envelope is not a private-group message.')
  return aesGcm(
    'decrypt',
    input.groupKey,
    envelope.nonce,
    qpgcMessageAssociatedData(envelope.groupId, envelope.epochId, envelope.keyId),
    envelope.ciphertext,
  )
}

function sortedWrappers(wrappers: readonly QpgcKeyWrapper[]) {
  const seen = new Set<string>()
  const result = wrappers.map((wrapper) => {
    const recipientPublicKey = new Uint8Array(requireBytes(
      wrapper.recipientPublicKey,
      PUBLIC_KEY_LENGTH,
      'QPGC wrapper recipient public key',
    ))
    const key = bytesToHex(recipientPublicKey)
    if (seen.has(key)) throw new Error('QPGC announcement has duplicate wrapper recipients.')
    seen.add(key)
    return {
      recipientPublicKey,
      wrappedKey: new Uint8Array(requireBytes(
        wrapper.wrappedKey,
        QPGC_WRAPPED_GROUP_KEY_LENGTH,
        'QPGC wrapped group key',
      )),
    }
  })
  result.sort((left, right) => compareBytes(left.recipientPublicKey, right.recipientPublicKey))
  return result
}

function qpgcAnnouncementSigningBytes(input: {
  readonly creatorPublicKey: Uint8Array
  readonly epochId: Uint8Array
  readonly groupId: number
  readonly keyId: Uint8Array
  readonly wrappers: readonly QpgcKeyWrapper[]
}) {
  const wrappers = sortedWrappers(input.wrappers)
  return concatBytes(
    QPGC_ANNOUNCEMENT_DOMAIN,
    uint32Bytes(requireGroupId(input.groupId)),
    requireBytes(input.epochId, EPOCH_ID_LENGTH, 'QPGC epochId'),
    requireBytes(input.keyId, KEY_ID_LENGTH, 'QPGC keyId'),
    requireBytes(input.creatorPublicKey, PUBLIC_KEY_LENGTH, 'QPGC creator public key'),
    uint32Bytes(wrappers.length),
    ...wrappers.flatMap((wrapper) => [
      wrapper.recipientPublicKey,
      uint32Bytes(wrapper.wrappedKey.length),
      wrapper.wrappedKey,
    ]),
  )
}

export async function createQpgcKeyAnnouncement(input: {
  readonly announcerSecretKey: Uint8Array
  readonly epochId: Uint8Array
  readonly groupId: number
  readonly groupKey: Uint8Array
  readonly memberPublicKeys: readonly Uint8Array[]
  readonly wrapperNonces?: readonly Uint8Array[]
}) {
  const members = sortedPublicKeys(input.memberPublicKeys)
  if (input.wrapperNonces && input.wrapperNonces.length !== members.length) {
    throw new Error('QPGC wrapper nonce count must match the member count.')
  }
  const signingKey = getSigningKey(input.announcerSecretKey)
  if (!members.some((member) => equalBytes(member, signingKey.publicKey))) {
    throw new Error('QPGC key announcer is not a current group member.')
  }
  const keyId = await computeQpgcKeyId(input.groupId, input.epochId, input.groupKey)
  const wrappers: QpgcKeyWrapper[] = []
  for (let index = 0; index < members.length; index += 1) {
    wrappers.push({
      recipientPublicKey: members[index],
      wrappedKey: await wrapQpgcGroupKey({
        announcerSecretKey: input.announcerSecretKey,
        epochId: input.epochId,
        groupId: input.groupId,
        groupKey: input.groupKey,
        keyId,
        nonce: input.wrapperNonces?.[index] ?? getWebCrypto().getRandomValues(new Uint8Array(NONCE_LENGTH)),
        recipientPublicKey: members[index],
      }),
    })
  }
  const sorted = sortedWrappers(wrappers)
  const signature = nacl.sign.detached(qpgcAnnouncementSigningBytes({
    creatorPublicKey: signingKey.publicKey,
    epochId: input.epochId,
    groupId: input.groupId,
    keyId,
    wrappers: sorted,
  }), signingKey.secretKey)
  return serializeQpgcEnvelope({
    creatorPublicKey: signingKey.publicKey,
    epochId: input.epochId,
    groupId: input.groupId,
    keyId,
    signature,
    type: 'KEY_ANNOUNCEMENT',
    wrappers: sorted,
  })
}

export function createQpgcKeyRequest(input: {
  readonly epochId: Uint8Array
  readonly groupId: number
  readonly keyId?: Uint8Array | null
  readonly requesterSecretKey: Uint8Array
}) {
  const signingKey = getSigningKey(input.requesterSecretKey)
  const keyId = input.keyId ?? null
  if (keyId) requireBytes(keyId, KEY_ID_LENGTH, 'Requested QPGC keyId')
  const signingBytes = concatBytes(
    QPGC_KEY_REQUEST_DOMAIN,
    uint32Bytes(requireGroupId(input.groupId)),
    requireBytes(input.epochId, EPOCH_ID_LENGTH, 'QPGC epochId'),
    signingKey.publicKey,
    new Uint8Array([keyId ? 1 : 0]),
    ...(keyId ? [keyId] : []),
  )
  return serializeQpgcEnvelope({
    epochId: input.epochId,
    groupId: input.groupId,
    keyId,
    requesterPublicKey: signingKey.publicKey,
    signature: nacl.sign.detached(signingBytes, signingKey.secretKey),
    type: 'KEY_REQUEST',
  })
}

export function createQpgcRotationRequest(input: {
  readonly epochId: Uint8Array
  readonly groupId: number
  readonly requesterSecretKey: Uint8Array
}) {
  const signingKey = getSigningKey(input.requesterSecretKey)
  const signingBytes = concatBytes(
    QPGC_ROTATION_REQUEST_DOMAIN,
    uint32Bytes(requireGroupId(input.groupId)),
    requireBytes(input.epochId, EPOCH_ID_LENGTH, 'QPGC epochId'),
    signingKey.publicKey,
  )
  return serializeQpgcEnvelope({
    epochId: input.epochId,
    groupId: input.groupId,
    requesterPublicKey: signingKey.publicKey,
    signature: nacl.sign.detached(signingBytes, signingKey.secretKey),
    type: 'ROTATION_REQUEST',
  })
}

export function validateQpgcControlEnvelope(input: {
  readonly envelope: Uint8Array | QpgcEnvelope
  readonly memberPublicKeys?: readonly Uint8Array[]
}) {
  const envelope = input.envelope instanceof Uint8Array ? parseQpgcEnvelope(input.envelope) : input.envelope
  if (envelope.type === 'MESSAGE') throw new Error('QPGC envelope is not a control envelope.')
  const members = input.memberPublicKeys ? sortedPublicKeys(input.memberPublicKeys) : null
  if (members && !members.some((member) => equalBytes(
    member,
    envelope.type === 'KEY_ANNOUNCEMENT' ? envelope.creatorPublicKey : envelope.requesterPublicKey,
  ))) throw new Error('QPGC control creator is not a current group member.')
  let signingBytes: Uint8Array
  let publicKey: Uint8Array
  if (envelope.type === 'KEY_ANNOUNCEMENT') {
    const wrappers = sortedWrappers(envelope.wrappers)
    if (members) {
      if (wrappers.length !== members.length || wrappers.some((wrapper, index) => !equalBytes(
        wrapper.recipientPublicKey,
        members[index],
      ))) throw new Error('QPGC key announcement does not cover every current member exactly once.')
    }
    signingBytes = qpgcAnnouncementSigningBytes({ ...envelope, wrappers })
    publicKey = envelope.creatorPublicKey
  } else if (envelope.type === 'KEY_REQUEST') {
    signingBytes = concatBytes(
      QPGC_KEY_REQUEST_DOMAIN,
      uint32Bytes(envelope.groupId),
      envelope.epochId,
      envelope.requesterPublicKey,
      new Uint8Array([envelope.keyId ? 1 : 0]),
      ...(envelope.keyId ? [envelope.keyId] : []),
    )
    publicKey = envelope.requesterPublicKey
  } else {
    signingBytes = concatBytes(
      QPGC_ROTATION_REQUEST_DOMAIN,
      uint32Bytes(envelope.groupId),
      envelope.epochId,
      envelope.requesterPublicKey,
    )
    publicKey = envelope.requesterPublicKey
  }
  if (!nacl.sign.detached.verify(signingBytes, envelope.signature, publicKey)) {
    throw new Error('QPGC control envelope signature is invalid.')
  }
  return envelope
}

export async function unwrapQpgcAnnouncementForRecipient(input: {
  readonly announcement: Uint8Array | QpgcEnvelope
  readonly memberPublicKeys?: readonly Uint8Array[]
  readonly recipientSecretKey: Uint8Array
}) {
  const envelope = validateQpgcControlEnvelope({
    envelope: input.announcement,
    memberPublicKeys: input.memberPublicKeys,
  })
  if (envelope.type !== 'KEY_ANNOUNCEMENT') throw new Error('QPGC envelope is not a key announcement.')
  const recipientPublicKey = getSigningKey(input.recipientSecretKey).publicKey
  const wrapper = envelope.wrappers.find((candidate) => equalBytes(candidate.recipientPublicKey, recipientPublicKey))
  if (!wrapper) throw new Error('QPGC key announcement does not include the selected account.')
  return unwrapQpgcGroupKey({
    announcerPublicKey: envelope.creatorPublicKey,
    epochId: envelope.epochId,
    groupId: envelope.groupId,
    keyId: envelope.keyId,
    recipientSecretKey: input.recipientSecretKey,
    wrappedKey: wrapper.wrappedKey,
  })
}

export function serializeQpgcEnvelope(envelope: QpgcEnvelope) {
  const common = [
    QPGC_MAGIC,
    new Uint8Array([QPGC_VERSION]),
    new Uint8Array([envelope.type === 'MESSAGE' ? 1 : envelope.type === 'KEY_ANNOUNCEMENT' ? 2 : envelope.type === 'KEY_REQUEST' ? 3 : 4]),
    uint32Bytes(requireGroupId(envelope.groupId)),
    requireBytes(envelope.epochId, EPOCH_ID_LENGTH, 'QPGC epochId'),
  ]
  if (envelope.type === 'MESSAGE') {
    if (envelope.ciphertext.length < 16 || envelope.ciphertext.length > QPGC_MAX_MESSAGE_PLAINTEXT_BYTES + 16) {
      throw new Error('QPGC ciphertext length is invalid.')
    }
    return concatBytes(
      ...common,
      requireBytes(envelope.keyId, KEY_ID_LENGTH, 'QPGC keyId'),
      requireBytes(envelope.nonce, NONCE_LENGTH, 'QPGC nonce'),
      uint32Bytes(envelope.ciphertext.length),
      envelope.ciphertext,
    )
  }
  if (envelope.type === 'KEY_ANNOUNCEMENT') {
    const wrappers = sortedWrappers(envelope.wrappers)
    if (wrappers.length < 1 || wrappers.length > QPGC_MAX_MEMBERS) {
      throw new Error('QPGC key announcement wrapper count is invalid.')
    }
    return concatBytes(
      ...common,
      requireBytes(envelope.keyId, KEY_ID_LENGTH, 'QPGC keyId'),
      requireBytes(envelope.creatorPublicKey, PUBLIC_KEY_LENGTH, 'QPGC creator public key'),
      uint32Bytes(wrappers.length),
      ...wrappers.flatMap((wrapper) => [
        wrapper.recipientPublicKey,
        uint32Bytes(wrapper.wrappedKey.length),
        wrapper.wrappedKey,
      ]),
      requireBytes(envelope.signature, SIGNATURE_LENGTH, 'QPGC signature'),
    )
  }
  if (envelope.type === 'KEY_REQUEST') {
    return concatBytes(
      ...common,
      requireBytes(envelope.requesterPublicKey, PUBLIC_KEY_LENGTH, 'QPGC requester public key'),
      new Uint8Array([envelope.keyId ? 1 : 0]),
      ...(envelope.keyId ? [requireBytes(envelope.keyId, KEY_ID_LENGTH, 'QPGC requested keyId')] : []),
      requireBytes(envelope.signature, SIGNATURE_LENGTH, 'QPGC signature'),
    )
  }
  return concatBytes(
    ...common,
    requireBytes(envelope.requesterPublicKey, PUBLIC_KEY_LENGTH, 'QPGC requester public key'),
    requireBytes(envelope.signature, SIGNATURE_LENGTH, 'QPGC signature'),
  )
}

export function parseQpgcEnvelope(bytes: Uint8Array): QpgcEnvelope {
  if (!(bytes instanceof Uint8Array) || bytes.length < 42 || bytes.length > 4_000) {
    throw new Error('QPGC envelope length is invalid.')
  }
  let offset = 0
  const take = (length: number, label: string) => {
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) {
      throw new Error(`QPGC envelope is missing or truncates ${label}.`)
    }
    const value = bytes.subarray(offset, offset + length)
    offset += length
    return value
  }
  const readUint32 = (label: string) => new DataView(
    take(4, label).buffer,
    bytes.byteOffset + offset - 4,
    4,
  ).getUint32(0, false)
  if (!equalBytes(take(4, 'magic'), QPGC_MAGIC)) throw new Error('QPGC envelope magic is invalid.')
  if (take(1, 'version')[0] !== QPGC_VERSION) throw new Error('QPGC envelope version is unsupported.')
  const type = take(1, 'type')[0]
  if (![1, 2, 3, 4].includes(type)) throw new Error('QPGC envelope type is unsupported.')
  const groupId = requireGroupId(readUint32('groupId'))
  const epochId = take(EPOCH_ID_LENGTH, 'epochId')
  let envelope: QpgcEnvelope
  if (type === 1) {
    const keyId = take(KEY_ID_LENGTH, 'keyId')
    const nonce = take(NONCE_LENGTH, 'nonce')
    const ciphertextLength = readUint32('ciphertext length')
    if (ciphertextLength < 16 || ciphertextLength > QPGC_MAX_MESSAGE_PLAINTEXT_BYTES + 16) {
      throw new Error('QPGC ciphertext length is invalid.')
    }
    envelope = { ciphertext: take(ciphertextLength, 'ciphertext'), epochId, groupId, keyId, nonce, type: 'MESSAGE' }
  } else if (type === 2) {
    const keyId = take(KEY_ID_LENGTH, 'keyId')
    const creatorPublicKey = take(PUBLIC_KEY_LENGTH, 'creator public key')
    const wrapperCount = readUint32('wrapper count')
    if (wrapperCount < 1 || wrapperCount > QPGC_MAX_MEMBERS) {
      throw new Error('QPGC key announcement wrapper count is invalid.')
    }
    const wrappers: QpgcKeyWrapper[] = []
    for (let index = 0; index < wrapperCount; index += 1) {
      const recipientPublicKey = take(PUBLIC_KEY_LENGTH, 'wrapper recipient public key')
      const wrappedKeyLength = readUint32('wrapped key length')
      if (wrappedKeyLength !== QPGC_WRAPPED_GROUP_KEY_LENGTH) {
        throw new Error('QPGC wrapped group key length is invalid.')
      }
      wrappers.push({ recipientPublicKey, wrappedKey: take(wrappedKeyLength, 'wrapped group key') })
    }
    envelope = {
      creatorPublicKey,
      epochId,
      groupId,
      keyId,
      signature: take(SIGNATURE_LENGTH, 'signature'),
      type: 'KEY_ANNOUNCEMENT',
      wrappers,
    }
  } else if (type === 3) {
    const requesterPublicKey = take(PUBLIC_KEY_LENGTH, 'requester public key')
    const marker = take(1, 'keyId marker')[0]
    if (marker !== 0 && marker !== 1) throw new Error('QPGC key request marker is invalid.')
    envelope = {
      epochId,
      groupId,
      keyId: marker ? take(KEY_ID_LENGTH, 'requested keyId') : null,
      requesterPublicKey,
      signature: take(SIGNATURE_LENGTH, 'signature'),
      type: 'KEY_REQUEST',
    }
  } else {
    envelope = {
      epochId,
      groupId,
      requesterPublicKey: take(PUBLIC_KEY_LENGTH, 'requester public key'),
      signature: take(SIGNATURE_LENGTH, 'signature'),
      type: 'ROTATION_REQUEST',
    }
  }
  if (offset !== bytes.length) throw new Error('QPGC envelope has trailing data.')
  return envelope
}

function canonicalBase64(value: Uint8Array) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return globalThis.btoa(binary)
}

function parseCanonicalBase64(value: string, label: string) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${label} is not canonical Base64.`)
  }
  let binary: string
  try {
    binary = globalThis.atob(value)
  } catch {
    throw new Error(`${label} is not canonical Base64.`)
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  if (canonicalBase64(bytes) !== value) throw new Error(`${label} is not canonical Base64.`)
  return bytes
}

function qpgcStoredKeyAssociatedData(input: {
  readonly accountPublicKey: Uint8Array
  readonly epochId: Uint8Array
  readonly groupId: number
  readonly keyId: Uint8Array
}) {
  return concatBytes(
    QPGC_KEY_STORE_DOMAIN,
    requireBytes(input.accountPublicKey, PUBLIC_KEY_LENGTH, 'Stored-key account public key'),
    uint32Bytes(requireGroupId(input.groupId)),
    requireBytes(input.epochId, EPOCH_ID_LENGTH, 'Stored-key epochId'),
    requireBytes(input.keyId, KEY_ID_LENGTH, 'Stored-key keyId'),
  )
}

async function deriveQpgcStorageKey(secretKeyValue: Uint8Array, associatedData: Uint8Array) {
  const seed = secretKeyValue.length === nacl.sign.seedLength
    ? secretKeyValue
    : secretKeyValue.length === nacl.sign.secretKeyLength
      ? secretKeyValue.subarray(0, nacl.sign.seedLength)
      : null
  if (!seed) throw new Error('Selected-account secret key must be a 32-byte seed or 64-byte Ed25519 key.')
  const pseudorandomKey = await hmacSha256(QPGC_KEY_STORE_SALT, seed)
  try {
    return await hmacSha256(pseudorandomKey, concatBytes(associatedData, new Uint8Array([1])))
  } finally {
    pseudorandomKey.fill(0)
  }
}

export async function encryptQpgcStoredKey(input: {
  readonly epochId: Uint8Array
  readonly groupId: number
  readonly groupKey: Uint8Array
  readonly keyId: Uint8Array
  readonly nonce?: Uint8Array
  readonly selectedAccountSecretKey: Uint8Array
}) : Promise<EncryptedQpgcStoredKey> {
  const signingKey = getSigningKey(input.selectedAccountSecretKey)
  const associatedData = qpgcStoredKeyAssociatedData({
    accountPublicKey: signingKey.publicKey,
    epochId: input.epochId,
    groupId: input.groupId,
    keyId: input.keyId,
  })
  const nonce = input.nonce ?? getWebCrypto().getRandomValues(new Uint8Array(NONCE_LENGTH))
  const storageKey = await deriveQpgcStorageKey(input.selectedAccountSecretKey, associatedData)
  try {
    return {
      accountPublicKey: canonicalBase64(signingKey.publicKey),
      ciphertext: canonicalBase64(await aesGcm('encrypt', storageKey, nonce, associatedData, requireBytes(
        input.groupKey,
        GROUP_KEY_LENGTH,
        'QPGC group key',
      ))),
      epochId: canonicalBase64(input.epochId),
      groupId: requireGroupId(input.groupId),
      keyId: canonicalBase64(input.keyId),
      network: 'qortium',
      nonce: canonicalBase64(requireBytes(nonce, NONCE_LENGTH, 'QPGC key-store nonce')),
      version: 1,
    }
  } finally {
    storageKey.fill(0)
  }
}

export async function decryptQpgcStoredKey(input: {
  readonly record: EncryptedQpgcStoredKey
  readonly selectedAccountSecretKey: Uint8Array
}) {
  const record = input.record
  if (
    !record ||
    record.version !== 1 ||
    record.network !== 'qortium' ||
    !Number.isSafeInteger(record.groupId) ||
    record.groupId < 1
  ) throw new Error('Stored QPGC key record is invalid.')
  const signingKey = getSigningKey(input.selectedAccountSecretKey)
  const accountPublicKey = parseCanonicalBase64(record.accountPublicKey, 'Stored-key account public key')
  if (!equalBytes(signingKey.publicKey, requireBytes(accountPublicKey, PUBLIC_KEY_LENGTH, 'Stored-key account public key'))) {
    throw new Error('Stored QPGC key belongs to a different account.')
  }
  const epochId = requireBytes(parseCanonicalBase64(record.epochId, 'Stored-key epochId'), EPOCH_ID_LENGTH, 'Stored-key epochId')
  const keyId = requireBytes(parseCanonicalBase64(record.keyId, 'Stored-key keyId'), KEY_ID_LENGTH, 'Stored-key keyId')
  const associatedData = qpgcStoredKeyAssociatedData({
    accountPublicKey,
    epochId,
    groupId: record.groupId,
    keyId,
  })
  const storageKey = await deriveQpgcStorageKey(input.selectedAccountSecretKey, associatedData)
  try {
    const groupKey = await aesGcm(
      'decrypt',
      storageKey,
      requireBytes(parseCanonicalBase64(record.nonce, 'Stored-key nonce'), NONCE_LENGTH, 'Stored-key nonce'),
      associatedData,
      parseCanonicalBase64(record.ciphertext, 'Stored-key ciphertext'),
    )
    if (!equalBytes(await computeQpgcKeyId(record.groupId, epochId, groupKey), keyId)) {
      groupKey.fill(0)
      throw new Error('Stored QPGC key does not match its keyId.')
    }
    return { epochId, groupKey, keyId }
  } finally {
    storageKey.fill(0)
  }
}

function bytesToHex(value: Uint8Array) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
