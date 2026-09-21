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
const tabGroups = await bundled('../src/v2/shell/tab-groups.ts')
const activeTabGroup = await bundled('../src/home-v2-live/active-tab-group-account.ts')
const savedBookmarks = await bundled('../electron/bookmark-manager-contract.ts')

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
    ...productModel, ...resourceLocation, ...newTabPreference, ...viewerLocation, ...accountContext, ...activeTabGroup,
    // The stored (global) selection, as the component's `selectedAccountId` state.
    selectedAccountId: 'acct-a',
    ...tabGroups,
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
  // The ref mirror the component keeps in step with the state.
  sandbox.selectedAccountIdRef = { get current() { return sandbox.selectedAccountId } }
  sandbox.brand = declaration('brand', sandbox)
  sandbox.HOME_V2_BIND_NO_ACCOUNT = callback('HOME_V2_BIND_NO_ACCOUNT', sandbox)
  sandbox.assertHomeV2ReplaceableTab = declaration('assertHomeV2ReplaceableTab', sandbox)
  sandbox.assertHomeV2AddressBarTabInFront = declaration('assertHomeV2AddressBarTabInFront', sandbox)
  sandbox.captureHomeV2InPlaceTarget = declaration('captureHomeV2InPlaceTarget', sandbox)
  sandbox.assertHomeV2InPlaceTargetInFront = declaration('assertHomeV2InPlaceTargetInFront', sandbox)
  sandbox.openApp = callback('openApp', sandbox)
  sandbox.appTabContext = callback('appTabContext', sandbox)
  sandbox.openAppHere = callback('openAppHere', sandbox)
  sandbox.replaceTabWithApp = callback('replaceTabWithApp', sandbox)
  sandbox.openViewer = callback('openViewer', sandbox)
  sandbox.openAddress = callback('openAddress', sandbox)
  sandbox.openAddressInTab = callback('openAddressInTab', sandbox)
  sandbox.openAddressFromAddressBar = callback('openAddressFromAddressBar', sandbox)
  sandbox.activeDashboardTabId = callback('activeDashboardTabId', sandbox)
  sandbox.activeTabGroupBinding = callback('activeTabGroupBinding', sandbox)
  sandbox.openInternalTabInActiveGroup = callback('openInternalTabInActiveGroup', sandbox)
  sandbox.openAddressForNewTab = callback('openAddressForNewTab', sandbox)
  sandbox.openAddressFromDashboard = callback('openAddressFromDashboard', sandbox)
  sandbox.SAVED_GUEST_ACCOUNT_ID = savedBookmarks.SAVED_GUEST_ACCOUNT_ID
  sandbox.savedAccountBinding = declaration('savedAccountBinding', sandbox)
  sandbox.openDashboardPin = callback('openDashboardPin', sandbox)
  sandbox.openBookmarkToolbarLink = callback('openBookmarkToolbarLink', sandbox)

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
  /** The strip's group key for a tab, as the chrome would draw it. */
  const groupOf = (tabId) => tabGroups.tabGroupKey(
    tabGroups.tabGroupAccountId(entry(tabId), { dashboardAccountId: sandbox.selectedAccountId }))
  return { sandbox, product, effects, notices, discoveries, openTab, activate, entries, active, entry, bar, groupOf }
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

// From an INTERNAL page (the Dashboard, Settings…) the address bar navigates
// THAT tab in place, like a browser: the page becomes the app, bound to the
// page's group, and no new tab appears — even when the same app is already
// open elsewhere.
{
  // (a) Dashboard active, typed app address.
  const h = harness()
  const walletA = await h.openTab(WALLET_DEFAULT, 'acct-a')
  const dashboard = h.entries().find((entry) => entry.kind === 'internal')
  h.activate(dashboard.id)
  const result = await h.bar('qdn://APP/Chat/Chat')
  assert.equal(result.status, 'opened')
  assert.equal(result.tabId, dashboard.id, '(a) the Dashboard tab itself became the app')
  assert.equal(h.entries().length, 2, '(a) tab count unchanged, no new tab')
  assert.equal(h.active().id, dashboard.id)
  assertBound(h.entry(dashboard.id), 'acct-a', '(a) bound to the Dashboard\'s group')
  assert.equal(h.entries().some((entry) => entry.kind === 'internal'), false, '(a) no Dashboard remains')
  assert.deepEqual(h.entry(walletA.id).context.resourceLocation, WALLET_DEFAULT, '(a) the other tab is untouched')
}
{
  // (a') The same app already open in another tab is NOT deduplicated onto: the page still becomes the app.
  const h = harness()
  const walletA = await h.openTab(WALLET_DEFAULT, 'acct-a')
  const dashboard = h.entries().find((entry) => entry.kind === 'internal')
  h.activate(dashboard.id)
  await h.bar(WALLET_DEFAULT)
  assert.equal(h.entries().length, 2)
  assert.equal(h.active().id, dashboard.id, '(a\') the user stays in the Dashboard tab, now the app')
  assertBound(h.entry(dashboard.id), 'acct-a', '(a\') bound to the group')
  assert.equal(h.entry(walletA.id).kind, 'app')
}
{
  // (b) Bare name with one candidate; then a bare name with two → chooser → choice in place.
  const h = harness({ published: {
    Explore: [{ service: 'APP', name: 'Explore', identifier: 'Explore' }],
    Wallet: [{ service: 'APP', name: 'Wallet', identifier: 'Wallet' }, { service: 'APP', name: 'Wallet', identifier: 'Wallet-beta' }],
  } })
  h.sandbox.selectedAccountId = 'acct-b'
  const dashboard = h.entries().find((entry) => entry.kind === 'internal')
  const one = await h.bar('qdn://APP/Explore')
  assert.equal(one.status, 'opened')
  assert.equal(one.tabId, dashboard.id, '(b) one candidate: in place')
  assert.equal(h.entries().length, 1)
  assertBound(h.entry(dashboard.id), 'acct-b', '(b) bound to the Dashboard\'s group (the selection)')

  const h2 = harness({ published: {
    Wallet: [{ service: 'APP', name: 'Wallet', identifier: 'Wallet' }, { service: 'APP', name: 'Wallet', identifier: 'Wallet-beta' }],
  } })
  h2.sandbox.openInternalTabInActiveGroup('newtab')
  const page = h2.active()
  assert.equal(page.kind, 'internal')
  const choose = await h2.bar('qdn://APP/Wallet')
  assert.equal(choose.status, 'choose', '(b) two candidates: the chooser')
  assert.equal(h2.entry(page.id).kind, 'internal', '(b) nothing navigated while the choice is pending')
  const chosen = await h2.bar(choose.options[1].address)
  assert.equal(chosen.status, 'opened')
  assert.equal(chosen.tabId, page.id, '(b) the choice navigates the page in place')
  assert.equal(h2.entry(page.id).context.resourceLocation, 'qdn://APP/Wallet/Wallet-beta')
  assertBound(h2.entry(page.id), 'acct-a', '(b) bound to the page\'s group')
  assert.equal(h2.entries().length, 2)
}
{
  // (c) A Home page typed from the Dashboard replaces the Dashboard in place, keeping its group.
  const h = harness()
  const dashboard = h.entries().find((entry) => entry.kind === 'internal')
  const result = await h.bar('home://settings')
  assert.equal(result.status, 'opened')
  assert.equal(result.tabId, dashboard.id, '(c) Settings shown in that tab')
  assert.equal(h.entries().length, 1, '(c) no tab stacked')
  assert.equal(h.entry(dashboard.id).page, 'settings')
  assert.equal(h.entry(dashboard.id).accountId, 'acct-a', '(c) the page keeps the Dashboard\'s group')
  assert.equal(h.product.current.destination, 'settings')
  // And from a page opened into B's group, the group is kept too.
  h.sandbox.dispatchProduct({ type: 'open-internal', page: 'newtab', tabId: 'page-b', accountId: 'acct-b' })
  const page = h.active()
  assert.equal(page.accountId, 'acct-b')
  await h.bar('home://settings')
  assert.equal(h.entry(page.id).page, 'settings')
  assert.equal(h.entry(page.id).accountId, 'acct-b')
  // Core docs are transient: shown over the page, which is left as it was.
  const before = h.entry(page.id)
  await h.bar('core://api-documentation')
  assert.deepEqual(h.entry(page.id), before)
  assert.equal(h.product.current.transient, 'core-docs')
}
{
  // (d) Tab switched mid-discovery → refused (compare-and-swap), nothing activated, no tab opened.
  const h = harness()
  let release
  h.sandbox.nodeClient.listAppResources = () => new Promise((resolve) => { release = resolve })
  const walletA = await h.openTab(WALLET_DEFAULT, 'acct-a')
  const dashboard = h.entries().find((entry) => entry.kind === 'internal')
  h.activate(dashboard.id)
  const pending = h.bar('qdn://APP/Chat')
  await new Promise((resolve) => setImmediate(resolve))
  h.activate(walletA.id)
  release([{ service: 'APP', name: 'Chat', identifier: 'Chat' }])
  const result = await pending
  assert.equal(result.status, 'error')
  assert.match(result.message, /no longer the one in front/, '(d) refused')
  assert.equal(h.entry(dashboard.id).kind, 'internal', '(d) the Dashboard was not replaced')
  assert.equal(h.active().id, walletA.id, '(d) nothing activated')
  assert.equal(h.entries().length, 2, '(d) no tab opened')
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

// ---- New tabs and the selected account follow the active tab group -------

// (a) "+" from account B's app tab (global selection A): the new internal
// page opens INTO B's group, and is the active tab.
{
  const h = harness()
  const walletB = await h.openTab(WALLET_DEFAULT, 'acct-b')
  assert.equal(h.groupOf(walletB.id), 'account:acct-b')
  h.sandbox.openInternalTabInActiveGroup('newtab')
  const page = h.active()
  assert.equal(page.kind, 'internal')
  assert.equal(page.page, 'newtab')
  assert.equal(page.accountId, 'acct-b', '(a) the page carries B\'s group')
  assert.equal(h.groupOf(page.id), 'account:acct-b', '(a) and the strip draws it in B\'s group')
  assert.equal(h.sandbox.selectedAccountId, 'acct-a', '(a) the stored selection itself is not touched by the open')
  // From that page, "+" again stays in B's group; so does an address typed
  // into it (the address bar's internal-page route now binds to the group).
  h.sandbox.openInternalTabInActiveGroup('settings')
  assert.equal(h.active().accountId, 'acct-b')
  await h.bar('qdn://APP/Chat/Chat')
  assertBound(h.active(), 'acct-b', '(a) an address typed into that page binds to B, not the selected A')
}

// (b) "+" with a custom new-tab address from B's tab → an app tab bound to
// B, not to the selected A; the ordinary dedupe still applies.
{
  const h = harness()
  const walletB = await h.openTab(WALLET_DEFAULT, 'acct-b')
  const result = await h.sandbox.openAddressForNewTab('qdn://APP/Chat/Chat')
  assertOpened(result)
  assert.equal(h.entries().length, 3, '(b) a tab of its own')
  assertBound(h.active(), 'acct-b', '(b) bound to the group\'s account')
  assert.notEqual(h.active().id, walletB.id, '(b) the tab the user was in is untouched')
  h.activate(walletB.id)
  await h.sandbox.openAddressForNewTab('qdn://APP/Chat/Chat')
  assert.equal(h.entries().length, 3, '(b) an identical tab under B is brought forward, not duplicated')
}

// (c) A Dashboard in B's group (selection B): its tiles/links navigate the
// Dashboard tab in place, bound to B.
{
  const h = harness()
  h.sandbox.selectedAccountId = 'acct-b'
  const dashboard = h.entries().find((entry) => entry.kind === 'internal' && entry.page === 'dashboard')
  assert.equal(h.groupOf(dashboard.id), 'account:acct-b')
  const result = await h.sandbox.openAddressFromDashboard('qdn://APP/Chat/Chat')
  assert.equal(result.status, 'opened')
  assert.equal(result.tabId, dashboard.id, '(c) the Dashboard tab itself became the app')
  assertBound(h.entry(dashboard.id), 'acct-b', '(c) bound to the Dashboard\'s group')
  assert.equal(h.entries().length, 1)
}

// (e) The no-account group: "+" opens the page into that group, a custom
// address binds to the explicit no-account identity — never the selected A.
{
  const h = harness()
  const guest = await h.openTab(WALLET_DEFAULT, h.sandbox.HOME_V2_BIND_NO_ACCOUNT)
  assert.equal(h.groupOf(guest.id), 'home')
  h.sandbox.openInternalTabInActiveGroup('newtab')
  assert.equal(h.active().accountId, null, '(e) the page names the no-account group')
  await h.bar('qdn://APP/Explore/Explore')
  assert.equal(h.active().context.identityId, 'home-v2:identity:none', '(e) an address typed into that page is no-account too')
  h.activate(guest.id)
  await h.sandbox.openAddressForNewTab('qdn://APP/Chat/Chat')
  assert.equal(h.active().context.identityId, 'home-v2:identity:none', '(e) explicit no-account')
  assert.equal(h.active().context.walletRef, null)
  // A removed account is the same: no-account, not the selected one.
  const walletB = await h.openTab('qdn://APP/Explore/Explore', 'acct-b')
  h.sandbox.accountCatalogueRef.current = { accounts: ACCOUNTS.filter((a) => a.id !== 'acct-b'), activeAccountId: 'acct-a' }
  await h.sandbox.openAddressForNewTab('qdn://APP/Chat/Chat')
  assert.equal(h.active().context.identityId, 'home-v2:identity:none', '(e) removed account → no-account')
  assert.notEqual(h.active().id, walletB.id)
}

// Dashboard pins and toolbar links. A PLAIN click from the Dashboard
// navigates that tab in place whatever account the item is saved for — no
// Dashboard remains open, so nothing else changes. A NEW-TAB request
// (middle/Ctrl-click, "Open in new tab") opens BEHIND the Dashboard: it stays
// the active tab, its group and the selection are untouched, and the follow
// effect — keyed on the active tab — has nothing to do.
for (const surface of ['pin', 'toolbar']) {
  const open = (h, item, options) => surface === 'pin'
    ? h.sandbox.openDashboardPin({ id: 'p', title: 'x', ...item }, options)
    : h.sandbox.openBookmarkToolbarLink({ id: 'l', title: 'x', ...item }, options)
  const follow = (h) => activeTabGroup.tabGroupAccountToFollow(h.product.current, h.sandbox.selectedAccountId, h.sandbox.accountCatalogueRef.current)

  // (a) plain click on an item saved for account B from a Dashboard in A's group
  {
    const h = harness()
    const dashboard = h.entries().find((entry) => entry.kind === 'internal' && entry.page === 'dashboard')
    assert.equal(h.groupOf(dashboard.id), 'account:acct-a')
    await open(h, { displayUrl: 'qdn://APP/Chat/Chat', accountId: 'acct-b' }, { newTab: false })
    assert.equal(h.entries().length, 1, `(a) ${surface}: tab count unchanged`)
    assert.equal(h.entries().some((entry) => entry.kind === 'internal' && entry.page === 'dashboard'), false, `(a) ${surface}: no Dashboard entry left`)
    assert.equal(h.active().id, dashboard.id, `(a) ${surface}: the Dashboard tab itself became the app`)
    assertBound(h.active(), 'acct-b', `(a) ${surface}: bound to the saved account`)
    assert.equal(follow(h), 'acct-b', `(a) ${surface}: the user is now in B's group, so the selection may follow`)
  }

  // (b) middle-click / "Open in new tab" on the same item
  {
    const h = harness()
    const dashboard = h.entries().find((entry) => entry.kind === 'internal' && entry.page === 'dashboard')
    await open(h, { displayUrl: 'qdn://APP/Chat/Chat', accountId: 'acct-b' }, { newTab: true })
    assert.equal(h.entries().length, 2, `(b) ${surface}: a new tab`)
    assert.equal(h.active().id, dashboard.id, `(b) ${surface}: the Dashboard is still the active tab`)
    assert.equal(h.entry(dashboard.id).kind, 'internal', `(b) ${surface}: and still the Dashboard`)
    const opened = h.entries().find((entry) => entry.id !== dashboard.id)
    assertBound(opened, 'acct-b', `(b) ${surface}: the background tab is bound to the saved account`)
    assert.equal(h.sandbox.selectedAccountId, 'acct-a', `(b) ${surface}: the selection is still A`)
    assert.equal(h.groupOf(dashboard.id), 'account:acct-a', `(b) ${surface}: the Dashboard is still in A's group`)
    assert.equal(follow(h), null, `(b) ${surface}: the follower has no select to issue`)
    // The same item again in the background: the identical tab is left where it is, nothing activated.
    await open(h, { displayUrl: 'qdn://APP/Chat/Chat', accountId: 'acct-b' }, { newTab: true })
    assert.equal(h.entries().length, 2)
    assert.equal(h.active().id, dashboard.id)
  }

  // (c) an item saved WITHOUT an account: plain → in place bound to the Dashboard's group; new-tab → background, same binding
  {
    const h = harness()
    const dashboard = h.entries().find((entry) => entry.kind === 'internal' && entry.page === 'dashboard')
    await open(h, { displayUrl: 'qdn://APP/Explore/Explore', accountId: null }, { newTab: true })
    assert.equal(h.active().id, dashboard.id, `(c) ${surface}: background tab, Dashboard still active`)
    assertBound(h.entries().find((entry) => entry.id !== dashboard.id), 'acct-a', `(c) ${surface}: bound to the Dashboard's group`)
    await open(h, { displayUrl: 'qdn://APP/Chat/Chat', accountId: null }, { newTab: false })
    assert.equal(h.active().id, dashboard.id)
    assertBound(h.entry(dashboard.id), 'acct-a', `(c) ${surface}: plain click replaced the Dashboard in place, bound to A`)
    assert.equal(h.entries().length, 2)
  }

  // A guest item keeps its explicit no-account binding on both routes.
  {
    const h = harness()
    const dashboard = h.entries().find((entry) => entry.kind === 'internal' && entry.page === 'dashboard')
    await open(h, { displayUrl: 'qdn://APP/Explore/Explore', accountId: h.sandbox.SAVED_GUEST_ACCOUNT_ID }, { newTab: true })
    assert.equal(h.entries().find((entry) => entry.id !== dashboard.id).context.identityId, 'home-v2:identity:none')
    assert.equal(h.active().id, dashboard.id)
    await open(h, { displayUrl: 'qdn://APP/Chat/Chat', accountId: h.sandbox.SAVED_GUEST_ACCOUNT_ID }, { newTab: false })
    assert.equal(h.entry(dashboard.id).context.identityId, 'home-v2:identity:none', `${surface}: guest item in place is no-account`)
  }

  // From an APP tab (toolbar links are reachable there): a plain click still
  // opens (and activates) its own tab; a new-tab request opens behind.
  if (surface === 'toolbar') {
    const h = harness()
    const walletA = await h.openTab(WALLET_DEFAULT, 'acct-a')
    await open(h, { displayUrl: 'qdn://APP/Chat/Chat', accountId: 'acct-b' }, { newTab: true })
    assert.equal(h.active().id, walletA.id, 'toolbar from an app tab: background open leaves the app tab active')
    await open(h, { displayUrl: 'qdn://APP/Explore/Explore', accountId: null }, { newTab: false })
    assert.notEqual(h.active().id, walletA.id, 'toolbar from an app tab: a plain click opens its own tab, activated')
    assert.equal(h.entry(walletA.id).context.resourceLocation, WALLET_DEFAULT, 'and never replaces the app tab')
    assertBound(h.active(), 'acct-a', 'bound to the app tab\'s group when the link has no saved account')
  }
}

// An in-place Dashboard open is a compare-and-swap around its async work.
// A pin with a bare name goes through discovery; if the user switched tabs
// meanwhile, or the Dashboard tab became Settings, the late result is refused:
// nothing replaced, nothing activated, the other page untouched.
{
  const h = harness()
  let release
  h.sandbox.nodeClient.listAppResources = () => new Promise((resolve) => { release = resolve })
  const dashboard = h.entries().find((entry) => entry.kind === 'internal' && entry.page === 'dashboard')
  const walletA = await h.openTab(WALLET_DEFAULT, 'acct-a')
  h.activate(dashboard.id)
  const pending = h.sandbox.openDashboardPin({ id: 'p', title: 'Chat', displayUrl: 'qdn://APP/Chat', accountId: null })
  await new Promise((resolve) => setImmediate(resolve))
  h.activate(walletA.id)
  release([{ service: 'APP', name: 'Chat', identifier: 'Chat' }])
  await assert.rejects(pending, /no longer the one in front/, 'switched tabs mid-discovery: refused')
  assert.equal(h.entry(dashboard.id).kind, 'internal', 'the Dashboard was not replaced')
  assert.equal(h.entry(dashboard.id).page, 'dashboard')
  assert.equal(h.active().id, walletA.id, 'nothing was activated')
  assert.equal(h.entries().length, 2, 'and no tab was opened elsewhere')
}
{
  const h = harness()
  let release
  h.sandbox.nodeClient.listAppResources = () => new Promise((resolve) => { release = resolve })
  const dashboard = h.entries().find((entry) => entry.kind === 'internal' && entry.page === 'dashboard')
  const pending = h.sandbox.openDashboardPin({ id: 'p', title: 'Chat', displayUrl: 'qdn://APP/Chat', accountId: null })
  await new Promise((resolve) => setImmediate(resolve))
  // The Dashboard tab became Settings (its own links do this in place).
  h.sandbox.dispatchProduct({ type: 'show-internal-here', page: 'settings', tabId: dashboard.id, accountId: 'acct-a' })
  release([{ service: 'APP', name: 'Chat', identifier: 'Chat' }])
  await assert.rejects(pending, /no longer the one in front/, 'Dashboard became Settings mid-discovery: refused')
  assert.equal(h.entry(dashboard.id).kind, 'internal', 'Settings untouched')
  assert.equal(h.entry(dashboard.id).page, 'settings')
  assert.equal(h.entries().length, 1)
}
// The selection moving mid-discovery moves the Dashboard to another group:
// that is a different target too, and is refused.
{
  const h = harness()
  let release
  h.sandbox.nodeClient.listAppResources = () => new Promise((resolve) => { release = resolve })
  const dashboard = h.entries().find((entry) => entry.kind === 'internal' && entry.page === 'dashboard')
  const pending = h.sandbox.openDashboardPin({ id: 'p', title: 'Chat', displayUrl: 'qdn://APP/Chat', accountId: null })
  await new Promise((resolve) => setImmediate(resolve))
  h.sandbox.selectedAccountId = 'acct-b'
  release([{ service: 'APP', name: 'Chat', identifier: 'Chat' }])
  await assert.rejects(pending, /no longer the one in front/, 'Dashboard changed group mid-discovery: refused')
  assert.equal(h.entry(dashboard.id).kind, 'internal')
}
// A Dashboard that is no longer in front when the click's own await ends
// (Apps / Explore read settings first) is refused as well, not redirected.
{
  const h = harness()
  const dashboard = h.entries().find((entry) => entry.kind === 'internal' && entry.page === 'dashboard')
  const walletA = await h.openTab(WALLET_DEFAULT, 'acct-a')
  const result = await h.sandbox.openAddress('qdn://APP/Chat/Chat', 'acct-a', null, { inTab: dashboard.id })
  assert.equal(result.status, 'error')
  assert.match(result.message, /no longer the one in front/)
  assert.equal(h.entries().length, 2, 'no new tab either')
  assert.equal(h.active().id, walletA.id)
}
// And the reducer is the last line of defence: open-app-here with an
// expectedPage refuses a tab showing another page.
{
  const h = harness()
  const dashboard = h.entries().find((entry) => entry.kind === 'internal' && entry.page === 'dashboard')
  h.sandbox.dispatchProduct({ type: 'show-internal-here', page: 'settings', tabId: dashboard.id })
  const app = { id: 'home-v2:app:qortium:Chat:Chat', title: 'Chat', description: '', category: 'utility', sourceNetwork: 'qortium',
    resourceIdentity: { service: 'APP', name: 'Chat', identifier: 'Chat' }, targetNetworks: ['qortium'], placement: 'recommended' }
  assert.throws(() => h.sandbox.dispatchProduct({ type: 'open-app-here', app, tabId: dashboard.id, expectedPage: 'dashboard', context: {
    appId: app.id, tabId: dashboard.id, sourceNetwork: 'qortium', previewUrl: null, resourceLocation: 'qdn://APP/Chat/Chat',
    identityId: 'home-v2:identity:acct-a', walletRef: 'home-v2:wallet:wallet-a' } }), /no longer showing the dashboard page/)
  assert.equal(h.entry(dashboard.id).page, 'settings')
}

// (d) The selection follows the group the user moves into: what the follow
// effect would select after each activation, on real product state.
{
  const h = harness()
  const walletA = await h.openTab(WALLET_DEFAULT, 'acct-a')
  const walletB = await h.openTab('qdn://APP/Explore/Explore', 'acct-b')
  const guest = await h.openTab('qdn://APP/Chat/Chat', h.sandbox.HOME_V2_BIND_NO_ACCOUNT)
  const follow = () => activeTabGroup.tabGroupAccountToFollow(h.product.current, h.sandbox.selectedAccountId, h.sandbox.accountCatalogueRef.current)
  h.activate(walletB.id)
  assert.equal(follow(), 'acct-b', '(d) A → B')
  h.sandbox.selectedAccountId = 'acct-b'
  h.activate(walletA.id)
  assert.equal(follow(), 'acct-a', '(d) B → A')
  h.sandbox.selectedAccountId = 'acct-a'
  h.activate(guest.id)
  assert.equal(follow(), null, '(d) the no-account group leaves the selection alone')
  h.sandbox.dispatchProduct({ type: 'close-tab', tabId: guest.id })
  assert.equal(h.active().id, walletB.id, 'closing activates the neighbour')
  assert.equal(follow(), 'acct-b', '(d) …and the selection follows that neighbour\'s group')
}

console.log('Address bar navigates the current tab with that tab\'s account; new tabs and the selection follow the active tab group; bridge routes unchanged.')
