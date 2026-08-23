import assert from 'node:assert/strict'
import {
  getDefaultHomeV2AppUpdatePreferences,
  getHomeV2AutomaticUpdateAction,
  parseHomeV2AppUpdatePreferences,
  serializeHomeV2AppUpdatePreferences,
} from './app-update-preferences'

assert.deepEqual(getDefaultHomeV2AppUpdatePreferences('2.1.0'), {
  homeUpdatePolicy: 'notify',
  releaseChannel: 'stable',
})
assert.equal(getDefaultHomeV2AppUpdatePreferences('2.1.0-preview.1').releaseChannel, 'prerelease')

assert.deepEqual(
  parseHomeV2AppUpdatePreferences(JSON.stringify({
    downloadedUpdate: { filePath: '/must/not/be/read' },
    homeUpdatePolicy: 'auto-download',
    releaseChannel: 'prerelease',
  })),
  { homeUpdatePolicy: 'auto-download', releaseChannel: 'prerelease' },
)
assert.throws(
  () => parseHomeV2AppUpdatePreferences('{"homeUpdatePolicy":"invalid"}', '2.1.0'),
  /malformed/,
)
assert.throws(
  () => parseHomeV2AppUpdatePreferences('x'.repeat(16 * 1024 + 1), '2.1.0-preview.2'),
  /malformed/,
)
assert.deepEqual(parseHomeV2AppUpdatePreferences(null, '2.1.0'), {
  homeUpdatePolicy: 'notify',
  releaseChannel: 'stable',
})
assert.deepEqual(parseHomeV2AppUpdatePreferences(JSON.stringify({
  downloadedUpdate: null,
  homeUpdatePolicy: 'auto-download',
  releaseChannel: null,
}), '2.1.0-preview.2'), {
  homeUpdatePolicy: 'auto-download',
  releaseChannel: 'prerelease',
})

const serialized = JSON.parse(serializeHomeV2AppUpdatePreferences({
  homeUpdatePolicy: 'off',
  releaseChannel: 'stable',
}))
assert.deepEqual(serialized, {
  downloadedUpdate: null,
  homeUpdatePolicy: 'off',
  releaseChannel: 'stable',
  revision: 1,
  schema: 'home-v2-app-update-preferences',
})

assert.equal(getHomeV2AutomaticUpdateAction('off'), 'none')
assert.equal(getHomeV2AutomaticUpdateAction('notify'), 'check')
assert.equal(getHomeV2AutomaticUpdateAction('auto-download'), 'check-and-download')

console.log('Home 2 app update preference tests passed.')
