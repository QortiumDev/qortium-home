import type { IpcMainInvokeEvent } from 'electron'
import {
  sanitizeQdnAppAssignmentRole,
  sanitizeQdnAppAssignmentUrl,
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
  readonly accountRead: Readonly<{
    apps: readonly Readonly<{ appKey: string; grantedAt: string }>[]
    revision: number
    version: 1
  }>
  readonly assignments: HomeV2QdnAssignmentState
  readonly chatSend: Readonly<{
    apps: readonly Readonly<{ appKey: string; grantedAt: string }>[]
    revision: number
    version: 1
  }>
  readonly bookmarks: Readonly<{
    apps: readonly HomeV2QdnBookmarkGrantSummary[]
    revision: number
    version: 1
  }>
  readonly notifications: HomeV2QdnNotificationState
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
const REVOCABLE_CAPABILITIES = ['account.read', 'bookmarks.manage', 'chat.send'] as const
export type HomeV2RevocableCapability = (typeof REVOCABLE_CAPABILITIES)[number]

function parseRevokeBookmarks(value: unknown) {
  const withCapability = exact(value, [
    'appKey',
    'capability',
    'expectedAssignmentRevision',
    'revision',
    'schema',
  ])
  if (
    (!withCapability &&
      !exact(value, ['appKey', 'expectedAssignmentRevision', 'revision', 'schema'])) ||
    value.revision !== 1 ||
    value.schema !== 'home-v2-qdn-settings-revoke-bookmarks-request'
  ) throw new Error('An exact Home 2 bookmark permission revoke request is required.')
  // Omitted capability keeps the original bookmarks-only meaning, so older
  // callers are unaffected.
  const capability = withCapability ? value.capability : 'bookmarks.manage'
  if (!REVOCABLE_CAPABILITIES.includes(capability as HomeV2RevocableCapability)) {
    throw new Error('That capability cannot be revoked from Home settings.')
  }
  return {
    appKey: sanitizeQdnManagerAppKey(value.appKey),
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
  const accountReadApps = grantsFor('account.read')
  const bookmarkApps = grantsFor('bookmarks.manage')
  const chatSendApps = grantsFor('chat.send')
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
      dependencies.revokeBookmarks(request.expectedRevision, request.appKey, request.capability)
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
