import assert from 'node:assert/strict'
import { parseWidgetManifest, WIDGET_MANIFEST_MAX_BYTES } from './widget-manifest.js'

const minimal = { manifestVersion: 1, defaultSize: { width: 275, height: 116 } }

// A minimal manifest fills in documented defaults.
const parsed = parseWidgetManifest(JSON.stringify(minimal))
assert.equal(parsed.entry, 'widget.html')
assert.equal(parsed.resizable, 'none')
assert.equal(parsed.defaultSize.width, 275)
assert.equal(parsed.defaultSize.height, 116)
assert.equal(parsed.minSize.width, 275)
assert.equal(parsed.maxSize.width, 275)
assert.equal(parsed.shape, null)

// Explicit fields are preserved.
const full = parseWidgetManifest(JSON.stringify({
  manifestVersion: 1,
  entry: 'player.html',
  defaultSize: { width: 275, height: 116 },
  minSize: { width: 275, height: 14 },
  maxSize: { width: 550, height: 232 },
  resizable: 'both',
  shape: { polygons: [[[0, 0], [1, 0], [1, 1]]] },
}))
assert.equal(full.entry, 'player.html')
assert.equal(full.resizable, 'both')
assert.equal(full.minSize.height, 14)
assert.deepEqual(full.shape, { polygons: [[[0, 0], [1, 0], [1, 1]]] })

// Rejection is total. Every one of these must throw.
const rejected: readonly [string, unknown][] = [
  ['not an object', 42],
  ['missing version', { defaultSize: { width: 100, height: 100 } }],
  ['unknown version', { manifestVersion: 2, defaultSize: { width: 100, height: 100 } }],
  ['missing defaultSize', { manifestVersion: 1 }],
  ['size below floor', { manifestVersion: 1, defaultSize: { width: 4, height: 100 } }],
  ['size above ceiling', { manifestVersion: 1, defaultSize: { width: 9000, height: 100 } }],
  ['non-integer size', { manifestVersion: 1, defaultSize: { width: 10.5, height: 100 } }],
  ['bad resizable', { manifestVersion: 1, defaultSize: { width: 100, height: 100 }, resizable: 'diagonal' }],
  ['absolute entry', { manifestVersion: 1, defaultSize: { width: 100, height: 100 }, entry: '/etc/passwd' }],
  ['traversing entry', { manifestVersion: 1, defaultSize: { width: 100, height: 100 }, entry: '../secrets.html' }],
  ['url entry', { manifestVersion: 1, defaultSize: { width: 100, height: 100 }, entry: 'https://evil.test/a.html' }],
  ['backslash entry', { manifestVersion: 1, defaultSize: { width: 100, height: 100 }, entry: 'a\\..\\b.html' }],
  ['min above max', {
    manifestVersion: 1,
    defaultSize: { width: 100, height: 100 },
    minSize: { width: 200, height: 100 },
    maxSize: { width: 150, height: 100 },
  }],
  ['default below min', {
    manifestVersion: 1,
    defaultSize: { width: 50, height: 100 },
    minSize: { width: 100, height: 100 },
  }],
]

for (const [label, value] of rejected) {
  assert.throws(
    () => parseWidgetManifest(JSON.stringify(value)),
    Error,
    `expected rejection: ${label}`,
  )
}

// Malformed JSON is rejected, not tolerated.
assert.throws(() => parseWidgetManifest('{'), Error)

// Oversized input is rejected before parsing.
const huge = `{"manifestVersion":1,"pad":"${'x'.repeat(WIDGET_MANIFEST_MAX_BYTES)}"}`
assert.throws(() => parseWidgetManifest(huge), /too large/i)

console.log('widget-manifest tests passed')
