import { BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shouldLoadRendererFromDist } from './renderer-entry.js'
import { shouldIgnoreMouse } from './widget-hit-testing.js'
import { isWidgetDragging } from './widget-interaction.js'
import type { WidgetManifest } from './widget-manifest.js'
import {
  getWidget,
  getWidgetByWindowId,
  setWidgetOpacity,
  unregisterWidget,
} from './widget-registry.js'

// package.json sets "type": "module", so this compiles to ESM and __dirname is
// not defined. electron/main.ts derives it the same way.
const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

const HIT_TEST_INTERVAL_MS = 16
// A widget the user cannot see is a widget the user cannot close by clicking,
// so opacity has a floor well above invisible.
export const WIDGET_OPACITY_MIN = 0.2

export type CreateWidgetWindowOptions = {
  readonly widgetId: string
  readonly manifest: WidgetManifest
  readonly renderUrl: string
  readonly resourceUrl: string
  readonly nodeOrigin: string
  readonly accountId: string | null
}

function centreOnCursorDisplay(width: number, height: number) {
  const cursor = screen.getCursorScreenPoint()
  const area = screen.getDisplayNearestPoint(cursor).workArea
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
  }
}

export function createWidgetWindow(options: CreateWidgetWindowOptions): BrowserWindow {
  const { width, height } = options.manifest.defaultSize
  const position = centreOnCursorDisplay(width, height)

  const window = new BrowserWindow({
    width,
    height,
    x: position.x,
    y: position.y,
    minWidth: options.manifest.minSize.width,
    minHeight: options.manifest.minSize.height,
    maxWidth: options.manifest.maxSize.width,
    maxHeight: options.manifest.maxSize.height,
    resizable: options.manifest.resizable !== 'none',
    frame: false,
    transparent: true,
    // A native shadow follows the window rectangle, not the shape the app
    // paints, so it would render a rectangular halo around an irregular widget.
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(currentDirectory, 'home-v2-live-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Start transparent to clicks. The hit-test loop turns this off the moment
  // the cursor enters the widget's declared region. `forward` keeps mouse-move
  // events arriving while the window is ignoring clicks, which is what makes
  // the loop able to notice the cursor arriving at all.
  window.setIgnoreMouseEvents(true, { forward: true })

  const query = new URLSearchParams({
    widgetId: options.widgetId,
    renderUrl: options.renderUrl,
    resourceUrl: options.resourceUrl,
    nodeOrigin: options.nodeOrigin,
  })
  if (options.accountId) query.set('accountId', options.accountId)

  if (shouldLoadRendererFromDist()) {
    void window.loadFile(path.join(currentDirectory, '../dist/widget.html'), {
      search: query.toString(),
    })
  } else {
    const base = process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173'
    void window.loadURL(`${base}/widget.html?${query.toString()}`)
  }

  window.once('ready-to-show', () => window.show())
  startHitTesting(window)

  window.on('closed', () => unregisterWidget(options.widgetId))

  return window
}

// Polling rather than a global mouse hook: Electron exposes no cross-platform
// hook, and reading the cursor once a frame is cheap and predictable.
function startHitTesting(window: BrowserWindow) {
  let ignoring = true
  const timer = setInterval(() => {
    if (window.isDestroyed()) {
      clearInterval(timer)
      return
    }
    // A drag holds the pointer captured by the app view, so re-deciding
    // ignore-mouse mid-drag would drop the gesture the moment the cursor left
    // the declared region.
    if (isWidgetDragging(window.id)) return
    const record = getWidgetByWindowId(window.id)
    // Content bounds, not window bounds: the declared region is normalised
    // against the area the app paints, and on Windows those two rectangles
    // differ by the invisible resize border.
    const next = shouldIgnoreMouse(
      window.getContentBounds(),
      record?.region ?? null,
      screen.getCursorScreenPoint(),
    )
    if (next === ignoring) return
    ignoring = next
    window.setIgnoreMouseEvents(next, { forward: true })
    if (record) record.ignoringMouse = next
  }, HIT_TEST_INTERVAL_MS)

  window.on('closed', () => clearInterval(timer))
}

export function getWidgetWindow(widgetId: string): BrowserWindow | null {
  const record = getWidget(widgetId)
  if (!record) return null
  const window = BrowserWindow.fromId(record.windowId)
  return window && !window.isDestroyed() ? window : null
}

export function closeWidget(widgetId: string): boolean {
  const window = getWidgetWindow(widgetId)
  if (!window) return false
  window.close()
  return true
}

export function setWidgetWindowOpacity(widgetId: string, opacity: number): boolean {
  const window = getWidgetWindow(widgetId)
  if (!window) return false
  const clamped = Math.min(1, Math.max(WIDGET_OPACITY_MIN, opacity))
  window.setOpacity(clamped)
  setWidgetOpacity(widgetId, clamped)
  return true
}
