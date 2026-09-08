# Home 2.1 beta testing and app development

Home 2.1.0-beta.1 is a testing prerelease. Home 1.8.0 remains the latest stable
release. Choose Prerelease in Home's update settings to follow the Home 2 line,
or install the matching platform asset manually. Report the Home version,
platform, app version, selected network, node route and reproduction steps.
Keep passwords, recovery material and private message contents out of reports.

Android beta.1 uses versionCode 43. It can update release-signed Home 1.8.0
(code 41) and release-signed development Home 2.1.0 (code 42). Development
builds named 2.1.0 sort above the beta in semantic-version comparisons, so
install the beta APK manually in that case. Debug-signed APKs have a different
signer and cannot be updated in place by the release APK.

## Start with the runtime contract

Home's application version is 2.1.0-beta.1; its QAVS platform version is 2.1.
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
return a Home-issued `sourceToken` for the publish action. Do not pass inline
bytes or filesystem paths to `PUBLISH_QDN_RESOURCE`. Staging does not publish
or grant permission; publication still requires approval. Tokens expire and
are bound to account, tab and route.

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

## Reports still being investigated

The Android 1.8.0 upgrade currently starts Home 2 with its default appearance;
reapply your theme and accent in Settings. Existing appearance preferences are
not yet imported into the new shell's settings record.

Some testers report discarded Chat messages, attachment publishing/display
failures, missing Trust/Wiki images or avatars on mobile, and Android app
refreshes after roughly a minute. These reports remain open; a previously
merged fix is not proof that every reported device case is resolved. Legacy
apps that submit inline publication bytes must adapt to the source-token flow.
This beta provides a shared baseline for reproducing those cases.
