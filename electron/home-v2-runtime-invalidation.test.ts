import assert from 'node:assert/strict'
import { normalizeHomeV2RuntimeInvalidation } from './home-v2-runtime-invalidation.js'

assert.deepEqual(normalizeHomeV2RuntimeInvalidation({ kind: 'locked' }), {
  kind: 'locked',
  network: null,
  tabId: null,
})
assert.deepEqual(normalizeHomeV2RuntimeInvalidation({
  kind: 'navigation-changed',
  tabId: 'tab-1',
}), {
  kind: 'navigation-changed',
  network: null,
  tabId: 'tab-1',
})
assert.deepEqual(normalizeHomeV2RuntimeInvalidation({
  kind: 'node-changed',
  network: 'qortium',
}), {
  kind: 'node-changed',
  network: 'qortium',
  tabId: null,
})
// A replacement always names the one tab whose app changed; without a tab it
// would be indistinguishable from a request to clear every grant.
assert.deepEqual(normalizeHomeV2RuntimeInvalidation({
  kind: 'app-replaced',
  tabId: 'tab-1',
}), {
  kind: 'app-replaced',
  network: null,
  tabId: 'tab-1',
})
assert.throws(
  () => normalizeHomeV2RuntimeInvalidation({ kind: 'app-replaced' }),
  /requires a tab/,
)
assert.throws(
  () => normalizeHomeV2RuntimeInvalidation({ kind: 'tab-closed' }),
  /requires a tab/,
)
assert.throws(
  () => normalizeHomeV2RuntimeInvalidation({ kind: 'restart' }),
  /is invalid/,
)
assert.throws(
  () => normalizeHomeV2RuntimeInvalidation({ kind: 'node-changed' }),
  /requires a network/,
)

console.log('Home v2 runtime invalidation tests passed')
