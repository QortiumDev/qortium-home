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

Supported read-only actions are `FETCH_NODE_API`, `GET_NODE_INFO`,
`GET_NODE_STATUS`, `GET_ACCOUNT_DATA`, `GET_ACCOUNT_GROUPS`,
`GET_ACCOUNT_GROUP_JOIN_REQUESTS`, `GET_ACCOUNT_NAMES`, `GET_ACTIVE_CHATS`,
`GET_ADMIN_GROUP_JOIN_REQUESTS`, `GET_BALANCE`, `GET_GROUP`,
`GET_GROUP_JOIN_REQUESTS`, `GET_GROUP_MEMBERS`, `GET_MINTING_STATUS`,
`GET_NAME_DATA`, `LIST_GROUPS`, `SEARCH_GROUPS`, `SEARCH_CHAT_MESSAGES`,
`GET_QDN_RESOURCE_METADATA`,
`GET_QDN_RESOURCE_PROPERTIES`, `GET_QDN_RESOURCE_STATUS`,
`GET_QDN_RESOURCE_URL`, `FETCH_QDN_RESOURCE`, `LIST_QDN_RESOURCES`,
`SEARCH_QDN_RESOURCES`, `GET_RESOURCE_RATING`, `GET_ACCOUNT_RATING`, `GET_SELECTED_ACCOUNT`,
`IS_USING_PUBLIC_NODE`, `GET_HOME_SETTINGS_METADATA`, `GET_HOME_SETTINGS`,
`BOOKMARKS_HAS_PERMISSION`, `NOTIFICATION_MANAGER_HAS_PERMISSION`, and the
permissioned bookmark/notification manager reads.
`UPDATE_HOME_SETTINGS` is available in every node mode but requires a
single-request approval before changing Home's display settings. See
[Home settings QDN bridge](HOME_SETTINGS_BRIDGE.md) for request shapes and
the live settings-change event. Bookmark and notification management use
separate durable capabilities and revision-checked mutations; see
[Home data manager QDN bridge](HOME_DATA_MANAGERS.md). Other supported actions include
`WHICH_UI`, and `SHOW_ACTIONS`. Desktop isolated QDN apps and Android tokenized
APP/WEBSITE pages also support `PUBLISH_QDN_RESOURCE`,
`PUBLISH_MULTIPLE_QDN_RESOURCES`, `DELETE_QDN_RESOURCE`,
`APPROVE_GROUP_JOIN_REQUEST`, `INVITE_TO_GROUP`, `JOIN_GROUP`, `LEAVE_GROUP`,
`UPDATE_GROUP`, `START_MINTING`, `REGISTER_NAME`, `UPDATE_NAME`, `SELL_NAME`,
`CANCEL_SELL_NAME`, `BUY_NAME`, `SEND_CHAT_MESSAGE`,
`GET_PRIVATE_GROUP_ACTIVE_CHATS`, `SEARCH_PRIVATE_GROUP_CHAT_MESSAGES`,
`GET_PRIVATE_DIRECT_ACTIVE_CHATS`, `RATE_ACCOUNT`, `RATE_RESOURCE`, and
`SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES`.

The Home-data manager actions are `BOOKMARKS_HAS_PERMISSION`, `BOOKMARKS_GET`,
`BOOKMARKS_APPLY`, `BOOKMARKS_OPEN`, `NOTIFICATION_MANAGER_HAS_PERMISSION`,
`NOTIFICATION_MANAGER_GET`, `NOTIFICATION_MANAGER_SET_MUTED`,
`NOTIFICATION_MANAGER_REMOVE_RULES`, and `NOTIFICATION_MANAGER_REVOKE`. They
remain available when Home uses a public/network node because they operate on
Home's local device data rather than Core.

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
Publish/delete, group, and name write requests require
per-request approval before Home signs and processes the transaction with the
selected tab account. Chat sends and private closed-group reads use a
session-scoped approval for the current tab and selected account; direct private
chat sends and reads use Core-managed direct-message helpers so QDN apps never
receive wallet private keys or generic signing capability.

## `FETCH_NODE_API` limits

`FETCH_NODE_API` accepts path-only requests such as `/admin/status` and only
allows `GET` or `HEAD`. Full external URLs, legacy aliases such as
`GET_NODE_API`, string-form requests, and write-style methods are rejected.

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
