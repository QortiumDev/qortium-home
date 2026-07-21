import {
  QDN_APP_ROLES,
  type QdnAppRole,
  type QdnAppRolesStore,
} from '../electron/qdn-manager-permissions';

export type QdnAppRoleRow = {
  role: QdnAppRole;
  url: string | null;
  grantedAt: string | null;
};

/** One row per role, in the fixed role order — unassigned roles still get a row. */
export function getQdnAppRoleRows(store: QdnAppRolesStore | null): QdnAppRoleRow[] {
  if (!store) return [];
  return QDN_APP_ROLES.map((role) => ({
    role,
    url: store.roles[role].url,
    grantedAt: store.roles[role].grantedAt,
  }));
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
