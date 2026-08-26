// Home 2 zero-key cross-chain reads.
//
// Four GETs against Core's `/crosschain` prefix — already allowlisted for
// read-only passthrough in home-v2-app-actions.ts READ_PREFIXES — plus the
// two small response projections Home 1.x applied to them.
//
// Every action here is a PUBLIC READ. None touches the wallet seed, derives a
// key, needs an unlocked account, uses an API key, or writes anything. They
// answer "what foreign chains does this node know about, which electrum
// server is it using, and what does that chain charge" — node-side facts, not
// user-side ones. That is why they are permissionless.
//
// Pure module: no Electron/Node/DOM imports, so the desktop bridge and the
// Android bridge share one implementation.

import { buildHomeBlockchainDiscovery } from './qdn-wallet-capabilities.js'
import { getForeignWalletCoins } from './foreign-wallets.js'

export const HOME_V2_CROSSCHAIN_READ_ACTIONS = Object.freeze([
  'GET_CROSSCHAIN_BLOCKCHAINS',
  'GET_CROSSCHAIN_SERVER_INFO',
  'GET_FOREIGN_FEE',
  'GET_SERVER_CONNECTION_HISTORY',
] as const)

const CROSSCHAIN_READ_ACTION_SET = new Set<string>(HOME_V2_CROSSCHAIN_READ_ACTIONS)

export function isHomeV2CrosschainReadAction(action: string) {
  return CROSSCHAIN_READ_ACTION_SET.has(action)
}

/**
 * The row Home projects into `/crosschain/blockchains` for QORT itself.
 *
 * A deliberate restatement of QORTAL_PUBLIC_NODE_BLOCKCHAIN_INFO in Home 1.x
 * electron/qdn.ts:629-643 — Core reports FOREIGN chains only, but Home can
 * also operate QORT through public Qortal nodes, so the discovery list would
 * otherwise omit the one chain Home is best at. Restated rather than imported
 * because qdn.ts is the v1 bridge and v2 must not depend on it; the field
 * values are pinned by home-v2-tier2-actions.test.ts so drift shows in a diff.
 */
export const HOME_V2_QORTAL_PUBLIC_NODE_BLOCKCHAIN_INFO = Object.freeze({
  activeNetwork: 'MAIN',
  apiPath: null,
  chainId: null,
  currencyCode: 'QORT',
  decimalPlaces: 8,
  displayName: 'Qortal',
  name: 'QORTAL',
  slip44CoinType: null,
  supportsForeignForeignTrades: false,
  supportsHtlc: false,
  supportsLocalChainTrades: false,
  supportsWallet: true,
  type: 'QORTAL_PUBLIC_NODE',
  walletEnabled: true,
})

/**
 * Coins accepted as a `/crosschain/{coin}/…` path segment.
 *
 * A strict allowlist, not a sanitizer: the normalized value becomes a URL path
 * segment, so nothing app-supplied may reach the path unless it is one of
 * these exact strings.
 *
 * The list is the HD-wallet coin set (electron/foreign-wallets.ts) PLUS ARRR.
 * Home 1.x reused normalizeForeignWalletCoin here (qdn.ts:1931-1957), which
 * was the wrong list for a read-only passthrough: it answers "can Home derive
 * a wallet key for this coin", not "can this node report a server for it".
 * The visible consequence was that GET_CROSSCHAIN_SERVER_INFO — whose only
 * real caller passes `{ coin: 'ARRR' }` (walletium CoinDetail.tsx:173-177,
 * qortium-wallet CoinDetail.tsx:184-188) — threw 'Unsupported foreign wallet
 * coin.' for the one coin it was ever asked about. Pirate Chain needs no
 * Home-side key material for these reads, so it belongs here even though
 * Home cannot derive an ARRR wallet.
 *
 * A coin the node does not actually support answers with Core's own 404/400,
 * which Home surfaces unchanged — exactly as 1.x did for an unsupported one.
 */
const CROSSCHAIN_COIN_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  ARRR: 'ARRR',
  BITCOIN: 'BTC',
  BTC: 'BTC',
  DASH: 'DASH',
  DGB: 'DGB',
  DIGIBYTE: 'DGB',
  DOGE: 'DOGE',
  DOGECOIN: 'DOGE',
  FIRO: 'FIRO',
  LITECOIN: 'LTC',
  LTC: 'LTC',
  NAMECOIN: 'NMC',
  NMC: 'NMC',
  PIRATE: 'ARRR',
  PIRATECHAIN: 'ARRR',
  RAVENCOIN: 'RVN',
  RVN: 'RVN',
})

// Every HD-wallet coin must remain reachable as a read; ARRR is the only
// addition. Asserted at module load so removing a coin from foreign-wallets.ts
// can never silently shrink the read surface.
for (const coin of getForeignWalletCoins()) {
  if (CROSSCHAIN_COIN_ALIASES[coin] !== coin) {
    throw new Error(`Cross-chain read alias table is missing ${coin}.`)
  }
}

export const HOME_V2_CROSSCHAIN_COINS = Object.freeze(
  [...new Set(Object.values(CROSSCHAIN_COIN_ALIASES))].sort(),
)

export function normalizeHomeV2CrosschainCoin(value: unknown) {
  const requested = typeof value === 'string' ? value.trim().toUpperCase() : ''
  const coin = CROSSCHAIN_COIN_ALIASES[requested]
  if (!coin) {
    throw new Error(`coin must be one of ${HOME_V2_CROSSCHAIN_COINS.join(', ')}.`)
  }
  return coin
}

function requestCoin(request: Record<string, unknown>) {
  return normalizeHomeV2CrosschainCoin(request.coin ?? request.blockchain)
}

/**
 * Which fee endpoint a GET_FOREIGN_FEE request means.
 *
 * Ported verbatim from Home 1.x getForeignFeePath (electron/qdn.ts:1796-1811),
 * including the default: an absent type means `feekb`. Both wallet apps send
 * `{ type: 'TRADE' }` (qortium-wallet CoinDetail.tsx:332-340 and the walletium
 * twin), which lands on feekb.
 */
export function homeV2ForeignFeeEndpoint(request: Record<string, unknown>) {
  const raw = request.feeType ?? request.type
  const feeType = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!feeType || feeType === 'trade' || feeType === 'send' || feeType === 'feekb' || feeType === 'feeperbyte') {
    return 'feekb' as const
  }
  if (feeType === 'feeceiling' || feeType === 'feerequired') {
    return 'feerequired' as const
  }
  throw new Error('type must be TRADE, SEND, FEEKB, FEEPERBYTE, FEECEILING, or FEEREQUIRED.')
}

function atomicAmountToCoinString(value: bigint) {
  const whole = value / 100_000_000n
  const fraction = value % 100_000_000n
  if (fraction === 0n) return whole.toString()
  return `${whole}.${fraction.toString().padStart(8, '0').replace(/0+$/, '')}`
}

/**
 * Core reports the trade fee per KILOBYTE; every caller wants it per byte.
 *
 * Ported from Home 1.x feePerKbToFeePerByteString (electron/qdn.ts:1673-1682),
 * including the rounding: integer ceiling division by 1000, so a fee that
 * divides unevenly rounds UP. Rounding down would under-fee a trade and get
 * the transaction rejected by the foreign chain.
 */
export function homeV2FeePerKbToFeePerByte(value: unknown) {
  // A JS number is only trusted when it is an exact integer. `String(1e21)`
  // yields '1e+21' and any integer past Number.MAX_SAFE_INTEGER has already
  // lost precision before we see it, so converting such a number to a fee
  // string would silently sign off on a rounded value. A node reporting a huge
  // fee must send it as a decimal string (which JSON preserves) or a bigint.
  let text: string
  if (typeof value === 'string') {
    text = value.trim()
  } else if (typeof value === 'bigint') {
    text = value.toString()
  } else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error('Foreign fee number is not an exact integer; send it as a decimal string.')
    }
    text = String(value)
  } else {
    text = ''
  }
  if (!/^(?:0|[1-9]\d*)$/.test(text)) {
    throw new Error('Foreign fee must be a non-negative integer of atomic units.')
  }
  const feePerByte = (BigInt(text) + 999n) / 1000n
  if (feePerByte <= 0n) {
    throw new Error('Foreign fee must be greater than zero.')
  }
  return atomicAmountToCoinString(feePerByte)
}

export function buildHomeV2CrosschainReadPath(action: string, request: Record<string, unknown>) {
  if (action === 'GET_CROSSCHAIN_BLOCKCHAINS') return '/crosschain/blockchains'
  if (action === 'GET_CROSSCHAIN_SERVER_INFO') {
    return `/crosschain/${requestCoin(request).toLowerCase()}/serverinfos`
  }
  if (action === 'GET_SERVER_CONNECTION_HISTORY') {
    return `/crosschain/${requestCoin(request).toLowerCase()}/serverconnectionhistory`
  }
  if (action === 'GET_FOREIGN_FEE') {
    return `/crosschain/${requestCoin(request).toLowerCase()}/${homeV2ForeignFeeEndpoint(request)}`
  }
  throw new Error(`${action} is not a supported cross-chain read.`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * The response shaping Home 1.x applied on top of the raw node payload.
 *
 * Kept as a separate step from the path builder so the chain-read dispatch in
 * both hosts stays "build path, fetch, project" with no action-specific
 * branching in the fetch itself.
 */
export function projectHomeV2CrosschainReadResult(
  action: string,
  request: Record<string, unknown>,
  data: unknown,
) {
  if (action === 'GET_CROSSCHAIN_BLOCKCHAINS') {
    // 1.x qdn.ts:3077-3082.
    return buildHomeBlockchainDiscovery(data, HOME_V2_QORTAL_PUBLIC_NODE_BLOCKCHAIN_INFO as unknown as Record<string, unknown>)
  }
  if (action === 'GET_CROSSCHAIN_SERVER_INFO') {
    // 1.x qdn.ts:1931-1936: unwrap `{ servers: [...] }` to the bare array both
    // wallet apps already treat as one (`if (Array.isArray(servers))`), but
    // pass anything else through untouched.
    return isRecord(data) && Array.isArray(data.servers) ? data.servers : data
  }
  if (action === 'GET_FOREIGN_FEE') {
    // 1.x qdn.ts:1938-1951.
    if (homeV2ForeignFeeEndpoint(request) === 'feekb') {
      return Object.freeze({ fee: homeV2FeePerKbToFeePerByte(data), feePerKb: data })
    }
    return Object.freeze({ fee: data })
  }
  return data
}
