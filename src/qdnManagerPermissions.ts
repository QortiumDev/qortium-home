import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  createEmptyQdnManagerPermissionStore,
  sanitizeQdnManagerAppKey,
  sanitizeQdnManagerPermissionStore,
  type QdnManagerCapability,
  type QdnManagerPermissionStore,
} from '../electron/qdn-manager-permissions';

const STORE_KEY = 'qortium-home-qdn-manager-permissions';
const listeners = new Set<(store: QdnManagerPermissionStore) => void>();
let cachedStore: QdnManagerPermissionStore | null = null;
let removeDesktopListener: (() => void) | null = null;

function ensureDesktopListener() {
  const subscribe = window.qortiumHome.qdn?.onManagerPermissionsChanged;
  if (!subscribe || removeDesktopListener) return;
  removeDesktopListener = subscribe(() => {
    void getQdnManagerPermissionStore().then((store) => listeners.forEach((listener) => listener(store)));
  });
}

async function readLocalStore() {
  if (cachedStore) return cachedStore;
  const raw = Capacitor.isNativePlatform()
    ? (await Preferences.get({ key: STORE_KEY })).value
    : window.localStorage.getItem(STORE_KEY);
  if (!raw) return (cachedStore = createEmptyQdnManagerPermissionStore());
  try { return (cachedStore = sanitizeQdnManagerPermissionStore(JSON.parse(raw))); }
  catch { return (cachedStore = createEmptyQdnManagerPermissionStore()); }
}

async function writeLocalStore(store: QdnManagerPermissionStore) {
  cachedStore = sanitizeQdnManagerPermissionStore(store);
  const value = JSON.stringify(cachedStore);
  if (Capacitor.isNativePlatform()) await Preferences.set({ key: STORE_KEY, value });
  else window.localStorage.setItem(STORE_KEY, value);
  listeners.forEach((listener) => listener(cachedStore as QdnManagerPermissionStore));
  return cachedStore;
}

export async function getQdnManagerPermissionStore() {
  ensureDesktopListener();
  return window.qortiumHome.qdn?.getManagerPermissionStore
    ? window.qortiumHome.qdn.getManagerPermissionStore()
    : readLocalStore();
}

export async function hasQdnManagerPermission(appKey: string, capability: QdnManagerCapability) {
  return !!(await getQdnManagerPermissionStore()).grants[sanitizeQdnManagerAppKey(appKey)]?.[capability];
}

export async function grantQdnManagerPermission(appKey: string, capability: QdnManagerCapability) {
  appKey = sanitizeQdnManagerAppKey(appKey);
  const store = await readLocalStore();
  store.grants[appKey] = store.grants[appKey] ?? {};
  store.grants[appKey][capability] = store.grants[appKey][capability] ?? { grantedAt: new Date().toISOString() };
  return writeLocalStore(store);
}

export async function revokeQdnManagerPermission(appKey: string, capability: QdnManagerCapability) {
  appKey = sanitizeQdnManagerAppKey(appKey);
  if (window.qortiumHome.qdn?.revokeManagerPermission) {
    return window.qortiumHome.qdn.revokeManagerPermission(appKey, capability);
  }
  const store = await readLocalStore();
  const capabilities = store.grants[appKey];
  if (!capabilities) return store;
  delete capabilities[capability];
  if (!Object.keys(capabilities).length) delete store.grants[appKey];
  return writeLocalStore(store);
}

export function onQdnManagerPermissionsChanged(listener: (store: QdnManagerPermissionStore) => void) {
  ensureDesktopListener();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
