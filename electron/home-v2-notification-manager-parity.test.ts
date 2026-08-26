/**
 * Parity and posture pins for the app-facing notification manager.
 *
 * Precedent: qdn-message-bridge-parity.test.ts. Home has no test CI that can
 * drive a real Electron window, so the properties a security review cares about
 * — "only 'always' is accepted", "a denial creates no grant", "staleness is
 * rechecked after approval" — are pinned against the source text of the two
 * dispatchers. A refactor that removes one of these lines fails here rather
 * than silently widening the surface.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { QDN_NOTIFICATION_MANAGER_ACTIONS } from './qdn-app-actions.js';
import { HOME_V2_NOTIFICATION_MANAGER_ACTIONS } from './home-v2-notification-manager-contract.js';
import { getHomeV2AppActions } from './home-v2-app-actions.js';
import { HOME_V2_ROUTE_INDEPENDENT_ACTIONS } from './home-v2-app-runtime.js';

function readRepoSource(...candidates: string[]) {
  const url = candidates.map((candidate) => new URL(candidate, import.meta.url)).find((each) => existsSync(each));
  assert.ok(url, `source not found: tried ${candidates.join(', ')}`);
  return readFileSync(url, 'utf8');
}

const desktopBridge = readRepoSource('../electron/home-v2-app-bridge.ts', './home-v2-app-bridge.ts');
const androidHost = readRepoSource(
  '../src/home-v2-live/HomeV2LiveApp.tsx',
  './src/home-v2-live/HomeV2LiveApp.tsx',
);
const contract = readRepoSource(
  '../electron/home-v2-notification-manager-contract.ts',
  './home-v2-notification-manager-contract.ts',
);
const livePreload = readRepoSource('../electron/home-v2-live-preload.cts', './home-v2-live-preload.cts');
const appTabStage = readRepoSource('../src/v2/shell/AppTabStage.tsx', './src/v2/shell/AppTabStage.tsx');
const settingsContract = readRepoSource(
  '../electron/home-v2-qdn-settings-contract.ts',
  './home-v2-qdn-settings-contract.ts',
);
const settingsUi = readRepoSource('../src/v2/shell/QdnAppsSettings.tsx', './src/v2/shell/QdnAppsSettings.tsx');
const promptTypes = readRepoSource('../src/v2/bridge-permissions.ts', './src/v2/bridge-permissions.ts');

// ---------------------------------------------------------------------------
// Parity: the v2 manager surface is EXACTLY the 1.x five, and no more.
// ---------------------------------------------------------------------------

assert.deepEqual(
  [...HOME_V2_NOTIFICATION_MANAGER_ACTIONS].sort(),
  [...QDN_NOTIFICATION_MANAGER_ACTIONS].sort(),
  'Home 2 must expose exactly the notification manager actions Home 1.x exposed',
);

const qdnActions = getHomeV2AppActions('qdnRequest');
const qortalActions = getHomeV2AppActions('qortalRequest');
for (const action of HOME_V2_NOTIFICATION_MANAGER_ACTIONS) {
  assert.ok(qdnActions.includes(action), `${action} must be advertised on qdnRequest`);
  assert.ok(
    !qortalActions.includes(action),
    `${action} must NOT be advertised on qortalRequest: it touches no node and has no chain semantics`,
  );
  assert.ok(
    (HOME_V2_ROUTE_INDEPENDENT_ACTIONS as readonly string[]).includes(action),
    `${action} must stay callable while every node route is down`,
  );
}

// The manager surface must not have quietly grown a rule-CREATION action.
for (const action of [...qdnActions, ...qortalActions]) {
  if (!action.startsWith('NOTIFICATION_')) continue;
  assert.ok(
    (HOME_V2_NOTIFICATION_MANAGER_ACTIONS as readonly string[]).includes(action) ||
      action === 'NOTIFICATION_HAS_PERMISSION',
    `${action} is a new NOTIFICATION_* action; add it here deliberately or remove it`,
  );
}

// ---------------------------------------------------------------------------
// Desktop dispatch posture.
// ---------------------------------------------------------------------------

function readFunction(source: string, name: string) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist.`);
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `${name} must have a closing brace.`);
  return source.slice(start, end);
}

const desktopGate = readFunction(desktopBridge, 'requireHomeV2NotificationManagerPermission');
for (const required of [
  // Prompt once, then durable: an existing grant short-circuits before any
  // prompt is raised.
  "if (hasQdnManagerPermission(appKey, 'notifications.manage')) return appKey",
  // The principal is the manager key, NOT the canonical capability principal:
  // the store keys capabilityGrants by the manager key and rekeying would drop
  // every live 1.x grant.
  'const appKey = homeV2AppIdentityKey(context)',
  // A hidden tab cannot raise a prompt.
  'isQdnViewVisible(context.windowId, context.tabId)',
  // Live resource check before AND after approval.
  'if (!liveResourceMatchesGrant(context))',
  'sameViewContext(context, freshContext)',
  // One pending prompt per (window, tab, app, protocol).
  'const grantKey = `notifications-manage|',
  // 60s timeout denies.
  '}, 60_000)',
  "resolve({ approved: false, scope: null })",
  // Only 'always' is accepted, and the grant is written only after approval.
  "if (!decision.approved || decision.scope !== 'always')",
  "grantQdnManagerPermission(appKey, 'notifications.manage')",
]) {
  assert.ok(desktopGate.includes(required), `the desktop notification manager gate must include: ${required}`);
}
// The grant write must be the LAST thing in the gate: nothing may create a
// grant on a denial path.
assert.ok(
  desktopGate.lastIndexOf("if (!decision.approved || decision.scope !== 'always')") <
    desktopGate.lastIndexOf("grantQdnManagerPermission(appKey, 'notifications.manage')"),
  'the durable grant must be written only after an approved always-scoped decision',
);
assert.ok(
  desktopGate.indexOf("grantQdnManagerPermission(appKey, 'notifications.manage')") >
    desktopGate.indexOf('sameViewContext(context, freshContext)'),
  'the durable grant must be written only after the post-approval staleness recheck',
);
assert.ok(
  !desktopGate.includes('sanitizeQdnCapabilityPrincipal'),
  'the manager gate must not rekey grants onto the canonical capability principal',
);
assert.ok(
  !/allowedScopes/.test(desktopGate) || desktopGate.includes("['always']"),
  'the desktop gate must never offer a session scope',
);

const desktopDispatch = readFunction(desktopBridge, 'handleHomeV2NotificationManagerAction');
// HAS_PERMISSION never prompts and never reads the store.
const hasPermissionBranch = desktopDispatch.slice(
  desktopDispatch.indexOf("if (request.kind === 'has-permission')"),
  desktopDispatch.indexOf('await requireHomeV2NotificationManagerPermission'),
);
assert.ok(
  hasPermissionBranch.includes("hasQdnManagerPermission(homeV2AppIdentityKey(context), 'notifications.manage')"),
  'NOTIFICATION_MANAGER_HAS_PERMISSION must answer from the capability store',
);
assert.ok(
  !hasPermissionBranch.includes('requireHomeV2NotificationManagerPermission'),
  'NOTIFICATION_MANAGER_HAS_PERMISSION must never prompt',
);
assert.ok(
  !hasPermissionBranch.includes('inspectNotificationStore'),
  'NOTIFICATION_MANAGER_HAS_PERMISSION must not depend on the notification store',
);
// Parse before prompt.
assert.ok(
  desktopDispatch.indexOf('parseHomeV2NotificationManagerRequest(action, requestValue)') <
    desktopDispatch.indexOf('await requireHomeV2NotificationManagerPermission'),
  'the request must be validated before a permission prompt can be raised',
);
// Staleness rechecked before the work and again after it.
assert.equal(
  desktopDispatch.match(/sameViewContext\(context, (fresh|completed)Context\)/g)?.length,
  2,
  'the desktop dispatch must recheck the view context before and after the store work',
);
assert.ok(desktopDispatch.includes('inspectNotificationStore()'), 'the desktop dispatch must use the fail-closed inspection seam');
assert.ok(
  !desktopDispatch.includes('readNotificationStore()'),
  'the manager must not use the empty-on-corruption reader 1.x used',
);
assert.ok(
  desktopBridge.includes('if (isHomeV2NotificationManagerAction(action)) {'),
  'the runtime dispatcher must route the manager family',
);

// ---------------------------------------------------------------------------
// Android dispatch posture.
// ---------------------------------------------------------------------------

for (const required of [
  "isAndroidHost && protocol === 'qdnRequest' && isHomeV2NotificationManagerAction(action)",
  'parseHomeV2NotificationManagerRequest(action,',
  "hasQdnManagerPermission(parsedApp.identityKey, 'notifications.manage')",
  "capability: 'notifications.manage'",
  "allowedScopes: ['always'],",
  "if (!decision.approved || decision.scope !== 'always')",
  "grantQdnManagerPermission(parsedApp.identityKey, 'notifications.manage')",
  'inspectNotificationStoreForManagement()',
  'readHomeV2NotificationManagerSummary(inspection)',
  'resolveHomeV2NotificationManagerMutation(inspection, managerRequest)',
  'managerRequest.expectedRevision',
  'QDN manager request is stale because the app view changed before it could run.',
  'QDN manager request is stale because the app view changed while it was running.',
]) {
  assert.ok(androidHost.includes(required), `the Android notification manager branch must include: ${required}`);
}
assert.ok(
  androidHost.indexOf("hasQdnManagerPermission(parsedApp.identityKey, 'notifications.manage')") <
    androidHost.indexOf("grantQdnManagerPermission(parsedApp.identityKey, 'notifications.manage')"),
  'Android must check for an existing grant before prompting',
);
// Both hosts must share ONE validator.
for (const [name, source] of [['desktop', desktopBridge], ['android', androidHost]] as const) {
  assert.ok(
    source.includes('home-v2-notification-manager-contract'),
    `${name} must use the shared notification manager contract, not a private copy`,
  );
  assert.ok(
    !source.includes('sanitizeQdnNotificationManagerMutation('),
    `${name} must not re-derive the mutation outside the shared contract`,
  );
}
// The response shape comes from notification-manager.ts, unchanged.
assert.ok(
  contract.includes("from './notification-manager.js'") &&
    contract.includes('getQdnNotificationManagerSummary') &&
    contract.includes('applyQdnNotificationManagerMutation') &&
    contract.includes('sanitizeQdnNotificationManagerMutation'),
  'the contract must reuse the 1.x summary/mutation implementation verbatim',
);

// ---------------------------------------------------------------------------
// Prompt types and copy.
// ---------------------------------------------------------------------------

assert.ok(promptTypes.includes("| 'notifications.manage'"), 'the prompt capability union must include notifications.manage');
for (const action of HOME_V2_NOTIFICATION_MANAGER_ACTIONS) {
  if (action === 'NOTIFICATION_MANAGER_HAS_PERMISSION') {
    assert.ok(
      !promptTypes.includes(`| '${action}'`),
      'NOTIFICATION_MANAGER_HAS_PERMISSION must not be a promptable action: it never prompts',
    );
    continue;
  }
  assert.ok(promptTypes.includes(`| '${action}'`), `${action} must be a promptable action`);
}
// Both prompt paths in the shell — the desktop one driven by the main-process
// IPC request, and the Android inline one — must offer ONLY 'always'.
assert.match(
  androidHost,
  /: isNotificationManager\s+\? \['always'\]/,
  "the desktop manager prompt must offer only the 'always' scope",
);
// The Android inline prompt block for this capability must end in an
// always-only scope list, and must not offer a session or single-request one.
const androidManagerPrompt = androidHost.slice(
  androidHost.indexOf("capability: 'notifications.manage'"),
  androidHost.indexOf('const approvedTab = productStateRef.current'),
);
assert.ok(androidManagerPrompt.length > 0, 'the Android manager prompt block must be locatable');
assert.match(androidManagerPrompt, /allowedScopes: \['always'\],/);
assert.ok(
  !androidManagerPrompt.includes("'session'") && !androidManagerPrompt.includes("'single-request'"),
  'the Android manager prompt must not offer a session or single-request scope',
);

// The prompt must disclose that this is authority over OTHER apps.
assert.match(
  androidHost,
  /wants to review and change which OTHER apps may notify you on this device/,
  'the manager prompt must say the capability covers other apps',
);
assert.match(
  androidHost,
  /Cannot do', value: 'Create a rule/,
  'the manager prompt must say what the capability cannot do',
);

// ---------------------------------------------------------------------------
// Revocability. A durable grant that cannot be taken back is a one-way door.
// ---------------------------------------------------------------------------

assert.match(
  settingsContract,
  /const REVOCABLE_CAPABILITIES = \[[^\]]*'notifications\.manage'/s,
  'notifications.manage must be revocable from trusted Home settings',
);
assert.ok(
  settingsContract.includes("grantsFor('notifications.manage')"),
  'the settings state must surface notification manager grants',
);
assert.ok(
  settingsUi.includes("capability=\"notifications.manage\"") &&
    settingsUi.includes('data-qdn-notification-manager-grant'),
  'QDN Apps settings must render a revocable card for the notification manager grant',
);
// Manager revocation and managed-app revocation must not read as the same row.
assert.ok(
  settingsUi.includes('home-v2-qdn-notification-manager-controls-title') &&
    settingsUi.includes('home-v2-qdn-notification-controls-title'),
  'the manager grant list and the per-app notification list must be separate sections',
);

// ---------------------------------------------------------------------------
// Live updates. The delivery machinery existed; v2 never wired a producer.
// ---------------------------------------------------------------------------

assert.ok(
  livePreload.includes("ipcRenderer.invoke('qdn-views:updateManagerRevisions', request)"),
  'the Home 2 preload must expose the manager-revision announcement channel',
);
assert.ok(
  androidHost.includes('bridge.updateManagerRevisions?.({'),
  'the Home 2 shell must push manager revisions to open app views',
);
assert.ok(
  androidHost.includes('notificationManager: notificationManagerRevision'),
  'the pushed revisions must include the notification manager revision',
);
assert.ok(
  appTabStage.includes('managerRevisions: managerRevisionsRef.current'),
  'a newly shown app view must be seeded with the current manager revisions',
);

console.log('Home 2 notification manager parity and posture pins passed.');
