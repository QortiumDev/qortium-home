# ADR 0003: Isolated Home v2 Fixture AppImage

- Status: Accepted
- Date: 2026-08-08
- Applies to: Qortium Home 2.0 fixture foundation

## Context

The fixture shell needs visual testing in a real desktop package before any
production host adapter is connected. Loading it through the current Electron
main process would initialize wallet, Core, I2P, updater, QDN, notification, and
profile machinery even if the renderer never called those APIs. A build flag in
the production renderer would also make it too easy to package the wrong main
process or include dormant privileged code.

The final product still upgrades Qortium Home in place. A separately named
preview artifact is a temporary engineering fixture, not a second supported
product identity or a user-facing v1/v2 switch.

## Decision

Package the fixture through a separate, allowlisted build path:

1. Vite writes only the fixture page and bundled assets to
   `dist-v2-fixture/`.
2. a dedicated TypeScript configuration compiles only
   `electron/v2-fixture-main.ts` to `dist-electron-v2/`;
3. the staging script creates `.v2-fixture-package/` with only the renderer,
   one Electron main file, and a dependency-free package manifest; and
4. the dedicated electron-builder configuration packages that staging tree
   under app ID `org.qortium.home.v2preview` and writes it only to
   `dist-release-v2-fixture/`.

The minimal main process has no preload or IPC handlers. It uses a separate
`qortium-home-v2-fixture-preview` profile, enables Electron sandboxing and
context isolation, disables Node integration, developer tools, webviews, and
background networking, forces its in-memory session offline, denies device and
web permissions, downloads, redirects, and new windows, and prevents navigation
away from the fixture entry. HTTP, HTTPS, WebSocket, and secure-WebSocket
requests are also cancelled. The renderer Content Security Policy sets
`connect-src`, `media-src`, and `worker-src` to `none`.

The preview toolbar can switch between desktop/phone layouts and
Electron/Android fail-closed host fakes. Its bridge buttons only exercise local
permission-state transitions. They cannot call either public bridge.

## Consequences

- Testers can inspect navigation, responsive layout, tab behavior, unified
  identity presentation, and permission prompts in an AppImage.
- The artifact cannot inspect or migrate the current Qortium Home profile and
  cannot claim its single-instance lock.
- Production Home modules and dependencies are excluded rather than merely
  left unreachable.
- The preview has a distinct name and app ID so it cannot claim the current
  Home single-instance lock or profile path.
- This packaging route is removed when the real in-place v2 renderer replaces
  v1; it does not authorize a permanent dual-runtime product.

## Acceptance

- The fixture contract suite verifies both platform fakes fail closed.
- Static checks verify the minimal Electron security settings and packaging
  allowlist.
- The staged package manifest has no dependencies.
- The fixture renderer, minimal main process, production build, and Linux x64
  AppImage package complete without launching an application.
- Artifact contents are inspected before the AppImage is handed to a tester.
