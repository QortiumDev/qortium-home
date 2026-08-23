import { app, BrowserWindow, ipcMain, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  applyLegacyPreferredBookmarksUrl,
  createDefaultQdnAppRolesStore,
  grantQdnAppCapability,
  isQdnAppCapability,
  migrateLegacyQdnAppStores,
  sanitizeQdnAppAssignmentRole,
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
const STORE_MAX_BYTES = 4 * 1024 * 1024;
const assignmentListeners = new Set<() => void>();
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

function isMissingFileError(error: unknown) {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT';
}

function assertSafeStoreEndpoint(storePath: string) {
  try {
    const endpoint = lstatSync(storePath);
    if (endpoint.isSymbolicLink() || !endpoint.isFile()) {
      throw Object.assign(new Error('QDN app settings are unavailable.'), {
        code: 'HOME_QDN_APP_STORE_UNAVAILABLE',
      });
    }
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
}

function writeStoreAtomically(storePath: string, body: string) {
  const storeDirectory = path.dirname(storePath);
  mkdirSync(storeDirectory, { recursive: true, mode: 0o700 });
  const directoryEndpoint = lstatSync(storeDirectory);
  if (!directoryEndpoint.isDirectory() || directoryEndpoint.isSymbolicLink()) {
    throw Object.assign(new Error('QDN app settings are unavailable.'), {
      code: 'HOME_QDN_APP_STORE_UNAVAILABLE',
    });
  }
  assertSafeStoreEndpoint(storePath);
  const temporaryPath = path.join(
    storeDirectory,
    `.${STORE_FILE}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor: number | null = null;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    writeFileSync(descriptor, body, 'utf8');
    if (process.platform !== 'win32') fchmodSync(descriptor, 0o600);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    assertSafeStoreEndpoint(storePath);
    renameSync(temporaryPath, storePath);
    if (process.platform !== 'win32') chmodSync(storePath, 0o600);
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporaryPath)) {
      try { unlinkSync(temporaryPath); } catch { /* Best-effort cleanup. */ }
    }
    throw error;
  }
}

function writeStore(store: QdnAppRolesStore) {
  const previousAssignments = cachedStore?.assignments;
  const nextStore = sanitizeQdnAppRolesStore(store);
  const storePath = getStorePath();
  const body = `${JSON.stringify(nextStore, null, 2)}\n`;
  if (Buffer.byteLength(body, 'utf8') > STORE_MAX_BYTES) {
    throw Object.assign(new Error('QDN app settings exceed the supported size.'), {
      code: 'HOME_QDN_APP_STORE_UNAVAILABLE',
    });
  }
  writeStoreAtomically(storePath, body);
  cachedStore = nextStore;
  if (JSON.stringify(previousAssignments) !== JSON.stringify(nextStore.assignments)) {
    assignmentListeners.forEach((listener) => {
      try { listener(); }
      catch (error) { console.warn('QDN app assignment listener failed.', error); }
    });
  }
  BrowserWindow.getAllWindows().forEach((window) => {
    if (window.isDestroyed()) return;
    try { window.webContents.send('qdn:app-assignments-changed'); }
    catch (error) { console.warn('Unable to announce a QDN app assignment change.', error); }
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

export function setQdnAppAssignmentValueIfRevision(
  expectedRevision: number,
  input: { role: unknown; url: unknown },
) {
  const store = readQdnAppRolesStore();
  if (store.revision !== expectedRevision) {
    throw new Error('QDN app assignments changed. Refresh and try again.');
  }
  const role = sanitizeQdnAppAssignmentRole(input.role);
  if (!Object.prototype.hasOwnProperty.call(store.assignments, role)) {
    throw new Error('Home 2 can only update an existing app assignment.');
  }
  return writeStore(setQdnAppAssignment(store, input));
}

export function onQdnAppAssignmentsChanged(listener: () => void) {
  assignmentListeners.add(listener);
  return () => {
    assignmentListeners.delete(listener);
  };
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
