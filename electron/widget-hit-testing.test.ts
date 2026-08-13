import assert from 'node:assert/strict'
import { normalizeRegion } from './widget-region.js'
import { shouldIgnoreMouse } from './widget-hit-testing.js'

const bounds = { x: 100, y: 200, width: 200, height: 100 }
const leftHalf = normalizeRegion({ polygons: [[[0, 0], [0.5, 0], [0.5, 1], [0, 1]]] })

// Cursor over the opaque left half: the window must accept clicks.
assert.equal(shouldIgnoreMouse(bounds, leftHalf, { x: 150, y: 250 }), false)

// Cursor over the transparent right half: clicks fall through.
assert.equal(shouldIgnoreMouse(bounds, leftHalf, { x: 280, y: 250 }), true)

// Cursor outside the window entirely: ignore, so we never steal clicks from
// another application.
assert.equal(shouldIgnoreMouse(bounds, leftHalf, { x: 50, y: 50 }), true)
assert.equal(shouldIgnoreMouse(bounds, leftHalf, { x: 400, y: 250 }), true)

// No declared region means the whole window is live.
assert.equal(shouldIgnoreMouse(bounds, null, { x: 280, y: 250 }), false)
assert.equal(shouldIgnoreMouse(bounds, null, { x: 50, y: 50 }), true)

// A zero-area window can never be clickable and must not divide by zero.
assert.equal(shouldIgnoreMouse({ x: 0, y: 0, width: 0, height: 0 }, null, { x: 0, y: 0 }), true)

console.log('widget-hit-testing tests passed')
