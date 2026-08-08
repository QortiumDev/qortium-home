# Home 2.0 Live Node AppImage

This desktop preview connects the Home v2 Dashboard to real Qortal and Qortium
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

## What works

- Live, independently refreshed Qortal and Qortium node status on Dashboard.
- Exact Local, Public, and Disabled selection for each network.
- Custom mode when that network already has a custom endpoint in this preview's
  isolated settings; otherwise the option is visibly unavailable.
- Public-node selection only after a positive-height, fully synchronized status
  and a successful public-read check.
- Refresh on launch, every 15 seconds while visible, and on manual request.
- One source-qualified app model: `qdn://` for Qortium resources and
  `qortal://` for Qortal resources, independent of target-network capabilities.

## Not connected yet

- Account selection, unlocking, names, avatars, and cross-network identity.
- QDN app catalogue or resource loading; the Chat and Wallets cards are plans,
  not runnable apps in this build.
- A Custom endpoint editor.
- Signing, publishing, transactions, Core control, updates, or Reticulum.
- The Android live-node adapter.

The preload exposes only node snapshot and node-mode operations. The renderer
cannot directly access the network, the Home 1.x bridge, accounts, QDN, Core,
updates, private keys, or seed material.
