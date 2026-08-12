import assert from 'node:assert/strict'
import {
  buildHomeV2AvatarPath,
  buildHomeV2AppResourceSearchPath,
  createPortableNodeClient,
  normalizeHomeV2AvatarReadResult,
  parseHomeV2AppResourceCandidates,
  parseHomeV2AvatarResponse,
  normalizePortableNodeUrl,
  type PortableNodeClientDependencies,
} from './node-client'
import { parseHomeV2AccountCatalogueStore } from './account-catalogue'
import { validateVisibleAvatarPayload } from '../v2/shell/VisibleIdentityAvatar'
import { getHomeV2AppActions } from '../../electron/home-v2-app-actions'

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
let lastRequestedUrl = ''
let lastRequestedTimeoutMs: number | undefined

const dependencies: PortableNodeClientDependencies = {
  async getPreference(key) {
    return preferences.get(key) ?? null
  },
  async setPreference(key, value) {
    preferences.set(key, value)
  },
  async requestJson(url, _method, timeoutMs) {
    lastRequestedUrl = url
    lastRequestedTimeoutMs = timeoutMs
    const origin = new URL(url).origin
    requestCount.set(origin, (requestCount.get(origin) ?? 0) + 1)
    if (unavailable.has(origin)) {
      return { data: null, latencyMs: 1, ok: false, status: 503 }
    }
    return {
      data: url.includes('/admin/status')
        ? syncedStatus
        : url.includes('/arbitrary/resources/search') && url.includes('name=Trust')
          ? [{ identifier: 'Trust', name: 'Trust', service: 'APP' }]
          : url.includes('/at/AbsntbeMZM7VQjaX5PSuTf2fQxUeMWLPbV')
            ? null
            : url.endsWith('/at/AaVzcbeMZM7VQjaX5PSuTf2fQxUeMWLPbV')
              ? { atAddress: 'AaVzcbeMZM7VQjaX5PSuTf2fQxUeMWLPbV', version: 2 }
              : [],
      latencyMs: latency.get(origin) ?? 1,
      headers: { 'x-total-count': '7' },
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

await client.saveShellState({ version: 1, selectedAccountId: 'wallet:one:2' })
assert.deepEqual(await client.getShellState(), {
  version: 1,
  selectedAccountId: 'wallet:one:2',
})
assert.deepEqual(
  await client.requestApp('qdnRequest', { action: 'SHOW_ACTIONS' }),
  getHomeV2AppActions('qdnRequest'),
)
assert.deepEqual(
  await client.requestApp('qortalRequest', { action: 'SHOW_ACTIONS' }),
  getHomeV2AppActions('qortalRequest'),
)
assert.equal(getHomeV2AppActions('qdnRequest').includes('GET_SELECTED_ACCOUNT'), true)
assert.equal(getHomeV2AppActions('qdnRequest').includes('UNLOCK_SELECTED_ACCOUNT'), true)
assert.equal(getHomeV2AppActions('qortalRequest').includes('GET_USER_ACCOUNT'), true)
assert.equal(getHomeV2AppActions('qortalRequest').includes('GET_SELECTED_ACCOUNT'), false)
assert.equal(getHomeV2AppActions('qortalRequest').includes('UNLOCK_SELECTED_ACCOUNT'), false)
assert.deepEqual(
  await client.requestApp('qdnRequest', {
    action: 'OPEN_NEW_TAB',
    address: 'qortal://APP/Q-Tube',
  }),
  { address: 'qortal://APP/Q-Tube', openIn: 'new-tab' },
)
const qortalRead = await client.requestApp('qortalRequest', {
  action: 'FETCH_NODE_API',
  path: '/names/Alice',
}) as { headers: Record<string, string>; ok: boolean; status: number }
assert.equal(qortalRead.ok, true)
assert.equal(qortalRead.status, 200)
assert.equal(qortalRead.headers['x-total-count'], '7')
assert.equal(lastRequestedTimeoutMs, 30_000)
assert.match(lastRequestedUrl, /^https:\/\/(api\.qortal\.org|ext-node\.qortal\.link)\/names\/Alice$/)
await assert.rejects(
  () => client.requestApp('qdnRequest', { action: 'FETCH_NODE_API', path: '/admin/stop' }),
  /outside Home v2 read-only scope/,
)

assert.deepEqual(
  await client.requestApp('qortalRequest', {
    action: 'GET_AT',
    atAddress: 'AaVzcbeMZM7VQjaX5PSuTf2fQxUeMWLPbV',
  }),
  { atAddress: 'AaVzcbeMZM7VQjaX5PSuTf2fQxUeMWLPbV', version: 2 },
)
assert.match(
  lastRequestedUrl,
  /^https:\/\/(api\.qortal\.org|ext-node\.qortal\.link)\/at\/AaVzcbeMZM7VQjaX5PSuTf2fQxUeMWLPbV$/,
)
// A valid-but-absent AT answers with an empty 2xx body on both cores; the
// bridge must normalize that to one documented error instead of returning ''.
await assert.rejects(
  () => client.requestApp('qortalRequest', {
    action: 'GET_AT_DATA',
    atAddress: 'AbsntbeMZM7VQjaX5PSuTf2fQxUeMWLPbV',
  }),
  /AT not found/,
)
assert.deepEqual(
  await client.requestApp('qortalRequest', {
    action: 'SEARCH_NAMES',
    limit: 5,
    query: 'Ali',
  }),
  [],
)
assert.match(lastRequestedUrl, /\/names\/search\?query=Ali&limit=5$/)
assert.deepEqual(
  await client.requestApp('qortalRequest', { action: 'LIST_GROUPS', limit: 0 }),
  [],
)
assert.match(lastRequestedUrl, /\/groups\?limit=0$/)
await assert.rejects(
  () => client.requestApp('qortalRequest', { action: 'LIST_ATS', codeHash58: 'bad' }),
  /codeHash58/,
)
await assert.rejects(
  () => client.requestApp('qortalRequest', { action: 'SEARCH_NAMES', prefix: 'true', query: 'Ali' }),
  /must be true or false/,
)

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
assert.match(buildHomeV2AppResourceSearchPath('Trust'), /name=Trust/)
assert.deepEqual(
  parseHomeV2AppResourceCandidates(
    [
      { identifier: 'Trust', name: 'Trust', service: 'APP' },
      { name: 'Trust', service: 'APP' },
      { identifier: 'Ignore', name: 'Other', service: 'APP' },
    ],
    'trust',
  ),
  [
    { identifier: null, name: 'Trust' },
    { identifier: 'Trust', name: 'Trust' },
  ],
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
assert.deepEqual(
  normalizeHomeV2AvatarReadResult(
    avatarRequest,
    { status: 'missing' },
  ),
  { retryAfterSeconds: 2, status: 'pending' },
)
assert.deepEqual(
  normalizeHomeV2AvatarReadResult(
    {
      ...avatarRequest,
      pointer: {
        identifier: 'portrait',
        name: 'Alice',
        service: 'THUMBNAIL',
        source: 'account-pointer',
      },
    },
    { status: 'missing' },
  ),
  { status: 'missing' },
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
await client.setMode('qortium', 'public')
assert.equal(getHomeV2AppActions('qdnRequest').includes('GET_ASSET_BALANCES'), true)
assert.equal(getHomeV2AppActions('qortalRequest').includes('GET_ASSET_BALANCES'), false)
assert.deepEqual(
  await client.requestApp('qdnRequest', {
    action: 'GET_ASSET_BALANCES',
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
    assetId: 5,
    excludeZero: true,
  }),
  [],
)
assert.equal(
  `${new URL(lastRequestedUrl).pathname}${new URL(lastRequestedUrl).search}`,
  '/assets/balances?address=QH143K2qjVdn864NSY7aNESo88ao1ZnALH&assetid=5&excludeZero=true',
)
await assert.rejects(
  () => client.requestApp('qdnRequest', {
    action: 'GET_ASSET_BALANCES',
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
    assetId: 'invalid',
  }),
  /non-negative safe integer/,
)
await assert.rejects(
  () => client.requestApp('qortalRequest', { action: 'GET_ASSET_INFO', assetId: 5 }),
  /not available in Home v2 read-only mode/,
)
const appContext = {
  resourceLocation: 'qdn://APP/Trust/Trust',
  selectedAccountId: 'wallet:one:2',
  tabId: 'home-v2:tab:test',
}
assert.deepEqual(
  await client.requestApp('qdnRequest', { action: 'GET_SELECTED_ACCOUNT' }, appContext),
  {
    address: 'QH143K3FAiM4CHbm7cbYguCyYCdLMGW5YE',
    avatarContract: 'pointer-aware-account-avatar-v1',
    avatarUrl: null,
    isUnlocked: false,
    name: null,
  },
)
await client.requestApp('qdnRequest', {
  action: 'FETCH_QDN_RESOURCE',
  service: 'DOCUMENT',
  name: 'Help',
  identifier: 'q-support-post-v1-example',
})
assert.match(
  lastRequestedUrl,
  /\/arbitrary\/DOCUMENT\/Help\/q-support-post-v1-example$/,
)
assert.deepEqual(
  await client.requestApp('qortalRequest', { action: 'GET_USER_ACCOUNT' }, appContext),
  {
    address: 'QH143K3FAiM4CHbm7cbYguCyYCdLMGW5YE',
    publicKey: null,
  },
)
await client.requestApp('qortalRequest', {
  action: 'SEARCH_QDN_RESOURCES',
  name: 'Q-Tube',
  service: 'APP',
})
assert.match(lastRequestedUrl, /\/arbitrary\/resources\/search\?name=Q-Tube&service=APP$/)
assert.deepEqual(await client.listAppResources('qortal', 'Trust'), [
  { identifier: 'Trust', name: 'Trust' },
])
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
assert.equal(requestCount.has('https://ext-node.qortal.link'), false)
assert.equal(requestCount.has('https://api.qortal.org'), false)

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
