import assert from 'node:assert/strict'
import {
  createHomeV2SessionGrantStore,
  homeV2PermissionGrantFamily,
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
assert.equal(homeV2PermissionGrantFamily('GET_PRIVATE_DIRECT_ACTIVE_CHATS'), 'GET_PRIVATE_DIRECT_ACTIVE_CHATS')

const store = createHomeV2SessionGrantStore()
store.add('window-a-tab-a-qortium', { hostWebContentsId: 10, network: 'qortium', tabId: 'tab-a' })
store.add('window-a-tab-a-qortal', { hostWebContentsId: 10, network: 'qortal', tabId: 'tab-a' })
store.add('window-a-tab-b-qortium', { hostWebContentsId: 10, network: 'qortium', tabId: 'tab-b' })
store.add('window-b-tab-a-qortium', { hostWebContentsId: 11, network: 'qortium', tabId: 'tab-a' })

store.invalidate(10, { kind: 'navigation-changed', network: null, tabId: 'tab-a' })
assert.equal(store.has('window-a-tab-a-qortium'), false)
assert.equal(store.has('window-a-tab-a-qortal'), false)
assert.equal(store.has('window-a-tab-b-qortium'), true)
assert.equal(store.has('window-b-tab-a-qortium'), true)

store.add('window-a-tab-a-qortium', { hostWebContentsId: 10, network: 'qortium', tabId: 'tab-a' })
store.add('window-a-tab-a-qortal', { hostWebContentsId: 10, network: 'qortal', tabId: 'tab-a' })
store.invalidate(10, { kind: 'node-changed', network: 'qortium', tabId: null })
assert.equal(store.has('window-a-tab-a-qortium'), false)
assert.equal(store.has('window-a-tab-a-qortal'), true)
assert.equal(store.has('window-a-tab-b-qortium'), false)
assert.equal(store.has('window-b-tab-a-qortium'), true)

store.invalidate(10, { kind: 'account-changed', network: null, tabId: null })
assert.equal(store.has('window-a-tab-a-qortal'), false)
assert.equal(store.has('window-b-tab-a-qortium'), true)
assert.equal(store.size(), 1)

console.log('Home v2 session grant tests passed')
