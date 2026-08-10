import { app, BrowserWindow, Menu, session, type Session } from 'electron'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PREVIEW_TITLE = 'Qortium Home 2 Preview'
const PREVIEW_BACKGROUND = '#dfe5e1'

function installFixtureSessionBoundary(fixtureSession: Session) {
  fixtureSession.enableNetworkEmulation({ offline: true })
  fixtureSession.setPermissionCheckHandler(() => false)
  fixtureSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  fixtureSession.setDevicePermissionHandler(() => false)
  fixtureSession.on('will-download', (event) => event.preventDefault())
  fixtureSession.webRequest.onBeforeRequest(
    {
      urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'],
    },
    (_details, callback) => callback({ cancel: true }),
  )
}

function createFixtureWindow() {
  const entryPath = fileURLToPath(
    new URL('../dist/v2-fixture.html', import.meta.url),
  )
  const entryUrl = pathToFileURL(entryPath).href
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 360,
    minHeight: 640,
    show: false,
    title: PREVIEW_TITLE,
    backgroundColor: PREVIEW_BACKGROUND,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: false,
      spellcheck: false,
      partition: 'home-v2-fixture',
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== entryUrl) {
      event.preventDefault()
    }
  })
  window.webContents.on('will-redirect', (event) => event.preventDefault())
  window.once('ready-to-show', () => window.show())
  void window.loadFile(entryPath)
}

app.commandLine.appendSwitch('disable-background-networking')
app.setName(PREVIEW_TITLE)
app.setPath(
  'userData',
  path.join(app.getPath('appData'), 'qortium-home-v2-fixture-preview'),
)
app.setPath('sessionData', path.join(app.getPath('userData'), 'session'))
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
}

app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return
  installFixtureSessionBoundary(session.fromPartition('home-v2-fixture'))
  Menu.setApplicationMenu(null)
  createFixtureWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createFixtureWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
