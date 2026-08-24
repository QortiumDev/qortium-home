#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createManagedProcess } from './lib/managed-process.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const appImage = path.resolve(
  process.env.QORTIUM_HOME_APPIMAGE?.trim() ||
    path.join(repoRoot, 'dist-release', `Qortium-Home-${packageJson.version}-x86_64.AppImage`),
)
const profileDirectory = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-collections-smoke-'))
const freshProfileDirectory = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-fresh-pins-smoke-'))
const seedMain = path.join(profileDirectory, 'seed.cjs')
const seedPage = path.join(profileDirectory, 'legacy-index.html')
const electronBinary = path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron')
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
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
    })
  })
}

async function waitUntil(label, action) {
  const startedAt = Date.now()
  let lastError = null
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await action()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }
  throw new Error(`${label} timed out${lastError instanceof Error ? `: ${lastError.message}` : ''}`)
}

class CdpClient {
  constructor(url) {
    this.nextId = 1
    this.pending = new Map()
    this.socket = new WebSocket(url)
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

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      awaitPromise: true,
      expression,
      returnByValue: true,
    })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text ?? 'CDP evaluation failed.')
    return response.result?.value
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

try {
  assert.equal(existsSync(appImage), true, `AppImage not found: ${appImage}`)
  writeFileSync(seedPage, '<!doctype html><title>Qortium Home v1 storage fixture</title>')
  writeFileSync(seedMain, `
    const { app, BrowserWindow } = require('electron');
    const path = require('node:path');
    app.setPath('userData', process.env.QORTIUM_HOME_USER_DATA_DIR);
    app.whenReady().then(async () => {
      const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false } });
      await win.loadFile(${JSON.stringify(seedPage)});
      await win.webContents.executeJavaScript(${JSON.stringify(`
        localStorage.setItem('qortium-home-bookmarks', JSON.stringify({
          bookmarks: [{ accountId: 'account-1', createdAt: 1,
            displayUrl: 'qdn://APP/Boards/Boards', id: 'boards', title: 'Boards', type: 'bookmark' }],
          toolbar: [], toolbarVisibility: 'always', version: 3
        }));
        localStorage.setItem('qortium-home-dashboard-pins', JSON.stringify([{
          createdAt: 2, displayUrl: 'qdn://APP/Help/Help', id: 'qdn://APP/Help/Help', label: 'Help'
        }]));
        localStorage.setItem('qortium-home-start-pages', JSON.stringify([{
          accountId: null, displayUrl: 'qdn://APP/Polls/Polls', title: 'Polls'
        }]));
        localStorage.setItem('qortium-home-bookmark-manager-revision', '11');
      `)});
      app.quit();
    }).catch((error) => { console.error(error); app.exit(1); });
  `)
  const useXvfb = !process.env.DISPLAY && existsSync('/usr/bin/xvfb-run')
  const seedEnvironment = {
    ...process.env,
    QORTIUM_HOME_USER_DATA_DIR: profileDirectory,
  }
  delete seedEnvironment.ELECTRON_RUN_AS_NODE
  const seeded = spawnSync(
    useXvfb ? '/usr/bin/xvfb-run' : electronBinary,
    useXvfb ? ['-a', electronBinary, seedMain] : [seedMain],
    { cwd: repoRoot, env: seedEnvironment, encoding: 'utf8', timeout: 30_000 },
  )
  assert.equal(seeded.status, 0, seeded.stderr || seeded.stdout || 'Legacy storage seeding failed.')
  writeFileSync(
    path.join(profileDirectory, 'home-v2-shell-state.json'),
    JSON.stringify({
      version: 3,
      appearance: {
        accent: 'clay',
        appZoom: 1,
        language: 'system',
        textSize: 'medium',
        theme: 'system',
      },
      newTabPreference: { kind: 'search' },
      onboarding: { currentStep: 'finish', status: 'skipped', version: 1 },
      selectedAccountId: null,
      selectedAddressId: null,
      product: { activeTabId: null, destination: 'dashboard', tabs: [] },
    }),
    { mode: 0o600 },
  )

  const port = await getFreePort()
  appProcess = createManagedProcess(
    useXvfb ? '/usr/bin/xvfb-run' : appImage,
    useXvfb ? ['-a', appImage, `--remote-debugging-port=${port}`] : [`--remote-debugging-port=${port}`],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        QORTIUM_HOME_USER_DATA_DIR: profileDirectory,
        XDG_CONFIG_HOME: path.join(profileDirectory, 'config'),
      },
    },
  )
  const target = await waitUntil('packaged Home 2 page', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`)
    if (!response.ok) return null
    const targets = await response.json()
    return targets.find((entry) => entry.type === 'page' && entry.url?.includes('/v2-live.html')) ?? null
  })
  const client = new CdpClient(target.webSocketDebuggerUrl)
  try {
    const snapshot = await waitUntil('migrated Home 2 collections snapshot', async () => {
      const value = await client.evaluate(`localStorage.getItem('qortium-home-bookmark-manager-snapshot')`)
      return value ? JSON.parse(value) : null
    })
    assert.equal(snapshot.revision, 11)
    assert.equal(snapshot.toolbarVisibility, 'always')
    assert.equal(snapshot.bookmarks[0]?.displayUrl, 'qdn://APP/Boards/Boards')
    assert.equal(snapshot.dashboardPins[0]?.displayUrl, 'qdn://APP/Help/Help')
    assert.equal(snapshot.dashboardPins.length, 1, 'migration must not inject fresh-profile defaults')
    assert.equal(snapshot.startPages[0]?.displayUrl, 'qdn://APP/Polls/Polls')

    await waitUntil('migrated pin rendered on Dashboard', () =>
      client.evaluate(`!!document.querySelector('[aria-label="Open Help"]')`))
    assert.equal(await client.evaluate(`!!document.querySelector('[aria-label="Open Chat"]')`), false)

    await client.evaluate(`(() => {
      const create = document.querySelector('[aria-label="Create Pinned apps"]');
      if (!(create instanceof HTMLButtonElement)) throw new Error('Create pin button is missing.');
      create.click();
    })()`)
    await waitUntil('add pin form', () =>
      client.evaluate(`document.querySelectorAll('.home-v2-pinned-apps__form input').length === 2`))
    await client.evaluate(`(() => {
      const form = document.querySelector('.home-v2-pinned-apps__form');
      const inputs = form ? [...form.querySelectorAll('input')] : [];
      if (!(form instanceof HTMLFormElement) || inputs.length !== 2) throw new Error('Add pin form is missing.');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(inputs[0], 'qdn://APP/Trust/Trust');
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(inputs[1], 'My Trust');
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      form.requestSubmit();
    })()`)
    const afterAdd = await waitUntil('added and titled Dashboard pin', async () => {
      const raw = await client.evaluate(`localStorage.getItem('qortium-home-bookmark-manager-snapshot')`)
      const current = raw ? JSON.parse(raw) : null
      const trust = current?.dashboardPins?.find((pin) => pin.displayUrl === 'qdn://APP/Trust/Trust')
      return trust?.customLabel === 'My Trust' ? current : null
    })
    assert.deepEqual(afterAdd.dashboardPins.map((pin) => pin.displayUrl), [
      'qdn://APP/Help/Help',
      'qdn://APP/Trust/Trust',
    ])

    await waitUntil('custom pin label rendered', () =>
      client.evaluate(`!!document.querySelector('[aria-label="Open My Trust"]')`))
    await client.evaluate(`(() => {
      const open = document.querySelector('[aria-label="Open My Trust"]');
      if (!(open instanceof HTMLButtonElement)) throw new Error('Pinned app button is missing.');
      open.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, button: 2, cancelable: true, clientX: 160, clientY: 160,
      }));
    })()`)
    await waitUntil('rename control rendered in pin menu', () =>
      client.evaluate(`!!document.querySelector('[aria-label="Rename My Trust"]')`))
    await client.evaluate(`(() => {
      const rename = document.querySelector('[aria-label="Rename My Trust"]');
      if (!(rename instanceof HTMLButtonElement)) throw new Error('Rename pin button is missing.');
      rename.click();
    })()`)
    await waitUntil('rename pin form', () =>
      client.evaluate(`!!document.querySelector('.home-v2-pinned-apps__rename input')`))
    await client.evaluate(`(() => {
      const form = document.querySelector('.home-v2-pinned-apps__rename');
      const input = form?.querySelector('input');
      if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLInputElement)) {
        throw new Error('Rename pin form is missing.');
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'Pinned Trust');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.requestSubmit();
    })()`)
    await waitUntil('renamed Dashboard pin', async () => {
      const raw = await client.evaluate(`localStorage.getItem('qortium-home-bookmark-manager-snapshot')`)
      const current = raw ? JSON.parse(raw) : null
      return current?.dashboardPins?.some((pin) => pin.customLabel === 'Pinned Trust') ? current : null
    })

    await client.evaluate(`(() => {
      const open = document.querySelector('[aria-label="Open Pinned Trust"]');
      if (!(open instanceof HTMLButtonElement)) throw new Error('Renamed pin button is missing.');
      open.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, button: 2, cancelable: true, clientX: 160, clientY: 160,
      }));
    })()`)
    await waitUntil('move control rendered in pin menu', () =>
      client.evaluate(`!!document.querySelector('[aria-label="Back: Pinned Trust"]')`))
    await client.evaluate(`document.querySelector('[aria-label="Back: Pinned Trust"]').click()`)
    await waitUntil('reordered Dashboard pins', async () => {
      const raw = await client.evaluate(`localStorage.getItem('qortium-home-bookmark-manager-snapshot')`)
      const current = raw ? JSON.parse(raw) : null
      return current?.dashboardPins?.[0]?.customLabel === 'Pinned Trust' ? current : null
    })

    await client.evaluate(`(() => {
      const open = document.querySelector('[aria-label="Open Help"]');
      if (!(open instanceof HTMLButtonElement)) throw new Error('Help pin button is missing.');
      open.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, button: 2, cancelable: true, clientX: 160, clientY: 160,
      }));
    })()`)
    await waitUntil('remove control rendered in pin menu', () =>
      client.evaluate(`!!document.querySelector('[aria-label="Remove Help"]')`))
    await client.evaluate(`document.querySelector('[aria-label="Remove Help"]').click()`)
    const afterRemove = await waitUntil('removed Dashboard pin', async () => {
      const raw = await client.evaluate(`localStorage.getItem('qortium-home-bookmark-manager-snapshot')`)
      const current = raw ? JSON.parse(raw) : null
      return current?.dashboardPins?.length === 1 &&
        current.dashboardPins[0]?.customLabel === 'Pinned Trust' ? current : null
    })

    await client.send('Page.enable')
    await client.send('Page.reload')
    const afterReload = await waitUntil('migrated collections after reload', () =>
      client.evaluate(`localStorage.getItem('qortium-home-bookmark-manager-snapshot')`))
    assert.deepEqual(JSON.parse(afterReload), afterRemove)
    await waitUntil('managed pin rendered after reload', () =>
      client.evaluate(`!!document.querySelector('[aria-label="Open Pinned Trust"]')`))
  } finally {
    client.close()
  }
  await appProcess.stop()
  appProcess = null

  const freshPort = await getFreePort()
  appProcess = createManagedProcess(
    useXvfb ? '/usr/bin/xvfb-run' : appImage,
    useXvfb ? ['-a', appImage, `--remote-debugging-port=${freshPort}`] : [`--remote-debugging-port=${freshPort}`],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        QORTIUM_HOME_USER_DATA_DIR: freshProfileDirectory,
        XDG_CONFIG_HOME: path.join(freshProfileDirectory, 'config'),
      },
    },
  )
  const freshTarget = await waitUntil('fresh packaged Home 2 page', async () => {
    const response = await fetch(`http://127.0.0.1:${freshPort}/json/list`)
    if (!response.ok) return null
    const targets = await response.json()
    return targets.find((entry) => entry.type === 'page' && entry.url?.includes('/v2-live.html')) ?? null
  })
  const freshClient = new CdpClient(freshTarget.webSocketDebuggerUrl)
  try {
    const freshSnapshot = await waitUntil('fresh default Dashboard pins', async () => {
      const raw = await freshClient.evaluate(
        `localStorage.getItem('qortium-home-bookmark-manager-snapshot')`,
      )
      const current = raw ? JSON.parse(raw) : null
      return current?.dashboardPins?.length === 2 ? current : null
    })
    assert.deepEqual(freshSnapshot.dashboardPins.map((pin) => pin.displayUrl), [
      'qdn://APP/Chat/Chat',
      'qdn://APP/Help/Help',
    ])
    assert.equal(
      await freshClient.evaluate(
        `localStorage.getItem('qortium-home-v2-dashboard-defaults-pending')`,
      ),
      null,
    )
    await freshClient.send('Page.enable')
    await freshClient.send('Page.reload')
    const freshAfterReload = await waitUntil('fresh default pins after reload', async () => {
      const raw = await freshClient.evaluate(
        `localStorage.getItem('qortium-home-bookmark-manager-snapshot')`,
      )
      const current = raw ? JSON.parse(raw) : null
      return current?.dashboardPins?.length === 2 ? current : null
    })
    assert.deepEqual(freshAfterReload, freshSnapshot)
  } finally {
    freshClient.close()
  }
  console.log('Packaged Home 2 migration, managed-pin, and fresh-default reload smoke passed.')
} finally {
  await appProcess?.stop()
  rmSync(profileDirectory, { force: true, recursive: true })
  rmSync(freshProfileDirectory, { force: true, recursive: true })
}
