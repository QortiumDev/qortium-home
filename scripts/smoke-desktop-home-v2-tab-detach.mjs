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
import { fileURLToPath } from 'node:url'
import { Cdp, launchHomeV2, resolveAppImage, sleep } from './lib/home-v2-cdp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appImage = resolveAppImage(repoRoot)
const log = (message) => console.log(`[tab-detach-smoke] ${message}`)

function fail(message) {
  console.error(`[tab-detach-smoke] FAIL: ${message}`)
  process.exitCode = 1
  throw new Error(message)
}

const TAB_KEYS = `JSON.stringify(
  [...document.querySelectorAll('.home-v2-tab')].map(
    (tab) => tab.getAttribute('data-internal-page') || tab.getAttribute('data-tab-id'),
  ),
)`

async function listShellTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  return (await response.json()).filter((entry) => entry.url.includes('v2-live.html'))
}

async function main() {
  const { cdp, port, shutdown } = await launchHomeV2({ appImage, log, portBase: 9200 })
  try {
    // Two internal tabs, so the detached window can be checked for exactly one.
    for (const address of ['home://settings', 'home://apps']) {
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
    log(`detached window tabs: ${detached.keys.join(' ')}`)
    if (detached.keys.includes('apps')) {
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
    if (!stored.includes('apps')) {
      fail(
        `the detached window overwrote the stored tab strip (${stored.join(' ')}); ` +
          'its strip must be session-only',
      )
    }
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
    if (!afterWrite.includes('apps') || afterWrite.includes('clobber')) {
      fail(
        `a detached window's save replaced the stored tab strip (${afterWrite.join(' ')})`,
      )
    }
    detached.probe.socket.close()
    log('PASS')
  } finally {
    shutdown()
    await sleep(2500)
  }
}

main().catch((error) => {
  console.error(`[tab-detach-smoke] ERROR: ${error.message}`)
  process.exitCode = 1
})
