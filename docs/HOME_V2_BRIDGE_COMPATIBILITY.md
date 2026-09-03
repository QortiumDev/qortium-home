# Home 2 bridge compatibility ledger

Last updated: 2026-08-26

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

The notification-manager half of this surface is no longer Settings-only. The
same summarize/mute/remove/revoke operations are now also reachable by an
embedded QDN app through the five `NOTIFICATION_MANAGER_*` actions in the table
below, gated by the durable `notifications.manage` capability. Two things did
not change and are the reason that is a bounded widening rather than a new
class of access:

- The app sees exactly the redaction the Settings surface produces. It is the
  same `getQdnNotificationManagerSummary` output 1.x served: no account
  bindings, no watch-only keys, no signature filters, and address-like filters
  only when they validate as real Qortal addresses.
- Nothing about rule CREATION becomes reachable. The manager can mute, delete
  rules, and revoke; it cannot add a rule to any app, including itself.

The app-facing path is strictly more restricted than the Settings path in three
ways the trusted shell does not need: it requires a user-granted durable
capability, it refuses to answer at all when the notification store is corrupt
or unreadable (the trusted surface renders a status instead), and it requires
the caller to present the current store revision on every mutation.

The app ASSIGNMENT (`notifications` → Notify) still grants nothing. Any app may
request `notifications.manage`, and the assigned app gets no head start.

## Implemented slice

| Public action | Protocol | Result contract | Permission and route | Desktop | Android |
| --- | --- | --- | --- | --- | --- |
| `SHOW_ACTIONS` | both | Protocol-, route-, and platform-specific callable string array | No prompt; disabled or platform-impossible routes remove node-dependent actions, while a temporary outage keeps implemented actions discoverable | yes | yes |
| `WHICH_UI` | both | Host identifier string | No prompt | yes | yes |
| `GET_HOST_INFO` | both | Host/platform metadata plus authoritative protocol, network, configured/effective route, availability, reachability, and opaque route revision | No prompt | yes | yes |
| `SHOW_CONTEXT_MENU` | both | `{ version: 1, status: "handled", action }` or `{ version: 1, status: "dismissed" }` after a fixed Home-owned account, group, or resource menu | Route-independent; protocol fixes the network; sender/tab/resource context and untrusted anchor are validated; v1 performs only copy and APP-tab navigation | yes | yes |
| `BOOKMARKS_HAS_PERMISSION`, `BOOKMARKS_GET`, `BOOKMARKS_APPLY`, `BOOKMARKS_OPEN` | `qdnRequest` | Permission state, validated saved-link snapshot, revision-CAS mutation result, or `true` after an account-aware open | Route-independent durable `bookmarks.manage` approval; invalid addresses, missing accounts, stale revisions, changed app contexts, and malformed saved data fail closed | yes | yes |
| `NOTIFICATION_MANAGER_HAS_PERMISSION` | `qdnRequest` | `{ granted }` | Route-independent; never prompts, and answers from the capability store alone so it stays truthful while the notification store is degraded | yes | yes |
| `NOTIFICATION_MANAGER_GET`, `NOTIFICATION_MANAGER_SET_MUTED`, `NOTIFICATION_MANAGER_REMOVE_RULES`, `NOTIFICATION_MANAGER_REVOKE` | `qdnRequest` | The 1.x-compatible `{ version: 1, revision, apps }` summary, with address-like filters exposed only when they validate and watch-only/signature filters masked | Route-independent durable `notifications.manage` approval, offered as "always" only; every mutation carries `expectedRevision` and a mismatch fails with `code: "HOME_DATA_STALE"`; a corrupt or unreadable store fails closed rather than reading as an empty profile; rule creation is not part of the surface | yes | yes |
| `GET_HOME_SETTINGS_METADATA`, `GET_HOME_SETTINGS` | `qdnRequest` | The 1.x writable schema (with `writableValues` alongside `allowedValues`), and exactly the seven display keys `theme`/`accent`/`language`/`textSize`/`appZoom`/`ui`/`appNotifications` | Route-independent and **unprompted**, as in Home 1.x — the same display subset already reaches an app as render-URL parameters before its first line of script. Never returns node URLs, account data or API keys. Excluded from widgets. A corrupt or unreadable notification policy reports `appNotifications: false` | yes | yes |
| `UPDATE_HOME_SETTINGS` | `qdnRequest` | The seven keys as they now stand after the change | Route-independent **single-request** `home.settings.write` approval showing per-key current-vs-proposed values; never session or always, and no durable grant is ever stored, so there is nothing to revoke in QDN Apps settings. Accent `clay` is readable but not writable. Excluded from widgets | yes | yes |
| `GET_PENDING_TRANSACTIONS` | both | This app/account/chain's opaque unknown-outcome entries without Home-internal account or app keys; an automatic QPGC setup entry may include `stage: "key-announcement"` | Route-independent scoped `transactions.pending.read` approval; message and key material are never stored | yes | yes |
| `FORGET_PENDING_TRANSACTION` | both | `{ forgotten, network, signature }` | Route-independent single-request `transactions.pending.forget` approval after app reconciliation | yes | yes |
| `GET_NODE_INFO`, `GET_NODE_STATUS` | both | Bare Core JSON | Protocol selects Qortium or Qortal | yes | yes |
| `GET_NODE_SETTINGS_METADATA` | `qdnRequest` | Bare Core JSON (`/admin/settings/metadata`, the same anonymous route the passthrough allows) | No prompt; ordinary route availability | yes | yes |
| `UPDATE_NODE_SETTINGS` | `qdnRequest` | Allowlisted `{ saved, updated, removed, applied, restartRequired }` — Core's `settingsPath` is deliberately dropped | Admin-trusted Qortium route only (managed local Core or attached-key custom node), advertised accordingly by `SHOW_ACTIONS`; validated BEFORE prompting (1.x patch shapes, ≤64 settings, keys ≤120 chars, node-declared writable keys only, values display-bounded); **single-request** `node.settings.write` approval naming every current/proposed value; trust re-resolved after the prompt; keyed `PATCH` refuses redirects | yes | yes |
| `RESTART_NODE` | `qdnRequest` | `{ accepted: true }` | Same admin-trust rule and **single-request** `node.settings.write` approval with the pinned Impact row; keyed `GET /admin/restart`, fire-and-forget as every existing caller of that route | yes | yes |
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
| `UNLOCK_SELECTED_ACCOUNT` | both | `{ address, avatarContract, avatarUrl, isUnlocked: true, name }` | Single-request prompt, never a session or durable grant; opens Home's own password dialog, asserts the unlock actually completed, and rechecks app/tab/account/route before returning. Advertised on **both protocols and both platforms**: unlocking is a Home-account operation, not a chain one — the same wallet, dialog and key whichever global asked — and the legacy wallet app only knows the `qortalRequest` global. The route recheck (desktop and Android alike) binds to the REQUEST's own network, so a `qortalRequest` unlock is checked against the Qortal route. No app receives passwords, seeds, derived key bytes, or private keys | yes | yes |
| `OPEN_NEW_TAB` | both | `true` | Only `qdn://`, `qortal://`, or `home://`; Home owns navigation | yes | yes |
| `OPEN_CURRENT_TAB` | both | `true`, or an error — a rejected address fails the bridge call on both transports, and the portable host additionally reports a replacement that did not happen | Replaces the content of the tab the app is running in. Same shared address validator as `OPEN_NEW_TAB`, and no prompt for the same reason — navigating your own tab is weaker than adding one. The tab is always the requesting view's own `context.tabId`; no tab id is accepted from the request, only app tabs can be replaced, and a Home page (settings, dashboard, Core docs, release notes) can never take one over. The trusted host requires an app-resource address naming an explicit path identifier: a bare app name is refused rather than silently resolved, because a bridge call has no chooser, and `?identifier=` is a query rather than a path identifier so it does not count. Compare-and-swap against the requesting app's own `context.resourceUrl`, re-checked inside the reducer at the write, so a slow replacement can never overwrite a later one. Tears the old app view down and rebuilds it along the fresh-tab path, so the incoming app never inherits the outgoing app's desktop storage partition — partitions are named by a SHA-256 digest of node origin plus canonical resource identity, so two different apps cannot collide onto one. Keeps the tab's account binding, and drops every tab-scoped grant the outgoing app held via the `app-replaced` invalidation | yes | yes |
| `SEARCH_CHAT_MESSAGES` | both | Bare Core JSON | Groups-only in this release (documented Hub deviation, see below); required non-negative `txGroupId`; `before`/`after` pre-validated against Core's floor; `limit` capped at 100 | yes | yes |
| `GET_CHAT_MESSAGE` | both | Bare Core JSON | Base58 signature shape validated before the request | yes | yes |
| `SEND_CHAT_MESSAGE` | both | `{ signature, timestamp }` | Trusted Home prompt (chain, group, 180-char message preview); once or tab-session grant; account must already be unlocked; per-tab/account ceiling of one send per 1.5 seconds and 20 per minute; CHAT-only signing carve-out (fee-less, cannot move funds) — see below | yes | yes |
| `SEND_CHAT_EDIT` | both | `{ signature, timestamp }`, or a signed non-retryable unknown-outcome result | Requires a canonical 64-byte `chatReference`; exact original public message, chain, group, sender ownership, route, account, payload codec, and reference are checked before prompting and before signing | yes | yes |
| `SEND_CHAT_DELETE` | both | `{ signature, timestamp }`, or a signed non-retryable unknown-outcome result | Same ownership/reference/context checks as edit. Qortium uses its empty-message revision. Qortal accepts only Home's canonical empty Hub-v3 edit with no images; Hub renders the retained original row as no message, while both transactions remain on-chain | yes | yes |
| `SEND_CHAT_REACTION` | both | `{ signature, timestamp }`, or a signed non-retryable unknown-outcome result | Requires the exact reaction envelope and canonical reference; the target may belong to another sender, but must be the original public text message in the selected chain/group | yes | yes |
| `GET_PRIVATE_DIRECT_ACTIVE_CHATS`, `SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES` | both | Selected-account-scoped rows with plaintext `data`, or a per-row `decryptionStatus: "FAILED"` without plaintext | No prompt (permissionless reads, owner decision 2026-08-24); exact selected account and participant selectors; encrypted text only; 100-row and 1 MiB response bounds; no plaintext bridge cache; keys never leave Home | yes | yes |
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
| `GET_ALL_LISTS`, `GET_LIST` | `qdnRequest` | Core's sorted list-name array, or the named list's item array in stored order; a 404 answers as `[]` | No prompt (reads are permissionless), but node-gated: lists are private state on the user's own node and every `/lists` route needs its administrative key, so both are refused with `NODE_CAPABILITY_MISSING` unless the route is a node Home holds an administrative key for — the local Core it manages, or a custom node the user attached their own key to (HTTPS anywhere; plain HTTP only to exact loopback, which is the SSH-tunnel case). 2 MiB response cap (1.x parity). Never offered to a chromeless widget — which names the user blocks and follows is a behavioral profile of the person | yes | yes (served directly, like every other read in the family) |
| `ADD_TO_LIST`, `REMOVE_FROM_LIST` | `qdnRequest` | Core's own `text/plain` body — the string `"true"` or `"false"`, returned not thrown, exactly as in 1.x | Single-request `node.lists.write` prompt each, never a session or durable grant, showing the list, the node, and the complete serialized item batch (refused unprompted above 4,000 characters — an approval the user cannot read in full is not an approval). Same trusted-node rule as the reads; the route is re-resolved after approval and a mid-prompt change refuses the write. `listName` and `items` validate to the 1.x shapes, except that a batch with blank or non-string entries is refused whole where 1.x silently half-applied it, and a selected account is required (1.x prompted account-free; Home 2 write prompts are account-anchored) | yes | yes (the same single-request approval; the administrative key stays inside the node client and never reaches the React layer) |
| `CREATE_POLL`, `VOTE_ON_POLL`, `UPDATE_POLL` | `qdnRequest` | 1.x wrappers: `{ accepted: true, action, pollName \| pollId (+ optionIndex/optionIndexes or newPollName), network, result, signature, transactionSignature, timestamp }`; an unclear broadcast answers `accepted: false` with `outcome: "unknown"` and is retained in the pending-transaction journal | Single-request `poll.write` prompt each, never a session or durable grant. Signs one fee-free transaction via the keyless `/polls/public/*` builders with local byte-assertion, MemoryPoW, and local Ed25519 — the account key never leaves Home. A vote prompt names the poll and the selected option labels (one-based; 0 removes) and the poll is re-read after approval so a changed name or option list refuses the sign. `fee`/`txGroupId` when present must be 0; `pollId` starts at 1; needs a selected unlocked account and a route exposing the public builders (`NODE_CAPABILITY_MISSING` otherwise) | yes | yes (signed in the Android vault on the same build → byte-assert → MemoryPoW → sign sequence; prompt rows held to the same per-action contract, and the poll state the prompt was shown against is the baseline the pre-sign re-read is checked against) |
| `REGISTER_NAME`, `UPDATE_NAME`, `SELL_NAME`, `CANCEL_SELL_NAME`, `BUY_NAME` | `qdnRequest` | 1.x wrappers: `{ accepted: true, action, name (+ newName/amount/recipient/seller per action), network, result, signature, transactionSignature, timestamp }`; an unclear broadcast answers `accepted: false` with `outcome: "unknown"` and journals against the coarse per-action target | Single-request `name.write` prompt each, never a session or durable grant. Signs one fee-free transaction via the keyless `/names/public/*` builders (Core #269) with local byte-assertion (new type 3–7 verifiers), MemoryPoW, and local Ed25519. BUY_NAME PAYS the sale amount to the seller: payment-grade prompt, live-state-resolved seller/price/restriction with exact-match on app-supplied values, and the sale state re-read after approval. Exact-spelling rule: a reduced-name lookup answering a different stored spelling refuses. Amounts are exact atomic bigints; `fee`/`txGroupId` when present must be 0; needs a selected unlocked account and a route exposing the builders | yes | yes (same in-vault signing path as the poll family, BUY_NAME included — a purchase available on desktop but not on the user's phone would be a half-working platform, not a safer one; the signed price and seller are the approved ones, so a sale re-listed while the prompt is open refuses instead of being paid at the new price) |
| `CREATE_GROUP`, `UPDATE_GROUP`, `GROUP_APPROVAL`, `SET_GROUP`, `SET_GROUP_AVATAR` | `qdnRequest` | 1.x wrappers plus `changed` (a no-op update/set/avatar answers `changed: false` WITHOUT signing); an unclear broadcast answers `accepted: false` with `outcome: "unknown"` and journals | Single-request `group.mutation` prompt each, never a session or durable grant. Built LOCALLY on the group-admin transformer pattern (types 22/23/33/34/49, zero-nonce build → byte-verify → MemoryPoW → verify stamped → local Ed25519). GROUP_APPROVAL resolves and DISCLOSES the pending transaction it votes on and re-reads it after approval; UPDATE_GROUP prompts the complete replacement with "(unchanged)" rows and has no ownership transfer; SET_GROUP_AVATAR signs a QDN pointer only (bytes go through PUBLISH_QDN_RESOURCE separately). fee/txGroupId when present must be 0; groups created inside a transaction group cannot be updated through Home (creationGroupId is not API-exposed) | yes | yes (local transformer on Android, as the group-admin family already is: the vault verifies the transformer's bytes AND the stamped bytes, and the approved group state is both the comparison baseline and the source of UPDATE_GROUP's merged values; GROUP_APPROVAL also refuses a non-admin vote up front) |
| `GET_USER_WALLET` | both for native; foreign on `qdnRequest` | Native: `{ address, assetId: 0, assetName: "Native Asset", native: true }`; foreign: `{ address, coin, publicKey, publickey }` | Native remains permissionless and unlock-free. Foreign supports BTC/LTC/DOGE/DGB/RVN/DASH/NMC/FIRO only, requires unlock plus the separate session-scoped foreign-wallet disclosure, derives public watch material locally without requiring Core or serializing xprv, and is never offered to widgets | yes | yes |
| `GET_WALLET_BALANCE`, `GET_USER_WALLET_INFO`, `GET_USER_WALLET_TRANSACTIONS` | `qdnRequest` | Core balance/address-info/transaction payload | Same foreign-wallet session disclosure and exact eight-coin set; xpub-only authenticated POST to reachable local or authenticated custom Qortium Core; redirect refusal, bounded response, Core error 1201 normalization; ARRR excluded | yes | yes |
| `SET_CURRENT_FOREIGN_SERVER` | `qdnRequest` | Core `ServerConnectionInfo`, including preserved `success: false` | Single-request prompt showing coin, node, host, port, connection, and optional certificate fingerprint; route/key revision recheck; trusted Core only; ARRR excluded | yes | yes |
| `GET_BALANCE`, `GET_ACCOUNT_DATA` | both | Bare Core JSON | No prompt. An absent `address` now defaults to the selected account (Home 1.x behavior, lost in the first Home 2 tranche), and `GET_BALANCE` honors a non-negative integer `assetId` instead of silently answering with the native balance for every asset. Both defaults are neutral — the subject is the caller's own account, whose address it can already read — except in a chromeless widget, where the self-addressing default is withheld and an explicit `address` is required | yes | yes |
| `GET_CROSSCHAIN_BLOCKCHAINS`, `GET_CROSSCHAIN_SERVER_INFO`, `GET_FOREIGN_FEE`, `GET_SERVER_CONNECTION_HISTORY` | both | Blockchain list with a projected `QORT` row and a `homeWallet` capability per row; bare server array; `{ fee, feePerKb }` or `{ fee }`; bare Core JSON | No prompt; zero-key bounded reads of the node's own `/crosschain` prefix. No wallet seed, key derivation, unlocked account or API key is involved. `coin` is resolved against a strict allowlist (BTC, LTC, DOGE, DGB, RVN, DASH, NMC, FIRO, ARRR) before it can become a URL path segment; `ARRR` is accepted here although Home cannot derive an ARRR wallet, because these reads need no key material and Home 1.x wrongly reused the HD-wallet coin list. `GET_FOREIGN_FEE` normalizes Core's per-kilobyte `feekb` to a per-byte `fee` with ceiling rounding, so a fee never rounds down below what the foreign chain requires | yes | yes |
| `GET_MARKET_PRICES` | both | `{ cacheHit, cacheTtlMs, coins, currencies, fetchedAt, missing, prices, source, stale, staleReason? }` | No prompt. **The only bridge action that leaves the Qortal/Qortium node network**, reaching `api.coingecko.com`. Home fetches ONE fixed superset — every supported coin and currency, with change — and projects each app's requested subset locally, so the outbound URL is a compile-time constant that no app input reaches; an app cannot vary coins, currencies, or the change flag to alter what is sent, and nothing identifying is sent (no address, account id, public key, app identity, node URL, cookie, or custom header beyond `Accept`). At most one outbound request per cache interval, globally — a minimum interval governs *attempts*, so even a run of failures cannot exceed it — and concurrent callers share one in-flight fetch. On a fetch failure a cached answer is returned with `stale: true` and a `staleReason`; with nothing cached the error propagates rather than inventing a price. Route-independent — a disabled or unreachable node route has no bearing on it | yes | yes |
| `GET_ACCOUNT_RATING`, `GET_RESOURCE_RATING` | both | `{ action, target, category, rater, summary, ratings }` or `{ action, service, name, identifier, rater, summary, rating }` | No prompt; two bounded anonymous public reads combined (the subject's summary plus this rater's own rating). A 404 on either half means "not rated yet" and becomes `null`/`[]`, not an error, and Core's three empty shapes (`null`, `[]`, `{}`) all collapse to `null`. `rater` defaults to the selected account; in a chromeless widget that default is withheld, because the response echoes `rater` back and would otherwise disclose the selected identity with no chrome to announce it. The rating WRITES (`RATE_ACCOUNT`, `RATE_RESOURCE`) remain deferred | yes | yes |
| `GET_GROUP_BANS`, `GET_GROUP_KICKS`, `GET_MEMBER_BANS`, `GET_MEMBER_KICKS` | both | Bare Core JSON | No prompt; bounded anonymous public reads of group moderation history, which Core serves to anyone. Positive-integer `groupId`, address regex, 100-entry page cap, and `before`/`after` validated against the same millisecond floor Core enforces for chat. The member-scoped pair defaults `address` to the selected account (1.x behavior), withheld in a widget. The moderation WRITES are signed transactions and never travel this GET passthrough | yes | yes |
| `SEND_MESSAGE` | `qdnRequest` | `{ accepted: true, action, fee: "0", recipient, signature, timestamp }`, or a signed non-retryable unknown-outcome result | Single-request prompt disclosing the AT address and the full message text, never a session or durable grant — pinned on the action itself, not only on the prompt payload. Deliberately narrow: **AT recipients only** (25 bytes, address version 23, valid checksum — an ordinary account address is refused), plaintext only, no payment, no transaction group, fee 0 paid with local MemoryPoW. A request carrying `amount`, `assetId`, `recipientPublicKey`, `chatReference`, `txGroupId`, `isEncrypted: true`, `isText: false`, or a non-zero `fee` — at the top level OR inside a `payload` object, since the recipient and message are read payload-first — is REFUSED rather than silently stripped, so an app can never believe it attached a payment that was dropped; a field present in both places with two values, and a flag that is not a real boolean, are refused too. The full message text is disclosed untruncated in the prompt (a bounded scrollable panel with a byte count), so what is approved is exactly what is signed. The transaction is serialized field by field from the two validated inputs; the bridge never accepts raw transaction bytes. Requires an unlocked account, is rate-limited with the other sends, and rechecks app/tab/account/route context before signing. Qortium-only because the MESSAGE serializer mirrors Qortium Core's layout, which differs from Qortal's. Journaled like the chat sends when the broadcast outcome is unknown | yes | yes (signed in the Android vault; both platforms now verify the locally-built bytes field by field, unstamped and stamped, since Core has no MESSAGE builder to cross-check against) |

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

Every Home prompt refusal — the user pressing Deny on any approval dialog —
rejects with `code: "USER_CANCELLED"`. A refusal happens strictly BEFORE
anything is signed or broadcast, so it is a definitive "nothing was sent":
apps must render it as the user's own decision, never journal it as an
unknown-outcome broadcast, and never warn that the operation "may already have
happened". (`retryable: true` — the app may ask again and the user may approve
next time.)

## Current Q-App baseline status

| App/workflow | Current state | Remaining boundary |
| --- | --- | --- |
| Qortium Trust public browsing | Names, identity batches, visible avatars, and Home-mediated account unlock have bridge coverage. Public RATING READS (`GET_ACCOUNT_RATING`, `GET_RESOURCE_RATING`) were claimed here before they existed; they are genuinely implemented as of the R4 tier-2 restoration | `RATE_ACCOUNT`, `RATE_RESOURCE`, and other mutations remain deferred |
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
| Lists, hosted data, files, viewers | `ADD_LIST_ITEMS`, `DELETE_HOSTED_DATA`, `DELETE_LIST_ITEM`, `GET_HOSTED_DATA`, `GET_LIST_ITEMS`, `PLAY_ENCRYPTED_MEDIA`, `SAVE_FILE`, `SHOW_PDF_READER` (the three list actions have the `qdnRequest` family implemented — see the table above — but these v3 forms stay deferred: every `/lists` route needs the node's administrative key, and Home holds one only for the Qortium Core it runs itself) |
| Notification subscriptions and tab sessions | `LOCK_TAB`, `NOTIFICATION_ADD`, `NOTIFICATION_GET`, `NOTIFICATION_MARK_SEEN`, `NOTIFICATION_PERMISSION`, `NOTIFICATION_REMOVE`, `SESSION_PERMISSIONS`, `UNLOCK_TAB`, `UPDATE_SUBSCRIPTIONS`; Home 2's additive `NOTIFICATION_HAS_PERMISSION` and `SHOW_NOTIFICATION` contract is implemented separately, and transient authority is invalidated on account/node/navigation/tab lifecycle boundaries |
| Names, groups, polls | `BUY_NAME`, `CANCEL_SELL_NAME`, `CREATE_GROUP`, `CREATE_POLL`, `REGISTER_NAME`, `SELL_NAME`, `UPDATE_GROUP`, `UPDATE_NAME`, `VOTE_ON_POLL` (the two poll actions have the `qdnRequest` family implemented — see the table above — but these v3 forms stay deferred: Hub's poll contract is a different legacy transaction — pollName target, zero-based index, paid fee and last reference — and must not be mechanically translated) |
| QDN writes | Deletion and legacy inline/path publishing; Home 2 single-resource `PUBLISH_QDN_RESOURCE` — and now `PUBLISH_MULTIPLE_QDN_RESOURCES` as a bounded batch of it — are implemented through the separate H5B source-token contract (Hub's inline `data64`/`encrypt` multi-publish fields stay refused) |
| Encryption and group keys | `DECRYPT_AESGCM`, `DECRYPT_DATA`, `DECRYPT_DATA_WITH_SHARING_KEY`, `DECRYPT_QORTAL_GROUP_DATA`, `ENCRYPT_DATA_WITH_SHARING_KEY`, `ENCRYPT_QORTAL_GROUP_DATA`, `REENCRYPT_GROUP_KEYS` (`ENCRYPT_DATA` is now implemented on both protocols — see below. `ENCRYPT_QORTAL_GROUP_DATA` is NOT the same mechanism despite the shared `qortalGroupEncryptedData` marker: it takes a `groupId` and a shared symmetric key fetched from a `DOCUMENT_PRIVATE` resource published by group admins, and needs the read side of private-group keys, which Home does not have yet) |
| Wallets, payments, signing | `MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA`, foreign `SEND_COIN`, `SIGN_FOREIGN_FEES`, `SIGN_TRANSACTION` (`GET_USER_WALLET`, the three foreign wallet reads, QORT send, and protocol-bound `TRANSFER_ASSET` are implemented — see the wallet-family note below) |
| Foreign chain and trading | `ADD_FOREIGN_SERVER`, `CANCEL_TRADE_SELL_ORDER`, `CREATE_TRADE_BUY_ORDER`, `CREATE_TRADE_SELL_ORDER`, `GET_ARRR_SYNC_STATUS`, `REMOVE_FOREIGN_SERVER`, `START_CROSSCHAIN_SERVER`, `UPDATE_FOREIGN_FEE` (the four zero-key `/crosschain` reads and `SET_CURRENT_FOREIGN_SERVER` are implemented) |
| AT/admin and other host UI | `ADMIN_ACTION`, `CREATE_AND_COPY_EMBED_LINK`, `DEPLOY_AT`, `OPEN_USER_LOOKUP` |

## Deferred Qortium surface

The complete retained legacy-bridge action-name source remains
`electron/qdn-app-actions.ts`, and `SHOW_ACTIONS` is the runtime authority.
This section is the explicit per-action ledger of that catalogue, replacing the
earlier blanket "everything not listed above is deferred": verified against
`getHomeV2AppActions('qdnRequest')` at 2.1.0 (the polls restoration, on top of
main `8402315`), **100 of the 149 Home 1.x `qdnRequest` actions are
advertised** — plus the five name writes, five group mutations, and two
publishing extras (`PUBLISH_MULTIPLE_QDN_RESOURCES`, `DELETE_QDN_RESOURCE`)
of the restoration wave, plus the two rating writes (`RATE_ACCOUNT`,
`RATE_RESOURCE`), `SET_ACCOUNT_AVATAR`, and the payment family (`PAYMENT`,
`SEND_COIN`, `TRANSFER_ASSET` on `qdnRequest`; `SEND_QORT` moves to the
superseded column, its operation now living on `qortalRequest`), taking
the intersection to 118 — and the 31 below are not: 18 superseded, 13
deferred.

**Superseded (17) — the same operation exists on the `qortalRequest` global.**
Home 1.x predates the second global, so it reached Qortal through
`QORTAL_`-prefixed `qdnRequest` helpers; Home 2 keeps the protocols separate
and does not carry the prefixed forms. These are not planned work — the
replacement is shipped:

| Home 1.x action | Home 2 replacement (on `qortalRequest`) |
| --- | --- |
| `FETCH_QORTAL_RESOURCE` | `FETCH_QDN_RESOURCE` |
| `GET_QORTAL_ACCOUNT_GROUPS` | `GET_ACCOUNT_GROUPS` |
| `GET_QORTAL_ACCOUNT_NAMES` | `GET_ACCOUNT_NAMES` |
| `GET_QORTAL_ACTIVE_CHATS` | `GET_ACTIVE_CHATS` |
| `GET_QORTAL_CHAT_MESSAGE` | `GET_CHAT_MESSAGE` |
| `GET_QORTAL_CHAT_MESSAGES` | `SEARCH_CHAT_MESSAGES` |
| `GET_QORTAL_NAME_DATA` | `GET_NAME_DATA` |
| `GET_QORTAL_NODE_STATUS` | `GET_NODE_STATUS` |
| `GET_QORTAL_PRIMARY_NAME` | `GET_PRIMARY_NAME` |
| `GET_QORTAL_RESOURCE_METADATA` | `GET_QDN_RESOURCE_METADATA` |
| `GET_QORTAL_RESOURCE_STATUS` | `GET_QDN_RESOURCE_STATUS` |
| `GET_QORTAL_RESOURCE_URL` | `GET_QDN_RESOURCE_URL` |
| `GET_QORTAL_TRANSACTION` | `FETCH_NODE_API` `/transactions/signature/…` (or `SEARCH_TRANSACTIONS`) |
| `GET_QORT_BALANCE` | `GET_BALANCE` |
| `SEARCH_QORTAL_RESOURCES` | `SEARCH_QDN_RESOURCES` |
| `SEARCH_QORTAL_TRANSACTIONS` | `SEARCH_TRANSACTIONS` |
| `SEND_QORTAL_GROUP_CHAT` | `SEND_CHAT_MESSAGE` |

**Deferred (15) — planned by family, unadvertised until each family's
request/result/error, permission, denial, stale-context, malformed-input,
desktop, and Android fixtures pass:**

| Family | Deferred actions | Notes |
| --- | --- | --- |
| ~~Publishing preview~~ | ~~`PREVIEW_QDN_PUBLISH_SOURCE`~~ | **No longer deferred (2026-08-30)** — implemented as an app-tab preview on `qdnRequest`; folder sources added 2026-09-02; **desktop and Android, on any admin-trusted node** since 2026-09-02 (see § Remote trusted nodes and its subsection below) |
| ~~Node settings and admin~~ | ~~`GET_NODE_SETTINGS_METADATA`, `UPDATE_NODE_SETTINGS`, `RESTART_NODE`~~ | **No longer deferred (2026-09-01)** — implemented on the node-administration trust rule (see the implemented table above and `docs/BRIDGE_ACTIONS.md` § Node settings actions) |
| Background notification subscriptions | `NOTIFICATION_ADD`, `NOTIFICATION_GET`, `NOTIFICATION_REMOVE` | Distinct from the implemented `NOTIFICATION_HAS_PERMISSION`/`SHOW_NOTIFICATION` contract and the `NOTIFICATION_MANAGER_*` family |
| App assignments | `GET_APP_ASSIGNMENTS`, `REQUEST_APP_ASSIGNMENT` | F4 is Settings-only; app-facing delegation remains deferred |

These will be migrated by family; they will not be exposed by forwarding Home
2.1 apps into the broad v1 bridge. Legacy inline/path publishing (a request
*shape* of the publish actions rather than a separate action name) is likewise
not carried.

### Wallet family

`GET_USER_WALLET` supports the native asset on both globals and the eight
non-ARRR foreign wallets on `qdnRequest`. Balance, address-info, transaction
history, and foreign-server selection are restored on `qdnRequest`. Foreign
sending remains unavailable.

The distinction is not arbitrary. The native branch returns an address Home
already knows and already hands out permissionlessly through
`GET_SELECTED_ACCOUNT`. The foreign branch, as Home 1.x implemented it, derives
a BTC/LTC/DOGE/DGB/RVN/DASH/NMC/FIRO HD wallet from the account seed — a
different and much larger security boundary, with its own key-derivation code,
its own xprv/xpub handling, and its own failure modes. The Home 2 foreign path
therefore uses a separate session grant even though it
keeps the Home 1.x wire action names. It derives only address/xpub watch data,
never serializes an xprv, and wipes copied seed and private-node buffers. Receive
address derivation is entirely Home-local; balance/history reads send only xpub
to a trusted Qortium Core. The native action's entry in
`HOME_V2_PERMISSIONLESS_ACTIONS` applies only when the request is native; the
foreign disclosure kind explicitly bypasses that early return.

### `PREVIEW_QDN_PUBLISH_SOURCE`

**Implemented (2026-08-30).** This section previously explained why it was
deferred; that reasoning is kept below because it is still the reason it is NOT
wired to the resource viewer.

The deferral's stated precondition was "a faithful port needs a v2 preview
surface that does not exist yet, and a handler that returns true while showing
the user nothing would be worse than an honest refusal". That is exactly right,
and it is why previews open as an **app tab** -- the only surface that can render
a website. The resource viewer renders images, audio and video and otherwise
shows a download panel, so sending a `WEBSITE` preview there would have produced
precisely the silent nothing this section warned about. (It was tried; the
tier-2 test caught it.)

Two obstacles this section named turned out to be already solved by the time the
work was done:

- **Render scope.** `isAllowedRenderUrlForOrigin` already permits
  `/render/hash/...`, with a comment naming local publish previews: the node only
  serves those hashes with a matching secret.
- **Navigation identity.** `parseRenderPathIdentity` already parses
  `/render/hash/<hash>` as `{ service: 'HASH', name: <hash> }`, so same-resource
  navigation binding works without a new rule.

So the work was renderer-side: `AppTabContext.previewUrl`, structural validation
in `parseAppEntry` (loopback, `/render/` path, no credentials), and an origin
binding in `AppTabStage` against the tab's own node -- the parser cannot do that
one, because nothing at that layer knows which node the tab belongs to, and a
preview restored from an earlier session could otherwise point at a stale port.

`previewUrl` also participates in `contextsIdentifySameTab`. Without that a
preview would count as the same tab as the app that requested it -- it borrows
the app's id, identity, wallet, network and address -- and would replace it.

**The preview must be observed to OPEN (2026-09-02).** As shipped, it did not.
The bridge returns `true` the moment it has sent `open-publish-preview`, so no
layer downstream can report a preview that never appears -- the app has already
been told it did. The shell's handler resolved the requesting app out of
`HomeV2Snapshot.apps`, a field only the design fixture ever fills: the live
shell builds each app descriptor from the address it opened and leaves that list
empty, so the lookup always missed and every payload was dropped in silence.
Both existing layers were green throughout -- the bridge did its job, and the
tier-2 tests run against the fixture shell, where the list is populated.

The handler now rebuilds the descriptor from the requesting TAB
(`src/home-v2-live/publish-preview-tab.ts`), which is also the tighter rule: a
preview can only ever borrow the identity and address of the tab that asked for
it, which is exactly what the reducer's `assertAppTabTarget` then re-checks. The
payload's `title` -- the picked file's basename, which the handler used to
ignore -- names the tab, so a preview is distinguishable from the app beside it.
Because "returns true" and "opened" cannot be told apart from inside the bridge,
the guard is an end-to-end one: `npm run smoke:desktop:qdn-publish-preview`
picks a file, previews it, and fails unless a preview tab opens and renders. It
runs unpackaged, because the picker's smoke hook is development-only on purpose
(a native dialog cannot be driven over CDP, and a shipped Home must never take
that branch).

**Folder sources (2026-09-02).** The port dropped `SELECT_QDN_PUBLISH_SOURCE`'s
`kind` field -- the bridge never read it -- so the picker was `openFile`-only
and a website in a folder could not be previewed at all. `kind` is honoured
again (`file` | `directory`, defaulting to `file`, and an unrecognised value is
now refused rather than silently defaulted the way 1.x did). A folder selection:

- opens `openDirectory` instead of `openFile`;
- must contain a top-level entry file (`index.html` and Core's five siblings --
  the list is shared with the 1.x preview stager, not copied);
- is measured with a stat-only walk, capped at 512 MiB and 20,000 entries, and
  refused outright if it contains a symbolic link pointing outside the folder
  (Core follows the path Home hands it, so an escaping link would preview a
  file the user never chose);
- is **preview-only**. `readHomeV2DesktopPublishSource` refuses a folder by
  name, so nothing about publishing changed: `.zip` and `.html` websites and
  single media files are still the only publishable website shapes.

**Core is never handed a path the user owns.** Validating a selection and then
POSTing the live path is a check/use gap: between the walk and the render an
escaping symlink can be added, a file can grow past the cap, or the whole path
can be swapped, and Core follows what it is given. So the selection is copied
into a Home-owned staging directory (`mkdtemp` under the OS temp dir, mode
0700) with every rule re-enforced *during* the copy — regular files only,
containment re-checked per link, device/FIFO/socket entries refused, byte and
entry ceilings applied to the bytes actually copied — and the entry-file
assertion is then made against the **copy**, which can no longer change. A file
selection is re-checked by device/inode/size/**mtime**/**ctime** (stricter than
the publish path, which compares neither timestamp) and copied too. Both
timestamps, because `utimes` lets a writer put mtime back where it found it
while ctime — the metadata-change time — is advanced by that very call and
cannot be set backwards from userland. What remains undetectable is a same-size
rewrite completed inside one timestamp tick on a coarse-granularity filesystem;
that residual gap is why the bytes are copied from the O_NOFOLLOW handle rather
than the path being handed on.

The **folder** re-check is deliberately only device/inode, and is a cheap
sanity check rather than a guarantee: inode numbers are recycled, so a folder
deleted and recreated at the same path can pass it (CI demonstrated exactly
that against an early version of this test). Timestamps are not compared for a
folder either — a folder's mtime and ctime move whenever a top-level entry is
added or removed, so comparing them would refuse the ordinary case of the user
saving one more file into the folder they just picked, and would do it by
shadowing the copy-time checks that actually decide the outcome. The staging
directory is removed in a `finally` once the POST returns; Core has already
built and cached the preview by hash by then, which `ArbitraryResource`'s own
upload branch states. The prefix is shared with qdn.ts's 1.x staging so its
startup orphan sweep collects anything a crash leaks, and the second temp
directory that stager makes for a `.zip` or a bare `.html` — which nothing in
Home 2 swept — is now recognised by that prefix and removed alongside.

**No path reaches the app.** `fileName` (the basename) stays in the
`SELECT_QDN_PUBLISH_SOURCE` response because Explore displays it and 1.x
promised it, but every preview *failure* is one of four fixed sentences —
staging failed, unsupported content, node too old, node failed — chosen by
status, never by echoing a Core error body or a filesystem error. The detail is
logged with `console.warn` in the main process only. Messages the publish-source module
raises are tagged and pass through unchanged because each is already a
path-free constant; anything untagged is replaced.

**Admin-trusted nodes only, and `qdnRequest`-only.** Previewing sends the
chosen source to a node to render, so on a public node its operator would see
it before the user chose to publish. `resolveHomeV2AdminNode` yields a key only
for a node the user administers -- Home's managed local Core, or their own node
with its API key attached -- and anything else refuses with a message saying
why. No approval prompt is needed, because the node is the user's own and no
third party sees the content. (This paragraph said "local nodes only" until
2026-09-02; that was the old transport talking, not the security model. See
§ Remote trusted nodes.) Two consequences, both fixed on 2026-09-02 after the
action was found advertised where it could only refuse:

- **Not on Android.** Home for Android runs no Core, so the action was in
  `ANDROID_UNSUPPORTED_ACTIONS` (the first entry since the parity wave emptied
  it) with its own stated reason -- the previous single generic refusal claimed
  "requires transaction signing", which was never true of previewing.

  **Superseded 2026-09-02.** That reason described the desktop TRANSPORT, not
  the action. The desktop handler POSTed a local filesystem PATH to
  `POST /arbitrary/preview/{service}`, which only a co-located node can read --
  so the feature was loopback-shaped and looked local-only. Both hosts now use
  Core's `POST /arbitrary/preview/{service}/upload?archive=&filename=`, which
  takes the BYTES (what Home 1.x Android already used), and both gate on
  ADMIN TRUST. Android runs the action like any other: its picker returns
  base64, so it uploads with `archive=false`; folders are not selectable there,
  which is fine. Desktop stages the selection into a Home-owned temp directory
  exactly as before, then uploads that copy -- a folder or an extracted zip as
  a deflated archive (`archive=true`), a single file as itself -- bounded by
  `HOME_V2_PUBLISH_SOURCE_MAX_BYTES` (100 MiB) and refused above it with a
  fixed, path-free message. The path-based route is not retained even as a
  loopback optimisation: one transport means one behaviour to test, and the
  desktop smoke (which runs against a loopback node) then exercises the same
  code a remote user gets.
- **Not on `qortalRequest`.** Home holds no administrative key for a Qortal
  node — `evaluateHomeV2AdminTrust` refuses the Qortal network outright — so a
  preview on that protocol could only ever refuse.
  `PREVIEW_QDN_PUBLISH_SOURCE` is therefore off the Qortal catalogue, exactly
  like the other admin-trusted actions (`RESTART_NODE`,
  `UPDATE_NODE_SETTINGS`, `GET_NODE_SETTINGS_METADATA`). `SELECT_` and
  `STAGE_QDN_PUBLISH_SOURCE` stay on both protocols: they feed
  `PUBLISH_QDN_RESOURCE`, which Qortal has, and neither needs a node key.

### No longer deferred: display settings, minting, lists, polls, names, group mutations, publishing extras, rating writes, the account avatar, and payments

Home's own **display settings** are no longer deferred.
`GET_HOME_SETTINGS_METADATA`, `GET_HOME_SETTINGS` and `UPDATE_HOME_SETTINGS`
are implemented on `qdnRequest` over the same seven-key surface Home 1.x
exposed; see [Home settings QDN bridge](HOME_SETTINGS_BRIDGE.md). This is a
narrow exception and does not widen the settings boundary: **node settings
writes remain deferred and unadvertised**, as do wallet, update-policy,
start-page and dashboard writes. The seven keys are theme, accent, language,
text size, app zoom, interface style and the global app-notification toggle,
and a read returns those seven and nothing else.

Minting is no longer deferred. `GET_MINTING_STATUS`, `LIST_MINTING_ACCOUNTS`,
`START_MINTING`, and `REMOVE_MINTING_ACCOUNT` are implemented on both protocols
(R3-11); see [QDN bridge action notes](BRIDGE_ACTIONS.md) for their shapes and
the local-Core restriction. `LIST_MINTING_ACCOUNTS` is new in Home 2 — it is the
scoped replacement for the raw `/admin/mintingaccounts` fetch Home 1.x apps fell
back to, which Home 2's read allowlist refuses.

The list family is no longer deferred. `GET_ALL_LISTS`, `GET_LIST`,
`ADD_TO_LIST`, and `REMOVE_FROM_LIST` are implemented on `qdnRequest` over the
same trusted-node rule the minting family uses; see
[QDN bridge action notes](BRIDGE_ACTIONS.md) for their shapes, the
single-request `node.lists.write` prompt, and the deliberate
refuse-the-whole-batch divergence from 1.x's silent item dropping. The Qortal
v3 list forms stay deferred, as the table above notes.

The poll write family is no longer deferred. `CREATE_POLL`, `VOTE_ON_POLL`,
and `UPDATE_POLL` are implemented on `qdnRequest` through Core's keyless
`/polls/public/*` builders with the group-membership signing pattern; see
[QDN bridge action notes](BRIDGE_ACTIONS.md) for the one-based index rules,
the single-request `poll.write` prompt, and the fee/txGroupId divergences.
The Qortal v3 poll forms stay deferred, as the table above notes.

The name write family is no longer deferred. All five mutations are
implemented on `qdnRequest` through Core's keyless `/names/public/*`
builders (qortium-core PR #269); see
[QDN bridge action notes](BRIDGE_ACTIONS.md) for the payment-grade BUY_NAME
prompt, the exact-spelling rule, and the fixed-point amount handling. The
Qortal v3 name forms stay deferred.

The group mutation family is no longer deferred. `CREATE_GROUP`,
`UPDATE_GROUP`, `GROUP_APPROVAL`, `SET_GROUP`, and `SET_GROUP_AVATAR` are
implemented on `qdnRequest`, built locally on the group-admin transformer
pattern; see [QDN bridge action notes](BRIDGE_ACTIONS.md) for the pending-
transaction disclosure rules, the complete-replacement update semantics, and
the pointer-only avatar contract. Hub's `qortalRequest` group forms stay
deferred (its UPDATE_GROUP is an owner-transfer contract Qortium does not
have).

The publishing extras are no longer deferred. `PUBLISH_MULTIPLE_QDN_RESOURCES`
is implemented on both protocols as a bounded batch (max ten items) of the
H5B source-token single-publish contract with full per-item prompt
disclosure — including per-item and total fee rows on Qortal, where each item
pays the chain fee. `DELETE_QDN_RESOURCE` is implemented on `qdnRequest`
only, publishing the byte-asserted on-chain deletion tombstone (the keyless
delete builder is a Qortium Core addition, so the action is not advertised
on `qortalRequest`). **Both work on Android**, the batch holding its prompt to
the same per-item structural validator desktop uses, and re-asserting
publisher-name ownership per item at signing time. See
[QDN bridge action notes](BRIDGE_ACTIONS.md).
`PREVIEW_QDN_PUBLISH_SOURCE` is no longer deferred either — it is implemented
on `qdnRequest`, on **desktop and Android**, against any node the user is
admin-trusted on (local or remote), and it accepts folder sources on desktop;
see its section above, and § Remote trusted nodes, for why it is not on
`qortalRequest`. The Hub-catalogue QDN-writes row above still covers legacy
inline/path publishing, which stays refused in favor of source tokens.

The rating writes are no longer deferred. `RATE_ACCOUNT` and `RATE_RESOURCE`
are implemented on `qdnRequest` only (the rating system is a Qortium Core
addition), built locally on the group-mutation transformer pattern; see
[QDN bridge action notes](BRIDGE_ACTIONS.md) for the derived-address
disclosure rule, the cooldown pre-check, the static service-id rule, and
the remove-vs-rate captions. The 1.x path sent the account private key to
the node's signing endpoint; Home 2's does not, by construction. **Both work
on Android**, where the vault verifies the unstamped and the stamped bytes and
holds the signature to the rating the prompt disclosed — a rating is a
RELATIVE change, so a current value that moved underneath the approval refuses
rather than being replaced by a change the user never saw.

`SET_ACCOUNT_AVATAR` is no longer deferred: implemented on `qdnRequest`
only as the locally-built type-50 pointer transaction — see
[QDN bridge action notes](BRIDGE_ACTIONS.md) for the current-pointer
disclosure and re-read, the clear-vs-set captions, and the feature-trigger
gating. (Its 1.x path also sent the private key to the node.) **It works on
Android** on the same terms as the rating writes, held to the pointer the
prompt disclosed.

The payment family is no longer deferred. `PAYMENT` and native `SEND_COIN`
are aliases of ONE locally-built Qortium PAYMENT (type 2); `TRANSFER_ASSET`
is the locally-built type-12 transfer; `SEND_QORT` is the separate Qortal
PAYMENT compatibility action on `qortalRequest` (the existing local Qortal
serializer). All four sign locally — the 1.x Qortium paths sent the account
private key to the node — pay the Home-quoted pinned chain fee (these types
have NO MemoryPoW alternative), and journal unknown outcomes under the
exact spend intent with a fail-closed guard. `SEND_COIN`'s 1.x foreign-coin
arm refuses loudly (`FOREIGN_SEND_UNAVAILABLE`) — foreign sending remains
deferred. On today's Qortium Previewnet, which deliberately has
no native asset yet, the Qortium arms refuse honestly at the balance and
asset pre-checks. **All four work on Android**, on the same terms: every
number the prompt disclosed travels with the request and the vault refuses if
its own re-derivation disagrees; the timestamp the fee was quoted for is the
timestamp signed; a ten-minute freshness bound is asserted as the last act
before a signature exists; one payment at a time per account and chain; and a
signed payment that could not be journaled fail-closes payments for that
account, because without an entry to reconcile against a second payment could
duplicate the first. See [QDN bridge action notes](BRIDGE_ACTIONS.md).

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
- `UNLOCK_SELECTED_ACCOUNT` works on both `qdnRequest` and `qortalRequest`, on
  desktop and Android. Unlocking is a Home-account operation with no chain
  semantics — the same wallet, password dialog and key whichever global asked —
  so a pure-Qortal app can drive it too; the legacy wallet app, which only knows
  `qortalRequest`, depends on this. Whichever global asked, Home shows its own
  password dialog and no app receives passwords, derived key bytes, seeds, or
  private keys from the result. The single-request route recheck binds to the
  request's own network on both platforms.
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
  requested; an app can drive that itself by first calling
  `UNLOCK_SELECTED_ACCOUNT`, which now works on both protocols and both
  platforms (see above), so a pure-Qortal app is no longer dependent on the
  account being unlocked by other means. The normal
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
- **Response-channel navigate-during-async race (Android, channel-wide,
  pre-existing).** A read reply on Android is posted back to the requesting
  document through the `event.source` WindowProxy of the app frame. A
  WindowProxy follows its browsing context across a navigation, so if the
  document that issued a read hard-navigates within the shared proxy origin
  before the asynchronous answer is ready, the reply is delivered to whatever
  document then occupies the frame — including a non-APP same-origin document
  that installs a plain `message` listener and never passed the exact-URL gate.
  This is a property of the **whole** `qdnRequest`/`qortalRequest` response
  channel, not of any one action: **every** read is delivered this way, so
  `GET_SELECTED_ACCOUNT`'s address, `GET_USER_ACCOUNT`, private chat reads and
  the rest all share it. It is the same shared-origin + WindowProxy exposure as
  the residual above, seen on the reply leg rather than the request leg, and it
  is likewise owner-accepted here. Closing it channel-wide — which needs a
  non-cooperative "the frame navigated since this request" signal the shell does
  not currently have (the self-reported navigation signal cannot see a silent
  hard navigation to a non-bridged document, and iframe-load timing on Android
  WebView is unverified) — is a separate security project, not this pass.

  One action is hardened now, because a security claim was made about it:
  `GET_HOME_SETTINGS`/`UPDATE_HOME_SETTINGS` are the confined channel an app is
  told to use for `appZoom` and `appNotifications` (the two settings withheld
  from the live broadcast — see [Home settings QDN bridge](HOME_SETTINGS_BRIDGE.md)).
  Their reply now **revalidates the requesting document at completion** against
  the same launch-resource signal the request gate uses, and posts to the
  specific proxy origin rather than `*`, so an app that reported drifting to
  another resource gets a coded error instead of the values. This closes the
  app's own reported drift; the silent-hard-navigation residual is the
  channel-wide item above and is not claimed closed. This hardening is on the
  Home 2 bridge (`src/v2/shell/AppTabStage.tsx`). The Home 1 bridge
  (`src/QdnViewer.tsx`) is not part of this confined-channel claim — Home 2 apps
  never run under it — and it already replies to the specific `event.origin`
  rather than `*`; adding the same completion revalidation there would require
  new plumbing it does not have today (it forwards the self-reported navigation
  snapshot to a callback without retaining a live current-document URL to
  compare), so the 1.x path is left to the channel-wide follow-up.

## Private-chat reads and the durable `account.read` grant (2026-08-30)

Reading private chat history — direct **and** group — is no longer covered by a
durable `account.read` grant; it needs its own capability.

Updated 2026-09-01: the local-Core-only condition on those capabilities was
removed (owner decision). The reads fetch ciphertext and decrypt inside Home,
so the durable grant is stored and honored on any node route; a public route
observes access metadata only, as it already did under session grants. The
direct-read actions are permissionless (2026-08-24) and do not prompt at all.

  action                                durable capability
  GET_PRIVATE_DIRECT_ACTIVE_CHATS       (permissionless)
  SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES   (permissionless)
  GET_PRIVATE_GROUP_ACTIVE_CHATS        account.groupChat    (any route)
  SEARCH_PRIVATE_GROUP_CHAT_MESSAGES    account.groupChat    (any route)
  GET_PRIVATE_GROUP_CHAT_STATE          account.read
  GET_CHAT_ATTACHMENT_STREAM_URL        account.read
  OPEN_CHAT_ATTACHMENT_VIEWER           account.read

All of them remain in `HOME_V2_ACCOUNT_READ_ACTIONS`: one SESSION grant still
covers the read-only family together, and the prompt copy is unchanged. Only the
durable "always allow" is split.

### Why

Two faults, found on 2026-08-30 and both fixed by the same exclusion:

- **The grant did not match the prompt.** The generic durable block ran before
  the `account.directChat` one and returned, so answering "always" to "read your
  direct messages" recorded `account.read` — account identity, pending
  transactions and attachment reads included. The `account.directChat` block
  added in #465 was unreachable.
- **It defeated the node-trust rule (historical).** At the time,
  `account.directChat` was usable only on a local Core, and `account.read`
  carried no such condition, so the capability actually granted bypassed that
  gate. The gate itself was removed on 2026-09-01 (see the update above): the
  reads fetch ciphertext and decrypt inside Home, so the "node sees plaintext"
  premise did not hold. The grant-must-match-prompt fault stands on its own.

### What changed for existing grants

An app already holding `account.read` stops being covered for chat history and
is asked again; answering "always" then records the specific capability, and
only on a local Core. That re-prompt is the point: the earlier grant was never
shown to the user as covering chat history on somebody else's node.

### Deliberately unchanged

`GET_PRIVATE_GROUP_CHAT_STATE` reports whether a group key is held and needs
rotating. It returns no message plaintext and is the call an app makes before
asking for anything, so it stays on the ordinary read grant.

Chat ATTACHMENT reads carry a comparable exposure and stay on `account.read`
for now (owner decision, 2026-08-30). If that is revisited, the same predicate —
`isHomeV2PrivateChatReadAction` — is where it would be extended.

## Remote trusted nodes (2026-09-02)

Every Home capability that needs a node's API key is gated on **trust**, never
on the node being `127.0.0.1`. Trust means the user holds that node's API key:
Home's own managed local Core, or a **custom node with the key attached in
Settings** — which is how someone running their own Qortium Core on a VPS
attaches it. `evaluateHomeV2AdminTrust()`
(`electron/home-v2-admin-trust.ts`) is the one predicate; the desktop wrapper is
`resolveHomeV2AdminNode()` and the Android one is `requireAdminNode()`.

**All API-key features work over a remote trusted node**, not a subset: QDN
lists, minting, node settings and restart, foreign-wallet reads and server
selection, the Core API documentation toggle and its restart, and
`PREVIEW_QDN_PUBLISH_SOURCE`. Previously three of these were written against
`mode === 'local'`, which refused a user administering their own remote Core
for no reason the security model supports.

**The transport rule is unchanged, and it is the one real constraint.** A
remote node must be reached over:

- **HTTPS** — Core's own SSL API keystore, or a reverse proxy in front of it; or
- **an SSH tunnel to loopback** (`ssh -L 24891:127.0.0.1:24891 user@host`), which
  presents to Home as plain HTTP to `127.0.0.1` and is allowed for that reason.
  Core sees a tunnelled request as loopback too, so its default API-key policy
  already permits it.

Plain HTTP to a remote host is refused by design: the API key would travel in
the clear. Android refuses to even SAVE such a custom node. What is *not* a
reason to refuse is the node simply being somebody else's machine that the user
happens to own.

A **public/discovered** node stays untrusted whatever its transport. It is
somebody else's Core; previewing on it would show its operator content the user
has not decided to publish, and none of the user's keys belong on it.

Two consequences worth stating:

- `SHOW_ACTIONS` advertises the admin-trusted actions only on a route that is
  actually trusted, so an app is never offered a button whose only possible
  outcome is a refusal.
- A trust decision carries a **revision** (origin + credential). Anything that
  acts after a prompt or a long upload re-resolves trust and compares the
  revision first, so a node switched or a key re-attached mid-flight cannot
  inherit an approval made about a different one. A restored publish-preview
  tab is bound the same way: same origin, same revision, or it is dropped.

### Known architecture gap: the Android admin key transits WebView JS

On Android every authenticated node call — QDN lists, node settings and
restart, minting, foreign-wallet reads and server selection, and now the
publish preview — unwraps the API key out of the Keystore-backed secret store
**into JavaScript** (`HomeV2SecureStorage.unwrap` → `readSettings()` in
`src/home-v2-live/node-client.ts`) and passes it back across the Capacitor
bridge as a request header. The key is therefore resident in WebView memory for
the duration of each call.

This is the shape the Android host has had since the authenticated families
landed; the preview path follows it rather than widening it. Recorded here
because it is a real gap and not a decision: the follow-up is a native
trust-bound request method — the Java side unwraps the key itself, applies it,
and returns only the result — after which no authenticated path needs the key
in JS at all. (Security review, 2026-09-02.)

Two things that are NOT part of the gap, and are already closed:

- The key never reaches a **QDN app**, on either host. Apps get results.
- The token that crosses into React and is written into the user's profile is a
  random **binding id** minted with the key, not a digest of it. A short digest
  of `origin||apiKey` would be an offline verifier for a weak key; the binding
  id is independent of the credential and is re-minted whenever it changes.

### Android source size limit

Android's picker returns Base64 through the Capacitor bridge, so every retained
selection is a copy in WebView memory. The publish-source store is therefore
budgeted in Base64 characters (64 MiB), which is **48 MiB of file**. That is
the real limit for both publishing and previewing on Android, and it is what
the picker is now asked for — previously it was asked for the desktop's 100 MiB
and a larger file was read, encoded, passed across the bridge and only then
refused.

Desktop keeps the 100 MiB `HOME_V2_PUBLISH_SOURCE_MAX_BYTES` ceiling and never
holds the upload in memory: the archive is spooled to the Home-owned staging
directory and streamed to the node as chunked Base64.

### Core API documentation: desktop only, for now

Enabling Core's API documentation page (and the restart that applies it) is
gated on admin trust **and** on the desktop transport. Android has no native
path behind `enableHomeV2CoreDocs`, so the control is not offered there rather
than being offered and refused. Reading the documentation works on both.
