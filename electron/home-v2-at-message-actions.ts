// SEND_MESSAGE — a deliberately narrow, zero-fee chain MESSAGE addressed to an
// AT (autonomous transaction / smart contract).
//
// This is the only SIGNING action restored in the tier-2 batch, so its
// boundaries are drawn tight and stated here rather than left implicit:
//
//   - AT RECIPIENTS ONLY. The recipient must decode to a 25-byte, version-23,
//     checksum-valid Qortium AT address (assertValidQortiumAtAddress in
//     qdn-at-message.ts, ported unchanged from Home 1.x). An ordinary account
//     address is refused. That check is what keeps this from becoming a
//     general "send a message to any user" primitive.
//   - PLAINTEXT ONLY. No encryption, so nothing here can be used to smuggle a
//     ciphertext blob past the chat paths that own encryption.
//   - NO PAYMENT. Amount is hard-wired to zero in the serializer; an app that
//     tries to attach one is REFUSED rather than silently ignored (see
//     FORBIDDEN_FIELDS). 1.x ignored such fields, which risks an app believing
//     it paid an AT that it did not.
//   - FEE ZERO. Paid for with local MemoryPoW instead, computed in-process.
//   - NO APP-SUPPLIED BYTES. The transaction is serialized field by field from
//     the two validated inputs; the bridge never accepts raw transaction bytes.
//   - qdnRequest / Qortium ONLY. The serializer mirrors Qortium Core's
//     MessageTransactionTransformer, including the fact that Qortium's
//     BaseTransactionData does not chain a last-reference field. Qortal's
//     MESSAGE layout differs, so advertising this on qortalRequest would mean
//     signing bytes that chain would reject — or worse, misread. This is the
//     same asymmetric-catalogue precedent SEARCH_GROUPS set in
//     home-v2-app-actions.ts, for a stronger reason: there the endpoint is
//     merely absent, here the wire format actually differs.
//
// Pure module: validation and copy only. The signing, proof-of-work and
// broadcast live in the desktop bridge, which is the only place that ever
// touches a secret key.

import {
  QORTIUM_AT_MESSAGE_MAX_BYTES,
  QORTIUM_AT_MESSAGE_POW_DIFFICULTY,
  getQortiumAtMessageRequest,
} from './qdn-at-message.js'
import { getRequestPayload, isRecord, type QdnAppRequest } from './qdn-request-values.js'
import type { HomeV2AppBridgeProtocol } from './home-v2-app-actions.js'

export const HOME_V2_AT_MESSAGE_ACTIONS = Object.freeze(['SEND_MESSAGE'] as const)

export function isHomeV2AtMessageAction(action: string) {
  return (HOME_V2_AT_MESSAGE_ACTIONS as readonly string[]).includes(action)
}

/**
 * Fields that would mean something on a general MESSAGE but cannot mean
 * anything here, refused explicitly.
 *
 * Refusing beats ignoring: an app that sends `{ amount: 5 }` and gets a
 * success back would reasonably conclude it had paid the AT five units. It
 * had not — the serializer writes a zero amount regardless. A hard error is
 * the only answer that cannot be misread.
 */
const FORBIDDEN_FIELDS: readonly (readonly [string, string])[] = Object.freeze([
  ['amount', 'SEND_MESSAGE cannot carry a payment; use PAYMENT or TRANSFER_ASSET.'],
  ['assetId', 'SEND_MESSAGE cannot carry a payment; use PAYMENT or TRANSFER_ASSET.'],
  ['recipientPublicKey', 'SEND_MESSAGE addresses an AT by address, not by public key.'],
  ['chatReference', 'SEND_MESSAGE is not a chat message and has no chat reference.'],
  ['txGroupId', 'SEND_MESSAGE is always sent outside a transaction group.'],
  ['groupId', 'SEND_MESSAGE is always sent outside a transaction group.'],
])

// Both request styles put fields either at the top level OR inside a `payload`
// object, and getRequestValue (qdn-request-values.ts) reads them
// payload-FIRST. recipient and message are read that way. So EVERY guard here
// must look in both places too — a check that reads only `request[field]`
// would miss `{ payload: { amount: 5 } }`, and the serializer would then drop
// the amount silently, exactly the "believes it paid" failure this file
// exists to prevent. `presentAt` and `readFlagAt` below are the two
// payload-aware readers all the guards go through.
function presentAt(container: unknown, key: string) {
  if (!isRecord(container)) return false
  const value = container[key]
  return value !== undefined && value !== null && value !== ''
}

function isPresentAnywhere(request: Record<string, unknown>, key: string) {
  return presentAt(request, key) || presentAt(request.payload, key)
}

// Reads a boolean flag from top level and payload, rejecting a non-boolean
// value and a duplicate that disagrees with itself. Returns the single agreed
// value, or undefined when the flag is absent in both places.
function readFlag(request: Record<string, unknown>, key: string): boolean | undefined {
  const candidates: unknown[] = []
  if (Object.prototype.hasOwnProperty.call(request, key) && request[key] !== undefined && request[key] !== null) {
    candidates.push(request[key])
  }
  const payload = isRecord(request.payload) ? request.payload : undefined
  if (payload && Object.prototype.hasOwnProperty.call(payload, key) && payload[key] !== undefined && payload[key] !== null) {
    candidates.push(payload[key])
  }
  if (candidates.length === 0) return undefined
  for (const candidate of candidates) {
    if (typeof candidate !== 'boolean') {
      throw new Error(`SEND_MESSAGE ${key} must be a boolean, not ${typeof candidate}.`)
    }
  }
  if (candidates.length === 2 && candidates[0] !== candidates[1]) {
    throw new Error(`SEND_MESSAGE ${key} was given twice with different values.`)
  }
  return candidates[0] as boolean
}

// A value present at BOTH the top level and inside payload, with different
// contents, is ambiguous: the reader would take the payload one, but the app
// author cannot know that. Refuse rather than silently pick one.
function assertNoConflictingDuplicate(request: Record<string, unknown>, key: string) {
  if (!isRecord(request.payload)) return
  if (!presentAt(request, key) || !presentAt(request.payload, key)) return
  if (request[key] !== (request.payload as Record<string, unknown>)[key]) {
    throw new Error(`SEND_MESSAGE ${key} was given twice with different values.`)
  }
}

export type HomeV2AtMessageRequest = {
  readonly message: string
  readonly recipient: string
}

export function normalizeHomeV2AtMessageRequest(
  protocol: HomeV2AppBridgeProtocol,
  request: Record<string, unknown>,
): HomeV2AtMessageRequest {
  if (protocol !== 'qdnRequest') {
    throw new Error('SEND_MESSAGE is a Qortium action; it is not available on qortalRequest.')
  }
  for (const [field, message] of FORBIDDEN_FIELDS) {
    if (isPresentAnywhere(request, field)) {
      throw new Error(message)
    }
  }
  // Encryption is refused whether requested through `isEncrypted` or the older
  // `encrypt` alias, and in either location.
  if (readFlag(request, 'isEncrypted') === true || readFlag(request, 'encrypt') === true) {
    throw new Error('SEND_MESSAGE is plaintext only; it cannot encrypt.')
  }
  if (readFlag(request, 'isText') === false) {
    throw new Error('SEND_MESSAGE sends UTF-8 text only.')
  }
  const payload = getRequestPayload(request as QdnAppRequest)
  const feeCandidates = [request.fee, payload === request ? undefined : payload.fee].filter(
    (value) => value !== undefined && value !== null && value !== '',
  )
  for (const rawFee of feeCandidates) {
    const fee = typeof rawFee === 'number' ? rawFee : Number(rawFee)
    if (!Number.isFinite(fee) || fee !== 0) {
      throw new Error('SEND_MESSAGE is always fee 0; it is paid for with local proof-of-work.')
    }
  }
  // The recipient and the message are the only two fields that DO take effect,
  // so a top-level-vs-payload disagreement on them would sign one thing while
  // an app author believed it sent another. Refuse the ambiguity.
  for (const key of ['recipient', 'recipientAddress', 'message']) {
    assertNoConflictingDuplicate(request, key)
  }
  // Recipient AT-address validation (25 bytes, version 23, checksum) and the
  // 4,000-byte UTF-8 message bound both happen inside here, reading the same
  // payload-first accessor the guards above use.
  const { message, recipient } = getQortiumAtMessageRequest(request)
  return Object.freeze({ message, recipient })
}

// The prompt discloses the ENTIRE message — no truncation. What the user
// approves is exactly what gets signed, so the two must be the same bytes. The
// message accepts up to 4,000 bytes; the dialog renders it in a bounded,
// scrollable field (PermissionDialog 'scroll' variant) so a long one stays
// readable without hiding any of it, and the byte count is shown alongside so
// the length is never in doubt. A previous version truncated at 1,000
// characters while the summary claimed to show the "exact text" — a benign
// prefix could then hide undisclosed contract instructions the user signed
// blind. That is fixed by disclosing all of it.
export function homeV2AtMessageByteLength(message: string) {
  return new TextEncoder().encode(message).byteLength
}

export function homeV2AtMessageOperationLabel() {
  return `Send a MESSAGE to a contract (no payment, fee 0, local proof-of-work difficulty ${QORTIUM_AT_MESSAGE_POW_DIFFICULTY})`
}

export { QORTIUM_AT_MESSAGE_MAX_BYTES, QORTIUM_AT_MESSAGE_POW_DIFFICULTY }
