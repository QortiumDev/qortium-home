# Qortium Home 2.0 Project Plan

Last updated: 2026-08-08

Status: accepted product direction with the fixture-only Phase 1 foundation
implemented. No live v2 host adapter or migration has started.

This is the canonical product and architecture plan for Qortium Home. When an
older issue, note, or implementation assumption conflicts with this document,
this document controls unless a newer recorded decision explicitly supersedes
it.

## Product vision

Qortium Home 2.0 is an app-focused client and trusted host for Qortium and
Qortal. It should be capable of replacing Qortal Hub for users who want a
cleaner, more predictable experience while preserving Qortium Home's strict
app isolation, permissions, managed services, and multi-platform foundation.

Home is not a monolithic social portal. It provides a stable Dashboard, app
launcher and browser, unified identity, wallet custody, node and service
management, permissions, signing mediation, notifications, downloads, and
operating-system integration. Full Chat, Wallets, Groups, Explorer, publishing,
trading, and similar experiences belong in QDN apps.

The product remains Qortium Home and upgrades in place. There will not be a
separate side-by-side v2 application identity or a maintained legacy renderer.

## Adopted decisions

| Area | Decision |
| --- | --- |
| Product shape | Familiar global browser shell. Dashboard and internal pages occupy browser tabs; QDN apps open as peer tabs, never inside Dashboard. |
| Landing page | Keep the name `Dashboard`. Do not create a page named Home inside Qortium Home. |
| Startup | No login wall. Restore the last selected account; Dashboard also works with no account or a locked account. |
| Unlock persistence | Optional secure-device unlock only; `Lock on exit` defaults on, manual lock persists, and plaintext password storage is forbidden. |
| Connections | Qortal and Qortium independently use Disabled, Local, Public, or Custom modes. Public access is not called Previewnet. |
| Visual language | Warm neutral tan/parchment light mode and chocolate-gray dark mode, with restrained clay/copper accents rather than green- or blue-led themes. |
| Feature ownership | Chat, Wallets, Groups, Explorer, publishing, markets, and similar full experiences are QDN apps. |
| Identity | Present one user-facing identity with separately labelled Qortal and Qortium network presences. |
| Bridges | Preserve `qdnRequest` and `qortalRequest` as separate public protocols over shared typed services where semantics match exactly. |
| Q-App compatibility | Target the complete Q-App-facing `qortalRequest` surface, implemented and verified action by action. |
| Licensing | Keep Home and first-party apps 0BSD wherever possible. Treat GPL Hub/HubCE code as behavioral reference, not copyable implementation. |
| Upgrade model | Replace the current renderer in place; freeze and retire v1 rather than maintaining two interfaces. |
| Platforms | Desktop and Android are co-primary from the first v2 contracts and fixture slice. |
| Reticulum | Optional Home-managed subsystem, available to both Qortal and Qortium with substantially more user control than Hub. |
| Working name | Use Qortium Home 2.0 until a different final name is explicitly chosen. |

## Product terminology

- **Identity**: the person/account concept shown to the user.
- **Network presence**: one identity's independently resolved state on Qortal or
  Qortium, including address validity, names, avatars, groups, and activity.
- **Wallet**: an encrypted seed container held by Home.
- **Operation context**: trusted identity, wallet, target network, node,
  application, tab, and permission information attached to one request.
- **QDN app**: an `APP` or `WEBSITE` resource hosted by Home from Qortal or
  Qortium QDN.
- **Default app**: a recommended or initially pinned QDN app. Default does not
  mean built into the renderer or impossible to remove.
- **Trusted shell**: Home-owned code that can reach native APIs, wallet material,
  nodes, managed services, and operating-system functions.

## User experience

### Stable shell

The shell should be calm, app-focused, and immediately familiar as a browser:

- One global tab strip and browser toolbar outside page content rather than a
  sidebar or nested app tabs inside Dashboard.
- Dashboard, Apps, Activity, and Settings as internal browser destinations;
  QDN apps open as top-level peer tabs.
- One compact context surface showing the active identity, address/destination,
  and both Qortal/Qortium node capabilities.
- Browser-like tabs with independent history, reliable back/forward behavior,
  desktop context menus and shortcuts, and clear mobile equivalents.
- User-organized apps, folders/sections, search, bookmarks, downloads, and
  notifications.
- Visible loading, offline, permission, node-capability, and recovery states.
- One Settings surface; apps may own their domain preferences but must not
  create competing Home settings centers.
- Light/dark themes, scalable text, keyboard access, reduced-motion support,
  screen-reader semantics, localization, and RTL considered from the component
  foundation rather than added after feature work.

### Dashboard

Dashboard is the Home landing page. It should borrow the useful clarity of a
Hub homepage without reproducing Hub 2.x's dense operations wall.

Dashboard may contain configurable, progressively disclosed modules for:

- Unified identity summary with Qortal and Qortium names/avatars.
- Recently used, pinned, and recommended apps.
- Concise Qortal and Qortium node/Core status.
- Wallet lock/availability summary without becoming the Wallets application.
- Reticulum status when the optional subsystem is installed or enabled.
- Recent relevant activity and actionable failures.
- User-selected quick actions and contextual app handoffs.

Dashboard must not mix every node detail, social feed, promotion, wallet
operation, and onboarding task into the default view. Detailed diagnostics
belong behind summaries. Promotional or AI modules are optional and removable.

Dashboard is available without an account and never becomes a login gate. It
shows both network connection controls before unlock. With a last-used account,
it shows the selected identity and its labelled Qortal/Qortium presences in
either locked or unlocked state.

### Startup, lock, and connection state

- Restore the last selected identity independently of whether it is unlocked.
- `Lock on exit` is enabled by default for each account/device pairing.
- A user may opt into remembered unlock only through suitable OS secure storage
  or Android Keystore-backed storage; never store a plaintext password.
- Manual lock clears pending privileged work and persists until an explicit
  unlock.
- No-account and locked states retain Dashboard, public apps, and account-
  independent node controls.
- Each network independently exposes Disabled, Local, Public, and Custom node
  modes. “Public” replaces the old Previewnet-facing label in Home.

## Trusted shell and app boundary

### Home owns

- Wallet creation, import, encrypted persistence, backup, lock/unlock, and
  in-memory signing authority.
- Unified identity selection and cross-network identity resolution.
- Target-network and node routing.
- Permission prompts, grants, revocation, and request auditing.
- Transaction review, typed intent validation, signing, and broadcast.
- QDN content isolation and app lifecycle.
- Navigation, tabs, downloads, viewers, notifications, and native file/OS UI.
- Managed Qortium Core, Java, I2P, Reticulum, updates, recovery, and diagnostics.
- Signed application updates, forward migrations, and profile recovery.

### QDN apps own by default

- Chat and social presentation.
- Wallet balances, history, receive/send composition, and asset presentation.
- Groups, names, polls, profiles, trust, explorer, publishing, and markets.
- App-specific state, filtering, layout, and domain settings.

Apps never receive wallet seeds, private keys, Core API keys, unrestricted node
access, or generic native-process authority. Sensitive work is requested through
the host and confirmed in trusted Home UI.

## Unified cross-network identity

The user should not have to reason about two unrelated account personas simply
because Qortal and Qortium are separate chains.

### Resolution model

Given an address, Home queries both configured networks and returns one identity
record containing independently labelled presence records:

```text
IdentityRecord
  inputAddress
  walletReference?       private host metadata; never returned to apps
  qortalPresence?
    address, publicKey?, names, primaryName?, avatar?, groups?, status
  qortiumPresence?
    address, publicKey?, names, primaryName?, avatar?, groups?, status
```

- Preserve differences between the two networks rather than choosing a silent
  canonical name or avatar.
- An unavailable node produces an explicit unknown/unavailable presence, not a
  false absent identity.
- Batch identity lookups must not download all avatars. Resolve metadata first
  and fetch bounded pointer-aware avatar content only for visible identities.
- Matching an address across networks groups the visible records but does not
  authorize signing on either network.
- A future link between different addresses requires cryptographic proof from
  both keys. Matching names, avatars, or user claims are insufficient.

### Operational safety

The user-facing identity is unified; privileged operations are not
network-ambiguous. Every protected request includes a trusted target network,
identity, wallet/account reference, node profile, app identity, and tab/session.
Changing any relevant element invalidates pending approvals and affected grants.

## App hosting and cross-network apps

Home may host QDN apps sourced from Qortal or Qortium. Resource name equality is
not code identity.

- Track source network, service, name, identifier, version, and content hash.
- Existing Qortal Q-Apps receive compatible `qortalRequest` behavior.
- Existing Qortium apps retain strict object-form `qdnRequest` behavior.
- A cross-network app may receive both facades only through explicit host
  capability policy; the two facades do not collapse into one ambiguous API.
- First-party default apps may publish reviewed equivalent bundles to both QDN
  networks, but Home verifies exact identity and content rather than trusting
  matching names.
- A future typed Home SDK may orchestrate both facades for new apps. It must not
  replace or silently modify either compatibility protocol.

Desktop continues using isolated `WebContentsView` content with separate
sessions and denied native Chromium permissions. Android uses Home-owned,
tokenized Capacitor/WebView hosting with exact-origin, source-window, token, and
freshness validation. The security guarantees should match even when the native
implementations differ.

## Bridge architecture

```text
Qortal Q-App  -> qortalRequest --+
                                  +-> protocol adapters
Qortium app  -> qdnRequest -------+          |
                                             v
                              trusted operation context
                                             |
                              capability and permission policy
                                             |
                     +-----------------------+-----------------------+
                     |                                               |
              Qortal services                                Qortium services
                     |                                               |
              configured node                                configured Core
```

### Public protocol rules

- `qortalRequest` and `qdnRequest` keep their own action names, payloads,
  results, error envelopes, timeouts, and transport behavior.
- A matching action name is not evidence that semantics match.
- Share an internal handler only when request meaning, security policy, and
  transaction intent can be represented losslessly. Adapt the public result at
  the protocol edge.
- Network comes from trusted view/capability context, never an untrusted payload
  field alone.
- Public/network nodes expose only bounded public reads and operations that can
  safely complete without a private/admin API. Local or trusted custom nodes are
  required for protected node operations.
- `SHOW_ACTIONS` reports what can actually succeed for that app, platform,
  identity, network, node mode, and current capability state.
- Account, network, node, URL/navigation, or app-identity changes revalidate
  capabilities and pending approvals.

### Complete `qortalRequest` compatibility

The target is complete support for Q-Apps, not a permanent subset. Compatibility
is versioned against the pinned Hub v3 contract and refreshed when upstream
changes.

Maintain an action ledger with, at minimum:

- Action and aliases.
- Request schema and defaults.
- Result and error shape.
- Timeout/cancellation behavior.
- Required identity, node mode, unlock, and network capability.
- Permission prompt and grant lifetime.
- Desktop and Android handler/transport.
- Shared internal service or Qortal-specific implementation.
- Positive, denial, unavailable, stale-context, and malformed fixtures.

Implement action families in increasing risk order:

1. Host discovery, identity, public node reads, navigation, and QDN resources.
2. Lists, names, groups, polls, and classic public chat.
3. QDN writes, group/name mutations, and typed QORT payments.
4. Private chat and encryption/decryption families.
5. Foreign wallets, trade orders, AT deployment, and system/admin operations.
6. Raw/generic signing only if a narrow reviewed contract cannot satisfy the
   compatibility requirement safely.

During implementation, individual actions may be advertised as they pass their
gates. “Complete Q-App compatibility” may be claimed only when every promised
action passes the ledger on its supported contexts. Home may use stricter,
clearer confirmation than Hub without exposing keys or reproducing unsafe broad
session grants.

### `qdnRequest` evolution

Keep the current strict Qortium contract and its public/trusted-node separation.
New cross-network helpers should not duplicate `qortalRequest`; they should add
genuinely Qortium- or Home-specific behavior. Existing Qortal-prefixed
`qdnRequest` helpers may remain for compatibility, but new unified apps should
prefer the native facade for each network.

Desktop and Android bridge handlers remain platform adapters, not duplicated
domain implementations. Move validation, schemas, permission decisions, typed
intents, and pure response mapping into runtime-free shared modules with parity
tests guarding both native paths.

## Permissions and signing

- Seeds and private keys remain in trusted native memory only while unlocked.
- Apps request typed intent, never arbitrary key access.
- Transaction confirmations show network, identity, address, asset, amount,
  recipient, fee, app, and node route as applicable.
- Mutations default to per-request confirmation. Session/durable grants require
  a specific low-risk design and remain scoped by app, identity, network, and
  capability.
- Raw signing, private decryption, administration, trading, and server-control
  actions receive dedicated threat models before implementation.
- A grant from v1 is never migrated into v2.
- Pending approvals fail closed after navigation, account, node, network,
  capability, or lock-state changes.
- Generic node fetches remain bounded and protected against cross-origin access,
  SSRF, API-key disclosure, oversized responses, and write-method escalation.

Wallet and signing code remains explicitly pre-production until it has a
replacement-grade security review and controlled funded acceptance.

## Optional Home-managed Reticulum

Reticulum is a Home-managed communication subsystem analogous to managed I2P,
but it is optional, separately controlled, and usable for both Qortal and
Qortium namespaces.

### Responsibility split

- A chain-neutral engine owns Reticulum transport, signed-event storage,
  replication/repair, attachments, and quotas.
- Qortal and Qortium adapters resolve addresses, names, membership, admin
  authority, and network-specific authorization through configured nodes.
- Home owns install/update verification, lifecycle, health, permissions, wallet
  signing mediation, diagnostics, and recovery.
- The Chat QDN app owns presentation, combined/separate network views, search,
  unread state, calls, and user workflows.

### Required user controls

Reticulum is disabled until explicitly enabled or accepted during onboarding.
Home exposes:

- Install/uninstall and master enable/disable.
- Start automatically with Home or start manually.
- Qortal only, Qortium only, or both namespaces.
- Bootstrap peers/hubs and advanced transport configuration.
- Connection, peer, sync/repair, and health status.
- Storage location, quota, retention, and cleanup policy.
- Attachment download, voice/call, and presence controls.
- Desktop background behavior and Android battery/mobile-data/background policy.
- Diagnostic logs and safe export.
- Reticulum identity backup, import, and deliberate reset.
- Immediate stop/disable without deleting identity or history.
- Separate confirmations for destructive history, resource, or identity removal.

No shared mesh credential is treated as user authorization. Authorization comes
from signed identities and current network-specific membership/admin rules.
Private local content, at-rest encryption, group encryption, metadata leakage,
and retention require an explicit threat-model decision rather than assumptions
based on Reticulum link encryption.

### Portability and interoperability

The event model, canonical serialization/signing vectors, database migrations,
repair algorithm, authorization interfaces, and resource limits are shared
across platforms. Electron may supervise a native service; Android uses a
native/background-service adapter. Do not adopt an Electron-only Python plus
`better-sqlite3` design and defer mobile as a rewrite.

Hub interoperability requires clean implementation or separately licensed
code. Do not claim compatibility until current Hub v3 and Home exchange events
bidirectionally and pass restart/offline repair, gaps, metadata, edits/deletes,
mentions/read state, channels, attachments/resources, DMs, multi-device,
authorization, replay, malformed-input, quotas, migration/recovery, discovery,
and packaged desktop/Android tests. A handshake or one exchanged message is not
sufficient.

## Target architecture

The first implementation adds boundaries without forcing a monorepo conversion:

```text
renderer-v2/
  shell/                 Dashboard, launcher, tabs, navigation and context
  builtins/              vault/recovery, nodes, permissions and app management
  design-system/         tokens, primitives, responsive and accessibility rules

platform/
  contracts/             runtime-free identity/network/host contracts
  product-model/         tabs, routes, workspaces and active context
  app-host/              app identity, lifecycle and events
  permissions/           capabilities, grants, prompts and audit records
  navigation/            typed intents, links, downloads and viewers
  notifications/         subscriptions, badges and click routing

identity/
  resolver/              Qortal and Qortium presence aggregation

chains/
  qortal/                node, QDN, transactions and authorization adapters
  qortium/               Core, QDN, assets, trust and transaction adapters

bridges/
  qortal-request/        exact compatibility adapter and conformance fixtures
  qdn-request/           strict Qortium adapter and contract fixtures

communications/
  reticulum/             portable event, storage, repair and transport boundary
  authorization/         network-specific signer/member/admin validation

hosts/
  desktop/               Electron, WebContentsView, native services and OS UI
  android/               Capacitor/WebView, native plugins/background services
  vault/                 encrypted catalogue and in-memory unlock/signing
  managed-services/      Core, Java, I2P and Reticulum lifecycle
  release/               signed updates, backup, migration and recovery

test-kit/
  fixtures/              identities, nodes, apps, permissions and events
  hosts/                 throwing fake host plus desktop/Android contract fakes
```

`src/App.tsx`, `src/platform.ts`, `electron/qdn.ts`, `src/styles.css`, and
`electron/core-manager.ts` are migration sources, not target architecture.
Extract contracts incrementally and move behavior only after focused fixtures
exist.

## Retained foundations

Preserve and adapt rather than rewrite casually:

- Electron `WebContentsView` isolation and sandboxed preloads.
- Android tokenized WebView bridge validation.
- Encrypted Hub-compatible wallet files, multiple loaded wallets, derived
  addresses, and in-memory unlocked seeds.
- Managed Core, Java, I2P, release verification, update, recovery, and node
  capability logic.
- QDN browser, viewers, downloads, tabs, bookmarks, notifications, app
  assignments, and QAVS support.
- Existing strict `qdnRequest` actions, typed wallet capabilities, and parity
  tests.
- Linux, macOS, Windows, and Android packaging/signing workflows.

Freeze the v1 renderer. Do not spend v2 time cosmetically redesigning it. Remove
replaced paths as the v2 shell gains required host capabilities; do not ship a
user-selectable dual-renderer product.

## Desktop and mobile platform policy

Desktop and Android are co-primary product targets:

- Shared product, identity, bridge, permission, and communications contracts.
- Shared fixture scenarios and responsive UI acceptance.
- Platform-specific host adapters where native capabilities genuinely differ.
- No Electron-only domain rules hidden in renderer components.
- No Android reimplementation of transaction, permission, or protocol policy in
  `src/platform.ts` after shared services exist.
- Every retained or new privileged contract identifies desktop and Android
  implementation and test coverage before it is considered complete.
- Real connected-phone acceptance is a routine gate when runtime testing is in
  scope, alongside desktop packaged-app acceptance.

Android connects to configured nodes rather than embedding blockchain Core.
Mobile Reticulum requires a native/background service and explicit battery,
data, and notification behavior. iOS should remain architecturally possible,
but Android is the current mobile release and local-device acceptance target;
an iOS release schedule remains a separate decision.

## Upgrade and migration policy

- Qortium Home v2 uses the existing application identity and data location.
- Use versioned, forward-only migrations with a preview/validation stage where
  practical.
- Create a pre-migration profile backup and provide recovery tooling.
- Migrate encrypted wallet catalogues, wallet labels, node profiles, apps/pins,
  bookmarks, and compatible user settings.
- Never migrate unlocked state, decrypted secrets, pending approvals, or old
  app permission grants.
- Preserve explicit network/source identity for migrated QDN apps and links.
- Explain one-way migrations and compatibility changes before applying them.
- Do not maintain the old UI as a fallback product. Source history and profile
  recovery are engineering safeguards, not a second supported experience.

## Licensing and provenance

Home and first-party v2 QDN apps remain 0BSD wherever possible.

- Maintain a provenance and dependency-license ledger for imported libraries,
  protocol inputs, generated assets, and adapted components.
- Use Qortal Hub and HubCE GPL source to understand observable behavior and
  interoperability requirements; do not copy implementation into 0BSD code.
- Treat archived projects without explicit licenses as conceptual references.
- For RCHAT, prefer a compatible independently licensed engine, separately
  granted permission, or clean implementation from a frozen protocol plus
  golden vectors.
- Pin exact dependency versions, commits, artifact hashes, and build inputs for
  managed/native components.
- A future request to incorporate differently licensed code requires a recorded
  policy decision before implementation or distribution.

This is an engineering provenance policy, not legal advice.

## Delivery phases

### Phase 0: planning and preservation

- Keep this document canonical.
- Preserve exact Hub `v1.0.1`, `v2.0.1`, and `v3.0.0` reference commits.
- Preserve dirty/staged archive references before any cleanup.
- Freeze v1 feature/UI expansion except security, migration, or release-critical
  fixes.
- Establish the provenance/license ledger and versioned compatibility ledgers.

### Phase 1: fixture-only v2 foundation

- Add runtime-free identity, network, operation-context, capability,
  permission, host, and product-model contracts.
- Add `MockHost`; network, filesystem, vault, signing, and native-service calls
  throw by default.
- Build Dashboard, launcher, tabs, unified identity presentation, and permission
  dialogs from synthetic data.
- Include at least one mock `qdnRequest`, one mock `qortalRequest`, and one
  deliberate wrong-network rejection.
- Run the same fixtures at desktop and phone layouts through Electron and
  Android host fakes.

No real wallet, address, API key, Core, network, or QDN resource is reachable in
this phase.

Status on 2026-08-08: complete. The runtime-free product model preserves app tabs
across Dashboard navigation and keeps separate, visibly labelled Qortal and
Qortium contexts. Fixture-only `qdnRequest/PUBLISH_QDN_RESOURCE` and
`qortalRequest/GET_USER_ACCOUNT` adapters feed an account-, app-, network-,
node-, and tab-scoped permission broker and responsive dialogs. The Qortal
account fixture deliberately grants no implicit extra capabilities. Explicit
Electron and Android host fakes run the same model and throw on every privileged
capability. A separately packaged preview AppImage uses a minimal Electron main
process and isolated staging tree, with no production Home dependencies or live
host reachability. Its global browser chrome starts with Dashboard only, opens
QDN apps as peer tabs, exercises no-account/locked/unlocked startup states,
independent four-mode Qortal/Qortium connection controls, and warm neutral light
and dark themes at desktop and phone widths. No live host adapter is authorized
yet.

### Phase 2: retained host adapters and read-only slice

- Wrap existing Electron and Android host APIs behind the new contracts.
- Connect app catalogue, app assignments, bookmarks, tabs, downloads, and node
  status one service at a time.
- Add batched Qortal/Qortium identity resolution and pointer-aware visible
  avatars.
- Connect read-only bridge families and capability reporting.
- Preserve app isolation and immutable operation context.

### Phase 3: app-first default experiences

- Define exact cross-network identities and publish/release process for default
  Dashboard-linked apps.
- Adapt/build cross-network Chat and Wallets QDN apps against host-mediated
  capabilities.
- Add typed cross-app intents such as Profile -> Trust and Core -> Minting.
- Prove notification, unread, deep-link, download, and context routing on
  desktop and Android.

### Phase 4: complete Qortal compatibility

- Implement and fixture every promised `qortalRequest` action family.
- Share internal services with `qdnRequest` only after lossless-contract proof.
- Complete node-mode, permission, denial, timeout, stale-context, and malformed
  behavior.
- Validate representative unchanged Q-Apps on desktop and Android.
- Do not expose raw signing or private-key access as a shortcut to parity.

### Phase 5: wallet and mutation hardening

- Complete the wallet/signing threat model and independent review plan.
- Connect typed Qortal and Qortium transaction intents.
- Validate backup, lock/unlock, identity selection, fees, approval, signing,
  broadcast, retry, and failure recovery.
- Perform controlled funded acceptance only through a separately approved plan.

### Phase 6: optional cross-network Reticulum

- Freeze a licensed protocol/engine path and golden vectors.
- Implement Home-managed lifecycle and all required user controls.
- Implement shared event/storage/repair contracts with desktop and Android
  adapters.
- Integrate Qortal and Qortium authorization namespaces.
- Connect the cross-network Chat QDN app.
- Complete interoperability, privacy, quota, corruption, recovery, malformed
  peer, and multi-device gates.

### Phase 7: in-place migration and release acceptance

- Implement profile backup and forward migration.
- Remove replaced v1 renderer paths.
- Validate unchanged wallets, node profiles, apps, bookmarks, and settings.
- Complete packaged Linux, macOS, Windows, and signed Android acceptance.
- Publish only after explicit release approval; no task in this plan implies
  permission to sign, push, publish, or move funds automatically.

## Acceptance gates

### Shell and apps

- Dashboard is useful without becoming an operations wall.
- No nested Home destination exists.
- Chat and Wallets work as replaceable/default QDN apps.
- Navigation, context menus, keyboard behavior, responsive layouts, text scale,
  reduced motion, localization, and RTL have explicit acceptance coverage.

### Identity

- Address lookup distinguishes unavailable, absent, and present on each network.
- Names and avatars from both networks are visible and labelled.
- Cross-address linking cannot occur without proof from both keys.
- No signing or grant authority is inferred from visual identity matching.

### Bridges

- Every advertised action has payload, result, error, timeout, permission,
  node-mode, and desktop/Android fixtures.
- Wrong-network requests fail before any adapter/node call.
- `SHOW_ACTIONS` is truthful for current runtime capability.
- App, navigation, identity, network, node, and lock changes invalidate affected
  approvals and grants.
- Existing Qortal Q-Apps and Qortium apps run without protocol rewrites within
  the declared compatibility version.

### Reticulum

- Optional means no daemon, background use, presence, call, or network activity
  without explicit enablement.
- Users can stop transport without deleting identity/history.
- Qortal and Qortium namespaces can run separately or together.
- Desktop and Android share protocol vectors and interoperate.
- Hub compatibility is demonstrated through complete event and repair behavior,
  not a handshake or single message.

### Release

- Current v1 data migrates in place with a verified backup.
- Wallet secrets and permissions do not migrate unsafely.
- Linux, macOS, Windows, and Android packages pass platform task acceptance.
- Artifact provenance, hashes, signing state, update behavior, and recovery are
  explicit and verified.

## Open questions

- Final product name beyond the working Qortium Home 2.0 label.
- Exact configurable Dashboard module set beyond Connections, Account, and
  Pinned Apps.
- Exact portable Reticulum engine/language and compatible dependency set.
- Whether at-rest encryption is mandatory for all Reticulum databases or only
  private/direct content, and how keys are recovered across devices.
- Qortal Hub compatibility versioning policy after the pinned v3 baseline.
- Which advanced Q-App actions, if any, need a narrowly compatible deviation
  because Hub's permission behavior is too broad.
- When iOS becomes an active release target rather than architecture-only
  compatibility.
- Production code-signing/notarization policy for Linux, macOS, Windows, and
  Android.

## Completed foundation tranche

After this planning commit is accepted:

1. Add a v2 architecture decision record and provenance ledger template.
2. Add the minimal runtime-free identity/network/operation-context contracts.
3. Add a throwing `MockHost` and synthetic fixtures.
4. Scaffold Dashboard and launcher against those fixtures only.
5. Add desktop and phone-layout contract tests before connecting real services.

Stop before real wallet, node, Reticulum, or signing integration and review the
fixture shell and contracts as a separate checkpoint.

Status on 2026-08-08: this tranche and the remaining Phase 1 tab, mock bridge,
permission, Electron-host-fake, Android-host-fake, and isolated preview-package
work are implemented on the dedicated `codex/home-v2` branch. The next code
tranche is Phase 2's retained-host-adapter and read-only slice. It requires a
separate review before any current profile, node, wallet, bridge, or QDN app is
connected.
