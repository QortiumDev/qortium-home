#!/usr/bin/env node
// Real packaged shell + native QDN views, driven with genuine X pointer input
// (xdotool), because the behaviours under test are the button/modifier
// conventions on Home's own links: a plain left click on a Dashboard pin or a
// bookmark-toolbar entry navigates in place, a middle click or Ctrl+click
// opens a new tab, the context menu's "Open in new tab" really opens one, and
// a middle click on a qdn:// / qortal:// link INSIDE an app view opens a new
// tab instead of being dropped by the window-open handler (#600). Disposable
// guest profile and loopback fixtures only. No wallet, signing, live Core or
// publication is involved.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Cdp, launchHomeV2, resolveAppImage, sleep } from './lib/home-v2-cdp.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const profile = mkdtempSync(path.join(os.tmpdir(), 'home-link-clicks-'))
const log = text => console.log(`[link-clicks] ${text}`)
const fixture = createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture')
  if (url.pathname.startsWith('/render/')) {
    response.setHeader('Content-Type', 'text/html')
    // The in-app link the smoke middle-clicks. A qortal:// href inside a
    // Qortal app resolves to a resource the native context menu would offer
    // "Open in new tab" for, so the window-open route must accept it.
    response.end('<!doctype html><html><body style="margin:0;padding:40px"><h1>Disposable link fixture</h1>' +
      '<p><a id="cross-link" href="qortal://APP/ClickDelta/published/one" style="font-size:32px;display:inline-block;padding:20px">Delta link</a></p></body></html>')
    return
  }
  response.setHeader('Content-Type', 'application/json')
  let value = []
  if (url.pathname === '/admin/status') value = { height: 1, isSynchronizing: false, numberOfConnections: 1 }
  else if (url.pathname === '/admin/info') value = { buildVersion: 'smoke', currentTimestamp: Date.now() }
  else if (url.pathname.includes('/resource/status/')) value = { status: 'READY', id: 'READY', localChunkCount: 1, totalChunkCount: 1 }
  else if (url.pathname.includes('/resource/properties/')) value = { filename: 'index.html', mimeType: 'text/html', size: 100 }
  else if (url.pathname.startsWith('/names/')) value = { name: url.pathname.split('/').at(-1), owner: 'QFixture' }
  response.end(JSON.stringify(value))
})
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${fixture.address().port}`
writeFileSync(path.join(profile, 'node-settings.json'), JSON.stringify({ mode: 'disabled', customUrl: '', apiKey: '' }))
writeFileSync(path.join(profile, 'qortal-node-settings.json'), JSON.stringify({ mode: 'custom', customUrl: origin, lastEnabledMode: 'custom' }))
writeFileSync(path.join(profile, 'home-v2-shell-state.json'), JSON.stringify({ version: 4,
  onboarding: { version: 1, status: 'skipped', currentStep: 'finish' }, settingsSection: 'general',
  product: { activeTabId: 'dashboard', entries: [
    { kind: 'internal', id: 'dashboard', page: 'dashboard' },
  ] } }))
process.env.XDG_CONFIG_HOME = path.join(profile, 'xdg')
process.env.QORTIUM_HOME_NODE_API_URL = origin
process.env.QORTIUM_HOME_QORTAL_NODE_API_URL = origin
delete process.env.DISPLAY
delete process.env.WAYLAND_DISPLAY
delete process.env.ELECTRON_RUN_AS_NODE
process.env.XDG_SESSION_TYPE = 'x11'
process.env.ELECTRON_OZONE_PLATFORM_HINT = 'x11'

let home
let xServer, windowManager
process.once('exit', () => { windowManager?.kill(); xServer?.kill() })
const clients = []
async function until(label, test) {
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    if (await test()) return
    await sleep(120)
  }
  throw new Error(`Timed out: ${label}`)
}
const alpha = 'qortal://APP/ClickAlpha/published/one'
const beta = 'qortal://APP/ClickBeta/published/one'
const gamma = 'qortal://APP/ClickGamma/published/one'
const delta = 'qortal://APP/ClickDelta/published/one'
try {
  xServer = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1100x800x24', '-nolisten', 'tcp'],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] })
  const display = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('Private display startup timed out')), 10000)
    xServer.once('error', error => { clearTimeout(timer); reject(error) })
    xServer.stdio[3].on('data', data => {
      output += data.toString()
      if (/^\d+\n$/.test(output)) { clearTimeout(timer); resolve(`:${output.trim()}`) }
    })
  })
  process.env.DISPLAY = display
  windowManager = spawn('openbox', [], { stdio: 'ignore', env: { ...process.env } })
  await sleep(800)
  home = await launchHomeV2({ appImage: resolveAppImage(repoRoot), profile, portBase: 10950, log,
    appArgs: ['--ozone-platform=x11'] })
  const nativeInput = args => {
    const result = spawnSync('xdotool', args, { encoding: 'utf8', env: { ...process.env, DISPLAY: display } })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
    return result.stdout.trim()
  }
  let nativeWindows = []
  await until('Native Home window mapping', () => {
    const result = spawnSync('xdotool', ['search', '--onlyvisible', '--class', '.'],
      { encoding: 'utf8', env: { ...process.env, DISPLAY: display } })
    if (result.status !== 0) return false
    nativeWindows = result.stdout.trim().split('\n').filter(Boolean).filter(id => {
      const geometry = /Geometry:\s*(\d+)x(\d+)/.exec(nativeInput(['getwindowgeometry', id]))
      return geometry && Number(geometry[1]) > 400 && Number(geometry[2]) > 300
    })
    return nativeWindows.length > 0
  })
  assert.equal(nativeWindows.length, 1, 'One Home window on the owned display')
  const { cdp } = home
  // Genuine pointer input at a window-relative point. `button` is xdotool's:
  // 1 left, 2 middle, 3 right. `modifier` holds a key across the click.
  const pointerAt = (point, button = '1', modifier = null) => {
    nativeInput(['windowactivate', '--sync', nativeWindows[0]])
    nativeInput(['mousemove', '--window', nativeWindows[0], String(Math.round(point.x)), String(Math.round(point.y))])
    if (modifier) nativeInput(['keydown', modifier])
    try {
      nativeInput(['click', button])
    } finally {
      if (modifier) nativeInput(['keyup', modifier])
    }
  }
  async function pointer(selector, button = '1', modifier = null) {
    await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center'})`)
    await sleep(150)
    const point = await cdp.box(selector)
    assert.ok(point, `Missing native pointer target ${selector}`)
    pointerAt(point, button, modifier)
  }
  async function click(selector) {
    await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center'})`)
    const point = await cdp.box(selector)
    assert.ok(point, `Missing ${selector}`)
    await cdp.click(point.x, point.y)
  }
  const address = () => cdp.evaluate(`document.querySelector('.home-v2-address input').value`)
  const countTabs = () => cdp.evaluate(`document.querySelectorAll('.home-v2-tab button[role="tab"]').length`)
  const currentTab = () => cdp.evaluate(`document.querySelector('.home-v2-tab button[role="tab"][aria-selected="true"]').closest('.home-v2-tab').dataset.tabId`)
  const back = '.home-v2-browser-controls button[aria-label="Back"]'
  await until('Dashboard restoration', async () => await currentTab() === 'dashboard')
  // Seed only this disposable profile: two Dashboard pins and one toolbar
  // link, all distinct apps so tab deduplication cannot mask a wrong route.
  await cdp.evaluate(`(() => {
    const key = 'qortium-home-bookmark-manager-snapshot'
    const snapshot = JSON.parse(localStorage.getItem(key))
    snapshot.dashboardPins = [
      { id: 'pin-alpha', label: 'Alpha', displayUrl: ${JSON.stringify(alpha)}, accountId: null, createdAt: 1 },
      { id: 'pin-gamma', label: 'Gamma', displayUrl: ${JSON.stringify(gamma)}, accountId: null, createdAt: 2 },
    ]
    snapshot.toolbar = [{ type: 'bookmark', id: 'link-beta', title: 'Beta', displayUrl: ${JSON.stringify(beta)}, accountId: null, createdAt: 3 }]
    snapshot.toolbarVisibility = 'always'
    snapshot.revision++
    localStorage.setItem(key, JSON.stringify(snapshot))
  })()`)
  await cdp.send('Page.reload', { ignoreCache: true })
  const pinAlpha = 'li[data-pin-id="pin-alpha"] .home-v2-pinned-apps__open'
  const pinGamma = 'li[data-pin-id="pin-gamma"] .home-v2-pinned-apps__open'
  const linkBeta = '[data-bookmark-id="link-beta"]'
  await until('Pins and toolbar fixture restored', () => cdp.evaluate(
    `!!document.querySelector(${JSON.stringify(pinAlpha)}) && !!document.querySelector(${JSON.stringify(pinGamma)}) && !!document.querySelector(${JSON.stringify(linkBeta)})`))
  await until('Dashboard active after reload', async () => await currentTab() === 'dashboard')
  const baseTabs = await countTabs()

  // 1. Plain left click on a pin: the Dashboard navigates in place.
  await pointer(pinAlpha, '1')
  await until('Plain click opened Alpha in place', async () => (await address()).startsWith(alpha))
  assert.equal(await countTabs(), baseTabs, 'a plain click adds no tab')
  assert.equal(await currentTab(), 'dashboard', 'a plain click stays in the Dashboard tab')
  await click(back)
  await until('Back returns to the Dashboard', async () => await address() === 'home://dashboard')
  await until('Pins visible again', () => cdp.evaluate(`!!document.querySelector(${JSON.stringify(pinAlpha)})`))
  log('Plain click on a pin navigates in place; Back restores the Dashboard')

  // 2. Middle click on a pin: a new tab, Dashboard untouched.
  await pointer(pinAlpha, '2')
  await until('Middle click opened Alpha in a new tab', async () => await countTabs() === baseTabs + 1 && (await address()).startsWith(alpha))
  const alphaTab = await currentTab()
  assert.notEqual(alphaTab, 'dashboard')
  await click('.home-v2-tab[data-tab-id="dashboard"] button[role="tab"]')
  await until('Dashboard still home://dashboard', async () => await currentTab() === 'dashboard' && await address() === 'home://dashboard')
  log('Middle click on a pin opens a new tab')

  // 3. Ctrl+click on a bookmark-toolbar entry: a new tab.
  await pointer(linkBeta, '1', 'ctrl')
  await until('Ctrl+click opened Beta in a new tab', async () => await countTabs() === baseTabs + 2 && (await address()).startsWith(beta))
  assert.notEqual(await currentTab(), 'dashboard')
  await click('.home-v2-tab[data-tab-id="dashboard"] button[role="tab"]')
  await until('Dashboard active', async () => await currentTab() === 'dashboard')
  log('Ctrl+click on a toolbar link opens a new tab')

  // 4. Context menu "Open in new tab" on a pin (in place since #560 until #600).
  await pointer(pinGamma, '3')
  const menuItem = await (async () => {
    let selector = null
    await until('Pin context menu with Open in new tab', async () => {
      selector = await cdp.evaluate(`(() => {
        const items = [...document.querySelectorAll('[role="menu"] button, [role="menu"] [role="menuitem"]')]
        const found = items.find(item => item.textContent.trim() === 'Open in new tab')
        if (!found) return null
        found.setAttribute('data-link-clicks-smoke', 'open-new-tab')
        return '[data-link-clicks-smoke="open-new-tab"]'
      })()`)
      return !!selector
    })
    return selector
  })()
  await click(menuItem)
  await until('Context menu opened Gamma in a new tab', async () => await countTabs() === baseTabs + 3 && (await address()).startsWith(gamma))
  assert.notEqual(await currentTab(), 'dashboard')
  await click('.home-v2-tab[data-tab-id="dashboard"] button[role="tab"]')
  await until('Dashboard unchanged after context open', async () => await currentTab() === 'dashboard' && await address() === 'home://dashboard')
  log('Context menu "Open in new tab" on a pin opens a new tab')

  // 5. Middle click on a qortal:// link inside the Alpha app view.
  await click(`.home-v2-tab[data-tab-id="${alphaTab}"] button[role="tab"]`)
  await until('Alpha tab active', async () => await currentTab() === alphaTab)
  let target
  await until('Alpha native document', async () => {
    const targets = await (await fetch(`http://127.0.0.1:${home.port}/json/list`)).json()
    target = targets.find(entry => entry.url.includes('/render/APP/ClickAlpha/one') && entry.url.includes('identifier=published'))
    return !!target
  })
  const app = new Cdp(target.webSocketDebuggerUrl)
  clients.push(app)
  await app.ready
  await until('Alpha fixture document ready and visible', () => app.evaluate(`
    document.readyState === 'complete' && document.visibilityState === 'visible' &&
    !!document.querySelector('#cross-link') && typeof window.qdnRequest === 'function'`))
  // The native view is placed at the host element's rect; the link's point
  // is that origin plus the link's rect inside the app document.
  const host = JSON.parse(await cdp.evaluate(`(() => {
    const element = [...document.querySelectorAll('.home-v2-app-view-host')].find(candidate => {
      const rect = candidate.getBoundingClientRect(); return rect.width > 0 && rect.height > 0
    })
    const rect = element.getBoundingClientRect()
    return JSON.stringify({ x: rect.left, y: rect.top })
  })()`))
  const link = JSON.parse(await app.evaluate(`(() => {
    const rect = document.querySelector('#cross-link').getBoundingClientRect()
    return JSON.stringify({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  })()`))
  await app.evaluate(`window.__linkClicksMarker = 'kept'`)
  pointerAt({ x: host.x + link.x, y: host.y + link.y }, '2')
  await until('In-app middle click opened Delta in a new tab', async () => await countTabs() === baseTabs + 4 && (await address()).startsWith(delta))
  assert.notEqual(await currentTab(), alphaTab)
  assert.equal(await app.evaluate('window.__linkClicksMarker'), 'kept', 'the originating app document is untouched')
  log('Middle click on an in-app qortal:// link opens a new tab')

  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(path.join(profile, 'link-clicks.png'), Buffer.from(screenshot.data, 'base64'))
  writeFileSync(path.join(profile, 'acceptance.json'), JSON.stringify({ passed: true, baseTabs, finalTabs: await countTabs(),
    checks: ['pin plain click in place + Back', 'pin middle click new tab', 'toolbar Ctrl+click new tab', 'pin context Open in new tab', 'in-app link middle click new tab'] }, null, 2))
  log(`PASS — receipt ${profile}/acceptance.json`)
} catch (error) {
  if (home) {
    const shot = await home.cdp.send('Page.captureScreenshot', { format: 'png' }).catch(() => null)
    if (shot) writeFileSync(path.join(profile, 'failure.png'), Buffer.from(shot.data, 'base64'))
    log(`Failure evidence: ${profile}`)
  }
  throw error
} finally {
  for (const client of clients) client.socket.close()
  home?.cdp.socket.close()
  home?.shutdown()
  fixture.close()
  windowManager?.kill()
  xServer?.kill()
}
