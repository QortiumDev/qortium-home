import assert from 'node:assert/strict'
import {
  clampRectToDisplays,
  displayForRect,
  snapWidgetBounds,
  WIDGET_SNAP_THRESHOLD_PX,
} from './widget-snapping.js'

const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const secondary = { x: 1920, y: 0, width: 1280, height: 1000 }
const displays = [primary, secondary]

const size = { width: 280, height: 120 }
const at = (x: number, y: number) => ({ x, y, ...size })

// Nothing near an edge is left exactly where the drag put it.
const free = snapWidgetBounds(at(600, 500), displays)
assert.deepEqual(free.bounds, at(600, 500))
assert.deepEqual(free.edges, [])

// Inside the threshold on the left snaps flush.
const left = snapWidgetBounds(at(WIDGET_SNAP_THRESHOLD_PX - 2, 500), displays)
assert.equal(left.bounds.x, 0)
assert.deepEqual(left.edges, ['left'])

// Just outside the threshold does not.
assert.equal(snapWidgetBounds(at(WIDGET_SNAP_THRESHOLD_PX + 1, 500), displays).bounds.x, WIDGET_SNAP_THRESHOLD_PX + 1)

// The right edge snaps by the widget's far edge, not its origin.
const right = snapWidgetBounds(at(primary.width - size.width - 3, 500), displays)
assert.equal(right.bounds.x, primary.width - size.width)
assert.deepEqual(right.edges, ['right'])

// Top and bottom behave the same way, and a corner reports both edges.
const corner = snapWidgetBounds(at(4, primary.height - size.height - 4), displays)
assert.deepEqual(corner.bounds, at(0, primary.height - size.height))
assert.deepEqual(corner.edges.slice().sort(), ['bottom', 'left'])

// Snapping is to the work area, so a widget lands above the taskbar rather
// than behind it.
const shortened = [{ x: 0, y: 0, width: 1920, height: 1000 }]
assert.equal(snapWidgetBounds(at(600, 1000 - size.height + 5), shortened).bounds.y, 1000 - size.height)

// A widget mostly on the second display snaps to that display's edges, not the
// primary's.
const onSecondary = snapWidgetBounds({ x: 1925, y: 400, ...size }, displays)
assert.equal(onSecondary.bounds.x, secondary.x)
assert.deepEqual(onSecondary.edges, ['left'])

// The far edge of the second display is offset by its origin.
const secondaryRight = snapWidgetBounds(
  { x: secondary.x + secondary.width - size.width - 2, y: 400, ...size },
  displays,
)
assert.equal(secondaryRight.bounds.x, secondary.x + secondary.width - size.width)

// displayForRect picks the display holding most of the widget.
assert.deepEqual(displayForRect({ x: 1800, y: 100, width: 200, height: 100 }, displays), primary)
assert.deepEqual(displayForRect({ x: 1900, y: 100, width: 200, height: 100 }, displays), secondary)
assert.equal(displayForRect(at(0, 0), []), null)

// Widget-to-widget snapping only applies when the two overlap on the other
// axis, so widgets in opposite corners never pull on each other.
const neighbour = { x: 900, y: 480, width: 200, height: 160 }
const beside = snapWidgetBounds(at(900 - size.width - 4, 500), displays, [neighbour])
assert.equal(beside.bounds.x, neighbour.x - size.width, 'should sit flush against the neighbour')

const distant = snapWidgetBounds(at(900 - size.width - 4, 50), displays, [neighbour])
assert.equal(distant.bounds.x, 900 - size.width - 4, 'no shared rows means no horizontal snap')

// Stacking vertically works the same way.
const stacked = snapWidgetBounds({ x: 910, y: neighbour.y + neighbour.height + 5, ...size }, displays, [neighbour])
assert.equal(stacked.bounds.y, neighbour.y + neighbour.height)

// A screen edge wins over a widget edge at the same distance, because the
// screen edge is what the user is usually aiming for.
const hugging = { x: 8, y: 480, width: 200, height: 160 }
const contested = snapWidgetBounds(at(6, 500), displays, [hugging])
assert.equal(contested.bounds.x, 0)

// A zero-area window cannot snap and must not divide by anything.
assert.deepEqual(
  snapWidgetBounds({ x: 10, y: 10, width: 0, height: 0 }, displays).edges,
  [],
)

// With no displays at all nothing moves, rather than snapping to the origin.
assert.deepEqual(snapWidgetBounds(at(600, 500), []).bounds, at(600, 500))

// Restoring a placement onto a display that is still there leaves it alone.
assert.deepEqual(clampRectToDisplays(at(600, 500), displays), at(600, 500))

// A placement saved on a monitor that has since been unplugged is pulled back
// onto a connected one rather than stranded off-screen.
const stranded = clampRectToDisplays({ x: 3000, y: 200, ...size }, [primary])
assert.ok(stranded.x + stranded.width <= primary.x + primary.width)
assert.ok(stranded.x >= primary.x)
assert.equal(stranded.width, size.width)

// Negative coordinates from a monitor that used to sit to the left are pulled
// back the same way.
const negative = clampRectToDisplays({ x: -2000, y: -900, ...size }, [primary])
assert.ok(negative.x >= primary.x)
assert.ok(negative.y >= primary.y)

// A widget partly off the edge but still touching a display is left as it is:
// the user put it there deliberately.
const overhanging = { x: primary.width - 40, y: 300, ...size }
assert.deepEqual(clampRectToDisplays(overhanging, displays), overhanging)

// A widget larger than the only display is shrunk to fit rather than left
// hanging off it.
const tiny = [{ x: 0, y: 0, width: 200, height: 100 }]
const shrunk = clampRectToDisplays({ x: 900, y: 900, ...size }, tiny)
assert.equal(shrunk.width, 200)
assert.equal(shrunk.height, 100)

// With no displays reported at all, leave the rectangle untouched rather than
// inventing a position.
assert.deepEqual(clampRectToDisplays(at(600, 500), []), at(600, 500))

console.log('widget-snapping tests passed')
