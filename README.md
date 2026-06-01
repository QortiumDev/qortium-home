# Qortium Home

Qortium Home is an early preview desktop application for managing Qortium
wallets, checking a configured node, and browsing QDN content from one simple
interface.

Qortium Home is focused on account management, QDN browsing, and a browser-like
foundation that can grow into account-aware tabs over time.

## Status

This project is in active early development. Wallet support and QDN rendering
are useful for testing, but they have not had a production security review.

Do not use wallets containing meaningful funds in this application until the
wallet flows, signing flows, and release builds have been reviewed and tested
more broadly.

## Current Features

- Create a new encrypted wallet backup file on desktop and Android.
- Load encrypted Qortium wallet files.
- Save loaded wallet metadata in the local Electron app data folder.
- Load encrypted wallet JSON files on Android, export encrypted Android wallet
  backups, and keep saved Android wallet metadata in app-private storage.
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
- Build Android debug APKs plus release APK/AAB packages with Capacitor.
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

Qortium Home does not yet expose chat send, name registration, or group join
workflows. Desktop QDN apps can request QDN publish/delete actions through the
account-aware `qdnRequest` bridge after a per-write user approval prompt.

Desktop APP and WEBSITE pages rendered in isolated QDN views and Android
APP/WEBSITE pages rendered in the Capacitor WebView can use the Qortium-native
`qdnRequest` bridge for read-only node and QDN lookups through Home's currently
selected node. Desktop QDN apps and Android QDN apps can also request the
selected tab account's public identity after a user approval prompt. The bridge
accepts explicit object requests only; Android remains read-only, and Android
APP/WEBSITE bridge injection is limited to Home-owned tokenized iframe loads.

Supported read-only actions are `FETCH_NODE_API`, `GET_NODE_INFO`,
`GET_NODE_STATUS`, `GET_ACCOUNT_DATA`, `GET_ACCOUNT_NAMES`, `GET_BALANCE`,
`GET_NAME_DATA`, `GET_QDN_RESOURCE_METADATA`,
`GET_QDN_RESOURCE_PROPERTIES`, `GET_QDN_RESOURCE_STATUS`,
`GET_QDN_RESOURCE_URL`, `FETCH_QDN_RESOURCE`, `LIST_QDN_RESOURCES`,
`SEARCH_QDN_RESOURCES`, `GET_SELECTED_ACCOUNT`, `IS_USING_PUBLIC_NODE`,
`WHICH_UI`, and `SHOW_ACTIONS`. Desktop isolated QDN apps also support
`PUBLISH_QDN_RESOURCE` and `DELETE_QDN_RESOURCE`.
Publishing uses a Home-owned file/folder picker, and each publish/delete request
requires approval before Home signs and processes the transaction with the
selected tab account.

`FETCH_NODE_API` accepts path-only requests such as `/admin/status` and only
allows `GET` or `HEAD`. Full external URLs, legacy aliases such as
`GET_NODE_API`, string-form requests, and write-style methods are rejected.

## Planned Work

- Additional derived addresses from the same wallet.
- Additional `qdnRequest` approval prompts for generic signing and other
  write-style account actions.
- Local-node write workflows for chat send, name registration, and group join.
- Service-specific viewers for more QDN service types.
- Stable/mainnet Core profile selection and richer Core maintenance controls.
- Android signing credential setup and Android account-backed QDN write
  approvals.
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

Build Android release APK and AAB packages:

```sh
npm run dist:android:release
```

Build only one Android release package type:

```sh
npm run dist:android:release:apk
npm run dist:android:release:aab
```

Android release packages are copied into `dist-release/`. If release signing is
not configured, the files are named with an `-unsigned` suffix and are suitable
for local packaging checks only. Configure these values as environment
variables or Gradle properties before building public Android release assets:

```sh
QORTIUM_HOME_ANDROID_KEYSTORE=/absolute/path/to/release.keystore
QORTIUM_HOME_ANDROID_KEYSTORE_PASSWORD=...
QORTIUM_HOME_ANDROID_KEY_ALIAS=...
QORTIUM_HOME_ANDROID_KEY_PASSWORD=...
```

Check a local unsigned Android package set while signing is still pending:

```sh
npm run release:check -- --skip-github --android-only --allow-unsigned-android
```

Smoke-test the Android QDN app bridge against the default emulator:

```sh
npm run smoke:android:qdn-bridge
```

The smoke command uses the newest debug APK, reuses an attached Android device
when one is present, or starts the `qortium_home_api36` AVD in headless mode.
Set `ANDROID_AVD_HOME`, `QORTIUM_HOME_ANDROID_AVD`, or
`QORTIUM_HOME_KEEP_ANDROID_EMULATOR=1` to override those defaults. The command
points the app at the host's local Previewnet node through
`http://10.0.2.2:24891`, first verifies Android wallet creation and encrypted
backup export through the native wallet backup bridge, then verifies strict
`qdnRequest` injection, `SHOW_ACTIONS`, read-only node API GET/HEAD calls,
structured QDN resource status/properties/metadata/URL/fetch calls, resource
list/search calls, and selected-account approval/deny/no-account flows with the
ignored preview account file at
`~/git/qortium/preview/secrets/initial-minting-accounts.json`. It also verifies
rejected legacy, malformed, write-method, and oversize node API requests, and
that un-tokened Android APP render pages do not receive the Home-owned
`qdnRequest` bridge. Set `QORTIUM_HOME_ANDROID_NODE_API_URL`,
`QORTIUM_HOME_PREVIEW_ACCOUNTS_PATH`, or `QORTIUM_HOME_SMOKE_ACCOUNT_ROLE` to
override those defaults.

Smoke-test Android QDN image, audio, and video viewers against the default
emulator:

```sh
npm run smoke:android:qdn-media
```

The media smoke uses the newest debug APK, points Android at the host's local
Previewnet node through `http://10.0.2.2:24891`, opens the `IMAGE`, `AUDIO`, and
`VIDEO` QDN fixtures, and verifies that Android loads them through blob URLs
with image dimensions or media metadata available and no viewer error message.

Smoke-test Android QDN file download/open handoff against the default emulator:

```sh
npm run smoke:android:qdn-download
```

The download smoke uses the newest debug APK, points Android at the host's local
Previewnet node through `http://10.0.2.2:24891`, opens the `FILE` QDN fixture,
uses the native Open action, verifies that the file was saved under Home's
private Android app data, and confirms Android received the open handoff.

Smoke-test the Android update install handoff against the default emulator:

```sh
npm run smoke:android:update-install
```

The update install smoke uses the newest debug APK, copies it into Qortium
Home's app-private update download directory, verifies that unsafe paths and
non-APK filenames are rejected, then confirms the valid APK reaches Android's
package installer or the unknown-app-source Settings screen.

Smoke-test desktop QDN app publish/delete writes against the local Core:

```sh
npm run smoke:desktop:qdn-write
```

This command starts the desktop development app, opens the APP fixture, approves
one QDN publish and one delete request through the UI, and signs with the ignored
preview account file at `~/git/qortium/preview/secrets/initial-minting-accounts.json`.
It expects the local Previewnet node, API key, and QDN preview APP fixture to
already be available. Set `QORTIUM_HOME_PREVIEW_ACCOUNTS_PATH`,
`QORTIUM_HOME_NODE_API_KEY`, `QORTIUM_HOME_NODE_API_KEY_PATH`,
`QORTIUM_HOME_SMOKE_ACCOUNT_ROLE`, or `QORTIUM_HOME_SMOKE_PUBLISH_NAME` to
override those defaults.

Smoke-test desktop QDN app read/API bridge behavior against the local Core:

```sh
npm run smoke:desktop:qdn-api
```

This command starts the desktop development app, opens the APP fixture, and
checks strict `qdnRequest` injection, `SHOW_ACTIONS`, path-only `FETCH_NODE_API`
GET/HEAD calls, structured QDN resource status/properties/metadata/URL/fetch
calls, resource list/search calls, and rejected legacy, malformed, write-method,
and oversize node API requests. It expects the local Previewnet node and QDN
preview APP/JSON fixtures to already be available.

Smoke-test the same QDN app read/API bridge behavior from the packaged Linux
AppImage:

```sh
npm run smoke:desktop:qdn-api:packaged
```

This command builds the Linux x64 AppImage, launches it with an isolated
temporary profile, and runs the same bridge assertions against the packaged
preload and main-process files. Set `QORTIUM_HOME_SKIP_PACKAGE_BUILD=1` to reuse
an existing AppImage, or set `QORTIUM_HOME_DESKTOP_QDN_API_APPIMAGE` to test a
specific AppImage path.

Run the full desktop QDN permission smoke suite:

```sh
npm run smoke:desktop:qdn-permissions
```

The full suite covers the success path plus denied publish/delete, no selected
account, locked account, missing API key, non-local node, and stale QDN view
approval cases. To run one case directly, pass
`--scenario=<name>` to `scripts/smoke-desktop-qdn-write.mjs`.

Release artifacts are written to `dist-release/`. Generated build output should
not be committed to git.

The current Windows executable is a portable self-extracting build, not an
installer. It is unsigned and may show Windows SmartScreen warnings.

The current macOS DMG builds are unsigned and should be built on macOS. Local
test builds may require opening from Finder's right-click menu or approving the
app in macOS privacy and security settings.

Android builds require a local Android SDK with Android Platform 36 and Build
Tools 35 installed, SDK licenses accepted, and `ANDROID_HOME` or
`ANDROID_SDK_ROOT` pointing at the SDK. The debug APK output is generated under
`android/app/build/outputs/apk/debug/` with a filename like
`Qortium-Home-1.0.0-android-debug.apk`. Release APK/AAB outputs are collected
under `dist-release/`; `release:publish` expects signed Android release files
without the `-unsigned` suffix.

Regenerate Android launcher icons after changing `build/icon-source.png`:

```sh
npm run icons:android
```

Android currently connects to existing nodes only. By default it uses Previewnet
network discovery: it starts from the public seed API URLs, calls `/peers/known`,
converts discovered peer addresses to candidate API URLs, and uses a reachable
node for read-only QDN/API browsing. Candidate nodes are preferred when they
answer both `/admin/status` and a public QDN resource-search probe. Users can
still choose a custom LAN or remote node URL. Android can open file-style QDN
resources through the native Android chooser, load existing encrypted wallet
JSON files into app-private storage, create new encrypted wallets only after a
backup file is saved through Android's document picker, and export saved
encrypted wallet backups again later.

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
