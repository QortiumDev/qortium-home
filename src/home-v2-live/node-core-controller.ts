import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  HomeV2CoreActionCode,
  HomeV2CoreManagerActionResult,
  HomeV2CoreManagerStatus,
} from '../../electron/home-v2-core-manager-contract'
import type {
  HomeV2Snapshot,
  NetworkId,
  NodeConnectionMode,
  NodeProfileRef,
  NodeSummary,
} from '../v2/contracts'
import {
  parseHomeV2CoreManagerActionResult,
  parseHomeV2CoreManagerStatus,
  type HomeV2CoreManagerClient,
} from './core-manager-client'
import type { HomeV2NodeClient } from './node-client'

export type HomeV2Nodes = HomeV2Snapshot['nodes']
export type { HomeV2CoreActionCode, HomeV2CoreManagerStatus }
export type HomeV2CoreManagerStatuses = Readonly<
  Record<NetworkId, HomeV2CoreManagerStatus>
>
export type HomeV2CoreManagerLastAction = {
  readonly action: 'start' | 'stop'
  readonly network: NetworkId
  readonly result: HomeV2CoreManagerActionResult | null
  readonly failed: boolean
}
export type HomeV2CoreManagerBusyActions = Readonly<
  Record<NetworkId, 'start' | 'stop' | null>
>
export type HomeV2CoreManagerLastActions = Readonly<
  Record<NetworkId, HomeV2CoreManagerLastAction | null>
>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nullableString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function nullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function createInitialHomeV2Node(network: NetworkId): NodeSummary {
  return {
    ref: `home-v2:node:${network}` as NodeProfileRef,
    network,
    label: 'Checking configured node',
    lastEnabledMode: 'local',
    mode: network === 'qortium' ? 'local' : 'disabled',
    state: 'unknown',
    statusText: 'Checking',
    isTrusted: true,
    customAuthenticated: false,
    adminTrusted: false,
    customConfigured: false,
    customUrl: null,
    localCoreState: 'not-detected',
    localCoreStatusText: 'Checking local Core',
    nodeApiUrl: null,
    height: null,
    peerCount: null,
    dataPeerCount: null,
    i2pPeerCount: null,
    i2pDataPeerCount: null,
    syncPercent: null,
    syncPhase: null,
    lastCheckedAt: null,
    error: null,
    capabilities: { admin: false, read: false, write: false },
  }
}

export function createInitialHomeV2Nodes(): HomeV2Nodes {
  return Object.freeze({
    qortal: createInitialHomeV2Node('qortal'),
    qortium: createInitialHomeV2Node('qortium'),
  })
}

export function parseHomeV2NodeSummary(
  value: unknown,
  network: NetworkId,
): NodeSummary {
  if (!isRecord(value) || value.network !== network) {
    throw new Error(`Invalid ${network} node snapshot.`)
  }
  const mode = value.mode
  const state = value.state
  if (
    mode !== 'disabled' &&
    mode !== 'local' &&
    mode !== 'public' &&
    mode !== 'custom'
  ) {
    throw new Error(`Invalid ${network} node mode.`)
  }
  if (
    state !== 'online' &&
    state !== 'syncing' &&
    state !== 'offline' &&
    state !== 'unknown'
  ) {
    throw new Error(`Invalid ${network} node state.`)
  }
  const capabilities = isRecord(value.capabilities) ? value.capabilities : {}
  return Object.freeze({
    ref: String(value.ref ?? `home-v2:node:${network}`) as NodeProfileRef,
    network,
    label: String(value.label ?? 'Configured node'),
    lastEnabledMode:
      value.lastEnabledMode === 'custom' ||
      value.lastEnabledMode === 'public' ||
      value.lastEnabledMode === 'local'
        ? value.lastEnabledMode
        : mode === 'disabled'
          ? 'local'
          : mode,
    mode,
    state,
    statusText: String(value.statusText ?? 'Unknown'),
    isTrusted: value.isTrusted === true,
    customAuthenticated: value.customAuthenticated === true,
    adminTrusted: value.adminTrusted === true,
    customConfigured: value.customConfigured === true,
    customUrl: nullableString(value.customUrl),
    localCoreState:
      value.localCoreState === 'running' ||
      value.localCoreState === 'installed' ||
      value.localCoreState === 'not-detected' ||
      value.localCoreState === 'unsupported'
        ? value.localCoreState
        : 'not-detected',
    localCoreStatusText: String(
      value.localCoreStatusText ?? 'Local Core status unavailable',
    ),
    nodeApiUrl: nullableString(value.nodeApiUrl),
    height: nullableNumber(value.height),
    peerCount: nullableNumber(value.peerCount),
    dataPeerCount: nullableNumber(value.dataPeerCount),
    i2pPeerCount: nullableNumber(value.i2pPeerCount),
    i2pDataPeerCount: nullableNumber(value.i2pDataPeerCount),
    syncPercent: nullableNumber(value.syncPercent),
    syncPhase: nullableString(value.syncPhase),
    lastCheckedAt: nullableNumber(value.lastCheckedAt),
    error: nullableString(value.error),
    capabilities: Object.freeze({
      admin: capabilities.admin === true,
      read: capabilities.read === true,
      write: capabilities.write === true,
    }),
  })
}

export function parseHomeV2NodesSnapshot(value: unknown): HomeV2Nodes {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isRecord(value.nodes) ||
    Object.keys(value.nodes).sort().join('|') !== 'qortal|qortium'
  ) {
    throw new Error('Invalid Home v2 node snapshot.')
  }
  return Object.freeze({
    qortal: parseHomeV2NodeSummary(value.nodes.qortal, 'qortal'),
    qortium: parseHomeV2NodeSummary(value.nodes.qortium, 'qortium'),
  })
}

export type HomeV2NodeModes = Readonly<Record<NetworkId, NodeConnectionMode>>

function parseNodeMode(value: unknown, network: NetworkId): NodeConnectionMode {
  if (
    value !== 'disabled' &&
    value !== 'local' &&
    value !== 'public' &&
    value !== 'custom'
  ) {
    throw new Error(`Invalid ${network} node mode.`)
  }
  return value
}

export function parseHomeV2NodeModes(value: unknown): HomeV2NodeModes {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isRecord(value.modes) ||
    Object.keys(value.modes).sort().join('|') !== 'qortal|qortium'
  ) {
    throw new Error('Invalid Home v2 node modes.')
  }
  return Object.freeze({
    qortal: parseNodeMode(value.modes.qortal, 'qortal'),
    qortium: parseNodeMode(value.modes.qortium, 'qortium'),
  })
}

/**
 * Applies the settings-only modes to the placeholder summaries.
 *
 * Only `mode` is taken: everything else in the summary is status, which this
 * read deliberately does not have. The rest keeps saying "Checking" until the
 * snapshot lands, which is true.
 */
export function applyHomeV2NodeModes(
  nodes: HomeV2Nodes,
  modes: HomeV2NodeModes,
): HomeV2Nodes {
  return Object.freeze({
    qortal: { ...nodes.qortal, mode: modes.qortal },
    qortium: { ...nodes.qortium, mode: modes.qortium },
  })
}

/**
 * Consecutive failed status polls before the nodes are reported unavailable.
 * Three at the 15s poll interval is ~45s of grace, which rides out ordinary
 * network blips without hiding a genuine outage for long.
 */
const UNAVAILABLE_AFTER_FAILED_POLLS = 3

export function unavailableHomeV2Node(
  node: NodeSummary,
  error: unknown,
): NodeSummary {
  return {
    ...node,
    state: node.mode === 'disabled' ? 'offline' : 'unknown',
    statusText: node.mode === 'disabled' ? 'Disabled' : 'Unavailable',
    error:
      error instanceof Error ? error.message : 'Unable to refresh node status.',
    adminTrusted: false,
    capabilities: { admin: false, read: false, write: false },
  }
}

function unavailableCoreStatus(
  network: NetworkId,
  issue: HomeV2CoreManagerStatus['issue'],
): HomeV2CoreManagerStatus {
  return {
    capabilities: { canStart: false, canStop: false },
    control: 'none',
    install: 'unknown',
    issue,
    network,
    revision: 1,
    runtime: 'unknown',
    schema: 'home-v2-core-manager',
  }
}

function initialCoreStatuses(
  issue: HomeV2CoreManagerStatus['issue'] = 'unsupported-platform',
): HomeV2CoreManagerStatuses {
  return Object.freeze({
    qortal: unavailableCoreStatus('qortal', issue),
    qortium: unavailableCoreStatus('qortium', issue),
  })
}

function parseCoreStatusOrUnavailable(
  value: PromiseSettledResult<HomeV2CoreManagerStatus>,
  network: NetworkId,
) {
  if (value.status === 'rejected') {
    return unavailableCoreStatus(network, 'status-unavailable')
  }
  try {
    return parseHomeV2CoreManagerStatus(value.value, network)
  } catch {
    return unavailableCoreStatus(network, 'status-unavailable')
  }
}

export function useHomeV2NodeCoreController(options: {
  /**
   * Called after a start/stop settles, success or failure.
   *
   * Start and stop change state that OTHER controllers read — the maintenance
   * slice's install gate and the transport row — and those poll on their own
   * 30s timers. Without this, stopping the Core left the install gate reading
   * "not stopped" for up to half a minute, so the tile told the user to stop a
   * Core they had just stopped and kept the Update button disabled, with no way
   * to force it fresh. The controllers cannot be reached from here directly
   * (they are constructed after this one), so the app passes a callback.
   */
  readonly onLifecycleSettled?: () => void
  readonly coreClient: HomeV2CoreManagerClient | null
  readonly nodeClient: HomeV2NodeClient | null
}) {
  const { coreClient, nodeClient } = options
  const [nodes, setNodes] = useState<HomeV2Nodes>(createInitialHomeV2Nodes)
  // Read at call time so the start handler sees the CURRENT mode without
  // being recreated on every poll.
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const [coreStatuses, setCoreStatuses] =
    useState<HomeV2CoreManagerStatuses>(initialCoreStatuses)
  // Read by the lifecycle follow-ups, which run from timers and would otherwise
  // close over the statuses as they were when the action was fired.
  const coreStatusesRef = useRef(coreStatuses)
  coreStatusesRef.current = coreStatuses
  const [nodeBusyNetwork, setNodeBusyNetwork] = useState<NetworkId | null>(null)
  const [coreBusyActions, setCoreBusyActions] =
    useState<HomeV2CoreManagerBusyActions>({ qortal: null, qortium: null })
  const [coreLastActions, setCoreLastActions] =
    useState<HomeV2CoreManagerLastActions>({ qortal: null, qortium: null })
  const coreActionsInFlight = useRef<Record<NetworkId, 'start' | 'stop' | null>>({
    qortal: null,
    qortium: null,
  })
  const coreRefreshSequence = useRef<Record<NetworkId, number>>({
    qortal: 0,
    qortium: 0,
  })
  const nodeMutationInFlight = useRef(false)
  const nodeRefreshSequence = useRef(0)
  // False only for the moment between mount and the first answer about which
  // networks are enabled. Surfaces exist that must not be drawn from a guess:
  // see `nodesReady` on the Dashboard.
  const [nodesReady, setNodesReady] = useState(false)
  // Set when a FULL snapshot has been applied. The sequence counter cannot
  // answer this -- it increments when a refresh starts, not when one lands.
  const snapshotLanded = useRef(false)
  // Follow-up polls after a start/stop, because the settle is not instant.
  //
  // A lifecycle action already refreshes everything the moment it returns, but a
  // Core that has just been asked to start has only SPAWNED by then -- its API
  // needs several seconds more before it answers. So that immediate refresh
  // captures the in-between state (process up, API silent) and the next
  // scheduled poll is up to 15s away, leaving the tile showing a half-started
  // Core long after it finished starting. That is the "dashboard tile does not
  // refresh when it should" report.
  //
  // Home 1.x solved the same class of problem by refreshing on the EVENT rather
  // than waiting for the interval (#74, "event-driven refresh"): it bumped a
  // node epoch when reachability changed and re-read everything derived from the
  // node. Home 2 has no epoch, so the equivalent is to keep asking for a short
  // while after the event, then stop.
  const lifecycleFollowUps = useRef<number[]>([])
  const clearLifecycleFollowUps = useCallback(() => {
    for (const handle of lifecycleFollowUps.current) window.clearTimeout(handle)
    lifecycleFollowUps.current = []
  }, [])
  // A single failed poll must not declare both nodes unreadable. Everything
  // downstream keys off `capabilities.read` — an app tab whose node reads as
  // unreadable stops resolving, which on Android swaps the iframe key and
  // reloads the app, destroying anything typed into it. Flaky networks make
  // one-off failures routine, so require several in a row (~45s at the 15s
  // poll) before reporting the nodes as unavailable, and keep showing the last
  // good status until then.
  const consecutiveNodeFailures = useRef(0)

  const markNodesUnavailable = useCallback((error: unknown) => {
    setNodes((current) => ({
      qortal: unavailableHomeV2Node(current.qortal, error),
      qortium: unavailableHomeV2Node(current.qortium, error),
    }))
  }, [])

  const refreshNodes = useCallback(async () => {
    if (!nodeClient || nodeMutationInFlight.current) return
    const sequence = ++nodeRefreshSequence.current
    try {
      const next = parseHomeV2NodesSnapshot(await nodeClient.getSnapshot())
      if (sequence !== nodeRefreshSequence.current) return
      consecutiveNodeFailures.current = 0
      setNodes(next)
      snapshotLanded.current = true
      setNodesReady(true)
    } catch (error) {
      if (sequence !== nodeRefreshSequence.current) return
      consecutiveNodeFailures.current += 1
      if (consecutiveNodeFailures.current >= UNAVAILABLE_AFTER_FAILED_POLLS) {
        markNodesUnavailable(error)
      }
    }
  }, [markNodesUnavailable, nodeClient])

  // The fast read: which networks are enabled, before any node is contacted.
  //
  // Without it the first paint uses the placeholder modes -- Qortium local,
  // Qortal disabled -- so a user with Qortal enabled saw the Qortium panels
  // alone, then the Qortal ones appeared about four seconds later when the
  // snapshot's probes finally returned. Anyone with Qortium DISABLED saw the
  // opposite: panels that then vanished.
  //
  // Failure is not fatal. `nodesReady` is set either way, so a bridge that
  // cannot answer this falls back to the previous behaviour (paint the
  // placeholder, correct it when the snapshot lands) rather than hanging.
  useEffect(() => {
    if (!nodeClient) return
    let cancelled = false
    void nodeClient
      .getModes()
      .then((value) => {
        if (cancelled) return
        const modes = parseHomeV2NodeModes(value)
        // A full snapshot that landed first is authoritative -- it has the same
        // modes and the status besides, so this must not overwrite it.
        if (snapshotLanded.current) return
        setNodes((current) => applyHomeV2NodeModes(current, modes))
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setNodesReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [nodeClient])

  const refreshCoreStatuses = useCallback(async () => {
    if (!coreClient) {
      setCoreStatuses(initialCoreStatuses())
      return
    }
    const sequences = {
      qortium: coreActionsInFlight.current.qortium
        ? null
        : ++coreRefreshSequence.current.qortium,
      qortal: coreActionsInFlight.current.qortal
        ? null
        : ++coreRefreshSequence.current.qortal,
    }
    const results = await Promise.allSettled([
      coreClient.getStatus('qortium'),
      coreClient.getStatus('qortal'),
    ])
    if (
      sequences.qortium !== coreRefreshSequence.current.qortium &&
      sequences.qortal !== coreRefreshSequence.current.qortal
    ) return
    setCoreStatuses((current) => ({
      qortium:
        sequences.qortium !== null &&
        sequences.qortium === coreRefreshSequence.current.qortium
          ? parseCoreStatusOrUnavailable(results[0], 'qortium')
          : current.qortium,
      qortal:
        sequences.qortal !== null &&
        sequences.qortal === coreRefreshSequence.current.qortal
          ? parseCoreStatusOrUnavailable(results[1], 'qortal')
          : current.qortal,
    }))
  }, [coreClient])

  useEffect(() => {
    nodeRefreshSequence.current += 1
    return () => {
      nodeRefreshSequence.current += 1
    }
  }, [nodeClient])

  useEffect(() => {
    coreRefreshSequence.current.qortal += 1
    coreRefreshSequence.current.qortium += 1
    return () => {
      coreRefreshSequence.current.qortal += 1
      coreRefreshSequence.current.qortium += 1
    }
  }, [coreClient])

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshNodes(), refreshCoreStatuses()])
  }, [refreshCoreStatuses, refreshNodes])

  // Re-read until the Core reaches the state the action asked for, or until the
  // window closes -- whichever comes first.
  //
  // The schedule is sized from a MEASUREMENT, not a guess. Watching a real
  // managed Core restart on 2026-08-30: the process started at 15:36:57 and its
  // API first answered at 15:37:12 -- FIFTEEN seconds later. An earlier draft of
  // this fix stopped at 9s, so every follow-up would have fired while the API
  // was still silent and the tile would have waited for the regular poll anyway.
  //
  // So the window reaches past that, and stops early when there is nothing left
  // to wait for: once the network's runtime matches the intent ('running' after
  // a start, 'stopped' after a stop) the remaining reads are cancelled. A Core
  // that comes up in two seconds costs two reads, not six.
  const scheduleLifecycleFollowUps = useCallback((
    network: NetworkId,
    action: 'start' | 'stop',
    settled: () => void,
  ) => {
    // A newer action supersedes an older one's follow-ups; a stop issued right
    // after a start must not be second-guessed by the start's pending reads.
    clearLifecycleFollowUps()
    // What counts as "settled" differs by direction, and picking the wrong
    // signal makes this fix do nothing:
    //
    //   start -> the node ANSWERING (capabilities.read). Core runtime is not
    //            usable here: it comes from process ownership and flips to
    //            'running' the instant the process spawns, which is precisely
    //            the moment the API is still silent. Keying off it would cancel
    //            every follow-up immediately.
    //   stop  -> the runtime reporting 'stopped'. The process going away IS the
    //            event; there is no API to wait for.
    const hasSettled = () => action === 'start'
      ? nodesRef.current[network]?.capabilities.read === true
      : coreStatusesRef.current[network]?.runtime === 'stopped'
    for (const delay of [1_500, 4_000, 8_000, 13_000, 20_000, 30_000]) {
      lifecycleFollowUps.current.push(window.setTimeout(() => {
        if (hasSettled()) {
          clearLifecycleFollowUps()
          return
        }
        void refreshAll()
        settled()
      }, delay))
    }
  }, [clearLifecycleFollowUps, refreshAll])

  useEffect(() => clearLifecycleFollowUps, [clearLifecycleFollowUps])

  useEffect(() => {
    void refreshAll()
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshAll()
    }, 15_000)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshAll()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [refreshAll])

  const setNodeMode = useCallback(async (
    network: NetworkId,
    mode: NodeConnectionMode,
  ) => {
    if (!nodeClient || nodeMutationInFlight.current) return false
    nodeMutationInFlight.current = true
    const sequence = ++nodeRefreshSequence.current
    setNodeBusyNetwork(network)
    try {
      const next = parseHomeV2NodesSnapshot(await nodeClient.setMode(network, mode))
      if (sequence === nodeRefreshSequence.current) setNodes(next)
      return true
    } catch (error) {
      if (sequence === nodeRefreshSequence.current) {
        setNodes((current) => ({
          ...current,
          [network]: unavailableHomeV2Node(current[network], error),
        }))
      }
      return false
    } finally {
      nodeMutationInFlight.current = false
      setNodeBusyNetwork(null)
    }
  }, [nodeClient])

  const saveCustomNode = useCallback(async (
    network: NetworkId,
    customUrl: string,
    apiKey?: string,
  ) => {
    if (!nodeClient || nodeMutationInFlight.current) return false
    nodeMutationInFlight.current = true
    const sequence = ++nodeRefreshSequence.current
    setNodeBusyNetwork(network)
    try {
      const next = parseHomeV2NodesSnapshot(
        await nodeClient.setCustomUrl(network, customUrl, apiKey),
      )
      if (sequence === nodeRefreshSequence.current) setNodes(next)
      return true
    } finally {
      nodeMutationInFlight.current = false
      setNodeBusyNetwork(null)
    }
  }, [nodeClient])

  const runCoreAction = useCallback(async (
    network: NetworkId,
    action: 'start' | 'stop',
  ) => {
    const actions = coreActionsInFlight.current
    if (
      !coreClient ||
      actions[network] !== null ||
      (action === 'start' && Object.values(actions).includes('start'))
    ) return null
    actions[network] = action
    coreRefreshSequence.current[network] += 1
    setCoreBusyActions({ ...actions })
    setCoreLastActions((current) => ({ ...current, [network]: null }))
    try {
      const result = parseHomeV2CoreManagerActionResult(
        await coreClient[action](network),
        network,
      )
      coreRefreshSequence.current[network] += 1
      setCoreStatuses((current) => ({
        ...current,
        [network]: result.status,
      }))
      setCoreLastActions((current) => ({
        ...current,
        [network]: { action, failed: false, network, result },
      }))
      // Starting a Core through Home means using it: 1.x switched the node to
      // local at exactly this point. Deliberately ONE-TIME, tied to the start
      // action rather than to the Core being up -- otherwise a user who moved
      // back to a public or custom node afterwards would be dragged to local
      // again on the next poll, and could never leave.
      if (action === 'start' && result.outcome === 'completed' &&
        nodesRef.current[network]?.mode !== 'local') {
        await setNodeMode(network, 'local')
      }
      await refreshNodes()
      options.onLifecycleSettled?.()
      scheduleLifecycleFollowUps(network, action, () => options.onLifecycleSettled?.())
      return result
    } catch {
      coreRefreshSequence.current[network] += 1
      setCoreLastActions((current) => ({
        ...current,
        [network]: { action, failed: true, network, result: null },
      }))
      if (actions[network] === action) actions[network] = null
      setCoreBusyActions({ ...actions })
      await refreshCoreStatuses()
      // Also on failure: a stop that reported an error may still have stopped
      // it, and leaving the gate stale is how the tile ends up contradicting
      // itself.
      options.onLifecycleSettled?.()
      scheduleLifecycleFollowUps(network, action, () => options.onLifecycleSettled?.())
      return null
    } finally {
      if (actions[network] === action) actions[network] = null
      setCoreBusyActions({ ...actions })
    }
  }, [coreClient, options, refreshCoreStatuses, refreshNodes, scheduleLifecycleFollowUps, setNodeMode])

  return {
    coreAvailable: coreClient !== null,
    coreBusyActions,
    coreLastActions,
    coreStatuses,
    markNodesUnavailable,
    nodeBusyNetwork,
    nodes,
    nodesReady,
    refreshAll,
    refreshCoreStatuses,
    refreshNodes,
    runCoreAction,
    saveCustomNode,
    setNodeMode,
  } as const
}
