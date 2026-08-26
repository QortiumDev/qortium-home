import type {
  AppResourceIdentity,
  AppResourceLocation,
  AppResourceService,
  NetworkId,
} from './contracts'

export type AppResourceScheme = 'qdn' | 'qortal'

// The QDN services Home opens as app tabs, in the canonical order used for
// deterministic candidate ordering (see parseHomeV2AppResourceCandidates).
// Runtime mirror of QDN_BROWSER_ARCHIVE_SERVICES in
// electron/qdn-browser-archive-services.ts; see the AppResourceService doc
// comment in ./contracts for why this is mirrored and not imported, and
// home-v2-foundation.test.tsx for the drift pin that holds the two together.
export const APP_RESOURCE_SERVICES = ['APP', 'WEBSITE', 'GAME'] as const

export function isAppResourceService(value: string): value is AppResourceService {
  return (APP_RESOURCE_SERVICES as readonly string[]).includes(value)
}

export interface ParsedAppResourceLocation {
  readonly identity: AppResourceIdentity
  readonly identifierWasExplicit: boolean
  readonly location: AppResourceLocation
  readonly routePath: string
  readonly search: string
  readonly hash: string
  readonly sourceNetwork: NetworkId
}

function schemeForNetwork(network: NetworkId): AppResourceScheme {
  return network === 'qortium' ? 'qdn' : 'qortal'
}

function networkForScheme(scheme: AppResourceScheme): NetworkId {
  return scheme === 'qdn' ? 'qortium' : 'qortal'
}

function encodeSegment(value: string) {
  return encodeURIComponent(value.trim())
}

function decodeSegment(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error('App resource address contains invalid encoding.')
  }
}

function validateSegment(value: string, label: string) {
  if (!value || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} must contain 1 to 128 visible characters.`)
  }
  return value
}

export function buildAppResourceLocation(
  sourceNetwork: NetworkId,
  identity: AppResourceIdentity,
): AppResourceLocation {
  const name = validateSegment(identity.name.trim(), 'App resource name')
  const identifier = validateSegment(
    identity.identifier?.trim() || 'default',
    'App resource identifier',
  )

  return `${schemeForNetwork(sourceNetwork)}://${identity.service}/${encodeSegment(name)}/${encodeSegment(identifier)}` as AppResourceLocation
}

export function parseAppResourceLocation(
  value: string,
): ParsedAppResourceLocation {
  const rawValue = value.trim()
  if (rawValue.length > 2_000 || /[\u0000-\u001f\u007f]/.test(rawValue)) {
    throw new Error('The app resource address is invalid or too long.')
  }
  let parsed: URL
  try {
    parsed = new URL(rawValue)
  } catch {
    throw new Error('Use a complete qdn:// or qortal:// app resource address.')
  }
  const rawScheme = parsed.protocol.slice(0, -1).toLowerCase()
  if (rawScheme !== 'qdn' && rawScheme !== 'qortal') {
    throw new Error('Use a complete qdn:// or qortal:// app resource address.')
  }
  if (parsed.username || parsed.password || parsed.port) {
    throw new Error('App resource addresses cannot contain credentials or ports.')
  }
  const scheme = rawScheme as AppResourceScheme
  const service = decodeSegment(parsed.hostname).toUpperCase()
  // Only the browser-archive services are accepted here. Viewer-only services
  // (IMAGE, VIDEO, DOCUMENT, ...) are deliberately still rejected with the
  // SAME message — they are not app-tab content and get their own surface.
  if (!isAppResourceService(service)) {
    throw new Error('The resource address does not identify an app.')
  }
  const rawSegments = parsed.pathname.split('/').filter(Boolean)
  const rawName = rawSegments.shift()
  if (!rawName) {
    throw new Error('The app resource name is required.')
  }
  const name = validateSegment(decodeSegment(rawName).trim(), 'App resource name')
  const identifierWasExplicit = rawSegments.length > 0
  const rawIdentifier = rawSegments.shift() ?? 'default'
  const identifier = validateSegment(decodeSegment(rawIdentifier).trim(), 'App resource identifier')
  const routeSegments = rawSegments.map((segment) =>
    validateSegment(decodeSegment(segment).trim(), 'App resource path segment'),
  )
  // The REAL parsed service is carried through, not re-stamped as 'APP' —
  // everything downstream (the /render/<service>/ URL, the rebuilt qdn://
  // address, the icon fetch, the navigation-drift check) reads it from here.
  const identity = {
    service,
    name,
    identifier: identifier === 'default' ? null : identifier,
  } as const
  const baseLocation = buildAppResourceLocation(networkForScheme(scheme), identity)
  const routePath = routeSegments.length > 0
    ? `/${routeSegments.map(encodeSegment).join('/')}`
    : ''
  const location = `${baseLocation}${routePath}${parsed.search}${parsed.hash}` as AppResourceLocation

  return Object.freeze({
    identity: Object.freeze(identity),
    identifierWasExplicit,
    location,
    routePath,
    search: parsed.search,
    hash: parsed.hash,
    sourceNetwork: networkForScheme(scheme),
  })
}
