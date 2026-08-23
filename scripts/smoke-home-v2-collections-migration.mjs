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
    assert.equal(snapshot.startPages[0]?.displayUrl, 'qdn://APP/Polls/Polls')
    await client.send('Page.enable')
    await client.send('Page.reload')
    const afterReload = await waitUntil('migrated collections after reload', () =>
      client.evaluate(`localStorage.getItem('qortium-home-bookmark-manager-snapshot')`))
    assert.deepEqual(JSON.parse(afterReload), snapshot)
  } finally {
    client.close()
  }
  console.log('Packaged Home 2 v1 collections migration and reload smoke passed.')
} finally {
  await appProcess?.stop()
  rmSync(profileDirectory, { force: true, recursive: true })
}
