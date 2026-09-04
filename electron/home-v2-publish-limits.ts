import { fetchBoundedBytes } from './bounded-response.js'
import { HOME_V2_PUBLISH_SOURCE_MAX_BYTES } from './home-v2-publish-source-tokens.js'

const LIMITS_RESPONSE_MAX_BYTES = 64 * 1024
const LIMITS_FETCH_TIMEOUT_MS = 15_000
export const HOME_V2_AUTHENTICATED_PUBLISH_HARD_MAX_BYTES = 2 * 1024 * 1024 * 1024

export type HomeV2QdnPublishRouteKind = 'authenticated' | 'public'

export type HomeV2QdnPublishLimit = Readonly<{
  maximumBytes: number
  route: HomeV2QdnPublishRouteKind
}>

export function shouldUseAuthenticatedQdnPublish(
  network: string,
  trust: { readonly trusted: boolean },
) {
  return network === 'qortium' && trust.trusted
}

type LimitsFetch = (url: string, signal: AbortSignal) => Promise<Response>

export function deriveHomeV2QdnPublishLimit(
  value: unknown,
  authenticated: boolean,
): HomeV2QdnPublishLimit {
  const route = authenticated ? 'authenticated' : 'public'
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return Object.freeze({ maximumBytes: HOME_V2_PUBLISH_SOURCE_MAX_BYTES, route })
  }
  const field = authenticated ? 'publishMaxSize' : 'publicPublishMaxSize'
  const advertised = (value as Record<string, unknown>)[field]
  if (typeof advertised !== 'number' || !Number.isSafeInteger(advertised) || advertised < 1) {
    return Object.freeze({ maximumBytes: HOME_V2_PUBLISH_SOURCE_MAX_BYTES, route })
  }
  const homeMaximum = authenticated
    ? HOME_V2_AUTHENTICATED_PUBLISH_HARD_MAX_BYTES
    : HOME_V2_PUBLISH_SOURCE_MAX_BYTES
  return Object.freeze({
    maximumBytes: Math.min(advertised, homeMaximum),
    route,
  })
}

export async function getHomeV2QdnPublishLimit(
  nodeApiUrl: string,
  authenticated: boolean,
  fetchImpl: LimitsFetch,
): Promise<HomeV2QdnPublishLimit> {
  try {
    const { bytes, response } = await fetchBoundedBytes(
      (signal) => fetchImpl(`${nodeApiUrl}/arbitrary/limits`, signal),
      LIMITS_RESPONSE_MAX_BYTES,
      LIMITS_FETCH_TIMEOUT_MS,
    )
    if (!response.ok) throw new Error(`Node publish-limits lookup returned HTTP ${response.status}.`)
    return deriveHomeV2QdnPublishLimit(JSON.parse(new TextDecoder().decode(bytes)), authenticated)
  } catch {
    return deriveHomeV2QdnPublishLimit(null, authenticated)
  }
}

export function homeV2QdnPublishLimitMessage(limit: HomeV2QdnPublishLimit) {
  const route = limit.route === 'authenticated' ? 'authenticated trusted-node' : 'public keyless'
  return `${route} route limit is ${limit.maximumBytes.toLocaleString()} bytes`
}
