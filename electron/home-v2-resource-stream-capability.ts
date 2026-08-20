import { randomUUID } from 'node:crypto'

export const HOME_V2_RESOURCE_STREAM_SCHEME = 'qortium-home-resource'
export const HOME_V2_RESOURCE_STREAM_TTL_MS = 10 * 60_000
export const HOME_V2_RESOURCE_STREAM_MAX_ENTRIES = 64
export const HOME_V2_RESOURCE_STREAM_RESPONSE_MAX_BYTES = 512 * 1024 * 1024
export const HOME_V2_RESOURCE_STREAM_TOTAL_MAX_BYTES = 4 * 1024 * 1024 * 1024

export type HomeV2ResourceStreamBinding = Readonly<{
  accountId: string | null
  appIdentity: string
  network: 'qortal' | 'qortium'
  nodeApiUrl: string
  protocol: 'qdnRequest' | 'qortalRequest'
  routeRevision: string
  tabId: string
}>

export type HomeV2ResourceStreamEntry = Readonly<{
  binding: HomeV2ResourceStreamBinding
  expiresAt: number
  mimeType: string | null
  token: string
  upstreamUrl: string
}>

function canonicalHttpUrl(value: string) {
  const url = new URL(value)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.hash) {
    throw new Error('Resource stream upstream URL must be an http(s) URL without credentials or a fragment.')
  }
  return url.toString()
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function buildHomeV2ResourceStreamCapabilityUrl(token: string) {
  if (!isUuid(token)) throw new Error('Resource stream capability token is invalid.')
  return `${HOME_V2_RESOURCE_STREAM_SCHEME}://stream/${token}`
}

export function parseHomeV2ResourceStreamCapabilityUrl(value: string) {
  const url = new URL(value)
  if (
    url.protocol !== `${HOME_V2_RESOURCE_STREAM_SCHEME}:` ||
    url.hostname !== 'stream' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Resource stream capability URL is invalid.')
  }
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length !== 1 || !isUuid(segments[0])) {
    throw new Error('Resource stream capability URL is invalid.')
  }
  return segments[0]
}

export function normalizeHomeV2ResourceRange(value: string | null) {
  if (!value) return null
  const trimmed = value.trim()
  if (!/^bytes=\d+-\d*$/.test(trimmed)) {
    throw new Error('Only one forward byte range is supported.')
  }
  const [startValue, endValue] = trimmed.slice('bytes='.length).split('-')
  const start = Number(startValue)
  const end = endValue ? Number(endValue) : null
  if (!Number.isSafeInteger(start) || start < 0 || (end !== null && (!Number.isSafeInteger(end) || end < start))) {
    throw new Error('Resource stream byte range is invalid.')
  }
  return trimmed
}

export function assertHomeV2ResourceStreamResponseBounds(headers: Headers) {
  const contentLengthValue = headers.get('content-length')
  if (contentLengthValue) {
    const contentLength = Number(contentLengthValue)
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new Error('Resource stream response length is invalid.')
    }
    if (contentLength > HOME_V2_RESOURCE_STREAM_RESPONSE_MAX_BYTES) {
      throw new Error('Resource stream response exceeds the per-request byte limit.')
    }
  }
  const contentRange = headers.get('content-range')
  if (contentRange) {
    const match = /^bytes \d+-\d+\/(\d+|\*)$/i.exec(contentRange.trim())
    if (!match) throw new Error('Resource stream response range is invalid.')
    if (match[1] !== '*' && Number(match[1]) > HOME_V2_RESOURCE_STREAM_TOTAL_MAX_BYTES) {
      throw new Error('Resource stream exceeds the total byte limit.')
    }
  }
}

export class HomeV2ResourceStreamCapabilityStore {
  readonly #entries = new Map<string, HomeV2ResourceStreamEntry>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly createToken: () => string = randomUUID,
  ) {}

  issue(input: {
    binding: HomeV2ResourceStreamBinding
    mimeType?: string | null
    upstreamUrl: string
  }) {
    this.sweep()
    while (this.#entries.size >= HOME_V2_RESOURCE_STREAM_MAX_ENTRIES) {
      const oldest = this.#entries.keys().next().value
      if (!oldest) break
      this.#entries.delete(oldest)
    }
    const token = this.createToken()
    if (!isUuid(token)) throw new Error('Resource stream capability generator returned an invalid token.')
    const entry: HomeV2ResourceStreamEntry = Object.freeze({
      binding: Object.freeze({ ...input.binding }),
      expiresAt: this.now() + HOME_V2_RESOURCE_STREAM_TTL_MS,
      mimeType: input.mimeType?.trim().toLowerCase() || null,
      token,
      upstreamUrl: canonicalHttpUrl(input.upstreamUrl),
    })
    this.#entries.set(token, entry)
    return { entry, url: buildHomeV2ResourceStreamCapabilityUrl(token) }
  }

  resolve(token: string) {
    this.sweep()
    const entry = this.#entries.get(token)
    if (!entry) throw new Error('Resource stream capability is invalid or expired.')
    return entry
  }

  release(token: string) {
    this.#entries.delete(token)
  }

  has(token: string) {
    this.sweep()
    return this.#entries.has(token)
  }

  clear() {
    this.#entries.clear()
  }

  sweep() {
    const now = this.now()
    for (const [token, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(token)
    }
  }
}
