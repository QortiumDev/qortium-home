import assert from 'node:assert/strict'
import type { AppDescriptor, TabId } from '../v2/contracts'
import { createProductState, reduceProductState, restoreProductState, type ProductState } from '../v2/product-model'
import { tabGroupAccountId } from '../v2/shell/tab-groups'
import { reduceTabNavigation } from './tab-navigation'
import {
  activeTabGroupAccountId,
  activeTabGroupOpenAccountId,
  tabGroupAccountToFollow,
} from './active-tab-group-account'

const catalogue = { accounts: [
  { id: 'acct-a', walletId: 'wallet-a' },
  { id: 'acct-b', walletId: 'wallet-b' },
] } as unknown as Parameters<typeof tabGroupAccountToFollow>[2]

const app = (name: string): AppDescriptor => ({
  id: `home-v2:app:qortium:${name}:${name}`, title: name, description: '', category: 'utility',
  sourceNetwork: 'qortium', resourceIdentity: { service: 'APP', name, identifier: name },
  targetNetworks: ['qortium'], placement: 'recommended',
} as unknown as AppDescriptor)

function openApp(state: ProductState, tabId: string, name: string, accountId: string | null): ProductState {
  return reduceProductState(state, { type: 'open-app', app: app(name), tabId: tabId as TabId, context: {
    appId: app(name).id, tabId: tabId as TabId, sourceNetwork: 'qortium', previewUrl: null,
    resourceLocation: `qdn://APP/${name}/${name}`,
    identityId: accountId ? `home-v2:identity:${accountId}` : 'home-v2:identity:none',
    walletRef: accountId ? `home-v2:wallet:wallet-${accountId.slice(-1)}` : null,
  } as never })
}
const activate = (state: ProductState, tabId: string) =>
  reduceProductState(state, { type: 'activate-tab', tabId: tabId as TabId })

// (d) Moving between groups: the account to follow flips A → B → A, is null
// while the selection already matches, and never names an account the
// catalogue no longer has.
{
  let state = openApp(createProductState(), 'a', 'Wallet', 'acct-a')
  state = openApp(state, 'b', 'Wallet', 'acct-b')
  assert.equal(activeTabGroupAccountId(state, 'acct-a'), 'acct-b')
  assert.equal(tabGroupAccountToFollow(state, 'acct-a', catalogue), 'acct-b', "into B's group from A selected")
  assert.equal(tabGroupAccountToFollow(state, 'acct-b', catalogue), null, 'already B: nothing to do')
  state = activate(state, 'a')
  assert.equal(tabGroupAccountToFollow(state, 'acct-b', catalogue), 'acct-a', "back into A's group")
  state = openApp(state, 'gone', 'Wallet', 'acct-gone')
  assert.equal(activeTabGroupAccountId(state, 'acct-a'), 'acct-gone')
  assert.equal(tabGroupAccountToFollow(state, 'acct-a', catalogue), null, 'a removed account is not followed')
  assert.equal(activeTabGroupOpenAccountId(state, 'acct-a', catalogue), null, 'and an open from it is no-account, not A')
}

// (e) The no-account group: the explicit no-account binding for opens, and
// no change to the selection.
{
  const state = openApp(createProductState(), 'guest', 'Wallet', null)
  assert.equal(activeTabGroupAccountId(state, 'acct-a'), null)
  assert.equal(activeTabGroupOpenAccountId(state, 'acct-a', catalogue), null, 'never the selected account')
  assert.equal(tabGroupAccountToFollow(state, 'acct-a', catalogue), null, 'the selection is left alone')
}

// The Dashboard sits with the selection; a page opened into a group names
// that group; a page from before pages carried one falls back to the
// selection for opens and never moves it.
{
  let state = createProductState()
  assert.equal(activeTabGroupAccountId(state, 'acct-b'), 'acct-b', 'Dashboard: the selected account')
  assert.equal(activeTabGroupOpenAccountId(state, 'acct-b', catalogue), 'acct-b')
  assert.equal(tabGroupAccountToFollow(state, 'acct-b', catalogue), null)
  assert.equal(activeTabGroupOpenAccountId(state, null, catalogue), null, 'Dashboard with nothing selected: no account')

  state = reduceProductState(state, { type: 'open-internal', page: 'newtab', tabId: 'nt-b' as TabId, accountId: 'acct-b' })
  assert.equal(activeTabGroupAccountId(state, 'acct-a'), 'acct-b', "a page opened into B's group")
  assert.equal(tabGroupAccountId(state.entries.find((entry) => entry.id === 'nt-b')!, { dashboardAccountId: 'acct-a' }), 'acct-b')
  assert.equal(tabGroupAccountToFollow(state, 'acct-a', catalogue), 'acct-b', 'activating it moves the selection to B')
  assert.equal(activeTabGroupOpenAccountId(state, 'acct-a', catalogue), 'acct-b')

  state = reduceProductState(state, { type: 'open-internal', page: 'settings', tabId: 'legacy' as TabId })
  assert.equal(activeTabGroupAccountId(state, 'acct-a'), undefined, 'a page that names no group')
  assert.equal(activeTabGroupOpenAccountId(state, 'acct-a', catalogue), 'acct-a', 'falls back to the selection')
  assert.equal(tabGroupAccountToFollow(state, 'acct-a', catalogue), null, 'and never moves it')

  state = reduceProductState(state, { type: 'open-internal', page: 'settings', tabId: 'guest-page' as TabId, accountId: null })
  assert.equal(activeTabGroupAccountId(state, 'acct-a'), null, 'a page opened into the no-account group')
  assert.equal(activeTabGroupOpenAccountId(state, 'acct-a', catalogue), null)
}

// The group survives a save and restore, and is ignored on disk data that
// carries no field or a malformed one.
{
  let state = createProductState()
  state = reduceProductState(state, { type: 'open-internal', page: 'newtab', tabId: 'nt-b' as TabId, accountId: 'acct-b' })
  state = reduceProductState(state, { type: 'open-internal', page: 'settings', tabId: 'guest' as TabId, accountId: null })
  const restored = restoreProductState(JSON.parse(JSON.stringify(state)))
  assert.equal((restored.entries.find((entry) => entry.id === 'nt-b') as { accountId?: string | null }).accountId, 'acct-b')
  assert.equal((restored.entries.find((entry) => entry.id === 'guest') as { accountId?: string | null }).accountId, null)
  const malformed = restoreProductState({ ...JSON.parse(JSON.stringify(state)), entries: [
    { kind: 'internal', id: 'nt-b', page: 'newtab', accountId: 42 },
    { kind: 'internal', id: 'long', page: 'newtab', accountId: 'x'.repeat(401) },
  ] })
  assert.equal('accountId' in malformed.entries.find((entry) => entry.id === 'nt-b')!, false)
  assert.equal('accountId' in malformed.entries.find((entry) => entry.id === 'long')!, false)
  // The Dashboard never carries the field: it sits with the selection.
  const dashboard = reduceProductState(createProductState(), { type: 'open-internal', page: 'dashboard', tabId: 'd2' as TabId, accountId: 'acct-b' })
  assert.ok(dashboard.entries.every((entry) => !('accountId' in entry)), 'open-internal drops it for the Dashboard')
  const shown = reduceProductState(state, { type: 'show-internal-here', page: 'dashboard', tabId: 'guest' as TabId, accountId: 'acct-b' })
  assert.equal('accountId' in shown.entries.find((entry) => entry.id === 'guest')!, false, 'show-internal-here drops it too')
  const fromDisk = restoreProductState({ ...JSON.parse(JSON.stringify(state)), entries: [
    { kind: 'internal', id: 'd3', page: 'dashboard', accountId: 'acct-b' },
  ] })
  assert.equal('accountId' in fromDisk.entries.find((entry) => entry.id === 'd3')!, false, 'and restore ignores it')
}

// Back from an app to the page its tab showed before keeps the tab in the
// app's group instead of dropping it into the Home group.
{
  let state = reduceTabNavigation(createProductState(), { type: 'open-internal', page: 'newtab', tabId: 'nt' as TabId, accountId: 'acct-b' })
  state = reduceTabNavigation(state, { type: 'open-app-here', app: app('Chat'), tabId: 'nt' as TabId, context: {
    appId: app('Chat').id, tabId: 'nt' as TabId, sourceNetwork: 'qortium', previewUrl: null,
    resourceLocation: 'qdn://APP/Chat/Chat', identityId: 'home-v2:identity:acct-b', walletRef: 'home-v2:wallet:wallet-b',
  } as never })
  state = reduceTabNavigation(state, { type: 'traverse-history', tabId: 'nt' as TabId, index: 0 })
  const back = state.entries.find((entry) => entry.id === 'nt')!
  assert.equal(back.kind, 'internal')
  assert.equal(tabGroupAccountId(back, { dashboardAccountId: 'acct-a' }), 'acct-b', "Back keeps the tab in B's group")
}

console.log('Home v2 active tab group account tests passed.')
