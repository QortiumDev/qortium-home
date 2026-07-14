import { app, BrowserWindow, ipcMain } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  createEmptyQdnNotificationStore,
  sanitizeQdnNotificationStore,
  type QdnNotificationRuleInput,
  type QdnNotificationStore,
  type StoredQdnNotificationRule,
} from './notification-rules.js';

const NOTIFICATION_STORE_FILE = 'notification-store.json';
const listeners = new Set<() => void>();
let cachedStore: QdnNotificationStore | null = null;

function getStorePath() {
  return path.join(app.getPath('userData'), NOTIFICATION_STORE_FILE);
}

function writeStore(store: QdnNotificationStore) {
  cachedStore = store;
  const storePath = getStorePath();
  mkdirSync(path.dirname(storePath), { recursive: true });
  writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  listeners.forEach((listener) => listener());
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) window.webContents.send('qdn:notification-store-changed');
  });
}

export function readNotificationStore() {
  if (cachedStore) return cachedStore;
  const storePath = getStorePath();
  if (!existsSync(storePath)) return (cachedStore = createEmptyQdnNotificationStore());
  try {
    return (cachedStore = sanitizeQdnNotificationStore(JSON.parse(readFileSync(storePath, 'utf8'))));
  } catch (error) {
    console.warn('Unable to read notification store.', error);
    return (cachedStore = createEmptyQdnNotificationStore());
  }
}

export function hasNotificationGrant(appKey: string) {
  return !!readNotificationStore().grants[appKey];
}

export function grantAppNotifications(appKey: string) {
  const store = readNotificationStore();
  store.grants[appKey] = store.grants[appKey] ?? { grantedAt: new Date().toISOString() };
  writeStore(store);
}

export function replaceAppNotificationRules(appKey: string, inputs: QdnNotificationRuleInput[], accountAddress: string) {
  const store = readNotificationStore();
  const existing = store.rules[appKey] ?? [];
  const now = new Date().toISOString();
  const replacements = new Map(inputs.map((rule) => [rule.notificationId, rule]));
  const next: StoredQdnNotificationRule[] = existing
    .filter((rule) => !replacements.has(rule.notificationId))
    .concat(inputs.map((rule) => ({ ...rule, accountAddress, createdAt: now })));
  if (next.length > 20) throw new Error('An app can store at most 20 notification rules.');
  store.rules[appKey] = next;
  writeStore(store);
  return next;
}

export function removeAppNotificationRules(appKey: string, notificationIds?: string[]) {
  const store = readNotificationStore();
  if (!notificationIds) delete store.rules[appKey];
  else {
    const ids = new Set(notificationIds);
    const next = (store.rules[appKey] ?? []).filter((rule) => !ids.has(rule.notificationId));
    if (next.length) store.rules[appKey] = next;
    else delete store.rules[appKey];
  }
  writeStore(store);
  return store.rules[appKey] ?? [];
}

export function setAppNotificationMuted(appKey: string, muted: boolean) {
  const store = readNotificationStore();
  const grant = store.grants[appKey];
  if (!grant) throw new Error('Notification permission is not granted for this app.');
  grant.muted = muted || undefined;
  writeStore(store);
  return readNotificationStore();
}

export function revokeAppNotifications(appKey: string) {
  const store = readNotificationStore();
  delete store.grants[appKey];
  delete store.rules[appKey];
  writeStore(store);
  return store;
}

export function onNotificationStoreChanged(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function registerNotificationStoreIpcHandlers() {
  ipcMain.handle('qdn:hasNotificationStore', () => existsSync(getStorePath()));
  ipcMain.handle('qdn:getNotificationStore', () => readNotificationStore());
  ipcMain.handle('qdn:setAppNotificationMuted', (_event, appKey: unknown, muted: unknown) => {
    if (typeof appKey !== 'string' || !appKey) throw new Error('App key is required.');
    return setAppNotificationMuted(appKey, muted === true);
  });
  ipcMain.handle('qdn:revokeAppNotifications', (_event, appKey: unknown) => {
    if (typeof appKey !== 'string' || !appKey) throw new Error('App key is required.');
    return revokeAppNotifications(appKey);
  });
}
