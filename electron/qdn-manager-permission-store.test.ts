import assert from 'node:assert/strict'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import {
  readQdnAppRolesStore,
  hasQdnAccountCapability,
  hasQdnAppCapability,
  grantQdnAccountCapabilityPermission,
  grantQdnAppCapabilityPermission,
  revokeQdnAccountCapabilityPermissionIfRevision,
  setQdnAppAssignmentValueIfRevision,
} from './qdn-manager-permission-store.js'
import { createDefaultQdnAppRolesStore, sanitizeQdnAppRolesStore, storeHoldsQdnAccountCapability } from './qdn-manager-permissions.js'

const root = mkdtempSync(path.join(os.tmpdir(), 'qortium-qdn-app-store-'))
const storePath = path.join(root, 'qdn-app-roles.json')
app.setPath('userData', root)

try {
  await app.whenReady()
  writeFileSync(storePath, JSON.stringify({
    ...createDefaultQdnAppRolesStore(),
    capabilityGrants: {
      'qdn://APP/Chat/Chat': { 'chat.send': { grantedAt: '2026-09-04T10:00:00.000Z' } },
      'qortal://APP/Chat/Chat': { 'chat.send': { grantedAt: '2026-09-04T10:00:00.000Z' } },
    },
  }))
  assert.deepEqual(readQdnAppRolesStore().capabilityGrants, {})
  for (const scheme of ['qdn', 'qortal']) {
    const principal = `${scheme}://APP/Chat/Chat`
    assert.equal(hasQdnAppCapability(principal, 'chat.send'), false)
    assert.equal(hasQdnAccountCapability(principal, 'wallet:A', 'chat.send'), false)
    assert.throws(() => grantQdnAppCapabilityPermission(principal, 'chat.send'), /requires an account/)
    grantQdnAccountCapabilityPermission(principal, 'wallet:A', 'chat.send')
    assert.equal(hasQdnAccountCapability(principal, 'wallet:A', 'chat.send'), true)
    assert.equal(hasQdnAccountCapability(principal, 'wallet:B', 'chat.send'), false)
    // Decode the activated file afresh, without the store's in-memory cache.
    const reopened = sanitizeQdnAppRolesStore(JSON.parse(readFileSync(storePath, 'utf8')))
    assert.equal(storeHoldsQdnAccountCapability(reopened, principal, 'wallet:A', 'chat.send'), true)
    assert.equal(storeHoldsQdnAccountCapability(reopened, principal, 'wallet:B', 'chat.send'), false)
    assert.equal(reopened.capabilityGrants[principal]?.['chat.send'], undefined)
    grantQdnAccountCapabilityPermission(principal, 'wallet:B', 'chat.send')
    revokeQdnAccountCapabilityPermissionIfRevision(readQdnAppRolesStore().revision, principal, 'wallet:A', 'chat.send')
    assert.equal(hasQdnAccountCapability(principal, 'wallet:A', 'chat.send'), false)
    assert.equal(hasQdnAccountCapability(principal, 'wallet:B', 'chat.send'), true)
  }
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
