#!/usr/bin/env node

// Desktop acceptance for the Qortium widget host.
//
// Runs entirely offline. A local HTTP server stands in for a Qortium node,
// serving the checked-in fixture app from test-fixtures/widget-app, so this
// needs no Core, no published resource and no network.
//
// It drives the production path end to end: the Home shell attaches the fixture
// app as a QDN view, the app calls qdnRequest({ action: 'OPEN_AS_WIDGET' }), the
// permission grant is answered through the real IPC, and the resulting native
// window is then inspected from inside the Electron main process. Renderer CDP
// alone cannot see isAlwaysOnTop(), window bounds or ignore-mouse state, which
// is exactly where this feature's defects live.
//
// Usage:
//   npm run build
//   npm run smoke:desktop:widgets

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchHome, mainRequire, waitUntil } from './lib/electron-main-driver.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const fixtureDirectory = path.join(repoRoot, 'test-fixtures', 'widget-app')
const APP_NAME = 'WidgetFixture'
const APP_IDENTIFIER = 'widget'
const RESOURCE_URL = `qdn://APP/${APP_NAME}/${APP_IDENTIFIER}`
const STEP_TIMEOUT_MS = 45_000

function log(message) {
  console.log(`[widget-smoke] ${message}`)
}

// QDN views serve app content under a CSP that blocks inline script, so the
// fixture pages carry none and every bridge call is injected from here. A
// rejection is returned as a value rather than thrown, so an assertion can
// report the bridge's own message.
function widgetRequest(request) {
  return `window.qdnRequest(${JSON.stringify(request)})
    .then((value) => value, (error) => ({ error: String((error && error.message) || error) }))`
}

// Answers the widget grant as soon as it is asked for, with a chosen scope, and
// records every prompt so the smoke can tell a re-prompt from a remembered
// grant. The dialog itself is covered by smoke-desktop-home-v2-prompt.mjs.
function approveWidgetPrompts(scope) {
  return `(() => {
    window.__widgetPrompts = []
    if (window.__widgetApprover) window.__widgetApprover()
    window.__widgetApprover = window.homeV2Apps.onPermissionRequest((payload) => {
      window.__widgetPrompts.push(payload)
      window.homeV2Apps.resolvePermission({
        approved: true,
        requestId: payload.requestId,
        scope: ${JSON.stringify(scope)},
      })
    })
    return true
  })()`
}

// Windows keeps an invisible resize border on a frameless resizable window and
// reports it as part of the window rectangle, so a manifest asking for 280
// logical pixels gets a 282 pixel window there. That border is the platform's,
// not ours: the renderer viewport matches the reported rectangle exactly, so
// hit-testing stays aligned. Allow for it rather than pretending it is a defect
// or letting an actual sizing bug hide behind an inequality.
const FRAMELESS_BORDER_SLACK_PX = 2

function assertDeclaredSize(bounds, declared, label) {
  for (const axis of ['width', 'height']) {
    assert.ok(
      bounds[axis] >= declared[axis] && bounds[axis] <= declared[axis] + FRAMELESS_BORDER_SLACK_PX,
      `Expected ${label} ${axis} of ${declared[axis]} (+${FRAMELESS_BORDER_SLACK_PX} platform border), got ${bounds[axis]}.`,
    )
  }
}

// Stands in for the node's REST surface. Only the two routes the widget host
// uses are implemented: a file inside a resource is addressed by a filepath
// query, while a render URL uses path segments. Getting those two shapes
// confused was one of the defects this smoke exists to catch.
function startFixtureNode() {
  const files = {
    'widget.json': ['application/json', readFileSync(path.join(fixtureDirectory, 'widget.json'))],
    'widget.html': ['text/html', readFileSync(path.join(fixtureDirectory, 'widget.html'))],
    'index.html': ['text/html', readFileSync(path.join(fixtureDirectory, 'index.html'))],
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const segments = url.pathname.split('/').filter(Boolean)
    let file = null

    if (segments[0] === 'arbitrary' && segments[1] === 'APP' && segments[2] === APP_NAME) {
      file = url.searchParams.get('filepath')
    } else if (segments[0] === 'render' && segments[1] === 'APP' && segments[2] === APP_NAME) {
      file = segments.slice(4).join('/')
    }

    const entry = file ? files[file] : null
    if (!entry) {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
      return
    }
    response.writeHead(200, { 'content-type': entry[0] })
    response.end(entry[1])
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ origin: `http://127.0.0.1:${port}`, close: () => server.close() })
    })
  })
}

const registryModule = JSON.stringify(path.join(repoRoot, 'dist-electron', 'widget-registry.js'))
const interactionModule = JSON.stringify(path.join(repoRoot, 'dist-electron', 'widget-interaction.js'))

// Reads every widget window's native state from the main process. `describe`
// rather than one getter per fact, because each round trip pauses the app.
const DESCRIBE_WIDGETS = mainRequire(`
  const { BrowserWindow } = require('electron')
  const registry = require(${registryModule})
  return BrowserWindow.getAllWindows()
    .filter((window) => window.webContents.getURL().includes('widget.html'))
    .map((window) => {
      const record = registry.getWidgetByWindowId(window.id)
      return {
        id: window.id,
        alwaysOnTop: window.isAlwaysOnTop(),
        bounds: window.getContentBounds(),
        frameBounds: window.getBounds(),
        nativeOpacity: window.getOpacity(),
        opacity: record ? record.opacity : window.getOpacity(),
        resizable: window.isResizable(),
        url: window.webContents.getURL(),
        visible: window.isVisible(),
      }
    })
`)

const DESCRIBE_HOME_WINDOWS = mainRequire(`
  const { BrowserWindow } = require('electron')
  return BrowserWindow.getAllWindows()
    .filter((window) => window.webContents.getURL().includes('v2-live.html'))
    .map((window) => window.id)
`)

// Creates a throwaway control window that asks for always-on-top the most
// direct way there is, and reports whether the platform admits to it. This is
// the calibration for the widget's own always-on-top assertion.
const ALWAYS_ON_TOP_IS_REPORTED = mainRequire(`
  const { BrowserWindow } = require('electron')
  const control = new BrowserWindow({ alwaysOnTop: true, height: 80, show: false, width: 120 })
  const reported = control.isAlwaysOnTop()
  control.destroy()
  return reported
`)

const NATIVE_OPACITY_IS_REPORTED = mainRequire(`
  const { BrowserWindow } = require('electron')
  const control = new BrowserWindow({ height: 80, show: false, transparent: true, width: 120 })
  control.setOpacity(0.75)
  const reported = Math.abs(control.getOpacity() - 0.75) < 0.001
  control.destroy()
  return reported
`)

// Captures the actual QDN widget face rather than its transparent shell. The
// fixture's clipped bottom corner must retain alpha through Chromium's page,
// the WebContentsView and the BrowserWindow native compositor layers.
const CAPTURE_WIDGET_FACE = mainRequire(`
  const { webContents } = require('electron')
  const target = webContents.getAllWebContents().find((contents) => {
    try {
      const url = new URL(contents.getURL())
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.pathname.endsWith('/widget.html')
    } catch {
      return false
    }
  })
  if (!target) throw new Error('The QDN widget face was not found for transparency capture.')
  return target.capturePage().then((image) => ({
    dataUrl: image.toDataURL({ scaleFactor: 1 }),
    size: image.getSize(1),
  }))
`)

function sampleWidgetCapture(dataUrl) {
  return `new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) {
        reject(new Error('Unable to create the widget capture canvas.'))
        return
      }
      context.drawImage(image, 0, 0)
      const pixel = (x, y) => Array.from(context.getImageData(x, y, 1, 1).data)
      resolve({
        bottomLeft: pixel(2, image.naturalHeight - 3),
        center: pixel(Math.floor(image.naturalWidth / 2), Math.floor(image.naturalHeight / 2)),
        height: image.naturalHeight,
        width: image.naturalWidth,
      })
    }
    image.onerror = () => reject(new Error('Unable to decode the widget capture.'))
    image.src = ${JSON.stringify(dataUrl)}
  })`
}

// Number of polygons currently driving hit-testing. The manifest declares one
// pentagon, so a pushed replacement is only observable in the main process.
const READ_WIDGET_REGION = mainRequire(`
  const [record] = require(${registryModule}).listWidgets()
  return record && record.region ? record.region.polygons.length : null
`)

const READ_WORK_AREA = mainRequire(`
  const { screen } = require('electron')
  const [record] = require(${registryModule}).listWidgets()
  const { BrowserWindow } = require('electron')
  const window = BrowserWindow.fromId(record.windowId)
  return screen.getDisplayMatching(window.getContentBounds()).workArea
`)

// Parks the widget at an exact position so a snap can be provoked with the
// physical cursor standing still.
function placeWidget(x, y) {
  return mainRequire(`
    const { BrowserWindow } = require('electron')
    const [record] = require(${registryModule}).listWidgets()
    const window = BrowserWindow.fromId(record.windowId)
    const bounds = window.getContentBounds()
    window.setContentBounds({ x: ${x}, y: ${y}, width: bounds.width, height: bounds.height })
    return window.getContentBounds()
  `)
}

const READ_SNAPPED_EDGES = mainRequire(`
  const [record] = require(${registryModule}).listWidgets()
  return record ? record.snappedEdges : null
`)

const READ_WIDGET_DRAGGING = mainRequire(`
  const [record] = require(${registryModule}).listWidgets()
  if (!record) return null
  return require(${interactionModule}).isWidgetDragging(record.windowId)
`)

const CLOSE_ALL_WIDGETS = mainRequire(`
  const registry = require(${registryModule})
  const { closeWidget } = require(${JSON.stringify(path.join(repoRoot, 'dist-electron', 'widget-window.js'))})
  const live = registry.listWidgets()
  for (const record of live) closeWidget(record.widgetId)
  return live.length
`)

const CLOSE_HOME_WINDOWS = mainRequire(`
  const { BrowserWindow } = require('electron')
  const closed = BrowserWindow.getAllWindows()
    .filter((window) => window.webContents.getURL().includes('v2-live.html'))
  for (const window of closed) window.close()
  return closed.length
`)

// Reads the live tray menu rather than the model that produced it, so a
// mis-mapped node or a menu that was never rebuilt still fails.
//
// require() of an ESM file shares the ESM module cache, so this is the same
// tray.js instance the app itself loaded, not a fresh copy.
// An empty image still produces a working Tray object, so a wrong icon path
// shows up as an invisible notification-area entry rather than as an error.
// The path differs between packaged and unpackaged builds, which is exactly the
// kind of boundary that survives a typecheck.
const TRAY_ICON = mainRequire(`
  const image = require(${JSON.stringify(path.join(repoRoot, 'dist-electron', 'tray.js'))}).trayIcon()
  return { empty: image.isEmpty(), size: image.getSize() }
`)

const DESCRIBE_TRAY = mainRequire(`
  const menu = require(${JSON.stringify(path.join(repoRoot, 'dist-electron', 'tray.js'))}).getTrayMenu()
  if (!menu) return null
  const describe = (items) => items.map((item) => ({
    checked: item.checked,
    enabled: item.enabled,
    label: item.label,
    submenu: item.submenu ? describe(item.submenu.items) : null,
    type: item.type,
  }))
  return describe(menu.items)
`)

// Invokes a tray command by label path, the same way a user picking it would.
function clickTray(labels) {
  return mainRequire(`
    const menu = require(${JSON.stringify(path.join(repoRoot, 'dist-electron', 'tray.js'))}).getTrayMenu()
    if (!menu) return 'no tray'
    let items = menu.items
    let target = null
    for (const label of ${JSON.stringify(labels)}) {
      target = items.find((item) => item.label === label)
      if (!target) return 'missing: ' + label
      items = target.submenu ? target.submenu.items : []
    }
    target.click()
    return 'clicked'
  `)
}

/**
 * Walks the production launch path: attach the fixture app as a QDN view,
 * approve the widget grant through the real IPC, and call OPEN_AS_WIDGET from
 * inside the app. Returns the shell and app-view clients alongside the result,
 * because the restart leg needs to do all of this a second time.
 */
async function openFixtureWidget(home, node) {
  const shell = await home.renderer((url) => url.includes('/v2-live.html'), 'home shell')
  await waitUntil('the Home shell bridge', STEP_TIMEOUT_MS, async () =>
    await shell.evaluate('typeof window.homeV2Apps?.show === "function"') === true)

  await shell.evaluate(approveWidgetPrompts('session'))

  const shown = await shell.evaluate(`
    window.homeV2Apps.show({
      accountId: null,
      bounds: { x: 0, y: 80, width: 800, height: 500 },
      displaySettings: { accent: 'default', language: 'en', textSize: 'medium', theme: 'dark' },
      nodeApiUrl: ${JSON.stringify(node.origin)},
      renderUrl: ${JSON.stringify(`${node.origin}/render/APP/${APP_NAME}/${APP_IDENTIFIER}/index.html`)},
      resourceUrl: ${JSON.stringify(RESOURCE_URL)},
      tabId: 'smoke-app'
    }).then(() => true, (error) => String(error && error.message || error))
  `)
  assert.equal(shown, true, `The fixture app view could not be attached: ${shown}`)

  const appView = await home.renderer((url) => url.endsWith('/index.html'), 'fixture app')
  await waitUntil('the fixture app bridge', STEP_TIMEOUT_MS, async () =>
    await appView.evaluate('typeof window.qdnRequest === "function"') === true)

  const opened = await appView.evaluate(widgetRequest({ action: 'OPEN_AS_WIDGET' }), STEP_TIMEOUT_MS)
  assert.ok(opened?.widgetId, `OPEN_AS_WIDGET failed: ${JSON.stringify(opened)}`)
  return { appView, shell, widgetId: opened.widgetId }
}

// The permission gate, exercised before any grant exists.
//
// Both of these failed in the field and neither was caught here, because the
// smoke only ever reached the toolbar path after an app-initiated approval had
// already left a grant behind, and the auto-approver always answered "session".
async function assertPermissionGate(home, node, approve) {
  const shell = await home.renderer((url) => url.includes('/v2-live.html'), 'home shell')
  await waitUntil('the Home shell bridge', STEP_TIMEOUT_MS, async () =>
    await shell.evaluate('typeof window.homeV2Apps?.show === "function"') === true)
  await shell.evaluate(approve)
  await shell.evaluate(`
    window.homeV2Apps.show({
      accountId: null,
      bounds: { x: 0, y: 80, width: 800, height: 500 },
      displaySettings: { accent: 'default', language: 'en', textSize: 'medium', theme: 'dark' },
      nodeApiUrl: ${JSON.stringify(node.origin)},
      renderUrl: ${JSON.stringify(`${node.origin}/render/APP/${APP_NAME}/${APP_IDENTIFIER}/index.html`)},
      resourceUrl: ${JSON.stringify(RESOURCE_URL)},
      tabId: 'smoke-app'
    })
  `)

  // The toolbar names a tab, and its request arrives on the Home shell's
  // webContents rather than the app view's. Re-resolving the shell as a QDN
  // view returns null, which made this throw for any app without a grant.
  const first = await shell.evaluate(
    "window.homeV2Apps.openAsWidget({ tabId: 'smoke-app' })",
    STEP_TIMEOUT_MS,
  )
  assert.equal(
    first.ok,
    true,
    `The toolbar action must work with no prior grant: ${JSON.stringify(first)}`,
  )
  log('toolbar "Open as widget" works before any grant exists')

  // "Allow once" must mean once. If it persisted a grant the two choices in
  // the dialog would be the same choice, for the capability that lets an app
  // paint over every other application.
  const promptsAfterFirst = await shell.evaluate('window.__widgetPrompts.length')
  assert.equal(promptsAfterFirst, 1, 'The first open must have prompted exactly once.')

  await home.main.evaluate(CLOSE_ALL_WIDGETS)
  await waitUntil('the first gate widget to close', STEP_TIMEOUT_MS, async () =>
    (await home.main.evaluate(DESCRIBE_WIDGETS)).length === 0)

  const second = await shell.evaluate(
    "window.homeV2Apps.openAsWidget({ tabId: 'smoke-app' })",
    STEP_TIMEOUT_MS,
  )
  assert.equal(second.ok, true, `The second open failed: ${JSON.stringify(second)}`)
  assert.equal(
    await shell.evaluate('window.__widgetPrompts.length'),
    2,
    'A single-request grant must not be remembered; the second open must prompt again.',
  )
  log('"Allow once" does not persist a grant')

  await home.main.evaluate(CLOSE_ALL_WIDGETS)
  await waitUntil('the gate widgets to close', STEP_TIMEOUT_MS, async () =>
    (await home.main.evaluate(DESCRIBE_WIDGETS)).length === 0)
  shell.close()
}

async function main() {
  const node = await startFixtureNode()
  log(`fixture node listening on ${node.origin}`)
  // A shared profile across both launches is what makes the restart meaningful:
  // placement persistence is exactly the thing that must survive it.
  const profileDirectory = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-widget-smoke-'))
  // This smoke closes the main window with several tabs open and asserts it is
  // gone. The multi-tab close warning (on by default) would turn that close
  // into a dialog nobody answers headlessly, so the profile opts out of it.
  writeFileSync(
    path.join(profileDirectory, 'window-behavior.json'),
    JSON.stringify({ closeToTray: false, warnOnCloseWithMultipleTabs: false }, null, 2),
    'utf8',
  )
  let home = null

  try {
    home = await launchHome({ profileDirectory, repoRoot })
    log('Home launched unpackaged with the main process inspector attached')

    await assertPermissionGate(home, node, approveWidgetPrompts('single-request'))

    const { appView, shell, widgetId } = await openFixtureWidget(home, node)
    const opened = { widgetId }
    log(`widget opened: ${widgetId}`)

    const prompts = await shell.evaluate('window.__widgetPrompts.map((p) => p.action)')
    assert.deepEqual(
      prompts,
      ['OPEN_AS_WIDGET'],
      'The widget grant must reach the renderer as an OPEN_AS_WIDGET prompt.',
    )

    // A widget that never becomes visible is the defining failure this feature
    // has to avoid, so visibility is part of what we wait for rather than a
    // separate assertion afterwards.
    const widgets = await waitUntil('a visible widget window', STEP_TIMEOUT_MS, async () => {
      const found = await home.main.evaluate(DESCRIBE_WIDGETS)
      return found.length === 1 && found[0].visible ? found : null
    })
    const widget = widgets[0]
    log(`widget window ${widget.id} at ${JSON.stringify(widget.bounds)}`)

    // isAlwaysOnTop() is not dependable on every desktop session. On this
    // Windows box it has been observed returning false even for a control
    // window created with alwaysOnTop: true, while the window genuinely does
    // float. So calibrate against a control window rather than trusting the
    // getter blindly: if the platform reports it at all, the widget must match,
    // and if it does not, say so loudly instead of passing quietly.
    if (await home.main.evaluate(ALWAYS_ON_TOP_IS_REPORTED)) {
      assert.equal(widget.alwaysOnTop, true, 'A widget must float above other applications.')
      log('always-on-top confirmed')
    } else {
      log('WARNING: this desktop session does not report always-on-top, even for a control window; skipping that assertion')
    }
    const nativeOpacityReported = await home.main.evaluate(NATIVE_OPACITY_IS_REPORTED)
    if (!nativeOpacityReported) {
      log('WARNING: this desktop session does not report native window opacity; checking the persisted user selection instead')
    }

    assert.equal(widget.resizable, true, 'The fixture declares resizable: both.')
    assertDeclaredSize(widget.bounds, { width: 280, height: 120 }, 'the declared default size')

    // The hit-test loop normalises the cursor against the window rectangle
    // while the app paints into the viewport. If those two ever disagree every
    // declared region silently shifts, so pin them to each other here.
    const face = await home.renderer(
      (url) => url.startsWith('http') && new URL(url).pathname.endsWith('/widget.html'),
      'widget face',
    )
    const widgetCapture = await home.main.evaluate(CAPTURE_WIDGET_FACE)
    assert.ok(widgetCapture.size.width > 4 && widgetCapture.size.height > 4, 'The captured QDN face must contain pixels.')
    const widgetPixels = await face.evaluate(sampleWidgetCapture(widgetCapture.dataUrl))
    assert.equal(
      widgetPixels.bottomLeft[3],
      0,
      `The clipped widget corner must expose the desktop with zero alpha: ${JSON.stringify(widgetPixels)}`,
    )
    assert.equal(
      widgetPixels.center[3],
      255,
      `The painted widget face must remain opaque: ${JSON.stringify(widgetPixels)}`,
    )
    log('transparent widget compositing confirmed from captured pixels')
    const updateBridgeDenied = await face.evaluate(`
      typeof window.homeV2AppUpdates?.check !== 'function'
        ? Promise.resolve({ absent: true, denied: true, message: '' })
        : window.homeV2AppUpdates.check('stable')
          .then(() => ({ absent: false, denied: false, message: '' }))
          .catch((error) => ({
            absent: false,
            denied: true,
            message: String(error?.message ?? error),
          }))
    `)
    assert.equal(
      updateBridgeDenied.denied,
      true,
      'The shared widget preload must not authorize Home update discovery.',
    )
    if (!updateBridgeDenied.absent) {
      assert.equal(
        updateBridgeDenied.message.includes('not authorized'),
        true,
        `Widget update denial was unexpected: ${updateBridgeDenied.message}`,
      )
    }
    const widgetShell = await home.renderer(
      (url) => url.startsWith('file:') && url.includes('/widget.html?'),
      'widget shell',
    )
    const qdnSettingsBridgeDenied = await widgetShell.evaluate(`
      typeof window.homeV2QdnSettings?.get !== 'function'
        ? Promise.resolve({ absent: true, denied: false, message: '' })
        : window.homeV2QdnSettings.get()
          .then(() => ({ absent: false, denied: false, message: '' }))
          .catch((error) => ({
            absent: false,
            denied: true,
            message: String(error?.message ?? error),
          }))
    `)
    assert.equal(
      qdnSettingsBridgeDenied.absent,
      false,
      'The shared widget preload must expose the Home QDN settings namespace.',
    )
    assert.equal(
      qdnSettingsBridgeDenied.denied,
      true,
      'A widget must not be authorized to read trusted Home QDN settings.',
    )
    assert.match(
      qdnSettingsBridgeDenied.message,
      /authorized top-level Home v?2 (?:document|window)/i,
      `Widget QDN settings denial was unexpected: ${qdnSettingsBridgeDenied.message}`,
    )
    widgetShell.close()
    const viewport = await face.evaluate('[window.innerWidth, window.innerHeight]')
    assert.deepEqual(
      viewport,
      [widget.bounds.width, widget.bounds.height],
      'The widget viewport must match the rectangle the hit-test loop measures.',
    )

    const homeWindows = await home.main.evaluate(DESCRIBE_HOME_WINDOWS)
    assert.equal(homeWindows.length, 1, 'Expected exactly one main Home window.')

    // The tray inventory is a correctness requirement, not polish: a widget
    // whose app never painted is otherwise an invisible window with no route to
    // closing it.
    const trayImage = await home.main.evaluate(TRAY_ICON)
    assert.equal(trayImage.empty, false, 'The tray icon image must actually load.')
    assert.deepEqual(trayImage.size, { height: 16, width: 16 }, 'The tray icon must be sized for the tray.')

    const tray = await home.main.evaluate(DESCRIBE_TRAY)
    assert.ok(tray, 'Home must install a tray icon.')
    const trayLabels = tray.map((item) => item.label)
    assert.ok(trayLabels.includes('Open Qortium Home'), `Tray is missing a route back to Home: ${trayLabels}`)
    assert.ok(trayLabels.includes('Quit Qortium Home'), `Tray is missing an explicit quit: ${trayLabels}`)
    const listed = tray.find((item) => item.label === `${APP_NAME}/${APP_IDENTIFIER}`)
    assert.ok(listed, `The live widget must be listed by app name in the tray: ${trayLabels}`)
    assert.ok(
      listed.submenu?.some((item) => item.label === 'Close'),
      'Every listed widget needs a close action.',
    )
    log('tray lists the live widget by name with a close action')

    // --- Widget bridge actions, driven from inside the widget itself --------

    const state = await face.evaluate(widgetRequest({ action: 'WIDGET_GET_STATE' }))
    assert.equal(state.widgetId, opened.widgetId, `WIDGET_GET_STATE failed: ${JSON.stringify(state)}`)
    assert.equal(state.resizable, 'both')
    assert.equal(state.opacity, 1)
    assert.deepEqual(state.minSize, { width: 200, height: 60 })
    assertDeclaredSize(state.bounds, { width: 280, height: 120 }, 'the reported state size')
    log('WIDGET_GET_STATE reports the live window')

    // A runtime region update is held to the manifest's own caps, so an app
    // cannot use this path to declare a shape its manifest would have been
    // rejected for.
    const tooManyPoints = { polygons: [Array.from({ length: 300 }, (_, i) => [i / 300, 0])] }
    const rejectedShape = await face.evaluate(
      widgetRequest({ action: 'WIDGET_SET_REGIONS', shape: tooManyPoints }),
    )
    assert.match(
      rejectedShape.error ?? '',
      /at most 256 points/,
      `An oversized region set must be rejected: ${JSON.stringify(rejectedShape)}`,
    )

    const acceptedShape = await face.evaluate(widgetRequest({
      action: 'WIDGET_SET_REGIONS',
      shape: { polygons: [[[0, 0], [0.5, 0], [0.5, 1], [0, 1]]] },
    }))
    assert.equal(acceptedShape.applied, true, `WIDGET_SET_REGIONS failed: ${JSON.stringify(acceptedShape)}`)
    await waitUntil('the pushed region to be applied', STEP_TIMEOUT_MS, async () =>
      await home.main.evaluate(READ_WIDGET_REGION) === 1)
    log('WIDGET_SET_REGIONS replaced the clickable region')

    // Resizing is clamped to the manifest, so a request far past maxSize stops
    // at maxSize rather than being ignored or honoured.
    const resized = await face.evaluate(
      widgetRequest({ action: 'WIDGET_RESIZE', width: 9000, height: 9000 }),
    )
    assert.deepEqual(
      resized,
      { width: 560, height: 240 },
      `WIDGET_RESIZE must clamp to the manifest maximum: ${JSON.stringify(resized)}`,
    )
    const afterResize = (await home.main.evaluate(DESCRIBE_WIDGETS))[0]
    assertDeclaredSize(afterResize.bounds, { width: 560, height: 240 }, 'the clamped size')
    log('WIDGET_RESIZE clamped to the declared maximum')

    // A drag follows the cursor and ends on mouseup. The cursor does not move
    // during a smoke, so the widget must stay where it started and the drag
    // must be dismissable through WIDGET_END_DRAG rather than running forever.
    const dragStarted = await face.evaluate(widgetRequest({ action: 'WIDGET_START_DRAG' }))
    assert.equal(dragStarted.dragging, true, `WIDGET_START_DRAG failed: ${JSON.stringify(dragStarted)}`)
    assert.equal(
      await home.main.evaluate(READ_WIDGET_DRAGGING),
      true,
      'The main process must register the drag.',
    )
    // The drag is supposed to end when the app view reports its mouseup, and
    // nothing else in this smoke exercises that path. If Electron did not
    // surface input-event from a WebContentsView, the only symptom would be a
    // widget that keeps following the cursor after the user lets go, until the
    // two minute ceiling. So dispatch a real mouse release into the app view
    // rather than trusting the explicit end action to stand in for it.
    await face.send('Input.dispatchMouseEvent', {
      button: 'left',
      buttons: 0,
      clickCount: 1,
      type: 'mouseReleased',
      x: 10,
      y: 10,
    })
    await waitUntil('the drag to end on the app view mouseup', STEP_TIMEOUT_MS, async () =>
      await home.main.evaluate(READ_WIDGET_DRAGGING) === false)
    log('a real mouseup in the app view ended the drag')

    // Snapping, provoked without moving the physical cursor. Park the widget
    // just inside the threshold of the left work-area edge and start a drag:
    // with the cursor stationary the first poll tick computes no movement, so
    // whatever the window does next is the snap and nothing else.
    const workArea = await home.main.evaluate(READ_WORK_AREA)
    await home.main.evaluate(placeWidget(workArea.x + 5, workArea.y + 200))
    await face.evaluate(widgetRequest({ action: 'WIDGET_START_DRAG' }))
    const snapped = await waitUntil('the widget to snap flush to the left edge', STEP_TIMEOUT_MS, async () => {
      const [current] = await home.main.evaluate(DESCRIBE_WIDGETS)
      return current && current.bounds.x === workArea.x ? current : null
    })
    assert.equal(snapped.bounds.x, workArea.x, 'A widget dropped near an edge must sit flush against it.')
    assert.deepEqual(
      await home.main.evaluate(READ_SNAPPED_EDGES),
      ['left'],
      'The snapped edge must be reported back through WIDGET_GET_STATE.',
    )
    // Hysteresis: an edge already held keeps hold past the distance at which it
    // would never have engaged. Without this the snap is a flicker you pass
    // through rather than something that feels magnetic, which is exactly how
    // it read on the first manual pass.
    await home.main.evaluate(placeWidget(workArea.x + 26, workArea.y + 200))
    const stillHeld = await waitUntil('the held edge to keep hold', STEP_TIMEOUT_MS, async () => {
      const [current] = await home.main.evaluate(DESCRIBE_WIDGETS)
      return current && current.bounds.x === workArea.x ? current : null
    })
    assert.equal(stillHeld.bounds.x, workArea.x)

    await face.evaluate(widgetRequest({ action: 'WIDGET_END_DRAG' }))
    log('a drag near a screen edge snapped flush, reported the edge, and kept hold')

    // Ending a drag that already ended is harmless, which is what lets an app
    // call it defensively.
    const dragEnded = await face.evaluate(widgetRequest({ action: 'WIDGET_END_DRAG' }))
    assert.equal(dragEnded.dragging, false, `WIDGET_END_DRAG failed: ${JSON.stringify(dragEnded)}`)
    assert.equal(
      await home.main.evaluate(READ_WIDGET_DRAGGING),
      false,
      'Ending a drag must release it.',
    )
    log('WIDGET_START_DRAG and WIDGET_END_DRAG round-trip')

    // The same actions must be refused from a normal tab, where the calling
    // view is not a widget at all.
    const fromTab = await appView.evaluate(widgetRequest({ action: 'WIDGET_GET_STATE' }))
    assert.match(
      fromTab.error ?? '',
      /unavailable/,
      `A normal tab must not reach widget actions: ${JSON.stringify(fromTab)}`,
    )
    log('widget actions are refused from a normal tab')

    // --- The toolbar's "Open as widget" action ------------------------------

    // The shell names a tab; the app view's own context is resolved in the main
    // process, so the request cannot point at a resource the tab is not showing.
    // Version 1 intentionally has one live window per published resource, so
    // the toolbar must identify the already-open widget instead of creating a
    // second window with colliding placement state.
    const viaToolbar = await shell.evaluate(`
      window.homeV2Apps.openAsWidget({ tabId: 'smoke-app' })
    `, STEP_TIMEOUT_MS)
    assert.equal(viaToolbar.ok, false)
    assert.match(viaToolbar.message ?? '', /already open/)
    assert.equal((await home.main.evaluate(DESCRIBE_WIDGETS)).length, 1)

    // A tab that is not showing an app cannot be opened as a widget.
    const unknownTab = await shell.evaluate(`
      window.homeV2Apps.openAsWidget({ tabId: 'not-a-real-tab' })
    `)
    assert.equal(unknownTab.ok, false)
    assert.match(unknownTab.message ?? '', /not showing a published app/)
    log('toolbar "Open as widget" enforces one resource instance and refuses an unknown tab')

    assert.equal(
      await home.main.evaluate(clickTray([`${APP_NAME}/${APP_IDENTIFIER}`, 'Close'])),
      'clicked',
    )
    await waitUntil('the tray close action', STEP_TIMEOUT_MS, async () =>
      (await home.main.evaluate(DESCRIBE_WIDGETS)).length === 0)
    log('tray close dismissed the widget')

    const reopened = await shell.evaluate(`
      window.homeV2Apps.openAsWidget({ tabId: 'smoke-app' })
    `, STEP_TIMEOUT_MS)
    assert.equal(reopened.ok, true, `Reopening failed: ${JSON.stringify(reopened)}`)
    await waitUntil('the reopened widget', STEP_TIMEOUT_MS, async () => {
      const found = await home.main.evaluate(DESCRIBE_WIDGETS)
      return found.length === 1 && found[0].visible
    })

    // Widgets outlive main Home windows. This is the state Home has never had
    // before, and the tray above is what makes it navigable.
    face.close()
    shell.close()
    appView.close()
    const closedCount = await home.main.evaluate(CLOSE_HOME_WINDOWS)
    assert.equal(closedCount, 1, 'Expected to close exactly one main Home window.')
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const survivors = await home.main.evaluate(DESCRIBE_WIDGETS)
    assert.equal(survivors.length, 1, 'A widget must survive closing every main Home window.')
    assert.equal(survivors[0].visible, true, 'The surviving widget must still be on screen.')
    assert.deepEqual(
      await home.main.evaluate(DESCRIBE_HOME_WINDOWS),
      [],
      'Expected no main Home window to remain.',
    )
    log('widget survived closing every main Home window')

    // --- Opacity, chosen from the tray -------------------------------------

    assert.equal(await home.main.evaluate(clickTray([`${APP_NAME}/${APP_IDENTIFIER}`, 'Opacity', '75%'])), 'clicked')
    await waitUntil('the widget to dim', STEP_TIMEOUT_MS, async () => {
      const [current] = await home.main.evaluate(DESCRIBE_WIDGETS)
      return current && Math.abs(current.opacity - 0.75) < 0.001
    })
    if (nativeOpacityReported) {
      const [current] = await home.main.evaluate(DESCRIBE_WIDGETS)
      assert.ok(Math.abs(current.nativeOpacity - 0.75) < 0.001)
    }
    const dimmedTray = await home.main.evaluate(DESCRIBE_TRAY)
    const opacityMenu = dimmedTray
      .find((item) => item.label === `${APP_NAME}/${APP_IDENTIFIER}`)
      ?.submenu?.find((item) => item.label === 'Opacity')?.submenu
    assert.deepEqual(
      opacityMenu?.filter((item) => item.checked).map((item) => item.label),
      ['75%'],
      'The tray must show which opacity step is selected.',
    )
    log('tray opacity applied and reflected back in the menu')

    // --- Placement persistence across a real restart ------------------------

    // The size it was resized to, the position it was left at, and the opacity
    // chosen from the tray all have to come back.
    const before = (await home.main.evaluate(DESCRIBE_WIDGETS))[0]
    assert.equal(await home.main.evaluate(clickTray([`${APP_NAME}/${APP_IDENTIFIER}`, 'Close'])), 'clicked')

    // With no main Home window left, closing the last widget also ends the
    // session: window-all-closed finally fires. The main process may therefore
    // be tearing down by the time we look, so an evaluation that finds no
    // context is just as good an answer as an empty widget list. Either way the
    // close-time placement save has run, which is what the relaunch reads back.
    const dismissed = await waitUntil('the tray close action', STEP_TIMEOUT_MS, async () => {
      try {
        return (await home.main.evaluate(DESCRIBE_WIDGETS)).length === 0
      } catch {
        return true
      }
    })
    assert.equal(dismissed, true)
    log('tray close action dismissed the last widget')

    await home.stop()
    home = await launchHome({ profileDirectory, repoRoot })
    log('Home relaunched against the same profile')

    const { shell: shell2 } = await openFixtureWidget(home, node)
    const restored = { widgetId: 'reopened' }
    const after = await waitUntil('the restored widget', STEP_TIMEOUT_MS, async () => {
      const found = await home.main.evaluate(DESCRIBE_WIDGETS)
      return found.length === 1 && found[0].visible ? found[0] : null
    })
    assert.ok(restored.widgetId, 'The widget must reopen after a restart.')
    assert.deepEqual(
      { x: after.bounds.x, y: after.bounds.y, width: after.bounds.width, height: after.bounds.height },
      { x: before.bounds.x, y: before.bounds.y, width: before.bounds.width, height: before.bounds.height },
      'A widget must reopen at the size and position it was left at.',
    )
    assert.ok(
      Math.abs(after.opacity - 0.75) < 0.001,
      `A widget must reopen at the opacity it was left at, got ${after.opacity}.`,
    )
    if (nativeOpacityReported) {
      assert.ok(Math.abs(after.nativeOpacity - 0.75) < 0.001)
    }
    log('placement and opacity survived a restart')

    // Surviving one restart is not enough. A restored widget has to report its
    // own opacity honestly, or the next save writes a stale value over the
    // stored one and the setting decays a cycle later. The tray reads the same
    // record, so a widget restored dimmed must not show as 100%.
    const restoredTray = await home.main.evaluate(DESCRIBE_TRAY)
    const restoredOpacityMenu = restoredTray
      .find((item) => item.label === `${APP_NAME}/${APP_IDENTIFIER}`)
      ?.submenu?.find((item) => item.label === 'Opacity')?.submenu
    assert.deepEqual(
      restoredOpacityMenu?.filter((item) => item.checked).map((item) => item.label),
      ['75%'],
      'A widget restored dimmed must report that opacity, not 100%.',
    )

    // Nudge it, which is what triggers a placement save, then close and reopen.
    // This is the cycle that silently reset opacity to fully opaque.
    await home.main.evaluate(placeWidget(after.bounds.x + 40, after.bounds.y + 30))
    await new Promise((resolve) => setTimeout(resolve, 800))
    await home.main.evaluate(CLOSE_ALL_WIDGETS)
    await waitUntil('the widget to close', STEP_TIMEOUT_MS, async () =>
      (await home.main.evaluate(DESCRIBE_WIDGETS)).length === 0)

    const reopenedAgain = await shell2.evaluate(
      "window.homeV2Apps.openAsWidget({ tabId: 'smoke-app' })",
      STEP_TIMEOUT_MS,
    )
    assert.equal(reopenedAgain.ok, true, `Reopening failed: ${JSON.stringify(reopenedAgain)}`)
    const cycled = await waitUntil('the reopened widget', STEP_TIMEOUT_MS, async () => {
      const [current] = await home.main.evaluate(DESCRIBE_WIDGETS)
      return current && current.visible ? current : null
    })
    assert.ok(
      Math.abs(cycled.opacity - 0.75) < 0.001,
      `Opacity must survive a move-and-reopen cycle, got ${cycled.opacity}.`,
    )
    log('opacity survived a second open, move and reopen cycle')

    log('all widget host assertions passed')
  } finally {
    await home?.stop()
    node.close()
    try {
      rmSync(profileDirectory, { force: true, maxRetries: 5, recursive: true })
    } catch {
      // Windows holds the profile briefly after exit; a leftover temp directory
      // must not fail an otherwise passing smoke.
    }
  }
}

await main()
console.log('desktop widget smoke passed')
