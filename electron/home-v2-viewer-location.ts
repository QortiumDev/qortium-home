import { getQdnResourceViewerRequest } from './qdn-resource-viewer-contract.js'

/** Public coordinates only. Never a stream capability, node URL or app context. */
export interface ViewerLocation {
  readonly location: string
  readonly network: 'qortal' | 'qortium'
  readonly service: string
  readonly name: string
  readonly identifier: string | null
  readonly path: string | null
}

function segment(raw: string) {
  const value = decodeURIComponent(raw)
  if (!value.trim() || value !== value.trim() || value.length > 128 || /[\\/?#%\u0000-\u001f\u007f]/.test(value) ||
      value === '.' || value === '..') throw new Error('Invalid viewer resource path segment.')
  return value
}

export function parseViewerLocation(value: string): ViewerLocation {
  if (value.length > 2000 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid viewer resource address.')
  const url = new URL(value.trim())
  if (!['qdn:', 'qortal:'].includes(url.protocol) || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error('Use a qdn:// or qortal:// resource coordinate without credentials, query or fragment.')
  }
  // URL normalizes literal dot segments: reject them in the ORIGINAL input too.
  const rawPath = value.trim().replace(/^[^:]+:\/\/[^/]+/, '')
  const rawParts = rawPath.split('/').slice(1)
  if (!rawParts.length) throw new Error('The resource name is required.')
  const parts = rawParts.map(segment)
  const service = url.hostname.toUpperCase()
  const name = parts[0], identifier = parts[1] ?? 'default'
  const path = parts.length > 2 ? parts.slice(2).join('/') : null
  getQdnResourceViewerRequest({ action: 'OPEN_QDN_RESOURCE_VIEWER', service, name,
    identifier: identifier === 'default' ? null : identifier, path })
  return Object.freeze({ service, name, identifier: identifier === 'default' ? null : identifier, path,
    network: url.protocol === 'qortal:' ? 'qortal' : 'qortium',
    location: `${url.protocol}//${service}/${[name, identifier, ...parts.slice(2)].map(encodeURIComponent).join('/')}` })
}

export function isViewerAddress(value: string): boolean {
  try {
    const url = new URL(value)
    return ['qdn:', 'qortal:'].includes(url.protocol) && !['APP', 'WEBSITE', 'GAME'].includes(url.hostname.toUpperCase())
  } catch { return false }
}

export function viewerLocationFromResource(resource: Omit<ViewerLocation, 'location'>): string {
  if (resource.network !== 'qortal' && resource.network !== 'qortium') throw new Error('Invalid viewer network.')
  return parseViewerLocation(`${resource.network === 'qortal' ? 'qortal' : 'qdn'}://${resource.service}/${
    [resource.name, resource.identifier ?? 'default', ...(resource.path?.split('/') ?? [])].map(encodeURIComponent).join('/')}`).location
}
