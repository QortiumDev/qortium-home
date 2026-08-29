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
  version?: string | null
}>

function status(options: StatusOptions = {}): HomeV2TransportMaintenanceStatus {
  const coreInstall = options.coreInstall ?? 'installed'
  const coreRuntime = options.coreRuntime ?? 'stopped'
  const issue = options.issue ?? null
  const maintenance = options.maintenance ?? 'install'
  const mode = options.mode ?? 'direct-only'
  const routerState = options.routerState ?? 'missing'
  const version = options.version ?? null
  const fatalIssue = issue === 'manager-unavailable' || issue === 'status-unavailable'
  const canChange = coreInstall === 'installed' && coreRuntime === 'stopped' &&
    mode !== 'unknown' && !fatalIssue
  const routerReady = routerState === 'external-running' || routerState === 'managed-running'
  const canEnsureRouter = coreInstall === 'installed' && coreRuntime === 'stopped' && issue === null &&
    ['install', 'start', 'update'].includes(maintenance)
  return {
    capabilities: {
      canEnsureRouter,
      canSetDirectAndI2p: canChange && routerReady,
      canSetDirectOnly: canChange,
      canSetI2pOnly: canChange && routerReady,
      canStopRouter: routerState === 'managed-running' && !fatalIssue,
    },
    core: { install: coreInstall, runtime: coreRuntime },
    issue,
    network: 'qortium',
    revision: 1,
    router: { maintenance, state: routerState, version },
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
  action: 'ensure-router' | 'set-mode' | 'stop-router',
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
    setStoppedCoreTransportMode: async () => ({
      code: null,
      kind: 'completed',
      warning: null,
    } as const),
    stopRouter: async () => ({ code: null, kind: 'completed', warning: null } as const),
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
  { ...status(), capabilities: { ...status().capabilities, canSetI2pOnly: true } },
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

console.log('Home v2 transport maintenance contract tests passed.')


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
