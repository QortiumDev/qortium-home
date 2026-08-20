import assert from 'node:assert/strict'
import {
  parseWidgetPlacements,
  putWidgetPlacement,
  serializeWidgetPlacements,
  WIDGET_PLACEMENT_COORDINATE_LIMIT,
  WIDGET_PLACEMENT_MAX_ENTRIES,
  type WidgetPlacement,
} from './widget-placement.js'

function placement(overrides: Partial<WidgetPlacement> = {}): WidgetPlacement {
  return { x: 100, y: 200, width: 280, height: 120, opacity: 1, updatedAt: 10, ...overrides }
}

const key = 'qdn://APP/Radio/default'

// A round trip preserves everything.
const stored = serializeWidgetPlacements({ [key]: placement() })
assert.deepEqual(parseWidgetPlacements(stored), { [key]: placement() })

// Nothing usable in, nothing out. None of these may throw: a corrupt cache of
// window positions must never stop a widget opening.
for (const junk of ['', '{', 'null', '42', '[]', '{"placements":42}', null, undefined, 7]) {
  assert.deepEqual(parseWidgetPlacements(junk), {}, `expected ${String(junk)} to parse as empty`)
}

// A single bad entry is dropped while the good ones survive. This is the
// opposite of how the manifest is treated, and deliberately so: this is Home's
// own cache, not a contract an app wrote.
const mixed = parseWidgetPlacements(JSON.stringify({
  version: 1,
  placements: {
    good: placement(),
    missingSize: { x: 1, y: 2 },
    nanCoordinate: { x: NaN, y: 2, width: 100, height: 100 },
    infiniteCoordinate: { x: Infinity, y: 2, width: 100, height: 100 },
    stringCoordinate: { x: '10', y: 2, width: 100, height: 100 },
    tinyWidth: { x: 1, y: 2, width: 1, height: 100 },
    hugeWidth: { x: 1, y: 2, width: 99_999, height: 100 },
    farAway: { x: WIDGET_PLACEMENT_COORDINATE_LIMIT + 1, y: 2, width: 100, height: 100 },
    notAnObject: 'nope',
  },
}))
assert.deepEqual(Object.keys(mixed), ['good'])

// Fractional coordinates land on whole pixels rather than being rejected.
const rounded = parseWidgetPlacements(JSON.stringify({
  placements: { a: { x: 10.6, y: -3.2, width: 280.4, height: 120.5 } },
}))
assert.deepEqual(rounded.a, { x: 11, y: -3, width: 280, height: 121, opacity: 1, updatedAt: 0 })

// Negative coordinates are legitimate: a monitor can sit left of or above the
// primary one.
const negative = parseWidgetPlacements(JSON.stringify({
  placements: { a: { x: -1600, y: -200, width: 280, height: 120 } },
}))
assert.equal(negative.a?.x, -1600)

// Opacity is clamped into range and defaults to fully opaque.
assert.equal(parseWidgetPlacements(JSON.stringify({
  placements: { a: { x: 1, y: 1, width: 100, height: 100, opacity: 5 } },
})).a?.opacity, 1)
assert.equal(parseWidgetPlacements(JSON.stringify({
  placements: { a: { x: 1, y: 1, width: 100, height: 100, opacity: -2 } },
})).a?.opacity, 0)
assert.equal(parseWidgetPlacements(JSON.stringify({
  placements: { a: { x: 1, y: 1, width: 100, height: 100 } },
})).a?.opacity, 1)

// An absurd key is skipped rather than stored.
assert.deepEqual(
  parseWidgetPlacements(JSON.stringify({ placements: { ['x'.repeat(5000)]: placement() } })),
  {},
)

// Writing an entry replaces the previous one for that app.
const replaced = putWidgetPlacement({ [key]: placement() }, key, placement({ x: 900, updatedAt: 20 }))
assert.equal(Object.keys(replaced).length, 1)
assert.equal(replaced[key].x, 900)

// The store is capped, evicting whatever was updated longest ago.
let many: Record<string, WidgetPlacement> = {}
for (let i = 0; i < WIDGET_PLACEMENT_MAX_ENTRIES + 10; i += 1) {
  many = { ...putWidgetPlacement(many, `app-${i}`, placement({ updatedAt: i })) }
}
const keys = Object.keys(many)
assert.equal(keys.length, WIDGET_PLACEMENT_MAX_ENTRIES)
assert.ok(keys.includes(`app-${WIDGET_PLACEMENT_MAX_ENTRIES + 9}`), 'the newest entry must survive')
assert.ok(!keys.includes('app-0'), 'the oldest entry must be evicted')

console.log('widget-placement tests passed')
