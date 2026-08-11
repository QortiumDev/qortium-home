# ADR 0010: Home v2 persistent shell and read-only app runtime

Date: 2026-08-09

Status: superseded for production identity and profile handling by ADR 0011;
the app-runtime boundary remains accepted

## Decision

Home v2 persists its non-sensitive browser shell state and loads source-qualified
QDN apps on both primary platforms. `qdn://` always selects the configured
Qortium connection; `qortal://` always selects the configured Qortal connection.
The protocols remain distinct even though their first read-only action handlers
share validation and response shapes.

The stored version-1 shell state contains appearance preferences, selected
account ID or no-account selection, open app tabs, active tab, and Home
destination. It does not contain passwords, unlock state, wallet contents,
private keys, seeds, API keys, or resource content. Desktop stores it under the
separate `qortium-home-v2-live` user-data directory; Android stores it in the
temporary `.v2live` application sandbox.

## App boundary

Desktop apps run in sandboxed, separately partitioned `WebContentsView`s. The
v2 app preload exposes only `qdnRequest` and `qortalRequest`, routed to a new
handler rather than the Home 1.x QDN handler. Android apps run through the
existing separate-origin HTTPS QDN render proxy and receive the same two
protocol functions. The v2 Android activity registers that proxy but continues
to withhold the custom publish, file-save, update-install, and wallet-backup
plugins.

The first action set is limited to UI/host metadata, configured-node status, a
public-node-mode check, and allowlisted GET/HEAD node reads capped at 2 MiB.
Signing, account authority, wallet data, chat writes, publishing, transactions,
notifications, and native service control remain unavailable.

## Consequences and next boundary

Users can now test real Qortium and Qortal app resources, persisted appearance,
account selection, tabs, and desktop browser navigation without granting app
write authority. The next reviewed bridge tranche must map individual
`qdnRequest` and `qortalRequest` actions by semantics and risk; it must not
enable the Home 1.x handler wholesale. Searchable app discovery, pins/dashboard
organization, internal app-history restoration across process restarts, and
Android browser-navigation parity remain separate work.
