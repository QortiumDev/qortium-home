import assert from 'node:assert/strict'
import {
  grantQdnAppCapabilityPermission,
  getQdnAppRolesStore,
  hasQdnManagerPermission,
  revokeQdnAppCapabilityPermission,
  setQdnAppAssignmentValue,
} from './qdnManagerPermissions'
import {
  setFakePreference,
  setFakePreferencesWriteUnavailable,
} from './v2/test-kit/fake-capacitor-preferences'

Object.assign(globalThis, { window: { qortiumHome: {} } })
setFakePreference(null)
const initial = await getQdnAppRolesStore()
const originalUrl = initial.assignments.explore.url
const granted = await grantQdnAppCapabilityPermission(
  'qdn://APP/Bookmarks/Bookmarks',
  'bookmarks.manage',
  initial.revision,
)
assert.equal(
  await hasQdnManagerPermission('qdn://APP/Bookmarks/Bookmarks', 'bookmarks.manage'),
  true,
)
const revoked = await revokeQdnAppCapabilityPermission(
  'qdn://APP/Bookmarks/Bookmarks',
  'bookmarks.manage',
  granted.revision,
)
assert.equal(
  await hasQdnManagerPermission('qdn://APP/Bookmarks/Bookmarks', 'bookmarks.manage'),
  false,
)
setFakePreferencesWriteUnavailable(true)
await assert.rejects(
  setQdnAppAssignmentValue({
    role: 'explore',
    url: 'qdn://APP/GhostExplore/GhostExplore',
  }, revoked.revision),
  /Preferences unavailable/,
)
assert.equal(
  (await getQdnAppRolesStore()).assignments.explore.url,
  originalUrl,
  'a failed native write must not update the in-memory assignment store',
)

console.log('Native QDN assignment-store management tests passed.')
