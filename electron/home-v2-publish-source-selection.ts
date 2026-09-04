// The publish-source model shared by Home 2's desktop picker, its publish
// pipeline, and PREVIEW_QDN_PUBLISH_SOURCE.
//
// This module is deliberately pure (no electron imports) so every rule that
// decides what a source IS — file, folder, or staged blob — is unit-testable
// the same way the token store and the blob normalizer are. Only the dialog
// itself lives in home-v2-desktop-publish-source.ts.
import { constants as fsConstants, createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, opendir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { pipeline } from 'node:stream/promises'

import {
  HomeV2PublishZipLimitError,
  HomeV2PublishZipWriter,
  sha256HexOfStream,
} from './home-v2-publish-zip.js'
import { isPathWithinPath } from './path-containment.js'

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

/**
 * How deep a folder walk may recurse, for EVERY path that walks one.
 *
 * Declared here, with the other folder ceilings, because selection, preview
 * and packaging must agree on it: a folder accepted by SELECT and rendered by
 * PREVIEW that the publish packager then refuses is a refusal arriving after
 * the user approved, and one the app cannot have anticipated. The packaging
 * limits re-export it as HOME_V2_PUBLISH_ZIP_MAX_DEPTH rather than restating
 * the number.
 */
export const HOME_V2_PUBLISH_DIRECTORY_MAX_DEPTH = 32

/** Maximum source Home will materialise for the public keyless route. */
export const HOME_V2_PUBLISH_IN_MEMORY_MAX_BYTES = 256 * 1024 * 1024

/**
 * The aggregate in-memory budget one PUBLISH_MULTIPLE_QDN_RESOURCES batch may
 * claim, enforced BEFORE anything is read. Without it, `maximumEntries`
 * selections of `HOME_V2_PUBLISH_IN_MEMORY_MAX_BYTES` each could be resolved
 * and read into memory together, because the batch hashes every item before
 * the single approval prompt.
 */
export const HOME_V2_PUBLISH_BATCH_MAX_TOTAL_BYTES = 512 * 1024 * 1024

export type HomeV2PublishDirectoryLimits = Readonly<{
  maximumBytes: number
  // Bounds how deep the walk recurses. Optional so the preview path keeps the
  // behaviour it shipped with; the publish packager always sets it, because a
  // deep tree is both a stack risk and a path-length one.
  maximumDepth?: number
  maximumEntries: number
}>

/**
 * The folder ceilings plus the FILE ceiling, which is not a constant: a
 * Qortium publish is measured against what the connected node advertises
 * (GET /arbitrary/limits), clamped by Home. Omitted, it falls back to the
 * 100 MiB Home has always enforced, so every caller that does not discover a
 * ceiling behaves exactly as before.
 */
export type HomeV2PublishSourceLimits = HomeV2PublishDirectoryLimits &
  Readonly<{ maximumFileBytes?: number }>

/**
 * The byte ceiling a FOLDER selection is measured against.
 *
 * The folder ceiling is Home's own (512 MiB, the size the publish path would
 * have to zip anyway), but a node that advertises less than that will refuse
 * the publish, and the file branch already fails fast against exactly that
 * number. A folder that cannot be published is refused at the picker for the
 * same reason: measuring, staging, packaging and prompting first, only to be
 * refused by the node afterwards, wastes the user's time and the disk.
 *
 * Undiscovered (Qortal, or a node too old to answer) leaves the fixed ceiling
 * alone, so nothing that worked before this becomes a refusal.
 */
export function homeV2PublishDirectoryByteCeiling(limits: HomeV2PublishSourceLimits) {
  return limits.maximumFileBytes === undefined
    ? limits.maximumBytes
    : Math.min(limits.maximumBytes, limits.maximumFileBytes)
}

// Injectable so the early-stop property can be proven against a limit of 5
// instead of by building a folder with twenty thousand files in it.
export const HOME_V2_PUBLISH_DIRECTORY_LIMITS: HomeV2PublishDirectoryLimits = Object.freeze({
  maximumBytes: HOME_V2_PUBLISH_DIRECTORY_MAX_BYTES,
  // The same ceiling the publish packager enforces. Selection and preview used
  // to leave it undefined, so a tree deeper than the packager allows was picked
  // and previewed happily and only refused at the publish itself.
  maximumDepth: HOME_V2_PUBLISH_DIRECTORY_MAX_DEPTH,
  maximumEntries: HOME_V2_PUBLISH_DIRECTORY_MAX_ENTRIES,
})

function entryLimitError(limits: HomeV2PublishDirectoryLimits) {
  return homeV2PublishSourceError(
    `Selected folder holds more than ${limits.maximumEntries.toLocaleString()} entries. Choose a smaller folder.`,
  )
}

function byteLimitError(limits: HomeV2PublishDirectoryLimits) {
  return homeV2PublishSourceError(
    `Selected folder exceeds the ${limits.maximumBytes.toLocaleString()} byte limit.`,
  )
}

function depthLimitError(limits: HomeV2PublishDirectoryLimits) {
  return homeV2PublishSourceError(
    `Selected folder nests more than ${(limits.maximumDepth ?? 0).toLocaleString()} levels deep. Choose a flatter folder.`,
  )
}

const UNREADABLE_FOLDER = 'Selected folder is no longer readable. Select the folder again.'
const UNREADABLE_ENTRY =
  'Selected folder contains something Home cannot read. Fix the permissions and select it again.'
const ESCAPING_LINK =
  'Selected folder contains a symbolic link pointing outside it. Remove the link and select the folder again.'
const LINKED_ENTRY =
  'This folder contains links, which cannot be published; publish a folder with regular files and folders only.'
const CHANGED_ENTRY = 'Selected folder changed while Home was reading it. Select the folder again.'
const SPECIAL_ENTRY =
  'Selected folder contains a device, pipe, or socket entry, which cannot be previewed. Remove it and select the folder again.'
const CHANGED_FOLDER = 'Selected publish source changed after selection. Select the folder again.'
const CHANGED_FILE = 'Selected publish source changed after selection. Select the file again.'
const UNREADABLE_FILE = 'Selected publish source is no longer safely readable. Select the file again.'
const MISSING_INDEX =
  'Website previews need an index file (for example index.html) in the top level of the folder.'

export type HomeV2DesktopPublishSource = HomeV2PublishSourceDescriptor & (
  | Readonly<{
      changedAtMs: bigint
      device: bigint
      inode: bigint
      kind: 'file'
      modifiedAtMs: bigint
      path: string
    }>
  // A folder (SELECT_QDN_PUBLISH_SOURCE kind: 'directory'). Retained as a
  // DESCRIPTOR, never as bytes: previewing stages a copy of it and publishing
  // streams it into a temp zip, both materialising it fresh with the rules
  // re-enforced. readHomeV2DesktopPublishSource - the raw-bytes path a chat
  // attachment takes - refuses it by name.
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

/**
 * What an entry WAS when the walk classified it.
 *
 * Recorded from an `lstat` during the walk and compared against the `fstat` of
 * the handle that is eventually opened. O_NOFOLLOW protects only the FINAL
 * path component, so a directory anywhere above a file can be swapped between
 * the walk and the open and the open would still succeed - on a different
 * file. Comparing (device, inode, size) on the open handle is what turns that
 * into a refusal, because a swapped component necessarily yields a different
 * inode: reusing one takes an unlink and a create, and a created inode is a
 * new number.
 */
export type HomeV2PublishEntryIdentity = Readonly<{
  device: bigint
  inode: bigint
  size: number
}>

function identityOf(stats: { dev: bigint; ino: bigint; size: bigint }): HomeV2PublishEntryIdentity {
  return { device: stats.dev, inode: stats.ino, size: Number(stats.size) }
}

/**
 * Whether an fstat is still the entry a walk recorded. Exported because it is
 * the whole anti-TOCTOU rule in one line, and a rule that cannot be tested
 * directly is a rule that quietly stops holding.
 */
export function matchesHomeV2PublishEntryIdentity(
  stats: { dev: bigint; ino: bigint; size: bigint },
  identity: HomeV2PublishEntryIdentity,
) {
  return stats.dev === identity.device && stats.ino === identity.inode && Number(stats.size) === identity.size
}

/**
 * Open a DIRECTORY without following a link at its final component, confirm it
 * is one, and confirm it is the same directory the walk classified.
 *
 * Node cannot enumerate a directory from a file descriptor (there is no
 * `fdopendir` binding), so the caller's listing still goes through the path.
 * The window between this fstat and that `opendir` is an ACCEPTED residual -
 * see the note at the `opendir` call - narrowed but not closed by per-entry
 * identity, because a file under a swapped directory has a different inode.
 */
async function assertHomeV2PublishDirectoryIdentity(
  directoryPath: string,
  expected: HomeV2PublishEntryIdentity | null,
) {
  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
  const directoryOnly = typeof fsConstants.O_DIRECTORY === 'number' ? fsConstants.O_DIRECTORY : 0
  let handle
  try {
    handle = await open(directoryPath, fsConstants.O_RDONLY | directoryOnly | noFollow)
  } catch {
    throw homeV2PublishSourceError(expected ? CHANGED_ENTRY : UNREADABLE_ENTRY)
  }
  try {
    const stats = await handle.stat({ bigint: true })
    // O_DIRECTORY is absent on Windows, so the type check is made here as well
    // as asked for in the open flags.
    if (!stats.isDirectory()) throw homeV2PublishSourceError(CHANGED_ENTRY)
    if (expected && (stats.dev !== expected.device || stats.ino !== expected.inode)) {
      throw homeV2PublishSourceError(CHANGED_ENTRY)
    }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/**
 * Resolve a symbolic link found inside a folder.
 *
 * Refuses anything resolving outside the folder: Home hands Core a PATH and
 * Core follows links, so an escaping link would preview a file the user never
 * chose. Returns the contained target with its identity, or null when it
 * resolves to something that is not a regular file (skipped rather than
 * copied). PUBLISHING never gets here - it refuses links outright.
 */
async function resolveContainedLink(root: string, entryPath: string) {
  // `root` is already the realpath of the chosen folder and `target` the
  // realpath of the link, so this is containment on two resolved paths and
  // nothing else. The check itself is the one core-manager uses for the same
  // question - a shared path.relative() test, not a string prefix, which would
  // have called /home/user/site-backup a child of /home/user/site.
  const target = await realpath(entryPath).catch(() => null)
  if (!target || !isPathWithinPath(target, root)) {
    throw homeV2PublishSourceError(ESCAPING_LINK)
  }
  const stats = await lstat(target, { bigint: true }).catch(() => null)
  if (!stats || !stats.isFile()) return null
  return { identity: identityOf(stats), path: target }
}

type WalkState = { entries: number; excluded: number; totalBytes: number }

function newWalkState(): WalkState {
  return { entries: 0, excluded: 0, totalBytes: 0 }
}

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

/**
 * What ONE walk of a selected folder does with what it finds.
 *
 * There is exactly one walker in this module, and these are the three things
 * its three callers disagree about: measuring stats the files it finds and
 * tolerates a device node, staging copies them and refuses one, packaging
 * compresses them and refuses one. Every rule they AGREE on - the entry
 * budget, the containment check on symbolic links, the depth bound, refusing
 * to enumerate a folder it cannot read - lives in the walker, so a rule can
 * only be fixed in one place.
 */
type HomeV2PublishTreeVisitor = Readonly<{
  /** Called before descending. Relative paths are always '/'-separated. */
  onDirectory?: (absolutePath: string, relativePath: string) => Promise<void>
  /**
   * `identity` is what the walk saw for this entry. Every caller that opens
   * the file must compare it against the fstat of the handle it opened; the
   * walker cannot do that itself, because it does not do the opening.
   */
  onFile?: (
    absolutePath: string,
    relativePath: string,
    identity: HomeV2PublishEntryIdentity,
  ) => Promise<void>
  /**
   * What a symbolic link anywhere in the tree means.
   *
   * PUBLISHING says 'refuse', and that is the strongest of the three: a link
   * is the one entry whose meaning depends on a path resolved later, and
   * following one is also how a `config -> .env` link would smuggle an
   * excluded name past the hidden-file policy under an innocent name. A
   * published folder is regular files and folders, full stop.
   *
   * MEASURING says 'measure-contained': the link is checked for containment
   * and then ignored, because its target is already measured through its real
   * path. STAGING a preview says 'materialise-contained': the target is copied
   * in as an ordinary file, so the staged tree holds no links at all - a link
   * is what Core would follow.
   */
  symbolicLinks: 'materialise-contained' | 'measure-contained' | 'refuse'
  /**
   * Names this walk drops entirely - the hidden-file policy. Dropped entries
   * cost no entry budget and are counted in `state.excluded` so the approval
   * prompt can say how many there were.
   */
  skipEntry?: (name: string, isDirectory: boolean) => boolean
  /**
   * Block/character devices, FIFOs and sockets. 'refuse' for anything that
   * READS the tree (copying one would block or read a device, and silently
   * dropping it would ship something other than what the user is looking at);
   * 'skip' for the measuring pass, which only sums sizes.
   */
  specialEntry: 'refuse' | 'skip'
}>

async function walkHomeV2PublishTree(
  root: string,
  current: string,
  relative: string,
  depth: number,
  state: WalkState,
  limits: HomeV2PublishDirectoryLimits,
  visitor: HomeV2PublishTreeVisitor,
  currentIdentity: HomeV2PublishEntryIdentity | null,
) {
  if (limits.maximumDepth !== undefined && depth > limits.maximumDepth) throw depthLimitError(limits)
  // Immediately before listing it, and against the identity the caller (or the
  // parent iteration) recorded for it.
  await assertHomeV2PublishDirectoryIdentity(current, currentIdentity)
  // ACCEPTED RESIDUAL (decision recorded on PR #504): the verified directory
  // handle is closed above and the listing below re-resolves the same PATH, so
  // a swap landing in that interval is not detected here. Node exposes no
  // `fdopendir`, and the platform-specific way to close it - re-entering
  // through /proc/self/fd - is not something Home will carry. What bounds it:
  // the only actor who can win that race is a local process already running as
  // this user, and what such a process could smuggle in is still limited by
  // the checks that do not depend on the path - every file is re-identified by
  // (device, inode, size) on its own open handle before a byte is read, and
  // the total is bounded by the size the selection measured.
  const directory = await openDirectoryStream(current, UNREADABLE_ENTRY)
  for await (const entry of directory) {
    const entryPath = nodePath.join(current, entry.name)
    const relativePath = relative ? `${relative}/${entry.name}` : entry.name
    // BEFORE the excluded-name skip, so "any link refuses the folder" is
    // literally true. Skipping first would have made a link NAMED `.git` or
    // `.env` an exception to the rule, and an exception to this particular
    // rule is a name an attacker chooses.
    if (entry.isSymbolicLink() && visitor.symbolicLinks === 'refuse') {
      throw homeV2PublishSourceError(LINKED_ENTRY)
    }
    if (visitor.skipEntry?.(entry.name, entry.isDirectory())) {
      state.excluded += 1
      continue
    }
    countEntry(state, limits)
    if (entry.isSymbolicLink()) {
      // A contained link is resolved for its containment check either way.
      // One that resolves to a directory is skipped rather than expanded,
      // because a cycle is easier to create than to detect.
      const target = await resolveContainedLink(root, entryPath)
      if (target && visitor.symbolicLinks === 'materialise-contained') {
        await visitor.onFile?.(target.path, relativePath, target.identity)
      }
      continue
    }
    // The dirent's type came from the directory listing; lstat is the closer,
    // authoritative reading, and it is also where this entry's identity is
    // recorded for whoever opens it next.
    const stats = await lstat(entryPath, { bigint: true }).catch(() => null)
    if (!stats) {
      // An entry that vanished mid-walk. The measuring pass tolerates it (it
      // is summing sizes); anything that READS the tree refuses, because it
      // would otherwise ship a tree missing a file the user is looking at.
      if (visitor.specialEntry === 'skip') continue
      throw homeV2PublishSourceError(UNREADABLE_ENTRY)
    }
    if (stats.isSymbolicLink()) {
      // Became a link between the listing and the lstat.
      if (visitor.symbolicLinks === 'refuse') throw homeV2PublishSourceError(LINKED_ENTRY)
      throw homeV2PublishSourceError(CHANGED_ENTRY)
    }
    if (stats.isDirectory()) {
      await visitor.onDirectory?.(entryPath, relativePath)
      await walkHomeV2PublishTree(
        root,
        entryPath,
        relativePath,
        depth + 1,
        state,
        limits,
        visitor,
        identityOf(stats),
      )
      continue
    }
    if (stats.isFile()) {
      await visitor.onFile?.(entryPath, relativePath, identityOf(stats))
      continue
    }
    if (visitor.specialEntry === 'refuse') throw homeV2PublishSourceError(SPECIAL_ENTRY)
  }
}

/** Total on-disk bytes of a folder via stat only — never reads file contents. */
export async function measureHomeV2PublishDirectoryBytes(
  directoryPath: string,
  limits: HomeV2PublishDirectoryLimits = HOME_V2_PUBLISH_DIRECTORY_LIMITS,
) {
  const root = await realpath(directoryPath).catch(() => null)
  if (!root) throw homeV2PublishSourceError(UNREADABLE_FOLDER)
  const state = newWalkState()
  await walkHomeV2PublishTree(root, root, '', 0, state, limits, {
    onFile: async (_absolutePath, _relativePath, identity) => {
      state.totalBytes += identity.size
      if (state.totalBytes > limits.maximumBytes) throw byteLimitError(limits)
    },
    specialEntry: 'skip',
    symbolicLinks: 'measure-contained',
  }, null)
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
  limits: HomeV2PublishSourceLimits = HOME_V2_PUBLISH_DIRECTORY_LIMITS,
): Promise<HomeV2DesktopPublishSource> {
  const stats = await lstat(selectedPath, { bigint: true })
  const fileName = nodePath.basename(selectedPath).slice(0, 180) || 'qdn-resource'

  if (stats.isDirectory() && !stats.isSymbolicLink()) {
    if (kind === 'file') {
      throw homeV2PublishSourceError('Publish source must be a regular file, not a directory or symbolic link.')
    }
    // No entry-file assertion here. Whether a folder needs an index depends on
    // what it is going to BE, and SELECT_QDN_PUBLISH_SOURCE does not know that
    // yet: the same token can be redeemed by a WEBSITE publish (which needs
    // one), a VIDEO bundle of a media file with its poster and captions (which
    // does not), or a preview (which always does, because it renders). Each of
    // those asserts for itself, against the tree it is actually about to use.
    return Object.freeze({
      device: stats.dev,
      fileName,
      inode: stats.ino,
      kind: 'directory' as const,
      mimeType: null,
      path: selectedPath,
      size: await measureHomeV2PublishDirectoryBytes(selectedPath, {
        ...limits,
        maximumBytes: homeV2PublishDirectoryByteCeiling(limits),
      }),
    })
  }

  if (kind === 'directory') {
    throw homeV2PublishSourceError('Publish source must be a folder, not a file or symbolic link.')
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw homeV2PublishSourceError('Publish source must be a regular file, not a directory or symbolic link.')
  }
  const size = Number(stats.size)
  // The caller supplies the route-aware ceiling. Authenticated trusted-node
  // files are staged and attested as streams, so they are not constrained by
  // the public route's resident-memory boundary.
  const maximumFileBytes = limits.maximumFileBytes ?? HOME_V2_PUBLISH_SOURCE_MAX_BYTES
  if (!Number.isSafeInteger(maximumFileBytes) || maximumFileBytes < 1) {
    throw new Error('Publish source selection requires a positive safe byte limit.')
  }
  if (!Number.isSafeInteger(size) || size < 1 || size > maximumFileBytes) {
    throw homeV2PublishSourceError(
      `Publish source must be between 1 byte and ${maximumFileBytes.toLocaleString()} bytes for the selected node route.`,
    )
  }
  return Object.freeze({
    changedAtMs: stats.ctimeMs,
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
 *
 * A CHEAP check, and only that. Inode numbers are recycled, so a folder deleted
 * and recreated at the same path can land on the same (dev, ino) pair and pass
 * — CI demonstrated exactly that. Timestamps are deliberately NOT compared
 * either: a folder's mtime/ctime move whenever a top-level entry is added or
 * removed, so comparing them would refuse the ordinary case of the user saving
 * one more file into the folder they just picked, and would do it by shadowing
 * the checks that actually matter.
 *
 * The guarantee is downstream: the tree is COPIED into a Home-owned directory
 * with containment, entry kinds and both ceilings re-enforced during the copy,
 * and the entry-file assertion then runs against that copy. Whatever this
 * function misses, the copy still refuses.
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
 * publish path's: mtime and ctime are compared too, so an in-place rewrite
 * between selection and preview is caught rather than rendered.
 *
 * Why both timestamps. mtime alone is forgeable: `utimes` lets any process that
 * can write the file put the modification time back where it found it, leaving
 * a same-size rewrite indistinguishable. ctime is the metadata-change time; it
 * is set to "now" by every write AND by `utimes` itself, and userland cannot
 * set it to an older value, so restoring mtime advances ctime instead of hiding
 * the change.
 *
 * What this still cannot see: a same-size rewrite completed inside a single
 * timestamp tick on a filesystem with coarse granularity (HFS+ and some network
 * filesystems keep whole seconds) leaves mtime, ctime and size all identical,
 * and only a changed inode would give it away. That residual gap is why the
 * bytes are then COPIED from the O_NOFOLLOW handle this function's caller
 * opens: whatever the file is at copy time is what Core renders, so the worst
 * case is a stale-but-consistent preview rather than a path Core follows
 * somewhere else.
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
    stats.mtimeMs !== source.modifiedAtMs ||
    stats.ctimeMs !== source.changedAtMs
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
  identity: HomeV2PublishEntryIdentity,
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
    // Stat the OPEN handle, not the path, and require it to be the entry the
    // walk classified: O_NOFOLLOW guards only the final component, so a
    // directory swapped ABOVE this file would open a different file
    // successfully. A different file is a different inode.
    const stats = await handle.stat({ bigint: true })
    if (!stats.isFile()) throw homeV2PublishSourceError(UNREADABLE_ENTRY)
    if (!matchesHomeV2PublishEntryIdentity(stats, identity)) throw homeV2PublishSourceError(CHANGED_ENTRY)
    state.totalBytes += identity.size
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
  rootIdentity: HomeV2PublishEntryIdentity | null,
  destination: string,
  state: WalkState,
  limits: HomeV2PublishDirectoryLimits,
) {
  await mkdir(destination, { mode: 0o700, recursive: true })
  // Contained links are materialised as ordinary files so the staged tree
  // holds no links at all - a link is what Core would follow.
  await walkHomeV2PublishTree(root, root, '', 0, state, limits, {
    onDirectory: async (_absolutePath, relativePath) => {
      await mkdir(nodePath.join(destination, relativePath), { mode: 0o700, recursive: true })
    },
    onFile: async (absolutePath, relativePath, identity) => {
      await copyRegularFileForPreview(
        absolutePath,
        nodePath.join(destination, relativePath),
        identity,
        state,
        limits,
      )
    },
    specialEntry: 'refuse',
    symbolicLinks: 'materialise-contained',
  }, rootIdentity)
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
      const state = newWalkState()
      await copyRegularFileForPreview(
        source.path,
        previewPath,
        { device: source.device, inode: source.inode, size: source.size },
        state,
        { maximumBytes: HOME_V2_PUBLISH_SOURCE_MAX_BYTES, maximumEntries: limits.maximumEntries },
      )
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
    const state = newWalkState()
    await copyHomeV2PublishDirectoryForPreview(
      root,
      { device: source.device, inode: source.inode, size: 0 },
      previewPath,
      state,
      limits,
    )
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

  // A folder selection has no bytes: previewing stages a copy for the node to
  // read, and publishing PACKAGES it (prepareHomeV2PublishArtifact). This
  // function is the raw-bytes path, which now means the chat-attachment path
  // alone - an attachment is one encrypted file, so a folder is refused by
  // name rather than silently packaged into something a chat cannot show.
  if (source.kind === 'directory') {
    throw homeV2PublishSourceError('A folder cannot be sent as an attachment. Select a file.')
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

// -----------------------------------------------------------------------------
// Hidden-file policy.
//
// A folder publish is the one place in Home where a user points at a directory
// and every byte under it goes to a public chain. The names below are the ones
// that are almost never meant to travel: version-control stores (with their
// full history), environment files (with their secrets), editor and OS
// metadata. They are dropped ALWAYS, opt-in or not, and the approval prompt
// says how many were dropped so the drop is visible rather than silent.
//
// Every OTHER dotfile is a refusal, not a drop: Home cannot tell `.htaccess`
// (wanted) from `.bash_history` (catastrophic), so it refuses the publish and
// makes the app ask again with `includeHidden: true`. The prompt then shows
// the count, and the user is the one who decides.
// -----------------------------------------------------------------------------

const HOME_V2_PUBLISH_ALWAYS_EXCLUDED_NAMES: ReadonlySet<string> = new Set([
  '.aws',
  '.bzr',
  '.ds_store',
  '.git',
  '.gnupg',
  '.hg',
  '.idea',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.ssh',
  '.svn',
  '.vs',
  '.vscode',
  'thumbs.db',
])

/** Names dropped from a folder publish whatever the app asked for. */
export function isHomeV2PublishAlwaysExcludedName(name: string) {
  const lower = name.toLowerCase()
  if (HOME_V2_PUBLISH_ALWAYS_EXCLUDED_NAMES.has(lower)) return true
  // .env, .env.local, .env.production.local - the whole family.
  if (lower === '.env' || lower.startsWith('.env.')) return true
  // Editor leftovers: vim swap files and the ~ backups several editors write.
  if (/^\..*\.sw[a-p]$/.test(lower)) return true
  if (lower.endsWith('~')) return true
  return false
}

export function isHomeV2PublishHiddenName(name: string) {
  return name.startsWith('.')
}

const HIDDEN_WITHOUT_CONSENT =
  'Selected folder contains hidden files. Ask again with includeHidden to publish them, or remove them from the folder.'

export type HomeV2PublishHiddenCounts = { excluded: number; hidden: number }

/**
 * The walker's `skipEntry` for a publish: drops the always-excluded names,
 * counts the hidden ones, and refuses outright when hidden entries would be
 * published without the app having asked for them.
 */
export function homeV2PublishHiddenFilter(includeHidden: boolean, counts: HomeV2PublishHiddenCounts) {
  return (name: string) => {
    if (isHomeV2PublishAlwaysExcludedName(name)) {
      counts.excluded += 1
      return true
    }
    if (!isHomeV2PublishHiddenName(name)) return false
    if (!includeHidden) throw homeV2PublishSourceError(HIDDEN_WITHOUT_CONSENT)
    counts.hidden += 1
    return false
  }
}

/**
 * `includeHidden` as an app may send it on a publish request.
 *
 * Absent means false - the fail-closed direction - and anything that is not a
 * boolean is refused rather than coerced, because `includeHidden: 'false'`
 * coercing to true is precisely the mistake this flag must not make.
 */
export function getRequestedHomeV2PublishIncludeHidden(
  requestValue: Record<string, unknown> | null | undefined,
) {
  const raw = requestValue && typeof requestValue === 'object'
    ? (requestValue as Record<string, unknown>).includeHidden
    : undefined
  if (raw === undefined || raw === null) return false
  if (typeof raw !== 'boolean') {
    throw homeV2PublishSourceError('QDN publish includeHidden must be true or false.')
  }
  return raw
}

// -----------------------------------------------------------------------------
// Publish packaging.
//
// A folder is PUBLISHED as a zip (Core unpacks it when the upload carries
// ?isZip=true). Nothing about that archive is built in memory: the walk streams
// each file from an O_NOFOLLOW handle, through the crc/deflate pipeline, into a
// Home-owned temp file, with every ceiling enforced AS BYTES ARE READ. What the
// publish pipeline eventually loads is the finished archive, which is bounded
// by HOME_V2_PUBLISH_IN_MEMORY_MAX_BYTES rather than by whatever the node said
// it would accept.
//
// The identity re-checks are the same ones the preview path runs, for the same
// reason: a token lives 30 minutes and an approval prompt sits in the middle of
// that, so between the walk that measured the folder and the read that packages
// it, an entry can be swapped for a symlink or grown. Every file is therefore
// re-validated on the OPEN handle, and the byte budget is spent against what is
// actually read rather than against a stat taken earlier.
// -----------------------------------------------------------------------------

/**
 * Entry ceilings for a PUBLISH, which are tighter than the preview's.
 *
 * 10,000 is not a round number picked here: it is MAX_ZIP_ENTRIES in
 * qdn-content-attestation, the point at which attestation refuses an archive.
 * Enforcing it BEFORE zipping is the whole difference between "Home refuses a
 * folder" and "Home uploads a folder, then refuses to attest what it just
 * uploaded". MAX_ZIP_PATH_BYTES is matched for the same reason.
 */
export const HOME_V2_PUBLISH_ZIP_MAX_ENTRIES = 10_000
export const HOME_V2_PUBLISH_ZIP_MAX_PATH_BYTES = 1_024
// One source of truth with selection and preview - see
// HOME_V2_PUBLISH_DIRECTORY_MAX_DEPTH.
export const HOME_V2_PUBLISH_ZIP_MAX_DEPTH = HOME_V2_PUBLISH_DIRECTORY_MAX_DEPTH

export const HOME_V2_PUBLISH_PACKAGING_STAGING_PREFIX = 'qortium-home-publish-'

const UNSAFE_ENTRY_NAME =
  'Selected folder contains a name that cannot be published safely. Rename it and select the folder again.'
const COLLIDING_ENTRY_NAME =
  'Selected folder contains two entries that would unpack to the same name. Rename one and select the folder again.'
const EMPTY_FOLDER = 'Selected folder holds nothing that can be published.'
const MISSING_PUBLISH_INDEX =
  'This folder has no index file, which a website or app publish requires.'
const TOO_LARGE_FOR_MEMORY =
  'Selected publish source is larger than Home will hold in memory to publish it.'
const PACKAGED_TOO_LARGE = 'Selected folder is larger than this publish route accepts once packaged.'

export type HomeV2PublishPackagingLimits = HomeV2PublishDirectoryLimits &
  Readonly<{
    /** Ceiling on the FINISHED archive - the bytes Home will hold and upload. */
    maximumPackagedBytes: number
    maximumPathBytes: number
  }>

export function homeV2PublishPackagingLimits(
  maximumPackagedBytes: number,
  overrides: Partial<HomeV2PublishPackagingLimits> = {},
): HomeV2PublishPackagingLimits {
  return Object.freeze({
    maximumBytes: HOME_V2_PUBLISH_DIRECTORY_MAX_BYTES,
    maximumDepth: HOME_V2_PUBLISH_ZIP_MAX_DEPTH,
    maximumEntries: HOME_V2_PUBLISH_ZIP_MAX_ENTRIES,
    maximumPathBytes: HOME_V2_PUBLISH_ZIP_MAX_PATH_BYTES,
    ...overrides,
    maximumPackagedBytes: Math.min(
      maximumPackagedBytes,
      overrides.maximumPackagedBytes ?? maximumPackagedBytes,
      HOME_V2_PUBLISH_IN_MEMORY_MAX_BYTES,
    ),
  })
}

/**
 * The name an entry gets INSIDE the archive, or a refusal.
 *
 * Core protects itself against zip slip when it unpacks, and Home is not
 * relying on that: a name is checked here, before it is written, so an archive
 * Home produced can never be the thing that tests someone else's unpacker.
 * Refused rather than rewritten - a sanitiser silently renaming a file is how
 * two entries end up fighting over one name.
 */
export function canonicalHomeV2PublishEntryName(
  relativePath: string,
  limits: Pick<HomeV2PublishPackagingLimits, 'maximumPathBytes'>,
  seen: Set<string>,
) {
  if (!relativePath || relativePath.startsWith('/')) throw homeV2PublishSourceError(UNSAFE_ENTRY_NAME)
  if (new TextEncoder().encode(relativePath).byteLength > limits.maximumPathBytes) {
    throw homeV2PublishSourceError(UNSAFE_ENTRY_NAME)
  }
  for (const segment of relativePath.split('/')) {
    if (!segment || segment === '.' || segment === '..') throw homeV2PublishSourceError(UNSAFE_ENTRY_NAME)
    // The characters Core's ZipUtils sanitizer STRIPS from an entry name
    // (`sanitizeZipEntrySegment`: < > : " / \ | ? *), plus control
    // characters. Home refuses them instead of stripping them, because
    // stripping is how two entries end up fighting over one unpacked name -
    // and it would be Core doing the renaming, after the upload, to bytes the
    // user already approved a hash of.
    if (/[<>:"\\|?*\u0000-\u001f\u007f]/.test(segment)) throw homeV2PublishSourceError(UNSAFE_ENTRY_NAME)
    // Core also trims leading and trailing whitespace from every segment, so
    // "report .txt" and "report.txt " are the same file to it.
    if (segment !== segment.trim()) throw homeV2PublishSourceError(UNSAFE_ENTRY_NAME)
    if (/^[A-Za-z]:$/.test(segment)) throw homeV2PublishSourceError(UNSAFE_ENTRY_NAME)
  }
  // Case-folded and compatibility-normalised, which is what a collision means
  // in practice: the archive may be unpacked on a filesystem that folds case
  // or normalises unicode, and two entries landing on one name would publish
  // content the user never approved the hash of. NFKC rather than NFC because
  // Core's own comparison happens after its sanitizer has already collapsed
  // compatibility forms out of the segment.
  const key = relativePath.normalize('NFKC').toLocaleLowerCase('en')
  if (seen.has(key)) throw homeV2PublishSourceError(COLLIDING_ENTRY_NAME)
  seen.add(key)
  return relativePath
}

/**
 * Stream one entry's bytes, bounded as they are read.
 *
 * `expectedSize` comes from fstat on the handle that is being read, not from
 * the earlier walk, so a file that grew after selection is refused rather than
 * silently packaged at its new size.
 */
async function* boundedEntryChunks(
  handle: Awaited<ReturnType<typeof open>>,
  expectedSize: number,
  state: WalkState,
  limits: HomeV2PublishDirectoryLimits,
) {
  let read = 0
  for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
    const bytes = chunk as Buffer
    read += bytes.byteLength
    state.totalBytes += bytes.byteLength
    if (read > expectedSize) throw homeV2PublishSourceError(CHANGED_ENTRY)
    if (state.totalBytes > limits.maximumBytes) throw byteLimitError(limits)
    yield bytes
  }
  if (read !== expectedSize) throw homeV2PublishSourceError(CHANGED_ENTRY)
}

async function openContainedFile(sourcePath: string) {
  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
  try {
    return await open(sourcePath, fsConstants.O_RDONLY | noFollow)
  } catch {
    throw homeV2PublishSourceError(UNREADABLE_ENTRY)
  }
}

export async function createHomeV2PublishPackagingDir() {
  const stagingDir = await mkdtemp(nodePath.join(tmpdir(), HOME_V2_PUBLISH_PACKAGING_STAGING_PREFIX))
  await mkdir(stagingDir, { mode: 0o700, recursive: true })
  return stagingDir
}

export type HomeV2PublishPackagedDirectory = Readonly<{
  archivePath: string
  byteLength: number
  entryCount: number
  /** Entries dropped by the always-excluded list (VCS stores, .env, editor junk). */
  excludedCount: number
  /** Dotfiles the app explicitly opted into publishing. */
  hiddenCount: number
  stagingDir: string
}>

/**
 * Package a folder selection into a Home-owned temp zip.
 *
 * `requireIndexFile` is the SERVICE's rule, not the picker's: a folder
 * published as a site (the browser-archive services Home renders through an
 * HTML entry point, and the one Core validates an index for) must hold one at
 * the top level, and a folder published as a media or document bundle must not
 * be made to invent one. The caller decides, because only the publish request
 * names the service. Either way the archive must hold at least one file.
 *
 * The caller ALWAYS removes `stagingDir`.
 */
export async function packHomeV2PublishDirectory(
  source: HomeV2DesktopPublishSource,
  limits: HomeV2PublishPackagingLimits,
  options: Readonly<{ includeHidden?: boolean; requireIndexFile?: boolean }> = {},
): Promise<HomeV2PublishPackagedDirectory> {
  if (source.kind !== 'directory') {
    throw homeV2PublishSourceError('Only a folder selection can be packaged for publishing.')
  }
  await assertHomeV2DesktopPublishDirectoryUnchanged(source)
  const root = await realpath(source.path).catch(() => null)
  if (!root) throw homeV2PublishSourceError(UNREADABLE_FOLDER)
  // The raw budget is what the SELECTION measured, not just the route's
  // ceiling. A batch's aggregate check is made against selection-time sizes
  // before anything is opened, so a folder that grew afterwards would spend
  // bytes the batch never budgeted for; holding each folder to its own
  // measured size is what keeps that check honest. Excluded names only ever
  // make the packaged total smaller, never larger.
  const packLimits: HomeV2PublishPackagingLimits = Object.freeze({
    ...limits,
    maximumBytes: Math.min(limits.maximumBytes, source.size),
  })
  const stagingDir = await createHomeV2PublishPackagingDir()
  const archivePath = nodePath.join(stagingDir, 'source.zip')
  try {
    const archive = await open(archivePath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600)
    let byteLength = 0
    const state = newWalkState()
    const seen = new Set<string>()
    const counts: HomeV2PublishHiddenCounts = { excluded: 0, hidden: 0 }
    let hasIndexFile = false
    try {
      const writer = new HomeV2PublishZipWriter(archive, packLimits.maximumPackagedBytes)
      await walkHomeV2PublishTree(root, root, '', 0, state, packLimits, {
        skipEntry: homeV2PublishHiddenFilter(options.includeHidden === true, counts),
        onFile: async (absolutePath, relativePath, identity) => {
          const name = canonicalHomeV2PublishEntryName(relativePath, packLimits, seen)
          // Recorded from the name that actually goes INTO the archive, so an
          // index dropped by the hidden-file policy or refused for its name
          // cannot satisfy the requirement it is no longer part of.
          if (!name.includes('/') && HOME_V2_PUBLISH_PREVIEW_INDEX_FILES.has(name)) hasIndexFile = true
          const handle = await openContainedFile(absolutePath)
          try {
            // fstat on the OPEN handle, and it must be the entry the walk
            // classified: O_NOFOLLOW guards only the final component, so a
            // directory swapped ABOVE this file would open a different file
            // successfully, and a grown file would spend bytes the selection
            // never measured. Both show up as an identity mismatch.
            const stats = await handle.stat({ bigint: true })
            if (!stats.isFile()) throw homeV2PublishSourceError(UNREADABLE_ENTRY)
            if (!matchesHomeV2PublishEntryIdentity(stats, identity)) throw homeV2PublishSourceError(CHANGED_ENTRY)
            await writer.addFile(name, boundedEntryChunks(handle, identity.size, state, packLimits))
          } finally {
            await handle.close().catch(() => undefined)
          }
        },
        specialEntry: 'refuse',
        symbolicLinks: 'refuse',
      }, { device: source.device, inode: source.inode, size: 0 })
      if (writer.entryCount === 0) throw homeV2PublishSourceError(EMPTY_FOLDER)
      if (options.requireIndexFile === true && !hasIndexFile) {
        throw homeV2PublishSourceError(MISSING_PUBLISH_INDEX)
      }
      byteLength = await writer.finish()
    } finally {
      await archive.close().catch(() => undefined)
    }
    return Object.freeze({
      archivePath,
      byteLength,
      entryCount: state.entries,
      excludedCount: counts.excluded,
      hiddenCount: counts.hidden,
      stagingDir,
    })
  } catch (error) {
    await removeHomeV2PublishPreviewStagingDir(stagingDir)
    // The zip writer's ceiling refusal is the one error in this path that is
    // not already an app-safe tagged one, and an untagged error reaching the
    // bridge is replaced by a constant that says nothing useful.
    if (error instanceof HomeV2PublishZipLimitError) throw homeV2PublishSourceError(PACKAGED_TOO_LARGE)
    throw error
  }
}

/**
 * What a publish reads, without the publish paths knowing which kind of
 * selection produced it.
 *
 * `sha256()` streams; `read()` materialises. They are separate because the
 * batch path hashes EVERY item before one approval prompt and then publishes
 * them one at a time: hashing without materialising is what keeps a batch from
 * holding every item's bytes at once. `read()` re-hashes what it loaded and
 * refuses a mismatch, so what is published is what was approved even though
 * the two happen minutes apart.
 */
export type HomeV2PublishArtifact = Readonly<{
  byteLength: number
  entryCount: number
  excludedCount: number
  hiddenCount: number
  isZip: boolean
  dispose: () => Promise<void>
  read: () => Promise<Uint8Array>
  sha256: () => Promise<string>
}>

async function readAllBounded(
  openStream: () => AsyncIterable<Uint8Array> | NodeJS.ReadableStream,
  expectedBytes: number,
) {
  if (expectedBytes > HOME_V2_PUBLISH_IN_MEMORY_MAX_BYTES) {
    throw homeV2PublishSourceError(TOO_LARGE_FOR_MEMORY)
  }
  const bytes = new Uint8Array(expectedBytes)
  let offset = 0
  for await (const chunk of openStream() as AsyncIterable<Uint8Array>) {
    if (offset + chunk.byteLength > expectedBytes) throw homeV2PublishSourceError(CHANGED_ENTRY)
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (offset !== expectedBytes) throw homeV2PublishSourceError(CHANGED_ENTRY)
  return bytes
}

async function* singleChunk(bytes: Uint8Array) {
  yield bytes
}

export type HomeV2PublishArtifactOptions = Readonly<{
  /** The app's explicit opt-in to publishing dotfiles. Absent means no. */
  includeHidden?: boolean
  /** The ceiling this publish route discovered, already clamped by the caller. */
  maximumBytes: number
  packagingLimits?: HomeV2PublishPackagingLimits
  /**
   * Whether the target SERVICE renders the folder as a site and therefore
   * needs a top-level index file. Absent means no, which is the right default
   * for a media or document bundle.
   */
  requireIndexFile?: boolean
}>

/**
 * Prepare an artifact, REGISTERING it for disposal before it is returned.
 *
 * A batch prepares every item and then hashes it, and the hash can throw - a
 * source that moved between the walk and the read. If the artifact only joined
 * the caller's cleanup list after its hash succeeded, that throw would leak the
 * open handle or the temp archive it already owns. Handing the list in is what
 * makes "prepared" and "tracked" the same instant.
 */
export async function prepareTrackedHomeV2PublishArtifact(
  tracked: HomeV2PublishArtifact[],
  source: HomeV2DesktopPublishSource,
  options: HomeV2PublishArtifactOptions,
) {
  const artifact = await prepareHomeV2PublishArtifact(source, options)
  tracked.push(artifact)
  return artifact
}

export async function prepareHomeV2PublishArtifact(
  source: HomeV2DesktopPublishSource,
  options: HomeV2PublishArtifactOptions,
): Promise<HomeV2PublishArtifact> {
  const maximumBytes = Math.min(options.maximumBytes, HOME_V2_PUBLISH_IN_MEMORY_MAX_BYTES)

  if (source.kind === 'blob') {
    if (source.bytes.byteLength !== source.size) {
      throw homeV2PublishSourceError('Staged publish source changed after staging. Stage the bytes again.')
    }
    if (source.size > maximumBytes) throw homeV2PublishSourceError(TOO_LARGE_FOR_MEMORY)
    const bytes = source.bytes
    return Object.freeze({
      byteLength: source.size,
      dispose: async () => undefined,
      entryCount: 1,
      excludedCount: 0,
      hiddenCount: 0,
      isZip: false,
      // Copy on read: publish paths hash and post these bytes, and must never
      // share a buffer with whatever else still references the staged source.
      read: async () => Uint8Array.from(bytes),
      sha256: async () => sha256HexOfStream(singleChunk(bytes)),
    })
  }

  if (source.kind === 'directory') {
    const limits = options.packagingLimits ?? homeV2PublishPackagingLimits(maximumBytes)
    const packaged = await packHomeV2PublishDirectory(source, limits, {
      includeHidden: options.includeHidden === true,
      requireIndexFile: options.requireIndexFile === true,
    })
    let expectedHash: string | null = null
    const rememberHash = (hash: string) => {
      if (expectedHash !== null && hash !== expectedHash) throw homeV2PublishSourceError(CHANGED_ENTRY)
      expectedHash = hash
      return hash
    }
    const openArchive = () => createReadStream(packaged.archivePath)
    return Object.freeze({
      byteLength: packaged.byteLength,
      dispose: async () => removeHomeV2PublishPreviewStagingDir(packaged.stagingDir),
      entryCount: packaged.entryCount,
      excludedCount: packaged.excludedCount,
      hiddenCount: packaged.hiddenCount,
      isZip: true,
      read: async () => {
        const bytes = await readAllBounded(openArchive, packaged.byteLength)
        rememberHash(await sha256HexOfStream(singleChunk(bytes)))
        return bytes
      },
      sha256: async () => rememberHash(await sha256HexOfStream(openArchive())),
    })
  }

  if (source.size > maximumBytes) throw homeV2PublishSourceError(TOO_LARGE_FOR_MEMORY)
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
  } catch (error) {
    await handle.close().catch(() => undefined)
    throw error
  }
  // The handle stays OPEN for the artifact's whole life. That is the
  // anti-TOCTOU guarantee for a file source: the inode is pinned, so no rename
  // or symlink swap at that path can change what is read, and every read below
  // is a positional read from the same handle rather than a fresh open of a
  // name. What a pinned inode cannot stop is an in-place rewrite, which is why
  // read() re-hashes and refuses a value that moved since sha256().
  let expectedFileHash: string | null = null
  const rememberFileHash = (hash: string) => {
    if (expectedFileHash !== null && hash !== expectedFileHash) throw homeV2PublishSourceError(CHANGED_FILE)
    expectedFileHash = hash
    return hash
  }
  const openFileStream = () => handle.createReadStream({ autoClose: false, start: 0 })
  return Object.freeze({
    byteLength: source.size,
    dispose: async () => {
      await handle.close().catch(() => undefined)
    },
    entryCount: 1,
    excludedCount: 0,
    hiddenCount: 0,
    isZip: false,
    read: async () => {
      const bytes = await readAllBounded(openFileStream, source.size)
      rememberFileHash(await sha256HexOfStream(singleChunk(bytes)))
      return bytes
    },
    sha256: async () => rememberFileHash(await sha256HexOfStream(openFileStream())),
  })
}
