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
  /**
   * Signs one Qortium poll write. The vault RE-NORMALIZES the raw request
   * rather than trusting values from the shell, so the bytes it signs and the
   * rows the prompt showed derive from one input through one normalizer.
   */
  signPollWrite?(request: {
    readonly accountId: string
    readonly action: 'CREATE_POLL' | 'UPDATE_POLL' | 'VOTE_ON_POLL'
    // The account the PROMPT named, and the poll state it was shown against.
    // Both are required: the vault reads live state again before it signs, and
    // without these it would only be able to compare that read against itself
    // — which agrees with anything that changed while the prompt was open.
    readonly approvedAddress: string
    readonly approvedPoll: HomeV2ApprovedPollTarget | null
    readonly isStillValid: () => boolean | Promise<boolean>
    readonly nodeApiUrl: string
    readonly requestValue: Record<string, unknown>
  }): Promise<unknown>
  /**
   * Derives a Qortium address from a Base58 public key, using the same
   * primitives the vault signs with.
   *
   * RATE_ACCOUNT's prompt must name WHO is being rated, derived from the exact
   * key that will be signed rather than from an app-supplied label or a node's
   * word for it. The shell cannot do this itself — the address math lives with
   * the key material — so it asks here.
   */
  deriveAddressFromPublicKey?(publicKey58: string): Promise<string>
  /**
   * Publishes the on-chain DELETION TOMBSTONE for one Qortium QDN resource.
   *
   * This is permanent and visible to every peer — it is not a local-copy
   * removal — so it carries its own capability and its own approval.
   */
  deleteQdnResource?(request: {
    readonly accountId: string
    readonly approvedAddress: string
    readonly isStillValid: () => boolean | Promise<boolean>
    readonly nodeApiUrl: string
    readonly requestValue: Record<string, unknown>
    readonly validateTarget: () => Promise<void>
  }): Promise<unknown>
  /**
   * Signs one Qortium rating write (RATE_ACCOUNT / RATE_RESOURCE). Local
   * transformer, so the vault verifies both the unstamped and the stamped
   * bytes, and holds the signature to the rating state the prompt disclosed.
   */
  signRatingWrite?(request: {
    readonly accountId: string
    readonly action: 'RATE_ACCOUNT' | 'RATE_RESOURCE'
    readonly approvedAddress: string
    readonly approvedTarget: HomeV2ApprovedRatingTarget
    readonly isStillValid: () => boolean | Promise<boolean>
    readonly nodeApiUrl: string
    readonly requestValue: Record<string, unknown>
  }): Promise<unknown>
  /**
   * Signs one Qortium account-avatar pointer change. The avatar IMAGE is a
   * separate published QDN resource; this signs only which resource the
   * account points at.
   */
  signAccountAvatar?(request: {
    readonly accountId: string
    readonly approvedAddress: string
    readonly approvedAvatar: HomeV2ApprovedAccountAvatar
    readonly isStillValid: () => boolean | Promise<boolean>
    readonly nodeApiUrl: string
    readonly requestValue: Record<string, unknown>
  }): Promise<unknown>
  /**
   * Signs one Qortium group mutation. These are built by a LOCAL transformer
   * — there is no Core builder to check against — so the vault also verifies
   * the STAMPED bytes before signing, on top of the approved-state binding
   * every Android signing arm carries.
   */
  signGroupMutation?(request: {
    readonly accountId: string
    readonly action: 'CREATE_GROUP' | 'GROUP_APPROVAL' | 'SET_GROUP' | 'SET_GROUP_AVATAR' | 'UPDATE_GROUP'
    readonly approvedAddress: string
    readonly approvedGroup: HomeV2ApprovedGroupTarget | null
    readonly approvedPending: HomeV2ApprovedPendingTransaction | null
    readonly isStillValid: () => boolean | Promise<boolean>
    readonly nodeApiUrl: string
    readonly requestValue: Record<string, unknown>
  }): Promise<unknown>
  /**
   * Signs one Qortium name write. Same discipline as signPollWrite, plus the
   * live-sale binding BUY_NAME needs: seller and price come from the chain,
   * and an app-supplied value must match rather than override.
   */
  signNameWrite?(request: {
    readonly accountId: string
    readonly action: 'BUY_NAME' | 'CANCEL_SELL_NAME' | 'REGISTER_NAME' | 'SELL_NAME' | 'UPDATE_NAME'
    // As signPollWrite. For BUY_NAME this is what makes the disclosure
    // binding: the price and seller in the SIGNED bytes come from here, not
    // from whatever the chain says after the user has already tapped Approve.
    readonly approvedAddress: string
    readonly approvedTarget: HomeV2ApprovedNameTarget | null
    readonly isStillValid: () => boolean | Promise<boolean>
    readonly nodeApiUrl: string
    readonly requestValue: Record<string, unknown>
  }): Promise<unknown>
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

/**
 * The live name state a name-write approval was granted against.
 *
 * Carried from the shell into the vault so the signature is bound to what the
 * user SAW. Amounts travel as exact atomic decimal-digit strings — never a
 * number, never a float — and are compared as strings.
 */
export type HomeV2ApprovedNameTarget = {
  readonly isForSale: boolean
  readonly name: string
  readonly owner: string
  readonly salePriceAtomic: string | null
  readonly saleRecipient: string | null
}

/** The live poll state a poll-write approval was granted against. */
export type HomeV2ApprovedPollTarget = {
  readonly optionNames: readonly string[]
  readonly pollId: number
  readonly pollName: string
}

/**
 * The live group state a group-mutation approval was granted against.
 *
 * Mirrors HomeV2GroupMetadata. Carried from the shell so the vault signs the
 * group the user saw — for UPDATE_GROUP especially, where omitted fields are
 * merged FROM this record, so a stale read would silently rewrite live
 * settings the prompt reported as unchanged.
 */
export type HomeV2ApprovedGroupTarget = {
  readonly approvalThreshold: string
  readonly avatar: { readonly identifier: string; readonly name: string; readonly service: string } | null
  readonly description: string
  readonly groupId: number
  readonly groupName: string
  readonly isOpen: boolean
  readonly maximumBlockDelay: number
  readonly minimumBlockDelay: number
  readonly owner: string
}

/** The pending transaction a GROUP_APPROVAL vote was approved against. */
export type HomeV2ApprovedPendingTransaction = {
  readonly approvalStatus: string
  readonly creatorAddress: string
  readonly groupName: string
  readonly signature: string
  readonly txGroupId: number
  readonly type: string
}

/**
 * The live rating state a rating-write approval was granted against.
 *
 * `currentRating` is what the prompt showed under "Current" (null when the
 * account has no active rating on this edge or coordinate). The vault refuses
 * if the chain has moved away from it, so an approval that read "no current
 * rating" cannot become a change to one the user never saw.
 */
export type HomeV2ApprovedRatingTarget = {
  readonly canChangeNow: boolean
  readonly currentRating: number | null
}

/** The live account-avatar pointer a SET_ACCOUNT_AVATAR approval was granted against. */
export type HomeV2ApprovedAccountAvatar = {
  readonly pointer: { readonly identifier: string; readonly name: string; readonly service: string } | null
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
