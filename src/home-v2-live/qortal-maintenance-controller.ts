import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import type {
  HomeV2QortalAdoptionList,
  HomeV2QortalMaintenanceActionResult,
  HomeV2QortalMaintenanceRelease,
  HomeV2QortalMaintenanceStatus,
} from './core-manager-client'
import {
  parseHomeV2QortalAdoptionBrowseResult,
  parseHomeV2QortalAdoptionList,
  parseHomeV2QortalAdoptionSelectionResult,
  parseHomeV2QortalMaintenanceActionResult,
  parseHomeV2QortalMaintenanceRelease,
  parseHomeV2QortalMaintenanceStatus,
} from './core-manager-client'

export type HomeV2QortalMaintenanceBusy =
  | 'action'
  | 'adoption-browse'
  | 'adoption-list'
  | 'adoption-select'
  | 'check'

export function qortalReleaseMessage(release: HomeV2QortalMaintenanceRelease) {
  if (release.code === 'up-to-date') return t('home2.qortalMaintenance.release.upToDate', {
    tag: release.tag ?? t('home2.qortalMaintenance.release.installedVersion'),
  })
  if (release.code === 'version-unavailable') return t('home2.qortalMaintenance.release.versionUnavailable')
  if (release.code === 'action-not-allowed') return t('home2.qortalMaintenance.release.checkUnavailable')
  if (!release.available) return t('home2.qortalMaintenance.release.verifyUnavailable')
  if (release.action === 'initial-install') return t('home2.qortalMaintenance.release.readyInstall', { tag: release.tag ?? '' })
  if (release.action === 'strict-update') return t('home2.qortalMaintenance.release.readyUpdate', { tag: release.tag ?? '' })
  return t('home2.qortalMaintenance.release.notNewer', {
    tag: release.tag ?? t('home2.qortalMaintenance.release.latestStable'),
  })
}

export function qortalActionMessage(result: HomeV2QortalMaintenanceActionResult) {
  if (result.outcome === 'completed') {
    return result.warning
      ? t('home2.qortalMaintenance.action.completedCleanupWarning')
      : t('home2.qortalMaintenance.action.completed')
  }
  if (result.code === 'release-changed') return t('home2.qortalMaintenance.action.releaseChanged')
  if (result.code === 'release-not-newer') return t('home2.qortalMaintenance.action.releaseNotNewer')
  if (result.code === 'runtime-not-stopped') return t('home2.qortalMaintenance.action.runtimeNotStopped')
  if (result.code === 'update-node-native') return t('home2.qortalMaintenance.action.nodeNative')
  if (result.code === 'update-ownership-unknown') return t('home2.qortalMaintenance.action.ownershipUnknown')
  if (result.code === 'adopted-update-unsupported') return t('home2.qortalMaintenance.action.adoptedUnsupported')
  if (result.code === 'install-selection-required') return t('home2.qortalMaintenance.action.selectionRequired')
  if (result.code === 'operation-in-progress') return t('home2.qortalMaintenance.action.inProgress')
  if (result.code === 'target-changed') return t('home2.qortalMaintenance.action.targetChanged')
  return result.outcome === 'failed'
    ? t('home2.qortalMaintenance.action.failed')
    : t('home2.qortalMaintenance.action.notCompleted')
}

export function qortalStatusFingerprint(status: HomeV2QortalMaintenanceStatus) {
  return [
    status.discovery,
    status.capabilities.canCheckRelease,
    status.capabilities.canInitialInstall,
    status.capabilities.canUpdate,
    status.install,
    status.installedVersion,
    status.issue,
    status.runtime,
    status.updateAuthority,
  ].join('|')
}

export function preferredQortalCandidate(
  list: HomeV2QortalAdoptionList,
  preferBrowsed = false,
) {
  if (list.state !== 'complete' || !list.canSelect) return null
  const supported = list.candidates.filter((candidate) => candidate.version !== null)
  if (preferBrowsed) {
    const browsed = supported.filter((candidate) => candidate.origins.includes('user-selected'))
    if (browsed.length === 1) return browsed[0]?.candidateId ?? null
  }
  if (list.candidates.length !== 1) return null
  return supported[0]?.candidateId ?? null
}

/**
 * Owns the Qortal Core maintenance surface: status polling, the stable-release
 * check, initial-install / strict-update, and the adoption list / browse /
 * select flow.
 *
 * The bridge methods are read off `window.homeV2CoreManagers` on every render
 * and called unbound, exactly as the panel did — swapping the bridge object
 * must take effect on the next render, and the effect re-runs on that identity.
 */
export function useHomeV2QortalMaintenance(onCoreRefresh?: () => void) {
  const client = window.homeV2CoreManagers
  const getStatus = client?.getQortalMaintenanceStatus
  const checkRelease = client?.checkQortalMaintenanceRelease
  const runAction = client?.runQortalMaintenanceAction
  const listAdoptionCandidates = client?.listQortalAdoptionCandidates
  const browseAdoptionDirectory = client?.browseQortalAdoptionDirectory
  const selectAdoptionCandidate = client?.selectQortalAdoptionCandidate
  const [status, setStatus] = useState<HomeV2QortalMaintenanceStatus | null>(null)
  const [release, setRelease] = useState<HomeV2QortalMaintenanceRelease | null>(null)
  const [adoptionList, setAdoptionList] = useState<HomeV2QortalAdoptionList | null>(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [busy, setBusy] = useState<HomeV2QortalMaintenanceBusy | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [initialLoadFailed, setInitialLoadFailed] = useState(false)
  const disposed = useRef(false)
  const busyRef = useRef(false)
  const statusRef = useRef<HomeV2QortalMaintenanceStatus | null>(null)
  const requestSequence = useRef(0)
  const coreRefresh = useRef(onCoreRefresh)
  coreRefresh.current = onCoreRefresh

  const refresh = async () => {
    if (!getStatus || busyRef.current) return
    const sequence = ++requestSequence.current
    try {
      const next = parseHomeV2QortalMaintenanceStatus(await getStatus())
      if (disposed.current || sequence !== requestSequence.current) return
      if (statusRef.current &&
        qortalStatusFingerprint(statusRef.current) !== qortalStatusFingerprint(next)) {
        setRelease(null)
        setAdoptionList(null)
        setSelectedCandidateId(null)
      }
      if (next.install !== 'missing') {
        setAdoptionList(null)
        setSelectedCandidateId(null)
      }
      statusRef.current = next
      setStatus(next)
      // Adopt the release the app already knows about (from the six-hourly
      // update pass or an earlier manual check) so Install is offered without
      // the user pressing "Check release" first. A manual check still wins.
      setRelease((current) => current ?? next.lastRelease)
      setInitialLoadFailed(false)
    } catch {
      if (!disposed.current && sequence === requestSequence.current && !statusRef.current) {
        setInitialLoadFailed(true)
      } else if (!disposed.current && sequence === requestSequence.current) {
        setRelease(null)
        setNotice(t('home2.qortalMaintenance.refreshStale'))
      }
    }
  }

  useEffect(() => {
    disposed.current = false
    busyRef.current = false
    statusRef.current = null
    setBusy(null)
    setStatus(null)
    setRelease(null)
    setAdoptionList(null)
    setSelectedCandidateId(null)
    setNotice(null)
    setInitialLoadFailed(false)
    void refresh()
    const interval = window.setInterval(() => void refresh(), 30_000)
    return () => {
      disposed.current = true
      requestSequence.current += 1
      window.clearInterval(interval)
    }
  }, [client])

  const reviewAdoptionCandidates = async () => {
    if (!listAdoptionCandidates || busyRef.current || status?.install !== 'missing') return
    const sequence = ++requestSequence.current
    busyRef.current = true
    setBusy('adoption-list')
    setNotice(null)
    try {
      const next = parseHomeV2QortalAdoptionList(await listAdoptionCandidates())
      if (disposed.current || sequence !== requestSequence.current) return
      setAdoptionList(next)
      setSelectedCandidateId(preferredQortalCandidate(next))
    } catch {
      if (!disposed.current && sequence === requestSequence.current) {
        setAdoptionList(null)
        setSelectedCandidateId(null)
        setNotice(t('home2.qortalMaintenance.adoption.failed'))
      }
    } finally {
      if (!disposed.current && sequence === requestSequence.current) {
        busyRef.current = false
        setBusy(null)
      }
    }
  }

  const browseAdoption = async () => {
    if (!browseAdoptionDirectory || busyRef.current || status?.install !== 'missing') return
    const sequence = ++requestSequence.current
    busyRef.current = true
    setBusy('adoption-browse')
    setNotice(null)
    try {
      const result = parseHomeV2QortalAdoptionBrowseResult(await browseAdoptionDirectory())
      if (disposed.current || sequence !== requestSequence.current) return
      setAdoptionList(result.list)
      // Opening the picker invalidates the prior opaque tokens, including when
      // the picker is canceled. Never retain a selection from the old list.
      setSelectedCandidateId(result.canceled ? null : preferredQortalCandidate(result.list, true))
      if (result.canceled) setNotice(t('home2.qortalMaintenance.adoption.browseCanceled'))
    } catch {
      if (!disposed.current && sequence === requestSequence.current) {
        setAdoptionList(null)
        setSelectedCandidateId(null)
        setNotice(t('home2.qortalMaintenance.adoption.browseFailed'))
      }
    } finally {
      if (!disposed.current && sequence === requestSequence.current) {
        busyRef.current = false
        setBusy(null)
      }
    }
  }

  const adoptCandidate = async () => {
    if (!selectAdoptionCandidate || !selectedCandidateId || busyRef.current ||
      status?.install !== 'missing') return
    const selected = adoptionList?.candidates.find(
      (candidate) => candidate.candidateId === selectedCandidateId,
    )
    if (!selected || selected.version === null || adoptionList?.state !== 'complete' ||
      !adoptionList.canSelect) return
    const sequence = ++requestSequence.current
    busyRef.current = true
    setBusy('adoption-select')
    setNotice(null)
    try {
      const result = parseHomeV2QortalAdoptionSelectionResult(
        await selectAdoptionCandidate(selectedCandidateId),
      )
      if (disposed.current || sequence !== requestSequence.current) return
      statusRef.current = result.status
      setStatus(result.status)
      setRelease(null)
      if (result.outcome === 'completed') {
        setAdoptionList(null)
        setSelectedCandidateId(null)
        setNotice(t('home2.qortalMaintenance.adoption.success'))
        coreRefresh.current?.()
      } else if (result.code === 'candidate-expired' || result.code === 'candidate-changed') {
        setSelectedCandidateId(null)
        setNotice(t('home2.qortalMaintenance.adoption.stale'))
        if (listAdoptionCandidates && result.status.install === 'missing') {
          try {
            const next = parseHomeV2QortalAdoptionList(await listAdoptionCandidates())
            if (!disposed.current && sequence === requestSequence.current) {
              setAdoptionList(next)
              // A stale selection must be reviewed explicitly even when only one
              // candidate remains in the refreshed list.
              setSelectedCandidateId(null)
            }
          } catch {
            if (!disposed.current && sequence === requestSequence.current) {
              setAdoptionList(null)
            }
          }
        }
      } else if (result.code === 'unsupported-platform') {
        setSelectedCandidateId(null)
        setNotice(t('home2.qortalMaintenance.adoption.unsupported'))
      } else if (result.outcome === 'failed') {
        setAdoptionList(null)
        setSelectedCandidateId(null)
        setNotice(t('home2.qortalMaintenance.adoption.failed'))
      } else {
        setNotice(t('home2.qortalMaintenance.adoption.blocked'))
      }
    } catch {
      if (!disposed.current && sequence === requestSequence.current) {
        setAdoptionList(null)
        setSelectedCandidateId(null)
        setNotice(t('home2.qortalMaintenance.adoption.failed'))
      }
    } finally {
      if (!disposed.current && sequence === requestSequence.current) {
        busyRef.current = false
        setBusy(null)
      }
    }
  }

  const check = async () => {
    if (!checkRelease) return
    const sequence = ++requestSequence.current
    busyRef.current = true
    setBusy('check')
    setNotice(null)
    try {
      const next = parseHomeV2QortalMaintenanceRelease(await checkRelease())
      if (disposed.current || sequence !== requestSequence.current) return
      setRelease(next)
      setNotice(qortalReleaseMessage(next))
    } catch {
      if (!disposed.current && sequence === requestSequence.current) {
        setRelease(null)
        setNotice(t('home2.qortalMaintenance.release.checkFailed'))
      }
    } finally {
      if (!disposed.current && sequence === requestSequence.current) {
        busyRef.current = false
        setBusy(null)
      }
    }
  }

  const run = async () => {
    if (!runAction || !status) return
    const action = release?.action
    const expectedTag = release?.tag
    if (!expectedTag || !action || action === 'none') return
    if (action === 'initial-install' && !status.capabilities.canInitialInstall) return
    if (action === 'strict-update' && !status.capabilities.canUpdate) return
    const sequence = ++requestSequence.current
    busyRef.current = true
    setBusy('action')
    setNotice(null)
    try {
      const result = parseHomeV2QortalMaintenanceActionResult(
        await runAction(action, expectedTag),
      )
      if (disposed.current || sequence !== requestSequence.current) return
      statusRef.current = result.status
      setStatus(result.status)
      setRelease(null)
      setNotice(qortalActionMessage(result))
      if (result.outcome === 'completed') coreRefresh.current?.()
    } catch {
      if (!disposed.current && sequence === requestSequence.current) {
        setRelease(null)
        setNotice(t('home2.qortalMaintenance.action.failed'))
      }
    } finally {
      if (!disposed.current && sequence === requestSequence.current) {
        busyRef.current = false
        setBusy(null)
      }
    }
  }

  const actionAllowed = !status
    ? false
    : release?.action === 'initial-install'
      ? status.capabilities.canInitialInstall
      : release?.action === 'strict-update'
        ? status.capabilities.canUpdate
        : false
  const selectedAdoptionCandidate = adoptionList?.candidates.find(
    (candidate) => candidate.candidateId === selectedCandidateId,
  ) ?? null
  const adoptionSelectionAllowed = adoptionList?.state === 'complete' &&
    adoptionList.canSelect && !!selectedAdoptionCandidate && selectedAdoptionCandidate.version !== null

  return {
    actionAllowed,
    adoptCandidate,
    adoptionAvailable: !!listAdoptionCandidates && !!browseAdoptionDirectory &&
      !!selectAdoptionCandidate,
    adoptionBusy: busy === 'adoption-list' || busy === 'adoption-browse' ||
      busy === 'adoption-select',
    adoptionList,
    adoptionSelectionAllowed,
    available: !!getStatus && !!checkRelease && !!runAction,
    browseAdoption,
    busy,
    check,
    initialLoadFailed,
    notice,
    refresh,
    release,
    reviewAdoptionCandidates,
    run,
    selectedCandidateId,
    setSelectedCandidateId,
    status,
  } as const
}

export type HomeV2QortalMaintenance = ReturnType<typeof useHomeV2QortalMaintenance>

/**
 * The Qortal Core maintenance slice of `HomeV2CoreManagement`. Adoption stays
 * out of it: adopting an install is a multi-step review flow that belongs in
 * Settings, not in a dashboard tile.
 */
export interface HomeV2QortalMaintenanceManagement {
  readonly actionAllowed: boolean
  readonly busy: HomeV2QortalMaintenanceBusy | null
  /** Last action outcome, so a tile can report a failure it caused. */
  readonly notice: string | null
  readonly release: HomeV2QortalMaintenanceRelease | null
  readonly status: HomeV2QortalMaintenanceStatus | null
  readonly onCheckRelease?: () => void
  readonly onRunRelease?: () => void
}

export function toHomeV2QortalMaintenanceManagement(
  maintenance: HomeV2QortalMaintenance,
): HomeV2QortalMaintenanceManagement {
  return {
    actionAllowed: maintenance.actionAllowed,
    busy: maintenance.busy,
    notice: maintenance.notice,
    onCheckRelease: () => void maintenance.check(),
    onRunRelease: () => void maintenance.run(),
    release: maintenance.release,
    status: maintenance.status,
  }
}
