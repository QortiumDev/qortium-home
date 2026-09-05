#!/usr/bin/env node
// Real packaged shell + native QDN views; disposable guest profile and loopback
// fixtures only. No wallet, signing, live Core or publication is involved.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Cdp, launchHomeV2, resolveAppImage, sleep } from './lib/home-v2-cdp.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const profile = mkdtempSync(path.join(os.tmpdir(), 'home-tab-navigation-'))
const log = text => console.log(`[tab-navigation] ${text}`)
const counts = new Map()
const fixture = createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture')
  counts.set(url.pathname, (counts.get(url.pathname) ?? 0) + 1)
  if (url.pathname.startsWith('/render/')) {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><html><body><h1>Disposable navigation fixture</h1></body></html>')
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
  product: { activeTabId: 'settings', entries: [
    { kind: 'internal', id: 'dashboard', page: 'dashboard' },
    { kind: 'internal', id: 'settings', page: 'settings' },
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
  home = await launchHomeV2({ appImage: resolveAppImage(repoRoot), profile, portBase: 10800, log,
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
  const shortcut = keys => {
    nativeInput(['windowactivate', '--sync', nativeWindows[0]])
    nativeInput(['key', '--clearmodifiers', keys])
  }
  const { cdp } = home
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
  const forward = '.home-v2-browser-controls button[aria-label="Forward"]'
  const reload = '.home-v2-browser-controls button[aria-label="Reload"]'
  await until('Settings restoration', async () => await currentTab() === 'settings')
  // Settings uses a section navigation, distinct from the browser tab strip.
  async function settingsButton(label) {
    const selector = await cdp.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('.home-v2-page-slot:not([hidden]) button')]
      const found = buttons.find(button => button.textContent.trim() === ${JSON.stringify(label)})
      if (!found) return null
      found.setAttribute('data-navigation-smoke-section', 'target')
      return '[data-navigation-smoke-section="target"]'
    })()`)
    assert.ok(selector, `Settings section ${label}`)
    await click(selector)
    await cdp.evaluate(`document.querySelector('[data-navigation-smoke-section="target"]')?.removeAttribute('data-navigation-smoke-section')`)
  }
  await settingsButton('Appearance')
  await until('Settings history Back enabled', () => cdp.evaluate(`!document.querySelector(${JSON.stringify(back)}).disabled`))
  await click(back)
  await until('General section after Back', () => cdp.evaluate(`document.querySelector('.home-v2-page-slot:not([hidden]) .home-v2-settings-nav [aria-current="page"]')?.textContent.trim() === 'General'`))
  await click(forward)
  await until('Appearance after Forward', () => cdp.evaluate(`document.querySelector('.home-v2-page-slot:not([hidden]) .home-v2-settings-nav [aria-current="page"]')?.textContent.trim() === 'Appearance'`))
  log('Settings Back/Forward passed')
  await click('.home-v2-tab[data-tab-id="dashboard"] button[role="tab"]')
  assert.equal(await cdp.evaluate(`document.querySelector(${JSON.stringify(back)}).disabled`), true)
  await click('.home-v2-tab[data-tab-id="settings"] button[role="tab"]')
  assert.equal(await cdp.evaluate(`document.querySelector(${JSON.stringify(back)}).disabled`), false)

  async function open(addressValue) {
    await click('.home-v2-address input')
    await cdp.evaluate(`document.querySelector('.home-v2-address input').select()`)
    await cdp.send('Input.insertText', { text: addressValue })
    await click('.home-v2-address button[type="submit"]')
  }
  async function attach(name, route) {
    let target
    await until(`${name} native document`, async () => {
      const targets = await (await fetch(`http://127.0.0.1:${home.port}/json/list`)).json()
      target = targets.find(entry => entry.url.includes(`/render/APP/${name}/published/${route}`))
      return !!target
    })
    const app = new Cdp(target.webSocketDebuggerUrl)
    clients.push(app)
    await app.ready
    await until('Native document ready', () => app.evaluate('document.readyState === "complete"'))
    return app
  }
  const alpha = 'qortal://APP/NavigationAlpha/published/'
  const beta = 'qortal://APP/NavigationBeta/published/'
  await open(`${alpha}one`)
  let app = await attach('NavigationAlpha', 'one')
  const appTab = await currentTab(), tabs = await countTabs()
  await app.evaluate(`history.pushState({}, '', 'two?room=7#message')`)
  await until('Alpha deep URL', async () => await address() === `${alpha}two?room=7#message`)
  await app.evaluate(`window.__navigationMarker = 'kept'; history.pushState({}, '', 'three')`)
  await until('Alpha third URL', async () => await address() === `${alpha}three`)
  await click(back)
  await until('Native Back', async () => await address() === `${alpha}two?room=7#message`)
  assert.equal(await app.evaluate('window.__navigationMarker'), 'kept', 'Within-app traversal preserves the document')
  await click(forward)
  await until('Native Forward', async () => await address() === `${alpha}three`)
  await app.evaluate(`void window.qdnRequest({action:'OPEN_CURRENT_TAB', address:${JSON.stringify(`${beta}one`)}})`)
  app = await attach('NavigationBeta', 'one')
  assert.equal(await currentTab(), appTab)
  assert.equal(await countTabs(), tabs)
  await click(back)
  app = await attach('NavigationAlpha', 'three')
  await until('Cross-app Back URL', async () => await address() === `${alpha}three`)
  await click(back)
  app = await attach('NavigationAlpha', 'two')
  await until('Earlier Alpha deep URL', async () => await address() === `${alpha}two?room=7#message`)
  await click(forward)
  app = await attach('NavigationAlpha', 'three')
  await click(forward)
  app = await attach('NavigationBeta', 'one')
  assert.equal(await currentTab(), appTab)
  log('Native and cross-app Back/Forward passed')

  await app.evaluate(`window.__navigationMarker = 'underlying'`)
  await open('qortal-core://')
  await until('Docs visible URL', async () => (await address()).startsWith('qortal-core://'))
  await click(reload)
  await sleep(500)
  assert.equal(await app.evaluate('window.__navigationMarker'), 'underlying', 'Docs reload must not reload the hidden app')
  await click(back)
  await until('Docs Back to Beta', async () => await address() === `${beta}one`)
  assert.equal(await app.evaluate('window.__navigationMarker'), 'underlying')
  await click('.home-v2-tab[data-tab-id="settings"] button[role="tab"]')
  const beforeReload = counts.get('/admin/status') ?? 0
  await click(reload)
  await until('Settings Reload refreshes status', () => (counts.get('/admin/status') ?? 0) > beforeReload)
  assert.ok(await cdp.evaluate(`document.querySelector('.home-v2-page-slot:not([hidden]) .home-v2-settings-nav [aria-current="page"]')?.textContent.trim() === 'Appearance'`))
  shortcut('ctrl+w')
  await until('Settings closed', async () => await countTabs() === tabs - 1)
  shortcut('ctrl+shift+t')
  await until('Settings reopened', async () => await countTabs() === tabs)
  await until('Reopened section retained', () => cdp.evaluate(`document.querySelector('.home-v2-page-slot:not([hidden]) .home-v2-settings-nav [aria-current="page"]')?.textContent.trim() === 'Appearance'`))
  const reopenedSettings = await currentTab()
  assert.notEqual(reopenedSettings, 'settings')
  await click(`.home-v2-tab[data-tab-id="${appTab}"] button[role="tab"]`)
  shortcut('ctrl+w')
  await until('App closed', async () => await countTabs() === tabs - 1)
  await click(`.home-v2-tab[data-tab-id="${reopenedSettings}"] button[role="tab"]`)
  shortcut('ctrl+w')
  await until('Second internal close', async () => await countTabs() === tabs - 2)
  shortcut('ctrl+shift+t')
  await until('Mixed stack reopens internal first', () => cdp.evaluate(`!!document.querySelector('.home-v2-page-slot[data-internal-page="settings"]:not([hidden])')`))
  shortcut('ctrl+shift+t')
  await until('Mixed stack reopens app second', async () => await address() === `${beta}one`)
  assert.equal(await countTabs(), tabs)
  assert.notEqual(await currentTab(), appTab)
  log('Genuine Ctrl+W/Ctrl+Shift+T internal and mixed close order passed')
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(path.join(profile, 'navigation.png'), Buffer.from(screenshot.data, 'base64'))
  writeFileSync(path.join(profile, 'acceptance.json'), JSON.stringify({ passed: true, appTab, tabs,
    checks: ['Settings history', 'tab isolation', 'native traversal preserves document', 'cross-app deep URL traversal', 'transient address and reload isolation', 'internal status refresh', 'native keyboard internal/mixed reopen'] }, null, 2))
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
