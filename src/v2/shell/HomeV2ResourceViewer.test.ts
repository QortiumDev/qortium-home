import assert from 'node:assert/strict'
import {
  classifyHomeV2ResourceViewer,
  readHomeV2RetainedViewerBytes,
} from './home-v2-retained-viewer'
import type { HomeV2ResourceViewerState } from './HomeV2ResourceViewer'

const base: HomeV2ResourceViewerState = {
  filename: 'book.epub',
  identifier: null,
  mimeType: null,
  name: 'Library',
  network: 'qortium',
  path: null,
  service: 'DOCUMENT',
  sourceTabId: 'tab-1',
  streamUrl: 'qortium-home-resource://stream/00000000-0000-4000-8000-000000000000',
}

assert.equal(classifyHomeV2ResourceViewer(base), 'document')
for (const [filename, mimeType, kind] of [
  ['note.md', 'text/plain', 'markdown'], ['data.csv', 'text/csv', 'csv'],
  ['data.json', 'application/json', 'json'], ['source.js', 'text/javascript', 'code'],
  ['note.txt', 'text/plain', 'text'], ['raw.html', 'text/html', 'code'],
] as const) assert.equal(classifyHomeV2ResourceViewer({ ...base, filename, mimeType }), kind)
assert.equal(classifyHomeV2ResourceViewer({ ...base, service: 'FILE', filename: 'photo.png' }), 'image')
assert.equal(classifyHomeV2ResourceViewer({ ...base, service: 'FILE', filename: 'clip.mp4' }), 'video')
assert.equal(classifyHomeV2ResourceViewer({ ...base, service: 'FILE', filename: 'untrusted.svg' }), 'download')
assert.equal(
  classifyHomeV2ResourceViewer({ ...base, filename: 'bundle.zip' }),
  'archive',
)
assert.equal(
  classifyHomeV2ResourceViewer({ ...base, filename: null, mimeType: 'application/x-zip-compressed' }),
  'archive',
)
assert.equal(
  classifyHomeV2ResourceViewer({ ...base, filename: null, mimeType: 'application/x-rar' }),
  'archive',
)
assert.equal(
  classifyHomeV2ResourceViewer({ ...base, filename: 'photo.png', mimeType: 'image/png' }),
  'image',
)
assert.equal(
  classifyHomeV2ResourceViewer({ ...base, filename: 'unknown.bin' }),
  'download',
)

const bytes = await readHomeV2RetainedViewerBytes(
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3]))
        controller.close()
      },
    }),
    { status: 200 },
  ),
  3,
)
assert.deepEqual([...bytes], [1, 2, 3])
await assert.rejects(
  readHomeV2RetainedViewerBytes(
    new Response(new Uint8Array([1]), {
      headers: { 'content-length': '4' },
      status: 200,
    }),
    3,
  ),
  /byte limit/,
)
await assert.rejects(
  readHomeV2RetainedViewerBytes(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]))
        },
      }),
      { status: 200 },
    ),
    3,
  ),
  /byte limit/,
)

console.log('Home v2 retained resource viewer tests passed.')

let canceled = false
await assert.rejects(readHomeV2RetainedViewerBytes(new Response(new ReadableStream({
  cancel() { canceled = true },
}), { headers: { 'content-length': String(1024 * 1024 + 1) } }), 1024 * 1024), /limit/)
assert.equal(canceled, true, 'Oversized declared bodies are canceled without downloading')
