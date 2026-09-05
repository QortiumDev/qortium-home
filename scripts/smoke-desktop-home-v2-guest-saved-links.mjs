#!/usr/bin/env node
// Real packaged UI + native QDN views, using two new unfunded scratch accounts.
// No production profile, live node, transaction, signing or publication is used.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Cdp, launchHomeV2, resolveAppImage, sleep } from './lib/home-v2-cdp.mjs'
import { launchHome, mainRequire } from './lib/electron-main-driver.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const profile = mkdtempSync(path.join(os.tmpdir(), 'home-guest-saved-links-'))
const password = randomUUID()
const log = (message) => console.log(`[guest-saved-links] ${message}`)
async function until(label, read, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await read()) return
    await sleep(150)
  }
  throw new Error(`Timed out: ${label}`)
}
const fixture = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', '*')
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
  if (request.method !== 'GET') { response.writeHead(405); response.end('Read-only fixture'); return }
  if (url.pathname.startsWith('/render/')) {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><html><body style="background:#244;color:white"><h1>Disposable account grants fixture</h1></body></html>')
    return
  }
  response.setHeader('Content-Type', 'application/json')
  let value = []
  if (url.pathname === '/admin/status') value = { height: 1, isSynchronizing: false, numberOfConnections: 1 }
  else if (url.pathname === '/admin/info') value = { buildVersion: 'smoke', currentTimestamp: Date.now() }
  else if (url.pathname.includes('/resource/status/')) value = { status: 'READY', id: 'READY', localChunkCount: 1, totalChunkCount: 1 }
  else if (url.pathname.includes('/resource/properties/')) value = { filename: 'index.html', mimeType: 'text/html', size: 200 }
  else if (url.pathname.includes('/resources/search')) value = [{ service: 'APP', name: 'GuestSavedFixture', identifier: 'default', size: 200 }]
  else if (url.pathname.startsWith('/names/GuestSavedFixture')) value = { name: 'GuestSavedFixture', owner: 'QFixture' }
  else if (url.pathname.startsWith('/addresses/')) value = { address: url.pathname.split('/').at(-1), publicKey: '' }
  response.end(JSON.stringify(value))
})
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${fixture.address().port}`
writeFileSync(path.join(profile, 'node-settings.json'), JSON.stringify({ mode: 'disabled', customUrl: '', apiKey: '' }))
writeFileSync(path.join(profile, 'qortal-node-settings.json'), JSON.stringify({ mode: 'custom', customUrl: origin, lastEnabledMode: 'custom' }))
process.env.XDG_CONFIG_HOME = path.join(profile, 'xdg')
process.env.QORTIUM_HOME_NODE_API_URL = origin
process.env.QORTIUM_HOME_QORTAL_NODE_API_URL = origin
delete process.env.DISPLAY
delete process.env.WAYLAND_DISPLAY
delete process.env.ELECTRON_RUN_AS_NODE

let home
let bootstrap
const apps = []
try {
  // Only this isolated unpackaged bootstrap redirects the native backup save
  // dialog. The subsequent packaged process runs unmodified, with real vaults.
  log('creating two disposable accounts and backups using the production vault/KDF')
  bootstrap = await launchHome({ repoRoot, profileDirectory: profile })
  log('disposable bootstrap ready')
  await bootstrap.main.evaluate(mainRequire(`
    let backupIndex = 0
    require('electron').dialog.showSaveDialog = async () => ({ canceled: false,
      filePath: ${JSON.stringify(profile)} + '/fixture-backup-' + (++backupIndex) + '.json' })
    return true
  `))
  const setup = await bootstrap.renderer((url) => url.includes('v2-live.html'), 'vault fixture setup')
  setup.close()
  log('creating fixture vaults')
  await bootstrap.main.evaluate(mainRequire(`
    const accounts = require(${JSON.stringify(path.join(repoRoot, 'dist-electron/accounts.js'))})
    const sender = require('electron').BrowserWindow.getAllWindows()[0].webContents
    globalThis.__fixtureResult = null
    globalThis.__fixturePromise = (async () => {
      for (const label of ['Guest smoke account A', 'Guest smoke account B']) {
        const result = await accounts.createWallet({sender}, label, ${JSON.stringify(password)})
        if (result.canceled) throw new Error('Fixture account creation canceled')
      }
      return accounts.getHomeV2VaultState().accounts.map(({id, label, addresses}) => ({id, label, address: addresses[0].address}))
    })().then(accounts => { globalThis.__fixtureResult = {accounts} },
      error => { globalThis.__fixtureResult = {error:error.message} })
    return true
  `))
  await until('disposable vault setup', () => bootstrap.main.evaluate('globalThis.__fixtureResult !== null'), 300_000)
  const created = await bootstrap.main.evaluate('globalThis.__fixtureResult')
  assert.ok(!created.error, created.error)
  const accountA = created.accounts.find((account) => account.label === 'Guest smoke account A')
  const accountB = created.accounts.find((account) => account.label === 'Guest smoke account B')
  assert.ok(accountA?.id && accountB?.id)
  assert.notEqual(accountA.address, accountB.address)
  bootstrap.main.close()
  await bootstrap.stop()
  bootstrap = null

  home = await launchHomeV2({ appImage: resolveAppImage(repoRoot), profile, portBase: 10100, log })
  const { cdp } = home
  const click = async (selector) => {
    // Dashboard accounts can sit below the viewport on the default Xvfb
    // window. Scroll presentation before calculating a genuine pointer hit.
    await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center', inline:'nearest', behavior:'instant'})`)
    const point = await cdp.box(selector)
    assert.ok(point, `missing ${selector}`)
    await cdp.click(point.x, point.y)
  }
  const key = async (name, keyCode) => {
    for (const type of ['keyDown', 'keyUp']) {
      await cdp.send('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: keyCode })
    }
  }
  const dashboardTab = '.home-v2-tab[data-internal-page="dashboard"] button[role="tab"]'
  const selectDefault = async (account) => {
    await click(dashboardTab)
    const selector = '.home-v2-page-slot:not([hidden]) .home-v2-account-select select'
    await until('Dashboard account selector', () => cdp.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`))
    const selection = await cdp.evaluate(`(() => {
      const select = document.querySelector(${JSON.stringify(selector)})
      const options = Array.from(select.options).filter(option => !option.matches(':disabled'))
      return {current: options.findIndex(option => option.value === select.value),
        target: options.findIndex(option => option.value === ${JSON.stringify(account.id ? `account:${account.id}` : 'none')})}
    })()`)
    assert.ok(selection.target >= 0, 'Target account must be an enabled selector option')
    assert.ok(selection.current >= 0, 'Current account must be an enabled selector option')
    // Genuine pointer + native-select keyboard interaction; do not call the
    // vault or dispatch a synthetic React change event to change defaults.
    // Arrow keys skip disabled options. Move from the current selection so
    // switching A/B never briefly selects the unrelated "no account" entry.
    await click(selector)
    // Chromium's native popup is a separate surface: close it, keeping the
    // select focused, so CDP keyboard events reach the actual form control.
    await key('Escape', 27)
    const delta = selection.target - selection.current
    if (account.id === null) {
      // One native selection change: choosing an account can remount the
      // Dashboard control, so never depend on focus across intermediate ones.
      assert.equal(selection.target, 0, 'No account must be the first enabled option')
      await key('Home', 36)
    } else {
      assert.ok(Math.abs(delta) <= 1, 'Fixture default changes must be adjacent')
      if (delta !== 0) await key(delta < 0 ? 'ArrowUp' : 'ArrowDown', delta < 0 ? 38 : 40)
    }
    await key('Enter', 13)
    await until(`default ${account.label}`, () => cdp.evaluate(`window.homeV2Vault.getState().then(state => state.selectedAccountId === ${JSON.stringify(account.id)})`))
  }
  const openFixture = async () => {
    await click('.home-v2-new-tab')
    await click('.home-v2-address input')
    await cdp.evaluate(`document.querySelector('.home-v2-address input').select()`)
    await cdp.send('Input.insertText', { text: 'qortal://APP/GuestSavedFixture/default' })
    await cdp.evaluate(`document.querySelector('.home-v2-address input').closest('form').requestSubmit()`)
    return attachFixture()
  }
  const attachFixture = async () => {
    let app
    let targetId
    await until('new native fixture app', async () => {
      const targets = await (await fetch(`http://127.0.0.1:${home.port}/json/list`)).json()
      const target = targets.find((target) => target.url.startsWith(`${origin}/render/`) && !apps.some((entry) => entry.targetId === target.id))
      if (!target) return false
      targetId = target.id
      app = new Cdp(target.webSocketDebuggerUrl)
      await app.ready
      return true
    })
    const tabId = await cdp.evaluate(`document.querySelector('.home-v2-tab button[role="tab"][aria-selected="true"]').closest('.home-v2-tab').dataset.tabId`)
    assert.ok(tabId)
    const entry = { app, targetId, tabId }
    apps.push(entry)
    await until('native app visible', () => app.evaluate(`document.visibilityState === 'visible'`))
    return entry
  }
  const activate = async (entry) => {
    await click(`.home-v2-tab[data-tab-id="${entry.tabId}"] button[role="tab"]`)
    await until('original native app visible', () => entry.app.evaluate(`document.visibilityState === 'visible'`))
  }
  const assertGuest = async (entry) => {
    assert.ok(await cdp.evaluate(`document.querySelector('.home-v2-account-button')?.getAttribute('aria-label')?.includes('No account')`))
    const result = await entry.app.evaluate(`window.qortalRequest({action:'GET_USER_ACCOUNT'})
      .then(value => ({resolved:true,address:value.address}), error => ({resolved:false,message:String(error?.message || error)}))`)
    assert.equal(result.resolved, false, 'A guest app must not receive the default wallet identity')
    assert.match(result.message, /no account|account.*selected/i)
  }
  const snapshot = () => cdp.evaluate(`JSON.parse(localStorage.getItem('qortium-home-bookmark-manager-snapshot') || 'null')`)
  const flatten = (items = []) => items.flatMap(item => item.type === 'folder' ? flatten(item.children) : [item])

  await until('initial restoration', () => existsSync(path.join(profile, 'home-v2-shell-state.json')))
  await cdp.evaluate(`(() => { [...document.querySelectorAll('.home-v2-welcome button')].find(button => button.textContent.trim() === 'Skip setup')?.click() })()`)
  await until('Dashboard', () => cdp.evaluate(`!!document.querySelector('.home-v2-page-slot[data-internal-page="dashboard"]:not([hidden])')`))

  // Make a guest tab, then select a real default before saving it. This proves
  // that save captures the displayed tab identity, not the global selection.
  await selectDefault({id:null,label:'No account'})
  const guest = await openFixture()
  await assertGuest(guest)
  await selectDefault(accountA)
  await activate(guest)
  await assertGuest(guest)
  log('guest native tab remains accountless while A is the default')

  await click('.home-v2-bookmarks-button')
  const always = await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll('.home-v2-bookmarks-menu__panel button')]
      .find(button => /always show/i.test(button.textContent || ''))
    if (!button) return null
    const rect = button.getBoundingClientRect()
    return {x:rect.left + rect.width / 2,y:rect.top + rect.height / 2}
  })()`)
  assert.ok(always, 'Always show bookmarks toolbar option')
  await cdp.click(always.x, always.y)
  await until('bookmarks toolbar', () => cdp.evaluate(`!!document.querySelector('.home-v2-bookmark-toolbar')`))
  const tab = await cdp.box(`.home-v2-tab[data-tab-id="${guest.tabId}"] button[role="tab"]`)
  const toolbar = await cdp.box('.home-v2-bookmark-toolbar')
  assert.ok(tab && toolbar)
  await cdp.drag(tab, toolbar)
  let saved
  await until('guest saved to toolbar', async () => {
    saved = flatten((await snapshot())?.toolbar).find(link => link.displayUrl.includes('GuestSavedFixture'))
    return !!saved
  })
  assert.equal(saved.accountId, 'home-v2:guest', 'Saving an explicit guest must not store legacy Current/null')
  log('real tab-to-toolbar gesture persisted explicit guest binding')

  await click(`.home-v2-tab[data-tab-id="${guest.tabId}"] .home-v2-tab__close`)
  await until('original guest tab closed', () => cdp.evaluate(`!document.querySelector('.home-v2-tab[data-tab-id="${guest.tabId}"]')`))
  await selectDefault(accountB)
  await click(`.home-v2-bookmark-toolbar__item[data-bookmark-id="${saved.id}"]`)
  const reopened = await attachFixture()
  await assertGuest(reopened)
  assert.equal(await cdp.evaluate(`window.homeV2Vault.getState().then(state => state.selectedAccountId)`), accountB.id)
  assert.equal(flatten((await snapshot()).toolbar).find(link => link.id === saved.id)?.accountId, 'home-v2:guest')
  writeFileSync(path.join(profile, 'acceptance.json'), JSON.stringify({
    passed:true, appImage:resolveAppImage(repoRoot), savedAccountId:saved.accountId,
    checks:['guest-tab-with-real-default', 'genuine-tab-toolbar-save', 'persisted-explicit-guest', 'close-reopen-after-default-change', 'native-app-identity-remains-none'],
  }, null, 2))
  log(`PASS: guest saved link reopened without default wallet identity. Isolated receipt: ${profile}`)
} catch (error) {
  if (home) log(JSON.stringify(await home.cdp.evaluate(`({
    address: document.querySelector('.home-v2-address input')?.value,
    account: document.querySelector('.home-v2-account-button')?.getAttribute('aria-label'),
    permission: document.querySelector('.home-v2-permission-dialog')?.getAttribute('data-bridge-action'),
    accountSelects: [...document.querySelectorAll('.home-v2-account-select select')].map(select => ({
      value: select.value,
      focused: document.activeElement === select,
      options: [...select.options].map(option => ({value: option.value, disabled: option.matches(':disabled')}))
    }))
  })`).catch(() => ({shell: 'closed'}))))
  throw error
} finally {
  bootstrap?.main.close()
  await bootstrap?.stop()
  for (const entry of apps) entry.app.socket.close()
  home?.cdp.socket.close()
  home?.shutdown()
  fixture.closeAllConnections()
  fixture.close()
  // Keep only this newly-created temporary profile as acceptance evidence.
}
