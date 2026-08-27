import {
  ByteReader,
  concatBytes,
  equalBytes,
  exactBytes,
  int32Bytes,
  int64Bytes,
  sizedUtf8,
} from './home-v2-group-admin-actions.js'
import { base58Decode, base58Encode } from './base58.js'
import { isPrivateQdnService, isPublicQdnService } from './qdn-public-services.js'

/**
 * The restored rating writes. Both are Qortium Core additions (types 45/46)
 * built ON DEVICE with the local transformer pattern: the 1.x path not only
 * used API-keyed node builders — it sent the account's PRIVATE KEY to the
 * node's /transactions/sign. Home 2 never lets the key leave the process.
 *
 * Wire form (both): the 52-byte no-reference prefix `type i32 |
 * timestamp i64 | txGroupId i32 (must be 0) | rater public key 32 |
 * nonce i32`, the per-type body, then `fee i64` (0 — the MemoryPoW
 * fee-alternative path).
 */
export const HOME_V2_RATING_ACTIONS = Object.freeze([
  'RATE_ACCOUNT',
  'RATE_RESOURCE',
] as const)

export type HomeV2RatingAction = (typeof HOME_V2_RATING_ACTIONS)[number]

const RATING_ACTIONS = new Set<string>(HOME_V2_RATING_ACTIONS)

export function isHomeV2RatingAction(value: string): value is HomeV2RatingAction {
  return RATING_ACTIONS.has(value)
}

// Shared between the bridge (which stamps it on the prompt) and the shell
// (which refuses a prompt whose label does not match its action). Rating 0
// REMOVES the existing rating — a distinct operation, never a neutral score,
// so it gets its own caption.
export function homeV2RatingOperationLabel(action: HomeV2RatingAction, remove: boolean) {
  if (action === 'RATE_ACCOUNT') return remove ? 'Remove an account rating' : 'Rate an account'
  return remove ? 'Remove a QDN resource rating' : 'Rate a QDN resource'
}

const RATING_TYPES: Record<HomeV2RatingAction, number> = Object.freeze({
  RATE_ACCOUNT: 46,
  RATE_RESOURCE: 45,
})

// Core's AccountRatingCategory enum, exactly: the wire carries the numeric
// value, and any other text can never be valid.
export const HOME_V2_ACCOUNT_RATING_CATEGORIES: Readonly<Record<string, number>> = Object.freeze({
  SUBJECT: 0,
  PLAYER: 1,
  TRAINER: 2,
  MANAGER: 3,
})

// Core's ResourceRating.INTERNAL_SERVICES plus the private-service rule:
// public services minus these three are rateable.
const NON_RATEABLE_SERVICES = new Set(['AUTO_UPDATE', 'AUTO_UPDATE_BINARY', 'ARBITRARY_DATA'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function requestField(request: Record<string, unknown>, field: string): unknown {
  const payload = isRecord(request.payload) ? request.payload : null
  return payload?.[field] ?? request[field]
}

// The 1.x integer rule: a safe integer, or a string that is exactly one.
function integerField(value: unknown, label: string): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^-?\d+$/.test(value.trim())
      ? Number(value.trim())
      : NaN
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} must be an integer.`)
  return parsed
}

function assertRatingFeeAndGroup(request: Record<string, unknown>) {
  for (const field of ['fee', 'txGroupId', 'feeGroupId'] as const) {
    const value = requestField(request, field)
    if (value === undefined || value === null || value === '') continue
    if (integerField(value, `The ${field}`) !== 0) {
      throw new Error(
        field === 'fee'
          ? 'Home derives the rating fee from the chain (zero + proof-of-work) and does not accept an app-provided fee.'
          : 'Rating transactions are never group-approved: txGroupId must be 0.',
      )
    }
  }
}

export type HomeV2RateAccountRequest = Readonly<{
  action: 'RATE_ACCOUNT'
  category: string
  categoryValue: number
  rating: number
  targetPublicKey: string
}>

export function normalizeHomeV2RateAccountRequest(request: Record<string, unknown>): HomeV2RateAccountRequest {
  assertRatingFeeAndGroup(request)
  const targetRaw = requestField(request, 'targetPublicKey')
  if (typeof targetRaw !== 'string' || !targetRaw.trim()) throw new Error('Target public key is required.')
  const targetText = targetRaw.trim()
  let decoded: Uint8Array
  try {
    decoded = base58Decode(targetText)
  } catch {
    throw new Error('Target public key is not valid Base58.')
  }
  if (decoded.byteLength !== 32 || base58Encode(decoded) !== targetText) {
    throw new Error('Target public key must be an exact 32-byte Base58 key.')
  }
  const categoryRaw = requestField(request, 'category')
  if (typeof categoryRaw !== 'string' || !categoryRaw.trim()) throw new Error('Rating category is required.')
  const category = categoryRaw.trim().toUpperCase()
  const categoryValue = HOME_V2_ACCOUNT_RATING_CATEGORIES[category]
  if (categoryValue === undefined) {
    throw new Error(`Rating category must be one of ${Object.keys(HOME_V2_ACCOUNT_RATING_CATEGORIES).join(', ')}.`)
  }
  const rating = integerField(requestField(request, 'rating'), 'The rating')
  if (rating < -4 || rating > 4) {
    throw new Error('Rating must be an integer between -4 and 4 (0 removes the rating).')
  }
  return Object.freeze({
    action: 'RATE_ACCOUNT',
    category,
    categoryValue,
    rating,
    targetPublicKey: targetText,
  })
}

export type HomeV2RateResourceRequest = Readonly<{
  action: 'RATE_RESOURCE'
  // Canonical: null is the 'default' identifier — Core normalizes ''/'default'
  // to null and the wire serializes it as length 0, so Home signs that form.
  identifier: string | null
  name: string
  rating: number
  service: string
}>

export function normalizeHomeV2RateResourceRequest(request: Record<string, unknown>): HomeV2RateResourceRequest {
  assertRatingFeeAndGroup(request)
  const serviceRaw = requestField(request, 'service')
  if (typeof serviceRaw !== 'string' || !serviceRaw.trim()) throw new Error('QDN resource service is required.')
  const service = serviceRaw.trim().toUpperCase()
  if (!isPublicQdnService(service)) {
    throw new Error(isPrivateQdnService(service)
      ? 'Private (encrypted) QDN resources cannot be rated.'
      : 'Only public QDN services can be rated.')
  }
  if (NON_RATEABLE_SERVICES.has(service)) {
    throw new Error(`The ${service} service is internal and cannot be rated.`)
  }
  const nameRaw = requestField(request, 'name')
  if (typeof nameRaw !== 'string' || !nameRaw.trim()) throw new Error('QDN resource name is required.')
  const name = nameRaw.trim()
  const nameBytes = new TextEncoder().encode(name).byteLength
  if (nameBytes < 3 || nameBytes > 40) throw new Error('QDN resource name must be 3 to 40 bytes.')
  const identifierRaw = requestField(request, 'identifier')
  let identifier: string | null = null
  if (identifierRaw !== undefined && identifierRaw !== null) {
    if (typeof identifierRaw !== 'string') throw new Error('QDN resource identifier must be a string.')
    const trimmed = identifierRaw.trim()
    identifier = trimmed && trimmed !== 'default' ? trimmed : null
  }
  if (identifier && new TextEncoder().encode(identifier).byteLength > 64) {
    throw new Error('QDN resource identifier exceeds the 64 byte limit.')
  }
  if (identifier === '.' || identifier === '..' || name === '.' || name === '..') {
    throw new Error('QDN resource coordinates cannot be dot segments.')
  }
  const rating = integerField(requestField(request, 'rating'), 'The rating')
  if (rating < 0 || rating > 10) {
    throw new Error('Rating must be an integer between 1 and 10 (0 removes the rating).')
  }
  return Object.freeze({
    action: 'RATE_RESOURCE',
    identifier,
    name,
    rating,
    service,
  })
}

export type HomeV2RatingWirePayload =
  | (HomeV2RateAccountRequest)
  | (HomeV2RateResourceRequest & { readonly serviceId: number })

function ratingBody(payload: HomeV2RatingWirePayload): Uint8Array {
  if (payload.action === 'RATE_ACCOUNT') {
    return concatBytes(
      exactBytes(payload.targetPublicKey, 32, 'Target public key'),
      int32Bytes(payload.categoryValue, 'Rating category'),
      int32Bytes(payload.rating, 'Rating'),
    )
  }
  return concatBytes(
    int32Bytes(payload.serviceId, 'Service ID'),
    sizedUtf8(payload.name, 'Resource name', 40),
    payload.identifier === null
      ? int32Bytes(0, 'Identifier length')
      : sizedUtf8(payload.identifier, 'Resource identifier', 64),
    int32Bytes(payload.rating, 'Rating'),
  )
}

export function buildUnsignedQortiumRatingTransactionBytes(input: {
  readonly payload: HomeV2RatingWirePayload
  readonly senderPublicKey: string | Uint8Array
  readonly timestamp: number
}) {
  return concatBytes(
    int32Bytes(RATING_TYPES[input.payload.action], 'Transaction type'),
    int64Bytes(BigInt(input.timestamp), 'Timestamp'),
    int32Bytes(0, 'Transaction group ID'),
    exactBytes(input.senderPublicKey, 32, 'Sender public key'),
    int32Bytes(0, 'MemoryPoW nonce'),
    ratingBody(input.payload),
    int64Bytes(0n, 'Transaction fee'),
  )
}

export function assertUnsignedHomeV2RatingTransaction(
  bytes: Uint8Array,
  expected: {
    readonly nonce?: number
    readonly payload: HomeV2RatingWirePayload
    readonly senderPublicKey: string | Uint8Array
    readonly timestamp: number
  },
) {
  const label = `qortium ${expected.payload.action} transaction`
  const reader = new ByteReader(bytes)
  if (reader.int32('Transaction type') !== RATING_TYPES[expected.payload.action]) {
    throw new Error(`${label} changed the approved transaction type.`)
  }
  if (reader.int64('Timestamp') !== BigInt(expected.timestamp)) throw new Error(`${label} changed the approved timestamp.`)
  if (reader.int32('Transaction group ID') !== 0) throw new Error(`${label} changed the approved transaction group.`)
  const publicKey = exactBytes(expected.senderPublicKey, 32, 'Sender public key')
  if (!equalBytes(reader.exact(32, 'Sender public key'), publicKey)) {
    throw new Error(`${label} changed the approved rater.`)
  }
  const actualNonce = reader.int32('MemoryPoW nonce') >>> 0
  const expectedNonce = expected.nonce ?? 0
  if (!Number.isInteger(expectedNonce) || expectedNonce < 0 || expectedNonce > 0xffff_ffff || actualNonce !== expectedNonce) {
    throw new Error(`${label} changed the MemoryPoW nonce.`)
  }
  // INDEPENDENT field-by-field reading — deliberately NOT a comparison
  // against ratingBody()'s re-serialization, which would let one shared
  // builder/verifier bug pass both sides (the group family's review rule).
  const payload = expected.payload
  const fail = (field: string) => new Error(`${label} changed the approved ${field}.`)
  if (payload.action === 'RATE_ACCOUNT') {
    if (!equalBytes(reader.exact(32, 'Target public key'), exactBytes(payload.targetPublicKey, 32, 'Target public key'))) {
      throw fail('rated account')
    }
    if (reader.int32('Rating category') !== payload.categoryValue) throw fail('rating category')
    if (reader.int32('Rating') !== payload.rating) throw fail('rating')
  } else {
    if (reader.int32('Service ID') !== payload.serviceId) throw fail('service')
    if (reader.sizedUtf8('Resource name', 40) !== payload.name) throw fail('resource name')
    if (reader.sizedUtf8('Resource identifier', 64) !== (payload.identifier ?? '')) throw fail('resource identifier')
    if (reader.int32('Rating') !== payload.rating) throw fail('rating')
  }
  if (reader.int64('Transaction fee') !== 0n) throw new Error(`${label} changed the approved fee.`)
  reader.done(label)
}

// --- Live-state selectors (lying-node hardening: shape-check everything) ---

export type HomeV2AccountRatingEdge = Readonly<{
  activeRating: number | null
  blocksRemaining: number
  canChangeNow: boolean
}>

// Core's GET /account-ratings/cooldown answer (AccountRatingCooldownData):
// one read gives the rater's active rating on this exact target+category
// edge, whether a change is allowed now, and how many blocks remain if not —
// and Core's requireKnownPublicKey on `target` makes an unknown target
// account fail this read up front. Fail closed on any unexpected shape.
export function selectHomeV2AccountRatingEdge(value: unknown): HomeV2AccountRatingEdge {
  if (!isRecord(value)) throw new Error('Account rating cooldown lookup answered an invalid shape.')
  const { activeRating, blocksRemaining, canChangeNow } = value
  if (typeof canChangeNow !== 'boolean') throw new Error('Account rating cooldown lookup answered an invalid shape.')
  if (typeof blocksRemaining !== 'number' || !Number.isSafeInteger(blocksRemaining) || blocksRemaining < 0) {
    throw new Error('Account rating cooldown lookup answered an invalid shape.')
  }
  let active: number | null = null
  if (activeRating !== null && activeRating !== undefined) {
    if (typeof activeRating !== 'number' || !Number.isSafeInteger(activeRating) ||
      activeRating < -4 || activeRating > 4 || activeRating === 0) {
      throw new Error('Account rating cooldown lookup answered an invalid shape.')
    }
    active = activeRating
  }
  return Object.freeze({ activeRating: active, blocksRemaining, canChangeNow })
}

// The rater's current resource rating from GET /resource-ratings/rating;
// null when unrated (the bridge maps a 404 to null before calling this).
export function selectHomeV2CurrentResourceRating(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) throw new Error('Resource rating lookup answered an invalid shape.')
  const rating = value.rating
  if (rating === null || rating === undefined) return null
  if (typeof rating === 'number' && Number.isSafeInteger(rating) && rating >= 1 && rating <= 10) return rating
  throw new Error('Resource rating lookup answered an invalid shape.')
}

// The target account's stored public key from GET /addresses/{address};
// Core validity demands the STORED key match the transaction's target key.
export function selectHomeV2AccountPublicKey(value: unknown): string | null {
  if (!isRecord(value)) return null
  const key = value.publicKey
  return typeof key === 'string' && key ? key : null
}
