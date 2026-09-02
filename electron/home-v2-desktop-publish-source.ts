import { BrowserWindow, dialog } from 'electron'
import { constants as fsConstants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { lstat as lstatPromise, readFile, readdir } from 'node:fs/promises'
import nodePath from 'node:path'

import { zipSync } from 'fflate'

import {
  HOME_V2_PUBLISH_SOURCE_MAX_BYTES,
  HomeV2PublishSourceTokenStore,
  type HomeV2PublishSourceBinding,
  type HomeV2PublishSourceDescriptor,
} from './home-v2-publish-source-tokens.js'
import { PUBLIC_QDN_ATTESTATION_MAX_BYTES } from './qdn-content-attestation.js'

export type HomeV2DesktopPublishSource = HomeV2PublishSourceDescriptor & (
  | Readonly<{
      device: bigint
      inode: bigint
      kind: 'file'
      path: string
    }>
  // STAGE_QDN_PUBLISH_SOURCE (B1): bytes an app handed over (paste/drop),
  // held in main-process memory until published, released, or TTL-evicted.
  | Readonly<{
      bytes: Uint8Array
      kind: 'blob'
    }>
  // A directory selection, zipped in memory at selection time (see
  // buildHomeV2DirectoryPublishZip). From here on it's just bytes like a
  // blob source, plus isZip so the publish path knows to unpack it.
  | Readonly<{
      bytes: Uint8Array
      isZip: true
      kind: 'directory'
    }>
)

// File sources cost no store memory (bytes stay on disk until publish); blob
// sources are budgeted so staged pastes can never grow Home's memory
// unboundedly — the oldest staged blobs are evicted once the budget is hit.
export const homeV2DesktopPublishSources = new HomeV2PublishSourceTokenStore<HomeV2DesktopPublishSource>(
  16,
  undefined,
  undefined,
  {
    // Paste/drop blobs stay individually capped by HOME_V2_PUBLISH_BLOB_MAX_BYTES
    // (25 MiB) - this is the AGGREGATE budget across all retained in-memory
    // sources. Zip-bundled directory selections can each be up to
    // PUBLIC_QDN_ATTESTATION_MAX_BYTES, so the aggregate budget is widened to
    // 2x that, letting at least one full-size selection be retained without
    // being evicted while still bounding how much memory repeated large
    // folder selections (without publishing) can pin - without this,
    // nothing would stop up to `maximumEntries` (16) such selections from
    // being retained simultaneously.
    maximumBytes: 2 * PUBLIC_QDN_ATTESTATION_MAX_BYTES,
    sizeOf: (source) => (source.kind === 'blob' || source.kind === 'directory' ? source.size : 0),
  },
)

export function stageHomeV2DesktopPublishBlob(
  binding: HomeV2PublishSourceBinding,
  blob: Readonly<{ bytes: Uint8Array; fileName: string; mimeType: string | null }>,
) {
  const source: HomeV2DesktopPublishSource = Object.freeze({
    bytes: blob.bytes,
    fileName: blob.fileName,
    kind: 'blob' as const,
    mimeType: blob.mimeType,
    size: blob.bytes.byteLength,
  })
  return {
    canceled: false as const,
    fileName: source.fileName,
    kind: 'blob' as const,
    mimeType: source.mimeType,
    size: source.size,
    sourceToken: homeV2DesktopPublishSources.issue(binding, source),
  }
}

type HomeV2DirectoryZipEntry = { absolutePath: string; relativePath: string; size: number }

/**
 * Stat-walks a directory (refusing symlinks and anything that isn't a
 * plain file or subdirectory), then reads every file and zips them in
 * memory. Pure - no Electron imports - so it's independently testable
 * with real temp directories. `ceilingBytes` is checked twice: against
 * the summed original file sizes (fails fast before reading any file
 * content) and again against the final zipped size.
 *
 * Note: files are lstat-checked for symlinks during the walk, then read
 * in a separate later pass. Unlike readHomeV2DesktopPublishSource's
 * read-time re-validation (which defends against a much longer gap - up
 * to a 30-minute token TTL spanning an explicit user-approval step),
 * this function has no equivalent re-check, because the walk-to-read
 * window here is entirely internal to one synchronous call.
 */
export async function buildHomeV2DirectoryPublishZip(directoryPath: string, ceilingBytes: number) {
  const entries: HomeV2DirectoryZipEntry[] = []
  let totalBytes = 0

  async function walk(currentPath: string, relativePrefix: string): Promise<void> {
    const directoryEntries = await readdir(currentPath, { withFileTypes: true })
    for (const directoryEntry of directoryEntries) {
      const absolutePath = nodePath.join(currentPath, directoryEntry.name)
      const relativePath = relativePrefix ? `${relativePrefix}/${directoryEntry.name}` : directoryEntry.name
      const stats = await lstatPromise(absolutePath)
      if (stats.isSymbolicLink()) {
        throw new Error(`Publish source directory contains a symbolic link at "${relativePath}", which is not allowed.`)
      }
      if (stats.isDirectory()) {
        await walk(absolutePath, relativePath)
        continue
      }
      if (!stats.isFile()) {
        throw new Error(`Publish source directory contains an unsupported entry at "${relativePath}".`)
      }
      totalBytes += stats.size
      if (totalBytes > ceilingBytes) {
        throw new Error('Publish source directory exceeds the size this node will accept.')
      }
      entries.push({ absolutePath, relativePath, size: stats.size })
    }
  }

  await walk(directoryPath, '')
  if (entries.length === 0) {
    throw new Error('Publish source directory is empty.')
  }

  const files: Record<string, Uint8Array> = {}
  for (const entry of entries) {
    files[entry.relativePath] = await readFile(entry.absolutePath)
  }

  const zipped = zipSync(files, { level: 6 })
  if (zipped.byteLength > ceilingBytes) {
    throw new Error('Publish source directory exceeds the size this node will accept once packaged.')
  }
  return { bytes: zipped, size: zipped.byteLength }
}

export async function selectHomeV2DesktopPublishSource(
  windowId: number,
  binding: HomeV2PublishSourceBinding,
  kind: 'file' | 'directory' = 'file',
  ceilingBytes: number = HOME_V2_PUBLISH_SOURCE_MAX_BYTES,
) {
  const hostWindow = BrowserWindow.fromId(windowId)
  if (!hostWindow || hostWindow.isDestroyed()) {
    throw new Error('Publish source selection does not belong to an active Home window.')
  }
  const result = await dialog.showOpenDialog(hostWindow, {
    buttonLabel: 'Select',
    properties: [kind === 'directory' ? 'openDirectory' : 'openFile'],
    title: `Select ${binding.network === 'qortal' ? 'Qortal' : 'Qortium'} publish source`,
  })
  if (result.canceled || !result.filePaths[0]) return { canceled: true as const }
  const selectedPath = result.filePaths[0]

  if (kind === 'directory') {
    const zipped = await buildHomeV2DirectoryPublishZip(selectedPath, ceilingBytes)
    const source: HomeV2DesktopPublishSource = Object.freeze({
      bytes: zipped.bytes,
      fileName: `${nodePath.basename(selectedPath).slice(0, 176) || 'qdn-resource'}.zip`,
      isZip: true as const,
      kind: 'directory' as const,
      mimeType: null,
      size: zipped.size,
    })
    return {
      canceled: false as const,
      fileName: source.fileName,
      kind: 'directory' as const,
      mimeType: source.mimeType,
      size: zipped.size,
      sourceToken: homeV2DesktopPublishSources.issue(binding, source),
    }
  }

  const stats = await lstat(selectedPath, { bigint: true })
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('Publish source must be a regular file, not a directory or symbolic link.')
  }
  const size = Number(stats.size)
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new Error('Publish source is empty or unreadable.')
  }
  if (size > ceilingBytes) {
    throw new Error('Publish source exceeds the size this node will accept.')
  }
  const source: HomeV2DesktopPublishSource = Object.freeze({
    device: stats.dev,
    fileName: nodePath.basename(selectedPath).slice(0, 180) || 'qdn-resource',
    inode: stats.ino,
    kind: 'file' as const,
    mimeType: null,
    path: selectedPath,
    size,
  })
  return {
    canceled: false as const,
    fileName: source.fileName,
    kind: 'file' as const,
    mimeType: source.mimeType,
    size,
    sourceToken: homeV2DesktopPublishSources.issue(binding, source),
  }
}

export async function readHomeV2DesktopPublishSource(source: HomeV2DesktopPublishSource) {
  if (source.kind === 'blob' || source.kind === 'directory') {
    // Copy on read: publish paths hash and post these bytes, and must never
    // share a buffer with whatever else still references the staged source.
    if (source.bytes.byteLength !== source.size) {
      throw new Error('Staged publish source changed after staging. Stage the bytes again.')
    }
    return Uint8Array.from(source.bytes)
  }

  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
  let handle
  try {
    handle = await open(source.path, fsConstants.O_RDONLY | noFollow)
  } catch {
    throw new Error('Selected publish source is no longer safely readable. Select the file again.')
  }
  try {
    const stats = await handle.stat({ bigint: true })
    if (
      !stats.isFile() ||
      stats.dev !== source.device ||
      stats.ino !== source.inode ||
      Number(stats.size) !== source.size
    ) {
      throw new Error('Selected publish source changed after selection. Select the file again.')
    }
    const bytes = new Uint8Array(await handle.readFile())
    if (bytes.byteLength !== source.size) {
      throw new Error('Selected publish source changed while it was being read.')
    }
    return bytes
  } finally {
    await handle.close()
  }
}
