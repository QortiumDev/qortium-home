import { ipcMain, type WebContents } from 'electron'
import {
  getLocalNodeStatusForHomeV2,
  getNodeSettingsForHomeV2,
  getNodeStatusForHomeV2,
  saveNodeCustomUrlForHomeV2,
  saveNodeModeForHomeV2,
} from './node-settings.js'
import {
  getQortalLocalNodeStatusForHomeV2,
  getQortalNodeSettingsForHomeV2,
  getQortalNodeStatusForHomeV2,
  saveQortalCustomUrlForHomeV2,
  saveQortalNodeModeForHomeV2,
} from './qortal-node-settings.js'
import {
  getHomeV2LocalCoreInstallState,
  type HomeV2LocalCoreInstallState,
} from './home-v2-core-readiness.js'
import { nodeFetch } from './node-tls.js'
import {
  buildAccountAvatarPath,
  buildAvatarResourcePath,
  getAvatarImageContentType,
  getGroupAvatarRetryAfterSeconds,
  GROUP_AVATAR_MAX_BYTES,
} from './qdn-group-avatar-input.js'
import { getHomeV2AccountCatalogue } from './accounts.js'
import {
  readHomeV2ShellState,
  writeHomeV2ShellState,
} from './home-v2-shell-store.js'
import {
  buildHomeV2AppResourceSearchPath,
  normalizeHomeV2AppResourceName,
  parseHomeV2AppResourceCandidates,
} from './home-v2-app-resource-discovery.js'

type NetworkId = 'qortal' | 'qortium'
type NodeMode = 'custom' | 'disabled' | 'local' | 'public'
type IdentityReadKind =
  | 'accountAvatarInfo'
  | 'name'
  | 'namesByAddress'
  | 'primaryName'

const IDENTITY_RESPONSE_LIMIT = 256 * 1024
const SNAPSHOT_CACHE_MS = 30_000

const authorizedSenderIds = new Set<number>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stringField(value: unknown, key: string) {
  if (!isRecord(value)) return null
  const field = value[key]
  return typeof field === 'string' && field.trim() ? field.trim() : null
}

function numberField(value: unknown, key: string) {
  if (!isRecord(value)) return null
  const field = value[key]
  return typeof field === 'number' && Number.isFinite(field) ? field : null
}

function booleanField(value: unknown, key: string) {
  return isRecord(value) && value[key] === true
}

function assertAuthorized(sender: WebContents) {
  if (!authorizedSenderIds.has(sender.id)) {
    throw new Error('Home v2 node data is only available to an authorized Home v2 window.')
  }
}

function normalizeMode(value: unknown): NodeMode {
  if (
    value !== 'custom' &&
    value !== 'disabled' &&
    value !== 'local' &&
    value !== 'public'
  ) {
    throw new Error('Choose Disabled, Local, Public, or Custom.')
  }
  return value
}

function normalizeNetwork(value: unknown): NetworkId {
  if (value !== 'qortal' && value !== 'qortium') {
    throw new Error('Choose Qortal or Qortium.')
  }
  return value
}

function normalizeIdentityReadRequest(value: unknown) {
  if (!isRecord(value)) throw new Error('Identity read request is required.')
  const kind = value.kind
  if (
    kind !== 'accountAvatarInfo' &&
    kind !== 'name' &&
    kind !== 'namesByAddress' &&
    kind !== 'primaryName'
  ) {
    throw new Error('Unsupported identity read.')
  }
  const rawValue = typeof value.value === 'string' ? value.value.trim() : ''
  if (!rawValue || rawValue.length > 128) {
    throw new Error('Identity lookup values must contain 1 to 128 characters.')
  }
  return { kind, value: rawValue } as const
}

function identityPath(request: {
  readonly kind: IdentityReadKind
  readonly value: string
}) {
  const encoded = encodeURIComponent(request.value)
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

async function readBoundedText(response: Response) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > IDENTITY_RESPONSE_LIMIT) {
    throw new Error('Identity response exceeded the size limit.')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > IDENTITY_RESPONSE_LIMIT) {
      await reader.cancel()
      throw new Error('Identity response exceeded the size limit.')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function normalizeAvatarReadRequest(network: NetworkId, value: unknown) {
  if (!isRecord(value)) throw new Error('Avatar read request is required.')
  const address = typeof value.address === 'string' ? value.address.trim() : ''
  const pointer = isRecord(value.pointer) ? value.pointer : {}
  const service = typeof pointer.service === 'string' ? pointer.service.trim() : ''
  const name = typeof pointer.name === 'string' ? pointer.name.trim() : ''
  const identifier =
    typeof pointer.identifier === 'string' ? pointer.identifier.trim() : ''
  const source = pointer.source
  if (!/^Q[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
    throw new Error('Avatar address is invalid.')
  }
  if (!service || !name || !identifier || name.length > 128) {
    throw new Error('Avatar pointer metadata is invalid.')
  }
  if (network === 'qortium' && source === 'account-pointer') {
    return { address, legacyAsync: false, path: buildAccountAvatarPath(address) }
  }
  const expectedIdentifier = network === 'qortal' ? 'qortal_avatar' : 'avatar'
  if (
    source !== 'legacy-name' ||
    service !== 'THUMBNAIL' ||
    identifier !== expectedIdentifier
  ) {
    throw new Error('Avatar pointer does not match the selected network.')
  }
  return {
    address,
    legacyAsync: true,
    path: buildAvatarResourcePath({ identifier, name, service }),
  }
}

async function readBoundedBytes(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('Avatar exceeded the 500 KiB limit.')
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > maxBytes) {
      await reader.cancel()
      throw new Error('Avatar exceeded the 500 KiB limit.')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function getNodeState(status: unknown) {
  const syncPhase = stringField(status, 'syncPhase')?.toUpperCase() ?? null
  const syncPercent = numberField(status, 'syncPercent')
  const isSynchronizing = booleanField(status, 'isSynchronizing')
  if (
    isSynchronizing ||
    (syncPhase && syncPhase !== 'SYNCED') ||
    (syncPercent !== null && syncPercent < 100)
  ) {
    return 'syncing' as const
  }
  return 'online' as const
}

function modeLabel(mode: NodeMode) {
  return mode[0].toUpperCase() + mode.slice(1)
}

function endpointHost(nodeApiUrl: string) {
  try {
    return new URL(nodeApiUrl).host
  } catch {
    return nodeApiUrl
  }
}

function localCoreSummary(
  installState: HomeV2LocalCoreInstallState,
  rawLocalStatus: unknown,
) {
  if (isRecord(rawLocalStatus) && rawLocalStatus.ok === true) {
    return {
      localCoreState: 'running' as const,
      localCoreStatusText: 'Local Core running',
    }
  }
  if (installState === 'installed') {
    return {
      localCoreState: 'installed' as const,
      localCoreStatusText: 'Local Core installed · stopped',
    }
  }
  if (installState === 'unsupported') {
    return {
      localCoreState: 'unsupported' as const,
      localCoreStatusText: 'Local Core detection unavailable',
    }
  }
  return {
    localCoreState: 'not-detected' as const,
    localCoreStatusText: 'Local Core not detected',
  }
}

function normalizeNodeSummary(
  network: NetworkId,
  rawSettings: unknown,
  rawStatus: unknown,
  rawLocalStatus: unknown,
  installState: HomeV2LocalCoreInstallState,
) {
  const settings = isRecord(rawSettings) ? rawSettings : {}
  const internalMode = stringField(settings, 'mode')
  const mode: NodeMode =
    internalMode === 'network'
      ? 'public'
      : internalMode === 'custom' ||
          internalMode === 'disabled' ||
          internalMode === 'public'
        ? internalMode
        : 'local'
  const statusResult = isRecord(rawStatus) ? rawStatus : {}
  const ok = statusResult.ok === true
  const disabled = mode === 'disabled' || statusResult.disabled === true
  const status = ok ? statusResult.status : null
  const nodeApiUrl =
    stringField(statusResult, 'nodeApiUrl') ??
    stringField(settings, 'nodeApiUrl')
  const error = disabled
    ? null
    : ok
      ? null
      : stringField(statusResult, 'message') ??
        stringField(settings, 'resolutionError') ??
        `Unable to reach the ${network === 'qortal' ? 'Qortal' : 'Qortium'} node.`
  const state = disabled ? 'offline' : ok ? getNodeState(status) : 'offline'
  const syncPercent = numberField(status, 'syncPercent')
  const statusText = disabled
    ? 'Disabled'
    : !ok
      ? mode === 'local'
        ? 'Not running'
        : 'Unavailable'
      : state === 'syncing'
        ? syncPercent === null
          ? 'Syncing'
          : `Syncing ${Math.round(syncPercent)}%`
        : 'Online'

  return {
    ref: `home-v2:node:${network}`,
    network,
    label:
      mode === 'public' && nodeApiUrl
        ? endpointHost(nodeApiUrl)
        : nodeApiUrl ?? `${modeLabel(mode)} node`,
    mode,
    state,
    statusText,
    isTrusted: mode === 'local',
    customConfigured: !!stringField(settings, 'customUrl'),
    customUrl: stringField(settings, 'customUrl'),
    ...localCoreSummary(installState, rawLocalStatus),
    nodeApiUrl: disabled ? null : nodeApiUrl,
    height: numberField(status, 'height'),
    peerCount:
      numberField(status, 'numberOfConnections') ??
      numberField(status, 'peerCount'),
    syncPercent,
    syncPhase: stringField(status, 'syncPhase'),
    lastCheckedAt: Date.now(),
    error,
    capabilities: {
      admin: false,
      read: ok,
      write: false,
    },
  }
}

async function buildSnapshot() {
  const [qortalSettings, qortiumSettings] = await Promise.all([
      getQortalNodeSettingsForHomeV2().catch((error: unknown) => ({
        mode: 'local',
        resolutionError: error instanceof Error ? error.message : 'Unable to read Qortal node settings.',
      })),
      getNodeSettingsForHomeV2().catch((error: unknown) => ({
        mode: 'local',
        resolutionError: error instanceof Error ? error.message : 'Unable to read Qortium node settings.',
      })),
    ])
  const qortalStatusPromise = getQortalNodeStatusForHomeV2().catch(
    (error: unknown) => ({
      ok: false,
      message:
        error instanceof Error ? error.message : 'Unable to read Qortal node status.',
    }),
  )
  const qortiumStatusPromise = getNodeStatusForHomeV2().catch(
    (error: unknown) => ({
      ok: false,
      message:
        error instanceof Error ? error.message : 'Unable to read Qortium node status.',
    }),
  )
  const [qortalStatus, qortalLocalStatus, qortiumStatus, qortiumLocalStatus] =
    await Promise.all([
      qortalStatusPromise,
      stringField(qortalSettings, 'mode') === 'local'
        ? qortalStatusPromise
        : getQortalLocalNodeStatusForHomeV2(),
      qortiumStatusPromise,
      stringField(qortiumSettings, 'mode') === 'local'
        ? qortiumStatusPromise
        : getLocalNodeStatusForHomeV2(),
    ])

  return {
    version: 1,
    nodes: {
      qortal: normalizeNodeSummary(
        'qortal',
        qortalSettings,
        qortalStatus,
        qortalLocalStatus,
        getHomeV2LocalCoreInstallState('qortal'),
      ),
      qortium: normalizeNodeSummary(
        'qortium',
        qortiumSettings,
        qortiumStatus,
        qortiumLocalStatus,
        getHomeV2LocalCoreInstallState('qortium'),
      ),
    },
  }
}

type HomeV2NodeSnapshot = Awaited<ReturnType<typeof buildSnapshot>>
let cachedSnapshot: { snapshot: HomeV2NodeSnapshot; storedAt: number } | null = null

async function getSnapshot() {
  const snapshot = await buildSnapshot()
  cachedSnapshot = { snapshot, storedAt: Date.now() }
  return snapshot
}

async function getRecentSnapshot() {
  if (
    cachedSnapshot &&
    Date.now() - cachedSnapshot.storedAt < SNAPSHOT_CACHE_MS
  ) {
    return cachedSnapshot.snapshot
  }
  return getSnapshot()
}

export async function getHomeV2ReadableNode(network: NetworkId) {
  const snapshot = await getRecentSnapshot()
  const node = snapshot.nodes[network]
  if (!node.capabilities.read || !node.nodeApiUrl) {
    throw new Error(node.error ?? `${network} node is unavailable.`)
  }
  return {
    mode: node.mode,
    nodeApiUrl: node.nodeApiUrl,
  }
}

async function readIdentity(network: NetworkId, requestValue: unknown) {
  const request = normalizeIdentityReadRequest(requestValue)
  const snapshot = await getRecentSnapshot()
  const node = snapshot.nodes[network]
  if (!node.capabilities.read || !node.nodeApiUrl) {
    return {
      data: { message: node.error ?? `${network} node is unavailable.` },
      status: 503,
    }
  }
  try {
    const response = await nodeFetch(`${node.nodeApiUrl}${identityPath(request)}`, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    })
    const text = await readBoundedText(response)
    let data: unknown = null
    if (text) {
      try {
        data = JSON.parse(text) as unknown
      } catch {
        data = { message: text.slice(0, 300) }
      }
    }
    return { data, status: response.status }
  } catch (error) {
    return {
      data: {
        message:
          error instanceof Error ? error.message : 'Identity lookup failed.',
      },
      status: 503,
    }
  }
}

async function listAppResources(network: NetworkId, nameValue: unknown) {
  const name = normalizeHomeV2AppResourceName(nameValue)
  const snapshot = await getRecentSnapshot()
  const node = snapshot.nodes[network]
  if (!node.capabilities.read || !node.nodeApiUrl) {
    throw new Error(node.error ?? `${network} node is unavailable.`)
  }
  const response = await nodeFetch(
    `${node.nodeApiUrl}${buildHomeV2AppResourceSearchPath(name)}`,
    { method: 'GET', signal: AbortSignal.timeout(5_000) },
  )
  const text = await readBoundedText(response)
  if (!response.ok) {
    throw new Error(`App resource search returned HTTP ${response.status}.`)
  }
  let data: unknown
  try {
    data = text ? JSON.parse(text) : []
  } catch {
    throw new Error('The node returned an invalid app resource list.')
  }
  return parseHomeV2AppResourceCandidates(data, name)
}

async function readAvatar(network: NetworkId, requestValue: unknown) {
  let request: ReturnType<typeof normalizeAvatarReadRequest>
  try {
    request = normalizeAvatarReadRequest(network, requestValue)
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : 'Avatar request is invalid.',
      status: 'unavailable' as const,
    }
  }
  const snapshot = await getRecentSnapshot()
  const node = snapshot.nodes[network]
  if (!node.capabilities.read || !node.nodeApiUrl) {
    return {
      message: node.error ?? `${network} node is unavailable.`,
      status: 'unavailable' as const,
    }
  }
  try {
    const response = await nodeFetch(`${node.nodeApiUrl}${request.path}`, {
      method: 'GET',
      signal: AbortSignal.timeout(8_000),
    })
    if (response.status === 202) {
      return {
        retryAfterSeconds: getGroupAvatarRetryAfterSeconds(
          response.headers.get('retry-after') ?? undefined,
        ),
        status: 'pending' as const,
      }
    }
    if (response.status === 404) {
      return request.legacyAsync
        ? { retryAfterSeconds: 2, status: 'pending' as const }
        : { status: 'missing' as const }
    }
    if (!response.ok) {
      return {
        message: `Avatar request returned HTTP ${response.status}.`,
        status: 'unavailable' as const,
      }
    }
    const bytes = await readBoundedBytes(response, GROUP_AVATAR_MAX_BYTES)
    const contentType = getAvatarImageContentType(
      response.headers.get('content-type') ?? undefined,
      bytes,
    )
    if (!contentType) {
      return {
        message: 'Avatar was not a supported image.',
        status: 'unavailable' as const,
      }
    }
    return {
      body: Buffer.from(bytes).toString('base64'),
      contentLength: bytes.byteLength,
      contentType,
      status: 'ready' as const,
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : 'Avatar request failed.',
      status: 'unavailable' as const,
    }
  }
}

export function authorizeHomeV2NodeBridge(sender: WebContents) {
  authorizedSenderIds.add(sender.id)
  sender.once('destroyed', () => authorizedSenderIds.delete(sender.id))
}

export function registerHomeV2NodeBridgeIpcHandlers() {
  ipcMain.handle('home-v2-nodes:getSnapshot', (event) => {
    assertAuthorized(event.sender)
    return getSnapshot()
  })
  ipcMain.handle('home-v2-accounts:list', (event) => {
    assertAuthorized(event.sender)
    return getHomeV2AccountCatalogue()
  })
  ipcMain.handle(
    'home-v2-nodes:listAppResources',
    (event, networkValue: unknown, nameValue: unknown) => {
      assertAuthorized(event.sender)
      return listAppResources(normalizeNetwork(networkValue), nameValue)
    },
  )
  ipcMain.handle('home-v2-shell:getState', (event) => {
    assertAuthorized(event.sender)
    return readHomeV2ShellState()
  })
  ipcMain.handle('home-v2-shell:saveState', (event, value: unknown) => {
    assertAuthorized(event.sender)
    writeHomeV2ShellState(value)
  })
  ipcMain.handle(
    'home-v2-nodes:readIdentity',
    (event, networkValue: unknown, requestValue: unknown) => {
      assertAuthorized(event.sender)
      return readIdentity(normalizeNetwork(networkValue), requestValue)
    },
  )
  ipcMain.handle(
    'home-v2-nodes:readAvatar',
    (event, networkValue: unknown, requestValue: unknown) => {
      assertAuthorized(event.sender)
      return readAvatar(normalizeNetwork(networkValue), requestValue)
    },
  )
  ipcMain.handle(
    'home-v2-nodes:setMode',
    async (event, networkValue: unknown, modeValue: unknown) => {
      assertAuthorized(event.sender)
      const network = normalizeNetwork(networkValue)
      const mode = normalizeMode(modeValue)
      if (network === 'qortal') {
        await saveQortalNodeModeForHomeV2(mode)
      } else {
        await saveNodeModeForHomeV2(mode)
      }
      cachedSnapshot = null
      return getSnapshot()
    },
  )
  ipcMain.handle(
    'home-v2-nodes:setCustomUrl',
    async (event, networkValue: unknown, customUrlValue: unknown) => {
      assertAuthorized(event.sender)
      const network = normalizeNetwork(networkValue)
      if (typeof customUrlValue !== 'string' || !customUrlValue.trim()) {
        throw new Error('Enter a custom node URL.')
      }
      if (network === 'qortal') {
        await saveQortalCustomUrlForHomeV2(customUrlValue)
      } else {
        await saveNodeCustomUrlForHomeV2(customUrlValue)
      }
      cachedSnapshot = null
      return getSnapshot()
    },
  )
}
