#!/usr/bin/env node
// "When Home opens" must actually change what opens.
//
// Home 2 always reopened the last session's tabs. The setting adds two other
// answers, and the only proof that they work is the packaged app: the stored
// strip has to be left alone, and the configured start pages opened instead.
//
// Seeds a shell state whose stored tabs are Settings and the search page --
// both distinguishable in the tab strip -- and a bookmark store whose start
// pages are neither. The start pages live in the bookmark manager, which the
// Bookmarks app edits; Home only decides whether to use them.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchHomeV2, resolveAppImage, sleep } from './lib/home-v2-cdp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const log = (message) => console.log(`[startup-pages] ${message}`)

const STORED_TABS = {
  activeTabId: 'internal-stored-1',
  entries: [
    { kind: 'internal', id: 'internal-stored-1', page: 'settings' },
    { kind: 'internal', id: 'internal-stored-2', page: 'newtab' },
  ],
}

function seedShellState(profile, startup) {
  writeFileSync(
    path.join(profile, 'home-v2-shell-state.json'),
    JSON.stringify({
      version: 4,
      appearance: {},
      newTabPreference: { kind: 'dashboard' },
      // Skipped, or Home opens the welcome flow in a tab of its own and every
      // count below is one too many. The shape matters: an onboarding record
      // that does not parse falls back to in-progress.
      onboarding: { currentStep: 'finish', status: 'skipped', version: 1 },
      selectedAccountId: null,
      selectedAddressId: null,
      product: STORED_TABS,
      ...startup,
    }),
  )
  return profile
}

// The tab strip, by what each tab IS rather than by its label: an internal
// page reports its page name, an app tab reports 'app'.
const TAB_PAGES = `(() => {
  const tabs = [...document.querySelectorAll('.home-v2-tabs .home-v2-tab')]
  return JSON.stringify(
    tabs.map((tab) => tab.getAttribute('data-internal-page') || 'app'),
  )
})()`

async function tabPages(cdp) {
  const deadline = Date.now() + 30_000
  let pages = []
  while (Date.now() < deadline) {
    pages = JSON.parse((await cdp.evaluate(TAB_PAGES)) ?? '[]')
    // The strip settles a moment after the state is read, and a start-page
    // launch closes its initial tab only once the pages are open. Keep looking
    // until it stops changing rather than trusting the first sample.
    await sleep(750)
    const again = JSON.parse((await cdp.evaluate(TAB_PAGES)) ?? '[]')
    if (pages.length > 0 && JSON.stringify(pages) === JSON.stringify(again)) break
    pages = again
  }
  return pages
}

const cases = [
  {
    name: 'restore (the default, and what Home always did)',
    startup: {},
    expect: (pages) => {
      assert.deepEqual(
        pages,
        ['settings', 'newtab'],
        'the stored tabs must come back exactly as they were',
      )
    },
  },
  {
    name: 'start pages replace the stored strip',
    startup: { startupPreference: { kind: 'startPages' } },
    startPages: ['home://dashboard', 'home://welcome'],
    expect: (pages) => {
      // The stored strip is gone, the start pages are what is open, and the
      // initial Dashboard tab did not survive in front of them.
      assert.deepEqual(pages, ['dashboard', 'welcome'])
    },
  },
  {
    name: 'a new tab, following the New tab setting',
    startup: { startupPreference: { kind: 'newTab' } },
    expect: (pages) => {
      // newTabPreference is 'dashboard' in the seeded state, so this is it.
      assert.deepEqual(pages, ['dashboard'])
    },
  },
]

// The start pages live in the bookmark manager's localStorage record, written
// by the Bookmarks app. There is no file to seed, so a case that needs them
// runs Home once to plant them, closes it, and asserts on the next launch --
// which is also the only honest way to test a LAUNCH behaviour.
const SNAPSHOT_KEY = 'qortium-home-bookmark-manager-snapshot'

function plantStartPages(startPages) {
  const snapshot = {
    bookmarks: [],
    dashboardPins: [],
    revision: 1,
    schemaVersion: 1,
    startPages: startPages.map((displayUrl) => ({ accountId: null, displayUrl })),
    toolbar: [],
    toolbarVisibility: 'always',
  }
  return `window.localStorage.setItem(${JSON.stringify(SNAPSHOT_KEY)}, ${JSON.stringify(
    JSON.stringify(snapshot),
  )})`
}

let failures = 0
for (const [index, testCase] of cases.entries()) {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'home-v2-startup-pages-'))
  // Each case gets its own port; they run one at a time, but a lingering
  // process from the previous one must not be attached to by mistake.
  const portBase = 9_480 + index * 8
  let session = null
  try {
    if (testCase.startPages) {
      seedShellState(profile, {})
      const planting = await launchHomeV2({
        appImage: resolveAppImage(repoRoot),
        log,
        portBase,
        profile,
      })
      await planting.cdp.evaluate(plantStartPages(testCase.startPages))
      planting.shutdown()
      await sleep(2500)
    }
    // Written AFTER the planting run, which saves a shell state of its own on
    // the way through and would otherwise overwrite the choice under test.
    seedShellState(profile, testCase.startup)
    session = await launchHomeV2({
      appImage: resolveAppImage(repoRoot),
      log,
      portBase: portBase + 4,
      profile,
    })
    const pages = await tabPages(session.cdp)
    testCase.expect(pages)
    log(`PASS ${testCase.name} -- ${JSON.stringify(pages)}`)
  } catch (error) {
    failures += 1
    log(`FAIL ${testCase.name}: ${error instanceof Error ? error.message : error}`)
  } finally {
    session?.shutdown()
    try { rmSync(profile, { recursive: true, force: true }) } catch {}
    await sleep(1500)
  }
}

assert.equal(failures, 0, `${failures} startup case(s) failed`)
log('PASS')
