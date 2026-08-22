# Qortium Home 2.1.0 delivery plan

Last updated: 2026-08-22

Status: active. Home 2.0.0 at `5606faa` is the implementation baseline.

This document is the repository's product and release authority for 2.1.0.
Maintainers may keep a more detailed private task tracker with verified source
anchors and review evidence, but it is subordinate to this plan and may not
change release decisions or security boundaries on its own.

## Release decision

Home 2.1.0 is one combined feature prerelease. The release adds substantial
trusted-shell and managed-service behavior, so it uses a minor application
version rather than a 2.0.1 patch version.

The QAVS compatibility level remains `platformVersion: "2.0"` only if a final
bridge audit proves that the release advertises exactly the same actions and
observable semantics as 2.0.0. `SHOW_ACTIONS` supports runtime discovery but
does not replace manifest compatibility: if required bookmark/delegation work
adds an advertised action or app-observable behavior, the platform level also
advances to 2.1. Android advances from version code 38 to 39 during release
preparation.

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
  release gates; the sanitized native-host acceptance is tracked in
  [issue #312](https://github.com/QortiumDev/qortium-home/issues/312). Adoption
  and Home 2 controls remain subsequent E2/E3 work.
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

## Required gates

- Add one plain-language `QORTIUM-HOME-CHANGELOG.md` entry whose title matches
  the PR/squash title.
- Run focused Home 2 foundation tests, the full test suite, the explicit
  renderer TypeScript check, and the production build.
- Exercise changed shell behavior in the packaged desktop application and keep
  Android renderer/build coverage green.
- Give preload expansion and adopted-install execution their own independent
  security-boundary review before merge.
- Do not sign, publish, or release without explicit approval.
