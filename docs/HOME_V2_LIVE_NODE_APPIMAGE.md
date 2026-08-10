# Home 2.0 Live Node Preview

This desktop and Android preview connects the Home v2 Dashboard to real Qortal and Qortium
node status. It is the first reviewed live-data slice, not a production Home
replacement.

## Build

From the repository root:

```bash
npm run dist:linux:x64:v2-live
```

The output is:

```text
dist-release-v2-live/Qortium-Home-2-Live-Preview-1.6.3-x86_64.AppImage
```

The build does not launch the application or publish an artifact. This preview
uses the separate Electron profile name `qortium-home-v2-live`, so its settings
do not modify the current Qortium Home profile.

For the Android debug APK:

```bash
npm run dist:android:debug:v2-live
```

The Android build uses the temporary `.v2live` application ID and restores the
standard Android web assets after packaging. It does not install or launch the
APK.

The output is:

```text
android/app/build/outputs/apk/v2Live/Qortium-Home-1.6.3-v2-live-android-v2Live.apk
```

## What works

- Live, independently refreshed Qortal and Qortium node status on Dashboard.
- Exact Local, Public, Custom, and Disabled selection for each network on
  desktop. Android exposes the same choices but reports Local as unavailable;
  it never silently substitutes Public.
- A compact Custom endpoint editor. Remote endpoints require HTTPS; explicit
  loopback HTTP remains available for local development.
- Desktop detection distinguishes a running local Core, an installed but
  stopped Core, and no detected installation. Qortal detection includes the
  future managed sibling folder, the standard `~/qortal` locations, and a
  Qortal Hub custom Core directory when configured.
- Public-node selection only after a positive-height, fully synchronized status
  and a successful public-read check.
- Qortium Public selection is limited to `https://node1.qortium.app` and
  `https://node2.qortium.app`. The current healthy selection stays active until
  it fails; initial or recovery selection prefers lower observed HTTPS request
  latency.
- The Dashboard shows the selected public-node hostname.
- Refresh on launch, every 15 seconds while visible, and on manual request.
- Public account lookup by address or name across both configured networks,
  available without selecting or unlocking a wallet account. A name is grouped
  only when its owner address agrees; different owners produce a visible
  conflict rather than a merged identity.
- Independently labelled names, primary names, owner addresses, and QDN avatar
  descriptors. Qortal uses `THUMBNAIL/<name>/qortal_avatar`; Qortium prefers its
  account avatar pointer and otherwise reports `THUMBNAIL/<name>/avatar`.
- Visible public avatars are fetched through those exact pointers, capped at
  500 KiB, magic-byte checked as PNG, JPEG, GIF, BMP, or WebP, and rendered from
  a local Blob URL. Pending resource builds retry at most six times.
- A read-only Account dropdown lists saved addresses from the preview's own
  isolated profile, including derived addresses. Selecting one resolves its
  public Qortal and Qortium presences without changing the wallet store.
- One source-qualified app model: `qdn://` for Qortium resources and
  `qortal://` for Qortal resources, independent of target-network capabilities.
- The Chat (`qdn://APP/Chat/Chat`) and Help (`qdn://APP/Help/Help`) Dashboard
  cards open real QDN resources. Complete `qdn://APP/<name>/<identifier>` and
  `qortal://APP/<name>/<identifier>` addresses can also be entered directly in
  the browser bar with Enter or Go. Paths, query parameters, and fragments are
  preserved, and invalid or incomplete addresses produce a visible inline
  error.
- Desktop app content runs in a sandboxed, separately partitioned
  `WebContentsView`; Android uses its existing separate-origin HTTPS QDN render
  proxy. Both app contexts receive `qdnRequest` and `qortalRequest` as distinct
  protocols.
- The initial bridge is deliberately read-only: `SHOW_ACTIONS`, `WHICH_UI`,
  `GET_HOST_INFO`, `GET_NODE_STATUS`, `GET_NODE_INFO`,
  `IS_USING_PUBLIC_NODE`, `FETCH_NODE_API`, and the compatibility
  `FETCH_QORTAL_NODE_API`. Node fetches accept only GET/HEAD, use an endpoint
  allowlist, and cap responses at 2 MiB.
- Theme, accent, text size, app zoom, language, selected account ID, open app
  tabs, active tab, and current Home destination persist in the isolated v2
  profile. Invalid or older state fails closed to documented defaults; wallet
  files, passwords, unlock material, and keys are not included.
- Desktop app navigation drives working Back, Forward, and Reload controls.
  Tab switching preserves the live isolated view for the current session.

## Not connected yet

- Account creation, import, removal, and unlocking. The
  preview catalogue intentionally does not read the production Home profile;
  profile migration remains a separate reviewed decision.
- Searchable QDN app catalogue, pins/dashboard organization, and restoration of
  an app's internal browser-history entries after a full app restart.
- Most Q-App actions, including wallet/account reads that require authority,
  chat, signing, publishing, transactions, Core control, updates, or Reticulum.

The desktop shell preload exposes only node snapshot, node-mode, custom-URL, a
sanitized read-only account list, four allowlisted public identity reads, and
bounded pointer-aware avatar reads, isolated app-view controls, and isolated v2
shell-state storage. App views use a separate preload that exposes only the
read-only action list above. Identity responses are capped at 256 KiB and
avatars at 500 KiB. The renderer cannot directly access the network, the Home
1.x bridge, wallet files, Core control, updates, private keys, or seed material.
