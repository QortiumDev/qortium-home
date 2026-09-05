import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  isHomeV2QdnSettingsStaleError,
  getHomeV2QdnAssignmentRows,
  normalizeHomeV2QdnAssignmentUrl,
  type HomeV2QdnAssignmentRow,
  type HomeV2QdnAccountGrant,
  type HomeV2QdnBookmarkGrant,
  type HomeV2QdnNotificationGrant,
  type HomeV2QdnSettingsClient,
  type HomeV2QdnSettingsState,
} from '../../home-v2-live/qdn-settings-client'
import { t } from '../../i18n'
import type { VisibleAppIconLoader } from '../contracts'
import { HomeV2AppIcon } from './HomeV2AppIcon'
import type { AddressOpenResult } from './BrowserChrome'

type QdnAppsSettingsProps = Readonly<{
  client: HomeV2QdnSettingsClient
  onOpenAddress?: (address: string) => Promise<AddressOpenResult>
  loadVisibleAppIcon?: VisibleAppIconLoader
  /**
   * Resolves the display label for an account a durable grant is bound to.
   * Optional: when it is absent or returns null the account id is shortened
   * for display instead, so a grant is never rendered without saying which
   * account it covers.
   */
  resolveAccountLabel?: (accountId: string) => string | null
}>

/**
 * Fallback attribution when an account id no longer resolves to a catalogue
 * entry — a wallet removed from this device still has a stored grant, and the
 * user has to be able to see and revoke it. Account ids are
 * `wallet:<address>` or `wallet:<address>:<index>`.
 */
function shortenAccountId(accountId: string): string {
  const withoutPrefix = accountId.startsWith('wallet:') ? accountId.slice('wallet:'.length) : accountId
  const [address, ...rest] = withoutPrefix.split(':')
  const suffix = rest.length ? ` · ${rest.join(':')}` : ''
  const shortAddress = address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address
  return `${shortAddress}${suffix}`
}

function AppIdentityCopy({
  appKey,
  children,
  loadVisibleAppIcon,
}: Readonly<{
  appKey: string
  children: ReactNode
  loadVisibleAppIcon?: VisibleAppIconLoader
}>) {
  return (
    <div className="home-v2-setting-row__copy" data-has-app-icon="true">
      <HomeV2AppIcon
        displayUrl={appKey}
        loader={loadVisibleAppIcon}
        size={34}
        variant="row"
      />
      <div className="home-v2-setting-row__copy-text">{children}</div>
    </div>
  )
}

function getAppName(appKey: string) {
  // Both schemes: a durable read grant can be held by a Qortal-routed app.
  const match = /^(?:qdn|qortal):\/\/[^/]+\/([^/]+)/i.exec(appKey)
  if (!match) return appKey
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function formatGrantedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function AssignmentRow({
  assignment,
  busy,
  disabled,
  onSave,
  loadVisibleAppIcon,
}: Readonly<{
  assignment: HomeV2QdnAssignmentRow
  busy: boolean
  disabled: boolean
  onSave: (assignment: HomeV2QdnAssignmentRow, url: string) => Promise<void>
  loadVisibleAppIcon?: VisibleAppIconLoader
}>) {
  const [url, setUrl] = useState(assignment.url ?? '')
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    setUrl(assignment.url ?? '')
    setInvalid(false)
  }, [assignment.url])

  let normalized: string | null = null
  try {
    normalized = normalizeHomeV2QdnAssignmentUrl(url)
  } catch {
    normalized = null
  }
  const changed = normalized !== null && normalized !== assignment.url
  const errorId = `home-v2-qdn-assignment-error-${assignment.role}`

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!normalized || !changed) {
      setInvalid(normalized === null)
      return
    }
    setInvalid(false)
    void onSave(assignment, normalized)
  }

  return (
    <form
      aria-label={assignment.label}
      className="home-v2-setting-row"
      data-qdn-assignment-role={assignment.role}
      onSubmit={save}
    >
      <AppIdentityCopy
        appKey={assignment.url ?? assignment.defaultUrl ?? ''}
        loadVisibleAppIcon={loadVisibleAppIcon}
      >
        <strong>{assignment.label}</strong>
        <span>{assignment.description ?? assignment.role}</span>
        <code dir="ltr">{assignment.role}</code>
      </AppIdentityCopy>
      <div className="home-v2-setting-row__control">
        <input
          aria-describedby={invalid ? errorId : undefined}
          aria-invalid={invalid || undefined}
          aria-label={`${assignment.label}: ${t('qdnApps.appUrl')}`}
          autoComplete="off"
          dir="ltr"
          disabled={disabled || busy}
          spellCheck={false}
          value={url}
          onChange={(event) => {
            setUrl(event.target.value)
            setInvalid(false)
          }}
        />
        {invalid ? (
          <span id={errorId} role="alert">
            {t('qdnApps.invalidAddress')}
          </span>
        ) : null}
        <div>
          <button
            className="home-v2-primary-button"
            disabled={disabled || busy || !changed}
            type="submit"
          >
            {t('common.save')}
          </button>
          {assignment.defaultUrl ? (
            <button
              className="home-v2-secondary-button"
              disabled={
                disabled || busy || assignment.url === assignment.defaultUrl
              }
              type="button"
              onClick={() => {
                setUrl(assignment.defaultUrl ?? '')
                setInvalid(false)
                if (assignment.defaultUrl) {
                  void onSave(assignment, assignment.defaultUrl)
                }
              }}
            >
              {t('qdnApps.useDefault')}
            </button>
          ) : null}
        </div>
      </div>
    </form>
  )
}

function NotificationGrantCard({
  busy,
  disabled,
  grant,
  onMute,
  onRevoke,
  loadVisibleAppIcon,
}: Readonly<{
  busy: boolean
  disabled: boolean
  grant: HomeV2QdnNotificationGrant
  onMute: (grant: HomeV2QdnNotificationGrant, muted: boolean) => Promise<void>
  onRevoke: (grant: HomeV2QdnNotificationGrant) => Promise<void>
  loadVisibleAppIcon?: VisibleAppIconLoader
}>) {
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)

  return (
    <article
      className="home-v2-setting-row"
      data-qdn-notification-grant={grant.appKey}
    >
      <AppIdentityCopy
        appKey={grant.appKey}
        loadVisibleAppIcon={loadVisibleAppIcon}
      >
        <strong>{getAppName(grant.appKey)}</strong>
        <code dir="ltr">{grant.appKey}</code>
        <span>
          {t('qdnApps.grantedAt', { date: formatGrantedAt(grant.grantedAt) })}
        </span>
        <span>{t('notifications.ruleCount', { count: grant.ruleCount })}</span>
        {grant.hasForeignPaymentRule ? (
          <span data-qdn-foreign-payment-warning="true">
            {t('notifications.foreignPaymentPrivacy')}
          </span>
        ) : null}
      </AppIdentityCopy>
      <div className="home-v2-setting-row__control">
        <label>
          <input
            checked={grant.muted}
            disabled={disabled || busy}
            type="checkbox"
            onChange={(event) => void onMute(grant, event.target.checked)}
          />
          {t('notifications.mute')}
        </label>
        {confirmingRevoke ? (
          <div data-qdn-revoke-confirm="true" role="alert">
            <strong>{t('notifications.revoke')}</strong>
            <span>{t('notifications.revokeConfirm', { count: grant.ruleCount })}</span>
            <button
              className="home-v2-secondary-button"
              disabled={busy}
              type="button"
              onClick={() => setConfirmingRevoke(false)}
            >
              {t('common.cancel')}
            </button>
            <button
              className="home-v2-danger-button"
              disabled={disabled || busy}
              type="button"
              onClick={() => void onRevoke(grant)}
            >
              {t('notifications.revoke')}
            </button>
          </div>
        ) : (
          <button
            className="home-v2-danger-button"
            disabled={disabled || busy}
            type="button"
            onClick={() => setConfirmingRevoke(true)}
          >
            {t('notifications.revoke')}
          </button>
        )}
      </div>
    </article>
  )
}

/**
 * Per-capability presentation for the shared grant card. Keeping the test
 * attributes in one table is what lets bookmarks, chat sends and read-only
 * account access render and revoke through exactly one code path.
 */
const GRANT_CARD_ACCESS_LABEL_KEYS = {
  // Worded as use of the KEY, never as reading account data. The two are
  // separate grants with separate cards precisely so a user revoking one is
  // not shown wording that could describe the other.
  // Worded as READING, never as encrypting: the two are separate grants and
  // the wording is what tells a user which card they are about to revoke.
  'account.decrypt': 'managerPermissions.access.accountDecrypt',
  'account.directChat': 'managerPermissions.access.accountDirectChat',
  'account.groupChat': 'managerPermissions.access.accountGroupChat',
  'account.encrypt': 'managerPermissions.access.accountEncrypt',
  'account.read': 'managerPermissions.access.accountRead',
  'bookmarks.manage': 'managerPermissions.access.bookmarks',
  'chat.send': 'managerPermissions.access.chatSend',
  // Deliberately worded as authority over OTHER apps' notification rules. The
  // per-app "may show notifications" grant is the separate section below, and
  // the two must never read as the same thing.
  'notifications.manage': 'managerPermissions.access.notifications',
} as const

type GrantCardCapability = keyof typeof GRANT_CARD_ACCESS_LABEL_KEYS

/**
 * One revocable durable capability grant. Shared by the bookmarks, chat-send
 * and read-only account cards so all three revoke through exactly the same
 * path; only the labels and the test attributes differ.
 *
 * An account-scoped grant (account.read) also names the account it was given
 * for, because it covers only that account — see accountLabel.
 */
function BookmarkGrantCard<Grant extends HomeV2QdnBookmarkGrant>({
  accountLabel,
  busy,
  capability,
  disabled,
  grant,
  onRevoke,
  loadVisibleAppIcon,
}: Readonly<{
  accountLabel?: string | null
  busy: boolean
  capability: GrantCardCapability
  disabled: boolean
  grant: Grant
  onRevoke: (grant: Grant) => Promise<void>
  loadVisibleAppIcon?: VisibleAppIconLoader
}>) {
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const accessLabel = t(GRANT_CARD_ACCESS_LABEL_KEYS[capability])
  return (
    <article
      className="home-v2-setting-row"
      data-qdn-account-decrypt-grant={capability === 'account.decrypt' ? grant.appKey : undefined}
      data-qdn-account-encrypt-grant={capability === 'account.encrypt' ? grant.appKey : undefined}
      data-qdn-account-read-grant={capability === 'account.read' ? grant.appKey : undefined}
      data-qdn-bookmark-grant={capability === 'bookmarks.manage' ? grant.appKey : undefined}
      data-qdn-chat-send-grant={capability === 'chat.send' ? grant.appKey : undefined}
      data-qdn-notification-manager-grant={capability === 'notifications.manage' ? grant.appKey : undefined}
    >
      <AppIdentityCopy
        appKey={grant.appKey}
        loadVisibleAppIcon={loadVisibleAppIcon}
      >
        <strong>{getAppName(grant.appKey)}</strong>
        <code dir="ltr">{grant.appKey}</code>
        {accountLabel ? (
          <span data-qdn-grant-account="true">
            {t('qdnApps.grantAccount', { account: accountLabel })}
          </span>
        ) : null}
        <span>{t('qdnApps.grantedAt', { date: formatGrantedAt(grant.grantedAt) })}</span>
      </AppIdentityCopy>
      <div className="home-v2-setting-row__control">
        {confirmingRevoke ? (
          <div
            data-qdn-account-decrypt-revoke-confirm={capability === 'account.decrypt' ? 'true' : undefined}
            data-qdn-account-encrypt-revoke-confirm={capability === 'account.encrypt' ? 'true' : undefined}
            data-qdn-account-read-revoke-confirm={capability === 'account.read' ? 'true' : undefined}
            data-qdn-bookmark-revoke-confirm={capability === 'bookmarks.manage' ? 'true' : undefined}
            data-qdn-chat-send-revoke-confirm={capability === 'chat.send' ? 'true' : undefined}
            data-qdn-notification-manager-revoke-confirm={capability === 'notifications.manage' ? 'true' : undefined}
            role="alert"
          >
            <strong>{t('notifications.revoke')}</strong>
            <span>{accessLabel}</span>
            <button
              className="home-v2-secondary-button"
              disabled={busy}
              type="button"
              onClick={() => setConfirmingRevoke(false)}
            >
              {t('common.cancel')}
            </button>
            <button
              className="home-v2-danger-button"
              disabled={disabled || busy}
              type="button"
              onClick={() => void onRevoke(grant)}
            >
              {t('notifications.revoke')}
            </button>
          </div>
        ) : (
          <button
            className="home-v2-danger-button"
            disabled={disabled || busy}
            type="button"
            onClick={() => setConfirmingRevoke(true)}
          >
            {t('notifications.revoke')}
          </button>
        )}
      </div>
    </article>
  )
}

export function QdnAppsSettings({
  client,
  onOpenAddress,
  loadVisibleAppIcon,
  resolveAccountLabel,
}: QdnAppsSettingsProps) {
  const [snapshot, setSnapshot] = useState<HomeV2QdnSettingsState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [stale, setStale] = useState(false)
  const requestId = useRef(0)
  const snapshotRef = useRef<HomeV2QdnSettingsState | null>(null)
  const openingManager = useRef(false)
  const [managerBusy, setManagerBusy] = useState(false)
  const [managerError, setManagerError] = useState<string | null>(null)

  const openNotificationsManager = async () => {
    if (!onOpenAddress || openingManager.current) return
    openingManager.current = true
    setManagerBusy(true)
    setManagerError(null)
    try {
      // Another Settings tab or manager may have changed the assignment since
      // this panel rendered. Resolve the persisted choice at click time.
      const current = await client.get()
      const url = current.assignments.assignments.notifications?.url
      if (!url) throw new Error(t('qdnApps.invalidAddress'))
      const result = await onOpenAddress(normalizeHomeV2QdnAssignmentUrl(url))
      if (result.status !== 'opened') setManagerError(result.message)
    } catch (reason) {
      setManagerError(reason instanceof Error ? reason.message : t('common.error'))
    } finally {
      openingManager.current = false
      setManagerBusy(false)
    }
  }

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current
    setLoading(true)
    try {
      const nextSnapshot = await client.get()
      if (requestId.current !== currentRequest) return
      snapshotRef.current = nextSnapshot
      setSnapshot(nextSnapshot)
      setError(false)
      setStale(false)
    } catch {
      if (requestId.current !== currentRequest) return
      setError(true)
      setStale(snapshotRef.current !== null)
    } finally {
      if (requestId.current === currentRequest) setLoading(false)
    }
  }, [client])

  useEffect(() => {
    void refresh()
    return client.subscribe(() => void refresh())
  }, [client, refresh])

  const applyMutation = async (
    operation: string,
    mutate: () => Promise<HomeV2QdnSettingsState>,
  ) => {
    const currentRequest = ++requestId.current
    setBusy(operation)
    setError(false)
    try {
      const nextSnapshot = await mutate()
      if (requestId.current !== currentRequest) return
      snapshotRef.current = nextSnapshot
      setSnapshot(nextSnapshot)
      setStale(false)
    } catch (reason) {
      if (requestId.current !== currentRequest) return
      setError(true)
      setStale(
        snapshotRef.current !== null || isHomeV2QdnSettingsStaleError(reason),
      )
    } finally {
      setBusy(null)
    }
  }

  const saveAssignment = async (
    assignment: HomeV2QdnAssignmentRow,
    url: string,
  ) => {
    if (!snapshot) return
    await applyMutation(`assignment:${assignment.role}`, () =>
      client.setAssignment({
        expectedAssignmentRevision: snapshot.assignments.revision,
        role: assignment.role,
        url,
      }))
  }

  const setMuted = async (
    grant: HomeV2QdnNotificationGrant,
    muted: boolean,
  ) => {
    const notificationRevision = snapshot?.notifications.revision
    if (notificationRevision === null || notificationRevision === undefined) return
    await applyMutation(`grant:${grant.appKey}`, () =>
      client.setMuted({
        appKey: grant.appKey,
        expectedNotificationRevision: notificationRevision,
        muted,
      }))
  }

  const revoke = async (grant: HomeV2QdnNotificationGrant) => {
    const notificationRevision = snapshot?.notifications.revision
    if (notificationRevision === null || notificationRevision === undefined) return
    await applyMutation(`grant:${grant.appKey}`, () =>
      client.revoke({
        appKey: grant.appKey,
        expectedNotificationRevision: notificationRevision,
      }))
  }

  const revokeBookmarks = async (grant: HomeV2QdnBookmarkGrant) => {
    if (!snapshot) return
    await applyMutation(`bookmarks:${grant.appKey}`, () =>
      client.revokeBookmarks({
        appKey: grant.appKey,
        expectedAssignmentRevision: snapshot.bookmarks.revision,
      }))
  }

  // Revoking this drops the durable "always allow" for the whole read-only
  // account family, so the app is prompted again the next time it asks for a
  // private group chat or a chat attachment.
  const revokeAccountRead = async (grant: HomeV2QdnAccountGrant) => {
    if (!snapshot) return
    // Keyed by the (app, account) pair, and revoking names the account: the
    // grant covers only the account it was approved under, so revoking one
    // must not touch the same app's grant for a different account.
    await applyMutation(`accountRead:${grant.appKey}:${grant.accountId}`, () =>
      client.revokeBookmarks({
        accountId: grant.accountId,
        appKey: grant.appKey,
        capability: 'account.read',
        expectedAssignmentRevision: snapshot.accountRead.revision,
      }))
  }

  // Revoking this drops the durable "always allow" for encrypting with the
  // account key, so the app is asked again the next time it calls
  // ENCRYPT_DATA. It does NOT touch the same app's account.read grant: they
  // are separate capabilities with separate cards.
  // Revoking this stops the app reading encrypted data addressed to this
  // account. It does NOT touch the same app's encrypt or read grants: three
  // separate capabilities, three separate cards.
  const revokeAccountDecrypt = async (grant: HomeV2QdnAccountGrant) => {
    if (!snapshot) return
    await applyMutation(`accountDecrypt:${grant.appKey}:${grant.accountId}`, () =>
      client.revokeBookmarks({
        accountId: grant.accountId,
        appKey: grant.appKey,
        capability: 'account.decrypt',
        expectedAssignmentRevision: snapshot.accountDecrypt.revision,
      }))
  }

  // Revoking this stops the app reading this account's DIRECT MESSAGES. Its
  // own card: an app allowed to decrypt data it already holds has not thereby
  // been allowed to read a mailbox.
  const revokeAccountDirectChat = async (grant: HomeV2QdnAccountGrant) => {
    if (!snapshot) return
    await applyMutation(`accountDirectChat:${grant.appKey}:${grant.accountId}`, () =>
      client.revokeBookmarks({
        accountId: grant.accountId,
        appKey: grant.appKey,
        capability: 'account.directChat',
        expectedAssignmentRevision: snapshot.accountDirectChat.revision,
      }))
  }

  // Revoking this stops the app reading this account's PRIVATE GROUP history.
  // Its own card and its own capability: letting an app read group chats is not
  // the same decision as handing it one-to-one messages, and a user revoking
  // one must not be shown wording that describes the other.
  const revokeAccountGroupChat = async (grant: HomeV2QdnAccountGrant) => {
    if (!snapshot) return
    await applyMutation(`accountGroupChat:${grant.appKey}:${grant.accountId}`, () =>
      client.revokeBookmarks({
        accountId: grant.accountId,
        appKey: grant.appKey,
        capability: 'account.groupChat',
        expectedAssignmentRevision: snapshot.accountGroupChat.revision,
      }))
  }

  const revokeAccountEncrypt = async (grant: HomeV2QdnAccountGrant) => {
    if (!snapshot) return
    await applyMutation(`accountEncrypt:${grant.appKey}:${grant.accountId}`, () =>
      client.revokeBookmarks({
        accountId: grant.accountId,
        appKey: grant.appKey,
        capability: 'account.encrypt',
        expectedAssignmentRevision: snapshot.accountEncrypt.revision,
      }))
  }

  // Chat-send "always allow" grants were persisted and reported here from the
  // start but never rendered, which made them unrevokable in practice. They
  // revoke through the same path as every other durable capability.
  const revokeChatSend = async (grant: HomeV2QdnBookmarkGrant) => {
    if (!snapshot) return
    await applyMutation(`chatSend:${grant.appKey}`, () =>
      client.revokeBookmarks({
        appKey: grant.appKey,
        capability: 'chat.send',
        expectedAssignmentRevision: snapshot.chatSend.revision,
      }))
  }

  // Revoking the notification-MANAGER capability takes back one app's authority
  // over every other app's notification rules. It deletes no rule and revokes no
  // managed app's own notification grant — those stay in the section below.
  const revokeNotificationsManage = async (grant: HomeV2QdnBookmarkGrant) => {
    if (!snapshot) return
    await applyMutation(`notificationsManage:${grant.appKey}`, () =>
      client.revokeBookmarks({
        appKey: grant.appKey,
        capability: 'notifications.manage',
        expectedAssignmentRevision: snapshot.notificationsManage.revision,
      }))
  }

  const actionsDisabled = loading || stale || snapshot === null

  return (
    <section
      aria-labelledby="home-v2-qdn-apps-title"
      className="home-v2-settings-panel"
      data-home-v2-qdn-settings={stale ? 'stale' : loading ? 'loading' : 'ready'}
    >
      <div className="home-v2-settings-panel__heading">
        <h2 id="home-v2-qdn-apps-title">{t('qdnApps.sectionTitle')}</h2>
        <p>{t('qdnApps.description')}</p>
      </div>

      {loading && !snapshot ? (
        <p aria-live="polite" role="status">{t('common.loading')}</p>
      ) : null}
      {error ? (
        <div role="alert">
          <span>{t(stale ? 'qdnApps.stale' : 'qdnApps.loadFailed')}</span>
          <button
            className="home-v2-secondary-button"
            disabled={loading}
            type="button"
            onClick={() => void refresh()}
          >
            {stale ? t('common.refresh') : t('common.retry')}
          </button>
        </div>
      ) : null}

      {snapshot ? (
        <div data-qdn-assignments="true">
          {getHomeV2QdnAssignmentRows(snapshot).map((assignment) => (
            <AssignmentRow
              assignment={assignment}
              busy={busy === `assignment:${assignment.role}`}
              disabled={actionsDisabled || busy !== null}
              key={assignment.role}
              loadVisibleAppIcon={loadVisibleAppIcon}
              onSave={saveAssignment}
            />
          ))}
          {onOpenAddress ? (
            <button
              className="home-v2-secondary-button"
              disabled={actionsDisabled || busy !== null || managerBusy}
              type="button"
              onClick={() => void openNotificationsManager()}
            >
              {t('qdnApps.openNotificationsManager')}
            </button>
          ) : null}
          {managerError ? <p role="alert">{managerError}</p> : null}
        </div>
      ) : null}

      {snapshot?.accountRead.apps.length ? (
        <section aria-labelledby="home-v2-qdn-account-read-controls-title">
          <div className="home-v2-settings-panel__heading">
            <h3 id="home-v2-qdn-account-read-controls-title">
              {t('qdnApps.accountReadControlsTitle')}
            </h3>
            <p>{t('managerPermissions.access.accountRead')}</p>
          </div>
          {snapshot.accountRead.apps.map((grant) => (
            <BookmarkGrantCard
              accountLabel={resolveAccountLabel?.(grant.accountId) ?? shortenAccountId(grant.accountId)}
              busy={busy === `accountRead:${grant.appKey}:${grant.accountId}`}
              capability="account.read"
              disabled={actionsDisabled || busy !== null}
              grant={grant}
              key={`${grant.appKey}:${grant.accountId}`}
              loadVisibleAppIcon={loadVisibleAppIcon}
              onRevoke={revokeAccountRead}
            />
          ))}
        </section>
      ) : null}

      {snapshot?.accountDecrypt.apps.length ? (
        <section aria-labelledby="home-v2-qdn-account-decrypt-controls-title">
          <div className="home-v2-settings-panel__heading">
            <h3 id="home-v2-qdn-account-decrypt-controls-title">
              {t('qdnApps.accountDecryptControlsTitle')}
            </h3>
            <p>{t('managerPermissions.access.accountDecrypt')}</p>
          </div>
          {snapshot.accountDecrypt.apps.map((grant) => (
            <BookmarkGrantCard
              accountLabel={resolveAccountLabel?.(grant.accountId) ?? shortenAccountId(grant.accountId)}
              busy={busy === `accountDecrypt:${grant.appKey}:${grant.accountId}`}
              capability="account.decrypt"
              disabled={actionsDisabled || busy !== null}
              grant={grant}
              key={`${grant.appKey}:${grant.accountId}`}
              loadVisibleAppIcon={loadVisibleAppIcon}
              onRevoke={revokeAccountDecrypt}
            />
          ))}
        </section>
      ) : null}

      {snapshot?.accountDirectChat.apps.length ? (
        <section aria-labelledby="home-v2-qdn-account-direct-chat-controls-title">
          <div className="home-v2-settings-panel__heading">
            <h3 id="home-v2-qdn-account-direct-chat-controls-title">
              {t('qdnApps.accountDirectChatControlsTitle')}
            </h3>
            <p>{t('managerPermissions.access.accountDirectChat')}</p>
          </div>
          {snapshot.accountDirectChat.apps.map((grant) => (
            <BookmarkGrantCard
              accountLabel={resolveAccountLabel?.(grant.accountId) ?? shortenAccountId(grant.accountId)}
              busy={busy === `accountDirectChat:${grant.appKey}:${grant.accountId}`}
              capability="account.directChat"
              disabled={actionsDisabled || busy !== null}
              grant={grant}
              key={`${grant.appKey}:${grant.accountId}`}
              loadVisibleAppIcon={loadVisibleAppIcon}
              onRevoke={revokeAccountDirectChat}
            />
          ))}
        </section>
      ) : null}

      {snapshot?.accountGroupChat.apps.length ? (
        <section aria-labelledby="home-v2-qdn-account-group-chat-controls-title">
          <div className="home-v2-settings-panel__heading">
            <h3 id="home-v2-qdn-account-group-chat-controls-title">
              {t('qdnApps.accountGroupChatControlsTitle')}
            </h3>
            <p>{t('managerPermissions.access.accountGroupChat')}</p>
          </div>
          {snapshot.accountGroupChat.apps.map((grant) => (
            <BookmarkGrantCard
              accountLabel={resolveAccountLabel?.(grant.accountId) ?? shortenAccountId(grant.accountId)}
              busy={busy === `accountGroupChat:${grant.appKey}:${grant.accountId}`}
              capability="account.groupChat"
              disabled={actionsDisabled || busy !== null}
              grant={grant}
              key={`${grant.appKey}:${grant.accountId}`}
              loadVisibleAppIcon={loadVisibleAppIcon}
              onRevoke={revokeAccountGroupChat}
            />
          ))}
        </section>
      ) : null}

      {snapshot?.accountEncrypt.apps.length ? (
        <section aria-labelledby="home-v2-qdn-account-encrypt-controls-title">
          <div className="home-v2-settings-panel__heading">
            <h3 id="home-v2-qdn-account-encrypt-controls-title">
              {t('qdnApps.accountEncryptControlsTitle')}
            </h3>
            <p>{t('managerPermissions.access.accountEncrypt')}</p>
          </div>
          {snapshot.accountEncrypt.apps.map((grant) => (
            <BookmarkGrantCard
              accountLabel={resolveAccountLabel?.(grant.accountId) ?? shortenAccountId(grant.accountId)}
              busy={busy === `accountEncrypt:${grant.appKey}:${grant.accountId}`}
              capability="account.encrypt"
              disabled={actionsDisabled || busy !== null}
              grant={grant}
              key={`${grant.appKey}:${grant.accountId}`}
              loadVisibleAppIcon={loadVisibleAppIcon}
              onRevoke={revokeAccountEncrypt}
            />
          ))}
        </section>
      ) : null}

      {snapshot?.chatSend.apps.length ? (
        <section aria-labelledby="home-v2-qdn-chat-send-controls-title">
          <div className="home-v2-settings-panel__heading">
            <h3 id="home-v2-qdn-chat-send-controls-title">
              {t('qdnApps.chatSendControlsTitle')}
            </h3>
            <p>{t('managerPermissions.access.chatSend')}</p>
          </div>
          {snapshot.chatSend.apps.map((grant) => (
            <BookmarkGrantCard
              busy={busy === `chatSend:${grant.appKey}`}
              capability="chat.send"
              disabled={actionsDisabled || busy !== null}
              grant={grant}
              key={grant.appKey}
              loadVisibleAppIcon={loadVisibleAppIcon}
              onRevoke={revokeChatSend}
            />
          ))}
        </section>
      ) : null}

      {snapshot?.bookmarks.apps.length ? (
        <section aria-labelledby="home-v2-qdn-bookmark-controls-title">
          <div className="home-v2-settings-panel__heading">
            <h3 id="home-v2-qdn-bookmark-controls-title">
              {t('bookmarks.manageTitle')}
            </h3>
            <p>{t('managerPermissions.access.bookmarks')}</p>
          </div>
          {snapshot.bookmarks.apps.map((grant) => (
            <BookmarkGrantCard
              busy={busy === `bookmarks:${grant.appKey}`}
              capability="bookmarks.manage"
              disabled={actionsDisabled || busy !== null}
              grant={grant}
              key={grant.appKey}
              loadVisibleAppIcon={loadVisibleAppIcon}
              onRevoke={revokeBookmarks}
            />
          ))}
        </section>
      ) : null}

      {snapshot?.notificationsManage.apps.length ? (
        <section aria-labelledby="home-v2-qdn-notification-manager-controls-title">
          <div className="home-v2-settings-panel__heading">
            <h3 id="home-v2-qdn-notification-manager-controls-title">
              {t('managerPermissions.action.notifications')}
            </h3>
            <p>{t('managerPermissions.access.notifications')}</p>
          </div>
          {snapshot.notificationsManage.apps.map((grant) => (
            <BookmarkGrantCard
              busy={busy === `notificationsManage:${grant.appKey}`}
              capability="notifications.manage"
              disabled={actionsDisabled || busy !== null}
              grant={grant}
              key={grant.appKey}
              loadVisibleAppIcon={loadVisibleAppIcon}
              onRevoke={revokeNotificationsManage}
            />
          ))}
        </section>
      ) : null}

      {snapshot ? (
        <section aria-labelledby="home-v2-qdn-notification-controls-title">
          <div className="home-v2-settings-panel__heading">
            <h3 id="home-v2-qdn-notification-controls-title">
              {t('qdnApps.notificationControlsTitle')}
            </h3>
            <p>{t('qdnApps.notificationControlsDescription')}</p>
          </div>
          {snapshot.notifications.status !== 'available' ? (
            <p data-qdn-notification-unavailable="true" role="alert">
              {t(snapshot.notifications.status === 'corrupt'
                ? 'notifications.corrupt'
                : 'notifications.unavailable')}
            </p>
          ) : snapshot.notifications.apps.length === 0 ? (
            <p data-qdn-notification-empty="true">{t('notifications.empty')}</p>
          ) : (
            snapshot.notifications.apps.map((grant) => (
              <NotificationGrantCard
                busy={busy === `grant:${grant.appKey}`}
                disabled={actionsDisabled || busy !== null}
                grant={grant}
                key={grant.appKey}
                loadVisibleAppIcon={loadVisibleAppIcon}
                onMute={setMuted}
                onRevoke={revoke}
              />
            ))
          )}
        </section>
      ) : null}
    </section>
  )
}
