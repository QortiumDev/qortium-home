import assert from 'node:assert/strict'
import { parseWidgetManifest, type WidgetResizable } from './widget-manifest.js'
import { clampWidgetSize } from './widget-sizing.js'

function manifest(resizable: WidgetResizable) {
  return parseWidgetManifest(JSON.stringify({
    manifestVersion: 1,
    defaultSize: { width: 280, height: 120 },
    minSize: { width: 200, height: 60 },
    maxSize: { width: 560, height: 240 },
    resizable,
  }))
}

const both = manifest('both')
const current = { width: 280, height: 120 }

// A size inside the declared bounds is honoured exactly.
assert.deepEqual(clampWidgetSize(both, current, { width: 400, height: 200 }), { width: 400, height: 200 })

// Beyond the bounds it is clamped rather than rejected, so a widget dragged
// past its limit stops at the limit instead of doing nothing.
assert.deepEqual(clampWidgetSize(both, current, { width: 9000, height: 9000 }), { width: 560, height: 240 })
assert.deepEqual(clampWidgetSize(both, current, { width: 1, height: 1 }), { width: 200, height: 60 })

// An omitted axis keeps the size the widget already has.
assert.deepEqual(clampWidgetSize(both, current, { width: 300 }), { width: 300, height: 120 })
assert.deepEqual(clampWidgetSize(both, current, {}), current)

// Fractional requests land on whole pixels.
assert.deepEqual(clampWidgetSize(both, current, { width: 300.6, height: 150.2 }), { width: 301, height: 150 })

// Nonsense leaves the axis alone rather than collapsing the widget.
for (const bad of [NaN, Infinity, -Infinity, '400', null, undefined, {}]) {
  assert.deepEqual(
    clampWidgetSize(both, current, { width: bad as number }),
    current,
    `expected ${String(bad)} to be ignored`,
  )
}

// A frozen axis cannot be moved, however the request is dressed up. This is
// what stops an app widening itself past what its own manifest declared.
const horizontalOnly = manifest('horizontal')
assert.deepEqual(
  clampWidgetSize(horizontalOnly, current, { width: 400, height: 240 }),
  { width: 400, height: 120 },
)

const verticalOnly = manifest('vertical')
assert.deepEqual(
  clampWidgetSize(verticalOnly, current, { width: 400, height: 240 }),
  { width: 280, height: 240 },
)

const fixed = manifest('none')
assert.deepEqual(clampWidgetSize(fixed, current, { width: 400, height: 240 }), current)

// A frozen axis is still clamped into the manifest's own bounds, so a widget
// that somehow drifted outside them is brought back rather than pinned there.
assert.deepEqual(
  clampWidgetSize(fixed, { width: 9000, height: 10 }, {}),
  { width: 560, height: 60 },
)

console.log('widget-sizing tests passed')
