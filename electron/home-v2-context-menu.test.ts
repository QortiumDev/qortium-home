import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  dismissedHomeV2ContextMenuResult,
  getHomeV2ContextMenuItems,
  getHomeV2ContextMenuOperation,
  getHomeV2ContextMenuPopupPoint,
  handledHomeV2ContextMenuResult,
  normalizeHomeV2ContextMenuRequest,
} from './home-v2-context-menu.js'

const qortiumAccount = normalizeHomeV2ContextMenuRequest('qdnRequest', {
  version: 1,
  anchor: { x: 42.5, y: 64 },
  target: {
    kind: 'account',
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
    name: 'Alice',
  },
})
assert.deepEqual(qortiumAccount, {
  version: 1,
  anchor: { x: 42.5, y: 64 },
  target: {
    kind: 'account',
    address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
    name: 'Alice',
    network: 'qortium',
  },
})
assert.deepEqual(
  getHomeV2ContextMenuItems(qortiumAccount.target).map((item) => item.action),
  ['account.copy-address', 'account.copy-name'],
)
assert.deepEqual(
  getHomeV2ContextMenuOperation(qortiumAccount.target, 'account.copy-address'),
  { kind: 'copy', value: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH' },
)

const qortalGroup = normalizeHomeV2ContextMenuRequest('qortalRequest', {
  version: 1,
  target: { kind: 'group', groupId: 42, name: 'Builders' },
})
assert.equal(qortalGroup.target.network, 'qortal')
assert.deepEqual(
  getHomeV2ContextMenuItems(qortalGroup.target).map((item) => item.action),
  ['group.copy-id', 'group.copy-name'],
)
assert.deepEqual(
  getHomeV2ContextMenuOperation(qortalGroup.target, 'group.copy-id'),
  { kind: 'copy', value: '42' },
)

for (const [protocol, address, expectedNetwork, expectedActions] of [
  ['qdnRequest', 'qdn://APP/Chat/Chat?group=42#latest', 'qortium', ['resource.open-new-tab', 'resource.copy-address']],
  ['qortalRequest', 'qortal://WEBSITE/Example/default/page', 'qortal', ['resource.copy-address']],
] as const) {
  const request = normalizeHomeV2ContextMenuRequest(protocol, {
    version: 1,
    target: { kind: 'resource', address },
  })
  assert.equal(request.target.kind, 'resource')
  assert.equal(request.target.network, expectedNetwork)
  assert.deepEqual(
    getHomeV2ContextMenuItems(request.target).map((item) => item.action),
    expectedActions,
  )
  if (request.target.service === 'APP') {
    assert.deepEqual(
      getHomeV2ContextMenuOperation(request.target, 'resource.open-new-tab'),
      { address, kind: 'open-new-tab' },
    )
  }
}

assert.throws(
  () => normalizeHomeV2ContextMenuRequest('qdnRequest', { version: 2, target: { kind: 'group', groupId: 1 } }),
  /requires version 1/,
)
assert.throws(
  () => normalizeHomeV2ContextMenuRequest('qdnRequest', { version: 1, target: { kind: 'account', address: 'bad' } }),
  /account address is invalid/,
)
assert.throws(
  () => normalizeHomeV2ContextMenuRequest('qdnRequest', { version: 1, target: { kind: 'group', groupId: 0 } }),
  /positive safe integer/,
)
assert.throws(
  () => normalizeHomeV2ContextMenuRequest('qdnRequest', {
    version: 1,
    target: { kind: 'resource', address: 'qortal://APP/Chat' },
  }),
  /qdnRequest context menus only accept qdn:\/\//,
)
assert.throws(
  () => normalizeHomeV2ContextMenuRequest('qdnRequest', {
    version: 1,
    target: { kind: 'resource', address: 'qdn://user:secret@APP/Chat' },
  }),
  /cannot contain credentials/,
)
assert.throws(
  () => normalizeHomeV2ContextMenuRequest('qdnRequest', {
    version: 1,
    target: { kind: 'resource', address: 'qdn://APP/Chat/%2e%2e/Other' },
  }),
  /cannot contain dot path segments/,
)
assert.throws(
  () => normalizeHomeV2ContextMenuRequest('qdnRequest', {
    version: 1,
    anchor: { x: Number.POSITIVE_INFINITY, y: 0 },
    target: { kind: 'group', groupId: 1 },
  }),
  /anchor coordinates are invalid/,
)
assert.throws(
  () => getHomeV2ContextMenuOperation(qortalGroup.target, 'account.copy-address'),
  /not available/,
)
assert.deepEqual(handledHomeV2ContextMenuResult('group.copy-id'), {
  action: 'group.copy-id',
  status: 'handled',
  version: 1,
})
assert.deepEqual(dismissedHomeV2ContextMenuResult(), { status: 'dismissed', version: 1 })
assert.deepEqual(
  getHomeV2ContextMenuPopupPoint(
    { x: 100, y: 50, width: 400, height: 300 },
    1.25,
    { x: -500, y: 9_999 },
  ),
  { x: 125, y: 436 },
)
assert.deepEqual(
  getHomeV2ContextMenuPopupPoint(
    { x: 100, y: 50, width: 400, height: 300 },
    1,
    null,
  ),
  { x: 300, y: 200 },
)
assert.throws(
  () => getHomeV2ContextMenuPopupPoint({ x: 0, y: 0, width: 0, height: 1 }, 1, null),
  /host bounds are invalid/,
)

const desktopBridgeSource = readFileSync('electron/home-v2-app-bridge.ts', 'utf8')
const viewHostSource = readFileSync('electron/qdn-views.ts', 'utf8')
const androidHostSource = readFileSync('src/home-v2-live/HomeV2LiveApp.tsx', 'utf8')
assert.match(desktopBridgeSource, /getQdnViewContextMenuPopupHost\(sender, request\.anchor\)/)
assert.match(desktopBridgeSource, /Menu\.buildFromTemplate\(template\)/)
assert.match(desktopBridgeSource, /pending\.menu\.closePopup\(pending\.window\)/)
assert.match(desktopBridgeSource, /getQdnViewContextForWebContents\(sender\)/)
assert.match(viewHostSource, /!entry\.window\.isFocused\(\)/)
assert.match(viewHostSource, /!entry\.view\.getVisible\(\)/)
assert.match(androidHostSource, /action === 'SHOW_CONTEXT_MENU'/)
assert.match(androidHostSource, /ANDROID_CONTEXT_MENU_TIMEOUT_MS/)
assert.match(androidHostSource, /activeTab\.context\.resourceLocation !== pending\.resourceLocation/)
assert.match(androidHostSource, /pending\.resolve\(dismissedHomeV2ContextMenuResult\(\)\)/)

console.log('Home v2 context menu contract tests passed.')
