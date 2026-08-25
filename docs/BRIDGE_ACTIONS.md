# QDN bridge action notes

The authoritative, always-current action catalogue is
[`electron/qdn-app-actions.ts`](../electron/qdn-app-actions.ts). This file
collects operational details that QDN apps rely on: which actions are
available in which context, approval behavior, poll scheduling fields, the
publish source-token flow, `FETCH_NODE_API` limits, and the rating actions.

## Poll scheduling

QDN apps can create scheduled polls with `startTime` (or `pollStartTime`) and
can update their schedule with `newStartTime` (or `startTime`). Poll updates
are full replacements in Core: an app updating a scheduled poll must resubmit
the current start time verbatim, especially after votes exist.

## Action availability and approvals

Supported read-only actions are `FETCH_NODE_API`, `FETCH_ACCOUNT_AVATAR`, `FETCH_GROUP_AVATAR`, `FETCH_QORTAL_NODE_API`,
`SEARCH_QORTAL_TRANSACTIONS`, `GET_NODE_INFO`,
`GET_NODE_STATUS`, `GET_ACCOUNT_DATA`, `GET_ACCOUNT_GROUPS`,
`GET_ACCOUNT_GROUP_JOIN_REQUESTS`, `GET_ACCOUNT_NAMES`, `GET_ACTIVE_CHATS`,
`GET_ADMIN_GROUP_JOIN_REQUESTS`, `GET_ASSET_INFO`, `GET_ASSET_BALANCES`,
`GET_ASSET_TRANSFERS`, `GET_BALANCE`, `GET_GROUP`,
`GET_GROUP_JOIN_REQUESTS`, `GET_GROUP_MEMBERS`, `GET_MINTING_STATUS`,
`GET_NAME_DATA`, `LIST_GROUPS`, `SEARCH_GROUPS`, `SEARCH_CHAT_MESSAGES`,
`GET_QDN_RESOURCE_METADATA`,
`GET_QDN_RESOURCE_PROPERTIES`, `GET_QDN_RESOURCE_STATUS`,
`GET_QDN_RESOURCE_URL`, `GET_QDN_RESOURCE_STREAM_URL`,
`FETCH_QDN_RESOURCE`, `LIST_QDN_RESOURCES`,
`SEARCH_QDN_RESOURCES`, `GET_RESOURCE_RATING`, `GET_ACCOUNT_RATING`,
`GET_SELECTED_ACCOUNT`, `RESOLVE_IDENTITIES`,
`IS_USING_PUBLIC_NODE`, `GET_HOME_SETTINGS_METADATA`, `GET_HOME_SETTINGS`,
`BOOKMARKS_HAS_PERMISSION`, `NOTIFICATION_MANAGER_HAS_PERMISSION`, and the
permissioned bookmark/notification manager reads.
`GET_APP_ASSIGNMENTS` asks once for an app-scoped assignment-read approval.
`UPDATE_HOME_SETTINGS` and `REQUEST_APP_ASSIGNMENT` are available in every node mode but require a
single-request approval before changing Home preferences. See
[Home settings QDN bridge](HOME_SETTINGS_BRIDGE.md) for request shapes and
the live settings-change event. Bookmark and notification management use
separate durable capabilities and revision-checked mutations; see
[Home data manager QDN bridge](HOME_DATA_MANAGERS.md). Other supported actions include
`WHICH_UI`, `SHOW_ACTIONS`, and the route-independent Home-owned
`SHOW_CONTEXT_MENU`. See [Home 2 context menus](HOME_V2_CONTEXT_MENUS.md) for
the structured target, safe action, result, desktop-native, Android-sheet, and
standalone-gateway boundaries. Desktop isolated QDN apps and Android tokenized
APP/WEBSITE pages also support `PUBLISH_QDN_RESOURCE`,
`PUBLISH_MULTIPLE_QDN_RESOURCES`, `DELETE_QDN_RESOURCE`,
`APPROVE_GROUP_JOIN_REQUEST`, `INVITE_TO_GROUP`, `JOIN_GROUP`, `LEAVE_GROUP`,
`CANCEL_GROUP_INVITE`, `ADD_GROUP_ADMIN`, `REMOVE_GROUP_ADMIN`, `GROUP_BAN`,
`CANCEL_GROUP_BAN`, `GROUP_KICK`,
`UPDATE_GROUP`, `SET_GROUP_AVATAR`, `SET_ACCOUNT_AVATAR`, `START_MINTING`, `REGISTER_NAME`, `UPDATE_NAME`, `SELL_NAME`,
`CANCEL_SELL_NAME`, `BUY_NAME`, `SEND_CHAT_MESSAGE`, `SEND_MESSAGE`,
`GET_PRIVATE_GROUP_ACTIVE_CHATS`, `SEARCH_PRIVATE_GROUP_CHAT_MESSAGES`,
`GET_PRIVATE_DIRECT_ACTIVE_CHATS`, `RATE_ACCOUNT`, `RATE_RESOURCE`, and
`SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES`.

Home 2 exposes each group-administration mutation as its own single-request
permission on both bridge protocols. On `qortalRequest`, stock-app names
`BAN_FROM_GROUP` and `KICK_FROM_GROUP` are compatibility aliases for canonical
`GROUP_BAN` and `GROUP_KICK`; they produce the same checked transaction and do
not create separate permission capabilities.

Home 2 also exposes a portable, fine-grained direct-message family on both
`qdnRequest` and `qortalRequest`:
`GET_PRIVATE_DIRECT_ACTIVE_CHATS`, `SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES`,
`SEND_DIRECT_CHAT_MESSAGE`, `SEND_DIRECT_CHAT_EDIT`,
`SEND_DIRECT_CHAT_DELETE`, and `SEND_DIRECT_CHAT_REACTION`. Direct reads require
an unlocked selected account and a scoped `chat.direct.read` approval; writes
use a single-request `chat.direct.send` approval. Home performs all QDM1 or
Qortal legacy-v2 key agreement, decryption, encryption, proof of work, field
attestation, signing, and broadcast inside the trusted host. Apps receive
plaintext rows or per-row failures but never a private key, shared secret, or
reusable decryption key.

Home 2 exposes the private-group family on both bridge protocols:
`GET_PRIVATE_GROUP_ACTIVE_CHATS`, `GET_PRIVATE_GROUP_CHAT_STATE`,
`SEARCH_PRIVATE_GROUP_CHAT_MESSAGES`, `REQUEST_PRIVATE_GROUP_CHAT_KEY`,
`RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS`, `ROTATE_PRIVATE_GROUP_CHAT_KEY`,
`SEND_PRIVATE_GROUP_CHAT_MESSAGE`, `SEND_PRIVATE_GROUP_CHAT_EDIT`,
`SEND_PRIVATE_GROUP_CHAT_DELETE`, and `SEND_PRIVATE_GROUP_CHAT_REACTION`.
On `qdnRequest`, Home verifies Core's signed QPGC control records and owns key
recovery, relay, rotation, encryption, decryption, MemoryPoW, signing, and
encrypted account-bound key persistence. On `qortalRequest`, Home discovers
only current-administrator `DOCUMENT_PRIVATE` bundles, supports the established
old/new `encryptSingle` forms, publishes or rotates current-member bundles, and
uses Qortal's app-level encrypted group CHAT wire. Apps receive plaintext rows
or explicit missing-key failures but never group keys. If the selected Qortal
route's operator disables QDN staging, publication/rotation fails with
`NODE_CAPABILITY_MISSING`; reads and already-keyed message sends remain on that
same selected route and there is no plaintext or alternate-node fallback.

`OPEN_QDN_RESOURCE_VIEWER`, `GET_QDN_RESOURCE_STREAM_URL`, and
`SAVE_QDN_RESOURCE` are read-only and available through both Home 2 globals in
every readable node mode. The first opens Home's public-resource viewer as a
tab-scoped overlay; the second returns a host-safe ranged URL for inline
image/audio/video elements; the third opens the platform save picker. The
invoked global fixes the network, so no action crosses from Qortal to Qortium
or the reverse. See
[QDN resource viewing and streaming](QDN_RESOURCE_VIEWER.md) for the request
shapes, supported services, Android proxy behavior, compatibility actions, and
lazy-loading guidance.

`SELECT_QDN_PUBLISH_SOURCE` and `PUBLISH_QDN_RESOURCE` are the Home 2 public
publication pair on both globals. They are advertised only while the invoked
network has a reachable selected route. Selection returns a 30-minute token
bound to the app, tab, account, chain, and route; no native path or inline
bytes cross the bridge. Publication always uses a single-request
`qdn.publish` approval, verifies current name ownership, stages and attests on
that exact route, signs locally, and returns a transaction signature plus
SHA-256 content pin. Qortal currently rejects mutable resource metadata. See
[Home 2 public QDN publishing](QDN_PUBLIC_PUBLISHING.md) for request, result,
unknown-broadcast, and operator-denial behavior.

Home 2 private chat attachments use `PUBLISH_CHAT_ATTACHMENT`,
`GET_CHAT_ATTACHMENT_STREAM_URL`, `OPEN_CHAT_ATTACHMENT_VIEWER`, and
`SAVE_CHAT_ATTACHMENT` through both globals. They reuse the Home-issued source
token but never accept inline bytes or paths. Home chooses and authenticates the
chain-specific encrypted format, publishes only ciphertext, and returns an
immutable descriptor. Every decrypt/view/save/stream request is a one-request
`chat.attachment` approval; plaintext is never returned inline, while the
stream action grants temporary bounded byte access through an opaque URL. See
[Home 2 private chat attachments](HOME_CHAT_PRIVATE_ATTACHMENTS.md) for the
descriptor, exact formats, limits, and observable-metadata boundary.

Home 2 exposes `NOTIFICATION_HAS_PERMISSION` and `SHOW_NOTIFICATION` through
both bridge protocols without depending on a node route or wallet unlock. The
invoked protocol fixes the chain; optional group/direct source identity is
validated and repeated in the result and click event. The first request uses a
durable, revocable app-scoped `notifications.show` approval. Home visibly
suffixes every title with the app name and chain, suppresses focused tabs, and
rate-limits each app. See [Home 2 app notifications](HOME_V2_APP_NOTIFICATIONS.md)
for the request, result, permission, desktop/Android, and background-watcher
boundary.

Home 2 exposes route-independent `GET_PENDING_TRANSACTIONS` and
`FORGET_PENDING_TRANSACTION` on both protocols. Home automatically records an
opaque account/app/chain/action/target/signature entry when a signed mutation
returns an unknown broadcast outcome, and blocks a same-target mutation until
the app reconciles and explicitly forgets that signature. The read uses a
scoped `transactions.pending.read` approval; forgetting is always a
single-request `transactions.pending.forget` approval. No message, payload,
key, native path, or attachment bytes enter the journal. See
[Home 2 Chat operational completion](HOME_V2_OPERATIONAL_COMPLETION.md) for the
lifecycle, retention, duplicate-prevention, and platform/route matrix.

Qortium private-group sends are the narrow exception to the same-target block:
when no current-epoch key exists, Home first creates and broadcasts an
independent `KEY_ANNOUNCEMENT`, then submits the requested message mutation only
after that broadcast is accepted. If the announcement outcome is unknown, the
journal entry carries `stage: "key-announcement"`, the result carries
`messageSubmitted: false`, and another attempt of the original message remains
safe because no message transaction was built or submitted. The announcement
signature is still retained until the app observes a usable current-epoch key
and explicitly forgets it.

The Home-data manager actions are `BOOKMARKS_HAS_PERMISSION`, `BOOKMARKS_GET`,
`BOOKMARKS_APPLY`, `BOOKMARKS_OPEN`, `NOTIFICATION_MANAGER_HAS_PERMISSION`,
`NOTIFICATION_MANAGER_GET`, `NOTIFICATION_MANAGER_SET_MUTED`,
`NOTIFICATION_MANAGER_REMOVE_RULES`, and `NOTIFICATION_MANAGER_REVOKE`. They
remain available when Home uses a public/network node because they operate on
Home's local device data rather than Core.

`GET_APP_ASSIGNMENTS` and `REQUEST_APP_ASSIGNMENT` provide the generic,
consented app-target mechanism; see [Home app assignments](HOME_APP_ASSIGNMENTS.md).
These assignment actions describe the older shell catalogue. Home 2.1's current
F4 Settings-only implementation does not advertise them through its
`SHOW_ACTIONS`; app-facing delegation remains deferred.

## Balances and wallet capability discovery

`GET_BALANCE` reads a Qortium-chain asset balance. `address` is optional and
defaults to the selected account. `assetId` is also optional and accepts a
non-negative safe integer or integer string at either the top level or inside
`payload`:

```js
const nativeDefault = await qdnRequest({ action: 'GET_BALANCE' });
const explicitNative = await qdnRequest({ action: 'GET_BALANCE', assetId: 0 });
const assetBalance = await qdnRequest({
  action: 'GET_BALANCE',
  address: 'Q...',
  assetId: 2,
});
```

When `assetId` is omitted or blank, Home preserves the legacy Core request
`/addresses/balance/{address}`. An explicit value, including `0`, is forwarded
as `?assetId={id}`. Core's response is returned unchanged. Negative,
fractional, unsafe, array, object, and otherwise malformed values are rejected
before a Core request is made. An explicit asset ID that does not exist is a
Core error; in particular, Previewnet currently has no asset `0`, so the
explicit-native example is a contract example rather than a claim that the
asset exists there.

`GET_QORT_BALANCE` is separate: it reads QORT from the Qortal chain through
Home's configured public-node path. It does not accept a Qortal asset ID.
Qortal assets other than QORT are not supported by Home.

`GET_CROSSCHAIN_BLOCKCHAINS` preserves every field and row returned by the
connected Qortium Core, prepends Home's QORT row, and adds this feature-detectable
projection to each row:

```json
{
  "homeWallet": {
    "implemented": true,
    "read": true,
    "receive": true,
    "send": true,
    "requiresUnlockedAccount": true,
    "sendMode": "TRUSTED_CORE"
  }
}
```

Core's `supportsWallet` says the chain adapter implements a wallet, while
`walletEnabled` reports the connected Core's current configuration. Neither
field proves that this Home build can derive the wallet. `homeWallet` describes
Home itself:

- QORT uses `HOME_SIGNED_PUBLIC_NODE`: Home signs locally and submits only
  signed bytes to a Qortal public node.
- BTC, LTC, DOGE, DGB, RVN, DASH, NMC, and FIRO use `TRUSTED_CORE`: Home
  implements balance, receive, and send, but a send still requires a trusted
  Core connection and an unlocked account.
- Other and unknown currency codes fail closed with all operation flags false
  and `sendMode: "NONE"`.

Static `send: true` means the Home build implements that flow. It does not
override runtime node-mode checks, wallet lock state, Core enablement, funds,
fees, or server availability. Apps must handle those operation-time failures.
See [Coin support matrix](COIN_SUPPORT_MATRIX.md) for the tracked implementation
and acceptance status.

The current Bitcoin-family read actions accept `coin` (or the compatibility
alias `blockchain`) for BTC, LTC, DOGE, DGB, RVN, DASH, NMC, and FIRO:

- `GET_USER_WALLET` returns the locally derived first receive address plus the
  root extended public key as both `publicKey` and legacy `publickey`.
- `GET_WALLET_BALANCE` sends the extended public key as `text/plain` to
  `/crosschain/{coin}/walletbalance`.
- `GET_USER_WALLET_INFO` sends JSON `{ "xpub58": "..." }` to
  `/crosschain/{coin}/addressinfos`.
- `GET_USER_WALLET_TRANSACTIONS` sends the extended public key as `text/plain`
  to `/crosschain/{coin}/wallettransactions`.

These actions require an unlocked account and a trusted local Core connection.
Home never sends the extended private key in a read request or returns it to the
app. If Core reports API error `1201` because it cannot connect to a
wallet-capable server, `qdnRequest` rejects with an `Error` whose `code` is
`FOREIGN_WALLET_BACKEND_UNAVAILABLE` and whose message names the requested
coin. This is a runtime availability result: `homeWallet.read: true` still
correctly reports that Home implements the read flow. For example, DGB is
currently implemented but returns this explicit unavailable error on the local
Previewnet Core while its configured servers reject wallet requests.

## Account and group avatars

`RESOLVE_IDENTITIES` and `GET_SELECTED_ACCOUNT` predate pointer-based avatars.
Their `avatarSrc` / `avatarUrl` fields remain legacy named-thumbnail
compatibility hints and now carry
`avatarContract: 'LEGACY_NAMED_THUMBNAIL'` (or `null`). They do not prove that
the resource exists and do not reflect an account's on-chain avatar pointer.
Pointer-aware apps should use these actions for names/account context, then
feature-detect and call `FETCH_ACCOUNT_AVATAR` for visible avatar images. This
keeps the 500-address identity batch from downloading and base64-encoding up to
500 images while preserving older apps unchanged.

Home 2 advertises both `FETCH_ACCOUNT_AVATAR` and `FETCH_GROUP_AVATAR` on
`qdnRequest` and `qortalRequest`. The invoked protocol is authoritative and the
normalized ready/pending result repeats `network: 'qortium' | 'qortal'` so a
consumer can keep caches chain-scoped. Qortium resolves the on-chain pointer
contract described below. Qortal has no equivalent pointer transaction, so it
uses `THUMBNAIL/<primaryName>/qortal_avatar` for accounts and
`THUMBNAIL/<ownerPrimaryName>/qortal_group_avatar_<groupId>` for groups. Home
never falls back from one protocol to the other.

`FETCH_GROUP_AVATAR` accepts a positive `groupId` (or `txGroupId`), while
`FETCH_ACCOUNT_AVATAR` accepts an `address` (or uses the selected account).
Both are read-only, public-node-safe actions. They query Core's exact-avatar
info endpoint before fetching bytes: an explicit on-chain pointer always wins
and an invalid/missing pointer resource fails closed. A ready response is
`{ groupId|address, body, encoding: 'base64', contentType, contentLength,
source, descriptor }`; `source` is `POINTER` or `LEGACY`, and `descriptor`
is Core's `{ service, name, identifier }` tuple when a pointer is set.
While Core queues QDN data, Home returns `{ groupId|address, status: 'PENDING',
retryAfterSeconds, source, descriptor }`. Home caps responses at 500 KiB and
accepts only image MIME types confirmed by image magic bytes when the server
reports a generic content type. Apps build an in-memory Blob from `body`; Home
never returns a raw node URL that could bypass the on-chain pointer.

Only an exact Core-info `404` is eligible for a mutable legacy fallback. Account
fallback tries `THUMBNAIL/<primaryName>/avatar`, then Qortal Hub's
`THUMBNAIL/<primaryName>/qortal_avatar`; group fallback uses Hub's
`THUMBNAIL/<ownerPrimaryName>/qortal_group_avatar_<groupId>`. Legacy results are
always marked `source: 'LEGACY'`; callers must not treat them as an on-chain
pointer.

`SET_GROUP_AVATAR` requires a single-request approval and a local/trusted
node. It accepts `groupId` plus `avatar`, which is either `null` to clear the
avatar or `{ service, name, identifier }`, where `identifier` may be empty for
the default resource. Home looks up the group for approval context, then builds
and signs the Core
`SET_GROUP_AVATAR` transaction. It is intentionally separate from
`UPDATE_GROUP` so users approve the avatar assignment explicitly.

`SET_ACCOUNT_AVATAR` has the same nullable pointer rule and separate
single-request approval, but always targets the selected account and always
uses `txGroupId: 0`. A pointer may name any public single-file QDN resource,
including one published under another registered name, and Core serves its
latest revision. The target need not exist when the pointer transaction is
created; Core enforces the raster-image type and 500 KiB limit when serving it.

For publishing before setting the pointer, use the existing `PUBLISH_QDN_RESOURCE`
with `THUMBNAIL/<primaryName>/avatar` for accounts, or
`THUMBNAIL/<ownerPrimaryName>/qortium-group-avatar-v1-<groupId>` for groups.
Publishing and pointer assignment remain deliberately separate actions.

## Publishing sources

Home 2's clean, network-qualified single-resource replacement is documented in
[Home 2 public QDN publishing](QDN_PUBLIC_PUBLISHING.md). The following broader
inline/directory/multi-resource and preview surface describes only the retained
compatibility bridge; Home 2 does not advertise those legacy variants.

Single-resource publishing can use inline `data64`/`base64` payloads or a
Home-owned file/folder picker on desktop and a Home-owned single-file native
picker on Android. `SELECT_QDN_PUBLISH_SOURCE` can return a `sourceToken` and
`sourceToken` is accepted on `PUBLISH_QDN_RESOURCE` and each entry of
`PUBLISH_MULTIPLE_QDN_RESOURCES` as an alternative to inline `data64`/`base64`.
`PUBLISH_MULTIPLE_QDN_RESOURCES` still requires either inline data or a token
for each resource. `SELECT_QDN_PUBLISH_SOURCE` accepts optional `kind` (`file`
or `directory`) and returns `{ canceled: true }` or a source result with
`fileName`, `kind`, `size`, and `sourceToken`.

Apps can show the selected source in Home before publishing it with
`PREVIEW_QDN_PUBLISH_SOURCE`. First request a source from Home, then pass back
only the opaque `sourceToken`:

```js
const selected = await qdnRequest({
  action: 'SELECT_QDN_PUBLISH_SOURCE',
  kind: 'file', // or 'directory' where the app supports it
});

if (!selected.canceled) {
  await qdnRequest({
    action: 'PREVIEW_QDN_PUBLISH_SOURCE',
    sourceToken: selected.sourceToken,
  });
}
```

Preview returns `true` once Home opens its own display-only preview. The app
never receives the selected path, source bytes, or Core render URL. Tokens are
opaque, bound to the originating app tab, expire after inactivity, and preview
does not consume them, so a later `PUBLISH_QDN_RESOURCE` may reuse the same
token. Preview requires Home and its local Core preview flow; standalone-browser
fallbacks must present it as unavailable rather than attempting a local file
upload. Apps must not send a path, raw bytes, or any field other than the token
to `PREVIEW_QDN_PUBLISH_SOURCE`.

Publish/delete, group, and name write requests require
per-request approval before Home signs and processes the transaction with the
selected tab account. Public/private chat sends use their scoped chat approval;
private-group key request, relay, and rotation are always single-request.
Private-group and direct reads may use a tab-session grant for the exact
account, conversation, route, and app identity. Home performs the crypto and
signing locally so QDN apps never receive wallet private keys, reusable chat
keys, or generic signing capability.

## `SEND_MESSAGE` (AT contracts only)

`SEND_MESSAGE` is the narrowly scoped contract-message action. It is **not** a
generic transaction builder or signing capability: it accepts only a non-empty
UTF-8 `message` (up to 4,000 bytes) and an AT `recipient` (or
`recipientAddress`). Home verifies the recipient's Qortium AT address version
and checksum, then fixes all other transaction fields: transaction group `0`,
no payment or asset, plaintext text, and fee `0`. Account addresses, encrypted
messages, payments, transaction-group selection, raw transaction bytes, and
app-supplied private keys are all outside this action's contract.

```js
const result = await qdnRequest({
  action: 'SEND_MESSAGE',
  recipient: 'A...', // a checksummed Qortium AT address
  message: 'claim',
});
```

Every request displays a single-request approval showing the exact recipient,
message, zero-fee MESSAGE transaction, and local proof-of-work cost. MESSAGE
does not use Core's generic mempow endpoint: its own nonce is computed locally
with the 8 MiB MemoryPoW buffer at Previewnet's confirmable-message difficulty
(`12` for an AT recipient). Home signs locally and sends only the final signed
bytes to `/transactions/process`; the app never receives a private key and a
public/network node never receives one. Because the bridge has this keyless
local-sign path, `SHOW_ACTIONS` advertises `SEND_MESSAGE` in local, custom, and
public/network modes.

## `FETCH_NODE_API` limits

`FETCH_NODE_API` accepts path-only requests such as `/admin/status` and only
allows `GET` or `HEAD`. Full external URLs, legacy aliases such as
`GET_NODE_API`, string-form requests, and write-style methods are rejected.

`FETCH_QORTAL_NODE_API` is the same read-only passthrough aimed at the
configured Qortal node instead of the Qortium node, with identical path,
method, and `maxBytes` rules. It is the escape hatch for Qortal read
endpoints that have no dedicated `GET_QORTAL_*`/`SEARCH_QORTAL_*` action.
Both passthrough actions return the node-API result envelope
(`{ ok, status, data, body, ... }`), not the bare response body — apps should
check `ok` and read `data`.

## Asset reads (`GET_ASSET_INFO`, `GET_ASSET_BALANCES`, `GET_ASSET_TRANSFERS`)

These wrap Core's `/assets/info`, `/assets/balances`, and `/assets/transfers/{id}`
read endpoints directly - same shapes Core returns, no envelope. They are plain
reads and work on a public/network Qortium node.

`GET_ASSET_INFO` takes `assetId` or `assetName` (at least one required; `assetId`
wins if both are given, matching Core):

```js
const info = await qdnRequest({ action: 'GET_ASSET_INFO', assetId: 5 });
// or
const info = await qdnRequest({ action: 'GET_ASSET_INFO', assetName: 'MYASSET' });
```

`GET_ASSET_BALANCES` takes `address` and/or `assetId` (at least one required),
plus optional `excludeZero` and `limit`:

```js
const balances = await qdnRequest({
  action: 'GET_ASSET_BALANCES',
  address: 'Qxyz...',
  excludeZero: true,
  limit: 0,
});
```

When `assetId` is present it must be a non-negative safe integer. Home rejects
malformed or negative values instead of dropping the filter and returning a
broader address-balance result.

`GET_ASSET_TRANSFERS` takes a required `assetId`, plus optional `address`,
`limit`, and `reverse`:

```js
const transfers = await qdnRequest({
  action: 'GET_ASSET_TRANSFERS',
  assetId: 5,
  address: 'Qxyz...',
  limit: 20,
  reverse: true,
});
```

`TRANSFER_ASSET` additionally rejects a fractional `amount` when the target
asset's `isDivisible` is `false`, before requesting write approval - the same
rule the wallet's own send form already enforces client-side, now also
enforced at the bridge for every app that calls `TRANSFER_ASSET`.

## `SEARCH_QORTAL_TRANSACTIONS`

`SEARCH_QORTAL_TRANSACTIONS` searches the Qortal chain's transaction history
(`/transactions/search` on the configured Qortal node) and returns the parsed
transaction array directly — no envelope, and a failed request throws like the
other dedicated read actions. `address` defaults to the selected account.
Optional fields pass straight through to Core: `txType` (a string or an array
for several types; `txTypes` is accepted as an alias), `confirmationStatus`
(defaults to `CONFIRMED`), `limit`, `offset`, `reverse`, `startBlock`,
`blockLimit`, and `txGroupId`. Example — the 20 most recent confirmed QORT
payments for the selected account:

```js
await qdnRequest({
  action: 'SEARCH_QORTAL_TRANSACTIONS',
  txType: 'PAYMENT',
  limit: 20,
  reverse: true,
});
```

## Rating actions

`RATE_RESOURCE` submits a Core resource rating for an existing public QDN
resource after user approval. The action accepts `service`, `name`, optional
`identifier` (defaulting to `default`), and `rating`; ratings `1` through `10`
record a rating, while `0` removes the selected account's active rating.

`GET_RESOURCE_RATING` fetches Core resource rating data for a target resource and
the selected rater. The action accepts `service`, `name`, optional `identifier`
(defaulting to `default`), and optional `rater` (an address). If `rater` is not
provided, Home uses the currently selected account address. The response shape is
`{ action, service, name, identifier, rater, summary, rating }` where `summary`
or `rating` can be `null` when empty.

`GET_ACCOUNT_RATING` fetches Core account rating summary data and the rater's
own rating edges for `target`. The action accepts `target`, optional `category`,
and optional `rater` (an address). If `rater` is not provided, Home uses the
currently selected account address. The response shape is
`{ action, target, category, rater, summary, ratings }` where `summary` is `null`
and `ratings` is an array (empty when no ratings are returned).

## Minting actions (Home 2)

Home 2 exposes four minting actions on both `qdnRequest` and `qortalRequest`:
`GET_MINTING_STATUS`, `LIST_MINTING_ACCOUNTS`, `START_MINTING`, and
`REMOVE_MINTING_ACCOUNT`. They exist so an app never needs the raw
`/admin/mintingaccounts` route, which stays outside `normalizeHomeV2ReadPath`'s
read-only scope and always will.

The two reads are permissionless — they return derived booleans and allowlisted
fields, never key material. The two writes always prompt, are single-request
only (never a session or "always allow" grant), and each asks separately.

`GET_MINTING_STATUS` accepts an optional `address` (defaulting to the selected
account) and answers
`{ address, hasRewardShare, isMinting, keyOnNode, nodeMintingPossible }`.
`hasRewardShare` comes from the public `/addresses/rewardshares` route and is
always populated. The other three describe the node itself and are `null`
unless the selected node is the local Core Home runs and holds an API key for —
on a public node, a custom node, on Android, and on Qortal they are always
`null`.

`LIST_MINTING_ACCOUNTS` answers `{ accounts, available }`. `available` is
`false` — with an empty `accounts` — wherever the node-side state is not
readable, matching the `null`s above. Each entry carries only `address`,
`mintingAccount`, `publicKey`, and `recipientAccount`; `publicKey` is the
reward-share PUBLIC key that `REMOVE_MINTING_ACCOUNT` matches on. Entries are
rebuilt from that fixed allowlist rather than filtered, so nothing else a Core
build serializes alongside them can reach an app.

`START_MINTING` takes no parameters and acts on the selected, unlocked account.
Home derives that account's minting key, loads it onto the local Core, and
answers `{ accepted, action, address, keyAdded }`. When the account has no
on-chain self-share authorization yet, Home submits a zero-fee self-share
`REWARD_SHARE` instead and answers with `rewardSharePending: true` and the
`transactionSignature`; the app should call again once it confirms. No key
material is ever returned.

`REMOVE_MINTING_ACCOUNT` removes the selected account's OWN minting key from
the local Core, answering `{ accepted, action, address, publicKey, removed }`.
Nothing on chain changes.

The key is not a parameter. Home resolves it in the main process from the
node's own `/admin/mintingaccounts` list — the entry whose `mintingAccount` and
`recipientAccount` are both the selected address — and deletes only that,
re-resolving after the approval to confirm it is still the key the user was
shown. Core's `DELETE` matches a private key as readily as a public one and
removes whatever it matches, so honoring an app-supplied value would be both an
arbitrary-key-removal primitive and a way to push key material through Home.
An app may still send `publicKey`; it is treated purely as an assertion,
compared against the resolved key, and rejected on mismatch — it is never
forwarded to the node.

When the node holds no self-share key for the selected account, the action
answers `{ removed: false, publicKey: null }` without prompting and without
calling the node: that is a no-op, not a failure.

### Restrictions shared by the minting family

The trusted node must be `local` mode, have an API key Home holds, **and**
resolve to a loopback host (`127.0.0.0/8`, `localhost`, or `::1`). The mode and
the key both come from Home's own settings, so the loopback requirement is what
keeps an administrative or account private key off the network if either is
mis-set. Any other host is refused before a single admin call or secret-bearing
POST is made.

Errors from the calls that carry key material — `/addresses/rewardsharekey`,
`/utils/publickey`, `/addresses/rewardshare`, and the `/admin/mintingaccounts`
POST and DELETE — are reduced to the operation name and HTTP status. Core
echoes request context into its error bodies, so no body from these calls
reaches the app, and none is written to a log either.

None of the four actions is offered to a chromeless widget. The two reads would
otherwise pass the widget `GET_`/`LIST_` prefix rule, but they describe the
user's own node and `GET_MINTING_STATUS` defaults to the selected account's
address, and a widget has no prompt surface to disclose that through.
