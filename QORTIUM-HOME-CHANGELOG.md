# Qortium Home Change Log

This is the main human-readable record of the Qortium Home application effort.
It is written for non-developers first, with the goal of making each change
easy to follow without reading code.

## What Qortium Home Is

Qortium Home is an app-focused client and trusted host for Qortium and Qortal.
It manages identities, wallets, nodes, QDN apps, permissions, and native
services while leaving full Chat, Wallets, Groups, Explorer, publishing, and
similar experiences to QDN apps.

The aim is to keep the application focused and understandable while supporting
both networks through explicit compatibility and security boundaries.

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

### 2026-08-24 - fix(home-v2): standardize settings buttons and native controls

Several buttons in the Settings Runtime section (such as "Check release",
"Apply transport mode", and the Qortal adoption actions) had no Home styling
at all, so they rendered as raw operating-system widgets — in dark mode this
made some of them nearly unreadable. Those buttons now use the shared Home 2
button styles, with checks and lookups as secondary buttons and actions that
change something as primary buttons. The shell also tells the browser which
color scheme is active, so any native control (dropdowns, checkboxes, text
fields) follows the app theme instead of the operating-system theme. Text
fields and checkboxes inside settings rows pick up the shared field styling,
disabled buttons are now visibly dimmed everywhere, and the danger button's
colors moved into the shared palette. No behavior changed — this is purely
visual consistency and readability.
### 2026-08-24 - feat(home-v2): restore the bookmarks toolbar

Home 2 once again shows the user's saved bookmark toolbar beneath the address
bar while leaving full collection management in the assigned Bookmarks QDN
app. Existing Always, Dashboard/New Tab, and Hidden choices are preserved, an
empty toolbar takes no space, and the visibility choice is available in
Appearance Settings. Links retain their saved account context, APP and WEBSITE
entries reuse Home's app icons, nested folders remain navigable, and standard
resource actions are available through right-click, keyboard, or long press.
The compact row scrolls horizontally on phones instead of silently dropping a
user-selected toolbar.

### 2026-08-24 - feat(home-v2): unify avatars and app icons

Home-owned avatar and app-icon surfaces now share one bounded image cache, so
a missing or unavailable image stops showing a permanent loading spinner while
the last good image can remain visible during a later refresh. The toolbar
shows the selected account's separate Qortium and Qortal avatars for whichever
networks are enabled. QDN app tabs, pinned apps, permission prompts, and the
QDN Apps Settings lists now resolve APP or WEBSITE favicons first, then fall
back to the publisher's same-network account avatar and finally a stable
monogram. Desktop and Android use the same safe, size-limited icon contract.

### 2026-08-24 - feat(context-menu): standardize Home actions

Home now owns a versioned context menu for Qortium and Qortal accounts,
groups, apps, websites, and other QDN resources. Apps can request the same
trusted menu through `qdnRequest` or `qortalRequest` instead of recreating its
labels and platform behavior. Desktop uses a native menu anchored safely to
the requesting app view, Android uses an accessible Home sheet, and the first
safe action set copies account/group/resource identifiers or opens APP
resources in a new tab. Pinned apps use the same resource-action vocabulary;
future payment, chat, membership, viewer, bookmark, and rating items remain
behind their existing typed Home permission paths.

### 2026-08-23 - fix(layout): use dashboard space more effectively

Dashboard node, Core, and account-presence cards now use the space belonging to
the networks that are actually enabled. A single Qortium-only or Qortal-only
setup fills the available row instead of reserving an empty column, while two
enabled networks continue to share the row and narrow windows collapse the
cards naturally. Pinned apps return to compact, draggable launcher buttons
instead of half-width management cards. Their rename, remove, and accessible
move controls now stay in a desktop right-click or mobile long-press menu.

### 2026-08-23 - fix(release): polish desktop defaults and packaging

Fresh Home profiles now start in dark mode while continuing to honor every
saved System, Light, or Dark choice. Desktop Dashboard and Settings pages use
the available window width instead of stopping at an arbitrary 1180-pixel cap;
phone layouts and deliberately narrow reading or dialog surfaces keep their
focused widths.

Desktop packaging also excludes generated Android dependency build output, so
building Android first cannot silently bloat a later AppImage. The hardened
package checker now rejects those generated files if they reappear.

### 2026-08-23 - feat(settings): control network availability

General Settings now lets people enable or disable Qortium and Qortal across
Home. Qortium starts enabled while Qortal starts disabled, and Home remembers
each network's previous connection choice when it is turned back on. Disabled
networks disappear from their Dashboard and Settings areas without stopping a
running Core, changing automatic updates, or removing saved configuration.

### 2026-08-23 - security: harden reporting and native build paths

Home now documents a private path for reporting vulnerabilities without
exposing them in public issues. Its Windows native-helper build no longer
passes a checkout-derived path through the Windows command interpreter, and
Android notifications now stop safely if the application launch activity is
unavailable instead of falling back to an intent with no destination.

### 2026-08-23 - fix(build): package native observers in universal macOS apps

Universal macOS packages now retain Home's separate Intel and Apple silicon
Core observers instead of asking Electron's universal-app merger to combine
each already architecture-specific resource a second time. The release check
also guards the exact two packaged observer paths so future universal builds
cannot silently drop either native helper.

### 2026-08-23 - fix(qdn): preserve Android uploads and numeric asset IDs

Android now sends the exact selected file bytes when a QDN app publishes
through a public node. The native HTTP bridge previously serialized the upload
as an empty object, so Core built a transaction for two bytes while Home
correctly compared it with the original file and stopped at its content-safety
check. Uploads now use Capacitor's lossless file transport while keeping that
attestation intact, including filenames with accented and non-Latin characters.

QDN app requests also retain numeric asset IDs instead of treating them as
missing. Native-asset detection and coin sends now distinguish asset `0` from
other numeric assets and reject malformed or negative IDs rather than silently
falling back to a different request interpretation.

### 2026-08-23 - test(widgets): verify transparent QDN compositing

Widget transparency now has a real compositor regression gate in addition to
its source contract. The desktop smoke captures the shaped QDN face and checks
that a clipped corner remains fully transparent while painted content stays
opaque. CI runs that smoke on every pull request, and the source guard now
binds the transparent `WebContentsView` background directly to Home's canonical
widget-tab classification instead of matching unrelated source fragments. The
headless driver also terminates the complete `xvfb-run` process group so a
successful compositor check cannot leave CI waiting on orphaned output pipes.

### 2026-08-23 - chore(release): prepare Qortium Home 2.1.0

Qortium Home is now prepared as version 2.1.0, with Android advancing from
version code 38 to 39 and the QDN app compatibility level remaining at 2.1 for
the restored bookmark-manager contract. A new automated check keeps the
desktop, Android, lockfile, and QAVS release values aligned and prevents the
retired Home 1 renderer entry points from returning. The root development
document now points only to Home 2 so existing smoke harnesses cannot revive
the removed renderer.

The release instructions now separate ordinary local builds from the native
platform acceptance, signed Android install-over-2.0.0 test, tagging, asset
upload, and publication checkpoints. This preparation does not sign, tag,
upload, or publish a release.

Android QDN apps now receive the same 2.1.0 host version in `GET_HOST_INFO` as
desktop apps, and the release checker/publisher includes the separate macOS
10.15 x64 compatibility DMG alongside the other six platform artifacts. CI
also runs the renderer TypeScript check explicitly instead of relying on the
production bundler to catch type errors.

Release preparation also removed Home's production use of an unpatched ZIP
extractor after its symlink-traversal advisory became visible in the audit.
Home now performs its own sequential extraction into exclusive, no-follow
files, accepts only normalized relative regular-file and directory entries,
and refuses symbolic links and special files before writing them. This applies
to QDN preview/render archives and managed Qortium Core, Java, and i2pd ZIPs;
the production dependency audit is clean.

### 2026-08-23 - feat(android): restore Home 2 approved Core updates

Home 2 on Android can once again check and request a Qortium Core update that
the configured node reports as approved on-chain. The control lives in Runtime
settings and works only with an explicitly configured Qortium custom node and
API key; public nodes, Qortal nodes, missing credentials, and remote plaintext
HTTP remain unavailable for this action. The key is encrypted through Android
Keystore, bound to the selected node origin, omitted from Home and QDN app
snapshots, and never grants embedded apps an administrative capability.

Before requesting installation, Home refreshes the selected node's update
status, leaves an existing download or installation alone, refuses redirected
admin requests, and aborts if the saved node or key changes between the check
and mutation. The existing Android Home APK check, verified download, and
Package Installer handoff remain unchanged; unattended APK download remains
disabled and is still downgraded to Notify.

### 2026-08-23 - feat(collections): migrate saved Home links into Home 2

Home 2 now carries forward the user's bookmarks tree, bookmark toolbar,
dashboard pins, start pages, visibility choice, and shared revision on first
run. Desktop reads the old default Electron profile through a hidden,
network-disabled migration document and writes the validated snapshot into the
isolated Home 2 profile; Android migrates the same existing native Preferences
in place and records a one-time migration marker. The old source data is
retained, the import is idempotent, raw canonical and mirror schemas are
validated before use, and malformed or equally revised conflicting data fails
closed instead of being replaced with an empty collection. Mirror updates land
before the canonical CAS snapshot so a partial write cannot falsely commit a
new revision.

The delegated QDN Bookmarks app can now feature-detect, read, update, and open
these saved links on desktop and Android under a durable `bookmarks.manage`
permission. Updates use the existing schema and exact revision check so a stale
manager cannot overwrite newer data, and an account-specific saved link opens
under that account only while it still exists. Durable bookmark access is
listed and revocable from trusted QDN Apps Settings on both platforms. This completes the previously
deferred Home 2 bookmark-manager action family, so QAVS `platformVersion`
advances from `2.0` to `2.1` while the separate Home application version remains
on its planned 2.1.0 track.

### 2026-08-22 - feat(core): add Home 2 automatic Qortal updates

Home 2's existing desktop Core update settings now include a separate Qortal
Core policy. Off performs no scheduled Qortal checks. Notify reports a newer
stable release without changing files. Install can apply only a strictly newer,
verified release to a stopped Qortal installation that Home created and whose
settings still prove that Home owns GitHub-based replacement. Existing policy
files migrate without losing the user's Qortium Core or Java choices.

Adopted installations, Qortal's native updater, missing installs, and uncertain
ownership remain non-mutating and do not cause a scheduled GitHub release
request. A policy or lifecycle change revokes automatic work before download
and again before activation; Home holds the shared Qortal operation lease while
the manager repeats its stopped-state, ownership, target, candidate, and
external-runtime checks around the filesystem transaction. Android receives no
Core maintenance surface, and this trusted desktop setting adds no public QDN
app action or QAVS platform-version change.

### 2026-08-22 - feat(core): add Home 2 Qortal adoption selection

Home 2 can now discover existing Qortal installations on demand and let the
user choose a supported installation from the trusted Runtime settings page.
Linux and macOS can also open the operating system's native folder picker. Home
shows only a source, version, running state, and numbered candidate; the
renderer never receives a filesystem path.

The main process gives each discovery result a short-lived bounded opaque token
and accepts selection only from the exact authorized top-level Home document.
It rechecks the token and the installation immediately before saving a selected
record under Home's own application data. Home does not write into or modify
the adopted installation. Windows browse and selection remain unavailable
until the native helper can safely write a no-reparse record in a private
directory. QDN apps and Android receive no discovery or selection surface;
widget-window calls through the shared preload are denied by the exact Home
document sender gate. This trusted-host feature adds no public app action and
keeps QAVS `platformVersion: "2.0"`.

A hardened packaged Linux x64 fixture verified on-demand Hub discovery,
opaque-token selection, a private Home-owned selected record, and byte-for-byte
unchanged adopted JAR and settings files. Packaged macOS selection and
real-Qortal native-host acceptance remain release gates.

### 2026-08-22 - feat(notifications): add Home 2 global policy

Home 2 now has its own device-wide App notifications switch in General
Settings on desktop and Android. Turning it off stops direct app alerts and is
also the global gate for the Home-managed background watcher when that is
activated in a later Home 2 tranche. It does not delete an app's notification
grant, mute choice, saved rules, or Core subscriptions. Permission checks
continue to report the app's grant independently of the switch.

Desktop keeps the policy in a small private main-process file and accepts
changes only from the exact trusted Home document, using a generation check so
stale windows cannot overwrite a newer choice. Android keeps the same versioned
policy in native preferences and, only when that new record is absent, carries
forward an explicit disabled choice from the old display-settings record. Home
2 never reads the legacy record while delivering a notification. Missing state
retains the historical default of on; corrupt or unavailable state fails closed
to off. This trusted Settings control adds no QDN app action and does not change
QAVS `platformVersion: "2.0"`.

### 2026-08-22 - feat(settings): add Home 2 Settings section routing

Home 2 can now open a specific Settings section from another trusted part of
the Home interface without adding a URL or an app-facing command. The Core
management card on the Dashboard opens Runtime settings directly, while the
former Notifications destination remains a compatibility alias for the QDN
Apps section where notification controls now live. Opening Settings normally
still starts on General, so an earlier targeted visit does not become a sticky
preference. This internal routing is shared by desktop and Android and does not
change QDN app actions, add a public IPC request, or alter the QAVS platform
version.

This change also makes two intentional Home 2 presentation omissions explicit.
The old Classic/Modern/Fun UI-skin selector and the keyboard-shortcut hint rows
beside text size and page zoom are not carried forward. The zoom and text-size
shortcuts themselves remain available; every other reviewed v1 Settings gap is
kept, migrated, or assigned to its existing roadmap follow-up.

### 2026-08-22 - feat(settings): add Home 2 QDN permissions

Home 2's QDN Apps Settings section can now choose the saved app for each
existing Home role and manage notification access on desktop and Android. An
assigned app still needs its own permission before it can manage Home data, and
these choices are saved in the Home profile. Notification grants use one stable
QDN resource identity across Qortium and Qortal: muting hides alerts while
keeping the grant, rules, and Core subscriptions; revoking removes the grant and
all of that app's rules. Home warns that watch-only wallet data already shared
with a Core for foreign-payment notifications cannot be recalled.

The desktop exposes only redacted summaries to the exact trusted Home shell and
rejects widgets, subframes, and navigated documents before reading the stores.
Android uses the same revision-checked profile semantics. Corrupt or unavailable
notification state fails closed. Desktop sends no raw rules, account bindings,
filters, watch-only keys, notification text, links, paths, or capability grants
across IPC. Android reads its renderer-owned Preferences store and projects the
same redacted management state before the Settings component receives it. This
Settings-only slice adds no public QDN app action and keeps QAVS
`platformVersion: "2.0"`; app-facing assignment delegation remains a separate
follow-up.

### 2026-08-22 - feat(core): add Home 2 transport maintenance

Desktop Runtime settings can now choose Qortium Core's Direct + I2P, Direct
only, or I2P only transport mode while Core is stopped. Home preserves every
unrelated Core setting, writes the selected transport list through a private
atomic replacement, and rechecks the installed Core target, unchanged settings,
and strongly stopped runtime immediately before activation. Modes that use I2P
remain unavailable until a local router completes a real bounded SAM handshake;
a successful local SAM exchange is described only as router readiness, not proof
of I2P reachability or privacy.

Home can also install, start, and update its own pinned i2pd build on supported
desktop targets. The main process selects an exact Qortium release asset for the
current OS and architecture, requires its fixed byte size and SHA-256 digest,
extracts it into an immutable generation, and re-hashes the selected binary
before each launch. Home supervises only the child process it started in the
current session: it never adopts PID files, scans process command lines, exposes
paths or process details to the renderer, or stops another local router. Router
and Core mutations share the Home 2 maintenance coordinator and report success
only after a fresh status confirms the requested state. Android Core/i2pd
management, retired-generation cleanup, signing, publication, and live network
acceptance remain outside this change.

### 2026-08-22 - feat(core): add Home 2 Qortal maintenance

Desktop Runtime settings can now install a verified stable Qortal Core into
Home's managed data or update an existing Home-managed Qortal Core when it is
stopped and a strictly newer release is available. Release discovery and the
mutation-time refetch stay in the main process. Home requires the exact
official `qortal.jar` URL, GitHub SHA-256 and byte size, resolves the release
tag to an immutable commit, and rejects a downloaded JAR unless its embedded
version and commit match that release. The renderer supplies only the action
and expected tag; it never receives or chooses URLs, digests, paths, commits,
or raw GitHub metadata.

New Home-managed installations explicitly turn Qortal's native automatic
updater off so only one system owns later JAR replacement. Home rechecks that
setting, the stopped runtime, the selected target, and release identity before
an update transaction. Existing adopted installations remain read-only, and a
Qortal installation using its native updater remains Qortal-owned. Before
creating another install, Home also checks the conventional Qortal data
directory and requires candidate selection when an existing installation is
found. Automatic Qortal updates, adopted-file mutation, candidate-selection
UI, Android Core maintenance, i2pd/transport, signing, and publication remain
outside this change.

### 2026-08-22 - feat(core): add Home 2 Core update policies

Desktop Runtime settings can now keep automatic Qortium Core and managed-Java
maintenance Off, notify about a newer version, or install it automatically.
Home stores those choices in an exact versioned private file with optimistic
generations, atomic replacement, and one-field conflict recovery. Valid legacy
choices migrate once; malformed new state fails closed with both policies Off
until the user explicitly saves a replacement.

One main-process scheduler checks at startup and every six hours, independently
of open Home windows. Policy generations and a shared lifecycle/mutation
coordinator revoke stale work before download and again before activation. Core automation uses
only the installed channel, only a strictly newer verified release, and only
when Qortium Core is strongly proven stopped; it never bootstraps, changes
channel, repairs, downgrades, or stops a running Core. Java automation only
updates an existing Home-managed runtime and atomically selects another
immutable verified generation, leaving running Cores on the files they already
mapped. Off performs no scheduled GitHub or Adoptium lookup. Qortal updates,
host-triggered on-chain Core updates, Android Core/Java management,
i2pd/transport, retired-Java cleanup, signing, and publication remain outside
this change.

### 2026-08-22 - feat(core): add Home 2 Core maintenance

Desktop Runtime settings can now install a verified Qortium Preview Core or
update an existing Home-managed Core when its own release channel has a
strictly newer version. Home performs release discovery itself, re-checks the
exact official tagged release before download, requires its canonical SHA-256
and positive byte size, and verifies both while streaming. The page receives
only the release channel, version, capability, and bounded outcome; it cannot
supply a URL, digest, path, downgrade approval, reinstall request, or Qortal
mutation. Core must be stopped before this manual install or update.

The same panel can install managed Java when Java is missing, unsupported, or
behind Home's managed target. Java versions now publish as immutable,
single-flight generations through atomic metadata. A delayed update check can
no longer point Home back to an older generation, and installation never
deletes or overwrites files that a running Qortium or Qortal Core may still be
using. Automatic Core/Java policies, Qortal installation, i2pd/transport,
Android Core maintenance, retired Java cleanup, signing, and publication stay
outside this change.

### 2026-08-22 - feat(updates): persist Home 2 update policy

Home 2 now remembers the selected Home release channel and automatic-update
policy. On desktop, the trusted main process owns a small versioned settings
file with private permissions, atomic replacement, and a generation check so
two stale windows cannot silently overwrite one another. Because Home 2 uses
an isolated browser partition, desktop starts from the main process's safe
Notify/Stable defaults instead of pretending it can read Home 1 renderer
storage. Off performs no startup network work, Notify checks once per saved
settings generation, and Download automatically checks and downloads a
verified package without opening, installing, or replacing the running
application. Every Home 2 desktop download lands under Home's private update
directory rather than beside the running package.

Android remembers Off or Notify only through native private preferences and
continues to support explicit verified APK downloads and installer handoff.
Automatic download is deliberately unavailable there until release discovery,
streaming download, opaque receipts, package identity, and signer verification
are all native; the current renderer-held URL and path flow is not expanded
into unattended authority. Focused tests cover malformed state, host generation
claims, policy-gated startup checks, exact check-then-download ordering,
serialized rapid changes, private download targets, and Android's fail-closed
automatic boundary. Packaged desktop and Android emulator smokes verify
rehydration and the real persistence surfaces.

### 2026-08-22 - feat(updates): restore Home 2 application updates

Home 2 now exposes Qortium Home update checks and verified downloads in the
Runtime settings section on desktop and Android. Desktop release discovery and
asset selection run in the main process through a new sender-gated, versioned
bridge; widgets, subframes, navigated documents, extra request fields, raw
GitHub data, download URLs, and filesystem paths are not accepted or returned.
Home re-fetches the fixed official release immediately before download, accepts
only the matching platform package, requires GitHub SHA-256 metadata, enforces
the declared byte size, and gives the renderer only a short-lived opaque handle
for revealing the verified file.

Android retains its native APK path while applying the same official-release,
digest, size, and signed-APK rules. The installer now re-hashes the canonical
app-private APK immediately before handing it to Android, so a missing,
changed, unsigned, misplaced, or non-APK file cannot reach the package
installer. The Android update-state and installer smokes now exercise the
shipped Home 2 screen, and CI explicitly assembles the debug APK. Core/Java,
i2pd/transport, Home auto-download policy, signing, publishing, and release
work remain separate roadmap tranches.

### 2026-08-22 - feat(core): add Home 2 Core management UI

Home 2 now shows Qortium-first Core management cards on the desktop Dashboard
and in a new Runtime settings section. Each card uses only the sender-gated,
redacted manager status added in the preceding change: it can refresh status,
offer Start or Stop only when the manager authorizes that action, explain
managed versus authenticated API control, and report bounded outcomes without
showing paths, process details, keys, or raw manager failures. Stopping a Core
that Home controls only through its authenticated API requires an explicit
in-app confirmation and never kills the process directly. Starting or stopping
a Core does not silently change the selected Public, Local, or Custom node
connection.

The renderer now validates every versioned Core status and action result,
rejects stale polling responses, prevents overlapping actions using the same
serialization rules as the main process, and refreshes node state after a Core
action. The large live shell no longer owns node polling and mutation state;
that wiring is isolated in a tested node/Core controller before more management
panels are added. Android deliberately omits the desktop lifecycle controls
while retaining its existing portable node status. The new static interface
copy is translated across all 23 catalogs. Install/update, Java, i2pd,
transport, and policy controls remain later parts of the 2.1 roadmap.

### 2026-08-22 - feat(core): add gated Home 2 lifecycle controls

Home 2 now has a small desktop-only bridge for reading the state of Qortium and
Qortal Core and requesting start or stop. The bridge accepts an explicit
network, checks that every request came from the trusted top-level Home
document, and returns only coarse installation, runtime, control, capability,
and outcome fields. Paths, API-key evidence, process identifiers, launch
receipts, ownership records, arbitrary failure causes, and downgrade tokens
never cross into the renderer.

Widgets and subframes remain unauthorized even though widgets share Home's
preload. Authorization is bound to the exact trusted document and is revoked
on destruction or navigation. Core actions are capability-preflighted,
revalidated inside the existing managers, serialized per network, and starts
are also serialized across networks because Qortium and Qortal share managed
Java. Legacy Core and i2pd progress/status broadcasts are disabled in Home 2;
this first bridge is invoke-only and does not register the ungated legacy IPC
surface. Install, update, Java, i2pd, policy, progress, and management UI
controls remain later work.

### 2026-08-22 - feat(core): control adopted Qortal runtimes

Home can now retain an explicitly selected existing Qortal installation in its
own private app data on supported POSIX systems, without writing metadata or
API keys into the adopted directory. The selection is published atomically
without replacing another selection and binds the exact Qortal JAR plus a
bounded digest of `settings.json`; changed, aliased, stale, insecure, or racing
evidence remains blocked. Windows selection writes stay disabled until Home has
a native no-reparse, private-directory writer, while securely reading an
already present record remains supported. Selection and initial install share
the same canonical lock key even when the managed install directory has not
been created yet.

A valid adopted installation can now be started directly with Java from its
own directory and stopped only through Qortal's authenticated API using its
existing key. Home rechecks the selected files and process/listener authority
at each launch and stop boundary, never invokes foreign scripts, never kills an
adopted PID, and leaves Qortal running when Home exits. Install and update
mutation, Home 2 IPC and renderer controls, Windows record creation, and
real-Qortal native-OS acceptance remain later gates. A packaged Linux
protocol-fixture run verified selection, ready start, Home exit with Qortal
continuing, complete AppImage resource release, unchanged adopted files, and
authenticated API-only stop. Packaged Linux starts use Home's controlled
argument-preserving wrapper solely to close inherited AppImage descriptors
before it replaces itself with the exact Java command.

### 2026-08-21 - fix(widgets): preserve transparent QDN view backgrounds

Fixed QDN widgets showing an opaque white rectangle around shaped or partially
transparent widget faces. The widget window and its shell already used a
transparent background, but the Electron `WebContentsView` hosting the
widget's QDN page defaults to an opaque white background of its own,
independent of the host window. Home now gives widget `WebContentsView`s an
explicit transparent native background while leaving the background behavior
of normal app tabs untouched.

### 2026-08-21 - fix(core): resolve Windows secure-file drive paths

Home's Windows helper can now securely open ordinary drive-letter paths after
resolving the drive to its native device mapping. The native open still refuses
filesystem symlinks, junctions, and other reparse points, while retaining the
existing stable-file, private-permissions, and current-user checks. This fixes
the secure API-key read found during the real-Qortal Windows acceptance pass
without weakening the fail-closed boundary.

### 2026-08-21 - feat(core): add adopted Qortal install discovery

Home can now inspect canonical Qortal installation candidates without changing
their files, combine duplicate path, running-process, and Qortal Hub hints, and
keep multiple foreign candidates separate for an explicit future choice. A
Home-managed path always takes precedence over a foreign candidate.

An explicitly selected adopted installation can be represented by a strict
Home-app-data record containing its canonical paths and adoption-time JAR and
settings identity. The internal Qortal manager now recognizes a valid record,
but deliberately exposes no install, update, start, or stop capability for it
yet. When the node is proven stopped, Home can already classify whether its
settings leave updates with Qortal or would allow future Home-managed updates.
Missing, aliased, malformed, insecure, changed, or ambiguous evidence
continues to fail closed, and observation never writes into the adopted Qortal
directory. No Home 2 preload, IPC, or renderer controls are added by this
change.

### 2026-08-21 - feat(core): add native macOS and Windows Qortal authority

Home can now apply the existing fail-closed Qortal lifecycle rules on macOS
and Windows x64 through small packaged native observers. They bind a candidate
Java process to its owner, exact command evidence, working directory, managed
JAR, stable birth identity, and the complete owner set for Qortal's local API
listener before Home treats the process as managed. Missing, changing,
malformed, ambiguous, or inaccessible evidence remains unknown and prevents
control.

The macOS helper uses current-user process and socket evidence with a
boot-session identity, while the Windows helper conservatively validates the
native x64 process layout, preserves the raw Windows command line, and rejects
ambiguous argument reconstruction or unsupported layouts. Windows API-key
reads now also use a no-reparse native open, stable volume/file identity, and a
private current-user security descriptor instead of following a filesystem
alias. Both helpers are built and verified as exact packaged resources. This
adds no Home 2 controls yet; signed release artifacts and real-Qortal
start/relaunch/readiness/stop acceptance on each native OS remain release
gates.

### 2026-08-21 - feat(core): build verified Qortal lifecycle foundations

Home now has a fail-closed staging path for Qortal releases. It writes into an
exclusive partial file, requires the exact declared byte count and SHA-256
digest, and then checks the JAR's embedded build version against the selected
stable release before the candidate can advance. Partial and destination paths
must resolve to distinct names in the same staging directory.

The matching install primitive changes only `qortal.jar`: it uses atomic
same-directory renames for initial installs and updates, preserves Qortal's
settings, API key, database, data, lists, and logs, and restores the previous
JAR and metadata when activation fails. Cross-device copy fallbacks, symlinked
JAR endpoints, stale backup collisions, and incomplete rollback are rejected or
reported explicitly. Linux process discovery also now finds Qortal's default
`settings.json` in the Java process's working directory when the JAR lives
elsewhere.

A fresh Home-managed install can now add Qortal's minimal settings file and a
private pre-seeded API key, then commit a separate managed-install record only
after the activated JAR's size, digest, and embedded identity are rechecked.
Update rollback restores the prior record exactly, while fresh-install rollback
removes only files that this transaction created. The key itself is never
copied into metadata.

JAR mutations now have a cooperative cross-process filesystem lease keyed by
network and the canonical target. It uses exclusive private lock files,
refuses live or uncertain owners, and retains proven-dead locks for explicit
recovery rather than risking deletion of a replacement lock. Target snapshots
record the canonical path, filesystem identity, digest, and uncached embedded
JAR identity so a future manager can revalidate immediately before mutation.
Qortal's stopped settings chain can also be read with its comment,
trailing-comma, `userPath`, and default-value behavior to decide whether
updates belong to Qortal itself, Home, or neither when evidence is uncertain.
This is an update-ownership projection, not proof that every unrelated setting
will pass Qortal's complete configuration validation.

These remain main-process foundations only. No Qortal lifecycle is registered
or exposed to Home 2.

That composition now has a standalone, fail-closed coordinator. It serializes
install, update, start, and stop; rechecks process, readiness, policy, release,
candidate, and managed-JAR evidence inside the lease; launches Java without a
caller-controlled shell from the install directory with literal
`settings.json`; and permits authenticated stop only for positively Home-owned
processes. Same-version and downgrade updates are refused, native Qortal update
ownership wins, and adopted installs remain observation-only. The coordinator
deliberately requires strong process, listener, Java, readiness, and API seams
that are not implemented yet, so it is tested but not registered or reachable.
Verified per-operation candidates that are not consumed are retained for
explicit recovery: Node cannot safely unlink a pathname only if it still names
the inode that Home inspected.

The coordinator now has a Linux production adapter and is registered internally
after Electron finalizes its data paths. Runtime control requires stable
`/proc` PID/start identity, exact Qortal argv/cwd/JAR, and no second visible
holder of listener 12391 within the current local-user trust boundary, plus
JAR-matching mainnet `/admin/info` and structurally valid
`/admin/status`, and unchanged authority after probing. API-key control follows
Qortal's effective `userPath` settings, requires a private Home-owned Base58
key, disables local-auth bypass, verifies the key live, and rechecks authority
before `/admin/stop`. Qortal shares the verified managed Java runtime and only
accepts an OpenJDK system fallback after resolving and probing the exact
executable under the sanitized launch environment. Home 2 still exposes no
Core lifecycle IPC.

### 2026-08-21 - feat(shell): advance the Home 2.1 trusted shell

Home's plus button now opens a dedicated new-tab page for finding public
accounts by registered name or chain address across Qortium and Qortal. The
standalone lookup has moved off Dashboard, Qortium results appear first, and
the selected-account card keeps its existing cross-network identity details.
Open QDN app tabs remain available when New tab is selected, and the new
internal destination is restored safely without changing the saved-state
format. QDN app and Home addresses continue to use the browser address bar.

Missing legacy avatars now fall back promptly to an account initial instead of
showing a long-running spinner. Home first verifies that the named avatar
resource exists, preserves bounded background loading for published images
that are not local yet, and applies the same behavior on desktop and Android.

Settings now has a small section navigator for General, Appearance, and the
active account. General can choose whether the plus button opens the Search
page, Dashboard, or a custom Home/QDN app address, and the choice is restored
on the next launch. Custom addresses are checked before saving and then use the
same guarded address bar flow as addresses entered by hand, including its
identifier choices and error messages.

Home 2's static browser chrome, new-tab page, Dashboard, Settings, account and
permission controls, resource viewer, and component fallback labels now use
the shared Home translation runtime. All 23 existing language catalogs carry
the same Home 2 keys and placeholders, a language change updates lazy-loaded
copy without restarting, and right-to-left languages set the shell direction
as well as its text. Runtime-generated permission, identity, and node details
remain a separate localization step. Existing language values exposed to QDN
apps are unchanged.

Core management now derives the existing Qortium storage, release archive,
Previewnet chain, bootstrap, local API, helper-script, and i2pd behavior from a
typed network descriptor instead of scattered single-network constants. Local
Core API-key discovery is also isolated by network and optional runtime target,
with stale asynchronous lookups prevented from repopulating an invalidated
cache. Existing Qortium APIs and behavior remain the compatibility path; this
is groundwork for the later Qortal lifecycle and adoption work, not exposure of
those controls to Home 2 yet.

Core's in-memory layout, update scheduling, downgrade confirmations, and
install operations are now isolated by network as well. A keyed manager
registry contains only the existing Qortium implementation, so requesting a
Qortal manager fails closed until its real release and adoption pipelines are
added. The classic Qortium controls now enter through that registered manager,
while Home 2 still receives no Core-management preload or IPC capability.

The Qortal side now has its own truthful descriptor and strict stable-release
selector. Home recognizes Qortal's direct `qortal.jar` launch, normal API and
stop endpoints, shared managed Java location, snapshot bootstrap, and native
auto-update setting without claiming that Qortal implements Qortium's
`/admin/update` API. A release qualifies only when one exact `qortal.jar` asset
has a mandatory SHA-256 digest, positive safe size, and the matching official
Qortal GitHub download URL. Download, installation, adoption, and UI wiring are
still deliberately absent at this foundation stage.

### 2026-08-21 - feat(shell): start Home 2.1 with Qortium-first chrome

Home now has one clear browser tab row instead of an extra Home brand block that
looked like a second tab. Qortium appears first in the toolbar node controls,
connection cards, and selected-account presence, with regression coverage
preserving that ordering on desktop and phone layouts. Obsolete startup wording
no longer claims that account integration or Reticulum is unavailable in the
build.

The canonical project plan now identifies 2.0.0 as the shipped baseline and
tracks the combined feature cycle as Home 2.1.0. The release plan preserves
Home's slim QDN-app-focused boundary, makes managed Qortal Core a release gate,
and records the safe implementation sequence and cross-platform checks. Home's
application release version is now distinct from its advertised QAVS platform
level; the level may stay at 2.0 only if a final bridge audit proves that no new
app-facing action or observable behavior ships.

### 2026-08-20 - fix(apps): preserve focus and permission sessions

Home 2 no longer hides and re-shows the active desktop app when routine node
telemetry refreshes, and a delayed native-view hide can no longer pull desktop
focus back to Home after the user moves to another window. Route-state updates
still reach hosted apps through a separate bridge-state delivery path. Missing
permissions from hidden app tabs are refused without switching tabs or raising
trusted Home chrome, while duplicate prompts are suppressed and session grants
are revoked only for the affected Home window, tab, account, or network. A
clearly disclosed tab approval for chat changes now covers sending, editing,
deleting, and reacting within the same public, direct, or private-group chat;
key management, publishing, administration, and all existing target, ownership,
route, signing, and rate-limit checks remain separate and unchanged.

A single clearly disclosed read-only account approval now covers the selected
Home account on both Qortal and Qortium for that app tab, including account
identity, direct messages, private groups, searches and attachments, and the
app's pending transaction records. It survives locking, unlocking, node
failover, and normal in-app navigation, while a real account change, tab
closure, or Home restart still revokes it. Unlocking and every mutation remain
separate. Restored app
tabs now show a neutral node-checking state until the first connection check
finishes, and unlock completion waits for the updated account state to reach
the app before the original operation resumes.

Private-group state now distinguishes node-level QPGC availability from
whether the selected account actually has the current group key. Desktop and
Android automatically create and announce a Qortium group key for all current
members when the first message, edit, delete, or reaction finds no usable key,
then continue the original operation without another app action or permission
prompt. Manual key controls remain a Qortal compatibility concern, not normal
Qortium user workflow. A newly announced or rotated key is kept unavailable
locally when its announcement broadcast is uncertain; Home records that control
signature while proving that the user's message was not submitted, so retrying
the message is safe and retained announcement discovery can reconcile the key.

Android Home 2 now keeps the node route selected by its portable Qortal/Qortium
connection client authoritative through public and direct chat, private-group
reads and writes, private attachments, and group membership or administration.
Those helpers no longer perform a second legacy Qortium node discovery or
borrow a legacy node API key, preventing valid requests from being rejected
when the two independent public-node selectors chose different healthy nodes.
Private-group state validation also stays on the dedicated permissioned vault
path instead of routing Home's own `/chat/private/...` request through the
generic app read allowlist, which intentionally excludes private API routes.
The Android connection client also retains a recently verified public route
through a brief failed health-probe cycle instead of reporting the network
unavailable between successful checks. Android's renderer policy now permits
only Home's same-origin memory-proof worker, allowing CHAT proof-of-work to run
without opening general network or cross-origin worker access.
The Android app bridge now also keeps every CHAT proof-of-work mutation open
for the same long-running window as ordinary message sends, so private-group,
direct, edit, delete, reaction, and key-management requests do not time out in
the hosted app while Home is still computing and may still broadcast them.

### 2026-08-19 - fix(release): restore Core compatibility and unlock ordering

Home 2 now carries forward the Core 1.7 compatibility protections from the
Home 1 maintenance line. Compatible direct-release and test-JAR replacements
self-reconcile against the installed files, activation-schedule metadata no
longer creates a false Previewnet mismatch, and a rotated localhost Core
certificate authority can refresh through the loopback-only bootstrap path
without replaying writes. Home also waits for every matching QDN app tab to
acknowledge its unlocked account state before resuming an app's unlock request
on desktop or Android. Unrelated tabs remain untouched, and a failed state
update leaves the permission request unapproved instead of resuming it against
stale main-process state.

### 2026-08-19 - chore(release): prepare Home 2.0.0

Prepares the first Home 2 prerelease under the existing Qortium Home desktop
and Android application identities. The desktop package version and Android
version name were already set to 2.0.0 when Home 2 became the production shell;
this release step advances Android's internal version code from 37 to 38
because the Home 1.7.0 maintenance release used code 37. This makes the Android
2.0.0 package a valid in-place upgrade while leaving the public release pending
the normal artifact builds, signing checks, and final prerelease verification.

### 2026-08-19 - feat(widgets): integrate widgets with Home 2

Home 2 can now host desktop widgets published inside QDN apps: small,
transparent, always-on-top faces with declared click-through regions, native
dragging and resizing, edge snapping, saved placement and opacity, and complete
tray controls even when the main Home window is closed. Widget discovery and
permissions are tied to the exact calling tab and published resource, manifests
are size-bounded before parsing, duplicate instances of one resource are
prevented, and each widget receives current Home 2 appearance and route state.
The first widget contract is deliberately public and read-only apart from its
own window controls; account, signing, publishing, notification, private-data,
file-dialog, and other trusted-chrome actions stay in normal app tabs. Public
author documentation, focused contract tests, an offline native smoke test,
and packaged Linux verification cover the release path; Android floating
windows remain out of scope.

### 2026-08-19 - feat(v2): pass the clay accent through to hosted app tabs unchanged

Home 2's app tab stage no longer remaps the `clay` accent to `orange` in the
postMessage displaySettings bridge sent to hosted QDN apps — it now sends
`clay` unchanged, matching the render URL's `accent` query parameter, which
already passed it through raw. Apps that don't yet recognize `clay` simply
fall back to their own default accent until they republish with clay support;
this removes the prior inconsistency where an app saw `accent=clay` in its
URL but `orange` in the UI bridge payload. Separately, `docs/CHAT_2_0_PLAN.md`
is updated to reflect that Chat 2.0.0 shipped 2026-08-19, published to both
the Qortium QDN (`APP/Chat/Chat`) and Qortal QDN (`APP/xchat/default`) chains,
with Phases 1–3 delivered.

### 2026-08-19 - feat(v2): send hosted apps the modern uiStyle; drop Chat 2.0's RCHAT release gate

Home 2's app tab stage now tells hosted QDN apps to render their `modern`
uiStyle variant instead of `classic`, both in the render URL's `uiStyle`
query parameter and in the postMessage displaySettings bridge's `ui` field —
the v2 shell is Home's modern design system, and apps already implement a
`modern` variant from the legacy display-settings catalogue. The `clay`
accent still remaps to `orange` for now, since published apps don't yet
recognize `clay`; that stays until Chat and other apps ship clay support.
Separately, `docs/CHAT_2_0_PLAN.md` no longer treats the Qortal RCHAT/
Reticulum source as release-gating for Chat 2.0: the owner decided RCHAT is
parked as a possible post-2.0 addition, not a shipping requirement, so the
plan's status, goals, and release-gate language were updated to match.

### 2026-08-19 - feat(chat): complete Home 2 operational continuity

Home 2 now revokes temporary app authority whenever the selected account,
unlock state, node route, app navigation, or tab lifecycle changes. Desktop and
Android clear session approvals, pending prompts, chat rate-limit state,
publish source tokens, and resource streams at the same boundaries while every
long-running signing path retains its final context checks. Signed transactions
whose broadcast outcome is unknown are retained across restart in a bounded,
app/account/chain-scoped journal containing only the signature, action,
timestamp, and normalized target—never message text, keys, file bytes, paths,
or content hashes. Apps can read and explicitly forget their own entries through
two permissioned route-independent actions; Home blocks another same-target
mutation until reconciliation prevents a restart or route change from becoming
a duplicate submission. Deterministic tests now cover both chains across
desktop local/custom/public and Android custom/public routes. This completes
Home milestones H0-H7; the next portability work is Chat integration.

### 2026-08-19 - feat(chat): add chain-qualified Home 2 notifications

Home 2 apps can now request system notifications through either the Qortium or
Qortal bridge on desktop and Android without depending on a node route or
wallet unlock. Home derives the chain from the invoked bridge, rejects a
mismatched claim, validates optional group/direct conversation identity, and
repeats that normalized source in the result and click event. The first request
uses one durable, revocable app-scoped approval shared with Home's notification
settings. Shown titles always include the app name and chain, focused tabs are
suppressed, each app is rate-limited, and clicks reactivate the originating tab
when it still exists. This completes H7A; background subscription rules remain
separate until Chat's bounded polling demonstrates a need, while H7B still owns
lifecycle invalidation, ambiguous-send continuity, and the final matrix.

### 2026-08-18 - feat(chat): add encrypted private attachments

Home 2 now owns private chat attachment encryption, publication, decryption,
viewing, streaming, and saving for Qortium and Qortal direct messages and
closed groups on desktop and Android. Apps receive only an expiring native
source token and an immutable ciphertext descriptor; native paths, private
keys, and group keys never cross into the app, and decrypted bytes are exposed
only through an approved expiring stream capability. Qortium uses
Core's frozen QATT/QENC v2 contract, Qortal direct files use a distinct marked
QENC v2 envelope, generic Qortal private-group files use a distinct QATT
`encryptSingle` type, and Qortal private-group images retain Hub-compatible
type-2 IMAGE publication. Every access is one-request approved, verifies the
exact ciphertext size and SHA-256 commitment, rechecks the selected account,
peer key or current group membership, app/tab, chain, and node route, and uses
an expiring GET/HEAD/Range capability for decrypted bytes. Ciphertext size,
timing, and publisher identity remain public metadata, and recipients can
retain plaintext they already downloaded. This completes Home milestone H6;
Chat still needs to emit and render the authenticated descriptor.

### 2026-08-18 - feat(chat): add portable dual-chain public publishing

Home 2 now gives QDN apps a Home-owned public-publish flow through both
`qdnRequest` and `qortalRequest` on desktop and Android. The app first asks
Home to select a file and receives only an expiring token; native paths never
cross the bridge. Publication is always a one-request approval that shows the
selected chain, node route, resource coordinate, filename, size, and SHA-256
hash. Home verifies current name ownership, stages only against that exact
route, attests the returned ARBITRARY transaction and approved content, applies
the chain's required proof and signature locally, and returns an immutable
transaction signature plus content hash. Qortal and Qortium never fall back to
one another or to another node, and an operator that disables public staging
gets an exact capability error. H5B also replaces raw media routes with
ten-minute, exact-resource stream capabilities: desktop uses a private secure
scheme registered in each app session, while Android uses the HTTPS range
proxy without weakening the app document's bridge authorization. Both refuse
redirects, preserve bounded Range delivery, expose no API key, and expire or
revoke with the app, tab, account, or route context. This completes Home H5;
private attachments remain the separate H6 cryptographic tranche.

### 2026-08-18 - feat(chat): add dual-chain public resource viewing

Home 2 now gives QDN apps the same network-qualified public-resource viewing
surface through `qdnRequest` and `qortalRequest` on desktop and Android. Apps
can open Home's tab-scoped viewer, obtain a ranged media URL, or ask Home to
save a resource through the route selected for that exact chain. Android uses
the authorized HTTPS range proxy for media instead of buffering whole files;
desktop and Android saves are user initiated, filename-sanitized, and capped at
100 MiB. Resource coordinates reject traversal and never fall back
between Qortium and Qortal. The viewer visibly labels every item as public and
keeps scriptable application archives out of the embedded surface. This
completes H5A action parity; expiring stream capabilities, Home-issued source
tokens, and portable public publishing remain H5B.

### 2026-08-18 - feat(chat): add portable Qortal private groups

Home 2 now gives QDN apps the matching Qortal private-group action family on
desktop and Android through the selected local, custom, or public route. Home
discovers only current administrator publications at the established
`DOCUMENT_PRIVATE/<admin>/symmetric-qchat-group-<groupId>` coordinate,
decrypts the Hub-compatible recipient bundle, supports both retained
`encryptSingle` formats and reaction type 102, and keeps recovered key rings in
encrypted account-bound desktop or Android storage. Current members can read,
send, reply, edit, clear displayed content, react, and recover after reinstall;
current named administrators can republish or rotate bundles for the current
membership. QDN publication stages only already-encrypted ciphertext, attests
the returned Qortal ARBITRARY sender, reference, coordinate, method, service,
hash shape, size, timestamp, and fee before local signing, and preserves signed
unknown broadcasts as unsafe to retry. Operators may disable QDN staging; Home
then reports `NODE_CAPABILITY_MISSING` on that exact route and never changes
nodes or falls back to plaintext. Clean-room byte-exact tests match the official
Hub v3.0.0 bundle plus old/new message and reaction fixtures. This completes
Home milestone H4 on both chains.

### 2026-08-18 - feat(chat): add portable Qortium private groups

Home 2 now gives QDN apps a portable Qortium private-group chat family on
desktop and Android through local, custom, and public nodes. Home reads Core's
atomic group state and bounded signed control records, independently verifies
the outer CHAT and inner QPGC signatures, recovers or relays recipient-wrapped
keys, rotates group keys, and encrypts/decrypts retained messages without
giving an app any reusable key or private wallet material. Send, edit,
content-clearing delete, reaction, key-request, key-relay, and rotation actions
all build and attest the exact unsigned CHAT transaction before local
MemoryPoW/signing; account, membership epoch, reference, route, app, and tab
context are rechecked before broadcast. Encrypted account-bound key records are
stored with bounded owner-only desktop files or bounded Android preferences,
purged with the corresponding account, recoverable after a same-identity wallet
re-import, and exercised against Core's byte-exact QPGC fixture. This completes
the Qortium half of H4; Qortal's
separate private-bundle and `encryptSingle` lifecycle remains the next Home
tranche.

### 2026-08-18 - feat(chat): add portable dual-chain direct messages

Home 2 now gives QDN apps separately named direct-message history, active-chat,
send, edit, content-clearing delete, and reaction actions on both Qortium and
Qortal. Desktop and Android keep every private key and shared secret inside
Home, decrypt each retained message only for the selected account and exact
peer, and return per-message failures without exposing ciphertext keys.
Qortium uses Core's QDM1 AES-GCM envelope and public unsigned CHAT builder;
Qortal uses the frozen legacy version-2 NaCl secretbox and transaction format.
Both implementations share byte-exact interoperability tests, require a usable
recipient public key, recheck the app, tab, account, peer, reference, and node
route before signing, and preserve signed uncertain broadcasts as unsafe to
retry. Qortal delete is explicitly a valid content-clearing edit: it does not
claim to erase either immutable transaction.

### 2026-08-18 - feat(chat): add portable group administration

Home 2 now gives QDN apps exact, separately approved invitation, join-request
approval, invite cancellation, admin-role, kick, ban, and unban actions on
both Qortium and Qortal. Desktop and Android build the seven underlying
transaction types locally, attest every approved field, and use the chain's
correct proof rule: current MemoryPoW on Qortium and a freshly rechecked fee
and last reference on Qortal. Home verifies the current group owner or admin
before prompting and again before signing, protects the owner from removal,
kick, or ban, and binds every operation to the same app, tab, account, chain,
group, member, and node route. Administrative approval is always one request;
uncertain signed broadcasts retain their signature and are never offered as a
safe retry. Qortal's established `BAN_FROM_GROUP` and `KICK_FROM_GROUP` names
remain compatibility aliases for the same canonical actions, not new signing
capabilities.

### 2026-08-18 - feat(chat): add dual-chain avatar bridge parity

Home 2 now gives QDN apps dedicated account- and group-avatar reads on both
Qortium and Qortal, with one shared contract on desktop and Android. Qortium
uses the current on-chain account/group pointer when present and only falls
back to the established named thumbnail after an exact missing-pointer result.
Qortal resolves its established account and group thumbnail coordinates from
the requested chain without falling back to Qortium. Every result identifies
its network, returns bounded base64 instead of a node URL, caps the image at
500 KiB, validates raster magic bytes, and reports queued QDN content as a
retryable pending state.

### 2026-08-18 - feat(chat): add portable group participation

Home 2 now lets QDN apps request group joins and leaves on both Qortium and
Qortal from desktop or Android, using any node route that the platform can
configure: local, public, or custom on desktop, and public or custom on
Android. Qortium Core supplies signature-free transaction bytes that Home
checks field by field before locally computing proof of work and signing;
Qortal transactions are built locally from the frozen interoperability vectors
with a freshly rechecked reference and fee. Approval identifies the app,
account, chain, group, action, and route, and Home cancels if that context
changes. Already joined, already requested, and already left states are safe
idempotent results, while an uncertain signed broadcast retains its signature
and cannot be retried blindly. Joining does not silently create minting
authority; that remains a separate explicit operation.

### 2026-08-18 - feat(chat): add portable public chat revisions

Home 2 now preserves and verifies public-chat references while signing on both
desktop and Android. Qortium apps receive explicit edit, delete, and reaction
actions; Qortal apps receive its frozen Hub-compatible edit and reaction
actions. Home checks the selected chain, open group, original message, sender
ownership where required, app/account/route context, and exact payload before
prompting and again before signing. A broadcast whose final outcome cannot be
confirmed returns the signed transaction signature without offering an unsafe
retry. Qortal delete is a strictly validated, referenced empty Hub-v3 edit: it
clears the rendered content and leaves the immutable original and revision
transactions on-chain. Home does not substitute Reticulum's unrelated format.

### 2026-08-17 - test(chat): add dual-chain interop vectors

Home now reads Qortium Core's committed direct-message and private-group Chat
vectors from their exact pinned Core revision instead of keeping a second copy.
It also freezes independently generated Qortal Hub v3 fixtures for public
revisions and reactions, encrypted direct messages, private-group keys and
messages, group join and leave transactions, and resource descriptors. CI
checks the provenance, framing, signed bytes, signatures, and negative-case
definitions before later Home work adds any new Chat signing or encryption.

### 2026-08-17 - fix(android): update local notifications safely

Updates Capacitor's local-notifications plugin to 8.3.0 while preserving Home's
boot-only notification restore protection after the plugin moved its Android
receiver from Java to Kotlin. Installation still stops safely if a future
plugin release changes the guarded receiver unexpectedly, and a focused test
now verifies both the protection and the installed dependency source. Home's
immediate alerts also opt out of the plugin's new exact-alarm default, avoiding
an unnecessary Android system-settings prompt.

### 2026-08-17 - feat(chat): add route-aware Home 2 bridge discovery

Home 2 apps now receive a callable action list for their actual Qortium or
Qortal route instead of a fixed platform list. `GET_HOST_INFO` identifies the
invoked protocol, network, desktop or Android host, configured/effective route,
reachability, and an opaque revision that changes with relevant route or
account context. Desktop and Android deliver the same revision-change event so
apps can refresh their action list, and structured errors now preserve safe
action, network, retry, route, outcome, and target details across both bridges.

### 2026-08-17 - docs(chat): plan portable dual-chain Chat bridge

Adds the implementation roadmap for making public groups, private groups,
direct messages, revisions, reactions, participation, avatars, embeds, and
attachments work through both Qortium and Qortal nodes. Every milestone targets
Home 2 on desktop and Android across local/custom/public routes. The roadmap
keeps wallet keys and chat encryption inside Home, uses the completed Qortium
Core portability APIs, leaves Qortal Core unchanged, and keeps future
FreeChat-style General compatibility and Reticulum as distinct protocol work.

### 2026-08-16 - fix(core): preserve reward identity across managed updates

Before Home replaces or relocates a managed Core installation, it now securely
copies Core's existing reward-node identity from the replaceable Preview folder
into the persistent runtime folder. A valid runtime identity is always kept,
the legacy copy remains available for rollback, and unsafe, malformed, or
unreadable identity files stop the update instead of silently rotating the
node's reward identity. The same protection runs for same-version repair,
running and stopped Core upgrades, and migration from Home's older managed-Core
layout. Home also places the authoritative runtime identity into each replacement
candidate, so a deliberate downgrade to an older Core keeps the same identity.

### 2026-08-13 - Harden Home v2 app-grant identity binding + add chat-send rate limit

Home now binds an app tab's account and chat-send authority to the exact QDN
document that Home launched, closing the path where another app or resource
could try to reuse that grant. Chat sending also has the same safety ceiling on
desktop and Android: one send per tab and account every 1.5 seconds, with at
most 20 sends per minute, so an already-approved app cannot consume unbounded
proof-of-work or flood the network. One Android limitation is accepted and
tracked separately: an authorized document can load non-APP `/arbitrary` HTML
from other resources on its shared proxy origin, and that content can affect
the existing granted document when the navigation preserves its token-bearing
same-origin context. The other content receives no new token or grant, and it
cannot directly steal another app tab's grant.

### 2026-08-13 - feat: add Home v2 group and active-chats reads

The app bridge gains a group-browsing read family, unblocking group chat
browsing in the Chat 2.0 app. Apps can look up a single group, list a group's
members (optionally admins only), list the groups an address belongs to
(optionally owned or admin-only groups), and see a group's pending join
requests - by group, by the requesting address, or by an admin address. Apps
can also list an address's active chats (which groups and direct
conversations currently have messages). All of these are anonymous, no-key,
no-prompt public reads, the same as the existing name and asset lookups.
Group search (finding groups by name or description) ships on Qortium only,
because Qortal's node software has no matching search endpoint - this is a
genuine gap between the two networks, not a Home restriction, and Home
advertises the action only where it actually works.

### 2026-08-12 - feat: add Home v2 chat reads and send (Chat 2.0 Phase 1)

The app bridge gains its first chat family, on both Qortium and Qortal.
Reading: apps can search chat messages by group and fetch a single message by
signature. Chat search only supports group selectors in this release -
direct-message search is not available yet and returns a clear error instead
of quietly doing nothing. Sending: apps can send an open or group chat
message on either network. Home builds and signs the message entirely
inside itself - the app never sees keys or unsigned transaction bytes, and no
API key is sent to any node. On Qortium this reuses the existing keyless
build-then-sign path; on Qortal the message bytes are built, proof-of-worked,
and signed on the device, then broadcast, the same way ChibiHub's group chat
send already works today. Sending shows a permission prompt naming the
network, the group, and a preview of the message, with the same allow-once or
allow-for-this-tab choices as other account prompts. Qortal no longer accepts
general-chat transactions, so sending to group 0 there is refused with a
specific message; Qortium's general chat (group 0) is unaffected. The
selected account must already be unlocked to send - a Qortal-only app has no
way to trigger an unlock yet, which is a known and documented limitation
until direct messages and account handling catch up in a later phase.

### 2026-08-12 - docs: adopt the Chat 2.0 plan

Records the plan for the next-generation Chat experience that gates the Home
2.0 release: one Chat app working with Qortium, Qortal, or both, in every
node connection mode, with messages signed inside Home (private keys never
sent to any node), visible pending-then-confirmed message states, and file
sharing that can link an already-published resource instead of forcing a
republish. Documents why modern Qortal has no general chat channel and how
group chats and direct messages remain supported there. Plan only - no
application behavior changes.

### 2026-08-11 - feat: add block, transaction-search, and Qortal summary/price reads

The app bridge gains the remaining bounded public chain reads. FETCH_BLOCK
returns one block by exactly one selector (signature or height) instead of
the legacy behavior of silently preferring one or hanging on none.
FETCH_BLOCK_RANGE requires an explicit count and caps it at 100 blocks
because the node itself has no ceiling. SEARCH_TRANSACTIONS requires the
confirmation status to be spelled out (Qortal and Qortium default it
differently), validates transaction-type names and addresses, and enforces
the node's own search precondition before any request is sent. Qortal apps
additionally get GET_DAY_SUMMARY (24-hour chain activity) and GET_PRICE
(recent-trade price for a supported foreign blockchain); these two stay
Qortal-only because Qortium Previewnet public nodes do not expose their
routes. All results return the node's own JSON.

### 2026-08-11 - test: restore the Android QDN bridge smoke for the Home 2.0 shell

The Android real-device smoke had gone stale: it still looked for the old
Home 1.x address bar and account-request dialog, which the unified Home 2.0
shell replaced. It is rewritten to drive an already-installed build over adb
and Chrome DevTools Protocol the same way the desktop tab-bound permission
prompt smoke does, adapted for Android's differences -- accounts live only in
on-device app storage (there is no desktop-style vault bridge to call), and a
QDN app renders as a plain iframe with no snapshot capture step. It reuses an
already-selected test account when one is present, and only ever seeds a
disposable fixture account when explicitly told to, so it can never overwrite
a real profile by accident. It proves: the permission dialog binds to the
requesting app tab and marks the page with an overlay flag; switching to
Dashboard or to another open app tab is blocked while a request is pending,
with no reload of the requesting tab; Deny rejects the request; Allow-once
resolves it with the account payload; and no dialog appears once nothing is
pending. The smoke never installs, uninstalls, or reboots anything, and never
touches any package other than the one under test.

### 2026-08-11 - feat: add name-search, group, and AT public reads to the app bridge

QDN apps on both bridge protocols can now search registered names, list
groups, and read automated-transaction (AT) records through five new
read-only actions: SEARCH_NAMES, LIST_GROUPS, GET_AT, GET_AT_DATA, and
LIST_ATS. Each request is strictly validated before it reaches a node -
booleans must be real booleans (the legacy bridge accepted the string
"false" as true), pagination must use safe non-negative integers, AT
addresses and code hashes must be well formed, and the AT listing enforces
the node's own 100-entry page cap up front. A valid address whose AT does
not exist answers with one documented "AT not found." error on desktop and
Android alike instead of an ambiguous empty response. Results are returned
as the node's own JSON so existing Qortal apps see the shapes they expect.

### 2026-08-11 - chore: clean the last two strict TypeScript errors

Removes a stray duplicate React import in the browser chrome and copies the
fixed public-node list into the mutable settings field it feeds, so the full
strict TypeScript project check now passes with no errors. No behavior
changes.

### 2026-08-11 - fix: restore Home 2.0 node connectivity over verified HTTPS

Separates Home's offline renderer session from the privileged main-process node
bridge so the renderer still cannot contact the network directly without also
blocking every local and public node request. Desktop Local mode now connects
to Qortium and Qortal over HTTPS and safely learns each local Core's private
certificate authority over loopback before trusting it. Public connections
continue to use the named HTTPS endpoints, node errors retain their underlying
network detail, and an in-flight local API-key refresh can no longer overwrite
a newly selected connection mode while still adopting the replacement key after
a local Core restarts with a new one. A packaged AppImage smoke now verifies local
Qortium, public Qortium, public Qortal, the HTTPS endpoint display, and local CA
pinning through the production bridge.

Account-access and app-requested unlock prompts now stay attached to the QDN
app tab that requested them. On desktop, Home captures the isolated app view,
hides that native view only after the snapshot is painted, and shows the prompt
over the captured app rather than beneath it or on Dashboard. The requesting
tab remains active until the decision is made, then the live app view resumes
without reloading. When a background tab's app raises the request, the tab the
user was viewing is hidden correctly as Home switches to the requesting tab, so
the prompt is never covered by another app's native view. Switching pages or
tabs while a prompt is pending is refused up front instead of snapped back
afterwards, which on Android previously reloaded the requesting app's hosted
view and silently killed its pending request.

### 2026-08-10 - build: harden Home 2.0 production AppImages

Applies the proven Home 2.0 fixture security policy to normal Linux AppImages:
Electron can no longer run as Node or accept Node/inspector command-line
overrides, and the application loads only from its packaged ASAR. Production
archives also omit compiled tests and the offline fixture entrypoint. Every
Linux AppImage build now checks these fuses, the Home 2.0 package entrypoint,
required renderer and preload files, and the absence of test/fixture content
before it can complete successfully.

### 2026-08-10 - feat: make Home 2.0 the production account shell

Makes the browser-style Home 2.0 interface the normal Qortium Home application
on desktop and Android, upgrading under the existing product IDs rather than
installing a separate preview. Accounts are now shown as one encrypted wallet
with a separate address selector, and Home can create, import, export, rename,
unlock, lock, derive, and remove accounts or addresses through trusted Home UI.
An optional remembered unlock stores only device-wrapped key material; lock on
exit remains the default, and a manual lock always requires an explicit unlock.

Before Home 2.0 changes account state, it creates and verifies a curated profile
backup. Invalid stores or failed backup verification put account controls into
read-only recovery mode, with restoration applied on restart. Qortium apps may
request `UNLOCK_SELECTED_ACCOUNT`, but Home owns the visible password prompt,
rechecks the exact app, tab, account, and route before completing it, and never
returns private key material. Qortal apps do not receive this Qortium-specific
action. Signing, payments, publishing, broader bridge actions, Core lifecycle
UI, notifications, downloads, Reticulum, and release publication remain outside
this change. Packaged acceptance exercised a cloned production profile, strict
malformed-store recovery, the real desktop profile backup, and an in-place
Android code-36 to code-37 upgrade with a separately preserved pre-upgrade
preferences archive.

### 2026-08-10 - Home 2.0 read-only browser shell foundation

Establishes the accepted Home 2.0 direction as a warm, compact browser-style
shell with Dashboard as its landing page and QDN apps opening in familiar tabs.
Desktop and Android are co-primary preview targets. Qortal and Qortium have
independent Disabled, Local, Public, and Custom node modes; Home reports local
Core readiness, selects trusted synchronized public nodes, and keeps the active
endpoint visible. The Dashboard can resolve shared addresses across both chains,
show bounded public names and avatars, and enumerate saved account addresses
without exposing wallet secrets.

Complete `qdn://` and `qortal://` app addresses now open real public apps through
separate `qdnRequest` and `qortalRequest` protocols. Desktop uses sandboxed app
views and Android uses an isolated HTTPS proxy, with a bounded read-only action
catalogue, response-size limits, exact app-resource discovery, persistent tabs
and appearance settings, and the compatibility read currently needed by
Q-Tube. Packaged preview artifacts are isolated from the production profile,
and managed Core or i2pd processes no longer keep a closed Linux AppImage
mounted. This foundation still performs no production-profile migration,
account unlocking, signing, publishing, payments, private chat, or Reticulum;
those capabilities remain gated for later reviewed tranches.

### 2026-08-10 - fix: validate QDN asset read requests consistently

Makes the new asset-information, balance, and transfer reads use one shared
request-to-Core path contract on desktop and Android. A malformed or negative
asset ID is now rejected explicitly instead of being ignored and accidentally
broadening an address-balance query. Behavioral fixtures exercise the exact
Core paths and query values while parity checks keep both Home bridges on the
same validated implementation. No asset transfer, signing, or approval behavior
changes.

### 2026-08-10 - build(deps): refresh Home dependencies and CodeQL

Updates Home's icon library and WebSocket development tooling, and aligns the
Capacitor Android and command-line packages with the existing Capacitor 8.5.0
runtime. Home also pins the command-line tool's transitive UUID helper to its
patched compatible release. The CodeQL workflow moves to its latest compatible
patch release. These are maintenance updates only; they do not intentionally
change Home's features, account handling, network permissions, or release
behavior.

### 2026-08-06 - fix: make foreign wallet read failures actionable

Home's desktop and Android bridges now share one exact contract for the eight
current Bitcoin-family wallet read actions. Receive details expose only public
wallet material, while balance, information, and transaction-history requests
send only the wallet's extended public key to trusted Core. When Core cannot
reach a wallet-capable server, apps now receive the stable
`FOREIGN_WALLET_BACKEND_UNAVAILABLE` code with a useful coin-specific message
instead of Core's raw numeric JSON error. Mocked transport, private-key
exclusion, bridge-error, and dual-transport parity tests cover the behavior. No
send, prepare, signing, or broadcast behavior changed.

### 2026-08-05 - test: pin foreign wallet derivation vectors

Home's eight current foreign wallets now have fixed public test vectors for
their first receive address, root public key, and root private key. The vectors
match the separately preserved archived implementation, while independent
checksum, version-byte, and secp256k1 key-correspondence checks protect against
a shared serialization mistake. Extra Bitcoin vectors pin legacy wallet-version
and nonzero account-index behavior, and the test is part of the full suite. No
production key, network request, or send is involved.

### 2026-08-05 - feat: expose asset-aware Home wallet capabilities

QDN apps can now pass an optional `assetId` to `GET_BALANCE`, so the same
desktop and Android contract reads any existing Qortium asset rather than
silently dropping the requested ID. Invalid IDs are rejected before Core is
called, omitted IDs retain the existing native-default behavior, and explicit
asset `0` remains available on chains that actually create it. Blockchain
discovery now preserves Core's own support and enablement fields while adding
a separate fail-closed `homeWallet` view: QORT uses Home-signed public-node
transactions, the current eight Bitcoiny wallets require trusted Core for
sends, and Core-only or unknown chains are not presented as Home wallets.
Focused unit tests, desktop and Android read-only smokes, bridge documentation,
and a tracked coin-support matrix protect and explain the boundary. No funds
were moved and no send behavior changed.

### 2026-08-03 - chore(release): prepare home 1.6.3

Marks the version for the next preview release. Since 1.6.2, public-node
users get a clean read-only Chat experience instead of private-chat
controls that could never work there; the transport mode picker stopped
calling the combined mode an I2P "fallback" now that Core 1.6.3 keeps
both transports active; every move and delete in a managed Core update
tolerates transient Windows file locks, so an antivirus scan can no
longer break an update or its rollback; and the welcome setup guide is
restartable from Settings > Qortium Home or home://welcome. Bumped
package metadata to 1.6.3 and Android metadata to versionCode 36 /
versionName 1.6.3.

### 2026-08-03 - test: stop timing the Windows install-lock tests so tightly

The Windows file-lock tests proved their point with strict stopwatch
windows, and a slow shared CI runner failed one of them even though the
install update recovered exactly as designed (it took 7.8 seconds where
the test allowed at most 7). The lower bounds - which prove the retry
waiting actually happened - are unchanged; the upper bounds are now
generous and only catch a genuine hang.

### 2026-08-03 - feat: make the welcome setup guide restartable

Once the welcome guide was completed or skipped, opening home://welcome
again landed permanently on its final step, with no way back to the node,
connection, or account steps. Reopening a finished guide now starts it
over from the first step (a guide that is genuinely mid-way still resumes
where it left off), the final step gained a back button, and just looking
at the reopened guide changes nothing — it only records progress again
once a step is actually advanced. A "Restart setup" button in
Settings > Qortium Home now makes the guide easy to find without typing
the address.

### 2026-08-03 - fix: retry every Windows-locked move in the Core install path

A Windows user's automatic Core update failed with "EPERM: operation not
permitted" while the updater was setting the old install aside (issue
qortium-core#183). Home 1.6.2 already retries that first move when Windows
briefly locks files (typically an antivirus or search-indexer scan), but the
two later moves in the same update — putting the new Core into place, and
putting the old Core back if the update fails — did not retry, and neither
did the folder deletions. The restore move was the riskiest gap: one badly
timed lock there could leave the machine with no Core install at all. All of
these steps now wait out short-lived locks the same way, so a passing
antivirus scan can no longer break a Core update or its rollback.

### 2026-08-03 - fix: stop calling the combined transport mode an I2P "fallback"

The transport mode picker (on the Dashboard, in Settings, and on the Welcome
page) called its default option "Direct + I2P fallback". Since Core 1.6.3 the
combined mode is no longer a fallback: the node actively keeps connections
over both direct IP and I2P at the same time, always reserving a couple of
outbound slots for the second transport. The option is now called
"Direct + I2P" in every language, and the "Direct only" warning text was
updated to match. No behaviour changed — this is wording only.

### 2026-08-03 - fix: stop advertising private chat actions on public nodes

When Home is connected to a public read-only network node, apps that ask Home
which actions are available (SHOW_ACTIONS) were still told the private
direct-chat and private group-chat actions work. Those actions need to send
the account's private key to a local trusted node, so using them on a public
node always failed with a "public read-only" error — for example, opening a
direct message in the Chat app. Home now leaves those actions out of the list
on public nodes, so apps like Chat show their clean read-only state instead
of offering controls that cannot work.

### 2026-07-30 - chore(release): prepare home 1.6.2

Marks the version for the next preview release. Since 1.6.1, QDN apps can ask
Home to open any public resource in the shared viewer and request host-safe
inline media URLs, with Android streaming that traffic through the authorized
secure proxy — embedded audio and video are now seekable on Android, and
streamed responses stay open through end-of-file so previews and playback no
longer stall. Apps receive the measured size of delivered avatar bytes on both
desktop and Android, can ask which platform they are running on, and a missing
app favicon falls back quietly instead of retrying for a minute. On phones the
browser chrome folds into a slim strip while an app is open and the keyboard
no longer covers typing areas. Managed Core updates treat replacing the
stopped installation as a rollback-aware transaction that preserves the
known-good backup, give Windows a bounded retry window while the old install
directory is still busy, and show a concise message instead of raw HTML when
an update check fails.

### 2026-07-29 - fix(android): make embedded QDN media playback seekable

Android QDN apps can now play and seek embedded audio and video through Home's
secure render proxy. Home supplies a restricted, non-scriptable media MIME hint
when Core omits `Content-Type`, leaves binary responses without a character
encoding, and maps Core's partial-response offset into WebView's own range seek
so the native loader does not seek the same byte offset twice. Stream completion
also remains stable when `HttpURLConnection` closes its fixed-length body on
the final byte.

Acceptance uses a one-minute, low-bandwidth VP8 WebM fixture with explicit CDP
timeouts so an emulator failure cannot end the run as a false pass. The fixture
generator can publish it independently under the established QortiumHomeTest
test name.

### 2026-07-29 - fix(core): preserve managed installs when update rollback fails

Managed Core updates now treat replacing the stopped installation as one
rollback-aware transaction. If the new Core cannot be activated, Home restores
both the previous files and their matching installation record before trying
to restart it. If Windows prevents that restore, Home retains the known-good
backup for manual recovery instead of deleting it during cleanup. GitHub now
also runs the production transaction on Windows with genuine temporary and
persistent exclusive file locks, covering automatic retry, bounded failure,
metadata restoration, and backup preservation.

### 2026-07-29 - fix(android): keep streamed QDN responses open through EOF

Android's secure QDN proxy now leaves an image, sound, or video response open
after the reader first reaches the end of the file. Android WebView can inspect
the response again before closing it; closing at the first end-of-file signal
made that valid follow-up fail and could surface as a broken inline preview or
stalled playback. WebView still closes and disconnects the upstream response
when it is finished, and focused tests cover both single-byte and buffered
reads through end of file.

### 2026-07-29 - feat(qdn): add app-neutral resource viewing

QDN apps can now ask Home to open any public, non-app resource in Home's
shared viewer, so images, sound, video, documents, text, structured data,
galleries, archives, and repositories no longer need app-specific handoff
contracts. Apps can also request a host-safe URL for inline image, audio, or
video playback; on Android, Home keeps that traffic on its authorized secure
QDN proxy and streams large responses without loading the whole file into
memory, while preserving byte ranges for seeking. Apps and websites continue
to open as browser content, the older media and document actions remain
available, and both new actions work in public-node mode without exposing an
API key.

### 2026-07-29 - fix(qdn): quiet missing app favicon fallbacks

Home now treats a missing `favicon.ico` inside an otherwise ready QDN app as
the expected optional-file result it is, so Electron no longer repeats noisy
bridge errors or retries the same absent icon for a full minute. The miss is
remembered only for that exact QDN publication revision, so a newly published
favicon is discovered normally. Apps still fall back in the same order from
their own favicon to the publisher's avatar and then a name-based monogram,
while oversized files and every unexpected QDN failure remain visible.

### 2026-07-29 - fix(core): retry Windows install moves and sanitize update errors

Home now gives Windows a short, bounded retry window when a recently stopped
managed Core still has its install directory busy, instead of abandoning an
otherwise valid update on the first `EPERM`, `EBUSY`, or `EACCES` rename
failure. Cross-drive moves keep their existing safe copy-and-remove fallback,
and non-Windows filesystem errors still fail immediately. Core's update
endpoint can also return a server or proxy HTML error page when something
unexpected fails; desktop and mobile update checks now replace that markup
with their existing concise update-failure message rather than exposing raw
HTML to the user.

### 2026-07-29 - fix: measured avatar sizes, mobile chrome reclaim, host platform signal

Applies the four Home-side fixes from the 2026-07-29 Qortium Chat delta audit.
Avatar requests from apps now report the exact size of the image bytes
actually delivered instead of trusting a network header that can go stale when
a connection compresses the transfer — previously that mismatch could make
apps silently discard valid avatars; fixed identically in both the desktop and
Android bridges. On Android, the app view now resizes when the keyboard opens
so typing areas stay visible instead of being covered. On phones, the browser
bar folds into a slim strip while a QDN app or website is open — a tap brings
back the tabs, address and account controls — and the small app version badge
now fits inside the slim status strip instead of doubling its height; desktop
layout is unchanged. Finally, apps can now ask Home whether they are running
on desktop, Android or iOS so they can adapt their layout to the device.

### 2026-07-28 - fix(android): keep the QDN bridge working through the secure proxy

Restores communication between published QDN apps and Home on Android after
the secure in-app address for QDN pages was introduced. Home now sends messages
to, and accepts messages from, the secure address actually loaded in the phone's
viewer instead of the public node address behind it. This covers app requests
and responses as well as account, display, manager, navigation and app-target
events, so public-network apps keep their normal Home bridge while their own
images, sound and video continue to load securely.

### 2026-07-28 - chore(release): prepare home 1.6.1

Bumps Qortium Home to 1.6.1 with Android versionCode 34 for the next preview
prerelease. Since 1.6.0, Home gained local signing and approval for plain
messages to Qortium contracts; user-selected QDN apps can now fill generic
Home roles; browser-deliverable GAME archives run in the same isolated view as
apps and websites; and published games load their bundled images, sound and
video correctly on Android. QDN browsing, bookmark management and Git
repository browsing now hand off to their dedicated QDN apps while exact
resources, previews and shared document/media viewing remain in Home. The
document viewer keeps each reader with its own tab and starts every new page or
chapter at the top. The release also adds consented previewing of a selected
publish source, expands real desktop/phone acceptance coverage, keeps remote
API keys off plaintext connections, and removes the retired native managers
and Git parsing dependency.

### 2026-07-28 - feat: hand Git repository browsing to Explore

Home no longer contains its own Git repository viewer. The published Explore
app now offers the same repository browsing — branch selection, commit
history, and per-commit file trees with previews — so Home's built-in copy
was removed along with the Git parsing library it bundled and the install-time
hardening patch that library needed. Opening a published Git repository in
Home now shows the plain published-file view, and Explore is the place to
browse it as a repository. This removes around seven hundred lines and a
dependency from Home without changing any other viewer behaviour.

### 2026-07-28 - fix: reset document viewer scroll position on page turn

Turning a page in a PDF, comic book, text document, or EPUB now starts the
new page at the top. This also applies when choosing an EPUB chapter from its
contents list, so the reader does not carry a previous page's scroll position
into the new one.

### 2026-07-28 - test(android): accept a real GAME archive on a phone

Adds a phone acceptance run for the GAME service, matching the desktop one. It
uses the public Previewnet network option with no account, no key and no custom
node, opens a published game, and requires the game to start, show its bundled
pictures, and respond when one of its own buttons is pressed.

Running it on a real phone found a problem worth fixing first: the game started
and played, but none of its pictures appeared. Anything a published page loaded
from the network over an insecure address was blocked inside the phone app,
because the app itself is served securely. Sound files were blocked the same way.
Only pages that fetch their pictures through Home's own bridge — which every
first-party app does — were unaffected, which is why this had never shown up
before.

Published pages are now served to the phone through a secure in-app address
instead, so their own pictures, sound and video load. That address is kept
separate from Home's own, so a page still cannot reach into the application, and
it stays the same for a given node, so an app keeps anything it saved locally
between visits. Only the node Home is connected to is served this way.

### 2026-07-28 - test(desktop): accept a real GAME archive in the running app

Adds a desktop acceptance run for the GAME service. Home already treats a
browser-deliverable GAME archive like an app, but until now only its internal
logic was checked; nothing confirmed that a real published game loads and plays
inside the running application. The new run opens a published game from the
network, waits for it to start, confirms every picture bundled with the game
appears, and then presses one of the game's own buttons and requires the game to
respond. A game that loaded but did nothing, or one whose artwork failed to
appear, now fails the run instead of passing quietly.

When the run cannot find the game, it now reports what the application was
showing instead, so a problem names its cause rather than only timing out.

### 2026-07-27 - test(android): cover generic QDN app assignments

Clarifies that choosing a Notifications app is only a local launch preference;
each app still needs its own user-approved notification-management access. The
retired manager-role translation labels are gone. The Android bridge smoke now
starts cleanly after Welcome, recognizes current QDN render URLs, and proves on
a real phone that a QDN app can receive approval to read assignments, set a
custom assignment to an Explore video route, and read that saved target back.

### 2026-07-27 - feat(bridge): preview a Home-selected QDN publish source

QDN publishing apps can now ask Home to preview the exact file or folder the
person previously selected through Home's own picker. The app receives only a
success signal: Home keeps the temporary Core render URL and local path private,
opens the preview in its own display-only overlay, and does not give that
preview a QDN bridge. The opaque source token remains tied to the same app tab,
expires automatically, works only with a local Core, and remains available for
the later consented Publish request on both desktop and Android.

### 2026-07-27 - refactor(qdn): remove retired Home managers

Home no longer carries its old full-page Bookmarks manager or its built-in QDN
resource-listing Explorer. `home://bookmarks`, even if an old local preference
is damaged, now safely opens the official Bookmarks app; the bookmark star,
toolbar links, Dashboard pins, start pages, and the existing consented
Bookmarks bridge remain in Home. QDN list addresses and restored list tabs
continue to open Explore, while the small Home-owned local-content Preview tool
is now a separate native launcher. Its Android smoke test follows
`home://preview`, the route people actually use, rather than the retired list
page.

### 2026-07-27 - feat(qdn): run browser-deliverable GAME archives

QDN GAME resources with a normal web-game entry page can now open in the same carefully isolated browser view as apps and websites on desktop and Android. This is a browser-only path: it does not launch native game files, and it does not give games any special manager access. Home can also publish a zipped web-game archive in the same unpacked form the QDN renderer expects; an archive without a usable web entry page still fails safely instead of gaining a native-launch path.

### 2026-07-26 - feat(qdn): move QDN browsing into Explore

The Dashboard's Browse QDN button and the four partial QDN addresses used for browsing now open the published Explore app instead of Home's built-in resource browser. This includes old saved, duplicated, and restored tabs, so an existing `qdn://`, service, wildcard-name, or name/service listing follows the same route automatically. Exact QDN resources still stay in Home's viewer, which continues to host apps and provide the shared document and media readers that Explore asks for. Local unpublished-content Preview also remains available from the Dashboard as a small Home tool while its eventual Publish integration is designed.

### 2026-07-26 - feat(bookmarks): route Home manager links through QDN

Moves the full bookmark-manager entry point out of Home without moving anyone's
saved data. Choosing "Manage bookmarks" now opens the Bookmarks Manager app
selected in Settings, and old `home://bookmarks` links follow that same choice
instead of stranding people on Home's built-in manager. The familiar bookmark
star, toolbar links, Dashboard pins and start pages still belong to Home and
continue to work exactly as before. The old page remains inside the build as a
careful recovery fallback for a damaged local preference; removing it is a
later, separate compatibility step.

### 2026-07-26 - feat(bridge): add consented QDN contract messages

Lets a QDN app ask Home to send a plain `MESSAGE` transaction to a Qortium AT,
which is the transaction type used to wake a contract such as the SMPL faucet.
It is deliberately narrow rather than a general signing tool: Home accepts only
a checksummed AT address and a short text message, fixes the transaction to no
payment and zero fee, shows the recipient and message in a one-time approval,
then performs the required MemoryPoW and signing locally. The app never sees a
wallet key, and Home never sends one to a node; it broadcasts only the signed
transaction after approval. The same contract is available on desktop and
Android, including through a public Previewnet node because signing remains
local.

### 2026-07-23 - fix(bridge): distinguish legacy avatar hints from pointer avatars

Clarifies the account-avatar contract for QDN apps before they adopt the new
pointer-based actions. The older selected-account and batch-identity responses
continue returning their named-thumbnail URL for compatibility, but now label
it explicitly as a legacy hint; it does not claim that the resource exists or
that it is the account's current on-chain avatar. Apps can keep batching names
without downloading hundreds of images and use the bounded
`FETCH_ACCOUNT_AVATAR` action for pointer-aware images shown on screen.

### 2026-07-23 - fix(node): keep remote API keys off plaintext connections

Prevents desktop and Android Home from sending a configured API key across an
unencrypted connection to a node on another machine. A custom node address
entered without a scheme now defaults to HTTPS unless it is a loopback address,
which continues to default to HTTP. Home also withholds the key when a remote
HTTP URL was entered explicitly and refuses protected node operations until the
user chooses HTTPS and confirms the node's certificate. This closes the gap
where certificate confirmation did not apply to plaintext connections at all.
### 2026-07-23 - fix(avatars): follow Core's resource-pointer contract

Aligns Home's new account and group avatar bridge with Core's final on-chain
format before the feature ships. An avatar assignment now stores a plain QDN
resource pointer — service, registered name and optional identifier — instead
of freezing one publication by transaction signature. The pointed resource can
belong to any registered name, does not need to exist when assigned, and always
shows its latest revision; Core still checks that served content is a supported
raster image no larger than 500 KiB. Desktop and Android now send that pointer,
accept an empty identifier for a default resource, and report `POINTER` rather
than `AUTHORIZED` provenance to apps. The bridge documentation and tests cover
the same contract.

### 2026-07-23 - chore(release): prepare home 1.6.0

Bumps Qortium Home to 1.6.0 with Android versionCode 33 for the next preview
prerelease. Since 1.5.2 the app gained the ability to publish to a Qortium Core
running on another machine — including from Android — by streaming the file
bytes to the remote node rather than handing it a local path, with a manual
certificate confirmation step before a remote node is trusted and a requirement
that the connection use TLS before any unattested publishing. It also verifies
managed Java downloads before use, adds a bridge for pointer-based account and
group avatars to match Core, consolidates the QDN Apps settings (app
permissions, preferred apps, notification controls and the bookmark manager)
into one place, shows which tab is playing sound and lets you mute it, and
tidies the QDN service handling behind the scenes (a single loading panel, one
shared request path, one base58 codec, and a drift guard that keeps Home's
service list in step with Core's).

### 2026-07-23 - feat(node): confirm a remote node's certificate by hand before trusting it

Until now there was no safe way to reach a node on another machine over an
encrypted connection. A Qortium node makes its own security certificate, and
nothing outside that machine vouches for it, so Home had no way to tell the real
node's certificate apart from one someone on the network had substituted. The
old shortcut — asking the node over an unencrypted connection which certificate
to trust — was removed earlier, because whoever answered that question got
trusted permanently and got the node's API key with it. That left encrypted
remote nodes simply unreachable.

They are reachable again, on one condition: you check the certificate yourself,
somewhere the network cannot interfere. Point Home at a custom node whose
address starts with `https://` and Settings → Node Settings now shows a
Certificate panel. It shows the fingerprint — a long string of characters unique
to that one certificate — of whatever the node offered. Below it is a command to
run on the computer where the node is running, which prints the same fingerprint
from the node's own side. Compare the two character by character, and press
"Fingerprints match" only if they are identical. Never accept a fingerprint
someone sent you in a message; the whole point is that it comes from the node
itself.

Until you do that, nothing changes: Home refuses the connection and never sends
the API key, exactly as before. Once you do, Home trusts that one certificate on
that one node address, and the connection works — including the larger
publishing limit that needs an API key. If the node ever presents a different
certificate, Home stops and says so rather than carrying on. That happens
normally when a node's certificate is renewed, in which case check the new
fingerprint on the node and confirm it again, but it is also exactly what an
interception attempt looks like, so it is worth a second look. There is a
"Forget this certificate" button if you want to start over.

Nodes running on your own computer are completely unaffected — there is no
network in between for anyone to interfere with, so they keep working with no
extra step — and so are unencrypted connections, which have no certificate to
check in the first place.

A second security review tightened two things before this shipped. Forgetting
or replacing a certificate now also clears what the browser engine had cached
about it and drops the open connections, so the old certificate stops being
accepted right away instead of lingering until Home restarts. And the
confirm/forget controls now double-check, inside Home's core process, that the
request really came from Home's own settings window — the same check Home
already applies to other sensitive settings — rather than relying only on QDN
apps having no button for it.

### 2026-07-23 - fix(qdn): revive the QDN service drift guard against Core's catalogue

Home only opens a fixed list of QDN content types (images, videos, blogs, apps
and so on). A check exists to make sure that list still matches what the node
actually offers, so a content type the node renames, drops, or turns into an
encrypted one cannot quietly stop working in Home. That check had been broken
since an earlier tidy-up moved the list to a new file: it went looking for the
list where it used to live, found nothing, and gave up before it ever contacted
a node. Nothing noticed, because the check needs a running node and so is not
part of the normal test run.

It has been rebuilt in three parts. The half that needs no node at all — is the
list sensible, does it repeat itself, does it contradict Home's own rule for
spotting encrypted content types — is now an ordinary test that runs with every
other test, so it cannot rot unnoticed again. The half that does need a node now
reads the real list from Home's built code instead of trying to read it out of
the source text, which is what let it break silently in the first place. And the
comparison between Home and the node is now separately testable against made-up
node answers, so it can be proven to catch a problem without waiting for a real
node to misbehave.

The check also got more useful. It used to compare Home's two copies of the list
against each other; there is only one copy now, so that comparison could never
fail and was doing nothing but looking like protection — it has been removed. In
its place is a real question: the node states outright which content types are
encrypted, while Home guesses from the name. If those two ever disagree, Home
could try to display something it cannot read, or refuse to open something
anybody can. The check now compares the two across everything the node offers
and names whatever disagrees. Content types Home deliberately does not offer are
still only listed as a note, not treated as a problem.

### 2026-07-23 - refactor(qdn): stop importing the same base58 conversion twice

Tidy-up left over from the earlier base58 consolidation. Both of Home's QDN
routes were reaching for the shared text-conversion helper twice in the same
file: once directly, and once through the code that builds Qortal transactions,
under a second name. It was the same helper both times - confirmed by loading
both and checking they are literally the same thing - so the second name was
only ever a leftover that made the four places using it look like they were
doing something different from the rest of the file.

The second name is gone and those four places now use the direct one. The
transaction-building code still offers the conversion to anything that asks for
it, because three other parts of Home still do. Nothing about how Home behaves
changes; the tests that check signed transactions come out byte for byte as
expected all pass untouched.

### 2026-07-23 - refactor(qdn): decide once which QDN services Home will open

Every QDN address names a service: whether you are looking at a website, an
image, a video, a blog post, a file. Home only opens the public ones. Some
services on the network are encrypted, and Home cannot yet read those, so it
turns them away with a message that says so rather than a confusing "unknown
service" error.

That decision was being made twice, once for each of the two routes Home uses to
talk to QDN apps: the desktop one and the browser/Android one. Each route had its
own list check and its own way of spotting an encrypted service. The two happened
to agree exactly — they were compared character by character before anything was
moved — but this was the fourth time these two routes had been found holding
separate copies of the same rule, and this particular rule is the one that decides
what Home will and will not open. Two copies of that is one careless edit away
from the desktop app and the Android app disagreeing about what is safe to show.

There is one copy now, and both routes ask it. The same move also freed up the
rule that reads a publish request — which service, which name, which description
— so that is now shared too, instead of being maintained twice.

Nothing about how Home behaves changes: the same services are accepted, the same
ones are refused, and the wording of both refusal messages is unchanged. A new
test covers the shared rule directly — every public service is accepted, every
encrypted one is refused with the encrypted-service message, anything unrecognised
is refused with the other one — and it also reads both routes to make sure neither
has quietly grown its own copy again.

### 2026-07-23 - refactor(electron): finish consolidating the base58 copies

A previous change gave Home a single shared home for the base58 conversion it
uses whenever raw data has to be written as text, and pointed both of its QDN
routes at it. Looking further afield, the same conversion turned out to be
written out three more times: once in the part of Home that stores and unlocks
your wallet file, once in the code that builds Qortal payment and chat
transactions, and once in the code that works out your Bitcoin, Litecoin,
Dogecoin and other foreign-coin addresses.

All three were checked character by character against the shared version first,
and all three matched it exactly. They have now been deleted, and those parts of
Home use the shared conversion instead. That is five copies reduced to one, on
paths where a stray difference would mean a rejected transaction, a wallet file
that will not unlock, or a foreign address that quietly belongs to nobody.

The code that builds Qortal transactions still offers the conversion to anything
that asks it for one, so nothing that depended on it had to be changed. Two
lists of the base58 characters were left where they are: one belongs to the code
that generates the node's local API key, which has nothing to do with
transactions and should not be tied to them, and the other sits beside a lookup
table that is written differently enough that leaving it alone was the safer
call.

Nothing about how Home behaves changes. The existing tests all pass untouched,
including the one that checks the conversion against a second, deliberately
different implementation, and the fixed examples that check the Qortal payment
and chat transactions come out byte for byte as expected. The foreign-coin
addresses, which had no test of their own, were generated from the same seed
before and after the change and came out identical for all eight coins.

### 2026-07-23 - refactor(qdn): keep one copy of the base58 codec

Qortium writes a lot of things — addresses, public keys, signatures, whole
transactions — as base58 text: a compact way of writing raw data using digits
and letters, with the easily-confused characters (zero, capital O, capital I,
lower-case l) deliberately left out. Every time Home signs or sends something,
it converts back and forth between that text and the raw data underneath.

The two routes Home uses to talk to QDN apps — the desktop one and the
browser/Android one — each carried their own private copy of that conversion.
The copies matched, but they sit on the path where transactions are signed, and
that is the last place two copies should be left to drift: a difference of a
single character in one of them would produce a signature the network rejects,
or worse, quietly sign the wrong bytes, and only on one of the two platforms.

The conversion now lives in one shared place that both routes use, along with
the small helper that takes the signature off the end of a signed transaction.
Nothing about how Home behaves changes; it is the same code, simply no longer
written down twice. It also now has a test of its own, which checks the
conversion against a second, deliberately different implementation across more
than a thousand cases — including empty input and the leading-zero cases that
hand-written base58 most often gets wrong — and confirms that anything converted
one way comes back unchanged the other way.

### 2026-07-23 - refactor(qdn): read QDN app requests from one shared place

Home talks to QDN apps over two different routes: one on the desktop app, and
one in the browser/Android build. Both routes have to understand exactly the
same requests from an app — the same field names, the same "either of these two
spellings will do" fallbacks, the same rules for what counts as a valid amount,
group, address, or fee, and the same wording when a request has to be refused.

Until now each route carried its own private copy of all of that. Nothing was
wrong with either copy, but keeping two of them in step is guesswork: a fix or
a tightened rule had to be remembered twice, and on three separate occasions the
two copies had already quietly stopped matching. When that happens, the same app
sending the same request can be treated differently on desktop than on Android,
which is the kind of difference nobody notices until it causes a problem.

That shared understanding of a request now lives in one place that both routes
read from, so the same logic no longer exists in two copies that could drift
apart. Nothing about how Home behaves changes — the rules are identical to the
ones already shipping, they are simply no longer written down twice. A few
pieces stayed where they were on purpose: anything that depends on how one
particular route holds on to a file you are publishing has to stay with that
route, and one check that genuinely reads differently on each side was left
alone rather than quietly merged, so that difference can be looked at on its
own.

### 2026-07-22 - feat(settings): say what a custom node address means for publishing

The previous entry changed which node addresses get Home's higher-capacity
publishing, but the node settings screen still said nothing about it. You could
type an address, save an API key, and have no way of knowing that publishing had
quietly moved to the smaller, more carefully checked path — or why.

The custom node URL field now explains itself as you type. A node on your own
computer says so, and that publishing has no extra limits. An encrypted address
with an API key saved says publishing can use that node's full size limit. An
unencrypted address says the connection is not encrypted, that uploads are
therefore checked independently and limited to a smaller size, and that using an
`https` address instead unlocks the full limit. An encrypted address with no API
key yet says what is missing.

An empty or half-typed address says nothing at all, so the field stays quiet
while you are still working on it. Nothing about how Home publishes changed
here — this only puts the existing behaviour in front of you, in every language
Home is translated into.

### 2026-07-22 - fix(qdn): only trust a remote node with unverified publishing over an encrypted link

Tightens which remote nodes Home will publish through without a second check on
what was uploaded.

When Home publishes through a node you configured yourself and gave an API key
to, it can use that node's full publishing capability — no size ceiling beyond
what the node itself allows. The trade-off is that this path has no independent
verification step afterwards: nothing re-checks that the node stored exactly the
content Home sent it. On an encrypted connection that is a reasonable trade,
because the only party who could swap the content is the operator of the node you
already chose to trust with your API key.

On an unencrypted connection it is not, because anyone able to see or alter
traffic between you and that node could substitute the content instead, and
nothing afterwards would notice.

So that capability now requires an encrypted (`https`) connection. A remote node
reached over plain `http` keeps working exactly as before — it simply uses the
publishing path that independently verifies the uploaded content, which caps
uploads at the smaller public limit. Nothing stops working; the unverified,
higher-capacity path is just no longer offered over a link that cannot protect it.

Nodes on your own machine are unaffected, encrypted or not: there is no network
path between Home and a node on the same computer for anyone to sit in.

### 2026-07-22 - fix(qdn): let Android publish to a Qortium Core on another machine

The previous entry fixed publishing to a node somewhere other than your own
machine, but only in the desktop application. On Android the same publish still
failed, and in the most frustrating way possible: the work happened, the phone
spent its time on it, and only at the very end did it give up with a message
about the signing context having changed. Nothing had actually changed. The
last-moment safety check only recognised the shared public network, so a node
you had entered by address yourself was never accepted, however settled the
connection was.

Android now asks the same question the desktop asks, using the same code rather
than its own copy of it, so publishing from a phone to your own node works. The
check is also stricter than the one it replaces: it notices if the node is
swapped for a different one while the phone is working, and it notices if the
node stops being one you hold an API key for. Either of those still stops the
publish, as they should.

Sharing the code is as much the point as the fix is. The desktop and the phone
had quietly grown two different answers to the same question, which is how this
was missed for a release. A test now fails if either of them goes back to
answering it alone.


### 2026-07-22 - fix(qdn): publish to a Qortium Core on another machine

Publishing to QDN only worked when Qortium Core was running on the same machine
as Home. Pointed at a node somewhere else — over an SSH tunnel or on a server —
the publish failed, and the node's log complained that it could not find a file
at a location that only exists on your own computer.

That was exactly what was happening. For most kinds of resource Home was not
sending the file at all: it was sending the file's *location* and leaving the
node to go and open it. A node on your own machine can do that, because it is
looking at the same disk you are. A node anywhere else looks in the same place,
finds nothing, and gives up. Websites and apps were the exception — those were
already sent properly — which is why the problem looked so arbitrary.

Home now sends the file itself in every case, for every kind of resource,
whether you picked a single file or a whole folder. The node is never told
where anything lives on your computer. Publishing several resources at once
works the same way; it had never been able to send files at all before this.

Connecting straight to a node by its address failed for a second reason, and
that is fixed too. Home was treating any node not on this machine as a stranger
it should assume nothing about, including one you had entered yourself and
given an API key to — and the safety check it ran just before submitting was
written for strangers only, so publishing to your own server was refused at the
last moment with a message about the signing context having changed. Home now
recognises three kinds of connection rather than two: a node on this machine, a
node elsewhere that you have given an API key, and an unknown public node. Your
own remote node gets the same publishing allowances as a local one, including
the much larger size limit, while the signing still happens on your computer
and your account key is never sent anywhere. Genuine mid-publish changes — a
different node, or one that stops being yours — still stop the publish.

### 2026-07-22 - fix(security): verify the Java download and stop trusting a remote node's certificate on faith

Closes two ways someone sitting between you and the internet could have taken
control of Home.

The first is the Java runtime. Home can install Java for you, and that copy of
Java is what actually runs your Qortium node — so whatever is inside that
download gets to run on your machine. Home was downloading it without ever
checking that what arrived was what Adoptium (the people who publish Java)
actually sent. Anyone able to interfere with that download could have replaced
it with something of their own. Home now asks Adoptium for the download link
and the official fingerprint of that exact file together, checks the finished
download against that fingerprint, and throws the file away if it does not
match. If Adoptium does not publish a fingerprint, Home refuses to install
rather than installing something it cannot check.

The second is custom node connections. When you point Home at a node over a
secure (https) address, the node may be using a certificate it issued itself,
so Home has to be told which certificate to expect. Home was asking the node
for that over an *insecure* connection — and remembering the answer forever,
along with sending your node's API key in the clear. For a node on your own
machine that is harmless, because nothing sits in between. For a node across
the internet it meant whoever was in the middle could hand Home their own
certificate, be trusted from then on, and read your API key on the way past.
Home now only does that insecure exchange for a node on this machine. For a
remote secure node it does not do it at all, does not send the API key, and
writes a plain explanation to the log saying the node needs a certificate this
machine already trusts.

Both fixes are covered by tests, including tests that fail if either
protection is removed again.

### 2026-07-22 - fix(qdn): repair broken transaction actions and hide raw node error pages

Fixes six app actions that could not work at all: updating a name, selling a
name, cancelling a name sale, buying a name, transferring an asset, and setting
your default group. Each one failed, and what the app showed you was a page of
raw web-page code instead of a message.

Two separate problems were behind that.

The first is that Home was sending the node one extra piece of information it
could already work out for itself — the kind of transaction being built. For
these six kinds the node cannot currently make sense of being told, so it gave
up before it even looked at the rest of the request. Home now leaves that out
everywhere, which is what the node expects, and a test makes sure it cannot
creep back in. The same oversight would have broken the next action anyone
added in the same style.

Desktop and Android build these requests through separate code, and both had
the problem, so both are fixed and both are covered by that test. Fixing only
the desktop side would have left every phone still broken.

The second is that when the node replies with something that is not a real
error message — an error web page, or a page from a proxy sitting in front of
it — Home passed that straight through for you to read. Home now recognises
those and shows the clear message the app already provides, such as "Update
name transaction build failed.", while still passing genuine node error
messages through unchanged so nothing useful is lost. This is applied to every
place Home reads a failed reply from a node on either platform — app requests,
uploads, resource authorization, node settings and status, wallet balance and
fee lookups, and the document and media viewer — not only the one place where
it was first noticed. A test pins each of those paths so a later edit cannot
quietly go back to showing the raw reply.

The node-side fault behind the first problem is tracked separately as
qortium-core#148.

One honest caveat: on the current Previewnet chain, sending the native coin has
a second, unrelated obstacle on the node side, so asset transfer still will not
complete there. What changes for it here is that it now fails with a clear
message from the node instead of a page of markup.

### 2026-07-21 - fix(tabs): make the tab mute button clickable

Makes the little speaker on a noisy tab work when you click it. The tab strip
was treating that click as the start of a drag, so the speaker never got to
mute anything and could unexpectedly bring that tab to the front instead. It
now behaves as a separate control: a background tab keeps playing in the
background while its speaker mutes or unmutes it. The desktop browser check now
uses a real pointer click on a background audible tab, so this exact interaction
cannot quietly break again.

### 2026-07-21 - feat(settings): merge app permissions and preferred apps into one QDN Apps section

Replaces the separate "QDN app permissions" and "Preferred apps" sections of
Settings with a single "QDN Apps" section, because they were really one idea:
each Home job (managing bookmarks, managing notifications) is a role that only
one app can hold at a time. Before, you could point the Bookmarks Manager menu
at one app while a different app still quietly kept permission to manage your
bookmarks; that confusing state is now impossible. The new section shows one
row per role with the chosen app's address, whether it currently has access
and since when, and a Revoke button. Typing a new address there counts as
choosing that app, so it gets access right away; revoking removes the access
but keeps the app as your menu choice, and Bookmarks Manager can always be
reset to the official Bookmarks app. When a QDN app asks for a role another
app already holds, the approval dialog now says which app would be replaced.
Existing choices and permissions are carried over automatically the first time
the new version runs, always erring on the side of fewer permissions, and the
old settings storage is cleaned up. Only Home's own Settings window can change
these role choices — embedded QDN apps are refused outright, the one-time
carry-over cannot be replayed later to change them, and a garbled stored
"granted" date now counts as not granted rather than granted.

### 2026-07-21 - feat(settings): let people choose the app that manages bookmarks

Adds the first entry in a new Preferred apps section of Settings. Bookmarks
Manager now defaults to the official Bookmarks QDN app, but people can replace
that address with another QDN APP or WEBSITE resource on their device. Home
checks and tidies the address before saving it, and the Bookmarks Manager menu
opens the chosen app in a tab instead of the built-in manager page. This is a
local preference only: QDN apps cannot set it remotely, and the shared saved
links data and the permission bridge stay exactly as they were.

### 2026-07-21 - feat(qdn): name the error when a bookmark address is not supported

Gives bookmark manager apps a clear, machine-readable answer when they try to
save or open an address Home does not support. Home already refused such
addresses, but the refusal was a plain message that an app could only show
verbatim. The refusal now also carries the error code `INVALID_ADDRESS` — the
same pattern as the existing `HOME_DATA_STALE` code — so an app like Bookmarks
can recognise the situation and show its own translated "that address is not
valid" message instead of raw English error text. New checks confirm every
kind of saved link (bookmarks, toolbar links, dashboard pins, start pages, and
the open-a-bookmark request) rejects unsupported addresses with this code, and
those checks were confirmed to fail before the change was made.

### 2026-07-21 - test(updates): drive the real app to check update status after installing

Adds an automated check that the update status people actually see is correct,
on both desktop and Android. It runs the real application, tells it an update
has already been downloaded and installed, and confirms the app then says "Up
to date" with no leftover "Show file" or "Install APK" button — the problem
fixed earlier the same day. It also checks the opposite case, that an update
which genuinely is still waiting keeps its button, so that fix cannot quietly
go too far. Both checks were confirmed to fail against the old code before
being accepted, so they can be trusted to catch the problem coming back.

### 2026-07-21 - fix(updates): stop reporting an installed update as still downloaded

Says "Up to date" again once you have actually installed an update. If you used
the in-app downloader to fetch a new Qortium Home and then installed it, the
Qortium Home status kept saying "Downloaded" and kept offering "Show file" on
desktop or "Install APK" on mobile, as though the update were still waiting for
you. The check itself was correct — the app simply never forgot the file it had
downloaded earlier, and that remembered file still looked like a match for the
release you were now running. Home now only treats a downloaded file as pending
while an update is genuinely available, and forgets it once no release channel
still offers it. This was only visible to people who updated through the app and
had then reached the newest release, which is why it surfaced with 1.5.2.

### 2026-07-21 - feat(tabs): show which tab is making sound

Tells you which tab the noise is coming from, and lets you silence it. When a
Q-App or website starts playing audio, a speaker appears on its tab, exactly
like the one your web browser shows. Clicking that speaker mutes only that tab
— the page carries on running and playing, you just stop hearing it — and
clicking again brings the sound back. Previously a tab could start playing in
the background with nothing to show which one it was and no way to quieten it
short of closing the tab.

The speaker stays visible on tabs you are not currently looking at, since that
is the whole point of it, and it disappears again once a tab falls silent.
Muting deliberately survives moving around inside a tab, matching how a browser
keeps a tab muted as you follow links, while a tab that is closed and reopened
starts fresh. This is a desktop feature: on Android, apps run in a way that
gives the application no view of their audio, so no speaker appears there.

Also fixes the desktop browser check, which could not open QDN addresses at all
because it was never told where the node's key lives, and extends it to confirm
the speaker appears, mutes and unmutes.

### 2026-07-21 - fix(display): show the accent colour the app actually uses

Makes the accent colour picker honest. Three of the nine coloured dots in
settings — blue, red and pink — advertised a brighter colour than the one you
got when you picked them, because the dot's colour was written down separately
from the colour the application really uses and the two had drifted apart. The
dots now show the real colours. The single dot in the collapsed settings
summary reads the colour straight from the active theme instead of a copy, so
it cannot drift at all, and a new automated check compares every dot against
the real colour and fails if anyone lets them separate again.

### 2026-07-21 - fix(scripts): stop desktop smoke runs orphaning Xvfb and Chromium

Stops the desktop test runs leaving browsers behind. Those checks start the
application inside a hidden display so they can drive it without a window
appearing. When a run finished, the shutdown signal reached only the small
helper that sets up that hidden display, and never the application or the
hidden display itself, so both kept running afterwards. Nothing cleaned them up
if a run was interrupted either. They accumulated quietly: one machine was
found holding seventy-seven leftover browser processes and six abandoned
displays, using several gigabytes of memory, the oldest more than six hours
old. Shutdown now reaches the whole group of processes a run started, and an
interrupted run cleans up after itself.

### 2026-07-21 - feat(qdn): one loading panel for every QDN service

Gives every kind of QDN content the same loading screen. Waiting for a video, a
document or an app used to look different from waiting for a website, because
the application showed a plain line of text in most places while the node
itself showed a designed panel. There is now a single panel used everywhere,
styled from the application's own colours so it follows the chosen theme,
accent colour and interface style automatically, and carrying the same status
wording, progress bar and file count. It also shows the drifting hexagon
pattern from the node's own loading page, which switches itself off on small
panes and for anyone who has asked their system to reduce motion.

Two related annoyances are fixed at the same time. When content is not ready
yet the node replies with its own loading page, and the application mistook
that reply for an error message, showing the entire page as the error text.
Video and audio were also handed content without checking the reply first, so a
file that was merely still downloading announced itself as an unsupported
format. Both now report what is actually happening.

### 2026-07-20 - test(qdn): assert a real position change in the Android media check

Makes the Android media check prove that a track can actually be skipped
through. It previously opened a two second sound file and a three second video
and only confirmed they had loaded, which could never show whether dragging the
position worked. It now opens the minute long sound file published for this
purpose and jumps to forty-two seconds in, failing if the position does not
arrive and stay there, and refusing to run at all against a file too short for
the jump to mean anything.

Video is deliberately left as a load-only check. The Android emulator shuts down
while decoding the newer high quality video, taking the whole test run with it,
so video skipping is confirmed on a real phone instead.

The check also no longer takes over a phone that happens to be plugged into the
computer. It needs an emulator, and would previously have picked whichever
device was listed first and tried to install a test build over the real one.

### 2026-07-20 - fix(qdn): keep the embedded video player usable on phone screens

Gives embedded QDN video a proper size on a phone. The area below the player
holds the open-with-system-player button and the full list of resource
properties, and that block was allowed to take as much height as it wanted while
the player was allowed to shrink to nothing. On a phone the result was a video
squeezed into a sliver a few pixels tall, with its play and position controls
effectively unreachable, unless the viewer happened to discover the expand
button. The player now keeps a sensible minimum share of the screen and the
property list scrolls within what is left, so a video is watchable as soon as it
opens. Audio, which needs only a slim control bar, is unchanged, as is the
existing expand-to-fill view.

Also stabilises the desktop media seek check. It deliberately leaves the video
playing at the end of the seek assertions, and navigating away from a playing
video occasionally raced the next check and failed the run for no real reason.
The video is now stopped before the check moves on.

### 2026-07-20 - fix(qdn): restore Catalina bridge and prepare Home 1.5.2

Restores QDN apps in the macOS 10.15 compatibility build. Electron 32 predates
`contextBridge.executeInMainWorld`, so the sandboxed preload now feature-detects
that API and uses Electron 32's sandbox-supported `webFrame` only to install the
same trusted, static `qdnRequest` wrapper in the page world. New runtime checks
exercise the real built preload under Electron 32.3.3, 36.9.5, and 39.8.10 and
verify the bridge is ready before page scripts, survives strict page CSP, keeps
its locked descriptor, and preserves results and main-world error behavior.
The desktop and Android packages also advance to 1.5.2, with Android version
code 32, so this prerelease remains distinct from the existing 1.5.1 release.

Embedded QDN audio and video players also become draggable again on Android.
The mobile build reserves sideways swipes for moving between pages, and that
reservation was being applied to the players themselves, so dragging the
position slider did nothing. The players now keep their own touch handling, and
sideways swipes still change pages everywhere else.

A new automated desktop check proves that embedded QDN media can really be
skipped through. It opens a large video from the node inside the real
application, notes how little of it has been downloaded so far, drags the
position far past that point, waits for the player to confirm it arrived, and
then plays on from there. That last step is the one that matters: it can only
succeed when the node serves a piece from the middle of a file on request, so
the check would have failed against the older behaviour that always sent the
whole file from the beginning.

### 2026-07-20 - perf(test): shorten the proof-of-work self-test on pull requests

The proof-of-work self-test was taking about two minutes of every automated
check, far more than everything else combined. Most of that was not testing
anything: it was a speed comparison that re-ran a deliberately slow reference
version at full production size purely to report how much faster the real one
is.

Pull requests now skip that speed comparison and use fewer randomized
comparison rounds. The checks that confirm Home's proof-of-work agrees with
Core's published reference values still run in full on every change, and merges
to the main branch still run everything including the speed comparison. Both
kinds of deliberate error introduced while testing this were still caught by
the shortened run on its first round.

### 2026-07-20 - perf(test): stop recompiling the Electron sources for every test

Fourteen of the test commands each recompiled the Electron sources before
running, so a full test run compiled the same code fourteen times over. The
compile now happens once and is reused, and is redone automatically whenever
those sources actually change, so each command still works on its own.

Everything except one long-running test now finishes in about fifteen seconds
instead of roughly a minute and a half. The test run also reports which
commands took longest, which makes it clear that the remaining time is almost
entirely the memory-proof-of-work self-test that checks Home's implementation
against Core's reference values.

### 2026-07-20 - chore(ci): build and test every pull request

Until now the only automated check on a Qortium Home change was the security
scanner. Nothing built the application or ran its tests, so a change that broke
either could be merged and only be noticed later by hand.

Every pull request and every push to the main branch now builds the application
and runs the full test suite. That also makes the recently added check for
unrun test files binding rather than advisory: a test that no command runs will
now stop a pull request instead of quietly passing review.

### 2026-07-20 - chore(test): run every test file and fail on unwired ones

Six existing test files were never actually run by anything. They compiled and
looked like working coverage when reading the code, but no command executed
them, so whatever they checked was unprotected. All six pass, so nothing was
found to be broken — they were simply not being consulted.

Each is now runnable, and `npm test` runs the whole suite in one command
instead of requiring someone to know each individual command name. A wiring
check runs first and fails if any test file exists that no command runs, so a
test cannot go silently dead again. All 33 test commands pass and none of them
need a network connection or a running node.

### 2026-07-20 - fix(qdn): route recipe links into an already-open Recipes tab

Opening a link to a specific recipe while the Recipes app was already open
added a second Recipes tab instead of moving the open one to that recipe. Home
now recognizes which parts of a link are a "go to this thing" instruction
rather than part of the app's identity, so such a link reuses the tab already
showing that app.

Home only does this for apps that are known to understand the instruction,
which currently means Chat and Recipes. Other apps that put a target in the
link, such as Help and Boards, deliberately keep opening a new tab: they do not
listen for the instruction, so reusing their tab would leave the link doing
nothing at all. The existing test file for this behavior was never wired into
the test scripts and now runs, covering both the new routing and that
protection.

### 2026-07-19 - feat(qdn): add Qortal transaction search and node passthrough bridge actions

Adds two read-only bridge actions for Qortal chain data. Apps could already
read a few fixed Qortal values (like the QORT balance), but had no way to run
other Qortal read queries such as searching an address's transaction history —
which is why the Wallets app showed a QORT balance but an empty transaction
list. SEARCH_QORTAL_TRANSACTIONS searches Qortal transaction history for any
transaction type (defaulting to the selected account's address) and returns
the transaction list directly. FETCH_QORTAL_NODE_API is a general passthrough
that lets apps query the configured Qortal node the same way FETCH_NODE_API
queries the Qortium node, with the same path, method (GET/HEAD only), and size
limits. Both work on desktop and Android.

### 2026-07-19 - feat(qdn): browse Git repository branches and commits

Recognizes real Git data published through QDN as either a normal repository
with a `.git` directory or a bare repository. The repository viewer can switch
branches, browse a bounded list of commits, inspect the file tree at any shown
commit, and preview historical file contents without checking out or executing
repository data. Repository paths, history depth, cached bytes, inflated Git
objects, and delta expansion are bounded before untrusted data is rendered.
Older `GIT_REPOSITORY` resources that contain only a source
snapshot keep the existing file-tree view. The QortiumHomeTest fixture is now a
real, deterministic repository with divergent `main` and `feature/greeting`
branches so this flow can be tested against live QDN data.

### 2026-07-19 - fix(android): load gallery images and approve manager access

Fixes two Android-only prerelease blockers. QDN galleries now load public-node
images through Home's trusted bridge and safe local blob URLs instead of direct
HTTP image links that Android blocked as mixed content; grid images are fetched
only as they approach the viewport. Bookmark and notification manager apps can
also complete their first durable permission approval without Home mistaking
the approval dialog's temporary iframe suspension for navigation away from the
requesting app.

### 2026-07-19 - fix(home): resolve the notification storage alert and add gallery navigation

Documents why Home's sanitized notification preferences are intentionally kept
in browser storage and classifies the resulting CodeQL alert separately from
credentials and other secrets that must never be stored there. The same update
adds previous and next controls to an open image in QDN galleries, supports
Left and Right Arrow keys on desktop, and supports horizontal swipes on touch
devices. The controls stop at the first and last image and remain accessible to
keyboard and screen-reader users.

### 2026-07-19 - fix(document-viewer): open QDN EPUBs reliably

Fixes QDN EPUBs that stayed on “Loading QDN resource…” forever after opening
in the Document Viewer. Home now gives epub.js the downloaded book bytes
directly, so it reliably recognizes a packed EPUB instead of looking for an
unpacked book directory, and it shows the normal document error if opening or
reading the table of contents fails or takes too long.

### 2026-07-19 - feat(qdn): improve bookmark and notification managers

Lets approved bookmark-manager apps list Home account labels, change the
account assigned to a saved place, and ask Home to open it under that exact
account without reusing a tab from another account. Notification-manager apps
can now receive filter values that Home verifies as real Qortal addresses, so
they can resolve and display public names and avatars, while account bindings,
wallet keys, signatures, and non-address values remain hidden.

### 2026-07-19 - feat(qdn): add bookmark and notification manager bridges

Adds the first bookmark-manager and notification-manager bridge actions for
QDN apps. After a one-time permission approval in Home, a manager app can read
the user's saved bookmarks and notification rules, apply changes such as
adding or editing bookmarks, muting or removing notification rules, and
revoking an app's notification access. Every read carries a revision marker,
and Home rejects changes based on outdated data so two apps cannot silently
overwrite each other. These actions work the same on desktop and Android and
in public-node mode.

### 2026-07-19 - fix(updates): select macOS DMGs by OS version

Stops Intel Macs on current macOS releases from receiving the Catalina-only
Home package just because it is architecture-specific. Desktop Home now reports
the actual operating-system version, and update checks choose the standard
universal DMG for macOS 12 and newer, the macOS-11 compatibility DMG for Big
Sur, and the Catalina x64 DMG only for macOS 10.15. Unknown browser-mode
versions safely prefer the current universal package, with focused coverage for
Intel and Apple Silicon across each supported macOS line.

### 2026-07-19 - fix(notifications): accept boolean resource prefix filters

Lets QDN apps subscribe to published-resource notifications using the node's
boolean `prefix` filter. Home now preserves both `true` and `false` when it
validates and forwards the rule, while rejecting strings and other values that
the node's typed resource filter does not accept.

### 2026-07-18 - docs: refresh release and license wording

Removes the stale Home 1.4.x prerelease version from the README so the release
description stays accurate as new versions ship. The license now uses GitHub's
canonical BSD Zero Clause heading and identifies QuickMythril and Qortium Home
contributors as the copyright holders, helping repository tools recognize the
project's existing 0BSD terms without changing those terms.

### 2026-07-18 - fix(qdn): preserve app URL fragments

Preserves the `#fragment` portion of a QDN app's browser location in Home's
address bar and combined Back/Forward history. Direct fragment links open at
the requested client-side location, hash-only pushes, replacements, and
traversals stay synchronized on desktop and Android, and reload, duplicate,
reopen, bookmark, pin, copy, and move-to-window flows retain the visible
address. Home models the fragment separately from the QDN resource path so it
is never sent to Core as a filepath or API query parameter.

### 2026-07-18 - fix(qdn): sync in-app locations with Home

Keeps Home's address bar and per-tab Back/Forward history synchronized with
navigation inside QDN apps. Polls and Boards direct links now update as people
move between polls, threads, and posts; toolbar buttons, mouse/keyboard
shortcuts, Android's system Back button, reload, duplicate tabs, and reopened
tabs all retain and traverse those pages before leaving the app. Desktop and
Android accept navigation snapshots and commands only from the already-open app
identity and node origin, discard Home-only rendering parameters, and ignore
mismatched or non-web locations. Run the focused regression coverage with
`npm run test:qdn-live-location`.

### 2026-07-16 - fix(qdn): submit multi-option poll votes in ascending order

Fixes multi-option poll votes that could get stuck forever without being
recorded. The Qortium node stores a vote's chosen options in ascending order,
so a vote signed with its options in any other order (for example picking
option 2 before option 1) no longer matches its own signature when the network
rebuilds it, and it silently never confirms. Home now sorts the chosen options
into ascending order before asking for approval and signing, so multi-option
votes always confirm regardless of the order the user picked them in. The
approval prompt, the built transaction, and the reply to the app all use the
same sorted order.

### 2026-07-16 - chore(release): prepare home 1.5.1

Bumps Qortium Home to 1.5.1 with Android versionCode 31. This is a hotfix
release line: it restores the QDN app bridge inside sandboxed app views that
was broken in 1.5.0, and contains no other changes.

### 2026-07-16 - fix(qdn): restore the app bridge inside sandboxed QDN app views

Fixes the 1.5.0 regression where every QDN app lost its connection to Home:
Chat asked people to "share the selected account", direct chats and avatars
disappeared, and attachments could not be added. The 1.5.0 bridge hardening
made the QDN app preload script load its error-envelope keys from a shared
module, but QDN app views run sandboxed, where scripts cannot load other local
files - so the whole preload script silently failed and apps behaved as if
they were running outside Home. The preload now carries those two constants
itself, a test pins them to the shared module so they cannot drift apart, and
the same test fails if the preload ever gains another local file load that
would break it again. Reads through the node kept working throughout, which
is why browsing and public group chat still looked normal.

### 2026-07-16 - test: exercise the built QDN app preload in a sandboxed window

Adds a release check that launches the real built QDN app preload inside a
sandboxed Electron window - the same isolation QDN apps get - and confirms
window.qdnRequest exists and correctly passes results, errors, and empty
responses across the bridge. The 1.5.0 bridge regression failed exactly this
way while every existing check still passed, because nothing verified the
preload survives sandbox loading. Run with npm run test:qdn-app-preload. No
application behavior changed.

### 2026-07-16 - qdn: open single-file documents in the right viewer format

Single-file QDN documents now open correctly in the document viewer. These
resources have no file path for Home to guess the format from, and nodes do
not always report a reliable content type, so formats like EPUB could show
"cannot be displayed inline" instead of opening. QDN apps can now pass
optional filename and content-type hints when asking Home to open the
document viewer, and Home's own "Open in Document Viewer" button supplies the
same hints from the resource's published properties. The hints are used only
to pick the display format; they never change which resource is fetched from
the node.

### 2026-07-15 - docs: refresh README for the current feature set

Brings the README back in line with what Qortium Home actually does today. It
now introduces Home as a desktop and Android application, points to the
GitHub releases page, and adds a Download section describing the published
packages, the in-app self-update channels, and the unsigned-builds warning.
The feature list is regrouped around wallets, node modes, the managed Core,
Java, and I2P runtimes, QDN browsing and viewers, QDN app hosting and
notifications, self-update, the Welcome setup, app versioning badges, display
styles, and translations. The long inline list of QDN app bridge actions,
which had fallen out of date, is replaced by a short summary that points at
the real action catalogue in the code and the bridge documentation, including
a note that the bridge's Qortal interoperability actions stay separate from
Qortium's own. Outdated Java 17 references now describe the Java 25 managed
runtime, already-shipped planned items are removed, and the Documentation
section links every document in `docs/`, the change log convention, the
qortium.app website, and the community discussions page. The detailed bridge notes that grew inline (poll
scheduling, publishing sources, node-API limits, rating actions) move to
`docs/BRIDGE_ACTIONS.md`. No application behavior changed.
### 2026-07-15 - feat(qdn): let apps read and change Home display settings with approval

QDN apps can now see the small set of Home display choices that already affect their appearance, such as theme, language, text size, accent, zoom, style, and app notifications. Apps can read those values without a prompt, while any requested change clearly shows the current and proposed values and needs the person's approval each time. Approved changes take effect and are saved immediately in Home and in open apps, without changing node connections, wallets, updates, or other personal Home data.

### 2026-07-15 - feat(updates): unified update policies for Core, Home, and Java

Home now shows the Core version that is actually installed: it reads the
version from the installed core file itself instead of trusting install
records, so an on-chain auto-update or a manually replaced core no longer
displays a stale version. Update checks compare against that real version,
Home refuses to silently downgrade a newer core (it asks for confirmation
instead), and the GitHub and on-chain install paths can no longer run at the
same time. The Settings page gains matching three-way update policies — Off,
Notify only, or automatic — for the managed Core (covering both GitHub
releases and approved on-chain updates, always respecting the node's own
on-chain auto-update setting), for Home itself (where "automatic" downloads
the update and asks before installing), and for managed Java, replacing the
old Java checkbox. When a core is updated outside Home, Home can also refresh
the release's helper files (scripts, templates, docs) to match — automatically
under the automatic policy, or with one click otherwise. The Home
release-channel choice is now remembered between launches.

### 2026-07-15 - fix(updates): make Core and Java updates more reliable

- Core's GitHub and on-chain update channels now cross-check commit identity,
  preventing maintenance-branch hotfixes from causing repeated alternating
  installs.
- A GitHub Core release can now install while an externally managed Core is
  running; the on-chain idle check applies only to Home-managed nodes and
  reports the underlying cause when it fails.
- Refreshing Core support files no longer changes the saved release channel.
- A failed managed-Java update no longer blocks Core update checks; Home shows
  the Java error instead.
- Core, Home, and Java update policy changes now take effect immediately
  instead of waiting for the next scheduled check.
- Downgrade and same-version install guards now still work when Home cannot
  read the installed jar's identity.
- Stale install-staging and helpers-backup folders are now cleaned up.
- Core and Java update policies now default to Notify only instead of Off, and
  Java updates remain visible when their policy is Off.

### 2026-07-15 - feat(qdn): add group and foreign-payment notification rules

QDN apps can now subscribe to transaction confirmations by group and to
watch-only foreign-coin payment receipts. Group and foreign-payment rules use
the configured Core only when it supports the new 1.5.0 notification contract;
older nodes keep compatible rules running without rejecting the combined
subscription. Home explains that foreign-wallet monitoring reveals address
history but never gives the node spending authority.

### 2026-07-15 - chore(release): prepare home 1.5.0

Bumps Qortium Home to 1.5.0 with Android versionCode 30. This release line adds
capability-negotiated public-node poll writes, bounded client-side MemoryPoW,
and complete content attestation for public-node QDN publishing before Home
signs a transaction.

### 2026-07-15 - feat(qdn): attest public-node publish content

Home no longer trusts a public node to package the content it asks the user to
publish. Before signing, desktop and Android Home retrieve the exact encrypted
artifact named by the unsigned transaction, verify its SHA-256 hash and size,
decrypt it with the transaction's authenticated AES-GCM key, and compare every
file and byte with the approved source. Home also verifies the signed metadata
artifact, approved title, description, tags, category and file list, along with
the hashes of every QDN chunk. ZIP extraction and artifact reads are bounded to
the public publish limit, use abortable streaming HTTP reads, and enforce ZIP
entry-count and path-length ceilings before inflation. Cryptographic checks,
decryption, and ZIP comparison run in a worker instead of the main/UI thread.
Malicious, stalled, or unavailable artifacts fail closed, batch publishes
attest each resource independently, and local/trusted publishes and delete
tombstones retain their existing behavior.

### 2026-07-15 - feat(qdn): support secure public-node poll writes

Compatible public nodes can now advertise unsigned poll builders to QDN apps,
letting Home create, vote on, and update polls without sending a private key to
the node. Home verifies every approved poll and public chat field before local
signing, and checks the security-critical identity, method, service, payment,
group, nonce, and fee fields of public QDN publish/delete transactions. Free
MemoryPoW runs off the UI thread with one active job, a three-minute computation
limit, stale-context cancellation, and a final account/node check before
broadcast. Older public nodes remain browse-only, while local/trusted write paths
are unchanged.

### 2026-07-14 - release: prepare home 1.4.2

Bumps Qortium Home to 1.4.2. QDN apps can now cast multi-option poll votes
and create or update polls with scheduled start times, while notification
subscriptions accept multiple values for every supported generic filter. Bridge
errors no longer expose Electron's IPC prefix, and desktop and Android apps now
receive the stable `PUBLIC_NODE_READ_ONLY` code when a public node blocks a
restricted workflow. The first-run Welcome page can also scroll like other
Home pages.

- Chat notification clicks now open the relevant direct conversation or group
  and reuse an already-open Chat tab where possible, including on Android.
- App-issued notification clicks now always restore and focus a Home window.
- Notification filter compatibility with older Core versions preserves every
  requested value instead of replacing or silently truncating subscriptions.
- Poll writes reject invalid multi-option vote arrays before approval and
  preserve option text exactly as Core validates it.
- QDN app targets are delivered once after the app is ready, without hijacking
  later navigation or conflating different identifiers and resource paths.

### 2026-07-14 - fix: stop notification watcher crashing Home when Core goes away

Fixes a crash where stopping Qortium Core (for example from Core's own tray
icon) while Home's notification watcher was reconnecting could bring down the
whole Home app with a "Maximum call stack size exceeded" error. The watcher's
connection-error handling no longer re-closes a socket that is already
failing, and a failed connection now goes straight back onto the normal
reconnect schedule.


### 2026-07-14 - release: prepare home 1.4.1

Bumps Qortium Home to 1.4.1 with Android versionCode 29 for the next
prerelease. This release adds the first-run Welcome setup for new installs,
the Fun display style with protections for privileged QDN actions, and
Home-managed Java 25 with visible opt-in updates.


### 2026-07-14 - tests: refresh desktop smoke checks for current QDN behavior

Two desktop smoke checks had fallen behind intentional feature changes and
reported failures against correct behavior. The address-bar check now expects
what live autocomplete really does after Tab-completing "qdn://" — keep
suggesting the next segment (QDN services) instead of closing the list — and
the QDN API check now expects render links that carry the identifier as part
of the path. No application behavior changed.


### 2026-07-14 - home: first-run welcome setup

New installations now begin with a resumable Welcome setup that helps people choose how Home connects, create or import an account, and choose what to explore next. It can be skipped at any step, never interrupts existing profiles, and keeps the Dashboard and chosen Start pages ready for later launches.

### 2026-07-14 - core: Java 25 for Home-managed installs, with visible updates

When Home provides Java itself, it now installs Java 25. Home also checks
(about once a week, and without ever blocking anything) whether a newer
version of its own Java is available — including security updates within the
same version — and shows an Update Java button when there is one. Updates
are never applied silently by default: a new "Automatically update Java"
setting (off unless enabled) lets Home apply them on its own the next time
it starts the core, while the core is safely stopped. A Java already
installed on the system is never touched — if it is version 17 or newer it
keeps working as before, with an optional button to add a Home-managed
Java 25 alongside it.

### 2026-07-12 - security: verify local-notification restore intents

Home now accepts Android notification-restore broadcasts only for the boot
actions declared by the local-notifications plugin. Unexpected, missing, or
spoofed explicit intents are ignored before they can trigger notification
restoration.

### 2026-07-12 - release: prepare home 1.4.0

Bumps Qortium Home to 1.4.0 with Android versionCode 28 for the next
prerelease. This release adds Core 1.4-aware server-side filtering for
multi-type transaction notifications, the Qortium App Versioning Standard,
the `GET_HOST_INFO` bridge action, and compatibility badges for versioned QDN
apps and websites.

### 2026-07-11 - qdn: app versioning standard, GET_HOST_INFO, and compatibility badges

Home now recognizes an optional version label in QDN apps and websites, shows whether it is compatible with the installed Home version, and lets apps ask Home which platform version they are running on so they can safely offer newer features when available.

### 2026-07-11 - qdn: send multi-value txType filters server-side on Core 1.4.0+

When a QDN app watches more than one transaction type, Home now lets newer
Qortium Core versions narrow those notifications before they reach the app.
Older Core versions continue to work as before, with Home safely filtering the
same notifications itself after they arrive.

### 2026-07-11 - fix: apply host zoom to QDN views after navigation completes

Fixes the report that a saved App Zoom level did not take effect until the
first manual zoom shortcut. A freshly opened app view now picks up the saved
zoom as soon as it finishes loading, including after reloads and after
switching the app to a different node.

### 2026-07-10 - qdn: flexible notification filters and data-derived default text

Notification subscriptions become more flexible for QDN apps. A confirmed-
transaction rule can now watch several transaction types at once, payment
rules can filter by sender and other details the node already understood, and
when an app does not provide its own notification text Home now builds a
short safe description from the event itself, such as the transaction type
and a shortened sender address. Existing saved rules keep working unchanged.

### 2026-07-10 - release: prepare home 1.3.2

Bumps Qortium Home to 1.3.2 with Android versionCode 27 for the next
prerelease. This release packages keyless QDN signing for remote nodes, QDN app
notifications and background subscriptions, app-controlled tab titles, and the
Qortal group-membership and public-group chat safeguards needed by ChibiHub.
Bookmark Toolbar visibility now offers Always show, Only on Dashboard / New
Tab, and Hide while preserving existing saved preferences. Custom nodes that
deny the Core API documentation path now show a restricted-access explanation
and retry action instead of the misleading disabled-page restart prompt.

### 2026-07-10 - qdn: expose Qortal groups and protect public group chat

QDN apps can now ask Home for the groups joined by a selected Qortal account,
including the Qortal `isOpen` privacy flag. Before showing approval or signing
a plaintext Qortal group chat message, Home now verifies the group directly
and continues only for groups explicitly marked public. Private groups are
rejected with a clear explanation that private-group encryption is not yet
supported, while missing or malformed privacy metadata also fails closed. The
same behavior is shared by desktop and Android.

### 2026-07-09 - app: background notification subscriptions for QDN apps

QDN apps can now ask Home to watch for new resources, incoming payments, chat
activity, and confirmed transactions even after their tab is closed. Home
keeps one connection to the configured Qortium node, watches only the rules for
the active account, and shows a system notification when a rule matches. Each
app receives one durable notification permission that can be muted or revoked
from the new App notifications Settings section; revoking also removes that
app's saved rules. The same bridge actions and validation are available on
desktop and Android, and a new desktop smoke scenario covers adding, reading,
firing, removing, and cleaning up a real resource-publish subscription.

### 2026-07-09 - app: let QDN apps show notifications and set their tab title

QDN apps can now ask Home to show a system notification with a new
`SHOW_NOTIFICATION` bridge action, so an app like Qortium Chat can alert you
about a new direct message or mention even when its tab is in the background.
The first request from an app opens the familiar permission dialog; approving
it grants that app notifications for the rest of the session. Notifications
are suppressed while you are already looking at the app, briefly rate-limited
per app, and always display the app's name so one app cannot pose as another.
Clicking a notification focuses the app's tab. A new "App notifications"
switch in Display Settings turns them off entirely, on desktop and Android
alike. Apps also control their own tab label now: the tab shows the app's
page title (like a regular browser tab) and falls back to the address when
the app does not set one — so apps can surface unread counts or context in
the tab itself. Both features work on desktop and Android, and the desktop
permission smoke test gained an `app-notification` scenario covering the
deny/approve flow, permission caching, and tab-title updates.

### 2026-07-08 - release: prepare home 1.3.1

Bumps Qortium Home to 1.3.1 with Android versionCode 26 for the next
prerelease. This release packages the post-1.3.0 Home improvements: resource
and account rating bridge reads, Qortal public-node bridge actions, Core
offline recovery and key-guard handling, safer publish staging cleanup, app-view
zoom controls, local Qortal bridge reads, in-Home release links, custom-node
public-render fallback, trusted node https certificates, and responsive
running-core discovery. The change here is only the package, lockfile, Android
release metadata, and changelog entry; the behavioral changes were merged in
the preceding PRs.

### 2026-07-08 - app: keep the interface responsive during node status checks

Fixed the app becoming laggy and unresponsive shortly after launch. Checking
which local Core is running (to reuse its API key) could repeatedly block the
app's main process while it inspected running processes, which froze scrolling
and clicks during the startup burst of node status checks. That inspection now
runs in the background, its result is cached briefly, and the app warms it up
once at launch, so the interface stays responsive.

### 2026-07-08 - node: trust the configured node's own https certificate on desktop

Home now fetches the node's local certificate authority and verifies the
node's https certificate against it, so custom and local node connections can
use https with the node's self-generated certificate without changing existing
http setups.

### 2026-07-08 - qdn: open apps from custom nodes that only allow public rendering

Custom-node app and website opens now fall back to public rendering when the
node blocks remote app authorization but still allows public QDN render access.
When that fallback is not possible, Home shows a clear explanation that the
node does not allow remote app authorization instead of displaying the node's
raw error page.

Desktop app and website views also now load resource status and previews from
the configured node connection. Previously these requests always went to the
default local node address even when a custom node was selected, so custom-node
pages could only finish loading while a local node happened to be running.

### 2026-07-08 - app: app-view zoom controls and shortcut routing

QDN app tabs now respond to the same app zoom shortcuts and wheel gestures even
when the embedded app itself has keyboard or mouse focus. Display Settings also
has a new App zoom control after Text size, so users can scale the whole app
view separately from Home's text-size preset. On desktop the setting follows
Home's native zoom behavior, while Android and web views use an iframe scale
fallback for QDN apps. Text-size shortcuts keep changing only the UI text size,
including the shifted key and wheel gestures routed from focused QDN apps.

### 2026-07-08 - qdn: prefer a synced local Qortal node for Qortal bridge reads

QDN apps that use Home's Qortal-specific bridge actions now prefer a synced
local Qortal mainnet node on `127.0.0.1:12391` on desktop before falling back to
the existing public Qortal nodes. Home only uses the local node when its status
shows it is fully synced and public QDN reads work, and it rechecks immediately
after node request failures instead of staying on a stale cached node choice.
Android continues to use the remote public Qortal nodes by default so it does
not accidentally treat the device's own loopback address as the user's desktop
node.

### 2026-07-08 - app: keep update release links inside Home

Changed Dashboard and Settings release update rows so available Core and Home
versions navigate to Home's built-in release notes page instead of opening the
GitHub release page in an external browser. Release version rows now use a
consistent contained arrow button for the release-notes action while the release
notes page itself still keeps its explicit Open GitHub action.

### 2026-07-05 - qdn: add RATE_RESOURCE bridge action for resource ratings

QDN apps can now ask Home to submit a 1 to 10 rating for a published QDN
resource through the bridge using a new `RATE_RESOURCE` action, with 0 removing
an existing rating. This lets apps replace ad-hoc like buttons with Core's
native trust-weighted resource rating system. As with `RATE_ACCOUNT`, the user
approves each request and the rating is signed inside Home, so the account's
private key never leaves Home. It works the same way on desktop and Android,
with translated approval labels.

### 2026-07-05 - release: prepare home 1.3.0

Bumps Qortium Home to 1.3.0 with Android versionCode 25 for the next
prerelease. This release packages the Home bridge updates for bounded Core
settings edits, node restart requests, and the new Core peer diagnostics
surface used by the Node app. The change here is only the package, lockfile,
Android release metadata, changelog entry, and smoke-test coverage; the Core
endpoint and peer-policy changes are reviewed separately in the matching Core
PR.

### 2026-07-03 - release: prepare home 1.2.3

Bumps Qortium Home to 1.2.3 with Android versionCode 24 for the next
prerelease. This release packages the desktop custom-node API key field fix,
the synced Previewnet network-node requirement, and the packaged Home folder
path fixes. The change here is only the package, lockfile, Android release
metadata, and changelog entry; the behavioral changes were merged in the
preceding PR.

### 2026-07-03 - fix: show desktop custom-node API keys

Shows the API key field in desktop node settings for local and custom nodes,
not only on Android. Linux AppImage users who connect Home to a trusted custom
Core through an SSH tunnel can now save that node's API key from the same
settings panel where they enter the custom node URL, so protected QDN workflows
no longer tell them to save a key without giving them a field to do it.

### 2026-07-01 - fix: require synced Previewnet network nodes

Hardens Previewnet network discovery so Home only selects public nodes that are
reachable, can answer public QDN reads, and report a fully synced Core status.
Desktop and Android now reject cached or newly discovered nodes that are behind
the chain tip, even if they still answer public reads, so network mode does not
route users to stale non-seed nodes discovered from seed peer lists.

### 2026-07-01 - fix: resolve packaged Home folders

Fixes Windows portable builds so Home identifies the original portable `.exe`
the user launched instead of the temporary folder where the portable wrapper
extracts the running app. Home also resolves macOS builds back to the
`Qortium Home.app` bundle instead of the internal `Contents/MacOS` executable.
The Home folder link and desktop update downloads now point back to the
user-facing package location, so downloaded new builds do not disappear with the
temporary Windows runtime folder or land inside a macOS app bundle.

### 2026-07-01 - release: prepare home 1.2.2

Bumps Qortium Home to 1.2.2 with Android versionCode 23 for the next
prerelease. This release packages the Home bookmarks workflow, in-app Home and
Core release notes, direct release-asset downloads, resilient QDN app icon and
account avatar resolution, stopped managed-Core transport-mode updates, and the
latest Core 1.2.2 compatibility surface after the merged Core settings and
QDN database-performance work. The change here is only the package, lockfile,
Android release metadata, and changelog entry; the behavioral changes were
merged in the preceding PR.

### 2026-07-01 - feat: add Home bookmarks, release notes, and resilient media

Adds a full Home bookmarks workflow with bookmark folders, a toolbar, drag and
drop between bookmarks, dashboard pins, and Start Pages, plus saved account
context for QDN links so reopened pages can keep using the intended account.
Home also gains release-notes pages for Home and Core releases, with GitHub
release markdown shown inside the app and direct release-asset downloads routed
through the desktop save dialog instead of treating every asset as an app
update.

QDN app icons and account avatars now share a status-driven image resolver that
keeps the last good image visible while the node reconnects, refreshes through
QDN status/fetch requests, and only clears cached images after a terminal
missing result. The dashboard and top bar use that resolver for steadier icon
and avatar rendering, including native builds that need typed blob URLs instead
of direct image loads.

The Core transport controls can now read live peer/transport status from the
running node or the stopped managed-Core runtime, and Home can update the
managed runtime's transport mode before Core starts. The surrounding UI and
translations were updated so bookmarks, release notes, release downloads,
transport status, and resilient QDN media behave consistently across the app.

### 2026-06-30 - fix: preserve startup account context and native avatars

Start Pages now remember the account selected on the tab when the page is saved,
so reopening Home can load those pages under the same account instead of leaving
them as "No account." Existing URL-only Start Pages still open, and Home falls
back to the current default account for those older saved entries. Native builds
also resolve account avatar images through blob URLs with sniffed content types
when the node returns generic binary responses, so Android can keep showing
published avatars instead of falling back after a direct image load fails.

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
`vite` 7.3.6, and includes 7r15's Start Pages feature so users can choose up
to 10 saved pages to open as tabs when Home starts.

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
