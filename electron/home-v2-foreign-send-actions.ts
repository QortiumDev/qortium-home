import { getForeignWalletMainnetChainId } from './foreign-wallet-spend-context.js'
import { foreignWalletEffectiveFeePerByte } from './foreign-wallet-policy-bounds.js'
import { normalizeForeignWalletCoin, type ForeignWalletCoin } from './foreign-wallets.js'
import { parseHomeV2CoinAmount } from './home-v2-app-actions.js'
import {
  assertHomeV2NoAppFeeOrGroup,
  homeV2MoneyField,
  HomeV2ForeignSendError,
  HOME_V2_FOREIGN_ARM_FIELDS,
  HOME_V2_RECIPIENT_FIELDS,
} from './home-v2-payment-actions.js'

/**
 * The foreign arm of `SEND_COIN` — the request grammar and the approval
 * grammar, with no I/O and no Electron.
 *
 * Home 1.x implemented foreign sending by deriving the wallet's EXTENDED
 * PRIVATE KEY from the account seed and posting it to Core's
 * `/crosschain/<coin>/send`. Home 2 never does that: it plans, signs and
 * hashes the transaction in this process and hands Core only finished bytes.
 * This module owns the two halves of that contract that are pure —
 * what an app is allowed to ask for, and exactly what the user is shown.
 *
 * UNITS ON THE WIRE (app payload):
 *  - `amount`  — a COIN DECIMAL string of up to 8 places ("0.05"), exactly
 *    as the native payment arm and Home 1.x accept it. Mutually exclusive
 *    with `sendMax: true`.
 *  - `feePerByte` — the fee rate. Two spellings are accepted because the two
 *    live producers disagree and the values can never collide:
 *      * a plain INTEGER string is ATOMIC units per byte ("12" = 12 sat/B);
 *      * a string WITH a fractional part is a COIN amount per byte
 *        ("0.00000012" = 12 sat/B), which is what `GET_FOREIGN_FEE` returns
 *        and therefore what qortium-wallet forwards.
 *    The forms cannot be confused: any fee rate a chain would ever recommend
 *    is far below one whole coin per byte, so an in-band coin-decimal rate is
 *    always "0.xxxxxxxx" while an in-band atomic rate is always an integer of
 *    at least 1. Whatever the spelling, the resolved rate must land inside
 *    [recommended, 10 x recommended] or the send refuses — a misread by a
 *    factor of 100,000,000 cannot over- or under-fee, it can only refuse.
 *  - `xprv58` — ALWAYS a hard refusal. Home signs; Core never gets a key.
 *
 * INTERNALLY everything is a bigint of atomic units. The approval prompt
 * shows both forms ("0.05000000 BTC (5000000 satoshis)") so that a scaling
 * mistake is impossible to miss, exactly as the native payment prompt does.
 */
export const HOME_V2_FOREIGN_SEND_ACTION = 'SEND_COIN'

const COIN_SCALE = 100_000_000n
const MAX_ATOMIC = 0x7fff_ffff_ffff_ffffn
const MAX_RECIPIENT_LENGTH = 128
const MAX_FEE_RATE_MULTIPLE = 10n
const FOREIGN_RECIPIENT_FIELDS = ['receivingAddress', ...HOME_V2_RECIPIENT_FIELDS] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * True when a `SEND_COIN` request is asking for a FOREIGN coin rather than
 * the native one. The same predicate splits the bridge handler and gates the
 * native Base58 journal, so one request can never be treated as foreign in
 * one place and native in the other.
 *
 * It is deliberately generous: any 1.x foreign-arm marker, or a coin selector
 * that names one of the eight supported chains, routes to the foreign arm.
 * A money field that appears twice with different values makes
 * `homeV2MoneyField` throw; that too routes here, because the foreign
 * normalizer re-runs the same read and refuses loudly rather than letting an
 * ambiguous request fall through to a native payment.
 */
export function isHomeV2ForeignSendRequest(action: string, request: unknown): boolean {
  if (action !== HOME_V2_FOREIGN_SEND_ACTION || !isRecord(request)) return false
  for (const field of HOME_V2_FOREIGN_ARM_FIELDS) {
    try {
      if (homeV2MoneyField(request, [field], field) !== undefined) return true
    } catch {
      return true
    }
  }
  let coinRaw: unknown
  try {
    coinRaw = homeV2MoneyField(request, ['coin', 'blockchain'], 'The coin selector')
  } catch {
    return true
  }
  if (coinRaw === undefined) return false
  try {
    normalizeForeignWalletCoin(coinRaw)
    return true
  } catch {
    return false
  }
}

export type HomeV2ForeignSendRequest = Readonly<{
  amountAtomic: bigint | null
  coin: ForeignWalletCoin
  feePerByteAtomic: bigint | null
  recipientAddress: string
  sendMax: boolean
}>

function normalizeCoin(request: Record<string, unknown>): ForeignWalletCoin {
  const coinRaw = homeV2MoneyField(request, ['coin', 'blockchain'], 'The coin selector')
  if (coinRaw === undefined) {
    throw new HomeV2ForeignSendError('A coin is required: name one of BTC, LTC, DOGE, DGB, RVN, DASH, NMC or FIRO.')
  }
  try {
    return normalizeForeignWalletCoin(coinRaw)
  } catch {
    throw new HomeV2ForeignSendError(
      'Qortium Home 2 can send BTC, LTC, DOGE, DGB, RVN, DASH, NMC and FIRO only; that coin is not supported.',
    )
  }
}

function normalizeSendMax(request: Record<string, unknown>): boolean {
  const raw = homeV2MoneyField(request, ['sendMax'], 'Send max')
  if (raw === undefined || raw === false) return false
  if (raw === true) return true
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase()
    if (text === 'true') return true
    if (text === 'false') return false
  }
  throw new Error('Send max must be true or false.')
}

function normalizeRecipient(request: Record<string, unknown>): string {
  const raw = homeV2MoneyField(request, FOREIGN_RECIPIENT_FIELDS, 'The recipient address')
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Recipient address is required.')
  const address = raw.trim()
  if (address.length > MAX_RECIPIENT_LENGTH || /[\u0000-\u001f\u007f]/.test(address)) {
    throw new Error('The recipient address is invalid.')
  }
  return address
}

/**
 * The fee rate as atomic units per byte. See the module header for why both
 * an integer (atomic) and a fractional (coin) spelling are admitted, and why
 * they cannot collide.
 */
function normalizeFeePerByte(request: Record<string, unknown>): bigint | null {
  const raw = homeV2MoneyField(request, ['feePerByte'], 'The fee rate')
  if (raw === undefined) return null
  const text = typeof raw === 'string'
    ? raw.trim()
    : typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0
      ? String(raw)
      : typeof raw === 'bigint' && raw >= 0n
        ? raw.toString()
        : ''
  if (/^(?:0|[1-9][0-9]*)$/.test(text)) {
    const atomic = BigInt(text)
    if (atomic <= 0n || atomic > MAX_ATOMIC) throw new Error('The fee rate must be greater than zero.')
    return atomic
  }
  if (/^(?:0|[1-9][0-9]*)\.[0-9]{1,8}$/.test(text)) {
    const atomic = parseHomeV2CoinAmount(text, 'The fee rate').atomic
    if (atomic <= 0n) throw new Error('The fee rate must be greater than zero.')
    return atomic
  }
  throw new Error('The fee rate must be atomic units per byte, or a coin amount per byte with up to 8 decimals.')
}

export function normalizeHomeV2ForeignSendRequest(request: Record<string, unknown>): HomeV2ForeignSendRequest {
  // The 1.x escape hatch, refused first and by name: an app that hands Home a
  // wallet's extended PRIVATE key is asking for the exact custody model this
  // arm exists to remove.
  if (homeV2MoneyField(request, ['xprv58'], 'xprv58') !== undefined) {
    throw new Error('Qortium Home signs foreign sends itself and never accepts an extended private key (xprv58).')
  }
  const coin = normalizeCoin(request)
  assertHomeV2NoAppFeeOrGroup(request)
  const recipientAddress = normalizeRecipient(request)
  const sendMax = normalizeSendMax(request)
  const amountRaw = homeV2MoneyField(request, ['amount'], 'The amount')
  if (sendMax && amountRaw !== undefined) {
    throw new Error('Send max sends the whole spendable balance; do not also give an amount.')
  }
  if (!sendMax && amountRaw === undefined) {
    throw new Error('An amount is required, or set sendMax to true.')
  }
  let amountAtomic: bigint | null = null
  if (!sendMax) {
    amountAtomic = parseHomeV2CoinAmount(amountRaw, 'The amount').atomic
    if (amountAtomic <= 0n) throw new Error('The amount must be greater than zero.')
  }
  return Object.freeze({
    amountAtomic,
    coin,
    feePerByteAtomic: normalizeFeePerByte(request),
    recipientAddress,
    sendMax,
  })
}

/**
 * The authoritative rate is Core's spend-context `recommendedFeePerByte`. An
 * app may raise it, up to ten times, and may never lower it: a rate under the
 * recommendation produces a transaction the foreign network will not relay,
 * and an unbounded rate is a way to burn a wallet through a fee.
 */
export function resolveHomeV2ForeignSendFeePerByte(requestedAtomic: bigint | null, recommendedAtomic: bigint): bigint {
  if (typeof recommendedAtomic !== 'bigint' || recommendedAtomic <= 0n) {
    throw new Error('The node did not report a usable recommended fee rate.')
  }
  if (requestedAtomic === null) return recommendedAtomic
  const ceiling = recommendedAtomic * MAX_FEE_RATE_MULTIPLE
  if (requestedAtomic < recommendedAtomic || requestedAtomic > ceiling) {
    throw new Error(
      `The requested fee rate of ${requestedAtomic} atomic units per byte is outside the accepted range of `
      + `${recommendedAtomic} to ${ceiling} (the node recommends ${recommendedAtomic}).`,
    )
  }
  return requestedAtomic
}

export function homeV2ForeignSendOperationLabel(coin: string) {
  return `Send ${coin}`
}

/** Atomic units as the 8-place coin decimal every foreign chain here uses. */
export function homeV2ForeignAtomicToDecimal(atomic: bigint) {
  if (typeof atomic !== 'bigint' || atomic < 0n) throw new Error('Invalid foreign coin amount.')
  const whole = atomic / COIN_SCALE
  const fraction = atomic % COIN_SCALE
  return `${whole}.${fraction.toString().padStart(8, '0')}`
}

/**
 * Both forms on one row, mirroring `homeV2AtomicUnitsText`: the decimal is
 * what a person reads, the atomic count is what is actually signed.
 */
export function homeV2ForeignAmountText(atomic: bigint, coin: string) {
  return `${homeV2ForeignAtomicToDecimal(atomic)} ${coin} (${atomic} satoshis)`
}

export const FOREIGN_SEND_DETAIL_SEQUENCE = Object.freeze([
  { label: 'You send' },
  { label: 'Paid to' },
  { label: 'Coin' },
  { label: 'Chain' },
  { label: 'Send max', optional: true },
  { label: 'Network fee' },
  { label: 'Fee rate' },
  { label: 'Change back to you', optional: true },
  { label: 'Inputs spent' },
  { label: 'Total debited' },
] as const) as readonly { readonly label: string; readonly optional?: true }[]

export type HomeV2ForeignSendApprovalPlan = Readonly<{
  amount: bigint
  change: bigint
  changeAddress: string | null
  estimatedMaximumSize: number
  fee: bigint
  feePerByte: bigint
  inputAmount: bigint
  inputs: readonly unknown[]
  recipientAddress: string
  sendMax: boolean
}>

/**
 * The rows the user approves. The sequence is pinned here and re-validated in
 * the shell, so a prompt whose rows do not match this exact grammar is thrown
 * away before it is ever rendered.
 */
export function buildHomeV2ForeignSendApprovalRows(
  plan: HomeV2ForeignSendApprovalPlan,
  context: Readonly<{ chainId: string; coin: string }>,
): readonly { readonly label: string; readonly value: string }[] {
  const { coin } = context
  const effective = foreignWalletEffectiveFeePerByte(plan.fee, plan.estimatedMaximumSize)
  return Object.freeze([
    { label: 'You send', value: homeV2ForeignAmountText(plan.amount, coin) },
    { label: 'Paid to', value: plan.recipientAddress },
    { label: 'Coin', value: coin },
    { label: 'Chain', value: context.chainId },
    ...(plan.sendMax
      ? [{
          label: 'Send max',
          value: 'Yes — every confirmed output in this wallet is spent, minus the network fee',
        }]
      : []),
    { label: 'Network fee', value: homeV2ForeignAmountText(plan.fee, coin) },
    // Both rates, because they can differ: change too small to be spendable
    // is absorbed into the fee rather than returned, and the EFFECTIVE rate is
    // the only place that shows up before the transaction is signed.
    {
      label: 'Fee rate',
      value: effective > plan.feePerByte
        ? `${plan.feePerByte} satoshis per byte quoted, ${effective} effective across the `
          + `${plan.estimatedMaximumSize}-byte transaction (change too small to return was added to the fee)`
        : `${plan.feePerByte} satoshis per byte across the ${plan.estimatedMaximumSize}-byte transaction`,
    },
    ...(plan.changeAddress
      ? [{
          label: 'Change back to you',
          value: `${homeV2ForeignAmountText(plan.change, coin)} returned to ${plan.changeAddress}`
            + ' — an address this wallet is already spending from',
        }]
      : []),
    {
      label: 'Inputs spent',
      value: `${plan.inputs.length} confirmed output${plan.inputs.length === 1 ? '' : 's'} worth `
        + homeV2ForeignAmountText(plan.inputAmount, coin),
    },
    { label: 'Total debited', value: homeV2ForeignAmountText(plan.amount + plan.fee, coin) },
  ].map((row) => Object.freeze(row)))
}

/**
 * The grant target. It carries the exact spend intent, and it is a namespace
 * of its own: a foreign send must never dedupe against, or be satisfied by,
 * a native payment approval.
 */
export function homeV2ForeignSendApprovalTarget(input: Readonly<{
  amountAtomic: bigint | null
  chainId: string
  coin: string
  recipient: string
}>) {
  const amount = input.amountAtomic === null ? 'max' : input.amountAtomic.toString()
  return `foreign-send:${input.coin}:${input.chainId}:${input.recipient}:${amount}`
}

export function homeV2ForeignSendChainId(coin: ForeignWalletCoin) {
  return getForeignWalletMainnetChainId(coin)
}
