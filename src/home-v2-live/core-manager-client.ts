import type {
  HomeV2CoreActionCode,
  HomeV2CoreControl,
  HomeV2CoreInstallKind,
  HomeV2CoreIssueCode,
  HomeV2CoreManagerActionResult,
  HomeV2CoreManagerStatus,
  HomeV2CoreNetwork,
  HomeV2CoreRuntimeState,
} from '../../electron/home-v2-core-manager-contract'

const installKinds = new Set<HomeV2CoreInstallKind>([
  'adopted',
  'home-managed',
  'missing',
  'unknown',
])
const runtimeStates = new Set<HomeV2CoreRuntimeState>([
  'running',
  'stopped',
  'unknown',
])
const controls = new Set<HomeV2CoreControl>([
  'api-only',
  'full',
  'none',
  'observe-only',
])
const issueCodes = new Set<HomeV2CoreIssueCode>([
  'install-missing',
  'install-unknown',
  'manager-unavailable',
  'runtime-blocked',
  'runtime-unknown',
  'status-unavailable',
  'unsupported-platform',
])
const actionCodes = new Set<HomeV2CoreActionCode>([
  ...issueCodes,
  'action-not-allowed',
  'action-unconfirmed',
  'api-key-unavailable',
  'java-unavailable',
  'operation-blocked',
  'operation-failed',
  'operation-in-progress',
  'ownership-unproven',
  'target-changed',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function parseHomeV2CoreManagerStatus(
  value: unknown,
  expectedNetwork: HomeV2CoreNetwork,
): HomeV2CoreManagerStatus {
  if (
    !isRecord(value) ||
    value.schema !== 'home-v2-core-manager' ||
    value.revision !== 1 ||
    value.network !== expectedNetwork ||
    !installKinds.has(value.install as HomeV2CoreInstallKind) ||
    !runtimeStates.has(value.runtime as HomeV2CoreRuntimeState) ||
    !controls.has(value.control as HomeV2CoreControl) ||
    !isRecord(value.capabilities) ||
    typeof value.capabilities.canStart !== 'boolean' ||
    typeof value.capabilities.canStop !== 'boolean' ||
    !(
      value.issue === null ||
      issueCodes.has(value.issue as HomeV2CoreIssueCode)
    )
  ) {
    throw new Error('Invalid Home 2 Core manager status.')
  }
  return Object.freeze({
    capabilities: Object.freeze({
      canStart: value.capabilities.canStart,
      canStop: value.capabilities.canStop,
    }),
    control: value.control,
    install: value.install,
    issue: value.issue,
    network: expectedNetwork,
    revision: 1,
    runtime: value.runtime,
    schema: 'home-v2-core-manager',
  }) as HomeV2CoreManagerStatus
}

export function parseHomeV2CoreManagerActionResult(
  value: unknown,
  expectedNetwork: HomeV2CoreNetwork,
): HomeV2CoreManagerActionResult {
  if (
    !isRecord(value) ||
    value.schema !== 'home-v2-core-manager-action' ||
    value.revision !== 1 ||
    value.network !== expectedNetwork ||
    (value.outcome !== 'blocked' &&
      value.outcome !== 'completed' &&
      value.outcome !== 'failed' &&
      value.outcome !== 'unconfirmed') ||
    !(value.code === null || actionCodes.has(value.code as HomeV2CoreActionCode)) ||
    !(
      value.warning === null ||
      value.warning === 'operation-lock-release-failed'
    )
  ) {
    throw new Error('Invalid Home 2 Core manager action result.')
  }
  return Object.freeze({
    code: value.code,
    network: expectedNetwork,
    outcome: value.outcome,
    revision: 1,
    schema: 'home-v2-core-manager-action',
    status: parseHomeV2CoreManagerStatus(value.status, expectedNetwork),
    warning: value.warning,
  }) as HomeV2CoreManagerActionResult
}

export interface HomeV2CoreManagerClient {
  getStatus(network: HomeV2CoreNetwork): Promise<HomeV2CoreManagerStatus>
  start(network: HomeV2CoreNetwork): Promise<HomeV2CoreManagerActionResult>
  stop(network: HomeV2CoreNetwork): Promise<HomeV2CoreManagerActionResult>
}

declare global {
  interface Window {
    homeV2CoreManagers?: HomeV2CoreManagerClient
  }
}
