// The publish-source model shared by Home 2's desktop picker, its publish
// pipeline, and PREVIEW_QDN_PUBLISH_SOURCE.
//
// This module is deliberately pure (no electron imports) so every rule that
// decides what a source IS — file, folder, or staged blob — is unit-testable
// the same way the token store and the blob normalizer are. Only the dialog
// itself lives in home-v2-desktop-publish-source.ts.
import { constants as fsConstants, createWriteStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, opendir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { pipeline } from 'node:stream/promises'

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
 * Errors this module raises are SAFE TO SHOW an app: every message below is a
 * fixed sentence with no filesystem path in it, and the tag is what lets the
 * bridge tell them apart from a raw `ENOENT: ... /home/<user>/...` it must
 * never forward. Anything untagged is logged in the main process and replaced
 * with a constant before it reaches the app.
 */
const HOME_V2_PUBLISH_SOURCE_ERROR = Symbol.for('qortium.home-v2.publish-source-error')

export function homeV2PublishSourceError(message: string) {
  return Object.assign(new Error(message), { [HOME_V2_PUBLISH_SOURCE_ERROR]: true })
}

export function isHomeV2PublishSourceError(error: unknown): error is Error {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as Record<PropertyKey, unknown>)[HOME_V2_PUBLISH_SOURCE_ERROR] === true
  )
}

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
 * The byte ceiling matches qdn.ts's MAX_ZIP_TOTAL_BYTES, which is the size the
 * publish path would eventually have to zip anyway. The entry ceiling bounds
 * WORK, so both the walk and the copy stream directory entries with `opendir`
 * and stop at the limit — `readdir` would materialise a million-entry folder
 * before anything got to reject it.
 */
export const HOME_V2_PUBLISH_DIRECTORY_MAX_BYTES = 512 * 1024 * 1024
export const HOME_V2_PUBLISH_DIRECTORY_MAX_ENTRIES = 20_000

export type HomeV2PublishDirectoryLimits = Readonly<{
  maximumBytes: number
  maximumEntries: number
}>

// Injectable so the early-stop property can be proven against a limit of 5
// instead of by building a folder with twenty thousand files in it.
export const HOME_V2_PUBLISH_DIRECTORY_LIMITS: HomeV2PublishDirectoryLimits = Object.freeze({
  maximumBytes: HOME_V2_PUBLISH_DIRECTORY_MAX_BYTES,
  maximumEntries: HOME_V2_PUBLISH_DIRECTORY_MAX_ENTRIES,
})

function entryLimitError(limits: HomeV2PublishDirectoryLimits) {
  return homeV2PublishSourceError(
    `Selected folder holds more than ${limits.maximumEntries.toLocaleString()} entries. Choose a smaller folder.`,
  )
}

function byteLimitError(limits: HomeV2PublishDirectoryLimits) {
  return homeV2PublishSourceError(
    `Selected folder exceeds the ${limits.maximumBytes.toLocaleString()} byte preview limit.`,
  )
}

const UNREADABLE_FOLDER = 'Selected folder is no longer readable. Select the folder again.'
const UNREADABLE_ENTRY =
  'Selected folder contains something Home cannot read. Fix the permissions and select it again.'
const ESCAPING_LINK =
  'Selected folder contains a symbolic link pointing outside it. Remove the link and select the folder again.'
const SPECIAL_ENTRY =
  'Selected folder contains a device, pipe, or socket entry, which cannot be previewed. Remove it and select the folder again.'
const CHANGED_FOLDER = 'Selected publish source changed after selection. Select the folder again.'
const CHANGED_FILE = 'Selected publish source changed after selection. Select the file again.'
const UNREADABLE_FILE = 'Selected publish source is no longer safely readable. Select the file again.'
const MISSING_INDEX =
  'Website previews need an index file (for example index.html) in the top level of the folder.'

export type HomeV2DesktopPublishSource = HomeV2PublishSourceDescriptor & (
  | Readonly<{
      device: bigint
      inode: bigint
      kind: 'file'
      modifiedAtMs: bigint
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
    throw homeV2PublishSourceError('QDN publish source kind must be "file" or "directory".')
  }
  const kind = raw.trim().toLowerCase()
  if (kind === '') return fallback
  if (kind === 'file' || kind === 'directory') return kind
  throw homeV2PublishSourceError('QDN publish source kind must be "file" or "directory".')
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

/**
 * Scan a folder's top level for Core's entry file, streaming entries so a
 * pathological folder is refused rather than enumerated. Running out of the
 * entry budget before finding one IS the entry-limit refusal: past that point
 * the walk would refuse the folder anyway.
 */
export async function assertHomeV2PublishDirectoryIndexFile(
  directoryPath: string,
  limits: HomeV2PublishDirectoryLimits = HOME_V2_PUBLISH_DIRECTORY_LIMITS,
) {
  let scanned = 0
  let directory
  try {
    directory = await opendir(directoryPath)
  } catch {
    throw homeV2PublishSourceError(UNREADABLE_FOLDER)
  }
  for await (const entry of directory) {
    if (HOME_V2_PUBLISH_PREVIEW_INDEX_FILES.has(entry.name)) return
    scanned += 1
    if (scanned > limits.maximumEntries) throw entryLimitError(limits)
  }
  throw homeV2PublishSourceError(MISSING_INDEX)
}

function isWithinDirectory(root: string, candidate: string) {
  return candidate === root || candidate.startsWith(root + nodePath.sep)
}

/**
 * Resolve a symbolic link found inside a folder.
 *
 * Refuses anything resolving outside the folder: Home hands Core a PATH and
 * Core follows links, so an escaping link would preview a file the user never
 * chose. Returns the contained target, or null when it resolves to something
 * that is neither a regular file nor a directory (skipped rather than copied).
 */
async function resolveContainedLink(root: string, entryPath: string) {
  const target = await realpath(entryPath).catch(() => null)
  if (!target || !isWithinDirectory(root, target)) {
    throw homeV2PublishSourceError(ESCAPING_LINK)
  }
  const stats = await lstat(target).catch(() => null)
  return stats?.isFile() ? target : null
}

type WalkState = { entries: number; totalBytes: number }

function countEntry(state: WalkState, limits: HomeV2PublishDirectoryLimits) {
  state.entries += 1
  if (state.entries > limits.maximumEntries) throw entryLimitError(limits)
}

async function openDirectoryStream(directoryPath: string, unreadableMessage: string) {
  try {
    return await opendir(directoryPath)
  } catch {
    throw homeV2PublishSourceError(unreadableMessage)
  }
}

async function walkHomeV2PublishDirectory(
  root: string,
  current: string,
  state: WalkState,
  limits: HomeV2PublishDirectoryLimits,
) {
  const directory = await openDirectoryStream(current, UNREADABLE_ENTRY)
  for await (const entry of directory) {
    const entryPath = nodePath.join(current, entry.name)
    countEntry(state, limits)
    if (entry.isSymbolicLink()) {
      // A contained link is not counted again: its target is already measured
      // through its real path, and following it would also risk a cycle.
      await resolveContainedLink(root, entryPath)
      continue
    }
    if (entry.isDirectory()) {
      await walkHomeV2PublishDirectory(root, entryPath, state, limits)
      continue
    }
    if (!entry.isFile()) continue
    const stats = await lstat(entryPath).catch(() => null)
    if (!stats) continue
    state.totalBytes += stats.size
    if (state.totalBytes > limits.maximumBytes) throw byteLimitError(limits)
  }
}

/** Total on-disk bytes of a folder via stat only — never reads file contents. */
export async function measureHomeV2PublishDirectoryBytes(
  directoryPath: string,
  limits: HomeV2PublishDirectoryLimits = HOME_V2_PUBLISH_DIRECTORY_LIMITS,
) {
  const root = await realpath(directoryPath).catch(() => null)
  if (!root) throw homeV2PublishSourceError(UNREADABLE_FOLDER)
  const state: WalkState = { entries: 0, totalBytes: 0 }
  await walkHomeV2PublishDirectory(root, root, state, limits)
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
  limits: HomeV2PublishDirectoryLimits = HOME_V2_PUBLISH_DIRECTORY_LIMITS,
): Promise<HomeV2DesktopPublishSource> {
  const stats = await lstat(selectedPath, { bigint: true })
  const fileName = nodePath.basename(selectedPath).slice(0, 180) || 'qdn-resource'

  if (stats.isDirectory() && !stats.isSymbolicLink()) {
    if (kind === 'file') {
      throw homeV2PublishSourceError('Publish source must be a regular file, not a directory or symbolic link.')
    }
    await assertHomeV2PublishDirectoryIndexFile(selectedPath, limits)
    return Object.freeze({
      device: stats.dev,
      fileName,
      inode: stats.ino,
      kind: 'directory' as const,
      mimeType: null,
      path: selectedPath,
      size: await measureHomeV2PublishDirectoryBytes(selectedPath, limits),
    })
  }

  if (kind === 'directory') {
    throw homeV2PublishSourceError('Publish source must be a folder, not a file or symbolic link.')
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw homeV2PublishSourceError('Publish source must be a regular file, not a directory or symbolic link.')
  }
  const size = Number(stats.size)
  if (!Number.isSafeInteger(size) || size < 1 || size > HOME_V2_PUBLISH_SOURCE_MAX_BYTES) {
    throw homeV2PublishSourceError('Publish source must be between 1 byte and 100 MiB.')
  }
  return Object.freeze({
    device: stats.dev,
    fileName,
    inode: stats.ino,
    kind: 'file' as const,
    mimeType: null,
    modifiedAtMs: stats.mtimeMs,
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
    throw homeV2PublishSourceError('Only a folder selection can be re-checked as a folder.')
  }
  const stats = await lstat(source.path, { bigint: true }).catch(() => null)
  if (
    !stats ||
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.dev !== source.device ||
    stats.ino !== source.inode
  ) {
    throw homeV2PublishSourceError(CHANGED_FOLDER)
  }
}

/**
 * File identity re-check for the PREVIEW path, which is stricter than the
 * publish path's: mtime is compared too, so a same-size in-place rewrite
 * between selection and preview is caught rather than rendered.
 */
export async function assertHomeV2DesktopPublishFileUnchanged(source: HomeV2DesktopPublishSource) {
  if (source.kind !== 'file') {
    throw homeV2PublishSourceError('Only a file selection can be re-checked as a file.')
  }
  const stats = await lstat(source.path, { bigint: true }).catch(() => null)
  if (
    !stats ||
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.dev !== source.device ||
    stats.ino !== source.inode ||
    Number(stats.size) !== source.size ||
    stats.mtimeMs !== source.modifiedAtMs
  ) {
    throw homeV2PublishSourceError(CHANGED_FILE)
  }
}

// -----------------------------------------------------------------------------
// Preview staging.
//
// Validating a folder and then handing Core the USER'S path is a check/use
// gap: between the walk and the render, an escaping symlink can appear, a file
// can grow past the cap, or the whole path can be swapped. So nothing the user
// owns is ever handed to Core. Home copies the validated tree into a directory
// it owns, re-enforcing every rule DURING the copy, and Core is handed that.
//
// The prefix is shared with qdn.ts's 1.x preview staging on purpose: its
// startup sweep collects orphans by that prefix, so anything this path leaks
// after a crash is collected by machinery that already exists.
// -----------------------------------------------------------------------------
export const HOME_V2_PUBLISH_PREVIEW_STAGING_PREFIX = 'qortium-home-preview-'

export async function createHomeV2PublishPreviewStagingDir() {
  const stagingDir = await mkdtemp(nodePath.join(tmpdir(), HOME_V2_PUBLISH_PREVIEW_STAGING_PREFIX))
  // mkdtemp is already 0700 on POSIX; stated explicitly because the staged copy
  // is the user's unpublished content sitting in a world-listable /tmp.
  await mkdir(stagingDir, { mode: 0o700, recursive: true })
  return stagingDir
}

export async function removeHomeV2PublishPreviewStagingDir(stagingDir: string) {
  await rm(stagingDir, { force: true, recursive: true }).catch(() => undefined)
}

/**
 * The temp directory a preview path belongs to, or null.
 *
 * qdn.ts's stager makes a SECOND staging directory of its own when it extracts
 * a .zip or wraps a bare .html, and in Home 2 nothing sweeps those (main.ts
 * wires the 1.x cleanup; home-v2-main.ts does not). Recognising them by prefix
 * lets the preview path clean up after both.
 */
export function homeV2PublishPreviewTempAncestor(previewPath: string) {
  const base = tmpdir()
  const relative = nodePath.relative(base, previewPath)
  if (!relative || relative.startsWith('..') || nodePath.isAbsolute(relative)) return null
  const [first] = relative.split(nodePath.sep)
  if (!first || !first.startsWith(HOME_V2_PUBLISH_PREVIEW_STAGING_PREFIX)) return null
  return nodePath.join(base, first)
}

function stagedFileName(fileName: string) {
  if (!fileName || fileName === '.' || fileName === '..' || /[\\/]/.test(fileName)) return 'qdn-resource'
  return fileName
}

async function copyRegularFileForPreview(
  sourcePath: string,
  destinationPath: string,
  state: WalkState,
  limits: HomeV2PublishDirectoryLimits,
) {
  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
  let handle
  try {
    handle = await open(sourcePath, fsConstants.O_RDONLY | noFollow)
  } catch {
    throw homeV2PublishSourceError(UNREADABLE_ENTRY)
  }
  try {
    // Stat the OPEN handle, not the path: this is the byte count that will
    // actually be copied, so the cap is enforced against reality rather than
    // against a name that may have been swapped since the walk.
    const stats = await handle.stat()
    if (!stats.isFile()) throw homeV2PublishSourceError(UNREADABLE_ENTRY)
    state.totalBytes += stats.size
    if (state.totalBytes > limits.maximumBytes) throw byteLimitError(limits)
    await pipeline(
      handle.createReadStream({ autoClose: false }),
      createWriteStream(destinationPath, { mode: 0o600 }),
    )
  } finally {
    await handle.close().catch(() => undefined)
  }
}

async function copyHomeV2PublishDirectoryForPreview(
  root: string,
  current: string,
  destination: string,
  state: WalkState,
  limits: HomeV2PublishDirectoryLimits,
) {
  await mkdir(destination, { mode: 0o700, recursive: true })
  const directory = await openDirectoryStream(current, UNREADABLE_ENTRY)
  for await (const entry of directory) {
    const entryPath = nodePath.join(current, entry.name)
    const destinationPath = nodePath.join(destination, entry.name)
    countEntry(state, limits)
    if (entry.isSymbolicLink()) {
      // Contained links are materialised as ordinary files so the staged tree
      // holds no links at all — a link is what Core would follow. One that
      // resolves to a directory is skipped rather than expanded, because a
      // cycle is easier to create than to detect.
      const target = await resolveContainedLink(root, entryPath)
      if (target) await copyRegularFileForPreview(target, destinationPath, state, limits)
      continue
    }
    if (entry.isDirectory()) {
      await copyHomeV2PublishDirectoryForPreview(root, entryPath, destinationPath, state, limits)
      continue
    }
    if (entry.isFile()) {
      await copyRegularFileForPreview(entryPath, destinationPath, state, limits)
      continue
    }
    // Block/character devices, FIFOs and sockets: refused rather than skipped.
    // Copying one would block or read a device, and silently dropping it would
    // preview something other than what the user is looking at.
    throw homeV2PublishSourceError(SPECIAL_ENTRY)
  }
}

/**
 * Copy a validated selection into a Home-owned staging directory and return
 * the path Core may be handed. The caller ALWAYS removes `stagingDir`.
 */
export async function stageHomeV2PublishSourceForPreview(
  source: HomeV2DesktopPublishSource,
  limits: HomeV2PublishDirectoryLimits = HOME_V2_PUBLISH_DIRECTORY_LIMITS,
): Promise<{ previewPath: string; stagingDir: string }> {
  if (source.kind === 'blob') {
    throw homeV2PublishSourceError(
      'Previewing needs a file or folder selected through the picker; staged bytes cannot be previewed.',
    )
  }

  if (source.kind === 'file') {
    await assertHomeV2DesktopPublishFileUnchanged(source)
    const stagingDir = await createHomeV2PublishPreviewStagingDir()
    try {
      // The staged NAME carries the extension, which is what the stager reads
      // to choose the service (WEBSITE for .zip/.html, IMAGE/VIDEO/AUDIO
      // otherwise), so it must survive the copy.
      const previewPath = nodePath.join(stagingDir, stagedFileName(source.fileName))
      const state: WalkState = { entries: 0, totalBytes: 0 }
      await copyRegularFileForPreview(source.path, previewPath, state, {
        maximumBytes: HOME_V2_PUBLISH_SOURCE_MAX_BYTES,
        maximumEntries: limits.maximumEntries,
      })
      return { previewPath, stagingDir }
    } catch (error) {
      await removeHomeV2PublishPreviewStagingDir(stagingDir)
      throw error
    }
  }

  await assertHomeV2DesktopPublishDirectoryUnchanged(source)
  const root = await realpath(source.path).catch(() => null)
  if (!root) throw homeV2PublishSourceError(UNREADABLE_FOLDER)
  const stagingDir = await createHomeV2PublishPreviewStagingDir()
  try {
    const previewPath = nodePath.join(stagingDir, 'site')
    const state: WalkState = { entries: 0, totalBytes: 0 }
    await copyHomeV2PublishDirectoryForPreview(root, root, previewPath, state, limits)
    // Asserted on the COPY, not the original: this is the tree Core will
    // render, and it is the only one that can no longer change underneath.
    await assertHomeV2PublishDirectoryIndexFile(previewPath, limits)
    return { previewPath, stagingDir }
  } catch (error) {
    await removeHomeV2PublishPreviewStagingDir(stagingDir)
    throw error
  }
}

export async function readHomeV2DesktopPublishSource(source: HomeV2DesktopPublishSource) {
  if (source.kind === 'blob') {
    // Copy on read: publish paths hash and post these bytes, and must never
    // share a buffer with whatever else still references the staged source.
    if (source.bytes.byteLength !== source.size) {
      throw homeV2PublishSourceError('Staged publish source changed after staging. Stage the bytes again.')
    }
    return Uint8Array.from(source.bytes)
  }

  // A folder selection exists ONLY for previewing, where Home stages a copy and
  // the node reads that. The publish and chat-attachment paths read bytes, and
  // there are no bytes here — refusing by name keeps folder support from
  // leaking into publishing as a half-working zip-less publish.
  if (source.kind === 'directory') {
    throw homeV2PublishSourceError('A folder can only be previewed, not published. Select a file to publish.')
  }

  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
  let handle
  try {
    handle = await open(source.path, fsConstants.O_RDONLY | noFollow)
  } catch {
    throw homeV2PublishSourceError(UNREADABLE_FILE)
  }
  try {
    const stats = await handle.stat({ bigint: true })
    if (
      !stats.isFile() ||
      stats.dev !== source.device ||
      stats.ino !== source.inode ||
      Number(stats.size) !== source.size
    ) {
      throw homeV2PublishSourceError(CHANGED_FILE)
    }
    const bytes = new Uint8Array(await handle.readFile())
    if (bytes.byteLength !== source.size) {
      throw homeV2PublishSourceError('Selected publish source changed while it was being read.')
    }
    return bytes
  } finally {
    await handle.close()
  }
}
