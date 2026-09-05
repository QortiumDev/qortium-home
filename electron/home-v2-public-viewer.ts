import { parseViewerLocation } from './home-v2-viewer-location.js'
import { buildHomeV2ResourcePath, buildHomeV2ResourceRenderPath } from './home-v2-app-actions.js'
import { getQdnResourceStreamProxyMimeType } from './qdn-resource-viewer-contract.js'

/** Coordinate-only input: the caller never chooses an arbitrary upstream URL. */
export async function resolvePublicViewer(location: string, nodeApiUrl: string,
  readJson: (url: string) => Promise<unknown>) {
  const parsed = parseViewerLocation(location)
  const request = { ...parsed, identifier: parsed.identifier ?? 'default' }
  const status = await readJson(`${nodeApiUrl}${buildHomeV2ResourcePath('GET_QDN_RESOURCE_STATUS', request)}`)
  if (!status || typeof status !== 'object' || !('status' in status) || typeof status.status !== 'string' || !status.status || status.status === 'NOT_PUBLISHED') {
    throw new Error('Resource does not exist.')
  }
  const properties = await readJson(`${nodeApiUrl}${buildHomeV2ResourcePath('GET_QDN_RESOURCE_PROPERTIES', request)}`)
  const record = properties && typeof properties === 'object' ? properties as Record<string, unknown> : {}
  const field = (key: string) => typeof record[key] === 'string' && record[key].length <= 1024 ? record[key] as string : null
  const filename = parsed.path?.split('/').at(-1) ?? field('filename') ?? parsed.name
  const resource = { ...parsed, filename, mimeType: parsed.path ? null : field('mimeType') }
  return { resource, mimeType: getQdnResourceStreamProxyMimeType(resource),
    upstreamUrl: `${nodeApiUrl}${buildHomeV2ResourceRenderPath(request)}` }
}

export async function readPublicViewerJson(response: Response) {
  // Older nodes may omit properties; the coordinate still opens safely.
  if (response.status === 404) { await response.body?.cancel(); return null }
  if (!response.ok) throw new Error(`Resource metadata returned HTTP ${response.status}.`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Resource metadata is empty.')
  let text = '', length = 0
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 64 * 1024) throw new Error('Resource metadata exceeds its byte limit.')
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode()) as unknown
  } finally { await reader.cancel().catch(() => undefined) }
}
