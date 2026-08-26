/**
 * Parity and posture pins for the app-facing Home-settings bridge.
 *
 * Precedent: home-v2-notification-manager-parity.test.ts. Home has no test CI
 * that can drive a real Electron window, so the properties a security review
 * cares about — "the update is single-request and never durable", "the reads
 * never prompt", "the app never touches the trusted policy IPC", "a read
 * returns nothing but the seven keys" — are pinned against the source text of
 * the two dispatchers. A refactor that removes one of these lines fails here
 * rather than silently widening the surface.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { QDN_HOME_SETTINGS_ACTIONS } from './qdn-app-actions.js';
import {
  HOME_V2_HOME_SETTINGS_ACTIONS,
  HOME_V2_HOME_SETTINGS_PROMPTED_ACTION,
  HOME_V2_HOME_SETTINGS_UNPROMPTED_ACTIONS,
} from './home-v2-home-settings-contract.js';
import { getHomeV2AppActions } from './home-v2-app-actions.js';
import { HOME_V2_ROUTE_INDEPENDENT_ACTIONS } from './home-v2-app-runtime.js';
import {
  HOME_V2_ACCOUNT_READ_ACTIONS,
  HOME_V2_PERMISSIONLESS_ACTIONS,
  isHomeV2PermissionlessAction,
} from './home-v2-session-grants.js';

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
  '../electron/home-v2-home-settings-contract.ts',
  './home-v2-home-settings-contract.ts',
);
const rendererClient = readRepoSource(
  '../src/home-v2-live/home-settings-client.ts',
  './src/home-v2-live/home-settings-client.ts',
);
const livePreload = readRepoSource('../electron/home-v2-live-preload.cts', './home-v2-live-preload.cts');
const promptTypes = readRepoSource('../src/v2/bridge-permissions.ts', './src/v2/bridge-permissions.ts');
const appRuntime = readRepoSource('../electron/home-v2-app-runtime.ts', './home-v2-app-runtime.ts');
const appTabStage = readRepoSource('../src/v2/shell/AppTabStage.tsx', './src/v2/shell/AppTabStage.tsx');

// ---------------------------------------------------------------------------
// Parity: the v2 surface is EXACTLY the 1.x three, and no more.
// ---------------------------------------------------------------------------

assert.deepEqual(
  [...HOME_V2_HOME_SETTINGS_ACTIONS].sort(),
  [...QDN_HOME_SETTINGS_ACTIONS].sort(),
  'Home 2 must expose exactly the Home settings actions Home 1.x exposed',
);

const qdnActions = getHomeV2AppActions('qdnRequest');
const qortalActions = getHomeV2AppActions('qortalRequest');
for (const action of HOME_V2_HOME_SETTINGS_ACTIONS) {
  assert.ok(qdnActions.includes(action), `${action} must be advertised on qdnRequest`);
  assert.ok(
    !qortalActions.includes(action),
    `${action} must NOT be advertised on qortalRequest: Home has one appearance, not one per chain`,
  );
  assert.ok(
    (HOME_V2_ROUTE_INDEPENDENT_ACTIONS as readonly string[]).includes(action),
    `${action} must be route-independent: it touches no node`,
  );
}

// ---------------------------------------------------------------------------
// Posture: the update prompts, single-request only, and is never durable.
// ---------------------------------------------------------------------------

// Not permissionless. The two reads are answered without a prompt by their own
// dispatch path, but the WRITE must never be able to fall through a
// permissionless shortcut.
assert.equal(isHomeV2PermissionlessAction(HOME_V2_HOME_SETTINGS_PROMPTED_ACTION), false);
assert.ok(
  !(HOME_V2_PERMISSIONLESS_ACTIONS as readonly string[]).includes('UPDATE_HOME_SETTINGS'),
  'UPDATE_HOME_SETTINGS must not be listed as permissionless',
);

// None of the three belongs to the account-read grant family. They carry no
// account data at all, and folding a read of the user's theme into the durable
// account.read grant would make that grant mean something broader than its own
// prompt says.
for (const action of HOME_V2_HOME_SETTINGS_ACTIONS) {
  assert.ok(
    !(HOME_V2_ACCOUNT_READ_ACTIONS as readonly string[]).includes(action),
    `${action} must not be part of the account-read family`,
  );
  assert.ok(
    !(HOME_V2_PERMISSIONLESS_ACTIONS as readonly string[]).includes(action),
    `${action} must not be listed in the account-scoped permissionless set`,
  );
}

// Only the update is promptable. The prompt type union is the trusted shell's
// own allowlist of actions a prompt may be raised for, so a read appearing here
// would be a read that could raise a modal.
assert.ok(
  promptTypes.includes("| 'UPDATE_HOME_SETTINGS'"),
  'UPDATE_HOME_SETTINGS must be a promptable action',
);
for (const action of HOME_V2_HOME_SETTINGS_UNPROMPTED_ACTIONS) {
  assert.ok(
    !promptTypes.includes(`| '${action}'`),
    `${action} must never be a promptable action: it does not prompt`,
  );
}

// The capability exists and is documented as never-durable.
assert.ok(promptTypes.includes("| 'home.settings.write'"), 'the capability must be declared');

// Single-request at BOTH ends: the desktop bridge refuses any other scope, and
// the shell offers no other scope. Either line alone would be a gap.
assert.ok(
  /decision\.scope !== 'single-request'/.test(desktopBridge),
  'the desktop bridge must accept only a single-request approval',
);
assert.ok(
  desktopBridge.includes('writeSingleRequestOnly: true'),
  'the desktop prompt must be marked single-request only',
);
assert.ok(
  /isHomeSettingsUpdate\s*\?\s*\['single-request'\]/.test(androidHost),
  'the shell must offer only the single-request scope for a Home settings update',
);
assert.ok(
  /allowedScopes: \['single-request'\]/.test(androidHost),
  'the Android prompt must offer only the single-request scope',
);
assert.ok(
  /decision\.scope !== 'single-request'/.test(androidHost),
  'the Android dispatch must accept only a single-request approval',
);

// No durable grant is ever stored for this capability. If any of these appear,
// the "one approval, one patch" posture has been quietly abandoned.
assert.ok(
  !/grantQdnManagerPermission\([^)]*home\.settings/.test(desktopBridge),
  'a Home settings approval must never write a durable manager grant',
);
assert.ok(
  !/grantQdnManagerPermission\([^)]*home\.settings/.test(androidHost),
  'a Home settings approval must never write a durable manager grant on Android',
);
assert.ok(
  !/hasQdnManagerPermission\([^)]*home\.settings/.test(desktopBridge + androidHost),
  'a Home settings request must never consult a durable grant store',
);

// The prompt must name what changes. A prompt carrying no per-key rows is
// refused by the shell rather than rendered as a bare category.
assert.ok(
  desktopBridge.includes('homeSettingsDetails'),
  'the desktop prompt must carry the per-key approval rows',
);
assert.ok(
  androidHost.includes('isHomeSettingsDetailRows'),
  'the shell must validate the per-key rows it renders',
);
assert.ok(
  androidHost.includes('getHomeV2HomeSettingsApprovalDetails'),
  'the Android prompt must derive its rows from the shared contract',
);

// Parsing happens before the prompt on both hosts, so a malformed patch cannot
// be used to raise a prompt the user would otherwise never see.
// The CALL site, not the definition, which appears earlier in the file.
assert.ok(
  desktopBridge.indexOf('parseHomeV2HomeSettingsRequest(action, requestValue)') <
    desktopBridge.indexOf('await requestHomeV2HomeSettingsUpdateApproval('),
  'the desktop bridge must parse before it prompts',
);
assert.ok(
  androidHost.indexOf('parseHomeV2HomeSettingsRequest(') <
    androidHost.indexOf("title: 'Allow this change to Home settings?'"),
  'the Android host must parse before it prompts',
);

// Staleness is rechecked after approval and after the write, matching the
// bookmark and notification-manager dispatches.
assert.ok(
  /Home settings request is stale because the app view changed before it could run/.test(desktopBridge),
  'the desktop bridge must recheck staleness after approval',
);
assert.ok(
  /Home settings request is stale because the app view changed while it was running/.test(desktopBridge),
  'the desktop bridge must recheck staleness after the write',
);
assert.ok(
  /Home settings request is stale because the app view changed before approval/.test(androidHost),
  'the Android host must recheck staleness after approval',
);

// ---------------------------------------------------------------------------
// Posture: the app never touches the trusted notification-policy IPC.
// ---------------------------------------------------------------------------

// The main process does not own these settings and must not read or write
// them: it asks the shell. If the desktop bridge ever gained a direct policy or
// appearance store call, the whole indirection would be gone.
assert.ok(
  desktopBridge.includes("hostWindow.webContents.send('home-v2-app:home-settings-request'"),
  'the desktop bridge must ask the shell rather than reading settings itself',
);
assert.ok(
  !/home-v2-notification-policy:(get|set)/.test(desktopBridge),
  'the app bridge must never call the trusted notification-policy IPC',
);
// The renderer client reaches neither the preload nor an IPC channel: every
// store it touches arrives as an injected dependency, which is what makes the
// write path the same code on desktop and on Android.
assert.ok(
  !/ipcRenderer|window\.[A-Za-z_$]/.test(rendererClient),
  'the renderer client must not reach a bridge or IPC channel directly',
);
assert.ok(
  rendererClient.includes('setNotificationPolicy:') &&
    rendererClient.includes('applyAppearance:'),
  'both stores must reach the renderer client as injected dependencies',
);

// The preload exposes the round-trip and NOTHING that reads or writes a
// setting: it carries an opaque envelope in each direction.
assert.ok(
  livePreload.includes("ipcRenderer.on('home-v2-app:home-settings-request'"),
  'the v2 preload must deliver the round-trip request',
);
assert.ok(
  livePreload.includes("ipcRenderer.invoke('home-v2-app:resolveHomeSettingsRequest'"),
  'the v2 preload must carry the round-trip reply',
);

// The live-change producer 1.x had and Home 2 lacked. Without this an app
// listening for `qortium:home-settings-changed` hears nothing on Home 2.
assert.ok(
  livePreload.includes("ipcRenderer.invoke('qdn-views:broadcastHomeSettingsChanged'"),
  'the v2 preload must expose broadcastHomeSettingsChanged',
);
assert.ok(
  androidHost.includes('broadcastHomeSettingsChanged({'),
  'the shell must announce Home settings changes to open app views',
);

// ---------------------------------------------------------------------------
// Posture: a read discloses the seven keys and nothing else.
// ---------------------------------------------------------------------------

// The reply is built from the schema projection, not by spreading whatever the
// renderer holds — the appearance object also carries resolvedTheme and
// resolvedLanguage, and the shell holds node URLs and account state besides.
assert.ok(
  rendererClient.includes('projectHomeV2HomeSettings('),
  'the renderer must build a reply from the schema projection',
);
assert.ok(
  contract.includes('getWritableHomeSettings('),
  'the projection must come from the 1.x schema, not a re-derived key list',
);
// Both ends validate the envelope, so neither trusts the other's shape.
assert.ok(
  desktopBridge.includes('parseHomeV2HomeSettingsRoundTripResponse('),
  'the main process must validate the shell reply before forwarding it',
);
assert.ok(
  androidHost.includes('parseHomeV2HomeSettingsRoundTripRequest('),
  'the shell must validate the request main sent it',
);

// ---------------------------------------------------------------------------
// Posture: widgets see none of it.
// ---------------------------------------------------------------------------

// Pinned in the source as well as behaviourally (home-v2-app-runtime.test.ts),
// because the two reads match the GET_ prefix and would otherwise be admitted
// by default rather than by decision.
for (const action of HOME_V2_HOME_SETTINGS_UNPROMPTED_ACTIONS) {
  assert.ok(
    appRuntime.includes(`action === '${action}'`),
    `${action} must be excluded from widget public reads explicitly`,
  );
}

// ---------------------------------------------------------------------------
// Posture: the trusted prompt queue cannot be flooded.
// ---------------------------------------------------------------------------

// UPDATE_HOME_SETTINGS is single-request, so unlike the durable manager
// families it has no "already granted" early return to absorb repeats — an app
// can issue endless individually VALID updates. Desktop must therefore dedup
// equivalent requests and cap outstanding ones, as Android already does in
// queueAndroidPermissionPrompt.
// The decision itself is unit-tested in home-v2-home-settings-contract.test.ts,
// including the cross-window counting. What is pinned HERE is that the desktop
// gate delegates to it and — critically — hands it EVERY pending entry rather
// than pre-filtering by host window, which is what silently turned both caps
// into per-window limits the first time round.
assert.ok(
  /assertHomeV2HomeSettingsPromptAdmissible\(\s*Array\.from\(pendingAccountReads\.values\(\)\),/
    .test(desktopBridge),
  'the desktop gate must apply the caps across every window, unfiltered by host window',
);
assert.ok(
  desktopBridge.includes('buildHomeV2HomeSettingsGrantKey({'),
  'the desktop gate must build its dedup key from the shared contract',
);
// Pin that the entry is registered in pendingAccountReads, rather than in a
// private map none of the drains below would reach.
assert.ok(
  /pendingAccountReads\.set\(requestId, \{\s*appIdentityKey: appKey,\s*grantKey,/.test(desktopBridge),
  'a pending Home settings prompt must live in pendingAccountReads with its app key and dedup key',
);

// Window close drains that window's prompts. Without it they survived to their
// own 60s timeout while still occupying cap slots, so closing and reopening
// windows kept the ceiling occupied for windows that no longer exist.
const mainProcess = readRepoSource('../electron/main.ts', './main.ts');
assert.ok(
  mainProcess.includes('forgetHomeV2WindowPendingPrompts'),
  "window close must drain that window's pending prompts",
);
// 'closed', not 'close': a close can be prevented or diverted to the tray.
assert.ok(
  /window\.on\('closed', \(\) => forgetHomeV2WindowPendingPrompts\(/.test(mainProcess),
  'the drain must run on closed, not on a preventable close',
);
// The id must be captured before the listener — reading webContents inside
// 'closed' throws, because it is already destroyed by then.
assert.ok(
  /const pendingPromptWebContentsId = window\.webContents\.id;[\s\S]{0,400}?window\.on\('closed'/
    .test(mainProcess),
  'the webContents id must be captured before the closed listener',
);

// A committed app navigation replaces the document that asked, so its prompts
// go with it. Registered through a hook rather than an import, because
// qdn-views is imported BY the bridge and the reverse would be a cycle.
assert.ok(
  /onQdnViewNavigated\(\(\{ hostWebContentsId, tabId \}\) => \{\s*forgetHomeV2TabPendingHomeSettingsPrompts\(/
    .test(desktopBridge),
  "the bridge must drain a tab's Home settings prompts when its view navigates",
);
const qdnViewsSource = readRepoSource('../electron/qdn-views.ts', './qdn-views.ts');
assert.ok(
  !/from '\.\/home-v2-app-bridge\.js'/.test(qdnViewsSource),
  'qdn-views must not import the app bridge: that would make the pair circular',
);
// Bound to full-document navigation only. Hooking did-navigate-in-page too
// would cancel prompts during an SPA's own client-side routing, which changes
// no app-resource identity and is not a reason to drop a prompt.
assert.ok(
  /'did-navigate'[\s\S]{0,700}?notifyQdnViewNavigated\(entry\)/.test(qdnViewsSource),
  'view navigation must notify on a committed main-frame navigation',
);
assert.ok(
  !/'did-navigate-in-page'[\s\S]{0,300}?notifyQdnViewNavigated/.test(qdnViewsSource),
  'in-page navigation must NOT cancel prompts: it is the same document',
);

// ---------------------------------------------------------------------------
// Posture: widgets get the display state but NOT the settings event.
// ---------------------------------------------------------------------------

// No qdn-views test harness exists (it would need a real Electron window), so
// this is pinned against the source of the broadcast handler, in the same style
// as the rest of this file.
const broadcastHandler = (() => {
  const qdnViews = readRepoSource('../electron/qdn-views.ts', './qdn-views.ts');
  const start = qdnViews.indexOf("ipcMain.handle('qdn-views:broadcastHomeSettingsChanged'");
  assert.ok(start >= 0, 'the Home settings broadcast handler must exist');
  const end = qdnViews.indexOf('ipcMain.handle(', start + 1);
  return qdnViews.slice(start, end > start ? end : undefined);
})();

const displayAssignment = broadcastHandler.indexOf('entry.displaySettings =');
const widgetGuard = broadcastHandler.indexOf("entry.tabId.startsWith('widget:')");
const eventAssignment = broadcastHandler.indexOf('entry.pendingHomeSettingsEvent =');
assert.ok(
  displayAssignment >= 0 && widgetGuard >= 0 && eventAssignment >= 0,
  'the broadcast handler must assign display state, guard widgets, and assign the event',
);
// Display sync happens BEFORE the guard, so a widget still re-themes...
assert.ok(
  displayAssignment < widgetGuard,
  'widget display state must stay ungated: a widget must re-theme with the rest of Home',
);
// ...and the EVENT happens inside it, so a widget never receives a detail
// carrying appNotifications and appZoom — the very fields it is refused at the
// GET_HOME_SETTINGS gate.
assert.ok(
  widgetGuard < eventAssignment,
  'the Home settings EVENT must be withheld from widget views',
);

// ---------------------------------------------------------------------------
// Posture: Android apps actually receive the change event.
// ---------------------------------------------------------------------------

// Desktop injects a CustomEvent into the view; Android has no injection point,
// so the shell posts the same detail to the frame and the native bridge shim
// re-dispatches it as the identical CustomEvent.
assert.ok(
  appTabStage.includes("type: 'qortium:home-settings-changed'"),
  'the Android stage must post the Home settings change event',
);
// Pinned target origin, never a wildcard: this detail is the user's settings,
// and '*' would hand them to whatever the frame had navigated to.
assert.ok(
  /frameWindow\.postMessage\(\{\s*type: 'qortium:home-settings-changed',[\s\S]*?\}, new URL\(source\)\.origin\)/
    .test(appTabStage),
  'the Android settings event must be posted to the pinned proxy origin',
);
assert.ok(
  !/qortium:home-settings-changed[\s\S]{0,600}?postMessage\([\s\S]*?,\s*'\*'\)/.test(appTabStage),
  'the Android settings event must never be posted to a wildcard origin',
);
// appNotifications must be a real boolean or a hard-validating consumer drops
// the whole event, so nothing is posted while the policy is unread.
assert.ok(
  /typeof props\.appNotifications !== 'boolean'/.test(appTabStage),
  'Android must not post a settings event before the notification policy is read',
);
// The detail must carry the 1.x duplicate fields, which the desktop validator
// requires to be present and equal.
for (const field of ['lang:', 'language:', 'uiStyle:', 'appZoom:', 'appNotifications:']) {
  assert.ok(appTabStage.includes(field), `the Android settings detail must carry ${field}`);
}

// The event must be bound to the bridge TOKEN, not only to the origin.
//
// Every app on a node shares one render-proxy origin (QdnRenderProxy keys the
// proxy by node origin so apps keep their own storage across visits), so
// pinning targetOrigin confines delivery to the origin but NOT to the document.
// Without a token check, after a hard navigation to another servable
// same-origin document that was never issued a bridge, the parent could still
// deliver the user's theme, language, zoom and notification state into it.
const androidBridge = readRepoSource(
  '../android/app/src/main/java/org/qortium/home/QdnBridgeWebViewClient.java',
  './android/app/src/main/java/org/qortium/home/QdnBridgeWebViewClient.java',
);
const homeSettingsConsumerLines = androidBridge
  .split('\n')
  .filter((line) => line.includes("data.type!=='qortium:home-settings-changed'"));
assert.equal(
  homeSettingsConsumerLines.length,
  1,
  'the Android bridge must have exactly one settings-event consumer',
);
const homeSettingsConsumer = homeSettingsConsumerLines[0];
assert.ok(
  homeSettingsConsumer.includes('data.bridgeToken!==bridgeToken'),
  'the Android settings consumer must verify the bridge token, like its bridge-state neighbour',
);
// The check is unconditional, not verify-if-present: an "only when supplied"
// check would be bypassed by simply omitting the field.
assert.ok(
  !/data\.bridgeToken\s*&&/.test(homeSettingsConsumer),
  'the token check must not be skippable by omitting the field',
);

// Both producers must therefore SEND the token, or the check silently drops
// every event: Home 2's app stage, and Home 1.x's viewer.
function producerBody(source: string, from: string, to: string) {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `expected to find ${from}`);
  const end = source.indexOf(to, start + 1);
  return source.slice(start, end > start ? end : start + 600);
}
assert.ok(
  producerBody(appTabStage, "type: 'qortium:home-settings-changed'", '}, new URL(source).origin)')
    .includes('bridgeToken'),
  'the Home 2 producer must send the bridge token',
);
const legacyViewer = readRepoSource('../src/QdnViewer.tsx', './src/QdnViewer.tsx');
assert.ok(
  producerBody(legacyViewer, 'function postQdnHomeSettingsChanged', 'function postQdnManagerRevisionChanged')
    .includes('bridgeToken'),
  'the Home 1.x producer must send the bridge token, or the new check drops its events',
);

// ---------------------------------------------------------------------------
// The documented appearance-persistence window.
// ---------------------------------------------------------------------------

// Ordering makes the split write safe against every HANDLED failure, but not
// against process death: appearance is persisted by a debounced, unawaited
// save. That is a known and accepted limitation, and it must stay documented at
// the write site rather than decaying into folklore.
assert.ok(
  /KNOWN WINDOW/.test(rendererClient),
  'the appearance-persistence window must be documented at the write site',
);
assert.ok(
  readRepoSource('../docs/HOME_SETTINGS_BRIDGE.md', './docs/HOME_SETTINGS_BRIDGE.md')
    .includes('eventually consistent'),
  'the appearance-persistence window must be documented for app authors',
);

console.log('Home v2 Home settings parity and posture tests passed.');
