import assert from 'node:assert/strict'
import {
  createAuthorizedHomeV2AppUpdateSettingsHandlers,
  createHomeV2AppUpdateSettingsService,
} from './home-v2-app-update-settings-contract.js'
import type { StoredHomeV2AppUpdateSettings } from './home-v2-app-update-settings-codec.js'

let settings: StoredHomeV2AppUpdateSettings = {
  generation: 0,
  homeUpdatePolicy: 'notify',
  releaseChannel: 'stable',
}
const service = createHomeV2AppUpdateSettingsService({
  read: async () => settings,
  write: async (expectedGeneration, next) => {
    assert.equal(expectedGeneration, settings.generation)
    settings = { ...next, generation: settings.generation + 1 }
    return settings
  },
})

const getRequest = { revision: 1, schema: 'home-v2-app-update-settings-get-request' }
assert.deepEqual(await service.get(getRequest), {
  ...settings,
  revision: 1,
  schema: 'home-v2-app-update-settings',
})
await assert.rejects(service.get({ ...getRequest, path: '/tmp/no' }), /exact/)

const next = await service.set({
  expectedGeneration: 0,
  revision: 1,
  schema: 'home-v2-app-update-settings-set-request',
  settings: { homeUpdatePolicy: 'auto-download', releaseChannel: 'prerelease' },
})
assert.equal(next.generation, 1)
assert.equal(next.homeUpdatePolicy, 'auto-download')
const claimRequest = { revision: 1, schema: 'home-v2-app-update-automatic-claim-request' }
const concurrentClaims = await Promise.all([
  service.claimAutomatic(claimRequest),
  service.claimAutomatic(claimRequest),
])
assert.equal(concurrentClaims.filter((claim) => claim.claimed).length, 1)
assert.equal(concurrentClaims[0].generation, 1)
assert.equal((await service.claimAutomatic(claimRequest)).claimed, false)
await assert.rejects(service.claimAutomatic({ ...claimRequest, extra: true }), /exact/)
await assert.rejects(
  service.set({
    expectedGeneration: 1,
    revision: 1,
    schema: 'home-v2-app-update-settings-set-request',
    settings: { homeUpdatePolicy: 'install', releaseChannel: 'stable' },
  }),
  /valid/,
)

let authorized = false
const handlers = createAuthorizedHomeV2AppUpdateSettingsHandlers(() => { authorized = true }, service)
await handlers.get({} as never, getRequest)
assert.equal(authorized, true)
authorized = false
await handlers.claimAutomatic({} as never, claimRequest)
assert.equal(authorized, true)

console.log('Home 2 app update settings contract tests passed.')
