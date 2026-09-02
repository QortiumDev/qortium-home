// The publish-source model shared by Home 2's desktop picker, its publish
// pipeline, and PREVIEW_QDN_PUBLISH_SOURCE.
//
// This module is deliberately pure (no electron imports) so every rule that
// decides what a source IS — file, folder, or staged blob — is unit-testable
// the same way the token store and the blob normalizer are. Only the dialog
// itself lives in home-v2-desktop-publish-source.ts.
import { constants as fsConstants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import nodePath from 'node:path'

import {
  HOME_V2_PUBLISH_SOURCE_MAX_BYTES,
  HomeV2PublishSourceTokenStore,
  type HomeV2PublishSourceBinding,
  type HomeV2PublishSourceDescriptor,
} from './home-v2-publish-source-tokens.js'

/**
 * What the app asked the picker for.
 *
 * `any` exists for callers that genuinely accept either; the bridge never
 * derives it from a request, because an app that wants both should say so by
 * asking twice rather than by omitting the field.
 */
export type HomeV2PublishSourcePickKind = 'any' | 'directory' | 'file'

/**
 * Top-level names Qortium Core accepts as a website's entry point.
 *
 * Shared with the 1.x preview stager (qdn.ts) rather than duplicated: the
 * picker asserting a NARROWER set than the stager would reject folders the
 * node would happily render, and a wider one would promise a preview that
 * then fails at the node.
 */
export const HOME_V2_PUBLISH_PREVIEW_INDEX_FILES: ReadonlySet<string> = new Set([
  'index.html',
  'index.htm',
  'default.html',
  'default.htm',
  'home.html',
  'home.htm',
])

/**
 * Folder ceilings.
 *
 * A folder preview never passes through Home's memory — Home hands the node a
 * PATH and the node reads it — so these are not memory budgets like the
 * single-file cap. They exist so an accidental pick (a home directory, a
 * node_modules tree) is refused in the picker instead of being handed to Core
 * to chew on. The byte ceiling matches qdn.ts's MAX_ZIP_TOTAL_BYTES, which is
 * the size the publish path would eventually have to zip anyway.
 */
export const HOME_V2_PUBLISH_DIRECTORY_MAX_BYTES = 512 * 1024 * 1024
export const HOME_V2_PUBLISH_DIRECTORY_MAX_ENTRIES = 20_000

export type HomeV2DesktopPublishSource = HomeV2PublishSourceDescriptor & (
  | Readonly<{
      device: bigint
      inode: bigint
      kind: 'file'
      path: string
    }>
  // PREVIEW_QDN_PUBLISH_SOURCE (kind: 'directory'): a folder staged as a
  // WEBSITE. Preview-only — readHomeV2DesktopPublishSource refuses it, so the
  // publish and chat-attachment paths cannot be handed one by accident.
  | Readonly<{
      device: bigint
      inode: bigint
      kind: 'directory'
      path: string
    }>
  // STAGE_QDN_PUBLISH_SOURCE (B1): bytes an app handed over (paste/drop),
  // held in main-process memory until published, released, or TTL-evicted.
  | Readonly<{
      bytes: Uint8Array
      kind: 'blob'
    }>
)

// File and folder sources cost no store memory (bytes stay on disk until
// publish); blob sources are budgeted so staged pastes can never grow Home's
// memory unboundedly — the oldest staged blobs are evicted once the budget is
// hit.
export const homeV2DesktopPublishSources = new HomeV2PublishSourceTokenStore<HomeV2DesktopPublishSource>(
  16,
  undefined,
  undefined,
  { maximumBytes: 96 * 1024 * 1024, sizeOf: (source) => (source.kind === 'blob' ? source.size : 0) },
)

/**
 * The `kind` an app asked SELECT_QDN_PUBLISH_SOURCE for.
 *
 * Home 1.x fell back to the default for any unrecognised value. This refuses
 * instead: an app asking for `kind: 'folder'` and silently being handed a file
 * picker is the kind of quiet mismatch that only shows up as a confused user.
 */
export function getRequestedHomeV2PublishSourceKind(
  requestValue: Record<string, unknown> | null | undefined,
  fallback: 'directory' | 'file' = 'file',
): 'directory' | 'file' {
  const raw = requestValue && typeof requestValue === 'object' ? (requestValue as Record<string, unknown>).kind : undefined
  if (raw === undefined || raw === null) return fallback
  if (typeof raw !== 'string') {
    throw new Error('QDN publish source kind must be "file" or "directory".')
  }
  const kind = raw.trim().toLowerCase()
  if (kind === '') return fallback
  if (kind === 'file' || kind === 'directory') return kind
  throw new Error('QDN publish source kind must be "file" or "directory".')
}

export function homeV2PublishSourceDialogProperties(
  kind: HomeV2PublishSourcePickKind,
): ('openDirectory' | 'openFile')[] {
  if (kind === 'directory') return ['openDirectory']
  if (kind === 'any') return ['openFile', 'openDirectory']
  return ['openFile']
}

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

export async function assertHomeV2PublishDirectoryIndexFile(directoryPath: string) {
  let entries: string[]
  try {
    entries = await readdir(directoryPath)
  } catch {
    throw new Error('Selected folder is no longer readable. Select the folder again.')
  }
  if (!entries.some((entry) => HOME_V2_PUBLISH_PREVIEW_INDEX_FILES.has(entry))) {
    throw new Error(
      'Website previews need an index file (for example index.html) in the top level of the folder.',
    )
  }
}

function isWithinDirectory(root: string, candidate: string) {
  return candidate === root || candidate.startsWith(root + nodePath.sep)
}

async function walkHomeV2PublishDirectory(
  root: string,
  current: string,
  state: { entries: number; totalBytes: number },
) {
  let entries
  try {
    entries = await readdir(current, { withFileTypes: true })
  } catch {
    throw new Error('Selected folder contains something Home cannot read. Fix the permissions and select it again.')
  }
  for (const entry of entries) {
    const entryPath = nodePath.join(current, entry.name)
    state.entries += 1
    if (state.entries > HOME_V2_PUBLISH_DIRECTORY_MAX_ENTRIES) {
      throw new Error(
        `Selected folder holds more than ${HOME_V2_PUBLISH_DIRECTORY_MAX_ENTRIES.toLocaleString()} entries. Choose a smaller folder.`,
      )
    }
    if (entry.isSymbolicLink()) {
      // The node reads the PATH Home hands it and will follow links, so a link
      // out of the folder would publish-preview a file the user never chose.
      // A link that stays inside is skipped rather than refused: its target is
      // already counted through its real path, and following it would also
      // risk a cycle.
      const target = await realpath(entryPath).catch(() => null)
      if (!target || !isWithinDirectory(root, target)) {
        throw new Error(
          'Selected folder contains a symbolic link pointing outside it. Remove the link and select the folder again.',
        )
      }
      continue
    }
    if (entry.isDirectory()) {
      await walkHomeV2PublishDirectory(root, entryPath, state)
      continue
    }
    if (!entry.isFile()) continue
    const stats = await lstat(entryPath).catch(() => null)
    if (!stats) continue
    state.totalBytes += stats.size
    if (state.totalBytes > HOME_V2_PUBLISH_DIRECTORY_MAX_BYTES) {
      throw new Error(
        `Selected folder exceeds the ${HOME_V2_PUBLISH_DIRECTORY_MAX_BYTES.toLocaleString()} byte preview limit.`,
      )
    }
  }
}

/** Total on-disk bytes of a folder via stat only — never reads file contents. */
export async function measureHomeV2PublishDirectoryBytes(directoryPath: string) {
  const root = await realpath(directoryPath).catch(() => null)
  if (!root) throw new Error('Selected folder is no longer readable. Select the folder again.')
  const state = { entries: 0, totalBytes: 0 }
  await walkHomeV2PublishDirectory(root, root, state)
  return state.totalBytes
}

/**
 * Turn a picked path into the retained source descriptor.
 *
 * `kind` is what the caller asked for, and it is enforced here as well as in
 * the dialog: a picker filter is a convenience, not a guarantee.
 */
export async function describeHomeV2PublishSourcePath(
  selectedPath: string,
  kind: HomeV2PublishSourcePickKind = 'file',
): Promise<HomeV2DesktopPublishSource> {
  const stats = await lstat(selectedPath, { bigint: true })
  const fileName = nodePath.basename(selectedPath).slice(0, 180) || 'qdn-resource'

  if (stats.isDirectory() && !stats.isSymbolicLink()) {
    if (kind === 'file') {
      throw new Error('Publish source must be a regular file, not a directory or symbolic link.')
    }
    await assertHomeV2PublishDirectoryIndexFile(selectedPath)
    return Object.freeze({
      device: stats.dev,
      fileName,
      inode: stats.ino,
      kind: 'directory' as const,
      mimeType: null,
      path: selectedPath,
      size: await measureHomeV2PublishDirectoryBytes(selectedPath),
    })
  }

  if (kind === 'directory') {
    throw new Error('Publish source must be a folder, not a file or symbolic link.')
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('Publish source must be a regular file, not a directory or symbolic link.')
  }
  const size = Number(stats.size)
  if (!Number.isSafeInteger(size) || size < 1 || size > HOME_V2_PUBLISH_SOURCE_MAX_BYTES) {
    throw new Error('Publish source must be between 1 byte and 100 MiB.')
  }
  return Object.freeze({
    device: stats.dev,
    fileName,
    inode: stats.ino,
    kind: 'file' as const,
    mimeType: null,
    path: selectedPath,
    size,
  })
}

/**
 * Folder equivalent of the identity re-check readHomeV2DesktopPublishSource
 * runs on a file: a token lives for 30 minutes, so the folder the user picked
 * may not be the folder still sitting at that path.
 */
export async function assertHomeV2DesktopPublishDirectoryUnchanged(source: HomeV2DesktopPublishSource) {
  if (source.kind !== 'directory') {
    throw new Error('Only a folder selection can be re-checked as a folder.')
  }
  const stats = await lstat(source.path, { bigint: true }).catch(() => null)
  if (
    !stats ||
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.dev !== source.device ||
    stats.ino !== source.inode
  ) {
    throw new Error('Selected publish source changed after selection. Select the folder again.')
  }
}

export async function readHomeV2DesktopPublishSource(source: HomeV2DesktopPublishSource) {
  if (source.kind === 'blob') {
    // Copy on read: publish paths hash and post these bytes, and must never
    // share a buffer with whatever else still references the staged source.
    if (source.bytes.byteLength !== source.size) {
      throw new Error('Staged publish source changed after staging. Stage the bytes again.')
    }
    return Uint8Array.from(source.bytes)
  }

  // A folder selection exists ONLY for previewing, where the node reads the
  // path itself. The publish and chat-attachment paths read bytes, and there
  // are no bytes here — refusing by name keeps folder support from leaking
  // into publishing as a half-working zip-less publish.
  if (source.kind === 'directory') {
    throw new Error('A folder can only be previewed, not published. Select a file to publish.')
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
