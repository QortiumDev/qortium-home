import assert from 'node:assert/strict'
import {
  DEFAULT_HOME_V2_NOTIFICATION_POLICY,
  encodeStoredHomeV2NotificationPolicy,
  failedClosedHomeV2NotificationPolicy,
  parseHomeV2NotificationPolicyMutation,
  parseStoredHomeV2NotificationPolicy,
} from './home-v2-notification-policy-codec.js'

const stored = {
  enabled: false,
  generation: 7,
  schema: 'qortium-home-v2-notification-policy',
  version: 1,
} as const

assert.deepEqual(parseStoredHomeV2NotificationPolicy(stored), {
  ...stored,
  status: 'available',
})
assert.deepEqual(encodeStoredHomeV2NotificationPolicy({
  ...stored,
  status: 'available',
}), stored)
assert.deepEqual(DEFAULT_HOME_V2_NOTIFICATION_POLICY, {
  enabled: true,
  generation: 0,
  schema: 'qortium-home-v2-notification-policy',
  status: 'available',
  version: 1,
})
assert.deepEqual(failedClosedHomeV2NotificationPolicy('corrupt'), {
  enabled: false,
  generation: null,
  schema: 'qortium-home-v2-notification-policy',
  status: 'corrupt',
  version: 1,
})

for (const invalid of [
  null,
  [],
  { ...stored, extra: true },
  { ...stored, schema: 'wrong' },
  { ...stored, version: 2 },
  { ...stored, generation: -1 },
  { ...stored, generation: Number.MAX_SAFE_INTEGER + 1 },
  { ...stored, generation: 1.5 },
  { ...stored, enabled: 1 },
]) {
  assert.throws(() => parseStoredHomeV2NotificationPolicy(invalid))
}

assert.deepEqual(parseHomeV2NotificationPolicyMutation({
  enabled: true,
  expectedGeneration: 3,
}), { enabled: true, expectedGeneration: 3 })
for (const invalid of [
  null,
  { enabled: true },
  { enabled: true, expectedGeneration: 0, extra: true },
  { enabled: 'true', expectedGeneration: 0 },
  { enabled: true, expectedGeneration: -1 },
  { enabled: true, expectedGeneration: 1.5 },
]) {
  assert.throws(() => parseHomeV2NotificationPolicyMutation(invalid))
}

console.log('Home 2 notification policy codec tests passed.')
