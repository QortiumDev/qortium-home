import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import {
  defaultHomeV2Appearance,
  resolveHomeV2SystemLanguage,
} from '../v2/appearance'
import { createPermissionState } from '../v2/bridge-permissions'
import type {
  AppDescriptor,
  AppId,
  HomeV2Snapshot,
  IdentityId,
  NetworkId,
  NodeConnectionMode,
  NodeProfileRef,
  NodeSummary,
} from '../v2/contracts'
import { createProductState, reduceProductState } from '../v2/product-model'
import { HomeV2Prototype } from '../v2/shell/HomeV2Prototype'
import type { HomeV2NodeClient } from './node-client'

function brand<Type extends string>(value: string): Type {
  return value as Type
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nullableString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function nullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const plannedApps: readonly AppDescriptor[] = [
  {
    id: brand<AppId>('home-v2:app:chat'),
    title: 'Chat',
    description: 'One app for Qortium and Qortal conversations.',
    category: 'communication',
    sourceNetwork: 'qortium',
    resourceIdentity: { service: 'APP', name: 'Chat', identifier: 'Chat' },
    targetNetworks: ['qortium', 'qortal'],
    placement: 'pinned',
  },
  {
    id: brand<AppId>('home-v2:app:wallets'),
    title: 'Wallets',
    description: 'Balances and activity across available networks.',
    category: 'finance',
    sourceNetwork: 'qortium',
    resourceIdentity: { service: 'APP', name: 'Wallets', identifier: 'Wallets' },
    targetNetworks: ['qortium', 'qortal'],
    placement: 'pinned',
  },
]

function initialNode(network: NetworkId): NodeSummary {
  return {
    ref: brand<NodeProfileRef>(`home-v2:node:${network}`),
    network,
    label: 'Checking configured node',
    mode: 'local',
    state: 'unknown',
    statusText: 'Checking',
    isTrusted: true,
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

function initialSnapshot(): HomeV2Snapshot {
  const resolvedTheme =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  return {
    account: {
      state: 'none',
      selectedIdentityId: null,
      rememberUnlock: false,
      lockOnExit: true,
      manuallyLocked: false,
      secureStorageAvailable: false,
    },
    appearance: {
      ...defaultHomeV2Appearance,
      resolvedTheme,
      resolvedLanguage: resolveHomeV2SystemLanguage(navigator.language),
    },
    identity: {
      id: brand<IdentityId>('home-v2:identity:none'),
      displayLabel: 'No account',
      selectedWallet: null,
      presences: {
        qortal: {
          network: 'qortal',
          state: 'unavailable',
          address: null,
          names: [],
          primaryName: null,
          avatar: null,
          detail: 'Account integration is not enabled in this build.',
        },
        qortium: {
          network: 'qortium',
          state: 'unavailable',
          address: null,
          names: [],
          primaryName: null,
          avatar: null,
          detail: 'Account integration is not enabled in this build.',
        },
      },
    },
    nodes: { qortal: initialNode('qortal'), qortium: initialNode('qortium') },
    apps: plannedApps,
    recentItems: [],
    reticulum: {
      state: 'disabled',
      enabled: false,
      statusText: 'Not connected in this build',
    },
  }
}

function parseNodeSummary(value: unknown, network: NetworkId): NodeSummary {
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
    ref: brand<NodeProfileRef>(String(value.ref ?? `home-v2:node:${network}`)),
    network,
    label: String(value.label ?? 'Configured node'),
    mode,
    state,
    statusText: String(value.statusText ?? 'Unknown'),
    isTrusted: value.isTrusted === true,
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

function parseNodesSnapshot(value: unknown) {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.nodes)) {
    throw new Error('Invalid Home v2 node snapshot.')
  }
  return Object.freeze({
    qortal: parseNodeSummary(value.nodes.qortal, 'qortal'),
    qortium: parseNodeSummary(value.nodes.qortium, 'qortium'),
  })
}

function unavailableNode(node: NodeSummary, error: unknown): NodeSummary {
  return {
    ...node,
    state: node.mode === 'disabled' ? 'offline' : 'unknown',
    statusText: node.mode === 'disabled' ? 'Disabled' : 'Unavailable',
    error:
      error instanceof Error ? error.message : 'Unable to refresh node status.',
    capabilities: { admin: false, read: false, write: false },
  }
}

export function HomeV2LiveApp() {
  const [productState, dispatchProduct] = useReducer(
    reduceProductState,
    undefined,
    createProductState,
  )
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [busyNetwork, setBusyNetwork] = useState<NetworkId | null>(null)
  const [customNetwork, setCustomNetwork] = useState<NetworkId | null>(null)
  const [customUrl, setCustomUrl] = useState('')
  const [customError, setCustomError] = useState<string | null>(null)
  const [nodeClient, setNodeClient] = useState<HomeV2NodeClient | null>(
    () => window.homeV2Nodes ?? null,
  )
  const permissionState = useMemo(createPermissionState, [])

  useEffect(() => {
    if (nodeClient) return
    let cancelled = false
    void import('./android-node-client')
      .then(({ createAndroidHomeV2NodeClient }) => {
        if (!cancelled) setNodeClient(createAndroidHomeV2NodeClient())
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setSnapshot((current) => ({
          ...current,
          nodes: {
            qortal: unavailableNode(current.nodes.qortal, error),
            qortium: unavailableNode(current.nodes.qortium, error),
          },
        }))
      })
    return () => {
      cancelled = true
    }
  }, [nodeClient])

  const refresh = useCallback(async () => {
    if (!nodeClient) return
    try {
      const nodes = parseNodesSnapshot(await nodeClient.getSnapshot())
      setSnapshot((current) => ({ ...current, nodes }))
    } catch (error) {
      setSnapshot((current) => ({
        ...current,
        nodes: {
          qortal: unavailableNode(current.nodes.qortal, error),
          qortium: unavailableNode(current.nodes.qortium, error),
        },
      }))
    }
  }, [nodeClient])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 15_000)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [refresh])

  const setNodeMode = async (
    network: NetworkId,
    mode: NodeConnectionMode,
  ) => {
    if (!nodeClient) return
    setBusyNetwork(network)
    try {
      const nodes = parseNodesSnapshot(
        await nodeClient.setMode(network, mode),
      )
      setSnapshot((current) => ({ ...current, nodes }))
    } catch (error) {
      setSnapshot((current) => ({
        ...current,
        nodes: {
          ...current.nodes,
          [network]: unavailableNode(current.nodes[network], error),
        },
      }))
    } finally {
      setBusyNetwork(null)
    }
  }

  const openCustomNode = (network: NetworkId) => {
    setCustomNetwork(network)
    setCustomUrl(snapshot.nodes[network].customUrl ?? '')
    setCustomError(null)
  }

  const saveCustomNode = async () => {
    if (!customNetwork || !nodeClient) return
    setBusyNetwork(customNetwork)
    setCustomError(null)
    try {
      const nodes = parseNodesSnapshot(
        await nodeClient.setCustomUrl(customNetwork, customUrl),
      )
      setSnapshot((current) => ({ ...current, nodes }))
      setCustomNetwork(null)
    } catch (error) {
      setCustomError(
        error instanceof Error ? error.message : 'Unable to save the custom node.',
      )
    } finally {
      setBusyNetwork(null)
    }
  }

  return (
    <>
      <HomeV2Prototype
        snapshot={snapshot}
        productState={productState}
        permissionState={permissionState}
        layout={window.homeV2Nodes ? 'desktop' : 'phone'}
        surfaceNotice={
          busyNetwork
            ? `Updating ${busyNetwork === 'qortal' ? 'Qortal' : 'Qortium'}…`
            : 'Live node data · account and apps not connected'
        }
        onActivateTab={(tabId) =>
          dispatchProduct({ type: 'activate-tab', tabId })
        }
        onCloseTab={(tabId) => dispatchProduct({ type: 'close-tab', tabId })}
        onNavigate={(destination) =>
          dispatchProduct({ type: 'navigate', destination })
        }
        onRefreshNode={() => void refresh()}
        onSetNodeMode={(network, mode) => void setNodeMode(network, mode)}
        onConfigureCustomNode={openCustomNode}
      />
      {customNetwork ? (
        <div className="home-v2-dialog-backdrop" role="presentation">
          <section
            className="home-v2-custom-node-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-v2-custom-node-title"
          >
            <header>
              <h2 id="home-v2-custom-node-title">
                Custom {customNetwork === 'qortal' ? 'Qortal' : 'Qortium'} node
              </h2>
              <p>Remote nodes must use HTTPS. Loopback HTTP is allowed.</p>
            </header>
            <label>
              <span>Node URL</span>
              <input
                autoFocus
                type="url"
                value={customUrl}
                placeholder="https://node.example"
                onChange={(event) => setCustomUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveCustomNode()
                }}
              />
            </label>
            <div
              className="home-v2-custom-node-dialog__message"
              aria-live="polite"
            >
              {customError ?? 'Saving also selects Custom mode.'}
            </div>
            <footer>
              <button
                type="button"
                className="home-v2-secondary-button"
                disabled={busyNetwork !== null}
                onClick={() => setCustomNetwork(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="home-v2-primary-button"
                disabled={busyNetwork !== null || !customUrl.trim()}
                onClick={() => void saveCustomNode()}
              >
                Save
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  )
}
