import assert from 'node:assert/strict'
import {
  createPortableNodeClient,
  normalizePortableNodeUrl,
  type PortableNodeClientDependencies,
} from './node-client'

const syncedStatus = {
  height: 123,
  isSynchronizing: false,
  numberOfConnections: 8,
  syncBlocksRemaining: 0,
  syncPercent: 100,
  syncPhase: 'SYNCED',
}

type Snapshot = {
  nodes: {
    qortal: { error: string | null; localCoreState: string; nodeApiUrl: string | null }
    qortium: { nodeApiUrl: string | null }
  }
  version: number
}

const preferences = new Map<string, string>([
  [
    'home-v2-live-node:qortium',
    JSON.stringify({ customUrl: '', mode: 'disabled' }),
  ],
])
const latency = new Map([
  ['https://ext-node.qortal.link', 50],
  ['https://api.qortal.org', 10],
])
const unavailable = new Set<string>()
const requestCount = new Map<string, number>()

const dependencies: PortableNodeClientDependencies = {
  async getPreference(key) {
    return preferences.get(key) ?? null
  },
  async setPreference(key, value) {
    preferences.set(key, value)
  },
  async requestJson(url) {
    const origin = new URL(url).origin
    requestCount.set(origin, (requestCount.get(origin) ?? 0) + 1)
    if (unavailable.has(origin)) {
      return { data: null, latencyMs: 1, ok: false, status: 503 }
    }
    return {
      data: url.includes('/admin/status') ? syncedStatus : [],
      latencyMs: latency.get(origin) ?? 1,
      ok: true,
      status: 200,
    }
  },
  now: () => 1_700_000_000_000,
}

const client = createPortableNodeClient(dependencies)

const first = (await client.getSnapshot()) as Snapshot
assert.equal(first.version, 1)
assert.equal(first.nodes.qortal.nodeApiUrl, 'https://api.qortal.org')
assert.equal(first.nodes.qortal.localCoreState, 'unsupported')

latency.set('https://ext-node.qortal.link', 1)
latency.set('https://api.qortal.org', 100)
requestCount.clear()
const sticky = (await client.getSnapshot()) as Snapshot
assert.equal(sticky.nodes.qortal.nodeApiUrl, 'https://api.qortal.org')
assert.equal(requestCount.has('https://ext-node.qortal.link'), false)

unavailable.add('https://api.qortal.org')
requestCount.clear()
const failedOver = (await client.getSnapshot()) as Snapshot
assert.equal(failedOver.nodes.qortal.nodeApiUrl, 'https://ext-node.qortal.link')
assert.equal(requestCount.has('https://ext-node.qortal.link'), true)

await assert.rejects(
  () => client.setCustomUrl('qortal', 'http://remote.example:12391'),
  /must use HTTPS/,
)
assert.equal(normalizePortableNodeUrl('localhost:12391'), 'https://localhost:12391')
assert.equal(
  normalizePortableNodeUrl('http://127.0.0.1:12391/path'),
  'http://127.0.0.1:12391',
)

unavailable.delete('https://custom.example')
const custom = (await client.setCustomUrl(
  'qortal',
  'https://custom.example/path',
)) as Snapshot
assert.equal(custom.nodes.qortal.nodeApiUrl, 'https://custom.example')

requestCount.clear()
const local = (await client.setMode('qortal', 'local')) as Snapshot
assert.equal(local.nodes.qortal.nodeApiUrl, null)
assert.match(local.nodes.qortal.error ?? '', /not available/i)
assert.equal(requestCount.size, 0)

const localIdentity = await client.readIdentity('qortal', {
  kind: 'name',
  value: 'Alice',
})
assert.equal(localIdentity.status, 503)

await client.setMode('qortal', 'public')
const identity = await client.readIdentity('qortal', {
  kind: 'namesByAddress',
  value: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
})
assert.equal(identity.status, 200)

await assert.rejects(
  () => client.readIdentity('qortal', { kind: 'name', value: '' }),
  /1 to 128/,
)

console.log('Home v2 portable node client tests passed.')
