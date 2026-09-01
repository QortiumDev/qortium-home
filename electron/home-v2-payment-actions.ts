import { Sha256 } from 'asmcrypto.js'

import {
  ByteReader,
  concatBytes,
  equalBytes,
  exactBytes,
  int32Bytes,
  int64Bytes,
} from './home-v2-group-admin-actions.js'
import { base58Decode } from './base58.js'
import { parseHomeV2CoinAmount, type HomeV2CoinAmount } from './home-v2-app-actions.js'

/**
 * The restored payment family — the LAST family, and the one that moves
 * funds. Everything here binds one normalized immutable spend intent from
 * the request to the signed bytes:
 *
 * - `PAYMENT` and native `SEND_COIN` are aliases for ONE canonical Qortium
 *   PAYMENT (type 2, asset 0). 1.x built these as asset transfers through
 *   an API-keyed Core builder and sent the account's PRIVATE KEY to the
 *   node's /transactions/sign; Home 2 serializes and signs locally.
 * - `TRANSFER_ASSET` is the type-12 transfer on either chain. Qortium omits
 *   lastReference; Qortal carries the ordinary 64-byte lastReference.
 * - `SEND_QORT` is the separate Qortal PAYMENT compatibility action, using
 *   the existing qortal-payment.ts serializer (64-byte lastReference).
 * - `SEND_COIN`'s 1.x FOREIGN arm (deriving BTC/LTC/... wallets from the
 *   account seed and posting xprv58 to Core) is a HARD refusal here.
 *
 * Qortium PAYMENT/TRANSFER_ASSET have NO MemoryPoW alternative: both pay
 * the chain unit fee, quoted by Home and pinned to the prompt. Wire forms
 * (no lastReference, no nonce):
 *   PAYMENT (89 unsigned bytes):
 *     type=2 i32 | timestamp i64 | txGroupId=0 i32 | sender key 32 |
 *     recipient 25 | amount i64 | fee i64
 *   TRANSFER_ASSET (97 unsigned bytes): same prefix |
 *     recipient 25 | assetId i64 | amount i64 | fee i64
 */
export const HOME_V2_PAYMENT_ACTIONS = Object.freeze([
  'PAYMENT',
  'SEND_COIN',
  'SEND_QORT',
  'TRANSFER_ASSET',
] as const)

export type HomeV2PaymentAction = (typeof HOME_V2_PAYMENT_ACTIONS)[number]

const PAYMENT_ACTIONS = new Set<string>(HOME_V2_PAYMENT_ACTIONS)

export function isHomeV2PaymentAction(value: string): value is HomeV2PaymentAction {
  return PAYMENT_ACTIONS.has(value)
}

// PAYMENT and native SEND_COIN are one operation; the journal and the
// prompt caption both use the canonical spelling so neither alias can slip
// the other's retained unknown-outcome block.
export function canonicalHomeV2PaymentAction(action: HomeV2PaymentAction) {
  return action === 'SEND_COIN' ? 'PAYMENT' : action
}

export function homeV2PaymentOperationLabel(action: HomeV2PaymentAction) {
  if (action === 'SEND_QORT') return 'Send QORT'
  if (action === 'TRANSFER_ASSET') return 'Transfer an asset'
  return 'Send the native Qortium coin'
}

const QORTIUM_ACCOUNT_ADDRESS_VERSION = 58
const QORTIUM_AT_ADDRESS_VERSION = 23

function sha256Sync(data: Uint8Array) {
  const result = new Sha256().process(data).finish().result
  if (!result) throw new Error('SHA-256 failed.')
  return result
}

export type HomeV2PaymentRecipient = Readonly<{
  address: string
  bytes: Uint8Array
  isAt: boolean
}>

/**
 * A payment recipient: a 25-byte checksummed address of the ordinary
 * account version (Q…) or the AT contract version (A…) — exactly the two
 * forms Core's Payment validity accepts. The decoded bytes are pinned into
 * the signed transaction; anything else refuses.
 */
export function normalizeHomeV2PaymentRecipient(value: string, label: string): HomeV2PaymentRecipient {
  let decoded: Uint8Array
  try {
    decoded = base58Decode(value)
  } catch {
    throw new Error(`${label} is not valid Base58.`)
  }
  if (decoded.length !== 25) throw new Error(`${label} must decode to 25 bytes.`)
  const version = decoded[0]
  if (version !== QORTIUM_ACCOUNT_ADDRESS_VERSION && version !== QORTIUM_AT_ADDRESS_VERSION) {
    throw new Error(`${label} has an unsupported address version.`)
  }
  const checksum = decoded.slice(21)
  const expected = sha256Sync(sha256Sync(decoded.slice(0, 21))).slice(0, 4)
  for (let index = 0; index < 4; index += 1) {
    if (checksum[index] !== expected[index]) throw new Error(`${label} has an invalid checksum.`)
  }
  return Object.freeze({ address: value, bytes: decoded, isAt: version === QORTIUM_AT_ADDRESS_VERSION })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Money-field reads have NO payload-vs-top-level precedence: if a
 * financially relevant field occurs in both places (or under two aliases)
 * with different values, the request refuses rather than letting one copy
 * be displayed and the other consumed.
 */
function moneyField(request: Record<string, unknown>, fields: readonly string[], label: string): unknown {
  const payload = isRecord(request.payload) ? request.payload : null
  let seen: unknown
  let found = false
  for (const source of payload ? [payload, request] : [request]) {
    for (const field of fields) {
      const candidate = source[field]
      if (candidate === undefined || candidate === null || candidate === '') continue
      if (found && candidate !== seen) {
        throw new Error(`${label} appears more than once with different values; refusing.`)
      }
      seen = candidate
      found = true
    }
  }
  return found ? seen : undefined
}

function refuseNonZero(request: Record<string, unknown>, fields: readonly string[], message: string) {
  const value = moneyField(request, fields, fields[0])
  if (value === undefined) return
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value.trim()) : NaN
  if (!Number.isSafeInteger(parsed) || parsed !== 0) throw new Error(message)
}

function positiveAmount(value: unknown, label: string): HomeV2CoinAmount {
  if (value === undefined) throw new Error(`${label} is required.`)
  const amount = parseHomeV2CoinAmount(value, label)
  if (amount.atomic <= 0n) throw new Error(`${label} must be greater than zero.`)
  return amount
}

const NATIVE_COIN_ALIASES = new Set(['NATIVE', 'NATIVE_ASSET', 'ASSET_0', 'ASSET0', 'QORTIUM'])
// Any of these 1.x foreign-arm fields present means the app wants a foreign
// coin send — refused loudly, never silently downgraded to a native send.
const FOREIGN_ARM_FIELDS = ['sendMax', 'feePerByte', 'receivingAddress', 'xprv58'] as const

export class HomeV2ForeignSendError extends Error {
  readonly code = 'FOREIGN_SEND_UNAVAILABLE'
}

function assertNoAppFeeOrGroup(request: Record<string, unknown>) {
  refuseNonZero(request, ['fee'], 'Home quotes the chain fee itself and does not accept an app-provided fee.')
  refuseNonZero(request, ['txGroupId', 'feeGroupId'], 'Payment transactions are never group-approved: txGroupId must be 0.')
}

const RECIPIENT_FIELDS = ['recipient', 'recipientAddress', 'address', 'destinationAddress'] as const

export type HomeV2NativeSendRequest = Readonly<{
  action: HomeV2PaymentAction
  amount: HomeV2CoinAmount
  recipient: HomeV2PaymentRecipient
}>

export function normalizeHomeV2NativeSendRequest(
  action: 'PAYMENT' | 'SEND_COIN',
  request: Record<string, unknown>,
): HomeV2NativeSendRequest {
  // EVERY 1.x foreign-arm signal — feePerByte included — refuses with the
  // coded foreign error: an app that thinks it is sending BTC must hear
  // exactly that foreign sending is unavailable (review round 1, LOW).
  for (const field of FOREIGN_ARM_FIELDS) {
    if (moneyField(request, [field], field) !== undefined) {
      throw new HomeV2ForeignSendError('Foreign coin sending is unavailable in Qortium Home 2; SEND_COIN sends only the native coin.')
    }
  }
  const coinRaw = moneyField(request, ['coin', 'blockchain'], 'The coin selector')
  if (coinRaw !== undefined) {
    const coin = typeof coinRaw === 'string' ? coinRaw.trim().toUpperCase() : ''
    if (!NATIVE_COIN_ALIASES.has(coin)) {
      throw new HomeV2ForeignSendError('Foreign coin sending is unavailable in Qortium Home 2; SEND_COIN sends only the native coin.')
    }
  }
  const assetIdRaw = moneyField(request, ['assetId'], 'The asset id')
  if (assetIdRaw !== undefined) {
    const assetId = typeof assetIdRaw === 'number'
      ? assetIdRaw
      : typeof assetIdRaw === 'string' && /^\d+$/.test(assetIdRaw.trim()) ? Number(assetIdRaw.trim()) : NaN
    if (!Number.isSafeInteger(assetId) || assetId !== 0) {
      throw new Error('Use TRANSFER_ASSET for non-native asset transfers.')
    }
  }
  assertNoAppFeeOrGroup(request)
  const recipientRaw = moneyField(request, RECIPIENT_FIELDS, 'The recipient address')
  if (typeof recipientRaw !== 'string' || !recipientRaw.trim()) throw new Error('Recipient address is required.')
  const recipient = normalizeHomeV2PaymentRecipient(recipientRaw.trim(), 'The recipient address')
  const amount = positiveAmount(moneyField(request, ['amount'], 'The amount'), 'The amount')
  return Object.freeze({ action, amount, recipient })
}

export type HomeV2TransferAssetRequest = Readonly<{
  action: 'TRANSFER_ASSET'
  amount: HomeV2CoinAmount
  assetId: number
  recipient: HomeV2PaymentRecipient
}>

export function normalizeHomeV2TransferAssetRequest(request: Record<string, unknown>): HomeV2TransferAssetRequest {
  assertNoAppFeeOrGroup(request)
  const assetIdRaw = moneyField(request, ['assetId'], 'The asset id')
  const assetId = typeof assetIdRaw === 'number'
    ? assetIdRaw
    : typeof assetIdRaw === 'string' && /^\d+$/.test(String(assetIdRaw).trim()) ? Number(String(assetIdRaw).trim()) : NaN
  if (!Number.isSafeInteger(assetId) || assetId < 0) throw new Error('A non-negative numeric assetId is required.')
  // Asset 0 is the NATIVE coin, and this arm treats its subject as a
  // non-native asset throughout: the total-debit row and the balance check
  // both count only the fee, because a normal asset transfer debits the
  // native balance for the fee alone. Accepting assetId 0 here would show a
  // total debit that omits the entire payment and check a balance that never
  // covered it, so the native coin is routed to PAYMENT — the exact mirror of
  // normalizeHomeV2NativeSendRequest refusing a non-zero assetId (payments
  // review, 2026-08-27).
  if (assetId === 0) {
    throw new Error('Use PAYMENT or SEND_COIN for the native coin; TRANSFER_ASSET is for other assets.')
  }
  const recipientRaw = moneyField(request, RECIPIENT_FIELDS, 'The recipient address')
  if (typeof recipientRaw !== 'string' || !recipientRaw.trim()) throw new Error('Recipient address is required.')
  const recipient = normalizeHomeV2PaymentRecipient(recipientRaw.trim(), 'The recipient address')
  const amount = positiveAmount(moneyField(request, ['amount'], 'The amount'), 'The amount')
  return Object.freeze({ action: 'TRANSFER_ASSET', amount, assetId, recipient })
}

export type HomeV2SendQortRequest = Readonly<{
  action: 'SEND_QORT'
  amount: HomeV2CoinAmount
  // Address mode: the validated Qortal address. Name mode: the exact name
  // text, resolved (and re-resolved after approval) by the handler.
  recipientAddress: string | null
  recipientName: string | null
}>

export function normalizeHomeV2SendQortRequest(request: Record<string, unknown>): HomeV2SendQortRequest {
  assertNoAppFeeOrGroup(request)
  const recipientRaw = moneyField(request, ['recipient', 'recipientAddress', 'address'], 'The recipient')
  if (typeof recipientRaw !== 'string' || !recipientRaw.trim()) throw new Error('Recipient is required.')
  const recipientText = recipientRaw.trim()
  const amount = positiveAmount(moneyField(request, ['amount'], 'The amount'), 'The amount')
  let address: string | null = null
  try {
    address = normalizeHomeV2PaymentRecipient(recipientText, 'The recipient address').address
  } catch {
    address = null
  }
  if (address) {
    return Object.freeze({ action: 'SEND_QORT', amount, recipientAddress: address, recipientName: null })
  }
  const nameBytes = new TextEncoder().encode(recipientText).byteLength
  if (nameBytes < 3 || nameBytes > 40) {
    throw new Error('Recipient must be a valid Qortal address or a registered name of 3 to 40 bytes.')
  }
  if (/[\u0000-\u001f\u007f]/.test(recipientText)) {
    throw new Error('Recipient name contains unsupported control characters.')
  }
  return Object.freeze({ action: 'SEND_QORT', amount, recipientAddress: null, recipientName: recipientText })
}

// --- Qortium wire builders + independent verifiers (types 2 and 12) ---

export function buildUnsignedQortiumPaymentTransactionBytes(input: {
  readonly amountAtomic: bigint
  readonly feeAtomic: bigint
  readonly recipientBytes: Uint8Array
  readonly senderPublicKey: string | Uint8Array
  readonly timestamp: number
}) {
  return concatBytes(
    int32Bytes(2, 'Transaction type'),
    int64Bytes(BigInt(input.timestamp), 'Timestamp'),
    int32Bytes(0, 'Transaction group ID'),
    exactBytes(input.senderPublicKey, 32, 'Sender public key'),
    exactBytes(input.recipientBytes, 25, 'Recipient address'),
    int64Bytes(input.amountAtomic, 'Payment amount'),
    int64Bytes(input.feeAtomic, 'Payment fee'),
  )
}

export function buildUnsignedQortiumTransferAssetTransactionBytes(input: {
  readonly amountAtomic: bigint
  readonly assetId: number
  readonly feeAtomic: bigint
  readonly recipientBytes: Uint8Array
  readonly senderPublicKey: string | Uint8Array
  readonly timestamp: number
}) {
  return concatBytes(
    int32Bytes(12, 'Transaction type'),
    int64Bytes(BigInt(input.timestamp), 'Timestamp'),
    int32Bytes(0, 'Transaction group ID'),
    exactBytes(input.senderPublicKey, 32, 'Sender public key'),
    exactBytes(input.recipientBytes, 25, 'Recipient address'),
    int64Bytes(BigInt(input.assetId), 'Asset ID'),
    int64Bytes(input.amountAtomic, 'Transfer amount'),
    int64Bytes(input.feeAtomic, 'Transfer fee'),
  )
}

export function buildUnsignedQortalTransferAssetTransactionBytes(input: {
  readonly amountAtomic: bigint
  readonly assetId: number
  readonly feeAtomic: bigint
  readonly lastReference: string | Uint8Array
  readonly recipientBytes: Uint8Array
  readonly senderPublicKey: string | Uint8Array
  readonly timestamp: number
}) {
  return concatBytes(
    int32Bytes(12, 'Transaction type'),
    int64Bytes(BigInt(input.timestamp), 'Timestamp'),
    int32Bytes(0, 'Transaction group ID'),
    exactBytes(input.lastReference, 64, 'Last reference'),
    exactBytes(input.senderPublicKey, 32, 'Sender public key'),
    exactBytes(input.recipientBytes, 25, 'Recipient address'),
    int64Bytes(BigInt(input.assetId), 'Asset ID'),
    int64Bytes(input.amountAtomic, 'Transfer amount'),
    int64Bytes(input.feeAtomic, 'Transfer fee'),
  )
}

export function assertUnsignedHomeV2QortiumPaymentTransaction(
  bytes: Uint8Array,
  expected: {
    readonly amountAtomic: bigint
    readonly feeAtomic: bigint
    readonly recipientBytes: Uint8Array
    readonly senderPublicKey: string | Uint8Array
    readonly timestamp: number
  },
) {
  const label = 'qortium PAYMENT transaction'
  const reader = new ByteReader(bytes)
  if (reader.int32('Transaction type') !== 2) throw new Error(`${label} changed the approved transaction type.`)
  if (reader.int64('Timestamp') !== BigInt(expected.timestamp)) throw new Error(`${label} changed the approved timestamp.`)
  if (reader.int32('Transaction group ID') !== 0) throw new Error(`${label} changed the approved transaction group.`)
  if (!equalBytes(reader.exact(32, 'Sender public key'), exactBytes(expected.senderPublicKey, 32, 'Sender public key'))) {
    throw new Error(`${label} changed the approved sender.`)
  }
  if (!equalBytes(reader.exact(25, 'Recipient address'), exactBytes(expected.recipientBytes, 25, 'Recipient address'))) {
    throw new Error(`${label} changed the approved recipient.`)
  }
  if (reader.int64('Payment amount') !== expected.amountAtomic) throw new Error(`${label} changed the approved amount.`)
  if (reader.int64('Payment fee') !== expected.feeAtomic) throw new Error(`${label} changed the approved fee.`)
  reader.done(label)
}

export function assertUnsignedHomeV2QortiumTransferAssetTransaction(
  bytes: Uint8Array,
  expected: {
    readonly amountAtomic: bigint
    readonly assetId: number
    readonly feeAtomic: bigint
    readonly recipientBytes: Uint8Array
    readonly senderPublicKey: string | Uint8Array
    readonly timestamp: number
  },
) {
  const label = 'qortium TRANSFER_ASSET transaction'
  const reader = new ByteReader(bytes)
  if (reader.int32('Transaction type') !== 12) throw new Error(`${label} changed the approved transaction type.`)
  if (reader.int64('Timestamp') !== BigInt(expected.timestamp)) throw new Error(`${label} changed the approved timestamp.`)
  if (reader.int32('Transaction group ID') !== 0) throw new Error(`${label} changed the approved transaction group.`)
  if (!equalBytes(reader.exact(32, 'Sender public key'), exactBytes(expected.senderPublicKey, 32, 'Sender public key'))) {
    throw new Error(`${label} changed the approved sender.`)
  }
  if (!equalBytes(reader.exact(25, 'Recipient address'), exactBytes(expected.recipientBytes, 25, 'Recipient address'))) {
    throw new Error(`${label} changed the approved recipient.`)
  }
  if (reader.int64('Asset ID') !== BigInt(expected.assetId)) throw new Error(`${label} changed the approved asset.`)
  if (reader.int64('Transfer amount') !== expected.amountAtomic) throw new Error(`${label} changed the approved amount.`)
  if (reader.int64('Transfer fee') !== expected.feeAtomic) throw new Error(`${label} changed the approved fee.`)
  reader.done(label)
}

export function assertUnsignedHomeV2QortalTransferAssetTransaction(
  bytes: Uint8Array,
  expected: {
    readonly amountAtomic: bigint
    readonly assetId: number
    readonly feeAtomic: bigint
    readonly lastReference: string | Uint8Array
    readonly recipientBytes: Uint8Array
    readonly senderPublicKey: string | Uint8Array
    readonly timestamp: number
  },
) {
  const label = 'qortal TRANSFER_ASSET transaction'
  const reader = new ByteReader(bytes)
  if (reader.int32('Transaction type') !== 12) throw new Error(`${label} changed the approved transaction type.`)
  if (reader.int64('Timestamp') !== BigInt(expected.timestamp)) throw new Error(`${label} changed the approved timestamp.`)
  if (reader.int32('Transaction group ID') !== 0) throw new Error(`${label} changed the approved transaction group.`)
  if (!equalBytes(reader.exact(64, 'Last reference'), exactBytes(expected.lastReference, 64, 'Last reference'))) {
    throw new Error(`${label} changed the last reference.`)
  }
  if (!equalBytes(reader.exact(32, 'Sender public key'), exactBytes(expected.senderPublicKey, 32, 'Sender public key'))) {
    throw new Error(`${label} changed the approved sender.`)
  }
  if (!equalBytes(reader.exact(25, 'Recipient address'), exactBytes(expected.recipientBytes, 25, 'Recipient address'))) {
    throw new Error(`${label} changed the approved recipient.`)
  }
  if (reader.int64('Asset ID') !== BigInt(expected.assetId)) throw new Error(`${label} changed the approved asset.`)
  if (reader.int64('Transfer amount') !== expected.amountAtomic) throw new Error(`${label} changed the approved amount.`)
  if (reader.int64('Transfer fee') !== expected.feeAtomic) throw new Error(`${label} changed the approved fee.`)
  reader.done(label)
}

// --- fees ---

const MAX_BYTES_PER_UNIT_FEE = 1024n
const INT64_MAX = 9_223_372_036_854_775_807n

// Core's GET /transactions/unitfee answers the ATOMIC unit fee as a plain
// long (digits), not a decimal coin amount.
export function parseHomeV2UnitFee(value: unknown): bigint {
  const text = typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
  if (!/^\d+$/.test(text)) throw new Error('The chain fee quote is invalid.')
  const fee = BigInt(text)
  if (fee > INT64_MAX) throw new Error('The chain fee quote is out of range.')
  return fee
}

// Core: recommended fee = effective unit fee * ceil(dataLength / 1024).
/**
 * An amount as a payment prompt shows it: the human decimal AND the exact
 * atomic units.
 *
 * Both are shown on purpose. The decimal is what a person reads; the atomic
 * count is what is actually signed, and it is the form in which a
 * scaling mistake (a factor of 100,000,000) is impossible to miss.
 */
export function homeV2AtomicUnitsText(amount: { readonly atomic: bigint; readonly decimal: string }) {
  return `${amount.decimal} (${amount.atomic} atomic units)`
}

export function homeV2FeeForLength(unitFeeAtomic: bigint, signedByteLength: number): bigint {
  if (!Number.isSafeInteger(signedByteLength) || signedByteLength <= 0) throw new Error('Invalid transaction length.')
  const units = (BigInt(signedByteLength) + MAX_BYTES_PER_UNIT_FEE - 1n) / MAX_BYTES_PER_UNIT_FEE
  const fee = unitFeeAtomic * units
  if (fee > INT64_MAX) throw new Error('The chain fee quote is out of range.')
  return fee
}

export function homeV2CheckedTotalDebit(amountAtomic: bigint, feeAtomic: bigint): bigint {
  const total = amountAtomic + feeAtomic
  if (total > INT64_MAX || total < 0n) throw new Error('The payment total is out of range.')
  return total
}

export function assertUnsignedHomeV2QortalPaymentTransaction(
  bytes: Uint8Array,
  expected: {
    readonly amountAtomic: bigint
    readonly feeAtomic: bigint
    readonly lastReference: string | Uint8Array
    readonly recipientBytes: Uint8Array
    readonly senderPublicKey: string | Uint8Array
    readonly timestamp: number
  },
) {
  const label = 'qortal PAYMENT transaction'
  const reader = new ByteReader(bytes)
  if (reader.int32('Transaction type') !== 2) throw new Error(`${label} changed the approved transaction type.`)
  if (reader.int64('Timestamp') !== BigInt(expected.timestamp)) throw new Error(`${label} changed the approved timestamp.`)
  if (reader.int32('Transaction group ID') !== 0) throw new Error(`${label} changed the approved transaction group.`)
  if (!equalBytes(reader.exact(64, 'Last reference'), exactBytes(expected.lastReference, 64, 'Last reference'))) {
    throw new Error(`${label} changed the last reference.`)
  }
  if (!equalBytes(reader.exact(32, 'Sender public key'), exactBytes(expected.senderPublicKey, 32, 'Sender public key'))) {
    throw new Error(`${label} changed the approved sender.`)
  }
  if (!equalBytes(reader.exact(25, 'Recipient address'), exactBytes(expected.recipientBytes, 25, 'Recipient address'))) {
    throw new Error(`${label} changed the approved recipient.`)
  }
  if (reader.int64('Payment amount') !== expected.amountAtomic) throw new Error(`${label} changed the approved amount.`)
  if (reader.int64('Payment fee') !== expected.feeAtomic) throw new Error(`${label} changed the approved fee.`)
  reader.done(label)
}

// --- live-state selectors (lying-node hardening: shape-check everything) ---

export type HomeV2AssetInfo = Readonly<{
  isDivisible: boolean
  isUnspendable: boolean
  name: string
  owner: string
}>

export function selectHomeV2AssetInfo(value: unknown, assetId: number): HomeV2AssetInfo {
  if (!isRecord(value)) throw new Error('Asset lookup answered an invalid shape.')
  const reportedId = value.assetId
  if (!Number.isSafeInteger(reportedId)) throw new Error('Asset lookup answered an invalid shape.')
  if (reportedId !== assetId) {
    throw new Error('Asset lookup answered a different asset.')
  }
  const { isDivisible, isUnspendable, name, owner } = value
  if (typeof isDivisible !== 'boolean' || typeof name !== 'string' || !name || typeof owner !== 'string' || !owner) {
    throw new Error('Asset lookup answered an invalid shape.')
  }
  if (isUnspendable !== undefined && typeof isUnspendable !== 'boolean') {
    throw new Error('Asset lookup answered an invalid shape.')
  }
  return Object.freeze({ isDivisible, isUnspendable: isUnspendable === true, name, owner })
}

export function assertHomeV2QortalAtAcceptsAsset(value: unknown, assetId: number) {
  if (!isRecord(value)) throw new Error('Qortal AT lookup answered an invalid shape.')
  if (!Number.isSafeInteger(value.assetId)) throw new Error('Qortal AT lookup answered an invalid asset.')
  if (value.isFinished !== false) throw new Error('The recipient AT is finished or unavailable for payments.')
  if (value.assetId !== assetId) throw new Error('The selected Qortal asset does not match the recipient AT.')
}

// A confirmed balance in atomic units from Core's decimal string answer.
// Fail closed on unparseable shapes: a balance the prompt cannot trust must
// not silently pass the advisory pre-check.
export function selectHomeV2AtomicBalance(value: unknown): bigint {
  const text = typeof value === 'string'
    ? value.trim()
    : typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : isRecord(value) && (typeof value.balance === 'string' || typeof value.balance === 'number')
        ? String(value.balance).trim()
        : ''
  if (!text) throw new Error('Balance lookup answered an invalid shape.')
  return parseHomeV2CoinAmount(text, 'The balance').atomic
}
