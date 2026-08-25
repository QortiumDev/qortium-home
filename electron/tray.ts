import { homeWindowFocus } from './home-window-focus.js'
import { app, BrowserWindow, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildTrayMenu,
  TRAY_COMMAND_CLOSE_ALL_WIDGETS,
  TRAY_COMMAND_OPEN_HOME,
  TRAY_COMMAND_QUIT,
  trayTooltip,
  type TrayMenuNode,
} from './tray-menu.js'
import { listWidgets, onWidgetsChanged } from './widget-registry.js'
import { closeWidget, setWidgetWindowOpacity } from './widget-window.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const TRAY_ICON_FILE = 'icon.png'
// macOS and Windows both want a small tray glyph; handing them the full app
// icon leaves a blurry, oversized entry.
const TRAY_ICON_SIZE = 16

let tray: Tray | null = null
let trayMenu: Menu | null = null
let openHomeWindow: (() => void) | null = null

// Exported so scripts/smoke-desktop-widgets.mjs can prove the icon actually
// loaded. An empty image still produces a working Tray, so a wrong path shows
// up as an invisible notification-area entry rather than as an error, and the
// path differs between packaged and unpackaged builds.
export function trayIcon() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, TRAY_ICON_FILE)
    : path.join(currentDirectory, '..', 'build', TRAY_ICON_FILE)
  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    console.error(`The tray icon could not be loaded from ${iconPath}.`)
    return image
  }
  return image.resize({ height: TRAY_ICON_SIZE, width: TRAY_ICON_SIZE })
}

function runCommand(commandId: string) {
  if (commandId === TRAY_COMMAND_OPEN_HOME) {
    const homeWindows = BrowserWindow.getAllWindows().filter(
      (window) => !window.isDestroyed() && window.webContents.getURL().includes('v2-live.html'),
    )
    // Creation order is arbitrary once more than one window is open, and can
    // surface the one behind whatever the user was just using. Prefer the most
    // recently focused, falling back to first-found when none has been.
    const mostRecentId = homeWindowFocus.mostRecent(
      homeWindows.map((window) => window.id),
    )
    const existing =
      homeWindows.find((window) => window.id === mostRecentId) ?? homeWindows[0]
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.show()
      existing.focus()
      return
    }
    openHomeWindow?.()
    return
  }

  if (commandId === TRAY_COMMAND_QUIT) {
    app.quit()
    return
  }

  if (commandId === TRAY_COMMAND_CLOSE_ALL_WIDGETS) {
    for (const record of listWidgets()) closeWidget(record.widgetId)
    return
  }

  const close = /^close-widget:(.+)$/.exec(commandId)
  if (close) {
    closeWidget(close[1])
    return
  }

  const opacity = /^widget-opacity:(.+):([0-9.]+)$/.exec(commandId)
  if (opacity) setWidgetWindowOpacity(opacity[1], Number(opacity[2]))
}

function toMenuItems(nodes: readonly TrayMenuNode[]): MenuItemConstructorOptions[] {
  return nodes.map((node) => {
    if (node.kind === 'separator') return { type: 'separator' }
    if (node.kind === 'submenu') return { label: node.label, submenu: toMenuItems(node.items) }
    if (node.kind === 'radio') {
      return {
        checked: node.checked,
        click: () => runCommand(node.commandId),
        label: node.label,
        type: 'radio',
      }
    }
    return {
      click: node.enabled ? () => runCommand(node.commandId) : undefined,
      enabled: node.enabled,
      label: node.label,
    }
  })
}

function refreshTray() {
  if (!tray || tray.isDestroyed()) return
  const widgets = listWidgets().map((record) => ({
    appName: record.appName,
    opacity: record.opacity,
    widgetId: record.widgetId,
  }))
  tray.setToolTip(trayTooltip(widgets))
  trayMenu = Menu.buildFromTemplate(toMenuItems(buildTrayMenu(widgets)))
  tray.setContextMenu(trayMenu)
}

/**
 * Installs the tray icon and keeps its widget inventory in step with the
 * registry.
 *
 * The tray is what makes "Home is running with no window open" a visible state
 * rather than a mysterious one. A widget is a real BrowserWindow, so
 * window-all-closed does not fire while one is open, and without the tray a
 * widget whose app failed to load would be an invisible window with no route to
 * closing it short of killing the process.
 */
export function installTray(options: { readonly openHome: () => void }) {
  if (tray && !tray.isDestroyed()) return tray
  openHomeWindow = options.openHome
  tray = new Tray(trayIcon())
  // Windows only opens the context menu on right click, so give the left click
  // the most likely intent instead of nothing at all.
  tray.on('click', () => runCommand(TRAY_COMMAND_OPEN_HOME))
  refreshTray()
  onWidgetsChanged(refreshTray)
  return tray
}

export function getTray(): Tray | null {
  return tray && !tray.isDestroyed() ? tray : null
}

// Electron's Tray has no getter for the menu it was handed, so the module keeps
// the last one it built. scripts/smoke-desktop-widgets.mjs asserts the live
// inventory through this rather than re-deriving it from the model, so a
// mis-mapped node or a menu that was never rebuilt still fails the smoke.
export function getTrayMenu(): Menu | null {
  return getTray() ? trayMenu : null
}

export function destroyTray() {
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = null
  trayMenu = null
}
