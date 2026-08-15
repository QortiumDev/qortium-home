// Drives an unpackaged Qortium Home from a smoke script and, unlike the
// existing desktop smokes, can evaluate expressions **in the Electron main
// process**.
//
// Why this exists: the widget host's risk lives entirely in native window state
// -- always-on-top, transparency, ignore-mouse toggling, tray inventory. None
// of that is visible from a renderer, and the AppImage-driven smokes
// (scripts/smoke-desktop-home-v2-nodes.mjs and friends) only speak to renderer
// CDP targets. Every defect found in the widget host's first manual pass sat on
// a boundary a typecheck and a green unit suite both missed, and each cost a
// package-and-relaunch cycle to find.
//
// Three environment facts shape this file, and each one costs an afternoon if
// rediscovered:
//
//   1. `--inspect` is not enough. Electron's main process accepts the inspector
//      WebSocket handshake only while the Node loop is still servicing it. Once
//      Chromium's message loop takes over, the connection attempt hangs until it
//      times out. `--inspect-brk` holds the process at the first line, which
//      lets the handshake complete; `Runtime.runIfWaitingForDebugger` then
//      releases it. Without the brk this driver appears to work -- the target is
//      listed and /json/list answers -- and then dies at connect.
//   2. Packaged builds cannot be driven this way at all. package.json disables
//      the `enableNodeCliInspectArguments` fuse, so --inspect-brk is ignored in
//      a packaged app. This driver therefore runs the unpackaged app and relies
//      on QORTIUM_HOME_LOAD_DIST=1 to load the built renderer out of dist/.
//   3. An agent shell often exports ELECTRON_RUN_AS_NODE. Left set, the Electron
//      binary runs as plain Node and never opens a window.
//
// The main-process context is ESM, so `require` is not a global there. Reach
// Electron's API through process.getBuiltinModule('node:module').createRequire,
// or use the `mainRequire` helper below which wraps that for you.

import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveWebSocket } from './cdp-websocket.mjs'

const CONNECT_TIMEOUT_MS = 60_000
const COMMAND_TIMEOUT_MS = 30_000

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function getFreePort() {
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

export async function waitUntil(label, timeoutMs, action) {
  const startedAt = Date.now()
  let lastError = null
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await action()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await delay(200)
  }
  const detail = lastError ? ` Last error: ${lastError.message}` : ''
  throw new Error(`Timed out waiting for ${label}.${detail}`)
}

function electronBinary(repoRoot) {
  const directory = path.join(repoRoot, 'node_modules', 'electron', 'dist')
  if (process.platform === 'win32') return path.join(directory, 'electron.exe')
  if (process.platform === 'darwin') {
    return path.join(directory, 'Electron.app', 'Contents', 'MacOS', 'Electron')
  }
  return path.join(directory, 'electron')
}

class CdpClient {
  constructor(WebSocketImpl, webSocketUrl, label) {
    this.label = label
    this.nextId = 1
    this.pending = new Map()
    this.eventListeners = new Set()
    this.socket = new WebSocketImpl(webSocketUrl)
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`CDP connection to ${label} timed out.`)),
        CONNECT_TIMEOUT_MS,
      )
      this.socket.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
      this.socket.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error(`CDP connection to ${label} failed.`))
      }, { once: true })
    })
    // A socket that errors after `ready` has settled would otherwise have no
    // listener left, and an unhandled error event takes the whole run down with
    // a stack that says nothing about the test. Sockets die routinely here:
    // widget windows close, Home quits, and clients outlive both.
    this.socket.addEventListener('error', () => {})
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (!message.id) {
        if (message.method) {
          for (const listener of this.eventListeners) listener(message.method, message.params)
        }
        return
      }
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message ?? 'CDP command failed.'))
      else pending.resolve(message.result)
    })
  }

  onEvent(listener) {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  async send(method, params = {}, timeoutMs = COMMAND_TIMEOUT_MS) {
    await this.ready
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP ${method} on ${this.label} timed out after ${timeoutMs}ms.`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression, timeoutMs = COMMAND_TIMEOUT_MS) {
    const result = await this.send(
      'Runtime.evaluate',
      { awaitPromise: true, expression, returnByValue: true },
      timeoutMs,
    )
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.text
        ?? 'unknown error'
      throw new Error(`${this.label} evaluation failed: ${description}`)
    }
    return result.result?.value
  }

  close() {
    this.socket.close()
  }
}

// Wraps an expression so it runs with `require` in scope inside the ESM main
// process. Everything the smoke wants -- BrowserWindow, screen, Tray -- comes
// from here.
export function mainRequire(body) {
  return `(() => {
    const require = process.getBuiltinModule('node:module').createRequire(process.execPath)
    ${body}
  })()`
}

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}.`)
  return response.json()
}

/**
 * Launches Home unpackaged with both inspectors open and returns a handle with
 * `main` (an already-resumed main-process CDP client), `renderer(predicate)`,
 * `output`, and `stop()`.
 */
export async function launchHome(options = {}) {
  const repoRoot = options.repoRoot
  if (!repoRoot) throw new Error('launchHome needs repoRoot.')

  const WebSocketImpl = await resolveWebSocket()
  const inspectPort = await getFreePort()
  const devtoolsPort = await getFreePort()
  const profileDirectory = options.profileDirectory
    ?? mkdtempSync(path.join(os.tmpdir(), 'qortium-home-widget-smoke-'))
  const ownsProfile = !options.profileDirectory

  const environment = {
    ...process.env,
    QORTIUM_HOME_LOAD_DIST: '1',
    QORTIUM_HOME_USER_DATA_DIR: profileDirectory,
    ...options.env,
  }
  // Left set by some agent shells, this turns the Electron binary into plain
  // Node and no window ever appears.
  delete environment.ELECTRON_RUN_AS_NODE

  const args = [
    `--inspect-brk=${inspectPort}`,
    `--remote-debugging-port=${devtoolsPort}`,
    '.',
  ]
  const useXvfb = process.platform === 'linux' && !process.env.DISPLAY
  const child = spawn(
    useXvfb ? '/usr/bin/xvfb-run' : electronBinary(repoRoot),
    useXvfb ? ['-a', electronBinary(repoRoot), ...args] : args,
    { cwd: repoRoot, detached: process.platform !== 'win32', env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  const output = []
  child.stdout?.on('data', (chunk) => output.push(String(chunk)))
  child.stderr?.on('data', (chunk) => output.push(String(chunk)))

  const stop = async () => {
    try {
      child.kill('SIGKILL')
    } catch {
      // Already gone.
    }
    await delay(400)
    if (ownsProfile) {
      try {
        rmSync(profileDirectory, { force: true, maxRetries: 5, recursive: true })
      } catch {
        // Windows keeps a handle on the profile briefly after exit. A leftover
        // temp directory must not fail an otherwise passing smoke.
      }
    }
  }

  try {
    const target = await waitUntil('the main process inspector', CONNECT_TIMEOUT_MS, async () => {
      const targets = await fetchJson(`http://127.0.0.1:${inspectPort}/json/list`)
      return targets.find((entry) => entry.webSocketDebuggerUrl) ?? null
    })
    const main = new CdpClient(WebSocketImpl, target.webSocketDebuggerUrl, 'main process')
    await main.ready
    await main.send('Runtime.enable')
    // Releases the --inspect-brk pause. Until this lands the app has not
    // executed a single line of its own code.
    await main.send('Runtime.runIfWaitingForDebugger')

    await waitUntil('the app to become ready', CONNECT_TIMEOUT_MS, async () =>
      await main.evaluate(mainRequire("return require('electron').app.isReady()")) === true)

    return {
      child,
      main,
      output,
      profileDirectory,
      async renderer(predicate, label = 'renderer') {
        const page = await waitUntil(`the ${label} CDP target`, CONNECT_TIMEOUT_MS, async () => {
          const targets = await fetchJson(`http://127.0.0.1:${devtoolsPort}/json/list`)
          return targets.find(
            (entry) => entry.type === 'page'
              && entry.webSocketDebuggerUrl
              && typeof entry.url === 'string'
              && predicate(entry.url),
          ) ?? null
        })
        const client = new CdpClient(WebSocketImpl, page.webSocketDebuggerUrl, label)
        await client.ready
        return client
      },
      stop,
    }
  } catch (error) {
    await stop()
    error.message = `${error.message}\n--- Electron output ---\n${output.join('').trim()}`
    throw error
  }
}
