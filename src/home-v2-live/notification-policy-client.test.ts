import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createHomeV2NotificationPolicyClient,
  createPortableHomeV2NotificationPolicyAdapter,
  HOME_V2_NOTIFICATION_POLICY_KEY,
  HOME_V2_NOTIFICATION_POLICY_SCHEMA,
  LEGACY_DISPLAY_SETTINGS_KEY,
  parseHomeV2NotificationPolicyState,
} from './notification-policy-client'

const available = {
  enabled: true,
  generation: 0,
  schema: HOME_V2_NOTIFICATION_POLICY_SCHEMA,
  status: 'available',
  version: 1,
} as const

assert.deepEqual(parseHomeV2NotificationPolicyState(available), available)
assert.throws(
  () => parseHomeV2NotificationPolicyState({ ...available, path: '/secret' }),
  /malformed/,
)
assert.throws(
  () => parseHomeV2NotificationPolicyState({ ...available, generation: -1 }),
  /malformed/,
)
assert.throws(
  () => parseHomeV2NotificationPolicyState({ ...available, status: 'corrupt' }),
  /malformed/,
)

function fixture(initial: Readonly<Record<string, string>> = {}) {
  const values = new Map(Object.entries(initial))
  const reads = new Map<string, number>()
  let failWrite = false
  const adapter = createPortableHomeV2NotificationPolicyAdapter({
    async getPreference(key) {
      reads.set(key, (reads.get(key) ?? 0) + 1)
      return values.get(key) ?? null
    },
    async setPreference(key, value) {
      if (failWrite) throw new Error('write failed')
      values.set(key, value)
    },
  })
  return {
    client: createHomeV2NotificationPolicyClient(adapter),
    reads,
    setFailWrite(value: boolean) {
      failWrite = value
    },
    values,
  }
}

const migrated = fixture({
  [LEGACY_DISPLAY_SETTINGS_KEY]: JSON.stringify({ appNotifications: false }),
})
assert.deepEqual(await migrated.client.get(), { ...available, enabled: false })
assert.equal(
  JSON.parse(migrated.values.get(HOME_V2_NOTIFICATION_POLICY_KEY) ?? '').enabled,
  false,
)
await migrated.client.get()
assert.equal(
  migrated.reads.get(LEGACY_DISPLAY_SETTINGS_KEY),
  1,
  'legacy display settings are read only while the v2 policy is absent',
)

const defaults = fixture()
assert.deepEqual(await defaults.client.get(), available)

const unavailable = createHomeV2NotificationPolicyClient(
  createPortableHomeV2NotificationPolicyAdapter({
    async getPreference() {
      throw new Error('read failed')
    },
    async setPreference() {
      throw new Error('write should not be attempted')
    },
  }),
)
assert.deepEqual(await unavailable.get(), {
  ...available,
  enabled: false,
  generation: null,
  status: 'unavailable',
})

const corrupt = fixture({
  [HOME_V2_NOTIFICATION_POLICY_KEY]: '{"enabled":true}',
  [LEGACY_DISPLAY_SETTINGS_KEY]: JSON.stringify({ appNotifications: true }),
})
assert.deepEqual(await corrupt.client.get(), {
  ...available,
  enabled: false,
  generation: null,
  status: 'corrupt',
})
assert.equal(corrupt.reads.get(LEGACY_DISPLAY_SETTINGS_KEY), undefined)

const mutable = fixture({
  [HOME_V2_NOTIFICATION_POLICY_KEY]: JSON.stringify({
    enabled: true,
    generation: 3,
    schema: HOME_V2_NOTIFICATION_POLICY_SCHEMA,
    version: 1,
  }),
})
let changes = 0
const unsubscribe = mutable.client.subscribe(() => changes += 1)
assert.deepEqual(
  await mutable.client.set({ enabled: false, expectedGeneration: 3 }),
  { ...available, enabled: false, generation: 4 },
)
assert.equal(changes, 1)
assert.deepEqual(
  await mutable.client.set({ enabled: false, expectedGeneration: 4 }),
  { ...available, enabled: false, generation: 4 },
)
assert.equal(changes, 1, 'no-op writes do not broadcast or advance generation')
await assert.rejects(
  mutable.client.set({ enabled: true, expectedGeneration: 3 }),
  /changed/,
)
mutable.setFailWrite(true)
await assert.rejects(
  mutable.client.set({ enabled: true, expectedGeneration: 4 }),
  /write failed/,
)
mutable.setFailWrite(false)
assert.deepEqual(await mutable.client.get(), {
  ...available,
  enabled: false,
  generation: 4,
})
unsubscribe()

const exhausted = fixture({
  [HOME_V2_NOTIFICATION_POLICY_KEY]: JSON.stringify({
    enabled: true,
    generation: Number.MAX_SAFE_INTEGER,
    schema: HOME_V2_NOTIFICATION_POLICY_SCHEMA,
    version: 1,
  }),
})
await assert.rejects(
  exhausted.client.set({
    enabled: false,
    expectedGeneration: Number.MAX_SAFE_INTEGER,
  }),
  /generation is exhausted/,
)
assert.equal(
  JSON.parse(exhausted.values.get(HOME_V2_NOTIFICATION_POLICY_KEY) ?? '').enabled,
  true,
)

const liveSource = await readFile('src/home-v2-live/HomeV2LiveApp.tsx', 'utf8')
assert.equal(
  liveSource.includes('loadDisplaySettings'),
  false,
  'Home 2 notification delivery must not consult the legacy display-settings store',
)

console.log('Home 2 notification policy client tests passed.')
