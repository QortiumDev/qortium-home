# Home 2 bridge compatibility ledger

Last updated: 2026-08-24

This ledger tracks the Home 2 app bridge. It is a compatibility record, not a
claim that every Q-App already works. `SHOW_ACTIONS` is the runtime authority:
Home advertises only the actions implemented by the current protocol adapter.

## Baselines and provenance

- Qortium `qdnRequest`: the 0BSD Home 1.x catalogue in
  `electron/qdn-app-actions.ts` and its handlers in `electron/qdn.ts`.
- Qortal `qortalRequest`: Qortal Hub tag `v3.0.0`, commit
  `4f1d5127eebbb8747056ae8a4b8cb060b2559820`. The observable action catalogue
  is `src/hooks/useQortalMessageListener.tsx:listOfAllQortalRequests`; request
  behavior is also inspected in `src/qortal/qortal-requests.ts`.
- Hub source is GPL-3.0 behavioral reference only. Home code remains 0BSD and
  does not copy Hub implementation.

The shared runtime-free validator and action catalogue is
`electron/home-v2-app-actions.ts`. Desktop uses
`electron/home-v2-app-bridge.ts`; Android uses
`src/home-v2-live/node-client.ts`. The public protocols remain separate even
where these adapters share validated paths.

Inside Home 2 app views, Home is the bridge authority. Desktop cancels only
the active node's exact `/apps/q-apps.js` request; Android answers that same
request locally with an empty JavaScript response. Standalone Core `/render`
pages and Home 1.x retain Core's injected bridge client.

## Trusted Settings host bridge

Home 2.1's current F4 implementation adds a private QDN Apps Settings bridge,
not a public QDN app action. The authorized top-level Home shell can read a
versioned redacted assignment/notification summary, update an already-persisted
assignment with revision checking, mute a notification grant, or revoke it.
Widgets, subframes, navigated documents, and destroyed senders are denied by the
desktop host. No raw rules, account bindings, filters, watch-only keys, titles,
text, links, filesystem paths, or capability grants cross the desktop IPC
boundary. Android reads its renderer-owned Preferences stores and projects the
same redacted state before the Settings component receives it.

Mute keeps the grant, all rules, and Core subscriptions while suppressing
alerts. Revoke deletes the grant and every rule for that stable QDN resource
identity. That identity is shared across Qortium and Qortal protocol use; route,
query, fragment, account, and network changes do not create separate grants.
Foreign-payment watch-only data already disclosed to a Core cannot be recalled.
The profile can be restored by a platform backup, so this state is described as
Home-profile data rather than hardware-local data.

This F4 slice does not add `GET_APP_ASSIGNMENTS` or
`REQUEST_APP_ASSIGNMENT` to Home 2's `SHOW_ACTIONS` and does not change QAVS
`platformVersion: "2.0"`. App-facing assignment delegation remains deferred.

## Implemented slice

| Public action | Protocol | Result contract | Permission and route | Desktop | Android |
| --- | --- | --- | --- | --- | --- |
| `SHOW_ACTIONS` | both | Protocol-, route-, and platform-specific callable string array | No prompt; disabled or platform-impossible routes remove node-dependent actions, while a temporary outage keeps implemented actions discoverable | yes | yes |
| `WHICH_UI` | both | Host identifier string | No prompt | yes | yes |
| `GET_HOST_INFO` | both | Host/platform metadata plus authoritative protocol, network, configured/effective route, availability, reachability, and opaque route revision | No prompt | yes | yes |
| `SHOW_CONTEXT_MENU` | both | `{ version: 1, status: "handled", action }` or `{ version: 1, status: "dismissed" }` after a fixed Home-owned account, group, or resource menu | Route-independent; protocol fixes the network; sender/tab/resource context and untrusted anchor are validated; v1 performs only copy and APP-tab navigation | yes | yes |
| `BOOKMARKS_HAS_PERMISSION`, `BOOKMARKS_GET`, `BOOKMARKS_APPLY`, `BOOKMARKS_OPEN` | `qdnRequest` | Permission state, validated saved-link snapshot, revision-CAS mutation result, or `true` after an account-aware open | Route-independent durable `bookmarks.manage` approval; invalid addresses, missing accounts, stale revisions, changed app contexts, and malformed saved data fail closed | yes | yes |
| `GET_PENDING_TRANSACTIONS` | both | This app/account/chain's opaque unknown-outcome entries without Home-internal account or app keys; an automatic QPGC setup entry may include `stage: "key-announcement"` | Route-independent scoped `transactions.pending.read` approval; message and key material are never stored | yes | yes |
| `FORGET_PENDING_TRANSACTION` | both | `{ forgotten, network, signature }` | Route-independent single-request `transactions.pending.forget` approval after app reconciliation | yes | yes |
| `GET_NODE_INFO`, `GET_NODE_STATUS` | both | Bare Core JSON | Protocol selects Qortium or Qortal | yes | yes |
| `IS_USING_PUBLIC_NODE` | both | Boolean for the configured route | Protocol selects network; remains callable while the route is unavailable | yes | yes |
| `FETCH_NODE_API` | both | Bounded response envelope | GET/HEAD allowlist; protocol selects network | yes | yes |
| `FETCH_QORTAL_NODE_API` | `qdnRequest` | Bounded response envelope | Explicit Qortal GET/HEAD allowlist | yes | yes |
| `GET_ASSET_INFO`, `GET_ASSET_BALANCES`, `GET_ASSET_TRANSFERS` | `qdnRequest` | Bare Qortium Core JSON | Shared strict asset selector/path validation; bounded public read | yes | yes |
| `GET_NAME_DATA`, `GET_ACCOUNT_NAMES` | both | Bare Core JSON | Explicit public identity read | yes | yes |
| `SEARCH_NAMES`, `LIST_GROUPS` | both | Bare Core JSON array | Required query for name search; strict integer pagination and real booleans only | yes | yes |
| `GET_AT`, `GET_AT_DATA`, `LIST_ATS` | both | Bare Core JSON, or the documented `AT not found.` error for a valid absent AT | Strict AT address and 32-byte Base58 code-hash validation; Core's 100-entry page cap enforced before the request | yes | yes |
| `FETCH_BLOCK`, `FETCH_BLOCK_RANGE` | both | Bare Core JSON | Exactly one of signature or height required for a single block; strict Base58 signature shape; Home-side 100-block range cap because Core has none | yes | yes |
| `SEARCH_TRANSACTIONS` | both | Bare polymorphic Core JSON array (transaction-type fields are fork-specific) | `confirmationStatus` required explicitly because the forks default differently; Core's txType/address/limit<=20 precondition and a 100-entry limit cap enforced before the request | yes | yes |
| `GET_DAY_SUMMARY`, `GET_PRICE` | `qortalRequest` | Bare Core JSON; price is a bare fixed-point integer | Qortal-only: Qortium Previewnet public seeds do not expose these routes. Price blockchain restricted to Qortal's supported foreign chains; a public node may still deny `/admin/summary` by its own policy | yes | yes |
| `GET_PRIMARY_NAME` | `qortalRequest` | Bare Core JSON | Explicit Qortal identity read | yes | yes |
| `GET_ACCOUNT_DATA`, `GET_BALANCE` | both | Bare Core JSON | Public address read; the invoking global selects the chain, so `qdnRequest` reads Qortium and `qortalRequest` reads Qortal. Strict address validation; no account selection and no private data | yes | yes |
| `RESOLVE_IDENTITIES` | `qdnRequest` | Address/name/avatar-hint array | Qortium metadata only; at most 500 unique addresses | yes | yes |
| `FETCH_ACCOUNT_AVATAR`, `FETCH_GROUP_AVATAR` | both | Network-qualified bounded base64 image or pending state | Protocol selects chain; Qortium on-chain pointer wins and exact pointer-info 404 alone enables legacy fallback; Qortal uses the established named-thumbnail coordinates; explicit address/positive group ID; max 500 KiB; raster magic-byte validation; no node URL | yes | yes |
| `FETCH_QDN_RESOURCE` | both | Bare decoded Core response | Source protocol selects chain; 2 MiB default and 5 MiB maximum | yes | yes |
| `LIST_QDN_RESOURCES`, `SEARCH_QDN_RESOURCES` | both | Bare Core resource array | Validated query mapping | yes | yes |
| `GET_QDN_RESOURCE_METADATA`, `GET_QDN_RESOURCE_PROPERTIES`, `GET_QDN_RESOURCE_STATUS`, `GET_QDN_RESOURCE_URL` | both | Bare JSON or render URL | Source protocol selects chain | yes | yes |
| `GET_SELECTED_ACCOUNT` | `qdnRequest` | Address, public name, lock state, avatar contract | Trusted Home prompt; once or tab-session grant | yes | yes |
| `GET_USER_ACCOUNT` | `qortalRequest` | Address and public key when available from Qortal | Trusted Home prompt; once or tab-session grant | yes | yes |
| `UNLOCK_SELECTED_ACCOUNT` | `qdnRequest` | Sanitized address, public name, and unlocked state | Visible Home-owned prompt; exact app/tab/account/route recheck; no private material | yes | yes |
| `OPEN_NEW_TAB` | both | `true` | Only `qdn://`, `qortal://`, or `home://`; Home owns navigation | yes | yes |
| `OPEN_CURRENT_TAB` | both | `true`, or an error — a rejected address fails the bridge call on both transports, and the portable host additionally reports a replacement that did not happen | Replaces the content of the tab the app is running in. Same shared address validator as `OPEN_NEW_TAB`, and no prompt for the same reason — navigating your own tab is weaker than adding one. The tab is always the requesting view's own `context.tabId`; no tab id is accepted from the request, only app tabs can be replaced, and a Home page (settings, dashboard, Core docs, release notes) can never take one over. The trusted host requires an app-resource address naming an explicit path identifier: a bare app name is refused rather than silently resolved, because a bridge call has no chooser, and `?identifier=` is a query rather than a path identifier so it does not count. Compare-and-swap against the requesting app's own `context.resourceUrl`, re-checked inside the reducer at the write, so a slow replacement can never overwrite a later one. Tears the old app view down and rebuilds it along the fresh-tab path, so the incoming app never inherits the outgoing app's desktop storage partition — partitions are named by a SHA-256 digest of node origin plus canonical resource identity, so two different apps cannot collide onto one. Keeps the tab's account binding, and drops every tab-scoped grant the outgoing app held via the `app-replaced` invalidation | yes | yes |
| `SEARCH_CHAT_MESSAGES` | both | Bare Core JSON | Groups-only in this release (documented Hub deviation, see below); required non-negative `txGroupId`; `before`/`after` pre-validated against Core's floor; `limit` capped at 100 | yes | yes |
| `GET_CHAT_MESSAGE` | both | Bare Core JSON | Base58 signature shape validated before the request | yes | yes |
| `SEND_CHAT_MESSAGE` | both | `{ signature, timestamp }` | Trusted Home prompt (chain, group, 180-char message preview); once or tab-session grant; account must already be unlocked; per-tab/account ceiling of one send per 1.5 seconds and 20 per minute; CHAT-only signing carve-out (fee-less, cannot move funds) — see below | yes | yes |
| `SEND_CHAT_EDIT` | both | `{ signature, timestamp }`, or a signed non-retryable unknown-outcome result | Requires a canonical 64-byte `chatReference`; exact original public message, chain, group, sender ownership, route, account, payload codec, and reference are checked before prompting and before signing | yes | yes |
| `SEND_CHAT_DELETE` | both | `{ signature, timestamp }`, or a signed non-retryable unknown-outcome result | Same ownership/reference/context checks as edit. Qortium uses its empty-message revision. Qortal accepts only Home's canonical empty Hub-v3 edit with no images; Hub renders the retained original row as no message, while both transactions remain on-chain | yes | yes |
| `SEND_CHAT_REACTION` | both | `{ signature, timestamp }`, or a signed non-retryable unknown-outcome result | Requires the exact reaction envelope and canonical reference; the target may belong to another sender, but must be the original public text message in the selected chain/group | yes | yes |
| `GET_PRIVATE_DIRECT_ACTIVE_CHATS`, `SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES` | both | Selected-account-scoped rows with plaintext `data`, or a per-row `decryptionStatus: "FAILED"` without plaintext | Trusted direct-read prompt; exact selected account and participant selectors; encrypted text only; 100-row and 1 MiB response bounds; no plaintext bridge cache; keys never leave Home | yes | yes |
| `SEND_DIRECT_CHAT_MESSAGE`, `SEND_DIRECT_CHAT_EDIT`, `SEND_DIRECT_CHAT_DELETE`, `SEND_DIRECT_CHAT_REACTION` | both | `{ signature, timestamp }`, or a signed non-retryable unknown-outcome result | Single-request direct-write prompt; recipient key, exact original/reference/participant binding, payload codec, route, account, and app/tab context rechecked before signing. Qortium uses QDM1; Qortal uses legacy v2 secretbox. Delete clears displayed content but does not erase transactions | yes | yes |
| `GET_PRIVATE_GROUP_ACTIVE_CHATS`, `GET_PRIVATE_GROUP_CHAT_STATE`, `SEARCH_PRIVATE_GROUP_CHAT_MESSAGES` | both | Selected-account-scoped state or retained rows with plaintext `data`; unavailable rows report `MISSING_KEY` without ciphertext or reusable keys | Qortium verifies bounded signed QPGC state/control records. Qortal accepts only newest-valid current-admin `DOCUMENT_PRIVATE` bundles and old/new authenticated `encryptSingle` messages. Both recheck current membership, account, app/tab, and route | yes | yes |
| `REQUEST_PRIVATE_GROUP_CHAT_KEY`, `RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS`, `ROTATE_PRIVATE_GROUP_CHAT_KEY` | both | Recovery state, `{ signature, timestamp }`, bounded relay/republish result, or signed non-retryable unknown-outcome result | Single-request prompt. Qortium creates/relays QPGC controls; Qortal recovers from or republishes/rotates the current-admin key bundle. Qortal publication requires the selected operator's QDN staging route or returns `NODE_CAPABILITY_MISSING` | yes | yes |
| `SEND_PRIVATE_GROUP_CHAT_MESSAGE`, `SEND_PRIVATE_GROUP_CHAT_EDIT`, `SEND_PRIVATE_GROUP_CHAT_DELETE`, `SEND_PRIVATE_GROUP_CHAT_REACTION` | both | `{ signature, timestamp }`, or signed unknown-outcome result; an uncertain automatic QPGC setup additionally returns `stage: "key-announcement"` and `messageSubmitted: false` | Qortium uses QPGC v1 (maximum 39 members) and automatically creates, wraps, announces, stores, and immediately uses a missing current-epoch key before continuing the requested mutation. Qortal keeps the Hub-compatible app-level secretbox/manual bundle lifecycle with a 2,225-byte plaintext ceiling. Home rechecks membership, key state, reference, sender ownership where required, route, account, and app/tab context before signing | yes | yes |
| `PUBLISH_CHAT_ATTACHMENT`, `GET_CHAT_ATTACHMENT_STREAM_URL`, `OPEN_CHAT_ATTACHMENT_VIEWER`, `SAVE_CHAT_ATTACHMENT` | both | Immutable encrypted descriptor, expiring plaintext stream URL, viewer result, or save result | Home-issued source token only; one-request `chat.attachment` approval; QATT/QENC v2 for Qortium, distinct marked Qortal direct/generic-group formats, and Hub-compatible Qortal private-group images; 1 MiB ciphertext ceiling; exact hash/size, peer/membership, account, app/tab, chain, and route checks; no inline plaintext or reusable key crosses into the app, while the approved stream URL grants temporary bounded byte access | yes | yes |
| `OPEN_QDN_MEDIA_PLAYER`, `OPEN_QDN_DOCUMENT_VIEWER` | both | `true` | Compatibility aliases of `OPEN_QDN_RESOURCE_VIEWER`, collapsed onto it before dispatch, so they share its validation, stream capability binding, and approval behavior and never form a capability of their own. Each keeps the narrower Home 1.x service list (`AUDIO`/`PODCAST`/`VIDEO`/`VOICE`, and `ATTACHMENT`/`DOCUMENT`/`FILE`/`FILES`) — both strict subsets of what the canonical action accepts, so an alias can never reach a resource it refuses | yes | yes |
| `GET_GROUP`, `GET_ACCOUNT_GROUPS`, `GET_GROUP_MEMBERS`, `GET_GROUP_JOIN_REQUESTS`, `GET_ACCOUNT_GROUP_JOIN_REQUESTS`, `GET_ADMIN_GROUP_JOIN_REQUESTS`, `GET_ACTIVE_CHATS` | both | Bare Core JSON | No prompt; bounded anonymous public reads; positive-integer `groupId`, address regex, strict booleans, 100-entry page cap where Core has none | yes | yes |
| `SEARCH_GROUPS` | `qdnRequest` | Bare Core JSON array | Qortium-only — `/groups/search` does not exist on Qortal (verified absent from the Qortal master 6.1.5 and develop checkouts' `GroupsResource.java`); required non-negative-length `query`, `visibility` validated against Core's real `ALL`/`OPEN`/`CLOSED` enum (not Hub's `PUBLIC`/`PRIVATE` terminology), strict `prefixOnly`, 100-entry page cap | yes | yes |
| `GET_MINTING_STATUS`, `LIST_MINTING_ACCOUNTS` | both | `{ address, hasRewardShare, isMinting, keyOnNode, nodeMintingPossible }`, or `{ accounts, available }` with `address`/`mintingAccount`/`publicKey`/`recipientAccount` per entry | No prompt (derived booleans and allowlisted fields only, never key material). `hasRewardShare` is a public read; the node-side fields are `null` and `available` is `false` unless the route is the local Core Home runs and holds the API key for, so they are always unavailable on public/custom nodes, on Qortal, and on Android. Never offered to a chromeless widget, which has no prompt surface and must not learn the selected identity | yes | yes (node-side always unavailable) |
| `START_MINTING`, `REMOVE_MINTING_ACCOUNT` | both | `{ accepted, action, address, keyAdded }` plus `rewardSharePending`/`transactionSignature` when the on-chain self-share was submitted first, or `{ accepted, action, address, publicKey, removed }` | Single-request prompt each, never a session or durable grant, and one never satisfies the other. Requires an unlocked selected account and the local Core reached over loopback; refused with `NODE_CAPABILITY_MISSING` elsewhere and on Qortal. Removal takes no key from the app: Home resolves the selected account's own self-share key from the node's own list, before and again after the approval, and deletes only that, so no other minter can be touched and no app-supplied key-shaped value reaches the node. Errors from the key-bearing calls carry only an operation name and HTTP status | yes | no |

Q-Apps may also make an unchanged same-origin
`GET /transactions/signature/{signature}` read. On Android this route requires
an authorized Home 2.0 proxy origin, exactly three path segments, a query-free
64-88 character Base58 signature, and a response no larger than 512 KiB.
Every other transaction path and every non-GET method remains denied by the
Android proxy. This compatibility route does not add or advertise a bridge
action.

Account prompts are scoped by protocol, action, app resource identity, selected
account, and tab. Home rechecks the live tab/account/resource context after the
decision. Home 2.0 does not migrate v1 grants and this production account
tranche offers no durable
`always` grant.

Home emits the additive `qortiumBridgeStateChanged` document event when a
loaded app's protocol route revision changes. Its detail contains only
`protocol`, `network`, and the new opaque `revision`; apps then re-read
`SHOW_ACTIONS` and `GET_HOST_INFO`. The revision changes with relevant endpoint,
authentication class, availability/reachability, platform capability, or
tab-bound account context. It is an invalidation token, not a credential.

Bridge errors preserve a safe structured envelope across desktop and Android:
`code`, `network`, `action`, `retryable`, optional `outcome`, optional target,
and the applicable `routeRevision`. Unknown internal errors remain
non-retryable. A temporary route failure does not silently select the other
protocol or advertise a permanently reduced host implementation.

## Current Q-App baseline status

| App/workflow | Current state | Remaining boundary |
| --- | --- | --- |
| Qortium Trust public browsing | Public ratings, names, identity batches, visible avatars, and Home-mediated account unlock have bridge coverage | `RATE_ACCOUNT` and other mutations remain deferred |
| Qortium Help public browsing | Search/list/fetch, identity, avatar, app-link navigation, and app-scoped notifications have bridge coverage | publish/delete and app-specific actions outside this slice remain deferred |
| Qortal Q-Tube and similar QDN readers | Qortal resource search/list/fetch, resource URL/status, public account data, navigation, Home-owned bridge selection, and the exact transaction-signature read passed packaged desktop and Android acceptance | media/file helpers, publishing, and any app-specific action outside this slice remain deferred |
| Chat | Public and private groups, direct messages, participation/administration, avatars, public resources, encrypted private attachments, notifications, lifecycle invalidation, and restart-safe unknown-outcome reconciliation now have fine-grained dual-chain Home contracts on desktop and Android. Crypto stays in Home, plaintext is not cached by the bridge, recipient/reference/membership/account/route context is rechecked, and uncertain signed broadcasts remain non-retryable and same-target blocked until reconciliation. | Chat must consume the new Home action families and complete its end-to-end route matrix. The later distinct RCHAT family remains separate. |

On 2026-08-10, the current unchanged Q-Tube passed the implemented read-only
slice in packaged desktop and Android previews: its feed rendered, Home's
21-action `SHOW_ACTIONS` result was authoritative, and a real transaction
signature returned `200`. Android returned an empty `200` for the local bridge
client while transaction search and POST probes remained `403`; desktop
cancelled the bridge-client request. Current Trust and Help also loaded live
data on both platforms after the change. Deferred write/private/action families
are not covered by this acceptance.

## Deferred Qortal v3 surface

The pinned Hub catalogue contains the following actions beyond the implemented
slice. Each remains **deferred and unadvertised** until its request/result/error,
timeout, node mode, permission, denial, stale-context, malformed-input, desktop,
and Android fixtures pass.

| Risk family | Deferred pinned actions |
| --- | --- |
| More public reads/search | `GET_TX_ACTIVITY_SUMMARY` (an API-keyed POST that contacts foreign chains, not a bounded public read), `LINK_TO_QDN_RESOURCE` (navigation family) |
| Lists, hosted data, files, viewers | `ADD_LIST_ITEMS`, `DELETE_HOSTED_DATA`, `DELETE_LIST_ITEM`, `GET_HOSTED_DATA`, `GET_LIST_ITEMS`, `PLAY_ENCRYPTED_MEDIA`, `SAVE_FILE`, `SHOW_PDF_READER` |
| Notification subscriptions and tab sessions | `LOCK_TAB`, `NOTIFICATION_ADD`, `NOTIFICATION_GET`, `NOTIFICATION_MARK_SEEN`, `NOTIFICATION_PERMISSION`, `NOTIFICATION_REMOVE`, `SESSION_PERMISSIONS`, `UNLOCK_TAB`, `UPDATE_SUBSCRIPTIONS`; Home 2's additive `NOTIFICATION_HAS_PERMISSION` and `SHOW_NOTIFICATION` contract is implemented separately, and transient authority is invalidated on account/node/navigation/tab lifecycle boundaries |
| Names, groups, polls | `BUY_NAME`, `CANCEL_SELL_NAME`, `CREATE_GROUP`, `CREATE_POLL`, `REGISTER_NAME`, `SELL_NAME`, `UPDATE_GROUP`, `UPDATE_NAME`, `VOTE_ON_POLL` |
| QDN writes | `PUBLISH_MULTIPLE_QDN_RESOURCES`, deletion, and legacy inline/path publishing; Home 2 single-resource `PUBLISH_QDN_RESOURCE` is implemented through its separate H5B source-token contract |
| Encryption and group keys | `DECRYPT_AESGCM`, `DECRYPT_DATA`, `DECRYPT_DATA_WITH_SHARING_KEY`, `DECRYPT_QORTAL_GROUP_DATA`, `ENCRYPT_DATA`, `ENCRYPT_DATA_WITH_SHARING_KEY`, `ENCRYPT_QORTAL_GROUP_DATA`, `REENCRYPT_GROUP_KEYS` |
| Wallets, payments, signing | `GET_USER_WALLET`, `GET_USER_WALLET_INFO`, `GET_USER_WALLET_TRANSACTIONS`, `GET_WALLET_BALANCE`, `MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA`, `SEND_COIN`, `SIGN_FOREIGN_FEES`, `SIGN_TRANSACTION`, `TRANSFER_ASSET` |
| Foreign chain and trading | `ADD_FOREIGN_SERVER`, `CANCEL_TRADE_SELL_ORDER`, `CREATE_TRADE_BUY_ORDER`, `CREATE_TRADE_SELL_ORDER`, `GET_ARRR_SYNC_STATUS`, `GET_CROSSCHAIN_SERVER_INFO`, `GET_FOREIGN_FEE`, `GET_SERVER_CONNECTION_HISTORY`, `REMOVE_FOREIGN_SERVER`, `SET_CURRENT_FOREIGN_SERVER`, `START_CROSSCHAIN_SERVER`, `UPDATE_FOREIGN_FEE` |
| AT/admin and other host UI | `ADMIN_ACTION`, `CREATE_AND_COPY_EMBED_LINK`, `DEPLOY_AT`, `OPEN_USER_LOOKUP` |

## Deferred Qortium surface

The complete retained legacy-bridge action-name source remains
`electron/qdn-app-actions.ts`. Every action not listed in the implemented table
above is deferred and unadvertised in Home 2.0. In particular this includes
multi-resource publishing/deletion, account/group/name/poll/rating mutations other than the
implemented participation and exact group-administration actions, payments,
foreign wallets, Home/node settings writes,
background notification subscriptions, legacy inline/path publishing, and Qortal-prefixed legacy
helpers. These actions will be migrated by family; they will not be exposed by
forwarding Home 2.0 apps into the broad v1 bridge.

Minting is no longer deferred. `GET_MINTING_STATUS`, `LIST_MINTING_ACCOUNTS`,
`START_MINTING`, and `REMOVE_MINTING_ACCOUNT` are implemented on both protocols
(R3-11); see [QDN bridge action notes](BRIDGE_ACTIONS.md) for their shapes and
the local-Core restriction. `LIST_MINTING_ACCOUNTS` is new in Home 2 — it is the
scoped replacement for the raw `/admin/mintingaccounts` fetch Home 1.x apps fell
back to, which Home 2's read allowlist refuses.

## Known limitations of this slice

- Android's generic app fetch adapter keeps ordinary reads bounded. The H5A
  save path uses the binary adapter explicitly, while H5B large media uses an
  exact expiring capability on the authorized HTTPS range proxy rather than
  whole-file bridge buffering.
- Android gives app-originated reads a 30-second response timeout. Node health
  probes remain short so endpoint selection and dashboard refreshes stay responsive.
- Android's isolated app origin forwards GET-only `/arbitrary/...` relative
  requests to that app's already-authorized node. It also supports the exact,
  bounded transaction-signature compatibility route documented above. Other
  Core API families and non-GET methods remain blocked at the proxy boundary.
- Home 2.0 intentionally does not expose `qortalRequestWithTimeout` or
  `qdnRequestWithTimeout` aliases. H5B's normalized publish action has its own
  bounded host timeout and does not require those compatibility globals.
- Android app titles and browser-history snapshots are accepted only from the
  active iframe with its private bridge token and selected proxy origin. Titles
  are sanitized and capped at 160 characters. History is capped at 200 entries,
  confined to the app origin, and must contain one unique active index.
- `GET_USER_ACCOUNT.publicKey` is read from Qortal's public account data. It can
  be `null` for an address whose public key is not yet visible on chain; Home
  does not unlock or expose private material to fill it.
- Home 2 advertises both application-navigation actions: `OPEN_NEW_TAB` and
  `OPEN_CURRENT_TAB`. Public resource viewing, ranged media URLs, and
  user-directed saves have their own exact H5A actions. What is still refused
  is different in kind from what is merely unmapped, and the two should not be
  read as the same statement:
  - **Not mapped onto an H5A action.** Arbitrary native paths and external web
    URLs are never silently accepted by an action that looks similar. There is
    no H5A action that opens either, and the shared address validator accepts
    only `qdn://`, `qortal://`, and `home://` — so neither open action can be
    talked into one. Home 1.x's `core://` scheme is in this group too: it has
    no Home 2 meaning, and `OPEN_CURRENT_TAB` deliberately uses the v2 scheme
    set rather than reviving it.
  - **Deliberately refused, not dropped.** `OPEN_CURRENT_TAB` replaces only an
    APP tab, and only the requesting view's own. Home's internal pages —
    settings, dashboard, welcome, Core docs, release notes — resolve
    successfully as addresses but are refused as replacements, so an app can
    never take over trusted Home chrome inside its own tab. They remain
    reachable through `OPEN_NEW_TAB`.
- Home 2.0 now uses the existing production profile and strict encrypted wallet
  format. A verified curated backup gates account mutations; malformed data or
  backup verification failure produces read-only recovery state.
- `UNLOCK_SELECTED_ACCOUNT` is Qortium-specific. Qortal apps receive no matching
  shortcut, and no app receives passwords, derived key bytes, seeds, or private
  keys from the result.
- `SEND_CHAT_MESSAGE` and the explicit public revision actions are the bounded
  bridge actions that sign transactions. This is a deliberate, bounded
  exception to the deferred-signing boundary — CHAT only (fee-less, cannot
  move funds, bounded payload) — not a general precedent; payments/arbitrary
  signing remain behind Phase 5. `SEARCH_CHAT_MESSAGES` is **groups-only**:
  `involving`/`sender`/`recipient` selectors are rejected with a specific
  error naming the deferred DM family (decided 2026-08-12, a documented
  deviation from full Hub compatibility). **This is not a confidentiality
  boundary.** DM transactions (Qortium and Qortal alike) are ordinary
  on-chain transactions; their ciphertext is public regardless of which
  bridge action reads it, and `/chat/messages` — including DM-involving
  queries — remains fully reachable through `FETCH_NODE_API` today, exactly
  as it is through any other Qortium/Qortal API client. The `SEARCH_CHAT_MESSAGES`
  restriction exists only because returning ciphertext Home cannot yet
  decrypt is not useful to an app; it protects nothing an app could not
  already read another way. DM results start returning through
  `SEARCH_CHAT_MESSAGES` once Home-side decryption lands (Phase 2,
  docs/CHAT_2_0_PLAN.md), at which point the action starts doing useful work
  instead of handing back opaque bytes — not once some access-control gate
  opens. On `qortalRequest`, `txGroupId: 0`
  (Qortal's retired general chat) is rejected with a specific error; on
  `qdnRequest`, group 0 is Qortium's open general chat and stays allowed. The
  selected account must already be unlocked before a CHAT write is
  requested — a pure-Qortal app has no unlock shortcut (see above), so it cannot
  drive an unlock itself in Phase 1 and depends on the account already being
  unlocked by other means; this is a known limitation, not a bug. The normal
  `SEND_CHAT_MESSAGE` payload remains app-owned: qortium-chat JSON on
  `qdnRequest`, Hub-compatible JSON on `qortalRequest` (the app embeds
  `repliedTo` etc. itself). Explicit revision actions validate but never
  rewrite their frozen network-specific envelopes. Updated apps use the exact
  edit/delete/reaction action so `SHOW_ACTIONS` is truthful. For compatibility,
  an older Qortium app's `SEND_CHAT_MESSAGE + chatReference` request is
  classified by its validated payload and routed through the same exact
  action; Qortal has no released equivalent alias. Home verifies every
  positive-ID target group is open before broadcasting through the public CHAT
  family. Qortium closed groups use the separately advertised QPGC actions,
  which fail closed unless Core reports a compatible atomic membership state
  and Home has or recovers the correct wrapped group key. Qortal closed groups
  use the separately advertised current-admin bundle/`encryptSingle` lifecycle.
  Home never sends a plaintext fallback into either chain's closed group.
- **Android within-principal residual (known limitation, accepted, tracked
  separately):** Android's QDN render proxy serves every app tab on one node
  from a single shared `https://<label>.qdn.androidplatform.net` origin (see
  `QdnRenderProxy.java`'s class doc comment for why — a per-tab origin would
  wipe QDN apps' own local storage between visits). The host label is derived
  from the node origin alone, so cookies, `localStorage` and IndexedDB are
  shared by every app on that node regardless of how a tab was opened.
  `OPEN_CURRENT_TAB` inherits this and does not widen it: replacing a tab's app
  fully remounts the app stage — new component instance, new bridge token, new
  iframe, fresh `authorize()` — so it is exactly equivalent to closing the tab
  and opening the new app, which crosses the same shared origin. Desktop does
  isolate per app, and a replacement there is rebuilt on the fresh-tab path so
  the incoming app gets its own partition. The round-6/7 exact-URL
  gate (`QdnRenderProxy.isExactAuthorizedRenderDocument`) closes cross-app
  grant theft: the native proxy never supplies a fresh bridge token, script
  injection, or a stripped CSP to any document other than the one exact
  resource Home itself launched, enforced by per-tab tokens,
  one-iframe-at-a-time rendering, and this exact-URL match. What it does
  **not**, and cannot,
  prevent on Android: the tab's own already-authorized document can load
  non-APP `/arbitrary` HTML from **any** non-APP service/name/identifier, not
  only content published under the app resource Home launched. That loaded
  content shares the tab's proxy origin and can therefore manipulate the
  already-granted document if the load/navigation preserves a token-bearing
  same-origin context. The non-APP document does not independently pass the
  exact-authorized-URL gate or receive a new bridge token, injection, or grant;
  a full navigation gains no bridge authority only when it neither carries nor
  recovers the already-visible `qdnHomeBridge` token. If it preserves or
  recovers that token while becoming the tab's live iframe, it can reuse that
  tab's **existing** principal and grant. It is not direct cross-tab or
  cross-app grant theft: another tab's per-tab token, registered document, and
  live frame are still unavailable. The shared-origin + URL-token model gives
  Home no way to distinguish trusted app code from other non-APP HTML once the
  authorized document deliberately brings both into that same-origin context.
  Full per-document integrity would require either a distinct origin per app
  (in tension with the local-storage continuity above) or a non-URL token
  handshake between the app document and Home. Neither is in scope for this
  hardening pass; this residual is owner-accepted and tracked separately from
  the cross-app grant-theft closure above.
