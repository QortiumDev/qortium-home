#!/usr/bin/env node

// Regression guard for I7: `100vh` inside the Home 2 shell must mean the
// window, at every app zoom level.
//
// The bug this pins: `.home-v2-shell` once carried CSS `zoom`, while the app
// viewport inside it was sized `height: calc(100vh - <chrome>)`. CSS `zoom` is
// not vh-aware — `100vh` resolves to the raw window height in CSS px and is
// then multiplied by the zoom when painted, so a 720px window painted an 841px
// shell at 120%. The overflow made the document scrollable and focusing app
// content scrolled it, which is what the owner saw as "top bar above the
// window, composer below the bottom". It only reproduced away from 100%, which
// is why it was invisible on the developer's machine and reported from
// someone else's.
//
// The fix routed app zoom through Electron's NATIVE zoom, which scales vh with
// everything else. This asserts the INVARIANT rather than the mechanism — a
// probe element of `height: 100vh` inside the shell must paint the window's
// height — so it stays honest if the mechanism changes again, and it fails the
// moment anyone reintroduces a zoomed ancestor above vh math.

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchHome, waitUntil } from './lib/electron-main-driver.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const profileDirectory = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-app-zoom-smoke-'))
// The Appearance zoom levels around the default, including the 120% the
// original report came from.
const ZOOM_PERCENTS = [100, 80, 120, 150]
// One CSS pixel of slack for sub-pixel rounding. The bug was 121px.
const TOLERANCE_PX = 1

let home = null
let renderer = null

// Measures what `100vh` actually paints to inside the shell, plus the chrome
// height the app viewport subtracts — both in the same units the CSS uses.
const MEASURE = `(() => {
  const shell = document.querySelector('.home-v2-shell')
  if (!shell) return null
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:100vh;pointer-events:none'
  shell.appendChild(probe)
  const paintedVh = probe.getBoundingClientRect().height
  probe.remove()
  const chromeRaw = getComputedStyle(shell).getPropertyValue('--v2-chrome-height').trim()
  return {
    chromeHeight: chromeRaw ? Number.parseFloat(chromeRaw) : null,
    cssZoom: getComputedStyle(shell).zoom,
    paintedVh,
    windowHeight: window.innerHeight,
  }
})()`

try {
  home = await launchHome({ profileDirectory, repoRoot })
  renderer = await home.renderer((url) => url.includes('/v2-live.html'), 'Home 2 app zoom')
  await renderer.send('Runtime.enable')
  await renderer.send('Page.enable')
  await waitUntil('the Home 2 shell to render', 60_000, () =>
    renderer.evaluate(`!!document.querySelector('.home-v2-shell')`))

  for (const percent of ZOOM_PERCENTS) {
    const applied = await renderer.evaluate(
      `window.homeV2Zoom.set(${percent}).then((value) => String(value)).catch((error) => 'ERR:' + error.message)`,
    )
    assert.equal(applied, String(percent), `app zoom ${percent}% was not applied (got ${applied})`)
    // Native zoom resizes the CSS viewport, so wait for the window to settle
    // rather than racing the resize.
    await waitUntil(`the window to settle at ${percent}% zoom`, 15_000, async () => {
      const first = await renderer.evaluate('window.innerHeight')
      await new Promise((resolve) => setTimeout(resolve, 150))
      return (await renderer.evaluate('window.innerHeight')) === first
    })

    const measurement = await renderer.evaluate(MEASURE)
    assert.ok(measurement, 'the shell disappeared during measurement')
    const drift = measurement.paintedVh - measurement.windowHeight
    console.log(
      `[app-zoom-smoke] ${String(percent).padStart(3)}%  100vh paints ${measurement.paintedVh.toFixed(1)}  ` +
      `window ${measurement.windowHeight}  drift ${drift.toFixed(1)}px  ` +
      `cssZoom ${measurement.cssZoom}  chrome ${measurement.chromeHeight ?? 'unset'}`,
    )
    assert.ok(
      Math.abs(drift) <= TOLERANCE_PX,
      `at ${percent}% app zoom, 100vh inside the shell paints ${drift.toFixed(1)}px away from the window ` +
      '(the I7 overflow regression: vh math under a zoomed ancestor)',
    )
    // The app viewport is `calc(100vh - var(--v2-chrome-height))`, so a chrome
    // height measured in the wrong unit reintroduces the same overflow by
    // another route. It must be a plausible fraction of the window, never a
    // zoom-scaled value.
    if (measurement.chromeHeight !== null) {
      assert.ok(
        measurement.chromeHeight > 0 && measurement.chromeHeight < measurement.windowHeight,
        `at ${percent}% app zoom the measured chrome height (${measurement.chromeHeight}) is not a ` +
        'fraction of the window; it is likely being measured in painted rather than layout pixels',
      )
    }
  }

  // SELF-CHECK: prove this guard can still fail. A regression test for a rare
  // condition is worth only as much as its ability to detect that condition,
  // and this one would go quietly green if the probe ever stopped seeing a
  // zoomed ancestor. Reintroduce the exact bug shape, confirm the drift is
  // seen, and remove it.
  await renderer.evaluate(`document.querySelector('.home-v2-shell').style.zoom = '1.2'`)
  await new Promise((resolve) => setTimeout(resolve, 500))
  const injected = await renderer.evaluate(MEASURE)
  await renderer.evaluate(`document.querySelector('.home-v2-shell').style.removeProperty('zoom')`)
  const injectedDrift = injected.paintedVh - injected.windowHeight
  console.log(`[app-zoom-smoke] self-check: a 1.2 CSS zoom on the shell drifts ${injectedDrift.toFixed(1)}px`)
  assert.ok(
    injectedDrift > TOLERANCE_PX,
    'the self-check did not detect a deliberately zoomed shell, so this guard would not catch the ' +
    'regression it exists for',
  )
  const restored = await renderer.evaluate(MEASURE)
  assert.ok(
    Math.abs(restored.paintedVh - restored.windowHeight) <= TOLERANCE_PX,
    'the self-check left the shell zoomed',
  )

  console.log('Home 2 app zoom smoke passed: 100vh means the window at every zoom level.')
} finally {
  renderer?.close()
  home?.main.close()
  await home?.stop()
  rmSync(profileDirectory, { force: true, maxRetries: 5, recursive: true })
}
