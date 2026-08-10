import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  clampHomeV2AppZoom,
  defaultHomeV2Appearance,
  resolveHomeV2SystemLanguage,
  type HomeV2Accent,
  type HomeV2Language,
  type HomeV2TextSize,
  type HomeV2ThemePreference,
} from '../v2/appearance'
import { createPermissionState } from '../v2/bridge-permissions'
import type {
  AppDescriptor,
  AppId,
  AppTabContext,
  HomeV2AccountCatalogue,
  HomeV2AccountCatalogueEntry,
  HomeV2Snapshot,
  IdentityId,
  NetworkId,
  NodeConnectionMode,
  NodeProfileRef,
  NodeSummary,
  DualIdentityLookupResult,
  NetworkAddress,
  WalletRef,
  TabId,
} from '../v2/contracts'
import { createProductState, reduceProductState } from '../v2/product-model'
import { HomeV2Prototype } from '../v2/shell/HomeV2Prototype'
import type { AddressOpenResult } from '../v2/shell/BrowserChrome'
import type { HomeV2NodeClient } from './node-client'
import { resolveDualIdentity } from './identity-resolver'
import {
  parseHomeV2ShellState,
  serializeHomeV2ShellState,
} from './shell-state'
import {
  buildAppResourceLocation,
  parseAppResourceLocation,
} from '../v2/resource-location'

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
    id: brand<AppId>('home-v2:app:help'),
    title: 'Help',
    description: 'Community support, issues, and developer references.',
    category: 'community',
    sourceNetwork: 'qortium',
    resourceIdentity: { service: 'APP', name: 'Help', identifier: 'Help' },
    targetNetworks: ['qortium'],
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

function currentSystemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? ('dark' as const)
    : ('light' as const)
}

function currentSystemLanguage() {
  return resolveHomeV2SystemLanguage(navigator.language)
}

interface AppNavigationState {
  readonly activeIndex: number
  readonly entries: readonly { readonly index: number; readonly url: string }[]
}

const emptyAccountCatalogue: HomeV2AccountCatalogue = Object.freeze({
  accounts: Object.freeze([]),
  activeAccountId: null,
})

function accountIdentity(
  account: HomeV2AccountCatalogueEntry,
  result?: DualIdentityLookupResult,
): HomeV2Snapshot['identity'] {
  const displayLabel =
    result?.networks.qortium.primaryName ??
    result?.networks.qortal.primaryName ??
    account.label
  const presences = Object.fromEntries(
    (['qortal', 'qortium'] as const).map((network) => {
      const resolved = result?.networks[network]
      const primaryName = resolved?.primaryName ?? null
      const initial = (primaryName ?? account.label).slice(0, 1).toUpperCase() || '?'
      return [
        network,
        {
          network,
          state:
            resolved?.state === 'resolved'
              ? ('present' as const)
              : resolved?.state === 'not-found'
                ? ('absent' as const)
                : ('unavailable' as const),
          address: (resolved?.address ?? account.address) as NetworkAddress<typeof network>,
          names: resolved?.names ?? [],
          primaryName,
          avatar: { kind: 'initials' as const, network, value: initial },
          detail: resolved?.detail ?? 'Resolving public names.',
        },
      ]
    }),
  ) as HomeV2Snapshot['identity']['presences']
  return {
    id: brand<IdentityId>(`home-v2:identity:${account.id}`),
    displayLabel,
    selectedWallet: brand<WalletRef>(account.walletId),
    presences,
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
  const [identityInput, setIdentityInput] = useState('')
  const [identityLookup, setIdentityLookup] =
    useState<DualIdentityLookupResult | null>(null)
  const [identityLookupBusy, setIdentityLookupBusy] = useState(false)
  const [identityLookupError, setIdentityLookupError] = useState<string | null>(null)
  const [shellNotice, setShellNotice] = useState<string | null>(null)
  const [appNavigation, setAppNavigation] = useState<
    Readonly<Record<string, AppNavigationState>>
  >({})
  const [nodeClient, setNodeClient] = useState<HomeV2NodeClient | null>(
    () => window.homeV2Nodes ?? null,
  )
  const [accountCatalogue, setAccountCatalogue] =
    useState<HomeV2AccountCatalogue>(emptyAccountCatalogue)
  const [accountCatalogueReady, setAccountCatalogueReady] = useState(false)
  const accountCatalogueRef = useRef<HomeV2AccountCatalogue>(emptyAccountCatalogue)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [restoredAccountId, setRestoredAccountId] = useState<
    string | null | undefined
  >(undefined)
  const [shellStateReady, setShellStateReady] = useState(false)
  const [useCatalogueActiveAccount, setUseCatalogueActiveAccount] = useState(false)
  const [selectedAccountLookup, setSelectedAccountLookup] =
    useState<DualIdentityLookupResult | null>(null)
  const accountSelectionEpoch = useRef(0)
  const permissionState = useMemo(createPermissionState, [])
  const tabSequence = useRef(0)

  useEffect(() => {
    const bridge = window.homeV2Apps
    if (!bridge) return
    return bridge.onNavigationChanged((value) => {
      if (
        !isRecord(value) ||
        typeof value.tabId !== 'string' ||
        typeof value.activeIndex !== 'number' ||
        !Array.isArray(value.entries)
      ) {
        return
      }
      const entries = value.entries
        .filter(
          (entry): entry is { index: number; url: string } =>
            isRecord(entry) &&
            typeof entry.index === 'number' &&
            typeof entry.url === 'string',
        )
        .map((entry) => ({ index: entry.index, url: entry.url }))
      setAppNavigation((current) => ({
        ...current,
        [value.tabId as string]: { activeIndex: value.activeIndex as number, entries },
      }))
    })
  }, [])

  const loadVisibleAvatar = useCallback(
    (network: NetworkId, request: Parameters<HomeV2NodeClient['readAvatar']>[1]) =>
      nodeClient
        ? nodeClient.readAvatar(network, request)
        : Promise.resolve({
            message: 'Avatar loading is unavailable.',
            status: 'unavailable' as const,
          }),
    [nodeClient],
  )

  const selectAccount = useCallback(
    async (
      accountId: string | null,
      catalogue: HomeV2AccountCatalogue = accountCatalogueRef.current,
    ) => {
      const epoch = accountSelectionEpoch.current + 1
      accountSelectionEpoch.current = epoch
      setSelectedAccountId(accountId)
      setSelectedAccountLookup(null)
      if (!accountId) {
        const empty = initialSnapshot()
        setSnapshot((current) => ({
          ...current,
          account: empty.account,
          identity: empty.identity,
        }))
        return
      }
      const account = catalogue.accounts.find((entry) => entry.id === accountId)
      if (!account || !nodeClient) return
      setSnapshot((current) => ({
        ...current,
        account: {
          ...current.account,
          state: account.isUnlocked ? 'unlocked' : 'locked',
          selectedIdentityId: brand<IdentityId>(`home-v2:identity:${account.id}`),
        },
        identity: accountIdentity(account),
      }))
      const result = await resolveDualIdentity(account.address, (network, request) =>
        nodeClient.readIdentity(network, request),
      ).catch(() => undefined)
      if (accountSelectionEpoch.current !== epoch) return
      setSelectedAccountLookup(result ?? null)
      setSnapshot((current) => ({
        ...current,
        identity: accountIdentity(account, result),
      }))
    },
    [nodeClient],
  )

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

  useEffect(() => {
    if (!nodeClient) return
    let cancelled = false
    void nodeClient
      .getShellState()
      .then((rawState) => {
        if (cancelled) return
        const restored = parseHomeV2ShellState(
          rawState,
          currentSystemTheme(),
          currentSystemLanguage(),
        )
        setSnapshot((current) => ({
          ...current,
          appearance: restored.appearance,
        }))
        dispatchProduct({ type: 'restore', state: restored.product })
        setRestoredAccountId(restored.selectedAccountId)
        setUseCatalogueActiveAccount(rawState === null || rawState === undefined)
        setShellStateReady(true)
      })
      .catch(() => {
        if (!cancelled) {
          setRestoredAccountId(null)
          setShellStateReady(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [nodeClient])

  useEffect(() => {
    if (!nodeClient) return
    let cancelled = false
    void nodeClient
      .listAccounts()
      .then((catalogue) => {
        if (cancelled) return
        accountCatalogueRef.current = catalogue
        setAccountCatalogue(catalogue)
        setAccountCatalogueReady(true)
      })
      .catch(() => {
        if (!cancelled) {
          accountCatalogueRef.current = emptyAccountCatalogue
          setAccountCatalogue(emptyAccountCatalogue)
          setAccountCatalogueReady(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [nodeClient, selectAccount])

  useEffect(() => {
    if (!nodeClient || restoredAccountId === undefined) return
    const requestedAccountId = useCatalogueActiveAccount
      ? accountCatalogue.activeAccountId
      : restoredAccountId
    const selected = requestedAccountId
      ? accountCatalogue.accounts.some((account) => account.id === requestedAccountId)
        ? requestedAccountId
        : null
      : null
    void selectAccount(selected, accountCatalogue)
  }, [
    accountCatalogue,
    nodeClient,
    restoredAccountId,
    selectAccount,
    useCatalogueActiveAccount,
  ])

  useEffect(() => {
    if (!nodeClient || !shellStateReady || !accountCatalogueReady) return
    const timeout = window.setTimeout(() => {
      void nodeClient.saveShellState(
        serializeHomeV2ShellState({
          version: 1,
          appearance: snapshot.appearance,
          selectedAccountId,
          product: productState,
        }),
      )
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [
    accountCatalogueReady,
    nodeClient,
    productState,
    selectedAccountId,
    shellStateReady,
    snapshot.appearance,
  ])

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const update = () => {
      setSnapshot((current) =>
        current.appearance.theme === 'system'
          ? {
              ...current,
              appearance: {
                ...current.appearance,
                resolvedTheme: media.matches ? 'dark' : 'light',
              },
            }
          : current,
      )
    }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const updateAppearance = useCallback(
    (patch: Partial<HomeV2Snapshot['appearance']>) =>
      setSnapshot((current) => ({
        ...current,
        appearance: { ...current.appearance, ...patch },
      })),
    [],
  )

  const openApp = useCallback(
    (app: AppDescriptor, requestedLocation?: AppTabContext['resourceLocation']) => {
      setShellNotice(null)
      tabSequence.current += 1
      const tabId = brand<TabId>(
        `home-v2:tab:${Date.now().toString(36)}:${tabSequence.current}`,
      )
      dispatchProduct({
        type: 'open-app',
        app,
        tabId,
        context: {
          appId: app.id,
          identityId: snapshot.identity.id,
          resourceLocation:
            requestedLocation ??
            buildAppResourceLocation(app.sourceNetwork, app.resourceIdentity),
          sourceNetwork: app.sourceNetwork,
          tabId,
          walletRef: snapshot.identity.selectedWallet,
        },
      })
    },
    [snapshot.identity.id, snapshot.identity.selectedWallet],
  )

  const openAddress = useCallback(
    async (address: string): Promise<AddressOpenResult> => {
      try {
        const internal = /^home:\/\/(dashboard|apps|activity|settings)\/?$/i.exec(
          address.trim(),
        )
        if (internal) {
          setShellNotice(null)
          dispatchProduct({
            type: 'navigate',
            destination: internal[1].toLowerCase() as
              | 'activity'
              | 'apps'
              | 'dashboard'
              | 'settings',
          })
          return { status: 'opened' }
        }
        const parsed = parseAppResourceLocation(address)
        let resourceIdentity = parsed.identity
        let resourceLocation = parsed.location
        if (!parsed.identifierWasExplicit) {
          if (!nodeClient) throw new Error('App discovery is not available yet.')
          const candidates = await nodeClient.listAppResources(
            parsed.sourceNetwork,
            parsed.identity.name,
          )
          if (candidates.length === 0) {
            throw new Error(
              `No APP resource named ${parsed.identity.name} was found on ${parsed.sourceNetwork === 'qortal' ? 'Qortal' : 'Qortium'}.`,
            )
          }
          const resolvedLocations = candidates.map((candidate) => ({
            address: `${buildAppResourceLocation(parsed.sourceNetwork, {
              service: 'APP',
              name: candidate.name,
              identifier: candidate.identifier,
            })}${parsed.routePath}${parsed.search}${parsed.hash}` as AppTabContext['resourceLocation'],
            candidate,
          }))
          if (resolvedLocations.length > 1) {
            return {
              message: `More than one APP resource is published under ${parsed.identity.name}. Choose an identifier.`,
              options: resolvedLocations.map(({ address: optionAddress, candidate }) => ({
                address: optionAddress,
                label: candidate.identifier ?? 'Default resource',
              })),
              status: 'choose',
            }
          }
          const resolved = resolvedLocations[0]
          resourceIdentity = {
            service: 'APP',
            name: resolved.candidate.name,
            identifier: resolved.candidate.identifier,
          }
          resourceLocation = resolved.address
        }
        const app: AppDescriptor = {
          id: brand<AppId>(
            `home-v2:app:${parsed.sourceNetwork}:${resourceIdentity.name}:${resourceIdentity.identifier ?? 'default'}`,
          ),
          title: resourceIdentity.name,
          description: `QDN app from ${parsed.sourceNetwork === 'qortal' ? 'Qortal' : 'Qortium'}.`,
          category: 'utility',
          sourceNetwork: parsed.sourceNetwork,
          resourceIdentity,
          targetNetworks: [parsed.sourceNetwork],
          placement: 'recommended',
        }
        openApp(app, resourceLocation)
        return { status: 'opened' }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid app address.'
        setShellNotice(message)
        return { message, status: 'error' }
      }
    },
    [nodeClient, openApp],
  )

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
    setIdentityLookup(null)
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
    setIdentityLookup(null)
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

  const runIdentityLookup = async () => {
    if (!nodeClient) return
    setIdentityLookupBusy(true)
    setIdentityLookupError(null)
    try {
      setIdentityLookup(
        await resolveDualIdentity(identityInput, (network, request) =>
          nodeClient.readIdentity(network, request),
        ),
      )
    } catch (error) {
      setIdentityLookup(null)
      setIdentityLookupError(
        error instanceof Error ? error.message : 'Account lookup failed.',
      )
    } finally {
      setIdentityLookupBusy(false)
    }
  }

  const customNodeDialog = customNetwork ? (
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
  ) : null

  const activeNavigation = productState.activeTabId
    ? appNavigation[productState.activeTabId]
    : undefined
  const activeNavigationPosition = activeNavigation
    ? activeNavigation.entries.findIndex(
        (entry) => entry.index === activeNavigation.activeIndex,
      )
    : -1
  const navigateActiveApp = (offset: -1 | 1) => {
    if (!productState.activeTabId || !activeNavigation) return
    const target = activeNavigation.entries[activeNavigationPosition + offset]
    if (target) {
      void window.homeV2Apps?.navigate({
        index: target.index,
        tabId: productState.activeTabId,
      })
    }
  }

  return (
    <HomeV2Prototype
      snapshot={snapshot}
      productState={productState}
      permissionState={permissionState}
      layout={window.homeV2Nodes ? 'desktop' : 'phone'}
      surfaceNotice={
        busyNetwork
          ? `Updating ${busyNetwork === 'qortal' ? 'Qortal' : 'Qortium'}…`
          : shellNotice ?? 'Live nodes, accounts, and read-only QDN apps'
      }
      overlay={customNodeDialog}
      identityLookup={identityLookup}
      identityLookupBusy={identityLookupBusy}
      identityLookupError={identityLookupError}
      identityLookupInput={identityInput}
      loadVisibleAvatar={loadVisibleAvatar}
      accountCatalogue={accountCatalogue}
      selectedAccountId={selectedAccountId}
      selectedAccountLookup={selectedAccountLookup}
      nodeClient={nodeClient}
      onActivateTab={(tabId) =>
        dispatchProduct({ type: 'activate-tab', tabId })
      }
      onCloseTab={(tabId) => {
        void window.homeV2Apps?.destroy({ tabId })
        dispatchProduct({ type: 'close-tab', tabId })
      }}
      onNavigate={(destination) =>
        dispatchProduct({ type: 'navigate', destination })
      }
      onRefreshNode={() => void refresh()}
      onSetNodeMode={(network, mode) => void setNodeMode(network, mode)}
      onConfigureCustomNode={openCustomNode}
      onIdentityLookupInput={(value) => {
        setIdentityInput(value)
        setIdentityLookupError(null)
      }}
      onIdentityLookupSubmit={() => void runIdentityLookup()}
      onSelectAccount={(accountId) => {
        setUseCatalogueActiveAccount(false)
        setRestoredAccountId(accountId)
        void selectAccount(accountId)
      }}
      onOpenApp={openApp}
      onOpenAddress={openAddress}
      canGoBack={activeNavigationPosition > 0}
      canGoForward={
        !!activeNavigation &&
        activeNavigationPosition >= 0 &&
        activeNavigationPosition < activeNavigation.entries.length - 1
      }
      onGoBack={() => navigateActiveApp(-1)}
      onGoForward={() => navigateActiveApp(1)}
      onReload={() => {
        if (productState.activeTabId) {
          void window.homeV2Apps?.reload({ tabId: productState.activeTabId })
        } else {
          void refresh()
        }
      }}
      onSetTheme={(theme: HomeV2ThemePreference) =>
        updateAppearance({
          theme,
          resolvedTheme: theme === 'system' ? currentSystemTheme() : theme,
        })
      }
      onSetAccent={(accent: HomeV2Accent) => updateAppearance({ accent })}
      onSetTextSize={(textSize: HomeV2TextSize) =>
        updateAppearance({ textSize })
      }
      onSetAppZoom={(appZoom: number) =>
        updateAppearance({ appZoom: clampHomeV2AppZoom(appZoom) })
      }
      onSetLanguage={(language: HomeV2Language) =>
        updateAppearance({
          language,
          resolvedLanguage:
            language === 'system' ? currentSystemLanguage() : language,
        })
      }
    />
  )
}
