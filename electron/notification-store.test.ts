import assert from 'node:assert/strict';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, WebContentsView } from 'electron';
import {
  grantAppNotifications,
  inspectNotificationStore,
  readNotificationStore,
  registerNotificationStoreIpcHandlers,
  replaceAppNotificationRules,
  revokeAppNotifications,
  setAppNotificationMuted,
} from './notification-store.js';
import { registerWidget, unregisterWidget } from './widget-registry.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'qortium-notification-store-'));
const storePath = path.join(root, 'notification-store.json');
const appKey = 'qdn://APP/Wallet/Wallet';

app.setPath('userData', root);

try {
  await app.whenReady();

  assert.deepEqual(inspectNotificationStore(), {
    status: 'available',
    store: { version: 1, revision: 0, grants: {}, rules: {} },
  });

  for (const malformed of [
    { version: 1, revision: -1, grants: {}, rules: {} },
    {
      version: 1,
      revision: 0,
      grants: { 'qdn://APP/Notify/Notify': { grantedAt: 'not-a-date' } },
      rules: {},
    },
    {
      version: 1,
      revision: 0,
      grants: {
        'qdn://APP/Notify/Notify': {
          grantedAt: '2026-08-22T12:00:00.000Z',
          secret: 'must-not-be-silently-dropped',
        },
      },
      rules: {},
    },
    {
      version: 1,
      revision: 0,
      grants: { 'qdn://APP/Notify/Notify#/route': { grantedAt: '2026-08-22T12:00:00.000Z' } },
      rules: {},
    },
    {
      version: 1,
      revision: 0,
      grants: {},
      rules: { 'qdn://APP/Notify/Notify': [] },
    },
    {
      version: 1,
      revision: 0,
      grants: {
        'qdn://APP/Notify/Notify': { grantedAt: '2026-08-22T12:00:00.000Z' },
      },
      rules: {
        'qdn://APP/Notify/Notify': [{
          accountAddress: 'Qaccount-binding-fixture',
          createdAt: '2026-08-22T12:01:00.000Z',
          event: 'FOREIGN_PAYMENT_RECEIVED',
          filters: { coin: 'BTC', xpub: 'xpub-watch-only-fixture' },
          notificationId: 'foreign-payment',
          secret: 'must-not-be-silently-dropped',
        }],
      },
    },
    {
      version: 1,
      revision: 0,
      grants: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [
        `qdn://APP/App${index}/App`,
        { grantedAt: '2026-08-22T12:00:00.000Z' },
      ])),
      rules: {},
    },
  ]) {
    writeFileSync(storePath, JSON.stringify(malformed), { encoding: 'utf8', mode: 0o600 });
    assert.deepEqual(inspectNotificationStore(), { status: 'corrupt', store: null });
    rmSync(storePath);
  }

  const granted = grantAppNotifications(appKey);
  assert.equal(granted.revision, 1);
  assert.equal(readNotificationStore().revision, 1);
  assert.equal(grantAppNotifications(appKey).revision, 1, 'semantic no-op must not advance revision');
  assert.equal(
    readdirSync(root).some((name) => name.endsWith('.tmp')),
    false,
    'atomic activation must not leave a temporary file',
  );
  if (process.platform !== 'win32') {
    assert.equal(lstatSync(storePath).mode & 0o777, 0o600);
  }

  const rules = replaceAppNotificationRules(appKey, [{
    event: 'FOREIGN_PAYMENT_RECEIVED',
    filters: { coin: 'BTC', xpub: 'xpub-watch-only-fixture' },
    notificationId: 'btc-received',
  }], 'Qaccount-binding-fixture');
  assert.equal(rules.length, 1);
  assert.equal(readNotificationStore().revision, 2);

  const muted = setAppNotificationMuted(appKey, true);
  assert.equal(muted.revision, 3);
  assert.equal(muted.grants[appKey].muted, true);
  assert.equal(muted.rules[appKey].length, 1, 'mute must preserve notification rules');
  assert.equal(setAppNotificationMuted(appKey, true).revision, 3, 'repeat mute is a no-op');

  const revoked = revokeAppNotifications(appKey);
  assert.equal(revoked.revision, 4);
  assert.equal(Object.hasOwn(revoked.grants, appKey), false);
  assert.equal(Object.hasOwn(revoked.rules, appKey), false);

  writeFileSync(storePath, '{not-json', { encoding: 'utf8', mode: 0o600 });
  assert.deepEqual(inspectNotificationStore(), { status: 'corrupt', store: null });
  assert.deepEqual(readNotificationStore(), { version: 1, revision: 0, grants: {}, rules: {} });
  assert.throws(
    () => grantAppNotifications(appKey),
    (error: unknown) => (error as { code?: unknown }).code === 'HOME_NOTIFICATION_STORE_CORRUPT',
  );
  assert.equal(readFileSync(storePath, 'utf8'), '{not-json', 'a corrupt store must not be overwritten');

  rmSync(storePath);
  if (process.platform !== 'win32') {
    const external = path.join(root, 'external.json');
    const externalBody = '{"doNotOverwrite":true}\n';
    writeFileSync(external, externalBody, { encoding: 'utf8', mode: 0o600 });
    symlinkSync(external, storePath);
    assert.deepEqual(inspectNotificationStore(), { status: 'unavailable', store: null });
    assert.throws(
      () => grantAppNotifications(appKey),
      (error: unknown) => (error as { code?: unknown }).code === 'HOME_NOTIFICATION_STORE_UNAVAILABLE',
    );
    assert.equal(readFileSync(external, 'utf8'), externalBody, 'a symlink target must not be read or overwritten');
    rmSync(storePath);
  }

  // Every legacy channel must reject a non-shell WebContents before it parses
  // input or touches the unsafe endpoint above.
  registerNotificationStoreIpcHandlers();
  const owner = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
    },
  });
  await owner.loadURL('data:text/html,<body>widget-wrapper-test</body>');
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
    },
  });
  owner.contentView.addChildView(view);
  await view.webContents.loadURL('data:text/html,<body>notification-store-test</body>');
  for (const invocation of [
    `ipcRenderer.invoke('qdn:hasNotificationStore')`,
    `ipcRenderer.invoke('qdn:getNotificationStore')`,
    `ipcRenderer.invoke('qdn:setAppNotificationMuted', '', 'not-a-boolean')`,
    `ipcRenderer.invoke('qdn:revokeAppNotifications', '')`,
  ]) {
    const outcome = await view.webContents.executeJavaScript(`(async () => {
      const { ipcRenderer } = require('electron');
      try {
        await ${invocation};
        return { accepted: true, message: '' };
      } catch (error) {
        return { accepted: false, message: String(error && error.message || error) };
      }
    })()`);
    assert.equal(outcome.accepted, false);
    assert.match(outcome.message, /only accepted from a Home window/);
  }
  owner.contentView.removeChildView(view);
  view.webContents.close();

  const widgetId = 'notification-store-test-widget';
  registerWidget({
    appName: 'Notification test',
    ignoringMouse: true,
    manifest: {
      defaultSize: { height: 120, width: 280 },
      entry: 'widget.html',
      manifestVersion: 1,
      maxSize: { height: 240, width: 560 },
      minSize: { height: 60, width: 140 },
      resizable: 'both',
      shape: null,
    },
    opacity: 1,
    region: null,
    resourceUrl: 'qdn://APP/Notify/Notify',
    snappedEdges: [],
    widgetId,
    windowId: owner.id,
  });
  const widgetOutcome = await owner.webContents.executeJavaScript(`(async () => {
    const { ipcRenderer } = require('electron');
    try {
      await ipcRenderer.invoke('qdn:getNotificationStore');
      return { accepted: true, message: '' };
    } catch (error) {
      return { accepted: false, message: String(error && error.message || error) };
    }
  })()`);
  assert.equal(widgetOutcome.accepted, false);
  assert.match(widgetOutcome.message, /only accepted from a Home window/);
  unregisterWidget(widgetId);
  owner.destroy();

  writeFileSync(storePath, Buffer.alloc((4 * 1024 * 1024) + 1, 0x20));
  chmodSync(storePath, 0o600);
  assert.deepEqual(inspectNotificationStore(), { status: 'corrupt', store: null });

  console.log('Notification store hardening tests passed.');
} finally {
  rmSync(root, { force: true, recursive: true });
}
