import { parseArrrWalletSession, type ArrrWalletSession, type ArrrWalletSessionRequest } from './arrr-wallet-session.js'
// Home 2 desktop ARRR (Pirate Chain) custody READ adapter — the pure half.
//
// ARRR is deliberately NOT a member of the eight-coin bitcoiny HD/xpub/signing
// machinery in foreign-wallets.ts. Core's Pirate Chain routes take the
// wallet's 32-byte ENTROPY (Base58) in the request body — spend authority, not
// watch material — and Core keeps a synced copy of the wallet. Home therefore
// models ARRR as its own runtime kind with NO public key, NO xpub and NO
// address derived locally: the receive address comes back from the trusted
// Core, and the only secret Home ever handles is the entropy it derives for
// one request at a time.
//
// Pure module: no Electron/Node/DOM imports beyond the Base58 codec, so the
// derivation, request builder, response classifier and sync-snapshot parser
// are testable with plain node:test and mockable fetches. The privileged
// half (seed access, admin trust, consent, transport) lives in
// home-v2-app-bridge.ts and is the ONLY caller of withArrrEntropy58.

import { BASE58_ALPHABET } from './base58.js'

/**
 * Base58 for the entropy, with an OWNED digit buffer that is wiped. The
 * shared codec (base58.ts) keeps its digits in a plain number[] that outlives
 * the call; for a spending key every mutable intermediate is zeroed, so the
 * encoder here works in a Uint8Array and fills it in `finally`. Output is
 * byte-identical to base58Encode.
 */
export function base58ScratchLength(byteLength: number) {
  // ceil(len * log(256)/log(58)) < len * 1.37; plus leading-zero digits.
  return byteLength * 2 + 1
}

export function base58EncodeOwned(
  bytes: Uint8Array,
  // The digit buffer. Callers pass their own to OBSERVE the wipe; it must be
  // at least base58ScratchLength(bytes.length) long.
  digits: Uint8Array = new Uint8Array(base58ScratchLength(bytes.length)),
) {
  if (bytes.length === 0) return ''
  if (digits.length < base58ScratchLength(bytes.length)) throw new Error('Base58 scratch buffer is too small.')
  digits.fill(0)
  let length = 1
  try {
    for (const byte of bytes) {
      let carry = byte
      for (let index = 0; index < length; index += 1) {
        carry += digits[index] * 256
        digits[index] = carry % 58
        carry = (carry / 58) | 0
      }
      while (carry > 0) {
        digits[length] = carry % 58
        length += 1
        carry = (carry / 58) | 0
      }
    }
    for (let index = 0; bytes[index] === 0 && index < bytes.length - 1; index += 1) {
      digits[length] = 0
      length += 1
    }
    let out = ''
    for (let index = length - 1; index >= 0; index -= 1) out += BASE58_ALPHABET[digits[index]]
    return out
  } finally {
    digits.fill(0)
  }
}

export const ARRR_CUSTODY_CONTRACT = 'qortium-home-arrr-custody-v1' as const
export const ARRR_CUSTODY_COIN = 'ARRR' as const

/**
 * The ARRR runtime kind. Discriminated from the bitcoiny public runtime
 * (`ForeignWalletPublicRuntime`, which carries address/publicKey/xpub58) by
 * `kind`, and it carries no key material of any kind: the entropy is derived
 * inside `withArrrEntropy58` for the duration of one callback and never
 * stored on an object.
 */
export type ArrrCustodyRuntime = Readonly<{
  kind: 'arrr-custody'
  coin: typeof ARRR_CUSTODY_COIN
  contract: typeof ARRR_CUSTODY_CONTRACT
}>

export const ARRR_CUSTODY_RUNTIME: ArrrCustodyRuntime = Object.freeze({
  coin: ARRR_CUSTODY_COIN,
  contract: ARRR_CUSTODY_CONTRACT,
  kind: 'arrr-custody',
})

export const HOME_V2_ARRR_SYNC_STATUS_ACTION = 'GET_ARRR_SYNC_STATUS' as const

/** The four bridge actions the ARRR custody consent covers. */
export const HOME_V2_ARRR_CUSTODY_READ_ACTIONS = Object.freeze([
  'GET_USER_WALLET',
  'GET_WALLET_BALANCE',
  'GET_USER_WALLET_TRANSACTIONS',
  HOME_V2_ARRR_SYNC_STATUS_ACTION,
  'GET_ARRR_WALLET_SESSION',
] as const)

export type HomeV2ArrrCustodyReadAction = typeof HOME_V2_ARRR_CUSTODY_READ_ACTIONS[number]

const ARRR_CUSTODY_READ_ACTION_SET = new Set<string>(HOME_V2_ARRR_CUSTODY_READ_ACTIONS)

export function isHomeV2ArrrCustodyReadAction(action: string): action is HomeV2ArrrCustodyReadAction {
  return ARRR_CUSTODY_READ_ACTION_SET.has(action)
}

/** Error codes surfaced to apps through createHomeV2BridgeError. */
export const ARRR_WALLET_BUSY_CODE = 'ARRR_WALLET_BUSY' as const
export const ARRR_VERIFIED_BALANCE_UNAVAILABLE_CODE = 'ARRR_VERIFIED_BALANCE_UNAVAILABLE' as const
export const ARRR_SYNC_CONTRACT_UNSUPPORTED_CODE = 'ARRR_SYNC_CONTRACT_UNSUPPORTED' as const
export const ARRR_READ_SUPERSEDED_CODE = 'ARRR_READ_SUPERSEDED' as const
export const ARRR_CUSTODY_BACKEND_UNAVAILABLE_CODE = 'FOREIGN_WALLET_BACKEND_UNAVAILABLE' as const

export const ARRR_WALLET_BUSY_MESSAGE = 'Your Core is busy with another ARRR wallet; try again shortly.'

/** Why Android reports ARRR custody unavailable (capability rows and refusals). */
export const HOME_V2_ARRR_ANDROID_UNAVAILABLE_REASON =
  'ARRR wallet custody is only available in Qortium Home desktop: the ARRR spending key is derived only inside Home’s privileged desktop process.'
export const HOME_V2_ARRR_UNTRUSTED_ROUTE_REASON =
  'ARRR wallet custody needs a Qortium Core you administer: the local Core Home runs, or a custom HTTPS node with your API key attached.'
export const HOME_V2_ARRR_LOCKED_ACCOUNT_REASON =
  'ARRR wallet custody needs the selected account to be unlocked.'

/** The stable reason Core embeds in its 409 OPERATION_IN_PROGRESS message. */
const ARRR_WALLET_BUSY_MARKER = 'ARRR_WALLET_BUSY'
const CORE_OPERATION_IN_PROGRESS = 9
const CORE_FOREIGN_BLOCKCHAIN_NETWORK_ISSUE = 1201
// Core's typed "verified balance is unknown" error. Its ApiError name is
// being added on the Core side in parallel; the classifier keys on the
// stable substring both candidate names share so the two halves cannot drift
// on a number that has not been assigned yet.
const ARRR_VERIFIED_BALANCE_UNAVAILABLE_MARKER = 'BALANCE_UNAVAILABLE'

export type ArrrCustodyError = Error & {
  readonly code: string
  readonly retryable: boolean
  readonly status?: number
}

function custodyError(message: string, code: string, retryable: boolean, status?: number): ArrrCustodyError {
  return Object.assign(new Error(message), {
    code,
    retryable,
    ...(typeof status === 'number' ? { status } : {}),
  })
}

export function isArrrCustodyError(error: unknown, code?: string): error is ArrrCustodyError {
  if (!(error instanceof Error)) return false
  const candidate = error as { code?: unknown; retryable?: unknown }
  return typeof candidate.code === 'string' &&
    typeof candidate.retryable === 'boolean' &&
    (code === undefined || candidate.code === code)
}

// ---------------------------------------------------------------------------
// Coin

const ARRR_COIN_ALIASES = new Set(['ARRR', 'PIRATE', 'PIRATECHAIN', 'PIRATE CHAIN', 'PIRATE_CHAIN'])

export function isArrrCustodyCoin(value: unknown): boolean {
  return typeof value === 'string' && ARRR_COIN_ALIASES.has(value.trim().toUpperCase())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function requestedCoin(request: Record<string, unknown>) {
  const payload = isRecord(request.payload) ? request.payload : request
  return payload.coin ?? payload.blockchain ?? request.coin ?? request.blockchain
}

/**
 * Whether a bridge request is an ARRR custody read: one of the four actions
 * with `coin`/`blockchain` naming Pirate Chain. GET_ARRR_SYNC_STATUS defaults
 * an omitted coin to ARRR (it can mean nothing else) and refuses any other
 * coin outright rather than answering for a chain it does not describe.
 */
export function isHomeV2ArrrCustodyRequest(action: string, request: Record<string, unknown>): boolean {
  if (!isHomeV2ArrrCustodyReadAction(action)) return false
  const coin = requestedCoin(request)
  if (action === HOME_V2_ARRR_SYNC_STATUS_ACTION || action === 'GET_ARRR_WALLET_SESSION') {
    if (coin === undefined || coin === null || (typeof coin === 'string' && coin.trim() === '')) return true
    if (!isArrrCustodyCoin(coin)) throw new Error('GET_ARRR_SYNC_STATUS describes the ARRR wallet only.')
    return true
  }
  return isArrrCustodyCoin(coin)
}

/**
 * GET_WALLET_BALANCE's `verified` selector. Home asks Core for the VERIFIED
 * (spendable) balance unless the app explicitly passes `verified: false`,
 * in which case the TOTAL balance is returned. Anything else is refused: a
 * balance answered under the wrong semantics is worse than no answer.
 */
export function homeV2ArrrBalanceVerified(request: Record<string, unknown>): boolean {
  const payload = isRecord(request.payload) ? request.payload : request
  const value = payload.verified ?? request.verified
  if (value === undefined || value === null || value === true) return true
  if (value === false) return false
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '') return true
    if (normalized === 'false') return false
  }
  throw new Error('GET_WALLET_BALANCE verified must be true or false.')
}

// ---------------------------------------------------------------------------
// Entropy derivation (Hub-compatible)

export type ArrrCustodyCrypto = Readonly<{
  sha256: (data: Uint8Array) => Uint8Array
  sha512: (data: Uint8Array) => Uint8Array
}>

const ARRR_INDICATOR = new TextEncoder().encode('ARRR')

function uint32BigEndian(value: number) {
  return Uint8Array.from([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff])
}

function concatBytes(first: Uint8Array, second: Uint8Array, third?: Uint8Array) {
  const out = new Uint8Array(first.byteLength + second.byteLength + (third?.byteLength ?? 0))
  out.set(first, 0)
  out.set(second, first.byteLength)
  if (third) out.set(third, first.byteLength + second.byteLength)
  return out
}

/**
 * Derive the Hub-compatible ARRR wallet entropy for one account and hand it
 * to `use` for the duration of that callback only.
 *
 * For root seed bytes S, account index n and wallet version v (verified
 * against Qortal-Hub src/utils/generateWallet/phrase-wallet.ts genAddress and
 * src/encryption/AltcoinHDWallet.ts generateSeedHash/generatePrivateKey):
 *
 *   N = uint32 big-endian(n)
 *   M = N ‖ S ‖ N
 *   A = S                                   (v == 1: Hub assigns the byte seed
 *                                            itself, whole — never truncated)
 *   A = SHA512(SHA512(M) ‖ M)[0:32]          (otherwise)
 *   R = reverse(copy(A))                    (Hub's seed.reverse() mutates its
 *                                            copy, so BOTH hash stages see R)
 *   entropy58 = Base58( SHA512( R ‖ SHA256( R ‖ UTF8("ARRR") ) )[0:32] )
 *
 * Base58 encodes the raw first 32 hash bytes — Hub's `seed58` — BEFORE any
 * secp256k1 normalization: no checksum, no BIP32 derivation, no xprv.
 *
 * Every intermediate buffer (owned seed copy, M, both SHA-512 outputs, A, R,
 * the indicator material, the SHA-256, the final material, the 32-byte
 * entropy) is zeroed in `finally`. The Base58 STRING cannot be zeroed —
 * JavaScript strings are immutable and their backing memory is reclaimed only
 * by the garbage collector — so callers must keep its lifetime minimal: use
 * it for one request body and drop every reference. It is never returned,
 * stored on an object, logged, sent over IPC or persisted.
 */
export function withArrrEntropy58<T>(
  input: Readonly<{
    crypto: ArrrCustodyCrypto
    nonce: number
    seed: Uint8Array
    walletVersion: number
  }>,
  use: (entropy58: string) => T,
): T {
  if (!Number.isSafeInteger(input.nonce) || input.nonce < 0 || input.nonce > 0xffffffff) {
    throw new Error('Invalid ARRR account index.')
  }
  if (!Number.isSafeInteger(input.walletVersion) || input.walletVersion < 1) {
    throw new Error('Invalid ARRR wallet version.')
  }
  if (!(input.seed instanceof Uint8Array) || input.seed.byteLength === 0) {
    throw new Error('Invalid ARRR wallet seed.')
  }

  let seed: Uint8Array | undefined
  let nonceBytes: Uint8Array | undefined
  let material: Uint8Array | undefined
  let firstHash: Uint8Array | undefined
  let secondMaterial: Uint8Array | undefined
  let secondHash: Uint8Array | undefined
  let accountSeed: Uint8Array | undefined
  let reversed: Uint8Array | undefined
  let indicatorMaterial: Uint8Array | undefined
  let reverseHash: Uint8Array | undefined
  let finalMaterial: Uint8Array | undefined
  let seedHash: Uint8Array | undefined
  let entropy: Uint8Array | undefined

  try {
    seed = Uint8Array.from(input.seed)
    if (input.walletVersion === 1) {
      // Hub: `addrSeed = this._byteSeed` — the whole seed, whatever its length.
      accountSeed = Uint8Array.from(seed)
    } else {
      nonceBytes = uint32BigEndian(input.nonce)
      material = concatBytes(nonceBytes, seed, nonceBytes)
      firstHash = input.crypto.sha512(material)
      secondMaterial = concatBytes(firstHash, material)
      secondHash = input.crypto.sha512(secondMaterial)
      accountSeed = secondHash.slice(0, 32)
    }
    reversed = Uint8Array.from(accountSeed).reverse()
    indicatorMaterial = concatBytes(reversed, ARRR_INDICATOR)
    reverseHash = input.crypto.sha256(indicatorMaterial)
    finalMaterial = concatBytes(reversed, reverseHash)
    seedHash = input.crypto.sha512(finalMaterial)
    entropy = seedHash.slice(0, 32)
    return use(base58EncodeOwned(entropy))
  } finally {
    seed?.fill(0)
    nonceBytes?.fill(0)
    material?.fill(0)
    firstHash?.fill(0)
    secondMaterial?.fill(0)
    secondHash?.fill(0)
    accountSeed?.fill(0)
    reversed?.fill(0)
    indicatorMaterial?.fill(0)
    reverseHash?.fill(0)
    finalMaterial?.fill(0)
    seedHash?.fill(0)
    entropy?.fill(0)
  }
}

// ---------------------------------------------------------------------------
// Requests

export type ArrrCustodyReadEndpoint = 'walletaddress' | 'walletbalance' | 'wallettransactions' | 'syncstatus' | 'walletsession'

export type ArrrCustodyReadRequest = Readonly<{
  body: string
  contentType: 'text/plain' | 'application/json'
  method: 'POST'
  pathname: string
}>

export function arrrCustodyEndpointForAction(action: HomeV2ArrrCustodyReadAction): ArrrCustodyReadEndpoint {
  switch (action) {
    case 'GET_USER_WALLET': return 'walletaddress'
    case 'GET_WALLET_BALANCE': return 'walletbalance'
    case 'GET_USER_WALLET_TRANSACTIONS': return 'wallettransactions'
    case HOME_V2_ARRR_SYNC_STATUS_ACTION: return 'syncstatus'
    case 'GET_ARRR_WALLET_SESSION': return 'walletsession'
  }
}

/**
 * Every ARRR read is an authenticated POST with the Base58 entropy as a
 * `text/plain` body. The two query selectors are fixed strings: the verified
 * flag on the balance and `json=true` on the status (the legacy text status
 * is never requested).
 */
export function buildArrrCustodyReadRequest(
  endpoint: ArrrCustodyReadEndpoint,
  entropy58: string,
  options: Readonly<{ verified?: boolean }> = {},
): ArrrCustodyReadRequest {
  if (typeof entropy58 !== 'string' || entropy58.length === 0) {
    throw new Error('ARRR entropy is required.')
  }
  const suffix = endpoint === 'walletbalance'
    ? `?verified=${options.verified === false ? 'false' : 'true'}`
    : endpoint === 'syncstatus'
      ? '?json=true'
      : ''
  return Object.freeze({
    body: entropy58,
    contentType: 'text/plain',
    method: 'POST',
    pathname: `/crosschain/arrr/${endpoint}${suffix}`,
  })
}

// ---------------------------------------------------------------------------
// Responses

export type ArrrCustodyResponse = Readonly<{
  /** The raw decoded body — the atomic balance and address come from here. */
  body: string
  /** The parsed JSON body when Core answered JSON, else the raw body. */
  data: unknown
  ok: boolean
  status: number
}>

function coreErrorOf(response: ArrrCustodyResponse) {
  const data = response.data
  if (!isRecord(data)) return null
  return {
    code: typeof data.error === 'number' ? data.error : null,
    message: typeof data.message === 'string' ? data.message : '',
  }
}

/**
 * Turn a non-2xx Core answer into a typed error. Never includes the response
 * body in the message: Core's free-text messages are node-controlled and this
 * is a spend-authority route, so the app gets a code and Home's own wording.
 */
export function classifyArrrCustodyFailure(response: ArrrCustodyResponse, endpoint: ArrrCustodyReadEndpoint): ArrrCustodyError {
  const coreError = coreErrorOf(response)
  if (coreError?.message.includes('ARRR_SESSION_CHANGED')) return custodyError('The active ARRR wallet changed. Refresh status and confirm again.', 'ARRR_SESSION_CHANGED', false, response.status)
  if (coreError?.message.includes('ARRR_WALLET_NOT_ACTIVE')) return custodyError('This account is not the active ARRR wallet on your Core. Switch accounts explicitly to sync it.', 'ARRR_WALLET_NOT_ACTIVE', false, response.status)
  if (
    response.status === 409 ||
    coreError?.code === CORE_OPERATION_IN_PROGRESS ||
    (coreError?.message.includes(ARRR_WALLET_BUSY_MARKER) ?? false)
  ) {
    return custodyError(ARRR_WALLET_BUSY_MESSAGE, ARRR_WALLET_BUSY_CODE, true, response.status)
  }
  if (
    endpoint === 'walletbalance' &&
    coreError !== null &&
    coreError.message.toUpperCase().includes(ARRR_VERIFIED_BALANCE_UNAVAILABLE_MARKER)
  ) {
    return custodyError(
      'The verified ARRR balance is not known yet. Read GET_ARRR_SYNC_STATUS for the synchronization state, or request the total balance with verified: false.',
      ARRR_VERIFIED_BALANCE_UNAVAILABLE_CODE,
      true,
      response.status,
    )
  }
  if (coreError?.code === CORE_FOREIGN_BLOCKCHAIN_NETWORK_ISSUE) {
    return custodyError(
      'ARRR wallet backend is unavailable. Qortium Core could not reach a Pirate Chain light-wallet server or the wallet is not ready.',
      ARRR_CUSTODY_BACKEND_UNAVAILABLE_CODE,
      true,
      response.status,
    )
  }
  return custodyError(
    `ARRR ${endpoint} request returned HTTP ${response.status}.`,
    'ARRR_CUSTODY_READ_FAILED',
    response.status >= 500,
    response.status,
  )
}

const ARRR_SAPLING_ADDRESS = /^zs1[02-9ac-hj-np-z]{6,}$/

export function normalizeArrrAddress(value: unknown) {
  const address = typeof value === 'string' ? value.trim() : ''
  if (!ARRR_SAPLING_ADDRESS.test(address) || address.length > 128) {
    throw new Error('Qortium Core returned an invalid ARRR address.')
  }
  return address
}

const ATOMIC_DECIMAL = /^\d{1,30}$/

export function normalizeArrrAtomicAmount(value: unknown) {
  const text = typeof value === 'string'
    ? value.trim()
    : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? String(value)
      : ''
  if (!ATOMIC_DECIMAL.test(text)) {
    throw new Error('Qortium Core returned an invalid ARRR balance.')
  }
  return text
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function isUnsafeObjectKey(key: string) {
  return UNSAFE_KEYS.has(key)
}

/** True when any object anywhere in `value` has a `__proto__`/`constructor`/`prototype` own key. */
export function containsUnsafeObjectKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsUnsafeObjectKeys)
  if (!isRecord(value)) return false
  return Object.keys(value).some((key) => isUnsafeObjectKey(key) || containsUnsafeObjectKeys(value[key]))
}

/**
 * Replace every occurrence of the entropy in a value Home is about to hand
 * back — in property NAMES as well as values. Core never echoes it today; this
 * is the belt to the "never expose" braces, so a future Core message that
 * quoted the request body could not cross into an app or an error text.
 * Rebuilt objects are fresh literals that never receive `__proto__`,
 * `constructor` or `prototype` keys.
 */
export function scrubArrrEntropy<T>(value: T, entropy58: string): T {
  if (!entropy58) return value
  const redact = (text: string) => text.includes(entropy58) ? text.split(entropy58).join('[redacted]') : text
  // Untouched subtrees are returned as-is (frozen results stay frozen); a
  // replaced subtree is rebuilt and frozen when its original was.
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return redact(node)
    if (Array.isArray(node)) {
      const next = node.map(walk)
      if (next.every((child, index) => child === node[index])) return node
      return Object.isFrozen(node) ? Object.freeze(next) : next
    }
    if (isRecord(node)) {
      let changed = false
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(node)) {
        if (isUnsafeObjectKey(key)) { changed = true; continue }
        const child = node[key]
        const next = walk(child)
        const nextKey = redact(key)
        if (next !== child || nextKey !== key) changed = true
        Object.defineProperty(out, nextKey, { configurable: true, enumerable: true, value: next, writable: true })
      }
      if (!changed) return node
      return Object.isFrozen(node) ? Object.freeze(out) : out
    }
    return node
  }
  return walk(value) as T
}

// ---------------------------------------------------------------------------
// Sync snapshot

export const ARRR_SYNC_STATES = Object.freeze(['DISABLED', 'LOADING', 'SYNCHRONIZING', 'DEGRADED', 'READY'] as const)
export type ArrrSyncState = typeof ARRR_SYNC_STATES[number]

export type ArrrSyncSnapshot = Readonly<{
  contract: typeof ARRR_CUSTODY_CONTRACT
  coin: typeof ARRR_CUSTODY_COIN
  state: ArrrSyncState
  /**
   * Home's readiness verdict: READY reported by Core AND not stale AND no
   * restart pending. A cached or stale READY cannot establish readiness, so
   * apps gate balances on this field, not on `state` alone.
   */
  ready: boolean
  message: string
  syncedBlocks: number | null
  totalBlocks: number | null
  restartRequired: boolean
  recoveryState: string | null
  scannedHeight: number | null
  tipHeight: number | null
  totalBalanceAtomic: string | null
  verifiedBalanceAtomic: string | null
  observedAt: number | null
  stale: boolean
  backendMode: string | null
  walletIdentityHash: string | null
  lastError: Readonly<{ code: string; message: string }> | null
}>

function malformed(field: string): never {
  throw custodyError(`Qortium Core returned a malformed ARRR sync status (${field}).`, 'ARRR_SYNC_STATUS_MALFORMED', false)
}

function nullableCount(value: unknown, field: string) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  return malformed(field)
}

function nullableAtomic(value: unknown, field: string) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && ATOMIC_DECIMAL.test(value.trim())) return value.trim()
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
  return malformed(field)
}

function nullableText(value: unknown, field: string, maxLength = 512) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return malformed(field)
  const text = value.trim()
  return text.length === 0 ? null : text.slice(0, maxLength)
}

/**
 * Validate Core's `syncstatus?json=true` answer into a frozen snapshot.
 *
 * Strict on the fields the structured contract defines — an unknown state,
 * a negative counter, a non-decimal balance or a non-object lastError is an
 * error, never a guess. A Core that predates the structured contract answers
 * without `stale`; that is reported with ARRR_SYNC_CONTRACT_UNSUPPORTED so
 * the app can tell "old Core" from "malformed".
 */
export function parseArrrSyncSnapshot(data: unknown): ArrrSyncSnapshot {
  if (!isRecord(data)) return malformed('body')
  const state = typeof data.state === 'string' ? data.state.trim().toUpperCase() : ''
  if (!(ARRR_SYNC_STATES as readonly string[]).includes(state)) return malformed('state')
  if (typeof data.stale !== 'boolean') {
    throw custodyError(
      'Your Qortium Core does not implement the structured ARRR sync contract yet. Upgrade Core to read ARRR balances.',
      ARRR_SYNC_CONTRACT_UNSUPPORTED_CODE,
      false,
    )
  }
  if (data.message !== undefined && data.message !== null && typeof data.message !== 'string') return malformed('message')
  if (data.restartRequired !== undefined && data.restartRequired !== null && typeof data.restartRequired !== 'boolean') {
    return malformed('restartRequired')
  }
  let observedAt: number | null = null
  if (data.observedAt !== undefined && data.observedAt !== null) {
    if (typeof data.observedAt !== 'number' || !Number.isFinite(data.observedAt) || data.observedAt < 0) {
      return malformed('observedAt')
    }
    observedAt = Math.floor(data.observedAt)
  }
  let lastError: ArrrSyncSnapshot['lastError'] = null
  if (data.lastError !== undefined && data.lastError !== null) {
    if (!isRecord(data.lastError) || typeof data.lastError.code !== 'string' || typeof data.lastError.message !== 'string') {
      return malformed('lastError')
    }
    lastError = Object.freeze({
      code: data.lastError.code.trim().slice(0, 128),
      message: data.lastError.message.trim().slice(0, 512),
    })
  }
  const restartRequired = data.restartRequired === true
  const stale = data.stale
  return Object.freeze({
    backendMode: nullableText(data.backendMode, 'backendMode', 32),
    coin: ARRR_CUSTODY_COIN,
    contract: ARRR_CUSTODY_CONTRACT,
    lastError,
    message: typeof data.message === 'string' ? data.message.trim().slice(0, 512) : '',
    observedAt,
    ready: state === 'READY' && !stale && !restartRequired,
    recoveryState: nullableText(data.recoveryState, 'recoveryState', 64),
    restartRequired,
    scannedHeight: nullableCount(data.scannedHeight, 'scannedHeight'),
    stale,
    state: state as ArrrSyncState,
    syncedBlocks: nullableCount(data.syncedBlocks, 'syncedBlocks'),
    tipHeight: nullableCount(data.tipHeight, 'tipHeight'),
    totalBalanceAtomic: nullableAtomic(data.totalBalanceAtomic, 'totalBalanceAtomic'),
    totalBlocks: nullableCount(data.totalBlocks, 'totalBlocks'),
    verifiedBalanceAtomic: nullableAtomic(data.verifiedBalanceAtomic, 'verifiedBalanceAtomic'),
    walletIdentityHash: nullableText(data.walletIdentityHash, 'walletIdentityHash', 128),
  })
}

// ---------------------------------------------------------------------------
// Result projection

/** Core's SimpleTransaction, projected field by field. */
export type ArrrTransactionParty = Readonly<{ address: string; addressInWallet: boolean; amount: number }>
export type ArrrTransaction = Readonly<{
  feeAmount: number | null
  inputs: readonly ArrrTransactionParty[]
  memo: string | null
  outputs: readonly ArrrTransactionParty[]
  timestamp: number | null
  totalAmount: number | null
  totalAmountEstimate?: number | null
  feeAmountEstimate?: number | null
  metadataComplete?: boolean
  pending?: boolean
  txHash: string
}>

const ARRR_TX_LIST_MAX = 10_000
const ARRR_TX_PARTIES_MAX = 1_000
const ARRR_TX_TEXT_MAX = 1_024

function invalidTransactions(): never {
  throw new Error('Qortium Core returned an invalid ARRR transaction list.')
}

function assertSafeKeys(record: Record<string, unknown>) {
  for (const key of Object.keys(record)) if (isUnsafeObjectKey(key)) invalidTransactions()
}

function txText(value: unknown, required: boolean) {
  if (value === null || value === undefined) return required ? invalidTransactions() : null
  if (typeof value !== 'string') return invalidTransactions()
  return value.slice(0, ARRR_TX_TEXT_MAX)
}

function txAmount(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value)) return invalidTransactions()
  return value
}

function txParties(value: unknown): readonly ArrrTransactionParty[] {
  if (value === null || value === undefined) return Object.freeze([])
  if (!Array.isArray(value) || value.length > ARRR_TX_PARTIES_MAX) return invalidTransactions()
  return Object.freeze(value.map((party) => {
    if (!isRecord(party)) return invalidTransactions()
    assertSafeKeys(party)
    return Object.freeze({
      address: txText(party.address, true) as string,
      addressInWallet: party.addressInWallet === true,
      amount: txAmount(party.amount),
    })
  }))
}

/**
 * Project Core's `SimpleTransaction[]` into a fixed whitelist of fields.
 * Nothing node-controlled is passed through by name: an unknown key is
 * dropped, an unsafe key (`__proto__`, `constructor`, `prototype`) fails the
 * whole list, and every string is bounded. Fresh literals only.
 */
export function projectArrrTransactions(data: unknown): readonly ArrrTransaction[] {
  if (!Array.isArray(data) || data.length > ARRR_TX_LIST_MAX) return invalidTransactions()
  return Object.freeze(data.map((entry) => {
    if (!isRecord(entry)) return invalidTransactions()
    assertSafeKeys(entry)
    let timestamp: number | null = null
    if (entry.timestamp !== null && entry.timestamp !== undefined) {
      if (typeof entry.timestamp !== 'number' || !Number.isFinite(entry.timestamp)) return invalidTransactions()
      timestamp = Math.floor(entry.timestamp)
    }
    const partial = typeof entry.metadataComplete === 'boolean'
    if (entry.metadataComplete !== undefined && !partial) invalidTransactions()
    if (partial && typeof entry.pending !== 'boolean') invalidTransactions()
    const nullableAmount = (value: unknown) => value === null || value === undefined ? null : txAmount(value)
    const totalAmount = partial ? nullableAmount(entry.totalAmount) : txAmount(entry.totalAmount)
    if (partial && entry.metadataComplete !== (totalAmount !== null)) invalidTransactions()
    return Object.freeze({
      ...(partial ? {
        metadataComplete: entry.metadataComplete as boolean,
        pending: entry.pending as boolean,
        totalAmountEstimate: totalAmount === null ? nullableAmount(entry.totalAmountEstimate) : null,
        feeAmountEstimate: entry.feeAmount == null ? nullableAmount(entry.feeAmountEstimate) : null,
      } : {}),
      feeAmount: partial ? nullableAmount(entry.feeAmount) : entry.feeAmount == null ? 0 : txAmount(entry.feeAmount),
      inputs: txParties(entry.inputs),
      memo: txText(entry.memo, false),
      outputs: txParties(entry.outputs),
      timestamp,
      totalAmount,
      txHash: txText(entry.txHash, true) as string,
    })
  }))
}

export type ArrrCustodyReadResult =
  | Readonly<{ action: 'GET_ARRR_WALLET_SESSION'; result: ArrrWalletSession }>
  | Readonly<{ action: 'GET_USER_WALLET'; result: Readonly<{ address: string; coin: 'ARRR' }> }>
  | Readonly<{ action: 'GET_WALLET_BALANCE'; result: string }>
  | Readonly<{ action: 'GET_USER_WALLET_TRANSACTIONS'; result: readonly ArrrTransaction[] }>
  | Readonly<{ action: typeof HOME_V2_ARRR_SYNC_STATUS_ACTION; result: ArrrSyncSnapshot }>

export function projectArrrCustodyResponse(
  action: HomeV2ArrrCustodyReadAction,
  response: ArrrCustodyResponse,
): ArrrCustodyReadResult['result'] {
  switch (action) {
    case 'GET_USER_WALLET':
      return Object.freeze({ address: normalizeArrrAddress(response.body), coin: ARRR_CUSTODY_COIN })
    case 'GET_WALLET_BALANCE':
      return normalizeArrrAtomicAmount(response.body)
    case 'GET_USER_WALLET_TRANSACTIONS':
      return projectArrrTransactions(response.data)
    case HOME_V2_ARRR_SYNC_STATUS_ACTION:
      return parseArrrSyncSnapshot(response.data)
    case 'GET_ARRR_WALLET_SESSION':
      return parseArrrWalletSession(response.data)
  }
}

/**
 * One ARRR read end to end: derive the entropy for exactly the callback's
 * lifetime, post it, classify the answer and project the result — scrubbed
 * of the entropy string in case a node ever echoes a request body.
 *
 * `post` receives the built request and MUST NOT retain it. The derivation
 * inputs are zeroed by withArrrEntropy58 the moment the synchronous part of
 * the callback returns (the fetch is already carrying the body by then).
 */
export async function executeArrrCustodyRead(input: Readonly<{
  action: HomeV2ArrrCustodyReadAction
  crypto: ArrrCustodyCrypto
  nonce: number
  post: (request: ArrrCustodyReadRequest) => Promise<ArrrCustodyResponse>
  seed: Uint8Array
  verified?: boolean
  sessionRequest?: ArrrWalletSessionRequest
  walletVersion: number
}>): Promise<ArrrCustodyReadResult['result']> {
  const endpoint = arrrCustodyEndpointForAction(input.action)
  return withArrrEntropy58(
    { crypto: input.crypto, nonce: input.nonce, seed: input.seed, walletVersion: input.walletVersion },
    async (entropy58) => {
      // The string is closed over by this callback only; nothing below stores
      // it. It is passed to `post` as the body and used once more to scrub the
      // answer, then the callback returns and the last reference is gone.
      const request: ArrrCustodyReadRequest = endpoint === 'walletsession'
        ? { method: 'POST', pathname: '/crosschain/arrr/walletsession', contentType: 'application/json',
            body: JSON.stringify({ entropy58, ...(input.sessionRequest ?? { operation: 'status' }) }) }
        : buildArrrCustodyReadRequest(endpoint, entropy58, { verified: input.verified })
      let response: ArrrCustodyResponse
      try {
        response = await input.post(request)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (input.sessionRequest?.operation === 'activate') throw custodyError('The ARRR activation may have taken effect. Check wallet status before confirming again.', 'ARRR_SESSION_ACTIVATION_UNCERTAIN', false)
        throw custodyError(scrubArrrEntropy(message, entropy58), 'ARRR_CUSTODY_TRANSPORT_FAILED', true)
      }
      // A JSON answer carrying `__proto__`/`constructor`/`prototype` keys is
      // refused outright before anything is rebuilt from it.
      if (response.ok && containsUnsafeObjectKeys(response.data)) {
        throw input.action === 'GET_USER_WALLET_TRANSACTIONS'
          ? new Error('Qortium Core returned an invalid ARRR transaction list.')
          : custodyError(`Qortium Core returned a malformed ARRR ${endpoint} response (unsafe keys).`, 'ARRR_SYNC_STATUS_MALFORMED', false)
      }
      // Redact BEFORE any projection truncates node-controlled text, so a
      // secret can never be cut into a fragment that escapes the scrub; then
      // once more on the projected result as defence in depth.
      const scrubbed: ArrrCustodyResponse = {
        body: scrubArrrEntropy(response.body, entropy58),
        data: scrubArrrEntropy(response.data, entropy58),
        ok: response.ok,
        status: response.status,
      }
      if (!scrubbed.ok) {
        const failure = classifyArrrCustodyFailure(scrubbed, endpoint)
        failure.message = scrubArrrEntropy(failure.message, entropy58)
        throw failure
      }
      try {
        return scrubArrrEntropy(projectArrrCustodyResponse(input.action, scrubbed), entropy58)
      } catch (error) {
        if (error instanceof Error) {
          error.message = scrubArrrEntropy(error.message, entropy58)
        }
        throw error
      }
    },
  )
}

// ---------------------------------------------------------------------------
// Consent binding

export const HOME_V2_ARRR_CUSTODY_GRANT_FAMILY = 'account.arrr-custody.read' as const
export const HOME_V2_ARRR_CUSTODY_WRITE_KIND = 'arrr-custody-read' as const
export const HOME_V2_ARRR_CUSTODY_OPERATION_LABEL = 'Use ARRR wallet custody'

export type HomeV2ArrrCustodyConsentBinding = Readonly<{
  coin: typeof ARRR_CUSTODY_COIN
  kind: typeof HOME_V2_ARRR_CUSTODY_WRITE_KIND
  /** The resolved admin node's `${mode}|${nodeApiUrl}` — prompt, grant key and recheck all use this one value. */
  nodeRoute: string
  operationLabel: string
  routeLabel: string
}>

/**
 * Unlike the bitcoiny reads there is NO route-independent fallback: every
 * ARRR read, the address included, is answered by the Core that holds the
 * spending key, so a consent without a trusted node is meaningless.
 */
export function homeV2ArrrCustodyConsentBinding(input: Readonly<{
  adminNode: Readonly<{ nodeApiUrl: string; nodeRoute: string }> | null
}>): HomeV2ArrrCustodyConsentBinding {
  if (!input.adminNode || !input.adminNode.nodeApiUrl || !input.adminNode.nodeRoute) {
    throw new Error('ARRR wallet custody requires an authenticated Qortium node you administer.')
  }
  return Object.freeze({
    coin: ARRR_CUSTODY_COIN,
    kind: HOME_V2_ARRR_CUSTODY_WRITE_KIND,
    nodeRoute: input.adminNode.nodeRoute,
    operationLabel: HOME_V2_ARRR_CUSTODY_OPERATION_LABEL,
    routeLabel: input.adminNode.nodeApiUrl,
  })
}

export const HOME_V2_ARRR_CUSTODY_PROMPT_TITLE = 'Allow ARRR wallet custody on your trusted Core?'

export function homeV2ArrrCustodyPromptSummary(appTitle: string, nodeLabel: string) {
  return `${appTitle} wants to use this account's ARRR (Pirate Chain) wallet. Home derives this account's ARRR spending key and hands it to your trusted Qortium Core at ${nodeLabel}, which keeps a synced copy of the wallet to read balances and history. The app receives only the address, balances and history — never the key. Ending this tab session revokes the app's access, not the copy your Core keeps.`
}

export function homeV2ArrrCustodyPromptDetails(input: Readonly<{ accountLabel: string; nodeLabel: string }>) {
  return Object.freeze([
    { label: 'Account', value: input.accountLabel },
    { label: 'Node', value: input.nodeLabel },
    { label: 'Shared with Core', value: 'This account’s ARRR spending key (wallet entropy)' },
    { label: 'Shared with app', value: 'ARRR address, balances and transaction history' },
    { label: 'Not shared', value: 'Wallet seed — and the app never sees the spending key' },
  ] as const)
}

// ---------------------------------------------------------------------------
// Per-route serialization

export const ARRR_READ_BACKLOG_CODE = 'ARRR_READ_BACKLOG' as const
export const ARRR_READ_CANCELLED_CODE = 'ARRR_READ_CANCELLED' as const
/** Queued (not running) requests one principal may hold on one route. */
export const ARRR_READ_BACKLOG_LIMIT = 4

export type ArrrCustodyQueueMeta = Readonly<{
  /** Same key → a newer request supersedes one still queued. */
  coalesceKey?: string
  /** The app tab issuing the request; bounds its backlog and lets lifecycle cancel it. */
  principalKey: string
  /** Free-form facts for cancelWhere (host web-contents id, tab id, …). */
  tags?: Readonly<Record<string, string | number>>
}>

type QueuedTask = {
  readonly meta: ArrrCustodyQueueMeta
  readonly run: () => Promise<unknown>
  readonly reject: (error: unknown) => void
  readonly resolve: (value: unknown) => void
}

type RouteState = { active: QueuedTask | null; queue: QueuedTask[] }

export type ArrrCustodyReadQueue = Readonly<{
  /** Queued-or-running count on a route, or across every route when omitted. */
  pending(routeKey?: string): number
  /**
   * Reject (ARRR_READ_CANCELLED) every QUEUED task whose meta matches. A task
   * already running is never interrupted here — its own in-task rechecks
   * refuse delivery instead.
   */
  cancelWhere(predicate: (meta: ArrrCustodyQueueMeta) => boolean): number
  /**
   * Run `task` after every earlier task on `routeKey` has settled. A task with
   * the same `coalesceKey` that has not started is removed and rejected with
   * ARRR_READ_SUPERSEDED. A principal already holding ARRR_READ_BACKLOG_LIMIT
   * queued requests on the route is refused with ARRR_READ_BACKLOG.
   */
  run<T>(routeKey: string, task: () => Promise<T>, meta: ArrrCustodyQueueMeta): Promise<T>
}>

/**
 * Core switches its single active ARRR wallet between accounts serially and
 * answers 409 while it does; Home keeps one ARRR request in flight per Core
 * route so its own requests never race one another into that state. The
 * drain is iterative (never recursive), superseded and cancelled entries are
 * removed the moment they are rejected, and the backlog per principal is
 * bounded so one app cannot delay every other tab on the same Core.
 */
export function createArrrCustodyReadQueue(): ArrrCustodyReadQueue {
  const routes = new Map<string, RouteState>()

  const settleRoute = (routeKey: string, route: RouteState) => {
    if (!route.active && route.queue.length === 0) routes.delete(routeKey)
  }

  const pump = (routeKey: string) => {
    const route = routes.get(routeKey)
    if (!route || route.active) return
    const next = route.queue.shift()
    if (!next) {
      settleRoute(routeKey, route)
      return
    }
    route.active = next
    // The route is released BEFORE the waiter is resolved, so a caller that
    // awaits one read and immediately issues the next never observes its own
    // finished request as still in flight. `pump` re-enters only from a
    // promise callback, never synchronously from itself, so a long queue can
    // never grow the stack.
    const finish = () => {
      route.active = null
      pump(routeKey)
    }
    let outcome: Promise<unknown>
    try {
      outcome = next.run()
    } catch (error) {
      outcome = Promise.reject(error)
    }
    outcome.then(
      (value) => { finish(); next.resolve(value) },
      (error) => { finish(); next.reject(error) },
    )
  }

  const removeWhere = (route: RouteState, predicate: (task: QueuedTask) => boolean, error: () => ArrrCustodyError) => {
    let removed = 0
    const kept: QueuedTask[] = []
    for (const task of route.queue) {
      if (predicate(task)) {
        removed += 1
        task.reject(error())
      } else {
        kept.push(task)
      }
    }
    if (removed > 0) route.queue = kept
    return removed
  }

  return Object.freeze({
    cancelWhere(predicate) {
      let cancelled = 0
      for (const [routeKey, route] of routes) {
        cancelled += removeWhere(
          route,
          (task) => predicate(task.meta),
          () => custodyError('The ARRR wallet read was cancelled because its tab, account or node changed.', ARRR_READ_CANCELLED_CODE, false),
        )
        settleRoute(routeKey, route)
      }
      return cancelled
    },
    pending(routeKey) {
      if (routeKey === undefined) {
        let total = 0
        for (const route of routes.values()) total += route.queue.length + (route.active ? 1 : 0)
        return total
      }
      const route = routes.get(routeKey)
      return route ? route.queue.length + (route.active ? 1 : 0) : 0
    },
    run<T>(routeKey: string, task: () => Promise<T>, meta: ArrrCustodyQueueMeta): Promise<T> {
      if (!meta || typeof meta.principalKey !== 'string' || meta.principalKey.length === 0) {
        return Promise.reject(new Error('An ARRR read needs its principal.'))
      }
      const route = routes.get(routeKey) ?? { active: null, queue: [] }
      routes.set(routeKey, route)
      if (meta.coalesceKey !== undefined) {
        removeWhere(
          route,
          (waiting) => waiting.meta.coalesceKey === meta.coalesceKey,
          () => custodyError('A newer ARRR status request replaced this one.', ARRR_READ_SUPERSEDED_CODE, false),
        )
      }
      const backlog = route.queue.filter((waiting) => waiting.meta.principalKey === meta.principalKey).length
      if (backlog >= ARRR_READ_BACKLOG_LIMIT) {
        settleRoute(routeKey, route)
        return Promise.reject(custodyError(
          `Too many ARRR wallet reads are waiting for this app; wait for one to finish.`,
          ARRR_READ_BACKLOG_CODE,
          true,
        ))
      }
      return new Promise<T>((resolve, reject) => {
        route.queue.push({
          meta,
          reject,
          resolve: resolve as (value: unknown) => void,
          run: task,
        })
        pump(routeKey)
      })
    },
  })
}
