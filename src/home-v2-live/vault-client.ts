import type {
  HomeV2CreateAccountRequest,
  HomeV2ImportPrivateKeyRequest,
  HomeV2UnlockAccountRequest,
  HomeV2VaultState,
} from '../v2/contracts'
import type {
  HomeV2PrivateAttachmentConversation,
  HomeV2PrivateAttachmentDescriptor,
} from '../../electron/home-v2-private-attachment-contract'

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

export interface HomeV2DirectChatReadRequest {
  readonly accountId: string
  readonly action: 'GET_PRIVATE_DIRECT_ACTIVE_CHATS' | 'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES'
  readonly before?: number
  readonly encoding: 'BASE58' | 'BASE64'
  readonly hasChatReference?: boolean
  readonly isStillValid?: () => boolean | Promise<boolean>
  readonly limit: number
  readonly network: 'qortal' | 'qortium'
  readonly nodeApiUrl: string
  readonly otherAddress?: string
  readonly reverse: boolean
}

export interface HomeV2DirectChatWriteRequest {
  readonly accountId: string
  readonly action: 'SEND_DIRECT_CHAT_MESSAGE' | 'SEND_DIRECT_CHAT_EDIT' | 'SEND_DIRECT_CHAT_DELETE' | 'SEND_DIRECT_CHAT_REACTION'
  readonly chatReference: string | null
  readonly isStillValid?: () => boolean | Promise<boolean>
  readonly message: string
  readonly network: 'qortal' | 'qortium'
  readonly nodeApiUrl: string
  readonly otherAddress: string
  readonly validateTarget?: (senderPublicKey: string, peerPublicKey: string) => Promise<void>
}

export interface HomeV2PrivateGroupChatReadRequest {
  readonly accountId: string
  readonly action:
    | 'GET_PRIVATE_GROUP_ACTIVE_CHATS'
    | 'GET_PRIVATE_GROUP_CHAT_STATE'
    | 'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES'
  readonly before?: number
  readonly encoding: 'BASE58' | 'BASE64'
  readonly groupId?: number
  readonly isStillValid?: () => boolean | Promise<boolean>
  readonly limit: number
  readonly network: 'qortal' | 'qortium'
  readonly nodeApiUrl: string
  readonly reverse: boolean
}

export interface HomeV2PrivateGroupChatWriteRequest {
  readonly accountId: string
  readonly action:
    | 'REQUEST_PRIVATE_GROUP_CHAT_KEY'
    | 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS'
    | 'ROTATE_PRIVATE_GROUP_CHAT_KEY'
    | 'SEND_PRIVATE_GROUP_CHAT_MESSAGE'
    | 'SEND_PRIVATE_GROUP_CHAT_EDIT'
    | 'SEND_PRIVATE_GROUP_CHAT_DELETE'
    | 'SEND_PRIVATE_GROUP_CHAT_REACTION'
  readonly chatReference: string | null
  readonly epochId: string | null
  readonly groupId: number
  readonly isStillValid?: () => boolean | Promise<boolean>
  readonly keyId: string | null
  readonly limit: number
  readonly message: string | null
  readonly network: 'qortal' | 'qortium'
  readonly nodeApiUrl: string
  readonly validateTarget?: (senderPublicKey: string, epochId: string) => Promise<void>
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

export interface HomeV2GroupAdminMutationRequest {
  readonly accountId: string
  readonly action:
    | 'APPROVE_GROUP_JOIN_REQUEST'
    | 'INVITE_TO_GROUP'
    | 'CANCEL_GROUP_INVITE'
    | 'ADD_GROUP_ADMIN'
    | 'REMOVE_GROUP_ADMIN'
    | 'GROUP_BAN'
    | 'CANCEL_GROUP_BAN'
    | 'GROUP_KICK'
  readonly groupId: number
  readonly groupName: string
  readonly memberAddress: string
  readonly ownerAddress: string
  readonly reason: string
  readonly timeToLive: number
  readonly isStillValid?: () => boolean | Promise<boolean>
  readonly network: 'qortal' | 'qortium'
  readonly nodeApiUrl: string
  readonly validateTarget?: () => Promise<void>
}

export interface HomeV2GroupAdminMutationResult {
  readonly accepted: boolean
  readonly action: HomeV2GroupAdminMutationRequest['action']
  readonly changed?: boolean
  readonly error?: string
  readonly errorType?: string
  readonly groupId: number
  readonly groupName: string
  readonly memberAddress: string
  readonly network: 'qortal' | 'qortium'
  readonly outcome?: 'unknown'
  readonly retryable?: false
  readonly signature?: string
  readonly timestamp?: number
  readonly transactionSignature?: string
  readonly wireAction: string
}

export interface HomeV2PublicPublishMutationRequest {
  readonly accountId: string
  // Qortal only: the atomic unit fee (decimal digit string) that was
  // DISCLOSED on the approval prompt. The vault refuses to sign if the
  // chain answers a different fee at signing time.
  readonly expectedFeeAtomic?: string
  readonly fileName: string
  readonly isStillValid?: () => boolean | Promise<boolean>
  readonly validateTarget?: () => Promise<void>
  readonly network: 'qortal' | 'qortium'
  readonly nodeApiUrl: string
  readonly resource: {
    readonly category?: string
    readonly description?: string
    readonly identifier?: string
    readonly name: string
    readonly service: string
    readonly tags: readonly string[]
    readonly title?: string
  }
  readonly sourceBase64: string
}

export interface HomeV2PrivateAttachmentPublishMutationRequest {
  readonly accountId: string
  readonly conversation: HomeV2PrivateAttachmentConversation
  readonly fileName: string
  readonly identifier: string
  readonly isStillValid?: () => boolean | Promise<boolean>
  readonly network: 'qortal' | 'qortium'
  readonly nodeApiUrl: string
  readonly publisherName: string
  readonly service: 'IMAGE' | 'QCHAT_ATTACHMENT_PRIVATE'
  readonly sourceBase64: string
}

export interface HomeV2PrivateAttachmentDecryptRequest {
  readonly accountId: string
  readonly descriptor: HomeV2PrivateAttachmentDescriptor
  readonly isStillValid?: () => boolean | Promise<boolean>
  readonly nodeApiUrl: string
}

export interface HomeV2PrivateAttachmentDecryptResult {
  readonly dataBase64: string
  readonly fileName: string
  readonly mediaType: string
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
  readDirectChats?(request: HomeV2DirectChatReadRequest): Promise<unknown[]>
  readPrivateGroupChats?(request: HomeV2PrivateGroupChatReadRequest): Promise<unknown>
  sendDirectChat?(request: HomeV2DirectChatWriteRequest): Promise<HomeV2SendChatMessageResult>
  sendPrivateGroupChat?(request: HomeV2PrivateGroupChatWriteRequest): Promise<unknown>
  sendGroupAdmin?(request: HomeV2GroupAdminMutationRequest): Promise<HomeV2GroupAdminMutationResult>
  sendGroupMembership?(request: HomeV2GroupMembershipRequest): Promise<HomeV2GroupMembershipResult>
  publishPublicResource?(request: HomeV2PublicPublishMutationRequest): Promise<unknown>
  // Reads the Qortal ARBITRARY unit fee (atomic decimal digit string) so the
  // approval prompt can disclose and pin it before anything is staged.
  readQortalArbitraryUnitFee?(request: { readonly nodeApiUrl: string }): Promise<string>
  publishPrivateAttachment?(request: HomeV2PrivateAttachmentPublishMutationRequest): Promise<unknown>
  decryptPrivateAttachment?(request: HomeV2PrivateAttachmentDecryptRequest): Promise<HomeV2PrivateAttachmentDecryptResult>
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
