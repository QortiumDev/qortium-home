#!/usr/bin/env node
// Real packaged UI, native QDN view and disposable vault. No live node/account.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Cdp, launchHomeV2, resolveAppImage, sleep } from './lib/home-v2-cdp.mjs'
import { launchHome, mainRequire } from './lib/electron-main-driver.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const profile = mkdtempSync(path.join(os.tmpdir(), 'home-inline-unlock-'))
const password = randomUUID()
const log = (message) => console.log(`[inline-unlock] ${message}`)
async function until(label, read, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await read()) return
    await sleep(150)
  }
  throw new Error(`Timed out: ${label}`)
}
const node = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', '*')
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
  if (url.pathname.startsWith('/render/')) {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><html><body style="background:#244;color:white"><h1>Disposable unlock fixture</h1><input aria-label="App input"></body></html>')
    return
  }
  response.setHeader('Content-Type', 'application/json')
  let value = []
  if (url.pathname === '/admin/status') value = { height: 1, isSynchronizing: false, numberOfConnections: 1 }
  else if (url.pathname === '/admin/info') value = { buildVersion: 'smoke', currentTimestamp: Date.now() }
  else if (url.pathname.includes('/resource/status/')) value = { status: 'READY', id: 'READY', localChunkCount: 1, totalChunkCount: 1 }
  else if (url.pathname.includes('/resource/properties/')) value = { filename: 'index.html', mimeType: 'text/html', size: 200 }
  else if (url.pathname.includes('/resources/search')) value = [{ service: 'APP', name: 'UnlockFixture', identifier: 'default', size: 200 }]
  else if (url.pathname.startsWith('/names/UnlockFixture')) value = { name: 'UnlockFixture', owner: 'QFixture' }
  response.end(JSON.stringify(value))
})
await new Promise((resolve) => node.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${node.address().port}`
writeFileSync(path.join(profile, 'node-settings.json'), JSON.stringify({ mode: 'disabled', customUrl: '', apiKey: '' }))
writeFileSync(path.join(profile, 'qortal-node-settings.json'), JSON.stringify({ mode: 'custom', customUrl: origin, lastEnabledMode: 'custom' }))
// Isolate service-discovery paths too, and never open a window on the desktop.
process.env.XDG_CONFIG_HOME = path.join(profile, 'xdg')
process.env.QORTIUM_HOME_NODE_API_URL = origin
process.env.QORTIUM_HOME_QORTAL_NODE_API_URL = origin
delete process.env.DISPLAY
delete process.env.WAYLAND_DISPLAY
delete process.env.ELECTRON_RUN_AS_NODE

let home
let app
let bootstrap
try {
  // Account creation requires saving a backup. Bootstrap the same production
  // vault in an isolated unpackaged process, redirecting ONLY its save dialog
  // to this disposable profile. The packaged app itself has no stubs/hooks.
  log('creating disposable account and backup using the normal vault/KDF')
  bootstrap = await launchHome({ repoRoot, profileDirectory: profile })
  await bootstrap.main.evaluate(mainRequire(`
    require('electron').dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(path.join(profile, 'test-wallet-backup.json'))} })
    return true
  `))
  const setup = await bootstrap.renderer((url) => url.includes('v2-live.html'), 'vault fixture setup')
  setup.close()
  await bootstrap.main.evaluate(mainRequire(`
    const accounts = require(${JSON.stringify(path.join(repoRoot, 'dist-electron/accounts.js'))})
    const sender = require('electron').BrowserWindow.getAllWindows()[0].webContents
    globalThis.__fixtureResult = null
    globalThis.__fixturePromise = accounts.createWallet({sender}, 'Unlock smoke', ${JSON.stringify(password)})
      .then(r => { globalThis.__fixtureResult = {canceled:r.canceled,id:accounts.getHomeV2VaultState().accounts[0]?.id} },
        e => { globalThis.__fixtureResult = {error:e.message} })
    return true
  `))
  await until('disposable vault setup', () => bootstrap.main.evaluate('globalThis.__fixtureResult !== null'), 180_000)
  const created = await bootstrap.main.evaluate('globalThis.__fixtureResult')
  assert.ok(!created.error, created.error)
  assert.equal(created.canceled, false)
  const accountId = created.id
  assert.ok(accountId)
  bootstrap.main.close()
  await bootstrap.stop()
  bootstrap = null
  home = await launchHomeV2({ appImage: resolveAppImage(repoRoot), profile, portBase: 9700, log })
  const { cdp } = home
  const click = async (selector) => {
    const point = await cdp.box(selector)
    assert.ok(point, `missing ${selector}`)
    await cdp.click(point.x, point.y)
  }
  await until('initial restoration', () => existsSync(path.join(profile, 'home-v2-shell-state.json')))
  await cdp.evaluate(`(() => {
    [...document.querySelectorAll('.home-v2-welcome button')].find((b) => b.textContent.trim() === 'Skip setup')?.click()
  })()`)
  await until('Dashboard', () => cdp.evaluate(`!!document.querySelector('.home-v2-page-slot[data-internal-page="dashboard"]:not([hidden])')`))
  await until('created account option', () => cdp.evaluate(`!!document.querySelector('option[value="account:${accountId}"]')`))
  await cdp.evaluate(`(() => {
    const select = document.querySelector('.home-v2-page-slot:not([hidden]) .home-v2-account-select select')
    select.value = ${JSON.stringify(`account:${accountId}`)}
    select.dispatchEvent(new Event('change', {bubbles: true}))
    return true
  })()`)
  await until('account catalogue', () => cdp.evaluate(`document.querySelector('.home-v2-account-button')?.getAttribute('aria-label')?.includes('Unlock smoke')`))
  log('opening local native fixture app')
  await click('.home-v2-address input')
  await cdp.evaluate(`document.querySelector('.home-v2-address input').select()`)
  await cdp.send('Input.insertText', { text: 'qortal://APP/UnlockFixture/default' })
  await cdp.evaluate(`document.querySelector('.home-v2-address input').closest('form').requestSubmit()`)
  await until('native fixture app', async () => {
    const targets = await (await fetch(`http://127.0.0.1:${home.port}/json/list`)).json()
    const target = targets.find((target) => target.url.startsWith(`${origin}/render/`))
    if (!target) return false
    app = new Cdp(target.webSocketDebuggerUrl)
    await app.ready
    return true
  })
  await until('native app visible', () => app.evaluate(`document.visibilityState === 'visible'`))
  // The new process starts locked; exercise its normal unlock UI.
  await until('locked account', () => cdp.evaluate(`document.querySelector('.home-v2-account-button')?.dataset.accountState === 'locked'`))
  await click('.home-v2-account-button')
  await until('inline form', () => cdp.evaluate(`!!document.querySelector('.home-v2-inline-unlock input[type="password"]')`))
  await until('native view suspended for menu', () => app.evaluate(`document.visibilityState === 'hidden'`))
  const field = '.home-v2-inline-unlock input[type="password"]'
  await click(field)
  await cdp.send('Input.insertText', { text: 'incorrect-test-password' })
  await click('.home-v2-inline-unlock button[type="submit"]')
  await until('inline wrong-password error', () => cdp.evaluate(`!!document.querySelector('.home-v2-inline-unlock [role="alert"]')`))
  assert.equal(await app.evaluate('document.visibilityState'), 'hidden')
  assert.equal(await cdp.evaluate(`!!document.querySelector('.home-v2-dialog-backdrop')`), false)
  await click(field)
  await cdp.send('Input.insertText', { text: password })
  const screenshot = await cdp.send('Page.captureScreenshot')
  writeFileSync(path.join(profile, 'inline-unlock.png'), Buffer.from(screenshot.data, 'base64'))
  await click('.home-v2-inline-unlock button[type="submit"]')
  await until('successful real vault unlock', () => cdp.evaluate(`document.querySelector('.home-v2-account-button')?.dataset.accountState === 'unlocked'`))
  await until('native app restored', () => app.evaluate(`document.visibilityState === 'visible'`))
  assert.equal(await cdp.evaluate(`window.homeV2Vault.getState().then(s => s.accounts.find(a => a.id === ${JSON.stringify(accountId)})?.isUnlocked)`), true)
  log('native-view suspension, real pointer/password entry, wrong-password retry and unlock passed')

  await click('.home-v2-account-button')
  await click('.home-v2-account-button + .home-v2-chrome-menu__panel > button')
  await until('relocked', () => cdp.evaluate(`document.querySelector('.home-v2-account-button')?.dataset.accountState === 'locked'`))
  await click('.home-v2-account-button')
  await click(field)
  await cdp.send('Input.insertText', { text: 'discard-me' })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await until('Escape dismisses', () => cdp.evaluate(`!document.querySelector('.home-v2-inline-unlock')`))
  await click('.home-v2-account-button')
  assert.equal(await cdp.evaluate(`document.querySelector(${JSON.stringify(field)}).value`), '')
  await click('.home-v2-inline-unlock button[type="button"]')
  await click('.home-v2-account-button')
  // This is the reported failure: a real mouse click must reach the tab strip.
  await click('.home-v2-tab[data-internal-page="dashboard"] button[role="tab"]')
  await until('mouse tab switching', () => cdp.evaluate(`document.querySelector('.home-v2-tab[data-internal-page="dashboard"] button[role="tab"]')?.getAttribute('aria-selected') === 'true'`))
  assert.equal(await cdp.evaluate(`!!document.querySelector('.home-v2-inline-unlock')`), false)
  log('Escape/Cancel, password clearing and mouse tab switching passed')
  // App-requested unlock must still use the original requester-owned dialog.
  await click('.home-v2-tab:not([data-internal-page]) button[role="tab"]')
  await until('app visible again', () => app.evaluate(`document.visibilityState === 'visible'`))
  await app.evaluate(`(() => {
    window.__unlockResult = 'pending'
    window.qortalRequest({action:'UNLOCK_SELECTED_ACCOUNT'})
      .then(() => { window.__unlockResult = 'approved' }, () => { window.__unlockResult = 'denied' })
    return true
  })()`)
  await until('requester-owned unlock dialog', () => cdp.evaluate(`!!document.querySelector('.home-v2-account-dialog')`))
  await until('requester native view suspended', () => app.evaluate(`document.visibilityState === 'hidden'`))
  assert.equal(await cdp.evaluate(`!!document.querySelector('.home-v2-inline-unlock')`), false)
  await click('.home-v2-account-dialog .home-v2-dialog-close')
  await until('app request explicitly denied', () => app.evaluate(`window.__unlockResult === 'denied'`))
  await until('app restored after denial', () => app.evaluate(`document.visibilityState === 'visible'`))
  log(`PASS: separate app-requested unlock/cancel. Isolated receipt: ${profile}`)
} catch (error) {
  if (home) {
    log(JSON.stringify(await home.cdp.evaluate(`({
      address: document.querySelector('.home-v2-address input')?.value,
      stage: document.querySelector('.home-v2-app-stage')?.textContent,
      message: document.querySelector('.home-v2-address-result')?.textContent,
      account: document.querySelector('.home-v2-account-button')?.getAttribute('aria-label')
    })`).catch(() => ({ shell: 'closed' }))))
  }
  throw error
} finally {
  bootstrap?.main.close()
  await bootstrap?.stop()
  app?.socket.close()
  home?.cdp.socket.close()
  home?.shutdown()
  node.closeAllConnections()
  node.close()
  // Keep this newly-created temporary profile/screenshot as acceptance evidence.
}
