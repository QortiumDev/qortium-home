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

function checkSegment(value: string) {
  if (!value.trim() || value !== value.trim() || value.length > 128 || /[\\/?#%\u0000-\u001f\u007f]/.test(value) ||
      value === '.' || value === '..') throw new Error('Invalid viewer resource path segment.')
  return value
}

function segment(raw: string) {
  return checkSegment(decodeURIComponent(raw))
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

/**
 * An OPENING position carried by a public viewer address, never an identity.
 *
 * Presentation values only, bounded here so a viewer never has to trust them:
 * they are copied onto a freshly opened tab's ViewerPosition and are not part
 * of the tab's location, history, restore or bookmark identity.
 */
export interface ViewerPositionSeed {
  readonly page?: number
  readonly zoom?: number
  readonly mediaTime?: number
  readonly line?: number
  readonly archivePath?: string
}

export interface ViewerAddress {
  /** The bare resource coordinate, exactly as parseViewerLocation returns it. */
  readonly location: string
  /** Null when the address carried no fragment, or nothing usable in it. */
  readonly seed: ViewerPositionSeed | null
}

/** Mirrors the document viewer's own page/zoom clamps (DocumentViewer.tsx). */
const VIEWER_SEED_MAX_PAGE = 1_000_000
const VIEWER_SEED_MIN_ZOOM = 25
const VIEWER_SEED_MAX_ZOOM = 400
const VIEWER_SEED_MAX_TIME = 10_000_000
const VIEWER_SEED_MAX_LINE = 10_000_000
const VIEWER_SEED_MAX_ENTRY = 1024

function seedInteger(value: string, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error('Invalid viewer position value.')
  return parsed
}

/**
 * The position fragment of a public viewer address: `&`-separated `key=value`
 * pairs, values percent-decoded, unknown keys ignored. Duplicate keys: the LAST
 * raw occurrence is the one validated, so an earlier valid value never survives
 * a malformed later one. A malformed value drops THAT KEY ONLY, so a stale or
 * hostile fragment can never stop the resource itself from opening.
 *
 * There is deliberately no EPUB `cfi` key: an untrusted CFI reaches epub.js's
 * own XPath resolver, so seeding one is a separate, hardened follow-up.
 */
function parseViewerFragment(fragment: string): ViewerPositionSeed | null {
  // Collected raw first, so validation only ever sees the winning occurrence.
  const raw = new Map<string, string>()
  for (const pair of fragment.split('&')) {
    if (!pair) continue
    const split = pair.indexOf('=')
    if (split <= 0) continue
    raw.set(pair.slice(0, split).toLowerCase(), pair.slice(split + 1))
  }
  const seed: {
    page?: number; zoom?: number; mediaTime?: number
    line?: number; archivePath?: string
  } = {}
  let usable = false
  for (const [key, encoded] of raw) {
    try {
      const value = decodeURIComponent(encoded)
      // Encoded control characters are refused everywhere, exactly as the
      // coordinate parser refuses raw ones.
      if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid viewer position value.')
      switch (key) {
        case 'page': seed.page = seedInteger(value, 1, VIEWER_SEED_MAX_PAGE); break
        case 'zoom': seed.zoom = seedInteger(value, VIEWER_SEED_MIN_ZOOM, VIEWER_SEED_MAX_ZOOM); break
        case 't': {
          const time = Number(value)
          if (!value.trim() || !Number.isFinite(time) || time < 0 || time > VIEWER_SEED_MAX_TIME) {
            throw new Error('Invalid viewer position value.')
          }
          seed.mediaTime = time
          break
        }
        case 'line': seed.line = seedInteger(value, 1, VIEWER_SEED_MAX_LINE); break
        case 'entry': {
          if (!value || value.length > VIEWER_SEED_MAX_ENTRY) throw new Error('Invalid viewer position value.')
          // Same per-segment rules as the location path: no traversal, no
          // separators, bounded and printable.
          seed.archivePath = value.split('/').map(checkSegment).join('/')
          break
        }
        default: continue
      }
      usable = true
    } catch { /* One unusable value never invalidates the rest of the address. */ }
  }
  return usable ? Object.freeze(seed) : null
}

/**
 * Splits a public viewer ADDRESS into the bare coordinate everything is keyed
 * on and the opening position it asks for. Every open path (address bar,
 * bookmarks, pins, start pages, app OPEN_NEW_TAB, cross-window adoption) uses
 * this; the tab still stores, shows, bookmarks and transfers only `location`.
 */
export function parseViewerAddress(value: string): ViewerAddress {
  if (value.length > 2000 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid viewer resource address.')
  const address = value.trim()
  // A '#' is refused inside every coordinate segment, encoded or not, so the
  // first one always starts the fragment.
  const split = address.indexOf('#')
  return Object.freeze({
    location: parseViewerLocation(split < 0 ? address : address.slice(0, split)).location,
    seed: split < 0 ? null : parseViewerFragment(address.slice(split + 1)),
  })
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
