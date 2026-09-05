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
const profile = mkdtempSync(path.join(os.tmpdir(), 'home-default-account-grants-'))
const password = randomUUID()
const log = (message) => console.log(`[default-account-grants] ${message}`)
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
  else if (url.pathname.includes('/resources/search')) value = [{ service: 'APP', name: 'AccountGrantsFixture', identifier: 'default', size: 200 }]
  else if (url.pathname.startsWith('/names/AccountGrantsFixture')) value = { name: 'AccountGrantsFixture', owner: 'QFixture' }
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
      for (const label of ['Grant account A', 'Grant account B']) {
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
  const accountA = created.accounts.find((account) => account.label === 'Grant account A')
  const accountB = created.accounts.find((account) => account.label === 'Grant account B')
  assert.ok(accountA?.id && accountB?.id)
  assert.notEqual(accountA.address, accountB.address)
  bootstrap.main.close()
  await bootstrap.stop()
  bootstrap = null

  home = await launchHomeV2({ appImage: resolveAppImage(repoRoot), profile, portBase: 9900, log })
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
        target: options.findIndex(option => option.value === ${JSON.stringify(`account:${account.id}`)})}
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
    for (let option = 0; option < Math.abs(delta); option++) {
      await key(delta < 0 ? 'ArrowUp' : 'ArrowDown', delta < 0 ? 38 : 40)
    }
    await key('Enter', 13)
    await until(`default ${account.label}`, () => cdp.evaluate(`window.homeV2Vault.getState().then(state => state.selectedAccountId === ${JSON.stringify(account.id)})`))
  }
  const openFixture = async () => {
    await click('.home-v2-new-tab')
    await click('.home-v2-address input')
    await cdp.evaluate(`document.querySelector('.home-v2-address input').select()`)
    await cdp.send('Input.insertText', { text: 'qortal://APP/AccountGrantsFixture/default' })
    await cdp.evaluate(`document.querySelector('.home-v2-address input').closest('form').requestSubmit()`)
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
  const unlock = async () => {
    await until('locked account', () => cdp.evaluate(`document.querySelector('.home-v2-account-button')?.dataset.accountState === 'locked'`))
    await click('.home-v2-account-button')
    const field = '.home-v2-inline-unlock input[type="password"]'
    await until('inline unlock form', () => cdp.evaluate(`!!document.querySelector(${JSON.stringify(field)})`))
    await click(field)
    await cdp.send('Input.insertText', { text: password })
    await click('.home-v2-inline-unlock button[type="submit"]')
    await until('real vault unlocked', () => cdp.evaluate(`document.querySelector('.home-v2-account-button')?.dataset.accountState === 'unlocked'`))
  }
  const request = async (entry, action) => {
    await entry.app.evaluate(`(() => {
      window.__fixtureRequest = {state: 'pending'}
      window.qortalRequest(${JSON.stringify({ action, ...(action === 'ENCRYPT_DATA' ? { data64: Buffer.from('Disposable public smoke fixture').toString('base64'), publicKeys: [] } : {}) })})
        .then(value => { window.__fixtureRequest = {state:'resolved', value} },
          error => { window.__fixtureRequest = {state:'rejected', error: String(error?.message || error), code: error?.code} })
      return true
    })()`)
  }
  const approve = async (action) => {
    await until(`${action} permission prompt`, () => cdp.evaluate(`!!document.querySelector('.home-v2-permission-dialog[data-bridge-action="${action}"]')`))
    await click('.home-v2-permission-allow[data-permission-scope="session"]')
  }
  const resolved = async (entry, noPrompt = false) => {
    await until('bridge request completion', async () => {
      if (noPrompt) assert.equal(await cdp.evaluate(`!!document.querySelector('.home-v2-permission-dialog')`), false, 'Existing tab grant was unexpectedly lost')
      return entry.app.evaluate(`window.__fixtureRequest.state !== 'pending'`)
    })
    const result = await entry.app.evaluate('window.__fixtureRequest')
    assert.equal(result.state, 'resolved', result.error)
    return result.value
  }
  const encrypt = async (entry, expectPrompt) => {
    await request(entry, 'ENCRYPT_DATA')
    if (expectPrompt) await approve('ENCRYPT_DATA')
    const value = await resolved(entry, !expectPrompt)
    assert.equal(typeof value, 'string')
    assert.ok(value.length > 100, 'Expected a real encrypted envelope')
  }

  await until('initial restoration', () => existsSync(path.join(profile, 'home-v2-shell-state.json')))
  await cdp.evaluate(`(() => { [...document.querySelectorAll('.home-v2-welcome button')].find(button => button.textContent.trim() === 'Skip setup')?.click() })()`)
  await until('Dashboard', () => cdp.evaluate(`!!document.querySelector('.home-v2-page-slot[data-internal-page="dashboard"]:not([hidden])')`))
  await selectDefault(accountA)
  const appA = await openFixture()
  await unlock()
  // Identity is intentionally permissionless; ENCRYPT_DATA is the real
  // session-consent probe. Use GET_USER_ACCOUNT on the enabled Qortal fixture
  // route; qdnRequest GET_SELECTED_ACCOUNT refuses with Qortium disabled.
  await request(appA, 'GET_USER_ACCOUNT')
  assert.equal((await resolved(appA, true)).address, accountA.address)
  await encrypt(appA, true)
  log('A native tab has verified identity and a real encryption session grant')

  await selectDefault(accountB)
  await activate(appA)
  assert.ok(await cdp.evaluate(`document.querySelector('.home-v2-account-button').getAttribute('aria-label').includes('Grant account A')`))
  await request(appA, 'GET_USER_ACCOUNT')
  assert.equal((await resolved(appA, true)).address, accountA.address)
  await encrypt(appA, false)
  log('changing default to B preserved A identity, native view and encryption session grant')

  // A fresh tab of the SAME app under B must not inherit A's authority.
  await click(dashboardTab)
  const appB = await openFixture()
  await unlock()
  await request(appB, 'GET_USER_ACCOUNT')
  assert.equal((await resolved(appB, true)).address, accountB.address)
  await encrypt(appB, true)
  log('same app under B separately prompted and returned B identity')

  await activate(appA)
  await click('.home-v2-account-button')
  await click('.home-v2-account-button + .home-v2-chrome-menu__panel > button')
  await until('A relocked', () => cdp.evaluate(`document.querySelector('.home-v2-account-button')?.dataset.accountState === 'locked'`))
  await request(appA, 'ENCRYPT_DATA')
  await until('locked A refuses encryption', () => appA.app.evaluate(`window.__fixtureRequest.state !== 'pending'`))
  const refused = await appA.app.evaluate('window.__fixtureRequest')
  assert.equal(refused.state, 'rejected')
  assert.match(refused.error, /locked/i)
  assert.equal(await cdp.evaluate(`!!document.querySelector('.home-v2-permission-dialog')`), false)
  await unlock()
  await encrypt(appA, true)
  log('real lock refused key use and revoked A grant: fresh approval required after unlock')
  // Lock/removal keeps the existing conservative host-wide invalidation for
  // non-account.read grants. This test does not narrow that security policy.
  writeFileSync(path.join(profile, 'acceptance.json'), JSON.stringify({
    passed: true, appImage: resolveAppImage(repoRoot), accountA: accountA.address, accountB: accountB.address,
    checks: ['default-change-preserves-native-tab-identity', 'permissionless-selected-identity', 'encryption-session-preserved', 'other-account-separate-consent', 'lock-refuses-key-use', 'lock-revokes-grant'],
  }, null, 2))
  log(`PASS. Isolated receipt: ${profile}`)
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
