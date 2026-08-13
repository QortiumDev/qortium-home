import { parseWidgetManifest, type WidgetManifest } from './widget-manifest.js'

const APP_NAME_MAX_LENGTH = 128

export type WidgetFetchResult = {
  readonly ok: boolean
  readonly status: number
  readonly text: string
}

export type WidgetFetch = (path: string) => Promise<WidgetFetchResult>

export function buildWidgetManifestPath(appName: unknown): string {
  const name = typeof appName === 'string' ? appName.trim() : ''
  // Control characters only. Spaces are legal in published app names and are
  // handled by percent-encoding below.
  if (!name || name.length > APP_NAME_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('App resource names must contain 1 to 128 visible characters.')
  }
  return `/arbitrary/APP/${encodeURIComponent(name)}/widget.json`
}

// qdn-views.ts refuses any render URL that is not on the node's own origin and
// shaped /render/<SERVICE>/<name>/..., so the URL has to be built rather than
// derived by appending to the app's resource URL, which is an opaque string.
export function buildWidgetRenderUrl(
  nodeOrigin: unknown,
  appName: unknown,
  entry: unknown,
): string {
  const origin = typeof nodeOrigin === 'string' ? nodeOrigin.trim().replace(/\/+$/, '') : ''
  if (!origin) throw new Error('A widget render URL needs the node origin.')

  const name = typeof appName === 'string' ? appName.trim() : ''
  if (!name) throw new Error('A widget render URL needs the app name.')

  const path = typeof entry === 'string' ? entry.trim() : ''
  const encodedEntry = path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  if (!encodedEntry) throw new Error('A widget render URL needs an entry path.')

  return `${origin}/render/APP/${encodeURIComponent(name)}/${encodedEntry}`
}

// Resolves to null when the app simply has no widget face. Throws when a
// manifest exists but cannot be trusted, so a bad manifest is visible rather
// than silently downgraded to "no widget".
export async function discoverWidgetManifest(
  appName: string,
  fetchPath: WidgetFetch,
): Promise<WidgetManifest | null> {
  const result = await fetchPath(buildWidgetManifestPath(appName))
  if (result.status === 404) return null
  if (!result.ok) throw new Error(`The widget manifest request returned HTTP ${result.status}.`)
  return parseWidgetManifest(result.text)
}
