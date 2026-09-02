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
  buildHomeV2MarketPriceSupersetUrl,
  normalizeHomeV2MarketPriceRequest,
  HomeV2MarketPriceCache,
  HOME_V2_COINGECKO_ORIGIN,
} from './home-v2-market-prices.js'
import { MARKET_PRICE_CACHE_TTL_MS } from './market-prices.js'
import {
  homeV2AtMessageByteLength,
  isHomeV2AtMessageAction,
  normalizeHomeV2AtMessageRequest,
} from './home-v2-at-message-actions.js'
import { buildUnsignedQortiumAtMessageTransactionBytes } from './qdn-at-message.js'
import { homeV2PermissionGrantFamily, HOME_V2_PERMISSIONLESS_ACTIONS } from './home-v2-session-grants.js'
import { HOME_V2_JOURNALED_MUTATIONS } from './home-v2-transaction-journal.js'
import { HOME_V2_ROUTE_INDEPENDENT_ACTIONS } from './home-v2-app-runtime.js'
import {
  isHomeV2TrustedForeignWalletRoute,
  normalizeHomeV2ForeignServerRequest,
  normalizeHomeV2ForeignWalletCoin,
} from './home-v2-foreign-wallet-actions.js'

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

// PREVIEW_QDN_PUBLISH_SOURCE is now advertised. The deferral's OWN stated
// precondition -- "a faithful port needs a v2 preview surface that does not
// exist yet, and a handler that returns true while showing the user nothing
// would be worse than an honest refusal" -- is what changed: previews now open
// as an app TAB, the one surface that can render a website. The resource
// viewer still cannot, which is exactly why this is not wired to it.
assert.ok(qdnActions.includes('PREVIEW_QDN_PUBLISH_SOURCE'))
assert.ok(qortalActions.includes('PREVIEW_QDN_PUBLISH_SOURCE'))

// Foreign receive/read/server management is qdnRequest-only. The same Wallet
// app may be published on either QDN because Home injects both bridge globals;
// QORT remains on qortalRequest and foreign send remains unavailable.
for (const action of ['GET_WALLET_BALANCE', 'GET_USER_WALLET_INFO', 'GET_USER_WALLET_TRANSACTIONS', 'SET_CURRENT_FOREIGN_SERVER']) {
  assert.ok(qdnActions.includes(action), `${action} must be advertised on qdnRequest`)
  assert.ok(!qortalActions.includes(action), `${action} must not be advertised on qortalRequest`)
}
assert.ok(qdnActions.includes('SEND_COIN'), 'native SEND_COIN is restored on qdnRequest')
assert.ok(!qortalActions.includes('SEND_COIN'), 'SEND_COIN is not a qortalRequest action; SEND_QORT is')
assert.ok(qortalActions.includes('SEND_QORT'), 'SEND_QORT is restored on qortalRequest')
assert.ok(qortalActions.includes('TRANSFER_ASSET'), 'Qortal asset transfers are restored on qortalRequest')
assert.ok(!qdnActions.includes('SEND_QORT'), 'SEND_QORT must NOT be advertised on qdnRequest: its serializer is Qortal-specific')

for (const coin of ['BTC', 'LTC', 'DOGE', 'DGB', 'RVN', 'DASH', 'NMC', 'FIRO']) {
  assert.equal(normalizeHomeV2ForeignWalletCoin({ coin: coin.toLowerCase() }), coin)
}
assert.equal(normalizeHomeV2ForeignWalletCoin({ payload: { coin: 'btc' } }), 'BTC')
for (const coin of ['ARRR', 'BCH', '', null]) {
  assert.throws(() => normalizeHomeV2ForeignWalletCoin({ coin }), /Unsupported foreign wallet coin/)
}
assert.deepEqual(normalizeHomeV2ForeignServerRequest({
  coin: 'BTC',
  server: { connection: 'ssl', host: 'electrum.example', port: '50002' },
}), {
  connectionType: 'SSL',
  hostName: 'electrum.example',
  port: 50002,
})
for (const request of [
  { server: { connection: 'SSL', host: '', port: 50002 } },
  { server: { connection: 'SSL', host: 'bad host', port: 50002 } },
  { server: { connection: 'SSL', host: 'electrum.example', port: 0 } },
  { server: { connection: 'UDP', host: 'electrum.example', port: 50002 } },
  { server: { certificate: 'not-a-sha256', connection: 'SSL', host: 'electrum.example', port: 50002 } },
]) {
  assert.throws(() => normalizeHomeV2ForeignServerRequest(request))
}
assert.equal(isHomeV2TrustedForeignWalletRoute({ adminTrusted: true, reachable: true }), true)
assert.equal(isHomeV2TrustedForeignWalletRoute({ adminTrusted: false, reachable: true }), false)
assert.equal(isHomeV2TrustedForeignWalletRoute({ adminTrusted: true, reachable: false }), false)

// No duplicates crept in while editing two long literal lists.
for (const [label, actions] of [['qdnRequest', qdnActions], ['qortalRequest', qortalActions]] as const) {
  assert.equal(new Set(actions).size, actions.length, `${label} catalogue must not contain duplicates`)
}

// ---------------------------------------------------------------------------
// 2. Permission posture pins

assert.ok(
  (HOME_V2_PERMISSIONLESS_ACTIONS as readonly string[]).includes('GET_USER_WALLET'),
  'native GET_USER_WALLET remains permissionless; the foreign branch forces a separate prompt',
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
assert.ok(bridgeSource.includes("kind: 'foreign-wallet-read'"))
assert.ok(bridgeSource.includes('deriveForeignWalletPublicRuntime'))
assert.ok(!sliceAfter(bridgeSource, 'async function deriveHomeV2ForeignWallet', 5000, 'foreign wallet bridge').includes('deriveForeignWalletRuntime('))
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

// FIX 2 — the bridge must disclose the FULL message, never a truncated
// preview: what the user approves must be exactly what is signed. The module
// no longer exports a truncating preview helper.
//
// The displayed form is ESCAPED (2026-08-27): the renderer prints this row
// as-is, so a raw message could use bidi controls to reorder what the user
// reads while the original bytes are what get signed. It is escaped at the
// MESSAGE cap rather than the ordinary row cap, because a 4,000-BYTE message
// can escape past 4,000 characters and must still be displayable.
assert.ok(
  /messagePreview: homeV2PromptText\(request\.message, 'The message text', HOME_V2_MESSAGE_PROMPT_MAX_CHARS\)/
    .test(bridgeSource),
  'the SEND_MESSAGE prompt must show the full message, escaped for display',
)
// And the locally-built bytes are verified before AND after stamping: Core has
// no MESSAGE builder to cross-check against.
assert.equal(
  (bridgeSource.match(/assertUnsignedQortiumAtMessageTransaction\(/g) ?? []).length,
  2,
  'the MESSAGE bytes must be verified unstamped and stamped before signing',
)
const atMessageModule = readRepoSource('../electron/home-v2-at-message-actions.ts', './home-v2-at-message-actions.ts')
assert.ok(
  !/homeV2AtMessagePreview/.test(atMessageModule),
  'the truncating preview helper must be gone',
)
assert.ok(
  !/exact text being sent/.test(liveAppSource),
  'the prompt summary must not claim to show the "exact text" — it now shows all of it',
)
// The Message row is disclosed in the bounded scrollable field, with a byte
// count beside it, so a long message neither hides content nor buries the
// buttons.
assert.ok(
  liveAppSource.includes("value: String(value.chatMessagePreview), variant: 'scroll'"),
  'the SEND_MESSAGE Message row must use the scrollable variant',
)
assert.ok(
  liveAppSource.includes("label: 'Message size'"),
  'the prompt must show a message byte count',
)

// FIX 5 — the journal-conflict lookup must run only for an action the context
// actually allows, so a widget calling a denied journaled mutation cannot be
// handed a retained signature. The block is gated on the contextual action
// list, which is computed before it.
assert.ok(
  /contextualActions\.includes\(action\) &&\s*isHomeV2JournaledMutation\(action\)/.test(bridgeSource),
  'the journal-conflict block must be gated on contextual availability, before any signature is revealed',
)
// Anchored on the DISPATCHER's lookup specifically. There is a second, later
// call site inside the batch-publish handler (one per item, keyed on that
// item's own coordinate), which runs after the dispatcher has already
// authorized the action — so an assertion on "the first occurrence anywhere in
// the file" would be about the wrong call.
assert.ok(
  bridgeSource.indexOf('const contextualActions =') !== -1 &&
    bridgeSource.indexOf('const contextualActions =') <
      bridgeSource.indexOf('const pending = findStoredHomeV2PendingTransactionConflict(app.getPath'),
  'contextual availability must be computed before the dispatcher journal lookup call',
)
// And the per-item batch gate exists: the dispatcher's gate ran against the
// BATCH request, so it cannot see a coordinate an earlier item of the same
// batch has just retained an unknown outcome for.
assert.ok(
  /const pendingItem = findStoredHomeV2PendingTransactionConflict\(app\.getPath/.test(bridgeSource),
  'batch publishing must re-check the journal per item, not once for the batch',
)

// The Android UNLOCK handler binds its route freshness recheck to the network
// the REQUEST is on, not a fixed chain. UNLOCK is advertised on both protocols,
// so a qortalRequest unlock must snapshot and recheck the QORTAL route, not
// Qortium. This lives only in the React Android-host wrapper (not unit-testable
// without rendering), so it is pinned by source: the handler must derive a
// protocol-selected `targetNetwork` and both node snapshots inside it must read
// `[targetNetwork]` rather than a hard-coded `.qortium`.
{
  const unlockHandler = sliceAfter(
    liveAppSource,
    "if (action === 'UNLOCK_SELECTED_ACCOUNT') {\n        // No protocol guard",
    3400,
    'android unlock handler',
  )
  assert.ok(
    unlockHandler.includes("const targetNetwork: NetworkId = protocol === 'qortalRequest' ? 'qortal' : 'qortium'"),
    'the Android unlock handler must derive its network from the request protocol',
  )
  const beforeSnapshot = unlockHandler.includes('parseHomeV2NodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]')
  assert.ok(beforeSnapshot, 'the unlock before-snapshot must read the protocol-selected network')
  // Neither the before- nor the after-snapshot may hard-code a chain: every
  // getSnapshot() read in this handler must be indexed by [targetNetwork].
  assert.ok(
    !/parseHomeV2NodesSnapshot\(await nodeClient\.getSnapshot\(\)\)\.qortium/.test(unlockHandler) &&
      !/parseHomeV2NodesSnapshot\(await nodeClient\.getSnapshot\(\)\)\.qortal\b/.test(unlockHandler),
    'the Android unlock handler must not snapshot a hard-coded chain route',
  )
  // Both the before and after snapshots use the same protocol-derived network.
  const targetNetworkSnapshots = unlockHandler.match(
    /parseHomeV2NodesSnapshot\(await nodeClient\.getSnapshot\(\)\)\[targetNetwork\]/g,
  )
  assert.ok(
    targetNetworkSnapshots !== null && targetNetworkSnapshots.length >= 2,
    'both the before- and after-approval unlock snapshots must read [targetNetwork]',
  )
}

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
assert.throws(() => resolveHomeV2AccountReadAddress({}, null), /Address is required/)

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
// FIX 6 — a JS number is trusted only when it is an exact integer. A value
// past MAX_SAFE_INTEGER has already lost precision, and String() on it would
// produce exponent notation or a rounded figure; converting that to a fee
// would silently sign off on the wrong number. Such a value must be sent as a
// decimal string (JSON-lossless) or a bigint instead.
assert.equal(homeV2FeePerKbToFeePerByte(9_007_199_254_740_991n), '90071.99254741', 'a bigint is accepted exactly')
assert.equal(
  homeV2FeePerKbToFeePerByte('90071992547409910000'),
  '900719925.4740991',
  'a large decimal string is accepted exactly',
)
assert.throws(() => homeV2FeePerKbToFeePerByte(9_007_199_254_740_993), /not an exact integer/, 'an unsafe integer number is refused')
assert.throws(() => homeV2FeePerKbToFeePerByte(1e21), /not an exact integer/, 'exponent-scale numbers are refused')
assert.throws(() => homeV2FeePerKbToFeePerByte(1.5), /not an exact integer/, 'a fractional number is refused')

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
assert.throws(() => withHomeV2SelectedAddress({}, null), /Address is required/)

// ---------------------------------------------------------------------------
// 7. Trust reads

assert.deepEqual([...HOME_V2_RATING_READ_ACTIONS], ['GET_ACCOUNT_RATING', 'GET_RESOURCE_RATING'])
assert.ok(isHomeV2RatingReadAction('GET_ACCOUNT_RATING'))
assert.ok(!isHomeV2RatingReadAction('RATE_ACCOUNT'), 'the rating WRITES are their own family, not reads')
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

// The per-request URL builder still carries NO user data — no address,
// account id, public key, app identity or node URL — but note the cache no
// longer FETCHES it (see the superset URL below).
const priceUrl = buildHomeV2MarketPriceUrl(normalizeHomeV2MarketPriceRequest({ coins: 'BTC', currencies: 'usd' }))
assert.ok(priceUrl.startsWith(`${HOME_V2_COINGECKO_ORIGIN}/api/v3/simple/price?`))
const priceParams = new URL(priceUrl).searchParams
assert.deepEqual([...priceParams.keys()].sort(), ['ids', 'include_last_updated_at', 'vs_currencies'])
assert.equal(priceParams.get('ids'), 'bitcoin')
assert.equal(priceParams.get('vs_currencies'), 'usd')

// FIX 3 — the cache fetches exactly ONE fixed superset URL, and that is the
// only URL that ever leaves the machine. It is a compile-time constant: no app
// input reaches it, so an app cannot vary coins/currencies/change to change
// what is sent (a fingerprint/beacon channel the per-subset design left open).
const supersetUrl = buildHomeV2MarketPriceSupersetUrl()
assert.ok(supersetUrl.startsWith(`${HOME_V2_COINGECKO_ORIGIN}/api/v3/simple/price?`))
assert.equal(buildHomeV2MarketPriceSupersetUrl(), supersetUrl, 'the superset URL is constant')
const supersetParams = new URL(supersetUrl).searchParams
assert.equal(supersetParams.get('include_24hr_change'), 'true', 'the superset always includes change')
assert.ok(supersetParams.get('ids')!.split(',').length >= 15, 'the superset covers every supported coin')
assert.ok(supersetParams.get('vs_currencies')!.split(',').length >= 30, 'the superset covers every supported currency')
for (const leak of [ACCOUNT_ADDRESS, OTHER_ADDRESS, AT_ADDRESS, 'qdn://', 'accountId', 'publicKey']) {
  assert.ok(!priceUrl.includes(leak), `the per-request URL must not carry ${leak}`)
  assert.ok(!supersetUrl.includes(leak), `the superset URL must not carry ${leak}`)
}

// Cache behavior, with an injected clock and an injected fetch so neither a
// timer nor a network is involved.
let now = 1_000_000
let fetchCount = 0
let lastFetchedUrl = ''
// A superset payload: many coins, many currencies, with change fields.
const payload = {
  bitcoin: { usd: 100, eur: 90, usd_24h_change: 1.2, last_updated_at: 5 },
  litecoin: { usd: 70, eur: 63, last_updated_at: 5 },
}
const cache = new HomeV2MarketPriceCache(() => now)
const okFetch = async (url: string) => {
  fetchCount += 1
  lastFetchedUrl = url
  return { ok: true, payload, status: 200 }
}
const first = await cache.read(priceRequest, okFetch)
assert.equal(fetchCount, 1)
assert.equal(lastFetchedUrl, supersetUrl, 'the cache fetches the superset URL, not the per-request one')
assert.equal(first.cacheHit, false)
assert.equal(first.stale, false)
assert.equal(first.fetchedAt, 1_000_000)
assert.equal(first.prices.BTC?.usd, 100)

// A second read inside the TTL is served from cache: no second outbound call.
const second = await cache.read(priceRequest, okFetch)
assert.equal(fetchCount, 1, 'a cached read must not reach the network')
assert.equal(second.cacheHit, true)
assert.equal(second.stale, false)

// The beacon fix: a DIFFERENT coin/currency subset is projected from the SAME
// superset, with NO new outbound request. Under the old per-subset cache this
// was a second fetch; rotating subsets was the beacon channel.
const projected = await cache.read(normalizeHomeV2MarketPriceRequest({ coins: 'LTC', currencies: 'eur' }), okFetch)
assert.equal(fetchCount, 1, 'rotating coins/currencies must NOT trigger a new fetch')
assert.equal(projected.cacheHit, true)
assert.equal(projected.prices.LTC?.eur, 63)

// Concurrent identical-window reads coalesce onto ONE in-flight fetch.
now += MARKET_PRICE_CACHE_TTL_MS + 1
let concurrentFetches = 0
const slowFetch = async (url: string) => {
  concurrentFetches += 1
  lastFetchedUrl = url
  await new Promise((resolve) => setTimeout(resolve, 5))
  return { ok: true, payload, status: 200 }
}
await Promise.all([
  cache.read(priceRequest, slowFetch),
  cache.read(normalizeHomeV2MarketPriceRequest({ coins: 'LTC' }), slowFetch),
  cache.read(priceRequest, slowFetch),
])
assert.equal(concurrentFetches, 1, 'concurrent reads after expiry must share one fetch')

// A failure with something cached serves the stale copy and says so.
now += MARKET_PRICE_CACHE_TTL_MS + 1
let failAttempts = 0
const failFetch = async () => {
  failAttempts += 1
  throw new Error('network down')
}
const stale = await cache.read(priceRequest, failFetch)
assert.equal(failAttempts, 1)
assert.equal(stale.cacheHit, true)
assert.equal(stale.stale, true)
assert.match(String(stale.staleReason), /network down/)

// The global rate floor: a SECOND failing attempt within the interval is
// suppressed entirely — the cold-failure beacon the per-subset cache left open
// (an app could keep firing while CoinGecko was down). The stale copy is
// served without a new outbound request.
const stale2 = await cache.read(priceRequest, failFetch)
assert.equal(failAttempts, 1, 'a repeated failing attempt within the interval must not fetch again')
assert.equal(stale2.stale, true)

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
// And a cold cache under repeated failure fires only ONE outbound attempt per
// interval, not one per call.
now += MARKET_PRICE_CACHE_TTL_MS + 1
let coldFailAttempts = 0
const coldFailCache = new HomeV2MarketPriceCache(() => now)
await assert.rejects(coldFailCache.read(priceRequest, async () => { coldFailAttempts += 1; throw new Error('x') }))
await assert.rejects(coldFailCache.read(priceRequest, async () => { coldFailAttempts += 1; throw new Error('x') }))
assert.equal(coldFailAttempts, 1, 'repeated cold failures within the interval fire one attempt')

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

// A forbidden field hidden inside `payload` must be refused, not silently
// dropped. recipient/message are read payload-first (getRequestValue), so a
// top-level-only forbidden-field check let `{ payload: { amount, isEncrypted,
// groupId } }` through — the app would believe it sent a paid/encrypted
// message the serializer had quietly stripped. Every guard now reads both
// locations.
for (const field of ['amount', 'assetId', 'recipientPublicKey', 'chatReference', 'txGroupId', 'groupId']) {
  assert.throws(
    () => normalizeHomeV2AtMessageRequest('qdnRequest', { payload: { recipient: AT_ADDRESS, message: 'hi', [field]: 5 } }),
    /SEND_MESSAGE/,
    `${field} in payload must be refused`,
  )
}
assert.throws(
  () => normalizeHomeV2AtMessageRequest('qdnRequest', { payload: { recipient: AT_ADDRESS, message: 'hi', isEncrypted: true } }),
  /plaintext only/,
  'isEncrypted in payload must be refused',
)
assert.throws(
  () => normalizeHomeV2AtMessageRequest('qdnRequest', { recipient: AT_ADDRESS, message: 'hi', encrypt: true }),
  /plaintext only/,
  'the encrypt alias must be refused',
)
assert.throws(
  () => normalizeHomeV2AtMessageRequest('qdnRequest', { payload: { recipient: AT_ADDRESS, message: 'hi', isText: false } }),
  /UTF-8 text only/,
  'isText:false in payload must be refused',
)
assert.throws(
  () => normalizeHomeV2AtMessageRequest('qdnRequest', { payload: { recipient: AT_ADDRESS, message: 'hi', fee: 3 } }),
  /always fee 0/,
  'a non-zero fee in payload must be refused',
)
// A string-boolean is not a boolean: `isEncrypted: 'true'` must not slip past
// the `=== true` check as a truthy-but-not-true value.
assert.throws(
  () => normalizeHomeV2AtMessageRequest('qdnRequest', { recipient: AT_ADDRESS, message: 'hi', isEncrypted: 'true' }),
  /must be a boolean/,
  'a string boolean flag must be refused',
)
// A recipient given in BOTH places with different values is ambiguous: the
// disclosed and signed value would silently be the payload one. Refuse it.
assert.throws(
  () => normalizeHomeV2AtMessageRequest('qdnRequest', {
    recipient: AT_ADDRESS,
    payload: { recipient: 'AG9QWs1tEBTmXoH2rrQXwV4LdMAM99o5WE', message: 'hi' },
  }),
  /twice with different values/,
  'a conflicting duplicate recipient must be refused',
)
// The same field in both places with the SAME value is harmless.
assert.equal(
  normalizeHomeV2AtMessageRequest('qdnRequest', { recipient: AT_ADDRESS, payload: { recipient: AT_ADDRESS, message: 'hi' } }).message,
  'hi',
)
// A whole request delivered through `payload` (no top-level fields) still works.
assert.equal(
  normalizeHomeV2AtMessageRequest('qdnRequest', { payload: { recipient: AT_ADDRESS, message: 'SMPL faucet claim' } }).recipient,
  AT_ADDRESS,
)

// FIX 7 — full golden vector for the complete unsigned MESSAGE bytes.
//
// The bridge signs these bytes with `signTransactionWithNonce`, which stamps
// the nonce at a HARD-CODED offset of 48 (TRANSACTION_NONCE_OFFSET,
// accounts.ts). That offset is only correct because the header is
// txType(4) + timestamp(8) + txGroupId(4) + senderPublicKey(32) = 48, exactly
// like CHAT's. A field growing or reordering ahead of the nonce would stamp it
// into the middle of the public key and sign for the WRONG sender, silently.
// Pinning the entire vector — not just a prefix — makes any such drift fail
// here. The expected hex was generated from the serializer and hand-decoded
// against Core's MessageTransactionTransformer field order.
{
  const senderPublicKey = '9NKfLpKvKJGVvLKQ6bYFa6VbTL3cRAHT2eGmSKA3Vd1B'
  const timestamp = 1_756_000_000_000
  const bytes = buildUnsignedQortiumAtMessageTransactionBytes({
    message: 'SMPL faucet claim',
    recipient: AT_ADDRESS,
    senderPublicKey,
    timestamp,
  })
  const hex = Buffer.from(bytes).toString('hex')
  const expected =
    '00000011' + // int32 type = 17 (MESSAGE)
    '00000198d9c19800' + // int64 timestamp = 1756000000000
    '00000000' + // int32 txGroupId = 0
    '7c53cae36ac7914adb83cd28636ba4c68a366eccd4748eca79b8bc6f2378573a' + // 32-byte sender public key
    '00000000' + // int32 nonce placeholder — offset 48, stamped by signTransactionWithNonce
    '01' + // has-recipient flag
    '17041280b7e4e4d5106a7e03f562a3ea852c1e1f5e73ab1f5e' + // 25-byte recipient AT address (version 0x17 = 23)
    '0000000000000000' + // int64 amount = 0 (no payment)
    '00000011' + // int32 data length = 17
    '534d504c2066617563657420636c61696d' + // "SMPL faucet claim"
    '00' + // isEncrypted = 0
    '01' + // isText = 1
    '0000000000000000' // int64 fee = 0
  assert.equal(hex, expected, 'the complete unsigned MESSAGE bytes must match the golden vector')
  assert.equal(bytes.length, 117)
  // The nonce offset the whole layout hinges on, asserted directly as well.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  assert.equal(view.getUint32(48, false), 0, 'nonce placeholder sits at offset 48')
}

// FIX 2 — the message is disclosed in full, so the byte-length helper the
// renderer echoes must count UTF-8 bytes (not code units): a multi-byte
// character is more than one byte, and the 4,000-byte transaction limit is a
// BYTE limit.
assert.equal(homeV2AtMessageByteLength('SMPL faucet claim'), 17)
assert.equal(homeV2AtMessageByteLength('héllo'), 6, 'é is two UTF-8 bytes')
assert.equal(homeV2AtMessageByteLength('😀'), 4)

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

// ---------------------------------------------------------------------------
// Foreign-coin sending: the wiring properties, asserted about the CODE
// because each of them is a negative that no return value can express.

// The foreign arm splits off BEFORE the native normalizer, the native
// per-account in-flight lock and the native journal fail-closed gate. If this
// order ever inverts, a foreign send starts taking (and being blocked by) the
// native payment machinery it deliberately stays out of.
const paymentHandler = stripComments(
  sliceAfter(bridgeSource, 'async function handleHomeV2PaymentAction', 4_000, 'payment handler'),
)
const foreignSplit = paymentHandler.indexOf('isHomeV2ForeignSendRequest(action, requestValue)')
assert.notEqual(foreignSplit, -1, 'the payment handler must route foreign sends out')
for (const later of [
  'homeV2PaymentJournalFailures.has(accountId)',
  'normalizeHomeV2NativeSendRequest(action, requestValue)',
  'homeV2PaymentSendLocks.add(lockKey)',
]) {
  const at = paymentHandler.indexOf(later)
  assert.notEqual(at, -1, `payment handler no longer contains ${later}`)
  assert.ok(at > foreignSplit, `the foreign split must come before ${later}`)
}

// The native Base58 journal is keyed on a top-level signature and an
// 'unknown' outcome. A foreign send carries neither, so it is kept out of
// both journal steps rather than relying on the result shape alone.
const dispatcherJournal = stripComments(
  sliceAfter(bridgeSource, 'const foreignSend = isHomeV2ForeignSendRequest(action, aliasedRequest)', 2_000, 'dispatcher'),
)
assert.ok(dispatcherJournal.includes('!foreignSend &&'))
assert.ok(dispatcherJournal.includes('context.accountId && !foreignSend'))

// The handler keeps the gates that DO apply, and never reaches for the
// account's ed25519 signing key: a foreign transaction is signed with a
// secp256k1 leaf key that never leaves foreign-wallets.ts.
const foreignSendHandler = stripComments(
  sliceAfter(bridgeSource, 'async function handleHomeV2ForeignSendAction', 6_500, 'foreign send handler'),
)
for (const required of [
  'assertHomeV2TrustedForeignWalletNode',
  'getAccountForeignWalletSeed',
  'seed.seed.fill(0)',
  "kind: 'foreign-send'",
]) {
  assert.ok(foreignSendHandler.includes(required), `foreign send handler must use ${required}`)
}
for (const forbidden of [
  'getAccountSecretKey',
  'homeV2PaymentSendLocks',
  'homeV2PaymentJournalFailures',
  'recordHomeV2PendingTransaction',
  'xprv58',
]) {
  assert.ok(!foreignSendHandler.includes(forbidden), `foreign send handler must not use ${forbidden}`)
}

// A foreign send is never a session or durable grant, and its grant family is
// its own so it cannot dedupe against a native payment prompt.
assert.ok(sliceAfter(bridgeSource, 'const singleRequestOnly =', 3_000, 'bridge')
  .includes("writeDetails?.kind === 'foreign-send'"))
assert.equal(homeV2PermissionGrantFamily('SEND_COIN'), 'payment.PAYMENT')
assert.equal(homeV2PermissionGrantFamily('SEND_COIN', 'foreign-send'), 'payment.FOREIGN_SEND')
assert.notEqual(
  homeV2PermissionGrantFamily('SEND_COIN', 'foreign-send'),
  homeV2PermissionGrantFamily('PAYMENT'),
)

// The shell validates the foreign grammar separately from the payment one and
// renders its own non-forgeable disclosure line.
for (const required of [
  "value.writeKind === 'foreign-send'",
  "value.writeKind !== 'foreign-send'",
  'FOREIGN_SEND_DETAIL_SEQUENCE, value.foreignSendDetails',
  'homeV2ForeignSendOperationLabel(value.foreignSendCoin)',
  'This one foreign-coin send only',
  'Wallet seed, private key, or extended private key (xprv)',
]) {
  assert.ok(liveAppSource.includes(required), `HomeV2LiveApp must contain ${required}`)
}

// Discovery must not advertise a send Home cannot perform. The bridge gates
// it on the trusted-Core predicate AND a selected, unlocked account, because
// the signing keys come from that account's seed.
const sendGate = stripComments(
  sliceAfter(bridgeSource, 'const foreignWalletDiscovery = action ===', 900, 'send capability gate'),
)
assert.ok(sendGate.includes('resolved.trust.trusted'))
assert.ok(sendGate.includes('isAccountUnlocked(context.accountId)'))
assert.ok(sendGate.includes('probeHomeV2ForeignSendRouteSupported('))
assert.ok(sendGate.includes('return { send: false, trusted: false }'), 'every failure path must answer send:false')

const sendingRows = projectHomeV2CrosschainReadResult(
  'GET_CROSSCHAIN_BLOCKCHAINS',
  {},
  [{ currencyCode: 'BTC' }, { currencyCode: 'BCH' }],
  true,
  true,
  true,
) as Array<Record<string, { send: boolean; sendMode: string }>>
assert.equal(sendingRows[1].homeWallet.send, true)
assert.equal(sendingRows[1].homeWallet.sendMode, 'HOME_LOCAL')
assert.equal(sendingRows[2].homeWallet.send, false)
for (const [trusted, sending] of [[false, false], [true, false], [false, true]] as const) {
  const rows = projectHomeV2CrosschainReadResult(
    'GET_CROSSCHAIN_BLOCKCHAINS',
    {},
    [{ currencyCode: 'BTC' }],
    true,
    trusted,
    sending,
  ) as Array<Record<string, { send: boolean; sendMode: string }>>
  assert.equal(rows[1].homeWallet.send, sending, `send must follow its own flag (trusted=${trusted})`)
  assert.equal(rows[1].homeWallet.sendMode, sending ? 'HOME_LOCAL' : 'NONE')
}

// The seed must never become a JS string. A hex or Base58 encoding of it is
// immutable and unzeroable, so it outlives every `fill(0)` the code does.
const foreignSendModule = stripComments(
  readRepoSource('../electron/home-v2-foreign-send.ts', './home-v2-foreign-send.ts'),
)
for (const forbidden of ['bytesToHex(seed', 'base58Encode(seed', 'seed.toString', 'JSON.stringify(seed', 'String(seed']) {
  assert.ok(!foreignSendModule.includes(forbidden), `the foreign send orchestrator must not stringify the seed: ${forbidden}`)
}
assert.ok(
  foreignSendModule.includes('containsByteSequence(hexToBytes(built.rawTransactionHex), seed)'),
  'the key-material check must compare bytes, not strings',
)

// The last checks before signing must come AFTER the post-approval re-read,
// because that read is a round trip during which anything can change.
const sendFlow = stripComments(
  sliceAfter(foreignSendModule, 'assertPlanUnchanged(plan, planAfter)', 1_500, 'foreign send flow'),
)
const finalRoute = sendFlow.indexOf('const routeFinal = await deps.resolveRoute()')
const finalValid = sendFlow.indexOf('if (!(await deps.isStillValid()))')
const signing = sendFlow.indexOf('deps.withWalletSeed((seed, nonce, walletVersion) => {')
assert.ok(finalRoute > -1 && finalValid > -1 && signing > -1)
assert.ok(finalRoute < signing && finalValid < signing, 'the final route and validity checks precede signing')
// Nothing may await between the last check and the signature: everything from
// the freshness assertion through the write-ahead record and the broadcast
// marker is synchronous, so no drift window can open inside it.
const settled = sendFlow.lastIndexOf('assertForeignSendFresh()')
assert.ok(settled > finalValid && settled < signing)
assert.ok(!sendFlow.slice(settled, signing).includes('await '), 'no await may open a drift window before signing')
const signToBroadcast = stripComments(
  sliceAfter(foreignSendModule, 'const signed = deps.withWalletSeed(', 4_000, 'sign to broadcast'),
)
const broadcastAt = signToBroadcast.indexOf('await deps.postTrusted(')
assert.ok(broadcastAt > -1)
assert.ok(
  !signToBroadcast.slice(0, broadcastAt).includes('await '),
  'signing, the write-ahead record and the attempt marker must all be synchronous',
)
assert.ok(
  signToBroadcast.indexOf('deps.journal.recordSigned(') < signToBroadcast.indexOf('deps.journal.recordBroadcastAttempt('),
  'the write-ahead record precedes the broadcast marker',
)
assert.ok(
  signToBroadcast.indexOf('deps.journal.recordBroadcastAttempt(') < broadcastAt,
  'the broadcast marker precedes the one broadcast',
)

// One parse cache, created once and passed to planning, re-planning AND
// signing, so no phase re-parses what another already did.
assert.equal((foreignSendModule.match(/createForeignWalletPreviousTransactionCache\(\)/g) ?? []).length, 1)
assert.equal((foreignSendModule.match(/cache: previousTransactions/g) ?? []).length, 3)

// Reconciliation runs BEFORE state is read or the user is asked.
const reconcileAt = foreignSendModule.indexOf('reconcileForeignWalletPendingTransactions(')
const contextAt = foreignSendModule.indexOf('const context = await readSpendContext(')
const approveAt = foreignSendModule.indexOf('await deps.approve(')
assert.ok(reconcileAt > -1 && reconcileAt < contextAt && reconcileAt < approveAt)

// Absolute bounds are applied on EVERY spend-context read, not just the first.
assert.ok(foreignSendModule.includes('assertForeignWalletContextWithinPolicy('))
assert.ok(
  stripComments(sliceAfter(foreignSendModule, 'async function readSpendContext', 1_200, 'spend context read'))
    .includes('assertForeignWalletContextWithinPolicy('),
  'the bounds must live inside the shared read, so the post-approval read gets them too',
)
assert.ok(foreignSendModule.includes('assertForeignWalletPlanWithinPolicy('))

// The retained-entry listing is shell-only: no QDN action names it.
assert.ok(!getHomeV2AppActions('qdnRequest').some((action) => /FOREIGN.*PENDING|PENDING.*FOREIGN/i.test(action)))
assert.ok(bridgeSource.includes("ipcMain.handle('home-v2-app:foreignWalletPendingTransactions'"))
assert.ok(
  !bridgeSource.includes("ipcMain.handle('home-v2-app:forgetForeignWalletPendingTransaction'"),
  'no app or shell channel may drop a retained foreign transaction',
)
// The ONE automatic removal that is not an exact-txid proof is the
// never-broadcast release, and it is gated on the stage AND the age inside the
// journal itself, so no caller can widen it.
const journalSource = stripComments(readRepoSource(
  '../electron/foreign-wallet-transaction-journal.ts',
  './foreign-wallet-transaction-journal.ts',
))
const releaseSource = stripComments(sliceAfter(
  journalSource,
  'export function releaseNeverBroadcastForeignWalletPendingTransaction',
  1_400,
  'never-broadcast release',
))
assert.ok(releaseSource.includes("entry.stage !== 'signed'"))
assert.ok(releaseSource.includes('at - entry.createdAt < minimumAgeMs'))
assert.ok(
  foreignSendModule.includes('const APPROVAL_FRESHNESS_MS = FOREIGN_WALLET_SEND_FRESHNESS_MS'),
  'the release window and the send freshness window must be one constant',
)

// Android must keep answering send:false until it has its own signer: the
// host passes five arguments, so the send flag stays at its safe default.
const androidCrosschain = stripComments(sliceAfter(
  readRepoSource('../src/home-v2-live/node-client.ts', './node-client.ts'),
  'return projectHomeV2CrosschainReadResult(',
  260,
  'android crosschain projection',
))
assert.ok(!androidCrosschain.includes('foreignWalletSendAvailable'))
assert.ok(!/foreignWalletTrustedCoreAvailable,\s*\n\s*\w/.test(androidCrosschain.replace(/\)[\s\S]*$/, ')')))

console.log('Home v2 tier-2 action tests passed.')
