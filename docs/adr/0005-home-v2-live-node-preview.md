# ADR 0005: Home v2 live node preview

Date: 2026-08-08

Status: accepted and implemented for the desktop preview

## Context

The fixture AppImage proved the Home v2 shell without allowing any production
capability. The next useful checkpoint is real Qortal and Qortium node status,
but connecting the fixture renderer to the broad Home 1.x preload would also
make account, signing, QDN, Core-management, updater, and filesystem operations
reachable before their v2 contracts have been reviewed.

App identity also needs an explicit source/target distinction. Qortium QDN
resources use `qdn://`; Qortal QDN resources use `qortal://`. A cross-network
app such as Chat is one source-qualified app and one browser tab even when its
operations can target both networks.

## Decision

- Build a temporary desktop live-preview artifact with its own Electron profile
  and product identity. This is a testing boundary, not a second product or a
  promise to maintain the old renderer.
- Use a separate v2 renderer entry and a scoped preload exposing only
  `getSnapshot()` and `setMode(network, mode)` for node connections.
- Gate the IPC handlers to explicitly authorized Home v2 window IDs. Do not
  expose a generic invoke function or the Home 1.x preload.
- Reuse the retained Qortium node service and add an independent Qortal node
  service. Both implement Disabled, Local, Public, and Custom modes.
- Treat the selected mode as exact. Local and Custom failures remain visible;
  they never silently fall back to Public. Failover may occur only among
  candidates inside Public mode.
- Require a Public candidate to report a positive height, 100% sync, and no
  active synchronization, then pass a public read probe before selection.
  Reject contradictory optional phase or remaining-block fields when supplied.
- Return normalized status only: endpoint, mode, reachability, sync, height,
  peers, timestamps, errors, and read capability. Never return an API key,
  account material, or private node credentials.
- Keep the first live slice desktop-only. Android and the browser fallback must
  adopt the same exact-mode contract before parity is claimed.

## Consequences

The preview can display real Qortal and Qortium node state and safely persist
connection-mode choices in its isolated profile. It cannot select or unlock an
account, load QDN apps, sign, publish, control Core, access updates, or start
Reticulum. Custom mode exists in the contract but cannot be selected until an
endpoint has been configured; the preview does not yet contain that editor.

The packaged main process still carries retained production modules because it
is compiled from the existing Electron graph. Runtime registration and renderer
reachability are constrained, but a later packaging-hardening tranche should
reduce the archive to the exact live-preview dependency graph.

## Verification

```bash
npm run test:home-v2-foundation
npm run test:qortal-node-settings
npm run test:wiring
npm run build:v2-live
npm run dist:linux:x64:v2-live
```

The artifact audit verifies Electron fuses, the v2-only renderer, the scoped
preload channels, the absence of the Home 1.x renderer, and a renderer CSP that
denies direct outbound connections.
