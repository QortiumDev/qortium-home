import { WIDGET_SIZE_MAX, WIDGET_SIZE_MIN } from './widget-manifest.js'

// Where a widget was last left, remembered per published app so it comes back
// in the same place next time Home starts.
//
// Kept free of Electron so the parsing and eviction rules run headless.
// electron/widget-store.ts holds the file I/O around them.

export const WIDGET_PLACEMENT_MAX_BYTES = 64 * 1024
// Enough that a user's real set of widgets is never evicted, small enough that
// a runaway app cannot grow the file without bound.
export const WIDGET_PLACEMENT_MAX_ENTRIES = 64
export const WIDGET_PLACEMENT_COORDINATE_LIMIT = 100_000

export type WidgetPlacement = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly opacity: number
  readonly updatedAt: number
}

export type WidgetPlacements = Readonly<Record<string, WidgetPlacement>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readCoordinate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const rounded = Math.round(value)
  if (Math.abs(rounded) > WIDGET_PLACEMENT_COORDINATE_LIMIT) return null
  return rounded
}

function readSide(value: unknown): number | null {
  const side = readCoordinate(value)
  if (side === null || side < WIDGET_SIZE_MIN || side > WIDGET_SIZE_MAX) return null
  return side
}

function readPlacement(value: unknown): WidgetPlacement | null {
  if (!isRecord(value)) return null
  const x = readCoordinate(value.x)
  const y = readCoordinate(value.y)
  const width = readSide(value.width)
  const height = readSide(value.height)
  if (x === null || y === null || width === null || height === null) return null

  const opacity = typeof value.opacity === 'number' && Number.isFinite(value.opacity)
    ? Math.min(1, Math.max(0, value.opacity))
    : 1
  const updatedAt = typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
    ? value.updatedAt
    : 0

  return { x, y, width, height, opacity, updatedAt }
}

/**
 * Reads a stored placement set, dropping anything that does not parse.
 *
 * Unlike the widget manifest, a bad entry here is skipped rather than failing
 * the whole read: this is Home's own cache of where a window sat, not a
 * contract an app wrote, and losing one remembered position is a far better
 * outcome than refusing to open any widget at all.
 */
export function parseWidgetPlacements(raw: unknown): WidgetPlacements {
  const source = typeof raw === 'string' ? safeParse(raw) : raw
  if (!isRecord(source) || !isRecord(source.placements)) return {}

  const placements: Record<string, WidgetPlacement> = {}
  for (const [key, value] of Object.entries(source.placements)) {
    if (!key || key.length > 2_000) continue
    const placement = readPlacement(value)
    if (placement) placements[key] = placement
  }
  return placements
}

function safeParse(raw: string): unknown {
  if (Buffer.byteLength(raw, 'utf8') > WIDGET_PLACEMENT_MAX_BYTES) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

/**
 * Adds or replaces one placement, evicting the least recently updated entries
 * once the store is full.
 */
export function putWidgetPlacement(
  placements: WidgetPlacements,
  key: string,
  placement: WidgetPlacement,
): WidgetPlacements {
  const merged: Record<string, WidgetPlacement> = { ...placements, [key]: placement }
  const keys = Object.keys(merged)
  if (keys.length <= WIDGET_PLACEMENT_MAX_ENTRIES) return merged

  const kept = keys
    .sort((left, right) => merged[right].updatedAt - merged[left].updatedAt)
    .slice(0, WIDGET_PLACEMENT_MAX_ENTRIES)
  const trimmed: Record<string, WidgetPlacement> = {}
  for (const name of kept) trimmed[name] = merged[name]
  return trimmed
}

export function serializeWidgetPlacements(placements: WidgetPlacements): string {
  return JSON.stringify({ version: 1, placements })
}

