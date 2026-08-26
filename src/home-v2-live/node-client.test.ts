import assert from 'node:assert/strict'
import {
  buildHomeV2AvatarPath,
  buildHomeV2AppResourceSearchPath,
  createPortableNodeClient,
  normalizeHomeV2AvatarReadResult,
  parseHomeV2CoreOnChainUpdateStatus,
  parseHomeV2AppResourceCandidates,
  parseHomeV2AppIconResponse,
  parseHomeV2AvatarResponse,
  normalizePortableNodeUrl,
  type PortableNodeClientDependencies,
} from './node-client'
import { parseHomeV2AccountCatalogueStore } from './account-catalogue'
import { validateVisibleAvatarPayload } from '../v2/shell/VisibleIdentityAvatar'
import { getHomeV2AppActions } from '../../electron/home-v2-app-actions'
import { getHomeV2ContextualAppActions } from '../../electron/home-v2-app-runtime'
import { buildHomeV2IdentityReadPath } from '../../electron/home-v2-identity-read'
import { buildHomeV2AppIconPath } from '../../electron/home-v2-app-icon'

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
    qortal: {
      error: string | null
      lastEnabledMode: string
      localCoreState: string
      mode: string
      nodeApiUrl: string | null
    }
    qortium: {
      capabilities: { admin: boolean }
      customAuthenticated: boolean
      lastEnabledMode: string
      mode: string
      nodeApiUrl: string | null
    }
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
const secrets = new Map<string, string>()
const latency = new Map([
  ['https://ext-node.qortal.link', 50],
  ['https://api.qortal.org', 10],
])
const unavailable = new Set<string>()
const requestCount = new Map<string, number>()
let currentNow = 1_700_000_000_000
let lastRequestedUrl = ''
let lastRequestedBinaryUrl = ''
let lastRequestedBinaryTimeoutMs: number | undefined
let lastRequestedTimeoutMs: number | undefined
let lastRequestedMethod: string | undefined
let lastRequestedHeaders: Readonly<Record<string, string>> | undefined
let lastDisableRedirects: boolean | undefined
let coreUpdateGetCount = 0
let coreUpdatePostCount = 0
let coreUpdateResponse: unknown = { updateAvailable: true }
let onCoreUpdateGet: (() => void | Promise<void>) | null = null
let savedResource: { fileName: string; mimeType: string; size: number } | null = null

const dependencies: PortableNodeClientDependencies = {
  async getPreference(key) {
    return preferences.get(key) ?? null
  },
  async getSecret(key) {
    return secrets.get(key) ?? null
  },
  async removeSecret(key) {
    secrets.delete(key)
  },
  async setPreference(key, value) {
    preferences.set(key, value)
  },
  async setSecret(key, value) {
    secrets.set(key, value)
  },
  async requestJson(url, method, timeoutMs, headers, disableRedirects) {
    lastRequestedUrl = url
    lastRequestedMethod = method
    lastRequestedHeaders = headers
    lastDisableRedirects = disableRedirects
    lastRequestedTimeoutMs = timeoutMs
    const origin = new URL(url).origin
    requestCount.set(origin, (requestCount.get(origin) ?? 0) + 1)
    if (unavailable.has(origin)) {
      return { data: null, latencyMs: 1, ok: false, status: 503 }
    }
    if (url.endsWith('/admin/update')) {
      if (method === 'POST') coreUpdatePostCount += 1
      else {
        coreUpdateGetCount += 1
        await onCoreUpdateGet?.()
      }
      return {
        data: coreUpdateResponse,
        latencyMs: 1,
        ok: true,
        status: 200,
      }
    }
    return {
      data: url.includes(`/names/primary/QH143K2qjVdn864NSY7aNESo88ao1ZnALH`)
        ? { name: 'Qortal Alice' }
        : url.endsWith('/addresses/QH143K2qjVdn864NSY7aNESo88ao1ZnALH/avatar/info')
          ? { identifier: 'old-pointer', name: 'Old publisher', service: 'THUMBNAIL' }
        : url.endsWith('/groups/12')
          ? {
              groupId: 12,
              owner: 'QH143K3FAiM4CHbm7cbYguCyYCdLMGW5YE',
              ownerPrimaryName: 'Qortal Owner',
            }
        : url.includes('/arbitrary/resource/status/')
          ? { status: 'READY' }
        : url.includes('/admin/status')
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
  async requestBinary(url, timeoutMs) {
    lastRequestedBinaryUrl = url
    lastRequestedBinaryTimeoutMs = timeoutMs
    const headers: Record<string, string> = {
      'content-type': 'application/octet-stream',
    }
    if (url.includes('/addresses/')) {
      headers['x-qortium-avatar-identifier'] = 'current-pointer'
      headers['x-qortium-avatar-name'] = 'Current publisher'
      headers['x-qortium-avatar-service'] = 'THUMBNAIL'
    }
    return {
      data: 'iVBORw0KGgo=',
      headers,
      status: 200,
    }
  },
  async saveBinary({ bytes, fileName, mimeType }) {
    savedResource = { fileName, mimeType, size: bytes.byteLength }
    return { canceled: false }
  },
  now: () => currentNow,
}

const client = createPortableNodeClient(dependencies)
assert.equal(typeof client.checkCoreUpdate, 'function')
assert.equal(typeof client.installCoreUpdate, 'function')
const checkCoreUpdate = () => client.checkCoreUpdate!()
const installCoreUpdate = () => client.installCoreUpdate!()

const initialNetworkSnapshot = await client.getSnapshot() as Snapshot
assert.equal(initialNetworkSnapshot.nodes.qortal.mode, 'disabled')
assert.equal(initialNetworkSnapshot.nodes.qortal.lastEnabledMode, 'public')
assert.equal(initialNetworkSnapshot.nodes.qortium.mode, 'disabled')
assert.equal(initialNetworkSnapshot.nodes.qortium.lastEnabledMode, 'public')
await client.setMode('qortal', 'public')

await client.saveShellState({ version: 1, selectedAccountId: 'wallet:one:2' })
assert.deepEqual(await client.getShellState(), {
  version: 1,
  selectedAccountId: 'wallet:one:2',
})
const disabledQortiumActions = await client.requestApp(
  'qdnRequest',
  { action: 'SHOW_ACTIONS' },
) as string[]
assert.equal(disabledQortiumActions.includes('FETCH_NODE_API'), false)
assert.equal(disabledQortiumActions.includes('SEND_CHAT_MESSAGE'), false)
assert.equal(disabledQortiumActions.includes('JOIN_GROUP'), false)
assert.equal(disabledQortiumActions.includes('LEAVE_GROUP'), false)
assert.equal(disabledQortiumActions.includes('FETCH_QORTAL_NODE_API'), true)
assert.equal(disabledQortiumActions.includes('GET_HOST_INFO'), true)
assert.deepEqual(
  await client.requestApp('qortalRequest', { action: 'SHOW_ACTIONS' }),
  getHomeV2ContextualAppActions(getHomeV2AppActions('qortalRequest'), 'android'),
)
assert.equal(disabledQortiumActions.includes('OPEN_AS_WIDGET'), false)
assert.equal(disabledQortiumActions.some((action) => action.startsWith('WIDGET_')), false)
const disabledQortiumHostInfo = await client.requestApp(
  'qdnRequest',
  { action: 'GET_HOST_INFO' },
) as { hostVersion: string; network: string; platform: string; protocol: string; route: Record<string, unknown> }
assert.equal(disabledQortiumHostInfo.hostVersion, '2.1.0')
assert.equal(disabledQortiumHostInfo.network, 'qortium')
assert.equal(disabledQortiumHostInfo.platform, 'android')
assert.equal(disabledQortiumHostInfo.protocol, 'qdnRequest')
assert.equal(disabledQortiumHostInfo.route.configuredKind, 'disabled')
assert.equal(disabledQortiumHostInfo.route.available, false)
assert.equal(disabledQortiumHostInfo.route.reachable, false)
assert.match(String(disabledQortiumHostInfo.route.revision), /^home-v2-route-v1-[0-9a-f]{8}$/)
assert.equal(getHomeV2AppActions('qdnRequest').includes('GET_SELECTED_ACCOUNT'), true)
assert.equal(getHomeV2AppActions('qdnRequest').includes('UNLOCK_SELECTED_ACCOUNT'), true)
assert.equal(getHomeV2AppActions('qortalRequest').includes('GET_USER_ACCOUNT'), true)
assert.equal(getHomeV2AppActions('qortalRequest').includes('GET_SELECTED_ACCOUNT'), false)
// Both protocols since R4 tier-2: unlocking is a Home-account operation, not a
// chain one, and the legacy wallet app only knows the qortalRequest global.
assert.equal(getHomeV2AppActions('qortalRequest').includes('UNLOCK_SELECTED_ACCOUNT'), true)
await client.setMode('qortium', 'public')
await client.setMode('qortium', 'disabled')
const disabledAfterPublic = await client.getSnapshot() as Snapshot
assert.equal(disabledAfterPublic.nodes.qortium.mode, 'disabled')
assert.equal(disabledAfterPublic.nodes.qortium.lastEnabledMode, 'public')
await client.setMode(
  'qortium',
  disabledAfterPublic.nodes.qortium.lastEnabledMode as 'public',
)
assert.equal(
  (await client.getSnapshot() as Snapshot).nodes.qortium.mode,
  'public',
)
const resourceContext = {
  resourceLocation: 'qortal://APP/Chat',
  selectedAccountId: null,
  tabId: 'chat-tab',
}
assert.deepEqual(
  await client.requestApp('qdnRequest', {
    action: 'OPEN_NEW_TAB',
    address: 'qortal://APP/Q-Tube',
  }),
  { address: 'qortal://APP/Q-Tube', openIn: 'new-tab' },
)
const qortalStreamUrl = await client.requestApp('qortalRequest', {
  action: 'GET_QDN_RESOURCE_STREAM_URL',
  service: 'IMAGE',
  name: 'Alice',
  identifier: 'qortal_avatar',
}, resourceContext)
assert.match(String(qortalStreamUrl), /^https:\/\/(api\.qortal\.org|ext-node\.qortal\.link)\/render\/IMAGE\/Alice\/qortal_avatar$/)
const qortiumStreamUrl = await client.requestApp('qdnRequest', {
  action: 'GET_QDN_RESOURCE_STREAM_URL',
  service: 'IMAGE',
  name: 'Alice',
  identifier: 'avatar',
}, resourceContext)
assert.match(String(qortiumStreamUrl), /^https:\/\/node[12]\.qortium\.app\/render\/IMAGE\/Alice\/avatar$/)
assert.notEqual(new URL(String(qortalStreamUrl)).origin, new URL(String(qortiumStreamUrl)).origin)
assert.deepEqual(
  await client.requestApp('qortalRequest', {
    action: 'OPEN_QDN_RESOURCE_VIEWER',
    service: 'IMAGE',
    name: 'Alice',
    identifier: 'qortal_avatar',
    filename: 'avatar.png',
    mimeType: 'image/png',
  }, resourceContext),
  {
    filename: 'avatar.png',
    identifier: 'qortal_avatar',
    mimeType: 'image/png',
    name: 'Alice',
    network: 'qortal',
    path: null,
    service: 'IMAGE',
    sourceTabId: 'chat-tab',
    streamUrl: qortalStreamUrl,
  },
)
assert.deepEqual(
  await client.requestApp('qortalRequest', {
    action: 'SAVE_QDN_RESOURCE',
    service: 'IMAGE',
    name: 'Alice',
    identifier: 'qortal_avatar',
    filename: '../avatar.png',
  }, resourceContext),
  { canceled: false },
)
assert.equal(lastRequestedBinaryUrl.includes('/arbitrary/IMAGE/Alice/qortal_avatar'), true)
assert.equal(lastRequestedBinaryTimeoutMs, 120_000)
assert.deepEqual(savedResource, {
  fileName: 'avatar.png',
  mimeType: 'application/octet-stream',
  size: 8,
})
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

// The list family is advertised but can never qualify on Android: every
// /lists route needs the administrative key of a local Core, and Android
// never runs one. All four answer the coded refusal, never a pretend-empty
// list — keep in step with resolveHomeV2ListNode in
// electron/home-v2-app-bridge.ts.
for (const listRequest of [
  { action: 'GET_ALL_LISTS' },
  { action: 'GET_LIST', listName: 'followedNames' },
  { action: 'ADD_TO_LIST', listName: 'followedNames', items: ['alice'] },
  { action: 'REMOVE_FROM_LIST', listName: 'followedNames', items: ['alice'] },
]) {
  await assert.rejects(
    () => client.requestApp('qdnRequest', listRequest),
    /Android has no local Core/,
  )
}

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
assert.deepEqual(
  await client.requestApp('qortalRequest', {
    action: 'FETCH_BLOCK',
    height: 42,
  }),
  [],
)
assert.match(lastRequestedUrl, /\/blocks\/byheight\/42$/)
assert.deepEqual(
  await client.requestApp('qortalRequest', {
    action: 'SEARCH_TRANSACTIONS',
    confirmationStatus: 'CONFIRMED',
    limit: 10,
    txType: ['PAYMENT'],
  }),
  [],
)
assert.match(
  lastRequestedUrl,
  /\/transactions\/search\?txType=PAYMENT&confirmationStatus=CONFIRMED&limit=10$/,
)
assert.deepEqual(
  await client.requestApp('qortalRequest', { action: 'GET_DAY_SUMMARY' }),
  [],
)
assert.match(lastRequestedUrl, /^https:\/\/(api\.qortal\.org|ext-node\.qortal\.link)\/admin\/summary$/)
// GET_DAY_SUMMARY and GET_PRICE are qortalRequest-only: Qortium Previewnet
// public seeds do not expose their routes.
await assert.rejects(
  () => client.requestApp('qdnRequest', { action: 'GET_PRICE', blockchain: 'LITECOIN' }),
  (error: unknown) =>
    error instanceof Error &&
    error.message === 'GET_PRICE is not implemented for qdnRequest.' &&
    (error as Error & { code?: string }).code === 'UNSUPPORTED_PROTOCOL',
)
await assert.rejects(
  () => client.requestApp('qortalRequest', {
    action: 'FETCH_BLOCK_RANGE',
    count: 101,
    height: 5,
  }),
  /between 1 and 100/,
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

// A momentary failure across every public seed must not erase a route that was
// just verified. Android actions use getSnapshot() for their approval and
// signing context; dropping the route during one probe cycle otherwise makes
// an online node appear unavailable and aborts the action before its prompt.
unavailable.add('https://ext-node.qortal.link')
const transientFailure = (await client.getSnapshot()) as Snapshot
assert.equal(transientFailure.nodes.qortal.nodeApiUrl, 'https://ext-node.qortal.link')
currentNow += 30_001
const expiredFailure = (await client.getSnapshot()) as Snapshot
assert.equal(expiredFailure.nodes.qortal.nodeApiUrl, null)
unavailable.clear()

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
const qortalAvatarSearchPath = buildHomeV2IdentityReadPath('qortal', {
  kind: 'legacyAvatarResource',
  value: 'Alice Smith',
})
const qortalAvatarSearchUrl = new URL(qortalAvatarSearchPath, 'https://node.invalid')
assert.equal(qortalAvatarSearchUrl.pathname, '/arbitrary/resources/search')
assert.equal(qortalAvatarSearchUrl.searchParams.get('service'), 'THUMBNAIL')
assert.equal(qortalAvatarSearchUrl.searchParams.get('name'), 'Alice Smith')
assert.equal(qortalAvatarSearchUrl.searchParams.get('identifier'), 'qortal_avatar')
assert.equal(qortalAvatarSearchUrl.searchParams.get('exactmatchnames'), 'true')
assert.equal(qortalAvatarSearchUrl.searchParams.get('mode'), 'ALL')
assert.equal(qortalAvatarSearchUrl.searchParams.get('includestatus'), 'false')
assert.equal(qortalAvatarSearchUrl.searchParams.get('includemetadata'), 'false')
assert.equal(qortalAvatarSearchUrl.searchParams.get('limit'), '1')

const qortiumAvatarSearchPath = buildHomeV2IdentityReadPath('qortium', {
  kind: 'legacyAvatarResource',
  value: 'Alice Smith',
})
const qortiumAvatarSearchUrl = new URL(qortiumAvatarSearchPath, 'https://node.invalid')
assert.equal(qortiumAvatarSearchUrl.pathname, qortalAvatarSearchUrl.pathname)
assert.equal(qortiumAvatarSearchUrl.searchParams.get('identifier'), 'avatar')
assert.equal(qortiumAvatarSearchUrl.searchParams.get('name'), 'Alice Smith')
assert.match(buildHomeV2AppResourceSearchPath('Trust'), /name=Trust/)
// R4-4: the renderer twin of electron/home-v2-app-resource-discovery.ts must
// behave identically — same service scoping, same candidate shape, same
// deterministic ordering — or desktop and Android resolve names differently.
assert.match(buildHomeV2AppResourceSearchPath('Trust'), /service=APP/)
assert.match(buildHomeV2AppResourceSearchPath('Blog', 'WEBSITE'), /service=WEBSITE/)
assert.match(buildHomeV2AppResourceSearchPath('Arena', 'GAME'), /service=GAME/)
assert.deepEqual(
  parseHomeV2AppResourceCandidates(
    [
      { identifier: 'Trust', name: 'Trust', service: 'APP' },
      { name: 'Trust', service: 'APP' },
      { identifier: 'Ignore', name: 'Other', service: 'APP' },
      { identifier: 'Ignore', name: 'Trust', service: 'WEBSITE' },
      { identifier: 'photo', name: 'Trust', service: 'IMAGE' },
    ],
    'trust',
  ),
  [
    { identifier: null, name: 'Trust', service: 'APP' },
    { identifier: 'Trust', name: 'Trust', service: 'APP' },
    { identifier: 'Ignore', name: 'Trust', service: 'WEBSITE' },
  ],
)
// A bare name that resolves only to a WEBSITE candidate works.
assert.deepEqual(
  parseHomeV2AppResourceCandidates([{ name: 'Blog', service: 'WEBSITE' }], 'Blog'),
  [{ identifier: null, name: 'Blog', service: 'WEBSITE' }],
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
  { status: 'missing' },
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
assert.equal(
  buildHomeV2AppIconPath({ identifier: 'Chat', name: 'Chat', service: 'APP' }),
  '/arbitrary/APP/Chat/Chat?filepath=favicon.ico&async=true',
)
const readyIco = parseHomeV2AppIconResponse({
  data: 'AAABAA==',
  headers: {},
  status: 200,
})
assert.equal(readyIco.status, 'ready')
if (readyIco.status === 'ready') {
  assert.equal(readyIco.contentType, 'image/vnd.microsoft.icon')
}
assert.deepEqual(
  parseHomeV2AppIconResponse({ data: '', headers: {}, status: 404 }),
  { status: 'missing' },
)

await client.setMode('qortal', 'public')
await client.setMode('qortium', 'public')

const qortiumAccountAvatar = await client.requestApp('qdnRequest', {
  action: 'FETCH_ACCOUNT_AVATAR',
  address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
}) as Record<string, unknown>
assert.equal(qortiumAccountAvatar.network, 'qortium')
assert.equal(qortiumAccountAvatar.source, 'POINTER')
assert.deepEqual(qortiumAccountAvatar.descriptor, {
  identifier: 'current-pointer',
  name: 'Current publisher',
  service: 'THUMBNAIL',
})
assert.match(
  lastRequestedBinaryUrl,
  /^https:\/\/(node1|node2)\.qortium\.app\/addresses\/QH143K2qjVdn864NSY7aNESo88ao1ZnALH\/avatar$/,
)

const qortalAccountAvatar = await client.requestApp('qortalRequest', {
  action: 'FETCH_ACCOUNT_AVATAR',
  address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
}) as Record<string, unknown>
assert.equal(qortalAccountAvatar.network, 'qortal')
assert.equal(qortalAccountAvatar.source, 'LEGACY')
assert.equal(qortalAccountAvatar.contentType, 'image/png')
assert.match(
  lastRequestedBinaryUrl,
  /^https:\/\/(api\.qortal\.org|ext-node\.qortal\.link)\/arbitrary\/THUMBNAIL\/Qortal%20Alice\/qortal_avatar\?async=true$/,
)

const qortalGroupAvatar = await client.requestApp('qortalRequest', {
  action: 'FETCH_GROUP_AVATAR',
  groupId: 12,
}) as Record<string, unknown>
assert.equal(qortalGroupAvatar.network, 'qortal')
assert.equal(qortalGroupAvatar.groupId, 12)
assert.equal(qortalGroupAvatar.source, 'LEGACY')
assert.match(
  lastRequestedBinaryUrl,
  /^https:\/\/(api\.qortal\.org|ext-node\.qortal\.link)\/arbitrary\/THUMBNAIL\/Qortal%20Owner\/qortal_group_avatar_12\?async=true$/,
)

// Group/chat-active read family (unblocks Chat 2.0 group browsing):
// representative URL-routing coverage on both protocols.
assert.deepEqual(
  await client.requestApp('qortalRequest', { action: 'GET_GROUP', groupId: 1 }),
  [],
)
assert.match(lastRequestedUrl, /\/groups\/1$/)
assert.deepEqual(
  await client.requestApp('qdnRequest', {
    action: 'GET_GROUP_MEMBERS',
    groupId: 4,
    onlyAdmins: true,
  }),
  [],
)
assert.match(lastRequestedUrl, /\/groups\/members\/4\?onlyAdmins=true$/)
assert.deepEqual(
  await client.requestApp('qortalRequest', {
    action: 'GET_ACCOUNT_GROUP_JOIN_REQUESTS',
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
  }),
  [],
)
assert.match(lastRequestedUrl, /\/groups\/joinrequests\/address\/QH143K2qjVdn864NSY7aNESo88ao1ZnALH$/)
assert.deepEqual(
  await client.requestApp('qdnRequest', {
    action: 'GET_ACTIVE_CHATS',
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
  }),
  [],
)
assert.match(lastRequestedUrl, /\/chat\/active\/QH143K2qjVdn864NSY7aNESo88ao1ZnALH\?encoding=BASE64$/)
assert.deepEqual(
  await client.requestApp('qdnRequest', { action: 'SEARCH_GROUPS', query: 'Chess' }),
  [],
)
assert.match(lastRequestedUrl, /\/groups\/search\?query=Chess$/)
// SEARCH_GROUPS is Qortium-only: /groups/search does not exist on Qortal.
await assert.rejects(
  () => client.requestApp('qortalRequest', { action: 'SEARCH_GROUPS', query: 'Chess' }),
  /SEARCH_GROUPS is not implemented for qortalRequest/,
)

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
  /GET_ASSET_INFO is not implemented for qortalRequest/,
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
  { identifier: 'Trust', name: 'Trust', service: 'APP' },
])

const chatSignature =
  '3H1KRfxLcJgxUAvBWKB4Y9x2K2sYKvzeXKrRGqYnDvxNQoNo8czEEs1uYYzMg2xKGz7Cx1xoY7YSasfF8LtcvRcE'
await client.requestApp('qdnRequest', { action: 'SEARCH_CHAT_MESSAGES', txGroupId: 0 })
assert.match(lastRequestedUrl, /\/chat\/messages\?txGroupId=0&encoding=BASE64$/)
await client.requestApp('qortalRequest', {
  action: 'SEARCH_CHAT_MESSAGES',
  limit: 10,
  txGroupId: 5,
})
assert.match(lastRequestedUrl, /\/chat\/messages\?txGroupId=5&limit=10&encoding=BASE64$/)
// Decided 2026-08-12: DM-involving search is groups-only in Phase 1 on both
// protocols, not just the one Hub is compatible with.
await assert.rejects(
  () => client.requestApp('qdnRequest', {
    action: 'SEARCH_CHAT_MESSAGES',
    involving: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
    txGroupId: 0,
  }),
  /groups-only in this release/,
)
await assert.rejects(
  () => client.requestApp('qortalRequest', {
    action: 'SEARCH_CHAT_MESSAGES',
    recipient: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
    txGroupId: 1,
  }),
  /groups-only in this release/,
)
await client.requestApp('qdnRequest', { action: 'GET_CHAT_MESSAGE', signature: chatSignature })
assert.match(
  lastRequestedUrl,
  new RegExp(`/chat/message/${chatSignature}\\?encoding=BASE64$`),
)
await client.requestApp('qortalRequest', {
  action: 'GET_CHAT_MESSAGE',
  encoding: 'BASE58',
  signature: chatSignature,
})
assert.match(
  lastRequestedUrl,
  new RegExp(`/chat/message/${chatSignature}\\?encoding=BASE58$`),
)
await assert.rejects(
  () => client.requestApp('qdnRequest', { action: 'GET_CHAT_MESSAGE', signature: 'bad' }),
  /signature is invalid/,
)
const avatar = await client.readAvatar('qortal', avatarRequest)
assert.equal(avatar.status, 'ready')
const appIcon = await client.readAppIcon('qortal', {
  identifier: 'Chat',
  name: 'Chat',
  service: 'APP',
})
assert.equal(appIcon.status, 'ready')
assert.match(
  lastRequestedBinaryUrl,
  /\/arbitrary\/APP\/Chat\/Chat\?filepath=favicon\.ico&async=true$/,
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

await client.readIdentity('qortal', {
  kind: 'legacyAvatarResource',
  value: 'Alice Smith',
})
assert.equal(
  `${new URL(lastRequestedUrl).pathname}${new URL(lastRequestedUrl).search}`,
  qortalAvatarSearchPath,
)

await client.readIdentity('qortium', {
  kind: 'legacyAvatarResource',
  value: 'Alice Smith',
})
assert.equal(
  `${new URL(lastRequestedUrl).pathname}${new URL(lastRequestedUrl).search}`,
  qortiumAvatarSearchPath,
)

await assert.rejects(
  () => client.readIdentity('qortal', { kind: 'name', value: '' }),
  /1 to 128/,
)

await assert.rejects(
  checkCoreUpdate,
  /authenticated custom Qortium node/,
)

unavailable.delete('https://qortium-admin.example')
const authenticated = (await client.setCustomUrl(
  'qortium',
  'https://qortium-admin.example/path',
  'private-test-api-key',
)) as Snapshot
assert.equal(authenticated.nodes.qortium.customAuthenticated, true)
assert.equal(authenticated.nodes.qortium.capabilities.admin, false)
assert.doesNotMatch(JSON.stringify(authenticated), /private-test-api-key/)
assert.doesNotMatch(
  preferences.get('home-v2-live-node:qortium') ?? '',
  /private-test-api-key/,
)
const preservedCredential = (await client.setCustomUrl(
  'qortium',
  'https://qortium-admin.example',
)) as Snapshot
assert.equal(preservedCredential.nodes.qortium.customAuthenticated, true)
const clearedCredential = (await client.setCustomUrl(
  'qortium',
  'https://qortium-admin.example',
  '',
)) as Snapshot
assert.equal(clearedCredential.nodes.qortium.customAuthenticated, false)
await client.setCustomUrl(
  'qortium',
  'https://qortium-admin.example',
  'private-test-api-key',
)

coreUpdateResponse = {
  binaryResourcePercentLoaded: 42,
  binaryResourceStatus: 'DOWNLOADING',
  secretUnexpectedField: 'must-be-redacted',
  updateAvailable: true,
}
const checkedUpdate = await checkCoreUpdate()
assert.deepEqual(checkedUpdate, {
  binaryResourcePercentLoaded: 42,
  binaryResourceStatus: 'DOWNLOADING',
  updateAvailable: true,
})
assert.equal(lastRequestedUrl, 'https://qortium-admin.example/admin/update')
assert.equal(lastRequestedMethod, 'GET')
assert.equal(lastRequestedTimeoutMs, 30_000)
assert.equal(lastRequestedHeaders?.['X-API-KEY'], 'private-test-api-key')
assert.equal(lastDisableRedirects, true)
assert.doesNotMatch(JSON.stringify(checkedUpdate), /secretUnexpectedField/)

coreUpdateGetCount = 0
coreUpdatePostCount = 0
coreUpdateResponse = { message: 'ready', updateAvailable: true }
const [firstInstall, secondInstall] = await Promise.all([
  installCoreUpdate(),
  installCoreUpdate(),
])
assert.deepEqual(firstInstall, secondInstall)
assert.equal(coreUpdateGetCount, 1)
assert.equal(coreUpdatePostCount, 1)

coreUpdateGetCount = 0
coreUpdatePostCount = 0
coreUpdateResponse = { autoUpdateMode: 'INSTALL', updateAvailable: true }
await installCoreUpdate()
assert.equal(coreUpdateGetCount, 1)
assert.equal(coreUpdatePostCount, 0)

coreUpdateGetCount = 0
coreUpdatePostCount = 0
coreUpdateResponse = { status: 'INSTALL_IN_PROGRESS', updateAvailable: true }
await installCoreUpdate()
assert.equal(coreUpdateGetCount, 1)
assert.equal(coreUpdatePostCount, 0)

coreUpdateGetCount = 0
coreUpdatePostCount = 0
coreUpdateResponse = { updateAvailable: false }
await installCoreUpdate()
assert.equal(coreUpdateGetCount, 1)
assert.equal(coreUpdatePostCount, 0)

coreUpdateGetCount = 0
coreUpdatePostCount = 0
coreUpdateResponse = { autoUpdateMode: 'NOTIFY', updateAvailable: true }
onCoreUpdateGet = () => {
  preferences.set(
    'home-v2-live-node:qortium',
    JSON.stringify({
      customUrl: 'https://replacement-admin.example',
      mode: 'custom',
    }),
  )
  secrets.set(
    'home-v2-qortium-node-api-key-v1',
    JSON.stringify({
      apiKey: 'replacement-key',
      nodeApiUrl: 'https://replacement-admin.example',
      version: 1,
    }),
  )
}
await assert.rejects(
  installCoreUpdate,
  /changed before the Core update request/,
)
onCoreUpdateGet = null
assert.equal(coreUpdateGetCount, 1)
assert.equal(coreUpdatePostCount, 0)

await client.setCustomUrl(
  'qortium',
  'https://qortium-admin.example',
  'private-test-api-key',
)

const changedHost = (await client.setCustomUrl(
  'qortium',
  'https://different-admin.example',
)) as Snapshot
assert.equal(changedHost.nodes.qortium.customAuthenticated, false)
assert.equal(changedHost.nodes.qortium.capabilities.admin, false)
await assert.rejects(
  checkCoreUpdate,
  /Save the custom Qortium node API key/,
)

await client.setCustomUrl('qortal', 'https://custom.example', 'must-not-be-stored')
assert.doesNotMatch(preferences.get('home-v2-live-node:qortal') ?? '', /must-not-be-stored/)
assert.throws(
  () => parseHomeV2CoreOnChainUpdateStatus([]),
  /invalid/,
)
assert.throws(
  () => parseHomeV2CoreOnChainUpdateStatus({ updateAvailable: 'yes' }),
  /invalid/,
)
assert.throws(
  () => parseHomeV2CoreOnChainUpdateStatus({}),
  /invalid/,
)
assert.throws(
  () => parseHomeV2CoreOnChainUpdateStatus(JSON.stringify({ message: 'x'.repeat(130 * 1024) })),
  /too large/,
)

// FIX 4 — Android must not advertise or run what it cannot do. Both routes are
// public here, so SHOW_ACTIONS returns the real available surface.
await client.setMode('qortal', 'public')
await client.setMode('qortium', 'public')
const androidQdnActions = (await client.requestApp('qdnRequest', { action: 'SHOW_ACTIONS' }, appContext)) as string[]
const androidQortalActions = (await client.requestApp('qortalRequest', { action: 'SHOW_ACTIONS' }, appContext)) as string[]
// SEND_MESSAGE signs, which Android cannot do — it must be filtered out of
// SHOW_ACTIONS so the result does not lie.
assert.equal(androidQdnActions.includes('SEND_MESSAGE'), false, 'Android SHOW_ACTIONS must not advertise SEND_MESSAGE')
assert.equal(androidQortalActions.includes('SEND_MESSAGE'), false)
// UNLOCK_SELECTED_ACCOUNT is a Home-account operation and IS available on
// Android — on both protocols, so the legacy wallet's qortalRequest works.
assert.equal(androidQortalActions.includes('UNLOCK_SELECTED_ACCOUNT'), true, 'Android must advertise UNLOCK on qortalRequest')
assert.equal(androidQdnActions.includes('UNLOCK_SELECTED_ACCOUNT'), true)
// And calling the filtered signing action anyway is rejected with a clear
// desktop-only reason, not the generic read-only message.
await assert.rejects(
  client.requestApp('qdnRequest', { action: 'SEND_MESSAGE', recipient: 'AG9QWs1tEBTmXoH2rrQXwV4LdMAM99o5WD', message: 'hi' }, appContext),
  /only available in Qortium Home desktop/,
)

console.log('Home v2 portable node client tests passed.')
