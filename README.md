# Qortium Home

Qortium Home is a desktop and Android application for managing Qortium
wallets, running or connecting to a Qortium node, and browsing QDN content
from one simple interface.

Qortium Home is focused on account management, QDN browsing, and a browser-like
foundation built around account-aware tabs. Prebuilt packages are published at
<https://github.com/QortiumDev/qortium-home/releases> (currently on the
prerelease channel). See [Status](#status) below before using wallets
with meaningful funds.

## Status

This project is in active early development. Wallet support and QDN rendering
are useful for testing, but they have not had a production security review.

Do not use wallets containing meaningful funds in this application until the
wallet flows, signing flows, and release builds have been reviewed and tested
more broadly.

## Current Features

- **Wallets** — create, load, and export encrypted wallet backups on desktop
  and Android, derive multiple addresses from one wallet, and keep saved
  wallets locked after restart with per-session unlock, lock, and remove.
- **Node modes** — switch between a local node, one saved custom node, and
  Previewnet network discovery, with a node status dashboard showing sync
  phase, target height, blocks remaining, and peer counts when Core provides
  them.
- **Managed Core node** — install the current Qortium Core prerelease from
  GitHub into a stable desktop app-data folder, start and stop it, surface its
  runtime log paths, and check Core's approved on-chain/QDN update status.
- **Managed Java runtime** — install a Home-managed Java 25 runtime when
  system Java is missing (any system Java 17 or newer keeps working), with a
  visible weekly update check and an opt-in automatic Java update setting.
- **Managed I2P transport** — install and run the i2pd router from
  `QortiumDev/qortium-i2pd` with selectable IP/I2P transport modes for the
  managed Core.
- **QDN browsing** — explore services, names, and resources from `qdn://`
  URLs in session-only tabs with independent history, a per-tab selected
  account, read-only node API browsing, and saved bookmarks.
- **Document and media viewers** — in-app viewers for images, audio, and
  video; a document reader for PDF, EPUB, plain text, and CBZ/CBR comics; a
  ZIP/RAR archive browser and a `GIT_REPOSITORY` branch, commit, and file-tree
  browser with a plain-snapshot fallback; and
  code, Markdown, CSV, and JSON views.
- **QDN app hosting** — `APP` and `WEBSITE` resources run in isolated views
  with the account-aware `qdnRequest` bridge for read lookups and
  approval-gated writes (see [QDN App Bridge](#qdn-app-bridge)).
- **QDN app notifications** — apps can show system notifications and register
  subscription rules with filters that keep working while their tab is in the
  background, plus app-controlled tab titles for unread counts.
- **Self-update** — checks GitHub releases on a stable or prerelease channel,
  downloads and verifies the matching platform asset, installs desktop
  updates next to the running build, and hands Android updates to the system
  package installer.
- **First-run Welcome setup** — a resumable, skippable setup for new installs
  that helps choose a connection mode, create or import an account, and pick
  what to explore first.
- **App versioning (QAVS)** — recognizes the Qortium App Versioning Standard
  label on QDN apps and websites, shows compatibility badges, and answers
  `GET_HOST_INFO` so apps can adapt to the platform version.
- **UI styles and languages** — Classic, Modern, and Fun display styles,
  adjustable text size, and translations for more than twenty locales.
- **Build targets** — Linux x64/arm64 AppImages, macOS DMGs, a Windows x64
  portable executable, and Android APK/AAB packages via Capacitor.

## Preview Limits

Previewnet network discovery uses public read-only APIs. They are suitable for
status checks, peer discovery, QDN browsing, and read-only API inspection, but
restricted write, admin, and private endpoints should use a local Core or a
custom node controlled by the user.

When network discovery is selected, Home starts from the public seeds, asks for
known peers, probes candidates for public QDN/read API support, and prefers a
reachable node that can answer public QDN resource searches. Home does not send
the local API key while using Previewnet network mode.

Qortium Home does not yet expose a first-party direct chat UI or generic
transaction signing workflows.

## QDN App Bridge

Desktop APP and WEBSITE pages rendered in isolated QDN views and Android
APP/WEBSITE pages rendered in the Capacitor WebView can use the Qortium-native
`qdnRequest` bridge. It exposes read-only node, QDN, account, group, chat,
rating, and market-data lookups, plus approval-gated write actions (QDN
publish/delete, group, name, payment, poll, list, chat, minting, rating, and
node-settings requests) that Home signs itself, so QDN apps never receive
wallet private keys or generic signing capability. The bridge accepts strict
object-form requests only — legacy aliases, string-form requests, external
URLs, and write-style node API methods are rejected — and Android
APP/WEBSITE bridge injection is limited to Home-owned tokenized iframe loads.

The authoritative action catalogue is
[`electron/qdn-app-actions.ts`](electron/qdn-app-actions.ts). Documented
bridge feature areas include app versioning
([docs/APP_VERSIONING.md](docs/APP_VERSIONING.md)), app notifications
([docs/APP_NOTIFICATIONS.md](docs/APP_NOTIFICATIONS.md)), same-tab
navigation ([docs/OPEN_CURRENT_TAB.md](docs/OPEN_CURRENT_TAB.md)), and
approval-gated Home display settings
([docs/HOME_SETTINGS_BRIDGE.md](docs/HOME_SETTINGS_BRIDGE.md)). Operational
details apps rely on — per-mode action availability, poll scheduling fields,
the publish source-token flow, `FETCH_NODE_API` limits, and the rating
actions — are collected in
[docs/BRIDGE_ACTIONS.md](docs/BRIDGE_ACTIONS.md). The bridge
also offers interoperability actions that target the separate Qortal network —
such as `SEND_QORT` and the `GET_QORTAL_*` reads — which are kept distinct
from Qortium's own actions; Qortium and Qortal remain separate networks.

## Planned Work

- Additional `qdnRequest` approval prompts for generic signing and other
  write-style account actions.
- First-party local-node workflows for chat management.
- Mainnet Core profile selection and richer Core maintenance controls.
- Code signing and release verification for production builds.

## Download

Prebuilt packages are published on the
[GitHub Releases page](https://github.com/QortiumDev/qortium-home/releases):
Linux AppImages (x64 and arm64), macOS DMGs, a Windows x64 portable
executable, and an Android APK. Home also has an in-app self-update system
with stable and prerelease channels that downloads and verifies the matching
platform asset; releases are currently published on the prerelease channel.

All current builds are unsigned. Expect operating-system warnings (Windows
SmartScreen, macOS Gatekeeper approval, Android unknown-source prompts), and
see [Status](#status) before using wallets with meaningful funds.

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

Each macOS dist target also has a `:remote` variant (for example
`npm run dist:mac:universal:remote`) that runs the build on a remote Mac; see
[docs/REMOTE_MAC_BUILDS.md](docs/REMOTE_MAC_BUILDS.md).

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
list/search calls, group/chat read action availability, selected-account
approval/deny/no-account flows, and account-backed QDN publish/delete approve,
deny, missing-API-key, non-local-node, and no-account write paths with ignored
preview account material at
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
calls, resource list/search calls, group/chat read calls, and rejected legacy,
malformed, write-method, and oversize node API requests. It expects the local
Previewnet node and QDN preview APP/JSON fixtures to already be available.

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

Check that Home's QDN service whitelists have not drifted from the node's
catalogue:

```sh
npm run smoke:qdn-services
```

This reads Home's curated service lists from `src/qdn.ts` and `electron/qdn.ts`,
confirms the two copies match, and verifies every listed service still exists in
`GET /arbitrary/services` and is public — so a service Core renames, removes, or
makes private cannot silently rot in Home. Public Core services Home does not
surface (system/chat-internal ones) are reported, not failed. It only needs a
reachable node; override the URL with `QORTIUM_HOME_NODE_API_URL`.

Release artifacts are written to `dist-release/`. Generated build output should
not be committed to git. The release checker and publisher default to the public
`QortiumDev/qortium-home` GitHub repository.

The current Windows executable is a portable self-extracting build, not an
installer. It is unsigned and may show Windows SmartScreen warnings.

The current macOS DMG builds are unsigned and should be built on macOS. Local
test builds may require opening from Finder's right-click menu or approving the
app in macOS privacy and security settings.

Android builds require a local Android SDK with Android Platform 36 and Build
Tools 35 installed, SDK licenses accepted, and `ANDROID_HOME` or
`ANDROID_SDK_ROOT` pointing at the SDK. The debug APK output is generated under
`android/app/build/outputs/apk/debug/` with a filename like
`Qortium-Home-<version>-android-debug.apk`. Release APK/AAB outputs are collected
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
encrypted wallet backups again later. Android QDN APP/WEBSITE pages can also
request single-file QDN publish/delete writes, group joins, group chat sends,
and private closed-group chat reads after approval when the user has a local
selected node, an unlocked selected account, and the local node API key saved in
app-private node settings.

Desktop still defaults to a local node at `http://127.0.0.1:24891`, but users
without a local node can also choose Previewnet network discovery from the node
settings menu. Local node mode keeps using the local API key for authorization
calls; network discovery is intended for public read-only browsing and direct
inspection of public `GET` endpoints.

Desktop can also manage a local Qortium Core Previewnet install from the node
settings menu. The first Core management flow checks `QortiumDev/qortium-core`
GitHub releases for the current `qortium-preview.zip` prerelease asset,
installs it under the stable `qortium-core` app-data folder, can install a
managed Java 25 runtime when needed (any system Java 17 or newer is also
accepted), and runs the bundled preview start and stop
scripts. Home keeps its own desktop data under `qortium-home` by default, while
Core release files, install metadata, downloads, Java, and runtime files live
under `qortium-core`. Core updates replace only `qortium-core/install`, leaving
`qortium-core/runtime` intact so they do not recreate the chain database, QDN
data, logs, PID file, or API key.
When a local or trusted custom Core node is selected with an API key available,
the dashboard also checks Core's approved on-chain/QDN update status through
`/admin/update`. For Home-created local Core installs, Home reads the Core
runtime `apikey.txt` automatically and saves it in node settings. Custom nodes
can save their own API key in node settings. On Linux, Home can also detect the
`apikey.txt` for an already-running local Core process so it does not send a
stale Core key to a different local Core. If Core reports an approved update
and its auto-update mode is `INSTALL`, Home shows that Core will install it
automatically; otherwise Home offers a manual approved-update install action.

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
- App versioning standard (QAVS): [docs/APP_VERSIONING.md](docs/APP_VERSIONING.md)
- QDN app notifications: [docs/APP_NOTIFICATIONS.md](docs/APP_NOTIFICATIONS.md)
- Core management: [docs/CORE_MANAGEMENT.md](docs/CORE_MANAGEMENT.md)
- `OPEN_CURRENT_TAB` bridge action: [docs/OPEN_CURRENT_TAB.md](docs/OPEN_CURRENT_TAB.md)
- Bridge action notes: [docs/BRIDGE_ACTIONS.md](docs/BRIDGE_ACTIONS.md)
- Home settings QDN bridge: [docs/HOME_SETTINGS_BRIDGE.md](docs/HOME_SETTINGS_BRIDGE.md)
- Remote macOS builds: [docs/REMOTE_MAC_BUILDS.md](docs/REMOTE_MAC_BUILDS.md)
- Change log: [QORTIUM-HOME-CHANGELOG.md](QORTIUM-HOME-CHANGELOG.md) — every
  merged PR adds one plain-language entry in the same branch.
- Website: <https://qortium.app>
- Community discussions: <https://github.com/orgs/QortiumDev/discussions>

## License

Qortium Home is licensed under the BSD Zero Clause License (`0BSD`). You may
use, copy, modify, and distribute it for any purpose, with or without fee, and
no attribution is required.
