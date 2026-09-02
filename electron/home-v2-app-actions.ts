import {
  getAssetBalancesPath,
  getAssetInfoPath,
  getAssetTransfersPath,
} from './qdn-request-values.js'
import {
  HOME_V2_CROSSCHAIN_READ_ACTIONS,
  buildHomeV2CrosschainReadPath,
  isHomeV2CrosschainReadAction,
} from './home-v2-crosschain-actions.js'
import { HOME_V2_MARKET_PRICE_ACTIONS } from './home-v2-market-prices.js'
import {
  HOME_V2_FOREIGN_WALLET_ADMIN_ACTIONS,
  HOME_V2_FOREIGN_WALLET_READ_ACTIONS,
} from './home-v2-foreign-wallet-actions.js'
import { getPollOptionsInput } from './qdn-poll-options-input.js'
import {
  getOptionalPollVoteOptionIndexes,
  resolvePollVoteOptionInput,
  type PollVoteOptionInput,
} from './qdn-poll-vote-input.js'

export type HomeV2AppBridgeProtocol = 'qdnRequest' | 'qortalRequest'
export type HomeV2AppNetwork = 'qortal' | 'qortium'

const RESPONSE_DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const RESPONSE_MAX_BYTES = 5 * 1024 * 1024
const AVATAR_MAX_BYTES = 500 * 1024
const MAX_IDENTITY_ADDRESSES = 500
const MAX_ADDRESS_LENGTH = 2_048

const COMMON_ACTIONS = [
  // Encryption belongs on BOTH protocols because it has no chain semantics at
  // all: it uses the selected account's key, which is one keypair across
  // Qortal and Qortium, and touches no node. A Qortal app calling
  // ENCRYPT_DATA gets Qortal's exact behaviour and wire format.
  'DECRYPT_DATA',
  'ENCRYPT_DATA',
  'FETCH_NODE_API',
  'FORGET_PENDING_TRANSACTION',
  'GET_PENDING_TRANSACTIONS',
  'GET_HOST_INFO',
  'GET_NODE_INFO',
  'GET_NODE_STATUS',
  'IS_USING_PUBLIC_NODE',
  'OPEN_AS_WIDGET',
  'NOTIFICATION_HAS_PERMISSION',
  'OPEN_CURRENT_TAB',
  'OPEN_NEW_TAB',
  'SHOW_CONTEXT_MENU',
  'SHOW_NOTIFICATION',
  'SHOW_ACTIONS',
  'WHICH_UI',
  // The implemented catalogue contains both launch and widget-local actions.
  // The runtime filters these by calling context before SHOW_ACTIONS exposes
  // them to an app.
  'WIDGET_CLOSE',
  'WIDGET_END_DRAG',
  'WIDGET_GET_STATE',
  'WIDGET_RESIZE',
  'WIDGET_SET_REGIONS',
  'WIDGET_START_DRAG',
] as const

const QDN_ACTIONS = [
  ...COMMON_ACTIONS,
  'BOOKMARKS_HAS_PERMISSION',
  'BOOKMARKS_GET',
  'BOOKMARKS_APPLY',
  'BOOKMARKS_OPEN',
  'NOTIFICATION_MANAGER_HAS_PERMISSION',
  'NOTIFICATION_MANAGER_GET',
  'NOTIFICATION_MANAGER_SET_MUTED',
  'NOTIFICATION_MANAGER_REMOVE_RULES',
  'NOTIFICATION_MANAGER_REVOKE',
  'GET_HOME_SETTINGS_METADATA',
  'GET_HOME_SETTINGS',
  'UPDATE_HOME_SETTINGS',
  'ADD_GROUP_ADMIN',
  'ADD_TO_LIST',
  'APPROVE_GROUP_JOIN_REQUEST',
  'BUY_NAME',
  'CANCEL_GROUP_BAN',
  'CANCEL_GROUP_INVITE',
  'CANCEL_SELL_NAME',
  'CREATE_GROUP',
  'CREATE_POLL',
  'FETCH_ACCOUNT_AVATAR',
  'FETCH_GROUP_AVATAR',
  'FETCH_BLOCK',
  'FETCH_BLOCK_RANGE',
  'FETCH_QDN_RESOURCE',
  'FETCH_QORTAL_NODE_API',
  'GROUP_BAN',
  'GROUP_KICK',
  'GET_ACCOUNT_DATA',
  'GET_ACCOUNT_GROUPS',
  'GET_ACCOUNT_GROUP_JOIN_REQUESTS',
  'GET_ACCOUNT_NAMES',
  'GET_ACCOUNT_RATING',
  'GET_ACTIVE_CHATS',
  'GET_ADMIN_GROUP_JOIN_REQUESTS',
  'GET_ALL_LISTS',
  'GET_ASSET_BALANCES',
  'GET_ASSET_INFO',
  'GET_ASSET_TRANSFERS',
  'GET_AT',
  'GET_AT_DATA',
  'GET_BALANCE',
  'GET_CHAT_MESSAGE',
  'GET_CHAT_ATTACHMENT_STREAM_URL',
  ...HOME_V2_FOREIGN_WALLET_READ_ACTIONS,
  ...HOME_V2_CROSSCHAIN_READ_ACTIONS,
  'GET_GROUP',
  'GET_GROUP_BANS',
  'GET_GROUP_JOIN_REQUESTS',
  'GET_GROUP_KICKS',
  'GET_GROUP_MEMBERS',
  'GET_LIST',
  'GROUP_APPROVAL',
  ...HOME_V2_MARKET_PRICE_ACTIONS,
  'GET_MEMBER_BANS',
  'GET_MEMBER_KICKS',
  'GET_MINTING_STATUS',
  'GET_NAME_DATA',
  // The Node app's settings family, qdnRequest-only like GET_HOME_SETTINGS*:
  // Qortium Home is the only host with a node-settings concept, and
  // evaluateHomeV2AdminTrust refuses network 'qortal' outright, so a
  // qortalRequest copy could never be answered honestly. The metadata READ is
  // promptless (the same anonymous Core route FETCH_NODE_API already allows);
  // the two WRITES prompt on every request and are advertised only for an
  // admin-trusted route (home-v2-app-runtime.ts).
  'GET_NODE_SETTINGS_METADATA',
  'GET_PRIMARY_NAME',
  'GET_PRIVATE_DIRECT_ACTIVE_CHATS',
  'GET_PRIVATE_GROUP_ACTIVE_CHATS',
  'GET_PRIVATE_GROUP_CHAT_STATE',
  'GET_QDN_RESOURCE_METADATA',
  'GET_QDN_RESOURCE_PROPERTIES',
  'GET_QDN_RESOURCE_STATUS',
  'GET_QDN_RESOURCE_STREAM_URL',
  'GET_QDN_RESOURCE_URL',
  'GET_RESOURCE_RATING',
  'GET_SELECTED_ACCOUNT',
  'GET_USER_WALLET',
  'INVITE_TO_GROUP',
  'JOIN_GROUP',
  'LIST_ATS',
  'LIST_GROUPS',
  'LIST_MINTING_ACCOUNTS',
  'LIST_QDN_RESOURCES',
  'LEAVE_GROUP',
  'PAYMENT',
  'RATE_ACCOUNT',
  'RATE_RESOURCE',
  'REGISTER_NAME',
  'SEND_COIN',
  'SET_ACCOUNT_AVATAR',
  'TRANSFER_ASSET',
  'REMOVE_FROM_LIST',
  'REMOVE_GROUP_ADMIN',
  'REMOVE_MINTING_ACCOUNT',
  'RESTART_NODE',
  'START_MINTING',
  'OPEN_QDN_RESOURCE_VIEWER',
  'OPEN_QDN_DOCUMENT_VIEWER',
  'OPEN_QDN_MEDIA_PLAYER',
  'OPEN_CHAT_ATTACHMENT_VIEWER',
  'SAVE_QDN_RESOURCE',
  // Qortal compatibility aliases. Each resolves to the action above it and
  // adds no capability of its own; they are advertised so a Qortal app can
  // discover them in SHOW_ACTIONS and call the name it already knows.
  'SAVE_FILE',
  'LINK_TO_QDN_RESOURCE',
  'SAVE_CHAT_ATTACHMENT',
  'SELECT_QDN_PUBLISH_SOURCE',
  'STAGE_QDN_PUBLISH_SOURCE',
  'PREVIEW_QDN_PUBLISH_SOURCE',
  'RESOLVE_IDENTITIES',
  'SEARCH_CHAT_MESSAGES',
  'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
  'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES',
  'SEARCH_GROUPS',
  'SEARCH_NAMES',
  'SEARCH_QDN_RESOURCES',
  'SEARCH_TRANSACTIONS',
  'SEND_CHAT_DELETE',
  'SEND_CHAT_EDIT',
  'SEND_CHAT_MESSAGE',
  'SEND_CHAT_REACTION',
  'SEND_DIRECT_CHAT_DELETE',
  'SEND_DIRECT_CHAT_EDIT',
  'SEND_DIRECT_CHAT_MESSAGE',
  'SEND_DIRECT_CHAT_REACTION',
  'SEND_MESSAGE',
  'REQUEST_PRIVATE_GROUP_CHAT_KEY',
  'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS',
  'ROTATE_PRIVATE_GROUP_CHAT_KEY',
  'SEND_PRIVATE_GROUP_CHAT_DELETE',
  'SEND_PRIVATE_GROUP_CHAT_EDIT',
  'SEND_PRIVATE_GROUP_CHAT_MESSAGE',
  'SEND_PRIVATE_GROUP_CHAT_REACTION',
  'PUBLISH_QDN_RESOURCE',
  'PUBLISH_MULTIPLE_QDN_RESOURCES',
  'DELETE_QDN_RESOURCE',
  'PUBLISH_CHAT_ATTACHMENT',
  'SELL_NAME',
  'SET_GROUP',
  'SET_GROUP_AVATAR',
  ...HOME_V2_FOREIGN_WALLET_ADMIN_ACTIONS,
  'UNLOCK_SELECTED_ACCOUNT',
  'UPDATE_GROUP',
  'UPDATE_NAME',
  'UPDATE_NODE_SETTINGS',
  'UPDATE_POLL',
  'VOTE_ON_POLL',
] as const

const QORTAL_ACTIONS = [
  ...COMMON_ACTIONS,
  'ADD_GROUP_ADMIN',
  'APPROVE_GROUP_JOIN_REQUEST',
  'BAN_FROM_GROUP',
  'CANCEL_GROUP_BAN',
  'CANCEL_GROUP_INVITE',
  'FETCH_ACCOUNT_AVATAR',
  'FETCH_BLOCK',
  'FETCH_BLOCK_RANGE',
  'FETCH_QDN_RESOURCE',
  'FETCH_GROUP_AVATAR',
  'GROUP_BAN',
  'GROUP_KICK',
  'GET_ACCOUNT_DATA',
  'GET_ACCOUNT_GROUPS',
  'GET_ACCOUNT_GROUP_JOIN_REQUESTS',
  'GET_ACCOUNT_NAMES',
  'GET_ACCOUNT_RATING',
  'GET_ACTIVE_CHATS',
  'GET_ADMIN_GROUP_JOIN_REQUESTS',
  'GET_ASSET_BALANCES',
  'GET_ASSET_INFO',
  'GET_ASSET_TRANSFERS',
  'GET_AT',
  'GET_AT_DATA',
  'GET_BALANCE',
  'GET_CHAT_MESSAGE',
  'GET_CHAT_ATTACHMENT_STREAM_URL',
  ...HOME_V2_CROSSCHAIN_READ_ACTIONS,
  'GET_DAY_SUMMARY',
  'GET_GROUP',
  'GET_GROUP_BANS',
  'GET_GROUP_JOIN_REQUESTS',
  'GET_GROUP_KICKS',
  'GET_GROUP_MEMBERS',
  ...HOME_V2_MARKET_PRICE_ACTIONS,
  'GET_MEMBER_BANS',
  'GET_MEMBER_KICKS',
  'GET_MINTING_STATUS',
  'GET_NAME_DATA',
  'GET_PRICE',
  'GET_PRIMARY_NAME',
  'GET_PRIVATE_DIRECT_ACTIVE_CHATS',
  'GET_PRIVATE_GROUP_ACTIVE_CHATS',
  'GET_PRIVATE_GROUP_CHAT_STATE',
  'GET_QDN_RESOURCE_METADATA',
  'GET_QDN_RESOURCE_PROPERTIES',
  'GET_QDN_RESOURCE_STATUS',
  'GET_QDN_RESOURCE_STREAM_URL',
  'GET_QDN_RESOURCE_URL',
  'GET_RESOURCE_RATING',
  'GET_USER_ACCOUNT',
  'GET_USER_WALLET',
  'KICK_FROM_GROUP',
  'INVITE_TO_GROUP',
  'JOIN_GROUP',
  'LIST_ATS',
  'LIST_GROUPS',
  'LIST_MINTING_ACCOUNTS',
  'LIST_QDN_RESOURCES',
  'LEAVE_GROUP',
  'REMOVE_GROUP_ADMIN',
  'REMOVE_MINTING_ACCOUNT',
  'START_MINTING',
  'OPEN_QDN_RESOURCE_VIEWER',
  'OPEN_QDN_DOCUMENT_VIEWER',
  'OPEN_QDN_MEDIA_PLAYER',
  'OPEN_CHAT_ATTACHMENT_VIEWER',
  'SAVE_QDN_RESOURCE',
  // Qortal compatibility aliases. Each resolves to the action above it and
  // adds no capability of its own; they are advertised so a Qortal app can
  // discover them in SHOW_ACTIONS and call the name it already knows.
  'SAVE_FILE',
  'LINK_TO_QDN_RESOURCE',
  'SAVE_CHAT_ATTACHMENT',
  'SELECT_QDN_PUBLISH_SOURCE',
  'STAGE_QDN_PUBLISH_SOURCE',
  'PREVIEW_QDN_PUBLISH_SOURCE',
  'SEARCH_CHAT_MESSAGES',
  'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
  'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES',
  'SEARCH_NAMES',
  'SEARCH_QDN_RESOURCES',
  'SEARCH_TRANSACTIONS',
  'SEND_CHAT_DELETE',
  'SEND_CHAT_EDIT',
  'SEND_CHAT_MESSAGE',
  'SEND_CHAT_REACTION',
  'SEND_DIRECT_CHAT_DELETE',
  'SEND_DIRECT_CHAT_EDIT',
  'SEND_DIRECT_CHAT_MESSAGE',
  'SEND_DIRECT_CHAT_REACTION',
  'REQUEST_PRIVATE_GROUP_CHAT_KEY',
  'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS',
  'ROTATE_PRIVATE_GROUP_CHAT_KEY',
  'SEND_PRIVATE_GROUP_CHAT_DELETE',
  'SEND_PRIVATE_GROUP_CHAT_EDIT',
  'SEND_PRIVATE_GROUP_CHAT_MESSAGE',
  'SEND_PRIVATE_GROUP_CHAT_REACTION',
  'PUBLISH_QDN_RESOURCE',
  // Multi-publish loops the same dual-chain single-publish primitive, so it
  // is advertised wherever its single sibling is. DELETE_QDN_RESOURCE is NOT
  // here: Qortal has no keyless delete builder, and advertising it would
  // make SHOW_ACTIONS lie.
  'PUBLISH_MULTIPLE_QDN_RESOURCES',
  'PUBLISH_CHAT_ATTACHMENT',
  // Unlocking is a HOME-account operation, not a chain one: the same wallet,
  // the same password dialog, the same key, whichever protocol asked. It was
  // qdnRequest-only in Phase 1 by omission rather than by design, which broke
  // the legacy wallet app — walletium calls it on `qortalRequest`, the only
  // bridge global it knows (walletium/src/components/wallet/CoinDetail.tsx:70-75,
  // src/utils/addressBookQDN.ts:87-92). Advertising it on both protocols
  // grants nothing extra: the user still types their password into Home's own
  // dialog, and the unlock is asserted to have actually completed
  // (assertHomeV2UnlockCompleted) before the action returns.
  'UNLOCK_SELECTED_ACCOUNT',
  // SEND_QORT is the Qortal PAYMENT compatibility action: locally built on
  // the existing Qortal serializer, qortalRequest only.
  'SEND_QORT',
  // Qortal and Qortium share the TRANSFER_ASSET request shape, but Home signs
  // each chain's distinct type-12 wire form on its matching protocol.
  'TRANSFER_ASSET',
] as const
// SEARCH_GROUPS (Qortium-only): /groups/search does not exist on Qortal
// (verified absent from both the Qortal master 6.1.5 and develop checkouts'
// GroupsResource.java) — it is a Qortium Core addition. Home therefore
// advertises it only on qdnRequest, the same asymmetric pattern already used
// for GET_DAY_SUMMARY/GET_PRICE (qortalRequest-only) and
// RESOLVE_IDENTITIES/FETCH_QORTAL_NODE_API
// (qdnRequest-only).

// The Home data manager families (BOOKMARKS_* and NOTIFICATION_MANAGER_*) are
// qdnRequest-only for the same asymmetric reason, but a different one from
// SEARCH_GROUPS above: it is not that Qortal's node lacks an endpoint, it is
// that these actions touch NO node at all. They read and write Home-profile
// data — the user's saved links, and the per-app notification grants and rules
// Home itself stores — so they carry no chain semantics and there is nothing
// for a Qortal-network variant of them to mean. Advertising them on
// qortalRequest would imply a second, chain-scoped copy of Home's one profile.
// A Qortal-routed app that wants them calls them on qdnRequest; the durable
// capability and the manager app key are protocol-independent already.

// The Home-settings family (GET_HOME_SETTINGS_METADATA, GET_HOME_SETTINGS,
// UPDATE_HOME_SETTINGS) is qdnRequest-only for exactly that argument, and it is
// the cleanest case of it. These three read and write the user's theme, accent,
// language, text size, zoom, interface style and notification toggle — one
// Home-profile display setting each, none of them chain state, none of them
// reaching a node. Home has ONE appearance, not a Qortal one and a Qortium one,
// so a qortalRequest copy of these actions would have to either mean the same
// thing twice or imply a per-chain appearance that does not exist. An app
// routed at Qortal calls them on qdnRequest.
//
// The same argument is why the whole family is route-independent (see
// HOME_V2_ROUTE_INDEPENDENT_ACTIONS): an app can read and change Home's
// appearance while every node route is disabled or unreachable.

// The minting family (GET_MINTING_STATUS, LIST_MINTING_ACCOUNTS,
// START_MINTING, REMOVE_MINTING_ACCOUNT) is advertised on both protocols so
// one app build works on either chain, but every node-side part of it is
// answered only by an administered node — see evaluateHomeV2AdminTrust in
// home-v2-minting.ts. These four actions exist precisely so apps never need
// raw /admin/mintingaccounts access: nothing below may be widened to let them
// reach it directly.

// Home 1.x shipped two narrow viewer actions before OPEN_QDN_RESOURCE_VIEWER
// replaced them. Home 2 keeps them as compatibility ALIASES of that one
// action — the same precedent as BAN_FROM_GROUP/KICK_FROM_GROUP in
// home-v2-group-admin-actions.ts — so qortium-chat/help/explore/library keep
// working without republishing.
//
// Security posture: an alias is never WIDER than the action it replaces.
// Each one keeps the exact service scope its 1.x handler enforced (Home 1.x
// electron/qdn.ts:9779-9853), so OPEN_QDN_MEDIA_PLAYER still cannot reach a
// DOCUMENT and OPEN_QDN_DOCUMENT_VIEWER still cannot reach a VIDEO. Both
// scopes are strict subsets of what OPEN_QDN_RESOURCE_VIEWER already accepts,
// which itself refuses APP/WEBSITE/GAME (qdn-resource-viewer-contract.ts).
// After the scope check the request is handled by the canonical action, so it
// inherits its validation, its stream capability binding, and its prompt
// posture — today: no prompt, because the viewer only drives Home's own UI
// over a resource the app could already read. Neither alias adds a capability
// of its own.
const RESOURCE_VIEWER_ALIAS_SERVICES = new Map<string, readonly string[]>([
  ['OPEN_QDN_MEDIA_PLAYER', Object.freeze(['AUDIO', 'PODCAST', 'VIDEO', 'VOICE'])],
  ['OPEN_QDN_DOCUMENT_VIEWER', Object.freeze(['ATTACHMENT', 'DOCUMENT', 'FILE', 'FILES'])],
])

export const HOME_V2_RESOURCE_VIEWER_ALIASES = Object.freeze([
  'OPEN_QDN_DOCUMENT_VIEWER',
  'OPEN_QDN_MEDIA_PLAYER',
] as const)

/**
 * Qortal-compatibility aliases: the same capability Home already implements,
 * under the name a Qortal app calls it by, with the request shape it sends.
 *
 * `SAVE_FILE` is `SAVE_QDN_RESOURCE` with the coordinate nested under
 * `location` — it takes a QDN coordinate, not a blob. `LINK_TO_QDN_RESOURCE`
 * is `OPEN_NEW_TAB` with the coordinate as fields rather than an address;
 * Qortal's own documentation describes it as working "similar to the
 * OPEN_NEW_TAB qortalRequest".
 */
export const HOME_V2_QORTAL_COMPAT_ALIASES = Object.freeze([
  'LINK_TO_QDN_RESOURCE',
  'SAVE_FILE',
] as const)

const READ_PREFIXES = [
  '/account-ratings',
  '/addresses',
  '/arbitrary',
  '/assets',
  '/blocks',
  '/chat/messages',
  '/crosschain',
  '/groups',
  '/names',
  // Core's peer inspection reads, restored for the Node app's dashboard
  // (Home 1.x passed them through unrestricted). Every GET under /peers is
  // anonymous on both forks except /peers/enginestats, which Core key-gates
  // itself; this passthrough attaches no API key, so a keyed route answers
  // 401 rather than widening anything. Peer WRITES are POST/DELETE and stay
  // unreachable behind the GET/HEAD method allowlist.
  '/peers',
  '/polls',
  // Core's public resource-rating reads, the resource-side twin of the
  // /account-ratings prefix above. Anonymous and read-only on both forks: the
  // rating WRITE is a signed RATE_RESOURCE transaction, which never reaches
  // Core through this GET/HEAD passthrough.
  '/resource-ratings',
  '/transactions',
] as const

const RESOURCE_QUERY_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  default: 'default',
  description: 'description',
  exactMatchNames: 'exactmatchnames',
  excludeBlocked: 'excludeblocked',
  followedOnly: 'followedonly',
  identifier: 'identifier',
  includeMetadata: 'includemetadata',
  includeStatus: 'includestatus',
  keywords: 'keywords',
  limit: 'limit',
  mode: 'mode',
  name: 'name',
  nameListFilter: 'namefilter',
  names: 'name',
  offset: 'offset',
  prefix: 'prefix',
  query: 'query',
  reverse: 'reverse',
  service: 'service',
  title: 'title',
})

export function isHomeV2AppRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeHomeV2AppProtocol(value: unknown): HomeV2AppBridgeProtocol {
  if (value !== 'qdnRequest' && value !== 'qortalRequest') {
    throw new Error('Unknown Home v2 app protocol.')
  }
  return value
}

export function normalizeHomeV2AppAction(request: Record<string, unknown>) {
  const action = typeof request.action === 'string' ? request.action.trim().toUpperCase() : ''
  if (!action) throw new Error('App request action is required.')
  return action
}

// Mirrors getRequestValue in qdn-request-values.ts: apps may nest fields in a
// `payload` object, and the viewer contract reads `service` that way too. The
// alias scope check below must look in the same place the handler will, or a
// payload-nested request would be rejected here and accepted there.
function homeV2RequestField(request: Record<string, unknown>, key: string): unknown {
  const payload = request.payload
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return (payload as Record<string, unknown>)[key] ?? request[key]
  }
  return request[key]
}

/**
 * Collapses a compatibility alias onto the action that implements it, after
 * enforcing the alias's own (narrower) preconditions.
 *
 * Called once per request at each bridge entry point, immediately after the
 * action string is read and BEFORE the catalogue/route gate, so an alias is
 * authorized, dispatched, error-reported and permission-keyed as the canonical
 * action everywhere. That is deliberate: an alias must never become a second
 * capability with its own grant identity.
 *
 * Every non-alias action is returned unchanged.
 */
/**
 * Resolves an alias to the canonical action AND the request that action
 * expects, together.
 *
 * Returning both from ONE function is deliberate. Some aliases differ from
 * their canonical action only in name (the resource-viewer pair), but the
 * Qortal-compatibility aliases also differ in request SHAPE — Qortal's
 * SAVE_FILE nests the coordinate under `location`, and its
 * LINK_TO_QDN_RESOURCE passes a coordinate where Home takes an address. A
 * separate "rewrite the request" helper would have to be called in lockstep
 * with this one at every call site, and a caller that renamed the action
 * without rewriting the request would produce a confusing validation failure
 * deep inside the canonical handler rather than an obvious mistake here.
 *
 * An alias never adds a capability: after resolution the request is handled by
 * the canonical action, inheriting its validation, its permission posture and
 * its prompt.
 */
export function resolveHomeV2AppAlias(
  action: string,
  request: Record<string, unknown>,
  // The calling global. An alias that builds an ADDRESS must stamp the chain
  // the caller is on: `qdn://` means Qortium and `qortal://` means Qortal, so
  // resolving a qortalRequest to a `qdn://` address would hand a Qortal app
  // the same-named QORTIUM resource — an attacker-controlled collision on the
  // other chain, opened without a prompt. The invoked global fixes the
  // network everywhere else in this bridge; it must here too.
  protocol: HomeV2AppBridgeProtocol = 'qdnRequest',
): { readonly action: string; readonly request: Record<string, unknown> } {
  const aliasServices = RESOURCE_VIEWER_ALIAS_SERVICES.get(action)
  if (aliasServices) {
    const rawService = homeV2RequestField(request, 'service')
    const service = typeof rawService === 'string' ? rawService.trim().toUpperCase() : ''
    if (!service) throw new Error('QDN resource service is required.')
    if (!aliasServices.includes(service)) {
      throw new Error(`${action} only supports ${aliasServices.join(', ')} resources.`)
    }
    return { action: 'OPEN_QDN_RESOURCE_VIEWER', request }
  }
  // Qortal's SAVE_FILE has TWO documented forms: a QDN `location` coordinate,
  // and a `blob` the app already holds. Only the location form is an alias —
  // it maps onto SAVE_QDN_RESOURCE and adds no capability. Writing an
  // app-supplied blob to disk is a NEW capability with its own trust
  // question, so it is refused HERE and by name, rather than being silently
  // mishandled or quietly reported as unsupported after the fact.
  if (action === 'SAVE_FILE') {
    const location = homeV2RequestField(request, 'location')
    if (!isHomeV2AppRecord(location)) {
      if (homeV2RequestField(request, 'blob') !== undefined) {
        throw new Error(
          'SAVE_FILE with a blob is not supported; pass a QDN location, or publish the data and save that.',
        )
      }
      throw new Error('SAVE_FILE requires a location with the QDN service, name, and identifier.')
    }
    const filename = homeV2RequestField(request, 'filename')
    return {
      action: 'SAVE_QDN_RESOURCE',
      // Built explicitly from the location rather than merged over the
      // original: a top-level `name` or `service` alongside `location` must
      // not be able to disagree with the coordinate that gets saved.
      request: {
        ...(typeof filename === 'string' ? { filename } : {}),
        ...(typeof location.identifier === 'string' ? { identifier: location.identifier } : {}),
        name: location.name,
        service: location.service,
      },
    }
  }
  // Qortal's LINK_TO_QDN_RESOURCE navigates to another q-app — its own docs
  // say it "works similar to the OPEN_NEW_TAB qortalRequest" — but passes the
  // coordinate as fields where Home takes an address.
  if (action === 'LINK_TO_QDN_RESOURCE') {
    const service = homeV2RequestField(request, 'service')
    const name = homeV2RequestField(request, 'name')
    const identifier = homeV2RequestField(request, 'identifier')
    const path = homeV2RequestField(request, 'path')
    if (typeof service !== 'string' || !service.trim()) {
      throw new Error('LINK_TO_QDN_RESOURCE requires a QDN service.')
    }
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('LINK_TO_QDN_RESOURCE requires a resource name.')
    }
    // The address is built by joining on '/', so a component containing one
    // would silently name a DIFFERENT coordinate than the app asked for — the
    // same ambiguity the avatar and resource-coordinate prompt encodings exist
    // to remove. Qortal names and services cannot contain a slash, so refusing
    // is honest; the app can still call OPEN_NEW_TAB directly with a literal
    // address if it means something else.
    const components: Array<readonly [string, string]> = [
      ['service', service.trim().toUpperCase()],
      ['name', name.trim()],
    ]
    if (typeof identifier === 'string' && identifier.trim()) {
      components.push(['identifier', identifier.trim()])
    }
    for (const [label, value] of components) {
      if (value.includes('/')) {
        throw new Error(`LINK_TO_QDN_RESOURCE ${label} cannot contain a slash.`)
      }
      if (value === '.' || value === '..') {
        throw new Error(`LINK_TO_QDN_RESOURCE ${label} cannot be a dot segment.`)
      }
    }
    const trimmedPath = typeof path === 'string' ? path.trim() : ''
    if (trimmedPath) {
      // Traversal would resolve above the resource root. Percent-encoded forms
      // count: URL normalization decodes `%2e%2e` to `..` before the address
      // is resolved, so checking only the literal spelling would miss it.
      let decodedPath = trimmedPath
      try {
        decodedPath = decodeURIComponent(trimmedPath)
      } catch {
        throw new Error('LINK_TO_QDN_RESOURCE path is not valid percent-encoding.')
      }
      if (/[?#]/.test(decodedPath)) {
        throw new Error('LINK_TO_QDN_RESOURCE path cannot contain a query or fragment.')
      }
      const segments = decodedPath.split('/').filter((segment) => segment !== '')
      if (segments.some((segment) => segment === '.' || segment === '..')) {
        throw new Error('LINK_TO_QDN_RESOURCE path cannot contain dot segments.')
      }
    }
    const scheme = protocol === 'qortalRequest' ? 'qortal' : 'qdn'
    const coordinate = components.map(([, value]) => value).join('/')
    const suffix = trimmedPath ? `/${trimmedPath.replace(/^\/+/, '')}` : ''
    const address = `${scheme}://${coordinate}${suffix}`
    // The built address must still NAME the coordinate that was asked for
    // after the URL layer normalizes it. This is the round-trip check: if any
    // component or path fragment re-segments the address, the first three
    // segments would no longer be the requested service/name/identifier.
    const parsed = new URL(address)
    const parsedSegments = `${parsed.host}${parsed.pathname}`.split('/').filter((part) => part !== '')
    for (const [index, [label, value]] of components.entries()) {
      if (parsedSegments[index]?.toUpperCase() !== value.toUpperCase()) {
        throw new Error(`LINK_TO_QDN_RESOURCE ${label} does not survive address normalization.`)
      }
    }
    return { action: 'OPEN_NEW_TAB', request: { address } }
  }
  return { action, request }
}

export function getHomeV2AppActions(protocol: HomeV2AppBridgeProtocol): readonly string[] {
  return protocol === 'qdnRequest' ? QDN_ACTIONS : QORTAL_ACTIONS
}

export function getHomeV2AppNetwork(
  protocol: HomeV2AppBridgeProtocol,
  action: string,
): HomeV2AppNetwork {
  return action === 'FETCH_QORTAL_NODE_API' || protocol === 'qortalRequest'
    ? 'qortal'
    : 'qortium'
}

export function normalizeHomeV2ReadMethod(value: unknown): 'GET' | 'HEAD' {
  const method = typeof value === 'string' ? value.toUpperCase() : 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    throw new Error('Home v2 apps can only use GET or HEAD node reads.')
  }
  return method
}

export function normalizeHomeV2ReadPath(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_000) {
    throw new Error('A node API path is required.')
  }
  const raw = value.trim()
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\u0000-\u001f]/.test(raw)) {
    throw new Error('Node API paths must be relative paths beginning with /.')
  }
  const parsed = new URL(raw, 'https://home-v2.invalid')
  const pathname = parsed.pathname
  const allowedAdminPath =
    pathname === '/admin/status' ||
    pathname === '/admin/info' ||
    // The settings VALUES read next to the metadata read below: an anonymous
    // GET on both forks that the Node app's dashboard renders (Home 1.x
    // allowed it). Exact match only — /admin/settings/{setting} is a
    // key-gated Core route and stays outside this scope, and the settings
    // WRITE is a PATCH the GET/HEAD method allowlist never reaches.
    pathname === '/admin/settings' ||
    pathname === '/admin/settings/metadata'
  if (
    !allowedAdminPath &&
    !READ_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    throw new Error('That node API path is outside Home v2 read-only scope.')
  }
  return `${pathname}${parsed.search}`
}

function requestString(
  request: Record<string, unknown>,
  key: string,
  label: string,
  maxLength = 128,
) {
  const value = typeof request[key] === 'string' ? request[key].trim() : ''
  if (!value || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is required.`)
  }
  return value
}

function normalizedResource(request: Record<string, unknown>) {
  const service = requestString(request, 'service', 'QDN resource service').toUpperCase()
  const name = requestString(request, 'name', 'QDN resource name')
  const identifier = optionalRequestString(request, 'identifier')
  if (!/^[A-Z0-9_]+$/.test(service)) {
    throw new Error('QDN resource service is invalid.')
  }
  if (
    name === '.' ||
    name === '..' ||
    identifier === '.' ||
    identifier === '..'
  ) {
    throw new Error('QDN resource path segments cannot be dot or dot-dot.')
  }
  return { identifier, name, service }
}

export function assertSafeHomeV2ResourceFilePath(value: string) {
  if (value.includes('\\')) {
    throw new Error('QDN resource file paths cannot contain backslashes.')
  }
  if (value.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error('QDN resource file paths cannot contain . or .. segments.')
  }
  return value
}

function optionalRequestString(
  request: Record<string, unknown>,
  key: string,
  maxLength = 256,
) {
  const value = typeof request[key] === 'string' ? request[key].trim() : ''
  if (value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${key} is invalid.`)
  }
  return value
}

function appendQueryValue(query: URLSearchParams, key: string, value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) appendQueryValue(query, key, item)
    return
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    query.append(key, String(value))
    return
  }
  if (typeof value === 'string' && value.trim()) query.append(key, value.trim())
}

export function normalizeHomeV2ResponseMaxBytes(value: unknown) {
  if (value === undefined || value === null || value === '') return RESPONSE_DEFAULT_MAX_BYTES
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > RESPONSE_MAX_BYTES) {
    throw new Error('maxBytes must be between 1 byte and 5 MiB.')
  }
  return parsed
}

export function normalizeHomeV2AvatarMaxBytes(value: unknown) {
  if (value === undefined || value === null || value === '') return AVATAR_MAX_BYTES
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > AVATAR_MAX_BYTES) {
    throw new Error('Avatar maxBytes must be between 1 byte and 500 KiB.')
  }
  return parsed
}

export function normalizeHomeV2Address(value: unknown, label = 'Address') {
  if (typeof value !== 'string') throw new Error(`${label} is required.`)
  const address = value.trim()
  if (!/^Q[1-9A-HJ-NP-Za-km-z]{20,80}$/.test(address)) {
    throw new Error(`${label} is invalid.`)
  }
  return address
}

export function normalizeHomeV2IdentityAddresses(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error('RESOLVE_IDENTITIES requires an "addresses" array.')
  }
  const addresses: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const address = normalizeHomeV2Address(item)
    if (!seen.has(address)) {
      seen.add(address)
      addresses.push(address)
    }
  }
  if (addresses.length > MAX_IDENTITY_ADDRESSES) {
    throw new Error(`RESOLVE_IDENTITIES accepts at most ${MAX_IDENTITY_ADDRESSES} addresses.`)
  }
  return addresses
}

export function buildHomeV2ResourcePath(
  action: string,
  request: Record<string, unknown>,
) {
  if (action === 'LIST_QDN_RESOURCES' || action === 'SEARCH_QDN_RESOURCES') {
    const query = new URLSearchParams()
    for (const [requestKey, queryKey] of Object.entries(RESOURCE_QUERY_FIELDS)) {
      appendQueryValue(query, queryKey, request[requestKey])
    }
    const base = action === 'SEARCH_QDN_RESOURCES'
      ? '/arbitrary/resources/search'
      : '/arbitrary/resources'
    return `${base}${query.size ? `?${query.toString()}` : ''}`
  }

  const { service, name, identifier } = normalizedResource(request)
  if (action === 'GET_QDN_RESOURCE_STATUS') {
    const query = new URLSearchParams()
    if (typeof request.build === 'boolean') query.set('build', String(request.build))
    return `/arbitrary/resource/status/${encodeURIComponent(service)}/${encodeURIComponent(name)}${
      identifier ? `/${encodeURIComponent(identifier)}` : ''
    }${query.size ? `?${query.toString()}` : ''}`
  }
  if (action === 'GET_QDN_RESOURCE_PROPERTIES') {
    return `/arbitrary/resource/properties/${encodeURIComponent(service)}/${encodeURIComponent(name)}/${encodeURIComponent(identifier || 'default')}`
  }
  if (action === 'GET_QDN_RESOURCE_METADATA') {
    return `/arbitrary/metadata/${encodeURIComponent(service)}/${encodeURIComponent(name)}/${encodeURIComponent(identifier || 'default')}`
  }
  if (action === 'FETCH_QDN_RESOURCE') {
    const query = new URLSearchParams()
    const resourcePath = optionalRequestString(
      request,
      typeof request.path === 'string' ? 'path' : 'filepath',
      2_000,
    )
    if (resourcePath) query.set('filepath', assertSafeHomeV2ResourceFilePath(resourcePath))
    for (const key of ['encoding', 'rebuild', 'async']) {
      const value = request[key]
      if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
        query.set(key, String(value))
      }
    }
    return `/arbitrary/${encodeURIComponent(service)}/${encodeURIComponent(name)}${
      identifier ? `/${encodeURIComponent(identifier)}` : ''
    }${query.size ? `?${query.toString()}` : ''}`
  }
  throw new Error(`${action} is not a supported QDN resource read.`)
}

export function buildHomeV2ResourceRenderPath(
  request: Record<string, unknown>,
  displaySettings?: {
    readonly accent?: string
    readonly language?: string
    readonly textSize?: string
    readonly theme?: string
    readonly ui?: string
  } | null,
) {
  const { service, name, identifier } = normalizedResource(request)
  const rawPath = optionalRequestString(
    request,
    typeof request.path === 'string' ? 'path' : 'filepath',
    2_000,
  )
  const [unsafePathOnly, rawQuery = ''] = rawPath.split('?', 2)
  const pathOnly = assertSafeHomeV2ResourceFilePath(unsafePathOnly)
  const encodedPath = pathOnly
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  const query = new URLSearchParams(rawQuery)
  if (displaySettings) {
    if (displaySettings.theme) query.set('theme', displaySettings.theme)
    if (displaySettings.language) query.set('lang', displaySettings.language)
    if (displaySettings.textSize) query.set('textSize', displaySettings.textSize)
    if (displaySettings.accent) query.set('accent', displaySettings.accent)
    if (displaySettings.ui) query.set('uiStyle', displaySettings.ui)
  }
  return `/render/${encodeURIComponent(service)}/${encodeURIComponent(name)}${
    identifier ? `/${encodeURIComponent(identifier)}` : ''
  }${encodedPath ? `/${encodedPath}` : ''}${query.size ? `?${query.toString()}` : ''}`
}

export function buildHomeV2NamePath(action: string, request: Record<string, unknown>) {
  if (action === 'GET_NAME_DATA') {
    return `/names/${encodeURIComponent(requestString(request, 'name', 'Name'))}`
  }
  if (action === 'GET_ACCOUNT_NAMES') {
    return `/names/address/${encodeURIComponent(normalizeHomeV2Address(request.address))}`
  }
  if (action === 'GET_PRIMARY_NAME') {
    return `/names/primary/${encodeURIComponent(normalizeHomeV2Address(request.address))}`
  }
  throw new Error(`${action} is not a supported identity read.`)
}

// Hub's legacy q-apps mapping coerces these with `new Boolean(value)`, which
// turns the string "false" truthy. Home requires real booleans instead.
function optionalStrictBoolean(request: Record<string, unknown>, key: string) {
  const value = request[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw new Error(`${key} must be true or false.`)
  return value
}

function optionalPageInteger(
  request: Record<string, unknown>,
  key: string,
  max?: number,
) {
  const value = request[key]
  if (value === undefined || value === null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || (max !== undefined && parsed > max)) {
    throw new Error(
      max !== undefined
        ? `${key} must be an integer between 0 and ${max}.`
        : `${key} must be a non-negative safe integer.`,
    )
  }
  return parsed
}

function appendPageQuery(
  query: URLSearchParams,
  request: Record<string, unknown>,
  limitMax?: number,
) {
  const limit = optionalPageInteger(request, 'limit', limitMax)
  const offset = optionalPageInteger(request, 'offset')
  const reverse = optionalStrictBoolean(request, 'reverse')
  if (limit !== undefined) query.set('limit', String(limit))
  if (offset !== undefined) query.set('offset', String(offset))
  if (reverse !== undefined) query.set('reverse', String(reverse))
}

export function normalizeHomeV2AtAddress(value: unknown) {
  if (typeof value !== 'string') throw new Error('AT address is required.')
  const address = value.trim()
  if (!/^A[1-9A-HJ-NP-Za-km-z]{20,80}$/.test(address)) {
    throw new Error('AT address is invalid.')
  }
  return address
}

// Both cores reject /at/byfunction pages larger than 100 entries.
const LIST_ATS_LIMIT_MAX = 100
// Core has no server-side cap on /blocks/range or /transactions/search page
// sizes, so Home imposes conservative ones before the request goes out.
const BLOCK_RANGE_COUNT_MAX = 100
const TRANSACTION_SEARCH_LIMIT_MAX = 100
// Qortal's SupportedBlockchain enum; /crosschain/price rejects anything else.
const QORTAL_PRICE_BLOCKCHAINS = new Set([
  'BITCOIN',
  'DIGIBYTE',
  'DOGECOIN',
  'LITECOIN',
  'PIRATECHAIN',
  'RAVENCOIN',
])
const TRANSACTION_CONFIRMATION_STATUSES = new Set(['BOTH', 'CONFIRMED', 'UNCONFIRMED'])
// Core's GroupsResource#GroupSearchVisibility enum (both forks, identical):
// ALL, OPEN, CLOSED. Not the Hub-facing PUBLIC/PRIVATE terminology.
const GROUP_SEARCH_VISIBILITIES = new Set(['ALL', 'OPEN', 'CLOSED'])
// Core has no server-side cap on /groups/search or /groups/members page
// sizes; Home imposes the same conservative cap used by the other new-page
// families above before the request goes out.
const GROUP_LIST_LIMIT_MAX = 100

const CHAIN_READ_ACTIONS = new Set<string>([
  'FETCH_BLOCK',
  'FETCH_BLOCK_RANGE',
  'GET_ACCOUNT_GROUPS',
  'GET_ACCOUNT_GROUP_JOIN_REQUESTS',
  'GET_ACTIVE_CHATS',
  'GET_ADMIN_GROUP_JOIN_REQUESTS',
  'GET_AT',
  'GET_AT_DATA',
  'GET_CHAT_MESSAGE',
  'GET_DAY_SUMMARY',
  'GET_GROUP',
  'GET_GROUP_BANS',
  'GET_GROUP_JOIN_REQUESTS',
  'GET_GROUP_KICKS',
  'GET_GROUP_MEMBERS',
  'GET_MEMBER_BANS',
  'GET_MEMBER_KICKS',
  'GET_PRICE',
  'LIST_ATS',
  'LIST_GROUPS',
  'SEARCH_CHAT_MESSAGES',
  'SEARCH_GROUPS',
  'SEARCH_NAMES',
  'SEARCH_TRANSACTIONS',
  // The four zero-key `/crosschain` GETs. They join this set rather than
  // getting their own dispatch so they inherit the chain-read pipeline both
  // hosts already share — one allowlist, one fetch, one response bound — and
  // so the Android bridge picks them up with no extra wiring. Their path
  // builders and the two 1.x response projections live in
  // home-v2-crosschain-actions.ts.
  ...HOME_V2_CROSSCHAIN_READ_ACTIONS,
])

/**
 * Chain reads whose `address` defaults to the selected account.
 *
 * Home 1.x resolved an absent address through getAddressForQdnRequest
 * (electron/qdn.ts:8987-9005) for the member-scoped group reads. Both v2 hosts
 * substitute the selected account's address before building the path, so the
 * builder itself stays synchronous and account-free.
 *
 * Deliberately limited to the two actions restored here. The older
 * member-scoped reads (GET_ACCOUNT_GROUPS, GET_ACCOUNT_GROUP_JOIN_REQUESTS,
 * GET_ADMIN_GROUP_JOIN_REQUESTS, GET_ACTIVE_CHATS) already shipped in Home 2
 * requiring an explicit address; widening them is a behavior change for
 * already-published apps and belongs in its own review, not this one.
 *
 * Posture: the default is the caller's OWN address, which the app can already
 * read with GET_SELECTED_ACCOUNT. It grants no reach it did not have.
 */
export const HOME_V2_SELF_DEFAULTING_ADDRESS_ACTIONS = Object.freeze([
  'GET_MEMBER_BANS',
  'GET_MEMBER_KICKS',
] as const)

const SELF_DEFAULTING_ADDRESS_ACTIONS = new Set<string>(HOME_V2_SELF_DEFAULTING_ADDRESS_ACTIONS)

export function homeV2ChainReadNeedsSelectedAddress(
  action: string,
  request: Record<string, unknown>,
) {
  if (!SELF_DEFAULTING_ADDRESS_ACTIONS.has(action)) return false
  const address = request.address
  return address === undefined || address === null || address === ''
}

export function withHomeV2SelectedAddress(
  request: Record<string, unknown>,
  selectedAddress: string | null | undefined,
) {
  // No fallback offered: either no account is selected, or this is a widget,
  // where self-addressing is withheld (homeV2WidgetWithholdsSelfSubject).
  if (!selectedAddress) {
    throw new Error('Address is required.')
  }
  return { ...request, address: normalizeHomeV2Address(selectedAddress, 'Selected account address') }
}

// Core rejects /chat/messages before/after bounds earlier than this
// (a pre-2018 millisecond timestamp); Home pre-validates the same floor.
const CHAT_SEARCH_TIME_FLOOR_MS = 1_500_000_000_000
const CHAT_SEARCH_LIMIT_MAX = 100

function optionalChatTimeBound(request: Record<string, unknown>, key: string) {
  const value = request[key]
  if (value === undefined || value === null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < CHAT_SEARCH_TIME_FLOOR_MS) {
    throw new Error(`${key} must be a millisecond timestamp no earlier than ${CHAT_SEARCH_TIME_FLOOR_MS}.`)
  }
  return parsed
}

// `before`/`after` are millisecond timestamps on both /chat/messages and
// /groups/kicks, and Core rejects the same pre-2018 floor on each, so the one
// bound validator serves both families.
function appendChatTimeBounds(query: URLSearchParams, request: Record<string, unknown>) {
  const before = optionalChatTimeBound(request, 'before')
  if (before !== undefined) query.set('before', String(before))
  const after = optionalChatTimeBound(request, 'after')
  if (after !== undefined) query.set('after', String(after))
}

function normalizeHomeV2ChatEncoding(value: unknown) {
  if (value === undefined || value === null || value === '') return 'BASE64'
  const encoding = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (encoding !== 'BASE58' && encoding !== 'BASE64') {
    throw new Error('encoding must be BASE58 or BASE64.')
  }
  return encoding
}

// SEND_CHAT_MESSAGE's txGroupId rule (docs/CHAT_2_0_PLAN.md): Qortium's
// general chat is group 0 and stays open; modern Qortal rejects group-0 CHAT
// transactions at the API, so Home requires a positive group id there.
export function normalizeHomeV2SendTxGroupId(protocol: HomeV2AppBridgeProtocol, value: unknown) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('txGroupId must be a non-negative safe integer.')
  }
  if (protocol === 'qortalRequest' && parsed === 0) {
    throw new Error('Qortal no longer accepts general-chat transactions; send to a group instead.')
  }
  return parsed
}

// `message` is an opaque, app-owned payload (qortium-chat JSON on qdnRequest,
// Hub-compatible JSON on qortalRequest). Home only enforces the byte bound
// Core's CHAT transaction validates; it never parses or rewrites the content.
export function normalizeHomeV2ChatMessageText(value: unknown) {
  if (typeof value !== 'string') throw new Error('message is required.')
  const byteLength = new TextEncoder().encode(value).byteLength
  if (byteLength < 1 || byteLength > 4000) {
    throw new Error('message must be between 1 and 4000 bytes after UTF-8 encoding.')
  }
  return value
}

export function isHomeV2ChainReadAction(action: string) {
  return CHAIN_READ_ACTIONS.has(action)
}

function requiredPositiveInteger(value: unknown, key: string, max?: number) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isSafeInteger(parsed) || parsed < 1 || (max !== undefined && parsed > max)) {
    throw new Error(
      max !== undefined
        ? `${key} must be an integer between 1 and ${max}.`
        : `${key} must be a positive safe integer.`,
    )
  }
  return parsed
}

export function buildHomeV2ChainReadPath(action: string, request: Record<string, unknown>) {
  // The `/crosschain` family validates its own coin against a strict allowlist
  // before anything reaches the path; see home-v2-crosschain-actions.ts.
  if (isHomeV2CrosschainReadAction(action)) {
    return buildHomeV2CrosschainReadPath(action, request)
  }
  if (action === 'SEARCH_NAMES') {
    const query = new URLSearchParams()
    query.set('query', requestString(request, 'query', 'Name search query', 256))
    const prefix = optionalStrictBoolean(request, 'prefix')
    if (prefix !== undefined) query.set('prefix', String(prefix))
    appendPageQuery(query, request)
    return `/names/search?${query.toString()}`
  }
  if (action === 'LIST_GROUPS') {
    const query = new URLSearchParams()
    appendPageQuery(query, request)
    return `/groups${query.size ? `?${query.toString()}` : ''}`
  }
  // SEARCH_GROUPS is Qortium-only (see QDN_ACTIONS/QORTAL_ACTIONS above):
  // /groups/search does not exist on Qortal.
  if (action === 'SEARCH_GROUPS') {
    const query = new URLSearchParams()
    query.set('query', requestString(request, 'query', 'Group search query', 256))
    const visibility = typeof request.visibility === 'string'
      ? request.visibility.trim().toUpperCase()
      : ''
    if (visibility) {
      if (!GROUP_SEARCH_VISIBILITIES.has(visibility)) {
        throw new Error('visibility must be ALL, OPEN, or CLOSED.')
      }
      query.set('visibility', visibility)
    }
    const prefixOnly = optionalStrictBoolean(request, 'prefixOnly')
    if (prefixOnly !== undefined) query.set('prefixOnly', String(prefixOnly))
    appendPageQuery(query, request, GROUP_LIST_LIMIT_MAX)
    return `/groups/search?${query.toString()}`
  }
  if (action === 'GET_GROUP') {
    return `/groups/${requiredPositiveInteger(request.groupId, 'groupId')}`
  }
  if (action === 'GET_ACCOUNT_GROUPS') {
    const address = normalizeHomeV2Address(request.address)
    const query = new URLSearchParams()
    const adminOnly = optionalStrictBoolean(request, 'adminOnly')
    if (adminOnly !== undefined) query.set('adminOnly', String(adminOnly))
    const ownerOnly = optionalStrictBoolean(request, 'ownerOnly')
    if (ownerOnly !== undefined) query.set('ownerOnly', String(ownerOnly))
    return `/groups/member/${encodeURIComponent(address)}${query.size ? `?${query.toString()}` : ''}`
  }
  if (action === 'GET_GROUP_MEMBERS') {
    const groupId = requiredPositiveInteger(request.groupId, 'groupId')
    const query = new URLSearchParams()
    const onlyAdmins = optionalStrictBoolean(request, 'onlyAdmins')
    if (onlyAdmins !== undefined) query.set('onlyAdmins', String(onlyAdmins))
    appendPageQuery(query, request, GROUP_LIST_LIMIT_MAX)
    return `/groups/members/${groupId}${query.size ? `?${query.toString()}` : ''}`
  }
  if (action === 'GET_GROUP_JOIN_REQUESTS') {
    return `/groups/joinrequests/${requiredPositiveInteger(request.groupId, 'groupId')}`
  }
  // The four group ban/kick reads. Public group moderation history on both
  // forks: Core serves them anonymously, they name no private data, and the
  // WRITES that create these records (GROUP_BAN, GROUP_KICK, CANCEL_GROUP_BAN)
  // are signed transactions that never travel through this GET passthrough.
  // Path shapes ported from Home 1.x buildGroupBansPath / buildGroupKicksPath /
  // buildMemberBansPath / buildMemberKicksPath (electron/qdn.ts:8922-8973).
  if (action === 'GET_GROUP_BANS') {
    return `/groups/bans/${requiredPositiveInteger(request.groupId, 'groupId')}`
  }
  if (action === 'GET_GROUP_KICKS') {
    const groupId = requiredPositiveInteger(request.groupId, 'groupId')
    const query = new URLSearchParams()
    if (request.address !== undefined && request.address !== null && request.address !== '') {
      query.set('address', normalizeHomeV2Address(request.address))
    }
    appendChatTimeBounds(query, request)
    appendPageQuery(query, request, GROUP_LIST_LIMIT_MAX)
    return `/groups/kicks/${groupId}${query.size ? `?${query.toString()}` : ''}`
  }
  if (action === 'GET_MEMBER_BANS') {
    const query = new URLSearchParams()
    query.set('address', normalizeHomeV2Address(request.address))
    appendPageQuery(query, request, GROUP_LIST_LIMIT_MAX)
    return `/groups/bans/member?${query.toString()}`
  }
  if (action === 'GET_MEMBER_KICKS') {
    const query = new URLSearchParams()
    query.set('address', normalizeHomeV2Address(request.address))
    const groupId = optionalPageInteger(request, 'groupId')
    if (groupId !== undefined) query.set('groupId', String(groupId))
    appendChatTimeBounds(query, request)
    appendPageQuery(query, request, GROUP_LIST_LIMIT_MAX)
    return `/groups/kicks/member?${query.toString()}`
  }
  if (action === 'GET_ACCOUNT_GROUP_JOIN_REQUESTS') {
    return `/groups/joinrequests/address/${encodeURIComponent(normalizeHomeV2Address(request.address))}`
  }
  if (action === 'GET_ADMIN_GROUP_JOIN_REQUESTS') {
    return `/groups/joinrequests/admin/${encodeURIComponent(normalizeHomeV2Address(request.address))}`
  }
  if (action === 'GET_AT') {
    return `/at/${encodeURIComponent(normalizeHomeV2AtAddress(request.atAddress))}`
  }
  if (action === 'GET_AT_DATA') {
    return `/at/${encodeURIComponent(normalizeHomeV2AtAddress(request.atAddress))}/data`
  }
  if (action === 'LIST_ATS') {
    const codeHash = typeof request.codeHash58 === 'string' ? request.codeHash58.trim() : ''
    if (!/^[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(codeHash)) {
      throw new Error('codeHash58 must be the Base58 hash of 32 bytes of AT code.')
    }
    const query = new URLSearchParams()
    const isExecutable = optionalStrictBoolean(request, 'isExecutable')
    if (isExecutable !== undefined) query.set('isExecutable', String(isExecutable))
    appendPageQuery(query, request, LIST_ATS_LIMIT_MAX)
    return `/at/byfunction/${encodeURIComponent(codeHash)}${query.size ? `?${query.toString()}` : ''}`
  }
  if (action === 'FETCH_BLOCK') {
    const hasSignature = request.signature !== undefined && request.signature !== null
    const hasHeight = request.height !== undefined && request.height !== null
    // Hub silently prefers signature when both selectors are present and
    // times out when neither is; Home requires exactly one.
    if (hasSignature === hasHeight) {
      throw new Error('FETCH_BLOCK requires exactly one of signature or height.')
    }
    const query = new URLSearchParams()
    const includeOnlineSignatures = optionalStrictBoolean(request, 'includeOnlineSignatures')
    if (includeOnlineSignatures !== undefined) {
      query.set('includeOnlineSignatures', String(includeOnlineSignatures))
    }
    const suffix = query.size ? `?${query.toString()}` : ''
    if (hasSignature) {
      const signature = typeof request.signature === 'string' ? request.signature.trim() : ''
      if (!/^[1-9A-HJ-NP-Za-km-z]{80,200}$/.test(signature)) {
        throw new Error('Block signature is invalid.')
      }
      return `/blocks/signature/${encodeURIComponent(signature)}${suffix}`
    }
    return `/blocks/byheight/${requiredPositiveInteger(request.height, 'height')}${suffix}`
  }
  if (action === 'FETCH_BLOCK_RANGE') {
    const height = requiredPositiveInteger(request.height, 'height')
    const query = new URLSearchParams()
    query.set('count', String(requiredPositiveInteger(request.count, 'count', BLOCK_RANGE_COUNT_MAX)))
    const reverse = optionalStrictBoolean(request, 'reverse')
    if (reverse !== undefined) query.set('reverse', String(reverse))
    const includeOnlineSignatures = optionalStrictBoolean(request, 'includeOnlineSignatures')
    if (includeOnlineSignatures !== undefined) {
      query.set('includeOnlineSignatures', String(includeOnlineSignatures))
    }
    return `/blocks/range/${height}?${query.toString()}`
  }
  if (action === 'SEARCH_TRANSACTIONS') {
    const query = new URLSearchParams()
    const startBlock = optionalPageInteger(request, 'startBlock')
    const blockLimit = optionalPageInteger(request, 'blockLimit')
    const txGroupId = optionalPageInteger(request, 'txGroupId')
    if (startBlock !== undefined) query.set('startBlock', String(startBlock))
    if (blockLimit !== undefined) query.set('blockLimit', String(blockLimit))
    if (txGroupId !== undefined) query.set('txGroupId', String(txGroupId))
    const txTypes: string[] = []
    if (request.txType !== undefined && request.txType !== null) {
      if (!Array.isArray(request.txType)) {
        throw new Error('txType must be an array of transaction type names.')
      }
      for (const value of request.txType) {
        const txType = typeof value === 'string' ? value.trim().toUpperCase() : ''
        if (!/^[A-Z][A-Z0-9_]{1,64}$/.test(txType)) {
          throw new Error('txType entries must be transaction type names.')
        }
        txTypes.push(txType)
        query.append('txType', txType)
      }
    }
    const hasAddress = request.address !== undefined && request.address !== null && request.address !== ''
    if (hasAddress) query.set('address', normalizeHomeV2Address(request.address))
    // The forks disagree on the default (Qortal null, Qortium CONFIRMED), so
    // Home requires the status explicitly for deterministic behavior.
    const status = typeof request.confirmationStatus === 'string'
      ? request.confirmationStatus.trim().toUpperCase()
      : ''
    if (!TRANSACTION_CONFIRMATION_STATUSES.has(status)) {
      throw new Error('confirmationStatus must be CONFIRMED, UNCONFIRMED, or BOTH.')
    }
    query.set('confirmationStatus', status)
    const limit = optionalPageInteger(request, 'limit', TRANSACTION_SEARCH_LIMIT_MAX)
    if (limit !== undefined) query.set('limit', String(limit))
    const offset = optionalPageInteger(request, 'offset')
    if (offset !== undefined) query.set('offset', String(offset))
    const reverse = optionalStrictBoolean(request, 'reverse')
    if (reverse !== undefined) query.set('reverse', String(reverse))
    // Core rejects unconstrained searches; fail before the request instead.
    if (!txTypes.length && !hasAddress && (limit === undefined || limit === 0 || limit > 20)) {
      throw new Error(
        'SEARCH_TRANSACTIONS requires txType, address, or a limit of at most 20.',
      )
    }
    return `/transactions/search?${query.toString()}`
  }
  if (action === 'GET_DAY_SUMMARY') {
    return '/admin/summary'
  }
  if (action === 'GET_PRICE') {
    const blockchain = typeof request.blockchain === 'string'
      ? request.blockchain.trim().toUpperCase()
      : ''
    if (!QORTAL_PRICE_BLOCKCHAINS.has(blockchain)) {
      throw new Error('blockchain must be a supported Qortal foreign blockchain.')
    }
    const query = new URLSearchParams()
    const maxTradesValue = request.maxtrades ?? request.maxTrades
    if (maxTradesValue !== undefined && maxTradesValue !== null && maxTradesValue !== '') {
      query.set('maxtrades', String(requiredPositiveInteger(maxTradesValue, 'maxtrades', 100)))
    }
    const inverse = optionalStrictBoolean(request, 'inverse')
    if (inverse !== undefined) query.set('inverse', String(inverse))
    return `/crosschain/price/${blockchain}${query.size ? `?${query.toString()}` : ''}`
  }
  if (action === 'SEARCH_CHAT_MESSAGES') {
    // Decided 2026-08-12 (docs/CHAT_2_0_PLAN.md): DM-involving search is
    // deferred to the Phase 2 DM family. Reject it with a specific error
    // instead of silently dropping the selector.
    if (
      (request.involving !== undefined && request.involving !== null) ||
      (request.sender !== undefined && request.sender !== null) ||
      (request.recipient !== undefined && request.recipient !== null)
    ) {
      throw new Error(
        'Chat search is groups-only in this release; direct-message search arrives with the DM family.',
      )
    }
    const txGroupId = optionalPageInteger(request, 'txGroupId')
    if (txGroupId === undefined) {
      throw new Error('txGroupId is required.')
    }
    const query = new URLSearchParams()
    query.set('txGroupId', String(txGroupId))
    const before = optionalChatTimeBound(request, 'before')
    if (before !== undefined) query.set('before', String(before))
    const after = optionalChatTimeBound(request, 'after')
    if (after !== undefined) query.set('after', String(after))
    appendPageQuery(query, request, CHAT_SEARCH_LIMIT_MAX)
    query.set('encoding', normalizeHomeV2ChatEncoding(request.encoding))
    return `/chat/messages?${query.toString()}`
  }
  if (action === 'GET_CHAT_MESSAGE') {
    const signature = typeof request.signature === 'string' ? request.signature.trim() : ''
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,128}$/.test(signature)) {
      throw new Error('Chat message signature is invalid.')
    }
    const query = new URLSearchParams()
    query.set('encoding', normalizeHomeV2ChatEncoding(request.encoding))
    return `/chat/message/${encodeURIComponent(signature)}?${query.toString()}`
  }
  if (action === 'GET_ACTIVE_CHATS') {
    const address = normalizeHomeV2Address(request.address)
    const query = new URLSearchParams()
    query.set('encoding', normalizeHomeV2ChatEncoding(request.encoding))
    const hasChatReference = optionalStrictBoolean(request, 'hasChatReference')
    if (hasChatReference !== undefined) query.set('haschatreference', String(hasChatReference))
    return `/chat/active/${encodeURIComponent(address)}?${query.toString()}`
  }
  throw new Error(`${action} is not a supported chain read.`)
}

/**
 * The two trust reads: GET_ACCOUNT_RATING and GET_RESOURCE_RATING.
 *
 * They sit apart from the single-path chain reads because each answers with
 * TWO node reads combined — the public summary for the subject, plus this
 * rater's own rating of it — exactly as Home 1.x did
 * (electron/qdn.ts:7712-7786).
 *
 * Both are anonymous public reads. `/account-ratings` and `/resource-ratings`
 * are unauthenticated on both forks and are already in READ_PREFIXES; the
 * rating WRITES (RATE_ACCOUNT, RATE_RESOURCE) are signed transactions and are
 * NOT restored here. A 404 on either half is a normal answer — nobody has
 * rated this subject yet — so the host maps it to the documented empty value
 * rather than failing the call.
 */
export const HOME_V2_RATING_READ_ACTIONS = Object.freeze([
  'GET_ACCOUNT_RATING',
  'GET_RESOURCE_RATING',
] as const)

const RATING_READ_ACTIONS = new Set<string>(HOME_V2_RATING_READ_ACTIONS)

export function isHomeV2RatingReadAction(action: string) {
  return RATING_READ_ACTIONS.has(action)
}

export function homeV2RatingReadNeedsSelectedAddress(request: Record<string, unknown>) {
  const rater = request.rater
  return rater === undefined || rater === null || rater === ''
}

export type HomeV2RatingRead = {
  readonly meta: Record<string, unknown>
  readonly ratingFallback: unknown
  readonly ratingPath: string
  readonly summaryPath: string
}

export function buildHomeV2RatingRead(
  action: string,
  request: Record<string, unknown>,
  raterAddress: string | null | undefined,
): HomeV2RatingRead {
  const explicitRater = request.rater
  const rater = explicitRater !== undefined && explicitRater !== null && explicitRater !== ''
    ? normalizeHomeV2Address(explicitRater, 'Rater address')
    : raterAddress
      ? normalizeHomeV2Address(raterAddress, 'Selected account address')
      // No fallback offered: either no account is selected, or this is a
      // widget, where self-addressing is withheld — a rating response echoes
      // `rater` back, so defaulting it there would disclose the selected
      // identity with no chrome to say so.
      : (() => {
          throw new Error('A rater address is required.')
        })()

  if (action === 'GET_RESOURCE_RATING') {
    const { service, name } = normalizedResource(request)
    // 1.x defaults a blank identifier to 'default', matching how Core keys an
    // identifier-less resource.
    const identifier = optionalRequestString(request, 'identifier') || 'default'
    const summaryQuery = new URLSearchParams({ service, name, identifier })
    const ratingQuery = new URLSearchParams({ service, name, identifier, rater })
    return {
      meta: { action, identifier, name, rater, service },
      ratingFallback: null,
      ratingPath: `/resource-ratings/rating?${ratingQuery.toString()}`,
      summaryPath: `/resource-ratings/summary?${summaryQuery.toString()}`,
    }
  }

  if (action === 'GET_ACCOUNT_RATING') {
    const target = normalizeHomeV2Address(request.target, 'Target address')
    const category = optionalRequestString(request, 'category')
    const summaryQuery = new URLSearchParams({ target, ...(category ? { category } : {}) })
    const ratingQuery = new URLSearchParams({ target, rater, ...(category ? { category } : {}) })
    return {
      meta: { action, category, rater, target },
      // The account-rating half is a LIST, so its empty answer is [] rather
      // than null (1.x qdn.ts:7776).
      ratingFallback: [],
      ratingPath: `/account-ratings?${ratingQuery.toString()}`,
      summaryPath: `/account-ratings/summary?${summaryQuery.toString()}`,
    }
  }

  throw new Error(`${action} is not a supported rating read.`)
}

/**
 * Core answers "no ratings yet" three different ways depending on endpoint and
 * fork — null, [], or {} — and an app should not have to tell them apart.
 * Collapse all three to null. Ported from 1.x normalizeRatingSummary
 * (electron/qdn.ts:7678-7692).
 */
export function normalizeHomeV2RatingSummary(summary: unknown) {
  if (summary === null || summary === undefined) return null
  if (Array.isArray(summary) && summary.length === 0) return null
  if (
    !!summary &&
    typeof summary === 'object' &&
    !Array.isArray(summary) &&
    Object.keys(summary).length === 0
  ) {
    return null
  }
  return summary
}

export function buildHomeV2RatingReadResult(
  read: HomeV2RatingRead,
  summary: unknown,
  rating: unknown,
) {
  const normalizedSummary = normalizeHomeV2RatingSummary(summary)
  if (read.meta.action === 'GET_ACCOUNT_RATING') {
    return Object.freeze({
      ...read.meta,
      ratings: Array.isArray(rating) ? rating : [],
      summary: normalizedSummary,
    })
  }
  return Object.freeze({
    ...read.meta,
    rating: rating ?? null,
    summary: normalizedSummary,
  })
}

/**
 * The node-local list family: GET_ALL_LISTS, GET_LIST, ADD_TO_LIST,
 * REMOVE_FROM_LIST.
 *
 * Lists are private state on the user's own node (Core stores them on the
 * node's disk and gates every /lists route behind the admin API key), so this
 * family is nothing like the anonymous chain reads above: every call — reads
 * included — needs a node Home holds the administrative key for. That is the
 * same trusted-admin-node rule minting uses (evaluateHomeV2AdminTrust: the
 * local Core Home runs itself, reached over loopback, key in hand). Android
 * has no local mode, so the family answers there with the coded
 * NODE_CAPABILITY_MISSING error rather than pretending an empty answer — the
 * honest match for 1.x, whose lists only ever worked in the emulator.
 *
 * The two writes prompt (they change what the user's node stores, and apps
 * commonly use lists for blocking — a silent write here silently changes what
 * the user sees everywhere); the two reads are permissionless under the
 * 2026-08-24 owner decision, the same trust boundary as every other read.
 *
 * Request shapes are 1.x parity (electron/qdn.ts getRequiredListName /
 * getRequiredListItems), with one deliberate divergence: 1.x silently DROPPED
 * non-string or empty entries from `items` and proceeded with the survivors,
 * which turns an app bug into a half-applied write reported as success. Home 2
 * refuses the whole request instead.
 */
export const HOME_V2_LIST_READ_ACTIONS = Object.freeze([
  'GET_ALL_LISTS',
  'GET_LIST',
] as const)

export const HOME_V2_LIST_WRITE_ACTIONS = Object.freeze([
  'ADD_TO_LIST',
  'REMOVE_FROM_LIST',
] as const)

export type HomeV2ListWriteAction = (typeof HOME_V2_LIST_WRITE_ACTIONS)[number]

const LIST_READ_ACTIONS = new Set<string>(HOME_V2_LIST_READ_ACTIONS)
const LIST_WRITE_ACTIONS = new Set<string>(HOME_V2_LIST_WRITE_ACTIONS)

export function isHomeV2ListReadAction(action: string) {
  return LIST_READ_ACTIONS.has(action)
}

export function isHomeV2ListWriteAction(action: string): action is HomeV2ListWriteAction {
  return LIST_WRITE_ACTIONS.has(action)
}

export function isHomeV2ListAction(action: string) {
  return LIST_READ_ACTIONS.has(action) || LIST_WRITE_ACTIONS.has(action)
}

// 1.x rule (electron/qdn.ts:9231-9239 plus the 120-char write check): a list
// name starts with a letter and stays to letters, digits and underscores.
// 1.x only enforced the length cap on the write path; Home 2 applies it to
// reads too — a name that cannot be written cannot exist to be read.
export function normalizeHomeV2ListName(request: Record<string, unknown>) {
  const listName = requestString(request, 'listName', 'List name', 120)
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(listName)) {
    throw new Error('List name must start with a letter and contain only letters, numbers, or underscores.')
  }
  return listName
}

// 1.x trimmed every retained item, so a trailing-space variant of an existing
// entry could never create a near-duplicate; keep that. Items are otherwise
// exact, case-sensitive strings — Core stores and matches them verbatim.
export function normalizeHomeV2ListItems(request: Record<string, unknown>) {
  const items = request.items
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Items must be a non-empty array.')
  }
  const itemStrings = items.map((item) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error('Items must contain only non-empty strings.')
    }
    return item.trim()
  })
  return Object.freeze(itemStrings)
}

// 1.x refused, before prompting, any write whose serialized item array could
// not be displayed in full on the approval dialog (electron/qdn.ts, 4000-char
// cap, same message). An approval the user cannot read is not an approval.
//
// The serialization is escaped to printable ASCII before display: JSON already
// escapes C0 controls, and everything from DEL up is rewritten to \uXXXX here.
// A bidi override (U+202E), a Unicode line/paragraph separator, or any other
// invisible character can therefore never reorder or restyle what the user
// reads against what Core receives — the app's raw strings still go to the
// node untouched via buildHomeV2ListWriteBody; only the prompt shows the
// escaped form. The 4000-char cap applies to the escaped form, because the
// cap is about what can be DISPLAYED.
export function serializeHomeV2ListItemsForApproval(items: readonly string[]) {
  const serialized = JSON.stringify(items).replace(
    /[\u007f-\uffff]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
  if (serialized.length > 4_000) {
    throw new Error('QDN write request data is too large to display safely for approval (4000 characters maximum).')
  }
  return serialized
}

export function buildHomeV2ListPath(listName: string) {
  return `/lists/${encodeURIComponent(listName)}`
}

export function buildHomeV2ListWriteBody(items: readonly string[]) {
  return JSON.stringify({ items })
}

/**
 * GET_LIST parity: 1.x mapped an HTTP 404 to [] (electron/qdn.ts:9291-9293).
 * Current Core does not actually 404 a missing list — it answers [] itself —
 * but the defensive mapping is kept because "you have no such list" and "your
 * list is empty" are the same answer to an app either way. Any other non-OK
 * status is a real error and is NOT normalized here.
 */
export function normalizeHomeV2ListReadResult(status: number, data: unknown) {
  if (status === 404) return []
  return data
}

/**
 * The poll write family: CREATE_POLL, VOTE_ON_POLL, UPDATE_POLL — Qortium
 * qdnRequest only. Each signs a chain transaction through the keyless
 * /polls/public/* builders using the group-membership signing pattern
 * (byte-assert, MemoryPoW, local Ed25519, zero fee).
 *
 * Request shapes are 1.x parity (electron/qdn.ts poll handlers + the shared
 * qdn-poll-*.ts parsers, which this module reuses), tightened to Core\'s real
 * limits so a request Core would reject fails here with a named reason before
 * any prompt is raised. Two deliberate v2 divergences, both documented in
 * BRIDGE_ACTIONS.md: `fee` and `txGroupId`, when present, must be 0 (the
 * fee-less MemoryPoW path is the only signing path Home 2 carries), and
 * `pollId` must be at least 1 (1.x accepted 0 and let Core reject it).
 *
 * Poll VOTES are by pollId only, and option indexes are ONE-based: 0 (or []
 * or [0]) means "remove my vote" and cannot combine with real selections —
 * the shared vote parser enforces that and sorts multi-option selections into
 * Core\'s canonical ascending order.
 */
export const HOME_V2_POLL_WRITE_ACTIONS = Object.freeze([
  'CREATE_POLL',
  'UPDATE_POLL',
  'VOTE_ON_POLL',
] as const)

export type HomeV2PollWriteAction = (typeof HOME_V2_POLL_WRITE_ACTIONS)[number]

// Shared between the bridge (which stamps it on the prompt) and the shell
// (which refuses a prompt whose label does not match its action — a forged
// payload must not be able to caption a vote as a harmless-sounding create).
export function homeV2PollOperationLabel(action: HomeV2PollWriteAction, removal = false) {
  if (action === 'CREATE_POLL') return 'Create a poll'
  if (action === 'UPDATE_POLL') return 'Update a poll'
  return removal ? 'Remove a poll vote' : 'Vote on a poll'
}

const POLL_WRITE_ACTIONS = new Set<string>(HOME_V2_POLL_WRITE_ACTIONS)

export function isHomeV2PollWriteAction(action: string): action is HomeV2PollWriteAction {
  return POLL_WRITE_ACTIONS.has(action)
}

const POLL_TEXT_ENCODER = new TextEncoder()

// Core: 3-400 UTF-8 bytes, and the stored name must equal Core's
// Unicode.normalize() of itself (NAME_NOT_NORMALIZED otherwise). Core's rule
// is NFKC plus removal of controls and zero-width/bidi characters plus
// whitespace collapsing — approximated here so the common cases fail with a
// named reason before any prompt; Core remains the authority, and an exotic
// input that passes here can still answer NAME_NOT_NORMALIZED from the
// builder. (Security review 2026-08-26, finding 4.)
function normalizeHomeV2PollNameValue(value: unknown, label: string) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name) throw new Error(`${label} is required.`)
  const byteLength = POLL_TEXT_ENCODER.encode(name).byteLength
  if (byteLength < 3 || byteLength > 400) {
    throw new Error(`${label} must be 3 to 400 UTF-8 bytes.`)
  }
  if (
    name !== name.normalize('NFKC') ||
    /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/.test(name) ||
    /\s{2,}/.test(name) ||
    /[^\S ]/.test(name)
  ) {
    throw new Error(`${label} must be in Unicode normalized form (no compatibility characters, controls, invisible characters, or repeated whitespace).`)
  }
  return name
}

function normalizeHomeV2PollDescription(value: unknown, label: string) {
  const description = typeof value === 'string' ? value.trim() : ''
  if (POLL_TEXT_ENCODER.encode(description).byteLength > 4_000) {
    throw new Error(`${label} must be at most 4000 UTF-8 bytes.`)
  }
  return description
}

function optionalHomeV2PollTime(value: unknown, key: string, requireFuture: boolean) {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${key} must be a non-negative safe integer.`)
  }
  // Core requires a CREATE time (and an UPDATE's new end) to be later than
  // the transaction timestamp, which is taken moments after this runs; a
  // past value can only ever fail there, so it is refused here with the
  // actual rule. An UPDATE's newStartTime is exempt: Core rejects a past
  // start only when the start CHANGED, and a legitimate metadata update on a
  // started, vote-free poll must resend its existing (past) start unchanged
  // (security review 2026-08-26, round 2).
  if (requireFuture && parsed <= Date.now()) {
    throw new Error(`${key} must be in the future (epoch milliseconds).`)
  }
  return parsed
}

// The fee-less MemoryPoW path is the only signing path Home 2 carries. An
// app may still SEND the 1.x fee/group fields; any value other than 0 is
// refused, never silently zeroed — a fee the app believed it was paying
// must not vanish.
function assertHomeV2SignedWriteFeeAndGroup(request: Record<string, unknown>, family: string) {
  for (const key of ['fee'] as const) {
    const value = request[key]
    if (value !== undefined && value !== null && value !== 0) {
      throw new Error(`Home 2 signs ${family} transactions fee-free; fee, when present, must be 0.`)
    }
  }
  for (const key of ['txGroupId', 'feeGroupId'] as const) {
    const value = request[key]
    if (value === undefined || value === null) continue
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
    if (parsed !== 0) {
      throw new Error(`Home 2 ${family} transactions use transaction group 0; txGroupId, when present, must be 0.`)
    }
  }
}

function assertHomeV2PollFeeAndGroup(request: Record<string, unknown>) {
  assertHomeV2SignedWriteFeeAndGroup(request, 'poll')
}

function homeV2PollRequestInteger(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim())
    return Number.isSafeInteger(parsed) ? parsed : undefined
  }
  return undefined
}

function requiredHomeV2PollId(request: Record<string, unknown>) {
  const raw = request.pollId ?? request.poll
  if (raw === undefined || raw === null || raw === '') throw new Error('Poll id is required.')
  const parsed = homeV2PollRequestInteger(raw)
  // 1.x accepted 0 and let Core reject the nonexistent poll; Core assigns ids
  // from 1 and stores them as a signed 32-bit integer, so both bounds are
  // enforced here with the real rule.
  if (typeof parsed !== 'number' || parsed < 1 || parsed > 2_147_483_647) {
    throw new Error('Poll id must be a positive 32-bit integer.')
  }
  return parsed
}

export type HomeV2CreatePollRequest = {
  readonly description: string
  readonly endTime?: number
  readonly owner: string
  readonly pollName: string
  readonly pollOptions: readonly string[]
  readonly startTime?: number
}

export function normalizeHomeV2CreatePollRequest(
  request: Record<string, unknown>,
  selectedAddress: string,
): HomeV2CreatePollRequest {
  assertHomeV2PollFeeAndGroup(request)
  const pollName = normalizeHomeV2PollNameValue(request.pollName, 'Poll name')
  const description = normalizeHomeV2PollDescription(request.description, 'Description')
  const pollOptions = getPollOptionsInput(request.pollOptions ?? request.options).map((option) => option.optionName)
  const ownerRaw = typeof request.owner === 'string' && request.owner.trim() ? request.owner.trim() : selectedAddress
  if (!/^Q[1-9A-HJ-NP-Za-km-z]{20,}$/.test(ownerRaw)) {
    throw new Error('Owner address must be a Qortium address.')
  }
  const startTime = optionalHomeV2PollTime(request.startTime ?? request.pollStartTime, 'startTime', true)
  const endTime = optionalHomeV2PollTime(request.endTime ?? request.pollEndTime, 'endTime', true)
  if (startTime !== undefined && endTime !== undefined && startTime >= endTime) {
    throw new Error('startTime must be earlier than endTime.')
  }
  return Object.freeze({ description, endTime, owner: ownerRaw, pollName, pollOptions: Object.freeze(pollOptions), startTime })
}

export type HomeV2VoteOnPollRequest = {
  readonly optionInput: PollVoteOptionInput
  readonly pollId: number
}

export function normalizeHomeV2VoteOnPollRequest(request: Record<string, unknown>): HomeV2VoteOnPollRequest {
  assertHomeV2PollFeeAndGroup(request)
  const pollId = requiredHomeV2PollId(request)
  const singularRaw = request.optionIndex ?? request.option
  const singular = singularRaw === undefined || singularRaw === null || singularRaw === ''
    ? undefined
    : (() => {
        const parsed = homeV2PollRequestInteger(singularRaw)
        if (typeof parsed !== 'number') throw new Error('Option index must be a safe integer.')
        if (parsed < 0) throw new Error('Option index must be at least 0.')
        return parsed
      })()
  const plural = getOptionalPollVoteOptionIndexes(request.optionIndexes, homeV2PollRequestInteger)
  return Object.freeze({ optionInput: resolvePollVoteOptionInput(singular, plural), pollId })
}

/**
 * The selection in the CANONICAL form the byte verifier expects: [] for a
 * removal (however the app spelled it — 0, [0], or []), [i] for one real
 * option, ascending indexes for several. This is also the form the Core
 * builder serializes, so prompt, assertion, and wire all describe the same
 * selection.
 */
export function canonicalHomeV2VoteSelection(optionInput: PollVoteOptionInput): readonly number[] {
  if (optionInput.optionIndexes === undefined) {
    return Object.freeze(optionInput.optionIndex === 0 ? [] : [optionInput.optionIndex as number])
  }
  const real = optionInput.optionIndexes.filter((index) => index !== 0)
  return Object.freeze([...real].sort((a, b) => a - b))
}

export type HomeV2UpdatePollRequest = {
  readonly newDescription: string
  readonly newEndTime?: number
  readonly newPollName: string
  readonly newPollOptions: readonly string[]
  readonly newStartTime?: number
  readonly pollId: number
}

export function normalizeHomeV2UpdatePollRequest(request: Record<string, unknown>): HomeV2UpdatePollRequest {
  assertHomeV2PollFeeAndGroup(request)
  const pollId = requiredHomeV2PollId(request)
  const newPollName = normalizeHomeV2PollNameValue(request.newPollName, 'New poll name')
  const newDescription = normalizeHomeV2PollDescription(request.newDescription ?? request.description, 'New description')
  const newPollOptions = getPollOptionsInput(request.newPollOptions ?? request.pollOptions ?? request.options)
    .map((option) => option.optionName)
  const newStartTime = optionalHomeV2PollTime(request.newStartTime ?? request.startTime, 'newStartTime', false)
  const newEndTime = optionalHomeV2PollTime(request.newEndTime ?? request.endTime, 'newEndTime', true)
  if (newStartTime !== undefined && newEndTime !== undefined && newStartTime >= newEndTime) {
    throw new Error('newStartTime must be earlier than newEndTime.')
  }
  return Object.freeze({
    newDescription,
    newEndTime,
    newPollName,
    newPollOptions: Object.freeze(newPollOptions),
    newStartTime,
    pollId,
  })
}

/**
 * The subject poll as the prompt and the pre-sign revalidation need it,
 * selected from Core\'s GET /polls/id/{pollId} answer. Options arrive in
 * on-chain order; their ORDER is part of what a vote means, so it is
 * preserved exactly.
 */
export function selectHomeV2PollTarget(value: unknown, pollId: number) {
  if (!isHomeV2AppRecord(value) || typeof value.pollName !== 'string' || !Array.isArray(value.pollOptions)) {
    throw new Error('The poll lookup answered with an unrecognized shape.')
  }
  // The answer must be about the poll that was asked for. Without this a
  // node could answer /polls/id/7 with a different poll's record and have
  // its name and labels presented as poll 7's (security review 2026-08-26,
  // finding 2) — the node can still lie about poll 7's CONTENT, which is the
  // documented untrusted-node residual, but it cannot substitute a record
  // that does not even claim to be the target.
  if (value.pollId !== pollId) {
    throw new Error('The poll lookup answered about a different poll.')
  }
  const optionNames = value.pollOptions.map((entry) => {
    if (!isHomeV2AppRecord(entry) || typeof entry.optionName !== 'string') {
      throw new Error('The poll lookup answered with an unrecognized option shape.')
    }
    return entry.optionName
  })
  return Object.freeze({
    optionNames: Object.freeze(optionNames),
    owner: typeof value.owner === 'string' ? value.owner : '',
    pollId,
    pollName: value.pollName,
  })
}

/**
 * The name write family: REGISTER_NAME, UPDATE_NAME, SELL_NAME,
 * CANCEL_SELL_NAME, BUY_NAME — Qortium qdnRequest only, each one fee-free
 * signed transaction through Core\'s keyless /names/public/* builders on the
 * poll-family pattern.
 *
 * Amounts are Qortium\'s eight-decimal fixed point. They are parsed once into
 * an exact ATOMIC bigint plus a canonical decimal string, and every later
 * comparison — prompt, builder body, byte-assert — uses those two forms;
 * floating point never touches an amount after parsing. BUY_NAME transfers
 * the sale amount to the seller, so its prompt is payment-grade.
 *
 * Core\'s Unicode rules stay authoritative: Home enforces byte limits and
 * exact-string display only, and never substitutes a reduced or normalized
 * spelling for what the user approved.
 */
// The 1.x bridge read `payload[field] ?? request[field]` for every field.
// Flatten to that precedence once, so the name normalizers (which read many
// fields) honor payload nesting without threading the lookup through each.
export function homeV2FlattenPayloadRequest(request: Record<string, unknown>): Record<string, unknown> {
  const payload = request.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return request
  const flattened: Record<string, unknown> = { ...request }
  for (const key of Object.keys(payload as Record<string, unknown>)) {
    // `__proto__` is skipped and every field is written with defineProperty,
    // never `flattened[key] = value`: a plain assignment of a "__proto__"
    // key would invoke the prototype setter and let a crafted payload inject
    // fields through the object's prototype. (Security review 2026-08-26.)
    if (key === 'action' || key === '__proto__') continue
    const value = (payload as Record<string, unknown>)[key]
    if (value !== undefined && value !== null) {
      Object.defineProperty(flattened, key, { configurable: true, enumerable: true, value, writable: true })
    }
  }
  return flattened
}

export const HOME_V2_NAME_WRITE_ACTIONS = Object.freeze([
  'BUY_NAME',
  'CANCEL_SELL_NAME',
  'REGISTER_NAME',
  'SELL_NAME',
  'UPDATE_NAME',
] as const)

export type HomeV2NameWriteAction = (typeof HOME_V2_NAME_WRITE_ACTIONS)[number]

const NAME_WRITE_ACTIONS = new Set<string>(HOME_V2_NAME_WRITE_ACTIONS)

export function isHomeV2NameWriteAction(action: string): action is HomeV2NameWriteAction {
  return NAME_WRITE_ACTIONS.has(action)
}

// Shared between the bridge (which stamps it on the prompt) and the shell
// (which refuses a prompt whose label does not match its action).
export function homeV2NameOperationLabel(action: HomeV2NameWriteAction) {
  if (action === 'REGISTER_NAME') return 'Register a name'
  if (action === 'UPDATE_NAME') return 'Update a name'
  if (action === 'SELL_NAME') return 'Offer a name for sale'
  if (action === 'CANCEL_SELL_NAME') return 'Cancel a name sale'
  return 'Buy a name'
}

// The restored publishing extras. PUBLISH_MULTIPLE_QDN_RESOURCES loops the
// Home 2 single-publish contract over a bounded batch with full per-item
// prompt disclosure; DELETE_QDN_RESOURCE publishes the on-chain deletion
// tombstone (Qortium only — the keyless delete builder is a Qortium Core
// addition, so it is not advertised on qortalRequest at all).
export const HOME_V2_PUBLISH_EXTRA_ACTIONS = Object.freeze([
  'DELETE_QDN_RESOURCE',
  'PUBLISH_MULTIPLE_QDN_RESOURCES',
] as const)

export type HomeV2PublishExtraAction = (typeof HOME_V2_PUBLISH_EXTRA_ACTIONS)[number]

const PUBLISH_EXTRA_ACTIONS = new Set<string>(HOME_V2_PUBLISH_EXTRA_ACTIONS)

export function isHomeV2PublishExtraAction(action: string): action is HomeV2PublishExtraAction {
  return PUBLISH_EXTRA_ACTIONS.has(action)
}

// Shared between the bridge (which stamps it on the prompt) and the shell
// (which refuses a prompt whose label does not match its action).
export function homeV2PublishExtraOperationLabel(action: HomeV2PublishExtraAction) {
  return action === 'PUBLISH_MULTIPLE_QDN_RESOURCES'
    ? 'Publish multiple QDN resources'
    : 'Delete a QDN resource on-chain'
}

export type HomeV2CoinAmount = {
  // Exact atomic units (1e8 per coin).
  readonly atomic: bigint
  // Canonical eight-decimal display/builder form, e.g. "12.50000000".
  readonly decimal: string
}

/**
 * 1.x amount rule, exactly: a finite non-negative number, or a string that is
 * a canonical non-negative integer or a decimal with one to eight fractional
 * digits. Parsed into exact atomic units without floating point (a number
 * input is stringified first and must satisfy the same grammar).
 */
// Expands a JS number's exponential string form (e.g. "1e-8", "5e-9") to
// plain decimal WITHOUT rounding, so the grammar below can then reject
// over-precision exactly as it does for a string input — never silently
// rounding a monetary value. A non-exponential String() is returned as-is.
function homeV2PlainDecimalString(value: number): string {
  const str = String(value)
  const match = /^(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(str)
  if (!match) return str
  const digits = match[1] + (match[2] ?? '')
  const pointPos = match[1].length + Number(match[3])
  if (pointPos <= 0) return `0.${'0'.repeat(-pointPos)}${digits}`
  if (pointPos >= digits.length) return digits + '0'.repeat(pointPos - digits.length)
  return `${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`
}

export function parseHomeV2CoinAmount(value: unknown, label: string): HomeV2CoinAmount {
  // A number and its string equivalent validate identically: both must be a
  // non-negative amount with at most eight decimals. A number more precise
  // than eight decimals is REFUSED, not rounded — a monetary value must
  // never change silently between the request and what is signed.
  const text = typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? homeV2PlainDecimalString(value)
    : typeof value === 'string' ? value.trim() : null
  const match = text === null ? null : /^(0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/.exec(text)
  if (!match) {
    throw new Error(`${label} must be a non-negative amount with up to 8 decimal places.`)
  }
  const whole = BigInt(match[1])
  const fraction = BigInt((match[2] ?? '').padEnd(8, '0') || '0')
  const atomic = whole * 100_000_000n + fraction
  if (atomic > 0x7fff_ffff_ffff_ffffn) {
    throw new Error(`${label} exceeds the maximum representable amount.`)
  }
  return Object.freeze({ atomic, decimal: `${whole.toString()}.${(match[2] ?? '').padEnd(8, '0')}` })
}

function requiredHomeV2NameField(request: Record<string, unknown>, key: string, label: string) {
  const value = typeof request[key] === 'string' ? request[key].trim() : ''
  if (!value) throw new Error(`${label} is required.`)
  // Referencing an existing name: byte-bounded only; Core validates content.
  if (POLL_TEXT_ENCODER.encode(value).byteLength > 400) {
    throw new Error(`${label} must be at most 400 UTF-8 bytes.`)
  }
  return value
}

// A NEW Qortium name: Core enforces 3-40 UTF-8 bytes and its Unicode
// normalization; the byte bounds are checked here so the refusal is named,
// and normalization stays Core\'s call (NAME_NOT_NORMALIZED can still answer).
function newHomeV2NameValue(value: string, label: string) {
  const byteLength = POLL_TEXT_ENCODER.encode(value).byteLength
  if (byteLength < 3 || byteLength > 40) {
    throw new Error(`${label} must be 3 to 40 UTF-8 bytes.`)
  }
  return value
}

function optionalHomeV2NameData(request: Record<string, unknown>, keys: readonly string[], label: string) {
  for (const key of keys) {
    const raw = request[key]
    if (typeof raw !== 'string') continue
    // 1.x trimmed name data, so a blank-looking value ("   ") reads as
    // empty/unchanged rather than a real on-chain write of whitespace.
    const value = raw.trim()
    if (value !== '') {
      if (POLL_TEXT_ENCODER.encode(value).byteLength > 4_000) {
        throw new Error(`${label} must be at most 4000 UTF-8 bytes.`)
      }
      return value
    }
  }
  return ''
}

// A Qortium base58 address is 25 bytes, which encodes to 33-34 base58 chars;
// bound to a safe range so an oversized value can never overflow a prompt
// row or reach a payment display unbounded. Core validates the checksum.
function isHomeV2AddressShape(value: string) {
  return /^Q[1-9A-HJ-NP-Za-km-z]{20,40}$/.test(value)
}

function optionalHomeV2QortiumAddress(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return undefined
  const address = typeof value === 'string' ? value.trim() : ''
  if (!isHomeV2AddressShape(address)) {
    throw new Error(`${label} must be a Qortium address.`)
  }
  return address
}

export type HomeV2RegisterNameRequest = {
  readonly data: string
  readonly name: string
}

export function normalizeHomeV2RegisterNameRequest(request: Record<string, unknown>): HomeV2RegisterNameRequest {
  request = homeV2FlattenPayloadRequest(request)
  assertHomeV2SignedWriteFeeAndGroup(request, 'name')
  const name = newHomeV2NameValue(requiredHomeV2NameField(request, 'name', 'Name'), 'Name')
  const data = optionalHomeV2NameData(request, ['data', 'nameData'], 'Name data')
  return Object.freeze({ data, name })
}

export type HomeV2UpdateNameRequest = {
  readonly name: string
  // '' means "keep the current name"; '' newData means "keep the current
  // data" (1.x and wire semantics — empty is NOT a clear).
  readonly newData: string
  readonly newName: string
  readonly primary?: boolean
}

export function normalizeHomeV2UpdateNameRequest(request: Record<string, unknown>): HomeV2UpdateNameRequest {
  request = homeV2FlattenPayloadRequest(request)
  assertHomeV2SignedWriteFeeAndGroup(request, 'name')
  const name = requiredHomeV2NameField(request, 'name', 'Name')
  const newNameRaw = typeof request.newName === 'string' ? request.newName.trim() : ''
  const newName = newNameRaw === '' ? '' : newHomeV2NameValue(newNameRaw, 'New name')
  const newData = optionalHomeV2NameData(request, ['newData', 'data', 'nameData'], 'New name data')
  const primaryRaw = typeof request.primary === 'boolean'
    ? request.primary
    : typeof request.isPrimary === 'boolean' ? request.isPrimary : undefined
  return Object.freeze({ name, newData, newName, ...(primaryRaw === undefined ? {} : { primary: primaryRaw }) })
}

export type HomeV2SellNameRequest = {
  readonly amount: HomeV2CoinAmount
  readonly name: string
  readonly recipient?: string
}

// Core: a name price is 0 < amount < 10,000,000,000 coins for a PUBLIC sale;
// a restricted (direct) sale may be zero. MAX is Asset.MAX_QUANTITY.
const HOME_V2_MAX_COIN_ATOMIC = 10_000_000_000n * 100_000_000n

export function normalizeHomeV2SellNameRequest(request: Record<string, unknown>): HomeV2SellNameRequest {
  request = homeV2FlattenPayloadRequest(request)
  assertHomeV2SignedWriteFeeAndGroup(request, 'name')
  const name = requiredHomeV2NameField(request, 'name', 'Name')
  const amount = parseHomeV2CoinAmount(request.amount, 'Name sale amount')
  const recipient = optionalHomeV2QortiumAddress(request.recipient ?? request.recipientAddress, 'Recipient address')
  if (amount.atomic >= HOME_V2_MAX_COIN_ATOMIC) {
    throw new Error('Name sale amount is too large.')
  }
  if (amount.atomic === 0n && recipient === undefined) {
    throw new Error('A public name sale must have a price above zero; a zero price is only valid for a restricted sale.')
  }
  return Object.freeze({ amount, name, ...(recipient === undefined ? {} : { recipient }) })
}

export type HomeV2CancelSellNameRequest = { readonly name: string }

export function normalizeHomeV2CancelSellNameRequest(request: Record<string, unknown>): HomeV2CancelSellNameRequest {
  request = homeV2FlattenPayloadRequest(request)
  assertHomeV2SignedWriteFeeAndGroup(request, 'name')
  return Object.freeze({ name: requiredHomeV2NameField(request, 'name', 'Name') })
}

export type HomeV2BuyNameRequest = {
  // Absent means "the live sale price"; resolved against authoritative name
  // state in the bridge, and an explicit value must match it exactly.
  readonly amount?: HomeV2CoinAmount
  readonly name: string
  // Absent means "the live owner"; same resolution rule.
  readonly seller?: string
}

export function normalizeHomeV2BuyNameRequest(request: Record<string, unknown>): HomeV2BuyNameRequest {
  request = homeV2FlattenPayloadRequest(request)
  assertHomeV2SignedWriteFeeAndGroup(request, 'name')
  const name = requiredHomeV2NameField(request, 'name', 'Name')
  const amount = request.amount === undefined ? undefined : parseHomeV2CoinAmount(request.amount, 'Name purchase amount')
  const seller = optionalHomeV2QortiumAddress(request.seller, 'Seller address')
  return Object.freeze({
    name,
    ...(amount === undefined ? {} : { amount }),
    ...(seller === undefined ? {} : { seller }),
  })
}

/**
 * The subject name as the prompt and the pre-sign revalidation need it,
 * selected from Core\'s GET /names/{name} answer. GET resolves by REDUCED
 * name while the transactions demand the exact stored display name, so the
 * caller must compare `name` here against what it asked for and refuse a
 * mismatch rather than silently substituting the stored spelling.
 */
export function selectHomeV2NameTarget(value: unknown) {
  if (!isHomeV2AppRecord(value) || typeof value.name !== 'string' || typeof value.owner !== 'string') {
    throw new Error('The name lookup answered with an unrecognized shape.')
  }
  // The owner is shown on a PAYMENT prompt ("Paid to"), so its shape is
  // validated here rather than trusting arbitrary node text into the dialog.
  if (!isHomeV2AddressShape(value.owner)) {
    throw new Error('The name lookup returned an invalid owner address.')
  }
  const saleRecipient = value.saleRecipient === undefined || value.saleRecipient === null || value.saleRecipient === ''
    ? null
    : typeof value.saleRecipient === 'string' && isHomeV2AddressShape(value.saleRecipient)
      ? value.saleRecipient
      : (() => { throw new Error('The name lookup returned an invalid sale-recipient address.') })()
  const salePrice = value.salePrice === undefined || value.salePrice === null
    ? null
    : parseHomeV2CoinAmount(value.salePrice, 'Name sale price')
  return Object.freeze({
    isForSale: value.isForSale === true,
    name: value.name,
    owner: value.owner,
    salePrice,
    saleRecipient,
  })
}

export function buildHomeV2AssetReadPath(action: string, request: Record<string, unknown>) {
  if (action === 'GET_ASSET_INFO') return getAssetInfoPath(request)
  if (action === 'GET_ASSET_BALANCES') return getAssetBalancesPath(request)
  if (action === 'GET_ASSET_TRANSFERS') return getAssetTransfersPath(request)
  throw new Error(`${action} is not a supported asset read.`)
}

/**
 * The one address validator behind both OPEN_NEW_TAB and OPEN_CURRENT_TAB.
 *
 * Home 1.x accepted `qdn://`, `home://` and `core://` here. Home 2 uses its
 * own scheme set instead — `qdn://`, `qortal://`, `home://` — because v2
 * addresses are source-chain qualified (see parseAppResourceLocation) and
 * `core://` has no v2 meaning. OPEN_CURRENT_TAB deliberately reuses the v2 set
 * rather than reviving the 1.x one: sharing this function is what guarantees
 * the two open actions can never drift into accepting different schemes.
 */
export function normalizeHomeV2OpenAddress(request: Record<string, unknown>) {
  const value = typeof request.address === 'string'
    ? request.address
    : typeof request.qdnUrl === 'string'
      ? request.qdnUrl
      : ''
  const address = value.trim()
  if (!address) throw new Error('Address is required.')
  if (!/^(qdn|qortal|home):\/\//i.test(address)) {
    throw new Error('Home only accepts qdn://, qortal://, and home:// addresses.')
  }
  if (address.length > MAX_ADDRESS_LENGTH) throw new Error('Address is too long.')
  return address
}

/**
 * Whether an app address names its resource identifier explicitly.
 *
 * A deliberate twin of `identifierWasExplicit` in
 * src/v2/resource-location.ts, which computes exactly this: parse the address
 * as a URL, take the non-empty path segments, drop the first (the app name),
 * and ask whether anything is left. Electron code cannot import from src/, so
 * the rule is restated here rather than re-derived — and the two are pinned
 * against one shared fixture,
 * src/shared-fixtures/app-address-explicit-identifier-vectors.json, so they
 * can never drift apart on what "explicit" means.
 *
 * Returns false for anything that is not a qdn:// or qortal:// APP address:
 * those are not app resources, and the caller refuses them separately.
 */
export function homeV2AppAddressNamesIdentifier(address: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(address.trim())
  } catch {
    return false
  }
  const scheme = parsed.protocol.slice(0, -1).toLowerCase()
  if (scheme !== 'qdn' && scheme !== 'qortal') return false
  if (parsed.hostname.toUpperCase() !== 'APP') return false
  // Query and hash are excluded because `pathname` excludes them, matching the
  // twin: `?identifier=` is NOT an explicit path identifier.
  const segments = parsed.pathname.split('/').filter(Boolean)
  return segments.length > 1
}

/**
 * OPEN_CURRENT_TAB's address rule, enforced in the trusted host.
 *
 * OPEN_NEW_TAB can accept a bare app name, because the shell resolves it and,
 * when it turns out to match more than one published resource, asks the user
 * which they meant. A bridge call has nobody to ask. The shell therefore
 * refuses a bare name for a replacement — but the desktop transport is
 * fire-and-forget, so a refusal made only in the renderer is discarded and the
 * app is told `true` for a replacement that never happened. Requiring the
 * identifier HERE, synchronously, makes the bridge call itself fail with a
 * clear error on both transports.
 *
 * Non-app addresses are refused outright for the same reason: `home://` and
 * friends parse fine but can never replace an app tab (Home's own pages must
 * not be takeable over from inside one), so accepting them here would be the
 * same silent `true`.
 */
export function normalizeHomeV2ReplaceTabAddress(request: Record<string, unknown>) {
  const address = normalizeHomeV2OpenAddress(request)
  if (!/^(qdn|qortal):\/\//i.test(address)) {
    throw new Error(
      'OPEN_CURRENT_TAB can only replace a tab with a qdn:// or qortal:// app resource; use OPEN_NEW_TAB for Home pages.',
    )
  }
  if (!homeV2AppAddressNamesIdentifier(address)) {
    throw new Error(
      'OPEN_CURRENT_TAB needs an explicit resource identifier: a bare app name can match more than one published resource. Use OPEN_NEW_TAB to let the user choose.',
    )
  }
  return address
}

export const HOME_V2_APP_LIMITS = Object.freeze({
  avatarBytes: AVATAR_MAX_BYTES,
  responseBytes: RESPONSE_MAX_BYTES,
})
