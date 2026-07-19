import {
  QDN_MANAGER_CAPABILITIES,
  type QdnManagerCapability,
  type QdnManagerPermissionStore,
} from '../electron/qdn-manager-permissions';

export type QdnManagerPermissionRow = {
  appKey: string;
  capability: QdnManagerCapability;
  grantedAt: string;
};

export function getQdnManagerPermissionRows(store: QdnManagerPermissionStore | null): QdnManagerPermissionRow[] {
  if (!store) return [];

  return Object.entries(store.grants)
    .flatMap(([appKey, capabilities]) => QDN_MANAGER_CAPABILITIES.flatMap((capability) => {
      const grant = capabilities[capability];
      return grant ? [{ appKey, capability, grantedAt: grant.grantedAt }] : [];
    }))
    .sort((left, right) => left.appKey.localeCompare(right.appKey)
      || left.capability.localeCompare(right.capability));
}

export function getQdnManagerPermissionAppName(appKey: string) {
  const match = /^qdn:\/\/[^/]+\/([^/]+)/i.exec(appKey);
  if (!match) return appKey;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

export function formatQdnManagerPermissionTime(value: string, locales?: Intl.LocalesArgument) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(locales, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
