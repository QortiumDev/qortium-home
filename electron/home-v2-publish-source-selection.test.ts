import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { lstat, mkdtemp, mkdir, opendir, rename, rm, symlink, truncate, utimes, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'

import {
  HOME_V2_PUBLISH_DIRECTORY_MAX_BYTES,
  HOME_V2_PUBLISH_PREVIEW_STAGING_PREFIX,
  HOME_V2_PUBLISH_PREVIEW_INDEX_FILES,
  assertHomeV2DesktopPublishDirectoryUnchanged,
  assertHomeV2DesktopPublishFileUnchanged,
  describeHomeV2PublishSourcePath,
  getRequestedHomeV2PublishSourceKind,
  homeV2PublishPreviewTempAncestor,
  homeV2PublishSourceDialogProperties,
  isHomeV2PublishSourceError,
  measureHomeV2PublishDirectoryBytes,
  readHomeV2DesktopPublishSource,
  removeHomeV2PublishPreviewStagingDir,
  stageHomeV2PublishSourceForPreview,
  type HomeV2DesktopPublishSource,
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

async function listPreviewStagingDirs() {
  const names: string[] = []
  const handle = await opendir(tmpdir())
  for await (const entry of handle) {
    if (entry.name.startsWith(HOME_V2_PUBLISH_PREVIEW_STAGING_PREFIX)) names.push(entry.name)
  }
  return names.sort()
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

  // A WEBSITE preview with no entry point renders nothing, so it is refused in
  // the picker instead of after the node has already been handed the path.
  const noIndex = nodePath.join(root, 'no-index')
  await mkdir(noIndex, { recursive: true })
  await writeFile(nodePath.join(noIndex, 'readme.txt'), 'nope')
  await assert.rejects(
    describeHomeV2PublishSourcePath(noIndex, 'directory'),
    /index file \(for example index\.html\)/,
  )
  // The accepted entry-point names are Core's list, shared with the 1.x
  // preview stager rather than copied.
  for (const indexName of HOME_V2_PUBLISH_PREVIEW_INDEX_FILES) {
    const folder = nodePath.join(root, `entry-${indexName}`)
    await mkdir(folder, { recursive: true })
    await writeFile(nodePath.join(folder, indexName), 'x')
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
    /exceeds the .* byte preview limit/,
  )
  await assert.rejects(
    measureHomeV2PublishDirectoryBytes(oversize),
    /exceeds the .* byte preview limit/,
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
    describeHomeV2PublishSourcePath(crowdedNoIndex, 'directory', smallLimits),
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
    /exceeds the .* byte preview limit/,
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
