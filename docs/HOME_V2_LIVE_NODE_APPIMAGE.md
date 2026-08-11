# Home 2.0 Live Node Preview

> Historical note (2026-08-10): this document describes the retired isolated
> live-preview artifacts. Home 2.0 now builds through the normal Qortium Home
> desktop and Android product identities. See ADR 0011 and `docs/PROJECT_PLAN.md`
> for the production account-shell boundary. The commands and artifact names
> below are retained only as an acceptance record and no longer exist.

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
  a local Blob URL. Pending resource builds retry at most twelve times, and the
  legacy asynchronous path's initial not-found response is treated as pending
  because it starts the fetch before data is ready. A stable initials
  placeholder shows a small loading ring while Home waits.
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
  error. Name-only `qdn://APP/<name>` and `qortal://APP/<name>` addresses search
  the selected network for exact `APP` resources. One result opens
  automatically; multiple results show an identifier dropdown; no result
  reports that the app was not found. An identifier supplied in the address is
  always used exactly as written.
- Desktop app content runs in a sandboxed, separately partitioned
  `WebContentsView`; Android uses its existing separate-origin HTTPS QDN render
  proxy. Both app contexts receive `qdnRequest` and `qortalRequest` as distinct
  protocols. Home 2.0 suppresses only Core's exact `/apps/q-apps.js` client in
  these embedded contexts so the Home bridge cannot be shadowed; standalone
  Core-rendered pages are unchanged.
- The initial bridge is deliberately read-only: `SHOW_ACTIONS`, `WHICH_UI`,
  `GET_HOST_INFO`, `GET_NODE_STATUS`, `GET_NODE_INFO`,
  `IS_USING_PUBLIC_NODE`, `FETCH_NODE_API`, and the compatibility
  `FETCH_QORTAL_NODE_API`. Node fetches accept only GET/HEAD, use an endpoint
  allowlist, default responses to 2 MiB, and cap explicit requests at 5 MiB.
- Theme, accent, text size, app zoom, language, selected account ID, open app
  tabs, active tab, and current Home destination persist in the isolated v2
  profile. Invalid or older state fails closed to documented defaults; wallet
  files, passwords, unlock material, and keys are not included.
- Desktop and Android app navigation drive working Back, Forward, and Reload
  controls. App-provided document titles update sanitized tab labels. Tab
  switching preserves the live isolated desktop view for the current session;
  Android mirrors the active iframe's bounded same-origin history.
- Android accepts unchanged Q-App
  `GET /transactions/signature/{signature}` reads only when the request is
  query-free, the signature is 64-88 Base58 characters, and the response is at
  most 512 KiB. Transaction searches, POSTs, and every other newly exposed Core
  API family remain blocked.

## Not connected yet

- Account creation, import, removal, and unlocking. The
  preview catalogue intentionally does not read the production Home profile;
  profile migration remains a separate reviewed decision.
- Searchable QDN app catalogue, pins/dashboard organization, and restoration of
  an app's internal browser-history entries after a full app restart.
- Most Q-App actions, including wallet/account reads that require authority,
  chat, signing, publishing, transactions, Core control, updates, or Reticulum.

The desktop shell preload exposes only node snapshot, node-mode, custom-URL, a
sanitized read-only account list, exact `APP` name discovery, four allowlisted
public identity reads, bounded pointer-aware avatar reads, isolated app-view
controls, and isolated v2 shell-state storage. App views use a separate preload
that exposes only the read-only action list above. Identity and app-discovery
responses are capped at 256 KiB and avatars at 500 KiB. The renderer cannot
directly access the network, the Home 1.x bridge, wallet files, Core control,
updates, private keys, or seed material.

## Current acceptance artifacts

Built and exercised on 2026-08-10:

- Desktop:
  `dist-release-v2-live/Qortium-Home-2-Live-Preview-1.6.3-x86_64.AppImage`
  (`fb9cfdcdeebfd7ab7d9e43e23d59e95cb067b93f617415b12f1d6ac18b48f3ff`).
- Android:
  `android/app/build/outputs/apk/v2Live/Qortium-Home-1.6.3-v2-live-android-v2Live.apk`
  (`6642ce478f69201d5d062b23973f3f7c31a47646bbc448e541a590f61c2c6f90`).

Q-Tube returned Home's 21-action catalogue, rendered its live feed, and read a
real Qortal transaction by signature on both artifacts. Desktop cancelled the
Core bridge client. Android served an empty local bridge client and kept
transaction search and POST at `403`. Trust and Help then loaded live data on
both platforms. The preview processes were stopped after acceptance.
