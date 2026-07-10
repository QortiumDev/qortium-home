# `SHOW_NOTIFICATION` bridge action + app-controlled tab titles

## Goal

Give QDN apps two attention channels that Home previously had no equivalent
for:

1. **`SHOW_NOTIFICATION`** — a `qdnRequest` action that shows a system
   notification (Electron `Notification` on desktop, Capacitor
   `LocalNotifications` on Android), gated behind a per-app session
   permission.
2. **App-controlled tab titles** — the Home tab label follows the app's
   `document.title` (like a regular browser tab), falling back to the
   route-derived address when the app does not set one.

## Motivation / use case

Qortium Chat wants to alert the user about a new direct message or mention
while its tab is in the background — and to surface unread counts in its tab
label ("(3) Qortium Chat"). Any app with asynchronous events (mail, forums,
trades) has the same need. Neither feature existed in Home; Qortal Hub has a
subscription-based notification pipeline but no direct app-triggered
notification and no tab-title control.

## Q-App usage

```ts
// Feature-detect (SHOW_ACTIONS includes it on every node mode)
const actions = await qdnRequest({ action: 'SHOW_ACTIONS' });
const canNotify = actions.includes('SHOW_NOTIFICATION');

// First call per app+tab+session prompts the user; later calls are silent.
const outcome = await qdnRequest({
  action: 'SHOW_NOTIFICATION',
  title: 'New message from Alice',   // required, ≤160 chars after sanitizing
  text: 'Hey, are you around?',      // optional, ≤240 chars after sanitizing
});
// outcome: { shown: true }
//       or { shown: false, reason: 'focused' | 'rate-limited' | 'disabled' | 'unsupported' }
// A denied permission rejects with "Notification permission was denied."

// Tab title: plain document.title, no bridge call needed.
document.title = '(3) Qortium Chat';
document.title = '';                 // reverts the tab label to the address
```

## Behavior and gating

- **Permission**: the first `SHOW_NOTIFICATION` from an app opens the standard
  QDN permission dialog (no account row — notifications are app-scoped, not
  account-scoped) with session scope. The grant is cached per
  window/tab/app-resource for the session; denial rejects the request and the
  next call prompts again.
- **Focus suppression**: `{ shown: false, reason: 'focused' }` while the app's
  view is visible in a focused window — no notification when the user is
  already looking at the app.
- **Rate limit**: at most one notification per app per 3 seconds
  (`reason: 'rate-limited'`).
- **Global switch**: Display Settings → "App notifications" (default on).
  Off → `{ shown: false, reason: 'disabled' }`. The renderer mirrors the
  persisted value to the Electron main process on startup and on change
  (`qdn:setAppNotificationsEnabled`); Android reads the persisted display
  settings directly.
- **Provenance**: the shown title is always suffixed with the app's registered
  name (`"New message — qortium-chat"`) so an app cannot pose as another app
  or as Home.
- **Click** (desktop): focuses the window and selects the app's tab
  (`qdn-app:notification-clicked` → `selectTab`). Android tap opens the app
  (no tab selection wiring yet — follow-up).
- **Sanitizing**: titles/text strip control and bidi-override characters,
  collapse whitespace, and are length-capped (`sanitizeAppTitle` in
  `electron/qdn-views.ts`, `sanitizeQdnAppTitle` in `src/qdn.ts`).

## Tab titles

- **Desktop**: `page-title-updated` on the isolated `WebContentsView` →
  `qdn-views:app-title-changed` IPC → `App.tsx` keeps a per-tab
  `qdnAppTitles` map consulted by the tab summaries. `explicitSet === false`
  (Chromium falling back to the URL) clears the label to the route default.
- **Android**: the injected bridge script (in
  `android/.../QdnBridgeWebViewClient.java`) watches `document.title` with a
  MutationObserver and posts `{ type: 'qortium:qdn-title', bridgeToken, title }`
  to the host; `QdnBridgeFrameContent` forwards it up as `onAppTitleChange`.
- Titles are presentational only: route changes clear them, and bookmarks,
  dashboard pins, and closed-tab history keep route-derived labels. The
  address bar always shows the route URL — apps cannot spoof it.

## Files changed

- `electron/qdn-app-actions.ts` — `SHOW_NOTIFICATION` in the action list.
- `electron/qdn.ts` — `showNotificationForApp` (validation, session
  permission via the write-approval dialog, enabled/focus/rate gates, Electron
  `Notification`, click → focus tab), `qdn:setAppNotificationsEnabled` IPC.
- `electron/qdn-views.ts` — `sanitizeAppTitle`, `isQdnViewFocused`,
  `page-title-updated` forwarding.
- `electron/preload.cts` + `src/vite-env.d.ts` — `setAppNotificationsEnabled`,
  `onNotificationClicked`, `onAppTitleChanged`.
- `src/platform.ts` — Android/browser mirror of `showNotificationForApp`
  (Capacitor `LocalNotifications` / web `Notification` fallback),
  `isViewFocused` context callback.
- `src/App.tsx` — dialog action label + account-row hiding, `qdnAppTitles`
  state + route-change pruning, notification-click tab selection, settings
  sync, `updateAppNotifications`.
- `src/QdnViewer.tsx` — `onAppTitleChange` threading, `qortium:qdn-title`
  handling, `suspended`-based `isViewFocused`.
- `src/displaySettings.ts`, `src/DisplaySettingsPanel.tsx`,
  `src/SettingsPage.tsx` — `appNotifications` setting + toggle UI.
- `android/.../QdnBridgeWebViewClient.java` — title watcher in the injected
  shim; `SHOW_NOTIFICATION` uses the long (180 s) request timeout so the
  permission prompt cannot time out at 30 s.
- `package.json` — `@capacitor/local-notifications` (declares
  `POST_NOTIFICATIONS`; runtime permission requested on first use).
- `src/i18n/locales/*` — `display.appNotifications*`,
  `qdnWrite.action.showNotification`.
- `scripts/smoke-desktop-qdn-write.mjs` — `app-notification` scenario.

## Verification

- `npm run build` and `npx tsc --noEmit -p tsconfig.json` clean.
- `node scripts/smoke-desktop-qdn-write.mjs --scenario=app-notification`
  (real Electron + local Previewnet node): deny → rejected; approve →
  `{ shown: true }`; cached permission (no re-prompt); missing title rejected
  without a dialog; `SHOW_ACTIONS` advertises the action; `document.title`
  drives the tab label and clearing it restores the route label.
- `--scenario=success` still passes (write-approval dialog regression check).
- `android/gradlew assembleDebug` compiles with the shim + plugin changes.
  On-device Android behavior (OS permission prompt, notification display)
  still needs a manual pass.

## Follow-ups / out of scope

- Home-side notifications while an app is **closed** (Hub-style
  `NOTIFICATION_ADD` subscription rules watching a core websocket) — tier 3,
  to be designed separately.
- Android notification tap → select the app's tab.
- Per-app notification revocation UI (currently session-scoped, so closing
  the tab or app forgets the grant).
