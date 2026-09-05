import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { assertAuthorizedHomeV2Sender } from './home-v2-authorized-senders.js'
import { readHomeV2DesktopResourceStreamBytes } from './home-v2-desktop-resource-stream.js'
import { issueHomeV2DesktopResourceStream } from './home-v2-desktop-resource-stream.js'
import { getHomeV2ReadableNode } from './home-v2-node-bridge.js'
import { nodeFetch } from './node-tls.js'
import { parseViewerLocation } from './home-v2-viewer-location.js'
import { readPublicViewerJson, resolvePublicViewer } from './home-v2-public-viewer.js'

const RETAINED_VIEWER_MAX_BYTES = 100 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function suggestedFilename(value: unknown) {
  if (typeof value !== 'string') return 'qdn-resource'
  const leaf = value.split(/[\\/]/).pop()?.trim() ?? ''
  const safe = leaf
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 180)
  return safe || 'qdn-resource'
}

async function chooseAndWriteFile(
  event: Electron.IpcMainInvokeEvent,
  filename: unknown,
  bytes: Uint8Array,
) {
  const file = suggestedFilename(filename)
  const owner = BrowserWindow.fromWebContents(event.sender)
  const selection = owner
    ? await dialog.showSaveDialog(owner, { defaultPath: file })
    : await dialog.showSaveDialog({ defaultPath: file })
  if (selection.canceled || !selection.filePath) return { canceled: true }
  await writeFile(selection.filePath, bytes, { mode: 0o600 })
  return { canceled: false }
}

export function registerHomeV2RetainedViewerBridgeIpcHandlers() {
  const leases = new Map<string, object>()
  const observed = new WeakSet<Electron.WebContents>()
  const keyFor = (sender: Electron.WebContents, viewerId: unknown) => {
    if (typeof viewerId !== 'string' || !viewerId || viewerId.length > 80) throw new Error('Invalid viewer id.')
    return `${sender.id}:${viewerId}`
  }
  ipcMain.handle('home-v2-retained-viewer:openPublic', async (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    if (!isRecord(value) || typeof value.location !== 'string') throw new Error('Invalid viewer coordinate.')
    const parsed = parseViewerLocation(value.location)
    if (!observed.has(event.sender)) {
      observed.add(event.sender)
      const senderId = event.sender.id
      const clearLeases = () => {
        for (const key of leases.keys()) if (key.startsWith(`${senderId}:`)) leases.delete(key)
      }
      event.sender.once('destroyed', clearLeases)
      event.sender.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) clearLeases()
      })
    }
    const key = keyFor(event.sender, value.viewerId)
    const lease = {}
    if (!leases.has(key) && leases.size >= 64) throw new Error('Too many open resource viewers.')
    leases.set(key, lease)
    try {
      const node = await getHomeV2ReadableNode(parsed.network)
      const route = `${node.mode}|${node.nodeApiUrl}`
      const valid = async () => {
        if (event.sender.isDestroyed() || leases.get(key) !== lease) return false
        try {
          const fresh = await getHomeV2ReadableNode(parsed.network)
          return !event.sender.isDestroyed() && leases.get(key) === lease && `${fresh.mode}|${fresh.nodeApiUrl}` === route
        } catch { return false }
      }
      const resolved = await resolvePublicViewer(parsed.location, node.nodeApiUrl, async url =>
        readPublicViewerJson(await nodeFetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000) })))
      if (!await valid()) throw new Error('The viewer or node route changed while opening the resource.')
      const streamUrl = issueHomeV2DesktopResourceStream({
        binding: { accountId: null, appIdentity: `home-viewer:${parsed.location}`, network: parsed.network,
          nodeApiUrl: node.nodeApiUrl, protocol: parsed.network === 'qortal' ? 'qortalRequest' : 'qdnRequest',
          routeRevision: route, tabId: String(value.viewerId) },
        isStillValid: valid, mimeType: resolved.mimeType, targetSession: event.sender.session, upstreamUrl: resolved.upstreamUrl,
      })
      return { ...resolved.resource, sourceTabId: value.viewerId, streamUrl }
    } catch (error) {
      if (leases.get(key) === lease) leases.delete(key)
      throw error
    }
  })
  ipcMain.handle('home-v2-retained-viewer:closePublic', (event, viewerId: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    leases.delete(keyFor(event.sender, viewerId))
  })
  ipcMain.handle('home-v2-retained-viewer:readBytes', async (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    if (
      !isRecord(value) ||
      value.maxBytes !== RETAINED_VIEWER_MAX_BYTES ||
      typeof value.url !== 'string' ||
      value.url.length > 512
    ) {
      throw new Error('Retained viewer request is invalid.')
    }
    return readHomeV2DesktopResourceStreamBytes({
      maxBytes: RETAINED_VIEWER_MAX_BYTES,
      targetSession: event.sender.session,
      url: value.url,
    })
  })
  ipcMain.handle('home-v2-retained-viewer:save', async (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    if (!isRecord(value) || typeof value.url !== 'string' || value.url.length > 512) {
      throw new Error('Retained viewer save request is invalid.')
    }
    const result = await readHomeV2DesktopResourceStreamBytes({
      maxBytes: RETAINED_VIEWER_MAX_BYTES,
      targetSession: event.sender.session,
      url: value.url,
    })
    return chooseAndWriteFile(event, value.filename, result.bytes)
  })
  ipcMain.handle('home-v2-retained-viewer:saveBytes', async (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    if (
      !isRecord(value) ||
      !(value.bytes instanceof Uint8Array) ||
      value.bytes.byteLength > RETAINED_VIEWER_MAX_BYTES ||
      typeof value.mimeType !== 'string' ||
      value.mimeType.length > 256
    ) {
      throw new Error('Retained viewer byte-save request is invalid.')
    }
    return chooseAndWriteFile(event, value.filename, value.bytes)
  })
}
