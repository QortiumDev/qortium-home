import assert from 'node:assert/strict'
import {
  grantQdnAppCapabilityPermission,
  grantQdnAccountCapabilityPermission,
  getQdnAppRolesStore,
  hasQdnAccountCapability,
  hasQdnAppCapability,
  hasQdnManagerPermission,
  revokeQdnAppCapabilityPermission,
  revokeQdnAccountCapabilityPermission,
  setQdnAppAssignmentValue,
} from './qdnManagerPermissions'
import {
  setFakePreference,
  setFakePreferencesWriteUnavailable,
  readFakePreference,
} from './v2/test-kit/fake-capacitor-preferences'
import { createDefaultQdnAppRolesStore, sanitizeQdnAppRolesStore, storeHoldsQdnAccountCapability } from '../electron/qdn-manager-permissions'

Object.assign(globalThis, { window: { qortiumHome: {} } })
setFakePreference(JSON.stringify({
  ...createDefaultQdnAppRolesStore(),
  capabilityGrants: {
    'qdn://APP/Chat/Chat': { 'chat.send': { grantedAt: '2026-09-04T10:00:00.000Z' } },
    'qortal://APP/Chat/Chat': { 'chat.send': { grantedAt: '2026-09-04T10:00:00.000Z' } },
  },
}))
const initial = await getQdnAppRolesStore()
assert.deepEqual(initial.capabilityGrants, {}, 'legacy app-wide sends require reconfirmation')
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

setFakePreferencesWriteUnavailable(false)
for (const scheme of ['qdn', 'qortal']) {
  const app = `${scheme}://APP/Chat/Chat`
  assert.equal(await hasQdnAppCapability(app, 'chat.send'), false)
  assert.equal(await hasQdnAccountCapability(app, 'wallet:A', 'chat.send'), false)
  await assert.rejects(grantQdnAppCapabilityPermission(app, 'chat.send'), /requires an account/)
  await grantQdnAccountCapabilityPermission(app, 'wallet:A', 'chat.send')
  assert.equal(await hasQdnAccountCapability(app, 'wallet:A', 'chat.send'), true)
  assert.equal(await hasQdnAccountCapability(app, 'wallet:B', 'chat.send'), false)
  const persisted = sanitizeQdnAppRolesStore(JSON.parse(readFakePreference()!))
  assert.equal(storeHoldsQdnAccountCapability(persisted, app, 'wallet:A', 'chat.send'), true)
  assert.equal(storeHoldsQdnAccountCapability(persisted, app, 'wallet:B', 'chat.send'), false)
  assert.equal(persisted.capabilityGrants[app]?.['chat.send'], undefined)
  await grantQdnAccountCapabilityPermission(app, 'wallet:B', 'chat.send')
  await revokeQdnAccountCapabilityPermission(app, 'wallet:A', 'chat.send', (await getQdnAppRolesStore()).revision)
  assert.equal(await hasQdnAccountCapability(app, 'wallet:A', 'chat.send'), false)
  assert.equal(await hasQdnAccountCapability(app, 'wallet:B', 'chat.send'), true)
}

console.log('Native QDN assignment-store management tests passed.')
