#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createManagedProcess } from './lib/managed-process.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const appImage = path.resolve(
  process.env.QORTIUM_HOME_APPIMAGE?.trim() ||
    path.join(repoRoot, 'dist-release', `Qortium-Home-${packageJson.version}-x86_64.AppImage`),
)
const screenshotPath = path.resolve(
  process.env.QORTIUM_HOME_ONBOARDING_SCREENSHOT?.trim() ||
    '/tmp/qortium-home-2.1-onboarding.png',
)
const profileDirectory = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-v2-onboarding-smoke-'))
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'CDP evaluation failed.')
  return result.result?.value
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
  const target = await waitUntil('packaged Home onboarding page', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`)
    if (!response.ok) return null
    const targets = await response.json()
    return targets.find((candidate) =>
      candidate.type === 'page' &&
      candidate.url?.includes('/v2-live.html') &&
      candidate.webSocketDebuggerUrl,
    ) ?? null
  })
  const client = new CdpClient(target.webSocketDebuggerUrl)
  try {
    await client.send('Runtime.enable')
    await client.send('Page.enable')
    const initial = await waitUntil('fresh onboarding state', () => evaluate(
      client,
      `(() => {
        const page = document.querySelector('.home-v2-welcome');
        const address = document.querySelector('.home-v2-address input')?.value;
        const steps = document.querySelectorAll('.home-v2-welcome__steps li').length;
        return page && address === 'home://welcome' && steps === 3
          ? { address, steps }
          : null;
      })()`,
    ))
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png' })
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64')),
    )
    for (let step = 0; step < 2; step += 1) {
      await evaluate(client, `document.querySelector('.home-v2-welcome__footer .home-v2-primary-button').click()`)
      await delay(100)
    }
    await evaluate(client, `document.querySelector('.home-v2-welcome__finish-actions button:last-child').click()`)
    const completed = await waitUntil('completed onboarding state', () => evaluate(
      client,
      `(async () => {
        if (!document.querySelector('.home-v2-dashboard')) return null;
        const state = await window.homeV2Nodes.getShellState();
        return state?.onboarding?.status === 'completed' ? state.onboarding : null;
      })()`,
    ))
    await client.send('Page.reload')
    await waitUntil('completed onboarding remains dismissed after reload', () => evaluate(
      client,
      `Boolean(document.querySelector('.home-v2-dashboard') && !document.querySelector('.home-v2-welcome'))`,
    ))
    let coreDocs = null
    if (process.env.QORTIUM_HOME_CORE_DOCS_SMOKE === '1') {
      await evaluate(client, `(() => {
        const input = document.querySelector('.home-v2-address input');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'core://');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.closest('form').requestSubmit();
        return true;
      })()`)
      coreDocs = await waitUntil('packaged Qortium Core documentation frame', () => evaluate(
        client,
        `(() => {
          const frame = document.querySelector('.home-v2-core-docs iframe');
          const address = document.querySelector('.home-v2-address input')?.value;
          return frame && address === 'core://' && frame.src.startsWith('qortium-home-core-docs://qortium/api-documentation/')
            ? { address, frameSrc: frame.src }
            : null;
        })()`,
      ))
    }
    console.log(`Packaged Home 2 onboarding smoke passed: ${JSON.stringify({ completed, coreDocs, initial })}; screenshot=${screenshotPath}`)
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
