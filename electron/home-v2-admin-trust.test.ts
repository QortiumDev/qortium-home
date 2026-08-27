import assert from 'node:assert/strict'

import {
  evaluateHomeV2AdminTrust,
  homeV2AdminTrustMessage,
  homeV2AdminTrustRevision,
  homeV2NodeOrigin,
} from './home-v2-admin-trust.js'

const LOCAL = 'http://127.0.0.1:24891'
const TUNNEL = 'http://localhost:24891'
const REMOTE_HTTPS = 'https://node.example.com'
const REMOTE_HTTP = 'http://node.example.com'
const KEY = 'A'.repeat(24)

const trust = (over: Partial<Parameters<typeof evaluateHomeV2AdminTrust>[0]> = {}) =>
  evaluateHomeV2AdminTrust({ mode: 'local', network: 'qortium', nodeApiUrl: LOCAL, managedApiKey: KEY, ...over })

// --- managed local Core ---
{
  const result = trust()
  assert.equal(result.trusted, true)
  if (!result.trusted) throw new Error('unreachable')
  assert.equal(result.source, 'managed')
  assert.equal(result.origin, 'http://127.0.0.1:24891')
  assert.equal(result.apiKey, KEY)
  assert.match(result.revision, /^[0-9a-f]{32}$/)
}
// A local route that is not loopback is a mis-set or tampered route.
assert.deepEqual(trust({ nodeApiUrl: REMOTE_HTTP }), { trusted: false, reason: 'transport-unsafe' })
assert.deepEqual(trust({ nodeApiUrl: 'http://localhost.evil.com' }), { trusted: false, reason: 'transport-unsafe' })
assert.deepEqual(trust({ managedApiKey: '' }), { trusted: false, reason: 'key-missing' })

// --- public / disabled / Qortal never qualify ---
assert.deepEqual(trust({ mode: 'network' }), { trusted: false, reason: 'public-node' })
assert.deepEqual(trust({ mode: 'disabled' }), { trusted: false, reason: 'node-disabled' })
assert.deepEqual(trust({ network: 'qortal' }), { trusted: false, reason: 'unsupported-network' })
// A public node with an attached key still refuses: it is someone else's Core.
assert.deepEqual(
  trust({ mode: 'network', attached: { apiKey: KEY, origin: REMOTE_HTTPS } }),
  { trusted: false, reason: 'public-node' },
)

// --- custom node with an attached key ---
const custom = (nodeApiUrl: string, attachedOrigin = nodeApiUrl, apiKey = KEY) =>
  evaluateHomeV2AdminTrust({
    attached: { apiKey, origin: attachedOrigin },
    mode: 'custom',
    network: 'qortium',
    nodeApiUrl,
  })
// The SSH-tunnel case: plain HTTP to loopback IS allowed.
for (const tunnelled of [TUNNEL, LOCAL, 'http://[::1]:24891']) {
  const result = custom(tunnelled)
  assert.equal(result.trusted, true, `${tunnelled} must be administrable`)
  if (!result.trusted) throw new Error('unreachable')
  assert.equal(result.source, 'attached')
}
// A remote node is administrable over HTTPS...
{
  const result = custom(REMOTE_HTTPS)
  assert.equal(result.trusted, true)
  if (!result.trusted) throw new Error('unreachable')
  assert.equal(result.origin, 'https://node.example.com')
}
// ...but never in the clear.
assert.deepEqual(custom(REMOTE_HTTP), { trusted: false, reason: 'transport-unsafe' })
// No key attached, or an empty one.
assert.deepEqual(
  evaluateHomeV2AdminTrust({ mode: 'custom', network: 'qortium', nodeApiUrl: REMOTE_HTTPS }),
  { trusted: false, reason: 'key-missing' },
)
assert.deepEqual(custom(REMOTE_HTTPS, REMOTE_HTTPS, ''), { trusted: false, reason: 'key-missing' })
// Origin binding: the key follows the node it was attached to, nothing else.
assert.deepEqual(custom(REMOTE_HTTPS, 'https://other.example.com'), { trusted: false, reason: 'origin-mismatch' })
assert.deepEqual(custom('https://node.example.com:8443', REMOTE_HTTPS), { trusted: false, reason: 'origin-mismatch' })
assert.deepEqual(custom(LOCAL, TUNNEL), { trusted: false, reason: 'origin-mismatch' })
// Equivalent spellings of the same origin do match (path/trailing slash).
{
  const result = custom('https://node.example.com/', 'https://node.example.com')
  assert.equal(result.trusted, true)
}

// --- revision binds origin AND key ---
{
  const a = homeV2AdminTrustRevision('https://node.example.com', KEY)
  assert.equal(a, homeV2AdminTrustRevision('https://node.example.com', KEY))
  assert.notEqual(a, homeV2AdminTrustRevision('https://node.example.com', `${KEY}B`))
  assert.notEqual(a, homeV2AdminTrustRevision('https://other.example.com', KEY))
  // The raw key must not be recoverable from, or present in, the revision.
  assert.equal(a.includes(KEY), false)
}

// --- origin helper ---
assert.equal(homeV2NodeOrigin('https://node.example.com/admin/status'), 'https://node.example.com')
assert.equal(homeV2NodeOrigin('not a url'), '')
assert.equal(homeV2NodeOrigin(null), '')

// --- refusal copy names the fix, never blames the platform ---
for (const reason of ['key-missing', 'origin-mismatch', 'public-node', 'transport-unsafe'] as const) {
  const message = homeV2AdminTrustMessage(reason, 'Editing lists')
  assert.ok(message.startsWith('Editing lists'), reason)
  assert.equal(/phone|mobile|android|desktop/i.test(message), false, `${reason} must not gate on platform`)
}

console.log('Home v2 admin trust tests passed.')
