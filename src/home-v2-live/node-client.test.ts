import assert from 'node:assert/strict'
import {
  buildHomeV2AvatarPath,
  createPortableNodeClient,
  parseHomeV2AvatarResponse,
  normalizePortableNodeUrl,
  type PortableNodeClientDependencies,
} from './node-client'
import { parseHomeV2AccountCatalogueStore } from './account-catalogue'
import { validateVisibleAvatarPayload } from '../v2/shell/VisibleIdentityAvatar'

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
  [
    'qortium-home-wallet-store',
    JSON.stringify({
      activeAccountId: 'wallet:one:2',
      wallets: [
        {
          address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
          derivedAddresses: [
            { address: 'QH143K3FAiM4CHbm7cbYguCyYCdLMGW5YE', index: 2 },
          ],
          encryptedWallet: {
            encryptedSeed: 'must-not-cross-the-bridge',
            salt: 'also-secret-adjacent',
            version: 2,
          },
          id: 'wallet:one',
          label: 'Main account',
          sourceFilename: '/private/wallet.json',
        },
      ],
    }),
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
  async requestBinary() {
    return {
      data: 'iVBORw0KGgo=',
      headers: { 'content-type': 'application/octet-stream' },
      status: 200,
    }
  },
  now: () => 1_700_000_000_000,
}

const client = createPortableNodeClient(dependencies)

const catalogue = await client.listAccounts()
assert.equal(catalogue.activeAccountId, 'wallet:one:2')
assert.deepEqual(catalogue.accounts, [
  {
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
    addressIndex: 0,
    id: 'wallet:one',
    isUnlocked: false,
    label: 'Main account',
    supportsDerivedAddresses: true,
    walletId: 'wallet:one',
  },
  {
    address: 'QH143K3FAiM4CHbm7cbYguCyYCdLMGW5YE',
    addressIndex: 2,
    id: 'wallet:one:2',
    isUnlocked: false,
    label: 'Main account · 2',
    supportsDerivedAddresses: true,
    walletId: 'wallet:one',
  },
])
assert.doesNotMatch(
  JSON.stringify(catalogue),
  /encryptedSeed|salt|sourceFilename|private\/wallet/,
)
assert.deepEqual(parseHomeV2AccountCatalogueStore('{broken'), {
  accounts: [],
  activeAccountId: null,
})

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

const avatarRequest = {
  address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
  pointer: {
    identifier: 'qortal_avatar',
    name: 'Alice Smith',
    service: 'THUMBNAIL',
    source: 'legacy-name' as const,
  },
}
assert.equal(
  buildHomeV2AvatarPath('qortal', avatarRequest),
  '/arbitrary/THUMBNAIL/Alice%20Smith/qortal_avatar?async=true',
)
assert.equal(
  buildHomeV2AvatarPath('qortium', {
    ...avatarRequest,
    pointer: {
      identifier: 'portrait',
      name: 'Alice',
      service: 'THUMBNAIL',
      source: 'account-pointer',
    },
  }),
  '/addresses/QH143K2qjVdn864NSY7aNESo88ao1ZnALH/avatar',
)
assert.throws(
  () =>
    buildHomeV2AvatarPath('qortium', {
      ...avatarRequest,
      pointer: { ...avatarRequest.pointer, identifier: 'qortal_avatar' },
    }),
  /does not match/,
)

const readyAvatar = parseHomeV2AvatarResponse({
  data: 'iVBORw0KGgo=',
  headers: { 'content-length': '8', 'content-type': 'text/html' },
  status: 200,
})
assert.equal(readyAvatar.status, 'ready')
if (readyAvatar.status === 'ready') {
  assert.equal(readyAvatar.contentType, 'image/png')
  assert.equal(readyAvatar.contentLength, 8)
}
assert.equal(
  validateVisibleAvatarPayload('iVBORw0KGgo=', 8, 'image/png').byteLength,
  8,
)
assert.throws(
  () => validateVisibleAvatarPayload('iVBORw0KGgo=', 7, 'image/png'),
  /byte length/,
)
assert.throws(
  () => validateVisibleAvatarPayload('iVBORw0KGgo=', 8, 'text\/html'),
  /content type/,
)
assert.equal(
  parseHomeV2AvatarResponse({
    data: 'iVBORw0KGgo=',
    headers: { 'content-length': String(500 * 1024 + 1) },
    status: 200,
  }).status,
  'unavailable',
)
assert.deepEqual(
  parseHomeV2AvatarResponse({ data: '', headers: { 'retry-after': '4' }, status: 202 }),
  { retryAfterSeconds: 4, status: 'pending' },
)
assert.equal(
  parseHomeV2AvatarResponse({
    data: btoa('<script>'),
    headers: { 'content-type': 'image/png' },
    status: 200,
  }).status,
  'unavailable',
)

await client.setMode('qortal', 'public')
const avatar = await client.readAvatar('qortal', avatarRequest)
assert.equal(avatar.status, 'ready')
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
