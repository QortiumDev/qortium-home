#!/usr/bin/env node

// PREVIEW_QDN_PUBLISH_SOURCE, end to end: the preview must actually OPEN.
//
// The regression this guards is invisible to every other layer. The bridge
// returns `true` the moment it has sent the `open-publish-preview` IPC, so the
// app is told "Preview opened in Home" whether or not anything opens. That is
// exactly what shipped in 2.1.0: the shell's handler looked the requesting app
// up in `HomeV2Snapshot.apps`, a field the live shell never populates, and
// dropped every payload in silence. Unit tests could not see it -- the fixture
// shell DOES populate that list -- and the bridge's own tests could not see it
// either, because the bridge did its job. Only a run that goes looking for the
// opened tab can tell the two apart.
//
// Runs UNPACKAGED: the picker's smoke hook is development-only on purpose (see
// homeV2PublishSourceSmokePath in electron/home-v2-desktop-publish-source.ts),
// because a native file dialog cannot be driven over CDP and a shipped Home
// must never take that branch. Everything after the picker -- the path rules,
// the size caps, the token binding, the staging copy, the node POST and the
// tab open -- is the real flow.
//
// Prerequisites:
//   npm run build                       (dist/ and dist-electron/)
//   a local Qortium Core with the QDN test fixtures published
//   npm run smoke:desktop:qdn-publish-preview

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { launchHome, waitUntil } from './lib/electron-main-driver.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const nodeApiUrl = (process.env.QORTIUM_HOME_NODE_API_URL ?? 'http://127.0.0.1:24891').replace(
  /\/+$/,
  '',
)
const nodeApiKeyPath = (
  process.env.QORTIUM_HOME_NODE_API_KEY_PATH ?? '~/.config/qortium-core/runtime/apikey.txt'
).replace(/^~/, os.homedir())
const fixtureName = process.env.QORTIUM_HOME_QDN_API_FIXTURE_NAME ?? 'QortiumHomeTest'
const fixtureIdentifier = process.env.QORTIUM_HOME_QDN_API_APP_IDENTIFIER ?? 'home-test'
const fixtureAddress = `qdn://APP/${fixtureName}/${fixtureIdentifier}`
const APP_TAB_SELECTOR = '.home-v2-tabs .home-v2-tab:not(.home-v2-tab--dashboard)'
// A publish source token is bound to the tab's ACCOUNT, so the smoke needs one
// selected. electron/accounts.ts derives the wallet id from the encrypted
// wallet's address0, so these two must agree.
const smokeAddress = 'QSmokeHomeV2PublishPreviewAcct1'
const smokeWalletId = `wallet:${smokeAddress}`

// Seeds a wallet straight into the profile, exactly as
// scripts/smoke-desktop-home-v2-prompt.mjs does: Home restores it as the active
// account on a cold profile, which drives the real selection path without the
// native save dialog the in-app "Create account" flow needs. It is never
// unlocked -- nothing here signs.
// Skips onboarding, which otherwise opens a Welcome tab on a cold profile and
// takes the address bar with it.
function seedShellState(directory) {
  writeFileSync(
    path.join(directory, 'home-v2-shell-state.json'),
    JSON.stringify({
      appearance: {
        accent: 'clay',
        appZoom: 1,
        language: 'system',
        textSize: 'medium',
        theme: 'dark',
      },
      newTabPreference: { kind: 'search' },
      onboarding: { currentStep: 'finish', status: 'skipped', version: 1 },
      product: { activeTabId: null, destination: 'dashboard', tabs: [] },
      selectedAccountId: smokeWalletId,
      selectedAddressId: smokeWalletId,
      version: 3,
    }),
    { mode: 0o600 },
  )
}

function seedWalletStore(directory) {
  const now = new Date().toISOString()
  writeFileSync(
    path.join(directory, 'wallets.json'),
    `${JSON.stringify({
      activeAccountId: smokeWalletId,
      version: 1,
      wallets: [{
        address: smokeAddress,
        createdAt: now,
        derivedAddresses: [],
        encryptedWallet: {
          address0: smokeAddress,
          encryptedSeed: '1',
          iv: '1',
          kdfThreads: 1,
          mac: '1',
          salt: '1',
          version: 2,
        },
        id: smokeWalletId,
        label: 'Publish preview smoke',
        sourceFilename: 'qdn-publish-preview-smoke.json',
        updatedAt: now,
      }],
    }, null, 2)}\n`,
    'utf8',
  )
}

function log(message) {
  console.log(`[qdn-publish-preview-smoke] ${message}`)
}

// Runs `expression` inside the QDN app exactly as the app itself would, and
// reports a rejection instead of throwing an opaque CDP error.
function bridgeCall(request) {
  return `
    (async () => {
      try {
        return { ok: true, result: await window.qdnRequest(${JSON.stringify(request)}) }
      } catch (error) {
        return { ok: false, message: String((error && error.message) || error) }
      }
    })()
  `
}

if (!existsSync(path.join(repoRoot, 'dist', 'v2-live.html'))) {
  console.error('No built renderer at dist/v2-live.html. Run "npm run build" first.')
  process.exit(1)
}
if (!existsSync(nodeApiKeyPath)) {
  console.error(
    `No local node API key at ${nodeApiKeyPath}. Set QORTIUM_HOME_NODE_API_KEY_PATH.`,
  )
  process.exit(1)
}

const status = await fetch(
  `${nodeApiUrl}/arbitrary/resource/status/APP/${fixtureName}/${fixtureIdentifier}?build=true`,
)
  .then((response) => (response.ok ? response.json() : null))
  .catch(() => null)
if (status?.status !== 'READY') {
  console.error(
    `The QDN APP fixture at ${fixtureAddress} is not READY (${status?.status ?? 'unreachable'}). ` +
      'Run npm run qdn:bootstrap-test-data first.',
  )
  process.exit(1)
}

const profileDirectory = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-publish-preview-smoke-'))
seedWalletStore(profileDirectory)
seedShellState(profileDirectory)
const sourceDirectory = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-publish-preview-source-'))
const sourcePath = path.join(sourceDirectory, 'index.html')
writeFileSync(
  sourcePath,
  '<!doctype html><meta charset="utf-8"><title>Publish preview smoke</title>\n' +
    '<h1 id="publish-preview-smoke">Publish preview smoke</h1>\n',
  'utf8',
)

let home = null
let shell = null
let preview = null

try {
  home = await launchHome({
    env: {
      QORTIUM_HOME_NODE_API_KEY_PATH: nodeApiKeyPath,
      QORTIUM_HOME_NODE_API_URL: nodeApiUrl,
      QORTIUM_HOME_V2_PUBLISH_SOURCE_SMOKE: '1',
      QORTIUM_HOME_V2_PUBLISH_SOURCE_SMOKE_PATH: sourcePath,
    },
    profileDirectory,
    repoRoot,
  })

  shell = await home.renderer((url) => url.includes('/v2-live.html'), 'Home 2 shell')
  await shell.send('Runtime.enable')
  await waitUntil('the Home 2 address bar', 60_000, () =>
    shell.evaluate("!!document.querySelector('.home-v2-address input')"))
  // The tab binds its account when it opens, so wait for the seeded wallet to
  // become the selected account BEFORE navigating.
  await waitUntil('the seeded account to become selected', 60_000, async () =>
    (await shell.evaluate('window.homeV2Vault.getState()'))?.selectedAccountId === smokeWalletId)

  const opened = await shell.evaluate(`
    (async () => {
      const input = document.querySelector('.home-v2-address input')
      const form = input && input.closest('form')
      if (!form) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      input.focus()
      setter.call(input, ${JSON.stringify(fixtureAddress)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 80))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      return true
    })()
  `)
  assert.equal(opened, true, 'the address bar would not accept the fixture address')

  const app = await home.renderer(
    (url) => url.includes(`/render/APP/${fixtureName}`),
    'QDN fixture app',
  )
  try {
    await app.send('Runtime.enable')
    assert.equal(
      await app.evaluate('typeof window.qdnRequest'),
      'function',
      'qdnRequest was not injected into the QDN app',
    )

    const tabsBefore = await shell.evaluate(
      `document.querySelectorAll(${JSON.stringify(APP_TAB_SELECTOR)}).length`,
    )
    assert.equal(tabsBefore, 1, `expected the fixture app to be the only app tab, saw ${tabsBefore}`)

    const selection = await app.evaluate(bridgeCall({ action: 'SELECT_QDN_PUBLISH_SOURCE' }))
    assert.ok(selection?.ok, `SELECT_QDN_PUBLISH_SOURCE failed: ${selection?.message}`)
    assert.equal(
      selection.result?.fileName,
      'index.html',
      `the picker returned an unexpected file: ${JSON.stringify(selection.result?.fileName)}`,
    )
    const sourceToken = selection.result?.sourceToken
    assert.equal(typeof sourceToken, 'string', 'the picker returned no sourceToken')

    const previewed = await app.evaluate(
      bridgeCall({ action: 'PREVIEW_QDN_PUBLISH_SOURCE', sourceToken }),
    )
    assert.ok(previewed?.ok, `PREVIEW_QDN_PUBLISH_SOURCE failed: ${previewed?.message}`)
    assert.equal(previewed.result, true, 'PREVIEW_QDN_PUBLISH_SOURCE did not report success')

    // THE assertion. Everything above passed before the fix too.
    let previewUrl = null
    preview = await home.renderer((url) => {
      if (!url.startsWith(`${nodeApiUrl}/render/hash/`)) return false
      previewUrl = url
      return true
    }, 'publish preview tab')
    log(`the preview opened at ${previewUrl}`)

    await preview.send('Runtime.enable')
    await waitUntil('the previewed page to render', 30_000, () =>
      preview.evaluate("!!document.querySelector('#publish-preview-smoke')"))

    const tabsAfter = await waitUntil('the preview tab to appear in the strip', 30_000, async () => {
      const count = await shell.evaluate(
        `document.querySelectorAll(${JSON.stringify(APP_TAB_SELECTOR)}).length`,
      )
      return count > tabsBefore ? count : null
    })
    assert.equal(
      tabsAfter,
      tabsBefore + 1,
      `the preview should add exactly one tab: had ${tabsBefore}, now ${tabsAfter}`,
    )

    // The preview is its OWN tab: it must not replace the app that asked for it.
    assert.equal(
      await shell.evaluate(
        `[...document.querySelectorAll(${JSON.stringify(APP_TAB_SELECTOR)})]` +
          `.some((tab) => tab.textContent.includes(${JSON.stringify(fixtureName)}))`,
      ),
      true,
      'the preview replaced the fixture app tab instead of opening beside it',
    )

    // SELF-CHECK: prove the tab assertion can still fail. A refused preview
    // must leave the strip alone -- otherwise "one more tab" would pass on
    // anything that merely opens tabs, and the guard would go quietly green if
    // the preview stopped opening again.
    const refused = await app.evaluate(
      bridgeCall({ action: 'PREVIEW_QDN_PUBLISH_SOURCE', sourceToken: 'not-a-real-source-token' }),
    )
    assert.equal(refused?.ok, false, 'a bogus sourceToken was accepted')
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    assert.equal(
      await shell.evaluate(
        `document.querySelectorAll(${JSON.stringify(APP_TAB_SELECTOR)}).length`,
      ),
      tabsAfter,
      'a refused preview still changed the tab strip, so the tab count proves nothing',
    )
  } finally {
    app.close()
  }

  console.log('Desktop QDN publish preview smoke passed: the preview opened as its own app tab.')
} finally {
  preview?.close()
  shell?.close()
  home?.main.close()
  await home?.stop()
  rmSync(profileDirectory, { force: true, maxRetries: 5, recursive: true })
  rmSync(sourceDirectory, { force: true, maxRetries: 5, recursive: true })
}
