# Home data manager QDN bridge

Home exposes two elevated, Home-profile manager capabilities to embedded QDN
apps: bookmark management and notification management. These actions work when
Home uses a local, custom, or public/network node because the managed data
belongs to Home, not Core. Apps must still feature-detect them with
`SHOW_ACTIONS`.

The data never becomes a QDN resource. Home does not publish or synchronize it,
and a standalone browser copy of an app must not treat its own local storage as
Home's data.

Home 2 imports the v1 bookmarks tree, toolbar, dashboard pins, start pages,
visibility, and shared revision once before serving this bridge. Desktop reads
the old default Electron session through a hidden local migration document and
stores the validated canonical snapshot in Home 2's isolated persistent
partition. Android migrates the existing native Preferences in place. The
legacy source remains intact, Android records a one-time migration marker,
reloads are idempotent, and malformed or equally revised conflicting legacy
data fails closed instead of silently becoming an empty collection. Mutations
write the compatibility mirrors before the canonical CAS snapshot, which acts
as the final commit marker.

## Permissions

Manager permissions are separate from account permissions, from an app's
assignment to a Home role, and from permission to send notifications. Home 2
lists both durable manager grants — `bookmarks.manage` and
`notifications.manage` — in the trusted QDN Apps Settings surface and revokes
them with an exact store-revision check. Revocation does not delete the user's
saved links, and revoking `notifications.manage` deletes no notification rule
and revokes no app's own notification permission: it takes back only the
manager's authority over other apps. The notification-manager grant is listed
in its own section, distinct from the per-app "may show notifications" list
below it, so the two cannot be confused for one another.

Both manager capabilities are offered as an "always allow" answer only. A
session-scoped answer to an administrative capability would be a grant the user
could neither see nor revoke in Settings, so the prompt does not offer one.

Manager permissions are keyed by the calling app's stable
`qdn://SERVICE/name/identifier` resource base (not its current deep-link path,
query, or fragment) and persist as app-scoped capabilities until the user
revokes them.

The `bookmarks` and `notifications` app assignments are ordinary Home launch
preferences. They do not hold, transfer, or revoke capabilities. Users can
change those targets, create other assignments, or let an assignment-manager
app request changes through the generic bridge documented in
[Home app assignments](HOME_APP_ASSIGNMENTS.md). An assigned app must still
request the matching capability below; an unassigned app may request it too.

Home's "Manage bookmarks" control and the legacy `home://bookmarks` address
open the selected Bookmarks Manager app. The native page remains only as a
recovery fallback while the compatibility migration is in progress; bookmark
data and lightweight Home controls remain local to Home.

The non-prompting checks are:

```js
await qdnRequest({ action: 'BOOKMARKS_HAS_PERMISSION' });
// { granted: boolean }

await qdnRequest({ action: 'NOTIFICATION_MANAGER_HAS_PERMISSION' });
// { granted: boolean }
```

The first `BOOKMARKS_GET`, `BOOKMARKS_APPLY`, `BOOKMARKS_OPEN`, or
notification-manager read or mutation opens a durable permission dialog. A
denial rejects the request and does not create a grant. The grant does not
depend on the selected account and belongs only to the calling app's stable
resource identity. Home does not publish or synchronize it, although a platform
backup may restore the containing Home profile.

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

### Explicit guest saved links (Home 2.1)

Saved-place `accountId` is an account **reference**: null/omitted remains
Current, a real `wallet:...` id selects that saved account, and the reserved
nonempty string `home-v2:guest` explicitly selects no account. Home's tab-save
controls capture this reference for guest `qdn://` and `qortal://` tabs. Ordinary
Home/Core addresses retain their existing account-independent behavior. The
reference survives moves among bookmarks, toolbar, pins and startup pages,
legacy storage mirrors, and profile backup/restore without changing schema 1.

Manager snapshots include a virtual `home-v2:guest` choice labelled No account
(localized), unless the 256-choice limit is already occupied. This choice is
not a vault account and never changes `activeAccountId`. At the limit, existing
guest references remain valid even though a manager may show them as unavailable.
Only this exact reserved reference bypasses the saved-account existence check
in Home 2's `BOOKMARKS_OPEN`; it becomes an explicit guest binding at launch,
not runtime null (which means Current). Unavailable concrete startup bindings
are skipped; toolbar, pin and manager opens reject unavailable saved accounts.

Bookmarks 1.5.5 already preserves nonempty account references, displays supplied
choice labels, and refuses account-bound fallback navigation when
`BOOKMARKS_OPEN` is unavailable. No manager publication is required. Older Home
manager bridges reject the reserved reference as an unknown account. This is
not a general downgrade guarantee: older native startup handling can fall back
to Current for unknown references, so guest-bearing profiles require updated
Home for reliable guest launch behavior.

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

Every successful change advances the bookmark revision. Home's toolbar,
dashboard pin controls, and visibility setting use the same authoritative
snapshot as the assigned Bookmarks manager app, so their changes advance that
same revision. An unchanged mutation returns `changed: false` without
advancing it.

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
`accountId` is optional and nullable: a non-null id must name a saved Home
account or the reserved `home-v2:guest` reference, or the request is rejected;
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

Both halves of this document are live in Home 2 as of the 2.1 line: the
bookmark manager shipped first, and the notification manager is now app-facing
on Home 2 desktop and Android as well as on Home 1.x. Desktop and Android share
one validator (`electron/home-v2-notification-manager-contract.ts`) and reuse
the 1.x summary and mutation implementation unchanged, so a manager app sees
byte-identical responses on every host.

Home 2 adds one behavior 1.x did not have, and it is a refusal rather than a
new capability: when the notification store is corrupt or cannot be read, the
manager actions fail with `HOME_NOTIFICATION_STORE_CORRUPT` or
`HOME_NOTIFICATION_STORE_UNAVAILABLE` instead of reporting an empty profile. A
manager must not be able to mistake "I cannot read this" for "you have granted
nothing" and then write over the damaged record. An empty but healthy store
still answers normally, with `apps: []`.

Home 2 does NOT implement `NOTIFICATION_ADD`, `NOTIFICATION_GET`, or
`NOTIFICATION_REMOVE`. See
[Home 2 app notifications](HOME_V2_APP_NOTIFICATIONS.md) for why rule creation
is deferred; the manager surface below can delete a rule but never add one.

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

Home 2 desktop announces these to open app views as of the 2.1 line. A view is
seeded with the current revisions when it is shown, and the shell pushes an
update whenever the profile changes — including a change one app view made
through the manager surface, which reaches both the trusted Settings page and
every other open view. Home 2 on Android does not announce them yet: an Android
manager app should refetch on its own schedule and rely on the
`HOME_DATA_STALE` retry path.

## Android request timing

The first manager read can open the same durable approval dialog as a mutation.
Android therefore gives every manager action except the two non-prompting
`*_HAS_PERMISSION` checks its long bridge timeout. Apps should still present a
normal pending state while the user considers the prompt.
