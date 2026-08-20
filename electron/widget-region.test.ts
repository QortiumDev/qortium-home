import assert from 'node:assert/strict'
import { isPointInRegion, normalizeRegion } from './widget-region.js'

const square = normalizeRegion({ polygons: [[[0, 0], [1, 0], [1, 1], [0, 1]]] })

// Interior and exterior.
assert.equal(isPointInRegion(square, 0.5, 0.5), true)
assert.equal(isPointInRegion(square, 1.5, 0.5), false)
assert.equal(isPointInRegion(square, -0.1, 0.5), false)

// Edges and corners count as inside, so a widget stays clickable at its border.
assert.equal(isPointInRegion(square, 0, 0), true)
assert.equal(isPointInRegion(square, 1, 1), true)
assert.equal(isPointInRegion(square, 0.5, 0), true)

// A null region means the whole rectangle is clickable.
assert.equal(isPointInRegion(null, 0.5, 0.5), true)
assert.equal(isPointInRegion(null, 0.99, 0.01), true)

// An empty polygon list degrades to fully clickable rather than fully dead,
// so a bad manifest can never produce an unclickable invisible window.
assert.equal(isPointInRegion(normalizeRegion({ polygons: [] }), 0.5, 0.5), true)

// A triangle: inside near the base, outside above the hypotenuse.
const triangle = normalizeRegion({ polygons: [[[0, 0], [1, 0], [0, 1]]] })
assert.equal(isPointInRegion(triangle, 0.1, 0.1), true)
assert.equal(isPointInRegion(triangle, 0.9, 0.9), false)

// Two disjoint polygons are both live.
const split = normalizeRegion({
  polygons: [
    [[0, 0], [0.4, 0], [0.4, 1], [0, 1]],
    [[0.6, 0], [1, 0], [1, 1], [0.6, 1]],
  ],
})
assert.equal(isPointInRegion(split, 0.2, 0.5), true)
assert.equal(isPointInRegion(split, 0.5, 0.5), false)
assert.equal(isPointInRegion(split, 0.8, 0.5), true)

console.log('widget-region tests passed')
