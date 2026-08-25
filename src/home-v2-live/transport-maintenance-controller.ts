import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import type {
  HomeV2TransportMaintenanceAction,
  HomeV2TransportMaintenanceActionResult,
  HomeV2TransportMaintenanceStatus,
  HomeV2TransportMode,
} from './core-manager-client'
import {
  parseHomeV2TransportMaintenanceActionResult,
  parseHomeV2TransportMaintenanceStatus,
} from './core-manager-client'

export type HomeV2SettableTransportMode = Exclude<HomeV2TransportMode, 'unknown'>
export type HomeV2TransportMaintenanceNotice = Readonly<{
  readonly error: boolean
  readonly message: string
}>

export function transportActionMessage(
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

export function transportStatusFingerprint(status: HomeV2TransportMaintenanceStatus) {
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

export function canSetTransportMode(
  status: HomeV2TransportMaintenanceStatus,
  mode: HomeV2SettableTransportMode,
) {
  if (mode === 'direct-and-i2p') return status.capabilities.canSetDirectAndI2p
  if (mode === 'direct-only') return status.capabilities.canSetDirectOnly
  return status.capabilities.canSetI2pOnly
}

/**
 * Owns the i2p router / transport-mode maintenance surface: status polling,
 * ensure-router and set-mode, and the busy, stale and notice state around them.
 *
 * Legacy renderer core events are disabled in Home v2, so the bridge is
 * invoke-only and polling is the mechanism. The interval, its cleanup and the
 * request-sequence guards are the panel's original ones, moved verbatim.
 */
export function useHomeV2TransportMaintenance(onCoreRefresh?: () => void) {
  const client = window.homeV2CoreManagers
  const getStatus = client?.getTransportMaintenanceStatus
  const runAction = client?.runTransportMaintenanceAction
  const [status, setStatus] = useState<HomeV2TransportMaintenanceStatus | null>(null)
  const [selectedMode, setSelectedMode] = useState<HomeV2SettableTransportMode | null>(null)
  const [busy, setBusy] = useState<HomeV2TransportMaintenanceAction | null>(null)
  const [notice, setNotice] = useState<HomeV2TransportMaintenanceNotice | null>(null)
  const [initialLoadFailed, setInitialLoadFailed] = useState(false)
  const [stale, setStale] = useState(false)
  const disposed = useRef(false)
  const busyRef = useRef(false)
  const statusRef = useRef<HomeV2TransportMaintenanceStatus | null>(null)
  const requestSequence = useRef(0)
  // Read at call time, exactly as the panel read `management.onRefresh` from
  // its current props when an action completed.
  const coreRefresh = useRef(onCoreRefresh)
  coreRefresh.current = onCoreRefresh

  const refresh = async () => {
    if (!getStatus || busyRef.current) return
    const sequence = ++requestSequence.current
    try {
      const next = parseHomeV2TransportMaintenanceStatus(await getStatus())
      if (disposed.current || sequence !== requestSequence.current) return
      if (!statusRef.current ||
        transportStatusFingerprint(statusRef.current) !== transportStatusFingerprint(next)) {
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

  const run = async (
    action: HomeV2TransportMaintenanceAction,
    mode: HomeV2SettableTransportMode | null,
  ) => {
    if (!runAction || !status) return
    if (busyRef.current || stale) return
    if (action === 'ensure-router' && !status.capabilities.canEnsureRouter) return
    if (action === 'set-mode' && (!mode || !canSetTransportMode(status, mode))) return
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
        message: transportActionMessage(action, result),
      })
      if (result.outcome === 'completed') coreRefresh.current?.()
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

  const currentMode = status && status.transportMode !== 'unknown' ? status.transportMode : null
  const modeChanged = selectedMode !== null && selectedMode !== currentMode
  const modeAllowed = !!status && selectedMode !== null && canSetTransportMode(status, selectedMode)

  return {
    available: !!getStatus && !!runAction,
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
  } as const
}

export type HomeV2TransportMaintenance = ReturnType<typeof useHomeV2TransportMaintenance>

/**
 * The i2p transport slice of `HomeV2CoreManagement`, so a dashboard tile can
 * show router state and offer ensure-router / mode changes.
 */
export interface HomeV2TransportManagement {
  readonly busy: HomeV2TransportMaintenanceAction | null
  readonly mode: HomeV2SettableTransportMode | null
  readonly stale: boolean
  readonly status: HomeV2TransportMaintenanceStatus | null
  readonly onEnsureRouter?: () => void
  readonly onSetTransportMode?: (mode: HomeV2SettableTransportMode) => void
}

export function toHomeV2TransportManagement(
  transport: HomeV2TransportMaintenance,
): HomeV2TransportManagement {
  return {
    busy: transport.busy,
    mode: transport.currentMode,
    onEnsureRouter: () => void transport.run('ensure-router', null),
    onSetTransportMode: (mode: HomeV2SettableTransportMode) =>
      void transport.run('set-mode', mode),
    stale: transport.stale,
    status: transport.status,
  }
}
