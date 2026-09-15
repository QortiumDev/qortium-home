# Home 2 context menus

## Changelog

### 2026-09-15 - docs: version 2 contract (accounts and groups first)

Specified `SHOW_CONTEXT_MENU` version 2: host-provided cross-app items
(Account info, Send message, Send coins, View ratings, View on explorer; Group
info, Open group chat) routed through assigned-app roles, app-supplied `omit`
and custom `items`, and feature detection through `GET_HOST_INFO`. Nothing in
this entry is implemented yet; see "Version 2" below and the tracker in the
owner's AGENTS notes.

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

## Version 2

Version 1 is used by no published app: copying and opening are one line of app
code, so every app hand-rolls its per-item actions and hard-codes the other
apps it links to (`qdn://APP/Chat/Chat?address=…`, `?account=…`,
`?_route=/address/…`). Version 2 exists for the items an app cannot do well by
itself — the ones that lead into *another* app — and lets an app trim or extend
the menu. The first slice covers **account** and **group** subjects; resource
additions (Pin to Dashboard, Add bookmark, Save) and a menu for plain links are
later slices.

Two rules keep the security clause above true:

1. **Host items navigate; they never execute.** Every Home-provided item resolves
   to one of three host operations: copy to the clipboard, open an address in a
   new tab (bound to the *originating* tab's account, as today), or a Home-chrome
   operation Home already owns (pin, bookmark, viewer, save). "Send coins" opens
   the wallet-role app with the recipient filled in; it does not sign anything.
   No item performs a write that would need a permission, so selecting one is
   never a permission bypass. Join/Leave group is deliberately not a host item.
2. **Apps customise; they never impersonate.** An app may omit any host item and
   add its own, but its items are rendered in a separate, attributed group and a
   custom label may not match a host label.

### Request

```js
const result = await qdnRequest({
  action: 'SHOW_CONTEXT_MENU',
  version: 2,
  target: { kind: 'account', address: 'Q...', name: 'Optional public name' },
  anchor: { x: event.clientX, y: event.clientY },
  // Host items to leave out. Unknown ids are ignored.
  omit: ['account.send-message'],
  // App items, rendered after the host items in their own group.
  items: [
    { id: 'block', label: 'Block sender' },
    { id: 'mention', label: 'Mention', enabled: false },
  ],
});
```

Targets are the version 1 targets. `omit` and `items` are optional. Limits:
at most 8 items; `id` matches `^[a-z0-9-]{1,32}$` and is unique; `label` is
1–40 visible characters with no control characters and must not equal any
host label for that subject, compared case-insensitively — Home rejects the
whole request otherwise. There are no icons, submenus, checkmarks or
app-chosen ordering among host items.

Home also drops, without being asked, any host item whose target is the app
that made the request (the chat-role app never sees "Send message"), so an app
usually needs no `omit` at all.

### Result

```js
{ version: 2, status: 'handled', action: 'account.send-message' } // a host item
{ version: 2, status: 'handled', action: 'app:block' }             // an app item
{ version: 2, status: 'dismissed' }
```

For a host item Home has already performed the operation when it answers; the
action id is informational. For an app item Home has done nothing: the app
performs its own operation through its own bridge actions and grants.

### Host items, first slice

| Subject | Item | Operation |
| --- | --- | --- |
| Account | Copy address | copy |
| Account | Copy name (when a name was supplied) | copy |
| Account | Account info | open `profile` role app `?account=<address or name>` |
| Account | Send message | open `chat` role app `?address=<address>&network=<network>` |
| Account | Send coins | open `wallet` role app `?to=<address>` |
| Account | View on explorer | open `explorer` role app `?account=<address or name>` |
| Group | Copy group ID | copy |
| Group | Copy group name (when supplied) | copy |
| Group | Group info | open `groups` role app `?group=<id>` |
| Group | Open group chat | open `chat` role app `?group=<id>&network=<network>` |

"View ratings" is folded into Account info because the profile role defaults to
the Trust app. Labels and their translations are Home's. The roles and the
query contract each role app must accept are defined in
[Home app assignments](HOME_APP_ASSIGNMENTS.md#roles-used-by-context-menus);
Home composes the query from the validated target, never from app-supplied
strings. An item whose role app is not published on the current network is
omitted rather than shown disabled.

Version 1 requests keep the version 1 item set and result shape unchanged.

### Feature detection

`GET_HOST_INFO` gains `contextMenu: { version: 2 }` on hosts that implement
this section. `SHOW_ACTIONS` is unchanged. A version 2 request to a version 1
host is rejected with the existing "unsupported version" error, so an app may
also simply try version 2 and fall back.

### Rendering

Desktop keeps the native popup: host items in their existing groups, a
separator, then the app's items. Android keeps the bottom sheet, with the
app's items under a header naming the requesting app. Both re-check the live
sender, tab and resource before acting, exactly as version 1. Android's "open"
operations will bind the new tab to the originating tab's account like desktop
does (today the Android sheet uses the globally selected account — a parity
fix that ships with this version).

### Later slices

- Resource items: Pin to Dashboard, Add bookmark, Save — all existing Home-chrome
  operations.
- Declarative subjects: `home://account/<address or name>` and
  `home://group/<id>` link targets, so an app can mark up an account with a
  plain `<a href>` and get the native menu, middle-click and a sensible plain
  click (the profile / groups role app) with no bridge call.
- A link menu for `qdn://`, `qortal://` and `http(s)://` links inside apps
  (external links still go through the `OPEN_EXTERNAL_LINK` prompt).
