import type { HomeV2AppearanceSettings } from './appearance'

export type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name
}

export type NetworkId = 'qortal' | 'qortium'
export type IdentityId = Brand<string, 'IdentityId'>
export type WalletRef = Brand<string, 'WalletRef'>
export type AppId = Brand<string, 'AppId'>
export type TabId = Brand<string, 'TabId'>
export type NodeProfileRef = Brand<string, 'NodeProfileRef'>
export type NetworkAddress<Network extends NetworkId = NetworkId> = Brand<
  string,
  `Address:${Network}`
>

export type PresenceState = 'present' | 'absent' | 'unavailable'
export type NodeState = 'online' | 'syncing' | 'offline' | 'unknown'
export type ReticulumState = 'disabled' | 'starting' | 'online' | 'degraded'
export type AccountSessionState = 'none' | 'locked' | 'unlocked'
export type NodeConnectionMode = 'disabled' | 'local' | 'public' | 'custom'

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
  readonly selectedWallet: WalletRef | null
  readonly presences: Readonly<Record<NetworkId, NetworkPresence>>
}

export interface NodeSummary {
  readonly ref: NodeProfileRef
  readonly network: NetworkId
  readonly label: string
  readonly mode: NodeConnectionMode
  readonly state: NodeState
  readonly statusText: string
  readonly isTrusted: boolean
}

export interface QdnAppIdentity {
  readonly service: 'APP'
  readonly name: string
  readonly identifier: string | null
}

export interface AppDescriptor {
  readonly id: AppId
  readonly title: string
  readonly description: string
  readonly category: 'communication' | 'finance' | 'community' | 'utility'
  readonly sourceNetwork: NetworkId
  readonly qdnIdentity: QdnAppIdentity
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
