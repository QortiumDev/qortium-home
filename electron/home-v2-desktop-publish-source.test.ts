import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { unzipSync } from 'fflate'

import { buildHomeV2DirectoryPublishZip } from './home-v2-desktop-publish-source.js'

const workingDirectory = await mkdtemp(path.join(tmpdir(), 'home-v2-publish-dir-'))

try {
  // A nested directory of files round-trips through the zip byte-for-byte.
  await mkdir(path.join(workingDirectory, 'nested'))
  await writeFile(path.join(workingDirectory, 'video.bin'), Buffer.from('pretend video bytes'))
  await writeFile(path.join(workingDirectory, 'nested', 'poster.txt'), Buffer.from('pretend poster bytes'))

  const result = await buildHomeV2DirectoryPublishZip(workingDirectory, 10 * 1024 * 1024)
  const unzipped = unzipSync(result.bytes)
  assert.equal(Object.keys(unzipped).length, 2)
  assert.equal(Buffer.from(unzipped['video.bin']).toString(), 'pretend video bytes')
  assert.equal(Buffer.from(unzipped['nested/poster.txt']).toString(), 'pretend poster bytes')
  assert.equal(result.size, result.bytes.byteLength)

  // A symlink anywhere in the tree is refused. Symlink creation requires a
  // privilege this process may not hold (e.g. an unelevated account on
  // Windows without Developer Mode) - when that's the case, skip just this
  // scenario rather than failing the whole file. Wrapped in an IIFE so the
  // early `return` on EPERM exits only this scenario, not the module.
  await (async () => {
    const symlinkDirectory = await mkdtemp(path.join(tmpdir(), 'home-v2-publish-dir-symlink-'))
    try {
      await writeFile(path.join(symlinkDirectory, 'real.txt'), Buffer.from('x'))
      try {
        await symlink(path.join(symlinkDirectory, 'real.txt'), path.join(symlinkDirectory, 'link.txt'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') {
          return
        }
        throw error
      }
      await assert.rejects(
        buildHomeV2DirectoryPublishZip(symlinkDirectory, 10 * 1024 * 1024),
        /symbolic link/,
      )
    } finally {
      await rm(symlinkDirectory, { recursive: true, force: true })
    }
  })()

  // An empty directory is refused.
  const emptyDirectory = await mkdtemp(path.join(tmpdir(), 'home-v2-publish-dir-empty-'))
  await assert.rejects(buildHomeV2DirectoryPublishZip(emptyDirectory, 10 * 1024 * 1024), /empty/)
  await rm(emptyDirectory, { recursive: true, force: true })

  // Total (pre-zip) size over the ceiling is refused before reading file bytes.
  const bigDirectory = await mkdtemp(path.join(tmpdir(), 'home-v2-publish-dir-big-'))
  await writeFile(path.join(bigDirectory, 'big.bin'), Buffer.alloc(2048))
  await assert.rejects(buildHomeV2DirectoryPublishZip(bigDirectory, 1024), /exceeds the size/)
  await rm(bigDirectory, { recursive: true, force: true })

  // A ceiling that fits the raw file bytes but not the zipped container
  // trips the SECOND, post-zip check specifically. Several one-byte files
  // keep totalBytes tiny (so the first, pre-zip check passes with the
  // ceiling set exactly to that total), while each file's fixed zip
  // overhead - a local file header, a central directory record, and the
  // end-of-central-directory record - deterministically pushes the
  // packaged size well past that same ceiling, with no reliance on
  // content compressibility.
  const packagedOverflowDirectory = await mkdtemp(path.join(tmpdir(), 'home-v2-publish-dir-packaged-'))
  const packagedOverflowFileNames = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt', 'f.txt']
  for (const fileName of packagedOverflowFileNames) {
    await writeFile(path.join(packagedOverflowDirectory, fileName), Buffer.from('x'))
  }
  await assert.rejects(
    buildHomeV2DirectoryPublishZip(packagedOverflowDirectory, packagedOverflowFileNames.length),
    /once packaged/,
  )
  await rm(packagedOverflowDirectory, { recursive: true, force: true })
} finally {
  await rm(workingDirectory, { recursive: true, force: true })
}

console.log('Home v2 desktop publish source tests passed.')
