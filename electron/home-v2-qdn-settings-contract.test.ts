import assert from 'node:assert/strict'
import {
  createDefaultQdnAppRolesStore,
  grantQdnAccountCapability,
  grantQdnAppCapability,
  revokeQdnAccountCapability,
  revokeQdnAppCapability,
  setQdnAppAssignment,
  type QdnAppAssignmentsStore,
} from './qdn-manager-permissions.js'
import {
  createAuthorizedHomeV2QdnSettingsHandlers,
  createHomeV2QdnSettingsService,
} from './home-v2-qdn-settings-contract.js'
import type { QdnNotificationStore } from './notification-rules.js'

const READ_ACCOUNT_A = 'wallet:QAAA'
const READ_ACCOUNT_B = 'wallet:QBBB'
let assignments = grantQdnAccountCapability(
  grantQdnAccountCapability(
    grantQdnAppCapability(
      grantQdnAppCapability(
        grantQdnAppCapability(
          createDefaultQdnAppRolesStore(),
          'qdn://APP/Bookmarks/Bookmarks',
          'bookmarks.manage',
        ),
        'qdn://APP/Notify/Notify',
        'notifications.manage',
      ),
      'qdn://APP/Reader/Reader',
      'assignments.read',
    ),
    'qdn://APP/Chat/Chat',
    READ_ACCOUNT_A,
    'account.read',
  ),
  'qdn://APP/Chat/Chat',
  READ_ACCOUNT_B,
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
  revokeBookmarks(expectedRevision, appKey, capability, accountId) {
    assert.equal(expectedRevision, assignments.revision, 'bookmark permission CAS must reject stale callers')
    // The service must forward the capability the user actually asked to
    // revoke; ignoring it here would let a read-grant revoke silently drop
    // the bookmarks grant instead. An account-scoped capability must also
    // arrive with the account it belongs to.
    if (accountId !== null) {
      // Whichever account-scoped capability was requested — NOT a hardcoded
      // one. The real bridge passed the literal 'account.read' here, which
      // was invisible while that was the only account-scoped capability and
      // silently revoked the wrong grant once there were two.
      assert.ok(
        capability === 'account.read' || capability === 'account.encrypt' ||
          capability === 'account.decrypt' || capability === 'chat.send',
        'an account-scoped revoke must name an account-scoped capability',
      )
      assignments = revokeQdnAccountCapability(assignments, appKey, accountId, capability)
      return assignments
    }
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

// The durable notification-MANAGER grant is listed separately from the per-app
// permission to SHOW a notification: one is authority over every other app's
// rules, the other is not, and a user must be able to revoke them separately.
assert.deepEqual(initial.notificationsManage.apps.map(({ appKey }) => appKey), [
  'qdn://APP/Notify/Notify',
])
assert.equal(initial.notificationsManage.revision, assignments.revision)

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
// The dashboard "Apps" button reads a real, persisted, user-editable role.
assert.equal(initial.assignments.assignments.apps.url, 'qdn://APP/Apps/Apps')
const appsAssigned = service.setAssignment({
  expectedAssignmentRevision: assignments.revision,
  revision: 1,
  role: 'apps',
  schema: 'home-v2-qdn-settings-set-assignment-request',
  url: 'qdn://APP/OtherApps/OtherApps',
})
assert.equal(appsAssigned.assignments.assignments.apps.url, 'qdn://APP/OtherApps/OtherApps')
assert.equal(appsAssigned.assignments.assignments.apps.label, 'Apps')
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
// be a one-way door. Each entry names the account it is bound to, and one app
// legitimately appears once per account.
const listedReadGrants = service.get({
  revision: 1,
  schema: 'home-v2-qdn-settings-get-request',
}).accountRead.apps
assert.deepEqual(
  listedReadGrants.map(({ accountId, appKey }) => ({ accountId, appKey })),
  [
    { accountId: READ_ACCOUNT_A, appKey: 'qdn://APP/Chat/Chat' },
    { accountId: READ_ACCOUNT_B, appKey: 'qdn://APP/Chat/Chat' },
  ],
)
for (const grant of listedReadGrants) {
  assert.ok(Number.isFinite(Date.parse(grant.grantedAt)))
}

// A revoke that does not name an account cannot identify an account-scoped
// grant, so it is refused rather than guessing which one to drop.
assert.throws(() => service.revokeBookmarks({
  appKey: 'qdn://APP/Chat/Chat',
  capability: 'account.read',
  expectedAssignmentRevision: assignments.revision,
  revision: 1,
  schema: 'home-v2-qdn-settings-revoke-bookmarks-request',
}), /requires the account/)
// And an account may not be attached to a capability that is not account-scoped.
assert.throws(() => service.revokeBookmarks({
  accountId: READ_ACCOUNT_A,
  appKey: 'qdn://APP/Bookmarks/Bookmarks',
  capability: 'bookmarks.manage',
  expectedAssignmentRevision: assignments.revision,
  revision: 1,
  schema: 'home-v2-qdn-settings-revoke-bookmarks-request',
}), /not granted per account/)

const accountReadRevoked = service.revokeBookmarks({
  accountId: READ_ACCOUNT_A,
  appKey: 'qdn://APP/Chat/Chat',
  capability: 'account.read',
  expectedAssignmentRevision: assignments.revision,
  revision: 1,
  schema: 'home-v2-qdn-settings-revoke-bookmarks-request',
})
// Only the named account's grant is dropped; the other account keeps its own.
assert.deepEqual(
  accountReadRevoked.accountRead.apps.map(({ accountId }) => accountId),
  [READ_ACCOUNT_B],
)
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

// Revoking the notification-MANAGER capability takes back one app's authority
// over every other app's rules. It must not touch that app's own permission to
// show a notification, nor delete a single rule.
{
  const notificationsBefore = JSON.stringify(notifications)
  const managerRevoked = service.revokeBookmarks({
    appKey: 'qdn://APP/Notify/Notify#/apps',
    capability: 'notifications.manage',
    expectedAssignmentRevision: assignments.revision,
    revision: 1,
    schema: 'home-v2-qdn-settings-revoke-bookmarks-request',
  })
  assert.deepEqual(managerRevoked.notificationsManage.apps, [])
  assert.equal(JSON.stringify(notifications), notificationsBefore, 'no rule or grant may be deleted')
  assert.deepEqual(managerRevoked.notifications.apps.map(({ appKey }) => appKey), [
    'qdn://APP/Notify/Notify',
  ])
  // Re-granting it restores the row, so the fixture below is unaffected.
  assignments = grantQdnAppCapability(assignments, 'qdn://APP/Notify/Notify', 'notifications.manage')
}

// A Qortal-routed app can hold and revoke a durable read grant. The capability
// store used to reject the whole qortal:// scheme, which made granting throw.
{
  const qortalApp = 'qortal://APP/Chat/Chat'
  assignments = grantQdnAccountCapability(assignments, qortalApp, READ_ACCOUNT_B, 'account.read')
  assert.ok(service.get({
    revision: 1,
    schema: 'home-v2-qdn-settings-get-request',
  }).accountRead.apps.some(({ appKey }) => appKey === qortalApp))
  const qortalRevoked = service.revokeBookmarks({
    accountId: READ_ACCOUNT_B,
    appKey: qortalApp,
    capability: 'account.read',
    expectedAssignmentRevision: assignments.revision,
    revision: 1,
    schema: 'home-v2-qdn-settings-revoke-bookmarks-request',
  })
  assert.equal(qortalRevoked.accountRead.apps.some(({ appKey }) => appKey === qortalApp), false)
  // The same-named qdn:// resource is a different principal and is untouched.
  assert.ok(qortalRevoked.accountRead.apps.some(({ appKey }) => appKey === 'qdn://APP/Chat/Chat'))
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

// --- account.encrypt is revocable, account-scoped, and independent --------
{
  const app = 'qdn://APP/Chat/Chat'
  assignments = grantQdnAccountCapability(assignments, app, READ_ACCOUNT_A, 'account.encrypt')
  assignments = grantQdnAccountCapability(assignments, app, READ_ACCOUNT_A, 'account.read')

  // Account-scoped: a revoke that does not name the account is refused rather
  // than guessing which one to drop.
  assert.throws(() => service.revokeBookmarks({
    appKey: app,
    capability: 'account.encrypt',
    expectedAssignmentRevision: assignments.revision,
    revision: 1,
    schema: 'home-v2-qdn-settings-revoke-bookmarks-request',
  }), /requires the account/)

  const afterEncryptRevoke = service.revokeBookmarks({
    accountId: READ_ACCOUNT_A,
    appKey: app,
    capability: 'account.encrypt',
    expectedAssignmentRevision: assignments.revision,
    revision: 1,
    schema: 'home-v2-qdn-settings-revoke-bookmarks-request',
  })
  assert.equal(
    afterEncryptRevoke.accountEncrypt.apps.some(({ accountId }) => accountId === READ_ACCOUNT_A),
    false,
    'the encryption grant is dropped',
  )
  // The whole point: revoking the KEY grant must leave the READ grant alone.
  assert.equal(
    afterEncryptRevoke.accountRead.apps.some(({ accountId }) => accountId === READ_ACCOUNT_A),
    true,
    'revoking account.encrypt must not drop account.read',
  )
}

// account.decrypt is revocable and independent of the other two.
{
  const app = 'qdn://APP/Chat/Chat'
  assignments = grantQdnAccountCapability(assignments, app, READ_ACCOUNT_A, 'account.decrypt')
  assignments = grantQdnAccountCapability(assignments, app, READ_ACCOUNT_A, 'account.encrypt')
  const after = service.revokeBookmarks({
    accountId: READ_ACCOUNT_A,
    appKey: app,
    capability: 'account.decrypt',
    expectedAssignmentRevision: assignments.revision,
    revision: 1,
    schema: 'home-v2-qdn-settings-revoke-bookmarks-request',
  })
  assert.equal(
    after.accountDecrypt.apps.some(({ accountId }) => accountId === READ_ACCOUNT_A),
    false,
    'the decryption grant is dropped',
  )
  assert.equal(
    after.accountEncrypt.apps.some(({ accountId }) => accountId === READ_ACCOUNT_A),
    true,
    'revoking account.decrypt must not drop account.encrypt',
  )
}

// A revoke must identify precisely one app/account grant on either protocol.
for (const scheme of ['qdn', 'qortal']) {
  const app = `${scheme}://APP/Chat/Chat`
  assignments = grantQdnAccountCapability(assignments, app, READ_ACCOUNT_A, 'chat.send')
  assignments = grantQdnAccountCapability(assignments, app, READ_ACCOUNT_B, 'chat.send')
  const request = {
    appKey: app,
    capability: 'chat.send',
    expectedAssignmentRevision: assignments.revision,
    revision: 1,
    schema: 'home-v2-qdn-settings-revoke-bookmarks-request',
  }
  assert.throws(() => service.revokeBookmarks(request), /account/i)
  const after = service.revokeBookmarks({ ...request, accountId: READ_ACCOUNT_A })
  assert.deepEqual(after.chatSend.apps.filter(({ appKey }) => appKey === app)
    .map(({ accountId }) => accountId), [READ_ACCOUNT_B])
}

console.log('Home 2 QDN settings contract tests passed.')
