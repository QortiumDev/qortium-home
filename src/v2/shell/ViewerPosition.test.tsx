import assert from 'node:assert/strict'
import React, { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import JSZip from 'jszip'
import { createViewerPosition, createViewerPositionStore, archiveChildPosition } from '../../viewer-position'
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
console.log('Viewer position ownership, scroll, document page/zoom/clamp, nested archives and paused media passed')
