import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  Notification,
  webContents,
  type MenuItemConstructorOptions,
  type Session,
  type WebContents,
} from 'electron'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import nodePath from 'node:path'
import nacl from 'tweetnacl'
import { assertAuthorizedHomeV2Sender } from './home-v2-authorized-senders.js'
import {
  getHomeV2AppNodeState,
  getHomeV2ReadableNode,
  readHomeV2Identity,
  readResolvedHomeV2Avatar,
} from './home-v2-node-bridge.js'
import { nodeFetch } from './node-tls.js'
import {
  closeQdnViewContextMenus,
  getQdnViewContextForTab,
  getQdnViewContextMenuPopupHost,
  getQdnViewContextForWebContents,
  isQdnViewFocused,
  isQdnViewVisible,
  isQdnRenderUrlSameAppResource,
  onQdnViewNavigated,
  releaseQdnViewContextMenu,
  reserveQdnViewContextMenu,
  syncWidgetQdnViewState,
  type QdnViewContext,
} from './qdn-views.js'
import { sanitizeQdnManagerAppKey } from './qdn-manager-permissions.js'
import {
  grantQdnManagerPermission,
  hasQdnManagerPermission,
  hasQdnAccountCapability,
  hasQdnAppCapability,
  grantQdnAccountCapabilityPermission,
  grantQdnAppCapabilityPermission,
} from './qdn-manager-permission-store.js'
import {
  validateBookmarkManagerMutationRequest,
  validateBookmarksOpenRequest,
} from './bookmark-manager-contract.js'
import {
  openHomeV2CollectionAddress,
  requestHomeV2Collections,
} from './home-v2-collections-bridge.js'
import {
  grantAppNotifications,
  hasNotificationGrant,
  inspectNotificationStore,
  readNotificationStore,
  replaceNotificationStore,
} from './notification-store.js'
import {
  isHomeV2NotificationManagerAction,
  parseHomeV2NotificationManagerRequest,
  readHomeV2NotificationManagerSummary,
  resolveHomeV2NotificationManagerMutation,
  summarizeHomeV2NotificationManagerStore,
  type HomeV2NotificationManagerAction,
} from './home-v2-notification-manager-contract.js'
import {
  HOME_V2_HOME_SETTINGS_GRANT_KEY_PREFIX,
  assertHomeV2HomeSettingsPromptAdmissible,
  buildHomeV2HomeSettingsGrantKey,
  encodeHomeV2HomeSettingsRoundTripRequest,
  getHomeV2HomeSettingsApprovalDetails,
  getHomeV2HomeSettingsMetadata,
  isHomeV2HomeSettingsAction,
  parseHomeV2HomeSettingsRequest,
  parseHomeV2HomeSettingsRoundTripResponse,
  type HomeV2HomeSettings,
  type HomeV2HomeSettingsAction,
  type HomeV2HomeSettingsPatch,
} from './home-v2-home-settings-contract.js'
import {
  areQdnAppNotificationsEnabled,
  consumeQdnAppNotificationRateLimit,
  stageQdnPreviewSource,
} from './qdn.js'
import { encodeQdnBridgeError, encodeQdnBridgeResult } from './qdn-bridge-error.js'
import {
  buildHomeV2AssetReadPath,
  buildHomeV2ChainReadPath,
  buildHomeV2NamePath,
  buildHomeV2RatingRead,
  buildHomeV2RatingReadResult,
  buildHomeV2ResourcePath,
  buildHomeV2ResourceRenderPath,
  resolveHomeV2AppAlias,
  getHomeV2AppActions,
  getHomeV2AppNetwork,
  HOME_V2_APP_LIMITS,
  homeV2ChainReadNeedsSelectedAddress,
  homeV2RatingReadNeedsSelectedAddress,
  buildHomeV2ListPath,
  buildHomeV2ListWriteBody,
  isHomeV2AppRecord,
  isHomeV2ChainReadAction,
  isHomeV2ListAction,
  isHomeV2ListWriteAction,
  isHomeV2RatingReadAction,
  normalizeHomeV2Address,
  canonicalHomeV2VoteSelection,
  homeV2NameOperationLabel,
  homeV2PollOperationLabel,
  isHomeV2NameWriteAction,
  isHomeV2PollWriteAction,
  normalizeHomeV2BuyNameRequest,
  normalizeHomeV2CancelSellNameRequest,
  normalizeHomeV2RegisterNameRequest,
  normalizeHomeV2SellNameRequest,
  normalizeHomeV2UpdateNameRequest,
  selectHomeV2NameTarget,
  normalizeHomeV2CreatePollRequest,
  normalizeHomeV2ListItems,
  normalizeHomeV2ListName,
  normalizeHomeV2ListReadResult,
  normalizeHomeV2UpdatePollRequest,
  normalizeHomeV2VoteOnPollRequest,
  selectHomeV2PollTarget,
  serializeHomeV2ListItemsForApproval,
  type HomeV2ListWriteAction,
  type HomeV2NameWriteAction,
  type HomeV2PollWriteAction,
  normalizeHomeV2AppAction,
  normalizeHomeV2AppProtocol,
  normalizeHomeV2IdentityAddresses,
  normalizeHomeV2OpenAddress,
  normalizeHomeV2ReadMethod,
  normalizeHomeV2ReplaceTabAddress,
  normalizeHomeV2ReadPath,
  normalizeHomeV2ResponseMaxBytes,
  withHomeV2SelectedAddress,
  homeV2PublishExtraOperationLabel,
  type HomeV2AppBridgeProtocol,
  type HomeV2AppNetwork,
} from './home-v2-app-actions.js'
import {
  dismissedHomeV2ContextMenuResult,
  getHomeV2ContextMenuItems,
  getHomeV2ContextMenuOperation,
  handledHomeV2ContextMenuResult,
  normalizeHomeV2ContextMenuRequest,
  type HomeV2ContextMenuActionId,
} from './home-v2-context-menu.js'
import {
  getQdnResourceStreamProxyMimeType,
  getQdnResourceStreamRequest,
  getQdnResourceViewerRequest,
} from './qdn-resource-viewer-contract.js'
import {
  clearHomeV2DesktopResourceStreams,
  issueHomeV2DesktopPrivateBytesStream,
  issueHomeV2DesktopResourceStream,
} from './home-v2-desktop-resource-stream.js'
import {
  createHomeV2PrivateAttachmentDescriptor,
  isHomeV2PrivateAttachmentAction,
  normalizeHomeV2PrivateAttachmentAccessRequest,
  normalizeHomeV2PrivateAttachmentPublishRequest,
  type HomeV2PrivateAttachmentAction,
  type HomeV2PrivateAttachmentDescriptor,
} from './home-v2-private-attachment-contract.js'
import {
  assertPrivateChatAttachmentRecipients,
  decryptPrivateChatAttachmentForRecipient,
  decryptPrivateChatGroupAttachment,
  decryptQortalHubPrivateGroupImage,
  decryptQortalPrivateChatDirectAttachment,
  decryptQortalPrivateChatGroupAttachment,
  encryptPrivateChatDirectAttachment,
  encryptPrivateChatGroupAttachment,
  encryptQortalHubPrivateGroupImage,
  encryptQortalPrivateChatDirectAttachment,
  encryptQortalPrivateChatGroupAttachment,
  getQortalPrivateChatDirectQencEnvelope,
  isQortalHubCompatiblePrivateImageMediaType,
  parsePrivateChatAttachmentEnvelope,
  sniffPrivateChatAttachmentMediaType,
} from './home-v2-private-attachment-actions.js'
import type { HomeV2ResourceStreamBinding } from './home-v2-resource-stream-capability.js'
import type { QdnAppRequest } from './qdn-request-values.js'
import {
  fetchHomeV2AvatarAction,
  type HomeV2AvatarAction,
} from './home-v2-avatar-actions.js'
import {
  homeV2NotificationChainLabel,
  homeV2NotificationSourceKey,
  normalizeHomeV2NotificationRequest,
} from './home-v2-notification-contract.js'
import {
  createHomeV2PendingTransactionFromResult,
  isHomeV2JournaledMutation,
  normalizeHomeV2ForgetPendingTransactionRequest,
  toHomeV2PendingTransactionResult,
} from './home-v2-transaction-journal.js'
import {
  findStoredHomeV2PendingTransactionConflict,
  forgetHomeV2PendingTransaction,
  listHomeV2PendingTransactions,
  recordHomeV2PendingTransaction,
} from './home-v2-transaction-journal-store.js'
import { persistDurableGrant } from './durable-grant-persistence.js'
import { normalizeHomeV2RuntimeInvalidation } from './home-v2-runtime-invalidation.js'
import {
  createHomeV2SessionGrantStore,
  homeV2DurableAccountReadCapability,
  homeV2PermissionGrantKey,
  homeV2PermissionGrantFamily,
  isHomeV2AccountReadAction,
  isHomeV2ChatSendAction,
  isHomeV2ForeignWalletPermissionAction,
  isHomeV2PermissionlessAction,
} from './home-v2-session-grants.js'
import {
  assertHomeV2OpenPublicGroup,
  buildHomeV2QortiumPublicChatBuildBody,
  createHomeV2UnknownChatBroadcastResult,
  isHomeV2PublicChatAction,
  normalizeHomeV2PublicChatReferenceTarget,
  normalizeHomeV2PublicChatRequest,
  type HomeV2PublicChatAction,
  type HomeV2PublicChatRequest,
} from './home-v2-chat-actions.js'
import {
  encryptQdm1Message,
  encryptQortalDirectMessage,
} from './home-v2-direct-chat-actions.js'
import {
  assertHomeV2DirectReferenceTarget,
  decryptHomeV2DirectChatRow,
  directDecryptFailure,
  isHomeV2DirectChatReadAction,
  isHomeV2DirectChatWriteAction,
  normalizeHomeV2DirectChatReadRequest,
  normalizeHomeV2DirectChatWriteRequest,
  type HomeV2DirectChatWriteAction,
  type HomeV2DirectChatWriteRequest,
} from './home-v2-direct-chat-contract.js'
import {
  computeQpgcKeyId,
  createQpgcAutomaticKeySetupUnknownResult,
  createQpgcKeyAnnouncement,
  createQpgcKeyRequest,
  decryptQpgcMessage,
  decryptQpgcStoredKey,
  encryptQpgcMessage,
  encryptQpgcStoredKey,
  isQpgcBroadcastConfirmed,
  parseQpgcEnvelope,
  serializeQpgcEnvelope,
  unwrapQpgcAnnouncementForRecipient,
  type EncryptedQpgcStoredKey,
} from './home-v2-private-group-chat-actions.js'
import {
  isHomeV2PrivateGroupChatReadAction,
  isHomeV2PrivateGroupChatWriteAction,
  normalizeHomeV2PrivateGroupChatReadRequest,
  normalizeHomeV2PrivateGroupChatWriteRequest,
  normalizeHomeV2QpgcControlPage,
  normalizeHomeV2QpgcGroupState,
  type HomeV2PrivateGroupChatReadAction,
  type HomeV2PrivateGroupChatWriteAction,
  type HomeV2QpgcGroupState,
} from './home-v2-private-group-chat-contract.js'
import {
  findEncryptedQpgcKeyRecords,
  upsertEncryptedQpgcKeyRecord,
} from './home-v2-private-group-key-store.js'
import {
  appendQortalPrivateGroupKey,
  decryptQortalPrivateGroupBundle,
  decryptQortalPrivateGroupPayload,
  decryptQortalPrivateGroupStoredKeyRing,
  encryptQortalPrivateGroupBundle,
  encryptQortalPrivateGroupPayload,
  encryptQortalPrivateGroupStoredKeyRing,
  type QortalPrivateGroupKeyRing,
} from './home-v2-qortal-private-group-actions.js'
import {
  findEncryptedQortalPrivateGroupRecord,
  upsertEncryptedQortalPrivateGroupRecord,
} from './home-v2-qortal-private-group-key-store.js'
import {
  attestUnsignedQortalPrivateGroupPublish,
  signAttestedQortalPrivateGroupPublish,
} from './home-v2-qortal-private-group-publish.js'
import { selectHomeV2DesktopPublishSource } from './home-v2-desktop-publish-source.js'
import {
  HOME_V2_PUBLISH_BATCH_MAX_TOTAL_BYTES,
  HOME_V2_PUBLISH_DIRECTORY_LIMITS,
  getRequestedHomeV2PublishSourceKind,
  homeV2DesktopPublishSources,
  prepareHomeV2PublishArtifact,
  homeV2PublishPreviewTempAncestor,
  isHomeV2PublishSourceError,
  removeHomeV2PublishPreviewStagingDir,
  stageHomeV2DesktopPublishBlob,
  stageHomeV2PublishSourceForPreview,
  readHomeV2DesktopPublishSource,
} from './home-v2-publish-source-selection.js'
import { normalizeHomeV2PublishBlobRequest } from './home-v2-publish-blob-source.js'
import {
  normalizeHomeV2PublicPublishRequest,
  sha256Hex,
} from './home-v2-public-publish-contract.js'
import {
  deleteHomeV2QortiumResource,
  getHomeV2QortalArbitraryUnitFee,
  publishHomeV2EncryptedResource,
  publishHomeV2PublicResource,
} from './home-v2-public-publish.js'
import {
  normalizeHomeV2PublishMultipleRequest,
  normalizeHomeV2QdnDeleteRequest,
} from './home-v2-publish-extras-contract.js'
import {
  assertHomeV2QortalAtAcceptsAsset,
  assertUnsignedHomeV2QortalPaymentTransaction,
  assertUnsignedHomeV2QortalTransferAssetTransaction,
  assertUnsignedHomeV2QortiumPaymentTransaction,
  assertUnsignedHomeV2QortiumTransferAssetTransaction,
  buildUnsignedQortiumPaymentTransactionBytes,
  buildUnsignedQortiumTransferAssetTransactionBytes,
  buildUnsignedQortalTransferAssetTransactionBytes,
  canonicalHomeV2PaymentAction,
  homeV2CheckedTotalDebit,
  homeV2AtomicUnitsText,
  homeV2FeeForLength,
  homeV2PaymentOperationLabel,
  HomeV2ForeignSendError,
  isHomeV2PaymentAction,
  normalizeHomeV2NativeSendRequest,
  normalizeHomeV2SendQortRequest,
  normalizeHomeV2TransferAssetRequest,
  parseHomeV2UnitFee,
  selectHomeV2AssetInfo,
  selectHomeV2AtomicBalance,
  type HomeV2PaymentAction,
  type HomeV2PaymentRecipient,
} from './home-v2-payment-actions.js'
import {
  assertUnsignedHomeV2SetAccountAvatarTransaction,
  buildUnsignedQortiumSetAccountAvatarTransactionBytes,
  homeV2AccountAvatarOperationLabel,
  normalizeHomeV2SetAccountAvatarRequest,
  selectHomeV2AccountAvatarPointer,
} from './home-v2-account-avatar-actions.js'
import {
  assertUnsignedHomeV2RatingTransaction,
  buildUnsignedQortiumRatingTransactionBytes,
  homeV2RatingOperationLabel,
  isHomeV2RatingAction,
  normalizeHomeV2RateAccountRequest,
  normalizeHomeV2RateResourceRequest,
  selectHomeV2AccountRatingEdge,
  selectHomeV2CurrentResourceRating,
  type HomeV2RatingAction,
  type HomeV2RatingWirePayload,
} from './home-v2-rating-actions.js'
import {
  decryptQortalDeprecatedEnvelope,
  decryptQortalPublicKeyEnvelope,
  encryptQortalPublicKeyEnvelope,
  qortalEnvelopeKind,
} from './home-v2-app-encryption.js'
import {
  HOME_V2_DECRYPT_DATA_OPERATION_LABEL,
  HOME_V2_ENCRYPT_DATA_OPERATION_LABEL,
  normalizeHomeV2DecryptDataRequest,
  normalizeHomeV2EncryptDataRequest,
} from './home-v2-encryption-actions.js'
import type { HomeV2PublishSourceBinding } from './home-v2-publish-source-tokens.js'
import { HOME_V2_PUBLISH_SOURCE_MAX_BYTES } from './home-v2-publish-source-tokens.js'
import { getHomeV2PublishSizeCeiling } from './home-v2-publish-limits.js'
import {
  appendHomeV2GroupMembershipSignature,
  buildUnsignedQortalGroupMembershipTransactionBytes,
  createHomeV2GroupMembershipSuccess,
  createHomeV2UnknownGroupMembershipBroadcastResult,
  encodeHomeV2GroupMembershipTransaction,
  groupMembershipIdempotentState,
  isHomeV2GroupMembershipAction,
  normalizeHomeV2GroupMembershipRequest,
  normalizeHomeV2GroupMembershipTarget,
  normalizeQortalGroupMembershipFee,
  qortalGroupMembershipFeeType,
  type HomeV2GroupMembershipAction,
  type HomeV2GroupMembershipRequest,
  type HomeV2GroupMembershipTarget,
} from './home-v2-group-actions.js'
import {
  appendHomeV2GroupAdminSignature,
  assertHomeV2GroupAdminAuthority,
  assertUnsignedHomeV2GroupAdminTransaction,
  buildUnsignedQortalGroupAdminTransactionBytes,
  buildUnsignedQortiumGroupAdminTransactionBytes,
  createHomeV2GroupAdminSuccess,
  createHomeV2UnknownGroupAdminBroadcastResult,
  encodeHomeV2GroupAdminTransaction,
  groupAdminIdempotentResult,
  hasHomeV2GroupJoinRequest,
  homeV2GroupAdminOperationLabel,
  isHomeV2GroupAdminAction,
  normalizeHomeV2GroupAdminAddresses,
  normalizeHomeV2GroupAdminFee,
  normalizeHomeV2GroupAdminRequest,
  normalizeHomeV2GroupAdminTarget,
  qortalGroupAdminFeeType,
  type HomeV2GroupAdminAction,
  type HomeV2GroupAdminRequest,
  type HomeV2GroupAdminTarget,
} from './home-v2-group-admin-actions.js'
import {
  createHomeV2BridgeError,
  getHomeV2AppHostInfo,
  getHomeV2AppRouteDescriptor,
  getHomeV2AvailableAppActions,
  getHomeV2ContextualAppActions,
  homeV2WidgetWithholdsSelfSubject,
  normalizeHomeV2BridgeError,
  type HomeV2AppHostInfo,
} from './home-v2-app-runtime.js'
import {
  buildHomeV2SelfRewardSharesPath,
  createHomeV2MintingAccountsResult,
  createHomeV2RemoveMintingAccountResult,
  createHomeV2StartMintingResult,
  deriveHomeV2MintingStatus,
  homeV2MintingOperationLabel,
  isHomeV2MintingReadAction,
  isHomeV2MintingWriteAction,
  normalizeHomeV2MintingPublicKey,
  resolveHomeV2SelfMintingPublicKey,
  selectHomeV2SelfRewardShares,
  type HomeV2MintingWriteAction,
} from './home-v2-minting.js'
import {
  HOME_V2_RESTART_NODE_IMPACT,
  buildHomeV2NodeSettingsApprovalRows,
  createHomeV2NodeSettingsUpdateResult,
  homeV2NodeSettingsOperationLabel,
  homeV2WritableSettingKeys,
  isHomeV2NodeSettingsWriteAction,
  normalizeHomeV2NodeSettingsPatch,
  type HomeV2NodeSettingsWriteAction,
} from './home-v2-node-settings.js'
import {
  accountExists,
  getAccountProfile,
  getAccountForeignWalletSeed,
  getAccountSecretKey,
  getAccountSigningKey,
  getAccountSigningPublicKey,
  isAccountUnlocked,
  signChatTransaction,
  publicKeyToAddress,
  signDetached,
  signTransactionWithNonce,
  stampTransactionNonce,
} from './accounts.js'
import {
  deriveForeignWalletPublicRuntime,
  type ForeignWalletPublicRuntime,
} from './foreign-wallets.js'
import {
  executeForeignWalletRead,
  getForeignWalletPublicResponse,
  FOREIGN_WALLET_BACKEND_UNAVAILABLE_CODE,
  type ForeignWalletReadEndpoint,
} from './foreign-wallet-read-contract.js'
import {
  isHomeV2ForeignWalletAdminAction,
  isHomeV2ForeignWalletReadAction,
  normalizeHomeV2ForeignServerRequest,
  normalizeHomeV2ForeignWalletCoin,
} from './home-v2-foreign-wallet-actions.js'
import { isHomeV2ForeignSendRequest } from './home-v2-foreign-send-actions.js'
import {
  evaluateHomeV2ForeignSendValidity,
  executeHomeV2ForeignSend,
  HomeV2ForeignSendReconciliationError,
} from './home-v2-foreign-send.js'
import {
  classifyForeignWalletRouteProbe,
  createForeignWalletRouteProbeCache,
} from './foreign-wallet-route-probe.js'
import { HomeV2ForeignSendReconciliationPendingError } from './foreign-wallet-reconciliation.js'
import {
  clearReconciledStoredForeignWalletPendingTransaction,
  confirmStoredForeignWalletBroadcastSuccess,
  findStoredForeignWalletPendingTransactionConflict,
  listStoredForeignWalletPendingTransactions,
  recordForeignWalletBroadcastAttempt,
  recordSignedForeignWalletPendingTransaction,
  releaseNeverBroadcastStoredForeignWalletPendingTransaction,
} from './foreign-wallet-transaction-journal-store.js'
import { FOREIGN_WALLET_SEND_FRESHNESS_MS } from './foreign-wallet-reconciliation.js'
import { buildForeignWalletReadRequest } from './foreign-wallet-read-contract.js'
import { createHomeV2SendRateLimiter } from './home-v2-send-rate-limiter.js'
import { assertHomeV2UnlockCompleted } from './home-v2-unlock-contract.js'
import { base58Decode, base58Encode } from './base58.js'
import { computeHomeV2ChatNonce } from './home-v2-chat-pow.js'
import { deriveHomeV2RewardSharePrivateKey } from './home-v2-reward-share-key.js'
import {
  evaluateHomeV2AdminTrust,
  homeV2AdminTrustMessage,
  type HomeV2AdminTrust,
} from './home-v2-admin-trust.js'
import { getHomeV2NodeAdminKey } from './home-v2-node-admin-key.js'
import { readableNodeErrorMessage } from './node-error-body.js'
import { getNodeConnection } from './node-settings.js'
import {
  assertPublicBuyNameTransaction,
  assertPublicCancelSellNameTransaction,
  assertPublicChatTransaction,
  assertPublicCreatePollTransaction,
  assertPublicJoinGroupTransaction,
  assertPublicLeaveGroupTransaction,
  assertPublicRegisterNameTransaction,
  assertPublicSellNameTransaction,
  assertPublicUpdateNameTransaction,
  assertPublicUpdatePollTransaction,
  assertPublicVoteOnPollTransaction,
  getStaticQdnServiceId,
} from './public-transaction-validation.js'
import { parsePublicPollCapabilities } from './public-poll-capabilities.js'
import { parsePublicNameCapabilities } from './public-name-capabilities.js'
import {
  homeV2AvatarPointerText,
  homeV2PromptText,
  homeV2QuotedPromptText,
  homeV2ResourceCoordinateText,
  HOME_V2_MESSAGE_PROMPT_MAX_CHARS,
} from './home-v2-prompt-text.js'
import { assertUnsignedQortiumAtMessageTransaction } from './qdn-at-message-validation.js'
import {
  assertUnsignedHomeV2GroupMutationTransaction,
  buildUnsignedQortiumGroupMutationTransactionBytes,
  homeV2GroupMutationOperationLabel,
  isHomeV2GroupMutationAction,
  normalizeHomeV2CreateGroupRequest,
  normalizeHomeV2GroupApprovalRequest,
  normalizeHomeV2SetGroupAvatarRequest,
  normalizeHomeV2SetGroupRequest,
  normalizeHomeV2UpdateGroupRequest,
  selectHomeV2DefaultGroupId,
  selectHomeV2GroupMembership,
  selectHomeV2GroupAdminshipFromGroups,
  selectHomeV2GroupMetadata,
  selectHomeV2PendingTransactionSummary,
  type HomeV2GroupMutationAction,
  type HomeV2GroupMutationWirePayload,
} from './home-v2-group-mutation-actions.js'
import {
  buildUnsignedQortalDirectChatTransactionBytes,
  buildUnsignedQortalGroupChatTransactionBytes,
  qortalChatPowDifficultyForBalanceResponse,
  QORTAL_CHAT_POW_DIFFICULTY_BELOW,
  stampQortalGroupChatNonce,
} from './qortal-chat.js'
import {
  appendSignatureToTransactionBytes,
  buildUnsignedPaymentTransactionBytes,
  formatQortAtomic,
  getSignatureFromSignedTransactionBytes,
} from './qortal-payment.js'
import {
  isHomeV2CrosschainReadAction,
  projectHomeV2CrosschainReadResult,
} from './home-v2-crosschain-actions.js'
import {
  buildHomeV2AccountBalancePath,
  buildHomeV2AccountDataPath,
  buildHomeV2UserWalletResult,
  isHomeV2NativeWalletRequest,
  resolveHomeV2AccountReadAddress,
} from './home-v2-wallet-actions.js'
import {
  HomeV2MarketPriceCache,
  HOME_V2_MARKET_PRICE_MAX_BYTES,
  HOME_V2_MARKET_PRICE_TIMEOUT_MS,
  normalizeHomeV2MarketPriceRequest,
} from './home-v2-market-prices.js'
import {
  homeV2AtMessageOperationLabel,
  isHomeV2AtMessageAction,
  normalizeHomeV2AtMessageRequest,
  QORTIUM_AT_MESSAGE_POW_DIFFICULTY,
} from './home-v2-at-message-actions.js'
import { buildUnsignedQortiumAtMessageTransactionBytes } from './qdn-at-message.js'

import {
  buildWidgetRenderUrl,
  discoverWidgetManifest,
  parseWidgetResourceIdentity,
  type WidgetResourceIdentity,
} from './widget-discovery.js'
import {
  endWidgetDrag,
  getWidgetState,
  resizeWidget,
  setWidgetRegions,
  startWidgetDrag,
} from './widget-interaction.js'
import { normalizeRegion } from './widget-region.js'
import {
  WIDGET_MANIFEST_MAX_BYTES,
  type WidgetManifest,
} from './widget-manifest.js'
import {
  allocateWidgetId,
  assertWidgetCapacity,
  isWidgetTabId,
  listWidgets,
  registerWidget,
} from './widget-registry.js'
import { createWidgetWindow } from './widget-window.js'

export { getHomeV2AppActions as getHomeV2ReadOnlyAppActions }

// QdnViewContext.windowId is the host window's *webContents* id, not its
// BrowserWindow id (see getOrCreateEntry in qdn-views.ts). The two sequences
// only coincide for the first window, so resolving it as a window id silently
// yields null for every window opened after it.
function getContextWindow(context: QdnViewContext): BrowserWindow | null {
  const hostContents = webContents.fromId(context.windowId)
  if (!hostContents || hostContents.isDestroyed()) return null
  return BrowserWindow.fromWebContents(hostContents)
}

// The Qortium CHAT memory-pow difficulty. Mirrors the private CHAT_POW_DIFFICULTY
// constant in electron/qdn.ts and src/platform.ts (all three must stay equal;
// Core enforces this value server-side).
const QORTIUM_CHAT_POW_DIFFICULTY = 8
const CHAT_WRITE_TIMEOUT_MS = 30_000
// A few hundred KB is ample for a CHAT build/group-metadata/process/error
// response — bounds the signing-path node calls below (FIX #4, security
// review) using the same bounded-read approach as the rest of this file's
// read-only actions (readBoundedResponse / HOME_V2_APP_LIMITS.responseBytes).
const CHAT_SIGNING_RESPONSE_MAX_BYTES = 256 * 1024
const DIRECT_CHAT_READ_RESPONSE_MAX_BYTES = 1024 * 1024
const PRIVATE_GROUP_CHAT_READ_RESPONSE_MAX_BYTES = 2 * 1024 * 1024

// Every encryption path this action can reach (direct/group chat, Qortal
// hub-compatible IMAGE) enforces a 1 MiB ciphertext cap
// (PRIVATE_CHAT_ATTACHMENT_MAX_ENVELOPE_BYTES /
// QORTAL_PRIVATE_GROUP_MAX_ATTACHMENT_CIPHERTEXT_BYTES) - this exists to
// fail fast before the expensive hash/encrypt work below, with modest
// headroom over that real cap for encryption/framing overhead, not to
// duplicate Core's own precise validation, which still applies afterward.
const PRIVATE_ATTACHMENT_SOURCE_MAX_BYTES = 1536 * 1024

type AccountReadAction =
  // Uses the account key but reads no account data and signs nothing: it
  // returns ciphertext. Named here only because every promptable action passes
  // through requireAccountReadPermission; it is NOT in the 'account.read'
  // grant family, and homeV2PermissionGrantFamily keeps it under its own name.
  | 'DECRYPT_DATA'
  | 'ENCRYPT_DATA'
  | 'GET_SELECTED_ACCOUNT'
  | 'GET_USER_ACCOUNT'
  // Permissionless (home-v2-session-grants.ts); it appears here only because
  // it shares the GET_SELECTED_ACCOUNT handler and so passes through the same
  // gate, which returns immediately for permissionless actions.
  | 'GET_USER_WALLET'
  | 'GET_WALLET_BALANCE'
  | 'GET_USER_WALLET_INFO'
  | 'GET_USER_WALLET_TRANSACTIONS'
  | 'SET_CURRENT_FOREIGN_SERVER'
  // The one SIGNING member of this union. It is never permissionless and never
  // grantable; see the singleRequestOnly rule below.
  | 'SEND_MESSAGE'
  | 'GET_PRIVATE_DIRECT_ACTIVE_CHATS'
  | 'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES'
  | 'SEND_CHAT_DELETE'
  | 'SEND_CHAT_EDIT'
  | 'SEND_CHAT_MESSAGE'
  | 'SEND_CHAT_REACTION'
  | HomeV2DirectChatWriteAction
  | HomeV2PrivateGroupChatReadAction
  | HomeV2PrivateGroupChatWriteAction
  | 'JOIN_GROUP'
  | 'LEAVE_GROUP'
  | HomeV2GroupAdminAction
  | HomeV2PrivateAttachmentAction
  | 'PUBLISH_QDN_RESOURCE'
  | 'PUBLISH_MULTIPLE_QDN_RESOURCES'
  | 'DELETE_QDN_RESOURCE'
  | 'RATE_ACCOUNT'
  | 'RATE_RESOURCE'
  | 'SET_ACCOUNT_AVATAR'
  | 'PAYMENT'
  | 'SEND_COIN'
  | 'SEND_QORT'
  | 'TRANSFER_ASSET'
  | 'GET_PENDING_TRANSACTIONS'
  | 'FORGET_PENDING_TRANSACTION'
  | 'UNLOCK_SELECTED_ACCOUNT'
  | HomeV2MintingWriteAction
  | HomeV2ListWriteAction
  | HomeV2NodeSettingsWriteAction
  | HomeV2PollWriteAction
  | HomeV2NameWriteAction
  | HomeV2GroupMutationAction
type PermissionDecision = {
  readonly approved: boolean
  readonly scope: 'always' | 'session' | 'single-request' | null
}

const pendingAccountReads = new Map<string, {
  readonly grantKey?: string
  readonly hostWebContentsId: number
  // The app a pending prompt belongs to. Set by families that cap how many
  // prompts one app may have outstanding; absent entries are simply not
  // counted, so adding this changes no existing family's behaviour.
  readonly appIdentityKey?: string
  readonly tabId: string
  readonly targetNetwork?: HomeV2AppNetwork
  readonly resolve: (decision: PermissionDecision) => void
  readonly timeout: ReturnType<typeof setTimeout>
}>()

// The dedup key shape and the pending ceilings live in the shared contract
// module (assertHomeV2HomeSettingsPromptAdmissible), so they are unit-testable
// without an Electron window.

function drainPendingAccountReads(match: (pending: {
  readonly grantKey?: string
  readonly hostWebContentsId: number
  readonly tabId: string
}) => boolean) {
  for (const [requestId, pending] of pendingAccountReads) {
    if (!match(pending)) continue
    pendingAccountReads.delete(requestId)
    clearTimeout(pending.timeout)
    pending.resolve({ approved: false, scope: null })
  }
}

/**
 * Denies and forgets every pending permission prompt owned by a Home window
 * that is closing.
 *
 * Without this, a closed window's prompts sat in the map until their own 60s
 * timeout. Nothing could approve them — the chrome that would have rendered
 * them is gone — but they still occupied slots in the pending caps, so closing
 * and reopening a window was a way to keep the ceiling occupied against a
 * window that no longer exists.
 *
 * Every family is drained here, not just Home settings: none of them can be
 * answered once their window is gone.
 */
export function forgetHomeV2WindowPendingPrompts(hostWebContentsId: number) {
  drainPendingAccountReads((pending) => pending.hostWebContentsId === hostWebContentsId)
}

/**
 * Denies and forgets the HOME SETTINGS prompts owned by one app view that has
 * navigated.
 *
 * Deliberately narrow. An app navigating within itself is not grounds to tear
 * down every family's prompt — 'navigation-changed' explicitly keeps a tab's
 * account.read binding alive (see home-v2-runtime-invalidation.ts) and
 * widening this would change shipped behaviour for surfaces this task does not
 * own. But an UPDATE_HOME_SETTINGS prompt is bound to a specific proposed
 * change made by the document that asked, and after a navigation the
 * post-approval staleness recheck would refuse it anyway. Draining it here
 * frees the cap slot immediately instead of holding it for the full timeout,
 * and means the user is not left answering a question about a page that is no
 * longer there.
 */
export function forgetHomeV2TabPendingHomeSettingsPrompts(
  hostWebContentsId: number,
  tabId: string,
) {
  drainPendingAccountReads((pending) =>
    pending.hostWebContentsId === hostWebContentsId &&
    pending.tabId === tabId &&
    !!pending.grantKey?.startsWith(HOME_V2_HOME_SETTINGS_GRANT_KEY_PREFIX))
}
const pendingSessionGrantDecisions = new Map<string, Promise<PermissionDecision>>()
// The single open-menu-per-view registry lives in qdn-views (the lower-level
// module that owns the popup host), shared with the native right-click link
// menu — see reserveQdnViewContextMenu / releaseQdnViewContextMenu /
// closeQdnViewContextMenus.
const sessionAccountReadGrants = createHomeV2SessionGrantStore()
// Fix B (security review finding 8): bounds how often an already-granted tab
// can broadcast chat sends. See home-v2-send-rate-limiter.ts for the shared
// constants/algorithm (also used by Android's requestApp in
// src/home-v2-live/HomeV2LiveApp.tsx).
const chatSendRateLimiter = createHomeV2SendRateLimiter()

function homeV2AppIdentityKey(context: QdnViewContext): string {
  const resourceUrl = context.resourceUrl
  if (!resourceUrl) throw new Error('App request is missing its stable app identity.')
  return sanitizeQdnManagerAppKey(resourceUrl)
}

function homeV2NotificationAppName(appKey: string): string {
  const match = /^qdn:\/\/[^/]+\/([^/]+)/i.exec(appKey)
  if (!match) return 'QDN app'
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

async function requireHomeV2NotificationPermission(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  appKey: string,
) {
  if (!liveResourceMatchesGrant(context)) {
    throw new Error('Notification app context changed before approval completed.')
  }
  if (hasNotificationGrant(appKey)) return
  if (!isQdnViewVisible(context.windowId, context.tabId)) {
    throw new Error('Open this app tab to review the requested notification permission.')
  }
  const hostWindow = getContextWindow(context)
  if (!hostWindow || hostWindow.isDestroyed()) {
    throw new Error('The notification request does not belong to an active Home window.')
  }
  const grantKey = `notification|${context.windowId}|${context.tabId}|${appKey}|${protocol}`
  if (Array.from(pendingAccountReads.values()).some(
    (pending) => pending.hostWebContentsId === hostWindow.webContents.id && pending.grantKey === grantKey,
  )) {
    throw new Error('This notification permission request is already pending for the app tab.')
  }
  const requestId = randomUUID()
  const decision = await new Promise<PermissionDecision>((resolve) => {
    const timeout = setTimeout(() => {
      pendingAccountReads.delete(requestId)
      resolve({ approved: false, scope: null })
      if (!hostWindow.isDestroyed()) {
        hostWindow.webContents.send('home-v2-app:permission-timeout', { requestId })
      }
    }, 60_000)
    pendingAccountReads.set(requestId, {
      grantKey,
      hostWebContentsId: hostWindow.webContents.id,
      tabId: context.tabId,
      resolve,
      timeout,
    })
    hostWindow.webContents.send('home-v2-app:permission-request', {
      accountId: context.accountId,
      action: 'SHOW_NOTIFICATION',
      appIdentityKey: appKey,
      appTitle: homeV2NotificationAppName(appKey),
      protocol,
      requestId,
      resourceUrl: context.resourceUrl,
      tabId: context.tabId,
      targetNetwork: protocol === 'qortalRequest' ? 'qortal' : 'qortium',
      writeKind: 'notification',
      writeOperationLabel: 'Show notifications',
    })
  })
  if (!decision.approved || decision.scope !== 'always') {
    throw new Error('Notification permission was denied.')
  }
  const freshContext = getQdnViewContextForWebContents(sender)
  if (!freshContext || !sameViewContext(context, freshContext) || !liveResourceMatchesGrant(freshContext)) {
    throw new Error('Notification app context changed before approval completed.')
  }
  grantAppNotifications(appKey)
}

async function requireHomeV2BookmarkManagerPermission(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  action: 'BOOKMARKS_APPLY' | 'BOOKMARKS_GET' | 'BOOKMARKS_OPEN',
) {
  if (!liveResourceMatchesGrant(context)) {
    throw new Error('Bookmark manager app context changed before approval completed.')
  }
  const appKey = homeV2AppIdentityKey(context)
  if (hasQdnManagerPermission(appKey, 'bookmarks.manage')) return
  if (!isQdnViewVisible(context.windowId, context.tabId)) {
    throw new Error('Open this app tab to review the requested bookmark manager permission.')
  }
  const hostWindow = getContextWindow(context)
  if (!hostWindow || hostWindow.isDestroyed()) {
    throw new Error('The bookmark manager request does not belong to an active Home window.')
  }
  const grantKey = `bookmarks|${context.windowId}|${context.tabId}|${appKey}|${protocol}`
  if (Array.from(pendingAccountReads.values()).some(
    (pending) => pending.hostWebContentsId === hostWindow.webContents.id && pending.grantKey === grantKey,
  )) {
    throw new Error('This bookmark manager permission request is already pending for the app tab.')
  }
  const requestId = randomUUID()
  const decision = await new Promise<PermissionDecision>((resolve) => {
    const timeout = setTimeout(() => {
      pendingAccountReads.delete(requestId)
      resolve({ approved: false, scope: null })
      if (!hostWindow.isDestroyed()) {
        hostWindow.webContents.send('home-v2-app:permission-timeout', { requestId })
      }
    }, 60_000)
    pendingAccountReads.set(requestId, {
      grantKey,
      hostWebContentsId: hostWindow.webContents.id,
      tabId: context.tabId,
      resolve,
      timeout,
    })
    hostWindow.webContents.send('home-v2-app:permission-request', {
      accountId: context.accountId,
      action,
      appIdentityKey: appKey,
      appTitle: homeV2NotificationAppName(appKey),
      protocol,
      requestId,
      resourceUrl: context.resourceUrl,
      tabId: context.tabId,
      targetNetwork: 'qortium',
      writeKind: 'bookmarks',
      writeOperationLabel: 'Manage saved Home links',
    })
  })
  if (!decision.approved || decision.scope !== 'always') {
    throw new Error('Home data manager permission was denied.')
  }
  const freshContext = getQdnViewContextForWebContents(sender)
  if (!freshContext || !sameViewContext(context, freshContext) || !liveResourceMatchesGrant(freshContext)) {
    throw new Error('Bookmark manager app context changed before approval completed.')
  }
  grantQdnManagerPermission(appKey, 'bookmarks.manage')
}

/**
 * The gate for the whole NOTIFICATION_MANAGER_* family.
 *
 * A deliberate structural copy of requireHomeV2BookmarkManagerPermission above.
 * Three things about it are load-bearing and are why it is not folded into a
 * shared helper with a capability parameter — the divergence risk of a
 * near-identical second copy is real, but so is the risk of a "generalize it"
 * refactor quietly widening the bookmark gate:
 *
 * - The principal is homeV2AppIdentityKey -> sanitizeQdnManagerAppKey, NOT
 *   sanitizeQdnCapabilityPrincipal. The store keys capabilityGrants by the
 *   manager key; rekeying this family onto the canonical principal would drop
 *   every live 1.x grant on upgrade and silently re-prompt.
 * - Only 'always' is offered and only 'always' is accepted. A session-scoped
 *   answer to an administrative capability would be a grant the user cannot
 *   see or revoke in Settings.
 * - The app ASSIGNMENT (`notifications` -> Notify) grants nothing. Any app may
 *   request this capability, and the assigned app has no head start; see the
 *   header of qdn-manager-permissions.ts.
 */
async function requireHomeV2NotificationManagerPermission(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  // Deliberately excludes NOTIFICATION_MANAGER_HAS_PERMISSION: that action never
  // reaches this gate, and the trusted shell's prompt renderer does not accept
  // it as a promptable action.
  action: Exclude<HomeV2NotificationManagerAction, 'NOTIFICATION_MANAGER_HAS_PERMISSION'>,
) {
  if (!liveResourceMatchesGrant(context)) {
    throw new Error('Notification manager app context changed before approval completed.')
  }
  const appKey = homeV2AppIdentityKey(context)
  if (hasQdnManagerPermission(appKey, 'notifications.manage')) return appKey
  if (!isQdnViewVisible(context.windowId, context.tabId)) {
    throw new Error('Open this app tab to review the requested notification manager permission.')
  }
  const hostWindow = getContextWindow(context)
  if (!hostWindow || hostWindow.isDestroyed()) {
    throw new Error('The notification manager request does not belong to an active Home window.')
  }
  const grantKey = `notifications-manage|${context.windowId}|${context.tabId}|${appKey}|${protocol}`
  if (Array.from(pendingAccountReads.values()).some(
    (pending) => pending.hostWebContentsId === hostWindow.webContents.id && pending.grantKey === grantKey,
  )) {
    throw new Error('This notification manager permission request is already pending for the app tab.')
  }
  const requestId = randomUUID()
  const decision = await new Promise<PermissionDecision>((resolve) => {
    const timeout = setTimeout(() => {
      pendingAccountReads.delete(requestId)
      resolve({ approved: false, scope: null })
      if (!hostWindow.isDestroyed()) {
        hostWindow.webContents.send('home-v2-app:permission-timeout', { requestId })
      }
    }, 60_000)
    pendingAccountReads.set(requestId, {
      grantKey,
      hostWebContentsId: hostWindow.webContents.id,
      tabId: context.tabId,
      resolve,
      timeout,
    })
    hostWindow.webContents.send('home-v2-app:permission-request', {
      accountId: context.accountId,
      action,
      appIdentityKey: appKey,
      appTitle: homeV2NotificationAppName(appKey),
      protocol,
      requestId,
      resourceUrl: context.resourceUrl,
      tabId: context.tabId,
      targetNetwork: 'qortium',
      writeKind: 'notifications-manage',
      writeOperationLabel: 'Manage app notification permissions',
    })
  })
  if (!decision.approved || decision.scope !== 'always') {
    throw new Error('Home data manager permission was denied.')
  }
  const freshContext = getQdnViewContextForWebContents(sender)
  if (!freshContext || !sameViewContext(context, freshContext) || !liveResourceMatchesGrant(freshContext)) {
    throw new Error('Notification manager app context changed before approval completed.')
  }
  grantQdnManagerPermission(appKey, 'notifications.manage')
  return appKey
}

/**
 * Runs one NOTIFICATION_MANAGER_* action on the desktop store.
 *
 * The request is parsed BEFORE the permission gate, so a malformed request
 * cannot be used to raise a prompt the user would otherwise never see, and so a
 * denial and a validation failure are not distinguishable by whether a prompt
 * appeared. Staleness is rechecked after the prompt and again after the write,
 * matching the bookmark dispatch.
 */
async function handleHomeV2NotificationManagerAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  action: HomeV2NotificationManagerAction,
  requestValue: Record<string, unknown>,
) {
  const request = parseHomeV2NotificationManagerRequest(action, requestValue)
  if (request.kind === 'has-permission') {
    // Never prompts, never touches the notification store: an app must be able
    // to discover that it holds nothing without raising a modal.
    return { granted: hasQdnManagerPermission(homeV2AppIdentityKey(context), 'notifications.manage') }
  }
  await requireHomeV2NotificationManagerPermission(sender, context, protocol, request.action)
  const freshContext = getQdnViewContextForWebContents(sender)
  if (!freshContext || !sameViewContext(context, freshContext) || !liveResourceMatchesGrant(freshContext)) {
    throw new Error('QDN manager request is stale because the app view changed before it could run.')
  }
  const result = request.kind === 'get'
    ? readHomeV2NotificationManagerSummary(inspectNotificationStore())
    : summarizeHomeV2NotificationManagerStore(replaceNotificationStore(
        resolveHomeV2NotificationManagerMutation(inspectNotificationStore(), request),
      ))
  const completedContext = getQdnViewContextForWebContents(sender)
  if (!completedContext || !sameViewContext(context, completedContext) || !liveResourceMatchesGrant(completedContext)) {
    throw new Error('QDN manager request is stale because the app view changed while it was running.')
  }
  return result
}

// ---------------------------------------------------------------------------
// The app-facing Home-settings family: GET_HOME_SETTINGS_METADATA,
// GET_HOME_SETTINGS, UPDATE_HOME_SETTINGS.
//
// ARCHITECTURE. The main process does NOT own these settings and deliberately
// does not read or write them. Home 1.x resolved the same three in the RENDERER
// via a host round-trip (requestHomeSettingsFromHostWindow, qdn.ts:904-940)
// because the renderer owns display settings, and Home 2 keeps that shape: main
// asks the shell window over 'home-v2-app:home-settings-request' and the shell
// composes the answer from its appearance state and its notification-policy
// client.
//
// POSTURE. The app never touches the trusted notification-policy IPC. Home
// raises the prompt, and Home's own renderer performs the write — the same
// indirection 1.x used, and the same one BOOKMARKS_* uses through the
// collections bridge. What crosses this boundary from an app is a validated
// seven-key patch and nothing else.
//
// The envelope in both directions is validated by the shared contract module,
// so neither end trusts the other's shape and a renderer that grew an eighth
// field could not have it forwarded to an app.
// ---------------------------------------------------------------------------

const HOME_SETTINGS_REQUEST_TIMEOUT_MS = 60_000

const pendingHomeSettingsRequests = new Map<string, {
  readonly hostWebContentsId: number
  readonly reject: (error: Error) => void
  readonly resolve: (settings: HomeV2HomeSettings) => void
}>()

/**
 * Asks the shell window for the current settings, or to apply a patch.
 *
 * Structurally the same round-trip as requestHomeV2Collections in
 * home-v2-collections-bridge.ts: a pending map keyed by request id, a timeout,
 * cancellation when the host window closes, and a reply that is only accepted
 * from the window the request was sent to.
 */
function requestHomeV2HomeSettings(
  context: QdnViewContext,
  operation: 'apply' | 'read',
  patch?: HomeV2HomeSettingsPatch,
) {
  const hostWindow = getContextWindow(context)
  if (!hostWindow || hostWindow.isDestroyed()) {
    throw new Error('Home settings request does not belong to an active Home window.')
  }
  const requestId = randomUUID()
  const envelope = encodeHomeV2HomeSettingsRoundTripRequest({
    id: requestId,
    operation,
    patch: patch ?? null,
  })
  return new Promise<HomeV2HomeSettings>((resolve, reject) => {
    let settled = false
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      hostWindow.removeListener('closed', handleClosed)
      pendingHomeSettingsRequests.delete(requestId)
      callback()
    }
    const timeout = setTimeout(
      () => settle(() => reject(new Error('Home settings request timed out.'))),
      HOME_SETTINGS_REQUEST_TIMEOUT_MS,
    )
    const handleClosed = () => settle(() => reject(new Error('Home settings request was cancelled.')))
    pendingHomeSettingsRequests.set(requestId, {
      hostWebContentsId: hostWindow.webContents.id,
      reject: (error) => settle(() => reject(error)),
      resolve: (settings) => settle(() => resolve(settings)),
    })
    hostWindow.once('closed', handleClosed)
    try {
      hostWindow.webContents.send('home-v2-app:home-settings-request', envelope)
    } catch (error) {
      settle(() => reject(error instanceof Error ? error : new Error('Home settings request failed.')))
    }
  })
}

/**
 * The UPDATE_HOME_SETTINGS approval.
 *
 * SINGLE-REQUEST ONLY, and that is not an oversight to be "improved" later.
 * Unlike bookmarks.manage or notifications.manage there is no durable
 * capability here, nothing is written to the grant store, and nothing appears
 * in Settings > QDN Apps — because a durable grant to rewrite the user's theme,
 * language, zoom and notification toggle would produce effects the user sees
 * with no way to attribute them to any app. One approval, one patch, and the
 * next patch asks again.
 *
 * The prompt carries the per-key current-vs-proposed rows the shared contract
 * derived, so the user is answering "change theme from system to dark", not
 * "let this app change your settings".
 */
async function requestHomeV2HomeSettingsUpdateApproval(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  details: readonly { readonly label: string; readonly value: string }[],
) {
  if (!liveResourceMatchesGrant(context)) {
    throw new Error('Home settings app context changed before approval completed.')
  }
  if (!isQdnViewVisible(context.windowId, context.tabId)) {
    throw new Error('Open this app tab to review the requested Home settings change.')
  }
  const hostWindow = getContextWindow(context)
  if (!hostWindow || hostWindow.isDestroyed()) {
    throw new Error('The Home settings request does not belong to an active Home window.')
  }
  const appKey = homeV2AppIdentityKey(context)

  // Dedup and cap, mirroring queueAndroidPermissionPrompt in HomeV2LiveApp.tsx.
  //
  // Every UPDATE_HOME_SETTINGS is single-request, so unlike the durable manager
  // families there is no "already granted" early return to absorb repeats: an
  // app may issue hundreds of individually VALID updates and each one would
  // otherwise queue its own modal in trusted Home chrome and sit there for the
  // full 60s timeout. The semantic key includes the approval rows, so it
  // captures the app, the tab, the protocol AND the exact proposed change —
  // two different patches still prompt separately, the same patch twice does
  // not.
  //
  // The decision itself lives in the shared contract module so it can be tested
  // without an Electron window — which matters, because the bug it now prevents
  // (counting per window rather than across all of them) cannot be observed in
  // any single-window test. EVERY pending entry is passed, deliberately
  // unfiltered by host window.
  //
  // Cost is an O(pending) scan of a map the global cap itself holds at 20
  // entries, on a path that is about to put a modal in front of a human. An
  // index would be more machinery than the problem.
  //
  // Entries live in pendingAccountReads so they are drained on resolve, on
  // timeout, by invalidateRuntime (tab-close, app-replaced, account change,
  // lock), by forgetHomeV2WindowPendingPrompts on window close, and by
  // forgetHomeV2TabPendingHomeSettingsPrompts when an app view navigates.
  const hostWebContentsId = hostWindow.webContents.id
  const grantKey = buildHomeV2HomeSettingsGrantKey({
    appIdentityKey: appKey,
    details,
    protocol,
    tabId: context.tabId,
    windowId: context.windowId,
  })
  assertHomeV2HomeSettingsPromptAdmissible(
    Array.from(pendingAccountReads.values()),
    { appIdentityKey: appKey, grantKey },
  )

  const requestId = randomUUID()
  const decision = await new Promise<PermissionDecision>((resolve) => {
    const timeout = setTimeout(() => {
      pendingAccountReads.delete(requestId)
      resolve({ approved: false, scope: null })
      if (!hostWindow.isDestroyed()) {
        hostWindow.webContents.send('home-v2-app:permission-timeout', { requestId })
      }
    }, HOME_SETTINGS_REQUEST_TIMEOUT_MS)
    pendingAccountReads.set(requestId, {
      appIdentityKey: appKey,
      grantKey,
      hostWebContentsId,
      tabId: context.tabId,
      resolve,
      timeout,
    })
    hostWindow.webContents.send('home-v2-app:permission-request', {
      accountId: context.accountId,
      action: 'UPDATE_HOME_SETTINGS',
      appIdentityKey: appKey,
      appTitle: homeV2NotificationAppName(appKey),
      // The per-key rows. Plain label/value strings, re-validated in the shell
      // before they are rendered.
      homeSettingsDetails: details.map((detail) => ({ ...detail })),
      protocol,
      requestId,
      resourceUrl: context.resourceUrl,
      tabId: context.tabId,
      targetNetwork: 'qortium',
      writeKind: 'home-settings',
      writeOperationLabel: 'Change Home display settings',
      // Refused as anything but single-request at BOTH ends: the shell offers
      // only this scope, and the check below accepts only this scope.
      writeSingleRequestOnly: true,
    })
  })
  if (!decision.approved || decision.scope !== 'single-request') {
    throw new Error('Home settings update was denied.')
  }
  const freshContext = getQdnViewContextForWebContents(sender)
  if (!freshContext || !sameViewContext(context, freshContext) || !liveResourceMatchesGrant(freshContext)) {
    throw new Error('Home settings app context changed before approval completed.')
  }
}

/**
 * Runs one Home-settings action on desktop.
 *
 * Reads and metadata answer with no prompt, exactly as 1.x did. The update is
 * parsed BEFORE the prompt so a malformed patch cannot raise a prompt the user
 * would otherwise never see, and the current settings are read before the
 * prompt so the approval rows show real current values rather than assumptions.
 */
async function handleHomeV2HomeSettingsAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  action: HomeV2HomeSettingsAction,
  requestValue: Record<string, unknown>,
) {
  const request = parseHomeV2HomeSettingsRequest(action, requestValue)
  // Metadata is a pure constant: it never reaches the shell, never prompts, and
  // stays answerable while every window is busy.
  if (request.kind === 'metadata') return getHomeV2HomeSettingsMetadata()
  if (request.kind === 'read') return requestHomeV2HomeSettings(context, 'read')

  const current = await requestHomeV2HomeSettings(context, 'read')
  await requestHomeV2HomeSettingsUpdateApproval(
    sender,
    context,
    protocol,
    getHomeV2HomeSettingsApprovalDetails(current, request.patch),
  )
  const freshContext = getQdnViewContextForWebContents(sender)
  if (!freshContext || !sameViewContext(context, freshContext) || !liveResourceMatchesGrant(freshContext)) {
    throw new Error('Home settings request is stale because the app view changed before it could run.')
  }
  const applied = await requestHomeV2HomeSettings(context, 'apply', request.patch)
  const completedContext = getQdnViewContextForWebContents(sender)
  if (!completedContext || !sameViewContext(context, completedContext) || !liveResourceMatchesGrant(completedContext)) {
    throw new Error('Home settings request is stale because the app view changed while it was running.')
  }
  return applied
}

async function showHomeV2DesktopNotification(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  requestValue: Record<string, unknown>,
) {
  const request = normalizeHomeV2NotificationRequest(protocol, requestValue)
  const appKey = homeV2AppIdentityKey(context)
  await requireHomeV2NotificationPermission(sender, context, protocol, appKey)
  const resultBase = Object.freeze({ network: request.network, source: request.source })
  const grant = readNotificationStore().grants[appKey]
  if (!grant) return { ...resultBase, shown: false, reason: 'revoked' }
  if (grant.muted) return { ...resultBase, shown: false, reason: 'muted' }
  if (!areQdnAppNotificationsEnabled()) return { ...resultBase, shown: false, reason: 'disabled' }
  if (!Notification.isSupported()) return { ...resultBase, shown: false, reason: 'unsupported' }
  if (isQdnViewFocused(context.windowId, context.tabId)) {
    return { ...resultBase, shown: false, reason: 'focused' }
  }
  if (!consumeQdnAppNotificationRateLimit(appKey)) {
    return { ...resultBase, shown: false, reason: 'rate-limited' }
  }
  const chain = homeV2NotificationChainLabel(request.network)
  const notification = new Notification({
    body: request.text,
    title: `${request.title} — ${homeV2NotificationAppName(appKey)} · ${chain}`,
  })
  notification.on('click', () => {
    const hostWindow = getContextWindow(context)
    if (!hostWindow || hostWindow.isDestroyed()) return
    if (hostWindow.isMinimized()) hostWindow.restore()
    hostWindow.show()
    hostWindow.focus()
    hostWindow.webContents.send('home-v2-app:notification-clicked', {
      network: request.network,
      source: request.source,
      sourceKey: homeV2NotificationSourceKey(request.source),
      tabId: context.tabId,
    })
  })
  const latestGrant = readNotificationStore().grants[appKey]
  if (!latestGrant) return { ...resultBase, shown: false, reason: 'revoked' }
  if (latestGrant.muted) return { ...resultBase, shown: false, reason: 'muted' }
  if (!areQdnAppNotificationsEnabled()) return { ...resultBase, shown: false, reason: 'disabled' }
  notification.show()
  return { ...resultBase, shown: true }
}

// Fix 5 (Sol re-review #6): includes the sender's own WebContents id and its
// host window id, the same sender/window identity accountGrantKey below
// keys permission grants off of — a bare tabId|accountId key let a restored
// or duplicate tab id in a DIFFERENT window (or a different, unrelated
// WebContents that happened to reuse a tab id string) share — and so
// throttle — the SAME rate-limit bucket as this one.
function chatSendRateLimitKey(sender: WebContents, context: QdnViewContext) {
  return [sender.id, context.windowId, context.tabId, context.accountId ?? 'none'].join('|')
}

function sameViewContext(left: QdnViewContext, right: QdnViewContext) {
  return left.accountId === right.accountId &&
    left.resourceUrl === right.resourceUrl &&
    left.tabId === right.tabId &&
    left.windowId === right.windowId
}

// Fix A defense-in-depth (finding 1): a session grant and the permission
// prompt itself are keyed off `context.resourceUrl`, the identity Home's
// trusted top-level UI attached at launch — but that field is never updated
// by in-view navigation, so if a nav-guard path were ever missed,
// `resourceUrl` could keep pointing at the app that was originally granted
// while `currentUrl` (what the view actually has loaded) had drifted to a
// different app. With electron/qdn-views.ts's isAllowedInViewNavigation now
// constraining in-view navigation to the same resource, this should be
// unreachable — this check closes the gap regardless, and specifically
// refuses to honor a stale session grant when the two disagree.
//
// Fix 3 (Sol re-review #3): `context.currentUrl` (getQdnViewContextForWebContents,
// electron/qdn-views.ts) is the TRUSTED live URL — sourced directly from
// webContents.getURL() at the moment of this call, not from a field that
// could have gone stale — so this recheck fails closed against what the view
// actually has loaded right now, not a best-case snapshot. `resourceUrl` or
// `currentUrl` being absent is not itself suspicious (e.g. before the first
// load completes), so this only refuses when both are present and disagree.
function liveResourceMatchesGrant(context: QdnViewContext): boolean {
  if (!context.resourceUrl || !context.currentUrl) return true
  return isQdnRenderUrlSameAppResource(context.currentUrl, {
    nodeOrigin: context.nodeOrigin,
    requestedUrl: null,
    resourceUrl: context.resourceUrl,
  })
}

async function requireAccountReadPermission(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  action: AccountReadAction,
  writeDetails?: {
    readonly kind: 'chat'
    readonly targetChainLabel: string
    readonly groupId: number
    readonly messagePreview: string
    readonly operationLabel?: string
    readonly chatReference?: string | null
  } | {
    readonly kind: 'publish'
    readonly contentHash: string
    readonly fileName: string
    readonly operationLabel: string
    readonly resourceCoordinate: string
    readonly routeLabel: string
    readonly size: number
    readonly targetChainLabel: string
    // The Qortal chain fee this publish pays, pre-read and PINNED (the
    // signing path refuses a fee that moved after approval). Present exactly
    // when the chain charges one; Qortium publishes are fee-free mempow.
    readonly fee?: string
    // The mutable-metadata values that will be signed alongside the bytes
    // (Qortium only — the Qortal path refuses metadata). Escaped for the
    // prompt; each row appears exactly when that field is being published.
    readonly metadataCategory?: string
    readonly metadataDescription?: string
    readonly metadataTags?: string
    readonly metadataTitle?: string
  } | {
    readonly kind: 'direct'
    readonly targetChainLabel: string
    readonly messagePreview?: string
    readonly operationLabel: string
    readonly otherAddress: string
    readonly routeLabel: string
    readonly singleRequestOnly?: boolean
    readonly chatReference?: string | null
  } | {
    readonly kind: 'group'
    readonly targetChainLabel: string
    readonly groupId: number
    readonly groupName: string
    readonly operationLabel: string
    readonly routeLabel: string
    readonly memberAddress?: string
    readonly reason?: string
    readonly singleRequestOnly?: boolean
    readonly timeToLive?: number
  } | {
    readonly kind: 'private-group'
    readonly targetChainLabel: string
    readonly groupId: number
    readonly messagePreview?: string
    readonly operationLabel: string
    readonly routeLabel: string
    readonly singleRequestOnly?: boolean
    readonly chatReference?: string | null
  } | {
    readonly kind: 'journal'
    readonly operationLabel: string
    readonly signature: string
    readonly targetChainLabel: string
  } | {
    readonly kind: 'minting'
    readonly mintingAddress: string
    readonly mintingPublicKey?: string
    readonly operationLabel: string
    readonly routeLabel: string
    readonly targetChainLabel: string
  } | {
    readonly kind: 'node-list'
    // The Node/List/Items rows the prompt renders verbatim; the shell
    // re-validates them before rendering, as it does homeSettingsDetails.
    readonly listDetails: readonly { readonly label: string; readonly value: string }[]
    readonly listName: string
    readonly operationLabel: string
    readonly routeLabel: string
    readonly targetChainLabel: string
  } | {
    readonly kind: 'node-settings'
    // RESTART_NODE: the pinned Impact row plus the Node row. UPDATE: the Node
    // row plus the per-key current/proposed rows. The shell re-validates the
    // sequence per action before rendering, as it does nodeListDetails.
    readonly settingsDetails: readonly { readonly label: string; readonly value: string }[]
    readonly operationLabel: string
    readonly routeLabel: string
    readonly targetChainLabel: string
  } | {
    readonly kind: 'poll'
    readonly operationLabel: string
    // The per-action rows (Poll/Selection for a vote; Name/Description/
    // Options/Owner/times for create and update). Plain label/value strings,
    // re-validated in the shell before rendering.
    readonly pollDetails: readonly { readonly label: string; readonly value: string }[]
    readonly routeLabel: string
    // 'poll:<id>' for vote/update, 'poll-create:<name>' for create.
    readonly target: string
    readonly targetChainLabel: string
  } | {
    readonly kind: 'name'
    // The per-action rows, escaped to printable ASCII like the poll rows and
    // re-validated in the shell before rendering. BUY_NAME's rows are
    // payment-grade: the exact amount, who is paid, and any buyer
    // restriction.
    readonly nameDetails: readonly { readonly label: string; readonly value: string }[]
    readonly operationLabel: string
    readonly routeLabel: string
    // 'name:<exact requested name>'.
    readonly target: string
    readonly targetChainLabel: string
  } | {
    readonly kind: 'group-mutation'
    // The per-action rows, escaped and re-validated in the shell. A
    // GROUP_APPROVAL's rows disclose the pending transaction being voted on.
    readonly groupMutationDetails: readonly { readonly label: string; readonly value: string }[]
    readonly operationLabel: string
    readonly routeLabel: string
    // 'group:<id>' | 'group-create:<name>' | 'group-approval:<signature>' |
    // 'default-group:<id>'.
    readonly target: string
    readonly targetChainLabel: string
  } | {
    readonly kind: 'publish-multiple'
    // The numbered per-item rows (Items, then Resource/File/Size/SHA-256 —
    // and Fee plus a Total fee row on Qortal — for every item), escaped and
    // re-validated in the shell. Never a bare count: the 1.x prompt showed
    // only "N resources" and hid every target.
    readonly publishMultipleDetails: readonly { readonly label: string; readonly value: string }[]
    readonly operationLabel: string
    readonly routeLabel: string
    // 'publish-multiple:<sha256 of the ordered coordinate list>'.
    readonly target: string
    readonly targetChainLabel: string
  } | {
    readonly kind: 'qdn-delete'
    readonly operationLabel: string
    // '<service>/<name>/<identifier or default>' — the shell renders it with
    // its own fixed tombstone explanation copy.
    readonly resourceCoordinate: string
    readonly routeLabel: string
    readonly targetChainLabel: string
  } | {
    readonly kind: 'account-avatar'
    // 'service/name/identifier' for a pointer, or the fixed removal wording;
    // the shell renders these two values into its own fixed row structure.
    readonly avatarValue: string
    readonly currentValue: string | null
    readonly operationLabel: string
    readonly routeLabel: string
    readonly targetChainLabel: string
  } | {
    readonly kind: 'payment'
    // The per-action rows, escaped and re-validated in the shell. Payment
    // rows are payment-grade: exact canonical decimal AND atomic units,
    // who is paid, the Home-quoted fee, and the checked total debit.
    readonly paymentDetails: readonly { readonly label: string; readonly value: string }[]
    readonly operationLabel: string
    readonly routeLabel: string
    // 'payment:<chain>:<recipient>:<assetId>:<amountAtomic>'.
    readonly target: string
    readonly targetChainLabel: string
  } | {
    readonly kind: 'foreign-send'
    readonly chainId: string
    readonly coin: string
    // The per-send rows, escaped and re-validated in the shell against the
    // foreign-send sequence. Payment-grade like the native rows: the exact
    // decimal AND atomic amount, who is paid, the fee and its rate, where
    // change goes, and what is actually debited.
    readonly foreignSendDetails: readonly { readonly label: string; readonly value: string }[]
    readonly operationLabel: string
    readonly routeLabel: string
    // 'foreign-send:<coin>:<chainId>:<recipient>:<amountAtomic|max>'.
    readonly target: string
    readonly targetChainLabel: 'Qortium'
  } | {
    readonly kind: 'decrypt'
    readonly decryptDetails: readonly { readonly label: string; readonly value: string }[]
    readonly operationLabel: string
  } | {
    readonly kind: 'encrypt'
    // The rows the user sees, already ordered to the disclosure contract.
    readonly encryptDetails: readonly { readonly label: string; readonly value: string }[]
    readonly operationLabel: string
  } | {
    readonly kind: 'foreign-wallet-read'
    readonly coin: string
    readonly operationLabel: string
    readonly routeLabel: string
  } | {
    readonly kind: 'foreign-server'
    readonly coin: string
    readonly operationLabel: string
    readonly routeLabel: string
    readonly serverDetails: readonly { readonly label: string; readonly value: string }[]
  } | {
    readonly kind: 'rating'
    readonly operationLabel: string
    // The per-action rows, escaped and re-validated in the shell. A
    // RATE_ACCOUNT's rows lead with the ADDRESS Home derived locally from
    // the exact target key — never node- or app-supplied text.
    readonly ratingDetails: readonly { readonly label: string; readonly value: string }[]
    readonly routeLabel: string
    // 'account-rating:<key>:<category>' | 'resource-rating:<coordinate>'.
    readonly target: string
    readonly targetChainLabel: string
  },
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  // Fix A defense-in-depth: refuse before even consulting the session-grant
  // map when the view's live resource has drifted from what it was granted
  // for — a stale grant for a different, now-loaded app must never be honored.
  if (!liveResourceMatchesGrant(context)) {
    throw new Error('Account access context changed before approval completed.')
  }
  // Read-only actions are permissionless (owner decision, 2026-08-24).
  // Home decrypts private chat in-process and zeroes the key buffer, so no
  // key material ever reaches an app; reads therefore expose data the app is
  // being trusted with anyway once the user opens it. Everything that SENDS,
  // publishes, spends, unlocks the account or writes to disk still gates
  // below. The checks above this line are NOT skipped: an unselected account
  // and a drifted live resource are still refused.
  if (isHomeV2PermissionlessAction(action) && writeDetails?.kind !== 'foreign-wallet-read') return

  const targetNetwork = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
  const routeIndependent = action === 'GET_PENDING_TRANSACTIONS' ||
    action === 'FORGET_PENDING_TRANSACTION' ||
    (action === 'GET_USER_WALLET' && writeDetails?.kind === 'foreign-wallet-read')
  const nodeBefore = routeIndependent ? null : await getHomeV2ReadableNode(targetNetwork)
  const nodeRoute = nodeBefore ? `${nodeBefore.mode}|${nodeBefore.nodeApiUrl}` : 'route-independent'
  const accountUnlocked = isAccountUnlocked(context.accountId)
  const grantTarget = writeDetails?.kind === 'group' || writeDetails?.kind === 'private-group'
      ? `group:${writeDetails.groupId}`
      : writeDetails?.kind === 'chat'
        ? `public-group:${writeDetails.groupId}`
      : writeDetails?.kind === 'direct'
        ? `direct:${writeDetails.otherAddress}`
        : writeDetails?.kind === 'journal'
          ? `signature:${writeDetails.signature}`
        : writeDetails?.kind === 'minting'
          ? `minting:${writeDetails.mintingPublicKey ?? writeDetails.mintingAddress}`
        : writeDetails?.kind === 'node-list'
          ? `node-list:${writeDetails.listName}`
        : writeDetails?.kind === 'poll'
          ? writeDetails.target
        : writeDetails?.kind === 'name'
          ? writeDetails.target
        : writeDetails?.kind === 'group-mutation'
          ? writeDetails.target
        : writeDetails?.kind === 'publish-multiple'
          ? writeDetails.target
        : writeDetails?.kind === 'qdn-delete'
          ? `qdn-delete:${writeDetails.resourceCoordinate}`
        : writeDetails?.kind === 'rating'
          ? writeDetails.target
        : writeDetails?.kind === 'account-avatar'
          ? 'account-avatar'
        : writeDetails?.kind === 'payment' || writeDetails?.kind === 'foreign-send'
          ? writeDetails.target
        : writeDetails?.kind === 'foreign-server'
          ? `foreign-server:${writeDetails.coin}`
        : ''
  const grantKey = homeV2PermissionGrantKey({
    accountId: context.accountId,
    accountUnlocked,
    action,
    appIdentity: context.resourceUrl ?? 'unknown-app',
    nodeRoute,
    principalId: sender.id,
    protocol,
    tabId: context.tabId,
    target: grantTarget,
    writeKind: writeDetails?.kind,
  })
  const singleRequestOnly = action === 'UNLOCK_SELECTED_ACCOUNT' ||
    // SEND_MESSAGE signs a chain transaction. Pinned to the ACTION rather than
    // to writeDetails.kind on purpose: it reuses the 'direct' write kind for
    // its prompt payload, and the 'direct' arm below only forces
    // single-request when the caller remembers to pass singleRequestOnly.
    // Naming the action here means no future edit to that payload can make one
    // approval cover a second signed message.
    action === 'SEND_MESSAGE' ||
    (!isHomeV2AccountReadAction(action) && writeDetails?.kind === 'publish') ||
    writeDetails?.kind === 'journal' ||
    // Minting writes load or remove a key on the user's own node. Neither is
    // ever retained as a session or durable grant: every one asks again.
    writeDetails?.kind === 'minting' ||
    // List writes change what the user's node stores, and what other apps
    // then show. Every one asks again, exactly as 1.x prompted per request.
    writeDetails?.kind === 'node-list' ||
    // Node-settings writes reconfigure or restart the user's own Core.
    // Every one asks again, exactly as 1.x prompted per request.
    writeDetails?.kind === 'node-settings' ||
    // Poll writes sign chain transactions. Never a session or durable grant.
    writeDetails?.kind === 'poll' ||
    // Name writes sign chain transactions too — BUY_NAME moves coins.
    writeDetails?.kind === 'name' ||
    // Group mutations sign chain transactions. Never a session/durable grant.
    writeDetails?.kind === 'group-mutation' ||
    // A publish batch signs up to ten transactions and a deletion signs the
    // permanent on-chain tombstone. Never a session or durable grant.
    writeDetails?.kind === 'publish-multiple' ||
    writeDetails?.kind === 'qdn-delete' ||
    // Rating writes sign chain transactions. Never a session/durable grant.
    writeDetails?.kind === 'rating' ||
    // The account avatar signs a chain transaction too.
    writeDetails?.kind === 'account-avatar' ||
    // Payments MOVE FUNDS, native or foreign. A foreign send moves them on
    // another chain, irreversibly. Never a session or durable grant, ever.
    writeDetails?.kind === 'payment' ||
    writeDetails?.kind === 'foreign-send' ||
    writeDetails?.kind === 'foreign-server' ||
    (writeDetails?.kind === 'group' || writeDetails?.kind === 'direct' || writeDetails?.kind === 'private-group') &&
    writeDetails.singleRequestOnly === true
  // A durable per-app chat-send grant ("always allow", revocable in QDN Apps
  // settings) skips the prompt entirely. Scoped to chat sends only: publishing,
  // unlocking, group admin and key rotation are never grantable this way.
  const chatSendGrantable = isHomeV2ChatSendAction(action) && !singleRequestOnly
  // The same durable machinery for the read-only account family (owner
  // decision, R3-10). Membership comes from homeV2DurableAccountReadCapability,
  // which answers only for HOME_V2_ACCOUNT_READ_ACTIONS and returns null for
  // everything else — so this can never short-circuit a send, a publish, an
  // unlock, a group-admin action or a minting write, and it is additionally
  // gated on !singleRequestOnly. Permissionless actions never reach here at
  // all; they returned above.
  const durableAccountReadCapability = singleRequestOnly
    ? null
    : homeV2DurableAccountReadCapability(action)
  const appGrantKey = context.resourceUrl ?? ''
  if (chatSendGrantable && appGrantKey && hasQdnAppCapability(appGrantKey, 'chat.send')) {
    return
  }
  // The durable ENCRYPT grant. Account-scoped like the read grant below, and
  // checked against the SAME (principal, selected account) pair, so a grant
  // approved under one account cannot cover another. Gated on the action name
  // rather than on writeDetails.kind: nothing else may ever reach a signing
  // or reading arm through this capability.
  if (
    action === 'ENCRYPT_DATA' &&
    !singleRequestOnly &&
    appGrantKey &&
    hasQdnAccountCapability(appGrantKey, context.accountId, 'account.encrypt')
  ) {
    return
  }
  // The durable DECRYPT grant. Its own capability, checked separately: an
  // app allowed to encrypt has not thereby been allowed to read.
  if (
    action === 'DECRYPT_DATA' &&
    !singleRequestOnly &&
    appGrantKey &&
    hasQdnAccountCapability(appGrantKey, context.accountId, 'account.decrypt')
  ) {
    return
  }
  // The durable DIRECT MESSAGE grant. Its own capability -- an app allowed to
  // decrypt data it already holds has not thereby been allowed to read a
  // mailbox.
  //
  // UNREACHABLE: direct reads are permissionless (2026-08-24); kept so
  // re-permissioning them keeps the grant path.
  //
  // Honored on ANY node route (owner decision, 2026-09-01, reversing the
  // 2026-08-30 trusted-node gate): these reads fetch ciphertext and decrypt
  // inside Home, so a public operator observes access METADATA only (which
  // conversations, when, from which address) -- as the session grant already
  // leaked. The durable form extends that exposure across launches; accepted
  // knowingly. Route shown at consent; revocable in Settings.
  if (
    (action === 'GET_PRIVATE_DIRECT_ACTIVE_CHATS' ||
      action === 'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES') &&
    !singleRequestOnly &&
    appGrantKey &&
    writeDetails?.kind === 'direct' &&
    hasQdnAccountCapability(appGrantKey, context.accountId, 'account.directChat')
  ) {
    return
  }
  // Private-group history, on exactly the same terms. Deliberately a SEPARATE
  // capability from account.directChat rather than one "read my chats" grant:
  // allowing an app to read group history is not the same decision as handing
  // it one-to-one messages, and neither prompt claims to cover the other.
  //
  // GET_PRIVATE_GROUP_CHAT_STATE is excluded on purpose. It reports whether a
  // group key is held and needs rotating -- it is the call an app makes before
  // asking for anything, and it does not return message plaintext, so it stays
  // on the ordinary read permission rather than being swept into a grant that
  // is described to the user as reading their chat history.
  if (
    (action === 'GET_PRIVATE_GROUP_ACTIVE_CHATS' ||
      action === 'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES') &&
    !singleRequestOnly &&
    appGrantKey &&
    writeDetails?.kind === 'private-group' &&
    hasQdnAccountCapability(appGrantKey, context.accountId, 'account.groupChat')
  ) {
    return
  }
  // The durable read grant is checked against BOTH the canonical resource
  // principal and the currently selected account:
  // - hasQdnAccountCapability resolves the principal through
  //   sanitizeQdnCapabilityPrincipal, so a nonblank `?identifier=` is the
  //   effective identifier. Without that, qdn://APP/Chat/default and
  //   qdn://APP/Chat/default?identifier=evil collapsed to one key and the
  //   second resource inherited the first one's grant.
  // - binding to context.accountId matches the session grant, which is
  //   dropped outright on 'account-changed'. A durable grant approved while
  //   one account was selected must not survive a switch to another.
  if (
    durableAccountReadCapability &&
    appGrantKey &&
    hasQdnAccountCapability(appGrantKey, context.accountId, durableAccountReadCapability)
  ) {
    return
  }
  if (!singleRequestOnly && sessionAccountReadGrants.has(grantKey)) return
  const hostWindow = getContextWindow(context)
  if (!hostWindow || hostWindow.isDestroyed()) {
    throw new Error('The app request does not belong to an active Home window.')
  }
  let ownsPendingDecision = false
  let decisionPromise = !singleRequestOnly
    ? pendingSessionGrantDecisions.get(grantKey)
    : undefined
  if (!decisionPromise) {
    if (!isQdnViewVisible(context.windowId, context.tabId)) {
      throw new Error('Open this app tab to review the requested permission.')
    }
    ownsPendingDecision = !singleRequestOnly
    const requestId = randomUUID()
    decisionPromise = new Promise<PermissionDecision>((resolve) => {
      const timeout = setTimeout(() => {
        pendingAccountReads.delete(requestId)
        resolve({ approved: false, scope: null })
        // The renderer's permission-prompt UI (queuePermissionPrompt) is only
        // told about approval/denial via home-v2-app:permission-resolve, which
        // normally originates FROM the renderer when the user clicks a button.
        // On this main-process-initiated auto-deny, tell it explicitly so the
        // prompt does not stay stuck on screen after the request has already
        // been denied here (FIX #3, security review).
        if (!hostWindow.isDestroyed()) {
          hostWindow.webContents.send('home-v2-app:permission-timeout', { requestId })
        }
      }, 60_000)
      pendingAccountReads.set(requestId, {
        grantKey,
        hostWebContentsId: hostWindow.webContents.id,
        tabId: context.tabId,
        targetNetwork,
        resolve,
        timeout,
      })
      hostWindow.webContents.send('home-v2-app:permission-request', {
        accountId: context.accountId,
        action,
        appIdentityKey: context.resourceUrl ?? `home-v2-tab:${context.tabId}`,
        appTitle: context.resourceUrl ?? 'QDN app',
        protocol,
        requestId,
        resourceUrl: context.resourceUrl,
        tabId: context.tabId,
        targetNetwork,
        ...(writeDetails?.kind === 'chat'
        ? {
            writeKind: 'chat',
            chatGroupId: writeDetails.groupId,
            chatMessagePreview: writeDetails.messagePreview,
            writeOperationLabel: writeDetails.operationLabel ?? 'Send message',
            chatReference: writeDetails.chatReference ?? null,
            writeTargetChainLabel: writeDetails.targetChainLabel,
          }
        : writeDetails?.kind === 'direct'
          ? {
              writeKind: 'direct',
              chatMessagePreview: writeDetails.messagePreview ?? null,
              chatReference: writeDetails.chatReference ?? null,
              writeOperationLabel: writeDetails.operationLabel,
              writeOtherAddress: writeDetails.otherAddress,
              writeRouteLabel: writeDetails.routeLabel,
              writeSingleRequestOnly: writeDetails.singleRequestOnly === true,
              writeTargetChainLabel: writeDetails.targetChainLabel,
            }
          : writeDetails?.kind === 'group'
          ? {
              writeKind: 'group',
              groupId: writeDetails.groupId,
              groupName: writeDetails.groupName,
              writeOperationLabel: writeDetails.operationLabel,
              writeRouteLabel: writeDetails.routeLabel,
              writeTargetChainLabel: writeDetails.targetChainLabel,
              writeMemberAddress: writeDetails.memberAddress,
              writeReason: writeDetails.reason,
              writeSingleRequestOnly: writeDetails.singleRequestOnly === true,
              writeTimeToLive: writeDetails.timeToLive,
            }
          : writeDetails?.kind === 'private-group'
            ? {
                writeKind: 'private-group',
                chatGroupId: writeDetails.groupId,
                chatMessagePreview: writeDetails.messagePreview ?? null,
                chatReference: writeDetails.chatReference ?? null,
                writeOperationLabel: writeDetails.operationLabel,
                writeRouteLabel: writeDetails.routeLabel,
                writeSingleRequestOnly: writeDetails.singleRequestOnly === true,
                writeTargetChainLabel: writeDetails.targetChainLabel,
              }
          : writeDetails?.kind === 'publish'
            ? {
                writeKind: 'publish',
                publishContentHash: writeDetails.contentHash,
                publishFee: writeDetails.fee ?? null,
                publishFileName: writeDetails.fileName,
                publishMetadataCategory: writeDetails.metadataCategory ?? null,
                publishMetadataDescription: writeDetails.metadataDescription ?? null,
                publishMetadataTags: writeDetails.metadataTags ?? null,
                publishMetadataTitle: writeDetails.metadataTitle ?? null,
                publishResourceCoordinate: writeDetails.resourceCoordinate,
                publishSize: writeDetails.size,
                writeOperationLabel: writeDetails.operationLabel,
                writeRouteLabel: writeDetails.routeLabel,
                // Report the value this function actually enforces instead of
                // a hard-coded `true`. Publishing, PUBLISH_CHAT_ATTACHMENT and
                // SAVE_CHAT_ATTACHMENT are not account-read actions, so
                // singleRequestOnly stays true for them and their prompt keeps
                // offering single-request only. The two attachment READS
                // (GET_CHAT_ATTACHMENT_STREAM_URL, OPEN_CHAT_ATTACHMENT_VIEWER)
                // are account-read family members that this function has always
                // allowed to hold a session grant; the flag was telling the
                // prompt otherwise and hiding the scopes they qualify for.
                writeSingleRequestOnly: singleRequestOnly,
                writeTargetChainLabel: writeDetails.targetChainLabel,
              }
          : writeDetails?.kind === 'journal'
            ? {
                journalSignature: writeDetails.signature,
                writeKind: 'journal',
                writeOperationLabel: writeDetails.operationLabel,
                writeSingleRequestOnly: true,
                writeTargetChainLabel: writeDetails.targetChainLabel,
              }
          : writeDetails?.kind === 'minting'
            ? {
                writeKind: 'minting',
                writeMintingAddress: writeDetails.mintingAddress,
                writeMintingPublicKey: writeDetails.mintingPublicKey ?? null,
                writeOperationLabel: writeDetails.operationLabel,
                writeRouteLabel: writeDetails.routeLabel,
                writeSingleRequestOnly: true,
                writeTargetChainLabel: writeDetails.targetChainLabel,
              }
          : writeDetails?.kind === 'node-list'
            ? {
                writeKind: 'node-list',
                // The Node/List/Items rows. Plain label/value strings,
                // re-validated in the shell before they are rendered.
                nodeListDetails: writeDetails.listDetails.map((detail) => ({ ...detail })),
                writeOperationLabel: writeDetails.operationLabel,
                writeRouteLabel: writeDetails.routeLabel,
                writeSingleRequestOnly: true,
                writeTargetChainLabel: writeDetails.targetChainLabel,
              }
          : writeDetails?.kind === 'node-settings'
            ? {
                writeKind: 'node-settings',
                // The per-action row sequence. Plain label/value strings,
                // re-validated in the shell before they are rendered.
                nodeSettingsDetails: writeDetails.settingsDetails.map((detail) => ({ ...detail })),
                writeOperationLabel: writeDetails.operationLabel,
                writeRouteLabel: writeDetails.routeLabel,
                writeSingleRequestOnly: true,
                writeTargetChainLabel: writeDetails.targetChainLabel,
              }
          : writeDetails?.kind === 'poll'
            ? {
                writeKind: 'poll',
                pollDetails: writeDetails.pollDetails.map((detail) => ({ ...detail })),
                writeOperationLabel: writeDetails.operationLabel,
                writeRouteLabel: writeDetails.routeLabel,
                writeSingleRequestOnly: true,
                writeTargetChainLabel: writeDetails.targetChainLabel,
              }
          : writeDetails?.kind === 'name'
            ? {
                nameDetails: writeDetails.nameDetails.map((detail) => ({ ...detail })),
                writeKind: 'name',
                writeOperationLabel: writeDetails.operationLabel,
                writeRouteLabel: writeDetails.routeLabel,
                writeSingleRequestOnly: true,
                writeTargetChainLabel: writeDetails.targetChainLabel,
              }
          : writeDetails?.kind === 'group-mutation'
            ? {
                groupMutationDetails: writeDetails.groupMutationDetails.map((detail) => ({ ...detail })),
                writeKind: 'group-mutation',
                writeOperationLabel: writeDetails.operationLabel,
                writeRouteLabel: writeDetails.routeLabel,
                writeSingleRequestOnly: true,
                writeTargetChainLabel: writeDetails.targetChainLabel,
              }
          : writeDetails?.kind === 'publish-multiple'
            ? {
                publishMultipleDetails: writeDetails.publishMultipleDetails.map((detail) => ({ ...detail })),
                writeKind: 'publish-multiple',
                writeOperationLabel: writeDetails.operationLabel,
                writeRouteLabel: writeDetails.routeLabel,
                writeSingleRequestOnly: true,
                writeTargetChainLabel: writeDetails.targetChainLabel,
              }
          : writeDetails?.kind === 'qdn-delete'
            ? {
                deleteResourceCoordinate: writeDetails.resourceCoordinate,
                writeKind: 'qdn-delete',
                writeOperationLabel: writeDetails.operationLabel,
                writeRouteLabel: writeDetails.routeLabel,
                writeSingleRequestOnly: true,
                writeTargetChainLabel: writeDetails.targetChainLabel,
              }
          : writeDetails?.kind === 'decrypt'
            ? {
                decryptDetails: writeDetails.decryptDetails.map((detail) => ({ ...detail })),
                writeKind: 'decrypt',
                writeOperationLabel: writeDetails.operationLabel,
                writeSingleRequestOnly: false,
              }
          : writeDetails?.kind === 'encrypt'
            ? {
                encryptDetails: writeDetails.encryptDetails.map((detail) => ({ ...detail })),
                writeKind: 'encrypt',
                writeOperationLabel: writeDetails.operationLabel,
                // Deliberately NOT single-request: encryption returns
                // ciphertext and is not an oracle, so a durable grant is
                // offered. There is no route or chain row because the
                // operation touches neither.
                writeSingleRequestOnly: false,
              }
          : writeDetails?.kind === 'rating'
            ? {
                ratingDetails: writeDetails.ratingDetails.map((detail) => ({ ...detail })),
                writeKind: 'rating',
                writeOperationLabel: writeDetails.operationLabel,
                writeRouteLabel: writeDetails.routeLabel,
                writeSingleRequestOnly: true,
                writeTargetChainLabel: writeDetails.targetChainLabel,
              }
          : writeDetails?.kind === 'account-avatar'
            ? {
                avatarCurrentValue: writeDetails.currentValue,
                avatarValue: writeDetails.avatarValue,
                writeKind: 'account-avatar',
                writeOperationLabel: writeDetails.operationLabel,
                writeRouteLabel: writeDetails.routeLabel,
                writeSingleRequestOnly: true,
                writeTargetChainLabel: writeDetails.targetChainLabel,
              }
          : writeDetails?.kind === 'payment'
            ? {
                paymentDetails: writeDetails.paymentDetails.map((detail) => ({ ...detail })),
                writeKind: 'payment',
                writeOperationLabel: writeDetails.operationLabel,
                writeRouteLabel: writeDetails.routeLabel,
                writeSingleRequestOnly: true,
                writeTargetChainLabel: writeDetails.targetChainLabel,
              }
          : writeDetails?.kind === 'foreign-send'
            ? {
                foreignSendChainId: writeDetails.chainId,
                foreignSendCoin: writeDetails.coin,
                foreignSendDetails: writeDetails.foreignSendDetails.map((detail) => ({ ...detail })),
                writeKind: 'foreign-send',
                writeOperationLabel: writeDetails.operationLabel,
                writeRouteLabel: writeDetails.routeLabel,
                writeSingleRequestOnly: true,
                writeTargetChainLabel: 'Qortium',
              }
          : writeDetails?.kind === 'foreign-wallet-read'
            ? {
                foreignWalletCoin: writeDetails.coin,
                writeKind: 'foreign-wallet-read',
                writeOperationLabel: writeDetails.operationLabel,
                writeRouteLabel: writeDetails.routeLabel,
                writeSingleRequestOnly: false,
                writeTargetChainLabel: 'Qortium',
              }
          : writeDetails?.kind === 'foreign-server'
            ? {
                foreignServerCoin: writeDetails.coin,
                foreignServerDetails: writeDetails.serverDetails.map((detail) => ({ ...detail })),
                writeKind: 'foreign-server',
                writeOperationLabel: writeDetails.operationLabel,
                writeRouteLabel: writeDetails.routeLabel,
                writeSingleRequestOnly: true,
                writeTargetChainLabel: 'Qortium',
              }
            : {}),
      })
    })
    if (!singleRequestOnly) pendingSessionGrantDecisions.set(grantKey, decisionPromise)
  }
  let decision: PermissionDecision
  try {
    decision = await decisionPromise
  } finally {
    if (ownsPendingDecision) pendingSessionGrantDecisions.delete(grantKey)
  }
  if (!decision.approved) throw new Error('Account access was denied.')
  const freshContext = getQdnViewContextForWebContents(sender)
  if (
    !freshContext ||
    !sameViewContext(context, freshContext) ||
    !liveResourceMatchesGrant(freshContext)
  ) {
    throw new Error('Account access context changed before approval completed.')
  }
  if (action === 'UNLOCK_SELECTED_ACCOUNT') {
    assertHomeV2UnlockCompleted(context.accountId, isAccountUnlocked)
  } else if (!isHomeV2AccountReadAction(action) && isAccountUnlocked(context.accountId) !== accountUnlocked) {
    throw new Error('Account lock state changed before approval completed.')
  }
  if (!routeIndependent && !isHomeV2AccountReadAction(action)) {
    const nodeAfter = await getHomeV2ReadableNode(targetNetwork)
    if (`${nodeAfter.mode}|${nodeAfter.nodeApiUrl}` !== nodeRoute) {
      throw new Error('Account access node route changed before approval completed.')
    }
  }
  // A durable grant must never fail the action the user just approved, and must
  // never be BELIEVED unless it actually stuck. Two distinct failure modes:
  //   - the write throws (an app key the capability store refuses outright,
  //     e.g. a `qortal://` resource before that scheme was supported);
  //   - the write returns normally but persists nothing, because the store's
  //     own sanitizer discards the key on read-back. That one is silent, so
  //     returning here would leave the user believing they had answered
  //     "always" while nothing was retained at all.
  // persistDurableGrant covers both by re-reading the grant, and every caller
  // falls through to the session grant below when it reports failure.
  if (decision.scope === 'always' && chatSendGrantable && appGrantKey) {
    if (persistDurableGrant({
      capability: 'chat.send',
      isHeld: () => hasQdnAppCapability(appGrantKey, 'chat.send'),
      write: () => grantQdnAppCapabilityPermission(appGrantKey, 'chat.send'),
    })) return
  }
  // Gated on durableAccountReadCapability rather than on the scope alone, so an
  // 'always' arriving for anything outside the read-only account family retains
  // nothing. The grant is bound to the selected account as well as the app.
  // An account-bound grant needs an account: with none selected the 'always'
  // choice falls through to the session grant below, which is the narrower
  // outcome and never wider than what the prompt described.
  const grantAccountId = context.accountId
  if (
    decision.scope === 'always' &&
    durableAccountReadCapability &&
    appGrantKey &&
    grantAccountId
  ) {
    if (persistDurableGrant({
      capability: durableAccountReadCapability,
      isHeld: () => hasQdnAccountCapability(
        appGrantKey,
        grantAccountId,
        durableAccountReadCapability,
      ),
      write: () => grantQdnAccountCapabilityPermission(
        appGrantKey,
        grantAccountId,
        durableAccountReadCapability,
      ),
    })) return
  }
  // The durable ENCRYPT grant, on the same terms as the read grant above:
  // gated on the ACTION rather than on the scope alone, bound to the app and
  // the selected account, and falling through to the session grant if the
  // write does not stick. Kept a separate block rather than folded into
  // durableAccountReadCapability, because that helper answers only for the
  // read family and must keep doing so — collapsing them is exactly how an
  // 'always allow' for reading would start covering use of the key.
  if (
    decision.scope === 'always' &&
    action === 'DECRYPT_DATA' &&
    !singleRequestOnly &&
    appGrantKey &&
    grantAccountId
  ) {
    if (persistDurableGrant({
      capability: 'account.decrypt',
      isHeld: () => hasQdnAccountCapability(appGrantKey, grantAccountId, 'account.decrypt'),
      write: () => grantQdnAccountCapabilityPermission(
        appGrantKey,
        grantAccountId,
        'account.decrypt',
      ),
    })) return
  }
  // Recorded on any route (owner decision, 2026-09-01): the read is
  // ciphertext-to-the-node and decrypted locally, so the durable grant is as
  // safe to keep as the session grant it replaces, and it stays revocable in
  // Settings > QDN Apps.
  if (
    decision.scope === 'always' &&
    (action === 'GET_PRIVATE_DIRECT_ACTIVE_CHATS' ||
      action === 'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES') &&
    !singleRequestOnly &&
    appGrantKey &&
    grantAccountId &&
    writeDetails?.kind === 'direct'
  ) {
    if (persistDurableGrant({
      capability: 'account.directChat',
      isHeld: () => hasQdnAccountCapability(appGrantKey, grantAccountId, 'account.directChat'),
      write: () => grantQdnAccountCapabilityPermission(
        appGrantKey,
        grantAccountId,
        'account.directChat',
      ),
    })) return
  }
  // Private-group history, on the same terms.
  if (
    decision.scope === 'always' &&
    (action === 'GET_PRIVATE_GROUP_ACTIVE_CHATS' ||
      action === 'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES') &&
    !singleRequestOnly &&
    appGrantKey &&
    grantAccountId &&
    writeDetails?.kind === 'private-group'
  ) {
    if (persistDurableGrant({
      capability: 'account.groupChat',
      isHeld: () => hasQdnAccountCapability(appGrantKey, grantAccountId, 'account.groupChat'),
      write: () => grantQdnAccountCapabilityPermission(
        appGrantKey,
        grantAccountId,
        'account.groupChat',
      ),
    })) return
  }
  if (
    decision.scope === 'always' &&
    action === 'ENCRYPT_DATA' &&
    !singleRequestOnly &&
    appGrantKey &&
    grantAccountId
  ) {
    if (persistDurableGrant({
      capability: 'account.encrypt',
      isHeld: () => hasQdnAccountCapability(appGrantKey, grantAccountId, 'account.encrypt'),
      write: () => grantQdnAccountCapabilityPermission(
        appGrantKey,
        grantAccountId,
        'account.encrypt',
      ),
    })) return
  }
  if (!singleRequestOnly && (decision.scope === 'session' || decision.scope === 'always')) {
    sessionAccountReadGrants.add(grantKey, {
      family: homeV2PermissionGrantFamily(action),
      hostWebContentsId: context.windowId,
      network: targetNetwork,
      tabId: context.tabId,
    })
  }
}

function homeV2PublishSourceBinding(input: {
  readonly context: QdnViewContext
  readonly network: HomeV2AppNetwork
  readonly nodeApiUrl: string
  readonly protocol: HomeV2AppBridgeProtocol
  readonly routeRevision: string
}): HomeV2PublishSourceBinding {
  if (!input.context.accountId) throw new Error('No account is selected for this tab.')
  return Object.freeze({
    accountId: input.context.accountId,
    appIdentity: input.context.resourceUrl ?? input.context.currentUrl ?? `home-v2-tab:${input.context.tabId}`,
    network: input.network,
    nodeApiUrl: input.nodeApiUrl,
    protocol: input.protocol,
    routeRevision: input.routeRevision,
    tabId: input.context.tabId,
  })
}

function homeV2ResourceStreamBinding(input: {
  readonly context: QdnViewContext
  readonly network: HomeV2AppNetwork
  readonly nodeApiUrl: string
  readonly protocol: HomeV2AppBridgeProtocol
  readonly routeRevision: string
}): HomeV2ResourceStreamBinding {
  return Object.freeze({
    accountId: input.context.accountId,
    appIdentity: input.context.resourceUrl ?? input.context.currentUrl ?? `home-v2-tab:${input.context.tabId}`,
    network: input.network,
    nodeApiUrl: input.nodeApiUrl,
    protocol: input.protocol,
    routeRevision: input.routeRevision,
    tabId: input.context.tabId,
  })
}

function homeV2ResourceStreamValidator(input: {
  readonly context: QdnViewContext
  readonly network: HomeV2AppNetwork
  readonly nodeRoute: string
  readonly sender: WebContents
}) {
  return async () => {
    const fresh = getQdnViewContextForWebContents(input.sender)
    if (!fresh || !sameViewContext(input.context, fresh) || !liveResourceMatchesGrant(fresh)) return false
    const current = await getHomeV2ReadableNode(input.network).catch(() => null)
    return !!current && `${current.mode}|${current.nodeApiUrl}` === input.nodeRoute
  }
}

function issueHomeV2ResourceStream(input: {
  readonly context: QdnViewContext
  readonly mimeType: string | null
  readonly network: HomeV2AppNetwork
  readonly node: { mode: string; nodeApiUrl: string }
  readonly protocol: HomeV2AppBridgeProtocol
  readonly routeRevision: string
  readonly sender: WebContents
  readonly targetSession: Session
  readonly upstreamUrl: string
}) {
  const nodeRoute = `${input.node.mode}|${input.node.nodeApiUrl}`
  return issueHomeV2DesktopResourceStream({
    binding: homeV2ResourceStreamBinding({
      context: input.context,
      network: input.network,
      nodeApiUrl: input.node.nodeApiUrl,
      protocol: input.protocol,
      routeRevision: input.routeRevision,
    }),
    isStillValid: homeV2ResourceStreamValidator({
      context: input.context,
      network: input.network,
      nodeRoute,
      sender: input.sender,
    }),
    mimeType: input.mimeType,
    targetSession: input.targetSession,
    upstreamUrl: input.upstreamUrl,
  })
}

const HOME_V2_PREVIEW_STAGING_FAILED =
  'Home could not prepare the selected source for preview. Select it again.'
const HOME_V2_PREVIEW_UNSUPPORTED_CONTENT =
  'Unsupported preview content. Choose a folder or zip containing an index.html file, an HTML file, or an image, video, or audio file.'
const HOME_V2_PREVIEW_NODE_FAILED = 'The node could not render the preview. Try again.'
const HOME_V2_PREVIEW_NODE_TOO_OLD =
  'The connected Qortium Core node does not support QDN previews yet. Update Qortium Core and try again.'

/**
 * Preview failures reach an APP, so they must never carry a filesystem path or
 * a node error body: both name directories on the user's machine (the staged
 * copy lives under the OS temp dir, and Core echoes the path it was given).
 * Messages the publish-source module raises are already fixed, path-free
 * sentences and pass through; everything else is logged in the main process
 * and replaced with one of the constants above.
 */
function homeV2PreviewFailure(error: unknown, fallbackMessage: string) {
  if (isHomeV2PublishSourceError(error)) return error
  console.warn('[home-v2-app] QDN publish preview failed:', error)
  return new Error(fallbackMessage)
}

function homeV2PreviewNodeMessage(error: unknown) {
  const status = typeof (error as { status?: unknown } | null)?.status === 'number'
    ? (error as { status: number }).status
    : 0
  // Nodes without the endpoint answer with a generic 404, or a 500 HTML page.
  return status === 404 || status === 500 ? HOME_V2_PREVIEW_NODE_TOO_OLD : HOME_V2_PREVIEW_NODE_FAILED
}

/**
 * Render a chosen publish source so the user can look at it before publishing.
 *
 * Gated to a LOCAL node, deliberately. Previewing sends the selected bytes to
 * the node, which renders them -- so on someone else's node the operator would
 * see the file before the user had decided to publish it. qdn.ts flags the same
 * hazard on the 1.x path. On a local managed Core there is no third party, so
 * no approval prompt is needed either; on anything else this refuses.
 *
 * The render URL is never returned to the app: Home opens the preview itself,
 * through the resource viewer, so the app cannot read the staged bytes back out
 * of a URL it was handed.
 */
async function previewHomeV2PublishSource(
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  routeRevision: string,
  requestValue: Record<string, unknown>,
) {
  const sourceToken = stringField(requestValue, 'sourceToken')
  if (!sourceToken) {
    throw new Error('Select a QDN publish source before previewing it.')
  }
  const { apiKey, node } = await resolveHomeV2AdminNode(network)
  if (node.mode !== 'local' || !apiKey) {
    throw new Error(
      'Previewing sends the selected file to the node, so it is only available on your own local Core.',
    )
  }
  const hostWindow = getContextWindow(context)
  if (!hostWindow || hostWindow.isDestroyed()) {
    throw new Error('The preview request does not belong to an active Home window.')
  }
  const source = homeV2DesktopPublishSources.resolve(sourceToken, homeV2PublishSourceBinding({
    context,
    network,
    nodeApiUrl: node.nodeApiUrl,
    protocol,
    routeRevision,
  }))
  // Home never hands Core a path the user owns. The selection is copied into a
  // Home-owned staging directory with every rule re-enforced during the copy,
  // and Core is handed that copy: validating and then passing the live path
  // would leave a window in which an escaping symlink could be added, a file
  // could grow past the cap, or the whole path could be swapped.
  const staged = await stageHomeV2PublishSourceForPreview(source)
    .catch((error: unknown) => {
      throw homeV2PreviewFailure(error, HOME_V2_PREVIEW_STAGING_FAILED)
    })
  // Core's own stager makes a second temp directory for a .zip or a bare .html
  // (qdn.ts), and nothing in Home 2 sweeps those, so both are collected here.
  const stagingDirs = new Set<string>([staged.stagingDir])
  try {
    let previewPath: string
    let service: string
    try {
      ;({ previewPath, service } = await stageQdnPreviewSource(staged.previewPath))
      const ancestor = homeV2PublishPreviewTempAncestor(previewPath)
      if (ancestor) stagingDirs.add(ancestor)
    } catch (error) {
      throw homeV2PreviewFailure(error, HOME_V2_PREVIEW_UNSUPPORTED_CONTENT)
    }
    let renderPath: string
    try {
      const rendered = await postHomeV2ChatText(
        node.nodeApiUrl,
        `/arbitrary/preview/${encodeURIComponent(service)}`,
        previewPath,
        'text/plain',
        'QDN preview request failed.',
        apiKey,
      )
      renderPath = typeof rendered === 'string' ? rendered.trim() : ''
    } catch (error) {
      throw homeV2PreviewFailure(error, homeV2PreviewNodeMessage(error))
    }
    if (!renderPath.startsWith('/render/')) {
      throw new Error('The node returned an unexpected preview URL.')
    }
    // Opened as an app TAB, not the resource viewer: the viewer renders images,
    // audio and video and otherwise offers a download, so a WEBSITE preview --
    // which is what a folder, a .zip or an .html stages as -- would have shown
    // the user a download panel instead of their site. The app-tab view is the
    // only surface that can render a site, which is exactly what
    // docs/HOME_V2_BRIDGE_COMPATIBILITY.md said this action was waiting for.
    hostWindow.webContents.send('home-v2-app:open-publish-preview', {
      network,
      previewUrl: `${node.nodeApiUrl.replace(/\/+$/, '')}${renderPath}`,
      service,
      sourceTabId: context.tabId,
      // The BASENAME, which the app already received from the picker (1.x
      // contract, and Explore displays it). Nothing else path-shaped leaves
      // this handler.
      title: source.fileName,
    })
    return true
  } finally {
    // Core has already built and cached the preview by hash by the time the
    // POST returns (ArbitraryResource.previewUpload says so explicitly), so the
    // staged copy of the user's unpublished content need not outlive the call.
    await Promise.all([...stagingDirs].map(removeHomeV2PublishPreviewStagingDir))
  }
}

// STAGE_QDN_PUBLISH_SOURCE (B1): the app supplies the bytes (paste/drop)
// instead of Home's picker, and receives the same shape of selection back.
// No prompt fires here — staging grants nothing; the publish actions that
// redeem the token still run their full approval flow.
async function stageHomeV2PublicPublishSource(
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  routeRevision: string,
  requestValue: Record<string, unknown>,
) {
  const blob = normalizeHomeV2PublishBlobRequest(requestValue)
  const node = await getHomeV2ReadableNode(network)
  return stageHomeV2DesktopPublishBlob(homeV2PublishSourceBinding({
    context,
    network,
    nodeApiUrl: node.nodeApiUrl,
    protocol,
    routeRevision,
  }), blob)
}

async function selectHomeV2PublicPublishSource(
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  routeRevision: string,
  requestValue: Record<string, unknown>,
) {
  // `kind` was dropped when this action was ported, so every app got a file
  // picker no matter what it asked for. It is honoured again here (1.x
  // getRequestedQdnPublishSourceKind), defaulting to 'file' so the publish
  // flows behave exactly as before. ONE parser, in the selection module.
  const kind = getRequestedHomeV2PublishSourceKind(requestValue)
  // Folder sources and the node-discovered ceiling are Qortium-only:
  // publishQortium is the only publish path that understands isZip, previewing
  // is off the Qortal catalogue entirely (it needs a local Core Home has no
  // write key for on that route), and Qortal's base64-body upload has its own
  // separate size ceiling (a V8 string-length limit around 384 MiB) that a
  // Qortium-derived ceiling could exceed. Qortal keeps exactly its
  // pre-existing behaviour: files only, 100 MiB.
  if (kind === 'directory' && network !== 'qortium') {
    throw new Error('Folder publish sources are available on Qortium only. Ask for a file.')
  }
  const node = await getHomeV2ReadableNode(network)
  const maximumFileBytes = network === 'qortium'
    ? await getHomeV2PublishSizeCeiling(network, node.nodeApiUrl)
    : HOME_V2_PUBLISH_SOURCE_MAX_BYTES
  return selectHomeV2DesktopPublishSource(context.windowId, homeV2PublishSourceBinding({
    context,
    network,
    nodeApiUrl: node.nodeApiUrl,
    protocol,
    routeRevision,
  }), kind, { ...HOME_V2_PUBLISH_DIRECTORY_LIMITS, maximumFileBytes })
}

async function publishHomeV2PublicPublishSource(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  routeRevision: string,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  if (!isAccountUnlocked(context.accountId)) throw createHomeV2BridgeError('The selected account is locked.', {
    action: 'PUBLISH_QDN_RESOURCE',
    code: 'ACCOUNT_LOCKED',
    network,
    retryable: false,
    routeRevision,
  })
  const accountId = context.accountId
  const request = normalizeHomeV2PublicPublishRequest(network, requestValue)
  const node = await getHomeV2ReadableNode(network)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const binding = homeV2PublishSourceBinding({
    context,
    network,
    nodeApiUrl: node.nodeApiUrl,
    protocol,
    routeRevision,
  })
  const source = homeV2DesktopPublishSources.resolve(request.sourceToken, binding)
  // Folder sources are Qortium-only (see selectHomeV2PublicPublishSource): the
  // isZip upload and the unpackZip attestation both exist on that path alone.
  if (source.kind === 'directory' && network !== 'qortium') {
    throw new Error('Folder publish sources are available on Qortium only. Select a file to publish.')
  }
  // The ceiling this route actually enforces: what the node advertises,
  // clamped by Home's own resident-memory ceiling inside the selection module.
  const maximumBytes = network === 'qortium'
    ? await getHomeV2PublishSizeCeiling(network, node.nodeApiUrl)
    : HOME_V2_PUBLISH_SOURCE_MAX_BYTES
  // A folder is PACKAGED here — streamed into a Home-owned temp zip with every
  // ceiling enforced as bytes are read — and a file is pinned open on its
  // inode. Either way the bytes are not resident yet: the prompt below is
  // built from a STREAMED hash, and the archive is only loaded once the user
  // has approved that exact hash.
  const artifact = await prepareHomeV2PublishArtifact(source, { maximumBytes })
  try {
    const contentHash = await artifact.sha256()
    // A packaged folder is uploaded (and named) as the archive it now is, so
    // the prompt names the same thing the transaction will carry.
    const publishFileName = artifact.isZip ? `${source.fileName.slice(0, 176)}.zip` : source.fileName
    const profile = await getAccountProfile(accountId)
    const nameValue = await readHomeV2ChatJson(
      node.nodeApiUrl,
      `/names/${encodeURIComponent(request.resource.name)}`,
      `${network === 'qortal' ? 'Qortal' : 'Qortium'} publisher-name lookup`,
    )
    if (stringField(nameValue, 'owner') !== profile.address) {
      throw new Error('The selected account does not currently own the requested publisher name on this chain.')
    }
    // On Qortal this publish pays the chain's ARBITRARY unit fee: read it
    // BEFORE the prompt so it is disclosed, and pin it so the signing path
    // refuses a fee that moved after approval (a lying node could otherwise
    // build an arbitrarily high valid fee the user never saw).
    const feeAtomic = network === 'qortal' ? await getHomeV2QortalArbitraryUnitFee(node.nodeApiUrl) : 0n
    await requireAccountReadPermission(sender, context, protocol, 'PUBLISH_QDN_RESOURCE', {
      kind: 'publish',
      contentHash,
      ...(network === 'qortal' ? { fee: `${homeV2AtomicDecimal(feeAtomic)} coins` } : {}),
      fileName: publishFileName,
      ...(request.resource.title ? { metadataTitle: homeV2PollApprovalText(request.resource.title, 'The resource title') } : {}),
      ...(request.resource.description ? { metadataDescription: homeV2PollApprovalText(request.resource.description, 'The resource description') } : {}),
      ...(request.resource.category ? { metadataCategory: homeV2PollApprovalText(request.resource.category, 'The resource category') } : {}),
      ...(request.resource.tags.length ? { metadataTags: homeV2PollApprovalText(request.resource.tags.join(', '), 'The resource tags') } : {}),
      operationLabel: 'Publish a public QDN resource',
      resourceCoordinate: `${request.resource.service}/${request.resource.name}/${request.resource.identifier ?? 'default'}`,
      routeLabel: `${node.mode} · ${node.nodeApiUrl}`,
      size: artifact.byteLength,
      targetChainLabel: network === 'qortal' ? 'Qortal' : 'Qortium',
    })
    const isStillValid = async () => {
      const fresh = getQdnViewContextForWebContents(sender)
      if (!fresh || !sameViewContext(context, fresh) || !liveResourceMatchesGrant(fresh) || !isAccountUnlocked(accountId)) return false
      const current = await getHomeV2ReadableNode(network).catch(() => null)
      return !!current && `${current.mode}|${current.nodeApiUrl}` === nodeRoute
    }
    if (!(await isStillValid())) throw new Error('The app, account, or node route changed before public publishing.')
    const currentNameValue = await readHomeV2ChatJson(
      node.nodeApiUrl,
      `/names/${encodeURIComponent(request.resource.name)}`,
      `${network === 'qortal' ? 'Qortal' : 'Qortium'} publisher-name recheck`,
    )
    if (stringField(currentNameValue, 'owner') !== profile.address || !(await isStillValid())) {
      throw new Error('Publisher-name ownership or the app context changed after approval.')
    }
    const result = await publishHomeV2PublicResource({
      accountId,
      ...(network === 'qortal' ? { expectedFeeAtomic: feeAtomic } : {}),
      fileName: publishFileName,
      isStillValid,
      isZip: artifact.isZip,
      network,
      nodeApiUrl: node.nodeApiUrl,
      resource: request.resource,
      // Loaded HERE, after approval, and re-hashed against the value the user
      // saw: a mismatch means the source moved between the prompt and the
      // upload, and refuses rather than publishing something else.
      sourceBytes: await artifact.read(),
    })
    if (result.accepted || result.outcome === 'unknown') {
      homeV2DesktopPublishSources.release(request.sourceToken)
    }
    return result
  } finally {
    // Always: this releases the packaged folder's temp archive and the open
    // handle pinning a file source's inode.
    await artifact.dispose()
  }
}

function homeV2AtomicDecimal(atomic: bigint) {
  return `${atomic / 100_000_000n}.${(atomic % 100_000_000n).toString().padStart(8, '0')}`
}

async function publishHomeV2MultiplePublishSources(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  routeRevision: string,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  if (!isAccountUnlocked(context.accountId)) throw createHomeV2BridgeError('The selected account is locked.', {
    action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
    code: 'ACCOUNT_LOCKED',
    network,
    retryable: false,
    routeRevision,
  })
  const accountId = context.accountId
  const request = normalizeHomeV2PublishMultipleRequest(network, requestValue)
  const node = await getHomeV2ReadableNode(network)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const chainLabel = network === 'qortal' ? 'Qortal' : 'Qortium'
  const binding = homeV2PublishSourceBinding({
    context,
    network,
    nodeApiUrl: node.nodeApiUrl,
    protocol,
    routeRevision,
  })
  // Resolve EVERY selected source before the prompt, so the rows describe the
  // exact bytes each transaction will attest — the token store's
  // device/inode/size recheck makes a swapped file refuse here.
  const resolved = request.items.map((item) => ({
    item,
    source: homeV2DesktopPublishSources.resolve(item.sourceToken, binding),
  }))
  for (const entry of resolved) {
    if (entry.source.kind === 'directory' && network !== 'qortium') {
      throw new Error('Folder publish sources are available on Qortium only. Select files to publish.')
    }
  }
  // A batch is where per-source ceilings stop being enough: this action hashes
  // every item before ONE approval prompt, so N selections at the per-source
  // ceiling would otherwise be N times that much work and memory. The
  // aggregate is refused BEFORE anything is opened, read or packaged.
  const selectedBytes = resolved.reduce((total, entry) => total + entry.source.size, 0)
  if (selectedBytes > HOME_V2_PUBLISH_BATCH_MAX_TOTAL_BYTES) {
    throw new Error(
      `PUBLISH_MULTIPLE_QDN_RESOURCES accepts at most ${HOME_V2_PUBLISH_BATCH_MAX_TOTAL_BYTES} bytes of sources per batch.`,
    )
  }
  const maximumBytes = network === 'qortium'
    ? await getHomeV2PublishSizeCeiling(network, node.nodeApiUrl)
    : HOME_V2_PUBLISH_SOURCE_MAX_BYTES
  const items = [] as {
    readonly artifact: Awaited<ReturnType<typeof prepareHomeV2PublishArtifact>>
    readonly contentHash: string
    readonly fileName: string
    readonly item: (typeof request.items)[number]
    readonly source: ReturnType<typeof homeV2DesktopPublishSources.resolve>
  }[]
  try {
    // Hashed from a STREAM, not from a retained buffer: what a batch keeps
    // alive across the prompt is one open handle (or one temp archive) per
    // item, and the bytes themselves are loaded one item at a time below.
    for (const entry of resolved) {
      const artifact = await prepareHomeV2PublishArtifact(entry.source, { maximumBytes })
      items.push({
        artifact,
        contentHash: await artifact.sha256(),
        fileName: artifact.isZip ? `${entry.source.fileName.slice(0, 176)}.zip` : entry.source.fileName,
        item: entry.item,
        source: entry.source,
      })
    }
    const packagedBytes = items.reduce((total, entry) => total + entry.artifact.byteLength, 0)
    if (packagedBytes > HOME_V2_PUBLISH_BATCH_MAX_TOTAL_BYTES) {
      throw new Error(
        `PUBLISH_MULTIPLE_QDN_RESOURCES accepts at most ${HOME_V2_PUBLISH_BATCH_MAX_TOTAL_BYTES} bytes of packaged sources per batch.`,
      )
    }
    const profile = await getAccountProfile(accountId)
    // Every DISTINCT publisher name must be owned by the selected account —
    // checked before the prompt and again per item at signing time. (1.x read
    // only the first item's context and never checked ownership per target.)
    const assertNameOwned = async (name: string, label: string) => {
      const nameValue = await readHomeV2ChatJson(
        node.nodeApiUrl,
        `/names/${encodeURIComponent(name)}`,
        `${chainLabel} publisher-name ${label}`,
      )
      if (stringField(nameValue, 'owner') !== profile.address) {
        throw new Error(`The selected account does not currently own the publisher name ${name} on this chain.`)
      }
    }
    const distinctNames = [...new Set(items.map((entry) => entry.item.resource.name))]
    for (const name of distinctNames) await assertNameOwned(name, 'lookup')
    // On Qortal every item pays the chain's ARBITRARY unit fee. It is read
    // once here so the prompt can disclose each fee and the batch total, and
    // publishQortal refuses if the chain answers a different fee at signing.
    const feeAtomic = network === 'qortal' ? await getHomeV2QortalArbitraryUnitFee(node.nodeApiUrl) : 0n
    const coordinateOf = (entry: (typeof items)[number]) =>
      `${entry.item.resource.service}/${entry.item.resource.name}/${entry.item.resource.identifier ?? 'default'}`
    // DISPLAY form is component-escaped: an identifier may legitimately contain
    // '/', and raw concatenation would let WEBSITE/alice/b/c read as name
    // "alice/b" (publishing-extras review, 2026-08-27). The raw form above stays
    // the target-hash input, which must not change.
    const displayCoordinateOf = (entry: (typeof items)[number]) =>
      homeV2ResourceCoordinateText(entry.item.resource)
    const rows: { label: string; value: string }[] = [{ label: 'Items', value: String(items.length) }]
    items.forEach((entry, index) => {
      const position = index + 1
      rows.push({ label: `Resource ${position}`, value: displayCoordinateOf(entry) })
      rows.push({ label: `File ${position}`, value: homeV2PollApprovalText(entry.fileName, 'The file name') })
      rows.push({ label: `Size ${position}`, value: `${entry.artifact.byteLength} bytes` })
      rows.push({ label: `SHA-256 ${position}`, value: entry.contentHash })
      // The mutable-metadata values signed alongside the bytes (Qortium only —
      // the item normalizer refuses metadata on Qortal). A row appears exactly
      // when that field is being published; an omitted row means nothing is.
      const metadata = entry.item.resource
      if (metadata.title) rows.push({ label: `Title ${position}`, value: homeV2PollApprovalText(metadata.title, 'The resource title') })
      if (metadata.description) rows.push({ label: `Description ${position}`, value: homeV2PollApprovalText(metadata.description, 'The resource description') })
      if (metadata.category) rows.push({ label: `Category ${position}`, value: homeV2PollApprovalText(metadata.category, 'The resource category') })
      if (metadata.tags.length) rows.push({ label: `Tags ${position}`, value: homeV2PollApprovalText(metadata.tags.join(', '), 'The resource tags') })
      if (network === 'qortal') rows.push({ label: `Fee ${position}`, value: `${homeV2AtomicDecimal(feeAtomic)} coins` })
    })
    if (network === 'qortal') {
      rows.push({ label: 'Total fee', value: `${homeV2AtomicDecimal(feeAtomic * BigInt(items.length))} coins` })
    }
    const target = `publish-multiple:${await sha256Hex(new TextEncoder().encode(items.map(coordinateOf).join('\n')))}`
    await requireAccountReadPermission(sender, context, protocol, 'PUBLISH_MULTIPLE_QDN_RESOURCES', {
      kind: 'publish-multiple',
      operationLabel: homeV2PublishExtraOperationLabel('PUBLISH_MULTIPLE_QDN_RESOURCES'),
      publishMultipleDetails: rows,
      routeLabel: `${node.mode} \u00b7 ${node.nodeApiUrl}`,
      target,
      targetChainLabel: chainLabel,
    })
    const isStillValid = async () => {
      const fresh = getQdnViewContextForWebContents(sender)
      if (!fresh || !sameViewContext(context, fresh) || !liveResourceMatchesGrant(fresh) || !isAccountUnlocked(accountId)) return false
      const current = await getHomeV2ReadableNode(network).catch(() => null)
      return !!current && `${current.mode}|${current.nodeApiUrl}` === nodeRoute
    }
    if (!(await isStillValid())) throw new Error('The app, account, or node route changed before batch publishing.')
    for (const name of distinctNames) await assertNameOwned(name, 'recheck')
    if (!(await isStillValid())) throw new Error('The app, account, or node route changed after approval.')
    const published: unknown[] = []
    const failures: unknown[] = []
    for (const entry of items) {
      const resource = Object.freeze({
        identifier: entry.item.resource.identifier ?? null,
        name: entry.item.resource.name,
        service: entry.item.resource.service,
      })
      try {
        if (!(await isStillValid())) throw new Error('The app, account, or node route changed during batch publishing.')
        // Per ITEM, not once for the batch. The dispatcher's gate ran against the
        // batch request before any of this, so it cannot see a coordinate an
        // EARLIER ITEM of this same batch has just retained an unknown outcome
        // for — and nothing stops a batch listing one coordinate twice. (Ported
        // from the Android arm, publishing-extras review 2026-08-27.)
        const pendingItem = findStoredHomeV2PendingTransactionConflict(app.getPath('userData'), {
          accountId,
          action: 'PUBLISH_QDN_RESOURCE',
          appIdentity: homeV2AppIdentityKey(context),
          network,
          request: {
            ...(resource.identifier === null ? {} : { identifier: resource.identifier }),
            name: resource.name,
            service: resource.service,
          },
        })
        if (pendingItem) {
          throw new Error(
            `A previous publish of this resource has an unknown outcome. Reconcile signature ${pendingItem.signature} before publishing it again.`,
          )
        }
        const result = await publishHomeV2PublicResource({
          accountId,
          ...(network === 'qortal' ? { expectedFeeAtomic: feeAtomic } : {}),
          fileName: entry.fileName,
          isStillValid,
          isZip: entry.artifact.isZip,
          network,
          nodeApiUrl: node.nodeApiUrl,
          resource: entry.item.resource,
          // One item's bytes at a time, re-hashed against the value this
          // batch's prompt disclosed for it.
          sourceBytes: await entry.artifact.read(),
          validateTarget: () => assertNameOwned(entry.item.resource.name, 'signing recheck'),
        })
        if (result.accepted) {
          published.push(Object.freeze({ ...result, resource }))
          homeV2DesktopPublishSources.release(entry.item.sourceToken)
          continue
        }
        // Signed but the broadcast outcome is unknown: retain the ITEM in the
        // journal as the PUBLISH_QDN_RESOURCE transaction it is, keyed on its
        // own coordinate, and surface it as a failure carrying the signature.
        try {
          const journalEntry = createHomeV2PendingTransactionFromResult({
            accountId,
            action: 'PUBLISH_QDN_RESOURCE',
            appIdentity: homeV2AppIdentityKey(context),
            protocol,
            request: { identifier: resource.identifier ?? undefined, name: resource.name, service: resource.service },
            result,
          })
          if (journalEntry) recordHomeV2PendingTransaction(app.getPath('userData'), journalEntry)
        } catch (journalError) {
          console.warn('[home-v2-app] Unable to retain an ambiguous batch publish item:', journalError)
        }
        failures.push(Object.freeze({
          error: result.error ?? 'Publish broadcast outcome is unknown.',
          errorType: result.errorType,
          outcome: result.outcome,
          resource,
          transactionSignature: result.transactionSignature,
        }))
        homeV2DesktopPublishSources.release(entry.item.sourceToken)
      } catch (error) {
        failures.push(Object.freeze({
          error: error instanceof Error ? error.message : 'QDN publish failed.',
          resource,
        }))
      }
    }
    return Object.freeze({
      accepted: true,
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      failures: Object.freeze(failures),
      network,
      published: Object.freeze(published),
    })
  } finally {
    // Always, including the aggregate refusals above: every prepared artifact
    // owns either an open handle or a temp archive.
    for (const entry of items) await entry.artifact.dispose()
  }
}

async function deleteHomeV2QdnResourceForApp(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  routeRevision: string,
  requestValue: Record<string, unknown>,
) {
  if (network !== 'qortium') {
    throw createHomeV2BridgeError('DELETE_QDN_RESOURCE is available on the Qortium chain only.', {
      action: 'DELETE_QDN_RESOURCE',
      code: 'NODE_CAPABILITY_MISSING',
      network,
      retryable: false,
      routeRevision,
    })
  }
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  if (!isAccountUnlocked(context.accountId)) throw createHomeV2BridgeError('The selected account is locked.', {
    action: 'DELETE_QDN_RESOURCE',
    code: 'ACCOUNT_LOCKED',
    network,
    retryable: false,
    routeRevision,
  })
  const accountId = context.accountId
  const request = normalizeHomeV2QdnDeleteRequest(requestValue)
  const node = await getHomeV2ReadableNode(network)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  const assertNameOwned = async (label: string) => {
    const nameValue = await readHomeV2ChatJson(
      node.nodeApiUrl,
      `/names/${encodeURIComponent(request.name)}`,
      `Qortium publisher-name ${label}`,
    )
    if (stringField(nameValue, 'owner') !== profile.address) {
      throw new Error(`The selected account does not currently own the publisher name ${request.name}.`)
    }
  }
  await assertNameOwned('lookup')
  const coordinate = homeV2ResourceCoordinateText(request)
  await requireAccountReadPermission(sender, context, protocol, 'DELETE_QDN_RESOURCE', {
    kind: 'qdn-delete',
    operationLabel: homeV2PublishExtraOperationLabel('DELETE_QDN_RESOURCE'),
    resourceCoordinate: coordinate,
    routeLabel: `${node.mode} \u00b7 ${node.nodeApiUrl}`,
    targetChainLabel: 'Qortium',
  })
  const isStillValid = async () => {
    const fresh = getQdnViewContextForWebContents(sender)
    if (!fresh || !sameViewContext(context, fresh) || !liveResourceMatchesGrant(fresh) || !isAccountUnlocked(accountId)) return false
    const current = await getHomeV2ReadableNode(network).catch(() => null)
    return !!current && `${current.mode}|${current.nodeApiUrl}` === nodeRoute
  }
  if (!(await isStillValid())) throw new Error('The app, account, or node route changed before the deletion was staged.')
  await assertNameOwned('recheck')
  const outcome = await deleteHomeV2QortiumResource({
    accountId,
    isStillValid,
    nodeApiUrl: node.nodeApiUrl,
    resource: { name: request.name, identifier: request.identifier ?? undefined, service: request.service, tags: [] },
    validateTarget: () => assertNameOwned('signing recheck'),
  })
  const resource = Object.freeze({
    identifier: request.identifier,
    name: request.name,
    service: request.service,
  })
  if (outcome.accepted) {
    return Object.freeze({
      accepted: true,
      action: 'DELETE_QDN_RESOURCE',
      network,
      resource,
      transactionSignature: outcome.transactionSignature,
    })
  }
  // Broadcast outcome unknown: the dispatcher records the journal entry from
  // these fields (outcome/transactionSignature/timestamp) under the delete's
  // own resource-coordinate key.
  return Object.freeze({
    accepted: false,
    action: 'DELETE_QDN_RESOURCE',
    error: outcome.error,
    errorType: outcome.errorType,
    network,
    outcome: outcome.outcome,
    resource,
    retryable: false,
    timestamp: outcome.timestamp,
    transactionSignature: outcome.transactionSignature,
  })
}

function homeV2SignedRatingText(rating: number) {
  return rating > 0 ? `+${rating}` : `${rating}`
}

// Builds, verifies, mempows, re-verifies STAMPED bytes, signs, and
// broadcasts one locally-built rating transaction (types 45/46). The 1.x
// path sent the account's PRIVATE KEY to the node's /transactions/sign;
// here the key never leaves the process and the bytes a lying node could
// have influenced are refused by the independent field verifier.
async function signAndBroadcastHomeV2Rating(input: {
  readonly accountId: string
  readonly action: HomeV2RatingAction
  readonly isStillValid: () => Promise<boolean>
  readonly nodeApiUrl: string
  readonly payload: HomeV2RatingWirePayload
  readonly routeRevision: string
  readonly validateTarget: () => Promise<void>
}) {
  let difficulty: number
  try {
    difficulty = parseMempowFeeAlternativeDifficulty(await readHomeV2ChatJson(
      input.nodeApiUrl,
      '/polls/public/capabilities',
      'MemoryPoW capability lookup',
    ))
  } catch (error) {
    if (groupBuilderUnavailable(error)) {
      throw createHomeV2BridgeError(
        'The selected Qortium node does not expose the MemoryPoW capability needed for rating writes.',
        {
          action: input.action,
          code: 'NODE_CAPABILITY_MISSING',
          network: 'qortium',
          retryable: false,
          routeRevision: input.routeRevision,
        },
      )
    }
    throw error
  }
  const timestamp = Date.now()
  const signingKey = getAccountSecretKey(input.accountId)
  try {
    const unsignedBytes = buildUnsignedQortiumRatingTransactionBytes({
      payload: input.payload,
      senderPublicKey: signingKey.publicKey58,
      timestamp,
    })
    assertUnsignedHomeV2RatingTransaction(unsignedBytes, {
      payload: input.payload,
      senderPublicKey: signingKey.publicKey58,
      timestamp,
    })
    const nonce = await computeHomeV2ChatNonce(unsignedBytes, difficulty, input.isStillValid)
    if (!(await input.isStillValid())) throw new Error('The signing context changed before the rating could be submitted.')
    await input.validateTarget()
    if (!(await input.isStillValid())) throw new Error('The signing context changed before the rating could be submitted.')
    const stampedBytes = stampTransactionNonce(unsignedBytes, nonce)
    assertUnsignedHomeV2RatingTransaction(stampedBytes, {
      nonce,
      payload: input.payload,
      senderPublicKey: signingKey.publicKey58,
      timestamp,
    })
    const signedBytes = appendHomeV2GroupAdminSignature(
      stampedBytes,
      signDetached(stampedBytes, signingKey.secretKey),
    )
    const transactionSignature = getSignatureFromSignedTransactionBytes(signedBytes)
    try {
      await postHomeV2ChatText(
        input.nodeApiUrl,
        '/transactions/process?apiVersion=2',
        base58Encode(signedBytes),
        'text/plain',
        `${homeV2RatingOperationLabel(input.action, input.payload.rating === 0)} transaction processing failed.`,
      )
      return { accepted: true as const, timestamp, transactionSignature }
    } catch (error) {
      return {
        accepted: false as const,
        error: error instanceof Error ? error.message : 'Rating broadcast outcome is unknown.',
        errorType: 'BROADCAST_UNKNOWN' as const,
        outcome: 'unknown' as const,
        retryable: false as const,
        timestamp,
        transactionSignature,
      }
    }
  } finally {
    signingKey.secretKey.fill(0)
  }
}

async function handleHomeV2RatingAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  routeRevision: string,
  action: HomeV2RatingAction,
  requestValue: Record<string, unknown>,
) {
  if (protocol !== 'qdnRequest' || network !== 'qortium') {
    throw createHomeV2BridgeError('Rating writes are available on the Qortium chain only.', {
      action,
      code: 'NODE_CAPABILITY_MISSING',
      network,
      retryable: false,
      routeRevision,
    })
  }
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  if (!isAccountUnlocked(context.accountId)) throw createHomeV2BridgeError('The selected account is locked.', {
    action,
    code: 'ACCOUNT_LOCKED',
    network,
    retryable: false,
    routeRevision,
  })
  const accountId = context.accountId
  const node = await getHomeV2ReadableNode('qortium')
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const routeLabel = `${node.mode} \u00b7 ${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  const raterPublicKey58 = getAccountSigningPublicKey(accountId)
  const isStillValid = async () => {
    const fresh = getQdnViewContextForWebContents(sender)
    if (!fresh || !sameViewContext(context, fresh) || !liveResourceMatchesGrant(fresh) || !isAccountUnlocked(accountId)) return false
    const current = await getHomeV2ReadableNode('qortium').catch(() => null)
    return !!current && `${current.mode}|${current.nodeApiUrl}` === nodeRoute
  }
  if (action === 'RATE_ACCOUNT') {
    const request = normalizeHomeV2RateAccountRequest(requestValue)
    // WHO is being rated: the address is derived LOCALLY from the exact
    // 32-byte key that will be signed — an app label or a lying node can
    // never substitute a different identity on the prompt.
    const targetAddress = publicKeyToAddress(base58Decode(request.targetPublicKey))
    if (targetAddress === profile.address) throw new Error('An account cannot rate itself.')
    const readEdge = async (label: string) => selectHomeV2AccountRatingEdge(await readHomeV2ChatJson(
      node.nodeApiUrl,
      `/account-ratings/cooldown?target=${encodeURIComponent(request.targetPublicKey)}` +
        `&rater=${encodeURIComponent(raterPublicKey58)}&category=${encodeURIComponent(request.category)}`,
      `Qortium account-rating ${label}`,
    ))
    // One read answers three questions: the target account exists with this
    // stored key (Core refuses an unknown key), the rater's ACTIVE rating on
    // this exact edge, and whether the cooldown allows a change now.
    const edge = await readEdge('lookup')
    const remove = request.rating === 0
    if ((remove && edge.activeRating === null) || (!remove && request.rating === edge.activeRating)) {
      return Object.freeze({
        accepted: true,
        action,
        category: request.category,
        changed: false,
        network,
        rating: request.rating,
        targetPublicKey: request.targetPublicKey,
      })
    }
    if (!edge.canChangeNow) {
      throw createHomeV2BridgeError(
        `This account rating is in its category cooldown for another ${edge.blocksRemaining} blocks.`,
        { action, code: 'RATING_COOLDOWN', network, retryable: false, routeRevision },
      )
    }
    await requireAccountReadPermission(sender, context, protocol, action, {
      kind: 'rating',
      operationLabel: homeV2RatingOperationLabel(action, remove),
      ratingDetails: [
        { label: 'Rated account', value: targetAddress },
        { label: 'Public key', value: request.targetPublicKey },
        { label: 'Category', value: request.category },
        ...(edge.activeRating !== null
          ? [{ label: 'Current', value: homeV2SignedRatingText(edge.activeRating) }]
          : []),
        { label: 'Change', value: remove ? 'Remove rating' : homeV2SignedRatingText(request.rating) },
      ],
      routeLabel,
      target: `account-rating:${request.targetPublicKey}:${request.category}`,
      targetChainLabel: 'Qortium',
    })
    if (!(await isStillValid())) throw new Error('The app, account, or node route changed before the rating was staged.')
    const outcome = await signAndBroadcastHomeV2Rating({
      accountId,
      action,
      isStillValid,
      nodeApiUrl: node.nodeApiUrl,
      payload: request,
      routeRevision,
      validateTarget: async () => {
        const fresh = await readEdge('recheck')
        if (fresh.activeRating !== edge.activeRating || !fresh.canChangeNow) {
          throw new Error('The account rating state changed after approval.')
        }
      },
    })
    return Object.freeze({
      accepted: outcome.accepted,
      action,
      category: request.category,
      network,
      rating: request.rating,
      targetPublicKey: request.targetPublicKey,
      transactionSignature: outcome.transactionSignature,
      ...(outcome.accepted ? {} : {
        error: outcome.error,
        errorType: outcome.errorType,
        outcome: outcome.outcome,
        retryable: outcome.retryable,
        timestamp: outcome.timestamp,
      }),
    })
  }
  const request = normalizeHomeV2RateResourceRequest(requestValue)
  const serviceId = getStaticQdnServiceId(request.service)
  const coordinateLabel = `${request.service}/${request.name}/${request.identifier ?? 'default'}`
  const readCurrentRating = async (label: string) => {
    try {
      return selectHomeV2CurrentResourceRating(await readHomeV2ChatJson(
        node.nodeApiUrl,
        `/resource-ratings/rating?service=${encodeURIComponent(request.service)}` +
          `&name=${encodeURIComponent(request.name)}` +
          (request.identifier ? `&identifier=${encodeURIComponent(request.identifier)}` : '') +
          `&rater=${encodeURIComponent(profile.address)}`,
        `Qortium resource-rating ${label}`,
      ))
    } catch (error) {
      // 404 (PUBLIC_KEY_NOT_FOUND) is Core's "exists but this rater has no
      // rating"; 400 (INVALID_CRITERIA) means the coordinate itself is not a
      // rateable existing resource.
      if ((error as { status?: unknown })?.status === 404) return null
      if ((error as { status?: unknown })?.status === 400) {
        throw new Error(`There is no rateable published QDN resource at ${coordinateLabel}.`)
      }
      throw error
    }
  }
  // The resource must exist before anything is promptable. The summary read
  // is the correct probe: it is on the public rating-read surface (no API
  // key), its requireExistingTarget answers HTTP 400 INVALID_CRITERIA for a
  // missing, non-rateable, or non-normalized coordinate — Core's own
  // Unicode-normalization rule, authoritative over Home's local subset
  // check — and an existing-but-unrated resource answers an empty summary.
  // A DELETED coordinate is deliberately not refused here: Core's own
  // resolveTarget accepts the latest transaction regardless of method, so
  // rating one is Core-valid — Home mirrors Core rather than inventing a
  // stricter rule the chain does not have.
  const assertResourceExists = async (label: string) => {
    try {
      await readHomeV2ChatJson(
        node.nodeApiUrl,
        `/resource-ratings/summary?service=${encodeURIComponent(request.service)}` +
          `&name=${encodeURIComponent(request.name)}` +
          (request.identifier ? `&identifier=${encodeURIComponent(request.identifier)}` : ''),
        `Qortium resource ${label}`,
      )
    } catch (error) {
      if ((error as { status?: unknown })?.status === 400) {
        throw new Error(`There is no rateable published QDN resource at ${coordinateLabel}.`)
      }
      throw error
    }
  }
  await assertResourceExists('lookup')
  const current = await readCurrentRating('lookup')
  const remove = request.rating === 0
  if ((remove && current === null) || (!remove && request.rating === current)) {
    return Object.freeze({
      accepted: true,
      action,
      changed: false,
      identifier: request.identifier,
      name: request.name,
      network,
      rating: request.rating,
      service: request.service,
    })
  }
  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'rating',
    operationLabel: homeV2RatingOperationLabel(action, remove),
    ratingDetails: [
      { label: 'Resource', value: coordinateLabel },
      // The exact numeric id that will be SIGNED, from Home's static map —
      // shown so a stale map that drifted from the visible service name has
      // nowhere to hide (audit Part D, service-ID drift).
      { label: 'Service ID', value: String(serviceId) },
      ...(current !== null ? [{ label: 'Current', value: `${current}/10` }] : []),
      { label: 'Change', value: remove ? 'Remove rating' : `${request.rating}/10` },
    ],
    routeLabel,
    target: `resource-rating:${coordinateLabel}`,
    targetChainLabel: 'Qortium',
  })
  if (!(await isStillValid())) throw new Error('The app, account, or node route changed before the rating was staged.')
  const outcome = await signAndBroadcastHomeV2Rating({
    accountId,
    action,
    isStillValid,
    nodeApiUrl: node.nodeApiUrl,
    payload: { ...request, serviceId },
    routeRevision,
    validateTarget: async () => {
      await assertResourceExists('recheck')
      if ((await readCurrentRating('recheck')) !== current) {
        throw new Error('The resource rating state changed after approval.')
      }
    },
  })
  return Object.freeze({
    accepted: outcome.accepted,
    action,
    identifier: request.identifier,
    name: request.name,
    network,
    rating: request.rating,
    service: request.service,
    transactionSignature: outcome.transactionSignature,
    ...(outcome.accepted ? {} : {
      error: outcome.error,
      errorType: outcome.errorType,
      outcome: outcome.outcome,
      retryable: outcome.retryable,
      timestamp: outcome.timestamp,
    }),
  })
}

async function handleHomeV2SetAccountAvatarAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  routeRevision: string,
  requestValue: Record<string, unknown>,
) {
  const action = 'SET_ACCOUNT_AVATAR'
  if (protocol !== 'qdnRequest' || network !== 'qortium') {
    throw createHomeV2BridgeError('SET_ACCOUNT_AVATAR is available on the Qortium chain only.', {
      action,
      code: 'NODE_CAPABILITY_MISSING',
      network,
      retryable: false,
      routeRevision,
    })
  }
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  if (!isAccountUnlocked(context.accountId)) throw createHomeV2BridgeError('The selected account is locked.', {
    action,
    code: 'ACCOUNT_LOCKED',
    network,
    retryable: false,
    routeRevision,
  })
  const accountId = context.accountId
  const request = normalizeHomeV2SetAccountAvatarRequest(requestValue)
  const node = await getHomeV2ReadableNode('qortium')
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  const readCurrentPointer = async (label: string) => {
    try {
      return selectHomeV2AccountAvatarPointer(await readHomeV2ChatJson(
        node.nodeApiUrl,
        `/addresses/${encodeURIComponent(profile.address)}/avatar/info`,
        `Qortium account-avatar ${label}`,
      ))
    } catch (error) {
      if ((error as { status?: unknown })?.status === 404) return null
      throw error
    }
  }
  const current = await readCurrentPointer('lookup')
  const samePointer = current !== null && request.avatar !== null &&
    current.service === request.avatar.service &&
    current.name === request.avatar.name &&
    current.identifier === request.avatar.identifier
  if ((request.avatar === null && current === null) || samePointer) {
    return Object.freeze({
      accepted: true,
      action,
      address: profile.address,
      avatar: request.avatar
        ? { identifier: request.avatar.identifier || null, name: request.avatar.name, service: request.avatar.service }
        : null,
      changed: false,
      network,
    })
  }
  const remove = request.avatar === null
  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'account-avatar',
    avatarValue: request.avatar ? homeV2AvatarPointerText(request.avatar) : 'Remove the current avatar',
    currentValue: current ? homeV2AvatarPointerText(current) : null,
    operationLabel: homeV2AccountAvatarOperationLabel(remove),
    routeLabel: `${node.mode} \u00b7 ${node.nodeApiUrl}`,
    targetChainLabel: 'Qortium',
  })
  const isStillValid = async () => {
    const fresh = getQdnViewContextForWebContents(sender)
    if (!fresh || !sameViewContext(context, fresh) || !liveResourceMatchesGrant(fresh) || !isAccountUnlocked(accountId)) return false
    const nodeNow = await getHomeV2ReadableNode('qortium').catch(() => null)
    return !!nodeNow && `${nodeNow.mode}|${nodeNow.nodeApiUrl}` === nodeRoute
  }
  if (!(await isStillValid())) throw new Error('The app, account, or node route changed before the avatar was staged.')
  let difficulty: number
  try {
    difficulty = parseMempowFeeAlternativeDifficulty(await readHomeV2ChatJson(
      node.nodeApiUrl,
      '/polls/public/capabilities',
      'MemoryPoW capability lookup',
    ))
  } catch (error) {
    if (groupBuilderUnavailable(error)) {
      throw createHomeV2BridgeError(
        'The selected Qortium node does not expose the MemoryPoW capability needed for avatar writes.',
        { action, code: 'NODE_CAPABILITY_MISSING', network, retryable: false, routeRevision },
      )
    }
    throw error
  }
  const timestamp = Date.now()
  const signingKey = getAccountSecretKey(accountId)
  try {
    const unsignedBytes = buildUnsignedQortiumSetAccountAvatarTransactionBytes({
      avatar: request.avatar,
      senderPublicKey: signingKey.publicKey58,
      timestamp,
    })
    assertUnsignedHomeV2SetAccountAvatarTransaction(unsignedBytes, {
      avatar: request.avatar,
      senderPublicKey: signingKey.publicKey58,
      timestamp,
    })
    const nonce = await computeHomeV2ChatNonce(unsignedBytes, difficulty, isStillValid)
    if (!(await isStillValid())) throw new Error('The signing context changed before the avatar could be submitted.')
    // Re-read the live pointer: the change the user approved was RELATIVE to
    // the disclosed current value, so a pointer that moved underneath the
    // approval refuses rather than silently replacing something else.
    const fresh = await readCurrentPointer('recheck')
    const freshSame = fresh === null ? current === null : current !== null &&
      fresh.service === current.service && fresh.name === current.name && fresh.identifier === current.identifier
    if (!freshSame) throw new Error('The account avatar changed after approval.')
    if (!(await isStillValid())) throw new Error('The signing context changed before the avatar could be submitted.')
    const stampedBytes = stampTransactionNonce(unsignedBytes, nonce)
    assertUnsignedHomeV2SetAccountAvatarTransaction(stampedBytes, {
      avatar: request.avatar,
      nonce,
      senderPublicKey: signingKey.publicKey58,
      timestamp,
    })
    const signedBytes = appendHomeV2GroupAdminSignature(
      stampedBytes,
      signDetached(stampedBytes, signingKey.secretKey),
    )
    const transactionSignature = getSignatureFromSignedTransactionBytes(signedBytes)
    const avatarResult = request.avatar
      ? { identifier: request.avatar.identifier || null, name: request.avatar.name, service: request.avatar.service }
      : null
    try {
      await postHomeV2ChatText(
        node.nodeApiUrl,
        '/transactions/process?apiVersion=2',
        base58Encode(signedBytes),
        'text/plain',
        `${homeV2AccountAvatarOperationLabel(remove)} transaction processing failed.`,
      )
      return Object.freeze({
        accepted: true,
        action,
        address: profile.address,
        avatar: avatarResult,
        network,
        transactionSignature,
      })
    } catch (error) {
      return Object.freeze({
        accepted: false,
        action,
        address: profile.address,
        avatar: avatarResult,
        error: error instanceof Error ? error.message : 'Avatar broadcast outcome is unknown.',
        errorType: 'BROADCAST_UNKNOWN' as const,
        network,
        outcome: 'unknown' as const,
        retryable: false as const,
        timestamp,
        transactionSignature,
      })
    }
  } finally {
    signingKey.secretKey.fill(0)
  }
}

// One in-flight payment per account+chain: two approvals must never
// interleave into a double spend. UI state is not a security boundary; this
// process-level lock plus the journal is.
const homeV2PaymentSendLocks = new Set<string>()
// FAIL-CLOSED journal guard: if a signed payment's unknown outcome could not
// be persisted, further payment actions for that account refuse until Home
// restarts or the user reconciles — a spend must never be retried on the
// strength of a journal entry that was silently dropped.
const homeV2PaymentJournalFailures = new Set<string>()

export function recordHomeV2PaymentJournalFailure(accountId: string) {
  homeV2PaymentJournalFailures.add(accountId)
}

async function handleHomeV2PaymentAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  routeRevision: string,
  action: HomeV2PaymentAction,
  requestValue: Record<string, unknown>,
) {
  const validChain = action === 'SEND_QORT'
    ? protocol === 'qortalRequest' && network === 'qortal'
    : action === 'TRANSFER_ASSET'
      ? (protocol === 'qortalRequest' && network === 'qortal') || (protocol === 'qdnRequest' && network === 'qortium')
      : protocol === 'qdnRequest' && network === 'qortium'
  if (!validChain) {
    throw createHomeV2BridgeError(
      action === 'SEND_QORT'
        ? 'SEND_QORT is a Qortal action; call it on qortalRequest.'
        : action === 'TRANSFER_ASSET'
          ? 'TRANSFER_ASSET must use qortalRequest for Qortal assets or qdnRequest for Qortium assets.'
        : `${action} is available on the Qortium chain only.`,
      { action, code: 'NODE_CAPABILITY_MISSING', network, retryable: false, routeRevision },
    )
  }
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  if (!isAccountUnlocked(context.accountId)) throw createHomeV2BridgeError('The selected account is locked.', {
    action,
    code: 'ACCOUNT_LOCKED',
    network,
    retryable: false,
    routeRevision,
  })
  const accountId = context.accountId
  // The foreign arm splits off BEFORE the native normalizer, the native
  // in-flight lock and the native journal gate. `handleHomeV2PaymentAction`
  // keeps its blanket foreign refusal below as the fail-closed backstop for
  // anything this predicate does not claim.
  if (action === 'SEND_COIN' && isHomeV2ForeignSendRequest(action, requestValue)) {
    return handleHomeV2ForeignSendAction(sender, context, protocol, network, routeRevision, requestValue)
  }
  if (homeV2PaymentJournalFailures.has(accountId)) {
    throw createHomeV2BridgeError(
      'A previously signed payment could not be recorded for reconciliation. Payment actions are blocked for this account until it is reconciled.',
      { action, code: 'PAYMENT_JOURNAL_UNAVAILABLE', network, retryable: false, routeRevision },
    )
  }
  let request: ReturnType<typeof normalizeHomeV2NativeSendRequest> | ReturnType<typeof normalizeHomeV2TransferAssetRequest> | ReturnType<typeof normalizeHomeV2SendQortRequest>
  try {
    request = action === 'TRANSFER_ASSET'
      ? normalizeHomeV2TransferAssetRequest(requestValue)
      : action === 'SEND_QORT'
        ? normalizeHomeV2SendQortRequest(requestValue)
        : normalizeHomeV2NativeSendRequest(action, requestValue)
  } catch (error) {
    if (error instanceof HomeV2ForeignSendError) {
      throw createHomeV2BridgeError(error.message, {
        action,
        code: 'FOREIGN_SEND_UNAVAILABLE',
        network,
        retryable: false,
        routeRevision,
      })
    }
    throw error
  }
  const lockKey = `${accountId}|${network}`
  if (homeV2PaymentSendLocks.has(lockKey)) {
    throw createHomeV2BridgeError('Another payment for this account is already in progress.', {
      action,
      code: 'PAYMENT_IN_PROGRESS',
      network,
      retryable: true,
      routeRevision,
    })
  }
  homeV2PaymentSendLocks.add(lockKey)
  try {
    const node = await getHomeV2ReadableNode(network)
    const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
    const routeLabel = `${node.mode} \u00b7 ${node.nodeApiUrl}`
    const chainLabel = network === 'qortal' ? 'Qortal' : 'Qortium'
    const profile = await getAccountProfile(accountId)
    const isStillValid = async () => {
      const fresh = getQdnViewContextForWebContents(sender)
      if (!fresh || !sameViewContext(context, fresh) || !liveResourceMatchesGrant(fresh) || !isAccountUnlocked(accountId)) return false
      const current = await getHomeV2ReadableNode(network).catch(() => null)
      return !!current && `${current.mode}|${current.nodeApiUrl}` === nodeRoute
    }
    // The fee is quoted for the EXACT timestamp the transaction will carry
    // (chosen up front and reused at signing): Core's unitfee endpoint
    // defaults an omitted timestamp to its own clock, and consensus applies
    // the fee schedule effective for the transaction's timestamp — quoting
    // one moment and signing another could straddle a fee boundary.
    const paymentTimestamp = Date.now()
    // An approval that sat open too long must not sign a stale timestamp:
    // Core expires ordinary transactions 24h after their timestamp, and a
    // long-delayed signing would produce a doomed transaction journaled as
    // an unknown outcome. Ten minutes is far inside every real flow (the
    // prompt itself times out in one) and far outside any legitimate delay.
    const assertPaymentFresh = () => {
      if (Date.now() - paymentTimestamp > 10 * 60_000) {
        throw new Error('This payment approval took too long and was not signed; please start it again.')
      }
    }
    const readUnitFee = async (txType: string) => parseHomeV2UnitFee(await readHomeV2ChatJson(
      node.nodeApiUrl,
      `/transactions/unitfee?txType=${txType}&timestamp=${paymentTimestamp}`,
      `${chainLabel} fee lookup`,
    ))
    const readAtomicBalance = async (address: string, assetId?: number) => selectHomeV2AtomicBalance(await readHomeV2ChatJson(
      node.nodeApiUrl,
      `/addresses/balance/${encodeURIComponent(address)}${assetId !== undefined && assetId !== 0 ? `?assetId=${assetId}` : ''}`,
      `${chainLabel} balance lookup`,
    ))
    if (network === 'qortal') {
      const isTransfer = action === 'TRANSFER_ASSET'
      const transferRequest = isTransfer ? request as ReturnType<typeof normalizeHomeV2TransferAssetRequest> : null
      const sendRequest = isTransfer ? null : request as ReturnType<typeof normalizeHomeV2SendQortRequest>
      const resolveRecipient = async (label: string): Promise<HomeV2PaymentRecipient> => {
        if (transferRequest) return transferRequest.recipient
        if (sendRequest!.recipientAddress) {
          const { normalizeHomeV2PaymentRecipient } = await import('./home-v2-payment-actions.js')
          return normalizeHomeV2PaymentRecipient(sendRequest!.recipientAddress, 'The recipient address')
        }
        const nameValue = await readHomeV2ChatJson(
          node.nodeApiUrl,
          `/names/${encodeURIComponent(sendRequest!.recipientName ?? '')}`,
          `Qortal recipient-name ${label}`,
        )
        const owner = stringField(nameValue, 'owner')
        if (!owner) throw new Error(`The Qortal name ${sendRequest!.recipientName} does not resolve to an owner address.`)
        const { normalizeHomeV2PaymentRecipient } = await import('./home-v2-payment-actions.js')
        return normalizeHomeV2PaymentRecipient(owner, 'The resolved recipient address')
      }
      const recipient = await resolveRecipient('lookup')
      const amount = (transferRequest ?? sendRequest)!.amount
      const assetId = transferRequest?.assetId ?? 0
      const readAssetInfo = async (label: string) => selectHomeV2AssetInfo(await readHomeV2ChatJson(
        node.nodeApiUrl,
        `/assets/info?assetId=${assetId}`,
        `Qortal asset ${label}`,
      ), assetId)
      let assetInfo: ReturnType<typeof selectHomeV2AssetInfo> | null = null
      if (transferRequest) {
        assetInfo = await readAssetInfo('lookup')
        if (!assetInfo.isDivisible && amount.atomic % 100_000_000n !== 0n) {
          throw new Error(`The ${assetInfo.name} asset is indivisible: the amount must be a whole number of units.`)
        }
        if (assetInfo.isUnspendable && assetInfo.owner !== profile.address) {
          throw new Error(`Only the owner of the unspendable ${assetInfo.name} asset can transfer it.`)
        }
      }
      const checkAtRecipient = async (label: string) => {
        if (!transferRequest || !recipient.isAt) return
        assertHomeV2QortalAtAcceptsAsset(await readHomeV2ChatJson(
          node.nodeApiUrl,
          `/at/${encodeURIComponent(recipient.address)}`,
          `Qortal recipient AT ${label}`,
        ), assetId)
      }
      await checkAtRecipient('lookup')
      const unitFee = await readUnitFee(isTransfer ? 'TRANSFER_ASSET' : 'PAYMENT')
      // Qortal signed lengths: PAYMENT 217, TRANSFER_ASSET 225.
      const feeAtomic = homeV2FeeForLength(unitFee, isTransfer ? 225 : 217)
      const nativeDebit = isTransfer ? feeAtomic : homeV2CheckedTotalDebit(amount.atomic, feeAtomic)
      const checkBalances = async () => {
        const nativeBalance = await readAtomicBalance(profile.address)
        if (nativeBalance < nativeDebit) {
          throw createHomeV2BridgeError(
            `Insufficient QORT balance: this ${isTransfer ? 'transfer needs the fee of' : 'send needs'} ${formatQortAtomic(nativeDebit)} QORT, but the node reports ${formatQortAtomic(nativeBalance)} QORT.`,
            { action, code: 'INSUFFICIENT_BALANCE', network, retryable: false, routeRevision },
          )
        }
        if (transferRequest && (await readAtomicBalance(profile.address, assetId)) < amount.atomic) {
          throw createHomeV2BridgeError(
            `Insufficient asset balance: the transfer needs ${amount.decimal}, but the node reports less.`,
            { action, code: 'INSUFFICIENT_BALANCE', network, retryable: false, routeRevision },
          )
        }
      }
      const readLastReference = async (label: string) => {
        const value = await readHomeV2ChatJson(
          node.nodeApiUrl,
          `/addresses/lastreference/${encodeURIComponent(profile.address)}`,
          `Qortal last-reference ${label}`,
        )
        const reference = typeof value === 'string' ? value.trim() : ''
        if (!reference) throw new Error('The selected Qortal account has no last reference; it may need QORT first.')
        try {
          const bytes = base58Decode(reference)
          if (bytes.byteLength !== 64 || base58Encode(bytes) !== reference) throw new Error()
        } catch {
          throw new Error('The Qortal node returned an invalid last reference.')
        }
        return reference
      }
      await checkBalances()
      const lastReference = await readLastReference('lookup')
      await requireAccountReadPermission(sender, context, protocol, action, {
        kind: 'payment',
        operationLabel: homeV2PaymentOperationLabel(action),
        paymentDetails: [
          ...(assetInfo
            ? [
                { label: 'Asset', value: homeV2PollApprovalText(assetInfo.name, 'The asset name') },
                { label: 'Asset ID', value: String(assetId) },
                { label: 'You send', value: homeV2AtomicUnitsText(amount) },
              ]
            : [{ label: 'You pay', value: homeV2AtomicUnitsText({ atomic: amount.atomic, decimal: `${amount.decimal} QORT` }) }]),
          { label: 'Paid to', value: recipient.address },
          ...(sendRequest?.recipientName
            ? [{ label: 'Resolved from name', value: homeV2PollApprovalText(sendRequest.recipientName, 'The recipient name') }]
            : []),
          ...(recipient.isAt ? [{ label: 'Destination type', value: 'AT contract address (an automated contract, not a person)' }] : []),
          ...(recipient.address === profile.address ? [{ label: 'Self-payment', value: 'The recipient IS the selected account' }] : []),
          { label: 'Fee', value: `${formatQortAtomic(feeAtomic)} QORT` },
          { label: isTransfer ? 'Total native debit' : 'Total debit', value: `${formatQortAtomic(nativeDebit)} QORT` },
        ],
        routeLabel,
        target: `payment:qortal:${recipient.address}:${assetId}:${amount.atomic}`,
        targetChainLabel: 'Qortal',
      })
      if (!(await isStillValid())) throw new Error('The app, account, or node route changed before the payment was staged.')
      // Re-resolve everything the prompt disclosed; refuse any drift.
      const freshRecipient = await resolveRecipient('recheck')
      if (freshRecipient.address !== recipient.address) throw new Error('The recipient resolution changed after approval.')
      if ((await readUnitFee(isTransfer ? 'TRANSFER_ASSET' : 'PAYMENT')) !== unitFee) throw new Error('The Qortal fee changed after it was approved.')
      if (transferRequest) {
        const freshAsset = await readAssetInfo('recheck')
        if (freshAsset.name !== assetInfo!.name || freshAsset.owner !== assetInfo!.owner ||
          freshAsset.isDivisible !== assetInfo!.isDivisible || freshAsset.isUnspendable !== assetInfo!.isUnspendable) {
          throw new Error('The asset description changed after approval.')
        }
      }
      await checkAtRecipient('recheck')
      await checkBalances()
      if ((await readLastReference('recheck')) !== lastReference) throw new Error('The Qortal last reference changed after approval.')
      assertPaymentFresh()
      const timestamp = paymentTimestamp
      const signingKey = getAccountSecretKey(accountId)
      try {
        const unsignedBytes = transferRequest
          ? buildUnsignedQortalTransferAssetTransactionBytes({
              amountAtomic: amount.atomic,
              assetId,
              feeAtomic,
              lastReference,
              recipientBytes: recipient.bytes,
              senderPublicKey: signingKey.publicKey58,
              timestamp,
            })
          : buildUnsignedPaymentTransactionBytes({
              amountAtomic: amount.atomic,
              feeAtomic,
              lastReference,
              recipient: recipient.address,
              senderPublicKey: signingKey.publicKey58,
              timestamp,
            })
        if (transferRequest) {
          assertUnsignedHomeV2QortalTransferAssetTransaction(unsignedBytes, {
            amountAtomic: amount.atomic,
            assetId,
            feeAtomic,
            lastReference,
            recipientBytes: recipient.bytes,
            senderPublicKey: signingKey.publicKey58,
            timestamp,
          })
        } else {
          assertUnsignedHomeV2QortalPaymentTransaction(unsignedBytes, {
            amountAtomic: amount.atomic,
            feeAtomic,
            lastReference,
            recipientBytes: recipient.bytes,
            senderPublicKey: signingKey.publicKey58,
            timestamp,
          })
        }
        if (!(await isStillValid())) throw new Error('The signing context changed before the payment could be submitted.')
        // The awaited check above can itself take time: re-assert freshness
        // as the LAST act before the signature exists (review round 3).
        assertPaymentFresh()
        const signedBytes = appendSignatureToTransactionBytes(unsignedBytes, signDetached(unsignedBytes, signingKey.secretKey))
        const transactionSignature = getSignatureFromSignedTransactionBytes(signedBytes)
        return await broadcastHomeV2Payment({
          action,
          amount,
          assetId,
          assetName: assetInfo?.name,
          network,
          nodeApiUrl: node.nodeApiUrl,
          recipient,
          recipientName: sendRequest?.recipientName ?? null,
          signedBytes,
          timestamp,
          transactionSignature,
        })
      } finally {
        signingKey.secretKey.fill(0)
      }
    }
    // --- Qortium arms (PAYMENT / native SEND_COIN / TRANSFER_ASSET) ---
    const isTransfer = action === 'TRANSFER_ASSET'
    const transferRequest = isTransfer ? request as ReturnType<typeof normalizeHomeV2TransferAssetRequest> : null
    const nativeRequest = isTransfer ? null : request as ReturnType<typeof normalizeHomeV2NativeSendRequest>
    const recipient = (transferRequest ?? nativeRequest)!.recipient
    const amount = (transferRequest ?? nativeRequest)!.amount
    const assetId = transferRequest ? transferRequest.assetId : 0
    const readAssetInfo = async (label: string) => selectHomeV2AssetInfo(await readHomeV2ChatJson(
      node.nodeApiUrl,
      `/assets/info?assetId=${assetId}`,
      `Qortium asset ${label}`,
    ), assetId)
    let assetInfo: ReturnType<typeof selectHomeV2AssetInfo> | null = null
    if (transferRequest) {
      assetInfo = await readAssetInfo('lookup')
      if (!assetInfo.isDivisible && amount.atomic % 100_000_000n !== 0n) {
        throw new Error(`The ${assetInfo.name} asset is indivisible: the amount must be a whole number of units.`)
      }
      if (assetInfo.isUnspendable && assetInfo.owner !== profile.address) {
        throw new Error(`Only the owner of the unspendable ${assetInfo.name} asset can transfer it.`)
      }
      if (assetInfo.isUnspendable && recipient.isAt) {
        throw new Error(`The ${assetInfo.name} asset is unspendable and cannot be sent to an AT contract.`)
      }
    }
    const unitFee = await readUnitFee(isTransfer ? 'TRANSFER_ASSET' : 'PAYMENT')
    // Qortium signed lengths: PAYMENT 153, TRANSFER_ASSET 161.
    const feeAtomic = homeV2FeeForLength(unitFee, isTransfer ? 161 : 153)
    const nativeDebit = isTransfer ? feeAtomic : homeV2CheckedTotalDebit(amount.atomic, feeAtomic)
    const checkBalances = async () => {
      const nativeBalance = await readAtomicBalance(profile.address)
      if (nativeBalance < nativeDebit) {
        throw createHomeV2BridgeError(
          `Insufficient native balance: this ${isTransfer ? 'transfer needs the fee of' : 'payment needs'} ${formatQortAtomic(nativeDebit)}, but the node reports ${formatQortAtomic(nativeBalance)}.`,
          { action, code: 'INSUFFICIENT_BALANCE', network, retryable: false, routeRevision },
        )
      }
      if (transferRequest && assetId !== 0) {
        const assetBalance = await readAtomicBalance(profile.address, assetId)
        if (assetBalance < amount.atomic) {
          throw createHomeV2BridgeError(
            `Insufficient asset balance: the transfer needs ${amount.decimal}, but the node reports ${formatQortAtomic(assetBalance)}.`,
            { action, code: 'INSUFFICIENT_BALANCE', network, retryable: false, routeRevision },
          )
        }
      }
    }
    await checkBalances()
    const coinLabel = 'native coin'
    await requireAccountReadPermission(sender, context, protocol, action, {
      kind: 'payment',
      operationLabel: homeV2PaymentOperationLabel(action),
      paymentDetails: [
        ...(assetInfo
          ? [
              { label: 'Asset', value: homeV2PollApprovalText(assetInfo.name, 'The asset name') },
              { label: 'Asset ID', value: String(assetId) },
              { label: 'You send', value: homeV2AtomicUnitsText(amount) },
            ]
          : [
              { label: 'You pay', value: homeV2AtomicUnitsText({ atomic: amount.atomic, decimal: `${amount.decimal} ${coinLabel}` }) },
            ]),
        { label: 'Paid to', value: recipient.address },
        ...(recipient.isAt ? [{ label: 'Destination type', value: 'AT contract address (an automated contract, not a person)' }] : []),
        ...(recipient.address === profile.address ? [{ label: 'Self-payment', value: 'The recipient IS the selected account' }] : []),
        { label: 'Fee', value: `${formatQortAtomic(feeAtomic)} ${coinLabel}` },
        { label: 'Total native debit', value: `${formatQortAtomic(nativeDebit)} ${coinLabel}` },
      ],
      routeLabel,
      target: `payment:qortium:${recipient.address}:${assetId}:${amount.atomic}`,
      targetChainLabel: 'Qortium',
    })
    if (!(await isStillValid())) throw new Error('The app, account, or node route changed before the payment was staged.')
    if ((await readUnitFee(isTransfer ? 'TRANSFER_ASSET' : 'PAYMENT')) !== unitFee) {
      throw new Error('The chain fee changed after it was approved.')
    }
    if (transferRequest) {
      const freshAsset = await readAssetInfo('recheck')
      if (freshAsset.name !== assetInfo!.name || freshAsset.owner !== assetInfo!.owner || freshAsset.isDivisible !== assetInfo!.isDivisible ||
        freshAsset.isUnspendable !== assetInfo!.isUnspendable) {
        throw new Error('The asset description changed after approval.')
      }
    }
    await checkBalances()
    assertPaymentFresh()
    const timestamp = paymentTimestamp
    const signingKey = getAccountSecretKey(accountId)
    try {
      const unsignedBytes = transferRequest
        ? buildUnsignedQortiumTransferAssetTransactionBytes({
            amountAtomic: amount.atomic,
            assetId,
            feeAtomic,
            recipientBytes: recipient.bytes,
            senderPublicKey: signingKey.publicKey58,
            timestamp,
          })
        : buildUnsignedQortiumPaymentTransactionBytes({
            amountAtomic: amount.atomic,
            feeAtomic,
            recipientBytes: recipient.bytes,
            senderPublicKey: signingKey.publicKey58,
            timestamp,
          })
      if (transferRequest) {
        assertUnsignedHomeV2QortiumTransferAssetTransaction(unsignedBytes, {
          amountAtomic: amount.atomic,
          assetId,
          feeAtomic,
          recipientBytes: recipient.bytes,
          senderPublicKey: signingKey.publicKey58,
          timestamp,
        })
      } else {
        assertUnsignedHomeV2QortiumPaymentTransaction(unsignedBytes, {
          amountAtomic: amount.atomic,
          feeAtomic,
          recipientBytes: recipient.bytes,
          senderPublicKey: signingKey.publicKey58,
          timestamp,
        })
      }
      if (!(await isStillValid())) throw new Error('The signing context changed before the payment could be submitted.')
      // Same rule as the Qortal arm: freshness is the LAST act before the
      // signature exists (review round 3).
      assertPaymentFresh()
      const signedBytes = appendSignatureToTransactionBytes(unsignedBytes, signDetached(unsignedBytes, signingKey.secretKey))
      const transactionSignature = getSignatureFromSignedTransactionBytes(signedBytes)
      return await broadcastHomeV2Payment({
        action,
        amount,
        assetId,
        assetName: assetInfo?.name,
        network,
        nodeApiUrl: node.nodeApiUrl,
        recipient,
        recipientName: null,
        signedBytes,
        timestamp,
        transactionSignature,
      })
    } finally {
      signingKey.secretKey.fill(0)
    }
  } finally {
    homeV2PaymentSendLocks.delete(lockKey)
  }
}

async function broadcastHomeV2Payment(input: {
  readonly action: HomeV2PaymentAction
  readonly amount: { readonly atomic: bigint; readonly decimal: string }
  readonly assetId: number
  readonly assetName?: string
  readonly network: HomeV2AppNetwork
  readonly nodeApiUrl: string
  readonly recipient: HomeV2PaymentRecipient
  readonly recipientName: string | null
  readonly signedBytes: Uint8Array
  readonly timestamp: number
  readonly transactionSignature: string
}) {
  const base = {
    action: input.action,
    amount: input.amount.decimal,
    assetId: input.assetId,
    ...(input.assetName ? { assetName: input.assetName } : {}),
    network: input.network,
    recipient: input.recipient.address,
    ...(input.recipientName ? { recipientName: input.recipientName } : {}),
    transactionSignature: input.transactionSignature,
  }
  try {
    await postHomeV2ChatText(
      input.nodeApiUrl,
      '/transactions/process?apiVersion=2',
      base58Encode(input.signedBytes),
      'text/plain',
      `${homeV2PaymentOperationLabel(input.action)} transaction processing failed.`,
    )
    return Object.freeze({ ...base, accepted: true })
  } catch (error) {
    // Once a signature exists, ANY ambiguous failure is an unknown outcome:
    // a lying node's error is not proof the network never saw the bytes.
    // The dispatcher journals this from outcome/transactionSignature/
    // timestamp; a failed journal write fail-closes further payments.
    return Object.freeze({
      ...base,
      accepted: false,
      error: error instanceof Error ? error.message : 'Payment broadcast outcome is unknown.',
      errorType: 'BROADCAST_UNKNOWN' as const,
      outcome: 'unknown' as const,
      retryable: false as const,
      timestamp: input.timestamp,
    })
  }
}

function wipeQortalPrivateGroupKeyRing(keyRing: QortalPrivateGroupKeyRing) {
  for (const entry of keyRing.values()) {
    entry.messageKey.fill(0)
    entry.nonce?.fill(0)
  }
}

async function readHomeV2PrimaryPublisherName(
  nodeApiUrl: string,
  network: HomeV2AppNetwork,
  address: string,
) {
  const value = await readHomeV2ChatJson(
    nodeApiUrl,
    `/names/primary/${encodeURIComponent(address)}`,
    `${network === 'qortal' ? 'Qortal' : 'Qortium'} primary-name lookup`,
  )
  const name = stringField(value, 'name')
  if (!name || stringField(value, 'owner') !== address) {
    throw new Error('Publishing a private chat attachment requires a current primary name owned by the selected account.')
  }
  return name
}

async function publishHomeV2PrivateAttachmentSource(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  routeRevision: string,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  if (!isAccountUnlocked(context.accountId)) throw createHomeV2BridgeError('The selected account is locked.', {
    action: 'PUBLISH_CHAT_ATTACHMENT',
    code: 'ACCOUNT_LOCKED',
    network,
    retryable: false,
    routeRevision,
  })
  const accountId = context.accountId
  const request = normalizeHomeV2PrivateAttachmentPublishRequest(protocol, requestValue)
  const node = await getHomeV2ReadableNode(network)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const binding = homeV2PublishSourceBinding({
    context,
    network,
    nodeApiUrl: node.nodeApiUrl,
    protocol,
    routeRevision,
  })
  const source = homeV2DesktopPublishSources.resolve(request.sourceToken, binding)
  if (source.kind === 'directory') {
    throw new Error('PUBLISH_CHAT_ATTACHMENT does not support a directory-bundled publish source.')
  }
  if (source.size > PRIVATE_ATTACHMENT_SOURCE_MAX_BYTES) {
    throw new Error('Selected attachment exceeds the size this action will accept.')
  }
  const sourceBytes = await readHomeV2DesktopPublishSource(source)
  const sourceHash = await sha256Hex(sourceBytes)
  const profile = await getAccountProfile(accountId)
  const publisherName = await readHomeV2PrimaryPublisherName(node.nodeApiUrl, network, profile.address)
  const mediaType = sniffPrivateChatAttachmentMediaType(sourceBytes)
  const opaqueId = randomUUID().replaceAll('-', '')
  const hubImage = network === 'qortal' && request.conversation.kind === 'group' &&
    isQortalHubCompatiblePrivateImageMediaType(mediaType)
  const service = hubImage ? 'IMAGE' as const : 'QCHAT_ATTACHMENT_PRIVATE' as const
  const identifier = hubImage
    ? `grp-q-manager_0_group_${request.conversation.groupId}_${opaqueId.slice(0, 16)}`
    : `chat-attachment-${opaqueId}`
  const approvedSenderPublicKey = getAccountSigningPublicKey(accountId)
  const apiKey = network === 'qortium'
    ? await getHomeV2SignedWriteApiKey(network, node.nodeApiUrl)
    : ''
  const directBaseline = request.conversation.kind === 'direct'
    ? await readHomeV2DirectPublicKey(node.nodeApiUrl, network, request.conversation.otherAddress, apiKey)
    : null
  const qpgcBaseline = request.conversation.kind === 'group' && network === 'qortium'
    ? await readHomeV2QpgcState(node.nodeApiUrl, request.conversation.groupId, apiKey)
    : null
  const qortalGroupBaseline = request.conversation.kind === 'group' && network === 'qortal'
    ? await readHomeV2QortalPrivateGroupState(node.nodeApiUrl, request.conversation.groupId)
    : null
  if (
    request.conversation.kind === 'group' &&
    network === 'qortium' &&
    (!qpgcBaseline || !qpgcBaseline.memberPublicKeys.some((key) => base58Encode(key) === approvedSenderPublicKey))
  ) throw createHomeV2BridgeError('The selected account is not a current member of this private group.', {
    action: 'PUBLISH_CHAT_ATTACHMENT',
    code: 'NOT_GROUP_MEMBER',
    network,
    retryable: false,
    routeRevision,
    target: request.conversation,
  })
  if (
    request.conversation.kind === 'group' &&
    network === 'qortal' &&
    (!qortalGroupBaseline || !qortalGroupBaseline.memberAddresses.includes(profile.address))
  ) throw createHomeV2BridgeError('The selected account is not a current member of this private group.', {
    action: 'PUBLISH_CHAT_ATTACHMENT',
    code: 'NOT_GROUP_MEMBER',
    network,
    retryable: false,
    routeRevision,
    target: request.conversation,
  })
  await requireAccountReadPermission(sender, context, protocol, 'PUBLISH_CHAT_ATTACHMENT', {
    kind: 'publish',
    contentHash: sourceHash,
    fileName: source.fileName,
    operationLabel: request.conversation.kind === 'direct'
      ? 'Encrypt and publish a direct-message attachment'
      : 'Encrypt and publish a private-group attachment',
    resourceCoordinate: `${service}/${publisherName}/${identifier}`,
    routeLabel: `${node.mode} · ${node.nodeApiUrl}`,
    size: source.size,
    targetChainLabel: network === 'qortal' ? 'Qortal' : 'Qortium',
  })
  const isStillValid = async () => {
    const fresh = getQdnViewContextForWebContents(sender)
    if (!fresh || !sameViewContext(context, fresh) || !liveResourceMatchesGrant(fresh) || !isAccountUnlocked(accountId)) return false
    const current = await getHomeV2ReadableNode(network).catch(() => null)
    return !!current && `${current.mode}|${current.nodeApiUrl}` === nodeRoute
  }
  const validateTarget = async () => {
    if (!(await isStillValid())) throw new Error('The app, account, or node route changed during private attachment publishing.')
    const currentName = await readHomeV2PrimaryPublisherName(node.nodeApiUrl, network, profile.address)
    if (currentName !== publisherName) throw new Error('The selected account primary name changed during private attachment publishing.')
    if (request.conversation.kind === 'direct') {
      const current = await readHomeV2DirectPublicKey(node.nodeApiUrl, network, request.conversation.otherAddress, apiKey)
      if (!directBaseline || current.value !== directBaseline.value) throw new Error('Direct attachment recipient public key changed before signing.')
      return
    }
    if (network === 'qortium') {
      const current = await readHomeV2QpgcState(node.nodeApiUrl, request.conversation.groupId, apiKey)
      if (
        !qpgcBaseline ||
        !current.epochId.every((value, index) => value === qpgcBaseline.epochId[index]) ||
        !current.memberPublicKeys.some((key) => base58Encode(key) === approvedSenderPublicKey)
      ) throw new Error('Private-group membership changed before attachment signing.')
      return
    }
    const current = await readHomeV2QortalPrivateGroupState(node.nodeApiUrl, request.conversation.groupId)
    if (
      !current.memberAddresses.includes(profile.address) ||
      !qortalGroupBaseline ||
      current.memberAddresses.join('|') !== qortalGroupBaseline.memberAddresses.join('|')
    ) throw new Error('Qortal private-group membership changed before attachment signing.')
  }
  await validateTarget()
  const payload = { data: sourceBytes, filename: source.fileName, mediaType }
  let ciphertext: Uint8Array
  let codec: HomeV2PrivateAttachmentDescriptor['codec']
  const keyMaterial = getAccountSecretKey(accountId)
  try {
    if (keyMaterial.address !== profile.address || keyMaterial.publicKey58 !== approvedSenderPublicKey) {
      throw new Error('Selected account signing key changed before attachment encryption.')
    }
    if (request.conversation.kind === 'direct') {
      ciphertext = network === 'qortium'
        ? await encryptPrivateChatDirectAttachment({
            payload,
            recipientPublicKey: directBaseline!.bytes,
            senderPublicKey: base58Decode(approvedSenderPublicKey),
          })
        : await encryptQortalPrivateChatDirectAttachment({
            payload,
            recipientPublicKey: directBaseline!.bytes,
            senderPublicKey: base58Decode(approvedSenderPublicKey),
          })
      codec = network === 'qortium' ? 'qenc-v2-direct' : 'qortal-qatt-direct-v1'
    } else if (network === 'qortium') {
      const key = await resolveHomeV2QpgcKey({
        accountId,
        apiKey,
        epochId: qpgcBaseline!.epochId,
        groupId: request.conversation.groupId,
        nodeApiUrl: node.nodeApiUrl,
        secretKey: keyMaterial.secretKey,
        state: qpgcBaseline!,
      })
      if (!key) throw createHomeV2BridgeError('No private-group key is available. Recover or rotate the key first.', {
        action: 'PUBLISH_CHAT_ATTACHMENT', code: 'MISSING_GROUP_KEY', network, retryable: false,
        routeRevision, target: request.conversation,
      })
      try {
        ciphertext = await encryptPrivateChatGroupAttachment({
          epochId: key.epochId,
          groupId: request.conversation.groupId,
          groupKey: key.groupKey,
          keyId: key.keyId,
          payload,
        })
      } finally {
        key.groupKey.fill(0)
      }
      codec = 'qenc-v2-group'
    } else {
      const key = await resolveHomeV2QortalPrivateGroupRing({
        accountId,
        nodeApiUrl: node.nodeApiUrl,
        secretKey: keyMaterial.secretKey,
        state: qortalGroupBaseline!,
      })
      if (!key) throw createHomeV2BridgeError('No Qortal private-group key is available. Recover or rotate the key first.', {
        action: 'PUBLISH_CHAT_ATTACHMENT', code: 'MISSING_GROUP_KEY', network, retryable: false,
        routeRevision, target: request.conversation,
      })
      try {
        ciphertext = hubImage
          ? encryptQortalHubPrivateGroupImage({ data: sourceBytes, keyRing: key.keyRing })
          : await encryptQortalPrivateChatGroupAttachment({ keyRing: key.keyRing, payload })
      } finally {
        wipeQortalPrivateGroupKeyRing(key.keyRing)
      }
      codec = hubImage ? 'qortal-hub-group-image-v1' : 'qortal-qatt-group-v1'
    }
  } finally {
    keyMaterial.secretKey.fill(0)
  }
  await validateTarget()
  const result = await publishHomeV2EncryptedResource({
    accountId,
    fileName: 'private-chat-attachment.bin',
    isStillValid,
    network,
    nodeApiUrl: node.nodeApiUrl,
    resource: { identifier, name: publisherName, service, tags: [] },
    serviceId: service === 'IMAGE' ? 400 : 121,
    sourceBytes: ciphertext,
    validateTarget,
  })
  const descriptor = createHomeV2PrivateAttachmentDescriptor({
    ciphertextHash: result.contentHash,
    ciphertextSize: result.size,
    codec,
    conversation: request.conversation,
    identifier,
    name: publisherName,
    network,
    service,
    transactionSignature: result.transactionSignature,
  })
  if (result.accepted || result.outcome === 'unknown') homeV2DesktopPublishSources.release(request.sourceToken)
  return result.accepted
    ? Object.freeze({ accepted: true as const, descriptor, transactionSignature: result.transactionSignature })
    : Object.freeze({
        accepted: false as const,
        descriptor,
        error: result.error,
        errorType: result.errorType,
        outcome: result.outcome,
        retryable: result.retryable,
        timestamp: result.timestamp,
        transactionSignature: result.transactionSignature,
      })
}

async function readHomeV2PrivateAttachmentCiphertext(
  nodeApiUrl: string,
  descriptor: HomeV2PrivateAttachmentDescriptor,
  apiKey: string,
) {
  const resource = descriptor.resource
  const url = `${nodeApiUrl}/arbitrary/${encodeURIComponent(resource.service)}/${encodeURIComponent(resource.name)}/${encodeURIComponent(resource.identifier)}?rebuild=true`
  const response = await nodeFetch(url, {
    headers: apiKey ? { 'X-API-KEY': apiKey } : undefined,
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
  })
  if (response.url && new URL(response.url).toString() !== url) {
    await response.body?.cancel()
    throw new Error('Private attachment response changed the approved resource URL.')
  }
  if (!response.ok) throw new Error(`Private attachment request returned HTTP ${response.status}.`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > 1024 * 1024) {
    await response.body?.cancel()
    throw new Error('Private attachment ciphertext exceeds the 1 MiB limit.')
  }
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  if (reader) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 1024 * 1024) {
        await reader.cancel()
        throw new Error('Private attachment ciphertext exceeds the 1 MiB limit.')
      }
      chunks.push(value)
    }
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (
    bytes.length !== descriptor.ciphertext.size ||
    await sha256Hex(bytes) !== descriptor.ciphertext.hash
  ) throw new Error('Private attachment ciphertext does not match its immutable descriptor.')
  return bytes
}

function privateAttachmentExtension(mediaType: string) {
  return new Map([
    ['application/pdf', 'pdf'],
    ['image/avif', 'avif'],
    ['image/gif', 'gif'],
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
  ]).get(mediaType) ?? 'bin'
}

async function decryptHomeV2PrivateAttachment(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  routeRevision: string,
  action: Exclude<HomeV2PrivateAttachmentAction, 'PUBLISH_CHAT_ATTACHMENT'>,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId || !isAccountUnlocked(context.accountId)) {
    throw createHomeV2BridgeError('The selected account is locked.', {
      action,
      code: 'ACCOUNT_LOCKED',
      network,
      retryable: false,
      routeRevision,
    })
  }
  const accountId = context.accountId
  const { descriptor } = normalizeHomeV2PrivateAttachmentAccessRequest(protocol, requestValue)
  const node = await getHomeV2ReadableNode(network)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  const routeLabel = `${node.mode} · ${node.nodeApiUrl}`
  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'publish',
    contentHash: descriptor.ciphertext.hash,
    fileName: 'Encrypted private chat attachment',
    operationLabel: action === 'SAVE_CHAT_ATTACHMENT'
      ? 'Decrypt and save a private chat attachment'
      : action === 'OPEN_CHAT_ATTACHMENT_VIEWER'
        ? 'Decrypt and view a private chat attachment'
        : 'Decrypt and stream a private chat attachment',
    resourceCoordinate: `${descriptor.resource.service}/${descriptor.resource.name}/${descriptor.resource.identifier}`,
    routeLabel,
    size: descriptor.ciphertext.size,
    targetChainLabel: network === 'qortal' ? 'Qortal' : 'Qortium',
  })
  const baseContextIsStillValid = homeV2ResourceStreamValidator({ context, network, nodeRoute, sender })
  const isStillValid = async () => isAccountUnlocked(accountId) && await baseContextIsStillValid()
  if (!(await isStillValid())) throw new Error('The app, account, or node route changed before attachment decryption.')
  const approvedPublicKey = getAccountSigningPublicKey(accountId)
  const apiKey = network === 'qortium'
    ? await getHomeV2SignedWriteApiKey(network, node.nodeApiUrl)
    : ''
  let peerKey: Awaited<ReturnType<typeof readHomeV2DirectPublicKey>> | null = null
  let qpgcState: HomeV2QpgcGroupState | null = null
  let qortalState: HomeV2QortalPrivateGroupState | null = null
  if (descriptor.conversation.kind === 'direct') {
    peerKey = await readHomeV2DirectPublicKey(
      node.nodeApiUrl,
      network,
      descriptor.conversation.otherAddress,
      apiKey,
    )
  } else if (network === 'qortium') {
    qpgcState = await readHomeV2QpgcState(node.nodeApiUrl, descriptor.conversation.groupId, apiKey)
    if (!qpgcState.memberPublicKeys.some((key) => base58Encode(key) === approvedPublicKey)) {
      throw createHomeV2BridgeError('The selected account is not a current member of this private group.', {
        action, code: 'NOT_GROUP_MEMBER', network, retryable: false, routeRevision,
        target: descriptor.conversation,
      })
    }
  } else {
    qortalState = await readHomeV2QortalPrivateGroupState(node.nodeApiUrl, descriptor.conversation.groupId)
    if (!qortalState.memberAddresses.includes(profile.address)) {
      throw createHomeV2BridgeError('The selected account is not a current member of this private group.', {
        action, code: 'NOT_GROUP_MEMBER', network, retryable: false, routeRevision,
        target: descriptor.conversation,
      })
    }
  }
  const ciphertext = await readHomeV2PrivateAttachmentCiphertext(node.nodeApiUrl, descriptor, apiKey)
  if (!(await isStillValid())) throw new Error('The app, account, or node route changed during attachment fetch.')
  const keyMaterial = getAccountSecretKey(accountId)
  try {
    if (keyMaterial.address !== profile.address || keyMaterial.publicKey58 !== approvedPublicKey) {
      throw new Error('Selected account signing key changed before attachment decryption.')
    }
    let payload: Readonly<{ data: Uint8Array; filename: string; mediaType: string }>
    if (descriptor.conversation.kind === 'direct') {
      const qenc = network === 'qortal' ? getQortalPrivateChatDirectQencEnvelope(ciphertext) : ciphertext
      await assertPrivateChatAttachmentRecipients(qenc, [base58Decode(approvedPublicKey), peerKey!.bytes])
      payload = network === 'qortal'
        ? await decryptQortalPrivateChatDirectAttachment({ envelope: ciphertext, selectedAccountSecretKey: keyMaterial.secretKey })
        : await decryptPrivateChatAttachmentForRecipient({ envelope: ciphertext, selectedAccountSecretKey: keyMaterial.secretKey })
    } else if (network === 'qortium') {
      const envelope = parsePrivateChatAttachmentEnvelope(ciphertext)
      if (envelope.mode !== 'group' || envelope.groupId !== descriptor.conversation.groupId || !envelope.epochId || !envelope.keyId) {
        throw new Error('Private attachment group context does not match its descriptor.')
      }
      const currentEpoch = qpgcState!.epochId.every((value, index) => value === envelope.epochId![index])
      const key = await resolveHomeV2QpgcKey({
        accountId,
        apiKey,
        epochId: envelope.epochId,
        groupId: descriptor.conversation.groupId,
        keyId: envelope.keyId,
        nodeApiUrl: node.nodeApiUrl,
        secretKey: keyMaterial.secretKey,
        ...(currentEpoch ? { state: qpgcState! } : {}),
      })
      if (!key) throw createHomeV2BridgeError('No matching private-group attachment key is available.', {
        action, code: 'MISSING_GROUP_KEY', network, retryable: false, routeRevision,
        target: descriptor.conversation,
      })
      try {
        payload = await decryptPrivateChatGroupAttachment({
          envelope: ciphertext,
          epochId: envelope.epochId,
          groupId: descriptor.conversation.groupId,
          groupKey: key.groupKey,
          keyId: envelope.keyId,
        })
      } finally {
        key.groupKey.fill(0)
      }
    } else {
      const key = await resolveHomeV2QortalPrivateGroupRing({
        accountId,
        nodeApiUrl: node.nodeApiUrl,
        secretKey: keyMaterial.secretKey,
        state: qortalState!,
      })
      if (!key) throw createHomeV2BridgeError('No matching Qortal private-group attachment key is available.', {
        action, code: 'MISSING_GROUP_KEY', network, retryable: false, routeRevision,
        target: descriptor.conversation,
      })
      try {
        if (descriptor.codec === 'qortal-hub-group-image-v1') {
          const data = decryptQortalHubPrivateGroupImage({ ciphertext, keyRing: key.keyRing })
          const mediaType = sniffPrivateChatAttachmentMediaType(data)
          if (!isQortalHubCompatiblePrivateImageMediaType(mediaType)) {
            data.fill(0)
            throw new Error('Qortal private-group image has an unsupported decrypted media type.')
          }
          payload = Object.freeze({ data, filename: `private-image.${privateAttachmentExtension(mediaType)}`, mediaType })
        } else {
          payload = await decryptQortalPrivateChatGroupAttachment({ envelope: ciphertext, keyRing: key.keyRing })
        }
      } finally {
        wipeQortalPrivateGroupKeyRing(key.keyRing)
      }
    }
    const sniffed = sniffPrivateChatAttachmentMediaType(payload.data)
    const mediaType = sniffed === 'application/octet-stream' ? 'application/octet-stream' : sniffed
    if (!(await isStillValid())) {
      payload.data.fill(0)
      throw new Error('The app, account, or node route changed during attachment decryption.')
    }
    const bytes = new Uint8Array(payload.data)
    payload.data.fill(0)
    return Object.freeze({
      bytes,
      filename: sanitizeHomeV2ResourceFilename(payload.filename, `private-attachment.${privateAttachmentExtension(mediaType)}`),
      isStillValid,
      mediaType,
      node,
      nodeRoute,
    })
  } finally {
    keyMaterial.secretKey.fill(0)
    ciphertext.fill(0)
  }
}

async function readBoundedResponse(
  response: Response,
  method: 'GET' | 'HEAD' | 'POST',
  maxBytes = HOME_V2_APP_LIMITS.responseBytes,
) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel()
    throw new Error('Node API response exceeded the requested size limit.')
  }
  let body = ''
  if (method !== 'HEAD' && response.body) {
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) {
        await reader.cancel()
        throw new Error('Node API response exceeded the requested size limit.')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    body = new TextDecoder().decode(bytes)
  }
  const contentType = response.headers.get('content-type') ?? ''
  let data: unknown = body
  if (body && (contentType.includes('json') || /^[\[{]/.test(body.trim()))) {
    try {
      data = JSON.parse(body) as unknown
    } catch {
      data = body
    }
  }
  return {
    body,
    contentLength: Number.isFinite(declared) ? declared : Buffer.byteLength(body, 'utf8'),
    contentType,
    data,
    headers: Object.fromEntries(response.headers.entries()),
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  }
}

async function fetchRead(
  network: HomeV2AppNetwork,
  path: string,
  method: 'GET' | 'HEAD',
  maxBytes = HOME_V2_APP_LIMITS.responseBytes,
) {
  const node = await getHomeV2ReadableNode(network)
  const response = await nodeFetch(`${node.nodeApiUrl}${path}`, {
    method,
    signal: AbortSignal.timeout(15_000),
  })
  return { node, result: await readBoundedResponse(response, method, maxBytes) }
}

const HOME_V2_RESOURCE_SAVE_MAX_BYTES = 100 * 1024 * 1024

function sanitizeHomeV2ResourceFilename(value: unknown, fallback: string) {
  const requested = typeof value === 'string' ? value.trim() : ''
  const leaf = nodePath.basename(requested || fallback)
  const sanitized = leaf
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 180)
  return sanitized || 'qdn-resource'
}

async function resolveHomeV2ResourceUrl(
  network: HomeV2AppNetwork,
  request: Record<string, unknown>,
  context: QdnViewContext,
  streamOnly = false,
) {
  if (streamOnly) getQdnResourceStreamRequest(request as QdnAppRequest)
  else getQdnResourceViewerRequest(request as QdnAppRequest)
  const statusPath = buildHomeV2ResourcePath('GET_QDN_RESOURCE_STATUS', request)
  const { node, result } = await fetchRead(network, statusPath, 'GET', 256 * 1024)
  const status = responseDataOrThrow(result, 'QDN resource status request')
  if (!isHomeV2AppRecord(status) || !status.status || status.status === 'NOT_PUBLISHED') {
    throw new Error('Resource does not exist.')
  }
  return {
    node,
    status,
    url: `${node.nodeApiUrl}${buildHomeV2ResourceRenderPath(request, context.displaySettings)}`,
  }
}

async function readHomeV2ResourceBytes(
  network: HomeV2AppNetwork,
  request: Record<string, unknown>,
  expectedRoute: string,
) {
  const node = await getHomeV2ReadableNode(network)
  if (`${node.mode}|${node.nodeApiUrl}` !== expectedRoute) {
    throw new Error('The selected resource route changed before the save began.')
  }
  const resource = getQdnResourceViewerRequest(request as QdnAppRequest)
  const resourcePath = buildHomeV2ResourcePath('FETCH_QDN_RESOURCE', {
    identifier: resource.identifier,
    name: resource.name,
    path: resource.path,
    service: resource.service,
  })
  const response = await nodeFetch(`${node.nodeApiUrl}${resourcePath}`, {
    method: 'GET',
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) throw new Error(`QDN resource request returned HTTP ${response.status}.`)
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > HOME_V2_RESOURCE_SAVE_MAX_BYTES) {
    await response.body?.cancel()
    throw new Error('QDN resource exceeds the 100 MiB save limit.')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > HOME_V2_RESOURCE_SAVE_MAX_BYTES) {
    throw new Error('QDN resource exceeds the 100 MiB save limit.')
  }
  return {
    bytes,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  }
}

function stringField(value: unknown, key: string) {
  if (!isHomeV2AppRecord(value)) return null
  const field = value[key]
  return typeof field === 'string' && field.trim() ? field.trim() : null
}

function responseDataOrThrow(
  result: Awaited<ReturnType<typeof fetchRead>>['result'],
  label: string,
) {
  if (!result.ok) throw new Error(`${label} returned HTTP ${result.status}.`)
  return result.data
}

async function readIdentityData(
  network: HomeV2AppNetwork,
  kind: 'accountAvatarInfo' | 'name' | 'namesByAddress' | 'primaryName',
  value: string,
) {
  const response = await readHomeV2Identity(network, { kind, value })
  if (response.status === 404) return null
  if (response.status !== 200) {
    throw new Error(`Identity lookup returned HTTP ${response.status}.`)
  }
  return response.data
}

async function resolveIdentities(request: Record<string, unknown>) {
  const addresses = normalizeHomeV2IdentityAddresses(request.addresses)
  return Promise.all(addresses.map(async (address) => {
    const [primary, owned] = await Promise.all([
      readIdentityData('qortium', 'primaryName', address),
      readIdentityData('qortium', 'namesByAddress', address),
    ])
    const primaryName = stringField(primary, 'name')
    const firstOwnedName = Array.isArray(owned)
      ? owned.map((entry) => stringField(entry, 'name')).find(Boolean) ?? null
      : null
    const name = primaryName ?? firstOwnedName
    return {
      address,
      name,
      avatarSrc: name
        ? `${(await getHomeV2ReadableNode('qortium')).nodeApiUrl}/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/avatar?async=true`
        : null,
      avatarContract: 'legacy-named-thumbnail',
    }
  }))
}

async function fetchAvatar(
  network: HomeV2AppNetwork,
  action: HomeV2AvatarAction,
  request: Record<string, unknown>,
) {
  return fetchHomeV2AvatarAction(network, action, request, {
    async readAvatar(path, legacyAsync) {
      return readResolvedHomeV2Avatar(network, { legacyAsync, path })
    },
    async readJson(path) {
      const { result } = await fetchRead(network, path, 'GET', 256 * 1024)
      return { data: result.data, status: result.status }
    },
  })
}

async function postHomeV2ChatText(
  nodeApiUrl: string,
  path: string,
  body: string,
  contentType: string,
  fallbackMessage: string,
  apiKey = '',
) {
  const response = await nodeFetch(`${nodeApiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      ...(apiKey ? { 'X-API-KEY': apiKey } : {}),
    },
    body,
    // A redirect would let the responder pick a second host this call's
    // callers never vetted — and this helper carries the admin API key and
    // whole signed transaction bodies. Fetch preserves X-API-KEY across
    // origins, and 307/308 re-send the method and body. Core's API never
    // legitimately redirects; refuse outright. (List-family review
    // follow-up, 2026-08-26. The reward-share key is now derived locally, so
    // no account private key travels through this helper any more.)
    redirect: 'error',
    signal: AbortSignal.timeout(CHAT_WRITE_TIMEOUT_MS),
  })
  // Bounded like the read-only actions below (FIX #4, security review): a
  // hostile or misbehaving node answering /chat/public/build or
  // /transactions/process with an unbounded body previously had to be read
  // to completion before Home could react. 'GET' here only tells
  // readBoundedResponse to read the body (this is a POST); it does not
  // change the HTTP method actually sent above.
  const result = await readBoundedResponse(response, 'GET', CHAT_SIGNING_RESPONSE_MAX_BYTES)
  const text = result.body.trim()
  if (!result.ok) {
    throw Object.assign(
      new Error(readableNodeErrorMessage(text, `${fallbackMessage} HTTP ${result.status}.`)),
      { status: result.status },
    )
  }
  return text
}

type HomeV2ChatSigningKey = { address: string; publicKey58: string; secretKey: Uint8Array }

/**
 * The API key for ORDINARY signed writes (chat, group membership/admin,
 * polls, names, group mutations, attachments): it is whatever key the current
 * connection carries, and it exists only so those calls work against a local
 * Core that requires one. It is NOT an authorization decision and must never
 * gate an administrative family — resolveHomeV2AdminNode does that.
 */
async function getHomeV2SignedWriteApiKey(
  network: HomeV2AppNetwork,
  expectedNodeApiUrl: string,
) {
  if (network === 'qortal') return ''
  const connection = await getNodeConnection()
  if (connection.nodeApiUrl !== expectedNodeApiUrl) {
    throw new Error('The selected Qortium route changed before the write could start.')
  }
  return connection.apiKey ?? ''
}

function chatOperationLabel(action: HomeV2PublicChatAction) {
  if (action === 'SEND_CHAT_EDIT') return 'Edit message'
  if (action === 'SEND_CHAT_DELETE') return 'Delete message'
  if (action === 'SEND_CHAT_REACTION') return 'React to message'
  return 'Send message'
}

async function readHomeV2ChatJson(
  nodeApiUrl: string,
  path: string,
  label: string,
  apiKey = '',
  maxBytes = CHAT_SIGNING_RESPONSE_MAX_BYTES,
) {
  const response = await nodeFetch(`${nodeApiUrl}${path}`, {
    headers: apiKey ? { 'X-API-KEY': apiKey } : undefined,
    method: 'GET',
    // Same rule as postHomeV2ChatText above: this reader is handed the admin
    // API key on the minting and signing paths, and a redirect would carry it
    // to a host nothing vetted. (List-family review follow-up, 2026-08-26.)
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  const result = await readBoundedResponse(response, 'GET', maxBytes)
  if (!result.ok) {
    throw Object.assign(new Error(`${label} returned HTTP ${result.status}.`), { status: result.status })
  }
  return result.data
}

async function validateHomeV2PublicChatTarget(
  nodeApiUrl: string,
  network: HomeV2AppNetwork,
  request: HomeV2PublicChatRequest,
  senderPublicKey: string,
  apiKey = '',
) {
  if (request.txGroupId !== 0) {
    const group = await readHomeV2ChatJson(
      nodeApiUrl,
      `/groups/${encodeURIComponent(String(request.txGroupId))}`,
      'Group lookup',
      apiKey,
    )
    assertHomeV2OpenPublicGroup(group, request.txGroupId, network)
  }
  if (!request.chatReference) return
  normalizeHomeV2PublicChatReferenceTarget(
    await readHomeV2ChatJson(
      nodeApiUrl,
      `/chat/message/${encodeURIComponent(request.chatReference)}?encoding=BASE58`,
      'Referenced chat lookup',
      apiKey,
    ),
    {
      chatReference: request.chatReference,
      requireOriginal: true,
      requireSenderOwnership:
        request.action === 'SEND_CHAT_EDIT' || request.action === 'SEND_CHAT_DELETE',
      senderPublicKey,
      txGroupId: request.txGroupId,
    },
  )
}

// Keyless open-group chat send for the Qortium network. Builds the unsigned
// CHAT bytes via the keyless /chat/public/build endpoint (no API key, no
// private key ever leaves this process), validates the node's response
// against what we asked it to build, computes the memory-pow nonce locally,
// signs locally, then broadcasts. Mirrors src/platform.ts
// sendKeylessPublicGroupChatMessage and electron/qdn.ts's v1 equivalent.
async function sendHomeV2QortiumChatMessage(
  nodeApiUrl: string,
  request: HomeV2PublicChatRequest,
  signingKey: HomeV2ChatSigningKey,
  isStillValid: () => boolean | Promise<boolean>,
  validateTarget: () => Promise<void>,
  apiKey = '',
) {
  const timestamp = Date.now()
  const buildRequest = buildHomeV2QortiumPublicChatBuildBody({
    request,
    senderPublicKey: signingKey.publicKey58,
    timestamp,
  })
  const buildBody = await postHomeV2ChatText(
    nodeApiUrl,
    '/chat/public/build',
    JSON.stringify(buildRequest),
    'application/json',
    'Chat transaction build failed.',
    apiKey,
  )
  const unsignedBytes = base58Decode(buildBody)
  // Never sign node-provided bytes without checking they encode exactly the
  // sender/group/message/timestamp we asked for.
  assertPublicChatTransaction(unsignedBytes, {
    ...(request.chatReference ? { chatReference: base58Decode(request.chatReference) } : {}),
    data: base58Decode(buildRequest.data),
    publicKey: base58Decode(signingKey.publicKey58),
    timestamp,
    txGroupId: request.txGroupId,
  })
  const nonce = await computeHomeV2ChatNonce(unsignedBytes, QORTIUM_CHAT_POW_DIFFICULTY, isStillValid)
  if (!(await isStillValid())) {
    throw new Error('The signing context changed before the chat message could be submitted.')
  }
  await validateTarget()
  if (!(await isStillValid())) {
    throw new Error('The signing context changed before the chat message could be submitted.')
  }
  const signedBytes = signChatTransaction(unsignedBytes, nonce, signingKey.secretKey)
  const signature = getSignatureFromSignedTransactionBytes(signedBytes)
  try {
    await postHomeV2ChatText(
      nodeApiUrl,
      '/transactions/process?apiVersion=2',
      base58Encode(signedBytes),
      'text/plain',
      'Chat transaction processing failed.',
      apiKey,
    )
    return { signature, timestamp }
  } catch (error) {
    return createHomeV2UnknownChatBroadcastResult(error, signature, timestamp)
  }
}

// Qortal CHAT PoW difficulty depends on the sender's confirmed QORT balance
// (electron/qortal-chat.ts qortalChatPowDifficultyForBalanceResponse). If the
// balance fetch fails for any reason (network error, non-2xx, malformed
// body), fall back to the safer, higher difficulty rather than failing the
// send outright — a slower send beats one Core rejects for insufficient
// proof-of-work.
async function resolveHomeV2QortalChatPowDifficulty(nodeApiUrl: string, address: string) {
  try {
    const response = await nodeFetch(`${nodeApiUrl}/addresses/balance/${encodeURIComponent(address)}`, {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
    })
    const result = await readBoundedResponse(response, 'GET', CHAT_SIGNING_RESPONSE_MAX_BYTES)
    if (!result.ok) throw new Error(`Balance lookup returned HTTP ${result.status}.`)
    return qortalChatPowDifficultyForBalanceResponse(result.data)
  } catch {
    return QORTAL_CHAT_POW_DIFFICULTY_BELOW
  }
}

// Fully client-side Qortal group chat send: transaction bytes are built here
// (no node build call), the memory-pow nonce is computed locally, and the
// account key signs locally. Mirrors electron/qdn.ts's v1
// sendQortalGroupChatForApp / src/platform.ts's equivalent, minus the
// Hub-shaped payload construction (v2's message is already the app's opaque,
// fully-formed payload).
async function sendHomeV2QortalChatMessage(
  nodeApiUrl: string,
  request: HomeV2PublicChatRequest,
  signingKey: HomeV2ChatSigningKey,
  isStillValid: () => boolean | Promise<boolean>,
  validateTarget: () => Promise<void>,
) {
  const timestamp = Date.now()
  const unsignedBytes = buildUnsignedQortalGroupChatTransactionBytes({
    ...(request.chatReference ? { chatReference: request.chatReference } : {}),
    lastReference: new Uint8Array(randomBytes(64)),
    message: request.message,
    senderPublicKey: signingKey.publicKey58,
    timestamp,
    txGroupId: request.txGroupId,
  })
  const difficulty = await resolveHomeV2QortalChatPowDifficulty(nodeApiUrl, signingKey.address)
  const nonce = await computeHomeV2ChatNonce(unsignedBytes, difficulty, isStillValid)
  if (!(await isStillValid())) {
    throw new Error('The signing context changed before the chat message could be submitted.')
  }
  await validateTarget()
  if (!(await isStillValid())) {
    throw new Error('The signing context changed before the chat message could be submitted.')
  }
  const stampedBytes = stampQortalGroupChatNonce(unsignedBytes, nonce)
  const signatureBytes = signDetached(stampedBytes, signingKey.secretKey)
  const signedBytes = appendSignatureToTransactionBytes(stampedBytes, signatureBytes)
  const signature = getSignatureFromSignedTransactionBytes(signedBytes)
  try {
    await postHomeV2ChatText(
      nodeApiUrl,
      '/transactions/process?apiVersion=2',
      base58Encode(signedBytes),
      'text/plain',
      'Qortal chat message broadcast failed.',
    )
    return { signature, timestamp }
  } catch (error) {
    return createHomeV2UnknownChatBroadcastResult(error, signature, timestamp)
  }
}

// One process-wide price cache, deliberately not per-app and not per-tab: the
// whole point is that the number of outbound requests is bounded by the TTL
// rather than by how many apps are asking. See home-v2-market-prices.ts for
// the full posture note — this is the one bridge action that leaves the
// Qortal/Qortium node network.
const homeV2MarketPrices = new HomeV2MarketPriceCache()

async function readHomeV2MarketPrices(requestValue: Record<string, unknown>) {
  const priceRequest = normalizeHomeV2MarketPriceRequest(requestValue)
  return homeV2MarketPrices.read(priceRequest, async (url) => {
    // Plain global fetch, NOT nodeFetch: nodeFetch carries Home's node TLS
    // pinning and trust decisions, which are meaningless for a public API and
    // must not be extended to one.
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(HOME_V2_MARKET_PRICE_TIMEOUT_MS),
    })
    // Bounded like every other response this file reads.
    const result = await readBoundedResponse(response, 'GET', HOME_V2_MARKET_PRICE_MAX_BYTES)
    return { ok: result.ok, payload: result.data, status: result.status }
  })
}

/**
 * SEND_MESSAGE: sign and broadcast one zero-fee, zero-payment chain MESSAGE to
 * an AT.
 *
 * Ordering matters and mirrors the chat send path exactly:
 *   validate → require an unlocked account → resolve the node route →
 *   PROMPT (single-request, disclosing the AT address and the message text) →
 *   rate limit → take the signing key → serialize → proof-of-work →
 *   revalidate the context → sign → broadcast → zero the key.
 *
 * The bytes are built field by field by buildUnsignedQortiumAtMessageTransactionBytes
 * from exactly two validated inputs. Nothing app-supplied is signed verbatim,
 * and unlike the chat path there are no node-provided bytes to re-verify
 * because Core has no build endpoint for MESSAGE — which is also why the
 * nonce must be computed locally: it lives inside the signed bytes.
 */
async function sendHomeV2AtMessage(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  // Defense in depth. The catalogue already withholds SEND_MESSAGE from
  // qortalRequest and normalizeHomeV2AtMessageRequest refuses that protocol,
  // but the serializer is Qortium-specific, so the chain is asserted here too:
  // a signing path must not depend on a catalogue entry staying correct.
  if (network !== 'qortium') {
    throw new Error('SEND_MESSAGE is a Qortium action; it is not available on Qortal.')
  }
  const accountId = context.accountId
  const request = normalizeHomeV2AtMessageRequest(protocol, requestValue)
  if (!isAccountUnlocked(accountId)) {
    throw new Error('The selected account is locked.')
  }
  const node = await getHomeV2ReadableNode(network)
  const nodeApiKey = await getHomeV2SignedWriteApiKey(network, node.nodeApiUrl)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  const approvedSenderPublicKey = getAccountSigningPublicKey(accountId)
  // Reuses the 'direct' prompt payload shape because it already carries the
  // two fields this prompt must show — a counterparty address and a message —
  // and because the main-process singleRequestOnly rule already covers that
  // kind. The action itself is ALSO named in that rule, so the single-request
  // guarantee does not rest on this choice. The FULL message is passed, never
  // a truncated preview: the renderer discloses exactly the bytes that will be
  // signed, in a bounded scrollable field, with a byte count.
  await requireAccountReadPermission(sender, context, protocol, 'SEND_MESSAGE', {
    kind: 'direct',
    // ESCAPED for display. The renderer prints this row as-is, so a raw
    // message could use bidi controls to reorder what the user reads while
    // the ORIGINAL bytes are what get signed — the user would be approving
    // text different from the instruction the contract receives. The signed
    // bytes still come from request.message; only the display is escaped.
    messagePreview: homeV2PromptText(request.message, 'The message text', HOME_V2_MESSAGE_PROMPT_MAX_CHARS),
    operationLabel: homeV2AtMessageOperationLabel(),
    otherAddress: request.recipient,
    routeLabel: node.nodeApiUrl,
    singleRequestOnly: true,
    targetChainLabel: 'Qortium',
  })
  // Same bound as every other send: an approved tab cannot queue an unbounded
  // run of signed transactions back to back.
  const rateLimitDecision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(sender, context))
  if (!rateLimitDecision.allowed) {
    throw new Error(rateLimitDecision.message)
  }
  const signingKey = getAccountSecretKey(accountId)
  if (signingKey.address !== profile.address || signingKey.publicKey58 !== approvedSenderPublicKey) {
    signingKey.secretKey.fill(0)
    throw new Error('Selected account signing key changed before the message could be signed.')
  }
  const isStillValid = async () => {
    const freshContext = getQdnViewContextForWebContents(sender)
    if (!freshContext || !sameViewContext(context, freshContext)) return false
    if (!liveResourceMatchesGrant(freshContext)) return false
    if (!isAccountUnlocked(accountId)) return false
    const nodeNow = await getHomeV2ReadableNode(network).catch(() => null)
    return !!nodeNow &&
      `${nodeNow.mode}|${nodeNow.nodeApiUrl}` === nodeRoute &&
      (await getHomeV2SignedWriteApiKey(network, node.nodeApiUrl).catch(() => null)) === nodeApiKey
  }
  try {
    if (!(await isStillValid())) {
      throw new Error('Account access context changed before approval completed.')
    }
    const timestamp = Date.now()
    const unsignedBytes = buildUnsignedQortiumAtMessageTransactionBytes({
      message: request.message,
      recipient: request.recipient,
      senderPublicKey: signingKey.publicKey58,
      timestamp,
    })
    // Verified field by field against the approved inputs by an INDEPENDENT
    // reader before anything is signed. Core has no build endpoint for
    // MESSAGE, so the transformer is the only thing between the request and
    // the signature; this is the posture the other locally-built families
    // already carry.
    const expectedMessageBytes = new TextEncoder().encode(request.message)
    const expectedAtMessageFields = {
      messageBytes: expectedMessageBytes,
      recipientBytes: base58Decode(request.recipient),
      senderPublicKeyBytes: base58Decode(signingKey.publicKey58),
      timestamp,
    }
    assertUnsignedQortiumAtMessageTransaction(unsignedBytes, { ...expectedAtMessageFields, nonce: 0 })
    // MESSAGE puts its nonce at the same offset CHAT does — txType(4) +
    // timestamp(8) + txGroupId(4) + senderPublicKey(32) = 48 — so the shared
    // stampTransactionNonce/signTransactionWithNonce pair applies unchanged.
    const nonce = await computeHomeV2ChatNonce(
      unsignedBytes,
      QORTIUM_AT_MESSAGE_POW_DIFFICULTY,
      isStillValid,
    )
    if (!(await isStillValid())) {
      throw new Error('The signing context changed before the message could be submitted.')
    }
    // And the STAMPED bytes: nothing is signed that was not itself verified.
    assertUnsignedQortiumAtMessageTransaction(
      stampTransactionNonce(unsignedBytes, nonce),
      { ...expectedAtMessageFields, nonce },
    )
    const signedBytes = signTransactionWithNonce(unsignedBytes, nonce, signingKey.secretKey)
    const signature = getSignatureFromSignedTransactionBytes(signedBytes)
    try {
      await postHomeV2ChatText(
        node.nodeApiUrl,
        '/transactions/process?apiVersion=2',
        base58Encode(signedBytes),
        'text/plain',
        'MESSAGE transaction processing failed.',
        nodeApiKey,
      )
      return Object.freeze({
        accepted: true as const,
        action: 'SEND_MESSAGE' as const,
        fee: '0',
        recipient: request.recipient,
        signature,
        timestamp,
      })
    } catch (error) {
      // Signed, possibly broadcast, outcome unknown. Same shape the chat sends
      // return, which is what the journal records against so the user can
      // reconcile it instead of blind-retrying a transaction that may have
      // landed.
      return createHomeV2UnknownChatBroadcastResult(error, signature, timestamp)
    }
  } finally {
    signingKey.secretKey.fill(0)
  }
}

async function sendHomeV2PublicChatAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  action: HomeV2PublicChatAction,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  const request = normalizeHomeV2PublicChatRequest(protocol, action, requestValue)
  const effectiveAction = request.action
  // The Chat app is expected to drive UNLOCK_SELECTED_ACCOUNT first on
  // qdnRequest; a pure-Qortal app cannot unlock in Phase 1 (documented
  // limitation, docs/HOME_V2_BRIDGE_COMPATIBILITY.md). Failing fast here also
  // avoids prompting the user for a send that cannot possibly proceed.
  if (!isAccountUnlocked(accountId)) {
    throw new Error('The selected account is locked.')
  }
  const node = await getHomeV2ReadableNode(network)
  const nodeApiKey = await getHomeV2SignedWriteApiKey(network, node.nodeApiUrl)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  const approvedSenderPublicKey = getAccountSigningPublicKey(accountId)
  const validateTarget = () => validateHomeV2PublicChatTarget(
    node.nodeApiUrl,
    network,
    request,
    approvedSenderPublicKey,
    nodeApiKey,
  )
  // Reference ownership/conversation binding and public-group metadata are
  // checked before the user sees a prompt, then checked again immediately
  // before signing by the chain-specific sender below.
  await validateTarget()
  const targetChainLabel = network === 'qortal' ? 'Qortal' : 'Qortium'
  const groupLabel = request.txGroupId === 0 ? 'General chat' : `Group ${request.txGroupId}`
  await requireAccountReadPermission(sender, context, protocol, effectiveAction, {
    kind: 'chat',
    chatReference: request.chatReference,
    groupId: request.txGroupId,
    messagePreview: request.message.slice(0, 180),
    operationLabel: chatOperationLabel(effectiveAction),
    targetChainLabel: `${targetChainLabel} · ${groupLabel}`,
  })
  // Fix B: reject an excessive send BEFORE any node call or proof-of-work —
  // the single-in-flight-PoW guard (isStillValid below) already prevents
  // overlap, but nothing previously bounded how many sends a granted tab
  // could queue back-to-back.
  const rateLimitDecision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(sender, context))
  if (!rateLimitDecision.allowed) {
    throw new Error(rateLimitDecision.message)
  }
  const signingKey = getAccountSecretKey(accountId)
  if (signingKey.address !== profile.address || signingKey.publicKey58 !== approvedSenderPublicKey) {
    signingKey.secretKey.fill(0)
    throw new Error('Selected account signing key changed before the chat action could be signed.')
  }
  const isStillValid = async () => {
    const freshContext = getQdnViewContextForWebContents(sender)
    if (!freshContext || !sameViewContext(context, freshContext)) return false
    if (!liveResourceMatchesGrant(freshContext)) return false
    if (!isAccountUnlocked(accountId)) return false
    const nodeNow = await getHomeV2ReadableNode(network).catch(() => null)
    return !!nodeNow &&
      `${nodeNow.mode}|${nodeNow.nodeApiUrl}` === nodeRoute &&
      (await getHomeV2SignedWriteApiKey(network, node.nodeApiUrl).catch(() => null)) === nodeApiKey
  }
  try {
    if (!(await isStillValid())) {
      throw new Error('Account access context changed before approval completed.')
    }
    return await (network === 'qortium'
      ? sendHomeV2QortiumChatMessage(node.nodeApiUrl, request, signingKey, isStillValid, validateTarget, nodeApiKey)
      : sendHomeV2QortalChatMessage(node.nodeApiUrl, request, signingKey, isStillValid, validateTarget))
  } finally {
    signingKey.secretKey.fill(0)
  }
}

const widgetGrants = new Set<string>()

// A widget floats above every other application, which QDN-published content
// cannot otherwise do, so opening one needs an explicit grant.
//
// `rereadContext` re-resolves the calling view once the user has answered, to
// catch a tab that navigated or closed while the prompt was up. It is supplied
// by the caller because the two entry points identify their view differently: an
// app asking for itself is found by its own webContents, while the toolbar names
// a tab and its request arrives on the Home shell's webContents, which is not a
// QDN view at all. Looking the shell up as a view returns null every time, which
// made the toolbar action fail for any app that did not already hold a grant.
async function requireWidgetPermission(
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  rereadContext: () => QdnViewContext | null,
) {
  // Same defense-in-depth as requireAccountReadPermission: a widget grant is
  // keyed off context.resourceUrl, so a view that navigated in-place to a
  // different app's resource could otherwise open a floating window under the
  // first app's grant. Refuse before the grant map is even consulted. This is
  // the more privileged of the two capabilities, so it must not be the one
  // place that skips the check.
  if (!liveResourceMatchesGrant(context)) {
    throw new Error('The widget request context changed before approval completed.')
  }

  const grantKey = [
    context.windowId,
    context.tabId,
    context.resourceUrl ?? 'unknown-resource',
    protocol,
    getHomeV2AppNetwork(protocol, 'OPEN_AS_WIDGET'),
    context.accountId ?? 'none',
  ].join('|')
  if (widgetGrants.has(grantKey)) return
  if (!isQdnViewVisible(context.windowId, context.tabId)) {
    throw new Error('Open this app tab to review the floating-window permission.')
  }

  const hostWindow = getContextWindow(context)
  if (!hostWindow || hostWindow.isDestroyed()) {
    throw new Error('The app request does not belong to an active Home window.')
  }
  if (Array.from(pendingAccountReads.values()).some(
    (pending) => pending.hostWebContentsId === hostWindow.webContents.id && pending.grantKey === grantKey,
  )) {
    throw new Error('This floating-window permission request is already pending for the app tab.')
  }

  const requestId = randomUUID()
  const decision = await new Promise<PermissionDecision>((resolve) => {
    const timeout = setTimeout(() => {
      pendingAccountReads.delete(requestId)
      resolve({ approved: false, scope: null })
    }, 60_000)
    pendingAccountReads.set(requestId, {
      grantKey,
      hostWebContentsId: hostWindow.webContents.id,
      tabId: context.tabId,
      resolve,
      timeout,
    })
    hostWindow.webContents.send('home-v2-app:permission-request', {
      accountId: context.accountId,
      action: 'OPEN_AS_WIDGET',
      appIdentityKey: grantKey,
      appTitle: context.resourceUrl ?? 'QDN app',
      protocol,
      requestId,
      resourceUrl: context.resourceUrl,
      tabId: context.tabId,
      targetNetwork: getHomeV2AppNetwork(protocol, 'OPEN_AS_WIDGET'),
    })
  })

  if (!decision.approved) throw new Error('Opening a widget was denied.')

  const freshContext = rereadContext()
  if (
    !freshContext ||
    !sameViewContext(context, freshContext) ||
    // Re-checked after the answer as well: the view had the whole time the
    // prompt was up to navigate somewhere else.
    !liveResourceMatchesGrant(freshContext)
  ) {
    throw new Error('The widget request context changed before approval completed.')
  }

  // Only a session grant is remembered. "Allow once" has to mean once, or the
  // two choices in the dialog are the same choice, and this is the capability
  // that lets an app paint over every other application on the desktop.
  if (decision.scope === 'session') widgetGrants.add(grantKey)
}

type PreparedWidgetLaunch = {
  readonly appName: string
  readonly manifest: WidgetManifest
  readonly renderUrl: string
}

type WidgetLaunchIdentity = {
  readonly appName: string
  readonly identity: WidgetResourceIdentity
  readonly resourceUrl: string
}

// The two things that have to be true before an app can have a widget at all:
// the tab is not itself a widget, and it is showing a published resource.
// Identity comes from the resource address rather than anything the app sends,
// so an app cannot ask for a widget pointed at someone else's resource.
function resolveWidgetLaunchIdentity(context: QdnViewContext): WidgetLaunchIdentity {
  if (isWidgetTabId(context.tabId)) {
    throw new Error('A widget cannot open another widget.')
  }
  if (!context.resourceUrl) {
    throw new Error('Only a published app can be opened as a widget.')
  }

  const identity = parseWidgetResourceIdentity(context.resourceUrl)
  const appName = identity.identifier ? `${identity.name}/${identity.identifier}` : identity.name
  return { appName, identity, resourceUrl: context.resourceUrl }
}

// Discovery only. Deliberately does NOT call assertWidgetCapacity: capacity is
// a launch-time limit ("this resource already has a widget open"), not a fact
// about whether the app publishes a widget face, and the toolbar's probe asks
// only the second question. Null means the app has no widget; a throw means a
// manifest exists but cannot be trusted (see widget-discovery.ts).
async function discoverContextWidgetManifest(
  context: QdnViewContext,
  identity: WidgetResourceIdentity,
): Promise<WidgetManifest | null> {
  return discoverWidgetManifest(identity, async (routePath) => {
    const response = await nodeFetch(`${context.nodeOrigin}${routePath}`, {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      await response.body?.cancel()
      return { ok: false, status: response.status, text: '' }
    }
    const result = await readBoundedResponse(response, 'GET', WIDGET_MANIFEST_MAX_BYTES)
    return {
      ok: response.ok,
      status: response.status,
      text: result.body,
    }
  })
}

async function prepareWidgetLaunch(context: QdnViewContext): Promise<PreparedWidgetLaunch> {
  const { appName, identity, resourceUrl } = resolveWidgetLaunchIdentity(context)
  assertWidgetCapacity(resourceUrl)

  const manifest = await discoverContextWidgetManifest(context, identity)
  if (!manifest) throw new Error('This app does not publish a widget.')

  const renderUrl = new URL(buildWidgetRenderUrl(context.nodeOrigin, identity, manifest.entry))
  renderUrl.searchParams.set('accent', context.displaySettings.accent)
  renderUrl.searchParams.set('lang', context.displaySettings.language)
  renderUrl.searchParams.set('textSize', context.displaySettings.textSize)
  renderUrl.searchParams.set('theme', context.displaySettings.theme)
  renderUrl.searchParams.set('uiStyle', context.displaySettings.ui)
  return { appName, manifest, renderUrl: renderUrl.toString() }
}

function handleOpenAsWidget(
  context: QdnViewContext,
  prepared: PreparedWidgetLaunch,
): { widgetId: string } {
  if (!context.resourceUrl) throw new Error('Only a published app can be opened as a widget.')
  assertWidgetCapacity(context.resourceUrl)

  const widgetId = allocateWidgetId()
  const { opacity, window } = createWidgetWindow({
    widgetId,
    manifest: prepared.manifest,
    renderUrl: prepared.renderUrl,
    resourceUrl: context.resourceUrl,
    nodeOrigin: context.nodeOrigin,
    accountId: context.accountId,
    bridgeStates: context.bridgeStates,
    displaySettings: context.displaySettings,
    managerRevisions: context.managerRevisions,
  })

  registerWidget({
    widgetId,
    appName: prepared.appName,
    resourceUrl: context.resourceUrl,
    manifest: prepared.manifest,
    windowId: window.id,
    region: normalizeRegion(prepared.manifest.shape),
    // createWidgetWindow starts every widget transparent to clicks; the
    // hit-test loop moves that from here. Opacity comes back from the window
    // because a restored placement may have opened it already dimmed, and the
    // tray reads this record to show which step is selected.
    ignoringMouse: true,
    opacity,
    snappedEdges: [],
  })

  return { widgetId }
}

// No permission prompt: an app closing its own widget can only ever remove one
// of its own windows.
function handleWidgetClose(context: QdnViewContext): { closed: boolean } {
  requireWidgetContext(context, 'WIDGET_CLOSE')
  const window = getContextWindow(context)
  if (!window || window.isDestroyed()) {
    throw new Error('This widget no longer belongs to an open window.')
  }
  window.close()
  return { closed: true }
}

// Every widget action is scoped to the widget it was called from. The id comes
// out of the view's own tabId, never out of the request, so an app cannot drag,
// resize or reshape somebody else's widget.
function requireWidgetContext(context: QdnViewContext, action: string): string {
  if (!isWidgetTabId(context.tabId)) {
    throw new Error(`${action} is only available inside a widget.`)
  }
  const widgetId = context.tabId.slice('widget:'.length)
  if (!widgetId) throw new Error(`${action} could not identify its widget.`)
  return widgetId
}

function handleWidgetAction(context: QdnViewContext, action: string, request: Record<string, unknown>) {
  const widgetId = requireWidgetContext(context, action)
  const others = listWidgets()

  if (action === 'WIDGET_SET_REGIONS') return setWidgetRegions(widgetId, request.shape)
  if (action === 'WIDGET_START_DRAG') return startWidgetDrag(widgetId, others)
  if (action === 'WIDGET_END_DRAG') return endWidgetDrag(widgetId)
  if (action === 'WIDGET_RESIZE') {
    return resizeWidget(widgetId, { height: request.height, width: request.width }, others)
  }
  return getWidgetState(widgetId)
}

function directChatOperationLabel(action: HomeV2DirectChatWriteAction) {
  if (action === 'SEND_DIRECT_CHAT_EDIT') return 'Edit direct message'
  if (action === 'SEND_DIRECT_CHAT_DELETE') return 'Clear direct message content'
  if (action === 'SEND_DIRECT_CHAT_REACTION') return 'React to direct message'
  return 'Send direct message'
}

function canonicalDirectPublicKey(value: unknown, network: HomeV2AppNetwork, otherAddress: string) {
  const publicKey = typeof value === 'string'
    ? value.trim()
    : isHomeV2AppRecord(value) && typeof value.publicKey === 'string'
      ? value.publicKey.trim()
      : ''
  try {
    const bytes = base58Decode(publicKey)
    if (bytes.length !== 32 || base58Encode(bytes) !== publicKey) throw new Error('invalid')
    return { bytes, value: publicKey }
  } catch {
    throw createHomeV2BridgeError('The direct-message recipient does not have a usable public key.', {
      action: 'DIRECT_CHAT',
      code: 'MISSING_RECIPIENT_PUBLIC_KEY',
      network,
      retryable: false,
      target: { kind: 'direct', otherAddress },
    })
  }
}

async function readHomeV2DirectPublicKey(
  nodeApiUrl: string,
  network: HomeV2AppNetwork,
  otherAddress: string,
  apiKey = '',
) {
  try {
    return canonicalDirectPublicKey(
      await readHomeV2ChatJson(
        nodeApiUrl,
        `/addresses/publickey/${encodeURIComponent(otherAddress)}`,
        'Direct-message public-key lookup',
        apiKey,
      ),
      network,
      otherAddress,
    )
  } catch (error) {
    if ('code' in Object(error) && (error as { code?: unknown }).code === 'MISSING_RECIPIENT_PUBLIC_KEY') throw error
    throw createHomeV2BridgeError('The direct-message recipient does not have a usable public key.', {
      action: 'DIRECT_CHAT',
      code: 'MISSING_RECIPIENT_PUBLIC_KEY',
      network,
      retryable: false,
      target: { kind: 'direct', otherAddress },
    })
  }
}

async function validateHomeV2DirectChatTarget(input: {
  action: HomeV2DirectChatWriteAction
  apiKey: string
  localAddress: string
  localPublicKey: string
  nodeApiUrl: string
  otherAddress: string
  otherPublicKey: string
  request: HomeV2DirectChatWriteRequest
}) {
  if (!input.request.chatReference) return
  assertHomeV2DirectReferenceTarget(
    await readHomeV2ChatJson(
      input.nodeApiUrl,
      `/chat/message/${encodeURIComponent(input.request.chatReference)}?encoding=BASE58`,
      'Referenced direct-message lookup',
      input.apiKey,
    ),
    {
      action: input.action,
      localAddress: input.localAddress,
      localPublicKey: input.localPublicKey,
      otherAddress: input.otherAddress,
      otherPublicKey: input.otherPublicKey,
      signature: input.request.chatReference,
    },
  )
}

async function sendHomeV2QortiumDirectChat(input: {
  apiKey: string
  isStillValid: () => boolean | Promise<boolean>
  nodeApiUrl: string
  peerPublicKey: Uint8Array
  request: HomeV2DirectChatWriteRequest
  signingKey: HomeV2ChatSigningKey
  validateTarget: () => Promise<void>
}) {
  const timestamp = Date.now()
  const envelope = await encryptQdm1Message({
    nonce: new Uint8Array(randomBytes(12)),
    plaintext: new TextEncoder().encode(input.request.message),
    recipientPublicKey: input.peerPublicKey,
    selectedAccountSecretKey: input.signingKey.secretKey,
    senderPublicKey: base58Decode(input.signingKey.publicKey58),
  })
  if (!(await input.isStillValid())) throw new Error('The signing context changed before direct-message construction.')
  const buildRequest = {
    ...(input.request.chatReference ? { chatReference: input.request.chatReference } : {}),
    data: base58Encode(envelope),
    fee: 0,
    isEncrypted: true,
    isText: true,
    recipient: input.request.otherAddress,
    senderPublicKey: input.signingKey.publicKey58,
    timestamp,
    txGroupId: 0,
  }
  const unsignedBytes = base58Decode(await postHomeV2ChatText(
    input.nodeApiUrl,
    '/chat/public/build',
    JSON.stringify(buildRequest),
    'application/json',
    'Direct CHAT transaction build failed.',
    input.apiKey,
  ))
  assertPublicChatTransaction(unsignedBytes, {
    ...(input.request.chatReference ? { chatReference: base58Decode(input.request.chatReference) } : {}),
    data: envelope,
    encrypted: true,
    publicKey: base58Decode(input.signingKey.publicKey58),
    recipient: base58Decode(input.request.otherAddress),
    timestamp,
    txGroupId: 0,
  })
  const nonce = await computeHomeV2ChatNonce(unsignedBytes, QORTIUM_CHAT_POW_DIFFICULTY, input.isStillValid)
  if (!(await input.isStillValid())) throw new Error('The signing context changed before the direct message could be submitted.')
  await input.validateTarget()
  if (!(await input.isStillValid())) throw new Error('The signing context changed before the direct message could be submitted.')
  const signedBytes = signChatTransaction(unsignedBytes, nonce, input.signingKey.secretKey)
  const signature = getSignatureFromSignedTransactionBytes(signedBytes)
  try {
    await postHomeV2ChatText(
      input.nodeApiUrl,
      '/transactions/process?apiVersion=2',
      base58Encode(signedBytes),
      'text/plain',
      'Direct CHAT transaction processing failed.',
      input.apiKey,
    )
    return { signature, timestamp }
  } catch (error) {
    return createHomeV2UnknownChatBroadcastResult(error, signature, timestamp)
  }
}

async function sendHomeV2QortalDirectChat(input: {
  isStillValid: () => boolean | Promise<boolean>
  nodeApiUrl: string
  peerPublicKey: Uint8Array
  request: HomeV2DirectChatWriteRequest
  signingKey: HomeV2ChatSigningKey
  validateTarget: () => Promise<void>
}) {
  const timestamp = Date.now()
  const lastReference = new Uint8Array(randomBytes(64))
  const ciphertext = await encryptQortalDirectMessage({
    lastReference,
    peerPublicKey: input.peerPublicKey,
    plaintext: new TextEncoder().encode(input.request.message),
    selectedAccountSecretKey: input.signingKey.secretKey,
  })
  const unsignedBytes = buildUnsignedQortalDirectChatTransactionBytes({
    ...(input.request.chatReference ? { chatReference: input.request.chatReference } : {}),
    ciphertext,
    lastReference,
    recipientAddress: input.request.otherAddress,
    senderPublicKey: input.signingKey.publicKey58,
    timestamp,
  })
  const difficulty = await resolveHomeV2QortalChatPowDifficulty(input.nodeApiUrl, input.signingKey.address)
  const nonce = await computeHomeV2ChatNonce(unsignedBytes, difficulty, input.isStillValid)
  if (!(await input.isStillValid())) throw new Error('The signing context changed before the direct message could be submitted.')
  await input.validateTarget()
  if (!(await input.isStillValid())) throw new Error('The signing context changed before the direct message could be submitted.')
  const stampedBytes = stampQortalGroupChatNonce(unsignedBytes, nonce)
  const signedBytes = appendSignatureToTransactionBytes(
    stampedBytes,
    signDetached(stampedBytes, input.signingKey.secretKey),
  )
  const signature = getSignatureFromSignedTransactionBytes(signedBytes)
  try {
    await postHomeV2ChatText(
      input.nodeApiUrl,
      '/transactions/process?apiVersion=2',
      base58Encode(signedBytes),
      'text/plain',
      'Qortal direct-message broadcast failed.',
    )
    return { signature, timestamp }
  } catch (error) {
    return createHomeV2UnknownChatBroadcastResult(error, signature, timestamp)
  }
}

async function sendHomeV2DirectChatAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  action: HomeV2DirectChatWriteAction,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  const request = normalizeHomeV2DirectChatWriteRequest(protocol, action, requestValue)
  if (!isAccountUnlocked(accountId)) throw createHomeV2BridgeError('The selected account is locked.', {
    action,
    code: 'ACCOUNT_LOCKED',
    network,
    retryable: false,
    target: { kind: 'direct', otherAddress: request.otherAddress },
  })
  const node = await getHomeV2ReadableNode(network)
  const apiKey = await getHomeV2SignedWriteApiKey(network, node.nodeApiUrl)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  if (profile.address === request.otherAddress) throw new Error('Direct-message recipient must be another account.')
  const approvedPublicKey = getAccountSigningPublicKey(accountId)
  const peerKey = await readHomeV2DirectPublicKey(node.nodeApiUrl, network, request.otherAddress, apiKey)
  const validateTarget = async () => {
    const currentPeerKey = await readHomeV2DirectPublicKey(node.nodeApiUrl, network, request.otherAddress, apiKey)
    if (currentPeerKey.value !== peerKey.value) throw new Error('Recipient public key changed before signing.')
    await validateHomeV2DirectChatTarget({
      action,
      apiKey,
      localAddress: profile.address,
      localPublicKey: approvedPublicKey,
      nodeApiUrl: node.nodeApiUrl,
      otherAddress: request.otherAddress,
      otherPublicKey: peerKey.value,
      request,
    })
  }
  await validateTarget()
  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'direct',
    chatReference: request.chatReference,
    messagePreview: request.message.slice(0, 180),
    operationLabel: directChatOperationLabel(action),
    otherAddress: request.otherAddress,
    routeLabel: `${node.mode} · ${node.nodeApiUrl}`,
    targetChainLabel: network === 'qortal' ? 'Qortal' : 'Qortium',
  })
  const rateLimitDecision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(sender, context))
  if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
  const signingKey = getAccountSecretKey(accountId)
  if (
    signingKey.address !== profile.address ||
    signingKey.publicKey58 !== approvedPublicKey
  ) {
    signingKey.secretKey.fill(0)
    throw new Error('Selected account signing key changed before the direct message could be signed.')
  }
  const isStillValid = async () => {
    const freshContext = getQdnViewContextForWebContents(sender)
    if (!freshContext || !sameViewContext(context, freshContext) || !liveResourceMatchesGrant(freshContext)) return false
    if (!isAccountUnlocked(accountId)) return false
    const nodeNow = await getHomeV2ReadableNode(network).catch(() => null)
    return !!nodeNow &&
      `${nodeNow.mode}|${nodeNow.nodeApiUrl}` === nodeRoute &&
      (await getHomeV2SignedWriteApiKey(network, node.nodeApiUrl).catch(() => null)) === apiKey
  }
  try {
    if (!(await isStillValid())) throw new Error('Account access context changed before approval completed.')
    return await (network === 'qortium'
      ? sendHomeV2QortiumDirectChat({
          apiKey,
          isStillValid,
          nodeApiUrl: node.nodeApiUrl,
          peerPublicKey: peerKey.bytes,
          request,
          signingKey,
          validateTarget,
        })
      : sendHomeV2QortalDirectChat({
          isStillValid,
          nodeApiUrl: node.nodeApiUrl,
          peerPublicKey: peerKey.bytes,
          request,
          signingKey,
          validateTarget,
        }))
  } finally {
    signingKey.secretKey.fill(0)
  }
}

async function readHomeV2DirectChatAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  action: 'GET_PRIVATE_DIRECT_ACTIVE_CHATS' | 'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  const request = normalizeHomeV2DirectChatReadRequest(protocol, action, requestValue)
  if (!isAccountUnlocked(accountId)) throw createHomeV2BridgeError('The selected account is locked.', {
    action,
    code: 'ACCOUNT_LOCKED',
    network,
    retryable: false,
    ...(request.otherAddress ? { target: { kind: 'direct' as const, otherAddress: request.otherAddress } } : {}),
  })
  const node = await getHomeV2ReadableNode(network)
  const apiKey = await getHomeV2SignedWriteApiKey(network, node.nodeApiUrl)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'direct',
    operationLabel: action === 'GET_PRIVATE_DIRECT_ACTIVE_CHATS'
      ? 'Read active direct conversations'
      : 'Read direct-message history',
    otherAddress: request.otherAddress ?? 'all-direct-conversations',
    routeLabel: `${node.mode} · ${node.nodeApiUrl}`,
    targetChainLabel: network === 'qortal' ? 'Qortal' : 'Qortium',
  })
  const signingKey = getAccountSecretKey(accountId)
  if (signingKey.address !== profile.address) {
    signingKey.secretKey.fill(0)
    throw new Error('Selected account signing key changed before direct-message decryption.')
  }
  try {
    const query = new URLSearchParams()
    query.set('encoding', 'BASE64')
    if (request.hasChatReference !== undefined) {
      query.set('haschatreference', String(request.hasChatReference))
    }
    let path: string
    if (action === 'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES') {
      query.append('involving', profile.address)
      query.append('involving', request.otherAddress as string)
      if (request.before !== undefined) query.set('before', String(request.before))
      query.set('limit', String(request.limit))
      query.set('reverse', String(request.reverse))
      path = `/chat/messages?${query.toString()}`
    } else {
      path = `/chat/active/${encodeURIComponent(profile.address)}?${query.toString()}`
    }
    const raw = await readHomeV2ChatJson(
      node.nodeApiUrl,
      path,
      'Encrypted direct-chat read',
      apiKey,
      DIRECT_CHAT_READ_RESPONSE_MAX_BYTES,
    )
    const rows = action === 'GET_PRIVATE_DIRECT_ACTIVE_CHATS'
      ? isHomeV2AppRecord(raw) && Array.isArray(raw.direct) ? raw.direct : []
      : Array.isArray(raw) ? raw : []
    const peerKeys = new Map<string, Awaited<ReturnType<typeof readHomeV2DirectPublicKey>>>()
    const decrypted = []
    for (const value of rows.slice(0, 100)) {
      if (!isHomeV2AppRecord(value)) continue
      try {
        const senderAddress = normalizeHomeV2Address(value.sender)
        const recipientAddress = normalizeHomeV2Address(value.recipient)
        const otherAddress = senderAddress === profile.address
          ? recipientAddress
          : recipientAddress === profile.address
            ? senderAddress
            : ''
        if (!otherAddress || (request.otherAddress && otherAddress !== request.otherAddress)) {
          throw new Error('Direct chat row does not match the approved participants.')
        }
        let peerKey = peerKeys.get(otherAddress)
        if (!peerKey) {
          peerKey = await readHomeV2DirectPublicKey(node.nodeApiUrl, network, otherAddress, apiKey)
          peerKeys.set(otherAddress, peerKey)
        }
        decrypted.push(await decryptHomeV2DirectChatRow({
          encoding: request.encoding,
          localAddress: profile.address,
          localPublicKey: base58Decode(signingKey.publicKey58),
          network,
          peerAddress: otherAddress,
          peerPublicKey: peerKey.bytes,
          row: value,
          selectedAccountSecretKey: signingKey.secretKey,
        }))
      } catch (error) {
        decrypted.push(directDecryptFailure(value, error))
      }
    }
    const freshContext = getQdnViewContextForWebContents(sender)
    const nodeNow = await getHomeV2ReadableNode(network).catch(() => null)
    if (
      !freshContext ||
      !sameViewContext(context, freshContext) ||
      !liveResourceMatchesGrant(freshContext) ||
      !isAccountUnlocked(accountId) ||
      !nodeNow ||
      `${nodeNow.mode}|${nodeNow.nodeApiUrl}` !== nodeRoute
    ) throw new Error('Direct-message read context changed before decryption completed.')
    return decrypted
  } finally {
    signingKey.secretKey.fill(0)
  }
}

function qpgcOperationLabel(
  action: HomeV2PrivateGroupChatReadAction | HomeV2PrivateGroupChatWriteAction,
  network: HomeV2AppNetwork = 'qortium',
) {
  if (action === 'GET_PRIVATE_GROUP_ACTIVE_CHATS') return 'Read active private-group chats'
  if (action === 'GET_PRIVATE_GROUP_CHAT_STATE') return 'Read private-group chat state'
  if (action === 'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES') return 'Read private-group chat history'
  if (action === 'REQUEST_PRIVATE_GROUP_CHAT_KEY') return network === 'qortal' ? 'Recover a private-group chat key' : 'Request a private-group chat key'
  if (action === 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS') return network === 'qortal' ? 'Republish private-group chat keys' : 'Relay private-group chat keys'
  if (action === 'ROTATE_PRIVATE_GROUP_CHAT_KEY') return 'Rotate a private-group chat key'
  if (action === 'SEND_PRIVATE_GROUP_CHAT_EDIT') return 'Edit a private-group message'
  if (action === 'SEND_PRIVATE_GROUP_CHAT_DELETE') return 'Clear private-group message content'
  if (action === 'SEND_PRIVATE_GROUP_CHAT_REACTION') return 'React in a private group'
  return 'Send a private-group message'
}

type HomeV2QortalPrivateGroupState = {
  readonly adminAddresses: readonly string[]
  readonly adminNames: readonly string[]
  readonly groupId: number
  readonly groupName: string
  readonly isOpen: false
  readonly memberAddresses: readonly string[]
  readonly memberPublicKeys?: readonly Uint8Array[]
  readonly ownerAddress: string
}

type HomeV2QortalPrivateGroupResource = {
  readonly created: number
  readonly identifier: string
  readonly name: string
  readonly signature: string
  readonly size: number
  readonly updated: number
}

function normalizeQortalPrivateGroupMembers(value: unknown) {
  if (!isHomeV2AppRecord(value) || !Array.isArray(value.members)) {
    throw new Error('Qortal private-group membership response is invalid.')
  }
  const members = value.members.map((entry) => {
    if (!isHomeV2AppRecord(entry)) throw new Error('Qortal private-group member entry is invalid.')
    return {
      address: normalizeHomeV2Address(entry.member),
      isAdmin: entry.isAdmin === true,
      primaryName: typeof entry.primaryName === 'string' && entry.primaryName.trim()
        ? entry.primaryName.trim()
        : null,
    }
  })
  if (!Number.isSafeInteger(value.memberCount) || value.memberCount !== members.length || members.length < 1 || members.length > 4_096) {
    throw new Error('Qortal private-group member count is invalid.')
  }
  return members
}

async function readHomeV2QortalPrivateGroupState(
  nodeApiUrl: string,
  groupId: number,
  includePublicKeys = false,
): Promise<HomeV2QortalPrivateGroupState> {
  const [groupValue, memberValue] = await Promise.all([
    readHomeV2ChatJson(nodeApiUrl, `/groups/${encodeURIComponent(String(groupId))}`, 'Qortal private-group lookup'),
    readHomeV2ChatJson(
      nodeApiUrl,
      `/groups/members/${encodeURIComponent(String(groupId))}?limit=0`,
      'Qortal private-group membership lookup',
      '',
      PRIVATE_GROUP_CHAT_READ_RESPONSE_MAX_BYTES,
    ),
  ])
  const target = normalizeHomeV2GroupAdminTarget(groupValue, groupId, 'qortal')
  if (!isHomeV2AppRecord(groupValue) || groupValue.isOpen !== false) {
    throw new Error('Qortal private-group actions require a closed group.')
  }
  const members = normalizeQortalPrivateGroupMembers(memberValue)
  const memberAddresses = members.map((member) => member.address)
  const adminAddresses = [...new Set([
    target.ownerAddress,
    ...members.filter((member) => member.isAdmin).map((member) => member.address),
  ])]
  const primaryByAddress = new Map(members.flatMap((member) =>
    member.primaryName ? [[member.address, member.primaryName] as const] : [],
  ))
  if (typeof groupValue.ownerPrimaryName === 'string' && groupValue.ownerPrimaryName.trim()) {
    primaryByAddress.set(target.ownerAddress, groupValue.ownerPrimaryName.trim())
  }
  for (const address of adminAddresses) {
    if (primaryByAddress.has(address)) continue
    const value = await readHomeV2ChatJson(
      nodeApiUrl,
      `/names/primary/${encodeURIComponent(address)}`,
      'Qortal group-administrator primary-name lookup',
    ).catch(() => null)
    const name = stringField(value, 'name')
    if (name) primaryByAddress.set(address, name)
  }
  let memberPublicKeys: Uint8Array[] | undefined
  if (includePublicKeys) {
    memberPublicKeys = []
    for (const address of memberAddresses) {
      let key: Awaited<ReturnType<typeof readHomeV2DirectPublicKey>>
      try {
        key = await readHomeV2DirectPublicKey(nodeApiUrl, 'qortal', address)
      } catch (error) {
        throw createHomeV2BridgeError(
          `Qortal group member ${address} does not have a usable public key.`,
          {
            action: 'ROTATE_PRIVATE_GROUP_CHAT_KEY',
            code: 'MISSING_RECIPIENT_PUBLIC_KEY',
            network: 'qortal',
            retryable: false,
            target: { kind: 'group', groupId },
          },
        )
      }
      memberPublicKeys.push(key.bytes)
    }
  }
  return Object.freeze({
    adminAddresses: Object.freeze(adminAddresses),
    adminNames: Object.freeze(adminAddresses.flatMap((address) => {
      const name = primaryByAddress.get(address)
      return name ? [name] : []
    })),
    groupId,
    groupName: target.groupName,
    isOpen: false,
    memberAddresses: Object.freeze(memberAddresses),
    ...(memberPublicKeys ? { memberPublicKeys: Object.freeze(memberPublicKeys) } : {}),
    ownerAddress: target.ownerAddress,
  })
}

function normalizeQortalPrivateGroupResource(
  value: unknown,
  state: HomeV2QortalPrivateGroupState,
): HomeV2QortalPrivateGroupResource | null {
  if (!isHomeV2AppRecord(value)) return null
  const identifier = `symmetric-qchat-group-${state.groupId}`
  if (value.service !== 'DOCUMENT_PRIVATE' || value.identifier !== identifier || typeof value.name !== 'string' || !state.adminNames.includes(value.name)) return null
  const signature = typeof value.latestSignature === 'string' ? value.latestSignature : ''
  try {
    if (base58Decode(signature).length !== 64 || base58Encode(base58Decode(signature)) !== signature) return null
  } catch { return null }
  const created = Number(value.created)
  const updated = value.updated === undefined ? created : Number(value.updated)
  const size = Number(value.size)
  if (!Number.isSafeInteger(created) || !Number.isSafeInteger(updated) || !Number.isSafeInteger(size) || size < 1 || size > 2 * 1024 * 1024) return null
  return { created, identifier, name: value.name, signature, size, updated }
}

async function readHomeV2QortalPrivateGroupResources(
  nodeApiUrl: string,
  state: HomeV2QortalPrivateGroupState,
) {
  if (!state.adminNames.length) return []
  const query = new URLSearchParams({
    exactmatchnames: 'true',
    identifier: `symmetric-qchat-group-${state.groupId}`,
    limit: '0',
    mode: 'ALL',
    prefix: 'true',
    reverse: 'true',
    service: 'DOCUMENT_PRIVATE',
  })
  for (const name of state.adminNames) query.append('name', name)
  const value = await readHomeV2ChatJson(
    nodeApiUrl,
    `/arbitrary/resources/searchsimple?${query.toString()}`,
    'Qortal private-group key-bundle search',
    '',
    PRIVATE_GROUP_CHAT_READ_RESPONSE_MAX_BYTES,
  )
  if (!Array.isArray(value)) throw new Error('Qortal private-group key-bundle search response is invalid.')
  return value.flatMap((entry) => {
    const normalized = normalizeQortalPrivateGroupResource(entry, state)
    return normalized ? [normalized] : []
  }).sort((left, right) => right.updated - left.updated || right.created - left.created || right.signature.localeCompare(left.signature))
}

async function persistHomeV2QortalPrivateGroupRing(input: {
  readonly accountId: string
  readonly groupId: number
  readonly keyRing: QortalPrivateGroupKeyRing
  readonly publisherName: string
  readonly recipientCount: number
  readonly resourceSignature: string
  readonly secretKey: Uint8Array
}) {
  upsertEncryptedQortalPrivateGroupRecord(await encryptQortalPrivateGroupStoredKeyRing({
    groupId: input.groupId,
    keyRing: input.keyRing,
    publisherName: input.publisherName,
    recipientCount: input.recipientCount,
    resourceSignature: input.resourceSignature,
    selectedAccountSecretKey: input.secretKey,
  }), input.accountId, app.getPath('userData'))
}

async function resolveHomeV2QortalPrivateGroupRing(input: {
  readonly accountId: string
  readonly nodeApiUrl: string
  readonly secretKey: Uint8Array
  readonly state: HomeV2QortalPrivateGroupState
}) {
  const accountPublicKey = Buffer.from(nacl.sign.keyPair.fromSecretKey(input.secretKey).publicKey).toString('base64')
  const stored = findEncryptedQortalPrivateGroupRecord({
    accountId: input.accountId,
    accountPublicKey,
    groupId: input.state.groupId,
    userData: app.getPath('userData'),
  })
  const resources = await readHomeV2QortalPrivateGroupResources(input.nodeApiUrl, input.state)
  for (const resource of resources.slice(0, 100)) {
    try {
      if (stored?.resourceSignature === resource.signature && stored.publisherName === resource.name) {
        return {
          keyRing: await decryptQortalPrivateGroupStoredKeyRing({ record: stored, selectedAccountSecretKey: input.secretKey }),
          publisherName: resource.name,
          recipientCount: stored.recipientCount,
          resourceSignature: resource.signature,
        }
      }
      const value = await readHomeV2ChatJson(
        input.nodeApiUrl,
        `/arbitrary/DOCUMENT_PRIVATE/${encodeURIComponent(resource.name)}/${encodeURIComponent(resource.identifier)}?encoding=base64&rebuild=true`,
        'Qortal private-group key-bundle fetch',
        '',
        3 * 1024 * 1024,
      )
      if (typeof value !== 'string') throw new Error('Qortal private-group key-bundle body is invalid.')
      const decrypted = decryptQortalPrivateGroupBundle({
        encryptedBundle: value.trim(),
        selectedAccountSecretKey: input.secretKey,
      })
      await persistHomeV2QortalPrivateGroupRing({
        accountId: input.accountId,
        groupId: input.state.groupId,
        keyRing: decrypted.keyRing,
        publisherName: resource.name,
        recipientCount: decrypted.recipientCount,
        resourceSignature: resource.signature,
        secretKey: input.secretKey,
      })
      return {
        keyRing: decrypted.keyRing,
        publisherName: resource.name,
        recipientCount: decrypted.recipientCount,
        resourceSignature: resource.signature,
      }
    } catch {
      // Continue through the bounded newest-first list until one currently
      // authorized administrator resource decrypts and authenticates.
    }
  }
  if (stored && input.state.adminNames.includes(stored.publisherName)) {
    try {
      return {
        keyRing: await decryptQortalPrivateGroupStoredKeyRing({ record: stored, selectedAccountSecretKey: input.secretKey }),
        publisherName: stored.publisherName,
        recipientCount: stored.recipientCount,
        resourceSignature: stored.resourceSignature,
      }
    } catch { /* fail below */ }
  }
  return null
}

function normalizeQortalAtomicFee(value: unknown) {
  const raw = typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string'
    ? String(value).trim()
    : ''
  if (!/^\d+$/.test(raw)) throw new Error('Qortal ARBITRARY fee response is invalid.')
  const fee = BigInt(raw)
  if (fee < 0n || fee > 9_223_372_036_854_775_807n) throw new Error('Qortal ARBITRARY fee is outside the transaction range.')
  return fee
}

async function publishHomeV2QortalPrivateGroupBundle(input: {
  readonly accountId: string
  readonly encryptedBundle: string
  readonly isStillValid: () => boolean | Promise<boolean>
  readonly keyRing: QortalPrivateGroupKeyRing
  readonly name: string
  readonly nodeApiUrl: string
  readonly secretKey: Uint8Array
  readonly senderAddress: string
  readonly senderPublicKey: Uint8Array
  readonly state: HomeV2QortalPrivateGroupState
  readonly validateState: () => Promise<void>
}) {
  const identifier = `symmetric-qchat-group-${input.state.groupId}`
  const feeTimestamp = Date.now()
  const [feeValue, referenceValue] = await Promise.all([
    readHomeV2ChatJson(input.nodeApiUrl, `/transactions/unitfee?txType=ARBITRARY&timestamp=${feeTimestamp}`, 'Qortal private-group publication fee lookup'),
    readHomeV2ChatJson(input.nodeApiUrl, `/addresses/lastreference/${encodeURIComponent(input.senderAddress)}`, 'Qortal private-group publication reference lookup'),
  ])
  const fee = normalizeQortalAtomicFee(feeValue)
  if (typeof referenceValue !== 'string') throw new Error('Qortal last-reference response is invalid.')
  const lastReference = base58Decode(referenceValue.trim())
  if (lastReference.length !== 64 || base58Encode(lastReference) !== referenceValue.trim()) throw new Error('Qortal last-reference response is invalid.')
  if (!(await input.isStillValid())) throw new Error('The signing context changed before Qortal key-bundle staging.')
  const started = Date.now()
  let unsignedBase58: string
  try {
    unsignedBase58 = await postHomeV2ChatText(
      input.nodeApiUrl,
      `/arbitrary/DOCUMENT_PRIVATE/${encodeURIComponent(input.name)}/${encodeURIComponent(identifier)}/base64?fee=${encodeURIComponent(String(fee))}`,
      input.encryptedBundle,
      'text/plain',
      'Qortal private-group key-bundle staging failed.',
    )
  } catch (error) {
    const status = isHomeV2AppRecord(error) && typeof error.status === 'number' ? error.status : null
    if (status === 401 || status === 403 || status === 404 || status === 405) {
      throw createHomeV2BridgeError(
        'The selected Qortal node does not permit private-group QDN bundle staging.',
        {
          action: 'ROTATE_PRIVATE_GROUP_CHAT_KEY',
          code: 'NODE_CAPABILITY_MISSING',
          network: 'qortal',
          retryable: false,
          target: { kind: 'group', groupId: input.state.groupId },
        },
      )
    }
    throw error
  }
  const attested = attestUnsignedQortalPrivateGroupPublish(unsignedBase58.trim(), {
    bundleSize: Buffer.from(input.encryptedBundle, 'base64').length,
    feeAtomic: fee,
    identifier,
    lastReference,
    name: input.name,
    senderPublicKey: input.senderPublicKey,
    timestampMaximum: Date.now() + 5_000,
    timestampMinimum: started - 5_000,
  })
  if (!(await input.isStillValid())) throw new Error('The signing context changed before Qortal key-bundle signing.')
  await input.validateState()
  if (!(await input.isStillValid())) throw new Error('The signing context changed before Qortal key-bundle submission.')
  const signed = signAttestedQortalPrivateGroupPublish({
    selectedAccountSecretKey: input.secretKey,
    signingBytes: attested.signingBytes,
    unsignedBytes: attested.unsignedBytes,
  })
  try {
    await postHomeV2ChatText(
      input.nodeApiUrl,
      '/transactions/process?apiVersion=2',
      base58Encode(signed.signedBytes),
      'text/plain',
      'Qortal private-group key-bundle broadcast failed.',
    )
  } catch (error) {
    // Do not cache an unconfirmed bundle coordinate. If the broadcast did
    // reach the chain, normal resource discovery will recover it later.
    return createHomeV2UnknownChatBroadcastResult(error, signed.signature, attested.timestamp)
  }
  try {
    await persistHomeV2QortalPrivateGroupRing({
      accountId: input.accountId,
      groupId: input.state.groupId,
      keyRing: input.keyRing,
      publisherName: input.name,
      recipientCount: input.state.memberAddresses.length,
      resourceSignature: signed.signature,
      secretKey: input.secretKey,
    })
  } catch {
    // The accepted QDN resource remains the recovery source. A local cache
    // failure must not turn a confirmed broadcast into a retryable failure.
  }
  return { accepted: true, signature: signed.signature, timestamp: attested.timestamp }
}

async function validateHomeV2QortalPrivateGroupReference(input: {
  readonly action: HomeV2PrivateGroupChatWriteAction
  readonly chatReference: string | null
  readonly groupId: number
  readonly nodeApiUrl: string
  readonly senderPublicKey: string
}) {
  if (!input.chatReference) return
  const value = await readHomeV2ChatJson(
    input.nodeApiUrl,
    `/chat/message/${encodeURIComponent(input.chatReference)}?encoding=BASE64`,
    'Referenced Qortal private-group message lookup',
  )
  if (!isHomeV2AppRecord(value) || value.signature !== input.chatReference || Number(value.txGroupId) !== input.groupId) {
    throw new Error('Referenced private-group message belongs to a different conversation.')
  }
  if (value.recipient !== null && value.recipient !== undefined && value.recipient !== '') {
    throw new Error('Referenced private-group message unexpectedly has a recipient.')
  }
  if (value.isEncrypted !== false || value.isText !== true || value.chatReference) {
    throw new Error('Qortal private-group revisions must reference one original app-encrypted group message.')
  }
  if (
    (input.action === 'SEND_PRIVATE_GROUP_CHAT_EDIT' || input.action === 'SEND_PRIVATE_GROUP_CHAT_DELETE') &&
    value.senderPublicKey !== input.senderPublicKey
  ) throw new Error('Only the original sender can edit or clear a private-group message.')
}

function qortalPrivateGroupFailure(row: Record<string, unknown>, error: unknown) {
  return {
    ...row,
    data: null,
    decryptionError: error instanceof Error ? error.message : String(error),
    status: /key version .* unavailable|key bundle|key ring/i.test(error instanceof Error ? error.message : String(error))
      ? 'MISSING_KEY'
      : 'FAILED',
  }
}

function decodeQortalPrivateGroupChatData(value: unknown) {
  if (typeof value !== 'string' || !value) throw new Error('Qortal private-group CHAT data is missing.')
  const bytes = Uint8Array.from(Buffer.from(value, 'base64'))
  if (Buffer.from(bytes).toString('base64') !== value) throw new Error('Qortal private-group CHAT data is not canonical Base64.')
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Error('Qortal private-group CHAT data is not UTF-8.') }
}

function decryptHomeV2QortalPrivateGroupRows(input: {
  readonly encoding: 'BASE58' | 'BASE64'
  readonly groupId: number
  readonly keyRing: QortalPrivateGroupKeyRing
  readonly rows: readonly unknown[]
}) {
  const results: Record<string, unknown>[] = []
  for (const value of input.rows.slice(0, 100)) {
    if (!isHomeV2AppRecord(value)) continue
    try {
      if (Number(value.txGroupId) !== input.groupId || value.isEncrypted !== false || value.isText !== true) {
        throw new Error('Qortal private-group row is not app-encrypted text for the approved group.')
      }
      if (value.recipient !== null && value.recipient !== undefined && value.recipient !== '') {
        throw new Error('Qortal private-group row unexpectedly has a recipient.')
      }
      const decrypted = decryptQortalPrivateGroupPayload({
        ciphertext: decodeQortalPrivateGroupChatData(value.data),
        keyRing: input.keyRing,
      })
      results.push({
        ...value,
        data: input.encoding === 'BASE58' ? base58Encode(decrypted.plaintext) : Buffer.from(decrypted.plaintext).toString('base64'),
        encoding: input.encoding,
        keyVersion: decrypted.keyVersion,
        payloadType: decrypted.typeNumber,
        status: 'DECRYPTED',
      })
    } catch (error) {
      results.push(qortalPrivateGroupFailure(value, error))
    }
  }
  return results
}

function encodeBase64Bytes(value: Uint8Array) {
  return Buffer.from(value).toString('base64')
}

function decodeCanonicalBase64(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${label} is not canonical Base64.`)
  }
  const bytes = Uint8Array.from(Buffer.from(value, 'base64'))
  if (encodeBase64Bytes(bytes) !== value) throw new Error(`${label} is not canonical Base64.`)
  return bytes
}

async function readHomeV2QpgcState(nodeApiUrl: string, groupId: number, apiKey = '') {
  return normalizeHomeV2QpgcGroupState(
    await readHomeV2ChatJson(
      nodeApiUrl,
      `/chat/private/group/state/${encodeURIComponent(String(groupId))}`,
      'Private-group state lookup',
      apiKey,
      PRIVATE_GROUP_CHAT_READ_RESPONSE_MAX_BYTES,
    ),
    groupId,
  )
}

async function readHomeV2QpgcControls(input: {
  readonly apiKey?: string
  readonly beforeCursor?: string
  readonly epochId?: Uint8Array
  readonly groupId: number
  readonly keyId?: Uint8Array
  readonly limit?: number
  readonly nodeApiUrl: string
  readonly state?: HomeV2QpgcGroupState
  readonly types: readonly ('KEY_ANNOUNCEMENT' | 'KEY_REQUEST' | 'ROTATION_REQUEST')[]
}) {
  const query = new URLSearchParams({
    limit: String(input.limit ?? 100),
    txGroupId: String(input.groupId),
    types: input.types.join(','),
  })
  if (input.beforeCursor) query.set('beforeCursor', input.beforeCursor)
  if (input.epochId) query.set('epochId', base58Encode(input.epochId))
  if (input.keyId) query.set('keyId', base58Encode(input.keyId))
  return normalizeHomeV2QpgcControlPage(
    await readHomeV2ChatJson(
      input.nodeApiUrl,
      `/chat/private/group/control?${query.toString()}`,
      'Private-group control lookup',
      input.apiKey ?? '',
      PRIVATE_GROUP_CHAT_READ_RESPONSE_MAX_BYTES,
    ),
    input.groupId,
    input.state,
  )
}

function qpgcStoredRecords(input: {
  readonly accountId: string
  readonly accountPublicKey: Uint8Array
  readonly epochId?: Uint8Array
  readonly groupId: number
  readonly keyId?: Uint8Array
}) {
  return findEncryptedQpgcKeyRecords({
    accountId: input.accountId,
    accountPublicKey: encodeBase64Bytes(input.accountPublicKey),
    ...(input.epochId ? { epochId: encodeBase64Bytes(input.epochId) } : {}),
    groupId: input.groupId,
    ...(input.keyId ? { keyId: encodeBase64Bytes(input.keyId) } : {}),
    userData: app.getPath('userData'),
  })
}

async function decryptQpgcRecords(
  records: readonly EncryptedQpgcStoredKey[],
  secretKey: Uint8Array,
) {
  const decrypted = []
  for (const record of records) {
    try {
      decrypted.push(await decryptQpgcStoredKey({ record, selectedAccountSecretKey: secretKey }))
    } catch {
      // A damaged or foreign ciphertext record is ignored and never returned to
      // the app. A valid retained announcement can repair it below.
    }
  }
  return decrypted
}

async function persistQpgcKey(input: {
  readonly accountId: string
  readonly epochId: Uint8Array
  readonly groupId: number
  readonly groupKey: Uint8Array
  readonly keyId: Uint8Array
  readonly secretKey: Uint8Array
}) {
  upsertEncryptedQpgcKeyRecord(await encryptQpgcStoredKey({
    epochId: input.epochId,
    groupId: input.groupId,
    groupKey: input.groupKey,
    keyId: input.keyId,
    selectedAccountSecretKey: input.secretKey,
  }), input.accountId, app.getPath('userData'))
}

async function resolveHomeV2QpgcKey(input: {
  readonly accountId: string
  readonly apiKey: string
  readonly epochId: Uint8Array
  readonly groupId: number
  readonly keyId?: Uint8Array
  readonly nodeApiUrl: string
  readonly secretKey: Uint8Array
  readonly state?: HomeV2QpgcGroupState
}) {
  const accountPublicKey = nacl.sign.keyPair.fromSecretKey(input.secretKey).publicKey
  const stored = await decryptQpgcRecords(qpgcStoredRecords({
    accountId: input.accountId,
    accountPublicKey,
    epochId: input.epochId,
    groupId: input.groupId,
    ...(input.keyId ? { keyId: input.keyId } : {}),
  }), input.secretKey)
  if (stored.length) return stored[stored.length - 1]
  const page = await readHomeV2QpgcControls({
    apiKey: input.apiKey,
    epochId: input.epochId,
    groupId: input.groupId,
    ...(input.keyId ? { keyId: input.keyId } : {}),
    nodeApiUrl: input.nodeApiUrl,
    state: input.state,
    types: ['KEY_ANNOUNCEMENT'],
  })
  for (const control of page.controls) {
    if (control.envelope.type !== 'KEY_ANNOUNCEMENT') continue
    try {
      const groupKey = await unwrapQpgcAnnouncementForRecipient({
        announcement: control.envelope,
        ...(input.state && control.envelope.epochId.every((value, index) => value === input.state!.epochId[index])
          ? { memberPublicKeys: input.state.memberPublicKeys }
          : {}),
        recipientSecretKey: input.secretKey,
      })
      const result = {
        epochId: control.envelope.epochId,
        groupKey,
        keyId: control.envelope.keyId,
      }
      await persistQpgcKey({ accountId: input.accountId, ...result, groupId: input.groupId, secretKey: input.secretKey })
      return result
    } catch {
      // Continue through bounded retained announcements until one valid wrapper
      // for the selected account is found.
    }
  }
  return null
}

async function validateHomeV2QpgcReference(input: {
  readonly action: HomeV2PrivateGroupChatWriteAction
  readonly apiKey: string
  readonly chatReference: string | null
  readonly groupId: number
  readonly nodeApiUrl: string
  readonly senderPublicKey: string
}) {
  if (!input.chatReference) return
  const value = await readHomeV2ChatJson(
    input.nodeApiUrl,
    `/chat/message/${encodeURIComponent(input.chatReference)}?encoding=BASE58`,
    'Referenced private-group message lookup',
    input.apiKey,
  )
  if (!isHomeV2AppRecord(value) || value.signature !== input.chatReference || Number(value.txGroupId) !== input.groupId) {
    throw new Error('Referenced private-group message belongs to a different conversation.')
  }
  if (value.recipient !== null && value.recipient !== undefined && value.recipient !== '') {
    throw new Error('Referenced private-group message unexpectedly has a recipient.')
  }
  if (value.isEncrypted !== true || value.isText !== true || value.chatReference) {
    throw new Error('Private-group revisions must reference one original encrypted group message.')
  }
  if (
    (input.action === 'SEND_PRIVATE_GROUP_CHAT_EDIT' || input.action === 'SEND_PRIVATE_GROUP_CHAT_DELETE') &&
    value.senderPublicKey !== input.senderPublicKey
  ) throw new Error('Only the original sender can edit or clear a private-group message.')
}

async function sendHomeV2QpgcEnvelope(input: {
  readonly apiKey: string
  readonly chatReference: string | null
  readonly envelope: Uint8Array
  readonly groupId: number
  readonly isStillValid: () => boolean | Promise<boolean>
  readonly nodeApiUrl: string
  readonly signingKey: HomeV2ChatSigningKey
  readonly validateTarget: () => Promise<void>
}) {
  const timestamp = Date.now()
  const buildRequest = {
    ...(input.chatReference ? { chatReference: input.chatReference } : {}),
    data: base58Encode(input.envelope),
    fee: 0,
    isEncrypted: true,
    isText: true,
    senderPublicKey: input.signingKey.publicKey58,
    timestamp,
    txGroupId: input.groupId,
  }
  const unsignedBytes = base58Decode(await postHomeV2ChatText(
    input.nodeApiUrl,
    '/chat/public/build',
    JSON.stringify(buildRequest),
    'application/json',
    'Private-group CHAT build failed.',
    input.apiKey,
  ))
  assertPublicChatTransaction(unsignedBytes, {
    ...(input.chatReference ? { chatReference: base58Decode(input.chatReference) } : {}),
    data: input.envelope,
    encrypted: true,
    publicKey: base58Decode(input.signingKey.publicKey58),
    timestamp,
    txGroupId: input.groupId,
  })
  const nonce = await computeHomeV2ChatNonce(unsignedBytes, QORTIUM_CHAT_POW_DIFFICULTY, input.isStillValid)
  if (!(await input.isStillValid())) throw new Error('The signing context changed before private-group submission.')
  await input.validateTarget()
  if (!(await input.isStillValid())) throw new Error('The signing context changed before private-group submission.')
  const signedBytes = signChatTransaction(unsignedBytes, nonce, input.signingKey.secretKey)
  const signature = getSignatureFromSignedTransactionBytes(signedBytes)
  try {
    await postHomeV2ChatText(
      input.nodeApiUrl,
      '/transactions/process?apiVersion=2',
      base58Encode(signedBytes),
      'text/plain',
      'Private-group CHAT transaction processing failed.',
      input.apiKey,
    )
    return { signature, timestamp }
  } catch (error) {
    return createHomeV2UnknownChatBroadcastResult(error, signature, timestamp)
  }
}

function qpgcMessageFailure(row: Record<string, unknown>, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  let epochId: string | null = null
  let keyId: string | null = null
  try {
    if (typeof row.data === 'string') {
      const envelope = parseQpgcEnvelope(decodeCanonicalBase64(row.data, 'Encrypted private-group data'))
      epochId = base58Encode(envelope.epochId)
      keyId = 'keyId' in envelope && envelope.keyId ? base58Encode(envelope.keyId) : null
    }
  } catch {
    // Preserve a safe MISSING_KEY/FAILED row without exposing malformed bytes.
  }
  return {
    ...row,
    data: null,
    decryptionError: message,
    epochId,
    keyId,
    status: /key is not available|no private-group key/i.test(message) ? 'MISSING_KEY' : 'FAILED',
  }
}

async function decryptHomeV2QpgcRows(input: {
  readonly accountId: string
  readonly apiKey: string
  readonly encoding: 'BASE58' | 'BASE64'
  readonly groupId: number
  readonly nodeApiUrl: string
  readonly rows: readonly unknown[]
  readonly secretKey: Uint8Array
  readonly state: HomeV2QpgcGroupState
}) {
  const results = []
  const keys = new Map<string, Awaited<ReturnType<typeof resolveHomeV2QpgcKey>>>()
  for (const value of input.rows.slice(0, 100)) {
    if (!isHomeV2AppRecord(value)) continue
    try {
      if (value.txGroupId !== input.groupId || value.isEncrypted !== true || value.isText !== true) {
        throw new Error('Private-group row is not encrypted text for the approved group.')
      }
      if (value.recipient !== null && value.recipient !== undefined && value.recipient !== '') {
        throw new Error('Private-group row unexpectedly has a recipient.')
      }
      const envelope = parseQpgcEnvelope(decodeCanonicalBase64(value.data, 'Encrypted private-group data'))
      if (envelope.type !== 'MESSAGE' || envelope.groupId !== input.groupId) {
        throw new Error('Private-group row is not a QPGC message envelope for the approved group.')
      }
      const keyIdentity = `${base58Encode(envelope.epochId)}|${base58Encode(envelope.keyId)}`
      if (!keys.has(keyIdentity)) {
        keys.set(keyIdentity, await resolveHomeV2QpgcKey({
          accountId: input.accountId,
          apiKey: input.apiKey,
          epochId: envelope.epochId,
          groupId: input.groupId,
          keyId: envelope.keyId,
          nodeApiUrl: input.nodeApiUrl,
          secretKey: input.secretKey,
          state: input.state,
        }))
      }
      const key = keys.get(keyIdentity)
      if (!key) throw new Error('Private-group key is not available in retained announcements.')
      const plaintext = await decryptQpgcMessage({ envelope, groupKey: key.groupKey })
      results.push({
        ...value,
        data: input.encoding === 'BASE58' ? base58Encode(plaintext) : encodeBase64Bytes(plaintext),
        encoding: input.encoding,
        epochId: base58Encode(envelope.epochId),
        keyId: base58Encode(envelope.keyId),
        status: 'DECRYPTED',
      })
    } catch (error) {
      results.push(qpgcMessageFailure(value, error))
    }
  }
  for (const key of keys.values()) key?.groupKey.fill(0)
  return results
}

async function readHomeV2QortalPrivateGroupChatAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  action: HomeV2PrivateGroupChatReadAction,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  const request = normalizeHomeV2PrivateGroupChatReadRequest(protocol, action, requestValue)
  if (!isAccountUnlocked(accountId)) throw createHomeV2BridgeError('The selected account is locked.', {
    action,
    code: 'ACCOUNT_LOCKED',
    network: 'qortal',
    retryable: false,
    ...(request.groupId ? { target: { kind: 'group' as const, groupId: request.groupId } } : {}),
  })
  const node = await getHomeV2ReadableNode('qortal')
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'private-group',
    groupId: request.groupId ?? 0,
    operationLabel: qpgcOperationLabel(action, 'qortal'),
    routeLabel: `${node.mode} · ${node.nodeApiUrl}`,
    targetChainLabel: 'Qortal',
  })
  const signingKey = getAccountSecretKey(accountId)
  if (signingKey.address !== profile.address) {
    signingKey.secretKey.fill(0)
    throw new Error('Selected account changed before Qortal private-group decryption.')
  }
  try {
    if (action === 'GET_PRIVATE_GROUP_CHAT_STATE') {
      const state = await readHomeV2QortalPrivateGroupState(node.nodeApiUrl, request.groupId as number)
      const isMember = state.memberAddresses.includes(profile.address)
      const key = isMember ? await resolveHomeV2QortalPrivateGroupRing({ accountId, nodeApiUrl: node.nodeApiUrl, secretKey: signingKey.secretKey, state }) : null
      return {
        available: !!key,
        exists: true,
        groupId: state.groupId,
        groupName: state.groupName,
        isMember,
        isOpen: false,
        memberCount: state.memberAddresses.length,
        publisherName: key?.publisherName ?? null,
        qortalPrivateGroupVersion: 1,
        recipientCount: key?.recipientCount ?? null,
        resourceSignature: key?.resourceSignature ?? null,
        rotationRequired: key?.recipientCount !== null && key?.recipientCount !== state.memberAddresses.length,
      }
    }
    const memberships = action === 'GET_PRIVATE_GROUP_ACTIVE_CHATS'
      ? await readHomeV2ChatJson(
          node.nodeApiUrl,
          `/groups/member/${encodeURIComponent(profile.address)}?limit=0&reverse=true`,
          'Qortal private-group membership lookup',
          '',
          PRIVATE_GROUP_CHAT_READ_RESPONSE_MAX_BYTES,
        )
      : null
    const groupIds = action === 'GET_PRIVATE_GROUP_ACTIVE_CHATS'
      ? (Array.isArray(memberships) ? memberships : []).flatMap((value) =>
          isHomeV2AppRecord(value) && value.isOpen === false && Number.isSafeInteger(Number(value.groupId))
            ? [Number(value.groupId)]
            : [],
        )
      : [request.groupId as number]
    const results: Record<string, unknown>[] = []
    for (const groupId of groupIds.slice(0, request.limit)) {
      const state = await readHomeV2QortalPrivateGroupState(node.nodeApiUrl, groupId)
      if (!state.memberAddresses.includes(profile.address)) continue
      const key = await resolveHomeV2QortalPrivateGroupRing({ accountId, nodeApiUrl: node.nodeApiUrl, secretKey: signingKey.secretKey, state })
      if (!key) {
        if (action === 'GET_PRIVATE_GROUP_ACTIVE_CHATS') results.push({ groupId, status: 'MISSING_KEY' })
        else throw createHomeV2BridgeError('No Qortal private-group key bundle is available to this account.', {
          action,
          code: 'MISSING_GROUP_KEY',
          network: 'qortal',
          retryable: false,
          target: { kind: 'group', groupId },
        })
        continue
      }
      const query = new URLSearchParams({
        encoding: 'BASE64',
        limit: action === 'GET_PRIVATE_GROUP_ACTIVE_CHATS' ? '1' : String(request.limit),
        reverse: 'true',
        txGroupId: String(groupId),
      })
      if (request.before !== undefined) query.set('before', String(request.before))
      const rows = await readHomeV2ChatJson(
        node.nodeApiUrl,
        `/chat/messages?${query.toString()}`,
        'Qortal private-group message lookup',
        '',
        PRIVATE_GROUP_CHAT_READ_RESPONSE_MAX_BYTES,
      )
      const decrypted = decryptHomeV2QortalPrivateGroupRows({
        encoding: request.encoding,
        groupId,
        keyRing: key.keyRing,
        rows: Array.isArray(rows) ? rows : [],
      })
      if (action === 'GET_PRIVATE_GROUP_ACTIVE_CHATS') results.push(decrypted[0] ?? { groupId, status: 'NO_MESSAGES' })
      else results.push(...decrypted)
    }
    const fresh = getQdnViewContextForWebContents(sender)
    const nodeNow = await getHomeV2ReadableNode('qortal').catch(() => null)
    if (!fresh || !sameViewContext(context, fresh) || !liveResourceMatchesGrant(fresh) || !isAccountUnlocked(accountId) || !nodeNow || `${nodeNow.mode}|${nodeNow.nodeApiUrl}` !== nodeRoute) {
      throw new Error('Qortal private-group read context changed before decryption completed.')
    }
    return results
  } finally {
    signingKey.secretKey.fill(0)
  }
}

async function sendHomeV2QortalPrivateGroupChatAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  action: HomeV2PrivateGroupChatWriteAction,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  const request = normalizeHomeV2PrivateGroupChatWriteRequest(protocol, action, requestValue)
  if (!isAccountUnlocked(accountId)) throw createHomeV2BridgeError('The selected account is locked.', {
    action,
    code: 'ACCOUNT_LOCKED',
    network: 'qortal',
    retryable: false,
    target: { kind: 'group', groupId: request.groupId },
  })
  const node = await getHomeV2ReadableNode('qortal')
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  const needsMemberKeys = action === 'ROTATE_PRIVATE_GROUP_CHAT_KEY' || action === 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS'
  const state = await readHomeV2QortalPrivateGroupState(node.nodeApiUrl, request.groupId, needsMemberKeys)
  if (!state.memberAddresses.includes(profile.address)) throw createHomeV2BridgeError(
    'The selected account is not a current member of this private group.',
    { action, code: 'NOT_GROUP_MEMBER', network: 'qortal', retryable: false, target: { kind: 'group', groupId: request.groupId } },
  )
  const singleRequestOnly = action === 'REQUEST_PRIVATE_GROUP_CHAT_KEY' ||
    action === 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS' ||
    action === 'ROTATE_PRIVATE_GROUP_CHAT_KEY'
  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'private-group',
    chatReference: request.chatReference,
    groupId: request.groupId,
    messagePreview: request.message?.slice(0, 180),
    operationLabel: qpgcOperationLabel(action, 'qortal'),
    routeLabel: `${node.mode} · ${node.nodeApiUrl}`,
    singleRequestOnly,
    targetChainLabel: 'Qortal',
  })
  if (!singleRequestOnly) {
    const decision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(sender, context))
    if (!decision.allowed) throw new Error(decision.message)
  }
  const approvedPublicKey = getAccountSigningPublicKey(accountId)
  const signingKey = getAccountSecretKey(accountId)
  if (signingKey.address !== profile.address || signingKey.publicKey58 !== approvedPublicKey) {
    signingKey.secretKey.fill(0)
    throw new Error('Selected account changed before Qortal private-group signing.')
  }
  const isStillValid = async () => {
    const fresh = getQdnViewContextForWebContents(sender)
    if (!fresh || !sameViewContext(context, fresh) || !liveResourceMatchesGrant(fresh) || !isAccountUnlocked(accountId)) return false
    const current = await getHomeV2ReadableNode('qortal').catch(() => null)
    return !!current && `${current.mode}|${current.nodeApiUrl}` === nodeRoute
  }
  const validateState = async () => {
    const current = await readHomeV2QortalPrivateGroupState(node.nodeApiUrl, request.groupId)
    if (
      current.memberAddresses.join('|') !== state.memberAddresses.join('|') ||
      current.adminAddresses.join('|') !== state.adminAddresses.join('|')
    ) throw new Error('Private-group membership changed before signing.')
    await validateHomeV2QortalPrivateGroupReference({
      action,
      chatReference: request.chatReference,
      groupId: request.groupId,
      nodeApiUrl: node.nodeApiUrl,
      senderPublicKey: signingKey.publicKey58,
    })
  }
  try {
    if (action === 'REQUEST_PRIVATE_GROUP_CHAT_KEY') {
      const key = await resolveHomeV2QortalPrivateGroupRing({ accountId, nodeApiUrl: node.nodeApiUrl, secretKey: signingKey.secretKey, state })
      if (!key) throw createHomeV2BridgeError('No Qortal private-group key bundle is available to this account.', {
        action,
        code: 'MISSING_GROUP_KEY',
        network: 'qortal',
        retryable: false,
        target: { kind: 'group', groupId: request.groupId },
      })
      return { accepted: true, recovered: true, resourceSignature: key.resourceSignature }
    }
    if (action === 'ROTATE_PRIVATE_GROUP_CHAT_KEY' || action === 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS') {
      if (!state.adminAddresses.includes(profile.address)) throw new Error('Only a current group administrator can publish a Qortal private-group key bundle.')
      const nameValue = await readHomeV2ChatJson(node.nodeApiUrl, `/names/primary/${encodeURIComponent(profile.address)}`, 'Qortal publisher primary-name lookup')
      const name = stringField(nameValue, 'name')
      if (!name || stringField(nameValue, 'owner') !== profile.address || !state.adminNames.includes(name)) throw new Error('The selected Qortal group administrator needs a current primary name.')
      const existing = await resolveHomeV2QortalPrivateGroupRing({ accountId, nodeApiUrl: node.nodeApiUrl, secretKey: signingKey.secretKey, state })
      let keyRing = existing?.keyRing ?? null
      if (action === 'ROTATE_PRIVATE_GROUP_CHAT_KEY' || !keyRing) {
        keyRing = appendQortalPrivateGroupKey(keyRing, new Uint8Array(randomBytes(32))).keyRing
      }
      const encryptedBundle = encryptQortalPrivateGroupBundle({
        keyRing,
        memberPublicKeys: state.memberPublicKeys ?? [],
        selectedAccountSecretKey: signingKey.secretKey,
        senderPublicKey: base58Decode(signingKey.publicKey58),
      })
      return publishHomeV2QortalPrivateGroupBundle({
        accountId,
        encryptedBundle,
        isStillValid,
        keyRing,
        name,
        nodeApiUrl: node.nodeApiUrl,
        secretKey: signingKey.secretKey,
        senderAddress: profile.address,
        senderPublicKey: base58Decode(signingKey.publicKey58),
        state,
        validateState,
      })
    }
    const key = await resolveHomeV2QortalPrivateGroupRing({ accountId, nodeApiUrl: node.nodeApiUrl, secretKey: signingKey.secretKey, state })
    if (!key) throw createHomeV2BridgeError('No Qortal private-group key bundle is available. Recover or rotate the key first.', {
      action,
      code: 'MISSING_GROUP_KEY',
      network: 'qortal',
      retryable: false,
      target: { kind: 'group', groupId: request.groupId },
    })
    const encryptedMessage = encryptQortalPrivateGroupPayload({
      keyRing: key.keyRing,
      plaintext: new TextEncoder().encode(request.message as string),
      typeNumber: action === 'SEND_PRIVATE_GROUP_CHAT_REACTION' ? 102 : 2,
    })
    const publicAction = action === 'SEND_PRIVATE_GROUP_CHAT_MESSAGE'
      ? 'SEND_CHAT_MESSAGE'
      : action === 'SEND_PRIVATE_GROUP_CHAT_EDIT'
        ? 'SEND_CHAT_EDIT'
        : action === 'SEND_PRIVATE_GROUP_CHAT_DELETE'
          ? 'SEND_CHAT_DELETE'
          : 'SEND_CHAT_REACTION'
    return sendHomeV2QortalChatMessage(
      node.nodeApiUrl,
      {
        action: publicAction,
        chatReference: request.chatReference,
        message: encryptedMessage,
        txGroupId: request.groupId,
      },
      signingKey,
      isStillValid,
      validateState,
    )
  } finally {
    signingKey.secretKey.fill(0)
  }
}

async function readHomeV2PrivateGroupChatAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  action: HomeV2PrivateGroupChatReadAction,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  const request = normalizeHomeV2PrivateGroupChatReadRequest(protocol, action, requestValue)
  if (!isAccountUnlocked(accountId)) throw createHomeV2BridgeError('The selected account is locked.', {
    action,
    code: 'ACCOUNT_LOCKED',
    network: 'qortium',
    retryable: false,
    ...(request.groupId ? { target: { kind: 'group' as const, groupId: request.groupId } } : {}),
  })
  const node = await getHomeV2ReadableNode('qortium')
  const apiKey = await getHomeV2SignedWriteApiKey('qortium', node.nodeApiUrl)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'private-group',
    groupId: request.groupId ?? 0,
    operationLabel: qpgcOperationLabel(action),
    routeLabel: `${node.mode} · ${node.nodeApiUrl}`,
    targetChainLabel: 'Qortium',
  })
  const signingKey = getAccountSecretKey(accountId)
  if (signingKey.address !== profile.address) {
    signingKey.secretKey.fill(0)
    throw new Error('Selected account changed before private-group decryption.')
  }
  try {
    if (action === 'GET_PRIVATE_GROUP_CHAT_STATE') {
      const state = await readHomeV2QpgcState(node.nodeApiUrl, request.groupId as number, apiKey)
      const key = await resolveHomeV2QpgcKey({
        accountId,
        apiKey,
        epochId: state.epochId,
        groupId: state.groupId,
        nodeApiUrl: node.nodeApiUrl,
        secretKey: signingKey.secretKey,
        state,
      })
      try {
        // Core's `available` flag describes QPGC protocol availability. This
        // separate account-relative flag tells the app whether this selected
        // wallet can actually decrypt/send in the current epoch.
        return { ...state, keyAvailable: !!key }
      } finally {
        key?.groupKey.fill(0)
      }
    }
    const groupsValue = action === 'GET_PRIVATE_GROUP_ACTIVE_CHATS'
      ? await readHomeV2ChatJson(
          node.nodeApiUrl,
          `/groups/member/${encodeURIComponent(profile.address)}?limit=${request.limit}&reverse=true`,
          'Private-group membership lookup',
          apiKey,
        )
      : null
    const groupIds = action === 'GET_PRIVATE_GROUP_ACTIVE_CHATS'
      ? (Array.isArray(groupsValue) ? groupsValue : []).flatMap((value) =>
          isHomeV2AppRecord(value) && value.isOpen === false && Number.isSafeInteger(Number(value.groupId))
            ? [Number(value.groupId)]
            : [],
        )
      : [request.groupId as number]
    const results = []
    for (const groupId of groupIds.slice(0, request.limit)) {
      const state = await readHomeV2QpgcState(node.nodeApiUrl, groupId, apiKey)
      const query = new URLSearchParams({
        encoding: 'BASE64',
        limit: action === 'GET_PRIVATE_GROUP_ACTIVE_CHATS' ? '1' : String(request.limit),
        reverse: 'true',
        txGroupId: String(groupId),
      })
      if (request.before !== undefined) query.set('before', String(request.before))
      const rows = await readHomeV2ChatJson(
        node.nodeApiUrl,
        `/chat/messages?${query.toString()}`,
        'Encrypted private-group message lookup',
        apiKey,
        PRIVATE_GROUP_CHAT_READ_RESPONSE_MAX_BYTES,
      )
      const decrypted = await decryptHomeV2QpgcRows({
        accountId,
        apiKey,
        encoding: request.encoding,
        groupId,
        nodeApiUrl: node.nodeApiUrl,
        rows: Array.isArray(rows) ? rows : [],
        secretKey: signingKey.secretKey,
        state,
      })
      if (action === 'GET_PRIVATE_GROUP_ACTIVE_CHATS') {
        results.push(decrypted[0] ?? { groupId, status: 'NO_MESSAGES' })
      } else {
        results.push(...decrypted)
      }
    }
    const freshContext = getQdnViewContextForWebContents(sender)
    const nodeNow = await getHomeV2ReadableNode('qortium').catch(() => null)
    if (
      !freshContext || !sameViewContext(context, freshContext) || !liveResourceMatchesGrant(freshContext) ||
      !isAccountUnlocked(accountId) || !nodeNow || `${nodeNow.mode}|${nodeNow.nodeApiUrl}` !== nodeRoute
    ) throw new Error('Private-group read context changed before decryption completed.')
    return results
  } finally {
    signingKey.secretKey.fill(0)
  }
}

async function sendHomeV2PrivateGroupChatAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  action: HomeV2PrivateGroupChatWriteAction,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  const request = normalizeHomeV2PrivateGroupChatWriteRequest(protocol, action, requestValue)
  if (!isAccountUnlocked(accountId)) throw createHomeV2BridgeError('The selected account is locked.', {
    action,
    code: 'ACCOUNT_LOCKED',
    network: 'qortium',
    retryable: false,
    target: { kind: 'group', groupId: request.groupId },
  })
  const node = await getHomeV2ReadableNode('qortium')
  const apiKey = await getHomeV2SignedWriteApiKey('qortium', node.nodeApiUrl)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  const state = await readHomeV2QpgcState(node.nodeApiUrl, request.groupId, apiKey)
  const publicKey58 = getAccountSigningPublicKey(accountId)
  const publicKey = base58Decode(publicKey58)
  if (!state.memberPublicKeys.some((member) => member.every((value, index) => value === publicKey[index]))) {
    throw createHomeV2BridgeError('The selected account is not a current member of this private group.', {
      action,
      code: 'NOT_GROUP_MEMBER',
      network: 'qortium',
      retryable: false,
      target: { kind: 'group', groupId: request.groupId },
    })
  }
  const singleRequestOnly = action === 'REQUEST_PRIVATE_GROUP_CHAT_KEY' ||
    action === 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS' ||
    action === 'ROTATE_PRIVATE_GROUP_CHAT_KEY'
  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'private-group',
    chatReference: request.chatReference,
    groupId: request.groupId,
    messagePreview: request.message?.slice(0, 180),
    operationLabel: qpgcOperationLabel(action),
    routeLabel: `${node.mode} · ${node.nodeApiUrl}`,
    singleRequestOnly,
    targetChainLabel: 'Qortium',
  })
  if (!singleRequestOnly) {
    const decision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(sender, context))
    if (!decision.allowed) throw new Error(decision.message)
  }
  const signingKey = getAccountSecretKey(accountId)
  if (signingKey.address !== profile.address || signingKey.publicKey58 !== publicKey58) {
    signingKey.secretKey.fill(0)
    throw new Error('Selected account changed before private-group signing.')
  }
  const isStillValid = async () => {
    const fresh = getQdnViewContextForWebContents(sender)
    if (!fresh || !sameViewContext(context, fresh) || !liveResourceMatchesGrant(fresh) || !isAccountUnlocked(accountId)) return false
    const current = await getHomeV2ReadableNode('qortium').catch(() => null)
    return !!current && `${current.mode}|${current.nodeApiUrl}` === nodeRoute
  }
  const validateState = async () => {
    const current = await readHomeV2QpgcState(node.nodeApiUrl, request.groupId, apiKey)
    if (!current.epochId.every((value, index) => value === state.epochId[index])) {
      throw new Error('Private-group membership changed before signing.')
    }
    await validateHomeV2QpgcReference({
      action,
      apiKey,
      chatReference: request.chatReference,
      groupId: request.groupId,
      nodeApiUrl: node.nodeApiUrl,
      senderPublicKey: signingKey.publicKey58,
    })
  }
  let persistedGroupKey: Uint8Array | null = null
  let automaticKeyAnnouncementSignature: string | null = null
  try {
    let envelopes: Uint8Array[] = []
    if (action === 'REQUEST_PRIVATE_GROUP_CHAT_KEY') {
      envelopes = [createQpgcKeyRequest({
        epochId: request.epochId ? base58Decode(request.epochId) : state.epochId,
        groupId: request.groupId,
        keyId: request.keyId ? base58Decode(request.keyId) : null,
        requesterSecretKey: signingKey.secretKey,
      })]
    } else if (action === 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS') {
      const requests = await readHomeV2QpgcControls({
        apiKey,
        groupId: request.groupId,
        limit: request.limit,
        nodeApiUrl: node.nodeApiUrl,
        state,
        types: ['KEY_REQUEST'],
      })
      const relayed = new Set<string>()
      for (const control of requests.controls) {
        if (control.envelope.type !== 'KEY_REQUEST') continue
        const requesterPublicKey = control.envelope.requesterPublicKey
        const announcements = await readHomeV2QpgcControls({
          apiKey,
          epochId: control.envelope.epochId,
          groupId: request.groupId,
          ...(control.envelope.keyId ? { keyId: control.envelope.keyId } : {}),
          limit: 100,
          nodeApiUrl: node.nodeApiUrl,
          state,
          types: ['KEY_ANNOUNCEMENT'],
        })
        const match = announcements.controls.find((candidate) =>
          candidate.envelope.type === 'KEY_ANNOUNCEMENT' &&
          candidate.envelope.wrappers.some((wrapper) => wrapper.recipientPublicKey.every(
            (value, index) => value === requesterPublicKey[index],
          )))
        if (match?.envelope.type === 'KEY_ANNOUNCEMENT') {
          const identity = base58Encode(match.signature)
          if (!relayed.has(identity)) {
            relayed.add(identity)
            envelopes.push(new Uint8Array(
              // Relay the exact inner announcement; its creator signature remains
              // valid while the outer CHAT is signed by the current relayer.
              serializeQpgcEnvelope(match.envelope),
            ))
          }
        }
      }
    } else if (action === 'ROTATE_PRIVATE_GROUP_CHAT_KEY') {
      persistedGroupKey = new Uint8Array(randomBytes(32))
      envelopes = [await createQpgcKeyAnnouncement({
        announcerSecretKey: signingKey.secretKey,
        epochId: state.epochId,
        groupId: request.groupId,
        groupKey: persistedGroupKey,
        memberPublicKeys: state.memberPublicKeys,
      })]
    } else {
      let key = await resolveHomeV2QpgcKey({
        accountId,
        apiKey,
        epochId: state.epochId,
        groupId: request.groupId,
        nodeApiUrl: node.nodeApiUrl,
        secretKey: signingKey.secretKey,
        state,
      })
      if (!key) {
        persistedGroupKey = new Uint8Array(randomBytes(32))
        const keyId = await computeQpgcKeyId(request.groupId, state.epochId, persistedGroupKey)
        const announcementResult = await sendHomeV2QpgcEnvelope({
          apiKey,
          chatReference: null,
          envelope: await createQpgcKeyAnnouncement({
            announcerSecretKey: signingKey.secretKey,
            epochId: state.epochId,
            groupId: request.groupId,
            groupKey: persistedGroupKey,
            memberPublicKeys: state.memberPublicKeys,
          }),
          groupId: request.groupId,
          isStillValid,
          nodeApiUrl: node.nodeApiUrl,
          signingKey,
          validateTarget: validateState,
        })
        if (!isQpgcBroadcastConfirmed(announcementResult)) {
          return createQpgcAutomaticKeySetupUnknownResult(announcementResult)
        }
        automaticKeyAnnouncementSignature = announcementResult.signature
        try {
          await persistQpgcKey({
            accountId,
            epochId: state.epochId,
            groupId: request.groupId,
            groupKey: persistedGroupKey,
            keyId,
            secretKey: signingKey.secretKey,
          })
        } catch (error) {
          console.warn('[home-v2-app] Unable to cache an automatically announced private-group key:', error)
        }
        key = {
          epochId: new Uint8Array(state.epochId),
          groupKey: new Uint8Array(persistedGroupKey),
          keyId: new Uint8Array(keyId),
        }
      }
      try {
        envelopes = [await encryptQpgcMessage({
          epochId: key.epochId,
          groupId: request.groupId,
          groupKey: key.groupKey,
          keyId: key.keyId,
          nonce: new Uint8Array(randomBytes(12)),
          plaintext: new TextEncoder().encode(request.message as string),
        })]
      } finally {
        key.groupKey.fill(0)
      }
    }
    if (envelopes.length === 0) return { accepted: true, relayed: 0 }
    const results = []
    for (const envelope of envelopes.slice(0, request.limit)) {
      results.push(await sendHomeV2QpgcEnvelope({
        apiKey,
        chatReference: request.chatReference,
        envelope,
        groupId: request.groupId,
        isStillValid,
        nodeApiUrl: node.nodeApiUrl,
        signingKey,
        validateTarget: validateState,
      }))
    }
    const broadcastConfirmed = results.every(isQpgcBroadcastConfirmed)
    if (persistedGroupKey && !automaticKeyAnnouncementSignature && broadcastConfirmed) {
      const keyId = await computeQpgcKeyId(request.groupId, state.epochId, persistedGroupKey)
      await persistQpgcKey({
        accountId,
        epochId: state.epochId,
        groupId: request.groupId,
        groupKey: persistedGroupKey,
        keyId,
        secretKey: signingKey.secretKey,
      })
    }
    const result = results.length === 1 ? results[0] : { accepted: true, relayed: results.length, results }
    return automaticKeyAnnouncementSignature && isHomeV2AppRecord(result)
      ? Object.freeze({
          ...result,
          keyAnnouncementSignature: automaticKeyAnnouncementSignature,
          keyBootstrapped: true,
        })
      : result
  } finally {
    persistedGroupKey?.fill(0)
    signingKey.secretKey.fill(0)
  }
}

function membershipOperationLabel(action: HomeV2GroupMembershipAction) {
  return action === 'JOIN_GROUP' ? 'Join group' : 'Leave group'
}

function parseMempowFeeAlternativeDifficulty(value: unknown) {
  if (
    !isHomeV2AppRecord(value) ||
    !Number.isInteger(value.mempowFeeAlternativeDifficulty) ||
    (value.mempowFeeAlternativeDifficulty as number) < 1 ||
    (value.mempowFeeAlternativeDifficulty as number) > 31
  ) {
    throw createHomeV2BridgeError(
      'The selected Qortium node does not advertise a compatible MemoryPoW fee difficulty.',
      {
        action: 'GROUP_MEMBERSHIP',
        code: 'NODE_CAPABILITY_MISSING',
        network: 'qortium',
        retryable: false,
      },
    )
  }
  return value.mempowFeeAlternativeDifficulty as number
}

async function readHomeV2GroupTarget(
  nodeApiUrl: string,
  network: HomeV2AppNetwork,
  groupId: number,
  apiKey = '',
) {
  return normalizeHomeV2GroupMembershipTarget(
    await readHomeV2ChatJson(
      nodeApiUrl,
      `/groups/${encodeURIComponent(String(groupId))}`,
      'Group lookup',
      apiKey,
    ),
    groupId,
    network,
  )
}

function idempotentGroupResult(
  action: HomeV2GroupMembershipAction,
  error: unknown,
  network: HomeV2AppNetwork,
  target: HomeV2GroupMembershipTarget,
) {
  const membership = groupMembershipIdempotentState(action, error)
  return membership
    ? createHomeV2GroupMembershipSuccess({
        action,
        changed: false,
        groupId: target.groupId,
        groupName: target.groupName,
        membership,
        network,
      })
    : null
}

function groupBuilderUnavailable(error: unknown) {
  return isHomeV2AppRecord(error) && (error.status === 403 || error.status === 404)
}

async function sendHomeV2QortiumGroupMembership(
  nodeApiUrl: string,
  request: HomeV2GroupMembershipRequest,
  target: HomeV2GroupMembershipTarget,
  signingKey: HomeV2ChatSigningKey,
  isStillValid: () => boolean | Promise<boolean>,
  validateTarget: () => Promise<void>,
  apiKey: string,
) {
  const timestamp = Date.now()
  const buildBody = JSON.stringify({
    fee: 0,
    groupId: request.groupId,
    [request.action === 'JOIN_GROUP' ? 'joinerPublicKey' : 'leaverPublicKey']: signingKey.publicKey58,
    timestamp,
    txGroupId: 0,
  })
  let unsignedText: string
  try {
    unsignedText = await postHomeV2ChatText(
      nodeApiUrl,
      request.action === 'JOIN_GROUP' ? '/groups/public/join' : '/groups/public/leave',
      buildBody,
      'application/json',
      `${membershipOperationLabel(request.action)} transaction build failed.`,
      apiKey,
    )
  } catch (error) {
    const idempotent = idempotentGroupResult(request.action, error, 'qortium', target)
    if (idempotent) return idempotent
    if (groupBuilderUnavailable(error)) {
      throw createHomeV2BridgeError(
        'The selected Qortium node does not expose the public group-membership builder.',
        {
          action: request.action,
          code: 'NODE_CAPABILITY_MISSING',
          network: 'qortium',
          retryable: false,
          target: { groupId: request.groupId, kind: 'group' },
        },
      )
    }
    throw error
  }
  const unsignedBytes = base58Decode(unsignedText)
  const expected = {
    groupId: request.groupId,
    publicKey: base58Decode(signingKey.publicKey58),
    timestamp,
    txGroupId: 0,
  }
  if (request.action === 'JOIN_GROUP') {
    // Deliberately omit the optional mintingPublicKey: group membership must
    // not silently create minting authority. Home exposes minting as a
    // separate explicit operation.
    assertPublicJoinGroupTransaction(unsignedBytes, expected)
  } else {
    assertPublicLeaveGroupTransaction(unsignedBytes, expected)
  }
  let difficulty: number
  try {
    difficulty = parseMempowFeeAlternativeDifficulty(await readHomeV2ChatJson(
      nodeApiUrl,
      '/polls/public/capabilities',
      'MemoryPoW capability lookup',
      apiKey,
    ))
  } catch (error) {
    if (groupBuilderUnavailable(error)) {
      throw createHomeV2BridgeError(
        'The selected Qortium node does not expose the MemoryPoW capability needed for group membership.',
        {
          action: request.action,
          code: 'NODE_CAPABILITY_MISSING',
          network: 'qortium',
          retryable: false,
          target: { groupId: request.groupId, kind: 'group' },
        },
      )
    }
    throw error
  }
  const nonce = await computeHomeV2ChatNonce(unsignedBytes, difficulty, isStillValid)
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  await validateTarget()
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  const signedBytes = signTransactionWithNonce(unsignedBytes, nonce, signingKey.secretKey)
  const signature = getSignatureFromSignedTransactionBytes(signedBytes)
  try {
    await postHomeV2ChatText(
      nodeApiUrl,
      '/transactions/process?apiVersion=2',
      base58Encode(signedBytes),
      'text/plain',
      `${membershipOperationLabel(request.action)} transaction processing failed.`,
      apiKey,
    )
    return createHomeV2GroupMembershipSuccess({
      action: request.action,
      changed: true,
      groupId: request.groupId,
      groupName: target.groupName,
      membership: request.action === 'JOIN_GROUP' && !target.isOpen ? 'requested' : undefined,
      network: 'qortium',
      signature,
      timestamp,
    })
  } catch (error) {
    const idempotent = idempotentGroupResult(request.action, error, 'qortium', target)
    if (idempotent) return idempotent
    return createHomeV2UnknownGroupMembershipBroadcastResult({
      action: request.action,
      error,
      groupId: request.groupId,
      groupName: target.groupName,
      network: 'qortium',
      signedBytes,
      timestamp,
    })
  }
}

async function sendHomeV2QortalGroupMembership(
  nodeApiUrl: string,
  request: HomeV2GroupMembershipRequest,
  target: HomeV2GroupMembershipTarget,
  signingKey: HomeV2ChatSigningKey,
  isStillValid: () => boolean | Promise<boolean>,
  validateTarget: () => Promise<void>,
) {
  const feeType = qortalGroupMembershipFeeType(request.action)
  const [feeValue, lastReferenceValue] = await Promise.all([
    readHomeV2ChatJson(
      nodeApiUrl,
      `/transactions/unitfee?txType=${encodeURIComponent(feeType)}`,
      'Qortal group transaction fee lookup',
    ),
    readHomeV2ChatJson(
      nodeApiUrl,
      `/addresses/lastreference/${encodeURIComponent(signingKey.address)}`,
      'Qortal last-reference lookup',
    ),
  ])
  const feeAtomic = normalizeQortalGroupMembershipFee(feeValue)
  const lastReference = typeof lastReferenceValue === 'string'
    ? lastReferenceValue.trim()
    : ''
  if (!lastReference) {
    throw new Error('The selected Qortal account does not have a last reference. It may need QORT before it can join or leave groups.')
  }
  const timestamp = Date.now()
  const unsignedBytes = buildUnsignedQortalGroupMembershipTransactionBytes({
    action: request.action,
    feeAtomic,
    groupId: request.groupId,
    lastReference,
    senderPublicKey: signingKey.publicKey58,
    timestamp,
  })
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  await validateTarget()
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  const [freshFeeValue, freshReferenceValue] = await Promise.all([
    readHomeV2ChatJson(
      nodeApiUrl,
      `/transactions/unitfee?txType=${encodeURIComponent(feeType)}`,
      'Qortal group transaction fee recheck',
    ),
    readHomeV2ChatJson(
      nodeApiUrl,
      `/addresses/lastreference/${encodeURIComponent(signingKey.address)}`,
      'Qortal last-reference recheck',
    ),
  ])
  if (
    normalizeQortalGroupMembershipFee(freshFeeValue) !== feeAtomic ||
    typeof freshReferenceValue !== 'string' ||
    freshReferenceValue.trim() !== lastReference
  ) {
    throw new Error('The Qortal fee or account reference changed before signing. Please try the group action again.')
  }
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  const signatureBytes = signDetached(unsignedBytes, signingKey.secretKey)
  const signedBytes = appendHomeV2GroupMembershipSignature(unsignedBytes, signatureBytes)
  const signature = getSignatureFromSignedTransactionBytes(signedBytes)
  try {
    await postHomeV2ChatText(
      nodeApiUrl,
      '/transactions/process?apiVersion=2',
      encodeHomeV2GroupMembershipTransaction(signedBytes),
      'text/plain',
      `Qortal ${membershipOperationLabel(request.action).toLowerCase()} broadcast failed.`,
    )
    return createHomeV2GroupMembershipSuccess({
      action: request.action,
      changed: true,
      groupId: request.groupId,
      groupName: target.groupName,
      membership: request.action === 'JOIN_GROUP' && !target.isOpen ? 'requested' : undefined,
      network: 'qortal',
      signature,
      timestamp,
    })
  } catch (error) {
    const idempotent = idempotentGroupResult(request.action, error, 'qortal', target)
    if (idempotent) return idempotent
    return createHomeV2UnknownGroupMembershipBroadcastResult({
      action: request.action,
      error,
      groupId: request.groupId,
      groupName: target.groupName,
      network: 'qortal',
      signedBytes,
      timestamp,
    })
  }
}

async function readHomeV2GroupAdminTarget(
  nodeApiUrl: string,
  network: HomeV2AppNetwork,
  request: HomeV2GroupAdminRequest,
  apiKey = '',
) {
  const [groupValue, adminValue, joinRequestsValue] = await Promise.all([
    readHomeV2ChatJson(
      nodeApiUrl,
      `/groups/${encodeURIComponent(String(request.groupId))}`,
      'Group lookup',
      apiKey,
    ),
    readHomeV2ChatJson(
      nodeApiUrl,
      `/groups/members/${encodeURIComponent(String(request.groupId))}?onlyAdmins=true&limit=0`,
      'Group administrator lookup',
      apiKey,
    ),
    request.action === 'APPROVE_GROUP_JOIN_REQUEST'
      ? readHomeV2ChatJson(
          nodeApiUrl,
          `/groups/joinrequests/${encodeURIComponent(String(request.groupId))}`,
          'Group join-request lookup',
          apiKey,
        )
      : Promise.resolve(null),
  ])
  return Object.freeze({
    adminAddresses: normalizeHomeV2GroupAdminAddresses(adminValue),
    hasJoinRequest: request.action === 'APPROVE_GROUP_JOIN_REQUEST'
      ? hasHomeV2GroupJoinRequest(joinRequestsValue, request.groupId, request.memberAddress)
      : null,
    target: normalizeHomeV2GroupAdminTarget(groupValue, request.groupId, network),
  })
}

function assertHomeV2GroupAdminIntent(
  accountAddress: string,
  request: HomeV2GroupAdminRequest,
  target: HomeV2GroupAdminTarget,
  adminAddresses: readonly string[],
  hasJoinRequest: boolean | null,
) {
  assertHomeV2GroupAdminAuthority({ accountAddress, action: request.action, adminAddresses, target })
  if (request.action === 'APPROVE_GROUP_JOIN_REQUEST' && hasJoinRequest !== true) {
    throw new Error('The selected account does not have a current join request for this group.')
  }
  if (
    request.memberAddress === target.ownerAddress &&
    (request.action === 'REMOVE_GROUP_ADMIN' || request.action === 'GROUP_BAN' || request.action === 'GROUP_KICK')
  ) {
    throw new Error('The group owner cannot be removed, banned, or kicked.')
  }
}

function idempotentGroupAdminResult(
  request: HomeV2GroupAdminRequest,
  error: unknown,
  network: HomeV2AppNetwork,
  target: HomeV2GroupAdminTarget,
) {
  return groupAdminIdempotentResult(request.action, error)
    ? createHomeV2GroupAdminSuccess({ changed: false, network, request, target })
    : null
}

async function sendHomeV2QortiumGroupAdmin(
  nodeApiUrl: string,
  request: HomeV2GroupAdminRequest,
  target: HomeV2GroupAdminTarget,
  signingKey: HomeV2ChatSigningKey,
  isStillValid: () => boolean | Promise<boolean>,
  validateTarget: () => Promise<void>,
  apiKey: string,
) {
  const timestamp = Date.now()
  const unsignedBytes = buildUnsignedQortiumGroupAdminTransactionBytes({
    request,
    senderPublicKey: signingKey.publicKey58,
    timestamp,
  })
  assertUnsignedHomeV2GroupAdminTransaction(unsignedBytes, {
    feeAtomic: 0n,
    network: 'qortium',
    request,
    senderPublicKey: signingKey.publicKey58,
    timestamp,
  })
  let difficulty: number
  try {
    difficulty = parseMempowFeeAlternativeDifficulty(await readHomeV2ChatJson(
      nodeApiUrl,
      '/polls/public/capabilities',
      'MemoryPoW capability lookup',
      apiKey,
    ))
  } catch (error) {
    if (groupBuilderUnavailable(error)) {
      throw createHomeV2BridgeError(
        'The selected Qortium node does not expose the MemoryPoW capability needed for group administration.',
        {
          action: request.action,
          code: 'NODE_CAPABILITY_MISSING',
          network: 'qortium',
          retryable: false,
          target: { groupId: request.groupId, kind: 'group' },
        },
      )
    }
    throw error
  }
  const nonce = await computeHomeV2ChatNonce(unsignedBytes, difficulty, isStillValid)
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  await validateTarget()
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  const stampedBytes = stampTransactionNonce(unsignedBytes, nonce)
  assertUnsignedHomeV2GroupAdminTransaction(stampedBytes, {
    feeAtomic: 0n,
    network: 'qortium',
    nonce,
    request,
    senderPublicKey: signingKey.publicKey58,
    timestamp,
  })
  const signedBytes = appendHomeV2GroupAdminSignature(
    stampedBytes,
    signDetached(stampedBytes, signingKey.secretKey),
  )
  const signature = getSignatureFromSignedTransactionBytes(signedBytes)
  try {
    await postHomeV2ChatText(
      nodeApiUrl,
      '/transactions/process?apiVersion=2',
      base58Encode(signedBytes),
      'text/plain',
      `${homeV2GroupAdminOperationLabel(request.action)} transaction processing failed.`,
      apiKey,
    )
    return createHomeV2GroupAdminSuccess({ changed: true, network: 'qortium', request, signature, target, timestamp })
  } catch (error) {
    const idempotent = idempotentGroupAdminResult(request, error, 'qortium', target)
    if (idempotent) return idempotent
    return createHomeV2UnknownGroupAdminBroadcastResult({ error, network: 'qortium', request, signedBytes, target, timestamp })
  }
}

async function sendHomeV2QortalGroupAdmin(
  nodeApiUrl: string,
  request: HomeV2GroupAdminRequest,
  target: HomeV2GroupAdminTarget,
  signingKey: HomeV2ChatSigningKey,
  isStillValid: () => boolean | Promise<boolean>,
  validateTarget: () => Promise<void>,
) {
  const feeType = qortalGroupAdminFeeType(request)
  const [feeValue, lastReferenceValue] = await Promise.all([
    readHomeV2ChatJson(nodeApiUrl, `/transactions/unitfee?txType=${encodeURIComponent(feeType)}`, 'Qortal group transaction fee lookup'),
    readHomeV2ChatJson(nodeApiUrl, `/addresses/lastreference/${encodeURIComponent(signingKey.address)}`, 'Qortal last-reference lookup'),
  ])
  const feeAtomic = normalizeHomeV2GroupAdminFee(feeValue)
  const lastReference = typeof lastReferenceValue === 'string' ? lastReferenceValue.trim() : ''
  if (!lastReference) {
    throw new Error('The selected Qortal account does not have a last reference. It may need QORT before it can administer groups.')
  }
  const timestamp = Date.now()
  const unsignedBytes = buildUnsignedQortalGroupAdminTransactionBytes({
    feeAtomic,
    lastReference,
    request,
    senderPublicKey: signingKey.publicKey58,
    timestamp,
  })
  assertUnsignedHomeV2GroupAdminTransaction(unsignedBytes, {
    feeAtomic,
    lastReference,
    network: 'qortal',
    request,
    senderPublicKey: signingKey.publicKey58,
    timestamp,
  })
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  await validateTarget()
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  const [freshFeeValue, freshReferenceValue] = await Promise.all([
    readHomeV2ChatJson(nodeApiUrl, `/transactions/unitfee?txType=${encodeURIComponent(feeType)}`, 'Qortal group transaction fee recheck'),
    readHomeV2ChatJson(nodeApiUrl, `/addresses/lastreference/${encodeURIComponent(signingKey.address)}`, 'Qortal last-reference recheck'),
  ])
  if (
    normalizeHomeV2GroupAdminFee(freshFeeValue) !== feeAtomic ||
    typeof freshReferenceValue !== 'string' ||
    freshReferenceValue.trim() !== lastReference
  ) {
    throw new Error('The Qortal fee or account reference changed before signing. Please try the group action again.')
  }
  if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
  const signedBytes = appendHomeV2GroupAdminSignature(unsignedBytes, signDetached(unsignedBytes, signingKey.secretKey))
  const signature = getSignatureFromSignedTransactionBytes(signedBytes)
  try {
    await postHomeV2ChatText(
      nodeApiUrl,
      '/transactions/process?apiVersion=2',
      encodeHomeV2GroupAdminTransaction(signedBytes),
      'text/plain',
      `Qortal ${homeV2GroupAdminOperationLabel(request.action).toLowerCase()} broadcast failed.`,
    )
    return createHomeV2GroupAdminSuccess({ changed: true, network: 'qortal', request, signature, target, timestamp })
  } catch (error) {
    const idempotent = idempotentGroupAdminResult(request, error, 'qortal', target)
    if (idempotent) return idempotent
    return createHomeV2UnknownGroupAdminBroadcastResult({ error, network: 'qortal', request, signedBytes, target, timestamp })
  }
}

async function sendHomeV2GroupAdminAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  action: HomeV2GroupAdminAction,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  const request = normalizeHomeV2GroupAdminRequest(action, requestValue)
  if (!isAccountUnlocked(accountId)) throw new Error('The selected account is locked.')
  const node = await getHomeV2ReadableNode(network)
  const nodeApiKey = await getHomeV2SignedWriteApiKey(network, node.nodeApiUrl)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  const initial = await readHomeV2GroupAdminTarget(node.nodeApiUrl, network, request, nodeApiKey)
  assertHomeV2GroupAdminIntent(profile.address, request, initial.target, initial.adminAddresses, initial.hasJoinRequest)
  const targetChainLabel = network === 'qortal' ? 'Qortal' : 'Qortium'
  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'group',
    groupId: request.groupId,
    groupName: initial.target.groupName,
    memberAddress: request.memberAddress,
    operationLabel: homeV2GroupAdminOperationLabel(action),
    reason: request.reason,
    routeLabel: `${node.mode} · ${node.nodeApiUrl}`,
    singleRequestOnly: true,
    targetChainLabel,
    timeToLive: request.action === 'APPROVE_GROUP_JOIN_REQUEST' ||
      request.action === 'INVITE_TO_GROUP' ||
      request.action === 'GROUP_BAN'
      ? request.timeToLive
      : undefined,
  })
  const rateLimitDecision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(sender, context))
  if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
  const signingKey = getAccountSecretKey(accountId)
  if (signingKey.address !== profile.address) {
    signingKey.secretKey.fill(0)
    throw new Error('Selected account signing key changed before the group action could be signed.')
  }
  const isStillValid = async () => {
    const freshContext = getQdnViewContextForWebContents(sender)
    if (!freshContext || !sameViewContext(context, freshContext)) return false
    if (!liveResourceMatchesGrant(freshContext) || !isAccountUnlocked(accountId)) return false
    const nodeNow = await getHomeV2ReadableNode(network).catch(() => null)
    return !!nodeNow &&
      `${nodeNow.mode}|${nodeNow.nodeApiUrl}` === nodeRoute &&
      (await getHomeV2SignedWriteApiKey(network, node.nodeApiUrl).catch(() => null)) === nodeApiKey
  }
  const validateTarget = async () => {
    const current = await readHomeV2GroupAdminTarget(node.nodeApiUrl, network, request, nodeApiKey)
    if (
      current.target.groupName !== initial.target.groupName ||
      current.target.ownerAddress !== initial.target.ownerAddress
    ) {
      throw new Error('The selected group changed before the group action could be signed.')
    }
    assertHomeV2GroupAdminIntent(profile.address, request, current.target, current.adminAddresses, current.hasJoinRequest)
  }
  try {
    if (!(await isStillValid())) throw new Error('Account access context changed before approval completed.')
    return await (network === 'qortium'
      ? sendHomeV2QortiumGroupAdmin(node.nodeApiUrl, request, initial.target, signingKey, isStillValid, validateTarget, nodeApiKey)
      : sendHomeV2QortalGroupAdmin(node.nodeApiUrl, request, initial.target, signingKey, isStillValid, validateTarget))
  } finally {
    signingKey.secretKey.fill(0)
  }
}

async function sendHomeV2GroupMembershipAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  action: HomeV2GroupMembershipAction,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  const request = normalizeHomeV2GroupMembershipRequest(action, requestValue)
  if (!isAccountUnlocked(accountId)) throw new Error('The selected account is locked.')
  const node = await getHomeV2ReadableNode(network)
  const nodeApiKey = await getHomeV2SignedWriteApiKey(network, node.nodeApiUrl)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  const target = await readHomeV2GroupTarget(node.nodeApiUrl, network, request.groupId, nodeApiKey)
  const targetChainLabel = network === 'qortal' ? 'Qortal' : 'Qortium'
  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'group',
    groupId: request.groupId,
    groupName: target.groupName,
    operationLabel: membershipOperationLabel(action),
    routeLabel: `${node.mode} · ${node.nodeApiUrl}`,
    targetChainLabel,
  })
  const rateLimitDecision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(sender, context))
  if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
  const signingKey = getAccountSecretKey(accountId)
  if (signingKey.address !== profile.address) {
    signingKey.secretKey.fill(0)
    throw new Error('Selected account signing key changed before the group action could be signed.')
  }
  const isStillValid = async () => {
    const freshContext = getQdnViewContextForWebContents(sender)
    if (!freshContext || !sameViewContext(context, freshContext)) return false
    if (!liveResourceMatchesGrant(freshContext) || !isAccountUnlocked(accountId)) return false
    const nodeNow = await getHomeV2ReadableNode(network).catch(() => null)
    return !!nodeNow &&
      `${nodeNow.mode}|${nodeNow.nodeApiUrl}` === nodeRoute &&
      (await getHomeV2SignedWriteApiKey(network, node.nodeApiUrl).catch(() => null)) === nodeApiKey
  }
  const validateTarget = async () => {
    const currentTarget = await readHomeV2GroupTarget(
      node.nodeApiUrl,
      network,
      request.groupId,
      nodeApiKey,
    )
    if (
      currentTarget.groupName !== target.groupName ||
      currentTarget.isOpen !== target.isOpen
    ) {
      throw new Error('The selected group changed before the group action could be signed.')
    }
  }
  try {
    if (!(await isStillValid())) throw new Error('Account access context changed before approval completed.')
    return await (network === 'qortium'
      ? sendHomeV2QortiumGroupMembership(node.nodeApiUrl, request, target, signingKey, isStillValid, validateTarget, nodeApiKey)
      : sendHomeV2QortalGroupMembership(node.nodeApiUrl, request, target, signingKey, isStillValid, validateTarget))
  } finally {
    signingKey.secretKey.fill(0)
  }
}

// ---------------------------------------------------------------------------
// Minting (R3-11)
//
// Ported from the Home 1.x implementation in electron/qdn.ts. The shape of the
// answers and the on-chain steps are the same; what changed is that every
// derivation now runs through the pure helpers in home-v2-minting.ts, the
// node-side half is restricted to a trusted LOCAL Core (1.x only excluded
// public nodes), and the REWARD_SHARE authorization is signed in this process
// instead of being handed to the node's /transactions/sign endpoint.
//
// No path here is built from app input, the node paths below are constants,
// and no app-supplied value ever reaches the node: the key REMOVE_MINTING_ACCOUNT
// deletes is resolved here from the node's own list, and a caller-sent key is
// only compared against it, never forwarded. The public reward-share reads are
// keyless; the API key travels only to the administered node's admin
// endpoints (Home's own Core, or the custom node the user attached a key to).
// ---------------------------------------------------------------------------

const MINTING_ACCOUNTS_PATH = '/admin/mintingaccounts'

/**
 * Error surface for the node calls that carry key material.
 *
 * Core echoes request context into its error bodies, and these particular
 * requests have an account private key, a derived minting private key, or an
 * administrative API key in them — so the node's body must never reach the
 * app, and must not be written to a log either. The app gets the operation
 * name and the HTTP status; nothing else survives.
 */
function scrubbedHomeV2MintingError(operation: string, error: unknown) {
  const status = isHomeV2AppRecord(error) && typeof error.status === 'number'
    ? error.status
    : null
  console.warn(
    `[home-v2-app] ${operation} failed${status === null ? '' : ` with HTTP ${status}`}.`,
  )
  return Object.assign(
    new Error(status === null ? `${operation} failed.` : `${operation} failed (HTTP ${status}).`),
    status === null ? {} : { status },
  )
}

// Every secret-bearing POST in this section goes through here, never through
// postHomeV2ChatText directly.
async function postHomeV2MintingText(
  nodeApiUrl: string,
  path: string,
  body: string,
  contentType: string,
  operation: string,
  apiKey: string,
) {
  try {
    return await postHomeV2ChatText(nodeApiUrl, path, body, contentType, operation, apiKey)
  } catch (error) {
    throw scrubbedHomeV2MintingError(operation, error)
  }
}

// The key is always one Home resolved from the node's own list, never a value
// the app supplied — see resolveHomeV2SelfMintingPublicKey.
async function deleteHomeV2MintingKey(
  nodeApiUrl: string,
  publicKey: string,
  apiKey: string,
) {
  const operation = 'Removing the minting key from the node'
  let result: Awaited<ReturnType<typeof readBoundedResponse>>
  try {
    const response = await nodeFetch(`${nodeApiUrl}${MINTING_ACCOUNTS_PATH}`, {
      method: 'DELETE',
      // Key-bearing DELETE: same redirect refusal as every other
      // authenticated call. (List-family review follow-up, 2026-08-26.)
      redirect: 'error',
      headers: {
        'Content-Type': 'text/plain',
        ...(apiKey ? { 'X-API-KEY': apiKey } : {}),
      },
      body: publicKey,
      signal: AbortSignal.timeout(CHAT_WRITE_TIMEOUT_MS),
    })
    result = await readBoundedResponse(response, 'GET', CHAT_SIGNING_RESPONSE_MAX_BYTES)
  } catch (error) {
    throw scrubbedHomeV2MintingError(operation, error)
  }
  if (!result.ok) throw scrubbedHomeV2MintingError(operation, { status: result.status })
  return result.body.trim()
}

/**
 * The administrative-trust resolver for the families that administer a NODE
 * (lists, minting, later node settings) — as opposed to the signing families,
 * which administer nothing and work against any node.
 *
 * Trust comes from Home's own managed Core OR from a key the user attached to
 * their own custom node (see home-v2-admin-trust). It is deliberately NOT
 * derived from `getHomeV2SignedWriteApiKey`, whose callers are ordinary
 * signed writes that must never inherit administrative authority.
 */
async function resolveHomeV2AdminNode(network: HomeV2AppNetwork) {
  const node = await getHomeV2ReadableNode(network)
  const managedApiKey = node.mode === 'local'
    ? await getHomeV2SignedWriteApiKey(network, node.nodeApiUrl)
    : ''
  const trust = evaluateHomeV2AdminTrust({
    attached: network === 'qortium' ? getHomeV2NodeAdminKey(network) : null,
    managedApiKey,
    mode: node.mode,
    network,
    nodeApiUrl: node.nodeApiUrl,
  })
  return {
    apiKey: trust.trusted ? trust.apiKey : '',
    node,
    nodeRoute: `${node.mode}|${node.nodeApiUrl}`,
    trust,
    trusted: trust.trusted,
  }
}

function foreignWalletCrypto() {
  return {
    ripemd160: (data: Uint8Array) => Uint8Array.from(createHash('ripemd160').update(data).digest()),
    sha256: (data: Uint8Array) => Uint8Array.from(createHash('sha256').update(data).digest()),
    sha512: (data: Uint8Array) => Uint8Array.from(createHash('sha512').update(data).digest()),
  }
}

function assertHomeV2TrustedForeignWalletNode(
  action: string,
  trust: HomeV2AdminTrust,
): asserts trust is Extract<HomeV2AdminTrust, { readonly trusted: true }> {
  if (trust.trusted) return
  throw createHomeV2BridgeError(
    homeV2AdminTrustMessage(trust.reason, 'Using a foreign wallet'),
    {
      action,
      code: 'NODE_CAPABILITY_MISSING',
      network: 'qortium',
      retryable: false,
    },
  )
}

async function postHomeV2TrustedForeignWallet(
  nodeApiUrl: string,
  apiKey: string,
  pathname: string,
  body: string,
  contentType: 'application/json' | 'text/plain',
  // The ordinary authenticated-read ceiling. The spend context is the one
  // caller that legitimately needs more: Core hex-encodes up to 8 MiB of
  // funding transactions into it, so it passes its own bound rather than
  // widening this default for every other foreign-wallet call.
  maxBytes = 2 * 1024 * 1024,
) {
  const response = await nodeFetch(`${nodeApiUrl}${pathname}`, {
    body,
    headers: {
      'Content-Type': contentType,
      'X-API-KEY': apiKey,
    },
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  })
  const result = await readBoundedResponse(response, 'POST', maxBytes)
  if (!result.ok) {
    const coreError = isHomeV2AppRecord(result.data) && typeof result.data.error === 'number'
      ? { error: result.data.error }
      : null
    throw Object.assign(
      new Error(coreError
        ? JSON.stringify(coreError)
        : `Foreign wallet request returned HTTP ${result.status}.`),
      { status: result.status },
    )
  }
  return result.data
}

/**
 * The foreign arm of `SEND_COIN`.
 *
 * Deliberately NOT part of `handleHomeV2PaymentAction`'s machinery: it takes
 * neither the native per-account payment lock (the per-WALLET foreign lock is
 * the right granularity, and it is taken inside the orchestrator) nor the
 * native journal fail-closed gate (a foreign ambiguity belongs in the foreign
 * journal, and must never block native payments or be blocked by them). It
 * keeps every gate that DOES apply: qdnRequest on Qortium, a selected and
 * unlocked account, an administratively trusted Core, and a route pinned for
 * the whole operation.
 */
/**
 * Whether the SELECTED Core actually implements the Home-signed send route.
 *
 * Administrative trust says the node will answer authenticated calls; it does
 * not say the node is new enough to have
 * `/crosschain/<coin>/wallet/public/spend-context`. An older trusted Core
 * would otherwise be advertised as HOME_LOCAL and then 404 at send time,
 * which is exactly the "capability that lies" case.
 *
 * The probe posts a deliberately INVALID body: a Core that has the route
 * rejects it with a validation error, a Core that lacks it answers 404. Only
 * 404 (or 405, the same absence reported differently) counts as unsupported;
 * only an affirmative validation-style 4xx counts as supported; everything
 * else (transport failure, 5xx, auth/rate-limit statuses, an unexpected 2xx)
 * is inconclusive: send is NOT advertised and the answer is cached only
 * briefly so a momentary blip recovers on the next read.
 */
const homeV2ForeignSendRouteProbes = createForeignWalletRouteProbeCache()

async function probeHomeV2ForeignSendRouteSupported(
  nodeApiUrl: string,
  apiKey: string,
  revision: string,
) {
  const key = `${nodeApiUrl}|${revision}`
  const now = Date.now()
  const cached = homeV2ForeignSendRouteProbes.read(key, now)
  if (cached) return cached === 'supported'
  let outcome: ReturnType<typeof classifyForeignWalletRouteProbe>
  try {
    await postHomeV2TrustedForeignWallet(
      nodeApiUrl,
      apiKey,
      '/crosschain/btc/wallet/public/spend-context',
      JSON.stringify({ expectedChainId: '', xpub58: '' }),
      'application/json',
      64 * 1024,
    )
    // The route should have rejected that body. A success answer is not
    // evidence it exists; something else replied.
    outcome = classifyForeignWalletRouteProbe({ ok: true, status: 200 })
  } catch (error) {
    outcome = classifyForeignWalletRouteProbe({ ok: false, status: (error as { status?: unknown }).status })
  }
  homeV2ForeignSendRouteProbes.write(key, outcome, now)
  return outcome === 'supported'
}

async function handleHomeV2ForeignSendAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  routeRevision: string,
  requestValue: Record<string, unknown>,
) {
  const action = 'SEND_COIN'
  const accountId = context.accountId
  if (!accountId) throw new Error('No account is selected for this tab.')
  const pinned = await resolveHomeV2AdminNode('qortium')
  assertHomeV2TrustedForeignWalletNode(action, pinned.trust)
  const pinnedRevision = pinned.trust.revision
  const nodeApiUrl = pinned.node.nodeApiUrl
  const nodeRoute = pinned.nodeRoute
  const apiKey = pinned.apiKey
  const routeLabel = `${pinned.node.mode} \u00b7 ${nodeApiUrl}`
  const userData = app.getPath('userData')
  const appIdentity = homeV2AppIdentityKey(context)

  try {
    return await executeHomeV2ForeignSend(requestValue, {
      appIdentity,
      approve: async (rows, meta) => {
        await requireAccountReadPermission(sender, context, protocol, action, {
          chainId: meta.chainId,
          coin: meta.coin,
          foreignSendDetails: rows.map((row) => ({ ...row })),
          kind: 'foreign-send',
          operationLabel: meta.operationLabel,
          routeLabel,
          target: meta.target,
          targetChainLabel: 'Qortium',
        })
      },
      crypto: foreignWalletCrypto(),
      // Every mutable input is read AFTER the node resolution and returned
      // without another await, so this answer describes the moment it is
      // given rather than the moment the guard was entered.
      isStillValid: () => evaluateHomeV2ForeignSendValidity({
        pinnedRoute: nodeRoute,
        readAccountUnlocked: () => isAccountUnlocked(accountId),
        readLiveContextMatches: () => {
          const fresh = getQdnViewContextForWebContents(sender)
          return !!fresh && sameViewContext(context, fresh) && liveResourceMatchesGrant(fresh)
        },
        resolveRoute: async () => {
          const current = await getHomeV2ReadableNode('qortium').catch(() => null)
          return current ? `${current.mode}|${current.nodeApiUrl}` : null
        },
      }),
      journal: {
        clearReconciled: (key, observedTxId) =>
          clearReconciledStoredForeignWalletPendingTransaction(userData, key, observedTxId),
        confirmBroadcastSuccess: (key, returnedTxId) =>
          confirmStoredForeignWalletBroadcastSuccess(userData, key, returnedTxId),
        findConflict: (input) => findStoredForeignWalletPendingTransactionConflict(userData, input),
        listPending: (input) => listStoredForeignWalletPendingTransactions(userData, input),
        recordBroadcastAttempt: (key, now) => recordForeignWalletBroadcastAttempt(userData, key, now),
        recordSigned: (entry) => recordSignedForeignWalletPendingTransaction(userData, entry),
        releaseNeverBroadcast: (key, now) => {
          // Worth a line in the log: a signed transaction that was never put
          // on a network is being forgotten, and that should be visible even
          // though it is provably safe.
          console.warn(
            `[home-v2-app] Releasing a ${key.coin} transaction that was signed but never broadcast: ${key.txId}`,
          )
          return releaseNeverBroadcastStoredForeignWalletPendingTransaction(
            userData,
            key,
            now,
            FOREIGN_WALLET_SEND_FRESHNESS_MS,
          )
        },
      },
      now: () => Date.now(),
      readWalletHistory: async (wallet) => {
        // The SAME authenticated read the wallet-history action uses, on the
        // pinned route. It settles a retained write-ahead entry and nothing
        // else: the result never reaches the app.
        const request = buildForeignWalletReadRequest(wallet, 'wallettransactions')
        return postHomeV2TrustedForeignWallet(
          nodeApiUrl,
          apiKey,
          request.pathname,
          request.body,
          request.contentType,
        )
      },
      postTrusted: (pathname, body, contentType, maxBytes) => postHomeV2TrustedForeignWallet(
        nodeApiUrl,
        apiKey,
        pathname,
        body,
        contentType,
        maxBytes,
      ),
      resolveRoute: async () => {
        const current = await resolveHomeV2AdminNode('qortium')
        assertHomeV2TrustedForeignWalletNode(action, current.trust)
        if (current.trust.revision !== pinnedRevision || current.node.nodeApiUrl !== nodeApiUrl) {
          throw new Error('The selected Qortium node or its API key changed during the foreign send.')
        }
        return {
          apiKey: current.apiKey,
          nodeApiUrl: current.node.nodeApiUrl,
          revision: current.trust.revision,
          routeLabel,
        }
      },
      withWalletSeed: (use) => {
        const seed = getAccountForeignWalletSeed(accountId)
        try {
          return use(seed.seed, seed.addressIndex, seed.walletVersion)
        } finally {
          seed.seed.fill(0)
        }
      },
    })
  } catch (error) {
    if (error instanceof HomeV2ForeignSendReconciliationError
      || error instanceof HomeV2ForeignSendReconciliationPendingError) {
      throw createHomeV2BridgeError(error.message, {
        action,
        code: error.code,
        network,
        retryable: false,
        routeRevision,
      })
    }
    if (error instanceof HomeV2ForeignSendError) {
      throw createHomeV2BridgeError(error.message, {
        action,
        code: 'FOREIGN_SEND_UNAVAILABLE',
        network,
        retryable: false,
        routeRevision,
      })
    }
    if (error instanceof Error && (error as { code?: unknown }).code === FOREIGN_WALLET_BACKEND_UNAVAILABLE_CODE) {
      throw createHomeV2BridgeError(error.message, {
        action,
        code: FOREIGN_WALLET_BACKEND_UNAVAILABLE_CODE,
        network,
        retryable: false,
        routeRevision,
      })
    }
    if (error instanceof Error && /already in progress for this wallet and coin/.test(error.message)) {
      throw createHomeV2BridgeError(error.message, {
        action,
        code: 'FOREIGN_SEND_IN_PROGRESS',
        network,
        retryable: true,
        routeRevision,
      })
    }
    throw error
  }
}

async function deriveHomeV2ForeignWallet(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  action: 'GET_USER_WALLET' | 'GET_WALLET_BALANCE' | 'GET_USER_WALLET_INFO' | 'GET_USER_WALLET_TRANSACTIONS',
  requestValue: Record<string, unknown>,
  resolvedInput?: Awaited<ReturnType<typeof resolveHomeV2AdminNode>>,
): Promise<{
  readonly nodeApiUrl?: string
  readonly apiKey?: string
  readonly wallet: ForeignWalletPublicRuntime
}> {
  if (protocol !== 'qdnRequest') throw new Error(`${action} foreign-wallet access requires qdnRequest.`)
  const coin = normalizeHomeV2ForeignWalletCoin(requestValue)
  const receiveOnly = action === 'GET_USER_WALLET'
  const resolved = receiveOnly ? null : (resolvedInput ?? await resolveHomeV2AdminNode('qortium'))
  if (resolved) assertHomeV2TrustedForeignWalletNode(action, resolved.trust)
  if (!context.accountId || !isAccountUnlocked(context.accountId)) {
    throw new Error('Selected account is locked.')
  }
  await requireAccountReadPermission(sender, context, protocol, action, {
    coin,
    kind: 'foreign-wallet-read',
    operationLabel: receiveOnly ? 'Read foreign receive wallet' : 'Read foreign wallet',
    routeLabel: resolved?.node.nodeApiUrl ?? 'Home local wallet',
  })
  if (!context.accountId || !isAccountUnlocked(context.accountId) || !liveResourceMatchesGrant(context)) {
    throw new Error('Account access context changed before the foreign wallet read started.')
  }
  const current = receiveOnly ? null : await resolveHomeV2AdminNode('qortium')
  if (current && resolved) {
    assertHomeV2TrustedForeignWalletNode(action, current.trust)
    if (!current.trust.trusted || !resolved.trust.trusted) {
      throw new Error('Foreign wallet reads require an authenticated Qortium node.')
    }
    if (current.trust.revision !== resolved.trust.revision) {
      throw new Error('The selected Qortium node or its API key changed before the wallet read could start.')
    }
  }
  const seed = getAccountForeignWalletSeed(context.accountId)
  try {
    return {
      ...(current ? { apiKey: current.apiKey, nodeApiUrl: current.node.nodeApiUrl } : {}),
      wallet: deriveForeignWalletPublicRuntime({
        coin,
        crypto: foreignWalletCrypto(),
        nonce: seed.addressIndex,
        seed: seed.seed,
        walletVersion: seed.walletVersion,
      }),
    }
  } finally {
    seed.seed.fill(0)
  }
}

async function readHomeV2ForeignWallet(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  action: 'GET_WALLET_BALANCE' | 'GET_USER_WALLET_INFO' | 'GET_USER_WALLET_TRANSACTIONS',
  requestValue: Record<string, unknown>,
) {
  const endpoint: ForeignWalletReadEndpoint = action === 'GET_WALLET_BALANCE'
    ? 'walletbalance'
    : action === 'GET_USER_WALLET_INFO'
      ? 'addressinfos'
      : 'wallettransactions'
  const derived = await deriveHomeV2ForeignWallet(sender, context, protocol, action, requestValue)
  if (!derived.nodeApiUrl || !derived.apiKey) {
    throw new Error('Foreign wallet reads require an authenticated Qortium node.')
  }
  const nodeApiUrl = derived.nodeApiUrl
  const apiKey = derived.apiKey
  return executeForeignWalletRead(derived.wallet, endpoint, (request) =>
    postHomeV2TrustedForeignWallet(
      nodeApiUrl,
      apiKey,
      request.pathname,
      request.body,
      request.contentType,
    ))
}

async function setHomeV2ForeignServer(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  requestValue: Record<string, unknown>,
) {
  if (protocol !== 'qdnRequest') throw new Error('SET_CURRENT_FOREIGN_SERVER requires qdnRequest.')
  const coin = normalizeHomeV2ForeignWalletCoin(requestValue)
  const server = normalizeHomeV2ForeignServerRequest(requestValue)
  const before = await resolveHomeV2AdminNode('qortium')
  assertHomeV2TrustedForeignWalletNode('SET_CURRENT_FOREIGN_SERVER', before.trust)
  if (!context.accountId || !isAccountUnlocked(context.accountId)) {
    throw new Error('Selected account is locked.')
  }
  await requireAccountReadPermission(sender, context, protocol, 'SET_CURRENT_FOREIGN_SERVER', {
    coin,
    kind: 'foreign-server',
    operationLabel: 'Change foreign-chain server',
    routeLabel: before.node.nodeApiUrl,
    serverDetails: [
      { label: 'Host', value: server.hostName },
      { label: 'Port', value: String(server.port) },
      { label: 'Connection', value: server.connectionType },
      ...(server.certificateSha256Fingerprint
        ? [{ label: 'Certificate SHA-256', value: server.certificateSha256Fingerprint }]
        : []),
    ],
  })
  const current = await resolveHomeV2AdminNode('qortium')
  assertHomeV2TrustedForeignWalletNode('SET_CURRENT_FOREIGN_SERVER', current.trust)
  if (current.trust.revision !== before.trust.revision) {
    throw new Error('The selected Qortium node or its API key changed before the server change could start.')
  }
  return postHomeV2TrustedForeignWallet(
    current.node.nodeApiUrl,
    current.apiKey,
    `/crosschain/${coin.toLowerCase()}/setcurrentserver`,
    JSON.stringify(server),
    'application/json',
  )
}

function assertHomeV2TrustedMintingNode(
  action: HomeV2MintingWriteAction,
  network: HomeV2AppNetwork,
  trust: HomeV2AdminTrust,
) {
  if (trust.trusted) return
  const operation = action === 'START_MINTING' ? 'Starting minting' : 'Removing a minting key'
  // The refusal NAMES THE FIX (attach your node's key, use HTTPS or a
  // tunnel) instead of asserting a platform or locality rule: a user running
  // their own Core is entitled to administer it from wherever they are.
  throw createHomeV2BridgeError(homeV2AdminTrustMessage(trust.reason, operation), {
    action,
    code: 'NODE_CAPABILITY_MISSING',
    network,
    retryable: false,
  })
}

async function readHomeV2MintingAddress(
  context: QdnViewContext,
  requestValue: Record<string, unknown>,
) {
  if (requestValue.address !== undefined && requestValue.address !== null && requestValue.address !== '') {
    return normalizeHomeV2Address(requestValue.address)
  }
  if (!context.accountId) throw new Error('GET_MINTING_STATUS needs an address or a selected account.')
  return (await getAccountProfile(context.accountId)).address
}

async function readHomeV2MintingStatus(
  network: HomeV2AppNetwork,
  context: QdnViewContext,
  requestValue: Record<string, unknown>,
) {
  const address = await readHomeV2MintingAddress(context, requestValue)
  const { apiKey, node, trusted } = await resolveHomeV2AdminNode(network)
  // Public endpoint: the API key is never attached to it. This read runs
  // before the trust check, and a mis-set "local" mode can hold a confirmed
  // remote HTTPS URL with a sendable key — the key must not travel to any
  // node that has not passed administrative trust.
  const rewardShares = await readHomeV2ChatJson(
    node.nodeApiUrl,
    buildHomeV2SelfRewardSharesPath(address),
    'Reward share lookup',
    '',
  )
  if (!trusted) {
    return deriveHomeV2MintingStatus({ address, nodeAdmin: null, rewardShares })
  }
  // A local Core that answers the public read but refuses (or has not yet
  // started) its admin endpoints is reported as "node-side state unknown"
  // rather than as a failure, so the on-chain half of the answer survives.
  // Home 1.x threw here instead; the app's own fallback did this degrade.
  const nodeAdmin = await Promise.all([
    readHomeV2ChatJson(node.nodeApiUrl, MINTING_ACCOUNTS_PATH, 'Minting account lookup', apiKey),
    readHomeV2ChatJson(node.nodeApiUrl, '/admin/status', 'Node status lookup', apiKey),
  ]).then(
    ([mintingAccounts, status]) => ({ mintingAccounts, status }),
    () => null,
  )
  return deriveHomeV2MintingStatus({ address, nodeAdmin, rewardShares })
}

async function readHomeV2MintingAccounts(network: HomeV2AppNetwork) {
  const { apiKey, node, trusted } = await resolveHomeV2AdminNode(network)
  // `available: false` is the honest answer for every node Home does not run,
  // and for a local Core that will not answer its admin route. It is what the
  // Minting app already renders as "node-side minting unavailable".
  if (!trusted) return createHomeV2MintingAccountsResult({ accounts: [], available: false })
  let accounts: unknown
  try {
    accounts = await readHomeV2ChatJson(
      node.nodeApiUrl,
      MINTING_ACCOUNTS_PATH,
      'Minting account lookup',
      apiKey,
    )
  } catch {
    return createHomeV2MintingAccountsResult({ accounts: [], available: false })
  }
  return createHomeV2MintingAccountsResult({ accounts, available: true })
}

/**
 * Derives the reward-share (minting) key pair for a self share — LOCALLY.
 *
 * SECURITY: this was the one place the account private key left Home: 1.x
 * posted it to the node's reward-share-key endpoint. Home now computes the
 * reward-share private key itself (SHA-256 of the X25519 shared secret — the
 * exact construction Core's PrivateKeyAccount.getRewardSharePrivateKey uses,
 * verified against a Core-generated vector in home-v2-reward-share-key.test),
 * and derives its Ed25519 public key from that seed. The ACCOUNT's private
 * key never touches the node any more, which is what let administration move
 * off the loopback-only rule. (The DERIVED reward-share private key is still
 * posted to the node's minting-account list — that is what registering a
 * minting key means, and it is scoped to reward-sharing, not the account.)
 */
function deriveHomeV2MintingKeyPair(
  minterSecretKey: Uint8Array,
  recipientPublicKey58: string,
) {
  const rewardSharePrivateKey = deriveHomeV2RewardSharePrivateKey(
    minterSecretKey,
    base58Decode(recipientPublicKey58),
  )
  try {
    const pair = nacl.sign.keyPair.fromSeed(rewardSharePrivateKey)
    return { privateKey58: base58Encode(rewardSharePrivateKey), publicKey58: base58Encode(pair.publicKey) }
  } finally {
    rewardSharePrivateKey.fill(0)
  }
}

/**
 * Re-resolves administrative trust and requires it to be the SAME trust the
 * approval was granted under: still trusted, same origin, same credential.
 *
 * The revision covers the last part — a key swapped for another valid key on
 * the same origin (a replayed protected-store record, or a rotation while the
 * prompt was open) changes it, so the approved operation cannot be spent
 * against a credential the user never saw. Comparing the ordinary
 * signed-write key here would be wrong twice over: it reads legacy settings
 * rather than the attached store, so it is empty for exactly the custom-node
 * setup this feature exists for.
 */
async function homeV2AdminTrustUnchanged(
  network: HomeV2AppNetwork,
  approved: { readonly origin: string; readonly revision: string },
) {
  const now = await resolveHomeV2AdminNode(network).catch(() => null)
  if (!now || !now.trust.trusted) return false
  return now.trust.origin === approved.origin && now.trust.revision === approved.revision
}

function homeV2MintingContextGuard(
  sender: WebContents,
  context: QdnViewContext,
  accountId: string,
  network: HomeV2AppNetwork,
  nodeRoute: string,
  approvedTrust: { readonly origin: string; readonly revision: string },
) {
  return async () => {
    const freshContext = getQdnViewContextForWebContents(sender)
    if (!freshContext || !sameViewContext(context, freshContext)) return false
    if (!liveResourceMatchesGrant(freshContext) || !isAccountUnlocked(accountId)) return false
    const nodeNow = await getHomeV2ReadableNode(network).catch(() => null)
    if (!nodeNow || `${nodeNow.mode}|${nodeNow.nodeApiUrl}` !== nodeRoute) return false
    return homeV2AdminTrustUnchanged(network, approvedTrust)
  }
}

async function startHomeV2Minting(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  if (!isAccountUnlocked(accountId)) throw new Error('The selected account is locked.')
  const { apiKey, node, nodeRoute, trust } = await resolveHomeV2AdminNode(network)
  assertHomeV2TrustedMintingNode('START_MINTING', network, trust)
  const profile = await getAccountProfile(accountId)
  const address = profile.address
  await requireAccountReadPermission(sender, context, protocol, 'START_MINTING', {
    kind: 'minting',
    mintingAddress: address,
    operationLabel: homeV2MintingOperationLabel('START_MINTING'),
    routeLabel: `${node.mode} · ${node.nodeApiUrl}`,
    targetChainLabel: network === 'qortal' ? 'Qortal' : 'Qortium',
  })
  const rateLimitDecision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(sender, context))
  if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
  const isStillValid = homeV2MintingContextGuard(
    sender,
    context,
    accountId,
    network,
    nodeRoute,
    { origin: trust.trusted ? trust.origin : '', revision: trust.trusted ? trust.revision : '' },
  )
  if (!(await isStillValid())) throw new Error('Account access context changed before approval completed.')
  const signingKey = getAccountSigningKey(accountId)
  if (signingKey.address !== address) {
    throw new Error('Selected account signing key changed before minting could start.')
  }
  const secretKey = getAccountSecretKey(accountId)
  try {
    if (secretKey.address !== address) {
      throw new Error('Selected account signing key changed before minting could start.')
    }
    const selfShares = selectHomeV2SelfRewardShares(
      // Public endpoint — read keyless like the status path, so the API key
      // only ever accompanies admin calls to the administered node.
      await readHomeV2ChatJson(
        node.nodeApiUrl,
        buildHomeV2SelfRewardSharesPath(address),
        'Reward share lookup',
        '',
      ),
      address,
    )
    const mintingKeyPair = deriveHomeV2MintingKeyPair(secretKey.secretKey, signingKey.publicKey58)
    if (!(await isStillValid())) throw new Error('The signing context changed before minting could start.')
    if (selfShares.length === 0) {
      // No on-chain authorization yet (the account joined its minting group
      // before joins carried minting keys) — submit a zero-fee self-share
      // REWARD_SHARE. The key can be added to the node once it confirms.
      const timestamp = Date.now()
      const unsignedText = await postHomeV2MintingText(
        node.nodeApiUrl,
        '/addresses/rewardshare',
        JSON.stringify({
          fee: 0,
          minterPublicKey: signingKey.publicKey58,
          recipient: address,
          rewardSharePublicKey: mintingKeyPair.publicKey58,
          sharePercent: 0,
          timestamp,
          txGroupId: 0,
        }),
        'application/json',
        'Minting authorization transaction build',
        apiKey,
      )
      if (!(await isStillValid())) throw new Error('The signing context changed before minting could start.')
      // Signed here rather than through the node's /transactions/sign, which
      // would be a second place the account's private key travels.
      const unsignedBytes = base58Decode(unsignedText)
      const signedBytes = appendSignatureToTransactionBytes(
        unsignedBytes,
        signDetached(unsignedBytes, secretKey.secretKey),
      )
      const signature = getSignatureFromSignedTransactionBytes(signedBytes)
      await postHomeV2ChatText(
        node.nodeApiUrl,
        '/transactions/process?apiVersion=2',
        base58Encode(signedBytes),
        'text/plain',
        'Minting authorization transaction processing failed.',
        apiKey,
      )
      return createHomeV2StartMintingResult({
        address,
        keyAdded: false,
        rewardSharePending: true,
        transactionSignature: signature,
      })
    }
    if (!selfShares.some((share) => share.rewardSharePublicKey === mintingKeyPair.publicKey58)) {
      throw new Error(
        'The minting key authorization on chain does not match the key derived from the selected account.',
      )
    }
    // The derived minting private key goes to the administered node and nowhere else;
    // the result below deliberately carries no key material, and a failure
    // here is scrubbed so the node cannot echo the key back through the error.
    await postHomeV2MintingText(
      node.nodeApiUrl,
      MINTING_ACCOUNTS_PATH,
      mintingKeyPair.privateKey58,
      'text/plain',
      'Adding the minting key to the node',
      apiKey,
    )
    return createHomeV2StartMintingResult({ address, keyAdded: true })
  } finally {
    secretKey.secretKey.fill(0)
  }
}

// The selected account's OWN self-share minting key as the node currently
// reports it. Resolved in main, from the node's list, every time it is needed.
async function readHomeV2SelfMintingKey(
  nodeApiUrl: string,
  apiKey: string,
  address: string,
) {
  return resolveHomeV2SelfMintingPublicKey(
    await readHomeV2ChatJson(nodeApiUrl, MINTING_ACCOUNTS_PATH, 'Minting account lookup', apiKey),
    address,
  )
}

/**
 * Removes the selected account's own minting key from the local Core.
 *
 * The key is NOT a parameter. Core's DELETE /admin/mintingaccounts matches a
 * private key just as readily as a public one and removes whatever it matches,
 * so honoring an app-supplied value would let any app strip an unrelated
 * minter off the user's node and would give it a path for pushing key-shaped
 * material through Home. Home therefore resolves the account's own self-share
 * key from the node's own list, before and again after the prompt, and deletes
 * only that. An app may still SEND `publicKey`, but only as an assertion: it
 * is compared against the resolved key and never forwarded.
 */
async function removeHomeV2MintingAccount(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  network: HomeV2AppNetwork,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  if (!isAccountUnlocked(accountId)) throw new Error('The selected account is locked.')
  const assertedPublicKey =
    requestValue.publicKey === undefined || requestValue.publicKey === null || requestValue.publicKey === ''
      ? null
      : normalizeHomeV2MintingPublicKey(requestValue.publicKey)
  const { apiKey, node, nodeRoute, trust } = await resolveHomeV2AdminNode(network)
  assertHomeV2TrustedMintingNode('REMOVE_MINTING_ACCOUNT', network, trust)
  const profile = await getAccountProfile(accountId)
  const address = profile.address
  const publicKey = await readHomeV2SelfMintingKey(node.nodeApiUrl, apiKey, address)
  if (!publicKey) {
    // A no-op, not a failure: nothing is changed and the node is not called.
    // Answered without prompting, because there is nothing to approve.
    return createHomeV2RemoveMintingAccountResult({ address, publicKey: null, removed: false })
  }
  if (assertedPublicKey && assertedPublicKey !== publicKey) {
    throw new Error(
      'The minting key in the request is not the selected account\'s key on this node.',
    )
  }
  await requireAccountReadPermission(sender, context, protocol, 'REMOVE_MINTING_ACCOUNT', {
    kind: 'minting',
    mintingAddress: address,
    mintingPublicKey: publicKey,
    operationLabel: homeV2MintingOperationLabel('REMOVE_MINTING_ACCOUNT'),
    routeLabel: `${node.mode} · ${node.nodeApiUrl}`,
    targetChainLabel: network === 'qortal' ? 'Qortal' : 'Qortium',
  })
  const rateLimitDecision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(sender, context))
  if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
  const isStillValid = homeV2MintingContextGuard(
    sender,
    context,
    accountId,
    network,
    nodeRoute,
    { origin: trust.trusted ? trust.origin : '', revision: trust.trusted ? trust.revision : '' },
  )
  if (!(await isStillValid())) throw new Error('Account access context changed before approval completed.')
  // Re-resolve after the approval: the account, and the node's own list, must
  // still agree on exactly the key the user was shown.
  const freshProfile = await getAccountProfile(accountId)
  const freshPublicKey = await readHomeV2SelfMintingKey(node.nodeApiUrl, apiKey, freshProfile.address)
  if (freshProfile.address !== address || freshPublicKey !== publicKey) {
    throw new Error('The minting key for the selected account changed before removal.')
  }
  // Those two reads take time, and another window could rotate the attached
  // key on this origin meanwhile — so trust is re-checked immediately before
  // the write, not only before the reads (review round 2, finding 1).
  if (!(await isStillValid())) throw new Error('The selected node or its API key changed before removal.')
  // DELETE /admin/mintingaccounts takes the base58 key as the plain-text body.
  const result = await deleteHomeV2MintingKey(node.nodeApiUrl, publicKey, apiKey)
  // Core answers "true" on removal and "false" when it held no matching key.
  if (result !== 'true') {
    throw new Error('The node did not have a matching minting key to remove.')
  }
  return createHomeV2RemoveMintingAccountResult({ address, publicKey, removed: true })
}

async function showHomeV2DesktopContextMenu(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  requestValue: Record<string, unknown>,
) {
  const request = normalizeHomeV2ContextMenuRequest(protocol, requestValue)
  const popupHost = getQdnViewContextMenuPopupHost(sender, request.anchor)
  if (!popupHost) {
    throw new Error('Open this app tab to show its Home context menu.')
  }
  const items = getHomeV2ContextMenuItems(request.target)
  let selectedAction: HomeV2ContextMenuActionId | null = null
  const template: MenuItemConstructorOptions[] = []
  let previousGroup: (typeof items)[number]['group'] | null = null
  for (const item of items) {
    if (previousGroup && previousGroup !== item.group) template.push({ type: 'separator' })
    template.push({
      label: item.label,
      click: () => {
        selectedAction = item.action
      },
    })
    previousGroup = item.group
  }
  const menu = Menu.buildFromTemplate(template)
  // Share the one-menu-per-view slot with the native right-click link menu.
  // reserveQdnViewContextMenu returns false if this view already has a menu up.
  if (
    !reserveQdnViewContextMenu(sender.id, {
      hostWebContentsId: context.windowId,
      menu,
      tabId: context.tabId,
      targetNetwork: request.target.network,
      window: popupHost.window,
    })
  ) {
    throw new Error('This app tab already has an open Home context menu.')
  }
  return new Promise((resolve, reject) => {
    const finish = async () => {
      releaseQdnViewContextMenu(sender.id, menu)
      if (!selectedAction) {
        resolve(dismissedHomeV2ContextMenuResult())
        return
      }
      try {
        const fresh = getQdnViewContextForWebContents(sender)
        if (
          !fresh ||
          !sameViewContext(context, fresh) ||
          !liveResourceMatchesGrant(fresh) ||
          !isQdnViewVisible(fresh.windowId, fresh.tabId)
        ) {
          throw new Error('The app context changed before the context menu action completed.')
        }
        const operation = getHomeV2ContextMenuOperation(request.target, selectedAction)
        if (operation.kind === 'copy') {
          clipboard.writeText(operation.value)
        } else {
          popupHost.window.webContents.send('home-v2-app:open-address', {
            address: operation.address,
            // Trusted view context, never the request; the renderer binds the
            // new tab to the ORIGINATING tab's account, looked up by these two.
            sourceTabId: context.tabId,
            sourceResourceLocation: context.resourceUrl,
          })
        }
        resolve(handledHomeV2ContextMenuResult(selectedAction))
      } catch (error) {
        reject(error)
      }
    }
    try {
      menu.popup({
        callback: () => {
          void finish()
        },
        window: popupHost.window,
        x: popupHost.x,
        y: popupHost.y,
      })
    } catch (error) {
      releaseQdnViewContextMenu(sender.id, menu)
      reject(error)
    }
  })
}

// The response cap 1.x applied to both list reads (QDN_APP_DEFAULT_MAX_BYTES).
const LIST_READ_MAX_BYTES = 2_097_152

/**
 * Lists are the node's own state, so the family shares the administrative
 * trust rule: Home's own managed Core, or a custom node the user attached
 * their API key to (resolveHomeV2AdminNode / evaluateHomeV2AdminTrust).
 * 1.x was stricter — assertLocalWriteConnection required a local Core for all
 * four list actions, reads included — which locked out anyone running their
 * own node elsewhere.
 */
async function resolveHomeV2ListNode(action: string) {
  const resolved = await resolveHomeV2AdminNode('qortium')
  if (!resolved.trust.trusted) {
    // Lists are node-local policy state (blocking/following), so they need an
    // administered node — the user's own, wherever it runs.
    throw createHomeV2BridgeError(
      homeV2AdminTrustMessage(resolved.trust.reason, 'Using QDN lists'),
      { action, code: 'NODE_CAPABILITY_MISSING', network: 'qortium', retryable: false },
    )
  }
  return resolved
}

// postHomeV2ChatText's shape with the method open: REMOVE_FROM_LIST is the
// one bridge write Core takes as a bodied DELETE.
async function requestHomeV2ListText(
  method: 'POST' | 'DELETE',
  nodeApiUrl: string,
  path: string,
  body: string,
  fallbackMessage: string,
  apiKey: string,
) {
  const response = await nodeFetch(`${nodeApiUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-API-KEY': apiKey } : {}),
    },
    body,
    // The trust gate proves the URL is one the user administers, but a
    // redirect would let the RESPONDER choose a second URL it never saw — fetch
    // preserves X-API-KEY across origins (it is not an Authorization header),
    // and a 307/308 re-sends the method and body too. Refusing redirects
    // outright keeps the administrative key pinned to the host the gate
    // approved. (Security review 2026-08-26, finding 1.)
    redirect: 'error',
    signal: AbortSignal.timeout(CHAT_WRITE_TIMEOUT_MS),
  })
  // 'GET' only tells readBoundedResponse to read the body; it does not change
  // the HTTP method actually sent above (see postHomeV2ChatText).
  const result = await readBoundedResponse(response, 'GET', CHAT_SIGNING_RESPONSE_MAX_BYTES)
  const text = result.body.trim()
  if (!result.ok) {
    throw Object.assign(
      new Error(readableNodeErrorMessage(text, `${fallbackMessage} HTTP ${result.status}.`)),
      { status: result.status },
    )
  }
  return text
}

// The read twin of requestHomeV2ListText: readHomeV2ChatJson's shape with
// redirects refused, because every list read carries the administrative key.
// (The shared chat/minting helpers now refuse redirects too; this stays
// separate for its list-specific response cap and error shape.)
async function readHomeV2ListJson(
  nodeApiUrl: string,
  path: string,
  label: string,
  apiKey: string,
) {
  const response = await nodeFetch(`${nodeApiUrl}${path}`, {
    headers: apiKey ? { 'X-API-KEY': apiKey } : undefined,
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  const result = await readBoundedResponse(response, 'GET', LIST_READ_MAX_BYTES)
  if (!result.ok) {
    throw Object.assign(new Error(`${label} returned HTTP ${result.status}.`), { status: result.status })
  }
  return result.data
}

/**
 * Runs one list action on desktop.
 *
 * Reads answer with no prompt (permissionless family, like every other read);
 * writes prompt on every request. The write result is Core's own text body —
 * the string "true" or "false", exactly as 1.x returned it: "false" means Core
 * declined to apply the batch, and 1.x deliberately did not convert that to an
 * error, so apps that check the value keep working unchanged.
 */
async function handleHomeV2ListAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  action: string,
  requestValue: Record<string, unknown>,
) {
  if (!isHomeV2ListWriteAction(action)) {
    const path = action === 'GET_ALL_LISTS'
      ? '/lists'
      : buildHomeV2ListPath(normalizeHomeV2ListName(requestValue))
    const { apiKey, node } = await resolveHomeV2ListNode(action)
    try {
      return await readHomeV2ListJson(
        node.nodeApiUrl,
        path,
        action === 'GET_ALL_LISTS' ? 'Lists lookup' : 'List lookup',
        apiKey,
      )
    } catch (error) {
      // 1.x parity: a 404 on a named list is "no such list", answered as [].
      // Current Core answers [] itself, so this is defense for older Cores.
      if (action === 'GET_LIST' && (error as { status?: unknown }).status === 404) {
        return normalizeHomeV2ListReadResult(404, null)
      }
      throw error
    }
  }
  // Validate and serialize BEFORE prompting, so a malformed request can never
  // raise a prompt, and a batch too large to display in full is refused
  // rather than approved unseen (the 1.x 4000-character rule).
  const listName = normalizeHomeV2ListName(requestValue)
  const items = normalizeHomeV2ListItems(requestValue)
  const serializedItems = serializeHomeV2ListItemsForApproval(items)
  const before = await resolveHomeV2ListNode(action)
  const operationLabel = action === 'ADD_TO_LIST'
    ? 'Add to a list on this node'
    : 'Remove from a list on this node'
  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'node-list',
    listDetails: [
      { label: 'List', value: listName },
      { label: 'Items', value: serializedItems },
      { label: 'Node', value: before.node.nodeApiUrl },
    ],
    listName,
    operationLabel,
    routeLabel: `${before.node.mode} · ${before.node.nodeApiUrl}`,
    targetChainLabel: 'Qortium',
  })
  const rateLimitDecision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(sender, context))
  if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
  // Re-resolve after the prompt: the approval named one node, and the write
  // must not follow the key to a different node selected mid-prompt.
  const after = await resolveHomeV2ListNode(action)
  if (
    after.node.nodeApiUrl !== before.node.nodeApiUrl ||
    !before.trust.trusted ||
    !after.trust.trusted ||
    after.trust.origin !== before.trust.origin ||
    // Same origin, DIFFERENT credential — a key rotated or replayed while the
    // prompt was open — must not inherit this approval either.
    after.trust.revision !== before.trust.revision
  ) {
    throw new Error('The selected Qortium node or its API key changed before the write could start.')
  }
  return requestHomeV2ListText(
    action === 'ADD_TO_LIST' ? 'POST' : 'DELETE',
    after.node.nodeApiUrl,
    buildHomeV2ListPath(listName),
    buildHomeV2ListWriteBody(items),
    action === 'ADD_TO_LIST' ? 'Failed to add items to list.' : 'Failed to remove items from list.',
    after.apiKey,
  )
}

/**
 * Node settings are the node's own configuration, so the family shares the
 * administrative trust rule with lists and minting: Home's own managed Core,
 * or a custom node the user attached their API key to
 * (resolveHomeV2AdminNode / evaluateHomeV2AdminTrust). The metadata READ is
 * not handled here — it is a plain anonymous Core route answered by the
 * shared read handler, exactly like GET_NODE_STATUS.
 */
async function resolveHomeV2NodeSettingsNode(action: string) {
  const resolved = await resolveHomeV2AdminNode('qortium')
  if (!resolved.trust.trusted) {
    throw createHomeV2BridgeError(
      homeV2AdminTrustMessage(
        resolved.trust.reason,
        action === 'RESTART_NODE' ? 'Restarting the node' : 'Updating node settings',
      ),
      { action, code: 'NODE_CAPABILITY_MISSING', network: 'qortium', retryable: false },
    )
  }
  return resolved
}

// The read twin for this family: the two anonymous settings reads UPDATE
// validation needs (current values and writable metadata). No key is
// attached — Core serves both routes anonymously — but redirects are refused
// anyway so the answer comes from the node the trust gate named.
async function readHomeV2NodeSettingsJson(nodeApiUrl: string, path: string, label: string) {
  const response = await nodeFetch(`${nodeApiUrl}${path}`, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  const result = await readBoundedResponse(response, 'GET', LIST_READ_MAX_BYTES)
  if (!result.ok) {
    throw Object.assign(new Error(`${label} returned HTTP ${result.status}.`), { status: result.status })
  }
  return result.data
}

// The keyed call: PATCH /admin/settings or GET /admin/restart, key attached.
// Redirects are refused for the same reason as requestHomeV2ListText — a
// redirect would let the RESPONDER move the administrative key to a host the
// trust gate never approved. (Security review 2026-08-26, finding 1.)
async function requestHomeV2NodeSettingsText(
  method: 'GET' | 'PATCH',
  nodeApiUrl: string,
  path: string,
  body: string | undefined,
  fallbackMessage: string,
  apiKey: string,
) {
  const response = await nodeFetch(`${nodeApiUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(apiKey ? { 'X-API-KEY': apiKey } : {}),
    },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(CHAT_WRITE_TIMEOUT_MS),
  })
  const result = await readBoundedResponse(response, 'GET', CHAT_SIGNING_RESPONSE_MAX_BYTES)
  if (!result.ok) {
    // The error is a FIXED operation/status message, never the node's body:
    // this call carried the administrative key, and a hostile node or proxy
    // could echo received headers into its error text, which flows onward to
    // the calling app. Same scrub rationale as scrubbedHomeV2MintingError
    // (dual-model review 2026-09-01, finding 1).
    throw Object.assign(
      new Error(`${fallbackMessage} HTTP ${result.status}.`),
      { status: result.status },
    )
  }
  return result.body.trim()
}

/**
 * Runs UPDATE_NODE_SETTINGS or RESTART_NODE on desktop: validate BEFORE
 * prompting, prompt on every request, re-resolve trust after the prompt,
 * then one keyed call — the exact shape of handleHomeV2ListAction.
 *
 * 1.x parity with three deliberate differences: trust comes from
 * resolveHomeV2AdminNode (so an attached custom node qualifies, not only a
 * non-network one); the update result is rebuilt from an allowlist instead of
 * passing Core's response through (the settings file path stays on the
 * node); and RESTART_NODE remains fire-and-forget exactly as every existing
 * /admin/restart caller is — core-manager's process-scan fallback already
 * tolerates the pid change a self-restart causes.
 */
async function handleHomeV2NodeSettingsAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  action: HomeV2NodeSettingsWriteAction,
  requestValue: Record<string, unknown>,
) {
  const operationLabel = homeV2NodeSettingsOperationLabel(action)
  if (action === 'RESTART_NODE') {
    const before = await resolveHomeV2NodeSettingsNode(action)
    await requireAccountReadPermission(sender, context, protocol, action, {
      kind: 'node-settings',
      operationLabel,
      routeLabel: `${before.node.mode} · ${before.node.nodeApiUrl}`,
      settingsDetails: [
        { label: 'Impact', value: HOME_V2_RESTART_NODE_IMPACT },
        { label: 'Node', value: before.node.nodeApiUrl },
      ],
      targetChainLabel: 'Qortium',
    })
    const rateLimitDecision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(sender, context))
    if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
    // Re-resolve after the prompt: the approval named one node and one
    // credential, and the restart must not follow the key anywhere else.
    const after = await resolveHomeV2NodeSettingsNode(action)
    if (
      after.node.nodeApiUrl !== before.node.nodeApiUrl ||
      !before.trust.trusted ||
      !after.trust.trusted ||
      after.trust.origin !== before.trust.origin ||
      after.trust.revision !== before.trust.revision
    ) {
      throw new Error('The selected Qortium node or its API key changed before the write could start.')
    }
    await requestHomeV2NodeSettingsText(
      'GET',
      after.node.nodeApiUrl,
      '/admin/restart',
      undefined,
      'Node restart request failed.',
      after.apiKey,
    )
    return { accepted: true }
  }
  // Validate BEFORE prompting: a malformed patch, an oversized batch, or a
  // key the node does not declare writable can never raise a prompt.
  const patch = normalizeHomeV2NodeSettingsPatch(requestValue)
  const before = await resolveHomeV2NodeSettingsNode(action)
  const [metadata, currentSettings] = await Promise.all([
    readHomeV2NodeSettingsJson(before.node.nodeApiUrl, '/admin/settings/metadata', 'Node settings metadata lookup'),
    readHomeV2NodeSettingsJson(before.node.nodeApiUrl, '/admin/settings', 'Node settings lookup'),
  ])
  const writableKeys = homeV2WritableSettingKeys(metadata)
  for (const key of Object.keys(patch)) {
    if (!writableKeys.has(key)) throw new Error(`Node setting ${key} is not writable.`)
  }
  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'node-settings',
    operationLabel,
    routeLabel: `${before.node.mode} · ${before.node.nodeApiUrl}`,
    settingsDetails: [
      { label: 'Node', value: before.node.nodeApiUrl },
      ...buildHomeV2NodeSettingsApprovalRows(currentSettings, patch),
    ],
    targetChainLabel: 'Qortium',
  })
  const rateLimitDecision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(sender, context))
  if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
  const after = await resolveHomeV2NodeSettingsNode(action)
  if (
    after.node.nodeApiUrl !== before.node.nodeApiUrl ||
    !before.trust.trusted ||
    !after.trust.trusted ||
    after.trust.origin !== before.trust.origin ||
    after.trust.revision !== before.trust.revision
  ) {
    throw new Error('The selected Qortium node or its API key changed before the write could start.')
  }
  const text = await requestHomeV2NodeSettingsText(
    'PATCH',
    after.node.nodeApiUrl,
    '/admin/settings',
    JSON.stringify(patch),
    'Node settings update request failed.',
    after.apiKey,
  )
  let parsed: unknown = null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  return createHomeV2NodeSettingsUpdateResult(parsed)
}

// ---------------------------------------------------------------------------
// Polls (Home 2.1 restoration, Qortium qdnRequest only)
//
// Each of CREATE_POLL / VOTE_ON_POLL / UPDATE_POLL signs one fee-free chain
// transaction through Core\'s keyless /polls/public/* builders, following the
// group-membership pattern exactly: normalize and refuse locally first, prompt
// single-request with the complete operation on screen, build, byte-assert the
// unsigned transaction against everything the user approved, MemoryPoW, sign
// locally, broadcast — and journal an ambiguous broadcast instead of guessing.
//
// 1.x prompts showed only an action and a name; these show the operation. A
// VOTE prompt names the poll and the selected option LABELS (resolved from the
// live poll, refused when an index is out of range), and the poll is re-read
// after approval: if its name or options changed while the prompt was open,
// the vote no longer means what the user approved and is refused.
// ---------------------------------------------------------------------------

function homeV2PollBuilderUnavailable(error: unknown) {
  return isHomeV2AppRecord(error) && (error.status === 403 || error.status === 404)
}

function homeV2PollTimeRow(label: string, value: number | undefined) {
  return value === undefined
    ? []
    : [{ label, value: `${new Date(value).toISOString()} (${value})` }]
}

// An approval the user cannot read in full is not an approval (the lists
// rule). Options and descriptions are chain-limited to sizes that can exceed
// any dialog, so the serialized display form is capped like a list batch.
// The escape is INJECTIVE: backslashes are doubled FIRST, so a literal
// six-character "\\u202e" in chain data and a real U+202E can never render
// identically — and C0 controls are escaped too, so a legitimate multiline
// description reaches the prompt as a visible "\\u000a" instead of being
// refused by the renderer's control-character check and dying as a silent
// 60-second timeout. (Security review 2026-08-26, findings 2 and 4.)
const homeV2PollApprovalText = homeV2PromptText

async function readHomeV2PollTarget(action: HomeV2PollWriteAction, nodeApiUrl: string, pollId: number) {
  let value: unknown
  try {
    // Keyless public read; the admin key never travels for a lookup.
    value = await readHomeV2ChatJson(nodeApiUrl, `/polls/id/${encodeURIComponent(String(pollId))}`, 'Poll lookup', '')
  } catch (error) {
    if (isHomeV2AppRecord(error) && error.status === 404) {
      throw createHomeV2BridgeError(`Poll ${pollId} does not exist.`, {
        action,
        code: 'TARGET_NOT_FOUND',
        network: 'qortium',
        retryable: false,
      })
    }
    throw error
  }
  return selectHomeV2PollTarget(value, pollId)
}

async function handleHomeV2PollAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  action: HomeV2PollWriteAction,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  if (!isAccountUnlocked(accountId)) throw new Error('The selected account is locked.')
  const node = await getHomeV2ReadableNode('qortium')
  const apiKey = await getHomeV2SignedWriteApiKey('qortium', node.nodeApiUrl)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  const routeLabel = `${node.mode} · ${node.nodeApiUrl}`

  // Normalize BEFORE anything else: a malformed request must never raise a
  // prompt, contact the node, or look like a capability problem.
  const createRequest = action === 'CREATE_POLL'
    ? normalizeHomeV2CreatePollRequest(requestValue, profile.address)
    : null
  const voteRequest = action === 'VOTE_ON_POLL' ? normalizeHomeV2VoteOnPollRequest(requestValue) : null
  const updateRequest = action === 'UPDATE_POLL' ? normalizeHomeV2UpdatePollRequest(requestValue) : null
  const pollId = voteRequest?.pollId ?? updateRequest?.pollId ?? null

  // The live poll a vote or update is about. Read before prompting so the
  // dialog can show real names and labels, and re-read after approval below.
  const target = pollId === null ? null : await readHomeV2PollTarget(action, node.nodeApiUrl, pollId)
  const selection = voteRequest ? canonicalHomeV2VoteSelection(voteRequest.optionInput) : null
  if (target && selection) {
    for (const index of selection) {
      if (index > target.optionNames.length) {
        throw new Error(`Poll "${target.pollName}" has ${target.optionNames.length} options; option ${index} does not exist.`)
      }
    }
  }

  const operationLabel = homeV2PollOperationLabel(action, selection !== null && selection.length === 0)
  const pollDetails = createRequest
    ? [
        { label: 'Name', value: homeV2PollApprovalText(createRequest.pollName, 'The poll name') },
        {
          label: 'Description',
          value: createRequest.description
            ? homeV2PollApprovalText(createRequest.description, 'The poll description')
            : '(none)',
        },
        { label: 'Options', value: homeV2PollApprovalText(JSON.stringify(createRequest.pollOptions), 'The poll option list') },
        { label: 'Owner', value: createRequest.owner },
        ...homeV2PollTimeRow('Starts', createRequest.startTime),
        ...homeV2PollTimeRow('Ends', createRequest.endTime),
      ]
    : voteRequest && target && selection
      ? [
          { label: 'Poll', value: homeV2PollApprovalText(`#${voteRequest.pollId} · ${target.pollName}`, 'The poll name') },
          {
            label: 'Selection',
            value: selection.length === 0
              ? 'Remove your current vote'
              : homeV2PollApprovalText(
                  selection.map((index) => `${index}. ${target.optionNames[index - 1]}`).join('  ·  '),
                  'The selected options',
                ),
          },
        ]
      : updateRequest && target
        ? [
            { label: 'Poll', value: homeV2PollApprovalText(`#${updateRequest.pollId} · ${target.pollName}`, 'The poll name') },
            { label: 'New name', value: homeV2PollApprovalText(updateRequest.newPollName, 'The new poll name') },
            // Every replacement field is shown EXPLICITLY: an update replaces
            // the complete metadata, so an omitted description or time CLEARS
            // the stored one, and a row the prompt silently dropped would hide
            // exactly that destruction (security review 2026-08-26, finding 1).
            // "(none)" is a row, not an absence.
            {
              label: 'New description',
              value: updateRequest.newDescription
                ? homeV2PollApprovalText(updateRequest.newDescription, 'The new description')
                : '(none — clears any stored description)',
            },
            { label: 'New options', value: homeV2PollApprovalText(JSON.stringify(updateRequest.newPollOptions), 'The new option list') },
            {
              label: 'New start',
              value: updateRequest.newStartTime !== undefined
                ? `${new Date(updateRequest.newStartTime).toISOString()} (${updateRequest.newStartTime})`
                : '(none — clears any stored start time)',
            },
            {
              label: 'New end',
              value: updateRequest.newEndTime !== undefined
                ? `${new Date(updateRequest.newEndTime).toISOString()} (${updateRequest.newEndTime})`
                : '(none — clears any stored end time)',
            },
          ]
        : []
  if (pollDetails.length === 0) throw new Error(`${action} is not a supported poll write.`)

  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'poll',
    operationLabel,
    pollDetails,
    routeLabel,
    target: pollId === null ? `poll-create:${createRequest!.pollName}` : `poll:${pollId}`,
    targetChainLabel: 'Qortium',
  })
  const rateLimitDecision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(sender, context))
  if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
  const signingKey = getAccountSecretKey(accountId)
  if (signingKey.address !== profile.address) {
    signingKey.secretKey.fill(0)
    throw new Error('Selected account signing key changed before the poll action could be signed.')
  }
  const isStillValid = async () => {
    const freshContext = getQdnViewContextForWebContents(sender)
    if (!freshContext || !sameViewContext(context, freshContext)) return false
    if (!liveResourceMatchesGrant(freshContext) || !isAccountUnlocked(accountId)) return false
    const nodeNow = await getHomeV2ReadableNode('qortium').catch(() => null)
    return !!nodeNow &&
      `${nodeNow.mode}|${nodeNow.nodeApiUrl}` === nodeRoute &&
      (await getHomeV2SignedWriteApiKey('qortium', node.nodeApiUrl).catch(() => null)) === apiKey
  }
  // A vote or update means what it means only against the poll the user SAW.
  // If the poll\'s name or option list changed while the prompt was open — an
  // owner can update either before votes exist — the approved indexes no
  // longer name the approved labels, and the action is refused.
  const validateTarget = async () => {
    if (pollId === null || !target) return
    const currentTarget = await readHomeV2PollTarget(action, node.nodeApiUrl, pollId)
    if (
      currentTarget.pollName !== target.pollName ||
      JSON.stringify(currentTarget.optionNames) !== JSON.stringify(target.optionNames)
    ) {
      throw new Error('The poll changed before the poll action could be signed.')
    }
  }
  try {
    if (!(await isStillValid())) throw new Error('Account access context changed before approval completed.')
    const timestamp = Date.now()
    const buildPath = action === 'CREATE_POLL'
      ? '/polls/public/create'
      : action === 'VOTE_ON_POLL'
        ? '/polls/public/vote'
        : '/polls/public/update'
    const buildBody = JSON.stringify(
      createRequest
        ? {
            description: createRequest.description,
            fee: 0,
            owner: createRequest.owner,
            pollCreatorPublicKey: signingKey.publicKey58,
            pollName: createRequest.pollName,
            pollOptions: createRequest.pollOptions.map((optionName) => ({ optionName })),
            timestamp,
            txGroupId: 0,
            ...(createRequest.startTime !== undefined ? { startTime: createRequest.startTime } : {}),
            ...(createRequest.endTime !== undefined ? { endTime: createRequest.endTime } : {}),
          }
        : voteRequest && selection
          ? {
              fee: 0,
              optionIndexes: [...selection],
              pollId: voteRequest.pollId,
              timestamp,
              txGroupId: 0,
              voterPublicKey: signingKey.publicKey58,
            }
          : {
              fee: 0,
              newDescription: updateRequest!.newDescription,
              newPollName: updateRequest!.newPollName,
              newPollOptions: updateRequest!.newPollOptions.map((optionName) => ({ optionName })),
              ownerPublicKey: signingKey.publicKey58,
              pollId: updateRequest!.pollId,
              timestamp,
              txGroupId: 0,
              ...(updateRequest!.newStartTime !== undefined ? { newStartTime: updateRequest!.newStartTime } : {}),
              ...(updateRequest!.newEndTime !== undefined ? { newEndTime: updateRequest!.newEndTime } : {}),
            },
    )
    let unsignedText: string
    try {
      unsignedText = await postHomeV2ChatText(
        node.nodeApiUrl,
        buildPath,
        buildBody,
        'application/json',
        `${operationLabel} transaction build failed.`,
        apiKey,
      )
    } catch (error) {
      if (homeV2PollBuilderUnavailable(error)) {
        throw createHomeV2BridgeError(
          'The selected Qortium node does not expose the public poll builders.',
          { action, code: 'NODE_CAPABILITY_MISSING', network: 'qortium', retryable: false },
        )
      }
      throw error
    }
    const unsignedBytes = base58Decode(unsignedText)
    const common = {
      publicKey: base58Decode(signingKey.publicKey58),
      timestamp,
      txGroupId: 0,
    }
    if (createRequest) {
      assertPublicCreatePollTransaction(unsignedBytes, {
        ...common,
        description: createRequest.description,
        endTime: createRequest.endTime,
        owner: base58Decode(createRequest.owner),
        pollName: createRequest.pollName,
        pollOptions: [...createRequest.pollOptions],
        startTime: createRequest.startTime,
      })
    } else if (voteRequest && selection) {
      assertPublicVoteOnPollTransaction(unsignedBytes, {
        ...common,
        optionIndexes: [...selection],
        pollId: voteRequest.pollId,
      })
    } else {
      assertPublicUpdatePollTransaction(unsignedBytes, {
        ...common,
        endTime: updateRequest!.newEndTime,
        newDescription: updateRequest!.newDescription,
        newPollName: updateRequest!.newPollName,
        newPollOptions: [...updateRequest!.newPollOptions],
        pollId: updateRequest!.pollId,
        startTime: updateRequest!.newStartTime,
      })
    }
    let difficulty: number
    try {
      difficulty = parsePublicPollCapabilities(await readHomeV2ChatJson(
        node.nodeApiUrl,
        '/polls/public/capabilities',
        'MemoryPoW capability lookup',
        apiKey,
      )).mempowFeeAlternativeDifficulty
    } catch (error) {
      if (homeV2PollBuilderUnavailable(error) || (isHomeV2AppRecord(error) && error.code === 'QDN_PUBLIC_POLL_CAPABILITY_UNAVAILABLE')) {
        throw createHomeV2BridgeError(
          'The selected Qortium node does not advertise a compatible MemoryPoW poll capability.',
          { action, code: 'NODE_CAPABILITY_MISSING', network: 'qortium', retryable: false },
        )
      }
      throw error
    }
    const nonce = await computeHomeV2ChatNonce(unsignedBytes, difficulty, isStillValid)
    if (!(await isStillValid())) throw new Error('The signing context changed before the poll action could be submitted.')
    await validateTarget()
    if (!(await isStillValid())) throw new Error('The signing context changed before the poll action could be submitted.')
    const signedBytes = signTransactionWithNonce(unsignedBytes, nonce, signingKey.secretKey)
    const signature = getSignatureFromSignedTransactionBytes(signedBytes)
    const identity = createRequest
      ? { pollName: createRequest.pollName }
      : voteRequest
        ? {
            pollId: voteRequest.pollId,
            pollName: target!.pollName,
            ...(voteRequest.optionInput.optionIndexes === undefined
              ? { optionIndex: voteRequest.optionInput.optionIndex }
              : { optionIndexes: [...selection!] }),
          }
        : { newPollName: updateRequest!.newPollName, pollId: updateRequest!.pollId }
    try {
      const processText = await postHomeV2ChatText(
        node.nodeApiUrl,
        '/transactions/process?apiVersion=2',
        base58Encode(signedBytes),
        'text/plain',
        `${operationLabel} transaction processing failed.`,
        apiKey,
      )
      let processResult: unknown = processText
      try { processResult = JSON.parse(processText) } catch { /* text answer stays text */ }
      return Object.freeze({
        accepted: true,
        action,
        ...identity,
        network: 'qortium',
        result: processResult,
        signature,
        timestamp,
        transactionSignature: signature,
      })
    } catch (error) {
      // Signed and submitted with an unclear answer: never invite an
      // automatic retry. The generic journal wrapper retains this entry for
      // reconciliation because outcome is 'unknown'.
      return Object.freeze({
        accepted: false,
        action,
        ...identity,
        error: error instanceof Error ? error.message : String(error),
        errorType: 'BROADCAST_OUTCOME_UNKNOWN',
        network: 'qortium',
        outcome: 'unknown',
        retryable: false,
        signature,
        timestamp,
        transactionSignature: signature,
      })
    }
  } finally {
    signingKey.secretKey.fill(0)
  }
}

// ---------------------------------------------------------------------------
// Names (Home 2.1 restoration, Qortium qdnRequest only)
//
// REGISTER_NAME / UPDATE_NAME / SELL_NAME / CANCEL_SELL_NAME / BUY_NAME each
// sign one fee-free chain transaction through Core\'s keyless /names/public/*
// builders (qortium-core PR #269) on the poll-family pattern. Two things set
// this family apart and shape everything below:
//
// 1. BUY_NAME IS A PAYMENT. A zero transaction fee does not mean zero
//    financial effect — approving a buy transfers the sale amount from the
//    selected account to the seller. Its prompt is payment-grade: the exact
//    eight-decimal amount, who is paid, and any buyer restriction, resolved
//    from the LIVE sale state, with app-supplied values required to match
//    exactly rather than trusted.
// 2. GET /names/{name} resolves by REDUCED name while the transactions
//    demand the exact stored display name — so the fetched name must equal
//    the requested spelling, and a mismatch refuses rather than silently
//    substituting what would be signed. Amounts are exact atomic bigints;
//    floating point never touches one.
// ---------------------------------------------------------------------------

function homeV2NameBuilderUnavailable(error: unknown) {
  return isHomeV2AppRecord(error) && (error.status === 403 || error.status === 404)
}

async function readHomeV2NameTarget(action: HomeV2NameWriteAction, nodeApiUrl: string, name: string) {
  let value: unknown
  try {
    // Keyless public read; the admin key never travels for a lookup.
    value = await readHomeV2ChatJson(nodeApiUrl, `/names/${encodeURIComponent(name)}`, 'Name lookup', '')
  } catch (error) {
    if (isHomeV2AppRecord(error) && error.status === 404) {
      throw createHomeV2BridgeError(`The name "${name}" does not exist.`, {
        action,
        code: 'TARGET_NOT_FOUND',
        network: 'qortium',
        retryable: false,
      })
    }
    throw error
  }
  const target = selectHomeV2NameTarget(value)
  if (target.name !== name) {
    // The reduced-name lookup found a different stored spelling. Signing the
    // requested spelling would fail NAME_DOES_NOT_EXIST, and signing the
    // stored one would not be what the app asked for.
    throw createHomeV2BridgeError(
      `The name "${name}" is stored as "${target.name}"; request the exact stored spelling.`,
      { action, code: 'TARGET_NOT_FOUND', network: 'qortium', retryable: false },
    )
  }
  return target
}

type HomeV2NameTarget = Awaited<ReturnType<typeof readHomeV2NameTarget>>

async function handleHomeV2NameAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  action: HomeV2NameWriteAction,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  if (!isAccountUnlocked(accountId)) throw new Error('The selected account is locked.')
  const node = await getHomeV2ReadableNode('qortium')
  const apiKey = await getHomeV2SignedWriteApiKey('qortium', node.nodeApiUrl)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  const routeLabel = `${node.mode} · ${node.nodeApiUrl}`
  const operationLabel = homeV2NameOperationLabel(action)

  // Normalize BEFORE anything else: a malformed request must never raise a
  // prompt, contact the node, or look like a capability problem.
  const registerRequest = action === 'REGISTER_NAME' ? normalizeHomeV2RegisterNameRequest(requestValue) : null
  const updateRequest = action === 'UPDATE_NAME' ? normalizeHomeV2UpdateNameRequest(requestValue) : null
  const sellRequest = action === 'SELL_NAME' ? normalizeHomeV2SellNameRequest(requestValue) : null
  const cancelRequest = action === 'CANCEL_SELL_NAME' ? normalizeHomeV2CancelSellNameRequest(requestValue) : null
  const buyRequest = action === 'BUY_NAME' ? normalizeHomeV2BuyNameRequest(requestValue) : null
  const subjectName = registerRequest?.name ?? updateRequest?.name ?? sellRequest?.name ??
    cancelRequest?.name ?? buyRequest!.name

  // Everything but REGISTER acts on live name state: read it, hold the
  // prompt to it, and re-read after approval (validateNameTarget below).
  const target = registerRequest ? null : await readHomeV2NameTarget(action, node.nodeApiUrl, subjectName)
  if (target && (updateRequest || sellRequest || cancelRequest) && target.owner !== profile.address) {
    throw createHomeV2BridgeError(
      `The name "${subjectName}" is owned by ${target.owner}, not the selected account.`,
      { action, code: 'TARGET_NOT_FOUND', network: 'qortium', retryable: false },
    )
  }
  if (sellRequest && target?.isForSale) {
    throw new Error(`The name "${subjectName}" is already for sale; cancel the current sale first.`)
  }
  if (cancelRequest && target && !target.isForSale) {
    throw new Error(`The name "${subjectName}" is not for sale.`)
  }
  // BUY: resolve seller/amount/restriction from the LIVE sale, requiring any
  // app-supplied value to match exactly. Core state is authoritative.
  let buySeller: string | null = null
  let buyAmountAtomic = 0n
  let buyAmountDecimal = ''
  if (buyRequest && target) {
    if (!target.isForSale || target.salePrice === null) {
      throw new Error(`The name "${subjectName}" is not for sale.`)
    }
    if (target.saleRecipient && target.saleRecipient !== profile.address) {
      throw new Error(`The sale of "${subjectName}" is restricted to ${target.saleRecipient}.`)
    }
    if (target.owner === profile.address) {
      throw new Error(`The selected account already owns "${subjectName}".`)
    }
    buySeller = buyRequest.seller ?? target.owner
    if (buySeller !== target.owner) {
      throw new Error(`The seller of "${subjectName}" is ${target.owner}, not ${buySeller}.`)
    }
    if (buyRequest.amount && buyRequest.amount.atomic !== target.salePrice.atomic) {
      throw new Error(
        `The sale price of "${subjectName}" is ${target.salePrice.decimal}, not ${buyRequest.amount.decimal}.`,
      )
    }
    buyAmountAtomic = target.salePrice.atomic
    buyAmountDecimal = target.salePrice.decimal
  }

  const nameDetails = registerRequest
    ? [
        { label: 'Name', value: homeV2PollApprovalText(registerRequest.name, 'The name') },
        {
          label: 'Name data',
          value: registerRequest.data ? homeV2PollApprovalText(registerRequest.data, 'The name data') : '(none)',
        },
      ]
    : updateRequest
      ? [
          { label: 'Name', value: homeV2PollApprovalText(updateRequest.name, 'The name') },
          {
            label: 'New name',
            // QUOTED for the same reason as the group update rows: Home's own
            // "(unchanged)" wording must not be forgeable as a value.
            value: updateRequest.newName ? homeV2QuotedPromptText(updateRequest.newName, 'The new name') : '(unchanged)',
          },
          {
            label: 'New data',
            value: updateRequest.newData
              ? homeV2QuotedPromptText(updateRequest.newData, 'The new name data')
              : '(unchanged — existing data is kept)',
          },
          {
            label: 'Primary',
            value: updateRequest.primary === undefined
              ? '(unchanged)'
              : updateRequest.primary
                ? 'Make this the account\'s primary name'
                : 'Stop being the account\'s primary name',
          },
        ]
      : sellRequest
        ? [
            { label: 'Name', value: homeV2PollApprovalText(sellRequest.name, 'The name') },
            { label: 'Price', value: `${sellRequest.amount.decimal} coins` },
            {
              label: 'Sale type',
              value: sellRequest.recipient
                ? `Restricted — only ${sellRequest.recipient} may buy. The sale amount is always paid to you, the owner.`
                : 'Public — any account may buy',
            },
          ]
        : cancelRequest && target
          ? [
              { label: 'Name', value: homeV2PollApprovalText(cancelRequest.name, 'The name') },
              { label: 'Price', value: target.salePrice ? `${target.salePrice.decimal} coins (current sale, being cancelled)` : '(current sale, being cancelled)' },
            ]
          : [
              { label: 'Name', value: homeV2PollApprovalText(subjectName, 'The name') },
              { label: 'You pay', value: `${buyAmountDecimal} coins` },
              { label: 'Paid to', value: buySeller ?? '' },
              ...(target?.saleRecipient
                ? [{ label: 'Restriction', value: `This sale is restricted to ${target.saleRecipient} (the selected account)` }]
                : []),
            ]

  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'name',
    nameDetails,
    operationLabel,
    routeLabel,
    target: `name:${subjectName}`,
    targetChainLabel: 'Qortium',
  })
  const rateLimitDecision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(sender, context))
  if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
  const signingKey = getAccountSecretKey(accountId)
  if (signingKey.address !== profile.address) {
    signingKey.secretKey.fill(0)
    throw new Error('Selected account signing key changed before the name action could be signed.')
  }
  const isStillValid = async () => {
    const freshContext = getQdnViewContextForWebContents(sender)
    if (!freshContext || !sameViewContext(context, freshContext)) return false
    if (!liveResourceMatchesGrant(freshContext) || !isAccountUnlocked(accountId)) return false
    const nodeNow = await getHomeV2ReadableNode('qortium').catch(() => null)
    return !!nodeNow &&
      `${nodeNow.mode}|${nodeNow.nodeApiUrl}` === nodeRoute &&
      (await getHomeV2SignedWriteApiKey('qortium', node.nodeApiUrl).catch(() => null)) === apiKey
  }
  // The action means what it means only against the state the user SAW: the
  // owner, sale flag, price, and restriction are re-read after approval and
  // any relevant drift refuses the sign.
  const validateNameTarget = async () => {
    if (registerRequest) return
    const current = await readHomeV2NameTarget(action, node.nodeApiUrl, subjectName)
    if (
      current.owner !== target!.owner ||
      current.isForSale !== target!.isForSale ||
      (current.salePrice?.atomic ?? null) !== (target!.salePrice?.atomic ?? null) ||
      current.saleRecipient !== target!.saleRecipient
    ) {
      throw new Error(`The name "${subjectName}" changed before the name action could be signed.`)
    }
  }
  try {
    if (!(await isStillValid())) throw new Error('Account access context changed before approval completed.')
    const timestamp = Date.now()
    const buildPath = registerRequest
      ? '/names/public/register'
      : updateRequest
        ? '/names/public/update'
        : sellRequest
          ? '/names/public/sell'
          : cancelRequest
            ? '/names/public/sell/cancel'
            : '/names/public/buy'
    const common = { fee: 0, timestamp, txGroupId: 0 }
    const buildBody = JSON.stringify(
      registerRequest
        ? { ...common, data: registerRequest.data, name: registerRequest.name, registrantPublicKey: signingKey.publicKey58 }
        : updateRequest
          ? {
              ...common,
              name: updateRequest.name,
              newData: updateRequest.newData,
              newName: updateRequest.newName,
              ownerPublicKey: signingKey.publicKey58,
              ...(updateRequest.primary === undefined ? {} : { primary: updateRequest.primary }),
            }
          : sellRequest
            ? {
                ...common,
                amount: sellRequest.amount.decimal,
                name: sellRequest.name,
                ownerPublicKey: signingKey.publicKey58,
                ...(sellRequest.recipient === undefined ? {} : { recipient: sellRequest.recipient }),
              }
            : cancelRequest
              ? { ...common, name: cancelRequest.name, ownerPublicKey: signingKey.publicKey58 }
              : {
                  ...common,
                  amount: buyAmountDecimal,
                  buyerPublicKey: signingKey.publicKey58,
                  name: subjectName,
                  seller: buySeller,
                },
    )
    let unsignedText: string
    try {
      unsignedText = await postHomeV2ChatText(
        node.nodeApiUrl,
        buildPath,
        buildBody,
        'application/json',
        `${operationLabel} transaction build failed.`,
        apiKey,
      )
    } catch (error) {
      if (homeV2NameBuilderUnavailable(error)) {
        throw createHomeV2BridgeError(
          'The selected Qortium node does not expose the public name builders.',
          { action, code: 'NODE_CAPABILITY_MISSING', network: 'qortium', retryable: false },
        )
      }
      throw error
    }
    const unsignedBytes = base58Decode(unsignedText)
    const expectedCommon = {
      publicKey: base58Decode(signingKey.publicKey58),
      timestamp,
      txGroupId: 0,
    }
    if (registerRequest) {
      assertPublicRegisterNameTransaction(unsignedBytes, {
        ...expectedCommon,
        data: registerRequest.data,
        name: registerRequest.name,
      })
    } else if (updateRequest) {
      assertPublicUpdateNameTransaction(unsignedBytes, {
        ...expectedCommon,
        name: updateRequest.name,
        newData: updateRequest.newData,
        newName: updateRequest.newName,
        primary: updateRequest.primary,
      })
    } else if (sellRequest) {
      assertPublicSellNameTransaction(unsignedBytes, {
        ...expectedCommon,
        amount: sellRequest.amount.atomic,
        name: sellRequest.name,
        recipient: sellRequest.recipient === undefined ? undefined : base58Decode(sellRequest.recipient),
      })
    } else if (cancelRequest) {
      assertPublicCancelSellNameTransaction(unsignedBytes, {
        ...expectedCommon,
        name: cancelRequest.name,
      })
    } else {
      assertPublicBuyNameTransaction(unsignedBytes, {
        ...expectedCommon,
        amount: buyAmountAtomic,
        name: subjectName,
        seller: base58Decode(buySeller!),
      })
    }
    let difficulty: number
    try {
      difficulty = parsePublicNameCapabilities(await readHomeV2ChatJson(
        node.nodeApiUrl,
        '/names/public/capabilities',
        'MemoryPoW capability lookup',
        apiKey,
      )).mempowFeeAlternativeDifficulty
    } catch (error) {
      if (homeV2NameBuilderUnavailable(error) || (isHomeV2AppRecord(error) && error.code === 'QDN_PUBLIC_NAME_CAPABILITY_UNAVAILABLE')) {
        throw createHomeV2BridgeError(
          'The selected Qortium node does not advertise a compatible MemoryPoW name capability.',
          { action, code: 'NODE_CAPABILITY_MISSING', network: 'qortium', retryable: false },
        )
      }
      throw error
    }
    const nonce = await computeHomeV2ChatNonce(unsignedBytes, difficulty, isStillValid)
    if (!(await isStillValid())) throw new Error('The signing context changed before the name action could be submitted.')
    await validateNameTarget()
    if (!(await isStillValid())) throw new Error('The signing context changed before the name action could be submitted.')
    const signedBytes = signTransactionWithNonce(unsignedBytes, nonce, signingKey.secretKey)
    const signature = getSignatureFromSignedTransactionBytes(signedBytes)
    const identity = registerRequest
      ? { name: registerRequest.name }
      : updateRequest
        ? { name: updateRequest.name, newName: updateRequest.newName || null }
        : sellRequest
          ? { amount: sellRequest.amount.decimal, name: sellRequest.name, recipient: sellRequest.recipient ?? null }
          : cancelRequest
            ? { name: cancelRequest.name }
            : { amount: buyAmountDecimal, name: subjectName, seller: buySeller }
    try {
      const processText = await postHomeV2ChatText(
        node.nodeApiUrl,
        '/transactions/process?apiVersion=2',
        base58Encode(signedBytes),
        'text/plain',
        `${operationLabel} transaction processing failed.`,
        apiKey,
      )
      let processResult: unknown = processText
      try { processResult = JSON.parse(processText) } catch { /* text answer stays text */ }
      return Object.freeze({
        accepted: true,
        action,
        ...identity,
        network: 'qortium',
        result: processResult,
        signature,
        timestamp,
        transactionSignature: signature,
      })
    } catch (error) {
      // Signed and submitted with an unclear answer: never invite an
      // automatic retry. The generic journal wrapper retains this entry
      // because outcome is 'unknown'.
      return Object.freeze({
        accepted: false,
        action,
        ...identity,
        error: error instanceof Error ? error.message : String(error),
        errorType: 'BROADCAST_OUTCOME_UNKNOWN',
        network: 'qortium',
        outcome: 'unknown',
        retryable: false,
        signature,
        timestamp,
        transactionSignature: signature,
      })
    }
  } finally {
    signingKey.secretKey.fill(0)
  }
}

// ---------------------------------------------------------------------------
// Group mutations (Home 2.1 restoration, Qortium qdnRequest only)
//
// CREATE_GROUP / UPDATE_GROUP / GROUP_APPROVAL / SET_GROUP / SET_GROUP_AVATAR
// are built LOCALLY on the group-admin transformer pattern (no Core builder):
// normalize, read live state, prompt with the complete operation, build the
// zero-nonce bytes, byte-verify, MemoryPoW, verify the stamped bytes, sign,
// broadcast. GROUP_APPROVAL votes on one specific PENDING transaction, so its
// prompt resolves and discloses that transaction — signature, type, creator,
// approval group, current status — and states that an opposition vote does
// not immediately reject it. SET_GROUP_AVATAR signs only a QDN pointer;
// avatar BYTES travel through the separate PUBLISH_QDN_RESOURCE flow.
// ---------------------------------------------------------------------------

async function readHomeV2GroupMutationMeta(action: HomeV2GroupMutationAction, nodeApiUrl: string, groupId: number) {
  let value: unknown
  try {
    value = await readHomeV2ChatJson(nodeApiUrl, `/groups/${encodeURIComponent(String(groupId))}`, 'Group lookup', '')
  } catch (error) {
    if (isHomeV2AppRecord(error) && error.status === 404) {
      throw createHomeV2BridgeError(`Group ${groupId} does not exist.`, {
        action,
        code: 'TARGET_NOT_FOUND',
        network: 'qortium',
        retryable: false,
      })
    }
    throw error
  }
  return selectHomeV2GroupMetadata(value, groupId)
}

async function handleHomeV2GroupMutationAction(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  action: HomeV2GroupMutationAction,
  requestValue: Record<string, unknown>,
) {
  if (!context.accountId) throw new Error('No account is selected for this tab.')
  const accountId = context.accountId
  if (!isAccountUnlocked(accountId)) throw new Error('The selected account is locked.')
  const node = await getHomeV2ReadableNode('qortium')
  const apiKey = await getHomeV2SignedWriteApiKey('qortium', node.nodeApiUrl)
  const nodeRoute = `${node.mode}|${node.nodeApiUrl}`
  const profile = await getAccountProfile(accountId)
  const routeLabel = `${node.mode} · ${node.nodeApiUrl}`

  // Normalize BEFORE anything else: a malformed request must never raise a
  // prompt or contact the node.
  const createRequest = action === 'CREATE_GROUP' ? normalizeHomeV2CreateGroupRequest(requestValue) : null
  const updateRequest = action === 'UPDATE_GROUP' ? normalizeHomeV2UpdateGroupRequest(requestValue) : null
  const approvalRequest = action === 'GROUP_APPROVAL' ? normalizeHomeV2GroupApprovalRequest(requestValue) : null
  const setGroupRequest = action === 'SET_GROUP' ? normalizeHomeV2SetGroupRequest(requestValue) : null
  const avatarRequest = action === 'SET_GROUP_AVATAR' ? normalizeHomeV2SetGroupAvatarRequest(requestValue) : null

  // --- Live-state resolution (audit Part E), per action -------------------
  const metaGroupId = updateRequest?.groupId ?? setGroupRequest?.defaultGroupId ?? avatarRequest?.groupId ?? null
  const meta = metaGroupId === null ? null : await readHomeV2GroupMutationMeta(action, node.nodeApiUrl, metaGroupId)
  if (meta && (updateRequest || avatarRequest) && meta.owner !== profile.address) {
    throw createHomeV2BridgeError(
      `Group ${metaGroupId} ("${meta.groupName}") is owned by ${meta.owner}, not the selected account.`,
      { action, code: 'TARGET_NOT_FOUND', network: 'qortium', retryable: false },
    )
  }

  // UPDATE: merge omitted fields with the live group so the prompt and the
  // signed bytes always carry the COMPLETE replacement.
  const resolvedUpdate = updateRequest && meta
    ? {
        approvalThreshold: updateRequest.newApprovalThreshold ?? meta.approvalThreshold,
        description: updateRequest.newDescription ?? meta.description,
        isOpen: updateRequest.newIsOpen ?? meta.isOpen,
        maximumBlockDelay: updateRequest.newMaximumBlockDelay ?? meta.maximumBlockDelay,
        minimumBlockDelay: updateRequest.newMinimumBlockDelay ?? meta.minimumBlockDelay,
        newName: updateRequest.newName,
      }
    : null
  if (resolvedUpdate) {
    if (resolvedUpdate.maximumBlockDelay < 1 || resolvedUpdate.maximumBlockDelay < resolvedUpdate.minimumBlockDelay) {
      throw new Error('Maximum block delay must be at least 1 and at least the minimum block delay.')
    }
    const unchanged =
      resolvedUpdate.newName === '' &&
      resolvedUpdate.description === meta!.description &&
      resolvedUpdate.isOpen === meta!.isOpen &&
      resolvedUpdate.approvalThreshold === meta!.approvalThreshold &&
      resolvedUpdate.minimumBlockDelay === meta!.minimumBlockDelay &&
      resolvedUpdate.maximumBlockDelay === meta!.maximumBlockDelay
    if (unchanged) {
      return Object.freeze({
        accepted: true,
        action,
        changed: false,
        groupId: updateRequest!.groupId,
        groupName: meta!.groupName,
        network: 'qortium',
      })
    }
  }

  // GROUP_APPROVAL: resolve the pending transaction being voted on.
  const pending = approvalRequest
    ? selectHomeV2PendingTransactionSummary(
        await readHomeV2ChatJson(
          node.nodeApiUrl,
          `/transactions/signature/${encodeURIComponent(approvalRequest.pendingSignature)}`,
          'Pending transaction lookup',
          '',
        ).catch((error) => {
          if (isHomeV2AppRecord(error) && error.status === 404) {
            throw createHomeV2BridgeError('The pending transaction signature is unknown to the selected node.', {
              action, code: 'TARGET_NOT_FOUND', network: 'qortium', retryable: false,
            })
          }
          throw error
        }),
        approvalRequest.pendingSignature,
      )
    : null
  if (approvalRequest && pending) {
    if (pending.approvalStatus !== 'PENDING') {
      throw new Error(`The referenced transaction is not awaiting approval (status: ${pending.approvalStatus || 'unknown'}).`)
    }
    if (approvalRequest.assertedGroupId !== undefined && approvalRequest.assertedGroupId !== pending.txGroupId) {
      throw new Error(`The pending transaction belongs to group ${pending.txGroupId}, not group ${approvalRequest.assertedGroupId}.`)
    }
  }
  const approvalGroupMeta = pending
    ? await readHomeV2GroupMutationMeta(action, node.nodeApiUrl, pending.txGroupId)
    : null
  if (pending) {
    // Fail CLOSED on adminship, for the same reason SET_GROUP fails closed on
    // membership: Core rejects a non-admin vote only AFTER a signature exists,
    // which journals an unknown outcome and blocks this account from voting on
    // that transaction until it is manually reconciled. (Ported from the
    // Android arm, group family review 2026-08-27.)
    const memberGroups = await readHomeV2ChatJson(
      node.nodeApiUrl,
      `/groups/member/${encodeURIComponent(profile.address)}`,
      'Group membership lookup',
      '',
    )
    if (!selectHomeV2GroupAdminshipFromGroups(memberGroups, pending.txGroupId)) {
      throw createHomeV2BridgeError(
        `The selected account is not an admin of group ${pending.txGroupId} ("${approvalGroupMeta!.groupName}"), so it cannot vote on this transaction.`,
        { action, code: 'TARGET_NOT_FOUND', network: 'qortium', retryable: false },
      )
    }
  }

  // SET_GROUP: membership + current default (changed:false when already set).
  if (setGroupRequest && meta) {
    // Fail CLOSED: a default group the account is not a member of would be
    // rejected by Core only AFTER signing, journaling a phantom unknown
    // outcome — so an unanswerable membership lookup refuses up front rather
    // than proceeding to a prompt.
    const membershipText = await postHomeV2ChatText(
      node.nodeApiUrl,
      `/groups/members/${encodeURIComponent(String(setGroupRequest.defaultGroupId))}/validate`,
      JSON.stringify([profile.address]),
      'application/json',
      'Membership lookup failed.',
      '',
    )
    let membership: unknown
    try {
      membership = JSON.parse(membershipText)
    } catch {
      throw new Error('The membership lookup answered with an unrecognized shape.')
    }
    if (!selectHomeV2GroupMembership(membership, profile.address)) {
      throw new Error(`The selected account is not a member of group ${setGroupRequest.defaultGroupId} ("${meta.groupName}").`)
    }
    // Fail CLOSED on anything but a genuinely absent account record. An
    // account with no on-chain history 404s here and simply has no default
    // group — but a timeout or a malformed answer must NOT be read as "the
    // default differs", which prompts and signs a SET_GROUP that is already
    // set. (Ported from the Android arm, group family review 2026-08-27.)
    const account = await readHomeV2ChatJson(
      node.nodeApiUrl,
      `/addresses/${encodeURIComponent(profile.address)}`,
      'Account lookup',
      '',
    ).catch((error) => {
      if (isHomeV2AppRecord(error) && error.status === 404) return null
      throw error
    })
    if (selectHomeV2DefaultGroupId(account) === setGroupRequest.defaultGroupId) {
      return Object.freeze({
        accepted: true,
        action,
        changed: false,
        defaultGroupId: setGroupRequest.defaultGroupId,
        groupName: meta.groupName,
        network: 'qortium',
      })
    }
  }

  // SET_GROUP_AVATAR: changed:false when the pointer already matches.
  if (avatarRequest && meta) {
    const current = meta.avatar
    const same = avatarRequest.avatar === null
      ? current === null
      : current !== null &&
        current.service === avatarRequest.avatar.service &&
        current.name === avatarRequest.avatar.name &&
        current.identifier === avatarRequest.avatar.identifier
    if (same) {
      return Object.freeze({
        accepted: true,
        action,
        avatar: avatarRequest.avatar,
        changed: false,
        groupId: avatarRequest.groupId,
        groupName: meta.groupName,
        network: 'qortium',
      })
    }
  }

  // --- Prompt --------------------------------------------------------------
  const unchangedNote = (changed: boolean) => (changed ? '' : ' (unchanged)')
  const operationLabel = homeV2GroupMutationOperationLabel(action, approvalRequest ? !approvalRequest.approval : false)
  const groupMutationDetails = createRequest
    ? [
        { label: 'Name', value: homeV2PollApprovalText(createRequest.groupName, 'The group name') },
        { label: 'Description', value: homeV2PollApprovalText(createRequest.description, 'The group description') },
        { label: 'Membership', value: createRequest.isOpen ? 'Open — anyone can join' : 'Closed — joining requires approval' },
        { label: 'Approval threshold', value: createRequest.approvalThreshold },
        { label: 'Block delays', value: `${createRequest.minimumBlockDelay} to ${createRequest.maximumBlockDelay}` },
      ]
    : resolvedUpdate && meta
      ? [
          { label: 'Group', value: homeV2PollApprovalText(`#${meta.groupId} · ${meta.groupName}`, 'The group name') },
          {
            label: 'New name',
            // QUOTED: an app could otherwise send the literal string
            // "(unchanged)" as the new name and have the rename render exactly
            // like the row that says the name is being kept.
            value: resolvedUpdate.newName
              ? homeV2QuotedPromptText(resolvedUpdate.newName, 'The new group name')
              : '(unchanged)',
          },
          {
            label: 'Description',
            value: homeV2QuotedPromptText(resolvedUpdate.description, 'The group description') +
              unchangedNote(resolvedUpdate.description !== meta.description),
          },
          {
            label: 'Membership',
            value: (resolvedUpdate.isOpen ? 'Open — anyone can join' : 'Closed — joining requires approval') +
              unchangedNote(resolvedUpdate.isOpen !== meta.isOpen),
          },
          {
            label: 'Approval threshold',
            value: resolvedUpdate.approvalThreshold + unchangedNote(resolvedUpdate.approvalThreshold !== meta.approvalThreshold),
          },
          {
            label: 'Block delays',
            value: `${resolvedUpdate.minimumBlockDelay} to ${resolvedUpdate.maximumBlockDelay}` +
              unchangedNote(
                resolvedUpdate.minimumBlockDelay !== meta.minimumBlockDelay ||
                resolvedUpdate.maximumBlockDelay !== meta.maximumBlockDelay,
              ),
          },
        ]
      : approvalRequest && pending && approvalGroupMeta
        ? [
            { label: 'Decision', value: approvalRequest.approval
                ? 'APPROVE the pending transaction'
                : 'OPPOSE the pending transaction (it stays pending until approved by others or it expires)' },
            { label: 'Pending transaction', value: approvalRequest.pendingSignature },
            { label: 'Transaction type', value: homeV2PollApprovalText(pending.type, 'The transaction type') },
            ...(pending.creatorAddress ? [{ label: 'Created by', value: pending.creatorAddress }] : []),
            { label: 'Group', value: homeV2PollApprovalText(`#${pending.txGroupId} · ${approvalGroupMeta.groupName}`, 'The group name') },
            { label: 'Status', value: 'PENDING' },
          ]
        : setGroupRequest && meta
          ? [
              { label: 'Default group', value: homeV2PollApprovalText(`#${setGroupRequest.defaultGroupId} · ${meta.groupName}`, 'The group name') },
            ]
          : avatarRequest && meta
            ? [
                { label: 'Group', value: homeV2PollApprovalText(`#${avatarRequest.groupId} · ${meta.groupName}`, 'The group name') },
                {
                  label: 'Avatar',
                  // Injective component encoding: a '/' INSIDE a name or
                  // identifier is escaped, so the displayed coordinate
                  // parses back to exactly one component triple.
                  value: avatarRequest.avatar === null
                    ? 'Clear the group avatar'
                    : homeV2AvatarPointerText(avatarRequest.avatar),
                },
              ]
            : []
  if (groupMutationDetails.length === 0) throw new Error(`${action} is not a supported group mutation.`)

  await requireAccountReadPermission(sender, context, protocol, action, {
    kind: 'group-mutation',
    groupMutationDetails,
    operationLabel,
    routeLabel,
    target: createRequest
      ? `group-create:${createRequest.groupName}`
      : approvalRequest
        ? `group-approval:${approvalRequest.pendingSignature}`
        : setGroupRequest
          ? `default-group:${setGroupRequest.defaultGroupId}`
          : `group:${metaGroupId}`,
    targetChainLabel: 'Qortium',
  })
  const rateLimitDecision = chatSendRateLimiter.checkAndRecordSend(chatSendRateLimitKey(sender, context))
  if (!rateLimitDecision.allowed) throw new Error(rateLimitDecision.message)
  const signingKey = getAccountSecretKey(accountId)
  if (signingKey.address !== profile.address) {
    signingKey.secretKey.fill(0)
    throw new Error('Selected account signing key changed before the group action could be signed.')
  }
  const isStillValid = async () => {
    const freshContext = getQdnViewContextForWebContents(sender)
    if (!freshContext || !sameViewContext(context, freshContext)) return false
    if (!liveResourceMatchesGrant(freshContext) || !isAccountUnlocked(accountId)) return false
    const nodeNow = await getHomeV2ReadableNode('qortium').catch(() => null)
    return !!nodeNow &&
      `${nodeNow.mode}|${nodeNow.nodeApiUrl}` === nodeRoute &&
      (await getHomeV2SignedWriteApiKey('qortium', node.nodeApiUrl).catch(() => null)) === apiKey
  }
  // The action means what it means only against the state the user SAW.
  const validateMutationTarget = async () => {
    if (meta) {
      const current = await readHomeV2GroupMutationMeta(action, node.nodeApiUrl, meta.groupId)
      if (current.groupName !== meta.groupName || current.owner !== meta.owner) {
        throw new Error('The group changed before the group action could be signed.')
      }
      if (updateRequest || avatarRequest) {
        if (
          current.description !== meta.description ||
          current.isOpen !== meta.isOpen ||
          current.approvalThreshold !== meta.approvalThreshold ||
          current.minimumBlockDelay !== meta.minimumBlockDelay ||
          current.maximumBlockDelay !== meta.maximumBlockDelay
        ) {
          throw new Error('The group changed before the group action could be signed.')
        }
      }
    }
    if (approvalRequest && pending) {
      const current = selectHomeV2PendingTransactionSummary(
        await readHomeV2ChatJson(
          node.nodeApiUrl,
          `/transactions/signature/${encodeURIComponent(approvalRequest.pendingSignature)}`,
          'Pending transaction lookup',
          '',
        ),
        approvalRequest.pendingSignature,
      )
      if (
        current.approvalStatus !== 'PENDING' ||
        current.txGroupId !== pending.txGroupId ||
        current.type !== pending.type ||
        current.creatorAddress !== pending.creatorAddress
      ) {
        throw new Error('The pending transaction changed before the vote could be signed.')
      }
    }
  }
  try {
    if (!(await isStillValid())) throw new Error('Account access context changed before approval completed.')
    const timestamp = Date.now()
    const payload: HomeV2GroupMutationWirePayload = createRequest
      ? { action: 'CREATE_GROUP', request: createRequest }
      : resolvedUpdate
        ? { action: 'UPDATE_GROUP', groupId: updateRequest!.groupId, resolved: resolvedUpdate }
        : approvalRequest
          ? { action: 'GROUP_APPROVAL', approval: approvalRequest.approval, pendingSignature: approvalRequest.pendingSignature }
          : setGroupRequest
            ? { action: 'SET_GROUP', defaultGroupId: setGroupRequest.defaultGroupId }
            : { action: 'SET_GROUP_AVATAR', avatar: avatarRequest!.avatar, groupId: avatarRequest!.groupId }
    const unsignedBytes = buildUnsignedQortiumGroupMutationTransactionBytes({
      payload,
      senderPublicKey: signingKey.publicKey58,
      timestamp,
    })
    assertUnsignedHomeV2GroupMutationTransaction(unsignedBytes, {
      payload,
      senderPublicKey: signingKey.publicKey58,
      timestamp,
    })
    let difficulty: number
    try {
      difficulty = parsePublicPollCapabilities(await readHomeV2ChatJson(
        node.nodeApiUrl,
        '/polls/public/capabilities',
        'MemoryPoW capability lookup',
        apiKey,
      )).mempowFeeAlternativeDifficulty
    } catch (error) {
      if (groupBuilderUnavailable(error) || (isHomeV2AppRecord(error) && error.code === 'QDN_PUBLIC_POLL_CAPABILITY_UNAVAILABLE')) {
        throw createHomeV2BridgeError(
          'The selected Qortium node does not advertise a compatible MemoryPoW capability.',
          { action, code: 'NODE_CAPABILITY_MISSING', network: 'qortium', retryable: false },
        )
      }
      throw error
    }
    const nonce = await computeHomeV2ChatNonce(unsignedBytes, difficulty, isStillValid)
    if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
    await validateMutationTarget()
    if (!(await isStillValid())) throw new Error('The signing context changed before the group action could be submitted.')
    // Stamp, verify the STAMPED bytes with the exact nonce, then detached-
    // sign exactly those bytes — the admin family's sequence (security
    // review 2026-08-26: signing must never touch bytes that were not
    // themselves verified).
    const stampedBytes = stampTransactionNonce(unsignedBytes, nonce)
    assertUnsignedHomeV2GroupMutationTransaction(stampedBytes, {
      nonce,
      payload,
      senderPublicKey: signingKey.publicKey58,
      timestamp,
    })
    const signedBytes = appendHomeV2GroupAdminSignature(
      stampedBytes,
      signDetached(stampedBytes, signingKey.secretKey),
    )
    const signature = getSignatureFromSignedTransactionBytes(signedBytes)
    const identity = createRequest
      ? { groupName: createRequest.groupName }
      : updateRequest
        ? { groupId: updateRequest.groupId, groupName: meta!.groupName }
        : approvalRequest
          ? { approval: approvalRequest.approval, groupId: pending!.txGroupId, pendingSignature: approvalRequest.pendingSignature }
          : setGroupRequest
            ? { defaultGroupId: setGroupRequest.defaultGroupId, groupName: meta!.groupName }
            : { avatar: avatarRequest!.avatar, groupId: avatarRequest!.groupId, groupName: meta!.groupName }
    try {
      const processText = await postHomeV2ChatText(
        node.nodeApiUrl,
        '/transactions/process?apiVersion=2',
        base58Encode(signedBytes),
        'text/plain',
        `${operationLabel} transaction processing failed.`,
        apiKey,
      )
      let processResult: unknown = processText
      try { processResult = JSON.parse(processText) } catch { /* text answer stays text */ }
      return Object.freeze({
        accepted: true,
        action,
        changed: true,
        ...identity,
        network: 'qortium',
        result: processResult,
        signature,
        timestamp,
        transactionSignature: signature,
      })
    } catch (error) {
      return Object.freeze({
        accepted: false,
        action,
        ...identity,
        error: error instanceof Error ? error.message : String(error),
        errorType: 'BROADCAST_OUTCOME_UNKNOWN',
        network: 'qortium',
        outcome: 'unknown',
        retryable: false,
        signature,
        timestamp,
        transactionSignature: signature,
      })
    }
  } finally {
    signingKey.secretKey.fill(0)
  }
}

async function handleRequestWithRuntime(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  requestValue: Record<string, unknown>,
  action: string,
  hostInfo: HomeV2AppHostInfo,
  availableActions: readonly string[],
) {
  if (action === 'SHOW_ACTIONS') return [...availableActions]
  if (!availableActions.includes(action)) {
    const implemented = getHomeV2AppActions(protocol).includes(action)
    throw createHomeV2BridgeError(
      implemented
        ? `${action} is unavailable on the configured ${hostInfo.network} route.`
        : `${action} is not implemented for ${protocol}.`,
      {
        action,
        code: implemented ? 'NODE_CAPABILITY_MISSING' : 'UNSUPPORTED_PROTOCOL',
        network: hostInfo.network,
        retryable: false,
        routeRevision: hostInfo.route.revision,
      },
    )
  }
  if (action === 'WHICH_UI') return 'QORTIUM_HOME_ELECTRON'
  if (action === 'GET_HOST_INFO') return hostInfo

  if (action === 'DECRYPT_DATA') {
    if (!context.accountId) throw new Error('No account is selected for this tab.')
    const accountId = context.accountId
    if (!isAccountUnlocked(accountId)) {
      throw createHomeV2BridgeError('The selected account is locked.', {
        action,
        code: 'ACCOUNT_LOCKED',
        network: hostInfo.network,
        retryable: false,
        routeRevision: hostInfo.route.revision,
      })
    }
    // The FORM is read from the data, never from what the request claims it
    // is: the two envelopes derive their key differently, so trusting a
    // caller-supplied kind would fail as an unexplained "cannot decrypt".
    const encryptedValue = requestValue as Record<string, unknown>
    const nestedPayload = typeof encryptedValue.payload === 'object' && encryptedValue.payload !== null
      ? encryptedValue.payload as Record<string, unknown>
      : null
    const rawEncrypted = encryptedValue.encryptedData ?? encryptedValue.data64 ??
      nestedPayload?.encryptedData ?? nestedPayload?.data64
    const kind = typeof rawEncrypted === 'string' ? qortalEnvelopeKind(rawEncrypted) : 'unknown'
    const request = normalizeHomeV2DecryptDataRequest(encryptedValue, kind)
    await requireAccountReadPermission(sender, context, protocol, action, {
      kind: 'decrypt',
      decryptDetails: [
        {
          label: 'Encrypted for',
          // Says plainly whose data this is. The modern envelope is addressed
          // to a set of readers; either way the account below is the key that
          // will open it.
          value: 'You, with the account below',
        },
        ...(request.senderPublicKey
          ? [{ label: 'Sent by', value: request.senderPublicKey }]
          : []),
        {
          label: 'Size',
          value: `${Math.ceil(request.encryptedData.length / 4) * 3} bytes of encrypted data`,
        },
      ],
      operationLabel: HOME_V2_DECRYPT_DATA_OPERATION_LABEL,
    })
    const signingKey = getAccountSecretKey(accountId)
    try {
      const decrypted = request.senderPublicKey
        ? await decryptQortalDeprecatedEnvelope({
          encryptedBase64: request.encryptedData,
          readerPrivateKey: signingKey.secretKey,
          senderPublicKey58: request.senderPublicKey,
        })
        : decryptQortalPublicKeyEnvelope({
          encryptedBase64: request.encryptedData,
          readerPrivateKey: signingKey.secretKey,
        })
      // Qortal returns the decrypted base64 STRING, not an object. Returning
      // our richer shape would break every app written against Qortal.
      return decrypted.data64
    } finally {
      signingKey.secretKey.fill(0)
    }
  }

  if (action === 'ENCRYPT_DATA') {
    if (!context.accountId) throw new Error('No account is selected for this tab.')
    const accountId = context.accountId
    // The key is needed to derive each recipient's shared secret, so a locked
    // account refuses BEFORE the prompt: asking the user to approve something
    // that cannot then run is a worse experience than saying why.
    if (!isAccountUnlocked(accountId)) {
      throw createHomeV2BridgeError('The selected account is locked.', {
        action,
        code: 'ACCOUNT_LOCKED',
        network: hostInfo.network,
        retryable: false,
        routeRevision: hostInfo.route.revision,
      })
    }
    const request = normalizeHomeV2EncryptDataRequest(requestValue)
    await requireAccountReadPermission(sender, context, protocol, action, {
      kind: 'encrypt',
      encryptDetails: [
        {
          label: 'Recipients',
          value: request.publicKeys.length === 0
            // Qortal's documented default, and worth saying plainly: with no
            // recipient keys the envelope is readable by this account alone.
            ? 'You only'
            : `${request.publicKeys.length} recipient${request.publicKeys.length === 1 ? '' : 's'}, plus you`,
        },
        ...request.publicKeys.map((key, index) => ({
          label: `Recipient ${index + 1}`,
          value: key,
        })),
      ],
      operationLabel: HOME_V2_ENCRYPT_DATA_OPERATION_LABEL,
    })
    // Read the key only AFTER approval, and zero it on every path out.
    const signingKey = getAccountSecretKey(accountId)
    try {
      return encryptQortalPublicKeyEnvelope({
        data64: request.data64,
        recipientPublicKeys58: request.publicKeys,
        senderPrivateKey: signingKey.secretKey,
        senderPublicKey58: signingKey.publicKey58,
      })
    } finally {
      signingKey.secretKey.fill(0)
    }
  }
  if (action === 'SHOW_CONTEXT_MENU') {
    return showHomeV2DesktopContextMenu(sender, context, protocol, requestValue)
  }
  const network = getHomeV2AppNetwork(protocol, action)
  // The selected account's address, for the reads that use it as a default
  // subject — and null in a widget for those same reads, because a chromeless
  // widget has no surface on which to disclose that it just self-addressed.
  // See homeV2WidgetWithholdsSelfSubject.
  const selectedSubjectAddress = async () => (
    context.accountId && !(isWidgetTabId(context.tabId) && homeV2WidgetWithholdsSelfSubject(action))
      ? (await getAccountProfile(context.accountId)).address
      : null
  )
  if (action === 'BOOKMARKS_HAS_PERMISSION') {
    return { granted: hasQdnManagerPermission(homeV2AppIdentityKey(context), 'bookmarks.manage') }
  }
  if (action === 'BOOKMARKS_GET' || action === 'BOOKMARKS_APPLY' || action === 'BOOKMARKS_OPEN') {
    await requireHomeV2BookmarkManagerPermission(sender, context, protocol, action)
    const freshContext = getQdnViewContextForWebContents(sender)
    if (!freshContext || !sameViewContext(context, freshContext) || !liveResourceMatchesGrant(freshContext)) {
      throw new Error('QDN manager request is stale because the app view changed before it could run.')
    }
    if (action === 'BOOKMARKS_OPEN') {
      const request = validateBookmarksOpenRequest(
        requestValue.request ?? {
          accountId: requestValue.accountId ?? null,
          address: requestValue.address,
        },
      )
      if (request.accountId && !accountExists(request.accountId)) {
        throw new Error('BOOKMARKS_OPEN accountId does not match a saved Home account.')
      }
      openHomeV2CollectionAddress(context, request)
      return true
    }
    const mutationRequest = action === 'BOOKMARKS_APPLY'
      ? validateBookmarkManagerMutationRequest(
          requestValue.request ?? {
            expectedRevision: requestValue.expectedRevision,
            mutation: requestValue.mutation,
          },
        )
      : undefined
    const result = await requestHomeV2Collections(
      context,
      action === 'BOOKMARKS_GET' ? 'get' : 'apply',
      mutationRequest,
    )
    const completedContext = getQdnViewContextForWebContents(sender)
    if (!completedContext || !sameViewContext(context, completedContext) || !liveResourceMatchesGrant(completedContext)) {
      throw new Error('QDN manager request is stale because the app view changed while it was running.')
    }
    return result
  }
  if (isHomeV2NotificationManagerAction(action)) {
    return handleHomeV2NotificationManagerAction(sender, context, protocol, action, requestValue)
  }
  if (isHomeV2HomeSettingsAction(action)) {
    return handleHomeV2HomeSettingsAction(sender, context, protocol, action, requestValue)
  }
  if (isHomeV2ListAction(action)) {
    return handleHomeV2ListAction(sender, context, protocol, action, requestValue)
  }
  if (isHomeV2NodeSettingsWriteAction(action)) {
    return handleHomeV2NodeSettingsAction(sender, context, protocol, action, requestValue)
  }
  if (isHomeV2PollWriteAction(action)) {
    return handleHomeV2PollAction(sender, context, protocol, action, requestValue)
  }
  if (isHomeV2NameWriteAction(action)) {
    return handleHomeV2NameAction(sender, context, protocol, action, requestValue)
  }
  if (isHomeV2GroupMutationAction(action)) {
    return handleHomeV2GroupMutationAction(sender, context, protocol, action, requestValue)
  }
  if (action === 'NOTIFICATION_HAS_PERMISSION') {
    return {
      granted: hasNotificationGrant(homeV2AppIdentityKey(context)),
      network,
    }
  }
  if (action === 'SHOW_NOTIFICATION') {
    return showHomeV2DesktopNotification(sender, context, protocol, requestValue)
  }
  if (action === 'GET_PENDING_TRANSACTIONS') {
    await requireAccountReadPermission(sender, context, protocol, action)
    return Object.freeze({
      entries: Object.freeze(listHomeV2PendingTransactions(app.getPath('userData'), {
        accountId: context.accountId!,
        appIdentity: homeV2AppIdentityKey(context),
        network,
      }).map(toHomeV2PendingTransactionResult)),
      network,
      version: 1 as const,
    })
  }
  if (action === 'FORGET_PENDING_TRANSACTION') {
    const request = normalizeHomeV2ForgetPendingTransactionRequest(protocol, requestValue)
    await requireAccountReadPermission(sender, context, protocol, action, {
      kind: 'journal',
      operationLabel: 'Forget pending transaction',
      signature: request.signature,
      targetChainLabel: network === 'qortal' ? 'Qortal' : 'Qortium',
    })
    return Object.freeze({
      forgotten: forgetHomeV2PendingTransaction(app.getPath('userData'), request),
      network,
      signature: request.signature,
    })
  }
  if (action === 'IS_USING_PUBLIC_NODE') {
    return hostInfo.route.configuredKind === 'public'
  }
  if (action === 'SELECT_QDN_PUBLISH_SOURCE') {
    return selectHomeV2PublicPublishSource(
      context,
      protocol,
      network,
      hostInfo.route.revision,
      requestValue,
    )
  }
  if (action === 'STAGE_QDN_PUBLISH_SOURCE') {
    return stageHomeV2PublicPublishSource(
      context,
      protocol,
      network,
      hostInfo.route.revision,
      requestValue,
    )
  }
  if (action === 'PREVIEW_QDN_PUBLISH_SOURCE') {
    return previewHomeV2PublishSource(
      context,
      protocol,
      network,
      hostInfo.route.revision,
      requestValue,
    )
  }
  if (action === 'PUBLISH_QDN_RESOURCE') {
    return publishHomeV2PublicPublishSource(
      sender,
      context,
      protocol,
      network,
      hostInfo.route.revision,
      requestValue,
    )
  }
  if (action === 'PUBLISH_MULTIPLE_QDN_RESOURCES') {
    return publishHomeV2MultiplePublishSources(
      sender,
      context,
      protocol,
      network,
      hostInfo.route.revision,
      requestValue,
    )
  }
  if (action === 'DELETE_QDN_RESOURCE') {
    return deleteHomeV2QdnResourceForApp(
      sender,
      context,
      protocol,
      network,
      hostInfo.route.revision,
      requestValue,
    )
  }
  if (isHomeV2RatingAction(action)) {
    return handleHomeV2RatingAction(
      sender,
      context,
      protocol,
      network,
      hostInfo.route.revision,
      action,
      requestValue,
    )
  }
  if (action === 'SET_ACCOUNT_AVATAR') {
    return handleHomeV2SetAccountAvatarAction(
      sender,
      context,
      protocol,
      network,
      hostInfo.route.revision,
      requestValue,
    )
  }
  if (isHomeV2PaymentAction(action)) {
    return handleHomeV2PaymentAction(
      sender,
      context,
      protocol,
      network,
      hostInfo.route.revision,
      action,
      requestValue,
    )
  }
  if (action === 'PUBLISH_CHAT_ATTACHMENT') {
    return publishHomeV2PrivateAttachmentSource(
      sender,
      context,
      protocol,
      network,
      hostInfo.route.revision,
      requestValue,
    )
  }
  if (
    action === 'GET_CHAT_ATTACHMENT_STREAM_URL' ||
    action === 'OPEN_CHAT_ATTACHMENT_VIEWER' ||
    action === 'SAVE_CHAT_ATTACHMENT'
  ) {
    const decrypted = await decryptHomeV2PrivateAttachment(
      sender,
      context,
      protocol,
      network,
      hostInfo.route.revision,
      action,
      requestValue,
    )
    try {
      if (!(await decrypted.isStillValid())) throw new Error('The app, account, or node route changed after attachment decryption.')
      if (action === 'GET_CHAT_ATTACHMENT_STREAM_URL') {
        return issueHomeV2DesktopPrivateBytesStream({
          binding: homeV2ResourceStreamBinding({
            context,
            network,
            nodeApiUrl: decrypted.node.nodeApiUrl,
            protocol,
            routeRevision: hostInfo.route.revision,
          }),
          bytes: decrypted.bytes,
          isStillValid: decrypted.isStillValid,
          mimeType: decrypted.mediaType,
          targetSession: sender.session,
        })
      }
      const candidateWindow = getContextWindow(context)
      const hostWindow = candidateWindow && !candidateWindow.isDestroyed() ? candidateWindow : null
      if (!hostWindow) throw new Error('The attachment request does not belong to an active Home window.')
      if (action === 'OPEN_CHAT_ATTACHMENT_VIEWER') {
        const streamUrl = issueHomeV2DesktopPrivateBytesStream({
          binding: homeV2ResourceStreamBinding({
            context,
            network,
            nodeApiUrl: decrypted.node.nodeApiUrl,
            protocol,
            routeRevision: hostInfo.route.revision,
          }),
          bytes: decrypted.bytes,
          isStillValid: decrypted.isStillValid,
          mimeType: decrypted.mediaType,
          targetSession: hostWindow.webContents.session,
        })
        const { descriptor } = normalizeHomeV2PrivateAttachmentAccessRequest(protocol, requestValue)
        hostWindow.webContents.send('home-v2-app:open-resource-viewer', {
          filename: decrypted.filename,
          identifier: descriptor.resource.identifier,
          mimeType: decrypted.mediaType,
          name: descriptor.resource.name,
          network,
          path: null,
          service: descriptor.resource.service,
          sourceTabId: context.tabId,
          streamUrl,
        })
        return true
      }
      const selection = await dialog.showSaveDialog(hostWindow, {
        defaultPath: nodePath.join(app.getPath('downloads'), decrypted.filename),
        title: 'Save private chat attachment',
      })
      if (selection.canceled || !selection.filePath) return { canceled: true }
      if (!(await decrypted.isStillValid())) throw new Error('The app, account, or node route changed before attachment save.')
      await writeFile(selection.filePath, decrypted.bytes)
      return { canceled: false }
    } finally {
      decrypted.bytes.fill(0)
    }
  }
  if (action === 'OPEN_AS_WIDGET') {
    const prepared = await prepareWidgetLaunch(context)
    await requireWidgetPermission(context, protocol, () => getQdnViewContextForWebContents(sender))
    return handleOpenAsWidget(context, prepared)
  }
  if (action === 'WIDGET_CLOSE') {
    return handleWidgetClose(context)
  }
  if (
    action === 'WIDGET_END_DRAG' ||
    action === 'WIDGET_GET_STATE' ||
    action === 'WIDGET_RESIZE' ||
    action === 'WIDGET_SET_REGIONS' ||
    action === 'WIDGET_START_DRAG'
  ) {
    return handleWidgetAction(context, action, requestValue)
  }
  if (action === 'OPEN_NEW_TAB') {
    const address = normalizeHomeV2OpenAddress(requestValue)
    const hostWindow = getContextWindow(context)
    if (!hostWindow || hostWindow.isDestroyed()) {
      throw new Error('The app request does not belong to an active Home window.')
    }
    hostWindow.webContents.send('home-v2-app:open-address', {
      address,
      // Both come from this trusted view context, never the request. The
      // renderer binds the new tab to the ORIGINATING tab's account (looked up
      // by these two), not whatever account is globally selected now, so an
      // app can only ever open a resource under its own account.
      sourceTabId: context.tabId,
      sourceResourceLocation: context.resourceUrl,
    })
    return true
  }
  // OPEN_CURRENT_TAB replaces the content of the tab the app is already
  // running in. It shares OPEN_NEW_TAB's validator and its no-prompt posture:
  // navigating your own tab is strictly weaker than adding one to the strip,
  // and Home still owns where the address resolves to.
  //
  // The target tab is `context.tabId` — the trusted view context this request
  // arrived on — and nothing from `requestValue` can influence it. An app may
  // never navigate a tab it does not own, so there is deliberately no
  // caller-supplied tab field to validate. (Home 1.x bound the same way; see
  // electron/qdn.ts:9771.)
  if (action === 'OPEN_CURRENT_TAB') {
    // The same shared address validator OPEN_NEW_TAB uses, plus the two rules
    // a replacement adds: it must be an app resource, and it must name its
    // identifier. Both are checked HERE so the bridge call itself fails —
    // enforcing them in the renderer alone means the refusal is discarded and
    // the app is told `true` for a replacement that never happened.
    const address = normalizeHomeV2ReplaceTabAddress(requestValue)
    const hostWindow = getContextWindow(context)
    if (!hostWindow || hostWindow.isDestroyed()) {
      throw new Error('The app request does not belong to an active Home window.')
    }
    if (!context.resourceUrl) {
      throw new Error('OPEN_CURRENT_TAB needs the requesting app to have a stable app identity.')
    }
    hostWindow.webContents.send('home-v2-app:open-address-in-tab', {
      address,
      // Both fields come from this trusted view context, never the request.
      // `fromResourceLocation` is the compare half of the renderer's
      // compare-and-swap: it records which app held the tab when the request
      // was made, so a replacement that arrives late can never land on a tab
      // some other app has taken over in the meantime.
      fromResourceLocation: context.resourceUrl,
      tabId: context.tabId,
    })
    return true
  }
  // Beside GET_SELECTED_ACCOUNT because that is exactly what it is: the same
  // address, relabelled for wallet apps. No node call, no key derivation, no
  // unlocked account. The FOREIGN branch Home 1.x had here — which derived a
  // BTC/LTC/… HD wallet from the account seed — is deliberately absent, and
  // refused with a coded error rather than silently returning the native
  // address for a foreign coin, which would be the dangerous failure: an app
  // showing a Qortium address as somebody's Bitcoin receive address.
  if (action === 'GET_USER_WALLET') {
    if (isHomeV2NativeWalletRequest(requestValue)) {
      await requireAccountReadPermission(sender, context, protocol, action)
      const profile = await getAccountProfile(context.accountId as string)
      return buildHomeV2UserWalletResult(profile.address)
    }
    const derived = await deriveHomeV2ForeignWallet(
      sender,
      context,
      protocol,
      action,
      requestValue,
    )
    return getForeignWalletPublicResponse(derived.wallet)
  }
  if (isHomeV2ForeignWalletReadAction(action)) {
    return readHomeV2ForeignWallet(
      sender,
      context,
      protocol,
      action as 'GET_WALLET_BALANCE' | 'GET_USER_WALLET_INFO' | 'GET_USER_WALLET_TRANSACTIONS',
      requestValue,
    )
  }
  if (isHomeV2ForeignWalletAdminAction(action)) {
    return setHomeV2ForeignServer(sender, context, protocol, requestValue)
  }
  if (action === 'GET_SELECTED_ACCOUNT' || action === 'GET_USER_ACCOUNT') {
    await requireAccountReadPermission(sender, context, protocol, action)
    const profile = await getAccountProfile(context.accountId as string)
    if (action === 'GET_USER_ACCOUNT') {
      const { result } = await fetchRead(
        'qortal',
        `/addresses/${encodeURIComponent(profile.address)}`,
        'GET',
        256 * 1024,
      )
      const accountData = responseDataOrThrow(result, 'Qortal account lookup')
      const publicKey = stringField(accountData, 'publicKey')
      return { address: profile.address, publicKey }
    }
    return {
      address: profile.address,
      avatarContract: 'pointer-aware-account-avatar-v1',
      avatarUrl: null,
      isUnlocked: isAccountUnlocked(context.accountId as string),
      name: profile.name,
    }
  }
  if (action === 'UNLOCK_SELECTED_ACCOUNT') {
    await requireAccountReadPermission(sender, context, protocol, action)
    const profile = await getAccountProfile(context.accountId as string)
    return {
      address: profile.address,
      avatarContract: 'pointer-aware-account-avatar-v1',
      avatarUrl: null,
      isUnlocked: true,
      name: profile.name,
    }
  }
  if (isHomeV2PublicChatAction(action)) {
    return sendHomeV2PublicChatAction(sender, context, protocol, network, action, requestValue)
  }
  if (isHomeV2DirectChatWriteAction(action)) {
    return sendHomeV2DirectChatAction(sender, context, protocol, network, action, requestValue)
  }
  if (isHomeV2DirectChatReadAction(action)) {
    return readHomeV2DirectChatAction(sender, context, protocol, network, action, requestValue)
  }
  if (isHomeV2PrivateGroupChatWriteAction(action)) {
    return network === 'qortal'
      ? sendHomeV2QortalPrivateGroupChatAction(sender, context, protocol, action, requestValue)
      : sendHomeV2PrivateGroupChatAction(sender, context, protocol, action, requestValue)
  }
  if (isHomeV2PrivateGroupChatReadAction(action)) {
    return network === 'qortal'
      ? readHomeV2QortalPrivateGroupChatAction(sender, context, protocol, action, requestValue)
      : readHomeV2PrivateGroupChatAction(sender, context, protocol, action, requestValue)
  }
  if (isHomeV2GroupMembershipAction(action)) {
    return sendHomeV2GroupMembershipAction(sender, context, protocol, network, action, requestValue)
  }
  if (isHomeV2GroupAdminAction(action)) {
    return sendHomeV2GroupAdminAction(sender, context, protocol, network, action, requestValue)
  }
  if (isHomeV2MintingReadAction(action)) {
    return action === 'GET_MINTING_STATUS'
      ? readHomeV2MintingStatus(network, context, requestValue)
      : readHomeV2MintingAccounts(network)
  }
  if (isHomeV2MintingWriteAction(action)) {
    return action === 'START_MINTING'
      ? startHomeV2Minting(sender, context, protocol, network)
      : removeHomeV2MintingAccount(sender, context, protocol, network, requestValue)
  }
  if (action === 'GET_NAME_DATA' || action === 'GET_ACCOUNT_NAMES' || action === 'GET_PRIMARY_NAME') {
    const path = buildHomeV2NamePath(action, requestValue)
    const { result } = await fetchRead(network, path, 'GET', normalizeHomeV2ResponseMaxBytes(requestValue.maxBytes))
    return responseDataOrThrow(result, `${action} request`)
  }
  if (action === 'GET_ACCOUNT_DATA' || action === 'GET_BALANCE') {
    // Two Home 1.x behaviors restored (see home-v2-wallet-actions.ts):
    //   - an absent address means "the selected account", instead of failing;
    //   - GET_BALANCE honors `assetId` instead of silently answering with the
    //     native balance for every asset.
    // Both are neutral: the default subject is the caller's own account, whose
    // address the app can already read permissionlessly.
    const address = resolveHomeV2AccountReadAddress(requestValue, await selectedSubjectAddress())
    const path = action === 'GET_BALANCE'
      ? buildHomeV2AccountBalancePath(address, requestValue)
      : buildHomeV2AccountDataPath(address)
    const { result } = await fetchRead(
      network,
      path,
      'GET',
      normalizeHomeV2ResponseMaxBytes(requestValue.maxBytes),
    )
    return responseDataOrThrow(result, `${action} request`)
  }
  // The two trust reads. Each combines a public summary with this rater's own
  // rating; a 404 on either half means "not rated yet", not an error.
  if (isHomeV2RatingReadAction(action)) {
    const read = buildHomeV2RatingRead(
      action,
      requestValue,
      homeV2RatingReadNeedsSelectedAddress(requestValue) ? await selectedSubjectAddress() : null,
    )
    const maxBytes = normalizeHomeV2ResponseMaxBytes(requestValue.maxBytes)
    const [summary, rating] = await Promise.all([
      fetchRead(network, read.summaryPath, 'GET', maxBytes)
        .then(({ result }) => (result.status === 404 ? null : responseDataOrThrow(result, `${action} summary`))),
      fetchRead(network, read.ratingPath, 'GET', maxBytes)
        .then(({ result }) => (
          result.status === 404 ? read.ratingFallback : responseDataOrThrow(result, `${action} rating`)
        )),
    ])
    return buildHomeV2RatingReadResult(read, summary, rating)
  }
  if (isHomeV2AtMessageAction(action)) {
    return sendHomeV2AtMessage(sender, context, protocol, network, requestValue)
  }
  if (action === 'GET_MARKET_PRICES') {
    return readHomeV2MarketPrices(requestValue)
  }
  if (
    action === 'GET_ASSET_INFO' ||
    action === 'GET_ASSET_BALANCES' ||
    action === 'GET_ASSET_TRANSFERS'
  ) {
    const { result } = await fetchRead(
      network,
      buildHomeV2AssetReadPath(action, requestValue),
      'GET',
      normalizeHomeV2ResponseMaxBytes(requestValue.maxBytes),
    )
    return responseDataOrThrow(result, `${action} request`)
  }
  if (isHomeV2ChainReadAction(action)) {
    // GET_MEMBER_BANS / GET_MEMBER_KICKS default their address to the selected
    // account, the way Home 1.x did. Resolved lazily so no other chain read
    // pays for an account lookup it does not use.
    const chainReadRequest = homeV2ChainReadNeedsSelectedAddress(action, requestValue)
      ? withHomeV2SelectedAddress(requestValue, await selectedSubjectAddress())
      : requestValue
    const path = buildHomeV2ChainReadPath(action, chainReadRequest)
    const { result } = await fetchRead(
      network,
      path,
      'GET',
      normalizeHomeV2ResponseMaxBytes(requestValue.maxBytes),
    )
    if (isHomeV2CrosschainReadAction(action)) {
      // The `/crosschain` family keeps the two 1.x response projections: the
      // QORT row added to the blockchain list, and feekb normalized to a
      // per-byte fee.
      // Reading needs an administratively trusted Core. SENDING needs three
      // more things, each checked rather than assumed: a selected account that
      // is unlocked (the signing keys come from its seed), and a Core new
      // enough to have the route the send actually uses. An older trusted Core
      // advertised as able to send would 404 at the last moment, which is
      // exactly the capability-that-lies case. Never on a public or untrusted
      // route, and an app that sees send:false cannot make it true by asking.
      const foreignWalletDiscovery = action === 'GET_CROSSCHAIN_BLOCKCHAINS'
        ? await resolveHomeV2AdminNode('qortium').then(
            async (resolved) => {
              if (!resolved.trust.trusted) return { send: false, trusted: false }
              const unlocked = !!context.accountId && isAccountUnlocked(context.accountId)
              const send = unlocked && await probeHomeV2ForeignSendRouteSupported(
                resolved.node.nodeApiUrl,
                resolved.apiKey,
                resolved.trust.revision,
              )
              return { send, trusted: true }
            },
            () => ({ send: false, trusted: false }),
          )
        : { send: false, trusted: false }
      const foreignWalletTrustedCoreAvailable = foreignWalletDiscovery.trusted
      const foreignWalletSendAvailable = foreignWalletDiscovery.send
      return projectHomeV2CrosschainReadResult(
        action,
        chainReadRequest,
        responseDataOrThrow(result, `${action} request`),
        true,
        foreignWalletTrustedCoreAvailable,
        foreignWalletSendAvailable,
      )
    }
    // Both cores answer a valid-but-absent AT with an empty 2xx body (Qortal
    // 204s); normalize that to one documented error instead of returning ''.
    if (
      (action === 'GET_AT' || action === 'GET_AT_DATA') &&
      result.ok &&
      (result.status === 204 || result.data === '' || result.data === null)
    ) {
      throw new Error('AT not found.')
    }
    return responseDataOrThrow(result, `${action} request`)
  }
  if (action === 'RESOLVE_IDENTITIES') return resolveIdentities(requestValue)
  if (action === 'FETCH_ACCOUNT_AVATAR' || action === 'FETCH_GROUP_AVATAR') {
    return fetchAvatar(network, action, requestValue)
  }
  if (
    action === 'FETCH_QDN_RESOURCE' ||
    action === 'LIST_QDN_RESOURCES' ||
    action === 'SEARCH_QDN_RESOURCES' ||
    action === 'GET_QDN_RESOURCE_METADATA' ||
    action === 'GET_QDN_RESOURCE_PROPERTIES' ||
    action === 'GET_QDN_RESOURCE_STATUS'
  ) {
    const path = buildHomeV2ResourcePath(action, requestValue)
    const { result } = await fetchRead(
      network,
      path,
      'GET',
      normalizeHomeV2ResponseMaxBytes(requestValue.maxBytes),
    )
    return responseDataOrThrow(result, `${action} request`)
  }
  if (action === 'GET_QDN_RESOURCE_URL') {
    return (await resolveHomeV2ResourceUrl(network, requestValue, context)).url
  }
  if (action === 'GET_QDN_RESOURCE_STREAM_URL') {
    const resource = getQdnResourceStreamRequest(requestValue as QdnAppRequest)
    const resolved = await resolveHomeV2ResourceUrl(network, requestValue, context, true)
    return issueHomeV2ResourceStream({
      context,
      mimeType: getQdnResourceStreamProxyMimeType(resource),
      network,
      node: resolved.node,
      protocol,
      routeRevision: hostInfo.route.revision,
      sender,
      targetSession: sender.session,
      upstreamUrl: resolved.url,
    })
  }
  if (action === 'OPEN_QDN_RESOURCE_VIEWER') {
    const resource = getQdnResourceViewerRequest(requestValue as QdnAppRequest)
    const hostWindow = getContextWindow(context)
    if (!hostWindow || hostWindow.isDestroyed()) {
      throw new Error('The resource viewer request does not belong to an active Home window.')
    }
    const resolved = await resolveHomeV2ResourceUrl(network, requestValue, context)
    const streamUrl = issueHomeV2ResourceStream({
      context,
      mimeType: getQdnResourceStreamProxyMimeType(resource),
      network,
      node: resolved.node,
      protocol,
      routeRevision: hostInfo.route.revision,
      sender,
      targetSession: hostWindow.webContents.session,
      upstreamUrl: resolved.url,
    })
    hostWindow.webContents.send('home-v2-app:open-resource-viewer', {
      ...resource,
      network,
      sourceTabId: context.tabId,
      streamUrl,
    })
    return true
  }
  if (action === 'SAVE_QDN_RESOURCE') {
    const resource = getQdnResourceViewerRequest(requestValue as QdnAppRequest)
    const candidateWindow = getContextWindow(context)
    const hostWindow = candidateWindow && !candidateWindow.isDestroyed() ? candidateWindow : null
    if (!hostWindow) {
      throw new Error('The resource save request does not belong to an active Home window.')
    }
    const nodeBefore = await getHomeV2ReadableNode(network)
    const nodeRoute = `${nodeBefore.mode}|${nodeBefore.nodeApiUrl}`
    const fallback = `${resource.service}_${resource.name}_${resource.identifier ?? 'default'}`
    const filename = sanitizeHomeV2ResourceFilename(resource.filename, fallback)
    const options = {
      title: `Save ${network === 'qortal' ? 'Qortal' : 'Qortium'} resource`,
      defaultPath: nodePath.join(app.getPath('downloads'), filename),
    }
    const selection = await dialog.showSaveDialog(hostWindow, options)
    if (selection.canceled || !selection.filePath) return { canceled: true }
    const fresh = getQdnViewContextForWebContents(sender)
    if (!fresh || !sameViewContext(context, fresh) || !liveResourceMatchesGrant(fresh)) {
      throw new Error('The app or tab changed before the resource save began.')
    }
    const { bytes } = await readHomeV2ResourceBytes(network, requestValue, nodeRoute)
    await writeFile(selection.filePath, bytes)
    return { canceled: false }
  }
  const path =
    action === 'GET_NODE_STATUS'
      ? '/admin/status'
      : action === 'GET_NODE_INFO'
        ? '/admin/info'
        : action === 'GET_NODE_SETTINGS_METADATA'
          ? '/admin/settings/metadata'
        : action === 'FETCH_NODE_API' || action === 'FETCH_QORTAL_NODE_API'
          ? normalizeHomeV2ReadPath(requestValue.path)
          : null
  if (!path) throw new Error(`${action} is not available in Home v2 read-only mode.`)
  const method = normalizeHomeV2ReadMethod(requestValue.method)
  const { result } = await fetchRead(
    network,
    path,
    method,
    normalizeHomeV2ResponseMaxBytes(requestValue.maxBytes),
  )
  if (action === 'GET_NODE_STATUS' || action === 'GET_NODE_INFO' || action === 'GET_NODE_SETTINGS_METADATA') {
    if (!result.ok) throw new Error(`Node request returned HTTP ${result.status}.`)
    return result.data
  }
  return result
}

async function handleRequest(
  sender: WebContents,
  context: QdnViewContext,
  protocol: HomeV2AppBridgeProtocol,
  requestValue: unknown,
) {
  let action = 'UNKNOWN'
  let hostInfo: HomeV2AppHostInfo | null = null
  try {
    if (!isHomeV2AppRecord(requestValue)) {
      throw createHomeV2BridgeError('App requests must be objects.', {
        action,
        code: 'VALIDATION_FAILED',
        network: getHomeV2AppNetwork(protocol, action),
        retryable: false,
      })
    }
    // Collapse a compatibility alias onto the action that implements it before
    // anything else looks at `action`, so the catalogue gate, the network
    // choice, permission keys and error reports all see one canonical name.
    // Resolves the action AND the request together: the Qortal-compatibility
    // aliases rewrite the request shape, so renaming without rewriting would
    // fail deep inside the canonical handler.
    const alias = resolveHomeV2AppAlias(
      normalizeHomeV2AppAction(requestValue),
      isHomeV2AppRecord(requestValue) ? requestValue : {},
      protocol,
    )
    action = alias.action
    const aliasedRequest: Record<string, unknown> = alias.request
    const network = getHomeV2AppNetwork(protocol, action)
    const [qortalNode, qortiumNode] = await Promise.all([
      getHomeV2AppNodeState('qortal'),
      getHomeV2AppNodeState('qortium'),
    ])
    const qortiumAdminTrusted = qortiumNode.capabilities.read && !!qortiumNode.nodeApiUrl &&
      await resolveHomeV2AdminNode('qortium').then(({ trusted }) => trusted, () => false)
    const qualifiedQortiumNode = { ...qortiumNode, adminTrusted: qortiumAdminTrusted }
    hostInfo = getHomeV2AppHostInfo({
      accountId: context.accountId,
      hostVersion: app.getVersion(),
      node: network === 'qortal' ? qortalNode : qualifiedQortiumNode,
      platform: 'desktop',
      platformVersion: '2.1',
      protocol,
    })
    const routes = {
      qortal: getHomeV2AppRouteDescriptor({
        accountId: context.accountId,
        network: 'qortal',
        node: qortalNode,
        platform: 'desktop',
        protocol: 'qortalRequest',
      }),
      qortium: getHomeV2AppRouteDescriptor({
        accountId: context.accountId,
        network: 'qortium',
        node: qualifiedQortiumNode,
        platform: 'desktop',
        protocol: 'qdnRequest',
      }),
    }
    // Compute the contextual action surface FIRST, before any journal
    // inspection. The journal conflict error names a retained signature, and a
    // widget must never see one: SEND_MESSAGE is not in a widget's contextual
    // list, but it IS a journaled mutation, so a widget calling a denied
    // SEND_MESSAGE during an unresolved send would otherwise be handed the
    // pending signature back — enough to recover the sender identity that
    // widget self-subject withholding exists to protect. Gating the journal
    // block on availability means an unavailable action skips it entirely and
    // falls through to handleRequestWithRuntime, which throws the standard
    // "not available in this context" error carrying no signature.
    const contextualActions = getHomeV2ContextualAppActions(
      getHomeV2AvailableAppActions(protocol, routes),
      isWidgetTabId(context.tabId) ? 'widget' : 'tab',
    )
    // The Base58 journal is the NATIVE chain's. A foreign send is journaled by
    // txid in the foreign write-ahead log instead, and must be kept out of
    // this one entirely: its results carry no Base58 signature, so recording
    // one would throw and fail-close every native payment for the account.
    const foreignSend = isHomeV2ForeignSendRequest(action, aliasedRequest)
    if (
      context.accountId &&
      !foreignSend &&
      contextualActions.includes(action) &&
      isHomeV2JournaledMutation(action)
    ) {
      const pending = findStoredHomeV2PendingTransactionConflict(app.getPath('userData'), {
        accountId: context.accountId,
        action,
        appIdentity: homeV2AppIdentityKey(context),
        network,
        // The ALIASED request: the journal key must describe the canonical
        // action's target, and an alias that rewrote the shape would otherwise
        // be keyed on fields the canonical action never sees.
        request: aliasedRequest,
      })
      if (pending) {
        throw createHomeV2BridgeError(
          `A previous ${action} for this target has an unknown outcome. Reconcile signature ${pending.signature} before submitting another.`,
          {
            action,
            code: 'PENDING_TRANSACTION_RECONCILIATION_REQUIRED',
            network,
            outcome: 'unknown',
            retryable: false,
            routeRevision: hostInfo.route.revision,
          },
        )
      }
    }
    const result = await handleRequestWithRuntime(
      sender,
      context,
      protocol,
      aliasedRequest,
      action,
      hostInfo,
      contextualActions,
    )
    try {
      const entry = context.accountId && !foreignSend
        ? createHomeV2PendingTransactionFromResult({
            accountId: context.accountId,
            action,
            appIdentity: homeV2AppIdentityKey(context),
            protocol,
            // The ALIASED request, matching the conflict lookup above. Storing
            // one target and checking retries against another would make the
            // block unreachable for a future shape-changing alias on a
            // journaled mutation.
            request: aliasedRequest,
            result,
          })
        : null
      if (!entry) return result
      recordHomeV2PendingTransaction(app.getPath('userData'), entry)
      return isHomeV2AppRecord(result) ? Object.freeze({ ...result, journalStored: true }) : result
    } catch (error) {
      console.warn('[home-v2-app] Unable to retain an ambiguous signed transaction:', error)
      // FAIL CLOSED for money: a signed payment whose unknown outcome could
      // not be persisted must block further payment actions for the account
      // rather than allowing a retry the journal can no longer prevent.
      if (isHomeV2PaymentAction(action) && context.accountId) {
        recordHomeV2PaymentJournalFailure(context.accountId)
      }
      return isHomeV2AppRecord(result) ? Object.freeze({ ...result, journalStored: false }) : result
    }
  } catch (error) {
    throw normalizeHomeV2BridgeError(error, {
      action,
      network: hostInfo?.network ?? getHomeV2AppNetwork(protocol, action),
      routeRevision: hostInfo?.route.revision,
    })
  }
}

export function registerHomeV2AppBridgeIpcHandlers() {
  // An app view that navigates replaces the document that asked, so its pending
  // Home-settings prompts are dropped rather than left to expire. Registered
  // here, not imported the other way round, to keep qdn-views free of a cycle.
  onQdnViewNavigated(({ hostWebContentsId, tabId }) => {
    forgetHomeV2TabPendingHomeSettingsPrompts(hostWebContentsId, tabId)
  })
  // "Open as widget" in the toolbar. The shell names a tab; the app view's own
  // context is then resolved in the main process, so the request cannot point
  // at a resource the tab is not actually showing. The permission gate and the
  // launch path are the same ones OPEN_AS_WIDGET uses.
  //
  // The result is a plain object rather than the qdn bridge envelope: that
  // envelope exists so an app cannot forge an error back to itself, and this
  // channel is only reachable from Home's own shell.
  ipcMain.handle('home-v2-widgets:open', async (event, value: unknown) => {
    try {
      const tabId = stringField(value, 'tabId')
      if (!tabId) throw new Error('Opening a widget needs a tab.')
      // event.sender.id is the host window's webContents id, which is exactly
      // what qdn-views keys its per-window view map by.
      const context = getQdnViewContextForTab(event.sender.id, tabId)
      if (!context) throw new Error('That tab is not showing a published app.')
      const protocol = context.resourceUrl?.toLowerCase().startsWith('qortal://')
        ? 'qortalRequest'
        : 'qdnRequest'
      const prepared = await prepareWidgetLaunch(context)
      // Re-read by tab, not by sender: the sender here is the Home shell, which
      // is not a QDN view and never resolves as one.
      await requireWidgetPermission(
        context,
        protocol,
        () => getQdnViewContextForTab(event.sender.id, tabId),
      )
      const { widgetId } = handleOpenAsWidget(context, prepared)
      return { ok: true, widgetId }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })
  // Availability for the toolbar control. Whether an app publishes a widget
  // face is only knowable from its manifest on the node, and the shell
  // renderer's session blocks every network request, so the shell has to ask
  // main. This is discovery ONLY: no permission prompt, no capacity check, no
  // widget created.
  //
  // A thrown manifest error answers `available: true` on purpose. A malformed
  // manifest is a real problem the user should see, and hiding the control
  // would silently downgrade it to "this app has no widget" - exactly the
  // distinction widget-discovery.ts draws between null and a throw. Only a
  // clean null (the node's 404 for a missing widget.json) hides the button.
  ipcMain.handle('home-v2-widgets:probe', async (event, value: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    const tabId = stringField(value, 'tabId')
    if (!tabId) return { available: false }
    // Resolved by tab through the same map 'home-v2-widgets:open' uses, so the
    // probe can only ever describe what that tab is actually showing.
    const context = getQdnViewContextForTab(event.sender.id, tabId)
    if (!context) return { available: false }
    // A widget tab, or a tab that is not showing a published resource, can
    // never have a widget: that is a fact about the tab, not about a manifest,
    // so it hides the control rather than reporting it as available.
    let identity: WidgetResourceIdentity
    try {
      identity = resolveWidgetLaunchIdentity(context).identity
    } catch {
      return { available: false }
    }
    try {
      return { available: (await discoverContextWidgetManifest(context, identity)) !== null }
    } catch {
      return { available: true }
    }
  })
  ipcMain.handle('home-v2-widgets:sync-state', async (_event, value: unknown) => {
    await syncWidgetQdnViewState(value)
  })
  const invalidateRuntime = (hostWebContentsId: number, value: unknown) => {
    const invalidation = normalizeHomeV2RuntimeInvalidation(value)
    sessionAccountReadGrants.invalidate(hostWebContentsId, invalidation)
    widgetGrants.clear()
    // Retain rate history across navigation and route invalidations so an app
    // cannot bypass the send ceiling by causing either event. Account changes
    // and locks end the signing context and may safely reset all buckets.
    if (invalidation.kind === 'account-changed' || invalidation.kind === 'locked') {
      chatSendRateLimiter.reset()
    }
    homeV2DesktopPublishSources.clear()
    clearHomeV2DesktopResourceStreams()
    // Close any open Home context menu — native link menu or app-invoked —
    // bound to the affected host/tab/network. A network-agnostic menu (a plain
    // selection copy, targetNetwork null) is closed by any non-network-scoped
    // invalidation for that host+tab, but a bare network switch leaves it be.
    closeQdnViewContextMenus((registration) => {
      if (registration.hostWebContentsId !== hostWebContentsId) return false
      if (invalidation.tabId && registration.tabId !== invalidation.tabId) return false
      if (invalidation.network) {
        // A network-scoped invalidation closes only menus for that network. A
        // network-agnostic menu (a plain selection copy, targetNetwork null)
        // survives a bare network switch — non-network-scoped invalidations
        // (account change / lock, below) still close it.
        if (registration.targetNetwork === null) return false
        if (registration.targetNetwork !== invalidation.network) return false
      }
      return true
    })
    for (const [requestId, pending] of pendingAccountReads) {
      if (pending.hostWebContentsId !== hostWebContentsId) continue
      if (invalidation.tabId && pending.tabId !== invalidation.tabId) continue
      if (invalidation.network && pending.targetNetwork !== invalidation.network) continue
      pendingAccountReads.delete(requestId)
      clearTimeout(pending.timeout)
      pending.resolve({ approved: false, scope: null })
    }
  }
  ipcMain.on('home-v2-app:account-locked', (event) => {
    invalidateRuntime(event.sender.id, { kind: 'locked' })
  })
  ipcMain.on('home-v2-app:invalidate-runtime', (event, value: unknown) => {
    try {
      invalidateRuntime(event.sender.id, value)
    } catch (error) {
      console.warn('[home-v2-app] Ignoring invalid runtime invalidation:', error)
    }
  })
  ipcMain.on('home-v2-app:permission-resolve', (event, value: unknown) => {
    if (!isHomeV2AppRecord(value) || typeof value.requestId !== 'string') return
    const pending = pendingAccountReads.get(value.requestId)
    if (!pending || pending.hostWebContentsId !== event.sender.id) return
    pendingAccountReads.delete(value.requestId)
    clearTimeout(pending.timeout)
    const approved = value.approved === true
    const scope = value.scope === 'always'
      ? 'always'
      : value.scope === 'session'
        ? 'session'
        : 'single-request'
    pending.resolve({ approved, scope: approved ? scope : null })
  })
  /**
   * The retained foreign write-ahead entries, for Home's own Settings surface.
   *
   * Read-only and shell-only on purpose. It is NOT a QDN action and it is not
   * reachable from an app: an app must not be able to enumerate which
   * transactions a wallet has outstanding, and there is deliberately no
   * companion that removes one. Clearing happens only through automatic
   * reconciliation, which requires the exact transaction id to appear in the
   * wallet's own history on the trusted node.
   */
  ipcMain.handle('home-v2-app:foreignWalletPendingTransactions', (event) => {
    assertAuthorizedHomeV2Sender(event)
    return listStoredForeignWalletPendingTransactions(app.getPath('userData')).map((entry) => ({
      broadcastAttemptedAt: entry.broadcastAttemptedAt ?? null,
      chainId: entry.chainId,
      coin: entry.coin,
      createdAt: entry.createdAt,
      stage: entry.stage,
      txId: entry.txId,
      walletFingerprint: entry.walletFingerprint,
    }))
  })
  // The shell window's reply to a Home-settings round-trip. Mirrors
  // 'qdn-app:resolveBookmarkManagerRequest' in home-v2-collections-bridge.ts:
  // the reply is only accepted from the window the request was sent to, an
  // error envelope is turned back into a coded rejection, and the settings
  // payload is re-validated against the shared contract before it can reach an
  // app.
  ipcMain.handle('home-v2-app:resolveHomeSettingsRequest', (event, response: unknown) => {
    assertAuthorizedHomeV2Sender(event)
    if (!isHomeV2AppRecord(response) || typeof response.requestId !== 'string' || !response.requestId) {
      throw new Error('Home settings response is required.')
    }
    const pending = pendingHomeSettingsRequests.get(response.requestId)
    if (!pending) return
    if (pending.hostWebContentsId !== event.sender.id) {
      throw new Error('Home settings response came from the wrong window.')
    }
    if (typeof response.error === 'string' && response.error.trim()) {
      pending.reject(Object.assign(new Error(response.error.trim()), {
        code: typeof response.code === 'string' && response.code ? response.code : 'HOME_DATA_ERROR',
      }))
      return
    }
    try {
      pending.resolve(parseHomeV2HomeSettingsRoundTripResponse(response).settings)
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error('Invalid Home settings response.'))
    }
  })
  ipcMain.handle(
    'home-v2-app:request',
    async (event, protocolValue: unknown, request: unknown) => {
      try {
        const context = getQdnViewContextForWebContents(event.sender)
        if (!context) {
          throw new Error('Home v2 app requests require an isolated app view.')
        }
        return encodeQdnBridgeResult(
          await handleRequest(
            event.sender,
            context,
            normalizeHomeV2AppProtocol(protocolValue),
            request,
          ),
        )
      } catch (error) {
        return encodeQdnBridgeError(error)
      }
    },
  )
}
