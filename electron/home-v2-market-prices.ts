// GET_MARKET_PRICES — the ONLY action in the Home 2 app bridge that reaches
// the public internet rather than a Qortal/Qortium node.
//
// Security posture, stated plainly because this is the one exception:
//   - The outbound request is ONE fixed CoinGecko `/simple/price` GET for a
//     SUPERSET: every supported coin and currency, with 24h change
//     (buildHomeV2MarketPriceSupersetUrl). The URL is a compile-time constant —
//     no app input reaches it — so an app cannot vary coins, currencies, or the
//     change flag to alter what leaves the machine. Each app's requested subset
//     is projected locally out of the superset's response.
//   - NO user data leaves the process. No address, no account id, no public
//     key, no app identity, no node URL, no cookie, no custom header beyond
//     `Accept: application/json`. CoinGecko learns that SOMEBODY behind this
//     IP wanted prices — the same thing it learns from any price widget — and
//     because the request is a fixed superset it cannot learn WHICH coins or
//     currencies any particular app cares about.
//   - The cache is the rate bound as much as the reuse: at most ONE outbound
//     request per TTL, globally. A minimum interval governs ATTEMPTS (not just
//     successes), so even a run of failures cannot exceed one request per
//     interval, and concurrent callers COALESCE onto one in-flight fetch. An
//     app therefore cannot beacon CoinGecko on its own schedule by rotating
//     subsets or firing concurrent identical calls.
//   - It is therefore permissionless: there is no user data to gate.
//
// The response parsing and allowlists live in the pure electron/market-prices.ts
// module (shared with Home 1.x). This file adds the single-superset
// fetch-and-cache orchestration, with the clock and the fetch injected so the
// cache behavior is testable without a network or a real timer.

import {
  MARKET_PRICE_ALL_COINS,
  MARKET_PRICE_ALL_CURRENCIES,
  MARKET_PRICE_CACHE_TTL_MS,
  buildCoinGeckoSimplePricePath,
  buildMarketPriceResponse,
  normalizeMarketPriceCoins,
  normalizeMarketPriceCurrencies,
  type MarketPriceCoin,
  type MarketPriceResponse,
} from './market-prices.js'

export const HOME_V2_MARKET_PRICE_ACTIONS = Object.freeze(['GET_MARKET_PRICES'] as const)
export const HOME_V2_COINGECKO_ORIGIN = 'https://api.coingecko.com'
export const HOME_V2_COINGECKO_BASE_PATH = '/api/v3'
export const HOME_V2_MARKET_PRICE_TIMEOUT_MS = 20_000
// A response this large is not a price list; refuse it rather than buffer it.
export const HOME_V2_MARKET_PRICE_MAX_BYTES = 256 * 1024

export type HomeV2MarketPriceRequest = {
  readonly coins: MarketPriceCoin[]
  readonly currencies: string[]
  readonly include24hChange: boolean
}

function optionalBoolean(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error('include24hChange must be true or false.')
}

export function normalizeHomeV2MarketPriceRequest(
  request: Record<string, unknown>,
): HomeV2MarketPriceRequest {
  return {
    coins: normalizeMarketPriceCoins(request.coins ?? request.coin),
    currencies: normalizeMarketPriceCurrencies(
      request.currencies ?? request.currency ?? request.vsCurrencies ?? request.vs_currencies,
    ),
    include24hChange:
      optionalBoolean(request.include24hChange) ??
      optionalBoolean(request.include_24hr_change) ??
      optionalBoolean(request.includeChange) ??
      false,
  }
}

export function buildHomeV2MarketPriceUrl(priceRequest: HomeV2MarketPriceRequest) {
  return `${HOME_V2_COINGECKO_ORIGIN}${HOME_V2_COINGECKO_BASE_PATH}${buildCoinGeckoSimplePricePath(
    priceRequest.coins,
    priceRequest.currencies,
    priceRequest.include24hChange,
  )}`
}

/**
 * The ONE URL the cache ever fetches: every supported coin, every supported
 * currency, with 24h change. It is a compile-time constant — no app input
 * reaches it — so the outbound request is byte-for-byte identical no matter
 * what any app asks for. That is what makes the request itself impossible to
 * use as a fingerprint or a beacon channel: an app cannot vary the coins,
 * currencies, or change flag to change what leaves the machine. Every app's
 * requested subset is projected locally out of this superset's response.
 */
export function buildHomeV2MarketPriceSupersetUrl() {
  return `${HOME_V2_COINGECKO_ORIGIN}${HOME_V2_COINGECKO_BASE_PATH}${buildCoinGeckoSimplePricePath(
    MARKET_PRICE_ALL_COINS as readonly MarketPriceCoin[],
    MARKET_PRICE_ALL_CURRENCIES,
    true,
  )}`
}

type SupersetEntry = { expiresAt: number; fetchedAt: number; payload: unknown }

export type HomeV2MarketPriceFetch = (url: string) => Promise<{
  ok: boolean
  payload: unknown
  status: number
}>

/**
 * The single CoinGecko gateway, shared by every app on every tab.
 *
 * This is a privacy control first and a rate limiter second, and the earlier
 * per-subset design was neither. Keying the cache on the requested
 * coin/currency/change subset let an app rotate combinations to force a fresh
 * outbound request on every call — and firing N concurrent identical calls
 * fired N fetches — so the "bounded by the TTL" claim did not hold. An app
 * could still beacon CoinGecko on its own schedule.
 *
 * The fix removes the app's influence entirely:
 *
 *   - ONE fixed superset is fetched — every coin, every currency, with change
 *     (buildHomeV2MarketPriceSupersetUrl). The outbound URL is a constant; no
 *     app input reaches it. Each app's requested subset is projected locally
 *     out of the superset's response.
 *   - At most ONE outbound request per TTL, globally. A successful fetch is
 *     reused until it expires; and a MINIMUM INTERVAL (the same TTL) governs
 *     ATTEMPTS, so even a run of failures cannot fire more than one request
 *     per interval — the cold-failure beacon the per-subset version left open.
 *   - Concurrent callers COALESCE onto one in-flight fetch rather than each
 *     starting their own.
 *
 * On failure a still-fresh-enough superset is projected as `stale: true` with
 * a `staleReason` rather than failing the call (1.x behavior); with nothing
 * cached, the error propagates rather than inventing a price.
 */
export class HomeV2MarketPriceCache {
  #entry: SupersetEntry | null = null
  #inflight: Promise<void> | null = null
  #lastAttemptAt: number | null = null

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = MARKET_PRICE_CACHE_TTL_MS,
    // The floor between outbound ATTEMPTS, success or failure. Defaults to the
    // TTL: a fresh fetch already suppresses attempts for a TTL, and matching
    // the floor to it means a run of failures is bounded the same way.
    private readonly minIntervalMs = MARKET_PRICE_CACHE_TTL_MS,
  ) {}

  async read(
    priceRequest: HomeV2MarketPriceRequest,
    fetchPrices: HomeV2MarketPriceFetch,
  ): Promise<MarketPriceResponse> {
    const entry = this.#entry
    if (entry && entry.expiresAt > this.now()) {
      return this.#project(priceRequest, entry, { cacheHit: true, stale: false })
    }
    try {
      await this.#refresh(fetchPrices)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (this.#entry) {
        return this.#project(priceRequest, this.#entry, { cacheHit: true, stale: true, staleReason: reason })
      }
      throw error
    }
    // #refresh either stored a fresh entry or awaited one another caller stored.
    return this.#project(priceRequest, this.#entry as SupersetEntry, { cacheHit: false, stale: false })
  }

  // Ensures a fresh superset exists, coalescing concurrent callers and refusing
  // to start an outbound attempt more than once per minimum interval. Throws
  // when it cannot refresh (fetch failed, or the interval floor blocks a
  // refresh) so read() can decide between serving stale and propagating.
  async #refresh(fetchPrices: HomeV2MarketPriceFetch): Promise<void> {
    if (this.#inflight) {
      await this.#inflight
      return
    }
    const now = this.now()
    if (this.#lastAttemptAt !== null && now - this.#lastAttemptAt < this.minIntervalMs) {
      throw new Error('Market prices were fetched too recently; a new request is rate-limited locally.')
    }
    this.#lastAttemptAt = now
    const inflight = (async () => {
      const result = await fetchPrices(buildHomeV2MarketPriceSupersetUrl())
      if (!result.ok) {
        throw new Error(`CoinGecko request failed with HTTP ${result.status}.`)
      }
      const fetchedAt = this.now()
      this.#entry = { expiresAt: fetchedAt + this.ttlMs, fetchedAt, payload: result.payload }
    })()
    this.#inflight = inflight
    try {
      await inflight
    } finally {
      if (this.#inflight === inflight) this.#inflight = null
    }
  }

  #project(
    priceRequest: HomeV2MarketPriceRequest,
    entry: SupersetEntry,
    meta: { cacheHit: boolean; stale: boolean; staleReason?: string },
  ): MarketPriceResponse {
    return buildMarketPriceResponse({
      cacheHit: meta.cacheHit,
      coins: priceRequest.coins,
      currencies: priceRequest.currencies,
      fetchedAt: entry.fetchedAt,
      include24hChange: priceRequest.include24hChange,
      payload: entry.payload,
      stale: meta.stale,
      ...(meta.staleReason ? { staleReason: meta.staleReason } : {}),
    })
  }

  clear() {
    this.#entry = null
    this.#inflight = null
    this.#lastAttemptAt = null
  }

  get size() {
    return this.#entry ? 1 : 0
  }
}
