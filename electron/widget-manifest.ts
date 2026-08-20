export const WIDGET_MANIFEST_MAX_BYTES = 64 * 1024
// Low enough to permit a Winamp-style windowshade strip, which is around 14px
// tall, while still refusing the degenerate sizes that would make an
// always-on-top window effectively invisible.
export const WIDGET_SIZE_MIN = 8
export const WIDGET_SIZE_MAX = 4096
export const WIDGET_MAX_POLYGONS = 32
export const WIDGET_MAX_VERTICES = 256

export type WidgetSize = { readonly width: number; readonly height: number }
export type WidgetResizable = 'none' | 'horizontal' | 'vertical' | 'both'
export type WidgetShape = {
  readonly polygons: readonly (readonly (readonly [number, number])[])[]
}

export type WidgetManifest = {
  readonly manifestVersion: 1
  readonly entry: string
  readonly defaultSize: WidgetSize
  readonly minSize: WidgetSize
  readonly maxSize: WidgetSize
  readonly resizable: WidgetResizable
  readonly shape: WidgetShape | null
}

const RESIZABLE_VALUES: readonly WidgetResizable[] = ['none', 'horizontal', 'vertical', 'both']

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readSize(value: unknown, label: string): WidgetSize {
  if (!isRecord(value)) throw new Error(`${label} must be an object with width and height.`)
  const width = value.width
  const height = value.height
  for (const [name, side] of [['width', width], ['height', height]] as const) {
    if (!Number.isSafeInteger(side)) {
      throw new Error(`${label}.${name} must be a whole number of pixels.`)
    }
    if ((side as number) < WIDGET_SIZE_MIN || (side as number) > WIDGET_SIZE_MAX) {
      throw new Error(
        `${label}.${name} must be between ${WIDGET_SIZE_MIN} and ${WIDGET_SIZE_MAX} pixels.`,
      )
    }
  }
  return { width: width as number, height: height as number }
}

// The entry must stay inside the published app resource. Reject anything that
// could escape it or point somewhere else entirely, rather than trying to
// normalise a hostile path into a safe one.
function readEntry(value: unknown): string {
  if (value === undefined) return 'widget.html'
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('entry must be a non-empty relative path.')
  }
  const entry = value.trim()
  if (
    entry.startsWith('/') ||
    entry.includes('\\') ||
    entry.includes('..') ||
    entry.includes(':')
  ) {
    throw new Error('entry must be a relative path inside the app resource.')
  }
  return entry
}

// Exported because WIDGET_SET_REGIONS validates a runtime region update with
// exactly these rules. An app must not be able to use the runtime path to
// declare a shape its manifest would have been rejected for.
export function parseWidgetShape(value: unknown): WidgetShape | null {
  if (value === undefined || value === null) return null
  if (!isRecord(value) || !Array.isArray(value.polygons)) {
    throw new Error('shape must be an object with a polygons array.')
  }
  if (value.polygons.length > WIDGET_MAX_POLYGONS) {
    throw new Error(`shape.polygons may contain at most ${WIDGET_MAX_POLYGONS} polygons.`)
  }
  const polygons = value.polygons.map((polygon) => {
    if (!Array.isArray(polygon) || polygon.length < 3) {
      throw new Error('Each polygon needs at least three points.')
    }
    if (polygon.length > WIDGET_MAX_VERTICES) {
      throw new Error(`Each polygon may contain at most ${WIDGET_MAX_VERTICES} points.`)
    }
    return polygon.map((point) => {
      if (!Array.isArray(point) || point.length !== 2) {
        throw new Error('Each point must be a two element array.')
      }
      const [x, y] = point
      for (const axis of [x, y]) {
        if (typeof axis !== 'number' || !Number.isFinite(axis) || axis < 0 || axis > 1) {
          throw new Error('Point coordinates must be finite numbers between 0 and 1.')
        }
      }
      return [x as number, y as number] as const
    })
  })
  return { polygons }
}

export function parseWidgetManifest(raw: string): WidgetManifest {
  if (Buffer.byteLength(raw, 'utf8') > WIDGET_MANIFEST_MAX_BYTES) {
    throw new Error('The widget manifest is too large.')
  }

  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    throw new Error('The widget manifest is not valid JSON.')
  }

  if (!isRecord(value)) throw new Error('The widget manifest must be an object.')
  if (value.manifestVersion !== 1) {
    throw new Error('Unsupported widget manifestVersion. Only version 1 is understood.')
  }

  const defaultSize = readSize(value.defaultSize, 'defaultSize')
  const minSize = value.minSize === undefined ? defaultSize : readSize(value.minSize, 'minSize')
  const maxSize = value.maxSize === undefined ? defaultSize : readSize(value.maxSize, 'maxSize')

  if (minSize.width > maxSize.width || minSize.height > maxSize.height) {
    throw new Error('minSize must not exceed maxSize.')
  }
  if (
    defaultSize.width < minSize.width ||
    defaultSize.height < minSize.height ||
    defaultSize.width > maxSize.width ||
    defaultSize.height > maxSize.height
  ) {
    throw new Error('defaultSize must fall between minSize and maxSize.')
  }

  const resizable = value.resizable === undefined ? 'none' : value.resizable
  if (typeof resizable !== 'string' || !RESIZABLE_VALUES.includes(resizable as WidgetResizable)) {
    throw new Error(`resizable must be one of: ${RESIZABLE_VALUES.join(', ')}.`)
  }

  return {
    manifestVersion: 1,
    entry: readEntry(value.entry),
    defaultSize,
    minSize,
    maxSize,
    resizable: resizable as WidgetResizable,
    shape: parseWidgetShape(value.shape),
  }
}
