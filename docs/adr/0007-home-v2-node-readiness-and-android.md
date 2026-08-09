# ADR 0007: Home v2 node readiness and Android adapter

Date: 2026-08-08

Status: accepted and implemented for the live preview

## Context

The desktop node slice could report whether its selected endpoint responded,
but it could not distinguish a stopped local Core from a missing installation.
It also had no endpoint editor or Android implementation. Importing the legacy
Android platform bridge would expose unrelated wallet, QDN, update, and native
operations before their Home v2 contracts have been reviewed.

## Decision

- Detect local desktop installations read-only and independently of selected
  mode. Do not expose discovered filesystem paths to the renderer.
- Recognize the managed Qortium Core, the future managed `qortal-core` sibling,
  standard Qortal home directories, and Qortal Hub's configured Core directory.
- Keep Core installation and lifecycle actions out of this tranche.
- Add one custom-node editor. Saving normalizes the URL and atomically selects
  Custom mode. Remote custom endpoints require HTTPS; loopback HTTP is allowed.
- Give Android a narrow Capacitor HTTP/preferences adapter implementing the same
  normalized snapshot and exact connection modes. Android Local remains a
  visible unsupported state and never falls back to Public.
- Select Public nodes only after full-sync and public-read health checks. Keep a
  healthy selected endpoint sticky; on failure, choose the lowest-latency
  healthy candidate and display its hostname.
- Package Android as a temporary debug-only `.v2live` application variant that
  does not register Home 1.x custom QDN, wallet, file, and updater plugins.
  Restore standard Android web assets after the preview build.

## Consequences

Desktop and Android can exercise the first live read-only Dashboard slice with
the same user-facing node contract. No account, signing, QDN app, Core control,
update, Reticulum, or private-key capability is added. The Android preview is a
test artifact, not a second maintained product identity.

## Verification

```bash
npm run test:home-v2-core-readiness
npm run test:home-v2-node-client
npm run test:qortal-node-settings
npm run test:qortium-public-node-settings
npm run dist:linux:x64:v2-live
npm run dist:android:debug:v2-live
```
