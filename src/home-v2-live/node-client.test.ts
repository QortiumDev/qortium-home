import assert from 'node:assert/strict'
import {
  buildHomeV2AvatarPath,
  buildHomeV2AppResourceSearchPath,
  createPortableNodeClient,
  normalizeHomeV2AvatarReadResult,
  parseHomeV2CoreOnChainUpdateStatus,
  parseHomeV2BoundedHttpBody,
  parseHomeV2AppResourceCandidates,
  parseHomeV2AppIconResponse,
  parseHomeV2AvatarResponse,
  normalizePortableNodeUrl,
  type PortableNodeClientDependencies,
} from './node-client'
import { parseHomeV2AccountCatalogueStore } from './account-catalogue'
import { homeV2AdminTrustRevision } from '../../electron/home-v2-admin-trust'
import { validateVisibleAvatarPayload } from '../v2/shell/VisibleIdentityAvatar'
import { getHomeV2AppActions } from '../../electron/home-v2-app-actions'
import { getHomeV2ContextualAppActions } from '../../electron/home-v2-app-runtime'
import { buildHomeV2IdentityReadPath } from '../../electron/home-v2-identity-read'
import { buildHomeV2AppIconPath } from '../../electron/home-v2-app-icon'

const syncedStatus = {
  height: 123,
  i2pChainLastInboundHandshakeTimestamp: 1_700_000_000_100,
  i2pChainLeaseSetLookupStatus: 'RESOLVED',
  i2pChainLeaseSetLookupTimestamp: 1_700_000_000_010,
  i2pDataLastInboundHandshakeTimestamp: null,
  i2pDataLeaseSetLookupStatus: 'NOT_RESOLVED',
  i2pDataLeaseSetLookupTimestamp: 1_700_000_000_020,
  isSynchronizing: false,
  isI2PChainSessionUp: true,
  isI2PDataSessionUp: false,
  numberOfConnections: 8,
  numberOfDataConnections: 4,
  numberOfI2PConnections: 3,
  numberOfI2PDataConnections: 0,
  syncBlocksRemaining: 0,
  syncPercent: 100,
  syncPhase: 'SYNCED',
}

assert.equal(parseHomeV2BoundedHttpBody('123456789', 'text/plain'), '123456789')
assert.deepEqual(parseHomeV2BoundedHttpBody('{"ok":true}', 'text/plain'), { ok: true })
assert.deepEqual(parseHomeV2BoundedHttpBody('[1,2]', 'application/octet-stream'), [1, 2])
assert.equal(parseHomeV2BoundedHttpBody('true', 'application/json'), true)
assert.equal(parseHomeV2BoundedHttpBody('{broken', 'application/json'), '{broken')

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
      i2pChainLastInboundHandshakeTimestamp: number | null
      i2pChainLeaseSetLookupStatus: string | null
      i2pChainLeaseSetLookupTimestamp: number | null
      i2pChainSessionUp: boolean | null
      i2pDataLastInboundHandshakeTimestamp: number | null
      i2pDataLeaseSetLookupStatus: string | null
      i2pDataLeaseSetLookupTimestamp: number | null
      i2pDataSessionUp: boolean | null
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
let lastRequestedBody: string | undefined
let lastBoundedMaxBytes: number | undefined
let boundedRequestCount = 0
let coreUpdateGetCount = 0
let coreUpdatePostCount = 0
let coreUpdateResponse: unknown = { updateAvailable: true }
let onCoreUpdateGet: (() => void | Promise<void>) | null = null
let savedResource: { fileName: string; mimeType: string; size: number } | null = null
let secretWrites = 0

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
    secretWrites += 1
    // A real secure store is not instantaneous. The delay is what lets a
    // single-flight test have two readers overlap at all.
    await Promise.resolve()
    secrets.set(key, value)
  },
  async requestJson(url, method, timeoutMs, headers, disableRedirects, body) {
    lastRequestedUrl = url
    lastRequestedMethod = method
    lastRequestedHeaders = headers
    lastDisableRedirects = disableRedirects
    lastRequestedBody = body
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
    if (url.endsWith('/crosschain/blockchains')) {
      return {
        data: [{ currencyCode: 'BTC', displayName: 'Bitcoin' }],
        latencyMs: 1,
        ok: true,
        status: 200,
      }
    }
    if (url.includes('/crosschain/') && url.endsWith('/walletbalance')) {
      return { data: '123456789', latencyMs: 1, ok: true, status: 200 }
    }
    if (url.includes('/crosschain/') && url.endsWith('/addressinfos')) {
      return { data: [{ address: 'watch-address' }], latencyMs: 1, ok: true, status: 200 }
    }
    if (url.includes('/crosschain/') && url.endsWith('/wallettransactions')) {
      return { data: [{ txHash: 'public-history' }], latencyMs: 1, ok: true, status: 200 }
    }
    if (url.includes('/crosschain/') && url.endsWith('/setcurrentserver')) {
      return {
        data: { notes: 'connection refused', success: false },
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
  async requestBoundedJson(url, timeoutMs, headers, body, maxBytes) {
    boundedRequestCount += 1
    lastRequestedUrl = url
    lastRequestedMethod = 'POST'
    lastRequestedHeaders = headers
    lastDisableRedirects = true
    lastRequestedBody = body
    lastRequestedTimeoutMs = timeoutMs
    lastBoundedMaxBytes = maxBytes
    if (url.includes('/arbitrary/preview/')) {
      // The seam that lets a test move the node or the key WHILE the upload is
      // in flight, which is the only way to exercise the post-upload recheck.
      await onPreviewUpload?.()
      return { data: previewUploadResponse, latencyMs: 1, ok: previewUploadOk, status: previewUploadStatus }
    }
    if (url.endsWith('/walletbalance')) {
      return { data: '123456789', latencyMs: 1, ok: true, status: 200 }
    }
    if (url.endsWith('/addressinfos')) {
      return { data: [{ address: 'watch-address' }], latencyMs: 1, ok: true, status: 200 }
    }
    if (url.endsWith('/setcurrentserver')) {
      return {
        data: { notes: 'connection refused', success: false },
        latencyMs: 1,
        ok: true,
        status: 200,
      }
    }
    return { data: [{ txHash: 'public-history' }], latencyMs: 1, ok: true, status: 200 }
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

let onPreviewUpload: (() => Promise<void>) | null = null
let previewUploadResponse: unknown = '/render/hash/abc123def456'
let previewUploadOk = true
let previewUploadStatus = 200

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

const publicQortalDiscovery = await client.requestApp('qortalRequest', {
  action: 'GET_CROSSCHAIN_BLOCKCHAINS',
}) as Array<{ currencyCode?: string; homeWallet?: Record<string, unknown> }>
const publicQortalBtc = publicQortalDiscovery.find((row) => row.currencyCode === 'BTC')
assert.equal(publicQortalBtc?.homeWallet?.receive, true)
assert.equal(publicQortalBtc?.homeWallet?.read, false)
assert.equal(publicQortalBtc?.homeWallet?.serverManagement, false)

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

// The list family is filtered from Android's SHOW_ACTIONS (it can never
// qualify: every /lists route needs the administrative key of a local Core,
// and Android never runs one), and a direct qdnRequest call still answers the
// precise coded refusal, never a pretend-empty list — keep in step with
// resolveHomeV2ListNode in electron/home-v2-app-bridge.ts. On qortalRequest
// the family is simply not implemented.
for (const listRequest of [
  { action: 'GET_ALL_LISTS' },
  { action: 'GET_LIST', listName: 'followedNames' },
  { action: 'ADD_TO_LIST', listName: 'followedNames', items: ['alice'] },
  { action: 'REMOVE_FROM_LIST', listName: 'followedNames', items: ['alice'] },
]) {
  // Lists now WORK on Android against an administered node. Through the bare
  // client (no attached key configured in this stub) a READ refuses with the
  // trust message that names the fix, and a WRITE refuses because it must
  // carry Home's approval — never with a platform or loopback claim.
  await assert.rejects(
    () => client.requestApp('qdnRequest', listRequest),
    (error: Error) =>
      // Names a fix the user can act on...
      /API key|HTTPS|127\.0\.0\.1|custom node|approved through Home/.test(error.message) &&
      // ...and never blames the platform or cites the retired locality rule.
      !/Android|local Core|only available in Qortium Home desktop/i.test(error.message),
  )
  // Same request on qortalRequest: not implemented there at all, so the
  // answer is the generic UNSUPPORTED_PROTOCOL refusal, never a Qortium
  // capability error on a Qortal request.
  await assert.rejects(
    () => client.requestApp('qortalRequest', listRequest),
    /is not implemented for qortalRequest/,
  )
}

// Poll writes ARE implemented on Android now — signed in the vault after the
// Home shell raises the approval. Reaching the bare client means that
// approval was bypassed, so the refusal says exactly that rather than
// claiming the platform cannot sign. On qortalRequest the family is simply
// not implemented.
for (const pollRequest of [
  { action: 'CREATE_POLL', pollName: 'Snacks', pollOptions: ['A', 'B'] },
  { action: 'VOTE_ON_POLL', optionIndex: 1, pollId: 7 },
  { action: 'UPDATE_POLL', newPollName: 'Snacks v2', pollId: 7, pollOptions: ['A', 'B'] },
]) {
  await assert.rejects(
    () => client.requestApp('qdnRequest', pollRequest),
    (error: Error) =>
      /must be approved through Home/.test(error.message) &&
      !/only available in Qortium Home desktop|read-only mode/i.test(error.message),
  )
  await assert.rejects(
    () => client.requestApp('qortalRequest', pollRequest),
    /is not implemented for qortalRequest/,
  )
}

// Same posture for the name writes: Android implements them, the SHELL raises
// the approval, and the client is not the place a name transaction can be
// signed from — so one arriving here bypassed the prompt and is refused by a
// message that says so rather than blaming the platform.
for (const nameRequest of [
  { action: 'REGISTER_NAME', name: 'droid' },
  { action: 'UPDATE_NAME', name: 'droid', newName: 'droid2' },
  { action: 'SELL_NAME', amount: '1.5', name: 'droid' },
  { action: 'CANCEL_SELL_NAME', name: 'droid' },
  { action: 'BUY_NAME', name: 'droid' },
]) {
  await assert.rejects(
    () => client.requestApp('qdnRequest', nameRequest),
    (error: Error) =>
      /must be approved through Home/.test(error.message) &&
      !/only available in Qortium Home desktop|read-only mode/i.test(error.message),
  )
  await assert.rejects(
    () => client.requestApp('qortalRequest', nameRequest),
    /is not implemented for qortalRequest/,
  )
}

// And the group mutations: signing refusal on qdnRequest, not-implemented on
// qortalRequest.
for (const groupRequest of [
  { action: 'CREATE_GROUP', description: 'd', groupName: 'droids' },
  { action: 'UPDATE_GROUP', groupId: 5 },
  { action: 'GROUP_APPROVAL', approval: true, pendingSignature: 'x'.repeat(88) },
  { action: 'SET_GROUP', defaultGroupId: 5 },
  { action: 'SET_GROUP_AVATAR', avatar: null, groupId: 5 },
]) {
  await assert.rejects(
    () => client.requestApp('qdnRequest', groupRequest),
    (error: Error) =>
      /must be approved through Home/.test(error.message) &&
      !/only available in Qortium Home desktop|read-only mode/i.test(error.message),
  )
  await assert.rejects(
    () => client.requestApp('qortalRequest', groupRequest),
    /is not implemented for qortalRequest/,
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
assert.equal(getHomeV2AppActions('qortalRequest').includes('GET_ASSET_BALANCES'), true)
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
assert.deepEqual(
  await client.requestApp('qortalRequest', { action: 'GET_ASSET_INFO', assetId: 5 }),
  [],
)
assert.equal(
  `${new URL(lastRequestedUrl).pathname}${new URL(lastRequestedUrl).search}`,
  '/assets/info?assetId=5',
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
assert.equal(authenticated.nodes.qortium.i2pChainSessionUp, true)
assert.equal(authenticated.nodes.qortium.i2pDataSessionUp, false)
assert.equal(authenticated.nodes.qortium.i2pChainLeaseSetLookupStatus, 'RESOLVED')
assert.equal(authenticated.nodes.qortium.i2pDataLeaseSetLookupStatus, 'NOT_RESOLVED')
assert.equal(authenticated.nodes.qortium.i2pChainLeaseSetLookupTimestamp, 1_700_000_000_010)
assert.equal(authenticated.nodes.qortium.i2pDataLeaseSetLookupTimestamp, 1_700_000_000_020)
assert.equal(authenticated.nodes.qortium.i2pChainLastInboundHandshakeTimestamp, 1_700_000_000_100)
assert.equal(authenticated.nodes.qortium.i2pDataLastInboundHandshakeTimestamp, null)
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

const authenticatedQortalDiscovery = await client.requestApp('qortalRequest', {
  action: 'GET_CROSSCHAIN_BLOCKCHAINS',
}) as Array<{ currencyCode?: string; homeWallet?: Record<string, unknown> }>
const authenticatedQortalBtc = authenticatedQortalDiscovery.find((row) => row.currencyCode === 'BTC')
assert.equal(authenticatedQortalBtc?.homeWallet?.receive, true)
assert.equal(authenticatedQortalBtc?.homeWallet?.read, true)
assert.equal(authenticatedQortalBtc?.homeWallet?.serverManagement, true)

const foreignWallet = {
  address: 'DPublicReceiveAddress',
  coin: 'DGB' as const,
  publicKey: 'xpub-public-wallet',
  xpub58: 'xpub-public-wallet',
}
assert.equal(typeof client.foreignWalletRead, 'function')
assert.equal(typeof client.setForeignServer, 'function')
const foreignTrust = await client.adminTrust!()
assert.equal(foreignTrust.trusted, true)
// The token React holds is the BINDING ID -- random, minted with the key --
// and never `homeV2AdminTrustRevision`, which is a truncated digest of
// origin||apiKey and so an offline verifier for a weak key (security review,
// 2026-09-02). Asserted here because this is the value that crosses into the
// React layer, is passed back as `approvedRevision`, and is written into the
// user's profile on a preview tab.
assert.match(foreignTrust.revision, /^[0-9a-f]{32}$/)
assert.notEqual(
  foreignTrust.revision,
  homeV2AdminTrustRevision('https://qortium-admin.example', 'private-test-api-key'),
)
if (!foreignTrust.trusted) throw new Error('Expected authenticated foreign-wallet node.')
assert.equal(await client.foreignWalletRead!('GET_WALLET_BALANCE', foreignWallet, foreignTrust.revision), '123456789')
assert.equal(lastRequestedUrl, 'https://qortium-admin.example/crosschain/dgb/walletbalance')
assert.equal(lastRequestedMethod, 'POST')
assert.equal(lastRequestedTimeoutMs, 20_000)
assert.equal(lastRequestedHeaders?.['Content-Type'], 'text/plain')
assert.equal(lastRequestedHeaders?.['X-API-KEY'], 'private-test-api-key')
assert.equal(lastDisableRedirects, true)
assert.equal(lastRequestedBody, foreignWallet.xpub58)
assert.equal(lastBoundedMaxBytes, 2 * 1024 * 1024)
assert.deepEqual(await client.foreignWalletRead!('GET_USER_WALLET_INFO', foreignWallet, foreignTrust.revision), [
  { address: 'watch-address' },
])
assert.equal(lastRequestedHeaders?.['Content-Type'], 'application/json')
assert.equal(lastRequestedBody, JSON.stringify({ xpub58: foreignWallet.xpub58 }))
assert.deepEqual(await client.foreignWalletRead!('GET_USER_WALLET_TRANSACTIONS', foreignWallet, foreignTrust.revision), [
  { txHash: 'public-history' },
])
assert.deepEqual(await client.setForeignServer!('DGB', {
  connectionType: 'SSL',
  hostName: 'electrum.example',
  port: 50002,
}, foreignTrust.revision), {
  notes: 'connection refused',
  success: false,
})
assert.equal(lastRequestedUrl, 'https://qortium-admin.example/crosschain/dgb/setcurrentserver')
assert.equal(lastRequestedHeaders?.['Content-Type'], 'application/json')
assert.equal(lastRequestedHeaders?.['X-API-KEY'], 'private-test-api-key')
assert.equal(lastDisableRedirects, true)
assert.equal(lastRequestedBody, JSON.stringify({
  connectionType: 'SSL',
  hostName: 'electrum.example',
  port: 50002,
}))
assert.equal(lastBoundedMaxBytes, 64 * 1024)

// --- PREVIEW_QDN_PUBLISH_SOURCE, Android ----------------------------------
// Android was refused previews on the stated ground that it "runs no local
// Core". That was never the action's requirement -- it was the desktop
// TRANSPORT's (a filesystem path only a co-located node can read). Core's
// byte-upload route takes the bytes, so the capability is the same one desktop
// has, gated on the same admin trust and reached over the same authenticated,
// redirect-refusing, bounded POST.
assert.equal(typeof client.previewPublishSource, 'function')
const previewBase64 = btoa('<h1>preview</h1>')
const previewed = await client.previewPublishSource!({
  dataBase64: previewBase64,
  fileName: 'site.zip',
})
assert.deepEqual(previewed, {
  previewUrl: 'https://qortium-admin.example/render/hash/abc123def456',
  revision: foreignTrust.revision,
  service: 'WEBSITE',
})
// The REQUEST SHAPE: base64 in the body, the archive flag and the filename in
// the query, the admin key on the header, redirects refused, response bounded.
assert.equal(
  lastRequestedUrl,
  'https://qortium-admin.example/arbitrary/preview/WEBSITE/upload?archive=true&filename=site.zip',
)
assert.equal(lastRequestedMethod, 'POST')
assert.equal(lastRequestedHeaders?.['Content-Type'], 'text/plain')
assert.equal(lastRequestedHeaders?.['X-API-KEY'], 'private-test-api-key')
assert.equal(lastDisableRedirects, true)
assert.equal(lastRequestedBody, previewBase64)
assert.equal(lastBoundedMaxBytes, 64 * 1024)
assert.equal(lastRequestedTimeoutMs, 180_000)

// A single file is NOT an archive, and its extension picks the service.
await client.previewPublishSource!({ dataBase64: previewBase64, fileName: 'clip.mp4' })
assert.equal(
  lastRequestedUrl,
  'https://qortium-admin.example/arbitrary/preview/VIDEO/upload?archive=false&filename=clip.mp4',
)
// A standalone page uploads as a file: Core wraps an HTML upload to WEBSITE as
// index.html itself.
await client.previewPublishSource!({ dataBase64: previewBase64, fileName: 'page.html' })
assert.equal(
  lastRequestedUrl,
  'https://qortium-admin.example/arbitrary/preview/WEBSITE/upload?archive=false&filename=page.html',
)

// An extension Core has no preview service for is refused BEFORE the bytes go
// anywhere.
{
  const before = boundedRequestCount
  await assert.rejects(
    () => client.previewPublishSource!({ dataBase64: previewBase64, fileName: 'notes.docx' }),
    /Unsupported preview content/,
  )
  assert.equal(boundedRequestCount, before, 'an unsupported source must not be uploaded')
}

// A node that answers with something other than a bare /render/ path is
// refused: that answer becomes a tab URL.
{
  previewUploadResponse = 'https://evil.example/render/hash/abc'
  await assert.rejects(
    () => client.previewPublishSource!({ dataBase64: previewBase64, fileName: 'site.zip' }),
    /unexpected preview URL/,
  )
  previewUploadResponse = '//evil.example/render/hash/abc'
  await assert.rejects(
    () => client.previewPublishSource!({ dataBase64: previewBase64, fileName: 'site.zip' }),
    /unexpected preview URL/,
  )
  previewUploadResponse = '/render/hash/abc123def456'
}

// A node without the endpoint answers 404/500; say so rather than "try again".
{
  previewUploadOk = false
  previewUploadStatus = 404
  await assert.rejects(
    () => client.previewPublishSource!({ dataBase64: previewBase64, fileName: 'site.zip' }),
    /does not support QDN previews yet/,
  )
  previewUploadOk = true
  previewUploadStatus = 200
}

// REVISION DRIFT AFTER THE UPLOAD. The upload can run for minutes; a node or
// key that moved while it did means the returned render URL belongs to a node
// the user is no longer approved on, so the preview must not open.
{
  onPreviewUpload = async () => {
    await client.setCustomUrl('qortium', 'https://qortium-admin.example', 'rotated-mid-upload-key')
  }
  await assert.rejects(
    () => client.previewPublishSource!({ dataBase64: previewBase64, fileName: 'site.zip' }),
    /API key changed while the preview was being built/,
  )
  onPreviewUpload = null
  await client.setCustomUrl('qortium', 'https://qortium-admin.example', 'private-test-api-key')
}

const boundedBeforeCredentialChange = boundedRequestCount
await client.setCustomUrl('qortium', 'https://qortium-admin.example', 'rotated-test-api-key')
{
  // Re-minted on rotation: an approval token issued for the old key must not
  // authorise a write against the new one.
  const rotatedTrust = await client.adminTrust!()
  assert.equal(rotatedTrust.trusted, true)
  assert.match(rotatedTrust.revision, /^[0-9a-f]{32}$/)
  assert.notEqual(rotatedTrust.revision, foreignTrust.revision)
}
await assert.rejects(
  () => client.foreignWalletRead!('GET_WALLET_BALANCE', foreignWallet, foreignTrust.revision),
  /API key changed/,
)
assert.equal(boundedRequestCount, boundedBeforeCredentialChange, 'revision drift must refuse before authenticated POST')
await client.setCustomUrl('qortium', 'https://qortium-admin.example', 'private-test-api-key')

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
// SEND_MESSAGE now signs on Android too, so it IS advertised on qdnRequest —
// and never on qortalRequest, where the Qortium-specific MESSAGE serializer
// has no meaning.
assert.equal(androidQdnActions.includes('SEND_MESSAGE'), true, 'Android SHOW_ACTIONS must advertise SEND_MESSAGE')
assert.equal(androidQortalActions.includes('SEND_MESSAGE'), false)
// UNLOCK_SELECTED_ACCOUNT is a Home-account operation and IS available on
// Android — on both protocols, so the legacy wallet's qortalRequest works.
assert.equal(androidQortalActions.includes('UNLOCK_SELECTED_ACCOUNT'), true, 'Android must advertise UNLOCK on qortalRequest')
assert.equal(androidQdnActions.includes('UNLOCK_SELECTED_ACCOUNT'), true)
assert.equal(androidQortalActions.includes('TRANSFER_ASSET'), true, 'Android must advertise Qortal asset transfers')
await assert.rejects(
  client.requestApp('qortalRequest', {
    action: 'TRANSFER_ASSET',
    amount: '1',
    assetId: 7,
    recipient: 'AG9QWs1tEBTmXoH2rrQXwV4LdMAM99o5WD',
  }, appContext),
  (error: Error) => /must be approved through Home/.test(error.message),
)
// The Home shell raises the approval and the vault signs, so the node client
// is not where a MESSAGE can be signed from: one arriving here bypassed the
// prompt, and the refusal says that rather than blaming the platform.
await assert.rejects(
  client.requestApp('qdnRequest', { action: 'SEND_MESSAGE', recipient: 'AG9QWs1tEBTmXoH2rrQXwV4LdMAM99o5WD', message: 'hi' }, appContext),
  (error: Error) =>
    /must be approved through Home/.test(error.message) &&
    !/only available in Qortium Home desktop|read-only mode/i.test(error.message),
)

// --- Preview is gated on TRUST, never on the node being local -------------
// Run last so the mode changes disturb nothing above. A public node is
// somebody else's Core, and a plain-HTTP remote host would put the API key on
// the wire in the clear; both refuse, and neither uploads a byte. The
// authenticated HTTPS custom node above is the ACCEPT case, and it is not
// loopback -- which is the whole point of the 2026-09-02 rule.
{
  const before = boundedRequestCount
  await client.setMode('qortium', 'public')
  await assert.rejects(
    () => client.previewPublishSource!({ dataBase64: btoa('x'), fileName: 'site.zip' }),
    // A discovered public node has no attached key and no origin the portable
    // client will administer, so the refusal names the fix (a secure route to
    // a node of your own) rather than the platform.
    /Previewing a publish source needs a secure route to the node/,
  )
  await client.setMode('qortium', 'custom')
  // The transport rule is unchanged and enforced one layer earlier: a remote
  // custom node cannot even be SAVED over plain HTTP, so an API key never
  // reaches a preview upload in the clear.
  await assert.rejects(
    () => client.setCustomUrl('qortium', 'http://remote.example:24891', 'private-test-api-key'),
    /must use HTTPS/,
  )
  await client.setCustomUrl('qortium', 'https://qortium-admin.example')
  await assert.rejects(
    () => client.previewPublishSource!({ dataBase64: btoa('x'), fileName: 'site.zip' }),
    /needs your node's API key/,
  )
  assert.equal(boundedRequestCount, before, 'an untrusted node must never receive preview bytes')
}

// --- The binding id is minted once, and only when the credential moves -----
// Both halves come from review round 3.
{
  const SECRET_KEY = 'home-v2-qortium-node-api-key-v1'
  const ORIGIN = 'https://qortium-admin.example'
  // The block above deliberately leaves the node keyless; re-attach one.
  await client.setCustomUrl('qortium', ORIGIN, 'private-test-api-key')
  const currentTrust = await client.adminTrust!()
  assert.equal(currentTrust.trusted, true)

  // (b) A settings write that touches NEITHER the key nor the origin keeps the
  // id. Re-minting on a mode change would invalidate every approval token and
  // every open preview tab for a change that touched no credential.
  await client.setMode('qortium', 'custom')
  const afterModeChange = await client.adminTrust!()
  assert.equal(afterModeChange.trusted, true)
  assert.equal(
    afterModeChange.revision,
    currentTrust.revision,
    'a mode change must not re-mint the binding id',
  )
  // Re-saving the SAME key against the SAME node is equally benign.
  await client.setCustomUrl('qortium', ORIGIN, 'private-test-api-key')
  assert.equal(
    (await client.adminTrust!()).revision,
    currentTrust.revision,
    'saving the same key on the same node must not re-mint the binding id',
  )

  // ...but a different key does re-mint, and so does a different origin.
  await client.setCustomUrl('qortium', ORIGIN, 'another-test-api-key')
  const afterKeyChange = await client.adminTrust!()
  assert.equal(afterKeyChange.trusted, true)
  assert.notEqual(afterKeyChange.revision, currentTrust.revision)
  await client.setCustomUrl('qortium', 'https://moved.example', 'another-test-api-key')
  const afterMove = await client.adminTrust!()
  assert.equal(afterMove.trusted, true)
  assert.notEqual(afterMove.revision, afterKeyChange.revision)

  // (a) The lazy upgrade for a record written before binding ids existed is
  // SINGLE-FLIGHT. Two concurrent readers used to mint independently and the
  // last write won, leaving the earlier caller holding an id the store no
  // longer had.
  await client.setCustomUrl('qortium', ORIGIN, 'private-test-api-key')
  secrets.set(SECRET_KEY, JSON.stringify({
    apiKey: 'private-test-api-key',
    nodeApiUrl: ORIGIN,
    version: 1,
  }))
  const writesBefore = secretWrites
  const [first, second, third] = await Promise.all([
    client.adminTrust!(),
    client.adminTrust!(),
    client.adminTrust!(),
  ])
  assert.equal(first.trusted && second.trusted && third.trusted, true)
  assert.match(first.revision, /^[0-9a-f]{32}$/)
  assert.equal(second.revision, first.revision, 'concurrent readers must share one mint')
  assert.equal(third.revision, first.revision)
  assert.equal(secretWrites - writesBefore, 1, 'the lazy upgrade must write exactly once')
  // And the id that was handed out is the one that is actually stored.
  assert.equal(
    (JSON.parse(secrets.get(SECRET_KEY) ?? '{}') as { bindingId?: string }).bindingId,
    first.revision,
  )
  // A later read finds it and does not mint again.
  const writesAfter = secretWrites
  assert.equal((await client.adminTrust!()).revision, first.revision)
  assert.equal(secretWrites, writesAfter, 'a record that already has an id must not be rewritten')
}

console.log('Home v2 portable node client tests passed.')
