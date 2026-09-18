import assert from 'node:assert/strict'
import {
  DEFAULT_HOME_V2_REMOTE_DEBUGGING,
  createHomeV2RemoteDebuggingClient,
  parseHomeV2RemoteDebuggingState,
} from './remote-debugging-client'

// --- defaults -------------------------------------------------------------------

assert.deepEqual(DEFAULT_HOME_V2_REMOTE_DEBUGGING, { alwaysOn: false, enabled: false })

// --- parsing what the host reports ----------------------------------------------

assert.deepEqual(
  parseHomeV2RemoteDebuggingState({ alwaysOn: false, enabled: true }),
  { alwaysOn: false, enabled: true },
  'a well-formed state round-trips',
)

// Junk must never leave the switch stuck: every unusable value falls back to
// off, field by field.
for (const junk of [null, undefined, 0, '', 'enabled', [], [{ enabled: true }], true]) {
  assert.deepEqual(
    parseHomeV2RemoteDebuggingState(junk),
    DEFAULT_HOME_V2_REMOTE_DEBUGGING,
    `unusable host state (${JSON.stringify(junk)}) falls back to off`,
  )
}

assert.deepEqual(
  parseHomeV2RemoteDebuggingState({ alwaysOn: 'yes', enabled: true }),
  { alwaysOn: false, enabled: true },
  'one malformed field does not discard the other',
)

assert.deepEqual(
  parseHomeV2RemoteDebuggingState({ alwaysOn: true, enabled: false }),
  { alwaysOn: true, enabled: true },
  'a debuggable build is always on, whatever the stored switch says',
)

// --- the client -------------------------------------------------------------------

{
  const calls: unknown[] = []
  let stored = false
  const client = createHomeV2RemoteDebuggingClient({
    async getState() {
      calls.push('get')
      return { alwaysOn: false, enabled: stored }
    },
    async setEnabled(request) {
      calls.push(request)
      stored = request.enabled
      return { alwaysOn: false, enabled: stored }
    },
  })

  assert.deepEqual(await client.get(), { alwaysOn: false, enabled: false }, 'reads start off')
  assert.deepEqual(await client.set(true), { alwaysOn: false, enabled: true }, 'set returns the new state')
  assert.deepEqual(await client.get(), { alwaysOn: false, enabled: true }, 'the host now reports on')
  assert.deepEqual(await client.set(false), { alwaysOn: false, enabled: false }, 'set off returns off')
  assert.deepEqual(calls, ['get', { enabled: true }, 'get', { enabled: false }], 'each call reaches the host once')
}

{
  const client = createHomeV2RemoteDebuggingClient({
    async getState() {
      return 'garbage'
    },
    async setEnabled() {
      throw new Error('host refused')
    },
  })
  assert.deepEqual(await client.get(), DEFAULT_HOME_V2_REMOTE_DEBUGGING, 'a garbage read shows off')
  await assert.rejects(client.set(true), /host refused/, 'a failed write rethrows so the row can report it')
}

console.log('remote-debugging-client tests passed')
