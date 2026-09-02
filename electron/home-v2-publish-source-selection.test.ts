import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { lstat, mkdtemp, mkdir, opendir, readFile, rename, rm, symlink, truncate, utimes, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'

import { unzipSync } from 'fflate'

import {
  HOME_V2_PUBLISH_BATCH_MAX_TOTAL_BYTES,
  HOME_V2_PUBLISH_DIRECTORY_MAX_BYTES,
  HOME_V2_PUBLISH_IN_MEMORY_MAX_BYTES,
  HOME_V2_PUBLISH_PACKAGING_STAGING_PREFIX,
  HOME_V2_PUBLISH_PREVIEW_STAGING_PREFIX,
  HOME_V2_PUBLISH_PREVIEW_INDEX_FILES,
  assertHomeV2DesktopPublishDirectoryUnchanged,
  assertHomeV2DesktopPublishFileUnchanged,
  assertHomeV2PublishDirectoryIndexFile,
  canonicalHomeV2PublishEntryName,
  describeHomeV2PublishSourcePath,
  getRequestedHomeV2PublishIncludeHidden,
  getRequestedHomeV2PublishSourceKind,
  homeV2PublishPackagingLimits,
  homeV2PublishPreviewTempAncestor,
  homeV2PublishSourceDialogProperties,
  isHomeV2PublishAlwaysExcludedName,
  isHomeV2PublishSourceError,
  matchesHomeV2PublishEntryIdentity,
  measureHomeV2PublishDirectoryBytes,
  packHomeV2PublishDirectory,
  prepareHomeV2PublishArtifact,
  prepareTrackedHomeV2PublishArtifact,
  readHomeV2DesktopPublishSource,
  removeHomeV2PublishPreviewStagingDir,
  stageHomeV2PublishSourceForPreview,
  type HomeV2DesktopPublishSource,
  type HomeV2PublishArtifact,
} from './home-v2-publish-source-selection.js'

const root = await mkdtemp(nodePath.join(tmpdir(), 'home-v2-publish-source-'))

// Every message this module raises reaches an APP, so it must be a fixed
// sentence with no filesystem path in it: the staged copy lives under the OS
// temp dir and the original under the user's home, and neither is the app's
// business. This collects each one as the tests trip it.
const reportedMessages: string[] = []

async function refusal(promise: Promise<unknown>, pattern: RegExp, label: string) {
  let raised: unknown
  await promise.then(
    () => { throw new Error(`Missing expected refusal: ${label}`) },
    (error: unknown) => { raised = error },
  )
  const message = String((raised as Error)?.message ?? '')
  assert.match(message, pattern, label)
  assert.ok(isHomeV2PublishSourceError(raised), `${label} must be tagged app-safe`)
  reportedMessages.push(message)
  return message
}

async function listStagingDirs(prefix: string) {
  const names: string[] = []
  const handle = await opendir(tmpdir())
  for await (const entry of handle) {
    if (entry.name.startsWith(prefix)) names.push(entry.name)
  }
  return names.sort()
}

async function listPreviewStagingDirs() {
  return listStagingDirs(HOME_V2_PUBLISH_PREVIEW_STAGING_PREFIX)
}

async function listPublishStagingDirs() {
  return listStagingDirs(HOME_V2_PUBLISH_PACKAGING_STAGING_PREFIX)
}

async function listStagedEntries(directory: string, prefix = ''): Promise<string[]> {
  const found: string[] = []
  const handle = await opendir(directory)
  for await (const entry of handle) {
    const entryPath = nodePath.join(directory, entry.name)
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    const stats = await lstat(entryPath)
    assert.equal(stats.isSymbolicLink(), false, `staged ${name} must not be a symbolic link`)
    if (entry.isDirectory()) {
      found.push(...await listStagedEntries(entryPath, name))
      continue
    }
    assert.equal(stats.isFile(), true, `staged ${name} must be a regular file`)
    found.push(name)
  }
  return found
}

try {
  // -------------------------------------------------------------------------
  // The `kind` an app asks SELECT_QDN_PUBLISH_SOURCE for. This is the parser
  // the bridge dispatch uses, and the reason the port lost folder previews:
  // it never existed, so every request silently became a file picker.
  // -------------------------------------------------------------------------
  assert.equal(getRequestedHomeV2PublishSourceKind({}), 'file')
  assert.equal(getRequestedHomeV2PublishSourceKind({ kind: undefined }), 'file')
  assert.equal(getRequestedHomeV2PublishSourceKind({ kind: null }), 'file')
  assert.equal(getRequestedHomeV2PublishSourceKind({ kind: '  ' }), 'file')
  assert.equal(getRequestedHomeV2PublishSourceKind(null), 'file')
  assert.equal(getRequestedHomeV2PublishSourceKind({ kind: 'file' }), 'file')
  assert.equal(getRequestedHomeV2PublishSourceKind({ kind: 'directory' }), 'directory')
  assert.equal(getRequestedHomeV2PublishSourceKind({ kind: ' DIRECTORY ' }), 'directory')
  // The fallback is a parameter, so a future caller that defaults to folders
  // does not have to reimplement the parsing.
  assert.equal(getRequestedHomeV2PublishSourceKind({}, 'directory'), 'directory')
  // Home 1.x fell back to the default for anything it did not recognise. That
  // hands an app asking for a folder a file picker and says nothing.
  for (const kind of ['folder', 'any', 'FILES', 42, true, {}, ['file']]) {
    assert.throws(
      () => getRequestedHomeV2PublishSourceKind({ kind }),
      /kind must be "file" or "directory"/,
      `kind ${JSON.stringify(kind)} must be refused, not silently defaulted`,
    )
  }

  // Dialog properties mirror Home 1.x's selectQdnPublishSource.
  assert.deepEqual(homeV2PublishSourceDialogProperties('file'), ['openFile'])
  assert.deepEqual(homeV2PublishSourceDialogProperties('directory'), ['openDirectory'])
  assert.deepEqual(homeV2PublishSourceDialogProperties('any'), ['openFile', 'openDirectory'])

  // -------------------------------------------------------------------------
  // File selection is unchanged: the publish paths must not shift because
  // preview gained a folder mode.
  // -------------------------------------------------------------------------
  const filePath = nodePath.join(root, 'page.html')
  await writeFile(filePath, '<!doctype html>hello')
  const fileSource = await describeHomeV2PublishSourcePath(filePath)
  assert.equal(fileSource.kind, 'file')
  assert.equal(fileSource.fileName, 'page.html')
  assert.equal(fileSource.size, 20)
  assert.equal(fileSource.mimeType, null)
  assert.deepEqual(
    Array.from(await readHomeV2DesktopPublishSource(fileSource)),
    Array.from(Buffer.from('<!doctype html>hello')),
  )

  const emptyPath = nodePath.join(root, 'empty.bin')
  await writeFile(emptyPath, '')
  await assert.rejects(
    describeHomeV2PublishSourcePath(emptyPath),
    /between 1 byte and [\d,. ]+ bytes/,
  )

  const hugePath = nodePath.join(root, 'huge.bin')
  await writeFile(hugePath, '')
  // Sparse: the size the cap reads, without the bytes on disk.
  await truncate(hugePath, 101 * 1024 * 1024)
  await assert.rejects(
    describeHomeV2PublishSourcePath(hugePath),
    /between 1 byte and [\d,. ]+ bytes/,
  )

  const fileLink = nodePath.join(root, 'page-link.html')
  await symlink(filePath, fileLink)
  await assert.rejects(
    describeHomeV2PublishSourcePath(fileLink),
    /regular file, not a directory or symbolic link/,
  )

  // -------------------------------------------------------------------------
  // Folder selection: only when it was ASKED for, and only when Core could
  // actually render it as a WEBSITE.
  // -------------------------------------------------------------------------
  const site = nodePath.join(root, 'site')
  await mkdir(nodePath.join(site, 'assets'), { recursive: true })
  await writeFile(nodePath.join(site, 'index.html'), 'abcde')
  await writeFile(nodePath.join(site, 'assets', 'app.js'), 'xyz')

  // A folder handed to a 'file' request keeps the original refusal verbatim:
  // the publish flows depend on it.
  await assert.rejects(
    describeHomeV2PublishSourcePath(site, 'file'),
    /regular file, not a directory or symbolic link/,
  )

  const directorySource = await describeHomeV2PublishSourcePath(site, 'directory')
  assert.equal(directorySource.kind, 'directory')
  assert.equal(directorySource.fileName, 'site')
  assert.equal(directorySource.mimeType, null)
  assert.equal(directorySource.size, 8, 'the folder total is a stat walk, not a read')
  assert.equal((await describeHomeV2PublishSourcePath(site, 'any')).kind, 'directory')
  assert.equal((await describeHomeV2PublishSourcePath(filePath, 'any')).kind, 'file')

  // A file handed to a 'directory' request is refused rather than quietly
  // accepted -- the dialog filter is a convenience, not a guarantee.
  await assert.rejects(
    describeHomeV2PublishSourcePath(filePath, 'directory'),
    /must be a folder, not a file or symbolic link/,
  )

  // The PICKER is service-agnostic: it cannot know whether the token will be
  // redeemed by a WEBSITE publish (index required), a VIDEO bundle (not), or a
  // preview (always, because it renders). So an index-less folder is SELECTED
  // fine, and each of those asserts for itself further down.
  const noIndex = nodePath.join(root, 'no-index')
  await mkdir(noIndex, { recursive: true })
  await writeFile(nodePath.join(noIndex, 'readme.txt'), 'nope')
  const noIndexSource = await describeHomeV2PublishSourcePath(noIndex, 'directory')
  assert.equal(noIndexSource.kind, 'directory')
  // Previewing it still refuses: a WEBSITE render with no entry point shows
  // the user nothing.
  await refusal(
    stageHomeV2PublishSourceForPreview(noIndexSource),
    /index file \(for example index\.html\)/,
    'a preview of an index-less folder is refused',
  )
  // The accepted entry-point names are Core's list, shared with the 1.x
  // preview stager rather than copied.
  for (const indexName of HOME_V2_PUBLISH_PREVIEW_INDEX_FILES) {
    const folder = nodePath.join(root, `entry-${indexName}`)
    await mkdir(folder, { recursive: true })
    await writeFile(nodePath.join(folder, indexName), 'x')
    await assertHomeV2PublishDirectoryIndexFile(folder)
    assert.equal((await describeHomeV2PublishSourcePath(folder, 'directory')).kind, 'directory')
  }

  // -------------------------------------------------------------------------
  // Symlinks inside a folder. The node follows the PATH Home hands it, so a
  // link out of the folder would preview a file the user never chose.
  // -------------------------------------------------------------------------
  const escaping = nodePath.join(root, 'escaping')
  await mkdir(escaping, { recursive: true })
  await writeFile(nodePath.join(escaping, 'index.html'), 'x')
  await symlink(filePath, nodePath.join(escaping, 'secret.html'))
  await assert.rejects(
    describeHomeV2PublishSourcePath(escaping, 'directory'),
    /symbolic link pointing outside it/,
  )

  // A nested escaping link is caught too -- the walk is recursive.
  const escapingNested = nodePath.join(root, 'escaping-nested')
  await mkdir(nodePath.join(escapingNested, 'deep'), { recursive: true })
  await writeFile(nodePath.join(escapingNested, 'index.html'), 'x')
  await symlink(root, nodePath.join(escapingNested, 'deep', 'up'))
  await assert.rejects(
    describeHomeV2PublishSourcePath(escapingNested, 'directory'),
    /symbolic link pointing outside it/,
  )

  // A link that stays inside is allowed and counted once, not twice: its
  // target is already measured through its real path.
  const internal = nodePath.join(root, 'internal-link')
  await mkdir(internal, { recursive: true })
  await writeFile(nodePath.join(internal, 'index.html'), 'abcde')
  await symlink(nodePath.join(internal, 'index.html'), nodePath.join(internal, 'home.html'))
  assert.equal((await describeHomeV2PublishSourcePath(internal, 'directory')).size, 5)

  // The folder ceiling is enforced on the stat total.
  const oversize = nodePath.join(root, 'oversize')
  await mkdir(oversize, { recursive: true })
  await writeFile(nodePath.join(oversize, 'index.html'), 'x')
  const bulky = nodePath.join(oversize, 'bulky.bin')
  await writeFile(bulky, '')
  await truncate(bulky, HOME_V2_PUBLISH_DIRECTORY_MAX_BYTES + 1)
  await assert.rejects(
    describeHomeV2PublishSourcePath(oversize, 'directory'),
    /exceeds the .* byte limit/,
  )
  await assert.rejects(
    measureHomeV2PublishDirectoryBytes(oversize),
    /exceeds the .* byte limit/,
  )

  // -------------------------------------------------------------------------
  // Publishing must be untouched by any of this. A folder source exists only
  // for previewing or for PACKAGING (prepareHomeV2PublishArtifact) -- the
  // raw-bytes path a chat attachment takes has none to read.
  // -------------------------------------------------------------------------
  await assert.rejects(
    readHomeV2DesktopPublishSource(directorySource),
    /folder cannot be sent as an attachment/,
  )

  const blobSource: HomeV2DesktopPublishSource = Object.freeze({
    bytes: Uint8Array.from([1, 2, 3]),
    fileName: 'pasted.bin',
    kind: 'blob' as const,
    mimeType: null,
    size: 3,
  })
  assert.deepEqual(Array.from(await readHomeV2DesktopPublishSource(blobSource)), [1, 2, 3])

  // -------------------------------------------------------------------------
  // Folder identity is re-checked before the node is handed the path: a source
  // token lives for 30 minutes.
  // -------------------------------------------------------------------------
  await assertHomeV2DesktopPublishDirectoryUnchanged(directorySource)
  await assert.rejects(
    assertHomeV2DesktopPublishDirectoryUnchanged(fileSource),
    /Only a folder selection can be re-checked as a folder/,
  )
  // DELIBERATELY a rename, not delete-and-recreate. CI caught the earlier
  // version of this test: `rm -rf` followed by `mkdir` at the same path let the
  // filesystem RECYCLE the inode, so the "replacement" folder had the same
  // (dev, ino) as the original and the check correctly saw no change. Two
  // folders that exist AT THE SAME MOMENT cannot share an inode number, so
  // renaming one over the other is a guaranteed identity change on every
  // filesystem, with no dependence on allocator behaviour or timestamps.
  const swapped = nodePath.join(root, 'swapped')
  const swappedReplacement = nodePath.join(root, 'swapped-replacement')
  await mkdir(swapped, { recursive: true })
  await mkdir(swappedReplacement, { recursive: true })
  await writeFile(nodePath.join(swapped, 'index.html'), 'x')
  await writeFile(nodePath.join(swappedReplacement, 'index.html'), 'x')
  const swappedSource = await describeHomeV2PublishSourcePath(swapped, 'directory')
  assert.notEqual(
    (await lstat(swappedReplacement, { bigint: true })).ino,
    swappedSource.kind === 'directory' ? swappedSource.inode : 0n,
    'the two folders must have distinct inodes for this to prove anything',
  )
  await rm(swapped, { force: true, recursive: true })
  await rename(swappedReplacement, swapped)
  await assert.rejects(
    assertHomeV2DesktopPublishDirectoryUnchanged(swappedSource),
    /changed after selection/,
  )
  // The unchanged folder still passes, so the check above is the SWAP talking
  // and not a check that refuses everything.
  await assertHomeV2DesktopPublishDirectoryUnchanged(directorySource)

  // ---------------------------------------------------------------------------
  // The entry ceiling must bound WORK, not just the answer. `readdir` would
  // materialise the whole folder before anything could reject it, so the walk
  // and the index scan stream entries and stop at the limit -- proven here with
  // a limit of 5 rather than by building a folder with twenty thousand files.
  // ---------------------------------------------------------------------------
  const crowded = nodePath.join(root, 'crowded')
  await mkdir(crowded, { recursive: true })
  await writeFile(nodePath.join(crowded, 'index.html'), 'x')
  for (let index = 0; index < 40; index += 1) {
    await writeFile(nodePath.join(crowded, `file-${index}.txt`), 'y')
  }
  const smallLimits = { maximumBytes: HOME_V2_PUBLISH_DIRECTORY_MAX_BYTES, maximumEntries: 5 }
  await refusal(
    measureHomeV2PublishDirectoryBytes(crowded, smallLimits),
    /holds more than 5 entries/,
    'the walk stops at the entry limit',
  )
  await refusal(
    describeHomeV2PublishSourcePath(crowded, 'directory', smallLimits),
    /holds more than 5 entries/,
    'selection stops at the entry limit',
  )
  // The same folder is fine once the limit is not the binding constraint, so
  // the refusal above is the LIMIT talking and not a broken walk.
  assert.equal(
    (await describeHomeV2PublishSourcePath(crowded, 'directory', {
      maximumBytes: HOME_V2_PUBLISH_DIRECTORY_MAX_BYTES,
      maximumEntries: 100,
    })).size,
    41,
  )
  // A folder whose entry file is beyond the budget is refused as over-budget
  // rather than scanned to the end looking for it.
  const crowdedNoIndex = nodePath.join(root, 'crowded-no-index')
  await mkdir(crowdedNoIndex, { recursive: true })
  for (let index = 0; index < 40; index += 1) {
    await writeFile(nodePath.join(crowdedNoIndex, `file-${index}.txt`), 'y')
  }
  await refusal(
    assertHomeV2PublishDirectoryIndexFile(crowdedNoIndex, smallLimits),
    /holds more than 5 entries/,
    'the index scan stops at the entry limit',
  )

  // ---------------------------------------------------------------------------
  // Preview staging. Core is never handed a path the user owns: validating and
  // then passing the live path leaves a window in which the tree can change.
  // ---------------------------------------------------------------------------
  const staged = await stageHomeV2PublishSourceForPreview(directorySource)
  assert.equal(
    nodePath.basename(staged.stagingDir).startsWith(HOME_V2_PUBLISH_PREVIEW_STAGING_PREFIX),
    true,
    'the staging dir carries the prefix qdn.ts\'s orphan sweep collects',
  )
  assert.equal(staged.previewPath.startsWith(staged.stagingDir + nodePath.sep), true)
  assert.deepEqual(
    (await listStagedEntries(staged.previewPath)).sort(),
    ['assets/app.js', 'index.html'],
  )
  // The staged copy is what Core reads, so it must survive the ORIGINAL going
  // away -- that is the whole point of copying it.
  // Awaited, so this is a sequenced fact and not a race: the bridge removes the
  // staging directory in a `finally` after the POST returns, and this asserts
  // the removal that call performs.
  await removeHomeV2PublishPreviewStagingDir(staged.stagingDir)
  assert.equal(existsSync(staged.stagingDir), false, 'the staging dir is removed on the success path')

  // A contained symbolic link is materialised as an ordinary file: the staged
  // tree holds no links at all, because a link is what Core would follow.
  const internalSource = await describeHomeV2PublishSourcePath(internal, 'directory')
  const stagedInternal = await stageHomeV2PublishSourceForPreview(internalSource)
  assert.deepEqual(
    (await listStagedEntries(stagedInternal.previewPath)).sort(),
    ['home.html', 'index.html'],
  )
  await removeHomeV2PublishPreviewStagingDir(stagedInternal.stagingDir)

  // THE CHECK/USE GAP: a folder that validated cleanly at selection, then had
  // an escaping link added before the preview, is refused at staging time.
  const lateLink = nodePath.join(root, 'late-link')
  await mkdir(lateLink, { recursive: true })
  await writeFile(nodePath.join(lateLink, 'index.html'), 'x')
  const lateLinkSource = await describeHomeV2PublishSourcePath(lateLink, 'directory')
  await symlink(filePath, nodePath.join(lateLink, 'leaked.html'))
  // A DELTA, never an absolute count: an earlier suite or another Home process
  // may legitimately hold a staging directory with the same prefix, and both
  // snapshots see it, so the comparison stays true either way.
  const stagingDirsBefore = await listPreviewStagingDirs()
  await refusal(
    stageHomeV2PublishSourceForPreview(lateLinkSource),
    /symbolic link pointing outside it/,
    'a link added after selection is caught at staging',
  )
  // ...and the staging directory it had started is gone, not left holding a
  // partial copy of the user's folder.
  assert.deepEqual(
    await listPreviewStagingDirs(),
    stagingDirsBefore,
    'a failed staging leaves no directory behind',
  )

  // A folder that grows past the cap between selection and preview is refused
  // during the copy, not after it has already been written out.
  const growing = nodePath.join(root, 'growing')
  await mkdir(growing, { recursive: true })
  await writeFile(nodePath.join(growing, 'index.html'), 'x')
  const growingSource = await describeHomeV2PublishSourcePath(growing, 'directory')
  const grown = nodePath.join(growing, 'grown.bin')
  await writeFile(grown, '')
  await truncate(grown, HOME_V2_PUBLISH_DIRECTORY_MAX_BYTES + 1)
  await refusal(
    stageHomeV2PublishSourceForPreview(growingSource),
    /exceeds the .* byte limit/,
    'the byte cap is re-enforced during the copy',
  )

  // Device, pipe and socket entries are refused rather than skipped: copying
  // one would block on a device, and dropping it silently would preview
  // something other than what the user is looking at.
  const withFifo = nodePath.join(root, 'with-fifo')
  await mkdir(withFifo, { recursive: true })
  await writeFile(nodePath.join(withFifo, 'index.html'), 'x')
  let fifoMade = false
  try {
    execFileSync('mkfifo', [nodePath.join(withFifo, 'pipe')], { stdio: 'ignore' })
    fifoMade = true
  } catch {
    // mkfifo is unavailable on this platform; the rule is still enforced.
  }
  if (fifoMade) {
    const fifoSource = await describeHomeV2PublishSourcePath(withFifo, 'directory')
    await refusal(
      stageHomeV2PublishSourceForPreview(fifoSource),
      /device, pipe, or socket entry/,
      'a FIFO in the tree is refused',
    )
  }

  // A single file is copied too, so Core never stats or follows a path that
  // could have been replaced -- and its extension survives, because that is
  // what picks the preview service.
  const stagedFile = await stageHomeV2PublishSourceForPreview(fileSource)
  assert.equal(nodePath.basename(stagedFile.previewPath), 'page.html')
  assert.deepEqual(await listStagedEntries(stagedFile.stagingDir), ['page.html'])
  await removeHomeV2PublishPreviewStagingDir(stagedFile.stagingDir)

  // The file re-check is stricter than the publish path's. Three cases, each
  // made to differ by construction rather than by hoping the clock moved --
  // the folder swap above failed in CI for exactly that kind of assumption.

  // A fixed point in the past, years away from any file this test writes, so
  // no assertion below depends on the wall clock or on timestamp granularity.
  const FIXED_TIME_SECONDS = 1_600_000_000

  // (a) mtime, set explicitly to that fixed point.
  const touched = nodePath.join(root, 'touched.html')
  await writeFile(touched, 'aaaaa')
  const touchedSource = await describeHomeV2PublishSourcePath(touched)
  await utimes(touched, FIXED_TIME_SECONDS, FIXED_TIME_SECONDS)
  await refusal(
    stageHomeV2PublishSourceForPreview(touchedSource),
    /changed after selection/,
    'a file whose mtime moved is caught before it reaches the node',
  )

  // (b) size, changed by appending -- independent of every timestamp.
  const grownFile = nodePath.join(root, 'grown.html')
  await writeFile(grownFile, 'aaaaa')
  const grownFileSource = await describeHomeV2PublishSourcePath(grownFile)
  await writeFile(grownFile, 'aaaaaaaaaa')
  await refusal(
    stageHomeV2PublishSourceForPreview(grownFileSource),
    /changed after selection/,
    'a file that changed size is caught',
  )

  // (c) the hard case: SAME size, and mtime put back exactly where it was, so
  // only the inode (and ctime) gives it away. Built by renaming a sibling over
  // it, so the two files provably held different inodes at the same moment.
  //
  // Both timestamps are set from a FIXED epoch second rather than copied from
  // the original's `Date`: a Date carries whole milliseconds while the stat
  // holds nanoseconds, so round-tripping one lands up to a millisecond off and
  // the case would sometimes be caught by mtime instead of by inode. (The
  // five-run loop caught that; it is the same class of assumption as the
  // inode-reuse one CI caught.)
  const restored = nodePath.join(root, 'restored.html')
  const restoredReplacement = nodePath.join(root, 'restored-replacement.html')
  await writeFile(restored, 'aaaaa')
  await utimes(restored, FIXED_TIME_SECONDS, FIXED_TIME_SECONDS)
  const restoredSource = await describeHomeV2PublishSourcePath(restored)
  assert.equal(restoredSource.kind, 'file')
  await writeFile(restoredReplacement, 'bbbbb')
  await utimes(restoredReplacement, FIXED_TIME_SECONDS, FIXED_TIME_SECONDS)
  const restoredStats = await lstat(restored, { bigint: true })
  await rename(restoredReplacement, restored)
  const afterSwap = await lstat(restored, { bigint: true })
  assert.equal(afterSwap.size, restoredStats.size, 'the replacement must be the same size')
  assert.equal(afterSwap.mtimeMs, restoredStats.mtimeMs, 'the replacement must carry the same mtime')
  assert.notEqual(afterSwap.ino, restoredStats.ino, 'the replacement must be a different inode')
  await refusal(
    stageHomeV2PublishSourceForPreview(restoredSource),
    /changed after selection/,
    'a same-size, same-mtime replacement is caught',
  )

  // (d) ctime participates in the comparison at all. Proven against a
  // SYNTHETIC descriptor rather than against the filesystem: ctime cannot be
  // set by userland, and its granularity varies by filesystem, so a test that
  // waited for it to move would be exactly the kind of timing assumption that
  // failed in CI. This asserts the property directly instead.
  if (fileSource.kind !== 'file') throw new Error('the file descriptor is needed for the probes below')
  // Control: the untouched descriptor passes, so the probes below fail because
  // of the field they change and not because the check refuses everything.
  await assertHomeV2DesktopPublishFileUnchanged(fileSource)
  for (const [field, probe] of [
    ['changedAtMs', { ...fileSource, changedAtMs: fileSource.changedAtMs + 1n }],
    ['modifiedAtMs', { ...fileSource, modifiedAtMs: fileSource.modifiedAtMs + 1n }],
    ['inode', { ...fileSource, inode: fileSource.inode + 1n }],
    ['device', { ...fileSource, device: fileSource.device + 1n }],
    ['size', { ...fileSource, size: fileSource.size + 1 }],
  ] as const) {
    await refusal(
      assertHomeV2DesktopPublishFileUnchanged(Object.freeze(probe)),
      /changed after selection/,
      `the file re-check compares ${field}`,
    )
  }

  await refusal(
    stageHomeV2PublishSourceForPreview(blobSource),
    /staged bytes cannot be previewed/,
    'staged bytes have no path to hand a node',
  )

  // The second temp directory qdn.ts's stager makes for a .zip or a bare .html
  // is recognised by prefix, so the preview path can clean up after both.
  assert.equal(
    homeV2PublishPreviewTempAncestor(
      nodePath.join(tmpdir(), `${HOME_V2_PUBLISH_PREVIEW_STAGING_PREFIX}abc123`, 'site', 'index.html'),
    ),
    nodePath.join(tmpdir(), `${HOME_V2_PUBLISH_PREVIEW_STAGING_PREFIX}abc123`),
  )
  assert.equal(homeV2PublishPreviewTempAncestor(nodePath.join(tmpdir(), 'something-else', 'x')), null)
  assert.equal(homeV2PublishPreviewTempAncestor('/etc/passwd'), null)
  assert.equal(homeV2PublishPreviewTempAncestor(tmpdir()), null)

  // ===========================================================================
  // PUBLISH PACKAGING
  //
  // Everything below is the publish half of a folder selection: the streaming
  // zip, the ceilings that bound it, the identity re-checks that make a
  // post-selection swap refuse, and the hidden-file policy.
  // ===========================================================================
  const packRoot = nodePath.join(root, 'pack-site')
  await mkdir(nodePath.join(packRoot, 'assets'), { recursive: true })
  await writeFile(nodePath.join(packRoot, 'index.html'), '<h1>hello</h1>')
  await writeFile(nodePath.join(packRoot, 'assets', 'app.js'), 'console.log(1)\n'.repeat(64))
  const packSource = await describeHomeV2PublishSourcePath(packRoot, 'directory')

  {
    const packed = await packHomeV2PublishDirectory(packSource, homeV2PublishPackagingLimits(1024 * 1024))
    try {
      const archive = new Uint8Array(await readFile(packed.archivePath))
      const files = unzipSync(archive)
      // The archive is readable by the very unzip attestation runs over it.
      assert.deepEqual(Object.keys(files).sort(), ['assets/app.js', 'index.html'])
      assert.equal(new TextDecoder().decode(files['index.html']), '<h1>hello</h1>')
      assert.equal(packed.byteLength, (await lstat(packed.archivePath)).size)
      assert.equal(packed.hiddenCount, 0)
      assert.equal(packed.excludedCount, 0)
      // Compression actually happened: the repeated JS is far smaller stored.
      assert.ok(packed.byteLength < 15 * 64, 'entries must be deflated, not stored')
      // The temp archive is Home-owned and not world-readable.
      assert.equal((await lstat(packed.archivePath)).mode & 0o077, 0)
    } finally {
      await removeHomeV2PublishPreviewStagingDir(packed.stagingDir)
    }
  }

  // A folder emptied AFTER selection is refused rather than producing a
  // zero-entry archive Core would accept and render as nothing.
  {
    const emptyDirectory = nodePath.join(root, 'pack-empty')
    await mkdir(emptyDirectory)
    await writeFile(nodePath.join(emptyDirectory, 'index.html'), 'x')
    const emptySource = await describeHomeV2PublishSourcePath(emptyDirectory, 'directory')
    await rm(nodePath.join(emptyDirectory, 'index.html'))
    await refusal(
      packHomeV2PublishDirectory(emptySource, homeV2PublishPackagingLimits(1024 * 1024)),
      /holds nothing that can be published/,
      'a folder emptied after selection is refused',
    )
  }

  // ---------------------------------------------------------------------------
  // Post-selection swap. The descriptor was taken minutes ago; between then and
  // packaging, an entry can be replaced by a link pointing anywhere.
  // ---------------------------------------------------------------------------
  {
    const swapRoot = nodePath.join(root, 'pack-swap')
    await mkdir(swapRoot)
    await writeFile(nodePath.join(swapRoot, 'index.html'), 'x')
    await writeFile(nodePath.join(swapRoot, 'data.bin'), 'safe')
    const swapSource = await describeHomeV2PublishSourcePath(swapRoot, 'directory')
    const outside = nodePath.join(root, 'outside-secret.txt')
    await writeFile(outside, 'SECRET')
    await rm(nodePath.join(swapRoot, 'data.bin'))
    await symlink(outside, nodePath.join(swapRoot, 'data.bin'))
    await refusal(
      packHomeV2PublishDirectory(swapSource, homeV2PublishPackagingLimits(1024 * 1024)),
      /contains links, which cannot be published/,
      'a file swapped for a link after selection is refused at packaging',
    )
  }

  // ---------------------------------------------------------------------------
  // Publishing refuses EVERY link, contained or not.
  //
  // Containment is the preview's rule, and it is the wrong rule here: a link
  // named `config` pointing at `.env` is contained, and following it would put
  // the excluded file into the archive under a name the hidden-file policy
  // never sees. A published folder is regular files and folders.
  // ---------------------------------------------------------------------------
  {
    const linkRoot = nodePath.join(root, 'pack-linked')
    await mkdir(linkRoot)
    await writeFile(nodePath.join(linkRoot, 'index.html'), 'x')
    await writeFile(nodePath.join(linkRoot, '.env'), 'SECRET=1')
    await symlink(nodePath.join(linkRoot, '.env'), nodePath.join(linkRoot, 'config'))
    const linkedSource = await describeHomeV2PublishSourcePath(linkRoot, 'directory')
    await refusal(
      packHomeV2PublishDirectory(linkedSource, homeV2PublishPackagingLimits(1024 * 1024)),
      /contains links, which cannot be published/,
      'a contained link to an excluded file is refused rather than followed',
    )

    // The same folder WITHOUT the link packages, and .env is not in it — so
    // the refusal above is the link talking, and the exclusion still holds.
    await rm(nodePath.join(linkRoot, 'config'))
    const unlinkedSource = await describeHomeV2PublishSourcePath(linkRoot, 'directory')
    const packedWithoutLink = await packHomeV2PublishDirectory(
      unlinkedSource,
      homeV2PublishPackagingLimits(1024 * 1024),
    )
    try {
      assert.deepEqual(
        Object.keys(unzipSync(new Uint8Array(await readFile(packedWithoutLink.archivePath)))),
        ['index.html'],
      )
      assert.equal(packedWithoutLink.excludedCount, 1)
    } finally {
      await removeHomeV2PublishPreviewStagingDir(packedWithoutLink.stagingDir)
    }

    // A directory link is refused too, not just a file one: O_NOFOLLOW guards
    // the final component only, so a link in the middle of a path is exactly
    // the component this rule exists to keep out.
    const nestedLinkRoot = nodePath.join(root, 'pack-linked-dir')
    await mkdir(nodePath.join(nestedLinkRoot, 'real'), { recursive: true })
    await writeFile(nodePath.join(nestedLinkRoot, 'index.html'), 'x')
    await writeFile(nodePath.join(nestedLinkRoot, 'real', 'page.html'), 'x')
    await symlink(nodePath.join(nestedLinkRoot, 'real'), nodePath.join(nestedLinkRoot, 'alias'))
    const nestedLinkSource = await describeHomeV2PublishSourcePath(nestedLinkRoot, 'directory')
    await refusal(
      packHomeV2PublishDirectory(nestedLinkSource, homeV2PublishPackagingLimits(1024 * 1024)),
      /contains links, which cannot be published/,
      'a contained directory link is refused',
    )
  }

  // ---------------------------------------------------------------------------
  // Growth after the measurement. The byte budget is spent on bytes AS READ, so
  // a file that grew between the walk and the package cannot smuggle them in.
  // ---------------------------------------------------------------------------
  {
    const growRoot = nodePath.join(root, 'pack-grow')
    await mkdir(growRoot)
    await writeFile(nodePath.join(growRoot, 'index.html'), 'a'.repeat(64))
    const growSource = await describeHomeV2PublishSourcePath(growRoot, 'directory')
    assert.equal(growSource.size, 64)
    await writeFile(nodePath.join(growRoot, 'index.html'), 'a'.repeat(4096))
    // No limit override: packaging spends the budget the SELECTION measured,
    // which is what makes a batch's aggregate check against selection-time
    // sizes honest. The grown file is refused as an identity mismatch (its
    // size moved) before the budget is even reached.
    await refusal(
      packHomeV2PublishDirectory(growSource, homeV2PublishPackagingLimits(1024 * 1024)),
      /changed while Home was reading it|exceeds the .* byte limit/,
      'a file grown after selection is refused against the measured budget',
    )

    // A file ADDED after selection spends bytes the selection never measured,
    // so it trips the budget rather than an identity check.
    const addedRoot = nodePath.join(root, 'pack-added')
    await mkdir(addedRoot)
    await writeFile(nodePath.join(addedRoot, 'index.html'), 'a'.repeat(64))
    const addedSource = await describeHomeV2PublishSourcePath(addedRoot, 'directory')
    await writeFile(nodePath.join(addedRoot, 'extra.bin'), 'b'.repeat(4096))
    await refusal(
      packHomeV2PublishDirectory(addedSource, homeV2PublishPackagingLimits(1024 * 1024)),
      /exceeds the .* byte limit/,
      'a file added after selection is refused against the measured budget',
    )
  }

  // ---------------------------------------------------------------------------
  // Work caps, proven against injectable limits rather than by building a
  // folder with ten thousand files in it.
  // ---------------------------------------------------------------------------
  {
    const floodRoot = nodePath.join(root, 'pack-flood')
    await mkdir(floodRoot)
    for (const name of ['index.html', 'a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt']) {
      await writeFile(nodePath.join(floodRoot, name), 'x')
    }
    const floodSource = await describeHomeV2PublishSourcePath(floodRoot, 'directory')
    await refusal(
      packHomeV2PublishDirectory(floodSource, homeV2PublishPackagingLimits(1024 * 1024, { maximumEntries: 3 })),
      /more than 3 entries/,
      'the entry budget stops the walk',
    )

    const deepRoot = nodePath.join(root, 'pack-deep')
    await mkdir(nodePath.join(deepRoot, 'a', 'b', 'c'), { recursive: true })
    await writeFile(nodePath.join(deepRoot, 'index.html'), 'x')
    await writeFile(nodePath.join(deepRoot, 'a', 'b', 'c', 'deep.html'), 'x')
    const deepSource = await describeHomeV2PublishSourcePath(deepRoot, 'directory')
    await refusal(
      packHomeV2PublishDirectory(deepSource, homeV2PublishPackagingLimits(1024 * 1024, { maximumDepth: 2 })),
      /nests more than 2 levels/,
      'the depth bound stops the walk',
    )
    // The same folder packages fine at the real depth bound.
    const deepOk = await packHomeV2PublishDirectory(deepSource, homeV2PublishPackagingLimits(1024 * 1024))
    await removeHomeV2PublishPreviewStagingDir(deepOk.stagingDir)

    const longRoot = nodePath.join(root, 'pack-long')
    await mkdir(longRoot)
    await writeFile(nodePath.join(longRoot, 'index.html'), 'x')
    await writeFile(nodePath.join(longRoot, 'a-rather-long-name.html'), 'x')
    const longSource = await describeHomeV2PublishSourcePath(longRoot, 'directory')
    await refusal(
      packHomeV2PublishDirectory(longSource, homeV2PublishPackagingLimits(1024 * 1024, { maximumPathBytes: 8 })),
      /cannot be published safely/,
      'an over-long entry path is refused before it is written',
    )
  }

  // Entry names are canonical, and two entries that would unpack to one name
  // are refused rather than silently overwriting each other.
  {
    const seen = new Set<string>()
    const nameLimits = { maximumPathBytes: 1024 }
    assert.equal(canonicalHomeV2PublishEntryName('a/b.txt', nameLimits, seen), 'a/b.txt')
    assert.throws(() => canonicalHomeV2PublishEntryName('A/B.TXT', nameLimits, seen), /unpack to the same name/)
    for (const bad of ['', '/abs.txt', '../escape.txt', 'a/../b.txt', 'a//b.txt', 'C:/x.txt', 'back\\slash.txt']) {
      assert.throws(
        () => canonicalHomeV2PublishEntryName(bad, nameLimits, new Set()),
        /cannot be published safely/,
        `entry name ${JSON.stringify(bad)} must be refused`,
      )
    }
  }

  // ---------------------------------------------------------------------------
  // The index rule follows the SERVICE, not the picker.
  //
  // A media bundle -- the video with its poster and its captions -- is the
  // reason folder publishing exists for anything other than websites, and it
  // has no index.html to offer. Core agrees: VIDEO, AUDIO and DOCUMENT are all
  // declared single=false in its Service table, and only WEBSITE carries the
  // MISSING_INDEX_FILE validator.
  // ---------------------------------------------------------------------------
  {
    const mediaRoot = nodePath.join(root, 'pack-media')
    await mkdir(mediaRoot)
    await writeFile(nodePath.join(mediaRoot, 'clip.mp4'), 'pretend video bytes')
    await writeFile(nodePath.join(mediaRoot, 'poster.jpg'), 'pretend poster bytes')
    await writeFile(nodePath.join(mediaRoot, 'captions.vtt'), 'WEBVTT\n')
    const mediaSource = await describeHomeV2PublishSourcePath(mediaRoot, 'directory')

    // VIDEO/AUDIO/DOCUMENT: packaged as it is.
    const bundle = await packHomeV2PublishDirectory(mediaSource, homeV2PublishPackagingLimits(1024 * 1024))
    try {
      assert.deepEqual(
        Object.keys(unzipSync(new Uint8Array(await readFile(bundle.archivePath)))).sort(),
        ['captions.vtt', 'clip.mp4', 'poster.jpg'],
      )
    } finally {
      await removeHomeV2PublishPreviewStagingDir(bundle.stagingDir)
    }

    // WEBSITE/APP/GAME: refused, because Home renders those through an HTML
    // entry point and there is none.
    await refusal(
      packHomeV2PublishDirectory(mediaSource, homeV2PublishPackagingLimits(1024 * 1024), {
        requireIndexFile: true,
      }),
      /no index file, which a website or app publish requires/,
      'a site publish of an index-less folder is refused',
    )
    await refusal(
      prepareHomeV2PublishArtifact(mediaSource, { maximumBytes: 1024 * 1024, requireIndexFile: true }),
      /no index file, which a website or app publish requires/,
      'the artifact carries the service rule through',
    )

    // The same folder with an index passes the site rule, so the refusal above
    // is the missing index talking and not a check that refuses everything.
    await writeFile(nodePath.join(mediaRoot, 'index.html'), '<video src="clip.mp4"></video>')
    const siteSource = await describeHomeV2PublishSourcePath(mediaRoot, 'directory')
    const site = await packHomeV2PublishDirectory(siteSource, homeV2PublishPackagingLimits(1024 * 1024), {
      requireIndexFile: true,
    })
    await removeHomeV2PublishPreviewStagingDir(site.stagingDir)

    // An index that the hidden-file policy drops does not satisfy the rule:
    // what counts is the name that actually went into the archive.
    const shadowRoot = nodePath.join(root, 'pack-shadow-index')
    await mkdir(nodePath.join(shadowRoot, '.vscode'), { recursive: true })
    await writeFile(nodePath.join(shadowRoot, '.vscode', 'index.html'), 'x')
    await writeFile(nodePath.join(shadowRoot, 'clip.mp4'), 'y')
    const shadowSource = await describeHomeV2PublishSourcePath(shadowRoot, 'directory')
    await refusal(
      packHomeV2PublishDirectory(shadowSource, homeV2PublishPackagingLimits(1024 * 1024), {
        requireIndexFile: true,
      }),
      /no index file, which a website or app publish requires/,
      'a nested or excluded index does not satisfy the top-level rule',
    )
  }

  // ---------------------------------------------------------------------------
  // Hidden files.
  // ---------------------------------------------------------------------------
  {
    const hiddenRoot = nodePath.join(root, 'pack-hidden')
    await mkdir(nodePath.join(hiddenRoot, '.git'), { recursive: true })
    await writeFile(nodePath.join(hiddenRoot, '.git', 'config'), 'url = git@example')
    await writeFile(nodePath.join(hiddenRoot, '.env'), 'SECRET=1')
    await writeFile(nodePath.join(hiddenRoot, '.DS_Store'), 'junk')
    await writeFile(nodePath.join(hiddenRoot, 'index.html'), 'x')
    const hiddenSource = await describeHomeV2PublishSourcePath(hiddenRoot, 'directory')

    // The always-excluded names are dropped, and the drop is counted.
    const dropped = await packHomeV2PublishDirectory(hiddenSource, homeV2PublishPackagingLimits(1024 * 1024))
    try {
      const files = unzipSync(new Uint8Array(await readFile(dropped.archivePath)))
      assert.deepEqual(Object.keys(files), ['index.html'])
      assert.equal(dropped.excludedCount, 3)
      assert.equal(dropped.hiddenCount, 0)
    } finally {
      await removeHomeV2PublishPreviewStagingDir(dropped.stagingDir)
    }

    // Any OTHER dotfile stops the publish until the app asks for it by name.
    await writeFile(nodePath.join(hiddenRoot, '.htaccess'), 'deny')
    const consentSource = await describeHomeV2PublishSourcePath(hiddenRoot, 'directory')
    await refusal(
      packHomeV2PublishDirectory(consentSource, homeV2PublishPackagingLimits(1024 * 1024)),
      /contains hidden files/,
      'a dotfile is refused without an explicit opt-in',
    )
    const optedIn = await packHomeV2PublishDirectory(
      consentSource,
      homeV2PublishPackagingLimits(1024 * 1024),
      { includeHidden: true },
    )
    try {
      const files = unzipSync(new Uint8Array(await readFile(optedIn.archivePath)))
      assert.deepEqual(Object.keys(files).sort(), ['.htaccess', 'index.html'])
      assert.equal(optedIn.hiddenCount, 1)
      // Opting in does NOT resurrect the always-excluded names.
      assert.equal(optedIn.excludedCount, 3)
    } finally {
      await removeHomeV2PublishPreviewStagingDir(optedIn.stagingDir)
    }

    assert.equal(isHomeV2PublishAlwaysExcludedName('.env.production.local'), true)
    assert.equal(isHomeV2PublishAlwaysExcludedName('.index.html.swp'), true)
    assert.equal(isHomeV2PublishAlwaysExcludedName('notes.txt~'), true)
    assert.equal(isHomeV2PublishAlwaysExcludedName('Thumbs.db'), true)
    assert.equal(isHomeV2PublishAlwaysExcludedName('environment.json'), false)

    // The opt-in is a strict boolean: a truthy string is a refusal, not a yes.
    assert.equal(getRequestedHomeV2PublishIncludeHidden({}), false)
    assert.equal(getRequestedHomeV2PublishIncludeHidden(null), false)
    assert.equal(getRequestedHomeV2PublishIncludeHidden({ includeHidden: true }), true)
    for (const bad of ['true', 'false', 1, 0, {}]) {
      assert.throws(
        () => getRequestedHomeV2PublishIncludeHidden({ includeHidden: bad }),
        /includeHidden must be true or false/,
        `includeHidden ${JSON.stringify(bad)} must be refused`,
      )
    }
  }

  // ---------------------------------------------------------------------------
  // The artifact the publish paths actually consume.
  // ---------------------------------------------------------------------------
  {
    const artifactFile = nodePath.join(root, 'artifact.bin')
    await writeFile(artifactFile, 'artifact-bytes')
    const fileArtifactSource = await describeHomeV2PublishSourcePath(artifactFile)
    const artifact = await prepareHomeV2PublishArtifact(fileArtifactSource, { maximumBytes: 1024 * 1024 })
    try {
      const hash = await artifact.sha256()
      assert.match(hash, /^[0-9a-f]{64}$/)
      assert.equal(artifact.isZip, false)
      assert.equal(new TextDecoder().decode(await artifact.read()), 'artifact-bytes')
      // An IN-PLACE rewrite of the same length keeps the inode and the size,
      // so only the re-hash inside read() can see it. That is the difference
      // between publishing what was approved and publishing what replaced it.
      await writeFile(artifactFile, 'ARTIFACT-BYTES')
      await refusal(artifact.read(), /changed after selection/, 'an in-place rewrite is caught at read time')
    } finally {
      await artifact.dispose()
    }

    // Home's own memory ceiling refuses before anything is read.
    const smallCeiling = await prepareHomeV2PublishArtifact(fileArtifactSource, { maximumBytes: 4 }).then(
      (prepared) => prepared.dispose().then(() => 'prepared'),
      (error: unknown) => String((error as Error).message),
    )
    assert.match(String(smallCeiling), /larger than Home will hold in memory/)

    // A folder artifact owns a temp archive and cleans it up on dispose.
    const folderArtifact = await prepareHomeV2PublishArtifact(packSource, { maximumBytes: 1024 * 1024 })
    assert.equal(folderArtifact.isZip, true)
    assert.equal(folderArtifact.entryCount, 3, 'two files plus the assets directory')
    const folderHash = await folderArtifact.sha256()
    const folderBytes = await folderArtifact.read()
    assert.equal(folderBytes.byteLength, folderArtifact.byteLength)
    assert.deepEqual(Object.keys(unzipSync(folderBytes)).sort(), ['assets/app.js', 'index.html'])
    assert.match(folderHash, /^[0-9a-f]{64}$/)
    const stagingBefore = (await listPublishStagingDirs()).length
    await folderArtifact.dispose()
    assert.equal((await listPublishStagingDirs()).length, stagingBefore - 1, 'dispose removes the temp archive')

    // A packaged folder cannot exceed the archive ceiling: the writer stops
    // mid-entry rather than measuring the finished file afterwards.
    await refusal(
      packHomeV2PublishDirectory(packSource, homeV2PublishPackagingLimits(64)),
      /larger than this publish route accepts once packaged/,
      'the archive ceiling is enforced as the archive is written',
    )
  }

  // ---------------------------------------------------------------------------
  // A swapped DIRECTORY component.
  //
  // O_NOFOLLOW protects the final component of a path and nothing above it, so
  // a subdirectory replaced between the walk and the read would open a
  // different file under the same name, successfully. The walk records what
  // each entry WAS, and the open has to still be it.
  // ---------------------------------------------------------------------------
  {
    const swapDirRoot = nodePath.join(root, 'pack-dir-swap')
    await mkdir(nodePath.join(swapDirRoot, 'assets'), { recursive: true })
    await writeFile(nodePath.join(swapDirRoot, 'index.html'), 'x')
    // Same LENGTH as the substitute below, so this scenario exercises the
    // identity rule rather than the selection-time byte budget (which refuses
    // a grown tree on its own, and is proven separately above).
    await writeFile(nodePath.join(swapDirRoot, 'assets', 'app.js'), 'genuine!')
    const swapDirSource = await describeHomeV2PublishSourcePath(swapDirRoot, 'directory')

    // The identity check is what would catch the swap at packaging time. It is
    // asserted directly here, because the swap has to land in the window
    // between the walk's lstat and the open, which a test cannot schedule.
    const genuine = await lstat(nodePath.join(swapDirRoot, 'assets'), { bigint: true })
    const impostorRoot = nodePath.join(root, 'pack-dir-swap-impostor')
    await mkdir(impostorRoot)
    await writeFile(nodePath.join(impostorRoot, 'app.js'), 'imposter')
    const impostor = await lstat(impostorRoot, { bigint: true })
    assert.notEqual(genuine.ino, impostor.ino, 'the impostor must be a different inode')

    // Replacing the directory wholesale is what an attacker can do, and it is
    // exactly what changes the inode: reusing one takes an unlink and a
    // create, and a created inode is a new number.
    await rm(nodePath.join(swapDirRoot, 'assets'), { force: true, recursive: true })
    await rename(impostorRoot, nodePath.join(swapDirRoot, 'assets'))
    const swapped = await lstat(nodePath.join(swapDirRoot, 'assets'), { bigint: true })
    assert.notEqual(swapped.ino, genuine.ino)

    // The folder's own descriptor is unchanged (the ROOT was not touched), so
    // nothing but the per-entry identity could notice — and a fresh walk is
    // consistent with itself, so the packaged result is the substituted tree
    // rather than a stale one. The property that matters is that no file is
    // ever read through a component the walk did not see: proven by the
    // packaged bytes matching what is on disk NOW.
    await assertHomeV2DesktopPublishDirectoryUnchanged(swapDirSource)
    const repacked = await packHomeV2PublishDirectory(
      swapDirSource,
      homeV2PublishPackagingLimits(1024 * 1024),
    )
    try {
      const files = unzipSync(new Uint8Array(await readFile(repacked.archivePath)))
      assert.equal(new TextDecoder().decode(files['assets/app.js']), 'imposter')
    } finally {
      await removeHomeV2PublishPreviewStagingDir(repacked.stagingDir)
    }

    // And the mismatch itself refuses: a handle opened on the OLD inode is not
    // the entry a walk of the current tree records.
    const staleIdentity = { device: genuine.dev, inode: genuine.ino, size: Number(genuine.size) }
    const currentIdentity = { device: swapped.dev, inode: swapped.ino, size: Number(swapped.size) }
    assert.equal(matchesHomeV2PublishEntryIdentity(swapped, currentIdentity), true)
    assert.equal(matchesHomeV2PublishEntryIdentity(swapped, staleIdentity), false)
  }

  // ---------------------------------------------------------------------------
  // Entry names Core's own sanitizer would rewrite.
  //
  // ZipUtils.sanitizeZipEntrySegment STRIPS < > : " / \ | ? * and trims
  // whitespace off both ends of every segment. Home refuses those names before
  // the upload instead, because Core rewriting a name after the fact renames
  // content the user already approved a hash of -- and two names that sanitize
  // to one are how an entry silently overwrites another.
  // ---------------------------------------------------------------------------
  {
    const nameLimits = { maximumPathBytes: 1024 }
    for (const bad of [
      'why?.txt',
      'star*.txt',
      'pipe|.txt',
      'quote".txt',
      'less<.txt',
      'greater>.txt',
      'colon:.txt',
      ' leading.txt',
      'trailing.txt ',
      'dir /file.txt',
      'dir/ file.txt',
    ]) {
      assert.throws(
        () => canonicalHomeV2PublishEntryName(bad, nameLimits, new Set()),
        /cannot be published safely/,
        `entry name ${JSON.stringify(bad)} must be refused before upload`,
      )
    }
    // A name Core would sanitize to something it already holds is a collision,
    // and it is refused as one rather than discovered by attestation after the
    // upload.
    const seen = new Set<string>()
    canonicalHomeV2PublishEntryName('report.txt', nameLimits, seen)
    assert.throws(
      () => canonicalHomeV2PublishEntryName('REPORT.txt', nameLimits, seen),
      /unpack to the same name/,
    )
    // Compatibility forms fold too: U+FF32 FULLWIDTH R normalises to R.
    const wide = new Set<string>()
    canonicalHomeV2PublishEntryName('report.txt', nameLimits, wide)
    assert.throws(
      () => canonicalHomeV2PublishEntryName('Ｒeport.txt', nameLimits, wide),
      /unpack to the same name/,
    )
  }

  // ---------------------------------------------------------------------------
  // An artifact that is prepared and then fails is still disposed.
  //
  // A batch prepares every item and then hashes it. The hash can throw, and an
  // artifact owns its open handle or its temp archive from the moment it is
  // prepared -- so preparation and registration have to be the same instant.
  // ---------------------------------------------------------------------------
  {
    const stagingBefore = (await listPublishStagingDirs()).length
    const tracked: HomeV2PublishArtifact[] = []
    let injected: unknown
    try {
      const artifact = await prepareTrackedHomeV2PublishArtifact(tracked, packSource, {
        maximumBytes: 1024 * 1024,
      })
      assert.equal(tracked.length, 1)
      assert.equal(tracked[0], artifact, 'the artifact is registered before it is returned')
      assert.equal((await listPublishStagingDirs()).length, stagingBefore + 1)
      // Stands in for artifact.sha256() throwing, which is the real case: a
      // source that moved between the walk and the read.
      throw new Error('injected sha256 failure')
    } catch (error) {
      injected = error
    } finally {
      for (const artifact of tracked) await artifact.dispose()
    }
    assert.match(String((injected as Error).message), /injected sha256 failure/)
    assert.equal(
      (await listPublishStagingDirs()).length,
      stagingBefore,
      'a failure after preparation still releases the temp archive',
    )
  }

  // ===========================================================================
  // SOURCE PINS — how the bridge wires this module.
  //
  // The publish handlers need an account, a window and a node to run, so the
  // properties below are asserted against the CODE. Each one is a rule whose
  // absence would not fail any other test here: the folder gates are negatives,
  // and a leaked artifact is invisible until memory runs out.
  // ===========================================================================
  const bridgeSource = readFileSync(new URL('../electron/home-v2-app-bridge.ts', import.meta.url), 'utf8')

  // Home's ceilings are what the node-discovered one is clamped to.
  assert.equal(HOME_V2_PUBLISH_IN_MEMORY_MAX_BYTES, 256 * 1024 * 1024)
  assert.equal(HOME_V2_PUBLISH_BATCH_MAX_TOTAL_BYTES, 512 * 1024 * 1024)

  // isZip reaches the upload and the attestation from the ARTIFACT, not from a
  // guess about the descriptor: a file source that was somehow packaged, or a
  // folder that was not, would otherwise be described wrongly to Core.
  assert.ok(bridgeSource.includes('isZip: artifact.isZip'), 'the single publish forwards the artifact isZip')
  assert.ok(bridgeSource.includes('isZip: entry.artifact.isZip'), 'the batch publish forwards the artifact isZip')

  // Folder sources are refused on Qortal at BOTH ends: the picker (so no dead
  // token is issued) and the publish (so a token issued before a route change
  // cannot be redeemed there).
  assert.equal(
    bridgeSource.split('Folder publish sources are available on Qortium only').length - 1,
    3,
    'the Qortium-only folder gate guards selection, single publish and batch publish',
  )

  // The batch aggregate is refused BEFORE anything is opened, read or packaged.
  const batchSource = bridgeSource.slice(bridgeSource.indexOf('async function publishHomeV2MultiplePublishSources'))
  assert.ok(
    batchSource.indexOf('HOME_V2_PUBLISH_BATCH_MAX_TOTAL_BYTES') <
      batchSource.indexOf('prepareTrackedHomeV2PublishArtifact'),
    'the batch byte cap must be enforced before the first artifact is prepared',
  )
  // Disposal follows what was PREPARED, not what was recorded: an artifact
  // whose hash throws never reaches `items`, and it owns a handle regardless.
  assert.ok(
    batchSource.includes('prepareTrackedHomeV2PublishArtifact(prepared,'),
    'the batch registers each artifact for disposal as it is prepared',
  )
  assert.ok(
    batchSource.includes('for (const artifact of prepared) await artifact.dispose()'),
    'the batch disposes every prepared artifact',
  )
  assert.ok(bridgeSource.includes('await artifact.dispose()'), 'the single publish disposes its artifact')

  // The index rule comes from the SERVICE, through the classification the rest
  // of Home already uses for browser-rendered archives, and the batch applies
  // it per item rather than once for the request.
  assert.ok(
    bridgeSource.includes('isQdnBrowserArchiveService(request.resource.service)'),
    'the single publish derives requireIndexFile from its service',
  )
  assert.ok(
    bridgeSource.includes('isQdnBrowserArchiveService(entry.item.resource.service)'),
    'the batch derives requireIndexFile per item',
  )

  // Nothing untagged reaches an app from the packaging or reading steps: this
  // module's own refusals are path-free sentences and pass through, and a raw
  // errno error that slipped past a local catch is replaced with a constant.
  assert.equal(
    bridgeSource.split('withHomeV2PublishSourceErrors(').length - 1,
    6,
    'both publish paths wrap preparing, hashing and reading a source',
  )

  // The chat-attachment path takes the RAW-BYTES reader, which refuses a
  // folder by name — an attachment is one encrypted file, and packaging one
  // into a zip would be a different action wearing this one's prompt.
  const attachmentSource = bridgeSource.slice(bridgeSource.indexOf('async function publishHomeV2PrivateAttachmentSource'))
  assert.ok(attachmentSource.includes('readHomeV2DesktopPublishSource'))
  assert.ok(
    !attachmentSource.slice(0, attachmentSource.indexOf('\n}')).includes('prepareHomeV2PublishArtifact'),
    'the attachment path never packages a folder',
  )

  // Folder publishing is desktop-only because it is main-process-only: neither
  // Android arm has any of this machinery, which is why nothing there needs a
  // second gate.
  for (const androidArm of ['../src/platform.ts', '../electron/home-v2-app-runtime.ts']) {
    const armSource = readFileSync(new URL(androidArm, import.meta.url), 'utf8')
    assert.ok(
      !armSource.includes('prepareHomeV2PublishArtifact') && !armSource.includes('packHomeV2PublishDirectory'),
      `${androidArm} must not reach the desktop packaging path`,
    )
  }

  // ---------------------------------------------------------------------------
  // Nothing the app sees names a directory on the user's machine.
  // ---------------------------------------------------------------------------
  assert.ok(reportedMessages.length >= 6, 'the path-free rule needs messages to check')
  for (const message of reportedMessages) {
    assert.doesNotMatch(message, /[\\/]/, `refusal message must carry no path: ${message}`)
  }

  console.log('home-v2-publish-source-selection tests passed.')
} finally {
  await rm(root, { force: true, recursive: true })
}
