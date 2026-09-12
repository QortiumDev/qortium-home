import assert from 'node:assert/strict'
import { parseStoredHomeV2AppUpdateSettings } from './home-v2-app-update-settings-codec.js'

// A version 1 file (before the release source existed) reads as the default source.
const storedV1 = {
  generation: 4,
  homeUpdatePolicy: 'auto-download',
  releaseChannel: 'prerelease',
  schema: 'qortium-home-v2-app-update-settings',
  version: 1,
}
assert.deepEqual(parseStoredHomeV2AppUpdateSettings(storedV1), {
  generation: 4,
  homeUpdatePolicy: 'auto-download',
  releaseChannel: 'prerelease',
  releaseSource: 'qdn-then-github',
})
// Version 2 carries it, exactly.
const storedV2 = { ...storedV1, releaseSource: 'github', version: 2 }
assert.equal(parseStoredHomeV2AppUpdateSettings(storedV2).releaseSource, 'github')
assert.throws(() => parseStoredHomeV2AppUpdateSettings({ ...storedV1, version: 2 }), /unexpected/, 'v2 without the source')
assert.throws(() => parseStoredHomeV2AppUpdateSettings({ ...storedV1, releaseSource: 'github' }), /unexpected/, 'v1 with the source')
assert.throws(() => parseStoredHomeV2AppUpdateSettings({ ...storedV2, releaseSource: 'ftp' }), /malformed/)
assert.throws(() => parseStoredHomeV2AppUpdateSettings({ ...storedV2, version: 3 }), /malformed/)
assert.throws(() => parseStoredHomeV2AppUpdateSettings({ ...storedV1, extra: true }), /unexpected/)
assert.throws(
  () => parseStoredHomeV2AppUpdateSettings({ ...storedV1, generation: Number.MAX_SAFE_INTEGER }),
  /malformed/,
)

console.log('Home 2 app update settings codec tests passed.')
