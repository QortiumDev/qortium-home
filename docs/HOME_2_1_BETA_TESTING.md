# Home 2.1 beta testing and app development

Home 2.1.0-beta.9 is a testing prerelease. Home 1.8.0 remains the latest stable
release. Choose Prerelease in Home's update settings to follow the Home 2 line,
or install the matching platform asset manually. Report the Home version,
platform, app version, selected network, node route and reproduction steps.
Keep passwords, recovery material and private message contents out of reports.

Android beta.9 uses versionCode 51. It can update release-signed beta.8 (code 50), beta.7 (code 49), beta.6 (code 48), beta.5 (code 47), beta.4 (code 46), beta.3 (code 45),
beta.2 (code 44), beta.1 (code 43), Home 1.8.0 (code 41) and release-signed
development Home 2.1.0 (code 42). Development
builds named 2.1.0 sort above the beta in semantic-version comparisons, so
install the beta APK manually in that case. Debug-signed APKs have a different
signer and cannot be updated in place by the release APK.

## Start with the runtime contract

Home's application version is 2.1.0-beta.9; its QAVS platform version is 2.1.
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
7. New in beta.4 — updating Home from inside Home. Choose the Prerelease
   channel, check, download, then use the platform's install action: on Linux
   "Install and restart" replaces the running AppImage and restarts Home into
   it; on Windows portable a helper swaps the exe after Home exits and starts
   it; on macOS "Open disk image" mounts the DMG for the usual drag to
   Applications; on Android "Install APK" hands the verified package to the
   system installer (the first time, Android asks to allow installs from Home
   and Play Protect may ask to scan). Settings → Runtime → Qortium Home has a
   Release source row: QDN then GitHub (default), QDN, or GitHub — the asset
   line says which one served the download. Report the platform, the source
   shown, and whether the restarted or installed Home shows the new version.
8. New in beta.4 — the Dashboard navigates in place: pinned apps, Apps,
   Explore, Names and the Settings links turn the Dashboard tab into that
   page and Back returns to the Dashboard; there is at most one Dashboard tab
   ("+" brings it forward). The account badge on a tab group opens that
   account's menu (unlock or lock, select). Release notes and Core API docs
   name their tab. On a phone the dashboard tile headers are one line, and
   Check for updates works.
9. New in beta.5 — nodes and groups. On the Qortium Public route, Home now
   keeps the selected public node while it is at most a few blocks behind
   instead of switching (and reloading your app tabs) at every block; report
   any tab reload you did not cause. Adding a custom HTTPS node shows the
   node's certificate fingerprint and asks you to confirm it before Home
   talks to that node (Check the certificate → Trust); a changed certificate
   is reported and can be forgotten. Group admin actions (approve or reject a
   join request, invite, kick, ban) work again from apps such as Chat's
   members drawer. Chat 2.0.18 on QDN adds byte counters, per-conversation
   mute, a Copy button and audio embeds for Hub readers — use it for the
   group checks above.
10. New in beta.6 — Android on the Public route. The phone no longer
   switches public nodes at every block, so app tabs stop reloading about
   once a minute; and an app opened from a link, the address bar or "+" can
   now send messages and read private chats with the selected account
   instead of failing with "this action no longer matches the current chat
   or account". Please retry any Chat send that used to be discarded on the
   phone, from a tab opened through a link as well as from the Chat tile.
11. New in beta.7. (a) Android attachments: publishing a picture or a chat
   attachment to QDN from the phone works again (it used to fail right after
   approval with "an unexpected error"). (b) Local Core API key: if Home
   shows "API error 4" for your own Core, it now asks the Core which key it
   accepts and adopts it — no more copying the apikey file by hand; please
   report if you still see error 4. (c) Qortal General Chat: with Chat
   2.0.22, the QORTAL section lists General Chat and you can post to it from
   Home (Home builds the message the way Qortal Hub does). (d) Web links in
   chat messages now show "Open" next to "Copy"; Home asks you first, showing
   the site and the full link, and opens it in your device's browser. Try a
   link on desktop and on the phone.
12. New in beta.8. (a) Landscape on Android: rotating the phone now lets Home
   use the full screen width instead of staying a narrow column. (b) Qortal
   closed groups and attachments from Home: publishing to Qortal QDN from an
   app used to fail with "Qortal public publish must not contain a secret";
   with Chat 2.0.26, a closed Qortal group's owner can now press "Publish
   group key" and members can read and post, and attachments publish to
   Qortal again. After a publish Home reads the resource back from the node
   and refuses to trust it if the bytes differ — please report any "not
   trusted" message you see. (c) Dependency refresh (React 19.3, Capacitor
   8.5.2, icons); tell us about anything that looks or behaves differently.
13. New in beta.9. (a) Closed Qortal groups on desktop actually work now:
   beta.8 signed the key bundle (and closed-group messages) with a key that
   had already been cleared, so the node refused them. Owner: press "Publish
   group key"; member: open the group and post. (b) Two messages sent back
   to back: the second now waits its turn instead of being refused — with
   Chat 2.0.27 it simply shows "Sending…" a few seconds longer, and any
   refusal that still happens keeps a Retry button instead of "outcome
   unknown". Try a burst of three quick messages in a public group.

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
