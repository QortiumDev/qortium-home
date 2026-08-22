import { useEffect, useRef, useState } from 'react'
import type {
  HomeV2QortalMaintenanceActionResult,
  HomeV2QortalMaintenanceRelease,
  HomeV2QortalMaintenanceStatus,
} from '../../home-v2-live/core-manager-client'
import {
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

export function QortalMaintenancePanel({ management }: { readonly management: HomeV2CoreManagement }) {
  const client = window.homeV2CoreManagers
  const getStatus = client?.getQortalMaintenanceStatus
  const checkRelease = client?.checkQortalMaintenanceRelease
  const runAction = client?.runQortalMaintenanceAction
  const [status, setStatus] = useState<HomeV2QortalMaintenanceStatus | null>(null)
  const [release, setRelease] = useState<HomeV2QortalMaintenanceRelease | null>(null)
  const [busy, setBusy] = useState<'action' | 'check' | null>(null)
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
      }
      statusRef.current = next
      setStatus(next)
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
              <button type="button" onClick={() => void refresh()}>{t('home2.qortalMaintenance.retry')}</button>
            </>
          ) : <p role="status">{t('home2.qortalMaintenance.loading')}</p>}
        </div>
      </section>
    )
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
            <button type="button" disabled={busy !== null} onClick={() => void check()}>
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
      <p className="home-v2-core-notice" id="qortal-maintenance-state">{statusMessage(status)}</p>
      {notice ? <p className="home-v2-core-notice" role="status">{notice}</p> : null}
    </section>
  )
}
