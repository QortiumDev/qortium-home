#!/usr/bin/env node
// Real-input smoke for the toolbar network and account dropdowns.
//
// The whole point of the change is what a real click does: these buttons used
// to navigate to the Dashboard, and must now open a menu in place and leave
// the current page alone. A JS .click() cannot tell those apart convincingly,
// and the destination check is the assertion that matters.
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

    // The Dashboard is still reachable, just as a choice rather than a side
    // effect of wanting to read the status.
    const pill = await cdp.box('.home-v2-node-pill')
    await cdp.click(pill.x, pill.y)
    await sleep(700)
    const dashboardItem = await cdp.evaluate(`(() => {
      const item = [...document.querySelectorAll('.home-v2-chrome-menu__panel button')]
        .find((button) => /Dashboard/i.test(button.textContent || ''))
      if (!item) return null
      const rect = item.getBoundingClientRect()
      return JSON.stringify({
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      })
    })()`)
    if (!dashboardItem) fail('the network menu offers no way to reach the Dashboard')
    const point = JSON.parse(dashboardItem)
    await cdp.click(point.x, point.y)
    await sleep(1500)
    const finalPage = await cdp.evaluate(ACTIVE_PAGE)
    if (finalPage !== 'dashboard') {
      fail(`choosing Dashboard from the menu went to ${finalPage}`)
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
