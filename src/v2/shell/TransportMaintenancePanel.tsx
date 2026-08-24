import { useEffect, useRef, useState } from 'react'
import type {
  HomeV2TransportMaintenanceAction,
  HomeV2TransportMaintenanceActionResult,
  HomeV2TransportMaintenanceStatus,
  HomeV2TransportMode,
} from '../../home-v2-live/core-manager-client'
import {
  parseHomeV2TransportMaintenanceActionResult,
  parseHomeV2TransportMaintenanceStatus,
} from '../../home-v2-live/core-manager-client'
import { t } from '../../i18n'
import type { HomeV2CoreManagement } from './CoreManagerCards'

type SettableTransportMode = Exclude<HomeV2TransportMode, 'unknown'>
type Notice = Readonly<{ error: boolean; message: string }>

function routerStatusMessage(status: HomeV2TransportMaintenanceStatus) {
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

function ensureLabel(status: HomeV2TransportMaintenanceStatus) {
  if (status.router.maintenance === 'install') {
    return t('home2.transportMaintenance.router.installAndStart')
  }
  if (status.router.maintenance === 'update') {
    return t('home2.transportMaintenance.router.updateAndRestart')
  }
  return t('home2.transportMaintenance.router.start')
}

function actionMessage(
  action: HomeV2TransportMaintenanceAction,
  result: HomeV2TransportMaintenanceActionResult,
) {
  if (result.outcome === 'completed') {
    if (result.warning) return t('home2.transportMaintenance.action.completedCleanupWarning')
    return action === 'set-mode'
      ? t('home2.transportMaintenance.action.modeSaved')
      : t('home2.transportMaintenance.action.routerCompleted')
  }
  if (result.code === 'action-unconfirmed') return t('home2.transportMaintenance.action.unconfirmed')
  if (result.code === 'core-install-missing') return t('home2.transportMaintenance.action.coreMissing')
  if (result.code === 'core-runtime-not-stopped') return t('home2.transportMaintenance.action.coreRunning')
  if (result.code === 'core-runtime-unknown') return t('home2.transportMaintenance.action.coreUnknown')
  if (result.code === 'external-router-active') return t('home2.transportMaintenance.action.externalRouter')
  if (result.code === 'i2p-router-required') return t('home2.transportMaintenance.action.routerRequired')
  if (result.code === 'operation-in-progress') return t('home2.transportMaintenance.action.inProgress')
  if (result.code === 'router-unsupported') return t('home2.transportMaintenance.action.unsupported')
  if (result.code === 'status-unavailable') return t('home2.transportMaintenance.action.statusUnavailable')
  if (result.code === 'target-changed') return t('home2.transportMaintenance.action.targetChanged')
  return result.outcome === 'failed'
    ? t('home2.transportMaintenance.action.failed')
    : t('home2.transportMaintenance.action.notAllowed')
}

function statusFingerprint(status: HomeV2TransportMaintenanceStatus) {
  return [
    status.capabilities.canEnsureRouter,
    status.capabilities.canSetDirectAndI2p,
    status.capabilities.canSetDirectOnly,
    status.capabilities.canSetI2pOnly,
    status.core.install,
    status.core.runtime,
    status.issue,
    status.router.maintenance,
    status.router.state,
    status.router.version,
    status.transportMode,
  ].join('|')
}

function canSetMode(status: HomeV2TransportMaintenanceStatus, mode: SettableTransportMode) {
  if (mode === 'direct-and-i2p') return status.capabilities.canSetDirectAndI2p
  if (mode === 'direct-only') return status.capabilities.canSetDirectOnly
  return status.capabilities.canSetI2pOnly
}

export function TransportMaintenancePanel({
  management,
}: {
  readonly management: HomeV2CoreManagement
}) {
  const client = window.homeV2CoreManagers
  const getStatus = client?.getTransportMaintenanceStatus
  const runAction = client?.runTransportMaintenanceAction
  const [status, setStatus] = useState<HomeV2TransportMaintenanceStatus | null>(null)
  const [selectedMode, setSelectedMode] = useState<SettableTransportMode | null>(null)
  const [busy, setBusy] = useState<HomeV2TransportMaintenanceAction | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [initialLoadFailed, setInitialLoadFailed] = useState(false)
  const [stale, setStale] = useState(false)
  const disposed = useRef(false)
  const busyRef = useRef(false)
  const statusRef = useRef<HomeV2TransportMaintenanceStatus | null>(null)
  const requestSequence = useRef(0)

  const refresh = async () => {
    if (!getStatus || busyRef.current) return
    const sequence = ++requestSequence.current
    try {
      const next = parseHomeV2TransportMaintenanceStatus(await getStatus())
      if (disposed.current || sequence !== requestSequence.current) return
      if (!statusRef.current || statusFingerprint(statusRef.current) !== statusFingerprint(next)) {
        setSelectedMode(next.transportMode === 'unknown' ? null : next.transportMode)
      }
      statusRef.current = next
      setStatus(next)
      setInitialLoadFailed(false)
      setStale(false)
    } catch {
      if (disposed.current || sequence !== requestSequence.current) return
      if (!statusRef.current) setInitialLoadFailed(true)
      else setStale(true)
    }
  }

  useEffect(() => {
    disposed.current = false
    busyRef.current = false
    statusRef.current = null
    setStatus(null)
    setSelectedMode(null)
    setBusy(null)
    setNotice(null)
    setInitialLoadFailed(false)
    setStale(false)
    void refresh()
    const interval = window.setInterval(() => void refresh(), 30_000)
    return () => {
      disposed.current = true
      requestSequence.current += 1
      window.clearInterval(interval)
    }
  }, [client])

  if (!getStatus || !runAction) return null
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

  const run = async (
    action: HomeV2TransportMaintenanceAction,
    mode: SettableTransportMode | null,
  ) => {
    if (busyRef.current || stale) return
    if (action === 'ensure-router' && !status.capabilities.canEnsureRouter) return
    if (action === 'set-mode' && (!mode || !canSetMode(status, mode))) return
    const sequence = ++requestSequence.current
    busyRef.current = true
    setBusy(action)
    setNotice(null)
    try {
      const result = parseHomeV2TransportMaintenanceActionResult(await runAction(action, mode))
      if (disposed.current || sequence !== requestSequence.current) return
      statusRef.current = result.status
      setStatus(result.status)
      setSelectedMode(result.status.transportMode === 'unknown' ? null : result.status.transportMode)
      setStale(false)
      setNotice({
        error: result.outcome !== 'completed',
        message: actionMessage(action, result),
      })
      if (result.outcome === 'completed') management.onRefresh?.()
    } catch {
      if (!disposed.current && sequence === requestSequence.current) {
        setStale(true)
        setNotice({ error: true, message: t('home2.transportMaintenance.action.failed') })
      }
    } finally {
      if (!disposed.current && sequence === requestSequence.current) {
        busyRef.current = false
        setBusy(null)
      }
    }
  }

  const currentMode = status.transportMode === 'unknown' ? null : status.transportMode
  const modeChanged = selectedMode !== null && selectedMode !== currentMode
  const modeAllowed = selectedMode !== null && canSetMode(status, selectedMode)
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
