#!/usr/bin/env node
// Real-input smoke for dragging a tab out into its own window.
//
// This is the only way to check the part that matters. The gesture is a
// pointer drag released clear of the tab strip, the result is a SECOND
// renderer process, and the risk being guarded is that the new window restores
// the primary window's tabs (or saves over them) because Home 2 keeps one
// shared state file. None of that is observable from a DOM test.
//
//   node scripts/smoke-desktop-home-v2-tab-detach.mjs
import path from 'node:path'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { Cdp, launchHomeV2, resolveAppImage, sleep } from './lib/home-v2-cdp.mjs'
import { launchHome, mainRequire } from './lib/electron-main-driver.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appImage = resolveAppImage(repoRoot)
const log = (message) => console.log(`[tab-detach-smoke] ${message}`)

function fail(message) {
  console.error(`[tab-detach-smoke] FAIL: ${message}`)
  process.exitCode = 1
  throw new Error(message)
}

async function until(label, read, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await read()) return
    await sleep(150)
  }
  throw new Error(`Timed out: ${label}`)
}

// Two disposable accounts, created through an unpackaged bootstrap with the
// native backup-save dialog stubbed out. The packaged build under test is
// then pointed at the SAME profile, so it never calls vault-create itself and
// never hits a real, un-stubbed save dialog.
async function createDisposableAccounts(profile) {
  const password = randomUUID()
  log('creating two disposable accounts for the receiving-window attribution case')
  const bootstrap = await launchHome({ repoRoot, profileDirectory: profile })
  await bootstrap.main.evaluate(mainRequire(`
    let backupIndex = 0
    require('electron').dialog.showSaveDialog = async () => ({ canceled: false,
      filePath: ${JSON.stringify(profile)} + '/fixture-backup-' + (++backupIndex) + '.json' })
    return true
  `))
  const setup = await bootstrap.renderer((url) => url.includes('v2-live.html'), 'vault fixture setup')
  setup.close()
  await bootstrap.main.evaluate(mainRequire(`
    const accounts = require(${JSON.stringify(path.join(repoRoot, 'dist-electron/accounts.js'))})
    const sender = require('electron').BrowserWindow.getAllWindows()[0].webContents
    globalThis.__fixtureResult = null
    globalThis.__fixturePromise = (async () => {
      for (const label of ['Tab detach account A', 'Tab detach account B']) {
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
  if (created.error) fail(`disposable account bootstrap failed: ${created.error}`)
  const accountA = created.accounts.find((account) => account.label === 'Tab detach account A')
  const accountB = created.accounts.find((account) => account.label === 'Tab detach account B')
  if (!accountA?.id || !accountB?.id) fail('disposable accounts were not created')
  if (accountA.address === accountB.address) fail('disposable accounts A and B must not share an address')
  log(`disposable accounts ready: A=${accountA.id} B=${accountB.id}`)
  bootstrap.main.close()
  await bootstrap.stop()
  return { accountA, accountB }
}

const TAB_KEYS = `JSON.stringify(
  [...document.querySelectorAll('.home-v2-tab')].map(
    (tab) => tab.getAttribute('data-internal-page') || tab.getAttribute('data-tab-id'),
  ),
)`

// The back/forward buttons ARE the per-tab history, as far as anything
// observable goes: a tab with a single destination has both disabled, so a
// transferred history shows up here and nowhere else.
const NAV_STATE = `JSON.stringify((() => {
  const buttons = [...document.querySelectorAll('.home-v2-browser-controls button')]
  return { back: buttons[0] ? buttons[0].disabled : 'missing', forward: buttons[1] ? buttons[1].disabled : 'missing' }
})())`

const SURFACE_NOTICE = `(document.querySelector('.home-v2-surface-notice') || {}).textContent || ''`

// Drives the transfer channel directly, which is the only way to test what a
// RECEIVING window does with an account it does not have: the drag gesture can
// only ever hand over an account this profile really has.
const transferTo = (address, accountId) => `window.homeV2Windows.openTab({
  revision: 2,
  address: ${JSON.stringify(address)},
  accountId: ${JSON.stringify(accountId)},
}).then(() => 'sent', (error) => 'refused: ' + error.message)`

async function openShellProbe(entry) {
  const probe = new Cdp(entry.webSocketDebuggerUrl)
  await probe.ready
  await probe.send('Runtime.enable')
  return probe
}

async function listShellTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  return (await response.json()).filter((entry) => entry.url.includes('v2-live.html'))
}

async function main() {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'home-tab-detach-accounts-'))
  const { accountA, accountB } = await createDisposableAccounts(profile)
  const { cdp, port, shutdown } = await launchHomeV2({ appImage, log, portBase: 9200, profile })
  try {
    // Two internal tabs, so the detached window can be checked for exactly one.
    //
    // 'home://apps' was used here and is not an address the shell has -- it
    // accepts dashboard/newtab/settings/welcome plus release notes. So the
    // second tab never opened and every check below that looked for it passed
    // or failed for the wrong reason, including the one that reports the
    // detached window "overwrote the stored tab strip".
    //
    // ORDER MATTERS: a new-tab page is replaceable, so navigating away from it
    // consumes it. Opening it LAST is what makes it stay. It also has to be a
    // page the detached window cannot acquire on its own -- dashboard is the
    // default everywhere, and welcome is opened by onboarding in EVERY window,
    // so neither can distinguish a restored strip from an ordinary one.
    // Each address is typed into the address bar, which NAVIGATES the current
    // tab rather than opening another -- so this loop only ever produced one
    // extra tab, and 'home://apps' being invalid left settings in place by
    // accident. Open a fresh tab first so there are genuinely two.
    const openNewTab = async () => {
      await cdp.evaluate(`document.querySelector('.home-v2-new-tab').click()`)
      await sleep(800)
    }
    await openNewTab()
    for (const address of ['home://settings']) {
      await cdp.evaluate(`(() => {
        const input = document.querySelector('.home-v2-address input')
        const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setValue.call(input, ${JSON.stringify(address)})
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.closest('form').requestSubmit()
        return true
      })()`)
      await sleep(2200)
    }

    // Onboarding opens a 'welcome' tab on its own some time after launch, and
    // it grabs activeTabId when it does -- independently of anything this
    // script clicks. The settings-nav click below dispatches by activeTabId
    // (HomeV2LiveApp's onSettingsSectionChange never names a tab), so on a
    // fresh profile it silently lands on the welcome tab instead: the DOM
    // click still fires (the settings page stays mounted, just `hidden`, so
    // querySelector finds it and the section highlight updates from local
    // state), but no history is pushed for the settings tab and back stays
    // disabled forever. Re-select the settings tab so it really is the active
    // one before touching its nav.
    await cdp.evaluate(`(() => {
      const tab = document.querySelector('.home-v2-tab[data-internal-page="settings"] button[role=tab]')
      if (tab) tab.click()
      return true
    })()`)
    await sleep(300)

    // Give the settings tab a REAL second history entry before it is moved.
    // Without this the tab has one destination, and "the history survived the
    // move" would pass for a tab that has no history to lose.
    const section = await cdp.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('.home-v2-settings-nav button')]
      const target = buttons.find((button) => button.getAttribute('aria-current') !== 'page')
      if (!target) return 'none'
      target.click()
      return target.textContent || 'unnamed'
    })()`)
    if (section === 'none') fail('the settings tab has no second section to navigate to')
    await sleep(1200)
    const sourceNav = JSON.parse(await cdp.evaluate(NAV_STATE))
    log(`settings tab navigated to ${section}; back disabled: ${sourceNav.back}`)
    if (sourceNav.back !== false) {
      fail(`the settings tab has no history to transfer (back disabled: ${sourceNav.back})`)
    }

    // A second fresh tab, left as a new-tab page. It is the ONLY tab the
    // detached window could not have on its own: dashboard is every window's
    // default and welcome is opened by onboarding in every window, so neither
    // can tell a restored strip from an ordinary one.
    await openNewTab()
    const before = JSON.parse(await cdp.evaluate(TAB_KEYS))
    log(`primary window tabs: ${before.join(' ')}`)
    if (!before.includes('settings')) fail('no settings tab to drag out')
    const windowsBefore = (await listShellTargets(port)).length
    if (windowsBefore !== 1) fail(`expected one shell window to start, saw ${windowsBefore}`)

    // Drag the settings tab well clear of the strip. 72px is the threshold
    // Home 1.x used, so go comfortably past it.
    const tab = await cdp.box('.home-v2-tab[data-internal-page="settings"] button[role=tab]')
    if (!tab) fail('the settings tab is not rendered')
    await cdp.drag(tab, { x: tab.x + 40, y: tab.y + 260 }, 16)
    await sleep(4000)

    const targets = await listShellTargets(port)
    if (targets.length !== 2) {
      fail(`dragging a tab out produced ${targets.length} shell windows, expected 2`)
    }
    log('a second window opened')

    const after = JSON.parse(await cdp.evaluate(TAB_KEYS))
    if (after.includes('settings')) {
      fail(`the tab is still in the original window: ${after.join(' ')}`)
    }
    log(`original window now: ${after.join(' ')}`)

    // The new window must carry the dragged tab and NOT restore the primary
    // window's strip — that is the shared-state-file hazard.
    let detached = null
    for (const entry of targets) {
      const probe = new Cdp(entry.webSocketDebuggerUrl)
      await probe.ready
      await probe.send('Runtime.enable')
      const keys = JSON.parse(await probe.evaluate(TAB_KEYS))
      if (keys.includes('settings')) detached = { keys, probe }
      else probe.socket.close()
    }
    if (!detached) fail('neither window holds the dragged-out tab')
    const detachedProbe = detached.probe
    log(`detached window tabs: ${detached.keys.join(' ')}`)
    if (detached.keys.includes('newtab')) {
      fail(
        'the detached window restored the primary window\'s tabs; a detached ' +
          'strip must be session-only',
      )
    }

    // The real hazard is on disk, not on screen: both windows write to one
    // shared state file, so read the STORED record back and confirm the
    // detached window's session-only strip did not replace the primary's.
    // Opening its tab makes the detached window save, so by now it has.
    await sleep(3000)
    const storedPages = await cdp.evaluate(`(async () => {
      const state = await window.homeV2Nodes.getShellState()
      const entries = state?.product?.entries ?? []
      return JSON.stringify(entries.map((entry) => entry.page ?? entry.kind ?? '?'))
    })()`)
    const stored = JSON.parse(storedPages)
    log(`stored tab strip: ${stored.join(' ')}`)
    // The invariant, stated directly: what is SAVED must still be the primary
    // window's strip, not the detached window's.
    //
    // This used to look for a sentinel tab that only the primary had. That is a
    // proxy, and it broke twice -- first because 'home://apps' never opened one,
    // then because new tabs now open on the dashboard (#468 made the shell
    // dashboard-first), so there is no page a detached window cannot also have.
    // Comparing the two strips needs no sentinel and says what it means.
    assert.deepEqual(
      stored,
      after,
      'the saved strip must be the primary window\'s, not the detached one\'s',
    )
    if (JSON.parse(await cdp.evaluate(TAB_KEYS)).includes('settings')) {
      fail('the detached tab came back to the primary window')
    }

    // Prove the check above is not passing vacuously: drive the detached
    // window's save path directly with a strip that WOULD clobber, and confirm
    // the stored one still stands. Without the main-process merge this write
    // is exactly how a second window destroys the first window's tabs.
    await detached.probe.evaluate(`(async () => {
      await window.homeV2Nodes.saveShellGlobalState({
        version: 3,
        appearance: { theme: 'dark', accent: 'clay', textSize: 'medium', appZoom: 100, language: 'system', ui: 'classic' },
        product: { activeTabId: 'clobber', entries: [{ id: 'clobber', kind: 'internal', page: 'settings' }] },
      })
      return true
    })()`)
    await sleep(1200)
    const afterWrite = JSON.parse(await cdp.evaluate(`(async () => {
      const state = await window.homeV2Nodes.getShellState()
      const entries = state?.product?.entries ?? []
      return JSON.stringify(entries.map((entry) => entry.page ?? entry.kind ?? '?'))
    })()`))
    log(`stored strip after a detached save: ${afterWrite.join(' ')}`)
    // Same invariant, after the detached window has been made to save: the
    // stored strip must still be the primary's, and must not contain the
    // deliberately distinctive entry the detached window tried to write.
    assert.deepEqual(
      afterWrite,
      after,
      `a detached window's save replaced the stored tab strip (${afterWrite.join(' ')})`,
    )
    // --- what the tab brought with it ---------------------------------------

    // The history the tab had in the window it left. A freshly opened settings
    // tab has one destination and a disabled back button, so this is the whole
    // difference between a transferred tab and a re-opened address.
    const adoptedNav = JSON.parse(await detachedProbe.evaluate(NAV_STATE))
    log(`detached tab navigation: back disabled ${adoptedNav.back}, forward disabled ${adoptedNav.forward}`)
    assert.deepEqual(
      adoptedNav,
      { back: false, forward: true },
      'the moved tab must arrive at the end of its own history, not as a fresh tab',
    )
    await detachedProbe.evaluate(
      `document.querySelectorAll('.home-v2-browser-controls button')[0].click()`,
    )
    await sleep(1200)
    assert.deepEqual(
      JSON.parse(await detachedProbe.evaluate(NAV_STATE)),
      { back: true, forward: false },
      'going back in the transferred history must reach its first entry',
    )
    detachedProbe.socket.close()

    // The account attribution. A moved tab names the account it was using, and
    // the receiving window either honours it or refuses the open -- it must
    // never quietly reopen the tab as whoever that window has selected. The
    // drag can only ever hand over an account this profile has, so the channel
    // is driven directly for both answers.
    const viewerAddress = 'qdn://DOCUMENT/QortiumHomeTest/tab-detach-smoke'
    const before3 = new Set((await listShellTargets(port)).map((entry) => entry.id))
    log(await cdp.evaluate(transferTo(viewerAddress, 'wallet:not-in-this-window')))
    await sleep(4000)
    const strangerTargets = (await listShellTargets(port)).filter((entry) => !before3.has(entry.id))
    if (strangerTargets.length !== 1) {
      fail(`a transfer naming an unknown account produced ${strangerTargets.length} windows`)
    }
    const stranger = await openShellProbe(strangerTargets[0])
    const strangerTabs = JSON.parse(await stranger.evaluate(TAB_KEYS))
    const strangerNotice = await stranger.evaluate(SURFACE_NOTICE)
    log(`unknown-account window tabs: ${strangerTabs.join(' ')} / notice: ${strangerNotice}`)
    if (strangerTabs.some((key) => String(key).includes('viewer'))) {
      fail('a tab naming an account this window does not have was opened anyway')
    }
    assert.match(
      strangerNotice,
      /no longer available/,
      'refusing a transferred account must say so rather than fail silently',
    )
    stranger.socket.close()

    // The control: the same address with the explicit guest sentinel DOES
    // open, so the refusal above is about the account and not the envelope.
    const before4 = new Set((await listShellTargets(port)).map((entry) => entry.id))
    log(await cdp.evaluate(transferTo(viewerAddress, 'home-v2:guest')))
    await sleep(4000)
    const guestTargets = (await listShellTargets(port)).filter((entry) => !before4.has(entry.id))
    if (guestTargets.length !== 1) {
      fail(`a guest transfer produced ${guestTargets.length} windows`)
    }
    const guest = await openShellProbe(guestTargets[0])
    const guestTabs = JSON.parse(await guest.evaluate(TAB_KEYS))
    log(`guest window tabs: ${guestTabs.join(' ')}`)
    if (!guestTabs.some((key) => String(key).includes('viewer'))) {
      fail(`an explicit guest transfer did not open its tab: ${guestTabs.join(' ')}`)
    }
    guest.socket.close()

    // --- a bound tab must keep its own account, not the receiving window's ---
    //
    // The two cases above only prove an unknown account is refused and the
    // explicit guest sentinel opens. Neither shows what happens to a KNOWN
    // account when the receiving window currently has a DIFFERENT account
    // selected -- the real hazard is the receiving window quietly reopening
    // the tab as whoever it has selected instead of who the tab named.
    const click = async (selector) => {
      // Dashboard accounts can sit below the viewport on the default Xvfb
      // window. Scroll presentation before calculating a genuine pointer hit.
      await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center', inline:'nearest', behavior:'instant'})`)
      const point = await cdp.box(selector)
      if (!point) fail(`missing ${selector}`)
      await cdp.click(point.x, point.y)
    }
    const key = async (name, keyCode) => {
      for (const type of ['keyDown', 'keyUp']) {
        await cdp.send('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: keyCode })
      }
    }
    const dashboardTabButton = '.home-v2-tab[data-internal-page="dashboard"] button[role="tab"]'
    const selectDefault = async (account) => {
      await click(dashboardTabButton)
      const selector = '.home-v2-page-slot:not([hidden]) .home-v2-account-select select'
      await until('Dashboard account selector', () => cdp.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`))
      const selection = await cdp.evaluate(`(() => {
        const select = document.querySelector(${JSON.stringify(selector)})
        const options = Array.from(select.options).filter(option => !option.matches(':disabled'))
        return {current: options.findIndex(option => option.value === select.value),
          target: options.findIndex(option => option.value === ${JSON.stringify(`account:${account.id}`)})}
      })()`)
      if (selection.target < 0) fail(`account ${account.label} is not an enabled selector option`)
      if (selection.current < 0) fail('the currently selected account is not an enabled selector option')
      // Genuine pointer + native-select keyboard interaction; do not call the
      // vault or dispatch a synthetic React change event to change defaults.
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

    log(`selecting ${accountB.label} as the current account in the RECEIVING (primary) window`)
    await selectDefault(accountB)

    // What the tab strip's account chip actually shows for the one tab a
    // freshly opened window holds -- the direct DOM read the reviewer asked
    // for, not window.homeV2Nodes.getShellState() (a detached/opened window's
    // strip is session-only, so the stored product entries do not show it).
    const attribution = async (probe) => {
      await until('account chip rendered', () => probe.evaluate(`!!document.querySelector('.home-v2-tab__account')`))
      return probe.evaluate(`document.querySelector('.home-v2-tab__account').getAttribute('aria-label')`)
    }

    // The positive case: a tab bound to A must stay bound to A even though
    // the window receiving it has B selected right now.
    const beforeA = new Set((await listShellTargets(port)).map((entry) => entry.id))
    log(await cdp.evaluate(transferTo(viewerAddress, accountA.id)))
    await sleep(4000)
    const aTargets = (await listShellTargets(port)).filter((entry) => !beforeA.has(entry.id))
    if (aTargets.length !== 1) {
      fail(`transferring to account A produced ${aTargets.length} windows, expected 1`)
    }
    const aProbe = await openShellProbe(aTargets[0])
    const aTabs = JSON.parse(await aProbe.evaluate(TAB_KEYS))
    const aChip = await attribution(aProbe)
    log(`account-A window tabs: ${aTabs.join(' ')} / attribution: ${aChip}`)
    if (!aTabs.some((key) => String(key).includes('viewer'))) {
      fail(`a transfer naming account A did not open its tab: ${aTabs.join(' ')}`)
    }
    assert.equal(
      aChip,
      `Tab account: ${accountA.label}`,
      `a tab transferred with account A must show A, not the receiving window's ` +
        `current account (${accountB.label}) or guest -- saw ${aChip}`,
    )
    aProbe.socket.close()

    // The control: the same address named with account B must show B. This is
    // what proves the assertion above is discriminating -- it is currently
    // also the receiving window's selected account, so this case would pass
    // even with the account-substitution bug the positive case guards against.
    const beforeB = new Set((await listShellTargets(port)).map((entry) => entry.id))
    log(await cdp.evaluate(transferTo(viewerAddress, accountB.id)))
    await sleep(4000)
    const bTargets = (await listShellTargets(port)).filter((entry) => !beforeB.has(entry.id))
    if (bTargets.length !== 1) {
      fail(`transferring to account B produced ${bTargets.length} windows, expected 1`)
    }
    const bProbe = await openShellProbe(bTargets[0])
    const bTabs = JSON.parse(await bProbe.evaluate(TAB_KEYS))
    const bChip = await attribution(bProbe)
    log(`account-B window tabs: ${bTabs.join(' ')} / attribution: ${bChip}`)
    if (!bTabs.some((key) => String(key).includes('viewer'))) {
      fail(`a transfer naming account B did not open its tab: ${bTabs.join(' ')}`)
    }
    assert.equal(
      bChip,
      `Tab account: ${accountB.label}`,
      `a tab transferred with account B must show B -- the control that shows ` +
        `the check above discriminates by account, not just by chance`,
    )
    bProbe.socket.close()

    log('PASS')
  } finally {
    shutdown()
    await sleep(2500)
    try { rmSync(profile, { recursive: true, force: true }) } catch {}
  }
}

main().catch((error) => {
  console.error(`[tab-detach-smoke] ERROR: ${error.message}`)
  process.exitCode = 1
})
