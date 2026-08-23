# Home app assignments

Home stores user-owned app assignments in the Home profile. An assignment is a named
launch target, not a permission grant: it may point at any valid QDN `APP` or
`WEBSITE` resource, including an app route fragment such as
`qdn://APP/Explore/Explore#/service/VIDEO`.

Roles are stable lowercase identifiers such as `bookmarks`, `explore`, or
`media.video-player`. Any app may propose a role; Home does not require a
central registry. A role's label and description are user-visible metadata,
while the identifier is the durable interoperability key. Home supplies the
initial `bookmarks`, `notifications`, and `explore` assignments, but users and
assignment-manager apps may add others.

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
