import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { build } from 'esbuild'

const filename = fileURLToPath(new URL('../src/home-v2-live/HomeV2LiveApp.tsx', import.meta.url))
const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
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
const { resolveAccountTabLaunch } = await bundled('../src/home-v2-live/account-tab-launch.ts')
const { createProductState, reduceProductState, restoreProductState } = await bundled('../src/v2/product-model.ts')
const { createHomeV2SessionGrantStore, homeV2PermissionGrantKey } = await bundled('../electron/home-v2-session-grants.ts')
const location = 'qdn://APP/Fixture/default?room=7#messages'
const app = {
  id: 'fixture', title: 'Fixture', description: '', category: 'utility', sourceNetwork: 'qortium',
  resourceIdentity: { service: 'APP', name: 'Fixture', identifier: null },
  targetNetworks: ['qortium'], placement: 'recommended',
}
function createHarness() {
  const accounts = ['wallet:A', 'wallet:B:address-2'].map((id, index) => ({
    id, walletId: index ? 'wallet:B' : 'wallet:A', label: id, address: `fixture-${index}`,
    addressIndex: index, isUnlocked: !index, supportsDerivedAddresses: true,
  }))
  const original = {
    type: 'open-app', app, tabId: 'source', context: {
      appId: app.id, tabId: 'source', identityId: 'home-v2:identity:wallet:A',
      walletRef: 'home-v2:wallet:wallet:A', sourceNetwork: 'qortium', resourceLocation: location, previewUrl: null,
    },
  }
  const product = { current: reduceProductState(createProductState(), original) }
  const actions = []
  const sandbox = vm.createContext({
    Error, resolveAccountTabLaunch, productStateRef: product,
    accountCatalogueRef: { current: { accounts } },
    shellStateReady: true, resourceViewer: null, tabSequence: { current: 0 },
    snapshot: { identity: { id: 'home-v2:identity:wallet:B:address-2', selectedWallet: 'home-v2:wallet:wallet:B' } },
    HOME_V2_BIND_NO_ACCOUNT: Object.freeze({ bind: 'none' }),
    brand: (value) => value, t: (key) => key, setShellNotice: () => undefined,
    dispatchProduct(action) { actions.push(action); product.current = reduceProductState(product.current, action) },
    setSelectedAccountId() { throw new Error('Launch must not change the default account') },
    setAccountDialog() { throw new Error('Launch must not ask to unlock') },
  })
  for (const key of ['vaultClient', 'selectedAccountId', 'selectedAccountIdRef']) {
    Object.defineProperty(sandbox, key, { get() { throw new Error(`Launch must not consult ${key}`) } })
  }
  sandbox.openApp = callback('openApp', sandbox)
  const launch = callback('openTabWithAccount', sandbox)
  return { sandbox, product, actions, original, launch,
    activateSource() { product.current = reduceProductState(product.current, { type: 'activate-tab', tabId: 'source' }) } }
}
{
  const h = createHarness()
  await h.launch('source', location, 'wallet:A')
  assert.equal(h.product.current.tabs.length, 2, 'Same-account duplication must create a second instance')
  assert.equal(h.actions[0].newInstance, true, 'The real shell must opt in to new-instance dispatch')
  assert.notEqual(h.product.current.activeTabId, 'source')
  assert.deepEqual(h.product.current.tabs[0].context, h.original.context, 'Original authority remains untouched')
  const duplicateId = h.product.current.activeTabId
  h.activateSource()
  await h.launch('source', location, 'wallet:B:address-2')
  assert.equal(h.product.current.tabs.at(-1).context.identityId, 'home-v2:identity:wallet:B:address-2')
  assert.equal(h.product.current.tabs.at(-1).context.walletRef, 'home-v2:wallet:wallet:B')
  h.activateSource()
  await h.launch('source', location, null)
  assert.equal(h.product.current.tabs.at(-1).context.identityId, 'home-v2:identity:none', 'Explicit null must never become default B')
  assert.equal(h.product.current.tabs.at(-1).context.walletRef, null)
  assert.equal(h.product.current.tabs.at(-1).context.previewUrl, null)
  assert.equal(h.product.current.tabs.at(-1).context.resourceLocation, location)
  const restored = restoreProductState(JSON.parse(JSON.stringify(h.product.current)))
  assert.equal(restored.tabs.length, 4)
  assert.deepEqual(restored.tabs.map((tab) => tab.id), h.product.current.tabs.map((tab) => tab.id))
  h.sandbox.openApp(app, location, 'wallet:A')
  assert.equal(h.product.current.tabs.length, 4, 'Ordinary open keeps the original dedup behavior')
  assert.equal(h.product.current.activeTabId, 'source')
  const grants = createHomeV2SessionGrantStore()
  const keyInput = { accountId: 'wallet:A', accountUnlocked: true, action: 'GET_USER_ACCOUNT', appIdentity: location,
    nodeRoute: 'none', principalId: 'android', protocol: 'qdnRequest', tabId: 'source' }
  grants.add(homeV2PermissionGrantKey(keyInput), { family: 'account.read', hostWebContentsId: 'android', network: 'qortium', tabId: 'source' })
  assert.equal(grants.has(homeV2PermissionGrantKey({ ...keyInput, tabId: duplicateId })), false,
    'A new tab ID must not inherit the source tab session grant')
}
for (const [label, mutate, target, expectedLocation] of [
  ['not hydrated', (h) => { h.sandbox.shellStateReady = false }, 'wallet:A', location],
  ['transient', (h) => { h.product.current = { ...h.product.current, transient: 'releases' } }, 'wallet:A', location],
  ['inactive source', (h) => { h.product.current = { ...h.product.current, activeTabId: 'other' } }, 'wallet:A', location],
  ['viewer', (h) => { h.sandbox.resourceViewer = { sourceTabId: 'source' } }, 'wallet:A', location],
  ['closed source', (h) => { h.product.current = { ...h.product.current, tabs: [] } }, 'wallet:A', location],
  ['changed source resource', () => {}, 'wallet:A', 'qdn://APP/Other/default'],
  ['removed target', () => {}, 'wallet:removed', location],
  ['undefined target', () => {}, undefined, location],
  ['preview', (h) => { h.product.current = { ...h.product.current, tabs: h.product.current.tabs.map((tab) => ({
    ...tab, context: { ...tab.context, previewUrl: 'http://127.0.0.1/render/hash/preview' },
  })) } }, 'wallet:A', location],
]) {
  const h = createHarness()
  mutate(h)
  await assert.rejects(h.launch('source', expectedLocation, target), undefined, label)
  assert.equal(h.actions.length, 0, `${label}: rejected choices never dispatch`)
}
console.log('Home v2 production account launch, identity isolation, and new-instance tests passed.')
