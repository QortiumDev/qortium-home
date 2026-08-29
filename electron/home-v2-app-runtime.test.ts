import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  HOME_V2_ROUTE_INDEPENDENT_ACTIONS,
  homeV2AndroidActionRefusal,
  isHomeV2AndroidUnsupportedAction,
  createHomeV2BridgeError,
  getHomeV2AppHostInfo,
  getHomeV2BridgeStateDetails,
  getHomeV2AvailableAppActions,
  getHomeV2ContextualAppActions,
  homeV2BridgeErrorPayload,
  homeV2WidgetWithholdsSelfSubject,
  normalizeHomeV2BridgeError,
} from './home-v2-app-runtime.js'
import { getHomeV2AppActions } from './home-v2-app-actions.js'
import { HOME_V2_RUNTIME_INVALIDATION_KINDS } from './home-v2-runtime-invalidation.js'

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
assert.equal(getHomeV2AvailableAppActions('qdnRequest', {
  qortal: publicInfo.route,
  qortium: publicInfo.route,
}).includes('SHOW_CONTEXT_MENU'), true)
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
for (const action of [
  'APPROVE_GROUP_JOIN_REQUEST', 'INVITE_TO_GROUP', 'CANCEL_GROUP_INVITE',
  'ADD_GROUP_ADMIN', 'REMOVE_GROUP_ADMIN', 'GROUP_BAN', 'CANCEL_GROUP_BAN', 'GROUP_KICK',
]) {
  assert.equal(getHomeV2AvailableAppActions('qdnRequest', {
    qortal: publicInfo.route,
    qortium: publicInfo.route,
  }).includes(action), true)
  assert.equal(getHomeV2AvailableAppActions('qortalRequest', {
    qortal: publicInfo.route,
    qortium: publicInfo.route,
  }).includes(action), true)
}
for (const action of ['BAN_FROM_GROUP', 'KICK_FROM_GROUP']) {
  assert.equal(getHomeV2AvailableAppActions('qdnRequest', {
    qortal: publicInfo.route,
    qortium: publicInfo.route,
  }).includes(action), false)
  assert.equal(getHomeV2AvailableAppActions('qortalRequest', {
    qortal: publicInfo.route,
    qortium: publicInfo.route,
  }).includes(action), true)
}

const unreachableInfo = getHomeV2AppHostInfo({
  accountId: 'wallet:one:0',
  hostVersion: '2.1.0',
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
for (const action of ['SELECT_QDN_PUBLISH_SOURCE', 'PUBLISH_QDN_RESOURCE']) {
  assert.equal(getHomeV2AvailableAppActions('qdnRequest', {
    qortal: unreachableInfo.route,
    qortium: unreachableInfo.route,
  }).includes(action), false)
  assert.equal(getHomeV2AvailableAppActions('qortalRequest', {
    qortal: publicInfo.route,
    qortium: unreachableInfo.route,
  }).includes(action), true)
}
assert.notEqual(unreachableInfo.route.revision, publicInfo.route.revision)

const androidLocalInfo = getHomeV2AppHostInfo({
  hostVersion: '2.1.0',
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
  // Route-independent: answerable even with the route unavailable, which is
  // exactly the state this case sets up.
  'DECRYPT_DATA',
  'ENCRYPT_DATA',
  'FORGET_PENDING_TRANSACTION',
  'GET_PENDING_TRANSACTIONS',
  'GET_HOST_INFO',
  'IS_USING_PUBLIC_NODE',
  'NOTIFICATION_HAS_PERMISSION',
  'OPEN_CURRENT_TAB',
  'OPEN_NEW_TAB',
  'SHOW_CONTEXT_MENU',
  'SHOW_NOTIFICATION',
  'SHOW_ACTIONS',
  'WHICH_UI',
  // Last because it is not one of the COMMON_ACTIONS this list is otherwise
  // made of. It survives an unavailable route because it reads a cached
  // third-party price list rather than a node — see the note beside it in
  // HOME_V2_ROUTE_INDEPENDENT_ACTIONS.
  'GET_MARKET_PRICES',
])

const authenticatedCustomInfo = getHomeV2AppHostInfo({
  hostVersion: '2.1.0',
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

const operationalChatActions = [
  'GET_ACTIVE_CHATS',
  'SEARCH_CHAT_MESSAGES',
  'SEND_CHAT_MESSAGE',
  'SEND_CHAT_EDIT',
  'SEND_CHAT_DELETE',
  'SEND_CHAT_REACTION',
  'GET_PRIVATE_DIRECT_ACTIVE_CHATS',
  'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
  'SEND_DIRECT_CHAT_MESSAGE',
  'SEND_DIRECT_CHAT_EDIT',
  'SEND_DIRECT_CHAT_DELETE',
  'SEND_DIRECT_CHAT_REACTION',
  'GET_PRIVATE_GROUP_ACTIVE_CHATS',
  'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES',
  'SEND_PRIVATE_GROUP_CHAT_MESSAGE',
  'SEND_PRIVATE_GROUP_CHAT_EDIT',
  'SEND_PRIVATE_GROUP_CHAT_DELETE',
  'SEND_PRIVATE_GROUP_CHAT_REACTION',
  'JOIN_GROUP',
  'LEAVE_GROUP',
  'APPROVE_GROUP_JOIN_REQUEST',
  'INVITE_TO_GROUP',
  'CANCEL_GROUP_INVITE',
  'ADD_GROUP_ADMIN',
  'REMOVE_GROUP_ADMIN',
  'GROUP_BAN',
  'CANCEL_GROUP_BAN',
  'GROUP_KICK',
  'PUBLISH_QDN_RESOURCE',
  'PUBLISH_CHAT_ATTACHMENT',
  'GET_CHAT_ATTACHMENT_STREAM_URL',
  'OPEN_CHAT_ATTACHMENT_VIEWER',
  'SAVE_CHAT_ATTACHMENT',
  'GET_PENDING_TRANSACTIONS',
  'FORGET_PENDING_TRANSACTION',
  'SHOW_NOTIFICATION',
] as const
const operationalRoutes = [
  { mode: 'local' as const, platform: 'desktop' as const },
  { customAuthenticated: true, customConfigured: true, mode: 'custom' as const, platform: 'desktop' as const },
  { customAuthenticated: false, customConfigured: true, mode: 'custom' as const, platform: 'desktop' as const },
  { mode: 'public' as const, platform: 'desktop' as const },
  { customAuthenticated: true, customConfigured: true, mode: 'custom' as const, platform: 'android' as const },
  { customAuthenticated: false, customConfigured: true, mode: 'custom' as const, platform: 'android' as const },
  { mode: 'public' as const, platform: 'android' as const },
] as const
for (const routeCase of operationalRoutes) {
  for (const protocol of ['qdnRequest', 'qortalRequest'] as const) {
    const info = getHomeV2AppHostInfo({
      accountId: 'wallet:one:0',
      hostVersion: '2.1.0',
      node: {
        capabilities: { read: true },
        customAuthenticated: 'customAuthenticated' in routeCase ? routeCase.customAuthenticated : false,
        customConfigured: 'customConfigured' in routeCase ? routeCase.customConfigured : false,
        mode: routeCase.mode,
        nodeApiUrl: routeCase.mode === 'local' ? 'https://127.0.0.1:24891' : 'https://chat-node.example',
      },
      platform: routeCase.platform,
      platformVersion: '2.0',
      protocol,
    })
    const actions = getHomeV2AvailableAppActions(protocol, {
      qortal: info.route,
      qortium: info.route,
    })
    for (const action of operationalChatActions) {
      assert.equal(
        actions.includes(action),
        true,
        `${routeCase.platform}/${routeCase.mode}/${protocol} must advertise ${action}`,
      )
    }
  }
}
assert.deepEqual(HOME_V2_RUNTIME_INVALIDATION_KINDS, [
  'account-changed',
  'app-replaced',
  'locked',
  'navigation-changed',
  'node-changed',
  'tab-closed',
])
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
// Every Home prompt refusal is a definitive pre-broadcast "no" and must carry
// USER_CANCELLED — these previously fell through to HOME_BRIDGE_ERROR (only
// "approval/permission was denied" matched), so an app could not tell a user
// denial from a mid-broadcast failure, and qortium-chat journaled a denied
// send as "outcome unknown; it may already have been sent".
for (const refusal of [
  'Account access was denied.',
  'Account unlock was denied.',
  'Home settings update was denied.',
  'Opening a widget was denied.',
  'QDN write request was denied.',
]) {
  const denial = normalizeHomeV2BridgeError(new Error(refusal), {
    action: 'SEND_CHAT_MESSAGE',
    network: 'qortium',
  })
  assert.equal(denial.code, 'USER_CANCELLED', refusal)
}

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

const normalTabActions = getHomeV2ContextualAppActions(
  getHomeV2AvailableAppActions('qdnRequest', {
    qortal: publicInfo.route,
    qortium: publicInfo.route,
  }),
  'tab',
)
assert.equal(normalTabActions.includes('OPEN_AS_WIDGET'), true)
assert.equal(normalTabActions.some((action) => action.startsWith('WIDGET_')), false)

const widgetActions = getHomeV2ContextualAppActions(
  getHomeV2AvailableAppActions('qdnRequest', {
    qortal: publicInfo.route,
    qortium: publicInfo.route,
  }),
  'widget',
)
for (const action of [
  'FETCH_NODE_API',
  'GET_HOST_INFO',
  'GET_QDN_RESOURCE_STATUS',
  'SHOW_ACTIONS',
  'WIDGET_CLOSE',
  'WIDGET_GET_STATE',
]) {
  assert.equal(widgetActions.includes(action), true, `widget should advertise ${action}`)
}
for (const action of [
  'GET_SELECTED_ACCOUNT',
  'OPEN_AS_WIDGET',
  // A widget has no tab of its own to replace, and no tab strip to add one
  // to: both open actions stay out, for the same reason.
  'OPEN_CURRENT_TAB',
  'OPEN_NEW_TAB',
  'PUBLISH_QDN_RESOURCE',
  'SEND_CHAT_MESSAGE',
  'SHOW_CONTEXT_MENU',
  'SHOW_NOTIFICATION',
  // Minting reads pass the GET_/LIST_ prefix rule but describe the user's own
  // node, and GET_MINTING_STATUS defaults to the selected account's address —
  // a chromeless widget has no prompt surface to disclose either through. The
  // writes are excluded by the prefix rule; pinned here so a rename cannot
  // quietly admit them.
  'GET_MINTING_STATUS',
  'LIST_MINTING_ACCOUNTS',
  'START_MINTING',
  'REMOVE_MINTING_ACCOUNT',
  // The list reads pass the GET_ prefix rule but describe the user's own node
  // too — which names the user blocks and follows is a behavioral profile of
  // the person. The writes are excluded by the prefix rule; pinned so a
  // rename cannot quietly admit them.
  'GET_ALL_LISTS',
  'GET_LIST',
  'ADD_TO_LIST',
  'REMOVE_FROM_LIST',
  // Same trap as the minting reads, and the reason the prefix rule needs a
  // denylist at all: GET_USER_WALLET matches /^GET_/ and its entire answer is
  // the selected account's address. It is GET_SELECTED_ACCOUNT by another
  // name and is excluded with it.
  'GET_USER_WALLET',
  // SEND_MESSAGE signs; the prefix rule already excludes it, pinned so a
  // rename cannot quietly admit a signing action to a surface with no prompt.
  'SEND_MESSAGE',
  // The poll writes sign too; pinned for the same reason.
  'CREATE_POLL',
  'UPDATE_POLL',
  'VOTE_ON_POLL',
  // And the name writes (BUY_NAME additionally pays).
  'REGISTER_NAME',
  'UPDATE_NAME',
  'SELL_NAME',
  'CANCEL_SELL_NAME',
  'BUY_NAME',
  // And the group mutations.
  'CREATE_GROUP',
  'UPDATE_GROUP',
  'GROUP_APPROVAL',
  'SET_GROUP',
  'SET_GROUP_AVATAR',
]) {
  assert.equal(widgetActions.includes(action), false, `widget must not advertise ${action}`)
}
// The public reads restored in R4 tier-2 DO reach a widget — they are
// anonymous chain or price reads — but the ones whose subject address defaults
// to the selected account must withhold that default there, or the answer
// becomes an identity disclosure with no chrome to announce it.
for (const action of [
  'GET_ACCOUNT_DATA',
  'GET_ACCOUNT_RATING',
  'GET_BALANCE',
  'GET_MEMBER_BANS',
  'GET_MEMBER_KICKS',
  'GET_RESOURCE_RATING',
]) {
  assert.equal(
    homeV2WidgetWithholdsSelfSubject(action),
    true,
    `${action} must not self-address in a widget`,
  )
}
// A read with no self-addressing default is unaffected by that rule.
for (const action of ['GET_GROUP_BANS', 'GET_CROSSCHAIN_BLOCKCHAINS', 'GET_MARKET_PRICES']) {
  assert.equal(homeV2WidgetWithholdsSelfSubject(action), false)
}
// The same actions stay available in a normal tab: the widget exclusion must
// not be mistaken for the action being unimplemented.
for (const action of ['GET_MINTING_STATUS', 'LIST_MINTING_ACCOUNTS', 'START_MINTING']) {
  assert.equal(normalTabActions.includes(action), true, `tab should advertise ${action}`)
}
const androidActions = getHomeV2ContextualAppActions(
  getHomeV2AvailableAppActions('qdnRequest', {
    qortal: publicInfo.route,
    qortium: publicInfo.route,
  }),
  'android',
)
assert.equal(androidActions.includes('OPEN_AS_WIDGET'), false)
assert.equal(androidActions.some((action) => action.startsWith('WIDGET_')), false)
assert.equal(androidActions.includes('SHOW_CONTEXT_MENU'), true)
// The LIST family is advertised on Android now: it administers the user's own
// node, which Home permits wherever they attached that node's API key — a
// custom node over HTTPS or an SSH tunnel — and Android implements the arm.
for (const action of ['GET_ALL_LISTS', 'GET_LIST', 'ADD_TO_LIST', 'REMOVE_FROM_LIST',
  // Poll writes sign locally on Android now: the vault owns the same
  // build → assert → mempow → stamp → assert → sign sequence desktop uses.
  'CREATE_POLL', 'UPDATE_POLL', 'VOTE_ON_POLL',
  // Name writes too, on the same in-vault signing path. BUY_NAME is included
  // deliberately: it PAYS, and a payment the user can make on desktop but not
  // on their phone is a platform that half works, not a safer one.
  'REGISTER_NAME', 'UPDATE_NAME', 'SELL_NAME', 'CANCEL_SELL_NAME', 'BUY_NAME',
  // The group mutations are LOCAL-transformer families with no Core builder,
  // so their Android arm additionally verifies the stamped bytes.
  'CREATE_GROUP', 'UPDATE_GROUP', 'GROUP_APPROVAL', 'SET_GROUP', 'SET_GROUP_AVATAR',
  // Ratings and the account avatar are local transformers too.
  'RATE_ACCOUNT', 'RATE_RESOURCE', 'SET_ACCOUNT_AVATAR',
  // The publishing extras: the batch became possible once the Android publish
  // source store gained a total byte budget, and the tombstone is one signed
  // transaction like any other.
  'PUBLISH_MULTIPLE_QDN_RESOURCES', 'DELETE_QDN_RESOURCE',
  // And the AT contract message, the last non-payment signing family.
  'SEND_MESSAGE']) {
  assert.equal(androidActions.includes(action), true, `android must advertise ${action}`)
}
// The payment family crossed last, deliberately: it MOVES FUNDS. Nothing Home
// 2 implements is withheld from Android any more, so this asserts the END of
// the parity wave rather than a remaining gap.
for (const action of ['PAYMENT', 'SEND_COIN', 'TRANSFER_ASSET']) {
  assert.equal(androidActions.includes(action), true, `android must advertise ${action}`)
}
// SEND_QORT is Qortal-only and lives on the qortalRequest catalogue.
assert.equal(androidActions.includes('SEND_QORT'), false, 'SEND_QORT is not a qdnRequest action')

// DERIVED, not hand-listed: whatever the catalogue advertises to a desktop app
// on a given protocol, Android advertises too. A hand-written list of families
// can only assert what someone remembered to add; this asserts the property
// the empty ANDROID_UNSUPPORTED_ACTIONS actually claims, so a future action
// filtered from Android without a stated reason fails here.
for (const protocol of ['qdnRequest', 'qortalRequest'] as const) {
  const desktopSurface = getHomeV2ContextualAppActions(getHomeV2AppActions(protocol), 'tab')
  const androidSurface = getHomeV2ContextualAppActions(getHomeV2AppActions(protocol), 'android')
  const withheld = desktopSurface.filter((entry) => !androidSurface.includes(entry))
  assert.deepEqual(
    // OPEN_AS_WIDGET is the one documented difference and is not a capability:
    // Android has no widget surface to open onto.
    withheld.filter((entry) => entry !== 'OPEN_AS_WIDGET'),
    [],
    `android must advertise everything the ${protocol} catalogue advertises to a tab`,
  )
}

// And the withholding MECHANISM still works, even though nothing uses it: an
// empty list is not the same as a broken filter, and the next action that
// genuinely needs to be withheld should not discover that here.
{
  const probe = 'GET_NODE_STATUS'
  assert.equal(
    getHomeV2ContextualAppActions([probe, 'GET_HOST_INFO'], 'android', new Set([probe])).includes(probe),
    false,
    'a withheld action is filtered from the Android surface',
  )
  assert.equal(
    getHomeV2ContextualAppActions([probe, 'GET_HOST_INFO'], 'tab', new Set([probe])).includes(probe),
    true,
    'the same action stays on the desktop surface',
  )
}

// ---------------------------------------------------------------------------
// The app-facing notification manager family.
// ---------------------------------------------------------------------------

const notificationManagerActions = [
  'NOTIFICATION_MANAGER_HAS_PERMISSION',
  'NOTIFICATION_MANAGER_GET',
  'NOTIFICATION_MANAGER_SET_MUTED',
  'NOTIFICATION_MANAGER_REMOVE_RULES',
  'NOTIFICATION_MANAGER_REVOKE',
] as const

const disabledRoute = getHomeV2AppHostInfo({
  hostVersion: '2.1.0',
  node: {
    capabilities: { read: false },
    customConfigured: false,
    mode: 'disabled',
    nodeApiUrl: null,
  },
  platform: 'desktop',
  platformVersion: '2.1',
  protocol: 'qdnRequest',
}).route
assert.equal(disabledRoute.available, false)

for (const action of notificationManagerActions) {
  // Advertised on qdnRequest only: the data is Home's profile, not a chain's,
  // so a qortalRequest copy of it would be meaningless.
  assert.equal(
    getHomeV2AvailableAppActions('qdnRequest', {
      qortal: publicInfo.route,
      qortium: publicInfo.route,
    }).includes(action),
    true,
    `${action} must be advertised on qdnRequest`,
  )
  assert.equal(
    getHomeV2AvailableAppActions('qortalRequest', {
      qortal: publicInfo.route,
      qortium: publicInfo.route,
    }).includes(action),
    false,
    `${action} must not be advertised on qortalRequest`,
  )
  // Route-independent: still callable with every node route disabled.
  assert.equal(
    getHomeV2AvailableAppActions('qdnRequest', {
      qortal: disabledRoute,
      qortium: disabledRoute,
    }).includes(action),
    true,
    `${action} must stay callable while the node route is disabled`,
  )
  // Also callable while the route is configured but unreachable.
  assert.equal(
    getHomeV2AvailableAppActions('qdnRequest', {
      qortal: unreachableInfo.route,
      qortium: unreachableInfo.route,
    }).includes(action),
    true,
    `${action} must stay callable while the node route is unreachable`,
  )
  // Widgets are chromeless: they have no trusted surface to raise a manager
  // prompt on, and the whole family is administrative. isWidgetPublicReadAction
  // excludes them today only because none of them matches its read prefixes —
  // this pins that OUTCOME so a future rename (say, GET_NOTIFICATION_MANAGER)
  // cannot quietly admit an administrative action to a widget.
  assert.equal(widgetActions.includes(action), false, `widget must not advertise ${action}`)
  // The widget exclusion must not be mistaken for the action being missing.
  assert.equal(normalTabActions.includes(action), true, `tab should advertise ${action}`)
  assert.equal(androidActions.includes(action), true, `android should advertise ${action}`)
}

// SHOW_ACTIONS must expose the five together or not at all: Notify
// feature-detects the family with hasEveryAction (qortium-notify App.tsx).
const advertised = notificationManagerActions.filter((action) => normalTabActions.includes(action))
assert.equal(
  advertised.length,
  notificationManagerActions.length,
  'the notification manager family must be advertised all-or-nothing',
)

// ---------------------------------------------------------------------------
// The app-facing Home-settings family.
// ---------------------------------------------------------------------------

const homeSettingsActions = [
  'GET_HOME_SETTINGS_METADATA',
  'GET_HOME_SETTINGS',
  'UPDATE_HOME_SETTINGS',
] as const

for (const action of homeSettingsActions) {
  // Advertised on qdnRequest only. Home has ONE appearance, not a Qortal one
  // and a Qortium one, so a qortalRequest copy would either mean the same thing
  // twice or imply a per-chain appearance that does not exist.
  assert.equal(
    getHomeV2AvailableAppActions('qdnRequest', {
      qortal: publicInfo.route,
      qortium: publicInfo.route,
    }).includes(action),
    true,
    `${action} must be advertised on qdnRequest`,
  )
  assert.equal(
    getHomeV2AvailableAppActions('qortalRequest', {
      qortal: publicInfo.route,
      qortium: publicInfo.route,
    }).includes(action),
    false,
    `${action} must not be advertised on qortalRequest`,
  )
  // Route-independent: no node is involved in reading or changing Home's own
  // appearance, so the family stays callable with every route disabled...
  assert.equal(
    getHomeV2AvailableAppActions('qdnRequest', {
      qortal: disabledRoute,
      qortium: disabledRoute,
    }).includes(action),
    true,
    `${action} must stay callable while the node route is disabled`,
  )
  // ...and while a configured route is unreachable.
  assert.equal(
    getHomeV2AvailableAppActions('qdnRequest', {
      qortal: unreachableInfo.route,
      qortium: unreachableInfo.route,
    }).includes(action),
    true,
    `${action} must stay callable while the node route is unreachable`,
  )
  // Widgets are excluded, INCLUDING the two reads.
  //
  // This is the pin that matters most in this block. GET_HOME_SETTINGS and
  // GET_HOME_SETTINGS_METADATA both match isWidgetPublicReadAction's GET_
  // prefix and would be admitted to a widget by default. They are excluded
  // explicitly because a widget has no trusted Home chrome to raise the
  // UPDATE_HOME_SETTINGS prompt on, and shipping the read half of a read/write
  // pair without the write half is an incoherent surface. The display subset a
  // widget actually needs already reaches it as render-URL parameters.
  assert.equal(widgetActions.includes(action), false, `widget must not advertise ${action}`)
  // The widget exclusion must not be mistaken for the action being missing.
  assert.equal(normalTabActions.includes(action), true, `tab should advertise ${action}`)
  assert.equal(androidActions.includes(action), true, `android should advertise ${action}`)
}

// All-or-nothing on SHOW_ACTIONS: an app that feature-detects the family and
// finds the reads but not the write would render a settings surface it cannot
// save from.
assert.equal(
  homeSettingsActions.filter((action) => normalTabActions.includes(action)).length,
  homeSettingsActions.length,
  'the Home settings family must be advertised all-or-nothing',
)

// No widget may see any part of it, whatever else changes above.
assert.equal(
  homeSettingsActions.some((action) => widgetActions.includes(action)),
  false,
  'no Home settings action may reach a widget',
)

// Encryption is arithmetic over the account's own key: no node, no route. It
// must stay answerable when the route is unavailable, and must NOT be refused
// on Android — it is fully portable, and the vault holds the key there.
assert.equal(HOME_V2_ROUTE_INDEPENDENT_ACTIONS.includes('ENCRYPT_DATA'), true)
assert.equal(HOME_V2_ROUTE_INDEPENDENT_ACTIONS.includes('DECRYPT_DATA'), true)
assert.equal(isHomeV2AndroidUnsupportedAction('DECRYPT_DATA'), false)
// A widget must never reach decryption either — it is a public-read surface.
assert.equal(
  getHomeV2ContextualAppActions(['DECRYPT_DATA', 'GET_HOST_INFO'], 'widget', new Set<string>()).includes('DECRYPT_DATA'),
  false,
)
assert.equal(
  getHomeV2ContextualAppActions(['DECRYPT_DATA', 'GET_HOST_INFO'], 'tab', new Set<string>()).includes('DECRYPT_DATA'),
  true,
)
// A WIDGET must never reach it. Widgets are public-read surfaces; using the
// account's key is not a public read, and the widget allowlist admits only
// FETCH/GET/LIST/SEARCH/RESOLVE reads plus a fixed local set. Pinned because a
// future loosening of that allowlist would otherwise hand widgets the key.
assert.equal(
  getHomeV2ContextualAppActions(['ENCRYPT_DATA', 'GET_HOST_INFO'], 'widget', new Set<string>()).includes('ENCRYPT_DATA'),
  false,
)
assert.equal(
  getHomeV2ContextualAppActions(['ENCRYPT_DATA', 'GET_HOST_INFO'], 'tab', new Set<string>()).includes('ENCRYPT_DATA'),
  true,
)
assert.equal(
  getHomeV2ContextualAppActions(['ENCRYPT_DATA', 'GET_HOST_INFO'], 'android', new Set<string>()).includes('ENCRYPT_DATA'),
  true,
)
assert.equal(isHomeV2AndroidUnsupportedAction('ENCRYPT_DATA'), false)
assert.equal(homeV2AndroidActionRefusal('ENCRYPT_DATA', 'qdnRequest'), null)
assert.equal(homeV2AndroidActionRefusal('ENCRYPT_DATA', 'qortalRequest'), null)

console.log('Home v2 app runtime contract tests passed.')
