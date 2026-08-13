import { app, BrowserWindow, ipcMain, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  getHomeV2ReadableNode,
  readHomeV2Avatar,
  readHomeV2Identity,
} from './home-v2-node-bridge.js'
import { nodeFetch } from './node-tls.js'
import {
  getQdnViewContextForWebContents,
  type QdnViewContext,
} from './qdn-views.js'
import { encodeQdnBridgeError, encodeQdnBridgeResult } from './qdn-bridge-error.js'
import {
  buildHomeV2AssetReadPath,
  buildHomeV2ChainReadPath,
  buildHomeV2NamePath,
  buildHomeV2ResourcePath,
  buildHomeV2ResourceRenderPath,
  getHomeV2AppActions,
  getHomeV2AppNetwork,
  HOME_V2_APP_LIMITS,
  isHomeV2AppRecord,
  isHomeV2ChainReadAction,
  normalizeHomeV2Address,
  normalizeHomeV2AppAction,
  normalizeHomeV2AppProtocol,
  normalizeHomeV2AvatarMaxBytes,
  normalizeHomeV2IdentityAddresses,
  normalizeHomeV2OpenAddress,
  normalizeHomeV2ReadMethod,
  normalizeHomeV2ReadPath,
  normalizeHomeV2ResponseMaxBytes,
  type HomeV2AppBridgeProtocol,
  type HomeV2AppNetwork,
} from './home-v2-app-actions.js'
import { getAccountProfile, isAccountUnlocked } from './accounts.js'
import {
  buildWidgetRenderUrl,
  discoverWidgetManifest,
  parseWidgetResourceIdentity,
} from './widget-discovery.js'
import { normalizeRegion } from './widget-region.js'
import {
  allocateWidgetId,
  assertWidgetCapacity,
  isWidgetTabId,
  registerWidget,
} from './widget-registry.js'
import { createWidgetWindow } from './widget-window.js'

export { getHomeV2AppActions as getHomeV2ReadOnlyAppActions }

type AccountReadAction = 'GET_SELECTED_ACCOUNT' | 'GET_USER_ACCOUNT' | 'UNLOCK_SELECTED_ACCOUNT'
type PermissionDecision = {
  readonly approved: boolean
  readonly scope: 'session' | 'single-request' | null
}

const pendingAccountReads = new Map<string, {
  readonly hostWebContentsId: number
  readonly resolve: (decision: PermissionDecision) => void
  readonly timeout: ReturnType<typeof setTimeout>
}>()
const sessionAccountReadGrants = new Set<string>()

function accountGrantKey(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  action: AccountReadAction,
  accountUnlocked: boolean,
  nodeRoute: string,
) {
  return [
    sender.id,
    context.tabId,
    context.accountId ?? 'none',
    context.resourceUrl ?? 'unknown-app',
    protocol,
    action,
    accountUnlocked,
    nodeRoute,
  ].join('|')
}

function sameViewContext(left: QdnViewContext, right: QdnViewContext) {
  return left.accountId === right.accountId &&
    left.resourceUrl === right.resourceUrl &&
    left.tabId === right.tabId &&
    left.windowId === right.windowId
}

async function requireAccountReadPermission(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  action: AccountReadAction,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const targetNetwork = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
  const nodeBefore = await getHomeV2ReadableNode(targetNetwork)
  const nodeRoute = `${nodeBefore.mode}|${nodeBefore.nodeApiUrl}`
  const accountUnlocked = isAccountUnlocked(context.accountId)
  const grantKey = accountGrantKey(
    sender,
    context,
    protocol,
    action,
    accountUnlocked,
    nodeRoute,
  )
  if (sessionAccountReadGrants.has(grantKey)) return
  const hostWindow = BrowserWindow.fromId(context.windowId)
  if (!hostWindow || hostWindow.isDestroyed()) {
    throw new Error('The app request does not belong to an active Home window.')
  }
  const requestId = randomUUID()
  const decision = await new Promise<PermissionDecision>((resolve) => {
    const timeout = setTimeout(() => {
      pendingAccountReads.delete(requestId)
      resolve({ approved: false, scope: null })
    }, 60_000)
    pendingAccountReads.set(requestId, {
      hostWebContentsId: hostWindow.webContents.id,
      resolve,
      timeout,
    })
    hostWindow.webContents.send('home-v2-app:permission-request', {
      accountId: context.accountId,
      action,
      appIdentityKey: context.resourceUrl ?? `home-v2-tab:${context.tabId}`,
      appTitle: context.resourceUrl ?? 'QDN app',
      protocol,
      requestId,
      resourceUrl: context.resourceUrl,
      tabId: context.tabId,
      targetNetwork,
    })
  })
  if (!decision.approved) throw new Error('Account access was denied.')
  const freshContext = getQdnViewContextForWebContents(sender)
  if (!freshContext || !sameViewContext(context, freshContext)) {
    throw new Error('Account access context changed before approval completed.')
  }
  if (action === 'UNLOCK_SELECTED_ACCOUNT') {
    if (!isAccountUnlocked(context.accountId)) {
      throw new Error('The account was not unlocked.')
    }
  } else if (isAccountUnlocked(context.accountId) !== accountUnlocked) {
    throw new Error('Account lock state changed before approval completed.')
  }
  const nodeAfter = await getHomeV2ReadableNode(targetNetwork)
  if (`${nodeAfter.mode}|${nodeAfter.nodeApiUrl}` !== nodeRoute) {
    throw new Error('Account access node route changed before approval completed.')
  }
  if (decision.scope === 'session') sessionAccountReadGrants.add(grantKey)
}

async function readBoundedResponse(
  response: Response,
  method: 'GET' | 'HEAD',
  maxBytes = HOME_V2_APP_LIMITS.responseBytes,
) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel()
    throw new Error('Node API response exceeded the requested size limit.')
  }
  let body = ''
  if (method !== 'HEAD' && response.body) {
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) {
        await reader.cancel()
        throw new Error('Node API response exceeded the requested size limit.')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    body = new TextDecoder().decode(bytes)
  }
  const contentType = response.headers.get('content-type') ?? ''
  let data: unknown = body
  if (body && (contentType.includes('json') || /^[\[{]/.test(body.trim()))) {
    try {
      data = JSON.parse(body) as unknown
    } catch {
      data = body
    }
  }
  return {
    body,
    contentLength: Number.isFinite(declared) ? declared : Buffer.byteLength(body, 'utf8'),
    contentType,
    data,
    headers: Object.fromEntries(response.headers.entries()),
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  }
}

async function fetchRead(
  network: HomeV2AppNetwork,
  path: string,
  method: 'GET' | 'HEAD',
  maxBytes = HOME_V2_APP_LIMITS.responseBytes,
) {
  const node = await getHomeV2ReadableNode(network)
  const response = await nodeFetch(`${node.nodeApiUrl}${path}`, {
    method,
    signal: AbortSignal.timeout(15_000),
  })
  return { node, result: await readBoundedResponse(response, method, maxBytes) }
}

function stringField(value: unknown, key: string) {
  if (!isHomeV2AppRecord(value)) return null
  const field = value[key]
  return typeof field === 'string' && field.trim() ? field.trim() : null
}

function responseDataOrThrow(
  result: Awaited<ReturnType<typeof fetchRead>>['result'],
  label: string,
) {
  if (!result.ok) throw new Error(`${label} returned HTTP ${result.status}.`)
  return result.data
}

async function readIdentityData(
  network: HomeV2AppNetwork,
  kind: 'accountAvatarInfo' | 'name' | 'namesByAddress' | 'primaryName',
  value: string,
) {
  const response = await readHomeV2Identity(network, { kind, value })
  if (response.status === 404) return null
  if (response.status !== 200) {
    throw new Error(`Identity lookup returned HTTP ${response.status}.`)
  }
  return response.data
}

async function resolveIdentities(request: Record<string, unknown>) {
  const addresses = normalizeHomeV2IdentityAddresses(request.addresses)
  return Promise.all(addresses.map(async (address) => {
    const [primary, owned] = await Promise.all([
      readIdentityData('qortium', 'primaryName', address),
      readIdentityData('qortium', 'namesByAddress', address),
    ])
    const primaryName = stringField(primary, 'name')
    const firstOwnedName = Array.isArray(owned)
      ? owned.map((entry) => stringField(entry, 'name')).find(Boolean) ?? null
      : null
    const name = primaryName ?? firstOwnedName
    return {
      address,
      name,
      avatarSrc: name
        ? `${(await getHomeV2ReadableNode('qortium')).nodeApiUrl}/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/avatar?async=true`
        : null,
      avatarContract: 'legacy-named-thumbnail',
    }
  }))
}

function translateAvatarResult(
  address: string,
  source: 'LEGACY' | 'POINTER',
  descriptor: { identifier: string; name: string; service: string } | null,
  result: Awaited<ReturnType<typeof readHomeV2Avatar>>,
  maxBytes: number,
) {
  if (result.status === 'pending') {
    return {
      address,
      descriptor,
      retryAfterSeconds: result.retryAfterSeconds,
      source,
      status: 'PENDING',
    }
  }
  if (result.status !== 'ready') throw new Error('Account avatar is not set.')
  if (result.contentLength > maxBytes) {
    throw new Error('Account avatar exceeded the requested size limit.')
  }
  return {
    address,
    body: result.body,
    contentLength: result.contentLength,
    contentType: result.contentType,
    descriptor,
    encoding: 'base64',
    source,
  }
}

async function fetchAccountAvatar(request: Record<string, unknown>) {
  const address = normalizeHomeV2Address(request.address)
  const maxBytes = normalizeHomeV2AvatarMaxBytes(request.maxBytes)
  const pointer = await readIdentityData('qortium', 'accountAvatarInfo', address)
  if (isHomeV2AppRecord(pointer)) {
    const service = stringField(pointer, 'service')
    const name = stringField(pointer, 'name')
    const identifier = stringField(pointer, 'identifier')
    if (service && name && identifier) {
      const descriptor = { identifier, name, service }
      return translateAvatarResult(
        address,
        'POINTER',
        descriptor,
        await readHomeV2Avatar('qortium', {
          address,
          pointer: { ...descriptor, source: 'account-pointer' },
        }),
        maxBytes,
      )
    }
  }
  const primary = await readIdentityData('qortium', 'primaryName', address)
  const name = stringField(primary, 'name')
  if (!name) throw new Error('Account avatar is not set.')
  const descriptor = { identifier: 'avatar', name, service: 'THUMBNAIL' }
  return translateAvatarResult(
    address,
    'LEGACY',
    null,
    await readHomeV2Avatar('qortium', {
      address,
      pointer: { ...descriptor, source: 'legacy-name' },
    }),
    maxBytes,
  )
}

const widgetGrants = new Set<string>()

// A widget floats above every other application, which QDN-published content
// cannot otherwise do, so opening one needs an explicit grant. The grant is
// remembered per app for the session rather than re-prompting on each open.
async function requireWidgetPermission(sender: WebContents, context: QdnViewContext) {
  const grantKey = context.resourceUrl ?? `home-v2-tab:${context.tabId}`
  if (widgetGrants.has(grantKey)) return

  const hostWindow = BrowserWindow.fromId(context.windowId)
  if (!hostWindow || hostWindow.isDestroyed()) {
    throw new Error('The app request does not belong to an active Home window.')
  }

  const requestId = randomUUID()
  const decision = await new Promise<PermissionDecision>((resolve) => {
    const timeout = setTimeout(() => {
      pendingAccountReads.delete(requestId)
      resolve({ approved: false, scope: null })
    }, 60_000)
    pendingAccountReads.set(requestId, {
      hostWebContentsId: hostWindow.webContents.id,
      resolve,
      timeout,
    })
    hostWindow.webContents.send('home-v2-app:permission-request', {
      accountId: context.accountId,
      action: 'OPEN_AS_WIDGET',
      appIdentityKey: grantKey,
      appTitle: context.resourceUrl ?? 'QDN app',
      protocol: 'qdnRequest',
      requestId,
      resourceUrl: context.resourceUrl,
      tabId: context.tabId,
      targetNetwork: 'qortium',
    })
  })

  if (!decision.approved) throw new Error('Opening a widget was denied.')

  const freshContext = getQdnViewContextForWebContents(sender)
  if (!freshContext || !sameViewContext(context, freshContext)) {
    throw new Error('The widget request context changed before approval completed.')
  }

  widgetGrants.add(grantKey)
}

async function handleOpenAsWidget(context: QdnViewContext): Promise<{ widgetId: string }> {
  if (isWidgetTabId(context.tabId)) {
    throw new Error('A widget cannot open another widget.')
  }
  if (!context.resourceUrl) {
    throw new Error('Only a published app can be opened as a widget.')
  }

  // Identity comes from the resource address rather than anything the app
  // sends, so an app cannot ask for a widget pointed at someone else's resource.
  const identity = parseWidgetResourceIdentity(context.resourceUrl)
  const appName = identity.identifier ? `${identity.name}/${identity.identifier}` : identity.name
  assertWidgetCapacity(appName)

  const manifest = await discoverWidgetManifest(identity, async (routePath) => {
    const response = await nodeFetch(`${context.nodeOrigin}${routePath}`, {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
    })
    return {
      ok: response.ok,
      status: response.status,
      text: response.ok ? await response.text() : '',
    }
  })
  if (!manifest) throw new Error('This app does not publish a widget.')

  const widgetId = allocateWidgetId()
  const window = createWidgetWindow({
    widgetId,
    manifest,
    renderUrl: buildWidgetRenderUrl(context.nodeOrigin, identity, manifest.entry),
    resourceUrl: context.resourceUrl,
    nodeOrigin: context.nodeOrigin,
    accountId: context.accountId,
  })

  registerWidget({
    widgetId,
    appName,
    resourceUrl: context.resourceUrl,
    manifest,
    windowId: window.id,
    region: normalizeRegion(manifest.shape),
  })

  return { widgetId }
}

// No permission prompt: an app closing its own widget can only ever remove one
// of its own windows.
function handleWidgetClose(context: QdnViewContext): { closed: boolean } {
  if (!isWidgetTabId(context.tabId)) {
    throw new Error('WIDGET_CLOSE is only available inside a widget.')
  }
  const window = BrowserWindow.fromId(context.windowId)
  if (!window || window.isDestroyed()) return { closed: false }
  window.close()
  return { closed: true }
}

async function handleRequest(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  requestValue: unknown,
) {
  if (!isHomeV2AppRecord(requestValue)) throw new Error('App requests must be objects.')
  const action = normalizeHomeV2AppAction(requestValue)
  const availableActions = getHomeV2AppActions(protocol)
  if (action === 'SHOW_ACTIONS') return [...availableActions]
  if (!availableActions.includes(action)) {
    throw new Error(`${action} is not available in Home v2 read-only mode.`)
  }
  if (action === 'WHICH_UI') return 'QORTIUM_HOME_ELECTRON'
  if (action === 'GET_HOST_INFO') {
    return {
      hostName: 'qortium-home',
      hostVersion: app.getVersion(),
      platform: 'desktop',
      platformVersion: '2.0',
    }
  }
  const network = getHomeV2AppNetwork(protocol, action)
  if (action === 'IS_USING_PUBLIC_NODE') {
    return (await getHomeV2ReadableNode(network)).mode === 'public'
  }
  if (action === 'OPEN_AS_WIDGET') {
    await requireWidgetPermission(sender, context)
    return handleOpenAsWidget(context)
  }
  if (action === 'WIDGET_CLOSE') {
    return handleWidgetClose(context)
  }
  if (action === 'OPEN_NEW_TAB') {
    const address = normalizeHomeV2OpenAddress(requestValue)
    const hostWindow = BrowserWindow.fromId(context.windowId)
    if (!hostWindow || hostWindow.isDestroyed()) {
      throw new Error('The app request does not belong to an active Home window.')
    }
    hostWindow.webContents.send('home-v2-app:open-address', {
      address,
      sourceTabId: context.tabId,
    })
    return true
  }
  if (action === 'GET_SELECTED_ACCOUNT' || action === 'GET_USER_ACCOUNT') {
    await requireAccountReadPermission(sender, context, protocol, action)
    const profile = await getAccountProfile(context.accountId as string)
    if (action === 'GET_USER_ACCOUNT') {
      const { result } = await fetchRead(
        'qortal',
        `/addresses/${encodeURIComponent(profile.address)}`,
        'GET',
        256 * 1024,
      )
      const accountData = responseDataOrThrow(result, 'Qortal account lookup')
      const publicKey = stringField(accountData, 'publicKey')
      return { address: profile.address, publicKey }
    }
    return {
      address: profile.address,
      avatarContract: 'pointer-aware-account-avatar-v1',
      avatarUrl: null,
      isUnlocked: isAccountUnlocked(context.accountId as string),
      name: profile.name,
    }
  }
  if (action === 'UNLOCK_SELECTED_ACCOUNT') {
    await requireAccountReadPermission(sender, context, protocol, action)
    const profile = await getAccountProfile(context.accountId as string)
    return {
      address: profile.address,
      avatarContract: 'pointer-aware-account-avatar-v1',
      avatarUrl: null,
      isUnlocked: true,
      name: profile.name,
    }
  }
  if (action === 'GET_NAME_DATA' || action === 'GET_ACCOUNT_NAMES' || action === 'GET_PRIMARY_NAME') {
    const path = buildHomeV2NamePath(action, requestValue)
    const { result } = await fetchRead(network, path, 'GET', normalizeHomeV2ResponseMaxBytes(requestValue.maxBytes))
    return responseDataOrThrow(result, `${action} request`)
  }
  if (action === 'GET_ACCOUNT_DATA' || action === 'GET_BALANCE') {
    const address = normalizeHomeV2Address(requestValue.address)
    const path = action === 'GET_BALANCE'
      ? `/addresses/balance/${encodeURIComponent(address)}`
      : `/addresses/${encodeURIComponent(address)}`
    const { result } = await fetchRead(
      network,
      path,
      'GET',
      normalizeHomeV2ResponseMaxBytes(requestValue.maxBytes),
    )
    return responseDataOrThrow(result, `${action} request`)
  }
  if (
    action === 'GET_ASSET_INFO' ||
    action === 'GET_ASSET_BALANCES' ||
    action === 'GET_ASSET_TRANSFERS'
  ) {
    const { result } = await fetchRead(
      network,
      buildHomeV2AssetReadPath(action, requestValue),
      'GET',
      normalizeHomeV2ResponseMaxBytes(requestValue.maxBytes),
    )
    return responseDataOrThrow(result, `${action} request`)
  }
  if (isHomeV2ChainReadAction(action)) {
    const path = buildHomeV2ChainReadPath(action, requestValue)
    const { result } = await fetchRead(
      network,
      path,
      'GET',
      normalizeHomeV2ResponseMaxBytes(requestValue.maxBytes),
    )
    // Both cores answer a valid-but-absent AT with an empty 2xx body (Qortal
    // 204s); normalize that to one documented error instead of returning ''.
    if (
      (action === 'GET_AT' || action === 'GET_AT_DATA') &&
      result.ok &&
      (result.status === 204 || result.data === '' || result.data === null)
    ) {
      throw new Error('AT not found.')
    }
    return responseDataOrThrow(result, `${action} request`)
  }
  if (action === 'RESOLVE_IDENTITIES') return resolveIdentities(requestValue)
  if (action === 'FETCH_ACCOUNT_AVATAR') return fetchAccountAvatar(requestValue)
  if (
    action === 'FETCH_QDN_RESOURCE' ||
    action === 'LIST_QDN_RESOURCES' ||
    action === 'SEARCH_QDN_RESOURCES' ||
    action === 'GET_QDN_RESOURCE_METADATA' ||
    action === 'GET_QDN_RESOURCE_PROPERTIES' ||
    action === 'GET_QDN_RESOURCE_STATUS'
  ) {
    const path = buildHomeV2ResourcePath(action, requestValue)
    const { result } = await fetchRead(
      network,
      path,
      'GET',
      normalizeHomeV2ResponseMaxBytes(requestValue.maxBytes),
    )
    return responseDataOrThrow(result, `${action} request`)
  }
  if (action === 'GET_QDN_RESOURCE_URL') {
    const statusPath = buildHomeV2ResourcePath('GET_QDN_RESOURCE_STATUS', requestValue)
    const { node, result } = await fetchRead(network, statusPath, 'GET')
    const status = responseDataOrThrow(result, 'QDN resource status request')
    if (!isHomeV2AppRecord(status) || !status.status || status.status === 'NOT_PUBLISHED') {
      throw new Error('Resource does not exist.')
    }
    return `${node.nodeApiUrl}${buildHomeV2ResourceRenderPath(requestValue, context.displaySettings)}`
  }
  const path =
    action === 'GET_NODE_STATUS'
      ? '/admin/status'
      : action === 'GET_NODE_INFO'
        ? '/admin/info'
        : action === 'FETCH_NODE_API' || action === 'FETCH_QORTAL_NODE_API'
          ? normalizeHomeV2ReadPath(requestValue.path)
          : null
  if (!path) throw new Error(`${action} is not available in Home v2 read-only mode.`)
  const method = normalizeHomeV2ReadMethod(requestValue.method)
  const { result } = await fetchRead(
    network,
    path,
    method,
    normalizeHomeV2ResponseMaxBytes(requestValue.maxBytes),
  )
  if (action === 'GET_NODE_STATUS' || action === 'GET_NODE_INFO') {
    if (!result.ok) throw new Error(`Node request returned HTTP ${result.status}.`)
    return result.data
  }
  return result
}

export function registerHomeV2AppBridgeIpcHandlers() {
  ipcMain.on('home-v2-app:account-locked', (event) => {
    sessionAccountReadGrants.clear()
    widgetGrants.clear()
    for (const [requestId, pending] of pendingAccountReads) {
      if (pending.hostWebContentsId !== event.sender.id) continue
      pendingAccountReads.delete(requestId)
      clearTimeout(pending.timeout)
      pending.resolve({ approved: false, scope: null })
    }
  })
  ipcMain.on('home-v2-app:permission-resolve', (event, value: unknown) => {
    if (!isHomeV2AppRecord(value) || typeof value.requestId !== 'string') return
    const pending = pendingAccountReads.get(value.requestId)
    if (!pending || pending.hostWebContentsId !== event.sender.id) return
    pendingAccountReads.delete(value.requestId)
    clearTimeout(pending.timeout)
    const approved = value.approved === true
    const scope = value.scope === 'session' ? 'session' : 'single-request'
    pending.resolve({ approved, scope: approved ? scope : null })
  })
  ipcMain.handle(
    'home-v2-app:request',
    async (event, protocolValue: unknown, request: unknown) => {
      try {
        const context = getQdnViewContextForWebContents(event.sender)
        if (!context) {
          throw new Error('Home v2 app requests require an isolated app view.')
        }
        return encodeQdnBridgeResult(
          await handleRequest(
            event.sender,
            context,
            normalizeHomeV2AppProtocol(protocolValue),
            request,
          ),
        )
      } catch (error) {
        return encodeQdnBridgeError(error)
      }
    },
  )
}
