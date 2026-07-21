import { useEffect, useState, type FormEvent } from 'react';
import {
  DEFAULT_BOOKMARKS_MANAGER_URL,
  QDN_APP_ROLE_CAPABILITIES,
  sanitizeQdnManagerAppKey,
  type QdnAppRole,
  type QdnAppRolesStore,
} from '../electron/qdn-manager-permissions';
import { getTranslationLanguage, t } from './i18n';
import {
  getQdnAppRolesStore,
  onQdnManagerPermissionsChanged,
  revokeQdnManagerPermission,
  setQdnAppRoleUrl,
} from './qdnManagerPermissions';
import {
  formatQdnManagerPermissionTime,
  getQdnAppRoleRows,
  getQdnManagerPermissionAppName,
  type QdnAppRoleRow,
} from './qdnManagerPermissionsPanelModel';
import { SettingsSection } from './SettingsSection';

type Props = {
  isExpanded?: boolean;
  onExpandedChange?: (isExpanded: boolean) => void;
};

function roleLabel(role: QdnAppRole) {
  return role === 'bookmarksManager' ? t('qdnApps.role.bookmarksManager') : t('qdnApps.role.notificationsManager');
}

type RoleRowProps = {
  isBusy: boolean;
  isRevoking: boolean;
  onError: (message: string) => void;
  onRevoke: () => void;
  onSave: (url: string | null) => void;
  row: QdnAppRoleRow;
};

function QdnAppRoleRowForm({ isBusy, isRevoking, onError, onRevoke, onSave, row }: RoleRowProps) {
  const [url, setUrl] = useState(row.url ?? '');
  const [error, setError] = useState('');

  useEffect(() => {
    setUrl(row.url ?? '');
    setError('');
  }, [row.url]);

  const errorId = `qdn-apps-role-error-${row.role}`;

  function save(event: FormEvent) {
    event.preventDefault();
    // Clearing the URL unassigns the role; only the Notifications Manager role
    // may be unassigned — Bookmarks Manager also drives menu routing.
    if (!url.trim() && row.role !== 'bookmarksManager') {
      setError('');
      onSave(null);
      return;
    }
    try {
      setError('');
      onSave(sanitizeQdnManagerAppKey(url));
    } catch {
      setError(t('qdnApps.invalidAddress'));
    }
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
      {row.url ? (
        <div className="qdn-apps-settings__role-identity">
          <strong>{getQdnManagerPermissionAppName(row.url)}</strong>
          <code dir="ltr" tabIndex={0}>{row.url}</code>
        </div>
      ) : null}
      <label className="field">
        <span className="field__label">{t('qdnApps.appUrl')}</span>
        <input
          aria-describedby={error ? errorId : undefined}
          className="field__input"
          dir="ltr"
          value={url}
          spellCheck={false}
          onChange={(event) => {
            setUrl(event.target.value);
            setError('');
          }}
        />
      </label>
      {error ? <p className="field__error" id={errorId} role="alert">{error}</p> : null}
      <div className="qdn-apps-settings__actions">
        <button className="button button--primary" disabled={isBusy} type="submit">{t('common.save')}</button>
        {row.role === 'bookmarksManager' ? (
          <button className="button" disabled={isBusy} type="button" onClick={() => {
            setUrl(DEFAULT_BOOKMARKS_MANAGER_URL);
            setError('');
            onSave(DEFAULT_BOOKMARKS_MANAGER_URL);
          }}>{t('qdnApps.useDefault')}</button>
        ) : null}
        {row.grantedAt && row.url ? (
          <button
            aria-label={`${t('notifications.revoke')} — ${roleLabel(row.role)} — ${getQdnManagerPermissionAppName(row.url)}`}
            className="button button--danger"
            disabled={isBusy}
            type="button"
            onClick={() => {
              onError('');
              onRevoke();
            }}
          >
            {isRevoking ? t('common.removing') : t('notifications.revoke')}
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function QdnAppsSettingsPanel({ isExpanded, onExpandedChange }: Props) {
  const [store, setStore] = useState<QdnAppRolesStore | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [busyRole, setBusyRole] = useState<'' | QdnAppRole>('');
  const [revokingRole, setRevokingRole] = useState<'' | QdnAppRole>('');

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

  function runRoleUpdate(role: QdnAppRole, update: () => Promise<QdnAppRolesStore>) {
    setError('');
    setBusyRole(role);
    void update()
      .then(setStore)
      .catch((reason) => setError(String(reason)))
      .finally(() => {
        setBusyRole('');
        setRevokingRole('');
      });
  }

  const rows = getQdnAppRoleRows(store);

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
            isRevoking={revokingRole === row.role}
            key={row.role}
            row={row}
            onError={setError}
            onRevoke={() => {
              if (!row.url) return;
              setRevokingRole(row.role);
              runRoleUpdate(row.role, () =>
                revokeQdnManagerPermission(row.url as string, QDN_APP_ROLE_CAPABILITIES[row.role]));
            }}
            onSave={(url) => runRoleUpdate(row.role, () => setQdnAppRoleUrl(row.role, url))}
          />
        ))}
      </div>
    </SettingsSection>
  );
}
