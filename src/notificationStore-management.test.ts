import assert from 'node:assert/strict'
import {
  inspectLocalNotificationStore,
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

console.log('Native notification-store management tests passed.')
