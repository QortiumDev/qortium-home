import type {
  HomeV2AccountCatalogue,
  NetworkId,
  NodeConnectionMode,
  NodeSummary,
  VisibleAvatarReadRequest,
  VisibleAvatarReadResult,
} from '../v2/contracts'
import { parseHomeV2AccountCatalogueStore } from './account-catalogue'

export interface HomeV2NodeClient {
  getSnapshot(): Promise<unknown>
  getShellState(): Promise<unknown>
  saveShellState(value: unknown): Promise<void>
  requestApp(
    protocol: HomeV2AppBridgeProtocol,
    request: unknown,
  ): Promise<unknown>
  listAccounts(): Promise<HomeV2AccountCatalogue>
  readAvatar(
    network: NetworkId,
    request: VisibleAvatarReadRequest,
  ): Promise<VisibleAvatarReadResult>
  readIdentity(
    network: NetworkId,
    request: HomeV2IdentityReadRequest,
  ): Promise<HomeV2IdentityReadResponse>
  setMode(network: NetworkId, mode: NodeConnectionMode): Promise<unknown>
  setCustomUrl(network: NetworkId, customUrl: string): Promise<unknown>
}

export type HomeV2AppBridgeProtocol = 'qdnRequest' | 'qortalRequest'

export type HomeV2IdentityReadKind =
  | 'accountAvatarInfo'
  | 'name'
  | 'namesByAddress'
  | 'primaryName'

export interface HomeV2IdentityReadRequest {
  readonly kind: HomeV2IdentityReadKind
  readonly value: string
}

export interface HomeV2IdentityReadResponse {
  readonly data: unknown
  readonly status: number
}

interface PortableNodeSettings {
  customUrl: string
  mode: NodeConnectionMode
}

export interface PortableNodeClientDependencies {
  getPreference(key: string): Promise<string | null>
  setPreference(key: string, value: string): Promise<void>
  requestJson(url: string, method?: 'GET' | 'HEAD'): Promise<{
    data: unknown
    latencyMs: number
    ok: boolean
    status: number
  }>
  requestBinary(url: string): Promise<{
    data: unknown
    headers: Readonly<Record<string, string>>
    status: number
  }>
  now(): number
}

const PUBLIC_NODE_URLS = {
  qortal: ['https://ext-node.qortal.link', 'https://api.qortal.org'],
  qortium: ['https://node1.qortium.app', 'https://node2.qortium.app'],
} as const

const PUBLIC_READ_PATH =
  '/arbitrary/resources/search?mode=ALL&limit=1&includestatus=false&includemetadata=false'
const SETTINGS_PREFIX = 'home-v2-live-node:'
const AVATAR_MAX_BYTES = 500 * 1024
const WALLET_STORE_KEY = 'qortium-home-wallet-store'
const SHELL_STATE_KEY = 'home-v2-live-shell-state'
const APP_RESPONSE_MAX_BYTES = 2 * 1024 * 1024
export const HOME_V2_READ_ONLY_APP_ACTIONS = Object.freeze([
  'FETCH_NODE_API',
  'FETCH_QORTAL_NODE_API',
  'GET_HOST_INFO',
  'GET_NODE_INFO',
  'GET_NODE_STATUS',
  'IS_USING_PUBLIC_NODE',
  'SHOW_ACTIONS',
  'WHICH_UI',
])

const APP_READ_PATH_PREFIXES = [
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

function appRequestRecord(value: unknown) {
  if (!isRecord(value)) throw new Error('App requests must be objects.')
  return value
}

function appAction(request: Record<string, unknown>) {
  const action = typeof request.action === 'string' ? request.action.trim().toUpperCase() : ''
  if (!action) throw new Error('App request action is required.')
  return action
}

function appReadPath(value: unknown) {
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
    !APP_READ_PATH_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    throw new Error('That node API path is outside Home v2 read-only scope.')
  }
  return `${pathname}${parsed.search}`
}

function appReadMethod(value: unknown) {
  const method = typeof value === 'string' ? value.toUpperCase() : 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    throw new Error('Home v2 apps can only use GET or HEAD node reads.')
  }
  return method
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

function decodeAvatarBase64(value: string) {
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
    bytes = decodeAvatarBase64(response.data)
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

function identityPath(request: HomeV2IdentityReadRequest) {
  const value = request.value.trim()
  if (!value || value.length > 128) {
    throw new Error('Identity lookup values must contain 1 to 128 characters.')
  }
  const encoded = encodeURIComponent(value)
  switch (request.kind) {
    case 'name':
      return `/names/${encoded}`
    case 'namesByAddress':
      return `/names/address/${encoded}?limit=0`
    case 'primaryName':
      return `/names/primary/${encoded}`
    case 'accountAvatarInfo':
      return `/addresses/${encoded}/avatar/info`
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

function parseSettings(value: string | null): PortableNodeSettings {
  if (!value) return { customUrl: '', mode: 'public' }
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
      return { customUrl, mode }
    }
  } catch {
    // Invalid preview-only preferences fall back to Public without mutation.
  }
  return { customUrl: '', mode: 'public' }
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
    mode: settings.mode,
    state: 'offline',
    statusText: disabled ? 'Disabled' : settings.mode === 'local' ? 'Not available' : 'Unavailable',
    isTrusted: settings.mode === 'local',
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
    Record<NetworkId, { nodeApiUrl: string; verifiedAt: number }>
  > = {}

  async function readSettings(network: NetworkId) {
    return parseSettings(await dependencies.getPreference(settingsKey(network)))
  }

  async function writeSettings(network: NetworkId, settings: PortableNodeSettings) {
    await dependencies.setPreference(settingsKey(network), JSON.stringify(settings))
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
      delete stickyPublicUrls[network]
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
    const result = nodeApiUrl
      ? await probe(network, nodeApiUrl)
      : await resolvePublic(network)
    if (!result) {
      return emptySummary(
        network,
        settings,
        checkedAt,
        `No healthy ${network === 'qortal' ? 'Qortal' : 'Qortium'} node was available.`,
      )
    }
    recentReadableNodes[network] = {
      nodeApiUrl: result.nodeApiUrl,
      verifiedAt: dependencies.now(),
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
      capabilities: { admin: false, read: true, write: false },
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
        : recent && dependencies.now() - recent.verifiedAt < 30_000
          ? recent.nodeApiUrl
          : (await resolvePublic(network))?.nodeApiUrl ?? ''
    if (!nodeApiUrl) throw new Error(`No healthy ${network} node was available.`)
    return { nodeApiUrl, settings }
  }

  return {
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
    async requestApp(protocol, requestValue) {
      const request = appRequestRecord(requestValue)
      const action = appAction(request)
      const protocolNetwork: NetworkId =
        protocol === 'qortalRequest' ? 'qortal' : 'qortium'
      if (action === 'SHOW_ACTIONS') return [...HOME_V2_READ_ONLY_APP_ACTIONS]
      if (action === 'WHICH_UI') return 'QORTIUM_HOME_ANDROID'
      if (action === 'GET_HOST_INFO') {
        return { hostName: 'qortium-home', platform: 'android', platformVersion: '2.0-preview' }
      }
      const network = action === 'FETCH_QORTAL_NODE_API' ? 'qortal' : protocolNetwork
      if (action === 'IS_USING_PUBLIC_NODE') {
        return (await getReadableNode(network)).settings.mode === 'public'
      }
      const path =
        action === 'GET_NODE_STATUS'
          ? '/admin/status'
          : action === 'GET_NODE_INFO'
            ? '/admin/info'
            : action === 'FETCH_NODE_API' || action === 'FETCH_QORTAL_NODE_API'
              ? appReadPath(request.path)
              : null
      if (!path) throw new Error(`${action} is not available in Home v2 read-only mode.`)
      const method = appReadMethod(request.method)
      const { nodeApiUrl } = await getReadableNode(network)
      const response = await dependencies.requestJson(`${nodeApiUrl}${path}`, method)
      const body = method === 'HEAD' ? '' : JSON.stringify(response.data ?? null)
      const bodyLength = new TextEncoder().encode(body).byteLength
      if (bodyLength > APP_RESPONSE_MAX_BYTES) {
        throw new Error('Node API response exceeded the 2 MiB limit.')
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
        headers: {},
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
        return parseHomeV2AvatarResponse(
          await dependencies.requestBinary(
            `${nodeApiUrl}${buildHomeV2AvatarPath(network, request)}`,
          ),
        )
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : 'Avatar request failed.',
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
        `${nodeApiUrl}${identityPath(request)}`,
      )
      return { data: response.data, status: response.status }
    },
    async setMode(network, mode) {
      const settings = await readSettings(network)
      if (mode === 'custom' && !settings.customUrl) {
        throw new Error('Configure a custom node URL first.')
      }
      await writeSettings(network, { ...settings, mode })
      return getSnapshot()
    },
    async setCustomUrl(network, customUrl) {
      const settings = await readSettings(network)
      await writeSettings(network, {
        ...settings,
        customUrl: normalizePortableNodeUrl(customUrl),
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

declare global {
  interface Window {
    homeV2Nodes?: HomeV2NodeClient
  }
}
