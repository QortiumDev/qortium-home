# Home 2 context menus

## Changelog

### 2026-08-26 - feat(home-v2): native right-click link menu inside app views

Added a Home-owned native right-click menu for links inside a running QDN app
view (desktop). Right-clicking an `<a href="qdn://…">`/`qortal://…` link now
offers "Open in new tab" (for browser-archive services) and "Copy resource
link"; a text selection with no actionable link offers "Copy". This reuses the
same validation, item set, and open path as the app-invoked
`SHOW_CONTEXT_MENU`. See "Native link context menu" below.

Home 2 exposes a versioned, Home-owned context menu through both app bridge
facades. Apps provide a structured subject and an optional pointer anchor;
Home validates the subject, chooses the fixed actions and labels, renders the
menu, performs the selected safe host operation, and returns the outcome.

Feature-detect `SHOW_CONTEXT_MENU` through `SHOW_ACTIONS`. Standalone Core
`/render` pages do not advertise or implement this action because they have no
trusted Home UI host.

## Request and result

Use `qdnRequest` for Qortium subjects and `qortalRequest` for Qortal subjects.
The protocol is the trusted network selector. A resource address must use the
matching `qdn://` or `qortal://` scheme.

```js
const result = await qdnRequest({
  action: 'SHOW_CONTEXT_MENU',
  version: 1,
  target: {
    kind: 'account',
    address: 'Q...',
    name: 'Optional public name',
  },
  // Optional CSS-pixel coordinates relative to the requesting app viewport.
  anchor: { x: event.clientX, y: event.clientY },
});
```

Version 1 accepts these targets:

- Account: `{ kind: 'account', address, name? }`
- Group: `{ kind: 'group', groupId, name? }`
- Resource: `{ kind: 'resource', address }`, where `address` is a complete
  network-matching QDN address for any service.

Home returns one of:

```js
{ version: 1, status: 'handled', action: 'account.copy-address' }
{ version: 1, status: 'dismissed' }
```

The initial safe action set is:

| Subject | Home actions |
| --- | --- |
| Account | Copy address; copy supplied public name |
| Group | Copy group ID; copy supplied public name |
| `APP`, `WEBSITE` or `GAME` resource | Open in a new tab; copy resource link |
| Other resource service | Copy resource link |

`APP`, `WEBSITE` and `GAME` are the QDN browser-archive services — the ones
Home can execute as browser content in an app tab. The canonical list lives in
`electron/qdn-browser-archive-services.ts`; the menu gate reads it through
`isQdnBrowserArchiveService` rather than naming services itself. Every other
service is viewer content and stays copy-only here.

Names are optional display/copy values, not authority. Home validates the
address, group ID, protocol, resource scheme, service, path segments and
lengths before displaying anything. Later profile, chat, payment, membership,
viewer, bookmark and rating actions must use their existing typed Home
operation and approval paths; selecting a context item must never become a
permission bypass.

## Host behavior and lifecycle

Desktop uses an Electron native popup menu because isolated `WebContentsView`
content composites above Home's React document. Home derives the requesting
view from the bridge sender, clamps untrusted app coordinates to that view,
and translates them through the same host zoom used for view bounds. Android
uses a Home-owned bottom sheet with keyboard-menu semantics and ignores the
desktop anchor for placement.

Only one menu may be pending for an app tab. The requesting tab must be active
and visible. Tab closure, navigation, account/network invalidation or another
stale app context dismisses or rejects the pending action. Home rechecks the
live sender, tab and resource identity after native dismissal and before
performing the selected operation.

Normal click behavior remains app-owned. Apps should invoke the bridge from
their `contextmenu`, keyboard Context Menu/Shift+F10, or touch long-press
handling and use a small local fallback when `SHOW_ACTIONS` omits the action.

## Native link context menu

Everything above is the app-invoked menu: an app deliberately calls
`SHOW_CONTEXT_MENU` about a subject it names. Separately, Home also provides a
native right-click menu for **links the user right-clicks inside the app view**,
so a plain `<a href="qdn://…">` behaves like a link in a browser without the app
having to wire anything.

This lives in the desktop view host (`electron/qdn-views.ts`,
`showQdnViewLinkContextMenu`), attached to each app view's `webContents`
`context-menu` event. It is deliberately narrow:

- **Only app tabs.** It is never bound to widget views or the Home shell
  renderer — only to full QDN app tabs.
- **Acts only on trusted event params.** The menu is built from
  `params.linkURL` and `params.selectionText`, both supplied by Chromium on the
  main-process `context-menu` event. Nothing a page script can inject into a
  menu is ever read. Menu labels and the executed operation come from the same
  Home-owned backend (`getHomeV2ContextMenuItems` /
  `getHomeV2ContextMenuOperation`) as the app-invoked menu, so the two menus
  stay identical.
- **Only qdn/qortal links are actionable.** The link scheme selects the network
  (qdn → Qortium, qortal → Qortal), exactly as an app choosing the
  `qdnRequest`/`qortalRequest` facade would. The link is validated through
  `normalizeHomeV2ContextMenuRequest`; a `javascript:`, `data:`, `file:`,
  `http(s):` or `about:blank` link resolves to no resource target and gets no
  open or copy action.
- **No account binding from the link.** A resource address names a
  service/name/path only — never an account. "Open in new tab" reuses the exact
  `home-v2-app:open-address` path the app-invoked "Open in new tab" uses, so the
  new tab inherits the selected Home account and the resolved resource's own
  identity through `openAddress`, and picks up WEBSITE/GAME + viewer-alias
  routing. An app cannot open a tab bound to an account it does not own.
- **Menu contents.** For a browser-archive service (`APP`, `WEBSITE`, `GAME`):
  "Open in new tab" and "Copy resource link". For any other service: "Copy
  resource link" only. For a non-link right-click with a text selection: "Copy".
  For plain content with neither, no menu appears.
- **Live re-check.** After native dismissal and before performing the selected
  operation, Home re-checks that the view is still the same live, focused,
  visible app tab on the same resource; a navigation between the right-click and
  the selection drops the action.
