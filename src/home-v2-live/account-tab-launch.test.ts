import assert from 'node:assert/strict'
import type { AppTabContext, HomeV2AccountCatalogue } from '../v2/contracts'
import type { AppTab } from '../v2/product-model'
import { resolveAccountTabLaunch } from './account-tab-launch'

const accounts: HomeV2AccountCatalogue['accounts'] = [
  { id: 'wallet:A', walletId: 'wallet:A', address: 'fixture-A', addressIndex: 0,
    label: 'Account A', isUnlocked: true, supportsDerivedAddresses: true },
  { id: 'wallet:B:address-2', walletId: 'wallet:B', address: 'fixture-B2', addressIndex: 2,
    label: 'Locked derived B', isUnlocked: false, supportsDerivedAddresses: true },
]
const source: AppTab = {
  id: 'source' as AppTab['id'], appId: 'fixture-chat' as AppTab['appId'], title: 'Chat',
  context: {
    appId: 'fixture-chat', tabId: 'source', identityId: 'home-v2:identity:wallet:A',
    walletRef: 'home-v2:wallet:wallet:A', sourceNetwork: 'qortium',
    resourceLocation: 'qdn://APP/Chat/default?group=7#messages', previewUrl: null,
  } as AppTabContext,
}
const input = {
  tabId: source.id, resourceLocation: source.context.resourceLocation,
  accountId: accounts[1].id, tabs: [source], accounts,
}
const original = JSON.stringify({ source, accounts })
const launched = resolveAccountTabLaunch(input)
assert.equal(launched.accountId, 'wallet:B:address-2', 'Locked/derived targets can open without unlocking')
assert.equal(launched.resourceLocation, source.context.resourceLocation, 'Keep the captured source address including route query/hash')
assert.equal(launched.app.id, source.appId)
assert.equal(launched.app.resourceIdentity.service, 'APP')
assert.deepEqual(Object.keys(launched).sort(), ['accountId', 'app', 'resourceLocation'])
assert.equal(JSON.stringify({ source, accounts }), original, 'Planning never mutates source or selected accounts')
assert.equal(resolveAccountTabLaunch({ ...input, accountId: null }).accountId, null)
assert.equal(resolveAccountTabLaunch({ ...input, accountId: accounts[0].id }).accountId, accounts[0].id)

// A source whose old account was removed may still be opened under a live
// explicit choice; its obsolete authority is never inherited into the result.
assert.equal(resolveAccountTabLaunch({ ...input, accounts: accounts.slice(1) }).accountId, accounts[1].id)
assert.equal(resolveAccountTabLaunch({ ...input, accounts: [], accountId: null }).accountId, null)
for (const accountId of [undefined, '', 'wallet:removed', 'home-v2:guest', ' wallet:A ', {}, 1]) {
  assert.throws(() => resolveAccountTabLaunch({ ...input, accountId: accountId as string }), /account is no longer available/)
}
assert.throws(() => resolveAccountTabLaunch({ ...input, accounts: accounts.slice(0, 1) }), /account is no longer available/)
assert.throws(() => resolveAccountTabLaunch({ ...input, blocked: true }), /view cannot be opened/)
assert.throws(() => resolveAccountTabLaunch({ ...input, tabs: [] }), /source app tab changed/)
assert.throws(() => resolveAccountTabLaunch({ ...input, tabId: 'internal-dashboard' }), /source app tab changed/)
assert.throws(() => resolveAccountTabLaunch({ ...input, resourceLocation: 'qdn://APP/Other/default' }), /source app tab changed/)
for (const patch of [
  { tabId: 'other' },
  { appId: 'other-app' },
  { resourceLocation: 'qdn://APP/Replaced/default' },
]) {
  assert.throws(() => resolveAccountTabLaunch({
    ...input, tabs: [{ ...source, context: { ...source.context, ...patch } as AppTabContext }],
  }), /source app tab changed/)
}
assert.throws(() => resolveAccountTabLaunch({
  ...input, tabs: [{ ...source, context: { ...source.context, previewUrl: 'http://127.0.0.1/render/hash/preview' } }],
}), /publish preview/)
assert.throws(() => resolveAccountTabLaunch({
  ...input, tabs: [{ ...source, context: { ...source.context, sourceNetwork: 'qortal' } }],
}), /source app address/)
assert.throws(() => resolveAccountTabLaunch({
  ...input, resourceLocation: 'invalid',
  tabs: [{ ...source, context: { ...source.context, resourceLocation: 'invalid' as AppTabContext['resourceLocation'] } }],
}), /source app address/)
for (const service of ['WEBSITE', 'GAME']) {
  const location = `qdn://${service}/Chat/default` as AppTabContext['resourceLocation']
  const otherService = resolveAccountTabLaunch({
    ...input, resourceLocation: location,
    tabs: [{ ...source, context: { ...source.context, resourceLocation: location } }],
  })
  assert.equal(otherService.app.resourceIdentity.service, service)
}

console.log('Home v2 explicit account tab-launch planning tests passed.')
