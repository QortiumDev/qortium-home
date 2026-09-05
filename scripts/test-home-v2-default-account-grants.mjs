import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { build } from 'esbuild'
import ts from 'typescript'

// Run the actual production callback, not a parallel implementation of its
// authorization logic. Only host I/O and unused action families are stubbed.
const sourcePath = fileURLToPath(new URL('../src/home-v2-live/HomeV2LiveApp.tsx', import.meta.url))
const source = ts.createSourceFile(sourcePath, readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let callback
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'requestApp') {
    assert.ok(node.initializer && ts.isCallExpression(node.initializer))
    assert.equal(node.initializer.expression.getText(source), 'useCallback')
    assert.equal(callback, undefined, 'requestApp must be unambiguous')
    callback = node.initializer.arguments[0]
    assert.ok(ts.isArrowFunction(callback))
  }
  ts.forEachChild(node, visit)
}
visit(source)
assert.ok(callback, 'Production requestApp callback must exist')
const executable = ts.transpileModule(`(${callback.getText(source)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText

async function bundled(relativePath) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false,
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
const { createAccountRequestEpochs, isBoundAccountRequestCurrent } = await bundled('../src/home-v2-live/account-request-guard.ts')
const { createHomeV2SessionGrantStore, homeV2PermissionGrantKey, homeV2PermissionGrantFamily } = await bundled('../electron/home-v2-session-grants.ts')
const { parseAppResourceLocation, buildAppResourceLocation } = await bundled('../src/v2/resource-location.ts')
// This helper's module also contains full wallet construction. Extract only the
// real pure validity function so this test cannot accidentally initialize it.
const foreignSourcePath = fileURLToPath(new URL('../electron/home-v2-foreign-send.ts', import.meta.url))
const foreignSource = ts.createSourceFile(foreignSourcePath, readFileSync(foreignSourcePath, 'utf8'), ts.ScriptTarget.Latest, true)
const validityFunction = foreignSource.statements.find((node) =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'evaluateHomeV2ForeignSendValidity')
assert.ok(validityFunction)
const validityText = validityFunction.getText(foreignSource).replace(/^export\s+/, '')
const evaluateHomeV2ForeignSendValidity = vm.runInNewContext(ts.transpileModule(
  `${validityText}\nevaluateHomeV2ForeignSendValidity`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText)

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function createHarness() {
  const resourceLocation = 'qdn://APP/Fixture/default'
  const accounts = ['A', 'B'].map((id) => ({
    address: `fixture-${id}`, addressIndex: 0, id, isUnlocked: true,
    label: `Account ${id}`, supportsDerivedAddresses: true, walletId: `wallet-${id}`,
  }))
  const makeTab = (accountId, id = 'tab-A') => ({
    id, appId: 'fixture', title: 'Fixture',
    context: {
      appId: 'fixture', tabId: id, resourceLocation, sourceNetwork: 'qortium',
      identityId: `home-v2:identity:${accountId}`, walletRef: `home-v2:wallet:wallet-${accountId}`, previewUrl: null,
    },
  })
  const catalogue = { current: { accounts, activeAccountId: 'A' } }
  const product = { current: { tabs: [makeTab('A'), makeTab('B', 'tab-B')], activeTabId: 'tab-A' } }
  const epochs = createAccountRequestEpochs()
  const grants = createHomeV2SessionGrantStore()
  const prompts = []
  const vaultCalls = []
  const persistCalls = []
  const foreignCalls = []
  const foreignPosts = []
  const trust = { trusted: true, revision: 'fixture-revision', origin: 'https://fixture.invalid' }
  let defaultReads = 0
  const harness = {
    catalogue, product, prompts, vaultCalls, persistCalls, grants, foreignCalls, foreignPosts, trust,
    onPrompt: async () => ({ approved: true, scope: 'session' }),
    onPersist: async () => undefined,
    onEncrypt: async () => ({ encryptedData: 'fixture-ciphertext' }),
    onAdminTrust: async () => trust,
    onForeignSend: async (request) => {
      if (!await request.isStillValid()) throw new Error('Fixture refused stale foreign-send context')
      await request.approve([], { coin: 'BTC', operationLabel: 'Send BTC' })
      if (!await request.isStillValid()) throw new Error('Fixture refused stale foreign-send context')
      // Pure fake transport receipt: no real transaction, keys, or network I/O.
      return request.postTrusted('/fixture-only', 'fixture-only', 'text/plain', 64)
    },
    setDefault(accountId) { catalogue.current = { ...catalogue.current, activeAccountId: accountId } },
    invalidate(kind, tabId = null, network = null) {
      epochs.invalidate(kind, tabId, network)
      grants.invalidate('android', { kind, tabId, network })
    },
  }
  const sandbox = {
    console, crypto: webcrypto, isAndroidHost: true,
    nodeClient: {
      adminTrust: () => harness.onAdminTrust(),
      getSnapshot: async () => ({ qortium: { nodeApiUrl: trust.origin, capabilities: { read: true }, adminTrusted: true } }),
      foreignWalletPost: async (...args) => {
        foreignPosts.push(args)
        return { fixtureOnly: true }
      },
    },
    accountCatalogueRef: catalogue, productStateRef: product,
    androidAccountRequestEpochs: { current: epochs },
    androidSessionAccountGrants: { current: grants },
    isBoundAccountRequestCurrent, homeV2PermissionGrantKey, homeV2PermissionGrantFamily,
    isRecord: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
    resolveHomeV2AppAlias: (action, request) => ({ action, request }),
    parseAppResourceLocation, buildAppResourceLocation,
    resolveLaunchIdentifier: (identifier) => identifier,
    sanitizeQdnManagerAppKey: (value) => value,
    isHomeV2NotificationManagerAction: () => false,
    isHomeV2HomeSettingsAction: () => false,
    isHomeV2JournaledMutation: () => false,
    isHomeV2PollWriteAction: () => false,
    isHomeV2RatingAction: () => false,
    isHomeV2GroupMutationAction: () => false,
    isHomeV2NameWriteAction: () => false,
    isHomeV2ListAction: () => false,
    isHomeV2NodeSettingsWriteAction: () => false,
    isHomeV2PublicChatAction: () => false,
    isHomeV2DirectChatReadAction: () => false,
    isHomeV2DirectChatWriteAction: () => false,
    isHomeV2PrivateGroupChatReadAction: () => false,
    isHomeV2PrivateGroupChatWriteAction: () => false,
    isHomeV2GroupWriteAction: () => false,
    isHomeV2ForeignSendRequest: (action) => action === 'SEND_COIN',
    parseHomeV2NodesSnapshot: (value) => value,
    evaluateHomeV2ForeignSendValidity,
    HomeV2ForeignSendReconciliationError: class extends Error {},
    HomeV2ForeignSendReconciliationPendingError: class extends Error {},
    HomeV2ForeignSendError: class extends Error {},
    brand: (value) => value,
    createPermissionPrompt: (prompt) => prompt,
    snapshot: { nodes: { qortium: { ref: 'fixture-node' } } },
    hasQdnAccountCapability: async () => false,
    queueAndroidPermissionPrompt: async (prompt) => {
      prompts.push(prompt)
      return harness.onPrompt(prompt)
    },
    queueAndroidSessionGrantPermission: () => { throw new Error('Unexpected session prompt path') },
    persistDurableAccountReadGrant: async (...args) => {
      persistCalls.push(args)
      return harness.onPersist(...args)
    },
    HOME_V2_ENCRYPT_DATA_OPERATION_LABEL: 'Encrypt data',
    normalizeHomeV2EncryptDataRequest: () => ({ publicKeys: ['fixture-recipient-not-a-real-key'] }),
    androidEncryptDetails: () => [],
    vaultClient: {
      encryptData: async (request) => {
        vaultCalls.push(request)
        return harness.onEncrypt(request)
      },
      sendForeignCoin: async (request) => {
        foreignCalls.push(request)
        return harness.onForeignSend(request)
      },
    },
  }
  Object.defineProperty(sandbox, 'selectedAccountId', {
    get() { defaultReads += 1; return catalogue.current.activeAccountId },
  })
  sandbox.selectedAccountIdRef = {
    get current() { defaultReads += 1; return catalogue.current.activeAccountId },
  }
  const productionRequest = vm.runInNewContext(executable, sandbox, { filename: sourcePath })
  harness.request = (accountId = 'A', tabId = accountId === 'A' ? 'tab-A' : 'tab-B') => productionRequest(
    'qdnRequest', { action: 'ENCRYPT_DATA', data64: 'Zml4dHVyZQ==' },
    { tabId, resourceLocation, selectedAccountId: accountId, selectedAccountUnlocked: true },
  )
  harness.assertNoDefaultReads = () => assert.equal(defaultReads, 0, 'A bound request must never consult the default picker')
  harness.foreignRequest = () => productionRequest(
    'qdnRequest', { action: 'SEND_COIN', coin: 'BTC', amount: '0.00001', recipient: 'fixture-not-an-address' },
    { tabId: 'tab-A', resourceLocation, selectedAccountId: 'A', selectedAccountUnlocked: true },
  )
  return harness
}

{
  const h = createHarness()
  await h.request()
  assert.equal(h.prompts.length, 1)
  assert.equal(h.grants.size(), 1)
  h.setDefault('B')
  await h.request()
  assert.equal(h.prompts.length, 1, 'A session grant must survive default A -> B')
  assert.deepEqual(h.vaultCalls.map((call) => call.accountId), ['A', 'A'])
  await h.request('B')
  assert.equal(h.prompts.length, 2, 'Same app with account B must get separate approval')
  assert.equal(h.prompts[1].context.identityId, 'home-v2:identity:B')
  assert.equal(h.grants.size(), 2)
  h.assertNoDefaultReads()
}

{
  const h = createHarness()
  const entered = deferred()
  const answer = deferred()
  h.onPrompt = () => { entered.resolve(); return answer.promise }
  const pending = h.request()
  await entered.promise
  h.setDefault('B')
  answer.resolve({ approved: true, scope: 'session' })
  await pending
  assert.equal(h.vaultCalls.length, 1)
  assert.equal(h.vaultCalls[0].accountId, 'A')
  assert.equal(h.grants.size(), 1)
  h.assertNoDefaultReads()
}

const changes = {
  lock(h) {
    h.catalogue.current.accounts = h.catalogue.current.accounts.map((account) => ({ ...account, isUnlocked: false }))
    h.invalidate('locked')
  },
  removal(h) {
    h.catalogue.current.accounts = h.catalogue.current.accounts.filter((account) => account.id !== 'A')
    h.invalidate('locked')
  },
  'lock-unlock ABA'(h) {
    h.catalogue.current.accounts = h.catalogue.current.accounts.map((account) => ({ ...account, isUnlocked: false }))
    h.invalidate('locked')
    h.catalogue.current.accounts = h.catalogue.current.accounts.map((account) => ({ ...account, isUnlocked: true }))
    assert.equal(h.catalogue.current.accounts[0].isUnlocked, true, 'The observable catalogue has returned to unlocked A')
  },
  'tab close'(h) { h.invalidate('tab-closed', 'tab-A') },
  replacement(h) { h.invalidate('app-replaced', 'tab-A') },
  navigation(h) { h.invalidate('navigation-changed', 'tab-A') },
  'node change'(h) { h.invalidate('node-changed', null, 'qortium') },
  'binding changed without epoch'(h) {
    h.product.current.tabs = h.product.current.tabs.map((tab) => tab.id === 'tab-A'
      ? { ...tab, context: { ...tab.context, identityId: 'home-v2:identity:B' } } : tab)
  },
}

for (const [label, change] of Object.entries(changes)) {
  const h = createHarness()
  const entered = deferred()
  const answer = deferred()
  h.onPrompt = () => { entered.resolve(); return answer.promise }
  const pending = h.request()
  await entered.promise
  change(h)
  answer.resolve({ approved: true, scope: 'session' })
  await assert.rejects(pending, /denied|context changed/, label)
  assert.equal(h.vaultCalls.length, 0, `${label}: stale prompt must not reach the vault`)
  assert.equal(h.grants.size(), 0, `${label}: stale prompt must not add a session grant`)
  h.assertNoDefaultReads()
}

for (const [label, change] of Object.entries(changes)) {
  const h = createHarness()
  const persisting = deferred()
  const persisted = deferred()
  h.onPrompt = async () => ({ approved: true, scope: 'always' })
  h.onPersist = () => { persisting.resolve(); return persisted.promise }
  const pending = h.request()
  await persisting.promise
  change(h)
  persisted.resolve()
  await assert.rejects(pending, /context changed/, label)
  assert.equal(h.persistCalls.length, 1)
  assert.equal(h.vaultCalls.length, 0, `${label}: persistence completion must not reach the vault`)
  assert.equal(h.grants.size(), 0, `${label}: persistence completion must not resurrect a session grant`)
}

for (const [label, change] of Object.entries(changes)) {
  const h = createHarness()
  const encrypting = deferred()
  const encrypted = deferred()
  h.onEncrypt = () => { encrypting.resolve(); return encrypted.promise }
  const pending = h.request()
  await encrypting.promise
  change(h)
  encrypted.resolve({ encryptedData: 'must-not-be-returned' })
  await assert.rejects(pending, /context changed/, label)
  assert.equal(h.vaultCalls.length, 1, `${label}: completed stale crypto must not return its result to the app`)
}

// Unlike ENCRYPT_DATA, this arm previously compared the global default ref.
// Its actual supplied isStillValid must now authorize bound A under default B.
{
  const h = createHarness()
  h.setDefault('B')
  h.onPrompt = async () => ({ approved: true, scope: 'single-request' })
  await h.foreignRequest()
  assert.equal(h.foreignCalls.length, 1)
  assert.equal(h.foreignCalls[0].accountId, 'A')
  assert.equal(h.prompts.length, 1)
  assert.equal(h.prompts[0].context.identityId, 'home-v2:identity:A')
  assert.equal(h.foreignPosts.length, 1)
  assert.equal(h.grants.size(), 0, 'A foreign send never creates session authority')
  h.assertNoDefaultReads()
}

for (const [label, mutate, expected] of [
  ['default A -> B', (h) => h.setDefault('B'), true],
  ['lock-unlock ABA', changes['lock-unlock ABA'], false],
  ['node change', changes['node change'], false],
]) {
  const h = createHarness()
  const resolving = deferred()
  const resolved = deferred()
  h.onForeignSend = async (request) => {
    h.onAdminTrust = () => { resolving.resolve(); return resolved.promise }
    const valid = await request.isStillValid()
    assert.equal(valid, expected, `${label} across async route resolution`)
    if (!valid) throw new Error('Fixture refused stale foreign-send context')
    return { fixtureOnly: true }
  }
  const pending = h.foreignRequest()
  await resolving.promise
  mutate(h)
  resolved.resolve(h.trust)
  if (expected) await pending
  else await assert.rejects(pending, /stale foreign-send context/)
  assert.equal(h.foreignPosts.length, 0)
  h.assertNoDefaultReads()
}

{
  const h = createHarness()
  const persisting = deferred()
  const persisted = deferred()
  h.onPrompt = async () => ({ approved: true, scope: 'always' })
  h.onPersist = () => { persisting.resolve(); return persisted.promise }
  const pending = h.request()
  await persisting.promise
  h.setDefault('B')
  persisted.resolve()
  await pending
  assert.equal(h.vaultCalls[0].accountId, 'A')
  assert.equal(h.grants.size(), 1, 'Default selection during persistence must retain A session authority')
  h.assertNoDefaultReads()
}

// Scoped lifecycle changes must not deny unrelated pending approvals.
for (const [kind, tabId, network] of [
  ['tab-closed', 'tab-B', null],
  ['node-changed', null, 'qortal'],
]) {
  const h = createHarness()
  const entered = deferred()
  const answer = deferred()
  h.onPrompt = () => { entered.resolve(); return answer.promise }
  const pending = h.request()
  await entered.promise
  h.invalidate(kind, tabId, network)
  answer.resolve({ approved: true, scope: 'session' })
  await pending
  assert.equal(h.vaultCalls.length, 1)
  assert.equal(h.grants.size(), 1)
}

console.log('Home v2 production Android default-account grant and approval-race tests passed.')
