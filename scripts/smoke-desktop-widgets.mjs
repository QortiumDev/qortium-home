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
import { readFileSync } from 'node:fs'
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

async function main() {
  const node = await startFixtureNode()
  log(`fixture node listening on ${node.origin}`)
  let home = null

  try {
    home = await launchHome({ repoRoot })
    log('Home launched unpackaged with the main process inspector attached')

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
    log('fixture app attached as a QDN view')

    const appView = await home.renderer((url) => url.endsWith('/index.html'), 'fixture app')
    await waitUntil('the fixture app bridge', STEP_TIMEOUT_MS, async () =>
      await appView.evaluate('typeof window.qdnRequest === "function"') === true)

    const opened = await appView.evaluate(
      widgetRequest({ action: 'OPEN_AS_WIDGET' }),
      STEP_TIMEOUT_MS,
    )
    assert.ok(opened?.widgetId, `OPEN_AS_WIDGET failed: ${JSON.stringify(opened)}`)
    log(`widget opened: ${opened.widgetId}`)

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

    assert.equal(widget.alwaysOnTop, true, 'A widget must float above other applications.')
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

    log('all widget host assertions passed')
    shell.close()
    appView.close()
    face.close()
  } finally {
    await home?.stop()
    node.close()
  }
}

await main()
console.log('desktop widget smoke passed')
