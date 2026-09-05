import type { IpcMainInvokeEvent } from 'electron'
import {
  listQdnAccountCapabilityGrants,
  sanitizeQdnAppAssignmentRole,
  sanitizeQdnAppAssignmentUrl,
  sanitizeQdnCapabilityPrincipal,
  sanitizeQdnGrantAccountId,
  sanitizeQdnManagerAppKey,
  type QdnAppAssignmentsStore,
} from './qdn-manager-permissions.js'
import type { QdnNotificationStore } from './notification-rules.js'

export type HomeV2QdnAssignmentState = {
  readonly assignments: QdnAppAssignmentsStore['assignments']
  readonly revision: number
  readonly version: 2
}

export type HomeV2QdnNotificationSummary = {
  readonly appKey: string
  readonly grantedAt: string
  readonly hasForeignPaymentRule: boolean
  readonly muted: boolean
  readonly ruleCount: number
}

export type HomeV2QdnBookmarkGrantSummary = {
  readonly appKey: string
  readonly grantedAt: string
}

export type HomeV2QdnNotificationState = {
  readonly apps: readonly HomeV2QdnNotificationSummary[]
  readonly revision: number | null
  readonly status: 'available' | 'corrupt' | 'unavailable'
  readonly version: 1
}

export type HomeV2QdnSettingsState = {
  // Each entry is one (app, account) pair: the durable read grant is bound to
  // the selected account it was approved under, so the same app can hold a
  // grant for one account and not another.
  readonly accountRead: Readonly<{
    apps: readonly Readonly<{ accountId: string; appKey: string; grantedAt: string }>[]
    revision: number
    version: 1
  }>
  /**
   * Apps holding the durable ENCRYPT capability, also per (app, account).
   *
   * A separate list from `accountRead` on purpose, and not folded into it:
   * reading account data and using the account KEY are different powers, and
   * a user revoking one must not be shown a card that silently governs both.
   */
  readonly accountEncrypt: Readonly<{
    apps: readonly Readonly<{ accountId: string; appKey: string; grantedAt: string }>[]
    revision: number
    version: 1
  }>
  /**
   * Apps holding the durable DECRYPT capability. A third separate list, for
   * the same reason the second one exists: reading account data, encrypting
   * with the key, and decrypting with it are three different powers, and one
   * card must never govern another.
   */
  readonly accountDecrypt: Readonly<{
    apps: readonly Readonly<{ accountId: string; appKey: string; grantedAt: string }>[]
    revision: number
    version: 1
  }>
  /**
   * Its own card, for the same reason the others have theirs: reading a
   * MAILBOX is a different power from decrypting data an app already holds.
   * (Usable on any node route since 2026-09-01; the direct reads themselves
   * are currently permissionless, so held grants are vestigial but stay
   * listed -- a grant the user cannot see is a grant they cannot revoke.)
   */
  readonly accountDirectChat: Readonly<{
    apps: readonly Readonly<{ accountId: string; appKey: string; grantedAt: string }>[]
    revision: number
    version: 1
  }>
  /**
   * Durable private-GROUP chat read grants. Stored and honored on any node
   * route since 2026-09-01, and listed because a grant the user cannot see
   * is a grant they cannot revoke.
   */
  readonly accountGroupChat: Readonly<{
    apps: readonly Readonly<{ accountId: string; appKey: string; grantedAt: string }>[]
    revision: number
    version: 1
  }>
  readonly assignments: HomeV2QdnAssignmentState
  readonly chatSend: Readonly<{
    apps: readonly Readonly<{ accountId: string; appKey: string; grantedAt: string }>[]
    revision: number
    version: 1
  }>
  readonly bookmarks: Readonly<{
    apps: readonly HomeV2QdnBookmarkGrantSummary[]
    revision: number
    version: 1
  }>
  readonly notifications: HomeV2QdnNotificationState
  /**
   * Apps holding the durable notification-MANAGER capability: authority over
   * every app's notification grants and rules. Deliberately a separate list
   * from `notifications` above, which is the per-app permission to SHOW a
   * notification — one is administrative, the other is not, and collapsing
   * them in the UI would let a user revoke the wrong thing.
   */
  readonly notificationsManage: Readonly<{
    apps: readonly Readonly<{ appKey: string; grantedAt: string }>[]
    revision: number
    version: 1
  }>
  readonly revision: 1
  readonly schema: 'home-v2-qdn-settings-state'
}

type Dependencies = {
  readonly inspectNotifications: () => HomeV2QdnNotificationInspection
  readonly readAssignments: () => QdnAppAssignmentsStore
  readonly revokeBookmarks: (
    expectedRevision: number,
    appKey: string,
    capability: HomeV2RevocableCapability,
    // Present only for account-scoped capabilities (account.read), naming the
    // account whose grant is being revoked.
    accountId: string | null,
  ) => QdnAppAssignmentsStore
  readonly revokeNotifications: (
    expectedRevision: number,
    appKey: string,
  ) => QdnNotificationStore
  readonly setAssignment: (
    expectedRevision: number,
    input: { readonly role: string; readonly url: string },
  ) => QdnAppAssignmentsStore
  readonly setMuted: (
    expectedRevision: number,
    appKey: string,
    muted: boolean,
  ) => QdnNotificationStore
}

export type HomeV2QdnNotificationInspection =
  | { readonly status: 'available'; readonly store: QdnNotificationStore }
  | { readonly status: 'corrupt' | 'unavailable'; readonly store: null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function revision(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`)
  }
  return value as number
}

function parseGet(value: unknown) {
  if (
    !exact(value, ['revision', 'schema']) ||
    value.revision !== 1 ||
    value.schema !== 'home-v2-qdn-settings-get-request'
  ) throw new Error('An exact Home 2 QDN settings request is required.')
}

function parseSetAssignment(value: unknown) {
  if (
    !exact(value, ['expectedAssignmentRevision', 'revision', 'role', 'schema', 'url']) ||
    value.revision !== 1 ||
    value.schema !== 'home-v2-qdn-settings-set-assignment-request'
  ) throw new Error('An exact Home 2 app assignment request is required.')
  return {
    expectedRevision: revision(value.expectedAssignmentRevision, 'Expected assignment revision'),
    role: sanitizeQdnAppAssignmentRole(value.role),
    url: sanitizeQdnAppAssignmentUrl(value.url),
  }
}

function parseSetMuted(value: unknown) {
  if (
    !exact(value, ['appKey', 'expectedNotificationRevision', 'muted', 'revision', 'schema']) ||
    value.revision !== 1 ||
    value.schema !== 'home-v2-qdn-settings-set-muted-request' ||
    typeof value.muted !== 'boolean'
  ) throw new Error('An exact Home 2 notification mute request is required.')
  return {
    appKey: sanitizeQdnManagerAppKey(value.appKey),
    expectedRevision: revision(value.expectedNotificationRevision, 'Expected notification revision'),
    muted: value.muted,
  }
}

function parseRevoke(value: unknown) {
  if (
    !exact(value, ['appKey', 'expectedNotificationRevision', 'revision', 'schema']) ||
    value.revision !== 1 ||
    value.schema !== 'home-v2-qdn-settings-revoke-request'
  ) throw new Error('An exact Home 2 notification revoke request is required.')
  return {
    appKey: sanitizeQdnManagerAppKey(value.appKey),
    expectedRevision: revision(value.expectedNotificationRevision, 'Expected notification revision'),
  }
}

// Capabilities a user may revoke from this settings surface. Anything not on
// this list cannot be revoked through the renderer, whatever it sends.
//
// 'account.read' is the durable read-only account grant an "always allow"
// creates (owner decision, R3-10). A durable grant that cannot be taken back
// would be a one-way door, so it is revocable from the moment it is grantable.
//
// 'notifications.manage' is the durable app-facing notification-manager grant.
// It is listed here for the same reason: Home 2 now grants it from an app
// prompt, so it must be takeable back from the moment it is grantable. Revoking
// it removes only the MANAGER's authority over other apps' notification rules —
// it does not touch any managed app's own notification grant, and it does not
// delete a single rule.
const REVOCABLE_CAPABILITIES = [
  'account.decrypt',
  'account.encrypt',
  'account.read',
  'bookmarks.manage',
  'chat.send',
  'notifications.manage',
] as const
export type HomeV2RevocableCapability = (typeof REVOCABLE_CAPABILITIES)[number]
// The subset stored per (app principal, account). Revoking one of these
// must name the account, and only that account's grant is dropped.
const ACCOUNT_SCOPED_REVOCABLE_CAPABILITIES = ['account.read', 'account.encrypt', 'account.decrypt', 'chat.send'] as const
export type HomeV2AccountScopedRevocableCapability =
  (typeof ACCOUNT_SCOPED_REVOCABLE_CAPABILITIES)[number]

function parseRevokeBookmarks(value: unknown) {
  // Three accepted shapes, narrowest first: an account-scoped revoke naming
  // the account, a capability revoke, and the original bookmarks-only request.
  const withAccount = exact(value, [
    'accountId',
    'appKey',
    'capability',
    'expectedAssignmentRevision',
    'revision',
    'schema',
  ])
  const withCapability = exact(value, [
    'appKey',
    'capability',
    'expectedAssignmentRevision',
    'revision',
    'schema',
  ])
  if (
    (!withAccount && !withCapability &&
      !exact(value, ['appKey', 'expectedAssignmentRevision', 'revision', 'schema'])) ||
    value.revision !== 1 ||
    value.schema !== 'home-v2-qdn-settings-revoke-bookmarks-request'
  ) throw new Error('An exact Home 2 bookmark permission revoke request is required.')
  // Omitted capability keeps the original bookmarks-only meaning, so older
  // callers are unaffected.
  const capability = (withAccount || withCapability) ? value.capability : 'bookmarks.manage'
  if (!REVOCABLE_CAPABILITIES.includes(capability as HomeV2RevocableCapability)) {
    throw new Error('That capability cannot be revoked from Home settings.')
  }
  const accountScoped = ACCOUNT_SCOPED_REVOCABLE_CAPABILITIES
    .includes(capability as HomeV2AccountScopedRevocableCapability)
  // An account-scoped grant is stored per account, so a revoke that does not
  // name one cannot identify a grant. Refuse rather than guess.
  if (accountScoped && !withAccount) {
    throw new Error('Revoking account-scoped access requires the account it was granted for.')
  }
  if (!accountScoped && withAccount) {
    throw new Error('That capability is not granted per account.')
  }
  return {
    accountId: accountScoped ? sanitizeQdnGrantAccountId(value.accountId) : null,
    // Account-scoped grants are keyed by the canonical resource principal,
    // which resolves `?identifier=`; app-scoped ones keep their legacy key.
    appKey: accountScoped
      ? sanitizeQdnCapabilityPrincipal(value.appKey)
      : sanitizeQdnManagerAppKey(value.appKey),
    capability: capability as HomeV2RevocableCapability,
    expectedRevision: revision(value.expectedAssignmentRevision, 'Expected assignment revision'),
  }
}

export function redactHomeV2QdnSettingsState(
  assignmentsStore: QdnAppAssignmentsStore,
  notificationInspection: HomeV2QdnNotificationInspection,
): HomeV2QdnSettingsState {
  const assignments = Object.fromEntries(
    Object.entries(assignmentsStore.assignments).map(([role, assignment]) => [role, { ...assignment }]),
  )
  const notificationStore = notificationInspection.store
  const grantsFor = (capability: HomeV2RevocableCapability) =>
    Object.entries(assignmentsStore.capabilityGrants)
      .flatMap(([appKey, capabilities]) => capabilities[capability]
        ? [{ appKey, grantedAt: capabilities[capability].grantedAt }]
        : [])
      .sort((left, right) => left.appKey.localeCompare(right.appKey))
  const accountReadApps = listQdnAccountCapabilityGrants(assignmentsStore, 'account.read')
  const accountEncryptApps = listQdnAccountCapabilityGrants(assignmentsStore, 'account.encrypt')
  const accountDecryptApps = listQdnAccountCapabilityGrants(assignmentsStore, 'account.decrypt')
  const accountDirectChatApps = listQdnAccountCapabilityGrants(assignmentsStore, 'account.directChat')
  const accountGroupChatApps = listQdnAccountCapabilityGrants(assignmentsStore, 'account.groupChat')
  const bookmarkApps = grantsFor('bookmarks.manage')
  const chatSendApps = listQdnAccountCapabilityGrants(assignmentsStore, 'chat.send')
  const notificationManagerApps = grantsFor('notifications.manage')
  const apps = notificationStore ? Object.entries(notificationStore.grants)
    .map(([appKey, grant]) => {
      const rules = notificationStore.rules[appKey] ?? []
      return {
        appKey,
        grantedAt: grant.grantedAt,
        hasForeignPaymentRule: rules.some((rule) => rule.event === 'FOREIGN_PAYMENT_RECEIVED'),
        muted: grant.muted === true,
        ruleCount: rules.length,
      }
    })
    .sort((left, right) => left.appKey.localeCompare(right.appKey)) : []
  return {
    accountDecrypt: {
      apps: accountDecryptApps,
      revision: assignmentsStore.revision,
      version: 1,
    },
    accountDirectChat: {
      apps: accountDirectChatApps,
      revision: assignmentsStore.revision,
      version: 1,
    },
    accountGroupChat: {
      apps: accountGroupChatApps,
      revision: assignmentsStore.revision,
      version: 1,
    },
    accountEncrypt: {
      apps: accountEncryptApps,
      revision: assignmentsStore.revision,
      version: 1,
    },
    accountRead: {
      apps: accountReadApps,
      revision: assignmentsStore.revision,
      version: 1,
    },
    assignments: {
      assignments,
      revision: assignmentsStore.revision,
      version: 2,
    },
    chatSend: {
      apps: chatSendApps,
      revision: assignmentsStore.revision,
      version: 1,
    },
    bookmarks: {
      apps: bookmarkApps,
      revision: assignmentsStore.revision,
      version: 1,
    },
    notifications: {
      apps,
      revision: notificationStore?.revision ?? null,
      status: notificationInspection.status,
      version: 1,
    },
    notificationsManage: {
      apps: notificationManagerApps,
      revision: assignmentsStore.revision,
      version: 1,
    },
    revision: 1,
    schema: 'home-v2-qdn-settings-state',
  }
}

export function createHomeV2QdnSettingsService(dependencies: Dependencies) {
  const state = () => redactHomeV2QdnSettingsState(
    dependencies.readAssignments(),
    dependencies.inspectNotifications(),
  )
  const requireAvailableNotifications = () => {
    const inspection = dependencies.inspectNotifications()
    if (inspection.status !== 'available') {
      throw Object.assign(new Error('QDN notification settings are unavailable.'), {
        code: inspection.status === 'corrupt'
          ? 'HOME_NOTIFICATION_STORE_CORRUPT'
          : 'HOME_NOTIFICATION_STORE_UNAVAILABLE',
      })
    }
  }
  return {
    get(value: unknown) {
      parseGet(value)
      return state()
    },
    revoke(value: unknown) {
      const request = parseRevoke(value)
      requireAvailableNotifications()
      dependencies.revokeNotifications(request.expectedRevision, request.appKey)
      return state()
    },
    revokeBookmarks(value: unknown) {
      const request = parseRevokeBookmarks(value)
      dependencies.revokeBookmarks(
        request.expectedRevision,
        request.appKey,
        request.capability,
        request.accountId,
      )
      return state()
    },
    setAssignment(value: unknown) {
      const request = parseSetAssignment(value)
      const current = dependencies.readAssignments()
      if (!Object.prototype.hasOwnProperty.call(current.assignments, request.role)) {
        throw new Error('Home 2 can only update a persisted app assignment.')
      }
      dependencies.setAssignment(request.expectedRevision, {
        role: request.role,
        url: request.url,
      })
      return state()
    },
    setMuted(value: unknown) {
      const request = parseSetMuted(value)
      requireAvailableNotifications()
      dependencies.setMuted(request.expectedRevision, request.appKey, request.muted)
      return state()
    },
  }
}

export function createAuthorizedHomeV2QdnSettingsHandlers(
  assertAuthorized: (event: IpcMainInvokeEvent) => void,
  service: ReturnType<typeof createHomeV2QdnSettingsService>,
) {
  return {
    get(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.get(value)
    },
    revoke(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.revoke(value)
    },
    revokeBookmarks(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.revokeBookmarks(value)
    },
    setAssignment(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.setAssignment(value)
    },
    setMuted(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.setMuted(value)
    },
  }
}
