#!/usr/bin/env node
// Packaged smoke: the Dashboard navigates in place. Its Apps button turns the
// Dashboard tab into the Apps app (same tab id), Back returns the same tab to
// the Dashboard, Forward makes it the app again, and a Settings link from the
// Dashboard takes the tab over the same way. Drives the real AppImage on a
// fresh profile; no node or account is needed (the app view itself may fail
// to load -- only the tab model is asserted).
//
//   node scripts/smoke-desktop-home-v2-dashboard-inplace.mjs
//   QORTIUM_HOME_APPIMAGE=/path/to.AppImage node scripts/smoke-desktop-home-v2-dashboard-inplace.mjs
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const defaultAppImage = path.join(repoRoot, 'dist-release', `Qortium-Home-${packageJson.version}-x86_64.AppImage`)
const appImage = path.resolve(process.env.QORTIUM_HOME_APPIMAGE?.trim() || defaultAppImage)
const appTimeoutMs = Number(process.env.QORTIUM_HOME_SMOKE_TIMEOUT_MS || 90_000)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (message) => console.log(`[dashboard-inplace] ${message}`)
function fail(message) {
  console.error(`[dashboard-inplace] FAIL: ${message}`)
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
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.text} :: ${expression}`)
    return result.result?.value
  }
}

// The strip, as [{id, page|null, selected}] in DOM order.
const TAB_STATE = `JSON.stringify([...document.querySelectorAll('.home-v2-tab')].map((tab) => ({
  id: tab.getAttribute('data-tab-id'),
  page: tab.getAttribute('data-internal-page'),
  selected: tab.querySelector('button[role=tab]')?.getAttribute('aria-selected') === 'true',
})))`

async function main() {
  if (!existsSync(appImage)) fail(`AppImage not found: ${appImage} (run npm run dist:linux:x64 first)`)
  const port = 9400 + (process.pid % 400)
  const profile = mkdtempSync(path.join(os.tmpdir(), 'home-v2-dashboard-inplace-'))
  const useXvfb = !process.env.DISPLAY && existsSync('/usr/bin/xvfb-run')
  const command = useXvfb ? '/usr/bin/xvfb-run' : appImage
  const args = useXvfb ? ['-a', appImage, `--remote-debugging-port=${port}`] : [`--remote-debugging-port=${port}`]
  log(`starting ${path.basename(appImage)} (CDP ${port})`)
  const child = spawn(command, args, {
    detached: true,
    env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1', QORTIUM_HOME_USER_DATA_DIR: profile },
    stdio: 'ignore',
  })
  const shutdown = () => {
    try { process.kill(-child.pid, 'SIGTERM') } catch {}
    setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 2000).unref?.()
  }
  const onSignal = () => { shutdown(); process.exit(130) }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  process.once('exit', () => { try { process.kill(-child.pid, 'SIGKILL') } catch {} })

  let cdp = null
  try {
    let target = null
    const deadline = Date.now() + appTimeoutMs
    while (!target && Date.now() < deadline) {
      await sleep(1000)
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`)
        target = (await response.json()).find((entry) => entry.url.includes('v2-live.html'))
      } catch {}
    }
    if (!target) fail('the Home 2 shell target never appeared')
    cdp = new Cdp(target.webSocketDebuggerUrl)
    await cdp.ready
    await cdp.send('Runtime.enable')

    const until = async (label, read) => {
      const deadline = Date.now() + appTimeoutMs
      while (Date.now() < deadline) {
        const result = await read()
        if (result) return result
        await sleep(250)
      }
      fail(`timed out waiting for ${label}`)
    }
    await until('the shell', () => cdp.evaluate('document.readyState === "complete" && !!document.querySelector(".home-v2-tabs")'))
    await until('shell state persistence', () => existsSync(path.join(profile, 'home-v2-shell-state.json')))
    const activePage = `(() => document.querySelector('.home-v2-page-slot:not([hidden])')?.getAttribute('data-internal-page') ?? null)()`
    const initial = await until('Welcome or Dashboard', async () => {
      const page = await cdp.evaluate(activePage)
      return page === 'dashboard' || page === 'welcome' ? page : null
    })
    if (initial === 'welcome') {
      const skipped = await cdp.evaluate(`(() => {
        const button = [...document.querySelectorAll('.home-v2-welcome button')].find((c) => c.textContent.trim() === 'Skip setup')
        if (!button) return false
        button.click()
        return true
      })()`)
      if (!skipped) fail('Welcome has no Skip setup button')
    }
    await until('the Dashboard', async () => (await cdp.evaluate(activePage)) === 'dashboard')
    // Onboarding can open a Welcome tab a moment after launch and steal the
    // active tab; settle, then make sure the Dashboard tab is the active one.
    await sleep(2000)
    await cdp.evaluate(`document.querySelector('.home-v2-tab[data-internal-page="dashboard"] button[role=tab]')?.click()`)
    await until('the Dashboard tab active', async () =>
      JSON.parse(await cdp.evaluate(TAB_STATE)).find((tab) => tab.selected)?.page === 'dashboard')

    const strip = () => cdp.evaluate(TAB_STATE).then(JSON.parse)
    const before = await strip()
    const dashboard = before.find((tab) => tab.selected)
    log(`strip before: ${before.map((t) => `${t.page ?? 'app'}${t.selected ? '*' : ''}`).join(' ')} (dashboard tab ${dashboard.id})`)

    // Apps from the Dashboard header: the same tab becomes the app.
    await until('the Apps button', () => cdp.evaluate(`!!document.querySelector('[data-home-v2-pinned-apps-action="apps"]:not([disabled])')`))
    await cdp.evaluate(`document.querySelector('[data-home-v2-pinned-apps-action="apps"]').click()`)
    const afterApps = await until('the Dashboard tab to become the app', async () => {
      const tabs = await strip()
      const same = tabs.find((tab) => tab.id === dashboard.id)
      return same && same.page === null && same.selected ? tabs : null
    })
    if (afterApps.length !== before.length) fail(`a tab was added: ${afterApps.length} vs ${before.length}`)
    if (afterApps.findIndex((t) => t.id === dashboard.id) !== before.findIndex((t) => t.id === dashboard.id)) fail('the tab moved')
    log('Apps opened in the Dashboard tab (same id, same slot, no new tab)')

    // Back returns the same tab to the Dashboard; Forward makes it the app again.
    const back = '.home-v2-browser-controls button[aria-label="Back"]'
    const forward = '.home-v2-browser-controls button[aria-label="Forward"]'
    await until('Back enabled', () => cdp.evaluate(`!document.querySelector(${JSON.stringify(back)}).disabled`))
    await cdp.evaluate(`document.querySelector(${JSON.stringify(back)}).click()`)
    await until('Back to the Dashboard in the same tab', async () => {
      const tabs = await strip()
      const same = tabs.find((tab) => tab.id === dashboard.id)
      return same?.page === 'dashboard' && same.selected && (await cdp.evaluate(activePage)) === 'dashboard'
    })
    if ((await strip()).length !== before.length) fail('Back changed the tab count')
    log('Back returned the tab to the Dashboard')
    await until('Forward enabled', () => cdp.evaluate(`!document.querySelector(${JSON.stringify(forward)}).disabled`))
    await cdp.evaluate(`document.querySelector(${JSON.stringify(forward)}).click()`)
    await until('Forward into the app again', async () => {
      const same = (await strip()).find((tab) => tab.id === dashboard.id)
      return same?.page === null && same.selected
    })
    log('Forward re-entered the app in the same tab')
    await cdp.evaluate(`document.querySelector(${JSON.stringify(back)}).click()`)
    await until('Back to the Dashboard again', async () => (await cdp.evaluate(activePage)) === 'dashboard')

    // A Settings link on the Dashboard takes the tab over the same way.
    await until('a Settings link', () => cdp.evaluate(`!!document.querySelector('.home-v2-node-core-card button.home-v2-link-button, .home-v2-dashboard button[aria-label^="Settings"]')`))
    await cdp.evaluate(`(document.querySelector('.home-v2-dashboard button[aria-label^="Settings"]') ?? document.querySelector('.home-v2-node-core-card button.home-v2-link-button')).click()`)
    await until('Settings in the Dashboard tab', async () => {
      const tabs = await strip()
      const same = tabs.find((tab) => tab.id === dashboard.id)
      return same?.page === 'settings' && same.selected && tabs.length === before.length
    })
    log('Settings opened in the Dashboard tab')
    await cdp.evaluate(`document.querySelector(${JSON.stringify(back)}).click()`)
    await until('Back from Settings to the Dashboard', async () => {
      const same = (await strip()).find((tab) => tab.id === dashboard.id)
      return same?.page === 'dashboard' && (await cdp.evaluate(activePage)) === 'dashboard'
    })
    log('Back returned from Settings to the Dashboard')

    // The address bar still opens its own tab.
    await cdp.evaluate(`(() => {
      const input = document.querySelector('.home-v2-address input')
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setValue.call(input, 'home://settings')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.closest('form').requestSubmit()
    })()`)
    await until('a separate Settings tab from the address bar', async () => {
      const tabs = await strip()
      return tabs.length === before.length + 1 && tabs.find((tab) => tab.id === dashboard.id)?.page === 'dashboard'
    })
    log('the address bar still opens a tab of its own')
    log('PASS')
  } finally {
    shutdown()
    await sleep(2500)
    try { rmSync(profile, { recursive: true, force: true }) } catch {}
  }
}

main().catch((error) => {
  if (!process.exitCode) {
    console.error(`[dashboard-inplace] FAIL: ${error.message}`)
    process.exitCode = 1
  }
})
