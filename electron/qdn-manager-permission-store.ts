import { app, BrowserWindow, ipcMain, type WebContents } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  applyLegacyPreferredBookmarksUrl,
  getQdnAppRoleForCapability,
  isQdnAppRole,
  isTrustedQdnAppRolesSender,
  migrateLegacyQdnAppStores,
  sanitizeQdnAppRolesStore,
  sanitizeQdnManagerAppKey,
  storeHoldsQdnManagerPermission,
  type QdnAppRole,
  type QdnAppRolesStore,
  type QdnManagerCapability,
} from './qdn-manager-permissions.js';
import { getQdnViewContextForWebContents } from './qdn-views.js';

const STORE_FILE = 'qdn-app-roles.json';
const LEGACY_STORE_FILE = 'qdn-manager-permissions.json';
let cachedStore: QdnAppRolesStore | null = null;

function getStorePath() {
  return path.join(app.getPath('userData'), STORE_FILE);
}

function getLegacyStorePath() {
  return path.join(app.getPath('userData'), LEGACY_STORE_FILE);
}

function readJsonFile(filePath: string): unknown {
  try { return JSON.parse(readFileSync(filePath, 'utf8')); }
  catch (error) {
    console.warn(`Unable to read ${path.basename(filePath)}.`, error);
    return null;
  }
}

function writeStore(store: QdnAppRolesStore) {
  cachedStore = sanitizeQdnAppRolesStore(store);
  const storePath = getStorePath();
  mkdirSync(path.dirname(storePath), { recursive: true });
  writeFileSync(storePath, `${JSON.stringify(cachedStore, null, 2)}\n`, 'utf8');
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) window.webContents.send('qdn:app-roles-changed');
  });
  return cachedStore;
}

export function readQdnAppRolesStore() {
  if (cachedStore) return cachedStore;
  const storePath = getStorePath();
  if (existsSync(storePath)) {
    return (cachedStore = sanitizeQdnAppRolesStore(readJsonFile(storePath)));
  }

  // First load on this profile: migrate the legacy permission store, assuming
  // the default bookmarks URL for now. The legacy file is kept on disk and the
  // store stays marked legacyMigrated: false until the renderer reports its
  // legacy Preferred apps store (which lives in the renderer on desktop) via
  // migrateLegacyPreferredApps, so the joint migration can still preserve a
  // matching legacy bookmarks grant. With no legacy file there is nothing to
  // import and migration starts (and durably stays) completed.
  const legacyStorePath = getLegacyStorePath();
  if (!existsSync(legacyStorePath)) return (cachedStore = migrateLegacyQdnAppStores(null, null));
  const migrated = migrateLegacyQdnAppStores(readJsonFile(legacyStorePath), null);
  migrated.legacyMigrated = false;
  return writeStore(migrated);
}

function removeLegacyStoreFile(legacyStorePath: string) {
  try { rmSync(legacyStorePath); }
  catch (error) { console.warn('Unable to remove legacy QDN manager permission store.', error); }
}

/**
 * Completes the migration with the renderer-held legacy Preferred apps value.
 * Once the store carries legacyMigrated: true this is a durable no-op, so the
 * endpoint cannot be replayed later to move role URLs or drop grants. While
 * still pending, the legacy permission file is removed once the joint result
 * is known; if the role store changed between the first read and this call,
 * the overlay only moves the bookmarks routing URL and drops the grant — it
 * never adds one, failing toward fewer permissions.
 */
export function migrateLegacyPreferredApps(legacyPreferredApps: unknown) {
  const store = readQdnAppRolesStore();
  if (store.legacyMigrated) return store;
  const legacyStorePath = getLegacyStorePath();
  let next: QdnAppRolesStore;
  if (existsSync(legacyStorePath)) {
    const legacyPermissions = readJsonFile(legacyStorePath);
    const firstPass = migrateLegacyQdnAppStores(legacyPermissions, null);
    firstPass.legacyMigrated = false;
    const isUntouchedSinceMigration = JSON.stringify(store) === JSON.stringify(firstPass);
    next = isUntouchedSinceMigration
      ? migrateLegacyQdnAppStores(legacyPermissions, legacyPreferredApps)
      : applyLegacyPreferredBookmarksUrl(store, legacyPreferredApps);
  } else {
    next = applyLegacyPreferredBookmarksUrl(store, legacyPreferredApps);
  }
  const migrated = writeStore({ ...next, legacyMigrated: true });
  if (existsSync(legacyStorePath)) removeLegacyStoreFile(legacyStorePath);
  return migrated;
}

export function hasQdnManagerPermission(appKey: string, capability: QdnManagerCapability) {
  return storeHoldsQdnManagerPermission(readQdnAppRolesStore(), appKey, capability);
}

/**
 * Records user consent for `appKey` to hold the capability's role. By
 * construction this also makes it the role's app, replacing any previous
 * holder — a role is held by at most one app.
 */
export function grantQdnManagerPermission(appKey: string, capability: QdnManagerCapability) {
  const normalizedAppKey = sanitizeQdnManagerAppKey(appKey);
  const store = readQdnAppRolesStore();
  store.roles[getQdnAppRoleForCapability(capability)] = {
    url: normalizedAppKey,
    grantedAt: new Date().toISOString(),
  };
  return writeStore(store);
}

/** Clears the grant only; the role URL (routing preference) is untouched. */
export function revokeQdnManagerPermission(appKey: string, capability: QdnManagerCapability) {
  const normalizedAppKey = sanitizeQdnManagerAppKey(appKey);
  const store = readQdnAppRolesStore();
  const role = getQdnAppRoleForCapability(capability);
  if (store.roles[role].url !== normalizedAppKey) return store;
  store.roles[role] = { ...store.roles[role], grantedAt: null };
  return writeStore(store);
}

/**
 * Sets a role's app from the Settings UI. Typing or choosing a URL there is
 * explicit consent, so the new app is granted immediately; clearing the URL
 * (notificationsManager only) unassigns the role.
 */
export function setQdnAppRoleUrl(role: QdnAppRole, url: string | null) {
  const store = readQdnAppRolesStore();
  if (url === null) {
    if (role === 'bookmarksManager') throw new Error('Bookmarks Manager requires an app URL.');
    store.roles[role] = { url: null, grantedAt: null };
  } else {
    store.roles[role] = { url: sanitizeQdnManagerAppKey(url), grantedAt: new Date().toISOString() };
  }
  return writeStore(store);
}

export function revokeQdnAppRole(role: QdnAppRole) {
  const store = readQdnAppRolesStore();
  store.roles[role] = { ...store.roles[role], grantedAt: null };
  return writeStore(store);
}

function assertQdnAppRole(role: unknown): QdnAppRole {
  if (!isQdnAppRole(role)) throw new Error('QDN app role is invalid.');
  return role;
}

// The whole role-store surface (read included — it names granted apps) is for
// Home's own settings/shell UI. setAppRoleUrl is grant-capable, so preload
// topology must not be the only barrier: require the sender to be a Home shell
// window's webContents and explicitly reject QDN app views and anything else.
function assertShellWindowSender(sender: WebContents) {
  const trusted = isTrustedQdnAppRolesSender({
    senderId: sender.id,
    isQdnView: getQdnViewContextForWebContents(sender) !== null,
    shellWindowWebContentsIds: BrowserWindow.getAllWindows()
      .filter((window) => !window.isDestroyed())
      .map((window) => window.webContents.id),
  });
  if (!trusted) throw new Error('QDN app role requests are only accepted from a Home window.');
}

export function registerQdnManagerPermissionStoreIpcHandlers() {
  ipcMain.handle('qdn:getAppRolesStore', (event) => {
    assertShellWindowSender(event.sender);
    return readQdnAppRolesStore();
  });
  ipcMain.handle('qdn:setAppRoleUrl', (event, role: unknown, url: unknown) => {
    assertShellWindowSender(event.sender);
    if (url !== null && typeof url !== 'string') throw new Error('QDN app role URL is invalid.');
    return setQdnAppRoleUrl(assertQdnAppRole(role), url);
  });
  ipcMain.handle('qdn:revokeAppRole', (event, role: unknown) => {
    assertShellWindowSender(event.sender);
    return revokeQdnAppRole(assertQdnAppRole(role));
  });
  ipcMain.handle('qdn:migrateLegacyPreferredApps', (event, legacyPreferredApps: unknown) => {
    assertShellWindowSender(event.sender);
    return migrateLegacyPreferredApps(legacyPreferredApps);
  });
}
