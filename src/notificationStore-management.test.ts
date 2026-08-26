import assert from 'node:assert/strict'
import {
  inspectLocalNotificationStore,
  inspectNotificationStoreForManagement,
  readNotificationStoreForManagement,
  updateNotificationStore,
} from './notificationStore'
import {
  readFakePreference,
  setFakePreference,
  setFakePreferencesUnavailable,
  setFakePreferencesWriteUnavailable,
} from './v2/test-kit/fake-capacitor-preferences'

Object.assign(globalThis, { window: { qortiumHome: {} } })

setFakePreference('{not-json')
assert.deepEqual(await inspectLocalNotificationStore(), {
  status: 'corrupt',
  store: null,
})
await assert.rejects(
  updateNotificationStore((store) => store),
  (error: unknown) =>
    (error as { code?: unknown }).code === 'HOME_NOTIFICATION_STORE_CORRUPT',
)
assert.equal(readFakePreference(), '{not-json', 'a corrupt native store must not be overwritten')

setFakePreferencesUnavailable(true)
assert.deepEqual(await inspectLocalNotificationStore(), {
  status: 'unavailable',
  store: null,
})

setFakePreferencesUnavailable(false)
setFakePreference(' '.repeat((4 * 1024 * 1024) + 1))
assert.deepEqual(await inspectLocalNotificationStore(), {
  status: 'corrupt',
  store: null,
})

setFakePreference(null)
assert.deepEqual(await inspectLocalNotificationStore(), {
  status: 'available',
  store: { grants: {}, revision: 0, rules: {}, version: 1 },
})
setFakePreferencesWriteUnavailable(true)
await assert.rejects(
  updateNotificationStore((store) => {
    store.grants['qdn://APP/Ghost/Ghost'] = {
      grantedAt: '2026-08-22T12:00:00.000Z',
    }
  }, 0),
  /Preferences unavailable/,
)
assert.equal(
  (await inspectLocalNotificationStore()).store?.grants['qdn://APP/Ghost/Ghost'],
  undefined,
  'a failed native write must not update the in-memory store',
)
setFakePreferencesWriteUnavailable(false)
const updated = await updateNotificationStore((store) => {
  store.grants['qdn://APP/Notify/Notify'] = {
    grantedAt: '2026-08-22T12:00:00.000Z',
  }
})
assert.equal(updated.revision, 1)
assert.match(readFakePreference() ?? '', /qdn:\/\/APP\/Notify\/Notify/)

// ---------------------------------------------------------------------------
// Warm-cache regression suite.
//
// The module keeps `cachedLocalStore` so the notification hot paths (the rule
// watcher's timer, and the grant/mute checks every SHOW_NOTIFICATION makes) do
// not pay an async Preferences read per call. Review reproduced the failure
// that cache caused for the MANAGER surface: once one healthy read had warmed
// it, a backing record that later went corrupt or unreadable was still reported
// as healthy, and a mutation compared its expectedRevision against the CACHED
// revision before writing over the damaged bytes.
//
// Every case below therefore warms the cache first and then changes the backing
// record behind the module's back — which is exactly what `setFakePreference`
// does, since it writes the fake store directly rather than through the module.
// ---------------------------------------------------------------------------

const grantedAt = '2026-08-22T12:00:00.000Z'
const notifyApp = 'qdn://APP/Notify/Notify'
const ghostApp = 'qdn://APP/Ghost/Ghost'
const healthyBacking = JSON.stringify({
  grants: { [notifyApp]: { grantedAt } },
  revision: 4,
  rules: {},
  version: 1,
})
const corruptBacking = '{not-json'

function hasCode(code: string) {
  return (error: unknown) => (error as { code?: unknown }).code === code
}

/**
 * Points the backing record at `backing`, then leaves the cache genuinely warm
 * from it — asserting that the cheap path really is answering from cache, so a
 * later "the manager rejected it" assertion cannot pass vacuously.
 */
async function warmCacheFrom(backing: string) {
  setFakePreferencesUnavailable(false)
  setFakePreference(backing)
  const synced = await inspectNotificationStoreForManagement()
  assert.equal(synced.status, 'available', 'the fixture backing record must be healthy')
  assert.deepEqual(await inspectLocalNotificationStore(), synced, 'the cache must now be warm')
  return synced
}

// (a) Warm cache, then the backing record goes corrupt: a manager read rejects.
await warmCacheFrom(healthyBacking)
setFakePreference(corruptBacking)
// The cheap path still answers from the warm cache. That is not a bug — it is
// precisely the trap, and the reason the manager must not use this path.
assert.equal(
  (await inspectLocalNotificationStore()).status,
  'available',
  'the cheap cached path is expected to still answer; the manager must not use it',
)
assert.deepEqual(
  await inspectNotificationStoreForManagement(),
  { status: 'corrupt', store: null },
  'a manager inspection must re-read the backing record, not the cache',
)
await warmCacheFrom(healthyBacking)
setFakePreference(corruptBacking)
await assert.rejects(
  readNotificationStoreForManagement(),
  hasCode('HOME_NOTIFICATION_STORE_CORRUPT'),
  'a manager read must fail closed on a corrupt backing record even with a warm cache',
)

// (b) Warm cache, corrupt backing: a mutation refuses and preserves the bytes.
// The expectedRevision here is the one the CACHE holds, so before the fix the
// compare-and-set passed and the write clobbered the damaged record.
await warmCacheFrom(healthyBacking)
setFakePreference(corruptBacking)
await assert.rejects(
  updateNotificationStore((store) => {
    store.grants[ghostApp] = { grantedAt }
  }, 4),
  hasCode('HOME_NOTIFICATION_STORE_CORRUPT'),
  'a mutation must fail closed on a corrupt backing record even with a warm cache',
)
assert.equal(
  readFakePreference(),
  corruptBacking,
  'a refused mutation must leave the corrupt backing record byte for byte',
)

// (c) Warm cache, then the backing store becomes unreadable.
await warmCacheFrom(healthyBacking)
setFakePreferencesUnavailable(true)
assert.deepEqual(
  await inspectNotificationStoreForManagement(),
  { status: 'unavailable', store: null },
  'a manager inspection must report an unreadable backing store',
)
await warmCacheFrom(healthyBacking)
setFakePreferencesUnavailable(true)
await assert.rejects(
  readNotificationStoreForManagement(),
  hasCode('HOME_NOTIFICATION_STORE_UNAVAILABLE'),
)
await warmCacheFrom(healthyBacking)
setFakePreferencesUnavailable(true)
await assert.rejects(
  updateNotificationStore((store) => {
    store.grants[ghostApp] = { grantedAt }
  }, 4),
  hasCode('HOME_NOTIFICATION_STORE_UNAVAILABLE'),
)
setFakePreferencesUnavailable(false)
assert.equal(
  readFakePreference(),
  healthyBacking,
  'a refused mutation must leave the backing record untouched',
)

// The other half of the same finding: a backing record that moved on outside
// this module is now visible to the compare-and-set instead of being masked by
// the cached revision.
const advancedBacking = JSON.stringify({
  grants: { [notifyApp]: { grantedAt } },
  revision: 9,
  rules: {},
  version: 1,
})
await warmCacheFrom(healthyBacking)
setFakePreference(advancedBacking)
await assert.rejects(
  updateNotificationStore((store) => {
    store.grants[ghostApp] = { grantedAt }
  }, 4),
  hasCode('HOME_DATA_STALE'),
  'a mutation carrying the cached revision must lose to a backing record that moved on',
)
assert.equal(
  readFakePreference(),
  advancedBacking,
  'a stale mutation must not overwrite a backing record that moved on',
)
const applied = await updateNotificationStore((store) => {
  store.grants[ghostApp] = { grantedAt }
}, 9)
assert.equal(applied.revision, 10, 'naming the real backing revision must succeed')
assert.match(readFakePreference() ?? '', /qdn:\/\/APP\/Ghost\/Ghost/)

// (d) An empty but healthy record still works, cold and warm. "I cannot read
// this" must stay distinguishable from "you have granted nothing".
setFakePreferencesUnavailable(true)
assert.deepEqual(
  await inspectNotificationStoreForManagement(),
  { status: 'unavailable', store: null },
  'this failed strict read leaves the cache cold for the checks below',
)
setFakePreferencesUnavailable(false)
setFakePreference(null)
const emptyStore = { grants: {}, revision: 0, rules: {}, version: 1 }
assert.deepEqual(await readNotificationStoreForManagement(), emptyStore, 'cold read of an empty store')
assert.deepEqual(await readNotificationStoreForManagement(), emptyStore, 'warm read of an empty store')
assert.deepEqual(
  await inspectLocalNotificationStore(),
  { status: 'available', store: emptyStore },
  'the cheap path agrees once the cache is warm again',
)

console.log('Native notification-store management tests passed.')
