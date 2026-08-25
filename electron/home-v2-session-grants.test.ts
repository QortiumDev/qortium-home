import assert from 'node:assert/strict'
import {
  createHomeV2SessionGrantStore,
  homeV2PermissionGrantKey,
  homeV2PermissionGrantFamily,
  isHomeV2AccountReadAction,
  HOME_V2_ACCOUNT_READ_ACTIONS,
  HOME_V2_PERMISSIONLESS_ACTIONS,
  isHomeV2PermissionlessAction,
} from './home-v2-session-grants.js'

assert.equal(homeV2PermissionGrantFamily('SEND_CHAT_MESSAGE'), 'chat.public.mutate')
assert.equal(homeV2PermissionGrantFamily('SEND_CHAT_EDIT'), 'chat.public.mutate')
assert.equal(homeV2PermissionGrantFamily('SEND_CHAT_DELETE'), 'chat.public.mutate')
assert.equal(homeV2PermissionGrantFamily('SEND_CHAT_REACTION'), 'chat.public.mutate')
assert.notEqual(homeV2PermissionGrantFamily('SEND_CHAT_MESSAGE'), homeV2PermissionGrantFamily('GET_CHAT_MESSAGES'))
assert.equal(homeV2PermissionGrantFamily('SEND_DIRECT_CHAT_MESSAGE'), 'chat.direct.mutate')
assert.equal(homeV2PermissionGrantFamily('SEND_DIRECT_CHAT_REACTION'), 'chat.direct.mutate')
assert.equal(homeV2PermissionGrantFamily('SEND_PRIVATE_GROUP_CHAT_MESSAGE'), 'chat.private-group.mutate')
assert.equal(homeV2PermissionGrantFamily('SEND_PRIVATE_GROUP_CHAT_EDIT'), 'chat.private-group.mutate')
for (const action of [
  'GET_SELECTED_ACCOUNT',
  'GET_USER_ACCOUNT',
  'GET_PRIVATE_DIRECT_ACTIVE_CHATS',
  'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
  'GET_PRIVATE_GROUP_ACTIVE_CHATS',
  'GET_PRIVATE_GROUP_CHAT_STATE',
  'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES',
  'GET_PENDING_TRANSACTIONS',
  'GET_CHAT_ATTACHMENT_STREAM_URL',
  'OPEN_CHAT_ATTACHMENT_VIEWER',
]) {
  assert.equal(isHomeV2AccountReadAction(action), true)
  assert.equal(homeV2PermissionGrantFamily(action), 'account.read')
}
for (const action of [
  'UNLOCK_SELECTED_ACCOUNT',
  'FORGET_PENDING_TRANSACTION',
  'SAVE_CHAT_ATTACHMENT',
  'PUBLISH_CHAT_ATTACHMENT',
  'SEND_CHAT_MESSAGE',
  'REQUEST_PRIVATE_GROUP_CHAT_KEY',
]) assert.equal(isHomeV2AccountReadAction(action), false)

const readKeyBase = {
  accountId: 'account-one',
  accountUnlocked: false,
  action: 'GET_SELECTED_ACCOUNT',
  appIdentity: 'qdn://APP/Chat/Chat',
  nodeRoute: 'local|https://127.0.0.1:24891',
  principalId: 50,
  protocol: 'qdnRequest',
  tabId: 'tab-a',
}
const accountReadKey = homeV2PermissionGrantKey(readKeyBase)
assert.equal(accountReadKey, '50|tab-a|account-one|qdn://APP/Chat/Chat|account.read')
assert.equal(homeV2PermissionGrantKey({
  ...readKeyBase,
  accountUnlocked: true,
  action: 'GET_USER_ACCOUNT',
  nodeRoute: 'public|https://qortal.example',
  protocol: 'qortalRequest',
}), accountReadKey)
assert.equal(homeV2PermissionGrantKey({
  ...readKeyBase,
  action: 'GET_PRIVATE_GROUP_ACTIVE_CHATS',
  protocol: 'qortalRequest',
  target: 'private-group:42',
}), accountReadKey)
assert.equal(homeV2PermissionGrantKey({
  ...readKeyBase,
  action: 'GET_PENDING_TRANSACTIONS',
  nodeRoute: 'route-independent',
}), accountReadKey)
assert.notEqual(homeV2PermissionGrantKey({
  ...readKeyBase,
  action: 'SEND_CHAT_MESSAGE',
  target: 'public-group:0',
}), accountReadKey)

const store = createHomeV2SessionGrantStore()
const readBinding = { family: 'account.read', hostWebContentsId: 10, network: 'qortium' as const, tabId: 'tab-a' }
const mutationBinding = { family: 'chat.public.mutate', hostWebContentsId: 10, network: 'qortium' as const, tabId: 'tab-a' }
store.add('window-a-tab-a-read', readBinding)
store.add('window-a-tab-a-mutation', mutationBinding)
store.add('window-a-tab-b-qortium', { family: 'chat.public.mutate', hostWebContentsId: 10, network: 'qortium', tabId: 'tab-b' })
store.add('window-b-tab-a-qortium', { family: 'chat.public.mutate', hostWebContentsId: 11, network: 'qortium', tabId: 'tab-a' })

store.invalidate(10, { kind: 'navigation-changed', network: null, tabId: 'tab-a' })
assert.equal(store.has('window-a-tab-a-read'), true)
assert.equal(store.has('window-a-tab-a-mutation'), false)
assert.equal(store.has('window-a-tab-b-qortium'), true)
assert.equal(store.has('window-b-tab-a-qortium'), true)

store.add('window-a-tab-a-mutation', mutationBinding)
store.invalidate(10, { kind: 'node-changed', network: 'qortium', tabId: null })
assert.equal(store.has('window-a-tab-a-read'), true)
assert.equal(store.has('window-a-tab-a-mutation'), false)
assert.equal(store.has('window-a-tab-b-qortium'), false)
assert.equal(store.has('window-b-tab-a-qortium'), true)

store.add('window-a-tab-a-mutation', mutationBinding)
store.invalidate(10, { kind: 'locked', network: null, tabId: null })
assert.equal(store.has('window-a-tab-a-read'), true)
assert.equal(store.has('window-a-tab-a-mutation'), false)

store.invalidate(10, { kind: 'account-changed', network: null, tabId: null })
assert.equal(store.has('window-a-tab-a-read'), false)
assert.equal(store.has('window-b-tab-a-qortium'), true)
assert.equal(store.size(), 1)

// Read-only actions are permissionless (owner decision 2026-08-24), so the
// bridge must skip the prompt for exactly the account-read set and for
// nothing else. This pins the boundary: if a mutating action is ever added to
// HOME_V2_ACCOUNT_READ_ACTIONS it would silently become permissionless.
{
  const permissionless = [...HOME_V2_PERMISSIONLESS_ACTIONS]
  for (const action of permissionless) {
    assert.equal(
      isHomeV2PermissionlessAction(action),
      true,
      `${action} must be recognised as permissionless`,
    )
    assert.equal(
      isHomeV2AccountReadAction(action),
      true,
      `${action} must also be an account-read action`,
    )
  }

  // Reads with side effects are deliberately NOT permissionless: the private
  // group reads persist a recovered group key to disk and expose member public
  // keys for an arbitrary group, and the attachment reads allocate a retained
  // decrypted-stream capability and can open Home UI. Found by security review.
  for (const action of [
    'GET_PRIVATE_GROUP_ACTIVE_CHATS',
    'GET_PRIVATE_GROUP_CHAT_STATE',
    'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES',
    'GET_CHAT_ATTACHMENT_STREAM_URL',
    'OPEN_CHAT_ATTACHMENT_VIEWER',
  ]) {
    assert.equal(
      isHomeV2AccountReadAction(action),
      true,
      `${action} is still an account-read action`,
    )
    assert.equal(
      isHomeV2PermissionlessAction(action),
      false,
      `${action} has side effects and must still prompt`,
    )
  }

  // Nothing that sends, publishes, spends, unlocks or writes may be in the set.
  const mustStillPrompt = [
    'UNLOCK_SELECTED_ACCOUNT',
    'FORGET_PENDING_TRANSACTION',
    'SAVE_CHAT_ATTACHMENT',
    'PUBLISH_QDN_RESOURCE',
    'PUBLISH_CHAT_ATTACHMENT',
    'SEND_CHAT_MESSAGE',
    'SEND_CHAT_EDIT',
    'SEND_CHAT_DELETE',
    'SEND_CHAT_REACTION',
    'SEND_DIRECT_CHAT_MESSAGE',
    'SEND_PRIVATE_GROUP_CHAT_MESSAGE',
    'REQUEST_PRIVATE_GROUP_CHAT_KEY',
    'ROTATE_PRIVATE_GROUP_CHAT_KEY',
    'JOIN_GROUP',
    'LEAVE_GROUP',
    'GROUP_KICK',
    'GROUP_BAN',
    'ADD_GROUP_ADMIN',
    'INVITE_TO_GROUP',
    'OPEN_AS_WIDGET',
    'SHOW_NOTIFICATION',
    'BOOKMARKS_APPLY',
  ]
  for (const action of mustStillPrompt) {
    assert.equal(
      isHomeV2PermissionlessAction(action),
      false,
      `${action} must NOT be permissionless — it sends, spends or writes`,
    )
  }

  // The permissionless set is exactly identity, the app's own journal, and
  // direct-chat reads — every one a pure read of the caller's own data.
  assert.deepEqual([...permissionless].sort(), [
    'GET_PENDING_TRANSACTIONS',
    'GET_PRIVATE_DIRECT_ACTIVE_CHATS',
    'GET_SELECTED_ACCOUNT',
    'GET_USER_ACCOUNT',
    'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
  ])
}

console.log('Home v2 session grant tests passed')
