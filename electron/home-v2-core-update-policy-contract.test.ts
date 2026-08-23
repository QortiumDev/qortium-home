import assert from 'node:assert/strict'
import {
  createAuthorizedHomeV2CoreUpdatePolicyHandlers,
  createHomeV2CoreUpdatePolicyService,
} from './home-v2-core-update-policy-contract.js'
import type { HomeV2CoreUpdatePolicySettings } from './home-v2-core-update-policy-codec.js'

let settings: HomeV2CoreUpdatePolicySettings = {
  coreUpdatePolicy: 'notify',
  generation: 2,
  javaUpdatePolicy: 'off',
  qortalUpdatePolicy: 'notify',
  storageIssue: null,
}
let triggers = 0
const activity = {
  checkedAt: null,
  core: { channel: null, state: 'idle' as const, version: null },
  generation: 2,
  issue: null,
  java: { state: 'idle' as const, version: null },
  qortal: { state: 'idle' as const, version: null },
}
const service = createHomeV2CoreUpdatePolicyService({
  getActivity: () => activity,
  read: async () => settings,
  replace: async (expectedGeneration, next) => {
    if (expectedGeneration !== settings.generation) {
      const error = new Error('conflict')
      Object.assign(error, { code: 'SETTINGS_CHANGED' })
      throw error
    }
    settings = { ...next, generation: settings.generation + 1, storageIssue: null }
    return settings
  },
  trigger: () => { triggers += 1 },
})

const getRequest = { revision: 1, schema: 'home-v2-core-update-policy-get-request' }
const initial = await service.get(getRequest)
assert.deepEqual(Object.keys(initial).sort(), [
  'activity',
  'coreUpdatePolicy',
  'generation',
  'javaUpdatePolicy',
  'qortalUpdatePolicy',
  'revision',
  'schema',
  'settingsIssue',
])
const changed = await service.set({
  expectedGeneration: 2,
  field: 'coreUpdatePolicy',
  revision: 1,
  schema: 'home-v2-core-update-policy-set-request',
  value: 'install',
})
assert.equal(changed.outcome, 'saved')
assert.equal(changed.state.coreUpdatePolicy, 'install')
assert.equal(changed.state.javaUpdatePolicy, 'off')
assert.equal(changed.state.qortalUpdatePolicy, 'notify')
assert.equal(changed.state.generation, 3)
assert.equal(changed.state.activity.generation, 3)
assert.equal(triggers, 1)
const conflict = await service.set({
  expectedGeneration: 2,
  field: 'javaUpdatePolicy',
  revision: 1,
  schema: 'home-v2-core-update-policy-set-request',
  value: 'notify',
})
assert.equal(conflict.outcome, 'conflict')
assert.equal(conflict.state.generation, 3)
await assert.rejects(service.get({ ...getRequest, extra: true }), /exact/)

let authorized = false
let reads = 0
const handlers = createAuthorizedHomeV2CoreUpdatePolicyHandlers(
  () => {
    if (!authorized) throw new Error('unauthorized')
  },
  createHomeV2CoreUpdatePolicyService({
    getActivity: () => activity,
    read: async () => { reads += 1; return settings },
    replace: async () => settings,
    trigger: () => undefined,
  }),
)
assert.throws(() => handlers.get({} as never, getRequest), /unauthorized/)
assert.equal(reads, 0)
authorized = true
await handlers.get({} as never, getRequest)
assert.equal(reads, 1)

const failing = createHomeV2CoreUpdatePolicyService({
  getActivity: () => activity,
  read: async () => { throw new Error('/private/host/path/update-policy.json') },
  replace: async () => { throw new Error('unreachable') },
  trigger: () => undefined,
})
await assert.rejects(failing.get(getRequest), (error: Error & { code?: string }) => {
  assert.equal(error.code, 'SETTINGS_UNAVAILABLE')
  assert.equal(error.message, 'Core update policy settings are unavailable.')
  assert.doesNotMatch(error.message, /private|path/i)
  return true
})

console.log('Home 2 Core update policy contract tests passed.')
