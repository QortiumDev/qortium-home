#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'
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

function prepareQortalAdoptionFixture() {
  const installPath = path.join(profileDirectory, 'existing-qortal')
  const jarPath = path.join(installPath, 'qortal.jar')
  const settingsPath = path.join(installPath, 'settings.json')
  const jarBytes = Buffer.from(zipSync({
    'build.properties': strToU8(
      'build.version=6.2.0-0123456789\nbuild.timestamp=2026-08-22T00:00:00Z\n',
    ),
    'git.properties': strToU8(`git.commit.id.full=${'0123456789'.repeat(4)}\n`),
  }))
  const settingsBytes = Buffer.from('{"autoUpdateEnabled":true}\n')
  mkdirSync(installPath, { recursive: true })
  writeFileSync(jarPath, jarBytes)
  writeFileSync(settingsPath, settingsBytes)

  const hubStoragePath = path.join(
    profileDirectory,
    'config',
    'qortal-hub',
    'wallet-storage.json',
  )
  mkdirSync(path.dirname(hubStoragePath), { recursive: true })
  writeFileSync(hubStoragePath, `${JSON.stringify({ qortalDirectory: installPath })}\n`)
  return { installPath, jarBytes, jarPath, settingsBytes, settingsPath }
}

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
        `document.readyState === "complete" &&
          typeof window.homeV2CoreManagers?.getStatus === "function" &&
          typeof window.homeV2CoreManagers?.listQortalAdoptionCandidates === "function" &&
          typeof window.homeV2CoreManagers?.browseQortalAdoptionDirectory === "function" &&
          typeof window.homeV2CoreManagers?.selectQortalAdoptionCandidate === "function"`,
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
  assert.deepEqual(Object.keys(value.capabilities).sort(), [
    'canInitialInstall', 'canInstallJava', 'canInstallOnChainUpdate', 'canRefreshHelpers',
    'canUpdateRunningInPlace',
  ].sort())
  assert.deepEqual(Object.keys(value.core).sort(), [
    'channel', 'helpersOutOfSyncVersion', 'installedCommit', 'installModified', 'installedTag',
    'installedVersion', 'localApiUrl', 'nodeAutoUpdateMode', 'runtime', 'runtimeBlockedReason',
    'update', 'updateSources',
  ].sort())
  assert.deepEqual(Object.keys(value.java).sort(), [
    'source', 'targetMajorVersion', 'updateAvailable', 'version',
  ].sort())
  // Aligned with the contract's own assertRedacted (see
  // home-v2-core-manager-contract.test.ts), which is the maintained list.
  //
  // `commit` and `url` were dropped from this regex DELIBERATELY, not to make a
  // stale test pass: installedCommit is ordinary build identity (#445) and
  // localApiUrl is a loopback address on a published port that users need in
  // order to point other tools at their own node (#461). Both were weighed
  // against the redaction rule when they landed. What must still never appear
  // is unchanged: credentials, paths, process identity.
  assert.doesNotMatch(
    JSON.stringify(value),
    /apiKey|authority|cause|digest|download|jarPath|pid|record|runtimePath|token/i,
  )
  // The loopback property asserted POSITIVELY, since the substring ban that
  // used to cover it is gone: this row claims to be the user's OWN node, and a
  // remote address here would be a different claim entirely.
  if (value.core.localApiUrl !== null) {
    const host = new URL(value.core.localApiUrl).hostname
    assert.ok(
      host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]',
      `the local API address must be loopback, got ${host}`,
    )
  }
}

function assertQortalMaintenanceStatus(value) {
  assert.deepEqual(Object.keys(value).sort(), [
    'capabilities',
    'discovery',
    'install',
    'installedVersion',
    'issue',
    // Added after this smoke was last touched (2026-08-22), by the Qortal
    // maintenance work rather than anything in the 2026-08-30 wave.
    'lastRelease',
    'lastReleaseCheckedAt',
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

function assertQortalAdoptionList(value) {
  assert.deepEqual(Object.keys(value).sort(), [
    'canBrowse', 'canSelect', 'candidates', 'code', 'network', 'revision', 'schema', 'state',
  ])
  assert.equal(value.network, 'qortal')
  assert.equal(value.schema, 'home-v2-qortal-adoption-list')
  assert.equal(value.revision, 1)
  assert.equal(typeof value.canBrowse, 'boolean')
  assert.equal(typeof value.canSelect, 'boolean')
  assert.equal(Array.isArray(value.candidates), true)
  for (const candidate of value.candidates) {
    assert.deepEqual(Object.keys(candidate).sort(), [
      'candidateId', 'hubHint', 'origins', 'runningProcessMatch', 'version',
    ])
    assert.match(candidate.candidateId, /^[0-9a-f-]{36}$/)
    assert.equal(Array.isArray(candidate.origins), true)
    assert.equal(typeof candidate.hubHint, 'boolean')
    assert.equal(typeof candidate.runningProcessMatch, 'boolean')
    assert.equal(candidate.version === null || typeof candidate.version === 'string', true)
  }
  assert.doesNotMatch(
    JSON.stringify(value),
    /apiKey|canonical|cause|commit|digest|installPath|jarPath|pid|rawRelease|record|runtimePath|settingsPath|url/i,
  )
}

function assertQortalAdoptionSelection(value, outcome, code) {
  assert.deepEqual(Object.keys(value).sort(), [
    'code', 'network', 'outcome', 'revision', 'schema', 'status',
  ])
  assert.equal(value.network, 'qortal')
  assert.equal(value.schema, 'home-v2-qortal-adoption-selection')
  assert.equal(value.revision, 1)
  assert.equal(value.outcome, outcome)
  assert.equal(value.code, code)
  assertQortalMaintenanceStatus(value.status)
}

function assertTransportMaintenanceStatus(value) {
  assert.deepEqual(Object.keys(value).sort(), [
    'capabilities', 'core', 'issue', 'network', 'revision', 'router', 'schema', 'transportMode',
  ])
  assert.equal(value.network, 'qortium')
  assert.equal(value.schema, 'home-v2-transport-maintenance')
  assert.equal(value.revision, 1)
  assert.deepEqual(Object.keys(value.capabilities).sort(), [
    'canEnsureRouter', 'canRevealRouterFolder', 'canSetDirectAndI2p', 'canSetDirectOnly',
    'canSetI2pOnly',
    // These router controls come from the running AppImage over CDP, not from
    // a fixture, so this remains exact end-to-end evidence for the bridge.
    'canSetModeWhileRunning', 'canStopRouter',
  ])
  assert.deepEqual(Object.keys(value.core).sort(), ['install', 'runtime'])
  assert.deepEqual(Object.keys(value.router).sort(), ['maintenance', 'state', 'version'])
  assert.doesNotMatch(
    JSON.stringify(value),
    /apiKey|binaryPath|cause|digest|download|externalBinaryPath|jarPath|pid|record|runtimePath|samHost|samPort|token|url/i,
  )
}

function assertUpdatePolicy(value) {
  assert.deepEqual(Object.keys(value).sort(), [
    'activity',
    'coreUpdatePolicy',
    'generation',
    'javaUpdatePolicy',
    // Qortal maintenance again, post-2026-08-22.
    'qortalUpdatePolicy',
    'revision',
    'schema',
    'settingsIssue',
  ])
  assert.equal(value.schema, 'home-v2-core-update-policy')
  assert.equal(value.revision, 1)
  assert.equal(['install', 'notify', 'off'].includes(value.coreUpdatePolicy), true)
  assert.equal(['install', 'notify', 'off'].includes(value.javaUpdatePolicy), true)
  assert.deepEqual(Object.keys(value.activity).sort(), ['checkedAt', 'core', 'generation', 'issue', 'java', 'qortal'])
  assert.equal(value.activity.generation, value.generation)
  assert.doesNotMatch(JSON.stringify(value), /apiKey|cause|commit|digest|download|jarPath|pid|record|runtimePath|token|url/i)
}

try {
  assert.equal(existsSync(appImage), true, `AppImage not found at ${appImage}`)
  const adoptionFixture = prepareQortalAdoptionFixture()
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
  const qortalAdoption = await evaluate(
    page,
    'window.homeV2CoreManagers.listQortalAdoptionCandidates()',
  )
  assertQortalAdoptionList(qortalAdoption)
  const fixtureCandidate = qortalAdoption.candidates.find((candidate) =>
    candidate.origins.includes('qortal-hub'))
  assert.ok(fixtureCandidate, 'Packaged discovery did not return the Qortal Hub fixture.')
  assert.equal(fixtureCandidate.version, '6.2.0')
  const selectedQortalAdoption = await evaluate(
    page,
    `window.homeV2CoreManagers.selectQortalAdoptionCandidate(
      ${JSON.stringify(fixtureCandidate.candidateId)}
    )`,
  )
  assertQortalAdoptionSelection(selectedQortalAdoption, 'completed', null)
  assert.equal(selectedQortalAdoption.status.install, 'adopted')
  const adoptedRecordPath = path.join(profileDirectory, 'config', 'qortal-core', 'adopted.json')
  const adoptedRecord = JSON.parse(readFileSync(adoptedRecordPath, 'utf8'))
  assert.equal(adoptedRecord.installPath, adoptionFixture.installPath)
  assert.equal(adoptedRecord.source, 'adopted')
  assert.equal(statSync(adoptedRecordPath).mode & 0o777, 0o600)
  assert.deepEqual(readFileSync(adoptionFixture.jarPath), adoptionFixture.jarBytes)
  assert.deepEqual(readFileSync(adoptionFixture.settingsPath), adoptionFixture.settingsBytes)
  const expiredQortalAdoption = await evaluate(
    page,
    `window.homeV2CoreManagers.selectQortalAdoptionCandidate(
      "00000000-0000-4000-8000-000000000000"
    )`,
  )
  assertQortalAdoptionSelection(expiredQortalAdoption, 'blocked', 'candidate-expired')
  const transportMaintenance = await evaluate(
    page,
    'window.homeV2CoreManagers.getTransportMaintenanceStatus()',
  )
  assertTransportMaintenanceStatus(transportMaintenance)
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
    'qortalUpdatePolicy',
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
          typeof bridge.getTransportMaintenanceStatus === 'function' &&
          typeof bridge.runTransportMaintenanceAction === 'function' &&
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
