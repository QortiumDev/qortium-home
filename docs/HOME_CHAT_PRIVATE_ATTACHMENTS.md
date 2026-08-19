# Home 2 private chat attachments

This document freezes Home milestone H6. It defines the trusted Home bridge
contract and the encrypted resource formats used for private direct-message and
closed-group attachments. Chat consumes only the descriptor described here;
Home owns file selection, encryption keys, publication, decryption, and native
view/save/stream operations.

## Shared bridge contract

`PUBLISH_CHAT_ATTACHMENT` is available through both `qdnRequest` and
`qortalRequest`. The invoked bridge is the authoritative network; a repeated
`network` field must match it. The request contains exactly a Home-issued
`sourceToken` plus one tagged conversation:

- `{ kind: "direct", otherAddress }`; or
- `{ kind: "group", groupId }`, where `groupId` is positive.

Inline bytes, native paths, filenames, MIME claims, and reusable keys are
rejected at the app boundary. Home chooses the exact encryption codec, service,
publisher name, opaque identifier, fee, proof of work, and transaction fields.
Publication is a one-request approval and is rechecked before signing and
broadcast.

The result contains a version-1 descriptor with the authoritative network and
conversation, codec, exact resource coordinate, ciphertext byte size, SHA-256
hash, and ARBITRARY transaction signature. The coordinate is mutable in QDN,
but the descriptor is not: Home refuses any later bytes whose size or SHA-256
does not match. The descriptor contains no plaintext filename, MIME type,
content hash, recipient key, or group key.

`GET_CHAT_ATTACHMENT_STREAM_URL`, `OPEN_CHAT_ATTACHMENT_VIEWER`, and
`SAVE_CHAT_ATTACHMENT` accept only that descriptor. Each operation is
separately approved and requires the same selected, unlocked account. Home
rechecks the app/tab, authoritative chain, exact node route, direct peer public
key or current closed-group membership, ciphertext commitment, and matching
decryption key. Plaintext is never returned inline or as Base64 to the QDN app;
the stream action deliberately grants that approved app temporary bounded
access to the decrypted bytes through an opaque capability URL.

Desktop uses a private `qortium-home-resource:` capability. Android copies at
most 1 MiB of decrypted bytes into its native HTTPS proxy. Both capabilities
expire after ten minutes, support GET/HEAD and one byte Range, are bound to the
issuing context, and are revoked on account, route, tab, app, or lock changes.

## QATT payload

Generic private attachments serialize filename, media type, data length, data,
and a SHA-256 digest under the exact QATT v1 format frozen by Qortium Core C6.
Path-like filenames, control characters, malformed UTF-8, digest mismatches,
and malformed lengths are rejected. Home derives the display MIME type from
decrypted magic bytes; an encrypted MIME claim cannot enable active content.

The canonical Core fixture is:

- Core commit: `d0da4036263a057d6f1d25356d19427170d8f93b`
- path: `src/test/resources/chat/interop/qenc-attachment-v2.json`
- SHA-256: `d4a5ae15e0d6915f889d0b3b1e92562e3aeaea32495a16842b687cb42eab361a`

Home pins and verifies this fixture in `scripts/fixtures/chat-interop-sources.json`.

## Qortium formats

Qortium direct attachments use QENC v2 recipient mode with exactly two sorted
recipient key IDs: the sender and the other direct-message participant. This
allows the sender to reopen their own attachment. Qortium closed-group
attachments use QENC v2 group mode bound to the positive group ID and exact
QPGC epoch ID and key ID. Both publish as
`QCHAT_ATTACHMENT_PRIVATE` (service 121), use an opaque identifier, and must fit
inside the 1 MiB QENC envelope ceiling.

## Qortal formats

The Qortal formats are deliberately distinct from legacy CHAT encryption:

- Direct files publish as `QCHAT_ATTACHMENT_PRIVATE` and contain the ASCII
  marker `qortalEncryptedDataQENC2:` followed by the same QENC v2 two-recipient
  envelope. This is a new Home/Chat file format; it does not claim legacy Hub
  DM-file compatibility.
- Generic private-group files publish as `QCHAT_ATTACHMENT_PRIVATE` and contain
  `qortalGroupEncryptedDataQATT1:` followed by the current Qortal private-group
  `encryptSingle` Base64 form over a QATT payload with reserved type 201. Legacy
  fixed-nonce group keys are refused for attachments because nonce reuse is not
  safe for binary publication.
- Raster private-group images retain Hub compatibility: raw image bytes use the
  current `encryptSingle` format with type 2 and publish as `IMAGE` under the
  established `grp-q-manager_0_group_<groupId>_<opaque>` family. This is the
  only H6 format claimed to interoperate with existing Hub private-group image
  rendering.

Qortal direct files and generic private-group files require matching Chat
support for these written formats. They do not overload or reinterpret Hub's
legacy DM payload or type-2 image format.

## Observable metadata and limits

Encryption hides file bytes, filename, MIME type, and the QATT plaintext hash.
It does not hide the publisher name, resource service and identifier,
ciphertext size, transaction timestamp, or network activity. An opaque
identifier avoids placing the peer address, group ID for generic files, or
filename in the coordinate; the Hub-compatible group-image coordinate retains
the group ID because compatibility requires that family.

Ciphertext is capped at 1 MiB. Home rejects redirects, cross-chain fallback,
changed node routes, wrong recipients, removed group members, missing or stale
keys, malformed envelopes, replaced resource bytes, and unsupported decrypted
active content. Encryption cannot revoke plaintext a recipient already viewed
or saved.
