// Home 2 native-wallet reads: GET_USER_WALLET, and the address/asset selectors
// shared by GET_BALANCE and GET_ACCOUNT_DATA.
//
// Pure module by design (no Electron, Node, DOM or Capacitor imports) so the
// desktop bridge (electron/home-v2-app-bridge.ts) and the Android/renderer
// bridge (src/home-v2-live/node-client.ts) enforce exactly one rule set. The
// two hosts differ only in HOW they resolve the selected account's address;
// everything below takes that address as an argument.
//
// Scope note: this file covers the NATIVE asset only. The separate Home 2
// foreign-wallet module owns BTC/LTC/… receive/read/server behavior and its
// prompt/trusted-Core boundary. Foreign sends remain deliberately unavailable.

import { normalizeHomeV2Address } from './home-v2-app-actions.js'

export const HOME_V2_NATIVE_ASSET_ID = 0
// Mirrors NATIVE_ASSET_LABEL in Home 1.x electron/qdn.ts:299, which is what
// 1.x's GET_USER_WALLET put in `assetName` (qdn.ts:1889-1896).
export const HOME_V2_NATIVE_ASSET_LABEL = 'Native Asset'

export const HOME_V2_NATIVE_WALLET_ACTIONS = Object.freeze(['GET_USER_WALLET'] as const)

/**
 * Coin/blockchain strings Home 2 treats as "the native asset".
 *
 * The first four are exactly what Home 1.x's isNativeAssetAlias accepted
 * (electron/qdn-request-values.ts:118-122).
 *
 * QORT is a DELIBERATE ADDITION for this action, and only for this action.
 * The legacy wallet app (walletium) sends `{ action: 'GET_USER_WALLET',
 * coin: 'QORT' }` for its native row — verified at
 * walletium/src/components/wallet/CoinDetail.tsx:212-216 and
 * CoinGrid.tsx:95-99, where `chain.coinEnum` is the literal 'QORT'
 * (walletium/src/config/chains.ts:22, alongside `isNative: true`).
 * Home 1.x did NOT accept it: isNativeAssetRequest fell through to the
 * foreign-wallet path, where normalizeForeignWalletCoin('QORT') throws
 * 'Unsupported foreign wallet coin.' That is the current wallet-breaking
 * behavior this restores — treating the native currency code as a foreign
 * coin was always a bug, not a boundary.
 *
 * Widening this set is safe HERE because the whole action returns is the
 * caller's own already-readable address; it must not be reused as a general
 * "is this the native asset" test for send/transfer paths, which is why it is
 * scoped to this module rather than pushed back into qdn-request-values.ts.
 */
const NATIVE_ASSET_ALIASES = new Set(['NATIVE', 'NATIVE_ASSET', 'ASSET_0', 'ASSET0', 'QORT'])

function normalizeAlias(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase().replace(/[\s-]+/g, '_') : ''
}

export function isHomeV2NativeAssetAlias(value: unknown) {
  return NATIVE_ASSET_ALIASES.has(normalizeAlias(value))
}

/**
 * The asset id selector, when the caller supplied one.
 *
 * Returns undefined for an absent/blank selector so the caller can fall back
 * to the coin alias. Anything else must be a non-negative safe integer:
 * a malformed selector is refused rather than silently defaulting to native.
 */
export function homeV2RequestAssetId(request: Record<string, unknown>) {
  const value = request.assetId
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return undefined
  }
  const assetId = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(assetId) || assetId < 0) {
    throw new Error('assetId must be a non-negative safe integer.')
  }
  return assetId
}

/**
 * Whether a GET_USER_WALLET request is asking for the native wallet.
 *
 * Precedence matches Home 1.x isNativeAssetRequest (qdn-request-values.ts:156-166):
 * an explicit assetId wins over a coin alias, and an entirely absent selector
 * defaults to native (1.x called it with defaultToNative = true, qdn.ts:1889).
 */
export function isHomeV2NativeWalletRequest(request: Record<string, unknown>) {
  const assetId = homeV2RequestAssetId(request)
  if (typeof assetId === 'number') return assetId === HOME_V2_NATIVE_ASSET_ID
  const coin = request.coin ?? request.blockchain
  if (coin === undefined || coin === null || (typeof coin === 'string' && coin.trim() === '')) {
    return true
  }
  return isHomeV2NativeAssetAlias(coin)
}

export const HOME_V2_FOREIGN_WALLET_UNAVAILABLE_CODE = 'FOREIGN_WALLET_UNAVAILABLE'

/**
 * The one refusal for every non-native GET_USER_WALLET.
 *
 * Coded (not a bare string) so an app can branch on the code and hide its
 * foreign-coin rows instead of surfacing a raw message, and non-retryable so
 * a client does not spin on it: nothing about retrying makes a foreign wallet
 * appear.
 */
export function homeV2ForeignWalletUnavailableError(coin: unknown) {
  const label = typeof coin === 'string' && coin.trim() ? ` (${coin.trim().slice(0, 32)})` : ''
  return Object.assign(
    new Error(`Foreign wallets are not yet available in Home 2.${label}`),
    { code: HOME_V2_FOREIGN_WALLET_UNAVAILABLE_CODE, retryable: false },
  )
}

/**
 * GET_USER_WALLET's response for the native asset.
 *
 * Mirrors the 1.x shape (electron/qdn.ts:1889-1896) rather than trimming it:
 * `address` is the only field either wallet app reads today
 * (qortium-wallet CoinDetail.tsx:223, CoinGrid.tsx:104, TopBar.tsx:144-149 and
 * the walletium equivalents all do `res?.address`), but keeping assetId /
 * assetName / native costs nothing and means an app written against 1.x sees
 * the same object.
 *
 * What is NOT here is the point of the action: no seed, no xprv/xpub, no
 * private key, no derived key material of any kind — unlike the foreign
 * branch of 1.x's getUserForeignWalletForApp, which derives an HD wallet.
 * The native address is already returned by GET_SELECTED_ACCOUNT, so this
 * discloses strictly nothing new.
 */
export function buildHomeV2UserWalletResult(address: string) {
  return Object.freeze({
    address: normalizeHomeV2Address(address, 'Selected account address'),
    assetId: HOME_V2_NATIVE_ASSET_ID,
    assetName: HOME_V2_NATIVE_ASSET_LABEL,
    native: true as const,
  })
}

/**
 * The address GET_BALANCE / GET_ACCOUNT_DATA should read.
 *
 * Home 1.x defaulted an absent `address` to the selected account
 * (getAddressForQdnRequest, electron/qdn.ts:8987-9005); Home 2 lost that and
 * required the app to pass one, which is what broke qortium-wallet's balance
 * column — it sends `{ action: 'GET_BALANCE', assetId: 0 }` with no address
 * at all (qortium-wallet/src/components/wallet/CoinDetail.tsx:239-243).
 *
 * Posture: neutral. The default is the CALLER'S OWN account, whose address
 * and balance the app can already obtain through GET_SELECTED_ACCOUNT plus an
 * explicit GET_BALANCE. This adds no reach; it removes a papercut.
 */
export function resolveHomeV2AccountReadAddress(
  request: Record<string, unknown>,
  selectedAddress: string | null | undefined,
) {
  const requested = request.address
  if (requested !== undefined && requested !== null && requested !== '') {
    return normalizeHomeV2Address(requested)
  }
  // No fallback offered: either no account is selected, or this is a widget,
  // where self-addressing is withheld (homeV2WidgetWithholdsSelfSubject).
  if (!selectedAddress) {
    throw new Error('Address is required.')
  }
  return normalizeHomeV2Address(selectedAddress, 'Selected account address')
}

/**
 * GET_BALANCE's node path, honoring the asset selector.
 *
 * Home 1.x appended `?assetId=` (getAccountBalancePath,
 * electron/qdn-request-values.ts:148-153). Home 2 dropped it, so every
 * GET_BALANCE silently answered with the native balance regardless of the
 * assetId asked for — wrong for any non-native asset, and a silent wrong
 * answer rather than an error.
 *
 * The value is re-validated as a non-negative safe integer before it reaches
 * the query string, so nothing app-supplied is interpolated raw.
 */
export function buildHomeV2AccountBalancePath(address: string, request: Record<string, unknown>) {
  const assetId = homeV2RequestAssetId(request)
  const query = typeof assetId === 'number' ? `?assetId=${assetId}` : ''
  return `/addresses/balance/${encodeURIComponent(normalizeHomeV2Address(address))}${query}`
}

export function buildHomeV2AccountDataPath(address: string) {
  return `/addresses/${encodeURIComponent(normalizeHomeV2Address(address))}`
}
