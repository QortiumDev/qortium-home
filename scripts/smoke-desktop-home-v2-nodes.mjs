#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createManagedProcess } from './lib/managed-process.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDirectory, '..')
const packageJson = JSON.parse(
  readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
)
const defaultAppImage = path.join(
  repoRoot,
  'dist-release',
  `Qortium-Home-${packageJson.version}-x86_64.AppImage`,
)
const appImage = path.resolve(
  process.env.QORTIUM_HOME_APPIMAGE?.trim() || defaultAppImage,
)
const profileDirectory = mkdtempSync(
  path.join(os.tmpdir(), 'qortium-home-v2-node-smoke-'),
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

async function waitForPage(port) {
  const startedAt = Date.now()
  let lastError = null
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find(
          (target) =>
            target.type === 'page' &&
            typeof target.url === 'string' &&
            target.url.includes('/v2-live.html') &&
            typeof target.webSocketDebuggerUrl === 'string',
        )
        if (
          page &&
          (await evaluate(
            page,
            'document.readyState === "complete" && typeof window.homeV2Nodes?.getSnapshot === "function"',
          ))
        ) {
          return page
        }
      }
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : ''
  throw new Error(`Home DevTools target did not become ready${detail}`)
}

async function evaluate(page, expression) {
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const response = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Home node bridge evaluation timed out.')),
      timeoutMs,
    )
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id !== 1) return
      clearTimeout(timeout)
      resolve(message)
    })
    socket.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { awaitPromise: true, expression, returnByValue: true },
      }),
    )
  })
  socket.close()
  if (response.error || response.result?.exceptionDetails) {
    throw new Error(
      JSON.stringify(response.error ?? response.result.exceptionDetails),
    )
  }
  return response.result?.result?.value
}

async function waitForSnapshot(page, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      return await evaluate(page, 'window.homeV2Nodes.getSnapshot()')
    } catch (error) {
      lastError = error
      await delay(250)
    }
  }
  throw new Error(`Home 2 node snapshot never became available: ${lastError}`)
}

function assertReadableNode(snapshot, network, mode) {
  const node = snapshot?.nodes?.[network]
  assert.equal(node?.mode, mode, `${network} should remain in ${mode} mode`)
  assert.equal(
    node?.capabilities?.read,
    true,
    `${network} should be readable: ${node?.error ?? 'unknown error'}`,
  )
  assert.equal(node?.state, 'online', `${network} should be online`)
  assert.match(node?.nodeApiUrl ?? '', /^https:\/\//)
  return node
}

try {
  assert.equal(
    existsSync(appImage),
    true,
    `Build the x64 AppImage first; it was not found at ${appImage}`,
  )
  const port = await getFreePort()
  const appArguments = [appImage, `--remote-debugging-port=${port}`]
  const useXvfb = !process.env.DISPLAY && existsSync('/usr/bin/xvfb-run')
  const command = useXvfb ? '/usr/bin/xvfb-run' : appImage
  const args = useXvfb ? ['-a', ...appArguments] : appArguments.slice(1)
  appProcess = createManagedProcess(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      QORTIUM_HOME_USER_DATA_DIR: profileDirectory,
    },
  })
  const page = await waitForPage(port)
  // Retry rather than failing on the first rejection, so the error we report is
  // the STEADY-STATE one. (It is: this does not recover. See the report.)
  const initial = await waitForSnapshot(page)
  const localQortium = assertReadableNode(initial, 'qortium', 'local')
  assert.equal(localQortium.nodeApiUrl, 'https://127.0.0.1:24891')
  assert.equal(
    existsSync(path.join(profileDirectory, 'node-ca', '127.0.0.1_24891.pem')),
    true,
    'Home should pin the local Qortium Core CA before using HTTPS.',
  )

  const qortiumPublic = await evaluate(
    page,
    'window.homeV2Nodes.setMode("qortium", "public")',
  )
  assertReadableNode(qortiumPublic, 'qortium', 'public')

  const bothPublic = await evaluate(
    page,
    'window.homeV2Nodes.setMode("qortal", "public")',
  )
  const publicQortium = assertReadableNode(bothPublic, 'qortium', 'public')
  const publicQortal = assertReadableNode(bothPublic, 'qortal', 'public')
  console.log(
    `Home 2.0 packaged node smoke passed: local Qortium ${localQortium.height}, ` +
      `public Qortium ${publicQortium.nodeApiUrl}, public Qortal ${publicQortal.nodeApiUrl}.`,
  )
} catch (error) {
  const output = appProcess?.output.join('').trim()
  if (output) console.error(output)
  throw error
} finally {
  await appProcess?.stop()
  rmSync(profileDirectory, { force: true, recursive: true })
}
