#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  QDN_APP_BRIDGE_ACTIONS,
  QDN_BOOKMARK_MANAGER_ACTIONS,
  QDN_NOTIFICATION_MANAGER_ACTIONS,
  QDN_PUBLIC_NODE_BRIDGE_ACTIONS,
} from '../dist-electron/qdn-app-actions.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const expectedBookmarkActions = [
  'BOOKMARKS_HAS_PERMISSION',
  'BOOKMARKS_GET',
  'BOOKMARKS_APPLY',
];
const expectedNotificationActions = [
  'NOTIFICATION_MANAGER_HAS_PERMISSION',
  'NOTIFICATION_MANAGER_GET',
  'NOTIFICATION_MANAGER_SET_MUTED',
  'NOTIFICATION_MANAGER_REMOVE_RULES',
  'NOTIFICATION_MANAGER_REVOKE',
];
const managerActions = [...expectedBookmarkActions, ...expectedNotificationActions];
const promptActions = managerActions.filter((action) => !action.endsWith('_HAS_PERMISSION'));
const nonPromptActions = managerActions.filter((action) => action.endsWith('_HAS_PERMISSION'));

assert.deepEqual([...QDN_BOOKMARK_MANAGER_ACTIONS], expectedBookmarkActions);
assert.deepEqual([...QDN_NOTIFICATION_MANAGER_ACTIONS], expectedNotificationActions);

for (const action of managerActions) {
  assert.equal(
    QDN_APP_BRIDGE_ACTIONS.filter((candidate) => candidate === action).length,
    1,
    `${action} must appear exactly once in QDN_APP_BRIDGE_ACTIONS.`,
  );
  assert.equal(
    QDN_PUBLIC_NODE_BRIDGE_ACTIONS.filter((candidate) => candidate === action).length,
    1,
    `${action} must remain available when Home uses a public/network node.`,
  );
}

const androidBridgePath = path.join(
  repoRoot,
  'android/app/src/main/java/org/qortium/home/QdnBridgeWebViewClient.java',
);
const androidBridge = readFileSync(androidBridgePath, 'utf8');
const longActionsBody = /var longActions=\{([^}]*)\}/.exec(androidBridge)?.[1];
assert(longActionsBody, 'Android QDN bridge longActions catalogue was not found.');

for (const action of promptActions) {
  assert(
    longActionsBody.includes(`${action}:1`),
    `${action} must use Android's long request timeout because it can open a durable permission prompt.`,
  );
}
for (const action of nonPromptActions) {
  assert(
    !longActionsBody.includes(`${action}:1`),
    `${action} must stay on Android's normal timeout because it never prompts.`,
  );
}

for (const relativePath of [
  'scripts/smoke-desktop-qdn-api.mjs',
  'scripts/smoke-desktop-qdn-write.mjs',
  'scripts/smoke-android-qdn-bridge.mjs',
]) {
  const source = readFileSync(path.join(repoRoot, relativePath), 'utf8');
  for (const action of managerActions) {
    assert(source.includes(`'${action}'`), `${relativePath} must assert SHOW_ACTIONS includes ${action}.`);
  }
}

console.log('QDN manager action catalogue tests passed.');
