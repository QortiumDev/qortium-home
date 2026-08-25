// Shared CDP harness for the Home 2 desktop smokes.
//
// Extracted so a second smoke does not mean a second copy of the launch and
// teardown rules. Getting teardown wrong is not cosmetic: killing the spawned
// pid alone leaves the real app, its Xvfb server and a ~386 MB extracted
// AppImage behind, which is how earlier runs stranded Home instances.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function resolveAppImage(repoRoot) {
  const packageJson = JSON.parse(
    readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
  )
  const fallback = path.join(
    repoRoot,
    'dist-release',
    `Qortium-Home-${packageJson.version}-x86_64.AppImage`,
  )
  return path.resolve(process.env.QORTIUM_HOME_APPIMAGE?.trim() || fallback)
}

export class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.nextId = 0
    this.pending = new Map()
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      message.error
        ? entry.reject(new Error(JSON.stringify(message.error)))
        : entry.resolve(message.result)
    }
    this.ready = new Promise((resolve, reject) => {
      this.socket.onopen = resolve
      this.socket.onerror = () => reject(new Error('CDP socket error'))
    })
  }

  send(method, params = {}) {
    const id = ++this.nextId
    this.socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 30_000)
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) {
      throw new Error(`${result.exceptionDetails.text} :: ${expression}`)
    }
    return result.result?.value
  }

  mouse(type, x, y, buttons) {
    return this.send('Input.dispatchMouseEvent', {
      type, x, y, button: 'left', buttons, clickCount: 1,
    })
  }

  /** A genuine press/release pair, which Chromium expands into the full
   *  pointerdown / mousedown / pointerup / mouseup / click sequence. */
  async click(x, y) {
    await this.mouse('mousePressed', x, y, 1)
    await this.mouse('mouseReleased', x, y, 0)
  }

  /** A genuine press, intermediate moves, then a release. */
  async drag(from, to, steps = 12) {
    await this.mouse('mousePressed', from.x, from.y, 1)
    for (let step = 1; step <= steps; step++) {
      await this.mouse(
        'mouseMoved',
        Math.round(from.x + ((to.x - from.x) * step) / steps),
        Math.round(from.y + ((to.y - from.y) * step) / steps),
        1,
      )
      await sleep(25)
    }
    await this.mouse('mouseReleased', to.x, to.y, 0)
  }

  /** Centre point of the first match, or null when it is not rendered. */
  async box(selector) {
    const raw = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return JSON.stringify({
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      })
    })()`)
    return raw ? JSON.parse(raw) : null
  }
}

/**
 * Launches the packaged app on a scratch profile and returns a connected CDP
 * session plus a shutdown that takes the whole process group with it.
 */
export async function launchHomeV2({ appImage, log, portBase, timeoutMs = 90_000 }) {
  if (!existsSync(appImage)) {
    throw new Error(`AppImage not found: ${appImage} (run npm run dist:linux:x64 first)`)
  }
  const port = portBase + (process.pid % 190)
  const profile = mkdtempSync(path.join(os.tmpdir(), 'home-v2-smoke-'))
  const useXvfb = !process.env.DISPLAY && existsSync('/usr/bin/xvfb-run')
  const command = useXvfb ? '/usr/bin/xvfb-run' : appImage
  const args = useXvfb
    ? ['-a', appImage, `--remote-debugging-port=${port}`]
    : [`--remote-debugging-port=${port}`]

  log(`starting ${path.basename(appImage)} (CDP ${port})`)
  // detached => the app leads its own process group, so the whole tree
  // (xvfb-run -> AppImage -> extracted binary -> zygotes) can be signalled.
  const child = spawn(command, args, {
    detached: true,
    env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1', QORTIUM_HOME_USER_DATA_DIR: profile },
    stdio: 'ignore',
  })

  const shutdown = () => {
    try { process.kill(-child.pid, 'SIGTERM') } catch {}
    setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL') } catch {}
    }, 2000).unref?.()
    try { rmSync(profile, { recursive: true, force: true }) } catch {}
  }
  // Cover the paths that skip `finally`: Ctrl+C, kill, and uncaught throws.
  const onSignal = () => { shutdown(); process.exit(130) }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  process.once('exit', () => { try { process.kill(-child.pid, 'SIGKILL') } catch {} })

  let target = null
  const deadline = Date.now() + timeoutMs
  while (!target && Date.now() < deadline) {
    await sleep(1000)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      target = (await response.json()).find((entry) => entry.url.includes('v2-live.html'))
    } catch {
      // Not listening yet.
    }
  }
  if (!target) {
    shutdown()
    throw new Error('the Home 2 shell target never appeared')
  }

  const cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.ready
  await cdp.send('Runtime.enable')
  const readyDeadline = Date.now() + timeoutMs
  while (Date.now() < readyDeadline) {
    if (await cdp.evaluate('document.readyState === "complete" && !!document.querySelector(".home-v2-tabs")')) break
    await sleep(1000)
  }
  return { cdp, shutdown }
}
