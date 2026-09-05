import { detectDocumentFormat } from '../../DocumentViewer'
import type { HomeV2ResourceViewerState } from './HomeV2ResourceViewer'
import { getQdnResourceStreamProxyMimeType } from '../../viewerLocation'

export const HOME_V2_RETAINED_VIEWER_MAX_BYTES = 100 * 1024 * 1024

export async function readHomeV2RetainedViewerBytes(
  response: Response,
  maxBytes = HOME_V2_RETAINED_VIEWER_MAX_BYTES,
) {
  if (!response.ok) throw new Error(`Resource request returned HTTP ${response.status}.`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('Resource exceeds the retained viewer byte limit.')
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
      throw new Error('Resource exceeds the retained viewer byte limit.')
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

export function classifyHomeV2ResourceViewer(resource: HomeV2ResourceViewerState) {
  const mime = resource.mimeType?.split(';', 1)[0].trim().toLowerCase() || getQdnResourceStreamProxyMimeType(resource) || ''
  const imageServices = new Set(['IMAGE', 'THUMBNAIL', 'QCHAT_IMAGE'])
  const audioServices = new Set(['AUDIO', 'VOICE', 'PODCAST'])
  const videoServices = new Set(['VIDEO'])
  const safeRasterTypes = new Set([
    'image/avif',
    'image/bmp',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
  ])
  if (safeRasterTypes.has(mime) || (imageServices.has(resource.service) && !mime)) return 'image'
  if (audioServices.has(resource.service) || mime.startsWith('audio/')) return 'audio'
  if (videoServices.has(resource.service) || mime.startsWith('video/')) return 'video'
  const format = detectDocumentFormat(resource.filename ?? undefined, mime)
  if (format !== 'unsupported') return 'document'
  const extension = resource.filename?.split('.').pop()?.toLowerCase() ?? ''
  if (
    extension === 'zip' ||
    extension === 'rar' ||
    mime === 'application/zip' ||
    mime === 'application/x-zip-compressed' ||
    mime === 'application/x-rar' ||
    mime === 'application/x-rar-compressed' ||
    mime === 'application/vnd.rar'
  ) return 'archive'
  return 'download'
}
