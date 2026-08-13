import assert from 'node:assert/strict'
import {
  buildWidgetManifestPath,
  buildWidgetRenderUrl,
  discoverWidgetManifest,
} from './widget-discovery.js'

// qdn-views.ts only accepts a render URL shaped /render/<SERVICE>/<name>/...
// on the node's own origin. Anything else is refused and the widget opens
// empty, so the exact shape matters.
assert.equal(
  buildWidgetRenderUrl('http://127.0.0.1:24891', 'Q-Player', 'widget.html'),
  'http://127.0.0.1:24891/render/APP/Q-Player/widget.html',
)
assert.equal(
  buildWidgetRenderUrl('http://127.0.0.1:24891', 'My App', 'sub/dir/player.html'),
  'http://127.0.0.1:24891/render/APP/My%20App/sub/dir/player.html',
)
// A trailing slash on the origin must not produce a doubled slash, which would
// shift every path segment and fail validation.
assert.equal(
  buildWidgetRenderUrl('http://127.0.0.1:24891/', 'Q-Player', 'widget.html'),
  'http://127.0.0.1:24891/render/APP/Q-Player/widget.html',
)
assert.throws(() => buildWidgetRenderUrl('', 'Q-Player', 'widget.html'), Error)
assert.throws(() => buildWidgetRenderUrl('http://127.0.0.1:24891', '', 'widget.html'), Error)
assert.throws(() => buildWidgetRenderUrl('http://127.0.0.1:24891', 'Q-Player', ''), Error)

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
