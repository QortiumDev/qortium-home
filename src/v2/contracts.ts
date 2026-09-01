import type { HomeV2AppearanceSettings } from './appearance'

export type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name
}

export type NetworkId = 'qortal' | 'qortium'
export type IdentityId = Brand<string, 'IdentityId'>
export type WalletRef = Brand<string, 'WalletRef'>
export type AppId = Brand<string, 'AppId'>
export type TabId = Brand<string, 'TabId'>
export type AppResourceLocation = Brand<string, 'AppResourceLocation'>
export type NodeProfileRef = Brand<string, 'NodeProfileRef'>
export type NetworkAddress<Network extends NetworkId = NetworkId> = Brand<
  string,
  `Address:${Network}`
>

export type PresenceState = 'present' | 'absent' | 'unavailable'
export type NodeState = 'online' | 'syncing' | 'offline' | 'unknown'
export type LocalCoreState =
  | 'running'
  | 'installed'
  | 'not-detected'
  | 'unsupported'
export type ReticulumState = 'disabled' | 'starting' | 'online' | 'degraded'
export type AccountSessionState = 'none' | 'locked' | 'unlocked'
export type NodeConnectionMode = 'disabled' | 'local' | 'public' | 'custom'
export type IdentityLookupInputKind = 'address' | 'name'
export type IdentityLookupState =
  | 'conflict'
  | 'not-found'
  | 'partial'
  | 'resolved'
  | 'unavailable'
export type NetworkIdentityLookupState =
  | 'not-found'
  | 'resolved'
  | 'unavailable'

export interface IdentityAvatarPointer {
  readonly identifier: string
  readonly name: string
  readonly service: string
  readonly source: 'account-pointer' | 'legacy-name'
}

export interface VisibleAvatarReadRequest {
  readonly address: string
  readonly pointer: IdentityAvatarPointer
}

export type VisibleAvatarReadResult =
  | {
      readonly body: string
      readonly contentLength: number
      readonly contentType: string
      readonly status: 'ready'
    }
  | {
      readonly retryAfterSeconds: number | null
      readonly status: 'pending'
    }
  | { readonly status: 'missing' }
  | { readonly message: string; readonly status: 'unavailable' }

export type VisibleAvatarLoader = (
  network: NetworkId,
  request: VisibleAvatarReadRequest,
) => Promise<VisibleAvatarReadResult>

// The QDN services Home can execute as browser content inside an app tab.
// This is the renderer-side mirror of QDN_BROWSER_ARCHIVE_SERVICES in
// electron/qdn-browser-archive-services.ts (which is the canonical list) and
// of APP_RESOURCE_SERVICES in ./resource-location, which carries the runtime
// array and predicate. It is MIRRORED rather than imported because src/v2 is
// pinned against relative imports out to the electron folder — see
// testRendererSourceHasNoRuntimeEscapeHatches in home-v2-foundation.test.tsx,
// which forbids that import token in every src/v2 source file (this comment
// deliberately does not spell the token out, or it would trip that very
// scan). That same test file pins these lists against each other so they
// cannot drift.
export type AppResourceService = 'APP' | 'WEBSITE' | 'GAME'

export interface VisibleAppIconReadRequest {
  readonly identifier: string | null
  readonly name: string
  readonly service: AppResourceService
}

export type VisibleAppIconLoader = (
  network: NetworkId,
  request: VisibleAppIconReadRequest,
) => Promise<VisibleAvatarReadResult>

export interface HomeV2AccountCatalogueEntry {
  readonly address: string
  readonly addressIndex: number
  readonly id: string
  readonly isUnlocked: boolean
  readonly label: string
  readonly supportsDerivedAddresses: boolean
  readonly walletId: string
}

export interface HomeV2AccountCatalogue {
  readonly accounts: readonly HomeV2AccountCatalogueEntry[]
  readonly activeAccountId: string | null
}

export type HomeV2VaultReadiness = 'ready' | 'recovery'

export interface HomeV2VaultAddressSummary {
  readonly address: string
  readonly id: string
  readonly index: number
  readonly label: string
}

export interface HomeV2AccountSecuritySummary {
  readonly lockOnExit: boolean
  readonly manuallyLocked: boolean
  readonly rememberUnlock: boolean
}

export interface HomeV2VaultAccountSummary {
  readonly addresses: readonly HomeV2VaultAddressSummary[]
  readonly id: string
  readonly isUnlocked: boolean
  readonly label: string
  readonly security: HomeV2AccountSecuritySummary
  readonly supportsDerivedAddresses: boolean
}

/**
 * Sanitized account state exposed to the Home renderer. Encrypted wallet data,
 * source filenames, passwords, KDF output, seeds, and private keys must never
 * be added to this contract.
 */
export interface HomeV2VaultState {
  readonly accounts: readonly HomeV2VaultAccountSummary[]
  readonly recoveryMessage: string | null
  readonly readiness: HomeV2VaultReadiness
  readonly secureStorageAvailable: boolean
  readonly selectedAccountId: string | null
  readonly selectedAddressId: string | null
  readonly version: 2
}

export interface HomeV2CreateAccountRequest {
  readonly label: string
  readonly password: string
  readonly passwordConfirmation: string
}

export interface HomeV2ImportPrivateKeyRequest
  extends HomeV2CreateAccountRequest {
  readonly privateKey: string
}

export interface HomeV2UnlockAccountRequest {
  readonly accountId: string
  readonly password?: string
  readonly useRememberedUnlock?: boolean
}

export interface HomeV2AccountSecurityUpdate {
  readonly accountId: string
  readonly lockOnExit?: boolean
  readonly rememberUnlock?: boolean
}

export interface NetworkIdentityLookup {
  readonly address: string | null
  readonly avatar: IdentityAvatarPointer | null
  readonly detail: string
  readonly matchedQueryName: boolean
  readonly names: readonly string[]
  readonly network: NetworkId
  readonly primaryName: string | null
  readonly state: NetworkIdentityLookupState
}

export interface DualIdentityLookupResult {
  readonly inputKind: IdentityLookupInputKind
  readonly message: string
  readonly networks: Readonly<Record<NetworkId, NetworkIdentityLookup>>
  readonly query: string
  readonly sharedAddress: string | null
  readonly state: IdentityLookupState
}

export interface AccountSessionSummary {
  readonly state: AccountSessionState
  readonly selectedIdentityId: IdentityId | null
  readonly rememberUnlock: boolean
  readonly lockOnExit: boolean
  readonly manuallyLocked: boolean
  readonly secureStorageAvailable: boolean
}

export interface AvatarDescriptor {
  readonly kind: 'initials' | 'qdn'
  readonly value: string
  readonly network: NetworkId
}

export interface NetworkPresence<Network extends NetworkId = NetworkId> {
  readonly network: Network
  readonly state: PresenceState
  readonly address: NetworkAddress<Network> | null
  readonly names: readonly string[]
  readonly primaryName: string | null
  readonly avatar: AvatarDescriptor | null
  readonly detail: string | null
}

export interface IdentityRecord {
  readonly id: IdentityId
  readonly displayLabel: string
  /**
   * False when displayLabel is the user's own account label rather than a
   * registered name.
   *
   * The two look identical once rendered, and a tester read their account
   * label as a registered name. The label is not a name: it is local, it is
   * not on chain, and nobody else can see it.
   */
  readonly displayLabelIsRegisteredName: boolean
  readonly selectedWallet: WalletRef | null
  readonly presences: Readonly<Record<NetworkId, NetworkPresence>>
}

export interface NodeSummary {
  readonly ref: NodeProfileRef
  readonly network: NetworkId
  readonly label: string
  readonly lastEnabledMode: Exclude<NodeConnectionMode, 'disabled'>
  readonly mode: NodeConnectionMode
  readonly state: NodeState
  readonly statusText: string
  readonly isTrusted: boolean
  readonly customAuthenticated: boolean
  /** Authoritative admin-route trust, including the current credential. */
  readonly adminTrusted?: boolean
  readonly customConfigured: boolean
  readonly customUrl: string | null
  readonly localCoreState: LocalCoreState
  readonly localCoreStatusText: string
  readonly nodeApiUrl: string | null
  readonly height: number | null
  readonly peerCount: number | null
  /** Data-network peers, reported alongside chain peers by the same status call. */
  readonly dataPeerCount: number | null
  /**
   * Chain and data peers reached over I2P, or null on a Core too old to report
   * them (qortium-core #282). The direct-IP count is the pool total minus this.
   */
  readonly i2pPeerCount: number | null
  readonly i2pDataPeerCount: number | null
  readonly syncPercent: number | null
  readonly syncPhase: string | null
  readonly lastCheckedAt: number | null
  readonly error: string | null
  readonly capabilities: {
    readonly admin: boolean
    readonly read: boolean
    readonly write: boolean
  }
}

export interface AppResourceIdentity {
  // Widened from the 'APP' literal in R4-4: WEBSITE and GAME resources are
  // published QDN browser archives too, and Home opens them as app tabs. The
  // REAL service is carried here (never re-stamped as 'APP') because it is
  // what builds the /render/<service>/... URL, the qdn:// address a grant is
  // keyed by, and the app-icon fetch.
  readonly service: AppResourceService
  readonly name: string
  readonly identifier: string | null
}

export interface AppDescriptor {
  readonly id: AppId
  readonly title: string
  readonly description: string
  readonly category: 'communication' | 'finance' | 'community' | 'utility'
  readonly sourceNetwork: NetworkId
  readonly resourceIdentity: AppResourceIdentity
  readonly targetNetworks: readonly NetworkId[]
  readonly placement: 'pinned' | 'recommended'
}

export interface RecentItem {
  readonly id: string
  readonly appId: AppId
  readonly label: string
  readonly context: string
  readonly targetNetwork: NetworkId
}

export interface ReticulumSummary {
  readonly state: ReticulumState
  readonly enabled: boolean
  readonly statusText: string
}

export interface HomeV2Snapshot {
  readonly account: AccountSessionSummary
  readonly appearance: HomeV2AppearanceSettings
  readonly identity: IdentityRecord
  readonly nodes: Readonly<Record<NetworkId, NodeSummary>>
  readonly apps: readonly AppDescriptor[]
  readonly recentItems: readonly RecentItem[]
  readonly reticulum: ReticulumSummary
}

export interface OperationContext {
  readonly identityId: IdentityId
  readonly walletRef: WalletRef | null
  readonly targetNetwork: NetworkId
  readonly nodeProfileRef: NodeProfileRef
  readonly appId: AppId
  readonly tabId: TabId
}

export interface AppTabContext {
  readonly identityId: IdentityId
  readonly walletRef: WalletRef | null
  readonly appId: AppId
  readonly tabId: TabId
  readonly sourceNetwork: NetworkId
  readonly resourceLocation: AppResourceLocation
  /**
   * A node-rendered preview of local content the user has not published yet.
   *
   * Normally a tab's URL is DERIVED from `resourceLocation`, so it is
   * structurally constrained to `/render/SERVICE/name/identifier`. A preview is
   * different: the node returns `/render/hash/<hash>`, which matches no
   * resource address and cannot be expressed as one. This field carries that
   * URL instead, and everything downstream must treat it as the narrower case:
   * loopback origin matching the node, `/render/` path, nothing else.
   *
   * Null for every ordinary app tab.
   */
  readonly previewUrl: string | null
}

export interface NetworkRequest {
  readonly context: OperationContext
  readonly path: string
  readonly method: 'GET' | 'POST'
}

export interface FileReadRequest {
  readonly context: OperationContext
  readonly purpose: string
}

export interface SigningIntent {
  readonly context: OperationContext
  readonly transactionType: string
  readonly summary: string
}

export interface ManagedServiceRequest {
  readonly context: OperationContext
  readonly service: 'reticulum'
  readonly command: 'start' | 'stop' | 'restart'
}

export interface HomeV2Host {
  getSnapshot(): Promise<HomeV2Snapshot>
  requestNetwork(request: NetworkRequest): Promise<unknown>
  readFile(request: FileReadRequest): Promise<Uint8Array>
  unlockVault(context: OperationContext): Promise<void>
  signIntent(intent: SigningIntent): Promise<unknown>
  manageNativeService(request: ManagedServiceRequest): Promise<void>
}
