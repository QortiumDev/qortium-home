// The address bar navigates the CURRENT tab with that tab's account.
//
// Runs the production `openAddress`, `openAddressFromAddressBar` and
// `openAddressInTab` callbacks lifted out of HomeV2LiveApp.tsx (the same
// extraction test-home-v2-navigation-wiring.mjs uses) against the real
// reducer (tab-navigation over product-model), so the assertions are about what the tab strip
// actually ends up holding — not about a re-implementation of the routing.
//
// Owner bug (2026-09-20): with one app open in two tabs under two accounts,
// typing that app's address from account B's tab switched the user to account
// A's tab, and typing a new app from B's tab opened it under A (the globally
// selected account). The address bar must navigate the tab the user is
// looking at and keep that tab's binding; every bridge route keeps its own.
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
const productModel = await bundled('../src/v2/product-model.ts')
// The component's reducer: product-model plus per-tab history and transient pages.
const navigation = await bundled('../src/home-v2-live/tab-navigation.ts')
const resourceLocation = await bundled('../src/v2/resource-location.ts')
const newTabPreference = await bundled('../src/v2/new-tab-preference.ts')
const viewerLocation = await bundled('../src/v2/viewer-location.ts')
const accountContext = await bundled('../src/v2/shell/account-context.ts')

const file = new URL('../src/home-v2-live/HomeV2LiveApp.tsx', import.meta.url)
const text = readFileSync(file, 'utf8')
const source = ts.createSourceFile(file.pathname, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function transpile(code, sandbox) {
  return vm.runInContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText, sandbox)
}
/** A `const name = useCallback(fn, deps)` (or plain `const name = value`) from the component source. */
function callback(name, sandbox) {
  const found = []
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found.push(node.initializer)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.equal(found.length, 1, `exactly one declaration of ${name}`)
  const expression = ts.isCallExpression(found[0]) ? found[0].arguments[0] : found[0]
  return transpile(`(${expression.getText(source)})`, sandbox)
}
/** A module-level `function name(...) {}` from the component source. */
function declaration(name, sandbox) {
  const found = []
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.getText(source) === name) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.equal(found.length, 1, `exactly one function declaration of ${name}`)
  return transpile(`(${found[0].getText(source)})`, sandbox)
}

const ACCOUNTS = [
  { id: 'acct-a', walletId: 'wallet-a', label: 'Account A' },
  { id: 'acct-b', walletId: 'wallet-b', label: 'Account B' },
]
const identityOf = (accountId) => `home-v2:identity:${accountId}`
const walletOf = (accountId) => `home-v2:wallet:${ACCOUNTS.find((a) => a.id === accountId).walletId}`

function harness({ published = {} } = {}) {
  const product = { current: productModel.createProductState() }
  const effects = [], notices = [], discoveries = []
  const sandbox = vm.createContext({
    ...productModel, ...resourceLocation, ...newTabPreference, ...viewerLocation, ...accountContext,
    Promise, Date, URL, Map, Set, Object, Array, JSON, String, Number, Boolean,
    productStateRef: product,
    // The GLOBAL account is A: what openApp binds to when nothing says otherwise.
    snapshot: { identity: { id: identityOf('acct-a'), selectedWallet: walletOf('acct-a') } },
    accountCatalogueRef: { current: { accounts: ACCOUNTS, activeAccountId: 'acct-a' } },
    tabSequence: { current: 0 },
    dispatchProduct(action) { product.current = navigation.reduceTabNavigation(product.current, action) },
    setShellNotice(value) { notices.push(value) },
    setCoreDocsNetwork(value) { effects.push(['core-docs', value]) },
    setReleaseNotesTarget(value) { effects.push(['release-notes', value]) },
    setOnboarding(value) { effects.push(['onboarding', value]) },
    createHomeV2OnboardingState: () => ({ step: 'welcome' }),
    recordViewerPositionSeed: (...args) => effects.push(['viewer-seed', ...args]),
    invalidateAndroidRuntime: (...args) => effects.push(['android-invalidate', ...args]),
    window: { homeV2Apps: {
      destroy: async (request) => effects.push(['destroy', request]),
      invalidateRuntime: (request) => effects.push(['invalidate', request]),
    } },
    // Discovery: what the node says is published under a bare name.
    nodeClient: {
      async listAppResources(sourceNetwork, name, service) {
        discoveries.push([sourceNetwork, name, service])
        return published[name] ?? []
      },
    },
  })
  Object.defineProperty(sandbox, 'productState', { get: () => product.current })
  sandbox.brand = declaration('brand', sandbox)
  sandbox.HOME_V2_BIND_NO_ACCOUNT = callback('HOME_V2_BIND_NO_ACCOUNT', sandbox)
  sandbox.assertHomeV2ReplaceableTab = declaration('assertHomeV2ReplaceableTab', sandbox)
  sandbox.assertHomeV2AddressBarTabInFront = declaration('assertHomeV2AddressBarTabInFront', sandbox)
  sandbox.openApp = callback('openApp', sandbox)
  sandbox.appTabContext = callback('appTabContext', sandbox)
  sandbox.openAppHere = callback('openAppHere', sandbox)
  sandbox.replaceTabWithApp = callback('replaceTabWithApp', sandbox)
  sandbox.openViewer = callback('openViewer', sandbox)
  sandbox.openAddress = callback('openAddress', sandbox)
  sandbox.openAddressInTab = callback('openAddressInTab', sandbox)
  sandbox.openAddressFromAddressBar = callback('openAddressFromAddressBar', sandbox)

  /** Open `address` in a NEW tab bound to `accountId` (a saved-pin style open), returning the tab. */
  async function openTab(address, accountId) {
    const before = new Set(product.current.entries.map((entry) => entry.id))
    const result = await sandbox.openAddress(address, accountId)
    assert.equal(result.status, 'opened', `${address} opens: ${result.message ?? ''}`)
    const tab = product.current.entries.find((entry) => !before.has(entry.id))
    assert.ok(tab, `${address} made a tab`)
    return tab
  }
  function activate(tabId) { sandbox.dispatchProduct({ type: 'activate-tab', tabId }) }
  const entries = () => product.current.entries
  const active = () => product.current.entries.find((entry) => entry.id === product.current.activeTabId)
  const entry = (id) => product.current.entries.find((candidate) => candidate.id === id)
  const bar = (address) => sandbox.openAddressFromAddressBar(address)
  return { sandbox, product, effects, notices, discoveries, openTab, activate, entries, active, entry, bar }
}

const WALLET_DEFAULT = 'qdn://APP/QortiumHomeTest/Wallet'
const WALLET_CONTEXT = { appId: 'home-v2:app:qortium:QortiumHomeTest:Wallet', resourceLocation: WALLET_DEFAULT }
/** Result objects are made inside the vm context, so compare by value, not prototype. */
function assertOpened(result, label) {
  assert.equal(result.status, 'opened', `${label ?? 'open'}: ${result.message ?? ''}`)
  assert.equal(result.tabId, undefined, `${label ?? 'open'}: an in-place or deduplicated open names no tab`)
}
function assertBound(tab, accountId, label) {
  assert.equal(tab.kind, 'app', `${label}: is an app tab`)
  assert.equal(tab.context.identityId, identityOf(accountId), `${label}: identity of ${accountId}`)
  assert.equal(tab.context.walletRef, walletOf(accountId), `${label}: wallet of ${accountId}`)
}

// (a) The same app open under account A elsewhere: the address bar navigates
// the CURRENT tab (account B's) in place, leaves A's tab alone, and does not
// switch the user to it.
{
  const h = harness()
  const walletA = await h.openTab(WALLET_DEFAULT, 'acct-a')
  const explorerB = await h.openTab('qdn://APP/Explore/Explore', 'acct-b')
  assertBound(walletA, 'acct-a', 'wallet under A')
  assertBound(explorerB, 'acct-b', 'explorer under B')
  assert.equal(h.active().id, explorerB.id)
  const strip = h.entries().map((entry) => entry.id)

  const result = await h.bar(WALLET_DEFAULT)
  assertOpened(result)
  assert.deepEqual(h.entries().map((entry) => entry.id), strip, '(a) no tab added, none removed, order kept')
  assert.equal(h.active().id, explorerB.id, '(a) the active tab is unchanged')
  const current = h.entry(explorerB.id)
  assert.equal(current.context.resourceLocation, WALLET_DEFAULT, '(a) the current tab now shows the entered address')
  assert.equal(current.appId, WALLET_CONTEXT.appId)
  assertBound(current, 'acct-b', '(a) current tab keeps account B')
  assert.deepEqual(h.entry(walletA.id), walletA, '(a) account A\'s tab is untouched')
  assert.deepEqual(h.effects.map((effect) => effect[0]), ['android-invalidate', 'invalidate', 'destroy'],
    '(a) the replaced tab drops its grants and native view, like OPEN_CURRENT_TAB')
  assert.equal(h.effects[0][1], 'app-replaced')
  assert.ok(h.notices.every((notice) => notice === null), '(a) no error notice was shown')
}

// (b) An app not open anywhere, typed from account B's tab, binds to B — not
// to the globally selected A.
{
  const h = harness()
  const explorerB = await h.openTab('qdn://APP/Explore/Explore', 'acct-b')
  const result = await h.bar('qdn://APP/Chat/Chat')
  assertOpened(result)
  assert.equal(h.entries().length, 2, '(b) dashboard + the one navigated tab')
  const current = h.entry(explorerB.id)
  assert.equal(current.context.resourceLocation, 'qdn://APP/Chat/Chat')
  assertBound(current, 'acct-b', '(b) new app bound to the tab\'s account B')
  assert.equal(h.active().id, explorerB.id)
}

// The explicit no-account binding is kept too, not upgraded to the global account.
{
  const h = harness()
  const guest = await h.openTab('qdn://APP/Explore/Explore', h.sandbox.HOME_V2_BIND_NO_ACCOUNT)
  assert.equal(guest.context.identityId, 'home-v2:identity:none')
  await h.bar('qdn://APP/Chat/Chat')
  const current = h.entry(guest.id)
  assert.equal(current.context.resourceLocation, 'qdn://APP/Chat/Chat')
  assert.equal(current.context.identityId, 'home-v2:identity:none', 'no-account tab stays no-account')
  assert.equal(current.context.walletRef, null)
}

// (c) A bare name with ONE published candidate, from account B's tab: discovery
// runs, and the result navigates in place, bound to B.
{
  const h = harness({ published: { Explore: [{ service: 'APP', name: 'Explore', identifier: 'Explore' }] } })
  const walletB = await h.openTab(WALLET_DEFAULT, 'acct-b')
  const result = await h.bar('qdn://APP/Explore')
  assertOpened(result)
  assert.deepEqual(h.discoveries, [['qortium', 'Explore', 'APP']], '(c) the bare name went through discovery')
  assert.equal(h.entries().length, 2)
  const current = h.entry(walletB.id)
  assert.equal(current.context.resourceLocation, 'qdn://APP/Explore/Explore', '(c) resolved identifier, in place')
  assertBound(current, 'acct-b', '(c) bound to the tab\'s account')
  assert.equal(h.active().id, walletB.id)
}

// (d) A bare name with TWO candidates: the address bar asks the user to
// choose, changes nothing yet, and the chosen option navigates in place.
{
  const h = harness({ published: { Wallet: [
    { service: 'APP', name: 'Wallet', identifier: 'Wallet' },
    { service: 'APP', name: 'Wallet', identifier: 'Wallet-beta' },
  ] } })
  const explorerB = await h.openTab('qdn://APP/Explore/Explore', 'acct-b')
  const before = h.entry(explorerB.id)
  const choose = await h.bar('qdn://APP/Wallet')
  assert.equal(choose.status, 'choose', '(d) two candidates ask the user')
  assert.deepEqual(choose.options.map((option) => option.address),
    ['qdn://APP/Wallet/Wallet', 'qdn://APP/Wallet/Wallet-beta'])
  assert.deepEqual(h.entry(explorerB.id), before, '(d) nothing navigated while the choice is pending')
  assert.equal(h.entries().length, 2)

  const chosen = await h.bar(choose.options[1].address)
  assertOpened(chosen)
  assert.equal(h.entries().length, 2, '(d) the choice navigated in place, no tab added')
  const current = h.entry(explorerB.id)
  assert.equal(current.context.resourceLocation, 'qdn://APP/Wallet/Wallet-beta')
  assertBound(current, 'acct-b', '(d) chosen option bound to the tab\'s account')
}

// A bare name nobody published: an error, and the tab is left alone.
{
  const h = harness()
  const explorerB = await h.openTab('qdn://APP/Explore/Explore', 'acct-b')
  const before = h.entry(explorerB.id)
  const result = await h.bar('qdn://APP/Nothing')
  assert.equal(result.status, 'error')
  assert.match(result.message, /No APP resource named Nothing/)
  assert.deepEqual(h.entry(explorerB.id), before)
}

// The tab closing while discovery is outstanding: the late result is refused,
// on state read after the await, and nothing is dispatched.
{
  const h = harness()
  let release
  h.sandbox.nodeClient.listAppResources = () => new Promise((resolve) => { release = resolve })
  const walletB = await h.openTab(WALLET_DEFAULT, 'acct-b')
  const pending = h.bar('qdn://APP/Explore')
  await new Promise((resolve) => setImmediate(resolve))
  h.sandbox.dispatchProduct({ type: 'close-tab', tabId: walletB.id })
  release([{ service: 'APP', name: 'Explore', identifier: 'Explore' }])
  const result = await pending
  assert.equal(result.status, 'error')
  assert.match(result.message, /no longer showing the app/)
  assert.equal(h.entries().length, 1, 'no tab was added for the late result')
  assert.equal(h.effects.length, 0)
}

// The user LEAVING the tab while discovery is outstanding: the late result is
// refused — it would otherwise replace the tab they left and pull it to the
// front — and nothing changes.
{
  const h = harness()
  let release
  h.sandbox.nodeClient.listAppResources = () => new Promise((resolve) => { release = resolve })
  const walletB = await h.openTab(WALLET_DEFAULT, 'acct-b')
  const explorerA = await h.openTab('qdn://APP/Explore/Explore', 'acct-a')
  h.activate(walletB.id)
  const before = h.entry(walletB.id)
  const pending = h.bar('qdn://APP/Chat')
  await new Promise((resolve) => setImmediate(resolve))
  h.activate(explorerA.id)
  release([{ service: 'APP', name: 'Chat', identifier: 'Chat' }])
  const result = await pending
  assert.equal(result.status, 'error')
  assert.match(result.message, /no longer the one in front/, 'tab switched mid-discovery: refused')
  assert.deepEqual(h.entry(walletB.id), before, 'the tab that was typed into is untouched')
  assert.equal(h.active().id, explorerA.id, 'the user stays on the tab they switched to')
  assert.equal(h.entries().length, 3, 'nothing was opened elsewhere either')
  assert.equal(h.effects.length, 0)
}

// A transient page (Core docs / release notes) opened over the tab while
// discovery is outstanding: likewise refused, and the transient page stays.
{
  const h = harness()
  let release
  h.sandbox.nodeClient.listAppResources = () => new Promise((resolve) => { release = resolve })
  const walletB = await h.openTab(WALLET_DEFAULT, 'acct-b')
  const before = h.entry(walletB.id)
  const pending = h.bar('qdn://APP/Chat')
  await new Promise((resolve) => setImmediate(resolve))
  h.sandbox.dispatchProduct({ type: 'show-transient', destination: { kind: 'core-docs', network: 'qortium' } })
  assert.equal(h.product.current.transient, 'core-docs')
  release([{ service: 'APP', name: 'Chat', identifier: 'Chat' }])
  const result = await pending
  assert.equal(result.status, 'error')
  assert.match(result.message, /no longer the one in front/, 'transient page opened mid-discovery: refused')
  assert.deepEqual(h.entry(walletB.id), before, 'the covered tab is untouched')
  assert.equal(h.product.current.transient, 'core-docs', 'the Core docs are not pulled away')
  assert.equal(h.effects.length, 0)
}

// The bridge is NOT held to the in-front rule: an app replacing its own tab
// while another tab is in front still lands, as before, and activates it.
{
  const h = harness()
  const walletB = await h.openTab(WALLET_DEFAULT, 'acct-b')
  const explorerA = await h.openTab('qdn://APP/Explore/Explore', 'acct-a')
  assert.equal(h.active().id, explorerA.id)
  const result = await h.sandbox.openAddressInTab('qdn://APP/Chat/Chat', walletB.id, WALLET_DEFAULT)
  assertOpened(result)
  assert.equal(h.entry(walletB.id).context.resourceLocation, 'qdn://APP/Chat/Chat')
  assert.equal(h.active().id, walletB.id, 'OPEN_CURRENT_TAB semantics unchanged')
}

// A tab whose saved account is no longer in the catalogue: the ONE rule for
// the address bar is the explicit no-account binding, whether the address
// lands in place (app tab) or in a viewer tab — never the global account, and
// never the stale binding carried forward. The bridge still copies verbatim.
{
  const h = harness()
  const walletB = await h.openTab(WALLET_DEFAULT, 'acct-b')
  h.sandbox.accountCatalogueRef.current = {
    accounts: ACCOUNTS.filter((account) => account.id !== 'acct-b'),
    activeAccountId: 'acct-a',
  }
  const result = await h.bar('qdn://APP/Chat/Chat')
  assertOpened(result)
  const current = h.entry(walletB.id)
  assert.equal(current.context.resourceLocation, 'qdn://APP/Chat/Chat')
  assert.equal(current.context.identityId, 'home-v2:identity:none', 'stale account → explicit no-account identity')
  assert.equal(current.context.walletRef, null, 'stale account → no wallet')
  assert.deepEqual(h.effects.map((effect) => effect[0]), ['android-invalidate', 'invalidate', 'destroy'])

  // Same address again in the same tab: the binding changed even though the
  // location did not, so the native view is still recreated.
  h.effects.length = 0
  const stale = await h.openTab('qdn://APP/Explore/Explore', 'acct-a')
  h.sandbox.dispatchProduct({ type: 'replace-tab-app', app: { id: stale.appId, title: 'Explore', sourceNetwork: 'qortium',
    resourceIdentity: { service: 'APP', name: 'Explore', identifier: 'Explore' } },
    tabId: stale.id, fromResourceLocation: stale.context.resourceLocation,
    context: { ...stale.context, identityId: 'home-v2:identity:acct-gone', walletRef: 'home-v2:wallet:gone' } })
  h.effects.length = 0
  await h.bar('qdn://APP/Explore/Explore')
  assert.equal(h.entry(stale.id).context.identityId, 'home-v2:identity:none')
  assert.ok(h.effects.some((effect) => effect[0] === 'destroy'), 'a binding change alone recreates the native view')

  // The bridge keeps copying the tab's binding verbatim, stale or not.
  const bridged = await h.openTab('qdn://APP/Explore/Explore', 'acct-a')
  h.sandbox.dispatchProduct({ type: 'replace-tab-app', app: { id: bridged.appId, title: 'Explore', sourceNetwork: 'qortium',
    resourceIdentity: { service: 'APP', name: 'Explore', identifier: 'Explore' } },
    tabId: bridged.id, fromResourceLocation: bridged.context.resourceLocation,
    context: { ...bridged.context, identityId: 'home-v2:identity:acct-gone', walletRef: 'home-v2:wallet:gone' } })
  const viaBridge = await h.sandbox.openAddressInTab('qdn://APP/Chat/Chat', bridged.id, 'qdn://APP/Explore/Explore')
  assertOpened(viaBridge)
  assert.equal(h.entry(bridged.id).context.identityId, 'home-v2:identity:acct-gone', 'OPEN_CURRENT_TAB copies verbatim, as before')
  assert.equal(h.entry(bridged.id).context.walletRef, 'home-v2:wallet:gone')

  // A viewer address typed from a stale-account app tab: the same no-account
  // rule, in a viewer tab of its own.
  h.activate(walletB.id)
  const viewerResult = await h.bar('qdn://DOCUMENT/Library/book')
  assert.equal(viewerResult.status, 'opened')
  assert.equal(h.entry(viewerResult.tabId).accountId, null, 'viewer from a stale-account tab is attributed to no account')
}

// (e) Home's own pages typed from an app tab do not take the app tab over:
// they open as they always have, and the app tab is left exactly as it was.
{
  const h = harness()
  const walletB = await h.openTab(WALLET_DEFAULT, 'acct-b')
  const before = h.entry(walletB.id)

  const settings = await h.bar('home://settings')
  assertOpened(settings)
  assert.deepEqual(h.entry(walletB.id), before, '(e) settings left the app tab as it was')
  assert.equal(h.active().kind, 'internal')
  assert.equal(h.active().page, 'settings')
  assert.equal(h.product.current.destination, 'settings')

  h.activate(walletB.id)
  const docs = await h.bar('core://api-documentation')
  assertOpened(docs)
  assert.deepEqual(h.entry(walletB.id), before, '(e) core docs left the app tab as it was')
  assert.equal(h.product.current.transient, 'core-docs')
  assert.deepEqual(h.effects.filter((effect) => effect[0] === 'core-docs'), [['core-docs', 'qortium']])

  h.sandbox.dispatchProduct({ type: 'activate-tab', tabId: walletB.id })
  const releases = await h.bar('home://releases/home/v2.1.0')
  assertOpened(releases)
  assert.deepEqual(h.entry(walletB.id), before, '(e) release notes left the app tab as it was')
  assert.equal(h.product.current.transient, 'releases')
  assert.equal(h.effects.filter((effect) => effect[0] === 'invalidate').length, 0, '(e) no replacement happened')
}

// A viewer address from an app tab: a viewer never replaces an app tab, so it
// opens in its own tab — under the app tab's account, not the global one.
{
  const h = harness()
  const walletB = await h.openTab(WALLET_DEFAULT, 'acct-b')
  const before = h.entry(walletB.id)
  const result = await h.bar('qdn://DOCUMENT/Library/book')
  assert.equal(result.status, 'opened')
  assert.ok(result.tabId, 'viewer reports the tab it made')
  const viewer = h.entry(result.tabId)
  assert.equal(viewer.kind, 'viewer')
  assert.equal(viewer.accountId, 'acct-b', 'viewer attributed to the app tab\'s account')
  assert.deepEqual(h.entry(walletB.id), before, 'the app tab is left as it was')
}

// From an INTERNAL page (the Dashboard) the address bar keeps today's route:
// a tab of its own under the global account, deduplicated as before.
{
  const h = harness()
  const walletA = await h.openTab(WALLET_DEFAULT, 'acct-a')
  const dashboard = h.entries().find((entry) => entry.kind === 'internal')
  h.activate(dashboard.id)
  const result = await h.bar(WALLET_DEFAULT)
  assertOpened(result)
  assert.equal(h.entries().length, 2, 'from the Dashboard an identical global-account tab is activated, not duplicated')
  assert.equal(h.active().id, walletA.id)
  assert.equal(h.entry(dashboard.id).kind, 'internal', 'the Dashboard tab is not navigated')

  h.activate(dashboard.id)
  const opened = await h.bar('qdn://APP/Chat/Chat')
  assertOpened(opened)
  assert.equal(h.entries().length, 3, 'a new app from the Dashboard gets a tab of its own')
  assertBound(h.active(), 'acct-a', 'bound to the global account, as before')
}

// (f) The OPEN_CURRENT_TAB bridge path is unchanged: a bare name is refused,
// so is a Home page, and an explicit identifier replaces in place keeping the
// tab's binding.
{
  const h = harness({ published: { Explore: [{ service: 'APP', name: 'Explore', identifier: 'Explore' }] } })
  const walletB = await h.openTab(WALLET_DEFAULT, 'acct-b')
  const before = h.entry(walletB.id)

  const bare = await h.sandbox.openAddressInTab('qdn://APP/Explore', walletB.id, WALLET_DEFAULT)
  assert.equal(bare.status, 'error')
  assert.match(bare.message, /OPEN_CURRENT_TAB needs an explicit resource identifier/, '(f) bare name still refused for the bridge')
  assert.deepEqual(h.discoveries, [], '(f) the bridge never reaches discovery')
  assert.deepEqual(h.entry(walletB.id), before)

  const home = await h.sandbox.openAddressInTab('home://settings', walletB.id, WALLET_DEFAULT)
  assert.equal(home.status, 'error')
  assert.match(home.message, /Home pages cannot replace an app tab/, '(f) Home pages still refused for the bridge')
  assert.deepEqual(h.entry(walletB.id), before)
  assert.equal(h.product.current.destination, 'tab', '(f) and nothing else was opened either')

  const explicit = await h.sandbox.openAddressInTab('qdn://APP/Explore/Explore', walletB.id, WALLET_DEFAULT)
  assertOpened(explicit)
  const current = h.entry(walletB.id)
  assert.equal(current.context.resourceLocation, 'qdn://APP/Explore/Explore')
  assertBound(current, 'acct-b', '(f) OPEN_CURRENT_TAB keeps the tab\'s binding')

  // A stale fromResourceLocation (the tab has moved on) is refused as before.
  const stale = await h.sandbox.openAddressInTab('qdn://APP/Chat/Chat', walletB.id, WALLET_DEFAULT)
  assert.equal(stale.status, 'error')
  assert.match(stale.message, /no longer showing the app/)
}

// Plain openAddress (OPEN_NEW_TAB, dashboard pins, tab transfer…) keeps its
// dedupe: the same address under the same binding activates the existing tab.
{
  const h = harness()
  const walletA = await h.openTab(WALLET_DEFAULT, 'acct-a')
  await h.openTab('qdn://APP/Explore/Explore', 'acct-b')
  const result = await h.sandbox.openAddress(WALLET_DEFAULT, 'acct-a')
  assertOpened(result)
  assert.equal(h.entries().length, 3, 'no duplicate tab')
  assert.equal(h.active().id, walletA.id, 'the identical tab is activated')
  const forced = await h.sandbox.openAddress(WALLET_DEFAULT, 'acct-a', null, { forceNewTab: true })
  assert.equal(forced.status, 'opened')
  assert.ok(forced.tabId, 'a transfer still forces and reports its own tab')
  assert.equal(h.entries().length, 4)
}

console.log('Address bar navigates the current tab with that tab\'s account; bridge and new-tab routes unchanged.')
