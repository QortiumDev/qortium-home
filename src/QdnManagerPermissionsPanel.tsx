import { useEffect, useState } from 'react';
import type { QdnManagerCapability, QdnManagerPermissionStore } from '../electron/qdn-manager-permissions';
import { getTranslationLanguage, t } from './i18n';
import {
  getQdnManagerPermissionStore,
  onQdnManagerPermissionsChanged,
  revokeQdnManagerPermission,
} from './qdnManagerPermissions';
import {
  formatQdnManagerPermissionTime,
  getQdnManagerPermissionAppName,
  getQdnManagerPermissionRows,
} from './qdnManagerPermissionsPanelModel';
import { SettingsSection } from './SettingsSection';

type Props = {
  isExpanded?: boolean;
  onExpandedChange?: (isExpanded: boolean) => void;
};

function capabilityLabel(capability: QdnManagerCapability) {
  return capability === 'bookmarks.manage'
    ? t('managerPermissions.action.bookmarks')
    : t('managerPermissions.action.notifications');
}

function permissionKey(appKey: string, capability: QdnManagerCapability) {
  return `${appKey}\u0000${capability}`;
}

export function QdnManagerPermissionsPanel({ isExpanded, onExpandedChange }: Props) {
  const [store, setStore] = useState<QdnManagerPermissionStore | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [revoking, setRevoking] = useState('');

  useEffect(() => {
    let active = true;
    const unsubscribe = onQdnManagerPermissionsChanged((nextStore) => {
      if (active) {
        setError('');
        setStore(nextStore);
      }
    });
    void getQdnManagerPermissionStore()
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

  const rows = getQdnManagerPermissionRows(store);

  return (
    <SettingsSection
      isExpanded={isExpanded}
      title={t('managerPermissions.sectionTitle')}
      onExpandedChange={onExpandedChange}
    >
      <div className="qdn-manager-permissions">
        <p className="field__hint">{t('managerPermissions.description')}</p>
        {error ? <p aria-live="assertive" className="field__error" role="alert">{error}</p> : null}
        {isLoading ? <p aria-live="polite" className="field__hint">{t('common.loading')}</p> : null}
        {!isLoading && !error && store && rows.length === 0
          ? <p className="field__hint">{t('managerPermissions.empty')}</p>
          : null}
        {rows.map((row) => {
          const key = permissionKey(row.appKey, row.capability);
          const isRevoking = revoking === key;
          return (
            <div className="qdn-manager-permissions__grant" key={key}>
              <div className="qdn-manager-permissions__identity">
                <strong>{getQdnManagerPermissionAppName(row.appKey)}</strong>
                <code dir="ltr" tabIndex={0}>{row.appKey}</code>
              </div>
              <div className="qdn-manager-permissions__details">
                <strong>{capabilityLabel(row.capability)}</strong>
                <time dateTime={row.grantedAt}>{t('managerPermissions.grantedAt', {
                  date: formatQdnManagerPermissionTime(row.grantedAt, getTranslationLanguage()),
                })}</time>
              </div>
              <button
                aria-label={`${t('notifications.revoke')} ${capabilityLabel(row.capability)} — ${getQdnManagerPermissionAppName(row.appKey)}`}
                className="button button--danger button--compact"
                disabled={!!revoking}
                type="button"
                onClick={() => {
                  setError('');
                  setRevoking(key);
                  void revokeQdnManagerPermission(row.appKey, row.capability)
                    .then(setStore)
                    .catch((reason) => setError(String(reason)))
                    .finally(() => setRevoking(''));
                }}
              >
                {isRevoking ? t('common.removing') : t('notifications.revoke')}
              </button>
            </div>
          );
        })}
      </div>
    </SettingsSection>
  );
}
