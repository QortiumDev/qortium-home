import { randomUUID } from 'node:crypto'
import type { WidgetManifest } from './widget-manifest.js'
import type { WidgetRegion } from './widget-region.js'
import type { SnapEdge } from './widget-snapping.js'

export const WIDGETS_TOTAL_MAX = 16

export type WidgetRecord = {
  readonly widgetId: string
  readonly appName: string
  readonly resourceUrl: string
  readonly manifest: WidgetManifest
  readonly windowId: number
  region: WidgetRegion | null
  // Mirrors the last value handed to setIgnoreMouseEvents. Electron exposes no
  // getter for it, and WIDGET_GET_STATE has to report it.
  ignoringMouse: boolean
  opacity: number
  snappedEdges: readonly SnapEdge[]
}

const widgets = new Map<string, WidgetRecord>()
const changeListeners = new Set<() => void>()

// The tray inventory has to track the live set exactly, because a widget
// missing from it is a window the user may have no other way to close.
export function onWidgetsChanged(listener: () => void) {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

function notifyWidgetsChanged() {
  for (const listener of changeListeners) listener()
}

export function widgetTabId(widgetId: string): string {
  return `widget:${widgetId}`
}

export function isWidgetTabId(tabId: string): boolean {
  return tabId.startsWith('widget:')
}

export function allocateWidgetId(): string {
  return randomUUID()
}

export function assertWidgetCapacity(resourceUrl: string) {
  if (widgets.size >= WIDGETS_TOTAL_MAX) {
    throw new Error(`Home allows at most ${WIDGETS_TOTAL_MAX} widgets at once.`)
  }
  for (const record of widgets.values()) {
    if (record.resourceUrl === resourceUrl) {
      throw new Error('This published widget is already open.')
    }
  }
}

export function registerWidget(record: WidgetRecord) {
  widgets.set(record.widgetId, record)
  notifyWidgetsChanged()
}

export function unregisterWidget(widgetId: string) {
  if (widgets.delete(widgetId)) notifyWidgetsChanged()
}

// Opacity is user-controlled through the tray, so a change has to redraw the
// menu that shows which step is selected.
export function setWidgetOpacity(widgetId: string, opacity: number) {
  const record = widgets.get(widgetId)
  if (!record) return
  record.opacity = opacity
  notifyWidgetsChanged()
}

export function getWidget(widgetId: string): WidgetRecord | null {
  return widgets.get(widgetId) ?? null
}

export function getWidgetByWindowId(windowId: number): WidgetRecord | null {
  for (const record of widgets.values()) {
    if (record.windowId === windowId) return record
  }
  return null
}

export function listWidgets(): readonly WidgetRecord[] {
  return [...widgets.values()]
}
