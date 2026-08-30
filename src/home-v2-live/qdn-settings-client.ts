export type HomeV2QdnAssignment = Readonly<{
  description: string | null
  label: string
  url: string | null
}>

export type HomeV2QdnNotificationGrant = Readonly<{
  appKey: string
  grantedAt: string
  hasForeignPaymentRule: boolean
  muted: boolean
  ruleCount: number
}>

export type HomeV2QdnBookmarkGrant = Readonly<{
  appKey: string
  grantedAt: string
}>

/**
 * One durable grant that is bound to a selected account as well as an app.
 * The same app may appear more than once, once per account it was granted for.
 */
export type HomeV2QdnAccountGrant = Readonly<{
  accountId: string
  appKey: string
  grantedAt: string
}>

export type HomeV2QdnSettingsState = Readonly<{
  /**
   * Apps granted the durable read-only account family ("always allow"). One
   * grant per app covers every HOME_V2_ACCOUNT_READ_ACTIONS member on both
   * chains, so this is the list a user revokes from to start being asked
   * about private group chats and chat attachments again.
   */
  accountRead: Readonly<{
    apps: readonly HomeV2QdnAccountGrant[]
    revision: number
    version: 1
  }>
  /**
   * Apps granted the durable ENCRYPT capability ("always allow"), also per
   * (app, account). Separate from accountRead: reading account data and using
   * the account key are different powers with different cards.
   */
  accountEncrypt: Readonly<{
    apps: readonly HomeV2QdnAccountGrant[]
    revision: number
    version: 1
  }>
  /** Apps granted the durable DECRYPT capability, per (app, account). */
  accountDecrypt: Readonly<{
    apps: readonly HomeV2QdnAccountGrant[]
    revision: number
    version: 1
  }>
  /**
   * Apps granted the durable DIRECT MESSAGE read capability, per (app,
   * account). Usable only on a trusted local node; listed here regardless so a
   * suspended grant is still visible and revocable.
   */
  accountDirectChat: Readonly<{
    apps: readonly HomeV2QdnAccountGrant[]
    revision: number
    version: 1
  }>
  /**
   * Durable private-GROUP chat read grants, on the same terms as
   * accountDirectChat: usable only on a trusted local node, and listed here
   * regardless so a suspended grant stays visible and revocable.
   */
  accountGroupChat: Readonly<{
    apps: readonly HomeV2QdnAccountGrant[]
    revision: number
    version: 1
  }>
  assignments: Readonly<{
    assignments: Readonly<Record<string, HomeV2QdnAssignment>>
    revision: number
    version: 2
  }>
  bookmarks: Readonly<{
    apps: readonly HomeV2QdnBookmarkGrant[]
    revision: number
    version: 1
  }>
  /** Apps granted persistent permission to send chat ("always allow"). */
  chatSend: Readonly<{
    apps: readonly HomeV2QdnBookmarkGrant[]
    revision: number
    version: 1
  }>
  notifications: Readonly<{
    apps: readonly HomeV2QdnNotificationGrant[]
    revision: number | null
    status: 'available' | 'corrupt' | 'unavailable'
    version: 1
  }>
  /**
   * Apps granted the durable notification-MANAGER capability ("always allow"):
   * authority over every app's notification grants and rules. Not the same list
   * as `notifications` above, which is the per-app permission to show one.
   */
  notificationsManage: Readonly<{
    apps: readonly HomeV2QdnBookmarkGrant[]
    revision: number
    version: 1
  }>
  revision: 1
  schema: 'home-v2-qdn-settings-state'
}>

export type HomeV2QdnAssignmentRow = HomeV2QdnAssignment & Readonly<{
  defaultUrl: string | null
  role: string
}>

export type HomeV2QdnAssignmentRequest = Readonly<{
  expectedAssignmentRevision: number
  role: string
  url: string
}>

export type HomeV2QdnNotificationMuteRequest = Readonly<{
  appKey: string
  expectedNotificationRevision: number
  muted: boolean
}>

export type HomeV2QdnNotificationRevokeRequest = Readonly<{
  appKey: string
  expectedNotificationRevision: number
}>

/**
 * Revokes one durable app capability. The name is historical — it started as
 * bookmarks-only — and an omitted `capability` still means 'bookmarks.manage'
 * so existing callers are unchanged. The main process re-validates the value
 * against its own revocable allowlist; nothing here is trusted.
 */
export type HomeV2QdnBookmarkRevokeRequest = Readonly<{
  // Required for account-scoped capabilities (account.read) and rejected for
  // the others: those grants are stored per account, so a revoke that does not
  // name one cannot identify a grant.
  accountId?: string
  appKey: string
  capability?: 'account.decrypt' | 'account.directChat' | 'account.encrypt' | 'account.groupChat' | 'account.read' | 'bookmarks.manage' | 'chat.send' | 'notifications.manage'
  expectedAssignmentRevision: number
}>

export interface HomeV2QdnSettingsAdapter {
  get(): Promise<unknown>
  revoke(request: HomeV2QdnNotificationRevokeRequest): Promise<unknown>
  revokeBookmarks(request: HomeV2QdnBookmarkRevokeRequest): Promise<unknown>
  setAssignment(request: HomeV2QdnAssignmentRequest): Promise<unknown>
  setMuted(request: HomeV2QdnNotificationMuteRequest): Promise<unknown>
  subscribe?(listener: () => void): () => void
}

export interface HomeV2QdnSettingsClient {
  get(): Promise<HomeV2QdnSettingsState>
  revoke(request: HomeV2QdnNotificationRevokeRequest): Promise<HomeV2QdnSettingsState>
  revokeBookmarks(request: HomeV2QdnBookmarkRevokeRequest): Promise<HomeV2QdnSettingsState>
  setAssignment(request: HomeV2QdnAssignmentRequest): Promise<HomeV2QdnSettingsState>
  setMuted(request: HomeV2QdnNotificationMuteRequest): Promise<HomeV2QdnSettingsState>
  subscribe(listener: () => void): () => void
}

export interface HomeV2QdnSettingsManagement {
  readonly available: boolean
  readonly client?: HomeV2QdnSettingsClient
}

const defaultAssignments = {
  bookmarks: {
    description: 'App used when Home opens bookmarks.',
    label: 'Bookmarks',
    url: 'qdn://APP/Bookmarks/Bookmarks',
  },
  notifications: {
    description: 'App used to manage Home notifications.',
    label: 'Notifications',
    url: 'qdn://APP/Notify/Notify',
  },
  explore: {
    description: 'App used when Home opens QDN Explore.',
    label: 'Explore',
    url: 'qdn://APP/Explore/Explore',
  },
  // Mirrors QDN_DEFAULT_APP_ASSIGNMENTS in electron/qdn-manager-permissions.ts;
  // parsing HARD-FAILS on a state missing a role known here, so the two copies
  // must change together. Key order here drives the Settings row order.
  // Both segments are deliberate: the published resource is name "Apps" with
  // identifier "Apps", and a bare `qdn://APP/Apps` would normalize to the
  // identifier `default`, which is not published.
  apps: {
    description: 'App used when Home opens the app directory.',
    label: 'Apps',
    url: 'qdn://APP/Apps/Apps',
  },
} as const

const defaultRoleOrder = new Map(
  Object.keys(defaultAssignments).map((role, index) => [role, index]),
)
const qdnTargetPattern = /^qdn:\/\/(APP|WEBSITE)\/([^/?#]+)(?:\/([^/?#]+))?((?:\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?)$/i
const rolePattern = /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
}

function safeGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value)
}

export function normalizeHomeV2QdnAssignmentUrl(value: string) {
  const url = value.trim()
  const match = qdnTargetPattern.exec(url)
  if (
    !url ||
    url.length > 2_048 ||
    /[\u0000-\u001f\u007f\s]/.test(url) ||
    !match
  ) throw new Error('Invalid QDN assignment URL.')
  return `qdn://${match[1].toUpperCase()}/${match[2]}${
    match[3] ? `/${match[3]}` : ''
  }${match[4]}`
}

function parseAssignment(value: unknown, role: string): HomeV2QdnAssignment {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['description', 'label', 'url']) ||
    !boundedText(value.label, 80) ||
    !(value.description === null || boundedText(value.description, 280))
  ) throw new Error(`Home 2 QDN assignment ${role} was malformed.`)
  return Object.freeze({
    description: value.description as string | null,
    label: value.label,
    url: value.url === null
      ? null
      : normalizeHomeV2QdnAssignmentUrl(String(value.url)),
  })
}

function parseAssignments(value: unknown) {
  if (!isRecord(value) || Object.keys(value).length > 100) {
    throw new Error('Home 2 QDN assignments were malformed.')
  }
  const assignments: Record<string, HomeV2QdnAssignment> = {}
  for (const [role, assignment] of Object.entries(value)) {
    if (
      role.length > 120 ||
      !rolePattern.test(role) ||
      unsafeKeys.has(role)
    ) throw new Error('Home 2 QDN assignment role was malformed.')
    assignments[role] = parseAssignment(assignment, role)
  }
  return Object.freeze(assignments)
}

function parseGrant(value: unknown): HomeV2QdnNotificationGrant {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'appKey',
      'grantedAt',
      'hasForeignPaymentRule',
      'muted',
      'ruleCount',
    ]) ||
    !boundedText(value.appKey, 2_048) ||
    !/^qdn:\/\/(?:APP|WEBSITE)\/[^/?#]+(?:\/[^/?#]+)?$/i.test(value.appKey) ||
    !boundedText(value.grantedAt, 100) ||
    !Number.isFinite(Date.parse(value.grantedAt)) ||
    typeof value.muted !== 'boolean' ||
    !Number.isSafeInteger(value.ruleCount) ||
    (value.ruleCount as number) < 0 ||
    (value.ruleCount as number) > 20 ||
    typeof value.hasForeignPaymentRule !== 'boolean'
  ) throw new Error('Home 2 QDN notification grant was malformed.')
  return Object.freeze({
    appKey: value.appKey,
    grantedAt: value.grantedAt,
    hasForeignPaymentRule: value.hasForeignPaymentRule,
    muted: value.muted,
    ruleCount: value.ruleCount as number,
  })
}

function parseBookmarkGrant(value: unknown): HomeV2QdnBookmarkGrant {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['appKey', 'grantedAt']) ||
    !boundedText(value.appKey, 2_048) ||
    !/^qdn:\/\/(?:APP|WEBSITE)\/[^/?#]+(?:\/[^/?#]+)?$/i.test(value.appKey) ||
    !boundedText(value.grantedAt, 100) ||
    !Number.isFinite(Date.parse(value.grantedAt))
  ) throw new Error('Home 2 QDN bookmark grant was malformed.')
  return Object.freeze({ appKey: value.appKey, grantedAt: value.grantedAt })
}

function parseAccountGrant(value: unknown): HomeV2QdnAccountGrant {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['accountId', 'appKey', 'grantedAt']) ||
    !boundedText(value.accountId, 240) ||
    !boundedText(value.appKey, 2_048) ||
    // Both schemes, unlike the app-scoped grant above: a Qortal-routed app is
    // a legitimate holder of a durable read grant. The identifier segment is
    // the canonical one the main process already resolved, so no query string
    // or route path is permitted here.
    !/^(?:qdn|qortal):\/\/(?:APP|WEBSITE)\/[^/?#]+(?:\/[^/?#]+)?$/i.test(value.appKey) ||
    !boundedText(value.grantedAt, 100) ||
    !Number.isFinite(Date.parse(value.grantedAt))
  ) throw new Error('Home 2 QDN account grant was malformed.')
  return Object.freeze({
    accountId: value.accountId,
    appKey: value.appKey,
    grantedAt: value.grantedAt,
  })
}

export function parseHomeV2QdnSettingsState(
  value: unknown,
): HomeV2QdnSettingsState {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['accountDecrypt', 'accountDirectChat', 'accountEncrypt', 'accountGroupChat', 'accountRead', 'assignments', 'bookmarks', 'chatSend', 'notifications', 'notificationsManage', 'revision', 'schema']) ||
    value.schema !== 'home-v2-qdn-settings-state' ||
    value.revision !== 1 ||
    !isRecord(value.assignments) ||
    !hasExactKeys(value.assignments, ['assignments', 'revision', 'version']) ||
    value.assignments.version !== 2 ||
    !safeGeneration(value.assignments.revision) ||
    !isRecord(value.bookmarks) ||
    !hasExactKeys(value.bookmarks, ['apps', 'revision', 'version']) ||
    value.bookmarks.version !== 1 ||
    !safeGeneration(value.bookmarks.revision) ||
    !Array.isArray(value.bookmarks.apps) ||
    !isRecord(value.chatSend) ||
    !hasExactKeys(value.chatSend, ['apps', 'revision', 'version']) ||
    value.chatSend.version !== 1 ||
    !safeGeneration(value.chatSend.revision) ||
    !Array.isArray(value.chatSend.apps) ||
    !isRecord(value.notificationsManage) ||
    !hasExactKeys(value.notificationsManage, ['apps', 'revision', 'version']) ||
    value.notificationsManage.version !== 1 ||
    !safeGeneration(value.notificationsManage.revision) ||
    !Array.isArray(value.notificationsManage.apps) ||
    value.notificationsManage.apps.length > 100 ||
    !isRecord(value.accountRead) ||
    !hasExactKeys(value.accountRead, ['apps', 'revision', 'version']) ||
    value.accountRead.version !== 1 ||
    !safeGeneration(value.accountRead.revision) ||
    !Array.isArray(value.accountRead.apps) ||
    value.accountRead.apps.length > 100 ||
    !isRecord(value.accountEncrypt) ||
    !hasExactKeys(value.accountEncrypt, ['apps', 'revision', 'version']) ||
    value.accountEncrypt.version !== 1 ||
    !safeGeneration(value.accountEncrypt.revision) ||
    !Array.isArray(value.accountEncrypt.apps) ||
    value.accountEncrypt.apps.length > 100 ||
    !isRecord(value.accountDecrypt) ||
    !hasExactKeys(value.accountDecrypt, ['apps', 'revision', 'version']) ||
    value.accountDecrypt.version !== 1 ||
    !safeGeneration(value.accountDecrypt.revision) ||
    !Array.isArray(value.accountDecrypt.apps) ||
    value.accountDecrypt.apps.length > 100 ||
    !isRecord(value.accountDirectChat) ||
    !hasExactKeys(value.accountDirectChat, ['apps', 'revision', 'version']) ||
    value.accountDirectChat.version !== 1 ||
    !safeGeneration(value.accountDirectChat.revision) ||
    !Array.isArray(value.accountDirectChat.apps) ||
    value.accountDirectChat.apps.length > 100 ||
    !isRecord(value.accountGroupChat) ||
    !hasExactKeys(value.accountGroupChat, ['apps', 'revision', 'version']) ||
    value.accountGroupChat.version !== 1 ||
    !safeGeneration(value.accountGroupChat.revision) ||
    !Array.isArray(value.accountGroupChat.apps) ||
    value.accountGroupChat.apps.length > 100 ||
    value.bookmarks.apps.length > 100 ||
    !isRecord(value.notifications) ||
    !hasExactKeys(value.notifications, ['apps', 'revision', 'status', 'version']) ||
    value.notifications.version !== 1 ||
    !['available', 'corrupt', 'unavailable'].includes(String(value.notifications.status)) ||
    !(value.notifications.revision === null || safeGeneration(value.notifications.revision)) ||
    !Array.isArray(value.notifications.apps) ||
    value.notifications.apps.length > 100
  ) throw new Error('Home 2 QDN settings state was malformed.')

  const assignments = parseAssignments(value.assignments.assignments)
  if (!Object.keys(defaultAssignments).every((role) => Object.hasOwn(assignments, role))) {
    throw new Error('Home 2 QDN settings omitted a default app assignment.')
  }
  if (value.bookmarks.revision !== value.assignments.revision) {
    throw new Error('Home 2 QDN bookmark settings revision was inconsistent.')
  }
  const apps = value.notifications.apps.map(parseGrant)
  const bookmarkApps = value.bookmarks.apps.map(parseBookmarkGrant)
  const chatSendApps = value.chatSend.apps.map(parseBookmarkGrant)
  const notificationManagerApps = value.notificationsManage.apps.map(parseBookmarkGrant)
  const accountReadApps = value.accountRead.apps.map(parseAccountGrant)
  const accountEncryptApps = value.accountEncrypt.apps.map(parseAccountGrant)
  const accountDecryptApps = value.accountDecrypt.apps.map(parseAccountGrant)
  const accountDirectChatApps = value.accountDirectChat.apps.map(parseAccountGrant)
  const accountGroupChatApps = value.accountGroupChat.apps.map(parseAccountGrant)
  if (new Set(chatSendApps.map(({ appKey }) => appKey)).size !== chatSendApps.length) {
    throw new Error('Home 2 QDN settings contained duplicate chat-send grants.')
  }
  if (new Set(notificationManagerApps.map(({ appKey }) => appKey)).size !== notificationManagerApps.length) {
    throw new Error('Home 2 QDN settings contained duplicate notification manager grants.')
  }
  // The identity of an account-scoped grant is the (app, account) PAIR: one
  // app legitimately appears once per account it holds a grant for.
  const accountReadKeys = accountReadApps.map(({ accountId, appKey }) => `${appKey}\n${accountId}`)
  if (new Set(accountReadKeys).size !== accountReadApps.length) {
    throw new Error('Home 2 QDN settings contained duplicate account-read grants.')
  }
  const accountEncryptKeys = accountEncryptApps.map(({ accountId, appKey }) => `${appKey}\n${accountId}`)
  if (new Set(accountEncryptKeys).size !== accountEncryptApps.length) {
    throw new Error('Home 2 QDN settings contained duplicate account-encrypt grants.')
  }
  const directChatKeys = accountDirectChatApps.map(({ accountId, appKey }) => `${appKey}\n${accountId}`)
  if (new Set(directChatKeys).size !== accountDirectChatApps.length) {
    throw new Error('Home 2 QDN settings contained duplicate direct-message grants.')
  }
  const groupChatKeys = accountGroupChatApps.map(({ accountId, appKey }) => `${appKey}\n${accountId}`)
  if (new Set(groupChatKeys).size !== accountGroupChatApps.length) {
    throw new Error('Home 2 QDN settings contained duplicate group-chat grants.')
  }
  const accountDecryptKeys = accountDecryptApps.map(({ accountId, appKey }) => `${appKey}\n${accountId}`)
  if (new Set(accountDecryptKeys).size !== accountDecryptApps.length) {
    throw new Error('Home 2 QDN settings contained duplicate account-decrypt grants.')
  }
  if (new Set(bookmarkApps.map(({ appKey }) => appKey)).size !== bookmarkApps.length) {
    throw new Error('Home 2 QDN settings contained duplicate bookmark grants.')
  }
  if (new Set(apps.map(({ appKey }) => appKey)).size !== apps.length) {
    throw new Error('Home 2 QDN settings contained duplicate notification grants.')
  }
  if (value.notifications.status !== 'available' && (apps.length || value.notifications.revision !== null)) {
    throw new Error('Unavailable Home 2 notification settings exposed app data.')
  }
  if (value.notifications.status === 'available' && value.notifications.revision === null) {
    throw new Error('Available Home 2 notification settings omitted its revision.')
  }
  return Object.freeze({
    accountDecrypt: Object.freeze({
      apps: Object.freeze(
        [...accountDecryptApps].sort((left, right) =>
          left.appKey.localeCompare(right.appKey) ||
          left.accountId.localeCompare(right.accountId)),
      ),
      revision: value.accountDecrypt.revision,
      version: 1,
    }),
    accountDirectChat: Object.freeze({
      apps: Object.freeze(
        [...accountDirectChatApps].sort((left, right) =>
          left.appKey.localeCompare(right.appKey) ||
          left.accountId.localeCompare(right.accountId)),
      ),
      revision: value.accountDirectChat.revision,
      version: 1,
    }),
    accountGroupChat: Object.freeze({
      apps: Object.freeze(
        [...accountGroupChatApps].sort((left, right) =>
          left.appKey.localeCompare(right.appKey) ||
          left.accountId.localeCompare(right.accountId)),
      ),
      revision: value.accountGroupChat.revision,
      version: 1,
    }),
    accountEncrypt: Object.freeze({
      apps: Object.freeze(
        [...accountEncryptApps].sort((left, right) =>
          left.appKey.localeCompare(right.appKey) ||
          left.accountId.localeCompare(right.accountId)),
      ),
      revision: value.accountEncrypt.revision,
      version: 1,
    }),
    accountRead: Object.freeze({
      apps: Object.freeze(
        [...accountReadApps].sort((left, right) =>
          left.appKey.localeCompare(right.appKey) ||
          left.accountId.localeCompare(right.accountId)),
      ),
      revision: value.accountRead.revision,
      version: 1,
    }),
    assignments: Object.freeze({
      assignments,
      revision: value.assignments.revision,
      version: 2,
    }),
    bookmarks: Object.freeze({
      apps: Object.freeze(
        [...bookmarkApps].sort((left, right) => left.appKey.localeCompare(right.appKey)),
      ),
      revision: value.bookmarks.revision,
      version: 1,
    }),
    chatSend: Object.freeze({
      apps: Object.freeze(
        [...chatSendApps].sort((left, right) => left.appKey.localeCompare(right.appKey)),
      ),
      revision: value.chatSend.revision,
      version: 1,
    }),
    notifications: Object.freeze({
      apps: Object.freeze(
        [...apps].sort((left, right) => left.appKey.localeCompare(right.appKey)),
      ),
      revision: value.notifications.revision as number | null,
      status: value.notifications.status as HomeV2QdnSettingsState['notifications']['status'],
      version: 1,
    }),
    notificationsManage: Object.freeze({
      apps: Object.freeze(
        [...notificationManagerApps].sort((left, right) => left.appKey.localeCompare(right.appKey)),
      ),
      revision: value.notificationsManage.revision,
      version: 1,
    }),
    revision: 1,
    schema: 'home-v2-qdn-settings-state',
  })
}

export const HOME_V2_DEFAULT_EXPLORE_APP_URL = defaultAssignments.explore.url

/**
 * Where "find more apps" should go: the user's assigned Explore app when they
 * have one, otherwise the shipped default. Never returns an empty string.
 */
export const HOME_V2_DEFAULT_BOOKMARKS_APP_URL = defaultAssignments.bookmarks.url

export function resolveHomeV2BookmarksAppUrl(
  state?: HomeV2QdnSettingsState | null,
): string {
  const assigned = state?.assignments.assignments.bookmarks?.url
  return assigned && assigned.trim() ? assigned : HOME_V2_DEFAULT_BOOKMARKS_APP_URL
}

export function resolveHomeV2ExploreAppUrl(
  state?: HomeV2QdnSettingsState | null,
): string {
  const assigned = state?.assignments.assignments.explore?.url
  return assigned && assigned.trim() ? assigned : HOME_V2_DEFAULT_EXPLORE_APP_URL
}

export const HOME_V2_DEFAULT_APPS_APP_URL = defaultAssignments.apps.url

/**
 * Where the dashboard "Apps" button should go: the user's assigned Apps app
 * when they have one, otherwise the shipped default. Never returns an empty
 * string.
 */
export function resolveHomeV2AppsAppUrl(
  state?: HomeV2QdnSettingsState | null,
): string {
  const assigned = state?.assignments.assignments.apps?.url
  return assigned && assigned.trim() ? assigned : HOME_V2_DEFAULT_APPS_APP_URL
}

export function getHomeV2QdnAssignmentRows(
  state: HomeV2QdnSettingsState,
): readonly HomeV2QdnAssignmentRow[] {
  return Object.entries(state.assignments.assignments)
    .map(([role, assignment]) => ({
      ...assignment,
      defaultUrl: role in defaultAssignments
        ? defaultAssignments[role as keyof typeof defaultAssignments].url
        : null,
      role,
    }))
    .sort((left, right) => {
      const leftDefault = defaultRoleOrder.get(left.role)
      const rightDefault = defaultRoleOrder.get(right.role)
      if (leftDefault !== undefined || rightDefault !== undefined) {
        return (leftDefault ?? Number.MAX_SAFE_INTEGER) -
          (rightDefault ?? Number.MAX_SAFE_INTEGER)
      }
      return left.role.localeCompare(right.role)
    })
}

export interface PortableHomeV2QdnSettingsDependencies {
  classifyNotificationReadError?: (
    error: unknown,
  ) => 'corrupt' | 'unavailable'
  readAssignments(): Promise<unknown>
  readNotifications(): Promise<unknown>
  revokeBookmarks(
    appKey: string,
    expectedRevision: number,
    // Omitted means 'bookmarks.manage', preserving the original signature.
    capability?: 'account.decrypt' | 'account.directChat' | 'account.encrypt' | 'account.groupChat' | 'account.read' | 'bookmarks.manage' | 'chat.send' | 'notifications.manage',
    // Present only for account-scoped capabilities.
    accountId?: string,
  ): Promise<unknown>
  revokeNotifications(
    appKey: string,
    expectedRevision: number,
  ): Promise<unknown>
  setAssignment(
    input: Readonly<{ role: string; url: string }>,
    expectedRevision: number,
  ): Promise<unknown>
  setMuted(
    appKey: string,
    muted: boolean,
    expectedRevision: number,
  ): Promise<unknown>
  subscribeAssignments?(listener: () => void): () => void
  subscribeNotifications?(listener: () => void): () => void
}

function projectPortableAssignments(value: unknown) {
  if (
    !isRecord(value) ||
    value.version !== 2 ||
    !safeGeneration(value.revision)
  ) throw new Error('Portable QDN assignments were malformed.')
  const assignments = parseAssignments(value.assignments)
  if (!Object.keys(defaultAssignments).every((role) => Object.hasOwn(assignments, role))) {
    throw new Error('Portable QDN assignments omitted a default role.')
  }
  const capabilityGrants = isRecord(value.capabilityGrants) ? value.capabilityGrants : {}
  const grantsFor = (capability: string) =>
    Object.entries(capabilityGrants).flatMap(([appKey, capabilities]) => {
      if (!isRecord(capabilities) || !isRecord(capabilities[capability])) return []
      return [parseBookmarkGrant({
        appKey,
        grantedAt: capabilities[capability].grantedAt,
      })]
    })
  const bookmarkApps = grantsFor('bookmarks.manage')
  // Apps the user chose "always allow" for when sending chat.
  const chatSendApps = grantsFor('chat.send')
  // Apps holding the durable notification-manager capability.
  const notificationManagerApps = grantsFor('notifications.manage')
  // Apps the user chose "always allow" for read-only account access, one entry
  // per (app, account) pair. Read from accountCapabilityGrants, NOT from the
  // app-scoped capabilityGrants map.
  const rawAccountGrants = isRecord(value.accountCapabilityGrants) ? value.accountCapabilityGrants : {}
  // Parameterized by capability rather than duplicated per capability: the two
  // account-scoped grants are read the same way, and a copy-paste second
  // version is how one of them ends up reading the other's key.
  const accountGrantsFor = (
    capability: 'account.read' | 'account.encrypt' | 'account.decrypt' | 'account.directChat' | 'account.groupChat',
  ) =>
    Object.entries(rawAccountGrants).flatMap(([appKey, accounts]) => {
      if (!isRecord(accounts)) return []
      return Object.entries(accounts).flatMap(([accountId, capabilities]) => {
        if (!isRecord(capabilities) || !isRecord(capabilities[capability])) return []
        return [parseAccountGrant({
          accountId,
          appKey,
          grantedAt: (capabilities[capability] as Record<string, unknown>).grantedAt,
        })]
      })
    })
  const accountReadApps = accountGrantsFor('account.read')
  const accountEncryptApps = accountGrantsFor('account.encrypt')
  const accountDecryptApps = accountGrantsFor('account.decrypt')
  const accountDirectChatApps = accountGrantsFor('account.directChat')
  const accountGroupChatApps = accountGrantsFor('account.groupChat')
  return {
    accountDecrypt: {
      apps: accountDecryptApps,
      revision: value.revision,
      version: 1 as const,
    },
    accountDirectChat: {
      apps: accountDirectChatApps,
      revision: value.revision,
      version: 1 as const,
    },
    accountGroupChat: {
      apps: accountGroupChatApps,
      revision: value.revision,
      version: 1 as const,
    },
    accountEncrypt: {
      apps: accountEncryptApps,
      revision: value.revision,
      version: 1 as const,
    },
    accountRead: {
      apps: accountReadApps,
      revision: value.revision,
      version: 1 as const,
    },
    assignments,
    bookmarks: {
      apps: bookmarkApps,
      revision: value.revision,
      version: 1 as const,
    },
    chatSend: {
      apps: chatSendApps,
      revision: value.revision,
      version: 1 as const,
    },
    notificationsManage: {
      apps: notificationManagerApps,
      revision: value.revision,
      version: 1 as const,
    },
    revision: value.revision,
    version: 2 as const,
  }
}

function projectPortableNotifications(value: unknown) {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !safeGeneration(value.revision) ||
    !isRecord(value.grants) ||
    !isRecord(value.rules) ||
    Object.keys(value.grants).length > 100
  ) throw new Error('Portable QDN notification settings were malformed.')
  const rulesByApp = value.rules
  const apps = Object.entries(value.grants).map(([appKey, grant]) => {
    if (
      !isRecord(grant) ||
      !boundedText(grant.grantedAt, 100) ||
      !Number.isFinite(Date.parse(grant.grantedAt)) ||
      !(grant.muted === undefined || typeof grant.muted === 'boolean')
    ) throw new Error('Portable QDN notification grant was malformed.')
    const rules = rulesByApp[appKey] ?? []
    if (!Array.isArray(rules) || rules.length > 20) {
      throw new Error('Portable QDN notification rules were malformed.')
    }
    const summary = {
      appKey,
      grantedAt: grant.grantedAt,
      hasForeignPaymentRule: rules.some((rule) =>
        isRecord(rule) && rule.event === 'FOREIGN_PAYMENT_RECEIVED'),
      muted: grant.muted === true,
      ruleCount: rules.length,
    }
    return parseGrant(summary)
  })
  return {
    apps,
    revision: value.revision,
    status: 'available' as const,
    version: 1 as const,
  }
}

/**
 * Builds the Android/portable adapter from injected platform stores. This
 * module never reads browser storage itself; callers retain platform ownership.
 */
export function createPortableHomeV2QdnSettingsAdapter(
  dependencies: PortableHomeV2QdnSettingsDependencies,
): HomeV2QdnSettingsAdapter {
  const readState = async (): Promise<HomeV2QdnSettingsState> => {
    const assignments = projectPortableAssignments(
      await dependencies.readAssignments(),
    )
    let notifications: HomeV2QdnSettingsState['notifications']
    try {
      const rawNotifications = await dependencies.readNotifications()
      try {
        notifications = projectPortableNotifications(rawNotifications)
      } catch {
        notifications = {
          apps: [],
          revision: null,
          status: 'corrupt',
          version: 1,
        }
      }
    } catch (error) {
      notifications = {
        apps: [],
        revision: null,
        status: dependencies.classifyNotificationReadError?.(error) ?? 'unavailable',
        version: 1,
      }
    }
    return parseHomeV2QdnSettingsState({
      accountDecrypt: assignments.accountDecrypt,
      accountDirectChat: assignments.accountDirectChat,
      accountGroupChat: assignments.accountGroupChat,
      accountEncrypt: assignments.accountEncrypt,
      accountRead: assignments.accountRead,
      assignments: {
        assignments: assignments.assignments,
        revision: assignments.revision,
        version: assignments.version,
      },
      bookmarks: assignments.bookmarks,
      chatSend: assignments.chatSend,
      notifications,
      notificationsManage: assignments.notificationsManage,
      revision: 1,
      schema: 'home-v2-qdn-settings-state',
    })
  }

  return {
    get: readState,
    async revoke(request) {
      await dependencies.revokeNotifications(
        request.appKey,
        request.expectedNotificationRevision,
      )
      return readState()
    },
    async revokeBookmarks(request) {
      await dependencies.revokeBookmarks(
        request.appKey,
        request.expectedAssignmentRevision,
        request.capability ?? 'bookmarks.manage',
        request.accountId,
      )
      return readState()
    },
    async setAssignment(request) {
      await dependencies.setAssignment(
        { role: request.role, url: request.url },
        request.expectedAssignmentRevision,
      )
      return readState()
    },
    async setMuted(request) {
      await dependencies.setMuted(
        request.appKey,
        request.muted,
        request.expectedNotificationRevision,
      )
      return readState()
    },
    subscribe(listener) {
      const unsubscribeAssignments = dependencies.subscribeAssignments?.(listener)
      const unsubscribeNotifications = dependencies.subscribeNotifications?.(listener)
      return () => {
        unsubscribeAssignments?.()
        unsubscribeNotifications?.()
      }
    },
  }
}

export function createHomeV2QdnSettingsClient(
  adapter: HomeV2QdnSettingsAdapter,
): HomeV2QdnSettingsClient {
  return {
    async get() {
      return parseHomeV2QdnSettingsState(await adapter.get())
    },
    async revoke(request) {
      return parseHomeV2QdnSettingsState(await adapter.revoke(request))
    },
    async revokeBookmarks(request) {
      return parseHomeV2QdnSettingsState(await adapter.revokeBookmarks(request))
    },
    async setAssignment(request) {
      return parseHomeV2QdnSettingsState(await adapter.setAssignment(request))
    },
    async setMuted(request) {
      return parseHomeV2QdnSettingsState(await adapter.setMuted(request))
    },
    subscribe(listener) {
      return adapter.subscribe?.(listener) ?? (() => undefined)
    },
  }
}

type WindowWithHomeV2QdnSettings = Window & {
  readonly homeV2QdnSettings?: HomeV2QdnSettingsAdapter
}

export function resolveHomeV2QdnSettingsManagement(
  injectedAdapter?: HomeV2QdnSettingsAdapter | null,
): HomeV2QdnSettingsManagement {
  const adapter = injectedAdapter === undefined && typeof window !== 'undefined'
    ? (window as WindowWithHomeV2QdnSettings).homeV2QdnSettings
    : injectedAdapter
  return adapter
    ? { available: true, client: createHomeV2QdnSettingsClient(adapter) }
    : { available: false }
}

export function isHomeV2QdnSettingsStaleError(error: unknown) {
  if (
    isRecord(error) &&
    (error.code === 'settings-changed' || error.code === 'HOME_DATA_STALE')
  ) return true
  return error instanceof Error && /settings[ -]changed|stale/i.test(error.message)
}
