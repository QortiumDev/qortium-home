# Qortium Home 2.1.0 delivery plan

Last updated: 2026-08-21

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
