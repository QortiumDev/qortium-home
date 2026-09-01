import type { IpcMainInvokeEvent } from 'electron'

export type HomeV2TransportMode =
  | 'direct-and-i2p'
  | 'direct-only'
  | 'i2p-only'
  | 'unknown'

export type HomeV2TransportRouterState =
  | 'external-running'
  | 'managed-running'
  | 'managed-stopped'
  | 'missing'
  | 'unsupported'
  | 'unknown'

export type HomeV2TransportRouterMaintenance =
  | 'install'
  | 'migrate'
  | 'none'
  | 'start'
  | 'unavailable'
  | 'update'

export type HomeV2TransportSamState = 'ready' | 'unavailable' | 'unknown'

export type HomeV2TransportMaintenanceIssue =
  | 'manager-unavailable'
  | 'status-unavailable'
  | 'unsupported-platform'
  | 'version-unavailable'

export type HomeV2TransportMaintenanceStatus = {
  readonly capabilities: {
    readonly canEnsureRouter: boolean
    readonly canSetDirectAndI2p: boolean
    readonly canSetDirectOnly: boolean
    readonly canSetI2pOnly: boolean
    /**
     * Whether the managed router can be stopped right now.
     *
     * Home 1.x had an explicit start/stop i2pd button. Home 2 shipped only
     * `ensure-router` (start) and `set-mode`, so stopping was reachable only as
     * an invisible side effect of choosing `direct-only`. This restores the
     * other half of the control.
     */
    /**
     * Whether there is a router folder Home can open. True only for a MANAGED
     * router: an external one is reached through a SAM port and Home never
     * learns its executable, so there is nothing to reveal.
     */
    readonly canRevealRouterFolder: boolean
    readonly canStopRouter: boolean
    /** A newer trusted release can be installed while Core is stopped. */
    readonly canUpdateRouter: boolean
    /**
     * Whether the mode can be changed on a RUNNING Core, through its API.
     *
     * The file-writing path needs Core stopped, because it replaces
     * settings.json on disk. This one PATCHes the node instead, which is safe
     * while it runs, and reports `restart-required` because allowedTransports
     * only takes effect on restart.
     */
    readonly canSetModeWhileRunning: boolean
  }
  readonly core: {
    readonly install: 'installed' | 'missing' | 'unknown'
    readonly runtime: 'running' | 'stopped' | 'unknown'
  }
  readonly issue: HomeV2TransportMaintenanceIssue | null
  readonly network: 'qortium'
  readonly revision: 2
  readonly router: {
    readonly maintenance: HomeV2TransportRouterMaintenance
    /** Local SAM v3 handshake result; independent of managed-process state. */
    readonly sam: HomeV2TransportSamState
    readonly state: HomeV2TransportRouterState
    readonly version: string | null
  }
  readonly schema: 'home-v2-transport-maintenance'
  readonly transportMode: HomeV2TransportMode
}

export type HomeV2TransportMaintenanceAction =
  | 'ensure-router'
  | 'reveal-router'
  | 'set-mode'
  | 'set-mode-live'
  | 'stop-router'
  | 'update-router'

export type HomeV2TransportMaintenanceActionCode =
  | 'action-not-allowed'
  | 'action-unconfirmed'
  | 'core-install-missing'
  | 'core-runtime-not-running'
  | 'core-runtime-not-stopped'
  | 'core-runtime-unknown'
  | 'external-router-active'
  | 'i2p-router-required'
  | 'operation-failed'
  | 'operation-in-progress'
  | 'router-unsupported'
  | 'status-unavailable'
  | 'target-changed'

export type HomeV2TransportMaintenanceWarning = 'cleanup-incomplete' | 'restart-required'

export type HomeV2TransportMaintenanceBlockedCode = Exclude<
  HomeV2TransportMaintenanceActionCode,
  'action-unconfirmed' | 'operation-failed' | 'operation-in-progress'
>

export type HomeV2TransportMaintenanceActionResult = {
  readonly code: HomeV2TransportMaintenanceActionCode | null
  readonly network: 'qortium'
  readonly outcome: 'blocked' | 'completed' | 'failed' | 'unconfirmed'
  readonly revision: 1
  readonly schema: 'home-v2-transport-maintenance-action'
  readonly status: HomeV2TransportMaintenanceStatus
  readonly warning: HomeV2TransportMaintenanceWarning | null
}

export type HomeV2TransportMaintenanceDependencyResult =
  | Readonly<{
      code: null
      kind: 'completed'
      warning: HomeV2TransportMaintenanceWarning | null
    }>
  | Readonly<{
      code: HomeV2TransportMaintenanceBlockedCode
      kind: 'blocked'
      warning: null
    }>
  | Readonly<{
      code: 'action-unconfirmed'
      kind: 'unconfirmed'
      warning: null
    }>

export type HomeV2TransportMaintenanceLease = Readonly<{
  release(): void
}>

export type HomeV2TransportMaintenanceDependencies = {
  readonly acquireInteractiveLease: () => HomeV2TransportMaintenanceLease | null
  readonly ensureRouter: () => Promise<HomeV2TransportMaintenanceDependencyResult>
  readonly readStatus: () => Promise<unknown>
  readonly revealRouterFolder: () => Promise<HomeV2TransportMaintenanceDependencyResult>
  readonly setStoppedCoreTransportMode: (
    mode: Exclude<HomeV2TransportMode, 'unknown'>,
  ) => Promise<HomeV2TransportMaintenanceDependencyResult>
  readonly setRunningCoreTransportMode: (
    mode: Exclude<HomeV2TransportMode, 'unknown'>,
  ) => Promise<HomeV2TransportMaintenanceDependencyResult>
  readonly stopRouter: () => Promise<HomeV2TransportMaintenanceDependencyResult>
  readonly updateRouter: () => Promise<HomeV2TransportMaintenanceDependencyResult>
}

type MutationRequest = Readonly<{
  action: HomeV2TransportMaintenanceAction
  transportMode: HomeV2TransportMode | null
}>

const ACTION_CODES = new Set<HomeV2TransportMaintenanceActionCode>([
  'action-not-allowed',
  'action-unconfirmed',
  'core-install-missing',
  'core-runtime-not-running',
  'core-runtime-not-stopped',
  'core-runtime-unknown',
  'external-router-active',
  'i2p-router-required',
  'operation-failed',
  'operation-in-progress',
  'router-unsupported',
  'status-unavailable',
  'target-changed',
])
const BLOCKED_DEPENDENCY_CODES = new Set<HomeV2TransportMaintenanceActionCode>([
  'action-not-allowed',
  'core-install-missing',
  'core-runtime-not-running',
  'core-runtime-not-stopped',
  'core-runtime-unknown',
  'external-router-active',
  'i2p-router-required',
  'router-unsupported',
  'status-unavailable',
  'target-changed',
])
const ISSUES = new Set<HomeV2TransportMaintenanceIssue>([
  'manager-unavailable',
  'status-unavailable',
  'unsupported-platform',
  'version-unavailable',
])
const MODES = new Set<HomeV2TransportMode>([
  'direct-and-i2p',
  'direct-only',
  'i2p-only',
  'unknown',
])
const ROUTER_MAINTENANCE = new Set<HomeV2TransportRouterMaintenance>([
  'install',
  'migrate',
  'none',
  'start',
  'unavailable',
  'update',
])
const ROUTER_STATES = new Set<HomeV2TransportRouterState>([
  'external-running',
  'managed-running',
  'managed-stopped',
  'missing',
  'unsupported',
  'unknown',
])
const SAM_STATES = new Set<HomeV2TransportSamState>([
  'ready',
  'unavailable',
  'unknown',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isBoundedPrintableVersion(value: unknown): value is string | null {
  return value === null || (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function normalizeStatus(value: unknown): HomeV2TransportMaintenanceStatus | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'capabilities',
    'core',
    'issue',
    'network',
    'revision',
    'router',
    'schema',
    'transportMode',
  ]) || value.schema !== 'home-v2-transport-maintenance' || value.revision !== 2 ||
    value.network !== 'qortium' || !MODES.has(value.transportMode as HomeV2TransportMode) ||
    !(value.issue === null || ISSUES.has(value.issue as HomeV2TransportMaintenanceIssue)) ||
    !isRecord(value.core) || !hasExactKeys(value.core, ['install', 'runtime']) ||
    !['installed', 'missing', 'unknown'].includes(String(value.core.install)) ||
    !['running', 'stopped', 'unknown'].includes(String(value.core.runtime)) ||
    !isRecord(value.router) || !hasExactKeys(value.router, ['maintenance', 'sam', 'state', 'version']) ||
    !ROUTER_STATES.has(value.router.state as HomeV2TransportRouterState) ||
    !ROUTER_MAINTENANCE.has(value.router.maintenance as HomeV2TransportRouterMaintenance) ||
    !SAM_STATES.has(value.router.sam as HomeV2TransportSamState) ||
    !isBoundedPrintableVersion(value.router.version) ||
    !isRecord(value.capabilities) || !hasExactKeys(value.capabilities, [
      'canEnsureRouter',
      'canRevealRouterFolder',
      'canSetDirectAndI2p',
      'canSetDirectOnly',
      'canSetI2pOnly',
      'canSetModeWhileRunning',
      'canStopRouter',
      'canUpdateRouter',
    ]) || Object.values(value.capabilities).some((entry) => typeof entry !== 'boolean')) {
    return null
  }

  const issue = value.issue as HomeV2TransportMaintenanceIssue | null
  const install = value.core.install as HomeV2TransportMaintenanceStatus['core']['install']
  const runtime = value.core.runtime as HomeV2TransportMaintenanceStatus['core']['runtime']
  const routerState = value.router.state as HomeV2TransportRouterState
  const maintenance = value.router.maintenance as HomeV2TransportRouterMaintenance
  const sam = value.router.sam as HomeV2TransportSamState
  const transportMode = value.transportMode as HomeV2TransportMode
  const version = value.router.version as string | null
  const capabilities = value.capabilities as Record<string, boolean>
  const fatalIssue = issue === 'manager-unavailable' || issue === 'status-unavailable'
  const routerReady = sam === 'ready'
  const canChangeStoppedCore = install === 'installed' && runtime === 'stopped' &&
    transportMode !== 'unknown' && !fatalIssue
  const expectedCanStop = routerState === 'managed-running' && !fatalIssue
  const expectedCanUpdate = install === 'installed' && runtime === 'stopped' &&
    maintenance === 'update' && issue === null &&
    (routerState === 'managed-running' || routerState === 'managed-stopped')
  // Re-derived here, like every other capability, so a status claiming a folder
  // can be opened for an EXTERNAL router is rejected rather than displayed.
  const expectedCanReveal = routerState === 'managed-running' ||
    (routerState === 'managed-stopped' && maintenance !== 'migrate')
  const expectedCanSetLive = install === 'installed' && runtime === 'running' &&
    transportMode !== 'unknown' && !fatalIssue
  const expectedCanEnsure = install === 'installed' && issue === null && (
    (routerState === 'managed-stopped' &&
      (maintenance === 'start' || maintenance === 'update') &&
      (runtime === 'running' || runtime === 'stopped')) ||
    ((maintenance === 'install' || maintenance === 'migrate') && runtime === 'stopped')
  )

  const routerShapeCoherent = routerState === 'external-running'
    ? maintenance === 'none' && version === null
    : routerState === 'managed-running'
      ? version !== null && (maintenance === 'none' || maintenance === 'update' || maintenance === 'unavailable')
      : routerState === 'managed-stopped'
        ? version !== null && (maintenance === 'migrate' || maintenance === 'start' ||
          maintenance === 'update' || maintenance === 'unavailable')
        : routerState === 'missing'
          ? maintenance === 'install' && version === null
          : maintenance === 'unavailable' && version === null
  const samShapeCoherent = routerState === 'external-running'
    ? sam === 'ready'
    : routerState === 'managed-running'
      ? true
      : routerState === 'unsupported'
        ? sam === 'unknown'
        : sam !== 'ready'

  if (!routerShapeCoherent || !samShapeCoherent ||
    ((routerState === 'unsupported') !== (issue === 'unsupported-platform')) ||
    (issue === 'version-unavailable' && !(
      routerState === 'unknown' ||
      ((routerState === 'managed-running' || routerState === 'managed-stopped') &&
        maintenance === 'unavailable')
    )) ||
    (routerState === 'unknown' && issue === null) ||
    (fatalIssue && (
      install !== 'unknown' || runtime !== 'unknown' || transportMode !== 'unknown' ||
      routerState !== 'unknown'
    )) ||
    (install !== 'installed' && transportMode !== 'unknown') ||
    (capabilities.canEnsureRouter !== expectedCanEnsure) ||
    (capabilities.canSetDirectOnly !== canChangeStoppedCore) ||
    (capabilities.canSetDirectAndI2p !== (canChangeStoppedCore && routerReady)) ||
    (capabilities.canSetI2pOnly !== (canChangeStoppedCore && routerReady)) ||
    (capabilities.canRevealRouterFolder !== expectedCanReveal) ||
    (capabilities.canStopRouter !== expectedCanStop) ||
    (capabilities.canUpdateRouter !== expectedCanUpdate) ||
    (capabilities.canSetModeWhileRunning !== expectedCanSetLive)) {
    return null
  }

  return Object.freeze({
    capabilities: Object.freeze({
      canEnsureRouter: capabilities.canEnsureRouter,
      canRevealRouterFolder: capabilities.canRevealRouterFolder,
      canSetDirectAndI2p: capabilities.canSetDirectAndI2p,
      canSetDirectOnly: capabilities.canSetDirectOnly,
      canSetI2pOnly: capabilities.canSetI2pOnly,
      canSetModeWhileRunning: capabilities.canSetModeWhileRunning,
      canStopRouter: capabilities.canStopRouter,
      canUpdateRouter: capabilities.canUpdateRouter,
    }),
    core: Object.freeze({ install, runtime }),
    issue,
    network: 'qortium',
    revision: 2,
    router: Object.freeze({ maintenance, sam, state: routerState, version }),
    schema: 'home-v2-transport-maintenance',
    transportMode,
  })
}

function unavailableStatus(): HomeV2TransportMaintenanceStatus {
  return Object.freeze({
    capabilities: Object.freeze({
      canEnsureRouter: false,
      canRevealRouterFolder: false,
      canSetDirectAndI2p: false,
      canSetDirectOnly: false,
      canSetI2pOnly: false,
      canSetModeWhileRunning: false,
      canStopRouter: false,
      canUpdateRouter: false,
    }),
    core: Object.freeze({ install: 'unknown', runtime: 'unknown' }),
    issue: 'status-unavailable',
    network: 'qortium',
    revision: 2,
    router: Object.freeze({
      maintenance: 'unavailable',
      sam: 'unknown',
      state: 'unknown',
      version: null,
    }),
    schema: 'home-v2-transport-maintenance',
    transportMode: 'unknown',
  })
}

function normalizeStatusRequest(value: unknown) {
  if (!isRecord(value) || !hasExactKeys(value, ['network', 'revision', 'schema']) ||
    value.schema !== 'home-v2-transport-maintenance-request' || value.revision !== 1 ||
    value.network !== 'qortium') {
    throw new Error('An exact Qortium transport maintenance request is required.')
  }
}

function normalizeMutationRequest(value: unknown): MutationRequest {
  if (!isRecord(value) || !hasExactKeys(value, [
    'action', 'network', 'revision', 'schema', 'transportMode',
  ]) || value.schema !== 'home-v2-transport-maintenance-mutation-request' ||
    value.revision !== 1 || value.network !== 'qortium' ||
    (value.action !== 'ensure-router' && value.action !== 'reveal-router' &&
      value.action !== 'set-mode' && value.action !== 'set-mode-live' &&
      value.action !== 'stop-router' && value.action !== 'update-router') ||
    !(value.transportMode === null || (
      MODES.has(value.transportMode as HomeV2TransportMode) && value.transportMode !== 'unknown'
    )) ||
    ((value.action === 'ensure-router' || value.action === 'reveal-router' ||
      value.action === 'stop-router' || value.action === 'update-router') &&
      value.transportMode !== null) ||
    ((value.action === 'set-mode' || value.action === 'set-mode-live') &&
      value.transportMode === null)) {
    throw new Error('An exact Qortium transport maintenance mutation request is required.')
  }
  return {
    action: value.action,
    transportMode: value.transportMode as HomeV2TransportMode | null,
  }
}

function preflightCode(
  request: MutationRequest,
  status: HomeV2TransportMaintenanceStatus,
): HomeV2TransportMaintenanceActionCode | null {
  if (status.issue === 'manager-unavailable' || status.issue === 'status-unavailable') {
    return 'status-unavailable'
  }
  if (status.core.install === 'missing') return 'core-install-missing'
  if (status.core.install === 'unknown') return 'status-unavailable'
  if (status.core.runtime === 'unknown') return 'core-runtime-unknown'

  // Opening a folder changes nothing, so it is gated only on there BEING a
  // managed folder -- not on the core being stopped, which the mutating actions
  // below require.
  if (request.action === 'reveal-router') {
    return status.capabilities.canRevealRouterFolder ? null : 'action-not-allowed'
  }

  if (request.action === 'stop-router') {
    if (status.router.state === 'external-running') return 'external-router-active'
    if (status.router.state === 'unsupported') return 'router-unsupported'
    return status.capabilities.canStopRouter ? null : 'action-not-allowed'
  }

  if (request.action === 'update-router') {
    if (status.router.state === 'external-running') return 'external-router-active'
    if (status.router.state === 'unsupported') return 'router-unsupported'
    if (status.core.runtime !== 'stopped') return 'core-runtime-not-stopped'
    return status.capabilities.canUpdateRouter ? null : 'action-not-allowed'
  }

  if (request.action === 'set-mode-live') {
    // Deliberately the mirror image of the file path's gate: this one requires a
    // RUNNING Core, because it writes through the node's API rather than its
    // settings file. The i2p modes still need a router, or the node would come
    // back after the restart unable to reach anything.
    if (!status.capabilities.canSetModeWhileRunning) {
      return status.core.runtime === 'stopped' ? 'core-runtime-not-running' : 'action-not-allowed'
    }
    if (request.transportMode !== 'direct-only' &&
      status.router.state !== 'managed-running' && status.router.state !== 'external-running') {
      return 'i2p-router-required'
    }
    return null
  }

  if (request.action === 'ensure-router') {
    if (status.router.state === 'external-running') return 'external-router-active'
    if (status.router.state === 'unsupported') return 'router-unsupported'
    if (status.core.runtime !== 'stopped' &&
      status.router.maintenance !== 'start' && status.router.maintenance !== 'update') {
      return 'core-runtime-not-stopped'
    }
    return status.capabilities.canEnsureRouter ? null : 'action-not-allowed'
  }

  if (status.core.runtime !== 'stopped') return 'core-runtime-not-stopped'
  const mode = request.transportMode
  if (mode === 'direct-only') {
    return status.capabilities.canSetDirectOnly ? null : 'action-not-allowed'
  }
  if (mode === 'direct-and-i2p') {
    return status.capabilities.canSetDirectAndI2p ? null : 'i2p-router-required'
  }
  if (mode === 'i2p-only') {
    return status.capabilities.canSetI2pOnly ? null : 'i2p-router-required'
  }
  return 'action-not-allowed'
}

function normalizeDependencyResult(value: unknown): HomeV2TransportMaintenanceDependencyResult | null {
  if (!isRecord(value) || !hasExactKeys(value, ['code', 'kind', 'warning']) ||
    !(value.warning === null || value.warning === 'cleanup-incomplete' ||
      value.warning === 'restart-required') ||
    !(value.code === null || ACTION_CODES.has(value.code as HomeV2TransportMaintenanceActionCode))) {
    return null
  }
  if (value.kind === 'completed' && value.code === null) {
    return { code: null, kind: 'completed', warning: value.warning }
  }
  if (value.kind === 'unconfirmed' && value.code === 'action-unconfirmed' && value.warning === null) {
    return { code: 'action-unconfirmed', kind: 'unconfirmed', warning: null }
  }
  if (value.kind === 'blocked' && value.warning === null &&
    BLOCKED_DEPENDENCY_CODES.has(value.code as HomeV2TransportMaintenanceActionCode)) {
    return {
      code: value.code as HomeV2TransportMaintenanceBlockedCode,
      kind: 'blocked',
      warning: null,
    }
  }
  return null
}

function actionResult(
  status: HomeV2TransportMaintenanceStatus,
  outcome: HomeV2TransportMaintenanceActionResult['outcome'],
  code: HomeV2TransportMaintenanceActionResult['code'],
  warning: HomeV2TransportMaintenanceWarning | null = null,
): HomeV2TransportMaintenanceActionResult {
  return Object.freeze({
    code,
    network: 'qortium',
    outcome,
    revision: 1,
    schema: 'home-v2-transport-maintenance-action',
    status,
    warning,
  })
}

function mappedDependencyResult(
  value: unknown,
  status: HomeV2TransportMaintenanceStatus,
  request: MutationRequest,
): HomeV2TransportMaintenanceActionResult {
  const normalized = normalizeDependencyResult(value)
  if (!normalized) return actionResult(status, 'failed', 'operation-failed')
  if (normalized.kind === 'completed') {
    const confirmed = request.action === 'reveal-router'
      // Nothing in the status changes when a folder is opened, so there is
      // nothing to confirm against. The main process already reported whether it
      // opened one.
      ? status.issue !== 'manager-unavailable' && status.issue !== 'status-unavailable'
      : request.action === 'ensure-router'
      ? status.issue === null && status.router.state === 'managed-running' &&
        (status.router.maintenance === 'none' || status.router.maintenance === 'update')
      : request.action === 'update-router'
      ? status.issue === null && status.router.state === 'managed-running' &&
        status.router.maintenance === 'none'
      : request.action === 'set-mode-live'
      // The node stored the value; it does not take effect until Core restarts,
      // so there is nothing in the status yet that could confirm the mode.
      ? status.issue !== 'manager-unavailable' && status.issue !== 'status-unavailable'
      : request.action === 'stop-router'
      ? status.issue !== 'manager-unavailable' && status.issue !== 'status-unavailable' &&
        status.router.state !== 'managed-running'
      : status.core.runtime === 'stopped' && status.transportMode === request.transportMode &&
        status.issue !== 'manager-unavailable' && status.issue !== 'status-unavailable' &&
        (request.transportMode === 'direct-only' ||
          status.router.state === 'managed-running' || status.router.state === 'external-running')
    if (!confirmed) return actionResult(status, 'unconfirmed', 'action-unconfirmed')
    return actionResult(status, 'completed', null, normalized.warning)
  }
  if (normalized.kind === 'unconfirmed') {
    return actionResult(status, 'unconfirmed', 'action-unconfirmed')
  }
  return actionResult(status, 'blocked', normalized.code)
}

export function createHomeV2TransportMaintenanceService(
  dependencies: HomeV2TransportMaintenanceDependencies,
) {
  const readStatus = async () => {
    try {
      return normalizeStatus(await dependencies.readStatus()) ?? unavailableStatus()
    } catch {
      return unavailableStatus()
    }
  }

  return {
    async getStatus(value: unknown) {
      normalizeStatusRequest(value)
      return await readStatus()
    },
    async runAction(value: unknown) {
      const request = normalizeMutationRequest(value)
      let lease: HomeV2TransportMaintenanceLease | null
      try {
        lease = dependencies.acquireInteractiveLease()
      } catch {
        return actionResult(await readStatus(), 'failed', 'operation-failed')
      }
      if (!lease) {
        return actionResult(await readStatus(), 'blocked', 'operation-in-progress')
      }

      try {
        const preflight = await readStatus()
        const blocked = preflightCode(request, preflight)
        if (blocked) return actionResult(preflight, 'blocked', blocked)

        let dependencyResult: unknown
        try {
          dependencyResult = request.action === 'reveal-router'
            ? await dependencies.revealRouterFolder()
            : request.action === 'ensure-router'
            ? await dependencies.ensureRouter()
            : request.action === 'update-router'
            ? await dependencies.updateRouter()
            : request.action === 'stop-router'
            ? await dependencies.stopRouter()
            : request.action === 'set-mode-live'
            ? await dependencies.setRunningCoreTransportMode(
                request.transportMode as Exclude<HomeV2TransportMode, 'unknown'>,
              )
            : await dependencies.setStoppedCoreTransportMode(
                request.transportMode as Exclude<HomeV2TransportMode, 'unknown'>,
              )
        } catch {
          return actionResult(await readStatus(), 'failed', 'operation-failed')
        }
        return mappedDependencyResult(dependencyResult, await readStatus(), request)
      } finally {
        try {
          lease.release()
        } catch {
          // A lease cleanup failure must not leak a private cause to the renderer.
        }
      }
    },
  }
}

export function createAuthorizedHomeV2TransportMaintenanceHandlers(
  assertAuthorized: (event: IpcMainInvokeEvent) => void,
  service: ReturnType<typeof createHomeV2TransportMaintenanceService>,
) {
  return {
    getStatus(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.getStatus(value)
    },
    runAction(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.runAction(value)
    },
  }
}
