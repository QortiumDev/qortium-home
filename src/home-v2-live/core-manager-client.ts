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
import type {
  HomeV2CoreUpdatePolicySetResult,
  HomeV2CoreUpdatePolicyState,
} from '../../electron/home-v2-core-update-policy-contract'
import type { HomeV2CoreUpdatePolicy } from '../../electron/home-v2-core-update-policy-codec'
import type {
  HomeV2QortalMaintenanceActionResult,
  HomeV2QortalMaintenanceDiscovery,
  HomeV2QortalMaintenanceRelease,
  HomeV2QortalMaintenanceStatus,
} from '../../electron/home-v2-qortal-maintenance-contract'
import type {
  HomeV2TransportMaintenanceAction,
  HomeV2TransportMaintenanceActionResult,
  HomeV2TransportMaintenanceStatus,
  HomeV2TransportMode,
} from '../../electron/home-v2-transport-maintenance-contract'

export type {
  HomeV2CoreMaintenanceActionResult,
  HomeV2CoreMaintenanceRelease,
  HomeV2CoreMaintenanceStatus,
  HomeV2CoreUpdatePolicy,
  HomeV2CoreUpdatePolicySetResult,
  HomeV2CoreUpdatePolicyState,
  HomeV2QortalMaintenanceActionResult,
  HomeV2QortalMaintenanceDiscovery,
  HomeV2QortalMaintenanceRelease,
  HomeV2QortalMaintenanceStatus,
  HomeV2TransportMaintenanceAction,
  HomeV2TransportMaintenanceActionResult,
  HomeV2TransportMaintenanceStatus,
  HomeV2TransportMode,
}

export type HomeV2QortalMaintenanceAction = 'initial-install' | 'strict-update'

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

const qortalMaintenanceDiscoveries = new Set<HomeV2QortalMaintenanceDiscovery>([
  'candidate-found',
  'clear',
  'multiple-candidates',
  'not-applicable',
  'unknown',
])
const qortalUpdateAuthorities = new Set<HomeV2QortalMaintenanceStatus['updateAuthority']>([
  'home-github',
  'node-native',
  'observe-only',
])
const qortalMaintenanceIssues = new Set([
  'manager-unavailable',
  'status-unavailable',
  'unsupported-platform',
])
const qortalReleaseCodes = new Set([
  'action-not-allowed',
  'release-unavailable',
  'up-to-date',
  'version-unavailable',
])
const qortalMaintenanceActionCodes = new Set([
  'action-not-allowed',
  'adopted-update-unsupported',
  'install-selection-required',
  'operation-failed',
  'operation-in-progress',
  'release-changed',
  'release-not-newer',
  'runtime-not-stopped',
  'target-changed',
  'update-node-native',
  'update-ownership-unknown',
])

const MAX_QORTAL_MAINTENANCE_VERSION_LENGTH = 128

function isBoundedQortalMaintenanceVersion(value: unknown): value is string | null {
  return value === null || (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_QORTAL_MAINTENANCE_VERSION_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

export function parseHomeV2QortalMaintenanceStatus(
  value: unknown,
): HomeV2QortalMaintenanceStatus {
  if (!isRecord(value) || !hasExactKeys(value, [
    'capabilities',
    'discovery',
    'install',
    'installedVersion',
    'issue',
    'network',
    'revision',
    'runtime',
    'schema',
    'updateAuthority',
  ]) || value.schema !== 'home-v2-qortal-maintenance' || value.revision !== 1 ||
    value.network !== 'qortal' || !installKinds.has(value.install as HomeV2CoreInstallKind) ||
    !runtimeStates.has(value.runtime as HomeV2CoreRuntimeState) ||
    !qortalMaintenanceDiscoveries.has(value.discovery as HomeV2QortalMaintenanceDiscovery) ||
    !qortalUpdateAuthorities.has(value.updateAuthority as HomeV2QortalMaintenanceStatus['updateAuthority']) ||
    !isBoundedQortalMaintenanceVersion(value.installedVersion) ||
    !(value.issue === null || qortalMaintenanceIssues.has(String(value.issue))) ||
    !isRecord(value.capabilities) || !hasExactKeys(value.capabilities, [
      'canCheckRelease',
      'canInitialInstall',
      'canUpdate',
    ]) || typeof value.capabilities.canCheckRelease !== 'boolean' ||
    typeof value.capabilities.canInitialInstall !== 'boolean' ||
    typeof value.capabilities.canUpdate !== 'boolean' ||
    (value.issue !== null && (
      value.capabilities.canCheckRelease || value.capabilities.canInitialInstall ||
      value.capabilities.canUpdate
    )) ||
    (value.capabilities.canInitialInstall && !(
      value.install === 'missing' && value.runtime === 'stopped' && value.discovery === 'clear'
    )) ||
    (value.capabilities.canUpdate && !(
      value.install === 'home-managed' && value.runtime === 'stopped' &&
      value.updateAuthority === 'home-github' && value.installedVersion !== null
    )) ||
    (value.capabilities.canCheckRelease && !(
      value.capabilities.canInitialInstall ||
      (value.install === 'home-managed' && value.updateAuthority === 'home-github' &&
        value.installedVersion !== null)
    )) ||
    (value.install === 'missing' && value.discovery === 'not-applicable') ||
    (value.install !== 'missing' && value.issue === null && value.discovery !== 'not-applicable')) {
    throw new Error('Invalid Home 2 Qortal maintenance status.')
  }
  return Object.freeze({
    capabilities: Object.freeze({
      canCheckRelease: value.capabilities.canCheckRelease,
      canInitialInstall: value.capabilities.canInitialInstall,
      canUpdate: value.capabilities.canUpdate,
    }),
    discovery: value.discovery,
    install: value.install,
    installedVersion: value.installedVersion,
    issue: value.issue,
    network: 'qortal',
    revision: 1,
    runtime: value.runtime,
    schema: 'home-v2-qortal-maintenance',
    updateAuthority: value.updateAuthority,
  }) as HomeV2QortalMaintenanceStatus
}

export function parseHomeV2QortalMaintenanceRelease(
  value: unknown,
): HomeV2QortalMaintenanceRelease {
  if (!isRecord(value) || !hasExactKeys(value, [
    'action',
    'available',
    'code',
    'network',
    'revision',
    'schema',
    'tag',
  ]) || value.schema !== 'home-v2-qortal-maintenance-release' || value.revision !== 1 ||
    value.network !== 'qortal' || typeof value.available !== 'boolean' ||
    !['initial-install', 'none', 'strict-update'].includes(String(value.action)) ||
    !isBoundedQortalMaintenanceVersion(value.tag) ||
    !(value.code === null || qortalReleaseCodes.has(String(value.code))) ||
    (value.action !== 'none' && (!value.available || value.tag === null || value.code !== null)) ||
    (value.available && value.tag === null) ||
    (!value.available && (value.tag !== null || value.code === null)) ||
    (value.action === 'none' && value.available &&
      value.code !== 'up-to-date' && value.code !== 'version-unavailable')) {
    throw new Error('Invalid Home 2 Qortal maintenance release.')
  }
  return Object.freeze({ ...value }) as HomeV2QortalMaintenanceRelease
}

export function parseHomeV2QortalMaintenanceActionResult(
  value: unknown,
): HomeV2QortalMaintenanceActionResult {
  if (!isRecord(value) || !hasExactKeys(value, [
    'code',
    'network',
    'outcome',
    'revision',
    'schema',
    'status',
    'warning',
  ]) || value.schema !== 'home-v2-qortal-maintenance-action' || value.revision !== 1 ||
    value.network !== 'qortal' ||
    !['blocked', 'completed', 'failed'].includes(String(value.outcome)) ||
    !(value.code === null || qortalMaintenanceActionCodes.has(String(value.code))) ||
    !(value.warning === null || value.warning === 'cleanup-incomplete') ||
    (value.outcome === 'completed' && value.code !== null) ||
    (value.outcome === 'failed' && value.code !== 'operation-failed') ||
    (value.outcome === 'blocked' && value.code === null)) {
    throw new Error('Invalid Home 2 Qortal maintenance action result.')
  }
  return Object.freeze({
    code: value.code,
    network: 'qortal',
    outcome: value.outcome,
    revision: 1,
    schema: 'home-v2-qortal-maintenance-action',
    status: parseHomeV2QortalMaintenanceStatus(value.status),
    warning: value.warning,
  }) as HomeV2QortalMaintenanceActionResult
}

const transportModes = new Set<HomeV2TransportMode>([
  'direct-and-i2p',
  'direct-only',
  'i2p-only',
  'unknown',
])
const transportRouterStates = new Set<HomeV2TransportMaintenanceStatus['router']['state']>([
  'external-running',
  'managed-running',
  'managed-stopped',
  'missing',
  'unsupported',
  'unknown',
])
const transportRouterMaintenance = new Set<HomeV2TransportMaintenanceStatus['router']['maintenance']>([
  'install',
  'none',
  'start',
  'unavailable',
  'update',
])
const transportIssues = new Set<NonNullable<HomeV2TransportMaintenanceStatus['issue']>>([
  'manager-unavailable',
  'status-unavailable',
  'unsupported-platform',
  'version-unavailable',
])
const transportActionCodes = new Set<NonNullable<HomeV2TransportMaintenanceActionResult['code']>>([
  'action-not-allowed',
  'action-unconfirmed',
  'core-install-missing',
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

function isBoundedTransportVersion(value: unknown): value is string | null {
  return value === null || (
    typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
  )
}

export function parseHomeV2TransportMaintenanceStatus(
  value: unknown,
): HomeV2TransportMaintenanceStatus {
  if (!isRecord(value) || !hasExactKeys(value, [
    'capabilities',
    'core',
    'issue',
    'network',
    'revision',
    'router',
    'schema',
    'transportMode',
  ]) || value.schema !== 'home-v2-transport-maintenance' || value.revision !== 1 ||
    value.network !== 'qortium' || !transportModes.has(value.transportMode as HomeV2TransportMode) ||
    !(value.issue === null || transportIssues.has(value.issue as NonNullable<HomeV2TransportMaintenanceStatus['issue']>)) ||
    !isRecord(value.core) || !hasExactKeys(value.core, ['install', 'runtime']) ||
    !['installed', 'missing', 'unknown'].includes(String(value.core.install)) ||
    !['running', 'stopped', 'unknown'].includes(String(value.core.runtime)) ||
    !isRecord(value.router) || !hasExactKeys(value.router, ['maintenance', 'state', 'version']) ||
    !transportRouterStates.has(value.router.state as HomeV2TransportMaintenanceStatus['router']['state']) ||
    !transportRouterMaintenance.has(value.router.maintenance as HomeV2TransportMaintenanceStatus['router']['maintenance']) ||
    !isBoundedTransportVersion(value.router.version) ||
    !isRecord(value.capabilities) || !hasExactKeys(value.capabilities, [
      'canEnsureRouter',
      'canSetDirectAndI2p',
      'canSetDirectOnly',
      'canSetI2pOnly',
    ]) || Object.values(value.capabilities).some((entry) => typeof entry !== 'boolean')) {
    throw new Error('Invalid Home 2 transport maintenance status.')
  }

  const issue = value.issue as HomeV2TransportMaintenanceStatus['issue']
  const install = value.core.install as HomeV2TransportMaintenanceStatus['core']['install']
  const runtime = value.core.runtime as HomeV2TransportMaintenanceStatus['core']['runtime']
  const routerState = value.router.state as HomeV2TransportMaintenanceStatus['router']['state']
  const maintenance = value.router.maintenance as HomeV2TransportMaintenanceStatus['router']['maintenance']
  const version = value.router.version as string | null
  const mode = value.transportMode as HomeV2TransportMode
  const capabilities = value.capabilities as Record<string, boolean>
  const fatalIssue = issue === 'manager-unavailable' || issue === 'status-unavailable'
  const routerReady = routerState === 'external-running' || routerState === 'managed-running'
  const canChangeStoppedCore = install === 'installed' && runtime === 'stopped' &&
    mode !== 'unknown' && !fatalIssue
  const canEnsureRouter = install === 'installed' && runtime === 'stopped' && issue === null &&
    (maintenance === 'install' || maintenance === 'start' || maintenance === 'update')
  const routerShapeCoherent = routerState === 'external-running'
    ? maintenance === 'none' && version === null
    : routerState === 'managed-running'
      ? version !== null && (maintenance === 'none' || maintenance === 'update' || maintenance === 'unavailable')
      : routerState === 'managed-stopped'
        ? version !== null && (maintenance === 'start' || maintenance === 'update' || maintenance === 'unavailable')
        : routerState === 'missing'
          ? maintenance === 'install' && version === null
          : maintenance === 'unavailable' && version === null

  if (!routerShapeCoherent ||
    ((routerState === 'unsupported') !== (issue === 'unsupported-platform')) ||
    (issue === 'version-unavailable' && !(
      routerState === 'unknown' ||
      ((routerState === 'managed-running' || routerState === 'managed-stopped') &&
        maintenance === 'unavailable')
    )) ||
    (routerState === 'unknown' && issue === null) ||
    (fatalIssue && (
      install !== 'unknown' || runtime !== 'unknown' || mode !== 'unknown' || routerState !== 'unknown'
    )) ||
    (install !== 'installed' && mode !== 'unknown') ||
    capabilities.canEnsureRouter !== canEnsureRouter ||
    capabilities.canSetDirectOnly !== canChangeStoppedCore ||
    capabilities.canSetDirectAndI2p !== (canChangeStoppedCore && routerReady) ||
    capabilities.canSetI2pOnly !== (canChangeStoppedCore && routerReady)) {
    throw new Error('Invalid Home 2 transport maintenance status.')
  }

  return Object.freeze({
    capabilities: Object.freeze({
      canEnsureRouter: capabilities.canEnsureRouter,
      canSetDirectAndI2p: capabilities.canSetDirectAndI2p,
      canSetDirectOnly: capabilities.canSetDirectOnly,
      canSetI2pOnly: capabilities.canSetI2pOnly,
    }),
    core: Object.freeze({ install, runtime }),
    issue,
    network: 'qortium',
    revision: 1,
    router: Object.freeze({ maintenance, state: routerState, version }),
    schema: 'home-v2-transport-maintenance',
    transportMode: mode,
  })
}

export function parseHomeV2TransportMaintenanceActionResult(
  value: unknown,
): HomeV2TransportMaintenanceActionResult {
  if (!isRecord(value) || !hasExactKeys(value, [
    'code',
    'network',
    'outcome',
    'revision',
    'schema',
    'status',
    'warning',
  ]) || value.schema !== 'home-v2-transport-maintenance-action' || value.revision !== 1 ||
    value.network !== 'qortium' ||
    !['blocked', 'completed', 'failed', 'unconfirmed'].includes(String(value.outcome)) ||
    !(value.code === null || transportActionCodes.has(value.code as NonNullable<HomeV2TransportMaintenanceActionResult['code']>)) ||
    !(value.warning === null || value.warning === 'cleanup-incomplete') ||
    (value.outcome === 'completed' && value.code !== null) ||
    (value.outcome === 'failed' && (value.code !== 'operation-failed' || value.warning !== null)) ||
    (value.outcome === 'unconfirmed' && (value.code !== 'action-unconfirmed' || value.warning !== null)) ||
    (value.outcome === 'blocked' && (
      value.code === null || value.code === 'action-unconfirmed' || value.code === 'operation-failed' ||
      value.warning !== null
    ))) {
    throw new Error('Invalid Home 2 transport maintenance action result.')
  }
  return Object.freeze({
    code: value.code,
    network: 'qortium',
    outcome: value.outcome,
    revision: 1,
    schema: 'home-v2-transport-maintenance-action',
    status: parseHomeV2TransportMaintenanceStatus(value.status),
    warning: value.warning,
  }) as HomeV2TransportMaintenanceActionResult
}

const policyActivityStates = new Set([
  'available',
  'checking',
  'failed',
  'idle',
  'installing',
  'pending-safe-state',
  'up-to-date',
])
const policyIssues = new Set([
  'check-failed',
  'operation-busy',
  'operation-failed',
  'policy-revoked',
  'settings-unavailable',
])

const MAX_POLICY_VERSION_LENGTH = 128

function isPolicy(value: unknown): value is HomeV2CoreUpdatePolicy {
  return value === 'install' || value === 'notify' || value === 'off'
}

function isBoundedPolicyVersion(value: unknown): value is string | null {
  return value === null || (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_POLICY_VERSION_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function isPolicyCheckedAt(value: unknown): value is string | null {
  if (value === null) return true
  if (typeof value !== 'string' || value.length > 32) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

export function parseHomeV2CoreUpdatePolicyState(value: unknown): HomeV2CoreUpdatePolicyState {
  if (!isRecord(value) || !hasExactKeys(value, [
    'activity',
    'coreUpdatePolicy',
    'generation',
    'javaUpdatePolicy',
    'revision',
    'schema',
    'settingsIssue',
  ]) || value.schema !== 'home-v2-core-update-policy' || value.revision !== 1 ||
    !Number.isSafeInteger(value.generation) || (value.generation as number) < 0 ||
    !isPolicy(value.coreUpdatePolicy) ||
    !isPolicy(value.javaUpdatePolicy) ||
    !(value.settingsIssue === null || value.settingsIssue === 'settings-unavailable') ||
    !isRecord(value.activity) ||
    !hasExactKeys(value.activity, ['checkedAt', 'core', 'generation', 'issue', 'java']) ||
    !Number.isSafeInteger(value.activity.generation) || value.activity.generation !== value.generation ||
    !isPolicyCheckedAt(value.activity.checkedAt) ||
    !(value.activity.issue === null || policyIssues.has(value.activity.issue as string)) ||
    !isRecord(value.activity.core) || !hasExactKeys(value.activity.core, ['channel', 'state', 'version']) ||
    !(value.activity.core.channel === null || value.activity.core.channel === 'stable' ||
      value.activity.core.channel === 'prerelease') ||
    !policyActivityStates.has(value.activity.core.state as string) ||
    !isBoundedPolicyVersion(value.activity.core.version) ||
    !isRecord(value.activity.java) || !hasExactKeys(value.activity.java, ['state', 'version']) ||
    !policyActivityStates.has(value.activity.java.state as string) ||
    !isBoundedPolicyVersion(value.activity.java.version)) {
    throw new Error('Invalid Home 2 Core update policy state.')
  }
  return Object.freeze({
    activity: Object.freeze({
      checkedAt: value.activity.checkedAt,
      core: Object.freeze({ ...value.activity.core }),
      generation: value.activity.generation,
      issue: value.activity.issue,
      java: Object.freeze({ ...value.activity.java }),
    }),
    coreUpdatePolicy: value.coreUpdatePolicy,
    generation: value.generation,
    javaUpdatePolicy: value.javaUpdatePolicy,
    revision: 1,
    schema: 'home-v2-core-update-policy',
    settingsIssue: value.settingsIssue,
  }) as HomeV2CoreUpdatePolicyState
}

export function parseHomeV2CoreUpdatePolicySetResult(
  value: unknown,
): HomeV2CoreUpdatePolicySetResult {
  if (!isRecord(value) || !hasExactKeys(value, ['outcome', 'revision', 'schema', 'state']) ||
    value.schema !== 'home-v2-core-update-policy-set-result' || value.revision !== 1 ||
    (value.outcome !== 'saved' && value.outcome !== 'conflict')) {
    throw new Error('Invalid Home 2 Core update policy set result.')
  }
  return Object.freeze({
    outcome: value.outcome,
    revision: 1,
    schema: 'home-v2-core-update-policy-set-result',
    state: parseHomeV2CoreUpdatePolicyState(value.state),
  })
}

export interface HomeV2CoreManagerClient {
  getMaintenanceStatus(): Promise<HomeV2CoreMaintenanceStatus>
  checkMaintenanceRelease(): Promise<HomeV2CoreMaintenanceRelease>
  runMaintenanceAction(
    action: 'initial-install' | 'install-java' | 'strict-update',
    release?: { channel: 'prerelease' | 'stable'; expectedTag: string },
  ): Promise<HomeV2CoreMaintenanceActionResult>
  getUpdatePolicy(): Promise<HomeV2CoreUpdatePolicyState>
  setUpdatePolicy(
    expectedGeneration: number,
    field: 'coreUpdatePolicy' | 'javaUpdatePolicy',
    value: HomeV2CoreUpdatePolicy,
  ): Promise<HomeV2CoreUpdatePolicySetResult>
  getStatus(network: HomeV2CoreNetwork): Promise<HomeV2CoreManagerStatus>
  start(network: HomeV2CoreNetwork): Promise<HomeV2CoreManagerActionResult>
  stop(network: HomeV2CoreNetwork): Promise<HomeV2CoreManagerActionResult>
  getQortalMaintenanceStatus?(): Promise<HomeV2QortalMaintenanceStatus>
  checkQortalMaintenanceRelease?(): Promise<HomeV2QortalMaintenanceRelease>
  runQortalMaintenanceAction?(
    action: HomeV2QortalMaintenanceAction,
    expectedTag: string,
  ): Promise<HomeV2QortalMaintenanceActionResult>
  getTransportMaintenanceStatus?(): Promise<HomeV2TransportMaintenanceStatus>
  runTransportMaintenanceAction?(
    action: HomeV2TransportMaintenanceAction,
    transportMode: Exclude<HomeV2TransportMode, 'unknown'> | null,
  ): Promise<HomeV2TransportMaintenanceActionResult>
}

declare global {
  interface Window {
    homeV2CoreManagers?: HomeV2CoreManagerClient
  }
}
