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
export async function launchHomeV2({
  appImage,
  log,
  portBase,
  profile: requestedProfile,
  timeoutMs = 90_000,
  // Starts a private X server WITH a window manager, so windows are really
  // placed and can be resized. Plain xvfb-run has no WM: windows land at 0,0
  // and never move, which makes any geometry assertion meaningless.
  windowManager = false,
}) {
  if (!existsSync(appImage)) {
    throw new Error(`AppImage not found: ${appImage} (run npm run dist:linux:x64 first)`)
  }
  const port = portBase + (process.pid % 190)
  // A caller may supply its own profile directory when the test needs to seed
  // or inspect files inside it; otherwise a scratch one is made here.
  const profile = requestedProfile ?? mkdtempSync(path.join(os.tmpdir(), 'home-v2-smoke-'))
  const children = []
  const spawnTracked = (command, args, env = {}) => {
    const child = spawn(command, args, {
      detached: true,
      env: { ...process.env, ...env },
      stdio: 'ignore',
    })
    children.push(child)
    return child
  }

  const shutdown = () => {
    for (const child of children) {
      try { process.kill(-child.pid, 'SIGTERM') } catch {}
    }
    setTimeout(() => {
      for (const child of children) {
        try { process.kill(-child.pid, 'SIGKILL') } catch {}
      }
    }, 2000).unref?.()
    // A caller-supplied profile is the caller's to clean up: it may still want
    // to read what the app wrote there.
    if (!requestedProfile) {
      try { rmSync(profile, { recursive: true, force: true }) } catch {}
    }
  }
  // Cover the paths that skip `finally`: Ctrl+C, kill, and uncaught throws.
  const onSignal = () => { shutdown(); process.exit(130) }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  process.once('exit', () => {
    for (const child of children) {
      try { process.kill(-child.pid, 'SIGKILL') } catch {}
    }
  })

  let display = null
  if (windowManager) {
    display = `:${80 + (process.pid % 9)}`
    spawnTracked('Xvfb', [display, '-screen', '0', '1800x1300x24', '-nolisten', 'tcp'], {
      DISPLAY: display,
    })
    await sleep(2000)
    spawnTracked('openbox', [], { DISPLAY: display })
    await sleep(1500)
    log(`window manager ready on ${display}`)
  }

  const useXvfb = !windowManager && !process.env.DISPLAY && existsSync('/usr/bin/xvfb-run')
  const command = useXvfb ? '/usr/bin/xvfb-run' : appImage
  const baseArgs = [`--remote-debugging-port=${port}`]
  const args = useXvfb ? ['-a', appImage, ...baseArgs] : baseArgs

  log(`starting ${path.basename(appImage)} (CDP ${port})`)
  // detached => the app leads its own process group, so the whole tree
  // (xvfb-run -> AppImage -> extracted binary -> zygotes) can be signalled.
  spawnTracked(
    command,
    // WAYLAND_DISPLAY is inherited from the real session; leaving it set risks
    // the window opening on the user's actual desktop instead of the private
    // X server.
    windowManager ? [...args, '--ozone-platform=x11'] : args,
    {
      APPIMAGE_EXTRACT_AND_RUN: '1',
      QORTIUM_HOME_USER_DATA_DIR: profile,
      ...(display ? { DISPLAY: display, WAYLAND_DISPLAY: '', XDG_SESSION_TYPE: 'x11' } : {}),
    },
  )

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
  // The resolved port is returned because callers that inspect /json/list
  // themselves (multi-window smokes) must use the same one, not recompute it.
  return { cdp, display, port, profile, shutdown }
}
