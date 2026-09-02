/**
 * Deciding whether the SELECTED Core actually implements the Home-signed send
 * route, without ever guessing in the direction that advertises a capability.
 *
 * Administrative trust says a node will answer authenticated calls; it does
 * not say the node is new enough to have
 * `/crosschain/<coin>/wallet/public/spend-context`. The probe posts a
 * deliberately INVALID body and reads the answer:
 *
 *  - SUPPORTED needs an AFFIRMATIVE signal — the route rejected the body on
 *    its merits, i.e. a 4xx that is not "there is no such route" and not an
 *    authentication or rate-limit answer, which say nothing about the route.
 *  - UNSUPPORTED is 404/405: the node is telling us the route is absent.
 *  - INCONCLUSIVE is everything else: a 5xx, a timeout, a dropped connection,
 *    an auth failure, or a 2xx that an invalid body should never have earned.
 *
 * Inconclusive advertises `send: false`, because a capability Home cannot
 * demonstrate must not be offered. An inconclusive answer is cached only
 * briefly so a blip recovers on the next read rather than hiding a real Core
 * for minutes; a settled `supported`/`unsupported` answer is cached for the
 * full TTL. An inconclusive outcome is never upgraded to `supported`.
 */

export type ForeignWalletRouteProbeOutcome = 'supported' | 'unsupported' | 'inconclusive'

export const FOREIGN_WALLET_ROUTE_PROBE_TTL_MS = 5 * 60_000
export const FOREIGN_WALLET_ROUTE_PROBE_INCONCLUSIVE_TTL_MS = 30_000
export const FOREIGN_WALLET_ROUTE_PROBE_MAX_ENTRIES = 32

/** Answers that describe the CALLER, not the route, so they prove nothing. */
const UNINFORMATIVE_STATUSES = new Set([401, 402, 403, 407, 408, 429])

export function classifyForeignWalletRouteProbe(result: Readonly<{
  ok: boolean
  status?: unknown
}>): ForeignWalletRouteProbeOutcome {
  const status = typeof result.status === 'number' && Number.isSafeInteger(result.status)
    ? result.status
    : null
  if (status === null) return 'inconclusive'
  if (status === 404 || status === 405) return 'unsupported'
  // A 2xx to a body the route should have rejected is not evidence the route
  // is there; something else answered.
  if (result.ok) return 'inconclusive'
  if (status < 400 || status >= 500) return 'inconclusive'
  if (UNINFORMATIVE_STATUSES.has(status)) return 'inconclusive'
  return 'supported'
}

export function foreignWalletRouteProbeTtlMs(outcome: ForeignWalletRouteProbeOutcome) {
  return outcome === 'inconclusive'
    ? FOREIGN_WALLET_ROUTE_PROBE_INCONCLUSIVE_TTL_MS
    : FOREIGN_WALLET_ROUTE_PROBE_TTL_MS
}

/**
 * A hard-bounded LRU. The key is one node route and API-key revision; a Home
 * that has seen many nodes must not grow this without limit, and the bound is
 * enforced on every write rather than swept opportunistically.
 */
export function createForeignWalletRouteProbeCache(
  maxEntries = FOREIGN_WALLET_ROUTE_PROBE_MAX_ENTRIES,
) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new Error('Foreign wallet route probe cache size is invalid.')
  }
  const entries = new Map<string, { checkedAt: number; outcome: ForeignWalletRouteProbeOutcome }>()

  function read(key: string, now: number): ForeignWalletRouteProbeOutcome | null {
    const entry = entries.get(key)
    if (!entry) return null
    if (now - entry.checkedAt >= foreignWalletRouteProbeTtlMs(entry.outcome)) {
      entries.delete(key)
      return null
    }
    // Reading refreshes recency, so a route in active use is not evicted by a
    // burst of one-off lookups.
    entries.delete(key)
    entries.set(key, entry)
    return entry.outcome
  }

  function write(key: string, outcome: ForeignWalletRouteProbeOutcome, now: number) {
    entries.delete(key)
    entries.set(key, { checkedAt: now, outcome })
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next()
      if (oldest.done) break
      entries.delete(oldest.value)
    }
    return outcome
  }

  return Object.freeze({ read, size: () => entries.size, write })
}
