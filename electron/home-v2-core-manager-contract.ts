import type { IpcMainInvokeEvent } from 'electron'
import type { CoreManagerEntry } from './core-manager.js'
import type {
  QortalCoreManagerStatus,
  QortalManagerBlockCode,
  QortalStartResult,
  QortalStopResult,
} from './qortal-core-manager.js'

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

type CoreManagerResolver = (network: HomeV2CoreNetwork) => CoreManagerEntry
type CoreAction = 'start' | 'stop'

const inFlightNetworks = new Set<HomeV2CoreNetwork>()
let startInFlight = false

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
  if (inFlightNetworks.has(network)) {
    return actionResult(
      network,
      await readStatus(network, resolveManager),
      'blocked',
      'operation-in-progress',
    )
  }
  if (action === 'start' && startInFlight) {
    return actionResult(
      network,
      await readStatus(network, resolveManager),
      'blocked',
      'operation-in-progress',
    )
  }

  inFlightNetworks.add(network)
  if (action === 'start') startInFlight = true
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
    inFlightNetworks.delete(network)
    if (action === 'start') startInFlight = false
  }
}

export function createHomeV2CoreManagerService(resolveManager: CoreManagerResolver) {
  return {
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
