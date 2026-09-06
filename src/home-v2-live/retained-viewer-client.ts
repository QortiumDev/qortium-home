import { Capacitor } from '@capacitor/core'
import { readAndroidHomeV2ResourceCapability } from '../home-v2-android-resource-capability'
import { parseViewerLocation } from '../v2/viewer-location'
import type { HomeV2ResourceViewerState } from '../v2/shell/HomeV2ResourceViewer'
import type { HomeV2NodeClient } from './node-client'
import { getQdnResourceStreamProxyMimeType } from '../../electron/qdn-resource-viewer-contract'

const RETAINED_VIEWER_MAX_BYTES = 100 * 1024 * 1024
const publicViewerBindings = new Map<string, string>()

export async function closeHomeV2PublicViewer(viewerId: string) {
  if (window.homeV2RetainedViewer?.closePublic) return window.homeV2RetainedViewer.closePublic(viewerId)
  const binding = publicViewerBindings.get(viewerId)
  publicViewerBindings.delete(viewerId)
  if (binding) {
    const { releaseHomeV2AndroidResourceStreams } = await import('./android-app-host')
    await releaseHomeV2AndroidResourceStreams(binding)
  }
}

export async function openHomeV2PublicViewer(location: string, viewerId: string, client?: HomeV2NodeClient | null): Promise<HomeV2ResourceViewerState> {
  const parsed = parseViewerLocation(location)
  if (window.homeV2RetainedViewer?.openPublic) return window.homeV2RetainedViewer.openPublic({ location: parsed.location, viewerId })
  if (!client || !Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') throw new Error('Resource viewing is unavailable on this platform.')
  const protocol = parsed.network === 'qortal' ? 'qortalRequest' : 'qdnRequest'
  const readRoute = async () => JSON.stringify(await client.requestApp(protocol, { action: 'GET_HOST_INFO' }))
  // Install ownership before the first await: close/reload must cancel even a
  // viewer that is still resolving its node, not just one with a minted token.
  const binding = JSON.stringify({ viewerId, location: parsed.location, nonce: crypto.randomUUID() })
  publicViewerBindings.set(viewerId, binding)
  try {
    const current = () => publicViewerBindings.get(viewerId) === binding
    const route = await readRoute()
    if (!current()) throw new Error('Viewer closed while resolving its node.')
    const raw = await client.requestApp(protocol, { action: 'OPEN_QDN_RESOURCE_VIEWER', ...parsed,
      identifier: parsed.identifier ?? 'default' }) as HomeV2ResourceViewerState
    if (!current() || !raw || typeof raw.streamUrl !== 'string') throw new Error('Viewer or node route changed.')
    const properties = await client.requestApp(protocol, { action: 'GET_QDN_RESOURCE_PROPERTIES', ...parsed,
      identifier: parsed.identifier ?? 'default', maxBytes: 64 * 1024 }).catch(error => {
      if (error instanceof Error && error.message === 'Node request returned HTTP 404.') return null
      throw error
    }) as Record<string, unknown> | null
    if (await readRoute() !== route || !current()) throw new Error('Viewer or node route changed.')
    const { authorizeHomeV2AndroidResourceStream, releaseHomeV2AndroidResourceStreams } = await import('./android-app-host')
    if (!current()) throw new Error('Viewer closed while loading its resource.')
    const field = (key: string) => typeof properties?.[key] === 'string' && properties[key].length <= 1024 ? properties[key] as string : null
    const resource = { ...parsed, filename: parsed.path?.split('/').at(-1) ?? field('filename') ?? parsed.name,
      mimeType: parsed.path ? null : field('mimeType') }
    // Public viewers render on the shell-origin capability, never an app proxy.
    const streamUrl = await authorizeHomeV2AndroidResourceStream(raw.streamUrl, getQdnResourceStreamProxyMimeType(resource), binding, true)
    if (await readRoute() !== route || !current()) {
      await releaseHomeV2AndroidResourceStreams(binding)
      throw new Error('Viewer or node route changed.')
    }
    return { ...resource, streamUrl, sourceTabId: viewerId }
  } catch (error) {
    if (publicViewerBindings.get(viewerId) === binding) publicViewerBindings.delete(viewerId)
    const { releaseHomeV2AndroidResourceStreams } = await import('./android-app-host')
    await releaseHomeV2AndroidResourceStreams(binding).catch(() => undefined)
    throw error
  }
}

export type HomeV2RetainedViewerBytes = {
  readonly bytes: Uint8Array
  readonly contentType?: string
}

export async function loadHomeV2RetainedViewerBytes(
  url: string,
  maxBytes = RETAINED_VIEWER_MAX_BYTES,
): Promise<HomeV2RetainedViewerBytes> {
  if (maxBytes !== RETAINED_VIEWER_MAX_BYTES && maxBytes !== 1024 * 1024) {
    throw new Error('Retained viewer byte limit is invalid.')
  }
  if (window.homeV2RetainedViewer) {
    const result = await window.homeV2RetainedViewer.readBytes({
      maxBytes,
      url,
    })
    const bytes = new Uint8Array(result.bytes)
    if (bytes.byteLength > maxBytes) {
      throw new Error('Resource exceeds the retained viewer byte limit.')
    }
    return { bytes, contentType: result.contentType ?? undefined }
  }
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    throw new Error('Retained document viewing is unavailable on this platform.')
  }
  // Android resource capabilities are implemented by the WebView request
  // interceptor. Keep the read inside that boundary; native Capacitor HTTP
  // bypasses the interceptor and would attempt to resolve the reserved host.
  return readAndroidHomeV2ResourceCapability(url, maxBytes)
}

export async function saveHomeV2RetainedViewerBytes(
  filename: string,
  bytes: Uint8Array,
  mimeType = 'application/octet-stream',
) {
  if (window.homeV2RetainedViewer) {
    return window.homeV2RetainedViewer.saveBytes({ bytes, filename, mimeType })
  }
  const { saveBytesToFile } = await import('../platform')
  return saveBytesToFile(filename, bytes, mimeType)
}

export async function saveHomeV2RetainedViewerFile(
  url: string,
  filename: string,
  mimeType = 'application/octet-stream',
) {
  if (window.homeV2RetainedViewer) {
    return window.homeV2RetainedViewer.save({ filename, url })
  }
  const { saveBytesToFile } = await import('../platform')
  const loaded = await loadHomeV2RetainedViewerBytes(url)
  return saveBytesToFile(filename, loaded.bytes, loaded.contentType ?? mimeType)
}

declare global {
  interface Window {
    homeV2RetainedViewer?: {
      openPublic?(request: { location: string; viewerId: string }): Promise<HomeV2ResourceViewerState>
      closePublic?(viewerId: string): Promise<void>
      readBytes(request: { maxBytes: number; url: string }): Promise<{
        bytes: Uint8Array
        contentType: string | null
      }>
      save(request: { filename: string; url: string }): Promise<{
        canceled: boolean
      }>
      saveBytes(request: { bytes: Uint8Array; filename: string; mimeType: string }): Promise<{
        canceled: boolean
      }>
    }
  }
}
