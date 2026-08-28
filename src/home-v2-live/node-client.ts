import type {
  HomeV2AccountCatalogue,
  NetworkId,
  NodeConnectionMode,
  NodeSummary,
  VisibleAppIconReadRequest,
  VisibleAvatarReadRequest,
  VisibleAvatarReadResult,
} from '../v2/contracts'
import packageJson from '../../package.json'
import { parseHomeV2AccountCatalogueStore } from './account-catalogue'
import {
  buildHomeV2AssetReadPath,
  buildHomeV2ChainReadPath,
  buildHomeV2NamePath,
  buildHomeV2RatingRead,
  buildHomeV2RatingReadResult,
  buildHomeV2ResourcePath,
  buildHomeV2ResourceRenderPath,
  resolveHomeV2AppAlias,
  getHomeV2AppActions,
  getHomeV2AppNetwork,
  homeV2ChainReadNeedsSelectedAddress,
  homeV2RatingReadNeedsSelectedAddress,
  isHomeV2AppRecord,
  isHomeV2ChainReadAction,
  isHomeV2NameWriteAction,
  isHomeV2PollWriteAction,
  isHomeV2RatingReadAction,
  normalizeHomeV2Address,
  normalizeHomeV2AppAction,
  normalizeHomeV2IdentityAddresses,
  normalizeHomeV2OpenAddress,
  normalizeHomeV2ReadMethod,
  normalizeHomeV2ReadPath,
  normalizeHomeV2ReplaceTabAddress,
  normalizeHomeV2ResponseMaxBytes,
  withHomeV2SelectedAddress,
} from '../../electron/home-v2-app-actions'
import { isHomeV2GroupMutationAction } from '../../electron/home-v2-group-mutation-actions'
import { isHomeV2RatingAction } from '../../electron/home-v2-rating-actions'
import { isHomeV2PaymentAction } from '../../electron/home-v2-payment-actions'
import { isHomeV2PublishExtraAction } from '../../electron/home-v2-app-actions'
import {
  isHomeV2CrosschainReadAction,
  projectHomeV2CrosschainReadResult,
} from '../../electron/home-v2-crosschain-actions'
import {
  buildHomeV2AccountBalancePath,
  buildHomeV2AccountDataPath,
  buildHomeV2UserWalletResult,
  homeV2ForeignWalletUnavailableError,
  isHomeV2NativeWalletRequest,
  resolveHomeV2AccountReadAddress,
} from '../../electron/home-v2-wallet-actions'
import {
  HomeV2MarketPriceCache,
  HOME_V2_MARKET_PRICE_MAX_BYTES,
  HOME_V2_MARKET_PRICE_TIMEOUT_MS,
  normalizeHomeV2MarketPriceRequest,
} from '../../electron/home-v2-market-prices'
import {
  buildHomeV2SelfRewardSharesPath,
  createHomeV2MintingAccountsResult,
  deriveHomeV2MintingStatus,
  isHomeV2MintingReadAction,
} from '../../electron/home-v2-minting'
import {
  getQdnResourceStreamRequest,
  getQdnResourceViewerRequest,
} from '../../electron/qdn-resource-viewer-contract'
import type { QdnAppRequest } from '../../electron/qdn-request-values'
import {
  fetchHomeV2AvatarAction,
  type HomeV2AvatarAction,
} from '../../electron/home-v2-avatar-actions'
import {
  buildHomeV2IdentityReadPath,
  type HomeV2IdentityReadKind,
  type HomeV2IdentityReadRequest,
} from '../../electron/home-v2-identity-read'
import {
  buildHomeV2AppIconPath,
  getHomeV2AppIconContentType,
  HOME_V2_APP_ICON_MAX_BYTES,
} from '../../electron/home-v2-app-icon'
import {
  QDN_BROWSER_ARCHIVE_SERVICES,
  isQdnBrowserArchiveService,
  type QdnBrowserArchiveService,
} from '../../electron/qdn-browser-archive-services'
import { getAvatarDescriptorFromHeaders } from '../../electron/qdn-group-avatar-input'
import {
  createHomeV2BridgeError,
  getHomeV2AppHostInfo,
  getHomeV2AppRouteDescriptor,
  getHomeV2AvailableAppActions,
  getHomeV2ContextualAppActions,
  homeV2AndroidActionRefusal,
  HOME_V2_ROUTE_INDEPENDENT_ACTIONS,
} from '../../electron/home-v2-app-runtime'
import { mergeHomeV2ShellGlobalState } from '../../electron/home-v2-window-startup'
import {
  evaluateHomeV2AdminTrust,
  homeV2AdminTrustMessage,
} from '../../electron/home-v2-admin-trust'
import {
  buildHomeV2ListPath,
  buildHomeV2ListWriteBody,
  isHomeV2ListAction,
  isHomeV2ListWriteAction,
  normalizeHomeV2ListItems,
  normalizeHomeV2ListName,
} from '../../electron/home-v2-app-actions'

const LIST_REQUEST_TIMEOUT_MS = 15_000

export interface HomeV2NodeClient {
  getSnapshot(): Promise<unknown>
  getShellState(): Promise<unknown>
  saveShellState(value: unknown): Promise<void>
  /** Saves everything except the tab strip; used by detached windows. */
  saveShellGlobalState(value: unknown): Promise<void>
  requestApp(
    protocol: HomeV2AppBridgeProtocol,
    request: unknown,
    context?: HomeV2AppRequestContext,
  ): Promise<unknown>
  listAccounts(): Promise<HomeV2AccountCatalogue>
  listAppResources(
    network: NetworkId,
    name: string,
    // R4-4: the browser-archive service the address named. Optional so
    // existing callers and stubs keep the historical APP-only behaviour.
    service?: QdnBrowserArchiveService,
  ): Promise<readonly HomeV2AppResourceCandidate[]>
  readAvatar(
    network: NetworkId,
    request: VisibleAvatarReadRequest,
  ): Promise<VisibleAvatarReadResult>
  readAppIcon(
    network: NetworkId,
    request: VisibleAppIconReadRequest,
  ): Promise<VisibleAvatarReadResult>
  readIdentity(
    network: NetworkId,
    request: HomeV2IdentityReadRequest,
  ): Promise<HomeV2IdentityReadResponse>
  setMode(network: NetworkId, mode: NodeConnectionMode): Promise<unknown>
  setCustomUrl(
    network: NetworkId,
    customUrl: string,
    apiKey?: string,
  ): Promise<unknown>
  checkCoreUpdate?(): Promise<HomeV2CoreOnChainUpdateStatus>
  installCoreUpdate?(): Promise<HomeV2CoreOnChainUpdateStatus>
  /**
   * Node ADMINISTRATION, kept inside the client for the same reason desktop
   * keeps it in the main process: the API key must never reach the React
   * layer. The renderer learns only whether the node is administrable (and
   * which origin, for the approval prompt), then asks the client to act.
   *
   * `revision` binds an approval to one credential: the write re-resolves
   * trust and refuses if the origin or key moved while the prompt was open.
   */
  adminTrust?(): Promise<{
    readonly origin: string
    readonly reason?: string
    readonly revision: string
    readonly trusted: boolean
  }>
  listRead?(action: string, request: Record<string, unknown>): Promise<unknown>
  listWrite?(
    action: string,
    request: Record<string, unknown>,
    approvedRevision: string,
  ): Promise<unknown>
}

export interface HomeV2CoreOnChainUpdateStatus {
  readonly autoUpdateMode?: string
  readonly binaryResourcePercentLoaded?: number | null
  readonly binaryResourceStatus?: string | null
  readonly commitHash?: string | null
  readonly currentBuildTimestamp?: number
  readonly downloadStarted?: boolean
  readonly installStarted?: boolean
  readonly installing?: boolean
  readonly message?: string | null
  readonly nextRetryTimestamp?: number | null
  readonly status?: string | null
  readonly updateAvailable?: boolean
}

export interface HomeV2AppResourceCandidate {
  readonly identifier: string | null
  readonly name: string
  // R4-4: the candidate's REAL service. The caller rebuilds the qdn:// address
  // from this, so a WEBSITE or GAME match can never be relabelled as an APP.
  readonly service: QdnBrowserArchiveService
}

export type HomeV2AppBridgeProtocol = 'qdnRequest' | 'qortalRequest'

export interface HomeV2AppRequestContext {
  readonly resourceLocation: string
  readonly selectedAccountId: string | null
  readonly tabId: string
}

export type { HomeV2IdentityReadKind, HomeV2IdentityReadRequest }

export interface HomeV2IdentityReadResponse {
  readonly data: unknown
  readonly status: number
}

interface PortableNodeSettings {
  apiKey: string
  customUrl: string
  lastEnabledMode: Exclude<NodeConnectionMode, 'disabled'>
  mode: NodeConnectionMode
}

export interface PortableNodeClientDependencies {
  getPreference(key: string): Promise<string | null>
  getSecret(key: string): Promise<string | null>
  removeSecret(key: string): Promise<void>
  setPreference(key: string, value: string): Promise<void>
  setSecret(key: string, value: string): Promise<void>
  requestJson(
    url: string,
    // DELETE carries a body for REMOVE_FROM_LIST — Core takes the item batch
    // as a bodied DELETE, exactly as it does on desktop.
    method?: 'DELETE' | 'GET' | 'HEAD' | 'POST',
    timeoutMs?: number,
    headers?: Readonly<Record<string, string>>,
    disableRedirects?: boolean,
    body?: string,
  ): Promise<{
    data: unknown
    headers?: Readonly<Record<string, string>>
    latencyMs: number
    ok: boolean
    status: number
  }>
  requestBinary(url: string, timeoutMs?: number): Promise<{
    data: unknown
    headers: Readonly<Record<string, string>>
    status: number
  }>
  saveBinary(request: {
    bytes: Uint8Array
    fileName: string
    mimeType: string
  }): Promise<{ canceled: boolean }>
  now(): number
}

const PUBLIC_NODE_URLS = {
  qortal: ['https://ext-node.qortal.link', 'https://api.qortal.org'],
  qortium: ['https://node1.qortium.app', 'https://node2.qortium.app'],
} as const

const PUBLIC_READ_PATH =
  '/arbitrary/resources/search?mode=ALL&limit=1&includestatus=false&includemetadata=false'
const RECENT_READABLE_NODE_TTL_MS = 30_000
const SETTINGS_PREFIX = 'home-v2-live-node:'
const AVATAR_MAX_BYTES = 500 * 1024
const WALLET_STORE_KEY = 'qortium-home-wallet-store'
const SHELL_STATE_KEY = 'home-v2-live-shell-state'
const APP_RESOURCE_LIMIT = 50
const APP_READ_TIMEOUT_MS = 30_000
const CORE_UPDATE_TIMEOUT_MS = 30_000
const CORE_UPDATE_STATUS_MAX_BYTES = 128 * 1024
const API_KEY_MAX_LENGTH = 512
const QORTIUM_CORE_API_KEY_SECRET = 'home-v2-qortium-node-api-key-v1'
const RESOURCE_SAVE_MAX_BYTES = 100 * 1024 * 1024
// The Android twin of the desktop bridge's price cache. GET_MARKET_PRICES is
// the only app action on either host that leaves the Qortal/Qortium node
// network; the TTL cache is what bounds how often it does, no matter how often
// apps ask. See electron/home-v2-market-prices.ts for the full posture note.
const androidMarketPrices = new HomeV2MarketPriceCache()

function sanitizePortableResourceFilename(value: unknown, fallback: string) {
  const requested = typeof value === 'string' ? value.trim() : ''
  const leaf = (requested || fallback).split(/[\\/]/).pop() ?? fallback
  const sanitized = leaf
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 180)
  return sanitized || 'qdn-resource'
}

function normalizedAppResourceName(value: string) {
  const name = value.trim()
  if (!name || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('App resource names must contain 1 to 128 visible characters.')
  }
  return name
}

// Renderer twin of electron/home-v2-app-resource-discovery.ts — the two MUST
// change in lockstep or desktop and Android resolve the same app name
// differently. See that module for why the search stays scoped to ONE service
// instead of fanning out across the browser-archive set.
export function buildHomeV2AppResourceSearchPath(
  value: string,
  service: QdnBrowserArchiveService = 'APP',
) {
  const query = new URLSearchParams({
    service,
    name: normalizedAppResourceName(value),
    exactmatchnames: 'true',
    mode: 'ALL',
    includestatus: 'false',
    includemetadata: 'false',
    limit: String(APP_RESOURCE_LIMIT),
  })
  return `/arbitrary/resources/search?${query.toString()}`
}

export function parseHomeV2AppResourceCandidates(
  value: unknown,
  requestedName: string,
): readonly HomeV2AppResourceCandidate[] {
  const name = normalizedAppResourceName(requestedName)
  if (!Array.isArray(value)) {
    throw new Error('The node returned an invalid app resource list.')
  }
  const candidates = new Map<string, HomeV2AppResourceCandidate>()
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const candidateName = stringField(entry, 'name')
    const service = stringField(entry, 'service')?.toUpperCase()
    if (
      !candidateName ||
      candidateName.toLowerCase() !== name.toLowerCase() ||
      !service ||
      // R4-4: accept the whole browser-archive set, not just APP. A
      // service-scoped search should only ever return one of them, but the
      // node is not trusted to honour that, so the filter is kept.
      !isQdnBrowserArchiveService(service)
    ) {
      continue
    }
    const rawIdentifier = stringField(entry, 'identifier')
    const identifier =
      !rawIdentifier || rawIdentifier.toLowerCase() === 'default'
        ? null
        : rawIdentifier
    // The dedupe key includes the service: an APP and a WEBSITE published
    // under the same name with the same identifier are two DIFFERENT
    // resources, and keying on the identifier alone silently dropped one.
    const key = `${service}:${identifier?.toLowerCase() ?? 'default'}`
    if (!candidates.has(key)) {
      candidates.set(key, { identifier, name: candidateName, service })
    }
  }
  // Deterministic order: browser-archive service order first (APP, then
  // WEBSITE, then GAME — so an exact-name APP match always wins a tie), then
  // the default identifier, then identifiers alphabetically.
  return Object.freeze(
    [...candidates.values()].sort((left, right) => {
      if (left.service !== right.service) {
        return (
          QDN_BROWSER_ARCHIVE_SERVICES.indexOf(left.service) -
          QDN_BROWSER_ARCHIVE_SERVICES.indexOf(right.service)
        )
      }
      if (left.identifier === null) return -1
      if (right.identifier === null) return 1
      return left.identifier.localeCompare(right.identifier)
    }),
  )
}

export function normalizeHomeV2AvatarReadResult(
  request: VisibleAvatarReadRequest,
  result: VisibleAvatarReadResult,
): VisibleAvatarReadResult {
  return result
}

function normalizedAvatarPointer(pointer: VisibleAvatarReadRequest['pointer']) {
  const service = pointer.service.trim()
  const name = pointer.name.trim()
  const identifier = pointer.identifier.trim()
  if (!service || !name || !identifier || name.length > 128) {
    throw new Error('Avatar pointer metadata is invalid.')
  }
  return { ...pointer, identifier, name, service }
}

export function buildHomeV2AvatarPath(
  network: NetworkId,
  request: VisibleAvatarReadRequest,
) {
  const address = request.address.trim()
  const pointer = normalizedAvatarPointer(request.pointer)
  if (!/^Q[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
    throw new Error('Avatar address is invalid.')
  }
  if (
    network === 'qortium' &&
    pointer.source === 'account-pointer'
  ) {
    return `/addresses/${encodeURIComponent(address)}/avatar`
  }
  const expectedIdentifier = network === 'qortal' ? 'qortal_avatar' : 'avatar'
  if (
    pointer.source !== 'legacy-name' ||
    pointer.service !== 'THUMBNAIL' ||
    pointer.identifier !== expectedIdentifier
  ) {
    throw new Error('Avatar pointer does not match the selected network.')
  }
  return `/arbitrary/THUMBNAIL/${encodeURIComponent(pointer.name)}/${expectedIdentifier}?async=true`
}

function headerValue(headers: Readonly<Record<string, string>>, name: string) {
  const expected = name.toLowerCase()
  return Object.entries(headers).find(([key]) => key.toLowerCase() === expected)?.[1]
}

export function decodePortableBase64(value: string) {
  const binary = globalThis.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

export function getHomeV2AvatarContentType(bytes: Uint8Array) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  if (startsWith(bytes, [0x42, 0x4d])) return 'image/bmp'
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp'
  }
  return null
}

function retryAfterSeconds(value: string | undefined) {
  if (!value) return null
  if (/^\d+$/.test(value.trim())) return Number(value.trim())
  const retryAt = Date.parse(value)
  return Number.isFinite(retryAt)
    ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))
    : null
}

export function parseHomeV2AvatarResponse(response: {
  data: unknown
  headers: Readonly<Record<string, string>>
  status: number
}): VisibleAvatarReadResult {
  if (response.status === 202) {
    return {
      retryAfterSeconds: retryAfterSeconds(headerValue(response.headers, 'retry-after')),
      status: 'pending',
    }
  }
  if (response.status === 404) return { status: 'missing' }
  if (response.status < 200 || response.status >= 300) {
    return { message: `Avatar request returned HTTP ${response.status}.`, status: 'unavailable' }
  }
  if (typeof response.data !== 'string') {
    return { message: 'Avatar response was not binary data.', status: 'unavailable' }
  }
  const declaredLength = Number(headerValue(response.headers, 'content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > AVATAR_MAX_BYTES) {
    return { message: 'Avatar exceeded the 500 KiB limit.', status: 'unavailable' }
  }
  let bytes: Uint8Array
  try {
    bytes = decodePortableBase64(response.data)
  } catch {
    return { message: 'Avatar response was not valid base64.', status: 'unavailable' }
  }
  if (bytes.byteLength > AVATAR_MAX_BYTES) {
    return { message: 'Avatar exceeded the 500 KiB limit.', status: 'unavailable' }
  }
  const contentType = getHomeV2AvatarContentType(bytes)
  if (!contentType) {
    return { message: 'Avatar was not a supported image.', status: 'unavailable' }
  }
  return {
    body: response.data,
    contentLength: bytes.byteLength,
    contentType,
    status: 'ready',
  }
}

export function parseHomeV2AppIconResponse(response: {
  data: unknown
  headers: Readonly<Record<string, string>>
  status: number
}): VisibleAvatarReadResult {
  if (response.status === 202) {
    return {
      retryAfterSeconds: retryAfterSeconds(headerValue(response.headers, 'retry-after')),
      status: 'pending',
    }
  }
  if (response.status === 404) return { status: 'missing' }
  if (response.status < 200 || response.status >= 300) {
    return { message: `App icon request returned HTTP ${response.status}.`, status: 'unavailable' }
  }
  if (typeof response.data !== 'string') {
    return { message: 'App icon response was not binary data.', status: 'unavailable' }
  }
  const declaredLength = Number(headerValue(response.headers, 'content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > HOME_V2_APP_ICON_MAX_BYTES) {
    return { message: 'App icon exceeded the 256 KiB limit.', status: 'unavailable' }
  }
  let bytes: Uint8Array
  try {
    bytes = decodePortableBase64(response.data)
  } catch {
    return { message: 'App icon response was not valid base64.', status: 'unavailable' }
  }
  if (bytes.byteLength > HOME_V2_APP_ICON_MAX_BYTES) {
    return { message: 'App icon exceeded the 256 KiB limit.', status: 'unavailable' }
  }
  const contentType = getHomeV2AppIconContentType(bytes)
  if (!contentType) return { status: 'missing' }
  return {
    body: response.data,
    contentLength: bytes.byteLength,
    contentType,
    status: 'ready',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function numberField(value: unknown, key: string) {
  if (!isRecord(value)) return null
  const field = value[key]
  return typeof field === 'number' && Number.isFinite(field) ? field : null
}

function stringField(value: unknown, key: string) {
  if (!isRecord(value)) return null
  const field = value[key]
  return typeof field === 'string' && field.trim() ? field.trim() : null
}

function isLoopback(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    normalized.startsWith('127.')
  )
}

export function normalizePortableNodeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Enter a custom node URL.')
  const explicitScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
  let url: URL
  try {
    url = new URL(explicitScheme ? trimmed : `https://${trimmed}`)
  } catch {
    throw new Error('Enter a valid node URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The node URL must use HTTPS or HTTP.')
  }
  if (url.username || url.password) {
    throw new Error('The node URL cannot contain a username or password.')
  }
  if (url.protocol === 'http:' && !isLoopback(url.hostname)) {
    throw new Error('Remote custom nodes must use HTTPS.')
  }
  return url.origin
}

function isSynced(network: NetworkId, status: unknown) {
  const syncPhase = stringField(status, 'syncPhase')?.toUpperCase() ?? ''
  const remaining = numberField(status, 'syncBlocksRemaining')
  const synchronizing = isRecord(status) && status.isSynchronizing === true
  const common =
    (numberField(status, 'height') ?? 0) > 0 &&
    numberField(status, 'syncPercent') === 100 &&
    !synchronizing &&
    (!syncPhase || syncPhase === 'SYNCED')
  return network === 'qortal'
    ? common && (remaining === null || remaining === 0)
    : common && syncPhase === 'SYNCED' && remaining === 0
}

function settingsKey(network: NetworkId) {
  return `${SETTINGS_PREFIX}${network}`
}

function normalizePortableNodeApiKey(value: unknown) {
  if (typeof value !== 'string') return ''
  const apiKey = value.trim()
  if (apiKey.length > API_KEY_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(apiKey)) {
    throw new Error('The node API key is invalid.')
  }
  return apiKey
}

function defaultPortableSettings(network: NetworkId): PortableNodeSettings {
  return {
    apiKey: '',
    customUrl: '',
    lastEnabledMode: 'public',
    mode: network === 'qortium' ? 'public' : 'disabled',
  }
}

function parseSettings(
  value: string | null,
  network: NetworkId,
): PortableNodeSettings {
  if (!value) return defaultPortableSettings(network)
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) throw new Error()
    const mode = parsed.mode
    const customUrl =
      typeof parsed.customUrl === 'string' && parsed.customUrl
        ? normalizePortableNodeUrl(parsed.customUrl)
        : ''
    if (
      mode === 'disabled' ||
      mode === 'local' ||
      mode === 'public' ||
      mode === 'custom'
    ) {
      const rawLastEnabledMode = parsed.lastEnabledMode
      const storedLastEnabledMode =
        rawLastEnabledMode === 'public' ||
        (rawLastEnabledMode === 'custom' && customUrl)
          ? rawLastEnabledMode
          : 'public'
      return {
        apiKey: '',
        customUrl,
        lastEnabledMode: mode === 'disabled' ? storedLastEnabledMode :
          mode === 'local' ? 'public' : mode,
        mode,
      }
    }
  } catch {
    // Invalid portable preferences fall back without mutating their store.
  }
  return defaultPortableSettings(network)
}

export function parseHomeV2CoreOnChainUpdateStatus(
  value: unknown,
): HomeV2CoreOnChainUpdateStatus {
  let parsed = value
  if (typeof parsed === 'string') {
    if (new TextEncoder().encode(parsed).byteLength > CORE_UPDATE_STATUS_MAX_BYTES) {
      throw new Error('The Core update response was too large.')
    }
    try {
      parsed = parsed.trim() ? JSON.parse(parsed) as unknown : {}
    } catch {
      throw new Error('The Core update response was invalid.')
    }
  }
  if (!isRecord(parsed)) throw new Error('The Core update response was invalid.')
  let encoded: string
  try {
    encoded = JSON.stringify(parsed)
  } catch {
    throw new Error('The Core update response was invalid.')
  }
  if (new TextEncoder().encode(encoded).byteLength > CORE_UPDATE_STATUS_MAX_BYTES) {
    throw new Error('The Core update response was too large.')
  }
  const result: HomeV2CoreOnChainUpdateStatus = {}
  const copyBoolean = (key: 'downloadStarted' | 'installStarted' | 'installing' | 'updateAvailable') => {
    if (parsed[key] === undefined) return
    if (typeof parsed[key] !== 'boolean') {
      throw new Error('The Core update response was invalid.')
    }
    ;(result as Record<string, unknown>)[key] = parsed[key]
  }
  const copyString = (
    key: 'autoUpdateMode' | 'binaryResourceStatus' | 'commitHash' | 'message' | 'status',
    maxLength: number,
    nullable = true,
  ) => {
    const field = parsed[key]
    if (field === undefined) return
    if (field === null && nullable) {
      ;(result as Record<string, unknown>)[key] = null
      return
    }
    if (typeof field !== 'string' || field.length > maxLength) {
      throw new Error('The Core update response was invalid.')
    }
    ;(result as Record<string, unknown>)[key] = field
  }
  const copyNumber = (
    key: 'binaryResourcePercentLoaded' | 'nextRetryTimestamp',
    minimum: number,
    maximum = Number.MAX_SAFE_INTEGER,
  ) => {
    const field = parsed[key]
    if (field === undefined) return
    if (field === null) {
      ;(result as Record<string, unknown>)[key] = null
      return
    }
    if (
      typeof field !== 'number' ||
      !Number.isFinite(field) ||
      field < minimum ||
      field > maximum
    ) throw new Error('The Core update response was invalid.')
    ;(result as Record<string, unknown>)[key] = field
  }
  copyBoolean('downloadStarted')
  copyBoolean('installStarted')
  copyBoolean('installing')
  copyBoolean('updateAvailable')
  if (typeof result.updateAvailable !== 'boolean') {
    throw new Error('The Core update response was invalid.')
  }
  copyString('autoUpdateMode', 64, false)
  copyString('binaryResourceStatus', 128)
  copyString('commitHash', 256)
  copyString('message', 2_048)
  copyString('status', 128)
  copyNumber('binaryResourcePercentLoaded', 0, 100)
  copyNumber('nextRetryTimestamp', 0)
  const currentBuildTimestamp = parsed.currentBuildTimestamp
  if (currentBuildTimestamp !== undefined) {
    if (
      typeof currentBuildTimestamp !== 'number' ||
      !Number.isFinite(currentBuildTimestamp) ||
      currentBuildTimestamp < 0
    ) throw new Error('The Core update response was invalid.')
    ;(result as Record<string, unknown>).currentBuildTimestamp = currentBuildTimestamp
  }
  return Object.freeze(result)
}

function endpointHost(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function emptySummary(
  network: NetworkId,
  settings: PortableNodeSettings,
  now: number,
  error: string | null,
): NodeSummary {
  const disabled = settings.mode === 'disabled'
  return {
    ref: `home-v2:node:${network}` as NodeSummary['ref'],
    network,
    label: disabled ? 'Disabled node' : `${settings.mode[0].toUpperCase()}${settings.mode.slice(1)} node`,
    lastEnabledMode: settings.lastEnabledMode,
    mode: settings.mode,
    state: 'offline',
    statusText: disabled ? 'Disabled' : settings.mode === 'local' ? 'Not available' : 'Unavailable',
    isTrusted: settings.mode === 'local',
    customAuthenticated:
      network === 'qortium' && settings.mode === 'custom' && !!settings.apiKey,
    customConfigured: !!settings.customUrl,
    customUrl: settings.customUrl || null,
    localCoreState: 'unsupported',
    localCoreStatusText: 'Local Core is not available on Android',
    nodeApiUrl: null,
    height: null,
    peerCount: null,
    syncPercent: null,
    syncPhase: null,
    lastCheckedAt: now,
    error,
    capabilities: { admin: false, read: false, write: false },
  }
}

interface ProbeResult {
  latencyMs: number
  nodeApiUrl: string
  status: unknown
}

export function createPortableNodeClient(
  dependencies: PortableNodeClientDependencies,
): HomeV2NodeClient {
  const stickyPublicUrls: Partial<Record<NetworkId, string>> = {}
  const recentReadableNodes: Partial<
    Record<NetworkId, { nodeApiUrl: string; status: unknown; verifiedAt: number }>
  > = {}
  let coreUpdateInstallInFlight: Promise<HomeV2CoreOnChainUpdateStatus> | null = null

  async function readSettings(network: NetworkId) {
    const settings = parseSettings(
      await dependencies.getPreference(settingsKey(network)),
      network,
    )
    if (network !== 'qortium' || !settings.customUrl) return settings
    const protectedValue = await dependencies.getSecret(QORTIUM_CORE_API_KEY_SECRET)
    if (!protectedValue) return settings
    try {
      const parsed: unknown = JSON.parse(protectedValue)
      if (
        !isRecord(parsed) ||
        parsed.version !== 1 ||
        parsed.nodeApiUrl !== settings.customUrl
      ) return settings
      return { ...settings, apiKey: normalizePortableNodeApiKey(parsed.apiKey) }
    } catch {
      return settings
    }
  }

  async function writeSettings(network: NetworkId, settings: PortableNodeSettings) {
    if (network === 'qortium') {
      // Remove first so an interrupted host/key change fails closed. The
      // protected record is bound to its origin and is never put in Preferences.
      await dependencies.removeSecret(QORTIUM_CORE_API_KEY_SECRET)
    }
    await dependencies.setPreference(settingsKey(network), JSON.stringify({
      customUrl: settings.customUrl,
      lastEnabledMode: settings.lastEnabledMode,
      mode: settings.mode,
    }))
    if (network === 'qortium' && settings.apiKey && settings.customUrl) {
      await dependencies.setSecret(QORTIUM_CORE_API_KEY_SECRET, JSON.stringify({
        apiKey: settings.apiKey,
        nodeApiUrl: settings.customUrl,
        version: 1,
      }))
    }
  }

  async function probe(network: NetworkId, nodeApiUrl: string): Promise<ProbeResult | null> {
    try {
      const statusResponse = await dependencies.requestJson(`${nodeApiUrl}/admin/status`)
      if (!statusResponse.ok || !isSynced(network, statusResponse.data)) return null
      const readResponse = await dependencies.requestJson(`${nodeApiUrl}${PUBLIC_READ_PATH}`)
      if (!readResponse.ok) return null
      return {
        latencyMs: statusResponse.latencyMs,
        nodeApiUrl,
        status: statusResponse.data,
      }
    } catch {
      return null
    }
  }

  async function resolvePublic(network: NetworkId) {
    const stickyUrl = stickyPublicUrls[network]
    if (stickyUrl) {
      const sticky = await probe(network, stickyUrl)
      if (sticky) return sticky
    }
    const candidates = (
      await Promise.all(PUBLIC_NODE_URLS[network].map((url) => probe(network, url)))
    )
      .filter((candidate): candidate is ProbeResult => !!candidate)
      .sort(
        (left, right) =>
          left.latencyMs - right.latencyMs ||
          (numberField(right.status, 'height') ?? 0) -
            (numberField(left.status, 'height') ?? 0) ||
          left.nodeApiUrl.localeCompare(right.nodeApiUrl),
      )
    const selected = candidates[0] ?? null
    if (selected) stickyPublicUrls[network] = selected.nodeApiUrl
    return selected
  }

  async function summary(network: NetworkId, settings: PortableNodeSettings) {
    const checkedAt = dependencies.now()
    if (settings.mode === 'disabled') {
      return emptySummary(network, settings, checkedAt, null)
    }
    if (settings.mode === 'local') {
      return emptySummary(
        network,
        settings,
        checkedAt,
        'Local Core connections are not available in the Android preview.',
      )
    }
    if (settings.mode === 'custom' && !settings.customUrl) {
      return emptySummary(network, settings, checkedAt, 'Configure a custom node URL.')
    }
    const nodeApiUrl = settings.mode === 'public' ? null : settings.customUrl
    let result = nodeApiUrl
      ? await probe(network, nodeApiUrl)
      : await resolvePublic(network)
    const freshlyVerified = !!result
    if (!result && settings.mode === 'public') {
      const recent = recentReadableNodes[network]
      if (recent && dependencies.now() - recent.verifiedAt < RECENT_READABLE_NODE_TTL_MS) {
        result = {
          latencyMs: 0,
          nodeApiUrl: recent.nodeApiUrl,
          status: recent.status,
        }
      }
    }
    if (!result) {
      return emptySummary(
        network,
        settings,
        checkedAt,
        `No healthy ${network === 'qortal' ? 'Qortal' : 'Qortium'} node was available.`,
      )
    }
    if (freshlyVerified) {
      recentReadableNodes[network] = {
        nodeApiUrl: result.nodeApiUrl,
        status: result.status,
        verifiedAt: dependencies.now(),
      }
    }
    const status = result.status
    return {
      ...emptySummary(network, settings, checkedAt, null),
      label: endpointHost(result.nodeApiUrl),
      state: 'online' as const,
      statusText: 'Online',
      nodeApiUrl: result.nodeApiUrl,
      height: numberField(status, 'height'),
      peerCount:
        numberField(status, 'numberOfConnections') ??
        numberField(status, 'peerCount'),
      syncPercent: numberField(status, 'syncPercent'),
      syncPhase: stringField(status, 'syncPhase'),
      capabilities: {
        // The credential belongs to this shell-only adapter. Never advertise
        // admin capability to embedded QDN apps through their route snapshot.
        admin: false,
        read: true,
        write: false,
      },
    }
  }

  async function getSnapshot() {
    const [qortalSettings, qortiumSettings] = await Promise.all([
      readSettings('qortal'),
      readSettings('qortium'),
    ])
    const [qortal, qortium] = await Promise.all([
      summary('qortal', qortalSettings),
      summary('qortium', qortiumSettings),
    ])
    return { version: 1, nodes: { qortal, qortium } }
  }

  async function getReadableNode(network: NetworkId) {
    const settings = await readSettings(network)
    if (settings.mode === 'disabled') throw new Error(`${network} access is disabled.`)
    if (settings.mode === 'local') {
      throw new Error('Local Core connections are not available on Android.')
    }
    const recent = recentReadableNodes[network]
    const nodeApiUrl =
      settings.mode === 'custom'
        ? settings.customUrl
        : recent && dependencies.now() - recent.verifiedAt < RECENT_READABLE_NODE_TTL_MS
          ? recent.nodeApiUrl
          : (await resolvePublic(network))?.nodeApiUrl ?? ''
    if (!nodeApiUrl) throw new Error(`No healthy ${network} node was available.`)
    return { nodeApiUrl, settings }
  }

  /**
   * The administered Qortium node plus its key — the client's own boundary,
   * so the key never crosses into the React layer. Refusals carry the shared
   * trust wording, which names the fix rather than the platform.
   */
  async function requireAdminNode(operation: string) {
    const settings = await readSettings('qortium')
    const nodeApiUrl = settings.mode === 'custom' ? settings.customUrl : ''
    const trust = evaluateHomeV2AdminTrust({
      attached: settings.apiKey ? { apiKey: settings.apiKey, origin: settings.customUrl } : null,
      managedApiKey: '',
      mode: settings.mode,
      network: 'qortium',
      nodeApiUrl,
    })
    if (!trust.trusted) throw new Error(homeV2AdminTrustMessage(trust.reason, operation))
    return { apiKey: trust.apiKey, nodeApiUrl: trust.origin, revision: trust.revision }
  }

  async function requestAdminJson(nodeApiUrl: string, path: string, apiKey: string) {
    const response = await dependencies.requestJson(
      `${nodeApiUrl}${path}`,
      'GET',
      LIST_REQUEST_TIMEOUT_MS,
      { Accept: 'application/json', 'X-API-KEY': apiKey },
      // Redirects refused for the same reason as desktop: this request
      // carries the administrative key, and a redirect would let the
      // responder choose a host nothing vetted.
      true,
    )
    if (!response.ok) {
      throw Object.assign(new Error(`List request failed with HTTP ${response.status}.`), {
        status: response.status,
      })
    }
    return response.data
  }

  async function requestAdminText(
    method: 'DELETE' | 'POST',
    nodeApiUrl: string,
    path: string,
    body: string,
    apiKey: string,
  ) {
    const response = await dependencies.requestJson(
      `${nodeApiUrl}${path}`,
      method,
      LIST_REQUEST_TIMEOUT_MS,
      { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      true,
      body,
    )
    if (!response.ok) {
      throw Object.assign(new Error(`List write failed with HTTP ${response.status}.`), {
        status: response.status,
      })
    }
    // Core answers the bare text "true"/"false"; 1.x and desktop both pass it
    // through unchanged rather than turning "false" into an error.
    return typeof response.data === 'string' ? response.data.trim() : String(response.data)
  }

  async function getCoreUpdateContext() {
    const settings = await readSettings('qortium')
    if (settings.mode !== 'custom' || !settings.customUrl) {
      throw new Error('Use an authenticated custom Qortium node to manage approved Core updates.')
    }
    if (!settings.apiKey) {
      throw new Error('Save the custom Qortium node API key to manage approved Core updates.')
    }
    return { apiKey: settings.apiKey, nodeApiUrl: settings.customUrl }
  }

  async function assertCoreUpdateContextCurrent(context: {
    readonly apiKey: string
    readonly nodeApiUrl: string
  }) {
    const current = await getCoreUpdateContext()
    if (
      current.nodeApiUrl !== context.nodeApiUrl ||
      current.apiKey !== context.apiKey
    ) {
      throw new Error('The custom Qortium node changed before the Core update request.')
    }
  }

  async function requestCoreUpdate(
    context: { readonly apiKey: string; readonly nodeApiUrl: string },
    method: 'GET' | 'POST',
  ): Promise<HomeV2CoreOnChainUpdateStatus> {
    const response = await dependencies.requestJson(
      `${context.nodeApiUrl}/admin/update`,
      method,
      CORE_UPDATE_TIMEOUT_MS,
      {
        Accept: 'application/json',
        'X-API-KEY': context.apiKey,
      },
      true,
    )
    if (!response.ok) {
      throw new Error(
        method === 'POST'
          ? `Core on-chain update install request failed with HTTP ${response.status}.`
          : `Core on-chain update check failed with HTTP ${response.status}.`,
      )
    }
    return parseHomeV2CoreOnChainUpdateStatus(response.data)
  }

  async function installCoreUpdate() {
    if (coreUpdateInstallInFlight) return coreUpdateInstallInFlight
    const operation = (async () => {
      const context = await getCoreUpdateContext()
      const status = await requestCoreUpdate(context, 'GET')
      const statusCode = status.status?.toUpperCase() ?? ''
      const resourceStatus = status.binaryResourceStatus?.toUpperCase() ?? ''
      if (
        !status.updateAvailable ||
        status.autoUpdateMode?.toUpperCase() === 'INSTALL' ||
        status.downloadStarted ||
        status.installStarted ||
        status.installing ||
        statusCode === 'DOWNLOAD_STARTED' ||
        statusCode === 'INSTALL_IN_PROGRESS' ||
        (status.nextRetryTimestamp !== undefined && status.nextRetryTimestamp !== null) ||
        resourceStatus === 'BUILDING' ||
        resourceStatus === 'DOWNLOADING'
      ) return status
      await assertCoreUpdateContextCurrent(context)
      return requestCoreUpdate(context, 'POST')
    })()
    coreUpdateInstallInFlight = operation
    try {
      return await operation
    } finally {
      if (coreUpdateInstallInFlight === operation) coreUpdateInstallInFlight = null
    }
  }

  return {
    checkCoreUpdate: async () => {
      const context = await getCoreUpdateContext()
      return requestCoreUpdate(context, 'GET')
    },
    getSnapshot,
    async getShellState() {
      const value = await dependencies.getPreference(SHELL_STATE_KEY)
      if (!value) return null
      try {
        return JSON.parse(value) as unknown
      } catch {
        return null
      }
    },
    async saveShellState(value) {
      const raw = JSON.stringify(value)
      if (raw.length > 128 * 1024) {
        throw new Error('Home v2 shell state exceeded the 128 KiB limit.')
      }
      await dependencies.setPreference(SHELL_STATE_KEY, raw)
    },
    async saveShellGlobalState(value) {
      // Android has a single window, so there is no second tab strip to
      // protect; it shares the merge so both platforms mean the same thing.
      const stored = await dependencies.getPreference(SHELL_STATE_KEY)
      let parsed: unknown = null
      try {
        parsed = stored ? (JSON.parse(stored) as unknown) : null
      } catch {
        parsed = null
      }
      const raw = JSON.stringify(mergeHomeV2ShellGlobalState(parsed, value))
      if (raw.length > 128 * 1024) {
        throw new Error('Home v2 shell state exceeded the 128 KiB limit.')
      }
      await dependencies.setPreference(SHELL_STATE_KEY, raw)
    },
    /**
     * Administrative trust for the selected Qortium node, without ever
     * handing out the key. Android has no managed local Core, so this is the
     * attached-key case: a custom node the user bound their own API key to.
     */
    async adminTrust() {
      const settings = await readSettings('qortium')
      const nodeApiUrl = settings.mode === 'custom' ? settings.customUrl : ''
      const trust = evaluateHomeV2AdminTrust({
        attached: settings.apiKey ? { apiKey: settings.apiKey, origin: settings.customUrl } : null,
        managedApiKey: '',
        mode: settings.mode,
        network: 'qortium',
        nodeApiUrl,
      })
      return trust.trusted
        ? { origin: trust.origin, revision: trust.revision, trusted: true as const }
        : {
            origin: '',
            reason: homeV2AdminTrustMessage(trust.reason, 'Using QDN lists'),
            revision: '',
            trusted: false as const,
          }
    },
    async listRead(action, request) {
      const { apiKey, nodeApiUrl } = await requireAdminNode('Using QDN lists')
      const path = action === 'GET_ALL_LISTS'
        ? '/lists'
        : buildHomeV2ListPath(normalizeHomeV2ListName(request))
      try {
        return await requestAdminJson(nodeApiUrl, path, apiKey)
      } catch (error) {
        // Core answers 404 for a list it has never stored; 1.x and desktop
        // both read that as an empty list rather than a failure.
        if ((error as { status?: unknown })?.status === 404) {
          return action === 'GET_ALL_LISTS' ? [] : []
        }
        throw error
      }
    },
    async listWrite(action, request, approvedRevision) {
      const listName = normalizeHomeV2ListName(request)
      const items = normalizeHomeV2ListItems(request)
      const { apiKey, nodeApiUrl, revision } = await requireAdminNode('Using QDN lists')
      // The approval named one node and one credential; a key rotated or an
      // address changed while the prompt was open must not inherit it.
      if (revision !== approvedRevision) {
        throw new Error('The selected Qortium node or its API key changed before the write could start.')
      }
      return requestAdminText(
        action === 'ADD_TO_LIST' ? 'POST' : 'DELETE',
        nodeApiUrl,
        buildHomeV2ListPath(listName),
        buildHomeV2ListWriteBody(items),
        apiKey,
      )
    },
    async requestApp(protocol, requestValue, context) {
      if (!isHomeV2AppRecord(requestValue)) throw new Error('App requests must be objects.')
      // Collapse a compatibility alias onto the action that implements it —
      // and onto the REQUEST that action expects — before anything else looks
      // at either, so this host gates, dispatches and reports exactly as the
      // desktop bridge does.
      const alias = resolveHomeV2AppAlias(normalizeHomeV2AppAction(requestValue), requestValue, protocol)
      const action = alias.action
      const request = alias.request
      const network = getHomeV2AppNetwork(protocol, action)
      const selectedSettings = await readSettings(network)
      const selectedNode = await summary(network, selectedSettings)
      const hostInfo = getHomeV2AppHostInfo({
        accountId: context?.selectedAccountId,
        hostVersion: packageJson.version,
        node: selectedNode,
        platform: 'android',
        platformVersion: '2.1',
        protocol,
      })
      if (action === 'SHOW_ACTIONS') {
        const otherNetwork: NetworkId = network === 'qortal' ? 'qortium' : 'qortal'
        const otherSettings = await readSettings(otherNetwork)
        const otherNode = await summary(otherNetwork, otherSettings)
        const qortalNode = network === 'qortal' ? selectedNode : otherNode
        const qortiumNode = network === 'qortium' ? selectedNode : otherNode
        return [...getHomeV2ContextualAppActions(getHomeV2AvailableAppActions(protocol, {
          qortal: getHomeV2AppRouteDescriptor({
            accountId: context?.selectedAccountId,
            network: 'qortal',
            node: qortalNode,
            platform: 'android',
            protocol: 'qortalRequest',
          }),
          qortium: getHomeV2AppRouteDescriptor({
            accountId: context?.selectedAccountId,
            network: 'qortium',
            node: qortiumNode,
            platform: 'android',
            protocol: 'qdnRequest',
          }),
        }), 'android')]
      }
      if (action === 'OPEN_AS_WIDGET' || action.startsWith('WIDGET_')) {
        throw new Error(`${action} is only available in Qortium Home desktop.`)
      }
      // Signing actions DO have an Android path now — the Home shell raises the
      // approval and the vault signs — but that path does not run through this
      // client, which is read-only plus a few Home-mediated actions. So a
      // signing action arriving here bypassed the prompt, and the refusals
      // below say exactly that rather than blaming the platform.
      // homeV2AndroidActionRefusal still decides the reason for anything
      // Android genuinely cannot do; its list is empty today.
      // Lists administer the user's own node. Reads are permissionless, so
      // the client serves them directly; a WRITE must carry an approval, and
      // the Home shell raises that before calling listWrite — so a write
      // arriving here bypassed the prompt and is refused.
      if (protocol === 'qdnRequest' && isHomeV2ListAction(action)) {
        if (isHomeV2ListWriteAction(action)) {
          throw createHomeV2BridgeError(
            `${action} must be approved through Home before it can change a list.`,
            { action, code: 'NODE_CAPABILITY_MISSING', network: 'qortium', retryable: false },
          )
        }
        return await this.listRead!(action, isRecord(requestValue) ? requestValue : {})
      }
      // Signing families whose Android arm lives in the Home shell: reaching
      // the client means the approval was bypassed, so refuse plainly rather
      // than falling through to the generic read-only message, which would
      // misdescribe a family this platform DOES implement.
      if (
        protocol === 'qdnRequest' &&
        (isHomeV2PollWriteAction(action) ||
          isHomeV2NameWriteAction(action) ||
          isHomeV2GroupMutationAction(action) ||
          isHomeV2RatingAction(action) ||
          action === 'SET_ACCOUNT_AVATAR' ||
          isHomeV2PublishExtraAction(action) ||
          action === 'SEND_MESSAGE' ||
          isHomeV2PaymentAction(action))
      ) {
        throw createHomeV2BridgeError(
          `${action} must be approved through Home before it can be signed.`,
          { action, code: 'NODE_CAPABILITY_MISSING', network: 'qortium', retryable: false },
        )
      }
      const androidRefusal = homeV2AndroidActionRefusal(action, protocol)
      if (androidRefusal) {
        throw createHomeV2BridgeError(androidRefusal.message, {
          action,
          code: 'NODE_CAPABILITY_MISSING',
          network: androidRefusal.network,
          retryable: false,
          routeRevision: hostInfo.route.revision,
        })
      }
      const implemented = getHomeV2AppActions(protocol).includes(action)
      const routeIndependent = (HOME_V2_ROUTE_INDEPENDENT_ACTIONS as readonly string[]).includes(action)
      if (!implemented || (!routeIndependent && !hostInfo.route.available)) {
        throw createHomeV2BridgeError(
          implemented
            ? `${action} is unavailable on the configured ${hostInfo.network} route.`
            : `${action} is not implemented for ${protocol}.`,
          {
            action,
            code: implemented ? 'NODE_CAPABILITY_MISSING' : 'UNSUPPORTED_PROTOCOL',
            network: hostInfo.network,
            retryable: false,
            routeRevision: hostInfo.route.revision,
          },
        )
      }
      if (action === 'WHICH_UI') return 'QORTIUM_HOME_ANDROID'
      if (action === 'GET_HOST_INFO') return hostInfo
      if (action === 'OPEN_NEW_TAB') {
        return { address: normalizeHomeV2OpenAddress(request), openIn: 'new-tab' }
      }
      // Same descriptor shape as OPEN_NEW_TAB. This host has no tab strip of
      // its own, so it only says WHERE the address should go; the shell
      // relaying this result supplies WHICH tab, from its own view context.
      // Nothing an app sends can name a tab.
      //
      // The stricter replacement validator, not the plain open one: a bare app
      // name or a Home page can never replace a tab, and both hosts must say
      // so at the bridge call rather than appearing to succeed.
      if (action === 'OPEN_CURRENT_TAB') {
        return { address: normalizeHomeV2ReplaceTabAddress(request), openIn: 'current-tab' }
      }
      if (action === 'IS_USING_PUBLIC_NODE') {
        return hostInfo.route.configuredKind === 'public'
      }
      const requestData = async (targetNetwork: NetworkId, path: string, maxBytes: number) => {
        const { nodeApiUrl } = await getReadableNode(targetNetwork)
        const response = await dependencies.requestJson(
          `${nodeApiUrl}${path}`,
          'GET',
          APP_READ_TIMEOUT_MS,
        )
        const body = JSON.stringify(response.data ?? null)
        if (new TextEncoder().encode(body).byteLength > maxBytes) {
          throw new Error('Node API response exceeded the requested size limit.')
        }
        if (!response.ok) throw new Error(`Node request returned HTTP ${response.status}.`)
        return { data: response.data, nodeApiUrl }
      }
      // Same read the account actions do, factored out because four of the
      // restored tier-2 actions default a subject address to the selected
      // account. Returns null rather than throwing so each caller decides
      // whether "no account selected" is fatal for it.
      const selectedAccountAddress = async () => {
        if (!context?.selectedAccountId) return null
        const catalogue = parseHomeV2AccountCatalogueStore(
          await dependencies.getPreference(WALLET_STORE_KEY),
        )
        return catalogue.accounts.find(
          (candidate) => candidate.id === context.selectedAccountId,
        )?.address ?? null
      }
      // Mirrors the desktop handler in electron/home-v2-app-bridge.ts: native
      // asset only, no node call, no key material, foreign coins refused with
      // a coded error rather than answered with the native address.
      if (action === 'GET_USER_WALLET') {
        if (!isHomeV2NativeWalletRequest(request)) {
          throw homeV2ForeignWalletUnavailableError(request.coin ?? request.blockchain)
        }
        const address = await selectedAccountAddress()
        if (!address) throw new Error('No account is selected for this tab.')
        return buildHomeV2UserWalletResult(address)
      }
      if (action === 'GET_SELECTED_ACCOUNT' || action === 'GET_USER_ACCOUNT') {
        if (!context?.selectedAccountId) throw new Error('No account is selected for this tab.')
        const catalogue = parseHomeV2AccountCatalogueStore(
          await dependencies.getPreference(WALLET_STORE_KEY),
        )
        const account = catalogue.accounts.find((candidate) => candidate.id === context.selectedAccountId)
        if (!account) throw new Error('The selected account is no longer available.')
        if (action === 'GET_USER_ACCOUNT') {
          const { data } = await requestData(
            'qortal',
            `/addresses/${encodeURIComponent(account.address)}`,
            256 * 1024,
          )
          return { address: account.address, publicKey: stringField(data, 'publicKey') }
        }
        const primary = await requestData(
          'qortium',
          `/names/primary/${encodeURIComponent(account.address)}`,
          256 * 1024,
        ).catch(() => ({ data: null }))
        return {
          address: account.address,
          avatarContract: 'pointer-aware-account-avatar-v1',
          avatarUrl: null,
          isUnlocked: account.isUnlocked,
          name: stringField(primary.data, 'name'),
        }
      }
      if (action === 'GET_NAME_DATA' || action === 'GET_ACCOUNT_NAMES' || action === 'GET_PRIMARY_NAME') {
        return (await requestData(
          network,
          buildHomeV2NamePath(action, request),
          normalizeHomeV2ResponseMaxBytes(request.maxBytes),
        )).data
      }
      if (action === 'GET_ACCOUNT_DATA' || action === 'GET_BALANCE') {
        // Twin of the desktop handler: an absent address means the selected
        // account, and GET_BALANCE honors `assetId`.
        const address = resolveHomeV2AccountReadAddress(request, await selectedAccountAddress())
        const path = action === 'GET_BALANCE'
          ? buildHomeV2AccountBalancePath(address, request)
          : buildHomeV2AccountDataPath(address)
        return (await requestData(
          network,
          path,
          normalizeHomeV2ResponseMaxBytes(request.maxBytes),
        )).data
      }
      // The two trust reads, combining a public summary with this rater's own
      // rating. A 404 means "not rated yet" and becomes the documented empty
      // value; every OTHER failure still propagates, so a network problem is
      // never reported to the app as "unrated". Mirrors the desktop bridge,
      // which checks result.status the same way — hence a dedicated read here
      // rather than requestData, which throws on any non-2xx alike.
      if (isHomeV2RatingReadAction(action)) {
        const read = buildHomeV2RatingRead(
          action,
          request,
          homeV2RatingReadNeedsSelectedAddress(request) ? await selectedAccountAddress() : null,
        )
        const maxBytes = normalizeHomeV2ResponseMaxBytes(request.maxBytes)
        const optionalRead = async (path: string, notFoundValue: unknown) => {
          const { nodeApiUrl } = await getReadableNode(network)
          const response = await dependencies.requestJson(
            `${nodeApiUrl}${path}`,
            'GET',
            APP_READ_TIMEOUT_MS,
          )
          if (response.status === 404) return notFoundValue
          const body = JSON.stringify(response.data ?? null)
          if (new TextEncoder().encode(body).byteLength > maxBytes) {
            throw new Error('Node API response exceeded the requested size limit.')
          }
          if (!response.ok) throw new Error(`Node request returned HTTP ${response.status}.`)
          return response.data
        }
        const [summary, rating] = await Promise.all([
          optionalRead(read.summaryPath, null),
          optionalRead(read.ratingPath, read.ratingFallback),
        ])
        return buildHomeV2RatingReadResult(read, summary, rating)
      }
      if (action === 'GET_MARKET_PRICES') {
        const priceRequest = normalizeHomeV2MarketPriceRequest(request)
        return androidMarketPrices.read(priceRequest, async (url) => {
          const response = await dependencies.requestJson(
            url,
            'GET',
            HOME_V2_MARKET_PRICE_TIMEOUT_MS,
            { Accept: 'application/json' },
          )
          const body = JSON.stringify(response.data ?? null)
          if (new TextEncoder().encode(body).byteLength > HOME_V2_MARKET_PRICE_MAX_BYTES) {
            throw new Error('Market price response exceeded the size limit.')
          }
          return { ok: response.ok, payload: response.data, status: response.status }
        })
      }
      if (isHomeV2MintingReadAction(action)) {
        // Android never runs a local Core (readSettings rejects 'local'), so
        // the node-side half of minting — which keys the node holds, whether
        // it can mint — is always unavailable here. Only the on-chain
        // authorization is readable, and it is read from the public route.
        // Keep this in step with readHomeV2MintingStatus in
        // electron/home-v2-app-bridge.ts.
        if (action === 'LIST_MINTING_ACCOUNTS') {
          return createHomeV2MintingAccountsResult({ accounts: [], available: false })
        }
        const address = request.address === undefined || request.address === null || request.address === ''
          ? await (async () => {
              if (!context?.selectedAccountId) {
                throw new Error('GET_MINTING_STATUS needs an address or a selected account.')
              }
              const catalogue = parseHomeV2AccountCatalogueStore(
                await dependencies.getPreference(WALLET_STORE_KEY),
              )
              const account = catalogue.accounts.find(
                (candidate) => candidate.id === context.selectedAccountId,
              )
              if (!account) throw new Error('The selected account is no longer available.')
              return account.address
            })()
          : normalizeHomeV2Address(request.address)
        const { data } = await requestData(
          network,
          buildHomeV2SelfRewardSharesPath(address),
          normalizeHomeV2ResponseMaxBytes(request.maxBytes),
        )
        return deriveHomeV2MintingStatus({ address, nodeAdmin: null, rewardShares: data })
      }
      if (
        action === 'GET_ASSET_INFO' ||
        action === 'GET_ASSET_BALANCES' ||
        action === 'GET_ASSET_TRANSFERS'
      ) {
        return (await requestData(
          network,
          buildHomeV2AssetReadPath(action, request),
          normalizeHomeV2ResponseMaxBytes(request.maxBytes),
        )).data
      }
      if (isHomeV2ChainReadAction(action)) {
        // GET_MEMBER_BANS / GET_MEMBER_KICKS default their address to the
        // selected account, as on desktop.
        const chainReadRequest = homeV2ChainReadNeedsSelectedAddress(action, request)
          ? withHomeV2SelectedAddress(request, await selectedAccountAddress())
          : request
        const { data } = await requestData(
          network,
          buildHomeV2ChainReadPath(action, chainReadRequest),
          normalizeHomeV2ResponseMaxBytes(request.maxBytes),
        )
        if (isHomeV2CrosschainReadAction(action)) {
          return projectHomeV2CrosschainReadResult(action, chainReadRequest, data)
        }
        // Both cores answer a valid-but-absent AT with an empty 2xx body;
        // normalize that to the same documented error the desktop bridge uses.
        if (
          (action === 'GET_AT' || action === 'GET_AT_DATA') &&
          (data === null || data === undefined || data === '')
        ) {
          throw new Error('AT not found.')
        }
        return data
      }
      if (action === 'RESOLVE_IDENTITIES') {
        const addresses = normalizeHomeV2IdentityAddresses(request.addresses)
        return Promise.all(addresses.map(async (address) => {
          const [primary, names] = await Promise.all([
            requestData('qortium', `/names/primary/${encodeURIComponent(address)}`, 256 * 1024)
              .catch(() => ({ data: null })),
            requestData('qortium', `/names/address/${encodeURIComponent(address)}?limit=0`, 256 * 1024)
              .catch(() => ({ data: null })),
          ])
          const name = stringField(primary.data, 'name') ?? (
            Array.isArray(names.data)
              ? names.data.map((entry) => stringField(entry, 'name')).find(Boolean) ?? null
              : null
          )
          const { nodeApiUrl } = await getReadableNode('qortium')
          return {
            address,
            name,
            avatarSrc: name
              ? `${nodeApiUrl}/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/avatar?async=true`
              : null,
            avatarContract: 'legacy-named-thumbnail',
          }
        }))
      }
      if (action === 'FETCH_ACCOUNT_AVATAR' || action === 'FETCH_GROUP_AVATAR') {
        const avatarAction = action as HomeV2AvatarAction
        const { nodeApiUrl } = await getReadableNode(network)
        return fetchHomeV2AvatarAction(network, avatarAction, request, {
          async readAvatar(path) {
            const response = await dependencies.requestBinary(`${nodeApiUrl}${path}`)
            const result = parseHomeV2AvatarResponse(response)
            if (result.status !== 'ready' && result.status !== 'pending') return result
            const descriptor = getAvatarDescriptorFromHeaders(
              (name) => headerValue(response.headers, name),
            )
            return descriptor ? { ...result, descriptor } : result
          },
          async readJson(path) {
            const response = await dependencies.requestJson(
              `${nodeApiUrl}${path}`,
              'GET',
              APP_READ_TIMEOUT_MS,
            )
            const body = JSON.stringify(response.data ?? null)
            if (new TextEncoder().encode(body).byteLength > 256 * 1024) {
              throw new Error('Avatar metadata response exceeded the size limit.')
            }
            return { data: response.data, status: response.status }
          },
        })
      }
      if (
        action === 'FETCH_QDN_RESOURCE' ||
        action === 'LIST_QDN_RESOURCES' ||
        action === 'SEARCH_QDN_RESOURCES' ||
        action === 'GET_QDN_RESOURCE_METADATA' ||
        action === 'GET_QDN_RESOURCE_PROPERTIES' ||
        action === 'GET_QDN_RESOURCE_STATUS'
      ) {
        return (await requestData(
          network,
          buildHomeV2ResourcePath(action, request),
          normalizeHomeV2ResponseMaxBytes(request.maxBytes),
        )).data
      }
      if (action === 'GET_QDN_RESOURCE_URL') {
        const status = await requestData(
          network,
          buildHomeV2ResourcePath('GET_QDN_RESOURCE_STATUS', request),
          256 * 1024,
        )
        if (!isRecord(status.data) || !status.data.status || status.data.status === 'NOT_PUBLISHED') {
          throw new Error('Resource does not exist.')
        }
        return `${status.nodeApiUrl}${buildHomeV2ResourceRenderPath(request)}`
      }
      if (action === 'GET_QDN_RESOURCE_STREAM_URL' || action === 'OPEN_QDN_RESOURCE_VIEWER') {
        const resource = action === 'GET_QDN_RESOURCE_STREAM_URL'
          ? getQdnResourceStreamRequest(request as QdnAppRequest)
          : getQdnResourceViewerRequest(request as QdnAppRequest)
        const status = await requestData(
          network,
          buildHomeV2ResourcePath('GET_QDN_RESOURCE_STATUS', request),
          256 * 1024,
        )
        if (!isRecord(status.data) || !status.data.status || status.data.status === 'NOT_PUBLISHED') {
          throw new Error('Resource does not exist.')
        }
        const streamUrl = `${status.nodeApiUrl}${buildHomeV2ResourceRenderPath(request)}`
        return action === 'GET_QDN_RESOURCE_STREAM_URL'
          ? streamUrl
          : {
              ...resource,
              network,
              sourceTabId: context?.tabId ?? null,
              streamUrl,
            }
      }
      if (action === 'SAVE_QDN_RESOURCE') {
        const resource = getQdnResourceViewerRequest(request as QdnAppRequest)
        const { nodeApiUrl } = await getReadableNode(network)
        const response = await dependencies.requestBinary(
          `${nodeApiUrl}${buildHomeV2ResourcePath('FETCH_QDN_RESOURCE', {
            identifier: resource.identifier,
            name: resource.name,
            path: resource.path,
            service: resource.service,
          })}`,
          120_000,
        )
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`QDN resource request returned HTTP ${response.status}.`)
        }
        if (typeof response.data !== 'string') {
          throw new Error('QDN resource response was not binary data.')
        }
        const declaredLength = Number(headerValue(response.headers, 'content-length'))
        if (Number.isFinite(declaredLength) && declaredLength > RESOURCE_SAVE_MAX_BYTES) {
          throw new Error('QDN resource exceeds the 100 MiB save limit.')
        }
        const bytes = decodePortableBase64(response.data)
        if (bytes.byteLength > RESOURCE_SAVE_MAX_BYTES) {
          throw new Error('QDN resource exceeds the 100 MiB save limit.')
        }
        const fallback = `${resource.service}_${resource.name}_${resource.identifier ?? 'default'}`
        return dependencies.saveBinary({
          bytes,
          fileName: sanitizePortableResourceFilename(resource.filename, fallback),
          mimeType: headerValue(response.headers, 'content-type') ?? resource.mimeType ?? 'application/octet-stream',
        })
      }
      const path =
        action === 'GET_NODE_STATUS'
          ? '/admin/status'
          : action === 'GET_NODE_INFO'
            ? '/admin/info'
            : action === 'FETCH_NODE_API' || action === 'FETCH_QORTAL_NODE_API'
              ? normalizeHomeV2ReadPath(request.path)
              : null
      if (!path) throw new Error(`${action} is not available in Home v2 read-only mode.`)
      const method = normalizeHomeV2ReadMethod(request.method)
      const { nodeApiUrl } = await getReadableNode(network)
      const response = await dependencies.requestJson(
        `${nodeApiUrl}${path}`,
        method,
        APP_READ_TIMEOUT_MS,
      )
      const body = method === 'HEAD' ? '' : JSON.stringify(response.data ?? null)
      const bodyLength = new TextEncoder().encode(body).byteLength
      if (bodyLength > normalizeHomeV2ResponseMaxBytes(request.maxBytes)) {
        throw new Error('Node API response exceeded the requested size limit.')
      }
      if (action === 'GET_NODE_STATUS' || action === 'GET_NODE_INFO') {
        if (!response.ok) throw new Error(`Node request returned HTTP ${response.status}.`)
        return response.data
      }
      return {
        body,
        contentLength: bodyLength,
        contentType: 'application/json',
        data: response.data,
        headers: response.headers ?? {},
        ok: response.ok,
        status: response.status,
        statusText: '',
      }
    },
    async listAccounts() {
      return parseHomeV2AccountCatalogueStore(
        await dependencies.getPreference(WALLET_STORE_KEY),
      )
    },
    async listAppResources(network, name, service) {
      const { nodeApiUrl } = await getReadableNode(network)
      const response = await dependencies.requestJson(
        `${nodeApiUrl}${buildHomeV2AppResourceSearchPath(name, service)}`,
      )
      if (!response.ok) {
        throw new Error(`App resource search returned HTTP ${response.status}.`)
      }
      return parseHomeV2AppResourceCandidates(response.data, name)
    },
    async readAvatar(network, request) {
      const settings = await readSettings(network)
      if (settings.mode === 'disabled' || settings.mode === 'local') {
        return {
          message:
            settings.mode === 'disabled'
              ? `${network} access is disabled.`
              : 'Local Core connections are not available on Android.',
          status: 'unavailable' as const,
        }
      }
      const recent = recentReadableNodes[network]
      const nodeApiUrl =
        settings.mode === 'custom'
          ? settings.customUrl
          : recent && dependencies.now() - recent.verifiedAt < 30_000
            ? recent.nodeApiUrl
            : (await resolvePublic(network))?.nodeApiUrl ?? ''
      if (!nodeApiUrl) {
        return {
          message: `No healthy ${network} node was available.`,
          status: 'unavailable' as const,
        }
      }
      try {
        return normalizeHomeV2AvatarReadResult(
          request,
          parseHomeV2AvatarResponse(
            await dependencies.requestBinary(
              `${nodeApiUrl}${buildHomeV2AvatarPath(network, request)}`,
            ),
          ),
        )
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : 'Avatar request failed.',
          status: 'unavailable' as const,
        }
      }
    },
    async readAppIcon(network, request) {
      const settings = await readSettings(network)
      if (settings.mode === 'disabled' || settings.mode === 'local') {
        return {
          message:
            settings.mode === 'disabled'
              ? `${network} access is disabled.`
              : 'Local Core connections are not available on Android.',
          status: 'unavailable' as const,
        }
      }
      const recent = recentReadableNodes[network]
      const nodeApiUrl =
        settings.mode === 'custom'
          ? settings.customUrl
          : recent && dependencies.now() - recent.verifiedAt < 30_000
            ? recent.nodeApiUrl
            : (await resolvePublic(network))?.nodeApiUrl ?? ''
      if (!nodeApiUrl) {
        return {
          message: `No healthy ${network} node was available.`,
          status: 'unavailable' as const,
        }
      }
      try {
        return parseHomeV2AppIconResponse(
          await dependencies.requestBinary(
            `${nodeApiUrl}${buildHomeV2AppIconPath(request)}`,
          ),
        )
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : 'App icon request failed.',
          status: 'unavailable' as const,
        }
      }
    },
    async readIdentity(network, request) {
      const settings = await readSettings(network)
      if (settings.mode === 'disabled') {
        return { data: { message: `${network} access is disabled.` }, status: 503 }
      }
      if (settings.mode === 'local') {
        return {
          data: { message: 'Local Core connections are not available on Android.' },
          status: 503,
        }
      }
      const recent = recentReadableNodes[network]
      const nodeApiUrl =
        settings.mode === 'custom'
          ? settings.customUrl
          : recent && dependencies.now() - recent.verifiedAt < 30_000
            ? recent.nodeApiUrl
            : (await resolvePublic(network))?.nodeApiUrl ?? ''
      if (!nodeApiUrl) {
        return { data: { message: `No healthy ${network} node was available.` }, status: 503 }
      }
      const response = await dependencies.requestJson(
        `${nodeApiUrl}${buildHomeV2IdentityReadPath(network, request)}`,
      )
      return { data: response.data, status: response.status }
    },
    async setMode(network, mode) {
      const settings = await readSettings(network)
      if (mode === 'custom' && !settings.customUrl) {
        throw new Error('Configure a custom node URL first.')
      }
      const normalizedMode = mode === 'local' ? 'public' : mode
      await writeSettings(network, {
        ...settings,
        lastEnabledMode:
          normalizedMode === 'disabled'
            ? settings.mode === 'disabled' || settings.mode === 'local'
              ? settings.lastEnabledMode
              : settings.mode
            : normalizedMode,
        mode,
      })
      return getSnapshot()
    },
    installCoreUpdate,
    async setCustomUrl(network, customUrl, apiKey) {
      const settings = await readSettings(network)
      const normalizedUrl = normalizePortableNodeUrl(customUrl)
      const nextApiKey = network === 'qortium'
        ? apiKey === undefined
          ? settings.customUrl === normalizedUrl
            ? settings.apiKey
            : ''
          : normalizePortableNodeApiKey(apiKey)
        : ''
      await writeSettings(network, {
        ...settings,
        apiKey: nextApiKey,
        customUrl: normalizedUrl,
        lastEnabledMode: 'custom',
        mode: 'custom',
      })
      return getSnapshot()
    },
  }
}

export function getHomeV2NodeClient() {
  if (window.homeV2Nodes) return window.homeV2Nodes
  throw new Error('Live node access is unavailable on this platform.')
}

export interface HomeV2WindowsBridge {
  /** Null in the window Home started with; an address in a detached one. */
  getStartup(): Promise<{ address: string } | null>
  openTab(address: string): Promise<void>
  /**
   * The app-level window settings — close to tray, and the multi-tab close
   * warning. Optional because only the desktop shell has them; both replies
   * are re-validated by window-behavior-client.ts rather than trusted.
   */
  getBehavior?(): Promise<unknown>
  setBehavior?(change: {
    closeToTray?: boolean
    warnOnCloseWithMultipleTabs?: boolean
  }): Promise<unknown>
}

/**
 * The dedicated one-way channel for attaching a node administration key.
 * Deliberately separate from HomeV2NodeClient: that surface returns node
 * snapshots to the renderer and must never carry key material. Nothing here
 * reads a key back — only whether one is attached, and to which origin.
 */
export interface HomeV2NodeAdminBridge {
  attach(network: 'qortium', key: string): Promise<{ attached: boolean; origin: string }>
  clear(network: 'qortium'): Promise<{ attached: boolean; origin: string }>
}

declare global {
  interface Window {
    homeV2NodeAdmin?: HomeV2NodeAdminBridge
    homeV2Nodes?: HomeV2NodeClient
    homeV2Windows?: HomeV2WindowsBridge
  }
}
