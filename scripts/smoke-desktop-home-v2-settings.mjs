#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createManagedProcess } from './lib/managed-process.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDirectory, '..')
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const appImage = path.resolve(
  process.env.QORTIUM_HOME_APPIMAGE?.trim() ||
    path.join(repoRoot, 'dist-release', `Qortium-Home-${packageJson.version}-x86_64.AppImage`),
)
const screenshotPath = path.resolve(
  process.env.QORTIUM_HOME_SETTINGS_SCREENSHOT?.trim() ||
    '/tmp/qortium-home-2.1-settings.png',
)
const rtlScreenshotPath = path.resolve(
  process.env.QORTIUM_HOME_SETTINGS_RTL_SCREENSHOT?.trim() ||
    '/tmp/qortium-home-2.1-settings-ar.png',
)
const coreScreenshotPath = path.resolve(
  process.env.QORTIUM_HOME_CORE_SETTINGS_SCREENSHOT?.trim() ||
    '/tmp/qortium-home-2.1-core-settings.png',
)
const updateScreenshotPath = path.resolve(
  process.env.QORTIUM_HOME_UPDATE_SETTINGS_SCREENSHOT?.trim() ||
    '/tmp/qortium-home-2.1-update-settings.png',
)
const coreDashboardScreenshotPath = path.resolve(
  process.env.QORTIUM_HOME_CORE_DASHBOARD_SCREENSHOT?.trim() ||
    '/tmp/qortium-home-2.1-core-dashboard.png',
)
const qortalMaintenanceScreenshotPath = path.resolve(
  process.env.QORTIUM_HOME_QORTAL_MAINTENANCE_SCREENSHOT?.trim() ||
    '/tmp/qortium-home-2.1-qortal-maintenance.png',
)
const profileDirectory = mkdtempSync(
  path.join(os.tmpdir(), 'qortium-home-v2-settings-smoke-'),
)
const timeoutMs = 60_000
let appProcess = null

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function waitUntil(label, action) {
  const startedAt = Date.now()
  let lastError = null
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await action()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : ''
  throw new Error(`${label} timed out${detail}`)
}

class CdpClient {
  constructor(webSocketUrl) {
    this.nextId = 1
    this.pending = new Map()
    this.socket = new WebSocket(webSocketUrl)
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
  }

  async send(method, params = {}) {
    await this.ready
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { reject, resolve })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.socket.close()
  }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'CDP evaluation failed.')
  }
  return result.result?.value
}

async function pageTarget(port) {
  return waitUntil('packaged Home settings page', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`)
    if (!response.ok) return null
    const targets = await response.json()
    return (
      targets.find(
        (target) =>
          target.type === 'page' &&
          target.url?.includes('/v2-live.html') &&
          target.webSocketDebuggerUrl,
      ) ?? null
    )
  })
}

try {
  assert.equal(existsSync(appImage), true, `AppImage not found: ${appImage}`)
  const port = await getFreePort()
  const useXvfb = !process.env.DISPLAY && existsSync('/usr/bin/xvfb-run')
  appProcess = createManagedProcess(
    useXvfb ? '/usr/bin/xvfb-run' : appImage,
    useXvfb
      ? ['-a', appImage, `--remote-debugging-port=${port}`]
      : [`--remote-debugging-port=${port}`],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        QORTIUM_HOME_USER_DATA_DIR: profileDirectory,
        XDG_CONFIG_HOME: path.join(profileDirectory, 'config'),
      },
    },
  )

  const target = await pageTarget(port)
  const client = new CdpClient(target.webSocketDebuggerUrl)
  try {
    await client.send('Runtime.enable')
    await client.send('Page.enable')
    await waitUntil('Home shell controls', () =>
      evaluate(client, `Boolean(document.querySelector('button[aria-label="Settings"]'))`),
    )
    const dashboardCoreCards = await waitUntil('Dashboard Core management', () =>
      evaluate(
        client,
        `(() => {
          const cards = [...document.querySelectorAll('.home-v2-core-card')];
          return cards.length === 2
            ? cards.map((card) => card.getAttribute('data-network'))
            : null;
        })()`,
      ),
    )
    assert.deepEqual(dashboardCoreCards, ['qortium', 'qortal'])
    assert.equal(
      await evaluate(client, `document.querySelector('.home-v2-core-maintenance') === null`),
      true,
    )
    const dashboardScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    writeFileSync(
      coreDashboardScreenshotPath,
      Buffer.from(dashboardScreenshot.data, 'base64'),
    )
    await evaluate(
      client,
      `document.querySelector('button[aria-label="Settings"]').click()`,
    )
    const general = await waitUntil('General settings', () =>
      evaluate(
        client,
        `(() => {
          const heading = document.querySelector('#general-settings-title');
          const select = document.querySelector('select[aria-label="New tab opens"]');
          return heading && select ? {
            heading: heading.textContent,
            options: [...select.options].map((option) => option.textContent),
            value: select.value
          } : null;
        })()`,
      ),
    )
    assert.deepEqual(general, {
      heading: 'General',
      options: ['Search page', 'Dashboard', 'Custom address'],
      value: 'search',
    })

    await evaluate(
      client,
      `([...document.querySelectorAll('.home-v2-settings-nav button')]
        .find((button) => button.textContent.trim() === 'Runtime')).click()`,
    )
    const coreCards = await waitUntil('Core management settings', () =>
      evaluate(
        client,
        `(() => {
          const cards = [...document.querySelectorAll('.home-v2-core-card')];
          return cards.length === 2 ? cards.map((card) => ({
            control: card.getAttribute('data-control'),
            network: card.getAttribute('data-network'),
            runtime: card.getAttribute('data-runtime')
          })) : null;
        })()`,
      ),
    )
    assert.deepEqual(coreCards.map((card) => card.network), ['qortium', 'qortal'])
    const maintenancePanel = await waitUntil('Qortium Core maintenance settings', () =>
      evaluate(
        client,
        `(() => {
          const panel = document.querySelector('.home-v2-core-maintenance');
          const update = document.querySelector('[data-home-v2-app-updates="desktop"]');
          const check = [...(panel?.querySelectorAll('button') ?? [])]
            .find((button) => button.textContent.trim() === 'Check release');
          return panel && update && check && panel.compareDocumentPosition(update) & Node.DOCUMENT_POSITION_FOLLOWING &&
              !panel.querySelector('select') &&
              typeof window.homeV2CoreManagers?.getMaintenanceStatus === 'function' &&
              typeof window.homeV2CoreManagers?.getUpdatePolicy === 'function' &&
              typeof window.homeV2CoreManagers?.setUpdatePolicy === 'function'
            ? { heading: panel.querySelector('h3')?.textContent, text: panel.textContent }
            : null;
        })()`,
      ),
    )
    assert.equal(maintenancePanel.heading, 'Qortium Core maintenance')
    assert.doesNotMatch(maintenancePanel.text, /Qortal.*(?:install|update)|policy|i2pd|transport/i)
    const qortalMaintenancePanel = await waitUntil('Qortal Core maintenance settings', () =>
      evaluate(
        client,
        `(() => {
          const qortium = document.querySelector('.home-v2-core-maintenance:not(.home-v2-qortal-maintenance)');
          const qortal = document.querySelector('.home-v2-qortal-maintenance[data-network="qortal"]');
          const update = document.querySelector('[data-home-v2-app-updates="desktop"]');
          return qortium && qortal && update &&
              qortium.compareDocumentPosition(qortal) & Node.DOCUMENT_POSITION_FOLLOWING &&
              qortal.compareDocumentPosition(update) & Node.DOCUMENT_POSITION_FOLLOWING &&
              typeof window.homeV2CoreManagers?.getQortalMaintenanceStatus === 'function' &&
              typeof window.homeV2CoreManagers?.checkQortalMaintenanceRelease === 'function' &&
              typeof window.homeV2CoreManagers?.runQortalMaintenanceAction === 'function'
            ? {
                heading: qortal.querySelector('h3')?.textContent,
                hasLifecycleAction: [...qortal.querySelectorAll('button')]
                  .some((button) => /^(Start|Stop)/.test(button.textContent.trim())),
                text: qortal.textContent,
              }
            : null;
        })()`,
      ),
    )
    assert.equal(qortalMaintenancePanel.heading, 'Qortal Core maintenance')
    assert.equal(qortalMaintenancePanel.hasLifecycleAction, false)
    assert.match(qortalMaintenancePanel.text, /verified stable Qortal releases/)
    await evaluate(
      client,
      `document.querySelector('.home-v2-qortal-maintenance')
        .scrollIntoView({ block: 'center' })`,
    )
    const qortalMaintenanceScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    writeFileSync(
      qortalMaintenanceScreenshotPath,
      Buffer.from(qortalMaintenanceScreenshot.data, 'base64'),
    )
    const updatePanel = await waitUntil('Home update settings', () =>
      evaluate(
        client,
        `(() => {
          const panel = document.querySelector('[data-home-v2-app-updates="desktop"]');
          const channel = panel?.querySelector('select[aria-label="Release channel"]');
          const policy = panel?.querySelector('select[aria-label="Update policy"]');
          const check = panel?.querySelector('[data-home-v2-update-action="check"]');
          return panel && channel && policy && !policy.disabled && check &&
              typeof window.homeV2AppUpdates?.check === 'function' &&
              typeof window.homeV2AppUpdates?.claimAutomatic === 'function' &&
              typeof window.homeV2AppUpdates?.getSettings === 'function' &&
              typeof window.homeV2AppUpdates?.setSettings === 'function'
            ? { channel: channel.value, check: check.textContent.trim(), policy: policy.value }
            : null;
        })()`,
      ),
    )
    assert.equal(updatePanel.channel, 'stable')
    assert.equal(updatePanel.policy, 'notify')
    assert.equal(['Check for updates', 'Checking'].includes(updatePanel.check), true)
    await evaluate(
      client,
      `(() => {
        const select = document.querySelector('select[aria-label="Update policy"]');
        select.value = 'off';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      })()`,
    )
    const savedUpdateSettings = await waitUntil('persisted Home update policy', () =>
      evaluate(
        client,
        `window.homeV2AppUpdates.getSettings().then((settings) =>
          settings.homeUpdatePolicy === 'off' ? settings : null)`,
      ),
    )
    assert.equal(savedUpdateSettings.releaseChannel, 'stable')
    assert.equal(savedUpdateSettings.generation >= 1, true)
    const updateSettingsPath = path.join(profileDirectory, 'home-v2-app-update-settings.json')
    const storedUpdateSettings = JSON.parse(readFileSync(updateSettingsPath, 'utf8'))
    assert.equal(storedUpdateSettings.schema, 'qortium-home-v2-app-update-settings')
    assert.equal(storedUpdateSettings.version, 1)
    assert.equal(storedUpdateSettings.homeUpdatePolicy, 'off')
    assert.equal(statSync(updateSettingsPath).mode & 0o777, 0o600)
    await client.send('Page.reload', { ignoreCache: true })
    await waitUntil('reloaded Home shell controls', () =>
      evaluate(client, `Boolean(document.querySelector('button[aria-label="Settings"]'))`),
    )
    await evaluate(client, `document.querySelector('button[aria-label="Settings"]').click()`)
    await waitUntil('reloaded Runtime settings navigation', () =>
      evaluate(
        client,
        `(() => {
          const button = [...document.querySelectorAll('.home-v2-settings-nav button')]
            .find((candidate) => candidate.textContent.trim() === 'Runtime');
          if (!button) return false;
          button.click();
          return true;
        })()`,
      ),
    )
    const rehydratedUpdateSettings = await waitUntil('rehydrated Home update policy', () =>
      evaluate(
        client,
        `(() => {
          const policy = document.querySelector('select[aria-label="Update policy"]');
          return policy?.value === 'off'
            ? window.homeV2AppUpdates.getSettings()
            : null;
        })()`,
      ),
    )
    assert.equal(rehydratedUpdateSettings.generation, savedUpdateSettings.generation)
    assert.equal(rehydratedUpdateSettings.homeUpdatePolicy, 'off')
    const coreScreenshot = await client.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(coreScreenshotPath, Buffer.from(coreScreenshot.data, 'base64'))
    writeFileSync(updateScreenshotPath, Buffer.from(coreScreenshot.data, 'base64'))
    await evaluate(
      client,
      `([...document.querySelectorAll('.home-v2-settings-nav button')]
        .find((button) => button.textContent.trim() === 'General')).click()`,
    )

    await evaluate(
      client,
      `(() => {
        const select = document.querySelector('select[aria-label="New tab opens"]');
        select.value = 'dashboard';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      })()`,
    )
    await evaluate(client, `document.querySelector('button[aria-label="New tab"]').click()`)
    await waitUntil('Dashboard new-tab target', () =>
      evaluate(
        client,
        `document.querySelector('input[aria-label="Address and search"]')?.value === 'home://dashboard'`,
      ),
    )

    await evaluate(client, `document.querySelector('button[aria-label="Settings"]').click()`)
    await evaluate(
      client,
      `(() => {
        const select = document.querySelector('select[aria-label="New tab opens"]');
        select.value = 'custom';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      })()`,
    )
    await waitUntil('custom address field', () =>
      evaluate(client, `Boolean(document.querySelector('input[aria-label="Custom new-tab address"]'))`),
    )
    await evaluate(
      client,
      `(() => {
        const input = document.querySelector('input[aria-label="Custom new-tab address"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'home://newtab');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`,
    )
    await evaluate(
      client,
      `document.querySelector('.home-v2-new-tab-custom-address button').click()`,
    )
    await waitUntil('saved custom preference', () =>
      evaluate(
        client,
        `document.querySelector('input[aria-label="Custom new-tab address"]')?.value === 'home://newtab'`,
      ),
    )
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'))

    await evaluate(client, `document.querySelector('button[aria-label="New tab"]').click()`)
    await waitUntil('custom new-tab target', () =>
      evaluate(
        client,
        `document.querySelector('input[aria-label="Address and search"]')?.value === 'home://newtab'`,
      ),
    )
    await delay(600)
    const persisted = JSON.parse(
      readFileSync(path.join(profileDirectory, 'home-v2-shell-state.json'), 'utf8'),
    )
    assert.deepEqual(persisted.newTabPreference, {
      address: 'home://newtab',
      kind: 'custom',
    })

    await evaluate(client, `document.querySelector('button[aria-label="Settings"]').click()`)
    await waitUntil('Appearance settings section', () =>
      evaluate(
        client,
        `(() => {
          const button = [...document.querySelectorAll('.home-v2-settings-nav button')]
            .find((candidate) => candidate.textContent.trim() === 'Appearance');
          if (!button) return false;
          button.click();
          return true;
        })()`,
      ),
    )
    await waitUntil('language selector', () =>
      evaluate(
        client,
        `Boolean([...document.querySelectorAll('select')].find((select) =>
          select.querySelector('option[value="ar"]')))` ,
      ),
    )
    await evaluate(
      client,
      `(() => {
        const select = [...document.querySelectorAll('select')].find((candidate) =>
          candidate.querySelector('option[value="ar"]'));
        select.value = 'ar';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      })()`,
    )
    await waitUntil('Arabic RTL shell', () =>
      evaluate(
        client,
        `(() => {
          const shell = document.querySelector('.home-v2-shell');
          return shell?.getAttribute('dir') === 'rtl' &&
            shell?.getAttribute('lang') === 'ar' &&
            document.querySelector('.home-v2-page-heading h1')?.textContent === 'الإعدادات';
        })()`,
      ),
    )
    const rtlScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    writeFileSync(rtlScreenshotPath, Buffer.from(rtlScreenshot.data, 'base64'))
    await delay(600)
    const rtlPersisted = JSON.parse(
      readFileSync(path.join(profileDirectory, 'home-v2-shell-state.json'), 'utf8'),
    )
    assert.equal(rtlPersisted.appearance.language, 'ar')
    console.log(
      `Packaged Home settings/Core/updater/new-tab/i18n smoke passed; screenshots: ${coreDashboardScreenshotPath}, ${screenshotPath}, ${coreScreenshotPath}, ${qortalMaintenanceScreenshotPath}, ${updateScreenshotPath}, ${rtlScreenshotPath}`,
    )
  } finally {
    client.close()
  }
} catch (error) {
  const output = appProcess?.output.join('').trim()
  if (output) console.error(output)
  throw error
} finally {
  await appProcess?.stop()
  rmSync(profileDirectory, { force: true, recursive: true })
}
