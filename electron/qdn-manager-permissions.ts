export const QDN_MANAGER_CAPABILITIES = ['bookmarks.manage', 'notifications.manage'] as const;

export type QdnManagerCapability = (typeof QDN_MANAGER_CAPABILITIES)[number];

export const QDN_APP_ROLES = ['bookmarksManager', 'notificationsManager'] as const;

export type QdnAppRole = (typeof QDN_APP_ROLES)[number];

// A role and its capability are one concept: the app holding a role is the only
// app that can be granted the matching manager capability.
export const QDN_APP_ROLE_CAPABILITIES = {
  bookmarksManager: 'bookmarks.manage',
  notificationsManager: 'notifications.manage',
} as const satisfies Record<QdnAppRole, QdnManagerCapability>;

export const DEFAULT_BOOKMARKS_MANAGER_URL = 'qdn://APP/Bookmarks/Bookmarks';

export type QdnAppRoleState = {
  // Canonical qdn://APP|WEBSITE/name/identifier app key, or null when the role
  // is unassigned. bookmarksManager is never null after sanitizing because it
  // also drives Home's bookmarks menu routing.
  url: string | null;
  // Set when the role holder has been granted the role's capability. null means
  // the app at `url` is only a routing preference and must still prompt.
  grantedAt: string | null;
};

export type QdnAppRolesStore = {
  // True once the one-time import of the legacy permission + preferred-apps
  // stores has fully completed (or was never needed). While false, the store
  // still accepts the legacy preferred-apps overlay; afterwards that endpoint
  // is a durable no-op so it cannot be replayed to move role URLs.
  legacyMigrated: boolean;
  roles: Record<QdnAppRole, QdnAppRoleState>;
  version: 1;
};

const APP_KEY_MAX_LENGTH = 2_048;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isQdnManagerCapability(value: unknown): value is QdnManagerCapability {
  return typeof value === 'string' && (QDN_MANAGER_CAPABILITIES as readonly string[]).includes(value);
}

export function isQdnAppRole(value: unknown): value is QdnAppRole {
  return typeof value === 'string' && (QDN_APP_ROLES as readonly string[]).includes(value);
}

export function getQdnAppRoleForCapability(capability: QdnManagerCapability): QdnAppRole {
  return capability === 'bookmarks.manage' ? 'bookmarksManager' : 'notificationsManager';
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

export function createDefaultQdnAppRolesStore(): QdnAppRolesStore {
  // Fresh installs have nothing to import, so migration starts completed.
  return {
    version: 1,
    legacyMigrated: true,
    roles: {
      bookmarksManager: { url: DEFAULT_BOOKMARKS_MANAGER_URL, grantedAt: null },
      notificationsManager: { url: null, grantedAt: null },
    },
  };
}

// A grant timestamp must parse to a finite instant; corrupt values clear the
// grant (fail toward fewer permissions) instead of counting as "granted".
function sanitizeGrantedAt(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

/**
 * Reads an untrusted persisted value into a valid role store. The shape itself
 * enforces at most one app per role, so stale or hand-edited data can never
 * resurrect a second capability holder; anything unreadable fails toward fewer
 * permissions (grantedAt: null) and toward the default bookmarks routing URL.
 */
export function sanitizeQdnAppRolesStore(value: unknown): QdnAppRolesStore {
  const store = createDefaultQdnAppRolesStore();
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.roles)) return store;

  // Only an explicit false keeps the one-time migration window open; anything
  // else — including a store persisted before the marker existed — counts as
  // completed, so the legacy overlay endpoint fails closed.
  store.legacyMigrated = value.legacyMigrated !== false;

  for (const role of QDN_APP_ROLES) {
    const rawRole = value.roles[role];
    if (!isRecord(rawRole)) continue;
    let url: string | null = null;
    try { url = sanitizeQdnManagerAppKey(rawRole.url); } catch { url = null; }
    if (url === null) {
      // bookmarksManager keeps its default routing URL; the grant never
      // survives without a valid holder URL.
      continue;
    }
    store.roles[role] = { url, grantedAt: sanitizeGrantedAt(rawRole.grantedAt) };
  }
  return store;
}

/** An app holds a capability iff it is the granted holder of the matching role. */
export function storeHoldsQdnManagerPermission(
  store: QdnAppRolesStore,
  appKey: string,
  capability: QdnManagerCapability,
) {
  let normalizedAppKey: string;
  try { normalizedAppKey = sanitizeQdnManagerAppKey(appKey); } catch { return false; }
  const role = store.roles[getQdnAppRoleForCapability(capability)];
  return role.url === normalizedAppKey && role.grantedAt !== null;
}

/**
 * Returns the app the prompting app would replace as the granted role holder,
 * or null when the role is unheld or already held by the prompting app.
 */
export function getQdnAppRoleReplacedHolder(
  store: QdnAppRolesStore,
  appKey: string,
  capability: QdnManagerCapability,
): string | null {
  const role = store.roles[getQdnAppRoleForCapability(capability)];
  if (role.grantedAt === null || role.url === null) return null;
  let normalizedAppKey: string;
  try { normalizedAppKey = sanitizeQdnManagerAppKey(appKey); } catch { return role.url; }
  return role.url === normalizedAppKey ? null : role.url;
}

type LegacyGrant = { appKey: string; grantedAt: string };

// Legacy store shapes replaced by the unified role store in 2026-07 ("QDN Apps"
// settings consolidation). Kept only to migrate persisted data forward.
function readLegacyManagerGrants(value: unknown): Record<QdnManagerCapability, LegacyGrant[]> {
  const grants: Record<QdnManagerCapability, LegacyGrant[]> = {
    'bookmarks.manage': [],
    'notifications.manage': [],
  };
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.grants)) return grants;
  for (const [rawAppKey, rawCapabilities] of Object.entries(value.grants)) {
    let appKey: string;
    try { appKey = sanitizeQdnManagerAppKey(rawAppKey); } catch { continue; }
    if (!isRecord(rawCapabilities)) continue;
    for (const capability of QDN_MANAGER_CAPABILITIES) {
      const rawGrant = rawCapabilities[capability];
      if (!isRecord(rawGrant)) continue;
      const grantedAt = sanitizeGrantedAt(rawGrant.grantedAt);
      if (grantedAt) grants[capability].push({ appKey, grantedAt });
    }
  }
  return grants;
}

function readLegacyPreferredBookmarksUrl(value: unknown): string | null {
  if (!isRecord(value) || value.version !== 1) return null;
  try { return sanitizeQdnManagerAppKey(value.bookmarksManager); } catch { return null; }
}

function toGrantTime(grantedAt: string) {
  const time = Date.parse(grantedAt);
  return Number.isFinite(time) ? time : 0;
}

/**
 * One-time migration from the two legacy stores (the QDN manager permission
 * grants and the Preferred apps store) into the unified role store.
 *
 * - bookmarksManager.url comes from the legacy preferred bookmarks manager
 *   (default when absent/invalid); its grant survives only when the legacy
 *   bookmarks.manage holder is that same app — other holders are dropped, so
 *   migration always fails toward fewer permissions.
 * - notificationsManager keeps the most recently granted legacy
 *   notifications.manage holder; other holders are dropped.
 */
export function migrateLegacyQdnAppStores(
  legacyPermissions: unknown,
  legacyPreferredApps: unknown,
): QdnAppRolesStore {
  const store = createDefaultQdnAppRolesStore();
  const grants = readLegacyManagerGrants(legacyPermissions);

  const bookmarksUrl = readLegacyPreferredBookmarksUrl(legacyPreferredApps) ?? DEFAULT_BOOKMARKS_MANAGER_URL;
  const bookmarksGrant = grants['bookmarks.manage'].find((grant) => grant.appKey === bookmarksUrl);
  store.roles.bookmarksManager = { url: bookmarksUrl, grantedAt: bookmarksGrant?.grantedAt ?? null };

  const notificationsGrant = grants['notifications.manage']
    .slice()
    .sort((left, right) => toGrantTime(right.grantedAt) - toGrantTime(left.grantedAt)
      || left.appKey.localeCompare(right.appKey))[0];
  if (notificationsGrant) {
    store.roles.notificationsManager = {
      url: notificationsGrant.appKey,
      grantedAt: notificationsGrant.grantedAt,
    };
  }
  return store;
}

/**
 * Desktop keeps the legacy Preferred apps store in the renderer while the
 * permission store lives in the main process, so the joint migration can run
 * before the renderer has reported its legacy preferred bookmarks URL. This
 * reconciles afterwards: it only ever moves the bookmarks routing URL off the
 * default and drops the grant (never adds one), failing toward fewer
 * permissions if a grant raced in between. Once the store is marked
 * legacyMigrated the overlay is a no-op, so it cannot be replayed later to
 * move the routing URL.
 */
export function applyLegacyPreferredBookmarksUrl(
  store: QdnAppRolesStore,
  legacyPreferredApps: unknown,
): QdnAppRolesStore {
  const legacyUrl = readLegacyPreferredBookmarksUrl(legacyPreferredApps);
  if (
    store.legacyMigrated
    || legacyUrl === null
    || legacyUrl === DEFAULT_BOOKMARKS_MANAGER_URL
    || store.roles.bookmarksManager.url !== DEFAULT_BOOKMARKS_MANAGER_URL
  ) {
    return store;
  }
  return {
    ...store,
    roles: {
      ...store.roles,
      bookmarksManager: { url: legacyUrl, grantedAt: null },
    },
  };
}

/**
 * Decides whether an IPC sender may use the role-store surface (read, assign,
 * revoke, migrate). Only the Home shell window's own webContents qualifies:
 * QDN app views are rejected explicitly (their only path to a role is the
 * grant prompt) and so is any unknown sender, regardless of preload topology.
 * Pure so the policy is unit-testable outside Electron.
 */
export function isTrustedQdnAppRolesSender(input: {
  senderId: number;
  isQdnView: boolean;
  shellWindowWebContentsIds: readonly number[];
}): boolean {
  return !input.isQdnView && input.shellWindowWebContentsIds.includes(input.senderId);
}
