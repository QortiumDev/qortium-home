export const MARKET_PRICE_SOURCE = 'coingecko';
export const MARKET_PRICE_CACHE_TTL_MS = 60_000;
export const MARKET_PRICE_MAX_COINS = 25;
export const MARKET_PRICE_MAX_CURRENCIES = 5;

export const MARKET_PRICE_COIN_IDS = {
  ARRR: 'pirate-chain',
  BTC: 'bitcoin',
  DASH: 'dash',
  DGB: 'digibyte',
  DOGE: 'dogecoin',
  ETH: 'ethereum',
  FIRO: 'zcoin',
  IDNA: 'idena',
  KMD: 'komodo',
  LBC: 'lbry-credits',
  LTC: 'litecoin',
  LYNX: 'lynx',
  NMC: 'namecoin',
  PPC: 'peercoin',
  RVN: 'ravencoin',
  VRSC: 'verus-coin',
  XVG: 'verge',
  XMR: 'monero',
} as const;

export type MarketPriceCoin = keyof typeof MARKET_PRICE_COIN_IDS;

export type MarketPriceCoinEntry = {
  coinGeckoId: string;
  lastUpdatedAt?: number;
} & Record<string, number | string | undefined>;

export type MarketPriceResponse = {
  cacheHit: boolean;
  cacheTtlMs: number;
  coins: MarketPriceCoin[];
  currencies: string[];
  fetchedAt: number;
  missing: MarketPriceCoin[];
  prices: Partial<Record<MarketPriceCoin, MarketPriceCoinEntry>>;
  source: typeof MARKET_PRICE_SOURCE;
  stale: boolean;
  staleReason?: string;
};

const MARKET_PRICE_COIN_ALIASES: Record<string, MarketPriceCoin> = Object.fromEntries(
  Object.keys(MARKET_PRICE_COIN_IDS).map((coin) => [coin, coin]),
) as Record<string, MarketPriceCoin>;

const MARKET_PRICE_CURRENCIES = new Set([
  'aed',
  'ars',
  'aud',
  'brl',
  'cad',
  'chf',
  'clp',
  'cny',
  'czk',
  'dkk',
  'eur',
  'gbp',
  'hkd',
  'huf',
  'idr',
  'ils',
  'inr',
  'jpy',
  'krw',
  'mxn',
  'myr',
  'nok',
  'nzd',
  'php',
  'pln',
  'sek',
  'sgd',
  'thb',
  'try',
  'usd',
  'zar',
]);

// The complete coin and currency sets, exported so the Home v2 cache can fetch
// ONE fixed superset per TTL and project each app's requested subset locally —
// see electron/home-v2-market-prices.ts. Sorted and frozen so the superset URL
// is byte-for-byte constant regardless of any app input.
export const MARKET_PRICE_ALL_COINS = Object.freeze(
  (Object.keys(MARKET_PRICE_COIN_IDS) as MarketPriceCoin[]).slice().sort(),
);
export const MARKET_PRICE_ALL_CURRENCIES = Object.freeze([...MARKET_PRICE_CURRENCIES].sort());

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => getList(item));
  }

  const stringValue = getString(value);

  return stringValue ? stringValue.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

export function normalizeMarketPriceCoins(value: unknown) {
  const requestedCoins = getList(value);
  const coins = requestedCoins.length ? requestedCoins : Object.keys(MARKET_PRICE_COIN_IDS);
  const normalized: MarketPriceCoin[] = [];

  for (const coin of coins) {
    const marketCoin = MARKET_PRICE_COIN_ALIASES[coin.toUpperCase()];

    if (!marketCoin) {
      throw new Error(`Unsupported market price coin: ${coin}`);
    }

    if (!normalized.includes(marketCoin)) {
      normalized.push(marketCoin);
    }
  }

  if (normalized.length > MARKET_PRICE_MAX_COINS) {
    throw new Error(`Market price requests can include at most ${MARKET_PRICE_MAX_COINS} coins.`);
  }

  return normalized;
}

export function normalizeMarketPriceCurrencies(value: unknown) {
  const requestedCurrencies = getList(value);
  const currencies = requestedCurrencies.length ? requestedCurrencies : ['usd'];
  const normalized: string[] = [];

  for (const currency of currencies) {
    const normalizedCurrency = currency.toLowerCase();

    if (!MARKET_PRICE_CURRENCIES.has(normalizedCurrency)) {
      throw new Error(`Unsupported market price currency: ${currency}`);
    }

    if (!normalized.includes(normalizedCurrency)) {
      normalized.push(normalizedCurrency);
    }
  }

  if (normalized.length > MARKET_PRICE_MAX_CURRENCIES) {
    throw new Error(`Market price requests can include at most ${MARKET_PRICE_MAX_CURRENCIES} currencies.`);
  }

  return normalized;
}

export function getMarketPriceCacheKey(
  coins: readonly MarketPriceCoin[],
  currencies: readonly string[],
  include24hChange: boolean,
) {
  return [
    [...coins].sort().join(','),
    [...currencies].sort().join(','),
    include24hChange ? 'change' : 'plain',
  ].join('|');
}

export function buildCoinGeckoSimplePricePath(
  coins: readonly MarketPriceCoin[],
  currencies: readonly string[],
  include24hChange: boolean,
) {
  const params = new URLSearchParams({
    ids: coins.map((coin) => MARKET_PRICE_COIN_IDS[coin]).sort().join(','),
    include_last_updated_at: 'true',
    vs_currencies: [...currencies].sort().join(','),
  });

  if (include24hChange) {
    params.set('include_24hr_change', 'true');
  }

  return `/simple/price?${params.toString()}`;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function parseCoinGeckoSimplePricePayload(
  payload: unknown,
  coins: readonly MarketPriceCoin[],
  currencies: readonly string[],
  include24hChange: boolean,
) {
  const root = getRecord(payload);
  const prices: MarketPriceResponse['prices'] = {};
  const missing: MarketPriceCoin[] = [];

  if (!root) {
    return { missing: [...coins], prices };
  }

  for (const coin of coins) {
    const coinGeckoId = MARKET_PRICE_COIN_IDS[coin];
    const sourceEntry = getRecord(root[coinGeckoId]);

    if (!sourceEntry) {
      missing.push(coin);
      continue;
    }

    const priceEntry: MarketPriceCoinEntry = { coinGeckoId };
    let hasPrice = false;

    for (const currency of currencies) {
      const price = getFiniteNumber(sourceEntry[currency]);

      if (typeof price === 'number') {
        priceEntry[currency] = price;
        hasPrice = true;
      }

      if (include24hChange) {
        const change = getFiniteNumber(sourceEntry[`${currency}_24h_change`]);

        if (typeof change === 'number') {
          priceEntry[`${currency}_24h_change`] = change;
        }
      }
    }

    const lastUpdatedAt = getFiniteNumber(sourceEntry.last_updated_at);

    if (typeof lastUpdatedAt === 'number') {
      priceEntry.lastUpdatedAt = lastUpdatedAt;
    }

    if (hasPrice) {
      prices[coin] = priceEntry;
    } else {
      missing.push(coin);
    }
  }

  return { missing, prices };
}

export function buildMarketPriceResponse(input: {
  cacheHit: boolean;
  coins: MarketPriceCoin[];
  currencies: string[];
  fetchedAt: number;
  include24hChange: boolean;
  payload: unknown;
  stale?: boolean;
  staleReason?: string;
}): MarketPriceResponse {
  const parsed = parseCoinGeckoSimplePricePayload(
    input.payload,
    input.coins,
    input.currencies,
    input.include24hChange,
  );

  return {
    cacheHit: input.cacheHit,
    cacheTtlMs: MARKET_PRICE_CACHE_TTL_MS,
    coins: input.coins,
    currencies: input.currencies,
    fetchedAt: input.fetchedAt,
    missing: parsed.missing,
    prices: parsed.prices,
    source: MARKET_PRICE_SOURCE,
    stale: input.stale ?? false,
    ...(input.staleReason ? { staleReason: input.staleReason } : {}),
  };
}
