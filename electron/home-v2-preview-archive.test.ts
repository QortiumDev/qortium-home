import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { unzipSync } from 'fflate'

import { spoolHomeV2PreviewArchive } from './home-v2-preview-archive.js'

const root = await mkdtemp(nodePath.join(tmpdir(), 'qortium-home-preview-archive-test-'))
const out = await mkdtemp(nodePath.join(tmpdir(), 'qortium-home-preview-archive-out-'))
const archivePath = nodePath.join(out, 'preview-upload.zip')

try {
  await writeFile(nodePath.join(root, 'index.html'), '<h1>preview</h1>')
  await mkdir(nodePath.join(root, 'assets', 'deep'), { recursive: true })
  await writeFile(nodePath.join(root, 'assets', 'style.css'), 'body{color:red}')
  await writeFile(nodePath.join(root, 'assets', 'deep', 'note.txt'), 'x'.repeat(50_000))

  const size = await spoolHomeV2PreviewArchive(root, archivePath)
  // The archive is on DISK, not in memory: a 100 MiB preview used to cost the
  // chunks, a concatenation, a Buffer copy and a ~133 MiB base64 string of the
  // whole thing before anything was sent (security review, 2026-09-02).
  assert.equal((await stat(archivePath)).size, size)
  const files = unzipSync(readFileSync(archivePath))
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
  assert.ok(size < 50_000, 'the archive must be compressed')

  // The same tree gives the same bytes across clocks AND time zones, so
  // Core's content hash stays stable. Two back-to-back real-clock calls can
  // accidentally pass because ZIP timestamps have two-second resolution.
  const originalNow = Date.now
  const originalTimeZone = process.env.TZ
  try {
    for (const [index, timeZone] of ['UTC', 'America/New_York', 'Pacific/Kiritimati'].entries()) {
      process.env.TZ = timeZone
      // Deliberately different days/years: never depend on a sleep landing
      // across a wall-clock boundary to exercise the regression.
      Date.now = () => Date.UTC(2030 + index, 5, 15, 12, 34, 56)
      const againPath = nodePath.join(out, `again-${index}.zip`)
      await spoolHomeV2PreviewArchive(root, againPath)
      assert.deepEqual(
        readFileSync(againPath),
        readFileSync(archivePath),
        `identical preview bytes under ${timeZone} and a changed clock`,
      )
    }
  } finally {
    Date.now = originalNow
    if (originalTimeZone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimeZone
  }

  // The wire BOUND. A tree whose archive would exceed the cap is refused with
  // the fixed, path-free sentence rather than being written out whole -- and
  // the message names no directory, because preview failures reach an APP.
  await assert.rejects(
    () => spoolHomeV2PreviewArchive(root, nodePath.join(out, 'capped.zip'), 64),
    (error: Error) =>
      /too large to preview/.test(error.message) && !error.message.includes(root),
  )
  // The partial archive is REMOVED, not merely abandoned: nothing may go on to
  // upload half of one, and a spool outside the caller's staging sweep would
  // otherwise leak it.
  await assert.rejects(() => stat(nodePath.join(out, 'capped.zip')), /ENOENT/)

  // A sink that cannot be written REJECTS rather than raising an unhandled
  // 'error' event -- which, with no listener, Node re-raises as an uncaught
  // exception and takes the whole main process down with it (review round 3).
  // A directory in place of the archive path is the portable way to make the
  // write stream fail (EISDIR).
  {
    const blocked = nodePath.join(out, 'blocked-archive.zip')
    await mkdir(blocked, { recursive: true })
    await assert.rejects(
      () => spoolHomeV2PreviewArchive(root, blocked),
      (error: Error) => error instanceof Error && !/too large to preview/.test(error.message),
    )
  }

  // An empty selection has nothing to render and is refused rather than
  // producing a zero-entry archive Core would fail on later.
  const empty = await mkdtemp(nodePath.join(tmpdir(), 'qortium-home-preview-archive-empty-'))
  try {
    await assert.rejects(
      () => spoolHomeV2PreviewArchive(empty, nodePath.join(out, 'empty.zip')),
      /Unsupported preview content/,
    )
  } finally {
    await rm(empty, { force: true, recursive: true })
  }
} finally {
  await rm(root, { force: true, recursive: true })
  await rm(out, { force: true, recursive: true })
}

console.log('Home v2 preview archive tests passed.')
