import assert from 'node:assert/strict'

import {
  HomeV2PublishSourceTokenStore,
  normalizeHomeV2PublishSourceToken,
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

console.log('Home v2 publish source token tests passed.')
