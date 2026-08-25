import type {
  HomeV2QortalAdoptionCandidate,
  HomeV2QortalMaintenanceStatus,
} from '../../home-v2-live/core-manager-client'
import { useHomeV2QortalMaintenance } from '../../home-v2-live/qortal-maintenance-controller'
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

export function QortalMaintenancePanel({ management }: { readonly management: HomeV2CoreManagement }) {
  const maintenance = useHomeV2QortalMaintenance(management.onRefresh)
  const {
    actionAllowed,
    adoptCandidate,
    adoptionAvailable,
    adoptionBusy,
    adoptionList,
    adoptionSelectionAllowed,
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
  } = maintenance

  if (!maintenance.available) return null
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
