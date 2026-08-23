import { ipcMain } from 'electron'
import { assertAuthorizedHomeV2Sender } from './home-v2-authorized-senders.js'
import { getHomeV2ReadableNode } from './home-v2-node-bridge.js'
import { nodeFetch } from './node-tls.js'
import { requireCoreManagerEntry } from './core-manager.js'
import { readRunningLocalCoreApiKeyFor } from './local-api-key.js'

async function requestProtectedCore(
  network: 'qortal' | 'qortium',
  path: string,
  method: 'GET' | 'PATCH',
  body?: string,
) {
  const node = await getHomeV2ReadableNode(network)
  if (node.mode !== 'local') {
    throw new Error('Only the configured local Core can be changed from Home.')
  }
  const descriptor = requireCoreManagerEntry(network).descriptor
  const key = readRunningLocalCoreApiKeyFor({
    descriptor,
    fileAccess: 'read-only',
  })
  if (!key) throw new Error(`${descriptor.label} Core API key is unavailable.`)
  const response = await nodeFetch(new URL(path, `${node.nodeApiUrl}/`).toString(), {
    body,
    headers: {
      'accept-encoding': 'identity',
      'X-API-KEY': key.apiKey,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  const text = (await response.text()).slice(0, 4_096)
  if (!response.ok) {
    throw new Error(text || `${descriptor.label} Core returned HTTP ${response.status}.`)
  }
  return text
}

function normalizeNetwork(value: unknown) {
  if (value !== 'qortal' && value !== 'qortium') {
    throw new Error('Choose Qortal or Qortium documentation.')
  }
  return value
}

export function registerHomeV2CoreDocsBridgeIpcHandlers() {
  ipcMain.handle('home-v2-core-docs:probe', async (event, networkValue: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    const node = await getHomeV2ReadableNode(normalizeNetwork(networkValue))
    const response = await nodeFetch(
      new URL('/api-documentation/', `${node.nodeApiUrl}/`).toString(),
      {
        headers: { 'accept-encoding': 'identity' },
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      },
    )
    await response.body?.cancel()
    return { status: response.status }
  })
  ipcMain.handle('home-v2-core-docs:enable', async (event, networkValue: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    const network = normalizeNetwork(networkValue)
    const result = await requestProtectedCore(
      network,
      '/admin/settings',
      'PATCH',
      JSON.stringify({ apiDocumentationEnabled: true }),
    )
    if (result) {
      try {
        const parsed = JSON.parse(result) as { saved?: unknown }
        if (parsed.saved === false) throw new Error('The node declined the settings update.')
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
      }
    }
    await requestProtectedCore(network, '/admin/restart', 'GET')
    return { accepted: true }
  })
}
