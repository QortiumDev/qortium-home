import type {
  CoreManagerEntry,
  QortiumCoreManagerEntry,
} from './core-manager.js'
import type { I2pdMaintenanceInspection } from './i2pd-manager.js'
import type {
  HomeV2TransportMaintenanceBlockedCode,
  HomeV2TransportMaintenanceDependencies,
  HomeV2TransportMaintenanceDependencyResult,
  HomeV2TransportMaintenanceIssue,
  HomeV2TransportMaintenanceLease,
  HomeV2TransportMaintenanceStatus,
  HomeV2TransportMode,
} from './home-v2-transport-maintenance-contract.js'

export type HomeV2TransportMaintenanceAdapterOperations = Readonly<{
  acquireInteractiveLease: () => HomeV2TransportMaintenanceLease | null
  inspectRouter: () => Promise<I2pdMaintenanceInspection>
  installRouter: () => Promise<unknown>
  resolveManager: () => CoreManagerEntry
  startRouter: () => Promise<unknown>
  stopManagedRouter: () => Promise<void>
}>

type CoreTarget = Readonly<{
  digest: string | null
  installPath: string
  jarPath: string
  runtimePath: string
  tagName: string
}>

type CoreGuard =
  | Readonly<{ kind: 'ready'; target: CoreTarget }>
  | Readonly<{ code: HomeV2TransportMaintenanceBlockedCode; kind: 'blocked' }>

function completed(): HomeV2TransportMaintenanceDependencyResult {
  return { code: null, kind: 'completed', warning: null }
}

function blocked(
  code: HomeV2TransportMaintenanceBlockedCode,
): HomeV2TransportMaintenanceDependencyResult {
  return { code, kind: 'blocked', warning: null }
}

function unconfirmed(): HomeV2TransportMaintenanceDependencyResult {
  return { code: 'action-unconfirmed', kind: 'unconfirmed', warning: null }
}

function resolveQortiumManager(
  resolveManager: () => CoreManagerEntry,
): QortiumCoreManagerEntry {
  const manager = resolveManager()
  if (manager.networkId !== 'qortium') throw new Error('Qortium Core manager is unavailable.')
  return manager
}

function coreTarget(managerStatus: Awaited<ReturnType<QortiumCoreManagerEntry['getStatus']>>) {
  const installed = managerStatus.installed
  if (!installed) return null
  return Object.freeze({
    digest: installed.digest,
    installPath: installed.installPath,
    jarPath: installed.jarPath,
    runtimePath: installed.runtimePath,
    tagName: installed.tagName,
  })
}

function sameCoreTarget(left: CoreTarget, right: CoreTarget) {
  return left.digest === right.digest && left.installPath === right.installPath &&
    left.jarPath === right.jarPath && left.runtimePath === right.runtimePath &&
    left.tagName === right.tagName
}

async function requireStronglyStoppedCore(
  manager: QortiumCoreManagerEntry,
  expectedTarget?: CoreTarget,
): Promise<CoreGuard> {
  let status: Awaited<ReturnType<QortiumCoreManagerEntry['getStatus']>>
  try {
    status = await manager.getStatus()
  } catch {
    return { code: 'status-unavailable', kind: 'blocked' }
  }
  const target = coreTarget(status)
  if (!target) {
    return expectedTarget
      ? { code: 'target-changed', kind: 'blocked' }
      : { code: 'core-install-missing', kind: 'blocked' }
  }
  if (expectedTarget && !sameCoreTarget(expectedTarget, target)) {
    return { code: 'target-changed', kind: 'blocked' }
  }

  let runtime: Awaited<ReturnType<QortiumCoreManagerEntry['getMaintenanceRuntimeStateForHomeV2']>>
  try {
    runtime = await manager.getMaintenanceRuntimeStateForHomeV2()
  } catch {
    return { code: 'core-runtime-unknown', kind: 'blocked' }
  }
  if (runtime === 'running') return { code: 'core-runtime-not-stopped', kind: 'blocked' }
  if (runtime !== 'stopped') return { code: 'core-runtime-unknown', kind: 'blocked' }
  return { kind: 'ready', target }
}

function boundedVersion(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null
}

function projectRouter(inspection: I2pdMaintenanceInspection): {
  issue: HomeV2TransportMaintenanceIssue | null
  router: HomeV2TransportMaintenanceStatus['router']
} {
  if (!inspection.supported || inspection.router === 'unsupported') {
    return {
      issue: 'unsupported-platform',
      router: { maintenance: 'unavailable', state: 'unsupported', version: null },
    }
  }
  if (inspection.router === 'external-running') {
    return {
      issue: null,
      router: { maintenance: 'none', state: 'external-running', version: null },
    }
  }
  if (inspection.router === 'missing' && inspection.install === 'missing') {
    return {
      issue: null,
      router: { maintenance: 'install', state: 'missing', version: null },
    }
  }
  if (inspection.router === 'managed-running' || inspection.router === 'managed-stopped') {
    const version = boundedVersion(inspection.installedVersion)
    if (inspection.install !== 'installed' || !version) {
      return {
        issue: 'version-unavailable',
        router: { maintenance: 'unavailable', state: 'unknown', version: null },
      }
    }
    return {
      issue: inspection.maintenance === 'unavailable' ? 'version-unavailable' : null,
      router: {
        maintenance: inspection.maintenance,
        state: inspection.router,
        version,
      },
    }
  }
  return {
    issue: 'version-unavailable',
    router: { maintenance: 'unavailable', state: 'unknown', version: null },
  }
}

function unavailableStatus(
  issue: Extract<HomeV2TransportMaintenanceIssue, 'manager-unavailable' | 'status-unavailable'>,
): HomeV2TransportMaintenanceStatus {
  return {
    capabilities: {
      canEnsureRouter: false,
      canSetDirectAndI2p: false,
      canSetDirectOnly: false,
      canSetI2pOnly: false,
      canSetModeWhileRunning: false,
      canStopRouter: false,
    },
    core: { install: 'unknown', runtime: 'unknown' },
    issue,
    network: 'qortium',
    revision: 1,
    router: { maintenance: 'unavailable', state: 'unknown', version: null },
    schema: 'home-v2-transport-maintenance',
    transportMode: 'unknown',
  }
}

async function readStatus(
  operations: HomeV2TransportMaintenanceAdapterOperations,
): Promise<HomeV2TransportMaintenanceStatus> {
  let manager: QortiumCoreManagerEntry
  try {
    manager = resolveQortiumManager(operations.resolveManager)
  } catch {
    return unavailableStatus('manager-unavailable')
  }

  try {
    const [managerStatus, runtime, mode, inspection] = await Promise.all([
      manager.getStatus(),
      manager.getMaintenanceRuntimeStateForHomeV2(),
      manager.getTransportModeForHomeV2(),
      operations.inspectRouter(),
    ])
    const install = managerStatus.installed ? 'installed' : 'missing'
    const transportMode = install === 'installed' ? mode : 'unknown'
    const projected = projectRouter(inspection)
    const fatalIssue = projected.issue === 'manager-unavailable' ||
      projected.issue === 'status-unavailable'
    const canChangeStoppedCore = install === 'installed' && runtime === 'stopped' &&
      transportMode !== 'unknown' && !fatalIssue
    const routerReady = projected.router.state === 'external-running' ||
      projected.router.state === 'managed-running'
    const canEnsureRouter = install === 'installed' && runtime === 'stopped' &&
      projected.issue === null && (
        projected.router.maintenance === 'install' ||
        projected.router.maintenance === 'start' ||
        projected.router.maintenance === 'update'
      )

    return {
      capabilities: {
        canEnsureRouter,
        canSetDirectAndI2p: canChangeStoppedCore && routerReady,
        canSetDirectOnly: canChangeStoppedCore,
        canSetI2pOnly: canChangeStoppedCore && routerReady,
        canSetModeWhileRunning: install === 'installed' && runtime === 'running' &&
          transportMode !== 'unknown' && !fatalIssue,
        canStopRouter: projected.router.state === 'managed-running' && !fatalIssue,
      },
      core: { install, runtime },
      issue: projected.issue,
      network: 'qortium',
      revision: 1,
      router: projected.router,
      schema: 'home-v2-transport-maintenance',
      transportMode,
    }
  } catch {
    return unavailableStatus('status-unavailable')
  }
}

async function ensureRouter(
  operations: HomeV2TransportMaintenanceAdapterOperations,
): Promise<HomeV2TransportMaintenanceDependencyResult> {
  const manager = resolveQortiumManager(operations.resolveManager)
  const initialCore = await requireStronglyStoppedCore(manager)
  if (initialCore.kind === 'blocked') return blocked(initialCore.code)

  let inspection = await operations.inspectRouter()
  if (inspection.router === 'external-running') return blocked('external-router-active')
  if (!inspection.supported || inspection.router === 'unsupported') {
    return blocked('router-unsupported')
  }
  if (inspection.router === 'unknown' || inspection.install === 'unknown' ||
    inspection.maintenance === 'unavailable') return blocked('status-unavailable')
  if (inspection.maintenance === 'none') return blocked('action-not-allowed')

  if (inspection.maintenance === 'update' &&
    (inspection.router === 'managed-running' || inspection.router === 'managed-stopped')) {
    const beforeStop = await requireStronglyStoppedCore(manager, initialCore.target)
    if (beforeStop.kind === 'blocked') return blocked(beforeStop.code)
    await operations.stopManagedRouter()
    inspection = await operations.inspectRouter()
    if (inspection.managedProcessActive) return unconfirmed()
    if (inspection.router === 'external-running') return blocked('external-router-active')
    if (inspection.router !== 'managed-stopped') return unconfirmed()
  }

  if (inspection.maintenance === 'install' || inspection.maintenance === 'update') {
    const beforeInstall = await requireStronglyStoppedCore(manager, initialCore.target)
    if (beforeInstall.kind === 'blocked') return blocked(beforeInstall.code)
    await operations.installRouter()
    inspection = await operations.inspectRouter()
    if (inspection.router === 'external-running') return blocked('external-router-active')
    if (inspection.router !== 'managed-stopped' && inspection.router !== 'managed-running') {
      return unconfirmed()
    }
  }

  if (inspection.router === 'managed-stopped') {
    const beforeStart = await requireStronglyStoppedCore(manager, initialCore.target)
    if (beforeStart.kind === 'blocked') return blocked(beforeStart.code)
    await operations.startRouter()
    inspection = await operations.inspectRouter()
    if (inspection.router !== 'managed-running' || !inspection.managedProcessActive) {
      return unconfirmed()
    }
  }

  const finalCore = await requireStronglyStoppedCore(manager, initialCore.target)
  if (finalCore.kind === 'blocked') return blocked(finalCore.code)
  return inspection.router === 'managed-running' && inspection.managedProcessActive
    ? completed()
    : unconfirmed()
}

async function setStoppedCoreTransportMode(
  operations: HomeV2TransportMaintenanceAdapterOperations,
  mode: Exclude<HomeV2TransportMode, 'unknown'>,
): Promise<HomeV2TransportMaintenanceDependencyResult> {
  const manager = resolveQortiumManager(operations.resolveManager)
  const initialCore = await requireStronglyStoppedCore(manager)
  if (initialCore.kind === 'blocked') return blocked(initialCore.code)

  if (mode !== 'direct-only') {
    const router = await operations.inspectRouter()
    if (router.router !== 'external-running' && router.router !== 'managed-running') {
      return blocked('i2p-router-required')
    }
  }

  const result = await manager.setTransportModeForHomeV2(mode)
  if (result.kind === 'blocked') return blocked(result.code)
  if (result.mode !== mode) return unconfirmed()
  if (mode !== 'direct-only') return completed()

  const inspection = await operations.inspectRouter().catch(() => null)
  if (!inspection) return unconfirmed()
  if (!inspection.managedProcessActive) return completed()

  const beforeStop = await requireStronglyStoppedCore(manager, initialCore.target)
  if (beforeStop.kind === 'blocked') return unconfirmed()
  await operations.stopManagedRouter()
  const confirmed = await operations.inspectRouter().catch(() => null)
  return confirmed && !confirmed.managedProcessActive ? completed() : unconfirmed()
}

/**
 * Change the mode on a running Core through its API, then report that a restart
 * is needed. Nothing here touches settings.json -- that is the stopped-Core path.
 */
async function setRunningCoreTransportMode(
  operations: HomeV2TransportMaintenanceAdapterOperations,
  mode: Exclude<HomeV2TransportMode, 'unknown'>,
): Promise<HomeV2TransportMaintenanceDependencyResult> {
  const manager = resolveQortiumManager(operations.resolveManager)
  const result = await manager.setRunningCoreTransportModeForHomeV2(mode)
  if (result.kind === 'blocked') return blocked(result.code)
  if (result.mode !== mode) return unconfirmed()
  return { code: null, kind: 'completed', warning: 'restart-required' }
}

async function stopRouter(
  operations: HomeV2TransportMaintenanceAdapterOperations,
): Promise<HomeV2TransportMaintenanceDependencyResult> {
  const inspection = await operations.inspectRouter().catch(() => null)
  if (!inspection) return unconfirmed()
  if (inspection.router === 'external-running') return blocked('external-router-active')
  if (!inspection.supported || inspection.router === 'unsupported') {
    return blocked('router-unsupported')
  }
  if (!inspection.managedProcessActive) return completed()

  await operations.stopManagedRouter()
  const confirmed = await operations.inspectRouter().catch(() => null)
  return confirmed && !confirmed.managedProcessActive ? completed() : unconfirmed()
}

export function createHomeV2TransportMaintenanceDependencies(
  operations: HomeV2TransportMaintenanceAdapterOperations,
): HomeV2TransportMaintenanceDependencies {
  return {
    acquireInteractiveLease: operations.acquireInteractiveLease,
    ensureRouter: async () => await ensureRouter(operations),
    readStatus: async () => await readStatus(operations),
    setStoppedCoreTransportMode: async (mode) =>
      await setStoppedCoreTransportMode(operations, mode),
    setRunningCoreTransportMode: async (mode) =>
      await setRunningCoreTransportMode(operations, mode),
    stopRouter: async () => await stopRouter(operations),
  }
}
