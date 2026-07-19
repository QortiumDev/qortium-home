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
query, or fragment) and persist until the user revokes them in Home settings.

The non-prompting checks are:

```js
await qdnRequest({ action: 'BOOKMARKS_HAS_PERMISSION' });
// { granted: boolean }

await qdnRequest({ action: 'NOTIFICATION_MANAGER_HAS_PERMISSION' });
// { granted: boolean }
```

The first `BOOKMARKS_GET`, `BOOKMARKS_APPLY`, or notification-manager read or
mutation opens a durable permission dialog. A denial rejects the request and
does not create a grant. The grant is device-local and does not depend on the
selected account.

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
//   startPages: [...]
// }
```

`bookmarks` and `toolbar` are trees of `bookmark` and `folder` items. Saved
links, dashboard pins, and start pages can carry a Home account id so opening
the saved address restores its account context when that account still exists.

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
//       title: '...', text: '...', link: '...', createdAt: '...'
//     }]
//   }]
// }
```

Home omits each rule's stored account binding. It also removes foreign-wallet
`xpub` values and address-, contact-, and signature-like filter values from the
summary; `maskedFilterKeys` tells the manager which fields were present without
revealing their values.

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
