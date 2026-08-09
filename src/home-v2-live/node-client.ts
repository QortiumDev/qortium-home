import type {
  NetworkId,
  NodeConnectionMode,
  NodeSummary,
} from '../v2/contracts'

export interface HomeV2NodeClient {
  getSnapshot(): Promise<unknown>
  setMode(network: NetworkId, mode: NodeConnectionMode): Promise<unknown>
  setCustomUrl(network: NetworkId, customUrl: string): Promise<unknown>
}

interface PortableNodeSettings {
  customUrl: string
  mode: NodeConnectionMode
}

export interface PortableNodeClientDependencies {
  getPreference(key: string): Promise<string | null>
  setPreference(key: string, value: string): Promise<void>
  requestJson(url: string): Promise<{ data: unknown; latencyMs: number; ok: boolean }>
  now(): number
}

const PUBLIC_NODE_URLS = {
  qortal: ['https://ext-node.qortal.link', 'https://api.qortal.org'],
  qortium: ['https://node1.qortium.app', 'https://node2.qortium.app'],
} as const

const PUBLIC_READ_PATH =
  '/arbitrary/resources/search?mode=ALL&limit=1&includestatus=false&includemetadata=false'
const SETTINGS_PREFIX = 'home-v2-live-node:'

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

  return {
    getSnapshot,
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
