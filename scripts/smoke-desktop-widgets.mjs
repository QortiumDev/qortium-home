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
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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

// Reads every widget window's native state from the main process. `describe`
// rather than one getter per fact, because each round trip pauses the app.
const DESCRIBE_WIDGETS = mainRequire(`
  const { BrowserWindow } = require('electron')
  return BrowserWindow.getAllWindows()
    .filter((window) => window.webContents.getURL().includes('widget.html'))
    .map((window) => ({
      id: window.id,
      alwaysOnTop: window.isAlwaysOnTop(),
      bounds: window.getContentBounds(),
      frameBounds: window.getBounds(),
      opacity: window.getOpacity(),
      resizable: window.isResizable(),
      url: window.webContents.getURL(),
      visible: window.isVisible(),
    }))
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

const registryModule = JSON.stringify(path.join(repoRoot, 'dist-electron', 'widget-registry.js'))
const interactionModule = JSON.stringify(path.join(repoRoot, 'dist-electron', 'widget-interaction.js'))

// Number of polygons currently driving hit-testing. The manifest declares one
// pentagon, so a pushed replacement is only observable in the main process.
const READ_WIDGET_REGION = mainRequire(`
  const [record] = require(${registryModule}).listWidgets()
  return record && record.region ? record.region.polygons.length : null
`)

const READ_WIDGET_DRAGGING = mainRequire(`
  const [record] = require(${registryModule}).listWidgets()
  if (!record) return null
  return require(${interactionModule}).isWidgetDragging(record.windowId)
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

  // Answer the widget grant the moment it is asked for. The dialog itself is
  // covered by smoke-desktop-home-v2-prompt.mjs; what matters here is that
  // OPEN_AS_WIDGET reaches the renderer at all, which it did not before the
  // action was added to the bridge-permissions allowlist.
  await shell.evaluate(`
    (() => {
      window.__widgetPrompts = []
      window.homeV2Apps.onPermissionRequest((payload) => {
        window.__widgetPrompts.push(payload)
        window.homeV2Apps.resolvePermission({
          approved: true,
          requestId: payload.requestId,
          scope: 'session',
        })
      })
      return true
    })()
  `)

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

async function main() {
  const node = await startFixtureNode()
  log(`fixture node listening on ${node.origin}`)
  // A shared profile across both launches is what makes the restart meaningful:
  // placement persistence is exactly the thing that must survive it.
  const profileDirectory = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-widget-smoke-'))
  let home = null

  try {
    home = await launchHome({ profileDirectory, repoRoot })
    log('Home launched unpackaged with the main process inspector attached')

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

    assert.equal(widget.resizable, true, 'The fixture declares resizable: both.')
    assertDeclaredSize(widget.bounds, { width: 280, height: 120 }, 'the declared default size')

    // The hit-test loop normalises the cursor against the window rectangle
    // while the app paints into the viewport. If those two ever disagree every
    // declared region silently shifts, so pin them to each other here.
    const face = await home.renderer(
      (url) => url.startsWith('http') && url.endsWith('/widget.html'),
      'widget face',
    )
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
      /only available inside a widget/,
      `A normal tab must not reach widget actions: ${JSON.stringify(fromTab)}`,
    )
    log('widget actions are refused from a normal tab')

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
    await waitUntil('the tray close action to take effect', STEP_TIMEOUT_MS, async () =>
      (await home.main.evaluate(DESCRIBE_WIDGETS)).length === 0)
    log('tray close action dismissed the widget')

    await home.stop()
    home = await launchHome({ profileDirectory, repoRoot })
    log('Home relaunched against the same profile')

    const restored = await openFixtureWidget(home, node)
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
    log('placement and opacity survived a restart')

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
