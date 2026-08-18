import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import {
  clampHomeV2AppZoom,
  defaultHomeV2Appearance,
  resolveHomeV2SystemLanguage,
  type HomeV2Accent,
  type HomeV2Language,
  type HomeV2TextSize,
  type HomeV2ThemePreference,
} from '../v2/appearance'
import {
  createPermissionPrompt,
  createPermissionState,
  invalidatePermissionState,
  queuePermissionPrompt,
  resolvePermissionPrompt,
  type PermissionDecision,
  type PermissionRequestId,
} from '../v2/bridge-permissions'
import type {
  AppDescriptor,
  AppId,
  AppTabContext,
  HomeV2AccountCatalogue,
  HomeV2AccountCatalogueEntry,
  HomeV2Snapshot,
  HomeV2VaultState,
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
import type { HomeV2AccountManageAction } from '../v2/shell/HomeV2Prototype'
import {
  AccountDialog,
  type AccountDialogMode,
  type AccountDialogSubmission,
} from '../v2/shell/AccountDialog'
import type { AddressOpenResult } from '../v2/shell/BrowserChrome'
import type {
  AppTabNavigationController,
  AppTabNavigationSnapshot,
} from '../v2/shell/AppTabStage'
import type {
  HomeV2AppBridgeProtocol,
  HomeV2AppRequestContext,
  HomeV2NodeClient,
} from './node-client'
import type { HomeV2VaultClient } from './vault-client'
import {
  assertHomeV2OpenPublicGroup,
  isHomeV2PublicChatAction,
  normalizeHomeV2PublicChatReferenceTarget,
  normalizeHomeV2PublicChatRequest,
  type HomeV2PublicChatAction,
} from '../../electron/home-v2-chat-actions'
import {
  assertHomeV2DirectReferenceTarget,
  isHomeV2DirectChatReadAction,
  isHomeV2DirectChatWriteAction,
  normalizeHomeV2DirectChatReadRequest,
  normalizeHomeV2DirectChatWriteRequest,
} from '../../electron/home-v2-direct-chat-contract'
import {
  isHomeV2PrivateGroupChatReadAction,
  isHomeV2PrivateGroupChatWriteAction,
  normalizeHomeV2PrivateGroupChatReadRequest,
  normalizeHomeV2PrivateGroupChatWriteRequest,
  normalizeHomeV2QpgcGroupState,
} from '../../electron/home-v2-private-group-chat-contract'
import {
  isHomeV2GroupMembershipAction,
  normalizeHomeV2GroupMembershipRequest,
  normalizeHomeV2GroupMembershipTarget,
  type HomeV2GroupMembershipAction,
} from '../../electron/home-v2-group-actions'
import {
  assertHomeV2GroupAdminAuthority,
  hasHomeV2GroupJoinRequest,
  homeV2GroupAdminOperationLabel,
  isHomeV2GroupAdminAction,
  normalizeHomeV2GroupAdminAddresses,
  normalizeHomeV2GroupAdminRequest,
  normalizeHomeV2GroupAdminTarget,
} from '../../electron/home-v2-group-admin-actions'
import { createHomeV2SendRateLimiter } from '../../electron/home-v2-send-rate-limiter'
import { resolveDualIdentity } from './identity-resolver'
import {
  parseHomeV2ShellState,
  serializeHomeV2ShellState,
} from './shell-state'
import {
  buildAppResourceLocation,
  parseAppResourceLocation,
} from '../v2/resource-location'
import { resolveLaunchIdentifier } from '../v2/shell/render-path-identity'
import { base58Decode, base58Encode } from '../../electron/base58'

function brand<Type extends string>(value: string): Type {
  return value as Type
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function publicChatOperationLabel(action: HomeV2PublicChatAction) {
  if (action === 'SEND_CHAT_EDIT') return 'Edit message'
  if (action === 'SEND_CHAT_DELETE') return 'Delete message'
  if (action === 'SEND_CHAT_REACTION') return 'React to message'
  return 'Send message'
}

function groupMembershipOperationLabel(action: HomeV2GroupMembershipAction) {
  return action === 'JOIN_GROUP' ? 'Join group' : 'Leave group'
}

function isHomeV2GroupWriteAction(action: string) {
  return isHomeV2GroupMembershipAction(action) || isHomeV2GroupAdminAction(action)
}

function nullableString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function nullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// Android permission-prompt machinery (FIX #3, security review): desktop's
// main process already auto-denies a pending account/chat-send permission
// request after 60s (electron/home-v2-app-bridge.ts requireAccountReadPermission).
// Android's inline prompts (requestApp below) previously had no timeout at
// all, so a prompt the user never answered — or a tab that closed while one
// was pending — left the awaiting promise (and the Chat app's SEND_CHAT_MESSAGE
// call) hanging indefinitely. These mirror the desktop timeout and add a
// small queue cap so a misbehaving/malicious app cannot pile up unbounded
// pending prompts.
const ANDROID_PERMISSION_PROMPT_TIMEOUT_MS = 60_000
const MAX_PENDING_ANDROID_PERMISSION_PROMPTS_PER_APP = 3
const MAX_PENDING_ANDROID_PERMISSION_PROMPTS_GLOBAL = 20

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

const emptyAccountCatalogue: HomeV2AccountCatalogue = Object.freeze({
  accounts: Object.freeze([]),
  activeAccountId: null,
})

const emptyVaultState: HomeV2VaultState = Object.freeze({
  accounts: Object.freeze([]),
  readiness: 'ready',
  recoveryMessage: null,
  secureStorageAvailable: false,
  selectedAccountId: null,
  selectedAddressId: null,
  version: 2,
})

function vaultCatalogue(vault: HomeV2VaultState): HomeV2AccountCatalogue {
  return {
    activeAccountId: vault.selectedAddressId,
    accounts: vault.accounts.flatMap((account) =>
      account.addresses.map((address) => ({
        address: address.address,
        addressIndex: address.index,
        id: address.id,
        isUnlocked: account.isUnlocked,
        label: address.index === 0 ? account.label : `${account.label} · ${address.index}`,
        supportsDerivedAddresses: account.supportsDerivedAddresses,
        walletId: account.id,
      })),
    ),
  }
}

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
  // Live mirror of productState so long-running async work (e.g. the chat-send
  // context recheck that spans a tens-of-seconds memory-pow) sees the CURRENT
  // tab set, not the snapshot captured when the request started. Without this
  // a tab closed mid-PoW stays invisible to the recheck (FIX #2, review 2).
  const productStateRef = useRef(productState)
  productStateRef.current = productState
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
  const [accountDialog, setAccountDialog] = useState<{
    mode: AccountDialogMode
    accountId?: string
    pendingToken?: string
    permissionRequestId?: string
    requestTabId?: string
    suggestedLabel?: string
  } | null>(null)
  const [accountDialogBusy, setAccountDialogBusy] = useState(false)
  const [accountDialogError, setAccountDialogError] = useState<string | null>(null)
  const [appNavigation, setAppNavigation] = useState<
    Readonly<Record<string, AppTabNavigationSnapshot>>
  >({})
  const [appReloadVersion, setAppReloadVersion] = useState(0)
  const [nodeClient, setNodeClient] = useState<HomeV2NodeClient | null>(
    () => window.homeV2Nodes ?? null,
  )
  const [vaultClient, setVaultClient] = useState<HomeV2VaultClient | null>(
    () => window.homeV2Vault ?? null,
  )
  const [vaultState, setVaultState] = useState<HomeV2VaultState>(emptyVaultState)
  const [accountCatalogue, setAccountCatalogue] =
    useState<HomeV2AccountCatalogue>(emptyAccountCatalogue)
  const [accountCatalogueReady, setAccountCatalogueReady] = useState(false)
  const accountCatalogueRef = useRef<HomeV2AccountCatalogue>(emptyAccountCatalogue)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [restoredAccountId, setRestoredAccountId] = useState<
    string | null | undefined
  >(undefined)
  const [restoredAddressId, setRestoredAddressId] = useState<
    string | null | undefined
  >(undefined)
  const [shellStateReady, setShellStateReady] = useState(false)
  const [useCatalogueActiveAccount, setUseCatalogueActiveAccount] = useState(false)
  const [selectedAccountLookup, setSelectedAccountLookup] =
    useState<DualIdentityLookupResult | null>(null)
  const accountSelectionEpoch = useRef(0)
  const [permissionState, setPermissionState] = useState(createPermissionState)
  const androidPermissionResolvers = useRef(new Map<
    PermissionRequestId,
    { resolve: (decision: PermissionDecision) => void; timeout: number }
  >())
  // Tracks which tab/app each pending Android permission prompt belongs to,
  // for the per-app/global queue cap and for resolving (denying) all of a
  // tab's pending prompts when that tab closes (FIX #3, security review).
  const androidPendingPermissionMeta = useRef(new Map<
    PermissionRequestId,
    { appIdentityKey: string; tabId: string }
  >())
  const androidUnlockResolvers = useRef(new Map<
    string,
    {
      complete: (state: HomeV2VaultState) => Promise<void>
      reject: (error: Error) => void
    }
  >())
  const androidSessionAccountGrants = useRef(new Set<string>())
  // Fix B (security review finding 8): bounds how often an already-granted
  // tab can broadcast chat sends. Shares its constants/algorithm with
  // desktop's electron/home-v2-app-bridge.ts via home-v2-send-rate-limiter.ts.
  const androidChatSendRateLimiter = useRef(createHomeV2SendRateLimiter())
  const androidNavigationControllers = useRef(
    new Map<string, AppTabNavigationController>(),
  )
  const tabSequence = useRef(0)

  const applyVaultState = useCallback((state: HomeV2VaultState) => {
    const catalogue = vaultCatalogue(state)
    setVaultState(state)
    accountCatalogueRef.current = catalogue
    setAccountCatalogue(catalogue)
    setAccountCatalogueReady(true)
    return catalogue
  }, [])

  const handleAppNavigationChanged = useCallback(
    (tabId: TabId, navigation: AppTabNavigationSnapshot) => {
      setAppNavigation((current) => ({
        ...current,
        [tabId]: navigation,
      }))
    },
    [],
  )

  const handleAppNavigationControllerChange = useCallback(
    (tabId: TabId, controller: AppTabNavigationController | null) => {
      if (controller) androidNavigationControllers.current.set(tabId, controller)
      else androidNavigationControllers.current.delete(tabId)
    },
    [],
  )

  const handleAppTitleChanged = useCallback((tabId: TabId, title: string | null) => {
    dispatchProduct({ type: 'set-tab-title', tabId, title })
  }, [])

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
      handleAppNavigationChanged(value.tabId as TabId, {
        activeIndex: value.activeIndex as number,
        entries,
      })
    })
  }, [handleAppNavigationChanged])

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
      currentVault: HomeV2VaultState = vaultState,
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
      const vaultAccount = currentVault.accounts.find((entry) => entry.id === account.walletId)
      setSnapshot((current) => ({
        ...current,
        account: {
          ...current.account,
          state: account.isUnlocked ? 'unlocked' : 'locked',
          selectedIdentityId: brand<IdentityId>(`home-v2:identity:${account.id}`),
          rememberUnlock: vaultAccount?.security.rememberUnlock ?? false,
          lockOnExit: vaultAccount?.security.lockOnExit ?? true,
          manuallyLocked: vaultAccount?.security.manuallyLocked ?? false,
          secureStorageAvailable: currentVault.secureStorageAvailable,
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
    [nodeClient, vaultState],
  )

  useEffect(() => {
    if (nodeClient) return
    let cancelled = false
    void Promise.all([import('./android-node-client'), import('./android-vault-client')])
      .then(([{ createAndroidHomeV2NodeClient }, { createAndroidHomeV2VaultClient }]) => {
        if (!cancelled) {
          setNodeClient(createAndroidHomeV2NodeClient())
          setVaultClient(createAndroidHomeV2VaultClient())
        }
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
        setRestoredAddressId(restored.selectedAddressId)
        setUseCatalogueActiveAccount(rawState === null || rawState === undefined)
        setShellStateReady(true)
      })
      .catch(() => {
        if (!cancelled) {
          setRestoredAccountId(null)
          setRestoredAddressId(null)
          setShellStateReady(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [nodeClient])

  useEffect(() => {
    if (!nodeClient || !vaultClient) return
    let cancelled = false
    void vaultClient
      .getState()
      .then((state) => {
        if (cancelled) return
        applyVaultState(state)
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
  }, [applyVaultState, nodeClient, vaultClient])

  useEffect(() => {
    if (!nodeClient || restoredAccountId === undefined || restoredAddressId === undefined) return
    const requestedAddressId = useCatalogueActiveAccount
      ? vaultState.selectedAddressId
      : restoredAddressId
    const selected = requestedAddressId
      ? accountCatalogue.accounts.some((account) => account.id === requestedAddressId)
        ? requestedAddressId
        : null
      : null
    void selectAccount(selected, accountCatalogue)
  }, [
    accountCatalogue,
    nodeClient,
    restoredAccountId,
    restoredAddressId,
    selectAccount,
    useCatalogueActiveAccount,
    vaultState.selectedAddressId,
  ])

  useEffect(() => {
    if (!nodeClient || !shellStateReady || !accountCatalogueReady) return
    const timeout = window.setTimeout(() => {
      void nodeClient.saveShellState(
        serializeHomeV2ShellState({
          version: 2,
          appearance: snapshot.appearance,
          selectedAccountId:
            accountCatalogue.accounts.find((account) => account.id === selectedAccountId)?.walletId ?? null,
          selectedAddressId: selectedAccountId,
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

  useEffect(() => {
    const bridge = window.homeV2Apps
    if (!bridge) return
    return bridge.onOpenAddress((value) => {
      if (!isRecord(value) || typeof value.address !== 'string') return
      void openAddress(value.address)
    })
  }, [openAddress])

  useEffect(() => {
    const bridge = window.homeV2Apps
    if (!bridge) return
    return bridge.onPermissionRequest((value) => {
      if (
        !isRecord(value) ||
        typeof value.requestId !== 'string' ||
        (value.protocol !== 'qdnRequest' && value.protocol !== 'qortalRequest') ||
        (typeof value.action !== 'string' ||
          (value.action !== 'GET_SELECTED_ACCOUNT' &&
            value.action !== 'GET_USER_ACCOUNT' &&
            value.action !== 'UNLOCK_SELECTED_ACCOUNT' &&
            !isHomeV2PublicChatAction(value.action) &&
            !isHomeV2DirectChatReadAction(value.action) &&
            !isHomeV2DirectChatWriteAction(value.action) &&
            !isHomeV2PrivateGroupChatReadAction(value.action) &&
            !isHomeV2PrivateGroupChatWriteAction(value.action) &&
            !isHomeV2GroupMembershipAction(value.action) &&
            !isHomeV2GroupAdminAction(value.action))) ||
        typeof value.accountId !== 'string' ||
        typeof value.tabId !== 'string' ||
        (value.targetNetwork !== 'qortal' && value.targetNetwork !== 'qortium') ||
        ((isHomeV2PublicChatAction(value.action) || isHomeV2GroupWriteAction(value.action)) &&
          (typeof value.writeOperationLabel !== 'string' ||
            typeof value.writeTargetChainLabel !== 'string')) ||
        ((isHomeV2PrivateGroupChatReadAction(value.action) || isHomeV2PrivateGroupChatWriteAction(value.action)) &&
          (value.writeKind !== 'private-group' ||
            typeof value.chatGroupId !== 'number' ||
            typeof value.writeOperationLabel !== 'string' ||
            typeof value.writeRouteLabel !== 'string' ||
            typeof value.writeTargetChainLabel !== 'string')) ||
        (isHomeV2PublicChatAction(value.action) &&
          (value.writeKind !== 'chat' ||
            typeof value.chatGroupId !== 'number' ||
            typeof value.chatMessagePreview !== 'string')) ||
        ((isHomeV2DirectChatReadAction(value.action) || isHomeV2DirectChatWriteAction(value.action)) &&
          (value.writeKind !== 'direct' ||
            typeof value.writeOperationLabel !== 'string' ||
            typeof value.writeOtherAddress !== 'string' ||
            typeof value.writeRouteLabel !== 'string' ||
            typeof value.writeTargetChainLabel !== 'string')) ||
        (isHomeV2GroupWriteAction(value.action) &&
          (value.writeKind !== 'group' ||
            typeof value.groupId !== 'number' ||
            typeof value.groupName !== 'string' ||
            typeof value.writeRouteLabel !== 'string'))
      ) {
        return
      }
      const account = accountCatalogueRef.current.accounts.find(
        (candidate) => candidate.id === value.accountId,
      )
      if (value.action === 'UNLOCK_SELECTED_ACCOUNT') {
        if (!account || value.protocol !== 'qdnRequest') {
          window.homeV2Apps?.resolvePermission({
            approved: false,
            requestId: value.requestId,
            scope: null,
          })
          return
        }
        setAccountDialogError(null)
        setAccountDialog({
          accountId: account.walletId,
          mode: 'unlock',
          permissionRequestId: value.requestId,
          requestTabId: value.tabId,
        })
        return
      }
      const appIdentityKey =
        typeof value.appIdentityKey === 'string' && value.appIdentityKey
          ? value.appIdentityKey
          : `home-v2-tab:${value.tabId}`
      const appTitle = (() => {
        if (typeof value.resourceUrl !== 'string') return 'QDN app'
        try {
          return parseAppResourceLocation(value.resourceUrl).identity.name
        } catch {
          return 'QDN app'
        }
      })()
      const isChatWrite = isHomeV2PublicChatAction(value.action)
      const isDirectRead = isHomeV2DirectChatReadAction(value.action)
      const isDirectWrite = isHomeV2DirectChatWriteAction(value.action)
      const isPrivateGroupRead = isHomeV2PrivateGroupChatReadAction(value.action)
      const isPrivateGroupWrite = isHomeV2PrivateGroupChatWriteAction(value.action)
      const isGroupWrite = isHomeV2GroupWriteAction(value.action)
      const isGroupAdminWrite = isHomeV2GroupAdminAction(value.action)
      const operationLabel = isChatWrite || isDirectRead || isDirectWrite || isPrivateGroupRead || isPrivateGroupWrite || isGroupWrite
        ? String(value.writeOperationLabel)
        : ''
      const prompt = createPermissionPrompt({
        id: brand<PermissionRequestId>(value.requestId),
        protocol: value.protocol,
        action: value.action,
        capability: isChatWrite
          ? 'chat.send'
          : isDirectWrite
            ? 'chat.direct.send'
          : isDirectRead
              ? 'chat.direct.read'
          : isPrivateGroupWrite
            ? value.action === 'ROTATE_PRIVATE_GROUP_CHAT_KEY'
              ? 'chat.private-group.rotate'
              : value.action === 'REQUEST_PRIVATE_GROUP_CHAT_KEY' || value.action === 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS'
                ? 'chat.private-group.recover'
                : 'chat.private-group.send'
          : isPrivateGroupRead
            ? 'chat.private-group.read'
          : isGroupAdminWrite
            ? 'group.administration'
            : isGroupWrite
              ? 'group.membership'
              : 'account.public.read',
        appId: brand<AppId>(`home-v2:permission-app:${appIdentityKey}`),
        appIdentityKey,
        appTitle,
        context: {
          appId: brand<AppId>(`home-v2:permission-app:${appIdentityKey}`),
          identityId: brand<IdentityId>(`home-v2:identity:${value.accountId}`),
          nodeProfileRef: snapshot.nodes[value.targetNetwork].ref,
          tabId: brand<TabId>(value.tabId),
          targetNetwork: value.targetNetwork,
          walletRef: account
            ? brand<WalletRef>(`home-v2:wallet:${account.walletId}`)
            : null,
        },
        title: isChatWrite || isDirectRead || isDirectWrite || isPrivateGroupRead || isPrivateGroupWrite || isGroupWrite
          ? `Allow ${operationLabel.toLowerCase()}?`
          : 'Allow account access?',
        summary: isChatWrite || isDirectRead || isDirectWrite || isPrivateGroupRead || isPrivateGroupWrite || isGroupWrite
          ? `${appTitle} wants to ${operationLabel.toLowerCase()} as the selected account.`
          : `${appTitle} wants to read the selected account address and public identity data.`,
        details: isChatWrite
          ? [
              { label: 'Account', value: account?.label ?? value.accountId },
              { label: 'Operation', value: operationLabel },
              { label: 'Chain', value: String(value.writeTargetChainLabel) },
              { label: 'Message', value: String(value.chatMessagePreview) },
              ...(typeof value.chatReference === 'string'
                ? [{ label: 'Reference', value: value.chatReference }]
                : []),
            ]
          : isDirectRead || isDirectWrite
            ? [
                { label: 'Account', value: account?.label ?? value.accountId },
                { label: 'Operation', value: operationLabel },
                { label: 'Chain', value: String(value.writeTargetChainLabel) },
                { label: 'Route', value: String(value.writeRouteLabel) },
                { label: 'Conversation', value: String(value.writeOtherAddress) },
                ...(isDirectWrite && typeof value.chatMessagePreview === 'string'
                  ? [{ label: 'Message', value: value.chatMessagePreview }]
                  : []),
                ...(isDirectWrite && typeof value.chatReference === 'string'
                  ? [{ label: 'Reference', value: value.chatReference }]
                  : []),
              ]
          : isPrivateGroupRead || isPrivateGroupWrite
            ? [
                { label: 'Account', value: account?.label ?? value.accountId },
                { label: 'Operation', value: operationLabel },
                { label: 'Chain', value: String(value.writeTargetChainLabel) },
                { label: 'Route', value: String(value.writeRouteLabel) },
                ...(typeof value.chatGroupId === 'number' && value.chatGroupId > 0
                  ? [{ label: 'Group', value: String(value.chatGroupId) }]
                  : []),
                ...(isPrivateGroupWrite && typeof value.chatMessagePreview === 'string'
                  ? [{ label: 'Message', value: value.chatMessagePreview }]
                  : []),
                ...(isPrivateGroupWrite && typeof value.chatReference === 'string'
                  ? [{ label: 'Reference', value: value.chatReference }]
                  : []),
              ]
          : isGroupWrite
            ? [
                { label: 'Account', value: account?.label ?? value.accountId },
                { label: 'Operation', value: operationLabel },
                { label: 'Chain', value: String(value.writeTargetChainLabel) },
                { label: 'Route', value: String(value.writeRouteLabel) },
                { label: 'Group', value: String(value.groupName) },
                ...(typeof value.writeMemberAddress === 'string'
                  ? [{ label: 'Member', value: value.writeMemberAddress }]
                  : []),
                ...(typeof value.writeReason === 'string' && value.writeReason
                  ? [{ label: 'Reason', value: value.writeReason }]
                  : []),
                ...(typeof value.writeTimeToLive === 'number'
                  ? [{ label: 'Lifetime', value: value.writeTimeToLive === 0 ? 'No expiry' : `${value.writeTimeToLive} seconds` }]
                  : []),
              ]
            : [
              { label: 'Account', value: account?.label ?? value.accountId },
              { label: 'Data', value: 'Address, public key when available, lock state, and public name' },
            ],
        allowedScopes: value.writeSingleRequestOnly === true
          ? ['single-request']
          : ['single-request', 'session'],
      })
      setPermissionState((current) => {
        try {
          return queuePermissionPrompt(current, prompt)
        } catch {
          return current
        }
      })
    })
  }, [snapshot.nodes])

  const resolveAccountPermission = useCallback(
    (requestId: PermissionRequestId, decision: PermissionDecision) => {
      setPermissionState((current) => {
        try {
          return resolvePermissionPrompt(current, requestId, decision).state
        } catch {
          return current
        }
      })
      androidPendingPermissionMeta.current.delete(requestId)
      const androidResolver = androidPermissionResolvers.current.get(requestId)
      if (androidResolver) {
        androidPermissionResolvers.current.delete(requestId)
        window.clearTimeout(androidResolver.timeout)
        androidResolver.resolve(decision)
      } else {
        window.homeV2Apps?.resolvePermission({
          approved: decision.approved,
          requestId,
          scope: decision.approved ? decision.scope : null,
        })
      }
    },
    [],
  )

  useEffect(() => {
    const bridge = window.homeV2Apps
    if (!bridge) return
    return bridge.onPermissionTimeout((value) => {
      if (!isRecord(value) || typeof value.requestId !== 'string') return
      // The main process (electron/home-v2-app-bridge.ts requireAccountReadPermission)
      // already auto-denied this request after its own 60s timeout; this
      // only clears the now-stale React prompt so it does not sit on screen
      // after the request has already been denied (FIX #3, security review).
      // resolveAccountPermission's IPC round-trip back to main is a harmless
      // no-op here since main already removed its own pending entry.
      resolveAccountPermission(brand<PermissionRequestId>(value.requestId), { approved: false })
    })
  }, [resolveAccountPermission])

  // Queues an Android-originated permission prompt (SEND_CHAT_MESSAGE and
  // GET_SELECTED_ACCOUNT/GET_USER_ACCOUNT below) with a per-app and global
  // pending cap and a 60s auto-deny, matching desktop's main-process timeout
  // (FIX #3, security review). Auto-deny and manual resolution both flow
  // through resolveAccountPermission above, so the permission-state entry is
  // always cleared the same way the prompt was queued.
  const queueAndroidPermissionPrompt = useCallback(
    (prompt: Parameters<typeof queuePermissionPrompt>[1], tabId: string) => {
      const pendingMeta = androidPendingPermissionMeta.current
      const pendingForApp = Array.from(pendingMeta.values()).filter(
        (meta) => meta.appIdentityKey === prompt.appIdentityKey,
      ).length
      if (pendingForApp >= MAX_PENDING_ANDROID_PERMISSION_PROMPTS_PER_APP) {
        throw new Error('Too many pending permission requests for this app. Wait for the existing prompt to resolve.')
      }
      if (pendingMeta.size >= MAX_PENDING_ANDROID_PERMISSION_PROMPTS_GLOBAL) {
        throw new Error('Too many pending permission requests. Wait for the existing prompts to resolve.')
      }
      pendingMeta.set(prompt.id, { appIdentityKey: prompt.appIdentityKey, tabId })
      setPermissionState((current) => queuePermissionPrompt(current, prompt))
      return new Promise<PermissionDecision>((resolve) => {
        const timeout = window.setTimeout(() => {
          resolveAccountPermission(prompt.id, { approved: false })
        }, ANDROID_PERMISSION_PROMPT_TIMEOUT_MS)
        androidPermissionResolvers.current.set(prompt.id, { resolve, timeout })
      })
    },
    [resolveAccountPermission],
  )

  const requestApp = useCallback(
    async (
      protocol: HomeV2AppBridgeProtocol,
      requestValue: unknown,
      context: HomeV2AppRequestContext,
    ) => {
      if (!nodeClient) throw new Error('The app bridge is unavailable.')
      const action = isRecord(requestValue) && typeof requestValue.action === 'string'
        ? requestValue.action.trim().toUpperCase()
        : ''
      if (
        action === 'UNLOCK_SELECTED_ACCOUNT' ||
        isHomeV2PublicChatAction(action) ||
        isHomeV2DirectChatReadAction(action) ||
        isHomeV2DirectChatWriteAction(action) ||
        isHomeV2PrivateGroupChatReadAction(action) ||
        isHomeV2PrivateGroupChatWriteAction(action) ||
        isHomeV2GroupWriteAction(action)
      ) {
        const actions = await nodeClient.requestApp(
          protocol,
          { action: 'SHOW_ACTIONS' },
          context,
        )
        if (!Array.isArray(actions) || !actions.includes(action)) {
          throw new Error(`${action} is unavailable on the configured route.`)
        }
      }
      if (action === 'UNLOCK_SELECTED_ACCOUNT') {
        if (protocol !== 'qdnRequest') throw new Error('UNLOCK_SELECTED_ACCOUNT is only available to Qortium apps.')
        if (!vaultClient || !context.selectedAccountId) throw new Error('No account is selected for this tab.')
        const account = accountCatalogueRef.current.accounts.find(
          (candidate) => candidate.id === context.selectedAccountId,
        )
        if (!account) throw new Error('The selected account is no longer available.')
        const nodeBefore = parseNodesSnapshot(await nodeClient.getSnapshot()).qortium
        const nodeRoute = `${nodeBefore.mode}|${nodeBefore.nodeApiUrl ?? ''}`
        const requestId = `android-unlock:${globalThis.crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`
        setAccountDialogError(null)
        setAccountDialog({
          accountId: account.walletId,
          mode: 'unlock',
          permissionRequestId: requestId,
        })
        return new Promise<unknown>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            androidUnlockResolvers.current.delete(requestId)
            setAccountDialog((current) =>
              current?.permissionRequestId === requestId ? null : current,
            )
            reject(new Error('Account unlock request timed out.'))
          }, 60_000)
          androidUnlockResolvers.current.set(requestId, {
            reject: (error) => {
              window.clearTimeout(timeout)
              reject(error)
            },
            complete: async (state) => {
              window.clearTimeout(timeout)
              const freshTab = productState.tabs.find((tab) => tab.id === context.tabId)
              const freshAccount = vaultCatalogue(state).accounts.find(
                (candidate) => candidate.id === context.selectedAccountId,
              )
              const nodeAfter = parseNodesSnapshot(await nodeClient.getSnapshot()).qortium
              if (
                !freshTab ||
                freshTab.context.resourceLocation !== context.resourceLocation ||
                !freshAccount?.isUnlocked ||
                `${nodeAfter.mode}|${nodeAfter.nodeApiUrl ?? ''}` !== nodeRoute
              ) {
                reject(new Error('Account unlock context changed before approval completed.'))
                return
              }
              const identity = await resolveDualIdentity(freshAccount.address, (network, request) =>
                nodeClient.readIdentity(network, request),
              ).catch(() => null)
              resolve({
                address: freshAccount.address,
                avatarContract: 'pointer-aware-account-avatar-v1',
                avatarUrl: null,
                isUnlocked: true,
                name:
                  identity?.networks.qortium.primaryName ??
                  identity?.networks.qortal.primaryName ??
                  null,
              })
            },
          })
        })
      }
      if (isHomeV2GroupMembershipAction(action)) {
        if (!vaultClient?.sendGroupMembership) {
          throw new Error('Group membership changes are unavailable on this platform.')
        }
        if (!context.selectedAccountId) throw new Error('No account is selected for this tab.')
        const accountId = context.selectedAccountId
        const membershipRequest = normalizeHomeV2GroupMembershipRequest(
          action,
          isRecord(requestValue) ? requestValue : {},
        )
        const account = accountCatalogueRef.current.accounts.find(
          (candidate) => candidate.id === accountId,
        )
        if (!account) throw new Error('The selected account is no longer available.')
        if (!account.isUnlocked) throw new Error('The selected account is locked.')
        const targetNetwork: NetworkId = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
        const nodeBefore = parseNodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
        if (!nodeBefore.nodeApiUrl || !nodeBefore.capabilities.read) {
          throw new Error(nodeBefore.error ?? `${targetNetwork} is unavailable.`)
        }
        const nodeRoute = `${nodeBefore.mode}|${nodeBefore.nodeApiUrl}`
        const readTarget = async () => normalizeHomeV2GroupMembershipTarget(
          await nodeClient.requestApp(
            protocol,
            { action: 'GET_GROUP', groupId: membershipRequest.groupId },
            context,
          ),
          membershipRequest.groupId,
          targetNetwork,
        )
        const target = await readTarget()
        const validateTarget = async () => {
          const currentTarget = await readTarget()
          if (
            currentTarget.groupName !== target.groupName ||
            currentTarget.isOpen !== target.isOpen
          ) {
            throw new Error('The selected group changed before the group action could be signed.')
          }
        }
        const operationLabel = groupMembershipOperationLabel(action)
        const targetChainLabel = targetNetwork === 'qortal' ? 'Qortal' : 'Qortium'
        const grantKey = [
          context.tabId,
          context.resourceLocation,
          accountId,
          protocol,
          action,
          account.isUnlocked,
          nodeRoute,
          `group:${membershipRequest.groupId}`,
        ].join('|')
        if (!androidSessionAccountGrants.current.has(grantKey)) {
          const requestId = brand<PermissionRequestId>(
            globalThis.crypto.randomUUID?.() ??
              `home-v2-permission-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          )
          const parsedApp = (() => {
            try {
              const parsed = parseAppResourceLocation(context.resourceLocation)
              const identifier = resolveLaunchIdentifier(
                parsed.identity.identifier,
                context.resourceLocation,
              )
              return {
                identityKey: buildAppResourceLocation(parsed.sourceNetwork, {
                  ...parsed.identity,
                  identifier,
                }),
                title: parsed.identity.name,
              }
            } catch {
              return {
                identityKey: context.resourceLocation || `home-v2-tab:${context.tabId}`,
                title: 'QDN app',
              }
            }
          })()
          const appId = brand<AppId>(`home-v2:permission-app:${parsedApp.identityKey}`)
          const prompt = createPermissionPrompt({
            id: requestId,
            protocol,
            action,
            capability: 'group.membership',
            appId,
            appIdentityKey: parsedApp.identityKey,
            appTitle: parsedApp.title,
            context: {
              appId,
              identityId: brand<IdentityId>(`home-v2:identity:${accountId}`),
              nodeProfileRef: snapshot.nodes[targetNetwork].ref,
              tabId: brand<TabId>(context.tabId),
              targetNetwork,
              walletRef: brand<WalletRef>(`home-v2:wallet:${account.walletId}`),
            },
            title: `Allow ${operationLabel.toLowerCase()}?`,
            summary: `${parsedApp.title} wants to ${operationLabel.toLowerCase()} as the selected account.`,
            details: [
              { label: 'Account', value: account.label },
              { label: 'Operation', value: operationLabel },
              { label: 'Chain', value: targetChainLabel },
              { label: 'Route', value: `${nodeBefore.mode} · ${nodeBefore.nodeApiUrl}` },
              { label: 'Group', value: target.groupName },
            ],
            allowedScopes: ['single-request', 'session'],
          })
          const decision = await queueAndroidPermissionPrompt(prompt, context.tabId)
          if (!decision.approved) throw new Error('Account access was denied.')
          if (decision.scope === 'session') androidSessionAccountGrants.current.add(grantKey)
          const freshTab = productStateRef.current.tabs.find((tab) => tab.id === context.tabId)
          const freshAccount = accountCatalogueRef.current.accounts.find(
            (candidate) => candidate.id === accountId,
          )
          const nodeAfter = parseNodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
          if (
            selectedAccountId !== accountId ||
            !freshTab ||
            freshTab.context.resourceLocation !== context.resourceLocation ||
            freshAccount?.isUnlocked !== account.isUnlocked ||
            `${nodeAfter.mode}|${nodeAfter.nodeApiUrl ?? ''}` !== nodeRoute
          ) {
            throw new Error('Account access context changed before approval completed.')
          }
        }
        const rateLimitDecision = androidChatSendRateLimiter.current.checkAndRecordSend(
          `${context.tabId}|${accountId}`,
        )
        if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
        const checkStillValid = async () => {
          const freshTab = productStateRef.current.tabs.find((tab) => tab.id === context.tabId)
          const freshAccount = accountCatalogueRef.current.accounts.find(
            (candidate) => candidate.id === accountId,
          )
          if (
            selectedAccountId !== accountId ||
            !freshTab ||
            freshTab.context.resourceLocation !== context.resourceLocation ||
            !freshAccount?.isUnlocked
          ) return false
          const nodeNow = parseNodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
          return `${nodeNow.mode}|${nodeNow.nodeApiUrl ?? ''}` === nodeRoute
        }
        if (!(await checkStillValid())) {
          throw new Error('Account access context changed before the group action could start.')
        }
        return vaultClient.sendGroupMembership({
          accountId,
          action,
          groupId: membershipRequest.groupId,
          groupName: target.groupName,
          isOpen: target.isOpen,
          isStillValid: checkStillValid,
          network: targetNetwork,
          nodeApiUrl: nodeBefore.nodeApiUrl,
          validateTarget: async () => {
            await validateTarget()
          },
        })
      }
      if (isHomeV2GroupAdminAction(action)) {
        if (!vaultClient?.sendGroupAdmin) {
          throw new Error('Group administration is unavailable on this platform.')
        }
        if (!context.selectedAccountId) throw new Error('No account is selected for this tab.')
        const accountId = context.selectedAccountId
        const adminRequest = normalizeHomeV2GroupAdminRequest(
          action,
          isRecord(requestValue) ? requestValue : {},
        )
        const account = accountCatalogueRef.current.accounts.find(
          (candidate) => candidate.id === accountId,
        )
        if (!account) throw new Error('The selected account is no longer available.')
        if (!account.isUnlocked) throw new Error('The selected account is locked.')
        const targetNetwork: NetworkId = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
        const nodeBefore = parseNodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
        if (!nodeBefore.nodeApiUrl || !nodeBefore.capabilities.read) {
          throw new Error(nodeBefore.error ?? `${targetNetwork} is unavailable.`)
        }
        const nodeRoute = `${nodeBefore.mode}|${nodeBefore.nodeApiUrl}`
        const readTarget = async () => {
          const [group, admins, joinRequests] = await Promise.all([
            nodeClient.requestApp(
              protocol,
              { action: 'GET_GROUP', groupId: adminRequest.groupId },
              context,
            ),
            nodeClient.requestApp(
              protocol,
              { action: 'GET_GROUP_MEMBERS', groupId: adminRequest.groupId, limit: 0, onlyAdmins: true },
              context,
            ),
            adminRequest.action === 'APPROVE_GROUP_JOIN_REQUEST'
              ? nodeClient.requestApp(
                  protocol,
                  { action: 'GET_GROUP_JOIN_REQUESTS', groupId: adminRequest.groupId },
                  context,
                )
              : Promise.resolve(null),
          ])
          const target = normalizeHomeV2GroupAdminTarget(group, adminRequest.groupId, targetNetwork)
          const adminAddresses = normalizeHomeV2GroupAdminAddresses(admins)
          assertHomeV2GroupAdminAuthority({
            accountAddress: account.address,
            action,
            adminAddresses,
            target,
          })
          if (
            adminRequest.action === 'APPROVE_GROUP_JOIN_REQUEST' &&
            !hasHomeV2GroupJoinRequest(joinRequests, adminRequest.groupId, adminRequest.memberAddress)
          ) {
            throw new Error('The selected account does not have a current join request for this group.')
          }
          if (
            adminRequest.memberAddress === target.ownerAddress &&
            (action === 'REMOVE_GROUP_ADMIN' || action === 'GROUP_BAN' || action === 'GROUP_KICK')
          ) {
            throw new Error('The group owner cannot be removed, banned, or kicked.')
          }
          return { adminAddresses, target }
        }
        const initial = await readTarget()
        const validateTarget = async () => {
          const current = await readTarget()
          if (
            current.target.groupName !== initial.target.groupName ||
            current.target.ownerAddress !== initial.target.ownerAddress
          ) {
            throw new Error('The selected group changed before the group action could be signed.')
          }
        }
        const operationLabel = homeV2GroupAdminOperationLabel(action)
        const targetChainLabel = targetNetwork === 'qortal' ? 'Qortal' : 'Qortium'
        const requestId = brand<PermissionRequestId>(
          globalThis.crypto.randomUUID?.() ??
            `home-v2-permission-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        )
        const parsedApp = (() => {
          try {
            const parsed = parseAppResourceLocation(context.resourceLocation)
            const identifier = resolveLaunchIdentifier(parsed.identity.identifier, context.resourceLocation)
            return {
              identityKey: buildAppResourceLocation(parsed.sourceNetwork, { ...parsed.identity, identifier }),
              title: parsed.identity.name,
            }
          } catch {
            return {
              identityKey: context.resourceLocation || `home-v2-tab:${context.tabId}`,
              title: 'QDN app',
            }
          }
        })()
        const appId = brand<AppId>(`home-v2:permission-app:${parsedApp.identityKey}`)
        const prompt = createPermissionPrompt({
          id: requestId,
          protocol,
          action,
          capability: 'group.administration',
          appId,
          appIdentityKey: parsedApp.identityKey,
          appTitle: parsedApp.title,
          context: {
            appId,
            identityId: brand<IdentityId>(`home-v2:identity:${accountId}`),
            nodeProfileRef: snapshot.nodes[targetNetwork].ref,
            tabId: brand<TabId>(context.tabId),
            targetNetwork,
            walletRef: brand<WalletRef>(`home-v2:wallet:${account.walletId}`),
          },
          title: `Allow ${operationLabel.toLowerCase()}?`,
          summary: `${parsedApp.title} wants to ${operationLabel.toLowerCase()} as the selected account.`,
          details: [
            { label: 'Account', value: account.label },
            { label: 'Operation', value: operationLabel },
            { label: 'Chain', value: targetChainLabel },
            { label: 'Route', value: `${nodeBefore.mode} · ${nodeBefore.nodeApiUrl}` },
            { label: 'Group', value: initial.target.groupName },
            { label: 'Member', value: adminRequest.memberAddress },
            ...(adminRequest.reason
              ? [{ label: 'Reason', value: adminRequest.reason }]
              : []),
            ...(adminRequest.action === 'APPROVE_GROUP_JOIN_REQUEST' ||
              adminRequest.action === 'INVITE_TO_GROUP' ||
              adminRequest.action === 'GROUP_BAN'
              ? [{ label: 'Lifetime', value: adminRequest.timeToLive === 0 ? 'No expiry' : `${adminRequest.timeToLive} seconds` }]
              : []),
          ],
          allowedScopes: ['single-request'],
        })
        const decision = await queueAndroidPermissionPrompt(prompt, context.tabId)
        if (!decision.approved) throw new Error('Account access was denied.')
        const checkStillValid = async () => {
          const freshTab = productStateRef.current.tabs.find((tab) => tab.id === context.tabId)
          const freshAccount = accountCatalogueRef.current.accounts.find(
            (candidate) => candidate.id === accountId,
          )
          if (
            selectedAccountId !== accountId ||
            !freshTab ||
            freshTab.context.resourceLocation !== context.resourceLocation ||
            !freshAccount?.isUnlocked
          ) return false
          const nodeNow = parseNodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
          return `${nodeNow.mode}|${nodeNow.nodeApiUrl ?? ''}` === nodeRoute
        }
        if (!(await checkStillValid())) {
          throw new Error('Account access context changed before the group action could start.')
        }
        const rateLimitDecision = androidChatSendRateLimiter.current.checkAndRecordSend(
          `${context.tabId}|${accountId}`,
        )
        if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
        return vaultClient.sendGroupAdmin({
          accountId,
          action: adminRequest.action,
          groupId: adminRequest.groupId,
          groupName: initial.target.groupName,
          memberAddress: adminRequest.memberAddress,
          ownerAddress: initial.target.ownerAddress,
          reason: adminRequest.reason,
          timeToLive: adminRequest.timeToLive,
          isStillValid: checkStillValid,
          network: targetNetwork,
          nodeApiUrl: nodeBefore.nodeApiUrl,
          validateTarget,
        })
      }
      if (isHomeV2PrivateGroupChatReadAction(action) || isHomeV2PrivateGroupChatWriteAction(action)) {
        if (
          !vaultClient?.readPrivateGroupChats ||
          !vaultClient.sendPrivateGroupChat ||
          !vaultClient.getSigningPublicKey
        ) throw new Error('Private-group encryption is unavailable on this platform.')
        if (!context.selectedAccountId) throw new Error('No account is selected for this tab.')
        const accountId = context.selectedAccountId
        const isWrite = isHomeV2PrivateGroupChatWriteAction(action)
        const privateWriteRequest = isWrite
          ? normalizeHomeV2PrivateGroupChatWriteRequest(protocol, action, isRecord(requestValue) ? requestValue : {})
          : null
        const privateReadRequest = !isWrite
          ? normalizeHomeV2PrivateGroupChatReadRequest(protocol, action, isRecord(requestValue) ? requestValue : {})
          : null
        const privateRequest = privateWriteRequest ?? privateReadRequest!
        const account = accountCatalogueRef.current.accounts.find((candidate) => candidate.id === accountId)
        if (!account) throw new Error('The selected account is no longer available.')
        if (!account.isUnlocked) throw new Error('The selected account is locked.')
        const privateGroupNetwork = protocol === 'qdnRequest' ? 'qortium' : 'qortal'
        const nodeBefore = parseNodesSnapshot(await nodeClient.getSnapshot())[privateGroupNetwork]
        if (!nodeBefore.nodeApiUrl || !nodeBefore.capabilities.read) {
          throw new Error(nodeBefore.error ?? `${privateGroupNetwork === 'qortium' ? 'Qortium' : 'Qortal'} is unavailable.`)
        }
        const nodeRoute = `${nodeBefore.mode}|${nodeBefore.nodeApiUrl}`
        const groupId = privateRequest.groupId ?? 0
        const senderPublicKey = await vaultClient.getSigningPublicKey(accountId)
        const readState = async (requestedGroupId: number) => {
          if (privateGroupNetwork !== 'qortium') throw new Error('QPGC state is available only on Qortium.')
          const response = await nodeClient.requestApp(
            protocol,
            {
              action: 'FETCH_NODE_API',
              maxBytes: 2 * 1024 * 1024,
              path: `/chat/private/group/state/${encodeURIComponent(String(requestedGroupId))}`,
            },
            context,
          )
          const value = isRecord(response) && 'data' in response ? response.data : response
          return normalizeHomeV2QpgcGroupState(value, requestedGroupId)
        }
        const initialState = privateGroupNetwork === 'qortium' && groupId > 0 ? await readState(groupId) : null
        if (
          initialState &&
          !initialState.memberPublicKeys.some((member) => base58Encode(member) === senderPublicKey)
        ) throw Object.assign(new Error('The selected account is not a current member of this private group.'), {
          action,
          code: 'NOT_GROUP_MEMBER',
          network: 'qortium',
          retryable: false,
          target: { groupId, kind: 'group' },
        })
        const operationLabel = action === 'GET_PRIVATE_GROUP_ACTIVE_CHATS'
          ? 'Read active private-group chats'
          : action === 'GET_PRIVATE_GROUP_CHAT_STATE'
            ? 'Read private-group chat state'
            : action === 'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES'
              ? 'Read private-group chat history'
              : action === 'REQUEST_PRIVATE_GROUP_CHAT_KEY'
                ? privateGroupNetwork === 'qortal' ? 'Recover a private-group chat key' : 'Request a private-group chat key'
                : action === 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS'
                  ? privateGroupNetwork === 'qortal' ? 'Republish private-group chat keys' : 'Relay private-group chat keys'
                  : action === 'ROTATE_PRIVATE_GROUP_CHAT_KEY'
                    ? 'Rotate a private-group chat key'
                    : action === 'SEND_PRIVATE_GROUP_CHAT_EDIT'
                      ? 'Edit a private-group message'
                      : action === 'SEND_PRIVATE_GROUP_CHAT_DELETE'
                        ? 'Clear private-group message content'
                        : action === 'SEND_PRIVATE_GROUP_CHAT_REACTION'
                          ? 'React in a private group'
                          : 'Send a private-group message'
        const grantKey = [
          context.tabId,
          context.resourceLocation,
          accountId,
          protocol,
          action,
          account.isUnlocked,
          nodeRoute,
          `private-group:${groupId || 'active'}`,
        ].join('|')
        const singleRequestOnly = isWrite && (
          action === 'REQUEST_PRIVATE_GROUP_CHAT_KEY' ||
          action === 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS' ||
          action === 'ROTATE_PRIVATE_GROUP_CHAT_KEY'
        )
        if (singleRequestOnly || !androidSessionAccountGrants.current.has(grantKey)) {
          const requestId = brand<PermissionRequestId>(
            globalThis.crypto.randomUUID?.() ??
              `home-v2-permission-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          )
          const parsedApp = (() => {
            try {
              const parsed = parseAppResourceLocation(context.resourceLocation)
              const identifier = resolveLaunchIdentifier(parsed.identity.identifier, context.resourceLocation)
              return {
                identityKey: buildAppResourceLocation(parsed.sourceNetwork, { ...parsed.identity, identifier }),
                title: parsed.identity.name,
              }
            } catch {
              return {
                identityKey: context.resourceLocation || `home-v2-tab:${context.tabId}`,
                title: 'QDN app',
              }
            }
          })()
          const appId = brand<AppId>(`home-v2:permission-app:${parsedApp.identityKey}`)
          const capability = !isWrite
            ? 'chat.private-group.read'
            : action === 'ROTATE_PRIVATE_GROUP_CHAT_KEY'
              ? 'chat.private-group.rotate'
              : action === 'REQUEST_PRIVATE_GROUP_CHAT_KEY' || action === 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS'
                ? 'chat.private-group.recover'
                : 'chat.private-group.send'
          const prompt = createPermissionPrompt({
            id: requestId,
            protocol,
            action,
            capability,
            appId,
            appIdentityKey: parsedApp.identityKey,
            appTitle: parsedApp.title,
            context: {
              appId,
              identityId: brand<IdentityId>(`home-v2:identity:${accountId}`),
              nodeProfileRef: snapshot.nodes[privateGroupNetwork].ref,
              tabId: brand<TabId>(context.tabId),
              targetNetwork: privateGroupNetwork,
              walletRef: brand<WalletRef>(`home-v2:wallet:${account.walletId}`),
            },
            title: `Allow ${operationLabel.toLowerCase()}?`,
            summary: `${parsedApp.title} wants to ${operationLabel.toLowerCase()} as the selected account.`,
            details: [
              { label: 'Account', value: account.label },
              { label: 'Operation', value: operationLabel },
              { label: 'Chain', value: privateGroupNetwork === 'qortium' ? 'Qortium' : 'Qortal' },
              { label: 'Route', value: `${nodeBefore.mode} · ${nodeBefore.nodeApiUrl}` },
              ...(groupId ? [{ label: 'Group', value: String(groupId) }] : []),
              ...(privateWriteRequest?.message
                ? [{ label: 'Message', value: privateWriteRequest.message.slice(0, 180) }]
                : []),
              ...(privateWriteRequest?.chatReference
                ? [{ label: 'Reference', value: privateWriteRequest.chatReference }]
                : []),
            ],
            allowedScopes: singleRequestOnly
              ? ['single-request']
              : ['single-request', 'session'],
          })
          const decision = await queueAndroidPermissionPrompt(prompt, context.tabId)
          if (!decision.approved) throw new Error('Account access was denied.')
          if (!singleRequestOnly && decision.scope === 'session') androidSessionAccountGrants.current.add(grantKey)
        }
        const checkPrivateGroupStillValid = async () => {
          const freshTab = productStateRef.current.tabs.find((tab) => tab.id === context.tabId)
          const freshAccount = accountCatalogueRef.current.accounts.find((candidate) => candidate.id === accountId)
          if (
            selectedAccountId !== accountId ||
            !freshTab ||
            freshTab.context.resourceLocation !== context.resourceLocation ||
            !freshAccount?.isUnlocked
          ) return false
          const nodesNow = await nodeClient.getSnapshot().then(parseNodesSnapshot).catch(() => null)
          const currentNode = nodesNow?.[privateGroupNetwork]
          return !!currentNode?.nodeApiUrl && `${currentNode.mode}|${currentNode.nodeApiUrl}` === nodeRoute
        }
        if (!(await checkPrivateGroupStillValid())) {
          throw new Error('Account access context changed before the private-group action could start.')
        }
        if (!isWrite) {
          if (!privateReadRequest) throw new Error('Private-group read request is unavailable.')
          return vaultClient.readPrivateGroupChats({
            accountId,
            action,
            ...(privateReadRequest.before === undefined ? {} : { before: privateReadRequest.before }),
            encoding: privateReadRequest.encoding,
            ...(privateReadRequest.groupId === undefined ? {} : { groupId: privateReadRequest.groupId }),
            isStillValid: checkPrivateGroupStillValid,
            limit: privateReadRequest.limit,
            network: privateGroupNetwork,
            nodeApiUrl: nodeBefore.nodeApiUrl,
            reverse: privateReadRequest.reverse,
          })
        }
        if (!privateWriteRequest) throw new Error('Private-group write request is unavailable.')
        const validatePrivateGroupTarget = async (currentSenderPublicKey: string, currentEpochId: string) => {
          if (currentSenderPublicKey !== senderPublicKey) {
            throw new Error('Private-group participant identity changed before signing.')
          }
          if (privateGroupNetwork === 'qortal') return
          if (!initialState) throw new Error('Private-group participant identity changed before signing.')
          const current = await readState(privateWriteRequest.groupId)
          if (base58Encode(current.epochId) !== currentEpochId || currentEpochId !== base58Encode(initialState.epochId)) {
            throw new Error('Private-group membership changed before signing.')
          }
        }
        if (!singleRequestOnly) {
          const rateLimitDecision = androidChatSendRateLimiter.current.checkAndRecordSend(
            `${context.tabId}|${accountId}`,
          )
          if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
        }
        return vaultClient.sendPrivateGroupChat({
          accountId,
          action,
          chatReference: privateWriteRequest.chatReference,
          epochId: privateWriteRequest.epochId,
          groupId: privateWriteRequest.groupId,
          isStillValid: checkPrivateGroupStillValid,
          keyId: privateWriteRequest.keyId,
          limit: privateWriteRequest.limit,
          message: privateWriteRequest.message,
          network: privateGroupNetwork,
          nodeApiUrl: nodeBefore.nodeApiUrl,
          validateTarget: validatePrivateGroupTarget,
        })
      }
      if (isHomeV2DirectChatReadAction(action) || isHomeV2DirectChatWriteAction(action)) {
        if (!vaultClient?.readDirectChats || !vaultClient.sendDirectChat || !vaultClient.getSigningPublicKey) {
          throw new Error('Direct-message encryption is unavailable on this platform.')
        }
        if (!context.selectedAccountId) throw new Error('No account is selected for this tab.')
        const accountId = context.selectedAccountId
        const isWrite = isHomeV2DirectChatWriteAction(action)
        const directWriteRequest = isWrite
          ? normalizeHomeV2DirectChatWriteRequest(protocol, action, isRecord(requestValue) ? requestValue : {})
          : null
        const directReadRequest = !isWrite
          ? normalizeHomeV2DirectChatReadRequest(protocol, action, isRecord(requestValue) ? requestValue : {})
          : null
        const directRequest = directWriteRequest ?? directReadRequest!
        const account = accountCatalogueRef.current.accounts.find((candidate) => candidate.id === accountId)
        if (!account) throw new Error('The selected account is no longer available.')
        if (!account.isUnlocked) throw new Error('The selected account is locked.')
        const targetNetwork: NetworkId = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
        const nodeBefore = parseNodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
        if (!nodeBefore.nodeApiUrl || !nodeBefore.capabilities.read) {
          throw new Error(nodeBefore.error ?? `${targetNetwork} is unavailable.`)
        }
        const nodeRoute = `${nodeBefore.mode}|${nodeBefore.nodeApiUrl}`
        const otherAddress = directRequest.otherAddress ?? 'all-direct-conversations'
        const readPeerPublicKey = async (peerAddress: string) => {
          const response = await nodeClient.requestApp(
            protocol,
            {
              action: 'FETCH_NODE_API',
              maxBytes: 4096,
              path: `/addresses/publickey/${encodeURIComponent(peerAddress)}`,
            },
            context,
          )
          const value = isRecord(response) && 'data' in response ? response.data : response
          const publicKey = typeof value === 'string'
            ? value.trim()
            : isRecord(value) && typeof value.publicKey === 'string'
              ? value.publicKey.trim()
              : ''
          try {
            const bytes = base58Decode(publicKey)
            if (bytes.length !== 32 || base58Encode(bytes) !== publicKey) throw new Error('invalid')
            return publicKey
          } catch {
            throw new Error('The direct-message recipient does not have a usable public key.')
          }
        }
        const approvedSenderPublicKey = isWrite
          ? await vaultClient.getSigningPublicKey(accountId)
          : null
        const approvedPeerPublicKey = isWrite
          ? await readPeerPublicKey(directWriteRequest!.otherAddress)
          : null
        const validateApprovedDirectTarget = async (
          senderPublicKey = approvedSenderPublicKey,
          peerPublicKey = approvedPeerPublicKey,
        ) => {
          if (!isWrite) return
          if (
            senderPublicKey !== approvedSenderPublicKey ||
            peerPublicKey !== approvedPeerPublicKey ||
            (await readPeerPublicKey(directWriteRequest!.otherAddress)) !== approvedPeerPublicKey
          ) throw new Error('Direct-message participant identity changed before signing.')
          if (!directWriteRequest?.chatReference) return
          assertHomeV2DirectReferenceTarget(
            await nodeClient.requestApp(
              protocol,
              {
                action: 'GET_CHAT_MESSAGE',
                encoding: 'BASE58',
                signature: directWriteRequest.chatReference,
              },
              context,
            ),
            {
              action,
              localAddress: account.address,
              localPublicKey: senderPublicKey as string,
              otherAddress: directWriteRequest.otherAddress,
              otherPublicKey: peerPublicKey as string,
              signature: directWriteRequest.chatReference,
            },
          )
        }
        if (isWrite) await validateApprovedDirectTarget()
        const operationLabel = isWrite
          ? action === 'SEND_DIRECT_CHAT_EDIT'
            ? 'Edit direct message'
            : action === 'SEND_DIRECT_CHAT_DELETE'
              ? 'Clear direct message content'
              : action === 'SEND_DIRECT_CHAT_REACTION'
                ? 'React to direct message'
                : 'Send direct message'
          : action === 'GET_PRIVATE_DIRECT_ACTIVE_CHATS'
            ? 'Read active direct conversations'
            : 'Read direct-message history'
        const grantKey = [
          context.tabId,
          context.resourceLocation,
          accountId,
          protocol,
          action,
          account.isUnlocked,
          nodeRoute,
          `direct:${otherAddress}`,
        ].join('|')
        if (isWrite || !androidSessionAccountGrants.current.has(grantKey)) {
          const requestId = brand<PermissionRequestId>(
            globalThis.crypto.randomUUID?.() ??
              `home-v2-permission-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          )
          const parsedApp = (() => {
            try {
              const parsed = parseAppResourceLocation(context.resourceLocation)
              const identifier = resolveLaunchIdentifier(parsed.identity.identifier, context.resourceLocation)
              return {
                identityKey: buildAppResourceLocation(parsed.sourceNetwork, { ...parsed.identity, identifier }),
                title: parsed.identity.name,
              }
            } catch {
              return {
                identityKey: context.resourceLocation || `home-v2-tab:${context.tabId}`,
                title: 'QDN app',
              }
            }
          })()
          const appId = brand<AppId>(`home-v2:permission-app:${parsedApp.identityKey}`)
          const prompt = createPermissionPrompt({
            id: requestId,
            protocol,
            action,
            capability: isWrite ? 'chat.direct.send' : 'chat.direct.read',
            appId,
            appIdentityKey: parsedApp.identityKey,
            appTitle: parsedApp.title,
            context: {
              appId,
              identityId: brand<IdentityId>(`home-v2:identity:${accountId}`),
              nodeProfileRef: snapshot.nodes[targetNetwork].ref,
              tabId: brand<TabId>(context.tabId),
              targetNetwork,
              walletRef: brand<WalletRef>(`home-v2:wallet:${account.walletId}`),
            },
            title: `Allow ${operationLabel.toLowerCase()}?`,
            summary: `${parsedApp.title} wants to ${operationLabel.toLowerCase()} as the selected account.`,
            details: [
              { label: 'Account', value: account.label },
              { label: 'Operation', value: operationLabel },
              { label: 'Chain', value: targetNetwork === 'qortal' ? 'Qortal' : 'Qortium' },
              { label: 'Route', value: `${nodeBefore.mode} · ${nodeBefore.nodeApiUrl}` },
              { label: 'Conversation', value: otherAddress },
              ...(directWriteRequest
                ? [{ label: 'Message', value: directWriteRequest.message.slice(0, 180) }]
                : []),
              ...(directWriteRequest?.chatReference
                ? [{ label: 'Reference', value: directWriteRequest.chatReference }]
                : []),
            ],
            allowedScopes: isWrite ? ['single-request'] : ['single-request', 'session'],
          })
          const decision = await queueAndroidPermissionPrompt(prompt, context.tabId)
          if (!decision.approved) throw new Error('Account access was denied.')
          if (!isWrite && decision.scope === 'session') androidSessionAccountGrants.current.add(grantKey)
        }
        const checkDirectStillValid = async () => {
          const freshTab = productStateRef.current.tabs.find((tab) => tab.id === context.tabId)
          const freshAccount = accountCatalogueRef.current.accounts.find((candidate) => candidate.id === accountId)
          if (
            selectedAccountId !== accountId ||
            !freshTab ||
            freshTab.context.resourceLocation !== context.resourceLocation ||
            !freshAccount?.isUnlocked
          ) return false
          const nodeNow = await nodeClient.getSnapshot().then(parseNodesSnapshot).catch(() => null)
          const summary = nodeNow?.[targetNetwork]
          return !!summary?.nodeApiUrl && `${summary.mode}|${summary.nodeApiUrl}` === nodeRoute
        }
        if (!(await checkDirectStillValid())) {
          throw new Error('Account access context changed before the direct-message action could start.')
        }
        if (!isWrite) {
          if (!directReadRequest) throw new Error('Direct-message read request is unavailable.')
          return vaultClient.readDirectChats({
            accountId,
            action,
            ...(directReadRequest.before === undefined ? {} : { before: directReadRequest.before }),
            encoding: directReadRequest.encoding,
            ...(directReadRequest.hasChatReference === undefined
              ? {}
              : { hasChatReference: directReadRequest.hasChatReference }),
            isStillValid: checkDirectStillValid,
            limit: directReadRequest.limit,
            network: targetNetwork,
            nodeApiUrl: nodeBefore.nodeApiUrl,
            ...(directReadRequest.otherAddress ? { otherAddress: directReadRequest.otherAddress } : {}),
            reverse: directReadRequest.reverse,
          })
        }
        if (!directWriteRequest) throw new Error('Direct-message write request is unavailable.')
        const rateLimitDecision = androidChatSendRateLimiter.current.checkAndRecordSend(
          `${context.tabId}|${accountId}`,
        )
        if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
        return vaultClient.sendDirectChat({
          accountId,
          action,
          chatReference: directWriteRequest.chatReference,
          isStillValid: checkDirectStillValid,
          message: directWriteRequest.message,
          network: targetNetwork,
          nodeApiUrl: nodeBefore.nodeApiUrl,
          otherAddress: directWriteRequest.otherAddress,
          validateTarget: validateApprovedDirectTarget,
        })
      }
      if (isHomeV2PublicChatAction(action)) {
        if (!vaultClient?.sendChatMessage || !vaultClient.getSigningPublicKey) {
          throw new Error('Chat sending is unavailable on this platform.')
        }
        if (!context.selectedAccountId) throw new Error('No account is selected for this tab.')
        const accountId = context.selectedAccountId
        const sendRequest = isRecord(requestValue) ? requestValue : {}
        const chatRequest = normalizeHomeV2PublicChatRequest(protocol, action, sendRequest)
        const effectiveAction = chatRequest.action
        const account = accountCatalogueRef.current.accounts.find(
          (candidate) => candidate.id === accountId,
        )
        if (!account) throw new Error('The selected account is no longer available.')
        // The Chat app is expected to drive UNLOCK_SELECTED_ACCOUNT first on
        // qdnRequest; a pure-Qortal app cannot unlock in Phase 1 (documented
        // limitation, docs/HOME_V2_BRIDGE_COMPATIBILITY.md). Failing fast here
        // also avoids prompting for a send that cannot possibly proceed.
        if (!account.isUnlocked) throw new Error('The selected account is locked.')
        const targetNetwork: NetworkId = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
        const nodeBefore = parseNodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
        if (!nodeBefore.nodeApiUrl || !nodeBefore.capabilities.read) {
          throw new Error(nodeBefore.error ?? `${targetNetwork} is unavailable.`)
        }
        const nodeRoute = `${nodeBefore.mode}|${nodeBefore.nodeApiUrl}`
        const senderPublicKey = await vaultClient.getSigningPublicKey(accountId)
        const validateTarget = async (expectedSenderPublicKey = senderPublicKey) => {
          if (chatRequest.txGroupId !== 0) {
            const group = await nodeClient.requestApp(
              protocol,
              { action: 'GET_GROUP', groupId: chatRequest.txGroupId },
              context,
            )
            assertHomeV2OpenPublicGroup(group, chatRequest.txGroupId, targetNetwork)
          }
          if (!chatRequest.chatReference) return
          normalizeHomeV2PublicChatReferenceTarget(
            await nodeClient.requestApp(
              protocol,
              {
                action: 'GET_CHAT_MESSAGE',
                encoding: 'BASE58',
                signature: chatRequest.chatReference,
              },
              context,
            ),
            {
              chatReference: chatRequest.chatReference,
              requireOriginal: true,
              requireSenderOwnership:
                effectiveAction === 'SEND_CHAT_EDIT' || effectiveAction === 'SEND_CHAT_DELETE',
              senderPublicKey: expectedSenderPublicKey,
              txGroupId: chatRequest.txGroupId,
            },
          )
        }
        await validateTarget()
        const targetChainLabel = targetNetwork === 'qortal' ? 'Qortal' : 'Qortium'
        const groupLabel = chatRequest.txGroupId === 0 ? 'General chat' : `Group ${chatRequest.txGroupId}`
        const operationLabel = publicChatOperationLabel(effectiveAction)
        const grantKey = [
          context.tabId,
          context.resourceLocation,
          accountId,
          protocol,
          effectiveAction,
          account.isUnlocked,
          nodeRoute,
        ].join('|')
        if (!androidSessionAccountGrants.current.has(grantKey)) {
          const requestId = brand<PermissionRequestId>(
            globalThis.crypto.randomUUID?.() ??
              `home-v2-permission-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          )
          const appTitle = (() => {
            try {
              return parseAppResourceLocation(context.resourceLocation).identity.name
            } catch {
              return 'QDN app'
            }
          })()
          // Canonicalize to the app's identity (network + service/name/
          // identifier), dropping route/query/hash, so one app cannot mint
          // separate per-app prompt-cap buckets by opening URL variants
          // (FIX #4, review 2). Falls back to the raw location, then the tab.
          //
          // Round 5, Minor 1 (Sol round-4 re-review, Defect B tail):
          // parsed.identity.identifier is PATH-only (parseAppResourceLocation
          // never inspects context.resourceLocation's own `?identifier=`
          // query) — see render-path-identity.ts's resolveLaunchIdentifier
          // doc comment for why that query always wins outright once Core
          // resolves the actual render. Folding it in here makes the
          // recorded/displayed principal (this appId, and the appTitle/
          // summary the user is shown) match what native enforcement already
          // keys on: AppTabStage.tsx's authorize() call resolves the SAME
          // query-aware identifier for the native proxy's launch-identity
          // registration, and the grantKey above already uses the raw
          // resourceLocation (so the actual grant, unlike this label, was
          // never borrowable). Without this, a `.../default?identifier=evil`
          // launch would record/display its principal as "Chat/default" even
          // though the account-read/signing bridge — and native enforcement
          // — treats it as "Chat/evil".
          const appIdentityKey = (() => {
            try {
              const parsed = parseAppResourceLocation(context.resourceLocation)
              const identifier = resolveLaunchIdentifier(
                parsed.identity.identifier,
                context.resourceLocation,
              )
              return buildAppResourceLocation(parsed.sourceNetwork, {
                ...parsed.identity,
                identifier,
              })
            } catch {
              return context.resourceLocation || `home-v2-tab:${context.tabId}`
            }
          })()
          const appId = brand<AppId>(`home-v2:permission-app:${appIdentityKey}`)
          const prompt = createPermissionPrompt({
            id: requestId,
            protocol,
            action: effectiveAction,
            capability: 'chat.send',
            appId,
            appIdentityKey,
            appTitle,
            context: {
              appId,
              identityId: brand<IdentityId>(`home-v2:identity:${accountId}`),
              nodeProfileRef: snapshot.nodes[targetNetwork].ref,
              tabId: brand<TabId>(context.tabId),
              targetNetwork,
              walletRef: brand<WalletRef>(`home-v2:wallet:${account.walletId}`),
            },
            title: `Allow ${operationLabel.toLowerCase()}?`,
            summary: `${appTitle} wants to ${operationLabel.toLowerCase()} as the selected account.`,
            details: [
              { label: 'Account', value: account.label },
              { label: 'Operation', value: operationLabel },
              { label: 'Chain', value: `${targetChainLabel} · ${groupLabel}` },
              { label: 'Message', value: chatRequest.message.slice(0, 180) },
              ...(chatRequest.chatReference
                ? [{ label: 'Reference', value: chatRequest.chatReference }]
                : []),
            ],
            allowedScopes: ['single-request', 'session'],
          })
          const decision = await queueAndroidPermissionPrompt(prompt, context.tabId)
          if (!decision.approved) throw new Error('Account access was denied.')
          if (decision.scope === 'session') androidSessionAccountGrants.current.add(grantKey)
          const freshTab = productState.tabs.find((tab) => tab.id === context.tabId)
          const freshAccount = accountCatalogueRef.current.accounts.find(
            (candidate) => candidate.id === accountId,
          )
          const nodeAfter = parseNodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
          if (
            selectedAccountId !== accountId ||
            !freshTab ||
            freshTab.context.resourceLocation !== context.resourceLocation ||
            freshAccount?.isUnlocked !== account.isUnlocked ||
            `${nodeAfter.mode}|${nodeAfter.nodeApiUrl ?? ''}` !== nodeRoute
          ) {
            throw new Error('Account access context changed before approval completed.')
          }
        }
        // Fix B: reject an excessive send BEFORE any node call or proof-of-
        // work — mirrors electron/home-v2-app-bridge.ts sendHomeV2ChatMessage
        // (same shared rate-limiter module/constants).
        const rateLimitDecision = androidChatSendRateLimiter.current.checkAndRecordSend(
          `${context.tabId}|${accountId}`,
        )
        if (!rateLimitDecision.allowed) {
          throw new Error(rateLimitDecision.message)
        }
        // Re-verify immediately before the (potentially tens-of-seconds)
        // memory-pow+sign step, mirroring the desktop bridge's isStillValid
        // recheck at the same point (electron/home-v2-app-bridge.ts
        // sendHomeV2ChatMessage's isStillValid closure: same tab/account/
        // resource context, still unlocked, same node route). This same
        // predicate is threaded into vaultClient.sendChatMessage, which polls
        // it during the memory-pow computation and rechecks it once more
        // immediately before signing/broadcast — not just here, before PoW
        // even starts (FIX #2, security review: Android previously had no
        // recheck once PoW was underway).
        const checkChatSendStillValid = async () => {
          const freshTab = productStateRef.current.tabs.find((tab) => tab.id === context.tabId)
          const freshAccount = accountCatalogueRef.current.accounts.find(
            (candidate) => candidate.id === accountId,
          )
          if (
            !freshTab ||
            freshTab.context.resourceLocation !== context.resourceLocation ||
            !freshAccount?.isUnlocked
          ) {
            return false
          }
          const nodeNow = await nodeClient.getSnapshot().then(parseNodesSnapshot).catch(() => null)
          const nodeSummary = nodeNow?.[targetNetwork]
          return !!nodeSummary?.nodeApiUrl && `${nodeSummary.mode}|${nodeSummary.nodeApiUrl}` === nodeRoute
        }
        const nodeBeforeSend = parseNodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
        if (!nodeBeforeSend.nodeApiUrl || !(await checkChatSendStillValid())) {
          throw new Error('Account access context changed before approval completed.')
        }
        return vaultClient.sendChatMessage({
          accountId,
          action: effectiveAction,
          chatReference: chatRequest.chatReference,
          isStillValid: checkChatSendStillValid,
          message: chatRequest.message,
          network: targetNetwork,
          nodeApiUrl: nodeBeforeSend.nodeApiUrl,
          txGroupId: chatRequest.txGroupId,
          validateTarget,
        })
      }
      if (action !== 'GET_SELECTED_ACCOUNT' && action !== 'GET_USER_ACCOUNT') {
        return nodeClient.requestApp(protocol, requestValue, context)
      }
      if (!context.selectedAccountId) throw new Error('No account is selected for this tab.')
      const targetNetwork = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
      const account = accountCatalogueRef.current.accounts.find(
        (candidate) => candidate.id === context.selectedAccountId,
      )
      if (!account) throw new Error('The selected account is no longer available.')
      const nodeBefore = parseNodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
      const nodeRoute = `${nodeBefore.mode}|${nodeBefore.nodeApiUrl ?? ''}`
      const grantKey = [
        context.tabId,
        context.resourceLocation,
        context.selectedAccountId,
        protocol,
        action,
        account.isUnlocked,
        nodeRoute,
      ].join('|')
      if (!androidSessionAccountGrants.current.has(grantKey)) {
        const requestId = brand<PermissionRequestId>(
          globalThis.crypto.randomUUID?.() ??
            `home-v2-permission-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        )
        const appTitle = (() => {
          try {
            return parseAppResourceLocation(context.resourceLocation).identity.name
          } catch {
            return 'QDN app'
          }
        })()
        const appIdentityKey = context.resourceLocation || `home-v2-tab:${context.tabId}`
        const appId = brand<AppId>(`home-v2:permission-app:${appIdentityKey}`)
        const prompt = createPermissionPrompt({
          id: requestId,
          protocol,
          action,
          capability: 'account.public.read',
          appId,
          appIdentityKey,
          appTitle,
          context: {
            appId,
            identityId: brand<IdentityId>(`home-v2:identity:${context.selectedAccountId}`),
            nodeProfileRef: snapshot.nodes[targetNetwork].ref,
            tabId: brand<TabId>(context.tabId),
            targetNetwork,
            walletRef: account
              ? brand<WalletRef>(`home-v2:wallet:${account.walletId}`)
              : null,
          },
          title: 'Allow account access?',
          summary: `${appTitle} wants to read the selected account address and public identity data.`,
          details: [
            { label: 'Account', value: account?.label ?? context.selectedAccountId },
            { label: 'Data', value: 'Address, public key when available, lock state, and public name' },
          ],
          allowedScopes: ['single-request', 'session'],
        })
        const decision = await queueAndroidPermissionPrompt(prompt, context.tabId)
        if (!decision.approved) throw new Error('Account access was denied.')
        if (decision.scope === 'session') androidSessionAccountGrants.current.add(grantKey)
        const freshTab = productState.tabs.find((tab) => tab.id === context.tabId)
        const freshAccount = accountCatalogueRef.current.accounts.find(
          (candidate) => candidate.id === context.selectedAccountId,
        )
        const nodeAfter = parseNodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
        if (
          selectedAccountId !== context.selectedAccountId ||
          !freshTab ||
          freshTab.context.resourceLocation !== context.resourceLocation ||
          freshAccount?.isUnlocked !== account.isUnlocked ||
          `${nodeAfter.mode}|${nodeAfter.nodeApiUrl ?? ''}` !== nodeRoute
        ) {
          throw new Error('Account access context changed before approval completed.')
        }
      }
      if (action === 'GET_SELECTED_ACCOUNT') {
        const current = accountCatalogueRef.current.accounts.find(
          (candidate) => candidate.id === context.selectedAccountId,
        )
        if (!current) throw new Error('The selected account is no longer available.')
        const identity = await resolveDualIdentity(current.address, (network, request) =>
          nodeClient.readIdentity(network, request),
        ).catch(() => null)
        return {
          address: current.address,
          avatarContract: 'pointer-aware-account-avatar-v1',
          avatarUrl: null,
          isUnlocked: current.isUnlocked,
          name:
            identity?.networks.qortium.primaryName ??
            identity?.networks.qortal.primaryName ??
            null,
        }
      }
      return nodeClient.requestApp(protocol, requestValue, context)
    },
    [nodeClient, productState.tabs, queueAndroidPermissionPrompt, selectedAccountId, snapshot.nodes, vaultClient],
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

  const selectedVaultAccount = vaultState.accounts.find(
    (account) => account.id === vaultState.selectedAccountId,
  )
  const dialogVaultAccount = vaultState.accounts.find(
    (account) => account.id === accountDialog?.accountId,
  ) ?? selectedVaultAccount

  const commitVaultState = async (state: HomeV2VaultState) => {
    const catalogue = applyVaultState(state)
    setRestoredAccountId(state.selectedAccountId)
    setRestoredAddressId(state.selectedAddressId)
    await selectAccount(state.selectedAddressId, catalogue, state)
  }

  const runVaultOperation = async (operation: () => Promise<HomeV2VaultState>) => {
    setAccountDialogBusy(true)
    setAccountDialogError(null)
    try {
      await commitVaultState(await operation())
      setAccountDialog(null)
    } catch (error) {
      setAccountDialogError(error instanceof Error ? error.message : 'Account operation failed.')
    } finally {
      setAccountDialogBusy(false)
    }
  }

  const submitAccountDialog = (value: AccountDialogSubmission) => {
    if (!accountDialog || !vaultClient) return
    const accountId = accountDialog.accountId ?? selectedVaultAccount?.id
    switch (accountDialog.mode) {
      case 'create':
        void runVaultOperation(async () => {
          const result = await vaultClient.create({
            label: value.label ?? '',
            password: value.password ?? '',
            passwordConfirmation: value.passwordConfirmation ?? '',
          })
          if (result.canceled) throw new Error('Account creation was canceled before the wallet backup was saved.')
          return result.state
        })
        return
      case 'import-wallet-label':
        if (!accountDialog.pendingToken) return
        void runVaultOperation(() =>
          vaultClient.saveLoadedWallet({
            label: value.label ?? '',
            token: accountDialog.pendingToken as string,
          }),
        )
        return
      case 'import-private-key':
        void runVaultOperation(async () => {
          const result = await vaultClient.importPrivateKey({
            label: value.label ?? '',
            password: value.password ?? '',
            passwordConfirmation: value.passwordConfirmation ?? '',
            privateKey: value.privateKey ?? '',
          })
          if (result.canceled) throw new Error('Private-key import was canceled before the wallet backup was saved.')
          return result.state
        })
        return
      case 'rename':
        if (accountId) void runVaultOperation(() => vaultClient.rename({ accountId, label: value.label ?? '' }))
        return
      case 'remove-account':
        if (accountId) void runVaultOperation(() => vaultClient.removeAccount({ accountId, password: value.password || undefined }))
        return
      case 'unlock':
        if (accountId) {
          setAccountDialogBusy(true)
          setAccountDialogError(null)
          void vaultClient.unlock({
            accountId,
            password: value.useRememberedUnlock ? undefined : value.password,
            useRememberedUnlock: value.useRememberedUnlock,
          }).then(async (state) => {
            await commitVaultState(state)
            for (const tab of productState.tabs) {
              const boundId = String(tab.context.identityId).replace(/^home-v2:identity:/, '')
              if (boundId === accountId || boundId.startsWith(`${accountId}:`)) {
                void window.homeV2Apps?.updateAccountState({
                  accountId: boundId,
                  isUnlocked: true,
                  tabId: tab.id,
                })
              }
            }
            const androidResolver = accountDialog.permissionRequestId
              ? androidUnlockResolvers.current.get(accountDialog.permissionRequestId)
              : undefined
            if (androidResolver && accountDialog.permissionRequestId) {
              androidUnlockResolvers.current.delete(accountDialog.permissionRequestId)
              await androidResolver.complete(state)
            } else if (accountDialog.permissionRequestId) {
              window.homeV2Apps?.resolvePermission({
                approved: true,
                requestId: accountDialog.permissionRequestId,
                scope: 'single-request',
              })
            }
            setAccountDialog(null)
          }).catch((error: unknown) => {
            setAccountDialogError(error instanceof Error ? error.message : 'Unable to unlock the account.')
          }).finally(() => setAccountDialogBusy(false))
        }
        return
      case 'enable-remember':
        if (accountId) {
          void runVaultOperation(() =>
            vaultClient.updateSecurity({
              accountId,
              password: value.password,
              rememberUnlock: true,
            }),
          )
        }
    }
  }

  const openWalletImport = async () => {
    if (!vaultClient) return
    setAccountDialogError(null)
    try {
      const selection = await vaultClient.selectWalletFile()
      if (!selection.canceled) {
        setAccountDialog({
          mode: 'import-wallet-label',
          pendingToken: selection.token,
          suggestedLabel: selection.suggestedName,
        })
      }
    } catch (error) {
      setShellNotice(error instanceof Error ? error.message : 'Unable to open the wallet file.')
    }
  }

  const manageAccount = (action: HomeV2AccountManageAction) => {
    if (!vaultClient) return
    setAccountDialogError(null)
    if (action === 'import-private-key') {
      setAccountDialog({ mode: action })
      return
    }
    if (!selectedVaultAccount) return
    if (action === 'rename' || action === 'remove-account') {
      setAccountDialog({ mode: action })
      return
    }
    if (action === 'export') {
      void vaultClient.exportAccount(selectedVaultAccount.id).then((result) => {
        if (!result.canceled) setShellNotice(`Wallet backup saved as ${result.fileName ?? 'JSON file'}.`)
      }).catch((error: unknown) => setShellNotice(error instanceof Error ? error.message : 'Unable to export the wallet backup.'))
      return
    }
    if (action === 'add-address') {
      void runVaultOperation(() => vaultClient.addAddress(selectedVaultAccount.id))
      return
    }
    const addressId = vaultState.selectedAddressId
    if (action === 'remove-address' && addressId && window.confirm('Remove this derived address from Home? It can be derived again later.')) {
      void runVaultOperation(() => vaultClient.removeAddress(addressId))
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

  const permissionPromptTabId = permissionState.pending[0]?.context.tabId ?? null
  const accountPromptTabId = accountDialog?.permissionRequestId
    ? accountDialog.requestTabId ?? null
    : null
  const appOverlayTabId = accountPromptTabId ?? permissionPromptTabId
  const accountDialogVisible =
    !!accountDialog &&
    (!accountPromptTabId || productState.activeTabId === accountPromptTabId)

  const accountDialogOverlay = accountDialog && accountDialogVisible ? (
    <AccountDialog
      accountLabel={dialogVaultAccount?.label}
      busy={accountDialogBusy}
      error={accountDialogError}
      mode={accountDialog.mode}
      rememberedUnlockAvailable={
        dialogVaultAccount?.security.rememberUnlock === true &&
        dialogVaultAccount.security.manuallyLocked === false
      }
      suggestedLabel={accountDialog.suggestedLabel}
      onCancel={() => {
        if (accountDialog.pendingToken) {
          void vaultClient?.discardLoadedWallet(accountDialog.pendingToken)
        }
        if (accountDialog.permissionRequestId) {
          const androidResolver = androidUnlockResolvers.current.get(accountDialog.permissionRequestId)
          if (androidResolver) {
            androidUnlockResolvers.current.delete(accountDialog.permissionRequestId)
            androidResolver.reject(new Error('Account unlock was denied.'))
          } else {
            window.homeV2Apps?.resolvePermission({
              approved: false,
              requestId: accountDialog.permissionRequestId,
              scope: null,
            })
          }
        }
        setAccountDialog(null)
        setAccountDialogError(null)
      }}
      onSubmit={submitAccountDialog}
    />
  ) : null

  useEffect(() => {
    if (
      !appOverlayTabId ||
      productState.activeTabId === appOverlayTabId ||
      !productState.tabs.some((tab) => tab.id === appOverlayTabId)
    ) {
      return
    }
    dispatchProduct({
      type: 'activate-tab',
      tabId: brand<TabId>(appOverlayTabId),
    })
  }, [appOverlayTabId, productState.activeTabId, productState.tabs])

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
      if (window.homeV2Apps) {
        void window.homeV2Apps.navigate({
          index: target.index,
          tabId: productState.activeTabId,
        })
      } else {
        void androidNavigationControllers.current
          .get(productState.activeTabId)
          ?.goToIndex(target.index)
      }
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
          : shellNotice ?? 'Accounts, connections, and QDN apps'
      }
      overlay={customNodeDialog ?? accountDialogOverlay}
      appOverlayTabId={appOverlayTabId ? brand<TabId>(appOverlayTabId) : null}
      identityLookup={identityLookup}
      identityLookupBusy={identityLookupBusy}
      identityLookupError={identityLookupError}
      identityLookupInput={identityInput}
      loadVisibleAvatar={loadVisibleAvatar}
      accountCatalogue={accountCatalogue}
      vaultState={vaultState}
      selectedAccountId={selectedAccountId}
      selectedAccountLookup={selectedAccountLookup}
      appReloadVersion={appReloadVersion}
      nodeClient={nodeClient}
      requestApp={requestApp}
      onActivateTab={(tabId) =>
        dispatchProduct({ type: 'activate-tab', tabId })
      }
      onCloseTab={(tabId) => {
        void window.homeV2Apps?.destroy({ tabId })
        androidNavigationControllers.current.delete(tabId)
        setAppNavigation((current) => {
          if (!(tabId in current)) return current
          const next = { ...current }
          delete next[tabId]
          return next
        })
        // Deny (rather than leave hanging) any Android permission prompt
        // still pending for this tab — closing the tab that requested it
        // means the app frame that would have received the result is gone
        // (FIX #3, security review).
        for (const [requestId, meta] of androidPendingPermissionMeta.current) {
          if (meta.tabId === tabId) resolveAccountPermission(requestId, { approved: false })
        }
        dispatchProduct({ type: 'close-tab', tabId })
      }}
      onAppNavigationChanged={handleAppNavigationChanged}
      onAppNavigationControllerChange={handleAppNavigationControllerChange}
      onAppTitleChanged={handleAppTitleChanged}
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
        if (!vaultClient) return
        setUseCatalogueActiveAccount(false)
        const account = vaultState.accounts.find((candidate) => candidate.id === accountId)
        void runVaultOperation(() =>
          vaultClient.select({
            accountId,
            addressId: accountId ? account?.addresses[0]?.id ?? accountId : null,
          }),
        )
      }}
      onSelectAddress={(addressId) => {
        if (!vaultClient || !vaultState.selectedAccountId) return
        void runVaultOperation(() =>
          vaultClient.select({
            accountId: vaultState.selectedAccountId,
            addressId,
          }),
        )
      }}
      onCreateAccount={() => {
        setAccountDialogError(null)
        setAccountDialog({ mode: 'create' })
      }}
      onImportAccount={() => void openWalletImport()}
      onUnlockAccount={() => {
        setAccountDialogError(null)
        setAccountDialog({ mode: 'unlock' })
      }}
      onLockAccount={() => {
        if (!vaultClient || !selectedVaultAccount) return
        setPermissionState((current) => invalidatePermissionState(current, { kind: 'locked' }))
        androidSessionAccountGrants.current.clear()
        androidChatSendRateLimiter.current.reset()
        window.homeV2Apps?.accountLocked()
        for (const tab of productState.tabs) {
          const boundId = String(tab.context.identityId).replace(/^home-v2:identity:/, '')
          if (boundId.startsWith(`${selectedVaultAccount.id}`)) {
            void window.homeV2Apps?.updateAccountState({
              accountId: boundId,
              isUnlocked: false,
              tabId: tab.id,
            })
          }
        }
        void runVaultOperation(() => vaultClient.lock(selectedVaultAccount.id))
      }}
      onAccountManage={manageAccount}
      onToggleRememberUnlock={() => {
        if (!vaultClient || !selectedVaultAccount) return
        if (selectedVaultAccount.security.rememberUnlock) {
          void runVaultOperation(() =>
            vaultClient.updateSecurity({
              accountId: selectedVaultAccount.id,
              rememberUnlock: false,
            }),
          )
        } else {
          setAccountDialogError(null)
          setAccountDialog({ mode: 'enable-remember' })
        }
      }}
      onToggleLockOnExit={() => {
        if (!vaultClient || !selectedVaultAccount) return
        void runVaultOperation(() =>
          vaultClient.updateSecurity({
            accountId: selectedVaultAccount.id,
            lockOnExit: !selectedVaultAccount.security.lockOnExit,
          }),
        )
      }}
      onOpenApp={openApp}
      onOpenAddress={openAddress}
      onResolvePermission={resolveAccountPermission}
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
          if (window.homeV2Apps) {
            void window.homeV2Apps.reload({ tabId: productState.activeTabId })
          } else {
            setAppReloadVersion((current) => current + 1)
          }
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
