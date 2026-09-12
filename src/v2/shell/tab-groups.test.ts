import assert from 'node:assert/strict'
import type { ShellEntry } from '../product-model'
import { HOME_TAB_GROUP_KEY, groupTabsByAccount, groupedTabOrder } from './tab-groups'

const internal = (id: string): ShellEntry =>
  ({ kind: 'internal', id, page: 'dashboard' }) as unknown as ShellEntry
const app = (id: string, accountId: string | null): ShellEntry =>
  ({
    kind: 'app',
    id,
    appId: 'qdn://APP/Chat',
    title: id,
    context: {
      appId: 'qdn://APP/Chat',
      tabId: id,
      sourceNetwork: 'qortium',
      identityId: accountId ? `home-v2:identity:${accountId}` : 'home-v2:identity:none',
      resourceLocation: 'qdn://APP/Chat/Chat',
    },
  }) as unknown as ShellEntry
const viewer = (id: string, accountId: string | null): ShellEntry =>
  ({ kind: 'viewer', id, title: id, location: 'qdn://DOCUMENT/x/y', accountId }) as unknown as ShellEntry

// Home first, then accounts in order of first appearance; within a group the
// flat order is kept -- even when an account's tabs are not contiguous.
{
  const entries = [
    internal('dash'),
    app('b1', 'wallet:B'),
    app('a1', 'wallet:A'),
    app('b2', 'wallet:B'),
    viewer('g1', null),
    app('a2', 'wallet:A'),
  ]
  const groups = groupTabsByAccount(entries)
  assert.deepEqual(groups.map((group) => group.key), [HOME_TAB_GROUP_KEY, 'account:wallet:B', 'account:wallet:A'])
  assert.deepEqual(groups.map((group) => group.entries.map((entry) => entry.id)), [
    ['dash', 'g1'],
    ['b1', 'b2'],
    ['a1', 'a2'],
  ])
  assert.deepEqual(groups.map((group) => group.accountId), [null, 'wallet:B', 'wallet:A'])
  assert.deepEqual([...groupedTabOrder(entries)], ['dash', 'g1', 'b1', 'b2', 'a1', 'a2'])
}

// No account-less tab, no Home group: nothing to head.
{
  const groups = groupTabsByAccount([app('a1', 'wallet:A')])
  assert.deepEqual(groups.map((group) => group.key), ['account:wallet:A'])
}

// Only internal pages: one Home group, nothing else.
{
  const groups = groupTabsByAccount([internal('dash'), internal('settings')])
  assert.deepEqual(groups.map((group) => group.key), [HOME_TAB_GROUP_KEY])
  assert.equal(groups[0].entries.length, 2)
}

// Empty strip: no groups at all.
assert.deepEqual(groupTabsByAccount([]), [])

// The Dashboard belongs with the selected account: with one selected it sits
// in that account's group (first, if that account has no earlier tab), and
// the Home group is dropped when nothing else is account-less. Settings and
// Welcome stay in the Home group regardless.
{
  const settings = { kind: 'internal', id: 'settings', page: 'settings' } as unknown as ShellEntry
  const entries = [internal('dash'), app('b1', 'wallet:B'), settings, app('a1', 'wallet:A')]
  const groups = groupTabsByAccount(entries, { dashboardAccountId: 'wallet:A' })
  assert.deepEqual(groups.map((group) => [group.key, group.entries.map((entry) => entry.id)]), [
    [HOME_TAB_GROUP_KEY, ['settings']],
    ['account:wallet:A', ['dash', 'a1']],
    ['account:wallet:B', ['b1']],
  ])
  assert.deepEqual(
    groupTabsByAccount([internal('dash'), app('a1', 'wallet:A')], { dashboardAccountId: 'wallet:A' })
      .map((group) => group.key),
    ['account:wallet:A'],
  )
  assert.deepEqual(
    groupTabsByAccount(entries, { dashboardAccountId: null }).map((group) => group.key),
    [HOME_TAB_GROUP_KEY, 'account:wallet:B', 'account:wallet:A'],
  )
}

console.log('Home v2 tab group tests passed.')
