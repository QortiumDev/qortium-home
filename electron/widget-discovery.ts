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
