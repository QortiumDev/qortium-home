import { app, BrowserWindow, ipcMain } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  createEmptyQdnManagerPermissionStore,
  isQdnManagerCapability,
  sanitizeQdnManagerAppKey,
  sanitizeQdnManagerPermissionStore,
  type QdnManagerCapability,
  type QdnManagerPermissionStore,
} from './qdn-manager-permissions.js';

const STORE_FILE = 'qdn-manager-permissions.json';
let cachedStore: QdnManagerPermissionStore | null = null;

function getStorePath() {
  return path.join(app.getPath('userData'), STORE_FILE);
}

function writeStore(store: QdnManagerPermissionStore) {
  cachedStore = sanitizeQdnManagerPermissionStore(store);
  const storePath = getStorePath();
  mkdirSync(path.dirname(storePath), { recursive: true });
  writeFileSync(storePath, `${JSON.stringify(cachedStore, null, 2)}\n`, 'utf8');
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) window.webContents.send('qdn:manager-permissions-changed');
  });
  return cachedStore;
}

export function readQdnManagerPermissionStore() {
  if (cachedStore) return cachedStore;
  const storePath = getStorePath();
  if (!existsSync(storePath)) return (cachedStore = createEmptyQdnManagerPermissionStore());
  try {
    return (cachedStore = sanitizeQdnManagerPermissionStore(JSON.parse(readFileSync(storePath, 'utf8'))));
  } catch (error) {
    console.warn('Unable to read QDN manager permission store.', error);
    return (cachedStore = createEmptyQdnManagerPermissionStore());
  }
}

export function hasQdnManagerPermission(appKey: string, capability: QdnManagerCapability) {
  return !!readQdnManagerPermissionStore().grants[appKey]?.[capability];
}

export function grantQdnManagerPermission(appKey: string, capability: QdnManagerCapability) {
  const normalizedAppKey = sanitizeQdnManagerAppKey(appKey);
  const store = readQdnManagerPermissionStore();
  store.grants[normalizedAppKey] = store.grants[normalizedAppKey] ?? {};
  store.grants[normalizedAppKey][capability] = store.grants[normalizedAppKey][capability] ?? {
    grantedAt: new Date().toISOString(),
  };
  return writeStore(store);
}

export function revokeQdnManagerPermission(appKey: string, capability: QdnManagerCapability) {
  const normalizedAppKey = sanitizeQdnManagerAppKey(appKey);
  const store = readQdnManagerPermissionStore();
  const capabilities = store.grants[normalizedAppKey];
  if (!capabilities) return store;
  delete capabilities[capability];
  if (!Object.keys(capabilities).length) delete store.grants[normalizedAppKey];
  return writeStore(store);
}

export function registerQdnManagerPermissionStoreIpcHandlers() {
  ipcMain.handle('qdn:getManagerPermissionStore', () => readQdnManagerPermissionStore());
  ipcMain.handle('qdn:revokeManagerPermission', (_event, appKey: unknown, capability: unknown) => {
    if (!isQdnManagerCapability(capability)) throw new Error('Manager capability is invalid.');
    return revokeQdnManagerPermission(sanitizeQdnManagerAppKey(appKey), capability);
  });
}
