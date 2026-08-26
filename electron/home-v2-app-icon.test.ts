import assert from 'node:assert/strict'
import {
  buildHomeV2AppIconPath,
  getHomeV2AppIconContentType,
  normalizeHomeV2AppIconReadRequest,
} from './home-v2-app-icon.js'

assert.deepEqual(
  normalizeHomeV2AppIconReadRequest({ identifier: null, name: 'Chat', service: 'APP' }),
  { identifier: null, name: 'Chat', service: 'APP' },
)
assert.equal(
  buildHomeV2AppIconPath({ identifier: null, name: 'Chat', service: 'APP' }),
  '/arbitrary/APP/Chat?filepath=favicon.ico&async=true',
)
assert.equal(
  buildHomeV2AppIconPath({ identifier: 'Main app', name: 'Alice Smith', service: 'WEBSITE' }),
  '/arbitrary/WEBSITE/Alice%20Smith/Main%20app?filepath=favicon.ico&async=true',
)
// R4-4: GAME joined APP and WEBSITE. Home opens all three browser-archive
// services as app tabs, and every tab surface asks this path for the
// resource's favicon.ico, so a GAME icon must resolve rather than throw.
assert.deepEqual(
  normalizeHomeV2AppIconReadRequest({ identifier: 'Arena', name: 'Arena', service: 'game' }),
  { identifier: 'Arena', name: 'Arena', service: 'GAME' },
)
assert.equal(
  buildHomeV2AppIconPath({ identifier: 'Arena', name: 'Arena', service: 'GAME' }),
  '/arbitrary/GAME/Arena/Arena?filepath=favicon.ico&async=true',
)
// Viewer services are still refused: they have no app-tab icon surface.
assert.throws(
  () => normalizeHomeV2AppIconReadRequest({ identifier: null, name: 'Gallery', service: 'IMAGE' }),
  /APP, WEBSITE, or GAME/,
)
assert.throws(
  () => normalizeHomeV2AppIconReadRequest({ identifier: '../bad', name: '', service: 'APP' }),
  /App resource name/,
)
assert.equal(
  getHomeV2AppIconContentType(Uint8Array.from([0, 0, 1, 0, 1, 0])),
  'image/vnd.microsoft.icon',
)
assert.equal(
  getHomeV2AppIconContentType(Uint8Array.from([0x3c, 0x73, 0x76, 0x67])),
  null,
)

console.log('Home v2 app icon contract tests passed.')
