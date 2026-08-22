import type {
  HomeV2CoreActionCode,
  HomeV2CoreControl,
  HomeV2CoreInstallKind,
  HomeV2CoreIssueCode,
  HomeV2CoreManagerActionResult,
  HomeV2CoreManagerStatus,
  HomeV2CoreNetwork,
  HomeV2CoreRuntimeState,
  HomeV2CoreMaintenanceActionResult,
  HomeV2CoreMaintenanceRelease,
  HomeV2CoreMaintenanceStatus,
} from '../../electron/home-v2-core-manager-contract'

export type {
  HomeV2CoreMaintenanceActionResult,
  HomeV2CoreMaintenanceRelease,
  HomeV2CoreMaintenanceStatus,
}

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

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
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

export function parseHomeV2CoreMaintenanceStatus(value: unknown): HomeV2CoreMaintenanceStatus {
  if (!isRecord(value) || !hasExactKeys(value, ['capabilities', 'core', 'java', 'revision', 'schema']) ||
    value.schema !== 'home-v2-core-maintenance' || value.revision !== 1 ||
    !isRecord(value.capabilities) || typeof value.capabilities.canInitialInstall !== 'boolean' ||
    !hasExactKeys(value.capabilities, ['canInitialInstall', 'canInstallJava']) ||
    typeof value.capabilities.canInstallJava !== 'boolean' || !isRecord(value.core) ||
    !hasExactKeys(value.core, ['channel', 'installedVersion', 'runtime']) ||
    !(value.core.channel === null || value.core.channel === 'stable' || value.core.channel === 'prerelease') ||
    !(value.core.installedVersion === null || typeof value.core.installedVersion === 'string') ||
    !runtimeStates.has(value.core.runtime as HomeV2CoreRuntimeState) || !isRecord(value.java) ||
    !hasExactKeys(value.java, ['source', 'updateAvailable', 'version']) ||
    !['managed', 'missing', 'system', 'unsupported'].includes(String(value.java.source)) ||
    typeof value.java.updateAvailable !== 'boolean' ||
    !(value.java.version === null || typeof value.java.version === 'string')) {
    throw new Error('Invalid Home 2 Core maintenance status.')
  }
  return Object.freeze({
    capabilities: Object.freeze({
      canInitialInstall: value.capabilities.canInitialInstall,
      canInstallJava: value.capabilities.canInstallJava,
    }),
    core: Object.freeze({
      channel: value.core.channel,
      installedVersion: value.core.installedVersion,
      runtime: value.core.runtime,
    }),
    java: Object.freeze({
      source: value.java.source,
      updateAvailable: value.java.updateAvailable,
      version: value.java.version,
    }),
    revision: 1,
    schema: 'home-v2-core-maintenance',
  }) as HomeV2CoreMaintenanceStatus
}

export function parseHomeV2CoreMaintenanceRelease(value: unknown): HomeV2CoreMaintenanceRelease {
  if (!isRecord(value) || !hasExactKeys(value, ['action', 'available', 'channel', 'revision', 'schema', 'tag']) ||
    value.schema !== 'home-v2-core-maintenance-release' || value.revision !== 1 ||
    (value.channel !== 'stable' && value.channel !== 'prerelease') || typeof value.available !== 'boolean' ||
    !['initial-install', 'none', 'strict-update'].includes(String(value.action)) ||
    !(value.tag === null || typeof value.tag === 'string')) {
    throw new Error('Invalid Home 2 Core maintenance release.')
  }
  return Object.freeze({ ...value }) as HomeV2CoreMaintenanceRelease
}

export function parseHomeV2CoreMaintenanceActionResult(value: unknown): HomeV2CoreMaintenanceActionResult {
  if (!isRecord(value) || !hasExactKeys(value, ['code', 'outcome', 'revision', 'schema', 'status']) ||
    value.schema !== 'home-v2-core-maintenance-action' || value.revision !== 1 ||
    !['blocked', 'completed', 'failed'].includes(String(value.outcome)) ||
    !(value.code === null || ['action-not-allowed', 'operation-failed', 'operation-in-progress', 'release-changed'].includes(String(value.code)))) {
    throw new Error('Invalid Home 2 Core maintenance action result.')
  }
  return Object.freeze({
    code: value.code,
    outcome: value.outcome,
    revision: 1,
    schema: 'home-v2-core-maintenance-action',
    status: parseHomeV2CoreMaintenanceStatus(value.status),
  }) as HomeV2CoreMaintenanceActionResult
}

export interface HomeV2CoreManagerClient {
  getMaintenanceStatus(): Promise<HomeV2CoreMaintenanceStatus>
  checkMaintenanceRelease(): Promise<HomeV2CoreMaintenanceRelease>
  runMaintenanceAction(
    action: 'initial-install' | 'install-java' | 'strict-update',
    release?: { channel: 'prerelease' | 'stable'; expectedTag: string },
  ): Promise<HomeV2CoreMaintenanceActionResult>
  getStatus(network: HomeV2CoreNetwork): Promise<HomeV2CoreManagerStatus>
  start(network: HomeV2CoreNetwork): Promise<HomeV2CoreManagerActionResult>
  stop(network: HomeV2CoreNetwork): Promise<HomeV2CoreManagerActionResult>
}

declare global {
  interface Window {
    homeV2CoreManagers?: HomeV2CoreManagerClient
  }
}
