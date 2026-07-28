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
`GET_ADMIN_GROUP_JOIN_REQUESTS`, `GET_BALANCE`, `GET_GROUP`,
`GET_GROUP_JOIN_REQUESTS`, `GET_GROUP_MEMBERS`, `GET_MINTING_STATUS`,
`GET_NAME_DATA`, `LIST_GROUPS`, `SEARCH_GROUPS`, `SEARCH_CHAT_MESSAGES`,
`GET_QDN_RESOURCE_METADATA`,
`GET_QDN_RESOURCE_PROPERTIES`, `GET_QDN_RESOURCE_STATUS`,
`GET_QDN_RESOURCE_URL`, `FETCH_QDN_RESOURCE`, `LIST_QDN_RESOURCES`,
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
`WHICH_UI`, and `SHOW_ACTIONS`. Desktop isolated QDN apps and Android tokenized
APP/WEBSITE pages also support `PUBLISH_QDN_RESOURCE`,
`PUBLISH_MULTIPLE_QDN_RESOURCES`, `DELETE_QDN_RESOURCE`,
`APPROVE_GROUP_JOIN_REQUEST`, `INVITE_TO_GROUP`, `JOIN_GROUP`, `LEAVE_GROUP`,
`UPDATE_GROUP`, `SET_GROUP_AVATAR`, `SET_ACCOUNT_AVATAR`, `START_MINTING`, `REGISTER_NAME`, `UPDATE_NAME`, `SELL_NAME`,
`CANCEL_SELL_NAME`, `BUY_NAME`, `SEND_CHAT_MESSAGE`, `SEND_MESSAGE`,
`GET_PRIVATE_GROUP_ACTIVE_CHATS`, `SEARCH_PRIVATE_GROUP_CHAT_MESSAGES`,
`GET_PRIVATE_DIRECT_ACTIVE_CHATS`, `RATE_ACCOUNT`, `RATE_RESOURCE`, and
`SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES`.

The Home-data manager actions are `BOOKMARKS_HAS_PERMISSION`, `BOOKMARKS_GET`,
`BOOKMARKS_APPLY`, `BOOKMARKS_OPEN`, `NOTIFICATION_MANAGER_HAS_PERMISSION`,
`NOTIFICATION_MANAGER_GET`, `NOTIFICATION_MANAGER_SET_MUTED`,
`NOTIFICATION_MANAGER_REMOVE_RULES`, and `NOTIFICATION_MANAGER_REVOKE`. They
remain available when Home uses a public/network node because they operate on
Home's local device data rather than Core.

`GET_APP_ASSIGNMENTS` and `REQUEST_APP_ASSIGNMENT` provide the generic,
consented app-target mechanism; see [Home app assignments](HOME_APP_ASSIGNMENTS.md).

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
selected tab account. Chat sends and private closed-group reads use a
session-scoped approval for the current tab and selected account; direct private
chat sends and reads use Core-managed direct-message helpers so QDN apps never
receive wallet private keys or generic signing capability.

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
