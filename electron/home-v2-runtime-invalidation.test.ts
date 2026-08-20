import assert from 'node:assert/strict'
import { normalizeHomeV2RuntimeInvalidation } from './home-v2-runtime-invalidation.js'

assert.deepEqual(normalizeHomeV2RuntimeInvalidation({ kind: 'locked' }), {
  kind: 'locked',
  tabId: null,
})
assert.deepEqual(normalizeHomeV2RuntimeInvalidation({
  kind: 'navigation-changed',
  tabId: 'tab-1',
}), {
  kind: 'navigation-changed',
  tabId: 'tab-1',
})
assert.throws(
  () => normalizeHomeV2RuntimeInvalidation({ kind: 'tab-closed' }),
  /requires a tab/,
)
assert.throws(
  () => normalizeHomeV2RuntimeInvalidation({ kind: 'restart' }),
  /is invalid/,
)

console.log('Home v2 runtime invalidation tests passed')
