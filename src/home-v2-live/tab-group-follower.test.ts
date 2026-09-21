import assert from 'node:assert/strict'
import type { AppDescriptor, TabId } from '../v2/contracts'
import { createProductState, reduceProductState, type ProductState } from '../v2/product-model'
import { tabGroupAccountId } from '../v2/shell/tab-groups'
import { rememberClosedTab, type ClosedTab } from './closed-tabs'
import { reduceTabNavigation, type NavigationState } from './tab-navigation'
import { buildHomeV2TabTransfer, planHomeV2TabTransferOpen } from './tab-transfer'
import {
  capturedAccountDialogTarget,
  tabGroupAccountToFollow,
  transferableEntryAccountId,
} from './active-tab-group-account'
import { createTabGroupFollower } from './tab-group-follower'

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
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
const settle = async () => { for (let i = 0; i < 20; i += 1) await tick() }

/**
 * A stand-in for the live shell: product state, the stored selection (only
 * the vault commit moves it), and a vault whose `select` the test controls.
 */
function shell(options: { readonly delayed?: boolean; readonly failFirst?: number } = {}) {
  let state = openApp(createProductState(), 'a', 'Wallet', 'acct-a')
  state = openApp(state, 'b', 'Wallet', 'acct-b')
  state = reduceProductState(state, { type: 'activate-tab', tabId: 'a' as TabId })
  const shell = {
    state,
    selected: 'acct-a' as string | null,
    selects: [] as string[],
    committed: [] as string[],
    failures: [] as string[],
    release: [] as Array<() => void>,
    failuresLeft: options.failFirst ?? 0,
  }
  const follower = createTabGroupFollower({
    target: () => tabGroupAccountToFollow(shell.state, shell.selected, catalogue),
    select: async (accountId) => {
      shell.selects.push(accountId)
      if (options.delayed) await new Promise<void>((resolve) => shell.release.push(resolve))
      if (shell.failuresLeft > 0) {
        shell.failuresLeft -= 1
        throw new Error(`vault busy (${accountId})`)
      }
      // The vault confirms: only now does the selection move.
      shell.selected = accountId
      shell.committed.push(accountId)
    },
    delay: async () => { await tick() },
    onFailure: (_error, accountId) => shell.failures.push(accountId),
  })
  const activate = (tabId: string) => {
    shell.state = reduceProductState(shell.state, { type: 'activate-tab', tabId: tabId as TabId })
    follower.sync()
  }
  const close = (tabId: string) => {
    shell.state = reduceProductState(shell.state, { type: 'close-tab', tabId: tabId as TabId })
    follower.sync()
  }
  const releaseNext = async () => { shell.release.shift()?.(); await settle() }
  return { ...shell, get selected() { return shell.selected }, get selects() { return shell.selects },
    get committed() { return shell.committed }, get failures() { return shell.failures },
    get state() { return shell.state }, follower, activate, close, releaseNext }
}

// The plain case: into B's group → one select, confirmed, done.
{
  const h = shell()
  h.activate('b')
  await settle()
  assert.deepEqual(h.selects, ['acct-b'])
  assert.equal(h.selected, 'acct-b')
  assert.equal(h.follower.busy, false)
}

// Rapid A → B → A with a slow vault: one select at a time, the live target
// re-read after each, and the LAST active group wins — A.
{
  const h = shell({ delayed: true })
  h.activate('b')
  await tick()
  assert.deepEqual(h.selects, ['acct-b'], 'B\'s select is in flight')
  h.activate('a')
  await tick()
  assert.deepEqual(h.selects, ['acct-b'], 'no second select while one is in flight')
  assert.equal(h.selected, 'acct-a', 'nothing is marked followed before the vault confirms')
  await h.releaseNext()
  assert.equal(h.committed[0], 'acct-b', 'B\'s select completes')
  assert.deepEqual(h.selects, ['acct-b', 'acct-a'], 'then the re-read target, A, is selected')
  await h.releaseNext()
  assert.equal(h.selected, 'acct-a', 'A→B→A ends on A')
  assert.equal(h.follower.busy, false)
}

// Closing B's tab while its select is in flight: the neighbour comes forward
// and the selection ends on the neighbour's group.
{
  const h = shell({ delayed: true })
  h.activate('b')
  await tick()
  h.close('b')
  assert.equal(h.state.activeTabId, 'a', 'closing B activates its neighbour')
  await h.releaseNext()
  assert.deepEqual(h.selects, ['acct-b', 'acct-a'])
  await h.releaseNext()
  assert.equal(h.selected, 'acct-a', 'close-B-mid-select ends on the neighbour\'s group')
}

// A rejecting vault: retried with backoff for the same target, then confirmed.
{
  const h = shell({ failFirst: 2 })
  h.activate('b')
  await settle()
  assert.deepEqual(h.failures, ['acct-b', 'acct-b'])
  assert.deepEqual(h.selects, ['acct-b', 'acct-b', 'acct-b'], 'two failures, third attempt succeeds')
  assert.equal(h.selected, 'acct-b')
}

// Retries are bounded: after they run out the follower stops — the selection
// is left as it was, never marked followed — and the next sync() tries afresh.
{
  const h = shell({ failFirst: 3 })
  h.activate('b')
  await settle()
  assert.deepEqual(h.selects, ['acct-b', 'acct-b', 'acct-b'], 'one try plus two retries')
  assert.equal(h.selected, 'acct-a', 'still A')
  assert.equal(h.follower.busy, false)
  h.activate('a')
  h.activate('b')
  await settle()
  assert.equal(h.selected, 'acct-b', 'a later tab change follows again')
}

// A failure whose target has meanwhile changed does not retry the old
// target: the live target is re-read, and with the user back on A (still the
// selected account) there is nothing left to select.
{
  const h = shell({ delayed: true, failFirst: 1 })
  h.activate('b')
  await tick()
  h.activate('a')
  await h.releaseNext()
  assert.deepEqual(h.failures, ['acct-b'])
  assert.deepEqual(h.selects, ['acct-b'], 'B is not retried once the user has left its group')
  assert.equal(h.selected, 'acct-a')
  assert.equal(h.follower.busy, false)
}

// Dispose stops any further select.
{
  const h = shell({ delayed: true })
  h.activate('b')
  await tick()
  h.follower.dispose()
  h.activate('a')
  await h.releaseNext()
  assert.deepEqual(h.selects, ['acct-b'], 'no select after dispose')
  assert.equal(h.selected, 'acct-b', 'the in-flight one still commits')
}

// Dialog capture: rename / remove / remember-unlock act on the wallet they
// opened for only while it is still the selected wallet.
{
  assert.equal(capturedAccountDialogTarget('wallet-a', 'wallet-a'), 'wallet-a')
  assert.equal(capturedAccountDialogTarget('wallet-a', 'wallet-b'), null, 'the selection moved: refused')
  assert.equal(capturedAccountDialogTarget('wallet-a', null), null, 'nothing selected any more: refused')
  assert.equal(capturedAccountDialogTarget(undefined, 'wallet-a'), null, 'nothing captured: refused, never the current selection')
}

// Cross-window transfer keeps an internal page's group; a page that names no
// group travels as the explicit guest and never inherits the receiver's
// selection; an app travels with its own binding.
{
  let state = reduceProductState(createProductState(), { type: 'open-internal', page: 'newtab', tabId: 'nt' as TabId, accountId: 'acct-b' })
  state = reduceProductState(state, { type: 'open-internal', page: 'settings', tabId: 'legacy' as TabId })
  state = openApp(state, 'a', 'Wallet', 'acct-a')
  const entry = (id: string) => state.entries.find((candidate) => candidate.id === id)!
  assert.equal(transferableEntryAccountId(entry('nt')), 'acct-b')
  assert.equal(transferableEntryAccountId(entry('legacy')), null)
  assert.equal(transferableEntryAccountId(entry('a')), 'acct-a')
  const envelope = buildHomeV2TabTransfer({ address: 'home://newtab', accountId: transferableEntryAccountId(entry('nt')) })
  const plan = planHomeV2TabTransferOpen(JSON.parse(JSON.stringify(envelope)))
  assert.equal(plan?.accountId, 'acct-b', 'the group arrives, validated, in the plan')
  const legacyPlan = planHomeV2TabTransferOpen(JSON.parse(JSON.stringify(
    buildHomeV2TabTransfer({ address: 'home://settings', accountId: transferableEntryAccountId(entry('legacy')) }))))
  assert.notEqual(legacyPlan?.accountId, undefined, 'never the receiver\'s current account')
  assert.equal(planHomeV2TabTransferOpen({ ...JSON.parse(JSON.stringify(envelope)), accountId: 'x'.repeat(500) }), null,
    'an oversized account id is refused on arrival')
}

// Reopen-closed keeps the group: a closed page remembers its accountId, and
// reopening it puts it back in that group; a legacy page stays legacy.
{
  let state: NavigationState = reduceTabNavigation(createProductState(), { type: 'open-internal', page: 'newtab', tabId: 'nt' as TabId, accountId: 'acct-b' })
  state = reduceTabNavigation(state, { type: 'open-internal', page: 'settings', tabId: 'legacy' as TabId })
  let closed: ClosedTab[] = rememberClosedTab([], state, 'nt' as TabId)
  closed = rememberClosedTab(closed, state, 'legacy' as TabId)
  const remembered = closed[0] as { accountId?: string | null }
  assert.equal(remembered.accountId, 'acct-b')
  assert.equal('accountId' in closed[1], false, 'a page that names no group remembers none')
  state = reduceTabNavigation(state, { type: 'close-tab', tabId: 'nt' as TabId })
  const reopened = reduceTabNavigation(state, { type: 'open-internal', page: 'newtab', tabId: 'nt2' as TabId,
    ...(remembered.accountId !== undefined ? { accountId: remembered.accountId } : {}) })
  assert.equal(tabGroupAccountId(reopened.entries.find((entry) => entry.id === 'nt2')!, { dashboardAccountId: 'acct-a' }), 'acct-b',
    'reopened into B\'s group, not the selected A')
}

console.log('Home v2 tab group follower, dialog capture, transfer and reopen tests passed.')
