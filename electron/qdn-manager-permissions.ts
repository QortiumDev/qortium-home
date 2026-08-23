/**
 * User-owned QDN app assignments and durable, app-scoped capabilities.
 *
 * An assignment is only a launch/routing preference. It never grants an app
 * access to Home data. Capabilities are granted separately to the stable QDN
 * resource identity that requested them.
 */
export const QDN_MANAGER_CAPABILITIES = ['bookmarks.manage', 'notifications.manage'] as const;
export const QDN_APP_ASSIGNMENT_CAPABILITIES = ['assignments.read'] as const;
export const QDN_APP_CAPABILITIES = [...QDN_MANAGER_CAPABILITIES, ...QDN_APP_ASSIGNMENT_CAPABILITIES] as const;

export type QdnManagerCapability = (typeof QDN_MANAGER_CAPABILITIES)[number];
export type QdnAppCapability = (typeof QDN_APP_CAPABILITIES)[number];

export const DEFAULT_BOOKMARKS_MANAGER_URL = 'qdn://APP/Bookmarks/Bookmarks';
export const DEFAULT_NOTIFICATIONS_MANAGER_URL = 'qdn://APP/Notify/Notify';
export const DEFAULT_EXPLORE_APP_URL = 'qdn://APP/Explore/Explore';

export const QDN_DEFAULT_APP_ASSIGNMENTS = {
  bookmarks: { description: 'App used when Home opens bookmarks.', label: 'Bookmarks', url: DEFAULT_BOOKMARKS_MANAGER_URL },
  notifications: { description: 'App used to manage Home notifications.', label: 'Notifications', url: DEFAULT_NOTIFICATIONS_MANAGER_URL },
  explore: { description: 'App used when Home opens QDN Explore.', label: 'Explore', url: DEFAULT_EXPLORE_APP_URL },
} as const;

export type QdnAppAssignment = {
  description: string | null;
  label: string;
  // The full QDN URL is preserved, including a path, query, and fragment.
  url: string | null;
};

export type QdnAppAssignmentsStore = {
  assignments: Record<string, QdnAppAssignment>;
  capabilityGrants: Record<string, Partial<Record<QdnAppCapability, { grantedAt: string }>>>;
  // Kept for the one-time import from the pre-assignments stores.
  legacyMigrated: boolean;
  revision: number;
  version: 2;
};

// Kept as a type alias while renderer/desktop migration call sites move to the
// generic name. It intentionally no longer has a fixed `roles` record.
export type QdnAppRolesStore = QdnAppAssignmentsStore;

const APP_KEY_MAX_LENGTH = 2_048;
const ROLE_ID_MAX_LENGTH = 120;
const ROLE_LABEL_MAX_LENGTH = 80;
const ROLE_DESCRIPTION_MAX_LENGTH = 280;
const QDN_TARGET_PATTERN = /^qdn:\/\/(APP|WEBSITE)\/([^/?#]+)(?:\/([^/?#]+))?((?:\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?)$/i;
const ROLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/;
const MAX_ASSIGNMENTS = 100;
const UNSAFE_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeText(value: unknown, maxLength: number, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} is required.`);
  const text = value.trim();
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new Error(`${field} is invalid.`);
  }
  return text;
}

export function sanitizeQdnAppAssignmentRole(value: unknown): string {
  const role = sanitizeText(value, ROLE_ID_MAX_LENGTH, 'Assignment role').toLowerCase();
  if (!ROLE_ID_PATTERN.test(role) || UNSAFE_RECORD_KEYS.has(role)) {
    throw new Error('Assignment role must be a stable lowercase identifier.');
  }
  return role;
}

export function sanitizeQdnAppAssignmentLabel(value: unknown, role: string): string {
  if (typeof value === 'undefined' || value === null || value === '') return role;
  return sanitizeText(value, ROLE_LABEL_MAX_LENGTH, 'Assignment label');
}

export function sanitizeQdnAppAssignmentDescription(value: unknown): string | null {
  if (typeof value === 'undefined' || value === null || value === '') return null;
  return sanitizeText(value, ROLE_DESCRIPTION_MAX_LENGTH, 'Assignment description');
}

/** Validates a complete APP/WEBSITE URL without discarding its app route. */
export function sanitizeQdnAppAssignmentUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Assignment URL is required.');
  const url = value.trim();
  const match = QDN_TARGET_PATTERN.exec(url);
  if (!url || url.length > APP_KEY_MAX_LENGTH || /[\u0000-\u001f\u007f\s]/.test(url) || !match) {
    throw new Error('Assignment URL must be a valid QDN APP or WEBSITE resource URL.');
  }
  return `qdn://${match[1].toUpperCase()}/${match[2]}${match[3] ? `/${match[3]}` : ''}${match[4]}`;
}

/** Stable app identity for capability grants; intentionally omits app routing. */
export function sanitizeQdnManagerAppKey(value: unknown): string {
  const target = sanitizeQdnAppAssignmentUrl(value);
  const match = QDN_TARGET_PATTERN.exec(target);
  if (!match) throw new Error('App key must be a valid QDN APP or WEBSITE resource URL.');
  return `qdn://${match[1].toUpperCase()}/${match[2]}${match[3] ? `/${match[3]}` : ''}`;
}

export function isQdnAppCapability(value: unknown): value is QdnAppCapability {
  return typeof value === 'string' && (QDN_APP_CAPABILITIES as readonly string[]).includes(value);
}

export function isQdnManagerCapability(value: unknown): value is QdnManagerCapability {
  return typeof value === 'string' && (QDN_MANAGER_CAPABILITIES as readonly string[]).includes(value);
}

function defaultAssignments(): Record<string, QdnAppAssignment> {
  return Object.fromEntries(Object.entries(QDN_DEFAULT_APP_ASSIGNMENTS).map(([role, assignment]) => [role, {
    description: assignment.description,
    label: assignment.label,
    url: assignment.url,
  }]));
}

export function createDefaultQdnAppRolesStore(): QdnAppAssignmentsStore {
  return {
    assignments: defaultAssignments(),
    capabilityGrants: {},
    legacyMigrated: true,
    revision: 0,
    version: 2,
  };
}

function sanitizeGrantedAt(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function sanitizeAssignment(role: string, value: unknown, fallback?: QdnAppAssignment): QdnAppAssignment | null {
  if (!isRecord(value)) return fallback ?? null;
  const label = sanitizeQdnAppAssignmentLabel(value.label, role);
  const description = sanitizeQdnAppAssignmentDescription(value.description);
  if (value.url === null) return { description, label, url: null };
  try {
    return { description, label, url: sanitizeQdnAppAssignmentUrl(value.url) };
  } catch {
    return fallback ?? null;
  }
}

function sanitizeCapabilityGrants(value: unknown) {
  const grants: QdnAppAssignmentsStore['capabilityGrants'] = {};
  if (!isRecord(value)) return grants;
  for (const [rawAppKey, rawCapabilities] of Object.entries(value)) {
    let appKey: string;
    try { appKey = sanitizeQdnManagerAppKey(rawAppKey); } catch { continue; }
    if (!isRecord(rawCapabilities)) continue;
    const safeCapabilities: Partial<Record<QdnAppCapability, { grantedAt: string }>> = {};
    for (const capability of QDN_APP_CAPABILITIES) {
      const rawGrant = rawCapabilities[capability];
      const grantedAt = isRecord(rawGrant) ? sanitizeGrantedAt(rawGrant.grantedAt) : null;
      if (grantedAt) safeCapabilities[capability] = { grantedAt };
    }
    if (Object.keys(safeCapabilities).length) grants[appKey] = safeCapabilities;
  }
  return grants;
}

function migrateVersionOneStore(value: Record<string, unknown>): QdnAppAssignmentsStore {
  const store = createDefaultQdnAppRolesStore();
  store.legacyMigrated = value.legacyMigrated !== false;
  if (!isRecord(value.roles)) return store;
  const legacyRoles: Array<[string, QdnManagerCapability, string]> = [
    ['bookmarksManager', 'bookmarks.manage', 'bookmarks'],
    ['notificationsManager', 'notifications.manage', 'notifications'],
  ];
  for (const [legacyRole, capability, role] of legacyRoles) {
    const rawRole = value.roles[legacyRole];
    if (!isRecord(rawRole)) continue;
    if (rawRole.url === null) {
      const existing = store.assignments[role];
      store.assignments[role] = { ...existing, url: null };
      continue;
    }
    let url: string;
    try { url = sanitizeQdnAppAssignmentUrl(rawRole.url); } catch { continue; }
    const existing = store.assignments[role];
    store.assignments[role] = { ...existing, url };
    // v1 tied a grant to being the current role holder. That guarantee no
    // longer exists in v2, so do not silently widen an old appointment into a
    // durable independent capability. The app can ask the user again.
    void capability;
  }
  return store;
}

/** Reads untrusted persisted data, including the old fixed-manager v1 store. */
export function sanitizeQdnAppRolesStore(value: unknown): QdnAppAssignmentsStore {
  if (!isRecord(value)) return createDefaultQdnAppRolesStore();
  if (value.version === 1) return migrateVersionOneStore(value);
  if (value.version !== 2 || !isRecord(value.assignments)) return createDefaultQdnAppRolesStore();

  const store = createDefaultQdnAppRolesStore();
  store.legacyMigrated = value.legacyMigrated !== false;
  store.revision = Number.isSafeInteger(value.revision) && (value.revision as number) >= 0 ? value.revision as number : 0;
  for (const [rawRole, rawAssignment] of Object.entries(value.assignments).slice(0, MAX_ASSIGNMENTS)) {
    let role: string;
    try { role = sanitizeQdnAppAssignmentRole(rawRole); } catch { continue; }
    const assignment = sanitizeAssignment(role, rawAssignment, store.assignments[role]);
    if (assignment) store.assignments[role] = assignment;
  }
  store.capabilityGrants = sanitizeCapabilityGrants(value.capabilityGrants);
  return store;
}

export function getQdnAppAssignment(store: QdnAppAssignmentsStore, role: string): QdnAppAssignment | null {
  try { return store.assignments[sanitizeQdnAppAssignmentRole(role)] ?? null; } catch { return null; }
}

export function setQdnAppAssignment(
  store: QdnAppAssignmentsStore,
  input: { description?: unknown; label?: unknown; role: unknown; url: unknown },
) {
  const role = sanitizeQdnAppAssignmentRole(input.role);
  const current = store.assignments[role];
  if (!current && Object.keys(store.assignments).length >= MAX_ASSIGNMENTS) {
    throw new Error(`Home supports at most ${MAX_ASSIGNMENTS} app assignments.`);
  }
  const next: QdnAppAssignment = {
    description: sanitizeQdnAppAssignmentDescription(input.description ?? current?.description),
    label: sanitizeQdnAppAssignmentLabel(input.label ?? current?.label, role),
    url: sanitizeQdnAppAssignmentUrl(input.url),
  };
  if (JSON.stringify(current) === JSON.stringify(next)) return store;
  return {
    ...store,
    assignments: { ...store.assignments, [role]: next },
    revision: store.revision + 1,
  } satisfies QdnAppAssignmentsStore;
}

export function clearQdnAppAssignment(store: QdnAppAssignmentsStore, roleValue: unknown) {
  const role = sanitizeQdnAppAssignmentRole(roleValue);
  const current = store.assignments[role];
  if (!current || current.url === null) return store;
  return {
    ...store,
    assignments: { ...store.assignments, [role]: { ...current, url: null } },
    revision: store.revision + 1,
  } satisfies QdnAppAssignmentsStore;
}

export function storeHoldsQdnAppCapability(store: QdnAppAssignmentsStore, appKeyValue: unknown, capability: QdnAppCapability) {
  let appKey: string;
  try { appKey = sanitizeQdnManagerAppKey(appKeyValue); } catch { return false; }
  return !!store.capabilityGrants[appKey]?.[capability];
}

export function storeHoldsQdnManagerPermission(store: QdnAppAssignmentsStore, appKey: string, capability: QdnManagerCapability) {
  return storeHoldsQdnAppCapability(store, appKey, capability);
}

export function grantQdnAppCapability(store: QdnAppAssignmentsStore, appKeyValue: unknown, capability: QdnAppCapability) {
  const appKey = sanitizeQdnManagerAppKey(appKeyValue);
  if (storeHoldsQdnAppCapability(store, appKey, capability)) return store;
  return {
    ...store,
    capabilityGrants: {
      ...store.capabilityGrants,
      [appKey]: { ...(store.capabilityGrants[appKey] ?? {}), [capability]: { grantedAt: new Date().toISOString() } },
    },
    revision: store.revision + 1,
  } satisfies QdnAppAssignmentsStore;
}

export function revokeQdnAppCapability(store: QdnAppAssignmentsStore, appKeyValue: unknown, capability: QdnAppCapability) {
  const appKey = sanitizeQdnManagerAppKey(appKeyValue);
  if (!storeHoldsQdnAppCapability(store, appKey, capability)) return store;
  const nextCapabilities = { ...store.capabilityGrants[appKey] };
  delete nextCapabilities[capability];
  const capabilityGrants = { ...store.capabilityGrants };
  if (Object.keys(nextCapabilities).length) capabilityGrants[appKey] = nextCapabilities;
  else delete capabilityGrants[appKey];
  return {
    ...store,
    capabilityGrants,
    revision: store.revision + 1,
  } satisfies QdnAppAssignmentsStore;
}

// Legacy stores predate the generic v2 schema. Preserve the chosen bookmarks
// target, but intentionally do not carry over manager grants: v1 grants were
// appointments tied to one role, whereas v2 capabilities are independent.
export function migrateLegacyQdnAppStores(legacyPermissions: unknown, legacyPreferredApps: unknown): QdnAppAssignmentsStore {
  let next = createDefaultQdnAppRolesStore();
  const preferred = isRecord(legacyPreferredApps) ? legacyPreferredApps.bookmarksManager : undefined;
  if (typeof preferred === 'string') {
    try { next = setQdnAppAssignment(next, { role: 'bookmarks', url: preferred }); } catch { /* default */ }
  }
  void legacyPermissions;
  return next;
}

// The former renderer-side preferred-bookmarks migration remains a harmless
// compatibility seam; it now changes only the bookmarks assignment.
export function applyLegacyPreferredBookmarksUrl(store: QdnAppAssignmentsStore, legacyPreferredApps: unknown) {
  if (store.legacyMigrated || !isRecord(legacyPreferredApps)) return store;
  try { return setQdnAppAssignment(store, { role: 'bookmarks', url: legacyPreferredApps.bookmarksManager }); }
  catch { return store; }
}

export function isTrustedQdnAppRolesSender(input: {
  senderId: number;
  isQdnView: boolean;
  shellWindowWebContentsIds: readonly number[];
}): boolean {
  return !input.isQdnView && input.shellWindowWebContentsIds.includes(input.senderId);
}
