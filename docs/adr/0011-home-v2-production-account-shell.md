# ADR 0011: Home 2.0 production account shell

Date: 2026-08-10

Status: accepted and implemented for review

## Decision

Home 2.0 becomes the normal Qortium Home renderer and upgrades in place under
the existing desktop and Android identities. Normal builds use version 2.0.0;
Android uses `org.qortium.home`, version code 37. The separate live-preview
Electron profile, Android flavor, package identity, and build scripts are
retired. The offline fixture remains available for runtime-free UI work.

The shell presents an **account** as one encrypted wallet-backed key context and
shows its base and derived addresses in a separate selector. It keeps the
existing wallet serialization and cryptography. Trusted Home UI provides account
creation, wallet-file import/export, private-key import, rename, selection,
derived-address creation/removal, account removal, lock, and unlock. A malformed
store is never converted into an empty store.

## Profile recovery

Before the first Home 2.0 account mutation, Home creates and verifies a curated
snapshot of the existing account and shell state. Desktop snapshots
`wallets.json` and `Local Storage` into the profile's private recovery area with
a file-by-file SHA-256 manifest. Android snapshots all string values in the
existing Capacitor preferences into app-private storage with a canonical
SHA-256 manifest. Restoration is requested explicitly and applied on restart.

Backup creation or verification failure, or strict account-store validation
failure, places account controls into read-only recovery mode. Home does not
silently discard, replace, or normalize invalid production data. A restore
displaces post-snapshot curated paths before copying the verified snapshot so a
path absent at snapshot time is restored as absent.

## Unlock security

`Lock on exit` defaults on per account and device. Remembered unlock is opt-in
and stores no plaintext password:

- Desktop wraps only the 64-byte password-derived wallet key with Electron
  `safeStorage`, and refuses Linux's `basic_text` or an unknown backend.
- Android wraps the same derived key with AES-256-GCM using a non-exportable
  Android Keystore key.
- Corrupt or unavailable wrapped state disables remembered unlock and falls
  back to password entry.
- Manual lock clears in-memory seed authority, invalidates pending app work and
  session grants, and persists an override that prevents automatic unlock until
  an explicit user unlock succeeds.

Desktop wallet work remains in the Electron main process. Android retains the
existing trusted top-level JavaScript wallet implementation for this bounded
account-only tranche; native plugins own Keystore wrapping and profile recovery.
Moving Android wallet authority into a narrower native service is a future
hardening boundary, not a prerequisite for this cutover.

## App boundary

Qortium apps may request `qdnRequest/UNLOCK_SELECTED_ACCOUNT`. Home owns the
visible unlock dialog and rechecks the immutable app resource, tab, selected
account, and route context before completing the request. The result is limited
to sanitized public account identity and unlocked state. Passwords, derived key
material, seeds, and private keys never enter the app result.

There is no corresponding `qortalRequest` action in this tranche. The two bridge
protocols remain separate, and the broad Home 1.x bridge is not exposed to Home
2.0 app views.

## Consequences and deferred work

Users retain the same installed application and profile while receiving the
browser-style Home 2.0 shell and full account management. Desktop and Android
are co-primary, use the same grouped account contract, and fail closed around
profile recovery and remembered unlock.

This decision does not authorize transaction signing, payments, chain writes,
QDN publishing/deletion, Core installation or lifecycle UI, notifications,
bookmarks, downloads/viewers, Reticulum, release publication, or any remaining
broad `qdnRequest`/`qortalRequest` action. Those remain separately reviewed
tranches.
