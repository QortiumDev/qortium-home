import assert from 'node:assert/strict'
import { parseViewerLocation, viewerLocationFromResource } from './viewer-location'
import { createProductState, restoreProductState } from './product-model'
import { reduceTabNavigation as reduce, tabHistory, tabDestination } from '../home-v2-live/tab-navigation'
import { rememberClosedTab } from '../home-v2-live/closed-tabs'
import { savedEntryAccountId } from './shell/account-context'
import { parseNewTabPreference } from './new-tab-preference'
import type { TabId } from './contracts'
import { resolvePublicViewer, readPublicViewerJson } from '../../electron/home-v2-public-viewer'

const image = parseViewerLocation('qdn://image/Art')
assert.equal(image.location, 'qdn://IMAGE/Art/default')
assert.equal(image.identifier, null)
assert.equal(image.network, 'qortium')
const document = parseViewerLocation('qortal://DOCUMENT/Library/book/chapter%201.pdf')
assert.equal(document.path, 'chapter 1.pdf')
assert.equal(viewerLocationFromResource(document), document.location)
for (const address of [
  'https://node.example/render/IMAGE/Art/default', 'qdn-home-stream://token',
  'qdn://APP/Art/default', 'qdn://WEBSITE/Art/default', 'qdn://GAME/Art/default',
  'qdn://DOCUMENT_PRIVATE/Art/default', 'qdn://UNKNOWN/Art/default',
  'qdn://user:password@IMAGE/Art', 'qdn://IMAGE/Art/default?qdnHomeStream=secret',
  'qdn://IMAGE/Art/default#fragment', 'qdn://IMAGE/Art/default/../secret',
  'qdn://IMAGE/Art/default/%2e%2e/secret', 'qdn://IMAGE/Art/default/a%2fb',
  'qdn://IMAGE/Art/default/a%5cb', 'qdn://IMAGE/Art/default/a%3fb',
  'qdn://IMAGE/Art/default/a%23b', 'qdn://IMAGE/Art/default/%252e%252e',
  'qdn://IMAGE/%20Art/default', 'qdn://IMAGE/Art/default/',
]) assert.throws(() => parseViewerLocation(address), address)

const id = 'viewer-one' as TabId, second = 'viewer-two' as TabId
let state = reduce(createProductState(), { type: 'open-viewer', tabId: id, location: image.location, accountId: 'wallet:A' })
state = reduce(state, { type: 'open-viewer', tabId: second, location: image.location, accountId: null })
assert.equal(state.tabs.length, 0, 'Viewers never receive app-tab authority')
assert.equal(state.destination, 'viewer')
assert.equal(state.entries.filter(entry => entry.kind === 'viewer').length, 2, 'Independent instances even at identical coordinates')
assert.equal(savedEntryAccountId(state.entries.find(entry => entry.id === id)), 'wallet:A')
assert.equal(tabHistory(state, id)?.entries.length, 1)
state = reduce(state, { type: 'show-transient', destination: { kind: 'core-docs', network: 'qortal' } })
assert.equal(tabHistory(state, second)?.entries.length, 2)
state = reduce(state, { type: 'traverse-history', tabId: second, index: 0 })
assert.equal(state.destination, 'viewer')
assert.deepEqual(tabDestination(state), { kind: 'viewer', location: image.location })
assert.equal(tabHistory(state, id)?.entries.length, 1, 'Each viewer has separate session history')
const closed = rememberClosedTab([], state, id)
assert.deepEqual(closed[0], { sourceTabId: id, kind: 'viewer', location: image.location, accountId: 'wallet:A' })
state = reduce(state, { type: 'close-tab', tabId: id })
assert.equal(state.activeTabId, second)
assert.equal(state.entries.some(entry => entry.id === id), false)
const restored = restoreProductState({ ...state, entries: [
  { kind: 'viewer', id, location: document.location, accountId: 'removed:account',
    title: 'forged title', streamUrl: 'secret-token', context: { walletRef: 'secret' } },
  { kind: 'viewer', id: second, location: 'https://arbitrary.example/', accountId: null },
] })
const entry = restored.entries.find(entry => entry.id === id)!
assert.deepEqual(entry, { kind: 'viewer', id, location: document.location, accountId: 'removed:account', title: 'chapter 1.pdf' })
assert.equal(restored.tabs.length, 0)
assert.equal(restored.entries.some(entry => entry.id === second), false)
assert.equal(savedEntryAccountId(entry), 'removed:account', 'Removed attribution stays bound, never inherits the default')
assert.deepEqual(parseNewTabPreference({ kind: 'custom', address: image.location }), { kind: 'custom', address: image.location })

const urls: string[] = []
const resolved = await resolvePublicViewer(document.location, 'https://node.example', async url => {
  urls.push(url)
  return url.includes('/status/') ? { status: 'READY' } : { filename: 'wrong.html', mimeType: 'text/html' }
})
assert.equal(urls.length, 2)
assert.equal(resolved.upstreamUrl, 'https://node.example/render/DOCUMENT/Library/book/chapter%201.pdf')
assert.equal(resolved.resource.filename, 'chapter 1.pdf')
assert.equal(resolved.resource.mimeType, null, 'Root properties cannot change an explicit file path classification')
const root = await resolvePublicViewer('qdn://DOCUMENT/Library/default', 'https://node.example', async url =>
  url.includes('/status/') ? { status: 'READY' } : { filename: 'manual.pdf', mimeType: 'application/pdf' })
assert.equal(root.resource.filename, 'manual.pdf')
assert.equal(root.resource.mimeType, 'application/pdf')
for (const status of [null, {}, { status: false }, { status: '' }, { status: 'NOT_PUBLISHED' }]) {
  await assert.rejects(resolvePublicViewer(image.location, 'https://node.example', async () => status), /does not exist/)
}
assert.deepEqual(await readPublicViewerJson(new Response('{"status":"READY"}')), { status: 'READY' })
assert.equal(await readPublicViewerJson(new Response(null, { status: 404 })), null)
await assert.rejects(readPublicViewerJson(new Response('x'.repeat(65537))), /byte limit/)
await assert.rejects(readPublicViewerJson(new Response('{}', { status: 503 })), /HTTP 503/)
console.log('Public viewer coordinates, isolated state/history/restore, startup and bounded metadata passed')
