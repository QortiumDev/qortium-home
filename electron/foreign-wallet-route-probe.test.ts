import assert from 'node:assert/strict'

import {
  classifyForeignWalletRouteProbe,
  createForeignWalletRouteProbeCache,
  foreignWalletRouteProbeTtlMs,
  FOREIGN_WALLET_ROUTE_PROBE_INCONCLUSIVE_TTL_MS,
  FOREIGN_WALLET_ROUTE_PROBE_MAX_ENTRIES,
  FOREIGN_WALLET_ROUTE_PROBE_TTL_MS,
} from './foreign-wallet-route-probe.js'

// --- classification ---------------------------------------------------------
//
// SUPPORTED needs an affirmative answer: the route rejected a deliberately
// invalid body on its merits. Everything that merely fails to disprove the
// route is inconclusive, and inconclusive advertises no capability.

// The route is there and validated the body.
for (const status of [400, 409, 415, 422]) {
  assert.equal(classifyForeignWalletRouteProbe({ ok: false, status }), 'supported', String(status))
}
// The node says the route is absent.
for (const status of [404, 405]) {
  assert.equal(classifyForeignWalletRouteProbe({ ok: false, status }), 'unsupported', String(status))
}
// Answers about the CALLER, not the route: they prove nothing either way.
for (const status of [401, 402, 403, 407, 408, 429]) {
  assert.equal(classifyForeignWalletRouteProbe({ ok: false, status }), 'inconclusive', String(status))
}
// Server-side failures and transport failures.
for (const status of [500, 502, 503, 504]) {
  assert.equal(classifyForeignWalletRouteProbe({ ok: false, status }), 'inconclusive', String(status))
}
for (const status of [undefined, null, 'nope', Number.NaN, 1.5]) {
  assert.equal(classifyForeignWalletRouteProbe({ ok: false, status }), 'inconclusive', String(status))
}
// A 2xx to a body the route should have rejected is not evidence of the route.
assert.equal(classifyForeignWalletRouteProbe({ ok: true, status: 200 }), 'inconclusive')
assert.equal(classifyForeignWalletRouteProbe({ ok: true, status: 204 }), 'inconclusive')
// A redirect is not an answer about the route either.
assert.equal(classifyForeignWalletRouteProbe({ ok: false, status: 302 }), 'inconclusive')

// --- time to live -----------------------------------------------------------
//
// A settled answer is kept for minutes; an inconclusive one only briefly, so a
// blip does not hide a working Core for long. It is never kept as supported.

assert.equal(foreignWalletRouteProbeTtlMs('supported'), FOREIGN_WALLET_ROUTE_PROBE_TTL_MS)
assert.equal(foreignWalletRouteProbeTtlMs('unsupported'), FOREIGN_WALLET_ROUTE_PROBE_TTL_MS)
assert.equal(foreignWalletRouteProbeTtlMs('inconclusive'), FOREIGN_WALLET_ROUTE_PROBE_INCONCLUSIVE_TTL_MS)
assert.ok(FOREIGN_WALLET_ROUTE_PROBE_INCONCLUSIVE_TTL_MS < FOREIGN_WALLET_ROUTE_PROBE_TTL_MS)

{
  const cache = createForeignWalletRouteProbeCache()
  cache.write('node|rev', 'supported', 1_000)
  assert.equal(cache.read('node|rev', 1_000), 'supported')
  assert.equal(cache.read('node|rev', 1_000 + FOREIGN_WALLET_ROUTE_PROBE_TTL_MS - 1), 'supported')
  assert.equal(cache.read('node|rev', 1_000 + FOREIGN_WALLET_ROUTE_PROBE_TTL_MS), null)
  // An expired entry is dropped rather than lingering.
  assert.equal(cache.size(), 0)
}

{
  const cache = createForeignWalletRouteProbeCache()
  cache.write('node|rev', 'inconclusive', 1_000)
  assert.equal(cache.read('node|rev', 1_000 + FOREIGN_WALLET_ROUTE_PROBE_INCONCLUSIVE_TTL_MS - 1), 'inconclusive')
  // Thirty seconds later the node is asked again, so a momentary failure does
  // not withhold a real capability for minutes.
  assert.equal(cache.read('node|rev', 1_000 + FOREIGN_WALLET_ROUTE_PROBE_INCONCLUSIVE_TTL_MS), null)
}

// A route whose API key rotates is a different entry: an answer for one
// revision never speaks for another.
{
  const cache = createForeignWalletRouteProbeCache()
  cache.write('node|rev-1', 'supported', 1_000)
  assert.equal(cache.read('node|rev-2', 1_000), null)
  assert.equal(cache.read('other|rev-1', 1_000), null)
}

// --- the hard bound ---------------------------------------------------------

{
  const cache = createForeignWalletRouteProbeCache(3)
  for (const key of ['a', 'b', 'c', 'd']) cache.write(key, 'supported', 1_000)
  assert.equal(cache.size(), 3, 'the cache never exceeds its bound')
  assert.equal(cache.read('a', 1_000), null, 'the oldest entry is the one evicted')
  assert.equal(cache.read('d', 1_000), 'supported')

  // Reading refreshes recency, so a route in active use survives a burst of
  // one-off lookups.
  cache.read('b', 1_000)
  cache.write('e', 'supported', 1_000)
  assert.equal(cache.read('b', 1_000), 'supported')
  assert.equal(cache.read('c', 1_000), null)

  // Rewriting an existing key updates it in place rather than growing.
  const stable = createForeignWalletRouteProbeCache(2)
  stable.write('x', 'supported', 1_000)
  stable.write('x', 'unsupported', 2_000)
  assert.equal(stable.size(), 1)
  assert.equal(stable.read('x', 2_000), 'unsupported')
}

assert.equal(FOREIGN_WALLET_ROUTE_PROBE_MAX_ENTRIES, 32)
assert.throws(() => createForeignWalletRouteProbeCache(0), /cache size is invalid/)
assert.throws(() => createForeignWalletRouteProbeCache(1.5), /cache size is invalid/)

console.log('Foreign wallet route probe tests passed.')
