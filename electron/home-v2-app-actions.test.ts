import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  buildHomeV2AssetReadPath,
  buildHomeV2ChainReadPath,
  buildHomeV2ListPath,
  buildHomeV2ListWriteBody,
  buildHomeV2NamePath,
  buildHomeV2ResourcePath,
  buildHomeV2ResourceRenderPath,
  resolveHomeV2AppAlias,
  getHomeV2AppNetwork,
  getHomeV2AppActions,
  homeV2AppAddressNamesIdentifier,
  HOME_V2_QORTAL_COMPAT_ALIASES,
  HOME_V2_RESOURCE_VIEWER_ALIASES,
  normalizeHomeV2ChatMessageText,
  canonicalHomeV2VoteSelection,
  normalizeHomeV2BuyNameRequest,
  normalizeHomeV2CancelSellNameRequest,
  normalizeHomeV2CreatePollRequest,
  normalizeHomeV2RegisterNameRequest,
  normalizeHomeV2SellNameRequest,
  normalizeHomeV2UpdateNameRequest,
  parseHomeV2CoinAmount,
  selectHomeV2NameTarget,
  normalizeHomeV2ListItems,
  normalizeHomeV2ListName,
  normalizeHomeV2ListReadResult,
  normalizeHomeV2UpdatePollRequest,
  normalizeHomeV2VoteOnPollRequest,
  selectHomeV2PollTarget,
  serializeHomeV2ListItemsForApproval,
  normalizeHomeV2OpenAddress,
  normalizeHomeV2ReadMethod,
  normalizeHomeV2ReadPath,
  normalizeHomeV2ReplaceTabAddress,
  normalizeHomeV2ResponseMaxBytes,
  normalizeHomeV2SendTxGroupId,
} from './home-v2-app-actions.js'
import {
  homeV2PermissionGrantFamily,
  isHomeV2AccountReadAction,
  isHomeV2ChatSendAction,
  isHomeV2PermissionlessAction,
  HOME_V2_PERMISSIONLESS_ACTIONS,
} from './home-v2-session-grants.js'

const qdnActions = getHomeV2AppActions('qdnRequest')
const qortalActions = getHomeV2AppActions('qortalRequest')

assert.equal(qdnActions.includes('SHOW_CONTEXT_MENU'), true)
assert.equal(qortalActions.includes('SHOW_CONTEXT_MENU'), true)

assert.equal(qdnActions.includes('GET_SELECTED_ACCOUNT'), true)
assert.equal(qdnActions.includes('UNLOCK_SELECTED_ACCOUNT'), true)
assert.equal(qdnActions.includes('FETCH_QDN_RESOURCE'), true)
assert.equal(qdnActions.includes('GET_ASSET_INFO'), true)
assert.equal(qdnActions.includes('GET_ASSET_BALANCES'), true)
assert.equal(qdnActions.includes('GET_ASSET_TRANSFERS'), true)
assert.equal(qdnActions.includes('GET_USER_ACCOUNT'), false)
assert.equal(qortalActions.includes('GET_USER_ACCOUNT'), true)
assert.equal(qortalActions.includes('GET_SELECTED_ACCOUNT'), false)
// Both protocols since the R4 tier-2 restoration. Unlocking is a HOME-account
// operation, not a chain one — the same wallet, the same password dialog, the
// same key, whichever protocol asked — and the legacy wallet app only knows
// the `qortalRequest` global (walletium/src/components/wallet/CoinDetail.tsx:70-75,
// src/utils/addressBookQDN.ts:87-92). Advertising it on both grants nothing
// extra: the user still types their password into Home's own dialog and the
// unlock is asserted to have completed before the action returns.
assert.equal(qortalActions.includes('UNLOCK_SELECTED_ACCOUNT'), true)
assert.equal(qdnActions.includes('UNLOCK_SELECTED_ACCOUNT'), true)
assert.equal(qortalActions.includes('FETCH_QDN_RESOURCE'), true)
for (const action of ['FETCH_ACCOUNT_AVATAR', 'FETCH_GROUP_AVATAR']) {
  assert.equal(qdnActions.includes(action), true)
  assert.equal(qortalActions.includes(action), true)
}
assert.equal(qdnActions.includes('GET_PRIMARY_NAME'), true)
for (const action of ['GET_ASSET_INFO', 'GET_ASSET_BALANCES', 'GET_ASSET_TRANSFERS']) {
  assert.equal(qortalActions.includes(action), true)
}
assert.equal(qortalActions.includes('TRANSFER_ASSET'), true)
// SEND_CHAT_MESSAGE ships on both protocols (Chat 2.0 Phase 1,
// docs/CHAT_2_0_PLAN.md); the desktop and Android send flows share this one
// catalogue entry.
assert.equal(qdnActions.includes('SEND_CHAT_MESSAGE'), true)
assert.equal(qortalActions.includes('SEND_CHAT_MESSAGE'), true)
for (const action of ['SEND_CHAT_EDIT', 'SEND_CHAT_REACTION']) {
  assert.equal(qdnActions.includes(action), true)
  assert.equal(qortalActions.includes(action), true)
}
assert.equal(qdnActions.includes('SEND_CHAT_DELETE'), true)
// Qortal deletion is a referenced canonical empty Hub-v3 edit. It clears the
// rendered content without claiming to erase either on-chain transaction.
assert.equal(qortalActions.includes('SEND_CHAT_DELETE'), true)
for (const action of ['JOIN_GROUP', 'LEAVE_GROUP']) {
  assert.equal(qdnActions.includes(action), true)
  assert.equal(qortalActions.includes(action), true)
}
for (const action of [
  'APPROVE_GROUP_JOIN_REQUEST',
  'INVITE_TO_GROUP',
  'CANCEL_GROUP_INVITE',
  'ADD_GROUP_ADMIN',
  'REMOVE_GROUP_ADMIN',
  'GROUP_BAN',
  'CANCEL_GROUP_BAN',
  'GROUP_KICK',
]) {
  assert.equal(qdnActions.includes(action), true)
  assert.equal(qortalActions.includes(action), true)
}
for (const action of ['BAN_FROM_GROUP', 'KICK_FROM_GROUP']) {
  assert.equal(qdnActions.includes(action), false)
  assert.equal(qortalActions.includes(action), true)
}
for (const action of [
  'GET_PRIVATE_GROUP_ACTIVE_CHATS',
  'GET_PRIVATE_GROUP_CHAT_STATE',
  'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES',
  'REQUEST_PRIVATE_GROUP_CHAT_KEY',
  'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS',
  'ROTATE_PRIVATE_GROUP_CHAT_KEY',
  'SEND_PRIVATE_GROUP_CHAT_MESSAGE',
  'SEND_PRIVATE_GROUP_CHAT_EDIT',
  'SEND_PRIVATE_GROUP_CHAT_DELETE',
  'SEND_PRIVATE_GROUP_CHAT_REACTION',
]) {
  assert.equal(qdnActions.includes(action), true)
  assert.equal(qortalActions.includes(action), true)
}

assert.equal(normalizeHomeV2SendTxGroupId('qdnRequest', 0), 0)
assert.equal(normalizeHomeV2SendTxGroupId('qdnRequest', 5), 5)
assert.equal(normalizeHomeV2SendTxGroupId('qortalRequest', 1), 1)
assert.throws(
  () => normalizeHomeV2SendTxGroupId('qortalRequest', 0),
  /Qortal no longer accepts general-chat transactions/,
)
assert.throws(
  () => normalizeHomeV2SendTxGroupId('qdnRequest', -1),
  /non-negative safe integer/,
)
assert.throws(
  () => normalizeHomeV2SendTxGroupId('qdnRequest', 'not-a-number'),
  /non-negative safe integer/,
)
assert.equal(normalizeHomeV2ChatMessageText('hello'), 'hello')
assert.equal(normalizeHomeV2ChatMessageText('x'.repeat(4000)), 'x'.repeat(4000))
assert.throws(() => normalizeHomeV2ChatMessageText(''), /between 1 and 4000 bytes/)
assert.throws(() => normalizeHomeV2ChatMessageText('x'.repeat(4001)), /between 1 and 4000 bytes/)
assert.throws(() => normalizeHomeV2ChatMessageText(42), /message is required/)
// Home does not parse or rewrite the opaque app payload — leading/trailing
// whitespace and JSON-looking content pass through byte-for-byte.
assert.equal(normalizeHomeV2ChatMessageText('  {"messageText":"hi"}  '), '  {"messageText":"hi"}  ')

for (const chainReadAction of [
  'SEARCH_NAMES',
  'LIST_GROUPS',
  'GET_AT',
  'GET_AT_DATA',
  'LIST_ATS',
  'FETCH_BLOCK',
  'FETCH_BLOCK_RANGE',
  'SEARCH_TRANSACTIONS',
  'SEARCH_CHAT_MESSAGES',
  'GET_CHAT_MESSAGE',
  'GET_GROUP',
  'GET_ACCOUNT_GROUPS',
  'GET_GROUP_MEMBERS',
  'GET_GROUP_JOIN_REQUESTS',
  'GET_ACCOUNT_GROUP_JOIN_REQUESTS',
  'GET_ADMIN_GROUP_JOIN_REQUESTS',
  'GET_ACTIVE_CHATS',
]) {
  assert.equal(qdnActions.includes(chainReadAction), true)
  assert.equal(qortalActions.includes(chainReadAction), true)
}
// Qortal-only by public-node policy: Qortium Previewnet seeds expose neither
// /admin/summary nor the /crosschain/price TRADE-history endpoint, so these
// two stay off the qdnRequest facade.
//
// This is an endpoint-by-endpoint policy, not a blanket "no /crosschain on
// qdnRequest" rule — the four zero-key cross-chain reads restored in R4 tier-2
// (GET_CROSSCHAIN_BLOCKCHAINS, GET_CROSSCHAIN_SERVER_INFO, GET_FOREIGN_FEE,
// GET_SERVER_CONNECTION_HISTORY) ARE on both protocols, pinned in
// home-v2-tier2-actions.test.ts.
for (const qortalOnlyAction of ['GET_DAY_SUMMARY', 'GET_PRICE']) {
  assert.equal(qdnActions.includes(qortalOnlyAction), false)
  assert.equal(qortalActions.includes(qortalOnlyAction), true)
}
// Qortium-only: /groups/search does not exist on Qortal (verified against
// both the Qortal master and develop checkouts' GroupsResource.java).
assert.equal(qdnActions.includes('SEARCH_GROUPS'), true)
assert.equal(qortalActions.includes('SEARCH_GROUPS'), false)

const blockSignature =
  '2MTZ5KAvVnJENW7hMX9AenMasoVuYQhi1RYEQcGrY6zQWoHAMVv6ZQKbMfzznBf39B7iiKG2U1TMfpfygzDW8yxqp7XfSq6EWsMaN3C26JUPLmD3JSdSC9PgX81x1nMz6RqRFpZwtH9J8ZBNaTaiHbYQprgH69i9Qjj6Y4SPkWMZrEN'
assert.equal(
  buildHomeV2ChainReadPath('FETCH_BLOCK', { height: 1_000_000 }),
  '/blocks/byheight/1000000',
)
assert.equal(
  buildHomeV2ChainReadPath('FETCH_BLOCK', {
    includeOnlineSignatures: false,
    signature: blockSignature,
  }),
  `/blocks/signature/${blockSignature}?includeOnlineSignatures=false`,
)
// Hub silently prefers signature when both are given and hangs on neither;
// Home requires exactly one selector.
assert.throws(
  () => buildHomeV2ChainReadPath('FETCH_BLOCK', {}),
  /exactly one of signature or height/,
)
assert.throws(
  () => buildHomeV2ChainReadPath('FETCH_BLOCK', { height: 5, signature: blockSignature }),
  /exactly one of signature or height/,
)
assert.throws(
  () => buildHomeV2ChainReadPath('FETCH_BLOCK', { signature: 'l0IO' }),
  /Block signature is invalid/,
)
assert.equal(
  buildHomeV2ChainReadPath('FETCH_BLOCK_RANGE', { count: 10, height: 500, reverse: true }),
  '/blocks/range/500?count=10&reverse=true',
)
// Core has no server-side count cap; Home enforces one before the request.
assert.throws(
  () => buildHomeV2ChainReadPath('FETCH_BLOCK_RANGE', { count: 101, height: 500 }),
  /between 1 and 100/,
)
assert.throws(
  () => buildHomeV2ChainReadPath('FETCH_BLOCK_RANGE', { height: 500 }),
  /count must be/,
)
assert.equal(
  buildHomeV2ChainReadPath('SEARCH_TRANSACTIONS', {
    confirmationStatus: 'confirmed',
    limit: 5,
    reverse: true,
    txType: ['register_name', 'PAYMENT'],
  }),
  '/transactions/search?txType=REGISTER_NAME&txType=PAYMENT&confirmationStatus=CONFIRMED&limit=5&reverse=true',
)
assert.equal(
  buildHomeV2ChainReadPath('SEARCH_TRANSACTIONS', {
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
    confirmationStatus: 'BOTH',
  }),
  '/transactions/search?address=QH143K2qjVdn864NSY7aNESo88ao1ZnALH&confirmationStatus=BOTH',
)
// The forks default confirmationStatus differently (Qortal null, Qortium
// CONFIRMED); Home requires it explicitly.
assert.throws(
  () => buildHomeV2ChainReadPath('SEARCH_TRANSACTIONS', { limit: 5, txType: ['PAYMENT'] }),
  /confirmationStatus must be/,
)
// Core rejects unconstrained searches (needs txType, address, or limit <= 20).
assert.throws(
  () => buildHomeV2ChainReadPath('SEARCH_TRANSACTIONS', { confirmationStatus: 'CONFIRMED' }),
  /txType, address, or a limit of at most 20/,
)
assert.equal(
  buildHomeV2ChainReadPath('SEARCH_TRANSACTIONS', {
    confirmationStatus: 'UNCONFIRMED',
    limit: 20,
  }),
  '/transactions/search?confirmationStatus=UNCONFIRMED&limit=20',
)
assert.throws(
  () => buildHomeV2ChainReadPath('SEARCH_TRANSACTIONS', {
    confirmationStatus: 'CONFIRMED',
    txType: 'PAYMENT',
  }),
  /must be an array/,
)
assert.equal(buildHomeV2ChainReadPath('GET_DAY_SUMMARY', {}), '/admin/summary')
assert.equal(
  buildHomeV2ChainReadPath('GET_PRICE', { blockchain: 'litecoin', inverse: true, maxtrades: 5 }),
  '/crosschain/price/LITECOIN?maxtrades=5&inverse=true',
)
assert.throws(
  () => buildHomeV2ChainReadPath('GET_PRICE', { blockchain: 'MONERO' }),
  /supported Qortal foreign blockchain/,
)
assert.throws(
  () => buildHomeV2ChainReadPath('GET_PRICE', { blockchain: 'LITECOIN', maxtrades: 0 }),
  /maxtrades must be/,
)

assert.equal(
  buildHomeV2ChainReadPath('SEARCH_NAMES', {
    limit: 10,
    prefix: true,
    query: 'Ali ce/One',
  }),
  '/names/search?query=Ali+ce%2FOne&prefix=true&limit=10',
)
assert.equal(buildHomeV2ChainReadPath('LIST_GROUPS', {}), '/groups')
assert.equal(
  buildHomeV2ChainReadPath('LIST_GROUPS', { limit: 0, offset: 5, reverse: false }),
  '/groups?limit=0&offset=5&reverse=false',
)

// Group/chat-active read family (unblocks Chat 2.0 group browsing).
assert.equal(
  buildHomeV2ChainReadPath('SEARCH_GROUPS', { query: 'Chess Club' }),
  '/groups/search?query=Chess+Club',
)
assert.equal(
  buildHomeV2ChainReadPath('SEARCH_GROUPS', {
    limit: 10,
    prefixOnly: true,
    query: 'Chess',
    visibility: 'open',
  }),
  '/groups/search?query=Chess&visibility=OPEN&prefixOnly=true&limit=10',
)
assert.throws(
  () => buildHomeV2ChainReadPath('SEARCH_GROUPS', {}),
  /Group search query is required/,
)
assert.throws(
  () => buildHomeV2ChainReadPath('SEARCH_GROUPS', { query: 'Chess', visibility: 'PUBLIC' }),
  /visibility must be ALL, OPEN, or CLOSED/,
)
assert.throws(
  () => buildHomeV2ChainReadPath('SEARCH_GROUPS', { prefixOnly: 'true', query: 'Chess' }),
  /must be true or false/,
)
assert.throws(
  () => buildHomeV2ChainReadPath('SEARCH_GROUPS', { limit: 101, query: 'Chess' }),
  /between 0 and 100/,
)
assert.equal(buildHomeV2ChainReadPath('GET_GROUP', { groupId: 1 }), '/groups/1')
assert.throws(
  () => buildHomeV2ChainReadPath('GET_GROUP', { groupId: 0 }),
  /groupId must be a positive safe integer/,
)
assert.throws(
  () => buildHomeV2ChainReadPath('GET_GROUP', {}),
  /groupId must be a positive safe integer/,
)
assert.equal(
  buildHomeV2ChainReadPath('GET_ACCOUNT_GROUPS', {
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
  }),
  '/groups/member/QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
)
assert.equal(
  buildHomeV2ChainReadPath('GET_ACCOUNT_GROUPS', {
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
    adminOnly: true,
    ownerOnly: false,
  }),
  '/groups/member/QH143K2qjVdn864NSY7aNESo88ao1ZnALH?adminOnly=true&ownerOnly=false',
)
assert.throws(
  () => buildHomeV2ChainReadPath('GET_ACCOUNT_GROUPS', { address: 'not-an-address' }),
  /Address is invalid/,
)
assert.equal(
  buildHomeV2ChainReadPath('GET_GROUP_MEMBERS', { groupId: 4 }),
  '/groups/members/4',
)
assert.equal(
  buildHomeV2ChainReadPath('GET_GROUP_MEMBERS', { groupId: 4, limit: 20, onlyAdmins: true }),
  '/groups/members/4?onlyAdmins=true&limit=20',
)
assert.throws(
  () => buildHomeV2ChainReadPath('GET_GROUP_MEMBERS', { groupId: 4, limit: 101 }),
  /between 0 and 100/,
)
assert.equal(
  buildHomeV2ChainReadPath('GET_GROUP_JOIN_REQUESTS', { groupId: 7 }),
  '/groups/joinrequests/7',
)
assert.throws(
  () => buildHomeV2ChainReadPath('GET_GROUP_JOIN_REQUESTS', { groupId: -1 }),
  /groupId must be a positive safe integer/,
)
assert.equal(
  buildHomeV2ChainReadPath('GET_ACCOUNT_GROUP_JOIN_REQUESTS', {
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
  }),
  '/groups/joinrequests/address/QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
)
assert.throws(
  () => buildHomeV2ChainReadPath('GET_ACCOUNT_GROUP_JOIN_REQUESTS', {}),
  /Address is required/,
)
assert.equal(
  buildHomeV2ChainReadPath('GET_ADMIN_GROUP_JOIN_REQUESTS', {
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
  }),
  '/groups/joinrequests/admin/QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
)
assert.throws(
  () => buildHomeV2ChainReadPath('GET_ADMIN_GROUP_JOIN_REQUESTS', { address: 'not-an-address' }),
  /Address is invalid/,
)
assert.equal(
  buildHomeV2ChainReadPath('GET_ACTIVE_CHATS', {
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
  }),
  '/chat/active/QH143K2qjVdn864NSY7aNESo88ao1ZnALH?encoding=BASE64',
)
assert.equal(
  buildHomeV2ChainReadPath('GET_ACTIVE_CHATS', {
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
    encoding: 'base58',
    hasChatReference: true,
  }),
  '/chat/active/QH143K2qjVdn864NSY7aNESo88ao1ZnALH?encoding=BASE58&haschatreference=true',
)
assert.throws(
  () => buildHomeV2ChainReadPath('GET_ACTIVE_CHATS', {
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
    hasChatReference: 'true',
  }),
  /must be true or false/,
)

assert.equal(
  buildHomeV2ChainReadPath('GET_AT', { atAddress: 'AaVzcbeMZM7VQjaX5PSuTf2fQxUeMWLPbV' }),
  '/at/AaVzcbeMZM7VQjaX5PSuTf2fQxUeMWLPbV',
)
assert.equal(
  buildHomeV2ChainReadPath('GET_AT_DATA', { atAddress: 'AaVzcbeMZM7VQjaX5PSuTf2fQxUeMWLPbV' }),
  '/at/AaVzcbeMZM7VQjaX5PSuTf2fQxUeMWLPbV/data',
)
assert.equal(
  buildHomeV2ChainReadPath('LIST_ATS', {
    codeHash58: 'E3vfBDpuTdrwmzZzJgLbeDBRzeUHkJPNCvbbeMZM7VQ',
    isExecutable: true,
    limit: 100,
  }),
  '/at/byfunction/E3vfBDpuTdrwmzZzJgLbeDBRzeUHkJPNCvbbeMZM7VQ?isExecutable=true&limit=100',
)
// A name search without a query is a guaranteed Core INVALID_CRITERIA.
assert.throws(() => buildHomeV2ChainReadPath('SEARCH_NAMES', {}), /query is required/i)
// Hub's legacy `new Boolean("false")` coercion made string booleans truthy;
// Home rejects non-boolean flags outright.
assert.throws(
  () => buildHomeV2ChainReadPath('SEARCH_NAMES', { prefix: 'false', query: 'Alice' }),
  /must be true or false/,
)
assert.throws(
  () => buildHomeV2ChainReadPath('LIST_GROUPS', { reverse: 'true' }),
  /must be true or false/,
)
assert.throws(
  () => buildHomeV2ChainReadPath('LIST_GROUPS', { limit: -1 }),
  /non-negative safe integer/,
)
// Q addresses are not AT addresses.
assert.throws(
  () => buildHomeV2ChainReadPath('GET_AT', { atAddress: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH' }),
  /AT address is invalid/,
)
assert.throws(() => buildHomeV2ChainReadPath('GET_AT_DATA', {}), /AT address is required/)
assert.throws(
  () => buildHomeV2ChainReadPath('LIST_ATS', { codeHash58: 'not-base58!' }),
  /codeHash58/,
)
// Both cores reject byfunction pages above 100; fail before the request.
assert.throws(
  () => buildHomeV2ChainReadPath('LIST_ATS', {
    codeHash58: 'E3vfBDpuTdrwmzZzJgLbeDBRzeUHkJPNCvbbeMZM7VQ',
    limit: 101,
  }),
  /between 0 and 100/,
)

const chatSignature =
  '3H1KRfxLcJgxUAvBWKB4Y9x2K2sYKvzeXKrRGqYnDvxNQoNo8czEEs1uYYzMg2xKGz7Cx1xoY7YSasfF8LtcvRcE'
assert.equal(
  buildHomeV2ChainReadPath('SEARCH_CHAT_MESSAGES', { txGroupId: 0 }),
  '/chat/messages?txGroupId=0&encoding=BASE64',
)
assert.equal(
  buildHomeV2ChainReadPath('SEARCH_CHAT_MESSAGES', {
    after: 1_700_000_000_000,
    before: 1_800_000_000_000,
    encoding: 'base58',
    limit: 10,
    offset: 5,
    reverse: true,
    txGroupId: 5,
  }),
  '/chat/messages?txGroupId=5&before=1800000000000&after=1700000000000&limit=10&offset=5&reverse=true&encoding=BASE58',
)
assert.throws(
  () => buildHomeV2ChainReadPath('SEARCH_CHAT_MESSAGES', {}),
  /txGroupId is required/,
)
assert.throws(
  () => buildHomeV2ChainReadPath('SEARCH_CHAT_MESSAGES', { involving: 'QAbc', txGroupId: 0 }),
  /groups-only in this release/,
)
assert.throws(
  () => buildHomeV2ChainReadPath('SEARCH_CHAT_MESSAGES', { sender: 'QAbc', txGroupId: 0 }),
  /groups-only in this release/,
)
assert.throws(
  () => buildHomeV2ChainReadPath('SEARCH_CHAT_MESSAGES', { recipient: 'QAbc', txGroupId: 0 }),
  /groups-only in this release/,
)
assert.throws(
  () => buildHomeV2ChainReadPath('SEARCH_CHAT_MESSAGES', { before: 1, txGroupId: 0 }),
  /no earlier than 1500000000000/,
)
assert.throws(
  () => buildHomeV2ChainReadPath('SEARCH_CHAT_MESSAGES', { limit: 101, txGroupId: 0 }),
  /between 0 and 100/,
)
assert.equal(
  buildHomeV2ChainReadPath('GET_CHAT_MESSAGE', { signature: chatSignature }),
  `/chat/message/${chatSignature}?encoding=BASE64`,
)
assert.equal(
  buildHomeV2ChainReadPath('GET_CHAT_MESSAGE', { encoding: 'BASE58', signature: chatSignature }),
  `/chat/message/${chatSignature}?encoding=BASE58`,
)
assert.throws(
  () => buildHomeV2ChainReadPath('GET_CHAT_MESSAGE', { signature: 'not-base58!' }),
  /signature is invalid/,
)
assert.throws(
  () => buildHomeV2ChainReadPath('GET_CHAT_MESSAGE', { signature: chatSignature, encoding: 'HEX' }),
  /encoding must be BASE58 or BASE64/,
)

assert.equal(
  buildHomeV2AssetReadPath('GET_ASSET_INFO', { assetName: 'MY ASSET/ONE' }),
  '/assets/info?assetName=MY%20ASSET%2FONE',
)
assert.equal(
  buildHomeV2AssetReadPath('GET_ASSET_BALANCES', {
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
    assetId: '5',
    excludeZero: false,
    limit: 0,
  }),
  '/assets/balances?address=QH143K2qjVdn864NSY7aNESo88ao1ZnALH&assetid=5&excludeZero=false&limit=0',
)
assert.equal(
  buildHomeV2AssetReadPath('GET_ASSET_TRANSFERS', { assetId: 5, limit: 20, reverse: true }),
  '/assets/transfers/5?limit=20&reverse=true',
)
assert.throws(
  () => buildHomeV2AssetReadPath('GET_ASSET_BALANCES', {
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
    assetId: 'invalid',
  }),
  /non-negative safe integer/,
)

function readRepoSource(...candidates: string[]) {
  const url = candidates.map((candidate) => new URL(candidate, import.meta.url)).find((each) => existsSync(each))
  assert.ok(url, `source not found: tried ${candidates.join(', ')}`)
  return readFileSync(url, 'utf8')
}

for (const [name, source] of [
  ['electron/home-v2-app-bridge.ts', readRepoSource('../electron/home-v2-app-bridge.ts', './home-v2-app-bridge.ts')],
  ['src/home-v2-live/node-client.ts', readRepoSource('../src/home-v2-live/node-client.ts', '../src/home-v2-live/node-client.js')],
] as const) {
  assert(
    source.includes('buildHomeV2AssetReadPath(action,'),
    `${name} must dispatch asset reads through the shared Home v2 builder.`,
  )
  assert(
    source.includes('buildHomeV2ChainReadPath(action,'),
    `${name} must dispatch chain reads through the shared Home v2 builder.`,
  )
  assert(
    source.includes('fetchHomeV2AvatarAction('),
    `${name} must dispatch account and group avatars through the shared dual-chain action.`,
  )
  assert(
    source.includes("throw new Error('AT not found.')"),
    `${name} must normalize valid-but-absent AT reads to the documented error.`,
  )
}

assert.equal(
  buildHomeV2ResourcePath('FETCH_QDN_RESOURCE', {
    async: true,
    identifier: 'q-support-post-v1-example',
    name: 'Help',
    path: 'post.json',
    service: 'DOCUMENT',
  }),
  '/arbitrary/DOCUMENT/Help/q-support-post-v1-example?filepath=post.json&async=true',
)
assert.equal(
  buildHomeV2ResourcePath('GET_QDN_RESOURCE_STATUS', {
    build: false,
    name: 'Q-Tube',
    service: 'APP',
  }),
  '/arbitrary/resource/status/APP/Q-Tube?build=false',
)
assert.equal(
  buildHomeV2ResourcePath('SEARCH_QDN_RESOURCES', {
    exactMatchNames: true,
    limit: 25,
    names: ['Help', 'Trust'],
    service: 'DOCUMENT',
  }),
  '/arbitrary/resources/search?exactmatchnames=true&limit=25&name=Help&name=Trust&service=DOCUMENT',
)
assert.equal(
  buildHomeV2ResourceRenderPath(
    { name: 'Trust', path: 'profile/Qabc?view=compact', service: 'APP' },
    { accent: 'orange', language: 'en', textSize: 'medium', theme: 'dark', ui: 'classic' },
  ),
  '/render/APP/Trust/profile/Qabc?view=compact&theme=dark&lang=en&textSize=medium&accent=orange&uiStyle=classic',
)

assert.equal(
  buildHomeV2NamePath('GET_ACCOUNT_NAMES', {
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
  }),
  '/names/address/QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
)
assert.equal(normalizeHomeV2OpenAddress({ address: 'qdn://APP/Trust' }), 'qdn://APP/Trust')
assert.equal(normalizeHomeV2OpenAddress({ qdnUrl: 'qortal://APP/Q-Tube' }), 'qortal://APP/Q-Tube')
assert.equal(normalizeHomeV2ResponseMaxBytes(undefined), 2 * 1024 * 1024)
assert.equal(normalizeHomeV2ResponseMaxBytes(5 * 1024 * 1024), 5 * 1024 * 1024)
assert.throws(
  () => normalizeHomeV2ResponseMaxBytes(5 * 1024 * 1024 + 1),
  /between 1 byte and 5 MiB/,
)
assert.throws(
  () => normalizeHomeV2OpenAddress({ address: 'https://example.com' }),
  /only accepts/,
)
assert.throws(() => normalizeHomeV2ReadPath('/admin/stop'), /outside Home v2 read-only scope/)
assert.equal(normalizeHomeV2ReadPath('/names/Alice?limit=1'), '/names/Alice?limit=1')
assert.throws(
  () => buildHomeV2ResourcePath('FETCH_QDN_RESOURCE', {
    name: 'Alice',
    service: '../addresses',
  }),
  /service is invalid/,
)
assert.throws(
  () => buildHomeV2ResourcePath('FETCH_QDN_RESOURCE', {
    name: '..',
    service: 'DOCUMENT',
  }),
  /path segments/,
)
assert.throws(
  () => buildHomeV2ResourcePath('FETCH_QDN_RESOURCE', {
    name: 'Alice',
    path: '../admin/status',
    service: 'DOCUMENT',
  }),
  /file paths/,
)
for (const protocol of ['qdnRequest', 'qortalRequest'] as const) {
  const actions = getHomeV2AppActions(protocol)
  for (const action of [
    'GET_QDN_RESOURCE_STREAM_URL',
    'OPEN_QDN_RESOURCE_VIEWER',
    'SAVE_QDN_RESOURCE',
    'PUBLISH_CHAT_ATTACHMENT',
    'GET_CHAT_ATTACHMENT_STREAM_URL',
    'OPEN_CHAT_ATTACHMENT_VIEWER',
    'SAVE_CHAT_ATTACHMENT',
  ]) {
    assert.equal(actions.includes(action), true, `${protocol} must advertise ${action}.`)
  }
}

// Minting (R3-11). All four ship on both protocols so one app build works on
// either chain; the node-side half is gated at the handler, not the catalogue.
for (const protocol of ['qdnRequest', 'qortalRequest'] as const) {
  const actions = getHomeV2AppActions(protocol)
  for (const action of [
    'GET_MINTING_STATUS',
    'LIST_MINTING_ACCOUNTS',
    'START_MINTING',
    'REMOVE_MINTING_ACCOUNT',
  ]) {
    assert.equal(actions.includes(action), true, `${protocol} must advertise ${action}.`)
  }
}
// LIST_MINTING_ACCOUNTS exists so no app ever needs the raw admin route, and
// the read allowlist must stay closed against it.
assert.throws(
  () => normalizeHomeV2ReadPath('/admin/mintingaccounts'),
  /outside Home v2 read-only scope/,
)
assert.throws(
  () => normalizeHomeV2ReadPath('/admin/mintingaccounts?limit=1'),
  /outside Home v2 read-only scope/,
)

// The two minting reads are promptless; the two writes always prompt.
for (const action of ['GET_MINTING_STATUS', 'LIST_MINTING_ACCOUNTS']) {
  assert.equal(
    (HOME_V2_PERMISSIONLESS_ACTIONS as readonly string[]).includes(action),
    true,
    `${action} must be permissionless.`,
  )
  assert.equal(isHomeV2PermissionlessAction(action), true)
}
for (const action of ['START_MINTING', 'REMOVE_MINTING_ACCOUNT']) {
  assert.equal(
    (HOME_V2_PERMISSIONLESS_ACTIONS as readonly string[]).includes(action),
    false,
    `${action} must always prompt.`,
  )
  assert.equal(isHomeV2PermissionlessAction(action), false)
  assert.equal(isHomeV2ChatSendAction(action), false, `${action} must not be a grantable chat send.`)
  // Exact families: approving one minting write must never satisfy the other.
  assert.equal(homeV2PermissionGrantFamily(action), action)
}
assert.notEqual(
  homeV2PermissionGrantFamily('START_MINTING'),
  homeV2PermissionGrantFamily('REMOVE_MINTING_ACCOUNT'),
)

// ---------------------------------------------------------------------------
// R4-8 parity re-adds: GET_ACCOUNT_DATA/GET_BALANCE on both protocols,
// /resource-ratings reads, OPEN_CURRENT_TAB, and the two legacy viewer aliases.
// ---------------------------------------------------------------------------

// Both handlers derive their path from `network`, so the qdnRequest half was a
// catalogue omission rather than a missing implementation. Pinned on both
// protocols so it cannot silently become Qortal-only again.
for (const action of ['GET_ACCOUNT_DATA', 'GET_BALANCE']) {
  assert.equal(qdnActions.includes(action), true, `qdnRequest must advertise ${action}.`)
  assert.equal(qortalActions.includes(action), true, `qortalRequest must advertise ${action}.`)
}

// Core's public resource ratings: three GET routes plus a POST /rate that the
// GET/HEAD method allowlist already makes unreachable through this passthrough.
assert.equal(
  normalizeHomeV2ReadPath('/resource-ratings/summary?service=APP&name=Trust'),
  '/resource-ratings/summary?service=APP&name=Trust',
)
assert.equal(normalizeHomeV2ReadPath('/resource-ratings'), '/resource-ratings')
assert.equal(normalizeHomeV2ReadMethod('GET'), 'GET')
assert.throws(() => normalizeHomeV2ReadMethod('POST'), /only use GET or HEAD/)
// The prefix must not open neighbouring paths that merely start with the same
// characters — normalizeHomeV2ReadPath matches on segment boundaries.
assert.throws(
  () => normalizeHomeV2ReadPath('/resource-ratings-admin'),
  /outside Home v2 read-only scope/,
)

// OPEN_CURRENT_TAB ships on both protocols, next to OPEN_NEW_TAB.
for (const action of ['OPEN_CURRENT_TAB', 'OPEN_NEW_TAB']) {
  assert.equal(qdnActions.includes(action), true, `qdnRequest must advertise ${action}.`)
  assert.equal(qortalActions.includes(action), true, `qortalRequest must advertise ${action}.`)
}
// Both open actions share one validator, so their accepted scheme set cannot
// drift apart. Home 2 uses qdn:// / qortal:// / home:// — deliberately NOT
// Home 1.x's core://, which has no v2 meaning.
assert.equal(normalizeHomeV2OpenAddress({ address: 'home://settings' }), 'home://settings')
assert.throws(() => normalizeHomeV2OpenAddress({ address: 'core://settings' }), /only accepts/)
assert.throws(() => normalizeHomeV2OpenAddress({}), /Address is required/)

// OPEN_CURRENT_TAB's extra rules are enforced in the TRUSTED HOST, not only in
// the shell: the desktop transport is fire-and-forget, so a refusal made in
// the renderer alone is discarded and the app is told `true` for a replacement
// that never happened.
assert.equal(
  normalizeHomeV2ReplaceTabAddress({ address: 'qdn://APP/Alice/apps' }),
  'qdn://APP/Alice/apps',
)
assert.throws(
  () => normalizeHomeV2ReplaceTabAddress({ address: 'qdn://APP/Alice' }),
  /needs an explicit resource identifier/,
)
// A Home page parses as an address but can never replace an app tab, so it is
// refused here too rather than accepted and then silently dropped by the shell.
assert.throws(
  () => normalizeHomeV2ReplaceTabAddress({ address: 'home://settings' }),
  /only replace a tab with a qdn:\/\/ or qortal:\/\/ app resource/,
)
// It still inherits the shared validator's scheme and presence rules.
assert.throws(
  () => normalizeHomeV2ReplaceTabAddress({ address: 'core://settings' }),
  /only accepts/,
)
assert.throws(() => normalizeHomeV2ReplaceTabAddress({}), /Address is required/)
// A query identifier is not a path identifier: `?identifier=` does not make a
// bare name unambiguous, and accepting it here would disagree with the shell.
assert.throws(
  () => normalizeHomeV2ReplaceTabAddress({ address: 'qdn://APP/Alice?identifier=apps' }),
  /needs an explicit resource identifier/,
)

// homeV2AppAddressNamesIdentifier is a hand-written twin of
// identifierWasExplicit in src/v2/resource-location.ts, which electron cannot
// import. Both halves are pinned to ONE shared fixture so they can never drift
// apart on what "explicit" means; the src half runs the same file, in
// src/v2/home-v2-foundation.test.tsx.
{
  const vectors = JSON.parse(
    readRepoSource('../src/shared-fixtures/app-address-explicit-identifier-vectors.json'),
  ) as readonly { description: string; address: string; explicitIdentifier: boolean }[]
  assert.ok(vectors.length >= 10, 'the shared identifier fixture must stay meaningful')
  for (const vector of vectors) {
    assert.equal(
      homeV2AppAddressNamesIdentifier(vector.address),
      vector.explicitIdentifier,
      `${vector.address} — ${vector.description}`,
    )
  }
}

// The legacy viewer actions are advertised, but they are ALIASES: each one
// canonicalizes to OPEN_QDN_RESOURCE_VIEWER before dispatch, so neither
// becomes a separate capability with its own grant identity.
for (const action of HOME_V2_RESOURCE_VIEWER_ALIASES) {
  assert.equal(qdnActions.includes(action), true, `qdnRequest must advertise ${action}.`)
  assert.equal(qortalActions.includes(action), true, `qortalRequest must advertise ${action}.`)
}
assert.deepEqual(
  [...HOME_V2_RESOURCE_VIEWER_ALIASES],
  ['OPEN_QDN_DOCUMENT_VIEWER', 'OPEN_QDN_MEDIA_PLAYER'],
)
assert.equal(
  resolveHomeV2AppAlias('OPEN_QDN_MEDIA_PLAYER', { name: 'Alice', service: 'VIDEO' }).action,
  'OPEN_QDN_RESOURCE_VIEWER',
)
assert.equal(
  resolveHomeV2AppAlias('OPEN_QDN_DOCUMENT_VIEWER', { name: 'Alice', service: 'DOCUMENT' }).action,
  'OPEN_QDN_RESOURCE_VIEWER',
)
// Service matching is case- and whitespace-insensitive, and reads a nested
// `payload` the same way the viewer contract's getRequestValue does.
assert.equal(
  resolveHomeV2AppAlias('OPEN_QDN_MEDIA_PLAYER', {
    payload: { name: 'Alice', service: ' audio ' },
  }).action,
  'OPEN_QDN_RESOURCE_VIEWER',
)
// Each alias keeps the NARROWER service scope its Home 1.x handler enforced:
// an alias must never reach a resource the action it replaced refused.
assert.throws(
  () => resolveHomeV2AppAlias('OPEN_QDN_MEDIA_PLAYER', { name: 'Alice', service: 'DOCUMENT' }).action,
  /OPEN_QDN_MEDIA_PLAYER only supports AUDIO, PODCAST, VIDEO, VOICE resources/,
)
assert.throws(
  () => resolveHomeV2AppAlias('OPEN_QDN_DOCUMENT_VIEWER', { name: 'Alice', service: 'VIDEO' }).action,
  /OPEN_QDN_DOCUMENT_VIEWER only supports ATTACHMENT, DOCUMENT, FILE, FILES resources/,
)
// APP/WEBSITE/GAME stay out through both aliases too: neither scope contains
// them, so an alias can never be used to nest browser content in the viewer.
for (const service of ['APP', 'WEBSITE', 'GAME']) {
  for (const action of HOME_V2_RESOURCE_VIEWER_ALIASES) {
    assert.throws(
      () => resolveHomeV2AppAlias(action, { name: 'Alice', service }),
      /only supports/,
      `${action} must refuse ${service}.`,
    )
  }
}
// A missing or non-string service is rejected before the alias resolves.
assert.throws(
  () => resolveHomeV2AppAlias('OPEN_QDN_MEDIA_PLAYER', { name: 'Alice' }).action,
  /QDN resource service is required/,
)
assert.throws(
  () => resolveHomeV2AppAlias('OPEN_QDN_DOCUMENT_VIEWER', { name: 'Alice', service: 42 }).action,
  /QDN resource service is required/,
)
// Every non-alias action passes through untouched, including the canonical one.
for (const action of [
  'OPEN_QDN_RESOURCE_VIEWER',
  'OPEN_CURRENT_TAB',
  'OPEN_NEW_TAB',
  'GET_BALANCE',
  'SEND_CHAT_MESSAGE',
]) {
  const resolved = resolveHomeV2AppAlias(action, { service: 'APP' })
  assert.equal(resolved.action, action)
  // A non-alias must pass its request through untouched, not merely keep its
  // name: the resolver is the one place that rewrites request shape.
  assert.deepEqual(resolved.request, { service: 'APP' })
}

// --- Qortal-compatibility aliases -----------------------------------------
// Each maps onto a capability Home already implements, adding none of its own.
assert.deepEqual([...HOME_V2_QORTAL_COMPAT_ALIASES], ['LINK_TO_QDN_RESOURCE', 'SAVE_FILE'])

// SAVE_FILE is SAVE_QDN_RESOURCE with the coordinate nested under `location`.
// It takes a QDN COORDINATE, not a blob (verified against Qortal's Q-Sandbox).
assert.deepEqual(
  resolveHomeV2AppAlias('SAVE_FILE', {
    filename: 'notes.txt',
    location: { identifier: 'default', name: 'Alice', service: 'DOCUMENT' },
  }),
  {
    action: 'SAVE_QDN_RESOURCE',
    request: { filename: 'notes.txt', identifier: 'default', name: 'Alice', service: 'DOCUMENT' },
  },
)
// The coordinate is built from `location` ALONE. A top-level name or service
// alongside it must not be able to disagree with what actually gets saved.
assert.deepEqual(
  resolveHomeV2AppAlias('SAVE_FILE', {
    location: { name: 'Alice', service: 'DOCUMENT' },
    name: 'Mallory',
    service: 'WEBSITE',
  }).request,
  { name: 'Alice', service: 'DOCUMENT' },
)
assert.throws(
  () => resolveHomeV2AppAlias('SAVE_FILE', { filename: 'notes.txt' }),
  /requires a location/,
  'SAVE_FILE without a location refuses rather than saving something unspecified',
)

// LINK_TO_QDN_RESOURCE is OPEN_NEW_TAB with the coordinate as fields; Qortal's
// own docs say it works "similar to the OPEN_NEW_TAB qortalRequest".
assert.deepEqual(
  resolveHomeV2AppAlias('LINK_TO_QDN_RESOURCE', {
    identifier: 'Apps',
    name: 'Alice',
    service: 'app',
  }),
  { action: 'OPEN_NEW_TAB', request: { address: 'qdn://APP/Alice/Apps' } },
)
assert.equal(
  resolveHomeV2AppAlias('LINK_TO_QDN_RESOURCE', {
    identifier: 'Apps',
    name: 'Alice',
    path: '/index.html',
    service: 'APP',
  }).request.address,
  'qdn://APP/Alice/Apps/index.html',
  'a leading slash on the path does not double up',
)
for (const missing of [{ name: 'Alice' }, { service: 'APP' }]) {
  assert.throws(
    () => resolveHomeV2AppAlias('LINK_TO_QDN_RESOURCE', missing),
    /LINK_TO_QDN_RESOURCE requires/,
  )
}
// The address is built by joining on '/', so a component containing one would
// silently name a DIFFERENT coordinate than the app asked for. Names and
// services cannot contain a slash, so refusing is honest.
assert.throws(
  () => resolveHomeV2AppAlias('LINK_TO_QDN_RESOURCE', { name: 'Alice/Bob', service: 'APP' }),
  /name cannot contain a slash/,
)
assert.throws(
  () => resolveHomeV2AppAlias('LINK_TO_QDN_RESOURCE', {
    identifier: 'a/b',
    name: 'Alice',
    service: 'APP',
  }),
  /identifier cannot contain a slash/,
)
for (const name of ['.', '..']) {
  assert.throws(
    () => resolveHomeV2AppAlias('LINK_TO_QDN_RESOURCE', { name, service: 'APP' }),
    /cannot be a dot segment/,
  )
}
// And a traversal in the path would resolve above the resource root —
// including PERCENT-ENCODED forms, because URL normalization decodes them
// before the address is resolved.
for (const path of ['../secrets', 'a/../../b', './x', '%2e%2e/Mallory', '/%2e%2e/%2e%2e/Mallory']) {
  assert.throws(
    () => resolveHomeV2AppAlias('LINK_TO_QDN_RESOURCE', { name: 'Alice', path, service: 'APP' }),
    /path cannot contain dot segments/,
    `path ${path} must not escape the coordinate`,
  )
}
for (const path of ['a?b', 'a#b', '%2e%2e%2f..']) {
  assert.throws(
    () => resolveHomeV2AppAlias('LINK_TO_QDN_RESOURCE', { name: 'Alice', path, service: 'APP' }),
    /cannot contain a query or fragment|dot segments/,
  )
}

// THE CHAIN IS THE CALLER'S. `qdn://` means Qortium and `qortal://` means
// Qortal, so resolving a qortalRequest to a qdn:// address would hand a Qortal
// app the same-named QORTIUM resource — a collision an attacker could publish,
// opened without a prompt. The invoked global fixes the network everywhere
// else in this bridge; it must here too.
assert.equal(
  resolveHomeV2AppAlias(
    'LINK_TO_QDN_RESOURCE',
    { identifier: 'Wallet', name: 'Wallet', service: 'APP' },
    'qortalRequest',
  ).request.address,
  'qortal://APP/Wallet/Wallet',
)
assert.equal(
  resolveHomeV2AppAlias(
    'LINK_TO_QDN_RESOURCE',
    { identifier: 'Wallet', name: 'Wallet', service: 'APP' },
    'qdnRequest',
  ).request.address,
  'qdn://APP/Wallet/Wallet',
)

// Qortal's SAVE_FILE also has a documented BLOB form. Writing app-supplied
// bytes to disk is a new capability, not an alias, so it is refused BY NAME
// rather than reported as a missing location.
assert.throws(
  () => resolveHomeV2AppAlias('SAVE_FILE', { blob: {}, filename: 'notes.txt' }),
  /SAVE_FILE with a blob is not supported/,
)

// Prompt classification. None of the five re-adds may land in a prompt family
// by accident: the four reads are plain public reads, and OPEN_CURRENT_TAB is
// matched to OPEN_NEW_TAB, which is unprompted because it only drives Home's
// own navigation. The aliases inherit OPEN_QDN_RESOURCE_VIEWER's posture by
// becoming it before any permission work happens.
for (const action of [
  'GET_ACCOUNT_DATA',
  'GET_BALANCE',
  'OPEN_CURRENT_TAB',
  'OPEN_QDN_MEDIA_PLAYER',
  'OPEN_QDN_DOCUMENT_VIEWER',
]) {
  assert.equal(
    isHomeV2AccountReadAction(action),
    false,
    `${action} must not join the account.read grant family.`,
  )
  assert.equal(isHomeV2ChatSendAction(action), false, `${action} must not be a grantable chat send.`)
  assert.equal(
    (HOME_V2_PERMISSIONLESS_ACTIONS as readonly string[]).includes(action),
    false,
    `${action} must not be listed as a permissionless account read.`,
  )
  // Its own family, i.e. it shares no approval with anything else.
  assert.equal(homeV2PermissionGrantFamily(action), action)
}
// OPEN_CURRENT_TAB is classified exactly like its reference, OPEN_NEW_TAB.
for (const action of ['OPEN_CURRENT_TAB', 'OPEN_NEW_TAB']) {
  assert.equal(isHomeV2AccountReadAction(action), false)
  assert.equal(isHomeV2PermissionlessAction(action), false)
  assert.equal(homeV2PermissionGrantFamily(action), action)
}

// Source pins.
const openTabBridgeSource = readRepoSource(
  '../electron/home-v2-app-bridge.ts',
  './home-v2-app-bridge.ts',
)
const openTabShellSource = readRepoSource(
  '../src/home-v2-live/HomeV2LiveApp.tsx',
  '../src/home-v2-live/HomeV2LiveApp.js',
)
const openTabPortableSource = readRepoSource(
  '../src/home-v2-live/node-client.ts',
  '../src/home-v2-live/node-client.js',
)
// The desktop handler must use the replace-tab validator, which layers the
// explicit-identifier and app-resource-only rules over the shared scheme test
// so bare names and internal pages fail the bridge call itself.
assert(
  /action === 'OPEN_CURRENT_TAB'[\s\S]{0,900}normalizeHomeV2ReplaceTabAddress\(requestValue\)/.test(
    openTabBridgeSource,
  ),
  'OPEN_CURRENT_TAB must validate its address with normalizeHomeV2ReplaceTabAddress.',
)
// The tab it acts on, and the app it is compared against, must both come from
// the trusted view context — never from the request. An app may not navigate a
// tab it does not own, nor claim which app was in it.
assert(
  /action === 'OPEN_CURRENT_TAB'[\s\S]{0,1500}home-v2-app:open-address-in-tab'[\s\S]{0,900}tabId: context\.tabId/.test(
    openTabBridgeSource,
  ),
  'OPEN_CURRENT_TAB must bind to context.tabId.',
)
assert(
  /action === 'OPEN_CURRENT_TAB'[\s\S]{0,1500}home-v2-app:open-address-in-tab'[\s\S]{0,900}fromResourceLocation: context\.resourceUrl/.test(
    openTabBridgeSource,
  ),
  'OPEN_CURRENT_TAB must compare against context.resourceUrl, the trusted app identity.',
)
assert(
  !/action === 'OPEN_CURRENT_TAB'[\s\S]{0,2400}requestValue\.(tabId|fromResourceLocation|resourceUrl)/.test(
    openTabBridgeSource,
  ),
  'OPEN_CURRENT_TAB must never read a tab id or source app out of the request.',
)
// The stricter replacement validator, not the plain open one: enforcing the
// app-resource and explicit-identifier rules only in the renderer would let the
// fire-and-forget desktop transport answer `true` to a refused replacement.
assert(
  /action === 'OPEN_CURRENT_TAB'[\s\S]{0,600}normalizeHomeV2ReplaceTabAddress\(requestValue\)/.test(
    openTabBridgeSource,
  ),
  'the desktop bridge must validate OPEN_CURRENT_TAB with normalizeHomeV2ReplaceTabAddress.',
)
assert(
  openTabPortableSource.includes('normalizeHomeV2ReplaceTabAddress(request)'),
  'the portable host must validate OPEN_CURRENT_TAB with normalizeHomeV2ReplaceTabAddress.',
)
// The renderer must not treat the compare-and-swap as optional: a replacement
// dispatch always carries the trusted source location the reducer checks.
assert(
  openTabShellSource.includes('fromResourceLocation: target.fromResourceLocation'),
  'the shell must thread the trusted source resource location into replace-tab-app.',
)
// A replacement drops the outgoing app's tab-bound grants. 'navigation-changed'
// would deliberately preserve account.read, which is wrong once the tab hosts a
// different app.
assert(
  openTabShellSource.includes("invalidateAndroidRuntime('app-replaced'") &&
    openTabShellSource.includes("kind: 'app-replaced'"),
  'replacing a tab must raise the app-replaced invalidation on both hosts.',
)
assert(
  openTabPortableSource.includes("action === 'OPEN_CURRENT_TAB'") &&
    openTabPortableSource.includes("openIn: 'current-tab'"),
  'The portable host must answer OPEN_CURRENT_TAB with a current-tab descriptor.',
)
assert(
  openTabShellSource.includes("type: 'replace-tab-app'") &&
    openTabShellSource.includes('onOpenAddressInTab'),
  'The shell must replace a tab through the replace-tab-app product action.',
)
// Every bridge entry point must collapse aliases, or one host would treat a
// legacy action as unimplemented while another served it.
for (const [name, source] of [
  ['electron/home-v2-app-bridge.ts', openTabBridgeSource],
  ['src/home-v2-live/node-client.ts', openTabPortableSource],
  ['src/home-v2-live/HomeV2LiveApp.tsx', openTabShellSource],
] as const) {
  assert(
    source.includes('resolveHomeV2AppAlias('),
    `${name} must canonicalize compatibility aliases at its bridge entry point.`,
  )
}

// ---- The node-local list family (Home 2.1 restoration wave) ----

// Advertised on qdnRequest only. The pinned Qortal v3 list actions
// (GET_LIST_ITEMS, ADD_LIST_ITEMS, DELETE_LIST_ITEM) stay deferred: every
// /lists route needs the node's administrative API key, and Home holds one
// only for the Qortium Core it runs itself — an advertised action that can
// never succeed would be worse than the ledger's honest "deferred".
for (const action of ['GET_ALL_LISTS', 'GET_LIST', 'ADD_TO_LIST', 'REMOVE_FROM_LIST']) {
  assert.equal(qdnActions.includes(action), true, `qdnRequest should advertise ${action}`)
  assert.equal(qortalActions.includes(action), false, `qortalRequest must not advertise ${action}`)
}

// List names: the 1.x rule — start with a letter, then letters/digits/
// underscore, at most 120 characters, surrounding whitespace trimmed.
assert.equal(normalizeHomeV2ListName({ listName: 'followedNames' }), 'followedNames')
assert.equal(normalizeHomeV2ListName({ listName: '  padded_1  ' }), 'padded_1')
assert.equal(normalizeHomeV2ListName({ listName: 'x'.repeat(120) }), 'x'.repeat(120))
for (const bad of [undefined, null, 42, '', '1digitfirst', '_underscorefirst', 'has space', 'has-hyphen', 'dot.name', 'sla/sh', 'x'.repeat(121)]) {
  assert.throws(() => normalizeHomeV2ListName({ listName: bad }), `list name ${String(bad).slice(0, 20)} must be refused`)
}

// Items: non-empty array of non-empty strings, each trimmed. Stricter than
// 1.x on purpose — 1.x silently DROPPED blank and non-string entries and
// half-applied the batch; Home 2 refuses the whole request instead.
assert.deepEqual([...normalizeHomeV2ListItems({ items: ['alice', ' bob '] })], ['alice', 'bob'])
for (const bad of [undefined, null, 'alice', [], [''], ['   '], ['alice', 42], ['alice', null], ['alice', '']]) {
  assert.throws(() => normalizeHomeV2ListItems({ items: bad }))
}

// Paths and body match what Core's /lists endpoints take.
assert.equal(buildHomeV2ListPath('followedNames'), '/lists/followedNames')
assert.equal(buildHomeV2ListWriteBody(['a', 'b']), '{"items":["a","b"]}')

// The 1.x approval-display rule: a batch whose JSON serialization cannot be
// shown in full (4000 characters) is refused before any prompt is raised.
assert.equal(serializeHomeV2ListItemsForApproval(['a']), '["a"]')
assert.throws(() => serializeHomeV2ListItemsForApproval(['x'.repeat(4001)]), /4000/)
// The displayed form is escaped to printable ASCII: a bidi override, a
// Unicode separator, or any character past DEL becomes a visible \uXXXX
// escape, so nothing invisible can make the prompt read differently from what
// Core receives.
assert.equal(
  serializeHomeV2ListItemsForApproval([`a${String.fromCharCode(0x202e)}b`, `line${String.fromCharCode(0x2028)}two`]),
  '["a\\u202eb","line\\u2028two"]',
)
assert.equal(/^[\u0020-\u007e]*$/.test(serializeHomeV2ListItemsForApproval([`\u00fcn${String.fromCharCode(0x85)}x`])), true)

// GET_LIST 1.x parity: 404 answers as the empty list; a real answer passes
// through untouched.
assert.deepEqual(normalizeHomeV2ListReadResult(404, null), [])
assert.deepEqual(normalizeHomeV2ListReadResult(200, ['a']), ['a'])

// Every helper in the desktop bridge that can carry the node's administrative
// API key (or, worse, account key material) must refuse HTTP redirects:
// fetch preserves X-API-KEY across origins — it is not an Authorization
// header — and 307/308 re-send the method and body, so a redirecting
// responder could carry the credential to a host no gate ever vetted.
// Pinned per function so a new key-bearing helper cannot quietly ship
// without the refusal. (List-family security review, 2026-08-26.)
for (const helper of [
  'async function postHomeV2ChatText(',
  'async function readHomeV2ChatJson(',
  'async function deleteHomeV2MintingKey(',
  'async function requestHomeV2ListText(',
  'async function readHomeV2ListJson(',
  'async function readHomeV2PrivateAttachmentCiphertext(',
]) {
  const start = openTabBridgeSource.indexOf(helper)
  assert.notEqual(start, -1, `${helper} must exist in home-v2-app-bridge.ts`)
  const body = openTabBridgeSource.slice(start, openTabBridgeSource.indexOf('\nasync function', start + 1))
  assert.equal(
    body.includes("redirect: 'error'"),
    true,
    `${helper} sends X-API-KEY and must refuse redirects`,
  )
}

// ---- The poll write family (Home 2.1 restoration wave) ----

// qdnRequest only. The pinned Qortal v3 poll forms are a genuinely different
// legacy contract (pollName target, ZERO-based index, paid fee and a last
// reference, no builder) and stay deferred rather than mistranslated.
for (const action of ['CREATE_POLL', 'UPDATE_POLL', 'VOTE_ON_POLL']) {
  assert.equal(qdnActions.includes(action), true, `qdnRequest should advertise ${action}`)
  assert.equal(qortalActions.includes(action), false, `qortalRequest must not advertise ${action}`)
}

const SELECTED = 'Qdemo1111111111111111111111111111'

// CREATE_POLL — 1.x aliases, Core limits, owner default.
{
  const created = normalizeHomeV2CreatePollRequest(
    { description: ' What snack? ', options: 'Yes, No', pollName: ' Snacks ' },
    SELECTED,
  )
  assert.equal(created.pollName, 'Snacks')
  assert.equal(created.description, 'What snack?')
  assert.deepEqual([...created.pollOptions], ['Yes', 'No'])
  assert.equal(created.owner, SELECTED)
  assert.equal(created.startTime, undefined)
  const futureStart = Date.now() + 60_000
  const futureEnd = futureStart + 60_000
  const timed = normalizeHomeV2CreatePollRequest(
    { endTime: String(futureEnd), pollName: 'Timed', pollOptions: ['A', { optionName: 'B' }], pollStartTime: futureStart },
    SELECTED,
  )
  assert.equal(timed.startTime, futureStart)
  assert.equal(timed.endTime, futureEnd)
}
for (const bad of [
  { pollOptions: ['A', 'B'] },                                    // missing name
  { pollName: 'ab', pollOptions: ['A', 'B'] },                    // < 3 bytes
  { pollName: 'x'.repeat(401), pollOptions: ['A', 'B'] },         // > 400 bytes
  { pollName: `A${String.fromCharCode(0x0041, 0x0301)}`.padEnd(5, 'x'), pollOptions: ['A', 'B'] }, // not normalized
  { description: 'y'.repeat(4001), pollName: 'Poll', pollOptions: ['A', 'B'] },
  { pollName: 'Poll', pollOptions: ['Only'] },                    // one option
  { pollName: 'Poll', pollOptions: ['A', 'A'] },                  // duplicate
  { owner: 'not-an-address', pollName: 'Poll', pollOptions: ['A', 'B'] },
  // Both in the future but start >= end.
  { endTime: Date.now() + 60_000, pollName: 'Poll', pollOptions: ['A', 'B'], startTime: Date.now() + 60_000 },
  // Core requires poll times later than the transaction timestamp; a past
  // time can only ever fail there, so it is refused with the real rule.
  { endTime: 100, pollName: 'Poll', pollOptions: ['A', 'B'] },
  { fee: 1, pollName: 'Poll', pollOptions: ['A', 'B'] },          // nonzero fee
  { pollName: 'Poll', pollOptions: ['A', 'B'], txGroupId: 3 },    // nonzero group
  // Core's normalization rule (NFKC + no invisibles + collapsed whitespace),
  // approximated locally so the common cases fail with a named reason.
  { pollName: '\uff21BC', pollOptions: ['A', 'B'] },              // fullwidth A (NFKC changes it)
  { pollName: 'A  B', pollOptions: ['A', 'B'] },                  // repeated whitespace
  { pollName: `Poll${String.fromCharCode(0x200b)}x`, pollOptions: ['A', 'B'] }, // zero-width
]) {
  assert.throws(() => normalizeHomeV2CreatePollRequest(bad, SELECTED))
}

// VOTE_ON_POLL — pollId aliases, one-based indexes, removal forms, canonical
// selection ([] for removal however spelled, ascending otherwise).
assert.deepEqual(
  normalizeHomeV2VoteOnPollRequest({ option: '2', poll: '7' }),
  { optionInput: { optionIndex: 2 }, pollId: 7 },
)
assert.deepEqual(
  [...canonicalHomeV2VoteSelection(normalizeHomeV2VoteOnPollRequest({ optionIndexes: [3, 1], pollId: 7 }).optionInput)],
  [1, 3],
)
for (const removal of [{ optionIndex: 0, pollId: 7 }, { optionIndexes: [], pollId: 7 }, { optionIndexes: [0], pollId: 7 }]) {
  assert.deepEqual([...canonicalHomeV2VoteSelection(normalizeHomeV2VoteOnPollRequest(removal).optionInput)], [])
}
for (const bad of [
  { optionIndex: 1 },                                  // missing poll id
  { optionIndex: 1, pollId: 0 },                       // Core ids start at 1
  { optionIndex: 1, pollId: 2_147_483_648 },           // beyond int32
  { pollId: 7 },                                       // no selection form at all
  { optionIndexes: [1, 1], pollId: 7 },                // duplicate
  { optionIndexes: [0, 2], pollId: 7 },                // remove mixed with real
  { optionIndex: 2, optionIndexes: [3], pollId: 7 },   // conflicting forms
  { fee: 1, optionIndex: 1, pollId: 7 },
]) {
  assert.throws(() => normalizeHomeV2VoteOnPollRequest(bad))
}

// UPDATE_POLL — new* fields with 1.x fallbacks; complete replacement metadata.
{
  const updated = normalizeHomeV2UpdatePollRequest({
    description: 'still relevant',
    newPollName: 'Snacks v2',
    pollId: '7',
    pollOptions: ['A', 'B', 'C'],
  })
  assert.equal(updated.pollId, 7)
  assert.equal(updated.newPollName, 'Snacks v2')
  assert.equal(updated.newDescription, 'still relevant')
  assert.deepEqual([...updated.newPollOptions], ['A', 'B', 'C'])
}
assert.throws(() => normalizeHomeV2UpdatePollRequest({ pollId: 7, pollOptions: ['A', 'B'] })) // missing new name
// An UPDATE may resend the poll's existing PAST start unchanged — Core
// rejects a past start only when it CHANGED, and a metadata update on a
// started, vote-free poll has to carry the old start (round-2 fix). A past
// new END stays refused: Core always requires it in the future.
assert.equal(
  normalizeHomeV2UpdatePollRequest({ newPollName: 'Kept', newStartTime: 1_000, pollId: 7, pollOptions: ['A', 'B'] }).newStartTime,
  1_000,
)
assert.throws(() => normalizeHomeV2UpdatePollRequest({ newEndTime: 1_000, newPollName: 'Kept', pollId: 7, pollOptions: ['A', 'B'] }))

// The poll-target selector rejects unrecognized shapes and preserves option
// ORDER — the order is part of what a one-based vote means.
assert.deepEqual(
  selectHomeV2PollTarget(
    { owner: SELECTED, pollId: 7, pollName: 'Snacks', pollOptions: [{ optionName: 'B' }, { optionName: 'A' }] },
    7,
  ),
  { optionNames: ['B', 'A'], owner: SELECTED, pollId: 7, pollName: 'Snacks' },
)
assert.throws(() => selectHomeV2PollTarget({ pollName: 'Snacks' }, 7))
assert.throws(() => selectHomeV2PollTarget({ pollName: 'Snacks', pollOptions: ['bare-string'] }, 7))
// The answer must CLAIM to be the poll that was asked for: a node answering
// /polls/id/7 with a different poll's record is refused, not relabeled.
assert.throws(
  () => selectHomeV2PollTarget(
    { owner: SELECTED, pollId: 999, pollName: 'Lie', pollOptions: [{ optionName: 'A' }, { optionName: 'B' }] },
    7,
  ),
  /different poll/,
)

// ---- The name write family (Home 2.1 restoration wave) ----

for (const action of ['REGISTER_NAME', 'UPDATE_NAME', 'SELL_NAME', 'CANCEL_SELL_NAME', 'BUY_NAME']) {
  assert.equal(qdnActions.includes(action), true, `qdnRequest should advertise ${action}`)
  assert.equal(qortalActions.includes(action), false, `qortalRequest must not advertise ${action}`)
}

// Amounts: exact eight-decimal fixed point, no floating point after parsing.
assert.deepEqual(parseHomeV2CoinAmount('1.5', 'x'), { atomic: 150_000_000n, decimal: '1.50000000' })
assert.deepEqual(parseHomeV2CoinAmount('12.50000000', 'x'), { atomic: 1_250_000_000n, decimal: '12.50000000' })
assert.deepEqual(parseHomeV2CoinAmount(0, 'x'), { atomic: 0n, decimal: '0.00000000' })
assert.deepEqual(parseHomeV2CoinAmount('0.00000001', 'x'), { atomic: 1n, decimal: '0.00000001' })
for (const bad of [undefined, null, '', '-1', '1.234567890', '01.5', '1.', '.5', 'abc', NaN, -0.5, Infinity]) {
  assert.throws(() => parseHomeV2CoinAmount(bad, 'x'))
}

// REGISTER: 3-40 byte new names, data <= 4000, fee/txGroupId pinned to 0.
assert.deepEqual(
  normalizeHomeV2RegisterNameRequest({ name: ' alice ', nameData: '{"a":1}' }),
  { data: '{"a":1}', name: 'alice' },
)
for (const bad of [
  { name: 'ab' },                                   // < 3 bytes
  { name: 'x'.repeat(41) },                         // > 40 bytes
  { data: 'y'.repeat(4001), name: 'alice' },
  { fee: 1, name: 'alice' },
  { name: 'alice', txGroupId: 3 },
]) {
  assert.throws(() => normalizeHomeV2RegisterNameRequest(bad))
}

// UPDATE: empty newName/newData mean "keep", primary tri-state via aliases.
{
  const updated = normalizeHomeV2UpdateNameRequest({ isPrimary: true, name: 'alice' })
  assert.deepEqual(updated, { name: 'alice', newData: '', newName: '', primary: true })
  assert.equal(normalizeHomeV2UpdateNameRequest({ name: 'alice' }).primary, undefined)
  assert.equal(normalizeHomeV2UpdateNameRequest({ data: 'd', name: 'alice' }).newData, 'd')
}
assert.throws(() => normalizeHomeV2UpdateNameRequest({ name: 'alice', newName: 'xy' })) // new name < 3 bytes
// Blank-looking name data trims to empty/unchanged (1.x parity).
assert.equal(normalizeHomeV2UpdateNameRequest({ name: 'alice', newData: '   ' }).newData, '')
// Payload nesting takes precedence, exactly as the 1.x bridge read it.
assert.deepEqual(
  normalizeHomeV2RegisterNameRequest({ action: 'REGISTER_NAME', name: 'alice', payload: { data: 'x', name: 'bob' } }),
  { data: 'x', name: 'bob' },
)
assert.deepEqual(normalizeHomeV2BuyNameRequest({ payload: { name: 'alice' } }), { name: 'alice' })
// A nonzero fee nested in payload is refused, not ignored.
assert.throws(() => normalizeHomeV2RegisterNameRequest({ name: 'alice', payload: { fee: 5 } }))
// A finite number more precise than String() renders (1e-8) still parses.
assert.deepEqual(parseHomeV2CoinAmount(0.00000001, 'x'), { atomic: 1n, decimal: '0.00000001' })
// A number more precise than eight decimals is REFUSED, not rounded — the
// same behavior as the equivalent string input (monetary consistency).
assert.throws(() => parseHomeV2CoinAmount(0.123456789, 'x'))
assert.throws(() => parseHomeV2CoinAmount(0.000000005, 'x'))
assert.throws(() => parseHomeV2CoinAmount('0.123456789', 'x'))
// A crafted payload __proto__ key cannot inject a field through the flatten.
assert.throws(() => normalizeHomeV2RegisterNameRequest(JSON.parse('{"payload":{"__proto__":{"name":"proto"}}}')))
// A public sale (no recipient) must have a price above zero; a restricted one may be zero.
assert.throws(() => normalizeHomeV2SellNameRequest({ amount: '0', name: 'alice' }), /public name sale/)
assert.equal(normalizeHomeV2SellNameRequest({ amount: '0', name: 'alice', recipient: `Q${'b'.repeat(25)}` }).amount.atomic, 0n)
assert.throws(() => normalizeHomeV2SellNameRequest({ amount: '10000000000', name: 'alice' }), /too large/)

// SELL / CANCEL / BUY.
assert.deepEqual(
  normalizeHomeV2SellNameRequest({ amount: '2', name: 'alice', recipientAddress: `Q${'b'.repeat(25)}` }),
  { amount: { atomic: 200_000_000n, decimal: '2.00000000' }, name: 'alice', recipient: `Q${'b'.repeat(25)}` },
)
assert.throws(() => normalizeHomeV2SellNameRequest({ amount: 'x', name: 'alice' }))
assert.throws(() => normalizeHomeV2SellNameRequest({ amount: '1', name: 'alice', recipient: 'bogus' }))
assert.deepEqual(normalizeHomeV2CancelSellNameRequest({ name: 'alice' }), { name: 'alice' })
assert.deepEqual(normalizeHomeV2BuyNameRequest({ name: 'alice' }), { name: 'alice' })
assert.deepEqual(
  normalizeHomeV2BuyNameRequest({ amount: 1.5, name: 'alice', seller: `Q${'c'.repeat(25)}` }),
  { amount: { atomic: 150_000_000n, decimal: '1.50000000' }, name: 'alice', seller: `Q${'c'.repeat(25)}` },
)

// The name-target selector: sale price parsed exactly; unrecognized shapes
// refused. The caller compares the stored spelling itself (GET resolves by
// REDUCED name), so the selector faithfully passes the stored one through.
assert.deepEqual(
  selectHomeV2NameTarget({ isForSale: true, name: 'Alice', owner: `Q${'d'.repeat(25)}`, salePrice: '12.5' }),
  { isForSale: true, name: 'Alice', owner: `Q${'d'.repeat(25)}`, salePrice: { atomic: 1_250_000_000n, decimal: '12.50000000' }, saleRecipient: null },
)
assert.throws(() => selectHomeV2NameTarget({ owner: 'x' }))
// Chain-derived owner/saleRecipient shown on a PAYMENT prompt are shape-
// validated, not trusted as arbitrary node text.
assert.throws(() => selectHomeV2NameTarget({ isForSale: true, name: 'Alice', owner: 'not-an-address', salePrice: '1' }), /invalid owner/)
assert.throws(
  () => selectHomeV2NameTarget({ isForSale: true, name: 'Alice', owner: `Q${'d'.repeat(25)}`, salePrice: '1', saleRecipient: 'nope' }),
  /invalid sale-recipient/,
)

// ---- The group mutation family (Home 2.1 restoration wave) ----
for (const action of ['CREATE_GROUP', 'UPDATE_GROUP', 'GROUP_APPROVAL', 'SET_GROUP', 'SET_GROUP_AVATAR']) {
  assert.equal(qdnActions.includes(action), true, `qdnRequest should advertise ${action}`)
  assert.equal(qortalActions.includes(action), false, `qortalRequest must not advertise ${action}`)
}

// --- ENCRYPT_DATA is on BOTH protocols ----------------------------------
// It has no chain semantics: one account key serves Qortal and Qortium, and it
// touches no node. A Qortal app calling it must get Qortal's own behaviour.
assert.equal(getHomeV2AppActions('qdnRequest').includes('ENCRYPT_DATA'), true)
assert.equal(getHomeV2AppActions('qortalRequest').includes('ENCRYPT_DATA'), true)
// The network helper must not claim a chain for it beyond the protocol's own
// default — it is not a chain-scoped action.
assert.equal(getHomeV2AppNetwork('qdnRequest', 'ENCRYPT_DATA'), 'qortium')
assert.equal(getHomeV2AppNetwork('qortalRequest', 'ENCRYPT_DATA'), 'qortal')
// ENCRYPT_QORTAL_GROUP_DATA is a DIFFERENT mechanism (a groupId and a shared
// symmetric key fetched from QDN), not this envelope. It must not appear until
// it is actually implemented, or SHOW_ACTIONS would advertise a lie.
assert.equal(getHomeV2AppActions('qdnRequest').includes('ENCRYPT_QORTAL_GROUP_DATA'), false)
assert.equal(getHomeV2AppActions('qortalRequest').includes('ENCRYPT_QORTAL_GROUP_DATA'), false)

// DECRYPT_DATA is on both protocols for the same reason ENCRYPT_DATA is.
assert.equal(getHomeV2AppActions('qdnRequest').includes('DECRYPT_DATA'), true)
assert.equal(getHomeV2AppActions('qortalRequest').includes('DECRYPT_DATA'), true)
assert.equal(getHomeV2AppNetwork('qdnRequest', 'DECRYPT_DATA'), 'qortium')
assert.equal(getHomeV2AppNetwork('qortalRequest', 'DECRYPT_DATA'), 'qortal')
// The other decrypt actions remain unimplemented and must not be advertised.
for (const action of [
  'DECRYPT_QORTAL_GROUP_DATA',
  'DECRYPT_DATA_WITH_SHARING_KEY',
  'DECRYPT_AESGCM',
]) {
  assert.equal(getHomeV2AppActions('qdnRequest').includes(action), false, `${action} is not implemented`)
  assert.equal(getHomeV2AppActions('qortalRequest').includes(action), false, `${action} is not implemented`)
}

console.log('Home v2 app action contract tests passed.')
