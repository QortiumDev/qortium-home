import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'

import {
  HOME_V2_PUBLISH_DIRECTORY_LIMITS,
  describeHomeV2PublishSourcePath,
} from './home-v2-publish-source-selection.js'
import {
  readHomeV2PublishSnapshotForTest,
  removeHomeV2PublishSnapshot,
  stageHomeV2PublishSnapshot,
} from './home-v2-publish-snapshot.js'

const root = await mkdtemp(nodePath.join(tmpdir(), 'home-v2-publish-snapshot-test-'))
try {
  const sourcePath = nodePath.join(root, 'video.bin')
  const bytes = Buffer.alloc(1024 * 1024 + 17, 0x5a)
  await writeFile(sourcePath, bytes)
  const source = await describeHomeV2PublishSourcePath(sourcePath, 'file', {
    ...HOME_V2_PUBLISH_DIRECTORY_LIMITS,
    maximumFileBytes: bytes.length,
  })
  const snapshot = await stageHomeV2PublishSnapshot(source, bytes.length)
  assert.equal(snapshot.size, bytes.length)
  assert.equal(snapshot.fileName, 'video.bin')
  assert.equal(snapshot.contentHash, createHash('sha256').update(bytes).digest('hex'))
  assert.deepEqual(await readHomeV2PublishSnapshotForTest(snapshot), bytes)
  await removeHomeV2PublishSnapshot(snapshot)

  await assert.rejects(stageHomeV2PublishSnapshot(source, bytes.length - 1), /trusted-node route limit/)
} finally {
  await rm(root, { force: true, recursive: true })
}

console.log('Home v2 publish snapshot tests passed.')
