import assert from 'node:assert/strict'
import type { HomeV2RuntimeInvalidationKind } from '../../electron/home-v2-runtime-invalidation'
import type { AppTabContext, HomeV2AccountCatalogue } from '../v2/contracts'
import type { AppTab } from '../v2/product-model'
import { createAccountRequestEpochs, isBoundAccountRequestCurrent } from './account-request-guard'

const accounts: HomeV2AccountCatalogue['accounts'] = ['A', 'B'].map((id) => ({
  address: `address-${id}`,
  addressIndex: 0,
  id,
  isUnlocked: true,
  label: id,
  supportsDerivedAddresses: true,
  walletId: `wallet-${id}`,
}))

function tab(accountId: string | null, patch: Partial<AppTabContext> = {}): AppTab {
  const context = {
    appId: 'app-chat',
    identityId: `home-v2:identity:${accountId ?? 'none'}`,
    previewUrl: null,
    resourceLocation: 'qortal://APP/Chat/default',
    sourceNetwork: 'qortal',
    tabId: 'tab-chat',
    walletRef: accountId === null ? null : `home-v2:wallet:wallet-${accountId}`,
    ...patch,
  } as AppTabContext
  return { appId: context.appId, context, id: context.tabId, title: 'Chat' }
}

const request = {
  resourceLocation: 'qortal://APP/Chat/default',
  selectedAccountId: 'A',
  tabId: 'tab-chat',
}

// Tab A remains authoritative before and after the global default changes to B.
let catalogue: HomeV2AccountCatalogue = { accounts, activeAccountId: 'A' }
const boundTabs = [tab('A')]
const epochs = createAccountRequestEpochs()
const isLifecycleCurrent = epochs.capture(request.tabId, 'qortal')
assert.equal(isBoundAccountRequestCurrent(request, boundTabs, catalogue.accounts), true)
catalogue = { ...catalogue, activeAccountId: 'B' }
assert.equal(catalogue.activeAccountId, 'B')
assert.equal(isBoundAccountRequestCurrent(request, boundTabs, catalogue.accounts), true)
assert.equal(isLifecycleCurrent(), true)
assert.equal(isBoundAccountRequestCurrent({ ...request, selectedAccountId: 'B' }, boundTabs, accounts), false)

assert.equal(isBoundAccountRequestCurrent(request, [], accounts), false)
assert.equal(isBoundAccountRequestCurrent({ ...request, tabId: 'other' }, boundTabs, accounts), false)
assert.equal(isBoundAccountRequestCurrent({ ...request, resourceLocation: 'qortal://APP/Other/default' }, boundTabs, accounts), false)
assert.equal(isBoundAccountRequestCurrent(request, [tab('B')], accounts), false)
assert.equal(isBoundAccountRequestCurrent(request, [tab('A', { walletRef: 'home-v2:wallet:wallet-B' as AppTabContext['walletRef'] })], accounts), false)
assert.equal(isBoundAccountRequestCurrent(request, [tab('A', { walletRef: null })], accounts), false)
assert.equal(isBoundAccountRequestCurrent(request, [{ ...tab('A'), context: tab('A', { tabId: 'other' as AppTabContext['tabId'] }).context }], accounts), false)
assert.equal(isBoundAccountRequestCurrent(request, boundTabs, accounts.filter((account) => account.id !== 'A')), false)
assert.equal(isBoundAccountRequestCurrent(request, boundTabs, accounts.map((account) => ({ ...account, isUnlocked: false }))), true)
assert.equal(isBoundAccountRequestCurrent(request, boundTabs, accounts.map((account) => ({ ...account, walletId: 'replacement-wallet' }))), false)

const guest = { ...request, selectedAccountId: null }
assert.equal(isBoundAccountRequestCurrent(guest, [tab(null)], []), true)
assert.equal(isBoundAccountRequestCurrent(guest, boundTabs, accounts), false)
assert.equal(isBoundAccountRequestCurrent(request, [tab(null)], accounts), false)
assert.equal(isBoundAccountRequestCurrent(guest, [tab(null, { walletRef: 'home-v2:wallet:wallet-A' as AppTabContext['walletRef'] })], accounts), false)

// Derived identities compare their exact ID, but bind to the containing wallet.
const derived = { ...accounts[0], addressIndex: 1, id: 'A:address-two' }
assert.equal(isBoundAccountRequestCurrent(
  { ...request, selectedAccountId: derived.id },
  [tab(derived.id, { walletRef: 'home-v2:wallet:wallet-A' as AppTabContext['walletRef'] })],
  [...accounts, derived],
), true)

for (const kind of ['locked', 'account-changed'] as const) {
  const state = createAccountRequestEpochs()
  const first = state.capture('one', 'qortal')
  const other = state.capture('two', 'qortium')
  state.invalidate(kind, null, null)
  assert.equal(first(), false, kind)
  assert.equal(other(), false, kind)
  const after = state.capture('one', 'qortal')
  assert.equal(after(), true)
  // An A -> B -> A catalogue or locked -> unlocked transition cannot revive it.
  assert.equal(isBoundAccountRequestCurrent(request, boundTabs, accounts), true)
  assert.equal(first(), false)
  state.invalidate(kind, null, null)
  assert.equal(after(), false)
}

for (const kind of ['navigation-changed', 'app-replaced', 'tab-closed'] as const) {
  const state = createAccountRequestEpochs()
  const old = state.capture('one', 'qortal')
  const sameTabOtherNetwork = state.capture('one', 'qortium')
  const unrelated = state.capture('two', 'qortal')
  state.invalidate(kind, 'one', null)
  assert.equal(old(), false, kind)
  assert.equal(sameTabOtherNetwork(), false, kind)
  assert.equal(unrelated(), true, kind)
  const reusedTab = state.capture('one', 'qortal')
  assert.equal(reusedTab(), true)
  assert.equal(old(), false)
  state.invalidate(kind, 'one', null)
  assert.equal(reusedTab(), false)
  assert.equal(unrelated(), true)
}

for (const network of ['qortal', 'qortium'] as const) {
  const state = createAccountRequestEpochs()
  const old = state.capture('one', network)
  const sameNetworkOtherTab = state.capture('two', network)
  const otherNetwork = state.capture('one', network === 'qortal' ? 'qortium' : 'qortal')
  state.invalidate('node-changed', null, network)
  assert.equal(old(), false)
  assert.equal(sameNetworkOtherTab(), false)
  assert.equal(otherNetwork(), true)
  const newNode = state.capture('one', network)
  state.invalidate('node-changed', null, network)
  assert.equal(newNode(), false)
  assert.equal(old(), false)
  assert.equal(otherNetwork(), true)
}

for (const kind of ['navigation-changed', 'app-replaced', 'tab-closed', 'node-changed'] satisfies HomeV2RuntimeInvalidationKind[]) {
  const state = createAccountRequestEpochs()
  const old = state.capture('one', 'qortal')
  state.invalidate(kind, null, null)
  assert.equal(old(), false, `${kind} with missing scope must fail closed`)
}

console.log('Home v2 bound account request and lifecycle guard tests passed.')
