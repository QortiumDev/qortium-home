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
  HomeV2CoreReleaseOffer,
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
  HomeV2QortalAdoptionBrowseResult,
  HomeV2QortalAdoptionCandidate,
  HomeV2QortalAdoptionList,
  HomeV2QortalAdoptionSelectionResult,
} from '../../electron/home-v2-qortal-adoption-contract'
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
  HomeV2QortalAdoptionBrowseResult,
  HomeV2QortalAdoptionCandidate,
  HomeV2QortalAdoptionList,
  HomeV2QortalAdoptionSelectionResult,
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
    !hasExactKeys(value.capabilities, [
      'canInitialInstall', 'canInstallJava', 'canRefreshHelpers', 'canUpdateRunningInPlace',
    ]) || typeof value.capabilities.canRefreshHelpers !== 'boolean' ||
    typeof value.capabilities.canInstallJava !== 'boolean' ||
    typeof value.capabilities.canUpdateRunningInPlace !== 'boolean' || !isRecord(value.core) ||
    !hasExactKeys(value.core, [
      'channel', 'helpersOutOfSyncVersion', 'installedCommit', 'installModified',
      'installedTag', 'installedVersion', 'localApiUrl', 'nodeAutoUpdateMode', 'runtime',
      'runtimeBlockedReason', 'update',
    ]) ||
    !(value.core.update === null || (isRecord(value.core.update) &&
      hasExactKeys(value.core.update, ['action', 'source', 'version']) &&
      ['available', 'handled-by-core', 'installing'].includes(String(value.core.update.action)) &&
      (value.core.update.source === 'github' || value.core.update.source === 'on-chain') &&
      typeof value.core.update.version === 'string' && value.core.update.version.length > 0)) ||
    !(value.core.localApiUrl === null || typeof value.core.localApiUrl === 'string') ||
    typeof value.core.installModified !== 'boolean' ||
    !(value.core.helpersOutOfSyncVersion === null ||
      typeof value.core.helpersOutOfSyncVersion === 'string') ||
    !(value.core.nodeAutoUpdateMode === null || typeof value.core.nodeAutoUpdateMode === 'string') ||
    !(value.core.runtimeBlockedReason === null ||
      typeof value.core.runtimeBlockedReason === 'string') ||
    !(value.core.installedCommit === null || typeof value.core.installedCommit === 'string') ||
    !(value.core.installedTag === null || typeof value.core.installedTag === 'string') ||
    !(value.core.channel === null || value.core.channel === 'stable' || value.core.channel === 'prerelease') ||
    !(value.core.installedVersion === null || typeof value.core.installedVersion === 'string') ||
    !runtimeStates.has(value.core.runtime as HomeV2CoreRuntimeState) || !isRecord(value.java) ||
    !hasExactKeys(value.java, ['source', 'targetMajorVersion', 'updateAvailable', 'version']) ||
    !(value.java.targetMajorVersion === null ||
      (typeof value.java.targetMajorVersion === 'number' &&
        Number.isSafeInteger(value.java.targetMajorVersion))) ||
    !['managed', 'missing', 'system', 'unsupported'].includes(String(value.java.source)) ||
    typeof value.java.updateAvailable !== 'boolean' ||
    !(value.java.version === null || typeof value.java.version === 'string')) {
    throw new Error('Invalid Home 2 Core maintenance status.')
  }
  return Object.freeze({
    capabilities: Object.freeze({
      canInitialInstall: value.capabilities.canInitialInstall,
      canInstallJava: value.capabilities.canInstallJava,
      canRefreshHelpers: value.capabilities.canRefreshHelpers,
      canUpdateRunningInPlace: value.capabilities.canUpdateRunningInPlace,
    }),
    core: Object.freeze({
      channel: value.core.channel,
      // Copied through, not merely validated: a field the parser checks and
      // then forgets to return reads as undefined in the UI, which is how
      // canUpdateRunningInPlace was dead in the app while every main-process
      // test passed (#436). The round trip is asserted in the client test.
      helpersOutOfSyncVersion: value.core.helpersOutOfSyncVersion,
      installedCommit: value.core.installedCommit,
      localApiUrl: value.core.localApiUrl,
      update: value.core.update === null ? null : Object.freeze({
        action: (value.core.update as Record<string, string>).action as
          'available' | 'handled-by-core' | 'installing',
        source: (value.core.update as Record<string, string>).source as 'github' | 'on-chain',
        version: (value.core.update as Record<string, string>).version,
      }),
      installModified: value.core.installModified,
      installedTag: value.core.installedTag,
      nodeAutoUpdateMode: value.core.nodeAutoUpdateMode,
      runtimeBlockedReason: value.core.runtimeBlockedReason,
      installedVersion: value.core.installedVersion,
      runtime: value.core.runtime,
    }),
    java: Object.freeze({
      source: value.java.source,
      targetMajorVersion: value.java.targetMajorVersion,
      updateAvailable: value.java.updateAvailable,
      version: value.java.version,
    }),
    revision: 1,
    schema: 'home-v2-core-maintenance',
  }) as HomeV2CoreMaintenanceStatus
}

export function parseHomeV2CoreMaintenanceRelease(value: unknown): HomeV2CoreMaintenanceRelease {
  if (!isRecord(value) ||
    !hasExactKeys(value, ['action', 'available', 'channel', 'offers', 'revision', 'schema', 'tag']) ||
    value.schema !== 'home-v2-core-maintenance-release' || value.revision !== 1 ||
    (value.channel !== 'stable' && value.channel !== 'prerelease') || typeof value.available !== 'boolean' ||
    !['initial-install', 'none', 'strict-update'].includes(String(value.action)) ||
    !(value.tag === null || typeof value.tag === 'string') ||
    !Array.isArray(value.offers) ||
    !value.offers.every((offer) => isRecord(offer) &&
      hasExactKeys(offer, ['channel', 'relation', 'tag']) &&
      (offer.channel === 'stable' || offer.channel === 'prerelease') &&
      ['downgrade', 'initial-install', 'update'].includes(String(offer.relation)) &&
      typeof offer.tag === 'string' && offer.tag.length > 0 && offer.tag.length <= 80)) {
    throw new Error('Invalid Home 2 Core maintenance release.')
  }
  // Every field is copied out by name rather than spread-and-cast. The previous
  // spread meant a field the contract added but this parser did not list was
  // REJECTED outright by hasExactKeys -- not silently dropped, as in #436, but
  // enough to break release checking entirely -- and the trailing cast hid it
  // from the type checker.
  return Object.freeze({
    action: value.action as HomeV2CoreMaintenanceRelease['action'],
    available: value.available,
    channel: value.channel,
    offers: Object.freeze((value.offers as HomeV2CoreReleaseOffer[]).map((offer) =>
      Object.freeze({ channel: offer.channel, relation: offer.relation, tag: offer.tag }))),
    revision: 1,
    schema: 'home-v2-core-maintenance-release',
    tag: value.tag,
  }) as HomeV2CoreMaintenanceRelease
}

export function parseHomeV2CoreMaintenanceActionResult(value: unknown): HomeV2CoreMaintenanceActionResult {
  if (!isRecord(value) ||
    !hasExactKeys(value, ['code', 'downgrade', 'outcome', 'revision', 'schema', 'status']) ||
    value.schema !== 'home-v2-core-maintenance-action' || value.revision !== 1 ||
    !['blocked', 'completed', 'failed'].includes(String(value.outcome)) ||
    !(value.code === null || ['action-not-allowed', 'downgrade-confirmation-required',
      'operation-failed', 'operation-in-progress', 'release-changed'].includes(String(value.code))) ||
    !(value.downgrade === null || (isRecord(value.downgrade) &&
      hasExactKeys(value.downgrade, ['installedVersion', 'targetVersion']) &&
      typeof value.downgrade.installedVersion === 'string' &&
      typeof value.downgrade.targetVersion === 'string')) ||
    // A confirmation prompt with nothing to name would be unanswerable.
    (value.code === 'downgrade-confirmation-required' && value.downgrade === null)) {
    throw new Error('Invalid Home 2 Core maintenance action result.')
  }
  return Object.freeze({
    code: value.code,
    downgrade: value.downgrade === null ? null : Object.freeze({
      installedVersion: (value.downgrade as Record<string, string>).installedVersion,
      targetVersion: (value.downgrade as Record<string, string>).targetVersion,
    }),
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
    'lastRelease',
    'lastReleaseCheckedAt',
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
    (value.install !== 'missing' && value.issue === null && value.discovery !== 'not-applicable') ||
    !(value.lastReleaseCheckedAt === null || (
      typeof value.lastReleaseCheckedAt === 'string' &&
      Number.isFinite(Date.parse(value.lastReleaseCheckedAt))
    )) ||
    // A cached release is only meaningful when checking is allowed at all.
    (value.lastRelease !== null && !value.capabilities.canCheckRelease)) {
    throw new Error('Invalid Home 2 Qortal maintenance status.')
  }
  const lastRelease = value.lastRelease === null
    ? null
    : parseHomeV2QortalMaintenanceRelease(value.lastRelease)
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
    lastRelease,
    lastReleaseCheckedAt: value.lastReleaseCheckedAt as string | null,
    network: 'qortal',
    revision: 1,
    runtime: value.runtime,
    schema: 'home-v2-qortal-maintenance',
    updateAuthority: value.updateAuthority,
  }) as HomeV2QortalMaintenanceStatus
}

const qortalAdoptionOrigins = new Set<HomeV2QortalAdoptionCandidate['origins'][number]>([
  'default-location',
  'qortal-hub',
  'running-process',
  'user-selected',
])
const qortalAdoptionListStates = new Set<HomeV2QortalAdoptionList['state']>([
  'complete',
  'incomplete',
  'not-applicable',
  'unsupported',
])
const qortalAdoptionListCodes = new Set<NonNullable<HomeV2QortalAdoptionList['code']>>([
  'discovery-incomplete',
  'manager-unavailable',
  'status-unavailable',
  'unsupported-platform',
])
const qortalAdoptionSelectionCodes = new Set<
  NonNullable<HomeV2QortalAdoptionSelectionResult['code']>
>([
  'candidate-changed',
  'candidate-expired',
  'operation-in-progress',
  'persistence-unknown',
  'unsupported-platform',
])
const qortalAdoptionSelectionOutcomes = new Set<HomeV2QortalAdoptionSelectionResult['outcome']>([
  'blocked',
  'completed',
  'failed',
])

function isBoundedOpaqueCandidateId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
}

function parseHomeV2QortalAdoptionCandidate(value: unknown): HomeV2QortalAdoptionCandidate {
  if (!isRecord(value) || !hasExactKeys(value, [
    'candidateId',
    'hubHint',
    'origins',
    'runningProcessMatch',
    'version',
  ]) || !isBoundedOpaqueCandidateId(value.candidateId) || typeof value.hubHint !== 'boolean' ||
    !Array.isArray(value.origins) || value.origins.length < 1 ||
    value.origins.some((origin) => !qortalAdoptionOrigins.has(
      origin as HomeV2QortalAdoptionCandidate['origins'][number],
    )) || new Set(value.origins).size !== value.origins.length ||
    typeof value.runningProcessMatch !== 'boolean' ||
    !isBoundedQortalMaintenanceVersion(value.version)) {
    throw new Error('Invalid Home 2 Qortal adoption candidate.')
  }
  return Object.freeze({
    candidateId: value.candidateId,
    hubHint: value.hubHint,
    origins: Object.freeze([...value.origins]),
    runningProcessMatch: value.runningProcessMatch,
    version: value.version,
  }) as HomeV2QortalAdoptionCandidate
}

export function parseHomeV2QortalAdoptionList(value: unknown): HomeV2QortalAdoptionList {
  if (!isRecord(value) || !hasExactKeys(value, [
    'canBrowse',
    'canSelect',
    'candidates',
    'code',
    'network',
    'revision',
    'schema',
    'state',
  ]) || value.schema !== 'home-v2-qortal-adoption-list' || value.revision !== 1 ||
    value.network !== 'qortal' || typeof value.canBrowse !== 'boolean' ||
    typeof value.canSelect !== 'boolean' || !Array.isArray(value.candidates) ||
    value.candidates.length > 16 ||
    !qortalAdoptionListStates.has(value.state as HomeV2QortalAdoptionList['state']) ||
    !(value.code === null || qortalAdoptionListCodes.has(
      value.code as NonNullable<HomeV2QortalAdoptionList['code']>,
    ))) {
    throw new Error('Invalid Home 2 Qortal adoption list.')
  }
  const candidates = value.candidates.map(parseHomeV2QortalAdoptionCandidate)
  const ids = new Set(candidates.map((candidate) => candidate.candidateId))
  const state = value.state as HomeV2QortalAdoptionList['state']
  const code = value.code as HomeV2QortalAdoptionList['code']
  if (ids.size !== candidates.length ||
    (state === 'complete' && (code !== null || !value.canBrowse ||
      value.canSelect !== (candidates.length > 0))) ||
    (state === 'incomplete' && ((code !== 'discovery-incomplete' &&
      code !== 'manager-unavailable' && code !== 'status-unavailable') ||
      candidates.length !== 0 || value.canBrowse || value.canSelect)) ||
    (state === 'not-applicable' && (code !== null || candidates.length !== 0 ||
      value.canBrowse || value.canSelect)) ||
    (state === 'unsupported' && code !== 'unsupported-platform') ||
    (state === 'unsupported' && (value.canBrowse || value.canSelect)) ||
    (value.canSelect && candidates.length === 0)) {
    throw new Error('Invalid Home 2 Qortal adoption list.')
  }
  return Object.freeze({
    canBrowse: value.canBrowse,
    canSelect: value.canSelect,
    candidates: Object.freeze(candidates),
    code,
    network: 'qortal',
    revision: 1,
    schema: 'home-v2-qortal-adoption-list',
    state,
  }) as HomeV2QortalAdoptionList
}

export function parseHomeV2QortalAdoptionBrowseResult(
  value: unknown,
): HomeV2QortalAdoptionBrowseResult {
  if (!isRecord(value) || !hasExactKeys(value, [
    'canceled',
    'list',
    'network',
    'revision',
    'schema',
  ]) || value.schema !== 'home-v2-qortal-adoption-browse' || value.revision !== 1 ||
    value.network !== 'qortal' || typeof value.canceled !== 'boolean') {
    throw new Error('Invalid Home 2 Qortal adoption browse result.')
  }
  return Object.freeze({
    canceled: value.canceled,
    list: parseHomeV2QortalAdoptionList(value.list),
    network: 'qortal',
    revision: 1,
    schema: 'home-v2-qortal-adoption-browse',
  }) as HomeV2QortalAdoptionBrowseResult
}

export function parseHomeV2QortalAdoptionSelectionResult(
  value: unknown,
): HomeV2QortalAdoptionSelectionResult {
  if (!isRecord(value) || !hasExactKeys(value, [
    'code',
    'network',
    'outcome',
    'revision',
    'schema',
    'status',
  ]) || value.schema !== 'home-v2-qortal-adoption-selection' || value.revision !== 1 ||
    value.network !== 'qortal' ||
    !qortalAdoptionSelectionOutcomes.has(
      value.outcome as HomeV2QortalAdoptionSelectionResult['outcome'],
    ) ||
    !(value.code === null || qortalAdoptionSelectionCodes.has(
      value.code as NonNullable<HomeV2QortalAdoptionSelectionResult['code']>,
    )) ||
    (value.outcome === 'completed' && value.code !== null) ||
    (value.outcome !== 'completed' && value.code === null) ||
    (value.outcome === 'blocked' && value.code === 'persistence-unknown') ||
    (value.outcome === 'failed' && value.code !== 'persistence-unknown')) {
    throw new Error('Invalid Home 2 Qortal adoption selection result.')
  }
  const status = parseHomeV2QortalMaintenanceStatus(value.status)
  const outcome = value.outcome as HomeV2QortalAdoptionSelectionResult['outcome']
  return Object.freeze({
    code: value.code,
    network: 'qortal',
    outcome,
    revision: 1,
    schema: 'home-v2-qortal-adoption-selection',
    status,
  }) as HomeV2QortalAdoptionSelectionResult
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
  // Copied out by name, like the other parsers here. The spread this replaces
  // had the failure #454 hit: hasExactKeys REJECTS unknown keys, so the moment
  // the contract gained a field this parser would throw and break Qortal
  // release checking outright -- and the cast hid the mismatch from tsc.
  return Object.freeze({
    action: value.action as HomeV2QortalMaintenanceRelease['action'],
    available: value.available,
    code: value.code as HomeV2QortalMaintenanceRelease['code'],
    network: 'qortal',
    revision: 1,
    schema: 'home-v2-qortal-maintenance-release',
    tag: value.tag as string | null,
  }) as HomeV2QortalMaintenanceRelease
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
      'canSetModeWhileRunning',
      'canStopRouter',
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
    capabilities.canSetI2pOnly !== (canChangeStoppedCore && routerReady) ||
    capabilities.canStopRouter !== (routerState === 'managed-running' && !fatalIssue) ||
    capabilities.canSetModeWhileRunning !== (install === 'installed' && runtime === 'running' &&
      mode !== 'unknown' && !fatalIssue)) {
    throw new Error('Invalid Home 2 transport maintenance status.')
  }

  return Object.freeze({
    capabilities: Object.freeze({
      canEnsureRouter: capabilities.canEnsureRouter,
      canSetDirectAndI2p: capabilities.canSetDirectAndI2p,
      canSetDirectOnly: capabilities.canSetDirectOnly,
      canSetI2pOnly: capabilities.canSetI2pOnly,
      canSetModeWhileRunning: capabilities.canSetModeWhileRunning,
      canStopRouter: capabilities.canStopRouter,
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
    !(value.warning === null || value.warning === 'cleanup-incomplete' ||
      value.warning === 'restart-required') ||
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
    'qortalUpdatePolicy',
    'revision',
    'schema',
    'settingsIssue',
  ]) || value.schema !== 'home-v2-core-update-policy' || value.revision !== 1 ||
    !Number.isSafeInteger(value.generation) || (value.generation as number) < 0 ||
    !isPolicy(value.coreUpdatePolicy) ||
    !isPolicy(value.javaUpdatePolicy) ||
    !isPolicy(value.qortalUpdatePolicy) ||
    !(value.settingsIssue === null || value.settingsIssue === 'settings-unavailable') ||
    !isRecord(value.activity) ||
    !hasExactKeys(value.activity, ['checkedAt', 'core', 'generation', 'issue', 'java', 'qortal']) ||
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
    !isBoundedPolicyVersion(value.activity.java.version) ||
    !isRecord(value.activity.qortal) || !hasExactKeys(value.activity.qortal, ['state', 'version']) ||
    !policyActivityStates.has(value.activity.qortal.state as string) ||
    !isBoundedPolicyVersion(value.activity.qortal.version)) {
    throw new Error('Invalid Home 2 Core update policy state.')
  }
  return Object.freeze({
    activity: Object.freeze({
      checkedAt: value.activity.checkedAt,
      core: Object.freeze({ ...value.activity.core }),
      generation: value.activity.generation,
      issue: value.activity.issue,
      java: Object.freeze({ ...value.activity.java }),
      qortal: Object.freeze({ ...value.activity.qortal }),
    }),
    coreUpdatePolicy: value.coreUpdatePolicy,
    generation: value.generation,
    javaUpdatePolicy: value.javaUpdatePolicy,
    qortalUpdatePolicy: value.qortalUpdatePolicy,
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

export type HomeV2CoreMaintenanceProgress = Readonly<{
  action: 'checking' | 'downloading' | 'extracting' | 'idle' | 'starting' | 'stopping'
  kind: 'error' | 'info' | 'success'
  message: string
  /** null when the phase has no honest denominator (checking, extracting). */
  percent: number | null
}>

const progressActions = new Set([
  'checking', 'downloading', 'extracting', 'idle', 'starting', 'stopping',
])
const progressKinds = new Set(['error', 'info', 'success'])

/**
 * Parsed, never trusted. A malformed event yields null and the UI keeps
 * whatever it had, rather than rendering a wrong percentage or a blank bar.
 */
export function parseHomeV2CoreMaintenanceProgress(
  value: unknown,
): HomeV2CoreMaintenanceProgress | null {
  if (!isRecord(value) ||
    !hasExactKeys(value, ['action', 'kind', 'message', 'percent', 'revision', 'schema']) ||
    value.schema !== 'home-v2-core-manager-progress' || value.revision !== 1 ||
    typeof value.action !== 'string' || !progressActions.has(value.action) ||
    typeof value.kind !== 'string' || !progressKinds.has(value.kind) ||
    typeof value.message !== 'string' || value.message.length > 500 ||
    !(value.percent === null ||
      (typeof value.percent === 'number' && Number.isFinite(value.percent) &&
        value.percent >= 0 && value.percent <= 100))) {
    return null
  }
  return Object.freeze({
    action: value.action as HomeV2CoreMaintenanceProgress['action'],
    kind: value.kind as HomeV2CoreMaintenanceProgress['kind'],
    message: value.message,
    percent: value.percent as number | null,
  })
}

/**
 * The I2P router's install progress. Same shape as the Core's -- i2pd reports
 * the identical action set -- but its own schema so the two channels cannot be
 * confused for one another.
 */
export type HomeV2TransportProgress = HomeV2CoreMaintenanceProgress

export function parseHomeV2TransportProgress(
  value: unknown,
): HomeV2TransportProgress | null {
  if (!isRecord(value) ||
    !hasExactKeys(value, ['action', 'kind', 'message', 'percent', 'revision', 'schema']) ||
    value.schema !== 'home-v2-transport-progress' || value.revision !== 1 ||
    typeof value.action !== 'string' || !progressActions.has(value.action) ||
    typeof value.kind !== 'string' || !progressKinds.has(value.kind) ||
    typeof value.message !== 'string' || value.message.length > 500 ||
    !(value.percent === null ||
      (typeof value.percent === 'number' && Number.isFinite(value.percent) &&
        value.percent >= 0 && value.percent <= 100))) {
    return null
  }
  return Object.freeze({
    action: value.action as HomeV2TransportProgress['action'],
    kind: value.kind as HomeV2TransportProgress['kind'],
    message: value.message,
    percent: value.percent as number | null,
  })
}

export interface HomeV2CoreManagerClient {
  /** Optional: absent on hosts without the Electron preload (Android). */
  onMaintenanceProgress?(listener: (event: unknown) => void): () => void
  /** The I2P router's install progress. Optional for the same reason. */
  onTransportProgress?(listener: (event: unknown) => void): () => void
  getMaintenanceStatus(): Promise<HomeV2CoreMaintenanceStatus>
  checkMaintenanceRelease(): Promise<HomeV2CoreMaintenanceRelease>
  runMaintenanceAction(
    action: 'downgrade' | 'initial-install' | 'install-java' | 'refresh-helpers' | 'strict-update',
    release?: { channel: 'prerelease' | 'stable'; confirmDowngrade?: boolean; expectedTag: string },
  ): Promise<HomeV2CoreMaintenanceActionResult>
  getUpdatePolicy(): Promise<HomeV2CoreUpdatePolicyState>
  setUpdatePolicy(
    expectedGeneration: number,
    field: 'coreUpdatePolicy' | 'javaUpdatePolicy' | 'qortalUpdatePolicy',
    value: HomeV2CoreUpdatePolicy,
  ): Promise<HomeV2CoreUpdatePolicySetResult>
  getStatus(network: HomeV2CoreNetwork): Promise<HomeV2CoreManagerStatus>
  /**
   * Open the Core install folder in the desktop file manager.
   *
   * Optional: absent on hosts without the Electron preload. Resolves to whether
   * a folder opened; the path stays in the main process, so this control does
   * not weaken the redaction rule the status contracts enforce.
   */
  revealInstall?(): Promise<boolean>
  start(network: HomeV2CoreNetwork): Promise<HomeV2CoreManagerActionResult>
  stop(network: HomeV2CoreNetwork): Promise<HomeV2CoreManagerActionResult>
  listQortalAdoptionCandidates?(): Promise<HomeV2QortalAdoptionList>
  browseQortalAdoptionDirectory?(): Promise<HomeV2QortalAdoptionBrowseResult>
  selectQortalAdoptionCandidate?(
    candidateId: string,
  ): Promise<HomeV2QortalAdoptionSelectionResult>
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
