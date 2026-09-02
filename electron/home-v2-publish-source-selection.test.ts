import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'

import {
  HOME_V2_PUBLISH_DIRECTORY_MAX_BYTES,
  HOME_V2_PUBLISH_PREVIEW_INDEX_FILES,
  assertHomeV2DesktopPublishDirectoryUnchanged,
  describeHomeV2PublishSourcePath,
  getRequestedHomeV2PublishSourceKind,
  homeV2PublishSourceDialogProperties,
  measureHomeV2PublishDirectoryBytes,
  readHomeV2DesktopPublishSource,
  type HomeV2DesktopPublishSource,
} from './home-v2-publish-source-selection.js'

const root = await mkdtemp(nodePath.join(tmpdir(), 'home-v2-publish-source-'))

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
    /between 1 byte and 100 MiB/,
  )

  const hugePath = nodePath.join(root, 'huge.bin')
  await writeFile(hugePath, '')
  // Sparse: the size the cap reads, without the bytes on disk.
  await truncate(hugePath, 101 * 1024 * 1024)
  await assert.rejects(
    describeHomeV2PublishSourcePath(hugePath),
    /between 1 byte and 100 MiB/,
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
  // for previewing -- the publish and chat-attachment paths read BYTES, and a
  // folder has none.
  // -------------------------------------------------------------------------
  await assert.rejects(
    readHomeV2DesktopPublishSource(directorySource),
    /folder can only be previewed, not published/,
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
  const swapped = nodePath.join(root, 'swapped')
  await mkdir(swapped, { recursive: true })
  await writeFile(nodePath.join(swapped, 'index.html'), 'x')
  const swappedSource = await describeHomeV2PublishSourcePath(swapped, 'directory')
  await rm(swapped, { force: true, recursive: true })
  await mkdir(swapped, { recursive: true })
  await assert.rejects(
    assertHomeV2DesktopPublishDirectoryUnchanged(swappedSource),
    /changed after selection/,
  )

  console.log('home-v2-publish-source-selection tests passed.')
} finally {
  await rm(root, { force: true, recursive: true })
}
