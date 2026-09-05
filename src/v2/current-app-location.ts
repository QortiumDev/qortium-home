import type { AppResourceLocation, AppTabContext } from './contracts'
import { buildAppResourceLocation, parseAppResourceLocation } from './resource-location'
import { isSameRenderResourcePath, resolveLaunchIdentifier } from './shell/render-path-identity'

// Host transport/appearance parameters must not become bookmarks or persisted
// bridge credentials. Keep app parameters (including repeated keys) and hashes.
const hostQueryKeys = new Set([
  'accent', 'lang', 'textSize', 'theme', 'uiStyle',
  'homeV2Bridge', 'qdnHomeBridge', 'apiKey',
])

function cleanQuery(search: string): string {
  // Filter raw pairs so an app's own encoding/order is not rewritten by
  // URLSearchParams (notably spaces, plus signs and repeated values).
  const pairs = search.replace(/^\?/, '').split('&').filter((pair) => {
    if (!pair) return false
    const key = new URLSearchParams(pair).keys().next().value
    return key !== undefined && !hostQueryKeys.has(key)
  })
  return pairs.length ? `?${pairs.join('&')}` : ''
}

/** Validate a presentation/resume address; never a permission-context update. */
export function validateCurrentAppLocation(
  context: AppTabContext,
  candidate: unknown,
): AppResourceLocation | null {
  if (context.previewUrl != null || typeof candidate !== 'string') return null
  try {
    const launch = parseAppResourceLocation(context.resourceLocation)
    const current = parseAppResourceLocation(candidate)
    if (launch.sourceNetwork !== context.sourceNetwork ||
        current.sourceNetwork !== launch.sourceNetwork ||
        current.identity.service !== launch.identity.service ||
        current.identity.name !== launch.identity.name ||
        resolveLaunchIdentifier(current.identity.identifier, candidate) !==
          resolveLaunchIdentifier(launch.identity.identifier, context.resourceLocation)) return null
    return `${buildAppResourceLocation(current.sourceNetwork, current.identity)}${current.routePath}${cleanQuery(current.search)}${current.hash}` as AppResourceLocation
  } catch { return null }
}

export function currentAppLocation(tab: {
  readonly context: AppTabContext
  readonly currentResourceLocation?: AppResourceLocation
}): AppResourceLocation {
  return validateCurrentAppLocation(tab.context, tab.currentResourceLocation) ?? tab.context.resourceLocation
}

/**
 * The platform supplies an authenticated navigation event and its render base.
 * Desktop supplies its native requested URL; Android its token-bound proxy URL.
 * File/archive viewer URLs are not app render URLs and are not converted here.
 * This converter is deliberately not an authorization predicate.
 */
export function currentAppLocationFromRender(
  context: AppTabContext,
  currentUrl: string,
  renderUrl: string,
): AppResourceLocation | null {
  if (context.previewUrl != null || currentUrl.length > 8_000 || renderUrl.length > 8_000) return null
  try {
    const launch = parseAppResourceLocation(context.resourceLocation)
    const live = new URL(currentUrl)
    const render = new URL(renderUrl)
    if (live.username || live.password || render.username || render.password ||
        live.protocol !== render.protocol || live.origin !== render.origin) return null
    if (live.protocol !== 'http:' && live.protocol !== 'https:') return null
    const identity = { ...launch.identity,
      identifier: resolveLaunchIdentifier(launch.identity.identifier, context.resourceLocation) }
    if (!isSameRenderResourcePath(currentUrl, identity) || !isSameRenderResourcePath(renderUrl, identity)) return null
    const segments = live.pathname.split('/').slice(4)
    const first = segments[0] ? decodeURIComponent(segments[0]) : null
    // Core strips an actual identifier (also when repeated in ?identifier=).
    // For a default resource, literal default/Default is an IN-APP path: Core
    // does not peel it (RenderResource.getPathByName's equalsIgnoreCase guard).
    if (identity.identifier !== null && first === identity.identifier) segments.shift()
    const route = segments.length ? `/${segments.join('/')}` : ''
    return validateCurrentAppLocation(context,
      `${buildAppResourceLocation(launch.sourceNetwork, identity)}${route}${cleanQuery(live.search)}${live.hash}`)
  } catch { return null }
}
