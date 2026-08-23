import { Capacitor } from '@capacitor/core'
import { readAndroidHomeV2ResourceCapability } from '../home-v2-android-resource-capability'

const RETAINED_VIEWER_MAX_BYTES = 100 * 1024 * 1024

export type HomeV2RetainedViewerBytes = {
  readonly bytes: Uint8Array
  readonly contentType?: string
}

export async function loadHomeV2RetainedViewerBytes(
  url: string,
): Promise<HomeV2RetainedViewerBytes> {
  if (window.homeV2RetainedViewer) {
    const result = await window.homeV2RetainedViewer.readBytes({
      maxBytes: RETAINED_VIEWER_MAX_BYTES,
      url,
    })
    const bytes = new Uint8Array(result.bytes)
    if (bytes.byteLength > RETAINED_VIEWER_MAX_BYTES) {
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
  return readAndroidHomeV2ResourceCapability(url, RETAINED_VIEWER_MAX_BYTES)
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
