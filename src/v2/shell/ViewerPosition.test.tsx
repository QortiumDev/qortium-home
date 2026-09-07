import assert from 'node:assert/strict'
import React, { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import JSZip from 'jszip'
import { applyViewerPositionSeed, createViewerPosition, createViewerPositionStore, archiveChildPosition,
  recordViewerPositionSeed } from '../../viewer-position'
import { HomeV2ResourceViewer, PositionedMedia, type HomeV2ResourceViewerState } from './HomeV2ResourceViewer'
import { defaultHomeV2Appearance } from '../appearance'
import { EpubViewer } from '../../DocumentViewer'
import { useViewerScroll } from '../../use-viewer-scroll'

const store = createViewerPositionStore()
const one = store.get('one', 'coordinate/account-a')
one.page = 7
assert.equal(store.get('one', 'coordinate/account-a').page, 7)
assert.equal(store.get('two', 'coordinate/account-a').page, 1, 'Same resource in a second tab is independent')
assert.equal(store.get('one', 'coordinate/account-b').page, 1, 'Account changes reset presentation')
assert.notEqual(store.get('one', 'coordinate/account-a'), one, 'Changing away/back does not revive old state')
store.retain(['two'])
assert.equal(store.get('one', 'coordinate/account-a').page, 1, 'Close/reopen discards state')
const child = archiveChildPosition(one, 'nested.zip')!
child.page = 2
assert.equal(archiveChildPosition(one, 'nested.zip'), child)
assert.notEqual(archiveChildPosition(one, 'other.zip'), child)
assert.equal(archiveChildPosition(one, 'x'.repeat(4097)), undefined)

// --- Fragment seeds ---------------------------------------------------------
// A public address may carry an opening position. It is applied to the tab's
// position ONCE, when the tab first reads it, and never again.
const seedIdentity = JSON.stringify(['qdn://DOCUMENT/Library/book/default', null])
const otherIdentity = JSON.stringify(['qdn://DOCUMENT/Library/book/default', 'wallet:A'])
recordViewerPositionSeed('seeded', seedIdentity, { page: 3, zoom: 150 })
const seeded = store.get('seeded', seedIdentity)
assert.equal(seeded.page, 3)
assert.equal(seeded.zoom, 150)
seeded.page = 9
assert.equal(store.get('seeded', seedIdentity).page, 9, 'A later position change is never re-seeded')
store.retain([])
assert.equal(store.get('seeded', seedIdentity).page, 1, 'The seed is consumed once, not on every fresh tab')
// A tab whose identity changed before its first read drops the seed rather
// than applying an address position to a different resource or account.
recordViewerPositionSeed('moved', seedIdentity, { mediaTime: 12 })
assert.equal(store.get('moved', otherIdentity).mediaTime, 0)
assert.equal(store.get('moved', seedIdentity).mediaTime, 0, 'A dropped seed is not applied later')
recordViewerPositionSeed('cleared', seedIdentity, { page: 4 })
recordViewerPositionSeed('cleared', seedIdentity, null)
assert.equal(store.get('cleared', seedIdentity).page, 1, 'A bare address clears any pending seed')
const seedAll = createViewerPosition()
// No epubCfi: an address can never hand epub.js a CFI to resolve.
applyViewerPositionSeed(seedAll, { page: 5, zoom: 200, mediaTime: 31.5, line: 12,
  archivePath: 'folder/inner.zip' })
assert.deepEqual(seedAll, { scroll: { top: 0, left: 0 }, page: 5, zoom: 200, mediaTime: 31.5, line: 12,
  archivePath: 'folder/inner.zip', folders: seedAll.folders })
// A burst of seeded opens, larger than any former cap: no tab's pending seed is ever evicted by another's.
const burst = Array.from({ length: 600 }, (_value, index) => `burst-${index}`)
for (const [index, tab] of burst.entries()) recordViewerPositionSeed(tab, seedIdentity, { page: index + 1 })
for (const [index, tab] of burst.entries()) {
  assert.equal(store.get(tab, seedIdentity).page, index + 1, `Burst-opened tab ${tab} kept its own seed`)
}
// A tab closed before its viewer ever read the position drops the seed with it.
recordViewerPositionSeed('closed-early', seedIdentity, { page: 6 })
store.retain(burst)
assert.equal(store.get('closed-early', seedIdentity).page, 1, 'A closed tab\'s unread seed is discarded')
store.retain([])

const container = document.createElement('div')
document.body.append(container)
let root = createRoot(container)
const unmount = async () => { await act(async () => root.unmount()); root = createRoot(container) }
const waitFor = async (predicate: () => boolean) => {
  for (let i = 0; i < 200 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  assert.ok(predicate(), 'Expected asynchronous viewer state')
}
const click = async (selector: string) => {
  const button = container.querySelector<HTMLButtonElement>(selector)
  assert.ok(button, selector)
  await act(async () => button.click())
}
const base: HomeV2ResourceViewerState = { filename: 'note.txt', identifier: null, mimeType: null,
  name: 'Fixture', network: 'qortium', path: null, service: 'FILE', sourceTabId: 'one', streamUrl: 'capability:one' }
let bytes: Uint8Array = new TextEncoder().encode('long text\n'.repeat(100))
const loadBytes = async () => ({ bytes })
const save = async () => ({ canceled: true })
const render = async (resource = base, position = one, presentation: 'tab' | 'overlay' = 'tab') => {
  await act(async () => root.render(<HomeV2ResourceViewer resource={resource} position={position}
    presentation={presentation} appearance={defaultHomeV2Appearance} loadRetainedBytes={loadBytes}
    saveRetainedFile={save} saveRetainedBytes={save} onClose={() => undefined} />))
}
const scroll = () => container.querySelector<HTMLElement>('.home-v2-resource-viewer__content')!
one.scroll = { top: 350, left: 10 }
await render()
assert.equal(scroll().scrollTop, 350)
scroll().scrollTop = 610
scroll().dispatchEvent(new Event('scroll'))
await unmount()
await render({ ...base, streamUrl: 'capability:fresh' })
assert.equal(scroll().scrollTop, 610, 'Fresh access does not reset scroll')
await unmount()
await render(base, one, 'overlay')
assert.equal(scroll().scrollTop, 0, 'Private overlays never consume public position')
await unmount()

// A seeded line is MEASURED against the element the preview laid out for that
// source line, so wrapping cannot land it in the wrong place, and it is
// consumed once: the reader's own scrolling afterwards is never overwritten.
// This fixture wraps — the first 50 lines occupy two visual rows each — so the
// old proportional guess (1010px of content over 101 lines) would have scrolled
// to 500 instead of the line's real top.
const offsets = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop')
Object.defineProperty(HTMLElement.prototype, 'offsetTop', { configurable: true, get(this: HTMLElement) {
  const line = Number(this.getAttribute('data-source-line'))
  if (!Number.isInteger(line) || line < 1) return 0
  return line <= 51 ? (line - 1) * 40 : 50 * 40 + (line - 51) * 20
} })
const lineSeeded = createViewerPosition()
lineSeeded.line = 51
await render(base, lineSeeded)
assert.equal(container.querySelectorAll('[data-source-line]').length, 101, 'One element per source line')
assert.equal(lineSeeded.line, undefined, 'The seeded line is consumed at the first display')
assert.equal(lineSeeded.scroll.top, 2000, 'The measured top of line 51, not a proportion of the height')
assert.equal(scroll().scrollTop, 2000)
scroll().scrollTop = 120
scroll().dispatchEvent(new Event('scroll'))
await unmount()
await render({ ...base, streamUrl: 'capability:line-again' }, lineSeeded)
assert.equal(scroll().scrollTop, 120, 'A consumed line seed never re-applies over the reader')
await unmount()
// A formatted preview lays out no per-line element, so it ignores the key
// rather than guessing where the line would have been.
bytes = new TextEncoder().encode('# Title\n\nOne\n\nTwo\n\nThree\n')
const markdownSeeded = createViewerPosition()
markdownSeeded.line = 51
await render({ ...base, filename: 'notes.md', streamUrl: 'capability:markdown' }, markdownSeeded)
assert.equal(container.querySelector('[data-rich-preview="markdown"] h1')!.textContent, 'Title')
assert.equal(container.querySelectorAll('[data-source-line]').length, 0)
assert.equal(markdownSeeded.line, undefined, 'The request is consumed even where it cannot be honoured')
assert.deepEqual(markdownSeeded.scroll, { top: 0, left: 0 }, 'Markdown ignores a line rather than guessing')
assert.equal(scroll().scrollTop, 0)
await unmount()
if (offsets) Object.defineProperty(HTMLElement.prototype, 'offsetTop', offsets)
else Reflect.deleteProperty(HTMLElement.prototype, 'offsetTop')

// Actual comic ZIP extraction exercises the document load/reset and page clamp.
const comic = new JSZip()
comic.file('1.png', 'fixture'); comic.file('2.png', 'fixture')
bytes = await comic.generateAsync({ type: 'uint8array' })
const doc = createViewerPosition()
doc.page = 2; doc.zoom = 150
const documentResource = { ...base, filename: 'comic.cbz' }
await render(documentResource, doc)
await waitFor(() => !!container.querySelector('.doc-viewer__page-indicator'))
assert.match(container.querySelector('.doc-viewer__page-indicator')!.textContent!, /2.*2/)
assert.match(container.querySelector('.doc-viewer__zoom-level')!.textContent!, /150/)
await click('button[aria-label="Previous page"]')
assert.equal(doc.page, 1)
await click('button[aria-label="Zoom in"]')
assert.equal(doc.zoom, 175)
await unmount()
await render({ ...documentResource, streamUrl: 'capability:reopened' }, doc)
await waitFor(() => !!container.querySelector('.doc-viewer__page-indicator'))
assert.match(container.querySelector('.doc-viewer__page-indicator')!.textContent!, /1.*2/)
assert.match(container.querySelector('.doc-viewer__zoom-level')!.textContent!, /175/)
await unmount()
doc.page = 999
await render(documentResource, doc)
await waitFor(() => !!container.querySelector('.doc-viewer__page-indicator'))
assert.equal(doc.page, 2, 'Changed resource page count clamps remembered page')
await unmount()

// Re-open a selected document inside two real archive levels, through fresh bytes.
const inner = new JSZip(); inner.file('comic.cbz', bytes)
const outer = new JSZip(); outer.file('folder/inner.zip', await inner.generateAsync({ type: 'uint8array' }))
bytes = await outer.generateAsync({ type: 'uint8array' })
const archive = createViewerPosition()
archive.archivePath = 'folder/inner.zip'
const innerPosition = archiveChildPosition(archive, archive.archivePath)!
innerPosition.archivePath = 'comic.cbz'
archiveChildPosition(innerPosition, 'comic.cbz')!.page = 2
await render({ ...base, filename: 'outer.zip' }, archive)
await waitFor(() => !!container.querySelector('.doc-viewer__page-indicator'))
assert.match(container.querySelector('.doc-viewer__page-indicator')!.textContent!, /2.*2/)
await unmount()
await render({ ...base, filename: 'outer.zip', streamUrl: 'capability:new-archive' }, archive)
await waitFor(() => !!container.querySelector('.doc-viewer__page-indicator'))
assert.match(container.querySelector('.doc-viewer__page-indicator')!.textContent!, /2.*2/)
await click('.qdn-archive__back')
assert.equal(archive.archivePath, undefined)
await waitFor(() => !!container.querySelector('.qdn-archive__tree'))
await click('.qdn-archive__row--dir')
assert.equal(archive.folders.folder, false)
await unmount()
await render({ ...base, filename: 'outer.zip' }, archive)
await waitFor(() => !!container.querySelector('.qdn-archive__tree'))
assert.equal(container.querySelector('.qdn-archive__row--dir')!.getAttribute('aria-expanded'), 'false')
await unmount()
archive.archivePath = 'missing.zip'
await render({ ...base, filename: 'outer.zip' }, archive)
await waitFor(() => !!container.querySelector('.qdn-archive__tree'))
assert.equal(archive.archivePath, undefined, 'No arbitrary path fetch for a missing archive member')
await unmount()

// A media time seed reaches the element as an ordinary opening position.
// A seed recorded after that identity was already read is DISCARDED, not held
// pending to revive the next time the tab's position is cleared or reset.
store.get('read-already', seedIdentity)
recordViewerPositionSeed('read-already', seedIdentity, { mediaTime: 7.5 })
assert.equal(store.get('read-already', seedIdentity).mediaTime, 0, 'A tab that already read its position is not re-seeded')
assert.equal(store.get('read-already', otherIdentity).mediaTime, 0, 'A late seed cannot revive on an account change')
store.retain([])
assert.equal(store.get('read-already', seedIdentity).mediaTime, 0, 'A late seed cannot revive after a reset')
recordViewerPositionSeed('seeded-media', seedIdentity, { mediaTime: 7.5 })
const openedMedia = store.get('seeded-media', seedIdentity)
await act(async () => root.render(<PositionedMedia kind="audio" url="capability:seeded" position={openedMedia} />))
const seededAudio = container.querySelector<HTMLMediaElement>('audio')!
Object.defineProperty(seededAudio, 'duration', { value: 60 })
seededAudio.dispatchEvent(new Event('loadedmetadata'))
assert.equal(seededAudio.currentTime, 7.5)
assert.equal(seededAudio.paused, true, 'A seeded time never starts playback')
await unmount()

const mediaPosition = createViewerPosition(); mediaPosition.mediaTime = 42
for (const kind of ['audio', 'video'] as const) {
  await act(async () => root.render(<PositionedMedia kind={kind} url="capability:media" position={mediaPosition} />))
  const media = container.querySelector<HTMLMediaElement>(kind)!
  Object.defineProperty(media, 'duration', { value: 60 })
  let plays = 0
  media.play = async () => { plays++ }
  media.dispatchEvent(new Event('loadedmetadata'))
  assert.equal(media.currentTime, mediaPosition.mediaTime)
  assert.equal(media.paused, true); assert.equal(plays, 0)
  media.currentTime = 54
  media.dispatchEvent(new Event('timeupdate'))
  media.dispatchEvent(new Event('loadedmetadata'))
  assert.equal(media.currentTime, 54, 'Metadata repeats do not rewind user playback')
  await unmount()
  assert.equal(mediaPosition.mediaTime, 54)
}
// A loading container clamps scroll to zero; preserve the desired value until
// layout grows, then let real user interaction take over.
let resize = () => {}
const OriginalObserver = globalThis.ResizeObserver
globalThis.ResizeObserver = class {
  constructor(callback: () => void) { resize = callback }
  observe() {} unobserve() {} disconnect() {}
} as unknown as typeof ResizeObserver
const delayed = createViewerPosition(); delayed.scroll.top = 200
let extent = 0, actual = 0
function DelayedScroll() {
  const ref = useRef<HTMLDivElement>(null)
  useViewerScroll(ref, delayed, true)
  return <div ref={element => {
    ref.current = element
    if (element) Object.defineProperty(element, 'scrollTop', { configurable: true,
      get: () => actual, set: value => { actual = Math.min(extent, value) } })
  }}><div /></div>
}
await act(async () => root.render(<DelayedScroll />))
assert.equal(actual, 0); assert.equal(delayed.scroll.top, 200)
extent = 1000; resize()
assert.equal(actual, 200)
container.firstElementChild!.dispatchEvent(new Event('wheel'))
actual = 300; container.firstElementChild!.dispatchEvent(new Event('scroll'))
assert.equal(delayed.scroll.top, 300)
await unmount()
extent = 0; actual = 0
await act(async () => root.render(<DelayedScroll />))
await unmount()
assert.equal(delayed.scroll.top, 300, 'Leaving before layout is ready does not overwrite the desired position')
globalThis.ResizeObserver = OriginalObserver

// The first EPUB display targets the remembered CFI (no flash at chapter one).
const epub = createViewerPosition(); epub.epubCfi = 'epubcfi(/6/2!/4/2/1:0)'
const displays: (string | undefined)[] = []
const listeners = new Map<string, (...args: unknown[]) => void>()
let readyCalls = 0
const rendition = { display: async (target?: string) => { displays.push(target) },
  on: (event: string, handler: (...args: unknown[]) => void) => listeners.set(event, handler),
  off: (event: string) => listeners.delete(event), themes: { fontSize: () => undefined } }
const book = { renderTo: () => rendition } as never
await act(async () => root.render(<EpubViewer book={book} position={epub} scrollRef={{ current: null }} onRenditionReady={() => readyCalls++} />))
assert.deepEqual(displays, [epub.epubCfi]); assert.equal(readyCalls, 1)
listeners.get('relocated')!({ start: { cfi: 'epubcfi(/6/4!/4/2/1:0)' } })
assert.equal(epub.epubCfi, 'epubcfi(/6/4!/4/2/1:0)')
await unmount(); assert.equal(listeners.size, 0)
displays.length = 0
rendition.display = async target => { (displays as (string | undefined)[]).push(target); if (target) throw new Error('Updated book has no old location') }
let displayedPage = 2
const fallbackDisplay = rendition.display
rendition.display = async target => {
  await fallbackDisplay(target)
  listeners.get('relocated')!({ start: { index: 0 } })
}
await act(async () => root.render(<EpubViewer book={book} position={epub} scrollRef={{ current: null }} onRenditionReady={() => readyCalls++} onPageChange={page => { displayedPage = page }} />))
assert.equal(displays.length, 2); assert.equal(displays[1], undefined)
assert.equal(epub.epubCfi, undefined)
assert.equal(displayedPage, 1, 'Fallback and the first relocated event update the visible page too')
await act(async () => root.unmount())
console.log('Viewer position ownership, address seeds, scroll, document page/zoom/clamp, nested archives and paused media passed')
