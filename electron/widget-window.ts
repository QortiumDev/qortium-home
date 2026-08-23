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
import { clampWidgetSize } from './widget-sizing.js'
import { clampRectToDisplays } from './widget-snapping.js'
import { readWidgetPlacements, saveWidgetPlacement } from './widget-store.js'
import type {
  QdnBridgeStateDetail,
  QdnDisplaySettings,
} from './qdn-views.js'
import type { QdnManagerRevisions } from './qdn-manager-events.js'

// package.json sets "type": "module", so this compiles to ESM and __dirname is
// not defined. electron/main.ts derives it the same way.
const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

const HIT_TEST_INTERVAL_MS = 16
const PLACEMENT_SAVE_DELAY_MS = 250
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
  readonly bridgeStates: readonly QdnBridgeStateDetail[]
  readonly displaySettings: QdnDisplaySettings
  readonly managerRevisions?: QdnManagerRevisions
}

function centreOnCursorDisplay(width: number, height: number) {
  const cursor = screen.getCursorScreenPoint()
  const area = screen.getDisplayNearestPoint(cursor).workArea
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
  }
}

// A widget is remembered per published app, so reopening it puts it back where
// the user left it. The stored size is still clamped to what the manifest
// currently allows, because a republished app may have tightened its own
// bounds since the placement was saved.
function restoredPlacement(options: CreateWidgetWindowOptions) {
  const stored = readWidgetPlacements()[options.resourceUrl]
  if (!stored) return null

  const size = clampWidgetSize(
    options.manifest,
    options.manifest.defaultSize,
    { width: stored.width, height: stored.height },
  )
  // Clamped to a display that is actually connected, so a placement saved on a
  // monitor that has since been unplugged does not strand the widget somewhere
  // the user cannot reach it.
  const bounds = clampRectToDisplays(
    { x: stored.x, y: stored.y, ...size },
    screen.getAllDisplays().map((display) => display.workArea),
  )
  return { ...bounds, opacity: stored.opacity }
}

// Debounced, because a drag emits a move event per frame and the store is a
// staged write to disk each time.
function watchPlacement(window: BrowserWindow, resourceUrl: string) {
  let timer: ReturnType<typeof setTimeout> | undefined

  const save = () => {
    timer = undefined
    if (window.isDestroyed()) return
    saveWidgetPlacement(resourceUrl, {
      ...window.getContentBounds(),
      // Electron reports 1 on Linux compositors that do not expose native
      // per-window opacity, even after setOpacity accepted the requested value.
      // The registry is the authoritative user selection and keeps placement
      // persistence stable across those desktops; fall back to the native
      // value only before registration has completed.
      opacity: getWidgetByWindowId(window.id)?.opacity ?? window.getOpacity(),
      updatedAt: Date.now(),
    })
  }

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, PLACEMENT_SAVE_DELAY_MS)
  }

  window.on('move', schedule)
  window.on('resize', schedule)
  window.on('close', () => {
    if (timer) clearTimeout(timer)
    save()
  })
}

export type CreatedWidgetWindow = {
  readonly window: BrowserWindow
  /**
   * The opacity the window was actually opened at, restored from the last
   * session where there was one. The caller has to seed the registry record
   * with this: the tray reads the record to show which step is selected, and a
   * record left at 1 would report a dimmed widget as fully opaque.
   */
  readonly opacity: number
}

export function createWidgetWindow(options: CreateWidgetWindowOptions): CreatedWidgetWindow {
  const restored = restoredPlacement(options)
  const { width, height } = restored ?? options.manifest.defaultSize
  const position = restored ?? centreOnCursorDisplay(width, height)

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
    // transparent alone does not override BrowserWindow's own default
    // backgroundColor (#FFF, opaque) - without this, everything outside the
    // app's declared shape renders as a solid white rectangle instead of
    // showing the desktop through it.
    backgroundColor: '#00000000',
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
  query.set('bridgeStates', JSON.stringify(options.bridgeStates))
  query.set('displaySettings', JSON.stringify(options.displaySettings))
  if (options.managerRevisions) {
    query.set('managerRevisions', JSON.stringify(options.managerRevisions))
  }

  if (shouldLoadRendererFromDist()) {
    void window.loadFile(path.join(currentDirectory, '../dist/widget.html'), {
      search: query.toString(),
    })
  } else {
    const base = process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173'
    void window.loadURL(`${base}/widget.html?${query.toString()}`)
  }

  const opacity = restored ? Math.min(1, Math.max(WIDGET_OPACITY_MIN, restored.opacity)) : 1
  if (opacity < 1) window.setOpacity(opacity)

  window.once('ready-to-show', () => window.show())
  startHitTesting(window)
  watchPlacement(window, options.resourceUrl)

  window.on('closed', () => unregisterWidget(options.widgetId))

  return { window, opacity }
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
  const record = getWidget(widgetId)
  const window = getWidgetWindow(widgetId)
  if (!record || !window) return false
  const clamped = Math.min(1, Math.max(WIDGET_OPACITY_MIN, opacity))
  window.setOpacity(clamped)
  setWidgetOpacity(widgetId, clamped)
  // Saved straight away rather than waiting for the next move: choosing an
  // opacity is a deliberate user action and there may not be another one.
  saveWidgetPlacement(record.resourceUrl, {
    ...window.getContentBounds(),
    opacity: clamped,
    updatedAt: Date.now(),
  })
  return true
}
