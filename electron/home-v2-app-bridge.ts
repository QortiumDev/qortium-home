import { app, ipcMain } from 'electron'
import { getHomeV2ReadableNode } from './home-v2-node-bridge.js'
import { nodeFetch } from './node-tls.js'
import { getQdnViewContextForWebContents } from './qdn-views.js'
import { encodeQdnBridgeError, encodeQdnBridgeResult } from './qdn-bridge-error.js'

type NetworkId = 'qortal' | 'qortium'
type Protocol = 'qdnRequest' | 'qortalRequest'

const RESPONSE_MAX_BYTES = 2 * 1024 * 1024
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeProtocol(value: unknown): Protocol {
  if (value !== 'qdnRequest' && value !== 'qortalRequest') {
    throw new Error('Unknown Home v2 app protocol.')
  }
  return value
}

function normalizeAction(request: Record<string, unknown>) {
  const action = typeof request.action === 'string' ? request.action.trim().toUpperCase() : ''
  if (!action) throw new Error('App request action is required.')
  return action
}

function normalizeReadMethod(value: unknown): 'GET' | 'HEAD' {
  const method = typeof value === 'string' ? value.toUpperCase() : 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    throw new Error('Home v2 apps can only use GET or HEAD node reads.')
  }
  return method
}

function normalizeReadPath(value: unknown) {
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

async function readBoundedResponse(response: Response, method: 'GET' | 'HEAD') {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > RESPONSE_MAX_BYTES) {
    await response.body?.cancel()
    throw new Error('Node API response exceeded the 2 MiB limit.')
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
      if (length > RESPONSE_MAX_BYTES) {
        await reader.cancel()
        throw new Error('Node API response exceeded the 2 MiB limit.')
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

async function fetchRead(network: NetworkId, path: string, method: 'GET' | 'HEAD') {
  const node = await getHomeV2ReadableNode(network)
  const response = await nodeFetch(`${node.nodeApiUrl}${path}`, {
    method,
    signal: AbortSignal.timeout(15_000),
  })
  return { node, result: await readBoundedResponse(response, method) }
}

async function handleRequest(protocol: Protocol, requestValue: unknown) {
  if (!isRecord(requestValue)) throw new Error('App requests must be objects.')
  const action = normalizeAction(requestValue)
  if (action === 'SHOW_ACTIONS') return [...HOME_V2_READ_ONLY_APP_ACTIONS]
  if (action === 'WHICH_UI') return 'QORTIUM_HOME_ELECTRON'
  if (action === 'GET_HOST_INFO') {
    return {
      hostName: 'qortium-home',
      hostVersion: app.getVersion(),
      platform: 'desktop',
      platformVersion: '2.0-preview',
    }
  }
  const network: NetworkId =
    action === 'FETCH_QORTAL_NODE_API' || protocol === 'qortalRequest'
      ? 'qortal'
      : 'qortium'
  if (action === 'IS_USING_PUBLIC_NODE') {
    return (await getHomeV2ReadableNode(network)).mode === 'public'
  }
  const path =
    action === 'GET_NODE_STATUS'
      ? '/admin/status'
      : action === 'GET_NODE_INFO'
        ? '/admin/info'
        : action === 'FETCH_NODE_API' || action === 'FETCH_QORTAL_NODE_API'
          ? normalizeReadPath(requestValue.path)
          : null
  if (!path) throw new Error(`${action} is not available in Home v2 read-only mode.`)
  const method = normalizeReadMethod(requestValue.method)
  const { result } = await fetchRead(network, path, method)
  if (action === 'GET_NODE_STATUS' || action === 'GET_NODE_INFO') {
    if (!result.ok) throw new Error(`Node request returned HTTP ${result.status}.`)
    return result.data
  }
  return result
}

export function registerHomeV2AppBridgeIpcHandlers() {
  ipcMain.handle(
    'home-v2-app:request',
    async (event, protocolValue: unknown, request: unknown) => {
      try {
        if (!getQdnViewContextForWebContents(event.sender)) {
          throw new Error('Home v2 app requests require an isolated app view.')
        }
        return encodeQdnBridgeResult(
          await handleRequest(normalizeProtocol(protocolValue), request),
        )
      } catch (error) {
        return encodeQdnBridgeError(error)
      }
    },
  )
}
