import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  createHomeV2BridgeError,
  getHomeV2AppHostInfo,
  getHomeV2BridgeStateDetails,
  getHomeV2AvailableAppActions,
  homeV2BridgeErrorPayload,
  normalizeHomeV2BridgeError,
} from './home-v2-app-runtime.js'

const reachablePublic = {
  capabilities: { read: true },
  customConfigured: false,
  mode: 'public' as const,
  nodeApiUrl: 'https://node1.qortium.app',
}
const publicInfo = getHomeV2AppHostInfo({
  accountId: 'wallet:one:0',
  hostVersion: '2.0.0',
  node: reachablePublic,
  platform: 'desktop',
  platformVersion: '2.0',
  protocol: 'qdnRequest',
})
assert.equal(publicInfo.network, 'qortium')
assert.equal(publicInfo.protocol, 'qdnRequest')
assert.equal(publicInfo.route.configuredKind, 'public')
assert.equal(publicInfo.route.effectiveKind, 'public')
assert.equal(publicInfo.route.available, true)
assert.equal(publicInfo.route.reachable, true)
assert.match(publicInfo.route.revision, /^home-v2-route-v1-[0-9a-f]{8}$/)
assert.equal(getHomeV2AvailableAppActions('qdnRequest', {
  qortal: publicInfo.route,
  qortium: publicInfo.route,
}).includes('SEND_CHAT_MESSAGE'), true)
for (const action of ['SEND_CHAT_EDIT', 'SEND_CHAT_DELETE', 'SEND_CHAT_REACTION']) {
  assert.equal(getHomeV2AvailableAppActions('qdnRequest', {
    qortal: publicInfo.route,
    qortium: publicInfo.route,
  }).includes(action), true)
}
assert.equal(getHomeV2AvailableAppActions('qortalRequest', {
  qortal: publicInfo.route,
  qortium: publicInfo.route,
}).includes('SEND_CHAT_DELETE'), true)
for (const action of ['JOIN_GROUP', 'LEAVE_GROUP']) {
  assert.equal(getHomeV2AvailableAppActions('qdnRequest', {
    qortal: publicInfo.route,
    qortium: publicInfo.route,
  }).includes(action), true)
  assert.equal(getHomeV2AvailableAppActions('qortalRequest', {
    qortal: publicInfo.route,
    qortium: publicInfo.route,
  }).includes(action), true)
}

const unreachableInfo = getHomeV2AppHostInfo({
  accountId: 'wallet:one:0',
  node: { ...reachablePublic, capabilities: { read: false }, nodeApiUrl: null },
  platform: 'desktop',
  platformVersion: '2.0',
  protocol: 'qdnRequest',
})
assert.equal(unreachableInfo.route.available, true)
assert.equal(unreachableInfo.route.reachable, false)
assert.equal(getHomeV2AvailableAppActions('qdnRequest', {
  qortal: unreachableInfo.route,
  qortium: unreachableInfo.route,
}).includes('SEND_CHAT_MESSAGE'), true)
assert.notEqual(unreachableInfo.route.revision, publicInfo.route.revision)

const androidLocalInfo = getHomeV2AppHostInfo({
  node: {
    capabilities: { read: false },
    customConfigured: false,
    mode: 'local',
    nodeApiUrl: null,
  },
  platform: 'android',
  platformVersion: '2.0',
  protocol: 'qortalRequest',
})
assert.equal(androidLocalInfo.network, 'qortal')
assert.equal(androidLocalInfo.route.configuredKind, 'local')
assert.equal(androidLocalInfo.route.effectiveKind, null)
assert.equal(androidLocalInfo.route.available, false)
assert.deepEqual(getHomeV2AvailableAppActions('qortalRequest', {
  qortal: androidLocalInfo.route,
  qortium: publicInfo.route,
}), [
  'GET_HOST_INFO',
  'IS_USING_PUBLIC_NODE',
  'OPEN_NEW_TAB',
  'SHOW_ACTIONS',
  'WHICH_UI',
])

const authenticatedCustomInfo = getHomeV2AppHostInfo({
  node: {
    capabilities: { read: true },
    customAuthenticated: true,
    customConfigured: true,
    mode: 'custom',
    nodeApiUrl: 'https://custom.example',
  },
  platform: 'desktop',
  platformVersion: '2.0',
  protocol: 'qdnRequest',
})
assert.equal(authenticatedCustomInfo.route.configuredKind, 'custom-authenticated')
assert.deepEqual(getHomeV2BridgeStateDetails({
  accountId: 'wallet:one:0',
  nodes: { qortal: reachablePublic, qortium: reachablePublic },
  platform: 'desktop',
}).map(({ network, protocol }) => ({ network, protocol })), [
  { network: 'qortium', protocol: 'qdnRequest' },
  { network: 'qortal', protocol: 'qortalRequest' },
])

const original = createHomeV2BridgeError('The node route changed.', {
  action: 'SEND_CHAT_MESSAGE',
  code: 'STALE_CONTEXT',
  network: 'qortium',
  outcome: 'unknown',
  retryable: false,
  routeRevision: publicInfo.route.revision,
  target: { groupId: 12, kind: 'group' },
})
assert.deepEqual(homeV2BridgeErrorPayload(original), {
  action: 'SEND_CHAT_MESSAGE',
  code: 'STALE_CONTEXT',
  message: 'The node route changed.',
  network: 'qortium',
  outcome: 'unknown',
  retryable: false,
  routeRevision: publicInfo.route.revision,
  target: { groupId: 12, kind: 'group' },
})
const normalized = normalizeHomeV2BridgeError(new Error('The selected account is locked.'), {
  action: 'SEND_CHAT_MESSAGE',
  network: 'qortal',
  routeRevision: 'revision-2',
})
assert.equal(normalized.code, 'ACCOUNT_LOCKED')
assert.equal(normalized.network, 'qortal')
assert.equal(normalized.retryable, false)
assert.equal(normalized.routeRevision, 'revision-2')
const genericDenial = normalizeHomeV2BridgeError(
  new Error('The node denied the submitted transaction.'),
  {
    action: 'SEND_CHAT_MESSAGE',
    network: 'qortium',
  },
)
assert.equal(genericDenial.code, 'HOME_BRIDGE_ERROR')
assert.equal(genericDenial.retryable, false)
const missingNodeCapability = normalizeHomeV2BridgeError(
  new Error('The selected Qortium node does not expose the public group-membership builder.'),
  {
    action: 'JOIN_GROUP',
    network: 'qortium',
  },
)
assert.equal(missingNodeCapability.code, 'NODE_CAPABILITY_MISSING')
assert.equal(missingNodeCapability.retryable, false)
const userDenial = normalizeHomeV2BridgeError(new Error('Approval was denied.'), {
  action: 'SEND_CHAT_MESSAGE',
  network: 'qortium',
})
assert.equal(userDenial.code, 'USER_CANCELLED')
assert.equal(userDenial.retryable, true)

const qdnWithUnavailableQortal = getHomeV2AvailableAppActions('qdnRequest', {
  qortal: androidLocalInfo.route,
  qortium: publicInfo.route,
})
assert.equal(qdnWithUnavailableQortal.includes('SEND_CHAT_MESSAGE'), true)
assert.equal(qdnWithUnavailableQortal.includes('FETCH_QORTAL_NODE_API'), false)

function readRepoSource(...candidates: string[]) {
  const url = candidates
    .map((candidate) => new URL(candidate, import.meta.url))
    .find((candidate) => existsSync(candidate))
  assert.ok(url, `source not found: tried ${candidates.join(', ')}`)
  return readFileSync(url, 'utf8')
}

const desktopBridge = readRepoSource(
  '../electron/home-v2-app-bridge.ts',
  './home-v2-app-bridge.ts',
)
const androidBridge = readRepoSource(
  '../src/home-v2-live/node-client.ts',
  '../src/home-v2-live/node-client.js',
)
for (const [name, source] of [
  ['desktop', desktopBridge],
  ['android', androidBridge],
] as const) {
  assert.equal(
    source.includes('getHomeV2AvailableAppActions'),
    true,
    `${name} must use the shared route-aware action catalogue.`,
  )
  assert.equal(
    source.includes('getHomeV2AppHostInfo'),
    true,
    `${name} must use the shared route-qualified host contract.`,
  )
}
const androidAppHost = readRepoSource('../src/home-v2-live/HomeV2LiveApp.tsx')
const androidPlatform = readRepoSource('../src/platform.ts')
const sharedChatActions = readRepoSource(
  '../electron/home-v2-chat-actions.ts',
  './home-v2-chat-actions.ts',
)
for (const [name, source] of [
  ['desktop', desktopBridge],
  ['android', androidAppHost],
] as const) {
  assert.equal(
    source.includes('isHomeV2PublicChatAction(action)'),
    true,
    `${name} must dispatch the shared fine-grained public CHAT action family.`,
  )
  assert.equal(
    source.includes('normalizeHomeV2PublicChatRequest'),
    true,
    `${name} must validate public CHAT requests through the shared contract.`,
  )
  assert.equal(
    source.includes('normalizeHomeV2PublicChatReferenceTarget'),
    true,
    `${name} must attest referenced messages before revision signing.`,
  )
}
for (const [name, source] of [
  ['desktop', desktopBridge],
  ['android', androidPlatform],
] as const) {
  assert.equal(
    source.includes('buildHomeV2QortiumPublicChatBuildBody'),
    true,
    `${name} must use the shared Qortium CHAT build request.`,
  )
  assert.equal(
    source.includes('createHomeV2UnknownChatBroadcastResult'),
    true,
    `${name} must preserve signed unknown broadcast outcomes.`,
  )
}
assert.equal(sharedChatActions.includes("errorType: 'BROADCAST_OUTCOME_UNKNOWN'"), true)
const desktopViewHost = readRepoSource('../electron/qdn-views.ts', './qdn-views.ts')
const androidViewHost = readRepoSource(
  '../src/v2/shell/AppTabStage.tsx',
  '../src/v2/shell/AppTabStage.js',
)
assert.equal(desktopViewHost.includes("CustomEvent('qortiumBridgeStateChanged'"), true)
assert.equal(androidViewHost.includes("type: 'qortium:bridge-state-changed'"), true)

console.log('Home v2 app runtime contract tests passed.')
