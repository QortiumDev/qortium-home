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

  // A symlink anywhere in the tree is refused. Windows directory junctions
  // (created via fs.symlink(target, path, 'junction')) work without an
  // elevated privilege, unlike ordinary symlinks - and lstat().isSymbolicLink()
  // reports true for a junction just as it does for a real symlink, so this
  // exercises the same check buildHomeV2DirectoryPublishZip uses in
  // production. Junctions only target directories, so the target here is a
  // subdirectory, not a file. The 'junction' type argument is Windows-specific
  // and is ignored (a no-op) on Linux/macOS, where an ordinary unprivileged
  // symlink already works fine. Still wrapped in a try/catch on EPERM in case
  // some exotic environment restricts even junctions - any other error is
  // rethrown, not swallowed. Wrapped in an IIFE so the early `return` on
  // EPERM exits only this scenario, not the module.
  await (async () => {
    const symlinkDirectory = await mkdtemp(path.join(tmpdir(), 'home-v2-publish-dir-symlink-'))
    try {
      await mkdir(path.join(symlinkDirectory, 'real-dir'))
      await writeFile(path.join(symlinkDirectory, 'real-dir', 'inner.txt'), Buffer.from('x'))
      try {
        await symlink(
          path.join(symlinkDirectory, 'real-dir'),
          path.join(symlinkDirectory, 'link-dir'),
          'junction',
        )
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

  // The selected directory itself being a symlink/junction (not just
  // containing one) is refused too - the root-level check added alongside
  // this test.
  await (async () => {
    const rootSymlinkDirectory = await mkdtemp(path.join(tmpdir(), 'home-v2-publish-dir-root-symlink-'))
    try {
      const realDirectory = path.join(rootSymlinkDirectory, 'real-dir')
      await mkdir(realDirectory)
      await writeFile(path.join(realDirectory, 'inner.txt'), Buffer.from('x'))
      const junctionPath = path.join(rootSymlinkDirectory, 'link-dir')
      try {
        await symlink(realDirectory, junctionPath, 'junction')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') {
          return
        }
        throw error
      }
      await assert.rejects(
        buildHomeV2DirectoryPublishZip(junctionPath, 10 * 1024 * 1024),
        /symbolic link/,
      )
    } finally {
      await rm(rootSymlinkDirectory, { recursive: true, force: true })
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
