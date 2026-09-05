#!/usr/bin/env node
// Real packaged UI + native QDN views, using two new unfunded scratch accounts.
// No production profile, live node, transaction, signing or publication is used.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Cdp, launchHomeV2, resolveAppImage, sleep } from './lib/home-v2-cdp.mjs'
import { launchHome, mainRequire } from './lib/electron-main-driver.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const profile = mkdtempSync(path.join(os.tmpdir(), 'home-account-launch-'))
const password = randomUUID()
const log = (message) => console.log(`[account-launch] ${message}`)
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
  else if (url.pathname.includes('/resources/search')) value = [{ service: 'APP', name: 'AccountLaunchFixture', identifier: 'default', size: 200 }]
  else if (url.pathname.startsWith('/names/AccountLaunchFixture')) value = { name: 'AccountLaunchFixture', owner: 'QFixture' }
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
process.env.XDG_SESSION_TYPE = 'x11'
process.env.ELECTRON_OZONE_PLATFORM_HINT = 'x11'

let home
let bootstrap
let nativeXServer
let nativeWindowManager
process.once('exit', () => { nativeWindowManager?.kill(); nativeXServer?.kill() })
const apps = []
try {
  // Only this isolated unpackaged bootstrap redirects the native backup save
  // dialog. The subsequent packaged process runs unmodified, with real vaults.
  log('creating two disposable accounts and backups using the production vault/KDF')
  bootstrap = await launchHome({ repoRoot, profileDirectory: profile })
  log('disposable bootstrap ready')
  // These main-inspector expressions return only immediate scalars/objects.
  // Explicitly avoid awaitPromise: inspector promise collection can otherwise
  // race the vault's asynchronous KDF. The actual work is pinned globally and
  // polled below, never awaited through the inspector.
  const mainSnapshot = async (expression) => {
    const result = await bootstrap.main.send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:false})
    assert.ok(!result.exceptionDetails, result.exceptionDetails?.text)
    return result.result?.value
  }
  await mainSnapshot(mainRequire(`
    let backupIndex = 0
    require('electron').dialog.showSaveDialog = async () => ({ canceled: false,
      filePath: ${JSON.stringify(profile)} + '/fixture-backup-' + (++backupIndex) + '.json' })
    return true
  `))
  const setup = await bootstrap.renderer((url) => url.includes('v2-live.html'), 'vault fixture setup')
  setup.close()
  log('creating fixture vaults')
  await mainSnapshot(mainRequire(`
    const accounts = require(${JSON.stringify(path.join(repoRoot, 'dist-electron/accounts.js'))})
    const sender = require('electron').BrowserWindow.getAllWindows()[0].webContents
    globalThis.__fixtureResult = null
    globalThis.__fixturePromise = (async () => {
      for (const label of ['Launch account A', 'Launch account B']) {
        const result = await accounts.createWallet({sender}, label, ${JSON.stringify(password)})
        if (result.canceled) throw new Error('Fixture account creation canceled')
      }
      return accounts.getHomeV2VaultState().accounts.map(({id, label, addresses}) => ({id, label, address: addresses[0].address}))
    })().then(accounts => { globalThis.__fixtureResult = {accounts} },
      error => { globalThis.__fixtureResult = {error:error.message} })
    return true
  `))
  log('fixture creation dispatched')
  await until('disposable vault setup', () => mainSnapshot('globalThis.__fixtureResult !== null'), 300_000)
  const created = await mainSnapshot('globalThis.__fixtureResult')
  assert.ok(!created.error, created.error)
  const accountA = created.accounts.find((account) => account.label === 'Launch account A')
  const accountB = created.accounts.find((account) => account.label === 'Launch account B')
  assert.ok(accountA?.id && accountB?.id)
  assert.notEqual(accountA.address, accountB.address)
  bootstrap.main.close()
  await bootstrap.stop()
  bootstrap = null

  // Menu accelerators need an OS-focused BrowserWindow, not just a CDP-focused
  // DOM element. Allocate a collision-free private display and real WM. Never
  // send X11 input to the user's desktop or another smoke's X server.
  nativeXServer = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1100x720x24', '-nolisten', 'tcp'],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] })
  const display = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('Private X display startup timed out')), 10_000)
    nativeXServer.once('error', error => { clearTimeout(timer); reject(error) })
    nativeXServer.stdio[3].on('data', data => {
      output += data.toString()
      if (/^\d+\n$/.test(output)) { clearTimeout(timer); resolve(`:${output.trim()}`) }
    })
  })
  process.env.DISPLAY = display
  nativeWindowManager = spawn('openbox', [], { stdio: 'ignore', env: { ...process.env } })
  nativeWindowManager.on('error', error => log(`Window manager error: ${error.message}`))
  await sleep(1000)
  home = await launchHomeV2({ appImage: resolveAppImage(repoRoot), profile, portBase: 10300,
    appArgs: ['--ozone-platform=x11'], log })
  const nativeInput = (args) => {
    const result = spawnSync('xdotool', args, { encoding: 'utf8', env: { ...process.env, DISPLAY: display } })
    assert.equal(result.status, 0, result.stderr || result.error?.message || `xdotool ${args.join(' ')}`)
    return result.stdout.trim()
  }
  // The shell updates its native title to the selected page. Match the only
  // normal-sized application window on this private display, not that title.
  const nativeWindowIds = nativeInput(['search', '--onlyvisible', '--class', '.']).split('\n').filter(Boolean)
    .filter(id => {
      const size = /Geometry:\s*(\d+)x(\d+)/.exec(nativeInput(['getwindowgeometry', id]))
      return size && Number(size[1]) >= 400 && Number(size[2]) >= 300
    })
  assert.equal(nativeWindowIds.length, 1, 'The private display must have exactly one Home window')
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
  const openFixture = async (identifier = 'default') => {
    await click('.home-v2-new-tab')
    await click('.home-v2-address input')
    await cdp.evaluate(`document.querySelector('.home-v2-address input').select()`)
    await cdp.send('Input.insertText', { text: `qortal://APP/AccountLaunchFixture/${identifier}` })
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
  const identity = (entry) => entry.app.evaluate(`window.qortalRequest({action:'GET_USER_ACCOUNT'})
    .then(value => ({resolved:true,address:value.address}), error => ({resolved:false,message:String(error?.message || error)}))`)
  const assertDefaultA = async () => {
    assert.equal(await cdp.evaluate(`window.homeV2Vault.getState().then(state => state.selectedAccountId)`), accountA.id)
  }
  let launcherScreenshotSaved = false
  const launchAs = async (source, account) => {
    await activate(source)
    await click('.home-v2-account-button')
    const selector = '[data-home-v2-account-tab-target]'
    await until('account-specific tab launcher', () => cdp.evaluate(`!!document.querySelector('${selector}')`))
    if (!launcherScreenshotSaved) {
      await cdp.evaluate(`document.querySelector('[data-home-v2-account-tab-launcher]').scrollIntoView({block:'nearest', inline:'nearest', behavior:'instant'})`)
      const screenshot = await cdp.send('Page.captureScreenshot')
      writeFileSync(path.join(profile, 'account-launcher.png'), Buffer.from(screenshot.data, 'base64'))
      launcherScreenshotSaved = true
    }
    const value = account ? `account:${account.id}` : 'none'
    const selection = await cdp.evaluate(`(() => {
      const select = document.querySelector('${selector}')
      const options = [...select.options].filter(option => !option.matches(':disabled'))
      return {current:options.findIndex(option => option.value === select.value),
        target:options.findIndex(option => option.value === ${JSON.stringify(value)})}
    })()`)
    assert.ok(selection.target >= 0, 'Requested account must be available in launcher')
    assert.ok(selection.current >= 0, 'Fixture starts with an available source account')
    // Real native select input. Do not dispatch React events or call the
    // production open handler directly. Escape would dismiss the whole menu.
    await click(selector)
    const delta = selection.target - selection.current
    for (let option = 0; option < Math.abs(delta); option++) {
      await key(delta < 0 ? 'ArrowUp' : 'ArrowDown', delta < 0 ? 38 : 40)
    }
    await key('Enter', 13)
    await until('chosen account launch target', () => cdp.evaluate(`document.querySelector('${selector}')?.value === ${JSON.stringify(value)}`))
    await click('[data-home-v2-account-tab-open]')
    const launched = await attachFixture()
    assert.notEqual(launched.tabId, source.tabId, 'Account launch must create a distinct tab')
    assert.notEqual(launched.targetId, source.targetId, 'Account launch must create a distinct native view')
    await assertDefaultA()
    return launched
  }

  await until('initial restoration', () => existsSync(path.join(profile, 'home-v2-shell-state.json')))
  // The bootstrap already wrote the state file; its existence is not proof
  // this packaged renderer has finished restoring or mounted Welcome yet.
  await until('Welcome ready to skip', () => cdp.evaluate(`!!document.querySelector('.home-v2-welcome__header .home-v2-link-button')?.getClientRects().length`))
  await click('.home-v2-welcome__header .home-v2-link-button')
  await until('Skip setup persisted', () => JSON.parse(readFileSync(path.join(profile,'home-v2-shell-state.json'),'utf8')).onboarding?.status === 'skipped')
  await until('Dashboard', () => cdp.evaluate(`!!document.querySelector('.home-v2-page-slot[data-internal-page="dashboard"]:not([hidden])')`))
  await selectDefault(accountA)
  // Seed only disposable saved-link data, then exercise the real packaged
  // Dashboard with its production vault catalogue. No renderer methods mocked.
  const pinCases = [
    ['pin-current', null, 'Current'],
    ['pin-guest', 'home-v2:guest', 'No account'],
    ['pin-saved', accountB.id, accountB.label],
    ['pin-removed', 'wallet:removed-fixture', 'Account unavailable'],
  ]
  const pinFixture = pinCases.map(([id, accountId], index) => ({
    id, accountId, createdAt: index + 1, label: id,
    // Use distinct explicit resource identifiers, not ambiguous default-app
    // path segments (the resource-identity guard deliberately rejects those).
    displayUrl: `qortal://APP/AccountLaunchFixture/${id}`,
  }))
  pinFixture.push({ id: 'pin-home', accountId: null, createdAt: 5,
    label: 'Dashboard', displayUrl: 'home://dashboard' })
  await cdp.evaluate(`(() => {
    const key = 'qortium-home-bookmark-manager-snapshot'
    const snapshot = JSON.parse(localStorage.getItem(key))
    snapshot.dashboardPins = ${JSON.stringify(pinFixture)}
    snapshot.revision++
    localStorage.setItem(key, JSON.stringify(snapshot))
  })()`)
  await cdp.send('Page.reload', { ignoreCache: true })
  await until('pin attribution from real vault catalogue', () => cdp.evaluate(`
    document.querySelector('[data-pin-id="pin-saved"] .home-v2-pinned-apps__account')?.textContent === ${JSON.stringify(accountB.label)}
  `))
  await click(dashboardTab)
  for (const [id, , label] of pinCases) {
    const state = await cdp.evaluate(`(() => {
      const button = document.querySelector('[data-pin-id="${id}"] .home-v2-pinned-apps__open')
      const description = document.getElementById(button.getAttribute('aria-describedby'))
      const tile = button.getBoundingClientRect(), caption = description.getBoundingClientRect()
      return {label: description.textContent, title: button.title, disabled: button.disabled,
        fits: caption.top >= tile.top && caption.bottom <= tile.bottom && caption.width <= tile.width}
    })()`)
    assert.equal(state.label, label)
    assert.ok(state.title.endsWith(label))
    assert.equal(state.disabled, false)
    assert.ok(state.fits, 'Caption must fit its tile without shrinking the app icon')
  }
  assert.equal(await cdp.evaluate(`document.querySelector('[data-pin-id="pin-home"] .home-v2-pinned-apps__account')`), null)
  await cdp.evaluate(`document.querySelector('.home-v2-pinned-apps').scrollIntoView({block:'center', behavior:'instant'})`)
  const pinScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(path.join(profile, 'pin-accounts.png'), pinScreenshot.data, 'base64')
  // Changing the default cannot relabel an explicitly saved or Current pin.
  await selectDefault(accountB)
  assert.equal(await cdp.evaluate(`document.querySelector('[data-pin-id="pin-current"] .home-v2-pinned-apps__account').textContent`), 'Current')
  await selectDefault(accountA)
  await click('[data-pin-id="pin-saved"] .home-v2-pinned-apps__open')
  const pinnedB = await attachFixture()
  assert.deepEqual(await identity(pinnedB), {resolved:true,address:accountB.address})
  await assertDefaultA()
  log('Dashboard pin labels, full descriptions, tile fit and saved-B opening under default A passed')
  const original = await openFixture()
  assert.deepEqual(await identity(original), {resolved:true,address:accountA.address})
  const underB = await launchAs(original, accountB)
  assert.deepEqual(await identity(underB), {resolved:true,address:accountB.address})
  await activate(original)
  assert.deepEqual(await identity(original), {resolved:true,address:accountA.address})
  log('same app opened under B in distinct native tab; source A and default A unchanged')

  const duplicateA = await launchAs(original, accountA)
  assert.deepEqual(await identity(duplicateA), {resolved:true,address:accountA.address})
  assert.notEqual(duplicateA.tabId, underB.tabId)
  log('duplicating A created a distinct same-account native tab')

  const guest = await launchAs(original, null)
  const guestIdentity = await identity(guest)
  assert.equal(guestIdentity.resolved, false, 'No account launch must not expose the default account')
  assert.match(guestIdentity.message, /no account|account.*selected/i)
  assert.ok(await cdp.evaluate(`document.querySelector('.home-v2-account-button')?.getAttribute('aria-label')?.includes('No account')`))
  await activate(original)
  assert.deepEqual(await identity(original), {resolved:true,address:accountA.address})
  await activate(underB)
  assert.deepEqual(await identity(underB), {resolved:true,address:accountB.address})
  await assertDefaultA()
  const reopen = async (closed) => {
    await activate(closed)
    await click(`.home-v2-tab[data-tab-id="${closed.tabId}"] .home-v2-tab__close`)
    await until('closed tab removed', () => cdp.evaluate(`!document.querySelector('.home-v2-tab[data-tab-id="${closed.tabId}"]')`))
    // Focus chrome and use the real Electron Reopen Closed Tab accelerator;
    // no direct invocation of the renderer callback or menu bridge.
    await click('.home-v2-address input')
    nativeInput(['windowactivate', '--sync', nativeWindowIds[0]])
    nativeInput(['key', '--clearmodifiers', 'ctrl+shift+t'])
    const reopened = await attachFixture()
    assert.notEqual(reopened.tabId, closed.tabId, 'Reopen gets a fresh tab identity')
    assert.notEqual(reopened.targetId, closed.targetId, 'Reopen gets a fresh native view')
    await assertDefaultA()
    return reopened
  }
  const reopenedB = await reopen(underB)
  assert.deepEqual(await identity(reopenedB), {resolved:true,address:accountB.address})
  const reopenedGuest = await reopen(guest)
  const reopenedGuestIdentity = await identity(reopenedGuest)
  assert.equal(reopenedGuestIdentity.resolved, false)
  assert.match(reopenedGuestIdentity.message, /no account|account.*selected/i)
  const reopenedDuplicate = await reopen(duplicateA)
  assert.notEqual(reopenedDuplicate.tabId, original.tabId, 'Do not just activate the surviving A tab')
  assert.deepEqual(await identity(reopenedDuplicate), {resolved:true,address:accountA.address})
  await activate(original)
  assert.deepEqual(await identity(original), {resolved:true,address:accountA.address})
  log('real Ctrl+Shift+T reopened B, guest and same-account duplicate with fresh native identities; default A unchanged')
  // Navigate through actual browser history APIs in the native app document,
  // then exercise real chrome saves/reopen. No React state or handlers injected.
  const deep = await openFixture('deep-link')
  assert.deepEqual(await identity(deep), {resolved:true,address:accountA.address})
  await deep.app.evaluate(`window.__navigationSentinel = 'same-document'; history.pushState({}, '', '/render/APP/AccountLaunchFixture/deep-link/page?room=7&theme=dark#one')`)
  const deepAddress = 'qortal://APP/AccountLaunchFixture/deep-link/page?room=7#one'
  const showsAddress = (expected) => cdp.evaluate(`document.querySelector('.home-v2-address input')?.value === ${JSON.stringify(expected)}`)
  await until('live native path/query/hash in address bar', () => showsAddress(deepAddress))
  await click('.home-v2-address input')
  await cdp.evaluate(`document.querySelector('.home-v2-address input').select()`)
  await cdp.send('Input.insertText',{text:'home://settings'})
  await deep.app.evaluate(`history.replaceState({}, '', '/render/APP/AccountLaunchFixture/deep-link/page?room=7#background')`)
  await until('background route captured while address is edited', () => {
    const saved = JSON.parse(readFileSync(path.join(profile,'home-v2-shell-state.json'),'utf8'))
    return saved.product.entries.some(entry => entry.id === deep.tabId && entry.currentResourceLocation?.endsWith('#background'))
  })
  assert.ok(await showsAddress('home://settings'), 'Background navigation must not overwrite typed text')
  await deep.app.evaluate(`history.replaceState({}, '', '/render/APP/AccountLaunchFixture/deep-link/page?room=7#one')`)
  await activate(original)
  await activate(deep)
  await until('tab activation restores current URL after editing', () => showsAddress(deepAddress))
  assert.equal(await deep.app.evaluate('window.__navigationSentinel'), 'same-document', 'SPA navigation must not reload the view')
  assert.deepEqual(await identity(deep), {resolved:true,address:accountA.address}, 'SPA routing keeps account-read consent')
  await click('.home-v2-bookmarks-button')
  await click('.home-v2-bookmarks-menu__panel button[role="menuitem"]')
  await until('current URL bookmarked', () => cdp.evaluate(`document.querySelector('.home-v2-bookmarks-button')?.classList.contains('is-bookmarked')`))
  const deepTabSelector = `.home-v2-tab[data-tab-id="${deep.tabId}"] button[role="tab"]`
  await cdp.evaluate(`document.querySelector(${JSON.stringify(deepTabSelector)}).scrollIntoView({block:'nearest',inline:'center',behavior:'instant'})`)
  const tabPoint = await cdp.box(deepTabSelector)
  assert.ok(tabPoint)
  for (const type of ['mousePressed','mouseReleased']) await cdp.send('Input.dispatchMouseEvent', {type,x:tabPoint.x,y:tabPoint.y,button:'right',clickCount:1})
  await until('tab context menu pin action', () => cdp.evaluate(`!!document.querySelector('[data-home-v2-tab-menu-action="pin"]')`))
  await click('[data-home-v2-tab-menu-action="pin"]')
  await until('current URL pinned with A', () => cdp.evaluate(`JSON.parse(localStorage.getItem('qortium-home-bookmark-manager-snapshot')).dashboardPins.some(pin => pin.displayUrl === ${JSON.stringify(deepAddress)} && pin.accountId === ${JSON.stringify(accountA.id)})`))
  const screenshot = await cdp.send('Page.captureScreenshot')
  writeFileSync(path.join(profile, 'current-app-url.png'), Buffer.from(screenshot.data,'base64'))
  await deep.app.evaluate(`history.pushState({}, '', '/render/APP/AccountLaunchFixture/deep-link/other?room=8#two'); history.replaceState({}, '', '/render/APP/AccountLaunchFixture/deep-link/replaced?room=9#three')`)
  await until('replaceState current URL', () => showsAddress('qortal://APP/AccountLaunchFixture/deep-link/replaced?room=9#three'))
  await click('.home-v2-browser-controls button[aria-label="Back"]')
  await until('Back restores previous current URL', () => showsAddress(deepAddress))
  await click('.home-v2-browser-controls button[aria-label="Forward"]')
  const resumeAddress = 'qortal://APP/AccountLaunchFixture/deep-link/replaced?room=9#three'
  await until('Forward restores current URL', () => showsAddress(resumeAddress))
  const deepB = await launchAs(deep, accountB)
  await until('new-account launch keeps current route', () => showsAddress(resumeAddress))
  assert.equal(new URL(await deepB.app.evaluate('location.href')).pathname, '/render/APP/AccountLaunchFixture/deep-link/replaced')
  assert.deepEqual(await identity(deepB), {resolved:true,address:accountB.address})
  const reopenedDeep = await reopen(deepB)
  await until('Reopen keeps current route', () => showsAddress(resumeAddress))
  assert.deepEqual(await identity(reopenedDeep), {resolved:true,address:accountB.address})
  await until('current route persisted', () => {
    const saved = JSON.parse(readFileSync(path.join(profile,'home-v2-shell-state.json'),'utf8'))
    return saved.product.entries.some(entry => entry.id === reopenedDeep.tabId &&
      (entry.currentResourceLocation ?? entry.context?.resourceLocation) === resumeAddress)
  })
  // A real process restart proves persistence, not just the existing view cache.
  for (const entry of apps) entry.app.socket.close()
  home.cdp.socket.close()
  home.shutdown()
  home = await launchHomeV2({appImage:resolveAppImage(repoRoot),profile,portBase:10300,appArgs:['--ozone-platform=x11'],log})
  await until('process restart restores deep URL', () => home.cdp.evaluate(`document.querySelector('.home-v2-address input')?.value === ${JSON.stringify(resumeAddress)}`))
  await until('process restart loads deep native document', async () => {
    const targets = await (await fetch(`http://127.0.0.1:${home.port}/json/list`)).json()
    return targets.some(target => target.url.startsWith(`${origin}/render/APP/AccountLaunchFixture/deep-link/replaced?`) && target.url.endsWith('#three'))
  })
  log('live path/query/hash, push/replace/back/forward, bookmark/pin, same-account consent, B duplicate/reopen and full process restart passed')
  writeFileSync(path.join(profile, 'acceptance.json'), JSON.stringify({
    passed:true, appImage:resolveAppImage(repoRoot),
    checks:['pin-account-attribution', 'pin-descriptions-and-layout', 'saved-pin-B-default-A',
      'account-dropdown-real-input', 'B-distinct-native-tab', 'source-A-identity-retained',
      'default-A-unchanged', 'duplicate-A-distinct-native-tab', 'explicit-guest-no-default-identity',
      'reopen-B-under-default-A', 'reopen-explicit-guest', 'reopen-duplicate-new-native-tab',
      'live-path-query-hash', 'same-document-no-reload', 'same-app-consent-retained',
      'address-edit-survives-background-navigation',
      'current-url-bookmark-pin', 'push-replace-back-forward', 'current-url-B-duplicate-reopen',
      'current-url-process-restart'],
  }, null, 2))
  log(`PASS: account-specific launch, duplicate and guest. Isolated receipt: ${profile}`)
} catch (error) {
  if (home) {
    const screenshot = await home.cdp.send('Page.captureScreenshot').catch(() => null)
    if (screenshot) writeFileSync(path.join(profile,'failure.png'),Buffer.from(screenshot.data,'base64'))
    log(`Failure evidence: ${profile}`)
  }
  if (home) log(JSON.stringify(await home.cdp.evaluate(`({
    address: document.querySelector('.home-v2-address input')?.value,
    account: document.querySelector('.home-v2-account-button')?.getAttribute('aria-label'),
    permission: document.querySelector('.home-v2-permission-dialog')?.getAttribute('data-bridge-action'),
    launcher: document.querySelector('[data-home-v2-account-tab-launcher]')?.textContent,
    launchTarget: document.querySelector('[data-home-v2-account-tab-target]')?.value,
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
  nativeWindowManager?.kill()
  nativeXServer?.kill()
  fixture.closeAllConnections()
  fixture.close()
  // Keep only this newly-created temporary profile as acceptance evidence.
}
