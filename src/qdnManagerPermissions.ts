import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  createDefaultQdnAppRolesStore,
  grantQdnAppCapability,
  migrateLegacyQdnAppStores,
  sanitizeQdnAppRolesStore,
  setQdnAppAssignment,
  storeHoldsQdnAppCapability,
  type QdnAppAssignmentsStore,
  type QdnAppCapability,
  type QdnManagerCapability,
} from '../electron/qdn-manager-permissions';

const STORE_KEY = 'qortium-home-qdn-apps';
const LEGACY_PERMISSIONS_KEY = 'qortium-home-qdn-manager-permissions';
const LEGACY_PREFERRED_APPS_KEY = 'qortium-home-preferred-apps';
const listeners = new Set<(store: QdnAppAssignmentsStore) => void>();
let cachedStore: QdnAppAssignmentsStore | null = null;
let removeDesktopListener: (() => void) | null = null;
let desktopMigration: Promise<void> | null = null;

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function ensureDesktopListener() {
  const subscribe = window.qortiumHome.qdn?.onAppAssignmentsChanged;
  if (!subscribe || removeDesktopListener) return;
  removeDesktopListener = subscribe(() => {
    void getQdnAppRolesStore().then((store) => listeners.forEach((listener) => listener(store)));
  });
}

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
    await removeLegacyLocalValues();
    return cachedStore;
  }
  const legacyPermissionsRaw = await readLegacyLocalValue(LEGACY_PERMISSIONS_KEY);
  const legacyPreferredAppsRaw = await readLegacyLocalValue(LEGACY_PREFERRED_APPS_KEY);
  const initialStore = legacyPermissionsRaw === null && legacyPreferredAppsRaw === null
    ? createDefaultQdnAppRolesStore()
    : migrateLegacyQdnAppStores(parseJson(legacyPermissionsRaw), parseJson(legacyPreferredAppsRaw));
  const migrated = await writeLocalStore(initialStore);
  await removeLegacyLocalValues();
  return migrated;
}

async function writeLocalStore(store: QdnAppAssignmentsStore) {
  cachedStore = sanitizeQdnAppRolesStore(store);
  const value = JSON.stringify(cachedStore);
  if (Capacitor.isNativePlatform()) await Preferences.set({ key: STORE_KEY, value });
  else window.localStorage.setItem(STORE_KEY, value);
  listeners.forEach((listener) => listener(cachedStore as QdnAppAssignmentsStore));
  return cachedStore;
}

export async function getQdnAppRolesStore(): Promise<QdnAppAssignmentsStore> {
  ensureDesktopListener();
  if (window.qortiumHome.qdn?.getAppAssignmentsStore) {
    await ensureDesktopMigration();
    return window.qortiumHome.qdn.getAppAssignmentsStore();
  }
  return readLocalStore();
}

export async function hasQdnManagerPermission(appKey: string, capability: QdnManagerCapability) {
  return storeHoldsQdnAppCapability(await getQdnAppRolesStore(), appKey, capability);
}

export async function hasQdnAppCapability(appKey: string, capability: QdnAppCapability) {
  return storeHoldsQdnAppCapability(await getQdnAppRolesStore(), appKey, capability);
}

export async function grantQdnManagerPermission(appKey: string, capability: QdnManagerCapability) {
  return grantQdnAppCapabilityPermission(appKey, capability);
}

export async function grantQdnAppCapabilityPermission(appKey: string, capability: QdnAppCapability) {
  const store = await readLocalStore();
  return writeLocalStore(grantQdnAppCapability(store, appKey, capability));
}

export async function setQdnAppAssignmentValue(input: { description?: unknown; label?: unknown; role: unknown; url: unknown }) {
  if (window.qortiumHome.qdn?.setAppAssignment) {
    await ensureDesktopMigration();
    return window.qortiumHome.qdn.setAppAssignment(input);
  }
  return writeLocalStore(setQdnAppAssignment(await readLocalStore(), input));
}

export function onQdnManagerPermissionsChanged(listener: (store: QdnAppAssignmentsStore) => void) {
  ensureDesktopListener();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
