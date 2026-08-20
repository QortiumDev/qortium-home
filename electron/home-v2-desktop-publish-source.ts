import { BrowserWindow, dialog } from 'electron'
import { constants as fsConstants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import nodePath from 'node:path'

import {
  HOME_V2_PUBLISH_SOURCE_MAX_BYTES,
  HomeV2PublishSourceTokenStore,
  type HomeV2PublishSourceBinding,
  type HomeV2PublishSourceDescriptor,
} from './home-v2-publish-source-tokens.js'

export type HomeV2DesktopPublishSource = HomeV2PublishSourceDescriptor & Readonly<{
  device: bigint
  inode: bigint
  path: string
}>

export const homeV2DesktopPublishSources = new HomeV2PublishSourceTokenStore<HomeV2DesktopPublishSource>(16)

export async function selectHomeV2DesktopPublishSource(
  windowId: number,
  binding: HomeV2PublishSourceBinding,
) {
  const hostWindow = BrowserWindow.fromId(windowId)
  if (!hostWindow || hostWindow.isDestroyed()) {
    throw new Error('Publish source selection does not belong to an active Home window.')
  }
  const result = await dialog.showOpenDialog(hostWindow, {
    buttonLabel: 'Select',
    properties: ['openFile'],
    title: `Select ${binding.network === 'qortal' ? 'Qortal' : 'Qortium'} publish source`,
  })
  if (result.canceled || !result.filePaths[0]) return { canceled: true as const }
  const selectedPath = result.filePaths[0]
  const stats = await lstat(selectedPath, { bigint: true })
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('Publish source must be a regular file, not a directory or symbolic link.')
  }
  const size = Number(stats.size)
  if (!Number.isSafeInteger(size) || size < 1 || size > HOME_V2_PUBLISH_SOURCE_MAX_BYTES) {
    throw new Error('Publish source must be between 1 byte and 100 MiB.')
  }
  const source: HomeV2DesktopPublishSource = Object.freeze({
    device: stats.dev,
    fileName: nodePath.basename(selectedPath).slice(0, 180) || 'qdn-resource',
    inode: stats.ino,
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
