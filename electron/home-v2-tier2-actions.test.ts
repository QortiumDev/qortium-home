// Contract tests for the R4 tier-2 bridge restoration: the native wallet
// reads, the zero-key cross-chain reads, market prices, the trust and group
// moderation reads, and the AT MESSAGE send.
//
// Three kinds of assertion live here on purpose:
//   1. CATALOGUE PINS — which action is advertised on which protocol. These
//      are the app-facing contract; a silent change to one breaks published
//      apps.
//   2. PURE-MODULE BEHAVIOR — selectors, path builders, normalizers, the
//      price cache. Everything reachable without Electron.
//   3. SOURCE PINS — properties that are true of the CODE rather than of a
//      return value, because that is the only way to assert a negative like
//      "this handler never touches key material".

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

import {
  buildHomeV2ChainReadPath,
  buildHomeV2RatingRead,
  buildHomeV2RatingReadResult,
  getHomeV2AppActions,
  homeV2ChainReadNeedsSelectedAddress,
  homeV2RatingReadNeedsSelectedAddress,
  isHomeV2ChainReadAction,
  isHomeV2RatingReadAction,
  normalizeHomeV2RatingSummary,
  withHomeV2SelectedAddress,
  HOME_V2_RATING_READ_ACTIONS,
  HOME_V2_SELF_DEFAULTING_ADDRESS_ACTIONS,
} from './home-v2-app-actions.js'
import {
  buildHomeV2AccountBalancePath,
  buildHomeV2AccountDataPath,
  buildHomeV2UserWalletResult,
  homeV2ForeignWalletUnavailableError,
  homeV2RequestAssetId,
  isHomeV2NativeAssetAlias,
  isHomeV2NativeWalletRequest,
  resolveHomeV2AccountReadAddress,
  HOME_V2_FOREIGN_WALLET_UNAVAILABLE_CODE,
  HOME_V2_NATIVE_ASSET_ID,
} from './home-v2-wallet-actions.js'
import {
  buildHomeV2CrosschainReadPath,
  homeV2FeePerKbToFeePerByte,
  homeV2ForeignFeeEndpoint,
  isHomeV2CrosschainReadAction,
  normalizeHomeV2CrosschainCoin,
  projectHomeV2CrosschainReadResult,
  HOME_V2_CROSSCHAIN_COINS,
  HOME_V2_CROSSCHAIN_READ_ACTIONS,
  HOME_V2_QORTAL_PUBLIC_NODE_BLOCKCHAIN_INFO,
} from './home-v2-crosschain-actions.js'
import {
  buildHomeV2MarketPriceUrl,
  normalizeHomeV2MarketPriceRequest,
  HomeV2MarketPriceCache,
  HOME_V2_COINGECKO_ORIGIN,
} from './home-v2-market-prices.js'
import { MARKET_PRICE_CACHE_TTL_MS } from './market-prices.js'
import {
  homeV2AtMessagePreview,
  isHomeV2AtMessageAction,
  normalizeHomeV2AtMessageRequest,
  HOME_V2_AT_MESSAGE_PREVIEW_MAX_CHARS,
} from './home-v2-at-message-actions.js'
import { buildUnsignedQortiumAtMessageTransactionBytes } from './qdn-at-message.js'
import { HOME_V2_PERMISSIONLESS_ACTIONS } from './home-v2-session-grants.js'
import { HOME_V2_JOURNALED_MUTATIONS } from './home-v2-transaction-journal.js'
import { HOME_V2_ROUTE_INDEPENDENT_ACTIONS } from './home-v2-app-runtime.js'

// A real Qortium Previewnet AT address: the SMPL faucet V1, which is the one
// shipped SEND_MESSAGE recipient (qortium-casino website/src/config.js:11).
// Verified here as decoding to 25 bytes with address version 23 and a valid
// double-SHA-256 checksum, so this constant also pins that the validator
// accepts a genuine AT rather than merely accepting anything.
const AT_ADDRESS = 'AG9QWs1tEBTmXoH2rrQXwV4LdMAM99o5WD'
// A Q-prefixed account address (version 57). Structurally a fine account
// address; it must never pass as an AT.
const ACCOUNT_ADDRESS = 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH'
const OTHER_ADDRESS = 'QLdBpGnZfP9nSnZ9nSnZ9nSnZ9nSnZ9nSn'

// Source pins assert things about what the CODE does. Comments are stripped
// first, because the code's own prose necessarily NAMES the things it promises
// not to do ("plain fetch, not nodeFetch"; "no address leaves the process"),
// and a raw substring check would fail on the very sentence documenting the
// property it is checking.
function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function readRepoSource(...candidates: string[]) {
  const url = candidates.map((candidate) => new URL(candidate, import.meta.url)).find((each) => existsSync(each))
  assert.ok(url, `source not found: tried ${candidates.join(', ')}`)
  return readFileSync(url, 'utf8')
}

const qdnActions = getHomeV2AppActions('qdnRequest')
const qortalActions = getHomeV2AppActions('qortalRequest')

// ---------------------------------------------------------------------------
// 1. Catalogue pins

// Restored on BOTH protocols: each is a public read that exists on both forks.
for (const action of [
  'GET_ACCOUNT_RATING',
  'GET_RESOURCE_RATING',
  'GET_GROUP_BANS',
  'GET_GROUP_KICKS',
  'GET_MEMBER_BANS',
  'GET_MEMBER_KICKS',
  'GET_CROSSCHAIN_BLOCKCHAINS',
  'GET_CROSSCHAIN_SERVER_INFO',
  'GET_FOREIGN_FEE',
  'GET_SERVER_CONNECTION_HISTORY',
  'GET_MARKET_PRICES',
  'GET_USER_WALLET',
]) {
  assert.ok(qdnActions.includes(action), `${action} must be advertised on qdnRequest`)
  assert.ok(qortalActions.includes(action), `${action} must be advertised on qortalRequest`)
}

// UNLOCK_SELECTED_ACCOUNT is now on both: unlocking is a Home-account
// operation, not a chain one, and the legacy wallet app only knows
// qortalRequest.
assert.ok(qdnActions.includes('UNLOCK_SELECTED_ACCOUNT'))
assert.ok(qortalActions.includes('UNLOCK_SELECTED_ACCOUNT'))

// SEND_MESSAGE is qdnRequest-ONLY. Not a stylistic choice: the transaction
// serializer mirrors Qortium Core's MESSAGE layout, which differs from
// Qortal's, so advertising it on qortalRequest would mean offering to sign
// bytes for a chain that reads them differently.
assert.ok(qdnActions.includes('SEND_MESSAGE'), 'SEND_MESSAGE must be advertised on qdnRequest')
assert.ok(
  !qortalActions.includes('SEND_MESSAGE'),
  'SEND_MESSAGE must NOT be advertised on qortalRequest: the MESSAGE serializer is Qortium-specific',
)

// PREVIEW_QDN_PUBLISH_SOURCE is deliberately still absent (see
// docs/HOME_V2_BRIDGE_COMPATIBILITY.md): a faithful port needs a v2 preview
// surface that does not exist yet, and a handler that returns true while
// showing the user nothing would be worse than an honest refusal.
assert.ok(!qdnActions.includes('PREVIEW_QDN_PUBLISH_SOURCE'))
assert.ok(!qortalActions.includes('PREVIEW_QDN_PUBLISH_SOURCE'))

// The foreign-wallet family stays deferred pending the W3 design. Restoring
// GET_USER_WALLET must not have dragged its siblings in with it.
for (const action of ['GET_WALLET_BALANCE', 'GET_USER_WALLET_INFO', 'GET_USER_WALLET_TRANSACTIONS', 'SET_CURRENT_FOREIGN_SERVER', 'SEND_COIN']) {
  assert.ok(!qdnActions.includes(action), `${action} must stay deferred`)
  assert.ok(!qortalActions.includes(action), `${action} must stay deferred`)
}

// No duplicates crept in while editing two long literal lists.
for (const [label, actions] of [['qdnRequest', qdnActions], ['qortalRequest', qortalActions]] as const) {
  assert.equal(new Set(actions).size, actions.length, `${label} catalogue must not contain duplicates`)
}

// ---------------------------------------------------------------------------
// 2. Permission posture pins

assert.ok(
  (HOME_V2_PERMISSIONLESS_ACTIONS as readonly string[]).includes('GET_USER_WALLET'),
  'GET_USER_WALLET is permissionless: it returns strictly less than GET_SELECTED_ACCOUNT, which already is',
)
assert.ok(
  (HOME_V2_PERMISSIONLESS_ACTIONS as readonly string[]).includes('GET_SELECTED_ACCOUNT'),
  'the strictly-less argument above only holds while GET_SELECTED_ACCOUNT is itself permissionless',
)
assert.ok(
  !(HOME_V2_PERMISSIONLESS_ACTIONS as readonly string[]).includes('SEND_MESSAGE'),
  'SEND_MESSAGE signs a transaction and must always prompt',
)
assert.ok(
  !(HOME_V2_PERMISSIONLESS_ACTIONS as readonly string[]).includes('PREVIEW_QDN_PUBLISH_SOURCE'),
)
assert.ok(
  (HOME_V2_JOURNALED_MUTATIONS as readonly string[]).includes('SEND_MESSAGE'),
  'a signed-and-broadcast MESSAGE has an ambiguous outcome and must be journaled',
)
assert.ok(
  (HOME_V2_ROUTE_INDEPENDENT_ACTIONS as readonly string[]).includes('GET_MARKET_PRICES'),
  'market prices come from outside the node network, so a dead node route does not block them',
)
for (const action of HOME_V2_CROSSCHAIN_READ_ACTIONS) {
  assert.ok(
    !(HOME_V2_ROUTE_INDEPENDENT_ACTIONS as readonly string[]).includes(action),
    `${action} reads a NODE and must stay route-dependent`,
  )
}

// The main process must force single-request for SEND_MESSAGE on the ACTION,
// not only on the prompt payload it happens to send.
function sliceAfter(source: string, marker: string, length: number, label: string) {
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `${label}: could not find ${marker}`)
  return source.slice(start, start + length)
}

const bridgeSource = readRepoSource('../electron/home-v2-app-bridge.ts', './home-v2-app-bridge.ts')
assert.ok(
  sliceAfter(bridgeSource, 'const singleRequestOnly =', 900, 'bridge').includes("action === 'SEND_MESSAGE'"),
  'SEND_MESSAGE must be named directly in the singleRequestOnly rule, not merely inherited from its write kind',
)

// The renderer must refuse a SEND_MESSAGE prompt that cannot show what is
// being signed, and must offer only a single-request scope.
const liveAppSource = readRepoSource('../src/home-v2-live/HomeV2LiveApp.tsx', './HomeV2LiveApp.tsx')
const atMessageGuard = sliceAfter(liveAppSource, "value.action === 'SEND_MESSAGE' &&", 700, 'prompt guard')
for (const required of [
  "value.writeKind !== 'direct'",
  "value.protocol !== 'qdnRequest'",
  "value.targetNetwork !== 'qortium'",
  "typeof value.writeOtherAddress !== 'string'",
  "typeof value.chatMessagePreview !== 'string'",
  'value.writeSingleRequestOnly !== true',
]) {
  assert.ok(atMessageGuard.includes(required), `the SEND_MESSAGE prompt guard must check ${required}`)
}
const scopes = sliceAfter(liveAppSource, 'allowedScopes:', 500, 'allowedScopes')
assert.ok(scopes.startsWith('allowedScopes: isAtMessage'), 'the SEND_MESSAGE scope arm must come first')
assert.ok(
  scopes.includes("? ['single-request']"),
  'the SEND_MESSAGE prompt must offer single-request only',
)

// ---------------------------------------------------------------------------
// 3. GET_USER_WALLET native selectors

// Home 1.x's four aliases, still accepted.
for (const alias of ['NATIVE', 'native', 'NATIVE_ASSET', 'native-asset', 'ASSET_0', 'ASSET0', 'asset 0']) {
  assert.ok(isHomeV2NativeAssetAlias(alias), `${alias} must be a native alias`)
}
// The deliberate addition: walletium sends this for its native row.
assert.ok(isHomeV2NativeAssetAlias('QORT'), "'QORT' must be accepted as native for this action")
assert.ok(isHomeV2NativeAssetAlias(' qort '), 'the QORT alias must tolerate case and padding')

for (const foreign of ['BTC', 'LTC', 'ARRR', 'DOGE', 'BITCOIN', '']) {
  assert.ok(!isHomeV2NativeAssetAlias(foreign), `${foreign} must not be a native alias`)
}

// The three selector shapes both wallet apps actually send.
assert.ok(isHomeV2NativeWalletRequest({ assetId: 0 }), 'qortium-wallet sends { assetId: 0 }')
assert.ok(isHomeV2NativeWalletRequest({ coin: 'QORT' }), "walletium sends { coin: 'QORT' }")
assert.ok(isHomeV2NativeWalletRequest({ coin: 'NATIVE' }))
// An absent selector defaults to native, matching 1.x's defaultToNative=true.
assert.ok(isHomeV2NativeWalletRequest({}))
assert.ok(isHomeV2NativeWalletRequest({ coin: '' }))
// `blockchain` is the documented synonym for `coin`.
assert.ok(isHomeV2NativeWalletRequest({ blockchain: 'NATIVE' }))

// An explicit assetId wins over a coin alias, both ways round — the same
// precedence Home 1.x used.
assert.ok(!isHomeV2NativeWalletRequest({ assetId: 1, coin: 'QORT' }), 'assetId must win over the coin alias')
assert.ok(isHomeV2NativeWalletRequest({ assetId: 0, coin: 'BTC' }), 'assetId must win over the coin alias')

for (const foreign of [{ coin: 'BTC' }, { coin: 'ARRR' }, { blockchain: 'LITECOIN' }, { assetId: 42 }]) {
  assert.ok(!isHomeV2NativeWalletRequest(foreign), `${JSON.stringify(foreign)} is not native`)
}

// A malformed selector is refused rather than quietly defaulting to native.
assert.throws(() => isHomeV2NativeWalletRequest({ assetId: -1 }), /non-negative safe integer/)
assert.throws(() => isHomeV2NativeWalletRequest({ assetId: 1.5 }), /non-negative safe integer/)
assert.throws(() => isHomeV2NativeWalletRequest({ assetId: 'abc' }), /non-negative safe integer/)
assert.equal(homeV2RequestAssetId({}), undefined)
assert.equal(homeV2RequestAssetId({ assetId: '' }), undefined)
assert.equal(homeV2RequestAssetId({ assetId: '7' }), 7)

// The foreign refusal is coded and non-retryable, and never leaks a coin name
// longer than a label.
const foreignError = homeV2ForeignWalletUnavailableError('BTC') as Error & { code?: string; retryable?: boolean }
assert.match(foreignError.message, /Foreign wallets are not yet available in Home 2\./)
assert.equal(foreignError.code, HOME_V2_FOREIGN_WALLET_UNAVAILABLE_CODE)
assert.equal(foreignError.retryable, false)
assert.ok(foreignError.message.length < 120)

// The response: the address plus three constants, and nothing else.
const wallet = buildHomeV2UserWalletResult(ACCOUNT_ADDRESS)
assert.deepEqual({ ...wallet }, {
  address: ACCOUNT_ADDRESS,
  assetId: HOME_V2_NATIVE_ASSET_ID,
  assetName: 'Native Asset',
  native: true,
})
assert.equal(HOME_V2_NATIVE_ASSET_ID, 0)
// `.address` is the only field either wallet app reads, so it must be exactly
// the address it was given — no prefix, no normalization surprise.
assert.equal(wallet.address, ACCOUNT_ADDRESS)
assert.throws(() => buildHomeV2UserWalletResult('not-an-address'), /Selected account address is invalid\./)

// ---------------------------------------------------------------------------
// 4. GET_BALANCE / GET_ACCOUNT_DATA regressions

// The exact call qortium-wallet makes: no address, assetId 0.
assert.equal(
  resolveHomeV2AccountReadAddress({ assetId: 0 }, ACCOUNT_ADDRESS),
  ACCOUNT_ADDRESS,
  'an absent address must default to the selected account',
)
// An explicit address still wins, and is still validated.
assert.equal(resolveHomeV2AccountReadAddress({ address: OTHER_ADDRESS }, ACCOUNT_ADDRESS), OTHER_ADDRESS)
assert.throws(() => resolveHomeV2AccountReadAddress({ address: 'nope' }, ACCOUNT_ADDRESS), /Address is invalid\./)
// With neither, the caller gets a clear error rather than a request for ''.
assert.throws(() => resolveHomeV2AccountReadAddress({}, null), /no account is selected/)

assert.equal(
  buildHomeV2AccountBalancePath(ACCOUNT_ADDRESS, { assetId: 0 }),
  `/addresses/balance/${ACCOUNT_ADDRESS}?assetId=0`,
  'GET_BALANCE must honor assetId, including assetId 0',
)
assert.equal(
  buildHomeV2AccountBalancePath(ACCOUNT_ADDRESS, { assetId: 12 }),
  `/addresses/balance/${ACCOUNT_ADDRESS}?assetId=12`,
)
assert.equal(
  buildHomeV2AccountBalancePath(ACCOUNT_ADDRESS, {}),
  `/addresses/balance/${ACCOUNT_ADDRESS}`,
  'no assetId means no query string, so the native default is unchanged',
)
assert.throws(() => buildHomeV2AccountBalancePath(ACCOUNT_ADDRESS, { assetId: '1; DROP' }), /non-negative safe integer/)
assert.equal(buildHomeV2AccountDataPath(ACCOUNT_ADDRESS), `/addresses/${ACCOUNT_ADDRESS}`)

// ---------------------------------------------------------------------------
// 5. Cross-chain reads

for (const action of HOME_V2_CROSSCHAIN_READ_ACTIONS) {
  assert.ok(isHomeV2CrosschainReadAction(action))
  // They ride the shared chain-read pipeline, which is what gives them the
  // Android mirror and the response bound for free.
  assert.ok(isHomeV2ChainReadAction(action), `${action} must be a chain read`)
}
assert.ok(!isHomeV2CrosschainReadAction('GET_PRICE'), 'GET_PRICE is a different, pre-existing crosschain read')

assert.equal(buildHomeV2CrosschainReadPath('GET_CROSSCHAIN_BLOCKCHAINS', {}), '/crosschain/blockchains')
assert.equal(
  buildHomeV2CrosschainReadPath('GET_CROSSCHAIN_SERVER_INFO', { coin: 'ARRR' }),
  '/crosschain/arrr/serverinfos',
  'ARRR is the only coin the shipped callers pass to this action',
)
assert.equal(
  buildHomeV2CrosschainReadPath('GET_SERVER_CONNECTION_HISTORY', { coin: 'LITECOIN' }),
  '/crosschain/ltc/serverconnectionhistory',
)
assert.equal(
  buildHomeV2CrosschainReadPath('GET_FOREIGN_FEE', { coin: 'BTC', type: 'TRADE' }),
  '/crosschain/btc/feekb',
  "both wallet apps send { type: 'TRADE' }, which means feekb",
)
assert.equal(
  buildHomeV2CrosschainReadPath('GET_FOREIGN_FEE', { coin: 'BTC', feeType: 'feeRequired' }),
  '/crosschain/btc/feerequired',
)
// Routed through the chain-read entry point too, so the dispatch both hosts
// share really does reach these builders.
assert.equal(
  buildHomeV2ChainReadPath('GET_CROSSCHAIN_SERVER_INFO', { coin: 'ARRR' }),
  '/crosschain/arrr/serverinfos',
)

// The coin list is an allowlist because the value becomes a URL path segment.
assert.deepEqual(
  [...HOME_V2_CROSSCHAIN_COINS],
  ['ARRR', 'BTC', 'DASH', 'DGB', 'DOGE', 'FIRO', 'LTC', 'NMC', 'RVN'],
)
assert.equal(normalizeHomeV2CrosschainCoin('bitcoin'), 'BTC')
assert.equal(normalizeHomeV2CrosschainCoin(' PirateChain '), 'ARRR')
for (const hostile of ['../admin/stop', 'btc/../..', 'BCH', '', null, 42, 'B T C']) {
  assert.throws(
    () => normalizeHomeV2CrosschainCoin(hostile as unknown),
    /coin must be one of/,
    `${String(hostile)} must be refused`,
  )
}
// Surrounding whitespace is trimmed, not rejected — apps pass values straight
// from config, and 'BTC ' is a typo, not an attack. The allowlist lookup after
// the trim is what makes that safe.
assert.equal(normalizeHomeV2CrosschainCoin('BTC '), 'BTC')

assert.equal(homeV2ForeignFeeEndpoint({}), 'feekb', 'an absent type means feekb, as in 1.x')
assert.equal(homeV2ForeignFeeEndpoint({ type: 'SEND' }), 'feekb')
assert.equal(homeV2ForeignFeeEndpoint({ type: 'feeCeiling' }), 'feerequired')
assert.throws(() => homeV2ForeignFeeEndpoint({ type: 'anything-else' }), /type must be/)

// Fee per KILOBYTE to fee per byte, rounding UP: rounding down would under-fee
// a trade and get it rejected by the foreign chain.
assert.equal(homeV2FeePerKbToFeePerByte('10000'), '0.0000001')
assert.equal(homeV2FeePerKbToFeePerByte('1000'), '0.00000001', '1000 atomic per KB is exactly 1 atomic per byte')
assert.equal(homeV2FeePerKbToFeePerByte('1001'), '0.00000002', 'ceiling division, not truncation')
assert.equal(homeV2FeePerKbToFeePerByte('1'), '0.00000001', 'anything above zero rounds up to one atomic unit')
assert.equal(homeV2FeePerKbToFeePerByte(20000), '0.0000002')
// 100_000_000_000 per KB is 100_000_000 atomic units per byte, which is
// exactly one whole coin — a whole-number result carries no decimal point.
assert.equal(homeV2FeePerKbToFeePerByte('100000000000'), '1')
assert.throws(() => homeV2FeePerKbToFeePerByte('0'), /greater than zero/)
assert.throws(() => homeV2FeePerKbToFeePerByte('-5'), /non-negative integer/)
assert.throws(() => homeV2FeePerKbToFeePerByte('1.5'), /non-negative integer/)
assert.throws(() => homeV2FeePerKbToFeePerByte(null), /non-negative integer/)

// Response projections.
const feeProjection = projectHomeV2CrosschainReadResult('GET_FOREIGN_FEE', { coin: 'BTC', type: 'TRADE' }, '10000')
assert.deepEqual({ ...(feeProjection as object) }, { fee: '0.0000001', feePerKb: '10000' })
assert.deepEqual(
  { ...(projectHomeV2CrosschainReadResult('GET_FOREIGN_FEE', { coin: 'BTC', type: 'feerequired' }, '25') as object) },
  { fee: '25' },
  'the feerequired endpoint is already a per-byte figure and is passed through',
)

// Both wallet apps do `if (Array.isArray(servers))`, so the wrapper is unwrapped.
assert.deepEqual(
  projectHomeV2CrosschainReadResult('GET_CROSSCHAIN_SERVER_INFO', {}, { servers: [{ hostname: 'a' }] }),
  [{ hostname: 'a' }],
)
// Anything that is not that wrapper is passed through untouched.
assert.deepEqual(projectHomeV2CrosschainReadResult('GET_CROSSCHAIN_SERVER_INFO', {}, [{ hostname: 'a' }]), [{ hostname: 'a' }])
assert.equal(projectHomeV2CrosschainReadResult('GET_SERVER_CONNECTION_HISTORY', {}, 'raw'), 'raw')

// Core reports foreign chains only; Home projects the QORT row in front.
const blockchains = projectHomeV2CrosschainReadResult(
  'GET_CROSSCHAIN_BLOCKCHAINS',
  {},
  [{ currencyCode: 'BTC', name: 'BITCOIN' }],
) as Record<string, unknown>[]
assert.equal(blockchains.length, 2)
assert.equal(blockchains[0].currencyCode, 'QORT')
assert.equal(blockchains[0].type, 'QORTAL_PUBLIC_NODE')
assert.equal(blockchains[1].currencyCode, 'BTC')
// Every row gains the Home wallet capability projection.
assert.ok(blockchains.every((row) => !!row.homeWallet))

// Pinned field-by-field: this constant is a restatement of the 1.x literal at
// electron/qdn.ts:629-643, so any drift must show up as a diff here.
assert.deepEqual({ ...HOME_V2_QORTAL_PUBLIC_NODE_BLOCKCHAIN_INFO }, {
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

// ---------------------------------------------------------------------------
// 6. Group moderation reads

assert.equal(buildHomeV2ChainReadPath('GET_GROUP_BANS', { groupId: 14 }), '/groups/bans/14')
assert.equal(buildHomeV2ChainReadPath('GET_GROUP_KICKS', { groupId: 14 }), '/groups/kicks/14')
assert.equal(
  buildHomeV2ChainReadPath('GET_GROUP_KICKS', { groupId: 14, address: ACCOUNT_ADDRESS, limit: 5, reverse: true }),
  `/groups/kicks/14?address=${ACCOUNT_ADDRESS}&limit=5&reverse=true`,
)
assert.equal(
  buildHomeV2ChainReadPath('GET_MEMBER_BANS', { address: ACCOUNT_ADDRESS }),
  `/groups/bans/member?address=${ACCOUNT_ADDRESS}`,
)
assert.equal(
  buildHomeV2ChainReadPath('GET_MEMBER_KICKS', { address: ACCOUNT_ADDRESS, groupId: 3 }),
  `/groups/kicks/member?address=${ACCOUNT_ADDRESS}&groupId=3`,
)
// Page bounds are capped, and a bad address never reaches the query string.
assert.throws(() => buildHomeV2ChainReadPath('GET_GROUP_KICKS', { groupId: 14, limit: 5000 }), /between 0 and 100/)
assert.throws(() => buildHomeV2ChainReadPath('GET_MEMBER_BANS', { address: 'evil&x=1' }), /Address is invalid\./)
assert.throws(() => buildHomeV2ChainReadPath('GET_GROUP_BANS', { groupId: 0 }), /groupId/)
// A pre-2018 millisecond bound is refused before the request, as for chat.
assert.throws(
  () => buildHomeV2ChainReadPath('GET_GROUP_KICKS', { groupId: 14, before: 1000 }),
  /millisecond timestamp/,
)

// Only the two member-scoped reads default their address to the selected
// account; the older member-scoped reads keep requiring one explicitly.
assert.deepEqual([...HOME_V2_SELF_DEFAULTING_ADDRESS_ACTIONS], ['GET_MEMBER_BANS', 'GET_MEMBER_KICKS'])
assert.ok(homeV2ChainReadNeedsSelectedAddress('GET_MEMBER_BANS', {}))
assert.ok(!homeV2ChainReadNeedsSelectedAddress('GET_MEMBER_BANS', { address: ACCOUNT_ADDRESS }))
assert.ok(!homeV2ChainReadNeedsSelectedAddress('GET_ACCOUNT_GROUPS', {}))
assert.deepEqual(withHomeV2SelectedAddress({ groupId: 1 }, ACCOUNT_ADDRESS), { groupId: 1, address: ACCOUNT_ADDRESS })
assert.throws(() => withHomeV2SelectedAddress({}, null), /no account is selected/)

// ---------------------------------------------------------------------------
// 7. Trust reads

assert.deepEqual([...HOME_V2_RATING_READ_ACTIONS], ['GET_ACCOUNT_RATING', 'GET_RESOURCE_RATING'])
assert.ok(isHomeV2RatingReadAction('GET_ACCOUNT_RATING'))
assert.ok(!isHomeV2RatingReadAction('RATE_ACCOUNT'), 'the rating WRITES are not restored here')
assert.ok(homeV2RatingReadNeedsSelectedAddress({}))
assert.ok(!homeV2RatingReadNeedsSelectedAddress({ rater: ACCOUNT_ADDRESS }))

const resourceRead = buildHomeV2RatingRead(
  'GET_RESOURCE_RATING',
  { service: 'app', name: 'Chat' },
  ACCOUNT_ADDRESS,
)
assert.equal(resourceRead.summaryPath, '/resource-ratings/summary?service=APP&name=Chat&identifier=default')
assert.equal(
  resourceRead.ratingPath,
  `/resource-ratings/rating?service=APP&name=Chat&identifier=default&rater=${ACCOUNT_ADDRESS}`,
)
assert.equal(resourceRead.ratingFallback, null)
assert.equal(resourceRead.meta.identifier, 'default', 'a blank identifier means "default", as Core keys it')

const accountRead = buildHomeV2RatingRead(
  'GET_ACCOUNT_RATING',
  { target: OTHER_ADDRESS, category: 'trust', rater: ACCOUNT_ADDRESS },
  null,
)
assert.equal(accountRead.summaryPath, `/account-ratings/summary?target=${OTHER_ADDRESS}&category=trust`)
assert.equal(
  accountRead.ratingPath,
  `/account-ratings?target=${OTHER_ADDRESS}&rater=${ACCOUNT_ADDRESS}&category=trust`,
)
// The account-rating half is a LIST, so its empty answer is [] not null.
assert.deepEqual(accountRead.ratingFallback, [])
assert.throws(
  () => buildHomeV2RatingRead('GET_ACCOUNT_RATING', { target: OTHER_ADDRESS }, null),
  /rater address is required/,
)
assert.throws(() => buildHomeV2RatingRead('GET_ACCOUNT_RATING', {}, ACCOUNT_ADDRESS), /Target address is required\./)

// Core says "not rated yet" three different ways; all become null.
assert.equal(normalizeHomeV2RatingSummary(null), null)
assert.equal(normalizeHomeV2RatingSummary(undefined), null)
assert.equal(normalizeHomeV2RatingSummary([]), null)
assert.equal(normalizeHomeV2RatingSummary({}), null)
assert.deepEqual(normalizeHomeV2RatingSummary({ averageRating: 4 }), { averageRating: 4 })
assert.deepEqual(normalizeHomeV2RatingSummary([{ rating: 1 }]), [{ rating: 1 }])

const accountResult = buildHomeV2RatingReadResult(accountRead, {}, [{ rating: 1 }]) as Record<string, unknown>
assert.equal(accountResult.summary, null)
assert.deepEqual(accountResult.ratings, [{ rating: 1 }])
assert.equal(accountResult.target, OTHER_ADDRESS)
// A non-array rating body can never become the `ratings` list.
assert.deepEqual((buildHomeV2RatingReadResult(accountRead, null, 'oops') as Record<string, unknown>).ratings, [])

const resourceResult = buildHomeV2RatingReadResult(resourceRead, { averageRating: 3 }, null) as Record<string, unknown>
assert.deepEqual(resourceResult.summary, { averageRating: 3 })
assert.equal(resourceResult.rating, null)
assert.equal(resourceResult.service, 'APP')

// ---------------------------------------------------------------------------
// 8. Market prices

assert.ok(isHomeV2ChainReadAction('GET_PRICE'))
const priceRequest = normalizeHomeV2MarketPriceRequest({ coins: 'BTC,LTC', currencies: 'usd' })
assert.deepEqual(priceRequest.coins, ['BTC', 'LTC'])
assert.deepEqual(priceRequest.currencies, ['usd'])
assert.equal(priceRequest.include24hChange, false)
assert.deepEqual(normalizeHomeV2MarketPriceRequest({ coin: 'btc' }).coins, ['BTC'])
assert.deepEqual(normalizeHomeV2MarketPriceRequest({ coin: 'BTC' }).currencies, ['usd'], 'usd is the default currency')
assert.equal(normalizeHomeV2MarketPriceRequest({ coin: 'BTC', include24hChange: true }).include24hChange, true)
assert.throws(() => normalizeHomeV2MarketPriceRequest({ coin: 'NOTACOIN' }), /Unsupported market price coin/)
assert.throws(() => normalizeHomeV2MarketPriceRequest({ coin: 'BTC', currency: 'xxx' }), /Unsupported market price currency/)

// The outbound URL is built entirely from allowlisted values and carries NO
// user data — no address, account id, public key, app identity or node URL.
const priceUrl = buildHomeV2MarketPriceUrl(normalizeHomeV2MarketPriceRequest({ coins: 'BTC', currencies: 'usd' }))
assert.ok(priceUrl.startsWith(`${HOME_V2_COINGECKO_ORIGIN}/api/v3/simple/price?`))
const priceParams = new URL(priceUrl).searchParams
assert.deepEqual([...priceParams.keys()].sort(), ['ids', 'include_last_updated_at', 'vs_currencies'])
assert.equal(priceParams.get('ids'), 'bitcoin')
assert.equal(priceParams.get('vs_currencies'), 'usd')
for (const leak of [ACCOUNT_ADDRESS, OTHER_ADDRESS, AT_ADDRESS, 'qdn://', 'accountId', 'publicKey']) {
  assert.ok(!priceUrl.includes(leak), `the market price URL must not carry ${leak}`)
}

// Cache behavior, with an injected clock and an injected fetch so neither a
// timer nor a network is involved.
let now = 1_000_000
let fetchCount = 0
const cache = new HomeV2MarketPriceCache(() => now)
const payload = { bitcoin: { usd: 100, last_updated_at: 5 } }
const okFetch = async () => {
  fetchCount += 1
  return { ok: true, payload, status: 200 }
}
const first = await cache.read(priceRequest, okFetch)
assert.equal(fetchCount, 1)
assert.equal(first.cacheHit, false)
assert.equal(first.stale, false)
assert.equal(first.fetchedAt, 1_000_000)

// A second read inside the TTL is served from cache: no second outbound call.
const second = await cache.read(priceRequest, okFetch)
assert.equal(fetchCount, 1, 'a cached read must not reach the network')
assert.equal(second.cacheHit, true)
assert.equal(second.stale, false)

// A different coin/currency set is a different cache key.
await cache.read(normalizeHomeV2MarketPriceRequest({ coins: 'LTC' }), okFetch)
assert.equal(fetchCount, 2)

// Past the TTL, it fetches again.
now += MARKET_PRICE_CACHE_TTL_MS + 1
await cache.read(priceRequest, okFetch)
assert.equal(fetchCount, 3)

// A failure with something cached serves the stale copy and says so, rather
// than failing the app's call outright. The clock has to move past the TTL
// first: inside it, the cache answers and the fetch is never attempted at all.
now += MARKET_PRICE_CACHE_TTL_MS + 1
const stale = await cache.read(priceRequest, async () => {
  throw new Error('network down')
})
assert.equal(stale.cacheHit, true)
assert.equal(stale.stale, true)
assert.equal(stale.staleReason, 'network down')

// A non-2xx counts as a failure, not as an empty price list.
now += MARKET_PRICE_CACHE_TTL_MS + 1
const rateLimited = await cache.read(priceRequest, async () => ({ ok: false, payload: null, status: 429 }))
assert.equal(rateLimited.stale, true)
assert.match(String(rateLimited.staleReason), /HTTP 429/)

// A failure with NOTHING cached propagates: an app must not be told a made-up
// price of zero.
const coldCache = new HomeV2MarketPriceCache(() => now)
await assert.rejects(
  coldCache.read(priceRequest, async () => {
    throw new Error('network down')
  }),
  /network down/,
)

// ---------------------------------------------------------------------------
// 9. SEND_MESSAGE validation

assert.ok(isHomeV2AtMessageAction('SEND_MESSAGE'))
assert.ok(!isHomeV2AtMessageAction('SEND_CHAT_MESSAGE'))

// The exact call qortium-casino makes (website/src/bridge.js:149-160).
const atMessage = normalizeHomeV2AtMessageRequest('qdnRequest', {
  recipient: AT_ADDRESS,
  message: 'SMPL faucet claim',
})
assert.equal(atMessage.recipient, AT_ADDRESS)
assert.equal(atMessage.message, 'SMPL faucet claim')

// AT recipients only. This is the check that keeps SEND_MESSAGE from becoming
// a general "message any user" primitive.
assert.throws(
  () => normalizeHomeV2AtMessageRequest('qdnRequest', { recipient: ACCOUNT_ADDRESS, message: 'hi' }),
  /must be a Qortium AT address/,
  'an ordinary Q account address must be refused',
)
assert.throws(
  () => normalizeHomeV2AtMessageRequest('qdnRequest', { recipient: 'AG9QWs1tEBTmXoH2rrQXwV4LdMAM99o5WE', message: 'hi' }),
  /invalid checksum/,
  'a one-character corruption of a real AT address must fail the checksum',
)
assert.throws(
  () => normalizeHomeV2AtMessageRequest('qdnRequest', { recipient: 'AAAA', message: 'hi' }),
  /must decode to 25 bytes/,
)
assert.throws(
  () => normalizeHomeV2AtMessageRequest('qdnRequest', { message: 'hi' }),
  /requires an AT recipient address/,
)
assert.throws(
  () => normalizeHomeV2AtMessageRequest('qdnRequest', { recipient: AT_ADDRESS, message: '' }),
  /non-empty message text/,
)
assert.throws(
  () => normalizeHomeV2AtMessageRequest('qdnRequest', { recipient: AT_ADDRESS, message: 'x'.repeat(4001) }),
  /exceeds the/,
)

// Qortium only: the serializer mirrors Qortium Core's MESSAGE layout.
assert.throws(
  () => normalizeHomeV2AtMessageRequest('qortalRequest', { recipient: AT_ADDRESS, message: 'hi' }),
  /not available on qortalRequest/,
)

// A payment or an encryption request is REFUSED, never ignored — an app that
// thought it attached one must not be told the send succeeded.
for (const [field, value] of [['amount', 5], ['assetId', 1], ['recipientPublicKey', 'abc'], ['chatReference', 'abc'], ['txGroupId', 3], ['groupId', 3]] as const) {
  assert.throws(
    () => normalizeHomeV2AtMessageRequest('qdnRequest', { recipient: AT_ADDRESS, message: 'hi', [field]: value }),
    /SEND_MESSAGE/,
    `${field} must be refused, not silently dropped`,
  )
}
assert.throws(
  () => normalizeHomeV2AtMessageRequest('qdnRequest', { recipient: AT_ADDRESS, message: 'hi', isEncrypted: true }),
  /plaintext only/,
)
assert.throws(
  () => normalizeHomeV2AtMessageRequest('qdnRequest', { recipient: AT_ADDRESS, message: 'hi', isText: false }),
  /UTF-8 text only/,
)
assert.throws(
  () => normalizeHomeV2AtMessageRequest('qdnRequest', { recipient: AT_ADDRESS, message: 'hi', fee: 1 }),
  /always fee 0/,
)
// fee: 0 is redundant but harmless, and the shipped caller may add it later.
assert.equal(
  normalizeHomeV2AtMessageRequest('qdnRequest', { recipient: AT_ADDRESS, message: 'hi', fee: 0 }).message,
  'hi',
)

// The MESSAGE byte layout, pinned because the bridge signs these bytes with
// `signTransactionWithNonce`, which stamps the nonce at a HARD-CODED offset of
// 48 (TRANSACTION_NONCE_OFFSET in accounts.ts). That offset is only correct
// because MESSAGE's header is txType(4) + timestamp(8) + txGroupId(4) +
// senderPublicKey(32) = 48, exactly like CHAT's. If the serializer ever grows
// or reorders a header field, the nonce would be stamped into the middle of
// the public key and Home would sign a transaction for the wrong sender —
// silently, since nothing else checks. This test is that check.
{
  const senderPublicKey = '9NKfLpKvKJGVvLKQ6bYFa6VbTL3cRAHT2eGmSKA3Vd1B'
  const timestamp = 1_756_000_000_000
  const bytes = buildUnsignedQortiumAtMessageTransactionBytes({
    message: 'SMPL faucet claim',
    recipient: AT_ADDRESS,
    senderPublicKey,
    timestamp,
  })
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  assert.equal(view.getInt32(0, false), 17, 'MESSAGE transaction type')
  assert.equal(Number(view.getBigInt64(4, false)), timestamp)
  assert.equal(view.getInt32(12, false), 0, 'MESSAGE is always sent outside a transaction group')
  assert.equal(
    view.getUint32(48, false),
    0,
    'the nonce placeholder must sit at offset 48, where signTransactionWithNonce stamps it',
  )
  assert.equal(bytes[52], 1, 'has-recipient flag follows the nonce')
  assert.equal(bytes[53], 23, 'the recipient begins at 53 and carries AT address version 23')
}

// The prompt shows short messages whole and marks truncation of long ones.
assert.equal(homeV2AtMessagePreview('SMPL faucet claim'), 'SMPL faucet claim')
const longPreview = homeV2AtMessagePreview('x'.repeat(HOME_V2_AT_MESSAGE_PREVIEW_MAX_CHARS + 50))
assert.equal(longPreview.length, HOME_V2_AT_MESSAGE_PREVIEW_MAX_CHARS + 1)
assert.ok(longPreview.endsWith('…'), 'a truncated preview must say so')

// ---------------------------------------------------------------------------
// 10. Source pins

// GET_USER_WALLET must never touch key material. Home 1.x's foreign branch
// derived an HD wallet right here; the v2 handler must contain no trace of
// that machinery.
const walletHandler = bridgeSource.slice(
  bridgeSource.indexOf("if (action === 'GET_USER_WALLET')"),
  bridgeSource.indexOf("if (action === 'GET_SELECTED_ACCOUNT'"),
)
assert.ok(walletHandler.length > 80, 'the GET_USER_WALLET handler must be locatable in the bridge source')
for (const forbidden of [
  'getAccountSecretKey',
  'getAccountSigningKey',
  'secretKey',
  'seed',
  'xprv',
  'xpub',
  'privateKey',
  'deriveForeignWalletRuntime',
  'getForeignWalletCrypto',
]) {
  assert.ok(
    !walletHandler.includes(forbidden),
    `the GET_USER_WALLET handler must not reference ${forbidden}`,
  )
}
// It must also not reach a node: the address comes from the local profile.
assert.ok(!walletHandler.includes('fetchRead'), 'GET_USER_WALLET must not call a node')

// The whole wallet-actions module must be free of key-derivation imports.
const walletModuleSource = readRepoSource('../electron/home-v2-wallet-actions.ts', './home-v2-wallet-actions.ts')
for (const forbidden of ['foreign-wallets', 'accounts.js', 'secretKey', 'nacl']) {
  assert.ok(!walletModuleSource.includes(forbidden), `home-v2-wallet-actions must not import or mention ${forbidden}`)
}

// The market-price modules must carry no user-identifying field anywhere: not
// in the URL builder, not in a header, not in a cache key.
//
const priceModuleCode = stripComments(
  readRepoSource('../electron/home-v2-market-prices.ts', './home-v2-market-prices.ts'),
)
const coinGeckoModuleCode = stripComments(readRepoSource('../electron/market-prices.ts', './market-prices.ts'))
for (const forbidden of ['accountId', 'publicKey', 'address', 'appIdentity', 'resourceUrl', 'nodeApiUrl', 'Cookie', 'User-Agent']) {
  assert.ok(!priceModuleCode.includes(forbidden), `home-v2-market-prices must not reference ${forbidden}`)
  assert.ok(!coinGeckoModuleCode.includes(forbidden), `market-prices must not reference ${forbidden}`)
}
// Exactly one outbound host is reachable from the price path.
assert.equal((priceModuleCode.match(/https:\/\//g) ?? []).length, 1)
assert.ok(priceModuleCode.includes("HOME_V2_COINGECKO_ORIGIN = 'https://api.coingecko.com'"))
assert.equal((coinGeckoModuleCode.match(/https?:\/\//g) ?? []).length, 0, 'the pure module builds paths, never absolute URLs')
// And the bridge must use plain fetch for it, never the node-trust fetch:
// nodeFetch carries Home's node TLS pinning, which must not be extended to a
// third-party host.
const priceHandler = stripComments(
  sliceAfter(bridgeSource, 'async function readHomeV2MarketPrices', 1_200, 'price handler'),
)
assert.ok(priceHandler.includes('await fetch(url,'), 'market prices must use the plain global fetch')
assert.ok(!priceHandler.includes('nodeFetch'), 'market prices must not use nodeFetch')

console.log('Home v2 tier-2 action tests passed.')
