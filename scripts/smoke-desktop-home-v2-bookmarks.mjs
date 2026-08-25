#!/usr/bin/env node
// Real-input smoke for the toolbar bookmarks button and tab -> bookmarks
// toolbar drop.
//
// Why real input: both behaviours are pointer gestures. A JS .click() would
// have shipped PR #351's pointer-capture regression green, and the drop is a
// pointerdown/move/up sequence with a hit-test that element.click() cannot
// exercise at all. This drives genuine CDP input, like
// smoke-desktop-home-v2-tabs.mjs.
//
//   node scripts/smoke-desktop-home-v2-bookmarks.mjs
//   QORTIUM_HOME_APPIMAGE=/path/to.AppImage node scripts/smoke-desktop-home-v2-bookmarks.mjs
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const defaultAppImage = path.join(
  repoRoot,
  'dist-release',
  `Qortium-Home-${packageJson.version}-x86_64.AppImage`,
)
const appImage = path.resolve(process.env.QORTIUM_HOME_APPIMAGE?.trim() || defaultAppImage)
const appTimeoutMs = Number(process.env.QORTIUM_HOME_SMOKE_TIMEOUT_MS || 90_000)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (message) => console.log(`[bookmarks-smoke] ${message}`)

function fail(message) {
  console.error(`[bookmarks-smoke] FAIL: ${message}`)
  process.exitCode = 1
  throw new Error(message)
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.nextId = 0
    this.pending = new Map()
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      message.error
        ? entry.reject(new Error(JSON.stringify(message.error)))
        : entry.resolve(message.result)
    }
    this.ready = new Promise((resolve, reject) => {
      this.socket.onopen = resolve
      this.socket.onerror = () => reject(new Error('CDP socket error'))
    })
  }

  send(method, params = {}) {
    const id = ++this.nextId
    this.socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 30_000)
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) {
      throw new Error(`${result.exceptionDetails.text} :: ${expression}`)
    }
    return result.result?.value
  }

  mouse(type, x, y, buttons) {
    return this.send('Input.dispatchMouseEvent', {
      type, x, y, button: 'left', buttons, clickCount: 1,
    })
  }

  async click(x, y) {
    await this.mouse('mousePressed', x, y, 1)
    await this.mouse('mouseReleased', x, y, 0)
  }

  /** A genuine press, several intermediate moves, then a release. */
  async drag(from, to) {
    await this.mouse('mousePressed', from.x, from.y, 1)
    for (let step = 1; step <= 12; step++) {
      await this.mouse(
        'mouseMoved',
        Math.round(from.x + ((to.x - from.x) * step) / 12),
        Math.round(from.y + ((to.y - from.y) * step) / 12),
        1,
      )
      await sleep(25)
    }
    await this.mouse('mouseReleased', to.x, to.y, 0)
  }
}

const BOX = (selector) => `(() => {
  const element = document.querySelector(${JSON.stringify(selector)})
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return JSON.stringify({
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
  })
})()`

const TOOLBAR_TITLES = `JSON.stringify(
  [...document.querySelectorAll('.home-v2-bookmark-toolbar__item')].map(
    (item) => item.textContent.trim(),
  ),
)`

async function main() {
  if (!existsSync(appImage)) {
    fail(`AppImage not found: ${appImage} (run npm run dist:linux:x64 first)`)
  }
  const port = 9800 + (process.pid % 190)
  const profile = mkdtempSync(path.join(os.tmpdir(), 'home-v2-bookmarks-smoke-'))
  const useXvfb = !process.env.DISPLAY && existsSync('/usr/bin/xvfb-run')
  const command = useXvfb ? '/usr/bin/xvfb-run' : appImage
  const args = useXvfb
    ? ['-a', appImage, `--remote-debugging-port=${port}`]
    : [`--remote-debugging-port=${port}`]

  log(`starting ${path.basename(appImage)} (CDP ${port})`)
  // detached => the whole tree can be signalled at once; killing the spawned
  // pid alone strands the real app and its Xvfb server.
  const child = spawn(command, args, {
    detached: true,
    env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1', QORTIUM_HOME_USER_DATA_DIR: profile },
    stdio: 'ignore',
  })

  const shutdown = () => {
    try { process.kill(-child.pid, 'SIGTERM') } catch {}
    setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL') } catch {}
    }, 2000).unref?.()
  }
  const onSignal = () => { shutdown(); process.exit(130) }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  process.once('exit', () => { try { process.kill(-child.pid, 'SIGKILL') } catch {} })

  try {
    let target = null
    const deadline = Date.now() + appTimeoutMs
    while (!target && Date.now() < deadline) {
      await sleep(1000)
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`)
        target = (await response.json()).find((entry) => entry.url.includes('v2-live.html'))
      } catch {
        // Not listening yet.
      }
    }
    if (!target) fail('the Home 2 shell target never appeared')

    const cdp = new Cdp(target.webSocketDebuggerUrl)
    await cdp.ready
    await cdp.send('Runtime.enable')
    const readyDeadline = Date.now() + appTimeoutMs
    while (Date.now() < readyDeadline) {
      if (await cdp.evaluate('document.readyState === "complete" && !!document.querySelector(".home-v2-tabs")')) break
      await sleep(1000)
    }

    if (!(await cdp.evaluate('!!document.querySelector(".home-v2-bookmarks-button")'))) {
      fail('no bookmarks button in the toolbar')
    }
    const order = await cdp.evaluate(`(() => {
      const controls = [...document.querySelectorAll('.home-v2-browser-controls > *')]
      return controls
        .map((node) => node.className || node.getAttribute('aria-label') || '?')
        .join('|')
    })()`)
    log(`toolbar order: ${order}`)

    // 1) Star the current page through the menu, with real clicks.
    const starBox = JSON.parse(await cdp.evaluate(BOX('.home-v2-bookmarks-button')))
    await cdp.click(starBox.x, starBox.y)
    await sleep(600)
    const addBox = await cdp.evaluate(`(() => {
      const item = [...document.querySelectorAll('.home-v2-bookmarks-menu__panel button')]
        .find((button) => /Add to Bookmarks/i.test(button.textContent || ''))
      if (!item) return null
      const rect = item.getBoundingClientRect()
      return JSON.stringify({
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      })
    })()`)
    if (!addBox) fail('the bookmarks menu did not open on a real click')
    const addPoint = JSON.parse(addBox)
    await cdp.click(addPoint.x, addPoint.y)
    await sleep(1500)
    if (!(await cdp.evaluate('document.querySelector(".home-v2-bookmarks-button")?.classList.contains("is-bookmarked")'))) {
      fail('starring the current page did not mark it as bookmarked')
    }
    log('starring the current page saved it')

    // 2) Make the strip always visible through the same menu. The default
    // ("Only on Dashboard / New Tab") is deliberate, but it means the drop
    // target does not exist on other routes, so pin it open first.
    const starBox2 = JSON.parse(await cdp.evaluate(BOX('.home-v2-bookmarks-button')))
    await cdp.click(starBox2.x, starBox2.y)
    await sleep(600)
    const alwaysBox = await cdp.evaluate(`(() => {
      const item = [...document.querySelectorAll('.home-v2-bookmarks-menu__panel button')]
        .find((button) => /Always show/i.test(button.textContent || ''))
      if (!item) return null
      const rect = item.getBoundingClientRect()
      return JSON.stringify({
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      })
    })()`)
    if (!alwaysBox) fail('the menu has no bookmark-toolbar visibility choices')
    const alwaysPoint = JSON.parse(alwaysBox)
    await cdp.click(alwaysPoint.x, alwaysPoint.y)
    await sleep(1200)
    if (!(await cdp.evaluate('!!document.querySelector(".home-v2-bookmark-toolbar")'))) {
      fail('the bookmarks toolbar did not appear after choosing Always show')
    }
    log('toolbar visibility set from the menu')

    // 3) Drag a tab onto the bookmarks toolbar.
    await cdp.evaluate(`(() => {
      const input = document.querySelector('.home-v2-address input')
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setValue.call(input, 'home://settings')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.closest('form').requestSubmit()
      return true
    })()`)
    await sleep(2500)

    const before = JSON.parse(await cdp.evaluate(TOOLBAR_TITLES))
    const tabBox = await cdp.evaluate(BOX('.home-v2-tab[data-internal-page="settings"] button[role=tab]'))
    const toolbarBox = await cdp.evaluate(BOX('.home-v2-bookmark-toolbar'))
    if (!tabBox) fail('no settings tab to drag')
    if (!toolbarBox) fail('the bookmarks toolbar is not rendered, so there is nothing to drop onto')
    log(`dragging the settings tab onto the toolbar (${before.length} items before)`)
    await cdp.drag(JSON.parse(tabBox), JSON.parse(toolbarBox))
    await sleep(2000)

    const after = JSON.parse(await cdp.evaluate(TOOLBAR_TITLES))
    if (after.length !== before.length + 1) {
      fail(`dropping a tab on the toolbar did not save it (${before.length} -> ${after.length})`)
    }
    if (!after.some((title) => /settings/i.test(title))) {
      fail(`the dropped tab was saved without its title: ${JSON.stringify(after)}`)
    }
    log(`toolbar now holds: ${JSON.stringify(after)}`)

    // The drop must not also switch tabs to the dragged one, and must leave a
    // usable strip behind.
    if (await cdp.evaluate('!!document.querySelector(".home-v2-bookmark-toolbar[data-drop-target]")')) {
      fail('the toolbar kept its drop highlight after the release')
    }
    log('PASS')
  } finally {
    shutdown()
    await sleep(2500)
    try { rmSync(profile, { recursive: true, force: true }) } catch {}
  }
}

main().catch((error) => {
  console.error(`[bookmarks-smoke] ERROR: ${error.message}`)
  process.exitCode = 1
})
