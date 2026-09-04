import { createHash } from 'node:crypto'
import { constants as fsConstants, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import {
  homeV2PublishSourceError,
  type HomeV2DesktopPublishSource,
} from './home-v2-publish-source-selection.js'

const SNAPSHOT_PREFIX = 'qortium-home-auth-publish-'

export type HomeV2PublishSnapshot = Readonly<{
  contentHash: string
  directory: string
  fileName: string
  path: string
  size: number
}>

export async function removeHomeV2PublishSnapshot(snapshot: HomeV2PublishSnapshot) {
  await rm(snapshot.directory, { force: true, recursive: true }).catch(() => undefined)
}

export async function stageHomeV2PublishSnapshot(
  source: HomeV2DesktopPublishSource,
  maximumBytes: number,
): Promise<HomeV2PublishSnapshot> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('Authenticated publish staging requires a positive safe byte limit.')
  }
  if (source.kind === 'directory') {
    throw homeV2PublishSourceError('A folder can only be previewed, not published. Select a file to publish.')
  }
  if (!Number.isSafeInteger(source.size) || source.size < 1 || source.size > maximumBytes) {
    throw homeV2PublishSourceError(
      `Selected source exceeds the ${maximumBytes.toLocaleString()} byte authenticated trusted-node route limit.`,
    )
  }

  const directory = await mkdtemp(nodePath.join(tmpdir(), SNAPSHOT_PREFIX))
  await mkdir(directory, { mode: 0o700, recursive: true })
  const snapshotPath = nodePath.join(directory, 'source.bin')
  const hash = createHash('sha256')
  let written = 0
  try {
    if (source.kind === 'blob') {
      if (source.bytes.byteLength !== source.size) {
        throw homeV2PublishSourceError('Staged publish source changed after staging. Stage the bytes again.')
      }
      const output = await open(snapshotPath, 'wx', 0o600)
      try {
        await output.writeFile(source.bytes)
      } finally {
        await output.close()
      }
      hash.update(source.bytes)
      written = source.bytes.byteLength
    } else {
      const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
      let input
      try {
        input = await open(source.path, fsConstants.O_RDONLY | noFollow)
      } catch {
        throw homeV2PublishSourceError('Selected publish source is no longer safely readable. Select the file again.')
      }
      try {
        const stats = await input.stat({ bigint: true })
        if (
          !stats.isFile() ||
          stats.dev !== source.device ||
          stats.ino !== source.inode ||
          Number(stats.size) !== source.size
        ) {
          throw homeV2PublishSourceError('Selected publish source changed after selection. Select the file again.')
        }
        const meter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            written += chunk.byteLength
            if (written > maximumBytes) {
              callback(homeV2PublishSourceError(
                `Selected source exceeds the ${maximumBytes.toLocaleString()} byte authenticated trusted-node route limit.`,
              ))
              return
            }
            hash.update(chunk)
            callback(null, chunk)
          },
        })
        await pipeline(
          input.createReadStream({ autoClose: false }),
          meter,
          createWriteStream(snapshotPath, { flags: 'wx', mode: 0o600 }),
        )
      } finally {
        await input.close().catch(() => undefined)
      }
    }
    if (written !== source.size) {
      throw homeV2PublishSourceError('Selected publish source changed while it was being staged.')
    }
    return Object.freeze({
      contentHash: hash.digest('hex'),
      directory,
      fileName: source.fileName,
      path: snapshotPath,
      size: written,
    })
  } catch (error) {
    await rm(directory, { force: true, recursive: true }).catch(() => undefined)
    throw error
  }
}

export async function readHomeV2PublishSnapshotForTest(snapshot: HomeV2PublishSnapshot) {
  return readFile(snapshot.path)
}
