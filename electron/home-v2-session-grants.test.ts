import assert from 'node:assert/strict'
import {
  createHomeV2SessionGrantStore,
  homeV2AccountReadPromptKind,
  homeV2AccountReadPromptSummary,
  homeV2AccountReadPromptTitle,
  homeV2DurableAccountReadCapability,
  homeV2DurablePrivateGroupReadCapability,
  homeV2PermissionGrantKey,
  homeV2PermissionGrantFamily,
  isHomeV2AccountReadAction,
  isHomeV2PrivateChatReadAction,
  HOME_V2_ACCOUNT_READ_ACTIONS,
  homeV2AccountReadAlwaysAllowDetail,
  HOME_V2_PERMISSIONLESS_ACTIONS,
  isHomeV2PermissionlessAction,
} from './home-v2-session-grants.js'
import { QDN_APP_CAPABILITIES } from './qdn-manager-permissions.js'

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
  // The minting reads (R3-11) are permissionless without being account reads:
  // they take an address rather than reaching into the selected account's
  // private data, so they are deliberately outside the account.read grant.
  //
  // GET_USER_WALLET (R4 tier-2) is the third. It stays OUT of
  // HOME_V2_ACCOUNT_READ_ACTIONS on purpose: membership there would make it
  // reachable through a durable `account.read` grant and give it that family's
  // prompt wording, when in fact it needs no grant at all — its whole answer
  // is the address GET_SELECTED_ACCOUNT already returns permissionlessly,
  // minus the name and lock state.
  //
  // Any OTHER permissionless action must still be an account read.
  const permissionlessNonAccountReads = ['GET_MINTING_STATUS', 'GET_USER_WALLET', 'LIST_MINTING_ACCOUNTS']
  for (const action of permissionless) {
    assert.equal(
      isHomeV2PermissionlessAction(action),
      true,
      `${action} must be recognised as permissionless`,
    )
    if (permissionlessNonAccountReads.includes(action)) {
      assert.equal(
        isHomeV2AccountReadAction(action),
        false,
        `${action} must stay outside the account.read grant`,
      )
      continue
    }
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
    'START_MINTING',
    'REMOVE_MINTING_ACCOUNT',
    'RESTART_NODE',
    'UPDATE_NODE_SETTINGS',
  ]
  for (const action of mustStillPrompt) {
    assert.equal(
      isHomeV2PermissionlessAction(action),
      false,
      `${action} must NOT be permissionless — it sends, spends or writes`,
    )
  }

  // The permissionless set is exactly identity (now including the wallet-app
  // spelling of it, GET_USER_WALLET), the app's own journal, direct-chat
  // reads, and the two derived-only minting reads — every one a pure read that
  // returns no key material.
  assert.deepEqual([...permissionless].sort(), [
    'GET_MINTING_STATUS',
    'GET_PENDING_TRANSACTIONS',
    'GET_PRIVATE_DIRECT_ACTIVE_CHATS',
    'GET_SELECTED_ACCOUNT',
    'GET_USER_ACCOUNT',
    'GET_USER_WALLET',
    'LIST_MINTING_ACCOUNTS',
    'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
  ])
}

// --- Durable "always allow" for the read-only account family (R3-10) ---
{
  // Every family member maps to the ONE durable capability, so a single
  // "always allow" covers all of them on both chains.
  //
  // The private-chat reads are the EXCEPTION, since 2026-08-30. They are still
  // in the family for session grants and prompt copy, but they no longer map to
  // the durable account.read, because that had two consequences neither the
  // prompt nor the permission model intended:
  //
  //   - answering "always" to "read your direct messages" recorded
  //     'account.read' -- the generic durable block runs first and returns, so
  //     the account.directChat block below it never ran. The user was shown one
  //     thing and granted a wider one.
  //   - (historical) 'account.read' carried no node-trust condition, so it
  //     satisfied chat reads on ANY node, bypassing the local-Core-only rule
  //     of the time; that rule was itself removed on 2026-09-01.
  //
  // They fall through to their own capabilities (node-trust gate removed
  // 2026-09-01; group reads map via homeV2DurablePrivateGroupReadCapability).
  for (const action of HOME_V2_ACCOUNT_READ_ACTIONS) {
    if (isHomeV2PrivateChatReadAction(action)) {
      assert.equal(
        homeV2DurableAccountReadCapability(action),
        null,
        `${action} must NOT be durably grantable as account.read`,
      )
      continue
    }
    assert.equal(
      homeV2DurableAccountReadCapability(action),
      'account.read',
      `${action} must map to the durable account.read capability`,
    )
  }
  assert.deepEqual(
    HOME_V2_ACCOUNT_READ_ACTIONS.filter(isHomeV2PrivateChatReadAction).slice().sort(),
    [
      'GET_PRIVATE_DIRECT_ACTIVE_CHATS',
      'GET_PRIVATE_GROUP_ACTIVE_CHATS',
      'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
      'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES',
    ],
    'the chat reads excluded from the durable account.read grant, exactly',
  )
  // GET_PRIVATE_GROUP_CHAT_STATE is deliberately NOT excluded: it reports
  // whether a group key is held and needs rotating, returns no message
  // plaintext, and is the call an app makes before asking for anything.
  assert.equal(
    homeV2DurableAccountReadCapability('GET_PRIVATE_GROUP_CHAT_STATE'),
    'account.read',
    'group chat STATE stays on the ordinary read grant',
  )
  // The group-read durable capability helper: exactly the two history reads,
  // nothing else — STATE and the (permissionless) direct reads return null.
  assert.equal(homeV2DurablePrivateGroupReadCapability('GET_PRIVATE_GROUP_ACTIVE_CHATS'), 'account.groupChat')
  assert.equal(homeV2DurablePrivateGroupReadCapability('SEARCH_PRIVATE_GROUP_CHAT_MESSAGES'), 'account.groupChat')
  assert.equal(homeV2DurablePrivateGroupReadCapability('GET_PRIVATE_GROUP_CHAT_STATE'), null)
  assert.equal(homeV2DurablePrivateGroupReadCapability('SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES'), null)
  assert.equal(homeV2DurablePrivateGroupReadCapability('SEND_PRIVATE_GROUP_CHAT_MESSAGE'), null)
  assert.equal(
    new Set(
      HOME_V2_ACCOUNT_READ_ACTIONS
        .filter((action) => !isHomeV2PrivateChatReadAction(action))
        .map(homeV2DurableAccountReadCapability),
    ).size,
    1,
    'the rest of the account-read family must map to exactly one durable capability',
  )

  // Nothing outside the family may be reachable through the durable grant.
  // These are the actions a durable read grant must never satisfy.
  const mustNotBeDurablyReadable = [
    'UNLOCK_SELECTED_ACCOUNT',
    'FORGET_PENDING_TRANSACTION',
    'SAVE_CHAT_ATTACHMENT',
    'PUBLISH_CHAT_ATTACHMENT',
    'PUBLISH_QDN_RESOURCE',
    'SEND_CHAT_MESSAGE',
    'SEND_DIRECT_CHAT_MESSAGE',
    'SEND_PRIVATE_GROUP_CHAT_MESSAGE',
    'REQUEST_PRIVATE_GROUP_CHAT_KEY',
    'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS',
    'ROTATE_PRIVATE_GROUP_CHAT_KEY',
    'START_MINTING',
    'REMOVE_MINTING_ACCOUNT',
    'ADD_GROUP_ADMIN',
    'GROUP_BAN',
    'JOIN_GROUP',
    'OPEN_AS_WIDGET',
    'SHOW_NOTIFICATION',
    'BOOKMARKS_APPLY',
  ]
  for (const action of mustNotBeDurablyReadable) {
    assert.equal(
      homeV2DurableAccountReadCapability(action),
      null,
      `${action} must NOT be grantable through the durable account.read capability`,
    )
  }

  // The durable capability must actually exist in the persisted allowlist,
  // or a grant would be silently dropped when the store is re-read.
  assert.equal(
    (QDN_APP_CAPABILITIES as readonly string[]).includes('account.read'),
    true,
    'account.read must be a persisted, sanitizer-allowlisted app capability',
  )
}

// --- Honest prompt labels; the grant family is deliberately unchanged ---
{
  for (const action of [
    'GET_PRIVATE_GROUP_ACTIVE_CHATS',
    'GET_PRIVATE_GROUP_CHAT_STATE',
    'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES',
  ]) {
    assert.equal(homeV2AccountReadPromptKind(action), 'private-group')
  }
  for (const action of [
    'GET_CHAT_ATTACHMENT_STREAM_URL',
    'OPEN_CHAT_ATTACHMENT_VIEWER',
  ]) {
    assert.equal(homeV2AccountReadPromptKind(action), 'attachment')
  }
  for (const action of [
    'GET_SELECTED_ACCOUNT',
    'GET_USER_ACCOUNT',
    'GET_PENDING_TRANSACTIONS',
    'GET_PRIVATE_DIRECT_ACTIVE_CHATS',
    'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
  ]) {
    assert.equal(homeV2AccountReadPromptKind(action), 'account')
  }
  // Anything outside the family has no account-read prompt kind at all.
  for (const action of ['SEND_CHAT_MESSAGE', 'SAVE_CHAT_ATTACHMENT', 'START_MINTING']) {
    assert.equal(homeV2AccountReadPromptKind(action), null)
  }
  // Every family member has a kind, and every kind is one of the three.
  for (const action of HOME_V2_ACCOUNT_READ_ACTIONS) {
    const kind = homeV2AccountReadPromptKind(action)
    assert.ok(kind && ['account', 'attachment', 'private-group'].includes(kind))
  }

  // The specialised prompts must NOT reuse the generic title.
  const genericTitle = homeV2AccountReadPromptTitle('account')
  assert.equal(genericTitle, 'Allow read-only account access?')
  assert.notEqual(homeV2AccountReadPromptTitle('private-group'), genericTitle)
  assert.notEqual(homeV2AccountReadPromptTitle('attachment'), genericTitle)
  assert.equal(homeV2AccountReadPromptTitle('private-group'), 'Allow private group chat access?')
  assert.equal(homeV2AccountReadPromptTitle('attachment'), 'Allow chat attachment access?')

  // The private-group summary must disclose the two side effects the Codex
  // security review kept these actions gated for: a persisted group key and
  // the group's member list.
  const groupSummary = homeV2AccountReadPromptSummary('private-group', 'Chat')
  assert.match(groupSummary, /^Chat /)
  assert.match(groupSummary, /member/i)
  assert.match(groupSummary, /stores a copy of it on this device/i)
  assert.match(groupSummary, /never given to the app/i)
  const attachmentSummary = homeV2AccountReadPromptSummary('attachment', 'Chat')
  assert.match(attachmentSummary, /decrypt/i)
  assert.match(attachmentSummary, /never given to the app/i)
  assert.notEqual(groupSummary, attachmentSummary)

  // Wording changed; the GRANT family did not. All five still share one grant
  // key with the rest of the family, on either protocol and either route.
  const familyBase = {
    accountId: 'account-one',
    accountUnlocked: true,
    appIdentity: 'qdn://APP/Chat/Chat',
    principalId: 50,
    tabId: 'tab-a',
  }
  const expectedKey = '50|tab-a|account-one|qdn://APP/Chat/Chat|account.read'
  for (const action of HOME_V2_ACCOUNT_READ_ACTIONS) {
    assert.equal(homeV2PermissionGrantFamily(action), 'account.read')
    assert.equal(homeV2PermissionGrantKey({
      ...familyBase,
      action,
      nodeRoute: 'local|https://127.0.0.1:24891',
      protocol: 'qdnRequest',
      target: 'group:7',
    }), expectedKey)
    assert.equal(homeV2PermissionGrantKey({
      ...familyBase,
      action,
      nodeRoute: 'public|https://api.qortal.org',
      protocol: 'qortalRequest',
      target: '',
    }), expectedKey)
  }

  // Every prompt offering "Always allow" says the grant is broader than the
  // one action asked about, points at where to revoke it, and NAMES the
  // account it is bound to — the grant does not follow an account switch.
  const alwaysAllow = homeV2AccountReadAlwaysAllowDetail('Main wallet')
  assert.equal(alwaysAllow.label, 'Always allow')
  assert.match(alwaysAllow.value, /private group chat/i)
  assert.match(alwaysAllow.value, /attachment/i)
  assert.match(alwaysAllow.value, /Qortal and Qortium/)
  assert.match(alwaysAllow.value, /revoke/i)
  assert.match(alwaysAllow.value, /Main wallet/)
  assert.match(alwaysAllow.value, /Other accounts are asked separately/i)
  assert.notEqual(
    homeV2AccountReadAlwaysAllowDetail('Second wallet').value,
    alwaysAllow.value,
  )
}

// --- The security boundary is unchanged by this feature ---
{
  // The durable grant must not have quietly widened the permissionless set:
  // the five gated actions still have to reach a prompt or a held grant.
  for (const action of [
    'GET_PRIVATE_GROUP_ACTIVE_CHATS',
    'GET_PRIVATE_GROUP_CHAT_STATE',
    'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES',
    'GET_CHAT_ATTACHMENT_STREAM_URL',
    'OPEN_CHAT_ATTACHMENT_VIEWER',
  ]) {
    assert.equal(
      isHomeV2PermissionlessAction(action),
      false,
      `${action} must still be gated — a durable grant is a user decision, not a default`,
    )
    assert.equal(isHomeV2AccountReadAction(action), true)
  }
}

// --- 'app-replaced' drops every tab-bound grant, account.read included ---
//
// OPEN_CURRENT_TAB leaves the tab id intact but puts a DIFFERENT app in it.
// 'navigation-changed' is the wrong signal for that: it deliberately preserves
// account.read so an app keeps its private-read approval while navigating
// within itself. Using it for a replacement left the outgoing app's
// private-read session grant alive on that tab, ready to revive if the tab
// were ever navigated back to it. 'app-replaced' has 'tab-closed' semantics.
{
  const tabARead = { family: 'account.read', hostWebContentsId: 10, network: 'qortium' as const, tabId: 'tab-a' }
  const tabAMutation = { family: 'chat.public.mutate', hostWebContentsId: 10, network: 'qortium' as const, tabId: 'tab-a' }
  const tabBRead = { family: 'account.read', hostWebContentsId: 10, network: 'qortium' as const, tabId: 'tab-b' }
  const otherWindowRead = { family: 'account.read', hostWebContentsId: 11, network: 'qortium' as const, tabId: 'tab-a' }

  const replaced = createHomeV2SessionGrantStore()
  replaced.add('tab-a-read', tabARead)
  replaced.add('tab-a-mutation', tabAMutation)
  replaced.add('tab-b-read', tabBRead)
  replaced.add('other-window-tab-a-read', otherWindowRead)
  replaced.invalidate(10, { kind: 'app-replaced', network: null, tabId: 'tab-a' })
  assert.equal(
    replaced.has('tab-a-read'),
    false,
    'a replaced tab must not keep the outgoing app account.read binding',
  )
  assert.equal(replaced.has('tab-a-mutation'), false)
  // Blast radius is exactly one tab in one window, as with 'tab-closed'.
  assert.equal(replaced.has('tab-b-read'), true)
  assert.equal(replaced.has('other-window-tab-a-read'), true)

  // 'app-replaced' and 'tab-closed' must agree: a replacement is a close and
  // reopen of the app inside that tab.
  const closed = createHomeV2SessionGrantStore()
  closed.add('tab-a-read', tabARead)
  closed.add('tab-a-mutation', tabAMutation)
  closed.add('tab-b-read', tabBRead)
  closed.invalidate(10, { kind: 'tab-closed', network: null, tabId: 'tab-a' })
  assert.equal(closed.has('tab-a-read'), false)
  assert.equal(closed.has('tab-a-mutation'), false)
  assert.equal(closed.has('tab-b-read'), true)

  // ...while 'navigation-changed' must still NOT drop account.read, or an app
  // navigating within itself would be re-prompted on every route change.
  const navigated = createHomeV2SessionGrantStore()
  navigated.add('tab-a-read', tabARead)
  navigated.add('tab-a-mutation', tabAMutation)
  navigated.invalidate(10, { kind: 'navigation-changed', network: null, tabId: 'tab-a' })
  assert.equal(
    navigated.has('tab-a-read'),
    true,
    'in-app navigation must keep its account.read binding',
  )
  assert.equal(navigated.has('tab-a-mutation'), false)
}

// --- ENCRYPT_DATA must never inherit an account-read grant ---------------
// This is the silent-failure case worth pinning: if ENCRYPT_DATA ever became a
// member of the account-read family, a user's existing "always allow" for
// reading their account would start covering use of their KEY, with no new
// prompt and nothing in the UI to show it had widened.
assert.equal(isHomeV2AccountReadAction('ENCRYPT_DATA'), false)
assert.equal(homeV2DurableAccountReadCapability('ENCRYPT_DATA'), null)
assert.equal(homeV2PermissionGrantFamily('ENCRYPT_DATA'), 'ENCRYPT_DATA')
assert.notEqual(homeV2PermissionGrantFamily('ENCRYPT_DATA'), 'account.read')
{
  // ...and the grant KEYS must differ too, since the key is what the session
  // store actually looks up.
  const base = {
    accountId: 'account-1',
    accountUnlocked: true,
    appIdentity: 'qdn://APP/Demo/Demo',
    nodeRoute: 'none',
    principalId: 'android' as const,
    protocol: 'qdnRequest',
    tabId: 'tab-1',
  }
  assert.notEqual(
    homeV2PermissionGrantKey({ ...base, action: 'ENCRYPT_DATA' }),
    homeV2PermissionGrantKey({ ...base, action: 'GET_SELECTED_ACCOUNT' }),
  )
}

// DECRYPT_DATA is its own family too. If it ever joined account.read, an
// "always allow" for READING would start covering an oracle over the key; if
// it joined ENCRYPT_DATA's family, allowing an app to encrypt would silently
// allow it to read.
assert.equal(isHomeV2AccountReadAction('DECRYPT_DATA'), false)
assert.equal(homeV2DurableAccountReadCapability('DECRYPT_DATA'), null)
assert.equal(homeV2PermissionGrantFamily('DECRYPT_DATA'), 'DECRYPT_DATA')
assert.notEqual(homeV2PermissionGrantFamily('DECRYPT_DATA'), homeV2PermissionGrantFamily('ENCRYPT_DATA'))

console.log('Home v2 session grant tests passed')
