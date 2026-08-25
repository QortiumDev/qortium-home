#!/usr/bin/env node
// Real-window smoke for per-role window geometry.
//
// Two claims that only a running app can settle:
//   1. An existing profile's flat window-state.json is still honoured after
//      the upgrade — the primary window opens at the size the user set, not
//      reset to the default.
//   2. A second window's geometry is stored separately, so closing it does not
//      redefine the size the main window opens at. That was the bug.
//
//   node scripts/smoke-desktop-home-v2-window-geometry.mjs
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Cdp, launchHomeV2, resolveAppImage, sleep } from './lib/home-v2-cdp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appImage = resolveAppImage(repoRoot)
const log = (message) => console.log(`[window-geometry-smoke] ${message}`)

// Deliberately not the default 1100x720, so "honoured" is distinguishable
// from "fell back". Both are above the 720x480 minimum.
const LEGACY_WIDTH = 980
const LEGACY_HEIGHT = 640
// Distinct from the primary and from the defaults, so the two records can only
// match by actually being separate.
const DETACHED_WIDTH = 820
const DETACHED_HEIGHT = 540

function fail(message) {
  console.error(`[window-geometry-smoke] FAIL: ${message}`)
  process.exitCode = 1
  throw new Error(message)
}

async function listShellTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  return (await response.json()).filter((entry) => entry.url.includes('v2-live.html'))
}

async function main() {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'home-v2-geometry-smoke-'))
  const statePath = path.join(profile, 'window-state.json')

  // The shape an existing profile already holds, written before geometry was
  // stored per role.
  writeFileSync(
    statePath,
    JSON.stringify({ height: LEGACY_HEIGHT, isMaximized: false, width: LEGACY_WIDTH }, null, 2),
    'utf8',
  )

  // A real window manager, so the second window is genuinely placed and can be
  // resized — without one every window sits at 0,0 and the geometry records
  // are indistinguishable, which makes the assertion vacuous.
  const { cdp, display, port, shutdown } = await launchHomeV2({
    appImage,
    log,
    portBase: 9000,
    profile,
    windowManager: true,
  })
  const xdo = (args) =>
    spawnSync('xdotool', args, { encoding: 'utf8', env: { ...process.env, DISPLAY: display } })
  // Only real windows: openbox maps helper and 1x1 windows of its own.
  const mappedWindowIds = () =>
    xdo(['search', '--onlyvisible', '--name', 'Qortium'])
      .stdout.trim()
      .split('\n')
      .filter(Boolean)
      .filter((windowId) => {
        const size = /Geometry:\s*(\d+)x(\d+)/.exec(
          xdo(['getwindowgeometry', windowId]).stdout,
        )
        return !!size && Number(size[1]) >= 400 && Number(size[2]) >= 300
      })
  try {
    const size = JSON.parse(
      await cdp.evaluate(
        'JSON.stringify({ width: window.outerWidth, height: window.outerHeight })',
      ),
    )
    log(`primary window opened at ${size.width}x${size.height}`)
    if (size.width !== LEGACY_WIDTH || size.height !== LEGACY_HEIGHT) {
      fail(
        `an existing profile's saved size was not honoured ` +
          `(wanted ${LEGACY_WIDTH}x${LEGACY_HEIGHT})`,
      )
    }

    // Open a tab and drag it out, which is how a secondary window appears.
    await cdp.evaluate(`(() => {
      const input = document.querySelector('.home-v2-address input')
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setValue.call(input, 'home://settings')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.closest('form').requestSubmit()
      return true
    })()`)
    await sleep(2500)
    const tab = await cdp.box('.home-v2-tab[data-internal-page="settings"] button[role=tab]')
    if (!tab) fail('the settings tab is not rendered')
    const windowsBeforeDrag = new Set(mappedWindowIds())
    await cdp.drag(tab, { x: tab.x + 40, y: tab.y + 260 }, 16)
    await sleep(4000)

    const targets = await listShellTargets(port)
    if (targets.length !== 2) fail(`expected a second window, saw ${targets.length}`)

    // Resize the detached window to a size nothing else could produce, then let
    // the debounced save run. This is what writes the secondary record — and
    // what used to overwrite the primary's.
    // Both Home windows carry the same title and, at this point, the same size,
    // so identify the detached one as the X window that appeared. Comparing
    // positions does not work: window.screenX reports the CONTENT origin,
    // which the frame decoration offsets from what xdotool reports.
    const appeared = mappedWindowIds().filter((windowId) => !windowsBeforeDrag.has(windowId))
    if (appeared.length !== 1) {
      fail(`expected exactly one new window, saw ${appeared.length}`)
    }
    const detachedWindowId = appeared[0]
    xdo(['windowsize', detachedWindowId, String(DETACHED_WIDTH), String(DETACHED_HEIGHT)])
    xdo(['windowmove', detachedWindowId, '260', '180'])
    await sleep(3000)

    const stored = JSON.parse(readFileSync(statePath, 'utf8'))
    log(`stored geometry: ${JSON.stringify(stored)}`)

    if (!stored.primary) fail('the upgraded record has no primary geometry')
    if (stored.primary.width !== LEGACY_WIDTH || stored.primary.height !== LEGACY_HEIGHT) {
      fail(
        `closing the detached window changed the primary geometry to ` +
          `${stored.primary.width}x${stored.primary.height}`,
      )
    }
    if (!stored.secondary) {
      fail('the detached window did not record its own geometry')
    }
    if (
      stored.secondary.width !== DETACHED_WIDTH ||
      stored.secondary.height !== DETACHED_HEIGHT
    ) {
      fail(
        `the detached window's own size was not recorded ` +
          `(saw ${stored.secondary.width}x${stored.secondary.height})`,
      )
    }
    log('the two windows keep separate geometry records')
    log('PASS')
  } finally {
    shutdown()
    await sleep(2500)
    try { rmSync(profile, { recursive: true, force: true }) } catch {}
  }
}

main().catch((error) => {
  console.error(`[window-geometry-smoke] ERROR: ${error.message}`)
  process.exitCode = 1
})
