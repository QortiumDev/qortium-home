import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { unzipSync } from 'fflate'

import { zipHomeV2PreviewDirectory } from './home-v2-preview-archive.js'

const root = await mkdtemp(nodePath.join(tmpdir(), 'qortium-home-preview-archive-test-'))

try {
  await writeFile(nodePath.join(root, 'index.html'), '<h1>preview</h1>')
  await mkdir(nodePath.join(root, 'assets', 'deep'), { recursive: true })
  await writeFile(nodePath.join(root, 'assets', 'style.css'), 'body{color:red}')
  await writeFile(nodePath.join(root, 'assets', 'deep', 'note.txt'), 'x'.repeat(50_000))

  const packed = await zipHomeV2PreviewDirectory(root)
  const files = unzipSync(packed)
  // Paths are RELATIVE and forward-slashed: the staging directory Home owns
  // must not appear anywhere in what Core unpacks.
  assert.deepEqual(Object.keys(files).sort(), [
    'assets/deep/note.txt',
    'assets/style.css',
    'index.html',
  ])
  assert.equal(new TextDecoder().decode(files['index.html']), '<h1>preview</h1>')
  assert.equal(new TextDecoder().decode(files['assets/style.css']), 'body{color:red}')
  assert.equal(files['assets/deep/note.txt'].length, 50_000)
  // Deflated, not stored: the wire cost of a preview to a remote node matters.
  assert.ok(packed.length < 50_000, 'the archive must be compressed')

  // The same tree twice gives the same bytes, so Core's content hash -- and
  // therefore the /render/hash URL -- is stable across runs.
  const again = await zipHomeV2PreviewDirectory(root)
  assert.deepEqual(Array.from(again), Array.from(packed))

  // The wire BOUND. A tree whose archive would exceed the cap is refused with
  // the fixed, path-free sentence rather than being buffered whole -- and the
  // message names no directory, because preview failures reach an APP.
  await assert.rejects(
    () => zipHomeV2PreviewDirectory(root, 64),
    (error: Error) =>
      /too large to preview/.test(error.message) && !error.message.includes(root),
  )

  // An empty selection has nothing to render and is refused rather than
  // producing a zero-entry archive Core would fail on later.
  const empty = await mkdtemp(nodePath.join(tmpdir(), 'qortium-home-preview-archive-empty-'))
  try {
    await assert.rejects(() => zipHomeV2PreviewDirectory(empty), /Unsupported preview content/)
  } finally {
    await rm(empty, { force: true, recursive: true })
  }
} finally {
  await rm(root, { force: true, recursive: true })
}

console.log('Home v2 preview archive tests passed.')
