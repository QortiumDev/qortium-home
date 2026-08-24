#!/usr/bin/env node
// Real-input tab smoke for the Home 2 shell.
//
// Why this exists: every other Home 2 smoke activates tabs with
// element.click() from JavaScript, which never produces pointer events. A
// pointer-capture regression in the tab strip therefore shipped completely
// green (PR #351: capturing on the tab container retargeted the follow-up
// click away from button[role=tab], so no tab could be switched with a
// mouse). This script drives genuine input through CDP's
// Input.dispatchMouseEvent, which is the only way that class of defect is
// visible, and asserts a JS .click() control path for contrast.
//
//   node scripts/smoke-desktop-home-v2-tabs.mjs
//   QORTIUM_HOME_APPIMAGE=/path/to.AppImage node scripts/smoke-desktop-home-v2-tabs.mjs
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
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
const log = (message) => console.log(`[tabs-smoke] ${message}`)

function fail(message) {
  console.error(`[tabs-smoke] FAIL: ${message}`)
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
      message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result)
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

  /** A genuine press/release pair: Chromium expands this into the full
   *  pointerdown / mousedown / pointerup / mouseup / click sequence. */
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
    })
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1,
    })
  }
}

const TAB_STATE = `JSON.stringify([...document.querySelectorAll('.home-v2-tab')].map((tab) => ({
  key: tab.getAttribute('data-internal-page') || tab.getAttribute('data-tab-id'),
  selected: tab.querySelector('button[role=tab]')?.getAttribute('aria-selected') === 'true',
})))`

function centreOf(box) {
  return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }
}

async function main() {
  if (!existsSync(appImage)) {
    fail(`AppImage not found: ${appImage} (run npm run dist:linux:x64 first)`)
  }
  const port = 9400 + (process.pid % 400)
  const profile = mkdtempSync(path.join(os.tmpdir(), 'home-v2-tabs-smoke-'))
  const useXvfb = !process.env.DISPLAY && existsSync('/usr/bin/xvfb-run')
  const command = useXvfb ? '/usr/bin/xvfb-run' : appImage
  const args = useXvfb
    ? ['-a', appImage, `--remote-debugging-port=${port}`]
    : [`--remote-debugging-port=${port}`]

  log(`starting ${path.basename(appImage)} (CDP ${port})`)
  const child = spawn(command, args, {
    env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1', QORTIUM_HOME_USER_DATA_DIR: profile },
    stdio: 'ignore',
  })

  let cdp = null
  try {
    let target = null
    const deadline = Date.now() + appTimeoutMs
    while (!target && Date.now() < deadline) {
      await sleep(1000)
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`)
        target = (await response.json()).find((entry) => entry.url.includes('v2-live.html'))
      } catch {
        // The shell is not listening yet.
      }
    }
    if (!target) fail('the Home 2 shell target never appeared')

    cdp = new Cdp(target.webSocketDebuggerUrl)
    await cdp.ready
    await cdp.send('Runtime.enable')

    const readyDeadline = Date.now() + appTimeoutMs
    while (Date.now() < readyDeadline) {
      if (await cdp.evaluate('document.readyState === "complete" && !!document.querySelector(".home-v2-tabs")')) break
      await sleep(1000)
    }

    // Open a second internal page through the ordinary address-bar route so
    // there are two tabs to switch between.
    await cdp.evaluate(`(() => {
      const input = document.querySelector('.home-v2-address input')
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setValue.call(input, 'home://settings')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.closest('form').requestSubmit()
      return true
    })()`)
    await sleep(2500)

    const before = JSON.parse(await cdp.evaluate(TAB_STATE))
    log(`tabs: ${before.map((tab) => `${tab.key}${tab.selected ? '*' : ''}`).join(' ')}`)
    const dashboard = before.find((tab) => tab.key === 'dashboard')
    if (!dashboard) fail('no dashboard tab in the strip')
    if (dashboard.selected) fail('settings did not become the active tab; cannot test switching')

    const box = await cdp.evaluate(`(() => {
      const button = document.querySelector('.home-v2-tab[data-internal-page="dashboard"] button[role=tab]')
      if (!button) return null
      const rect = button.getBoundingClientRect()
      return JSON.stringify({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    })()`)
    if (!box) fail('dashboard tab button not found')

    const point = centreOf(JSON.parse(box))
    log(`real mouse click at ${point.x},${point.y}`)
    await cdp.click(point.x, point.y)
    await sleep(1200)

    const after = JSON.parse(await cdp.evaluate(TAB_STATE))
    const switched = after.find((tab) => tab.key === 'dashboard')?.selected === true
    if (!switched) {
      fail(
        'a real mouse click did not switch tabs — the tab strip is only ' +
          'operable from JavaScript (pointer-capture style regression)',
      )
    }
    log('real mouse click switched the active tab')

    // Drag-to-reorder is what the (removed) pointer capture existed for, so
    // prove it still works with genuine input rather than trusting the unit
    // tests, which only exercise the reducer.
    const order = after.map((tab) => tab.key)
    if (order.length >= 2) {
      const firstBox = JSON.parse(await cdp.evaluate(`(() => {
        const tab = document.querySelector('.home-v2-tab[data-internal-page="${order[0]}"]')
        const rect = tab.getBoundingClientRect()
        return JSON.stringify({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
      })()`))
      const lastBox = JSON.parse(await cdp.evaluate(`(() => {
        const tab = document.querySelector('.home-v2-tab[data-internal-page="${order[order.length - 1]}"]')
        const rect = tab.getBoundingClientRect()
        return JSON.stringify({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
      })()`))
      const from = centreOf(firstBox)
      // Drop PAST the last tab's midpoint, not on its centre: "insert after"
      // only triggers once the pointer crosses that midpoint, so releasing at
      // the centre is a no-op by design and would make this assertion flaky.
      const to = {
        x: Math.round(lastBox.left + lastBox.width - 4),
        y: Math.round(lastBox.top + lastBox.height / 2),
      }
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1,
      })
      for (let step = 1; step <= 6; step += 1) {
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: Math.round(from.x + ((to.x - from.x) * step) / 6),
          y: from.y,
          button: 'left',
          buttons: 1,
        })
        await sleep(60)
      }
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1,
      })
      await sleep(900)
      const reordered = JSON.parse(await cdp.evaluate(TAB_STATE)).map((tab) => tab.key)
      if (reordered[0] === order[0]) {
        fail(`dragging the first tab to the end did not reorder it (still ${reordered.join(' ')})`)
      }
      log(`drag reorder: ${order.join(' ')} -> ${reordered.join(' ')}`)
    }

    log(`PASS — tabs: ${after.map((tab) => `${tab.key}${tab.selected ? '*' : ''}`).join(' ')}`)
  } finally {
    try { cdp?.socket.close() } catch {}
    child.kill('SIGTERM')
    await sleep(1500)
    child.kill('SIGKILL')
  }
}

main().catch((error) => {
  console.error(`[tabs-smoke] ${error.message}`)
  process.exitCode = 1
})
