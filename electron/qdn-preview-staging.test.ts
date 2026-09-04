import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'

import {
  QDN_PREVIEW_STAGING_MAX_TRACKED,
  QDN_PREVIEW_STAGING_PREFIX,
  cleanupQdnPreviewStagingDirs,
  countTrackedQdnPreviewStagingDirs,
  releaseQdnPreviewStagingDir,
  sweepOrphanedQdnPreviewStagingDirs,
  trackQdnPreviewStagingDir,
} from './qdn-preview-staging.js'

const root = await mkdtemp(nodePath.join(tmpdir(), 'qdn-preview-staging-test-'))

async function makeStagingDir(name: string) {
  const stagingDir = nodePath.join(root, name)
  await mkdir(stagingDir, { recursive: true })
  return stagingDir
}

try {
  assert.equal(countTrackedQdnPreviewStagingDirs(), 0)

  // -------------------------------------------------------------------------
  // 1.x behaviour, unchanged: previewing the SAME source path again replaces
  // the directory it staged into, and removes the one it is replacing.
  // -------------------------------------------------------------------------
  const first = await makeStagingDir('first')
  const second = await makeStagingDir('second')
  await trackQdnPreviewStagingDir('/home/user/site', first)
  assert.equal(countTrackedQdnPreviewStagingDirs(), 1)
  await trackQdnPreviewStagingDir('/home/user/site', second)
  assert.equal(countTrackedQdnPreviewStagingDirs(), 1, 'the same source keeps one entry')
  assert.equal(existsSync(first), false, 'the replaced staging dir is removed')
  assert.equal(existsSync(second), true)

  // -------------------------------------------------------------------------
  // The Home 2 leak. Its preview stages a fresh mkdtemp copy and hands the
  // stager THAT path, so the key never repeats and the reuse branch above can
  // never fire. Removing the directory in the caller's `finally` has to drop
  // the entry with it, or the map grows once per PREVIEW_QDN_PUBLISH_SOURCE --
  // an action any app can make, with no permission prompt, in a loop.
  // -------------------------------------------------------------------------
  assert.equal(releaseQdnPreviewStagingDir(second), true)
  assert.equal(countTrackedQdnPreviewStagingDirs(), 0)
  assert.equal(releaseQdnPreviewStagingDir(second), false, 'releasing twice is a no-op')
  assert.equal(
    releaseQdnPreviewStagingDir(nodePath.join(root, 'never-tracked')),
    false,
    'an untracked directory is not an error',
  )
  // Releasing is bookkeeping only: the caller owns the on-disk removal, and
  // the app-bridge tracking Set still does it.
  assert.equal(existsSync(second), true, 'releasing must not delete anything itself')

  for (let index = 0; index < 200; index += 1) {
    const stagingDir = await makeStagingDir(`fresh-${index}`)
    await trackQdnPreviewStagingDir(`/tmp/fresh-source-${index}`, stagingDir)
    releaseQdnPreviewStagingDir(stagingDir)
  }
  assert.equal(
    countTrackedQdnPreviewStagingDirs(),
    0,
    'a preview that releases its directory leaves nothing behind',
  )

  // -------------------------------------------------------------------------
  // The backstop, for any caller that forgets to release: the map is bounded,
  // and evicting the oldest entry removes its directory too.
  // -------------------------------------------------------------------------
  const tracked: string[] = []
  for (let index = 0; index < QDN_PREVIEW_STAGING_MAX_TRACKED + 10; index += 1) {
    const stagingDir = await makeStagingDir(`leaky-${index}`)
    tracked.push(stagingDir)
    await trackQdnPreviewStagingDir(`/tmp/leaky-source-${index}`, stagingDir)
  }
  assert.equal(countTrackedQdnPreviewStagingDirs(), QDN_PREVIEW_STAGING_MAX_TRACKED)
  assert.equal(existsSync(tracked[0]), false, 'the oldest evicted staging dir is removed')
  assert.equal(existsSync(tracked[tracked.length - 1]), true, 'the newest stays')

  // The quit path still clears everything it is holding.
  cleanupQdnPreviewStagingDirs()
  assert.equal(countTrackedQdnPreviewStagingDirs(), 0)
  assert.equal(existsSync(tracked[tracked.length - 1]), false)

  // -------------------------------------------------------------------------
  // The startup sweep collects directories left by a crashed session, which it
  // recognises by prefix rather than by anything it remembers.
  // -------------------------------------------------------------------------
  const orphan = await mkdtemp(nodePath.join(tmpdir(), QDN_PREVIEW_STAGING_PREFIX))
  assert.equal(existsSync(orphan), true)
  await sweepOrphanedQdnPreviewStagingDirs()
  assert.equal(existsSync(orphan), false, 'an orphaned staging dir is swept on startup')
  assert.equal(
    (await readdir(tmpdir())).some((entry) => entry.startsWith(QDN_PREVIEW_STAGING_PREFIX)),
    false,
  )

  console.log('qdn-preview-staging tests passed.')
} finally {
  await rm(root, { force: true, recursive: true })
}
