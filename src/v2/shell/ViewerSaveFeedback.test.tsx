import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import JSZip from 'jszip'
import { createViewerSaveStore } from './viewer-save-state'
import { HomeV2ResourceViewer, type HomeV2ResourceViewerState } from './HomeV2ResourceViewer'
import { defaultHomeV2Appearance } from '../appearance'

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const store = createViewerSaveStore()
const pending = deferred<{ canceled: boolean }>()
const unsubscribe = store.subscribe('one', () => undefined)
let calls = 0
const first = store.run('one', 'one.txt', () => { calls++; return pending.promise })
await store.run('one', 'duplicate.txt', async () => { calls++; return { canceled: false } })
assert.equal(calls, 1, 'The synchronous guard wins before a React rerender')
unsubscribe()
assert.equal(store.snapshot('one').phase, 'saving', 'Pending operation survives tab unmount')
const resubscribe = store.subscribe('one', () => undefined)
await store.run('other', 'other.txt', async () => ({ canceled: false }))
assert.equal(store.snapshot('other').phase, 'idle', 'Finished unobserved entries are discarded')
pending.resolve({ canceled: true }); await first
assert.equal(store.snapshot('one').phase, 'canceled')
await store.run('one', 'retry.txt', async () => { throw new Error('secret native path / capability') })
assert.equal(store.snapshot('one').phase, 'error')
assert.doesNotMatch(JSON.stringify(store.snapshot('one')), /secret/)
await store.run('one', 'retry.txt', async () => ({ canceled: false }))
assert.equal(store.snapshot('one').phase, 'saved')
resubscribe()
assert.equal(store.snapshot('one').phase, 'idle')

const container = document.createElement('div')
document.body.append(container)
let root = createRoot(container)
const resource: HomeV2ResourceViewerState = {
  filename: 'file.bin', identifier: null, mimeType: null, name: 'Fixture', network: 'qortium',
  path: null, service: 'FILE', sourceTabId: 'save-ui', streamUrl: 'capability:fixture',
}
let operation = deferred<{ canceled: boolean }>()
let saves = 0
const saveFile = async () => { saves++; return operation.promise }
const saveBytes = async (_filename: string, bytes: Uint8Array) => {
  assert.ok(bytes.byteLength)
  saves++; return operation.promise
}
let archiveBytes: Uint8Array = new Uint8Array()
const loadBytes = async () => ({ bytes: archiveBytes })
const render = async (value = resource, presentation: 'tab' | 'overlay' = 'tab') => {
  await act(async () => root.render(<HomeV2ResourceViewer presentation={presentation} appearance={defaultHomeV2Appearance}
    resource={value} onClose={() => undefined} saveRetainedFile={saveFile} saveRetainedBytes={saveBytes}
    loadRetainedBytes={loadBytes} />))
}
const click = async (selector: string) => {
  const button = container.querySelector<HTMLButtonElement>(selector)
  assert.ok(button, selector)
  await act(async () => button.click())
}
const phase = () => container.querySelector('[data-save-phase]')?.getAttribute('data-save-phase')
const waitFor = async (predicate: () => boolean) => {
  for (let i = 0; i < 100 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  assert.ok(predicate(), 'Expected asynchronous viewer state')
}
const saveButton = '.home-v2-resource-viewer__open'
await render()
await click(saveButton)
assert.equal(phase(), 'saving')
assert.equal(container.querySelector<HTMLButtonElement>(saveButton)!.disabled, true)
await click(saveButton)
assert.equal(saves, 1)
// A changed resource cannot receive the old operation's completion notice.
await render({ ...resource, name: 'Other', sourceTabId: 'other-tab' })
assert.equal(phase(), 'idle')
await render({ ...resource, streamUrl: 'capability:renewed' })
assert.equal(phase(), 'saving')
await click(saveButton); assert.equal(saves, 1)
await act(async () => operation.resolve({ canceled: true }))
assert.equal(phase(), 'canceled')
assert.match(container.textContent!, /Save canceled/)
operation = deferred()
await click(saveButton)
await act(async () => operation.reject(new Error('/private/path?token=secret')))
assert.equal(phase(), 'error')
assert.match(container.querySelector('[role="alert"]')!.textContent!, /Try saving again/)
assert.doesNotMatch(container.textContent!, /private\/path|token=/)
operation = deferred()
await click(saveButton)
await act(async () => operation.resolve({ canceled: false }))
assert.equal(phase(), 'saved')

// Every document download control shares the same operation/status, including
// the fallback offered when the document itself cannot render.
const documentResource = { ...resource, filename: 'bad.pdf', sourceTabId: 'document-tab' }
await render(documentResource)
operation = deferred()
await click('button[aria-label="Download"]')
assert.equal(phase(), 'saving')
assert.ok([...container.querySelectorAll<HTMLButtonElement>('button')].filter(button => button.textContent === 'Download' || button.getAttribute('aria-label') === 'Download').every(button => button.disabled))
await act(async () => operation.reject(new Error('save refused')))
assert.equal(phase(), 'error')
operation = deferred()
await click('button[aria-label="Download"]')
await act(async () => operation.resolve({ canceled: true }))
assert.equal(phase(), 'canceled')

// Actual ZIP parsing + file tree + nested document save use injected bytes,
// never the unavailable legacy node download bridge.
const zip = new JSZip()
zip.file('entry.txt', 'archive text')
zip.file('nested.pdf', 'invalid PDF fixture')
archiveBytes = await zip.generateAsync({ type: 'uint8array' })
const archiveResource = { ...resource, filename: 'fixture.zip', sourceTabId: 'archive-tab' }
await render(archiveResource)
await waitFor(() => !!container.querySelector('.qdn-archive__download'))
operation = deferred()
const beforeEntry = saves
await click('.qdn-archive__download')
assert.equal(phase(), 'saving')
assert.ok([...container.querySelectorAll<HTMLButtonElement>('.qdn-archive__download')].every(button => button.disabled))
assert.equal(container.querySelector<HTMLButtonElement>(saveButton)!.disabled, true)
await waitFor(() => saves === beforeEntry + 1)
await act(async () => operation.resolve({ canceled: false }))
assert.equal(phase(), 'saved')
const nestedButton = [...container.querySelectorAll<HTMLButtonElement>('.qdn-archive__open')].find(button => button.textContent?.includes('nested.pdf'))!
await act(async () => nestedButton.click())
await waitFor(() => !!container.querySelector('.doc-viewer-dialog'))
operation = deferred()
await click('button[aria-label="Download"]')
assert.equal(phase(), 'saving')
await act(async () => operation.resolve({ canceled: true }))
assert.equal(phase(), 'canceled')

await render(resource, 'overlay')
operation = deferred()
await click(saveButton)
await render({ ...resource, streamUrl: 'capability:reapproved' }, 'overlay')
assert.equal(phase(), 'idle', 'Private/source-bound overlays do not inherit an old capability save')
await act(async () => operation.resolve({ canceled: false }))
assert.equal(phase(), 'idle')

// Unmount while saving and remount with fresh access: no duplicate operation.
await render(resource)
operation = deferred()
await click(saveButton)
const before = saves
await act(async () => root.unmount())
root = createRoot(container)
await render({ ...resource, streamUrl: 'capability:replacement' })
assert.equal(phase(), 'saving')
await click(saveButton); assert.equal(saves, before)
await act(async () => root.unmount())
await act(async () => operation.resolve({ canceled: false }))
console.log('Viewer save status, single-flight, lifecycle, document and archive UI passed')
