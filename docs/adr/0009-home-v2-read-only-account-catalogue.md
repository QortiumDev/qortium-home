# ADR 0009: Home v2 read-only account catalogue

Date: 2026-08-08

Status: accepted and implemented in the live preview

## Decision

The first Home v2 account integration is a read-only catalogue over the live
preview's own isolated profile. It returns only account ID, backing wallet ID,
address, address index, label, current in-process unlock state, and whether the
wallet can derive additional addresses. It includes base and derived addresses.

Selecting an entry is a renderer action. Home resolves that address on both
networks and shows one account with separately labelled Qortal and Qortium
presences. Selecting no account remains supported. This slice does not write
the active selection back to the wallet store.

## Host boundary

Desktop exposes one sender-gated `home-v2-accounts:list` operation and strips
the source filename before returning the existing account summary. Android
parses the preview package's Preferences value into the same public shape.
Neither adapter returns the encrypted wallet object, encrypted seed, salt, IV,
MAC, source path, password, private key, or seed.

The desktop preview profile is `qortium-home-v2-live`; Android uses the
temporary `.v2live` package sandbox. Neither reads or migrates the production
Home profile. Unlock, create, import, remove, derive, sign, and persist-selection
operations remain unavailable.

Update, 2026-08-09: ADR 0010 now persists only the selected account ID in the
isolated v2 shell-state file/preferences. It still does not mutate the wallet
store's active-account field or persist unlock/password/key material.

## Consequences

The selector and cross-network account presentation can be tested before the
wallet authority is connected. Existing preview installs will normally show an
empty catalogue until a separately reviewed import/migration or account-creation
slice is implemented. Production-profile migration must preserve the in-place
Home v2 product direction without silently weakening preview isolation.
