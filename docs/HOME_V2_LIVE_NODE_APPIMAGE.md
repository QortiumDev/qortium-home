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
- One source-qualified app model: `qdn://` for Qortium resources and
  `qortal://` for Qortal resources, independent of target-network capabilities.

## Not connected yet

- Wallet account selection and unlocking. Public identity lookup is connected,
  but avatar image bytes are not loaded yet.
- QDN app catalogue or resource loading; the Chat and Wallets cards are plans,
  not runnable apps in this build.
- Signing, publishing, transactions, Core control, updates, or Reticulum.

The desktop preload exposes only node snapshot, node-mode, custom-URL, and four
allowlisted public identity-read operations. Identity responses are capped at
256 KiB. The renderer cannot directly access the network, the Home 1.x bridge,
wallet accounts, QDN content, Core control, updates, private keys, or seed
material.
