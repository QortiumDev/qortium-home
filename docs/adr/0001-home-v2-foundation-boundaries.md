# ADR 0001: Home v2 Foundation Boundaries

- Status: Accepted
- Date: 2026-08-08
- Applies to: Qortium Home 2.0

## Context

Qortium Home already contains valuable desktop and Android infrastructure for
accounts, nodes, QDN content, permissions, updates, and native services. The
current renderer grew around that infrastructure, however, and now coordinates
too many unrelated concerns through a few large modules. A visual refresh inside
that renderer would retain the same coupling, while a new repository would put
the existing security and packaging work at unnecessary risk.

Home 2.0 also has stronger product constraints than the existing renderer:

- Dashboard is the landing page; there is no page named Home inside Home.
- Chat, Wallets, Groups, Explorer, and similar experiences are QDN apps.
- One selected identity exposes separately labelled Qortal and Qortium
  presences. It is not represented as two unrelated app identities.
- Every operation remains explicitly bound to one network, account/wallet,
  node profile, app, and tab.
- `qdnRequest` and `qortalRequest` keep their exact public contracts. Internal
  services may be shared only when the translation is lossless.
- Desktop and Android are co-primary product targets.
- Reticulum is optional, Home-managed native infrastructure with explicit user
  control. It is not part of this foundation tranche.

## Decision

Build a new v2 renderer and product model additively inside this repository.
Keep the proven platform implementation in place and move it behind narrow,
typed adapters as later vertical slices are connected. The old renderer is
frozen except for critical maintenance and will be retired rather than carried
as a permanent alternate product.

The first implementation lives under `src/v2/` and follows these boundaries:

1. React components consume immutable snapshots and injected host contracts.
   They do not import Electron modules or call `window.qortiumHome`.
2. Network, address, wallet, app, tab, and node identifiers remain explicitly
   typed. An operation cannot omit its target network.
3. The fixture host supplies synthetic read models only. Network, filesystem,
   vault, signing, and managed-service methods throw a stable boundary error.
4. Qortal and Qortium identity presences can be displayed together, but their
   addresses, names, avatars, nodes, assets, permissions, and transactions are
   never silently merged.
5. Wrong-network operations are rejected by policy before any platform adapter
   can be invoked.
6. Desktop and phone layouts render from the same product model and components.
7. Source from GPL projects is behavioral reference material only unless a
   later licensing decision explicitly changes that rule.

This tranche is intentionally not wired into `src/App.tsx`. It establishes a
testable seam before any live migration begins.

## Consequences

- The existing app identity and repository history are preserved.
- New v2 work can be reviewed without changing the current runtime.
- Platform adapters can be introduced one read-only capability at a time.
- Exact bridge compatibility can be tested independently from UI components.
- Some implementation temporarily exists beside the old renderer, but the
  duplication has an explicit retirement goal rather than becoming a supported
  v1/v2 product switch.
- Reticulum protocol, licensing, dependency pinning, Android architecture, and
  interoperability remain separate gated decisions.

## Non-goals for the foundation tranche

- No wallet discovery, unlock, seed handling, signing, sending, or broadcast.
- No Core, node, HTTP, QDN, filesystem, or operating-system access.
- No real `qdnRequest` or `qortalRequest` transport.
- No Reticulum daemon, database, bridge, or network connection.
- No migration of existing settings or app data.
- No user-facing switch to the v2 renderer.

## Acceptance criteria

- A fixture Dashboard and app launcher render in desktop and phone layouts.
- The same synthetic identity shows labelled Qortal and Qortium presences.
- All privileged fixture-host methods fail closed with a stable error.
- A wrong-network operation fails before the supplied adapter callback runs.
- Source checks prevent v2 UI code from reaching current global bridge or live
  network APIs.
- Type checking, the focused contract test, test wiring, and the production
  build pass without opening an application.
