import { app, ipcMain } from 'electron'
import path from 'node:path'
import { assertAuthorizedHomeV2Sender } from './home-v2-authorized-senders.js'
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
  getAvatarDescriptorFromHeaders,
  getAvatarImageContentType,
  getGroupAvatarRetryAfterSeconds,
  GROUP_AVATAR_MAX_BYTES,
} from './qdn-group-avatar-input.js'
import {
  addDerivedAddress,
  createWallet,
  discardLoadedWallet,
  exportWallet,
  getAddressFromPrivateKey,
  getHomeV2AccountCatalogue,
  getHomeV2VaultState,
  importPrivateKeyWallet,
  lockHomeV2Account,
  removeWallet,
  renameHomeV2Account,
  saveLoadedWallet,
  selectHomeV2Account,
  selectWalletFile,
  unlockHomeV2Account,
  updateHomeV2SecuritySettings,
} from './accounts.js'
import { ensureHomeV2ProfileBackup, requestHomeV2ProfileRestore } from './home-v2-profile-recovery.js'
import {
  readHomeV2ShellState,
  writeHomeV2ShellGlobalState,
  writeHomeV2ShellState,
} from './home-v2-shell-store.js'
import {
  buildHomeV2AppResourceSearchPath,
  buildHomeV2ResourceSignatureSearchPath,
  normalizeHomeV2AppResourceName,
  normalizeHomeV2AppResourceService,
  parseHomeV2AppResourceCandidates,
  parseHomeV2ResourceLatestSignature,
  type HomeV2ResourceSignatureQuery,
} from './home-v2-app-resource-discovery.js'
import {
  createHomeV2ImageMemo,
  HomeV2ImageCache,
  HOME_V2_IMAGE_CACHE_DIR_NAME,
  readImageThroughCache,
  type HomeV2CachedImageOutcome,
  type HomeV2ImageFetchOutcome,
} from './home-v2-image-cache.js'
import {
  buildHomeV2IdentityReadPath,
} from './home-v2-identity-read.js'
import {
  buildHomeV2AppIconPath,
  getHomeV2AppIconContentType,
  HOME_V2_APP_ICON_MAX_BYTES,
  normalizeHomeV2AppIconReadRequest,
} from './home-v2-app-icon.js'

type NetworkId = 'qortal' | 'qortium'
type NodeMode = 'custom' | 'disabled' | 'local' | 'public'
const IDENTITY_RESPONSE_LIMIT = 256 * 1024
const SNAPSHOT_CACHE_MS = 30_000

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

function requiredString(value: unknown, field: string, maxLength = 240) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${field} is required.`)
  }
  return value.trim()
}

function nullableId(value: unknown, field: string) {
  if (value === null) return null
  return requiredString(value, field)
}

function assertMatchingPasswords(password: unknown, confirmation: unknown) {
  const nextPassword = requiredString(password, 'Password', 1_000)
  if (nextPassword !== confirmation) throw new Error('Passwords do not match.')
  return nextPassword
}

function prepareAccountMutation() {
  ensureHomeV2ProfileBackup()
  if (getHomeV2VaultState().readiness !== 'ready') {
    throw new Error('Account changes are unavailable until profile recovery is complete.')
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
    kind !== 'legacyAvatarResource' &&
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
    // The pointer still names the on-chain resource the address resolves to, so
    // it is the stable identity the image cache content-addresses.
    return {
      address,
      legacyAsync: false,
      path: buildAccountAvatarPath(address),
      descriptor: { service, name, identifier },
    }
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
    descriptor: { service, name, identifier },
  }
}

async function readBoundedBytes(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('Image exceeded the configured size limit.')
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
      throw new Error('Image exceeded the configured size limit.')
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
  const internalLastEnabledMode = stringField(settings, 'lastEnabledMode')
  const lastEnabledMode: Exclude<NodeMode, 'disabled'> =
    internalLastEnabledMode === 'network'
      ? 'public'
      : internalLastEnabledMode === 'custom' ||
          internalLastEnabledMode === 'public' ||
          internalLastEnabledMode === 'local'
        ? internalLastEnabledMode
        : mode === 'disabled'
          ? 'local'
          : mode
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
    lastEnabledMode,
    mode,
    state,
    statusText,
    isTrusted: mode === 'local',
    customAuthenticated:
      mode === 'custom' && settings.customAuthenticated === true,
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
        lastEnabledMode: 'local',
        mode: 'disabled',
        resolutionError: error instanceof Error ? error.message : 'Unable to read Qortal node settings.',
      })),
      getNodeSettingsForHomeV2().catch((error: unknown) => ({
        lastEnabledMode: 'local',
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
      stringField(qortalSettings, 'mode') === 'disabled'
        ? null
        : stringField(qortalSettings, 'mode') === 'local'
          ? qortalStatusPromise
          : getQortalLocalNodeStatusForHomeV2(),
      qortiumStatusPromise,
      stringField(qortiumSettings, 'mode') === 'disabled'
        ? null
        : stringField(qortiumSettings, 'mode') === 'local'
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

export async function getHomeV2AppNodeState(network: NetworkId) {
  return (await getRecentSnapshot()).nodes[network]
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

export async function readHomeV2Identity(network: NetworkId, requestValue: unknown) {
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
    const response = await nodeFetch(
      `${node.nodeApiUrl}${buildHomeV2IdentityReadPath(network, request)}`,
      {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      },
    )
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

async function listAppResources(
  network: NetworkId,
  nameValue: unknown,
  serviceValue?: unknown,
) {
  const name = normalizeHomeV2AppResourceName(nameValue)
  // Validated here (not just trusted from the renderer) because it is
  // interpolated straight into the node search query.
  const service = normalizeHomeV2AppResourceService(serviceValue)
  const snapshot = await getRecentSnapshot()
  const node = snapshot.nodes[network]
  if (!node.capabilities.read || !node.nodeApiUrl) {
    throw new Error(node.error ?? `${network} node is unavailable.`)
  }
  const response = await nodeFetch(
    `${node.nodeApiUrl}${buildHomeV2AppResourceSearchPath(name, service)}`,
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

// R4-7 pass 2: the persistent main-process image cache. One store on disk under
// userData is shared by every renderer, every detached window, and every
// restart, so a favicon or avatar is fetched from the node once per signature
// instead of once per surface. Six hours is only how often the cheap signature
// search re-runs; a republish (new signature) still invalidates immediately.
const IMAGE_SIGNATURE_REVALIDATE_MS = 6 * 60 * 60 * 1000

let cachedImageStore: HomeV2ImageCache | null = null
function imageStore(): HomeV2ImageCache {
  if (!cachedImageStore) {
    cachedImageStore = new HomeV2ImageCache({
      directory: path.join(app.getPath('userData'), HOME_V2_IMAGE_CACHE_DIR_NAME),
    })
  }
  return cachedImageStore
}

const appIconImageMemo = createHomeV2ImageMemo(256)
const avatarImageMemo = createHomeV2ImageMemo(256)

type ReadableNode = { readonly nodeApiUrl: string }

// The cheap signature read. Best-effort: any failure returns null and the
// caller falls back to an uncached fetch rather than caching wrong bytes.
async function resolveLatestSignature(
  node: ReadableNode,
  resource: HomeV2ResourceSignatureQuery,
): Promise<string | null> {
  try {
    const response = await nodeFetch(
      `${node.nodeApiUrl}${buildHomeV2ResourceSignatureSearchPath(resource)}`,
      { method: 'GET', signal: AbortSignal.timeout(5_000) },
    )
    if (!response.ok) return null
    const text = await readBoundedText(response)
    const data: unknown = text ? JSON.parse(text) : []
    return parseHomeV2ResourceLatestSignature(data, resource)
  } catch {
    return null
  }
}

type AvatarDescriptorValue = { service: string; name: string; identifier: string }

async function fetchHomeV2AvatarBytes(
  node: ReadableNode,
  avatarPath: string,
): Promise<HomeV2ImageFetchOutcome> {
  try {
    const response = await nodeFetch(`${node.nodeApiUrl}${avatarPath}`, {
      method: 'GET',
      signal: AbortSignal.timeout(8_000),
    })
    if (response.status === 202) {
      return {
        kind: 'pending',
        meta: {
          descriptor: getAvatarDescriptorFromHeaders(
            (name) => response.headers.get(name) ?? undefined,
          ),
          retryAfterSeconds: getGroupAvatarRetryAfterSeconds(
            response.headers.get('retry-after') ?? undefined,
          ),
        },
      }
    }
    if (response.status === 404) return { kind: 'missing' }
    if (!response.ok) {
      return { kind: 'unavailable', message: `Avatar request returned HTTP ${response.status}.` }
    }
    const bytes = await readBoundedBytes(response, GROUP_AVATAR_MAX_BYTES)
    const contentType = getAvatarImageContentType(
      response.headers.get('content-type') ?? undefined,
      bytes,
    )
    if (!contentType) {
      return { kind: 'unavailable', message: 'Avatar was not a supported image.' }
    }
    return {
      kind: 'ready',
      bytes,
      contentType,
      meta: {
        descriptor: getAvatarDescriptorFromHeaders(
          (name) => response.headers.get(name) ?? undefined,
        ),
      },
    }
  } catch (error) {
    return {
      kind: 'unavailable',
      message: error instanceof Error ? error.message : 'Avatar request failed.',
    }
  }
}

function mapAvatarOutcome(
  outcome: HomeV2ImageFetchOutcome | HomeV2CachedImageOutcome,
  fallbackDescriptor: AvatarDescriptorValue | null,
) {
  switch (outcome.kind) {
    case 'ready':
      return {
        body: Buffer.from(outcome.bytes).toString('base64'),
        contentLength: outcome.bytes.byteLength,
        contentType: outcome.contentType,
        descriptor:
          (outcome.meta?.descriptor as AvatarDescriptorValue | null | undefined) ??
          fallbackDescriptor,
        status: 'ready' as const,
      }
    case 'pending':
      return {
        descriptor:
          (outcome.meta?.descriptor as AvatarDescriptorValue | null | undefined) ??
          fallbackDescriptor,
        retryAfterSeconds: (outcome.meta?.retryAfterSeconds as number | null | undefined) ?? null,
        status: 'pending' as const,
      }
    case 'missing':
      return { status: 'missing' as const }
    case 'unavailable':
      return { message: outcome.message, status: 'unavailable' as const }
  }
}

export async function readHomeV2Avatar(network: NetworkId, requestValue: unknown) {
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
  const readable: ReadableNode = { nodeApiUrl: node.nodeApiUrl }
  const outcome = await readImageThroughCache({
    store: imageStore(),
    memo: avatarImageMemo,
    cacheKey: `avatar|${network}|${request.descriptor.service}|${request.descriptor.name}|${request.descriptor.identifier}`,
    maxEntryBytes: GROUP_AVATAR_MAX_BYTES,
    revalidateFloorMs: IMAGE_SIGNATURE_REVALIDATE_MS,
    resolveSignature: () => resolveLatestSignature(readable, request.descriptor),
    fetchImage: () => fetchHomeV2AvatarBytes(readable, request.path),
  })
  return mapAvatarOutcome(outcome, request.descriptor)
}

// The uncached avatar fetch primitive, still used directly by the QDN app
// bridge (which passes only a resolved path and has no descriptor to key on).
export async function readResolvedHomeV2Avatar(
  network: NetworkId,
  request: { readonly legacyAsync: boolean; readonly path: string },
) {
  const snapshot = await getRecentSnapshot()
  const node = snapshot.nodes[network]
  if (!node.capabilities.read || !node.nodeApiUrl) {
    return {
      message: node.error ?? `${network} node is unavailable.`,
      status: 'unavailable' as const,
    }
  }
  return mapAvatarOutcome(
    await fetchHomeV2AvatarBytes({ nodeApiUrl: node.nodeApiUrl }, request.path),
    null,
  )
}

async function fetchHomeV2AppIconBytes(
  node: ReadableNode,
  request: ReturnType<typeof normalizeHomeV2AppIconReadRequest>,
): Promise<HomeV2ImageFetchOutcome> {
  try {
    const response = await nodeFetch(
      `${node.nodeApiUrl}${buildHomeV2AppIconPath(request)}`,
      { method: 'GET', signal: AbortSignal.timeout(8_000) },
    )
    if (response.status === 202) {
      return {
        kind: 'pending',
        meta: {
          retryAfterSeconds: getGroupAvatarRetryAfterSeconds(
            response.headers.get('retry-after') ?? undefined,
          ),
        },
      }
    }
    if (response.status === 404) return { kind: 'missing' }
    if (!response.ok) {
      return { kind: 'unavailable', message: `App icon request returned HTTP ${response.status}.` }
    }
    const bytes = await readBoundedBytes(response, HOME_V2_APP_ICON_MAX_BYTES)
    const contentType = getHomeV2AppIconContentType(bytes)
    // No recognized image type is treated as "this resource has no icon", which
    // the negative cache remembers so the missing favicon stops costing fetches.
    if (!contentType) return { kind: 'missing' }
    return { kind: 'ready', bytes, contentType, meta: {} }
  } catch (error) {
    return {
      kind: 'unavailable',
      message: error instanceof Error ? error.message : 'App icon request failed.',
    }
  }
}

function mapAppIconOutcome(outcome: HomeV2CachedImageOutcome) {
  switch (outcome.kind) {
    case 'ready':
      return {
        body: Buffer.from(outcome.bytes).toString('base64'),
        contentLength: outcome.bytes.byteLength,
        contentType: outcome.contentType,
        status: 'ready' as const,
      }
    case 'pending':
      return {
        retryAfterSeconds: (outcome.meta.retryAfterSeconds as number | null | undefined) ?? null,
        status: 'pending' as const,
      }
    case 'missing':
      return { status: 'missing' as const }
    case 'unavailable':
      return { message: outcome.message, status: 'unavailable' as const }
  }
}

export async function readHomeV2AppIcon(network: NetworkId, requestValue: unknown) {
  let request: ReturnType<typeof normalizeHomeV2AppIconReadRequest>
  try {
    request = normalizeHomeV2AppIconReadRequest(requestValue)
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : 'App icon request is invalid.',
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
  const readable: ReadableNode = { nodeApiUrl: node.nodeApiUrl }
  const resource: HomeV2ResourceSignatureQuery = {
    service: request.service,
    name: request.name,
    identifier: request.identifier,
  }
  const outcome = await readImageThroughCache({
    store: imageStore(),
    memo: appIconImageMemo,
    cacheKey: `appicon|${network}|${request.service}|${request.name}|${request.identifier ?? 'default'}`,
    maxEntryBytes: HOME_V2_APP_ICON_MAX_BYTES,
    revalidateFloorMs: IMAGE_SIGNATURE_REVALIDATE_MS,
    resolveSignature: () => resolveLatestSignature(readable, resource),
    fetchImage: () => fetchHomeV2AppIconBytes(readable, request),
  })
  return mapAppIconOutcome(outcome)
}

export function registerHomeV2NodeBridgeIpcHandlers() {
  ipcMain.handle('home-v2-nodes:getSnapshot', (event) => {
    assertAuthorizedHomeV2Sender(event)
    return getSnapshot()
  })
  ipcMain.handle('home-v2-accounts:list', (event) => {
    assertAuthorizedHomeV2Sender(event)
    return getHomeV2AccountCatalogue()
  })
  ipcMain.handle('home-v2-vault:getState', (event) => {
    assertAuthorizedHomeV2Sender(event)
    return getHomeV2VaultState()
  })
  ipcMain.handle('home-v2-vault:select', (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    if (!isRecord(value)) throw new Error('Account selection is required.')
    prepareAccountMutation()
    return selectHomeV2Account(
      nullableId(value.accountId, 'Account'),
      nullableId(value.addressId, 'Address'),
    )
  })
  ipcMain.handle('home-v2-vault:selectWalletFile', (event) => {
    assertAuthorizedHomeV2Sender(event)
    return selectWalletFile(event)
  })
  ipcMain.handle('home-v2-vault:discardLoadedWallet', (event, token: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    discardLoadedWallet(requiredString(token, 'Import token'))
  })
  ipcMain.handle('home-v2-vault:saveLoadedWallet', (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    if (!isRecord(value)) throw new Error('Wallet import details are required.')
    prepareAccountMutation()
    saveLoadedWallet(
      requiredString(value.token, 'Import token'),
      requiredString(value.label, 'Account label', 120),
    )
    return getHomeV2VaultState()
  })
  ipcMain.handle('home-v2-vault:create', async (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    if (!isRecord(value)) throw new Error('New account details are required.')
    const password = assertMatchingPasswords(value.password, value.passwordConfirmation)
    prepareAccountMutation()
    const result = await createWallet(event, requiredString(value.label, 'Account label', 120), password)
    return { canceled: result.canceled, state: getHomeV2VaultState() }
  })
  ipcMain.handle('home-v2-vault:getPrivateKeyAddress', (event, privateKey: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    return getAddressFromPrivateKey(requiredString(privateKey, 'Private key', 256))
  })
  ipcMain.handle('home-v2-vault:importPrivateKey', async (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    if (!isRecord(value)) throw new Error('Private-key import details are required.')
    const password = assertMatchingPasswords(value.password, value.passwordConfirmation)
    prepareAccountMutation()
    const result = await importPrivateKeyWallet(
      event,
      requiredString(value.label, 'Account label', 120),
      requiredString(value.privateKey, 'Private key', 256),
      password,
    )
    return { canceled: result.canceled, state: getHomeV2VaultState() }
  })
  ipcMain.handle('home-v2-vault:export', async (event, accountId: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    return exportWallet(event, requiredString(accountId, 'Account'))
  })
  ipcMain.handle('home-v2-vault:rename', (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    if (!isRecord(value)) throw new Error('Account rename details are required.')
    prepareAccountMutation()
    return renameHomeV2Account(
      requiredString(value.accountId, 'Account'),
      requiredString(value.label, 'Account label', 120),
    )
  })
  ipcMain.handle('home-v2-vault:addAddress', (event, accountId: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    prepareAccountMutation()
    addDerivedAddress(requiredString(accountId, 'Account'))
    return getHomeV2VaultState()
  })
  ipcMain.handle('home-v2-vault:removeAddress', async (event, addressId: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    prepareAccountMutation()
    await removeWallet(requiredString(addressId, 'Address'))
    return getHomeV2VaultState()
  })
  ipcMain.handle('home-v2-vault:removeAccount', async (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    if (!isRecord(value)) throw new Error('Account removal details are required.')
    prepareAccountMutation()
    await removeWallet(
      requiredString(value.accountId, 'Account'),
      typeof value.password === 'string' ? value.password : undefined,
    )
    return getHomeV2VaultState()
  })
  ipcMain.handle('home-v2-vault:unlock', async (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    if (!isRecord(value)) throw new Error('Account unlock details are required.')
    prepareAccountMutation()
    return unlockHomeV2Account({
      accountId: requiredString(value.accountId, 'Account'),
      password: typeof value.password === 'string' ? value.password : undefined,
      useRememberedUnlock: value.useRememberedUnlock === true,
    })
  })
  ipcMain.handle('home-v2-vault:lock', (event, accountId: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    prepareAccountMutation()
    return lockHomeV2Account(requiredString(accountId, 'Account'), true)
  })
  ipcMain.handle('home-v2-vault:updateSecurity', async (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    if (!isRecord(value)) throw new Error('Account security settings are required.')
    prepareAccountMutation()
    return updateHomeV2SecuritySettings({
      accountId: requiredString(value.accountId, 'Account'),
      lockOnExit: typeof value.lockOnExit === 'boolean' ? value.lockOnExit : undefined,
      password: typeof value.password === 'string' ? value.password : undefined,
      rememberUnlock: typeof value.rememberUnlock === 'boolean' ? value.rememberUnlock : undefined,
    })
  })
  ipcMain.handle('home-v2-vault:requestRestore', (event) => {
    assertAuthorizedHomeV2Sender(event)
    requestHomeV2ProfileRestore()
    return { restartRequired: true }
  })
  ipcMain.handle(
    'home-v2-nodes:listAppResources',
    (event, networkValue: unknown, nameValue: unknown, serviceValue?: unknown) => {
      assertAuthorizedHomeV2Sender(event)
      return listAppResources(normalizeNetwork(networkValue), nameValue, serviceValue)
    },
  )
  ipcMain.handle('home-v2-shell:getState', (event) => {
    assertAuthorizedHomeV2Sender(event)
    return readHomeV2ShellState()
  })
  ipcMain.handle('home-v2-shell:saveState', (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    writeHomeV2ShellState(value)
  })
  // Used by detached windows, whose tab strip is session-only: it persists
  // settings without overwriting the primary window's tabs.
  ipcMain.handle('home-v2-shell:saveGlobalState', (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    writeHomeV2ShellGlobalState(value)
  })
  ipcMain.handle(
    'home-v2-nodes:readIdentity',
    (event, networkValue: unknown, requestValue: unknown) => {
      assertAuthorizedHomeV2Sender(event)
      return readHomeV2Identity(normalizeNetwork(networkValue), requestValue)
    },
  )
  ipcMain.handle(
    'home-v2-nodes:readAvatar',
    (event, networkValue: unknown, requestValue: unknown) => {
      assertAuthorizedHomeV2Sender(event)
      return readHomeV2Avatar(normalizeNetwork(networkValue), requestValue)
    },
  )
  ipcMain.handle(
    'home-v2-nodes:readAppIcon',
    (event, networkValue: unknown, requestValue: unknown) => {
      assertAuthorizedHomeV2Sender(event)
      return readHomeV2AppIcon(normalizeNetwork(networkValue), requestValue)
    },
  )
  ipcMain.handle(
    'home-v2-nodes:setMode',
    async (event, networkValue: unknown, modeValue: unknown) => {
      assertAuthorizedHomeV2Sender(event)
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
      assertAuthorizedHomeV2Sender(event)
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
