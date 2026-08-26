import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import {
  clampHomeV2AppZoom,
  defaultHomeV2Appearance,
  resolveHomeV2SystemLanguage,
  stepHomeV2TextSize,
  type HomeV2Accent,
  type HomeV2Language,
  type HomeV2TextSize,
  type HomeV2UiStyle,
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
  DualIdentityLookupResult,
  NetworkAddress,
  WalletRef,
  TabId,
} from '../v2/contracts'
import {
  createProductState,
  findReplaceableAppTab,
  reduceProductState,
  type AppTab,
  type ProductState,
  type ReplaceTabTarget,
} from '../v2/product-model'
import {
  DEFAULT_NEW_TAB_PREFERENCE,
  parseHomeV2CoreDocsAddress,
  parseHomeV2InternalAddress,
  parseHomeV2ReleaseNotesAddress,
  type NewTabPreference,
} from '../v2/new-tab-preference'
import { HomeV2Prototype } from '../v2/shell/HomeV2Prototype'
import { HomeV2ContextMenu } from '../v2/shell/HomeV2ContextMenu'
import {
  parseHomeV2TextSizeCommand,
  subscribeHomeV2MenuCommands,
} from '../v2/menu-commands'
import { subscribeHomeV2WindowZoom } from '../v2/zoom-client'
import {
  HomeV2ResourceViewer,
  type HomeV2ResourceViewerState,
} from '../v2/shell/HomeV2ResourceViewer'
import type { HomeV2AccountManageAction } from '../v2/shell/HomeV2Prototype'
import type { HomeV2ReleaseNotesTarget } from '../v2/shell/HomeV2ReleaseNotesPage'
import {
  advanceHomeV2Onboarding,
  createHomeV2OnboardingState,
  finishHomeV2Onboarding,
  type HomeV2OnboardingState,
} from './onboarding-state'
import {
  loadHomeV2RetainedViewerBytes,
  saveHomeV2RetainedViewerBytes,
  saveHomeV2RetainedViewerFile,
} from './retained-viewer-client'
import {
  enableHomeV2CoreDocs,
  homeV2CoreDocsTransport,
  probeHomeV2CoreDocs,
} from './core-docs-client'
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
import { createHomeV2AppIconLoader } from './app-icon-loader'
import type { HomeV2VaultClient } from './vault-client'
import {
  parseHomeV2NodesSnapshot,
  useHomeV2NodeCoreController,
} from './node-core-controller'
import { useHomeV2AppUpdates } from './app-update-controller'
import {
  toHomeV2CoreMaintenanceManagement,
  useHomeV2CoreMaintenance,
} from './core-maintenance-controller'
import {
  toHomeV2QortalMaintenanceManagement,
  useHomeV2QortalMaintenance,
} from './qortal-maintenance-controller'
import {
  toHomeV2TransportManagement,
  useHomeV2TransportMaintenance,
} from './transport-maintenance-controller'
import { useHomeV2OnChainCoreUpdates } from './on-chain-core-update-controller'
import {
  HomeV2CollectionsClient,
  type HomeV2CollectionsAccounts,
} from './collections-client'
import { planStartPageLaunch } from './start-page-launch'
import {
  resolveHomeV2AppsAppUrl,
  resolveHomeV2BookmarksAppUrl,
} from './qdn-settings-client'
import { locateBookmarkManagerLink } from '../bookmarkManager'
import { internalTabLabelKeys } from '../v2/shell/TabStrip'
import { t } from '../i18n'
import {
  buildAdjacentDashboardPinMoveMutation,
  buildDashboardPinMoveMutation,
  HOME_V2_DEFAULT_DASHBOARD_PIN_DRAFTS,
  shouldSeedHomeV2DefaultDashboardPins,
  type DashboardPinMoveDirection,
} from './dashboard-pins'
import {
  getQdnResourceStreamProxyMimeType,
  getQdnResourceStreamRequest,
  getQdnResourceViewerRequest,
} from '../../electron/qdn-resource-viewer-contract'
import type { QdnAppRequest } from '../../electron/qdn-request-values'
import {
  validateBookmarkManagerMutationRequest,
  validateBookmarksOpenRequest,
  type BookmarkManagerDashboardPin,
  type BookmarkManagerLink,
  type BookmarkManagerMutation,
  type BookmarkManagerSnapshot,
} from '../../electron/bookmark-manager-contract'
import type { BookmarkToolbarVisibility } from '../bookmarkToolbar'
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
import { isHomeV2MintingWriteAction } from '../../electron/home-v2-minting'
import { persistDurableGrantAsync } from '../../electron/durable-grant-persistence'
import { createHomeV2SendRateLimiter } from '../../electron/home-v2-send-rate-limiter'
import {
  homeV2AccountReadAlwaysAllowDetail,
  homeV2AccountReadPermissionDetails,
  homeV2AccountReadPermissionSummary,
  homeV2AccountReadPromptKind,
  homeV2AccountReadPromptSummary,
  homeV2AccountReadPromptTitle,
  createHomeV2SessionGrantStore,
  homeV2DurableAccountReadCapability,
  homeV2PermissionGrantKey,
  homeV2PermissionGrantFamily,
  isHomeV2AccountReadAction,
  isHomeV2ChatSendAction,
  isHomeV2PermissionlessAction,
} from '../../electron/home-v2-session-grants'
import { getHomeV2BridgeStateDetails } from '../../electron/home-v2-app-runtime'
import { canonicalHomeV2AppAction } from '../../electron/home-v2-app-actions'
import {
  homeV2NotificationChainLabel,
  homeV2NotificationSourceKey,
  normalizeHomeV2NotificationRequest,
} from '../../electron/home-v2-notification-contract'
import {
  createHomeV2PendingTransactionFromResult,
  isHomeV2JournaledMutation,
  normalizeHomeV2ForgetPendingTransactionRequest,
  toHomeV2PendingTransactionResult,
} from '../../electron/home-v2-transaction-journal'
import {
  findAndroidHomeV2PendingTransactionConflict,
  forgetAndroidHomeV2PendingTransaction,
  listAndroidHomeV2PendingTransactions,
  recordAndroidHomeV2PendingTransaction,
} from './transaction-journal-store'
import { sanitizeQdnManagerAppKey } from '../../electron/qdn-manager-permissions'
import {
  getNotificationStore,
  grantAppNotifications,
  inspectNotificationStoreForManagement,
  onNotificationStoreChanged,
  readNotificationStoreForManagement,
  revokeAppNotifications,
  setAppNotificationMuted,
  updateNotificationStore,
} from '../notificationStore'
import {
  isHomeV2NotificationManagerAction,
  parseHomeV2NotificationManagerRequest,
  readHomeV2NotificationManagerSummary,
  resolveHomeV2NotificationManagerMutation,
  summarizeHomeV2NotificationManagerStore,
} from '../../electron/home-v2-notification-manager-contract'
import {
  grantQdnManagerPermission,
  grantQdnAccountCapabilityPermission,
  grantQdnAppCapabilityPermission,
  getQdnAppRolesStore,
  hasQdnAccountCapability,
  hasQdnAppCapability,
  hasQdnManagerPermission,
  onQdnManagerPermissionsChanged,
  revokeQdnAccountCapabilityPermission,
  revokeQdnAppCapabilityPermission,
  setQdnAppAssignmentValue,
} from '../qdnManagerPermissions'
import {
  createPortableHomeV2QdnSettingsAdapter,
  resolveHomeV2QdnSettingsManagement,
} from './qdn-settings-client'
import { createAndroidHomeV2NotificationPolicyClient } from './android-notification-policy-client'
import {
  failedClosedHomeV2NotificationPolicyState,
  resolveHomeV2NotificationPolicyClient,
  type HomeV2NotificationPolicyState,
} from './notification-policy-client'
import {
  resolveHomeV2WindowBehaviorClient,
  type HomeV2WindowBehaviorChange,
  type HomeV2WindowBehaviorState,
} from './window-behavior-client'
import { resolveDualIdentity } from './identity-resolver'
import { completeUnlockAfterAccountStatePropagation } from './unlock-account-state'
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
import {
  normalizeHomeV2PublicPublishRequest,
  sha256Hex,
} from '../../electron/home-v2-public-publish-contract'
import type { HomeV2PublishSourceBinding } from '../../electron/home-v2-publish-source-tokens'
import {
  normalizeHomeV2PrivateAttachmentAccessRequest,
  normalizeHomeV2PrivateAttachmentPublishRequest,
} from '../../electron/home-v2-private-attachment-contract'
import {
  isQortalHubCompatiblePrivateImageMediaType,
  sniffPrivateChatAttachmentMediaType,
} from '../../electron/home-v2-private-attachment-actions'
import {
  decodeHomeV2AndroidPublishSource,
  homeV2AndroidPublishSources,
  selectHomeV2AndroidPublishSource,
} from './public-publish-source'
import {
  dismissedHomeV2ContextMenuResult,
  getHomeV2ContextMenuItems,
  getHomeV2ContextMenuOperation,
  handledHomeV2ContextMenuResult,
  normalizeHomeV2ContextMenuRequest,
  type HomeV2ContextMenuActionId,
  type HomeV2ContextMenuResult,
  type HomeV2ContextMenuTarget,
} from '../../electron/home-v2-context-menu'
import { writeContextMenuClipboard } from '../contextMenuClipboard'

function brand<Type extends string>(value: string): Type {
  return value as Type
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

type HomeV2ReplaceTabTarget = ReplaceTabTarget

/**
 * Throwing form of findReplaceableAppTab, for the OPEN_CURRENT_TAB path.
 *
 * Called before the async resource discovery and again after it, because both
 * the tab and what it is showing can change while that await is outstanding.
 * The reducer runs the same comparison a third time at the write itself; this
 * exists so the common races produce a clear message to the app instead of a
 * ProductModelError surfacing at render.
 */
function assertHomeV2ReplaceableTab(
  state: ProductState,
  target: HomeV2ReplaceTabTarget,
): AppTab {
  const tab = findReplaceableAppTab(state, target)
  if (!tab) {
    throw new Error('That app tab is no longer showing the app that asked to replace it.')
  }
  return tab
}

function getContextMenuTargetLabel(target: HomeV2ContextMenuTarget) {
  if (target.kind === 'account') return target.name ?? target.address
  if (target.kind === 'group') return target.name ?? `Group ${target.groupId}`
  return `${target.service}/${target.name}`
}

function getSavedResourceContextMenuTarget(
  displayUrl: string,
): HomeV2ContextMenuTarget | null {
  const protocol: HomeV2AppBridgeProtocol | null = displayUrl.toLowerCase().startsWith('qortal://')
    ? 'qortalRequest'
    : displayUrl.toLowerCase().startsWith('qdn://')
      ? 'qdnRequest'
      : null
  if (!protocol) return null
  try {
    return normalizeHomeV2ContextMenuRequest(protocol, {
      version: 1,
      target: { kind: 'resource', address: displayUrl },
    }).target
  } catch {
    return null
  }
}

function getDashboardPinContextMenuTarget(
  pin: BookmarkManagerDashboardPin,
): HomeV2ContextMenuTarget | null {
  return getSavedResourceContextMenuTarget(pin.displayUrl)
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
const ANDROID_CONTEXT_MENU_TIMEOUT_MS = 60_000
const MAX_PENDING_ANDROID_PERMISSION_PROMPTS_PER_APP = 3
const MAX_PENDING_ANDROID_PERMISSION_PROMPTS_GLOBAL = 20
const HOME_V2_NOTIFICATION_MIN_INTERVAL_MS = 3_000

function initialSnapshot(): Omit<HomeV2Snapshot, 'nodes'> {
  const systemTheme =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  const resolvedTheme =
    defaultHomeV2Appearance.theme === 'system'
      ? systemTheme
      : defaultHomeV2Appearance.theme
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
          detail: null,
        },
        qortium: {
          network: 'qortium',
          state: 'unavailable',
          address: null,
          names: [],
          primaryName: null,
          avatar: null,
          detail: null,
        },
      },
    },
    apps: [],
    recentItems: [],
    reticulum: {
      state: 'disabled',
      enabled: false,
      statusText: 'Disabled',
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

function parseHomeV2ResourceViewerState(value: unknown): HomeV2ResourceViewerState | null {
  if (
    !isRecord(value) ||
    (value.network !== 'qortal' && value.network !== 'qortium') ||
    typeof value.service !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.sourceTabId !== 'string' ||
    typeof value.streamUrl !== 'string'
  ) {
    return null
  }
  let streamUrl: URL
  try {
    streamUrl = new URL(value.streamUrl)
  } catch {
    return null
  }
  if (
    streamUrl.protocol !== 'http:' &&
    streamUrl.protocol !== 'https:' &&
    streamUrl.protocol !== 'qortium-home-resource:'
  ) return null
  const nullable = (field: unknown) => typeof field === 'string' && field ? field : null
  return {
    filename: nullable(value.filename),
    identifier: nullable(value.identifier),
    mimeType: nullable(value.mimeType),
    name: value.name,
    network: value.network,
    path: nullable(value.path),
    service: value.service.toUpperCase(),
    sourceTabId: value.sourceTabId,
    streamUrl: streamUrl.toString(),
  }
}

/**
 * Writes a durable "always allow" grant on the portable/Android host and
 * confirms it is actually held.
 *
 * Mirrors persistDurableGrant in electron/home-v2-app-bridge.ts. Returns false
 * both when the write throws and when it silently persists nothing (a
 * principal the capability store's own sanitizer discards on read-back), so
 * every caller can fall back to the narrower session grant rather than
 * denying a request the user already approved or believing in a grant that
 * does not exist.
 */
function persistDurableChatSendGrant(appPrincipal: string): Promise<boolean> {
  return persistDurableGrantAsync({
    capability: 'chat.send',
    isHeld: () => hasQdnAppCapability(appPrincipal, 'chat.send'),
    // .then-discard rather than await: the foundation test pins that no
    // `await grantQdn...` call exists in this file, so prompt sites cannot
    // bypass the verifying helper; this helper is the one legitimate writer.
    write: () => grantQdnAppCapabilityPermission(appPrincipal, 'chat.send').then(() => undefined),
  })
}

function persistDurableAccountReadGrant(
  appPrincipal: string,
  accountId: string,
  capability: 'account.read',
): Promise<boolean> {
  return persistDurableGrantAsync({
    capability,
    isHeld: () => hasQdnAccountCapability(appPrincipal, accountId, capability),
    write: () =>
      grantQdnAccountCapabilityPermission(appPrincipal, accountId, capability).then(
        () => undefined,
      ),
  })
}

export function HomeV2LiveApp() {
  const isAndroidHost = useRef(!window.homeV2Nodes).current
  const collectionsClient = useRef(new HomeV2CollectionsClient()).current
  const notificationPolicyClient = useMemo(
    () =>
      Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
        ? createAndroidHomeV2NotificationPolicyClient()
        : resolveHomeV2NotificationPolicyClient(),
    [],
  )
  // Desktop only: null on Android and in the browser preview, which is what
  // keeps the Window settings group off those hosts entirely.
  const windowBehaviorClient = useMemo(() => resolveHomeV2WindowBehaviorClient(), [])
  // Durable account.read grants are stored per selected account, so QDN Apps
  // settings has to say which account each one covers. An id that no longer
  // resolves (a wallet removed from this device) falls back to a shortened
  // address in the settings component rather than disappearing.
  const resolveGrantAccountLabel = useCallback((accountId: string) => {
    const account = accountCatalogueRef.current.accounts
      .find((candidate) => candidate.id === accountId)
    return account?.label ?? null
  }, [])

  const qdnAppsManagement = useMemo(() => {
    const isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
    if (!isNativeAndroid) return resolveHomeV2QdnSettingsManagement()
    return resolveHomeV2QdnSettingsManagement(
      createPortableHomeV2QdnSettingsAdapter({
        readAssignments: getQdnAppRolesStore,
        readNotifications: readNotificationStoreForManagement,
        classifyNotificationReadError(error) {
          return (error as { code?: unknown })?.code === 'HOME_NOTIFICATION_STORE_CORRUPT'
            ? 'corrupt'
            : 'unavailable'
        },
        revokeNotifications: revokeAppNotifications,
        revokeBookmarks(appKey, expectedRevision, capability, accountId) {
          // account.read is stored per (principal, account), so it revokes
          // through the account-scoped store. Everything else keeps its
          // app-scoped keying.
          if (capability === 'account.read') {
            if (!accountId) {
              return Promise.reject(new Error(
                'Revoking read-only account access requires the account it was granted for.',
              ))
            }
            return revokeQdnAccountCapabilityPermission(
              appKey,
              accountId,
              'account.read',
              expectedRevision,
            )
          }
          return revokeQdnAppCapabilityPermission(
            appKey,
            capability ?? 'bookmarks.manage',
            expectedRevision,
          )
        },
        setAssignment: setQdnAppAssignmentValue,
        setMuted: setAppNotificationMuted,
        subscribeAssignments(listener) {
          return onQdnManagerPermissionsChanged(() => listener())
        },
        subscribeNotifications(listener) {
          return onNotificationStoreChanged(() => listener())
        },
      }),
    )
  }, [isAndroidHost])
  const [productState, dispatchProduct] = useReducer(
    reduceProductState,
    undefined,
    createProductState,
  )
  const [newTabPreference, setNewTabPreference] =
    useState<NewTabPreference>(DEFAULT_NEW_TAB_PREFERENCE)
  const [releaseNotesTarget, setReleaseNotesTarget] =
    useState<HomeV2ReleaseNotesTarget | null>(null)
  const [coreDocsNetwork, setCoreDocsNetwork] = useState<NetworkId | null>(null)
  const [onboarding, setOnboarding] = useState<HomeV2OnboardingState>(
    createHomeV2OnboardingState,
  )
  const [notificationPolicy, setNotificationPolicy] =
    useState<HomeV2NotificationPolicyState | null>(null)
  const notificationPolicyRef = useRef<HomeV2NotificationPolicyState | null>(null)
  notificationPolicyRef.current = notificationPolicy
  const [windowBehavior, setWindowBehavior] =
    useState<HomeV2WindowBehaviorState | null>(null)
  // Live mirror of productState so long-running async work (e.g. the chat-send
  // context recheck that spans a tens-of-seconds memory-pow) sees the CURRENT
  // tab set, not the snapshot captured when the request started. Without this
  // a tab closed mid-PoW stays invisible to the recheck (FIX #2, review 2).
  const productStateRef = useRef(productState)
  productStateRef.current = productState
  const androidLastNotificationAt = useRef(new Map<string, number>())
  const androidNextNotificationId = useRef((Date.now() % 2_000_000_000) + 1)
  const [snapshotState, setSnapshot] = useState(initialSnapshot)
  const [customNetwork, setCustomNetwork] = useState<NetworkId | null>(null)
  const [customUrl, setCustomUrl] = useState('')
  const [customApiKey, setCustomApiKey] = useState('')
  const [removeCustomApiKey, setRemoveCustomApiKey] = useState(false)
  const [coreUpdateAuthorityRevision, setCoreUpdateAuthorityRevision] = useState(0)
  const [customError, setCustomError] = useState<string | null>(null)
  const [identityInput, setIdentityInput] = useState('')
  const [identityLookup, setIdentityLookup] =
    useState<DualIdentityLookupResult | null>(null)
  const [identityLookupBusy, setIdentityLookupBusy] = useState(false)
  const [identityLookupError, setIdentityLookupError] = useState<string | null>(null)
  const [shellNotice, setShellNotice] = useState<string | null>(null)
  const [collectionsSnapshot, setCollectionsSnapshot] =
    useState<BookmarkManagerSnapshot | null>(null)
  const [dashboardPinsPhase, setDashboardPinsPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [dashboardPinsError, setDashboardPinsError] = useState<string | null>(null)
  const [dashboardPinsBusy, setDashboardPinsBusy] = useState(false)
  const [freshShellProfile, setFreshShellProfile] = useState<boolean | null>(null)
  const dashboardPinSeedDecisionMade = useRef(false)
  const [resourceViewer, setResourceViewer] = useState<HomeV2ResourceViewerState | null>(null)
  const [androidContextMenu, setAndroidContextMenu] = useState<{
    readonly id: string
    readonly tabId: string
    readonly target: HomeV2ContextMenuTarget
  } | null>(null)
  const androidContextMenuResolver = useRef<{
    readonly id: string
    readonly network: NetworkId
    readonly reject: (reason: unknown) => void
    readonly resolve: (result: HomeV2ContextMenuResult) => void
    readonly resourceLocation: string
    readonly tabId: string
    readonly timeout: number
  } | null>(null)
  const [accountDialog, setAccountDialog] = useState<{
    mode: AccountDialogMode
    accountId?: string
    // Deriving a new address needs the seed, so a locked account unlocks
    // first and the add runs once that succeeds — matching Home 1.x, which
    // never dead-ended the control just because the account was locked.
    afterUnlock?: 'add-address'
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
  const nodeCoreController = useHomeV2NodeCoreController({
    coreClient: window.homeV2CoreManagers ?? null,
    nodeClient,
  })
  const onChainCoreUpdates = useHomeV2OnChainCoreUpdates(nodeClient, {
    authenticated: nodeCoreController.nodes.qortium.customAuthenticated,
    authorityRevision: coreUpdateAuthorityRevision,
    available: isAndroidHost,
  })
  const appUpdates = useHomeV2AppUpdates()
  const snapshot = useMemo<HomeV2Snapshot>(
    () => ({ ...snapshotState, nodes: nodeCoreController.nodes }),
    [nodeCoreController.nodes, snapshotState],
  )
  const refreshCoreStatuses = useCallback(() => {
    void nodeCoreController.refreshCoreStatuses()
  }, [nodeCoreController])
  // The app's one instance of each maintenance controller. The dashboard tile
  // and the toolbar node menus take the trimmed `HomeV2CoreManagement` slices
  // built below; the Settings and Welcome panels take these controllers whole,
  // through `maintenance`, because they render what the tile leaves out (Qortal
  // adoption, the automatic-update-policy selects). Nothing else may call these
  // hooks: a second instance polls a second time and keeps its own busy/notice
  // state, which is exactly the split the tile and the panels used to have.
  //
  // The price is that the three 30s polls run for the app's lifetime rather
  // than only while a Settings panel is open — one invoke per domain per 30s,
  // all local IPC — and owning them here keeps HomeV2Prototype renderable from
  // a fixture with no bridge at all.
  const coreMaintenance = useHomeV2CoreMaintenance({
    onCoreRefresh: refreshCoreStatuses,
    qortalEnabled: nodeCoreController.nodes.qortal.mode !== 'disabled',
    qortiumEnabled: nodeCoreController.nodes.qortium.mode !== 'disabled',
  })
  const qortalMaintenance = useHomeV2QortalMaintenance(refreshCoreStatuses)
  const transportMaintenance = useHomeV2TransportMaintenance(refreshCoreStatuses)
  const [vaultClient, setVaultClient] = useState<HomeV2VaultClient | null>(
    () => window.homeV2Vault ?? null,
  )
  // A window opened by dragging a tab out. Its tab strip is deliberately
  // session-only: it must not restore the primary window's tabs, and must not
  // save over them. `null` while the answer is still being fetched.
  const [detachedAddress, setDetachedAddress] = useState<string | null>(null)
  const [windowRoleReady, setWindowRoleReady] = useState(false)
  const isDetachedWindow = useRef(false)
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
  // Which account the current `selectedAccountLookup` describes. Read
  // synchronously by selectAccount, which cannot see the state value it is
  // about to replace.
  const selectedAccountLookupIdRef = useRef<string | null>(null)
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
    { appIdentityKey: string; network: NetworkId; semanticKey: string; tabId: string }
  >())

  useEffect(() => {
    if (!notificationPolicyClient) return
    let disposed = false
    const failClosed = () => {
      if (disposed) return
      const next = failedClosedHomeV2NotificationPolicyState('unavailable')
      notificationPolicyRef.current = next
      setNotificationPolicy(next)
    }
    const refresh = async () => {
      const next = await notificationPolicyClient.get()
      if (disposed) return
      notificationPolicyRef.current = next
      setNotificationPolicy(next)
    }
    void refresh().catch(failClosed)
    const unsubscribe = notificationPolicyClient.subscribe(() => {
      void refresh().catch(failClosed)
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [notificationPolicyClient])

  useEffect(() => {
    if (!windowBehaviorClient) return
    let disposed = false
    void windowBehaviorClient
      .get()
      .then((behavior) => {
        if (!disposed) setWindowBehavior(behavior)
      })
      // Left null, which renders the group as unavailable rather than showing
      // toggles whose position would be a guess.
      .catch(() => undefined)
    return () => {
      disposed = true
    }
  }, [windowBehaviorClient])

  // Main returns the settings as they now stand, so the reply is the new
  // state rather than something to reconstruct. A failure rethrows and leaves
  // the displayed value alone, so the row can report it.
  const changeWindowBehavior = useCallback(
    async (change: HomeV2WindowBehaviorChange) => {
      if (!windowBehaviorClient) {
        throw new Error('Window settings are unavailable on this platform.')
      }
      setWindowBehavior(await windowBehaviorClient.set(change))
    },
    [windowBehaviorClient],
  )

  const setGlobalAppNotifications = useCallback(
    async (enabled: boolean) => {
      const current = notificationPolicyRef.current
      if (
        !notificationPolicyClient ||
        !current ||
        current.status !== 'available' ||
        current.generation === null
      ) {
        throw new Error('Notification policy is unavailable.')
      }
      try {
        const next = await notificationPolicyClient.set({
          enabled,
          expectedGeneration: current.generation,
        })
        notificationPolicyRef.current = next
        setNotificationPolicy(next)
      } catch (error) {
        const refreshed = await notificationPolicyClient.get().catch(() =>
          failedClosedHomeV2NotificationPolicyState('unavailable'))
        notificationPolicyRef.current = refreshed
        setNotificationPolicy(refreshed)
        throw error
      }
    },
    [notificationPolicyClient],
  )
  const androidUnlockResolvers = useRef(new Map<
    string,
    {
      complete: (state: HomeV2VaultState) => Promise<void>
      reject: (error: Error) => void
    }
  >())
  const androidSessionAccountGrants = useRef(createHomeV2SessionGrantStore())
  const androidPendingSessionGrantDecisions = useRef(
    new Map<string, Promise<PermissionDecision>>(),
  )
  // Fix B (security review finding 8): bounds how often an already-granted
  // tab can broadcast chat sends. Shares its constants/algorithm with
  // desktop's electron/home-v2-app-bridge.ts via home-v2-send-rate-limiter.ts.
  const androidChatSendRateLimiter = useRef(createHomeV2SendRateLimiter())
  const androidNavigationControllers = useRef(
    new Map<string, AppTabNavigationController>(),
  )
  const tabSequence = useRef(0)
  const accountRuntimeFingerprint = useRef<string | null>(null)
  const nodeRuntimeFingerprint = useRef<Readonly<Record<NetworkId, string>> | null>(null)

  const invalidateAndroidRuntime = useCallback((
    kind: 'account-changed' | 'app-replaced' | 'locked' | 'navigation-changed' | 'node-changed' | 'tab-closed',
    tabId: string | null = null,
    network: NetworkId | null = null,
  ) => {
    setPermissionState((current) => {
      if (kind === 'account-changed') return createPermissionState()
      if (kind === 'navigation-changed' || kind === 'tab-closed' || kind === 'app-replaced') {
        return invalidatePermissionState(current, {
          kind,
          tabId: brand<TabId>(tabId!),
        })
      }
      if (kind === 'node-changed' && network) {
        return invalidatePermissionState(current, { kind, network })
      }
      return invalidatePermissionState(current, { kind: 'locked' })
    })
    if (!isAndroidHost) return
    androidSessionAccountGrants.current.invalidate('android', { kind, network, tabId })
    if (kind === 'account-changed' || kind === 'locked') {
      androidChatSendRateLimiter.current.reset()
    }
    homeV2AndroidPublishSources.clear()
    void import('./android-app-host')
      .then(({ releaseHomeV2AndroidResourceStreams }) => releaseHomeV2AndroidResourceStreams())
      .catch(() => undefined)
    const pendingContextMenu = androidContextMenuResolver.current
    if (
      pendingContextMenu &&
      (!tabId || pendingContextMenu.tabId === tabId) &&
      (!network || pendingContextMenu.network === network)
    ) {
      androidContextMenuResolver.current = null
      window.clearTimeout(pendingContextMenu.timeout)
      setAndroidContextMenu(null)
      pendingContextMenu.resolve(dismissedHomeV2ContextMenuResult())
    }
    for (const [requestId, meta] of androidPendingPermissionMeta.current) {
      if (tabId && meta.tabId !== tabId) continue
      if (network && meta.network !== network) continue
      androidPendingPermissionMeta.current.delete(requestId)
      const resolver = androidPermissionResolvers.current.get(requestId)
      if (!resolver) continue
      androidPermissionResolvers.current.delete(requestId)
      window.clearTimeout(resolver.timeout)
      resolver.resolve({ approved: false })
    }
  }, [isAndroidHost])

  useEffect(() => {
    if (!isAndroidHost) return
    return () => {
      const pending = androidContextMenuResolver.current
      if (!pending) return
      androidContextMenuResolver.current = null
      window.clearTimeout(pending.timeout)
      pending.resolve(dismissedHomeV2ContextMenuResult())
    }
  }, [isAndroidHost])

  useEffect(() => {
    const fingerprint = selectedAccountId ?? 'none'
    const previous = accountRuntimeFingerprint.current
    accountRuntimeFingerprint.current = fingerprint
    if (previous === null || previous === fingerprint) return
    invalidateAndroidRuntime('account-changed')
    window.homeV2Apps?.invalidateRuntime({ kind: 'account-changed' })
  }, [
    invalidateAndroidRuntime,
    selectedAccountId,
  ])

  useEffect(() => {
    const fingerprint: Readonly<Record<NetworkId, string>> = {
      qortal: JSON.stringify([snapshot.nodes.qortal.mode, snapshot.nodes.qortal.nodeApiUrl]),
      qortium: JSON.stringify([snapshot.nodes.qortium.mode, snapshot.nodes.qortium.nodeApiUrl]),
    }
    const previous = nodeRuntimeFingerprint.current
    nodeRuntimeFingerprint.current = fingerprint
    if (previous === null) return
    for (const network of ['qortal', 'qortium'] as const) {
      if (previous[network] === fingerprint[network]) continue
      invalidateAndroidRuntime('node-changed', null, network)
      window.homeV2Apps?.invalidateRuntime({ kind: 'node-changed', network })
    }
  }, [
    invalidateAndroidRuntime,
    snapshot.nodes.qortal.mode,
    snapshot.nodes.qortal.nodeApiUrl,
    snapshot.nodes.qortium.mode,
    snapshot.nodes.qortium.nodeApiUrl,
  ])

  useEffect(() => {
    const bridge = window.homeV2Apps
    if (!bridge) return
    void bridge.syncWidgets({
      bridgeStates: getHomeV2BridgeStateDetails({
        accountId: selectedAccountId,
        nodes: snapshot.nodes,
        platform: 'desktop',
      }),
      displaySettings: {
        accent: snapshot.appearance.accent,
        language: snapshot.appearance.resolvedLanguage,
        textSize: snapshot.appearance.textSize,
        theme: snapshot.appearance.resolvedTheme,
        ui: snapshot.appearance.ui,
      },
    }).catch((error: unknown) => {
      console.warn('Unable to update live widget state.', error)
    })
  }, [
    selectedAccountId,
    snapshot.appearance.accent,
    snapshot.appearance.resolvedLanguage,
    snapshot.appearance.resolvedTheme,
    snapshot.appearance.textSize,
    snapshot.appearance.ui,
    snapshot.nodes,
  ])

  // Home-profile manager revisions delivered to open app views.
  //
  // Home 1.x announced these; Home 2 shipped the delivery machinery in
  // qdn-views.ts but never wired a producer, so an app that had just changed a
  // notification rule — its own, or another app's through the new manager
  // surface — was never told the profile had moved on, and kept CASing against
  // a stale revision. The notification store's change broadcast (which trusted
  // Settings already listens to) is the trigger; open app views are the second
  // audience for it.
  const [notificationManagerRevision, setNotificationManagerRevision] = useState(0)
  useEffect(() => {
    const client = qdnAppsManagement.client
    if (!client) return
    let cancelled = false
    const read = () => {
      void client.get().then((state) => {
        if (cancelled) return
        // A corrupt or unavailable store reports no revision. Hold the last
        // known value rather than announcing a fabricated 0, which would make
        // every open app think the profile had been reset.
        if (state.notifications.status !== 'available') return
        if (state.notifications.revision === null) return
        setNotificationManagerRevision(state.notifications.revision)
      }).catch(() => {
        // Read failures are not fatal here: the app view simply keeps the
        // revision it already has and re-reads on its next request.
      })
    }
    read()
    const unsubscribe = client.subscribe(read)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [qdnAppsManagement])

  const managerRevisions = useMemo(() => ({
    bookmarkManager: collectionsSnapshot?.revision ?? 0,
    notificationManager: notificationManagerRevision,
  }), [collectionsSnapshot?.revision, notificationManagerRevision])

  useEffect(() => {
    const bridge = window.homeV2Apps
    if (!bridge) return
    for (const tab of productState.tabs) {
      void bridge.updateManagerRevisions?.({
        managerRevisions,
        tabId: tab.id,
      })?.catch((error: unknown) => {
        console.warn('Unable to announce Home data manager revisions.', error)
      })
    }
  }, [managerRevisions, productState.tabs])

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
      // This event is same-app history/hash navigation. The native view blocks
      // cross-resource navigation before it reaches this callback, so changing
      // Chat routes must not revoke the tab's account-read consent.
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
  const loadVisibleAppIcon = useMemo(
    () => (nodeClient ? createHomeV2AppIconLoader(nodeClient) : undefined),
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
      // selectAccount runs for a re-selection of the SAME account far more often
      // than for a real switch (unlock, relaunch, catalogue refresh, restore).
      // In that case the answer being fetched is the answer already on screen,
      // so keep it and let the resolution below replace it — clearing dropped
      // the chrome avatar and name to a monogram for two uncached round-trips.
      //
      // A switch to a DIFFERENT account (or to none) must still clear: keeping
      // it there would label the new account with the previous account's name
      // and avatar until the lookup lands, which is worse than a monogram.
      if (accountId === null || accountId !== selectedAccountLookupIdRef.current) {
        selectedAccountLookupIdRef.current = null
        setSelectedAccountLookup(null)
      }
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
      selectedAccountLookupIdRef.current = result ? accountId : null
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
        nodeCoreController.markNodesUnavailable(error)
      })
    return () => {
      cancelled = true
    }
  }, [nodeClient, nodeCoreController.markNodesUnavailable])

  // Asked once, before any shell state is restored, because the answer decides
  // whether this window restores tabs at all.
  useEffect(() => {
    let cancelled = false
    const windows = window.homeV2Windows
    if (!windows) {
      setWindowRoleReady(true)
      return () => {
        cancelled = true
      }
    }
    void windows
      .getStartup()
      .then((startup) => {
        if (cancelled) return
        isDetachedWindow.current = !!startup
        setDetachedAddress(startup?.address ?? null)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setWindowRoleReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!nodeClient || !windowRoleReady) return
    let cancelled = false
    void nodeClient
      .getShellState()
      .then(async (rawState) => {
        if (cancelled) return
        const isFreshShell = rawState === null || rawState === undefined
        if (isFreshShell) {
          await collectionsClient.markFreshShellForDashboardDefaults()
        }
        if (cancelled) return
        setFreshShellProfile(isFreshShell)
        const restored = parseHomeV2ShellState(
          rawState,
          currentSystemTheme(),
          currentSystemLanguage(),
        )
        setSnapshot((current) => ({
          ...current,
          appearance: restored.appearance,
        }))
        // A detached window starts with only the tab it was dragged out with;
        // restoring here would duplicate the primary window's whole strip.
        if (!isDetachedWindow.current) {
          dispatchProduct({ type: 'restore', state: restored.product })
        }
        setNewTabPreference(restored.newTabPreference)
        setOnboarding(restored.onboarding)
        setRestoredAccountId(restored.selectedAccountId)
        setRestoredAddressId(restored.selectedAddressId)
        setUseCatalogueActiveAccount(rawState === null || rawState === undefined)
        setShellStateReady(true)
        if (restored.onboarding.status === 'in-progress') {
          dispatchProduct({ type: 'navigate', destination: 'welcome' })
        }
      })
      .catch(() => {
        if (!cancelled) {
          // A failed read is not proof of a fresh profile. Fail closed so an
          // existing user's intentionally empty pin list is never reseeded.
          setFreshShellProfile(false)
          setOnboarding(createHomeV2OnboardingState())
          setRestoredAccountId(null)
          setRestoredAddressId(null)
          setShellStateReady(true)
          dispatchProduct({ type: 'navigate', destination: 'welcome' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [collectionsClient, nodeClient, windowRoleReady])

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
      // saveShellGlobalState keeps whatever tab state is already stored, so a
      // detached window's session-only strip cannot destroy the primary
      // window's tabs. The merge happens in the main process.
      const save = isDetachedWindow.current
        ? nodeClient.saveShellGlobalState.bind(nodeClient)
        : nodeClient.saveShellState.bind(nodeClient)
      void save(
        serializeHomeV2ShellState({
          version: 3,
          appearance: snapshot.appearance,
          newTabPreference,
          onboarding,
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
    newTabPreference,
    onboarding,
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

  useEffect(() => {
    if (!isAndroidHost) return
    let disposed = false
    let removeListener: (() => Promise<void>) | null = null
    void import('@capacitor/local-notifications').then(async ({ LocalNotifications }) => {
      const handle = await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
        const extra = isRecord(event.notification.extra) ? event.notification.extra : null
        if (!extra || typeof extra.homeV2TabId !== 'string') return
        const tabId = brand<TabId>(extra.homeV2TabId)
        if (!productStateRef.current.tabs.some((tab) => tab.id === tabId)) return
        dispatchProduct({ type: 'activate-tab', tabId })
      })
      if (disposed) {
        await handle.remove()
        return
      }
      removeListener = () => handle.remove()
    }).catch(() => undefined)
    return () => {
      disposed = true
      void removeListener?.()
    }
  }, [isAndroidHost])

  const updateAppearance = useCallback(
    (patch: Partial<HomeV2Snapshot['appearance']>) =>
      setSnapshot((current) => ({
        ...current,
        appearance: { ...current.appearance, ...patch },
      })),
    [],
  )
  const menuTextSize = useRef(snapshotState.appearance.textSize)
  menuTextSize.current = snapshotState.appearance.textSize
  // Session-only stack of recently closed app-tab locations (newest last),
  // consumed by the reopen-closed-tab menu command.
  const closedAppTabs = useRef<string[]>([])
  // Navigation handlers live late in the render scope; the menu subscription
  // reads them through this ref so it can stay mounted once.
  const menuNavigation = useRef<{
    goBack: () => void
    goForward: () => void
    reload: () => void
    reopenClosedTab: () => void
  } | null>(null)
  useEffect(() => {
    return subscribeHomeV2MenuCommands((command) => {
      const textSize = parseHomeV2TextSizeCommand(command)
      if (textSize) {
        const next =
          textSize === 'text-size-reset'
            ? 'medium'
            : stepHomeV2TextSize(
                menuTextSize.current,
                textSize === 'text-size-increase' ? 'increase' : 'decrease',
              )
        menuTextSize.current = next
        updateAppearance({ textSize: next })
        return
      }
      const navigation = menuNavigation.current
      if (!navigation) return
      if (command === 'go-back') navigation.goBack()
      else if (command === 'go-forward') navigation.goForward()
      else if (command === 'reload-tab') navigation.reload()
      else if (command === 'reopen-closed-tab') navigation.reopenClosedTab()
    })
  }, [updateAppearance])
  useEffect(() => {
    // Keyboard (Ctrl +/-) and Ctrl+wheel zoom are applied by the main process.
    // Mirror the result into the appearance setting so the Appearance slider
    // and the actual window zoom cannot drift apart.
    return subscribeHomeV2WindowZoom((percent) => {
      updateAppearance({ appZoom: clampHomeV2AppZoom(percent) })
    })
  }, [updateAppearance])
  useEffect(() => {
    // The main process forwards mouse back/forward app-commands only while
    // focus is outside the shell renderer, so the focused case lands here.
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return
      const navigation = menuNavigation.current
      if (!navigation) return
      event.preventDefault()
      if (event.button === 3) navigation.goBack()
      else navigation.goForward()
    }
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [])

  const openApp = useCallback(
    (
      app: AppDescriptor,
      requestedLocation?: AppTabContext['resourceLocation'],
      requestedAccountId?: string | null,
    ) => {
      setShellNotice(null)
      const requestedAccount = requestedAccountId
        ? accountCatalogueRef.current.accounts.find((account) => account.id === requestedAccountId)
        : null
      if (requestedAccountId && !requestedAccount) {
        throw new Error('The saved Home account is no longer available.')
      }
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
          identityId: requestedAccount
            ? brand<IdentityId>(`home-v2:identity:${requestedAccount.id}`)
            : snapshot.identity.id,
          resourceLocation:
            requestedLocation ??
            buildAppResourceLocation(app.sourceNetwork, app.resourceIdentity),
          sourceNetwork: app.sourceNetwork,
          tabId,
          walletRef: requestedAccount
            ? brand<WalletRef>(`home-v2:wallet:${requestedAccount.walletId}`)
            : snapshot.identity.selectedWallet,
        },
      })
    },
    [snapshot.identity.id, snapshot.identity.selectedWallet],
  )

  // The in-place twin of openApp, behind OPEN_CURRENT_TAB. The tab id always
  // comes from the trusted host's view context, never from the app: see the
  // OPEN_CURRENT_TAB handler in electron/home-v2-app-bridge.ts and the
  // replace-tab-app reducer, which refuses anything that is not an app tab.
  //
  // The tab KEEPS its existing identity and wallet binding rather than picking
  // up whatever account is selected right now. That is not a convenience: on
  // desktop the native view's account is pinned when the view is created and a
  // re-show deliberately never rebinds it (getOrCreateEntry in
  // electron/qdn-views.ts), so choosing anything else here would leave the
  // shell showing one account while the bridge still answered for another.
  // OPEN_CURRENT_TAB therefore has no way to change accounts — it changes only
  // which app is loaded.
  const replaceTabWithApp = useCallback(
    (
      target: HomeV2ReplaceTabTarget,
      app: AppDescriptor,
      requestedLocation?: AppTabContext['resourceLocation'],
    ) => {
      const current = assertHomeV2ReplaceableTab(productStateRef.current, target)
      setShellNotice(null)
      dispatchProduct({
        type: 'replace-tab-app',
        app,
        tabId: target.tabId,
        // The compare half of the compare-and-swap. The reducer re-checks this
        // against the entry it is about to overwrite, so the check above and
        // the write below cannot be separated by anything.
        fromResourceLocation: target.fromResourceLocation,
        context: {
          appId: app.id,
          identityId: current.context.identityId,
          resourceLocation:
            requestedLocation ??
            buildAppResourceLocation(app.sourceNetwork, app.resourceIdentity),
          sourceNetwork: app.sourceNetwork,
          tabId: target.tabId,
          walletRef: current.context.walletRef,
        },
      })
      // The tab keeps its id but now hosts a DIFFERENT app, so every grant
      // bound to it must go — including account.read, which
      // 'navigation-changed' deliberately preserves for an app navigating
      // within itself. Using that kind here would have let the outgoing app's
      // private-read session grant survive, and revive if the tab were ever
      // navigated back to it. 'app-replaced' has 'tab-closed' grant semantics
      // without telling anything that the tab is going away.
      invalidateAndroidRuntime('app-replaced', target.tabId)
      window.homeV2Apps?.invalidateRuntime({ kind: 'app-replaced', tabId: target.tabId })
    },
    [invalidateAndroidRuntime],
  )

  // Whether an app has a widget face is only knowable from the manifest it
  // publishes on the node, and the shell renderer cannot reach the node, so
  // main answers it. The answer is cached per tab *and* resource - the same
  // key shape androidAppStageKey uses - because a tab pointed at a different
  // resource is a different question.
  const [widgetAvailability, setWidgetAvailability] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  )
  const widgetAvailabilityRef = useRef<ReadonlyMap<string, boolean>>(widgetAvailability)
  widgetAvailabilityRef.current = widgetAvailability
  const widgetProbesInFlight = useRef(new Set<string>())
  const widgetProbeRetries = useRef(new Set<string>())

  const probeWidgetAvailability = useCallback((tabId: string, key: string, retry = false) => {
    const bridge = window.homeV2Apps
    if (!bridge || typeof bridge.probeWidget !== 'function') return
    if (widgetProbesInFlight.current.has(key)) return
    if (widgetAvailabilityRef.current.has(key)) {
      // Asked once per tab+resource: the answer is a property of the published
      // resource, so re-asking on every in-app navigation would be a request
      // per hash change for no new information. The one exception is a single
      // retry of a "no" after the app view reports navigation, because a probe
      // that lands before main has a view for the tab answers "no" for a tab
      // whose app was simply not ready yet.
      if (!retry || widgetAvailabilityRef.current.get(key) !== false) return
      if (widgetProbeRetries.current.has(key)) return
      widgetProbeRetries.current.add(key)
    }
    widgetProbesInFlight.current.add(key)
    const record = (available: boolean) => {
      widgetProbesInFlight.current.delete(key)
      setWidgetAvailability((current) => {
        const next = new Map(current)
        next.set(key, available)
        return next
      })
    }
    void bridge
      .probeWidget({ tabId })
      .then((result) => record(result?.available === true))
      // A failed probe leaves the control visible rather than hiding it: the
      // click path already words the real error, and silently hiding it would
      // read as "this app has no widget".
      .catch(() => record(true))
  }, [])

  const activeWidgetTab =
    productState.tabs.find((tab) => tab.id === productState.activeTabId) ?? null
  const activeWidgetKey = activeWidgetTab
    ? `${activeWidgetTab.id}:${activeWidgetTab.context.resourceLocation}`
    : null

  useEffect(() => {
    if (!activeWidgetTab || !activeWidgetKey) return
    probeWidgetAvailability(activeWidgetTab.id, activeWidgetKey)
  }, [activeWidgetKey, activeWidgetTab, probeWidgetAvailability, widgetAvailability])

  // The app view reporting navigation is the earliest reliable sign that main
  // has a QDN view for that tab, so it is also when a probe that ran too early
  // gets its one retry.
  useEffect(() => {
    const bridge = window.homeV2Apps
    if (!bridge) return
    return bridge.onNavigationChanged((value) => {
      if (!isRecord(value) || typeof value.tabId !== 'string') return
      const tab = productStateRef.current.tabs.find((candidate) => candidate.id === value.tabId)
      if (!tab) return
      probeWidgetAvailability(tab.id, `${tab.id}:${tab.context.resourceLocation}`, true)
    })
  }, [probeWidgetAvailability])

  // Undefined while the probe is outstanding. The toolbar renders nothing in
  // that window rather than a button that may be about to disappear.
  const activeWidgetAvailable = activeWidgetKey ? widgetAvailability.get(activeWidgetKey) : undefined

  // The launch itself. The probe above only says the app has a widget face;
  // the grant, the one-per-resource limit and any manifest fault are answered
  // here, and the message is what the toolbar shows on the button.
  const openTabAsWidget = useCallback(async (tabId: string): Promise<string | null> => {
    const bridge = window.homeV2Apps
    if (!bridge) return 'Widgets are only available on desktop.'
    try {
      const result = await bridge.openAsWidget({ tabId })
      return result.ok ? null : result.message
    } catch (error) {
      return error instanceof Error ? error.message : 'This app could not be opened as a widget.'
    }
  }, [])

  const openAddress = useCallback(
    async (
      address: string,
      requestedAccountId?: string | null,
      // Set only by OPEN_CURRENT_TAB: replace this existing app tab's content
      // instead of opening another tab. Both fields come from the trusted
      // host's own view context for the requesting app — never from the
      // request — and together they are the compare half of a
      // compare-and-swap.
      replaceTarget?: HomeV2ReplaceTabTarget | null,
    ): Promise<AddressOpenResult> => {
      try {
        if (replaceTarget) {
          // The tab can close, or be replaced by someone else, between the
          // app's request and this handler. `tabs` holds APP tabs only, so
          // this also refuses an internal page's id. Fail here rather than in
          // the reducer: a reducer throw surfaces at render, and losing this
          // race is expected, not a bug. Re-checked after the await below and
          // once more by the reducer at the write.
          assertHomeV2ReplaceableTab(productStateRef.current, replaceTarget)
          // Home's own pages — settings, dashboard, welcome, Core docs,
          // release notes — are not app content and must never take over an
          // app tab, or an app could dress trusted Home chrome up as its own
          // surface. Refuse before anything is dispatched, so the requesting
          // tab is left exactly as it was.
          if (
            parseHomeV2CoreDocsAddress(address) ||
            parseHomeV2ReleaseNotesAddress(address) ||
            parseHomeV2InternalAddress(address)
          ) {
            throw new Error('Home pages cannot replace an app tab; open them in a new tab instead.')
          }
          // A bare app name can match more than one published resource. The
          // address bar answers that by asking the user to choose, but there
          // is nobody to ask on a bridge call, and reporting success while
          // doing nothing would be a lie. Require the app to say exactly which
          // resource it means; OPEN_NEW_TAB keeps the chooser.
          if (!parseAppResourceLocation(address).identifierWasExplicit) {
            throw new Error(
              'OPEN_CURRENT_TAB needs an explicit resource identifier: a bare app name can match more than one published resource. Use OPEN_NEW_TAB to let the user choose.',
            )
          }
        }
        const coreDocs = parseHomeV2CoreDocsAddress(address)
        if (coreDocs) {
          setShellNotice(null)
          setCoreDocsNetwork(coreDocs)
          dispatchProduct({ type: 'navigate', destination: 'core-docs' })
          return { status: 'opened' }
        }
        const releaseNotes = parseHomeV2ReleaseNotesAddress(address)
        if (releaseNotes) {
          setShellNotice(null)
          setReleaseNotesTarget(releaseNotes)
          dispatchProduct({ type: 'navigate', destination: 'releases' })
          return { status: 'opened' }
        }
        const internal = parseHomeV2InternalAddress(address)
        if (internal) {
          setShellNotice(null)
          if (internal === 'welcome') {
            setOnboarding(createHomeV2OnboardingState())
          }
          dispatchProduct({
            type: 'navigate',
            destination: internal,
          })
          return { status: 'opened' }
        }
        const parsed = parseAppResourceLocation(address)
        let resourceIdentity = parsed.identity
        let resourceLocation = parsed.location
        if (!parsed.identifierWasExplicit) {
          if (!nodeClient) throw new Error('App discovery is not available yet.')
          // R4-4: discovery is scoped to the service the address named, so
          // qdn://WEBSITE/Name resolves against published WEBSITE resources
          // and qdn://APP/Name keeps its exact previous behaviour. It is
          // deliberately NOT a cross-service search: a name that publishes
          // both an APP and a WEBSITE would otherwise turn today's silent
          // single-candidate open into an identifier prompt.
          const requestedService = parsed.identity.service
          const candidates = await nodeClient.listAppResources(
            parsed.sourceNetwork,
            parsed.identity.name,
            requestedService,
          )
          if (candidates.length === 0) {
            throw new Error(
              `No ${requestedService} resource named ${parsed.identity.name} was found on ${parsed.sourceNetwork === 'qortal' ? 'Qortal' : 'Qortium'}.`,
            )
          }
          const resolvedLocations = candidates.map((candidate) => ({
            address: `${buildAppResourceLocation(parsed.sourceNetwork, {
              // The candidate's OWN service, never a hardcoded 'APP' — this
              // address becomes the tab's resourceLocation, the render URL,
              // and the key durable permission grants are stored under.
              service: candidate.service,
              name: candidate.name,
              identifier: candidate.identifier,
            })}${parsed.routePath}${parsed.search}${parsed.hash}` as AppTabContext['resourceLocation'],
            candidate,
          }))
          if (resolvedLocations.length > 1) {
            return {
              message: `More than one ${requestedService} resource is published under ${parsed.identity.name}. Choose an identifier.`,
              options: resolvedLocations.map(({ address: optionAddress, candidate }) => ({
                address: optionAddress,
                label: candidate.identifier ?? 'Default resource',
              })),
              status: 'choose',
            }
          }
          const resolved = resolvedLocations[0]
          resourceIdentity = {
            service: resolved.candidate.service,
            name: resolved.candidate.name,
            identifier: resolved.candidate.identifier,
          }
          resourceLocation = resolved.address
          // Unreachable while replacements require an explicit identifier
          // (checked above, so the only await in this function is skipped for
          // them) — kept so that relaxing that rule cannot silently reopen the
          // window between the pre-flight check and the write.
          if (replaceTarget) {
            assertHomeV2ReplaceableTab(productStateRef.current, replaceTarget)
          }
        }
        // R4-4: the service is folded into the app id for WEBSITE and GAME so
        // a WEBSITE and an APP published under the same name and identifier
        // do not share one AppId. APP deliberately keeps the historical id
        // shape, so already-open and already-persisted app tabs are
        // unaffected by this change.
        const appIdSuffix =
          resourceIdentity.service === 'APP' ? '' : `:${resourceIdentity.service}`
        const app: AppDescriptor = {
          id: brand<AppId>(
            `home-v2:app:${parsed.sourceNetwork}:${resourceIdentity.name}:${resourceIdentity.identifier ?? 'default'}${appIdSuffix}`,
          ),
          title: resourceIdentity.name,
          description: `QDN app from ${parsed.sourceNetwork === 'qortal' ? 'Qortal' : 'Qortium'}.`,
          category: 'utility',
          sourceNetwork: parsed.sourceNetwork,
          resourceIdentity,
          targetNetworks: [parsed.sourceNetwork],
          placement: 'recommended',
        }
        if (replaceTarget) {
          replaceTabWithApp(replaceTarget, app, resourceLocation)
        } else {
          openApp(app, resourceLocation, requestedAccountId)
        }
        return { status: 'opened' }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid app address.'
        setShellNotice(message)
        return { message, status: 'error' }
      }
    },
    [nodeClient, openApp, replaceTabWithApp],
  )

  // The single entry point behind OPEN_CURRENT_TAB on every host. `tabId` is
  // always the trusted host's own view context for the requesting app — the
  // desktop main process supplies it over IPC, the portable app stage supplies
  // its resolved tab — so an app can only ever replace the tab it is in.
  const openAddressInTab = useCallback(
    (
      address: string,
      tabId: string,
      fromResourceLocation: string,
    ): Promise<AddressOpenResult> =>
      openAddress(address, undefined, {
        fromResourceLocation,
        tabId: brand<TabId>(tabId),
      }),
    [openAddress],
  )

  const resolveAndroidContextMenu = useCallback(
    async (action: HomeV2ContextMenuActionId | null) => {
      const pending = androidContextMenuResolver.current
      if (!pending) return
      androidContextMenuResolver.current = null
      window.clearTimeout(pending.timeout)
      setAndroidContextMenu(null)
      if (!action) {
        pending.resolve(dismissedHomeV2ContextMenuResult())
        return
      }
      try {
        const activeTab = productStateRef.current.tabs.find(
          (tab) => tab.id === productStateRef.current.activeTabId,
        )
        if (
          !activeTab ||
          activeTab.id !== pending.tabId ||
          activeTab.context.resourceLocation !== pending.resourceLocation
        ) {
          throw new Error('The app context changed before the context menu action completed.')
        }
        const menu = androidContextMenu
        if (!menu || menu.id !== pending.id) {
          throw new Error('The Home context menu is no longer active.')
        }
        const operation = getHomeV2ContextMenuOperation(menu.target, action)
        if (operation.kind === 'copy') {
          await writeContextMenuClipboard(operation.value)
        } else {
          const opened = await openAddress(operation.address, selectedAccountId)
          if (opened.status !== 'opened') {
            throw new Error(opened.message ?? 'The resource could not be opened.')
          }
        }
        pending.resolve(handledHomeV2ContextMenuResult(action))
      } catch (error) {
        pending.reject(error)
      }
    },
    [androidContextMenu, openAddress, selectedAccountId],
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
    if (!bridge?.onOpenAddressInTab) return
    return bridge.onOpenAddressInTab((value) => {
      if (!isRecord(value) || typeof value.address !== 'string') return
      // `tabId` and `fromResourceLocation` are both the main process's own
      // view context for the requesting app, not fields the app sent. Trust
      // them only as far as the reducer does: replace-tab-app rejects any id
      // that is not a live app tab, and any tab that has moved on from
      // `fromResourceLocation`.
      if (typeof value.tabId !== 'string' || !value.tabId) return
      if (typeof value.fromResourceLocation !== 'string' || !value.fromResourceLocation) return
      void openAddressInTab(value.address, value.tabId, value.fromResourceLocation)
    })
  }, [openAddressInTab])

  const getCollectionsAccounts = useCallback(
    (requestedAccountId: string | null = selectedAccountId): HomeV2CollectionsAccounts => {
      const availableAccounts = accountCatalogueRef.current.accounts.map((account) => ({
        id: account.id,
        label: account.label,
      }))
      return {
        activeAccountId:
          requestedAccountId &&
          availableAccounts.some((account) => account.id === requestedAccountId)
            ? requestedAccountId
            : null,
        availableAccounts,
      }
    },
    [selectedAccountId],
  )

  const applyCollectionsSnapshot = useCallback((next: BookmarkManagerSnapshot) => {
    setCollectionsSnapshot(next)
    setDashboardPinsError(null)
    setDashboardPinsPhase('ready')
  }, [])

  const applyCollectionsMutation = useCallback(
    async (
      requestedMutation:
        | BookmarkManagerMutation
        | ((snapshot: BookmarkManagerSnapshot) => BookmarkManagerMutation | null),
    ) => {
      const accounts = getCollectionsAccounts()
      let current = await collectionsClient.getSnapshot(accounts)
      const resolveMutation = () =>
        typeof requestedMutation === 'function'
          ? requestedMutation(current)
          : requestedMutation
      let mutation = resolveMutation()
      if (!mutation) return { changed: false, snapshot: current }
      try {
        return await collectionsClient.apply(
          { expectedRevision: current.revision, mutation },
          accounts,
        )
      } catch (error) {
        if ((error as { code?: unknown })?.code !== 'HOME_DATA_STALE') throw error
        current = await collectionsClient.getSnapshot(accounts)
        mutation = resolveMutation()
        if (!mutation) return { changed: false, snapshot: current }
        return collectionsClient.apply(
          { expectedRevision: current.revision, mutation },
          accounts,
        )
      }
    },
    [collectionsClient, getCollectionsAccounts],
  )

  const loadDashboardPinsSnapshot = useCallback(async () => {
    await collectionsClient.initialize()
    const accounts = getCollectionsAccounts()
    let next = await collectionsClient.getSnapshot(accounts)
    if (!dashboardPinSeedDecisionMade.current) {
      const isGenuinelyFresh =
        collectionsClient.wasInitializedFromEmptyStorage() &&
        (freshShellProfile === true ||
          await collectionsClient.hasPendingFreshShellForDashboardDefaults())
      const shouldSeed = shouldSeedHomeV2DefaultDashboardPins(
        isGenuinelyFresh,
        next.dashboardPins,
      )
      next = await collectionsClient.finalizeDashboardPinDefaults(
        shouldSeed,
        HOME_V2_DEFAULT_DASHBOARD_PIN_DRAFTS,
        accounts,
      )
      dashboardPinSeedDecisionMade.current = true
    }
    return next
  }, [collectionsClient, freshShellProfile, getCollectionsAccounts])

  // F3: open saved start pages on a fresh launch. One-shot per process, at
  // the first moment shell state and the collections snapshot are both
  // ready. The plan mirrors v1 (restored tabs win; onboarding suppresses).
  const startPagesLaunched = useRef(false)
  useEffect(() => {
    if (startPagesLaunched.current) return
    if (!shellStateReady || !collectionsSnapshot) return
    startPagesLaunched.current = true
    const plan = planStartPageLaunch({
      appTabCount: productStateRef.current.tabs.length,
      onboardingInProgress: onboarding.status === 'in-progress',
      startPages: collectionsSnapshot.startPages ?? [],
      knownAccountIds: accountCatalogueRef.current.accounts.map(
        (account) => account.id,
      ),
    })
    if (plan.length === 0) return
    void (async () => {
      for (const entry of plan) {
        try {
          await openAddress(entry.displayUrl, entry.accountId ?? undefined)
        } catch {
          // A start page that no longer resolves is skipped, not fatal.
        }
      }
      // v1 made the FIRST start page the active tab; the loop leaves the
      // last one active. The strip order is already correct.
      const tabs = productStateRef.current.tabs
      if (tabs.length > 1 && productStateRef.current.activeTabId !== tabs[0].id) {
        dispatchProduct({ type: 'activate-tab', tabId: tabs[0].id })
      }
    })()
  }, [collectionsSnapshot, onboarding, openAddress, shellStateReady])

  const refreshDashboardPins = useCallback(async () => {
    setDashboardPinsPhase('loading')
    setDashboardPinsError(null)
    try {
      const next = await loadDashboardPinsSnapshot()
      applyCollectionsSnapshot(next)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Saved Home links are unavailable.'
      setDashboardPinsError(message)
      setDashboardPinsPhase('error')
    }
  }, [applyCollectionsSnapshot, loadDashboardPinsSnapshot])

  useEffect(() => {
    if (!accountCatalogueReady || freshShellProfile === null) return
    let cancelled = false
    setDashboardPinsPhase('loading')
    setDashboardPinsError(null)
    void (async () => {
      const next = await loadDashboardPinsSnapshot()
      if (!cancelled) applyCollectionsSnapshot(next)
    })().catch((error) => {
      if (cancelled) return
      console.warn('Unable to initialize saved Home links.', error)
      const message = error instanceof Error ? error.message : 'Saved Home links are unavailable.'
      setDashboardPinsError(message)
      setDashboardPinsPhase('error')
      setShellNotice(message)
    })
    return () => {
      cancelled = true
    }
  }, [
    accountCatalogueReady,
    applyCollectionsSnapshot,
    freshShellProfile,
    loadDashboardPinsSnapshot,
  ])

  const mutateDashboardPins = useCallback(
    async (
      mutation:
        | BookmarkManagerMutation
        | ((snapshot: BookmarkManagerSnapshot) => BookmarkManagerMutation | null),
    ) => {
      setDashboardPinsBusy(true)
      setDashboardPinsError(null)
      try {
        const result = await applyCollectionsMutation(mutation)
        applyCollectionsSnapshot(result.snapshot)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Saved Home links could not be updated.'
        setDashboardPinsError(message)
        throw error
      } finally {
        setDashboardPinsBusy(false)
      }
    },
    [applyCollectionsMutation, applyCollectionsSnapshot],
  )

  const addDashboardPin = useCallback(
    async (address: string, title: string) => {
      const openRequest = validateBookmarksOpenRequest({
        accountId: selectedAccountId,
        address,
      })
      await mutateDashboardPins({
        type: 'addDashboardPin',
        pin: {
          accountId: openRequest.accountId,
          displayUrl: openRequest.address,
          title,
        },
      })
      if (title.trim()) {
        await mutateDashboardPins({
          type: 'updateDashboardPin',
          pinId: openRequest.address,
          pin: {
            accountId: openRequest.accountId,
            displayUrl: openRequest.address,
            title,
          },
        })
      }
    },
    [mutateDashboardPins, selectedAccountId],
  )

  const renameDashboardPin = useCallback(
    async (pin: BookmarkManagerDashboardPin, title: string) => {
      await mutateDashboardPins({
        type: 'updateDashboardPin',
        pinId: pin.id,
        pin: {
          accountId: pin.accountId ?? null,
          displayUrl: pin.displayUrl,
          title,
        },
      })
    },
    [mutateDashboardPins],
  )

  const moveDashboardPin = useCallback(
    async (pinId: string, direction: DashboardPinMoveDirection) => {
      await mutateDashboardPins((current) =>
        buildAdjacentDashboardPinMoveMutation(current.dashboardPins, pinId, direction),
      )
    },
    [mutateDashboardPins],
  )

  const reorderDashboardPin = useCallback(
    async (pinId: string, targetPinId: string, dropPosition: 'after' | 'before') => {
      await mutateDashboardPins(
        buildDashboardPinMoveMutation(pinId, targetPinId, dropPosition),
      )
    },
    [mutateDashboardPins],
  )

  const openDashboardPin = useCallback(
    async (pin: BookmarkManagerDashboardPin) => {
      const result = await openAddress(pin.displayUrl, pin.accountId ?? selectedAccountId)
      if (result.status !== 'opened') {
        // Reject so the pinned-apps inline alert (role=alert) renders the
        // failure next to the pin the user clicked (toolbar review FIX #1).
        throw new Error(
          result.message ?? 'Saved Home link could not be opened.',
        )
      }
    },
    [openAddress, selectedAccountId],
  )

  const getDashboardPinContextMenuItems = useCallback(
    (pin: BookmarkManagerDashboardPin) => {
      const target = getDashboardPinContextMenuTarget(pin)
      return target ? getHomeV2ContextMenuItems(target) : []
    },
    [],
  )

  const runDashboardPinContextMenuAction = useCallback(
    async (pin: BookmarkManagerDashboardPin, action: string) => {
      const target = getDashboardPinContextMenuTarget(pin)
      const item = target
        ? getHomeV2ContextMenuItems(target).find((candidate) => candidate.action === action)
        : null
      if (!target || !item) throw new Error('That pinned-app context action is unavailable.')
      const operation = getHomeV2ContextMenuOperation(target, item.action)
      if (operation.kind === 'copy') {
        await writeContextMenuClipboard(operation.value)
      } else {
        await openDashboardPin(pin)
      }
    },
    [openDashboardPin],
  )

  const setBookmarkToolbarVisibility = useCallback(
    async (toolbarVisibility: BookmarkToolbarVisibility) => {
      const result = await applyCollectionsMutation({
        type: 'setToolbarVisibility',
        toolbarVisibility,
      })
      applyCollectionsSnapshot(result.snapshot)
    },
    [applyCollectionsMutation, applyCollectionsSnapshot],
  )

  const openBookmarkToolbarLink = useCallback(
    async (link: BookmarkManagerLink) => {
      const result = await openAddress(
        link.displayUrl,
        link.accountId ?? selectedAccountId,
      )
      if (result.status !== 'opened') {
        setShellNotice(
          result.message ?? 'Saved Home link could not be opened.',
        )
      }
    },
    [openAddress, selectedAccountId],
  )

  /**
   * The toolbar star. Saving goes to the bookmarks tree; removing works on
   * whichever root actually holds the address, so un-starring a page that is
   * on the toolbar takes it off the toolbar.
   */
  const toggleCurrentBookmark = useCallback(
    async (draft: { displayUrl: string; title: string }) => {
      try {
        const result = await applyCollectionsMutation((snapshot) => {
          const existing = locateBookmarkManagerLink(snapshot, draft.displayUrl)
          return existing
            ? {
                itemId: existing.link.id,
                rootId: existing.rootId,
                type: 'removeTreeItem',
              }
            : {
                link: {
                  accountId: selectedAccountId,
                  displayUrl: draft.displayUrl,
                  title: draft.title,
                },
                rootId: 'bookmarks',
                type: 'addTreeLink',
              }
        })
        // Without this the store is updated but the toolbar and the star keep
        // rendering the previous snapshot.
        applyCollectionsSnapshot(result.snapshot)
      } catch (error) {
        setShellNotice(
          error instanceof Error ? error.message : 'Unable to update bookmarks.',
        )
      }
    },
    [applyCollectionsMutation, applyCollectionsSnapshot, selectedAccountId],
  )

  // The tab this window was dragged out with, opened through the ordinary
  // address route so it behaves exactly like any other tab.
  const openedDetachedAddress = useRef(false)
  useEffect(() => {
    if (!detachedAddress || !shellStateReady || openedDetachedAddress.current) return
    openedDetachedAddress.current = true
    void openAddress(detachedAddress).then((result) => {
      if (result.status !== 'opened') {
        setShellNotice(result.message ?? 'That tab could not be reopened here.')
      }
    })
  }, [detachedAddress, openAddress, shellStateReady])

  /** The address a tab carries when it is bookmarked or moved to a window. */
  const tabAddress = useCallback(
    (tabId: TabId): { address: string; title: string } | null => {
      const entry = productState.entries.find((candidate) => candidate.id === tabId)
      if (!entry) return null
      return entry.kind === 'app'
        ? { address: entry.context.resourceLocation, title: entry.title }
        : {
            address: `home://${entry.page}`,
            title: t(internalTabLabelKeys[entry.page]),
          }
    },
    [productState.entries],
  )

  /**
   * Moves a tab into its own window, as Home 1.x did. Only the address travels
   * to the new window, which then opens it through the ordinary address route,
   * so no tab internals have to survive a trip through the main process.
   */
  const detachTab = useCallback(
    async (tabId: TabId) => {
      const windows = window.homeV2Windows
      const target = tabAddress(tabId)
      if (!windows || !target) return
      try {
        await windows.openTab(target.address)
        // Closed only after the new window is asked for, so a rejected request
        // leaves the tab where it was rather than losing it.
        dispatchProduct({ type: 'close-tab', tabId })
      } catch (error) {
        setShellNotice(
          error instanceof Error
            ? error.message
            : 'Unable to open that tab in a new window.',
        )
      }
    },
    [tabAddress],
  )

  /** Dropping a tab on the bookmarks toolbar saves it there, as in Home 1.x. */
  const dropTabOnBookmarkToolbar = useCallback(
    async (tabId: TabId) => {
      const entry = productState.entries.find((candidate) => candidate.id === tabId)
      if (!entry) return
      const displayUrl =
        entry.kind === 'app'
          ? entry.context.resourceLocation
          : `home://${entry.page}`
      try {
        const result = await applyCollectionsMutation((snapshot) =>
          locateBookmarkManagerLink(snapshot, displayUrl)?.rootId === 'toolbar'
            ? null
            : {
                link: {
                  accountId: selectedAccountId,
                  displayUrl,
                  title:
                    entry.kind === 'app'
                      ? entry.title
                      : t(internalTabLabelKeys[entry.page]),
                },
                rootId: 'toolbar',
                type: 'addTreeLink',
              },
        )
        applyCollectionsSnapshot(result.snapshot)
      } catch (error) {
        setShellNotice(
          error instanceof Error ? error.message : 'Unable to save that tab.',
        )
      }
    },
    [
      applyCollectionsMutation,
      applyCollectionsSnapshot,
      productState.entries,
      selectedAccountId,
    ],
  )

  const openBookmarksManager = useCallback(async () => {
    // Resolved at click time from the live assignment, so someone who points
    // Bookmarks at their own app is honoured.
    const settings = await qdnAppsManagement.client?.get().catch(() => null)
    const result = await openAddress(resolveHomeV2BookmarksAppUrl(settings ?? null))
    if (result.status !== 'opened') {
      setShellNotice(result.message ?? 'Unable to open the Bookmarks app.')
    }
  }, [openAddress, qdnAppsManagement.client])

  const getBookmarkToolbarContextMenuItems = useCallback(
    (link: BookmarkManagerLink) => {
      const target = getSavedResourceContextMenuTarget(link.displayUrl)
      return target ? getHomeV2ContextMenuItems(target) : []
    },
    [],
  )

  const runBookmarkToolbarContextMenuAction = useCallback(
    async (link: BookmarkManagerLink, action: string) => {
      const target = getSavedResourceContextMenuTarget(link.displayUrl)
      const item = target
        ? getHomeV2ContextMenuItems(target).find(
            (candidate) => candidate.action === action,
          )
        : null
      if (!target || !item) {
        throw new Error('That bookmark context action is unavailable.')
      }
      const operation = getHomeV2ContextMenuOperation(target, item.action)
      if (operation.kind === 'copy') {
        await writeContextMenuClipboard(operation.value)
      } else {
        await openBookmarkToolbarLink(link)
      }
    },
    [openBookmarkToolbarLink],
  )

  useEffect(() => {
    const bridge = window.homeV2Collections
    if (!bridge) return
    return bridge.onRequest((value) => {
      if (!isRecord(value) || typeof value.id !== 'string') return
      const requestId = value.id
      const requestAccounts = getCollectionsAccounts(
        typeof value.accountId === 'string' ? value.accountId : null,
      )
      const operation = value.operation === 'apply'
        ? collectionsClient.apply(value.request, requestAccounts)
        : value.operation === 'get'
          ? collectionsClient.getSnapshot(requestAccounts)
          : Promise.reject(new Error('Unsupported bookmark manager operation.'))
      void operation.then(
        (result) => {
          if (value.operation === 'apply' && 'snapshot' in result) {
            applyCollectionsSnapshot(result.snapshot)
          }
          bridge.resolveRequest({ requestId, result })
        },
        (error: unknown) => bridge.resolveRequest({
          error: {
            ...((error as { code?: unknown })?.code && typeof (error as { code?: unknown }).code === 'string'
              ? { code: (error as { code: string }).code }
              : {}),
            message: error instanceof Error ? error.message : 'Bookmark manager request failed.',
          },
          requestId,
        }),
      ).catch((error) => console.warn('Unable to resolve bookmark manager request.', error))
    })
  }, [applyCollectionsSnapshot, collectionsClient, getCollectionsAccounts])

  useEffect(() => {
    const bridge = window.homeV2Collections
    if (!bridge) return
    return bridge.onOpen((value) => {
      if (!isRecord(value) || typeof value.address !== 'string') return
      const accountId = typeof value.accountId === 'string' ? value.accountId : null
      void openAddress(value.address, accountId)
    })
  }, [openAddress])

  useEffect(() => {
    const bridge = window.homeV2Apps
    if (!bridge) return
    return bridge.onOpenResourceViewer((value) => {
      const parsed = parseHomeV2ResourceViewerState(value)
      if (!parsed) return
      if (!productStateRef.current.tabs.some((tab) => tab.id === parsed.sourceTabId)) return
      setResourceViewer(parsed)
    })
  }, [])

  useEffect(() => {
    const bridge = window.homeV2Apps
    if (!bridge) return
    return bridge.onNotificationClicked((value) => {
      if (!isRecord(value) || typeof value.tabId !== 'string') return
      const tabId = brand<TabId>(value.tabId)
      if (!productStateRef.current.tabs.some((tab) => tab.id === tabId)) return
      dispatchProduct({ type: 'activate-tab', tabId })
    })
  }, [])

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
            value.action !== 'GET_PENDING_TRANSACTIONS' &&
            value.action !== 'FORGET_PENDING_TRANSACTION' &&
            value.action !== 'UNLOCK_SELECTED_ACCOUNT' &&
            value.action !== 'PUBLISH_QDN_RESOURCE' &&
            value.action !== 'PUBLISH_CHAT_ATTACHMENT' &&
            value.action !== 'GET_CHAT_ATTACHMENT_STREAM_URL' &&
            value.action !== 'OPEN_CHAT_ATTACHMENT_VIEWER' &&
            value.action !== 'SAVE_CHAT_ATTACHMENT' &&
            value.action !== 'SHOW_NOTIFICATION' &&
            value.action !== 'BOOKMARKS_GET' &&
            value.action !== 'BOOKMARKS_APPLY' &&
            value.action !== 'BOOKMARKS_OPEN' &&
            value.action !== 'NOTIFICATION_MANAGER_GET' &&
            value.action !== 'NOTIFICATION_MANAGER_SET_MUTED' &&
            value.action !== 'NOTIFICATION_MANAGER_REMOVE_RULES' &&
            value.action !== 'NOTIFICATION_MANAGER_REVOKE' &&
            value.action !== 'OPEN_AS_WIDGET' &&
            value.action !== 'SEND_MESSAGE' &&
            !isHomeV2PublicChatAction(value.action) &&
            !isHomeV2DirectChatReadAction(value.action) &&
            !isHomeV2DirectChatWriteAction(value.action) &&
            !isHomeV2PrivateGroupChatReadAction(value.action) &&
            !isHomeV2PrivateGroupChatWriteAction(value.action) &&
            !isHomeV2GroupMembershipAction(value.action) &&
            !isHomeV2MintingWriteAction(value.action) &&
            !isHomeV2GroupAdminAction(value.action))) ||
        // The manager families act on Home-profile data, not on an account, so
        // they are prompted with no account selected and must not require one.
        (value.action !== 'SHOW_NOTIFICATION' &&
          value.action !== 'BOOKMARKS_GET' &&
          value.action !== 'BOOKMARKS_APPLY' &&
          value.action !== 'BOOKMARKS_OPEN' &&
          value.action !== 'NOTIFICATION_MANAGER_GET' &&
          value.action !== 'NOTIFICATION_MANAGER_SET_MUTED' &&
          value.action !== 'NOTIFICATION_MANAGER_REMOVE_RULES' &&
          value.action !== 'NOTIFICATION_MANAGER_REVOKE' &&
          value.action !== 'OPEN_AS_WIDGET' &&
          typeof value.accountId !== 'string') ||
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
        || (value.action === 'FORGET_PENDING_TRANSACTION' &&
          (value.writeKind !== 'journal' ||
            typeof value.journalSignature !== 'string' ||
            typeof value.writeOperationLabel !== 'string' ||
            typeof value.writeTargetChainLabel !== 'string' ||
            value.writeSingleRequestOnly !== true))
        || ((value.action === 'PUBLISH_QDN_RESOURCE' ||
          value.action === 'PUBLISH_CHAT_ATTACHMENT' ||
          value.action === 'GET_CHAT_ATTACHMENT_STREAM_URL' ||
          value.action === 'OPEN_CHAT_ATTACHMENT_VIEWER' ||
          value.action === 'SAVE_CHAT_ATTACHMENT') &&
          (value.writeKind !== 'publish' ||
            typeof value.publishContentHash !== 'string' ||
            typeof value.publishFileName !== 'string' ||
            typeof value.publishResourceCoordinate !== 'string' ||
            typeof value.publishSize !== 'number' ||
            typeof value.writeOperationLabel !== 'string' ||
            typeof value.writeRouteLabel !== 'string' ||
            typeof value.writeTargetChainLabel !== 'string'))
        // Minting writes must always arrive as single-request prompts naming
        // the account, the node route and the chain. REMOVE_MINTING_ACCOUNT
        // additionally names the key; START_MINTING has none to name yet.
        || (isHomeV2MintingWriteAction(value.action) &&
          (value.writeKind !== 'minting' ||
            typeof value.writeMintingAddress !== 'string' ||
            (value.action === 'REMOVE_MINTING_ACCOUNT'
              ? typeof value.writeMintingPublicKey !== 'string'
              : value.writeMintingPublicKey !== null) ||
            typeof value.writeOperationLabel !== 'string' ||
            typeof value.writeRouteLabel !== 'string' ||
            typeof value.writeTargetChainLabel !== 'string' ||
            value.writeSingleRequestOnly !== true))
        // SEND_MESSAGE signs a chain transaction, so its prompt must arrive
        // fully specified or not at all. The recipient AT address and the
        // message text are REQUIRED fields here — a prompt that cannot show
        // the user what is about to be signed is refused rather than shown
        // with blanks. The chain and protocol are pinned because the
        // transaction serializer is Qortium-specific, and
        // writeSingleRequestOnly must be true so single-request is structural
        // rather than a property of how allowedScopes happens to compute.
        || (value.action === 'SEND_MESSAGE' &&
          (value.writeKind !== 'direct' ||
            value.protocol !== 'qdnRequest' ||
            value.targetNetwork !== 'qortium' ||
            typeof value.writeOperationLabel !== 'string' ||
            typeof value.writeOtherAddress !== 'string' ||
            typeof value.chatMessagePreview !== 'string' ||
            typeof value.writeRouteLabel !== 'string' ||
            typeof value.writeTargetChainLabel !== 'string' ||
            value.writeSingleRequestOnly !== true))
      ) {
        return
      }
      const accountId = typeof value.accountId === 'string' ? value.accountId : ''
      const account = accountId
        ? accountCatalogueRef.current.accounts.find((candidate) => candidate.id === accountId)
        : undefined
      if (value.action === 'UNLOCK_SELECTED_ACCOUNT') {
        // The protocol check that used to live here is gone: unlocking is a
        // Home-account operation, not a chain one, and UNLOCK_SELECTED_ACCOUNT
        // is now advertised on both protocols (home-v2-app-actions.ts). A
        // missing account is still a hard denial — there is nothing to unlock.
        if (!account) {
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
      const isWidgetPrompt = value.action === 'OPEN_AS_WIDGET'
      const isAccountRead = isHomeV2AccountReadAction(value.action)
      const isChatWrite = isHomeV2PublicChatAction(value.action)
      const isDirectRead = isHomeV2DirectChatReadAction(value.action)
      const isDirectWrite = isHomeV2DirectChatWriteAction(value.action)
      const isPrivateGroupRead = isHomeV2PrivateGroupChatReadAction(value.action)
      const isPrivateGroupWrite = isHomeV2PrivateGroupChatWriteAction(value.action)
      const isChatMutationGrant = isChatWrite || isDirectWrite || (
        isPrivateGroupWrite && value.action.startsWith('SEND_PRIVATE_GROUP_CHAT_')
      )
      const isGroupWrite = isHomeV2GroupWriteAction(value.action)
      const isGroupAdminWrite = isHomeV2GroupAdminAction(value.action)
      const isPublish = value.action === 'PUBLISH_QDN_RESOURCE'
      const isPrivateAttachment = value.action === 'PUBLISH_CHAT_ATTACHMENT' ||
        value.action === 'GET_CHAT_ATTACHMENT_STREAM_URL' ||
        value.action === 'OPEN_CHAT_ATTACHMENT_VIEWER' ||
        value.action === 'SAVE_CHAT_ATTACHMENT'
      const isNotification = value.action === 'SHOW_NOTIFICATION'
      const isBookmarkManager = value.action === 'BOOKMARKS_GET' ||
        value.action === 'BOOKMARKS_APPLY' ||
        value.action === 'BOOKMARKS_OPEN'
      // The administrative notification surface. NOTIFICATION_MANAGER_HAS_PERMISSION
      // is absent by construction: it never reaches a prompt.
      const isNotificationManager = value.action === 'NOTIFICATION_MANAGER_GET' ||
        value.action === 'NOTIFICATION_MANAGER_SET_MUTED' ||
        value.action === 'NOTIFICATION_MANAGER_REMOVE_RULES' ||
        value.action === 'NOTIFICATION_MANAGER_REVOKE'
      const isJournalRead = value.action === 'GET_PENDING_TRANSACTIONS'
      const isJournalForget = value.action === 'FORGET_PENDING_TRANSACTION'
      const isMintingWrite = isHomeV2MintingWriteAction(value.action)
      // A zero-fee chain MESSAGE to an AT. Its own prompt kind: it signs, so it
      // must never inherit the read-only account prompt's wording, its
      // 'account.read' grant family, or its session/always scopes.
      const isAtMessage = value.action === 'SEND_MESSAGE'
      // Wording-only refinement of the account-read prompt. The private-group
      // and attachment reads stay FULL members of the account.read grant
      // family: the `capability` below is deliberately still 'account.read'
      // for all of them, because bridge-permissions.ts unifies grants on that
      // exact string (see `unifiedAccountRead`), so one session grant — and
      // one durable "Always allow" — keeps covering all five actions on both
      // chains. Only the title, summary and details change, so the prompt
      // stops calling a private-group key resolution "read-only account
      // access". Splitting the GRANT is a separate decision, not made here.
      const accountReadPromptKind = homeV2AccountReadPromptKind(value.action)
      const isGenericAccountRead = accountReadPromptKind === 'account'
      const operationLabel = isChatWrite || isDirectRead || isDirectWrite || isPrivateGroupRead || isPrivateGroupWrite || isGroupWrite || isPublish || isPrivateAttachment || isNotification || isBookmarkManager || isNotificationManager || isJournalForget || isMintingWrite || isAtMessage
        ? String(value.writeOperationLabel)
        : ''
      const prompt = createPermissionPrompt({
        id: brand<PermissionRequestId>(value.requestId),
        protocol: value.protocol,
        action: value.action,
        capability: isWidgetPrompt
          ? 'window.widget.open'
          : isAccountRead
          ? 'account.read'
          : isChatWrite
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
              : isPublish
                ? 'qdn.publish'
              : isPrivateAttachment
                ? 'chat.attachment'
              : isNotification
                ? 'notifications.show'
              : isBookmarkManager
                ? 'bookmarks.manage'
              : isNotificationManager
                ? 'notifications.manage'
              : isJournalForget
                ? 'transactions.pending.forget'
              : isJournalRead
                ? 'transactions.pending.read'
              : isMintingWrite
                ? 'account.minting'
              // Its own capability, never 'account.read': that string is what
              // bridge-permissions.ts unifies durable grants on, and a signing
              // action must not be reachable through a read grant.
              : isAtMessage
                ? 'contract.message.send'
              : 'account.public.read',
        appId: brand<AppId>(`home-v2:permission-app:${appIdentityKey}`),
        appIdentityKey,
        appTitle,
        context: {
          appId: brand<AppId>(`home-v2:permission-app:${appIdentityKey}`),
          identityId: brand<IdentityId>(isWidgetPrompt
            ? `home-v2:identity:none`
            : isNotification
            ? `home-v2:identity:app:${appIdentityKey}`
            : isBookmarkManager || isNotificationManager
            ? `home-v2:identity:app:${appIdentityKey}`
            : `home-v2:identity:${accountId}`),
          nodeProfileRef: snapshot.nodes[value.targetNetwork].ref,
          tabId: brand<TabId>(value.tabId),
          targetNetwork: value.targetNetwork,
          walletRef: account
            ? brand<WalletRef>(`home-v2:wallet:${account.walletId}`)
            : null,
        },
        title: isWidgetPrompt
          ? 'Allow a floating window?'
          : isNotification
          ? 'Allow app notifications?'
          : isBookmarkManager
          ? 'Allow saved-link management?'
          : isNotificationManager
          ? 'Allow notification permission management?'
          : accountReadPromptKind
          ? homeV2AccountReadPromptTitle(accountReadPromptKind)
          : isJournalRead
            ? 'Allow pending transaction access?'
          : isJournalForget
            ? 'Forget pending transaction?'
          : isAtMessage
            ? 'Send a message to a contract?'
          : isChatWrite || isDirectRead || isDirectWrite || isPrivateGroupRead || isPrivateGroupWrite || isGroupWrite || isPublish || isPrivateAttachment || isMintingWrite
          ? `Allow ${operationLabel.toLowerCase()}?`
          : 'Allow account access?',
        summary: isWidgetPrompt
          ? `${appTitle} wants to open a frameless window that stays above other applications.`
          : isNotification
          ? `${appTitle} wants to show system notifications until revoked in Settings.`
          : isBookmarkManager
          ? `${appTitle} wants to manage bookmarks, toolbar links, dashboard pins, and start pages on this device.`
          : isNotificationManager
          ? `${appTitle} wants to review and change which OTHER apps may notify you on this device — muting them, deleting their notification rules, and revoking their notification permission. It cannot create a rule for any app, and it cannot notify you itself without asking separately.`
          : accountReadPromptKind
          ? homeV2AccountReadPromptSummary(accountReadPromptKind, appTitle)
          : isJournalRead
            ? `${appTitle} wants to read its retained unknown transaction outcomes for this account and chain.`
          : isJournalForget
            ? `${appTitle} wants Home to forget one retained transaction after reconciliation.`
          : value.action === 'START_MINTING'
            ? `${appTitle} wants to start minting with your account on this node. Home will load this account's minting key onto the local Core, and submit the on-chain authorization first if it does not exist yet. No key is given to the app.`
          : value.action === 'REMOVE_MINTING_ACCOUNT'
            ? `${appTitle} wants to remove this account's own minting key from the local Core on this device. Home read the key off the node itself rather than taking it from the app, so no other minter on your node can be touched. Minting with it stops; nothing on chain changes.`
          : isAtMessage
            ? `${appTitle} wants to sign and broadcast one message from the selected account to the contract below. It carries no payment and costs no fee — Home pays for it with proof-of-work on this device. The complete message text is shown below, exactly as it will be signed; read all of it, as the contract may act on it.`
          : isChatWrite || isDirectRead || isDirectWrite || isPrivateGroupRead || isPrivateGroupWrite || isGroupWrite || isPublish || isPrivateAttachment
          ? `${appTitle} wants to ${operationLabel.toLowerCase()} as the selected account.`
          : `${appTitle} wants to read the selected account address and public identity data.`,
        details: [
          ...(isWidgetPrompt
          ? [
              { label: 'App', value: appTitle },
              { label: 'Window', value: 'Frameless, always on top, and drawn entirely by the app' },
            ]
          : isNotification
          ? [
              { label: 'App', value: appTitle },
              { label: 'Chain', value: value.targetNetwork === 'qortal' ? 'Qortal' : 'Qortium' },
              { label: 'Scope', value: 'Until revoked in Settings' },
            ]
          : isBookmarkManager
          ? [
              { label: 'App', value: appTitle },
              { label: 'Access', value: 'All saved Home links on this device' },
              { label: 'Scope', value: 'Until revoked in Settings' },
            ]
          : isNotificationManager
          ? [
              { label: 'App', value: appTitle },
              { label: 'Access', value: 'Every app’s notification permission and rules on this device' },
              { label: 'Can do', value: 'Mute an app, delete its notification rules, revoke its notification permission' },
              { label: 'Cannot do', value: 'Create a rule, notify you, or read any masked address, key or signature in a rule' },
              { label: 'Scope', value: 'Until revoked in Settings' },
            ]
          // Only the GENERIC account-read prompt keeps the generic detail
          // rows. The private-group and attachment reads now fall through to
          // the branches below, which name the group, the route and the
          // attachment they are actually about.
          : isGenericAccountRead
            ? homeV2AccountReadPermissionDetails(account?.label ?? accountId)
          : isJournalRead
            ? [
                { label: 'Account', value: account?.label ?? accountId },
                { label: 'Chain', value: value.targetNetwork === 'qortal' ? 'Qortal' : 'Qortium' },
                { label: 'Data', value: 'Signatures and targets of this app’s unknown transaction outcomes' },
              ]
          : isJournalForget
            ? [
                { label: 'Account', value: account?.label ?? accountId },
                { label: 'Operation', value: operationLabel },
                { label: 'Chain', value: String(value.writeTargetChainLabel) },
                { label: 'Signature', value: String(value.journalSignature) },
              ]
          : isChatWrite
          ? [
              { label: 'Account', value: account?.label ?? accountId },
              { label: 'Operation', value: operationLabel },
              ...(isChatMutationGrant
                ? [{ label: 'Tab approval', value: 'Send, edit, delete, and react in this chat' }]
                : []),
              { label: 'Chain', value: String(value.writeTargetChainLabel) },
              { label: 'Message', value: String(value.chatMessagePreview) },
              ...(typeof value.chatReference === 'string'
                ? [{ label: 'Reference', value: value.chatReference }]
                : []),
            ]
          : isDirectRead || isDirectWrite
            ? [
                { label: 'Account', value: account?.label ?? accountId },
                { label: 'Operation', value: operationLabel },
                ...(isChatMutationGrant
                  ? [{ label: 'Tab approval', value: 'Send, edit, delete, and react in this conversation' }]
                  : []),
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
                { label: 'Account', value: account?.label ?? accountId },
                { label: 'Operation', value: operationLabel },
                ...(isChatMutationGrant
                  ? [{ label: 'Tab approval', value: 'Send, edit, delete, and react in this private group' }]
                  : []),
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
                { label: 'Account', value: account?.label ?? accountId },
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
          : isMintingWrite
            ? [
                { label: 'Account', value: account?.label ?? accountId },
                { label: 'Operation', value: operationLabel },
                { label: 'Chain', value: String(value.writeTargetChainLabel) },
                { label: 'Node', value: String(value.writeRouteLabel) },
                { label: 'Address', value: String(value.writeMintingAddress) },
                ...(typeof value.writeMintingPublicKey === 'string'
                  ? [{ label: 'This account’s minting key', value: value.writeMintingPublicKey }]
                  : []),
                {
                  label: 'Not allowed',
                  value: 'Touching any other minter’s key on this node, giving the app any private or minting key, or changing minting on any node but this local one',
                },
              ]
          : isPublish || isPrivateAttachment
            ? [
                { label: 'Account', value: account?.label ?? accountId },
                { label: 'Operation', value: operationLabel },
                { label: 'Chain', value: String(value.writeTargetChainLabel) },
                { label: 'Route', value: String(value.writeRouteLabel) },
                { label: 'Resource', value: String(value.publishResourceCoordinate) },
                { label: 'File', value: String(value.publishFileName) },
                { label: 'Size', value: `${Number(value.publishSize).toLocaleString()} bytes` },
                { label: 'SHA-256', value: String(value.publishContentHash) },
              ]
          // The two rows that matter here are Contract and Message: they are
          // what the user is actually authorizing. Both are validated as
          // present by the guard above, so neither can render blank.
          : isAtMessage
            ? [
                { label: 'Account', value: account?.label ?? accountId },
                { label: 'Operation', value: operationLabel },
                { label: 'Chain', value: String(value.writeTargetChainLabel) },
                { label: 'Route', value: String(value.writeRouteLabel) },
                { label: 'Contract (AT)', value: String(value.writeOtherAddress) },
                // The full message, never truncated — this is the text being
                // signed, so all of it is disclosed. The 'scroll' variant keeps
                // a long one from pushing the buttons off-screen; the byte
                // count below makes the length unambiguous.
                { label: 'Message', value: String(value.chatMessagePreview), variant: 'scroll' as const },
                {
                  label: 'Message size',
                  value: `${new TextEncoder().encode(String(value.chatMessagePreview)).length.toLocaleString()} bytes (of 4,000 max)`,
                },
                { label: 'Payment', value: 'None — this message transfers nothing' },
                { label: 'Fee', value: '0, paid with proof-of-work on this device' },
                {
                  label: 'Not allowed',
                  value: 'Sending to an ordinary account, attaching a payment, encrypting, or reusing this approval for a later message',
                },
              ]
            : [
              { label: 'Account', value: account?.label ?? accountId },
              { label: 'Data', value: 'Address, public key when available, lock state, and public name' },
            ]),
          // "Always allow" is broader than the single action being asked
          // about — it is one durable grant over the whole read-only account
          // family on both chains — so every prompt that offers it says so.
          ...(accountReadPromptKind && value.writeSingleRequestOnly !== true
            ? [homeV2AccountReadAlwaysAllowDetail(account?.label ?? accountId)]
            : []),
        ],
        allowedScopes: isAtMessage
          // Stated first and unconditionally, ahead of every other arm: one
          // approval signs exactly one transaction. This does not depend on
          // writeSingleRequestOnly reaching us intact, and the main process
          // independently refuses to retain a grant for it.
          ? ['single-request']
          : isWidgetPrompt
          ? ['single-request', 'session']
          : isNotification
          ? ['always']
          : isBookmarkManager
          ? ['always']
          // Durable-only, exactly like the bookmark manager. A session-scoped
          // answer to an administrative capability would be a grant the user
          // could neither see nor revoke in Settings.
          : isNotificationManager
          ? ['always']
          // The read-only account family may be granted persistently so a
          // trusted app stops asking every session (owner decision, R3-10);
          // the grant is revocable in QDN Apps settings. Membership is the
          // frozen HOME_V2_ACCOUNT_READ_ACTIONS list, and the
          // writeSingleRequestOnly guard keeps anything the bridge refuses to
          // retain — publishes, SAVE_CHAT_ATTACHMENT, journal forgets,
          // minting writes, unlock — on single-request only.
          : accountReadPromptKind && value.writeSingleRequestOnly !== true
          ? ['single-request', 'session', 'always']
          // Chat sends may be granted persistently so trusted apps stop
          // asking on every restart; the grant is revocable in QDN Apps
          // settings. Publishing, unlock, group admin and key rotation are
          // deliberately absent from isHomeV2ChatSendAction.
          : isHomeV2ChatSendAction(value.action) &&
            value.writeSingleRequestOnly !== true
          ? ['single-request', 'session', 'always']
          : value.writeSingleRequestOnly === true
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
      const semanticKey = JSON.stringify([
        prompt.appIdentityKey,
        prompt.context.identityId,
        prompt.context.targetNetwork,
        tabId,
        homeV2PermissionGrantFamily(prompt.action),
        prompt.details,
      ])
      if (Array.from(pendingMeta.values()).some((meta) => meta.semanticKey === semanticKey)) {
        throw new Error('This permission request is already pending for the app tab.')
      }
      const pendingForApp = Array.from(pendingMeta.values()).filter(
        (meta) => meta.appIdentityKey === prompt.appIdentityKey,
      ).length
      if (pendingForApp >= MAX_PENDING_ANDROID_PERMISSION_PROMPTS_PER_APP) {
        throw new Error('Too many pending permission requests for this app. Wait for the existing prompt to resolve.')
      }
      if (pendingMeta.size >= MAX_PENDING_ANDROID_PERMISSION_PROMPTS_GLOBAL) {
        throw new Error('Too many pending permission requests. Wait for the existing prompts to resolve.')
      }
      pendingMeta.set(prompt.id, {
        appIdentityKey: prompt.appIdentityKey,
        network: prompt.context.targetNetwork,
        semanticKey,
        tabId,
      })
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

  const queueAndroidSessionGrantPermission = useCallback(
    (
      grantKey: string,
      prompt: Parameters<typeof queuePermissionPrompt>[1],
      tabId: string,
    ) => {
      const existing = androidPendingSessionGrantDecisions.current.get(grantKey)
      if (existing) return existing
      const pending = queueAndroidPermissionPrompt(prompt, tabId)
      androidPendingSessionGrantDecisions.current.set(grantKey, pending)
      void pending.finally(() => {
        if (androidPendingSessionGrantDecisions.current.get(grantKey) === pending) {
          androidPendingSessionGrantDecisions.current.delete(grantKey)
        }
      })
      return pending
    },
    [queueAndroidPermissionPrompt],
  )

  const requestApp = useCallback(
    async (
      protocol: HomeV2AppBridgeProtocol,
      requestValue: unknown,
      context: HomeV2AppRequestContext,
    ) => {
      // Same alias collapse the desktop bridge does, at this host's own entry
      // point: a compatibility alias must be dispatched, gated and reported as
      // the canonical action on every surface, never as a capability of its own.
      const action = isRecord(requestValue) && typeof requestValue.action === 'string'
        ? canonicalHomeV2AppAction(requestValue.action.trim().toUpperCase(), requestValue)
        : ''
      if (isAndroidHost && action === 'SHOW_CONTEXT_MENU') {
        const activeTab = productStateRef.current.tabs.find(
          (tab) => tab.id === productStateRef.current.activeTabId,
        )
        if (
          !activeTab ||
          activeTab.id !== context.tabId ||
          activeTab.context.resourceLocation !== context.resourceLocation
        ) {
          throw new Error('Open this app tab to show its Home context menu.')
        }
        if (androidContextMenuResolver.current) {
          throw new Error('This app tab already has an open Home context menu.')
        }
        const request = normalizeHomeV2ContextMenuRequest(protocol, requestValue)
        const id = globalThis.crypto.randomUUID()
        setAndroidContextMenu({ id, tabId: context.tabId, target: request.target })
        return new Promise<HomeV2ContextMenuResult>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            const pending = androidContextMenuResolver.current
            if (!pending || pending.id !== id) return
            androidContextMenuResolver.current = null
            setAndroidContextMenu(null)
            pending.resolve(dismissedHomeV2ContextMenuResult())
          }, ANDROID_CONTEXT_MENU_TIMEOUT_MS)
          androidContextMenuResolver.current = {
            id,
            network: request.target.network,
            reject,
            resolve,
            resourceLocation: context.resourceLocation,
            tabId: context.tabId,
            timeout,
          }
        })
      }
      if (!nodeClient) throw new Error('The app bridge is unavailable.')
      const resolveAppIdentity = () => {
        try {
          const parsed = parseAppResourceLocation(context.resourceLocation)
          const identifier = resolveLaunchIdentifier(parsed.identity.identifier, context.resourceLocation)
          return {
            identityKey: sanitizeQdnManagerAppKey(
              buildAppResourceLocation(parsed.sourceNetwork, { ...parsed.identity, identifier }),
            ),
            title: parsed.identity.name,
          }
        } catch {
          throw new Error('App request is missing its stable app identity.')
        }
      }
      const retainUnknownTransaction = async (result: unknown) => {
        if (!context.selectedAccountId) return result
        try {
          const entry = createHomeV2PendingTransactionFromResult({
            accountId: context.selectedAccountId,
            action,
            appIdentity: resolveAppIdentity().identityKey,
            protocol,
            request: requestValue,
            result,
          })
          if (!entry) return result
          await recordAndroidHomeV2PendingTransaction(entry)
          return isRecord(result) ? { ...result, journalStored: true } : result
        } catch (error) {
          console.warn('[home-v2-app] Unable to retain an ambiguous signed transaction:', error)
          return isRecord(result) ? { ...result, journalStored: false } : result
        }
      }
      if (isAndroidHost && protocol === 'qdnRequest' && (
        action === 'BOOKMARKS_HAS_PERMISSION' ||
        action === 'BOOKMARKS_GET' ||
        action === 'BOOKMARKS_APPLY' ||
        action === 'BOOKMARKS_OPEN'
      )) {
        const parsedApp = resolveAppIdentity()
        if (action === 'BOOKMARKS_HAS_PERMISSION') {
          return { granted: await hasQdnManagerPermission(parsedApp.identityKey, 'bookmarks.manage') }
        }
        if (!await hasQdnManagerPermission(parsedApp.identityKey, 'bookmarks.manage')) {
          const targetNetwork: NetworkId = 'qortium'
          const appId = brand<AppId>(`home-v2:permission-app:${parsedApp.identityKey}`)
          const prompt = createPermissionPrompt({
            id: brand<PermissionRequestId>(globalThis.crypto.randomUUID()),
            protocol,
            action,
            capability: 'bookmarks.manage',
            appId,
            appIdentityKey: parsedApp.identityKey,
            appTitle: parsedApp.title,
            context: {
              appId,
              identityId: brand<IdentityId>(`home-v2:identity:app:${parsedApp.identityKey}`),
              nodeProfileRef: snapshot.nodes[targetNetwork].ref,
              tabId: brand<TabId>(context.tabId),
              targetNetwork,
              walletRef: null,
            },
            title: 'Allow saved-link management?',
            summary: `${parsedApp.title} wants to manage bookmarks, toolbar links, dashboard pins, and start pages on this device.`,
            details: [
              { label: 'App', value: parsedApp.title },
              { label: 'Access', value: 'All saved Home links on this device' },
            ],
            allowedScopes: ['always'],
          })
          const decision = await queueAndroidPermissionPrompt(prompt, context.tabId)
          if (!decision.approved || decision.scope !== 'always') {
            throw new Error('Home data manager permission was denied.')
          }
          const currentTab = productStateRef.current.tabs.find((tab) => tab.id === context.tabId)
          if (!currentTab || currentTab.context.resourceLocation !== context.resourceLocation) {
            throw new Error('QDN manager request is stale because the app view changed before approval.')
          }
          await grantQdnManagerPermission(parsedApp.identityKey, 'bookmarks.manage')
        }
        const currentTab = productStateRef.current.tabs.find((tab) => tab.id === context.tabId)
        if (!currentTab || currentTab.context.resourceLocation !== context.resourceLocation) {
          throw new Error('QDN manager request is stale because the app view changed before it could run.')
        }
        const accounts = {
          activeAccountId: context.selectedAccountId,
          availableAccounts: accountCatalogueRef.current.accounts.map((account) => ({
            id: account.id,
            label: account.label,
          })),
        }
        if (action === 'BOOKMARKS_GET') {
          const result = await collectionsClient.getSnapshot(accounts)
          const completedTab = productStateRef.current.tabs.find((tab) => tab.id === context.tabId)
          if (!completedTab || completedTab.context.resourceLocation !== context.resourceLocation) {
            throw new Error('QDN manager request is stale because the app view changed while it was running.')
          }
          return result
        }
        if (action === 'BOOKMARKS_APPLY') {
          const record = isRecord(requestValue) ? requestValue : {}
          const mutationRequest = validateBookmarkManagerMutationRequest(
            record.request ?? {
              expectedRevision: record.expectedRevision,
              mutation: record.mutation,
            },
          )
          const result = await collectionsClient.apply(mutationRequest, accounts)
          applyCollectionsSnapshot(result.snapshot)
          const completedTab = productStateRef.current.tabs.find((tab) => tab.id === context.tabId)
          if (!completedTab || completedTab.context.resourceLocation !== context.resourceLocation) {
            throw new Error('QDN manager request is stale because the app view changed while it was running.')
          }
          return result
        }
        const record = isRecord(requestValue) ? requestValue : {}
        const openRequest = validateBookmarksOpenRequest(
          record.request ?? { accountId: record.accountId ?? null, address: record.address },
        )
        const openAccountId = openRequest.accountId ?? context.selectedAccountId
        if (
          openAccountId &&
          !accountCatalogueRef.current.accounts.some((account) => account.id === openAccountId)
        ) {
          throw new Error('BOOKMARKS_OPEN accountId does not match a saved Home account.')
        }
        const opened = await openAddress(openRequest.address, openAccountId)
        if (opened.status !== 'opened') throw new Error(opened.message ?? 'Saved Home link could not be opened.')
        return true
      }
      // The app-facing notification MANAGER family. Android's twin of the
      // desktop dispatch in electron/home-v2-app-bridge.ts: same shared
      // contract module, same durable 'notifications.manage' capability, same
      // always-only prompt, same fail-closed store gate, same revision CAS.
      //
      // qdnRequest-only, matching the bookmarks branch above: this data is
      // Home's profile, not a chain's, so there is no qortalRequest variant of
      // it to intercept.
      if (isAndroidHost && protocol === 'qdnRequest' && isHomeV2NotificationManagerAction(action)) {
        // Parsed BEFORE the permission gate so a malformed request cannot raise
        // a prompt the user would otherwise never see.
        const managerRequest = parseHomeV2NotificationManagerRequest(action, isRecord(requestValue) ? requestValue : {})
        const parsedApp = resolveAppIdentity()
        if (managerRequest.kind === 'has-permission') {
          // Never prompts and never reads the notification store.
          return { granted: await hasQdnManagerPermission(parsedApp.identityKey, 'notifications.manage') }
        }
        if (!await hasQdnManagerPermission(parsedApp.identityKey, 'notifications.manage')) {
          const targetNetwork: NetworkId = 'qortium'
          const appId = brand<AppId>(`home-v2:permission-app:${parsedApp.identityKey}`)
          const prompt = createPermissionPrompt({
            id: brand<PermissionRequestId>(globalThis.crypto.randomUUID()),
            protocol,
            // managerRequest.action, not `action`: the parsed request's type has
            // already excluded NOTIFICATION_MANAGER_HAS_PERMISSION, which is not
            // a promptable action.
            action: managerRequest.action,
            capability: 'notifications.manage',
            appId,
            appIdentityKey: parsedApp.identityKey,
            appTitle: parsedApp.title,
            context: {
              appId,
              identityId: brand<IdentityId>(`home-v2:identity:app:${parsedApp.identityKey}`),
              nodeProfileRef: snapshot.nodes[targetNetwork].ref,
              tabId: brand<TabId>(context.tabId),
              targetNetwork,
              walletRef: null,
            },
            title: 'Allow notification permission management?',
            summary: `${parsedApp.title} wants to review and change which OTHER apps may notify you on this device — muting them, deleting their notification rules, and revoking their notification permission. It cannot create a rule for any app, and it cannot notify you itself without asking separately.`,
            details: [
              { label: 'App', value: parsedApp.title },
              { label: 'Access', value: 'Every app’s notification permission and rules on this device' },
              { label: 'Can do', value: 'Mute an app, delete its notification rules, revoke its notification permission' },
              { label: 'Cannot do', value: 'Create a rule, notify you, or read any masked address, key or signature in a rule' },
            ],
            allowedScopes: ['always'],
          })
          const decision = await queueAndroidPermissionPrompt(prompt, context.tabId)
          if (!decision.approved || decision.scope !== 'always') {
            throw new Error('Home data manager permission was denied.')
          }
          const approvedTab = productStateRef.current.tabs.find((tab) => tab.id === context.tabId)
          if (!approvedTab || approvedTab.context.resourceLocation !== context.resourceLocation) {
            throw new Error('QDN manager request is stale because the app view changed before approval.')
          }
          await grantQdnManagerPermission(parsedApp.identityKey, 'notifications.manage')
        }
        const currentTab = productStateRef.current.tabs.find((tab) => tab.id === context.tabId)
        if (!currentTab || currentTab.context.resourceLocation !== context.resourceLocation) {
          throw new Error('QDN manager request is stale because the app view changed before it could run.')
        }
        const inspection = await inspectNotificationStoreForManagement()
        const result = managerRequest.kind === 'get'
          ? readHomeV2NotificationManagerSummary(inspection)
          // updateNotificationStore re-checks expectedRevision inside its own
          // serialized write chain, so the CAS holds even if another writer
          // lands between the inspection above and the write below.
          : summarizeHomeV2NotificationManagerStore(await updateNotificationStore(
              () => resolveHomeV2NotificationManagerMutation(inspection, managerRequest),
              managerRequest.expectedRevision,
            ))
        const completedTab = productStateRef.current.tabs.find((tab) => tab.id === context.tabId)
        if (!completedTab || completedTab.context.resourceLocation !== context.resourceLocation) {
          throw new Error('QDN manager request is stale because the app view changed while it was running.')
        }
        return result
      }
      if (isAndroidHost && (action === 'NOTIFICATION_HAS_PERMISSION' || action === 'SHOW_NOTIFICATION')) {
        const targetNetwork: NetworkId = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
        const parsedApp = (() => {
          try {
            const parsed = parseAppResourceLocation(context.resourceLocation)
            const identifier = resolveLaunchIdentifier(parsed.identity.identifier, context.resourceLocation)
            return {
              identityKey: sanitizeQdnManagerAppKey(
                buildAppResourceLocation(parsed.sourceNetwork, { ...parsed.identity, identifier }),
              ),
              title: parsed.identity.name,
            }
          } catch {
            throw new Error('Notification request is missing its stable app identity.')
          }
        })()
        const store = await getNotificationStore()
        if (action === 'NOTIFICATION_HAS_PERMISSION') {
          return { granted: !!store.grants[parsedApp.identityKey], network: targetNetwork }
        }
        const notificationRequest = normalizeHomeV2NotificationRequest(protocol, requestValue)
        if (!store.grants[parsedApp.identityKey]) {
          const appId = brand<AppId>(`home-v2:permission-app:${parsedApp.identityKey}`)
          const prompt = createPermissionPrompt({
            id: brand<PermissionRequestId>(globalThis.crypto.randomUUID()),
            protocol,
            action: 'SHOW_NOTIFICATION',
            capability: 'notifications.show',
            appId,
            appIdentityKey: parsedApp.identityKey,
            appTitle: parsedApp.title,
            context: {
              appId,
              identityId: brand<IdentityId>(`home-v2:identity:app:${parsedApp.identityKey}`),
              nodeProfileRef: snapshot.nodes[targetNetwork].ref,
              tabId: brand<TabId>(context.tabId),
              targetNetwork,
              walletRef: null,
            },
            title: 'Allow app notifications?',
            summary: `${parsedApp.title} wants to show system notifications until revoked in Settings.`,
            details: [
              { label: 'App', value: parsedApp.title },
              { label: 'Chain', value: homeV2NotificationChainLabel(targetNetwork) },
              { label: 'Scope', value: 'Until revoked in Settings' },
            ],
            allowedScopes: ['always'],
          })
          const decision = await queueAndroidPermissionPrompt(prompt, context.tabId)
          if (!decision.approved || decision.scope !== 'always') {
            throw new Error('Notification permission was denied.')
          }
          const currentTab = productStateRef.current.tabs.find((tab) => tab.id === context.tabId)
          if (!currentTab || currentTab.context.resourceLocation !== context.resourceLocation) {
            throw new Error('Notification app context changed before approval completed.')
          }
          await grantAppNotifications(parsedApp.identityKey)
        }
        const resultBase = { network: notificationRequest.network, source: notificationRequest.source }
        const currentGrant = (await getNotificationStore()).grants[parsedApp.identityKey]
        if (!currentGrant) return { ...resultBase, shown: false, reason: 'revoked' }
        if (currentGrant.muted) return { ...resultBase, shown: false, reason: 'muted' }
        if (
          notificationPolicyRef.current?.status !== 'available' ||
          !notificationPolicyRef.current.enabled
        ) {
          return { ...resultBase, shown: false, reason: 'disabled' }
        }
        if (
          productStateRef.current.activeTabId === context.tabId &&
          document.visibilityState === 'visible' &&
          document.hasFocus()
        ) {
          return { ...resultBase, shown: false, reason: 'focused' }
        }
        const now = Date.now()
        const lastShownAt = androidLastNotificationAt.current.get(parsedApp.identityKey) ?? 0
        if (now - lastShownAt < HOME_V2_NOTIFICATION_MIN_INTERVAL_MS) {
          return { ...resultBase, shown: false, reason: 'rate-limited' }
        }
        const displayTitle = `${notificationRequest.title} — ${parsedApp.title} · ${homeV2NotificationChainLabel(targetNetwork)}`
        const { LocalNotifications } = await import('@capacitor/local-notifications')
        const permission = await LocalNotifications.requestPermissions()
        if (permission.display !== 'granted') {
          return { ...resultBase, shown: false, reason: 'disabled' }
        }
        const latestGrant = (await getNotificationStore()).grants[parsedApp.identityKey]
        if (
          !latestGrant ||
          latestGrant.muted ||
          notificationPolicyRef.current?.status !== 'available' ||
          !notificationPolicyRef.current.enabled
        ) {
          return { ...resultBase, shown: false, reason: latestGrant?.muted ? 'muted' : latestGrant ? 'disabled' : 'revoked' }
        }
        androidLastNotificationAt.current.set(parsedApp.identityKey, Date.now())
        await LocalNotifications.schedule({
          notifications: [{
            body: notificationRequest.text,
            extra: {
              homeV2Network: targetNetwork,
              homeV2SourceKey: homeV2NotificationSourceKey(notificationRequest.source),
              homeV2TabId: context.tabId,
            },
            id: androidNextNotificationId.current,
            isExactNotification: false,
            title: displayTitle,
          }],
        })
        androidNextNotificationId.current = androidNextNotificationId.current >= 2_000_000_000
          ? 1
          : androidNextNotificationId.current + 1
        return { ...resultBase, shown: true }
      }
      if (isAndroidHost && (action === 'GET_PENDING_TRANSACTIONS' || action === 'FORGET_PENDING_TRANSACTION')) {
        if (!context.selectedAccountId) throw new Error('No account is selected for this tab.')
        const accountId = context.selectedAccountId
        const account = accountCatalogueRef.current.accounts.find((candidate) => candidate.id === accountId)
        if (!account) throw new Error('The selected account is no longer available.')
        const targetNetwork: NetworkId = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
        const parsedApp = resolveAppIdentity()
        const forgetRequest = action === 'FORGET_PENDING_TRANSACTION'
          ? normalizeHomeV2ForgetPendingTransactionRequest(protocol, requestValue)
          : null
        const grantKey = homeV2PermissionGrantKey({
          accountId,
          accountUnlocked: account.isUnlocked,
          action,
          appIdentity: context.resourceLocation,
          nodeRoute: 'route-independent',
          principalId: 'android',
          protocol,
          tabId: context.tabId,
          target: forgetRequest?.signature ? `signature:${forgetRequest.signature}` : '',
        })
        const singleRequestOnly = action === 'FORGET_PENDING_TRANSACTION'
        // Reading the journal is permissionless; forgetting an entry mutates
        // it and still prompts.
        if (singleRequestOnly || (!isHomeV2PermissionlessAction(action) &&
          !androidSessionAccountGrants.current.has(grantKey))) {
          const appId = brand<AppId>(`home-v2:permission-app:${parsedApp.identityKey}`)
          const prompt = createPermissionPrompt({
            id: brand<PermissionRequestId>(globalThis.crypto.randomUUID()),
            protocol,
            action,
            capability: singleRequestOnly ? 'transactions.pending.forget' : 'account.read',
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
            title: singleRequestOnly ? 'Forget pending transaction?' : 'Allow read-only account access?',
            summary: singleRequestOnly
              ? `${parsedApp.title} wants Home to forget one retained transaction after reconciliation.`
              : homeV2AccountReadPermissionSummary(parsedApp.title),
            details: singleRequestOnly
              ? [
                  { label: 'Account', value: account.label },
                  { label: 'Chain', value: targetNetwork === 'qortal' ? 'Qortal' : 'Qortium' },
                  ...(forgetRequest ? [{ label: 'Signature', value: forgetRequest.signature }] : []),
                ]
              : homeV2AccountReadPermissionDetails(account.label),
            allowedScopes: singleRequestOnly ? ['single-request'] : ['single-request', 'session'],
          })
          const decision = await (singleRequestOnly
            ? queueAndroidPermissionPrompt(prompt, context.tabId)
            : queueAndroidSessionGrantPermission(grantKey, prompt, context.tabId))
          if (!decision.approved) throw new Error('Account access was denied.')
          // Self-contained so it is correct at every prompt site and a no-op
          // for anything that is not a chat send. A durable grant that throws
          // or silently fails to persist must not fail the action the user
          // just approved, so it degrades to the session grant below.
          const durableChatSendFailed =
            decision.scope === 'always' &&
            isHomeV2ChatSendAction(action) &&
            !(context.resourceLocation &&
              await persistDurableChatSendGrant(context.resourceLocation))
          if (!singleRequestOnly && (decision.scope === 'session' || durableChatSendFailed)) {
            androidSessionAccountGrants.current.add(grantKey, {
              family: homeV2PermissionGrantFamily(action),
              hostWebContentsId: 'android',
              network: targetNetwork,
              tabId: context.tabId,
            })
          }
          const freshTab = productStateRef.current.tabs.find((tab) => tab.id === context.tabId)
          const freshAccount = accountCatalogueRef.current.accounts.find((candidate) => candidate.id === accountId)
          if (
            selectedAccountId !== accountId ||
            !freshTab ||
            freshTab.context.resourceLocation !== context.resourceLocation ||
            !freshAccount
          ) {
            throw new Error('Account access context changed before approval completed.')
          }
        }
        if (forgetRequest) {
          return {
            forgotten: await forgetAndroidHomeV2PendingTransaction(forgetRequest),
            network: targetNetwork,
            signature: forgetRequest.signature,
          }
        }
        return {
          entries: (await listAndroidHomeV2PendingTransactions({
            accountId,
            appIdentity: parsedApp.identityKey,
            network: targetNetwork,
          })).map(toHomeV2PendingTransactionResult),
          network: targetNetwork,
          version: 1,
        }
      }
      if (isAndroidHost && context.selectedAccountId && isHomeV2JournaledMutation(action)) {
        const targetNetwork: NetworkId = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
        const pending = await findAndroidHomeV2PendingTransactionConflict({
          accountId: context.selectedAccountId,
          action,
          appIdentity: resolveAppIdentity().identityKey,
          network: targetNetwork,
          request: requestValue,
        })
        if (pending) {
          throw Object.assign(
            new Error(`A previous ${action} for this target has an unknown outcome. Reconcile signature ${pending.signature} before submitting another.`),
            {
              action,
              code: 'PENDING_TRANSACTION_RECONCILIATION_REQUIRED',
              network: targetNetwork,
              outcome: 'unknown',
              retryable: false,
            },
          )
        }
      }
      if (
        action === 'UNLOCK_SELECTED_ACCOUNT' ||
        action === 'GET_QDN_RESOURCE_STREAM_URL' ||
        action === 'OPEN_QDN_RESOURCE_VIEWER' ||
        action === 'SAVE_QDN_RESOURCE' ||
        action === 'SELECT_QDN_PUBLISH_SOURCE' ||
        action === 'PUBLISH_QDN_RESOURCE' ||
        action === 'PUBLISH_CHAT_ATTACHMENT' ||
        action === 'GET_PENDING_TRANSACTIONS' ||
        action === 'FORGET_PENDING_TRANSACTION' ||
        action === 'GET_CHAT_ATTACHMENT_STREAM_URL' ||
        action === 'OPEN_CHAT_ATTACHMENT_VIEWER' ||
        action === 'SAVE_CHAT_ATTACHMENT' ||
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
      if (
        isAndroidHost &&
        (action === 'PUBLISH_CHAT_ATTACHMENT' ||
          action === 'GET_CHAT_ATTACHMENT_STREAM_URL' ||
          action === 'OPEN_CHAT_ATTACHMENT_VIEWER' ||
          action === 'SAVE_CHAT_ATTACHMENT')
      ) {
        if (!context.selectedAccountId) throw new Error('No account is selected for this tab.')
        const accountId = context.selectedAccountId
        const account = accountCatalogueRef.current.accounts.find((candidate) => candidate.id === accountId)
        if (!account) throw new Error('The selected account is no longer available.')
        if (!account.isUnlocked) throw new Error('The selected account is locked.')
        const targetNetwork: NetworkId = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
        const nodeBefore = parseHomeV2NodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
        if (!nodeBefore.nodeApiUrl || !nodeBefore.capabilities.read) {
          throw new Error(nodeBefore.error ?? `${targetNetwork} is unavailable.`)
        }
        const hostInfo = await nodeClient.requestApp(protocol, { action: 'GET_HOST_INFO' }, context)
        if (!isRecord(hostInfo) || !isRecord(hostInfo.route) || typeof hostInfo.route.revision !== 'string') {
          throw new Error('Home bridge route identity is unavailable.')
        }
        const nodeRoute = `${nodeBefore.mode}|${nodeBefore.nodeApiUrl}`
        const parsedApp = (() => {
          try {
            const parsed = parseAppResourceLocation(context.resourceLocation)
            const identifier = resolveLaunchIdentifier(parsed.identity.identifier, context.resourceLocation)
            return {
              identityKey: buildAppResourceLocation(parsed.sourceNetwork, { ...parsed.identity, identifier }),
              title: parsed.identity.name,
            }
          } catch {
            return { identityKey: context.resourceLocation || `home-v2-tab:${context.tabId}`, title: 'QDN app' }
          }
        })()
        const appId = brand<AppId>(`home-v2:permission-app:${parsedApp.identityKey}`)
        const isStillValid = async () => {
          const currentTab = productStateRef.current.tabs.find((tab) => tab.id === context.tabId)
          const currentAccount = accountCatalogueRef.current.accounts.find((candidate) => candidate.id === accountId)
          const currentNode = parseHomeV2NodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
          return !!currentTab &&
            currentTab.context.resourceLocation === context.resourceLocation &&
            String(currentTab.context.identityId) === `home-v2:identity:${accountId}` &&
            !!currentAccount?.isUnlocked &&
            currentNode.capabilities.read &&
            `${currentNode.mode}|${currentNode.nodeApiUrl ?? ''}` === nodeRoute
        }
        if (action === 'PUBLISH_CHAT_ATTACHMENT') {
          if (!vaultClient?.publishPrivateAttachment) throw new Error('Private attachment publishing is unavailable on this platform.')
          const publishRequest = normalizeHomeV2PrivateAttachmentPublishRequest(protocol, requestValue)
          const binding: HomeV2PublishSourceBinding = Object.freeze({
            accountId,
            appIdentity: context.resourceLocation || `home-v2-tab:${context.tabId}`,
            network: targetNetwork,
            nodeApiUrl: nodeBefore.nodeApiUrl,
            protocol,
            routeRevision: hostInfo.route.revision,
            tabId: context.tabId,
          })
          const source = homeV2AndroidPublishSources.resolve(publishRequest.sourceToken, binding)
          const primaryValue = await nodeClient.requestApp(
            protocol,
            { action: 'GET_PRIMARY_NAME', address: account.address },
            context,
          )
          if (!isRecord(primaryValue) || primaryValue.owner !== account.address || typeof primaryValue.name !== 'string' || !primaryValue.name.trim()) {
            throw new Error('Publishing a private chat attachment requires a current primary name owned by the selected account.')
          }
          const sourceBytes = decodeHomeV2AndroidPublishSource(source.dataBase64)
          const contentHash = await sha256Hex(sourceBytes)
          sourceBytes.fill(0)
          const opaqueId = globalThis.crypto.randomUUID().replaceAll('-', '')
          const sourceMedia = (() => {
            const bytes = decodeHomeV2AndroidPublishSource(source.dataBase64)
            try {
              return sniffPrivateChatAttachmentMediaType(bytes)
            } finally {
              bytes.fill(0)
            }
          })()
          const hubImage = targetNetwork === 'qortal' && publishRequest.conversation.kind === 'group' &&
            isQortalHubCompatiblePrivateImageMediaType(sourceMedia)
          const service = hubImage ? 'IMAGE' as const : 'QCHAT_ATTACHMENT_PRIVATE' as const
          const identifier = hubImage
            ? `grp-q-manager_0_group_${publishRequest.conversation.groupId}_${opaqueId.slice(0, 16)}`
            : `chat-attachment-${opaqueId}`
          const requestId = brand<PermissionRequestId>(globalThis.crypto.randomUUID())
          const decision = await queueAndroidPermissionPrompt(createPermissionPrompt({
            id: requestId,
            protocol,
            action,
            capability: 'chat.attachment',
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
            title: 'Allow encrypted attachment publication?',
            summary: `${parsedApp.title} wants to encrypt and publish a private chat attachment as the selected account.`,
            details: [
              { label: 'Account', value: account.label },
              { label: 'Chain', value: targetNetwork === 'qortal' ? 'Qortal' : 'Qortium' },
              { label: 'Route', value: `${nodeBefore.mode} · ${nodeBefore.nodeApiUrl}` },
              { label: 'Resource', value: `${service}/${primaryValue.name}/${identifier}` },
              { label: 'File', value: source.fileName },
              { label: 'Size', value: `${source.size.toLocaleString()} bytes` },
              { label: 'SHA-256', value: contentHash },
            ],
            allowedScopes: ['single-request'],
          }), context.tabId)
          if (!decision.approved) throw new Error('Private attachment publication was denied.')
          if (!(await isStillValid())) throw new Error('The app, account, or node route changed before private attachment publishing.')
          const result = await vaultClient.publishPrivateAttachment({
            accountId,
            conversation: publishRequest.conversation,
            fileName: source.fileName,
            identifier,
            isStillValid,
            network: targetNetwork,
            nodeApiUrl: nodeBefore.nodeApiUrl,
            publisherName: primaryValue.name.trim(),
            service,
            sourceBase64: source.dataBase64,
          })
          if (isRecord(result) && (result.accepted === true || result.outcome === 'unknown')) {
            homeV2AndroidPublishSources.release(publishRequest.sourceToken)
          }
          return retainUnknownTransaction(result)
        }
        if (!vaultClient?.decryptPrivateAttachment) throw new Error('Private attachment decryption is unavailable on this platform.')
        const { descriptor } = normalizeHomeV2PrivateAttachmentAccessRequest(protocol, requestValue)
        const requestId = brand<PermissionRequestId>(globalThis.crypto.randomUUID())
        const operation = action === 'SAVE_CHAT_ATTACHMENT'
          ? 'save'
          : action === 'OPEN_CHAT_ATTACHMENT_VIEWER'
            ? 'view'
            : 'stream'
        const readOnlyAttachment = isHomeV2AccountReadAction(action)
        const grantKey = homeV2PermissionGrantKey({
          accountId,
          accountUnlocked: account.isUnlocked,
          action,
          appIdentity: context.resourceLocation,
          nodeRoute,
          principalId: 'android',
          protocol,
          tabId: context.tabId,
          target: `${descriptor.resource.service}/${descriptor.resource.name}/${descriptor.resource.identifier}`,
        })
        // A durable per-app account-read grant ("always allow") skips the
        // prompt; it is revocable in QDN Apps settings. Mirrors the desktop
        // bridge. Returns null for SAVE_CHAT_ATTACHMENT and
        // PUBLISH_CHAT_ATTACHMENT, which are not account-read actions and
        // keep prompting single-request.
        const attachmentReadCapability = homeV2DurableAccountReadCapability(action)
        const attachmentAppCapabilityKey = context.resourceLocation || ''
        // Bound to the canonical resource principal AND the selected account,
        // matching the desktop bridge.
        const heldAttachmentReadGrant = attachmentReadCapability && attachmentAppCapabilityKey
          ? await hasQdnAccountCapability(
              attachmentAppCapabilityKey,
              accountId,
              attachmentReadCapability,
            )
          : false
        if (!heldAttachmentReadGrant &&
          (!readOnlyAttachment || !androidSessionAccountGrants.current.has(grantKey))) {
          const prompt = createPermissionPrompt({
            id: requestId,
            protocol,
            action,
            capability: readOnlyAttachment ? 'account.read' : 'chat.attachment',
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
            // Wording only: a read keeps capability 'account.read' above, so
            // it stays in the one unified grant family. It just names the
            // attachment instead of describing itself as generic account
            // access. Mirrors the desktop bridge.
            title: readOnlyAttachment
              ? homeV2AccountReadPromptTitle('attachment')
              : `Allow private attachment ${operation}?`,
            summary: readOnlyAttachment
              ? homeV2AccountReadPromptSummary('attachment', parsedApp.title)
              : `${parsedApp.title} wants to decrypt and ${operation} a private chat attachment.`,
            details: [
              { label: 'Account', value: account.label },
              { label: 'Chain', value: targetNetwork === 'qortal' ? 'Qortal' : 'Qortium' },
              { label: 'Route', value: `${nodeBefore.mode} · ${nodeBefore.nodeApiUrl}` },
              { label: 'Resource', value: `${descriptor.resource.service}/${descriptor.resource.name}/${descriptor.resource.identifier}` },
              { label: 'Ciphertext size', value: `${descriptor.ciphertext.size.toLocaleString()} bytes` },
              { label: 'Ciphertext SHA-256', value: descriptor.ciphertext.hash },
              ...(attachmentReadCapability ? [homeV2AccountReadAlwaysAllowDetail(account.label)] : []),
            ],
            allowedScopes: attachmentReadCapability
              ? ['single-request', 'session', 'always']
              : readOnlyAttachment ? ['single-request', 'session'] : ['single-request'],
          })
          const decision = await (readOnlyAttachment
            ? queueAndroidSessionGrantPermission(grantKey, prompt, context.tabId)
            : queueAndroidPermissionPrompt(prompt, context.tabId))
          if (!decision.approved) throw new Error('Private attachment access was denied.')
          // Gated on attachmentReadCapability, not on the scope alone, so an
          // 'always' this prompt never offered cannot become a durable grant.
          if (
            decision.scope === 'always' &&
            attachmentReadCapability &&
            attachmentAppCapabilityKey
          ) {
            // Verified, not assumed: a write that throws OR silently drops
            // the key falls back to the session grant recorded below.
            await persistDurableAccountReadGrant(
              attachmentAppCapabilityKey,
              accountId,
              attachmentReadCapability,
            )
          }
          if (readOnlyAttachment && (decision.scope === 'session' || decision.scope === 'always')) {
            androidSessionAccountGrants.current.add(grantKey, {
              family: homeV2PermissionGrantFamily(action),
              hostWebContentsId: 'android',
              network: targetNetwork,
              tabId: context.tabId,
            })
          }
        }
        const decrypted = await vaultClient.decryptPrivateAttachment({
          accountId,
          descriptor,
          isStillValid,
          nodeApiUrl: nodeBefore.nodeApiUrl,
        })
        const bytes = decodeHomeV2AndroidPublishSource(decrypted.dataBase64)
        try {
          if (!(await isStillValid())) throw new Error('The app, account, or node route changed after attachment decryption.')
          if (action === 'SAVE_CHAT_ATTACHMENT') {
            const { saveBytesToFile } = await import('../platform')
            return saveBytesToFile(decrypted.fileName, bytes, decrypted.mediaType)
          }
          const { authorizeHomeV2AndroidPrivateBytesStream } = await import('./android-app-host')
          const streamUrl = await authorizeHomeV2AndroidPrivateBytesStream(
            decrypted.dataBase64,
            decrypted.mediaType,
            JSON.stringify({
              accountId,
              appIdentity: context.resourceLocation || `home-v2-tab:${context.tabId}`,
              network: targetNetwork,
              protocol,
              routeRevision: hostInfo.route.revision,
              tabId: context.tabId,
            }),
          )
          if (action === 'GET_CHAT_ATTACHMENT_STREAM_URL') return streamUrl
          setResourceViewer({
            filename: decrypted.fileName,
            identifier: descriptor.resource.identifier,
            mimeType: decrypted.mediaType,
            name: descriptor.resource.name,
            network: targetNetwork,
            path: null,
            service: descriptor.resource.service,
            sourceTabId: context.tabId,
            streamUrl,
          })
          return true
        } finally {
          bytes.fill(0)
        }
      }
      if (isAndroidHost && (action === 'SELECT_QDN_PUBLISH_SOURCE' || action === 'PUBLISH_QDN_RESOURCE')) {
        if (!context.selectedAccountId) throw new Error('No account is selected for this tab.')
        const accountId = context.selectedAccountId
        const account = accountCatalogueRef.current.accounts.find((candidate) => candidate.id === accountId)
        if (!account) throw new Error('The selected account is no longer available.')
        const targetNetwork: NetworkId = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
        const nodeBefore = parseHomeV2NodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
        if (!nodeBefore.nodeApiUrl || !nodeBefore.capabilities.read) {
          throw new Error(nodeBefore.error ?? `${targetNetwork} is unavailable.`)
        }
        const hostInfo = await nodeClient.requestApp(protocol, { action: 'GET_HOST_INFO' }, context)
        if (!isRecord(hostInfo) || !isRecord(hostInfo.route) || typeof hostInfo.route.revision !== 'string') {
          throw new Error('Home bridge route identity is unavailable.')
        }
        const binding: HomeV2PublishSourceBinding = Object.freeze({
          accountId,
          appIdentity: context.resourceLocation || `home-v2-tab:${context.tabId}`,
          network: targetNetwork,
          nodeApiUrl: nodeBefore.nodeApiUrl,
          protocol,
          routeRevision: hostInfo.route.revision,
          tabId: context.tabId,
        })
        if (action === 'SELECT_QDN_PUBLISH_SOURCE') {
          return selectHomeV2AndroidPublishSource(binding)
        }
        if (!account.isUnlocked) throw new Error('The selected account is locked.')
        if (!vaultClient?.publishPublicResource) {
          throw new Error('Public QDN publishing is unavailable on this platform.')
        }
        const publishRequest = normalizeHomeV2PublicPublishRequest(
          targetNetwork,
          isRecord(requestValue) ? requestValue : {},
        )
        const source = homeV2AndroidPublishSources.resolve(publishRequest.sourceToken, binding)
        const nameValue = await nodeClient.requestApp(
          protocol,
          { action: 'GET_NAME_DATA', name: publishRequest.resource.name },
          context,
        )
        if (!isRecord(nameValue) || nameValue.owner !== account.address) {
          throw new Error('The selected account does not currently own the requested publisher name on this chain.')
        }
        const contentHash = await sha256Hex(decodeHomeV2AndroidPublishSource(source.dataBase64))
        const requestId = brand<PermissionRequestId>(
          globalThis.crypto.randomUUID?.() ?? `home-v2-permission-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
            return { identityKey: binding.appIdentity, title: 'QDN app' }
          }
        })()
        const appId = brand<AppId>(`home-v2:permission-app:${parsedApp.identityKey}`)
        const decision = await queueAndroidPermissionPrompt(createPermissionPrompt({
          id: requestId,
          protocol,
          action: 'PUBLISH_QDN_RESOURCE',
          capability: 'qdn.publish',
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
          title: 'Allow public resource publication?',
          summary: `${parsedApp.title} wants to publish a public resource as the selected account.`,
          details: [
            { label: 'Account', value: account.label },
            { label: 'Chain', value: targetNetwork === 'qortal' ? 'Qortal' : 'Qortium' },
            { label: 'Route', value: `${nodeBefore.mode} · ${nodeBefore.nodeApiUrl}` },
            { label: 'Resource', value: `${publishRequest.resource.service}/${publishRequest.resource.name}/${publishRequest.resource.identifier ?? 'default'}` },
            { label: 'File', value: source.fileName },
            { label: 'Size', value: `${source.size.toLocaleString()} bytes` },
            { label: 'SHA-256', value: contentHash },
          ],
          allowedScopes: ['single-request'],
        }), context.tabId)
        if (!decision.approved) throw new Error('Public resource publication was denied.')
        const nodeRoute = `${nodeBefore.mode}|${nodeBefore.nodeApiUrl}`
        const isStillValid = async () => {
          const currentTab = productStateRef.current.tabs.find((tab) => tab.id === context.tabId)
          const currentAccount = accountCatalogueRef.current.accounts.find((candidate) => candidate.id === accountId)
          const currentNode = parseHomeV2NodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
          return !!currentTab &&
            currentTab.context.resourceLocation === context.resourceLocation &&
            String(currentTab.context.identityId) === `home-v2:identity:${accountId}` &&
            !!currentAccount?.isUnlocked &&
            currentNode.capabilities.read &&
            `${currentNode.mode}|${currentNode.nodeApiUrl ?? ''}` === nodeRoute
        }
        if (!(await isStillValid())) throw new Error('The app, account, or node route changed before public publishing.')
        const currentNameValue = await nodeClient.requestApp(
          protocol,
          { action: 'GET_NAME_DATA', name: publishRequest.resource.name },
          context,
        )
        if (!isRecord(currentNameValue) || currentNameValue.owner !== account.address || !(await isStillValid())) {
          throw new Error('Publisher-name ownership or the app context changed after approval.')
        }
        const result = await vaultClient.publishPublicResource({
          accountId,
          fileName: source.fileName,
          isStillValid,
          network: targetNetwork,
          nodeApiUrl: nodeBefore.nodeApiUrl,
          resource: publishRequest.resource,
          sourceBase64: source.dataBase64,
        })
        if (isRecord(result) && (result.accepted === true || result.outcome === 'unknown')) {
          homeV2AndroidPublishSources.release(publishRequest.sourceToken)
        }
        return retainUnknownTransaction(result)
      }
      if (action === 'GET_QDN_RESOURCE_STREAM_URL') {
        if (!isAndroidHost) return nodeClient.requestApp(protocol, requestValue, context)
        const [rawUrl, hostInfo] = await Promise.all([
          nodeClient.requestApp(protocol, requestValue, context),
          nodeClient.requestApp(protocol, { action: 'GET_HOST_INFO' }, context),
        ])
        if (typeof rawUrl !== 'string') throw new Error('Resource stream URL response was invalid.')
        if (!isRecord(hostInfo) || !isRecord(hostInfo.route) || typeof hostInfo.route.revision !== 'string') {
          throw new Error('Home bridge route identity is unavailable.')
        }
        const resource = getQdnResourceStreamRequest(requestValue as QdnAppRequest)
        const network = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
        const { authorizeHomeV2AndroidResourceStream } = await import('./android-app-host')
        return authorizeHomeV2AndroidResourceStream(
          rawUrl,
          getQdnResourceStreamProxyMimeType(resource),
          JSON.stringify({
            accountId: context.selectedAccountId,
            appIdentity: context.resourceLocation || `home-v2-tab:${context.tabId}`,
            network,
            protocol,
            routeRevision: hostInfo.route.revision,
            tabId: context.tabId,
          }),
        )
      }
      if (action === 'OPEN_QDN_RESOURCE_VIEWER') {
        if (!isAndroidHost) return nodeClient.requestApp(protocol, requestValue, context)
        const [raw, hostInfo] = await Promise.all([
          nodeClient.requestApp(protocol, requestValue, context),
          nodeClient.requestApp(protocol, { action: 'GET_HOST_INFO' }, context),
        ])
        const parsed = parseHomeV2ResourceViewerState(raw)
        if (!parsed) throw new Error('Resource viewer response was invalid.')
        if (!isRecord(hostInfo) || !isRecord(hostInfo.route) || typeof hostInfo.route.revision !== 'string') {
          throw new Error('Home bridge route identity is unavailable.')
        }
        const resource = getQdnResourceViewerRequest(requestValue as QdnAppRequest)
        const network = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
        const { authorizeHomeV2AndroidResourceStream } = await import('./android-app-host')
        setResourceViewer({
          ...parsed,
          streamUrl: await authorizeHomeV2AndroidResourceStream(
            parsed.streamUrl,
            getQdnResourceStreamProxyMimeType(resource),
            JSON.stringify({
              accountId: context.selectedAccountId,
              appIdentity: context.resourceLocation || `home-v2-tab:${context.tabId}`,
              network,
              protocol,
              routeRevision: hostInfo.route.revision,
              tabId: context.tabId,
            }),
          ),
        })
        return true
      }
      if (action === 'UNLOCK_SELECTED_ACCOUNT') {
        // No protocol guard: unlocking is a Home-account operation with no
        // chain semantics — the same wallet, the same password dialog, the
        // same key, whichever global asked — and the legacy wallet app reaches
        // it through qortalRequest. UNLOCK is advertised on Android on both
        // protocols (home-v2-app-actions.ts / getHomeV2ContextualAppActions),
        // so this handler must accept both too, or SHOW_ACTIONS would lie.
        if (!vaultClient || !context.selectedAccountId) throw new Error('No account is selected for this tab.')
        const account = accountCatalogueRef.current.accounts.find(
          (candidate) => candidate.id === context.selectedAccountId,
        )
        if (!account) throw new Error('The selected account is no longer available.')
        // Bind the route recheck to the network the REQUEST is on, not a fixed
        // chain. UNLOCK is advertised on both protocols; a qortalRequest unlock
        // establishes availability against the Qortal route, so the
        // before/after snapshots must both read that same route. Snapshotting
        // `.qortium` unconditionally missed a Qortal route change during the
        // password dialog (a stale approval) and spuriously rejected a Qortal
        // unlock whenever the unrelated Qortium route changed. `targetNetwork`
        // is used at BOTH snapshot sites so they cannot disagree.
        const targetNetwork: NetworkId = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
        const nodeBefore = parseHomeV2NodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
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
              const nodeAfter = parseHomeV2NodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
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
        const nodeBefore = parseHomeV2NodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
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
        const grantKey = homeV2PermissionGrantKey({
          accountId,
          accountUnlocked: account.isUnlocked,
          action,
          appIdentity: context.resourceLocation,
          nodeRoute,
          principalId: 'android',
          protocol,
          tabId: context.tabId,
          target: `group:${membershipRequest.groupId}`,
        })
        // Read-only actions are permissionless (owner decision 2026-08-24);
        // mirrors the desktop bridge. Sends and mutations still gate.
        // A durable per-app chat-send grant ("always allow") skips the prompt;
        // it is revocable in QDN Apps settings. Mirrors the desktop bridge.
        const chatSendGrantable = isHomeV2ChatSendAction(action)
        const appCapabilityKey = context.resourceLocation || ''
        const heldChatSendGrant = chatSendGrantable && appCapabilityKey
          ? await hasQdnAppCapability(appCapabilityKey, 'chat.send')
          : false
        if (!heldChatSendGrant && !isHomeV2PermissionlessAction(action) &&
          !androidSessionAccountGrants.current.has(grantKey)) {
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
            allowedScopes: isHomeV2ChatSendAction(action)
              ? ['single-request', 'session', 'always']
              : ['single-request', 'session'],
          })
          const decision = await queueAndroidPermissionPrompt(prompt, context.tabId)
          if (!decision.approved) throw new Error('Account access was denied.')
          // Self-contained so it is correct at every prompt site and a no-op
          // for anything that is not a chat send. A durable grant that throws
          // or silently fails to persist must not fail the action the user
          // just approved, so it degrades to the session grant below.
          const durableChatSendFailed =
            decision.scope === 'always' &&
            isHomeV2ChatSendAction(action) &&
            !(context.resourceLocation &&
              await persistDurableChatSendGrant(context.resourceLocation))
          if (decision.scope === 'session' || durableChatSendFailed) {
            androidSessionAccountGrants.current.add(grantKey, {
              family: homeV2PermissionGrantFamily(action),
              hostWebContentsId: 'android',
              network: targetNetwork,
              tabId: context.tabId,
            })
          }
          const freshTab = productStateRef.current.tabs.find((tab) => tab.id === context.tabId)
          const freshAccount = accountCatalogueRef.current.accounts.find(
            (candidate) => candidate.id === accountId,
          )
          const nodeAfter = parseHomeV2NodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
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
          const nodeNow = parseHomeV2NodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
          return `${nodeNow.mode}|${nodeNow.nodeApiUrl ?? ''}` === nodeRoute
        }
        if (!(await checkStillValid())) {
          throw new Error('Account access context changed before the group action could start.')
        }
        return retainUnknownTransaction(await vaultClient.sendGroupMembership({
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
        }))
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
        const nodeBefore = parseHomeV2NodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
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
          const nodeNow = parseHomeV2NodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
          return `${nodeNow.mode}|${nodeNow.nodeApiUrl ?? ''}` === nodeRoute
        }
        if (!(await checkStillValid())) {
          throw new Error('Account access context changed before the group action could start.')
        }
        const rateLimitDecision = androidChatSendRateLimiter.current.checkAndRecordSend(
          `${context.tabId}|${accountId}`,
        )
        if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
        return retainUnknownTransaction(await vaultClient.sendGroupAdmin({
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
        }))
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
        const nodeBefore = parseHomeV2NodesSnapshot(await nodeClient.getSnapshot())[privateGroupNetwork]
        if (!nodeBefore.nodeApiUrl || !nodeBefore.capabilities.read) {
          throw new Error(nodeBefore.error ?? `${privateGroupNetwork === 'qortium' ? 'Qortium' : 'Qortal'} is unavailable.`)
        }
        const nodeRoute = `${nodeBefore.mode}|${nodeBefore.nodeApiUrl}`
        const groupId = privateRequest.groupId ?? 0
        const senderPublicKey = await vaultClient.getSigningPublicKey(accountId)
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
        const grantKey = homeV2PermissionGrantKey({
          accountId,
          accountUnlocked: account.isUnlocked,
          action,
          appIdentity: context.resourceLocation,
          nodeRoute,
          principalId: 'android',
          protocol,
          tabId: context.tabId,
          target: `private-group:${groupId || 'active'}`,
        })
        const singleRequestOnly = isWrite && (
          action === 'REQUEST_PRIVATE_GROUP_CHAT_KEY' ||
          action === 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS' ||
          action === 'ROTATE_PRIVATE_GROUP_CHAT_KEY'
        )
        // A durable per-app account-read grant ("always allow") skips the
        // prompt; it is revocable in QDN Apps settings. Mirrors the desktop
        // bridge, including the null-for-non-members rule that keeps every
        // private-group WRITE and key operation prompting.
        const privateGroupReadCapability = singleRequestOnly
          ? null
          : homeV2DurableAccountReadCapability(action)
        const appCapabilityKey = context.resourceLocation || ''
        // Bound to the canonical resource principal AND the selected account,
        // matching the desktop bridge.
        const heldAccountReadGrant = privateGroupReadCapability && appCapabilityKey
          ? await hasQdnAccountCapability(appCapabilityKey, accountId, privateGroupReadCapability)
          : false
        if (!heldAccountReadGrant &&
          (singleRequestOnly || !androidSessionAccountGrants.current.has(grantKey))) {
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
            ? 'account.read'
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
            // Wording only: a private-group read keeps capability
            // 'account.read' above, so it stays in the one unified grant
            // family. It just stops describing itself as generic account
            // access. Mirrors the desktop bridge.
            title: !isWrite
              ? homeV2AccountReadPromptTitle('private-group')
              : `Allow ${operationLabel.toLowerCase()}?`,
            summary: !isWrite
              ? homeV2AccountReadPromptSummary('private-group', parsedApp.title)
              : `${parsedApp.title} wants to ${operationLabel.toLowerCase()} as the selected account.`,
            details: [
              { label: 'Account', value: account.label },
              { label: 'Operation', value: operationLabel },
              ...(isWrite && !singleRequestOnly
                ? [{ label: 'Tab approval', value: 'Send, edit, delete, and react in this private group' }]
                : []),
              { label: 'Chain', value: privateGroupNetwork === 'qortium' ? 'Qortium' : 'Qortal' },
              { label: 'Route', value: `${nodeBefore.mode} · ${nodeBefore.nodeApiUrl}` },
              ...(groupId ? [{ label: 'Group', value: String(groupId) }] : []),
              ...(privateWriteRequest?.message
                ? [{ label: 'Message', value: privateWriteRequest.message.slice(0, 180) }]
                : []),
              ...(privateWriteRequest?.chatReference
                ? [{ label: 'Reference', value: privateWriteRequest.chatReference }]
                : []),
              ...(privateGroupReadCapability ? [homeV2AccountReadAlwaysAllowDetail(account.label)] : []),
            ],
            allowedScopes: singleRequestOnly
              ? ['single-request']
              : privateGroupReadCapability
                ? ['single-request', 'session', 'always']
                : ['single-request', 'session'],
          })
          const decision = await (!isWrite
            ? queueAndroidSessionGrantPermission(grantKey, prompt, context.tabId)
            : queueAndroidPermissionPrompt(prompt, context.tabId))
          if (!decision.approved) throw new Error('Account access was denied.')
          // Self-contained so it is correct at every prompt site and a no-op
          // for anything that is not a chat send. A durable grant that throws
          // or silently fails to persist must not fail the action the user
          // just approved, so it degrades to the session grant below.
          const durableChatSendFailed =
            decision.scope === 'always' &&
            isHomeV2ChatSendAction(action) &&
            !(context.resourceLocation &&
              await persistDurableChatSendGrant(context.resourceLocation))
          // Gated on privateGroupReadCapability, not on the scope alone, so an
          // 'always' that this prompt never offered cannot become a durable
          // grant. Mirrors the desktop bridge.
          if (
            decision.scope === 'always' &&
            privateGroupReadCapability &&
            appCapabilityKey
          ) {
            // Verified, not assumed: a write that throws OR silently drops
            // the key falls back to the session grant recorded below.
            await persistDurableAccountReadGrant(
              appCapabilityKey,
              accountId,
              privateGroupReadCapability,
            )
          }
          if (!singleRequestOnly &&
            (decision.scope === 'session' ||
              durableChatSendFailed ||
              (decision.scope === 'always' && privateGroupReadCapability))) {
            androidSessionAccountGrants.current.add(grantKey, {
              family: homeV2PermissionGrantFamily(action),
              hostWebContentsId: 'android',
              network: privateGroupNetwork,
              tabId: context.tabId,
            })
          }
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
          const nodesNow = await nodeClient.getSnapshot().then(parseHomeV2NodesSnapshot).catch(() => null)
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
          // The vault helper re-reads the dedicated private-group state and
          // compares its epoch immediately before signing. Do not duplicate
          // that check through generic FETCH_NODE_API: `/chat/private/...`
          // deliberately remains outside the app-visible read allowlist.
          void currentEpochId
        }
        if (!singleRequestOnly) {
          const rateLimitDecision = androidChatSendRateLimiter.current.checkAndRecordSend(
            `${context.tabId}|${accountId}`,
          )
          if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
        }
        return retainUnknownTransaction(await vaultClient.sendPrivateGroupChat({
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
        }))
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
        const nodeBefore = parseHomeV2NodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
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
        const grantKey = homeV2PermissionGrantKey({
          accountId,
          accountUnlocked: account.isUnlocked,
          action,
          appIdentity: context.resourceLocation,
          nodeRoute,
          principalId: 'android',
          protocol,
          tabId: context.tabId,
          target: `direct:${otherAddress}`,
        })
        // Read-only actions are permissionless (owner decision 2026-08-24);
        // mirrors the desktop bridge. Sends and mutations still gate.
        // A durable per-app chat-send grant ("always allow") skips the prompt;
        // it is revocable in QDN Apps settings. Mirrors the desktop bridge.
        const chatSendGrantable = isHomeV2ChatSendAction(action)
        const appCapabilityKey = context.resourceLocation || ''
        const heldChatSendGrant = chatSendGrantable && appCapabilityKey
          ? await hasQdnAppCapability(appCapabilityKey, 'chat.send')
          : false
        if (!heldChatSendGrant && !isHomeV2PermissionlessAction(action) &&
          !androidSessionAccountGrants.current.has(grantKey)) {
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
            capability: isWrite ? 'chat.direct.send' : 'account.read',
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
            title: isWrite ? `Allow ${operationLabel.toLowerCase()}?` : 'Allow read-only account access?',
            summary: isWrite
              ? `${parsedApp.title} wants to ${operationLabel.toLowerCase()} as the selected account.`
              : homeV2AccountReadPermissionSummary(parsedApp.title),
            details: isWrite
              ? [
                  { label: 'Account', value: account.label },
                  { label: 'Operation', value: operationLabel },
                  { label: 'Tab approval', value: 'Send, edit, delete, and react in this conversation' },
                  { label: 'Chain', value: targetNetwork === 'qortal' ? 'Qortal' : 'Qortium' },
                  { label: 'Route', value: `${nodeBefore.mode} · ${nodeBefore.nodeApiUrl}` },
                  { label: 'Conversation', value: otherAddress },
                  ...(directWriteRequest
                    ? [{ label: 'Message', value: directWriteRequest.message.slice(0, 180) }]
                    : []),
                  ...(directWriteRequest?.chatReference
                    ? [{ label: 'Reference', value: directWriteRequest.chatReference }]
                    : []),
                ]
              : homeV2AccountReadPermissionDetails(account.label),
            allowedScopes: isHomeV2ChatSendAction(action)
              ? ['single-request', 'session', 'always']
              : ['single-request', 'session'],
          })
          const decision = await (isWrite
            ? queueAndroidPermissionPrompt(prompt, context.tabId)
            : queueAndroidSessionGrantPermission(grantKey, prompt, context.tabId))
          if (!decision.approved) throw new Error('Account access was denied.')
          // Self-contained so it is correct at every prompt site and a no-op
          // for anything that is not a chat send. A durable grant that throws
          // or silently fails to persist must not fail the action the user
          // just approved, so it degrades to the session grant below.
          const durableChatSendFailed =
            decision.scope === 'always' &&
            isHomeV2ChatSendAction(action) &&
            !(context.resourceLocation &&
              await persistDurableChatSendGrant(context.resourceLocation))
          if (decision.scope === 'session' || durableChatSendFailed) {
            androidSessionAccountGrants.current.add(grantKey, {
              family: homeV2PermissionGrantFamily(action),
              hostWebContentsId: 'android',
              network: targetNetwork,
              tabId: context.tabId,
            })
          }
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
          const nodeNow = await nodeClient.getSnapshot().then(parseHomeV2NodesSnapshot).catch(() => null)
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
        return retainUnknownTransaction(await vaultClient.sendDirectChat({
          accountId,
          action,
          chatReference: directWriteRequest.chatReference,
          isStillValid: checkDirectStillValid,
          message: directWriteRequest.message,
          network: targetNetwork,
          nodeApiUrl: nodeBefore.nodeApiUrl,
          otherAddress: directWriteRequest.otherAddress,
          validateTarget: validateApprovedDirectTarget,
        }))
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
        const nodeBefore = parseHomeV2NodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
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
        const grantKey = homeV2PermissionGrantKey({
          accountId,
          accountUnlocked: account.isUnlocked,
          action: effectiveAction,
          appIdentity: context.resourceLocation,
          nodeRoute,
          principalId: 'android',
          protocol,
          tabId: context.tabId,
          target: `public-group:${chatRequest.txGroupId}`,
        })
        // Read-only actions are permissionless (owner decision 2026-08-24);
        // mirrors the desktop bridge. Sends and mutations still gate.
        // A durable per-app chat-send grant ("always allow") skips the prompt;
        // it is revocable in QDN Apps settings. Mirrors the desktop bridge.
        const chatSendGrantable = isHomeV2ChatSendAction(action)
        const appCapabilityKey = context.resourceLocation || ''
        const heldChatSendGrant = chatSendGrantable && appCapabilityKey
          ? await hasQdnAppCapability(appCapabilityKey, 'chat.send')
          : false
        if (!heldChatSendGrant && !isHomeV2PermissionlessAction(action) &&
          !androidSessionAccountGrants.current.has(grantKey)) {
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
              { label: 'Tab approval', value: 'Send, edit, delete, and react in public chats' },
              { label: 'Chain', value: `${targetChainLabel} · ${groupLabel}` },
              { label: 'Message', value: chatRequest.message.slice(0, 180) },
              ...(chatRequest.chatReference
                ? [{ label: 'Reference', value: chatRequest.chatReference }]
                : []),
            ],
            allowedScopes: isHomeV2ChatSendAction(action)
              ? ['single-request', 'session', 'always']
              : ['single-request', 'session'],
          })
          const decision = await queueAndroidPermissionPrompt(prompt, context.tabId)
          if (!decision.approved) throw new Error('Account access was denied.')
          // Self-contained so it is correct at every prompt site and a no-op
          // for anything that is not a chat send. A durable grant that throws
          // or silently fails to persist must not fail the action the user
          // just approved, so it degrades to the session grant below.
          const durableChatSendFailed =
            decision.scope === 'always' &&
            isHomeV2ChatSendAction(action) &&
            !(context.resourceLocation &&
              await persistDurableChatSendGrant(context.resourceLocation))
          if (decision.scope === 'session' || durableChatSendFailed) {
            androidSessionAccountGrants.current.add(grantKey, {
              family: homeV2PermissionGrantFamily(effectiveAction),
              hostWebContentsId: 'android',
              network: targetNetwork,
              tabId: context.tabId,
            })
          }
          const freshTab = productState.tabs.find((tab) => tab.id === context.tabId)
          const freshAccount = accountCatalogueRef.current.accounts.find(
            (candidate) => candidate.id === accountId,
          )
          const nodeAfter = parseHomeV2NodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
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
            selectedAccountId !== accountId ||
            !freshTab ||
            freshTab.context.resourceLocation !== context.resourceLocation ||
            !freshAccount?.isUnlocked
          ) {
            return false
          }
          const nodeNow = await nodeClient.getSnapshot().then(parseHomeV2NodesSnapshot).catch(() => null)
          const nodeSummary = nodeNow?.[targetNetwork]
          return !!nodeSummary?.nodeApiUrl && `${nodeSummary.mode}|${nodeSummary.nodeApiUrl}` === nodeRoute
        }
        const nodeBeforeSend = parseHomeV2NodesSnapshot(await nodeClient.getSnapshot())[targetNetwork]
        if (!nodeBeforeSend.nodeApiUrl || !(await checkChatSendStillValid())) {
          throw new Error('Account access context changed before approval completed.')
        }
        return retainUnknownTransaction(await vaultClient.sendChatMessage({
          accountId,
          action: effectiveAction,
          chatReference: chatRequest.chatReference,
          isStillValid: checkChatSendStillValid,
          message: chatRequest.message,
          network: targetNetwork,
          nodeApiUrl: nodeBeforeSend.nodeApiUrl,
          txGroupId: chatRequest.txGroupId,
          validateTarget,
        }))
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
      // Read-only identity access is permissionless (owner decision,
      // 2026-08-24): Home never hands an app key material, so a read exposes
      // only what the app is trusted with once opened. The prompt, its
      // session grant and the post-approval context recheck are gone with it
      // — the recheck existed solely to close the await-the-user window.
      // Everything that sends, publishes, spends or unlocks still gates.
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
    [applyCollectionsSnapshot, collectionsClient, nodeClient, openAddress, productState.tabs, queueAndroidPermissionPrompt, queueAndroidSessionGrantPermission, selectedAccountId, snapshot.nodes, vaultClient],
  )

  const setNodeMode = async (
    network: NetworkId,
    mode: NodeConnectionMode,
  ) => {
    if (network === 'qortium' && onChainCoreUpdates.busy === 'install') {
      setShellNotice('Wait for the approved Core update request before changing the Qortium node.')
      return
    }
    invalidateAndroidRuntime('node-changed', null, network)
    window.homeV2Apps?.invalidateRuntime({ kind: 'node-changed', network })
    setIdentityLookup(null)
    await nodeCoreController.setNodeMode(network, mode)
  }

  const openCustomNode = (network: NetworkId) => {
    setCustomNetwork(network)
    setCustomUrl(snapshot.nodes[network].customUrl ?? '')
    setCustomApiKey('')
    setRemoveCustomApiKey(false)
    setCustomError(null)
  }

  const closeCustomNode = () => {
    setCustomApiKey('')
    setRemoveCustomApiKey(false)
    setCustomError(null)
    setCustomNetwork(null)
  }

  const saveCustomNode = async () => {
    if (!customNetwork) return
    if (
      customNetwork === 'qortium' &&
      onChainCoreUpdates.busy === 'install'
    ) {
      setCustomError('Wait for the approved Core update request before changing the Qortium node.')
      return
    }
    invalidateAndroidRuntime('node-changed', null, customNetwork)
    window.homeV2Apps?.invalidateRuntime({ kind: 'node-changed', network: customNetwork })
    setIdentityLookup(null)
    setCustomError(null)
    try {
      const apiKey = isAndroidHost && customNetwork === 'qortium'
        ? removeCustomApiKey
          ? ''
          : customApiKey.trim() || undefined
        : undefined
      const saved = await nodeCoreController.saveCustomNode(
        customNetwork,
        customUrl,
        apiKey,
      )
      if (saved) {
        if (customNetwork === 'qortium') {
          setCoreUpdateAuthorityRevision((current) => current + 1)
        }
        closeCustomNode()
      }
    } catch (error) {
      setCustomError(
        error instanceof Error ? error.message : 'Unable to save the custom node.',
      )
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
            const permissionRequestId = accountDialog.permissionRequestId
            const androidResolver = permissionRequestId
              ? androidUnlockResolvers.current.get(permissionRequestId)
              : undefined
            await completeUnlockAfterAccountStatePropagation({
              accountId,
              tabs: productState.tabs,
              updateAccountState: (request) => window.homeV2Apps?.updateAccountState(request),
              completeAndroid: androidResolver && permissionRequestId
                ? async () => {
                    androidUnlockResolvers.current.delete(permissionRequestId)
                    await androidResolver.complete(state)
                  }
                : undefined,
              resolveDesktop: !androidResolver && permissionRequestId
                ? () => window.homeV2Apps?.resolvePermission({
                    approved: true,
                    requestId: permissionRequestId,
                    scope: 'single-request',
                  })
                : undefined,
            })
            const queued = accountDialog.afterUnlock
            setAccountDialog(null)
            if (queued === 'add-address') {
              void runVaultOperation(() => vaultClient.addAddress(accountId))
            }
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
      if (!selectedVaultAccount.isUnlocked) {
        setAccountDialog({
          accountId: selectedVaultAccount.id,
          afterUnlock: 'add-address',
          mode: 'unlock',
        })
        return
      }
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
        {isAndroidHost && customNetwork === 'qortium' ? (
          <>
            <label>
              <span>Node API key</span>
              <input
                type="password"
                autoComplete="off"
                value={customApiKey}
                placeholder={
                  snapshot.nodes.qortium.customAuthenticated
                    ? 'Saved — leave blank to keep it'
                    : 'Required for approved Core updates'
                }
                onChange={(event) => {
                  setCustomApiKey(event.target.value)
                  if (event.target.value) setRemoveCustomApiKey(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveCustomNode()
                }}
              />
            </label>
            {snapshot.nodes.qortium.customAuthenticated ? (
              <label className="home-v2-custom-node-dialog__remove-key">
                <input
                  type="checkbox"
                  checked={removeCustomApiKey}
                  onChange={(event) => {
                    setRemoveCustomApiKey(event.target.checked)
                    if (event.target.checked) setCustomApiKey('')
                  }}
                />
                <span>Remove the saved API key</span>
              </label>
            ) : null}
          </>
        ) : null}
        <div
          className="home-v2-custom-node-dialog__message"
          aria-live="polite"
        >
          {customError ?? (
            isAndroidHost && customNetwork === 'qortium'
              ? 'The API key is protected by Android Keystore and sent only to this custom node over HTTPS or loopback HTTP; redirects are refused.'
              : 'Saving also selects Custom mode.'
          )}
        </div>
        <footer>
          <button
            type="button"
            className="home-v2-secondary-button"
            disabled={nodeCoreController.nodeBusyNetwork !== null}
            onClick={closeCustomNode}
          >
            Cancel
          </button>
          <button
            type="button"
            className="home-v2-primary-button"
            disabled={
              nodeCoreController.nodeBusyNetwork !== null || !customUrl.trim()
            }
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
  const resourceViewerTabId = resourceViewer?.sourceTabId ?? null
  const contextMenuTabId = androidContextMenu?.tabId ?? null
  const appOverlayTabId = accountPromptTabId ?? permissionPromptTabId ?? contextMenuTabId ?? resourceViewerTabId
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

  const resourceViewerOverlay = resourceViewer && productState.activeTabId === resourceViewer.sourceTabId ? (
    <HomeV2ResourceViewer
      appearance={snapshot.appearance}
      loadRetainedBytes={loadHomeV2RetainedViewerBytes}
      saveRetainedBytes={saveHomeV2RetainedViewerBytes}
      saveRetainedFile={saveHomeV2RetainedViewerFile}
      resource={resourceViewer}
      onClose={() => setResourceViewer(null)}
    />
  ) : null

  const contextMenuItems = androidContextMenu
    ? getHomeV2ContextMenuItems(androidContextMenu.target)
    : []
  const contextMenuOverlay = androidContextMenu && productState.activeTabId === androidContextMenu.tabId ? (
    <HomeV2ContextMenu
      items={contextMenuItems}
      targetKind={androidContextMenu.target.kind}
      targetLabel={getContextMenuTargetLabel(androidContextMenu.target)}
      onAction={(action) => {
        const item = contextMenuItems.find((candidate) => candidate.action === action)
        if (item) void resolveAndroidContextMenu(item.action)
      }}
      onDismiss={() => {
        void resolveAndroidContextMenu(null)
      }}
    />
  ) : null

  useEffect(() => {
    if (
      resourceViewer &&
      !productState.tabs.some((tab) => tab.id === resourceViewer.sourceTabId)
    ) {
      setResourceViewer(null)
    }
  }, [productState.tabs, resourceViewer])

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
  const reloadActiveSurface = () => {
    if (productState.activeTabId) {
      if (window.homeV2Apps) {
        void window.homeV2Apps.reload({ tabId: productState.activeTabId })
      } else {
        setAppReloadVersion((current) => current + 1)
      }
    } else {
      void nodeCoreController.refreshAll()
    }
  }
  // Leaving Welcome (skip or finish) navigates away, but the welcome tab used
  // to stay in the strip, so the guide the user just dismissed was one click
  // from coming back. Restarting setup deliberately keeps its tab.
  const closeWelcomeTabs = () => {
    for (const entry of productStateRef.current.entries) {
      if (entry.kind === 'internal' && entry.page === 'welcome') {
        dispatchProduct({ type: 'close-tab', tabId: entry.id })
      }
    }
  }
  menuNavigation.current = {
    goBack: () => navigateActiveApp(-1),
    goForward: () => navigateActiveApp(1),
    reload: reloadActiveSurface,
    reopenClosedTab: () => {
      const location = closedAppTabs.current.pop()
      if (location) void openAddress(location)
    },
  }

  return (
    <HomeV2Prototype
      snapshot={snapshot}
      productState={productState}
      permissionState={permissionState}
      layout={window.homeV2Nodes ? 'desktop' : 'phone'}
      surfaceNotice={
        nodeCoreController.nodeBusyNetwork
          ? `Updating ${nodeCoreController.nodeBusyNetwork === 'qortal' ? 'Qortal' : 'Qortium'}…`
          : shellNotice ?? 'Accounts, connections, and QDN apps'
      }
      overlay={customNodeDialog ?? accountDialogOverlay ?? contextMenuOverlay ?? resourceViewerOverlay}
      appOverlayTabId={appOverlayTabId ? brand<TabId>(appOverlayTabId) : null}
      identityLookup={identityLookup}
      identityLookupBusy={identityLookupBusy}
      identityLookupError={identityLookupError}
      identityLookupInput={identityInput}
      newTabPreference={newTabPreference}
      loadVisibleAvatar={loadVisibleAvatar}
      loadVisibleAppIcon={loadVisibleAppIcon}
      accountCatalogue={accountCatalogue}
      vaultState={vaultState}
      selectedAccountId={selectedAccountId}
      selectedAccountLookup={selectedAccountLookup}
      appReloadVersion={appReloadVersion}
      nodeClient={nodeClient}
      coreManagement={{
        available: nodeCoreController.coreAvailable,
        busyActions: nodeCoreController.coreBusyActions,
        lastActions: nodeCoreController.coreLastActions,
        statuses: nodeCoreController.coreStatuses,
        onAction: (network, action) => {
          void nodeCoreController.runCoreAction(network, action)
        },
        onRefresh: refreshCoreStatuses,
        coreMaintenance: coreMaintenance.available
          ? toHomeV2CoreMaintenanceManagement(coreMaintenance)
          : undefined,
        qortalMaintenance: qortalMaintenance.available
          ? toHomeV2QortalMaintenanceManagement(qortalMaintenance)
          : undefined,
        transport: transportMaintenance.available
          ? toHomeV2TransportManagement(transportMaintenance)
          : undefined,
      }}
      maintenance={{
        core: coreMaintenance,
        qortal: qortalMaintenance,
        transport: transportMaintenance,
      }}
      appUpdates={appUpdates.available ? appUpdates : undefined}
      onChainCoreUpdates={onChainCoreUpdates.available ? onChainCoreUpdates : undefined}
      onToggleCurrentBookmark={toggleCurrentBookmark}
      onManageBookmarks={openBookmarksManager}
      onDropTabOnBookmarkToolbar={dropTabOnBookmarkToolbar}
      onDetachTab={window.homeV2Windows ? detachTab : undefined}
      releaseNotesTarget={releaseNotesTarget}
      coreDocsNetwork={coreDocsNetwork}
      coreDocsTransport={homeV2CoreDocsTransport()}
      enableCoreDocs={enableHomeV2CoreDocs}
      probeCoreDocs={probeHomeV2CoreDocs}
      onboarding={onboarding}
      bookmarkToolbar={{
        snapshot: collectionsSnapshot,
        getContextMenuItems: getBookmarkToolbarContextMenuItems,
        loadVisibleAppIcon,
        onContextMenuAction: runBookmarkToolbarContextMenuAction,
        onOpen: openBookmarkToolbarLink,
        onActionError: setShellNotice,
      }}
      bookmarkToolbarVisibility={collectionsSnapshot?.toolbarVisibility}
      pinnedApps={{
        // Sends people to the app they assigned as Apps, falling back to the
        // shipped default rather than hard-coding a URL here.
        onFindMoreApps: async () => {
          // Resolved at click time from the live assignment, so a user who
          // points Apps at their own app is honoured; falls back to the
          // shipped default when settings are unavailable.
          const settings = await qdnAppsManagement.client?.get().catch(() => null)
          await openAddress(resolveHomeV2AppsAppUrl(settings ?? null))
        },
        pins: collectionsSnapshot?.dashboardPins ?? [],
        status: dashboardPinsPhase,
        error: dashboardPinsError,
        busy: dashboardPinsBusy,
        getContextMenuItems: getDashboardPinContextMenuItems,
        onAdd: ({ displayUrl, title }) => addDashboardPin(displayUrl, title),
        onContextMenuAction: runDashboardPinContextMenuAction,
        onMove: moveDashboardPin,
        onReorder: reorderDashboardPin,
        onOpen: openDashboardPin,
        onRemove: (pin) =>
          mutateDashboardPins({ type: 'removeDashboardPin', pinId: pin.id }),
        onRename: renameDashboardPin,
        onRetry: refreshDashboardPins,
      }}
      qdnAppsManagement={qdnAppsManagement}
      managerRevisions={managerRevisions}
      resolveAccountLabel={resolveGrantAccountLabel}
      requestApp={requestApp}
      onActivateTab={(tabId) =>
        dispatchProduct({ type: 'activate-tab', tabId })
      }
      onCloseTab={(tabId) => {
        const closingTab = productState.tabs.find((tab) => tab.id === tabId)
        if (closingTab) {
          closedAppTabs.current.push(closingTab.context.resourceLocation)
          if (closedAppTabs.current.length > 10) closedAppTabs.current.shift()
        }
        invalidateAndroidRuntime('tab-closed', tabId)
        window.homeV2Apps?.invalidateRuntime({ kind: 'tab-closed', tabId })
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
      onOpenInternalTab={(page) => {
        tabSequence.current += 1
        dispatchProduct({
          type: 'open-internal',
          page,
          tabId: brand<TabId>(
            `home-v2:tab:${Date.now().toString(36)}:${tabSequence.current}`,
          ),
        })
      }}
      onReorderTab={(tabId, toIndex) =>
        dispatchProduct({ type: 'reorder-tab', tabId, toIndex })
      }
      onAppNavigationChanged={handleAppNavigationChanged}
      onAppNavigationControllerChange={handleAppNavigationControllerChange}
      onAppTitleChanged={handleAppTitleChanged}
      onNavigate={(destination) =>
        dispatchProduct({ type: 'navigate', destination })
      }
      onOpenReleaseNotes={(target) => {
        setReleaseNotesTarget(target)
        dispatchProduct({ type: 'navigate', destination: 'releases' })
      }}
      onOpenCoreDocs={(network) => {
        setCoreDocsNetwork(network)
        dispatchProduct({ type: 'navigate', destination: 'core-docs' })
      }}
      onRestartWelcome={() => {
        setOnboarding(createHomeV2OnboardingState())
        dispatchProduct({ type: 'navigate', destination: 'welcome' })
      }}
      onWelcomeAccountAction={(action) => {
        setAccountDialogError(null)
        if (action === 'create') {
          setAccountDialog({ mode: 'create' })
        } else if (action === 'import') {
          void openWalletImport()
        } else {
          setAccountDialog({ mode: 'import-private-key' })
        }
      }}
      onWelcomeStepChange={(step) => {
        setOnboarding((current) => advanceHomeV2Onboarding(current, step))
      }}
      onWelcomeSkip={() => {
        setOnboarding(finishHomeV2Onboarding('skipped'))
        dispatchProduct({ type: 'navigate', destination: 'dashboard' })
        closeWelcomeTabs()
      }}
      onWelcomeComplete={(destination) => {
        setOnboarding(finishHomeV2Onboarding('completed'))
        dispatchProduct({
          type: 'navigate',
          destination: destination === 'appearance' ? 'settings' : destination,
        })
        closeWelcomeTabs()
      }}
      onRefreshNode={() => void nodeCoreController.refreshNodes()}
      onSetNodeMode={setNodeMode}
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
        invalidateAndroidRuntime('locked')
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
      onOpenAddressInTab={openAddressInTab}
      onOpenAsWidget={openTabAsWidget}
      widgetAvailable={activeWidgetAvailable}
      onResolvePermission={resolveAccountPermission}
      canGoBack={activeNavigationPosition > 0}
      canGoForward={
        !!activeNavigation &&
        activeNavigationPosition >= 0 &&
        activeNavigationPosition < activeNavigation.entries.length - 1
      }
      onGoBack={() => navigateActiveApp(-1)}
      onGoForward={() => navigateActiveApp(1)}
      onReload={reloadActiveSurface}
      onSetTheme={(theme: HomeV2ThemePreference) =>
        updateAppearance({
          theme,
          resolvedTheme: theme === 'system' ? currentSystemTheme() : theme,
        })
      }
      onSetAccent={(accent: HomeV2Accent) => updateAppearance({ accent })}
      onSetBookmarkToolbarVisibility={setBookmarkToolbarVisibility}
      onSetUiStyle={(ui: HomeV2UiStyle) => updateAppearance({ ui })}
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
      onSetNewTabPreference={setNewTabPreference}
      notificationPolicy={notificationPolicy}
      onSetAppNotifications={setGlobalAppNotifications}
      windowBehavior={windowBehavior}
      onSetWindowBehavior={windowBehaviorClient ? changeWindowBehavior : undefined}
    />
  )
}
