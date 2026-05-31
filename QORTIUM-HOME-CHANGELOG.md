# Qortium Home Change Log

This is the main human-readable record of the Qortium Home application effort.
It is written for non-developers first, with the goal of making each change
easy to follow without reading code.

## What Qortium Home Is

Qortium Home is a simple user interface for managing Qortium/Qortal-compatible
wallets, connecting to a configured node, browsing QDN content, and viewing
chain/API data.

The aim is to keep the application focused and understandable. Qortal Hub can
be used as a reference for compatible wallet behavior, QDN concepts, and native
app patterns, but Qortium Home should remain a smaller application with its own
clear scope.

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

Added a compact selected-account chip to the top bar for each tab. The chip resolves the account's primary registered name, falls back to the first owned name or saved wallet label, shows a published Qortal avatar when available, and exposes the resolved name, address, and wallet label in a hover tooltip.

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

Added desktop wallet loading for Qortal Hub-compatible encrypted wallet files. Qortium Home now stores imported encrypted wallet data in its app data, remembers the selected account across restarts, and lets users unlock a wallet for the current session without writing decrypted seed data to disk.

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

Added the initial Qortium Home planning document and changelog. The plan records the chosen React, Vite, TypeScript, Electron, electron-builder, and Capacitor Android stack; the first Linux x64 AppImage target; the initial one-page scope before tabs; Qortal Hub-compatible wallet import/export with future derived-address support; Qortium Previewnet and custom node connection options; and the features intentionally deferred until after the first testable scaffold.
