import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  createEmptyQdnNotificationStore,
  sanitizeQdnNotificationStore,
  type QdnNotificationRuleInput,
  type QdnNotificationStore,
  type StoredQdnNotificationRule,
} from '../electron/notification-rules';

const NOTIFICATION_STORE_KEY = 'qortium-home-notification-store';
const listeners = new Set<(store: QdnNotificationStore) => void>();
let storeVersion = 0;
let cachedLocalStore: QdnNotificationStore | null = null;
let removeDesktopStoreListener: (() => void) | null = null;

function ensureDesktopStoreListener() {
  const subscribe = window.qortiumHome.qdn?.onNotificationStoreChanged;
  if (!subscribe || removeDesktopStoreListener) return;
  removeDesktopStoreListener = subscribe(() => {
    void getNotificationStore().then((store) => {
      storeVersion += 1;
      listeners.forEach((listener) => listener(store));
    }).catch((error) => {
      console.warn('Unable to refresh the notification store after a desktop update.', error);
    });
  });
}

async function readLocalStore() {
  if (cachedLocalStore) return cachedLocalStore;
  const raw = Capacitor.isNativePlatform()
    ? (await Preferences.get({ key: NOTIFICATION_STORE_KEY })).value
    : window.localStorage.getItem(NOTIFICATION_STORE_KEY);
  if (!raw) return (cachedLocalStore = createEmptyQdnNotificationStore());
  try { return (cachedLocalStore = sanitizeQdnNotificationStore(JSON.parse(raw))); }
  catch { return (cachedLocalStore = createEmptyQdnNotificationStore()); }
}

async function writeLocalStore(store: QdnNotificationStore) {
  cachedLocalStore = store;
  const value = JSON.stringify(store);
  if (Capacitor.isNativePlatform()) await Preferences.set({ key: NOTIFICATION_STORE_KEY, value });
  else window.localStorage.setItem(NOTIFICATION_STORE_KEY, value);
  storeVersion += 1;
  listeners.forEach((listener) => listener(store));
  return store;
}

export async function getNotificationStore() {
  return window.qortiumHome.qdn?.getNotificationStore
    ? window.qortiumHome.qdn.getNotificationStore()
    : readLocalStore();
}

export function getNotificationRulesVersion() {
  return storeVersion;
}

export function onNotificationStoreChanged(listener: (store: QdnNotificationStore) => void) {
  ensureDesktopStoreListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function grantAppNotifications(appKey: string) {
  const store = await readLocalStore();
  store.grants[appKey] = store.grants[appKey] ?? { grantedAt: new Date().toISOString() };
  return writeLocalStore(store);
}

export async function replaceAppNotificationRules(
  appKey: string,
  inputs: QdnNotificationRuleInput[],
  accountAddress: string,
) {
  const store = await readLocalStore();
  const replacements = new Map(inputs.map((rule) => [rule.notificationId, rule]));
  const now = new Date().toISOString();
  const next: StoredQdnNotificationRule[] = (store.rules[appKey] ?? [])
    .filter((rule) => !replacements.has(rule.notificationId))
    .concat(inputs.map((rule) => ({ ...rule, accountAddress, createdAt: now })));
  if (next.length > 20) throw new Error('An app can store at most 20 notification rules.');
  store.rules[appKey] = next;
  await writeLocalStore(store);
  return next;
}

export async function removeAppNotificationRules(appKey: string, notificationIds?: string[]) {
  const store = await readLocalStore();
  if (!notificationIds) delete store.rules[appKey];
  else {
    const ids = new Set(notificationIds);
    const next = (store.rules[appKey] ?? []).filter((rule) => !ids.has(rule.notificationId));
    if (next.length) store.rules[appKey] = next;
    else delete store.rules[appKey];
  }
  await writeLocalStore(store);
  return store.rules[appKey] ?? [];
}

export async function setAppNotificationMuted(appKey: string, muted: boolean) {
  if (window.qortiumHome.qdn?.setAppNotificationMuted) {
    const store = await window.qortiumHome.qdn.setAppNotificationMuted(appKey, muted);
    storeVersion += 1;
    listeners.forEach((listener) => listener(store));
    return store;
  }
  const store = await readLocalStore();
  if (!store.grants[appKey]) throw new Error('Notification permission is not granted for this app.');
  store.grants[appKey].muted = muted || undefined;
  return writeLocalStore(store);
}

export async function revokeAppNotifications(appKey: string) {
  if (window.qortiumHome.qdn?.revokeAppNotifications) {
    const store = await window.qortiumHome.qdn.revokeAppNotifications(appKey);
    storeVersion += 1;
    listeners.forEach((listener) => listener(store));
    return store;
  }
  const store = await readLocalStore();
  delete store.grants[appKey];
  delete store.rules[appKey];
  return writeLocalStore(store);
}
