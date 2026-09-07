import assert from 'node:assert/strict'
import { parseViewerAddress, parseViewerLocation, viewerLocationFromResource } from './viewer-location'
import { createProductState, reduceProductState, restoreProductState } from './product-model'
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

// A public viewer address may carry a position fragment. The coordinate parser
// still refuses one: it is the BARE coordinate everything else is keyed on.
const seeded = parseViewerAddress('qortal://DOCUMENT/Library/book/chapter%201.pdf#page=4&zoom=150')
assert.equal(seeded.location, document.location, 'The tab location is the bare coordinate')
assert.deepEqual(seeded.seed, { page: 4, zoom: 150 })
assert.deepEqual(parseViewerAddress(image.location), { location: image.location, seed: null })
assert.deepEqual(parseViewerAddress('qdn://image/Art#'), { location: image.location, seed: null })
for (const [fragment, seed] of [
  ['unknown=1&page=3', { page: 3 }],
  ['t=12.5', { mediaTime: 12.5 }],
  ['t=0', { mediaTime: 0 }],
  ['line=42', { line: 42 }],
  ['entry=folder%2Finner.zip', { archivePath: 'folder/inner.zip' }],
  // EPUB CFIs were removed from the contract: `cfi` is now just an unknown key.
  ['cfi=epubcfi(%2F6%2F2!%2F4%2F2%2F1:0)', null],
  ['cfi=epubcfi(%2F6%2F2)&page=3', { page: 3 }],
  ['page=%2B2', { page: 2 }],
  // Duplicate keys: the LAST raw occurrence is validated, and an earlier valid
  // value never survives a malformed later one.
  ['page=2&page=5', { page: 5 }],
  ['page=0&page=4', { page: 4 }],
  ['page=4&page=0', null],
  ['page=4&page=%zz', null],
  ['page=4&page=0&t=3', { mediaTime: 3 }],
  // A malformed value drops that key only; nothing usable means no seed at all.
  ['page=0&t=3', { mediaTime: 3 }],
  ['page=1.5&line=2', { line: 2 }],
  ['zoom=24', null], ['zoom=401', null], ['zoom=150.5', null],
  ['t=-1', null], ['t=10000001', null], ['t=abc', null],
  ['line=0', null], ['page=1000001', null],
  ['entry=..%2Fsecret', null], ['entry=a%2F..%2Fb', null], ['entry=a%252fb', null],
  ['entry=', null], ['entry=%2F', null],
  // Encoded control characters are refused in every value, not just the path.
  ['entry=a%00b', null], ['entry=a%0Ab', null], ['entry=a%7Fb', null],
  ['page=%092', null], ['line=%0A5', null], ['t=%001', null],
  // `entry` segments carry the location path's own 128-character bound.
  [`entry=${'a'.repeat(128)}`, { archivePath: 'a'.repeat(128) }],
  [`entry=${'a'.repeat(129)}`, null],
  [`entry=ok%2F${'a'.repeat(129)}`, null],
  [`entry=${`${'a'.repeat(120)}%2F`.repeat(9)}a`, null],
  ['page=%zz', null], ['nothing', null], ['=5', null], ['&&', null],
] as const) assert.deepEqual(parseViewerAddress(`qdn://image/Art#${fragment}`).seed, seed, fragment)
// Query strings, forged services and traversal stay refused with a fragment on.
for (const address of [
  'qdn://IMAGE/Art/default?qdnHomeStream=secret', 'qdn://IMAGE/Art/default?a=1#page=2',
  'qdn://APP/Art/default#page=2', 'qdn://IMAGE/Art/default/../secret#page=2',
  'qdn://IMAGE/Art/default/a%23b#page=2', `qdn://IMAGE/Art#${'x'.repeat(2000)}`,
]) assert.throws(() => parseViewerAddress(address), address)
// The 2000-character bound is on the WHOLE address, fragment included, and it
// is inclusive: exactly 2000 parses, 2001 is refused before anything is read.
const padded = (total: number) => {
  const prefix = 'qdn://image/Art#page=2&pad='
  return `${prefix}${'x'.repeat(total - prefix.length)}`
}
assert.equal(padded(2000).length, 2000)
assert.deepEqual(parseViewerAddress(padded(2000)).seed, { page: 2 })
assert.throws(() => parseViewerAddress(padded(2001)), /Invalid viewer resource address/)
assert.throws(() => parseViewerLocation('x'.repeat(2001)), /Invalid viewer resource address/)

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
// Identity stays the bare coordinate: an address opened from a fragment shares
// its history, restore-merge and bookmark/address-bar string with the bare one.
const seededId = 'viewer-seeded' as TabId
let seededState = reduceProductState(createProductState(), {
  type: 'open-viewer', tabId: seededId, location: seeded.location, accountId: null })
const seededEntry = seededState.entries.find(entry => entry.id === seededId)!
assert.equal(seededEntry.kind === 'viewer' && seededEntry.location, document.location)
assert.deepEqual(tabDestination(seededState), { kind: 'viewer', location: document.location })
assert.equal(tabHistory(seededState, seededId)?.entries.length, 1, 'One history entry, at the bare location')
seededState = reduce(seededState, { type: 'restore', preserveLocal: true, state: restoreProductState({
  activeTabId: seededId,
  entries: [{ kind: 'viewer', id: seededId, location: document.location, accountId: null }] }) })
assert.equal(seededState.entries.filter(entry => entry.kind === 'viewer').length, 1,
  'Restore merges the seeded tab with its persisted bare entry')
assert.deepEqual(rememberClosedTab([], seededState, seededId)[0],
  { sourceTabId: seededId, kind: 'viewer', location: document.location, accountId: null })
// A bookmark, pin or start page may hold the fragment; what is opened is bare.
assert.equal(parseViewerAddress('qortal://DOCUMENT/Library/book/chapter%201.pdf#page=4').location.includes('#'), false)

console.log('Public viewer coordinates, position fragments, isolated state/history/restore, startup and bounded metadata passed')
