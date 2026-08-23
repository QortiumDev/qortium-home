import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHomeV2NotificationPolicyHandlers } from './home-v2-notification-policy-bridge.js'
import { createHomeV2NotificationPolicyFile } from './home-v2-notification-policy-file.js'

const root = await mkdtemp(path.join(os.tmpdir(), 'qortium-notification-policy-bridge-'))
try {
  const calls: string[] = []
  const broadcasts: Array<{ channel: string; value: unknown }> = []
  let gate = true
  let authorized = false
  const handlers = createHomeV2NotificationPolicyHandlers({
    assertAuthorized() {
      calls.push('authorize')
      if (!authorized) throw new Error('unauthorized')
    },
    broadcast(channel, value) {
      calls.push('broadcast')
      broadcasts.push({ channel, value })
    },
    setAuthoritativeGate(enabled) {
      calls.push('gate')
      gate = enabled
    },
    storage: createHomeV2NotificationPolicyFile(() => path.join(root, 'policy.json')),
  })
  const event = {} as Electron.IpcMainInvokeEvent

  await assert.rejects(handlers.get(event), /unauthorized/)
  calls.length = 0
  await assert.rejects(handlers.set(event, null), /unauthorized/)
  assert.deepEqual(calls, ['authorize'])

  authorized = true
  const initial = await handlers.get(event)
  assert.equal(initial.enabled, true)
  calls.length = 0
  await assert.rejects(handlers.set(event, { enabled: false }), /malformed/)
  assert.deepEqual(calls, ['authorize'])

  calls.length = 0
  const changed = await handlers.set(event, { enabled: false, expectedGeneration: 0 })
  assert.equal(changed.enabled, false)
  assert.equal(changed.generation, 1)
  assert.equal(gate, false)
  assert.deepEqual(calls, ['authorize', 'gate', 'broadcast'])
  assert.equal(broadcasts.length, 1)
  assert.equal(broadcasts[0]?.channel, 'home-v2-notification-policy:changed')
  assert.deepEqual(broadcasts[0]?.value, changed)

  calls.length = 0
  const noOp = await handlers.set(event, { enabled: false, expectedGeneration: 1 })
  assert.equal(noOp.generation, 1)
  assert.deepEqual(calls, ['authorize'])
  assert.equal(broadcasts.length, 1)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('Home 2 notification policy bridge tests passed.')
