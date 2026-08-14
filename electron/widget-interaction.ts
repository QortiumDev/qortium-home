import { BrowserWindow, screen, type WebContents, type WebContentsView } from 'electron'
import { parseWidgetShape } from './widget-manifest.js'
import { normalizeRegion } from './widget-region.js'
import { getWidget, type WidgetRecord } from './widget-registry.js'
import { clampWidgetSize } from './widget-sizing.js'
import { snapWidgetBounds, type SnapEdge, type SnapRect } from './widget-snapping.js'
import { getWidgetWindow } from './widget-window.js'

// Home draws no chrome over a widget, because the app's WebContentsView
// composites above Home's own page and there is nowhere to put a grab handle.
// Drag and resize are therefore app-initiated: the app handles pointerdown on
// whatever element its skin uses and calls the bridge. That is what a skinnable
// player wants anyway, since a title strip is painted by the skin and has no
// position Home could have known.

const DRAG_POLL_INTERVAL_MS = 16
// A drag that never receives its mouseup would otherwise follow the cursor
// forever. Nothing legitimate holds a window drag for two minutes.
const DRAG_MAX_DURATION_MS = 120_000

type DragState = {
  readonly widgetId: string
  readonly timer: ReturnType<typeof setInterval>
  stop: () => void
}

const drags = new Map<number, DragState>()
const pendingRegions = new Map<string, unknown>()
let regionFlushScheduled = false

export function isWidgetDragging(windowId: number): boolean {
  return drags.has(windowId)
}

/**
 * Replaces a widget's clickable region while it animates.
 *
 * Applications are coalesced to one per frame in the main process, so an app
 * pushing regions on every animation frame cannot flood the hit-test loop. The
 * shape is validated with the same caps the manifest is held to, so the runtime
 * path cannot be used to declare a shape the manifest would have been rejected
 * for.
 */
export function setWidgetRegions(widgetId: string, shape: unknown): { applied: boolean } {
  // Validate now, on the caller's turn, so a bad shape is reported to the app
  // that sent it rather than thrown into a timer with nowhere to surface.
  parseWidgetShape(shape)
  pendingRegions.set(widgetId, shape)

  if (!regionFlushScheduled) {
    regionFlushScheduled = true
    setImmediate(flushRegions)
  }
  return { applied: true }
}

function flushRegions() {
  regionFlushScheduled = false
  const updates = [...pendingRegions]
  pendingRegions.clear()
  for (const [widgetId, shape] of updates) {
    const record = getWidget(widgetId)
    if (!record) continue
    try {
      record.region = normalizeRegion(parseWidgetShape(shape))
    } catch {
      // Already validated when it was queued; a failure here can only mean the
      // widget went away underneath us.
    }
  }
}

function currentRect(window: BrowserWindow): SnapRect {
  return window.getContentBounds()
}

function otherWidgetRects(widgetId: string, records: readonly WidgetRecord[]): SnapRect[] {
  const rects: SnapRect[] = []
  for (const record of records) {
    if (record.widgetId === widgetId) continue
    const window = getWidgetWindow(record.widgetId)
    if (window) rects.push(currentRect(window))
  }
  return rects
}

function workAreas(): SnapRect[] {
  return screen.getAllDisplays().map((display) => display.workArea)
}

// Home's own page plus every app view attached to the window. qdn-views adds
// the app's WebContentsView as a child of the window's contentView.
function widgetWebContents(window: BrowserWindow): WebContents[] {
  const found: WebContents[] = [window.webContents]
  for (const view of window.contentView.children) {
    const contents = (view as Partial<WebContentsView>).webContents
    if (contents && !contents.isDestroyed()) found.push(contents)
  }
  return found
}

/**
 * Begins a window drag from wherever the cursor is now.
 *
 * Electron exposes no cross-platform mouse hook, so the drag follows the cursor
 * on a timer and ends when the app view reports the mouseup. Chromium captures
 * the pointer on mousedown, so that event still arrives after the cursor leaves
 * the widget, which is what makes a drag past the window edge work at all.
 */
export function startWidgetDrag(
  widgetId: string,
  otherWidgets: readonly WidgetRecord[],
): { dragging: boolean } {
  const target = getWidgetWindow(widgetId)
  if (!target) throw new Error('This widget no longer belongs to an open window.')
  if (drags.has(target.id)) return { dragging: true }

  const targetId = target.id
  const origin = screen.getCursorScreenPoint()
  const start = currentRect(target)
  const others = otherWidgetRects(widgetId, otherWidgets)
  const startedAt = Date.now()

  const timer = setInterval(() => {
    if (target.isDestroyed()) {
      stop()
      return
    }
    if (Date.now() - startedAt > DRAG_MAX_DURATION_MS) {
      stop()
      return
    }
    const cursor = screen.getCursorScreenPoint()
    const moved = {
      x: start.x + (cursor.x - origin.x),
      y: start.y + (cursor.y - origin.y),
      width: start.width,
      height: start.height,
    }
    const snapped = snapWidgetBounds(moved, workAreas(), others)
    target.setContentBounds(snapped.bounds)
    const record = getWidget(widgetId)
    if (record) record.snappedEdges = snapped.edges
  }, DRAG_POLL_INTERVAL_MS)

  const onInput = (_event: unknown, input: { type?: string }) => {
    if (input?.type === 'mouseUp') stop()
  }

  // The app view holds pointer capture, so the mouseup arrives there. Home's
  // own page sits beneath it and never sees the gesture, so listen on both
  // rather than guessing which one will report.
  const listeners = widgetWebContents(target)

  function stop() {
    const state = drags.get(targetId)
    if (!state) return
    drags.delete(targetId)
    clearInterval(state.timer)
    for (const contents of listeners) {
      if (!contents.isDestroyed()) contents.off('input-event', onInput)
    }
  }

  drags.set(target.id, { widgetId, timer, stop })
  for (const contents of listeners) contents.on('input-event', onInput)
  target.once('closed', stop)

  return { dragging: true }
}

export function endWidgetDrag(widgetId: string): { dragging: boolean } {
  const window = getWidgetWindow(widgetId)
  if (!window) return { dragging: false }
  drags.get(window.id)?.stop()
  return { dragging: false }
}

/**
 * Applies a size the app asked for, clamped to the manifest's own bounds and to
 * whichever axes it declared resizable, then re-snaps so a resize into a screen
 * edge stays flush against it.
 */
export function resizeWidget(
  widgetId: string,
  requested: { width?: unknown; height?: unknown },
  otherWidgets: readonly WidgetRecord[],
): { width: number; height: number } {
  const record = getWidget(widgetId)
  const window = getWidgetWindow(widgetId)
  if (!record || !window) throw new Error('This widget no longer belongs to an open window.')

  const bounds = currentRect(window)
  const size = clampWidgetSize(
    record.manifest,
    { width: bounds.width, height: bounds.height },
    { width: requested.width as number, height: requested.height as number },
  )
  const snapped = snapWidgetBounds(
    { x: bounds.x, y: bounds.y, ...size },
    workAreas(),
    otherWidgetRects(widgetId, otherWidgets),
  )
  window.setContentBounds(snapped.bounds)
  record.snappedEdges = snapped.edges
  return size
}

export type WidgetState = {
  readonly widgetId: string
  readonly appName: string
  readonly focused: boolean
  readonly bounds: SnapRect
  readonly opacity: number
  readonly resizable: string
  readonly snappedEdges: readonly SnapEdge[]
  readonly minSize: { readonly width: number; readonly height: number }
  readonly maxSize: { readonly width: number; readonly height: number }
}

export function getWidgetState(widgetId: string): WidgetState {
  const record = getWidget(widgetId)
  const window = getWidgetWindow(widgetId)
  if (!record || !window) throw new Error('This widget no longer belongs to an open window.')

  return {
    widgetId,
    appName: record.appName,
    focused: window.isFocused(),
    bounds: currentRect(window),
    opacity: record.opacity,
    resizable: record.manifest.resizable,
    snappedEdges: record.snappedEdges,
    minSize: record.manifest.minSize,
    maxSize: record.manifest.maxSize,
  }
}
