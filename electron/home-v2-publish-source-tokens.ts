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

  constructor(
    private readonly maximumEntries: number,
    private readonly ttlMs = HOME_V2_PUBLISH_SOURCE_TOKEN_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1) {
      throw new Error('Publish source token store requires a positive entry limit.')
    }
  }

  issue(binding: HomeV2PublishSourceBinding, source: T) {
    const now = this.now()
    this.prune(now)
    while (this.#entries.size >= this.maximumEntries) {
      let oldest: [string, Entry<T>] | null = null
      for (const candidate of this.#entries) {
        if (!oldest || candidate[1].lastUsedAt < oldest[1].lastUsedAt) oldest = candidate
      }
      if (!oldest) break
      this.#entries.delete(oldest[0])
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
