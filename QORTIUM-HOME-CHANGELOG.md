# Qortium Home Change Log

This is the main human-readable record of the Qortium Home application effort.
It is written for non-developers first, with the goal of making each change
easy to follow without reading code.

## What Qortium Home Is

Qortium Home is a simple user interface for managing Qortium wallets,
connecting to a configured node, browsing QDN content, and viewing chain/API
data.

The aim is to keep the application focused, understandable, and Qortium-native,
with its own clear scope.

## Early Goals

- keep the history clean and easy to read
- make each logical change its own commit
- explain every meaningful change in plain language
- keep early implementation choices documented before code grows around them
- preserve compatibility decisions separately from future implementation details

## How To Use This File

- update this file with every intentional Qortium Home commit
- use one entry per commit
- make each entry title match the commit message exactly
- keep each entry to one combined plain-language description
- keep entries understandable to non-developers
- use this file as the public narrative of the application, alongside the
  technical git history

## Change Entries

### 2026-06-08 - app: show account action pending spinner

Changed the address-bar account popup so lock and unlock actions replace their button icon with a spinner while the wallet request is pending, making it clear that Home is still working before the popup closes or an error appears.

### 2026-06-08 - app: allow QDN private chat reads without prompts

Changed QDN private chat read helpers so they no longer open a user approval prompt. Private chat reads still require the selected wallet to be unlocked and still keep key handling inside Home and Core, while QDN write, signing, publishing, group, name, and chat send actions continue to use explicit approval prompts.

### 2026-06-08 - app: split selected account and private chat permissions

Changed QDN app permissions so reading the account already selected for a Home tab no longer opens an approval prompt. Private chat read helpers now use their own explicit permission request and dialog wording, keeping sensitive private chat access gated without blocking ordinary app startup account detection.

### 2026-06-07 - app: notify QDN apps when account state changes

Changed the QDN app bridge so approved selected-account requests now include whether the selected wallet is unlocked. Home also now notifies already-loaded QDN apps when the selected account state changes, allowing apps to refresh their account status after a wallet is locked or unlocked without requiring a full app reload.

### 2026-06-07 - app: improve top-bar account lock flow

Changed the address-bar account button so it shows a visible locked or unlocked badge on the profile icon. The account popup now closes after a successful wallet lock or unlock action, returning the user to the current app while still keeping the popup open when a password or wallet action error needs to be shown.

### 2026-06-07 - app: follow system theme preference

Changed Display Settings so Theme now offers System, Light, and Dark. System is the default preference and resolves to the current operating-system/browser color scheme inside Home, while QDN apps still receive only the resolved Light or Dark theme value so app behavior stays simple and consistent.

### 2026-06-07 - app: pass display settings to QDN apps

Changed QDN app loading so Home passes the current theme, language, and text size to Core render URLs, allowing Core to inject `_qdnTheme`, `_qdnLang`, and `_qdnTextSize` when apps launch. Home now also sends live theme, language, and text-size change messages to active QDN app views, and app-generated QDN resource URLs inherit the same display settings.

### 2026-06-07 - app: add display theme and language settings

Changed Display Settings to manage theme, language, and text size as one saved display preference. Home now supports Light and Dark themes, applies the selected theme across the app shell with shared color variables, keeps English as the initial language option, and still preserves older saved text-size choices when loading the new display settings.

### 2026-06-07 - app: stop text size from scaling browser controls

Changed the display text-size setting so it only feeds the shared font-size variables instead of resizing standard controls. Browser navigation buttons, the address field, tabs, and common buttons now keep stable dimensions by default, with the top-bar browser controls matching the account and node button height more closely.

### 2026-06-07 - app: expand display text size presets

Changed Display Settings to offer Extra Small, Small, Medium, Large, and Extra Large text sizes. The previous compact size is now Extra Small, each existing size moved down one label, Medium is now the default normal size, and Extra Large adds a new larger option for users who need bigger interface text.

### 2026-06-07 - app: add browser reload button

Added a reload button beside the Back and Forward browser controls so users can refresh the active tab from the top bar. The address bar layout now reserves space for that control and keeps the browser buttons aligned with the global text-size setting.

### 2026-06-07 - app: add global display text size controls

Added a Display Settings section at the top of Settings with Small, Medium, Large, and Extra Large text size choices. Home now drives shared interface typography from one persisted text-size preference, makes Medium the larger default, keeps Small at the previous compact baseline, and lets controls that contain text grow with the selected size.

### 2026-06-07 - fix: refresh stale QDN authorization API keys

Changed desktop QDN app loading so a stale local Core API key no longer leaves users looking at Core's raw "API key invalid" response. When the render authorization request is rejected for an invalid key, Home now clears and redetects the active local Core key, retries the authorization once, and stores the corrected key for later QDN app requests.

### 2026-06-07 - fix: authorize exact QDN render resources

Changed QDN render authorization so Home includes the resource identifier when an app or website is loading a specific QDN resource. Home still sends a broader service/name authorization when no identifier is supplied, matching Core's explicit broader authorization behavior without making every identified resource look like the publisher name itself.

### 2026-06-07 - fix: simplify QDN resource loading authorization

Changed QDN resource loading so Home shows a plain loading message instead of
surfacing the internal render authorization step. Home also now sends only the
single Core render authorization that the current render endpoints check,
removing the extra identifier-specific authorization request before APP and
WEBSITE resources load.

### 2026-06-07 - fix: use resolved Core API keys for QDN workflows

Changed desktop QDN authorization, publish, delete, group, name, and chat
workflows so they use the same resolved node API key as Home's node settings and
managed Core dashboard checks. Home now carries environment overrides, saved
custom keys, detected running-Core keys, and generated managed-runtime
`apikey.txt` values through the selected node connection instead of falling back
to a development-only preview key path.

### 2026-06-06 - release: prepare home preview 8

Updated Qortium Home's package and Android version metadata to
`1.0.1-preview.8` with Android `versionCode` 9 so testers can receive the
latest QDN app bridge, overlay, dashboard, settings, managed Core, and
dependency updates as the next QortiumDev prerelease target.

### 2026-06-06 - fix: escape Windows core launcher arguments safely

Changed the managed Core launcher command quoting on Windows so backslashes are
escaped correctly before quotes and at the end of arguments. This prevents
Windows script arguments such as runtime paths from being parsed incorrectly by
the command shell.

### 2026-06-06 - test: expand QDN bridge smoke coverage

Changed the QDN bridge smoke tests so desktop and Android checks require the
expanded name, group, publish, account, and private-chat action list exposed by
`SHOW_ACTIONS`. The fixture readiness checks now ask Core to build archive
resources before expecting `READY`, and the stale-tab permission scenario now
handles the expected CDP context teardown when a QDN view is replaced before
approval.

### 2026-06-06 - app: add QDN name and group write actions

Changed the QDN app bridge so QDN apps can use `qdnRequest` for name
management, group invites/leaves/updates, and multiple inline QDN publishes
without adding legacy request aliases. The approval prompt now shows the
relevant name, amount, resource count, group, recipient, and source details
before Home signs and processes these account-scoped transactions.

### 2026-06-06 - app: keep top-bar overlays above QDN apps

Changed top-bar popovers and address suggestions so they temporarily suspend
the isolated QDN app view while the overlay is open. This keeps the node status
panel, account menu, history menus, tab menu, and autocomplete suggestions
visible and clickable above rendered QDN apps instead of being covered by the
native app view layer.

### 2026-06-06 - app: add QDN group join approvals

Changed the QDN app bridge so chat apps can read pending group join requests
for the selected account and group admins, approve a private-group join request
through the Core group-invite transaction path, and receive transaction
signatures for group join and approval actions so apps can track confirmation.
Private group and direct chat read requests now reuse the existing account-share
approval instead of opening repeated write-style permission prompts for
read-only message checks.

### 2026-06-06 - app: add account menu and QDN browse action

Changed the Dashboard to show a centered Browse QDN button above wallet
management. The top-bar account indicator now opens an account menu with wallet
status, address, and a context-sensitive lock or unlock action, while preserving
the existing node-status menu beside it.

### 2026-06-06 - app: keep QDN permission dialogs visible

Changed QDN app permission handling so Home temporarily hides the isolated QDN
app view while account-share or write-approval dialogs are open. This keeps the
Home dialog visible and clickable instead of letting the native QDN app view
cover it, then restores the QDN app view after the permission flow closes.

### 2026-06-06 - app: surface and verify blocked core runtimes

Changed Core status so Home reports a blocked runtime state when managed Core migration finds existing runtime data from a different Previewnet chain configuration. Dashboard and Settings now show the blocked runtime status, hide install/start actions that would fail again, and keep the detailed mismatch explanation in the Core details. Address suggestions now close reliably on Escape while the suggestion list is open. Added a desktop Core runtime smoke test that verifies legacy managed-Core migration preserves API key, database, QDN data, and runtime metadata, verifies mismatched chain data is not moved or deleted, and checks that same-version Home update downloads are rejected before any network download.

### 2026-06-06 - app: harden core runtime and update guards

Changed managed Core migration and startup so Home records the installed Core release's Previewnet chain identity beside the persistent runtime data and refuses to reuse that runtime when a different chain configuration is detected. Protected local Core admin calls now refresh the local API key and retry once after an invalid-key response, Home update downloads reject current or older releases in the backend as well as the UI, and a desktop browser-chrome smoke test now covers address-bar suggestion highlighting plus common tab, history, reload, and address-focus shortcuts.

### 2026-06-06 - app: reduce settings redundancy and preserve page state

Changed Dashboard and Settings so Core and Home update checks share one app-level
state instead of restarting when tabs are switched. Settings now preserves
section expansion, removes duplicate node/Core/Home fields, links Core and Home
versions consistently, hides matching latest releases and current-build asset
details, and keeps the browser tab bar and address bar fixed while the page
content scrolls internally.

### 2026-06-06 - app: clean up settings update workflows

Changed Settings into expandable sections with Node Settings open by default
and Qortium Core and Qortium Home collapsed by default. Core and Home update
status now share common labels, version-link rendering, and update action
rules; Settings can handle approved on-chain Core updates, Core uses
context-sensitive install/start/stop buttons, Home checks stable and
prerelease releases together, and local Core runtime/log paths can be opened
directly from Settings.

### 2026-06-06 - app: hide matching dashboard latest versions

Changed the Dashboard so the Latest row only appears when the checked release
differs from the current Core or Home version. Qortium Home now displays its
current version as the same `v`-prefixed release tag used by GitHub releases, so
the Core and Home version fields use consistent tag formatting.

### 2026-06-06 - app: standardize dashboard release status

Changed the Dashboard so Qortium Core and Qortium Home use matching titles,
status/version/latest rows, and cleaner update actions. Version values now open
their GitHub release pages when a release URL is known, update buttons only
appear when an update flow is actually available, and the Core card now reports
a separately running local Core as a local Core detection instead of saying it
is running outside Home.

### 2026-06-06 - app: simplify dashboard status cards

Changed the Dashboard so Qortium Core and Qortium Home update cards show compact state summaries and only the actions that are currently relevant. Detailed node configuration, Core install/runtime/log paths, release asset details, and update channel controls stay in Settings, while the top-bar node popup remains focused on current node health and sync status.

### 2026-06-06 - app: render QDN archive apps inline

Changed desktop QDN APP and WEBSITE archive loading so Home can fetch the archive, extract it into a managed render cache, and load the app's `index.html` directly in the embedded QDN view. Archive-backed apps now render in Home instead of falling back to the download/copy resource view, while approval prompts still show the original QDN resource URL.

### 2026-06-06 - app: consolidate core install folders

Changed desktop Core management so Home keeps one Home-created Core install under the stable `qortium-core` app-data folder instead of creating version-specific installs under `qortium-home`. Home now migrates the old `qortium-home/managed-core` install into `qortium-core/install`, moves mutable Core data into `qortium-core/runtime`, keeps API-key and database files across Core updates, detects already-running external local Core processes before managing files, and deletes old duplicate Home-created Core folders only after the new metadata validates.

### 2026-06-06 - app: fix address suggestions and QDN archive fallback

Changed the Home address bar so keyboard navigation moves focus onto autocomplete suggestion rows, making the selected suggestion visible and usable with arrow keys. QDN resource URLs no longer add a trailing slash when no file path is present, and archive-backed APP/WEBSITE resources now fall back to the ready/download view instead of reporting a missing iframe file when Core cannot render the archive directly.

### 2026-06-06 - docs: refresh managed core and bridge notes

Updated the public Home documentation so the current feature list uses the persistent `qortium-core` runtime log paths and describes the QDN app bridge chat support consistently. The preview limits and project plan now distinguish missing first-party direct chat UI from the QDN app direct/private chat bridge actions that Home already supports.

### 2026-06-06 - app: add address suggestion keyboard navigation

Changed the Home address bar suggestions so keyboard users can move through matching suggestions with the up and down arrows, accept the active suggestion with Enter or Tab, and close the suggestion list with Escape. The suggestion list now exposes active selection state for assistive technology while keeping mouse selection behavior available.

### 2026-06-06 - app: keep managed core runtime persistent

Changed desktop managed Core so Home keeps the installed release files and Core runtime data in separate folders. Home now stores its own data under the `qortium-home` app-data folder, launches managed Core with a stable `qortium-core` runtime directory, reads Core logs and `apikey.txt` from that runtime directory, and disables repeat Core install actions when the installed release is already current. This keeps Core database, QDN data, PID, logs, and API-key state from being recreated every time Home installs or updates a Core release.

### 2026-06-04 - app: avoid duplicate on-chain core update installs

Changed the dashboard's approved on-chain Core update handling so Home keeps polling Core while a QDN download, retry, or install is active, and stops showing another manual install button during that active attempt. This makes the UI follow Core's `/admin/update` retry state instead of encouraging repeated install clicks while the same approved update data is still being downloaded.

### 2026-06-01 - release: prepare home preview 7

Updated Qortium Home's package and Android version metadata to `1.0.1-preview.7` with Android `versionCode` 8, and adjusted Android release artifact collection so a `jarsigner`-verified release AAB signed by the local Qortium Home release key is collected as a signed artifact for the next QortiumDev prerelease target.

### 2026-06-01 - build: reduce tooling warning noise

Reduced repeated local tooling warning noise by approving only the known npm install scripts needed by Electron and esbuild, and by raising Vite's chunk warning threshold to match Qortium Home's current Electron-first bundle size. Future new install scripts and genuinely larger bundle growth should now stand out more clearly.

### 2026-06-01 - security: avoid localStorage api key flow

Adjusted fallback node settings storage so native API-key persistence uses Capacitor Preferences directly, while browser fallback storage continues to save only non-secret node settings. This removes the remaining CodeQL path that could connect a saved node API key to localStorage.

### 2026-06-01 - security: fix CodeQL scanning alerts

Adjusted the checked-in CodeQL workflow and the alerting code paths it found. Java/Kotlin analysis now prepares the Android build before scanning and then traces Home's own Android Java compile step, browser fallback node settings no longer save API keys to local storage, and QDN smoke scripts avoid printing environment-derived values or raw failure messages.

### 2026-06-01 - ci: add CodeQL advanced setup

Added a checked-in CodeQL workflow for Qortium Home. The workflow keeps JavaScript/TypeScript scanning active, prepares the Capacitor Android project before Java/Kotlin scanning, uses JDK 21 for the Android build, and builds the Android debug target under CodeQL's manual Java/Kotlin mode so Gradle dependency information can be extracted more accurately.

### 2026-06-01 - ci: enable Gradle Dependabot updates

Updated the Android Gradle dependency version layout so Dependabot can cover Qortium Home's Android project cleanly. Android library and test dependency versions now live in a Gradle file that Dependabot can inspect, while platform SDK settings stay separate, and the Dependabot version update schedule now includes Gradle for the Android project with semver-major updates ignored at first.

### 2026-06-01 - ci: add Dependabot version updates

Added Dependabot version update configuration for Qortium Home. Dependabot will now check the root npm dependencies and future GitHub Actions workflows weekly against the `main` branch while skipping semver-major update PRs at first, and the Android Gradle setup remains intentionally deferred until its generated Capacitor version layout can be covered cleanly.

### 2026-06-01 - repo: move GitHub defaults to QortiumDev

Moved Qortium Home's GitHub defaults to the QortiumDev organization. Home now checks Qortium Core release assets from `QortiumDev/qortium-core`, uses `QortiumDev/qortium-home` for app update and release-helper defaults, and documents the new repository ownership for managed Core and Home release workflows.

### 2026-06-01 - app: avoid stale local core api keys

Fixed local Core API key selection when Home is running beside an already-started local Core that was not launched from the managed Core folder. Home now detects the running local Core API key on Linux, avoids trusting a stale managed Core key when a different local Core owns the API port, and updates saved node settings to match the running node instead of sending an invalid key.

### 2026-06-01 - app: manage local core api keys

Improved local Core API key handling for approved on-chain Core update checks. Home now detects an existing managed Core `apikey.txt`, creates one for managed local Core installs when needed, saves the key in node settings, keeps custom node API keys manually configurable, and updates the dashboard/settings wording so local managed Core users are not asked to find and save the key themselves.

### 2026-06-01 - app: add on-chain core update status

Added on-chain QDN Core update status to Home's dashboard. When a selected local or trusted custom node has an API key saved, Home now checks Core's approved `/admin/update` status, shows whether an approved update is available, explains when Core auto-update mode will install it automatically, and offers a manual approved-update install action when Core is not already set to automatic install mode.

### 2026-05-31 - app: add qdn direct chat bridge actions

Added QDN direct private chat bridge actions for APP/WEBSITE pages in Home. QDN apps on desktop and Android can now send direct private chat messages through the existing chat-send request shape, list active direct private chats, and search direct private chat history using Core-managed direct-message helpers while Home keeps account private keys and signing authority outside the app.

### 2026-05-31 - app: add qdn chat bridge actions

Added QDN group and chat actions for APP/WEBSITE pages in Home. QDN apps on desktop and Android can now list and search groups, read group chat data through the selected node, request per-transaction group joins, send group chat messages with a session approval for the current tab account, and read encrypted closed-group chat through Core's private group chat endpoints without exposing generic signing or direct-message key handling to the app.

### 2026-05-31 - app: include core script output in errors

Improved managed Core start and stop diagnostics. When a Core launcher script fails, Home now includes both normal output and error output in the shown failure message, so Windows PowerShell script details written with normal output are no longer hidden behind a generic exit-code error.

### 2026-05-31 - release: prepare home preview 6

Updated Qortium Home's package and Android version metadata to `1.0.1-preview.6` so the latest desktop and Android QDN bridge, wallet, media, update handoff, and release packaging changes can be published as the next prerelease target, starting with the Windows x64 portable executable for tester verification.

### 2026-05-31 - app: add android qdn write approvals

Added Android QDN publish/delete approvals. Android QDN APP and WEBSITE pages can now request single-file QDN publish and delete actions through the tokenized bridge, Home shows a per-write approval prompt, reads publish files through a native picker, signs and processes the transaction with the selected unlocked wallet against a local node with a saved API key, and the Android QDN bridge smoke test now covers publish/delete success, denial, missing-API-key, non-local-node, and no-account write cases.

### 2026-05-31 - app: add android wallet backup creation

Added Android wallet creation and backup export. Android now creates encrypted wallets only after the user saves the backup JSON through the native document picker, starts the newly created wallet unlocked for the current app session, lets users export the selected saved encrypted wallet backup later, and expands the Android QDN bridge smoke test to verify the wallet backup JSON and export path before the existing QDN app assertions run.

### 2026-05-31 - app: add android selected-account qdnrequest

Added Android selected-account support for QDN apps. Android APP and WEBSITE frames can now call `GET_SELECTED_ACCOUNT` through the tokenized `qdnRequest` bridge, Home shows the same public-account approval dialog used by desktop, approvals are cached only for the current frame session, deny and no-account cases are rejected cleanly, and the Android QDN bridge smoke test now seeds the ignored preview account to verify the account approval flow.

### 2026-05-31 - build: fix renderer type check

Fixed the renderer TypeScript check. The isolated QDN view effect now keeps narrowed non-null references for its view API and container before using them inside nested callbacks, and the app update status helper now uses a non-null update-message kind type instead of indexing into a nullable union.

### 2026-05-31 - app: add android wallet loading

Added the first Android wallet loading flow. Android can now import an existing encrypted wallet JSON file through the native WebView file picker, save the encrypted wallet metadata in app-private storage, select the wallet for tabs, unlock or remove it with the wallet password, keep decrypted seed material in memory only for the current app session, and use the selected node to show the account name or avatar when available.

### 2026-05-31 - build: add android release packaging

Added repeatable Android release packaging. Home now has commands for release APK and AAB builds, can collect the outputs into `dist-release/`, keeps unsigned Android packages clearly labeled for local checks only, lets release signing be configured through external Gradle properties or environment variables, adds an Android-only local release check, and updates the publisher to expect signed Android release artifacts instead of the previous debug APK.

### 2026-05-31 - app: harden android qdn app bridge

Hardened Android QDN APP and WEBSITE bridge injection. Android now adds a per-frame bridge token to Home-owned QDN iframe loads, only injects `qdnRequest` into matching tokenized APP and WEBSITE render responses, ignores bridge messages without the matching token, blocks subframe navigations outside QDN render URLs, and expands the Android QDN bridge smoke test to prove un-tokened render pages do not receive the bridge.

### 2026-05-31 - app: add android qdn file downloads

Added Android support for file-style QDN resources. Android now downloads ready QDN file resources into Qortium Home's private app data, exposes them through the app FileProvider, opens them with Android's native chooser, updates the mobile viewer action from Download to Open, and includes an emulator smoke test for the FILE fixture handoff.

### 2026-05-31 - test: add android update install smoke test

Added an Android smoke test for the Home update install handoff. The new command launches or reuses the Android emulator, installs the newest debug APK, copies an APK fixture into Home's app-private update directory, verifies that unsafe paths and non-APK filenames are rejected, and confirms that a valid APK opens Android's package installer or unknown-app-source Settings screen.

### 2026-05-31 - test: add android qdn media smoke test

Added an Android smoke test for QDN image, audio, and video resource viewing. The new command launches or reuses the Android emulator, points Qortium Home at the local Previewnet node through the emulator bridge, opens the local `IMAGE`, `AUDIO`, and `VIDEO` fixtures, and verifies that each viewer uses an Android blob URL with loaded image dimensions or media metadata and no visible media error.

### 2026-05-31 - test: expand android qdn bridge smoke coverage

Expanded the Android QDN app bridge smoke test to match the desktop read/API coverage. The Android smoke now points the app at the local Previewnet node through the emulator bridge, verifies supported action discovery, node info/status reads, structured QDN resource status/properties/metadata/URL/fetch calls, resource list/search calls, and rejects legacy aliases, malformed paths, write methods, and oversized node API responses.

### 2026-05-31 - test: add packaged qdn api smoke test

Added a packaged Linux AppImage smoke mode for the desktop QDN app read/API bridge. The new command builds the Linux x64 AppImage, launches it with an isolated temporary app profile, and runs the same strict `qdnRequest`, selected-node API, structured QDN lookup, resource list/search, and rejection checks against the packaged preload and main-process files.

### 2026-05-31 - test: add desktop qdn api smoke test

Added a desktop smoke test for QDN app read/API bridge behavior. The test opens the local APP fixture in Qortium Home and verifies strict `qdnRequest` injection, supported action discovery, selected-node read-only API calls, structured QDN resource lookups, resource list/search calls, and rejection of legacy aliases, malformed paths, write methods, and oversized node API responses.

### 2026-05-31 - test: harden qdn permission edge cases

Hardened the desktop QDN app permission flow and expanded smoke coverage around it. Home now delays account signing-key access until after a write approval, rejects approved write requests if the originating QDN view changed while the prompt was open, and has desktop smoke scenarios for denied writes, missing account state, locked accounts, missing API keys, non-local nodes, stale approvals, and the normal publish/delete path.

### 2026-05-31 - test: add desktop qdn write smoke test

Added a desktop smoke test for QDN app publish and delete approvals. The test opens the local APP fixture in Qortium Home, drives the approval prompts through the UI, signs the write requests with the ignored Previewnet test account stored outside this repository, verifies the published resource reaches ready status, and deletes it again so write coverage no longer depends on a saved Home wallet.

### 2026-05-31 - app: add qdn app write approvals

Added the first desktop QDN app write approval flow. Isolated APP and WEBSITE pages can now request QDN resource publish or delete actions, Home asks the user to choose any publish file or folder and approve every write, and approved requests are built, signed with the selected tab account, and submitted through the local Core without exposing wallet seed material or local paths to QDN apps.

### 2026-05-31 - app: add qdn account read approval

Added the first account-aware QDN app permission prompt on desktop. Isolated APP and WEBSITE pages can now request the selected tab account's public address, name, and avatar URL through `GET_SELECTED_ACCOUNT` after the user approves it for that app session, while Android account access and all signing, publishing, and write-style bridge actions remain blocked.

### 2026-05-31 - test: add android qdn bridge smoke test

Added an Android smoke test for QDN app bridge behavior. The new command can reuse or start the Android emulator, install the latest debug APK, open the Qortium Home test APP fixture, and verify that Android injects `qdnRequest`, supports read-only node API calls, and still rejects legacy, malformed, and write-style bridge requests.

### 2026-05-31 - app: add android qdn app bridge

Added Android support for the strict Qortium-native QDN app bridge. Android APP and WEBSITE pages can now receive a direct `qdnRequest` function, send read-only node and QDN lookup requests through Home's currently selected node, and get the same blocked behavior for malformed, alias, write, publish, signing, and wallet-permission requests that desktop uses.

### 2026-05-31 - app: tighten qdn app api bridge

Tightened the isolated QDN app bridge into a stricter Qortium-native API. Desktop APP and WEBSITE pages now use `qdnRequest` object requests only, arbitrary node API reads go through the explicit `FETCH_NODE_API` action, and the old alias/message-channel request forms are no longer accepted while write, publish, signing, and wallet-permission requests remain blocked for a later approval flow.

### 2026-05-31 - app: remove legacy compatibility references

Removed legacy compatibility naming from the QDN app bridge and project-facing text. Isolated QDN apps now expose the Qortium-native `qdnRequest` API only, the UI identity lookup uses the `qortium_avatar` thumbnail identifier, and the docs describe Qortium Home as a new-chain application rather than a compatibility layer.

### 2026-05-31 - app: add qdn app read-only bridge

Added the first QDN app bridge for isolated desktop APP and WEBSITE pages. QDN apps can now call `qdnRequest` or use Home's message-channel bridge for read-only node and QDN lookups through Qortium Home's currently selected node without exposing the node API key. Write, publish, signing, and wallet-permission requests remain blocked until the explicit permission flow is added.

### 2026-05-31 - app: isolate desktop qdn app tabs

Changed desktop QDN APP and WEBSITE pages to render in isolated Electron web contents instead of in the main app iframe. Each browser tab now gets its own temporary in-memory web session, inactive QDN app tabs stay alive while switching tabs during the current app session, and QDN app navigation is limited to the configured node's APP/WEBSITE render URLs. Android and the native image, audio, video, text, and download viewers continue using the existing React-based viewers.

### 2026-05-31 - app: add desktop app menu

Added a native desktop app menu with common browser actions for new windows and tabs, reopening and closing tabs, Back and Forward navigation, reload, address-bar focus, standard editing commands, and window controls. Menu actions reuse the same tab and navigation behavior as the existing keyboard shortcuts.

### 2026-05-31 - app: add window keyboard commands

Added desktop window keyboard commands for browser-style window management. Ctrl/Cmd+N now opens a fresh Dashboard window, while Ctrl/Cmd+Shift+W closes the current Qortium Home window without changing the existing Ctrl/Cmd+T new-tab and Ctrl/Cmd+W close-tab behavior.

### 2026-05-31 - app: add tab drag-out windows

Added desktop tab drag-out behavior. Dragging a tab a clear distance outside the tab strip now moves that tab into a new Qortium Home window using the same route history and account context as the right-click Move Tab to New Window action, while normal in-strip dragging still only reorders tabs.

### 2026-05-31 - app: add multi-window tab moving

Added the first desktop multi-window action for browser tabs. A tab can now be moved into a new Qortium Home window from the tab right-click menu, carrying its current address, back/forward history, and selected account context while keeping each window's tab list and closed-tab history separate.

### 2026-05-31 - app: add tab context menu

Added a right-click tab menu with browser-style options for opening a new tab, reloading or duplicating the clicked tab, closing one tab, closing other tabs, closing tabs to the right, and reopening a closed tab. The menu reuses the same tab history and closed-tab restore behavior as the keyboard shortcuts.

### 2026-05-30 - app: add browser tab shortcuts

Added browser-style tab keyboard commands for opening, closing, restoring, switching, reloading, and navigating tabs. Qortium Home now keeps a recent closed-tab history so the last closed tab can be reopened with its route history and account context intact.

### 2026-05-30 - app: keep new tab button beside tabs

Changed the tab bar layout so the new tab button sits directly after the last visible browser tab instead of being pinned to the far right side of the window. The tab strip still scrolls when many tabs are open, keeping the new tab button available beside the scrollable tab row.

### 2026-05-30 - app: add dashboard route

Added `home://dashboard` as the new tab start page. The dashboard keeps account management on the first page, shows desktop local-node/Core status with direct Install Java, Install Core, update, and start actions when needed, and checks Home updates on desktop and Android so available app updates are visible without opening Settings first.

### 2026-05-30 - app: add mobile navigation gestures

Added Android back-button handling and mobile content swipes for Qortium Home navigation. Android's system back action now steps through the active tab history before leaving the app, while horizontal swipes in the main content area move back or forward when that tab has matching history, without taking gestures from form controls, media, or embedded QDN pages.

### 2026-05-30 - app: fix android qdn media previews

Changed Android QDN image, audio, and video previews to load the ready resource through the app bridge and display it from a typed blob URL instead of handing the remote node render URL directly to WebView media elements. This keeps desktop streaming behavior unchanged while avoiding Android WebView media-format failures on public Previewnet render responses.

### 2026-05-30 - app: auto-detect managed core display mode

Changed managed Core startup so Qortium Home runs the bundled preview launcher in participant mode without forcing Java headless mode. Desktop launches can now use the Core launcher's normal GUI/tray auto-detection, while terminal-only environments still fall back to headless mode through the launcher.

### 2026-05-30 - build: make linux appimages executable

Added a Linux AppImage post-build step that sets current AppImage artifacts to executable mode after `electron-builder` finishes, and updated the release asset checker to reject local AppImages that are missing the executable bit before publishing.

### 2026-05-29 - build: add release publish helper

Added a release publish helper that verifies local Home artifacts, creates and pushes the release tag, creates the GitHub prerelease, uploads each platform asset one at a time, and reruns the release checker against GitHub so large asset uploads can be retried and verified more predictably.

### 2026-05-29 - release: prepare home preview 5

Updated Qortium Home's package and Android version metadata to `1.0.1-preview.5` so the Android update install handoff can be published as the next prerelease target across the desktop and Android release assets.

### 2026-05-29 - app: add android update install handoff

Added an Android update install handoff after verified APK downloads. Android now exposes downloaded Home update APKs from Qortium Home app data through the native package installer, prompts users to allow app installs when Android requires that permission, and labels the Settings update action as Install APK instead of sending users back to the release page.

### 2026-05-29 - app: clarify android update downloads

Clarified the Android update download state so a verified APK download shows the saved app-storage URI, marks installation as a manual release-page step for now, and keeps the desktop open/reveal actions limited to desktop downloads.

### 2026-05-29 - build: add release asset checker

Added a release asset checker script that verifies the expected local Linux, macOS, Windows, and Android artifacts for the current Home version, prints their SHA-256 hashes, checks the GitHub release assets and digests, and summarizes the platform update matrix before a prerelease is considered complete.

### 2026-05-29 - release: prepare home preview 4

Updated Qortium Home's package and Android version metadata to `1.0.1-preview.4` so the Settings page, explicit `core://` address flow, remote Mac packaging helper, and complete cross-platform artifact set can be published as the next prerelease target for update-checker testing.

### 2026-05-28 - build: add remote mac packaging

Added a remote Mac packaging helper so Linux can drive Qortium Home macOS DMG builds through the `qortium-macmini` SSH host, package the committed source tree on the Mac, and copy DMG artifacts back into local `dist-release/`. The package scripts now include remote macOS x64, arm64, and universal targets, with setup notes captured in the remote Mac build documentation.

### 2026-05-28 - app: require explicit address schemes

Required Qortium Home address navigation to use explicit `qdn://`, `core://`, or `home://` schemes instead of raw Core API paths or node HTTP URLs. The address bar now offers small scheme completions for QDN, Core, and Home addresses so users can fill the right prefix without Home guessing ambiguous bare paths.

### 2026-05-28 - app: add core api address scheme

Added `core://` as the canonical address scheme for viewing endpoints on the currently selected Core node. Existing `/admin/status` paths and matching node HTTP URLs still work, but Home now displays node API history and endpoint copies with `core://` addresses to make the selected-node behavior explicit.

### 2026-05-28 - app: add settings page

Added a first-class Qortium Home Settings page at `home://settings` and moved node configuration, managed Core controls, and Home update controls out of the node status popover. The popover now stays focused on compact node status details with a Settings action, while Settings works as a normal tab/history page across desktop and Android.

### 2026-05-28 - release: prepare home preview 3

Updated Qortium Home's package and Android version metadata to `1.0.1-preview.3` so the verified download build can be published as the next prerelease target for update-checker testing.

### 2026-05-28 - app: add verified update downloads

Added manual Qortium Home update downloads on top of the release checker. Desktop can download the matched release asset into Qortium Home app data, verify the GitHub SHA-256 digest, make downloaded AppImages executable, and open or reveal the downloaded file, while Android can download and verify the matched APK into app data without attempting installation yet.

### 2026-05-28 - release: prepare home preview 2

Updated Qortium Home's package and Android version metadata to `1.0.1-preview.2` so the release-checker build can be published as a newer prerelease target for existing `1.0.1-preview.1` installs.

### 2026-05-28 - app: add home release checker

Added a read-only Qortium Home update checker that can check GitHub releases for the current desktop or Android platform, switch between stable and prerelease channels, compare the current app version with the selected release, report matching asset and digest details, and open the release page without downloading or installing updates yet.

### 2026-05-28 - release: prepare home preview 1

Updated Qortium Home's package and Android version metadata to `1.0.1-preview.1` so the first Home prerelease can be published as an update target for the upcoming release checker across desktop and Android builds.

### 2026-05-27 - app: prefer preview public read nodes

Updated Previewnet network discovery for the current Core public read API behavior. Qortium Home now probes candidate nodes for public QDN/resource search support, prefers nodes that can serve public read requests, keeps Previewnet network mode clearly read-only, and updates the app and documentation language so public network browsing is no longer described as status-only seed discovery.

### 2026-05-27 - app: improve preview core status

Updated Qortium Home for the current Core preview status and managed Core behavior. The node status menu now reads the new sync phase, target height, blocks remaining, and sync percent fields, Previewnet discovery now prefers non-seed API peers when available while clearly handling restricted public seeds, and managed Core preview log paths are shown for launch troubleshooting.

### 2026-05-27 - build: fix mac dmg build

Fixed macOS DMG packaging while keeping the Electron Builder dependency tree audit-clean. The build configuration now sets explicit DMG window and background values, and the lockfile resolves the Electron Builder stack to a newer clean version that was validated on macOS for x64, arm64, and universal DMG outputs.

### 2026-05-26 - app: add managed java install

Added desktop managed Java runtime installation for Qortium Home's managed Core flow. The Core panel can now install a Java 17 runtime into Qortium Home app data when Java is missing, reports whether Java is managed or system-provided, and starts or stops managed Core with the managed Java path preferred by the bundled preview scripts.

### 2026-05-26 - docs: add managed java plan

Updated the public README and Core management notes to make managed Java runtime support part of the desktop Core plan. The documentation now records that Qortium Home should install Java 17 only after an explicit user action, keep it inside the app data folder instead of system folders, prefer that managed runtime when running Core scripts, and support the desktop platforms already targeted by the release builds.

### 2026-05-26 - build: update tmp audit dependency

Updated the transitive `tmp` package used by Electron build tooling to the patched `0.2.6` release through an npm override. This clears the current npm audit warning for the build dependency chain without adding `tmp` as an application runtime dependency.

### 2026-05-26 - app: add managed core install

Added the first desktop managed Core flow to Qortium Home. The node menu can now check Qortium Core GitHub releases, install the current `qortium-preview.zip` prerelease into Qortium Home app data, verify the GitHub asset digest when available, detect Java 17, start and stop the bundled Previewnet scripts, and switch Home to the local node after the managed Core API becomes reachable.

### 2026-05-26 - docs: add core management plan

Added a desktop Core management plan for Qortium Home. The plan defines the first managed Core workflow: discover Qortium Core releases from GitHub, install the current `qortium-preview.zip` prerelease asset into Qortium Home app data, detect Java 17 without downloading it yet, run the bundled preview start and stop scripts, and switch Home to the local node once the managed Core API is reachable.

### 2026-05-26 - app: enable desktop node discovery

Enabled Previewnet network discovery on desktop so users without a local node can browse through reachable public Previewnet API nodes. Desktop still defaults to the local node, but the node settings menu now offers the same discovery mode as Android, resolves discovered nodes through seed `/peers/known` data, and keeps local API-key authorization only for local or custom node use.

### 2026-05-26 - app: add mobile node discovery

Changed node selection so desktop keeps a local node option while Android defaults to Previewnet network discovery instead of a single hardcoded node. Android now starts from the public seed API URLs, asks reachable seeds for `/peers/known`, probes discovered peers as API-node candidates, caches a reachable node briefly, and still lets users override everything with a custom node URL.

### 2026-05-26 - build: improve android icon and apk naming

Changed the Android launcher icon assets so the Qortium Home artwork sits inside Android's circular launcher mask instead of being clipped, added a repeatable Android icon generation command, and changed Android debug APK output names to use the Qortium Home app name and version instead of the generic `app-debug.apk` filename.

### 2026-05-26 - app: add android capacitor scaffold

Added the first Android scaffold for Qortium Home using Capacitor. The shared React UI can now be synced into an Android project, a debug APK build command is available, Android uses Qortium Home launcher and splash assets, Android can persist node settings and browse read-only node/QDN data through a fallback platform bridge, and wallet file flows remain desktop-only until the Android storage model is designed.

### 2026-05-26 - release: bump app version to 1.0.0

Changed the Qortium Home package version from `0.1.0` to `1.0.0` before the first public release so generated desktop artifacts use the reset 1.0.0 version line and avoid pre-1.0 macOS packaging issues.

### 2026-05-26 - build: add mac dmg target

Added first-pass macOS DMG packaging for Qortium Home. The build configuration now uses the tracked macOS icon, adds unsigned x64, arm64, and universal DMG commands for native macOS testing, and documents the expected local Gatekeeper warnings for early unsigned builds.

### 2026-05-26 - build: add mac icon

Added a tracked macOS `.icns` version of the Qortium Home app icon, generated from the existing icon source so the upcoming macOS DMG setup can use the proper native icon without requiring a separate manual icon conversion step.

### 2026-05-26 - build: add linux arm64 appimage target

Added Linux arm64 AppImage packaging alongside the existing Linux x64 target. The Linux electron-builder configuration now lets the command-line architecture flags choose the output, and the README documents separate x64, arm64, and combined Linux AppImage build commands.

### 2026-05-26 - build: add app icon

Added the Qortium Home prototype icon to tracked build resources, generated Linux and Windows icon assets from it, wired the icon into Electron's runtime window, and configured electron-builder so Linux AppImage and Windows portable builds no longer use the default Electron icon.

### 2026-05-26 - app: show selected account chip

Added a compact selected-account chip to the top bar for each tab. The chip resolves the account's primary registered name, falls back to the first owned name or saved wallet label, shows a published Qortium avatar when available, and exposes the resolved name, address, and wallet label in a hover tooltip.

### 2026-05-26 - app: assign accounts per tab

Changed account selection from a single Home-only wallet selector into tab-aware state. Each new tab starts with the current default wallet, the Home account selector changes only that tab's selected wallet, and navigating from Home carries that selected account with the tab so different tabs can keep different account contexts for future QDN app requests and signing prompts.

### 2026-05-26 - app: fix tab selection after drag update

Fixed tab selection after the live reshuffle drag update so a normal click on an inactive tab switches to that tab again while dragged tabs still reorder in place without triggering an unwanted selection afterward.

### 2026-05-26 - app: reshuffle tabs while dragging

Changed browser tab dragging so tabs reorder in place while the user drags across the tab strip, without showing a placement marker or detached native drag preview, while keeping click selection, close controls, middle-click close, and new-tab gestures intact.

### 2026-05-26 - app: improve tab interactions

Improved browser tab behavior by allowing the last tab to close into a fresh Home tab, adding middle-click close, double-click empty tab space to open a new tab, drag-and-drop tab reordering, and tightening the tab and top-bar spacing so the browser controls take up less room.

### 2026-05-26 - app: add browser tabs

Added first-pass browser tabs with independent navigation history for each tab. Users can open new Home tabs, switch between tabs, close every tab except the last one, and use the address bar plus Back and Forward controls against only the active tab while the existing QDN and node API viewers continue to render through the current React viewer system.

### 2026-05-26 - app: fix qdn download filenames

Changed QDN resource downloads so the native save dialog receives an absolute default path using the resource filename when available. This keeps the save location in a normal Documents or home folder while reliably pre-filling the filename field for file, text, image, audio, and video resource downloads.

### 2026-05-26 - app: add qdn media viewers

Added simple native media playback for QDN AUDIO, VOICE, PODCAST, and VIDEO resources. Qortium Home now treats these media services as openable resources, shows audio or video controls once the resource is ready, keeps copy/download/details actions available, uses media-specific row icons in explorer lists, and extends the local Previewnet bootstrap helper with small generated AUDIO and VIDEO fixtures for testing.

### 2026-05-26 - app: add node configuration

Added a persisted node configuration flow to the node status popover. Qortium Home now starts with the Qortium Previewnet preset, can save one custom node URL, allows unreachable custom nodes to remain selected while showing them as unavailable, and routes node status checks, QDN browsing, QDN rendering, and direct node API viewing through the configured node instead of separate hardcoded URLs.

### 2026-05-26 - app: add direct node api viewer

Added read-only direct node API browsing from the address bar. Users can now enter paths such as `/admin/status` or full URLs for the configured local node, and Qortium Home loads the response through Electron, formats JSON when possible, shows HTTP status and response details, and provides copy controls without exposing node access directly to rendered page code.

### 2026-05-26 - app: update previewnet api port

Changed the Qortium Previewnet preset from `localhost:62391` to `localhost:24891` across the app, the Electron QDN bridge, the local bootstrap helper, and the project plan so Qortium Home matches the current local Previewnet core settings.

### 2026-05-26 - app: add qdn text and download viewers

Added first-pass QDN viewers for text and file-style resources. JSON, metadata, blog, comment, message, and code resources can now open as inline text previews with copy and download controls, while document, file, files, and attachment resources show a ready download/details view. QDN list queries, raw text fetches, and downloads go through Electron so packaged builds avoid renderer fetch failures and the node API key is not exposed to page code, and the local Previewnet bootstrap helper now also publishes JSON and FILE fixtures for testing the new viewers.

### 2026-05-25 - docs: add 0BSD license

Added the BSD Zero Clause License to Qortium Home, updated package metadata to use the `0BSD` SPDX identifier, and changed the README license section to explain that reuse, modification, and redistribution are allowed without attribution.

### 2026-05-25 - docs: add public readme

Added the first public README for Qortium Home with the project purpose, early-development status, current and planned features, local development commands, release build commands, Previewnet-only QDN test-data helper notes, documentation links, and the current no-license status.

### 2026-05-25 - build: add windows portable exe target

Added a Windows x64 portable executable release target that can be built locally from Linux with electron-builder. The first Windows output is a single unsigned portable `.exe`, with Windows executable resource editing disabled for now so the build does not require 32-bit Wine support.

### 2026-05-25 - app: add qdn history and wildcard name browsing

Added right-click history menus to the Back and Forward buttons, changed an empty address-bar submit to open the QDN root explorer, and added `qdn://*/name` browsing so users can list every public QDN service published by one name before opening a service-specific view.

### 2026-05-25 - app: fix qdn explorer missing status labels

Changed QDN explorer list rows so resources returned without status data show a stable Published label instead of a Checking label that never updates. Direct resource loading still checks and polls resource status before opening the viewer.

### 2026-05-25 - app: add qdn image row previews

Added small image previews to QDN explorer resource rows for public image-style services. IMAGE, THUMBNAIL, and QCHAT_IMAGE resources now share the single-image viewer and show previews in resource lists when the local node can render them, while gallery browsing and image editing controls remain intentionally deferred.

### 2026-05-25 - tooling: add qdn test data bootstrap

Added a reusable local preview bootstrap command that registers the Qortium Home test name with the local preview account and republishes APP, WEBSITE, and IMAGE QDN fixtures after a chain reset. The command uses the node API key and local preview secrets, builds the zero-fee name registration transaction for MemoryPoW, computes the arbitrary-data nonce for QDN publishes, and reports the qdn:// links that Home can use for testing.

### 2026-05-25 - app: load image qdn resources

Added a shared QDN resource loading path that can authorize public QDN services, poll resource status, trigger downloads, and hand ready resources to service-specific viewers. APP and WEBSITE still load in the iframe viewer, IMAGE and THUMBNAIL resources now open in an image viewer, and other public services can reach a ready detail state until dedicated viewers are added.

### 2026-05-25 - app: improve qdn explorer navigation

Changed the QDN explorer root so it only shows public services that currently have published resources, and added browser-style Back and Forward buttons beside the address bar so users can move through QDN pages and return to Home without retyping addresses.

### 2026-05-25 - app: expand qdn explorer services

Expanded QDN explorer browsing from APP and WEBSITE only to a broader set of public QDN services, including media, document, file, JSON, blog, store, game, and message-style services. APP and WEBSITE still load in the viewer, while other services can be browsed as lists until dedicated service viewers are added.

### 2026-05-25 - app: add qdn explorer routes

Changed QDN navigation so partial addresses work like a simple file explorer. Qortium Home can now open `qdn://`, service-level links such as `qdn://APP`, and name-level links such as `qdn://APP/QortiumHomeTest` as clickable explorer lists, while exact service/name/identifier links still load the selected APP or WEBSITE in the viewer.

### 2026-05-25 - app: add qdn address bar

Added a browser-style top bar with a QDN address field and moved the node status indicator into it. Qortium Home can now parse APP and WEBSITE `qdn://` links, authorize them against the local preview node without exposing the node API key to page content, show QDN loading and error states, and render ready QDN pages in a sandboxed iframe while keeping account management as the default home view.

### 2026-05-25 - app: fix wallet backup save dialog

Changed the new-wallet backup save dialog to start from an absolute Documents or home path, populate the suggested wallet backup filename reliably, and restore a JSON wallet file type filter while keeping `.json` extension enforcement in code.

### 2026-05-25 - app: improve wallet backup filenames

Changed new-wallet backup saves to suggest `{wallet name}_{address}.json`, remove the save dialog's verbose JSON file type filter, and still enforce a `.json` extension after the user chooses a path.

### 2026-05-25 - app: name and remove wallets

Added explicit local wallet names for New and Load flows, changed the selector to show only wallet names with the active address below, and added selected-wallet removal with password verification when the wallet is locked.

### 2026-05-25 - app: create new wallets

Added new wallet creation from Qortium Home. Users can enter and confirm a password, save the encrypted wallet backup file before the account is added, and start with the new account unlocked for the current app session.

### 2026-05-25 - app: load locked wallets

Added desktop wallet loading for encrypted wallet files. Qortium Home now stores imported encrypted wallet data in its app data, remembers the selected account across restarts, and lets users unlock a wallet for the current session without writing decrypted seed data to disk.

### 2026-05-25 - app: add accounts shell

Added the first account-management shell below the Qortium Home title, with New and Load controls prepared for future wallet flows and a saved-account dropdown that stays hidden until non-secret account metadata exists.

### 2026-05-25 - app: persist window bounds

Added desktop window state persistence so Qortium Home saves its window size, location, and maximized state when the user changes them, then restores a safe saved window position on the next launch.

### 2026-05-25 - app: align detail list values

Adjusted shared detail-list layout so value columns fill the remaining panel width and right-aligned values visually line up at the right edge instead of sitting in a shrink-wrapped column.

### 2026-05-25 - app: correct node detail text styling

Changed the node status details so the node address uses the regular interface font instead of fixed-width text, while keeping the value column neatly right-aligned at normal window sizes and still responsive on narrow screens.

### 2026-05-25 - app: improve popover layout behavior

Added reusable popover behavior and shared detail-list styling so opened panels can close on outside clicks, keep technical values like node URLs readable, and resize more gracefully without awkward one-character wrapping or horizontal scrolling.

### 2026-05-25 - app: standardize typography sizes

Added shared typography size settings with a large default baseline for regular interface text, smaller support text, and restrained title sizing. This keeps most Qortium Home text consistent now and gives the future settings menu a clear place to adjust text size presets later.

### 2026-05-25 - app: add local UI fonts

Added local Lexend and Illinois Mono font files with their open font licenses. Qortium Home now uses Lexend as the primary interface font and Illinois Mono for fixed-width text, so the application typography is bundled with the app instead of depending on system fonts or an external font service.

### 2026-05-25 - app: add node status indicator

Added a small node status indicator to the main Qortium Home screen. It checks the default Qortium Previewnet node at `localhost:62391`, reports whether the node is unavailable, syncing, minting, or synced, and shows chain peers, data peers, block height, and sync percent in a compact details panel.

### 2026-05-25 - app: scaffold minimal Electron AppImage

Added the first runnable Qortium Home application scaffold with Vite, React, TypeScript, Electron, and electron-builder. The app currently opens to a minimal page that says `Qortium Home`, includes the build scripts needed for local development and Linux x64 AppImage packaging, and keeps generated dependencies and release artifacts out of git.

### 2026-05-25 - docs: record initial project plan

Added the initial Qortium Home planning document and changelog. The plan records the chosen React, Vite, TypeScript, Electron, electron-builder, and Capacitor Android stack; the first Linux x64 AppImage target; the initial one-page scope before tabs; Qortium wallet import/export with future derived-address support; Qortium Previewnet and custom node connection options; and the features intentionally deferred until after the first testable scaffold.
