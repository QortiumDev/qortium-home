import type { WidgetManifest, WidgetSize } from './widget-manifest.js'

// Turns a size an app asked for into one the manifest permits. Pure, because
// this decides whether a resizable widget can be driven outside its own
// declared bounds and that is worth testing without a window on screen.
//
// The axis rules come from `resizable`: an axis the manifest froze keeps the
// size the widget currently has, no matter what the app asks for. An app cannot
// widen itself by declaring `vertical` and then requesting a new width.
export function clampWidgetSize(
  manifest: WidgetManifest,
  current: WidgetSize,
  requested: Partial<WidgetSize>,
): WidgetSize {
  const canResizeWidth = manifest.resizable === 'both' || manifest.resizable === 'horizontal'
  const canResizeHeight = manifest.resizable === 'both' || manifest.resizable === 'vertical'

  const width = canResizeWidth ? pick(requested.width, current.width) : current.width
  const height = canResizeHeight ? pick(requested.height, current.height) : current.height

  return {
    width: clamp(width, manifest.minSize.width, manifest.maxSize.width),
    height: clamp(height, manifest.minSize.height, manifest.maxSize.height),
  }
}

function pick(requested: unknown, fallback: number): number {
  // Anything that is not a usable number leaves the axis where it is, rather
  // than collapsing the widget to NaN or zero.
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return fallback
  return Math.round(requested)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
