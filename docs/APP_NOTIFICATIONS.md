# `SHOW_NOTIFICATION` bridge action + app-controlled tab titles

## Goal

Give QDN apps two attention channels that Home previously had no equivalent
for:

1. **`SHOW_NOTIFICATION`** — a `qdnRequest` action that shows a system
   notification (Electron `Notification` on desktop, Capacitor
   `LocalNotifications` on Android), gated behind a durable per-app
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

// The first call per app prompts the user; the grant lasts until revoked.
const outcome = await qdnRequest({
  action: 'SHOW_NOTIFICATION',
  title: 'New message from Alice',   // required, ≤160 chars after sanitizing
  text: 'Hey, are you around?',      // optional, ≤240 chars after sanitizing
});
// outcome: { shown: true }
//       or { shown: false, reason: 'focused' | 'rate-limited' | 'disabled' | 'muted' | 'unsupported' }
// A denied permission rejects with "Notification permission was denied."

// Tab title: plain document.title, no bridge call needed.
document.title = '(3) Qortium Chat';
document.title = '';                 // reverts the tab label to the address
```

## Behavior and gating

- **Permission**: the first `SHOW_NOTIFICATION` or `NOTIFICATION_ADD` from an app opens the standard
  QDN permission dialog (no account row — notifications are app-scoped, not
  account-scoped) with "Until revoked in Settings" scope. One durable grant,
  keyed by the app's stable resource base, covers direct and background
  notifications. Denial rejects the request and the next call prompts again.
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

## Subscriptions (background notifications)

Home can keep watching Core after an app tab closes, as long as Home itself is
running. Apps manage this through four actions:

- `NOTIFICATION_HAS_PERMISSION` returns `{ granted: boolean }` without prompting.
- `NOTIFICATION_ADD` validates and adds or replaces rules by `notificationId`.
  It prompts for the durable grant when needed and stores at most 20 rules per app.
- `NOTIFICATION_GET` returns the calling app's stored rules without prompting.
- `NOTIFICATION_REMOVE` removes the requested `notificationIds`, or every rule
  for the app when `notificationIds` is omitted.

```ts
await qdnRequest({
  action: 'NOTIFICATION_ADD',
  subscriptions: [{
    notificationId: 'direct-messages',
    event: 'CHAT_MESSAGE',
    filters: { involving: selectedAddress },
    title: 'New chat message',
    text: 'Open Chat to read it',
    link: 'qdn://APP/Chat/Chat',
  }],
});
```

`notificationId` is 1–64 letters, numbers, dots, underscores, or hyphens.
`title` and `text` use the same sanitizing as direct notifications and are
limited to 160 and 240 characters. `link` may be a `qdn://`, `home://`, or
`core://` address and defaults to the registering app's resource URL.

Supported events and filters are:

- `RESOURCE_PUBLISHED`: `service`, `names`, `identifier`, `title`,
  `description`, `keywords`, `query`, `prefix`, `defaultResource`,
  `followedOnly`, `excludeBlocked`, `after`, and `before`.
- `PAYMENT_RECEIVED`: `recipient`, `sender`, `amount`, `created`, and
  `signature`, with at least `recipient` or `sender` required. `amount` is a
  non-empty string and `created` is a finite number; both are matched by the
  node using exact string equality, so apps should use the values exactly as
  Core represents them.
- `CHAT_MESSAGE`: `recipient`, `sender`, `txGroupId`, or `involving`, with at
  least one required. Message content is never delivered by this event.
- `TRANSACTION_CONFIRMED`: `signature`, `address`, `groupId`, and optional `txType`, with
  at least `signature`, `address`, or `groupId` required. `groupId` is a string
  (for example, `"123"`) and accepts one value or an OR array, so an administrator
  can watch multiple groups in one rule. `txType` accepts either one enum
  name string or an array of enum name strings (trimmed, uppercased, and
  deduplicated by Home). Multi-value arrays have identical matching behavior
  everywhere: with Core 1.4.0 or newer, Home sends the array to the node for
  narrower pushed events; with older Cores, it filters the pushed events
  client-side instead.
- `FOREIGN_PAYMENT_RECEIVED`: `coin` and `xpub`, both required non-empty strings.
  Home trims and uppercases `coin`; it deliberately does not maintain a coin
  allowlist because Core decides which ElectrumX-backed coins it supports (ARRR
  is not supported). These rules count toward the same 20-rules-per-app limit.
  Core also caps foreign-payment rules per websocket session, and Home merges
  every app's rules into one session, so Home sends at most 20 foreign-payment
  subscriptions across all apps combined and drops the overflow rather than
  letting the node reject the combined subscription.

Apps always pass the filter under `filters` in `NOTIFICATION_ADD`; Home maps it
to the node's wire format when it subscribes — the rich `RESOURCE_PUBLISHED`
filter is sent as the node's typed `resourceFilter` object, while the other
events' filters are sent as the generic string map the node matches
case-insensitively (`electron/notification-rules.ts` `toWireNotificationSubscription`).
For a multi-value `txType`, Home automatically reads the configured node's
`/admin/info` `buildVersion`: Core 1.4.0 or newer receives the array on the
server side, while older Cores receive only the required `signature`/`address`
anchor and Home suppresses pushed transactions whose `data.type` is not in the
array.

When `text` is omitted, Home derives a sanitized default body from the pushed
event data when possible: transaction type and sender for
`TRANSACTION_CONFIRMED`, amount and sender for `PAYMENT_RECEIVED`, and sender
or group id for `CHAT_MESSAGE`. A `FOREIGN_PAYMENT_RECEIVED` notification uses
`Received <amount> <coin>`. Addresses are shortened, unsafe control and
bidirectional-override characters are removed, whitespace is collapsed, and
the result is capped at 240 characters. `RESOURCE_PUBLISHED` continues to use
an empty default body. An explicit `text` always wins.

### Group transaction confirmations (Core 1.5.0+)

Core 1.5.0 adds `groupId` as both a `TRANSACTION_CONFIRMED` generic filter and
an anchor. It matches pushed event data case-insensitively. Home sends it as a
string or OR array on Core 1.5.0 and newer. On older Cores, a rule anchored
only by `groupId` is omitted completely because that Core rejects the anchor
and does not push `groupId` for Home to match. If the rule also has a signature
or address anchor, Home sends that compatible anchor but omits the `groupId`
constraint; apps that require strict group filtering should require Core 1.5.0.

### Foreign payment receipts (Core 1.5.0+)

Foreign-payment rules require Core 1.5.0 or newer. Home sends one generic
subscription per rule in this shape:

```json
{
  "event": "FOREIGN_PAYMENT_RECEIVED",
  "filters": { "coin": "BTC", "xpub": "<extended public key>" }
}
```

For example, a wallet app can register a background rule that opens itself:

```ts
await qdnRequest({
  action: 'NOTIFICATION_ADD',
  subscriptions: [{
    notificationId: 'btc-receipts',
    event: 'FOREIGN_PAYMENT_RECEIVED',
    filters: { coin: 'btc', xpub: accountXpub },
    link: 'qdn://APP/Wallet',
  }],
});
```

The xpub gives the configured Core node a watch-only view of that wallet's
address history. It cannot spend funds, but apps must present this privacy
tradeoff clearly. Home suppresses replayed receipt pushes after reconnects
using Core's `checkpoint` together with the coin, transaction hash, and
address. On Core 1.4.x or earlier Home omits every foreign-payment rule from
the combined websocket subscription, so those nodes cannot reject unrelated
rules.

Rules are tagged with the active account address when registered. Home sends
only rules tagged for the currently active account, and apps should register
again after `SELECTED_ACCOUNT_CHANGED`. Desktop keeps one websocket at
`/websockets/notifications`; Android keeps the equivalent foreground watcher.
The entire websocket subscription is replaced on connect and whenever rules,
grants, the active account, or node settings change. No socket is held open
when there are no eligible rules.

For each pushed event, Home applies gates in this order: global notification
switch, durable grant and per-app mute, per-app rate limit, then focused-app
suppression. Muting preserves the grant and rules. Revoking in Settings deletes
both the grant and all of that app's rules. A subscription notification click
focuses/restores Home and opens the rule link (or the app itself) in a new tab.

The desktop `app-subscription` smoke scenario adds and reads a matching
`RESOURCE_PUBLISHED` rule, publishes a real fixture, accepts either a fired
notification or focused suppression from the watcher smoke log, removes and
re-reads the rule, and deletes the fixture resource.

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
- `electron/notification-rules.ts`, `electron/notification-store.ts`, and
  `electron/notification-watcher.ts` — shared rule validation, durable desktop
  persistence, and the single Core websocket watcher.
- `src/notificationStore.ts`, `src/notificationWatcher.ts`, and
  `src/AppNotificationsSettingsPanel.tsx` — the Android/browser store and
  foreground watcher plus the per-app Settings controls.
- `scripts/smoke-desktop-qdn-write.mjs` — `app-subscription` scenario.

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

- Android background execution after Home itself is suspended or terminated;
  the v1 Android watcher is foreground-only.
