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
    mode: 'local',
    state: 'unknown',
    statusText: 'Checking',
    isTrusted: true,
    customAuthenticated: false,
    customConfigured: false,
    customUrl: null,
    localCoreState: 'not-detected',
    localCoreStatusText: 'Checking local Core',
    nodeApiUrl: null,
    height: null,
    peerCount: null,
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
    mode,
    state,
    statusText: String(value.statusText ?? 'Unknown'),
    isTrusted: value.isTrusted === true,
    customAuthenticated: value.customAuthenticated === true,
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
  readonly coreClient: HomeV2CoreManagerClient | null
  readonly nodeClient: HomeV2NodeClient | null
}) {
  const { coreClient, nodeClient } = options
  const [nodes, setNodes] = useState<HomeV2Nodes>(createInitialHomeV2Nodes)
  const [coreStatuses, setCoreStatuses] =
    useState<HomeV2CoreManagerStatuses>(initialCoreStatuses)
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
      if (sequence === nodeRefreshSequence.current) setNodes(next)
    } catch (error) {
      if (sequence === nodeRefreshSequence.current) markNodesUnavailable(error)
    }
  }, [markNodesUnavailable, nodeClient])

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
  ) => {
    if (!nodeClient || nodeMutationInFlight.current) return false
    nodeMutationInFlight.current = true
    const sequence = ++nodeRefreshSequence.current
    setNodeBusyNetwork(network)
    try {
      const next = parseHomeV2NodesSnapshot(
        await nodeClient.setCustomUrl(network, customUrl),
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
      await refreshNodes()
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
      return null
    } finally {
      if (actions[network] === action) actions[network] = null
      setCoreBusyActions({ ...actions })
    }
  }, [coreClient, refreshCoreStatuses, refreshNodes])

  return {
    coreAvailable: coreClient !== null,
    coreBusyActions,
    coreLastActions,
    coreStatuses,
    markNodesUnavailable,
    nodeBusyNetwork,
    nodes,
    refreshAll,
    refreshCoreStatuses,
    refreshNodes,
    runCoreAction,
    saveCustomNode,
    setNodeMode,
  } as const
}
