import assert from 'node:assert/strict'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import {
  readQdnAppRolesStore,
  setQdnAppAssignmentValueIfRevision,
} from './qdn-manager-permission-store.js'

const root = mkdtempSync(path.join(os.tmpdir(), 'qortium-qdn-app-store-'))
const storePath = path.join(root, 'qdn-app-roles.json')
app.setPath('userData', root)

try {
  await app.whenReady()
  const initial = readQdnAppRolesStore()
  const changed = setQdnAppAssignmentValueIfRevision(initial.revision, {
    role: 'explore',
    url: 'qdn://APP/OtherExplore/OtherExplore',
  })
  assert.equal(changed.assignments.explore.url, 'qdn://APP/OtherExplore/OtherExplore')
  assert.equal(JSON.parse(readFileSync(storePath, 'utf8')).revision, changed.revision)
  assert.equal(
    readdirSync(root).some((name) => name.endsWith('.tmp')),
    false,
    'atomic activation must not leave a temporary file',
  )
  if (process.platform !== 'win32') assert.equal(lstatSync(storePath).mode & 0o777, 0o600)

  rmSync(storePath)
  mkdirSync(storePath)
  assert.throws(
    () => setQdnAppAssignmentValueIfRevision(changed.revision, {
      role: 'explore',
      url: 'qdn://APP/GhostExplore/GhostExplore',
    }),
    (error: unknown) =>
      (error as { code?: unknown }).code === 'HOME_QDN_APP_STORE_UNAVAILABLE',
  )
  assert.equal(
    readQdnAppRolesStore().assignments.explore.url,
    'qdn://APP/OtherExplore/OtherExplore',
    'a failed activation must not update the in-memory assignment store',
  )
  assert.equal(lstatSync(storePath).isDirectory(), true, 'an unsafe endpoint must not be replaced')
  console.log('QDN app assignment-store hardening tests passed.')
} finally {
  rmSync(root, { force: true, recursive: true })
}
