import { ipcMain } from 'electron'
import { assertAuthorizedHomeV2Sender } from './home-v2-authorized-senders.js'
import { getHomeV2ReadableNode } from './home-v2-node-bridge.js'
import { nodeFetch } from './node-tls.js'
import { resolveHomeV2AdminNode } from './home-v2-app-bridge.js'
import {
  enableHomeV2CoreApiDocs,
  type HomeV2CoreDocsAdminDependencies,
} from './home-v2-core-docs-admin.js'

/**
 * The IPC skin over home-v2-core-docs-admin.
 *
 * Trust and ordering live in that module (and are tested there); this supplies
 * the two things it cannot have without Electron: the real trust resolver, and
 * the real HTTP call. The call keeps `redirect: 'error'` — it carries the
 * node's administrative API key, and a redirect would hand that key to a host
 * nothing vetted.
 */
const coreDocsAdmin: HomeV2CoreDocsAdminDependencies = {
  async resolveAdminNode(network) {
    const resolved = await resolveHomeV2AdminNode(network)
    return {
      apiKey: resolved.apiKey,
      nodeApiUrl: resolved.node.nodeApiUrl,
      trust: resolved.trust,
    }
  },
  async request({ apiKey, body, method, nodeApiUrl, path }) {
    const response = await nodeFetch(new URL(path, `${nodeApiUrl}/`).toString(), {
      body,
      headers: {
        'accept-encoding': 'identity',
        'X-API-KEY': apiKey,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    return {
      ok: response.ok,
      status: response.status,
      text: (await response.text()).slice(0, 4_096),
    }
  },
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
    return enableHomeV2CoreApiDocs(normalizeNetwork(networkValue), coreDocsAdmin)
  })
}
