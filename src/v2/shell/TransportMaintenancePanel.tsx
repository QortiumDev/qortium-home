import type {
  HomeV2TransportMaintenanceStatus,
  HomeV2TransportMode,
} from '../../home-v2-live/core-manager-client'
import type { HomeV2TransportMaintenance } from '../../home-v2-live/transport-maintenance-controller'
import { t } from '../../i18n'

type SettableTransportMode = Exclude<HomeV2TransportMode, 'unknown'>

export function routerStatusMessage(status: HomeV2TransportMaintenanceStatus) {
  if (status.issue === 'manager-unavailable' || status.issue === 'status-unavailable') {
    return t('home2.transportMaintenance.status.unavailable')
  }
  if (status.core.install === 'missing') {
    return t('home2.transportMaintenance.status.coreMissing')
  }
  if (status.core.install === 'unknown') {
    return t('home2.transportMaintenance.status.coreUnknown')
  }
  if (status.core.runtime === 'running') {
    return t('home2.transportMaintenance.status.coreRunning')
  }
  if (status.core.runtime === 'unknown') {
    return t('home2.transportMaintenance.status.coreUnknown')
  }
  if (status.router.state === 'external-running') {
    return t('home2.transportMaintenance.status.externalRunning')
  }
  if (status.router.state === 'managed-running') {
    return status.router.maintenance === 'update'
      ? t('home2.transportMaintenance.status.managedRunningUpdate')
      : t('home2.transportMaintenance.status.managedRunning')
  }
  if (status.router.state === 'managed-stopped') {
    return status.router.maintenance === 'update'
      ? t('home2.transportMaintenance.status.managedStoppedUpdate')
      : t('home2.transportMaintenance.status.managedStopped')
  }
  if (status.router.state === 'missing') {
    return t('home2.transportMaintenance.status.missing')
  }
  if (status.router.state === 'unsupported') {
    return t('home2.transportMaintenance.status.unsupported')
  }
  if (status.issue === 'version-unavailable') {
    return t('home2.transportMaintenance.status.versionUnavailable')
  }
  return t('home2.transportMaintenance.status.unavailable')
}

function modeDescription(mode: SettableTransportMode) {
  if (mode === 'direct-only') return t('home2.transportMaintenance.mode.directOnlyDescription')
  if (mode === 'i2p-only') return t('home2.transportMaintenance.mode.i2pOnlyDescription')
  return t('home2.transportMaintenance.mode.directAndI2pDescription')
}

export function ensureLabel(status: HomeV2TransportMaintenanceStatus) {
  if (status.router.maintenance === 'install') {
    return t('home2.transportMaintenance.router.installAndStart')
  }
  if (status.router.maintenance === 'update') {
    return t('home2.transportMaintenance.router.updateAndRestart')
  }
  return t('home2.transportMaintenance.router.start')
}

/**
 * The i2p router / transport-mode panel. It owns no state: the controller is
 * instantiated once per app and passed in, so this panel and the dashboard tile
 * share one router status, one busy flag and one notice.
 */
export function TransportMaintenancePanel({
  maintenance: transport,
}: {
  readonly maintenance?: HomeV2TransportMaintenance
}) {
  if (!transport?.available) return null
  const {
    busy,
    currentMode,
    initialLoadFailed,
    modeAllowed,
    modeChanged,
    notice,
    refresh,
    run,
    selectedMode,
    setSelectedMode,
    stale,
    status,
  } = transport

  if (!status) {
    return (
      <section className="home-v2-core-maintenance home-v2-transport-maintenance"
        aria-busy={!initialLoadFailed} aria-labelledby="transport-maintenance-title">
        <div className="home-v2-settings-panel__heading">
          <h3 id="transport-maintenance-title">{t('home2.transportMaintenance.title')}</h3>
          {initialLoadFailed ? (
            <>
              <p className="home-v2-core-notice" role="alert">
                {t('home2.transportMaintenance.status.unavailable')}
              </p>
              <button className="home-v2-secondary-button" type="button" onClick={() => void refresh()}>
                {t('home2.transportMaintenance.retry')}
              </button>
            </>
          ) : <p role="status">{t('home2.transportMaintenance.loading')}</p>}
        </div>
      </section>
    )
  }

  const routerVersion = status.router.version ?? (
    status.router.state === 'missing' ? t('common.notInstalled') : t('common.unavailable')
  )

  return (
    <section className="home-v2-core-maintenance home-v2-transport-maintenance"
      aria-busy={busy !== null} aria-labelledby="transport-maintenance-title"
      data-home-v2-transport-maintenance="desktop" data-network="qortium">
      <div className="home-v2-settings-panel__heading">
        <h3 id="transport-maintenance-title">{t('home2.transportMaintenance.title')}</h3>
        <p>{t('home2.transportMaintenance.description')}</p>
      </div>

      <div className="home-v2-setting-row">
        <div className="home-v2-setting-row__copy">
          <label htmlFor="transport-maintenance-mode">
            <strong>{t('home2.transportMaintenance.mode.label')}</strong>
          </label>
          <span id="transport-maintenance-mode-note">
            {selectedMode ? modeDescription(selectedMode) : t('home2.transportMaintenance.mode.unavailable')}
            {' '}
            {status.core.runtime === 'stopped'
              ? t('home2.transportMaintenance.mode.stoppedNote')
              : status.core.runtime === 'running'
                ? t('home2.transportMaintenance.mode.stopCoreNote')
                : t('home2.transportMaintenance.mode.verifyStoppedNote')}
          </span>
        </div>
        <div className="home-v2-setting-row__control home-v2-core-maintenance__actions">
          {currentMode ? (
            <select id="transport-maintenance-mode" aria-describedby="transport-maintenance-mode-note"
              disabled={busy !== null || stale || status.core.runtime !== 'stopped'}
              value={selectedMode ?? currentMode}
              onChange={(event) => setSelectedMode(event.target.value as SettableTransportMode)}>
              <option value="direct-and-i2p" disabled={!status.capabilities.canSetDirectAndI2p}>
                {t('home2.transportMaintenance.mode.directAndI2p')}
              </option>
              <option value="direct-only" disabled={!status.capabilities.canSetDirectOnly}>
                {t('home2.transportMaintenance.mode.directOnly')}
              </option>
              <option value="i2p-only" disabled={!status.capabilities.canSetI2pOnly}>
                {t('home2.transportMaintenance.mode.i2pOnly')}
              </option>
            </select>
          ) : null}
          {currentMode ? (
            <button className="home-v2-primary-button" type="button" aria-describedby="transport-maintenance-mode-note"
              disabled={busy !== null || stale || !modeChanged || !modeAllowed}
              onClick={() => void run('set-mode', selectedMode)}>
              {busy === 'set-mode'
                ? t('home2.common.working')
                : t('home2.transportMaintenance.mode.apply')}
            </button>
          ) : null}
        </div>
      </div>

      <div className="home-v2-setting-row">
        <div className="home-v2-setting-row__copy">
          <strong>{t('home2.transportMaintenance.router.label')}</strong>
          <span>{routerVersion}</span>
        </div>
        <div className="home-v2-setting-row__control home-v2-core-maintenance__actions">
          {status.capabilities.canEnsureRouter ? (
            <button className="home-v2-primary-button" type="button"
              aria-describedby="transport-maintenance-router-state"
              disabled={busy !== null || stale}
              onClick={() => void run('ensure-router', null)}>
              {busy === 'ensure-router' ? t('home2.common.working') : ensureLabel(status)}
            </button>
          ) : null}
        </div>
      </div>

      <p className="home-v2-core-notice" id="transport-maintenance-router-state">
        {routerStatusMessage(status)}
      </p>
      {stale ? (
        <p className="home-v2-core-notice" role="alert">
          {t('home2.transportMaintenance.refreshStale')}
        </p>
      ) : null}
      {notice ? (
        <p className="home-v2-core-notice" role={notice.error ? 'alert' : 'status'}>
          {notice.message}
        </p>
      ) : null}
    </section>
  )
}
