import assert from 'node:assert/strict'
import {
  buildWidgetManifestPath,
  buildWidgetRenderUrl,
  discoverWidgetManifest,
  parseWidgetResourceIdentity,
} from './widget-discovery.js'

// A v2 app resource address carries both the registered name and the
// identifier. Every published Q-App has both, so dropping the identifier
// addresses a different resource or none at all.
assert.deepEqual(parseWidgetResourceIdentity('qdn://APP/Qortium/Radio'), {
  name: 'Qortium',
  identifier: 'Radio',
})
assert.deepEqual(parseWidgetResourceIdentity('qortal://APP/SomeName/SomeId'), {
  name: 'SomeName',
  identifier: 'SomeId',
})
// An address with no identifier, and the "default" sentinel, both mean none.
assert.deepEqual(parseWidgetResourceIdentity('qdn://APP/Qortium'), {
  name: 'Qortium',
  identifier: null,
})
assert.deepEqual(parseWidgetResourceIdentity('qdn://APP/Qortium/default'), {
  name: 'Qortium',
  identifier: null,
})
// Percent-encoded segments decode.
assert.deepEqual(parseWidgetResourceIdentity('qdn://APP/My%20Name/My%20Id'), {
  name: 'My Name',
  identifier: 'My Id',
})
// A trailing route path after the identifier is ignored, not mistaken for one.
assert.deepEqual(parseWidgetResourceIdentity('qdn://APP/Qortium/Radio/some/page'), {
  name: 'Qortium',
  identifier: 'Radio',
})

assert.throws(() => parseWidgetResourceIdentity('https://evil.test/APP/A/B'), Error)
assert.throws(() => parseWidgetResourceIdentity('qdn://WEBSITE/A/B'), /does not identify an app/)
assert.throws(() => parseWidgetResourceIdentity('qdn://APP'), Error)
assert.throws(() => parseWidgetResourceIdentity(''), Error)
assert.throws(() => parseWidgetResourceIdentity(null), Error)

// A file inside a QDN resource is addressed by filepath query, not by path
// segment. /arbitrary/APP/<name>/<file> would read <file> as the identifier.
assert.equal(
  buildWidgetManifestPath({ name: 'Chat', identifier: 'Chat' }),
  '/arbitrary/APP/Chat/Chat?filepath=widget.json',
)
assert.equal(
  buildWidgetManifestPath({ name: 'Chat', identifier: null }),
  '/arbitrary/APP/Chat?filepath=widget.json',
)
assert.equal(
  buildWidgetManifestPath({ name: 'My App', identifier: 'My Id' }),
  '/arbitrary/APP/My%20App/My%20Id?filepath=widget.json',
)

// Render URLs do use path segments, and qdn-views only accepts this shape on
// the node's own origin.
assert.equal(
  buildWidgetRenderUrl('http://127.0.0.1:24891', { name: 'Chat', identifier: 'Chat' }, 'widget.html'),
  'http://127.0.0.1:24891/render/APP/Chat/Chat/widget.html',
)
assert.equal(
  buildWidgetRenderUrl('http://127.0.0.1:24891', { name: 'Chat', identifier: null }, 'widget.html'),
  'http://127.0.0.1:24891/render/APP/Chat/widget.html',
)
assert.equal(
  buildWidgetRenderUrl('http://127.0.0.1:24891', { name: 'Chat', identifier: 'Chat' }, 'sub/page.html'),
  'http://127.0.0.1:24891/render/APP/Chat/Chat/sub/page.html',
)
// A trailing slash on the origin must not double up and shift every segment.
assert.equal(
  buildWidgetRenderUrl('http://127.0.0.1:24891/', { name: 'Chat', identifier: 'Chat' }, 'widget.html'),
  'http://127.0.0.1:24891/render/APP/Chat/Chat/widget.html',
)
assert.throws(
  () => buildWidgetRenderUrl('', { name: 'Chat', identifier: 'Chat' }, 'widget.html'),
  Error,
)
assert.throws(
  () => buildWidgetRenderUrl('http://127.0.0.1:24891', { name: 'Chat', identifier: 'Chat' }, ''),
  Error,
)

const identity = { name: 'Qortium', identifier: 'Radio' } as const
const manifestJson = JSON.stringify({
  manifestVersion: 1,
  defaultSize: { width: 275, height: 116 },
})

// A present, valid manifest resolves, and discovery asks for the right path.
let requestedPath = ''
const found = await discoverWidgetManifest(identity, async (routePath) => {
  requestedPath = routePath
  return { ok: true, status: 200, text: manifestJson }
})
assert.equal(requestedPath, '/arbitrary/APP/Qortium/Radio?filepath=widget.json')
assert.equal(found?.defaultSize.width, 275)

// A missing manifest is "no widget face", not an error. The node answers 404
// both for a missing file and for an unknown app.
const missing = await discoverWidgetManifest(identity, async () => ({
  ok: false,
  status: 404,
  text: '',
}))
assert.equal(missing, null)

// A malformed manifest is a hard error. It must never launch with guessed
// defaults, matching how Home treats malformed account data.
await assert.rejects(
  discoverWidgetManifest(identity, async () => ({ ok: true, status: 200, text: 'nope' })),
  /not valid JSON/,
)

// Any other transport failure is an error too.
await assert.rejects(
  discoverWidgetManifest(identity, async () => ({ ok: false, status: 500, text: '' })),
  /HTTP 500/,
)

console.log('widget-discovery tests passed')
