import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseWidgetManifest } from './widget-manifest.js'
import { normalizeRegion } from './widget-region.js'
import { shouldIgnoreMouse } from './widget-hit-testing.js'

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../test-fixtures/widget-app/widget.json',
)
const manifest = parseWidgetManifest(readFileSync(fixturePath, 'utf8'))

assert.equal(manifest.defaultSize.width, 280)
assert.equal(manifest.defaultSize.height, 120)
assert.equal(manifest.resizable, 'both')

const region = normalizeRegion(manifest.shape)
assert.notEqual(region, null)

// Place the widget at a known screen position and probe the corners of the
// pentagon the fixture declares.
const bounds = { x: 500, y: 300, width: 280, height: 120 }

// Top-left is inside the shape, so the window must accept clicks there.
assert.equal(shouldIgnoreMouse(bounds, region, { x: 510, y: 310 }), false)

// Dead centre is inside too.
assert.equal(shouldIgnoreMouse(bounds, region, { x: 640, y: 360 }), false)

// The bottom-left corner is clipped away by the pentagon, so clicks there must
// fall through to whatever application is behind the widget.
assert.equal(shouldIgnoreMouse(bounds, region, { x: 503, y: 418 }), true)

// Same for the bottom-right corner.
assert.equal(shouldIgnoreMouse(bounds, region, { x: 777, y: 418 }), true)

// The bottom centre point survives, because the pentagon comes to a point there.
assert.equal(shouldIgnoreMouse(bounds, region, { x: 640, y: 418 }), false)

// Anywhere outside the window is always ignored.
assert.equal(shouldIgnoreMouse(bounds, region, { x: 100, y: 100 }), true)

console.log('widget-launch tests passed')
