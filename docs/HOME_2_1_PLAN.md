# Qortium Home 2.1.0 delivery plan

Last updated: 2026-09-05

Status: active. Home 2.0.0 at `5606faa` is the implementation baseline.

## September 4 execution checkpoint

This checkpoint began at `2d8734235c56815c13d5eb70c725622c695fb71b`;
use main's current commit for delivery verification, not this historical base.
Earlier checked items below describe delivery history, not a claim that every
later parity regression is resolved. Subsequent owner decisions allow multiple
simultaneous internal tabs and require the remaining major parity issues to be
resolved before release. Release preparation must verify current application,
Android and QAVS metadata rather than reuse the original version-code estimate.

Completed since the original plan: desktop and Android Home-signed foreign sends
(#502/#517), bounded hosted-app read budgets (#514), authenticated streamed
single-file publishing with Core #306 (#515), native Android admin-key handling
(#516), reconciled folder publishing (#504), and hosted-app fullscreen (#507).
Folders and mixed batches use the public keyless `isZip` route with a 512 MiB
aggregate staging bound; the authenticated 2 GiB ceiling concerns trusted
single-file publishing. Build/CI evidence does not establish installed acceptance.

The September 4 parity tranche implements per-tab account chrome and source-tab
bookmark/pin bindings (#518), accessible local permission management and the
Notifications Manager launcher (#519), account-specific chat-send consent and
legacy reconfirmation (#520), Dashboard/Settings transport parity with explicit
restart confirmation (#521), and deterministic preview ZIP timestamps (#522).
Removed-account tabs remain accessible and bound to that identity, show Locked,
and disable Unlock. Opening a saved link uses its saved account; the cross-account
save warning only prevents URL-only deduplication from removing or replacing another save.
The manual toolbar unlock follow-up keeps password entry inside the account
dropdown, with native-view suspension but no full-window backdrop blocking tabs.
App-requested unlock approvals retain their separate requester-owned dialog.
These are implementation milestones, not release or installed-device acceptance.

The paired default-account follow-up removes default-picker grant invalidation
and checks Android approvals against each requesting tab's live account/wallet
binding. Scoped lifecycle epochs prevent stale asynchronous approvals from
surviving lock/unlock or app replacement. Existing lock/removal invalidation is
retained; this does not narrow those events to one account.

The September 5 follow-ups through #531 complete guest saved-link references
(#525), explicit account launching (#526), Dashboard pin attribution (#527),
identity-safe close/reopen (#528), current app URLs (#529), per-tab navigation
history (#530), and bookmark-toolbar overlay ownership (#531).

The next viewer foundation introduces separate public resource tabs: generic
QDN coordinates, account-attributed saves, close/reopen and process restoration.
These entries carry no app identity, wallet context, node URL or stream token.
Public access is acquired through the selected node each time a viewer mounts;
private attachment viewers retain their existing source-app approval lifetime.
Media/document/archive renderers are reused inside the content area. This does
not complete retained playback/page/scroll position.
The next rich-viewer tranche restores text, code, JSON, CSV and Markdown through
1 MiB capability-only reads. Markdown uses inert React formatting (no publisher
HTML, live links or images); code highlighting is converted to text/span nodes.
Tables, JSON trees and formatting work are bounded, with raw-source/save fallbacks.
Preview notices are included in every supported locale catalog.
Viewer queries/fragments are refused for now. Cross-window viewer transfer is
deferred until the transfer contract preserves account attribution.

Remaining work, in order:

1. **Viewers and navigation:** accept per-tab position retention, then correct
   tab/window transfer context and richer routes. Rich text/data viewers landed
   in #534 and save feedback in #535. Position retention holds only small values
   for the current public resource/account in each open tab: document page/zoom,
   EPUB location, text scroll, paused media time and bounded archive navigation.
   Inactive viewers still release access. Same-resource refresh retains best-effort
   position; close, resource/account changes and restart discard it. Private
   overlays, closed-tab/process position restore and cross-window state transfer
   remain separate. Native dialogs, byte limits and save authority stay unchanged.
2. **Shell and maintenance consistency:** per-tab Settings state and unique IDs;
   remaining maintenance progress/copy/details, node-settings discovery, and tab
   and keyboard parity.
3. **Accessibility/localization/notifications:** dialog/menu focus and keyboard
   behavior, globally visible announced errors, translated approval/maintenance
   text, and the separate background notification subscription family.

Full collections management remains in the Bookmarks app. Existing retained
media/document/archive overlays do not by themselves complete generic viewer
tabs. Each change needs meaningful tests and relevant renderer/packaged checks;
permission/signing changes additionally need independent security review.

Wallet #17 already provides the proposed app-side capability integration and
awaits its maintainer; do not duplicate it. Public-node foreign sends remain a
separate planned Home/Core phase with a distinct `HOME_SIGNED_PUBLIC_NODE`
capability, operator/xpub disclosure, public endpoint limits, chain checks and
ambiguous-broadcast handling. Do not enable this by allowlisting admin routes.
Core already pins official Pirate v1.2.0 through #304; upstream #48–#50 are
merged but need an official release before the next artifact/acceptance/repin
cycle. Fork artifacts remain proof-only.

Outstanding installed acceptance includes Android WAL crash/restart and native
key lifecycle/refusals; large trusted single-file and folder public-route
publishing, route/key drift and cleanup; hosted-app reads and fullscreen. Device
installs, live key changes, signed publication, funded sends and releases remain
separately scoped. Preserve unrelated worktrees and unfinished import work.

This document is the repository's product and release authority for 2.1.0.
Maintainers may keep a more detailed private task tracker with verified source
anchors and review evidence, but it is subordinate to this plan and may not
change release decisions or security boundaries on its own.

## Release decision

Home 2.1.0 is one combined feature prerelease. The release adds substantial
trusted-shell and managed-service behavior, so it uses a minor application
version rather than a 2.0.1 patch version.

The QAVS compatibility level advances to `platformVersion: "2.1"`: the F9
bookmark/delegation work restores an app-observable action family that Home
2.0.0 did not advertise. `SHOW_ACTIONS` remains the runtime discovery
authority, while the explicit platform level lets apps declare that they need
the restored manager surface. The initial Android estimate was version code 39;
current metadata is version code 42 and version name 2.1.0. Recheck the actual
metadata during release preparation rather than reusing an old estimate.

## Product boundaries

- Keep Qortium first wherever the two networks are shown together.
- Keep Home slim: full Chat, Wallets, Groups, Explorer, publishing, markets,
  bookmarks management, and similar experiences belong in QDN apps.
- Managed Qortal Core is a release requirement, not an optional follow-up.
- Preserve separate `qdnRequest` and `qortalRequest` public protocols and an
  explicit target network for every privileged operation.
- Desktop and Android remain co-primary. Desktop-only management features must
  degrade deliberately on Android rather than breaking the shared shell.

## Delivery sequence

1. Shell cleanup and Qortium-first ordering; relocate account lookup into the
   new-tab page; start Qortal release-pipeline and adopted-install design work.
2. Fix missing-avatar terminal status; add the settings-section scaffold and
   new-tab preference; wire v2 localization before update hooks depend on it.
3. Refactor Core management around per-network descriptors while the legacy
   manager remains unreachable from the v2 renderer.
4. Expose Core, Java, i2pd, and Home-update behavior through new sender-gated
   v2 channels. Never register the ungated v1 handlers in Home 2.
5. Extract node/Core presentation wiring, then restore the per-network
   management and settings UI.
6. Add the Qortal release pipeline, adopted-install execution model, conditional
   update ownership, per-network UI, shared Java, and Qortium-only i2pd scoping.
7. Restore the curated settings, migration, onboarding, docs, viewers, pinned
   apps, release notes, and minimal built-in Apps/Activity fallbacks. QDN app
   delegation ships only after the relevant app-side contract exists.
8. Archive legacy renderer references only after parity and complete release
   preparation and acceptance.

## Current tranche

- [x] Remove the extra brand block that looks like a false tab.
- [x] Put Qortium first in toolbar node pills, node cards, and account presence.
- [x] Add DOM-order regression coverage for those three surfaces.
- [x] Replace obsolete initial-state wording without changing runtime behavior.
- [x] Relocate public account lookup from Dashboard to `home://newtab`.
- [x] Make `+` switch the single internal slot to New tab without closing apps.
- [x] Persist the additive `newtab` destination with safe older-reader fallback.
- [x] Put Qortium first in public identity results on desktop and phone.
- [x] Keep QDN app navigation in the existing browser address bar.
- [x] Stop missing legacy avatars from presenting as long-running downloads.
- [x] Share bounded avatar and app-icon loading across Home-owned surfaces,
  including terminal missing-image fallbacks, dual-network toolbar avatars,
  and APP/WEBSITE favicon-to-publisher-avatar fallback on desktop and Android.
- [x] Restore the lightweight bookmark toolbar without restoring the native
  manager: honor migrated Always, Dashboard/New Tab, and Hidden choices; keep
  links account-aware; support nested folders, app icons, standard resource
  actions, and a horizontally scrolling phone layout; expose visibility in
  Appearance Settings through the authoritative collections snapshot.
- [x] Add General, Appearance, and Account settings-section navigation.
- [x] Persist a new-tab target of Search page, Dashboard, or a validated custom
  Home/QDN app address without changing the saved-state version.
- [x] Route custom new-tab targets through the guarded browser address pipeline.
- [x] Reuse Home's shared localization runtime for Home 2's static,
  component-owned shell copy, with complete catalog and placeholder parity
  across all 23 languages.
- [x] Apply language and text direction at the Home 2 root, including lazy
  catalog updates, persisted settings, and packaged Arabic RTL coverage.
- [x] Establish the Qortium-first Core network descriptor and isolate local
  Core API-key discovery caches by network and runtime target, while retaining
  the existing Qortium lifecycle APIs as compatibility wrappers.
- [x] Finish the E1 manager boundary by keying lifecycle/update state,
  downgrade confirmations, and operation locks per network, and by registering
  the existing Qortium manager as the only production entry. Unimplemented
  networks fail closed, and no Core controls are exposed to Home 2 yet.
- [x] Add the E2 Qortal descriptor and stable-release trust boundary: exact
  `qortal.jar`, mandatory SHA-256 metadata, positive declared size, fixed Qortal
  GitHub URL, direct-JAR launch, shared managed Java, native update-setting
  ownership, and no fabricated `/admin/update` capability.
- [x] Add verified Qortal JAR staging with exclusive partial files, exact
  received-size and SHA-256 checks, embedded release-version matching, and
  alias-safe same-directory promotion.
- [x] Add the standalone JAR-only atomic initial-install/update transaction,
  including rollback and explicit incomplete-recovery reporting while leaving
  all non-JAR Qortal files untouched.
- [x] Add fail-closed Home-managed initial settings/API-key setup and separate
  metadata commit/rollback, binding the record to the activated JAR without
  placing key material in metadata.
- [x] Add the canonical-target cooperative cross-process operation lease, JAR
  target fingerprint/revalidation state, and Qortal-syntax-compatible
  stopped/live update-ownership detection. Proven-dead locks are retained for
  explicit recovery; immediate process/JAR revalidation remains required
  because Qortal Hub does not honor the lease.
- [x] Add a standalone Qortal lifecycle coordinator that composes those
  primitives behind the lease, binds start/stop/update to the managed JAR
  record, preserves Qortal's literal `settings.json` launch behavior, and keeps
  native-update and adopted-install mutation fail closed. Its strong runtime
  authority seams remain deliberately injected and unregistered. Unconsumed
  unique candidates are retained for explicit recovery because pathname unlink
  cannot prove that the inspected inode still owns the name.
- [x] Register the separate Qortal manager internally after Electron finalizes
  its data paths. Its Linux production adapter binds `/proc` PID/start identity,
  exact argv/cwd/JAR, the 12391 listener, JAR-matching mainnet info/status,
  effective-settings API-key proof, authenticated stop, and shared managed or
  OpenJDK Java. Listener-holder enumeration uses the current local user as its
  trust boundary and fails closed when no visible process maps a listening
  socket. Registration adds no Home 2 IPC/preload controls.
- [x] Add fail-closed macOS process/listener authority through a narrow
  versioned native helper. The packaged adapter binds the current effective
  UID, boot-session plus microsecond PID birth identity, raw argv, canonical
  cwd/JAR evidence, and complete listener-holder/socket evidence. Both x64 and
  arm64 helpers are built as exact executable resources; x64 compilation,
  live process/IPv4/IPv6 listener probes, symlink refusal, and packaged-bundle
  verification pass on macOS 12.7.6. Real Qortal start/relaunch/readiness/stop
  acceptance remains a release gate rather than an implementation claim.
- [x] Add validated fail-closed Windows x64 authority through the same narrow
  native-helper boundary. The adapter binds current-user SID,
  stable FILETIME PID birth identity, conservatively parsed raw command line,
  PEB cwd evidence, IPv4/IPv6 listener owners, and a no-reparse
  stable-file/private-DACL API-key read. Unsupported layouts and ambiguous
  command lines remain unknown. MSVC `/W4 /WX`, PE x64, native self-test, packaged-resource,
  protocol/adapter, Java-resolution, and real Windows install-lock CI pass. A
  real-Qortal start/relaunch/readiness/stop pass and signed artifact remain
  release gates. The sanitized native-host acceptance was completed through
  [issue #312](https://github.com/QortiumDev/qortium-home/issues/312) and its
  merged Windows evidence; adoption and Home 2 controls remain subsequent E2/E3
  work.
- [x] Add E3's internal adopted-install discovery and selected-record boundary:
  canonicalize and deduplicate explicit path, running-process, and Qortal Hub
  hints; keep multiple foreign candidates separate for user selection; store
  selected metadata only under Home app data; and revalidate exact JAR/settings
  identity without writing into the adopted directory. The production manager
  recognizes valid selected records but keeps install/update/start/stop disabled
  until adopted runtime authority is added. For a proven-stopped node it already
  derives conditional update ownership from the adopted settings. Windows
  record reads use the native
  no-reparse/private-DACL helper when available; any existing record that cannot
  be read securely remains unknown. No Home 2 IPC or renderer controls are
  exposed yet.
- [x] Extend E3 with guarded adopted-runtime control and explicit selection
  persistence. Supported POSIX hosts publish a private, atomic no-clobber
  selected record under Home app data, bound to the exact JAR and a bounded
  `settings.json` digest; Windows selection writes remain disabled until a
  native no-reparse/private-directory writer exists. A valid adopted runtime
  now starts as direct Java with its own cwd and literal `settings.json`, and
  stops only through the authenticated Qortal API with its existing key. Home
  revalidates record, target, process, listener, and API authority around each
  control boundary, never runs foreign scripts or kills an adopted PID, and
  leaves it running on Home exit. Packaged Linux uses Home's controlled
  argument-preserving wrapper to close inherited AppImage descriptors before
  `exec` replaces it with the exact Java process. A packaged Linux
  protocol-fixture run passed selection, ready start, Home exit with the node
  continuing, AppImage resource release, adopted-file immutability, and
  authenticated API-only stop. Selection and initial install use the same
  canonical lock key even before the managed install directory exists. Adopted
  install/update mutation and real-Qortal native-OS acceptance remain open.
- [x] Add the trusted-shell Qortal adoption selector. Candidate discovery runs
  only on demand; the main process returns bounded opaque tokens and redacted
  source/version/running summaries, while native browse returns no filesystem
  path to the renderer. Selection is accepted only from the exact authorized
  top-level Home document, then the main process revalidates the token and
  candidate before writing the selected record under Home app data. Home never
  writes into or modifies the adopted installation. Linux and macOS support
  browse and selection; Windows keeps both unavailable until its native helper
  can provide a no-reparse/private-directory writer. QDN apps and Android
  receive no discovery or selection surface; widget-window calls through the
  shared preload are denied by the exact Home-document sender gate. This
  trusted-host feature adds no public app action and keeps QAVS
  `platformVersion: "2.0"`.
- [x] Add the first sender-gated Home 2 Core-manager bridge for redacted
  Qortium/Qortal status plus start and stop. The exact trusted top-level shell
  document is authorized; widgets, subframes, destroyed senders, and navigated
  documents are denied before request parsing or manager lookup. Responses
  expose only allowlisted, versioned state/outcome fields, and every action
  receives a fresh normalized status after manager-side revalidation. Starts
  serialize across networks around shared managed Java, while same-network
  actions cannot overlap. Home 2 disables legacy Core/i2pd renderer broadcasts
  and does not register their ungated IPC handlers. Install/update, Java, i2pd,
  policy/progress, and management UI surfaces remain separate later tranches.
- [x] Extract node polling, parsing, mutation ordering, and Core lifecycle state
  from the live shell into one tested controller before adding management UI.
  Fresh permission-time node reads remain direct bridge calls, and rendered
  shell state no longer keeps a second shadow copy of node routes.
- [x] Add the first D6/F2 lifecycle surface: Qortium-first Core cards on the
  desktop Dashboard and in Runtime settings, driven only by the redacted
  manager contract. Actions preserve the selected node connection, adopted or
  externally controlled API stops require an in-app confirmation, stale
  responses fail closed, and Android omits the desktop controls deliberately.
  Install/update, Java, i2pd/transport, and policy panels remain open parts of
  D6/F2 rather than being implied complete by this lifecycle slice.
- [x] Restore the first Home self-update vertical slice in Home 2 Runtime
  settings on desktop and Android. Desktop uses a sender-gated, versioned
  main-process contract for fixed-repository discovery, release revalidation,
  mandatory SHA-256/size enforcement, verified download, and opaque-handle
  reveal; no URL or path crosses the renderer boundary. Android keeps its
  portable release adapter but applies official-URL and verified-digest checks,
  and the native installer re-hashes the canonical app-private APK before
  handoff. The stale legacy update smokes now target Home 2 and Android CI
  assembles the debug APK. That first slice deliberately left policy handling,
  release notes, signing, publication, and Core/Java/i2pd update surfaces for
  later tranches.
- [x] Persist Home's release channel and update policy. Desktop settings are
  sender-gated and main-process-owned, written atomically with private
  permissions and optimistic generations. Home 2's isolated desktop browser
  partition cannot read Home 1 renderer preferences, so the host begins with
  explicit Notify/Stable defaults rather than claiming a migration. Off
  suppresses startup work, Notify checks once per saved settings generation,
  and Download automatically saves a verified update under private Home data
  without opening or installing it. Android accepts the existing native
  preference enums, downgrades any old automatic value to Notify, and keeps
  manual verified APK updates; automatic download remains disabled until the
  complete discovery/download/receipt/install boundary is native and opaque.
  Release notes, signing, publication, managed Core/Java/i2pd maintenance, and
  that Android native prerequisite remain open.
- [x] Restore Android's host-triggered approved Qortium Core update path in
  Home 2 Runtime settings. The Android adapter owns a separate authenticated
  custom-node authority: its API key is Keystore-protected, bound to the exact
  HTTPS or loopback origin, redacted from node/QDN-app snapshots, and never
  advertised as an embedded-app admin capability. `/admin/update` responses
  are strictly reduced to bounded status fields, redirects are refused,
  install requests are single-flighted, and Home rechecks the same pinned
  node/key before POST while leaving an absent, downloading, installing, or
  Core-owned automatic update alone. Public nodes, Qortal, and Android local
  Core mode remain fail-closed.
- [x] Add the manual Qortium Core maintenance slice to desktop Runtime
  settings. Release discovery stays main-process-owned and selects the default
  Preview channel for initial install or the installed channel for a strictly
  newer update; exact official URLs, canonical SHA-256, positive size, tagged
  release revalidation, and exact-byte download verification are mandatory.
  The sender-gated renderer receives only version/channel/capability results
  and cannot request a downgrade, reinstall, raw asset, or Qortal mutation.
  Managed Java installs are single-flighted and publish immutable generations
  through atomic, generation-aware metadata so neither Core can lose files it
  already mapped. Automatic Core/Java policies, i2pd/transport, Qortal
  install/update, Android Core maintenance, and retired-Java cleanup remain
  later tranches.
- [x] Add desktop Home 2 automatic policies for Qortium Core and existing
  managed Java. Exact versioned settings live under private Home data with
  atomic generation-CAS replacement; a main-owned startup/six-hour scheduler
  performs no network work under Off and exposes only finite redacted activity.
  Notify discovers without mutation. Install uses the installed Core channel
  and the stopped-only strict-update transaction, or publishes a verified
  strictly newer immutable managed-Java generation. Policy and lifecycle
  changes revoke work before download and again at activation. Automatic initial install, channel
  switching, Qortal mutation, Android managed Core/Java maintenance, and
  i2pd/transport remain later work.
- [x] Add manual stable-only Qortal maintenance to desktop Runtime settings.
  A separate sender-gated Qortal contract keeps Qortium channel/Java policy
  semantics unchanged and accepts only an expected stable tag. The main
  process resolves that tag to an immutable official commit, refetches before
  mutation, and binds exact digest, size, embedded version, and embedded commit
  through the existing stopped-only transaction. Fresh Home-managed installs
  create private settings with Qortal native auto-update explicitly disabled;
  updates remain limited to stopped Home-managed installs whose settings prove
  Home owns replacement. Adopted or node-native-update installs stay
  observation/lifecycle-only. Conventional existing-install discovery blocks
  a duplicate initial install; the separate trusted-shell adoption selector can
  now bind a supported candidate without exposing its path or modifying it.
  Adopted-file mutation and Android Core maintenance remain later work.
- [x] Extend the existing desktop Core/Java policy store and scheduler with a
  stable-only Qortal policy. Off performs no Qortal status or release work;
  Notify reports a strictly newer release without mutation; Install can replace
  only a stopped Home-managed install whose settings prove Home owns GitHub
  updates. Missing, adopted, node-native, and uncertain installs perform no
  GitHub release request and remain non-mutating. Version-one policy files
  migrate in place without losing the existing generation or Core/Java choices,
  defaulting Qortal to Notify. Policy/lifecycle revocation is checked before the
  Qortal JAR download and again while acquiring the activation lease, which is
  held across the manager's repeated runtime/ownership barriers and filesystem
  transaction. Automatic initial install, adopted-file mutation, Android Core
  maintenance, signing, publication, and live-node acceptance remain separate.
- [x] Add manual Qortium transport and managed-i2pd maintenance in PR #323.
  Desktop Runtime settings apply a stopped-only transport change through a
  private atomic Core-settings replacement, and Home can install, start, and
  strictly update its own pinned i2pd generation after exact release, digest,
  byte-size, binary, process, and local SAM checks. Status remains redacted and
  sender-gated; local SAM readiness is not presented as network reachability or
  privacy proof. Android management, cleanup of retired generations, signing,
  publication, and live-network acceptance remain release/follow-up work.
- [x] Implement the F4 trusted QDN Apps Settings slice. This tranche
  edits already-persisted app assignments and summarizes notification grants on
  desktop and Android with optimistic revisions. Mute retains the grant, rules,
  and Core subscriptions; revoke deletes the grant and all rules, while warning
  that foreign-payment watch-only data already disclosed to a Core cannot be
  recalled. The desktop bridge exposes only redacted summaries to the exact
  authorized top-level shell and rejects widgets. This slice adds no public
  `SHOW_ACTIONS`, keeps QAVS `platformVersion: "2.0"`, and leaves app-facing
  delegation for the later G2 contract. The required tests, packaged desktop
  acceptance, Android debug build, and independent boundary review passed.
- [x] Carry the F5 Settings-section navigation concept into the Home 2 shell as
  typed, in-process state. Dashboard Core management can open Runtime settings
  directly, the former notifications target resolves to QDN Apps, and generic
  Settings navigation clears a prior target back to General. This does not add
  a URL, QDN app action, or public IPC request surface.
- [x] Record the two F6 presentation drops explicitly: Home 2 does not carry
  forward the legacy Classic/Modern/Fun UI-skin selector or the shortcut-hint
  rows beside text size and page zoom. The shortcuts themselves remain active;
  every other reviewed v1 Settings gap remains kept, migrated, or delegated.
- [x] Add the F8 Home 2 global app-notifications policy on desktop and Android.
  The standalone General Settings switch controls delivery only and preserves
  grants, mute state, rules, Core subscriptions, and OS permission. Desktop
  uses an exact sender-gated main-process file with generation CAS; Android
  migrates an explicit legacy disabled choice once into native Preferences.
  Missing state defaults on, corrupt or unavailable state fails closed, and
  notification delivery no longer consults the legacy display-settings store.
  This trusted setting adds no public QDN action and keeps QAVS
  `platformVersion: "2.0"`.
- [x] Restore the F9 saved-link collection authority on desktop and Android.
  The first Home 2 run imports the v1 bookmarks tree, toolbar, dashboard pins,
  start pages, visibility, and revision into an authoritative validated
  snapshot. Desktop crosses the deliberate Electron partition boundary through
  a one-shot hidden local migration document; Android uses the existing native
  Preferences keys plus a one-time marker. Raw schemas and equal-revision
  agreement are checked strictly, current or legacy corruption fails closed,
  canonical-last writes prevent partial mutations from advancing CAS,
  migration is idempotent, and the source data is retained. The QDN Bookmarks manager gets
  the existing schema, revision-CAS mutation contract, durable
  `bookmarks.manage` approval, and account-aware `BOOKMARKS_OPEN` behavior on
  both platforms. The trusted QDN Apps Settings surface lists and revokes each
  durable bookmark grant with an exact store-revision check. These newly
  advertised Home 2 actions advance QAVS
  `platformVersion` to `2.1`.
- [x] Retire the legacy v1 renderer entry path. Production and local desktop
  starts now load the built Home 2 renderer; the root development document is
  a v2-only redirect, while the old Vite config, React entry, monolithic `App`,
  v1 browser-chrome smoke, and tracked TypeScript cache are removed. The
  unreachable trusted-main/preload compatibility branches remain a separate
  security-reviewed cleanup rather than release-preparation churn.
- [x] Prepare Home 2.1.0 release metadata and mechanics. Desktop/package
  metadata is 2.1.0, Android is version name 2.1.0 and code 39, both Home 2
  hosts advertise QAVS 2.1 and host version 2.1.0, CI explicitly type-checks
  the renderer, and the release matrix includes the Catalina x64 DMG. The new
  runbook keeps native-host acceptance, signing, tagging, upload, and
  publication behind their explicit checkpoints.

## Required gates

- Add one plain-language `QORTIUM-HOME-CHANGELOG.md` entry whose title matches
  the PR/squash title.
- Run focused Home 2 foundation tests, the full test suite, the explicit
  renderer TypeScript check, and the production build.
- Exercise changed shell behavior in the packaged desktop application and keep
  Android renderer/build coverage green.
- [x] Verify packaged Qortal adoption discovery/selection with an isolated
  Linux x64 protocol fixture, including a private Home-owned selected record
  and byte-for-byte unchanged adopted JAR/settings files.
- Verify packaged selection on macOS, confirm the Windows rejection boundary
  on a packaged host, and preserve real-Qortal native-OS lifecycle acceptance
  as release gates. Android continues to expose no selector.
- Give preload expansion and adopted-install execution their own independent
  security-boundary review before merge.
- Do not sign, publish, or release without explicit approval.
