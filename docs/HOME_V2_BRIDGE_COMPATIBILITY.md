# Home 2.0 bridge compatibility ledger

Last updated: 2026-08-10

This ledger tracks the Home 2.0 app bridge. It is a compatibility record, not a
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

## Implemented slice

| Public action | Protocol | Result contract | Permission and route | Desktop | Android |
| --- | --- | --- | --- | --- | --- |
| `SHOW_ACTIONS` | both | Protocol-specific string array | No prompt | yes | yes |
| `WHICH_UI` | both | Host identifier string | No prompt | yes | yes |
| `GET_HOST_INFO` | both | Host/platform metadata | No prompt | yes | yes |
| `GET_NODE_INFO`, `GET_NODE_STATUS` | both | Bare Core JSON | Protocol selects Qortium or Qortal | yes | yes |
| `IS_USING_PUBLIC_NODE` | both | Boolean | Protocol selects network | yes | yes |
| `FETCH_NODE_API` | both | Bounded response envelope | GET/HEAD allowlist; protocol selects network | yes | yes |
| `FETCH_QORTAL_NODE_API` | `qdnRequest` | Bounded response envelope | Explicit Qortal GET/HEAD allowlist | yes | yes |
| `GET_NAME_DATA`, `GET_ACCOUNT_NAMES` | both | Bare Core JSON | Explicit public identity read | yes | yes |
| `GET_PRIMARY_NAME` | `qortalRequest` | Bare Core JSON | Explicit Qortal identity read | yes | yes |
| `GET_ACCOUNT_DATA`, `GET_BALANCE` | `qortalRequest` | Bare Core JSON | Explicit Qortal address read | yes | yes |
| `RESOLVE_IDENTITIES` | `qdnRequest` | Address/name/avatar-hint array | Qortium metadata only; at most 500 unique addresses | yes | yes |
| `FETCH_ACCOUNT_AVATAR` | `qdnRequest` | Pointer-aware bounded base64 image or pending state | Qortium; explicit address; max 500 KiB; raster magic-byte validation | yes | yes |
| `FETCH_QDN_RESOURCE` | both | Bare decoded Core response | Source protocol selects chain; 2 MiB default and 5 MiB maximum | yes | yes |
| `LIST_QDN_RESOURCES`, `SEARCH_QDN_RESOURCES` | both | Bare Core resource array | Validated query mapping | yes | yes |
| `GET_QDN_RESOURCE_METADATA`, `GET_QDN_RESOURCE_PROPERTIES`, `GET_QDN_RESOURCE_STATUS`, `GET_QDN_RESOURCE_URL` | both | Bare JSON or render URL | Source protocol selects chain | yes | yes |
| `GET_SELECTED_ACCOUNT` | `qdnRequest` | Address, public name, lock state, avatar contract | Trusted Home prompt; once or tab-session grant | yes | yes |
| `GET_USER_ACCOUNT` | `qortalRequest` | Address and public key when available from Qortal | Trusted Home prompt; once or tab-session grant | yes | yes |
| `OPEN_NEW_TAB` | both | `true` | Only `qdn://`, `qortal://`, or `home://`; Home owns navigation | yes | yes |

Account prompts are scoped by protocol, action, app resource identity, selected
account, and tab. Home rechecks the live tab/account/resource context after the
decision. Home 2.0 does not migrate v1 grants and this preview offers no durable
`always` grant.

## Current Q-App baseline status

| App/workflow | Current state | Remaining boundary |
| --- | --- | --- |
| Qortium Trust public browsing | Public ratings, names, identity batches, and visible avatars have bridge coverage | `RATE_ACCOUNT`, unlock, and other mutations remain deferred |
| Qortium Help public browsing | Search/list/fetch, identity, avatar, and app-link navigation have bridge coverage | publish/delete, file/viewer actions, and notifications remain deferred |
| Qortal Q-Tube and similar QDN readers | Qortal resource search/list/fetch, resource URL/status, public account data, and navigation have bridge coverage | media/file helpers and any app-specific action outside this slice remain deferred |
| Chat | Public generic reads are possible only through the bounded allowlist | classic chat actions, private chat, encryption, signing, and Reticulum remain deferred |

These are contract statements. An unchanged packaged-app acceptance run on
desktop and the connected Android phone is still required before marking any
app fully compatible.

## Deferred Qortal v3 surface

The pinned Hub catalogue contains the following actions beyond the implemented
slice. Each remains **deferred and unadvertised** until its request/result/error,
timeout, node mode, permission, denial, stale-context, malformed-input, desktop,
and Android fixtures pass.

| Risk family | Deferred pinned actions |
| --- | --- |
| More public reads/search | `FETCH_BLOCK`, `FETCH_BLOCK_RANGE`, `GET_AT`, `GET_AT_DATA`, `GET_DAY_SUMMARY`, `GET_PRICE`, `GET_TX_ACTIVITY_SUMMARY`, `LINK_TO_QDN_RESOURCE`, `LIST_ATS`, `LIST_GROUPS`, `SEARCH_CHAT_MESSAGES`, `SEARCH_NAMES`, `SEARCH_TRANSACTIONS` |
| Lists, hosted data, files, viewers | `ADD_LIST_ITEMS`, `DELETE_HOSTED_DATA`, `DELETE_LIST_ITEM`, `GET_HOSTED_DATA`, `GET_LIST_ITEMS`, `PLAY_ENCRYPTED_MEDIA`, `SAVE_FILE`, `SHOW_PDF_READER` |
| Notifications and tab sessions | `LOCK_TAB`, `NOTIFICATION_ADD`, `NOTIFICATION_GET`, `NOTIFICATION_HAS_PERMISSION`, `NOTIFICATION_MARK_SEEN`, `NOTIFICATION_PERMISSION`, `NOTIFICATION_REMOVE`, `SESSION_PERMISSIONS`, `UNLOCK_TAB`, `UPDATE_SUBSCRIPTIONS` |
| Names, groups, polls | `ADD_GROUP_ADMIN`, `BAN_FROM_GROUP`, `BUY_NAME`, `CANCEL_GROUP_BAN`, `CANCEL_GROUP_INVITE`, `CANCEL_SELL_NAME`, `CREATE_GROUP`, `CREATE_POLL`, `INVITE_TO_GROUP`, `JOIN_GROUP`, `KICK_FROM_GROUP`, `LEAVE_GROUP`, `REGISTER_NAME`, `REMOVE_GROUP_ADMIN`, `SELL_NAME`, `UPDATE_GROUP`, `UPDATE_NAME`, `VOTE_ON_POLL` |
| QDN writes and chat | `PUBLISH_MULTIPLE_QDN_RESOURCES`, `PUBLISH_QDN_RESOURCE`, `SEND_CHAT_MESSAGE` |
| Encryption and group keys | `DECRYPT_AESGCM`, `DECRYPT_DATA`, `DECRYPT_DATA_WITH_SHARING_KEY`, `DECRYPT_QORTAL_GROUP_DATA`, `ENCRYPT_DATA`, `ENCRYPT_DATA_WITH_SHARING_KEY`, `ENCRYPT_QORTAL_GROUP_DATA`, `REENCRYPT_GROUP_KEYS` |
| Wallets, payments, signing | `GET_USER_WALLET`, `GET_USER_WALLET_INFO`, `GET_USER_WALLET_TRANSACTIONS`, `GET_WALLET_BALANCE`, `MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA`, `SEND_COIN`, `SIGN_FOREIGN_FEES`, `SIGN_TRANSACTION`, `TRANSFER_ASSET` |
| Foreign chain and trading | `ADD_FOREIGN_SERVER`, `CANCEL_TRADE_SELL_ORDER`, `CREATE_TRADE_BUY_ORDER`, `CREATE_TRADE_SELL_ORDER`, `GET_ARRR_SYNC_STATUS`, `GET_CROSSCHAIN_SERVER_INFO`, `GET_FOREIGN_FEE`, `GET_SERVER_CONNECTION_HISTORY`, `REMOVE_FOREIGN_SERVER`, `SET_CURRENT_FOREIGN_SERVER`, `START_CROSSCHAIN_SERVER`, `UPDATE_FOREIGN_FEE` |
| AT/admin and other host UI | `ADMIN_ACTION`, `CREATE_AND_COPY_EMBED_LINK`, `DEPLOY_AT`, `OPEN_USER_LOOKUP` |

## Deferred Qortium surface

The complete retained Home 1.x action-name source remains
`electron/qdn-app-actions.ts`. Every action not listed in the implemented table
above is deferred and unadvertised in Home 2.0. In particular this includes
publishing/deletion, account/group/name/poll/rating mutations, payments,
foreign wallets, private chat, Home/node settings writes, bookmarks,
notifications, downloads/viewers, unlock, minting, and Qortal-prefixed legacy
helpers. These actions will be migrated by family; they will not be exposed by
forwarding Home 2.0 apps into the broad v1 bridge.

## Known limitations of this slice

- Android's generic app fetch adapter currently represents node responses as
  JSON. Arbitrary binary QDN resources require a separate bounded binary
  contract rather than string coercion.
- Android gives app-originated reads a 30-second response timeout. Node health
  probes remain short so endpoint selection and dashboard refreshes stay responsive.
- Android's isolated app origin forwards GET-only `/arbitrary/...` relative
  requests to that app's already-authorized node. Other Core API families and
  non-GET methods remain blocked at the proxy boundary.
- Android app titles and browser-history snapshots are accepted only from the
  active iframe with its private bridge token and selected proxy origin. Titles
  are sanitized and capped at 160 characters. History is capped at 200 entries,
  confined to the app origin, and must contain one unique active index.
- `GET_USER_ACCOUNT.publicKey` is read from Qortal's public account data. It can
  be `null` for an address whose public key is not yet visible on chain; Home
  does not unlock or expose private material to fill it.
- Only new-tab navigation is advertised. Current-tab replacement, viewers,
  downloads, native file access, and external web URLs are not silently mapped
  onto it.
- The account catalogue is still the isolated Home 2.0 preview profile. No
  production profile migration is authorized by this tranche.
