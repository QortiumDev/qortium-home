import {
  getAssetBalancesPath,
  getAssetInfoPath,
  getAssetTransfersPath,
} from './qdn-request-values.js'

export type HomeV2AppBridgeProtocol = 'qdnRequest' | 'qortalRequest'
export type HomeV2AppNetwork = 'qortal' | 'qortium'

const RESPONSE_DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const RESPONSE_MAX_BYTES = 5 * 1024 * 1024
const AVATAR_MAX_BYTES = 500 * 1024
const MAX_IDENTITY_ADDRESSES = 500
const MAX_ADDRESS_LENGTH = 2_048

const COMMON_ACTIONS = [
  'FETCH_NODE_API',
  'GET_HOST_INFO',
  'GET_NODE_INFO',
  'GET_NODE_STATUS',
  'IS_USING_PUBLIC_NODE',
  'NOTIFICATION_HAS_PERMISSION',
  'OPEN_NEW_TAB',
  'SHOW_NOTIFICATION',
  'SHOW_ACTIONS',
  'WHICH_UI',
] as const

const QDN_ACTIONS = [
  ...COMMON_ACTIONS,
  'ADD_GROUP_ADMIN',
  'APPROVE_GROUP_JOIN_REQUEST',
  'CANCEL_GROUP_BAN',
  'CANCEL_GROUP_INVITE',
  'FETCH_ACCOUNT_AVATAR',
  'FETCH_GROUP_AVATAR',
  'FETCH_BLOCK',
  'FETCH_BLOCK_RANGE',
  'FETCH_QDN_RESOURCE',
  'FETCH_QORTAL_NODE_API',
  'GROUP_BAN',
  'GROUP_KICK',
  'GET_ACCOUNT_GROUPS',
  'GET_ACCOUNT_GROUP_JOIN_REQUESTS',
  'GET_ACCOUNT_NAMES',
  'GET_ACTIVE_CHATS',
  'GET_ADMIN_GROUP_JOIN_REQUESTS',
  'GET_ASSET_BALANCES',
  'GET_ASSET_INFO',
  'GET_ASSET_TRANSFERS',
  'GET_AT',
  'GET_AT_DATA',
  'GET_CHAT_MESSAGE',
  'GET_CHAT_ATTACHMENT_STREAM_URL',
  'GET_GROUP',
  'GET_GROUP_JOIN_REQUESTS',
  'GET_GROUP_MEMBERS',
  'GET_NAME_DATA',
  'GET_PRIMARY_NAME',
  'GET_PRIVATE_DIRECT_ACTIVE_CHATS',
  'GET_PRIVATE_GROUP_ACTIVE_CHATS',
  'GET_PRIVATE_GROUP_CHAT_STATE',
  'GET_QDN_RESOURCE_METADATA',
  'GET_QDN_RESOURCE_PROPERTIES',
  'GET_QDN_RESOURCE_STATUS',
  'GET_QDN_RESOURCE_STREAM_URL',
  'GET_QDN_RESOURCE_URL',
  'GET_SELECTED_ACCOUNT',
  'INVITE_TO_GROUP',
  'JOIN_GROUP',
  'LIST_ATS',
  'LIST_GROUPS',
  'LIST_QDN_RESOURCES',
  'LEAVE_GROUP',
  'REMOVE_GROUP_ADMIN',
  'OPEN_QDN_RESOURCE_VIEWER',
  'OPEN_CHAT_ATTACHMENT_VIEWER',
  'SAVE_QDN_RESOURCE',
  'SAVE_CHAT_ATTACHMENT',
  'SELECT_QDN_PUBLISH_SOURCE',
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
  'REQUEST_PRIVATE_GROUP_CHAT_KEY',
  'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS',
  'ROTATE_PRIVATE_GROUP_CHAT_KEY',
  'SEND_PRIVATE_GROUP_CHAT_DELETE',
  'SEND_PRIVATE_GROUP_CHAT_EDIT',
  'SEND_PRIVATE_GROUP_CHAT_MESSAGE',
  'SEND_PRIVATE_GROUP_CHAT_REACTION',
  'PUBLISH_QDN_RESOURCE',
  'PUBLISH_CHAT_ATTACHMENT',
  'UNLOCK_SELECTED_ACCOUNT',
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
  'GET_ACTIVE_CHATS',
  'GET_ADMIN_GROUP_JOIN_REQUESTS',
  'GET_AT',
  'GET_AT_DATA',
  'GET_BALANCE',
  'GET_CHAT_MESSAGE',
  'GET_CHAT_ATTACHMENT_STREAM_URL',
  'GET_DAY_SUMMARY',
  'GET_GROUP',
  'GET_GROUP_JOIN_REQUESTS',
  'GET_GROUP_MEMBERS',
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
  'GET_USER_ACCOUNT',
  'KICK_FROM_GROUP',
  'INVITE_TO_GROUP',
  'JOIN_GROUP',
  'LIST_ATS',
  'LIST_GROUPS',
  'LIST_QDN_RESOURCES',
  'LEAVE_GROUP',
  'REMOVE_GROUP_ADMIN',
  'OPEN_QDN_RESOURCE_VIEWER',
  'OPEN_CHAT_ATTACHMENT_VIEWER',
  'SAVE_QDN_RESOURCE',
  'SAVE_CHAT_ATTACHMENT',
  'SELECT_QDN_PUBLISH_SOURCE',
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
  'PUBLISH_CHAT_ATTACHMENT',
] as const
// SEARCH_GROUPS (Qortium-only): /groups/search does not exist on Qortal
// (verified absent from both the Qortal master 6.1.5 and develop checkouts'
// GroupsResource.java) — it is a Qortium Core addition. Home therefore
// advertises it only on qdnRequest, the same asymmetric pattern already used
// for GET_DAY_SUMMARY/GET_PRICE (qortalRequest-only) and
// RESOLVE_IDENTITIES/FETCH_QORTAL_NODE_API
// (qdnRequest-only).

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
  '/polls',
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

const CHAIN_READ_ACTIONS = new Set([
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
  'GET_GROUP_JOIN_REQUESTS',
  'GET_GROUP_MEMBERS',
  'GET_PRICE',
  'LIST_ATS',
  'LIST_GROUPS',
  'SEARCH_CHAT_MESSAGES',
  'SEARCH_GROUPS',
  'SEARCH_NAMES',
  'SEARCH_TRANSACTIONS',
])

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

export function buildHomeV2AssetReadPath(action: string, request: Record<string, unknown>) {
  if (action === 'GET_ASSET_INFO') return getAssetInfoPath(request)
  if (action === 'GET_ASSET_BALANCES') return getAssetBalancesPath(request)
  if (action === 'GET_ASSET_TRANSFERS') return getAssetTransfersPath(request)
  throw new Error(`${action} is not a supported asset read.`)
}

export function normalizeHomeV2OpenAddress(request: Record<string, unknown>) {
  const value = typeof request.address === 'string'
    ? request.address
    : typeof request.qdnUrl === 'string'
      ? request.qdnUrl
      : ''
  const address = value.trim()
  if (!address) throw new Error('Address is required.')
  if (!/^(qdn|qortal|home):\/\//i.test(address)) {
    throw new Error('OPEN_NEW_TAB only accepts qdn://, qortal://, and home:// addresses.')
  }
  if (address.length > MAX_ADDRESS_LENGTH) throw new Error('Address is too long.')
  return address
}

export const HOME_V2_APP_LIMITS = Object.freeze({
  avatarBytes: AVATAR_MAX_BYTES,
  responseBytes: RESPONSE_MAX_BYTES,
})
