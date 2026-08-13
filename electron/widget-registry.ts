import { randomUUID } from 'node:crypto'
import type { WidgetManifest } from './widget-manifest.js'
import type { WidgetRegion } from './widget-region.js'

export const WIDGETS_PER_APP_MAX = 4
export const WIDGETS_TOTAL_MAX = 16

export type WidgetRecord = {
  readonly widgetId: string
  readonly appName: string
  readonly resourceUrl: string
  readonly manifest: WidgetManifest
  readonly windowId: number
  region: WidgetRegion | null
}

const widgets = new Map<string, WidgetRecord>()

export function widgetTabId(widgetId: string): string {
  return `widget:${widgetId}`
}

export function isWidgetTabId(tabId: string): boolean {
  return tabId.startsWith('widget:')
}

export function allocateWidgetId(): string {
  return randomUUID()
}

export function assertWidgetCapacity(appName: string) {
  if (widgets.size >= WIDGETS_TOTAL_MAX) {
    throw new Error(`Home allows at most ${WIDGETS_TOTAL_MAX} widgets at once.`)
  }
  let owned = 0
  for (const record of widgets.values()) {
    if (record.appName === appName) owned += 1
  }
  if (owned >= WIDGETS_PER_APP_MAX) {
    throw new Error(`This app already has the maximum of ${WIDGETS_PER_APP_MAX} widgets open.`)
  }
}

export function registerWidget(record: WidgetRecord) {
  widgets.set(record.widgetId, record)
}

export function unregisterWidget(widgetId: string) {
  widgets.delete(widgetId)
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
