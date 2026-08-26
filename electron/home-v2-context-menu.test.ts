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
  // R4-4: WEBSITE and GAME are browser-archive services that Home now opens
  // as app tabs, so they get 'Open in new tab' too. The qortal://WEBSITE row
  // used to assert copy-only here — that was the bug, not the contract.
  ['qortalRequest', 'qortal://WEBSITE/Example/default/page', 'qortal', ['resource.open-new-tab', 'resource.copy-address']],
  ['qdnRequest', 'qdn://WEBSITE/Blog', 'qortium', ['resource.open-new-tab', 'resource.copy-address']],
  ['qdnRequest', 'qdn://GAME/Arena/Arena', 'qortium', ['resource.open-new-tab', 'resource.copy-address']],
  // Viewer-only services stay copy-only until they get their own tab surface.
  ['qdnRequest', 'qdn://IMAGE/Gallery/photo', 'qortium', ['resource.copy-address']],
  ['qdnRequest', 'qdn://VIDEO/Channel/clip', 'qortium', ['resource.copy-address']],
  ['qdnRequest', 'qdn://DOCUMENT/Papers/spec', 'qortium', ['resource.copy-address']],
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
  // Widened to a readonly string[] so the per-row literal tuple types do not
  // reject the lookup.
  const opensInNewTab = (expectedActions as readonly string[]).includes('resource.open-new-tab')
  if (opensInNewTab) {
    assert.deepEqual(
      getHomeV2ContextMenuOperation(request.target, 'resource.open-new-tab'),
      { address, kind: 'open-new-tab' },
      `${address} should open in a new tab`,
    )
  } else {
    assert.throws(
      () => getHomeV2ContextMenuOperation(request.target, 'resource.open-new-tab'),
      /not available for this target/,
      `${address} must not be openable as an app tab`,
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
// R4-4 native link menu: only qdn/qortal resource links are actionable. A
// javascript:, data: or file: link is rejected at normalize, so the native
// menu offers it no open or copy action.
for (const dangerousLink of [
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'file:///etc/passwd',
]) {
  assert.throws(
    () => normalizeHomeV2ContextMenuRequest('qdnRequest', {
      version: 1,
      target: { kind: 'resource', address: dangerousLink },
    }),
    /only accept qdn:\/\//,
    `${dangerousLink} must not resolve to a resource target`,
  )
}
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
// The app-invoked menu shares the single per-view menu slot (in qdn-views) with
// the native link menu: it reserves on open and runtime invalidation closes any
// open menu through the shared coordinator.
assert.match(desktopBridgeSource, /reserveQdnViewContextMenu\(sender\.id, \{/)
assert.match(desktopBridgeSource, /closeQdnViewContextMenus\(/)
assert.match(viewHostSource, /registration\.menu\.closePopup\(registration\.window\)/)
assert.match(desktopBridgeSource, /getQdnViewContextForWebContents\(sender\)/)
assert.match(viewHostSource, /!entry\.window\.isFocused\(\)/)
assert.match(viewHostSource, /!entry\.view\.getVisible\(\)/)

// R4-4: the app view registers a native context-menu handler that reads the
// link from the trusted event params, routes it through the shared backend,
// and popups a native Menu.
assert.match(viewHostSource, /webContents\.on\('context-menu'/)
assert.match(viewHostSource, /showQdnViewLinkContextMenu\(entry, params\)/)
assert.match(viewHostSource, /const linkURL = typeof params\.linkURL === 'string'/)
assert.match(viewHostSource, /normalizeHomeV2ContextMenuRequest\(protocol, \{/)
assert.match(viewHostSource, /getHomeV2ContextMenuItems\(resourceTarget\)/)
assert.match(viewHostSource, /getHomeV2ContextMenuOperation\(resourceTarget, action\)/)
assert.match(viewHostSource, /Menu\.buildFromTemplate\(template\)/)
assert.match(viewHostSource, /menu\.popup\(\{/)
// The open action reuses the app-invoked open path, not a new ad-hoc opener.
assert.match(viewHostSource, /send\('home-v2-app:open-address', \{\s*address: operation\.address/)
// The menu is never bound to widget views or the shell renderer.
assert.match(viewHostSource, /if \(!isWidgetTabId\(entry\.tabId\)\) \{/)
// The native link menu shares the per-view slot too (declines to stack).
assert.match(viewHostSource, /reserveQdnViewContextMenu\(viewWebContentsId, \{/)
// A selection with no actionable link still offers a plain Copy, bounded.
assert.match(viewHostSource, /selectionText/)
assert.match(viewHostSource, /MAX_QDN_SELECTION_COPY_LENGTH/)
// Open-in-new-tab binds the new tab to the ORIGINATING tab's account (resolved
// from the trusted sourceTabId/sourceResourceLocation), never the global one.
assert.match(androidHostSource, /resolveSourceTabAccountBinding\(/)
assert.match(androidHostSource, /value\.sourceTabId,\s*value\.sourceResourceLocation,/)
assert.match(androidHostSource, /action === 'SHOW_CONTEXT_MENU'/)
assert.match(androidHostSource, /ANDROID_CONTEXT_MENU_TIMEOUT_MS/)
assert.match(androidHostSource, /activeTab\.context\.resourceLocation !== pending\.resourceLocation/)
assert.match(androidHostSource, /pending\.resolve\(dismissedHomeV2ContextMenuResult\(\)\)/)

console.log('Home v2 context menu contract tests passed.')
