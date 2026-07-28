# Home app assignments

Home stores user-owned, device-local app assignments. An assignment is a named
launch target, not a permission grant: it may point at any valid QDN `APP` or
`WEBSITE` resource, including an app route fragment such as
`qdn://APP/Explore/Explore#/service/VIDEO`.

Roles are stable lowercase identifiers such as `bookmarks`, `explore`, or
`media.video-player`. Any app may propose a role; Home does not require a
central registry. A role's label and description are user-visible metadata,
while the identifier is the durable interoperability key. Home supplies the
initial `bookmarks`, `notifications`, and `explore` assignments, but users and
assignment-manager apps may add others.

Use `SHOW_ACTIONS` to feature-detect both actions. They work with local,
custom, and public/network nodes because assignments are Home-local.

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
device preferences.

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

Home Settings provides the same fallback editor, including custom roles. A
third-party assignment manager uses these bridge actions rather than a private
Settings API.

## Assignments are not permissions

Changing an assignment never grants access to Home data. Apps separately request
the narrowly defined bridge actions they need, and Home records their approval
against the calling app's stable resource identity, not against any role. For
example, an assigned Bookmarks app still requests `bookmarks.manage`; an
unassigned app may also request it, and users decide independently.

Older Home manager-role grants are intentionally not migrated into these
independent capabilities. Their selected Bookmarks/Notifications targets are
preserved, but the app asks again before managing device data under the new
model.
