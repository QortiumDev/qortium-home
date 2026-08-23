import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  isHomeV2QdnSettingsStaleError,
  getHomeV2QdnAssignmentRows,
  normalizeHomeV2QdnAssignmentUrl,
  type HomeV2QdnAssignmentRow,
  type HomeV2QdnNotificationGrant,
  type HomeV2QdnSettingsClient,
  type HomeV2QdnSettingsState,
} from '../../home-v2-live/qdn-settings-client'
import { t } from '../../i18n'

type QdnAppsSettingsProps = Readonly<{
  client: HomeV2QdnSettingsClient
}>

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
}: Readonly<{
  assignment: HomeV2QdnAssignmentRow
  busy: boolean
  disabled: boolean
  onSave: (assignment: HomeV2QdnAssignmentRow, url: string) => Promise<void>
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
      <div className="home-v2-setting-row__copy">
        <strong>{assignment.label}</strong>
        <span>{assignment.description ?? assignment.role}</span>
        <code dir="ltr">{assignment.role}</code>
      </div>
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
}: Readonly<{
  busy: boolean
  disabled: boolean
  grant: HomeV2QdnNotificationGrant
  onMute: (grant: HomeV2QdnNotificationGrant, muted: boolean) => Promise<void>
  onRevoke: (grant: HomeV2QdnNotificationGrant) => Promise<void>
}>) {
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)

  return (
    <article
      className="home-v2-setting-row"
      data-qdn-notification-grant={grant.appKey}
    >
      <div className="home-v2-setting-row__copy">
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
      </div>
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

export function QdnAppsSettings({ client }: QdnAppsSettingsProps) {
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
              onSave={saveAssignment}
            />
          ))}
        </div>
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
