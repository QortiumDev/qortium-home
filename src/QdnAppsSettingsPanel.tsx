import { useEffect, useState, type FormEvent } from 'react';
import type { QdnNotificationStore } from '../electron/notification-rules';
import { DEFAULT_NOTIFICATIONS_MANAGER_URL, type QdnAppAssignmentsStore } from '../electron/qdn-manager-permissions';
import { t } from './i18n';
import {
  getNotificationStore,
  onNotificationStoreChanged,
  revokeAppNotifications,
  setAppNotificationMuted,
} from './notificationStore';
import {
  getQdnAppRolesStore,
  onQdnManagerPermissionsChanged,
  setQdnAppAssignmentValue,
} from './qdnManagerPermissions';
import {
  getQdnAppAssignmentRoleSaveState,
  getQdnAppAssignmentRows,
  getQdnAppAssignmentSaveState,
  type QdnAppAssignmentRow,
} from './qdnManagerPermissionsPanelModel';
import { SettingsSection } from './SettingsSection';

type Props = {
  isExpanded?: boolean;
  onExpandedChange?: (isExpanded: boolean) => void;
  onOpenNotificationsManager: (url: string) => void;
};

function hasForeignPaymentRule(store: QdnNotificationStore | null, appKey: string) {
  return store?.rules[appKey]?.some((rule) => rule.event === 'FOREIGN_PAYMENT_RECEIVED') ?? false;
}

function getAppName(appKey: string) {
  const match = /^qdn:\/\/[^/]+\/([^/]+)/i.exec(appKey);
  if (!match) return appKey;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

function AssignmentRow({ isBusy, onSave, row }: {
  isBusy: boolean;
  onSave: (input: { description?: string | null; label?: string; role: string; url: string }) => void;
  row: QdnAppAssignmentRow;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setUrl(''); setError(''); }, [row.url]);
  const candidate = getQdnAppAssignmentSaveState(url, row.url);
  const errorId = `qdn-apps-assignment-error-${row.role}`;

  function save(event: FormEvent) {
    event.preventDefault();
    if (!candidate.normalized || !candidate.changed) return;
    setError('');
    onSave({ description: row.description, label: row.label, role: row.role, url: candidate.normalized });
  }

  return (
    <form aria-label={row.label} className="qdn-apps-settings__role" onSubmit={save}>
      <div className="qdn-apps-settings__role-header">
        <strong>{row.label}</strong>
        <span>{row.role}</span>
      </div>
      {row.description ? <p className="field__hint">{row.description}</p> : null}
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
            setError(nextUrl.trim() && !getQdnAppAssignmentSaveState(nextUrl, row.url).valid ? t('qdnApps.invalidAddress') : '');
          }}
        />
      </label>
      {error ? <p className="field__error" id={errorId} role="alert">{error}</p> : null}
      <div className="qdn-apps-settings__actions">
        <button className="button button--primary" disabled={isBusy || !candidate.valid || !candidate.changed} type="submit">{t('common.save')}</button>
        {row.defaultUrl ? (
          <button className="button" disabled={isBusy || row.url === row.defaultUrl} type="button" onClick={() => onSave({ description: row.description, label: row.label, role: row.role, url: row.defaultUrl as string })}>
            {t('qdnApps.useDefault')}
          </button>
        ) : null}
      </div>
    </form>
  );
}

function AddAssignmentForm({ isBusy, onSave }: {
  isBusy: boolean;
  onSave: (input: { label: string; role: string; url: string }) => void;
}) {
  const [role, setRole] = useState('');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const roleState = getQdnAppAssignmentRoleSaveState(role);
  const urlState = getQdnAppAssignmentSaveState(url, null);
  function save(event: FormEvent) {
    event.preventDefault();
    if (!roleState.normalized || !urlState.normalized) return;
    onSave({ label: label.trim() || roleState.normalized, role: roleState.normalized, url: urlState.normalized });
    setRole(''); setLabel(''); setUrl('');
  }
  return (
    <form className="qdn-apps-settings__role" onSubmit={save}>
      <div className="qdn-apps-settings__role-header"><strong>Add assignment</strong></div>
      <label className="field"><span className="field__label">Role</span><input className="field__input" dir="ltr" placeholder="media.video-player" value={role} onChange={(event) => setRole(event.target.value)} /></label>
      <label className="field"><span className="field__label">Label</span><input className="field__input" placeholder="Video player" value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      <label className="field"><span className="field__label">{t('qdnApps.appUrl')}</span><input className="field__input" dir="ltr" placeholder="qdn://APP/Explore/Explore#/service/VIDEO" spellCheck={false} value={url} onChange={(event) => setUrl(event.target.value)} /></label>
      <div className="qdn-apps-settings__actions"><button className="button button--primary" disabled={isBusy || !roleState.valid || !urlState.valid} type="submit">{t('common.save')}</button></div>
    </form>
  );
}

export function QdnAppsSettingsPanel({ isExpanded, onExpandedChange, onOpenNotificationsManager }: Props) {
  const [store, setStore] = useState<QdnAppAssignmentsStore | null>(null);
  const [notificationStore, setNotificationStore] = useState<QdnNotificationStore | null>(null);
  const [error, setError] = useState('');
  const [notificationError, setNotificationError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const unsubscribe = onQdnManagerPermissionsChanged((nextStore) => { if (active) { setError(''); setStore(nextStore); } });
    void getQdnAppRolesStore().then((nextStore) => { if (active) { setError(''); setStore(nextStore); } }).catch((reason) => { if (active) setError(String(reason)); }).finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    void getNotificationStore().then(setNotificationStore).catch((reason) => setNotificationError(String(reason)));
    return onNotificationStoreChanged(setNotificationStore);
  }, [isExpanded]);

  function saveAssignment(input: { description?: string | null; label?: string; role: string; url: string }) {
    setError(''); setIsBusy(true);
    void setQdnAppAssignmentValue(input).then(setStore).catch((reason) => setError(String(reason))).finally(() => setIsBusy(false));
  }

  const rows = getQdnAppAssignmentRows(store);
  const apps = notificationStore ? Object.entries(notificationStore.grants) : [];
  const notificationsManagerUrl = store?.assignments.notifications?.url ?? DEFAULT_NOTIFICATIONS_MANAGER_URL;

  return (
    <SettingsSection isExpanded={isExpanded} title={t('qdnApps.sectionTitle')} onExpandedChange={onExpandedChange}>
      <div className="qdn-apps-settings">
        <p className="field__hint">{t('qdnApps.description')}</p>
        {error ? <p aria-live="assertive" className="field__error" role="alert">{error}</p> : null}
        {isLoading ? <p aria-live="polite" className="field__hint">{t('common.loading')}</p> : null}
        {rows.map((row) => <AssignmentRow isBusy={isBusy} key={row.role} row={row} onSave={saveAssignment} />)}
        <AddAssignmentForm isBusy={isBusy} onSave={saveAssignment} />
        <div className="qdn-apps-settings__manager-launcher"><button className="button button--primary" type="button" onClick={() => onOpenNotificationsManager(notificationsManagerUrl)}>{t('qdnApps.openNotificationsManager')}</button></div>
        <div className="qdn-apps-settings__notification-controls">
          <h2>{t('qdnApps.notificationControlsTitle')}</h2>
          <p className="field__hint">{t('qdnApps.notificationControlsDescription')}</p>
          {notificationError ? <p className="field__error">{notificationError}</p> : null}
          {!notificationStore ? <p className="field__hint">{t('common.loading')}</p> : null}
          {notificationStore && apps.length === 0 ? <p className="field__hint">{t('notifications.empty')}</p> : null}
          <div className="app-notification-settings">{apps.map(([appKey, grant]) => <div className="app-notification-settings__app" key={appKey}><div className="app-notification-settings__identity"><strong>{getAppName(appKey)}</strong><span>{t('notifications.ruleCount', { count: notificationStore?.rules[appKey]?.length ?? 0 })}</span>{hasForeignPaymentRule(notificationStore, appKey) ? <span>{t('notifications.foreignPaymentPrivacy')}</span> : null}</div><label className="app-notification-settings__mute"><input checked={grant.muted === true} type="checkbox" onChange={(event) => { void setAppNotificationMuted(appKey, event.target.checked).then(setNotificationStore).catch((reason) => setNotificationError(String(reason))); }} />{t('notifications.mute')}</label><button className="button button--danger button--compact" type="button" onClick={() => { void revokeAppNotifications(appKey).then(setNotificationStore).catch((reason) => setNotificationError(String(reason))); }}>{t('notifications.revoke')}</button></div>)}</div>
        </div>
      </div>
    </SettingsSection>
  );
}
