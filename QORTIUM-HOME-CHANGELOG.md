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
- make each logical PR merge easy to review
- explain every meaningful change in plain language
- keep early implementation choices documented before code grows around them
- preserve compatibility decisions separately from future implementation details

## How To Use This File

- update this file with every intentional Qortium Home PR/squash merge
- use one entry per merged PR
- make each entry title match the squash commit / PR title
- keep each entry to one combined plain-language description
- keep entries understandable to non-developers
- use this file as the public narrative of the application, alongside the
  technical git history

## Change Entries

### 2026-06-29 - release: prepare home 1.2.0

Bumps Qortium Home to 1.2.0 with Android versionCode 21 for the next prerelease.
This release adds the Classic/Modern UI-style setting and broadcasts it to QDN
apps, lets QDN apps publish, multi-publish, and delete resources while Home is
connected to a public Previewnet node, and raises QDN publish-source limits from
5 MiB to 100 MiB while leaving smaller app read-response caps unchanged. Public
publish builds route through Core's unsigned builder endpoints; Home computes
the arbitrary transaction nonce locally, signs with the unlocked selected
account, and submits only signed transaction bytes to the node. It also salvages
old managed-Core `preview/lists/` files into the stable runtime lists folder
before replacing a Core install, without overwriting runtime files. The release
also folds in dependency updates for `tar` 7.5.19, `lucide-react` 1.22.0, and
`vite` 7.3.6.

### 2026-06-26 - core-docs: pass Home display settings to Swagger UI

Passes Home's current theme, accent, and text-size settings into the Core API
documentation iframe and sends live display-setting messages when those settings
change. This lets the Core-served Swagger UI match Home's display preferences
without reloading the documentation view after every settings change, once the
matching Core-side Swagger theme layer is present.

### 2026-06-24 - fix: keep managed i2pd alive when Core's run.pid is stale

Fixes a problem where closing Home could shut down the managed I2P router even
though the Qortium Core was still running, which forced users to turn I2P back on
every time they reopened Home. Home decides whether to keep the I2P router running
by checking whether its managed Core is alive, and it had been trusting only the
small `run.pid` file the Core writes when it first starts. That file can fall out
of date — most notably after the Core restarts itself to apply an I2P setting
change — so Home mistook a running Core for a stopped one and stopped I2P with it.
Home now falls back to detecting the live Core process directly when the pid file
looks stale, so the I2P router is kept running whenever the Core genuinely is. (On
Linux this fully resolves the issue; a companion Core-side fix keeps the pid file
accurate on macOS and Windows too.)

### 2026-06-24 - feat: download Home updates into the running install folder

Changes where Home saves a downloaded application update. It now writes the update
into the same folder the running app was launched from, so the new build lands right
next to the current one instead of in a separate internal updates folder. When that
folder can't be written to — for example a packaged macOS app bundle or a Windows
"Program Files" install — or when the download would overwrite the app that is
currently running, Home falls back to its previous internal updates location. The
"Open" and "Reveal in folder" actions continue to work wherever the file was saved.

### 2026-06-23 - release: prepare home 1.1.2

Bump to 1.1.2 (Android versionCode 20) for the next prerelease. It covers proper
GIT_REPOSITORY handling in the QDN viewer, dashboard tile dropdown sizing and
spacing fixes, dialog focus/keyboard and app-instance robustness fixes, a fix so
relaunch opens a new window without crashing on destroyed web contents, lazy-loaded
locales with startup timing instrumentation, and keeping the Core block/follow
lists directory intact across Core updates.

### 2026-06-23 - core: preserve the Core lists directory across updates

Adds the Core `lists/` directory (the user's QDN block and follow lists) to the
set of runtime files Home keeps when it relocates a managed Core install, so a
list folder that already sits in the runtime directory is never left behind
during a migration. The primary fix for lists being wiped on update lives in the
Core preview launcher, which now stores the lists in the runtime directory rather
than inside the install folder Home replaces on each update; this change makes
Home's own runtime handling consistent with that.

### 2026-06-22 - release: prepare home 1.1.1

Bumped Qortium Home to `1.1.1` (Android `versionCode` 19) for the next QortiumDev
prerelease. This release lets QDN apps save a resource to a file on desktop,
Android, and the web; ties Home's managed I2P router to the local Core's lifetime
instead of the Home window; and streamlines Settings and the dashboard — node and
transport selection now live in the Qortium Core section (and on the dashboard
tiles), the standalone Node Settings and Connections sections are gone, and the
Core and Home dashboard tiles share an equal height with evenly spread contents.

### 2026-06-22 - ui: equal-height dashboard tiles and instant transport-control hiding

Two refinements to the dashboard and node controls. The Qortium Core and Home
dashboard tiles are now always the same height (the shorter one grows to match the
taller), and each tile's contents spread evenly down its height instead of bunching
at the top. The transport selector also disappears the instant you switch the node
to Previewnet network mode (where transports can't be managed), rather than waiting
for the node switch to finish.

### 2026-06-22 - ui: move the I2P transport and router controls out of a separate Connections section

Continues streamlining Settings and the dashboard. The standalone Connections
section is gone and its controls moved to where they fit:

- The transport selector (Direct + I2P fallback / Direct only / I2P only) now sits
  in the Qortium Core section, just below the node selector, and also on the
  dashboard's Home tile. Like the node selector, it applies the moment you change
  it — no Save button — while still showing the I2P-only "hides your IP / needs a
  running router" note.
- The button that sets up Home's I2P router moved to the Home section and onto the
  dashboard Home tile, matching the one that used to live under Connections.
- The Connections section's detailed status rows (activity, peer counts) were
  removed; that information is already surfaced elsewhere.
- The dashboard Home tile's rows now use the same tight spacing as the Core tile.

Settings now has just Display, Qortium Core, and Home sections (with a node section
still shown on Android and the web, which have no managed Core to host it).

### 2026-06-22 - ui: fold node selection into the Qortium Core section and dashboard tile

Streamlined how you choose which node Home talks to. On the desktop the separate
"Node Settings" section is gone; its node selector (Local / Network / Custom) now
lives at the top of the Qortium Core section, next to the Local API endpoint that
was already shown there. Changing the selector applies right away — Home saves and
reconnects on its own, so there is no longer a separate Test and Save button; if
the chosen node can't be reached you simply see the usual disconnected state. The
same selector now also sits on the dashboard's Qortium Core tile, in line with the
Start/Stop button and left-aligned, so you can switch nodes without opening
Settings. On Android and the web, where there is no managed Core, the node selector
keeps its own Settings section.

### 2026-06-22 - feat: let Q-Apps save a QDN resource to a file (desktop, Android, and web)

QDN apps can now ask Home to download a resource to a file through a new
`SAVE_QDN_RESOURCE` bridge action. On the desktop this opens a native save dialog;
on Android the file goes through the same system "save to a location you choose"
flow the QDN explorer already uses, and on the web build it downloads through the
browser. The app is told whether the save was canceled. The desktop action was
contributed by 7r15; this also wires it up for Android and web so the same app
request works everywhere Home runs.

### 2026-06-22 - fix: tie the managed I2P router to Core's lifetime, not Home's window

When Home runs its own I2P router for the local Core, the router's lifetime now
follows Core instead of the Home window. Closing Home while Core is still running
no longer shuts the router down and strands the running Core without its I2P
fallback transport; the router keeps running and Home reattaches to it next time
it starts. Closing Home only stops the router when Core is already stopped. The
router is still started before Core and stopped when you stop Core through Home,
as before. To make this possible it now runs as an independent background process
with its own log file, and each time Home starts it reconciles the router against
Core — adopting one that is still running, or cleaning up one that was left behind
because Core stopped while Home was closed.

### 2026-06-22 - build: pin the macOS 11 legacy DMG to Electron 36

Corrected the macOS 11 legacy build, which was set to package with Electron 38 on
the assumption that it still supported macOS Big Sur. It does not: Electron 37 and
newer require macOS 12, so every bundled binary was marked as needing macOS 12 and
the build's own minimum-version check (correctly) refused to produce the asset.
Pinned the legacy build to Electron 36, the last line that still targets macOS 11,
so the `macos11-universal.dmg` is genuinely runnable on Big Sur. The regular
universal DMG continues to use the current Electron line for macOS 12 and newer.

### 2026-06-22 - build: exclude unused @napi-rs/canvas from packaging

Stopped bundling `@napi-rs/canvas`, a native module that the PDF library lists as
an optional dependency but Qortium Home never uses (the in-app PDF viewer draws to
the browser's own canvas). Including it had no benefit and broke the macOS
universal build, which could not merge the module's processor-specific binary
across the Intel and Apple Silicon halves of the app; it also needlessly enlarged
the Linux and Windows builds. Excluding it fixes the macOS build and slims every
desktop package.

### 2026-06-22 - release: prepare home 1.1.0

Moved Qortium Home off the `-preview.N` versioning scheme to a plain `1.1.0`, matching how Qortium Core is versioned, and set the Android `versionCode` to 18 so this release can install over previous preview builds. This is the first stable-numbered release and gathers everything added since the last preview: a content-type-driven QDN viewer that opens Markdown, HTML, code, CSV, and JSON files in-app; an in-app document reader for PDF, EPUB, plain text, and comic archives (CBZ and CBR); a general ZIP/RAR archive browser and a Git repository browser that both present their contents as a collapsible file tree; node-aware QDN app actions with opt-in response headers; batch identity lookup for apps; and a managed I2P router with selectable IP/I2P transport modes, alongside assorted Core-handling, navigation, and QDN browsing improvements.

### 2026-06-22 - feat: browse GIT_REPOSITORY resources as a file tree

Git repository QDN resources now open as a browsable file tree, the same way the
new archive browser works. The repository's files are served directly by the node
(no extraction or decompression needed), so opening one is fast: the tree lists the
repo's structure, every folder is collapsed by default to keep large repos
manageable, and clicking a file previews it in place with the right viewer — a
README renders as formatted Markdown, source files get syntax highlighting, images
and PDFs display, and so on. If the repository declares an entry point (or has a
top-level README), it opens to that file first. Individual files can be downloaded,
and a zip/rar checked into the repo opens in the archive browser. This is a file
browser, not a git client — the node serves working-tree files only, with no
branches or history. All new labels are translated across every language.

### 2026-06-22 - feat: browse ZIP and RAR archives as a file tree

QDN resources that are ZIP or RAR archives now open as a browsable, collapsible
file tree instead of a plain download. Each file inside can be previewed in place —
images, audio, video, text, code, CSV, JSON, Markdown, HTML, and PDFs/EPUBs/comics
all render with the same viewers used elsewhere — and any entry can be downloaded on
its own. Archives nested inside archives open too (up to a sensible depth), and an
archive's decoder (shared with the comic reader) loads only when one is opened.
Comics (.cbz/.cbr) still open in the comic reader rather than the file browser.
All new labels are translated across every language.

### 2026-06-22 - feat: CBR comic archive support in the document viewer

The in-app comic reader now opens CBR comics (RAR archives) in addition to the
existing CBZ (ZIP) comics, using the same page view, navigation, and zoom. The
reader figures out the real archive type from the file's contents rather than its
name, so a comic that is mislabeled (a CBR named .cbz, or the reverse) still opens
correctly. The RAR decoder is loaded only the first time a RAR comic is opened, so
it adds nothing to normal startup. The format label now reads simply "Comic" for
both kinds, translated in every language.

### 2026-06-22 - feat: code/CSV/JSON viewers, magic-byte detection, and viewer fixes

Rounds out the content-type viewer with three more in-page views and some fixes.
Source code now displays with syntax highlighting (the highlighter loads only when
a code file is opened), CSV files render as a real table with sticky headers, and
JSON shows as a collapsible tree you can expand and collapse instead of a wall of
text. Detection also gained a last-resort step: a file published with no name and
no type information is now identified by its first few bytes, so a bare image or
PDF still previews instead of falling back to a download.

Fixes: the document-viewer "too large" message now shows the correct size limit
(it previously said 5 MB while the real limit is 100 MB), the "Open in Document
Viewer" button now works for documents regardless of how they were published, and
a few file types browsers can't actually display (TIFF, Matroska video) no longer
route to a viewer that would show nothing. All new labels are fully translated.

### 2026-06-22 - feat: content-type QDN viewer routing + in-app document reader

The QDN viewer now decides how to display a resource from what the file actually
is, not just from the service label the publisher chose. Previously an image
published as a "document", or a PDF filed under the wrong service, would show
nothing useful; now the viewer reads the file's type and renders it correctly.
Several services that used to show a blank preview (mail, playlists, stores, and
similar text-based data) now display their contents.

Two genuinely new in-page viewers are added. Markdown and HTML resources are
rendered for real — Markdown is formatted into a readable page, and both are shown
inside a tightly locked-down sandbox that cannot run scripts, so untrusted content
is safe to preview by construction. A new in-app document reader opens PDF, EPUB,
and CBZ (comic) files, and TXT, directly inside the app with page navigation, zoom,
and a table of contents, instead of forcing a download. Apps can also ask to open
the document reader through the QDN bridge. PDF, EPUB and comic support is loaded
only when a document is actually opened, so it adds nothing to normal startup. All
of the new wording is fully translated across every supported language.

### 2026-06-22 - feat: node-aware QDN actions + opt-in response headers for apps

Two improvements to the QDN app bridge. First, the list of available actions an app sees (SHOW_ACTIONS) now reflects the node it is connected to: on a public network node, actions that need a local, write-capable connection — publishing, group/name/payment/poll/list management, account rating, and minting — are no longer advertised, so an app that shows or hides controls based on this list won't offer buttons that can't work there (open-group chat sending stays available, since it works on public nodes). Second, node API requests made through the bridge can now opt in to receive the response status and headers alongside the body, so an app can read values such as the total-count header used for paging long lists.

### 2026-06-22 - feat: batch identity lookup for QDN apps (RESOLVE_IDENTITIES)

Added a new read-only bridge action, RESOLVE_IDENTITIES, that lets a QDN app resolve many accounts' display identities in one call: given a list of addresses it returns each address's registered name and avatar URL, instead of the app making several node requests per address. It works on desktop and Android, works on public nodes, reuses Home's existing name and avatar resolution, and de-duplicates addresses (capped per call). Apps that show lists of accounts — such as Qortium Trust — can replace their per-address name/avatar fetching and bespoke image handling with this single call.

### 2026-06-22 - fix: keep a QDN app tab bound to its launch account

Hardened the desktop QDN app views so a tab stays bound to the account it was opened under for its whole life. The bound account is now fixed when the view is created and is never changed by re-showing the tab or by account-state updates — only the lock/unlock state of that same account is still tracked. This guarantees that switching the selected account elsewhere in Home can't leak into an already-open app view: a Trust tab showing what *you* rated keeps showing the original account's view even after you switch accounts in another tab.

### 2026-06-22 - feat: tell the running Core apart from the installed one (and find it on macOS)

The Settings Core panel now distinguishes the Core that is actually running from the one Home has installed. When a Core that Home didn't install is the one running, Home shows the running Core's folder when it can locate it, lists the managed install as its own separate entry, and adds a note that a different Core is running — instead of mislabelling the managed install as if it were the running Core. On macOS, Home can now identify a running Core by inspecting the running process's open files, so it correctly recognises a Core it manages (which is what makes the Stop button and folder display behave correctly there) and can find the details it needs even for a Core started outside Home. New wording is translated across all supported languages.

### 2026-06-22 - fix: show a working Stop button for a running Core Home can't confirm it owns

Completed the previous change so it actually reaches the button. Home now shows an active Stop control for any running local Core — including one it didn't start, or one it can't confirm it owns (which happens on macOS, where Home can't inspect a running process the way it can on Linux). Previously such a Core showed no Stop button at all. Stopping it uses the Core's own stop command, and Home now falls back to reading the key it needs from the managed Core's own files when it can't read it from the running process, so the Stop button works on macOS for a Core that Home installed.

### 2026-06-22 - feat: smoother I2P + Core handling when the Core was started outside Home

Improved how Home deals with an I2P router and a Core it did not start itself. Home can now stop a local Core that was started outside Home — for example from a terminal — by using the Core's own stop command with the running node's key, instead of refusing and telling you to stop it by hand. If Home's managed I2P router is left running after Home is closed unexpectedly, Home now recognises it as its own on the next launch (by the record it keeps of the router it started) and lets you stop it from Settings, rather than treating it as someone else's router and leaving you stuck. And the I2P router status in Settings now refreshes on its own every few seconds and when you press the refresh button, so it no longer shows stale information — such as still showing a router as running for a while after it was stopped, which previously hid the "Enable I2P" option.

### 2026-06-21 - fix: rename a file so the app builds on macOS

Fixed a problem that stopped the app from building on macOS. Two source files had names that differed only in capitalization — a component "AccountAvatar" and its helper "accountAvatar". On Linux these are two separate files, so builds there worked, but macOS's filesystem treats names as case-insensitive, so the two collided during a Mac build and the build failed. Renamed the helper to "useAccountAvatar" (matching the function it provides) so the names no longer clash and Mac builds succeed again. No behaviour changes.

### 2026-06-21 - feat: make installing the I2P router more robust

Hardened how Home downloads and installs the managed I2P router. A failed download (a network blip or a server hiccup) is now retried a few times with a growing delay instead of giving up at once, while a file that fails its checksum is rejected immediately and never retried, since that points to a bad or tampered download rather than a temporary glitch. The download is written to a temporary file and only moved into place once it has been verified, so a half-finished or corrupt download can never be mistaken for a working router. After a successful update Home also clears out the previous router version it had downloaded, while always keeping the router's saved identity and network data so updating the program doesn't make it start over from scratch.

### 2026-06-21 - feat: don't run the managed I2P router when I2P is turned off

Made the managed I2P router respect the node's transport choice. When the local Core is set to "Direct only" (I2P turned off), Home no longer starts the router alongside Core — there's no point running a router the node won't use. And when you switch the node to "Direct only" yourself, Home shuts down the router it was running (an I2P router you run yourself is still left alone). I2P is treated as enabled whenever the node uses its normal default or any mode that includes I2P, so the router still comes up automatically in those cases.

### 2026-06-21 - feat: start/stop the managed I2P router with the local Core

Tied the managed I2P router's lifecycle to the Core that Home runs. When Home starts the local Core it now also brings up the installed I2P router first, so the router's bridge is ready as Core looks for it; this is best-effort and never delays or blocks Core from starting — if the router is slow or unavailable, Core simply starts on its direct connection as before and picks up I2P once it's ready. When Home stops the local Core, or when you quit Home, the router Home started is shut down cleanly so it isn't left running in the background holding the connection. If you run your own I2P router, Home continues to leave it untouched. Nothing happens here unless you've enabled the managed router from Settings.

### 2026-06-21 - feat: manage the I2P router from Settings → Connections

Wired the new managed I2P router into the Settings → Connections panel for a local Core that Home runs. The panel now shows whether an I2P router is running, and offers a one-click "Enable I2P" that downloads, installs, and starts the router for you (or "Stop I2P router" to turn it off). If you already run your own I2P router on the machine, Home detects it, shows "Already running on this machine", and leaves it alone instead of starting a second one. Until a router is available, the transport dropdown's I2P choices ("Direct + I2P fallback" and "I2P only") are greyed out with a short note to enable the router first, so you can't switch the node to a mode that wouldn't work yet. This only appears for the local Core that Home manages; on a custom or remote node — or on the phone app — the transport choices stay as before, since Home can't manage a router it doesn't run. The new wording is translated across all supported languages.

### 2026-06-21 - feat: scaffold the managed i2pd download/run manager (desktop)

Added the internal foundation for Home to manage an I2P router (i2pd) itself on the desktop, so the I2P fallback can work without the user installing anything by hand. This new piece can download a verified i2pd build for the current platform from Qortium's own i2pd build (checking it against a published checksum so a tampered or corrupted download is rejected), install it into Home's managed data area, write a safe configuration that only opens the local SAM bridge Core talks to (with the web console and proxies turned off), and start, supervise, and stop the router as a managed process. It also detects when an I2P router is already running on the machine — for example one a standalone operator installed themselves — and steps aside rather than starting a second, conflicting one. There is no visible change yet: this is the groundwork the upcoming Settings controls and the dropdown's "I2P available?" check will build on. It is desktop-only, since the phone app connects to a remote node and never runs a local router.

### 2026-06-21 - feat: auto-open the lone resource for identifier-less QDN links

Made Home open a QDN page directly when a link names only a service and a name (no identifier) and that combination turns out to have exactly one published resource. Previously such a link always showed a listing view, even when there was only a single thing to list. Now, after Home checks what exists under that service and name, a single match opens straight away, while zero or multiple matches still show the listing as before. This works the same whether the link comes from the address bar, a click inside Home, or a QDN app asking Home to open an address through its bridge. The address bar updates to show the full resolved link (including its identifier), and the unresolved step is not left in the back/forward history, so the Back button behaves naturally.

### 2026-06-21 - build: make macOS 11 dmg use Electron 38

Changed the remote macOS 11 legacy DMG build so it packages with Electron 38, the newest Electron line that still supports macOS Big Sur, instead of only renaming a normal Electron 39 universal build. The legacy target still sets the app minimum system version to `11.0.0`, but now it also scans the generated `.app` bundle's Mach-O load commands and fails the build if any bundled executable or framework still requires macOS 12 or newer. This prevents a `macos11-universal.dmg` release asset from being uploaded unless the actual app binaries are compatible with macOS 11.

### 2026-06-20 - feat: pick the IP/I2P transport mode from a Connections dropdown

Replaced the "Hide IP address" / "Show IP address" buttons in Settings → Connections with a single dropdown that lets you choose how the node connects: Direct + I2P fallback (the default, using direct IP with I2P as a backup), Direct only, or I2P only. The "Direct only" choice is new — it turns off the I2P fallback entirely so the node connects over direct IP, which the old buttons could not do. Choosing "I2P only" still shows the privacy warning that it hides your IP and needs a running I2P router, and "Direct only" now explains that it disables the fallback and won't reach I2P-only peers; switching back to the default needs no warning. A Save button appears only when you have picked a different mode, and applying it restarts Core to take effect, just as before. The control is still offered only on a local or custom node you control (not in public network mode), and the new wording is translated across all supported languages.

### 2026-06-20 - feat: live QDN address-bar autocomplete (services, names, identifiers)

Typing a QDN address now offers live suggestions for whichever part of the address you are on. After `qdn://` it lists the available QDN services; once a service is chosen it suggests registered names that have content there; after a name it suggests that resource's identifiers; and the `qdn://*/` wildcard form suggests matching registered names from across the network. Name and identifier suggestions are fetched from the connected Qortium node as you type — they update after a short pause, are briefly remembered to avoid repeat lookups, and quietly fall back to just the service list when no node is reachable, so they never get in the way of typing. Pressing Enter now goes to exactly what you typed whenever that is already a complete address, so a highlighted suggestion can no longer send you somewhere unexpected, and clicking into the address bar selects the whole address so you can type straight over it. The new suggestion labels are translated into every supported language.

### 2026-06-20 - fix: keep Android content clear of the status bar, cutout, and navigation bar

On newer Android phones (Android 15 and later), the app was drawing all the way to the screen edges, so the top bar slid under the status bar and camera cutout and the content ran beneath the on-screen navigation buttons. Phones on older Android were unaffected, which is why only some testers saw it. Qortium Home now detects the safe areas around the system bars and cutout and keeps its content clear of them, while still using the full screen with transparent system bars for the modern edge-to-edge look. This adds the `@capacitor-community/safe-area` plugin and adjusts the QDN explorer, the content viewer, the dashboard/settings pages, and dialogs so nothing is hidden behind the system bars. A stray "Qortium Home" title bar that briefly appeared at the very top has also been removed.

### 2026-06-20 - feat: browser-style keyboard navigation for tabs and address bar

Qortium Home now supports browser-style keyboard navigation. F6 (and Shift+F6 in reverse) moves focus between the tab strip, the address bar, and the page, and Alt+D jumps straight to the address bar. Within the tab strip, the Left/Right arrows and Home/End keys move between tabs, and a tab's close button shows on the active tab and appears on hover or focus for the others without shifting the layout. In the address bar's suggestion list, the Right arrow or Tab fills in the highlighted suggestion (leaving the cursor at the end) while Enter accepts it and navigates; clicking a suggestion now also returns the cursor to the end of the address bar.

### 2026-06-20 - feat: show the build commit on the latest GitHub Core release

The latest GitHub Core release shown on the Dashboard and in Settings now includes the build commit as a suffix (for example "v1.1.0-b886a78"), matching how the currently running Core version is already displayed. When the QDN release points at the same commit, it shows the same suffixed label so the two sources read consistently.

### 2026-06-20 - feat: save QDN downloads on Android to a chosen location

Downloading a QDN item on Android now lets you pick where to save it with the system "Save to…" file picker, just like the desktop, instead of only opening a temporary copy you couldn't find later. Multi-file resources (apps, websites, gif repos) are assembled into a .zip on your device and saved. While a download is being prepared the button shows a spinner, and once it has saved you get a button to open the file (on desktop this opens the file's folder instead). Separately, on small screens the Preview and Refresh buttons in the qdn:// browser are now icon-only so they take less space.

### 2026-06-20 - fix: download multi-file QDN resources as a client-side zip (desktop)

Downloading a multi-file QDN resource (an APP, WEBSITE, GIF_REPO, or other resource shown as a .zip) on the desktop now works — previously it failed with "save failed". These resources are stored on the node as many separate files with no single downloadable archive, so Home now reads the resource's file list, fetches each file, and assembles the .zip on your own device before saving it. A size/count guard avoids problems with unusually large resources. Single-file downloads are unchanged. The same fix for Android is a follow-up.

### 2026-06-20 - ux: reveal the saved file after a desktop QDN download

After you download a QDN item on the desktop, the Download button now turns into a folder icon — the same one used elsewhere to open the Core and Home install locations — that opens the saved file's location in your file manager. It stays that way until the tab is reloaded, so you can find the file right away and won't re-download it by accident; reload the tab if you do want to download it again. There is no extra button and no new wording. On Android the file still opens directly as before.

### 2026-06-20 - ux: add new dashboard pins at the end of the list

When you pin something to the dashboard, the new pin is now added at the end of the list (bottom of the grid) instead of jumping to the front. Existing pins keep their place, and re-pinning a page moves it to the end. When the pin grid is full, the oldest pin is dropped to make room for the new one.

### 2026-06-20 - feat: show the Core build commit in the version display

The Core version shown on the Dashboard and in Settings now includes the build commit as a suffix (for example "v1.1.0-b886a78" instead of just "v1.1.0"), so you can tell exactly which build of Core is running. The suffix is read from the running Core, so it appears while Core is running; a stopped-but-installed Core still shows the plain version.

### 2026-06-20 - perf: speed up CHAT memory-pow with 32-bit integer math

Made the on-device proof-of-work used for public-node chat sending dramatically faster — about 40 times — so finding a valid nonce now takes a few seconds instead of over two minutes. The memory-hard computation was rewritten to use 32-bit integer arithmetic over a reused buffer instead of big-number math. The result is bit-for-bit identical to what Qortium Core expects: it was checked against Core's own known-answer test values and confirmed to produce exactly the same output as the previous implementation across thousands of randomized inputs.

### 2026-06-20 - feat: send open-group chat on public network nodes

Home can now send chat messages to open groups while connected to a public network node, not just to a local Core or a trusted custom node. On a public node it builds the message, performs the required proof-of-work, and signs it entirely on your own device, then broadcasts only the finished, signed message — your private key never leaves your device or reaches the public node. Direct/private messages and closed or private groups remain available only on a local or trusted node, and Home clearly blocks them (with an explanatory message) when you are on a public node. Local and trusted-node behavior is unchanged. One caveat: the on-device proof-of-work currently takes a noticeable moment when sending on a public node, so a send takes a few seconds.

### 2026-06-20 - feat: add keyboard zoom and text-size shortcuts

Added keyboard shortcuts for zooming and for changing the app's text size. On desktop, holding Ctrl (Cmd on macOS) with the +, -, or 0 key now zooms the whole window in, out, or back to normal — no Shift required — and the same three actions are available from a new View menu (Zoom In / Zoom Out / Reset Zoom) with their shortcuts shown. Separately, adding Shift — Ctrl/Cmd+Shift with +, -, or 0 — steps the Settings "Text size" preset up, down, or back to the default; this one also works on Android with a hardware keyboard. The Display settings now show the matching shortcut next to "Text size" on desktop (⌘⇧ on macOS, Ctrl+Shift elsewhere, and nothing on Android where there is no keyboard). The macOS window Zoom menu item is unchanged on Mac but is no longer shown on Windows/Linux, where it did nothing.

### 2026-06-20 - feat: show accepted transports as a Connections line in the Core tile

Surfaced the node's accepted transports on the dashboard as a single "Connections" line in the Core tile, reading "IP, I2P" (or just "IP", or just "I2P") to match the node's current configuration. This keeps the dashboard uncluttered — no separate card — while still showing at a glance whether the I2P fallback is in the mix, with the full status and the privacy controls living in the Settings Connections section. It reuses the same status read as the settings panel. This completes the first phase of Home's I2P support — detecting and showing the transport state and letting you change it on a node you control. Automatically installing and running an I2P router from Home remains the next phase.

### 2026-06-20 - feat: add the "Hide IP address" (I2P only) privacy control

Added a privacy control to the Settings Connections panel that routes the node's traffic only over I2P, hiding its IP address. Turning it on shows a short warning first — it needs a running I2P router, can be slower or less reliable for reaching public peers, and restarts Core to take effect — and then asks for confirmation. Once on, the panel shows that the IP is hidden and offers a one-click "Show IP address" to return to the normal direct + I2P-fallback mode. The control changes Core's transport list through the node settings API and is only offered for a local or custom node you control (not public network mode). The wording is translated across all supported languages.

### 2026-06-20 - feat: add a Connections panel showing I2P transport status

Added a new "Connections" section to Settings that surfaces the node's I2P state, the first user-facing piece of Home's managed-I2P support. It reads the node's open endpoints (no API key, so it works on desktop and Android and on any node you can reach) and shows whether the I2P fallback is Active (a peer is actually connected over I2P), Enabled but idle, or Disabled; the current transport mode (Direct + I2P fallback, I2P preferred, I2P only, or Direct only); and how many network and QDN peers are connected, including how many of them over I2P. The panel refreshes on demand and reflects the live transport list Core advertises. This is the status/detection foundation; the controls to turn the privacy ("hide IP") mode on and off come next.

### 2026-06-20 - feat: add pure I2P transport read/derive layer

Added the internal foundation for Home's I2P features: a small, self-contained module that works out the node's I2P state purely from two pieces of public node information, with no network calls of its own. It determines whether I2P is enabled, preferred, or the only transport (matching how Core decides), builds the transport list for each mode the UI offers (normal, prefer I2P, I2P only, IP only), and reads the connected-peer lists to tell whether I2P is disabled, enabled-but-idle, or actively carrying a connection. Groundwork with no visible change yet — the Settings panel and live data wiring build on it.

### 2026-06-20 - fix: preserve Core's i2p key directory across runtime migration

Fixed a problem where updating the managed Core could discard the node's stable I2P identity. Core keeps its long-lived I2P destination keys in its runtime i2p folder so the node's .b32.i2p address stays the same across restarts, but Home's runtime migration only copied a fixed allowlist that left this folder out — so a migration would make Core generate a brand-new I2P address. Home now carries the i2p key directory over with the rest of the runtime data. Groundwork for managed I2P support.

### 2026-06-20 - ux: auto-collapse the QDN viewer status bar when ready

The resource viewer shows a status bar across the top that reports loading progress (Published, Building, Ready) along with the resource address and its actions. It already had a manual collapse control, but it stayed open after a resource finished loading, taking space away from the content. The status bar now collapses on its own the moment a resource reaches the Ready state, leaving the small handle to reopen it when the status actions are needed. It still reappears automatically while a new resource is loading, so progress is always visible when it matters.

### 2026-06-20 - fix: scroll long QDN explorer lists and pin the column header

Fixed a longstanding bug where the `qdn://` explorer could not scroll: when a service or name listing had more items than fit on screen, the extra rows were cut off at the bottom of the window with no scroll bar, so the rest of the list was unreachable. The explorer now scrolls the same way the settings and dashboard pages do (the page area itself owns the scrollbar), which reliably reveals the whole list. While doing this, the column header row (Name / Count / Updated, with its sort controls) is now pinned to the top so it stays visible and usable as you scroll through a long list, on every explorer page. An earlier attempt to fix the scrolling by having the panel claim its own height did not work in the packaged app; this replaces it with the proven page-level scrolling approach.

### 2026-06-20 - qdn: recognize private resources with a clear unsupported message

Made Home explain itself when it meets one of Core v1.1.0's new private (end-to-end encrypted) QDN resources. These use service names ending in `_PRIVATE`, and opening one requires a decryption key Home does not handle yet, so Home does not browse them. Previously a private address fell through the same gate as a typo and produced the generic "only public QDN services can be browsed" error. Home now spots the `_PRIVATE` suffix at every entry point — the address bar, the renderer's QDN bridge, and the desktop bridge's load/browse checks — and shows a specific message: that private, encrypted resources cannot be opened in Home yet. The message is translated across all supported languages. This is a labeling stopgap only: it adds no decryption and does not expose any private content; full support for opening private resources remains future work.

### 2026-06-20 - test: guard QDN service whitelists against Core drift

Added a lightweight smoke check (`npm run smoke:qdn-services`) that keeps Home's list of browsable QDN services honest against the node. Home deliberately curates a subset of Core's services in two places — the renderer and the desktop bridge — and those copies can quietly fall out of step with each other or with Core as services are added, renamed, or made private. The new check reads both lists from source, confirms they are identical, and compares them to Core v1.1.0's `/arbitrary/services` catalogue: it fails if Home lists a service Core no longer reports or one Core marks as private, and it simply notes the public services Home chooses not to surface (the system and chat-internal ones). It only needs a reachable node and is documented in the README alongside the other smoke tests. Verified passing against a live Previewnet node.

### 2026-06-20 - qdn: support image galleries and custom entry-point apps

Added support for two pieces of the Qortium Core v1.1.0 QDN overhaul. First, the new `IMAGE_GALLERY` service: a multi-file image collection (PNG, JPG, GIF, WEBP, BMP, AVIF, TIFF) that Home now browses with the same gallery grid it already used for GIF repositories — thumbnails open to a single image, the whole gallery downloads as one zip, and a gallery that points at a single image opens that image directly. Both the renderer and the desktop bridge learned the new service name so it is no longer rejected as "not a public service." Second, custom entry-point apps: Core v1.1.0 lets a website or app declare an entry file other than `index.html` and falls back to it for unknown in-app routes (so single-page apps work). On Android this already worked because pages render through Core directly, but the desktop build extracts the site and serves it locally, where it previously assumed a top-level `index.html` and broke deep links or refused to load. Home now reads the declared entry point, serves it (falling back through the usual `index.html`/`default.html`/`home.html` conventions), and routes unknown paths to it — matching Core's behavior so the same content renders identically on desktop and Android.

### 2026-06-20 - fix: exclude featureTriggers from chain-config compatibility hash

Brought Home's Core chain-compatibility check in line with Qortium Core v1.1.0. Core now treats the `featureTriggers` container as "hash-neutral" — it leaves that field out of the chain-config fingerprint it advertises during peer handshakes, so a coordinated release can add or adjust feature-trigger activation heights without otherwise-compatible nodes rejecting each other. Home computes the same kind of fingerprint to decide whether an existing Core database can be reused after a Core update, but it was still missing `featureTriggers` from the fields it ignores. That gap is harmless today because no chain config ships a `featureTriggers` block yet, but the moment a future coordinated activation populates one, Home would wrongly flag the runtime as belonging to a different chain and refuse to reuse the database, forcing an unnecessary reset. Home now ignores the same four fields as Core (`checkpoints`, `featureTriggers`, `onlineAccountsSignatureV2Height`, `assetOrderBoundsHeight`) in both the Core manager and its runtime smoke test, so the upgrade path stays smooth when that activation lands.

### 2026-06-18 - copy: refer to local wallets as labels

Changed the account setup and wallet-loading copy to say "wallet label" so the local wallet label is clearly separate from an on-chain registered name. The updated wording is applied to Home's account dialogs, validation messages, platform fallback errors, and all supported language catalogs.

### 2026-06-18 - style: update app icons to thick-line home mark

Updated the shared Qortium Home icon source to the newer thick-line home mark, regenerated the Android launcher icons with the existing padded safe-zone sizing so circular launcher masks do not cut into the artwork, and refreshed the Linux, macOS, and Windows desktop icon assets from the same source.

### 2026-06-18 - release: prepare home preview 16

Updated Qortium Home's package and Android version metadata to `1.0.1-preview.16` with Android `versionCode` 17 so the Core runtime compatibility fix and the new QDN list-management bridge actions can be published as the next QortiumDev prerelease target. This preview lets Home accept compatible Core updates whose Previewnet configuration only changed rollout-safe fields, and gives QDN apps mediated access to local Core list discovery and updates without exposing the node API key directly.

### 2026-06-18 - qdn: add list management bridge actions

QDN apps can now inspect and update local Core lists through Home using `GET_ALL_LISTS`, `GET_LIST`, `ADD_TO_LIST`, and `REMOVE_FROM_LIST`. Apps can ask for the available list names, read a single list's contents, and add or remove items without exposing the node API key directly to the app. Home only allows these actions through a local Core or trusted custom node so public Previewnet nodes are not used for private or write-style list changes, and the bridge exposes the same actions on desktop and Android.

### 2026-06-18 - app: accept compatible Core chain updates

Qortium Home now records the same effective Previewnet chain identity that Qortium Core uses when deciding whether nodes are compatible. Existing runtime metadata that stored the older raw `previewchain.json` hash is upgraded in place when it matches the currently installed Core, stale blocked-runtime markers are cleared after the compatibility check passes, and updates that only change rollout-safe fields such as checkpoints or unpinned feature-trigger heights can continue using the existing Core database instead of forcing the user to reset runtime data.

### 2026-06-15 - release: prepare home preview 15

Updated Qortium Home's package and Android version metadata to `1.0.1-preview.15` with Android `versionCode` 16 so the consolidated Core/Home information views, the redesigned draggable pinned tiles with QDN app icons on pins and tabs, the Linux AppImage Home-folder fix, and the standardized QDN resource viewer (shared copy and download actions in the status bar, context-sensitive GIF repository actions, APP/WEBSITE and whole-repository downloads saved as zip archives, image copying, and the fit-to-space video player) can be published as the next QortiumDev prerelease target.

### 2026-06-15 - fix: rename app-icon helper module to avoid a case-insensitive build clash

The app-icon helper module (`appIcon.ts`) and the app-icon component (`AppIcon.tsx`) differed only by capitalization. That built fine on Linux, whose filesystem is case-sensitive, but collided on the case-insensitive filesystems used by macOS and Windows, which broke the macOS packaging build. The helper module was renamed to `appIconUtils.ts` so Qortium Home builds correctly on every platform.

### 2026-06-15 - qdn: scale video to fill viewer space; label zip downloads

Videos in the QDN viewer now scale to fill the available space above the resource details instead of staying at their original (often small) size. Downloads that save a whole multi-file resource as a single archive — APP and WEBSITE apps and an entire GIF repository — now show "(zip)" on the download button so it is clear a zip file will be saved.

### 2026-06-15 - qdn: context-sensitive viewer actions, video fill, copy image

The QDN viewer's top-bar actions now follow what is on screen. Copying text from JSON and other text resources moved into the top bar alongside the link and download actions; image resources gained a "Copy image" action that places the picture on the clipboard; and a GIF repository copies or downloads the whole collection while browsing the gallery but switches to the individual image once one is opened. APP and WEBSITE resources can now be downloaded (saved as a zip), the video player gained a button to expand it to the full content area and back, and the redundant "Open in new tab" action was removed since a tab can already be duplicated.

### 2026-06-15 - qdn: standardize resource viewer actions in status bar

The copy-link and download actions are now shown consistently in the QDN viewer's top status bar for every kind of resource — images, audio, video, text, files, GIF repositories, and apps — rather than appearing in different places for different types. Images gained the copy and download actions they previously lacked, the status bar can be collapsed to a slim handle to reclaim screen space, and the video player was adjusted to fit within the page.

### 2026-06-15 - style: larger pin icons on smaller tiles

Pinned link icons now render larger on the smaller dashboard tiles, keeping them legible after the tiles were made more compact.

### 2026-06-15 - fix: robust pin drag, compact tiles, larger tab icons

Dragging pinned tiles to reorder them is now more reliable, the dashboard tiles are more compact so more fit on screen, and tab icons are larger and easier to recognise.

### 2026-06-15 - fix: resolve real AppImage install location for Home folder/reveal

On Linux, opening or revealing the Home data folder from a packaged AppImage now resolves the real install location instead of a temporary mount path, so the action points at the correct folder.

### 2026-06-15 - feat: smooth pin drag-reorder and QDN app icons on pins + tabs

Pinned dashboard links can now be reordered by dragging them with a smooth animation, and pinned links and open tabs now display the QDN app's own icon where available, making them easier to tell apart at a glance.

### 2026-06-15 - feat: consolidate Core/Home info across popup, dashboard, settings

Information about the local Qortium Core and the Home app — version, status, and related details — used to be shown inconsistently in different places. It is now presented consistently across the node popup, the dashboard, and the settings screens, so the same facts read the same way wherever you look.

### 2026-06-15 - qdn: add OPEN_CURRENT_TAB bridge action

QDN apps can now navigate the tab they are running in to a different Qortium address through a new `OPEN_CURRENT_TAB` bridge action, instead of always opening a new tab. The destination is pushed onto the tab's history so the user can hit Back to return to the originating app, and asking to navigate to the address that is already showing leaves the history unchanged.

It accepts the same `qdn://`, `home://`, and `core://` address formats (and the same length limit) as `OPEN_NEW_TAB`, and works the same way on both the desktop and Android apps.

### 2026-06-15 - qdn: add group kick and ban read bridge actions

QDN apps can now query group kick and ban history through four new named bridge actions: `GET_GROUP_KICKS`, `GET_GROUP_BANS`, `GET_MEMBER_KICKS`, and `GET_MEMBER_BANS`.

`GET_GROUP_KICKS` returns all confirmed kicks that have occurred in a given group, with optional filters for kicked member address, timestamp range, pagination, and sort order. `GET_GROUP_BANS` returns all current bans in a given group. `GET_MEMBER_KICKS` returns all kicks for a given address across all groups (defaulting to the selected account). `GET_MEMBER_BANS` returns all current bans for a given address across all groups (defaulting to the selected account).

All four are read-only actions and pass through the node API without requiring account access or approval prompts. They complete the symmetric read surface for kicks and bans, matching the pattern used by the other group read actions.

### 2026-06-15 - qdn: add RATE_ACCOUNT bridge action for trust apps

QDN apps such as trust apps can now ask Home to submit an account rating through the bridge using a new `RATE_ACCOUNT` action. As with other signing actions, the user approves each request and the rating is signed inside Home through the feeless proof-of-work path, so the account's private key never leaves Home. It works the same way on desktop and Android, with translated approval labels.

### 2026-06-14 - release: prepare home preview 14

Updated Qortium Home's package and Android version metadata to `1.0.1-preview.14` with Android `versionCode` 15 so the persistent Q-App storage fix, the expanded QDN bridge actions (group management, payments, polls, and group approval voting), the shared desktop/Android bridge action lists, and GIF repository image viewing can be published as the next QortiumDev prerelease target.

### 2026-06-14 - fix: persist Q-App localStorage across Qortium Home restarts

Settings and other data that QDN apps saved in the browser's local storage were lost every time Qortium Home was closed and reopened, because each app's storage area was kept only in memory and under a name that changed on every launch. Each app now gets a stable, disk-backed storage area derived from its QDN address, so the same app always reuses the same storage no matter which tab or window opened it, and its saved preferences now survive restarts.

### 2026-06-14 - qdn: add group, payment, and poll transaction actions to the bridge

QDN apps can now ask Home to carry out a wider set of on-chain actions through the same mediated bridge used for other signed actions: creating and administering groups (adding and removing admins, banning and unbanning, kicking, cancelling invites, and updating group settings), sending payments and transferring assets, and creating, voting on, and updating polls. Each action still requires the user's per-request approval and is signed inside Home through the feeless proof-of-work path, so the account's private key never leaves Home and the fee defaults to zero. The new actions behave the same on desktop and Android, and their approval labels are translated in every language.

### 2026-06-14 - qdn: share QDN app-bridge action lists across desktop and Android

The list of bridge actions a QDN app may request used to be written out twice — once for the desktop bridge and once for the Android/renderer bridge — which made the two easy to drift apart. Both now read from a single shared list, so the set of available actions stays identical across desktop and Android. This is an internal tidy-up only; the actions an app can request are unchanged.

### 2026-06-14 - Support GIF repository image viewing

Home can now browse and display images published to the QDN GIF repository service. These resources are recognised in the QDN explorer and open in the viewer with animated GIFs playing as expected, so GIF collections shared on QDN can be viewed directly inside Home.

### 2026-06-14 - Add group approval QDN bridge support

QDN apps can now ask Home to cast a group-transaction approval vote through the bridge, used to approve or oppose group-administered actions that require member approval. As with every signing action, the user is asked to approve each request and can see which account and group are involved; Home casts the vote and the account's private key stays inside Home. The action works on desktop and Android with translated approval labels.

### 2026-06-14 - ui: scroll qdn browser pages when content overflows

Browsing a QDN address such as qdn://APP shows a list of resources, but when that list was longer than the window it was cut off at the bottom with no scrollbar, leaving the rest unreachable. The browsing area now bounds those pages to the window's height, so any page whose content overflows — the QDN service and resource listings, and the node API and API-docs pages that share the same area — scrolls within the window as expected. The full-screen content viewers (rendered QDN apps and media) are unaffected.

### 2026-06-14 - qdn: let apps request and resolve private group chat keys

Members of a private group can end up missing the encryption key for some messages, which the node reports as a "missing key" status. Recovering it means publishing on-chain requests signed by the account, which a QDN app cannot do on its own because it never has access to private keys.

Home now offers two new bridge actions for apps such as the chat app: one to ask the network for a missing private group chat key (optionally a specific past key), and one for a member to fulfil other members' outstanding key requests. As with every action that signs something, the wallet asks for the user's approval each time and shows which account and group are involved; the account's private key stays inside Home and is never given to the app, and no raw group keys are ever returned to it. The chat app can use these to recover missing keys and then refresh the conversation. The work is mirrored across the desktop and mobile builds, and the approval labels are translated in every language.

### 2026-06-14 - dashboard: redesign pinned links as draggable icon tiles

Pinned links on the dashboard used to be wide rows that spelled out the full address. They are now compact square tiles. Each tile shows an icon for the kind of thing it points to — a video, audio, image, or document icon for QDN content, a house for home pages, and a server for core node pages — together with a short label (the content's identifier, or the page title) instead of the raw address.

The always-visible remove button is gone: right-click a tile, or press and hold on a touch screen, to open a small menu with Rename and Remove. Rename lets you give a pin your own label, and clearing the label restores the automatic one. Tiles can also be dragged to rearrange them, and the new order is remembered. Existing pins keep working and pick up the new look automatically.

### 2026-06-14 - ui: show the selected account avatar on each tab

Each browser tab can act as a different account, but there was no way to tell which account a tab was using without opening it. Every tab now shows a small avatar for its selected account, next to the tab title. If the account has a registered name with an avatar that image is shown; otherwise a coloured circle with the account's initial is used, matching the account button in the top bar. Hovering the avatar shows the account name, and a subtle ring marks when that account is unlocked. Tabs with no account selected show no avatar.

### 2026-06-14 - ui: enlarge the node status icon in the address bar

The small hexagon that shows the node's sync status in the address bar was sitting inside a much larger button, leaving a lot of empty space around it. The icon is now drawn larger so it fills that button more fully and is easier to read at a glance. Only the icon changed size; the button itself, the status colours, and the small corner indicators (the sync dot and the network badge) are unchanged.

### 2026-06-14 - qdn: allow desktop QDN apps to reach the public Qortal node

On desktop, QDN apps run under a content-security-policy supplied by the node that only lets the app connect back to its own origin. That blocked the new cross-chain reads at the app level: an app such as the emulator could ask Home's bridge for Qortal data, but anything the app loads directly — for example an emulator streaming a game file straight from the Qortal node — was refused by the browser.

The desktop app view now narrowly relaxes that policy: it adds the configured public Qortal node origin(s) to the connect, image, and media directives so the app can read from them, while leaving the rest of the policy intact. This mirrors what the Android app already does (Android removes the policy entirely), but is deliberately limited to just the Qortal node origins. Responses coming from the Qortal node itself carry no policy and are left unchanged. With this, the cross-chain read bridge works on desktop as well as Android.

### 2026-06-13 - qdn: let apps read Qortal QDN data from a public Qortal node

QDN apps running in Qortium Home can now read public QDN data from the Qortal network, not only from the configured Qortium node. Five new read-only app actions are available: search Qortal resources, check a resource's build status, read its metadata, fetch a resource's bytes, and get a resource's direct URL. These are served from a public, read-only Qortal node (defaulting to ext-node.qortal.link, with the first reachable node cached for a few minutes).

The direct-URL action is what lets an in-app player such as an emulator stream a file (for example a game ROM) straight from the Qortal node — which serves these with cross-origin and ranged requests — so it works for any size, including large CD-based games, without routing the whole file through Home. The byte-fetch action returns base64-encoded content with its type and size for smaller resources and metadata (up to 64 MB). Everything here is strictly read-only and narrow: well-formed public resource lookups, GET requests, size-limited, with no Qortal account, API key, signing, writes, or private data involved. This is the platform groundwork for cross-chain apps such as a Qortium Emulator.

### 2026-06-13 - qdn: support local content preview on android

Local content preview now works in the Android app, not just on desktop. Because the node may run on a different device from the app, the content can't be handed to the node as a local file path the way the desktop does. Instead the app lets the user choose a file, uploads it to the node's preview endpoint, and shows the same temporary render the desktop preview produces. Images, video, audio, and HTML files are supported, and a website can be previewed by choosing a .zip of its folder — folder selection itself isn't available on mobile, so the desktop-only "Choose Folder" option is hidden there and the Preview button now appears on Android. This relies on the matching Qortium Core release that accepts uploaded preview content.

### 2026-06-13 - qdn: show the minting key in the removal approval

When a QDN app asks to remove a minting key, the approval prompt now shows the public key that would be removed, so the user can confirm exactly which minting key is affected before approving. Previously the prompt named the action but not the specific key — which matters here because the app chooses the key, unlike Start Minting which always acts on the user's selected account. The key flows through the same approval request used by every write action, so it is shown the same way on desktop and Android.

### 2026-06-13 - qdn: let apps request minting key removal

QDN apps can now call `REMOVE_MINTING_ACCOUNT` to ask Home to remove a minting key from the connected Core node, identifying the key by its public key. Home checks the key's basic shape, requires the user to approve each request, and then sends the removal to the node using the node's own API key — the app never sees the key material or the node credentials. The node confirms the removal, and Home reports a clear error if no matching key was present. The action is advertised through `SHOW_ACTIONS` on desktop and Android and uses the same single-request approval flow as Start Minting.

### 2026-06-12 - release: prepare home preview 13

Updated Qortium Home's package and Android version metadata to `1.0.1-preview.13` with Android `versionCode` 14 so the QDN local preview workflow, account refresh fixes, app unlock request support, and dashboard tab pins can be published as the next QortiumDev prerelease target.

### 2026-06-12 - ui: pin tabs to the dashboard

Tabs can now be pinned to the dashboard from the tab right-click menu. Saved pins appear above the dashboard's QDN, Core API, and Settings buttons, persist across restarts, open through Home's normal address routing, and can be removed directly from the dashboard.

### 2026-06-12 - qdn: let apps request selected account unlock

QDN apps can now call `UNLOCK_SELECTED_ACCOUNT` when the selected account is locked. Home handles the password prompt itself, unlocks the wallet through the same account flow used by the dashboard and top bar, updates the selected account state, and returns the refreshed account details to the app without exposing the password or private key. The action is advertised through `SHOW_ACTIONS` on desktop and Android, with smoke checks updated to cover the new bridge capability.

### 2026-06-12 - accounts: refresh names and avatars when the node connects

When Home started while the Core node was stopped, account names, avatars, and the on-chain Core update status loaded as empty and stayed empty after the node came online, because that data was only fetched once at startup and the empty answers were kept. Home now tracks when the configured node becomes reachable — both immediately after starting Core from within Home and through the regular node status checks that also notice externally started or recovering nodes — and refreshes the account name and avatar shown on the dashboard and in the top bar, plus the dashboard's Core update status, as soon as the connection is back.

### 2026-06-12 - qdn: preview local content from the explorer

The QDN explorer pages now have a Preview button that shows how local content will look and behave in Home before it is published. It accepts a website folder or zip containing an index.html file, a standalone HTML file, or an image, video, or audio file, and opens the result in the matching Home viewer — websites render in the isolated app view and media plays in the same player used for published QDN content. The preview is generated by the local Core node without signing or broadcasting anything, so no registered name is needed, and a Refresh button regenerates the preview after local edits. This needs a Qortium Core release that includes the name-free preview endpoint; older nodes show a clear message asking for a Core update.

### 2026-06-12 - release: prepare home preview 12

Updated Qortium Home's package and Android version metadata to `1.0.1-preview.12` with Android `versionCode` 13 so the wallet import, multi-address derivation, QDN tab/media bridge, explorer sorting, and navigation polish can be published as the next QortiumDev prerelease target.

### 2026-06-12 - accounts: import wallets from a private key

A new Import button on the dashboard lets users add an account from a base58 private key. Home shows the derived address before saving, protects the key with a password in a wallet file it can load like any other, and marks these wallets as single-address since extra addresses cannot be derived from a private key.

### 2026-06-12 - accounts: support multiple derived addresses per wallet

Wallets can now hold more than one address. The dashboard shows the selected wallet's addresses in a dropdown with a + button that derives the next address, and each address acts as its own account with its own name, avatar, and signing key. Unlocking a wallet unlocks all of its addresses.

### 2026-06-12 - ui: open settings in a new tab from the node menu

Opening Settings from the node status menu next to the address bar now opens a new tab instead of replacing the page in the current tab.

### 2026-06-12 - ui: add sortable columns to the QDN explorer

The QDN explorer now shows how many resources each service or name has and when each was last updated, in every browsing view. Lists start sorted by most recently updated, and column headers can be clicked to sort by name, count, size, or status.

### 2026-06-12 - qdn: let OPEN_NEW_TAB open home and core addresses

The OPEN_NEW_TAB bridge action now also accepts home:// and core:// addresses, so QDN apps can link to Home pages and node API views. Addresses go through Home's normal address parsing, so unsupported paths are still blocked.

### 2026-06-12 - ui: show name and avatar for the selected wallet

The dashboard now shows the selected wallet's registered name and avatar alongside its address, and the account button next to the address bar now loads avatars from the correct QDN location.

### 2026-06-12 - qdn: add OPEN_QDN_MEDIA_PLAYER bridge action

QDN apps can now ask Home to play QDN audio and video in Home's own media player, which opens over the app while it stays loaded. Only AUDIO, VOICE, PODCAST, and VIDEO resources are allowed in the player.

### 2026-06-11 - qdn: notify apps when the selected account unlocks

QDN apps are now notified when the selected account is unlocked or locked, so apps like Chat refresh their account state immediately instead of needing a reload.

### 2026-06-11 - qdn: add OPEN_NEW_TAB bridge action

QDN apps can now ask Home to open a QDN address in a new tab through the qdnRequest bridge. Home validates the address, only allows QDN content, and opens the tab with the same selected account as the requesting app.

### 2026-06-11 - ui: keep QDN pages visible under menus and prompts

Opening the account menu, the node status menu, or a permission prompt no longer blanks out QDN pages: the page now stays visible as a seamless frozen preview until the menu or prompt is closed. As part of the same work, QDN apps no longer reload their state or reset their navigation when their page returns to view after closing a menu or switching to another tab and back.

### 2026-06-11 - ui: support mouse back and forward buttons

The extra back/forward buttons found on many mice now move through tab history in Qortium Home, matching how web browsers behave, including while a QDN app has focus.

### 2026-06-11 - build: fix remote mac target execution

Fixed the remote Mac build helper so standard macOS targets run the requested npm script directly instead of depending on an unexported shell variable inside the remote build shell.

### 2026-06-11 - build: align release artifact matrix

Updated the Home release helpers to match the current preview asset set: Linux x64 and arm64 AppImages, Windows x64 portable builds, normal macOS universal and macOS 11 legacy universal DMGs, and the signed Android APK. The default Android release build and collector now skip the AAB unless it is requested explicitly.

### 2026-06-11 - release: prepare home preview 11

Updated Qortium Home's package and Android version metadata to `1.0.1-preview.11` with Android `versionCode` 12 so the accent display setting, Core API documentation enable hardening, and Linux desktop metadata fix can be published as the next QortiumDev prerelease target.

### 2026-06-10 - chore: add package metadata for Linux desktop builds

Added package author metadata and a Linux desktop name mapping so electron-builder can associate packaged Qortium Home windows with the generated desktop entry.

### 2026-06-10 - node: harden API documentation enable flow

Hardened the fallback Core API documentation enable path so protected node requests re-read the latest node settings between the settings update and restart request, report rejected API keys clearly, and keep the restart timeout note aligned with the newer Core restart handoff behavior.

### 2026-06-10 - app: add accent display setting

Added a persistent display accent setting with localized accent labels and propagated the selected accent into Home-managed QDN renders so embedded apps can stay visually aligned with the user's Home display preferences.

### 2026-06-10 - release: prepare home preview 10

Updated Qortium Home's package and Android version metadata to `1.0.1-preview.10` with Android `versionCode` 11 so the latest Core API documentation workflow, synced node status refinements, and `CLAUDE.md` ignore hygiene can be published as the next QortiumDev prerelease target.

### 2026-06-10 - qdn: authorize and register minting keys for QDN apps

Joining a minting group through a QDN app now includes the account's minting key authorization in the join itself, so the on-chain minting permission Core grants on minting-group joins actually happens for joins made from Home. Two new bridge actions let apps work with minting: a read-only minting status check reports whether the selected account has its minting authorization on chain, whether its minting key is loaded on the connected node, and whether that node is currently able to mint; and a Start Minting action (with its own approval prompt, translated in all twenty languages) derives the account's minting key and hands it to the local node so the node can mint for that account. Accounts that joined a minting group before joins carried minting keys are covered too: when no on-chain authorization exists yet, Start Minting submits the free self-share authorization transaction instead and reports it as pending, so the key can be added once it confirms — the same flow also lets existing minters re-add their key on a fresh or additional node. The minting key is only ever exchanged between Home and the local node — QDN apps never see it. On the public read-only Previewnet connection, the status check reports only the on-chain part, and Start Minting is unavailable like all other protected workflows.

### 2026-06-10 - app: refine loading, empty, and status details

Replaced plain "Loading…" text with shimmering placeholder shapes while wallets and QDN listings load, so the app shows where content will appear instead of a bare message; screen readers still hear the loading text. The empty Accounts card now shows a soft green wallet icon above its explanation. Numbers in detail rows and progress messages use evenly spaced digits so values no longer shift as they update. The node status dot gains a faint glow in its status color, an unlocked wallet shows a soft green ring around the account button, and the Dashboard gets a barely-visible green ambient glow behind its header for atmosphere. The loading shimmer is disabled for people who prefer reduced motion.

### 2026-06-10 - app: polish scrollbars, dialogs, and tabs

Replaced the operating system's chunky scrollbars with slim rounded ones that stay subtle until hovered, in both themes. Dialog overlays now blur the page behind them with a lighter tint instead of a heavy dark layer, and dialogs cast a deeper shadow so they clearly float above the page. Browser tabs were restyled: inactive tabs sit quietly without borders until hovered, while the active tab stands out with a soft top highlight and shadow. Selected choices in settings controls and address suggestions now use a soft green tint that matches the app's accent instead of a generic gray.

### 2026-06-10 - app: add motion and depth to the interface

Gave the interface its first layer of visual depth and motion. Buttons, inputs, tabs, menu items, and other interactive controls now ease between states over about 170 milliseconds instead of snapping, buttons lift slightly on hover and settle when pressed, and menus, dropdowns, and dialogs ease in when they open. Primary action buttons now use a subtle green gradient with a soft glow and a highlighted top edge so the main choice on each screen stands out. Cards cast soft shadows, the toolbar separates from the page with a gentle shadow, focused inputs show a green glow ring, and the dark theme's background layers were re-spaced so panels, menus, and controls sit at visibly different depths instead of blending into one flat surface. All motion is disabled for people who prefer reduced motion.

### 2026-06-09 - app: follow the system language and translate window menus

Made the language setting default to the device's system language. A new System choice at the top of the language dropdown is now the default for fresh installs: Home detects the operating system's preferred language, matches it against the twenty supported languages (including regional handling so Traditional Chinese regions get Traditional Chinese), and falls back to English when there is no match. Picking a specific language still works exactly as before, and choosing System returns to automatic detection, which also follows live system language changes while the app is open. The desktop window menus (File, Edit, View, and Window, including items like Undo, Copy, Paste, and Toggle Full Screen) now translate too: the app sends the translated menu labels to the desktop shell whenever the language changes, and the menus rebuild immediately.

### 2026-06-09 - app: translate the home ui and add rtl support

Made the language choice apply to Qortium Home's own interface. Every label, button, dialog, tooltip, status, and error message the app writes itself now comes from a translation catalog of about 365 entries, with matching translations for all twenty offered languages; strings were reworded where needed so sentences translate cleanly, and repeated wording (such as Cancel, Save, Unlock, and status words) now shares a single entry everywhere it appears. Arabic and Hebrew render right-to-left: the layout mirrors, directional arrows and chevrons flip, and device notch spacing stays on the correct physical side. The explanatory note under the language selector was removed. Messages that arrive from the node or operating system at runtime still appear in their original language, and the selected language continues to be passed to QDN apps as before. If a translation entry is ever missing, the English text is shown instead.

### 2026-06-09 - app: offer all core and hub languages in a dropdown

Expanded the Display Settings language choice from English-only to the twenty languages currently supported across Qortium Core and Qortal Hub, shown by their native names (such as Deutsch, 日本語, and Русский) with separate Simplified and Traditional Chinese options and no flag icons. The language picker is now a dropdown instead of a row of buttons, sharing the same control style as the wallet selector. The chosen language is saved, applied to the page's language attribute, and passed to QDN apps that support it; Qortium Home's own interface remains English for now, and a note under the dropdown says so.

### 2026-06-09 - app: add tv-friendly text sizes that reflow the layout

Extended the Display Settings text sizes for people reading Home from across a room, such as on a large TV. Large and Extra Large now make a bigger jump, and a new Huge option roughly doubles the text. Text scaling stays text-only — images, thumbnails, and window controls keep their normal size — but page widths, card columns, dialogs, and menus are now measured relative to the text, so larger text automatically gets fewer, wider columns instead of cramped or clipped layouts. Small icons that sit inside buttons and labels now grow with their text so big text no longer sits next to tiny glyphs, and the new size is offered to QDN apps through the existing display settings bridge.

### 2026-06-09 - app: responsive ui cleanup and visual polish

Reworked the shared interface styling without changing any functionality. The app now adapts to phone-sized screens up to 600px wide instead of only 420px: the address bar gets the full row on phones (forward, reload, and go buttons hide there, since swipe navigation, the system back button, and the tab menu cover them), address suggestions and address errors float over the page instead of pushing it down, and dashboard cards flow into as many columns as fit. Buttons that confirm a primary action (Browse QDN, Create, Save, Unlock, Approve) are now filled green so the main choice on each screen stands out. Text sizing was re-based so Medium matches the original baseline again while Large and Extra Large stay available for bigger text, and shared spacing, corner radius, and shadow values moved into named design tokens. Dialogs now close with the Escape key, keep keyboard focus inside while open, and return focus afterwards. The Accounts card explains what to do when no wallets exist yet, tap targets grow on touch screens, tab dragging no longer triggers from a stray tap, phone notch and gesture-bar safe areas are respected, and a missing color variable on the account status badge was fixed.

### 2026-06-08 - app: avoid white QDN overlay gaps

Changed the isolated QDN app placeholder to use Home's frame background instead of white while the native QDN view is temporarily hidden for account, node, or permission overlays, avoiding a bright blank app area when Home prompts need to appear above the native view.

### 2026-06-08 - build: inset android launcher icon

Changed the Android launcher icon generator to center the Qortium Home artwork with a larger safe inset, then regenerated the Android launcher PNGs so circular and rounded-rectangle launcher masks do not crop the sides of the house icon.

### 2026-06-08 - app: improve update progress and text scaling

Changed Home update downloads so desktop downloads report byte and percentage progress in Dashboard and Settings. Downloaded desktop Home updates now use a Show file action that opens the containing folder instead of launching the file directly, while Android keeps the Install APK action. Increased the Display Settings text-size jumps so Extra Small remains at the original baseline, Small matches the previous Medium size, Medium matches the previous Extra Large size, and Large and Extra Large continue with two larger jumps.

### 2026-06-08 - release: prepare home preview 9

Updated Qortium Home's package and Android version metadata to `1.0.1-preview.9` with Android `versionCode` 10 so the latest display settings, QDN app setting bridge, account lock-state updates, read-only permission cleanup, and Core API key fixes can be built as the next QortiumDev prerelease target.

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
