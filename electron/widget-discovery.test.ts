import assert from 'node:assert/strict'
import { buildWidgetManifestPath, discoverWidgetManifest } from './widget-discovery.js'

// The manifest lives beside the app's other published files.
assert.equal(
  buildWidgetManifestPath('Q-Player'),
  '/arbitrary/APP/Q-Player/widget.json',
)
assert.equal(
  buildWidgetManifestPath('My App'),
  '/arbitrary/APP/My%20App/widget.json',
)
assert.throws(() => buildWidgetManifestPath(''), Error)
assert.throws(() => buildWidgetManifestPath('a'.repeat(200)), Error)

const manifestJson = JSON.stringify({
  manifestVersion: 1,
  defaultSize: { width: 275, height: 116 },
})

// A present, valid manifest resolves.
const found = await discoverWidgetManifest('Q-Player', async () => ({
  ok: true,
  status: 200,
  text: manifestJson,
}))
assert.equal(found?.defaultSize.width, 275)

// A missing manifest is "no widget face", not an error.
const missing = await discoverWidgetManifest('Q-Player', async () => ({
  ok: false,
  status: 404,
  text: '',
}))
assert.equal(missing, null)

// A malformed manifest is a hard error. It must never launch with guessed
// defaults, matching how Home treats malformed account data.
await assert.rejects(
  discoverWidgetManifest('Q-Player', async () => ({ ok: true, status: 200, text: 'nope' })),
  /not valid JSON/,
)

// Any other transport failure is an error too.
await assert.rejects(
  discoverWidgetManifest('Q-Player', async () => ({ ok: false, status: 500, text: '' })),
  /HTTP 500/,
)

console.log('widget-discovery tests passed')
