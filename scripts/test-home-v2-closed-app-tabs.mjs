import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { build } from 'esbuild'

const filename = fileURLToPath(new URL('../src/home-v2-live/HomeV2LiveApp.tsx', import.meta.url))
const text = readFileSync(filename, 'utf8')
const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function callback(name, sandbox) {
  const found = []
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.equal(found.length, 1, `One production ${name} callback must exist`)
  const call = found[0].initializer
  assert.ok(ts.isCallExpression(call) && call.expression.getText(source) === 'useCallback')
  const output = ts.transpileModule(`(${call.arguments[0].getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  return vm.runInContext(output, sandbox, { filename })
}
async function bundled(relative) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
const { rememberClosedAppTab } = await bundled('../src/home-v2-live/closed-app-tabs.ts')
const { rememberClosedTab } = await bundled('../src/home-v2-live/closed-tabs.ts')
const { createProductState } = await bundled('../src/v2/product-model.ts')
const { parseViewerLocation, viewerLocationFromResource } = await bundled('../src/v2/viewer-location.ts')
const { savedEntryAccountId } = await bundled('../src/v2/shell/account-context.ts')
const { reduceTabNavigation: reduceProductState } = await bundled('../src/home-v2-live/tab-navigation.ts')
const { createHomeV2SessionGrantStore, homeV2PermissionGrantKey } = await bundled('../electron/home-v2-session-grants.ts')
const location = 'qortal://APP/Fixture/published/path?room=7#messages'
const app = { id: 'fixture', title: 'Fixture', description: '', category: 'utility', sourceNetwork: 'qortal',
  resourceIdentity: { service: 'APP', name: 'Fixture', identifier: 'published' }, targetNetworks: ['qortal'], placement: 'recommended' }
function harness() {
  const effects = [], notices = [], actions = []
  const product = { current: createProductState() }
  const sandbox = vm.createContext({
    Error, parseViewerLocation, viewerLocationFromResource, savedEntryAccountId,
    isRecord: value => !!value && typeof value === 'object' && !Array.isArray(value),
    rememberClosedAppTab, rememberClosedTab, productStateRef: product, shellStateReady: true, accountCatalogueReady: true,
    closedAppTabs: { current: [] }, tabSequence: { current: 0 },
    accountCatalogueRef: { current: { activeAccountId: 'wallet:A', accounts: ['A', 'B:2'].map(id => ({
      id: `wallet:${id}`, walletId: id[0], isUnlocked: false,
    })) } },
    snapshot: { identity: { id: 'home-v2:identity:wallet:B:2', selectedWallet: 'home-v2:wallet:B' } },
    HOME_V2_BIND_NO_ACCOUNT: Object.freeze({ bind: 'none' }), brand: value => value,
    setShellNotice: value => notices.push(value),
    dispatchProduct(action) { actions.push(action); product.current = reduceProductState(product.current, action) },
    invalidateAndroidRuntime: (...args) => effects.push(['android', ...args]),
    window: { homeV2Apps: {
      invalidateRuntime: value => effects.push(['invalidate', value]),
      destroy: value => effects.push(['destroy', value]),
    } },
    androidNavigationControllers: { current: new Map() },
    androidPendingPermissionMeta: { current: new Map() },
    setAppNavigation(update) { sandbox.navigation = update(sandbox.navigation) }, navigation: {},
    resolveAccountPermission: (...args) => effects.push(['deny', ...args]),
  })
  for (const key of ['vaultClient', 'selectedAccountId', 'openAddress', 'setSelectedAccountId']) {
    Object.defineProperty(sandbox, key, { get() { throw new Error(`Reopen must not consult ${key}`) } })
  }
  sandbox.openApp = callback('openApp', sandbox)
  sandbox.openViewer = callback('openViewer', sandbox)
  const close = callback('closeTab', sandbox), reopen = callback('reopenClosedAppTab', sandbox)
  function open(accountId) {
    sandbox.openApp(app, location, accountId === null ? sandbox.HOME_V2_BIND_NO_ACCOUNT : accountId, true)
    return product.current.tabs.at(-1)
  }
  return { sandbox, product, effects, notices, actions, close, reopen, open }
}
for (const accountId of ['wallet:A', 'wallet:B:2', null]) {
  const h = harness()
  const surviving = h.open(accountId), original = h.open(accountId)
  h.sandbox.androidPendingPermissionMeta.current.set('matching', { tabId: original.id })
  h.sandbox.androidPendingPermissionMeta.current.set('other', { tabId: surviving.id })
  h.sandbox.navigation = { [original.id]: { entries: [] }, [surviving.id]: { entries: [] } }
  h.sandbox.androidNavigationControllers.current.set(original.id, {})
  h.close(original.id)
  assert.equal(h.product.current.tabs.length, 1)
  assert.equal(h.sandbox.androidNavigationControllers.current.has(original.id), false)
  assert.deepEqual(Object.keys(h.sandbox.navigation), [surviving.id])
  assert.deepEqual(JSON.parse(JSON.stringify(h.effects)), [
    ['android', 'tab-closed', original.id], ['invalidate', { kind: 'tab-closed', tabId: original.id }],
    ['destroy', { tabId: original.id }], ['deny', 'matching', { approved: false }],
  ])
  h.reopen()
  const reopened = h.product.current.tabs.at(-1)
  assert.equal(h.product.current.tabs.length, 2, 'Do not merely activate the surviving duplicate')
  assert.notEqual(reopened.id, original.id)
  assert.notEqual(reopened.id, surviving.id)
  assert.equal(reopened.context.identityId, original.context.identityId)
  assert.equal(reopened.context.resourceLocation, location)
  assert.equal(reopened.context.previewUrl, null)
  assert.equal(h.sandbox.closedAppTabs.current.length, 0)
  const grants = createHomeV2SessionGrantStore()
  const input = { accountId, accountUnlocked: false, action: 'GET_USER_ACCOUNT', appIdentity: location,
    nodeRoute: 'none', principalId: 'android', protocol: 'qortalRequest', tabId: original.id }
  grants.add(homeV2PermissionGrantKey(input), { family: 'account.read', hostWebContentsId: 'android', network: 'qortal', tabId: original.id })
  assert.equal(grants.has(homeV2PermissionGrantKey({ ...input, tabId: reopened.id })), false)
  const count = h.actions.length
  h.reopen()
  assert.equal(h.actions.length, count, 'An empty stack is a no-op')
}
{
  const h = harness()
  h.close(h.open('wallet:A').id)
  h.close(h.open('wallet:B:2').id)
  h.sandbox.accountCatalogueReady = false
  h.reopen()
  assert.equal(h.sandbox.closedAppTabs.current.length, 2, 'Loading cannot consume history')
  h.sandbox.accountCatalogueReady = true
  h.sandbox.accountCatalogueRef.current.accounts.pop()
  h.reopen()
  assert.equal(h.product.current.tabs.length, 0, 'Removed account must not fall back to default B')
  assert.match(h.notices.at(-1), /account is no longer available/)
  assert.equal(h.sandbox.closedAppTabs.current.length, 1, 'Failed entry cannot block older history')
  h.reopen()
  assert.equal(h.product.current.tabs[0].context.identityId, 'home-v2:identity:wallet:A')
}
{
  // A tab originally opened through Current still has an immutable bound
  // identity. Reopen preserves that identity, not how the choice was made.
  const h = harness()
  h.sandbox.openApp(app, location)
  const original = h.product.current.tabs.at(-1)
  h.close(original.id)
  h.sandbox.snapshot.identity = { id: 'home-v2:identity:wallet:A', selectedWallet: 'home-v2:wallet:A' }
  h.reopen()
  assert.equal(h.product.current.tabs.at(-1).context.identityId, 'home-v2:identity:wallet:B:2')
}
{
  const h = harness(), tab = h.open('wallet:A')
  h.sandbox.shellStateReady = false
  h.close(tab.id)
  assert.equal(h.sandbox.closedAppTabs.current.length, 0)
}
assert.match(text, /onCloseTab=\{closeTab\}/)
{
  const h = harness()
  h.sandbox.dispatchProduct({ type: 'open-internal', tabId: 'settings-a', page: 'settings' })
  h.sandbox.dispatchProduct({ type: 'settings-section', section: 'appearance' })
  h.close('settings-a')
  h.reopen()
  const entry = h.product.current.entries.at(-1)
  assert.equal(entry.page, 'settings')
  assert.notEqual(entry.id, 'settings-a')
  assert.equal(h.product.current.navigation[entry.id].entries.length, 1)
  assert.equal(h.product.current.navigation[entry.id].entries[0].section, 'appearance')
}
assert.match(text, /reopenClosedTab: reopenClosedAppTab/)
for (const accountId of ['wallet:B:2', null]) {
  const h = harness()
  h.sandbox.openViewer('qdn://IMAGE/Viewer/default', accountId ?? h.sandbox.HOME_V2_BIND_NO_ACCOUNT)
  const original = h.product.current.entries.at(-1)
  const effectsBefore = h.effects.length
  h.close(original.id)
  assert.equal(h.effects.length, effectsBefore, 'Closing a public viewer must not invalidate unrelated app streams or grants')
  h.reopen()
  const reopened = h.product.current.entries.at(-1)
  assert.equal(reopened.kind, 'viewer')
  assert.equal(reopened.accountId, accountId, 'Viewer reopen preserves concrete and guest attribution despite default A')
  assert.notEqual(reopened.id, original.id)
  assert.equal(h.product.current.tabs.length, 0)
}
{
  const events = []
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'onOpenResourceViewer') events.push(node.arguments[0])
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.equal(events.length, 1)
  const output = ts.transpileModule(`(${events[0].getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  for (const accountId of ['wallet:B:2', null]) {
    const h = harness(), sourceTab = h.open(accountId)
    const event = vm.runInContext(output, h.sandbox)
    event({ publicResource: true, sourceTabId: sourceTab.id, network: 'qortium', service: 'IMAGE', name: 'Viewer', identifier: null, path: null })
    const viewer = h.product.current.entries.at(-1)
    assert.equal(viewer.kind, 'viewer')
    assert.equal(viewer.accountId, accountId, 'Public app viewer captures source attribution, not default A')
    h.close(sourceTab.id)
    assert.equal(h.product.current.entries.some(entry => entry.id === viewer.id), true)
  }
}
console.log('Home v2 production close/reopen identity, duplicate, lifecycle and failure tests passed.')
