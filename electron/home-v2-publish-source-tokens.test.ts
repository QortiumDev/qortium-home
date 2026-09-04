import assert from 'node:assert/strict'

import {
  HomeV2PublishSourceTokenStore,
  normalizeHomeV2PublishSourceToken,
  type HomeV2PublishSourceBinding,
} from './home-v2-publish-source-tokens.js'

let now = 1_000
const store = new HomeV2PublishSourceTokenStore<{ fileName: string }>(2, 100, () => now)
const binding = {
  accountId: 'wallet:one:0',
  appIdentity: 'qortium:APP/Chat/default',
  network: 'qortium' as const,
  nodeApiUrl: 'https://node.example',
  protocol: 'qdnRequest' as const,
  routeRevision: 'route-a',
  tabId: 'tab-a',
}
const first = store.issue(binding, { fileName: 'one.png' })
assert.equal(normalizeHomeV2PublishSourceToken(first), first)
assert.equal(store.resolve(first, binding).fileName, 'one.png')
assert.throws(() => store.resolve(first, { ...binding, accountId: 'wallet:two:0' }), /not available/)
assert.throws(() => store.resolve(first, { ...binding, network: 'qortal', protocol: 'qortalRequest' }), /not available/)
assert.throws(() => store.resolve(first, { ...binding, nodeApiUrl: 'https://other.example' }), /not available/)
assert.throws(() => store.resolve(first, { ...binding, routeRevision: 'route-b' }), /not available/)

now += 1
const second = store.issue(binding, { fileName: 'two.png' })
now += 1
const third = store.issue(binding, { fileName: 'three.png' })
assert.equal(store.size, 2)
assert.throws(() => store.resolve(first, binding), /expired/)
assert.equal(store.resolve(second, binding).fileName, 'two.png')
store.release(second)
assert.throws(() => store.resolve(second, binding), /expired/)

now += 100
store.prune()
assert.equal(store.size, 0)
assert.throws(() => normalizeHomeV2PublishSourceToken('../file'), /valid Home-issued/)


// --- byte budget (Android batch publishing) ---
// The count was never the real constraint: a retained selection is a Base64
// copy in WebView memory, so the store bounds TOTAL retained bytes and evicts
// least-recently-used entries to make room.
{
  const binding: HomeV2PublishSourceBinding = Object.freeze({
    accountId: 'wallet:one:0',
    appIdentity: 'qdn://APP/Test/default',
    network: 'qortium',
    nodeApiUrl: 'http://127.0.0.1:24891',
    protocol: 'qdnRequest',
    routeRevision: 'r1',
    tabId: 'tab-1',
  })
  const budgeted = new HomeV2PublishSourceTokenStore<{ bytes: number }>(
    10,
    undefined,
    undefined,
    { maximumBytes: 100, sizeOf: (source) => source.bytes },
  )
  const first = budgeted.issue(binding, { bytes: 40 })
  const second = budgeted.issue(binding, { bytes: 40 })
  assert.equal(budgeted.size, 2)
  // A third selection does not fit alongside both: the oldest is evicted.
  const third = budgeted.issue(binding, { bytes: 40 })
  assert.equal(budgeted.size, 2)
  assert.throws(() => budgeted.resolve(first, binding), /expired/)
  assert.deepEqual(budgeted.resolve(second, binding), { bytes: 40 })
  assert.deepEqual(budgeted.resolve(third, binding), { bytes: 40 })
  // One larger than the whole budget is refused rather than emptying the
  // store to make room for something that still would not fit.
  assert.throws(() => budgeted.issue(binding, { bytes: 101 }), /larger than Home can retain/)
  assert.equal(budgeted.size, 2)
  // Ten small selections coexist — the batch case the widening exists for.
  const small = new HomeV2PublishSourceTokenStore<{ bytes: number }>(
    10,
    undefined,
    undefined,
    { maximumBytes: 100, sizeOf: (source) => source.bytes },
  )
  for (let index = 0; index < 10; index += 1) small.issue(binding, { bytes: 5 })
  assert.equal(small.size, 10)
  // An eleventh still respects the count limit.
  small.issue(binding, { bytes: 5 })
  assert.equal(small.size, 10)
  // A store with no budget behaves exactly as before.
  const unbudgeted = new HomeV2PublishSourceTokenStore<{ bytes: number }>(2)
  unbudgeted.issue(binding, { bytes: 1_000_000 })
  unbudgeted.issue(binding, { bytes: 1_000_000 })
  assert.equal(unbudgeted.size, 2)
  // sizeOf is required whenever a budget is set.
  assert.throws(
    () => new HomeV2PublishSourceTokenStore<{ bytes: number }>(2, undefined, undefined, { maximumBytes: 10 }),
    /needs sizeOf/,
  )
}

console.log('Home v2 publish source token tests passed.')
