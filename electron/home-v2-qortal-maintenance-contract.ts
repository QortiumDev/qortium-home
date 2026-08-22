import type { IpcMainInvokeEvent } from 'electron'
import type { CoreManagerEntry } from './core-manager.js'
import { compareCoreVersions } from './core-version.js'
import { homeV2CoreOperationCoordinator } from './home-v2-core-operation-coordinator.js'
import type {
  QortalCoreManager,
  QortalCoreManagerStatus,
  QortalInstallResult,
  QortalManagerBlockCode,
  QortalUpdateResult,
} from './qortal-core-manager.js'
import {
  qortalLatestReleaseSource,
  type QortalLatestReleaseSource,
} from './qortal-latest-release-source.js'

export type HomeV2QortalMaintenanceDiscovery =
  | 'candidate-found'
  | 'clear'
  | 'multiple-candidates'
  | 'not-applicable'
  | 'unknown'

export type HomeV2QortalMaintenanceStatus = {
  readonly capabilities: {
    readonly canCheckRelease: boolean
    readonly canInitialInstall: boolean
    readonly canUpdate: boolean
  }
  readonly discovery: HomeV2QortalMaintenanceDiscovery
  readonly install: 'adopted' | 'home-managed' | 'missing' | 'unknown'
  readonly installedVersion: string | null
  readonly issue: 'manager-unavailable' | 'status-unavailable' | 'unsupported-platform' | null
  readonly network: 'qortal'
  readonly revision: 1
  readonly runtime: 'running' | 'stopped' | 'unknown'
  readonly schema: 'home-v2-qortal-maintenance'
  readonly updateAuthority: 'home-github' | 'node-native' | 'observe-only'
}

export type HomeV2QortalMaintenanceRelease = {
  readonly action: 'initial-install' | 'none' | 'strict-update'
  readonly available: boolean
  readonly code: 'action-not-allowed' | 'release-unavailable' | 'up-to-date' | 'version-unavailable' | null
  readonly network: 'qortal'
  readonly revision: 1
  readonly schema: 'home-v2-qortal-maintenance-release'
  readonly tag: string | null
}

export type HomeV2QortalMaintenanceActionCode =
  | 'action-not-allowed'
  | 'adopted-update-unsupported'
  | 'install-selection-required'
  | 'operation-failed'
  | 'operation-in-progress'
  | 'release-changed'
  | 'release-not-newer'
  | 'runtime-not-stopped'
  | 'target-changed'
  | 'update-node-native'
  | 'update-ownership-unknown'

export type HomeV2QortalMaintenanceActionResult = {
  readonly code: HomeV2QortalMaintenanceActionCode | null
  readonly network: 'qortal'
  readonly outcome: 'blocked' | 'completed' | 'failed'
  readonly revision: 1
  readonly schema: 'home-v2-qortal-maintenance-action'
  readonly status: HomeV2QortalMaintenanceStatus
  readonly warning: 'cleanup-incomplete' | null
}

type QortalManagerResolver = () => CoreManagerEntry
export type HomeV2QortalDiscoveryProbe = (
  manager: QortalCoreManager,
) => Promise<Exclude<HomeV2QortalMaintenanceDiscovery, 'not-applicable'>>

export type HomeV2QortalMaintenanceDependencies = {
  readonly probeDiscovery: HomeV2QortalDiscoveryProbe
  readonly releaseSource?: QortalLatestReleaseSource
  readonly resolveManager: QortalManagerResolver
}

type MutationRequest = {
  readonly action: 'initial-install' | 'strict-update'
  readonly expectedTag: string
}

const SAFE_TAG = /^v[a-z0-9][a-z0-9._-]{0,126}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function normalizeEmptyRequest(value: unknown, schema: string) {
  if (!isRecord(value) || !hasExactKeys(value, ['network', 'revision', 'schema']) ||
    value.schema !== schema || value.revision !== 1 || value.network !== 'qortal') {
    throw new Error('An exact Qortal maintenance request is required.')
  }
}

function normalizeMutationRequest(value: unknown): MutationRequest {
  if (!isRecord(value) || !hasExactKeys(value, [
    'action', 'expectedTag', 'network', 'revision', 'schema',
  ]) || value.schema !== 'home-v2-qortal-maintenance-mutation-request' ||
    value.revision !== 1 || value.network !== 'qortal' ||
    (value.action !== 'initial-install' && value.action !== 'strict-update') ||
    typeof value.expectedTag !== 'string' || !SAFE_TAG.test(value.expectedTag)) {
    throw new Error('An exact Qortal maintenance mutation request is required.')
  }
  return { action: value.action, expectedTag: value.expectedTag }
}

function boundedVersion(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null
}

function unavailableStatus(
  issue: HomeV2QortalMaintenanceStatus['issue'],
): HomeV2QortalMaintenanceStatus {
  return {
    capabilities: { canCheckRelease: false, canInitialInstall: false, canUpdate: false },
    discovery: 'unknown',
    install: 'unknown',
    installedVersion: null,
    issue,
    network: 'qortal',
    revision: 1,
    runtime: 'unknown',
    schema: 'home-v2-qortal-maintenance',
    updateAuthority: 'observe-only',
  }
}

function installedVersion(status: QortalCoreManagerStatus) {
  if (status.install.kind === 'home-managed') {
    return boundedVersion(status.install.record.jarIdentity.semver)
  }
  if (status.install.kind === 'adopted') {
    return boundedVersion(status.install.record.adoptedJar.semver)
  }
  return null
}

async function readStatus(
  dependencies: HomeV2QortalMaintenanceDependencies,
): Promise<HomeV2QortalMaintenanceStatus> {
  let manager: QortalCoreManager
  try {
    const resolved = dependencies.resolveManager()
    if (resolved.networkId !== 'qortal') return unavailableStatus('manager-unavailable')
    manager = resolved
  } catch {
    return unavailableStatus('manager-unavailable')
  }

  try {
    const status = await manager.getStatus()
    const discovery = status.install.kind === 'missing'
      ? await dependencies.probeDiscovery(manager).catch(() => 'unknown' as const)
      : 'not-applicable'
    const version = installedVersion(status)
    const canInitialInstall = status.capabilities.canInitialInstall &&
      status.install.kind === 'missing' && status.runtime.state === 'stopped' && discovery === 'clear'
    const canUpdate = status.capabilities.canUpdate && status.install.kind === 'home-managed' &&
      status.runtime.state === 'stopped' && status.updateOwnership.ownership === 'home-github'
    const canCheckRelease = canInitialInstall || (
      status.install.kind === 'home-managed' && version !== null &&
      status.updateOwnership.ownership === 'home-github'
    )

    return {
      capabilities: { canCheckRelease, canInitialInstall, canUpdate },
      discovery,
      install: status.install.kind,
      installedVersion: version,
      issue: null,
      network: 'qortal',
      revision: 1,
      runtime: status.runtime.state,
      schema: 'home-v2-qortal-maintenance',
      updateAuthority: status.updateOwnership.ownership,
    }
  } catch {
    return unavailableStatus('status-unavailable')
  }
}

function releaseResult(
  action: HomeV2QortalMaintenanceRelease['action'],
  available: boolean,
  code: HomeV2QortalMaintenanceRelease['code'],
  tag: string | null,
): HomeV2QortalMaintenanceRelease {
  return {
    action,
    available,
    code,
    network: 'qortal',
    revision: 1,
    schema: 'home-v2-qortal-maintenance-release',
    tag,
  }
}

async function checkRelease(
  dependencies: HomeV2QortalMaintenanceDependencies,
): Promise<HomeV2QortalMaintenanceRelease> {
  const status = await readStatus(dependencies)
  if (!status.capabilities.canCheckRelease) {
    return releaseResult('none', false, 'action-not-allowed', null)
  }
  const source = dependencies.releaseSource ?? qortalLatestReleaseSource
  const latest = await source.getLatest()
  if (latest.kind !== 'available') {
    return releaseResult('none', false, 'release-unavailable', null)
  }
  if (status.install === 'missing') {
    return releaseResult('initial-install', true, null, latest.release.tagName)
  }
  if (!status.installedVersion) {
    return releaseResult('none', true, 'version-unavailable', latest.release.tagName)
  }
  const comparison = compareCoreVersions(latest.release.tagName, status.installedVersion)
  if (comparison === null) {
    return releaseResult('none', true, 'version-unavailable', latest.release.tagName)
  }
  return comparison > 0
    ? releaseResult('strict-update', true, null, latest.release.tagName)
    : releaseResult('none', true, 'up-to-date', latest.release.tagName)
}

function mapBlockCode(code: QortalManagerBlockCode): HomeV2QortalMaintenanceActionCode {
  switch (code) {
    case 'adopted-unsupported':
      return 'adopted-update-unsupported'
    case 'install-not-missing':
    case 'external-install-detected':
      return 'install-selection-required'
    case 'process-active':
    case 'process-state-unknown':
      return 'runtime-not-stopped'
    case 'release-not-newer':
      return 'release-not-newer'
    case 'candidate-changed':
    case 'launch-authority-invalid':
    case 'target-changed':
      return 'target-changed'
    case 'update-node-native':
      return 'update-node-native'
    case 'update-ownership-unknown':
      return 'update-ownership-unknown'
    case 'invalid-release':
      return 'release-changed'
    default:
      return 'action-not-allowed'
  }
}

function normalizeManagerResult(
  value: QortalInstallResult | QortalUpdateResult,
): Pick<HomeV2QortalMaintenanceActionResult, 'code' | 'outcome' | 'warning'> {
  if (value.kind === 'completed-with-warning') {
    const nested = normalizeManagerResult(value.outcome)
    return { ...nested, warning: 'cleanup-incomplete' }
  }
  if (value.kind === 'blocked') {
    return { code: mapBlockCode(value.code), outcome: 'blocked', warning: null }
  }
  if (value.kind === 'failed') {
    return { code: 'operation-failed', outcome: 'failed', warning: null }
  }
  return { code: null, outcome: 'completed', warning: null }
}

function actionResult(
  status: HomeV2QortalMaintenanceStatus,
  outcome: HomeV2QortalMaintenanceActionResult['outcome'],
  code: HomeV2QortalMaintenanceActionResult['code'],
  warning: HomeV2QortalMaintenanceActionResult['warning'] = null,
): HomeV2QortalMaintenanceActionResult {
  return {
    code,
    network: 'qortal',
    outcome,
    revision: 1,
    schema: 'home-v2-qortal-maintenance-action',
    status,
    warning,
  }
}

async function runMutation(
  request: MutationRequest,
  dependencies: HomeV2QortalMaintenanceDependencies,
) {
  const lease = homeV2CoreOperationCoordinator.tryBeginInteractive(['qortal'])
  if (!lease) {
    return actionResult(await readStatus(dependencies), 'blocked', 'operation-in-progress')
  }

  try {
    const preflight = await readStatus(dependencies)
    const allowed = request.action === 'initial-install'
      ? preflight.capabilities.canInitialInstall
      : preflight.capabilities.canUpdate
    if (!allowed) {
      const code: HomeV2QortalMaintenanceActionCode = preflight.discovery !== 'clear' &&
        preflight.discovery !== 'not-applicable'
        ? 'install-selection-required'
        : preflight.install === 'adopted'
          ? 'adopted-update-unsupported'
          : preflight.updateAuthority === 'node-native'
            ? 'update-node-native'
            : preflight.updateAuthority === 'observe-only' && preflight.install === 'home-managed'
              ? 'update-ownership-unknown'
              : preflight.runtime !== 'stopped'
                ? 'runtime-not-stopped'
                : 'action-not-allowed'
      return actionResult(preflight, 'blocked', code)
    }

    const source = dependencies.releaseSource ?? qortalLatestReleaseSource
    const latest = await source.getExpectedLatest(request.expectedTag)
    if (latest.kind !== 'available') {
      return actionResult(
        await readStatus(dependencies),
        latest.code === 'release-changed' ? 'blocked' : 'failed',
        latest.code === 'release-changed' ? 'release-changed' : 'operation-failed',
      )
    }

    // Discovery, runtime state, and update ownership may change while GitHub is
    // being queried. Re-read all public gates before the manager is allowed to
    // stage any bytes; the manager then repeats its target/runtime/ownership
    // barriers around the filesystem transaction itself.
    const mutationPreflight = await readStatus(dependencies)
    const stillAllowed = request.action === 'initial-install'
      ? mutationPreflight.capabilities.canInitialInstall
      : mutationPreflight.capabilities.canUpdate
    if (!stillAllowed) {
      return actionResult(mutationPreflight, 'blocked',
        mutationPreflight.discovery !== 'clear' && mutationPreflight.discovery !== 'not-applicable'
          ? 'install-selection-required'
          : mutationPreflight.install === 'adopted'
            ? 'adopted-update-unsupported'
            : mutationPreflight.updateAuthority === 'node-native'
              ? 'update-node-native'
              : mutationPreflight.updateAuthority === 'observe-only' &&
                  mutationPreflight.install === 'home-managed'
                ? 'update-ownership-unknown'
                : mutationPreflight.runtime !== 'stopped'
                  ? 'runtime-not-stopped'
                  : 'action-not-allowed')
    }

    if (request.action === 'strict-update') {
      const comparison = mutationPreflight.installedVersion
        ? compareCoreVersions(latest.release.tagName, mutationPreflight.installedVersion)
        : null
      if (comparison === null || comparison <= 0) {
        return actionResult(await readStatus(dependencies), 'blocked', 'release-not-newer')
      }
    }

    let manager: QortalCoreManager
    try {
      const resolved = dependencies.resolveManager()
      if (resolved.networkId !== 'qortal') {
        return actionResult(unavailableStatus('manager-unavailable'), 'blocked', 'action-not-allowed')
      }
      manager = resolved
    } catch {
      return actionResult(unavailableStatus('manager-unavailable'), 'blocked', 'action-not-allowed')
    }

    const normalized = normalizeManagerResult(
      request.action === 'initial-install'
        ? await manager.install(latest.rawRelease)
        : await manager.update(latest.rawRelease),
    )
    return actionResult(
      await readStatus(dependencies),
      normalized.outcome,
      normalized.code,
      normalized.warning,
    )
  } catch {
    return actionResult(await readStatus(dependencies), 'failed', 'operation-failed')
  } finally {
    lease.release()
  }
}

export function createHomeV2QortalMaintenanceService(
  dependencies: HomeV2QortalMaintenanceDependencies,
) {
  return {
    async getStatus(value: unknown) {
      normalizeEmptyRequest(value, 'home-v2-qortal-maintenance-request')
      return await readStatus(dependencies)
    },
    async checkRelease(value: unknown) {
      normalizeEmptyRequest(value, 'home-v2-qortal-maintenance-release-request')
      return await checkRelease(dependencies)
    },
    async runAction(value: unknown) {
      return await runMutation(normalizeMutationRequest(value), dependencies)
    },
  }
}

export function createAuthorizedHomeV2QortalMaintenanceHandlers(
  assertAuthorized: (event: IpcMainInvokeEvent) => void,
  service: ReturnType<typeof createHomeV2QortalMaintenanceService>,
) {
  return {
    getStatus(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.getStatus(value)
    },
    checkRelease(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.checkRelease(value)
    },
    runAction(event: IpcMainInvokeEvent, value: unknown) {
      assertAuthorized(event)
      return service.runAction(value)
    },
  }
}
