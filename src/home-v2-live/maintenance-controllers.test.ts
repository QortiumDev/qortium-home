// Covers the logic lifted out of CoreMaintenancePanel, QortalMaintenancePanel
// and TransportMaintenancePanel into the shared maintenance controllers. The
// panels' own tests still drive the React behaviour end to end; these guard the
// pieces that are now plain functions, plus the HomeV2CoreManagement builders
// that the dashboard tile will use.
import assert from 'node:assert/strict'
import type {
  HomeV2QortalAdoptionList,
  HomeV2QortalMaintenanceActionResult,
  HomeV2QortalMaintenanceRelease,
  HomeV2QortalMaintenanceStatus,
  HomeV2TransportMaintenanceActionResult,
  HomeV2TransportMaintenanceStatus,
} from './core-manager-client'
import {
  toHomeV2CoreMaintenanceManagement,
  type HomeV2CoreMaintenance,
} from './core-maintenance-controller'
import {
  preferredQortalCandidate,
  qortalActionMessage,
  qortalReleaseMessage,
  qortalStatusFingerprint,
  toHomeV2QortalMaintenanceManagement,
  type HomeV2QortalMaintenance,
} from './qortal-maintenance-controller'
import {
  canSetTransportMode,
  toHomeV2TransportManagement,
  transportActionMessage,
  transportModeActionFor,
  transportStatusFingerprint,
  type HomeV2TransportMaintenance,
} from './transport-maintenance-controller'

function qortalStatus(
  overrides: Partial<HomeV2QortalMaintenanceStatus> = {},
): HomeV2QortalMaintenanceStatus {
  return {
    capabilities: { canCheckRelease: true, canInitialInstall: false, canUpdate: true },
    discovery: 'clear',
    install: 'home-managed',
    installedVersion: 'v6.1.0',
    issue: null,
    lastRelease: null,
    lastReleaseCheckedAt: null,
    network: 'qortal',
    revision: 1,
    runtime: 'stopped',
    schema: 'home-v2-qortal-maintenance',
    updateAuthority: 'home-github',
    ...overrides,
  }
}

function qortalRelease(
  overrides: Partial<HomeV2QortalMaintenanceRelease> = {},
): HomeV2QortalMaintenanceRelease {
  return {
    action: 'strict-update',
    available: true,
    code: null,
    network: 'qortal',
    revision: 1,
    schema: 'home-v2-qortal-maintenance-release',
    tag: 'v6.2.0',
    ...overrides,
  }
}

function qortalActionResult(
  overrides: Partial<HomeV2QortalMaintenanceActionResult> = {},
): HomeV2QortalMaintenanceActionResult {
  return {
    code: null,
    network: 'qortal',
    outcome: 'completed',
    revision: 1,
    schema: 'home-v2-qortal-maintenance-action',
    status: qortalStatus(),
    warning: null,
    ...overrides,
  }
}

function adoptionList(
  overrides: Partial<HomeV2QortalAdoptionList> = {},
): HomeV2QortalAdoptionList {
  return {
    canBrowse: true,
    canSelect: true,
    candidates: [],
    code: null,
    network: 'qortal',
    revision: 1,
    schema: 'home-v2-qortal-adoption-list',
    state: 'complete',
    ...overrides,
  }
}

function transportStatus(
  overrides: Partial<HomeV2TransportMaintenanceStatus> = {},
): HomeV2TransportMaintenanceStatus {
  return {
    capabilities: {
      canEnsureRouter: true,
    canRevealRouterFolder: false,
      canSetDirectAndI2p: true,
      canSetDirectOnly: true,
      canSetI2pOnly: false,
      canStopRouter: false,
      canSetModeWhileRunning: false,
    },
    core: { install: 'installed', runtime: 'stopped' },
    issue: null,
    network: 'qortium',
    revision: 1,
    router: { maintenance: 'install', state: 'missing', version: null },
    schema: 'home-v2-transport-maintenance',
    transportMode: 'direct-only',
    ...overrides,
  }
}

function transportActionResult(
  overrides: Partial<HomeV2TransportMaintenanceActionResult> = {},
): HomeV2TransportMaintenanceActionResult {
  return {
    code: null,
    network: 'qortium',
    outcome: 'completed',
    revision: 1,
    schema: 'home-v2-transport-maintenance-action',
    status: transportStatus(),
    warning: null,
    ...overrides,
  }
}

// --- Qortal status fingerprint -------------------------------------------
// The fingerprint decides when a poll discards a checked release, so it must
// react to capability and install changes but ignore cached-release churn.
{
  const base = qortalStatus()
  assert.equal(qortalStatusFingerprint(base), qortalStatusFingerprint(qortalStatus()))
  assert.notEqual(
    qortalStatusFingerprint(base),
    qortalStatusFingerprint(qortalStatus({
      capabilities: { canCheckRelease: true, canInitialInstall: false, canUpdate: false },
    })),
  )
  assert.notEqual(
    qortalStatusFingerprint(base),
    qortalStatusFingerprint(qortalStatus({ install: 'adopted' })),
  )
  assert.notEqual(
    qortalStatusFingerprint(base),
    qortalStatusFingerprint(qortalStatus({ updateAuthority: 'node-native' })),
  )
  assert.equal(
    qortalStatusFingerprint(base),
    qortalStatusFingerprint(qortalStatus({
      lastRelease: qortalRelease(),
      lastReleaseCheckedAt: '2026-08-25T00:00:00.000Z',
    })),
    'a newly cached release must not invalidate the panel state',
  )
}

// --- Qortal adoption candidate preference --------------------------------
{
  const single = adoptionList({
    candidates: [{
      candidateId: 'a', hubHint: true, origins: ['qortal-hub'],
      runningProcessMatch: false, version: '6.2.0',
    }],
  })
  assert.equal(preferredQortalCandidate(single), 'a', 'a lone supported candidate preselects')

  const unsupportedOnly = adoptionList({
    candidates: [{
      candidateId: 'a', hubHint: true, origins: ['qortal-hub'],
      runningProcessMatch: false, version: null,
    }],
  })
  assert.equal(preferredQortalCandidate(unsupportedOnly), null)

  const two = adoptionList({
    candidates: [
      { candidateId: 'a', hubHint: true, origins: ['qortal-hub'], runningProcessMatch: false, version: '6.2.0' },
      { candidateId: 'b', hubHint: false, origins: ['running-process'], runningProcessMatch: true, version: '6.1.0' },
    ],
  })
  assert.equal(preferredQortalCandidate(two), null, 'ambiguity must be resolved by the user')

  const browsed = adoptionList({
    candidates: [
      { candidateId: 'a', hubHint: true, origins: ['qortal-hub'], runningProcessMatch: false, version: '6.2.0' },
      { candidateId: 'b', hubHint: false, origins: ['user-selected'], runningProcessMatch: false, version: '6.1.0' },
    ],
  })
  assert.equal(preferredQortalCandidate(browsed), null)
  assert.equal(
    preferredQortalCandidate(browsed, true),
    'b',
    'the folder the user just picked is the one they meant',
  )

  assert.equal(preferredQortalCandidate(adoptionList({ canSelect: false, candidates: single.candidates })), null)
  assert.equal(
    preferredQortalCandidate(adoptionList({ candidates: single.candidates, canSelect: false, state: 'incomplete' })),
    null,
  )
}

// --- Qortal messages ------------------------------------------------------
{
  assert.match(qortalReleaseMessage(qortalRelease({ action: 'initial-install' })), /v6\.2\.0/)
  assert.match(qortalReleaseMessage(qortalRelease({ code: 'up-to-date' })), /v6\.2\.0/)
  assert.notEqual(
    qortalReleaseMessage(qortalRelease({ available: false, code: null })),
    qortalReleaseMessage(qortalRelease({ code: 'up-to-date' })),
    'an unverifiable release must not read as up to date',
  )
  assert.notEqual(
    qortalReleaseMessage(qortalRelease({ action: 'initial-install' })),
    qortalReleaseMessage(qortalRelease({ action: 'strict-update' })),
    'install and update offers must read differently',
  )
  assert.notEqual(
    qortalActionMessage(qortalActionResult()),
    qortalActionMessage(qortalActionResult({ warning: 'cleanup-incomplete' })),
    'a cleanup warning must not read as a clean completion',
  )
  assert.notEqual(
    qortalActionMessage(qortalActionResult({ code: 'release-changed', outcome: 'blocked' })),
    qortalActionMessage(qortalActionResult({ code: 'runtime-not-stopped', outcome: 'blocked' })),
  )
}

// --- Transport fingerprint and mode capability ----------------------------
{
  const base = transportStatus()
  assert.equal(transportStatusFingerprint(base), transportStatusFingerprint(transportStatus()))
  assert.notEqual(
    transportStatusFingerprint(base),
    transportStatusFingerprint(transportStatus({ transportMode: 'direct-and-i2p' })),
  )
  assert.notEqual(
    transportStatusFingerprint(base),
    transportStatusFingerprint(transportStatus({
      router: { maintenance: 'update', state: 'managed-running', version: '2.50.0' },
    })),
  )

  assert.equal(canSetTransportMode(base, 'direct-and-i2p'), true)
  assert.equal(canSetTransportMode(base, 'direct-only'), true)
  assert.equal(canSetTransportMode(base, 'i2p-only'), false)

  assert.notEqual(
    transportActionMessage('set-mode', transportActionResult()),
    transportActionMessage('ensure-router', transportActionResult()),
    'a saved mode and a started router must not share one message',
  )
  assert.equal(
    transportActionMessage('set-mode', transportActionResult({ warning: 'cleanup-incomplete' })),
    transportActionMessage('ensure-router', transportActionResult({ warning: 'cleanup-incomplete' })),
  )
  assert.notEqual(
    transportActionMessage('ensure-router', transportActionResult({
      code: 'external-router-active', outcome: 'blocked',
    })),
    transportActionMessage('ensure-router', transportActionResult({
      code: 'core-runtime-not-stopped', outcome: 'blocked',
    })),
  )
}

// --- HomeV2CoreManagement builders ----------------------------------------
// The dashboard tile reads these slices; each action must reach the controller
// call the Settings panel would have made.
{
  const calls: string[] = []
  const coreMaintenance = {
    available: true,
    busy: 'check',
    check: async () => { calls.push('check') },
    initialLoadFailed: false,
    installJava: async () => { calls.push('install-java') },
    notice: null,
    policy: null,
    refresh: async () => { calls.push('refresh') },
    release: null,
    runCore: async () => { calls.push('run-core') },
    setUpdatePolicy: (field: string) => { calls.push(`policy:${field}`) },
    status: null,
  } as unknown as HomeV2CoreMaintenance

  const core = toHomeV2CoreMaintenanceManagement(coreMaintenance)
  assert.equal(core.busy, 'check')
  core.onCheckRelease?.()
  core.onRunRelease?.()
  core.onInstallJava?.()
  core.onSetUpdatePolicy?.('javaUpdatePolicy', 'install')
  assert.deepEqual(calls, ['check', 'run-core', 'install-java', 'policy:javaUpdatePolicy'])
}

{
  const calls: string[] = []
  const qortalMaintenance = {
    actionAllowed: true,
    busy: null,
    check: async () => { calls.push('check') },
    release: qortalRelease(),
    run: async () => { calls.push('run') },
    status: qortalStatus(),
  } as unknown as HomeV2QortalMaintenance

  const qortal = toHomeV2QortalMaintenanceManagement(qortalMaintenance)
  assert.equal(qortal.actionAllowed, true)
  assert.equal(qortal.release?.tag, 'v6.2.0')
  qortal.onCheckRelease?.()
  qortal.onRunRelease?.()
  assert.deepEqual(calls, ['check', 'run'])
}

{
  const calls: string[] = []
  const transport = {
    busy: null,
    currentMode: 'direct-only',
    run: async (action: string, mode: string | null) => { calls.push(`${action}:${mode}`) },
    stale: false,
    status: transportStatus(),
  } as unknown as HomeV2TransportMaintenance

  const slice = toHomeV2TransportManagement(transport)
  assert.equal(slice.mode, 'direct-only')
  assert.equal(slice.stale, false)
  slice.onEnsureRouter?.()
  slice.onSetTransportMode?.('direct-and-i2p')
  assert.deepEqual(calls, ['ensure-router:null', 'set-mode:direct-and-i2p'])
}

// Which write a mode change uses. A stopped Core edits the settings file; a
// running one goes through the node's API. Getting this backwards would either
// rewrite settings.json under a live Core or refuse a change that is now legal.
{
  const stopped = transportStatus()
  assert.equal(transportModeActionFor(stopped, 'direct-only'), 'set-mode')

  const running = transportStatus({
    capabilities: {
      canEnsureRouter: false,
    canRevealRouterFolder: false,
      canSetDirectAndI2p: false,
      canSetDirectOnly: false,
      canSetI2pOnly: false,
      canStopRouter: true,
      canSetModeWhileRunning: true,
    },
    core: { install: 'installed', runtime: 'running' },
    router: { maintenance: 'none', state: 'managed-running', version: '2.50.2' },
  })
  assert.equal(transportModeActionFor(running, 'direct-only'), 'set-mode-live')
  assert.equal(transportModeActionFor(running, 'i2p-only'), 'set-mode-live')

  // No router: an i2p mode would leave the node unable to connect after the
  // restart, so it is refused even though the live write itself is available.
  const runningNoRouter = transportStatus({
    capabilities: {
      canEnsureRouter: false,
    canRevealRouterFolder: false,
      canSetDirectAndI2p: false,
      canSetDirectOnly: false,
      canSetI2pOnly: false,
      canStopRouter: false,
      canSetModeWhileRunning: true,
    },
    core: { install: 'installed', runtime: 'running' },
    router: { maintenance: 'install', state: 'missing', version: null },
  })
  assert.equal(transportModeActionFor(runningNoRouter, 'direct-only'), 'set-mode-live')
  assert.equal(transportModeActionFor(runningNoRouter, 'i2p-only'), null)

  // Neither write available.
  const unknown = transportStatus({
    capabilities: {
      canEnsureRouter: false,
    canRevealRouterFolder: false,
      canSetDirectAndI2p: false,
      canSetDirectOnly: false,
      canSetI2pOnly: false,
      canStopRouter: false,
      canSetModeWhileRunning: false,
    },
    core: { install: 'installed', runtime: 'unknown' },
  })
  assert.equal(transportModeActionFor(unknown, 'direct-only'), null)
}

console.log('Home v2 maintenance controller tests passed.')
