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
    const value = request[field]
    if (value !== undefined && value !== null && value !== '') {
      throw new Error(message)
    }
  }
  if (request.isEncrypted === true) {
    throw new Error('SEND_MESSAGE is plaintext only; it cannot encrypt.')
  }
  if (request.isText === false) {
    throw new Error('SEND_MESSAGE sends UTF-8 text only.')
  }
  if (request.fee !== undefined && request.fee !== null && request.fee !== '') {
    const fee = typeof request.fee === 'number' ? request.fee : Number(request.fee)
    if (!Number.isFinite(fee) || fee !== 0) {
      throw new Error('SEND_MESSAGE is always fee 0; it is paid for with local proof-of-work.')
    }
  }
  // Recipient AT-address validation (25 bytes, version 23, checksum) and the
  // 4,000-byte UTF-8 message bound both happen inside here.
  const { message, recipient } = getQortiumAtMessageRequest(request)
  return Object.freeze({ message, recipient })
}

// The prompt shows the message in full up to this length. The only shipped
// caller sends a 17-byte literal ('SMPL faucet claim', qortium-casino
// website/src/bridge.js:149-160), but the action accepts up to 4,000 bytes, so
// a bound is needed to keep the dialog readable. Truncation is marked with an
// ellipsis so a user can always tell they are not seeing all of it.
export const HOME_V2_AT_MESSAGE_PREVIEW_MAX_CHARS = 1_000

export function homeV2AtMessagePreview(message: string) {
  return message.length > HOME_V2_AT_MESSAGE_PREVIEW_MAX_CHARS
    ? `${message.slice(0, HOME_V2_AT_MESSAGE_PREVIEW_MAX_CHARS)}…`
    : message
}

export function homeV2AtMessageOperationLabel() {
  return `Send a MESSAGE to a contract (no payment, fee 0, local proof-of-work difficulty ${QORTIUM_AT_MESSAGE_POW_DIFFICULTY})`
}

export { QORTIUM_AT_MESSAGE_MAX_BYTES, QORTIUM_AT_MESSAGE_POW_DIFFICULTY }
