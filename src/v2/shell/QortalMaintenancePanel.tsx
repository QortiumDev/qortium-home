import { useEffect, useRef, useState } from 'react'
import type {
  HomeV2QortalMaintenanceActionResult,
  HomeV2QortalAdoptionCandidate,
  HomeV2QortalAdoptionList,
  HomeV2QortalMaintenanceRelease,
  HomeV2QortalMaintenanceStatus,
} from '../../home-v2-live/core-manager-client'
import {
  parseHomeV2QortalAdoptionBrowseResult,
  parseHomeV2QortalAdoptionList,
  parseHomeV2QortalAdoptionSelectionResult,
  parseHomeV2QortalMaintenanceActionResult,
  parseHomeV2QortalMaintenanceRelease,
  parseHomeV2QortalMaintenanceStatus,
} from '../../home-v2-live/core-manager-client'
import { t } from '../../i18n'
import type { HomeV2CoreManagement } from './CoreManagerCards'

function statusMessage(status: HomeV2QortalMaintenanceStatus) {
  if (status.issue) return t('home2.qortalMaintenance.status.unavailable')
  if (status.install === 'unknown') return t('home2.qortalMaintenance.status.installUnknown')
  if (status.runtime === 'unknown') return t('home2.qortalMaintenance.status.runtimeUnknown')
  if (status.install === 'missing') {
    if (status.discovery === 'candidate-found') {
      return t('home2.qortalMaintenance.status.candidateFound')
    }
    if (status.discovery === 'multiple-candidates') {
      return t('home2.qortalMaintenance.status.candidatesFound')
    }
    if (status.discovery !== 'clear') {
      return t('home2.qortalMaintenance.status.discoveryUnknown')
    }
    return t('home2.qortalMaintenance.status.notInstalled')
  }
  if (status.updateAuthority === 'node-native') {
    return status.install === 'adopted'
      ? t('home2.qortalMaintenance.status.adoptedNodeNative')
      : t('home2.qortalMaintenance.status.nodeNative')
  }
  if (status.updateAuthority === 'observe-only') {
    return t('home2.qortalMaintenance.status.ownershipUnknown')
  }
  if (status.install === 'adopted') {
    return t('home2.qortalMaintenance.status.adoptedHomeManaged')
  }
  return status.runtime === 'running'
    ? t('home2.qortalMaintenance.status.homeManagedRunning')
    : t('home2.qortalMaintenance.status.homeManagedStopped')
}

function releaseMessage(release: HomeV2QortalMaintenanceRelease) {
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

function actionMessage(result: HomeV2QortalMaintenanceActionResult) {
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

function statusFingerprint(status: HomeV2QortalMaintenanceStatus) {
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

function candidateSource(candidate: HomeV2QortalAdoptionCandidate) {
  if (candidate.origins.includes('user-selected')) {
    return t('home2.qortalMaintenance.adoption.source.browsed')
  }
  if (candidate.hubHint || candidate.origins.includes('qortal-hub')) {
    return t('home2.qortalMaintenance.adoption.source.hub')
  }
  if (candidate.runningProcessMatch || candidate.origins.includes('running-process')) {
    return t('home2.qortalMaintenance.adoption.source.running')
  }
  return t('home2.qortalMaintenance.adoption.source.standard')
}

function candidateVersion(candidate: HomeV2QortalAdoptionCandidate) {
  return candidate.version
    ? t('home2.qortalMaintenance.adoption.version', { version: candidate.version })
    : t('home2.qortalMaintenance.adoption.versionUnknown')
}

function preferredCandidate(
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

export function QortalMaintenancePanel({ management }: { readonly management: HomeV2CoreManagement }) {
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
  const [busy, setBusy] = useState<
    'action' | 'adoption-browse' | 'adoption-list' | 'adoption-select' | 'check' | null
  >(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [initialLoadFailed, setInitialLoadFailed] = useState(false)
  const disposed = useRef(false)
  const busyRef = useRef(false)
  const statusRef = useRef<HomeV2QortalMaintenanceStatus | null>(null)
  const requestSequence = useRef(0)

  const refresh = async () => {
    if (!getStatus || busyRef.current) return
    const sequence = ++requestSequence.current
    try {
      const next = parseHomeV2QortalMaintenanceStatus(await getStatus())
      if (disposed.current || sequence !== requestSequence.current) return
      if (statusRef.current && statusFingerprint(statusRef.current) !== statusFingerprint(next)) {
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

  if (!getStatus || !checkRelease || !runAction) return null
  if (!status) {
    return (
      <section className="home-v2-core-maintenance home-v2-qortal-maintenance"
        aria-busy={!initialLoadFailed} aria-labelledby="qortal-maintenance-title">
        <div className="home-v2-settings-panel__heading">
          <h3 id="qortal-maintenance-title">{t('home2.qortalMaintenance.title')}</h3>
          {initialLoadFailed ? (
            <>
              <p className="home-v2-core-notice" role="alert">{t('home2.qortalMaintenance.status.unavailable')}</p>
              <button className="home-v2-secondary-button" type="button" onClick={() => void refresh()}>{t('home2.qortalMaintenance.retry')}</button>
            </>
          ) : <p role="status">{t('home2.qortalMaintenance.loading')}</p>}
        </div>
      </section>
    )
  }

  const reviewAdoptionCandidates = async () => {
    if (!listAdoptionCandidates || busyRef.current || status.install !== 'missing') return
    const sequence = ++requestSequence.current
    busyRef.current = true
    setBusy('adoption-list')
    setNotice(null)
    try {
      const next = parseHomeV2QortalAdoptionList(await listAdoptionCandidates())
      if (disposed.current || sequence !== requestSequence.current) return
      setAdoptionList(next)
      setSelectedCandidateId(preferredCandidate(next))
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
    if (!browseAdoptionDirectory || busyRef.current || status.install !== 'missing') return
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
      setSelectedCandidateId(result.canceled ? null : preferredCandidate(result.list, true))
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
      status.install !== 'missing') return
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
        management.onRefresh?.()
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
    const sequence = ++requestSequence.current
    busyRef.current = true
    setBusy('check')
    setNotice(null)
    try {
      const next = parseHomeV2QortalMaintenanceRelease(await checkRelease())
      if (disposed.current || sequence !== requestSequence.current) return
      setRelease(next)
      setNotice(releaseMessage(next))
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
    const action = release?.action
    const expectedTag = release?.tag
    if (!expectedTag || !action || action === 'none') return
    if (action === 'initial-install' && !status.capabilities.canInitialInstall) return
    if (action === 'strict-update' && !status.capabilities.canUpdate) return
    const sequence = ++requestSequence.current
    const selectedRelease = release
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
      setNotice(actionMessage(result))
      if (result.outcome === 'completed') management.onRefresh?.()
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

  const actionAllowed = release?.action === 'initial-install'
    ? status.capabilities.canInitialInstall
    : release?.action === 'strict-update'
      ? status.capabilities.canUpdate
      : false
  const adoptionAvailable = !!listAdoptionCandidates && !!browseAdoptionDirectory &&
    !!selectAdoptionCandidate
  const selectedAdoptionCandidate = adoptionList?.candidates.find(
    (candidate) => candidate.candidateId === selectedCandidateId,
  ) ?? null
  const adoptionSelectionAllowed = adoptionList?.state === 'complete' &&
    adoptionList.canSelect && !!selectedAdoptionCandidate && selectedAdoptionCandidate.version !== null
  const adoptionBusy = busy === 'adoption-list' || busy === 'adoption-browse' ||
    busy === 'adoption-select'

  return (
    <section className="home-v2-core-maintenance home-v2-qortal-maintenance"
      aria-busy={busy !== null} aria-labelledby="qortal-maintenance-title" data-network="qortal">
      <div className="home-v2-settings-panel__heading">
        <h3 id="qortal-maintenance-title">{t('home2.qortalMaintenance.title')}</h3>
        <p>{t('home2.qortalMaintenance.description')}</p>
      </div>
      <div className="home-v2-setting-row">
        <div className="home-v2-setting-row__copy">
          <strong>{t('home2.qortalMaintenance.coreLabel')}</strong>
          <span>{status.installedVersion ?? (status.install === 'missing'
            ? t('common.notInstalled')
            : t('home2.qortalMaintenance.versionUnavailable'))}</span>
        </div>
        <div className="home-v2-setting-row__control home-v2-core-maintenance__actions">
          {status.capabilities.canCheckRelease ? (
            <button className="home-v2-secondary-button" type="button" disabled={busy !== null} onClick={() => void check()}>
              {busy === 'check'
                ? t('home2.qortalMaintenance.checking')
                : t('home2.qortalMaintenance.checkStable')}
            </button>
          ) : null}
          {release?.tag && release.action !== 'none' ? (
            <button className="home-v2-primary-button" type="button"
              aria-describedby="qortal-maintenance-state"
              disabled={busy !== null || !actionAllowed} onClick={() => void run()}>
              {busy === 'action'
                ? t('home2.common.working')
                : release.action === 'initial-install'
                  ? t('home2.qortalMaintenance.install')
                  : t('home2.qortalMaintenance.update')}
            </button>
          ) : null}
        </div>
      </div>
      {adoptionAvailable && status.install === 'missing' ? (
        <div className="home-v2-qortal-adoption" aria-busy={adoptionBusy}
          aria-labelledby="qortal-adoption-title" role="region" data-home-v2-qortal-adoption={
          adoptionList?.state ?? (busy === 'adoption-list' ? 'loading' : 'idle')
        }>
          <div className="home-v2-setting-row">
            <div className="home-v2-setting-row__copy">
              <strong id="qortal-adoption-title">{t('home2.qortalMaintenance.adoption.title')}</strong>
              <span>{t('home2.qortalMaintenance.adoption.description')}</span>
            </div>
            <div className="home-v2-setting-row__control home-v2-core-maintenance__actions">
              {!adoptionList ? (
                <button className="home-v2-secondary-button" type="button" disabled={busy !== null}
                  onClick={() => void reviewAdoptionCandidates()}>
                  {busy === 'adoption-list'
                    ? t('home2.qortalMaintenance.adoption.loading')
                    : t('home2.qortalMaintenance.adoption.review')}
                </button>
              ) : (
                <>
                  <button className="home-v2-secondary-button" type="button" disabled={busy !== null}
                    onClick={() => void reviewAdoptionCandidates()}>
                    {t('home2.qortalMaintenance.adoption.retry')}
                  </button>
                  <button className="home-v2-secondary-button" type="button" disabled={busy !== null || !adoptionList.canBrowse}
                    onClick={() => void browseAdoption()}>
                    {busy === 'adoption-browse'
                      ? t('home2.qortalMaintenance.adoption.browsing')
                      : t('home2.qortalMaintenance.adoption.browse')}
                  </button>
                </>
              )}
            </div>
          </div>
          {busy === 'adoption-list' ? (
            <p className="home-v2-core-notice" role="status">
              {t('home2.qortalMaintenance.adoption.loading')}
            </p>
          ) : adoptionList?.state === 'incomplete' ? (
            <p className="home-v2-core-notice" role="alert">
              {t('home2.qortalMaintenance.adoption.incomplete')}
            </p>
          ) : adoptionList?.state === 'unsupported' ? (
            <p className="home-v2-core-notice" role="alert">
              {t('home2.qortalMaintenance.adoption.unsupported')}
            </p>
          ) : adoptionList?.state === 'complete' && adoptionList.candidates.length === 0 ? (
            <p className="home-v2-core-notice" role="status">
              {t('home2.qortalMaintenance.adoption.none')}
            </p>
          ) : null}
          {adoptionList && adoptionList.candidates.length > 0 &&
          (adoptionList.state === 'complete' || adoptionList.state === 'unsupported') ? (
            <fieldset className="home-v2-qortal-adoption__candidates"
              disabled={busy !== null || !adoptionList.canSelect}>
              <legend>{t('home2.qortalMaintenance.adoption.title')}</legend>
              {adoptionList.candidates.map((candidate, index) => {
                const candidateLabel = t('home2.qortalMaintenance.adoption.candidateLabel', {
                  number: index + 1,
                })
                return (
                  <label className="home-v2-qortal-adoption__candidate"
                    key={candidate.candidateId}>
                    <input aria-label={candidateLabel} checked={
                      selectedCandidateId === candidate.candidateId
                    } disabled={busy !== null || !adoptionList.canSelect || candidate.version === null}
                      name="qortal-adoption-candidate" type="radio" value={candidate.candidateId}
                      onChange={() => setSelectedCandidateId(candidate.candidateId)} />
                    <span>
                      <strong>{candidateLabel}: {candidateSource(candidate)}</strong>
                      <small>{candidateVersion(candidate)}</small>
                      {candidate.runningProcessMatch ? (
                        <small>{t('home2.qortalMaintenance.adoption.running')}</small>
                      ) : null}
                      {candidate.version === null ? (
                        <small role="alert">
                          {t('home2.qortalMaintenance.adoption.unsupportedCandidate')}
                        </small>
                      ) : null}
                    </span>
                  </label>
                )
              })}
              <div className="home-v2-core-maintenance__actions">
                <button className="home-v2-primary-button" type="button"
                  aria-describedby="qortal-maintenance-state"
                  disabled={busy !== null || !adoptionSelectionAllowed}
                  onClick={() => void adoptCandidate()}>
                  {busy === 'adoption-select'
                    ? t('home2.qortalMaintenance.adoption.using')
                    : t('home2.qortalMaintenance.adoption.use')}
                </button>
              </div>
            </fieldset>
          ) : null}
        </div>
      ) : null}
      <p className="home-v2-core-notice" id="qortal-maintenance-state">{statusMessage(status)}</p>
      {notice ? <p className="home-v2-core-notice" role="status">{notice}</p> : null}
    </section>
  )
}
