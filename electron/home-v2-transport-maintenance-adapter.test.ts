import assert from 'node:assert/strict'
import type { I2pdMaintenanceInspection } from './i2pd-manager.js'
import { createHomeV2TransportMaintenanceDependencies } from './home-v2-transport-maintenance-adapter.js'

type CoreTarget = {
  digest: string | null
  installPath: string
  jarPath: string
  runtimePath: string
  tagName: string
}

const CORE_TARGET: CoreTarget = {
  digest: 'sha256:core-a',
  installPath: '/managed/core-a',
  jarPath: '/managed/core-a/qortal.jar',
  runtimePath: '/managed/core-a/runtime',
  tagName: 'v1.2.3',
}

function router(
  overrides: Partial<I2pdMaintenanceInspection> = {},
): I2pdMaintenanceInspection {
  const routerState = overrides.router ?? 'managed-running'
  return {
    install: 'installed',
    installedVersion: '2.60.0-q2',
    managedProcessActive: routerState === 'managed-running',
    maintenance: 'none',
    router: routerState,
    supported: true,
    ...overrides,
  }
}

function harness(options: {
  inspections?: I2pdMaintenanceInspection[]
  runtimeStates?: Array<'running' | 'stopped' | 'unknown'>
  setModeResult?: (mode: 'direct-and-i2p' | 'direct-only' | 'i2p-only') => unknown
  targets?: Array<CoreTarget | null>
} = {}) {
  const events: string[] = []
  const inspections = [...(options.inspections ?? [])]
  const runtimeStates = [...(options.runtimeStates ?? ['stopped'])]
  const targets = [...(options.targets ?? [CORE_TARGET])]
  let inspectionIndex = 0
  let runtimeIndex = 0
  let targetIndex = 0

  const manager = {
    networkId: 'qortium' as const,
    async getStatus() {
      events.push('core-status')
      const installed = targets[Math.min(targetIndex, targets.length - 1)] ?? null
      targetIndex += 1
      return { installed }
    },
    async getMaintenanceRuntimeStateForHomeV2() {
      events.push('core-runtime')
      const state = runtimeStates[Math.min(runtimeIndex, runtimeStates.length - 1)] ?? 'unknown'
      runtimeIndex += 1
      return state
    },
    async getTransportModeForHomeV2() {
      return 'direct-and-i2p' as const
    },
    async setTransportModeForHomeV2(
      mode: 'direct-and-i2p' | 'direct-only' | 'i2p-only',
    ) {
      events.push(`set:${mode}`)
      return options.setModeResult?.(mode) ?? { kind: 'completed', mode }
    },
  }

  const dependencies = createHomeV2TransportMaintenanceDependencies({
    acquireInteractiveLease: () => ({ release() {} }),
    async inspectRouter() {
      events.push('inspect')
      const inspection = inspections[inspectionIndex]
      inspectionIndex += 1
      if (!inspection) throw new Error('Unexpected router inspection.')
      return inspection
    },
    async installRouter() {
      events.push('install')
    },
    resolveManager: () => manager as never,
    revealManagedRouter: async () => true,
    async startRouter() {
      events.push('start')
    },
    async stopManagedRouter() {
      events.push('stop')
    },
    async updateRouter(restartPreviousOnFailure) {
      events.push(`update:${restartPreviousOnFailure}`)
    },
  })

  return { dependencies, events }
}

const runningCore = harness({
  inspections: [router({
    install: 'missing',
    installedVersion: null,
    maintenance: 'install',
    router: 'missing',
  })],
  runtimeStates: ['running'],
})
assert.deepEqual(await runningCore.dependencies.ensureRouter(), {
  code: 'core-runtime-not-stopped',
  kind: 'blocked',
  warning: null,
})
assert.deepEqual(runningCore.events, ['inspect', 'core-status', 'core-runtime'])

const runningCoreStart = harness({
  inspections: [
    router({ maintenance: 'start', router: 'managed-stopped' }),
    router(),
  ],
  runtimeStates: ['running', 'running', 'running'],
})
assert.deepEqual(await runningCoreStart.dependencies.ensureRouter(), {
  code: null,
  kind: 'completed',
  warning: null,
})
assert.deepEqual(
  runningCoreStart.events.filter((event) => ['install', 'start'].includes(event)),
  ['start'],
)

const runningCoreOldReleaseStart = harness({
  inspections: [
    router({ maintenance: 'update', router: 'managed-stopped' }),
    router({ maintenance: 'update', router: 'managed-running' }),
  ],
  runtimeStates: ['running', 'running', 'running'],
})
assert.deepEqual(await runningCoreOldReleaseStart.dependencies.ensureRouter(), {
  code: null,
  kind: 'completed',
  warning: null,
})
assert.deepEqual(
  runningCoreOldReleaseStart.events.filter((event) =>
    event === 'install' || event === 'start' || event.startsWith('update:')),
  ['start'],
  'starting a trusted old release must not silently update it',
)

const legacyMigration = harness({
  inspections: [
    router({ install: 'legacy', maintenance: 'migrate', router: 'legacy-stopped' }),
    router({ maintenance: 'start', router: 'managed-stopped' }),
    router(),
  ],
  runtimeStates: ['stopped', 'stopped', 'stopped', 'stopped'],
})
assert.deepEqual(await legacyMigration.dependencies.ensureRouter(), {
  code: null,
  kind: 'completed',
  warning: null,
})
assert.deepEqual(
  legacyMigration.events.filter((event) => ['install', 'start'].includes(event)),
  ['install', 'start'],
)

const unknownCore = harness({ runtimeStates: ['unknown'] })
assert.deepEqual(
  await unknownCore.dependencies.setStoppedCoreTransportMode('direct-only'),
  { code: 'core-runtime-unknown', kind: 'blocked', warning: null },
)
assert.deepEqual(unknownCore.events, ['core-status', 'core-runtime'])

const changedTarget: CoreTarget = {
  ...CORE_TARGET,
  digest: 'sha256:core-b',
  installPath: '/managed/core-b',
  jarPath: '/managed/core-b/qortal.jar',
  runtimePath: '/managed/core-b/runtime',
  tagName: 'v1.2.4',
}
const targetRace = harness({
  inspections: [router({ maintenance: 'update', router: 'managed-stopped' })],
  targets: [CORE_TARGET, changedTarget],
})
assert.deepEqual(await targetRace.dependencies.updateRouter(), {
  code: 'target-changed',
  kind: 'blocked',
  warning: null,
})
assert.equal(targetRace.events.includes('stop'), false)
assert.equal(targetRace.events.some((event) => event.startsWith('update:')), false)

const managedUpdate = harness({
  inspections: [
    router({ maintenance: 'update' }),
    router({ maintenance: 'update', router: 'managed-stopped' }),
    router({ installedVersion: '2.61.0-q1' }),
  ],
  runtimeStates: ['stopped', 'stopped', 'stopped'],
})
assert.deepEqual(await managedUpdate.dependencies.updateRouter(), {
  code: null,
  kind: 'completed',
  warning: null,
})
assert.deepEqual(
  managedUpdate.events.filter((event) => event === 'stop' || event.startsWith('update:')),
  ['stop', 'update:true'],
)
assert.equal(managedUpdate.events.filter((event) => event === 'core-runtime').length, 3)

const stoppedManagedUpdate = harness({
  inspections: [
    router({ maintenance: 'update', router: 'managed-stopped' }),
    router({ installedVersion: '2.61.0-q1' }),
  ],
  runtimeStates: ['stopped', 'stopped', 'stopped'],
})
assert.deepEqual(await stoppedManagedUpdate.dependencies.updateRouter(), {
  code: null,
  kind: 'completed',
  warning: null,
})
assert.deepEqual(
  stoppedManagedUpdate.events.filter((event) => event === 'stop' || event.startsWith('update:')),
  ['update:false'],
)

const unconfirmedUpdateStop = harness({
  inspections: [
    router({ maintenance: 'update' }),
    router({ maintenance: 'update' }),
  ],
  runtimeStates: ['stopped'],
})
assert.deepEqual(await unconfirmedUpdateStop.dependencies.updateRouter(), {
  code: 'action-unconfirmed',
  kind: 'unconfirmed',
  warning: null,
})
assert.equal(
  unconfirmedUpdateStop.events.some((event) => event.startsWith('update:')),
  false,
)

const externalEnsure = harness({
  inspections: [router({
    install: 'missing',
    installedVersion: null,
    router: 'external-running',
  })],
})
assert.deepEqual(await externalEnsure.dependencies.ensureRouter(), {
  code: 'external-router-active',
  kind: 'blocked',
  warning: null,
})
assert.equal(externalEnsure.events.includes('stop'), false)
assert.equal(externalEnsure.events.includes('install'), false)
assert.equal(externalEnsure.events.includes('start'), false)

const directOnlyManaged = harness({
  inspections: [router(), router({ maintenance: 'start', router: 'managed-stopped' })],
  runtimeStates: ['stopped', 'stopped'],
})
assert.deepEqual(
  await directOnlyManaged.dependencies.setStoppedCoreTransportMode('direct-only'),
  { code: null, kind: 'completed', warning: null },
)

const directOnlyUnready = harness({
  inspections: [
    router({ managedProcessActive: true, router: 'managed-stopped' }),
    router({ maintenance: 'start', router: 'managed-stopped' }),
  ],
  runtimeStates: ['stopped', 'stopped'],
})
assert.deepEqual(
  await directOnlyUnready.dependencies.setStoppedCoreTransportMode('direct-only'),
  { code: null, kind: 'completed', warning: null },
)
assert.equal(directOnlyUnready.events.includes('stop'), true)
assert.deepEqual(
  directOnlyManaged.events.filter((event) => event.startsWith('set:') || event === 'stop'),
  ['set:direct-only', 'stop'],
)

const directOnlyExternal = harness({
  inspections: [router({ installedVersion: null, router: 'external-running' })],
})
assert.deepEqual(
  await directOnlyExternal.dependencies.setStoppedCoreTransportMode('direct-only'),
  { code: null, kind: 'completed', warning: null },
)
assert.equal(directOnlyExternal.events.includes('stop'), false)

const unconfirmedUpdate = harness({
  inspections: [
    router({ maintenance: 'update', router: 'managed-stopped' }),
    router({ maintenance: 'update', router: 'managed-stopped' }),
  ],
  runtimeStates: ['stopped', 'stopped', 'stopped'],
})
assert.deepEqual(await unconfirmedUpdate.dependencies.updateRouter(), {
  code: 'action-unconfirmed',
  kind: 'unconfirmed',
  warning: null,
})
assert.deepEqual(
  unconfirmedUpdate.events.filter((event) => event === 'stop' || event.startsWith('update:')),
  ['update:false'],
)

const unconfirmedStart = harness({
  inspections: [
    router({ maintenance: 'start', router: 'managed-stopped' }),
    router({ maintenance: 'start', router: 'managed-stopped' }),
  ],
})
assert.deepEqual(await unconfirmedStart.dependencies.ensureRouter(), {
  code: 'action-unconfirmed',
  kind: 'unconfirmed',
  warning: null,
})
assert.deepEqual(
  unconfirmedStart.events.filter((event) => event === 'stop' || event === 'install' || event === 'start'),
  ['start'],
)

const unconfirmedDirectOnlyStop = harness({ inspections: [router(), router()] })
assert.deepEqual(
  await unconfirmedDirectOnlyStop.dependencies.setStoppedCoreTransportMode('direct-only'),
  { code: 'action-unconfirmed', kind: 'unconfirmed', warning: null },
)

// The reveal capability follows what Home KNOWS, not what it is willing to say.
// A managed router has a folder Home installed and can point at; an external one
// is reached through a SAM port and Home never learns its executable, so there
// is nothing to open.
{
  const managed = harness({ inspections: [router({ router: 'managed-running' })] })
  const managedStatus = await managed.dependencies.readStatus() as {
    capabilities: { canRevealRouterFolder: boolean }
  }
  assert.equal(managedStatus.capabilities.canRevealRouterFolder, true)

  const stopped = harness({ inspections: [router({ router: 'managed-stopped' })] })
  const stoppedStatus = await stopped.dependencies.readStatus() as {
    capabilities: { canRevealRouterFolder: boolean }
  }
  assert.equal(
    stoppedStatus.capabilities.canRevealRouterFolder,
    true,
    'an installed router that is not running still has a folder',
  )

  const external = harness({
    inspections: [router({ installedVersion: null, router: 'external-running' })],
  })
  const externalStatus = await external.dependencies.readStatus() as {
    capabilities: { canRevealRouterFolder: boolean }
  }
  assert.equal(
    externalStatus.capabilities.canRevealRouterFolder,
    false,
    'Home never learns an external router\'s executable, so there is nothing to reveal',
  )
}

console.log('Home v2 transport maintenance adapter tests passed.')
