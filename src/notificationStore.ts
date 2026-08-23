import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  createEmptyQdnNotificationStore,
  parseStrictQdnNotificationStore,
  sanitizeQdnNotificationStore,
  type QdnNotificationRuleInput,
  type QdnNotificationStore,
  type StoredQdnNotificationRule,
} from '../electron/notification-rules';

const NOTIFICATION_STORE_KEY = 'qortium-home-notification-store';
const NOTIFICATION_STORE_MAX_BYTES = 4 * 1024 * 1024;
const listeners = new Set<(store: QdnNotificationStore) => void>();
let storeVersion = 0;
let cachedLocalStore: QdnNotificationStore | null = null;
let removeDesktopStoreListener: (() => void) | null = null;
let localWriteChain = Promise.resolve();

export type LocalNotificationStoreInspection =
  | { status: 'available'; store: QdnNotificationStore }
  | { status: 'corrupt' | 'unavailable'; store: null };

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

export async function inspectLocalNotificationStore(): Promise<LocalNotificationStoreInspection> {
  if (cachedLocalStore) return { status: 'available', store: cachedLocalStore };
  let raw: string | null;
  try {
    raw = Capacitor.isNativePlatform()
      ? (await Preferences.get({ key: NOTIFICATION_STORE_KEY })).value
      : window.localStorage.getItem(NOTIFICATION_STORE_KEY);
  } catch {
    return { status: 'unavailable', store: null };
  }
  if (!raw) {
    cachedLocalStore = createEmptyQdnNotificationStore();
    return { status: 'available', store: cachedLocalStore };
  }
  try {
    if (new TextEncoder().encode(raw).byteLength > NOTIFICATION_STORE_MAX_BYTES) {
      return { status: 'corrupt', store: null };
    }
    const parsed = parseStrictQdnNotificationStore(JSON.parse(raw));
    if (!parsed) return { status: 'corrupt', store: null };
    cachedLocalStore = parsed;
    return { status: 'available', store: cachedLocalStore };
  } catch {
    return { status: 'corrupt', store: null };
  }
}

async function readLocalStore() {
  const inspection = await inspectLocalNotificationStore();
  return inspection.status === 'available'
    ? inspection.store
    : createEmptyQdnNotificationStore();
}

async function requireAvailableLocalStore() {
  const inspection = await inspectLocalNotificationStore();
  if (inspection.status !== 'available') {
    throw Object.assign(new Error('Notification settings are unavailable.'), {
      code: inspection.status === 'corrupt'
        ? 'HOME_NOTIFICATION_STORE_CORRUPT'
        : 'HOME_NOTIFICATION_STORE_UNAVAILABLE',
    });
  }
  return inspection.store;
}

export async function readNotificationStoreForManagement() {
  return requireAvailableLocalStore();
}

async function writeLocalStore(store: QdnNotificationStore) {
  const value = JSON.stringify(store);
  if (Capacitor.isNativePlatform()) await Preferences.set({ key: NOTIFICATION_STORE_KEY, value });
  else {
    // This store contains sanitized notification preferences and watch-only
    // selectors, never passwords, private keys, wallet files, or auth tokens.
    // Browser Home intentionally persists it beside bookmarks and other user
    // preferences; native and desktop builds use their platform-owned stores.
    window.localStorage.setItem(NOTIFICATION_STORE_KEY, value);
  }
  cachedLocalStore = store;
  storeVersion += 1;
  listeners.forEach((listener) => listener(store));
  return store;
}

function sameNotificationStoreData(first: QdnNotificationStore, second: QdnNotificationStore) {
  return JSON.stringify({ grants: first.grants, rules: first.rules })
    === JSON.stringify({ grants: second.grants, rules: second.rules });
}

export function updateNotificationStore(
  mutate: (store: QdnNotificationStore) => QdnNotificationStore | void,
  expectedRevision?: number,
) {
  const operation = localWriteChain.then(async () => {
    const currentStore = sanitizeQdnNotificationStore(await requireAvailableLocalStore());
    if (expectedRevision !== undefined && currentStore.revision !== expectedRevision) {
      throw Object.assign(new Error('Notification settings changed; refresh and try again.'), {
        code: 'HOME_DATA_STALE',
      });
    }
    const draftStore = sanitizeQdnNotificationStore(currentStore);
    const requestedStore = sanitizeQdnNotificationStore(mutate(draftStore) ?? draftStore);
    if (sameNotificationStoreData(currentStore, requestedStore)) return currentStore;
    const nextStore = sanitizeQdnNotificationStore({ ...requestedStore, revision: currentStore.revision + 1 });
    return writeLocalStore(nextStore);
  });
  localWriteChain = operation.then(() => undefined, () => undefined);
  return operation;
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
  return updateNotificationStore((store) => {
    store.grants[appKey] = store.grants[appKey] ?? { grantedAt: new Date().toISOString() };
  });
}

export async function replaceAppNotificationRules(
  appKey: string,
  inputs: QdnNotificationRuleInput[],
  accountAddress: string,
) {
  const nextStore = await updateNotificationStore((store) => {
    const replacements = new Map(inputs.map((rule) => [rule.notificationId, rule]));
    const now = new Date().toISOString();
    const next: StoredQdnNotificationRule[] = (store.rules[appKey] ?? [])
      .filter((rule) => !replacements.has(rule.notificationId))
      .concat(inputs.map((rule) => ({ ...rule, accountAddress, createdAt: now })));
    if (next.length > 20) throw new Error('An app can store at most 20 notification rules.');
    store.rules[appKey] = next;
  });
  return nextStore.rules[appKey] ?? [];
}

export async function removeAppNotificationRules(appKey: string, notificationIds?: string[]) {
  const nextStore = await updateNotificationStore((store) => {
    if (!notificationIds) delete store.rules[appKey];
    else {
      const ids = new Set(notificationIds);
      const next = (store.rules[appKey] ?? []).filter((rule) => !ids.has(rule.notificationId));
      if (next.length) store.rules[appKey] = next;
      else delete store.rules[appKey];
    }
  });
  return nextStore.rules[appKey] ?? [];
}

export async function setAppNotificationMuted(
  appKey: string,
  muted: boolean,
  expectedRevision?: number,
) {
  if (window.qortiumHome.qdn?.setAppNotificationMuted) {
    if (expectedRevision !== undefined) {
      const currentStore = await window.qortiumHome.qdn.getNotificationStore?.();
      if (!currentStore || currentStore.revision !== expectedRevision) {
        throw Object.assign(new Error('Notification settings changed; refresh and try again.'), {
          code: 'HOME_DATA_STALE',
        });
      }
    }
    const store = await window.qortiumHome.qdn.setAppNotificationMuted(appKey, muted);
    storeVersion += 1;
    listeners.forEach((listener) => listener(store));
    return store;
  }
  return updateNotificationStore((store) => {
    if (!store.grants[appKey]) throw new Error('Notification permission is not granted for this app.');
    store.grants[appKey].muted = muted || undefined;
  }, expectedRevision);
}

export async function revokeAppNotifications(appKey: string, expectedRevision?: number) {
  if (window.qortiumHome.qdn?.revokeAppNotifications) {
    if (expectedRevision !== undefined) {
      const currentStore = await window.qortiumHome.qdn.getNotificationStore?.();
      if (!currentStore || currentStore.revision !== expectedRevision) {
        throw Object.assign(new Error('Notification settings changed; refresh and try again.'), {
          code: 'HOME_DATA_STALE',
        });
      }
    }
    const store = await window.qortiumHome.qdn.revokeAppNotifications(appKey);
    storeVersion += 1;
    listeners.forEach((listener) => listener(store));
    return store;
  }
  return updateNotificationStore((store) => {
    delete store.grants[appKey];
    delete store.rules[appKey];
  }, expectedRevision);
}
