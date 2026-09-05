import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { build } from 'esbuild'

async function bundled(relative) {
  const result = await build({ entryPoints: [new URL(relative, import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'esm', write: false })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
const navigation = await bundled('../src/home-v2-live/tab-navigation.ts')
const { createProductState } = await bundled('../src/v2/product-model.ts')
const file = new URL('../src/home-v2-live/HomeV2LiveApp.tsx', import.meta.url)
const text = readFileSync(file, 'utf8')
const source = ts.createSourceFile(file.pathname, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function callback(name, sandbox) {
  const found = []
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found.push(node.initializer)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.equal(found.length, 1)
  const expression = ts.isCallExpression(found[0]) ? found[0].arguments[0] : found[0]
  return vm.runInContext(ts.transpileModule(`(${expression.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText, sandbox)
}
function harness() {
  const product = { current: createProductState() }, effects = [], notices = []
  let appVersion = 0, internalVersion = 0
  const sandbox = vm.createContext({ ...navigation, Promise,
    productStateRef: product, t: key => key,
    window: { homeV2Apps: {
      navigate: async request => { effects.push(['navigate', request]); return true },
      reload: async request => { effects.push(['reload', request]); return true },
      destroy: async request => effects.push(['destroy', request]),
      invalidateRuntime: request => effects.push(['invalidate', request]),
    } },
    androidNavigationControllers: { current: new Map() },
    invalidateAndroidRuntime: (...args) => effects.push(['android-invalidate', ...args]),
    dispatchProduct(action) { product.current = navigation.reduceTabNavigation(product.current, action) },
    setAppReloadVersion(update) { appVersion = update(appVersion) },
    setInternalReloadVersion(update) { internalVersion = update(internalVersion) },
    setShellNotice(value) { notices.push(value) },
    nodeCoreController: { async refreshAll() { effects.push(['refresh-status']) } },
    activeNavigation: undefined, activeNavigationPosition: -1,
  })
  Object.defineProperty(sandbox, 'productState', { get: () => product.current })
  Object.defineProperty(sandbox, 'activeHistory', { get: () => navigation.tabHistory(product.current) })
  const go = callback('navigateActiveApp', sandbox), reload = callback('reloadActiveSurface', sandbox)
  function app(name, replace = false) {
    const app = { id: name, title: name, sourceNetwork: 'qortal', resourceIdentity: { service: 'APP', name, identifier: 'published' } }
    const context = { appId: name, tabId: 'tab', sourceNetwork: 'qortal', resourceLocation: `qortal://APP/${name}/published/one`,
      identityId: 'home-v2:identity:wallet:B', walletRef: 'home-v2:wallet:B', previewUrl: null }
    sandbox.dispatchProduct({ type: replace ? 'replace-tab-app' : 'open-app', tabId: 'tab', app, context,
      fromResourceLocation: product.current.tabs[0]?.context.resourceLocation })
  }
  function native() {
    const tab = product.current.tabs[0]
    const root = `https://node.example/render/APP/${tab.appId}/published/`
    sandbox.dispatchProduct({ type: 'sync-app-history', tabId: 'tab', snapshot: {
      resourceUrl: tab.context.resourceLocation, renderUrl: `${root}one`, activeIndex: 1,
      entries: [{ index: 0, url: `${root}one` }, { index: 1, url: `${root}two` }],
    } })
  }
  return { sandbox, product, effects, notices, go, reload, app, native,
    versions: () => [appVersion, internalVersion] }
}
const settle = () => new Promise(resolve => setImmediate(resolve))
{
  const h = harness()
  h.reload()
  assert.deepEqual(h.effects, [['refresh-status']])
  assert.deepEqual(h.versions(), [0, 1])
  h.app('Alpha'); h.native()
  h.effects.length = 0
  h.go(-1); await settle()
  assert.equal(h.effects.length, 1)
  assert.equal(h.effects[0][0], 'navigate', 'Same-app native traversal does not destroy views or revoke grants')
  assert.equal(navigation.tabHistory(h.product.current).index, 0)
  h.app('Beta', true)
  h.effects.length = 0
  h.go(-1)
  assert.deepEqual(h.effects.map(effect => effect[0]), ['android-invalidate', 'invalidate', 'destroy'])
  assert.equal(h.effects[0][1], 'app-replaced')
  assert.equal(h.effects[1][1].kind, 'app-replaced')
  assert.equal(h.product.current.tabs[0].context.identityId, 'home-v2:identity:wallet:B')
  assert.equal(h.product.current.tabs[0].context.appId, 'Alpha')
  assert.deepEqual(h.versions(), [1, 1], 'Recreation also covers repeated identical URLs')
  h.effects.length = 0
  h.sandbox.dispatchProduct({ type: 'show-transient', destination: { kind: 'core-docs', network: 'qortal' } })
  h.reload()
  assert.deepEqual(h.effects, [['refresh-status']], 'Docs cannot reload the hidden app')
}
{
  const h = harness(); h.app('Alpha'); h.native()
  h.sandbox.window.homeV2Apps.navigate = async () => false
  h.go(-1); await settle()
  assert.equal(navigation.tabHistory(h.product.current).index, 1, 'A rejected native traversal cannot advance chrome history')
  assert.equal(h.notices.length, 1)
}
{
  const h = harness(); h.app('Alpha'); h.native()
  let complete
  h.sandbox.window.homeV2Apps.navigate = () => new Promise(resolve => { complete = resolve })
  h.go(-1)
  h.sandbox.dispatchProduct({ type: 'navigate', destination: 'settings' })
  complete(true); await settle()
  assert.equal(h.product.current.destination, 'settings', 'Late acknowledgement never steals focus')
}
console.log('Production native/cross-app routing, revocation, reload isolation and late/failure acknowledgements passed')
