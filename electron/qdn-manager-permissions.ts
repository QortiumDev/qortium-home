export const QDN_MANAGER_CAPABILITIES = ['bookmarks.manage', 'notifications.manage'] as const;

export type QdnManagerCapability = (typeof QDN_MANAGER_CAPABILITIES)[number];

export type QdnManagerPermissionGrant = {
  grantedAt: string;
};

export type QdnManagerPermissionStore = {
  grants: Record<string, Partial<Record<QdnManagerCapability, QdnManagerPermissionGrant>>>;
  version: 1;
};

const APP_KEY_MAX_LENGTH = 2_048;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isQdnManagerCapability(value: unknown): value is QdnManagerCapability {
  return typeof value === 'string' && (QDN_MANAGER_CAPABILITIES as readonly string[]).includes(value);
}

export function sanitizeQdnManagerAppKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('App key is required.');
  const appKey = value.trim();
  const match = /^qdn:\/\/(APP|WEBSITE)\/([^/?#]+)\/([^/?#]+)(?:[/?#]|$)/i.exec(appKey);
  if (!appKey || appKey.length > APP_KEY_MAX_LENGTH || !match) {
    throw new Error('App key must be a valid QDN APP or WEBSITE resource URL.');
  }
  return `qdn://${match[1].toUpperCase()}/${match[2]}/${match[3]}`;
}

export function createEmptyQdnManagerPermissionStore(): QdnManagerPermissionStore {
  return { version: 1, grants: {} };
}

export function sanitizeQdnManagerPermissionStore(value: unknown): QdnManagerPermissionStore {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.grants)) {
    return createEmptyQdnManagerPermissionStore();
  }

  const grants: QdnManagerPermissionStore['grants'] = {};
  for (const [rawAppKey, rawCapabilities] of Object.entries(value.grants)) {
    let appKey: string;
    try { appKey = sanitizeQdnManagerAppKey(rawAppKey); } catch { continue; }
    if (!isRecord(rawCapabilities)) continue;
    const capabilities: Partial<Record<QdnManagerCapability, QdnManagerPermissionGrant>> = {};
    for (const capability of QDN_MANAGER_CAPABILITIES) {
      const rawGrant = rawCapabilities[capability];
      if (isRecord(rawGrant) && typeof rawGrant.grantedAt === 'string' && rawGrant.grantedAt.trim()) {
        capabilities[capability] = { grantedAt: rawGrant.grantedAt };
      }
    }
    if (Object.keys(capabilities).length) grants[appKey] = { ...grants[appKey], ...capabilities };
  }
  return { version: 1, grants };
}
