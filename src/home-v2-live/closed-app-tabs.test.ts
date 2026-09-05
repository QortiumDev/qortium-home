import assert from 'node:assert/strict'
import type { AppTab } from '../v2/product-model'
import { rememberClosedAppTab, type ClosedAppTab } from './closed-app-tabs'

const tab = {
  id: 'source', appId: 'fixture', title: 'Fixture', context: {
    appId: 'fixture', tabId: 'source', identityId: 'home-v2:identity:wallet:A:2',
    walletRef: 'home-v2:wallet:A', sourceNetwork: 'qortium', previewUrl: null,
    resourceLocation: 'qdn://APP/Fixture/published/path?room=7#messages',
  },
} as AppTab
const original = JSON.stringify(tab)
const [record] = rememberClosedAppTab([], tab)
assert.equal(record.accountId, 'wallet:A:2')
assert.equal(record.resourceLocation, tab.context.resourceLocation)
assert.deepEqual(Object.keys(record).sort(), ['accountId', 'app', 'resourceLocation', 'sourceTabId'])
assert.equal(JSON.stringify(tab), original)
assert.equal(rememberClosedAppTab([record], tab).length, 1, 'Duplicate close events remember a tab once')
assert.equal(rememberClosedAppTab([], {
  ...tab, context: { ...tab.context, identityId: 'home-v2:identity:none' as AppTab['context']['identityId'] },
})[0].accountId, null, 'Explicit guest, never Current')
for (const patch of [
  { previewUrl: 'http://127.0.0.1/render/hash/preview' },
  { identityId: '' }, { identityId: 'home-v2:identity:' }, { identityId: 'unknown' },
  { tabId: 'different' }, { appId: 'different' },
  { resourceLocation: 'home://dashboard' }, { sourceNetwork: 'qortal' },
]) {
  assert.deepEqual(rememberClosedAppTab([], { ...tab,
    context: { ...tab.context, ...patch } as AppTab['context'],
  }), [], JSON.stringify(patch))
}
assert.deepEqual(rememberClosedAppTab([], undefined), [])
let history: ClosedAppTab[] = []
for (let index = 0; index < 12; index++) {
  const id = `tab-${index}` as AppTab['id']
  history = rememberClosedAppTab(history, { ...tab, id, context: { ...tab.context, tabId: id } })
}
assert.equal(history.length, 10)
assert.equal(history[0].sourceTabId, 'tab-2')
assert.equal(history.pop()?.sourceTabId, 'tab-11')
for (const [scheme, sourceNetwork] of [['qdn', 'qortium'], ['qortal', 'qortal']] as const) {
  for (const service of ['APP', 'WEBSITE', 'GAME']) {
    const resourceLocation = `${scheme}://${service}/Fixture/published/path?q=2#deep` as AppTab['context']['resourceLocation']
    const captured = rememberClosedAppTab([], { ...tab, context: { ...tab.context, sourceNetwork, resourceLocation } })[0]
    assert.equal(captured.app.resourceIdentity.service, service)
    assert.equal(captured.app.sourceNetwork, sourceNetwork)
    assert.equal(captured.resourceLocation, resourceLocation)
  }
}
console.log('Home v2 closed app-tab capture tests passed.')
