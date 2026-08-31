#!/usr/bin/env node
// The Dashboard must never draw one network's panels without the other's.
//
// It decides which networks to show from the node modes. Those used to arrive
// only with the full node snapshot, which contacts every configured node and
// takes about four seconds, so the renderer painted from its placeholder modes
// first -- Qortium local, Qortal disabled -- and the Qortal panels appeared out
// of nowhere once the snapshot landed. A settings-only read now answers that
// question immediately, and the Dashboard waits for it.
//
// This drives the REAL packaged app. The recorder is installed with
// Page.addScriptToEvaluateOnNewDocument and the window reloaded, because
// attaching afterwards is far too late to see a first paint.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchHomeV2, resolveAppImage, sleep } from './lib/home-v2-cdp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const log = (message) => console.log(`[dashboard-networks] ${message}`)

// Both networks ENABLED, and both on public so the assertion needs no Core and
// no reachable node: a panel is drawn from the configured mode, not from
// whether the node answers.
const profile = mkdtempSync(path.join(os.tmpdir(), 'home-v2-dashboard-networks-'))
writeFileSync(
  path.join(profile, 'qortal-node-settings.json'),
  `${JSON.stringify({ customUrl: '', lastEnabledMode: 'public', mode: 'public' }, null, 2)}\n`,
)
writeFileSync(
  path.join(profile, 'node-settings.json'),
  `${JSON.stringify({ customUrl: '', lastEnabledMode: 'public', mode: 'public' }, null, 2)}\n`,
)

// Runs before any application script, on every document.
const RECORDER = `(() => {
  const state = { violations: [], sawBoth: false, frames: 0 }
  window.__dashboardNetworks = state
  const look = () => {
    state.frames += 1
    const dashboard = document.querySelector('.home-v2-dashboard')
    if (dashboard) {
      const text = dashboard.innerText || ''
      const qortium = text.includes('Qortium connection')
      const qortal = text.includes('Qortal connection')
      if (qortium && qortal) state.sawBoth = true
      // One without the other is the defect, whichever way round.
      if (qortium !== qortal) {
        state.violations.push({ at: Math.round(performance.now()), qortal, qortium })
      }
    }
    requestAnimationFrame(look)
  }
  requestAnimationFrame(look)
})()`

let session = null
try {
  session = await launchHomeV2({
    appImage: resolveAppImage(repoRoot),
    log,
    portBase: 9_460,
    profile,
  })
  const { cdp } = session

  await cdp.send('Page.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER })
  log('recorder armed; reloading so it runs before the app does')
  await cdp.send('Page.reload')

  const deadline = Date.now() + 60_000
  let state = null
  while (Date.now() < deadline) {
    await sleep(250)
    state = await cdp.evaluate('JSON.stringify(window.__dashboardNetworks ?? null)')
    const parsed = state ? JSON.parse(state) : null
    if (parsed?.sawBoth) break
  }
  const observed = state ? JSON.parse(state) : null
  assert.ok(observed, 'the recorder never ran')
  assert.ok(
    observed.frames > 30,
    `the recorder must have sampled many frames, saw ${observed.frames}`,
  )
  assert.ok(
    observed.sawBoth,
    'both connection panels must appear when both networks are enabled',
  )
  // Reported as a count and a span rather than a raw list: the pre-fix run
  // produced 244 of these, and a screenful of near-identical frames buries the
  // one fact that matters.
  const violations = observed.violations
  const span = violations.length
    ? `${violations[0].at}ms to ${violations[violations.length - 1].at}ms`
    : 'none'
  assert.equal(
    violations.length,
    0,
    `the Dashboard drew one network without the other on ${violations.length} ` +
      `frames (${span}) -- that is the pop-in. First: ` +
      JSON.stringify(violations[0] ?? null),
  )
  log(`PASS (${observed.frames} frames sampled, no half-drawn Dashboard)`)
} finally {
  session?.shutdown()
  try { rmSync(profile, { recursive: true, force: true }) } catch {}
}
