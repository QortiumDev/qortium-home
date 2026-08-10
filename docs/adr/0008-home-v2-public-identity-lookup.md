# ADR 0008: Home v2 public identity lookup

Date: 2026-08-08

Status: accepted and implemented in the live preview

## Decision

Home v2 resolves public identity around an address shared by Qortal and
Qortium. The same seed/public key produces the same normal address on both
networks, but name registrations remain independent.

- Address input queries names and the primary name independently on each
  configured network.
- Name input first resolves the owner independently on both networks.
- Equal owner addresses are grouped into one public identity projection.
- Different owner addresses produce an explicit conflict and are never merged.
- A name present on one network can still reveal the same address's names on
  the other network, without claiming that the queried name exists there.
- Missing, disabled, and unavailable states remain distinct.
- Avatar lookup returns metadata first. Qortal reports the established
  `THUMBNAIL/<name>/qortal_avatar` resource. Qortium prefers its account avatar
  pointer and falls back to `THUMBNAIL/<name>/avatar`.

## Host boundary

The renderer uses one resolver on desktop and Android. Android performs the
same allowlisted public reads through Capacitor HTTP. Desktop IPC accepts only
name, names-by-address, primary-name, and Qortium account-avatar-info reads,
sender-gates them to the v2 preview window, applies a five-second timeout, and
caps response bodies at 256 KiB. No generic Core path, API key, wallet, unlock,
signing, QDN content, or write capability is exposed.

Visible results may request avatar content through the resolved pointer only.
Both hosts cap it at 500 KiB and accept only PNG, JPEG, GIF, BMP, or WebP by
magic bytes; declared MIME alone is not trusted. The renderer rechecks type and
length, uses a local Blob URL, revokes it on cleanup, and performs at most six
bounded retries for a pending QDN build.

## Consequences

The Dashboard can identify public accounts before wallet integration, display
their visible avatars, and represent cross-chain disagreement honestly. This
decision does not link different addresses and does not grant any signing or
permission authority from names, avatars, or visual similarity.
