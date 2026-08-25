import assert from 'node:assert/strict'
import {
  createDefaultQdnAppRolesStore,
  grantQdnAppCapability,
  revokeQdnAppCapability,
  setQdnAppAssignment,
  type QdnAppAssignmentsStore,
} from './qdn-manager-permissions.js'
import {
  createAuthorizedHomeV2QdnSettingsHandlers,
  createHomeV2QdnSettingsService,
} from './home-v2-qdn-settings-contract.js'
import type { QdnNotificationStore } from './notification-rules.js'

let assignments = grantQdnAppCapability(
  grantQdnAppCapability(
    grantQdnAppCapability(
      createDefaultQdnAppRolesStore(),
      'qdn://APP/Bookmarks/Bookmarks',
      'bookmarks.manage',
    ),
    'qdn://APP/Reader/Reader',
    'assignments.read',
  ),
  'qdn://APP/Chat/Chat',
  'account.read',
)
let notifications: QdnNotificationStore = {
  grants: {
    'qdn://APP/Notify/Notify': {
      grantedAt: '2026-08-20T12:00:00.000Z',
      muted: true,
    },
  },
  revision: 4,
  rules: {
    'qdn://APP/Notify/Notify': [
      {
        accountAddress: 'Q-secret-account',
        createdAt: '2026-08-20T12:01:00.000Z',
        event: 'FOREIGN_PAYMENT_RECEIVED',
        filters: { coin: 'LTC', xpub: 'secret-xpub' },
        notificationId: 'foreign-payment',
      },
      {
        accountAddress: 'Q-secret-account',
        createdAt: '2026-08-20T12:02:00.000Z',
        event: 'CHAT_MESSAGE',
        filters: { txGroupId: 7 },
        notificationId: 'chat',
      },
    ],
  },
  version: 1,
}
let dependencyReads = 0
let notificationInspectionStatus: 'available' | 'corrupt' | 'unavailable' = 'available'
let notificationMutations = 0

function readAssignments() {
  dependencyReads += 1
  return assignments
}

function inspectNotifications() {
  dependencyReads += 1
  return notificationInspectionStatus === 'available'
    ? { status: 'available' as const, store: notifications }
    : { status: notificationInspectionStatus, store: null }
}

const service = createHomeV2QdnSettingsService({
  inspectNotifications,
  readAssignments,
  revokeBookmarks(expectedRevision, appKey, capability) {
    assert.equal(expectedRevision, assignments.revision, 'bookmark permission CAS must reject stale callers')
    // The service must forward the capability the user actually asked to
    // revoke; ignoring it here would let a read-grant revoke silently drop
    // the bookmarks grant instead.
    assignments = revokeQdnAppCapability(assignments, appKey, capability)
    return assignments
  },
  revokeNotifications(expectedRevision, appKey) {
    notificationMutations += 1
    assert.equal(expectedRevision, notifications.revision, 'notification CAS must reject stale callers')
    const grants = { ...notifications.grants }
    const rules = { ...notifications.rules }
    delete grants[appKey]
    delete rules[appKey]
    notifications = {
      ...notifications,
      grants,
      revision: notifications.revision + 1,
      rules,
    }
    return notifications
  },
  setAssignment(expectedRevision, input) {
    assert.equal(expectedRevision, assignments.revision, 'assignment CAS must reject stale callers')
    assignments = setQdnAppAssignment(assignments, input)
    return assignments
  },
  setMuted(expectedRevision, appKey, muted) {
    notificationMutations += 1
    assert.equal(expectedRevision, notifications.revision, 'notification CAS must reject stale callers')
    const grant = notifications.grants[appKey]
    if (!grant) throw new Error('Notification permission is not granted for this app.')
    notifications = {
      ...notifications,
      grants: {
        ...notifications.grants,
        [appKey]: { ...grant, muted: muted || undefined },
      },
      revision: notifications.revision + 1,
    }
    return notifications
  },
})

const getRequest = { revision: 1, schema: 'home-v2-qdn-settings-get-request' }
const initial = service.get(getRequest)
assert.equal(initial.assignments.version, 2)
assert.equal(initial.assignments.assignments.bookmarks.url, 'qdn://APP/Bookmarks/Bookmarks')
assert.deepEqual(initial.bookmarks.apps.map(({ appKey }) => appKey), [
  'qdn://APP/Bookmarks/Bookmarks',
])
assert.equal(initial.notifications.revision, 4)
assert.equal(initial.notifications.status, 'available')
assert.deepEqual(initial.notifications.apps, [{
  appKey: 'qdn://APP/Notify/Notify',
  grantedAt: '2026-08-20T12:00:00.000Z',
  hasForeignPaymentRule: true,
  muted: true,
  ruleCount: 2,
}])
const serializedInitial = JSON.stringify(initial)
for (const secret of ['capabilityGrants', 'Q-secret-account', 'secret-xpub', 'filters', 'notificationId']) {
  assert.equal(serializedInitial.includes(secret), false, `state must redact ${secret}`)
}

assert.throws(() => service.get({ ...getRequest, extra: true }), /exact/)
assert.throws(() => service.get([]), /exact/)

const assigned = service.setAssignment({
  expectedAssignmentRevision: assignments.revision,
  revision: 1,
  role: 'bookmarks',
  schema: 'home-v2-qdn-settings-set-assignment-request',
  url: 'qdn://APP/Other/Bookmarks#/saved',
})
assert.equal(assigned.assignments.revision, assignments.revision)
assert.equal(assigned.assignments.assignments.bookmarks.url, 'qdn://APP/Other/Bookmarks#/saved')
assert.equal(assigned.assignments.assignments.bookmarks.label, 'Bookmarks')
assert.throws(() => service.setAssignment({
  expectedAssignmentRevision: assignments.revision,
  extra: true,
  revision: 1,
  role: 'bookmarks',
  schema: 'home-v2-qdn-settings-set-assignment-request',
  url: 'qdn://APP/Other/Bookmarks',
}), /exact/)
assert.throws(() => service.setAssignment({
  expectedAssignmentRevision: assignments.revision,
  revision: 1,
  role: 'media.video-player',
  schema: 'home-v2-qdn-settings-set-assignment-request',
  url: 'qdn://APP/Explore/Explore#/service/VIDEO',
}), /persisted/)
assert.throws(() => service.setAssignment({
  expectedAssignmentRevision: assignments.revision - 1,
  revision: 1,
  role: 'bookmarks',
  schema: 'home-v2-qdn-settings-set-assignment-request',
  url: 'qdn://APP/Other/Bookmarks',
}), /assignment CAS/)
assert.throws(() => service.setAssignment({
  expectedAssignmentRevision: -1,
  revision: 1,
  role: 'bookmarks',
  schema: 'home-v2-qdn-settings-set-assignment-request',
  url: 'qdn://APP/Other/Bookmarks',
}), /non-negative safe integer/)
assert.throws(() => service.setAssignment({
  expectedAssignmentRevision: assignments.revision,
  revision: 1,
  role: 'bookmarks',
  schema: 'home-v2-qdn-settings-set-assignment-request',
  url: `qdn://APP/${'x'.repeat(2_100)}`,
}), /valid QDN APP or WEBSITE/)

const bookmarkRevoked = service.revokeBookmarks({
  appKey: 'qdn://APP/Bookmarks/Bookmarks#/all',
  expectedAssignmentRevision: assignments.revision,
  revision: 1,
  schema: 'home-v2-qdn-settings-revoke-bookmarks-request',
})
assert.deepEqual(bookmarkRevoked.bookmarks.apps, [])
assert.equal(bookmarkRevoked.bookmarks.revision, assignments.revision)
assert.throws(() => service.revokeBookmarks({
  appKey: 'qdn://APP/Bookmarks/Bookmarks',
  expectedAssignmentRevision: assignments.revision,
  extra: true,
  revision: 1,
  schema: 'home-v2-qdn-settings-revoke-bookmarks-request',
}), /exact/)

// The durable read-only account grant is listed on this surface and can be
// revoked from it — a durable "always allow" the user cannot take back would
// be a one-way door.
assert.deepEqual(service.get({
  revision: 1,
  schema: 'home-v2-qdn-settings-get-request',
}).accountRead.apps, [{
  appKey: 'qdn://APP/Chat/Chat',
  grantedAt: assignments.capabilityGrants['qdn://APP/Chat/Chat']?.['account.read']?.grantedAt,
}])
const accountReadRevoked = service.revokeBookmarks({
  appKey: 'qdn://APP/Chat/Chat',
  capability: 'account.read',
  expectedAssignmentRevision: assignments.revision,
  revision: 1,
  schema: 'home-v2-qdn-settings-revoke-bookmarks-request',
})
assert.deepEqual(accountReadRevoked.accountRead.apps, [])
// Revoking the read grant must not disturb any other capability — the
// bookmarks assignment keeps the URL this test set on it earlier.
assert.equal(
  accountReadRevoked.assignments.assignments.bookmarks?.url,
  'qdn://APP/Other/Bookmarks#/saved',
)
// Only allowlisted capabilities may be revoked through the renderer, and the
// allowlist is not a way to revoke something that was never grantable.
for (const capability of ['account.minting', 'chat.private-group.read', 'assignments.read', '']) {
  assert.throws(() => service.revokeBookmarks({
    appKey: 'qdn://APP/Chat/Chat',
    capability,
    expectedAssignmentRevision: assignments.revision,
    revision: 1,
    schema: 'home-v2-qdn-settings-revoke-bookmarks-request',
  }), /cannot be revoked/)
}

const muted = service.setMuted({
  appKey: 'qdn://app/Notify/Notify#/settings',
  expectedNotificationRevision: notifications.revision,
  muted: false,
  revision: 1,
  schema: 'home-v2-qdn-settings-set-muted-request',
})
assert.equal(muted.notifications.revision, 5)
assert.equal(muted.notifications.apps[0]?.muted, false)
assert.throws(() => service.setMuted({
  appKey: 'qdn://APP/Notify/Notify',
  expectedNotificationRevision: notifications.revision,
  extra: true,
  muted: true,
  revision: 1,
  schema: 'home-v2-qdn-settings-set-muted-request',
}), /exact/)
assert.throws(() => service.setMuted({
  appKey: 'qdn://APP/Notify/Notify',
  expectedNotificationRevision: 4,
  muted: true,
  revision: 1,
  schema: 'home-v2-qdn-settings-set-muted-request',
}), /notification CAS/)
assert.throws(() => service.setMuted({
  appKey: 'https://example.com',
  expectedNotificationRevision: notifications.revision,
  muted: true,
  revision: 1,
  schema: 'home-v2-qdn-settings-set-muted-request',
}), /valid QDN APP or WEBSITE/)
assert.throws(() => service.setMuted({
  appKey: 'qdn://APP/Notify/Notify',
  expectedNotificationRevision: notifications.revision,
  muted: 1,
  revision: 1,
  schema: 'home-v2-qdn-settings-set-muted-request',
}), /exact/)

const revoked = service.revoke({
  appKey: 'qdn://APP/Notify/Notify',
  expectedNotificationRevision: notifications.revision,
  revision: 1,
  schema: 'home-v2-qdn-settings-revoke-request',
})
assert.equal(revoked.notifications.revision, 6)
assert.deepEqual(revoked.notifications.apps, [])
assert.equal(notifications.rules['qdn://APP/Notify/Notify'], undefined)
assert.throws(() => service.revoke({
  appKey: 'qdn://APP/Notify/Notify',
  expectedNotificationRevision: notifications.revision,
  revision: 1,
  schema: 'home-v2-qdn-settings-revoke-request',
  rules: [],
}), /exact/)

notificationInspectionStatus = 'corrupt'
const mutationsBeforeUnavailable = notificationMutations
assert.throws(() => service.setMuted({
  appKey: 'qdn://APP/Notify/Notify',
  expectedNotificationRevision: notifications.revision,
  muted: true,
  revision: 1,
  schema: 'home-v2-qdn-settings-set-muted-request',
}), (error: unknown) =>
  (error as { code?: unknown }).code === 'HOME_NOTIFICATION_STORE_CORRUPT')
assert.throws(() => service.revoke({
  appKey: 'qdn://APP/Notify/Notify',
  expectedNotificationRevision: notifications.revision,
  revision: 1,
  schema: 'home-v2-qdn-settings-revoke-request',
}), (error: unknown) =>
  (error as { code?: unknown }).code === 'HOME_NOTIFICATION_STORE_CORRUPT')
assert.equal(notificationMutations, mutationsBeforeUnavailable, 'unavailable notification state must not mutate')
notificationInspectionStatus = 'available'

dependencyReads = 0
const deniedHandlers = createAuthorizedHomeV2QdnSettingsHandlers(() => {
  throw new Error('sender denied')
}, service)
for (const handler of [
  deniedHandlers.get,
  deniedHandlers.revoke,
  deniedHandlers.revokeBookmarks,
  deniedHandlers.setAssignment,
  deniedHandlers.setMuted,
]) {
  assert.throws(() => handler({} as never, { malformed: true }), /sender denied/)
}
assert.equal(dependencyReads, 0, 'authorization must run before parsing or storage access')

let authorized = false
const handlers = createAuthorizedHomeV2QdnSettingsHandlers(() => { authorized = true }, service)
assert.throws(() => handlers.setAssignment({} as never, { malformed: true }), /exact/)
assert.equal(authorized, true)

console.log('Home 2 QDN settings contract tests passed.')
