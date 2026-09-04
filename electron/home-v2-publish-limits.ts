import { fetchBoundedBytes } from './bounded-response.js'
import { nodeFetch } from './node-tls.js'
import { HOME_V2_PUBLISH_SOURCE_MAX_BYTES } from './home-v2-publish-source-tokens.js'
import { HOME_V2_PUBLISH_IN_MEMORY_MAX_BYTES } from './home-v2-publish-source-selection.js'
import { PUBLIC_QDN_ATTESTATION_MAX_SOURCE_BYTES } from './qdn-content-attestation.js'

const LIMITS_RESPONSE_MAX_BYTES = 64 * 1024
const LIMITS_CACHE_TTL_MS = 5 * 60_000
const LIMITS_FETCH_TIMEOUT_MS = 15_000

type HomeV2PublishLimitsFetch = (url: string, signal: AbortSignal) => Promise<Response>

type CacheEntry = { fetchedAt: number; value: number }
const cache = new Map<string, CacheEntry>()

async function discoverPublicPublishMaxSize(nodeApiUrl: string, fetchImpl: HomeV2PublishLimitsFetch): Promise<number> {
  const { bytes, response } = await fetchBoundedBytes(
    (signal) => fetchImpl(`${nodeApiUrl}/arbitrary/limits`, signal),
    LIMITS_RESPONSE_MAX_BYTES,
    LIMITS_FETCH_TIMEOUT_MS,
  )
  if (!response.ok) throw new Error(`Node publish-limits lookup returned HTTP ${response.status}.`)
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
  const value = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).publicPublishMaxSize : undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    throw new Error('Node publish-limits response did not include a valid publicPublishMaxSize.')
  }
  return value
}

/**
 * The effective per-file ceiling for a public Qortium/Qortal publish:
 * whatever the connected node advertises via GET /arbitrary/limits,
 * backstopped by Home's own hard ceiling so a node can only ever shrink
 * this, never grow it past what Home is willing to attempt. Falls back to
 * HOME_V2_PUBLISH_SOURCE_MAX_BYTES if the node doesn't expose the endpoint
 * or answers something unusable. Cached per (network, nodeApiUrl) for
 * LIMITS_CACHE_TTL_MS so repeated selections on the same route don't each
 * pay a round trip.
 */
export async function getHomeV2PublishSizeCeiling(
  network: 'qortal' | 'qortium',
  nodeApiUrl: string,
  fetchImpl: HomeV2PublishLimitsFetch = (url, signal) => nodeFetch(url, { signal }),
): Promise<number> {
  const cacheKey = `${network}|${nodeApiUrl}`
  const now = Date.now()
  const cached = cache.get(cacheKey)
  if (cached && now - cached.fetchedAt < LIMITS_CACHE_TTL_MS) {
    return cached.value
  }
  let discovered: number
  try {
    discovered = await discoverPublicPublishMaxSize(nodeApiUrl, fetchImpl)
  } catch {
    discovered = HOME_V2_PUBLISH_SOURCE_MAX_BYTES
  }
  // Two backstops, both of which a node can only shrink: what Home is willing
  // to ATTEST (1 GiB) and what Home is willing to HOLD IN MEMORY while doing
  // so (256 MiB). The second is the binding one today, and deliberately so -
  // see HOME_V2_PUBLISH_IN_MEMORY_MAX_BYTES.
  const ceiling = Math.min(
    discovered,
    PUBLIC_QDN_ATTESTATION_MAX_SOURCE_BYTES,
    HOME_V2_PUBLISH_IN_MEMORY_MAX_BYTES,
  )
  cache.set(cacheKey, { fetchedAt: now, value: ceiling })
  return ceiling
}

export function resetHomeV2PublishSizeCeilingCache() {
  cache.clear()
}
