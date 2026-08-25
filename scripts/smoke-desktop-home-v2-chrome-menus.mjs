#!/usr/bin/env node
// Real-input smoke for the toolbar network and account dropdowns.
//
// The whole point of the change is what a real click does: these buttons used
// to navigate to the Dashboard, and must now open a menu in place and leave
// the current page alone. A JS .click() cannot tell those apart convincingly,
// and the destination check is the assertion that matters.
//
// Since then the menus dropped their Dashboard item, and the account button
// dropped its text label for avatars plus a padlock, so this also checks that
// the label survived as the accessible name, that neither menu still offers
// Dashboard, that the account panel prints an address rather than repeating it
// per network, and that the Dashboard is still reachable by address.
//
// The network menu is now actionable, so it also checks that the real app
// renders the connection-mode control, the Core lifecycle button its status
// allows, and a single update control. Those checks are read-only: nothing
// here presses Start, Stop or Install on the machine running the smoke.
//
//   node scripts/smoke-desktop-home-v2-chrome-menus.mjs
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchHomeV2, resolveAppImage, sleep } from './lib/home-v2-cdp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appImage = resolveAppImage(repoRoot)
const log = (message) => console.log(`[chrome-menus-smoke] ${message}`)

function fail(message) {
  console.error(`[chrome-menus-smoke] FAIL: ${message}`)
  process.exitCode = 1
  throw new Error(message)
}

// Which internal page the shell is showing, so "did it navigate?" is answerable.
const ACTIVE_PAGE = `(() => {
  const active = document.querySelector('.home-v2-tab.is-active')
  return active?.getAttribute('data-internal-page')
    || active?.getAttribute('data-tab-id')
    || 'none'
})()`

const MENU_TEXT = `(() => {
  const panel = document.querySelector('.home-v2-chrome-menu__panel')
  return panel ? panel.textContent.trim() : ''
})()`

// Does any open menu still offer a Dashboard shortcut? Both dropdowns dropped
// that item (owner request), so the honest answer is now always "no".
const DASHBOARD_ITEM = `(() => {
  return [...document.querySelectorAll('.home-v2-chrome-menu__panel button')]
    .some((button) => /Dashboard/i.test(button.textContent || ''))
})()`

// The account trigger is avatars plus a padlock: no readable copy, with the
// label carried by the accessible name.
const ACCOUNT_TRIGGER = `(() => {
  const button = document.querySelector('.home-v2-account-button')
  if (!button) return JSON.stringify({ found: false })
  const clone = button.cloneNode(true)
  for (const node of clone.querySelectorAll('[aria-hidden="true"]')) node.remove()
  return JSON.stringify({
    accountState: button.getAttribute('data-account-state') || '',
    ariaLabel: button.getAttribute('aria-label') || '',
    found: true,
    lockGlyphs: button.querySelectorAll('.home-v2-account-lock').length,
    visibleText: (clone.textContent || '').trim(),
  })
})()`

// The network menu acts on the node now: a connection-mode control, the local
// Core's lifecycle button, and one update control. Read-only — this never
// presses Stop on the machine running the smoke.
const NODE_MENU = `(() => {
  const pill = document.querySelector('.home-v2-node-pill')
  const panel = pill?.closest('.home-v2-chrome-menu')
    ?.querySelector('.home-v2-chrome-menu__panel')
  if (!panel) return JSON.stringify({ found: false })
  const select = panel.querySelector('select[data-home-v2-node-menu-mode]')
  const core = panel.querySelector('.home-v2-node-menu-core')
  const action = (name) => {
    const button = panel.querySelector(
      '[data-home-v2-node-menu-action="' + name + '"]',
    )
    return button
      ? { disabled: !!button.disabled, label: (button.textContent || '').trim() }
      : null
  }
  return JSON.stringify({
    check: action('check'),
    found: true,
    install: action('install'),
    lifecycle: core ? core.getAttribute('data-lifecycle') : null,
    modes: select
      ? [...select.options].map((option) => ({
          disabled: !!option.disabled,
          value: option.value,
        }))
      : null,
    network: select ? select.getAttribute('data-home-v2-node-menu-mode') : '',
    selected: select ? select.value : '',
    settings: action('settings'),
    start: action('start'),
    stop: action('stop'),
  })
})()`

// One address, in its own monospace row, however many networks are enabled.
const ACCOUNT_PANEL = `(() => {
  const panel = document.querySelector('.home-v2-account-button')
    ?.closest('.home-v2-chrome-menu')
    ?.querySelector('.home-v2-chrome-menu__panel')
  if (!panel) return JSON.stringify({ found: false })
  return JSON.stringify({
    addresses: [...panel.querySelectorAll('.home-v2-account-detail__address')]
      .map((node) => node.textContent.trim()),
    found: true,
    networkRows: panel.querySelectorAll('.home-v2-account-detail[data-network]').length,
  })
})()`

async function main() {
  const { cdp, shutdown } = await launchHomeV2({
    appImage,
    log,
    portBase: 9400,
  })
  try {
    // Park on a page that is not the Dashboard, so a stray navigation shows up.
    await cdp.evaluate(`(() => {
      const input = document.querySelector('.home-v2-address input')
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setValue.call(input, 'home://settings')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.closest('form').requestSubmit()
      return true
    })()`)
    await sleep(2500)
    const startPage = await cdp.evaluate(ACTIVE_PAGE)
    if (startPage !== 'settings') fail(`expected to start on settings, got ${startPage}`)

    // The account button says who you are without printing it: only avatars
    // and a padlock, with the label kept as the accessible name.
    const trigger = JSON.parse(await cdp.evaluate(ACCOUNT_TRIGGER))
    if (!trigger.found) fail('no account button in the toolbar')
    if (trigger.visibleText) {
      fail(`the account button still prints text: ${JSON.stringify(trigger.visibleText)}`)
    }
    if (!trigger.ariaLabel) {
      fail('the account button has no accessible name, so its label is simply gone')
    }
    // A signed-out shell has no lock state to show, so only require the glyph
    // when there is actually an account behind the button.
    const signedIn = trigger.accountState !== 'none'
    if (signedIn && trigger.lockGlyphs !== 1) {
      fail(`expected one lock-state glyph on the account button, got ${trigger.lockGlyphs}`)
    }
    log(
      `account button: state ${trigger.accountState}, aria-label ` +
        `${JSON.stringify(trigger.ariaLabel)}, no visible text`,
    )

    for (const [name, selector] of [
      ['network', '.home-v2-node-pill'],
      ['account', '.home-v2-account-button'],
    ]) {
      const box = await cdp.box(selector)
      if (!box) fail(`no ${name} button in the toolbar`)
      await cdp.click(box.x, box.y)
      await sleep(700)

      const text = await cdp.evaluate(MENU_TEXT)
      if (!text) fail(`a real click on the ${name} button opened no menu`)
      const page = await cdp.evaluate(ACTIVE_PAGE)
      if (page !== 'settings') {
        fail(`clicking the ${name} button navigated to ${page} instead of opening a menu`)
      }
      // The Dashboard item was removed from both menus; it stays reachable
      // from the tab strip and the address bar.
      if (await cdp.evaluate(DASHBOARD_ITEM)) {
        fail(`the ${name} menu still offers a Dashboard item`)
      }
      if (name === 'network') {
        const menu = JSON.parse(await cdp.evaluate(NODE_MENU))
        if (!menu.found) fail('the network menu opened without a panel')
        if (!menu.modes) fail('the network menu offers no connection-mode control')
        const modeValues = menu.modes.map((mode) => mode.value).join(',')
        if (modeValues !== 'disabled,local,public,custom') {
          fail(`the connection-mode control offers ${modeValues}`)
        }
        if (!menu.selected) {
          fail('the connection-mode control shows no current mode')
        }
        if (!menu.settings) {
          fail('the network menu no longer links to Settings')
        }
        // The Core half is only there when Home has a Core manager; when it is,
        // the button on show has to match what the status says is allowed —
        // asserted by presence and disabled state only, never by clicking.
        if (menu.lifecycle === 'start' && !menu.start) {
          fail('a startable Core offered no Start Core button')
        }
        if (menu.lifecycle === 'stop' && !menu.stop) {
          fail('a stoppable Core offered no Stop Core button')
        }
        if (menu.lifecycle === 'none' && (menu.start || menu.stop)) {
          fail('the menu offered a lifecycle button the Core status forbids')
        }
        if (menu.check && menu.install) {
          fail('the update affordance should be one button, not two')
        }
        log(
          `network menu: mode ${menu.network}=${menu.selected}, core ` +
            `${menu.lifecycle ?? 'unmanaged'}, start ${JSON.stringify(menu.start)}, ` +
            `stop ${JSON.stringify(menu.stop)}, update ` +
            `${JSON.stringify(menu.install ?? menu.check)}`,
        )
      }
      if (name === 'account' && signedIn) {
        const panel = JSON.parse(await cdp.evaluate(ACCOUNT_PANEL))
        if (!panel.found) fail('the account menu opened without a panel')
        if (panel.networkRows < 1) {
          fail('the account menu shows no per-network detail rows')
        }
        // Both chains normally share one address; more than one row here means
        // the "print it once" rule has broken, none means it went missing.
        if (panel.addresses.length < 1 || panel.addresses.length > panel.networkRows) {
          fail(
            `the account menu printed ${panel.addresses.length} address rows for ` +
              `${panel.networkRows} network(s)`,
          )
        }
        log(
          `account panel: ${panel.networkRows} network row(s), ` +
            `${panel.addresses.length} address row(s)`,
        )
      }
      log(`${name} menu: ${text.replace(/\s+/g, ' ').slice(0, 120)}`)

      // Escape must close it, or the popover traps the page behind it.
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
      })
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
      })
      await sleep(500)
      if (await cdp.evaluate(MENU_TEXT)) fail(`Escape did not close the ${name} menu`)
    }

    // The Dashboard left these menus, so prove it is still reachable the
    // ordinary way — otherwise the removal would have stranded it.
    await cdp.evaluate(`(() => {
      const input = document.querySelector('.home-v2-address input')
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setValue.call(input, 'home://dashboard')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.closest('form').requestSubmit()
      return true
    })()`)
    await sleep(2000)
    const finalPage = await cdp.evaluate(ACTIVE_PAGE)
    if (finalPage !== 'dashboard') {
      fail(`home://dashboard went to ${finalPage}`)
    }
    log('PASS')
  } finally {
    shutdown()
    await sleep(2500)
  }
}

main().catch((error) => {
  console.error(`[chrome-menus-smoke] ERROR: ${error.message}`)
  process.exitCode = 1
})
