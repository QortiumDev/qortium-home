#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
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
const profileDirectory = mkdtempSync(path.join(os.tmpdir(), 'qortium-home-v2-core-manager-smoke-'))
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

async function evaluate(page, expression) {
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const response = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Core-manager smoke evaluation timed out.')), timeoutMs)
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id !== 1) return
      clearTimeout(timeout)
      resolve(message)
    })
    socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { awaitPromise: true, expression, returnByValue: true },
    }))
  })
  socket.close()
  if (response.error || response.result?.exceptionDetails) {
    throw new Error(JSON.stringify(response.error ?? response.result.exceptionDetails))
  }
  return response.result?.result?.value
}

async function waitForPage(port) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = response.ok ? await response.json() : []
      const page = targets.find((target) =>
        target.type === 'page' &&
        typeof target.url === 'string' &&
        target.url.includes('/v2-live.html') &&
        typeof target.webSocketDebuggerUrl === 'string')
      if (page && await evaluate(
        page,
        'document.readyState === "complete" && typeof window.homeV2CoreManagers?.getStatus === "function"',
      )) return page
    } catch {}
    await delay(250)
  }
  throw new Error('Packaged Home 2 Core-manager bridge did not become ready.')
}

function assertStatus(value, network) {
  assert.deepEqual(Object.keys(value).sort(), [
    'capabilities',
    'control',
    'install',
    'issue',
    'network',
    'revision',
    'runtime',
    'schema',
  ])
  assert.equal(value.network, network)
  assert.equal(value.schema, 'home-v2-core-manager')
  assert.equal(value.revision, 1)
  assert.deepEqual(Object.keys(value.capabilities).sort(), ['canStart', 'canStop'])
  assert.equal(typeof value.capabilities.canStart, 'boolean')
  assert.equal(typeof value.capabilities.canStop, 'boolean')
  assert.doesNotMatch(JSON.stringify(value), /apiKey|cause|jarPath|pid|record|runtimePath|token/i)
}

function assertMaintenanceStatus(value) {
  assert.deepEqual(Object.keys(value).sort(), ['capabilities', 'core', 'java', 'revision', 'schema'])
  assert.equal(value.schema, 'home-v2-core-maintenance')
  assert.equal(value.revision, 1)
  assert.deepEqual(Object.keys(value.capabilities).sort(), ['canInitialInstall', 'canInstallJava'])
  assert.deepEqual(Object.keys(value.core).sort(), ['channel', 'installedVersion', 'runtime'])
  assert.deepEqual(Object.keys(value.java).sort(), ['source', 'updateAvailable', 'version'])
  assert.doesNotMatch(JSON.stringify(value), /apiKey|cause|commit|digest|download|jarPath|pid|record|runtimePath|token|url/i)
}

function assertQortalMaintenanceStatus(value) {
  assert.deepEqual(Object.keys(value).sort(), [
    'capabilities',
    'discovery',
    'install',
    'installedVersion',
    'issue',
    'network',
    'revision',
    'runtime',
    'schema',
    'updateAuthority',
  ])
  assert.equal(value.network, 'qortal')
  assert.equal(value.schema, 'home-v2-qortal-maintenance')
  assert.equal(value.revision, 1)
  assert.deepEqual(Object.keys(value.capabilities).sort(), [
    'canCheckRelease',
    'canInitialInstall',
    'canUpdate',
  ])
  assert.doesNotMatch(
    JSON.stringify(value),
    /apiKey|cause|commit|digest|download|jarPath|pid|rawRelease|record|runtimePath|token|url/i,
  )
}

function assertUpdatePolicy(value) {
  assert.deepEqual(Object.keys(value).sort(), [
    'activity',
    'coreUpdatePolicy',
    'generation',
    'javaUpdatePolicy',
    'revision',
    'schema',
    'settingsIssue',
  ])
  assert.equal(value.schema, 'home-v2-core-update-policy')
  assert.equal(value.revision, 1)
  assert.equal(['install', 'notify', 'off'].includes(value.coreUpdatePolicy), true)
  assert.equal(['install', 'notify', 'off'].includes(value.javaUpdatePolicy), true)
  assert.deepEqual(Object.keys(value.activity).sort(), ['checkedAt', 'core', 'generation', 'issue', 'java'])
  assert.equal(value.activity.generation, value.generation)
  assert.doesNotMatch(JSON.stringify(value), /apiKey|cause|commit|digest|download|jarPath|pid|record|runtimePath|token|url/i)
}

try {
  assert.equal(existsSync(appImage), true, `AppImage not found at ${appImage}`)
  const port = await getFreePort()
  const appArguments = [appImage, `--remote-debugging-port=${port}`]
  const useXvfb = !process.env.DISPLAY && existsSync('/usr/bin/xvfb-run')
  appProcess = createManagedProcess(
    useXvfb ? '/usr/bin/xvfb-run' : appImage,
    useXvfb ? ['-a', ...appArguments] : appArguments.slice(1),
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        QORTIUM_HOME_USER_DATA_DIR: path.join(profileDirectory, 'user-data'),
        XDG_CONFIG_HOME: path.join(profileDirectory, 'config'),
      },
    },
  )
  const page = await waitForPage(port)
  for (const network of ['qortium', 'qortal']) {
    const status = await evaluate(
      page,
      `window.homeV2CoreManagers.getStatus(${JSON.stringify(network)})`,
    )
    assertStatus(status, network)
  }
  const maintenance = await evaluate(page, 'window.homeV2CoreManagers.getMaintenanceStatus()')
  assertMaintenanceStatus(maintenance)
  const qortalMaintenance = await evaluate(
    page,
    'window.homeV2CoreManagers.getQortalMaintenanceStatus()',
  )
  assertQortalMaintenanceStatus(qortalMaintenance)
  const updatePolicy = await evaluate(page, 'window.homeV2CoreManagers.getUpdatePolicy()')
  assertUpdatePolicy(updatePolicy)
  const setPolicyResult = await evaluate(
    page,
    `window.homeV2CoreManagers.setUpdatePolicy(${updatePolicy.generation}, "coreUpdatePolicy", "off")`,
  )
  assert.deepEqual(Object.keys(setPolicyResult).sort(), ['outcome', 'revision', 'schema', 'state'])
  assert.equal(setPolicyResult.schema, 'home-v2-core-update-policy-set-result')
  assert.equal(setPolicyResult.revision, 1)
  assert.equal(setPolicyResult.outcome, 'saved')
  assertUpdatePolicy(setPolicyResult.state)
  assert.equal(setPolicyResult.state.coreUpdatePolicy, 'off')
  const persistedPolicy = await evaluate(page, 'window.homeV2CoreManagers.getUpdatePolicy()')
  assertUpdatePolicy(persistedPolicy)
  assert.equal(persistedPolicy.coreUpdatePolicy, 'off')
  assert.equal(persistedPolicy.generation, setPolicyResult.state.generation)
  const policyPath = path.join(
    profileDirectory,
    'user-data',
    'home-v2-core-maintenance',
    'update-policy.json',
  )
  const policyFile = JSON.parse(readFileSync(policyPath, 'utf8'))
  assert.deepEqual(Object.keys(policyFile).sort(), [
    'coreUpdatePolicy',
    'generation',
    'javaUpdatePolicy',
    'schema',
    'version',
  ])
  assert.equal(policyFile.coreUpdatePolicy, 'off')
  assert.equal(statSync(policyPath).mode & 0o777, 0o600)
  assert.equal(
    await evaluate(
      page,
      `(() => {
        const bridge = window.homeV2CoreManagers;
        return typeof bridge.checkMaintenanceRelease === 'function' &&
          typeof bridge.runMaintenanceAction === 'function' &&
          typeof bridge.getQortalMaintenanceStatus === 'function' &&
          typeof bridge.checkQortalMaintenanceRelease === 'function' &&
          typeof bridge.runQortalMaintenanceAction === 'function' &&
          typeof bridge.getUpdatePolicy === 'function' &&
          typeof bridge.setUpdatePolicy === 'function';
      })()`,
    ),
    true,
  )
  assert.equal(
    await evaluate(
      page,
      'window.homeV2CoreManagers.getStatus("invalid").then(() => false, () => true)',
    ),
    true,
  )
  console.log('Packaged Home 2 Core-manager bridge smoke passed.')
} finally {
  await appProcess?.stop()
  rmSync(profileDirectory, { force: true, recursive: true })
}
