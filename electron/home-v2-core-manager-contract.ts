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
    /**
     * A running, Home-started Core may be updated in place: Home stops it,
     * replaces the files, and starts it again, restoring the previous install
     * if anything fails.
     *
     * Requires BOTH that Home owns the process (a Core someone else started is
     * not ours to stop) and that an install already exists (otherwise there is
     * nothing to roll back to). Never true for an initial install.
     */
    readonly canUpdateRunningInPlace: boolean
  }
  readonly core: {
    readonly channel: 'prerelease' | 'stable' | null
    /** The commit the installed jar was built from, or null. */
    readonly installedCommit: string | null
    /**
     * Why the runtime is blocked, in words, or null.
     *
     * The status already carried `issue: 'runtime-blocked'`, which tells the
     * user THAT something is wrong and nothing about what. The message names
     * the two networks and their chain hashes — no paths, which is what keeps
     * it inside this contract's redaction rule.
     */
    readonly runtimeBlockedReason: string | null
    /** The node's own on-chain auto-update mode, or null. */
    readonly nodeAutoUpdateMode: string | null
    /** The release tag it was installed from, or null. */
    readonly installedTag: string | null
    /**
     * Whether the installed jar no longer matches what Home installed.
     *
     * Home 1.x said so plainly ("modified since install") and used it to offer
     * a way back. Home 2 never surfaced it at all, so a tampered or damaged
     * install was invisible -- which matters more than any repair button,
     * because nothing can be acted on that is never shown.
     */
    readonly installModified: boolean
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

/**
 * One installable release, and how it relates to what is installed.
 *
 * Home 2 previously computed a single action against a single channel, so the
 * user could only ever move to a strictly newer build on whichever channel was
 * already installed. core-manager has always supported more than that; this is
 * the contract catching up.
 */
export type HomeV2CoreReleaseOffer = {
  readonly channel: 'prerelease' | 'stable'
  readonly relation: 'initial-install' | 'update'
  readonly tag: string
}

export type HomeV2CoreMaintenanceRelease = {
  readonly action: 'initial-install' | 'none' | 'strict-update'
  readonly available: boolean
  readonly channel: 'prerelease' | 'stable'
  /**
   * Every release the user may choose, newest-first.
   *
   * The stable release is always offered when one is verified. The prerelease
   * is offered only when it is strictly newer than that stable release, so the
   * list never suggests a prerelease that is already behind.
   */
  readonly offers: readonly HomeV2CoreReleaseOffer[]
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
      canUpdateRunningInPlace: supported && !!installed && runtime?.owner === 'home',
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
      installModified: installed?.modifiedSinceInstall === true,
      installedVersion:
        typeof installed?.jarSemver === 'string' && installed.jarSemver.trim()
          ? installed.jarSemver.trim()
          : typeof installed?.tagName === 'string' && installed.tagName.trim()
            ? installed.tagName.trim()
            : null,
      /**
       * The build actually installed, beyond its semver.
       *
       * Home 1.x showed these; Home 2 showed only the version, so two builds
       * of the same version were indistinguishable. Both are ordinary build
       * identity — deliberately NOT the install path or the jar path, which
       * this contract redacts (see assertRedacted in the contract test).
       */
      nodeAutoUpdateMode: typeof status.nodeAutoUpdateMode === 'string' &&
        status.nodeAutoUpdateMode.trim()
        ? status.nodeAutoUpdateMode.trim().slice(0, 40)
        : null,
      runtimeBlockedReason: isRecord(runtime?.blocked) &&
        typeof runtime.blocked.message === 'string' && runtime.blocked.message.trim()
        ? runtime.blocked.message.trim().slice(0, 500)
        : null,
      installedCommit: typeof installed?.jarCommit === 'string' && installed.jarCommit.trim()
        ? installed.jarCommit.trim().slice(0, 40)
        : null,
      installedTag: typeof installed?.tagName === 'string' && installed.tagName.trim()
        ? installed.tagName.trim().slice(0, 100)
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
      offers: buildReleaseOffers(releases, installedVersion),
      revision: 1,
      schema: 'home-v2-core-maintenance-release',
      tag: verifiedRelease && release.available ? release.tagName : null,
    }
  } catch {
    return {
      action: 'none',
      available: false,
      channel,
      offers: [],
      revision: 1,
      schema: 'home-v2-core-maintenance-release',
      tag: null,
    }
  }
}

/**
 * Which releases the user may choose between.
 *
 * Always the newest verified stable. The prerelease joins it only when it is
 * strictly newer, so the list never offers a prerelease that trails the stable
 * one. Each entry says how it relates to the installed build, including
 * `reinstall` for the same version again -- the repair case.
 */
type ReleaseCandidate = { readonly available: boolean; readonly commit?: unknown; readonly tagName?: unknown }

function buildReleaseOffers(
  releases: Record<'prerelease' | 'stable', ReleaseCandidate>,
  installedVersion: string | null,
): readonly HomeV2CoreReleaseOffer[] {
  // The unavailable arm of CoreReleaseSummary carries no tag or commit at all,
  // so every field is checked rather than assumed present.
  const tagOf = (entry: ReleaseCandidate) =>
    entry.available && typeof entry.tagName === 'string' && entry.tagName
      ? entry.tagName
      : null
  const verified = (entry: ReleaseCandidate) =>
    tagOf(entry) !== null && typeof entry.commit === 'string' &&
    /^[0-9a-f]{40}$/i.test(entry.commit)

  const relationFor = (tag: string): HomeV2CoreReleaseOffer['relation'] | null => {
    if (!installedVersion) return 'initial-install'
    const comparison = compareCoreVersions(tag, installedVersion)
    if (comparison === null) return null
    if (comparison > 0) return 'update'
    // Same version (repair) and older (downgrade) are deliberately NOT offered
    // yet. core-manager has exactly two install modes, 'initial-install' and
    // 'strict-update', and every guard tests for one of those by name --
    // including the release commit verification and
    // assertHomeV2CoreMaintenanceActivationSafe. `mode` is typed `unknown`, so
    // inventing a third value would not repair anything; it would fall straight
    // through those checks. 'strict-update' itself throws on a same-version
    // install. Both cases need a real mode in core-manager first.
    return null
  }

  const offers: HomeV2CoreReleaseOffer[] = []
  const stableTag = verified(releases.stable) ? tagOf(releases.stable) : null
  if (stableTag) {
    const relation = relationFor(stableTag)
    if (relation) offers.push({ channel: 'stable', relation, tag: stableTag })
  }
  const prereleaseTag = verified(releases.prerelease) ? tagOf(releases.prerelease) : null
  if (prereleaseTag) {
    const newerThanStable = stableTag === null ||
      (compareCoreVersions(prereleaseTag, stableTag) ?? 0) > 0
    const relation = relationFor(prereleaseTag)
    if (newerThanStable && relation) {
      offers.push({ channel: 'prerelease', relation, tag: prereleaseTag })
    }
  }
  return Object.freeze(offers)
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
    // A running Core no longer blocks an UPDATE outright — but only when Home
    // started it and an install exists to fall back to, which is exactly what
    // canUpdateRunningInPlace encodes and exactly what core-manager's
    // stop -> replace -> restart dance requires. Initial installs still demand
    // a stopped Core: they have no previous version to restore.
    const runningUpdateAllowed = request.action !== 'initial-install' &&
      status.capabilities.canUpdateRunningInPlace
    if ((status.core.runtime !== 'stopped' && !runningUpdateAllowed) ||
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
