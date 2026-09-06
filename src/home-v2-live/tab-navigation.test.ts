import assert from 'node:assert/strict'
import type { AppDescriptor, AppResourceLocation, AppTabContext, TabId } from '../v2/contracts'
import { createProductState, restoreProductState } from '../v2/product-model'
import { parseAppResourceLocation } from '../v2/resource-location'
import { reduceTabNavigation as reduce, tabHistory, tabDestination, nativeHistoryIndex, type NavigationState, type TabDestination } from './tab-navigation'
import { rememberClosedTab, type ClosedTab } from './closed-tabs'

const id = 'tab-a' as TabId, second = 'tab-b' as TabId
function app(name: string): AppDescriptor {
  return { id: name, title: name, sourceNetwork: 'qortal',
    resourceIdentity: parseAppResourceLocation(`qortal://APP/${name}/published`).identity } as AppDescriptor
}
function context(name: string, tabId = id): AppTabContext {
  return { appId: name, tabId, resourceLocation: `qortal://APP/${name}/published/one`,
    sourceNetwork: 'qortal', identityId: 'home-v2:identity:wallet:B', walletRef: 'home-v2:wallet:B', previewUrl: null } as AppTabContext
}
function open(state: NavigationState, name: string, tabId = id) {
  return reduce(state, { type: 'open-app', app: app(name), tabId, context: context(name, tabId), newInstance: true })
}
function snapshot(state: NavigationState, routes: string[], activeIndex: number, tabId = id) {
  const tab = state.tabs.find(entry => entry.id === tabId)!
  const name = parseAppResourceLocation(tab.context.resourceLocation).identity.name
  return reduce(state, { type: 'sync-app-history', tabId, snapshot: {
    resourceUrl: tab.context.resourceLocation, renderUrl: `https://node.example/render/APP/${name}/published/one`,
    activeIndex, entries: routes.map((route, index) => ({ index, url: `https://node.example/render/APP/${name}/published/${route}` })) } })
}
function replace(state: NavigationState, name: string) {
  const current = state.tabs.find(entry => entry.id === id)!
  return reduce(state, { type: 'replace-tab-app', app: app(name), tabId: id,
    context: { ...context(name), identityId: current.context.identityId, walletRef: current.context.walletRef },
    fromResourceLocation: current.context.resourceLocation })
}
function locations(state: NavigationState, tabId = id) {
  return tabHistory(state, tabId)!.entries.map(entry => entry.kind === 'app' ? entry.location : entry.kind)
}
let state = open(createProductState(), 'Alpha')
state = snapshot(state, ['one', 'two?x=1#hash', 'three'], 2)
assert.equal(tabHistory(state)!.index, 2)
assert.equal(nativeHistoryIndex(state, id, 1), 1)
const alphaHistory = locations(state)
state = replace(state, 'Beta')
assert.equal(tabHistory(state)!.index, 3)
assert.equal(nativeHistoryIndex(state, id, 2), null, 'An old native index cannot cross apps')
state = snapshot(state, ['one', 'two'], 1)
assert.equal(tabHistory(state)!.index, 4)
assert.equal(locations(state).length, 5)
state = reduce(state, { type: 'traverse-history', tabId: id, index: 2 })
assert.equal(state.activeTabId, id)
assert.equal(state.tabs[0].context.identityId, 'home-v2:identity:wallet:B')
assert.equal(state.tabs[0].context.walletRef, 'home-v2:wallet:B')
assert.equal(state.tabs[0].context.resourceLocation, alphaHistory[2])
state = snapshot(state, ['three'], 0)
assert.equal(locations(state).length, 5, 'A reloaded prior app retains the outer forward destinations')
assert.equal(tabHistory(state)!.index, 2)
state = snapshot(state, ['three', 'new'], 1)
assert.equal(locations(state).length, 4, 'A new in-app navigation drops outer forward destinations')
assert.match(locations(state).at(-1)!, /Alpha\/published\/new$/)
state = reduce(state, { type: 'select-native-history', tabId: id, index: 2 })
assert.equal(tabHistory(state)!.index, 2)
state = snapshot(state, ['three', 'new'], 0)
assert.equal(locations(state).length, 4)
state = snapshot(state, ['replaced', 'new'], 0)
assert.equal(locations(state).length, 4, 'replaceState preserves forward history')
state = replace(state, 'Gamma')
assert.equal(locations(state).length, 4, 'New cross-app navigation also truncates forward history')

const firstHistory = locations(state)
state = open(state, 'Other', second)
state = snapshot(state, ['one', 'two'], 1, second)
state = reduce(state, { type: 'activate-tab', tabId: id })
assert.deepEqual(locations(state), firstHistory, 'Switching tabs adds no history')
assert.equal(tabHistory(state, second)!.entries.length, 2)
state = snapshot(state, ['one'], 0)
state = reduce(state, { type: 'show-transient', destination: { kind: 'releases', target: { product: 'home', tagName: 'v2.1' } } })
const viewerIndex = tabHistory(state)!.index
assert.equal(state.destination, 'releases')
state = reduce(state, { type: 'activate-tab', tabId: second })
assert.equal(state.transient, null)
state = reduce(state, { type: 'activate-tab', tabId: id })
assert.equal(state.destination, 'releases', 'Each tab resumes its own internal viewer')
state = reduce(state, { type: 'select-native-history', tabId: id, index: viewerIndex - 1 })
assert.equal(state.destination, 'tab', 'Back from a viewer exposes its underlying live app')
state = reduce(state, { type: 'traverse-history', tabId: id, index: viewerIndex })
assert.equal(state.destination, 'releases')

const settings = 'settings-a' as TabId, settings2 = 'settings-b' as TabId
state = reduce(state, { type: 'open-internal', tabId: settings, page: 'settings' })
state = reduce(state, { type: 'settings-section', section: 'appearance' })
state = reduce(state, { type: 'settings-section', section: 'core' })
state = reduce(state, { type: 'traverse-history', tabId: settings, index: 1 })
assert.deepEqual(tabDestination(state), { kind: 'internal', page: 'settings', section: 'appearance' })
state = reduce(state, { type: 'settings-section', section: 'qdn-apps' })
assert.equal(tabHistory(state)!.entries.length, 3)
state = reduce(state, { type: 'open-internal', tabId: settings2, page: 'settings' })
assert.deepEqual(tabDestination(state), { kind: 'internal', page: 'settings', section: 'general' })
state = reduce(state, { type: 'activate-tab', tabId: settings })
assert.deepEqual(tabDestination(state), { kind: 'internal', page: 'settings', section: 'qdn-apps' })
let closed: ClosedTab[] = rememberClosedTab([], state, settings)
closed = rememberClosedTab(closed, state, id)
closed = rememberClosedTab(closed, state, settings2)
assert.deepEqual(closed.map(entry => entry.sourceTabId), [settings, id, settings2])
assert.deepEqual(rememberClosedTab(closed, state, settings2), closed)
assert.ok('page' in closed[0] && closed[0].section === 'qdn-apps')
assert.ok('accountId' in closed[1] && closed[1].accountId === 'wallet:B')
state = reduce(state, { type: 'close-tab', tabId: settings })
assert.equal(state.navigation?.[settings], undefined, 'Closed tab history is discarded')
assert.equal('navigation' in restoreProductState(JSON.parse(JSON.stringify(state))), false, 'History is session-only')

let android = open(createProductState(), 'Alpha')
android = snapshot(android, ['one', 'two', 'three'], 2)
android = reduce(android, { type: 'forget-native-history', tabId: id })
android = snapshot(android, ['three'], 0)
assert.equal(locations(android).length, 3, 'Iframe recreation retains earlier mirrored destinations')
assert.equal(tabHistory(android)!.index, 2)
const before = android
android = reduce(android, { type: 'sync-app-history', tabId: id, snapshot: {
  activeIndex: 0, resourceUrl: 'stale', renderUrl: 'https://node.example/render/APP/Alpha/published/one',
  entries: [{ index: 0, url: 'https://evil.example/' }] } })
assert.equal(android, before, 'Stale/foreign snapshots do not touch history')
let slow = open(createProductState(), 'Alpha')
slow = reduce(slow, { type: 'show-transient', destination: { kind: 'core-docs', network: 'qortal' } })
slow = snapshot(slow, ['one', 'two'], 1)
assert.equal(tabDestination(slow)?.kind, 'core-docs', 'A first snapshot arriving under docs cannot overwrite the viewer')
assert.equal(tabHistory(slow)!.index, 2)
assert.equal(slow.destination, 'core-docs')

// --- seeded history (cross-window tab transfer) ------------------------------
//
// A tab adopted from another window is opened through the ordinary open path
// and THEN handed the history the source tab had. The seed is navigation data
// only: it can never change which account the tab is bound to, and it applies
// only when the entry it points at is the tab this window actually opened.
const seeded = 'tab-seeded' as TabId
const chat = (route: string): TabDestination => ({
  kind: 'app',
  app: app('Chat'),
  location: `qortal://APP/Chat/published/${route}` as AppResourceLocation,
})
const seedEntries: readonly TabDestination[] = [chat('one'), chat('two'), chat('three')]
const seedAction = { type: 'seed-history', tabId: seeded, entries: seedEntries, index: 0 } as const

// The tab is opened at .../one, so the entry at index 0 describes it.
let transfer = reduce(open(createProductState(), 'Chat', seeded), seedAction)
assert.deepEqual(
  locations(transfer, seeded),
  seedEntries.map(entry => (entry.kind === 'app' ? entry.location : entry.kind)),
)
assert.equal(tabHistory(transfer, seeded)!.index, 0)
assert.equal(
  transfer.tabs.find(tab => tab.id === seeded)!.context.identityId,
  'home-v2:identity:wallet:B',
  'Seeding history never rebinds the tab it lands on',
)
assert.notEqual(tabHistory(transfer, seeded)!.entries, seedEntries, 'The seeded array is copied, not adopted')

// Forward navigation works on it, so it is real history and not decoration.
transfer = reduce(transfer, { type: 'traverse-history', tabId: seeded, index: 2 })
assert.equal(tabHistory(transfer, seeded)!.index, 2)
assert.match(
  transfer.tabs.find(tab => tab.id === seeded)!.context.resourceLocation,
  /published\/three$/,
)

// Every refusal leaves the state exactly as it was.
const fresh = open(createProductState(), 'Chat', seeded)
const refusals: readonly { index: number; tabId: TabId; entries: readonly TabDestination[] }[] = [
  // The entry at the index is not the tab that was opened.
  { ...seedAction, index: 1 },
  { ...seedAction, index: 2 },
  // Out of range, or not an index at all.
  { ...seedAction, index: -1 },
  { ...seedAction, index: 3 },
  { ...seedAction, index: 0.5 },
  { ...seedAction, index: Number.NaN },
  // No such tab in this window.
  { ...seedAction, tabId: 'tab-missing' as TabId },
  // Nothing to seed, or more than the transfer bound allows.
  { ...seedAction, entries: [] },
  { ...seedAction, entries: Array.from({ length: 51 }, () => chat('one')) },
  // A different kind of destination cannot describe an app tab.
  { ...seedAction, entries: [{ kind: 'internal', page: 'settings' }] },
  { ...seedAction, entries: [{ kind: 'viewer', location: 'qortal://DOCUMENT/A/b' }] },
]
for (const refusal of refusals) {
  assert.equal(
    reduce(fresh, { type: 'seed-history', ...refusal }),
    fresh,
    `index ${refusal.index}, ${refusal.entries.length} entries, tab ${refusal.tabId} is refused`,
  )
}

// A tab that already navigated owns its history; a late seed cannot rewrite it.
const navigated = snapshot(fresh, ['one', 'two'], 1, seeded)
assert.equal(reduce(navigated, seedAction), navigated, 'An existing history is never replaced')

// Pristine means pristine: a tab whose own webview has already reported a
// session is off limits even while its history is still one entry long, since
// seeding would throw away the live session the chrome is steering.
const withNative = snapshot(fresh, ['one'], 0, seeded)
assert.ok(tabHistory(withNative, seeded)!.native, 'the tab reported a native session')
assert.equal(tabHistory(withNative, seeded)!.entries.length, 1, 'while still one entry long')
assert.equal(
  reduce(withNative, seedAction),
  withNative,
  'A history carrying a native session is never seeded',
)

// A destination the RECEIVING window already has still gets a tab of its own.
// The transfer path opens with newInstance (apps) or open-internal (Home
// pages) rather than the deduplicating address route, because the sending
// window has already closed the original: an open that merely activated the
// identical tab already here would lose the moved tab outright.
const twinA = 'tab-twin-a' as TabId, twinB = 'tab-twin-b' as TabId
let twins = open(open(createProductState(), 'Chat', twinA), 'Chat', twinB)
assert.equal(
  twins.tabs.filter(tab => tab.id === twinA || tab.id === twinB).length,
  2,
  'Two tabs on the same app/account are distinct entries',
)
assert.equal(
  twins.tabs.find(tab => tab.id === twinA)!.context.resourceLocation,
  twins.tabs.find(tab => tab.id === twinB)!.context.resourceLocation,
  'and they are the same destination, which is the case that used to collapse',
)

// Two adoptions in flight at once: each seed names its own tab id, so neither
// can be overwritten by the other (the previous single pending slot was
// last-write-wins, and its tab-list diff found nothing for a duplicate).
twins = reduce(twins, { type: 'seed-history', tabId: twinA, entries: [chat('one'), chat('two')], index: 0 })
twins = reduce(twins, { type: 'seed-history', tabId: twinB, entries: [chat('one'), chat('nine')], index: 0 })
assert.deepEqual(locations(twins, twinA), [
  'qortal://APP/Chat/published/one',
  'qortal://APP/Chat/published/two',
])
assert.deepEqual(locations(twins, twinB), [
  'qortal://APP/Chat/published/one',
  'qortal://APP/Chat/published/nine',
])
assert.equal(tabHistory(twins, twinA)!.index, 0)
assert.equal(tabHistory(twins, twinB)!.index, 0)

// Home's own pages are not singletons either: open-internal is the product's
// "another instance" route, so a transferred Settings tab lands beside the one
// this window already had, with its own history.
const settingsA = 'tab-settings-a' as TabId, settingsB = 'tab-settings-b' as TabId
let pages = reduce(createProductState(), { type: 'open-internal', tabId: settingsA, page: 'settings' })
pages = reduce(pages, { type: 'open-internal', tabId: settingsB, page: 'settings' })
assert.equal(
  pages.entries.filter(entry => entry.kind === 'internal' && entry.page === 'settings').length,
  2,
  'A second Settings tab is ordinary product behaviour, not a transfer invention',
)
pages = reduce(pages, {
  type: 'seed-history',
  tabId: settingsB,
  entries: [{ kind: 'internal', page: 'settings' }, { kind: 'internal', page: 'dashboard' }],
  index: 0,
})
assert.deepEqual(locations(pages, settingsB), ['internal', 'internal'])
assert.equal(tabHistory(pages, settingsA)!.entries.length, 1, 'The tab that was already here is untouched')

console.log('Per-tab native/cross-app/internal history, account binding, mixed reopen and isolation passed')
