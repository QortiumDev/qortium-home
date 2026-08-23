import type { CoreManagerEntry } from './core-manager.js'
import { compareCoreVersions } from './core-version.js'
import type { HomeV2CoreUpdatePolicySettings } from './home-v2-core-update-policy-codec.js'
import { homeV2CoreOperationCoordinator } from './home-v2-core-operation-coordinator.js'
import {
  qortalLatestReleaseSource,
  type QortalLatestReleaseSource,
} from './qortal-latest-release-source.js'

export type HomeV2CoreUpdateActivityState =
  | 'available'
  | 'checking'
  | 'failed'
  | 'idle'
  | 'installing'
  | 'pending-safe-state'
  | 'up-to-date'

export type HomeV2CoreUpdateActivity = Readonly<{
  checkedAt: string | null
  core: Readonly<{
    channel: 'prerelease' | 'stable' | null
    state: HomeV2CoreUpdateActivityState
    version: string | null
  }>
  generation: number | null
  issue: 'check-failed' | 'operation-busy' | 'operation-failed' | 'policy-revoked' | 'settings-unavailable' | null
  java: Readonly<{
    state: HomeV2CoreUpdateActivityState
    version: string | null
  }>
  qortal: Readonly<{
    state: HomeV2CoreUpdateActivityState
    version: string | null
  }>
}>

type QortiumManager = Extract<CoreManagerEntry, { networkId: 'qortium' }>
type QortalManager = Extract<CoreManagerEntry, { networkId: 'qortal' }>
type Dependencies = Readonly<{
  qortalReleaseSource?: QortalLatestReleaseSource
  readSettings(): Promise<HomeV2CoreUpdatePolicySettings>
  resolveManager(): QortiumManager
  resolveQortalManager(): QortalManager
}>

export const idleHomeV2CoreUpdateActivity = (generation: number | null = null): HomeV2CoreUpdateActivity => ({
  checkedAt: null,
  core: { channel: null, state: 'idle', version: null },
  generation,
  issue: null,
  java: { state: 'idle', version: null },
  qortal: { state: 'idle', version: null },
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

class PolicyRevokedError extends Error {}
class OperationBusyError extends Error {}

export function createHomeV2CoreUpdatePolicyEngine(dependencies: Dependencies) {
  let activity = idleHomeV2CoreUpdateActivity()

  const requireCurrentInstallPolicy = async (
    expected: HomeV2CoreUpdatePolicySettings,
    field: 'coreUpdatePolicy' | 'javaUpdatePolicy' | 'qortalUpdatePolicy',
    revision: number,
  ) => {
    const current = await dependencies.readSettings()
    if (current.storageIssue || current.generation !== expected.generation ||
      current[field] !== 'install' ||
      !homeV2CoreOperationCoordinator.isAutomaticRevisionCurrent(revision)) {
      throw new PolicyRevokedError('Automatic update policy changed.')
    }
  }

  const activationLease = (
    expected: HomeV2CoreUpdatePolicySettings,
    field: 'coreUpdatePolicy' | 'javaUpdatePolicy' | 'qortalUpdatePolicy',
    revision: number,
    networks: readonly ('qortal' | 'qortium')[],
  ) => async () => {
    await requireCurrentInstallPolicy(expected, field, revision)
    const lease = homeV2CoreOperationCoordinator.tryBeginAutomatic(networks, revision)
    if (!lease) throw new OperationBusyError('A Core operation is already in progress.')
    try {
      await requireCurrentInstallPolicy(expected, field, revision)
      return lease.release
    } catch (error) {
      lease.release()
      throw error
    }
  }

  return {
    getActivity() {
      return activity
    },
    async runPass() {
      const settings = await dependencies.readSettings()
      if (settings.storageIssue) {
        activity = {
          ...idleHomeV2CoreUpdateActivity(settings.generation),
          checkedAt: new Date().toISOString(),
          issue: 'settings-unavailable',
        }
        return activity
      }
      const revision = homeV2CoreOperationCoordinator.automaticRevision
      const checkCore = settings.coreUpdatePolicy !== 'off'
      const checkJava = settings.javaUpdatePolicy !== 'off'
      const checkQortal = settings.qortalUpdatePolicy !== 'off'
      activity = {
        checkedAt: activity.checkedAt,
        core: { channel: null, state: checkCore ? 'checking' : 'idle', version: null },
        generation: settings.generation,
        issue: null,
        java: { state: checkJava ? 'checking' : 'idle', version: null },
        qortal: { state: checkQortal ? 'checking' : 'idle', version: null },
      }
      if (!checkCore && !checkJava && !checkQortal) return activity

      let core = activity.core
      let java = activity.java
      let qortal = activity.qortal
      let issue: HomeV2CoreUpdateActivity['issue'] = null

      if (checkCore || checkJava) {
        try {
          const manager = dependencies.resolveManager()
          const rawStatus = await manager.getAutomaticUpdateStatusForHomeV2({
            refreshManagedJava: checkJava,
          })
          const status: Record<string, unknown> = isRecord(rawStatus) ? rawStatus : {}
          const installed = isRecord(status.installed) ? status.installed : null
          const javaStatus = isRecord(status.java) ? status.java : null
          const channel: 'stable' | 'prerelease' | null =
            installed?.channel === 'stable' || installed?.channel === 'prerelease'
            ? installed.channel
            : null
          const installedVersion = typeof installed?.jarSemver === 'string'
            ? installed.jarSemver
            : typeof installed?.tagName === 'string' ? installed.tagName : null
          const releases = checkCore && installedVersion ? await manager.checkReleases() : null
          const release = channel && releases ? releases[channel] : null
          const coreCandidate = !!installedVersion && !!release?.available &&
            /^[0-9a-f]{40}$/i.test(release.commit) &&
            compareCoreVersions(release.tagName, installedVersion) === 1
          const javaCandidate = javaStatus?.source === 'managed' &&
            javaStatus.managedUpgradeAvailable === true &&
            typeof javaStatus.updateAvailableVersion === 'string'
          let coreState: HomeV2CoreUpdateActivityState = coreCandidate ? 'available' : 'up-to-date'
          let javaState: HomeV2CoreUpdateActivityState = javaCandidate ? 'available' : 'up-to-date'

          if (javaCandidate && settings.javaUpdatePolicy === 'install') {
            javaState = 'installing'
            activity = {
              ...activity,
              core: { channel, state: coreState, version: coreCandidate ? release.tagName : null },
              java: { state: javaState, version: javaStatus.updateAvailableVersion as string },
            }
            try {
              await requireCurrentInstallPolicy(settings, 'javaUpdatePolicy', revision)
              await manager.installJavaAutomaticallyForHomeV2({
                activationLease: activationLease(settings, 'javaUpdatePolicy', revision, ['qortal', 'qortium']),
                preDownloadGuard: () => requireCurrentInstallPolicy(settings, 'javaUpdatePolicy', revision),
              })
              javaState = 'up-to-date'
            } catch (error) {
              issue = error instanceof PolicyRevokedError
                ? 'policy-revoked'
                : error instanceof OperationBusyError ? 'operation-busy' : 'operation-failed'
              javaState = 'failed'
            }
          }

          if (coreCandidate && channel && release && settings.coreUpdatePolicy === 'install') {
            try {
              const runtime = await manager.getMaintenanceRuntimeStateForHomeV2()
              if (runtime !== 'stopped') {
                coreState = 'pending-safe-state'
              } else {
                coreState = 'installing'
                activity = {
                  ...activity,
                  core: { channel, state: coreState, version: release.tagName },
                  issue,
                  java: {
                    state: javaState,
                    version: javaCandidate ? javaStatus.updateAvailableVersion as string : null,
                  },
                }
                await requireCurrentInstallPolicy(settings, 'coreUpdatePolicy', revision)
                await manager.installCoreAutomaticallyForHomeV2({
                  activationLease: activationLease(settings, 'coreUpdatePolicy', revision, ['qortium']),
                  channel,
                  expectedTag: release.tagName,
                  preDownloadGuard: () => requireCurrentInstallPolicy(settings, 'coreUpdatePolicy', revision),
                })
                coreState = 'up-to-date'
              }
            } catch (error) {
              issue = error instanceof PolicyRevokedError
                ? 'policy-revoked'
                : error instanceof OperationBusyError ? 'operation-busy' : 'operation-failed'
              coreState = 'failed'
            }
          }

          core = {
            channel,
            state: checkCore ? coreState : 'idle',
            version: coreCandidate ? release.tagName : null,
          }
          java = {
            state: checkJava ? javaState : 'idle',
            version: javaCandidate ? javaStatus.updateAvailableVersion as string : null,
          }
        } catch {
          issue = 'check-failed'
          core = { channel: null, state: checkCore ? 'failed' : 'idle', version: null }
          java = { state: checkJava ? 'failed' : 'idle', version: null }
        }
      }

      if (checkQortal) {
        try {
          const manager = dependencies.resolveQortalManager()
          const status = await manager.getStatus()
          if (status.install.kind !== 'home-managed' ||
            status.updateOwnership.ownership !== 'home-github') {
            qortal = { state: 'idle', version: null }
          } else {
            const installedVersion = status.install.record.jarIdentity.semver
            const latest = await (dependencies.qortalReleaseSource ?? qortalLatestReleaseSource).getLatest()
            if (latest.kind !== 'available') throw new Error('The latest Qortal release is unavailable.')
            const comparison = compareCoreVersions(latest.release.tagName, installedVersion)
            if (comparison === null) throw new Error('The Qortal release version is invalid.')
            const candidate = comparison > 0
            let qortalState: HomeV2CoreUpdateActivityState = candidate ? 'available' : 'up-to-date'
            if (candidate && settings.qortalUpdatePolicy === 'install') {
              if (status.runtime.state !== 'stopped') {
                qortalState = 'pending-safe-state'
              } else {
                qortalState = 'installing'
                activity = {
                  ...activity,
                  core,
                  issue,
                  java,
                  qortal: { state: qortalState, version: latest.release.tagName },
                }
                await requireCurrentInstallPolicy(settings, 'qortalUpdatePolicy', revision)
                const expected = await (
                  dependencies.qortalReleaseSource ?? qortalLatestReleaseSource
                ).getExpectedLatest(latest.release.tagName)
                if (expected.kind !== 'available') {
                  throw new Error('The Qortal release changed before automatic staging.')
                }
                const result = await manager.updateAutomaticallyForHomeV2(expected.rawRelease, {
                  activationLease: activationLease(settings, 'qortalUpdatePolicy', revision, ['qortal']),
                  preDownloadGuard: () => requireCurrentInstallPolicy(
                    settings,
                    'qortalUpdatePolicy',
                    revision,
                  ),
                })
                const outcome = result.kind === 'completed-with-warning' ? result.outcome : result
                if (outcome.kind !== 'updated') throw new Error('The automatic Qortal update was not applied.')
                qortalState = 'up-to-date'
              }
            }
            qortal = { state: qortalState, version: candidate ? latest.release.tagName : null }
          }
        } catch (error) {
          issue = error instanceof PolicyRevokedError
            ? 'policy-revoked'
            : error instanceof OperationBusyError
              ? 'operation-busy'
              : issue ?? 'operation-failed'
          qortal = { state: 'failed', version: qortal.version }
        }
      }

      activity = {
        checkedAt: new Date().toISOString(),
        core,
        generation: settings.generation,
        issue,
        java,
        qortal,
      }
      return activity
    },
  }
}

export function createHomeV2CoreUpdatePolicyScheduler(
  runPass: () => Promise<unknown>,
  options: Readonly<{
    intervalMs?: number
    setInterval?: typeof setInterval
    setTimeout?: typeof setTimeout
    clearInterval?: typeof clearInterval
    clearTimeout?: typeof clearTimeout
  }> = {},
) {
  const setIntervalFn = options.setInterval ?? setInterval
  const setTimeoutFn = options.setTimeout ?? setTimeout
  const clearIntervalFn = options.clearInterval ?? clearInterval
  const clearTimeoutFn = options.clearTimeout ?? clearTimeout
  let interval: ReturnType<typeof setInterval> | null = null
  let startup: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<void> | null = null
  let rerun = false
  let running = false

  const trigger = () => {
    if (!running) return Promise.resolve()
    if (inFlight) {
      rerun = true
      return inFlight
    }
    const promise = Promise.resolve()
      .then(runPass)
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        if (inFlight === promise) inFlight = null
        if (running && rerun) {
          rerun = false
          void trigger()
        }
      })
    inFlight = promise
    return promise
  }

  return {
    start() {
      if (running) return false
      running = true
      startup = setTimeoutFn(() => {
        startup = null
        void trigger()
      }, 0)
      startup.unref?.()
      interval = setIntervalFn(() => void trigger(), options.intervalMs ?? 6 * 60 * 60_000)
      interval.unref?.()
      return true
    },
    stop() {
      running = false
      rerun = false
      homeV2CoreOperationCoordinator.revokeAutomaticWork()
      if (startup) clearTimeoutFn(startup)
      if (interval) clearIntervalFn(interval)
      startup = null
      interval = null
    },
    trigger,
  }
}
