# Portable Chat Home Roadmap

Status: active planning and implementation tracker

Home implementation base: `main` at `13d02a1c753a882bfc187d946480ae37043f6680`

Core implementation baseline: Qortium Core
`3ac275024d9256cb27cd9ba085a1e2c81f2596da` (C0-C5 complete). The reviewed
current `origin/main` is `6463a0a887ed106beaa63f6f5f45a3036cdf9250`.

Order: Qortium Core first, Qortium Home second, Chat app last

## Purpose

This roadmap tracks the trusted Home work needed to make Chat fully usable on
Qortium and Qortal through local, authenticated custom, unauthenticated custom,
and public nodes. Every completed feature must work on desktop and Android.

All new Chat bridge work targets Home 2.0. Home 1.7.x was an emergency release
that restored compatibility with the updated managed Core; it is not a
continuing product line and receives no Chat portability backports. Older Home
bridge code remains useful implementation evidence, but it does not add a
second delivery target.

The product target includes:

- joined public/open groups and bounded read-only discovery previews;
- closed/private groups and direct messages;
- replies, edits, deletes, and emoji reactions;
- group participation and the membership changes needed by private chat;
- user and group avatars;
- safe public embeds, viewers, streams, downloads, and publish-to-attach;
- later, genuinely encrypted private attachments; and
- clear delivery, retention, missing-key, route-policy, and capability states.

A shipped public node is a full network-serving route, not a deliberately
half-useful Chat tier. The default node profile must expose every safe primitive
needed by Home. An operator can explicitly remove routes; Home then reports the
operator policy accurately instead of silently hiding features or falling back
to another network.

## Scope decisions

- `qdnRequest` is the Qortium authority and `qortalRequest` is the Qortal
  authority. Shared internal services are encouraged, but the invoked global
  chooses the network, node route, permission domain, and wallet context.
- An app-supplied `network` field is never authoritative. If a compatibility
  request repeats the network, Home rejects a mismatch.
- Qortal Core is out of scope. Qortal General Chat was removed intentionally;
  Home will not pretend that native `txGroupId=0` still exists.
- A future General-like Qortal surface may use the historical FreeChat/old
  Qortal Home `MESSAGE`-wrapped CHAT convention, but only after its exact wire,
  reads, replies, references, and interoperability traces are frozen. It is a
  separate compatibility surface, not Qortal group zero.
- Reticulum/RCHAT remains a later distinct source/action family. None of the
  legacy CHAT actions in this roadmap may be overloaded to carry RCHAT.
- Polling is sufficient for initial completion. A Home-proxied subscription is
  an optimization after read/send parity, not a reason to delay it.
- Retained legacy CHAT is transient, roughly a 24-hour window. Home and Chat
  must not promise indefinite history or offline mailbox delivery.
- Existing released aliases remain available for older apps. New Chat code
  uses canonical fine-grained actions and never infers DM, private-group, or
  revision support from generic `SEND_CHAT_MESSAGE`.
- Historical Home 1 bridge handlers are reference implementations only. New
  actions, crypto, route behavior, and tests land in Home 2 main.
- Private keys, API keys, shared secrets, group keys, reusable signing
  authority, raw native paths, and unrestricted node URLs never cross into a
  QDN app.

## Completed Core foundation

Qortium Core C0-C5 are complete on the baseline above:

- the language-neutral `chat-crypto-v1.json` fixture freezes QDM1, QPGC v1,
  and initial/revision CHAT bytes;
- QPGC control metadata is indexed and queried with bounded stable cursors;
- public nodes expose bounded signed QPGC control pages and atomic group state;
- accepted key announcements remain while retained messages depend on them;
- QPGC v1 reports and enforces its 39-member and 3,894-byte plaintext limits;
  and
- public unsigned Qortium join/leave builders are available through
  `/groups/public/join` and `/groups/public/leave`.

Home therefore does not need a new Qortium Core API for public-group revisions,
QDM1 direct messages, QPGC private-group reads/recovery/send, or join/leave.
Home owns the remaining crypto, approvals, proof of work, signing, field
attestation, secure key persistence, and app-facing contracts.

Core C6, the corrected QENC private-attachment contract, is deliberately
deferred. It blocks generic private attachments, not the preceding text-chat
milestones.

## Current Home gap summary

| Capability | Home 2 Qortium | Home 2 Qortal |
| --- | --- | --- |
| Positive-ID public group read/send | Present | Present |
| Replies | Present in the message payload | Present for Hub-v3 open groups |
| Public edit/delete/reaction | Edit/delete/reaction implemented | Hub-v3 edit/reaction plus content-clearing empty-edit delete implemented |
| Direct messages | Missing | Missing |
| Closed/private groups | Missing | Missing |
| Join/leave | Present | Present |
| User/group avatar read | Dedicated pointer-aware account/group actions | Dedicated named-thumbnail account/group actions |
| Viewer/stream/save/publish | Small reads/status/URL only | Small reads/status/URL only |
| Private attachments | Missing | Missing |

The Core-injected gateway bridge remains a Qortium read-only environment. It is
not a wallet, Qortal, native-viewer, or private-chat portability target.

## Trusted architecture

### One shared implementation, two platform surfaces

New protocol parsing, serializers, crypto, field attestation, error types, and
route-capability logic belong in pure shared modules. Thin adapters connect
those modules to Home 2's two platform surfaces:

1. desktop (`electron/home-v2-app-bridge.ts`); and
2. Android (`src/home-v2-live/HomeV2LiveApp.tsx`).

Do not implement independent desktop and Android cryptographic or transaction
paths. Each milestone uses the same fixtures on every host surface, and parity
tests fail if one adapter advertises an action it cannot execute.

Each implementation milestone lands as a focused mainline PR. A milestone is
not marked complete merely because one platform works.

### Route model and truthful discovery

Do not add a second `GET_CHAT_CAPABILITIES` truth surface. `SHOW_ACTIONS`
remains the callable action catalogue and becomes protocol-, route-, and
platform-aware.

`GET_HOST_INFO` gains additive route diagnostics:

```ts
type ChatHostInfo = {
  protocol: "qdnRequest" | "qortalRequest";
  network: "qortium" | "qortal";
  platform: "desktop" | "android";
  route: {
    configuredKind:
      | "local"
      | "custom-authenticated"
      | "custom-unauthenticated"
      | "public"
      | "disabled";
    effectiveKind:
      | "local"
      | "custom-authenticated"
      | "custom-unauthenticated"
      | "public"
      | null;
    available: boolean;
    reachable: boolean;
    coreVersion?: string;
    apiRestricted?: boolean;
    revision: string;
  };
};
```

The route revision changes when the selected endpoint, authentication class,
public-node failover target, account/network binding, or relevant native
capability changes. Home emits a bridge-state invalidation event containing the
protocol and revision; apps then refresh `SHOW_ACTIONS` and `GET_HOST_INFO`.

A known route-policy denial removes the affected action. A temporary outage is
reported by `reachable:false` and a structured runtime error; it does not
silently switch protocols or permanently redefine the host implementation.
Conversation-specific facts such as membership, a recipient without a public
key, or a missing group key remain runtime states rather than action-catalogue
booleans.

### Structured errors and broadcast outcomes

Extend the existing coded bridge-error envelope without breaking older apps:

```ts
type BridgeErrorDetails = {
  code: string;
  network: "qortium" | "qortal";
  action: string;
  retryable: boolean;
  outcome?: "rejected" | "unknown";
  target?: { kind: "group"; groupId: number } |
    { kind: "direct"; otherAddress: string };
  routeRevision?: string;
};
```

Required codes include `VALIDATION_FAILED`, `USER_CANCELLED`,
`ACCOUNT_LOCKED`, `STALE_CONTEXT`, `ROUTE_UNAVAILABLE`,
`NODE_CAPABILITY_MISSING`, `NOT_GROUP_MEMBER`, `ALREADY_GROUP_MEMBER`,
`MISSING_RECIPIENT_PUBLIC_KEY`, `MISSING_GROUP_KEY`,
`PRIVATE_GROUP_UNAVAILABLE`, `RETENTION_GAP`, and `UNSUPPORTED_PROTOCOL`.

Only a proven pre-broadcast rejection is safely retryable. Once Home has signed
or begun submission, a timeout, transport failure, or uncertain node response
is `outcome:"unknown"` and retains the signature for reconciliation. Home must
never turn an ambiguous submission into a one-click duplicate send.

### Canonical selectors and action families

New actions use a tagged conversation selector:

```ts
type Conversation =
  | { kind: "group"; groupId: number }
  | { kind: "direct"; otherAddress: string };
```

Canonical action families are deliberately fine-grained:

| Family | Actions |
| --- | --- |
| Public group reads | `SEARCH_CHAT_MESSAGES`, `GET_CHAT_MESSAGE`, `GET_GROUP_ACTIVE_CHATS`, `GET_ACCOUNT_GROUPS`, `GET_GROUP`, `GET_GROUP_MEMBERS`, `GET_DISCOVERABLE_GROUP_CHATS` |
| Public group writes | `SEND_CHAT_MESSAGE`, `SEND_CHAT_EDIT`, `SEND_CHAT_DELETE`, `SEND_CHAT_REACTION` |
| Direct reads | `GET_PRIVATE_DIRECT_ACTIVE_CHATS`, `SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES` |
| Direct writes | `SEND_DIRECT_CHAT_MESSAGE`, `SEND_DIRECT_CHAT_EDIT`, `SEND_DIRECT_CHAT_DELETE`, `SEND_DIRECT_CHAT_REACTION` |
| Private-group reads | `GET_PRIVATE_GROUP_ACTIVE_CHATS`, `SEARCH_PRIVATE_GROUP_CHAT_MESSAGES`, `GET_PRIVATE_GROUP_CHAT_STATE` |
| Private-group writes | `SEND_PRIVATE_GROUP_CHAT_MESSAGE`, `SEND_PRIVATE_GROUP_CHAT_EDIT`, `SEND_PRIVATE_GROUP_CHAT_DELETE`, `SEND_PRIVATE_GROUP_CHAT_REACTION`, `REQUEST_PRIVATE_GROUP_CHAT_KEY`, `RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS`, `ROTATE_PRIVATE_GROUP_CHAT_KEY` |
| Participation | `JOIN_GROUP`, `LEAVE_GROUP`, followed by exact invite/approval/ban/kick/admin actions |
| Identity/resources | `FETCH_ACCOUNT_AVATAR`, `FETCH_GROUP_AVATAR`, `FETCH_QDN_RESOURCE`, `OPEN_QDN_RESOURCE_VIEWER`, `GET_QDN_RESOURCE_STREAM_URL`, `SAVE_QDN_RESOURCE`, `SELECT_QDN_PUBLISH_SOURCE`, `PUBLISH_QDN_RESOURCE` |

The same canonical action name has the same app-facing shape on both globals,
but its implementation and payload codec are network-specific. Released
Qortal-over-`qdnRequest` aliases remain compatibility shims and never become the
model for new code.

### Universal signing rule

Home never signs opaque bytes supplied by a node or app. Immediately before
signing it decodes and attests every target-critical field:

- invoked protocol/network and transaction type;
- selected sender/public key;
- recipient or group ID;
- exact payload bytes and payload-format allowlist;
- timestamp, last reference, `chatReference`, fee, and proof-of-work nonce;
- resource coordinates/content commitment for publishing; and
- app, tab, account, unlock, approval, node endpoint, and route revision.

An authenticated custom node may require an API key for operator-controlled
routes, but Home never sends wallet private material to it. API keys are sent
only under the existing safe transport/pinning rules. Chat transaction crypto
and signing remain local even when the node is authenticated.

## Completion tracker

| ID | Home milestone | Status | Depends on |
| --- | --- | --- | --- |
| H0 | Shared contracts, route-aware discovery, errors, and vector harness | Complete: H0A and H0B implemented | Core C0-C5 complete |
| H1 | Public-group revisions and route-independent send parity | Implemented | H0 |
| H2 | Portable group participation, administration, and avatar/identity parity | Complete: H2A join/leave, H2B avatar reads, and H2C exact administration actions implemented | H0; Core C5 |
| H3 | Qortium and Qortal direct messages | Planned | H0-H1; Core C0/C2 |
| H4 | Qortium and Qortal private groups | Planned | H0-H3; Core C0-C4; Qortal QDN publish proof |
| H5 | Public resource, embed, viewer, stream, save, and publish parity | Planned | H0; Qortal publish proof |
| H6 | Private attachments | Blocked/deferred | Core C6 plus Qortal DM/file vectors |
| H7 | Notification, restart/node-switch, and full matrix completion | Planned throughout; closes last | H0-H6 as applicable |

## H0 — Shared contracts, discovery, and vectors

### Home changes

- Create shared pure request validators, action names, route descriptors,
  errors, send outcomes, and stale-context guards used by both Home 2 platform
  surfaces.
- Make `SHOW_ACTIONS` truthful for protocol, route, and platform. Replace the
  current Home 2 static lists that can imply more than the selected route
  supports.
- Add the route-qualified `GET_HOST_INFO` contract and bridge-state invalidation
  event.
- Preserve old aliases while marking their narrower semantics in tests and
  documentation.
- Consume Qortium Core's committed `chat-crypto-v1.json` directly in Home
  tests. Do not transcribe expected bytes into a second fixture.
- Freeze independent Home fixtures for Qortal open-group revisions, legacy DM,
  private-group bundle/`encryptSingle`, group transactions, and resource
  descriptors. Hub/Qortal GPL code is interoperability evidence only; Home's
  implementation is clean-room from written contracts and vectors.
- Add a generated parity test proving every advertised action has desktop and
  Android dispatch on Home 2 main.

### Completion gate

- Action catalogues are exact for both protocols, both platforms, and
  local/authenticated-custom/unauthenticated-custom/public routes.
- Route or account changes invalidate stale approvals and notify the app.
- Every structured error survives Electron and Android bridge serialization.
- Qortium fixture positives reproduce exact bytes and negatives fail at the
  intended validation layer.
- Production errors and logs never include secret material.

### Corresponding Chat work after Home

- Refresh actions/host info after bridge invalidation.
- Gate each affordance on its exact action rather than a Home version or broad
  `SEND_CHAT_MESSAGE` inference.
- Render route, account-lock, unsupported-protocol, and ambiguous-broadcast
  states without unsafe retries.

## H1 — Public groups, revisions, and reactions

### Home changes

- Retain current positive-ID group history, active-chat, member, and initial
  send behavior on both chains.
- Make Home 2 Qortium use its local build/sign path for every route class. A
  custom or public route must not fall through to a loopback private-key
  helper.
- Keep Home 2 Qortal on the same explicit local/custom/public route model.
- Preserve and attest `chatReference` in every Home 2 desktop and Android path.
- Add `SEND_CHAT_EDIT`, `SEND_CHAT_DELETE`, and `SEND_CHAT_REACTION` only for
  bounded, validated codecs. Qortium uses its established empty-message delete
  revision. Qortal delete is Home's one canonical empty Hub-v3 edit with no images;
  stock Hub recognizes the edit and renders the original row as no message.
  This is content clearing, not erasure of either immutable transaction.
  Home validates reference ownership for edits and deletes; reactions may
  reference another sender's message.
- Keep reply as an ordinary initial-send payload field. Home validates the
  network-specific envelope but does not create a separate reply transaction
  action.
- Bind the referenced base message to the selected network, route, account,
  target conversation, and operation before prompting and again before
  signing.
- Normalize all send outcomes under the H0 contract, retaining a signature for
  confirmation polling after uncertain submission.

### Completion gate

- Initial send, reply, edit, content-clearing delete, and reaction work in
  positive-ID public groups across the full platform/route matrix.
- Qortium General works; Qortal offers no native General/group-zero control.
- Qortal messages remain Hub-compatible for every advertised operation.
- A same-signature collision, cross-chain reference, wrong sender edit/delete,
  stale account, stale tab, stale route, malformed payload, or oversize UTF-8
  payload fails before signing.
- Android and desktop produce the same signed bytes for identical deterministic
  test inputs.

### Corresponding Chat work after Home

- Use the exact revision/reaction actions and network-specific envelopes.
- Keep replies in the normal send path.
- Show edit/delete/reaction controls only when the corresponding action is
  advertised and the selected sender is eligible.

## H2 — Participation and identity parity

Progress (2026-08-18): H2A implements `JOIN_GROUP` and `LEAVE_GROUP` for both
chains in Home 2 on desktop and Android. Qortium uses
Core C5's public unsigned builders, locally computes the advertised MemoryPoW,
and rejects any unapproved field before signing. Qortal uses the clean-room
serializer pinned to the H0B Hub vectors, the account's fresh last reference,
the current unit fee, and local signing; these Qortal transactions do not use
CHAT MemoryPoW. Both paths bind approval and signing to the same app, tab,
account, chain, group, and node route, return a non-retryable signed outcome
when broadcast status is uncertain, and normalize already-member,
already-requested, and already-left results.

H2B adds `FETCH_ACCOUNT_AVATAR` and `FETCH_GROUP_AVATAR` to both bridge
protocols through one shared desktop/Android resolver. Qortium's account/group
pointer is authoritative and only an exact pointer-info 404 permits the legacy
named-thumbnail fallback. Qortal uses its established
`qortal_avatar`/`qortal_group_avatar_<groupId>` resources on the Qortal route,
with owner-name fallback for older/custom group responses. Results repeat the
authoritative network, carry bounded raster-validated base64 or a pending
state, and never expose a raw node URL.

H2C implements `APPROVE_GROUP_JOIN_REQUEST`, `INVITE_TO_GROUP`,
`CANCEL_GROUP_INVITE`, `ADD_GROUP_ADMIN`, `REMOVE_GROUP_ADMIN`, `GROUP_BAN`,
`CANCEL_GROUP_BAN`, and `GROUP_KICK` on both bridge protocols and both host
surfaces. The Qortal-only `BAN_FROM_GROUP` and `KICK_FROM_GROUP` aliases map to
the same canonical operations for stock-app compatibility. Seven clean-room
transaction serializers cover chain types 24 through 30. Home uses the
Qortium nonce-bearing, zero-fee MemoryPoW layout or the Qortal
last-reference/unit-fee layout as appropriate; a structural parser attests
every target-critical field before signing. Home verifies owner/admin
authority before approval and immediately before signing, never permits a
session grant for administration, and retains signed uncertain outcomes as
non-retryable results.

### Home changes

- Implement Qortium `JOIN_GROUP` and `LEAVE_GROUP` through Core C5's public
  unsigned builders on every route. Decode/attest type, timestamp, group,
  account public key, optional minting key, fee/nonce, and signature absence;
  compute MemoryPoW and sign locally.
- Normalize Core's `ALREADY_GROUP_MEMBER` and `NOT_GROUP_MEMBER` results as
  idempotent membership states.
- Implement Qortal join/leave with clean-room transaction serializers, fresh
  last-reference and unit-fee checks, local signing, and the same stale-context
  and approval checks. Qortal JOIN_GROUP/LEAVE_GROUP do not carry CHAT
  MemoryPoW.
- Keep Qortium's optional JOIN_GROUP minting key absent in this participation
  action. Joining a chat group must not silently create minting authority;
  minting setup remains a separate explicit Home permission and operation.
- Keep invite, accept/approve, ban, kick, and admin-role actions separately
  advertised and approved. Do not replace them with one broad
  `groupMutations` capability.
- Make account and group-avatar reads explicit on both globals. Qortium uses
  current account/group avatar contracts; Qortal uses primary-name
  `THUMBNAIL/<name>/qortal_avatar` and
  `THUMBNAIL/<owner>/qortal_group_avatar_<groupId>` coordinates.
- Keep avatar byte, MIME, dimension, concurrency, and cache limits consistent
  with Chat's bounded consumers.

### Completion gate

- Join and leave are implemented on both chains and both platforms across every
  route kind that the platform can configure: local, public, and custom on
  desktop, and public and custom on Android. An operator-customized Qortium
  node that removes Core C5's
  public builders fails with `NODE_CAPABILITY_MISSING` rather than falling back
  to a private-key route.
- Approval text identifies network, group, account, action, and route.
- Account/route changes after approval cannot sign or broadcast the old intent.
- Joined/private-group membership refreshes immediately enough to rotate or
  invalidate private-group state before another send.
- User and group avatars resolve on the correct chain with no cross-network
  fallback.

### Corresponding Chat work after Home

- Replace preview-only join restrictions with exact action gating and refresh
  membership after idempotent completion.
- Keep unjoined public groups read-only until join confirms.
- Use normalized avatar actions where present and retain initials when a route
  or resource is unavailable.

## H3 — Direct messages on both chains

### Qortium QDM1

Home implements QDM1 from the shared Core fixture:

- Ed25519-to-X25519 shared-secret conversion;
- QDM1 domain-separated HMAC-SHA256 derivation;
- AES-256-GCM envelope encryption/decryption;
- recipient public-key lookup with no plaintext fallback;
- public encrypted history/active reads;
- unsigned `/chat/public/build`, local MemoryPoW, field attestation, signing,
  and `/transactions/process`; and
- initial, reply, edit, delete, and reaction actions.

Local Core `/chat/private/*` helpers may remain a compatibility optimization,
but they are not the portable implementation and Home never posts a wallet
private key to a remote node.

### Qortal legacy DM

Home clean-room implements the legacy protocol from frozen vectors:

- version-2 message envelope compatibility;
- Ed25519-to-Curve25519/X25519 shared secret;
- SHA-256 shared key and NaCl secretbox;
- the first 24 bytes of the random 64-byte transaction `lastReference` as the
  nonce, distinct from `chatReference`;
- selected-account-scoped encrypted history/active reads and decryption; and
- client-side transaction construction, proof of work, signing, broadcast,
  replies, edits, deletes where proven, and reactions.

### Home changes

- Expose only the fine-grained direct read/write actions in the canonical table.
- Return plaintext messages or per-item structured decrypt failure to the
  authorized app; never return keys or permit searches where the selected
  account is not a participant.
- Store no DM plaintext as bridge infrastructure. Any caching is bounded,
  account/network/peer scoped, and cleared on lock/account change.
- Revalidate recipient, selected identity, route, reference, and approval
  immediately before signing.

### Completion gate

- Both directions work between two accounts for both chains across every
  platform/route cell.
- Sender and recipient can reopen their own retained conversation after Home
  restart and node switch.
- Unknown recipient key, wrong account, tampered ciphertext, malformed JSON,
  stale reference, expiry, and ambiguous broadcast are distinct safe states.
- Replies, edits, deletes where the frozen protocol supports them, reactions,
  avatars, and public embeds behave the same as in group conversations.

### Corresponding Chat work after Home

- Add the network-qualified direct rail and selected-peer storage.
- Consume Home-decrypted messages without receiving reusable secrets.
- Enable each direct operation only through its exact advertised action.

## H4 — Private groups on both chains

### Qortium QPGC v1

Home consumes Core C0-C4 and owns the portable lifecycle:

- fetch and parse the bounded public control pages;
- independently verify the outer CHAT signature and inner QPGC signature;
- handle valid relayed announcements without requiring outer sender to equal
  the announcement creator;
- bind key/rotation requests to the outer sender;
- read atomic group state and fail closed above 39 members or when a public key
  is missing;
- recover recipient-wrapped keys, encrypt/decrypt messages, create/relay key
  requests and announcements, and rotate on membership changes; and
- build, attest, PoW, sign, and broadcast every control/message through the
  selected local/custom/public route.

Home adds an encrypted account/network/group/epoch/key store. It is never
plain localStorage. The persistence design must specify desktop and Android
storage, atomic replacement, account removal, wallet re-import, backup/migration,
multi-device recovery, and what remains unrecoverable after CHAT retention.

### Qortal private groups

Home clean-room implements the separate Hub-compatible lifecycle:

- discover the exact
  `DOCUMENT_PRIVATE/<authorized-admin>/symmetric-qchat-group-<groupId>` bundle;
- validate current owner/admin publisher authority and choose the newest valid
  resource deterministically;
- parse/decrypt the `qortalGroupEncryptedData` recipient bundle;
- implement compatible old/new `encryptSingle` forms, including reaction type
  102 and key-version selection;
- publish/rotate bundles and encrypt/decrypt messages and established private
  group images; and
- rotate promptly after member removal and define join, reinstall, and
  multi-device recovery behavior.

Portable Qortal QDN publication must be proven on local, authenticated custom,
unauthenticated custom, and public routes before this phase can be complete. If
a node lacks the required public staging/process route, Home returns an exact
capability error; it does not downgrade a private group to plaintext.

### Completion gate

- Joined eligible members can read/send/reply/revise/react in retained private
  groups on both chains through every supported route/platform cell.
- Nonmembers and removed members cannot obtain new keys or decrypt new content.
- Missing key, recovery pending, relayed key, rotation required, too many
  members, missing public key, invalid publisher, retention gap, and operator
  route denial are distinct visible states.
- Restart, node switch, Home update, account switch, lock, reinstall, and
  two-device fixtures exercise both recovery designs.
- No private/group key or plaintext private content crosses into logs, bridge
  errors, action catalogues, or unrelated app tabs.

### Corresponding Chat work after Home

- Use one shared private-group UX with network-specific Home actions.
- Show accurate recovery/rotation/retention states and never offer plaintext
  fallback.
- Refresh membership/key state after join, leave, removal, or admin changes.

## H5 — Public resources, embeds, and attachments

### Home changes

- Provide `FETCH_QDN_RESOURCE`, unified viewer, ranged stream, save, source
  picker, and publish on both globals and both platforms.
- Every request is network-qualified by the invoked global. A Qortal resource
  never falls back to Qortium, and a bare legacy `qdn://` coordinate uses the
  source conversation network supplied by Chat.
- Qortal app/resource navigation supports Qortal coordinates explicitly rather
  than routing through Qortium `OPEN_NEW_TAB`.
- Large media uses an expiring app/tab/account/network/route-bound capability
  with Range support, cancellation, strict service/path validation, byte
  ceilings, and no API-key exposure. Android uses the authorized HTTPS range
  proxy rather than whole-file Base64 buffering.
- Qortal publish uses clean-room transaction and QDN staging contracts and is
  advertised only after the selected route is proven capable.
- Public upload descriptors include an immutable transaction signature and/or
  content hash. Mutable coordinates remain visibly different from pinned
  attachments.
- Public resource actions retain source-token file selection; apps never pass
  arbitrary native paths.

### Completion gate

- User/group avatars, user-triggered image previews, metadata cards, media,
  documents, downloads, existing-publish links, and open-group publish-to-attach
  work on both networks across desktop/Android and all route kinds.
- Public resources remain visibly labelled public inside DMs/private groups.
- HTTP(S) content is not auto-fetched for previews; QDN reads stay bounded and
  tracker-resistant.
- SVG/scriptable content is never rendered in an unsafe inline context, and
  MIME/sniffing/path/decompression limits are enforced before native display.

### Corresponding Chat work after Home

- Feature-detect the normalized resource actions and keep every descriptor
  network-qualified.
- Use Home viewers/streams for large media and keep bounded user-triggered image
  previews/cards in the app.
- Enable Qortal public publish-to-attach only after Home advertises it.

## H6 — Private attachments

Status: deferred until the underlying contracts are complete.

### Prerequisites

- Qortium Core C6 freezes QENC group/direct headers, KDF/AAD, nonce, complete
  envelope, byte ceilings, sender reopen behavior, and negative vectors.
- Qortal private-group images retain established Hub compatibility.
- Generic Qortal DM files and non-image private-group files receive their own
  written interoperable formats; they are not inferred from `encryptSingle`.

### Home changes

- Add `PUBLISH_CHAT_ATTACHMENT` with a tagged conversation and Home-issued
  source token.
- Encrypt bytes plus filename, MIME type, and sensitive metadata in the current
  DM/group context; publish under an opaque identifier.
- Return an immutable authenticated descriptor, never a content/group key.
- Add authorized decrypt/view/save/stream flows with account, membership,
  network, app, tab, route, expiry, range, and byte limits.
- State explicitly that ciphertext size/timing/publisher metadata remains
  observable and downloaded plaintext cannot be revoked.

### Completion gate

- Sender and eligible recipient/member can publish, reopen, stream, and save on
  desktop and Android through every route class.
- Unrelated accounts, removed members, wrong network/route, stale source tokens,
  tampered metadata/ciphertext, replaced mutable resources, and oversize files
  fail safely.

### Corresponding Chat work after Home

- Render only the authenticated descriptor returned by Home.
- Show progress/failure without receiving encryption material.
- Keep public-link attachments visibly distinct from private encrypted files.

## H7 — Operational completion

This work is developed alongside H0-H6 and is the final completion gate.

### Home changes

- Make app-scoped notifications carry network/source/conversation identity so
  Qortium and Qortal group/DM mentions do not collide.
- Clear or rebind decrypted caches, approvals, streams, pending crypto work,
  and route capabilities on lock, account switch, node switch, public failover,
  app navigation, tab close, and Home restart.
- Keep background polling bounded and pause/resume it with platform lifecycle.
  Add a Home-proxied subscription only if it materially improves delivery after
  polling parity is complete.
- Preserve ambiguous signed transactions for reconciliation and prevent an
  app restart or route change from encouraging duplicate submission.
- Keep the Home 2 bridge ledger, action docs, and release notes in sync with the
  shipped action matrix.

### Acceptance matrix

Automated contract coverage spans:

- Qortium and Qortal;
- Home 2 desktop and Home 2 Android;
- local, authenticated custom, unauthenticated custom, and public routes;
- public group, private group, and direct conversation;
- sender, recipient/member, removed member, and unrelated third party; and
- account/node/route switch, lock, restart, denial, missing key/public key,
  retention gap, malformed/oversize/tampered data, timeout, ambiguous
  broadcast, and duplicate prevention.

Representative live checks use nodes that expose the documented default
primitives. An operator-disabled route is tested as a precise policy failure,
not accepted as a normal reduced-capability product mode. The user's ongoing
desktop and phone testing remains ordinary product feedback rather than a
separate ceremonial acceptance phase.

## Planned Home PR sequence

1. **H0A contracts and discovery — implemented:** shared action/route/error contracts,
   dynamic `SHOW_ACTIONS`, route-qualified `GET_HOST_INFO`, invalidation
   events, and desktop/Android parity tests.
2. **H0B vector harness — implemented:** consumes the pinned Core fixture
   unchanged and freezes independently generated Qortal interoperability
   fixtures before implementing their crypto.
3. **H1 public revisions — implemented:** route-independent Qortium/Qortal
   initial sends plus exact supported edit/delete/reaction actions, reference
   attestation, ownership checks, and signed ambiguous-broadcast results.
4. **H2A participation — implemented:** portable Qortium/Qortal join/leave and
   idempotent results.
5. **H2B identity — implemented:** network-scoped account/group avatar reads
   with shared desktop/Android bounds and no cross-chain fallback.
6. **H2C group administration — implemented:** exact invitation, request approval,
   kick/ban, and admin-role primitives, each with its own permission contract.
7. **H3 direct messages:** QDM1 and Qortal legacy-DM crypto/read/send/revision
   families.
8. **H4 private groups:** portable QPGC plus Qortal bundle/`encryptSingle`
   lifecycles and secure key persistence.
9. **H5 public resources:** dual-chain viewer/stream/save/source/publish and
   public attachment parity.
10. **H6 private attachments:** resume Core C6, then add Home encrypted
   attachment flows.
11. **H7 completion:** notifications, lifecycle hardening, matrix reconciliation,
   and release documentation.

The immediate next implementation after H2C is H3 direct-message parity. H1
added public edit, content-clearing delete, and reaction on both chains and
both Home 2 host surfaces; H2A added portable join/leave, H2B added avatar-read
parity, and H2C completed separately permissioned group administration.
Private-group crypto remains H4 work.

Each implementation PR updates `QORTIUM-HOME-CHANGELOG.md`, the relevant bridge
ledger, and focused tests. Crypto and transaction PRs require independent
review and exact vector evidence. Publishing, signing release artifacts, live
wallet sends, and node changes remain separately approved operations.

## Deferred distinct work

### Qortal General-like FreeChat compatibility

After positive-ID Qortal groups, DMs, and private groups are complete, inspect
the historical FreeChat/old-Qortal-Home `MESSAGE`-wrapped CHAT behavior. Freeze
stock-client traces before naming or exposing it. It must not be described as
native Qortal General Chat or group zero.

### Reticulum/RCHAT

RCHAT retains its own action/source family, sidecar/process lifecycle, tray
status, protocol vectors, storage, repair, group/DM behavior, and release gate.
It follows the legacy dual-chain Home work in this roadmap and is never folded
into `SEARCH_CHAT_MESSAGES` or the legacy `SEND_*CHAT*` actions.

If Reticulum runs as a separate process, Home should expose its health and
controls through a tray item. That background-service pattern should also be
evaluated for the existing I2P process so users can see and control both network
services consistently without opening a full settings page.

## Final completion gate

- Public groups, private groups, and direct messages read and send on Qortium
  and Qortal through local, authenticated custom, unauthenticated custom, and
  public nodes on desktop and Android.
- Replies, edits, supported deletes, reactions, membership-aware discovery,
  join/leave, avatars, notifications, embeds, and public attachments behave
  consistently in each applicable conversation.
- Private attachment completion waits for H6 and its explicit protocol gates;
  a public QDN link inside an encrypted conversation is never called private.
- Home 2 desktop and Android advertise only callable fine-grained actions and
  return the same normalized result/error shapes.
- Shipped public-node defaults expose every required safe primitive. Explicit
  operator opt-outs remain possible and visible.
- Account, app, tab, protocol, route, target, membership, key, reference,
  payload, approval, PoW, and signing context are revalidated before every
  privileged side effect.
- No private key, API key, shared secret, group key, plaintext private message,
  native path, or unrestricted node capability reaches Chat.
- Qortal Core remains untouched; Qortal General-like compatibility and RCHAT
  remain separately named protocol surfaces.
