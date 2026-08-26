// GET_MARKET_PRICES — the ONLY action in the Home 2 app bridge that reaches
// the public internet rather than a Qortal/Qortium node.
//
// Security posture, stated plainly because this is the one exception:
//   - The outbound request is a fixed CoinGecko `/simple/price` GET built
//     entirely from an allowlist. `ids` comes from MARKET_PRICE_COIN_IDS,
//     `vs_currencies` from MARKET_PRICE_CURRENCIES; a coin or currency outside
//     those sets is rejected before any request is made
//     (electron/market-prices.ts). Nothing app-supplied is interpolated raw.
//   - NO user data leaves the process. No address, no account id, no public
//     key, no app identity, no node URL, no cookie, no custom header beyond
//     `Accept: application/json`. CoinGecko learns that SOMEBODY behind this
//     IP wanted a price — the same thing it learns from any price widget —
//     and the cache below means it learns that at most once per TTL per
//     distinct coin/currency set, no matter how many apps ask.
//   - It is therefore permissionless: there is no user data to gate.
//
// The response parsing, allowlists and cache-key derivation live in the pure
// electron/market-prices.ts module (shared with Home 1.x). This file adds only
// the fetch-and-cache orchestration, with the clock and the fetch injected so
// the cache behavior is testable without a network or a real timer.

import {
  MARKET_PRICE_CACHE_TTL_MS,
  buildCoinGeckoSimplePricePath,
  buildMarketPriceResponse,
  getMarketPriceCacheKey,
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

type CacheEntry = { expiresAt: number; response: MarketPriceResponse }

export type HomeV2MarketPriceFetch = (url: string) => Promise<{
  ok: boolean
  payload: unknown
  status: number
}>

/**
 * A TTL cache in front of CoinGecko, shared by every app on every tab.
 *
 * Two jobs. The obvious one is not hammering a free public API. The less
 * obvious one is that the cache is the privacy control: without it, an app
 * could poll GET_MARKET_PRICES in a loop and turn Home into a beacon that
 * announces the user's IP to a third party on the app's schedule. With it,
 * outbound requests are bounded by the TTL regardless of how often apps ask.
 *
 * On a fetch failure a still-cached response is served with `stale: true` and
 * a `staleReason` rather than failing the call outright — 1.x behavior
 * (electron/qdn.ts:2032-2043). A price a minute old beats no price.
 */
export class HomeV2MarketPriceCache {
  readonly #entries = new Map<string, CacheEntry>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = MARKET_PRICE_CACHE_TTL_MS,
  ) {}

  async read(
    priceRequest: HomeV2MarketPriceRequest,
    fetchPrices: HomeV2MarketPriceFetch,
  ): Promise<MarketPriceResponse> {
    const cacheKey = getMarketPriceCacheKey(
      priceRequest.coins,
      priceRequest.currencies,
      priceRequest.include24hChange,
    )
    const cached = this.#entries.get(cacheKey)
    if (cached && cached.expiresAt > this.now()) {
      return { ...cached.response, cacheHit: true, stale: false }
    }
    try {
      const result = await fetchPrices(buildHomeV2MarketPriceUrl(priceRequest))
      if (!result.ok) {
        throw new Error(`CoinGecko request failed with HTTP ${result.status}.`)
      }
      const response = buildMarketPriceResponse({
        ...priceRequest,
        cacheHit: false,
        fetchedAt: this.now(),
        payload: result.payload,
      })
      this.#entries.set(cacheKey, {
        expiresAt: response.fetchedAt + this.ttlMs,
        response,
      })
      return response
    } catch (error) {
      if (cached) {
        return {
          ...cached.response,
          cacheHit: true,
          stale: true,
          staleReason: error instanceof Error ? error.message : String(error),
        }
      }
      throw error
    }
  }

  clear() {
    this.#entries.clear()
  }

  get size() {
    return this.#entries.size
  }
}
