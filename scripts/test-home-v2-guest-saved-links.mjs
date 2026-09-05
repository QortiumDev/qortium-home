import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { build } from 'esbuild'

const readSource = (relative) => {
  const filename = fileURLToPath(new URL(relative, import.meta.url))
  return ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}
const liveSource = readSource('../src/home-v2-live/HomeV2LiveApp.tsx')
const desktopSource = readSource('../electron/home-v2-app-bridge.ts')
const collectionSource = readSource('../electron/home-v2-collections-bridge.ts')
function findOne(source, predicate, label) {
  const found = []
  function visit(node) {
    if (predicate(node)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.equal(found.length, 1, `${label} must identify one actual production node`)
  return found[0]
}
const callback = (name) => findOne(liveSource, (node) =>
  ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name,
name).initializer.arguments[0]
const declaration = (source, name) => findOne(source, (node) =>
  ts.isFunctionDeclaration(node) && node.name?.text === name, name)
function evaluate(node, source, sandbox) {
  const expression = node.getText(source).replace(/^export\s+/, '')
  const output = ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  return vm.runInContext(output, sandbox, { filename: source.fileName })
}
async function bundled(relative) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false,
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
const contract = await bundled('../electron/bookmark-manager-contract.ts')
const resources = await bundled('../src/v2/resource-location.ts')
const viewers = await bundled('../src/v2/viewer-location.ts')
const startup = await bundled('../src/home-v2-live/start-page-launch.ts')
const { createAccountRequestEpochs } = await bundled('../src/home-v2-live/account-request-guard.ts')
const guestId = contract.SAVED_GUEST_ACCOUNT_ID
assert.equal(guestId, 'home-v2:guest')
const address = 'qdn://APP/GuestFixture/default'
const managerAddress = 'qdn://APP/Bookmarks/default'
const savedBinding = declaration(liveSource, 'savedAccountBinding')
const startupEffect = findOne(liveSource, (node) =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect' &&
  node.arguments[0]?.getText(liveSource).includes('startPagesLaunched.current'), 'start-page effect').arguments[0]
const desktopOpenCallback = findOne(liveSource, (node) =>
  ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'onOpen',
'collections onOpen').arguments[0]

function createShell(defaultId = 'wallet:A') {
  const opened = []
  const notices = []
  const managerTab = { id: 'manager', context: { resourceLocation: managerAddress } }
  const accounts = ['wallet:A', 'wallet:B'].map((id) => ({ id, walletId: id, label: id }))
  const sandbox = vm.createContext({
    Error, console, ...contract, ...resources, ...viewers, ...startup,
    HOME_V2_BIND_NO_ACCOUNT: Object.freeze({ bind: 'none' }),
    brand: (value) => value,
    isRecord: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
    isAndroidHost: true,
    nodeClient: {},
    tabSequence: { current: 0 },
    accountCatalogueRef: { current: { accounts } },
    productStateRef: { current: { tabs: [managerTab], entries: [{ ...managerTab, kind: 'app' }], activeTabId: 'manager' } },
    snapshot: { identity: { id: `home-v2:identity:${defaultId}`, selectedWallet: `home-v2:wallet:${defaultId}` } },
    selectedAccountId: defaultId,
    setShellNotice: (notice) => notices.push(notice),
    dispatchProduct: (action) => { if (action.type === 'open-app') opened.push(action) },
    parseHomeV2CoreDocsAddress: () => null,
    parseHomeV2ReleaseNotesAddress: () => null,
    parseHomeV2InternalAddress: () => null,
    hasQdnManagerPermission: async () => true,
    resolveHomeV2AppAlias: (action, request) => ({ action, request }),
    resolveLaunchIdentifier: (identifier) => identifier,
    sanitizeQdnManagerAppKey: (value) => value,
    androidAccountRequestEpochs: { current: createAccountRequestEpochs() },
    startPagesLaunched: { current: false },
    shellStateReady: true,
    onboarding: { status: 'complete' },
    pendingStartup: { current: { startPages: 'always' } },
  })
  sandbox.savedAccountBinding = evaluate(savedBinding, liveSource, sandbox)
  sandbox.openApp = evaluate(callback('openApp'), liveSource, sandbox)
  sandbox.openAddress = evaluate(callback('openAddress'), liveSource, sandbox)
  const h = {
    sandbox, opened, notices,
    pin: evaluate(callback('openDashboardPin'), liveSource, sandbox),
    toolbar: evaluate(callback('openBookmarkToolbarLink'), liveSource, sandbox),
    desktopOpen: evaluate(desktopOpenCallback, liveSource, sandbox),
    androidRequest: evaluate(callback('requestApp'), liveSource, sandbox),
    setDefault(id) {
      sandbox.selectedAccountId = id
      sandbox.snapshot.identity = { id: `home-v2:identity:${id}`, selectedWallet: `home-v2:wallet:${id}` }
    },
    async startPages(accountId) {
      sandbox.startPagesLaunched.current = false
      sandbox.collectionsSnapshot = { startPages: [{ displayUrl: address, accountId }] }
      evaluate(startupEffect, liveSource, sandbox)()
      // The production effect intentionally launches a void async task. All
      // fixture operations resolve locally, so one event-loop turn drains it.
      await new Promise(setImmediate)
    },
    request(accountId) {
      return h.androidRequest('qdnRequest', { action: 'BOOKMARKS_OPEN', accountId, address }, {
        tabId: 'manager', resourceLocation: managerAddress, selectedAccountId: 'wallet:A',
      })
    },
  }
  return h
}
function assertLastBinding(h, accountId) {
  assert.ok(h.opened.length)
  const actual = h.opened.at(-1).context
  assert.equal(actual.identityId, `home-v2:identity:${accountId ?? 'none'}`)
  assert.equal(actual.walletRef, accountId === null ? null : `home-v2:wallet:${accountId}`)
}

for (const surface of ['pin', 'toolbar', 'startPages', 'desktopOpen', 'request']) {
  const h = createShell()
  const open = async (accountId) => {
    if (surface === 'startPages') return h.startPages(accountId)
    if (surface === 'request') return h.request(accountId)
    if (surface === 'desktopOpen') return h.desktopOpen({ address, accountId })
    return h[surface]({ displayUrl: address, accountId })
  }
  await open(guestId)
  assertLastBinding(h, null)
  h.setDefault('wallet:B')
  await open(guestId)
  assertLastBinding(h, null)
  await open('wallet:A')
  assertLastBinding(h, 'wallet:A')
  await open(null)
  // Android BOOKMARKS_OPEN inherits the requesting manager's account. The
  // trusted desktop bridge resolves null that way before its onOpen event.
  assertLastBinding(h, surface === 'request' ? 'wallet:A' : 'wallet:B')
  const before = h.opened.length
  try { await open('wallet:missing') } catch (error) {
    assert.match(error.message, /account|opened/i)
  }
  assert.equal(h.opened.length, before, `${surface}: missing saved account must not become the default`)
  try { await open(`${guestId}:almost`) } catch (error) {
    assert.match(error.message, /account|opened/i)
  }
  assert.equal(h.opened.length, before, `${surface}: only the exact guest sentinel is special`)
}

// Execute the real desktop dispatcher and collection IPC payload builder,
// feeding that payload into the actual shell onOpen callback above.
function createDesktop() {
  const h = createShell('wallet:B')
  const context = { accountId: 'wallet:A', tabId: 'manager', resourceUrl: managerAddress }
  const messages = []
  let freshContext = context
  let allowed = true
  let accountChecks = 0
  const sandbox = vm.createContext({
    Error, ...contract,
    getHomeV2AppNetwork: () => 'qortium',
    requireHomeV2BookmarkManagerPermission: async () => { if (!allowed) throw new Error('Permission denied') },
    getQdnViewContextForWebContents: () => freshContext,
    sameViewContext: (left, right) => left === right,
    liveResourceMatchesGrant: () => true,
    accountExists: (id) => { accountChecks += 1; return id === 'wallet:A' || id === 'wallet:B' },
    getHostWindow: () => ({ webContents: { send(channel, payload) {
      assert.equal(channel, 'qdn-app:bookmarks-open')
      messages.push(payload)
      h.desktopOpen(payload)
    } } }),
  })
  sandbox.openHomeV2CollectionAddress = evaluate(declaration(collectionSource, 'openHomeV2CollectionAddress'), collectionSource, sandbox)
  const request = evaluate(declaration(desktopSource, 'handleRequestWithRuntime'), desktopSource, sandbox)
  return {
    h, messages,
    request: (accountId, nested = false) => request({}, context, 'qdnRequest',
      nested ? { request: { address, accountId } } : { address, accountId },
      'BOOKMARKS_OPEN', { network: 'qortium' }, ['BOOKMARKS_OPEN']),
    setStale() { freshContext = null },
    deny() { allowed = false },
    accountChecks: () => accountChecks,
  }
}
{
  const d = createDesktop()
  await d.request(guestId)
  assertLastBinding(d.h, null)
  assert.equal(d.messages.at(-1).accountId, guestId, 'IPC must not collapse guest to null/current')
  assert.equal(d.accountChecks(), 0, 'Guest is not a wallet lookup')
  await d.request(guestId, true)
  assertLastBinding(d.h, null)
  await d.request(null)
  assertLastBinding(d.h, 'wallet:A')
  await d.request('wallet:B')
  assertLastBinding(d.h, 'wallet:B')
  const before = d.h.opened.length
  await assert.rejects(d.request('wallet:missing'), /saved Home account/)
  await assert.rejects(d.request(`${guestId}:almost`), /saved Home account/)
  assert.equal(d.h.opened.length, before)
}
for (const mode of ['deny', 'setStale']) {
  const d = createDesktop()
  d[mode]()
  await assert.rejects(d.request(guestId), /denied|stale/i)
  assert.equal(d.h.opened.length, 0, 'Guest never bypasses manager permission or source-view checks')
}

console.log('Home v2 production guest saved-link launch and desktop/Android bridge tests passed.')
