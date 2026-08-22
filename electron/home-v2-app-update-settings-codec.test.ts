import assert from 'node:assert/strict'
import { parseStoredHomeV2AppUpdateSettings } from './home-v2-app-update-settings-codec.js'

const stored = {
  generation: 4,
  homeUpdatePolicy: 'auto-download',
  releaseChannel: 'prerelease',
  schema: 'qortium-home-v2-app-update-settings',
  version: 1,
}
assert.deepEqual(parseStoredHomeV2AppUpdateSettings(stored), {
  generation: 4,
  homeUpdatePolicy: 'auto-download',
  releaseChannel: 'prerelease',
})
assert.throws(() => parseStoredHomeV2AppUpdateSettings({ ...stored, version: 2 }), /malformed/)
assert.throws(() => parseStoredHomeV2AppUpdateSettings({ ...stored, extra: true }), /unexpected/)
assert.throws(
  () => parseStoredHomeV2AppUpdateSettings({ ...stored, generation: Number.MAX_SAFE_INTEGER }),
  /malformed/,
)

console.log('Home 2 app update settings codec tests passed.')
