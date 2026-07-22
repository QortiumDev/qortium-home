# Home data manager QDN bridge

Home exposes two elevated, device-local manager capabilities to embedded QDN
apps: bookmark management and notification management. These actions work when
Home uses a local, custom, or public/network node because the managed data
belongs to Home, not Core. Apps must still feature-detect them with
`SHOW_ACTIONS`.

The data never becomes a QDN resource. Home does not publish or synchronize it,
and a standalone browser copy of an app must not treat its own local storage as
Home's data.

## Permissions

Manager permissions are separate from account permissions and from an app's
permission to send notifications. They are keyed by the calling app's stable
`qdn://SERVICE/name/identifier` resource base (not its current deep-link path,
query, or fragment) and persist until the role is replaced by a new approval
or Settings assignment.

Each capability is a Home **role** held by at most one app at a time:
`bookmarks.manage` belongs to the Bookmarks Manager role and
`notifications.manage` belongs to the Notifications Manager role. Home stores
one `{ url, grantedAt }` pair per role, so a second holder is unrepresentable —
granting a capability to a new app replaces the previous holder, and the
approval dialog names the app being replaced. The Bookmarks Manager role URL
also drives Home's bookmarks menu routing, so it always has a value (the
official Bookmarks app by default). New profiles select the official Notify app
for Notifications Manager, but that selection grants no access on its own.

Users manage both roles in the Settings "QDN Apps" section: they can replace a
role's app or reset it to the default app. Assignment is not a permission
grant; the assigned app must request the matching capability through the
approval dialog below. Home does not expose a Settings control that clears or
revokes a role. Apps cannot read or change role assignments through the
settings bridge; the only app-facing write path is the approval dialog below.

The non-prompting checks are:

```js
await qdnRequest({ action: 'BOOKMARKS_HAS_PERMISSION' });
// { granted: boolean }

await qdnRequest({ action: 'NOTIFICATION_MANAGER_HAS_PERMISSION' });
// { granted: boolean }
```

The first `BOOKMARKS_GET`, `BOOKMARKS_APPLY`, `BOOKMARKS_OPEN`, or
notification-manager read or mutation opens a durable permission dialog. A
denial rejects the request and does not create a grant. The grant is
device-local, does not depend on the selected account, and makes the calling
app the role's sole holder.

If the app view changes while the permission dialog is open, Home rejects the
stale request instead of granting or using the capability for the replacement
view.

## Bookmark manager

`BOOKMARKS_GET` returns all four saved-link collections Home currently manages:

```js
const snapshot = await qdnRequest({ action: 'BOOKMARKS_GET' });
// {
//   schemaVersion: 1,
//   revision: 12,
//   bookmarks: [...],
//   toolbar: [...],
//   toolbarVisibility: 'hidden' | 'dashboard' | 'always',
//   dashboardPins: [...],
//   startPages: [...],
//   availableAccounts: [{ id: 'account-1', label: 'Main' }, ...],
//   activeAccountId: 'account-1' | null
// }
```

`bookmarks` and `toolbar` are trees of `bookmark` and `folder` items. Saved
links, dashboard pins, and start pages can carry a Home account id so opening
the saved address restores its account context when that account still exists.

`availableAccounts` and `activeAccountId` are permission-scoped account
choices for the manager UI: just an `id` and display `label` per account,
never wallet filenames, keys, addresses, or unlock state. `activeAccountId`
is Home's currently selected account; `null` means the built-in "Current"
account, the same meaning `null`/omitted `accountId` already has on saved
links, dashboard pins, and start pages (follow whichever account the tab
that opens the address is using). Both fields are optional on the wire so
older Home builds and any locally cached snapshot without them keep
validating unchanged; a manager app should treat their absence the same as
an empty account list. `BOOKMARKS_APPLY` results include the same two fields
in `snapshot`, not just the initial `BOOKMARKS_GET`.

`BOOKMARKS_APPLY` performs one typed mutation against an exact revision:

```js
const result = await qdnRequest({
  action: 'BOOKMARKS_APPLY',
  expectedRevision: snapshot.revision,
  mutation: {
    type: 'addTreeLink',
    rootId: 'bookmarks',
    parentFolderId: null,
    link: {
      displayUrl: 'qdn://APP/Boards/Boards',
      title: 'Boards',
    },
  },
});
// { changed: boolean, snapshot: { ...newSnapshot } }
```

The canonical request fields can also be nested under `request`. Supported
mutation shapes are:

- `addTreeLink`: `rootId`, optional `parentFolderId`, and `link`.
- `addTreeFolder`: `rootId`, optional `parentFolderId`, and `title`.
- `updateTreeLink`: `rootId`, `itemId`, and `link`.
- `updateTreeFolder`: `rootId`, `itemId`, and `title`.
- `removeTreeItem`: `rootId` and `itemId`.
- `addDashboardPin`: `pin`.
- `updateDashboardPin`: `pinId` and `pin`.
- `removeDashboardPin`: `pinId`.
- `addStartPage`: `page`.
- `updateStartPage`: the old `displayUrl` and replacement `page`.
- `removeStartPage`: `displayUrl`.
- `moveItem`: `itemId`, `sourceRootId`, `targetRootId`, and optional
  `targetFolderId`, `targetItemId`, and `targetPosition` (`before`, `after`, or
  `inside`). This also supports moves between saved-link collections.
- `setToolbarVisibility`: `toolbarVisibility` (`hidden`, `dashboard`, or
  `always`).

Tree `rootId` values are `bookmarks` and `toolbar`; move operations additionally
accept `pins` and `startPages`. A link draft contains `displayUrl`, `title`, and
an optional nullable `accountId`.

Every successful change advances the bookmark revision. Existing Home controls
such as the bookmark star, toolbar, dashboard pin controls, start-page controls,
and the built-in manager advance the same revision. An unchanged mutation
returns `changed: false` without advancing it.

If `expectedRevision` is no longer current, the request rejects with error code
`HOME_DATA_STALE`. Fetch a new snapshot, reconcile the user's pending edit, and
retry; do not silently overwrite the newer Home state.

If a link draft's `displayUrl` (or a `BOOKMARKS_OPEN` address) is not a
supported `qdn://`, `core://`, or `home://` address, the request rejects with
error code `INVALID_ADDRESS`. Show the user a specific "not a valid address"
message rather than relaying the raw error text.

`BOOKMARKS_OPEN` asks Home to open a saved address in a tab, under the
`bookmarks.manage` capability like `BOOKMARKS_GET`/`BOOKMARKS_APPLY`:

```js
await qdnRequest({
  action: 'BOOKMARKS_OPEN',
  address: 'qdn://APP/Boards/Boards',
  accountId: 'account-1', // or null for "Current"
});
// true
```

`address` must be a supported `qdn://`, `home://`, or `core://` address.
`accountId` is optional and nullable: a non-null id must match one of
`availableAccounts` from the same snapshot, or the request is rejected;
`null` (or omitting the field) means "Current" — inherit whichever account
the Bookmarks manager's own tab is using, the same meaning `null` has on
saved links, dashboard pins, and start pages. Home reuses an existing tab
for the same app only when that tab's account also matches the effective
account; otherwise it opens a new tab rather than silently switching
another tab's account.

## Notification manager

The existing `NOTIFICATION_ADD`, `NOTIFICATION_GET`, and
`NOTIFICATION_REMOVE` actions remain scoped to the calling app. The elevated
manager actions below administer all apps but deliberately cannot create or
replace another app's rules.

`NOTIFICATION_MANAGER_GET` returns a sanitized summary:

```js
const summary = await qdnRequest({ action: 'NOTIFICATION_MANAGER_GET' });
// {
//   version: 1,
//   revision: 8,
//   apps: [{
//     appKey: 'qdn://APP/Chat/Chat',
//     grant: { grantedAt: '...', muted: true } | null,
//     rules: [{
//       notificationId: 'direct-messages',
//       event: 'CHAT_MESSAGE',
//       filters: { ...safeFilters },
//       maskedFilterKeys: ['involving'],
//       partiallyMaskedFilterKeys: [],
//       title: '...', text: '...', link: '...', createdAt: '...'
//     }]
//   }]
// }
```

Home omits each rule's stored account binding. It also removes foreign-wallet
`xpub` values and signature values from the summary unconditionally.

For the address-like `address`, `involving`, `recipient`, and `sender`
filters, Home exposes a value only when it validates as a real Qortal
address (checked with Home's address-decoding and checksum logic, not a
shape-based guess); anything else — a contact name, a malformed value, or
any other non-address string — stays masked. When one of these filters is an
array with a mix of valid and invalid entries, `filters` keeps only the valid
addresses and the key is listed in `partiallyMaskedFilterKeys` instead, so the
manager knows entries were omitted without ever seeing them.

`maskedFilterKeys` lists fields that were fully removed (present in the rule
but absent from `filters`); `partiallyMaskedFilterKeys` lists array fields
that were filtered down to their valid addresses only.

The administrative mutations are:

```js
await qdnRequest({
  action: 'NOTIFICATION_MANAGER_SET_MUTED',
  appKey,
  muted: true,
  expectedRevision: summary.revision,
});

await qdnRequest({
  action: 'NOTIFICATION_MANAGER_REMOVE_RULES',
  appKey,
  notificationIds: ['direct-messages'],
  expectedRevision: summary.revision,
});

await qdnRequest({
  action: 'NOTIFICATION_MANAGER_REVOKE',
  appKey,
  expectedRevision: summary.revision,
});
```

Each mutation returns the new sanitized summary. Muting preserves the app's
notification grant and rules. Removing rules preserves the grant. Revoking
deletes both the app's notification grant and all of its rules.

Notification manager mutations use the same `HOME_DATA_STALE` error code when
their `expectedRevision` is out of date. Refetch before retrying. The global
`appNotifications` switch remains part of `GET_HOME_SETTINGS` and
`UPDATE_HOME_SETTINGS`; it is not duplicated in this manager surface. A
semantic no-op returns the current summary without advancing the revision or
emitting a change event.

## Live change events

Home notifies an open manager app when either data set changes, including
changes made through Home's own controls or by another app view:

```js
window.addEventListener('qortiumBookmarkManagerChanged', (event) => {
  console.log(event.detail.revision);
});

window.addEventListener('qortiumNotificationManagerChanged', (event) => {
  console.log(event.detail.revision);
});
```

The event detail contains only `{ revision }`; it never includes bookmarks,
rules, account data, or notification filters. Refetch the relevant manager
snapshot when the revision differs from the one currently displayed. Home may
coalesce quick consecutive changes, so apps must treat the number as a version,
not as an event count.

## Android request timing

The first manager read can open the same durable approval dialog as a mutation.
Android therefore gives every manager action except the two non-prompting
`*_HAS_PERMISSION` checks its long bridge timeout. Apps should still present a
normal pending state while the user considers the prompt.
