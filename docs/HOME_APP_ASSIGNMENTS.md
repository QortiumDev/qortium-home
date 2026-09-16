# Home app assignments

Home stores user-owned app assignments in the Home profile. An assignment is a named
launch target, not a permission grant: it may point at any valid QDN `APP` or
`WEBSITE` resource, including an app route fragment such as
`qdn://APP/Explore/Explore#/service/VIDEO`.

Roles are stable lowercase identifiers such as `bookmarks`, `explore`, or
`media.video-player`. Any app may propose a role; Home does not require a
central registry. A role's label and description are user-visible metadata,
while the identifier is the durable interoperability key. Home supplies the
initial `bookmarks`, `notifications`, `explore`, and `apps` assignments, but
users and assignment-manager apps may add others. The `apps` role is what the
dashboard "Apps" button opens; it ships pointing at `qdn://APP/Apps/Apps`.

The legacy app-facing bridge actions below remain the interoperability contract
for the older shell. Home 2.1's first assignment-management slice is deliberately
limited to its trusted Settings page: it does **not** add either action to Home
2's `SHOW_ACTIONS`, does not change QAVS `platformVersion: "2.0"`, and does not
make the Settings bridge available to widgets. Public app-facing delegation
remains a later, separately reviewed slice.

Assignments work with local, custom, and public/network nodes because they are
stored in the Home profile rather than by a Core. A platform backup may carry
that profile to another installation, so apps must not treat it as hardware-bound.

## Read assignments

`GET_APP_ASSIGNMENTS` asks once for the calling app's durable
`assignments.read` capability. On approval it returns the local role map and a
revision number:

```js
const { assignments, revision } = await qdnRequest({ action: 'GET_APP_ASSIGNMENTS' });
// assignments['media.video-player'] = {
//   label: 'Video player',
//   description: '...',
//   url: 'qdn://APP/Explore/Explore#/service/VIDEO'
// }
```

The read grant is app-scoped. Apps should treat assignment data as private
Home-profile preferences.

## Request an assignment

Any embedded QDN app can propose any role and full target URL:

```js
await qdnRequest({
  action: 'REQUEST_APP_ASSIGNMENT',
  role: 'media.video-player',
  label: 'Video player',
  description: 'Open a QDN video browser or player.',
  targetUrl: 'qdn://APP/Explore/Explore#/service/VIDEO',
});
```

Home always presents a single-request confirmation containing the role, current
target, and proposed target. The calling app cannot change assignments silently.
Home also rejects the request if the app view changed or the assignment revision
changed while the confirmation was open. Targets are restricted to complete
`qdn://APP/...` or `qdn://WEBSITE/...` resource URLs; `http(s)` URLs are not
assignment targets.

Home 2.1 Settings can edit only roles already persisted in the profile, including
existing custom roles. Its private, sender-gated host bridge is not an app API.
A future third-party assignment manager must use the public actions above only
after Home 2 advertises them.

## Roles used by context menus

Home 2 [context menus](HOME_V2_CONTEXT_MENUS.md#version-2) route their cross-app
items through these roles. Home ships each with a default and users change them
in Settings › QDN Apps like any other assignment. Because Home composes the link
from a validated subject, every app assigned to a role must accept the query
parameters listed for it; anything else in the URL is the assignment owner's
business (a route fragment is fine). Parameters are top-level query parameters
on the app's canonical address, so a hash-router app must read
`window.location.search`, not only its `_route`.

| Role | Default | Must accept | Used by |
| --- | --- | --- | --- |
| `chat` | `qdn://APP/Chat/Chat` | `?address=<address>` opens or creates the direct chat; `?group=<id>` opens the group; `?network=qortal` or `qortium` selects the chain | Send message, Open group chat |
| `profile` | `qdn://APP/Trust/Trust` | `?account=<address or name>` shows that account | Account info |
| `wallet` | `qdn://APP/Wallet/Wallet` | `?to=<address>` opens the native-coin send form with the recipient filled in | Send coins |
| `groups` | `qdn://APP/Groups/Groups` | `?group=<id>` shows that group | Group info |
| `explorer` | `qdn://APP/Chain/Chain` | `?account=<address or name>` shows that account (the explorer has no group pages, so the group menu has no explorer item) | View on explorer |

Compliance at the time of writing: Chat already accepts `address`, `group` and
`network`; Trust accepts `account`. Wallet, Groups and Chain read only
`?_route=` today and need the app half first (Wallet: `?to=`; Groups: `?group=`;
Chain: `?account=`) — app PRs qortium-wallet#18, qortium-group-manager#4,
qortium-chain-explorer#2. Home ships the host half only after each role's app
half is published, so a fresh install never shows an item that opens an app
which ignores the query.

## Assignments are not permissions

Changing an assignment never grants access to Home data. Apps separately request
the narrowly defined bridge actions they need, and Home records their approval
against the calling app's stable resource identity, not against any role. For
example, an assigned Bookmarks app still requests `bookmarks.manage`; an
unassigned app may also request it, and users decide independently.

Older Home manager-role grants are intentionally not migrated into these
independent capabilities. Their selected Bookmarks/Notifications targets are
preserved, but the app asks again before managing Home-profile data under the new
model.
