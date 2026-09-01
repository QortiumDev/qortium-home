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
  parseHomeV2TransportProgress,
  type HomeV2TransportProgress,
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
    if (result.warning === 'restart-required') {
      return t('home2.transportMaintenance.action.modeSavedRestartRequired')
    }
    if (result.warning) return t('home2.transportMaintenance.action.completedCleanupWarning')
    return action === 'set-mode' || action === 'set-mode-live'
      ? t('home2.transportMaintenance.action.modeSaved')
      : t('home2.transportMaintenance.action.routerCompleted')
  }
  if (result.code === 'action-unconfirmed') return t('home2.transportMaintenance.action.unconfirmed')
  if (result.code === 'core-install-missing') return t('home2.transportMaintenance.action.coreMissing')
  if (result.code === 'core-runtime-not-running') return t('home2.transportMaintenance.action.coreNotRunning')
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
    status.capabilities.canUpdateRouter,
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
 * Which write to use for a mode change.
 *
 * A stopped Core takes the settings-file path. A running one takes the API
 * path, which stores the value immediately and needs a restart to apply it --
 * the caller then asks the user to confirm that restart.
 */
export function transportModeActionFor(
  status: HomeV2TransportMaintenanceStatus,
  mode: HomeV2SettableTransportMode,
): HomeV2TransportMaintenanceAction | null {
  if (canSetTransportMode(status, mode)) return 'set-mode'
  if (!status.capabilities.canSetModeWhileRunning) return null
  if (mode !== 'direct-only' &&
    status.router.state !== 'managed-running' && status.router.state !== 'external-running') {
    return null
  }
  return 'set-mode-live'
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
  // Set when a live mode write succeeded: the node stored the value but will
  // not use it until it restarts, and restarting is the user's decision.
  const [restartRequired, setRestartRequired] = useState(false)
  // Install progress for the managed router. The one push channel here; the
  // rest of this surface polls, and a percentage that arrives on the next
  // tick is not progress.
  const [progress, setProgress] = useState<HomeV2TransportProgress | null>(null)
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
    if (action === 'update-router' && !status.capabilities.canUpdateRouter) return
    if (action === 'stop-router' && !status.capabilities.canStopRouter) return
    if (action === 'reveal-router' && !status.capabilities.canRevealRouterFolder) return
    if (action === 'set-mode' && (!mode || !canSetTransportMode(status, mode))) return
    if (action === 'set-mode-live' &&
      (!mode || transportModeActionFor(status, mode) !== 'set-mode-live')) return
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
      if (result.outcome === 'completed' && result.warning === 'restart-required') {
        setRestartRequired(true)
      }
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

  useEffect(() => {
    if (!client?.onTransportProgress) return undefined
    return client.onTransportProgress((event) => {
      const parsed = parseHomeV2TransportProgress(event)
      // Malformed events are DROPPED rather than rendered: a stale percentage
      // beats a wrong one, and beats a blank bar.
      if (!parsed) return
      setProgress(parsed.action === 'idle' ? null : parsed)
    })
  }, [client])

  const currentMode = status && status.transportMode !== 'unknown' ? status.transportMode : null
  const modeChanged = selectedMode !== null && selectedMode !== currentMode
  // Allowed if EITHER write is available: the settings file while Core is
  // stopped, or the node's API while it runs.
  const modeAllowed = !!status && selectedMode !== null &&
    transportModeActionFor(status, selectedMode) !== null

  /**
   * Restart Core so a stored transport mode takes effect.
   *
   * Only ever called from an explicit confirmation: the mode write already
   * succeeded, and this is the separate step the user opts into.
   */
  const confirmRestart = async () => {
    if (!client?.stop || !client?.start || busyRef.current) return
    busyRef.current = true
    setBusy('set-mode-live')
    setNotice(null)
    try {
      await client.stop('qortium')
      await client.start('qortium')
      if (disposed.current) return
      setRestartRequired(false)
      setNotice({ error: false, message: t('home2.transportMaintenance.action.restarted') })
      coreRefresh.current?.()
    } catch {
      if (!disposed.current) {
        setNotice({ error: true, message: t('home2.transportMaintenance.action.restartFailed') })
      }
    } finally {
      if (!disposed.current) {
        busyRef.current = false
        setBusy(null)
      }
      void refresh()
    }
  }

  return {
    available: !!getStatus && !!runAction,
    busy,
    confirmRestart,
    currentMode,
    initialLoadFailed,
    modeAllowed,
    modeChanged,
    notice,
    progress,
    refresh,
    restartRequired,
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
  /** Last action outcome, so a tile can report a failure it caused. */
  readonly notice: HomeV2TransportMaintenanceNotice | null
  readonly stale: boolean
  readonly status: HomeV2TransportMaintenanceStatus | null
  readonly onEnsureRouter?: () => void
  /** Opens the managed router's folder. Absent when the router is external. */
  readonly onRevealRouterFolder?: () => void
  readonly onSetTransportMode?: (mode: HomeV2SettableTransportMode) => void
  readonly onStopRouter?: () => void
  readonly onUpdateRouter?: () => void
}

export function toHomeV2TransportManagement(
  transport: HomeV2TransportMaintenance,
): HomeV2TransportManagement {
  return {
    busy: transport.busy,
    mode: transport.currentMode,
    notice: transport.notice,
    onEnsureRouter: () => void transport.run('ensure-router', null),
    onSetTransportMode: (mode: HomeV2SettableTransportMode) => {
      const status = transport.status
      const action = status ? transportModeActionFor(status, mode) : null
      if (!action) return
      void transport.run(action, mode)
    },
    onRevealRouterFolder: () => void transport.run('reveal-router', null),
    onStopRouter: () => void transport.run('stop-router', null),
    onUpdateRouter: () => void transport.run('update-router', null),
    stale: transport.stale,
    status: transport.status,
  }
}
