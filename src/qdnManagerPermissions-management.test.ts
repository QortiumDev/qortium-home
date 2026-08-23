import assert from 'node:assert/strict'
import {
  getQdnAppRolesStore,
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
setFakePreferencesWriteUnavailable(true)
await assert.rejects(
  setQdnAppAssignmentValue({
    role: 'explore',
    url: 'qdn://APP/GhostExplore/GhostExplore',
  }, initial.revision),
  /Preferences unavailable/,
)
assert.equal(
  (await getQdnAppRolesStore()).assignments.explore.url,
  originalUrl,
  'a failed native write must not update the in-memory assignment store',
)

console.log('Native QDN assignment-store management tests passed.')
