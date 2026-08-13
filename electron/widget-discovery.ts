import { parseWidgetManifest, type WidgetManifest } from './widget-manifest.js'

const SEGMENT_MAX_LENGTH = 128
const ADDRESS_MAX_LENGTH = 2_000
const WIDGET_MANIFEST_FILE = 'widget.json'

// Name plus identifier. Every published Q-App has both, and addressing a
// resource by name alone reaches a different resource or none at all.
export type WidgetResourceIdentity = {
  readonly name: string
  readonly identifier: string | null
}

export type WidgetFetchResult = {
  readonly ok: boolean
  readonly status: number
  readonly text: string
}

export type WidgetFetch = (path: string) => Promise<WidgetFetchResult>

function decodeSegment(value: string, label: string): string {
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    throw new Error(`${label} contains invalid encoding.`)
  }
  const trimmed = decoded.trim()
  if (
    !trimmed ||
    trimmed.length > SEGMENT_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    throw new Error(`${label} must contain 1 to ${SEGMENT_MAX_LENGTH} visible characters.`)
  }
  return trimmed
}

// Mirrors src/v2/resource-location.ts, which is where these addresses are
// produced. Kept separate because that module is renderer-side.
export function parseWidgetResourceIdentity(resourceUrl: unknown): WidgetResourceIdentity {
  const raw = typeof resourceUrl === 'string' ? resourceUrl.trim() : ''
  if (!raw || raw.length > ADDRESS_MAX_LENGTH) {
    throw new Error('Use a complete qdn:// or qortal:// app resource address.')
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('Use a complete qdn:// or qortal:// app resource address.')
  }

  const scheme = parsed.protocol.slice(0, -1).toLowerCase()
  if (scheme !== 'qdn' && scheme !== 'qortal') {
    throw new Error('Use a complete qdn:// or qortal:// app resource address.')
  }
  if (decodeSegment(parsed.hostname, 'App resource service').toUpperCase() !== 'APP') {
    throw new Error('The resource address does not identify an app.')
  }

  const segments = parsed.pathname.split('/').filter(Boolean)
  const rawName = segments.shift()
  if (!rawName) throw new Error('The app resource name is required.')
  const name = decodeSegment(rawName, 'App resource name')

  const rawIdentifier = segments.shift()
  const identifier = rawIdentifier
    ? decodeSegment(rawIdentifier, 'App resource identifier')
    : null

  return { name, identifier: identifier === 'default' ? null : identifier }
}

// A file inside a QDN resource is addressed by a filepath query, not by a path
// segment: /arbitrary/APP/<name>/<file> would read <file> as the identifier.
export function buildWidgetManifestPath(identity: WidgetResourceIdentity): string {
  const name = encodeURIComponent(identity.name)
  const identifier = identity.identifier ? `/${encodeURIComponent(identity.identifier)}` : ''
  const query = new URLSearchParams({ filepath: WIDGET_MANIFEST_FILE })
  return `/arbitrary/APP/${name}${identifier}?${query.toString()}`
}

// Render URLs do use path segments. qdn-views refuses anything that is not on
// the node's own origin and shaped /render/<SERVICE>/<name>/..., so this is
// built directly rather than derived from the app's resource address.
export function buildWidgetRenderUrl(
  nodeOrigin: unknown,
  identity: WidgetResourceIdentity,
  entry: unknown,
): string {
  const origin = typeof nodeOrigin === 'string' ? nodeOrigin.trim().replace(/\/+$/, '') : ''
  if (!origin) throw new Error('A widget render URL needs the node origin.')

  const path = typeof entry === 'string' ? entry.trim() : ''
  const encodedEntry = path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  if (!encodedEntry) throw new Error('A widget render URL needs an entry path.')

  const identifier = identity.identifier ? `/${encodeURIComponent(identity.identifier)}` : ''
  return `${origin}/render/APP/${encodeURIComponent(identity.name)}${identifier}/${encodedEntry}`
}

// Resolves to null when the app simply has no widget face. Throws when a
// manifest exists but cannot be trusted, so a bad manifest is visible rather
// than silently downgraded to "no widget".
export async function discoverWidgetManifest(
  identity: WidgetResourceIdentity,
  fetchPath: WidgetFetch,
): Promise<WidgetManifest | null> {
  const result = await fetchPath(buildWidgetManifestPath(identity))
  // The node answers 404 both for a missing file and for an unknown app.
  if (result.status === 404) return null
  if (!result.ok) throw new Error(`The widget manifest request returned HTTP ${result.status}.`)
  return parseWidgetManifest(result.text)
}
