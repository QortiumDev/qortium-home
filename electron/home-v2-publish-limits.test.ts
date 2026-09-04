import assert from 'node:assert/strict'

import { evaluateHomeV2AdminTrust } from './home-v2-admin-trust.js'
import {
  deriveHomeV2QdnPublishLimit,
  getHomeV2QdnPublishLimit,
  HOME_V2_AUTHENTICATED_PUBLISH_HARD_MAX_BYTES,
  shouldUseAuthenticatedQdnPublish,
} from './home-v2-publish-limits.js'

const MiB = 1024 * 1024
const API_KEY = 'A'.repeat(24)
const BINDING_ID = 'b'.repeat(32)

const trustCases = [
  evaluateHomeV2AdminTrust({
    managedApiKey: API_KEY,
    managedBindingId: BINDING_ID,
    mode: 'local',
    network: 'qortium',
    nodeApiUrl: 'http://127.0.0.1:12391',
  }),
  evaluateHomeV2AdminTrust({
    attached: { apiKey: API_KEY, bindingId: BINDING_ID, origin: 'https://node.example' },
    mode: 'custom',
    network: 'qortium',
    nodeApiUrl: 'https://node.example',
  }),
] as const
for (const trust of trustCases) {
  assert.equal(shouldUseAuthenticatedQdnPublish('qortium', trust), true)
}

const refusalCases = [
  evaluateHomeV2AdminTrust({ mode: 'network', network: 'qortium', nodeApiUrl: 'https://public.example' }),
  evaluateHomeV2AdminTrust({ mode: 'local', network: 'qortium', nodeApiUrl: 'http://127.0.0.1:12391' }),
  evaluateHomeV2AdminTrust({
    attached: { apiKey: API_KEY, bindingId: BINDING_ID, origin: 'https://other.example' },
    mode: 'custom',
    network: 'qortium',
    nodeApiUrl: 'https://node.example',
  }),
  evaluateHomeV2AdminTrust({
    attached: { apiKey: API_KEY, bindingId: BINDING_ID, origin: 'http://node.example' },
    mode: 'custom',
    network: 'qortium',
    nodeApiUrl: 'http://node.example',
  }),
  evaluateHomeV2AdminTrust({ mode: 'disabled', network: 'qortium', nodeApiUrl: 'https://node.example' }),
] as const
for (const trust of refusalCases) {
  assert.equal(trust.trusted, false)
  assert.equal(shouldUseAuthenticatedQdnPublish('qortium', trust), false)
}
assert.equal(shouldUseAuthenticatedQdnPublish('qortal', trustCases[0]), false)

assert.deepEqual(
  deriveHomeV2QdnPublishLimit({ publishMaxSize: 2_000 * MiB, publicPublishMaxSize: 100 * MiB }, true),
  { maximumBytes: 2_000 * MiB, route: 'authenticated' },
)
assert.deepEqual(
  deriveHomeV2QdnPublishLimit({ publishMaxSize: 2_000 * MiB, publicPublishMaxSize: 100 * MiB }, false),
  { maximumBytes: 100 * MiB, route: 'public' },
)
assert.equal(
  deriveHomeV2QdnPublishLimit({ publicPublishMaxSize: 250 * MiB }, false).maximumBytes,
  100 * MiB,
)
assert.equal(
  deriveHomeV2QdnPublishLimit({ publishMaxSize: Number.MAX_SAFE_INTEGER }, true).maximumBytes,
  HOME_V2_AUTHENTICATED_PUBLISH_HARD_MAX_BYTES,
)
assert.equal(deriveHomeV2QdnPublishLimit({ publishMaxSize: 0 }, true).maximumBytes, 100 * MiB)
assert.equal(deriveHomeV2QdnPublishLimit({}, false).maximumBytes, 100 * MiB)

const fetched: string[] = []
const remote = await getHomeV2QdnPublishLimit('https://node.example', true, async (url) => {
  fetched.push(url)
  return new Response(JSON.stringify({ publishMaxSize: 512 * MiB, publicPublishMaxSize: 80 * MiB }))
})
assert.deepEqual(remote, { maximumBytes: 512 * MiB, route: 'authenticated' })
assert.deepEqual(fetched, ['https://node.example/arbitrary/limits'])

const fallback = await getHomeV2QdnPublishLimit('https://old.example', true, async () => {
  throw new Error('unsupported')
})
assert.deepEqual(fallback, { maximumBytes: 100 * MiB, route: 'authenticated' })

console.log('Home v2 QDN publish-limit tests passed.')
