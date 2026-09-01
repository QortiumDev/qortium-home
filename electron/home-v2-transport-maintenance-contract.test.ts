import assert from 'node:assert/strict'
import type { IpcMainInvokeEvent } from 'electron'
import {
  createAuthorizedHomeV2TransportMaintenanceHandlers,
  createHomeV2TransportMaintenanceService,
  type HomeV2TransportMaintenanceDependencies,
  type HomeV2TransportMaintenanceIssue,
  type HomeV2TransportMaintenanceStatus,
  type HomeV2TransportMode,
  type HomeV2TransportRouterMaintenance,
  type HomeV2TransportRouterState,
} from './home-v2-transport-maintenance-contract.js'

type StatusOptions = Readonly<{
  coreInstall?: HomeV2TransportMaintenanceStatus['core']['install']
  coreRuntime?: HomeV2TransportMaintenanceStatus['core']['runtime']
  issue?: HomeV2TransportMaintenanceIssue | null
  maintenance?: HomeV2TransportRouterMaintenance
  mode?: HomeV2TransportMode
  routerState?: HomeV2TransportRouterState
  sam?: HomeV2TransportMaintenanceStatus['router']['sam']
  version?: string | null
}>

function status(options: StatusOptions = {}): HomeV2TransportMaintenanceStatus {
  const coreInstall = options.coreInstall ?? 'installed'
  const coreRuntime = options.coreRuntime ?? 'stopped'
  const issue = options.issue ?? null
  const maintenance = options.maintenance ?? 'install'
  const mode = options.mode ?? 'direct-only'
  const routerState = options.routerState ?? 'missing'
  const sam = options.sam ?? (
    routerState === 'managed-running' || routerState === 'external-running'
      ? 'ready'
      : routerState === 'unsupported' || routerState === 'unknown'
        ? 'unknown'
        : 'unavailable'
  )
  const version = options.version ?? null
  const fatalIssue = issue === 'manager-unavailable' || issue === 'status-unavailable'
  const canChange = coreInstall === 'installed' && coreRuntime === 'stopped' &&
    mode !== 'unknown' && !fatalIssue
  const routerReady = sam === 'ready'
  const canEnsureRouter = coreInstall === 'installed' && issue === null && (
    (routerState === 'managed-stopped' && ['start', 'update'].includes(maintenance) &&
      coreRuntime !== 'unknown') ||
    (['install', 'migrate'].includes(maintenance) && coreRuntime === 'stopped')
  )
  return {
    capabilities: {
      canEnsureRouter,
      canRevealRouterFolder: routerState === 'managed-running' ||
        (routerState === 'managed-stopped' && maintenance !== 'migrate'),
      canSetDirectAndI2p: canChange && routerReady,
      canSetDirectOnly: canChange,
      canSetI2pOnly: canChange && routerReady,
      canStopRouter: routerState === 'managed-running' && !fatalIssue,
      canSetModeWhileRunning: coreInstall === 'installed' && coreRuntime === 'running' &&
        mode !== 'unknown' && !fatalIssue,
      canUpdateRouter: coreInstall === 'installed' && coreRuntime === 'stopped' &&
        issue === null && maintenance === 'update' &&
        (routerState === 'managed-running' || routerState === 'managed-stopped'),
    },
    core: { install: coreInstall, runtime: coreRuntime },
    issue,
    network: 'qortium',
    revision: 2,
    router: { maintenance, sam, state: routerState, version },
    schema: 'home-v2-transport-maintenance',
    transportMode: mode,
  }
}

const unavailableStatus = status({
  coreInstall: 'unknown',
  coreRuntime: 'unknown',
  issue: 'status-unavailable',
  maintenance: 'unavailable',
  mode: 'unknown',
  routerState: 'unknown',
})

function statusRequest(extra: Record<string, unknown> = {}) {
  return {
    network: 'qortium',
    revision: 1,
    schema: 'home-v2-transport-maintenance-request',
    ...extra,
  }
}

function mutationRequest(
  action: 'ensure-router' | 'reveal-router' | 'set-mode' | 'set-mode-live' |
    'stop-router' | 'update-router',
  transportMode: Exclude<HomeV2TransportMode, 'unknown'> | null,
  extra: Record<string, unknown> = {},
) {
  return {
    action,
    network: 'qortium',
    revision: 1,
    schema: 'home-v2-transport-maintenance-mutation-request',
    transportMode,
    ...extra,
  }
}

function dependencies(overrides: Partial<HomeV2TransportMaintenanceDependencies> = {}) {
  return {
    acquireInteractiveLease: () => ({ release() {} }),
    ensureRouter: async () => ({ code: null, kind: 'completed', warning: null } as const),
    readStatus: async () => status(),
    revealRouterFolder: async () => ({ code: null, kind: 'completed' as const, warning: null }),
    setStoppedCoreTransportMode: async () => ({
      code: null,
      kind: 'completed',
      warning: null,
    } as const),
    setRunningCoreTransportMode: async () =>
      ({ code: null, kind: 'completed', warning: 'restart-required' } as const),
    stopRouter: async () => ({ code: null, kind: 'completed', warning: null } as const),
    updateRouter: async () => ({ code: null, kind: 'completed', warning: null } as const),
    ...overrides,
  } satisfies HomeV2TransportMaintenanceDependencies
}

function assertRedacted(value: unknown) {
  const serialized = JSON.stringify(value)
  for (const forbidden of [
    '/secret',
    'apiKey',
    'binaryPath',
    'cause',
    'digest',
    'download',
    'externalBinaryPath',
    'pid',
    'reason',
    'record',
    'runtimePath',
    'samHost',
    'samPort',
    'url',
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, 'i'))
  }
}

{
  let reads = 0
  let leases = 0
  const service = createHomeV2TransportMaintenanceService(dependencies({
    acquireInteractiveLease: () => { leases += 1; return { release() {} } },
    readStatus: async () => { reads += 1; return status() },
  }))
  await assert.rejects(service.getStatus(statusRequest({ extra: true })), /exact Qortium transport/i)
  await assert.rejects(service.getStatus({ ...statusRequest(), network: 'qortal' }), /exact Qortium transport/i)
  await assert.rejects(
    service.runAction(mutationRequest('ensure-router', 'direct-only')),
    /exact Qortium transport maintenance mutation/i,
  )
  await assert.rejects(
    service.runAction(mutationRequest('set-mode', null)),
    /exact Qortium transport maintenance mutation/i,
  )
  await assert.rejects(
    service.runAction({ ...mutationRequest('set-mode', 'direct-only'), transportMode: 'unknown' }),
    /exact Qortium transport maintenance mutation/i,
  )
  await assert.rejects(
    service.runAction({ ...mutationRequest('set-mode', 'direct-only'), network: 'qortal' }),
    /exact Qortium transport maintenance mutation/i,
  )
  await assert.rejects(
    service.runAction(mutationRequest('set-mode', 'direct-only', { privatePath: '/secret' })),
    /exact Qortium transport maintenance mutation/i,
  )
  assert.equal(reads, 0)
  assert.equal(leases, 0)
}

{
  let serviceCalls = 0
  const handlers = createAuthorizedHomeV2TransportMaintenanceHandlers(
    () => { throw new Error('unauthorized') },
    {
      getStatus: async () => { serviceCalls += 1; return unavailableStatus },
      runAction: async () => { serviceCalls += 1; return {} as never },
    },
  )
  assert.throws(
    () => handlers.runAction({} as IpcMainInvokeEvent, { raw: '/secret' }),
    /unauthorized/,
  )
  assert.equal(serviceCalls, 0, 'authorization must run before parsing or dependency lookup')
}

{
  const expected = status()
  const service = createHomeV2TransportMaintenanceService(dependencies({
    readStatus: async () => expected,
  }))
  const actual = await service.getStatus(statusRequest())
  assert.deepEqual(actual, expected)
  assert.deepEqual(Object.keys(actual).sort(), [
    'capabilities',
    'core',
    'issue',
    'network',
    'revision',
    'router',
    'schema',
    'transportMode',
  ])
  assert.equal(Object.isFrozen(actual), true)
  assert.equal(Object.isFrozen(actual.capabilities), true)
  assert.equal(Object.isFrozen(actual.core), true)
  assert.equal(Object.isFrozen(actual.router), true)
  assertRedacted(actual)
}

for (const malformed of [
  { ...status(), privatePath: '/secret/router' },
  { ...status(), router: { ...status().router, version: 'x'.repeat(129) } },
  { ...status(), router: { ...status().router, version: 'bad\nversion' } },
  { ...status(), router: { ...status().router, sam: 'invalid' } },
  status({ maintenance: 'none', routerState: 'external-running', sam: 'unavailable' }),
  status({ routerState: 'missing', sam: 'ready' }),
  { ...status(), capabilities: { ...status().capabilities, canSetI2pOnly: true } },
  (() => {
    const update = status({
      maintenance: 'update',
      routerState: 'managed-stopped',
      version: '2.60.0-q2',
    })
    return { ...update, capabilities: { ...update.capabilities, canUpdateRouter: false } }
  })(),
  status({ maintenance: 'none', routerState: 'missing' }),
  status({ issue: null, maintenance: 'unavailable', mode: 'unknown', routerState: 'unknown' }),
] as unknown[]) {
  const actual = await createHomeV2TransportMaintenanceService(dependencies({
    readStatus: async () => malformed,
  })).getStatus(statusRequest())
  assert.deepEqual(actual, unavailableStatus)
  assertRedacted(actual)
}

{
  const processUpSamDown = status({
    maintenance: 'none',
    mode: 'direct-and-i2p',
    routerState: 'managed-running',
    sam: 'unavailable',
    version: '2.60.0-q2',
  })
  assert.equal(processUpSamDown.capabilities.canStopRouter, true)
  assert.equal(processUpSamDown.capabilities.canEnsureRouter, false)
  assert.equal(processUpSamDown.capabilities.canSetDirectAndI2p, false)
  assert.equal(processUpSamDown.capabilities.canSetI2pOnly, false)
  const actual = await createHomeV2TransportMaintenanceService(dependencies({
    readStatus: async () => processUpSamDown,
  })).getStatus(statusRequest())
  assert.deepEqual(actual, processUpSamDown)
}

{
  let mutations = 0
  const service = createHomeV2TransportMaintenanceService(dependencies({
    acquireInteractiveLease: () => null,
    ensureRouter: async () => {
      mutations += 1
      return { code: null, kind: 'completed', warning: null }
    },
  }))
  const result = await service.runAction(mutationRequest('ensure-router', null))
  assert.equal(result.outcome, 'blocked')
  assert.equal(result.code, 'operation-in-progress')
  assert.equal(mutations, 0)
  assertRedacted(result)
}

{
  let released = 0
  let reads = 0
  let ensures = 0
  const finalStatus = status({
    maintenance: 'none',
    mode: 'direct-and-i2p',
    routerState: 'managed-running',
    version: '2.60.0-q2',
  })
  const service = createHomeV2TransportMaintenanceService(dependencies({
    acquireInteractiveLease: () => ({ release: () => { released += 1 } }),
    ensureRouter: async () => {
      ensures += 1
      return { code: null, kind: 'completed', warning: 'cleanup-incomplete' }
    },
    readStatus: async () => (++reads === 1 ? status() : finalStatus),
  }))
  const result = await service.runAction(mutationRequest('ensure-router', null))
  assert.equal(result.outcome, 'completed')
  assert.equal(result.code, null)
  assert.equal(result.warning, 'cleanup-incomplete')
  assert.deepEqual(result.status, finalStatus)
  assert.deepEqual(Object.keys(result).sort(), [
    'code',
    'network',
    'outcome',
    'revision',
    'schema',
    'status',
    'warning',
  ])
  assert.equal(reads, 2, 'status must be refreshed after mutation')
  assert.equal(ensures, 1)
  assert.equal(released, 1)
  assertRedacted(result)
}

{
  let selectedMode: string | null = null
  let released = 0
  const ready = status({
    maintenance: 'none',
    mode: 'direct-and-i2p',
    routerState: 'external-running',
  })
  let reads = 0
  const result = await createHomeV2TransportMaintenanceService(dependencies({
    acquireInteractiveLease: () => ({ release: () => { released += 1 } }),
    readStatus: async () => (++reads === 1 ? ready : status({
      maintenance: 'none',
      mode: 'i2p-only',
      routerState: 'external-running',
    })),
    setStoppedCoreTransportMode: async (mode) => {
      selectedMode = mode
      return { code: null, kind: 'completed', warning: null }
    },
  })).runAction(mutationRequest('set-mode', 'i2p-only'))
  assert.equal(selectedMode, 'i2p-only')
  assert.equal(result.outcome, 'completed')
  assert.equal(released, 1)
}

for (const [request, finalStatus] of [
  [mutationRequest('ensure-router', null), status()],
  [
    mutationRequest('set-mode', 'i2p-only'),
    status({ maintenance: 'none', routerState: 'external-running' }),
  ],
] as const) {
  let reads = 0
  const preflight = request.action === 'ensure-router'
    ? status()
    : status({ maintenance: 'none', routerState: 'external-running' })
  const result = await createHomeV2TransportMaintenanceService(dependencies({
    readStatus: async () => (++reads === 1 ? preflight : finalStatus),
  })).runAction(request)
  assert.equal(result.outcome, 'unconfirmed')
  assert.equal(result.code, 'action-unconfirmed')
  assertRedacted(result)
}

for (const [preflight, action, mode, expectedCode] of [
  [status(), 'set-mode', 'i2p-only', 'i2p-router-required'],
  [status({ coreRuntime: 'running' }), 'set-mode', 'direct-only', 'core-runtime-not-stopped'],
  [status({
    coreRuntime: 'running',
    maintenance: 'migrate',
    routerState: 'managed-stopped',
    version: '2.60.0-q2',
  }), 'ensure-router', null, 'core-runtime-not-stopped'],
  [status({ coreInstall: 'missing', mode: 'unknown' }), 'ensure-router', null, 'core-install-missing'],
  [status({
    maintenance: 'none',
    routerState: 'external-running',
  }), 'ensure-router', null, 'external-router-active'],
  [status({
    issue: 'unsupported-platform',
    maintenance: 'unavailable',
    routerState: 'unsupported',
  }), 'ensure-router', null, 'router-unsupported'],
  [status(), 'stop-router', null, 'action-not-allowed'],
  [status({
    maintenance: 'none',
    routerState: 'external-running',
  }), 'stop-router', null, 'external-router-active'],
] as const) {
  let mutationCalls = 0
  const result = await createHomeV2TransportMaintenanceService(dependencies({
    ensureRouter: async () => {
      mutationCalls += 1
      return { code: null, kind: 'completed', warning: null }
    },
    readStatus: async () => preflight,
    setStoppedCoreTransportMode: async () => {
      mutationCalls += 1
      return { code: null, kind: 'completed', warning: null }
    },
  })).runAction(mutationRequest(action, mode))
  assert.equal(result.outcome, 'blocked')
  assert.equal(result.code, expectedCode)
  assert.equal(mutationCalls, 0)
}

{
  let reads = 0
  let starts = 0
  const starting = status({
    coreRuntime: 'running',
    maintenance: 'start',
    routerState: 'managed-stopped',
    version: '2.60.0-q2',
  })
  const running = status({
    coreRuntime: 'running',
    maintenance: 'none',
    routerState: 'managed-running',
    version: '2.60.0-q2',
  })
  const result = await createHomeV2TransportMaintenanceService(dependencies({
    ensureRouter: async () => {
      starts += 1
      return { code: null, kind: 'completed', warning: null }
    },
    readStatus: async () => (++reads === 1 ? starting : running),
  })).runAction(mutationRequest('ensure-router', null))
  assert.equal(starts, 1)
  assert.equal(result.outcome, 'completed')
  assert.equal(result.code, null)
}

// A trusted old release remains independently startable. Its update offer is
// retained after startup instead of being consumed as an implicit update.
{
  let reads = 0
  let starts = 0
  let updates = 0
  const stoppedOld = status({
    coreRuntime: 'running',
    maintenance: 'update',
    routerState: 'managed-stopped',
    version: '2.60.0-q2',
  })
  const runningOld = status({
    coreRuntime: 'running',
    maintenance: 'update',
    routerState: 'managed-running',
    version: '2.60.0-q2',
  })
  assert.equal(stoppedOld.capabilities.canEnsureRouter, true)
  assert.equal(stoppedOld.capabilities.canUpdateRouter, false)
  const result = await createHomeV2TransportMaintenanceService(dependencies({
    ensureRouter: async () => {
      starts += 1
      return { code: null, kind: 'completed', warning: null }
    },
    readStatus: async () => (++reads === 1 ? stoppedOld : runningOld),
    updateRouter: async () => {
      updates += 1
      return { code: null, kind: 'completed', warning: null }
    },
  })).runAction(mutationRequest('ensure-router', null))
  assert.equal(result.outcome, 'completed')
  assert.equal(result.status.router.maintenance, 'update')
  assert.equal(starts, 1)
  assert.equal(updates, 0)
}

// Updating is a separate stopped-Core mutation and is confirmed only after the
// new release is the managed running router with no update still pending.
{
  let reads = 0
  let updates = 0
  const oldRelease = status({
    maintenance: 'update',
    routerState: 'managed-running',
    version: '2.60.0-q2',
  })
  const newRelease = status({
    maintenance: 'none',
    routerState: 'managed-running',
    version: '2.61.0-q1',
  })
  assert.equal(oldRelease.capabilities.canUpdateRouter, true)
  const result = await createHomeV2TransportMaintenanceService(dependencies({
    readStatus: async () => (++reads === 1 ? oldRelease : newRelease),
    updateRouter: async () => {
      updates += 1
      return { code: null, kind: 'completed', warning: null }
    },
  })).runAction(mutationRequest('update-router', null))
  assert.equal(result.outcome, 'completed')
  assert.equal(result.status.router.version, '2.61.0-q1')
  assert.equal(updates, 1)
}

{
  let updates = 0
  const runningCore = status({
    coreRuntime: 'running',
    maintenance: 'update',
    routerState: 'managed-running',
    version: '2.60.0-q2',
  })
  const result = await createHomeV2TransportMaintenanceService(dependencies({
    readStatus: async () => runningCore,
    updateRouter: async () => {
      updates += 1
      return { code: null, kind: 'completed', warning: null }
    },
  })).runAction(mutationRequest('update-router', null))
  assert.equal(result.outcome, 'blocked')
  assert.equal(result.code, 'core-runtime-not-stopped')
  assert.equal(updates, 0)
}

for (const [dependencyResult, outcome, code] of [
  [{ code: 'target-changed', kind: 'blocked', warning: null }, 'blocked', 'target-changed'],
  [{ code: 'action-unconfirmed', kind: 'unconfirmed', warning: null }, 'unconfirmed', 'action-unconfirmed'],
] as const) {
  let released = 0
  const result = await createHomeV2TransportMaintenanceService(dependencies({
    acquireInteractiveLease: () => ({ release: () => { released += 1 } }),
    ensureRouter: async () => dependencyResult,
  })).runAction(mutationRequest('ensure-router', null))
  assert.equal(result.outcome, outcome)
  assert.equal(result.code, code)
  assert.equal(released, 1)
  assertRedacted(result)
}

{
  let reads = 0
  let released = 0
  const result = await createHomeV2TransportMaintenanceService(dependencies({
    acquireInteractiveLease: () => ({ release: () => { released += 1 } }),
    ensureRouter: async () => { throw new Error('/secret cause') },
    readStatus: async () => { reads += 1; return status() },
  })).runAction(mutationRequest('ensure-router', null))
  assert.equal(result.outcome, 'failed')
  assert.equal(result.code, 'operation-failed')
  assert.equal(reads, 2, 'status must be refreshed after a thrown mutation')
  assert.equal(released, 1)
  assertRedacted(result)
}

{
  const result = await createHomeV2TransportMaintenanceService(dependencies({
    acquireInteractiveLease: () => { throw new Error('/secret lease cause') },
  })).runAction(mutationRequest('ensure-router', null))
  assert.equal(result.outcome, 'failed')
  assert.equal(result.code, 'operation-failed')
  assertRedacted(result)
}

{
  const result = await createHomeV2TransportMaintenanceService(dependencies({
    acquireInteractiveLease: () => ({ release: () => { throw new Error('/secret release cause') } }),
    ensureRouter: async () => ({
      cause: '/secret',
      code: null,
      kind: 'completed',
      warning: null,
    } as never),
  })).runAction(mutationRequest('ensure-router', null))
  assert.equal(result.outcome, 'failed')
  assert.equal(result.code, 'operation-failed')
  assertRedacted(result)
}


// Stopping the managed router must NOT require a stopped Core. Home 1.x let you stop
// i2pd at any time; the blanket core-runtime gate the other actions carry is
// undocumented, and applying it here would leave the router unstoppable while Core runs
// — which is exactly when a user reaches for the button.
{
  let stopCalls = 0
  const running = status({
    coreRuntime: 'running',
    maintenance: 'none',
    mode: 'direct-and-i2p',
    routerState: 'managed-running',
    version: '2.50.2',
  })
  assert.equal(running.capabilities.canStopRouter, true)
  const service = createHomeV2TransportMaintenanceService(dependencies({
    readStatus: async () => running,
    stopRouter: async () => {
      stopCalls += 1
      return { code: null, kind: 'completed', warning: null } as const
    },
  }))
  const result = await service.runAction(mutationRequest('stop-router', null))
  assert.equal(stopCalls, 1, 'stop-router must reach the dependency while Core is running')
  assert.notEqual(result.code, 'core-runtime-not-stopped')
  assertRedacted(result)
}


// A running Core takes the API path. The settings-FILE path still refuses to run
// while Core is up -- that gate protects a three-times-rechecked file replacement
// and is deliberately untouched. These two must not be confused for each other.
{
  const running = status({
    coreRuntime: 'running',
    maintenance: 'none',
    mode: 'direct-and-i2p',
    routerState: 'managed-running',
    version: '2.50.2',
  })
  assert.equal(running.capabilities.canSetModeWhileRunning, true)
  assert.equal(running.capabilities.canSetDirectOnly, false,
    'the settings-file write must stay unavailable while Core runs')

  let liveCalls = 0
  let fileCalls = 0
  const service = createHomeV2TransportMaintenanceService(dependencies({
    readStatus: async () => running,
    setRunningCoreTransportMode: async () => {
      liveCalls += 1
      return { code: null, kind: 'completed', warning: 'restart-required' } as const
    },
    setStoppedCoreTransportMode: async () => {
      fileCalls += 1
      return { code: null, kind: 'completed', warning: null } as const
    },
  }))

  const live = await service.runAction(mutationRequest('set-mode-live', 'direct-only'))
  assert.equal(liveCalls, 1)
  assert.equal(fileCalls, 0, 'the live path must never touch the settings file')
  assert.equal(live.outcome, 'completed')
  assert.equal(live.warning, 'restart-required',
    'the caller needs to know the mode is stored but not yet in effect')
  assertRedacted(live)

  // and the file path is still refused on the same running Core
  const viaFile = await service.runAction(mutationRequest('set-mode', 'direct-only'))
  assert.equal(viaFile.outcome, 'blocked')
  assert.equal(viaFile.code, 'core-runtime-not-stopped')
  assert.equal(fileCalls, 0)
}

// A stopped Core cannot take the live path.
{
  let liveCalls = 0
  const service = createHomeV2TransportMaintenanceService(dependencies({
    readStatus: async () => status({ maintenance: 'none', routerState: 'managed-running', version: '2.50.2' }),
    setRunningCoreTransportMode: async () => {
      liveCalls += 1
      return { code: null, kind: 'completed', warning: 'restart-required' } as const
    },
  }))
  const result = await service.runAction(mutationRequest('set-mode-live', 'direct-only'))
  assert.equal(result.outcome, 'blocked')
  assert.equal(result.code, 'core-runtime-not-running')
  assert.equal(liveCalls, 0)
}


console.log('Home v2 transport maintenance contract tests passed.')
