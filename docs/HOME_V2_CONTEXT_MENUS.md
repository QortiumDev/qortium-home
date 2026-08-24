# Home 2 context menus

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
| `APP` resource | Open in a new tab; copy resource link |
| Other resource service | Copy resource link |

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
