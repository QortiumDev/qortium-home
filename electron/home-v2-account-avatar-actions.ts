import {
  ByteReader,
  concatBytes,
  equalBytes,
  exactBytes,
  int32Bytes,
  int64Bytes,
  sizedUtf8,
} from './home-v2-group-admin-actions.js'
import { homeV2FlattenPayloadRequest } from './home-v2-app-actions.js'
import { getStaticQdnServiceId } from './public-transaction-validation.js'

/**
 * SET_ACCOUNT_AVATAR (type 50): the SET_GROUP_AVATAR wire body minus the
 * group id — the 52-byte no-reference prefix, an avatar-presence byte, the
 * optional pointer `{service i32 | name sizedUtf8 | identifier sizedUtf8}`
 * (a cleared avatar serializes presence 0 and no pointer), then `fee i64`
 * (0 — the MemoryPoW fee-alternative path). Like the group variant it signs
 * ONLY a QDN pointer: avatar bytes travel through PUBLISH_QDN_RESOURCE with
 * its own prompt, Core's pointer rule is owner- and existence-agnostic, and
 * the raster/500 KiB bounds are enforced when the avatar is SERVED.
 */
const SET_ACCOUNT_AVATAR_TYPE = 50

export function homeV2AccountAvatarOperationLabel(remove: boolean) {
  return remove ? 'Remove your account avatar' : 'Set your account avatar'
}

function utf8Length(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function integerLikeZero(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value.trim()) : NaN
  if (!Number.isSafeInteger(parsed) || parsed !== 0) throw new Error(label)
}

export type HomeV2AccountAvatarPointer = Readonly<{
  identifier: string
  name: string
  service: string
  serviceId: number
}>

export type HomeV2SetAccountAvatarRequest = Readonly<{
  avatar: HomeV2AccountAvatarPointer | null
}>

export function normalizeHomeV2SetAccountAvatarRequest(request: Record<string, unknown>): HomeV2SetAccountAvatarRequest {
  request = homeV2FlattenPayloadRequest(request)
  integerLikeZero(request.fee, 'Home derives the avatar fee from the chain (zero + proof-of-work) and does not accept an app-provided fee.')
  integerLikeZero(request.txGroupId, 'Avatar transactions are never group-approved: txGroupId must be 0.')
  const avatarRaw = request.avatar
  if (avatarRaw === undefined || avatarRaw === null) {
    return Object.freeze({ avatar: null })
  }
  if (typeof avatarRaw !== 'object' || Array.isArray(avatarRaw)) {
    throw new Error('avatar must be null (to clear) or an object with service and name.')
  }
  const record = avatarRaw as Record<string, unknown>
  const service = typeof record.service === 'string' ? record.service.trim().toUpperCase() : ''
  if (!service) throw new Error('avatar.service is required.')
  // Known QDN services only; Core additionally requires the service to be
  // public and single-file, and enforces the raster/500 KiB rules when the
  // avatar is SERVED, not here — the transaction is a pointer.
  const serviceId = getStaticQdnServiceId(service)
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (!name) throw new Error('avatar.name is required.')
  if (utf8Length(name) > 40) throw new Error('avatar.name must be at most 40 UTF-8 bytes.')
  const identifier = typeof record.identifier === 'string' ? record.identifier.trim() : ''
  if (utf8Length(identifier) > 64) throw new Error('avatar.identifier must be at most 64 UTF-8 bytes.')
  return Object.freeze({ avatar: Object.freeze({ identifier, name, service, serviceId }) })
}

export function buildUnsignedQortiumSetAccountAvatarTransactionBytes(input: {
  readonly avatar: HomeV2AccountAvatarPointer | null
  readonly senderPublicKey: string | Uint8Array
  readonly timestamp: number
}) {
  return concatBytes(
    int32Bytes(SET_ACCOUNT_AVATAR_TYPE, 'Transaction type'),
    int64Bytes(BigInt(input.timestamp), 'Timestamp'),
    int32Bytes(0, 'Transaction group ID'),
    exactBytes(input.senderPublicKey, 32, 'Sender public key'),
    int32Bytes(0, 'MemoryPoW nonce'),
    new Uint8Array([input.avatar ? 1 : 0]),
    ...(input.avatar
      ? [
          int32Bytes(input.avatar.serviceId, 'Avatar service'),
          sizedUtf8(input.avatar.name, 'Avatar name', 40),
          sizedUtf8(input.avatar.identifier, 'Avatar identifier', 64),
        ]
      : []),
    int64Bytes(0n, 'Transaction fee'),
  )
}

export function assertUnsignedHomeV2SetAccountAvatarTransaction(
  bytes: Uint8Array,
  expected: {
    readonly avatar: HomeV2AccountAvatarPointer | null
    readonly nonce?: number
    readonly senderPublicKey: string | Uint8Array
    readonly timestamp: number
  },
) {
  const label = 'qortium SET_ACCOUNT_AVATAR transaction'
  const reader = new ByteReader(bytes)
  if (reader.int32('Transaction type') !== SET_ACCOUNT_AVATAR_TYPE) {
    throw new Error(`${label} changed the approved transaction type.`)
  }
  if (reader.int64('Timestamp') !== BigInt(expected.timestamp)) throw new Error(`${label} changed the approved timestamp.`)
  if (reader.int32('Transaction group ID') !== 0) throw new Error(`${label} changed the approved transaction group.`)
  const publicKey = exactBytes(expected.senderPublicKey, 32, 'Sender public key')
  if (!equalBytes(reader.exact(32, 'Sender public key'), publicKey)) {
    throw new Error(`${label} changed the approved account.`)
  }
  const actualNonce = reader.int32('MemoryPoW nonce') >>> 0
  const expectedNonce = expected.nonce ?? 0
  if (!Number.isInteger(expectedNonce) || expectedNonce < 0 || expectedNonce > 0xffff_ffff || actualNonce !== expectedNonce) {
    throw new Error(`${label} changed the MemoryPoW nonce.`)
  }
  // INDEPENDENT field-by-field reading — never a comparison against the
  // builder's re-serialization (the group family's review rule).
  const present = reader.exact(1, 'avatar presence flag')[0]
  if (present !== 0 && present !== 1) throw new Error(`${label} carried an invalid avatar presence byte.`)
  if ((present === 1) !== (expected.avatar !== null)) throw new Error(`${label} changed the avatar presence.`)
  if (expected.avatar !== null) {
    if (reader.int32('Avatar service') !== expected.avatar.serviceId) throw new Error(`${label} changed the avatar service.`)
    if (reader.sizedUtf8('Avatar name', 40) !== expected.avatar.name) throw new Error(`${label} changed the avatar name.`)
    if (reader.sizedUtf8('Avatar identifier', 64) !== expected.avatar.identifier) throw new Error(`${label} changed the avatar identifier.`)
  }
  if (reader.int64('Transaction fee') !== 0n) throw new Error(`${label} changed the approved fee.`)
  reader.done(label)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

// The current avatar pointer from GET /addresses/{address}/avatar/info
// (Core's AvatarData: service enum name, name, identifier). Fail closed on
// unexpected shape; the bridge maps the endpoint's 404 to null (no avatar).
export function selectHomeV2AccountAvatarPointer(value: unknown): {
  identifier: string
  name: string
  service: string
} {
  if (!isRecord(value)) throw new Error('Account avatar lookup answered an invalid shape.')
  const { identifier, name, service } = value
  if (typeof service !== 'string' || !service || typeof name !== 'string' || !name) {
    throw new Error('Account avatar lookup answered an invalid shape.')
  }
  if (identifier !== undefined && identifier !== null && typeof identifier !== 'string') {
    throw new Error('Account avatar lookup answered an invalid shape.')
  }
  return Object.freeze({
    identifier: typeof identifier === 'string' ? identifier : '',
    name,
    service: service.toUpperCase(),
  })
}
