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
the live settings-change event. In Home 2 the Home-settings family is
`qdnRequest`-only and route-independent — none of the three touches a node, and
Home has one appearance rather than one per chain — and all three are excluded
from widgets, the two reads included: a widget has no trusted chrome to raise
the update prompt on, and the display subset it needs already arrives as
render-URL parameters. The update approval is single-request only, never
"session" or "always", so no durable grant for it exists to revoke.
Bookmark and notification management use
separate durable capabilities and revision-checked mutations; see
[Home data manager QDN bridge](HOME_DATA_MANAGERS.md). Other supported actions include
`WHICH_UI`, `SHOW_ACTIONS`, and the route-independent Home-owned
`SHOW_CONTEXT_MENU`. See [Home 2 context menus](HOME_V2_CONTEXT_MENUS.md) for
the structured target, safe action, result, desktop-native, Android-sheet, and
standalone-gateway boundaries. Desktop isolated QDN apps and Android tokenized
APP/WEBSITE pages also support `PUBLISH_QDN_RESOURCE`,
`PUBLISH_MULTIPLE_QDN_RESOURCES` and `DELETE_QDN_RESOURCE`,
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
`SEND_DIRECT_CHAT_DELETE`, and `SEND_DIRECT_CHAT_REACTION`. Direct reads need
an unlocked selected account and do not prompt (permissionless reads, owner
decision 2026-08-24); writes
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

### Actions restored in Home 2.1

Five bridge actions that Home 1.x served are supported again in Home 2, on the
protocols listed here. None of them adds a new approval: the reads are public
node reads, and the navigation and viewer entries match the posture of the
actions they sit beside.

- `GET_ACCOUNT_DATA` and `GET_BALANCE` are now advertised on **both**
  `qdnRequest` and `qortalRequest`. The handlers always derived their path from
  the invoking global's network, so the Qortium half was a catalogue omission
  rather than a missing implementation — a Qortium app calling
  `qdnRequest({ action: 'GET_ACCOUNT_DATA', address })` reads Qortium, and the
  `qortalRequest` behavior is unchanged. Both take a validated address and
  neither returns anything private.

  **Superseded by the tier-2 restoration below.** This bullet used to add that
  Home 2's `GET_BALANCE` required an explicit `address` and took no `assetId`,
  unlike the Home 1.x action described under "Balances and wallet capability
  discovery". That is no longer true, and the gap it described is what broke
  the wallet app's balance column: `address` is again optional and defaults to
  the selected account, and `assetId` is again honored.
- `FETCH_NODE_API` now allows the `/resource-ratings` prefix, alongside the
  `/account-ratings` prefix it already allowed. These are Core's anonymous
  resource-rating reads. The rating *write* is a signed `RATE_RESOURCE`
  transaction and stays out of reach: the passthrough allows only `GET` and
  `HEAD`, so Core's `POST /resource-ratings/rate` cannot be called through it.
- `OPEN_CURRENT_TAB` is supported on both globals. It replaces the content of
  the tab the calling app is running in, instead of adding one:

  ```js
  await qdnRequest({ action: 'OPEN_CURRENT_TAB', address: 'qdn://APP/Alice/Apps' });
  ```

  It accepts the same addresses as `OPEN_NEW_TAB` — `qdn://`, `qortal://`, and
  `home://`, up to 2 048 characters — through the same shared validator. Home
  1.x also accepted `core://` here; Home 2 does not, on either open action.
  There is no prompt, for the same reason `OPEN_NEW_TAB` has none: Home still
  owns where the address resolves to, and navigating your own tab is weaker
  than adding one to the strip. The tab acted on is always the requesting
  view's own — no tab id is read from the request — and Home refuses to replace
  anything that is not an app tab, so an app cannot navigate another app's tab
  or take over Settings, the dashboard, Core docs, or release notes. Those
  addresses stay reachable through `OPEN_NEW_TAB`.

  Three further rules, which `OPEN_NEW_TAB` does not share:

  - **An explicit resource identifier is required, and the address must name an
    app resource.** `qdn://APP/Alice/Apps` works; a bare `qdn://APP/Alice` and
    a `home://` page each fail the bridge call itself, with an error, on both
    transports. A bare name can match more than one published resource, and the
    address bar resolves that by asking the user which one they meant — but
    there is nobody to ask on a bridge call, and reporting success while doing
    nothing would be a lie. `?identifier=` is a query, not a path identifier,
    and does not satisfy this. Use `OPEN_NEW_TAB` if you want the chooser, or
    to open a Home page.
  - **The replacement is a compare-and-swap.** Home records which app held the
    tab when the request arrived and refuses the write if the tab has since
    closed or moved on to something else. A slow replacement can never land on
    top of a later one, and an app can only replace a tab it was itself still
    occupying.
  - **The tab gets a fresh security context.** Replacing a tab's app tears the
    old app view down and builds a new one, exactly as closing the tab and
    opening the new app would: on desktop the incoming app gets its own
    browser-storage partition and never inherits the outgoing app's cookies,
    `localStorage` or IndexedDB. Each app's desktop partition is named by a
    SHA-256 digest of its node origin and canonical resource identity, so two
    different apps can never be given the same storage. The replaced tab keeps its account binding —
    `OPEN_CURRENT_TAB` cannot change accounts — and every tab-scoped approval
    the outgoing app held is dropped. (On Android every app on a node already
    shares one proxy origin, so a replacement is neither better nor worse than
    a close-and-reopen there; see the Android residual note in
    [Home 2 bridge compatibility](HOME_V2_BRIDGE_COMPATIBILITY.md).)
- `OPEN_QDN_MEDIA_PLAYER` and `OPEN_QDN_DOCUMENT_VIEWER` are supported on both
  globals as compatibility **aliases** of `OPEN_QDN_RESOURCE_VIEWER`, the same
  way `BAN_FROM_GROUP`/`KICK_FROM_GROUP` alias `GROUP_BAN`/`GROUP_KICK`. Home
  collapses each onto the canonical action before dispatch, so they produce the
  same checked request and do not create separate permission capabilities. Each
  alias keeps the narrower service list its 1.x handler enforced —
  `OPEN_QDN_MEDIA_PLAYER` accepts `AUDIO`, `PODCAST`, `VIDEO`, `VOICE`;
  `OPEN_QDN_DOCUMENT_VIEWER` accepts `ATTACHMENT`, `DOCUMENT`, `FILE`, `FILES`
  — and both lists are strict subsets of what `OPEN_QDN_RESOURCE_VIEWER`
  accepts. The legacy `filename` and `mimeType` hints are carried through.
  New apps should call `OPEN_QDN_RESOURCE_VIEWER` directly.

### Tier-2 restoration (R4)

A second batch of Home 1.x actions. Every one is a public read except
`SEND_MESSAGE`, which is the only signing action in the batch and the only one
that prompts. `PREVIEW_QDN_PUBLISH_SOURCE` is deliberately NOT part of it — see
[Home 2 bridge compatibility](HOME_V2_BRIDGE_COMPATIBILITY.md) for why.

- **`GET_USER_WALLET`** (both globals for native; `qdnRequest` for foreign):

  ```js
  const wallet = await qdnRequest({ action: 'GET_USER_WALLET', assetId: 0 });
  // { address: 'Q...', assetId: 0, assetName: 'Native Asset', native: true }
  ```

  Native selectors are `assetId: 0`, the coin aliases `NATIVE`,
  `NATIVE_ASSET`, `ASSET_0`, `ASSET0`, and `QORT`; an absent selector defaults
  to native. `QORT` is a deliberate addition — Home 1.x sent it down the
  foreign path, where it failed as an unsupported foreign coin, which is why
  the legacy wallet's native row was broken. The native result is permissionless
  because it returns strictly less than `GET_SELECTED_ACCOUNT`, which already
  is. A foreign selector (BTC/LTC/DOGE/DGB/RVN/DASH/NMC/FIRO) instead requires
  an unlocked account and the separate session-scoped foreign-wallet disclosure;
  the receive-address action itself does not require Core. Home derives only
  the receive address and xpub; the new path never serializes an xprv. Not
  offered to a chromeless widget.
- **`GET_WALLET_BALANCE`, `GET_USER_WALLET_INFO`,
  `GET_USER_WALLET_TRANSACTIONS`** (`qdnRequest` only) use that same public-only
  derivation and disclosure, then POST only the xpub to the trusted Core. API
  keys remain inside Home. Redirects are refused and responses are bounded.
- **`SET_CURRENT_FOREIGN_SERVER`** (`qdnRequest` only) validates the same exact
  eight-coin set (ARRR remains excluded), shows the node and complete server DTO
  in a single-request prompt, and rechecks node/key revision before its
  authenticated POST. A Core `200` response with `success: false` is preserved.
  Foreign send remains unavailable.
- **`GET_BALANCE` and `GET_ACCOUNT_DATA`** regain their Home 1.x defaults:
  `address` is optional and falls back to the selected account, and
  `GET_BALANCE` forwards a non-negative integer `assetId` as
  `?assetId={id}` (including `0`). See "Balances and wallet capability
  discovery" below, which now describes both bridges. In a chromeless widget
  the self-addressing default is withheld and `address` is required.
- **`UNLOCK_SELECTED_ACCOUNT`** is now advertised on `qortalRequest` as well as
  `qdnRequest`. Unlocking is a Home-account operation, not a chain one — the
  same wallet, the same password dialog, the same key — and the legacy wallet
  app only knows the `qortalRequest` global. Still a single-request prompt that
  opens Home's own dialog; nothing about the approval changed.
- **`GET_CROSSCHAIN_BLOCKCHAINS`, `GET_CROSSCHAIN_SERVER_INFO`,
  `GET_FOREIGN_FEE`, `GET_SERVER_CONNECTION_HISTORY`** (both globals, no
  prompt). Zero-key reads of the node's own `/crosschain` prefix — no wallet
  seed, key derivation, unlocked account, or API key. `coin` accepts BTC, LTC,
  DOGE, DGB, RVN, DASH, NMC, FIRO and ARRR (plus the long names `BITCOIN`,
  `LITECOIN`, `PIRATECHAIN`, …), resolved against a strict allowlist before it
  can become a URL path segment. ARRR is accepted although Home cannot derive
  an ARRR wallet: these reads need no key material, and 1.x wrongly gated them
  on the HD-wallet coin list, which is why the only coin apps actually pass to
  `GET_CROSSCHAIN_SERVER_INFO` was the one it rejected.
  `GET_FOREIGN_FEE` accepts `type`/`feeType` of `TRADE`, `SEND`, `FEEKB`,
  `FEEPERBYTE` (all → Core's `feekb`) or `FEECEILING`, `FEEREQUIRED` (→
  `feerequired`); an absent type means `feekb`. For the `feekb` endpoint Home
  converts Core's per-KILOBYTE figure to a per-byte one with **ceiling**
  division and returns `{ fee, feePerKb }`, so a fee never rounds down below
  what the foreign chain requires.
- **`GET_MARKET_PRICES`** (both globals, no prompt) — the **only** bridge
  action that reaches outside the Qortal/Qortium node network. It calls
  `api.coingecko.com`. To make the outbound request impossible to use as a
  fingerprint or beacon channel, Home fetches ONE fixed superset — every
  supported coin, every supported currency, with 24h change — and projects each
  app's requested subset locally from that one response. The outbound URL is a
  compile-time constant: no app input reaches it, so an app cannot vary coins,
  currencies, or the change flag to change what leaves the machine, and no user
  data is sent (no address, account id, public key, app identity, node URL,
  cookie, or custom header beyond `Accept`). At most one request goes out per
  cache interval, globally — a minimum interval governs *attempts*, so even a
  run of failures cannot exceed it — and concurrent callers share one in-flight
  fetch. On a fetch failure a cached answer comes back with `stale: true` and a
  `staleReason`; with nothing cached the error propagates rather than inventing
  a price. Route-independent: it answers even when every node route is disabled.
- **`GET_ACCOUNT_RATING` and `GET_RESOURCE_RATING`** (both globals, no prompt).
  Each combines two anonymous public reads — the subject's summary and this
  rater's own rating. A 404 on either half means "not rated yet" and becomes
  `null` (or `[]` for the account-rating list), and Core's three empty shapes
  (`null`, `[]`, `{}`) all collapse to `null`. `rater` defaults to the selected
  account, withheld in a widget because the response echoes `rater` back. See
  "Rating actions" below for field details. The rating *writes* stay deferred.
- **`GET_GROUP_BANS`, `GET_GROUP_KICKS`, `GET_MEMBER_BANS`,
  `GET_MEMBER_KICKS`** (both globals, no prompt). Anonymous public reads of
  group moderation history, with a positive-integer `groupId`, address regex,
  a 100-entry page cap where Core has none, and `before`/`after` validated
  against the same millisecond floor Core enforces for chat. The member-scoped
  pair defaults `address` to the selected account, withheld in a widget. The
  moderation *writes* are signed transactions and never travel this passthrough.
- **`SEND_MESSAGE`** (`qdnRequest` only) — see its own section below.

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

`SELECT_QDN_PUBLISH_SOURCE` and `PUBLISH_QDN_RESOURCE` are the Home 2 QDN
publication pair on both globals. They are advertised only while the invoked
network has a reachable selected route. Selection returns a 30-minute token
bound to the app, tab, account, chain, and route; no native path or inline
bytes cross the bridge. Desktop Qortium uses the streamed authenticated
builder and its node-advertised limit when that exact route is admin-trusted;
otherwise the existing keyless public builder and public limit remain in use.
Publication always uses a single-request `qdn.publish` approval, verifies
current name ownership, stages and attests on that exact route, signs locally,
and returns a transaction signature plus SHA-256 content pin. Qortal currently
rejects mutable resource metadata. See [Home 2 QDN publishing](QDN_PUBLIC_PUBLISHING.md)
for request, result, route selection, unknown-broadcast, and operator-denial
behavior.

`STAGE_QDN_PUBLISH_SOURCE` complements the picker for bytes an app already
legitimately holds — a pasted screenshot or a drag-dropped file. The app sends
`{ bytesBase64, fileName, mimeType? }` (at most 25 MiB, validated before
decoding) and receives the same selection shape the picker returns, whose
`sourceToken` the publish actions redeem unchanged. Staging never prompts and
grants nothing by itself: the redeeming publish still runs its full approval
flow, staged bytes live in the same bounded, TTL-limited store as picker
selections, and the publish contracts continue to refuse inline bytes on the
publish actions themselves.

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

Both families are advertised by Home 2 as well, on `qdnRequest` only. Home 2
shipped the bookmark half first and carried this paragraph while the
notification half was still 1.x-only; as of the 2.1 line both halves are
app-facing on desktop and Android. They are deliberately absent from
`qortalRequest`: the data they read and write is Home's own profile, so a
chain-scoped copy of it would not mean anything. A Qortal-routed app calls them
on `qdnRequest`; the durable capability and the manager app key are
protocol-independent.

The notification manager is a closed administrative surface. It can mute an
app, delete an app's stored rules, and revoke an app's notification permission.
It cannot CREATE a rule for any app — rule creation belongs to each originating
app's own actions, which Home 2 has not implemented. See
[Home data manager QDN bridge](HOME_DATA_MANAGERS.md) for the request and
response shapes, and
[Home 2 app notifications](HOME_V2_APP_NOTIFICATIONS.md) for why the creation
half is still deferred.

`GET_APP_ASSIGNMENTS` and `REQUEST_APP_ASSIGNMENT` provide the generic,
consented app-target mechanism; see [Home app assignments](HOME_APP_ASSIGNMENTS.md).
These assignment actions describe the older shell catalogue. Home 2.1's current
F4 Settings-only implementation does not advertise them through its
`SHOW_ACTIONS`; app-facing delegation remains deferred.

## Balances and wallet capability discovery

`GET_BALANCE` reads an asset balance on the protocol that invoked it:
`qdnRequest` selects Qortium and `qortalRequest` selects Qortal. `address` is
optional and defaults to the selected account. `assetId` is also optional and
accepts a non-negative safe integer or integer string at either the top level
or inside `payload`:

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

QORT is Qortal asset `0`, so apps should read it with `qortalRequest` and an
explicit `assetId: 0` (or the QORT compatibility action where applicable).
`GET_ASSET_INFO`, `GET_ASSET_BALANCES`, and `GET_ASSET_TRANSFERS` are likewise
available on both globals and remain bound to the invoking protocol. Asset IDs
are never used to guess a chain.

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
    "readMode": "TRUSTED_CORE",
    "receiveMode": "HOME_LOCAL",
    "sendMode": "HOME_LOCAL",
    "serverManagement": true,
    "serverManagementMode": "TRUSTED_CORE"
  }
}
```

Core's `supportsWallet` says the chain adapter implements a wallet, while
`walletEnabled` reports the connected Core's current configuration. Neither
field proves that this Home build can derive the wallet. `homeWallet` describes
Home itself:

- QORT uses `HOME_SIGNED_PUBLIC_NODE`: Home signs locally and submits only
  signed bytes to a Qortal public node.
- BTC, LTC, DOGE, DGB, RVN, DASH, NMC, and FIRO use `HOME_LOCAL` receive/send
  and `TRUSTED_CORE` read/server-management modes. On desktop and Android,
  foreign send is advertised only while the selected account is unlocked and
  the authenticated Core positively proves the spend-context route exists.
  Home plans and signs locally, durably journals before the one broadcast, and
  sends Core only the final raw transaction.
- Other and unknown currency codes fail closed with all operation flags false
  and `sendMode: "NONE"`.

Static `send: true` means the Home build implements that flow. It does not
override runtime node-mode checks, wallet lock state, Core enablement, funds,
fees, or server availability. Apps must handle those operation-time failures.
See [Coin support matrix](COIN_SUPPORT_MATRIX.md) for the tracked implementation
and acceptance status.

The JSON above illustrates the runtime-ready case. Without the unlocked account,
authenticated Core, or positive route probe, the same projection returns
`send: false` and `sendMode: "NONE"`.

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

These actions require an unlocked account. The three balance/info/history reads
also require a trusted local or authenticated custom Qortium Core; the receive
address does not.
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
[Home 2 public QDN publishing](QDN_PUBLIC_PUBLISHING.md), including `kind:
'directory'` support on desktop for the Qortium global. The following broader
inline-payload and preview surface remains specific to the retained
compatibility bridge; Home 2 does not advertise those legacy variants. Folder
sources do not extend to Qortal: a `kind: 'directory'` request on
`qortalRequest` is REFUSED by name rather than quietly downgraded to a file
picker, because a token no Qortal path can redeem is worse than an error.

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
only the opaque `sourceToken`.

> **Home 2: `qdnRequest`, desktop and Android, on any admin-trusted node.**
> Home 2 implements this as an app-tab preview (2026-08-30); the picker accepts
> `kind: 'directory'` again (2026-09-02), so a folder holding an `index.html`
> previews as a `WEBSITE` on desktop. Since 2026-09-02 it uploads the CONTENT
> to Core's `POST /arbitrary/preview/{service}/upload` rather than handing over
> a local path, so it works on **any node the user is admin-trusted on** — the
> managed local Core, or their own remote Core with its API key attached (HTTPS
> or an SSH tunnel) — and it works on **Android**, where the selection is
> already bytes. It is still NOT advertised on `qortalRequest`: Home 2 holds no
> administrative key for the Qortal route. It is also not advertised on an
> untrusted route (a public node is somebody else's Core), so `SHOW_ACTIONS`
> only offers it where it can work. `SELECT_QDN_PUBLISH_SOURCE`,
> `STAGE_QDN_PUBLISH_SOURCE` and `PUBLISH_QDN_RESOURCE` are unaffected and stay
> on both globals. A folder source can also be PUBLISHED as of 2026-09-02, on
> Qortium desktop only - see [Home 2 public QDN
> publishing](QDN_PUBLIC_PUBLISHING.md) § Folder sources.
> See [Home 2 bridge compatibility](HOME_V2_BRIDGE_COMPATIBILITY.md) §
> Remote trusted nodes.

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
token. Preview requires Home and a node the user administers; standalone-browser
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

### Home 2 behavior

The Home 2 bridge keeps every constraint above and tightens two things.

**Forbidden fields are refused, not ignored.** A request carrying `amount`,
`assetId`, `recipientPublicKey`, `chatReference`, `txGroupId`, `groupId`,
`isEncrypted: true`, `isText: false`, or a non-zero `fee` fails with an error
naming the problem. Home 1.x silently dropped them and returned success, which
means an app could reasonably believe it had attached a payment that the
serializer had in fact written as zero. A hard error is the only answer that
cannot be misread.

**It is `qdnRequest`-only.** The serializer mirrors Qortium Core's
`MessageTransactionTransformer` — including the fact that Qortium's
`BaseTransactionData` does not chain a last-reference field. Qortal's MESSAGE
layout differs, so advertising this on `qortalRequest` would mean offering to
sign bytes that the other chain reads differently. This is the same asymmetric
catalogue pattern as `SEARCH_GROUPS`, for a stronger reason: there the endpoint
is merely absent, here the wire format actually differs. The chain is asserted
again inside the handler, so the guarantee does not rest on a catalogue entry
staying correct.

The approval is single-request, pinned on the action itself rather than only on
the prompt payload, so no future change to how the prompt is assembled can let
one approval cover a second signed message. The prompt shows the AT address and
the **entire** message text — never truncated, because what the user approves
must be exactly what is signed — in a bounded scrollable panel with the message
size in bytes beside it, and offers no session or durable scope. Sends are
rate-limited alongside the chat sends, and the app/tab/account/route context is
rechecked after the proof-of-work and before signing.

**Forbidden fields are refused in both request shapes.** An app may send its
fields at the top level or inside a `payload` object, and Home reads the
recipient and message payload-first; so the forbidden-field, flag, and fee
checks all look in both places. A payment, encryption request, transaction
group, or non-zero fee hidden inside `payload` is refused exactly as it is at
the top level — it cannot slip through to be silently dropped. A field present
in both places with two different values is refused as ambiguous, and a flag
whose value is not a real boolean (for example `isEncrypted: "true"`) is
refused rather than coerced.

When the broadcast outcome is unknown — signed, possibly landed — the result is
the same non-retryable unknown-outcome shape the chat sends use, and it is
journaled so the user can reconcile rather than blind-retry. The journal target
is coarse (`{ kind: 'operation' }`): one unreconciled `SEND_MESSAGE` blocks the
next one for that app and account regardless of which AT it addressed. That is
deliberate — the shipped caller is a once-per-account faucet claim, where a
duplicate is exactly what reconciliation exists to prevent.

**It works on Android too.** Core has no build endpoint for MESSAGE, so unlike
the poll and name families there are never node-provided bytes to cross-check —
the local transformer is the only thing between the request and the signature.
That gap is now closed at EVERY site that builds a MESSAGE — the desktop
bridge, the Android vault, and the legacy v1 app path — by an independent
field-by-field verifier applied to the unstamped bytes and again to the
nonce-stamped ones, so nothing is signed that was not itself read back and
confirmed: the type, the
zero transaction group, the sender key, the exact nonce, the recipient, the
ZERO amount, the message bytes, the plaintext and text flags, and the zero fee.
A MESSAGE that carried a payment, or arrived encrypted, is not the transaction
the prompt described. The Android prompt shows the COMPLETE message text in a
bounded scrollable row with its byte count, never a preview — the contract may
act on the text, so the user has to be able to read all of it. A direct call
that reaches the node client is refused for bypassing the prompt.

`UNLOCK_SELECTED_ACCOUNT` is a Home-account
operation with no chain semantics and IS available on Android, on both
`qdnRequest` and `qortalRequest`, which is what the legacy wallet needs.

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

Both READS are implemented in the Home 2 bridge as well, on both globals, with
the same request fields and response shapes. Two Home 2 clarifications:

- A 404 on either half is a normal answer meaning "not rated yet" — it becomes
  `null` for a summary or a resource rating, and `[]` for the account-rating
  list — rather than failing the call. Core's three ways of saying empty
  (`null`, `[]`, `{}`) all collapse to `null` in `summary`.
- The `rater` default is withheld in a chromeless widget. The response echoes
  `rater` back, so defaulting it there would disclose the selected account's
  address with no chrome to announce it; a widget must pass `rater` explicitly.

### Rating writes (Home 2)

`RATE_ACCOUNT` and `RATE_RESOURCE` are restored on `qdnRequest` only (the
rating system is a Qortium Core addition), on desktop and Android, as fee-free signed
transactions built ON DEVICE with the local transformer pattern — the 1.x
path not only used API-keyed node builders, it sent the account's PRIVATE
KEY to the node's `/transactions/sign`; in Home 2 the key never leaves the
process, the unsigned and nonce-stamped bytes are both verified by an
independent field-by-field reader, and only signed bytes reach the node.

**`RATE_ACCOUNT`** takes an exact 32-byte `targetPublicKey`, a `category`
(one of Core's `SUBJECT`, `PLAYER`, `TRAINER`, `MANAGER`, case-insensitive),
and a `rating` from `-4` to `4` where `0` REMOVES the active rating — a
distinct operation with its own prompt caption, never a neutral score. The
prompt leads with **who is being rated**: the address Home derives locally
from the exact key that will be signed (an app label or a lying node can
never substitute a different identity), the key itself, the canonical
category, the current rating when one exists, and the change. One
`/account-ratings/cooldown` read pre-checks three things — the target
account exists with that stored key, the rater's active rating on the exact
edge, and the category cooldown; an active cooldown refuses BEFORE the
prompt, and the edge is re-read after approval. Self-rating is refused
locally. A no-op (same rating, or removing when none exists) answers
`changed: false` without signing — Core would refuse it as unchanged.

**`RATE_RESOURCE`** takes a public rateable service (Core's internal
`AUTO_UPDATE`, `AUTO_UPDATE_BINARY`, and `ARBITRARY_DATA` are refused), a
3-40 byte `name`, an optional identifier (`''`/`'default'` canonicalize to
the null wire form Core signs), and a `rating` from `1` to `10` with `0`
removing. The signed service id comes from Home's STATIC service map — 1.x
let the node's own catalogue pick the signed id — and the prompt shows the
exact numeric Service ID being signed, so a stale map has nowhere to hide.
The resource must exist and be rateable: the public rating-summary read is
the probe (Core answers 400 for a missing, non-rateable, or non-normalized
coordinate — Core's own Unicode-normalization rule, authoritative over
Home's local subset check), re-run after approval. A DELETED coordinate is
NOT refused: Core's own target resolution accepts the latest transaction
regardless of method, so rating one is Core-valid and Home mirrors Core. The
current rating is disclosed and re-read, and no-ops answer `changed: false`.

The Current/cooldown/no-op state on both prompts is **node-reported
preflight**, not byte-verified fact: a lying node can misstate the current
rating, answer a false `changed: false`, claim a cooldown that suppresses a
legitimate rating, or wave through a doomed one Core then rejects. None of
that can alter what is signed — the target, category, coordinate, rating,
zero fee, and zero group are all byte-bound and independently verified —
so the residual is a wrong advisory row or a wasted/blocked attempt, and
Core's consensus rules stay authoritative.

`fee` and `txGroupId`, when present, must be 0: rating transactions are
never group-approved, and Home pays with on-device MemoryPoW (difficulty
from the node's public capabilities). `RATE_ACCOUNT` offers single-request or
session consent through the never-durable `rating.write` capability. Session
consent covers rating, updating and removing account ratings across every target
and role for the same app tab, selected account, Qortium chain and node route.
It survives internal app navigation, but ends on lock, account/node change,
app replacement, tab close or Home restart. Concurrent unapproved requests never
share an Allow once decision. Each request still validates its current edge,
cooldown, exact signed payload and live signing context. `RATE_RESOURCE` stays
single-request only. Unknown broadcast outcomes
journal — RATE_ACCOUNT under its exact target-key + category edge,
RATE_RESOURCE under its resource coordinate — and block the same logical
target until reconciled. Results keep the 1.x fields minus Core's `result`
blob, plus `network`.

### Account avatar (Home 2)

`SET_ACCOUNT_AVATAR` is restored on `qdnRequest` only, desktop only, as the
fee-free type-50 transaction built ON DEVICE — the SET_GROUP_AVATAR wire
body without the group id. Like the group variant it signs **only a QDN
pointer** `{service, name, identifier}` (or clears it with `avatar: null`,
a distinctly-captioned operation): avatar bytes travel through
`PUBLISH_QDN_RESOURCE` with its own prompt, Core's pointer rule is owner-
and existence-agnostic, and the raster/500 KiB bounds are enforced when the
avatar is SERVED. The prompt shows the current pointer (from the
`/addresses/{address}/avatar/info` read) and the new one; the current
pointer is re-read after approval so a pointer that moved underneath the
approval refuses; a no-op answers `changed: false`. `fee`/`txGroupId` must
be 0; single-request `account.avatar.write` capability, never durable; one
unreconciled avatar write blocks the next (coarse per-account journal key).
The pointer's service must be one of Core's PUBLIC SINGLE-FILE services
(the shared avatar allowlist, also enforced for `SET_GROUP_AVATAR`) — a
multi-file or private service would sign a transaction Core
deterministically rejects. The displayed coordinate uses an injective
component encoding: a `/` inside a name or identifier is shown as its
escape, so the line parses back to exactly one component triple — and the
literal identifier `default` is canonicalized to the empty (default) form
before signing, since Core serves both as one avatar.
Avatar transactions are consensus-gated by the `avatarTransactionsHeight`
feature trigger — active on Previewnet, not yet configured on mainnet.
Like every broadcast failure in the signed families, a post-signing Core
rejection (including `NOT_YET_RELEASED`) is conservatively journaled as an
unknown outcome rather than trusted as a definitive refusal from a
possibly-lying node.

### Payments (Home 2)

The payment family carries every guarantee the other signed families earned,
plus the payment-specific ones below. **It works on desktop and on Android**,
and it crossed to Android LAST on purpose: every other action is a signature a
user can reason about afterwards, and this one moves funds. On Android the
approved amount, asset, recipient, fee and timestamp all travel with the
request, and the vault refuses if its own re-derivation of any of them
disagrees — the disclosure is the thing being signed, not a description of it.


- **`PAYMENT` and native `SEND_COIN` are one canonical operation** — a
  locally-built Qortium PAYMENT (type 2, the native asset). A nonzero
  `assetId` routes to `TRANSFER_ASSET`; a foreign `coin`/`blockchain`
  selector or any 1.x foreign-arm field (`sendMax`, `feePerByte`,
  `receivingAddress`) refuses loudly with `FOREIGN_SEND_UNAVAILABLE` —
  Home must never let an app believe it sent BTC while native funds moved.
- **`TRANSFER_ASSET`** (type 12, Qortium) pre-reads and re-reads the asset
  (existence, canonical name for display, divisibility — whole units
  enforced for indivisible assets — and unspendability, refused toward AT
  recipients). The numeric asset id is signed and shown.
- **`SEND_QORT`** is the Qortal compatibility action on `qortalRequest`,
  using the repo's existing Qortal PAYMENT serializer (64-byte last
  reference, fetched fresh at signing). A name recipient is resolved once,
  shown with its resolved address, and re-resolved after approval; drift
  refuses.
- **Money fields have no precedence rules**: a financially relevant field
  appearing twice (payload and top level, or two aliases) with different
  values refuses outright. Amounts are exact atomic bigints (canonical
  decimal AND atomic units both shown); over-precision refuses; zero and
  negative refuse.
- **Fees are Home-quoted and pinned**: these types have NO MemoryPoW
  alternative, so Home reads the chain unit fee FOR THE EXACT timestamp the
  transaction will carry, shows it and the checked total debit, re-quotes
  after approval, and refuses a fee that moved. An approval that sat open
  more than ten minutes refuses rather than signing a stale timestamp.
  App `fee`/`txGroupId` values must be 0 (a 1.x pass-through, removed).
  One bounded residual: the quote reads the chain's timestamp fee
  SCHEDULE, while consensus applies the parameter effective at the next
  block height — a unit-fee governance activation landing between the
  re-quote and inclusion can make the signed fee insufficient, in which
  case the payment is rejected or journals as an unknown outcome; it can
  never sign a HIGHER fee than the user saw.
- **Recipients are validated 25-byte checksummed addresses** (account or AT
  version — AT destinations are labeled as contract addresses; a
  self-payment gets its own disclosure row).
- **One in-flight payment per account and chain** (process-level send
  lock), single-request `payment.send` capability that no session or
  durable grant can ever cover, and unknown-outcome journaling under the
  exact spend intent `{recipient, assetId, atomic amount}` — the aliases
  share one conflict key, and a journal-write failure FAILS CLOSED,
  blocking further payments for the account instead of allowing a retry
  the journal can no longer prevent. Balance checks are node-reported
  preflight; Core consensus stays authoritative. Deliberately, EVERY
  post-signing failure — an HTTP-level rejection included — journals as
  an unknown outcome: no answer from an untrusted node can prove the
  bytes were never relayed, and a "rejected" verdict that invites an
  immediate retry is exactly the double spend the journal exists to
  prevent. A name-mode SEND_QORT with an unknown outcome blocks EVERY
  later SEND_QORT for that app and account until reconciled — the signed
  intent was the resolved address, which a request-side key cannot prove.

On today's Qortium Previewnet — which deliberately has no native asset
yet — the Qortium arms refuse at the balance/asset pre-checks with named
errors; the implementation is ready for the chain's coin decision.

## Node administration trust (Home 2)

Some families do not act on the chain — they administer a **node**: the QDN
list family (node-local blocking/following state), the minting family
(the node's minting-accounts list), and the node-settings family (Core
settings and restart). Those need
the node's administrative API key, so Home has to decide which nodes it may
administer.

The rule is ownership, not locality: a node is administrable when it is the
Core Home runs itself (loopback, key reconciled from that Core), **or** a
custom node the user has attached their own API key to. Today that unlocks
the list, minting, and node-settings families in the app bridge on desktop
and Android alike (Android always through the attached-key case, since it
has no managed local Core); Home's own Android Settings screens for lists
and minting are still to be built. That second case is
the self-hosted one — including a node reached through an `ssh -L` tunnel,
which presents as plain HTTP to `127.0.0.1` and is explicitly allowed. Public
and discovered nodes are refused: administering someone else's Core is not
the user's to do, and no key of theirs belongs on it. Qortal is refused
because Home has no administrative concept for it.

The attached key is bound to the **exact node origin** it was attached to; a
changed address discards it rather than re-pointing a credential at a host
the user never approved. It is stored in the operating system's secure store
(Android Keystore; Electron `safeStorage` on desktop) rather than in the
plaintext node settings: every desktop writer funnels through one storage
boundary that relocates a newly-entered custom-node key into the protected
store. It is sent only to the origin it was attached to, over HTTPS or
loopback HTTP, with redirects refused, and it never crosses into the
renderer, a QDN app, or any other host. Every trust answer carries an
origin+key revision, so an approval granted for one node cannot be spent
against another.

Three honest limits. The attach flow refuses outright when a device has no
protected storage — but a key submitted through the *legacy* settings path
in that state is left where it was rather than destroyed, since losing a
credential the user may be unable to re-derive is the worse failure;
administration stays refused either way, because trust is resolved only from
the protected store. A key the legacy UI merely resubmits unchanged is never
treated as an attachment (it is dropped instead), so neither a mode switch
nor an address change can bind an existing credential to a node it was not
attached to. And the Home 1.x Android host keeps its own separate
custom-node key in Capacitor Preferences; that legacy surface is untouched
by this change and tracked separately.

Two honest notes. First, an API key is a **full administrative credential**
for that Core, not a Home-scoped token — Core treats any valid key as admin
(and by default lets it bypass its public-API path restrictions), so the
attach dialog says so and recommends a node you operate with a key you do not
reuse. Second, this rule replaced a stricter loopback-only one that existed
because minting used to post the account's private key to the node to derive
a reward-share key; Home now derives that key locally (verified against
Core's own implementation), so no account key travels to any node and the
remaining exposure is the user's own credential for their own node.

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

The node must be **administered** — Home's own managed Core, or a custom node
the user attached their own API key to (see *Node administration trust*
above). Home's managed Core must additionally resolve to a loopback host
(`127.0.0.0/8`, `localhost`, or `::1`), since that is the only place it ever
runs; an attached custom node must be reached over HTTPS or loopback HTTP.
Any other route is refused before a single admin call is made, and the
refusal names the fix.

**No account private key travels to the node.** (The derived reward-share
key still does, when registering minting — that is what registering means —
but it is scoped to reward-sharing, not to the account.) That key is derived
locally — SHA-256 of the X25519 shared secret, the exact
construction Core uses, pinned in tests to a vector generated from Core's own
implementation — so the old `/addresses/rewardsharekey` and `/utils/publickey`
handoffs are gone. That is what makes administering a remote node you own a
credential decision rather than a key-disclosure one.

Errors from the calls that carry key material — `/addresses/rewardshare` and
the `/admin/mintingaccounts` POST and DELETE — are reduced to the operation
name and HTTP status. Core echoes request context into its error bodies, so no
body from these calls reaches the app, and none is written to a log either.

None of the four actions is offered to a chromeless widget. The two reads would
otherwise pass the widget `GET_`/`LIST_` prefix rule, but they describe the
user's own node and `GET_MINTING_STATUS` defaults to the selected account's
address, and a widget has no prompt surface to disclose that through.

## List actions (Home 2)

Home 2 exposes the node-local list family on `qdnRequest` only:
`GET_ALL_LISTS`, `GET_LIST`, `ADD_TO_LIST`, and `REMOVE_FROM_LIST`. The pinned
Qortal v3 list actions (`GET_LIST_ITEMS`, `ADD_LIST_ITEMS`, `DELETE_LIST_ITEM`)
stay deferred: every Core `/lists` route requires the node's administrative API
key, and Home holds one only for the Qortium Core it runs itself.

Lists live on the user's own node — Core stores each non-empty list as
`lists/<name>.json` on the node's disk — and every call in the family, reads
included, is made with the `X-API-KEY` header against an **administered
node**, the same rule the minting family uses (see *Node administration
trust* below): Home's own managed Core, or a custom node the user attached
their own API key to. On any other route the family answers the coded
`NODE_CAPABILITY_MISSING` error rather than a pretend-empty list, and the
message names the fix (attach the key, use HTTPS or a tunnel) rather than a
locality rule. Home 1.x drew a narrower line
(`assertLocalWriteConnection`), so on a real phone these actions never worked
there either. **The family now works on Android too.** It is advertised there and
implemented against the same administered node: reads are permissionless and
served directly, and a write raises the same single-request approval — with
the node's origin named on it — before the client performs it. The API key
never reaches the React layer on Android any more than it leaves the main
process on desktop: the portable client resolves trust, holds the key, and
re-checks that neither the node nor the key moved while the prompt was open.
A write that somehow reaches the client without an approval is refused.

`GET_ALL_LISTS` takes no parameters and answers Core's sorted array of list
names. `GET_LIST` takes `listName` and answers the array of items in stored
order; a 404 answers as `[]` (current Core answers `[]` itself for a missing
list — the mapping guards older Cores). Both reads are permissionless, capped
at the same 2 MiB response bound as 1.x, and neither is offered to a chromeless
widget: which names the user blocks and follows is a behavioral profile of the
person, and both action names would otherwise pass the widget `GET_` prefix
rule. Like every other permissionless read, they remain callable from any open
app tab whether or not it is the foreground one — backgrounding a tab does not
revoke what opening the app granted; only the widget surface is excluded.

Every list call refuses HTTP redirects outright. The trusted-node gate proves
the URL is loopback, but a redirect would let the responder pick a second URL
the gate never saw — and unlike `Authorization`, the `X-API-KEY` header
survives a cross-origin fetch redirect, with 307/308 re-sending the method and
body too. Refusing them keeps the administrative key pinned to the host the
gate approved.

`ADD_TO_LIST` and `REMOVE_FROM_LIST` take `listName` and `items`, require a
selected account — a deliberate divergence from 1.x, where these were
account-free writes: every Home 2 write prompt is anchored to the account
context it was approved in, and lists do not get a parallel accountless prompt
path just to preserve that quirk — and always prompt — single-request only, one approval per batch, never a session or
"always allow" grant, under the never-durable `node.lists.write` capability.
The prompt shows the list name, the node, and the complete serialized item
batch in a bounded scrolling block; a batch whose serialization exceeds 4,000
characters is refused before any prompt is raised (the 1.x rule: an approval
the user cannot read in full is not an approval). The displayed batch is the
serialization escaped to printable ASCII (`\uXXXX` for everything past DEL),
so a bidi override or invisible separator in an item can never make the prompt
read differently from what Core receives; the raw strings still go to the node
untouched. The node route is re-resolved
after approval and the write is refused if it changed mid-prompt. The result is
Core's own `text/plain` body — the string `"true"` or `"false"`, exactly as 1.x
returned it. `"false"` means Core declined to apply the batch and is returned,
not thrown; apps that check the value keep working unchanged.

Request shapes are 1.x parity: `listName` starts with a letter, continues with
letters, digits or underscores, and caps at 120 characters (applied to reads
too — 1.x checked it only on writes); `items` is a non-empty array of
non-empty strings, each trimmed. One deliberate divergence: 1.x silently
dropped blank and non-string entries and applied the survivors, reporting
success for a half-applied batch. Home 2 refuses the whole request instead.

## Node settings actions (Home 2)

Home 2 exposes three node-settings actions on `qdnRequest` only:
`GET_NODE_SETTINGS_METADATA`, `UPDATE_NODE_SETTINGS`, and `RESTART_NODE`.
Qortium Home is the only host with a node-settings concept, and the
administration trust rule refuses Qortal outright, so a `qortalRequest` copy
could never be answered honestly. The family exists so the Node app can
render and edit Core's settings while the raw admin write routes stay
outside `normalizeHomeV2ReadPath`'s scope: `/admin/restart` and the
key-gated `/admin/settings/{setting}` remain refused to the generic
passthrough, pinned by tests.

`GET_NODE_SETTINGS_METADATA` is a plain promptless read of
`/admin/settings/metadata` — the same anonymous Core route the passthrough
already allows — answered wherever ordinary reads are.

The two writes follow the node administration trust rule above
(`resolveHomeV2AdminNode`): Home's own managed Core, or a custom node the
user attached their API key to — on desktop and Android alike.
`SHOW_ACTIONS` advertises them only for an admin-trusted, reachable Qortium
route, so the Node app's editor hides itself on a public node exactly as it
did on 1.x.

Every write prompts on every request (`node.settings.write`, never durable,
never session-cached). An `UPDATE_NODE_SETTINGS` request is validated before
any prompt is raised: the patch shapes 1.x accepted (`patch`, `settings`, or
a record `payload`), at most 64 settings per request, key names at most 120
characters, every key checked against the node's own writable declaration,
and every displayed value at most 1,000 escaped characters — a batch too
large to show in full is refused rather than approved unseen. The approval
names the node and every setting with its current and proposed value; string
values render quoted so Home's own annotations ("(not present)", "(empty)")
cannot be forged by app-supplied values. After approval, trust is
re-resolved and the write refuses a node or credential that changed while
the prompt was open; then one keyed `PATCH /admin/settings` runs with
redirects refused, and a failed keyed call answers a fixed operation/status
message rather than the node's error body (which a hostile responder could
stuff with received headers). The result is rebuilt from an allowlist (`saved`,
`updated`, `removed`, `applied`, `restartRequired`); Core's `settingsPath` —
the node's settings file location on disk — is deliberately dropped, because
an app asked to change a setting, not to learn the node's filesystem layout.

`RESTART_NODE` prompts with the pinned Impact row ("Restart the selected
Core node"), re-resolves trust the same way, then issues one keyed
`GET /admin/restart`. The restart is fire-and-forget, exactly like every
existing caller of that route: Core relaunches its own JVM, and
core-manager's process-scan fallback already tolerates the pid change.

## Poll actions (Home 2)

Home 2 exposes the poll write family on `qdnRequest` only: `CREATE_POLL`,
`VOTE_ON_POLL`, and `UPDATE_POLL`. Each signs exactly one fee-free Qortium
chain transaction through Core's keyless `/polls/public/*` builders, following
the group-membership pattern: validate locally, prompt single-request under the
never-durable `poll.write` capability, build, byte-assert the unsigned
transaction against everything the user approved
(`assertPublicCreatePollTransaction` and friends), MemoryPoW on this device,
Ed25519-sign locally, broadcast. A broadcast whose outcome is unclear is
retained in the pending-transaction journal (`VOTE_ON_POLL`/`UPDATE_POLL`
against their stable `{kind:'poll', pollId}` target; `CREATE_POLL`, which has
no id before it confirms, against the coarse operation target) and blocks a
duplicate until reconciled.

Poll votes are by **`pollId` only** and option indexes are **one-based**: `0`,
`[0]`, or `[]` means "remove my vote" and cannot be combined with real
selections. Multi-option selections are sorted into Core's canonical ascending
order before building. Changing an existing vote is allowed; repeating the
exact current selection (or removing a vote that does not exist) fails with
Core's `ALREADY_VOTED_FOR_THAT_OPTION`, exactly as in 1.x — Home deliberately
does not map that to an idempotent success.

Where 1.x prompts showed only an action and a name, these show the operation.
A vote prompt fetches the poll and names it plus the selected option labels
**as the configured node reports them** (an out-of-range index is refused
before any prompt — never "option 3 of 2"), and the poll is re-read after
approval: if its name or option list changed while the prompt was open, the
approved indexes no longer name the approved labels and the action is refused.
Two residuals are inherent and documented rather than solved: the labels come
from the configured node, so a compromised node can misdescribe a poll — the
signed transaction binds only the poll id and indexes, which is also why the
lookup at least refuses an answer claiming a different poll id; and after the
final re-read the chain can still order an owner's UPDATE ahead of the vote,
re-labelling what the indexes mean — a protocol-level window that closes
permanently once a poll has its first vote, because Core then freezes its
options. Create and update prompts show the complete replacement metadata
with every field explicit — an update that omits the description or a time
CLEARS the stored one, and its prompt says "(none — clears …)" as a row
rather than hiding the destruction by omission. User-derived text is escaped
to printable ASCII (backslashes doubled first, so the escape is injective and
a literal "\u202e" can never render like a real bidi override; C0 controls
become visible escapes too, so a legitimate multiline description still
prompts), and anything too large to display in full (4,000 characters) is
refused rather than approved unseen.

Request shapes are 1.x parity, including the aliases (`poll`/`pollId`,
`option`/`optionIndex`, `options`/`pollOptions`, the `new*` update fields and
their fallbacks), tightened to Core's real limits so a doomed request fails
here with a named reason: names 3–400 UTF-8 bytes in Unicode normalized form,
descriptions at most 4,000 bytes, 2–1000 options of 1–400 bytes each,
case-sensitively unique. The name rule approximates Core's
`Unicode.normalize` (NFKC, no invisible or control characters, collapsed
whitespace); Core remains the authority, so an exotic name that passes Home
can still answer `NAME_NOT_NORMALIZED` from the builder. Poll times must be
in the future, and poll ids are positive 32-bit integers. Three deliberate v2
divergences: `fee` and
`txGroupId`, when present, must be `0` (the fee-less MemoryPoW path is the
only signing path Home 2 carries, and a fee the app believed it was paying
must never be silently zeroed); `pollId` must be at least 1 (1.x accepted 0
and let Core reject it); and requests are read from top-level fields only, the
established Home 2 convention.

The family requires a selected, unlocked account, and works against any
reachable Qortium route that exposes the public poll builders — a node without
them answers `NODE_CAPABILITY_MISSING`. **The family works on Android too.**
The builders are Core's keyless `/polls/public/*` routes and the signature is
Ed25519 over bytes the device verified itself, so nothing about the sequence
needed a desktop: the Android vault runs the same build → byte-assert →
MemoryPoW → re-check context and live state → stamp → sign → broadcast chain
that desktop runs, and the account key stays inside it exactly as it stays in
the main process on desktop. (Stamping writes the nonce into a fixed offset of
bytes already verified field by field, so neither platform re-asserts after
it; the families built by LOCAL transformers, which have no Core builder to
check, do re-verify the stamped bytes.) What is
NOT platform-independent is the disclosure, so the Android prompt is held to
the same per-action row sequence the desktop prompt is validated against. The
state the prompt was shown against travels WITH the request into the vault and
is the baseline every later check compares to — the vault reads the chain again
before it signs, and a vault that could only compare its own two reads would
agree with anything that moved while the prompt was open. A direct call that
a direct call that reaches the node client without an approval is refused for
bypassing the prompt rather than for being on a phone; the pinned Qortal
v3 poll forms stay deferred, because Hub's contract is a genuinely different
legacy transaction (pollName target, zero-based index, paid fee and a last
reference, no builder) and mechanically translating it into the Qortium
transaction would be wrong. Poll READS were never first-class actions in 1.x
and remain reachable through `FETCH_NODE_API` `/polls/...` exactly as before.

## Name actions (Home 2)

Home 2 exposes the name write family on `qdnRequest` only: `REGISTER_NAME`,
`UPDATE_NAME`, `SELL_NAME`, `CANCEL_SELL_NAME`, and `BUY_NAME`. Each signs
exactly one fee-free Qortium transaction through Core's keyless
`/names/public/*` builders (Core PR #269) on the poll-family pattern:
validate locally, prompt single-request under the never-durable `name.write`
capability, build, byte-assert the unsigned transaction against everything
approved (five new verifiers, transaction types 3–7), MemoryPoW on-device,
Ed25519-sign locally, broadcast. Ambiguous broadcasts journal against the
coarse per-action operation target — deliberately, because an exact-name key
would be unsafe: updates carry two spellings and collisions use REDUCED
names — and block a duplicate until reconciled.

**`BUY_NAME` is a payment.** A zero transaction fee does not mean zero
financial effect: approving a buy transfers the sale amount from the
selected account to the seller. Its prompt is payment-grade — the exact
eight-decimal amount, who is paid, and any buyer restriction — and every
value is resolved from the LIVE sale state: an app-supplied `seller` or
`amount` must match the chain exactly or the request is refused, missing
ones default to the live owner and price, a restricted sale is refused
unless the selected account is the allowed buyer, and the sale state is
re-read after approval so a mid-prompt change refuses the sign. `SELL_NAME`'s
optional `recipient` is an **allowed buyer**, not a payee — the prompt says
"Restricted — only Q… may buy" and states that proceeds always go to the
owner.

Amounts are Qortium's eight-decimal fixed point, parsed once into an exact
atomic bigint plus a canonical decimal string; floating point never touches
an amount after parsing, the builder receives the decimal string, and the
byte-assert compares the atomic value. `UPDATE_NAME` keeps the 1.x wire
semantics — an empty `newName` keeps the current name, an empty `newData`
keeps the existing data (there is no transaction-level way to clear it), and
an absent `primary` preserves the current primary status — and unlike 1.x
the prompt shows every one of those rows explicitly, "(unchanged)" included.

`GET /names/{name}` resolves by REDUCED name while the transactions demand
the exact stored display name, so the lookup's answer must match the
requested spelling exactly; a homoglyph- or case-equivalent request is
refused with the stored spelling named rather than silently substituted.
Home enforces byte limits locally (new names 3–40 UTF-8 bytes, data at most
4,000) and leaves Core's Unicode normalization authoritative — an exotic
name can still answer `NAME_NOT_NORMALIZED` from the builder.

1.x aliases and payload nesting are preserved (`nameData`/`data`,
`recipientAddress`, `isPrimary`, `payload[field] ?? request[field]`
precedence, `poll`-style fee/group fields pinned to 0). Chain-derived
addresses shown on a payment prompt are shape-validated before display, and
name data is trimmed so a blank-looking value reads as unchanged. One valid
name class is unsupported by design: a name created in a non-zero
transaction group cannot be updated, because Home pins UPDATE to group 0 and
`NameData` does not expose the original creation group. A public sale must
have a price above zero and below the maximum; a restricted sale may be
zero. The family requires
a selected, unlocked account and a route exposing the public name builders
(`NODE_CAPABILITY_MISSING` otherwise, probed via
`/names/public/capabilities`). **The family works on Android too**, on the
same in-vault signing path as the poll family, prompt rows included —
`BUY_NAME` among them. That one PAYS, which is precisely why it is not
withheld: a purchase the user can make on their desktop but not on their
phone is a platform that half works, not a safer one. The payment-grade
disclosure and the exact-match rule on app-supplied values apply identically on
Android, and the price and seller that get SIGNED are the ones carried over
from the approval — not values re-read after the user has already tapped
Approve, which is how a sale re-listed while the prompt was open would
otherwise be paid at the new price; a direct `qdnRequest` call reaching the node client is refused for
bypassing the prompt, and `qortalRequest` still answers `UNSUPPORTED_PROTOCOL`.
The pinned Qortal v3 name forms stay deferred.

## Group mutation actions (Home 2)

Home 2 exposes the group mutation family on `qdnRequest` only: `CREATE_GROUP`,
`UPDATE_GROUP`, `GROUP_APPROVAL`, `SET_GROUP`, and `SET_GROUP_AVATAR`. Each
signs exactly one fee-free Qortium transaction built **locally** on the
group-admin transformer pattern (no Core builder is involved): normalize,
read live state, prompt single-request under the never-durable
`group.mutation` capability, build the zero-nonce bytes, byte-verify,
MemoryPoW, verify the stamped bytes, sign locally, broadcast. Ambiguous
broadcasts journal (`UPDATE_GROUP`/`SET_GROUP_AVATAR` against their group;
`GROUP_APPROVAL` against the specific pending transaction it votes on;
`CREATE_GROUP` and `SET_GROUP` against the coarse per-action target) and
block duplicates until reconciled.

**`GROUP_APPROVAL` votes on one specific pending transaction.** Where the
1.x prompt showed only "approve or oppose", Home 2 resolves the referenced
transaction first and the prompt discloses it: signature, transaction type,
creator, the approval group, and its current PENDING status — an unknown
signature, a non-pending transaction, or an app-supplied `groupId` that
does not match the transaction's real group refuses before any prompt. The
prompt also states that an opposition vote does not immediately reject the
pending transaction (it stays pending until approved by others or it
expires), and the transaction is re-read after approval with every
transaction-sourced field (signature, type, creator, approval group, status)
compared between the two reads — the group *name* row comes from a separate
group lookup and is display context only. The type/creator/status rows are
**node-reported context, not byte-verified fact**: what is signed binds only
the pending transaction's signature (which the app supplied and the user
sees), so a node lying consistently across both reads can mislabel the
description of that transaction but can never change which transaction the
vote applies to. A creator value that is not address-shaped is dropped from
the prompt rather than painted.

`UPDATE_GROUP` merges omitted fields with the live group so the prompt and
the signed bytes always carry the **complete replacement** (with
"(unchanged)" annotations), and a request that changes nothing answers
`changed: false` without signing. There is **no ownership transfer** —
Qortium's type 23 has no owner field; Qortal Hub's `newOwner` contract is a
different transaction and is not carried. `SET_GROUP` requires a positive
existing group (1.x accepted 0; Core has no group 0), pre-checks membership,
and answers `changed: false` when the default is already set.
`SET_GROUP_AVATAR` signs **only a QDN pointer** `{service, name,
identifier}` — avatar bytes travel through the separate
`PUBLISH_QDN_RESOURCE` flow with its own prompt and its own signature — and
answers `changed: false` when the pointer already matches; Core enforces the
raster/500 KiB rules when the avatar is served, not in this transaction.

Group names are 3–32 UTF-8 bytes in Core's normalized form (approximated
locally, Core authoritative), descriptions are required at 1–128 bytes
(1.x defaulted to empty and let Core reject), thresholds are the seven enum
names, and delays are validated locally (`max ≥ 1`, `max ≥ min`). 1.x
aliases and payload nesting are preserved with one exception: 1.x accepted
`txGroupId` as a fallback TARGET group id for updates and avatars, which
conflated the target with the approval-group field — Home 2 takes the
target from `groupId` only. `fee` and `txGroupId`, when present, must be 0 —
and two valid group classes are unsupported by design: a group **created
inside a transaction group** cannot be updated or have its avatar changed
through Home, because its update must carry the original creation group and
Core keeps `creationGroupId` unexposed (`@XmlTransient`), so such an attempt
surfaces Core's rejection through the unknown-outcome path; and null-owned
governance groups are refused by the owner-equality check (Core's
usable-admin governance path for them is deliberately out of this slice).
One residual is inherent to live-state merging and therefore DISPLAYED
rather than solved: the current values an update inherits come from the
configured node, so a lying node can steer what the omitted fields resolve
to — but every resolved value is shown on the prompt and byte-bound into
what is signed, so nothing is ever signed that the user did not see.
**The family works on Android too.** Like the group ADMIN family already on
Android (types 24-30), these are built by a LOCAL transformer with no Core
builder to cross-check, so the Android vault verifies the transformer's bytes
AND the nonce-stamped bytes before signing — no byte reaches a signature
unverified. `sendAndroidHomeV2QortiumGroupAdmin` in `src/platform.ts` is the
closest existing implementation to diff this arm against.
The live group state the prompt was held to travels with the request and is the
baseline for every later check — for `UPDATE_GROUP` it is also the SOURCE of
the merged values, since omitted fields are filled from it, and merging from a
post-approval read could rewrite settings the prompt reported as unchanged. `GROUP_APPROVAL` additionally refuses when the selected account is not an admin
of the pending transaction's group — on BOTH platforms as of 2026-08-28.
Without it Core rejects the vote only after a signature exists, which journals
an unknown outcome and blocks the account from voting on that transaction until
it is reconciled by hand. The
no-op answers (`changed: false` for an unchanged update, an already-set default
group, or a matching avatar pointer) are decided before any prompt is raised,
so a no-op neither prompts nor signs — and the reads those decisions rest on
fail CLOSED: an unreadable default-group lookup refuses instead of being read
as "the default differs", and a malformed avatar pointer refuses instead of
collapsing to "no avatar", which would turn a real clear request into a no-op
with the avatar still set. One divergence is
deliberate: `SET_GROUP` membership is checked on Android through
`GET /groups/member/{address}` rather than desktop's
`POST /groups/members/{groupId}/validate`, because the app-facing node fetch is
GET/HEAD only. Both fail closed on an unrecognized answer, and the Android
route additionally requires the matching entry to be a complete group record: a
bare `{"groupId": n}` is not proof of membership, or a node could manufacture
it and Home would sign a `SET_GROUP` that Core rejects only after a signature
exists. `UNSUPPORTED_PROTOCOL`
is still kept for `qortalRequest`; Hub's `qortalRequest` group forms stay
deferred.

## Publishing extras (Home 2)

`PUBLISH_MULTIPLE_QDN_RESOURCES` and `DELETE_QDN_RESOURCE`, restored on the
Home 2 signing model. **Both work on Android**, on the same contracts as
desktop. The batch was the last thing waiting on the publish-source store's
total byte budget: the Android store held ONE selection, and ten 100 MiB files
retained as Base64 in WebView memory would have been roughly 1.3 GB. Its
Android prompt is held to the SAME structural validator the desktop prompt is
— per item and strictly ordered, so a prompt that cannot show every item with
its exact bytes is refused rather than rendered. Each item is journaled as the
`PUBLISH_QDN_RESOURCE` it is, keyed on its OWN coordinate, and the
pending-transaction conflict gate is re-run per item rather than once for the
batch — on BOTH platforms as of 2026-08-28: an earlier item in the same batch
can have just retained an unknown outcome for that coordinate, one batch can
list a coordinate twice, and two batches approved in separate tabs can both
clear a single pre-approval check. The tombstone's "what this
does" row is Home's own wording on both platforms, never a row the requesting
app can influence.

**`PUBLISH_MULTIPLE_QDN_RESOURCES` is a bounded batch of Home 2 single
publishes.** Each of at most **ten** items carries the exact single-publish
contract: a resource coordinate plus a **Home-issued `sourceToken`** from
`SELECT_QDN_PUBLISH_SOURCE` — inline `data64`/`base64` and path fields are
refused, exactly as the single action refuses them — and every token must be
distinct (1.x released tokens only after the loop, so one approved file
selection could quietly back several transactions). Where the 1.x prompt for
`N > 1` showed only "N resources" with no targets, the Home 2 prompt lists
**every item** — coordinate, file name, byte size, and SHA-256 of the exact
bytes that will be attested — before anything is signed, and any mutable
metadata being published with an item (title, description, category, tags)
gets its own numbered rows: a metadata row appears exactly when that field
is being published, and an omitted row means nothing is. On `qdnRequest`
(Qortium) each item is fee-free with on-device MemoryPoW; on `qortalRequest`
(Qortal) **each item pays the chain's ARBITRARY unit fee**, so the prompt adds
a per-item Fee row and a batch Total fee row, and a fee that changes between
approval and signing refuses rather than signing an undisclosed amount. The
same standard now applies to single `PUBLISH_QDN_RESOURCE`: its Qortal
prompt carries the pinned Fee row, and its metadata values are disclosed as
rows. App-provided `fee` values are refused outright on BOTH chains — Home
derives the fee from the selected chain (an intentional tightening of the
1.x contract, where an app could name its own fee). Every
distinct publisher name is ownership-checked before the prompt and again per
item at signing. Execution is serial and per-item (the 1.x contract): the
result is `{accepted, published: [...], failures: [...]}` where a
signed-but-unbroadcast-confirmed item lands in `failures` with
`outcome: 'unknown'` and its `transactionSignature`, retained in the journal
under its own resource coordinate as the `PUBLISH_QDN_RESOURCE` transaction
it is. One unreconciled publish (single or batch item) blocks this app's next
batch for the account.

**`DELETE_QDN_RESOURCE` publishes the on-chain deletion tombstone.** It is
NOT a local-copy removal: the signed transaction is an ARBITRARY with method
DELETE (2), zero data, no secret, no metadata and no payments, and once
confirmed the resource's status becomes `DELETED` for **every** peer (only a
new publish replaces it). Home byte-asserts the exact tombstone form against
the staged transaction — a builder answering anything but the empty tombstone
refuses — then MemoryPoW, local signing, and broadcast; the account key never
leaves Home. The prompt names the exact coordinate and carries the shell's
own fixed Effect copy so the explanation cannot be forged by the requester.
Deletion requires current ownership of the publisher name, checked before the
prompt and re-checked at signing. **Qortium only**: the keyless
`/arbitrary/public/resource/.../delete` builder is a Qortium Core addition,
so the action is not advertised on `qortalRequest` at all, and an unknown
broadcast outcome journals under the delete's own action with the resource
coordinate as its key. The Home 2 result adds `transactionSignature`, which
1.x's delete result omitted.
