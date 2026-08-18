import type {
  HomeV2CreateAccountRequest,
  HomeV2ImportPrivateKeyRequest,
  HomeV2UnlockAccountRequest,
  HomeV2VaultState,
} from '../v2/contracts'

export type HomeV2WalletFileSelection =
  | { canceled: true }
  | {
      accountId: string
      address: string
      canceled: false
      suggestedName: string
      token: string
    }

export interface HomeV2SendChatMessageRequest {
  readonly accountId: string
  readonly action: 'SEND_CHAT_MESSAGE' | 'SEND_CHAT_EDIT' | 'SEND_CHAT_DELETE' | 'SEND_CHAT_REACTION'
  // Rechecked immediately before signing and polled during the (potentially
  // tens-of-seconds) memory-pow computation, mirroring the desktop bridge's
  // isStillValid recheck (electron/home-v2-app-bridge.ts sendHomeV2ChatMessage):
  // same tab/account/resource context, account still unlocked, same node
  // route. Optional only because this is an in-process (non-IPC) call on
  // Android, where the caller always has a live closure to pass; a caller
  // that omits it gets no mid-flight cancellation, so every real caller
  // should supply one.
  readonly isStillValid?: () => boolean | Promise<boolean>
  readonly validateTarget?: (senderPublicKey: string) => Promise<void>
  readonly chatReference?: string | null
  readonly message: string
  readonly network: 'qortal' | 'qortium'
  readonly nodeApiUrl: string
  readonly txGroupId: number
}

export interface HomeV2SendChatMessageResult {
  readonly accepted?: boolean
  readonly error?: string
  readonly errorType?: string
  readonly outcome?: 'unknown'
  readonly retryable?: false
  readonly signature: string
  readonly timestamp: number
}

export interface HomeV2GroupMembershipRequest {
  readonly accountId: string
  readonly action: 'JOIN_GROUP' | 'LEAVE_GROUP'
  readonly groupId: number
  readonly groupName: string
  readonly isOpen: boolean
  readonly isStillValid?: () => boolean | Promise<boolean>
  readonly network: 'qortal' | 'qortium'
  readonly nodeApiUrl: string
  readonly validateTarget?: () => Promise<void>
}

export interface HomeV2GroupMembershipResult {
  readonly accepted: boolean
  readonly action: 'JOIN_GROUP' | 'LEAVE_GROUP'
  readonly changed?: boolean
  readonly error?: string
  readonly errorType?: string
  readonly groupId: number
  readonly groupName: string
  readonly membership?: 'joined' | 'left' | 'requested'
  readonly network: 'qortal' | 'qortium'
  readonly outcome?: 'unknown'
  readonly retryable?: false
  readonly signature?: string
  readonly timestamp?: number
  readonly transactionSignature?: string
}

export interface HomeV2VaultClient {
  addAddress(accountId: string): Promise<HomeV2VaultState>
  create(request: HomeV2CreateAccountRequest): Promise<{ canceled: boolean; state: HomeV2VaultState }>
  discardLoadedWallet(token: string): Promise<void>
  exportAccount(accountId: string): Promise<{ canceled: boolean; fileName?: string; uri?: string }>
  getPrivateKeyAddress(privateKey: string): Promise<string>
  getSigningPublicKey?(accountId: string): Promise<string>
  getState(): Promise<HomeV2VaultState>
  importPrivateKey(
    request: HomeV2ImportPrivateKeyRequest,
  ): Promise<{ canceled: boolean; state: HomeV2VaultState }>
  lock(accountId: string): Promise<HomeV2VaultState>
  removeAccount(request: { accountId: string; password?: string }): Promise<HomeV2VaultState>
  removeAddress(addressId: string): Promise<HomeV2VaultState>
  rename(request: { accountId: string; label: string }): Promise<HomeV2VaultState>
  requestRestore(): Promise<{ restartRequired: boolean }>
  saveLoadedWallet(request: { label: string; token: string }): Promise<HomeV2VaultState>
  select(request: { accountId: string | null; addressId: string | null }): Promise<HomeV2VaultState>
  selectWalletFile(): Promise<HomeV2WalletFileSelection>
  // The trusted-layer public CHAT primitive (Home chat portability H1):
  // builds, memory-pows, signs, and broadcasts a CHAT
  // transaction entirely inside this module. Optional because it currently
  // has only one caller — the Android app-frame dispatcher in
  // HomeV2LiveApp.tsx, which never receives requests on desktop (desktop's
  // public CHAT writes are handled by electron/home-v2-app-bridge.ts directly).
  sendChatMessage?(request: HomeV2SendChatMessageRequest): Promise<HomeV2SendChatMessageResult>
  sendGroupMembership?(request: HomeV2GroupMembershipRequest): Promise<HomeV2GroupMembershipResult>
  unlock(request: HomeV2UnlockAccountRequest): Promise<HomeV2VaultState>
  updateSecurity(request: {
    accountId: string
    lockOnExit?: boolean
    password?: string
    rememberUnlock?: boolean
  }): Promise<HomeV2VaultState>
}

export function getHomeV2VaultClient() {
  if (!window.homeV2Vault) throw new Error('Account management is unavailable on this platform.')
  return window.homeV2Vault
}

declare global {
  interface Window {
    homeV2Vault?: HomeV2VaultClient
  }
}
