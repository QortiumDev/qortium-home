import type { WidgetShape } from './widget-manifest.js'

export type WidgetRegion = {
  readonly polygons: readonly (readonly (readonly [number, number])[])[]
}

const EDGE_EPSILON = 1e-9

export function normalizeRegion(shape: WidgetShape | null): WidgetRegion | null {
  if (!shape) return null
  const polygons = shape.polygons.filter((polygon) => polygon.length >= 3)
  // An empty region would make the widget entirely click-through and therefore
  // impossible to interact with. Treat it as "no region declared" instead.
  if (polygons.length === 0) return null
  return { polygons }
}

function isPointOnSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): boolean {
  const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax)
  if (Math.abs(cross) > EDGE_EPSILON) return false
  return (
    px >= Math.min(ax, bx) - EDGE_EPSILON &&
    px <= Math.max(ax, bx) + EDGE_EPSILON &&
    py >= Math.min(ay, by) - EDGE_EPSILON &&
    py <= Math.max(ay, by) + EDGE_EPSILON
  )
}

// Standard ray casting, with an explicit on-edge check first. Without that
// check a click exactly on a widget's border is ambiguous, and users do click
// borders, so we resolve it as inside.
function isPointInPolygon(
  polygon: readonly (readonly [number, number])[],
  x: number,
  y: number,
): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (isPointOnSegment(x, y, xi, yi, xj, yj)) return true
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

export function isPointInRegion(region: WidgetRegion | null, x: number, y: number): boolean {
  if (!region) return true
  return region.polygons.some((polygon) => isPointInPolygon(polygon, x, y))
}
