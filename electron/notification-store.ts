import { app, BrowserWindow, ipcMain, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  createEmptyQdnNotificationStore,
  parseStrictQdnNotificationStore,
  sanitizeQdnNotificationStore,
  type QdnNotificationRuleInput,
  type QdnNotificationStore,
  type StoredQdnNotificationRule,
} from './notification-rules.js';
import { assertShellWindowSender } from './shell-window-sender.js';

const NOTIFICATION_STORE_FILE = 'notification-store.json';
const NOTIFICATION_STORE_MAX_BYTES = 4 * 1024 * 1024;
const NOTIFICATION_APP_KEY_MAX_LENGTH = 2_048;
const listeners = new Set<() => void>();
let mutationInProgress = false;

export type NotificationStoreInspection =
  | { status: 'available'; store: QdnNotificationStore }
  | { status: 'corrupt' | 'unavailable'; store: null };

function getStorePath() {
  return path.join(app.getPath('userData'), NOTIFICATION_STORE_FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isMissingFileError(error: unknown) {
  return isRecord(error) && error.code === 'ENOENT';
}

export function inspectNotificationStore(): NotificationStoreInspection {
  const storePath = getStorePath();
  let descriptor: number | null = null;
  try {
    try {
      const endpoint = lstatSync(storePath);
      if (endpoint.isSymbolicLink() || !endpoint.isFile()) {
        return { status: 'unavailable', store: null };
      }
    } catch (error) {
      if (isMissingFileError(error)) {
        return { status: 'available', store: createEmptyQdnNotificationStore() };
      }
      throw error;
    }
    descriptor = openSync(
      storePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const endpoint = fstatSync(descriptor);
    if (!endpoint.isFile()) return { status: 'unavailable', store: null };
    if (endpoint.size > NOTIFICATION_STORE_MAX_BYTES) {
      return { status: 'corrupt', store: null };
    }
    if (process.platform !== 'win32') fchmodSync(descriptor, 0o600);
    const body = readFileSync(descriptor);
    if (body.byteLength > NOTIFICATION_STORE_MAX_BYTES) {
      return { status: 'corrupt', store: null };
    }
    const parsed: unknown = JSON.parse(body.toString('utf8'));
    const store = parseStrictQdnNotificationStore(parsed);
    return store
      ? { status: 'available', store }
      : { status: 'corrupt', store: null };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { status: 'available', store: createEmptyQdnNotificationStore() };
    }
    if (error instanceof SyntaxError) return { status: 'corrupt', store: null };
    console.warn('Unable to inspect notification store.', error);
    return { status: 'unavailable', store: null };
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function requireAvailableNotificationStore() {
  const inspection = inspectNotificationStore();
  if (inspection.status !== 'available') {
    throw Object.assign(new Error('Notification settings are unavailable.'), {
      code: inspection.status === 'corrupt'
        ? 'HOME_NOTIFICATION_STORE_CORRUPT'
        : 'HOME_NOTIFICATION_STORE_UNAVAILABLE',
    });
  }
  return inspection.store;
}

function assertSafeStoreEndpoint(storePath: string) {
  try {
    const endpoint = lstatSync(storePath);
    if (endpoint.isSymbolicLink() || !endpoint.isFile()) {
      throw Object.assign(new Error('Notification settings are unavailable.'), {
        code: 'HOME_NOTIFICATION_STORE_UNAVAILABLE',
      });
    }
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
}

function writeStoreAtomically(store: QdnNotificationStore) {
  const storePath = getStorePath();
  const storeDirectory = path.dirname(storePath);
  const body = `${JSON.stringify(store, null, 2)}\n`;
  if (Buffer.byteLength(body, 'utf8') > NOTIFICATION_STORE_MAX_BYTES) {
    throw Object.assign(new Error('Notification settings exceed the supported size.'), {
      code: 'HOME_NOTIFICATION_STORE_CORRUPT',
    });
  }

  mkdirSync(storeDirectory, { recursive: true, mode: 0o700 });
  const directoryEndpoint = lstatSync(storeDirectory);
  if (!directoryEndpoint.isDirectory() || directoryEndpoint.isSymbolicLink()) {
    throw Object.assign(new Error('Notification settings are unavailable.'), {
      code: 'HOME_NOTIFICATION_STORE_UNAVAILABLE',
    });
  }
  assertSafeStoreEndpoint(storePath);

  const temporaryPath = path.join(
    storeDirectory,
    `.${NOTIFICATION_STORE_FILE}.${process.pid}.${randomUUID()}.tmp`,
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
      try { unlinkSync(temporaryPath); } catch { /* Best-effort fault cleanup. */ }
    }
    throw error;
  }
}

export function replaceNotificationStore(store: QdnNotificationStore) {
  if (mutationInProgress) {
    throw Object.assign(new Error('Another notification settings mutation is in progress.'), {
      code: 'HOME_NOTIFICATION_STORE_BUSY',
    });
  }
  mutationInProgress = true;
  try {
    const currentStore = requireAvailableNotificationStore();
    const requestedStore = sanitizeQdnNotificationStore(store);
    if (JSON.stringify({ grants: currentStore.grants, rules: currentStore.rules })
      === JSON.stringify({ grants: requestedStore.grants, rules: requestedStore.rules })) {
      return currentStore;
    }
    if (currentStore.revision >= Number.MAX_SAFE_INTEGER) {
      throw Object.assign(new Error('Notification settings revision is exhausted.'), {
        code: 'HOME_NOTIFICATION_STORE_UNAVAILABLE',
      });
    }
    const nextStore = sanitizeQdnNotificationStore({
      ...requestedStore,
      revision: currentStore.revision + 1,
    });
    writeStoreAtomically(nextStore);
    for (const listener of listeners) {
      try { listener(); } catch (error) { console.warn('Notification store listener failed.', error); }
    }
    BrowserWindow.getAllWindows().forEach((window) => {
      if (window.isDestroyed()) return;
      try { window.webContents.send('qdn:notification-store-changed'); }
      catch (error) { console.warn('Unable to announce the notification store change.', error); }
    });
    return nextStore;
  } finally {
    mutationInProgress = false;
  }
}

export function readNotificationStore() {
  const inspection = inspectNotificationStore();
  if (inspection.status === 'available') return inspection.store;
  // Existing callers treat an absent grant as revoked. Preserve that safe
  // compatibility behavior while trusted Home UI uses the inspection seam to
  // distinguish corruption/unavailability from a genuinely empty store.
  return createEmptyQdnNotificationStore();
}

function notificationStoreFileExists() {
  const storePath = getStorePath();
  try {
    const endpoint = lstatSync(storePath);
    if (endpoint.isSymbolicLink() || !endpoint.isFile()) {
      throw Object.assign(new Error('Notification settings are unavailable.'), {
        code: 'HOME_NOTIFICATION_STORE_UNAVAILABLE',
      });
    }
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

function sanitizeLegacyNotificationAppKey(value: unknown) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > NOTIFICATION_APP_KEY_MAX_LENGTH
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error('App key is invalid.');
  }
  return value;
}

export function hasNotificationGrant(appKey: string) {
  return !!readNotificationStore().grants[appKey];
}

export function grantAppNotifications(appKey: string) {
  const store = sanitizeQdnNotificationStore(readNotificationStore());
  store.grants[appKey] = store.grants[appKey] ?? { grantedAt: new Date().toISOString() };
  return replaceNotificationStore(store);
}

export function replaceAppNotificationRules(appKey: string, inputs: QdnNotificationRuleInput[], accountAddress: string) {
  const store = sanitizeQdnNotificationStore(readNotificationStore());
  const existing = store.rules[appKey] ?? [];
  const now = new Date().toISOString();
  const replacements = new Map(inputs.map((rule) => [rule.notificationId, rule]));
  const next: StoredQdnNotificationRule[] = existing
    .filter((rule) => !replacements.has(rule.notificationId))
    .concat(inputs.map((rule) => ({ ...rule, accountAddress, createdAt: now })));
  if (next.length > 20) throw new Error('An app can store at most 20 notification rules.');
  store.rules[appKey] = next;
  return replaceNotificationStore(store).rules[appKey] ?? [];
}

export function removeAppNotificationRules(appKey: string, notificationIds?: string[]) {
  const store = sanitizeQdnNotificationStore(readNotificationStore());
  if (!notificationIds) delete store.rules[appKey];
  else {
    const ids = new Set(notificationIds);
    const next = (store.rules[appKey] ?? []).filter((rule) => !ids.has(rule.notificationId));
    if (next.length) store.rules[appKey] = next;
    else delete store.rules[appKey];
  }
  return replaceNotificationStore(store).rules[appKey] ?? [];
}

export function setAppNotificationMuted(appKey: string, muted: boolean) {
  const store = sanitizeQdnNotificationStore(readNotificationStore());
  const grant = store.grants[appKey];
  if (!grant) throw new Error('Notification permission is not granted for this app.');
  grant.muted = muted || undefined;
  return replaceNotificationStore(store);
}

export function revokeAppNotifications(appKey: string) {
  const store = sanitizeQdnNotificationStore(readNotificationStore());
  delete store.grants[appKey];
  delete store.rules[appKey];
  return replaceNotificationStore(store);
}

export function onNotificationStoreChanged(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function registerNotificationStoreIpcHandlers() {
  const assertLegacyNotificationStoreSender = (sender: WebContents) => {
    assertShellWindowSender(sender, 'Notification settings requests are only accepted from a Home window.');
  };
  ipcMain.handle('qdn:hasNotificationStore', (event) => {
    assertLegacyNotificationStoreSender(event.sender);
    return notificationStoreFileExists();
  });
  ipcMain.handle('qdn:getNotificationStore', (event) => {
    assertLegacyNotificationStoreSender(event.sender);
    return readNotificationStore();
  });
  ipcMain.handle('qdn:setAppNotificationMuted', (event, appKey: unknown, muted: unknown) => {
    assertLegacyNotificationStoreSender(event.sender);
    return setAppNotificationMuted(sanitizeLegacyNotificationAppKey(appKey), muted === true);
  });
  ipcMain.handle('qdn:revokeAppNotifications', (event, appKey: unknown) => {
    assertLegacyNotificationStoreSender(event.sender);
    return revokeAppNotifications(sanitizeLegacyNotificationAppKey(appKey));
  });
}
