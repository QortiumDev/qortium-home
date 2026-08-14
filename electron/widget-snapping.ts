// Screen-edge and widget-to-widget snapping, kept pure so multi-display
// geometry can be tested without plugging in a monitor.
//
// Everything here works in screen coordinates. Displays are described by their
// work area rather than their full bounds, so a widget snaps to the top of the
// taskbar instead of underneath it.

export const WIDGET_SNAP_THRESHOLD_PX = 12

export type SnapRect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type SnapEdge = 'left' | 'right' | 'top' | 'bottom'

export type SnapResult = {
  readonly bounds: SnapRect
  readonly edges: readonly SnapEdge[]
}

function overlaps(a: SnapRect, b: SnapRect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function area(rect: SnapRect) {
  return Math.max(0, rect.width) * Math.max(0, rect.height)
}

function intersectionArea(a: SnapRect, b: SnapRect) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

/**
 * The display a widget mostly sits on. Falls back to the first display, because
 * a widget dragged entirely off every screen still has to snap somewhere
 * rather than being left stranded.
 */
export function displayForRect(
  rect: SnapRect,
  workAreas: readonly SnapRect[],
): SnapRect | null {
  if (workAreas.length === 0) return null
  let best = workAreas[0]
  let bestOverlap = -1
  for (const workArea of workAreas) {
    const overlap = intersectionArea(rect, workArea)
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      best = workArea
    }
  }
  return best
}

type Candidate = { readonly edge: SnapEdge; readonly value: number; readonly distance: number }

function nearest(candidates: readonly Candidate[]): Candidate | null {
  let best: Candidate | null = null
  for (const candidate of candidates) {
    if (candidate.distance > WIDGET_SNAP_THRESHOLD_PX) continue
    if (!best || candidate.distance < best.distance) best = candidate
  }
  return best
}

/**
 * Snaps a dragged widget to the edges of its display and to any other widget it
 * is close to. Screen edges win ties, because they are the anchor the user is
 * usually aiming for.
 *
 * `others` are the rectangles of the other live widgets. A widget only snaps to
 * another widget it actually overlaps along the perpendicular axis, so two
 * widgets at opposite corners of a display never pull on each other.
 */
export function snapWidgetBounds(
  bounds: SnapRect,
  workAreas: readonly SnapRect[],
  others: readonly SnapRect[] = [],
): SnapResult {
  const display = displayForRect(bounds, workAreas)
  if (!display || area(bounds) === 0) return { bounds, edges: [] }

  const horizontal: Candidate[] = [
    { edge: 'left', value: display.x, distance: Math.abs(bounds.x - display.x) },
    {
      edge: 'right',
      value: display.x + display.width - bounds.width,
      distance: Math.abs(bounds.x + bounds.width - (display.x + display.width)),
    },
  ]
  const vertical: Candidate[] = [
    { edge: 'top', value: display.y, distance: Math.abs(bounds.y - display.y) },
    {
      edge: 'bottom',
      value: display.y + display.height - bounds.height,
      distance: Math.abs(bounds.y + bounds.height - (display.y + display.height)),
    },
  ]

  for (const other of others) {
    const sharesRows = bounds.y < other.y + other.height && bounds.y + bounds.height > other.y
    const sharesColumns = bounds.x < other.x + other.width && bounds.x + bounds.width > other.x

    if (sharesRows) {
      // Right edge of the other widget against our left edge, and vice versa.
      horizontal.push({
        edge: 'left',
        value: other.x + other.width,
        distance: Math.abs(bounds.x - (other.x + other.width)),
      })
      horizontal.push({
        edge: 'right',
        value: other.x - bounds.width,
        distance: Math.abs(bounds.x + bounds.width - other.x),
      })
    }
    if (sharesColumns) {
      vertical.push({
        edge: 'top',
        value: other.y + other.height,
        distance: Math.abs(bounds.y - (other.y + other.height)),
      })
      vertical.push({
        edge: 'bottom',
        value: other.y - bounds.height,
        distance: Math.abs(bounds.y + bounds.height - other.y),
      })
    }
  }

  const snapX = nearest(horizontal)
  const snapY = nearest(vertical)
  const edges: SnapEdge[] = []
  if (snapX) edges.push(snapX.edge)
  if (snapY) edges.push(snapY.edge)

  return {
    bounds: {
      x: snapX ? Math.round(snapX.value) : bounds.x,
      y: snapY ? Math.round(snapY.value) : bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
    edges,
  }
}

/**
 * Pulls a widget back onto a connected display. Placement restore uses this so
 * that unplugging a monitor between sessions does not strand a widget somewhere
 * the user cannot reach it.
 */
export function clampRectToDisplays(
  rect: SnapRect,
  workAreas: readonly SnapRect[],
): SnapRect {
  if (workAreas.length === 0) return rect
  if (workAreas.some((workArea) => overlaps(rect, workArea))) return rect

  const display = displayForRect(rect, workAreas) ?? workAreas[0]
  const width = Math.min(rect.width, display.width)
  const height = Math.min(rect.height, display.height)
  return {
    width,
    height,
    x: Math.round(Math.min(Math.max(rect.x, display.x), display.x + display.width - width)),
    y: Math.round(Math.min(Math.max(rect.y, display.y), display.y + display.height - height)),
  }
}
