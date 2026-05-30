# Qortium Home

Qortium Home is an early preview desktop application for managing
Qortium/Qortal-compatible wallets, checking a configured node, and browsing QDN
content from one simple interface.

The current application is intentionally smaller than Qortal Hub. Qortal Hub is
used as a compatibility and integration reference, but Qortium Home is focused
on account management, QDN browsing, and a browser-like foundation that can grow
into account-aware tabs over time.

## Status

This project is in active early development. Wallet support and QDN rendering
are useful for testing, but they have not had a production security review.

Do not use wallets containing meaningful funds in this application until the
wallet flows, signing flows, and release builds have been reviewed and tested
more broadly.

## Current Features

- Create a new encrypted wallet backup file.
- Load Qortal Hub-compatible encrypted wallet files.
- Save loaded wallet metadata in the local Electron app data folder.
- Keep wallets locked after restart and unlocked only for the current session.
- Select, unlock, lock, and remove saved wallets.
- Show node status for the configured node, including sync phase, target
  height, blocks remaining, sync percent, and peer counts when Core provides
  them.
- Switch between a local node, Previewnet network discovery, and one saved custom node.
- Install the latest Qortium Core prerelease from GitHub into a desktop managed
  app-data folder.
- Install a managed Java 17 runtime for desktop Core when system Java is
  missing.
- Start and stop the managed desktop Previewnet Core.
- Show managed Core preview log paths for `preview/qortium.log`,
  `preview/run.log`, and the Windows `preview/run-error.log` when applicable.
- Browse QDN services, names, and resources from `qdn://` URLs.
- Load `APP` and `WEBSITE` resources in an embedded viewer.
- Load image-style QDN resources such as `IMAGE`, `THUMBNAIL`, and
  `QCHAT_IMAGE`.
- Load media-style QDN resources such as `AUDIO`, `VOICE`, `PODCAST`, and
  `VIDEO`.
- Load text-style QDN resources such as `JSON`, `METADATA`, `BLOG`, and
  `MESSAGE`.
- Download file-style QDN resources such as `DOCUMENT`, `FILE`, `FILES`, and
  `ATTACHMENT`.
- Browse read-only node API endpoints with paths such as `/admin/status`.
- Browse all public services for one name with `qdn://*/name`.
- Use session-only browser tabs with independent page history.
- Choose a separate selected wallet for each tab before navigating.
- Show the active tab's selected wallet as an avatar or initial in the top bar.
- Use in-session Back and Forward navigation history.
- Build Linux x64 and arm64 AppImages, macOS DMGs, and a Windows x64 portable executable.
- Build a first-pass Android debug APK with Capacitor.
- Package Linux, Windows, and macOS build resources with the Qortium Home app icon.

## Preview Limits

Previewnet network discovery uses public read-only APIs. They are suitable for
status checks, peer discovery, QDN browsing, and read-only API inspection, but
restricted write, admin, and private endpoints should use a local Core or a
custom node controlled by the user.

When network discovery is selected, Home starts from the public seeds, asks for
known peers, probes candidates for public QDN/read API support, and prefers a
reachable node that can answer public QDN resource searches. Home does not send
the local API key while using Previewnet network mode.

Qortium Home does not yet expose chat send, name registration, QDN publish, QDN
delete, or group join workflows. Those actions are planned for a later
account-aware `qdnRequest` and approval/signing pass.

## Planned Work

- Additional derived addresses from the same wallet.
- `qdnRequest` support with approval prompts for account access and signing.
- Local-node write workflows after approval prompts exist, including chat send,
  name registration, QDN publish, QDN delete, and group join.
- Service-specific viewers for more QDN service types.
- Stable/mainnet Core profile selection and richer Core maintenance controls.
- Signed Android APK/AAB release packaging and Android wallet file flows.
- Code signing and release verification for production builds.

## Development Setup

Install dependencies:

```sh
npm install
```

Start the desktop development app:

```sh
npm run dev
```

Build the renderer and Electron main process:

```sh
npm run build
```

Run the built app locally:

```sh
npm start
```

## Release Builds

Build a Linux x64 AppImage:

```sh
npm run dist:linux:x64
```

Build a Linux arm64 AppImage:

```sh
npm run dist:linux:arm64
```

Build both Linux AppImage targets:

```sh
npm run dist:linux:all
```

Linux AppImage dist scripts set the generated `.AppImage` files to executable
mode after `electron-builder` finishes.

Build a macOS x64 DMG on macOS:

```sh
npm run dist:mac:x64
```

Build a macOS arm64 DMG on macOS:

```sh
npm run dist:mac:arm64
```

Build a universal macOS DMG on macOS:

```sh
npm run dist:mac:universal
```

Build a Windows x64 portable executable:

```sh
npm run dist:win:x64
```

Sync the web app into the Android project:

```sh
npm run android:sync
```

Open the Android project in Android Studio:

```sh
npm run android:open
```

Build a local Android debug APK:

```sh
npm run dist:android:debug
```

Release artifacts are written to `dist-release/`. Generated build output should
not be committed to git.

The current Windows executable is a portable self-extracting build, not an
installer. It is unsigned and may show Windows SmartScreen warnings.

The current macOS DMG builds are unsigned and should be built on macOS. Local
test builds may require opening from Finder's right-click menu or approving the
app in macOS privacy and security settings.

The current Android build is an unsigned/debug-oriented Capacitor scaffold. It
requires a local Android SDK with Android Platform 36 and Build Tools 35
installed, SDK licenses accepted, and `ANDROID_HOME` or `ANDROID_SDK_ROOT`
pointing at the SDK. The debug APK output is generated under
`android/app/build/outputs/apk/debug/` with a filename like
`Qortium-Home-1.0.0-android-debug.apk`.

Regenerate Android launcher icons after changing `build/icon-source.png`:

```sh
npm run icons:android
```

Android currently connects to existing nodes only. By default it uses Previewnet
network discovery: it starts from the public seed API URLs, calls `/peers/known`,
converts discovered peer addresses to candidate API URLs, and uses a reachable
node for read-only QDN/API browsing. Candidate nodes are preferred when they
answer both `/admin/status` and a public QDN resource-search probe. Users can
still choose a custom LAN or remote node URL. Android wallet file
creation/loading and QDN file downloads are intentionally still desktop-only.

Desktop still defaults to a local node at `http://127.0.0.1:24891`, but users
without a local node can also choose Previewnet network discovery from the node
settings menu. Local node mode keeps using the local API key for authorization
calls; network discovery is intended for public read-only browsing and direct
inspection of public `GET` endpoints.

Desktop can also manage a local Qortium Core Previewnet install from the node
settings menu. The first managed Core flow checks GitHub releases for the
current `qortium-preview.zip` prerelease asset, installs it under Qortium Home's
app data folder, can install a managed Java 17 runtime when needed, and runs the
bundled preview start and stop scripts.

## QDN Preview Test Data

The development helper below is for local Previewnet testing only:

```sh
npm run qdn:bootstrap-test-data
```

It registers or reuses a local test name and publishes APP, WEBSITE, IMAGE,
AUDIO, VIDEO, JSON, and FILE fixtures that Qortium Home can browse. It expects a
running local Previewnet node and a local preview account with permission to
publish test resources.

Supported environment variables:

- `QORTIUM_HOME_NODE_API_URL`
- `QORTIUM_HOME_TEST_NAME`
- `QORTIUM_HOME_NODE_API_KEY`
- `QORTIUM_HOME_NODE_API_KEY_PATH`
- `QORTIUM_HOME_PREVIEW_ACCOUNTS_PATH`

Never commit node API keys, private account files, wallet files, seed material,
or local preview secrets.

## Documentation

- Project plan: [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md)
- Change log: [QORTIUM-HOME-CHANGELOG.md](QORTIUM-HOME-CHANGELOG.md)

## License

Qortium Home is licensed under the BSD Zero Clause License (`0BSD`). You may
use, copy, modify, and distribute it for any purpose, with or without fee, and
no attribution is required.
