import { useEffect, useState } from 'react';
import type { QdnNotificationStore } from '../electron/notification-rules';
import { t } from './i18n';
import {
  getNotificationStore,
  onNotificationStoreChanged,
  revokeAppNotifications,
  setAppNotificationMuted,
} from './notificationStore';
import { SettingsSection } from './SettingsSection';

type Props = {
  isExpanded: boolean;
  onExpandedChange: (isExpanded: boolean) => void;
};

function getAppName(appKey: string) {
  const match = /^qdn:\/\/[^/]+\/([^/]+)/i.exec(appKey);
  if (!match) return appKey;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

function hasForeignPaymentRule(store: QdnNotificationStore | null, appKey: string) {
  return store?.rules[appKey]?.some((rule) => rule.event === 'FOREIGN_PAYMENT_RECEIVED') ?? false;
}

export function AppNotificationsSettingsPanel({ isExpanded, onExpandedChange }: Props) {
  const [store, setStore] = useState<QdnNotificationStore | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void getNotificationStore().then(setStore).catch((reason) => setError(String(reason)));
    return onNotificationStoreChanged(setStore);
  }, [isExpanded]);

  const apps = store ? Object.entries(store.grants) : [];

  return (
    <SettingsSection
      isExpanded={isExpanded}
      summary={t('notifications.summary', { count: apps.length })}
      title={t('notifications.sectionTitle')}
      onExpandedChange={onExpandedChange}
    >
      <div className="app-notification-settings">
        {error ? <p className="field__error">{error}</p> : null}
        {!store ? <p className="field__hint">{t('common.loading')}</p> : null}
        {store && apps.length === 0 ? <p className="field__hint">{t('notifications.empty')}</p> : null}
        {apps.map(([appKey, grant]) => (
          <div className="app-notification-settings__app" key={appKey}>
            <div className="app-notification-settings__identity">
              <strong>{getAppName(appKey)}</strong>
              <span>{t('notifications.ruleCount', { count: store?.rules[appKey]?.length ?? 0 })}</span>
              {hasForeignPaymentRule(store, appKey) ? <span>{t('notifications.foreignPaymentPrivacy')}</span> : null}
            </div>
            <label className="app-notification-settings__mute">
              <input
                checked={grant.muted === true}
                type="checkbox"
                onChange={(event) => {
                  void setAppNotificationMuted(appKey, event.target.checked).then(setStore).catch((reason) => setError(String(reason)));
                }}
              />
              {t('notifications.mute')}
            </label>
            <button
              className="button button--danger button--compact"
              type="button"
              onClick={() => {
                void revokeAppNotifications(appKey).then(setStore).catch((reason) => setError(String(reason)));
              }}
            >
              {t('notifications.revoke')}
            </button>
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}
