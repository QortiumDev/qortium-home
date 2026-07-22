import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  getQdnAppRoleForCapability,
  createDefaultQdnAppRolesStore,
  migrateLegacyQdnAppStores,
  sanitizeQdnAppRolesStore,
  sanitizeQdnManagerAppKey,
  storeHoldsQdnManagerPermission,
  type QdnAppRole,
  type QdnAppRolesStore,
  type QdnManagerCapability,
} from '../electron/qdn-manager-permissions';

const STORE_KEY = 'qortium-home-qdn-apps';
const LEGACY_PERMISSIONS_KEY = 'qortium-home-qdn-manager-permissions';
const LEGACY_PREFERRED_APPS_KEY = 'qortium-home-preferred-apps';
const listeners = new Set<(store: QdnAppRolesStore) => void>();
let cachedStore: QdnAppRolesStore | null = null;
let removeDesktopListener: (() => void) | null = null;
let desktopMigration: Promise<void> | null = null;

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function ensureDesktopListener() {
  const subscribe = window.qortiumHome.qdn?.onAppRolesChanged;
  if (!subscribe || removeDesktopListener) return;
  removeDesktopListener = subscribe(() => {
    void getQdnAppRolesStore().then((store) => listeners.forEach((listener) => listener(store)));
  });
}

// On desktop the unified store lives in the main process, but the legacy
// Preferred apps store lived in this renderer's localStorage. Report it once so
// the main-process migration can finish, then drop the legacy keys.
function ensureDesktopMigration() {
  const migrate = window.qortiumHome.qdn?.migrateLegacyPreferredApps;
  if (!migrate || desktopMigration) return desktopMigration ?? Promise.resolve();
  desktopMigration = migrate(parseJson(window.localStorage.getItem(LEGACY_PREFERRED_APPS_KEY)))
    .then(() => {
      window.localStorage.removeItem(LEGACY_PREFERRED_APPS_KEY);
      window.localStorage.removeItem(LEGACY_PERMISSIONS_KEY);
    })
    .catch((error) => {
      desktopMigration = null;
      console.warn('Unable to migrate legacy preferred apps.', error);
    });
  return desktopMigration ?? Promise.resolve();
}

async function readLegacyLocalValue(key: string) {
  return Capacitor.isNativePlatform()
    ? (await Preferences.get({ key })).value
    : window.localStorage.getItem(key);
}

// Best-effort, idempotent: a failed delete must never fail the store load, and
// is retried on later loads so stale legacy grants cannot linger and be
// re-imported if the unified key were ever lost.
async function removeLegacyLocalValues() {
  for (const key of [LEGACY_PERMISSIONS_KEY, LEGACY_PREFERRED_APPS_KEY]) {
    try {
      if (Capacitor.isNativePlatform()) await Preferences.remove({ key });
      else window.localStorage.removeItem(key);
    } catch (error) {
      console.warn(`Unable to remove legacy store "${key}".`, error);
    }
  }
}

async function readLocalStore() {
  if (cachedStore) return cachedStore;
  const raw = Capacitor.isNativePlatform()
    ? (await Preferences.get({ key: STORE_KEY })).value
    : window.localStorage.getItem(STORE_KEY);
  if (raw) {
    cachedStore = sanitizeQdnAppRolesStore(parseJson(raw));
    // Retry the legacy cleanup in case an earlier removal attempt failed.
    await removeLegacyLocalValues();
    return cachedStore;
  }

  // First load: migrate both legacy stores into the unified role store, then
  // remove the legacy keys.
  const legacyPermissionsRaw = await readLegacyLocalValue(LEGACY_PERMISSIONS_KEY);
  const legacyPreferredAppsRaw = await readLegacyLocalValue(LEGACY_PREFERRED_APPS_KEY);
  const legacyPermissions = parseJson(legacyPermissionsRaw);
  const legacyPreferredApps = parseJson(legacyPreferredAppsRaw);
  // With no legacy keys this is a new profile, so select the current defaults.
  // Any legacy key means this is an upgrade and must preserve an intentionally
  // unassigned Notifications Manager role.
  const initialStore = legacyPermissionsRaw === null && legacyPreferredAppsRaw === null
    ? createDefaultQdnAppRolesStore()
    : migrateLegacyQdnAppStores(legacyPermissions, legacyPreferredApps);
  const migrated = await writeLocalStore(initialStore);
  await removeLegacyLocalValues();
  return migrated;
}

async function writeLocalStore(store: QdnAppRolesStore) {
  cachedStore = sanitizeQdnAppRolesStore(store);
  const value = JSON.stringify(cachedStore);
  if (Capacitor.isNativePlatform()) await Preferences.set({ key: STORE_KEY, value });
  else window.localStorage.setItem(STORE_KEY, value);
  listeners.forEach((listener) => listener(cachedStore as QdnAppRolesStore));
  return cachedStore;
}

export async function getQdnAppRolesStore(): Promise<QdnAppRolesStore> {
  ensureDesktopListener();
  if (window.qortiumHome.qdn?.getAppRolesStore) {
    await ensureDesktopMigration();
    return window.qortiumHome.qdn.getAppRolesStore();
  }
  return readLocalStore();
}

export async function hasQdnManagerPermission(appKey: string, capability: QdnManagerCapability) {
  return storeHoldsQdnManagerPermission(await getQdnAppRolesStore(), appKey, capability);
}

/**
 * Records user consent for `appKey` to hold the capability's role, replacing
 * any previous holder. Local (web/native) storage path only: on desktop the
 * grant prompt flow writes through the main process instead.
 */
export async function grantQdnManagerPermission(appKey: string, capability: QdnManagerCapability) {
  appKey = sanitizeQdnManagerAppKey(appKey);
  const store = await readLocalStore();
  store.roles[getQdnAppRoleForCapability(capability)] = {
    url: appKey,
    grantedAt: new Date().toISOString(),
  };
  return writeLocalStore(store);
}

/**
 * Settings only selects the app for a role. The selected app must still use
 * the normal approval dialog before it receives the matching capability.
 */
export async function setQdnAppRoleUrl(role: QdnAppRole, url: string) {
  const normalizedUrl = sanitizeQdnManagerAppKey(url);
  if (window.qortiumHome.qdn?.setAppRoleUrl) {
    await ensureDesktopMigration();
    return window.qortiumHome.qdn.setAppRoleUrl(role, normalizedUrl);
  }
  const store = await readLocalStore();
  store.roles[role] = { url: normalizedUrl, grantedAt: null };
  return writeLocalStore(store);
}

export function onQdnManagerPermissionsChanged(listener: (store: QdnAppRolesStore) => void) {
  ensureDesktopListener();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
