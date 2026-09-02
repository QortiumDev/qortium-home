export const HOME_V2_PUBLISH_SOURCE_MAX_BYTES = 100 * 1024 * 1024
export const HOME_V2_PUBLISH_SOURCE_TOKEN_TTL_MS = 30 * 60_000

export type HomeV2PublishSourceBinding = Readonly<{
  accountId: string
  appIdentity: string
  network: 'qortal' | 'qortium'
  nodeApiUrl: string
  protocol: 'qdnRequest' | 'qortalRequest'
  routeRevision: string
  tabId: string
}>

export type HomeV2PublishSourceDescriptor = Readonly<{
  fileName: string
  mimeType: string | null
  size: number
}>

type Entry<T> = {
  readonly bindingKey: string
  readonly createdAt: number
  lastUsedAt: number
  readonly source: T
}

function bindingKey(binding: HomeV2PublishSourceBinding) {
  return [
    binding.accountId,
    binding.appIdentity,
    binding.network,
    binding.nodeApiUrl,
    binding.protocol,
    binding.routeRevision,
    binding.tabId,
  ].join('\n')
}

export class HomeV2PublishSourceTokenStore<T> {
  readonly #entries = new Map<string, Entry<T>>()

  /**
   * @param maximumEntries how many selections may be retained at once.
   * @param options.maximumBytes an OPTIONAL total-size budget across retained
   *   sources, with `sizeOf` measuring one. A batch publish needs several
   *   selections alive at once, but on a phone each is a decoded Base64 copy
   *   in WebView memory — so the count alone is the wrong limit, and the
   *   oldest entries are evicted until the budget fits. Without a budget the
   *   store behaves exactly as before.
   */
  constructor(
    private readonly maximumEntries: number,
    private readonly ttlMs = HOME_V2_PUBLISH_SOURCE_TOKEN_TTL_MS,
    private readonly now: () => number = Date.now,
    private readonly options: {
      readonly maximumBytes?: number
      readonly sizeOf?: (source: T) => number
    } = {},
  ) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1) {
      throw new Error('Publish source token store requires a positive entry limit.')
    }
    if (options.maximumBytes !== undefined && !options.sizeOf) {
      throw new Error('Publish source token store needs sizeOf to enforce a byte budget.')
    }
  }

  #retainedBytes() {
    const sizeOf = this.options.sizeOf
    if (!sizeOf) return 0
    let total = 0
    for (const entry of this.#entries.values()) total += sizeOf(entry.source)
    return total
  }

  #evictOldest() {
    let oldest: [string, Entry<T>] | null = null
    for (const candidate of this.#entries) {
      if (!oldest || candidate[1].lastUsedAt < oldest[1].lastUsedAt) oldest = candidate
    }
    if (!oldest) return false
    this.#entries.delete(oldest[0])
    return true
  }

  issue(binding: HomeV2PublishSourceBinding, source: T) {
    const now = this.now()
    this.prune(now)
    const { maximumBytes, sizeOf } = this.options
    if (maximumBytes !== undefined && sizeOf) {
      const incoming = sizeOf(source)
      if (incoming > maximumBytes) {
        throw new Error('Selected publish source is larger than Home can retain on this device.')
      }
      while (this.#entries.size > 0 && this.#retainedBytes() + incoming > maximumBytes) {
        if (!this.#evictOldest()) break
      }
    }
    while (this.#entries.size >= this.maximumEntries) {
      if (!this.#evictOldest()) break
    }
    const token = globalThis.crypto.randomUUID()
    this.#entries.set(token, {
      bindingKey: bindingKey(binding),
      createdAt: now,
      lastUsedAt: now,
      source,
    })
    return token
  }

  resolve(token: string, binding: HomeV2PublishSourceBinding) {
    this.prune()
    const entry = this.#entries.get(token)
    if (!entry) throw new Error('Selected publish source expired. Select the file again.')
    if (entry.bindingKey !== bindingKey(binding)) {
      throw new Error('Selected publish source is not available to this app, account, network, or route.')
    }
    entry.lastUsedAt = this.now()
    return entry.source
  }

  release(token: string) {
    if (token) this.#entries.delete(token)
  }

  clear() {
    this.#entries.clear()
  }

  prune(now = this.now()) {
    for (const [token, entry] of this.#entries) {
      if (now - entry.lastUsedAt >= this.ttlMs || now - entry.createdAt >= this.ttlMs) {
        this.#entries.delete(token)
      }
    }
  }

  get size() {
    return this.#entries.size
  }
}

export function normalizeHomeV2PublishSourceToken(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('A valid Home-issued publish source token is required.')
  }
  return value
}
