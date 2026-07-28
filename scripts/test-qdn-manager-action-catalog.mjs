#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  QDN_APP_BRIDGE_ACTIONS,
  QDN_APP_ASSIGNMENT_ACTIONS,
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
  'BOOKMARKS_OPEN',
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
const localPreviewActions = ['PREVIEW_QDN_PUBLISH_SOURCE'];
const assignmentActions = ['GET_APP_ASSIGNMENTS', 'REQUEST_APP_ASSIGNMENT'];

assert.deepEqual([...QDN_BOOKMARK_MANAGER_ACTIONS], expectedBookmarkActions);
assert.deepEqual([...QDN_NOTIFICATION_MANAGER_ACTIONS], expectedNotificationActions);
assert.deepEqual([...QDN_APP_ASSIGNMENT_ACTIONS], assignmentActions);

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

for (const action of localPreviewActions) {
  assert.equal(
    QDN_APP_BRIDGE_ACTIONS.filter((candidate) => candidate === action).length,
    1,
    `${action} must appear exactly once in QDN_APP_BRIDGE_ACTIONS.`,
  );
  assert.equal(
    QDN_PUBLIC_NODE_BRIDGE_ACTIONS.includes(action),
    false,
    `${action} must not be advertised for public/network nodes.`,
  );
}
for (const action of assignmentActions) {
  assert.equal(QDN_APP_BRIDGE_ACTIONS.filter((candidate) => candidate === action).length, 1, `${action} must appear exactly once in QDN_APP_BRIDGE_ACTIONS.`);
  assert.equal(QDN_PUBLIC_NODE_BRIDGE_ACTIONS.includes(action), true, `${action} must remain available on public/network nodes.`);
}

const androidBridgePath = path.join(
  repoRoot,
  'android/app/src/main/java/org/qortium/home/QdnBridgeWebViewClient.java',
);
const androidBridge = readFileSync(androidBridgePath, 'utf8');
const desktopBridge = readFileSync(path.join(repoRoot, 'electron/qdn.ts'), 'utf8');
const androidPlatformBridge = readFileSync(path.join(repoRoot, 'src/platform.ts'), 'utf8');
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
for (const action of localPreviewActions) {
  assert(
    longActionsBody.includes(`${action}:1`),
    `${action} must use Android's long request timeout while Core stages the selected source.`,
  );
}
for (const action of assignmentActions) {
  assert(longActionsBody.includes(`${action}:1`), `${action} must use Android's long timeout because it can show a Home approval dialog.`);
}

for (const [label, source, freshness] of [
  ['desktop', desktopBridge, 'assertFreshQdnWriteContext(sender, context)'],
  ['Android', androidPlatformBridge, 'context.isCurrent && !context.isCurrent()'],
]) {
  const handler = readFunction(source, 'handleQdnAppAssignmentAction');
  for (const required of [
    "action === 'GET_APP_ASSIGNMENTS'",
    'action,',
    "permissionScope: 'single-request'",
    "label: 'Current target'",
    "label: 'Proposed target'",
    freshness,
  ]) {
    assert(handler.includes(required), `${label} assignment bridge must include ${required}.`);
  }
}

for (const [label, source, required] of [
  [
    'desktop',
    desktopBridge,
    [
      "case 'PREVIEW_QDN_PUBLISH_SOURCE':",
      'getQdnPublishSourceFromToken(request, context)',
      'assertLocalWriteConnection(connection)',
      "hostWindow.webContents.send('qdn-app:open-publish-source-preview'",
      'return true;',
    ],
  ],
  [
    'Android',
    androidPlatformBridge,
    [
      "case 'PREVIEW_QDN_PUBLISH_SOURCE':",
      'getQdnPublishSourceFromToken(request, context)',
      'assertLocalWriteConnection(settings, nodeApiUrl)',
      'context.onOpenPublishSourcePreview({',
      'return true;',
    ],
  ],
]) {
  for (const snippet of required) {
    assert(source.includes(snippet), `${label} selected-source preview bridge must include ${snippet}.`);
  }
}

function readFunction(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist.`);
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `${name} must have a closing brace.`);
  return source.slice(start, end);
}

for (const [label, source] of [
  ['desktop', desktopBridge],
  ['Android', androidPlatformBridge],
]) {
  const previewAction = readFunction(source, 'previewQdnPublishSourceForApp');
  assert(
    !/return\s*\{\s*renderUrl:/.test(previewAction),
    `${label} selected-source preview must not return the Core render URL to app JavaScript.`,
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
