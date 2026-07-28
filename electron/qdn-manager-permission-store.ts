import { app, BrowserWindow, ipcMain, type WebContents } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  applyLegacyPreferredBookmarksUrl,
  createDefaultQdnAppRolesStore,
  grantQdnAppCapability,
  isQdnAppCapability,
  migrateLegacyQdnAppStores,
  sanitizeQdnAppRolesStore,
  setQdnAppAssignment,
  storeHoldsQdnAppCapability,
  storeHoldsQdnManagerPermission,
  type QdnAppRolesStore,
  type QdnAppCapability,
  type QdnManagerCapability,
} from './qdn-manager-permissions.js';
import { assertShellWindowSender as assertShellSender } from './shell-window-sender.js';

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
    if (!window.isDestroyed()) window.webContents.send('qdn:app-assignments-changed');
  });
  return cachedStore;
}

export function readQdnAppRolesStore() {
  if (cachedStore) return cachedStore;
  const storePath = getStorePath();
  if (existsSync(storePath)) {
    return (cachedStore = sanitizeQdnAppRolesStore(readJsonFile(storePath)));
  }

// First load on this profile imports the legacy assignment target. The legacy
// file remains until the renderer reports its former Preferred-apps value, so
// that value can still replace the default bookmarks target. Old role-bound
// grants intentionally are not widened into independent v2 capabilities.
  const legacyStorePath = getLegacyStorePath();
  if (!existsSync(legacyStorePath)) return (cachedStore = createDefaultQdnAppRolesStore());
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
 * endpoint cannot be replayed later to move assignment URLs. While still
 * pending, the legacy permission file is removed once the joint result is
 * known; if the store changed between the first read and this call, the
 * overlay only moves the bookmarks target and never creates a capability.
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

export function hasQdnAppCapability(appKey: string, capability: QdnAppCapability) {
  return storeHoldsQdnAppCapability(readQdnAppRolesStore(), appKey, capability);
}

/**
 * Records user consent for `appKey` to hold one independent capability.
 */
export function grantQdnManagerPermission(appKey: string, capability: QdnManagerCapability) {
  return writeStore(grantQdnAppCapability(readQdnAppRolesStore(), appKey, capability));
}

export function grantQdnAppCapabilityPermission(appKey: string, capability: QdnAppCapability) {
  if (!isQdnAppCapability(capability)) throw new Error('QDN app capability is invalid.');
  return writeStore(grantQdnAppCapability(readQdnAppRolesStore(), appKey, capability));
}

/**
 * Settings only selects the app for a role. The selected app must still use
 * the normal approval dialog before it receives the matching capability.
 */
export function setQdnAppAssignmentValue(input: { description?: unknown; label?: unknown; role: unknown; url: unknown }) {
  return writeStore(setQdnAppAssignment(readQdnAppRolesStore(), input));
}

// The whole assignment-store surface is for Home's own settings/shell UI.
// Assignment changes a device-local preference, so
// preload topology must not be the only barrier: require the sender to be a
// Home shell window's webContents and explicitly reject QDN app views.
function assertShellWindowSender(sender: WebContents) {
  assertShellSender(sender, 'QDN app role requests are only accepted from a Home window.');
}

export function registerQdnManagerPermissionStoreIpcHandlers() {
  ipcMain.handle('qdn:getAppAssignmentsStore', (event) => {
    assertShellWindowSender(event.sender);
    return readQdnAppRolesStore();
  });
  ipcMain.handle('qdn:setAppAssignment', (event, input: unknown) => {
    assertShellWindowSender(event.sender);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('QDN app assignment is invalid.');
    return setQdnAppAssignmentValue(input as { description?: unknown; label?: unknown; role: unknown; url: unknown });
  });
  ipcMain.handle('qdn:migrateLegacyPreferredApps', (event, legacyPreferredApps: unknown) => {
    assertShellWindowSender(event.sender);
    return migrateLegacyPreferredApps(legacyPreferredApps);
  });
}
