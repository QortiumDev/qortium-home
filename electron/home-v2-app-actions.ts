export type HomeV2AppBridgeProtocol = 'qdnRequest' | 'qortalRequest'
export type HomeV2AppNetwork = 'qortal' | 'qortium'

const RESPONSE_MAX_BYTES = 2 * 1024 * 1024
const AVATAR_MAX_BYTES = 500 * 1024
const MAX_IDENTITY_ADDRESSES = 500
const MAX_ADDRESS_LENGTH = 2_048

const COMMON_ACTIONS = [
  'FETCH_NODE_API',
  'GET_HOST_INFO',
  'GET_NODE_INFO',
  'GET_NODE_STATUS',
  'IS_USING_PUBLIC_NODE',
  'OPEN_NEW_TAB',
  'SHOW_ACTIONS',
  'WHICH_UI',
] as const

const QDN_ACTIONS = [
  ...COMMON_ACTIONS,
  'FETCH_ACCOUNT_AVATAR',
  'FETCH_QDN_RESOURCE',
  'FETCH_QORTAL_NODE_API',
  'GET_ACCOUNT_NAMES',
  'GET_NAME_DATA',
  'GET_QDN_RESOURCE_METADATA',
  'GET_QDN_RESOURCE_PROPERTIES',
  'GET_QDN_RESOURCE_STATUS',
  'GET_QDN_RESOURCE_URL',
  'GET_SELECTED_ACCOUNT',
  'LIST_QDN_RESOURCES',
  'RESOLVE_IDENTITIES',
  'SEARCH_QDN_RESOURCES',
] as const

const QORTAL_ACTIONS = [
  ...COMMON_ACTIONS,
  'FETCH_QDN_RESOURCE',
  'GET_ACCOUNT_DATA',
  'GET_ACCOUNT_NAMES',
  'GET_BALANCE',
  'GET_NAME_DATA',
  'GET_PRIMARY_NAME',
  'GET_QDN_RESOURCE_METADATA',
  'GET_QDN_RESOURCE_PROPERTIES',
  'GET_QDN_RESOURCE_STATUS',
  'GET_QDN_RESOURCE_URL',
  'GET_USER_ACCOUNT',
  'LIST_QDN_RESOURCES',
  'SEARCH_QDN_RESOURCES',
] as const

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
  if (name === '.' || name === '..' || identifier === '.' || identifier === '..') {
    throw new Error('QDN resource path segments cannot be dot or dot-dot.')
  }
  return { identifier, name, service }
}

function assertSafeResourceFilePath(value: string) {
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
  if (value === undefined || value === null || value === '') return RESPONSE_MAX_BYTES
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > RESPONSE_MAX_BYTES) {
    throw new Error('maxBytes must be between 1 byte and 2 MiB.')
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
    if (resourcePath) query.set('filepath', assertSafeResourceFilePath(resourcePath))
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
  const pathOnly = assertSafeResourceFilePath(unsafePathOnly)
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
