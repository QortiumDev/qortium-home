# Home 2.1 beta testing and app development

Home 2.1.0-beta.3 is a testing prerelease. Home 1.8.0 remains the latest stable
release. Choose Prerelease in Home's update settings to follow the Home 2 line,
or install the matching platform asset manually. Report the Home version,
platform, app version, selected network, node route and reproduction steps.
Keep passwords, recovery material and private message contents out of reports.

Android beta.3 uses versionCode 45. It can update release-signed beta.2 (code 44),
beta.1 (code 43), Home 1.8.0 (code 41) and release-signed development Home 2.1.0
(code 42). Development
builds named 2.1.0 sort above the beta in semantic-version comparisons, so
install the beta APK manually in that case. Debug-signed APKs have a different
signer and cannot be updated in place by the release APK.

## Start with the runtime contract

Home's application version is 2.1.0-beta.3; its QAVS platform version is 2.1.
Feature-detect actions instead of treating either version as a capability list.
Use `qdnRequest` for Qortium and `qortalRequest` for Qortal. The invoked bridge
determines the network; a network field in the payload does not switch it.
Availability also depends on the platform and configured route.

This read-only diagnostic can run inside a Home QDN app:

```js
async function inspectHomeBridge(request) {
  const actions = await request({ action: 'SHOW_ACTIONS' });
  const host = actions.includes('GET_HOST_INFO')
    ? await request({ action: 'GET_HOST_INFO' })
    : null;
  return { host, actions };
}

const qortium = await inspectHomeBridge(qdnRequest);
// Inspect qortalRequest separately when your app supports Qortal.
```

Handle missing actions, user cancellation, locked accounts, route changes and
unknown transaction outcomes explicitly. Accounts and approvals belong to the
requesting tab; changing its account or route can invalidate prior context.

## Publishing and viewers

For a user-selected file, call `SELECT_QDN_PUBLISH_SOURCE`. For bytes your app
already holds, feature-detect `STAGE_QDN_PUBLISH_SOURCE` and pass
`{ action, bytesBase64, fileName, mimeType? }` within its size limit. Both paths
return a Home-issued `sourceToken` for the publish action. Since beta.2, Home
also accepts the `{ base64, filename }` request shape used by already-published
apps such as Boards, Help, Paint and Recipes, validating and staging those bytes
through the same path with a 25 MiB total limit; new apps should still prefer
the token flow. Filesystem paths and other inline encodings are rejected. Staging
does not publish or grant permission; publication still requires approval.
Tokens expire and are bound to account, tab and route.

Since beta.2, FILE and FILES resource URLs resolve to raw bytes (as in Home 1),
so apps that load nested files such as ROMs or external cores get usable URLs;
media services keep their render routes. Android answers those raw URLs through
its authorized proxy on the requesting app's origin. Bundled app assets accept
HEAD requests under the same authorization as GET. Group member listings accept
page sizes up to 500 for `GET_GROUP_MEMBERS`. Qortal apps on Android keep their
resource paths, so their relative asset loads and in-app navigation resolve
against the correct app root.

Use Home's resource-viewer actions for supported images, documents, media,
text and archives; inspect the action contract before using position options.
APP/WEBSITE navigation and a resource viewer are distinct operations.

- [Bridge actions and request contracts](BRIDGE_ACTIONS.md)
- [Desktop/Android compatibility ledger](HOME_V2_BRIDGE_COMPATIBILITY.md)
- [Publishing sources, preview and publication](QDN_PUBLIC_PUBLISHING.md)
- [Private chat attachment contract](HOME_CHAT_PRIVATE_ATTACHMENTS.md)
- [Application versioning](APP_VERSIONING.md)

## Suggested testing

1. Upgrade from Home 1.8.0 and check accounts, saved links and your chosen
   release channel. Check startup, unlock and both network routes.
2. Open an app, inspect its bridge, switch tabs/accounts, and confirm app
   navigation and permission prompts remain attached to the right tab.
3. Exercise bookmark removal, detached tabs, resource viewers, phone Settings,
   browser Back/Forward and app reloads.
4. With your own test account and content, exercise picker/paste staging,
   preview, cancellation and approved publishing. Inspect the outcome before
   retrying an interrupted transaction.
5. New in beta.3 — startup and the dashboard: the window should appear only
   once it is complete (no placeholder text, black frame or sections moving
   as they load); on Linux, run the AppImage from a terminal and include the
   `[startup]` lines in reports about slow starts. The dashboard is four
   tiles — Account, Pinned apps, Qortium Home, Node & Core — each foldable;
   the Account strip's Unlock button, the Pinned apps Apps/Explore/Create
   actions, the Home tile's release-channel switch and Show install folder,
   and the Node & Core tile's Start/Stop Core and I2P router controls should
   all work from the dashboard. The connection-mode select and the I2P
   details are also in Settings → Runtime, which now leads with Qortium Home.
6. New in beta.3 — the tab bar groups tabs by account. Check that the group
   badge shows your avatar, that the picker (click a badge) lists every group
   with counts and returns to the right tab, that dragging a tab stays within
   its group, that dragging a badge reorders groups, that dragging a badge
   clear of the strip moves the whole group to a new window, and that on a
   narrow window only the active group is shown. The Dashboard tab sits with
   the selected account and moves when you switch accounts.

## Reports still being investigated

The Android 1.8.0 upgrade currently starts Home 2 with its default appearance;
reapply your theme and accent in Settings. Existing appearance preferences are
not yet imported into the new shell's settings record.

Some testers report discarded Chat messages, attachment publishing/display
failures, missing Trust/Wiki images or avatars on mobile, and Android app
refreshes after roughly a minute. These reports remain open; a previously
merged fix is not proof that every reported device case is resolved. Android
beta.2 keeps a recently verified custom node route for 30 seconds during a
transient health-probe failure, which may reduce the refresh reports, but the
underlying probe failure is still being diagnosed. This beta provides a shared
baseline for reproducing those cases.
