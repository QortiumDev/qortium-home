/** Transport routing only. No keys, permission decisions, native state or mutation retries. */
export const CORE_WALLET_API_CONTRACT = 'qortium-core-wallet-api-v1'
export type WalletApiProtocol = Readonly<{
  contract: typeof CORE_WALLET_API_CONTRACT
  coin: 'ARRR' | 'XMR'
  reads: readonly string[]
  writes: readonly string[]
  sessionHeader: 'X-WALLET-SESSION'
}>
export type WalletApiProtocols = Readonly<
  Partial<Record<'ARRR' | 'XMR', WalletApiProtocol>>
>

export function parseWalletApiProtocol(
  value: unknown,
  coin: 'ARRR' | 'XMR',
): WalletApiProtocol | null {
  const v = value as WalletApiProtocol | null
  if (
    !v ||
    typeof v !== 'object' ||
    v.contract !== CORE_WALLET_API_CONTRACT ||
    v.coin !== coin ||
    v.sessionHeader !== 'X-WALLET-SESSION' ||
    !Array.isArray(v.reads) ||
    !Array.isArray(v.writes) ||
    [...v.reads, ...v.writes].some(
      (op) => typeof op !== 'string' || !/^[a-z-]+(?:\/[a-z-]+)?$/.test(op),
    )
  )
    return null
  return {
    contract: v.contract,
    coin,
    sessionHeader: v.sessionHeader,
    reads: [...v.reads],
    writes: [...v.writes],
  }
}

const names = {
  ARRR: {
    walletsession: 'session',
    initialize: 'initialize',
    syncstatus: 'status',
    walletaddress: 'address',
    walletbalance: 'balance',
    wallettransactions: 'transactions',
    sendcontract: 'send-capabilities',
    sendreadiness: 'send/readiness',
    sendlookup: 'send/lookup',
    start: 'start',
    stop: 'stop',
    send: 'send',
  },
  XMR: {
    capabilities: 'capabilities',
    session: 'session',
    wallet: 'status',
    activate: 'activate',
    deactivate: 'stop',
    'send/prepare': 'send/prepare',
    'send/commit': 'send/commit',
    'send/cancel': 'send/cancel',
    'send/reconcile': 'send/reconcile',
    'send/status': 'send/status',
  },
} as const

export function coreWalletRequestPath(
  pathname: string,
  method: string,
  protocols?: WalletApiProtocols,
): { pathname: string; sessionHeader: string } {
  const legacy = { pathname, sessionHeader: 'X-XMR-SESSION' }
  const match = /^\/crosschain\/(arrr|xmr)\/([^?]+)(\?[^#]*)?$/.exec(pathname)
  if (!match) return legacy
  const coin = match[1].toUpperCase() as 'ARRR' | 'XMR'
  const protocol = protocols?.[coin]
  if (!protocol) return legacy
  let endpoint = match[2],
    id = ''
  if (coin === 'ARRR' && /^send\/[a-f0-9-]{36}$/.test(endpoint)) {
    id = endpoint.slice(5)
    endpoint = 'send/status'
  } else if (coin === 'ARRR' && /^sendlookup\/[a-f0-9-]{36}$/.test(endpoint)) {
    id = endpoint.slice(11)
    endpoint = 'sendlookup'
  } else if (coin === 'XMR' && /^send\/status\/[a-f0-9-]{36}$/.test(endpoint)) {
    id = endpoint.slice(12)
    endpoint = 'send/status'
  }
  const mapping = names[coin] as Readonly<Record<string, string>>
  const operation =
    coin === 'ARRR' && endpoint === 'send/status'
      ? endpoint
      : Object.hasOwn(mapping, endpoint)
        ? mapping[endpoint]
        : undefined
  const allowed =
    method === 'GET' ? protocol.reads : method === 'POST' ? protocol.writes : []
  if (!operation || !allowed.includes(operation)) return legacy
  return {
    pathname: `/crosschain/wallets/${coin}/${operation}${id ? '/' + id : ''}${match[3] ?? ''}`,
    sessionHeader: protocol.sessionHeader,
  }
}

/** The probe callback must be an authenticated, bounded, redirect-free GET to the pinned Core. */
export function createWalletApiProtocolCache() {
  const cache = new Map<
    string,
    { expires: number; value: WalletApiProtocol | null }
  >()
  return async (
    routeKey: string,
    coin: 'ARRR' | 'XMR',
    probe: () => Promise<unknown>,
    now = Date.now(),
  ) => {
    const key = `${routeKey}|${coin}`
    const saved = cache.get(key)
    if (saved && saved.expires > now) return saved.value
    let value: WalletApiProtocol | null = null
    try {
      value = parseWalletApiProtocol(await probe(), coin)
    } catch {
      /* Legacy or unavailable Core: select native route before dispatch. */
    }
    if (cache.size >= 64) cache.delete(cache.keys().next().value as string)
    cache.set(key, { value, expires: now + (value ? 60000 : 5000) })
    return value
  }
}
