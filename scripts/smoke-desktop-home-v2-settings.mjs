#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
const pinnedAppsScreenshotPath = path.resolve(
  process.env.QORTIUM_HOME_PINNED_APPS_SCREENSHOT?.trim() ||
    '/tmp/qortium-home-2.1-pinned-apps.png',
)
const qortalMaintenanceScreenshotPath = path.resolve(
  process.env.QORTIUM_HOME_QORTAL_MAINTENANCE_SCREENSHOT?.trim() ||
    '/tmp/qortium-home-2.1-qortal-maintenance.png',
)
const qdnAppsScreenshotPath = path.resolve(
  process.env.QORTIUM_HOME_QDN_APPS_SETTINGS_SCREENSHOT?.trim() ||
    '/tmp/qortium-home-2.1-qdn-apps-settings.png',
)
const profileDirectory = mkdtempSync(
  path.join(os.tmpdir(), 'qortium-home-v2-settings-smoke-'),
)
const notificationAppKey = 'qdn://APP/Notify/Notify'
const notificationAccountSecret = 'Q_SMOKE_ACCOUNT_DO_NOT_RENDER'
const notificationXpubSecret = 'xpub-smoke-secret-do-not-render'
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
  writeFileSync(
    path.join(profileDirectory, 'qdn-app-roles.json'),
    `${JSON.stringify({
      assignments: {
        bookmarks: {
          description: 'App used when Home opens bookmarks.',
          label: 'Bookmarks',
          url: 'qdn://APP/Bookmarks/Bookmarks',
        },
        notifications: {
          description: 'App used to manage Home notifications.',
          label: 'Notifications',
          url: notificationAppKey,
        },
        explore: {
          description: 'App used when Home opens QDN Explore.',
          label: 'Explore',
          url: 'qdn://APP/Explore/Explore',
        },
        'media.video-player': {
          description: 'Video player fixture.',
          label: 'Video player',
          url: 'qdn://APP/Video/Video',
        },
        'media.audio-player': {
          description: 'Audio player fixture.',
          label: 'Audio player',
          url: 'qdn://APP/Audio/Audio',
        },
      },
      capabilityGrants: {
        'qdn://APP/CapabilitySecret/CapabilitySecret': {
          'assignments.read': { grantedAt: '2026-08-22T12:00:00.000Z' },
        },
      },
      legacyMigrated: true,
      revision: 5,
      version: 2,
    }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  writeFileSync(
    path.join(profileDirectory, 'notification-store.json'),
    `${JSON.stringify({
      grants: {
        [notificationAppKey]: {
          grantedAt: '2026-08-22T12:00:00.000Z',
        },
      },
      revision: 7,
      rules: {
        [notificationAppKey]: [{
          accountAddress: notificationAccountSecret,
          createdAt: '2026-08-22T12:01:00.000Z',
          event: 'FOREIGN_PAYMENT_RECEIVED',
          filters: { coin: 'BTC', xpub: notificationXpubSecret },
          notificationId: 'foreign-payment-smoke',
          text: 'FILTER_TEXT_SECRET_DO_NOT_RENDER',
          title: 'FILTER_TITLE_SECRET_DO_NOT_RENDER',
        }],
      },
      version: 1,
    }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  const corePolicyDirectory = path.join(profileDirectory, 'home-v2-core-maintenance')
  const corePolicyPath = path.join(corePolicyDirectory, 'update-policy.json')
  mkdirSync(corePolicyDirectory, { mode: 0o700 })
  writeFileSync(corePolicyPath, `${JSON.stringify({
    coreUpdatePolicy: 'off',
    generation: 4,
    javaUpdatePolicy: 'notify',
    schema: 'qortium-home-v2-core-update-policy',
    version: 1,
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
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
    await waitUntil('initial Home shell state persistence', () =>
      existsSync(path.join(profileDirectory, 'home-v2-shell-state.json')),
    )
    const initialDestination = await waitUntil('Welcome or Dashboard', () =>
      evaluate(
        client,
        `document.querySelector('.home-v2-dashboard')
          ? 'dashboard'
          : [...document.querySelectorAll('.home-v2-welcome button')]
              .some((button) => button.textContent.trim() === 'Skip setup')
            ? 'welcome'
            : null`,
      ),
    )
    if (initialDestination === 'welcome') {
      await evaluate(
        client,
        `([...document.querySelectorAll('.home-v2-welcome button')]
          .find((button) => button.textContent.trim() === 'Skip setup')).click()`,
      )
    }
    await waitUntil('Dashboard after optional Welcome setup', () =>
      evaluate(client, `Boolean(document.querySelector('.home-v2-dashboard'))`),
    )
    const freshDesktopAppearance = await evaluate(
      client,
      `(() => {
        const shell = document.querySelector('.home-v2-shell');
        const viewport = document.querySelector('.home-v2-page-viewport');
        return {
          preference: shell?.getAttribute('data-theme-preference'),
          resolved: shell?.getAttribute('data-theme'),
          documentWidth: document.documentElement.clientWidth,
          viewportWidth: viewport?.getBoundingClientRect().width ?? 0,
        };
      })()`,
    )
    assert.equal(freshDesktopAppearance.preference, 'dark')
    assert.equal(freshDesktopAppearance.resolved, 'dark')
    assert.equal(
      Math.abs(freshDesktopAppearance.viewportWidth - (freshDesktopAppearance.documentWidth - 36)) < 1,
      true,
      `Desktop viewport did not use the available width: ${JSON.stringify(freshDesktopAppearance)}`,
    )
    const dashboardCoreCards = await waitUntil('Dashboard Core management', () =>
      evaluate(
        client,
        `(() => {
          const cards = [...document.querySelectorAll('.home-v2-core-card')];
          return cards.length === 1
            ? cards.map((card) => card.getAttribute('data-network'))
            : null;
        })()`,
      ),
    )
    assert.deepEqual(dashboardCoreCards, ['qortium'])
    await waitUntil('compact default pinned apps', () =>
      evaluate(
        client,
        `document.querySelectorAll('.home-v2-pinned-apps__card').length === 2`,
      ),
    )
    const qortiumOnlyLayout = await evaluate(
      client,
      `(() => {
        const measure = (selector, cardSelector) => {
          const grid = document.querySelector(selector);
          const cards = [...(grid?.querySelectorAll(cardSelector) ?? [])];
          return {
            cardWidths: cards.map((card) => card.getBoundingClientRect().width),
            gridWidth: grid?.getBoundingClientRect().width ?? 0,
          };
        };
        return {
          // Connections and Core management are one "Node & Core" section, so
          // the dashboard has a single grid of combined cards to measure.
          nodes: measure('.home-v2-node-core-grid', '.home-v2-node-core-card'),
          pinned: [...document.querySelectorAll('.home-v2-pinned-apps__card')]
            .map((card) => card.getBoundingClientRect().width),
          pinnedText: document.querySelector('.home-v2-pinned-apps')?.textContent ?? '',
          permanentPinActions: Boolean(document.querySelector('.home-v2-pinned-apps__actions')),
        };
      })()`,
    )
    for (const [name, measurement] of Object.entries({
      nodes: qortiumOnlyLayout.nodes,
    })) {
      assert.equal(measurement.cardWidths.length, 1)
      assert.equal(
        Math.abs(measurement.cardWidths[0] - measurement.gridWidth) < 1,
        true,
        `Qortium-only ${name} card did not fill its row: ${JSON.stringify(measurement)}`,
      )
    }
    assert.equal(qortiumOnlyLayout.pinned.length, 2)
    assert.equal(qortiumOnlyLayout.pinned.every((width) => width <= 80), true)
    assert.equal(qortiumOnlyLayout.pinnedText.includes('qdn://'), false)
    assert.equal(qortiumOnlyLayout.permanentPinActions, false)
    await evaluate(
      client,
      `document.querySelector('.home-v2-pinned-apps')?.scrollIntoView({ block: 'center' })`,
    )
    await delay(100)
    const pinnedAppsScreenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
    })
    writeFileSync(
      pinnedAppsScreenshotPath,
      Buffer.from(pinnedAppsScreenshot.data, 'base64'),
    )
    await evaluate(client, `window.scrollTo(0, 0)`)
    const dashboardMaintenance = await evaluate(
      client,
      `(() => [...document.querySelectorAll('.home-v2-core-maintenance')].map((maintenance) => ({
        rects: maintenance.getClientRects().length,
        settingsHidden: maintenance.closest('.home-v2-settings')?.getAttribute('hidden') ?? null,
        settingsSection: maintenance.closest('section')?.getAttribute('aria-labelledby') ?? null,
      })))()`,
    )
    assert.equal(
      dashboardMaintenance.every((maintenance) => maintenance.rects === 0),
      true,
      `Dashboard exposed Settings-only maintenance: ${JSON.stringify(dashboardMaintenance)}`,
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
      `document.querySelector('button[aria-label="Settings: Core management"]').click()`,
    )
    await waitUntil('targeted Runtime settings', () =>
      evaluate(
        client,
        `(() => {
          const runtime = [...document.querySelectorAll('.home-v2-settings-nav button')]
            .find((button) => button.textContent.trim() === 'Runtime');
          return runtime?.getAttribute('aria-current') === 'page' &&
            Boolean(document.querySelector('#core-settings-title'));
        })()`,
      ),
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
    const initialNetworkSettings = await evaluate(
      client,
      `(() => ({
        qortal: document.querySelector('input[aria-label="Qortal connection mode"]')?.checked,
        qortium: document.querySelector('input[aria-label="Qortium connection mode"]')?.checked,
      }))()`,
    )
    assert.deepEqual(initialNetworkSettings, { qortal: false, qortium: true })
    await evaluate(
      client,
      `document.querySelector('input[aria-label="Qortal connection mode"]').click()`,
    )
    await waitUntil('enabled Qortal network', () =>
      evaluate(
        client,
        `document.querySelector('input[aria-label="Qortal connection mode"]')?.checked === true`,
      ),
    )
    assert.deepEqual(
      JSON.parse(
        readFileSync(path.join(profileDirectory, 'qortal-node-settings.json'), 'utf8'),
      ),
      { customUrl: '', lastEnabledMode: 'local', mode: 'local' },
    )
    await evaluate(client, `document.querySelector('button[aria-label="Dashboard"]').click()`)
    await waitUntil('Qortal dashboard tiles after enable', () =>
      evaluate(
        client,
        `(() => {
          const cards = [...document.querySelectorAll('.home-v2-core-card')];
          return cards.length === 2 &&
            cards.some((card) => card.getAttribute('data-network') === 'qortal');
        })()`,
      ),
    )
    const dualNetworkLayout = await evaluate(
      client,
      `(() => {
        const grid = document.querySelector('.home-v2-node-core-grid');
        return {
          cardWidths: [...(grid?.querySelectorAll('.home-v2-node-core-card') ?? [])]
            .map((card) => card.getBoundingClientRect().width),
          gridWidth: grid?.getBoundingClientRect().width ?? 0,
        };
      })()`,
    )
    assert.equal(dualNetworkLayout.cardWidths.length, 2)
    assert.equal(
      Math.abs(dualNetworkLayout.cardWidths[0] - dualNetworkLayout.cardWidths[1]) < 1,
      true,
      `Dual-network cards did not share their row: ${JSON.stringify(dualNetworkLayout)}`,
    )
    await evaluate(client, `document.querySelector('button[aria-label="Settings"]').click()`)
    await waitUntil('General settings after dual-network layout check', () =>
      evaluate(client, `Boolean(document.querySelector('input[aria-label="Qortium connection mode"]'))`),
    )
    await evaluate(
      client,
      `document.querySelector('input[aria-label="Qortium connection mode"]').click()`,
    )
    await waitUntil('disabled Qortium network', () =>
      evaluate(
        client,
        `document.querySelector('input[aria-label="Qortium connection mode"]')?.checked === false`,
      ),
    )
    await evaluate(client, `document.querySelector('button[aria-label="Dashboard"]').click()`)
    const qortalOnlyLayout = await waitUntil('Qortal-only Dashboard layout', () =>
      evaluate(
        client,
        `(() => {
          const grid = document.querySelector('.home-v2-node-core-grid');
          const cards = [...(grid?.querySelectorAll('.home-v2-node-core-card') ?? [])];
          if (cards.length !== 1 || cards[0].getAttribute('data-network') !== 'qortal') return null;
          return {
            cardWidth: cards[0].getBoundingClientRect().width,
            gridWidth: grid.getBoundingClientRect().width,
          };
        })()`,
      ),
    )
    assert.equal(
      Math.abs(qortalOnlyLayout.cardWidth - qortalOnlyLayout.gridWidth) < 1,
      true,
      `Qortal-only card did not fill its row: ${JSON.stringify(qortalOnlyLayout)}`,
    )
    await evaluate(client, `document.querySelector('button[aria-label="Settings"]').click()`)
    await waitUntil('General settings after Qortal-only layout check', () =>
      evaluate(client, `Boolean(document.querySelector('input[aria-label="Qortium connection mode"]'))`),
    )
    await evaluate(
      client,
      `document.querySelector('input[aria-label="Qortium connection mode"]').click()`,
    )
    await waitUntil('restored Qortium network', () =>
      evaluate(
        client,
        `document.querySelector('input[aria-label="Qortium connection mode"]')?.checked === true`,
      ),
    )

    const initialNotificationPolicy = await waitUntil('Home 2 notification policy', () =>
      evaluate(
        client,
        `(() => {
          const toggle = document.querySelector('input[aria-label="App notifications"]');
          return toggle && typeof window.homeV2NotificationPolicy?.get === 'function' &&
              typeof window.homeV2NotificationPolicy?.set === 'function' &&
              typeof window.homeV2NotificationPolicy?.subscribe === 'function'
            ? window.homeV2NotificationPolicy.get().then((policy) => ({
                checked: toggle.checked,
                policy,
              }))
            : null;
        })()`,
      ),
    )
    assert.equal(initialNotificationPolicy.checked, true)
    assert.deepEqual(initialNotificationPolicy.policy, {
      enabled: true,
      generation: 0,
      schema: 'qortium-home-v2-notification-policy',
      status: 'available',
      version: 1,
    })
    await evaluate(
      client,
      `document.querySelector('input[aria-label="App notifications"]').click()`,
    )
    const disabledNotificationPolicy = await waitUntil('persisted disabled notification policy', () =>
      evaluate(
        client,
        `window.homeV2NotificationPolicy.get().then((policy) =>
          policy.enabled === false && policy.generation === 1 ? policy : null)`,
      ),
    )
    assert.equal(disabledNotificationPolicy.status, 'available')
    const notificationPolicyPath = path.join(
      profileDirectory,
      'home-v2-notification-policy.json',
    )
    assert.deepEqual(JSON.parse(readFileSync(notificationPolicyPath, 'utf8')), {
      enabled: false,
      generation: 1,
      schema: 'qortium-home-v2-notification-policy',
      version: 1,
    })
    assert.equal(statSync(notificationPolicyPath).mode & 0o777, 0o600)
    const preservedNotificationStore = JSON.parse(
      readFileSync(path.join(profileDirectory, 'notification-store.json'), 'utf8'),
    )
    assert.equal(preservedNotificationStore.revision, 7)
    assert.equal(Boolean(preservedNotificationStore.grants[notificationAppKey]), true)
    assert.equal(preservedNotificationStore.rules[notificationAppKey]?.length, 1)

    await client.send('Page.reload', { ignoreCache: true })
    await waitUntil('reloaded Home shell after notification policy change', () =>
      evaluate(client, `Boolean(document.querySelector('button[aria-label="Settings"]'))`),
    )
    await evaluate(client, `document.querySelector('button[aria-label="Settings"]').click()`)
    await waitUntil('rehydrated disabled notification policy', () =>
      evaluate(
        client,
        `(() => {
          const toggle = document.querySelector('input[aria-label="App notifications"]');
          return toggle?.checked === false &&
            toggle.closest('[data-home-v2-notification-policy]')
              ?.getAttribute('data-home-v2-notification-policy') === 'available';
        })()`,
      ),
    )

    await evaluate(
      client,
      `([...document.querySelectorAll('.home-v2-settings-nav button')]
        .find((button) => button.textContent.trim() === 'QDN Apps')).click()`,
    )
    const qdnSettings = await waitUntil('QDN app settings', () =>
      evaluate(
        client,
        `(() => {
          const panel = document.querySelector('[data-home-v2-qdn-settings="ready"]');
          const roles = [...(panel?.querySelectorAll('[data-qdn-assignment-role]') ?? [])]
            .map((row) => row.getAttribute('data-qdn-assignment-role'));
          const grant = panel?.querySelector('[data-qdn-notification-grant=${JSON.stringify(notificationAppKey)}]');
          const mute = grant?.querySelector('input[type="checkbox"]');
          const warning = grant?.querySelector('[data-qdn-foreign-payment-warning="true"]');
          return panel && roles.length === 5 && grant && mute && warning
            ? { html: panel.outerHTML, muted: mute.checked, roles }
            : null;
        })()`,
      ),
    )
    assert.deepEqual(qdnSettings.roles, [
      'bookmarks',
      'notifications',
      'explore',
      'media.audio-player',
      'media.video-player',
    ])
    assert.equal(qdnSettings.muted, false)
    for (const secret of [
      'CapabilitySecret',
      notificationAccountSecret,
      notificationXpubSecret,
      'FILTER_TEXT_SECRET_DO_NOT_RENDER',
      'FILTER_TITLE_SECRET_DO_NOT_RENDER',
      'foreign-payment-smoke',
    ]) {
      assert.equal(qdnSettings.html.includes(secret), false, `QDN settings rendered secret: ${secret}`)
    }

    await evaluate(
      client,
      `document.querySelector('[data-qdn-notification-grant=${JSON.stringify(notificationAppKey)}] input[type="checkbox"]').click()`,
    )
    await waitUntil('persisted muted notification grant', () => {
      const store = JSON.parse(
        readFileSync(path.join(profileDirectory, 'notification-store.json'), 'utf8'),
      )
      return store.revision === 8 &&
        store.grants[notificationAppKey]?.muted === true &&
        store.rules[notificationAppKey]?.length === 1
    })
    const mutedWarningVisible = await waitUntil('muted foreign-payment warning', () =>
      evaluate(
        client,
        `(() => {
          const grant = document.querySelector('[data-qdn-notification-grant=${JSON.stringify(notificationAppKey)}]');
          return grant?.querySelector('input[type="checkbox"]')?.checked === true &&
            Boolean(grant.querySelector('[data-qdn-foreign-payment-warning="true"]'));
        })()`,
      ),
    )
    assert.equal(mutedWarningVisible, true)

    await client.send('Page.reload', { ignoreCache: true })
    await waitUntil('reloaded Home shell controls after notification mute', () =>
      evaluate(client, `Boolean(document.querySelector('button[aria-label="Settings"]'))`),
    )
    await evaluate(client, `document.querySelector('button[aria-label="Settings"]').click()`)
    await waitUntil('reloaded QDN app settings navigation', () =>
      evaluate(
        client,
        `(() => {
          const button = [...document.querySelectorAll('.home-v2-settings-nav button')]
            .find((candidate) => candidate.textContent.trim() === 'QDN Apps');
          if (!button) return false;
          button.click();
          return true;
        })()`,
      ),
    )
    await waitUntil('rehydrated muted notification grant', () =>
      evaluate(
        client,
        `(() => {
          const grant = document.querySelector('[data-qdn-notification-grant=${JSON.stringify(notificationAppKey)}]');
          return grant?.querySelector('input[type="checkbox"]')?.checked === true &&
            Boolean(grant.querySelector('[data-qdn-foreign-payment-warning="true"]'));
        })()`,
      ),
    )
    await evaluate(
      client,
      `document.querySelector('[data-qdn-notification-grant=${JSON.stringify(notificationAppKey)}]')
        .scrollIntoView({ block: 'center' })`,
    )
    const qdnAppsScreenshot = await client.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(qdnAppsScreenshotPath, Buffer.from(qdnAppsScreenshot.data, 'base64'))

    await evaluate(
      client,
      `(() => {
        const grant = document.querySelector('[data-qdn-notification-grant=${JSON.stringify(notificationAppKey)}]');
        [...grant.querySelectorAll('button')]
          .find((button) => button.textContent.trim() === 'Revoke').click();
      })()`,
    )
    await waitUntil('notification revoke confirmation', () =>
      evaluate(client, `Boolean(document.querySelector('[data-qdn-revoke-confirm="true"]'))`),
    )
    await evaluate(
      client,
      `(() => {
        const confirmation = document.querySelector('[data-qdn-revoke-confirm="true"]');
        [...confirmation.querySelectorAll('button')]
          .find((button) => button.textContent.trim() === 'Revoke').click();
      })()`,
    )
    await waitUntil('revoked notification grant and rules', () => {
      const store = JSON.parse(
        readFileSync(path.join(profileDirectory, 'notification-store.json'), 'utf8'),
      )
      return store.revision === 9 &&
        !Object.hasOwn(store.grants, notificationAppKey) &&
        !Object.hasOwn(store.rules, notificationAppKey)
    })
    await waitUntil('empty notification grants UI after revoke', () =>
      evaluate(client, `Boolean(document.querySelector('[data-qdn-notification-empty="true"]'))`),
    )

    await evaluate(
      client,
      `([...document.querySelectorAll('.home-v2-settings-nav button')]
        .find((button) => button.textContent.trim() === 'General')).click()`,
    )
    await evaluate(
      client,
      `document.querySelector('input[aria-label="Qortium connection mode"]').click()`,
    )
    await waitUntil('disabled Qortium network settings', () =>
      evaluate(
        client,
        `(() => {
          const qdnApps = [...document.querySelectorAll('.home-v2-settings-nav button')]
            .some((button) => button.textContent.trim() === 'QDN Apps');
          return document.querySelector('input[aria-label="Qortium connection mode"]')?.checked === false &&
            !qdnApps;
        })()`,
      ),
    )
    const disabledQortiumSettings = JSON.parse(
      readFileSync(path.join(profileDirectory, 'node-settings.json'), 'utf8'),
    )
    assert.equal(disabledQortiumSettings.customUrl, '')
    assert.equal(disabledQortiumSettings.lastEnabledMode, 'local')
    assert.equal(disabledQortiumSettings.mode, 'disabled')
    assert.match(disabledQortiumSettings.apiKey, /^[A-Za-z0-9_-]+$/)
    await evaluate(
      client,
      `([...document.querySelectorAll('.home-v2-settings-nav button')]
        .find((button) => button.textContent.trim() === 'Runtime')).click()`,
    )
    const qortalOnlyRuntime = await waitUntil('Qortal-only Runtime settings', () =>
      evaluate(
        client,
        `(() => {
          const cards = [...document.querySelectorAll('.home-v2-core-card')]
            .map((card) => card.getAttribute('data-network'));
          return cards.length === 1 && cards[0] === 'qortal' &&
            !document.querySelector('.home-v2-transport-maintenance') &&
            Boolean(document.querySelector('.home-v2-qortal-maintenance'));
        })()`,
      ),
    )
    assert.equal(qortalOnlyRuntime, true)
    await evaluate(
      client,
      `([...document.querySelectorAll('.home-v2-settings-nav button')]
        .find((button) => button.textContent.trim() === 'General')).click()`,
    )
    await evaluate(
      client,
      `document.querySelector('input[aria-label="Qortium connection mode"]').click()`,
    )
    await waitUntil('restored Qortium network mode', () =>
      evaluate(
        client,
        `document.querySelector('input[aria-label="Qortium connection mode"]')?.checked === true`,
      ),
    )
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(profileDirectory, 'node-settings.json'), 'utf8')),
      { ...disabledQortiumSettings, mode: 'local' },
    )
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
          const qortalPolicy = panel?.querySelector('[data-home-v2-qortal-update-policy]');
          return panel && update && check && qortalPolicy &&
              panel.compareDocumentPosition(update) & Node.DOCUMENT_POSITION_FOLLOWING &&
              panel.querySelectorAll('select').length === 1 &&
              typeof window.homeV2CoreManagers?.getMaintenanceStatus === 'function' &&
              typeof window.homeV2CoreManagers?.getUpdatePolicy === 'function' &&
              typeof window.homeV2CoreManagers?.setUpdatePolicy === 'function'
            ? window.homeV2CoreManagers.getUpdatePolicy().then((policy) => ({
                heading: panel.querySelector('h3')?.textContent,
                policy,
                qortalPolicy: qortalPolicy.value,
                text: panel.textContent,
              }))
            : null;
        })()`,
      ),
    )
    assert.equal(maintenancePanel.heading, 'Qortium Core maintenance')
    assert.equal(maintenancePanel.qortalPolicy, 'notify')
    assert.equal(maintenancePanel.policy.coreUpdatePolicy, 'off')
    assert.equal(maintenancePanel.policy.generation, 4)
    assert.equal(maintenancePanel.policy.javaUpdatePolicy, 'notify')
    assert.equal(maintenancePanel.policy.qortalUpdatePolicy, 'notify')
    assert.match(maintenancePanel.text, /Qortal Core updates/)
    assert.doesNotMatch(maintenancePanel.text, /i2pd|transport/i)
    assert.deepEqual(JSON.parse(readFileSync(corePolicyPath, 'utf8')), {
      coreUpdatePolicy: 'off',
      generation: 4,
      javaUpdatePolicy: 'notify',
      qortalUpdatePolicy: 'notify',
      schema: 'qortium-home-v2-core-update-policy',
      version: 2,
    })
    assert.equal(statSync(corePolicyPath).mode & 0o777, 0o600)
    await evaluate(
      client,
      `(() => {
        const policy = document.querySelector('[data-home-v2-qortal-update-policy]');
        policy.value = 'off';
        policy.dispatchEvent(new Event('change', { bubbles: true }));
      })()`,
    )
    await waitUntil('persisted Qortal update policy', () => {
      const stored = JSON.parse(readFileSync(corePolicyPath, 'utf8'))
      return stored.generation === 5 && stored.qortalUpdatePolicy === 'off'
    })
    const transportMaintenancePanel = await waitUntil('Qortium transport maintenance settings', () =>
      evaluate(
        client,
        `(() => {
          const qortium = document.querySelector('.home-v2-core-maintenance:not(.home-v2-transport-maintenance):not(.home-v2-qortal-maintenance)');
          const transport = document.querySelector('[data-home-v2-transport-maintenance="desktop"]');
          const qortal = document.querySelector('.home-v2-qortal-maintenance[data-network="qortal"]');
          return qortium && transport && qortal &&
              qortium.compareDocumentPosition(transport) & Node.DOCUMENT_POSITION_FOLLOWING &&
              transport.compareDocumentPosition(qortal) & Node.DOCUMENT_POSITION_FOLLOWING &&
              typeof window.homeV2CoreManagers?.getTransportMaintenanceStatus === 'function' &&
              typeof window.homeV2CoreManagers?.runTransportMaintenanceAction === 'function'
            ? { heading: transport.querySelector('h3')?.textContent, text: transport.textContent }
            : null;
        })()`,
      ),
    )
    assert.equal(transportMaintenancePanel.heading, 'Qortium transport and I2P')
    assert.match(transportMaintenancePanel.text, /Install Qortium Core/)
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
      `Packaged Home settings/QDN apps/Core/updater/new-tab/i18n smoke passed; screenshots: ${coreDashboardScreenshotPath}, ${pinnedAppsScreenshotPath}, ${qdnAppsScreenshotPath}, ${screenshotPath}, ${coreScreenshotPath}, ${qortalMaintenanceScreenshotPath}, ${updateScreenshotPath}, ${rtlScreenshotPath}`,
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
