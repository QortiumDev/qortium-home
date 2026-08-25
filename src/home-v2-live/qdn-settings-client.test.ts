import assert from 'node:assert/strict'
import {
  createHomeV2QdnSettingsClient,
  createPortableHomeV2QdnSettingsAdapter,
  getHomeV2QdnAssignmentRows,
  parseHomeV2QdnSettingsState,
  resolveHomeV2QdnSettingsManagement,
  type HomeV2QdnSettingsAdapter,
} from './qdn-settings-client'

const state = {
  assignments: {
    assignments: {
      bookmarks: {
        description: 'Bookmarks role',
        label: 'Bookmarks',
        url: 'qdn://APP/Bookmarks/Bookmarks',
      },
      explore: {
        description: 'Explore role',
        label: 'Explore',
        url: 'qdn://APP/CustomExplore/CustomExplore',
      },
      notifications: {
        description: 'Notifications role',
        label: 'Notifications',
        url: 'qdn://APP/Notify/Notify',
      },
      'media.video': {
        description: null,
        label: 'Video',
        url: 'qdn://WEBSITE/Video',
      },
    },
    revision: 3,
    version: 2,
  },
  bookmarks: {
    apps: [{
      appKey: 'qdn://APP/Bookmarks/Bookmarks',
      grantedAt: '2026-08-22T11:00:00.000Z',
    }],
    revision: 3,
    version: 1,
  },
  chatSend: {
    apps: [{
      appKey: 'qdn://APP/Chat/Chat',
      grantedAt: '2026-08-22T13:00:00.000Z',
    }],
    revision: 3,
    version: 1,
  },
  accountRead: {
    apps: [{
      accountId: 'wallet:QAAA',
      appKey: 'qdn://APP/Chat/Chat',
      grantedAt: '2026-08-22T14:00:00.000Z',
    }, {
      accountId: 'wallet:QBBB',
      appKey: 'qdn://APP/Chat/Chat',
      grantedAt: '2026-08-22T15:00:00.000Z',
    }],
    revision: 3,
    version: 1,
  },
  notifications: {
    apps: [{
      appKey: 'qdn://APP/Notify/Notify',
      grantedAt: '2026-08-22T12:00:00.000Z',
      hasForeignPaymentRule: true,
      muted: true,
      ruleCount: 2,
    }],
    revision: 7,
    status: 'available',
    version: 1,
  },
  revision: 1,
  schema: 'home-v2-qdn-settings-state',
} as const

const parsed = parseHomeV2QdnSettingsState(state)
assert.deepEqual(
  getHomeV2QdnAssignmentRows(parsed).map(({ defaultUrl, role }) => ({ defaultUrl, role })),
  [
    { defaultUrl: 'qdn://APP/Bookmarks/Bookmarks', role: 'bookmarks' },
    { defaultUrl: 'qdn://APP/Notify/Notify', role: 'notifications' },
    { defaultUrl: 'qdn://APP/Explore/Explore', role: 'explore' },
    { defaultUrl: null, role: 'media.video' },
  ],
)
// One app appears once per account it holds a grant for.
assert.deepEqual(parsed.accountRead.apps.map(({ accountId }) => accountId), [
  'wallet:QAAA',
  'wallet:QBBB',
])
assert.throws(
  () => parseHomeV2QdnSettingsState({ ...state, privatePath: '/secret' }),
  /malformed/,
)
// A state that omits the durable read grants must be rejected rather than
// silently parsed as "no app holds one" — that would hide a live grant from
// the revocation surface.
assert.throws(
  () => {
    const { accountRead: _omitted, ...withoutAccountRead } = state
    return parseHomeV2QdnSettingsState(withoutAccountRead)
  },
  /malformed/,
)
assert.throws(
  () => parseHomeV2QdnSettingsState({
    ...state,
    accountRead: {
      apps: [...state.accountRead.apps, ...state.accountRead.apps],
      revision: 3,
      version: 1,
    },
  }),
  /duplicate account-read grants/,
)
// The same app for two DIFFERENT accounts is legitimate, not a duplicate.
assert.equal(
  parseHomeV2QdnSettingsState(state).accountRead.apps.length,
  2,
)
// An account grant must name its account.
assert.throws(
  () => parseHomeV2QdnSettingsState({
    ...state,
    accountRead: {
      apps: [{ appKey: 'qdn://APP/Chat/Chat', grantedAt: '2026-08-22T14:00:00.000Z' }],
      revision: 3,
      version: 1,
    },
  }),
  /account grant was malformed/,
)
// A qortal:// principal is a legitimate holder of a durable read grant.
assert.equal(
  parseHomeV2QdnSettingsState({
    ...state,
    accountRead: {
      apps: [{
        accountId: 'wallet:QAAA',
        appKey: 'qortal://APP/Chat/Chat',
        grantedAt: '2026-08-22T14:00:00.000Z',
      }],
      revision: 3,
      version: 1,
    },
  }).accountRead.apps[0]?.appKey,
  'qortal://APP/Chat/Chat',
)
// A stored principal must already be canonical: no query, no route.
assert.throws(
  () => parseHomeV2QdnSettingsState({
    ...state,
    accountRead: {
      apps: [{
        accountId: 'wallet:QAAA',
        appKey: 'qdn://APP/Chat/Chat?identifier=evil',
        grantedAt: '2026-08-22T14:00:00.000Z',
      }],
      revision: 3,
      version: 1,
    },
  }),
  /account grant was malformed/,
)
assert.throws(
  () => parseHomeV2QdnSettingsState({
    ...state,
    assignments: {
      ...state.assignments,
      assignments: { explore: state.assignments.assignments.explore },
    },
  }),
  /omitted a default/,
)
assert.throws(
  () => parseHomeV2QdnSettingsState({
    ...state,
    notifications: {
      apps: state.notifications.apps,
      revision: null,
      status: 'corrupt',
      version: 1,
    },
  }),
  /exposed app data/,
)

const requests: unknown[] = []
const adapter: HomeV2QdnSettingsAdapter = {
  async get() {
    requests.push('get')
    return state
  },
  async revoke(request) {
    requests.push(request)
    return state
  },
  async revokeBookmarks(request) {
    requests.push(request)
    return state
  },
  async setAssignment(request) {
    requests.push(request)
    return state
  },
  async setMuted(request) {
    requests.push(request)
    return state
  },
}
const client = createHomeV2QdnSettingsClient(adapter)
await client.get()
await client.setAssignment({
  expectedAssignmentRevision: 3,
  role: 'explore',
  url: 'qdn://APP/Explore/Explore',
})
await client.setMuted({
  appKey: 'qdn://APP/Notify/Notify',
  expectedNotificationRevision: 7,
  muted: false,
})
await client.revoke({
  appKey: 'qdn://APP/Notify/Notify',
  expectedNotificationRevision: 7,
})
await client.revokeBookmarks({
  appKey: 'qdn://APP/Bookmarks/Bookmarks',
  expectedAssignmentRevision: 3,
})
assert.deepEqual(requests, [
  'get',
  {
    expectedAssignmentRevision: 3,
    role: 'explore',
    url: 'qdn://APP/Explore/Explore',
  },
  {
    appKey: 'qdn://APP/Notify/Notify',
    expectedNotificationRevision: 7,
    muted: false,
  },
  {
    appKey: 'qdn://APP/Notify/Notify',
    expectedNotificationRevision: 7,
  },
  {
    appKey: 'qdn://APP/Bookmarks/Bookmarks',
    expectedAssignmentRevision: 3,
  },
])

const portableCalls: unknown[] = []
const portableAssignments = {
  ...state.assignments,
  capabilityGrants: {
    'qdn://APP/Secret/Secret': { 'bookmarks.manage': { grantedAt: '2026-08-22T12:00:00.000Z' } },
  },
  accountCapabilityGrants: {
    'qdn://APP/Chat/Chat': {
      'wallet:QAAA': { 'account.read': { grantedAt: '2026-08-22T14:00:00.000Z' } },
    },
  },
  legacyMigrated: true,
}
const portableNotifications = {
  grants: {
    'qdn://APP/Notify/Notify': {
      grantedAt: '2026-08-22T12:00:00.000Z',
      muted: true,
    },
  },
  revision: 7,
  rules: {
    'qdn://APP/Notify/Notify': [{
      accountAddress: 'QSECRET',
      createdAt: '2026-08-22T12:00:00.000Z',
      event: 'FOREIGN_PAYMENT_RECEIVED',
      filters: { xpub: 'secret-watch-data' },
      notificationId: 'payment',
    }],
  },
  version: 1,
}
const portableAdapter = createPortableHomeV2QdnSettingsAdapter({
  readAssignments: async () => portableAssignments,
  readNotifications: async () => portableNotifications,
  revokeBookmarks: async (...values) => { portableCalls.push(['bookmarks', ...values]) },
  revokeNotifications: async (...values) => { portableCalls.push(['revoke', ...values]) },
  setAssignment: async (...values) => { portableCalls.push(['assignment', ...values]) },
  setMuted: async (...values) => { portableCalls.push(['muted', ...values]) },
})
const portableClient = createHomeV2QdnSettingsClient(portableAdapter)
const portableState = await portableClient.get()
assert.deepEqual(portableState.notifications.apps, [{
  appKey: 'qdn://APP/Notify/Notify',
  grantedAt: '2026-08-22T12:00:00.000Z',
  hasForeignPaymentRule: true,
  muted: true,
  ruleCount: 1,
}])
assert.deepEqual(portableState.bookmarks.apps, [{
  appKey: 'qdn://APP/Secret/Secret',
  grantedAt: '2026-08-22T12:00:00.000Z',
}])
// The durable read-only account grant is surfaced separately, so it can be
// listed and revoked on its own without touching the bookmarks grant.
assert.deepEqual(portableState.accountRead.apps, [{
  accountId: 'wallet:QAAA',
  appKey: 'qdn://APP/Chat/Chat',
  grantedAt: '2026-08-22T14:00:00.000Z',
}])
assert.equal(portableState.bookmarks.apps.some(({ appKey }) => appKey === 'qdn://APP/Chat/Chat'), false)
assert.equal(JSON.stringify(portableState).includes('secret-watch-data'), false)
assert.equal(JSON.stringify(portableState).includes('QSECRET'), false)
assert.equal(JSON.stringify(portableState).includes('capabilityGrants'), false)
await portableAdapter.setAssignment({
  expectedAssignmentRevision: 3,
  role: 'explore',
  url: 'qdn://APP/Explore/Explore',
})
await portableAdapter.setMuted({
  appKey: 'qdn://APP/Notify/Notify',
  expectedNotificationRevision: 7,
  muted: false,
})
await portableAdapter.revoke({
  appKey: 'qdn://APP/Notify/Notify',
  expectedNotificationRevision: 7,
})
await portableAdapter.revokeBookmarks({
  appKey: 'qdn://APP/Secret/Secret',
  expectedAssignmentRevision: 3,
})
// Revoking the durable read grant travels the same channel, carrying the
// capability explicitly; an omitted capability still means bookmarks only.
await portableAdapter.revokeBookmarks({
  accountId: 'wallet:QAAA',
  appKey: 'qdn://APP/Chat/Chat',
  capability: 'account.read',
  expectedAssignmentRevision: 3,
})
assert.deepEqual(portableCalls, [
  ['assignment', { role: 'explore', url: 'qdn://APP/Explore/Explore' }, 3],
  ['muted', 'qdn://APP/Notify/Notify', false, 7],
  ['revoke', 'qdn://APP/Notify/Notify', 7],
  ['bookmarks', 'qdn://APP/Secret/Secret', 3, 'bookmarks.manage', undefined],
  ['bookmarks', 'qdn://APP/Chat/Chat', 3, 'account.read', 'wallet:QAAA'],
])
const corruptPortable = createPortableHomeV2QdnSettingsAdapter({
  readAssignments: async () => portableAssignments,
  readNotifications: async () => ({ broken: true }),
  revokeBookmarks: async () => undefined,
  revokeNotifications: async () => undefined,
  setAssignment: async () => undefined,
  setMuted: async () => undefined,
})
assert.equal(
  (await createHomeV2QdnSettingsClient(corruptPortable).get()).notifications.status,
  'corrupt',
)
const unavailablePortable = createPortableHomeV2QdnSettingsAdapter({
  readAssignments: async () => portableAssignments,
  readNotifications: async () => { throw new Error('Preferences unavailable') },
  revokeBookmarks: async () => undefined,
  revokeNotifications: async () => undefined,
  setAssignment: async () => undefined,
  setMuted: async () => undefined,
})
assert.equal(
  (await createHomeV2QdnSettingsClient(unavailablePortable).get()).notifications.status,
  'unavailable',
)

const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  get: () => { throw new Error('localStorage must not be accessed') },
})
try {
  assert.deepEqual(resolveHomeV2QdnSettingsManagement(null), { available: false })
  assert.equal(resolveHomeV2QdnSettingsManagement(adapter).available, true)
  delete (window as Window & { homeV2QdnSettings?: unknown }).homeV2QdnSettings
  assert.deepEqual(resolveHomeV2QdnSettingsManagement(), { available: false })
} finally {
  if (storageDescriptor) {
    Object.defineProperty(window, 'localStorage', storageDescriptor)
  }
}

console.log('Home 2 QDN settings client tests passed.')
