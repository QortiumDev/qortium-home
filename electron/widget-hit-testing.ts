import { isPointInRegion, type WidgetRegion } from './widget-region.js'

export type WidgetBounds = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type CursorPoint = { readonly x: number; readonly y: number }

// Returns true when the window should pass mouse input through to whatever is
// behind it. Screen coordinates in, normalised region test out.
export function shouldIgnoreMouse(
  bounds: WidgetBounds,
  region: WidgetRegion | null,
  cursor: CursorPoint,
): boolean {
  if (bounds.width <= 0 || bounds.height <= 0) return true

  const localX = cursor.x - bounds.x
  const localY = cursor.y - bounds.y
  if (localX < 0 || localY < 0 || localX > bounds.width || localY > bounds.height) {
    return true
  }

  return !isPointInRegion(region, localX / bounds.width, localY / bounds.height)
}
