import { useEffect, useState, type FormEvent } from 'react';
import type { QdnNotificationStore } from '../electron/notification-rules';
import {
  DEFAULT_BOOKMARKS_MANAGER_URL,
  DEFAULT_NOTIFICATIONS_MANAGER_URL,
  type QdnAppRole,
  type QdnAppRolesStore,
} from '../electron/qdn-manager-permissions';
import { getTranslationLanguage, t } from './i18n';
import {
  getNotificationStore,
  onNotificationStoreChanged,
  revokeAppNotifications,
  setAppNotificationMuted,
} from './notificationStore';
import {
  getQdnAppRolesStore,
  onQdnManagerPermissionsChanged,
  setQdnAppRoleUrl,
} from './qdnManagerPermissions';
import {
  formatQdnManagerPermissionTime,
  getQdnAppRoleSaveState,
  getQdnAppRoleRows,
  type QdnAppRoleRow,
} from './qdnManagerPermissionsPanelModel';
import { SettingsSection } from './SettingsSection';

type Props = {
  isExpanded?: boolean;
  onExpandedChange?: (isExpanded: boolean) => void;
  onOpenNotificationsManager: (url: string) => void;
};

function roleLabel(role: QdnAppRole) {
  return role === 'bookmarksManager' ? t('qdnApps.role.bookmarksManager') : t('qdnApps.role.notificationsManager');
}

function defaultUrlForRole(role: QdnAppRole) {
  return role === 'bookmarksManager' ? DEFAULT_BOOKMARKS_MANAGER_URL : DEFAULT_NOTIFICATIONS_MANAGER_URL;
}

function hasForeignPaymentRule(store: QdnNotificationStore | null, appKey: string) {
  return store?.rules[appKey]?.some((rule) => rule.event === 'FOREIGN_PAYMENT_RECEIVED') ?? false;
}

function getAppName(appKey: string) {
  const match = /^qdn:\/\/[^/]+\/([^/]+)/i.exec(appKey);
  if (!match) return appKey;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

type RoleRowProps = {
  isBusy: boolean;
  onSave: (url: string) => void;
  row: QdnAppRoleRow;
};

function QdnAppRoleRowForm({ isBusy, onSave, row }: RoleRowProps) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setUrl('');
    setError('');
  }, [row.url]);

  const candidate = getQdnAppRoleSaveState(url, row.url);
  const canSave = !isBusy && candidate.valid && candidate.changed;
  const errorId = `qdn-apps-role-error-${row.role}`;
  const defaultUrl = defaultUrlForRole(row.role);

  function save(event: FormEvent) {
    event.preventDefault();
    if (!candidate.normalized || !candidate.changed) return;
    setError('');
    onSave(candidate.normalized);
  }

  return (
    <form aria-label={roleLabel(row.role)} className="qdn-apps-settings__role" onSubmit={save}>
      <div className="qdn-apps-settings__role-header">
        <strong>{roleLabel(row.role)}</strong>
        {row.grantedAt ? (
          <time dateTime={row.grantedAt}>{t('qdnApps.grantedAt', {
            date: formatQdnManagerPermissionTime(row.grantedAt, getTranslationLanguage()),
          })}</time>
        ) : (
          <span>{t('qdnApps.notGranted')}</span>
        )}
      </div>
      <label className="field">
        <span className="field__label">{t('qdnApps.appUrl')}</span>
        <input
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          className="field__input"
          dir="ltr"
          placeholder={row.url ?? undefined}
          spellCheck={false}
          value={url}
          onChange={(event) => {
            const nextUrl = event.target.value;
            setUrl(nextUrl);
            setError(nextUrl.trim() && !getQdnAppRoleSaveState(nextUrl, row.url).valid ? t('qdnApps.invalidAddress') : '');
          }}
        />
      </label>
      {error ? <p className="field__error" id={errorId} role="alert">{error}</p> : null}
      <div className="qdn-apps-settings__actions">
        <button className="button button--primary" disabled={!canSave} type="submit">{t('common.save')}</button>
        <button
          className="button"
          disabled={isBusy || row.url === defaultUrl}
          type="button"
          onClick={() => onSave(defaultUrl)}
        >
          {t('qdnApps.useDefault')}
        </button>
      </div>
    </form>
  );
}

export function QdnAppsSettingsPanel({ isExpanded, onExpandedChange, onOpenNotificationsManager }: Props) {
  const [store, setStore] = useState<QdnAppRolesStore | null>(null);
  const [notificationStore, setNotificationStore] = useState<QdnNotificationStore | null>(null);
  const [error, setError] = useState('');
  const [notificationError, setNotificationError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [busyRole, setBusyRole] = useState<'' | QdnAppRole>('');

  useEffect(() => {
    let active = true;
    const unsubscribe = onQdnManagerPermissionsChanged((nextStore) => {
      if (active) {
        setError('');
        setStore(nextStore);
      }
    });
    void getQdnAppRolesStore()
      .then((nextStore) => {
        if (active) {
          setError('');
          setStore(nextStore);
        }
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    void getNotificationStore().then(setNotificationStore).catch((reason) => setNotificationError(String(reason)));
    return onNotificationStoreChanged(setNotificationStore);
  }, [isExpanded]);

  function runRoleUpdate(role: QdnAppRole, url: string) {
    setError('');
    setBusyRole(role);
    void setQdnAppRoleUrl(role, url)
      .then(setStore)
      .catch((reason) => setError(String(reason)))
      .finally(() => setBusyRole(''));
  }

  const rows = getQdnAppRoleRows(store);
  const apps = notificationStore ? Object.entries(notificationStore.grants) : [];
  const notificationsManagerUrl = store?.roles.notificationsManager.url ?? DEFAULT_NOTIFICATIONS_MANAGER_URL;

  return (
    <SettingsSection
      isExpanded={isExpanded}
      title={t('qdnApps.sectionTitle')}
      onExpandedChange={onExpandedChange}
    >
      <div className="qdn-apps-settings">
        <p className="field__hint">{t('qdnApps.description')}</p>
        {error ? <p aria-live="assertive" className="field__error" role="alert">{error}</p> : null}
        {isLoading ? <p aria-live="polite" className="field__hint">{t('common.loading')}</p> : null}
        {rows.map((row) => (
          <QdnAppRoleRowForm
            isBusy={!!busyRole}
            key={row.role}
            row={row}
            onSave={(url) => runRoleUpdate(row.role, url)}
          />
        ))}
        <div className="qdn-apps-settings__manager-launcher">
          <button className="button button--primary" type="button" onClick={() => onOpenNotificationsManager(notificationsManagerUrl)}>
            {t('qdnApps.openNotificationsManager')}
          </button>
        </div>
        <div className="qdn-apps-settings__notification-controls">
          <h2>{t('qdnApps.notificationControlsTitle')}</h2>
          <p className="field__hint">{t('qdnApps.notificationControlsDescription')}</p>
          {notificationError ? <p className="field__error">{notificationError}</p> : null}
          {!notificationStore ? <p className="field__hint">{t('common.loading')}</p> : null}
          {notificationStore && apps.length === 0 ? <p className="field__hint">{t('notifications.empty')}</p> : null}
          <div className="app-notification-settings">
            {apps.map(([appKey, grant]) => (
              <div className="app-notification-settings__app" key={appKey}>
                <div className="app-notification-settings__identity">
                  <strong>{getAppName(appKey)}</strong>
                  <span>{t('notifications.ruleCount', { count: notificationStore?.rules[appKey]?.length ?? 0 })}</span>
                  {hasForeignPaymentRule(notificationStore, appKey) ? <span>{t('notifications.foreignPaymentPrivacy')}</span> : null}
                </div>
                <label className="app-notification-settings__mute">
                  <input
                    checked={grant.muted === true}
                    type="checkbox"
                    onChange={(event) => {
                      void setAppNotificationMuted(appKey, event.target.checked)
                        .then(setNotificationStore)
                        .catch((reason) => setNotificationError(String(reason)));
                    }}
                  />
                  {t('notifications.mute')}
                </label>
                <button
                  className="button button--danger button--compact"
                  type="button"
                  onClick={() => {
                    void revokeAppNotifications(appKey)
                      .then(setNotificationStore)
                      .catch((reason) => setNotificationError(String(reason)));
                  }}
                >
                  {t('notifications.revoke')}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
