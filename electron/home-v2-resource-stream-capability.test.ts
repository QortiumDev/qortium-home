import assert from 'node:assert/strict'
import {
  assertHomeV2ResourceStreamResponseBounds,
  buildHomeV2ResourceStreamCapabilityUrl,
  HOME_V2_RESOURCE_STREAM_RESPONSE_MAX_BYTES,
  HOME_V2_RESOURCE_STREAM_TOTAL_MAX_BYTES,
  HOME_V2_RESOURCE_STREAM_TTL_MS,
  HomeV2ResourceStreamCapabilityStore,
  normalizeHomeV2ResourceRange,
  parseHomeV2ResourceStreamCapabilityUrl,
} from './home-v2-resource-stream-capability.js'

const tokens = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
]
let now = 1_000
const store = new HomeV2ResourceStreamCapabilityStore(() => now, () => tokens.shift()!)
const binding = {
  accountId: 'account-1',
  appIdentity: 'qdn://APP/Chat/default',
  network: 'qortium' as const,
  nodeApiUrl: 'https://127.0.0.1:24891',
  protocol: 'qdnRequest' as const,
  routeRevision: 'route-1',
  tabId: 'tab-1',
}
const issued = store.issue({ binding, mimeType: ' Video/MP4 ', upstreamUrl: 'https://127.0.0.1:24891/render/VIDEO/Alice' })
assert.equal(issued.url, buildHomeV2ResourceStreamCapabilityUrl(issued.entry.token))
assert.equal(parseHomeV2ResourceStreamCapabilityUrl(issued.url), issued.entry.token)
assert.equal(store.resolve(issued.entry.token).mimeType, 'video/mp4')
assert.throws(() => parseHomeV2ResourceStreamCapabilityUrl(`${issued.url}?leak=1`), /invalid/)
assert.throws(() => store.issue({ binding, upstreamUrl: 'https://user:pass@example.test/render/VIDEO/Alice' }), /credentials/)

assert.equal(normalizeHomeV2ResourceRange(' bytes=0-1023 '), 'bytes=0-1023')
assert.equal(normalizeHomeV2ResourceRange('bytes=10-'), 'bytes=10-')
for (const value of ['bytes=-10', 'bytes=0-1,4-5', 'items=0-1', 'bytes=2-1']) {
  assert.throws(() => normalizeHomeV2ResourceRange(value), /range|supported/)
}

assert.doesNotThrow(() => assertHomeV2ResourceStreamResponseBounds(new Headers({
  'content-length': '1024',
  'content-range': 'bytes 0-1023/4096',
})))
assert.throws(() => assertHomeV2ResourceStreamResponseBounds(new Headers({
  'content-length': String(HOME_V2_RESOURCE_STREAM_RESPONSE_MAX_BYTES + 1),
})), /per-request/)
assert.throws(() => assertHomeV2ResourceStreamResponseBounds(new Headers({
  'content-range': `bytes 0-10/${HOME_V2_RESOURCE_STREAM_TOTAL_MAX_BYTES + 1}`,
})), /total/)

now += HOME_V2_RESOURCE_STREAM_TTL_MS
assert.throws(() => store.resolve(issued.entry.token), /expired/)

console.log('Home v2 resource stream capability tests passed.')
