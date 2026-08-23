import type { IpcMainInvokeEvent } from 'electron'
import type { CoreManagerEntry } from './core-manager.js'
import type {
  QortalCoreManagerStatus,
  QortalManagerBlockCode,
  QortalStartResult,
  QortalStopResult,
} from './qortal-core-manager.js'
import { compareCoreVersions } from './core-version.js'
import { homeV2CoreOperationCoordinator } from './home-v2-core-operation-coordinator.js'

export type HomeV2CoreNetwork = 'qortal' | 'qortium'
export type HomeV2CoreInstallKind =
  | 'adopted'
  | 'home-managed'
  | 'missing'
  | 'unknown'
export type HomeV2CoreRuntimeState = 'running' | 'stopped' | 'unknown'
export type HomeV2CoreControl =
  | 'api-only'
  | 'full'
  | 'none'
  | 'observe-only'
export type HomeV2CoreIssueCode =
  | 'install-missing'
  | 'install-unknown'
  | 'manager-unavailable'
  | 'runtime-blocked'
  | 'runtime-unknown'
  | 'status-unavailable'
  | 'unsupported-platform'
export type HomeV2CoreActionCode =
  | HomeV2CoreIssueCode
  | 'action-not-allowed'
  | 'action-unconfirmed'
  | 'api-key-unavailable'
  | 'java-unavailable'
  | 'operation-blocked'
  | 'operation-failed'
  | 'operation-in-progress'
  | 'ownership-unproven'
  | 'target-changed'

export type HomeV2CoreManagerStatus = {
  readonly capabilities: {
    readonly canStart: boolean
    readonly canStop: boolean
  }
  readonly control: HomeV2CoreControl
  readonly install: HomeV2CoreInstallKind
  readonly issue: HomeV2CoreIssueCode | null
  readonly network: HomeV2CoreNetwork
  readonly revision: 1
  readonly runtime: HomeV2CoreRuntimeState
  readonly schema: 'home-v2-core-manager'
}

export type HomeV2CoreManagerActionResult = {
  readonly code: HomeV2CoreActionCode | null
  readonly network: HomeV2CoreNetwork
  readonly outcome: 'blocked' | 'completed' | 'failed' | 'unconfirmed'
  readonly revision: 1
  readonly schema: 'home-v2-core-manager-action'
  readonly status: HomeV2CoreManagerStatus
  readonly warning: 'operation-lock-release-failed' | null
}

export type HomeV2CoreMaintenanceStatus = {
  readonly capabilities: {
    readonly canInitialInstall: boolean
    readonly canInstallJava: boolean
  }
  readonly core: {
    readonly channel: 'prerelease' | 'stable' | null
    readonly installedVersion: string | null
    readonly runtime: HomeV2CoreRuntimeState
  }
  readonly java: {
    readonly source: 'managed' | 'missing' | 'system' | 'unsupported'
    readonly updateAvailable: boolean
    readonly version: string | null
  }
  readonly revision: 1
  readonly schema: 'home-v2-core-maintenance'
}

export type HomeV2CoreMaintenanceRelease = {
  readonly action: 'initial-install' | 'none' | 'strict-update'
  readonly available: boolean
  readonly channel: 'prerelease' | 'stable'
  readonly revision: 1
  readonly schema: 'home-v2-core-maintenance-release'
  readonly tag: string | null
}

export type HomeV2CoreMaintenanceActionResult = {
  readonly code: 'action-not-allowed' | 'operation-failed' | 'operation-in-progress' | 'release-changed' | null
  readonly outcome: 'blocked' | 'completed' | 'failed'
  readonly revision: 1
  readonly schema: 'home-v2-core-maintenance-action'
  readonly status: HomeV2CoreMaintenanceStatus
}

type CoreManagerResolver = (network: HomeV2CoreNetwork) => CoreManagerEntry
type CoreAction = 'start' | 'stop'
type MaintenanceAction = 'initial-install' | 'install-java' | 'strict-update'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeHomeV2CoreManagerRequest(value: unknown) {
  if (!isRecord(value) || Object.keys(value).length !== 1) {
    throw new Error('A Core manager request with one network is required.')
  }
  if (value.network !== 'qortal' && value.network !== 'qortium') {
    throw new Error('Choose Qortal or Qortium.')
  }
  return { network: value.network } as const
}

function normalizeMaintenanceEmptyRequest(value: unknown) {
  if (!isRecord(value) || value.schema !== 'home-v2-core-maintenance-request' ||
    value.revision !== 1 || Object.keys(value).length !== 2) {
    throw new Error('An exact Core maintenance request is required.')
  }
}

function normalizeMaintenanceReleaseRequest(value: unknown) {
  if (!isRecord(value) || value.schema !== 'home-v2-core-maintenance-release-request' ||
    value.revision !== 1 || Object.keys(value).length !== 2) {
    throw new Error('An exact Core maintenance release request is required.')
  }
}

function normalizeMaintenanceMutationRequest(value: unknown) {
  if (!isRecord(value) || value.schema !== 'home-v2-core-maintenance-mutation-request' ||
    value.revision !== 1 ||
    (value.action !== 'initial-install' && value.action !== 'strict-update' && value.action !== 'install-java') ||
    (value.action === 'install-java'
      ? Object.keys(value).length !== 3 || 'channel' in value || 'expectedTag' in value
      : Object.keys(value).length !== 5 ||
        (value.channel !== 'stable' && value.channel !== 'prerelease') ||
        typeof value.expectedTag !== 'string' || !/^v?[a-z0-9][a-z0-9._-]*$/i.test(value.expectedTag))) {
    throw new Error('An exact Core maintenance mutation request is required.')
  }
  return value as {
    action: MaintenanceAction
    channel?: 'prerelease' | 'stable'
    expectedTag?: string
  }
}

function qortiumMaintenanceStatus(
  value: unknown,
  observedRuntime?: HomeV2CoreRuntimeState,
): HomeV2CoreMaintenanceStatus {
  const status = isRecord(value) ? value : {}
  const installed = isRecord(status.installed) ? status.installed : null
  const runtime = isRecord(status.runtime) ? status.runtime : null
  const java = isRecord(status.java) ? status.java : null
  const supported = status.supported === true
  const runtimeState: HomeV2CoreRuntimeState = observedRuntime ?? (!runtime
    ? 'unknown'
    : runtime.running === true
      ? 'running'
      : 'unknown')
  const javaSource = java?.source === 'managed' || java?.source === 'system' ||
    java?.source === 'unsupported' || java?.source === 'missing'
    ? java.source
    : 'missing'

  return {
    capabilities: {
      canInitialInstall: supported && !installed && runtimeState === 'stopped',
      canInstallJava: supported && (
        javaSource === 'missing' || javaSource === 'unsupported' ||
        (javaSource === 'system' && typeof java?.majorVersion === 'number' &&
          typeof java?.managedJavaTarget === 'number' && java.majorVersion < java.managedJavaTarget) ||
        (javaSource === 'managed' && java?.managedUpgradeAvailable === true)
      ),
    },
    core: {
      channel: installed?.channel === 'stable' || installed?.channel === 'prerelease'
        ? installed.channel
        : null,
      installedVersion:
        typeof installed?.jarSemver === 'string' && installed.jarSemver.trim()
          ? installed.jarSemver.trim()
          : typeof installed?.tagName === 'string' && installed.tagName.trim()
            ? installed.tagName.trim()
            : null,
      runtime: runtimeState,
    },
    java: {
      source: javaSource,
      updateAvailable: java?.managedUpgradeAvailable === true,
      version: typeof java?.version === 'string' && java.version.trim() ? java.version.trim() : null,
    },
    revision: 1,
    schema: 'home-v2-core-maintenance',
  }
}

async function readMaintenanceStatus(resolveManager: CoreManagerResolver) {
  try {
    const manager = resolveManager('qortium')
    if (manager.networkId !== 'qortium') throw new Error('wrong manager')
    const [status, runtime] = await Promise.all([
      manager.getStatus(),
      manager.getMaintenanceRuntimeStateForHomeV2(),
    ])
    return qortiumMaintenanceStatus(status, runtime)
  } catch {
    return qortiumMaintenanceStatus(null)
  }
}

function maintenanceActionResult(
  status: HomeV2CoreMaintenanceStatus,
  outcome: HomeV2CoreMaintenanceActionResult['outcome'],
  code: HomeV2CoreMaintenanceActionResult['code'],
): HomeV2CoreMaintenanceActionResult {
  return { code, outcome, revision: 1, schema: 'home-v2-core-maintenance-action', status }
}

function unavailableStatus(
  network: HomeV2CoreNetwork,
  issue: HomeV2CoreIssueCode,
): HomeV2CoreManagerStatus {
  return {
    capabilities: { canStart: false, canStop: false },
    control: 'none',
    install: 'unknown',
    issue,
    network,
    revision: 1,
    runtime: 'unknown',
    schema: 'home-v2-core-manager',
  }
}

function normalizeQortalStatus(
  status: QortalCoreManagerStatus,
): HomeV2CoreManagerStatus {
  const install = status.install.kind
  const runtime = status.runtime.state
  const issue: HomeV2CoreIssueCode | null =
    install === 'missing'
      ? 'install-missing'
      : install === 'unknown'
        ? 'install-unknown'
        : runtime === 'unknown'
          ? 'runtime-unknown'
          : null
  const control: HomeV2CoreControl =
    runtime === 'unknown'
      ? 'observe-only'
      : install === 'home-managed'
        ? 'full'
        : install === 'adopted'
          ? 'api-only'
          : install === 'unknown'
            ? 'observe-only'
            : 'none'

  return {
    capabilities: {
      canStart: status.capabilities.canStart,
      canStop: status.capabilities.canStop,
    },
    control,
    install,
    issue,
    network: 'qortal',
    revision: 1,
    runtime,
    schema: 'home-v2-core-manager',
  }
}

function normalizeQortiumStatus(value: unknown): HomeV2CoreManagerStatus {
  if (!isRecord(value)) return unavailableStatus('qortium', 'status-unavailable')
  const supported = value.supported === true
  const installed = isRecord(value.installed)
  const runtimeRecord = isRecord(value.runtime) ? value.runtime : null
  const blocked = runtimeRecord ? isRecord(runtimeRecord.blocked) : false
  const owner = runtimeRecord?.owner
  const javaAvailable = isRecord(value.java) && value.java.available === true
  const runtime: HomeV2CoreRuntimeState = runtimeRecord
    ? runtimeRecord.running === true
      ? 'running'
      : 'stopped'
    : 'unknown'
  const issue: HomeV2CoreIssueCode | null = !supported
    ? 'unsupported-platform'
    : !installed
      ? 'install-missing'
      : blocked
        ? 'runtime-blocked'
        : runtime === 'unknown'
          ? 'runtime-unknown'
          : null

  return {
    capabilities: {
      canStart:
        supported && installed && !blocked && javaAvailable && runtime === 'stopped',
      canStop: supported && runtime === 'running',
    },
    control: !supported
      ? 'none'
      : runtime === 'running'
      ? owner === 'home'
        ? 'full'
        : 'api-only'
      : !installed
        ? 'none'
        : blocked || runtime === 'unknown'
          ? 'observe-only'
          : 'full',
    install: installed ? 'home-managed' : 'missing',
    issue,
    network: 'qortium',
    revision: 1,
    runtime,
    schema: 'home-v2-core-manager',
  }
}

async function readStatus(
  network: HomeV2CoreNetwork,
  resolveManager: CoreManagerResolver,
): Promise<HomeV2CoreManagerStatus> {
  let manager: CoreManagerEntry
  try {
    manager = resolveManager(network)
  } catch {
    return unavailableStatus(network, 'manager-unavailable')
  }

  try {
    const status = await manager.getStatus()
    if (manager.networkId === 'qortal') {
      return normalizeQortalStatus(status as QortalCoreManagerStatus)
    }
    return normalizeQortiumStatus(status)
  } catch {
    return unavailableStatus(network, 'status-unavailable')
  }
}

function mapQortalBlockCode(code: QortalManagerBlockCode): HomeV2CoreActionCode {
  switch (code) {
    case 'api-key-unavailable':
      return 'api-key-unavailable'
    case 'java-unavailable':
      return 'java-unavailable'
    case 'process-ownership-unproven':
      return 'ownership-unproven'
    case 'process-state-unknown':
      return 'runtime-unknown'
    case 'candidate-changed':
    case 'launch-authority-invalid':
    case 'target-changed':
      return 'target-changed'
    case 'adopted-unsupported':
      return 'unsupported-platform'
    default:
      return 'operation-blocked'
  }
}

function normalizeQortalActionOutcome(
  value: QortalStartResult | QortalStopResult,
): Pick<HomeV2CoreManagerActionResult, 'code' | 'outcome' | 'warning'> {
  if (value.kind === 'completed-with-warning') {
    const nested = normalizeQortalActionOutcome(value.outcome)
    return { ...nested, warning: 'operation-lock-release-failed' }
  }
  if (value.kind === 'blocked') {
    return {
      code: mapQortalBlockCode(value.code),
      outcome: 'blocked',
      warning: null,
    }
  }
  if (value.kind === 'start-unconfirmed' || value.kind === 'stop-unconfirmed') {
    return { code: 'action-unconfirmed', outcome: 'unconfirmed', warning: null }
  }
  if (value.kind === 'failed') {
    return { code: 'operation-failed', outcome: 'failed', warning: null }
  }
  return { code: null, outcome: 'completed', warning: null }
}

function actionResult(
  network: HomeV2CoreNetwork,
  status: HomeV2CoreManagerStatus,
  outcome: HomeV2CoreManagerActionResult['outcome'],
  code: HomeV2CoreActionCode | null,
  warning: HomeV2CoreManagerActionResult['warning'] = null,
): HomeV2CoreManagerActionResult {
  return {
    code,
    network,
    outcome,
    revision: 1,
    schema: 'home-v2-core-manager-action',
    status,
    warning,
  }
}

async function runAction(
  network: HomeV2CoreNetwork,
  action: CoreAction,
  resolveManager: CoreManagerResolver,
) {
  const lease = homeV2CoreOperationCoordinator.tryBeginInteractive(
    [network],
    { serializeStart: action === 'start' },
  )
  if (!lease) {
    return actionResult(
      network,
      await readStatus(network, resolveManager),
      'blocked',
      'operation-in-progress',
    )
  }

  try {
    let manager: CoreManagerEntry
    try {
      manager = resolveManager(network)
    } catch {
      return actionResult(
        network,
        unavailableStatus(network, 'manager-unavailable'),
        'blocked',
        'manager-unavailable',
      )
    }

    const preflight = await readStatus(network, () => manager)
    const allowed = action === 'start'
      ? preflight.capabilities.canStart
      : preflight.capabilities.canStop
    if (!allowed) {
      return actionResult(
        network,
        preflight,
        'blocked',
        preflight.issue ?? 'action-not-allowed',
      )
    }

    let outcome: Pick<HomeV2CoreManagerActionResult, 'code' | 'outcome' | 'warning'>
    try {
      if (manager.networkId === 'qortal') {
        outcome = normalizeQortalActionOutcome(await manager[action]())
      } else {
        await (action === 'start'
          ? manager.startForHomeV2()
          : manager.stopForHomeV2())
        outcome = { code: null, outcome: 'completed', warning: null }
      }
    } catch {
      outcome = { code: 'operation-failed', outcome: 'failed', warning: null }
    }

    return actionResult(
      network,
      await readStatus(network, () => manager),
      outcome.outcome,
      outcome.code,
      outcome.warning,
    )
  } finally {
    lease.release()
  }
}

async function checkMaintenanceRelease(
  channel: 'prerelease' | 'stable',
  resolveManager: CoreManagerResolver,
): Promise<HomeV2CoreMaintenanceRelease> {
  try {
    const manager = resolveManager('qortium')
    if (manager.networkId !== 'qortium') throw new Error('wrong manager')
    const releases = await manager.checkReleases()
    const release = releases[channel]
    const status = await manager.getStatus()
    const installed = isRecord(status) && isRecord(status.installed) ? status.installed : null
    const installedVersion = installed &&
      (typeof installed.jarSemver === 'string' || typeof installed.tagName === 'string')
      ? (typeof installed.jarSemver === 'string' ? installed.jarSemver : installed.tagName as string)
      : null
    const verifiedRelease = release.available && /^[0-9a-f]{40}$/i.test(release.commit)
    let action: HomeV2CoreMaintenanceRelease['action'] = 'none'
    if (verifiedRelease && release.available) {
      if (!installedVersion) {
        action = 'initial-install'
      } else if ((compareCoreVersions(release.tagName, installedVersion) ?? 0) > 0) {
        action = 'strict-update'
      }
    }

    return {
      action,
      available: verifiedRelease,
      channel,
      revision: 1,
      schema: 'home-v2-core-maintenance-release',
      tag: verifiedRelease && release.available ? release.tagName : null,
    }
  } catch {
    return {
      action: 'none',
      available: false,
      channel,
      revision: 1,
      schema: 'home-v2-core-maintenance-release',
      tag: null,
    }
  }
}

async function runMaintenanceAction(
  request: ReturnType<typeof normalizeMaintenanceMutationRequest>,
  resolveManager: CoreManagerResolver,
) {
  const lease = homeV2CoreOperationCoordinator.tryBeginInteractive(
    request.action === 'install-java' ? ['qortal', 'qortium'] : ['qortium'],
  )
  if (!lease) {
    return maintenanceActionResult(
      await readMaintenanceStatus(resolveManager),
      'blocked',
      'operation-in-progress',
    )
  }

  try {
    const manager = resolveManager('qortium')
    if (manager.networkId !== 'qortium') {
      return maintenanceActionResult(await readMaintenanceStatus(resolveManager), 'blocked', 'action-not-allowed')
    }

    if (request.action === 'install-java') {
      const status = await readMaintenanceStatus(() => manager)
      if (!status.capabilities.canInstallJava) {
        return maintenanceActionResult(status, 'blocked', 'action-not-allowed')
      }
      await manager.installJava()
      return maintenanceActionResult(await readMaintenanceStatus(() => manager), 'completed', null)
    }

    const release = await checkMaintenanceRelease(request.channel!, () => manager)
    if (release.tag !== request.expectedTag || release.action !== request.action) {
      return maintenanceActionResult(
        await readMaintenanceStatus(() => manager),
        'blocked',
        'release-changed',
      )
    }

    const status = await readMaintenanceStatus(() => manager)
    if (status.core.runtime !== 'stopped' ||
      (request.action === 'initial-install' && !status.capabilities.canInitialInstall)) {
      return maintenanceActionResult(status, 'blocked', 'action-not-allowed')
    }

    await manager.install({
      channel: request.channel,
      expectedTag: request.expectedTag,
      mode: request.action,
    })
    return maintenanceActionResult(await readMaintenanceStatus(() => manager), 'completed', null)
  } catch {
    return maintenanceActionResult(
      await readMaintenanceStatus(resolveManager),
      'failed',
      'operation-failed',
    )
  } finally {
    lease.release()
  }
}

export function createHomeV2CoreManagerService(resolveManager: CoreManagerResolver) {
  return {
    async getMaintenanceStatus(value: unknown) {
      normalizeMaintenanceEmptyRequest(value)
      return await readMaintenanceStatus(resolveManager)
    },
    async checkMaintenanceRelease(value: unknown) {
      normalizeMaintenanceReleaseRequest(value)
      const status = await readMaintenanceStatus(resolveManager)
      return await checkMaintenanceRelease(status.core.channel ?? 'prerelease', resolveManager)
    },
    async runMaintenanceAction(value: unknown) {
      return await runMaintenanceAction(normalizeMaintenanceMutationRequest(value), resolveManager)
    },
    async getStatus(value: unknown) {
      const { network } = normalizeHomeV2CoreManagerRequest(value)
      return await readStatus(network, resolveManager)
    },
    async start(value: unknown) {
      const { network } = normalizeHomeV2CoreManagerRequest(value)
      return await runAction(network, 'start', resolveManager)
    },
    async stop(value: unknown) {
      const { network } = normalizeHomeV2CoreManagerRequest(value)
      return await runAction(network, 'stop', resolveManager)
    },
  }
}

export function createAuthorizedHomeV2CoreManagerHandlers(
  assertAuthorized: (event: IpcMainInvokeEvent) => void,
  service: ReturnType<typeof createHomeV2CoreManagerService>,
) {
  return {
    getMaintenanceStatus(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.getMaintenanceStatus(value)
    },
    checkMaintenanceRelease(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.checkMaintenanceRelease(value)
    },
    runMaintenanceAction(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.runMaintenanceAction(value)
    },
    getStatus(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.getStatus(value)
    },
    start(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.start(value)
    },
    stop(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.stop(value)
    },
  }
}
