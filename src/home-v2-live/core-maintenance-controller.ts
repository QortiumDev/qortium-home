import { useEffect, useRef, useState } from 'react'
import type {
  HomeV2CoreMaintenanceProgress,
  HomeV2CoreMaintenanceRelease,
  HomeV2CoreMaintenanceStatus,
  HomeV2CoreUpdatePolicy,
  HomeV2CoreUpdatePolicyState,
} from './core-manager-client'
import {
  parseHomeV2CoreMaintenanceActionResult,
  parseHomeV2CoreMaintenanceRelease,
  parseHomeV2CoreMaintenanceProgress,
  parseHomeV2CoreMaintenanceStatus,
  parseHomeV2CoreUpdatePolicySetResult,
  parseHomeV2CoreUpdatePolicyState,
} from './core-manager-client'

export type HomeV2CoreMaintenanceBusy = 'check' | 'core' | 'java' | 'policy'
export type HomeV2CoreUpdatePolicyField =
  | 'coreUpdatePolicy'
  | 'javaUpdatePolicy'
  | 'qortalUpdatePolicy'

/**
 * Owns the Qortium Core maintenance surface: the maintenance-status and
 * update-policy poll, the release check, initial-install / strict-update /
 * install-java, and the serialized automatic-update-policy writes.
 *
 * The bridge is invoke-only in Home v2 (legacy renderer core events are
 * disabled), so the 30s poll is the only status mechanism. Bridge methods are
 * called on the client object rather than destructured, so a caller that
 * replaces a single method on the live bridge still takes effect.
 */
export function useHomeV2CoreMaintenance(options: {
  readonly onCoreRefresh?: () => void
  readonly qortalEnabled?: boolean
  readonly qortiumEnabled?: boolean
} = {}) {
  const { qortalEnabled = true, qortiumEnabled = true } = options
  const client = window.homeV2CoreManagers
  const [status, setStatus] = useState<HomeV2CoreMaintenanceStatus | null>(null)
  const [policy, setPolicy] = useState<HomeV2CoreUpdatePolicyState | null>(null)
  const [release, setRelease] = useState<HomeV2CoreMaintenanceRelease | null>(null)
  const [busy, setBusy] = useState<HomeV2CoreMaintenanceBusy | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Which offered release the user picked; null means take the default.
  const [selectedReleaseTag, setSelectedReleaseTag] = useState<string | null>(null)
  // The downgrade the user has been asked to confirm, if any. Holds only the
  // two version strings; the token authorising it stays in the main process.
  const [pendingDowngrade, setPendingDowngrade] =
    useState<{ installedVersion: string; targetVersion: string } | null>(null)
  const [initialLoadFailed, setInitialLoadFailed] = useState(false)
  // Live install/update progress. Null whenever nothing is running, so the UI
  // shows a bar only while there is something to report.
  const [progress, setProgress] = useState<HomeV2CoreMaintenanceProgress | null>(null)
  const disposed = useRef(false)
  const statusRef = useRef<HomeV2CoreMaintenanceStatus | null>(null)
  const policyRef = useRef<HomeV2CoreUpdatePolicyState | null>(null)
  const requestSequence = useRef(0)
  const policyWriteRevision = useRef(0)
  const pendingPolicyWrites = useRef(0)
  const policyWrites = useRef<Promise<void>>(Promise.resolve())
  const coreRefresh = useRef(options.onCoreRefresh)
  coreRefresh.current = options.onCoreRefresh

  const refresh = async () => {
    if (!client || pendingPolicyWrites.current > 0) return
    const sequence = ++requestSequence.current
    const writeRevision = policyWriteRevision.current
    try {
      const [nextStatusValue, nextPolicyValue] = await Promise.all([
        client.getMaintenanceStatus(),
        client.getUpdatePolicy(),
      ])
      if (disposed.current || sequence !== requestSequence.current ||
        writeRevision !== policyWriteRevision.current || pendingPolicyWrites.current > 0) return
      const nextStatus = parseHomeV2CoreMaintenanceStatus(nextStatusValue)
      const nextPolicy = parseHomeV2CoreUpdatePolicyState(nextPolicyValue)
      statusRef.current = nextStatus
      policyRef.current = nextPolicy
      setStatus(nextStatus)
      setPolicy(nextPolicy)
      setInitialLoadFailed(false)
    } catch (error) {
      if (!disposed.current && sequence === requestSequence.current && !statusRef.current) {
        setInitialLoadFailed(true)
      }
      throw error
    }
  }

  // The one push channel on this surface. Everything else here polls; a
  // percentage that arrives on the next 30s tick is not progress.
  useEffect(() => {
    if (!client?.onMaintenanceProgress) return undefined
    return client.onMaintenanceProgress((event) => {
      const parsed = parseHomeV2CoreMaintenanceProgress(event)
      // A malformed event is DROPPED, not rendered: keeping the previous value
      // is better than showing a wrong percentage, and better than a blank bar.
      if (!parsed) return
      setProgress(parsed.action === 'idle' ? null : parsed)
    })
  }, [client])

  useEffect(() => {
    disposed.current = false
    void refresh().catch(() => undefined)
    const interval = window.setInterval(() => void refresh().catch(() => undefined), 30_000)
    return () => {
      disposed.current = true
      window.clearInterval(interval)
      requestSequence.current += 1
      policyWriteRevision.current += 1
    }
  }, [client])

  useEffect(() => {
    setRelease(null)
    setNotice(null)
  }, [qortalEnabled, qortiumEnabled])

  const check = async () => {
    if (!client) return
    setBusy('check')
    setNotice(null)
    try {
      const next = parseHomeV2CoreMaintenanceRelease(await client.checkMaintenanceRelease())
      setRelease(next)
      setNotice(!next.available
        ? 'No verified release is available.'
        : next.action === 'none'
          ? `${next.tag} is not newer than the installed Core.`
          : `${next.tag} is ready for ${next.action === 'initial-install' ? 'installation' : 'update'}.`)
    } catch {
      setRelease(null)
      setNotice('The Qortium Core release check failed.')
    } finally {
      setBusy(null)
    }
  }

  const runCore = async (confirmDowngrade = false) => {
    if (!client) return
    //  describes only the forward move, so a release offered ONLY as a
    // downgrade reports 'none'. An offer is enough to act on.
    if (!release?.tag) return
    if (release.action === 'none' && release.offers.length === 0) return
    // Install whichever release the user picked. The default is the newest
    // stable, which is offers[0]; a newer prerelease sits after it. Falling back
    // to release.tag keeps the old single-target behaviour when the node offers
    // nothing to choose between.
    const offer = release.offers.find((entry) => entry.tag === selectedReleaseTag)
      ?? release.offers[0]
      ?? null
    const action = offer
      ? (offer.relation === 'initial-install'
          ? 'initial-install' as const
          : offer.relation === 'downgrade'
            ? 'downgrade' as const
            : 'strict-update' as const)
      : release.action
    // With no offer to fall back on and no forward action, there is nothing to
    // install. Narrowed here so 'none' can never reach the mutation request.
    if (action === 'none') return
    setBusy('core')
    setNotice(null)
    try {
      const result = parseHomeV2CoreMaintenanceActionResult(await client.runMaintenanceAction(
        action,
        {
          channel: offer?.channel ?? release.channel,
          expectedTag: offer?.tag ?? release.tag,
          ...(action === 'downgrade' ? { confirmDowngrade } : {}),
        },
      ))
      // Not a failure -- the request for consent. Hold it so the panel can ask.
      if (result.code === 'downgrade-confirmation-required' && result.downgrade) {
        setPendingDowngrade(result.downgrade)
      } else {
        setPendingDowngrade(null)
      }
      const awaitingConsent =
        result.code === 'downgrade-confirmation-required' && !!result.downgrade
      statusRef.current = result.status
      setStatus(result.status)
      // Keep the release while consent is pending: clearing it would leave the
      // confirm button with nothing to install.
      if (!awaitingConsent) setRelease(null)
      setNotice(result.outcome === 'completed'
        ? 'Qortium Core maintenance completed.'
        : awaitingConsent
          ? null
          : result.code === 'release-changed'
            ? 'The release changed. Check again before installing.'
            : 'Qortium Core maintenance was not completed.')
      coreRefresh.current?.()
      void refresh().catch(() => undefined)
    } catch {
      setNotice('Qortium Core maintenance failed.')
    } finally {
      setBusy(null)
    }
  }

  const installJava = async () => {
    if (!client) return
    setBusy('java')
    setNotice(null)
    try {
      const result = parseHomeV2CoreMaintenanceActionResult(
        await client.runMaintenanceAction('install-java'),
      )
      statusRef.current = result.status
      setStatus(result.status)
      setNotice(result.outcome === 'completed'
        ? 'Managed Java installation completed.'
        : 'Managed Java installation was not completed.')
      coreRefresh.current?.()
      void refresh().catch(() => undefined)
    } catch {
      setNotice('Managed Java installation failed.')
    } finally {
      setBusy(null)
    }
  }

  const setUpdatePolicy = (
    field: HomeV2CoreUpdatePolicyField,
    value: HomeV2CoreUpdatePolicy,
  ) => {
    const bridge = client
    if (!bridge || !policyRef.current) return
    const revision = ++policyWriteRevision.current
    pendingPolicyWrites.current += 1
    setBusy('policy')
    setNotice(null)
    requestSequence.current += 1

    const write = async () => {
      try {
        const current = policyRef.current
        if (!current) throw new Error('Core update policy is unavailable.')
        let result = parseHomeV2CoreUpdatePolicySetResult(
          await bridge.setUpdatePolicy(current.generation, field, value),
        )
        policyRef.current = result.state
        if (result.outcome === 'conflict' && result.state[field] !== value) {
          result = parseHomeV2CoreUpdatePolicySetResult(
            await bridge.setUpdatePolicy(result.state.generation, field, value),
          )
          policyRef.current = result.state
        }
        if (result.state[field] !== value ||
          (result.outcome !== 'saved' && result.outcome !== 'conflict')) {
          throw new Error('Core update policy changed again in another Home window.')
        }
        if (!disposed.current && revision === policyWriteRevision.current) {
          setPolicy(result.state)
          setRelease(null)
          setNotice('Automatic update policy saved.')
        }
      } catch {
        try {
          const latest = parseHomeV2CoreUpdatePolicyState(await bridge.getUpdatePolicy())
          policyRef.current = latest
          if (!disposed.current && revision === policyWriteRevision.current) setPolicy(latest)
        } catch {
          // Keep the last confirmed renderer state if reconciliation is unavailable.
        }
        if (!disposed.current && revision === policyWriteRevision.current) {
          setNotice('The automatic update policy could not be saved.')
        }
      } finally {
        pendingPolicyWrites.current -= 1
        if (!disposed.current && revision === policyWriteRevision.current &&
          pendingPolicyWrites.current === 0) {
          setBusy(null)
        }
      }
    }

    policyWrites.current = policyWrites.current
      .catch(() => undefined)
      .then(write)
    void policyWrites.current.catch(() => undefined)
  }

  /**
   * Ask the main process to open the Core install folder.
   *
   * No path crosses the bridge in either direction: main resolves it and the
   * renderer learns only whether a window opened. Absent on hosts without the
   * Electron preload, which is why the panel checks `canRevealInstall`.
   */
  const revealInstall = async () => {
    if (!client?.revealInstall) return false
    try {
      return await client.revealInstall() === true
    } catch {
      return false
    }
  }

  return {
    available: !!client,
    busy,
    canRevealInstall: typeof client?.revealInstall === 'function',
    check,
    confirmDowngrade: () => runCore(true),
    pendingDowngrade,
    selectedReleaseTag,
    setSelectedReleaseTag,
    initialLoadFailed,
    installJava,
    notice,
    policy,
    progress,
    refresh,
    release,
    revealInstall,
    runCore,
    setUpdatePolicy,
    status,
  } as const
}

export type HomeV2CoreMaintenance = ReturnType<typeof useHomeV2CoreMaintenance>

/**
 * The Qortium Core maintenance slice of `HomeV2CoreManagement`. It exists so a
 * dashboard tile can offer install / update / install-Java without owning the
 * polling itself. Every action is optional: a call site that only reads status
 * can leave them out.
 */
export interface HomeV2CoreMaintenanceManagement {
  /** Live install/update progress, or null when nothing is running. */
  readonly progress?: HomeV2CoreMaintenanceProgress | null
  readonly busy: HomeV2CoreMaintenanceBusy | null
  /** Last action outcome, so a tile can report a failure it caused. */
  readonly notice: string | null
  readonly policy: HomeV2CoreUpdatePolicyState | null
  readonly release: HomeV2CoreMaintenanceRelease | null
  readonly status: HomeV2CoreMaintenanceStatus | null
  readonly onCheckRelease?: () => void
  readonly onInstallJava?: () => void
  readonly onRunRelease?: () => void
  readonly onSetUpdatePolicy?: (
    field: HomeV2CoreUpdatePolicyField,
    value: HomeV2CoreUpdatePolicy,
  ) => void
}

export function toHomeV2CoreMaintenanceManagement(
  maintenance: HomeV2CoreMaintenance,
): HomeV2CoreMaintenanceManagement {
  return {
    busy: maintenance.busy,
    notice: maintenance.notice,
    progress: maintenance.progress,
    onCheckRelease: () => void maintenance.check(),
    onInstallJava: () => void maintenance.installJava(),
    onRunRelease: () => void maintenance.runCore(),
    onSetUpdatePolicy: maintenance.setUpdatePolicy,
    policy: maintenance.policy,
    release: maintenance.release,
    status: maintenance.status,
  }
}
