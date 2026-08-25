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
  type HomeV2QdnBookmarkGrant,
  type HomeV2QdnNotificationGrant,
  type HomeV2QdnSettingsClient,
  type HomeV2QdnSettingsState,
} from '../../home-v2-live/qdn-settings-client'
import { t } from '../../i18n'
import type { VisibleAppIconLoader } from '../contracts'
import { HomeV2AppIcon } from './HomeV2AppIcon'

type QdnAppsSettingsProps = Readonly<{
  client: HomeV2QdnSettingsClient
  loadVisibleAppIcon?: VisibleAppIconLoader
}>

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
  const match = /^qdn:\/\/[^/]+\/([^/]+)/i.exec(appKey)
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
 * One revocable durable capability grant. Shared by the bookmarks card and
 * the read-only account card so both revoke through exactly the same path;
 * only the labels and the test attributes differ.
 */
function BookmarkGrantCard({
  busy,
  capability,
  disabled,
  grant,
  onRevoke,
  loadVisibleAppIcon,
}: Readonly<{
  busy: boolean
  capability: 'account.read' | 'bookmarks.manage'
  disabled: boolean
  grant: HomeV2QdnBookmarkGrant
  onRevoke: (grant: HomeV2QdnBookmarkGrant) => Promise<void>
  loadVisibleAppIcon?: VisibleAppIconLoader
}>) {
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const isAccountRead = capability === 'account.read'
  const accessLabel = isAccountRead
    ? t('managerPermissions.access.accountRead')
    : t('managerPermissions.access.bookmarks')
  return (
    <article
      className="home-v2-setting-row"
      data-qdn-account-read-grant={isAccountRead ? grant.appKey : undefined}
      data-qdn-bookmark-grant={isAccountRead ? undefined : grant.appKey}
    >
      <AppIdentityCopy
        appKey={grant.appKey}
        loadVisibleAppIcon={loadVisibleAppIcon}
      >
        <strong>{getAppName(grant.appKey)}</strong>
        <code dir="ltr">{grant.appKey}</code>
        <span>{t('qdnApps.grantedAt', { date: formatGrantedAt(grant.grantedAt) })}</span>
      </AppIdentityCopy>
      <div className="home-v2-setting-row__control">
        {confirmingRevoke ? (
          <div
            data-qdn-account-read-revoke-confirm={isAccountRead ? 'true' : undefined}
            data-qdn-bookmark-revoke-confirm={isAccountRead ? undefined : 'true'}
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
  loadVisibleAppIcon,
}: QdnAppsSettingsProps) {
  const [snapshot, setSnapshot] = useState<HomeV2QdnSettingsState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [stale, setStale] = useState(false)
  const requestId = useRef(0)
  const snapshotRef = useRef<HomeV2QdnSettingsState | null>(null)

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
  const revokeAccountRead = async (grant: HomeV2QdnBookmarkGrant) => {
    if (!snapshot) return
    await applyMutation(`accountRead:${grant.appKey}`, () =>
      client.revokeBookmarks({
        appKey: grant.appKey,
        capability: 'account.read',
        expectedAssignmentRevision: snapshot.accountRead.revision,
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
              busy={busy === `accountRead:${grant.appKey}`}
              capability="account.read"
              disabled={actionsDisabled || busy !== null}
              grant={grant}
              key={grant.appKey}
              loadVisibleAppIcon={loadVisibleAppIcon}
              onRevoke={revokeAccountRead}
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
