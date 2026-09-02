import { app, BrowserWindow, dialog, ipcMain, Notification, type WebContents } from 'electron';
import { extractZipSafely } from './safe-zip-extraction.js';
import { zipSync } from 'fflate';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { copyFile, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import nacl from 'tweetnacl';
import {
  accountExists,
  assertAccountUnlocked,
  getAccountForeignWalletSeed,
  getActiveAccountAddress,
  getAccountProfile,
  getAccountSecretKey,
  getAccountSigningKey,
  isAccountUnlocked,
  signChatTransaction,
  stampTransactionNonce,
} from './accounts.js';
import {
  sanitizeQdnNotificationIds,
  sanitizeQdnNotificationSubscriptions,
} from './notification-rules.js';
import {
  grantAppNotifications,
  hasNotificationGrant,
  readNotificationStore,
  removeAppNotificationRules,
  replaceNotificationStore,
  replaceAppNotificationRules,
} from './notification-store.js';
import {
  applyQdnNotificationManagerMutation,
  getQdnNotificationManagerSummary,
  sanitizeQdnNotificationManagerMutation,
} from './notification-manager.js';
import { isPrivateQdnService, isPublicQdnService } from './qdn-public-services.js';
import {
  assertQortiumAddress,
  getBoolean,
  getAccountBalancePath,
  getAssetBalancesPath,
  getAssetInfoPath,
  getAssetTransfersPath,
  getExactQdnApprovalValue,
  getInlinePublishData,
  getInteger,
  getNodeApiPath,
  getNodeSettingsPatch,
  getNumber,
  getOptionalAddressRequestString,
  getOptionalBase58RequestString,
  getOptionalBooleanRequestValue,
  getOptionalIntegerRequestValue,
  getOptionalStringRequestValue,
  getQdnAppMaxBytes,
  getQdnWriteResourceRequest,
  getReadOnlyMethod,
  getRequestAssetId,
  getRequestPayload,
  getRequestValue,
  getRequiredAddressRequestString,
  getRequiredAmountValue,
  getRequiredGroupId,
  getRequiredNameRequestString,
  getRequiredRequestString,
  getService,
  getString,
  getTransactionFee,
  getTransactionGroupId,
  getWritableSettingKeys,
  hasRequestValue,
  isNativeAssetRequest,
  isRecord,
  NATIVE_ASSET_ID,
  QDN_APP_DEFAULT_MAX_BYTES,
  type QdnAppRequest,
  type QdnWriteResourceRequest,
} from './qdn-request-values.js';
import {
  buildHomeBlockchainDiscovery,
  type HomeWalletCapability,
} from './qdn-wallet-capabilities.js';
import { HOME_V2_PUBLISH_PREVIEW_INDEX_FILES } from './home-v2-publish-source-selection.js';
import {
  base58Decode,
  base58Encode,
  BASE58_ALPHABET,
  getSignedTransactionSignature,
} from './base58.js';
import { arbitraryRawToSigningBytes } from './arbitrary-tx.js';
import { fetchBoundedBytes } from './bounded-response.js';
import {
  attestPublicQdnPublish,
  type QdnPublishAttestationSource,
  type QdnPublishVerificationInput,
} from './qdn-content-attestation.js';
import {
  deriveForeignWalletRuntime,
  normalizeForeignWalletCoin,
} from './foreign-wallets.js';
import {
  executeForeignWalletRead,
  getForeignWalletPublicResponse,
  type ForeignWalletReadEndpoint,
} from './foreign-wallet-read-contract.js';
import {
  buildCoinGeckoSimplePricePath,
  buildMarketPriceResponse,
  getMarketPriceCacheKey,
  MARKET_PRICE_CACHE_TTL_MS,
  normalizeMarketPriceCoins,
  normalizeMarketPriceCurrencies,
  type MarketPriceResponse,
} from './market-prices.js';
import { isLoopbackHostname } from './node-ca-bootstrap.js';
import {
  getNodeApiUrl,
  getNodeConnection,
  isInvalidApiKeyResponse,
  refreshNodeConnectionApiKey,
} from './node-settings.js';
import { nodeFetch } from './node-tls.js';
import { prepareQdnArchiveRender } from './qdn-archive-render.js';
import { isQdnBrowserArchiveService } from './qdn-browser-archive-services.js';
import {
  getQdnResourceStreamRequest,
  getQdnResourceViewerRequest,
} from './qdn-resource-viewer-contract.js';
import { getLegacyAccountAvatarHint } from './qdn-identity-avatar.js';
import {
  buildAccountAvatarPath,
  buildAvatarInfoPath,
  buildAccountAvatarPendingResult,
  buildAvatarResourcePath,
  buildLegacyAccountAvatarResource,
  buildLegacyGroupAvatarResource,
  buildGroupAvatarPendingResult,
  buildGroupAvatarPath,
  buildSetAccountAvatarTransactionBody,
  buildSetGroupAvatarTransactionBody,
  getAvatarDescriptorFromHeaders,
  getAvatarDescriptor,
  getAvatarImageContentType,
  getGroupAvatarContentType,
  getGroupAvatarGroupId,
  getGroupAvatarMaxBytes,
  getOptionalAvatarPointer,
  type AccountAvatarFetchResult,
  type GroupAvatarFetchResult,
} from './qdn-group-avatar-input.js';
import {
  appendSignatureToTransactionBytes,
  assertPositiveQortAmount,
  assertValidQortalAddress,
  atomicLongToBigInt,
  buildUnsignedPaymentTransactionBytes,
  formatQortAtomic,
  getSignatureFromSignedTransactionBytes,
  qortDecimalToAtomic,
} from './qortal-payment.js';
import {
  assertOpenQortalGroupMetadata,
  assertPositiveQortalGroupId,
  assertValidQortalChatSignature,
  buildQortalAccountGroupsPath,
  buildQortalGroupChatPayload,
  buildUnsignedQortalGroupChatTransactionBytes,
  qortalChatPowDifficultyForBalance,
  QORTAL_CHAT_POW_DIFFICULTY_BELOW,
  stampQortalGroupChatNonce,
} from './qortal-chat.js';
import {
  buildUnsignedQortiumAtMessageTransactionBytes,
  getQortiumAtMessageRequest,
  QORTIUM_AT_MESSAGE_POW_DIFFICULTY,
} from './qdn-at-message.js';
import { assertUnsignedQortiumAtMessageTransaction } from './qdn-at-message-validation.js';
import { normalizeHomeV2AtMessageRequest } from './home-v2-at-message-actions.js';
import {
  QDN_ACCOUNT_AVATAR_ACTIONS,
  QDN_ACCOUNT_FREE_WRITE_ACTIONS,
  QDN_AT_MESSAGE_ACTIONS,
  QDN_APP_ASSIGNMENT_ACTIONS,
  QDN_APP_BRIDGE_ACTIONS,
  QDN_BOOKMARK_MANAGER_ACTIONS,
  QDN_PUBLIC_NODE_BRIDGE_ACTIONS,
  QDN_CHAT_ACTIONS,
  QDN_FOREIGN_SERVER_ACTIONS,
  QDN_GROUP_ACTIONS,
  QDN_HOME_SETTINGS_ACTIONS,
  QDN_NOTIFICATION_MANAGER_ACTIONS,
  QDN_NAME_ACTIONS,
  QDN_PAYMENT_ACTIONS,
  QDN_POLL_ACTIONS,
  QDN_PRIVATE_GROUP_CHAT_WRITE_ACTIONS,
  QDN_TRUST_ACTIONS,
  QDN_WRITE_ACTIONS,
} from './qdn-app-actions.js';
import {
  validateBookmarkManagerMutationRequest,
  validateBookmarkManagerSnapshot,
  validateBookmarksOpenRequest,
  type BookmarkManagerMutationRequest,
  type BookmarkManagerMutationResult,
  type BookmarkManagerSnapshot,
} from './bookmark-manager-contract.js';
import {
  grantQdnManagerPermission,
  grantQdnAppCapabilityPermission,
  hasQdnAppCapability,
  hasQdnManagerPermission,
  readQdnAppRolesStore,
  setQdnAppAssignmentValue,
} from './qdn-manager-permission-store.js';
import {
  getQdnAppAssignment,
  sanitizeQdnAppAssignmentDescription,
  sanitizeQdnAppAssignmentLabel,
  sanitizeQdnAppAssignmentRole,
  sanitizeQdnAppAssignmentUrl,
  sanitizeQdnManagerAppKey,
  type QdnManagerCapability,
} from './qdn-manager-permissions.js';
import {
  getHomeSettingsApprovalDetails,
  getHomeSettingsMetadata,
  validateHomeSettings,
  validateHomeSettingsPatch,
  type HomeSettings,
} from './home-settings-bridge.js';
import { getPlatformVersion } from './app-versioning.js';
import { encodeQdnBridgeError, encodeQdnBridgeResult } from './qdn-bridge-error.js';
import {
  isQdnFileNotFoundResponse,
  QdnFileNotFoundError,
} from './qdn-file-not-found.js';
import { readableNodeErrorMessage } from './node-error-body.js';
import { shouldStreamQdnPublishSource, shouldUnpackQdnPublishArchive } from './qdn-publish-routing.js';
import { isSameQdnWriteRoute, resolveQdnWriteRoute } from './qdn-write-route.js';
import { getPollOptionsInput } from './qdn-poll-options-input.js';
import {
  getOptionalPollVoteOptionIndexes,
  getPollVoteApprovalName,
  resolvePollVoteOptionInput,
} from './qdn-poll-vote-input.js';
import {
  assertPublicArbitraryTransaction,
  assertPublicChatTransaction,
  assertPublicCreatePollTransaction,
  assertPublicUpdatePollTransaction,
  assertPublicVoteOnPollTransaction,
  getStaticQdnServiceId,
} from './public-transaction-validation.js';
import { parsePublicPollCapabilities, type PublicPollCapabilities } from './public-poll-capabilities.js';
import {
  getQdnViewContextForWebContents,
  isQdnViewFocused,
  sanitizeAppTitle,
  type QdnViewContext,
} from './qdn-views.js';

// Resolve our own directory (mirrors electron/main.ts) so the worker_threads
// PoW worker file can be located next to this module both in dev (dist-electron/)
// and in the packaged app (inside app.asar/dist-electron/).
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CHAT memory-pow difficulty. Tracks the chain config (Previewnet
// previewchain.json chatDifficulty); keep in sync with src/platform.ts.
const CHAT_POW_DIFFICULTY = 8;
const ARBITRARY_POW_DIFFICULTY = 11;
const MEMORY_POW_TIMEOUT_MS = 180_000;
const PUBLIC_POLL_CAPABILITIES_TTL_MS = 5 * 60_000;
const TRANSACTION_NONCE_OFFSET = 48;

const PREVIEW_ACCOUNTS_PATH = path.join(
  os.homedir(),
  'git',
  'qortium',
  'preview',
  'secrets',
  'initial-minting-accounts.json',
);
const QDN_PUBLIC_STREAMED_PUBLISH_MAX_BYTES = 100 * 1024 * 1024;
const QDN_WRITE_SOURCE_MAX_BYTES = 100 * 1024 * 1024;
// Read-only Qortal nodes for cross-chain QDN reads (no account, API key, or writes).
// Desktop builds prefer a synced local mainnet node, then fall back to remote public nodes.
const QORTAL_LOCAL_NODE_API_URL = 'http://127.0.0.1:12391';
const QORTAL_REMOTE_NODE_API_URLS = ['https://ext-node.qortal.link', 'https://api.qortal.org'];
const QORTAL_NODE_CACHE_TTL_MS = 5 * 60_000;
const QORTAL_PROBE_TIMEOUT_MS = 5_000;
const QORTAL_WRITE_TIMEOUT_MS = 30_000;
const QORTAL_PUBLIC_READ_PROBE_PATH =
  '/arbitrary/resources/search?mode=ALL&limit=1&includestatus=false&includemetadata=false';
// Qortal cross-chain resource fetches (e.g. game ROMs) need a much larger ceiling than QDN text reads.
const QDN_APP_QORTAL_DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const QDN_APP_QORTAL_MAX_BYTES_LIMIT = 64 * 1024 * 1024;
const NATIVE_ASSET_LABEL = 'Native Asset';
// Must match the Core renderer's index file list and case-sensitive matching.
// Shared with Home 2's picker, which asserts the same list before it even
// issues a folder source token — two copies would drift the moment Core's
// list changed.
const QDN_PREVIEW_INDEX_FILES = HOME_V2_PUBLISH_PREVIEW_INDEX_FILES;
const QDN_PREVIEW_EXTENSION_SERVICES = new Map([
  ['apng', 'IMAGE'],
  ['avif', 'IMAGE'],
  ['bmp', 'IMAGE'],
  ['gif', 'IMAGE'],
  ['ico', 'IMAGE'],
  ['jpeg', 'IMAGE'],
  ['jpg', 'IMAGE'],
  ['png', 'IMAGE'],
  ['svg', 'IMAGE'],
  ['webp', 'IMAGE'],
  ['m4v', 'VIDEO'],
  ['mkv', 'VIDEO'],
  ['mov', 'VIDEO'],
  ['mp4', 'VIDEO'],
  ['ogv', 'VIDEO'],
  ['webm', 'VIDEO'],
  ['aac', 'AUDIO'],
  ['flac', 'AUDIO'],
  ['m4a', 'AUDIO'],
  ['mp3', 'AUDIO'],
  ['oga', 'AUDIO'],
  ['ogg', 'AUDIO'],
  ['opus', 'AUDIO'],
  ['wav', 'AUDIO'],
]);
const qdnPreviewStagingDirs = new Map<string, string>();
const QDN_WRITE_APPROVAL_TIMEOUT_MS = 120_000;
const QDN_UNLOCK_STATE_WAIT_MS = 1_500;
const QDN_WRITE_SMOKE_ROLE = 'local';
const QDN_CHAT_MESSAGE_MAX_BYTES = 4000;
const QDN_OPEN_NEW_TAB_URL_MAX_LENGTH = 2048;
const QDN_MEDIA_PLAYER_SERVICES = new Set(['AUDIO', 'PODCAST', 'VIDEO', 'VOICE']);
const QDN_MEDIA_PLAYER_FIELD_MAX_LENGTH = 1024;
const QDN_DOCUMENT_VIEWER_SERVICES = new Set(['DOCUMENT', 'FILE', 'FILES', 'ATTACHMENT']);

type QdnAuthorizeResourceRequest = {
  identifier?: unknown;
  name?: unknown;
  service?: unknown;
};

type QdnRawResourceRequest = QdnAuthorizeResourceRequest & {
  allowMissing?: unknown;
  maxBytes?: unknown;
  multiFile?: unknown;
  path?: unknown;
  suggestedFilename?: unknown;
};

type QdnResourcesSearchRequest = {
  exactMatchNames?: unknown;
  includeMetadata?: unknown;
  includeStatus?: unknown;
  limit?: unknown;
  name?: unknown;
  prefix?: unknown;
  service?: unknown;
};

type QdnNamesSearchRequest = {
  limit?: unknown;
  prefix?: unknown;
  query?: unknown;
};

type NodeApiRequest = {
  maxBytes?: unknown;
  method?: unknown;
  path?: unknown;
};

type QdnPreviewContentRequest = {
  kind?: unknown;
  path?: unknown;
  sourceToken?: unknown;
};

type QdnResourceRequest = {
  identifier?: string;
  name: string;
  path: string;
  service: string;
};

type QdnWriteAction = (typeof QDN_WRITE_ACTIONS)[number];
type QdnAccountAvatarAction = (typeof QDN_ACCOUNT_AVATAR_ACTIONS)[number];
type QdnGroupAction = (typeof QDN_GROUP_ACTIONS)[number];
type QdnNameAction = (typeof QDN_NAME_ACTIONS)[number];
type QdnPaymentAction = (typeof QDN_PAYMENT_ACTIONS)[number];
type QdnForeignServerAction = (typeof QDN_FOREIGN_SERVER_ACTIONS)[number];
type QdnPollAction = (typeof QDN_POLL_ACTIONS)[number];
type QdnTrustAction = (typeof QDN_TRUST_ACTIONS)[number];
type QdnChatAction = (typeof QDN_CHAT_ACTIONS)[number];
type QdnAtMessageAction = (typeof QDN_AT_MESSAGE_ACTIONS)[number];
type QdnPrivateGroupChatWriteAction = (typeof QDN_PRIVATE_GROUP_CHAT_WRITE_ACTIONS)[number];
type QdnAccountFreeWriteAction = (typeof QDN_ACCOUNT_FREE_WRITE_ACTIONS)[number];
type QdnHomeSettingsAction = (typeof QDN_HOME_SETTINGS_ACTIONS)[number];
type QdnAppAssignmentAction = (typeof QDN_APP_ASSIGNMENT_ACTIONS)[number];
type QdnBookmarkManagerAction = (typeof QDN_BOOKMARK_MANAGER_ACTIONS)[number];
type QdnNotificationManagerAction = (typeof QDN_NOTIFICATION_MANAGER_ACTIONS)[number];
type QdnWriteApprovalAction =
  | QdnWriteAction
  | QdnAccountAvatarAction
  | QdnGroupAction
  | QdnNameAction
  | QdnPaymentAction
  | QdnForeignServerAction
  | QdnPollAction
  | QdnTrustAction
  | QdnChatAction
  | QdnAtMessageAction
  | QdnPrivateGroupChatWriteAction
  | QdnAccountFreeWriteAction
  | QdnAppAssignmentAction
  | 'SEND_QORT'
  | 'SEND_QORTAL_GROUP_CHAT'
  | 'START_MINTING'
  | 'REMOVE_MINTING_ACCOUNT'
  | 'SHOW_NOTIFICATION'
  | 'NOTIFICATION_ADD'
  | 'BOOKMARKS_GET'
  | 'BOOKMARKS_APPLY'
  | 'BOOKMARKS_OPEN'
  | 'NOTIFICATION_MANAGER_GET'
  | 'NOTIFICATION_MANAGER_SET_MUTED'
  | 'NOTIFICATION_MANAGER_REMOVE_RULES'
  | 'NOTIFICATION_MANAGER_REVOKE'
  | 'UPDATE_HOME_SETTINGS';
type QdnChatPermissionAction = 'SEND_CHAT_MESSAGE' | 'SEND_QORTAL_GROUP_CHAT';

type QdnWriteSourceSelection = {
  dataBase64?: string;
  displayName: string;
  filename?: string;
  isZip?: boolean;
  kind: 'data' | 'directory' | 'file';
  path?: string;
  size?: number;
};

type QdnPublishSourcePickKind = 'any' | 'directory' | 'file';

type QdnPublishSourceTokenEntry = {
  contextKey: string;
  createdAt: number;
  lastUsedAt: number;
  source: QdnWriteSourceSelection;
};

type QdnWriteProfile = {
  accountId: string;
  address: string;
  label: string;
  name: string | null;
};

type QdnWriteSigner =
  | {
      accountId: string;
      kind: 'account';
    }
  | {
      kind: 'smoke';
      resource: QdnWriteResourceRequest;
    };

type QdnWriteContext = {
  apiKey: string;
  connection: NodeConnection;
  profile: QdnWriteProfile;
  signer: QdnWriteSigner;
};

type QdnChatContext = {
  accountId: string;
  apiKey: string;
  connection: NodeConnection;
  privateKey58: string;
  profile: QdnWriteProfile;
  publicKey58: string;
};

// Context for the keyless open-group chat path on a PUBLIC/network node. It holds
// the raw 64-byte ed25519 secret key for LOCAL signing only; the key is never put
// in a request body. No private-key base58 string is materialised.
type QdnKeylessChatContext = {
  accountId: string;
  apiKey: string;
  connection: NodeConnection;
  profile: QdnWriteProfile;
  publicKey58: string;
  secretKey: Uint8Array;
};

type QdnKeylessWriteContext = QdnKeylessChatContext;

type NodeConnection = Awaited<ReturnType<typeof getNodeConnection>>;

const publicPollCapabilitiesCache = new Map<string, { expiresAt: number; value: PublicPollCapabilities }>();

function qdnCodedError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

async function getPublicPollCapabilities(connection: NodeConnection) {
  const cacheKey = connection.nodeApiUrl;
  const cached = publicPollCapabilitiesCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const value = parsePublicPollCapabilities(await fetchLocalNodeApiPayload(
      connection,
      '/polls/public/capabilities',
      'Public poll capability lookup failed.',
    ));
    publicPollCapabilitiesCache.clear();
    publicPollCapabilitiesCache.set(cacheKey, { expiresAt: Date.now() + PUBLIC_POLL_CAPABILITIES_TTL_MS, value });
    return value;
  } catch (error) {
    if (isRecord(error) && error.code === 'QDN_PUBLIC_POLL_CAPABILITY_UNAVAILABLE') throw error;
    throw qdnCodedError('QDN_PUBLIC_POLL_CAPABILITY_UNAVAILABLE', 'The selected public node does not expose a compatible poll builder.');
  }
}

type QdnWriteApprovalDetails = {
  action: QdnWriteApprovalAction;
  amount?: number | string;
  approval?: boolean;
  chatMessagePreview?: string;
  details?: Array<{ label: string; value: string }>;
  groupId?: number;
  groupName?: string | null;
  mintingKey?: string | null;
  name?: string;
  permissionScope?: 'always' | 'single-request' | 'session';
  recipientAddress?: string;
  resource?: QdnWriteResourceRequest;
  resourceCount?: number;
  source?: QdnWriteSourceSelection;
};

type NodeApiFetchResult = {
  body: string;
  code?: string;
  contentLength?: number;
  contentType: string;
  data: unknown;
  headers: Record<string, string>;
  ok: boolean;
  status: number;
  statusText: string;
};

type QortalNodeCandidate = {
  requiresPublicReadProbe: boolean;
  requiresSyncedStatus: boolean;
  source: 'local' | 'remote';
  url: string;
};

type QdnWriteApprovalResponse = {
  approved: boolean;
  requestId: string;
};

type PendingQdnApproval = {
  resolve: (approved: boolean) => void;
  windowWebContentsId: number;
};

type QdnHomeSettingsHostRequest = {
  resolve: (settings: HomeSettings) => void;
  reject: (error: Error) => void;
  windowWebContentsId: number;
};

type QdnBookmarkManagerHostRequest = {
  operation: 'apply' | 'get';
  resolve: (result: BookmarkManagerSnapshot | BookmarkManagerMutationResult) => void;
  reject: (error: Error) => void;
  windowWebContentsId: number;
};

type ForeignPreparedSend = {
  activeNetwork: string;
  amount: string;
  blockchain: string;
  currencyCode: string;
  fee: string;
  feePerByte: string;
  inputAmount: string;
  inputCount: number;
  outputAmount: string;
  outputCount: number;
  rawTransactionHex: string;
  receivingAddress: string;
  sendMax: boolean;
  transactionSize: number;
  txHash: string;
};

type SupportedBlockchainInfo = {
  activeNetwork: string;
  apiPath: string | null;
  chainId: string | null;
  currencyCode: string;
  decimalPlaces: number;
  displayName: string;
  homeWallet?: HomeWalletCapability;
  name: string;
  slip44CoinType: number | null;
  supportsForeignForeignTrades: boolean;
  supportsHtlc: boolean;
  supportsLocalChainTrades: boolean;
  supportsWallet: boolean;
  type: string;
  walletEnabled: boolean;
};

const QORTAL_PUBLIC_NODE_BLOCKCHAIN_INFO: SupportedBlockchainInfo = {
  activeNetwork: 'MAIN',
  apiPath: null,
  chainId: null,
  currencyCode: 'QORT',
  decimalPlaces: 8,
  displayName: 'Qortal',
  name: 'QORTAL',
  slip44CoinType: null,
  supportsForeignForeignTrades: false,
  supportsHtlc: false,
  supportsLocalChainTrades: false,
  supportsWallet: true,
  type: 'QORTAL_PUBLIC_NODE',
  walletEnabled: true,
};

const pendingQdnWriteApprovals = new Map<string, PendingQdnApproval>();
const pendingQdnHomeSettingsRequests = new Map<string, QdnHomeSettingsHostRequest>();
const pendingQdnBookmarkManagerRequests = new Map<string, QdnBookmarkManagerHostRequest>();
const approvedQdnChatPermissions = new Set<string>();
const lastQdnAppNotificationAt = new Map<string, number>();
const QDN_APP_NOTIFICATION_MIN_INTERVAL_MS = 3_000;
const QDN_APP_NOTIFICATION_TEXT_MAX_LENGTH = 240;
// Home 2 initializes this from its main-process-owned device policy before any
// trusted shell window is created. Legacy Home retains its renderer sync IPC.
let qdnAppNotificationsEnabled = true;

export function areQdnAppNotificationsEnabled() {
  return qdnAppNotificationsEnabled;
}

export function setQdnAppNotificationsEnabled(enabled: boolean) {
  qdnAppNotificationsEnabled = enabled;
}

export function consumeQdnAppNotificationRateLimit(appKey: string) {
  const now = Date.now();
  const lastShownAt = lastQdnAppNotificationAt.get(appKey) ?? 0;
  if (now - lastShownAt < QDN_APP_NOTIFICATION_MIN_INTERVAL_MS) return false;
  lastQdnAppNotificationAt.set(appKey, now);
  return true;
}
const qdnPublishSourceTokens = new Map<string, QdnPublishSourceTokenEntry>();
const QDN_PUBLISH_SOURCE_TOKEN_TTL_MS = 30 * 60_000;
const QDN_PUBLISH_SOURCE_TOKEN_MAX_ENTRIES = 16;

// Pruning otherwise only runs on token activity, so an idle session would hold
// expired entries past their TTL indefinitely (a denied/failed publish never
// releases its token). A slow timer makes the TTL an upper bound too.
setInterval(() => pruneQdnPublishSourceTokens(), 5 * 60_000).unref();

function expandHomePath(filePath: string) {
  if (filePath === '~') {
    return os.homedir();
  }

  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return filePath;
}

function sanitizeQdnWriteApprovalResponse(value: unknown): QdnWriteApprovalResponse {
  if (!isRecord(value)) {
    throw new Error('QDN write request response is required.');
  }

  if (typeof value.requestId !== 'string' || !value.requestId) {
    throw new Error('QDN write request id is required.');
  }

  return {
    approved: value.approved === true,
    requestId: value.requestId,
  };
}

function getQdnViewHostWindow(context: QdnViewContext) {
  return BrowserWindow.getAllWindows().find(
    (window) => !window.isDestroyed() && window.webContents.id === context.windowId,
  ) ?? null;
}

function getQdnViewResourceUrl(context: QdnViewContext) {
  return context.resourceUrl ?? context.currentUrl ?? 'QDN app';
}

function getQdnChatPermissionCacheKey(
  context: QdnViewContext,
  accountId: string,
  action: QdnChatPermissionAction,
) {
  return [
    context.windowId,
    context.tabId,
    context.currentUrl ?? '',
    accountId,
    action,
  ].join('\n');
}

function getQdnPublishSourceTokenContextKey(context: QdnViewContext) {
  return [
    context.windowId,
    context.tabId,
    context.nodeOrigin,
    context.resourceUrl ?? '',
  ].join('\n');
}

function pruneQdnPublishSourceTokens(now = Date.now()) {
  for (const [token, entry] of qdnPublishSourceTokens) {
    if (now - entry.lastUsedAt > QDN_PUBLISH_SOURCE_TOKEN_TTL_MS) {
      qdnPublishSourceTokens.delete(token);
    }
  }

  while (qdnPublishSourceTokens.size > QDN_PUBLISH_SOURCE_TOKEN_MAX_ENTRIES) {
    let oldestToken = '';
    let oldestLastUsedAt = Number.POSITIVE_INFINITY;

    for (const [token, entry] of qdnPublishSourceTokens) {
      if (entry.lastUsedAt < oldestLastUsedAt) {
        oldestToken = token;
        oldestLastUsedAt = entry.lastUsedAt;
      }
    }

    if (!oldestToken) {
      return;
    }

    qdnPublishSourceTokens.delete(oldestToken);
  }
}

function cacheQdnPublishSourceToken(context: QdnViewContext, source: QdnWriteSourceSelection) {
  const now = Date.now();
  const token = randomUUID();

  qdnPublishSourceTokens.set(token, {
    contextKey: getQdnPublishSourceTokenContextKey(context),
    createdAt: now,
    lastUsedAt: now,
    source,
  });
  pruneQdnPublishSourceTokens(now);

  return token;
}

function getQdnPublishSourceToken(request: QdnAppRequest) {
  return getString(getRequestValue(request, 'sourceToken'));
}

function getQdnPublishSourceFromTokenString(sourceToken: string, context: QdnViewContext) {
  if (!sourceToken) {
    return null;
  }

  pruneQdnPublishSourceTokens();
  const entry = qdnPublishSourceTokens.get(sourceToken);

  if (!entry) {
    throw new Error('Selected QDN publish source is no longer available. Select the file again.');
  }

  if (entry.contextKey !== getQdnPublishSourceTokenContextKey(context)) {
    throw new Error('Selected QDN publish source is not available to this app tab.');
  }

  entry.lastUsedAt = Date.now();

  return entry.source;
}

function getQdnPublishSourceFromToken(request: QdnAppRequest, context: QdnViewContext) {
  return getQdnPublishSourceFromTokenString(getQdnPublishSourceToken(request), context);
}

function releaseQdnPublishSourceTokenFromString(sourceToken: string) {
  if (!sourceToken) {
    return;
  }

  qdnPublishSourceTokens.delete(sourceToken);
}

function releaseQdnPublishSourceToken(request: QdnAppRequest) {
  releaseQdnPublishSourceTokenFromString(getQdnPublishSourceToken(request));
}

// Sends an approval request to the host window renderer and resolves with the
// user's decision delivered through 'qdn-app:resolveWriteApproval'.
async function awaitQdnApprovalFromHostWindow(
  context: QdnViewContext,
  channel: string,
  payload: Record<string, unknown>,
) {
  const hostWindow = getQdnViewHostWindow(context);

  if (!hostWindow) {
    throw new Error('QDN app request does not belong to an active window.');
  }

  const requestId = randomUUID();

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (nextApproved: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      hostWindow.removeListener('closed', handleWindowClosed);
      pendingQdnWriteApprovals.delete(requestId);
      resolve(nextApproved);
    };
    const handleWindowClosed = () => settle(false);
    const timeoutId = setTimeout(() => settle(false), QDN_WRITE_APPROVAL_TIMEOUT_MS);

    pendingQdnWriteApprovals.set(requestId, {
      resolve: settle,
      windowWebContentsId: hostWindow.webContents.id,
    });
    hostWindow.once('closed', handleWindowClosed);
    hostWindow.webContents.send(channel, {
      ...payload,
      id: requestId,
    });
  });
}

async function requestQdnWriteApproval(
  context: QdnViewContext,
  profile: Awaited<ReturnType<typeof getAccountProfile>> | null,
  details: QdnWriteApprovalDetails,
  denialMessage = 'QDN write request was denied.',
) {
  const approved = await awaitQdnApprovalFromHostWindow(context, 'qdn-app:write-request', {
    accountName: profile?.name ?? null,
    action: details.action,
    address: profile?.address ?? '',
    amount: typeof details.amount === 'undefined' ? null : String(details.amount),
    approval: typeof details.approval === 'boolean' ? details.approval : null,
    chatMessagePreview: details.chatMessagePreview ?? null,
    details: details.details ?? [],
    groupId: typeof details.groupId === 'number' ? details.groupId : null,
    groupName: details.groupName ?? null,
    mintingKey: details.mintingKey ?? null,
    name: details.name ?? null,
    permissionScope: details.permissionScope ?? 'single-request',
    recipientAddress: details.recipientAddress ?? null,
    resource: details.resource
      ? {
          identifier: details.resource.identifier ?? null,
          name: details.resource.name,
          service: details.resource.service,
        }
      : null,
    resourceCount: details.resourceCount ?? null,
    resourceUrl: getQdnViewResourceUrl(context),
    sourceKind: details.source?.kind ?? null,
    sourceName: details.source?.displayName ?? null,
  });

  if (!approved) {
    throw new Error(denialMessage);
  }
}

async function requestHomeSettingsFromHostWindow(
  context: QdnViewContext,
  operation: 'read' | 'apply',
  patch?: Partial<HomeSettings>,
) {
  const hostWindow = getQdnViewHostWindow(context);
  if (!hostWindow) {
    throw new Error('QDN app request does not belong to an active window.');
  }

  const requestId = randomUUID();
  return new Promise<HomeSettings>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      hostWindow.removeListener('closed', handleWindowClosed);
      pendingQdnHomeSettingsRequests.delete(requestId);
      callback();
    };
    const handleWindowClosed = () => settle(() => reject(new Error('QDN Home settings request was cancelled.')));
    const timeoutId = setTimeout(
      () => settle(() => reject(new Error('QDN Home settings request timed out.'))),
      QDN_WRITE_APPROVAL_TIMEOUT_MS,
    );

    pendingQdnHomeSettingsRequests.set(requestId, {
      resolve: (settings) => settle(() => resolve(settings)),
      reject: (error) => settle(() => reject(error)),
      windowWebContentsId: hostWindow.webContents.id,
    });
    hostWindow.once('closed', handleWindowClosed);
    hostWindow.webContents.send('qdn-app:home-settings-request', { id: requestId, operation, patch: patch ?? null });
  });
}

async function handleQdnHomeSettingsAction(
  action: QdnHomeSettingsAction,
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  if (!context) {
    throw new Error('QDN Home settings request does not belong to an active window.');
  }
  if (action === 'GET_HOME_SETTINGS_METADATA') return getHomeSettingsMetadata();

  if (action === 'GET_HOME_SETTINGS') return requestHomeSettingsFromHostWindow(context, 'read');

  const explicitPatch = getRequestValue(request, 'patch') ?? getRequestValue(request, 'settings');
  const patch = validateHomeSettingsPatch(explicitPatch ?? (isRecord(request.payload) ? request.payload : undefined));
  const current = await requestHomeSettingsFromHostWindow(context, 'read');
  const details = getHomeSettingsApprovalDetails(current, patch);

  await requestQdnWriteApproval(context, null, {
    action,
    details,
    permissionScope: 'single-request',
  });
  assertFreshQdnWriteContext(sender, context);

  return requestHomeSettingsFromHostWindow(context, 'apply', patch);
}

function getQdnAssignmentRequest(request: QdnAppRequest) {
  const payload = isRecord(request.payload) ? request.payload : {};
  const role = sanitizeQdnAppAssignmentRole(getRequestValue(request, 'role') ?? payload.role);
  const url = sanitizeQdnAppAssignmentUrl(
    getRequestValue(request, 'targetUrl') ?? getRequestValue(request, 'url') ?? payload.targetUrl ?? payload.url,
  );
  const label = sanitizeQdnAppAssignmentLabel(getRequestValue(request, 'label') ?? payload.label, role);
  const description = sanitizeQdnAppAssignmentDescription(getRequestValue(request, 'description') ?? payload.description);
  return { description, label, role, url };
}

function getQdnAssignmentAppKey(context: QdnViewContext) {
  if (!context.resourceUrl) throw new Error('App assignments require a stable app resource URL.');
  return sanitizeQdnManagerAppKey(context.resourceUrl);
}

async function requireQdnAssignmentsReadPermission(context: QdnViewContext, sender: WebContents) {
  const appKey = getQdnAssignmentAppKey(context);
  if (hasQdnAppCapability(appKey, 'assignments.read')) return;
  await requestQdnWriteApproval(context, null, {
    action: 'GET_APP_ASSIGNMENTS',
    details: [{ label: 'Capability', value: 'Read app assignments' }],
    permissionScope: 'always',
  }, 'App assignment read permission was denied.');
  assertFreshQdnWriteContext(sender, context);
  grantQdnAppCapabilityPermission(appKey, 'assignments.read');
}

async function handleQdnAppAssignmentAction(
  action: QdnAppAssignmentAction,
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  if (!context) throw new Error('App assignment request does not belong to an active app view.');
  if (action === 'GET_APP_ASSIGNMENTS') {
    await requireQdnAssignmentsReadPermission(context, sender);
    const store = readQdnAppRolesStore();
    return { assignments: store.assignments, revision: store.revision, version: store.version };
  }

  const input = getQdnAssignmentRequest(request);
  const currentStore = readQdnAppRolesStore();
  const current = getQdnAppAssignment(currentStore, input.role);
  await requestQdnWriteApproval(context, null, {
    action,
    details: [
      { label: 'Role', value: input.role },
      { label: 'Current target', value: current?.url ?? 'Unassigned' },
      { label: 'Proposed target', value: input.url },
    ],
    permissionScope: 'single-request',
  }, 'App assignment request was denied.');
  assertFreshQdnWriteContext(sender, context);
  if (readQdnAppRolesStore().revision !== currentStore.revision) {
    throw new Error('App assignments changed while approval was open. Refresh and try again.');
  }
  const store = setQdnAppAssignmentValue(input);
  return { assignments: store.assignments, revision: store.revision, version: store.version };
}

function getQdnManagerPermissionAppKey(context: QdnViewContext) {
  if (!context.resourceUrl) {
    throw new Error('QDN manager permission requires a stable app resource URL.');
  }
  return sanitizeQdnManagerAppKey(context.resourceUrl);
}

async function requireQdnManagerPermission(
  context: QdnViewContext,
  sender: WebContents,
  capability: QdnManagerCapability,
  action: QdnWriteApprovalAction,
) {
  const appKey = getQdnManagerPermissionAppKey(context);
  if (hasQdnManagerPermission(appKey, capability)) return appKey;

  await requestQdnWriteApproval(context, null, {
    action,
    details: [{ label: 'Capability', value: capability }],
    permissionScope: 'always',
  }, 'Home data manager permission was denied.');
  assertFreshQdnWriteContext(sender, context);
  grantQdnManagerPermission(appKey, capability);
  return appKey;
}

async function requestBookmarkManagerFromHostWindow(
  context: QdnViewContext,
  operation: 'apply' | 'get',
  request?: BookmarkManagerMutationRequest,
) {
  const hostWindow = getQdnViewHostWindow(context);
  if (!hostWindow) throw new Error('Bookmark manager request does not belong to an active window.');

  const requestId = randomUUID();
  return new Promise<BookmarkManagerSnapshot | BookmarkManagerMutationResult>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      hostWindow.removeListener('closed', handleWindowClosed);
      pendingQdnBookmarkManagerRequests.delete(requestId);
      callback();
    };
    const handleWindowClosed = () => settle(() => reject(new Error('Bookmark manager request was cancelled.')));
    const timeoutId = setTimeout(
      () => settle(() => reject(new Error('Bookmark manager request timed out.'))),
      QDN_WRITE_APPROVAL_TIMEOUT_MS,
    );
    pendingQdnBookmarkManagerRequests.set(requestId, {
      operation,
      resolve: (result) => settle(() => resolve(result)),
      reject: (error) => settle(() => reject(error)),
      windowWebContentsId: hostWindow.webContents.id,
    });
    hostWindow.once('closed', handleWindowClosed);
    hostWindow.webContents.send('qdn-app:bookmark-manager-request', {
      id: requestId,
      operation,
      request: request ?? null,
    });
  });
}

async function handleQdnBookmarkManagerAction(
  action: QdnBookmarkManagerAction,
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  if (!context) throw new Error('Bookmark manager request does not belong to an active app view.');
  if (action === 'BOOKMARKS_HAS_PERMISSION') {
    return { granted: hasQdnManagerPermission(getQdnManagerPermissionAppKey(context), 'bookmarks.manage') };
  }

  if (action === 'BOOKMARKS_OPEN') {
    const { accountId, address } = validateBookmarksOpenRequest(
      getRequestValue(request, 'request') ?? {
        accountId: getRequestValue(request, 'accountId') ?? null,
        address: getRequestValue(request, 'address'),
      },
    );

    await requireQdnManagerPermission(context, sender, 'bookmarks.manage', action);
    assertFreshQdnWriteContext(sender, context);

    if (accountId && !accountExists(accountId)) {
      throw new Error('BOOKMARKS_OPEN accountId does not match a saved Home account.');
    }

    const hostWindow = getQdnViewHostWindow(context);
    if (!hostWindow) {
      throw new Error('Bookmark manager open request does not belong to an active window.');
    }

    hostWindow.webContents.send('qdn-app:bookmarks-open', {
      accountId,
      address,
      sourceTabId: context.tabId,
    });

    return true;
  }

  const mutationRequest = action === 'BOOKMARKS_APPLY'
    ? validateBookmarkManagerMutationRequest(
        getRequestValue(request, 'request') ?? {
          expectedRevision: getRequestValue(request, 'expectedRevision'),
          mutation: getRequestValue(request, 'mutation'),
        },
      )
    : undefined;
  await requireQdnManagerPermission(context, sender, 'bookmarks.manage', action);
  assertFreshQdnWriteContext(sender, context);
  return requestBookmarkManagerFromHostWindow(context, action === 'BOOKMARKS_GET' ? 'get' : 'apply', mutationRequest);
}

function getExpectedManagerRevision(request: QdnAppRequest) {
  const value = getRequestValue(request, 'expectedRevision');
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('Notification manager expectedRevision must be a non-negative safe integer.');
  }
  return value as number;
}

async function handleQdnNotificationManagerAction(
  action: QdnNotificationManagerAction,
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  if (!context) throw new Error('Notification manager request does not belong to an active app view.');
  if (action === 'NOTIFICATION_MANAGER_HAS_PERMISSION') {
    return { granted: hasQdnManagerPermission(getQdnManagerPermissionAppKey(context), 'notifications.manage') };
  }

  const mutation = action === 'NOTIFICATION_MANAGER_SET_MUTED'
    ? sanitizeQdnNotificationManagerMutation({
        type: 'SET_APP_MUTED',
        appKey: getRequestValue(request, 'appKey'),
        muted: getRequestValue(request, 'muted'),
      })
    : action === 'NOTIFICATION_MANAGER_REMOVE_RULES'
      ? sanitizeQdnNotificationManagerMutation({
          type: 'REMOVE_APP_RULES',
          appKey: getRequestValue(request, 'appKey'),
          notificationIds: getRequestValue(request, 'notificationIds'),
        })
      : action === 'NOTIFICATION_MANAGER_REVOKE'
        ? sanitizeQdnNotificationManagerMutation({
            type: 'REVOKE_APP',
            appKey: getRequestValue(request, 'appKey'),
          })
        : null;
  const expectedRevision = mutation ? getExpectedManagerRevision(request) : null;
  await requireQdnManagerPermission(context, sender, 'notifications.manage', action);
  assertFreshQdnWriteContext(sender, context);

  const store = readNotificationStore();
  if (!mutation) return getQdnNotificationManagerSummary(store);
  if (store.revision !== expectedRevision) {
    throw qdnCodedError('HOME_DATA_STALE', 'Notification settings changed; refresh and try again.');
  }
  const nextStore = replaceNotificationStore(applyQdnNotificationManagerMutation(store, mutation));
  return getQdnNotificationManagerSummary(nextStore);
}

async function requestQdnChatPermissionApproval(
  context: QdnViewContext,
  profile: Awaited<ReturnType<typeof getAccountProfile>>,
  action: QdnChatPermissionAction,
  details: Omit<QdnWriteApprovalDetails, 'action' | 'permissionScope'>,
) {
  const cacheKey = getQdnChatPermissionCacheKey(context, profile.accountId, action);

  if (approvedQdnChatPermissions.has(cacheKey)) {
    return;
  }

  await requestQdnWriteApproval(context, profile, {
    ...details,
    action,
    permissionScope: 'session',
  });

  approvedQdnChatPermissions.add(cacheKey);
}

// Notification permission is app-scoped, not account-scoped, so the durable key
// uses the stable app resource URL (not currentUrl, which drifts with navigation).
function getQdnNotificationPermissionCacheKey(context: QdnViewContext) {
  const appKey = context.resourceUrl;
  if (!appKey) throw new Error('QDN app notification request is missing its stable resource URL.');
  return sanitizeQdnManagerAppKey(appKey);
}

// "qdn://APP/name/path" → "name"; falls back to the full resource URL so the
// notification always carries some app provenance.
export function getQdnAppDisplayNameFromResourceUrl(resourceUrl: string) {
  const match = /^qdn:\/\/[^/]+\/([^/]+)/i.exec(resourceUrl);

  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  return resourceUrl;
}

async function requestQdnNotificationPermissionApproval(
  context: QdnViewContext,
  action: 'SHOW_NOTIFICATION' | 'NOTIFICATION_ADD',
) {
  const cacheKey = getQdnNotificationPermissionCacheKey(context);

  if (hasNotificationGrant(cacheKey)) {
    return;
  }

  await requestQdnWriteApproval(
    context,
    null,
    { action, permissionScope: 'always' },
    'Notification permission was denied.',
  );

  grantAppNotifications(cacheKey);
}

async function showNotificationForApp(request: QdnAppRequest, context: QdnViewContext | null) {
  if (!context) {
    throw new Error('QDN app notification request does not belong to an active window.');
  }

  const title = sanitizeAppTitle(getRequestValue(request, 'title'));

  if (!title) {
    throw new Error('Notification title is required.');
  }

  const text = sanitizeAppTitle(getRequestValue(request, 'text'), QDN_APP_NOTIFICATION_TEXT_MAX_LENGTH);

  await requestQdnNotificationPermissionApproval(context, 'SHOW_NOTIFICATION');

  const appKey = getQdnNotificationPermissionCacheKey(context);
  if (readNotificationStore().grants[appKey]?.muted) {
    return { shown: false, reason: 'muted' };
  }

  if (!qdnAppNotificationsEnabled) {
    return { shown: false, reason: 'disabled' };
  }

  if (!Notification.isSupported()) {
    return { shown: false, reason: 'unsupported' };
  }

  // No notification while the user is already looking at the app.
  if (isQdnViewFocused(context.windowId, context.tabId)) {
    return { shown: false, reason: 'focused' };
  }

  if (!consumeQdnAppNotificationRateLimit(appKey)) {
    return { shown: false, reason: 'rate-limited' };
  }

  // The app name suffix keeps provenance visible so one app cannot pose as
  // another (or as Home itself) in the notification shade.
  const notification = new Notification({
    body: text ?? '',
    title: `${title} — ${getQdnAppDisplayNameFromResourceUrl(appKey)}`,
  });

  notification.on('click', () => {
    const hostWindow = getQdnViewHostWindow(context) ??
      BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());

    if (!hostWindow) return;

    if (hostWindow.isMinimized()) {
      hostWindow.restore();
    }

    hostWindow.show();
    hostWindow.focus();
    hostWindow.webContents.send('qdn-app:notification-clicked', { tabId: context.tabId });
  });

  const latestGrant = readNotificationStore().grants[appKey];
  if (!latestGrant) {
    return { shown: false, reason: 'revoked' };
  }

  if (latestGrant.muted) {
    return { shown: false, reason: 'muted' };
  }

  if (!qdnAppNotificationsEnabled) {
    return { shown: false, reason: 'disabled' };
  }

  notification.show();

  return { shown: true };
}

// Compatibility only: pointer-aware apps use FETCH_ACCOUNT_AVATAR. Keeping this
// URL avoids breaking older apps without making a 500-account identity batch
// download and base64-encode every avatar.
async function getAccountAvatarHint(name: string | null) {
  try {
    const nodeApiUrl = await getNodeApiUrl();
    return getLegacyAccountAvatarHint(nodeApiUrl, name);
  } catch {
    return getLegacyAccountAvatarHint('', name);
  }
}

function getNameValue(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const name = (value as { name?: unknown }).name;

  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

async function getPrimaryName(address: string, nodeApiUrl: string): Promise<string | null> {
  try {
    const response = await fetchNode(`/names/primary/${encodeURIComponent(address)}`, {}, nodeApiUrl);

    return response.ok ? getNameValue(await response.json()) : null;
  } catch {
    return null;
  }
}

async function getFirstOwnedName(address: string, nodeApiUrl: string): Promise<string | null> {
  try {
    const response = await fetchNode(
      `/names/address/${encodeURIComponent(address)}?limit=0`,
      {},
      nodeApiUrl,
    );

    if (!response.ok) {
      return null;
    }

    const data: unknown = await response.json();

    if (!Array.isArray(data)) {
      return null;
    }

    for (const entry of data) {
      const name = getNameValue(entry);

      if (name) {
        return name;
      }
    }

    return null;
  } catch {
    return null;
  }
}

const MAX_RESOLVE_IDENTITIES = 500;

// Batch-resolves names plus a legacy named-thumbnail compatibility hint. Exact
// pointer-aware avatar bytes are intentionally separate (FETCH_ACCOUNT_AVATAR)
// so this bounded identity batch never downloads up to 500 images.
async function resolveIdentitiesForQdnApp(request: QdnAppRequest) {
  const rawAddresses = request.addresses;

  if (!Array.isArray(rawAddresses)) {
    throw new Error('RESOLVE_IDENTITIES requires an "addresses" array.');
  }

  const addresses: string[] = [];
  const seen = new Set<string>();

  for (const value of rawAddresses) {
    const address = getString(value);

    if (address && !seen.has(address)) {
      seen.add(address);
      addresses.push(address);
    }
  }

  if (addresses.length > MAX_RESOLVE_IDENTITIES) {
    throw new Error(`RESOLVE_IDENTITIES accepts at most ${MAX_RESOLVE_IDENTITIES} addresses.`);
  }

  let nodeApiUrl = '';

  try {
    nodeApiUrl = await getNodeApiUrl();
  } catch {
    nodeApiUrl = '';
  }

  return Promise.all(
    addresses.map(async (address) => {
      let name: string | null = null;

      if (nodeApiUrl) {
        name = (await getPrimaryName(address, nodeApiUrl)) ?? (await getFirstOwnedName(address, nodeApiUrl));
      }

      const legacyAvatar = getLegacyAccountAvatarHint(nodeApiUrl, name);

      return {
        address,
        name,
        avatarSrc: legacyAvatar.url,
        avatarContract: legacyAvatar.avatarContract,
      };
    }),
  );
}

async function getSelectedAccountForQdnApp(context: QdnViewContext | null) {
  if (!context) {
    throw new Error('QDN app requests are only available to isolated QDN app views.');
  }

  if (!context.accountId) {
    throw new Error('No account is selected for this tab.');
  }

  const profile = await getAccountProfile(context.accountId);
  const legacyAvatar = await getAccountAvatarHint(profile.name);

  return {
    address: profile.address,
    avatarUrl: legacyAvatar.url,
    avatarContract: legacyAvatar.avatarContract,
    isUnlocked: isAccountUnlocked(context.accountId),
    name: profile.name,
  };
}

async function waitForSelectedAccountUnlock(context: QdnViewContext) {
  if (!context.accountId) {
    return false;
  }

  const startedAt = Date.now();

  while (Date.now() - startedAt < QDN_UNLOCK_STATE_WAIT_MS) {
    if (isAccountUnlocked(context.accountId)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return isAccountUnlocked(context.accountId);
}

async function requestSelectedAccountUnlockForQdnApp(context: QdnViewContext) {
  if (!context.accountId) {
    throw new Error('No account is selected for this tab.');
  }

  if (isAccountUnlocked(context.accountId)) {
    return true;
  }

  const profile = await getAccountProfile(context.accountId);
  const approved = await awaitQdnApprovalFromHostWindow(context, 'qdn-app:unlock-request', {
    accountId: profile.accountId,
    accountLabel: profile.label,
    accountName: profile.name,
    address: profile.address,
    resourceUrl: getQdnViewResourceUrl(context),
  });

  return approved ? waitForSelectedAccountUnlock(context) : false;
}

// Prompts the user to unlock the selected account through Home's own password
// dialog; the app never sees the password. Cancelling is not an error - the
// returned account state tells the app whether the unlock happened.
async function unlockSelectedAccountForQdnApp(context: QdnViewContext | null) {
  if (!context) {
    throw new Error('UNLOCK_SELECTED_ACCOUNT is only available from a QDN app frame.');
  }

  if (!context.accountId) {
    throw new Error('No account is selected for this tab.');
  }

  await requestSelectedAccountUnlockForQdnApp(context);

  return getSelectedAccountForQdnApp(context);
}

function isQdnWriteSmokeMode() {
  return !app.isPackaged && process.env.QORTIUM_HOME_QDN_WRITE_SMOKE === '1';
}

function getQdnWriteSmokeSourceSelection() {
  if (!isQdnWriteSmokeMode()) {
    return null;
  }

  const sourcePath = getString(process.env.QORTIUM_HOME_QDN_WRITE_SMOKE_SOURCE);

  if (!sourcePath) {
    throw new Error('QDN write smoke source path was not set.');
  }

  const expandedSourcePath = expandHomePath(sourcePath);

  if (!existsSync(expandedSourcePath)) {
    throw new Error('QDN write smoke source path does not exist.');
  }

  const smokeStats = statSync(expandedSourcePath);

  return {
    displayName: path.basename(expandedSourcePath) || 'Smoke source',
    filename: smokeStats.isFile() ? path.basename(expandedSourcePath) : undefined,
    kind: getQdnWriteSourceKind(expandedSourcePath),
    path: expandedSourcePath,
    size: smokeStats.isFile() ? smokeStats.size : undefined,
  } satisfies QdnWriteSourceSelection;
}

function getQdnWriteSmokeAccountRecord(resource: QdnWriteResourceRequest) {
  const accountsPath = expandHomePath(
    getString(process.env.QORTIUM_HOME_PREVIEW_ACCOUNTS_PATH) || PREVIEW_ACCOUNTS_PATH,
  );
  const role = getString(process.env.QORTIUM_HOME_SMOKE_ACCOUNT_ROLE) || QDN_WRITE_SMOKE_ROLE;
  const allowedName = getString(process.env.QORTIUM_HOME_QDN_WRITE_SMOKE_NAME);

  if (allowedName && resource.name !== allowedName) {
    throw new Error('QDN write smoke request did not match the configured publish name.');
  }

  let parsedAccounts: unknown;

  try {
    parsedAccounts = JSON.parse(readFileSync(accountsPath, 'utf8'));
  } catch {
    throw new Error('QDN write smoke preview account file could not be read.');
  }

  if (!isRecord(parsedAccounts) || !Array.isArray(parsedAccounts.accounts)) {
    throw new Error('QDN write smoke preview account file is invalid.');
  }

  const account = parsedAccounts.accounts.find(
    (candidate) => isRecord(candidate) && getString(candidate.role) === role,
  );

  if (!isRecord(account)) {
    throw new Error(`QDN write smoke preview account role was not found: ${role}.`);
  }

  return {
    account,
    role,
  };
}

function getQdnWriteSmokeProfile(resource: QdnWriteResourceRequest) {
  const { account, role } = getQdnWriteSmokeAccountRecord(resource);
  const address = getString(account.accountAddress);

  if (!address) {
    throw new Error('QDN write smoke preview account is missing account address.');
  }

  return {
    accountId: `preview:${role}`,
    address,
    label: `Preview ${role}`,
    name: resource.name,
  } satisfies QdnWriteProfile;
}

function getQdnWriteSmokePrivateKey(resource: QdnWriteResourceRequest) {
  const { account } = getQdnWriteSmokeAccountRecord(resource);
  const privateKey58 = getString(account.accountPrivateKey);

  if (!privateKey58) {
    throw new Error('QDN write smoke preview account is missing account private key.');
  }

  return privateKey58;
}

function getForeignWalletCrypto() {
  return {
    ripemd160: (data: Uint8Array) => new Uint8Array(createHash('ripemd160').update(data).digest()),
    sha256: (data: Uint8Array) => new Uint8Array(createHash('sha256').update(data).digest()),
    sha512: (data: Uint8Array) => new Uint8Array(createHash('sha512').update(data).digest()),
  };
}

function getForeignWalletAmountString(value: unknown, label: string) {
  const stringValue = typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(8).replace(/\.?0+$/, '')
    : getString(value);

  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(stringValue)) {
    throw new Error(`${label} must be a positive amount with up to 8 decimals.`);
  }

  if (Number(stringValue) <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }

  return stringValue;
}

function getAssetApprovalName(assetId: number) {
  return assetId === NATIVE_ASSET_ID ? NATIVE_ASSET_LABEL : `Asset #${assetId}`;
}

function atomicAmountToCoinString(value: string | number | bigint) {
  const atomic = BigInt(String(value).trim());
  const whole = atomic / 100_000_000n;
  const fraction = atomic % 100_000_000n;

  if (fraction === 0n) {
    return whole.toString();
  }

  return `${whole}.${fraction.toString().padStart(8, '0').replace(/0+$/, '')}`;
}

function feePerKbToFeePerByteString(value: unknown) {
  const feePerKb = BigInt(getString(value));
  const feePerByte = (feePerKb + 999n) / 1000n;

  if (feePerByte <= 0n) {
    throw new Error('Foreign fee must be greater than zero.');
  }

  return atomicAmountToCoinString(feePerByte);
}

function getForeignPreparedAmountString(value: unknown, label: string) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }

  const stringValue = getString(value);

  if (!/^(?:0|[1-9]\d*)$/.test(stringValue)) {
    throw new Error(`Prepared foreign send ${label} was invalid.`);
  }

  return stringValue;
}

function getForeignPreparedInteger(value: unknown, label: string) {
  const stringValue = getForeignPreparedAmountString(value, label);
  const parsedValue = Number(stringValue);

  if (!Number.isSafeInteger(parsedValue)) {
    throw new Error(`Prepared foreign send ${label} was too large.`);
  }

  return parsedValue;
}

function sanitizeForeignPreparedSend(
  value: unknown,
  fallbackCoin: string,
  fallbackRecipient: string,
): ForeignPreparedSend {
  if (!isRecord(value)) {
    throw new Error('Prepared foreign send response was invalid.');
  }

  const rawTransactionHex = getString(value.rawTransactionHex).toLowerCase();

  if (!/^(?:[0-9a-f]{2})+$/.test(rawTransactionHex)) {
    throw new Error('Prepared foreign send transaction bytes were invalid.');
  }

  const blockchain = getString(value.blockchain) || fallbackCoin;
  const currencyCode = getString(value.currencyCode) || fallbackCoin;
  const receivingAddress = getString(value.receivingAddress) || fallbackRecipient;

  if (!receivingAddress) {
    throw new Error('Prepared foreign send recipient address was invalid.');
  }

  return {
    activeNetwork: getString(value.activeNetwork),
    amount: getForeignPreparedAmountString(value.amount, 'amount'),
    blockchain,
    currencyCode,
    fee: getForeignPreparedAmountString(value.fee, 'fee'),
    feePerByte: getForeignPreparedAmountString(value.feePerByte, 'fee rate'),
    inputAmount: getForeignPreparedAmountString(value.inputAmount, 'input amount'),
    inputCount: getForeignPreparedInteger(value.inputCount, 'input count'),
    outputAmount: getForeignPreparedAmountString(value.outputAmount, 'output amount'),
    outputCount: getForeignPreparedInteger(value.outputCount, 'output count'),
    rawTransactionHex,
    receivingAddress,
    sendMax: getBoolean(value.sendMax) ?? false,
    transactionSize: getForeignPreparedInteger(value.transactionSize, 'transaction size'),
    txHash: getString(value.txHash),
  };
}

function getForeignPreparedSendPreview(preparedSend: ForeignPreparedSend) {
  return {
    activeNetwork: preparedSend.activeNetwork,
    amount: preparedSend.amount,
    blockchain: preparedSend.blockchain,
    currencyCode: preparedSend.currencyCode,
    fee: preparedSend.fee,
    feePerByte: preparedSend.feePerByte,
    inputAmount: preparedSend.inputAmount,
    inputCount: preparedSend.inputCount,
    outputAmount: preparedSend.outputAmount,
    outputCount: preparedSend.outputCount,
    receivingAddress: preparedSend.receivingAddress,
    sendMax: preparedSend.sendMax,
    transactionSize: preparedSend.transactionSize,
    txHash: preparedSend.txHash,
  };
}

function getForeignPreparedSendApprovalDetails(preparedSend: ForeignPreparedSend) {
  const currencyCode = preparedSend.currencyCode || preparedSend.blockchain;
  const amountWithFee = BigInt(preparedSend.amount) + BigInt(preparedSend.fee);
  const details = [
    { label: 'Coin', value: currencyCode },
    ...(preparedSend.sendMax ? [{ label: 'Mode', value: 'Send max' }] : []),
    { label: 'Fee', value: `${atomicAmountToCoinString(preparedSend.fee)} ${currencyCode}` },
    { label: 'Fee rate', value: `${preparedSend.feePerByte} atomic/byte` },
    { label: 'Total debit', value: `${atomicAmountToCoinString(amountWithFee)} ${currencyCode}` },
    { label: 'Transaction size', value: `${preparedSend.transactionSize} bytes` },
    { label: 'Inputs', value: String(preparedSend.inputCount) },
    { label: 'Outputs', value: String(preparedSend.outputCount) },
  ];

  if (preparedSend.activeNetwork) {
    details.splice(1, 0, { label: 'Network', value: preparedSend.activeNetwork });
  }

  if (preparedSend.txHash) {
    details.push({ label: 'Transaction hash', value: preparedSend.txHash });
  }

  return details;
}

function getForeignFeePath(request: QdnAppRequest) {
  const feeType = (
    getString(getRequestValue(request, 'feeType')) ||
    getString(getRequestValue(request, 'type'))
  ).toLowerCase();

  if (!feeType || feeType === 'trade' || feeType === 'send' || feeType === 'feekb' || feeType === 'feeperbyte') {
    return 'feekb';
  }

  if (feeType === 'feeceiling' || feeType === 'feerequired') {
    return 'feerequired';
  }

  throw new Error('Unsupported foreign fee type.');
}

function getForeignServerPayload(request: QdnAppRequest) {
  const payload = getRequestPayload(request);
  const server = isRecord(payload.server) ? payload.server : isRecord(request.server) ? request.server : payload;
  const hostName =
    getString(server.hostName) ||
    getString(server.hostname) ||
    getString(server.host);
  const port = getInteger(server.port);
  const connectionType = (
    getString(server.connectionType) ||
    getString(server.type) ||
    getString(server.connection)
  ).toUpperCase();
  const certificateSha256Fingerprint =
    getString(server.certificateSha256Fingerprint) ||
    getString(server.certificate) ||
    getString(server.sslCertificate);

  if (!hostName) {
    throw new Error('Foreign server host is required.');
  }

  if (hostName.length > 253 || /[\s/\\]/.test(hostName)) {
    throw new Error('Foreign server host is invalid.');
  }

  if (typeof port !== 'number' || port <= 0 || port > 65535) {
    throw new Error('Foreign server port must be a valid TCP port.');
  }

  if (connectionType !== 'SSL' && connectionType !== 'TCP') {
    throw new Error('Foreign server connection type must be SSL or TCP.');
  }

  if (
    certificateSha256Fingerprint &&
    !/^(?:[a-fA-F0-9]{64}|(?:[a-fA-F0-9]{2}:){31}[a-fA-F0-9]{2})$/.test(certificateSha256Fingerprint)
  ) {
    throw new Error('Foreign server certificate fingerprint must be a SHA-256 fingerprint.');
  }

  return {
    ...(certificateSha256Fingerprint ? { certificateSha256Fingerprint } : {}),
    connectionType,
    hostName,
    port,
  };
}

function getForeignWalletSeedForContext(context: QdnViewContext | null, connection: NodeConnection) {
  assertLocalWriteConnection(connection);

  const accountId = getQdnWriteAccountId(context);

  assertAccountUnlocked(accountId);

  return getAccountForeignWalletSeed(accountId);
}

function deriveForeignWalletForContext(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  connection: NodeConnection,
) {
  const coin = normalizeForeignWalletCoin(getRequestValue(request, 'coin') ?? getRequestValue(request, 'blockchain'));
  const seed = getForeignWalletSeedForContext(context, connection);

  return deriveForeignWalletRuntime({
    coin,
    crypto: getForeignWalletCrypto(),
    nonce: seed.addressIndex,
    seed: seed.seed,
    walletVersion: seed.walletVersion,
  });
}

async function getUserForeignWalletForApp(request: QdnAppRequest, context: QdnViewContext | null) {
  if (isNativeAssetRequest(request, true)) {
    const profile = await getAccountProfile(getQdnWriteAccountId(context));

    return {
      address: profile.address,
      assetId: NATIVE_ASSET_ID,
      assetName: NATIVE_ASSET_LABEL,
      native: true,
    };
  }

  const connection = await getNodeConnection();
  const wallet = deriveForeignWalletForContext(request, context, connection);

  return getForeignWalletPublicResponse(wallet);
}

async function postForeignWalletReadForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  endpoint: ForeignWalletReadEndpoint,
) {
  const connection = await getNodeConnection();
  const wallet = deriveForeignWalletForContext(request, context, connection);
  const apiKey = getNodeApiKey(connection);
  const result = await executeForeignWalletRead(
    wallet,
    endpoint,
    ({ body, contentType, pathname }) => postLocalNodeText(
      connection,
      pathname,
      body,
      apiKey,
      `Foreign wallet ${endpoint} request failed.`,
      contentType,
    ),
  );

  return parseResponseData(result.body, result.contentType);
}

async function getCrosschainServerInfoForApp(request: QdnAppRequest) {
  const coin = normalizeForeignWalletCoin(getRequestValue(request, 'coin') ?? getRequestValue(request, 'blockchain'));
  const serverInfo = await fetchNodeApiPayload(`/crosschain/${coin.toLowerCase()}/serverinfos`, request);

  return isRecord(serverInfo) && Array.isArray(serverInfo.servers) ? serverInfo.servers : serverInfo;
}

async function getForeignFeeForApp(request: QdnAppRequest) {
  const coin = normalizeForeignWalletCoin(getRequestValue(request, 'coin') ?? getRequestValue(request, 'blockchain'));
  const feePath = getForeignFeePath(request);
  const fee = await fetchNodeApiPayload(`/crosschain/${coin.toLowerCase()}/${feePath}`, request);

  if (feePath === 'feekb') {
    return {
      fee: feePerKbToFeePerByteString(fee),
      feePerKb: fee,
    };
  }

  return { fee };
}

async function getServerConnectionHistoryForApp(request: QdnAppRequest) {
  const coin = normalizeForeignWalletCoin(getRequestValue(request, 'coin') ?? getRequestValue(request, 'blockchain'));

  return fetchNodeApiPayload(`/crosschain/${coin.toLowerCase()}/serverconnectionhistory`, request);
}

async function getNativeAssetInfo(connection: NodeConnection) {
  const response = await fetchNode(`/assets/info?assetId=${NATIVE_ASSET_ID}`, {}, connection.nodeApiUrl);
  const body = (await response.text()).trim();

  if (!response.ok) {
    throw new Error('Native asset is not active on this node yet.');
  }

  return parseResponseData(body, response.headers.get('content-type') ?? '');
}

function getMarketPriceRequest(request: QdnAppRequest) {
  const coins = normalizeMarketPriceCoins(getRequestValue(request, 'coins') ?? getRequestValue(request, 'coin'));
  const currencies = normalizeMarketPriceCurrencies(
    getRequestValue(request, 'currencies') ??
      getRequestValue(request, 'currency') ??
      getRequestValue(request, 'vsCurrencies') ??
      getRequestValue(request, 'vs_currencies'),
  );
  const include24hChange =
    getBoolean(getRequestValue(request, 'include24hChange')) ??
    getBoolean(getRequestValue(request, 'include_24hr_change')) ??
    getBoolean(getRequestValue(request, 'includeChange')) ??
    false;

  return { coins, currencies, include24hChange };
}

async function getMarketPricesForApp(request: QdnAppRequest) {
  const priceRequest = getMarketPriceRequest(request);
  const cacheKey = getMarketPriceCacheKey(
    priceRequest.coins,
    priceRequest.currencies,
    priceRequest.include24hChange,
  );
  const cached = marketPriceCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return {
      ...cached.response,
      cacheHit: true,
      stale: false,
    };
  }

  try {
    const path = buildCoinGeckoSimplePricePath(
      priceRequest.coins,
      priceRequest.currencies,
      priceRequest.include24hChange,
    );
    const response = await fetch(`https://api.coingecko.com/api/v3${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.text();

    if (!response.ok) {
      throw new Error(`CoinGecko request failed with HTTP ${response.status}: ${body.slice(0, 200)}`);
    }

    const payload = body ? JSON.parse(body) as unknown : {};
    const priceResponse = buildMarketPriceResponse({
      ...priceRequest,
      cacheHit: false,
      fetchedAt: Date.now(),
      payload,
    });

    marketPriceCache.set(cacheKey, {
      expiresAt: priceResponse.fetchedAt + MARKET_PRICE_CACHE_TTL_MS,
      response: priceResponse,
    });

    return priceResponse;
  } catch (error) {
    if (cached) {
      return {
        ...cached.response,
        cacheHit: true,
        stale: true,
        staleReason: error instanceof Error ? error.message : String(error),
      };
    }

    throw error;
  }
}

async function setCurrentForeignServerForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const coin = normalizeForeignWalletCoin(getRequestValue(request, 'coin') ?? getRequestValue(request, 'blockchain'));
  const server = getForeignServerPayload(request);
  const writeContext = await getQdnWriteContext(context, {
    name: `${coin} server ${server.hostName}:${server.port}`,
    service: 'FOREIGN_CHAIN',
    tags: [],
  });

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'SET_CURRENT_FOREIGN_SERVER',
    details: [
      { label: 'Coin', value: coin },
      { label: 'Host', value: server.hostName },
      { label: 'Port', value: String(server.port) },
      { label: 'Connection', value: server.connectionType },
      ...(server.certificateSha256Fingerprint
        ? [{ label: 'Certificate SHA-256', value: server.certificateSha256Fingerprint }]
        : []),
    ],
    name: `${coin} server ${server.hostName}:${server.port}`,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const result = await postLocalNodeText(
    writeContext.connection,
    `/crosschain/${coin.toLowerCase()}/setcurrentserver`,
    JSON.stringify(server),
    writeContext.apiKey,
    'Foreign server selection failed.',
    'application/json',
  );

  return parseResponseData(result.body, result.contentType);
}

function encodeChatTextData(message: string) {
  return base58Encode(Buffer.from(message, 'utf8'));
}

function getChatMessageText(request: QdnAppRequest) {
  const message =
    getString(getRequestValue(request, 'message')) || getString(getRequestValue(request, 'data'));

  if (!message) {
    throw new Error('Chat message is required.');
  }

  const byteLength = Buffer.byteLength(message, 'utf8');

  if (byteLength > QDN_CHAT_MESSAGE_MAX_BYTES) {
    throw new Error(
      `Chat message exceeds the ${QDN_CHAT_MESSAGE_MAX_BYTES.toLocaleString()} byte limit.`,
    );
  }

  return message;
}

function getChatMessagePreview(message: string) {
  return message.length > 120 ? `${message.slice(0, 117)}...` : message;
}

type QdnChatMessageTarget =
  | {
      groupId: number;
      kind: 'group';
    }
  | {
      kind: 'direct';
      recipientAddress: string;
    };

function getDirectChatRecipientAddress(request: QdnAppRequest) {
  for (const key of ['destinationAddress', 'recipient', 'recipientAddress']) {
    const value = getString(getRequestValue(request, key));

    if (value) {
      return value;
    }
  }

  if (getString(getRequestValue(request, 'recipientPublicKey'))) {
    throw new Error('Direct private chat requires a recipient address, not a recipient public key.');
  }

  return '';
}

function getDirectChatOtherAddress(request: QdnAppRequest) {
  const otherAddress = getString(getRequestValue(request, 'otherAddress')) || getDirectChatRecipientAddress(request);

  if (!otherAddress) {
    throw new Error('Other direct chat participant address is required.');
  }

  return otherAddress;
}

function getChatMessageTarget(request: QdnAppRequest): QdnChatMessageTarget {
  const hasGroupTarget = hasRequestValue(request, 'groupId') || hasRequestValue(request, 'txGroupId');
  const recipientAddress = getDirectChatRecipientAddress(request);

  if (hasGroupTarget && recipientAddress) {
    throw new Error('Chat message request must target either a group or a direct recipient, not both.');
  }

  if (recipientAddress) {
    return {
      kind: 'direct',
      recipientAddress,
    };
  }

  return {
    kind: 'group',
    groupId: getRequiredGroupId(request),
  };
}

function getAuthorizeRequest(value: QdnAuthorizeResourceRequest) {
  const service = getString(value.service).toUpperCase();
  const name = getString(value.name);
  const identifier = getString(value.identifier);

  if (!isPublicQdnService(service)) {
    throw new Error(
      isPrivateQdnService(service)
        ? 'Private (encrypted) QDN resources cannot be opened in Home yet.'
        : 'Only public QDN resources can be loaded right now.',
    );
  }

  if (!name) {
    throw new Error('QDN resource name is required.');
  }

  return {
    service,
    name,
    identifier: identifier || undefined,
  };
}

function getRawResourceRequest(value: QdnRawResourceRequest) {
  return {
    ...getAuthorizeRequest(value),
    path: getString(value.path),
  };
}

function hasZipMagicBytes(bytes: Buffer) {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  );
}

function isQdnPublishZip(filename: string | undefined, dataBase64?: string) {
  if (filename && path.extname(filename).toLowerCase() === '.zip') {
    return true;
  }

  if (!dataBase64) {
    return false;
  }

  return hasZipMagicBytes(Buffer.from(dataBase64.slice(0, 16), 'base64'));
}

function getInlinePublishSource(request: QdnAppRequest): QdnWriteSourceSelection | null {
  const dataBase64 = getInlinePublishData(request);

  if (!dataBase64) {
    return null;
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64) || dataBase64.length % 4 !== 0) {
    throw new Error('QDN publish data must be valid base64.');
  }

  const filename = sanitizeFilename(getString(getRequestValue(request, 'filename')) || 'qdn-resource');
  const size = Buffer.from(dataBase64, 'base64').byteLength;

  if (size > QDN_WRITE_SOURCE_MAX_BYTES) {
    throw new Error(
      `QDN publish data exceeds the ${QDN_WRITE_SOURCE_MAX_BYTES.toLocaleString()} byte limit.`,
    );
  }

  return {
    dataBase64,
    displayName: filename,
    filename,
    isZip: isQdnPublishZip(filename, dataBase64),
    kind: 'data',
    size,
  };
}

function isInlineQdnWriteSource(
  source: QdnWriteSourceSelection,
): source is QdnWriteSourceSelection & { dataBase64: string; kind: 'data' } {
  return source.kind === 'data' && typeof source.dataBase64 === 'string';
}

function getRequestedQdnPublishSourceKind(request: QdnAppRequest, fallback: QdnPublishSourcePickKind) {
  const kind = getString(getRequestValue(request, 'kind')).toLowerCase();

  if (kind === 'file' || kind === 'directory') {
    return kind;
  }

  return fallback;
}

function getQdnWriteResourceRequests(request: QdnAppRequest) {
  const resources = getRequestValue(request, 'resources');

  if (!Array.isArray(resources) || resources.length === 0) {
    throw new Error('QDN publish resources must be a non-empty array.');
  }

  return resources.map((resource, index) => {
    if (!isRecord(resource)) {
      throw new Error(`QDN publish resource ${index + 1} must be an object.`);
    }

    return {
      resource: getQdnWriteResourceRequest(resource as QdnAppRequest),
      source: getInlinePublishSource(resource as QdnAppRequest),
      sourceToken: getQdnPublishSourceToken(resource as QdnAppRequest),
    };
  });
}

function splitPathAndQuery(resourcePath: string) {
  const queryIndex = resourcePath.indexOf('?');

  if (queryIndex === -1) {
    return {
      pathOnly: resourcePath,
      queryString: '',
    };
  }

  return {
    pathOnly: resourcePath.slice(0, queryIndex),
    queryString: resourcePath.slice(queryIndex + 1),
  };
}

function buildRawResourceUrl(resource: QdnResourceRequest, nodeApiUrl: string, attachment = false) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const { pathOnly, queryString } = splitPathAndQuery(resource.path);
  const queryParams = new URLSearchParams(queryString);

  if (pathOnly) {
    queryParams.set('filepath', pathOnly);
  }

  if (attachment) {
    queryParams.set('attachment', 'true');
  }

  const rawQueryString = queryParams.toString();

  return `${nodeApiUrl}/arbitrary/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}${
    rawQueryString ? `?${rawQueryString}` : ''
  }`;
}

function getContentLength(response: Response) {
  const rawLength = response.headers.get('content-length');

  if (!rawLength) {
    return undefined;
  }

  const contentLength = Number(rawLength);

  return Number.isFinite(contentLength) ? contentLength : undefined;
}

function sanitizeFilename(value: string) {
  const sanitized = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();

  return sanitized.slice(0, 180) || 'qdn-resource';
}

function getSuggestedFilename(request: QdnRawResourceRequest, resource: QdnResourceRequest) {
  const requestedFilename = getString(request.suggestedFilename);

  if (requestedFilename) {
    return sanitizeFilename(requestedFilename);
  }

  return sanitizeFilename(`${resource.service}_${resource.name}_${resource.identifier ?? 'default'}`);
}

function getAppPath(name: Parameters<typeof app.getPath>[0]) {
  try {
    return app.getPath(name);
  } catch {
    return '';
  }
}

function getDefaultDownloadPath(filename: string) {
  const documentsPath = getAppPath('documents');
  const homePath = getAppPath('home');
  const basePath = documentsPath && existsSync(documentsPath) ? documentsPath : homePath;

  return path.join(basePath || process.cwd(), filename);
}

function getNodeUnavailableMessage(nodeApiUrl: string) {
  return `Qortium node is unavailable at ${nodeApiUrl}.`;
}

function getNetworkRestrictionMessage() {
  return 'The selected Qortium Public node is read-only and does not expose that endpoint. Use a local Core or trusted custom node for write, admin, or private API workflows.';
}

function networkRestrictionError() {
  return Object.assign(new Error(getNetworkRestrictionMessage()), { code: 'PUBLIC_NODE_READ_ONLY' });
}

function assertLocalWriteConnection(connection: NodeConnection) {
  if (connection.mode === 'network') {
    throw networkRestrictionError();
  }

  let url: URL;

  try {
    url = new URL(connection.nodeApiUrl);
  } catch {
    throw new Error('QDN write requests require a local Core node.');
  }

  if (!isLoopbackHostname(url.hostname)) {
    throw new Error('QDN write requests require a local Core node so Home never sends private keys or local file paths to a remote node.');
  }
}

function isLocalWriteConnection(connection: NodeConnection) {
  return resolveQdnWriteRoute(connection) === 'local';
}

function getNodeApiKey(connection: NodeConnection) {
  const apiKey = connection.apiKey?.trim();

  if (!apiKey) {
    if (connection.mode === 'custom') {
      throw new Error('Save the custom node API key before using protected QDN workflows.');
    }

    throw new Error('Start Qortium Core from Home, or save the local node API key before using protected QDN workflows.');
  }

  return apiKey;
}

async function fetchNode(pathname: string, options: RequestInit = {}, nodeApiUrl: string) {
  let response: Response;

  try {
    response = await nodeFetch(`${nodeApiUrl}${pathname}`, options);
  } catch {
    throw new Error(getNodeUnavailableMessage(nodeApiUrl));
  }

  return response;
}

async function fetchConfiguredNode(pathname: string, options: RequestInit = {}) {
  const connection = await getNodeConnection();

  try {
    return {
      connection,
      response: await fetchNode(pathname, options, connection.nodeApiUrl),
    };
  } catch (error) {
    if (connection.mode !== 'network') {
      throw error;
    }

    const retryConnection = await getNodeConnection(true);

    if (retryConnection.nodeApiUrl === connection.nodeApiUrl) {
      throw error;
    }

    return {
      connection: retryConnection,
      response: await fetchNode(pathname, options, retryConnection.nodeApiUrl),
    };
  }
}

async function fetchRawResource(
  resource: QdnResourceRequest,
  connection: NodeConnection,
  attachment = false,
) {
  const headers: Record<string, string> = {};

  if (connection.mode !== 'network') {
    headers['X-API-KEY'] = getNodeApiKey(connection);
  }

  const response = await fetchNode(
    buildRawResourceUrl(resource, connection.nodeApiUrl, attachment).replace(connection.nodeApiUrl, ''),
    {
      headers,
    },
    connection.nodeApiUrl,
  );

  if (!response.ok) {
    const message = (await response.text()).trim();
    if (response.status === 403 && connection.mode === 'network') {
      throw networkRestrictionError();
    }

    const readableMessage = readableNodeErrorMessage(
      message,
      `QDN raw resource request failed with HTTP ${response.status}.`,
    );

    if (isQdnFileNotFoundResponse(response.status, message)) {
      throw new QdnFileNotFoundError(readableMessage);
    }

    throw new Error(readableMessage);
  }

  return response;
}

async function fetchConfiguredRawResource(resource: QdnResourceRequest, attachment = false) {
  const connection = await getNodeConnection();

  try {
    return await fetchRawResource(resource, connection, attachment);
  } catch (error) {
    if (connection.mode !== 'network') {
      throw error;
    }

    const retryConnection = await getNodeConnection(true);

    if (retryConnection.nodeApiUrl === connection.nodeApiUrl) {
      throw error;
    }

    return await fetchRawResource(resource, retryConnection, attachment);
  }
}

// Best-effort lookup of a multi-file resource's declared entry point (Core v1.1.0
// metadata.entryPoint). Used to render APP/WEBSITE archives whose entry file is not
// index.html. Any failure returns undefined so the renderer falls back to the
// conventional index file.
async function fetchResourceEntryPoint(resource: QdnResourceRequest): Promise<string | undefined> {
  try {
    const connection = await getNodeConnection();
    const headers: Record<string, string> = {};

    if (connection.mode !== 'network') {
      headers['X-API-KEY'] = getNodeApiKey(connection);
    }

    const identifier = resource.identifier ? resource.identifier : 'default';
    const metadataPath = `/arbitrary/metadata/${resource.service}/${encodeURIComponent(
      resource.name,
    )}/${encodeURIComponent(identifier)}`;
    const response = await fetchNode(metadataPath, { headers }, connection.nodeApiUrl);

    if (!response.ok) {
      return undefined;
    }

    const metadata: unknown = await response.json();
    const entryPoint =
      metadata && typeof metadata === 'object'
        ? (metadata as { entryPoint?: unknown }).entryPoint
        : undefined;

    return typeof entryPoint === 'string' && entryPoint ? entryPoint : undefined;
  } catch {
    return undefined;
  }
}

// Guards so a pathological resource can't exhaust memory while we build the zip.
const MAX_ZIP_FILE_COUNT = 5000;
const MAX_ZIP_TOTAL_BYTES = 512 * 1024 * 1024;

// Read a multi-file resource's relative file paths from its metadata. The node's
// metadata endpoint always includes the file list.
async function fetchResourceFileList(resource: QdnResourceRequest): Promise<string[]> {
  const connection = await getNodeConnection();
  const headers: Record<string, string> = {};

  if (connection.mode !== 'network') {
    headers['X-API-KEY'] = getNodeApiKey(connection);
  }

  const identifier = resource.identifier ? resource.identifier : 'default';
  const metadataPath = `/arbitrary/metadata/${resource.service}/${encodeURIComponent(
    resource.name,
  )}/${encodeURIComponent(identifier)}`;
  const response = await fetchNode(metadataPath, { headers }, connection.nodeApiUrl);

  if (!response.ok) {
    throw new Error(`Unable to read the resource file list (HTTP ${response.status}).`);
  }

  const metadata: unknown = await response.json();

  return isRecord(metadata) && Array.isArray(metadata.files)
    ? metadata.files.map(getString).filter(Boolean)
    : [];
}

// Multi-file resources have no single artifact to download, so assemble the
// archive client-side: list the files, fetch each one by its relative path, and
// zip them in-process.
async function buildResourceZip(resource: QdnResourceRequest): Promise<Buffer> {
  const files = await fetchResourceFileList(resource);

  if (files.length === 0) {
    throw new Error('This resource has no files to download.');
  }

  if (files.length > MAX_ZIP_FILE_COUNT) {
    throw new Error(`This resource has too many files to download as a zip (${files.length}).`);
  }

  const entries: Record<string, Uint8Array> = {};
  let totalBytes = 0;

  for (const file of files) {
    const response = await fetchConfiguredRawResource({ ...resource, path: file });
    const bytes = new Uint8Array(await response.arrayBuffer());
    totalBytes += bytes.byteLength;

    if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
      throw new Error('This resource is too large to download as a zip.');
    }

    entries[file] = bytes;
  }

  return Buffer.from(zipSync(entries));
}

async function postAuthorizeResource(
  service: string,
  name: string,
  identifier: string | undefined,
  apiKey: string,
  nodeApiUrl: string,
) {
  const identifierPath = identifier ? `/${encodeURIComponent(identifier)}` : '';

  return fetchNode(
    `/render/authorize/${service}/${encodeURIComponent(name)}${identifierPath}`,
    {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
      },
    },
    nodeApiUrl,
  );
}

const REMOTE_AUTHORIZATION_BLOCKED_MESSAGE =
  'This node does not allow remote app authorization. Switch to public network access or use a local node.';

function buildRenderResourcePath(service: string, name: string, identifier: string | undefined) {
  const identifierPath = identifier ? `/${encodeURIComponent(identifier)}` : '';

  return `/render/${service}/${encodeURIComponent(name)}${identifierPath}`;
}

function getAuthorizationFailureMessage(response: Response, message: string) {
  return readableNodeErrorMessage(message, `QDN authorization failed with HTTP ${response.status}.`);
}

async function isPublicRenderAvailable(
  service: string,
  name: string,
  identifier: string | undefined,
  nodeApiUrl: string,
) {
  const response = await fetchNode(buildRenderResourcePath(service, name, identifier), {}, nodeApiUrl);

  response.body?.cancel().catch(() => undefined);

  return response.status !== 401 && response.status !== 403;
}

async function authorizeResource(
  service: string,
  name: string,
  identifier: string | undefined,
  connection: NodeConnection,
) {
  let response = await postAuthorizeResource(
    service,
    name,
    identifier,
    getNodeApiKey(connection),
    connection.nodeApiUrl,
  );

  if (response.ok) {
    return connection;
  }

  let message = (await response.text()).trim();

  if (isInvalidApiKeyResponse(response, message)) {
    const refreshedConnection = await refreshNodeConnectionApiKey(connection);

    if (refreshedConnection) {
      connection = refreshedConnection;
      response = await postAuthorizeResource(
        service,
        name,
        identifier,
        getNodeApiKey(connection),
        connection.nodeApiUrl,
      );

      if (response.ok) {
        return connection;
      }

      message = (await response.text()).trim();
    }
  }

  // An access-layer rejection (public API allowlist) is a 403 with a bare
  // HTML error page (or no body); real API errors — including invalid-key —
  // carry a JSON body. isInvalidApiKeyResponse cannot distinguish these (it
  // treats every 401/403 as key-related), so gate on the body shape instead.
  if (response.status === 403 && (!message || message.startsWith('<'))) {
    let publicRenderAvailable = false;

    try {
      publicRenderAvailable = await isPublicRenderAvailable(service, name, identifier, connection.nodeApiUrl);
    } catch {
      publicRenderAvailable = false;
    }

    if (publicRenderAvailable) {
      console.warn('QDN authorization fallback: node blocked remote authorization; using public rendering.');
      return connection;
    }

    throw new Error(REMOTE_AUTHORIZATION_BLOCKED_MESSAGE);
  }

  throw new Error(getAuthorizationFailureMessage(response, message));
}

function buildResourcesSearchPath(request: QdnResourcesSearchRequest) {
  const service = getService(request.service);
  const name = getString(request.name);
  const prefix = getBoolean(request.prefix) ?? false;
  const limit = Math.max(0, Math.floor(getNumber(request.limit) ?? 0));
  const queryParams = new URLSearchParams({
    mode: 'ALL',
    limit: String(limit),
    includestatus: String(getBoolean(request.includeStatus) ?? true),
    includemetadata: String(getBoolean(request.includeMetadata) ?? true),
  });

  if (service) {
    queryParams.set('service', service);
  }

  if (name) {
    queryParams.set('name', name);

    // `prefix` and `exactmatchnames` are mutually exclusive on the node — prefix
    // search matches name/identifier prefixes, so skip exact matching for it.
    if (!prefix) {
      queryParams.set('exactmatchnames', String(getBoolean(request.exactMatchNames) ?? true));
    }
  }

  if (prefix) {
    queryParams.set('prefix', 'true');
  }

  return `/arbitrary/resources/search?${queryParams.toString()}`;
}

function buildNamesSearchPath(request: QdnNamesSearchRequest) {
  const query = getString(request.query);
  const limit = Math.max(0, Math.floor(getNumber(request.limit) ?? 0));
  const queryParams = new URLSearchParams({ query });

  if (limit > 0) {
    queryParams.set('limit', String(limit));
  }

  if (getBoolean(request.prefix) ?? false) {
    queryParams.set('prefix', 'true');
  }

  return `/names/search?${queryParams.toString()}`;
}

function isQdnAccountFreeWriteAction(action: string): action is QdnAccountFreeWriteAction {
  return (QDN_ACCOUNT_FREE_WRITE_ACTIONS as readonly string[]).includes(action);
}

async function fetchPinnedNodeApiData(connection: NodeConnection, apiPath: string) {
  const response = await fetchNode(apiPath, {}, connection.nodeApiUrl);
  const result = await readNodeApiResponse(response, connection, QDN_APP_DEFAULT_MAX_BYTES);

  if (!result.ok) {
    throw getNodeApiResponseError(result, `Qortium node request failed with HTTP ${result.status}.`);
  }

  return result.data;
}

async function handleQdnAccountFreeWriteAction(
  action: QdnAccountFreeWriteAction,
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  if (!context) {
    throw new Error('QDN write request does not belong to an active window.');
  }

  const connection = await getNodeConnection();
  if (connection.mode === 'network') {
    throw networkRestrictionError();
  }

  if (action === 'ADD_TO_LIST' || action === 'REMOVE_FROM_LIST') {
    assertLocalWriteConnection(connection);
  }

  let details: Array<{ label: string; value: string }>;
  let settingsBody: string | undefined;
  let listName: string | undefined;
  let itemStrings: string[] | undefined;

  if (action === 'UPDATE_NODE_SETTINGS') {
    const entries = Object.entries(getNodeSettingsPatch(request));

    if (entries.length === 0) {
      throw new Error('Node settings update requests must include at least one setting.');
    }

    if (entries.length > 64) {
      throw new Error('Node settings update requests may include at most 64 settings.');
    }

    for (const [key] of entries) {
      if (key.length > 120) {
        throw new Error('Node setting names may contain at most 120 characters.');
      }
    }

    const [metadata, currentSettingsValue] = await Promise.all([
      fetchPinnedNodeApiData(connection, '/admin/settings/metadata'),
      fetchPinnedNodeApiData(connection, '/admin/settings'),
    ]);
    const writableKeys = getWritableSettingKeys(metadata);

    for (const [key] of entries) {
      if (!writableKeys.has(key)) {
        throw new Error(`Node setting ${key} is not writable.`);
      }
    }

    if (!isRecord(currentSettingsValue)) {
      throw new Error('The current node settings response is not an object.');
    }

    details = entries.flatMap(([key, value]) => [
      {
        label: `${key} (current)`,
        value: Object.prototype.hasOwnProperty.call(currentSettingsValue, key)
          ? getExactQdnApprovalValue(currentSettingsValue[key], 1_000)
          : '(not present)',
      },
      { label: `${key} (proposed)`, value: getExactQdnApprovalValue(value, 1_000) },
    ]);
    settingsBody = JSON.stringify(Object.fromEntries(entries));
  } else if (action === 'RESTART_NODE') {
    details = [{ label: 'Impact', value: 'Restart the selected Core node' }];
  } else {
    listName = getRequiredListName(request);
    itemStrings = [...getRequiredListItems(request)];

    if (listName.length > 120) {
      throw new Error('List names may contain at most 120 characters.');
    }

    details = [
      { label: 'List', value: listName },
      { label: 'Items', value: getExactQdnApprovalValue(itemStrings, 4_000) },
    ];
  }

  details.unshift({ label: 'Node', value: getExactQdnApprovalValue(connection.nodeApiUrl, 500) });

  await requestQdnWriteApproval(context, null, { action, details });
  assertFreshQdnWriteContext(sender, context);

  if (action === 'UPDATE_NODE_SETTINGS') {
    return requestProtectedConfiguredNodeApi(
      '/admin/settings',
      'PATCH',
      'Node settings update request failed.',
      settingsBody,
      connection,
    );
  }

  if (action === 'RESTART_NODE') {
    return requestProtectedConfiguredNodeApi(
      '/admin/restart',
      'GET',
      'Node restart request failed.',
      undefined,
      connection,
    );
  }

  const body = JSON.stringify({ items: itemStrings });
  const apiKey = getNodeApiKey(connection);
  const result = action === 'ADD_TO_LIST'
    ? await postLocalNodeText(
        connection,
        `/lists/${encodeURIComponent(listName as string)}`,
        body,
        apiKey,
        'Failed to add items to list.',
        'application/json',
      )
    : await deleteLocalNodeText(
        connection,
        `/lists/${encodeURIComponent(listName as string)}`,
        body,
        apiKey,
        'Failed to remove items from list.',
        'application/json',
      );

  return parseLocalPostData(result);
}

function getHeaders(response: Response) {
  const headers: Record<string, string> = {};

  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return headers;
}

function parseResponseData(body: string, contentType: string) {
  const normalizedContentType = contentType.toLowerCase();

  if (!body) {
    return null;
  }

  if (
    normalizedContentType.includes('json') ||
    body.trimStart().startsWith('{') ||
    body.trimStart().startsWith('[')
  ) {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return body;
    }
  }

  return body;
}

async function readNodeApiResponse(
  response: Response,
  connection: NodeConnection,
  maxBytes: number,
  readBody = true,
): Promise<NodeApiFetchResult> {
  const contentLength = getContentLength(response);
  const contentType = response.headers.get('content-type') ?? '';
  const headers = getHeaders(response);

  if (maxBytes > 0 && typeof contentLength === 'number' && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Node API response exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  const rawBody = readBody ? await response.text() : '';
  const networkRestricted = response.status === 403 && connection.mode === 'network';
  const body = networkRestricted ? getNetworkRestrictionMessage() : rawBody;
  const bodyLength = Buffer.byteLength(body, 'utf8');

  if (maxBytes > 0 && bodyLength > maxBytes) {
    throw new Error(`Node API response exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  return {
    body,
    contentLength: contentLength ?? bodyLength,
    contentType,
    data: parseResponseData(body, contentType),
    headers,
    ...(networkRestricted ? { code: 'PUBLIC_NODE_READ_ONLY' } : {}),
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  };
}

function getNodeApiResponseError(result: NodeApiFetchResult, fallbackMessage: string) {
  return Object.assign(
    new Error(readableNodeErrorMessage(result.body, fallbackMessage)),
    result.code ? { code: result.code } : {},
  );
}

async function fetchConfiguredNodeApi(
  apiPath: string,
  maxBytes: number,
  method: 'GET' | 'HEAD' = 'GET',
) {
  const { connection, response } = await fetchConfiguredNode(apiPath, { method });

  return readNodeApiResponse(response, connection, maxBytes, method !== 'HEAD');
}

async function requestProtectedConfiguredNodeApi(
  apiPath: string,
  method: 'GET' | 'PATCH',
  fallbackMessage: string,
  body?: string,
  approvedConnection?: NodeConnection,
) {
  let connection = approvedConnection ?? await getNodeConnection();

  if (connection.mode === 'network') {
    throw networkRestrictionError();
  }

  const fetchProtected = (activeConnection: NodeConnection) => fetchNode(
    apiPath,
    {
      method,
      headers: {
        Accept: 'application/json',
        'X-API-KEY': getNodeApiKey(activeConnection),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body,
    },
    activeConnection.nodeApiUrl,
  );

  let response = await fetchProtected(connection);
  let responseBody = await response.text();

  if (!approvedConnection && !response.ok && connection.mode === 'local' && isInvalidApiKeyResponse(response, responseBody)) {
    const refreshedConnection = await refreshNodeConnectionApiKey(connection);

    if (refreshedConnection) {
      connection = refreshedConnection;
      response = await fetchProtected(connection);
      responseBody = await response.text();
    }
  }

  if (!response.ok) {
    throw new Error(readableNodeErrorMessage(responseBody, fallbackMessage));
  }

  return parseResponseData(responseBody, response.headers.get('content-type') ?? '');
}

async function fetchNodeApiPayload(apiPath: string, request: QdnAppRequest) {
  const result = await fetchConfiguredNodeApi(
    apiPath,
    getQdnAppMaxBytes(getRequestValue(request, 'maxBytes')),
  );

  if (!result.ok) {
    throw getNodeApiResponseError(result, `Qortium node request failed with HTTP ${result.status}.`);
  }

  // Opt-in: return the status + response headers alongside the body, so apps can
  // read headers such as X-Total-Count (used by the paginated trust-derivation
  // listing). Default stays the bare body for backward compatibility.
  if (getBoolean(getRequestValue(request, 'includeHeaders')) ?? false) {
    return { status: result.status, headers: result.headers, data: result.data };
  }

  return result.data;
}

async function getCrosschainBlockchainsForApp(request: QdnAppRequest) {
  const blockchains = await fetchNodeApiPayload('/crosschain/blockchains', request);
  // Core reports foreign-chain wallet stacks. Home also exposes QORT through
  // public Qortal nodes, and explicitly project which rows Home can operate.
  return buildHomeBlockchainDiscovery(blockchains, QORTAL_PUBLIC_NODE_BLOCKCHAIN_INFO);
}

// --- Read-only cross-chain reads from Qortal nodes ---
// Mirrors the desktop QDN read pipeline but targets Qortal nodes: GET/HEAD against public QDN
// services only, no account, API key, signing or writes.

let cachedQortalNodeApiUrl: { expiresAt: number; source: QortalNodeCandidate['source']; url: string } | null =
  null;
const marketPriceCache = new Map<string, { expiresAt: number; response: MarketPriceResponse }>();

function getQortalStatusHeight(status: unknown) {
  if (!status || typeof status !== 'object') {
    return 0;
  }

  const height = (status as { height?: unknown }).height;

  return typeof height === 'number' && Number.isFinite(height) ? height : 0;
}

function getQortalStatusIsSynchronizing(status: unknown) {
  if (!status || typeof status !== 'object') {
    return true;
  }

  const isSynchronizing = (status as { isSynchronizing?: unknown }).isSynchronizing;

  return typeof isSynchronizing === 'boolean' ? isSynchronizing : true;
}

function getQortalStatusSyncPhase(status: unknown) {
  if (!status || typeof status !== 'object') {
    return '';
  }

  const syncPhase = (status as { syncPhase?: unknown }).syncPhase;

  return typeof syncPhase === 'string' ? syncPhase.trim().toUpperCase() : '';
}

function getQortalStatusSyncPercent(status: unknown) {
  if (!status || typeof status !== 'object') {
    return null;
  }

  const syncPercent = (status as { syncPercent?: unknown }).syncPercent;

  return typeof syncPercent === 'number' && Number.isFinite(syncPercent) ? syncPercent : null;
}

function getQortalStatusSyncBlocksRemaining(status: unknown) {
  if (!status || typeof status !== 'object') {
    return null;
  }

  const syncBlocksRemaining = (status as { syncBlocksRemaining?: unknown }).syncBlocksRemaining;

  return typeof syncBlocksRemaining === 'number' && Number.isFinite(syncBlocksRemaining)
    ? syncBlocksRemaining
    : null;
}

function isSyncedQortalStatus(status: unknown) {
  return (
    getQortalStatusHeight(status) > 0 &&
    getQortalStatusSyncPhase(status) === 'SYNCED' &&
    getQortalStatusSyncPercent(status) === 100 &&
    getQortalStatusSyncBlocksRemaining(status) === 0 &&
    !getQortalStatusIsSynchronizing(status)
  );
}

function getQortalNodeCandidates(): QortalNodeCandidate[] {
  return [
    {
      requiresPublicReadProbe: true,
      requiresSyncedStatus: true,
      source: 'local',
      url: QORTAL_LOCAL_NODE_API_URL,
    },
    ...QORTAL_REMOTE_NODE_API_URLS.map(
      (url): QortalNodeCandidate => ({
        requiresPublicReadProbe: false,
        requiresSyncedStatus: false,
        source: 'remote',
        url,
      }),
    ),
  ];
}

async function readQortalNodeStatus(nodeApiUrl: string) {
  const response = await fetchNode(
    '/admin/status',
    { method: 'GET', signal: AbortSignal.timeout(QORTAL_PROBE_TIMEOUT_MS) },
    nodeApiUrl,
  );

  if (!response.ok) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function probeQortalPublicReadAccess(nodeApiUrl: string) {
  try {
    const response = await fetchNode(
      QORTAL_PUBLIC_READ_PROBE_PATH,
      { method: 'GET', signal: AbortSignal.timeout(QORTAL_PROBE_TIMEOUT_MS) },
      nodeApiUrl,
    );

    return response.ok;
  } catch {
    return false;
  }
}

async function probeQortalNodeCandidate(candidate: QortalNodeCandidate) {
  try {
    const status = await readQortalNodeStatus(candidate.url);

    if (!status) {
      return false;
    }

    if (candidate.requiresSyncedStatus && !isSyncedQortalStatus(status)) {
      return false;
    }

    if (candidate.requiresPublicReadProbe && !(await probeQortalPublicReadAccess(candidate.url))) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function invalidateCachedQortalNodeApiUrl(nodeApiUrl?: string) {
  if (!nodeApiUrl || cachedQortalNodeApiUrl?.url === nodeApiUrl) {
    cachedQortalNodeApiUrl = null;
  }
}

async function resolveQortalNodeApiUrl(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedQortalNodeApiUrl && cachedQortalNodeApiUrl.expiresAt > Date.now()) {
    return cachedQortalNodeApiUrl.url;
  }

  for (const candidate of getQortalNodeCandidates()) {
    if (await probeQortalNodeCandidate(candidate)) {
      cachedQortalNodeApiUrl = {
        expiresAt: Date.now() + QORTAL_NODE_CACHE_TTL_MS,
        source: candidate.source,
        url: candidate.url,
      };
      return candidate.url;
    }
  }

  throw new Error('No Qortal node is reachable right now.');
}

async function fetchQortalNodeWithRetry(apiPath: string, createOptions: () => RequestInit = () => ({})) {
  const nodeApiUrl = await resolveQortalNodeApiUrl(cachedQortalNodeApiUrl?.source === 'local');

  try {
    return await fetchNode(apiPath, createOptions(), nodeApiUrl);
  } catch (error) {
    invalidateCachedQortalNodeApiUrl(nodeApiUrl);

    const retryNodeApiUrl = await resolveQortalNodeApiUrl(true);
    if (retryNodeApiUrl === nodeApiUrl) {
      throw error;
    }

    return fetchNode(apiPath, createOptions(), retryNodeApiUrl);
  }
}

async function fetchQortalNodeApi(
  apiPath: string,
  maxBytes: number,
  method: 'GET' | 'HEAD' = 'GET',
): Promise<NodeApiFetchResult> {
  const response = await fetchQortalNodeWithRetry(apiPath, () => ({ method }));

  const contentLength = getContentLength(response);
  const contentType = response.headers.get('content-type') ?? '';
  const headers = getHeaders(response);

  if (maxBytes > 0 && typeof contentLength === 'number' && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Qortal node response exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  const body = method !== 'HEAD' ? await response.text() : '';
  const bodyLength = Buffer.byteLength(body, 'utf8');

  if (maxBytes > 0 && bodyLength > maxBytes) {
    throw new Error(`Qortal node response exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  return {
    body,
    contentLength: contentLength ?? bodyLength,
    contentType,
    data: parseResponseData(body, contentType),
    headers,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  };
}

async function fetchQortalNodeApiPayload(apiPath: string, request: QdnAppRequest) {
  const result = await fetchQortalNodeApi(apiPath, getQdnAppMaxBytes(getRequestValue(request, 'maxBytes')));

  if (!result.ok) {
    throw new Error(readableNodeErrorMessage(result.body, `Qortal node request failed with HTTP ${result.status}.`));
  }

  return result.data;
}

async function getQortalPrimaryNameForApp(request: QdnAppRequest, context: QdnViewContext | null) {
  const address = await getAddressForQdnRequest(request, context, 'Address');
  const result = await fetchQortalNodeApi(
    `/names/primary/${encodeURIComponent(address)}`,
    getQdnAppMaxBytes(getRequestValue(request, 'maxBytes')),
  );

  if (result.status === 404 || result.body.trim() === '') {
    return null;
  }

  if (!result.ok) {
    throw new Error(readableNodeErrorMessage(result.body, `Qortal node request failed with HTTP ${result.status}.`));
  }

  return result.data ?? null;
}

function getQortalNameFromRequest(request: QdnAppRequest) {
  const name = getString(getRequestValue(request, 'name')) || getString(getRequestValue(request, 'recipient'));

  if (!name) {
    throw new Error('Qortal name is required.');
  }

  return name;
}

async function getQortalNameData(name: string, maxBytes = QDN_APP_DEFAULT_MAX_BYTES) {
  const result = await fetchQortalNodeApi(`/names/${encodeURIComponent(name)}`, maxBytes);

  if (result.status === 404 || result.body.trim() === '') {
    return null;
  }

  if (!result.ok) {
    throw new Error(readableNodeErrorMessage(result.body, `Qortal node request failed with HTTP ${result.status}.`));
  }

  return result.data ?? null;
}

async function getQortalNameDataForApp(request: QdnAppRequest) {
  return getQortalNameData(getQortalNameFromRequest(request), getQdnAppMaxBytes(getRequestValue(request, 'maxBytes')));
}

function getQortalTransactionSignatureFromRequest(request: QdnAppRequest) {
  const signature = getString(getRequestValue(request, 'signature')) || getString(getRequestValue(request, 'txSignature'));

  if (!signature) {
    throw new Error('Transaction signature is required.');
  }

  return signature;
}

async function getQortalTransactionForApp(request: QdnAppRequest) {
  const signature = getQortalTransactionSignatureFromRequest(request);
  const result = await fetchQortalNodeApi(
    `/transactions/signature/${encodeURIComponent(signature)}`,
    getQdnAppMaxBytes(getRequestValue(request, 'maxBytes')),
  );

  if (result.status === 404 || result.body.trim() === '') {
    return null;
  }

  if (!result.ok) {
    throw new Error(readableNodeErrorMessage(result.body, `Qortal node request failed with HTTP ${result.status}.`));
  }

  return result.data ?? null;
}

async function getQortalChatMessageForApp(request: QdnAppRequest) {
  const signature = getQortalTransactionSignatureFromRequest(request);
  const result = await fetchQortalNodeApi(
    `/chat/message/${encodeURIComponent(signature)}?encoding=BASE64`,
    getQdnAppMaxBytes(getRequestValue(request, 'maxBytes')),
  );

  if (result.status === 400 || result.status === 404 || result.body.trim() === '') {
    return null;
  }

  if (!result.ok) {
    throw new Error(readableNodeErrorMessage(result.body, `Qortal node request failed with HTTP ${result.status}.`));
  }

  return result.data ?? null;
}

class SendQortValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SendQortValidationError';
  }
}

class SendQortBroadcastError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SendQortBroadcastError';
  }
}

function getSendQortErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getSendQortRequest(request: QdnAppRequest) {
  const recipient =
    getString(getRequestValue(request, 'recipient')) ||
    getString(getRequestValue(request, 'recipientAddress')) ||
    getString(getRequestValue(request, 'address'));
  const amount = getRequestValue(request, 'amount');

  if (!recipient) {
    throw new SendQortValidationError('SEND_QORT requires a recipient address.');
  }

  if (typeof amount !== 'string' && typeof amount !== 'number') {
    throw new SendQortValidationError('SEND_QORT requires an amount.');
  }

  let recipientKind: 'address' | 'name' = 'address';

  try {
    assertValidQortalAddress(recipient, 'Recipient address');
  } catch {
    recipientKind = 'name';
  }

  let amountAtomic: bigint;

  try {
    amountAtomic = assertPositiveQortAmount(qortDecimalToAtomic(amount, 'Amount'), 'Amount');
  } catch (error) {
    throw new SendQortValidationError(getSendQortErrorMessage(error));
  }

  return {
    amountAtomic,
    recipientKind,
    recipient,
  };
}

function getResolvedQortalNameOwner(nameData: unknown, name: string) {
  if (!isRecord(nameData)) {
    throw new SendQortValidationError(`Qortal name "${name}" was not found.`);
  }

  const owner = getString(nameData.owner);

  if (!owner) {
    throw new SendQortValidationError(`Qortal name "${name}" does not have an owner address.`);
  }

  try {
    assertValidQortalAddress(owner, `Owner address for "${name}"`);
  } catch (error) {
    throw new SendQortValidationError(getSendQortErrorMessage(error));
  }

  return owner;
}

async function resolveSendQortRecipient(sendRequest: ReturnType<typeof getSendQortRequest>) {
  if (sendRequest.recipientKind === 'address') {
    return {
      address: sendRequest.recipient,
      approvalRecipient: sendRequest.recipient,
      details: [] as Array<{ label: string; value: string }>,
      name: null as string | null,
    };
  }

  const nameData = await getQortalNameData(sendRequest.recipient, 4096);
  const address = getResolvedQortalNameOwner(nameData, sendRequest.recipient);

  return {
    address,
    approvalRecipient: sendRequest.recipient,
    details: [{ label: 'Resolved address', value: address }],
    name: sendRequest.recipient,
  };
}

async function postQortalNodeText(
  apiPath: string,
  body: string,
  fallbackMessage: string,
  contentType = 'text/plain',
) {
  const response = await fetchQortalNodeWithRetry(apiPath, () => ({
    body,
    headers: { 'Content-Type': contentType },
    method: 'POST',
    signal: AbortSignal.timeout(QORTAL_WRITE_TIMEOUT_MS),
  }));
  const responseBody = (await response.text()).trim();
  const contentTypeHeader = response.headers.get('content-type') ?? '';

  if (!response.ok) {
    throw new Error(readableNodeErrorMessage(responseBody, `${fallbackMessage} HTTP ${response.status}.`));
  }

  return {
    body: responseBody,
    contentType: contentTypeHeader,
    data: parseResponseData(responseBody, contentTypeHeader),
  };
}

function parseQortalFeeAtomic(value: unknown) {
  try {
    return atomicLongToBigInt(value, 'QORT fee');
  } catch (error) {
    throw new SendQortValidationError(getSendQortErrorMessage(error));
  }
}

function parseQortalBalanceAtomic(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new SendQortValidationError('QORT balance response was not a decimal amount.');
  }

  try {
    return qortDecimalToAtomic(value, 'QORT balance');
  } catch (error) {
    throw new SendQortValidationError(getSendQortErrorMessage(error));
  }
}

async function fetchSendQortFeeAtomic() {
  const result = await fetchQortalNodeApi('/transactions/unitfee?txType=PAYMENT', 1024);

  if (!result.ok) {
    throw new SendQortValidationError(readableNodeErrorMessage(result.body, `QORT fee lookup failed with HTTP ${result.status}.`));
  }

  return parseQortalFeeAtomic(result.data ?? result.body);
}

async function fetchSendQortBalanceAtomic(address: string) {
  const result = await fetchQortalNodeApi(`/addresses/balance/${encodeURIComponent(address)}`, 1024);

  if (!result.ok) {
    throw new SendQortValidationError(readableNodeErrorMessage(result.body, `QORT balance lookup failed with HTTP ${result.status}.`));
  }

  return parseQortalBalanceAtomic(result.data ?? result.body);
}

// Qortal CHAT PoW difficulty depends on the sender's confirmed QORT balance
// (electron/qortal-chat.ts). If the balance fetch fails for any reason, fall
// back to the safer, higher difficulty rather than failing the send outright
// — a slower send beats one Core rejects for insufficient proof-of-work.
async function resolveQortalChatPowDifficulty(address: string) {
  try {
    return qortalChatPowDifficultyForBalance(await fetchSendQortBalanceAtomic(address));
  } catch {
    return QORTAL_CHAT_POW_DIFFICULTY_BELOW;
  }
}

async function fetchSendQortLastReference(address: string) {
  const result = await fetchQortalNodeApi(`/addresses/lastreference/${encodeURIComponent(address)}`, 2048);
  const lastReference = result.body.trim();

  if (!result.ok || !lastReference) {
    throw new SendQortValidationError(
      result.body || 'The selected account does not have a last reference. It may need QORT before it can send.',
    );
  }

  return lastReference;
}

function getSendQortValidationResult(error: unknown) {
  return {
    accepted: false,
    error: getSendQortErrorMessage(error),
    errorType: 'VALIDATION_FAILED',
  };
}

async function sendQortForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  if (!context) {
    throw new Error('SEND_QORT is only available from a QDN app frame.');
  }

  if (!context.accountId) {
    throw new Error('No account is selected for this tab.');
  }

  let sendRequest: ReturnType<typeof getSendQortRequest>;

  try {
    sendRequest = getSendQortRequest(request);
  } catch (error) {
    return getSendQortValidationResult(error);
  }

  const unlocked = await requestSelectedAccountUnlockForQdnApp(context);

  if (!unlocked) {
    return {
      accepted: false,
      canceled: true,
      reason: 'USER_CANCELLED',
    };
  }

  const profile = await getAccountProfile(context.accountId);
  const signingKey = await getAccountSecretKey(context.accountId);

  if (signingKey.address !== profile.address) {
    return getSendQortValidationResult('Selected account signing key does not match the saved account address.');
  }

  let feeAtomic = 0n;
  let balanceAtomic = 0n;
  let lastReference = '';
  let resolvedRecipient: Awaited<ReturnType<typeof resolveSendQortRecipient>>;

  try {
    resolvedRecipient = await resolveSendQortRecipient(sendRequest);
    feeAtomic = await fetchSendQortFeeAtomic();
    balanceAtomic = await fetchSendQortBalanceAtomic(signingKey.address);

    if (sendRequest.amountAtomic + feeAtomic > balanceAtomic) {
      throw new SendQortValidationError(
        `Insufficient QORT balance. Need ${formatQortAtomic(sendRequest.amountAtomic + feeAtomic)} QORT including fee, but only ${formatQortAtomic(balanceAtomic)} QORT is available.`,
      );
    }

    lastReference = await fetchSendQortLastReference(signingKey.address);
  } catch (error) {
    return getSendQortValidationResult(error);
  }

  try {
    await requestQdnWriteApproval(context, profile, {
      action: 'SEND_QORT',
      amount: `${formatQortAtomic(sendRequest.amountAtomic)} QORT`,
      details: [
        { label: 'Chain', value: 'Qortal (mainnet)' },
        ...resolvedRecipient.details,
        { label: 'Fee', value: `${formatQortAtomic(feeAtomic)} QORT` },
      ],
      permissionScope: 'single-request',
      recipientAddress: resolvedRecipient.approvalRecipient,
    });
  } catch (error) {
    if (getSendQortErrorMessage(error) === 'QDN write request was denied.') {
      return {
        accepted: false,
        canceled: true,
        reason: 'USER_CANCELLED',
      };
    }

    throw error;
  }

  assertFreshQdnWriteContext(sender, context);

  const unsignedBytes = buildUnsignedPaymentTransactionBytes({
    amountAtomic: sendRequest.amountAtomic,
    feeAtomic,
    lastReference,
    recipient: resolvedRecipient.address,
    senderPublicKey: signingKey.publicKey58,
    timestamp: Date.now(),
  });
  const signatureBytes = nacl.sign.detached(unsignedBytes, signingKey.secretKey);
  const signedBytes = appendSignatureToTransactionBytes(unsignedBytes, signatureBytes);
  const signedBytes58 = base58Encode(signedBytes);
  const signature = getSignatureFromSignedTransactionBytes(signedBytes);

  try {
    const processedTransaction = await postQortalNodeText(
      '/transactions/process?apiVersion=2',
      signedBytes58,
      'QORT transaction broadcast failed.',
    );

    return {
      accepted: true,
      action: 'SEND_QORT',
      amount: formatQortAtomic(sendRequest.amountAtomic),
      fee: formatQortAtomic(feeAtomic),
      recipient: resolvedRecipient.address,
      recipientName: resolvedRecipient.name,
      result: processedTransaction.data,
      signature,
    };
  } catch (error) {
    return {
      accepted: false,
      error: getSendQortErrorMessage(new SendQortBroadcastError(getSendQortErrorMessage(error))),
      errorType: 'BROADCAST_REJECTED',
      recipient: resolvedRecipient.address,
      recipientName: resolvedRecipient.name,
      signature,
    };
  }
}

function getSendQortalGroupChatRequest(request: QdnAppRequest) {
  let txGroupId: number;
  let repliedTo: string | undefined;
  const text =
    getString(getRequestValue(request, 'text')) ||
    getString(getRequestValue(request, 'message')) ||
    getString(getRequestValue(request, 'messageText'));

  try {
    txGroupId = assertPositiveQortalGroupId(
      getRequestValue(request, 'txGroupId') ?? getRequestValue(request, 'groupId'),
    );
  } catch (error) {
    throw new SendQortValidationError(getSendQortErrorMessage(error));
  }

  if (!text) {
    throw new SendQortValidationError('SEND_QORTAL_GROUP_CHAT requires non-empty text.');
  }

  const rawRepliedTo =
    getString(getRequestValue(request, 'repliedTo')) ||
    getString(getRequestValue(request, 'replyTo')) ||
    getString(getRequestValue(request, 'replySignature'));

  if (rawRepliedTo) {
    try {
      repliedTo = assertValidQortalChatSignature(rawRepliedTo, 'Reply signature');
    } catch (error) {
      throw new SendQortValidationError(getSendQortErrorMessage(error));
    }
  }

  const specialId = randomUUID();

  try {
    return {
      message: buildQortalGroupChatPayload({ repliedTo, specialId, text }),
      repliedTo: repliedTo ?? null,
      specialId,
      text,
      txGroupId,
    };
  } catch (error) {
    throw new SendQortValidationError(getSendQortErrorMessage(error));
  }
}

async function fetchOpenQortalGroupLabel(txGroupId: number) {
  const result = await fetchQortalNodeApi(`/groups/${encodeURIComponent(String(txGroupId))}`, 8192);

  try {
    return assertOpenQortalGroupMetadata(result.ok ? result.data : null, txGroupId).groupLabel;
  } catch (error) {
    throw new SendQortValidationError(getSendQortErrorMessage(error));
  }
}

async function sendQortalGroupChatForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  if (!context) {
    throw new Error('SEND_QORTAL_GROUP_CHAT is only available from a QDN app frame.');
  }

  if (!context.accountId) {
    throw new Error('No account is selected for this tab.');
  }

  let sendRequest: ReturnType<typeof getSendQortalGroupChatRequest>;

  try {
    sendRequest = getSendQortalGroupChatRequest(request);
  } catch (error) {
    return getSendQortValidationResult(error);
  }

  let groupLabel: string;

  try {
    groupLabel = await fetchOpenQortalGroupLabel(sendRequest.txGroupId);
  } catch (error) {
    return getSendQortValidationResult(error);
  }

  const unlocked = await requestSelectedAccountUnlockForQdnApp(context);

  if (!unlocked) {
    return {
      accepted: false,
      canceled: true,
      reason: 'USER_CANCELLED',
    };
  }

  const profile = await getAccountProfile(context.accountId);
  const signingKey = await getAccountSecretKey(context.accountId);

  if (signingKey.address !== profile.address) {
    return getSendQortValidationResult('Selected account signing key does not match the saved account address.');
  }

  try {
    await requestQdnChatPermissionApproval(context, profile, 'SEND_QORTAL_GROUP_CHAT', {
      chatMessagePreview: sendRequest.text.slice(0, 180),
      details: [
        { label: 'Chain', value: 'Qortal (mainnet)' },
        { label: 'Group', value: groupLabel },
        { label: 'Fee', value: '0 QORT' },
      ],
      groupId: sendRequest.txGroupId,
      groupName: groupLabel,
    });
  } catch (error) {
    if (getSendQortErrorMessage(error) === 'QDN write request was denied.') {
      return {
        accepted: false,
        canceled: true,
        reason: 'USER_CANCELLED',
      };
    }

    throw error;
  }

  assertFreshQdnWriteContext(sender, context);

  const unsignedBytes = buildUnsignedQortalGroupChatTransactionBytes({
    lastReference: new Uint8Array(randomBytes(64)),
    message: sendRequest.message,
    senderPublicKey: signingKey.publicKey58,
    timestamp: Date.now(),
    txGroupId: sendRequest.txGroupId,
  });
  const difficulty = await resolveQortalChatPowDifficulty(signingKey.address);
  const nonce = await computeChatNonce(unsignedBytes, difficulty);
  const stampedBytes = stampQortalGroupChatNonce(unsignedBytes, nonce);
  const signatureBytes = nacl.sign.detached(stampedBytes, signingKey.secretKey);
  const signedBytes = appendSignatureToTransactionBytes(stampedBytes, signatureBytes);
  const signedBytes58 = base58Encode(signedBytes);
  const signature = getSignatureFromSignedTransactionBytes(signedBytes);

  try {
    const processedTransaction = await postQortalNodeText(
      '/transactions/process?apiVersion=2',
      signedBytes58,
      'Qortal chat message broadcast failed.',
    );

    return {
      accepted: true,
      action: 'SEND_QORTAL_GROUP_CHAT',
      groupId: sendRequest.txGroupId,
      groupName: groupLabel,
      repliedTo: sendRequest.repliedTo,
      result: processedTransaction.data,
      signature,
      specialId: sendRequest.specialId,
    };
  } catch (error) {
    return {
      accepted: false,
      error: getSendQortErrorMessage(new SendQortBroadcastError(getSendQortErrorMessage(error))),
      errorType: 'BROADCAST_REJECTED',
      groupId: sendRequest.txGroupId,
      groupName: groupLabel,
      signature,
      specialId: sendRequest.specialId,
    };
  }
}

// Qortal resource requests are validated by shape only (read-only public reads); NOT limited to the
// Qortium public-service whitelist, since Qortal resources (ROMs, metadata, etc.) use many services.
function getQortalService(value: unknown) {
  const service = getString(value).toUpperCase();

  if (!service) {
    throw new Error('Qortal resource service is required.');
  }
  if (!/^[A-Z0-9_]+$/.test(service)) {
    throw new Error('Qortal resource service is invalid.');
  }

  return service;
}

function getQortalResourceRequest(request: QdnAppRequest) {
  const service = getQortalService(getRequestValue(request, 'service'));
  const name = getString(getRequestValue(request, 'name'));
  const identifier = getString(getRequestValue(request, 'identifier'));
  const resourcePath = getString(getRequestValue(request, 'path')) || getString(getRequestValue(request, 'filepath'));

  if (!name) {
    throw new Error('Qortal resource name is required.');
  }

  return { service, name, identifier: identifier || undefined, path: resourcePath };
}

function buildQortalResourcePath(resource: { service: string; name: string; identifier?: string; path?: string }) {
  const queryParams = new URLSearchParams();
  if (resource.path) {
    queryParams.set('filepath', resource.path);
  }
  const queryString = queryParams.toString();

  return `/arbitrary/${resource.service}/${encodeURIComponent(resource.name)}${
    resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : ''
  }${queryString ? `?${queryString}` : ''}`;
}

function buildQortalStatusPath(request: QdnAppRequest) {
  const resource = getQortalResourceRequest(request);
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  if (typeof getBoolean(getRequestValue(request, 'build')) === 'boolean') {
    queryParams.set('build', String(getBoolean(getRequestValue(request, 'build'))));
  }

  const queryString = queryParams.toString();

  return `/arbitrary/resource/status/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}${
    queryString ? `?${queryString}` : ''
  }`;
}

function buildQortalMetadataPath(request: QdnAppRequest) {
  const resource = getQortalResourceRequest(request);

  return `/arbitrary/metadata/${resource.service}/${encodeURIComponent(resource.name)}/${encodeURIComponent(
    resource.identifier ?? 'default',
  )}`;
}

function getQortalResourceMaxBytes(value: unknown) {
  const maxBytes = Math.floor(getNumber(value) ?? QDN_APP_QORTAL_DEFAULT_MAX_BYTES);

  return Math.max(0, Math.min(maxBytes, QDN_APP_QORTAL_MAX_BYTES_LIMIT));
}

// Fetches a Qortal QDN resource as binary, returned base64-encoded so the app can build a blob URL
// (e.g. for an emulator ROM). Returns { body: base64, encoding, contentType, contentLength }.
async function fetchQortalResourceBinary(request: QdnAppRequest) {
  const resource = getQortalResourceRequest(request);
  const maxBytes = getQortalResourceMaxBytes(getRequestValue(request, 'maxBytes'));
  const apiPath = buildQortalResourcePath(resource);

  const response = await fetchQortalNodeWithRetry(apiPath, () => ({ method: 'GET' }));

  if (!response.ok) {
    throw new Error(`Qortal resource request failed with HTTP ${response.status}.`);
  }

  const contentLength = getContentLength(response);
  if (maxBytes > 0 && typeof contentLength === 'number' && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Qortal resource exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (maxBytes > 0 && arrayBuffer.byteLength > maxBytes) {
    throw new Error(`Qortal resource exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  return {
    body: Buffer.from(arrayBuffer).toString('base64'),
    encoding: 'base64' as const,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    contentLength: contentLength ?? arrayBuffer.byteLength,
  };
}

// Returns the direct URL of a Qortal resource on the selected node. The Qortal node serves these with
// CORS and ranged GET, so an in-app player (e.g. EmulatorJS) can stream the file straight from it.
async function getQortalResourceUrl(request: QdnAppRequest) {
  const resource = getQortalResourceRequest(request);
  const nodeApiUrl = await resolveQortalNodeApiUrl(cachedQortalNodeApiUrl?.source === 'local');

  return { url: `${nodeApiUrl.replace(/\/+$/, '')}${buildQortalResourcePath(resource)}` };
}

async function readSuccessfulNodeText(response: Response, fallbackMessage: string) {
  const body = await response.text();

  if (!response.ok) {
    throw new Error(readableNodeErrorMessage(body, fallbackMessage));
  }

  return {
    body: body.trim(),
    contentType: response.headers.get('content-type') ?? '',
  };
}

class QdnUploadPostError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'QdnUploadPostError';
  }
}

function isQdnUploadEndpointUnsupported(error: unknown) {
  return error instanceof QdnUploadPostError && (error.status === 404 || error.status === 405);
}

async function postLocalNodeText(
  connection: NodeConnection,
  pathname: string,
  body: string,
  apiKey: string,
  fallbackMessage: string,
  contentType = 'text/plain',
) {
  const response = await fetchNode(
    pathname,
    {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'X-API-KEY': apiKey,
      },
      body,
    },
    connection.nodeApiUrl,
  );

  return readSuccessfulNodeText(response, fallbackMessage);
}

async function postLocalNodeUpload(
  connection: NodeConnection,
  pathname: string,
  body: Buffer | ReturnType<typeof createReadStream>,
  apiKey: string,
  fallbackMessage: string,
) {
  const options: RequestInit & { duplex?: 'half' } = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-API-KEY': apiKey,
    },
    body: body as unknown as BodyInit,
  };

  if (!Buffer.isBuffer(body)) {
    options.duplex = 'half';
  }

  const response = await fetchNode(pathname, options, connection.nodeApiUrl);
  const responseBody = await response.text();

  if (!response.ok) {
    throw new QdnUploadPostError(response.status, readableNodeErrorMessage(responseBody, fallbackMessage));
  }

  return {
    body: responseBody.trim(),
    contentType: response.headers.get('content-type') ?? '',
  };
}

async function deleteLocalNodeText(
  connection: NodeConnection,
  pathname: string,
  body: string,
  apiKey: string,
  fallbackMessage: string,
  contentType = 'text/plain',
) {
  const response = await fetchNode(
    pathname,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': contentType,
        'X-API-KEY': apiKey,
      },
      body,
    },
    connection.nodeApiUrl,
  );

  return readSuccessfulNodeText(response, fallbackMessage);
}

async function signAndProcessTransaction(
  connection: NodeConnection,
  apiKey: string,
  privateKey58: string,
  rawUnsignedBytes58: string,
  computePath: string | null = '/arbitrary/compute',
) {
  // A null computePath skips nonce computation for transaction types without a MemoryPoW fee alternative.
  const rawUnsignedWithNonce = computePath
    ? await postLocalNodeText(
        connection,
        computePath,
        rawUnsignedBytes58,
        apiKey,
        'QDN transaction nonce computation failed.',
      )
    : { body: rawUnsignedBytes58 };
  const signedTransaction = await postLocalNodeText(
    connection,
    '/transactions/sign',
    JSON.stringify({
      privateKey: privateKey58,
      transactionBytes: rawUnsignedWithNonce.body,
    }),
    apiKey,
    'QDN transaction signing failed.',
    'application/json',
  );
  const processedTransaction = await postLocalNodeText(
    connection,
    '/transactions/process',
    signedTransaction.body,
    apiKey,
    'QDN transaction processing failed.',
  );

  return {
    body: processedTransaction.body,
    data: parseResponseData(processedTransaction.body, processedTransaction.contentType),
    signature: getSignedTransactionSignature(signedTransaction.body),
    signedTransactionBytes: signedTransaction.body,
  };
}

function clearTransactionNonce(unsignedBytes: Uint8Array) {
  if (unsignedBytes.length < TRANSACTION_NONCE_OFFSET + 4) {
    throw new Error('Unsigned transaction bytes are too short to contain a nonce field.');
  }

  const bytesForPow = unsignedBytes.slice();
  bytesForPow[TRANSACTION_NONCE_OFFSET] = 0;
  bytesForPow[TRANSACTION_NONCE_OFFSET + 1] = 0;
  bytesForPow[TRANSACTION_NONCE_OFFSET + 2] = 0;
  bytesForPow[TRANSACTION_NONCE_OFFSET + 3] = 0;

  return bytesForPow;
}

async function signAndProcessKeylessQdnTransaction(
  keylessContext: QdnKeylessWriteContext,
  rawUnsignedBytes58: string,
  expected: Parameters<typeof assertPublicArbitraryTransaction>[1],
  isStillValid?: () => boolean | Promise<boolean>,
  attest?: (details: ReturnType<typeof assertPublicArbitraryTransaction>) => Promise<void>,
) {
  const rawUnsignedBytes = base58Decode(rawUnsignedBytes58);
  const details = assertPublicArbitraryTransaction(rawUnsignedBytes, expected);
  if (attest) await attest(details);
  const signingBytes = arbitraryRawToSigningBytes(rawUnsignedBytes);
  const nonce = await computeChatNonce(clearTransactionNonce(signingBytes), ARBITRARY_POW_DIFFICULTY, isStillValid);
  const rawBytesWithNonce = stampTransactionNonce(rawUnsignedBytes, nonce);
  const signingBytesWithNonce = stampTransactionNonce(signingBytes, nonce);
  if (keylessContext.secretKey.length !== 64) {
    throw new Error('ed25519 secret key must be 64 bytes.');
  }

  const signature = nacl.sign.detached(signingBytesWithNonce, keylessContext.secretKey);
  const signedBytes = appendSignatureToTransactionBytes(rawBytesWithNonce, signature);
  const signedTransactionBytes = base58Encode(signedBytes);
  if (isStillValid && !(await isStillValid())) {
    throw qdnCodedError('QDN_POW_CANCELLED', 'The signing context changed before the transaction could be submitted.');
  }
  const processedTransaction = await postLocalNodeText(
    keylessContext.connection,
    '/transactions/process?apiVersion=2',
    signedTransactionBytes,
    keylessContext.apiKey,
    'QDN transaction processing failed.',
  );

  return {
    body: processedTransaction.body,
    data: parseResponseData(processedTransaction.body, processedTransaction.contentType),
    signature: getSignedTransactionSignature(signedTransactionBytes),
    signedTransactionBytes,
  };
}

async function fetchPublicQdnAttestationArtifact(connection: NodeConnection, hash: Uint8Array, maxBytes: number) {
  if (hash.length !== 32) throw new Error('Public QDN builder returned an invalid attestation hash.');
  const { bytes, response } = await fetchBoundedBytes(
    (signal) => fetchNode(
      `/arbitrary/public/data/${encodeURIComponent(base58Encode(hash))}`,
      { signal },
      connection.nodeApiUrl,
    ),
    maxBytes,
  );
  if (!response.ok) {
    const message = new TextDecoder().decode(bytes).trim();
    throw new Error(readableNodeErrorMessage(message, `Public QDN content attestation failed with HTTP ${response.status}.`));
  }
  if (bytes.byteLength === 0) throw new Error('Public QDN content attestation returned an empty artifact.');
  return bytes;
}

function qdnPublishAttestationMetadata(resource: QdnWriteResourceRequest) {
  return {
    category: resource.category,
    description: resource.description,
    tags: resource.tags,
    title: resource.title,
  };
}

function createPublicQdnPublishAttestation(
  connection: NodeConnection,
  resource: QdnWriteResourceRequest,
  source: QdnPublishAttestationSource,
) {
  return (details: ReturnType<typeof assertPublicArbitraryTransaction>) => attestPublicQdnPublish({
    details,
    expectedMetadata: qdnPublishAttestationMetadata(resource),
    fetchArtifact: (hash, maxBytes) => fetchPublicQdnAttestationArtifact(connection, hash, maxBytes),
    source,
    verify: runPublicQdnAttestationWorker,
  });
}

function runPublicQdnAttestationWorker(input: QdnPublishVerificationInput) {
  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'qdn-attestation.worker.js'));
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new Error('QDN content attestation worker timed out.'));
    }, MEMORY_POW_TIMEOUT_MS);
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      void worker.terminate();
      error ? reject(error) : resolve();
    };
    worker.once('error', (error) => finish(error));
    worker.once('message', (message: { error?: string; ok?: boolean }) => {
      message?.ok ? finish() : finish(new Error(message?.error || 'QDN content attestation worker failed.'));
    });
    worker.postMessage(input);
  });
}

async function signAndProcessKeylessStandardTransaction(
  keylessContext: QdnKeylessWriteContext,
  rawUnsignedBytes58: string,
  difficulty: number,
  validate: (bytes: Uint8Array) => void,
  isStillValid?: () => boolean | Promise<boolean>,
  apiKey = keylessContext.apiKey,
  // Optional second check, run on the NONCE-STAMPED bytes immediately before
  // they are signed. `validate` above sees the unstamped form only, so without
  // this the bytes that actually get signed are never read back.
  validateStamped?: (bytes: Uint8Array, nonce: number) => void,
) {
  const unsignedBytes = base58Decode(rawUnsignedBytes58);
  validate(unsignedBytes);
  const nonce = await computeChatNonce(clearTransactionNonce(unsignedBytes), difficulty, isStillValid);
  const bytesWithNonce = stampTransactionNonce(unsignedBytes, nonce);
  validateStamped?.(bytesWithNonce, nonce);
  if (keylessContext.secretKey.length !== 64) throw new Error('ed25519 secret key must be 64 bytes.');
  const signature = nacl.sign.detached(bytesWithNonce, keylessContext.secretKey);
  const signedTransactionBytes = base58Encode(appendSignatureToTransactionBytes(bytesWithNonce, signature));
  if (isStillValid && !(await isStillValid())) {
    throw qdnCodedError('QDN_POW_CANCELLED', 'The signing context changed before the transaction could be submitted.');
  }
  const processedTransaction = await postLocalNodeText(
    keylessContext.connection,
    '/transactions/process?apiVersion=2',
    signedTransactionBytes,
    apiKey,
    'Transaction processing failed.',
  );
  return {
    body: processedTransaction.body,
    data: parseResponseData(processedTransaction.body, processedTransaction.contentType),
    signature: getSignedTransactionSignature(signedTransactionBytes),
    signedTransactionBytes,
  };
}

function appendQdnWriteQuery(queryParams: URLSearchParams, resource: QdnWriteResourceRequest) {
  appendQueryValue(queryParams, 'title', resource.title);
  appendQueryValue(queryParams, 'description', resource.description);
  appendQueryValue(queryParams, 'category', resource.category);
  appendQueryValue(queryParams, 'fee', resource.fee);

  for (const tag of resource.tags) {
    appendQueryValue(queryParams, 'tags', tag);
  }
}

// There is deliberately no builder for POST /arbitrary/{service}/{name}: that
// endpoint takes a filesystem path in the request body, which only a node
// sharing this machine's disk could open.

function buildQdnPublishBase64Path(resource: QdnWriteResourceRequest, source: QdnWriteSourceSelection) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQdnWriteQuery(queryParams, resource);
  appendQueryValue(queryParams, 'filename', source.filename);

  const queryString = queryParams.toString();

  return `/arbitrary/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}/base64${
    queryString ? `?${queryString}` : ''
  }`;
}

function buildQdnPublishZipPath(resource: QdnWriteResourceRequest) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQdnWriteQuery(queryParams, resource);

  const queryString = queryParams.toString();

  return `/arbitrary/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}/zip${
    queryString ? `?${queryString}` : ''
  }`;
}

function buildQdnPublishUploadPath(resource: QdnWriteResourceRequest, source: QdnWriteSourceSelection) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQdnWriteQuery(queryParams, resource);
  appendQueryValue(queryParams, 'filename', source.filename);
  appendQueryValue(queryParams, 'isZip', source.isZip === true ? true : undefined);

  const queryString = queryParams.toString();

  return `/arbitrary/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}/upload${
    queryString ? `?${queryString}` : ''
  }`;
}

function buildQdnPublicPublishBase64Path(resource: QdnWriteResourceRequest, source: QdnWriteSourceSelection) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQdnWriteQuery(queryParams, resource);
  appendQueryValue(queryParams, 'filename', source.filename);

  const queryString = queryParams.toString();

  return `/arbitrary/public/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}/base64${
    queryString ? `?${queryString}` : ''
  }`;
}

function buildQdnPublicPublishZipPath(resource: QdnWriteResourceRequest) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQdnWriteQuery(queryParams, resource);

  const queryString = queryParams.toString();

  return `/arbitrary/public/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}/zip${
    queryString ? `?${queryString}` : ''
  }`;
}

function buildQdnPublicPublishUploadPath(resource: QdnWriteResourceRequest, source: QdnWriteSourceSelection) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQdnWriteQuery(queryParams, resource);
  appendQueryValue(queryParams, 'filename', source.filename);
  appendQueryValue(queryParams, 'isZip', source.isZip === true ? true : undefined);

  const queryString = queryParams.toString();

  return `/arbitrary/public/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}/upload${
    queryString ? `?${queryString}` : ''
  }`;
}

function buildQdnDeletePath(resource: QdnWriteResourceRequest) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQueryValue(queryParams, 'fee', resource.fee);

  const queryString = queryParams.toString();

  return `/arbitrary/resource/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}/delete${
    queryString ? `?${queryString}` : ''
  }`;
}

function buildQdnPublicDeletePath(resource: QdnWriteResourceRequest) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQueryValue(queryParams, 'fee', resource.fee);

  const queryString = queryParams.toString();

  return `/arbitrary/public/resource/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}/delete${
    queryString ? `?${queryString}` : ''
  }`;
}

function getQdnWriteAccountId(context: QdnViewContext | null) {
  if (!context) {
    throw new Error('QDN app requests are only available to isolated QDN app views.');
  }

  if (!context.accountId) {
    throw new Error('No account is selected for this tab.');
  }

  return context.accountId;
}

function getQdnWriteSourceKind(filePath: string): QdnWriteSourceSelection['kind'] {
  try {
    return statSync(filePath).isDirectory() ? 'directory' : 'file';
  } catch {
    return 'file';
  }
}

function getQdnPreviewContentRequest(value: QdnPreviewContentRequest) {
  const kind = getString(value.kind);
  const sourcePath = getString(value.path);

  if (kind && kind !== 'directory' && kind !== 'file') {
    throw new Error('QDN preview source kind must be "directory" or "file".');
  }

  return {
    kind: kind === 'directory' ? ('directory' as const) : ('file' as const),
    sourcePath: sourcePath || undefined,
  };
}

const QDN_PREVIEW_STAGING_PREFIX = 'qortium-home-preview-';

async function createQdnPreviewStagingDir(sourcePath: string) {
  const previousDir = qdnPreviewStagingDirs.get(sourcePath);

  if (previousDir) {
    await rm(previousDir, { force: true, recursive: true });
  }

  const stagingDir = await mkdtemp(path.join(os.tmpdir(), QDN_PREVIEW_STAGING_PREFIX));

  qdnPreviewStagingDirs.set(sourcePath, stagingDir);

  return stagingDir;
}

// Preview staging dirs are otherwise only replaced when the same source path is
// previewed again, so distinct previews accumulate for the process lifetime.
// Called from the app quit path; sync so the quit cannot outrun the cleanup.
export function cleanupQdnPreviewStagingDirs() {
  for (const stagingDir of qdnPreviewStagingDirs.values()) {
    try {
      rmSync(stagingDir, { force: true, recursive: true });
    } catch {
      // Best effort on quit; the startup sweep collects anything left behind.
    }
  }

  qdnPreviewStagingDirs.clear();
}

// Collect staging dirs orphaned by crashed/killed sessions. Only called after
// the single-instance lock is held, so no other Home instance can be using them.
export async function sweepOrphanedQdnPreviewStagingDirs() {
  let entries: string[];

  try {
    entries = await readdir(os.tmpdir());
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(QDN_PREVIEW_STAGING_PREFIX))
      .map((entry) =>
        rm(path.join(os.tmpdir(), entry), { force: true, recursive: true }).catch(() => undefined),
      ),
  );
}

// Match the Core publish flow, which descends into a single extracted folder
// while ignoring "_"-prefixed system entries such as __MACOSX.
async function resolveExtractedQdnPreviewRoot(stagingDir: string) {
  const entries = (await readdir(stagingDir)).filter((entry) => !entry.startsWith('_'));

  if (entries.length === 1) {
    const candidate = path.join(stagingDir, entries[0]);

    if ((await stat(candidate)).isDirectory()) {
      return candidate;
    }
  }

  return stagingDir;
}

async function assertQdnPreviewIndexFile(directoryPath: string) {
  const entries = await readdir(directoryPath);

  if (!entries.some((entry) => QDN_PREVIEW_INDEX_FILES.has(entry))) {
    throw new Error('Website previews need an index file (for example index.html) in the top level of the folder or zip.');
  }
}

/**
 * Stage a local file or folder so a node can render it as a QDN resource.
 *
 * Exported for the Home 2 app bridge, which has its own node access and cannot
 * use this module's legacy connection layer. Pure filesystem work: it does not
 * touch a node, an account, or a connection, so sharing it couples nothing.
 */
export async function stageQdnPreviewSource(sourcePath: string) {
  let sourceStats;

  try {
    sourceStats = await stat(sourcePath);
  } catch {
    throw new Error(`Preview source does not exist: ${sourcePath}`);
  }

  if (sourceStats.isDirectory()) {
    await assertQdnPreviewIndexFile(sourcePath);

    return {
      previewPath: sourcePath,
      service: 'WEBSITE',
      sourceKind: 'directory' as const,
    };
  }

  const extension = path.extname(sourcePath).slice(1).toLowerCase();

  if (extension === 'zip') {
    const stagingDir = await createQdnPreviewStagingDir(sourcePath);

    await extractZipSafely(sourcePath, { dir: stagingDir });
    const previewPath = await resolveExtractedQdnPreviewRoot(stagingDir);

    await assertQdnPreviewIndexFile(previewPath);

    return {
      previewPath,
      service: 'WEBSITE',
      sourceKind: 'file' as const,
    };
  }

  if (extension === 'html' || extension === 'htm') {
    // Stage the file as index.html so the Core accepts it as a standalone website.
    const stagingDir = await createQdnPreviewStagingDir(sourcePath);

    await copyFile(sourcePath, path.join(stagingDir, 'index.html'));

    return {
      previewPath: stagingDir,
      service: 'WEBSITE',
      sourceKind: 'file' as const,
    };
  }

  const service = QDN_PREVIEW_EXTENSION_SERVICES.get(extension);

  if (!service) {
    throw new Error(
      'Unsupported preview content. Choose a folder or zip containing an index.html file, an HTML file, or an image, video, or audio file.',
    );
  }

  return {
    previewPath: sourcePath,
    service,
    sourceKind: 'file' as const,
  };
}

function getQdnPreviewErrorMessage(body: string, status: number) {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };

    if (parsed && typeof parsed.message === 'string' && parsed.message) {
      return parsed.message;
    }
  } catch {
    // Fall through to the generic messages below.
  }

  // Nodes without the preview endpoint route the request elsewhere and answer
  // with a generic 404 or an HTML 500 page instead of a JSON API error.
  if (status === 404 || status === 500) {
    return 'The connected Qortium Core node does not support QDN previews yet. Update Qortium Core and try again.';
  }

  return `Qortium node preview request failed with HTTP ${status}.`;
}

async function renderQdnPreviewSource(sourcePath: string) {
  const connection = await getNodeConnection();

  assertLocalWriteConnection(connection);
  const apiKey = getNodeApiKey(connection);
  const { previewPath, service, sourceKind } = await stageQdnPreviewSource(sourcePath);
  const response = await fetchNode(
    `/arbitrary/preview/${service}`,
    {
      body: previewPath,
      headers: {
        'Content-Type': 'text/plain',
        'X-API-KEY': apiKey,
      },
      method: 'POST',
    },
    connection.nodeApiUrl,
  );
  const text = await response.text();

  if (!response.ok) {
    throw new Error(getQdnPreviewErrorMessage(text, response.status));
  }

  if (!text.startsWith('/render/')) {
    throw new Error('Qortium node returned an unexpected preview URL.');
  }

  return {
    renderUrl: `${connection.nodeApiUrl.replace(/\/+$/, '')}${text}`,
    service,
    sourceKind,
  };
}

function isSameQdnWriteContext(
  currentContext: QdnViewContext | null,
  originalContext: QdnViewContext,
) {
  return (
    !!currentContext &&
    currentContext.accountId === originalContext.accountId &&
    currentContext.currentUrl === originalContext.currentUrl &&
    currentContext.nodeOrigin === originalContext.nodeOrigin &&
    currentContext.resourceUrl === originalContext.resourceUrl &&
    currentContext.tabId === originalContext.tabId &&
    currentContext.windowId === originalContext.windowId
  );
}

function assertFreshQdnWriteContext(sender: WebContents, originalContext: QdnViewContext) {
  const currentContext = getQdnViewContextForWebContents(sender);

  if (!isSameQdnWriteContext(currentContext, originalContext)) {
    throw new Error('QDN write request is stale because the app view changed before approval.');
  }
}

async function selectQdnPublishSource(
  context: QdnViewContext,
  kind: QdnPublishSourcePickKind = 'any',
): Promise<QdnWriteSourceSelection | null> {
  const smokeSource = getQdnWriteSmokeSourceSelection();

  if (smokeSource) {
    return smokeSource;
  }

  const hostWindow = getQdnViewHostWindow(context);

  if (!hostWindow) {
    throw new Error('QDN publish request does not belong to an active window.');
  }

  const result = await dialog.showOpenDialog(hostWindow, {
    buttonLabel: 'Select',
    properties: kind === 'file' ? ['openFile'] : kind === 'directory' ? ['openDirectory'] : ['openFile', 'openDirectory'],
    title: 'Select QDN Publish Source',
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const selectedPath = result.filePaths[0];
  const sourceStats = statSync(selectedPath);
  const sourceKind = sourceStats.isDirectory() ? 'directory' : 'file';

  return {
    displayName: path.basename(selectedPath) || 'Selected item',
    filename: sourceKind === 'file' ? path.basename(selectedPath) : undefined,
    kind: sourceKind,
    path: selectedPath,
    // Directories get a stat-walk total so the pre-approval public-node size
    // gate applies to them too; without it a folder publish only trips the
    // limit after its files have already been read into memory for zipping.
    size: sourceStats.isFile() ? sourceStats.size : await getDirectoryTotalBytes(selectedPath),
  } satisfies QdnWriteSourceSelection;
}

// Total on-disk bytes of a directory via stat only — never reads file contents.
// Unreadable entries are skipped: the zip builder enforces the byte cap again
// while actually reading, so a best-effort total here cannot under-enforce.
async function getDirectoryTotalBytes(directoryPath: string): Promise<number> {
  let total = 0;
  let entries;

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return total;
  }

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    try {
      if (entry.isDirectory()) {
        total += await getDirectoryTotalBytes(entryPath);
      } else if (entry.isFile()) {
        total += (await stat(entryPath)).size;
      }
    } catch {
      // Skip unreadable entries.
    }
  }

  return total;
}

async function selectQdnPublishSourceForApp(request: QdnAppRequest, context: QdnViewContext) {
  const source = await selectQdnPublishSource(context, getRequestedQdnPublishSourceKind(request, 'file'));

  if (!source) {
    return {
      canceled: true,
    };
  }

  return {
    canceled: false,
    fileName: source.filename ?? source.displayName,
    kind: source.kind,
    size: source.size,
    sourceToken: cacheQdnPublishSourceToken(context, source),
  };
}

async function previewQdnPublishSourceForApp(request: QdnAppRequest, context: QdnViewContext) {
  const source = getQdnPublishSourceFromToken(request, context);

  if (!source?.path) {
    throw new Error('Select a QDN publish source before previewing it.');
  }

  const hostWindow = getQdnViewHostWindow(context);

  if (!hostWindow) {
    throw new Error('QDN preview request does not belong to an active window.');
  }

  const preview = await renderQdnPreviewSource(source.path);

  // Do not return the render URL to the app: a local Core render endpoint can
  // expose the selected bytes before the user chooses to publish. Home opens
  // the display-only preview itself instead.
  hostWindow.webContents.send('qdn-app:open-publish-source-preview', {
    ...preview,
    sourceName: source.filename ?? source.displayName,
    sourceTabId: context.tabId,
  });

  return true;
}

function assertPublicQdnPublishSize(size: number, label: string) {
  if (size > QDN_WRITE_SOURCE_MAX_BYTES) {
    throw new Error(`${label} exceeds the ${QDN_WRITE_SOURCE_MAX_BYTES.toLocaleString()} byte public-node publish limit.`);
  }
}

function assertPublicQdnStreamedPublishSize(size: number, label: string) {
  if (size > QDN_PUBLIC_STREAMED_PUBLISH_MAX_BYTES) {
    throw new Error(`${label} exceeds the ${QDN_PUBLIC_STREAMED_PUBLISH_MAX_BYTES.toLocaleString()} byte public-node publish limit.`);
  }
}

type QdnPublishLimits = {
  publishMaxSize?: number;
  serviceMaxSizes: Map<string, number>;
};

const qdnPublishLimitsCache = new Map<string, { fetchedAt: number; limits: QdnPublishLimits | null }>();
const QDN_PUBLISH_LIMITS_CACHE_MS = 5 * 60_000;

// Effective publish limits from the node's GET /arbitrary/limits (Core >= 1.3.2).
// Returns null (cached) when the node is unreachable or predates the endpoint —
// the node still enforces its own limits during the publish build, so the
// pre-flight is a fail-fast nicety, never the enforcement point.
async function fetchQdnPublishLimits(connection: NodeConnection): Promise<QdnPublishLimits | null> {
  const cached = qdnPublishLimitsCache.get(connection.nodeApiUrl);

  if (cached && Date.now() - cached.fetchedAt < QDN_PUBLISH_LIMITS_CACHE_MS) {
    return cached.limits;
  }

  let limits: QdnPublishLimits | null = null;

  try {
    const response = await fetchNode('/arbitrary/limits', {}, connection.nodeApiUrl);

    if (response.ok) {
      const parsed = (await response.json()) as {
        publishMaxSize?: unknown;
        serviceLimits?: Array<{ maxSize?: unknown; service?: unknown }>;
      };
      const serviceMaxSizes = new Map<string, number>();

      if (Array.isArray(parsed.serviceLimits)) {
        for (const entry of parsed.serviceLimits) {
          if (typeof entry?.service === 'string' && typeof entry?.maxSize === 'number') {
            serviceMaxSizes.set(entry.service, entry.maxSize);
          }
        }
      }

      limits = {
        publishMaxSize: typeof parsed.publishMaxSize === 'number' ? parsed.publishMaxSize : undefined,
        serviceMaxSizes,
      };
    }
  } catch {
    limits = null;
  }

  qdnPublishLimitsCache.set(connection.nodeApiUrl, { fetchedAt: Date.now(), limits });

  return limits;
}

// Pre-flight a local-node publish against the node's own limits so an oversized
// file/folder is rejected before approval, instead of only after the node has
// staged and processed it. Sizes are raw (pre-compression), matching how the
// node itself measures its service limits.
async function assertLocalQdnPublishSize(connection: NodeConnection, service: string, size: number, label: string) {
  const limits = await fetchQdnPublishLimits(connection);

  if (!limits) {
    return;
  }

  const candidates = [limits.serviceMaxSizes.get(service), limits.publishMaxSize]
    .filter((value): value is number => typeof value === 'number');

  if (candidates.length === 0) {
    return;
  }

  const maxSize = Math.min(...candidates);

  if (size > maxSize) {
    throw new Error(`${label} exceeds the node's ${maxSize.toLocaleString()} byte publish limit for the ${service} service.`);
  }
}

async function buildDirectoryZipEntries(
  rootPath: string,
  currentPath: string,
  entries: Record<string, Uint8Array>,
  total: { bytes: number },
  assertSize: (size: number, label: string) => void = assertPublicQdnPublishSize,
) {
  const directoryEntries = await readdir(currentPath, { withFileTypes: true });

  for (const entry of directoryEntries) {
    const entryPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      await buildDirectoryZipEntries(rootPath, entryPath, entries, total, assertSize);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const bytes = new Uint8Array(await readFile(entryPath));
    total.bytes += bytes.byteLength;
    assertSize(total.bytes, 'Selected QDN publish folder');

    const relativePath = path.relative(rootPath, entryPath).split(path.sep).join('/');
    entries[relativePath] = bytes;
  }
}

async function readDirectoryAsZipBase64(sourcePath: string) {
  const entries: Record<string, Uint8Array> = {};
  const total = { bytes: 0 };

  await buildDirectoryZipEntries(sourcePath, sourcePath, entries, total);

  if (Object.keys(entries).length === 0) {
    throw new Error('Selected QDN publish folder is empty.');
  }

  const zipBytes = Buffer.from(zipSync(entries));
  assertPublicQdnPublishSize(zipBytes.byteLength, 'Selected QDN publish folder archive');

  return {
    dataBase64: zipBytes.toString('base64'),
    size: zipBytes.byteLength,
  };
}

async function buildDirectoryZipBuffer(
  sourcePath: string,
  assertSize: (size: number, label: string) => void = assertPublicQdnStreamedPublishSize,
) {
  const entries: Record<string, Uint8Array> = {};
  const total = { bytes: 0 };

  await buildDirectoryZipEntries(sourcePath, sourcePath, entries, total, assertSize);

  if (Object.keys(entries).length === 0) {
    throw new Error('Selected QDN publish folder is empty.');
  }

  const zipBytes = Buffer.from(zipSync(entries));
  assertSize(zipBytes.byteLength, 'Selected QDN publish folder archive');

  return zipBytes;
}

async function normalizePublicQdnPublishSource(source: QdnWriteSourceSelection) {
  if (source.dataBase64) {
    const size = Buffer.from(source.dataBase64, 'base64').byteLength;
    assertPublicQdnPublishSize(size, 'QDN publish data');

    return {
      ...source,
      dataBase64: source.dataBase64,
      filename: source.filename,
      isZip: isQdnPublishZip(source.filename, source.dataBase64),
      kind: 'data' as const,
      size,
    };
  }

  if (!source.path) {
    throw new Error('QDN publish source did not include data or a local path.');
  }

  const sourceStats = await stat(source.path);

  if (sourceStats.isDirectory()) {
    const { dataBase64, size } = await readDirectoryAsZipBase64(source.path);

    return {
      ...source,
      dataBase64,
      filename: `${path.basename(source.path) || 'qdn-resource'}.zip`,
      isZip: true,
      kind: 'directory' as const,
      size,
    };
  }

  if (!sourceStats.isFile()) {
    throw new Error('QDN publish source must be a file or folder.');
  }

  assertPublicQdnPublishSize(sourceStats.size, 'Selected QDN publish file');
  const fileBytes = await readFile(source.path);
  const isZip = path.extname(source.path).toLowerCase() === '.zip';

  return {
    ...source,
    dataBase64: Buffer.from(fileBytes).toString('base64'),
    filename: source.filename ?? path.basename(source.path) ?? 'qdn-resource',
    isZip,
    kind: 'file' as const,
    size: fileBytes.byteLength,
  };
}

/**
 * Turns a path-backed source into bytes Core can be handed directly: a folder
 * is zipped in memory, a file is streamed straight off disk. Core is never told
 * where the source lives, so the same publish works against a node on this
 * machine, behind an SSH tunnel, or on a remote host.
 *
 * assertSize is the caller's ceiling: the keyless public route passes Core's
 * public cap, while authenticated routes pass nothing because Core enforces its
 * own (much larger) publish limit, which Home already pre-flights.
 */
async function prepareQdnPublishUploadSource(
  resource: QdnWriteResourceRequest,
  source: QdnWriteSourceSelection,
  assertSize: (size: number, label: string) => void = () => undefined,
) {
  if (!source.path) {
    return null;
  }

  const sourceStats = await stat(source.path);

  if (sourceStats.isDirectory()) {
    const zipBytes = await buildDirectoryZipBuffer(source.path, assertSize);
    const directorySource = {
      ...source,
      filename: `${path.basename(source.path) || 'qdn-resource'}.zip`,
      isZip: true,
      kind: 'directory' as const,
      size: zipBytes.byteLength,
    };

    return {
      body: zipBytes as Buffer | ReturnType<typeof createReadStream>,
      sourcePath: source.path,
      source: {
        ...directorySource,
        isZip: shouldUnpackQdnPublishArchive(resource, directorySource) ? true : undefined,
      },
    };
  }

  if (!sourceStats.isFile()) {
    throw new Error('QDN publish source must be a file or folder.');
  }

  assertSize(sourceStats.size, 'Selected QDN publish file');
  const fileSource = {
    ...source,
    filename: source.filename ?? path.basename(source.path) ?? 'qdn-resource',
    isZip: path.extname(source.path).toLowerCase() === '.zip',
    kind: 'file' as const,
    size: sourceStats.size,
  };

  return {
    body: createReadStream(source.path) as Buffer | ReturnType<typeof createReadStream>,
    sourcePath: source.path,
    source: {
      ...fileSource,
      isZip: shouldUnpackQdnPublishArchive(resource, fileSource) ? true : undefined,
    },
  };
}

function assertLegacyQdnPublishFallbackSize(size: number) {
  if (size > QDN_WRITE_SOURCE_MAX_BYTES) {
    throw new Error(
      `The connected Qortium Core node does not support large streamed QDN publishes yet. Update Qortium Core or use a source no larger than ${QDN_WRITE_SOURCE_MAX_BYTES.toLocaleString()} bytes.`,
    );
  }
}

type QdnPublishTransactionBuild = {
  attestationSource: QdnPublishAttestationSource | null;
  unsignedTransaction: Awaited<ReturnType<typeof postLocalNodeText>>;
};

/**
 * Asks the connected node to build the unsigned publish transaction, and is the
 * single place that decides how the resource bytes get there. Shared by the
 * single and multi-resource publishes so the two can never drift apart on it.
 *
 * A path-backed source is always uploaded as bytes, never named to Core: only a
 * node sharing this filesystem could have opened the path, which is why remote
 * nodes used to fail with NoSuchFileException. The inline build below is for
 * sources that already carry their bytes, and for nodes too old to expose the
 * upload endpoint.
 *
 * publicRoute picks the keyless /arbitrary/public builders, which stage the
 * exact bytes for the caller to verify before signing; it is the only route
 * that can produce an attestation source.
 */
async function buildQdnPublishTransaction(options: {
  apiKey: string;
  connection: NodeConnection;
  publicRoute: boolean;
  resource: QdnWriteResourceRequest;
  source: QdnWriteSourceSelection;
}): Promise<QdnPublishTransactionBuild> {
  const { apiKey, connection, publicRoute, resource, source } = options;

  const uploadSource = shouldStreamQdnPublishSource(source)
    ? await prepareQdnPublishUploadSource(
        resource,
        source,
        publicRoute ? assertPublicQdnStreamedPublishSize : undefined,
      )
    : null;

  if (uploadSource) {
    let unsignedTransaction: Awaited<ReturnType<typeof postLocalNodeText>> | null = null;

    try {
      unsignedTransaction = await postLocalNodeUpload(
        connection,
        publicRoute
          ? buildQdnPublicPublishUploadPath(resource, uploadSource.source)
          : buildQdnPublishUploadPath(resource, uploadSource.source),
        uploadSource.body,
        apiKey,
        'QDN publish transaction build failed.',
      );
    } catch (error) {
      if (!isQdnUploadEndpointUnsupported(error)) {
        throw error;
      }

      // Older Core: fall through to the inline build, which reads the same
      // source back into memory and posts it in the request body.
      assertLegacyQdnPublishFallbackSize(uploadSource.source.size ?? 0);
    } finally {
      // A failed/aborted upload can leave the file read stream (and its fd)
      // open — fetch teardown is not guaranteed to consume it. Destroy is a
      // no-op for Buffers and for streams fetch fully consumed.
      if (!Buffer.isBuffer(uploadSource.body) && !uploadSource.body.destroyed) {
        uploadSource.body.destroy();
      }
    }

    if (unsignedTransaction) {
      return {
        attestationSource: publicRoute
          ? {
              bytes: Buffer.isBuffer(uploadSource.body)
                ? new Uint8Array(uploadSource.body)
                : new Uint8Array(await readFile(uploadSource.sourcePath)),
              filename: uploadSource.source.filename ?? path.basename(uploadSource.sourcePath),
              unpackZip: uploadSource.source.isZip === true,
            }
          : null,
        unsignedTransaction,
      };
    }
  }

  const inlineSource = isInlineQdnWriteSource(source)
    ? source
    : await normalizePublicQdnPublishSource(source);
  const unpackZip = shouldUnpackQdnPublishArchive(resource, inlineSource);
  const unsignedTransaction = await postLocalNodeText(
    connection,
    publicRoute
      ? unpackZip
        ? buildQdnPublicPublishZipPath(resource)
        : buildQdnPublicPublishBase64Path(resource, inlineSource)
      : unpackZip
        ? buildQdnPublishZipPath(resource)
        : buildQdnPublishBase64Path(resource, inlineSource),
    inlineSource.dataBase64 ?? '',
    apiKey,
    'QDN publish transaction build failed.',
  );

  return {
    attestationSource: publicRoute
      ? {
          bytes: new Uint8Array(Buffer.from(inlineSource.dataBase64 ?? '', 'base64')),
          filename: inlineSource.filename ?? 'qdn-resource',
          unpackZip,
        }
      : null,
    unsignedTransaction,
  };
}

async function getQdnWriteContext(
  context: QdnViewContext | null,
  resource: QdnWriteResourceRequest,
): Promise<QdnWriteContext> {
  const connection = await getNodeConnection();

  assertLocalWriteConnection(connection);
  const apiKey = getNodeApiKey(connection);

  if (isQdnWriteSmokeMode()) {
    const smokeProfile = getQdnWriteSmokeProfile(resource);

    return {
      apiKey,
      connection,
      profile: smokeProfile,
      signer: {
        kind: 'smoke',
        resource,
      },
    };
  }

  const accountId = getQdnWriteAccountId(context);
  const profile = await getAccountProfile(accountId);

  assertAccountUnlocked(accountId);

  return {
    apiKey,
    connection,
    profile,
    signer: {
      accountId,
      kind: 'account',
    },
  };
}

function getQdnWritePrivateKey(writeContext: QdnWriteContext) {
  if (writeContext.signer.kind === 'smoke') {
    return getQdnWriteSmokePrivateKey(writeContext.signer.resource);
  }

  return getAccountSigningKey(writeContext.signer.accountId).privateKey58;
}

async function getQdnChatContext(context: QdnViewContext | null): Promise<QdnChatContext> {
  const accountId = getQdnWriteAccountId(context);
  const connection = await getNodeConnection();

  assertLocalWriteConnection(connection);
  assertAccountUnlocked(accountId);

  const apiKey = getNodeApiKey(connection);
  const profile = await getAccountProfile(accountId);
  const signingKey = getAccountSigningKey(accountId);

  return {
    accountId,
    apiKey,
    connection,
    privateKey58: signingKey.privateKey58,
    profile,
    publicKey58: signingKey.publicKey58,
  };
}

// Like getQdnChatContext but for the keyless open-group chat path: it allows a
// public/network node because the private key is NEVER sent to it (the message is
// signed locally). It still requires a selected, unlocked account; the caller
// still runs the SEND_CHAT_MESSAGE approval prompt. Mirrors src/platform.ts
// getKeylessChatContext.
async function getKeylessChatContext(
  context: QdnViewContext | null,
): Promise<QdnKeylessChatContext> {
  const accountId = getQdnWriteAccountId(context);
  const connection = await getNodeConnection();

  // Intentionally NO assertLocalWriteConnection here: the keyless path never
  // sends the private key to the node, so a public/network node is permitted.
  assertAccountUnlocked(accountId);

  // The keyless build/process endpoints are allowlisted and need no API key on a
  // public node; pass through any configured key (custom/local) but do not throw
  // when network mode has none.
  const apiKey = connection.apiKey?.trim() ?? '';
  const profile = await getAccountProfile(accountId);
  const signingKey = getAccountSecretKey(accountId);

  return {
    accountId,
    apiKey,
    connection,
    profile,
    publicKey58: signingKey.publicKey58,
    secretKey: signingKey.secretKey,
  };
}

async function getKeylessQdnWriteContext(context: QdnViewContext | null): Promise<QdnKeylessWriteContext> {
  const accountId = getQdnWriteAccountId(context);
  const connection = await getNodeConnection();

  assertAccountUnlocked(accountId);

  const apiKey = connection.apiKey?.trim() ?? '';
  const profile = await getAccountProfile(accountId);
  const signingKey = getAccountSecretKey(accountId);

  return {
    accountId,
    apiKey,
    connection,
    profile,
    publicKey58: signingKey.publicKey58,
    secretKey: signingKey.secretKey,
  };
}

async function isKeylessWriteContextFresh(
  sender: WebContents,
  context: QdnViewContext,
  keylessContext: QdnKeylessWriteContext,
) {
  if (!isSameQdnWriteContext(getQdnViewContextForWebContents(sender), context)) return false;
  if (!isAccountUnlocked(keylessContext.accountId)) return false;
  if (getActiveAccountAddress() !== keylessContext.profile.address) return false;
  const connection = await getNodeConnection();
  return isSameQdnWriteRoute(connection, keylessContext.connection);
}

async function fetchLocalNodeApiPayload(
  connection: NodeConnection,
  apiPath: string,
  fallbackMessage: string,
) {
  const response = await fetchNode(apiPath, {}, connection.nodeApiUrl);
  const result = await readNodeApiResponse(response, connection, QDN_APP_DEFAULT_MAX_BYTES);

  if (!result.ok) {
    throw getNodeApiResponseError(result, fallbackMessage);
  }

  return result.data;
}

async function getGroupDataForChat(connection: NodeConnection, groupId: number) {
  if (groupId === 0) {
    return null;
  }

  return fetchLocalNodeApiPayload(
    connection,
    `/groups/${encodeURIComponent(String(groupId))}`,
    'Group lookup failed.',
  );
}

async function getNameDataForApp(connection: NodeConnection, name: string) {
  return fetchLocalNodeApiPayload(
    connection,
    `/names/${encodeURIComponent(name)}`,
    'Name lookup failed.',
  );
}

function getGroupName(groupData: unknown) {
  if (!isRecord(groupData)) {
    return null;
  }

  return getString(groupData.groupName) || getString(groupData.name) || null;
}

function getGroupDescription(groupData: unknown) {
  if (!isRecord(groupData)) {
    return '';
  }

  return getString(groupData.description);
}

function getGroupApprovalThreshold(groupData: unknown) {
  if (!isRecord(groupData)) {
    return 'NONE';
  }

  return getString(groupData.approvalThreshold) || 'NONE';
}

function getGroupCreationGroupId(groupData: unknown) {
  if (!isRecord(groupData)) {
    return 0;
  }

  return getInteger(groupData.creationGroupId) ?? 0;
}

function getGroupDelay(groupData: unknown, key: 'maximumBlockDelay' | 'minimumBlockDelay', fallback: number) {
  if (!isRecord(groupData)) {
    return fallback;
  }

  return getInteger(groupData[key]) ?? fallback;
}

function getNameCreationGroupId(nameData: unknown) {
  if (!isRecord(nameData)) {
    return 0;
  }

  return getInteger(nameData.creationGroupId) ?? 0;
}

function getNameSaleAmount(nameData: unknown) {
  if (!isRecord(nameData) || typeof nameData.salePrice === 'undefined' || nameData.salePrice === null) {
    return undefined;
  }

  return typeof nameData.salePrice === 'number' || typeof nameData.salePrice === 'string'
    ? nameData.salePrice
    : undefined;
}

function getNameOwnerAddress(nameData: unknown) {
  if (!isRecord(nameData)) {
    return '';
  }

  return getString(nameData.owner);
}

function isOpenGroupData(groupData: unknown) {
  return !isRecord(groupData) || groupData.isOpen !== false;
}

function parseLocalPostData(result: Awaited<ReturnType<typeof postLocalNodeText>>) {
  return parseResponseData(result.body, result.contentType);
}

async function publishQdnResourceForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const resource = getQdnWriteResourceRequest(request);
  const connection = await getNodeConnection();
  const writeRoute = resolveQdnWriteRoute(connection);
  const useLocalWrite = writeRoute === 'local';
  const usePublicRoute = writeRoute === 'public';
  const writeContext = useLocalWrite
    ? await getQdnWriteContext(context, resource)
    : await getKeylessQdnWriteContext(context);
  const publishSourceKind = isQdnBrowserArchiveService(resource.service) ? 'any' : 'file';
  const source =
    getInlinePublishSource(request) ??
    getQdnPublishSourceFromToken(request, context as QdnViewContext) ??
    (await selectQdnPublishSource(context as QdnViewContext, publishSourceKind));

  if (!source) {
    throw new Error('QDN publish was canceled.');
  }

  if (usePublicRoute && typeof source.size === 'number') {
    if (source.path) {
      assertPublicQdnStreamedPublishSize(source.size, 'Selected QDN publish source');
    } else {
      assertPublicQdnPublishSize(source.size, 'Selected QDN publish source');
    }
  }

  // An authenticated node applies its own publish limit whether it is on this
  // machine or not, so both authenticated routes pre-flight against that.
  if (!usePublicRoute && typeof source.size === 'number') {
    await assertLocalQdnPublishSize(connection, resource.service, source.size, 'Selected QDN publish source');
  }

  await requestQdnWriteApproval(
    context as QdnViewContext,
    writeContext.profile,
    {
      action: 'PUBLISH_QDN_RESOURCE',
      resource,
      source,
    },
  );

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  if (!useLocalWrite) {
    const keylessWriteContext = writeContext as QdnKeylessWriteContext;
    // Both remote routes sign here rather than on the node, and the local
    // signer only builds the fee-less proof-of-work form of the transaction.
    if ((resource.fee ?? 0) !== 0) throw new Error('QDN writes signed on this machine require a zero fee.');
    const serviceValue = getStaticQdnServiceId(resource.service);
    const isStillValid = () => isKeylessWriteContextFresh(sender, context as QdnViewContext, keylessWriteContext);
    const { attestationSource, unsignedTransaction } = await buildQdnPublishTransaction({
      apiKey: keylessWriteContext.apiKey,
      connection: keylessWriteContext.connection,
      publicRoute: usePublicRoute,
      resource,
      source,
    });

    if (usePublicRoute && !attestationSource) {
      throw new Error('QDN publish source could not be prepared for content attestation.');
    }

    const processedTransaction = await signAndProcessKeylessQdnTransaction(
      keylessWriteContext,
      unsignedTransaction.body,
      {
        identifier: resource.identifier && resource.identifier !== 'default' ? resource.identifier : undefined,
        method: 0,
        name: resource.name,
        publicKey: base58Decode(keylessWriteContext.publicKey58),
        service: serviceValue,
        txGroupId: 0,
      },
      isStillValid,
      attestationSource
        ? createPublicQdnPublishAttestation(keylessWriteContext.connection, resource, attestationSource)
        : undefined,
    );
    releaseQdnPublishSourceToken(request);

    return {
      accepted: true,
      action: 'PUBLISH_QDN_RESOURCE',
      result: processedTransaction.data,
      resource: {
        identifier: resource.identifier ?? null,
        name: resource.name,
        service: resource.service,
      },
      transactionSignature: processedTransaction.signature,
    };
  }

  const localWriteContext = writeContext as QdnWriteContext;
  const apiKey = localWriteContext.apiKey;
  const privateKey58 = getQdnWritePrivateKey(localWriteContext);
  const { unsignedTransaction } = await buildQdnPublishTransaction({
    apiKey,
    connection: localWriteContext.connection,
    publicRoute: false,
    resource,
    source,
  });
  const processedTransaction = await signAndProcessTransaction(
    localWriteContext.connection,
    apiKey,
    privateKey58,
    unsignedTransaction.body,
  );
  releaseQdnPublishSourceToken(request);

  return {
    accepted: true,
    action: 'PUBLISH_QDN_RESOURCE',
    result: processedTransaction.data,
    resource: {
      identifier: resource.identifier ?? null,
      name: resource.name,
      service: resource.service,
    },
    transactionSignature: processedTransaction.signature,
  };
}

async function publishMultipleQdnResourcesForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const resources = getQdnWriteResourceRequests(request);

  if (resources.some((entry) => !entry.source && !entry.sourceToken)) {
    throw new Error('PUBLISH_MULTIPLE_QDN_RESOURCES requires base64 data for each resource.');
  }

  const approvalResource = resources.length === 1 ? resources[0].resource : undefined;
  const connection = await getNodeConnection();
  const writeRoute = resolveQdnWriteRoute(connection);
  const useLocalWrite = writeRoute === 'local';
  const usePublicRoute = writeRoute === 'public';
  const writeContext = useLocalWrite
    ? await getQdnWriteContext(context, approvalResource ?? resources[0].resource)
    : await getKeylessQdnWriteContext(context);

  await requestQdnWriteApproval(
    context as QdnViewContext,
    writeContext.profile,
    {
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      resource: approvalResource,
      resourceCount: resources.length,
      source: {
        displayName: `${resources.length} resources`,
        kind: 'data',
      },
    },
  );

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const apiKey = writeContext.apiKey;
  const privateKey58 = useLocalWrite ? getQdnWritePrivateKey(writeContext as QdnWriteContext) : '';
  const published: Array<{
    result: unknown;
    resource: {
      identifier: string | null;
      name: string;
      service: string;
    };
    transactionSignature: string;
  }> = [];
  const failures: Array<{
    error: string;
    resource: {
      identifier: string | null;
      name: string;
      service: string;
    };
  }> = [];
  const releaseTokens = new Set<string>();

  for (const entry of resources) {
    const sourceToken = entry.sourceToken;
    try {
      const source =
        entry.source ??
        (sourceToken
          ? getQdnPublishSourceFromTokenString(sourceToken, context as QdnViewContext)
          : null);

      if (!source) {
        throw new Error('PUBLISH_MULTIPLE_QDN_RESOURCES requires base64 data for each resource.');
      }

      if (usePublicRoute && typeof source.size === 'number') {
        if (source.path) {
          assertPublicQdnStreamedPublishSize(source.size, 'Selected QDN publish source');
        } else {
          assertPublicQdnPublishSize(source.size, 'Selected QDN publish source');
        }
      }

      if (!useLocalWrite && (entry.resource.fee ?? 0) !== 0) {
        throw new Error('QDN writes signed on this machine require a zero fee.');
      }

      if (!usePublicRoute && typeof source.size === 'number') {
        await assertLocalQdnPublishSize(connection, entry.resource.service, source.size, 'Selected QDN publish source');
      }

      const { attestationSource, unsignedTransaction } = await buildQdnPublishTransaction({
        apiKey,
        connection: writeContext.connection,
        publicRoute: usePublicRoute,
        resource: entry.resource,
        source,
      });

      if (usePublicRoute && !attestationSource) {
        throw new Error('QDN publish source could not be prepared for content attestation.');
      }

      const processedTransaction = useLocalWrite
        ? await signAndProcessTransaction(
            writeContext.connection,
            apiKey,
            privateKey58,
            unsignedTransaction.body,
          )
        : await signAndProcessKeylessQdnTransaction(
            writeContext as QdnKeylessWriteContext,
            unsignedTransaction.body,
            {
              identifier: entry.resource.identifier && entry.resource.identifier !== 'default' ? entry.resource.identifier : undefined,
              method: 0,
              name: entry.resource.name,
              publicKey: base58Decode((writeContext as QdnKeylessWriteContext).publicKey58),
              service: getStaticQdnServiceId(entry.resource.service),
              txGroupId: 0,
            },
            () => isKeylessWriteContextFresh(sender, context as QdnViewContext, writeContext as QdnKeylessWriteContext),
            attestationSource
              ? createPublicQdnPublishAttestation(
                  (writeContext as QdnKeylessWriteContext).connection,
                  entry.resource,
                  attestationSource,
                )
              : undefined,
          );

      published.push({
        result: processedTransaction.data,
        resource: {
          identifier: entry.resource.identifier ?? null,
          name: entry.resource.name,
          service: entry.resource.service,
        },
        transactionSignature: processedTransaction.signature,
      });

      if (sourceToken) {
        releaseTokens.add(sourceToken);
      }
    } catch (error) {
      failures.push({
        error: error instanceof Error ? error.message : 'QDN publish failed.',
        resource: {
          identifier: entry.resource.identifier ?? null,
          name: entry.resource.name,
          service: entry.resource.service,
        },
      });
    }
  }

  for (const token of releaseTokens) {
    releaseQdnPublishSourceTokenFromString(token);
  }

  return {
    accepted: true,
    action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
    failures,
    published,
  };
}

async function deleteQdnResourceForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const resource = getQdnWriteResourceRequest(request);
  const connection = await getNodeConnection();
  const useLocalWrite = isLocalWriteConnection(connection);
  const writeContext = useLocalWrite
    ? await getQdnWriteContext(context, resource)
    : await getKeylessQdnWriteContext(context);

  await requestQdnWriteApproval(
    context as QdnViewContext,
    writeContext.profile,
    {
      action: 'DELETE_QDN_RESOURCE',
      resource,
    },
  );

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const apiKey = writeContext.apiKey;
  const privateKey58 = useLocalWrite ? getQdnWritePrivateKey(writeContext as QdnWriteContext) : '';
  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    useLocalWrite ? buildQdnDeletePath(resource) : buildQdnPublicDeletePath(resource),
    '',
    apiKey,
    'QDN delete transaction build failed.',
  );
  const processedTransaction = useLocalWrite
    ? await signAndProcessTransaction(
        writeContext.connection,
        apiKey,
        privateKey58,
        unsignedTransaction.body,
      )
    : await signAndProcessKeylessQdnTransaction(
        writeContext as QdnKeylessWriteContext,
        unsignedTransaction.body,
        {
          identifier: resource.identifier && resource.identifier !== 'default' ? resource.identifier : undefined,
          method: 2,
          name: resource.name,
          publicKey: base58Decode((writeContext as QdnKeylessWriteContext).publicKey58),
          service: getStaticQdnServiceId(resource.service),
          txGroupId: 0,
        },
        () => isKeylessWriteContextFresh(sender, context as QdnViewContext, writeContext as QdnKeylessWriteContext),
      );

  return {
    accepted: true,
    action: 'DELETE_QDN_RESOURCE',
    result: processedTransaction.data,
    resource: {
      identifier: resource.identifier ?? null,
      name: resource.name,
      service: resource.service,
    },
  };
}

async function joinGroupForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const chatContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(chatContext.connection, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, chatContext.profile, {
    action: 'JOIN_GROUP',
    groupId,
    groupName,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  // Joining a minting group authorizes a minting key on chain, so include the
  // self-share public key derived from the joiner's own keypair.
  const mintingPublicKey58 =
    isRecord(groupData) && groupData.isMintingGroup === true
      ? (await deriveMintingKeyPair(chatContext)).publicKey58
      : null;

  const unsignedTransaction = await postLocalNodeText(
    chatContext.connection,
    '/groups/join',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: 0,
      fee: 0,
      joinerPublicKey: chatContext.publicKey58,
      groupId,
      ...(mintingPublicKey58 ? { mintingPublicKey: mintingPublicKey58 } : {}),
    }),
    chatContext.apiKey,
    'Join group transaction build failed.',
    'application/json',
  );
  const processedTransaction = await signAndProcessTransaction(
    chatContext.connection,
    chatContext.apiKey,
    chatContext.privateKey58,
    unsignedTransaction.body,
    '/transactions/mempow/compute',
  );

  return {
    accepted: true,
    action: 'JOIN_GROUP',
    groupId,
    groupName,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

function isSelfShareRewardShare(value: unknown, address: string) {
  return (
    isRecord(value) &&
    getString(value.mintingAccount) === address &&
    getString(value.recipient) === address
  );
}

async function getSelfShareRewardShares(connection: NodeConnection, address: string) {
  const encodedAddress = encodeURIComponent(address);
  const rewardShares = await fetchLocalNodeApiPayload(
    connection,
    `/addresses/rewardshares?minters=${encodedAddress}&recipients=${encodedAddress}`,
    'Reward share lookup failed.',
  );

  if (!Array.isArray(rewardShares)) {
    return [];
  }

  return rewardShares.filter((rewardShare) => isSelfShareRewardShare(rewardShare, address));
}

async function deriveMintingKeyPair(chatContext: QdnChatContext) {
  const mintingPrivateKey = await postLocalNodeText(
    chatContext.connection,
    '/addresses/rewardsharekey',
    JSON.stringify({
      mintingAccountPrivateKey: chatContext.privateKey58,
      recipientAccountPublicKey: chatContext.publicKey58,
    }),
    chatContext.apiKey,
    'Minting key derivation failed.',
    'application/json',
  );
  const mintingPublicKey = await postLocalNodeText(
    chatContext.connection,
    '/utils/publickey',
    mintingPrivateKey.body,
    chatContext.apiKey,
    'Minting public key derivation failed.',
  );

  return {
    privateKey58: mintingPrivateKey.body,
    publicKey58: mintingPublicKey.body,
  };
}

async function getMintingStatusForApp(request: QdnAppRequest, context: QdnViewContext | null) {
  const address = await getAddressForQdnRequest(request, context, 'Address');
  const connection = await getNodeConnection();
  const selfShares = await getSelfShareRewardShares(connection, address);
  const hasRewardShare = selfShares.length > 0;

  if (connection.mode === 'network') {
    // A public read-only node cannot report the user's own node-side minting state.
    return {
      address,
      hasRewardShare,
      isMinting: null,
      keyOnNode: null,
      nodeMintingPossible: null,
    };
  }

  const mintingAccounts = await fetchLocalNodeApiPayload(
    connection,
    '/admin/mintingaccounts',
    'Minting account lookup failed.',
  );
  const keyOnNode =
    Array.isArray(mintingAccounts) &&
    mintingAccounts.some(
      (mintingAccount) =>
        isRecord(mintingAccount) &&
        getString(mintingAccount.mintingAccount) === address &&
        getString(mintingAccount.recipientAccount) === address,
    );

  const nodeStatus = await fetchLocalNodeApiPayload(
    connection,
    '/admin/status',
    'Node status lookup failed.',
  );
  const nodeMintingPossible = isRecord(nodeStatus) && nodeStatus.isMintingPossible === true;

  return {
    address,
    hasRewardShare,
    isMinting: hasRewardShare && keyOnNode,
    keyOnNode,
    nodeMintingPossible,
  };
}

async function startMintingForApp(context: QdnViewContext | null, sender: WebContents) {
  const chatContext = await getQdnChatContext(context);
  const address = chatContext.profile.address;

  await requestQdnWriteApproval(context as QdnViewContext, chatContext.profile, {
    action: 'START_MINTING',
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const selfShares = await getSelfShareRewardShares(chatContext.connection, address);
  const mintingKeyPair = await deriveMintingKeyPair(chatContext);

  if (selfShares.length === 0) {
    // No on-chain authorization yet (the account joined its minting group before joins
    // carried minting keys) — submit a zero-fee self-share REWARD_SHARE transaction.
    // The minting key can be added to the node once this confirms.
    const unsignedTransaction = await postLocalNodeText(
      chatContext.connection,
      '/addresses/rewardshare',
      JSON.stringify({
        timestamp: Date.now(),
        txGroupId: 0,
        fee: 0,
        minterPublicKey: chatContext.publicKey58,
        recipient: address,
        rewardSharePublicKey: mintingKeyPair.publicKey58,
        sharePercent: 0,
      }),
      chatContext.apiKey,
      'Minting authorization transaction build failed.',
      'application/json',
    );
    const processedTransaction = await signAndProcessTransaction(
      chatContext.connection,
      chatContext.apiKey,
      chatContext.privateKey58,
      unsignedTransaction.body,
      null,
    );

    return {
      accepted: true,
      action: 'START_MINTING',
      address,
      keyAdded: false,
      rewardSharePending: true,
      transactionSignature: processedTransaction.signature,
    };
  }

  if (
    !selfShares.some(
      (selfShare) =>
        isRecord(selfShare) && getString(selfShare.rewardSharePublicKey) === mintingKeyPair.publicKey58,
    )
  ) {
    throw new Error(
      'The minting key authorization on chain does not match the key derived from the selected account.',
    );
  }

  // The derived minting private key goes only to the local node; it is never returned to the app.
  await postLocalNodeText(
    chatContext.connection,
    '/admin/mintingaccounts',
    mintingKeyPair.privateKey58,
    chatContext.apiKey,
    'Adding the minting key to the node failed.',
  );

  return {
    accepted: true,
    action: 'START_MINTING',
    address,
    keyAdded: true,
  };
}

async function removeMintingAccountForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const publicKey = getRequiredRequestString(request, 'publicKey', 'Public key');

  // Basic shape check; the node fully validates the key and returns "false" if not present.
  if (!new RegExp(`^[${BASE58_ALPHABET}]{32,64}$`).test(publicKey)) {
    throw new Error('Public key must be a base58-encoded key.');
  }

  const chatContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, chatContext.profile, {
    action: 'REMOVE_MINTING_ACCOUNT',
    mintingKey: publicKey,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  // DELETE /admin/mintingaccounts takes the public (or private) key as the plain-text body.
  const result = await deleteLocalNodeText(
    chatContext.connection,
    '/admin/mintingaccounts',
    publicKey,
    chatContext.apiKey,
    'Removing the minting key from the node failed.',
  );

  // Core returns "true" on removal, "false" when no matching key was on the node.
  if (result.body.trim() !== 'true') {
    throw new Error('The node did not have a matching minting key to remove.');
  }

  return {
    accepted: true,
    action: 'REMOVE_MINTING_ACCOUNT',
    publicKey,
    removed: true,
  };
}

async function approveGroupJoinRequestForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const invitee = getRequiredAddressRequestString(request, 'joiner', 'Joiner address');
  const chatContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(chatContext.connection, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, chatContext.profile, {
    action: 'APPROVE_GROUP_JOIN_REQUEST',
    groupId,
    groupName,
    recipientAddress: invitee,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    chatContext.connection,
    '/groups/invite',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: 0,
      fee: 0,
      adminPublicKey: chatContext.publicKey58,
      groupId,
      invitee,
      timeToLive: 0,
    }),
    chatContext.apiKey,
    'Group invite transaction build failed.',
    'application/json',
  );
  const processedTransaction = await signAndProcessTransaction(
    chatContext.connection,
    chatContext.apiKey,
    chatContext.privateKey58,
    unsignedTransaction.body,
    '/transactions/mempow/compute',
  );

  return {
    accepted: true,
    action: 'APPROVE_GROUP_JOIN_REQUEST',
    groupId,
    groupName,
    invitee,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function requestGroupApprovalForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const pendingSignature = getOptionalBase58RequestString(request, 'pendingSignature');

  if (!pendingSignature) {
    throw new Error('pendingSignature (base58) is required.');
  }

  // Required boolean: false is an explicit "oppose" vote, so never default it.
  const approval = getBoolean(getRequestValue(request, 'approval'));

  if (typeof approval !== 'boolean') {
    throw new Error('approval boolean is required.');
  }

  // groupId is display-only context for the consent dialog; the GROUP_APPROVAL vote
  // itself always rides in the root group (txGroupId 0).
  const displayGroupId = getInteger(getRequestValue(request, 'groupId'));

  const chatContext = await getQdnChatContext(context);

  let groupName: string | null = null;
  if (typeof displayGroupId === 'number' && displayGroupId >= 0) {
    const groupData = await getGroupDataForChat(chatContext.connection, displayGroupId);
    groupName = getGroupName(groupData);
  }

  await requestQdnWriteApproval(context as QdnViewContext, chatContext.profile, {
    action: 'GROUP_APPROVAL',
    approval,
    groupId: typeof displayGroupId === 'number' ? displayGroupId : undefined,
    groupName,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    chatContext.connection,
    '/groups/approval',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: 0,
      fee: 0,
      adminPublicKey: chatContext.publicKey58,
      pendingSignature,
      approval,
    }),
    chatContext.apiKey,
    'Group approval transaction build failed.',
    'application/json',
  );
  const processedTransaction = await signAndProcessTransaction(
    chatContext.connection,
    chatContext.apiKey,
    chatContext.privateKey58,
    unsignedTransaction.body,
    '/transactions/mempow/compute',
  );

  return {
    accepted: true,
    action: 'GROUP_APPROVAL',
    approval,
    groupId: typeof displayGroupId === 'number' ? displayGroupId : undefined,
    pendingSignature,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function processQdnAccountTransaction(
  writeContext: QdnChatContext,
  unsignedTransaction: Awaited<ReturnType<typeof postLocalNodeText>>,
) {
  return signAndProcessTransaction(
    writeContext.connection,
    writeContext.apiKey,
    writeContext.privateKey58,
    unsignedTransaction.body,
    '/transactions/mempow/compute',
  );
}

async function inviteToGroupForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const invitee = getOptionalAddressRequestString(
    request,
    'Invitee address',
    'invitee',
    'recipientAddress',
    'recipient',
  );
  const timeToLive = getOptionalIntegerRequestValue(request, 0, 'timeToLive', 'ttl') ?? 0;
  const writeContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(writeContext.connection, groupId);
  const groupName = getGroupName(groupData);

  if (!invitee) {
    throw new Error('Invitee address is required.');
  }

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'INVITE_TO_GROUP',
    groupId,
    groupName,
    recipientAddress: invitee,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/invite',
    JSON.stringify({
      timestamp: Date.now(),
      fee: getTransactionFee(request),
      adminPublicKey: writeContext.publicKey58,
      groupId,
      invitee,
      timeToLive,
    }),
    writeContext.apiKey,
    'Group invite transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'INVITE_TO_GROUP',
    groupId,
    groupName,
    invitee,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function leaveGroupForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const writeContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(writeContext.connection, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'LEAVE_GROUP',
    groupId,
    groupName,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/leave',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      leaverPublicKey: writeContext.publicKey58,
      groupId,
    }),
    writeContext.apiKey,
    'Leave group transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'LEAVE_GROUP',
    groupId,
    groupName,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function updateGroupForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const writeContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(writeContext.connection, groupId);
  const groupName = getGroupName(groupData);
  const newName = getOptionalStringRequestValue(request, 'newName', 'groupName');
  const newDescription =
    getOptionalStringRequestValue(request, 'newDescription', 'description') || getGroupDescription(groupData);
  const newIsOpen =
    getOptionalBooleanRequestValue(request, 'newIsOpen', 'isOpen') ??
    (isRecord(groupData) && typeof groupData.isOpen === 'boolean' ? groupData.isOpen : true);
  const newApprovalThreshold =
    getOptionalStringRequestValue(request, 'newApprovalThreshold', 'approvalThreshold') ||
    getGroupApprovalThreshold(groupData);
  const newMinimumBlockDelay =
    getOptionalIntegerRequestValue(request, 0, 'newMinimumBlockDelay', 'minimumBlockDelay') ??
    getGroupDelay(groupData, 'minimumBlockDelay', 0);
  const newMaximumBlockDelay =
    getOptionalIntegerRequestValue(request, 1, 'newMaximumBlockDelay', 'maximumBlockDelay') ??
    getGroupDelay(groupData, 'maximumBlockDelay', Math.max(1, newMinimumBlockDelay));

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'UPDATE_GROUP',
    groupId,
    groupName,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/update',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request, getGroupCreationGroupId(groupData)),
      fee: getTransactionFee(request),
      ownerPublicKey: writeContext.publicKey58,
      groupId,
      newName,
      newDescription,
      newIsOpen,
      newApprovalThreshold,
      newMinimumBlockDelay,
      newMaximumBlockDelay,
    }),
    writeContext.apiKey,
    'Update group transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'UPDATE_GROUP',
    groupId,
    groupName,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

// Core resolves the on-chain QDN resource pointer to its latest revision before
// serving these bytes. Home intentionally returns bounded base64 instead of a
// node URL so apps cannot bypass the account/group avatar state.
async function fetchGroupAvatarForApp(request: QdnAppRequest): Promise<GroupAvatarFetchResult> {
  const groupId = getGroupAvatarGroupId(getRequestValue(request, 'groupId') ?? getRequestValue(request, 'txGroupId'));
  const maxBytes = getGroupAvatarMaxBytes(getRequestValue(request, 'maxBytes'));
  const { connection, response: infoResponse } = await fetchConfiguredNode(buildAvatarInfoPath('group', groupId), { method: 'GET' });
  if (infoResponse.status === 404) {
    const groupData = await getGroupDataForChat(connection, groupId).catch(() => null);
    const ownerPrimaryName = isRecord(groupData) ? getString(groupData.ownerPrimaryName) : '';
    if (ownerPrimaryName) {
      const legacyResponse = await fetchNode(buildAvatarResourcePath(buildLegacyGroupAvatarResource(ownerPrimaryName, groupId)), {}, connection.nodeApiUrl);
      if (legacyResponse.status === 202) {
        await legacyResponse.body?.cancel();
        return buildGroupAvatarPendingResult(groupId, legacyResponse.headers.get('retry-after') ?? undefined, 'LEGACY');
      }
      if (legacyResponse.ok) {
        const legacyContentLength = getContentLength(legacyResponse);
        if (typeof legacyContentLength === 'number' && legacyContentLength > maxBytes) {
          await legacyResponse.body?.cancel();
          throw new Error(`Group avatar exceeded the ${maxBytes.toLocaleString()} byte limit.`);
        }
        const legacyBytes = new Uint8Array(await legacyResponse.arrayBuffer());
        if (legacyBytes.byteLength > maxBytes) throw new Error(`Group avatar exceeded the ${maxBytes.toLocaleString()} byte limit.`);
        const contentType = getAvatarImageContentType(legacyResponse.headers.get('content-type') ?? undefined, legacyBytes);
        if (!contentType) throw new Error('Legacy group avatar was not a supported image.');
        return { groupId, body: Buffer.from(legacyBytes).toString('base64'), encoding: 'base64' as const, contentType, contentLength: legacyBytes.byteLength, source: 'LEGACY' as const, descriptor: null };
      }
    }
    throw new Error('Group avatar is not set.');
  }
  if (!infoResponse.ok) throw new Error(`Group avatar pointer lookup failed with HTTP ${infoResponse.status}.`);
  const info = await infoResponse.json() as Record<string, unknown>;
  const pointerDescriptor = getAvatarDescriptor({
    service: getString(info.service), name: getString(info.name), identifier: getString(info.identifier),
  });
  if (!pointerDescriptor) throw new Error('Group avatar pointer metadata was invalid.');
  const response = await fetchNode(buildGroupAvatarPath(groupId), { method: 'GET' }, connection.nodeApiUrl);
  const descriptor = getAvatarDescriptorFromHeaders((name) => response.headers.get(name) ?? undefined) ?? pointerDescriptor;

  if (response.status === 202) {
    await response.body?.cancel();
    return buildGroupAvatarPendingResult(groupId, response.headers.get('retry-after') ?? undefined, 'POINTER', descriptor);
  }
  if (!response.ok) {
    throw new Error(`Group avatar request failed with HTTP ${response.status}.`);
  }

  const contentLength = getContentLength(response);
  if (typeof contentLength === 'number' && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Group avatar exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    throw new Error(`Group avatar exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  return {
    groupId,
    body: Buffer.from(arrayBuffer).toString('base64'),
    encoding: 'base64' as const,
    contentType: getAvatarImageContentType(response.headers.get('content-type') ?? undefined, new Uint8Array(arrayBuffer)) ?? (() => { throw new Error('Group avatar was not a supported image.'); })(),
    // Always report measured bytes: the Content-Length header is only an
    // oversize preflight and can go stale when a transport decompresses.
    contentLength: arrayBuffer.byteLength,
    source: 'POINTER' as const,
    descriptor,
  };
}

async function fetchAccountAvatarForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
): Promise<AccountAvatarFetchResult> {
  const address = await getAddressForQdnRequest(request, context, 'Address');
  const maxBytes = getGroupAvatarMaxBytes(getRequestValue(request, 'maxBytes'));
  const { connection, response: infoResponse } = await fetchConfiguredNode(buildAvatarInfoPath('account', address), { method: 'GET' });
  if (infoResponse.status === 404) {
    const primaryName = await getPrimaryName(address, connection.nodeApiUrl);
    if (primaryName) {
      for (const kind of ['qortium', 'qortal-hub'] as const) {
        const legacyResponse = await fetchNode(buildAvatarResourcePath(buildLegacyAccountAvatarResource(primaryName, kind)), {}, connection.nodeApiUrl);
        if (legacyResponse.status === 202) {
          await legacyResponse.body?.cancel();
          return buildAccountAvatarPendingResult(address, legacyResponse.headers.get('retry-after') ?? undefined, 'LEGACY');
        }
        if (!legacyResponse.ok) continue;
        const legacyContentLength = getContentLength(legacyResponse);
        if (typeof legacyContentLength === 'number' && legacyContentLength > maxBytes) {
          await legacyResponse.body?.cancel();
          continue;
        }
        const legacyBytes = new Uint8Array(await legacyResponse.arrayBuffer());
        if (legacyBytes.byteLength > maxBytes) throw new Error(`Account avatar exceeded the ${maxBytes.toLocaleString()} byte limit.`);
        const contentType = getAvatarImageContentType(legacyResponse.headers.get('content-type') ?? undefined, legacyBytes);
        if (!contentType) continue;
        return { address, body: Buffer.from(legacyBytes).toString('base64'), encoding: 'base64' as const, contentType, contentLength: legacyBytes.byteLength, source: 'LEGACY' as const, descriptor: null };
      }
    }
    throw new Error('Account avatar is not set.');
  }
  if (!infoResponse.ok) throw new Error(`Account avatar pointer lookup failed with HTTP ${infoResponse.status}.`);
  const info = await infoResponse.json() as Record<string, unknown>;
  const pointerDescriptor = getAvatarDescriptor({
    service: getString(info.service), name: getString(info.name), identifier: getString(info.identifier),
  });
  if (!pointerDescriptor) throw new Error('Account avatar pointer metadata was invalid.');
  const response = await fetchNode(buildAccountAvatarPath(address), { method: 'GET' }, connection.nodeApiUrl);
  const descriptor = getAvatarDescriptorFromHeaders((name) => response.headers.get(name) ?? undefined) ?? pointerDescriptor;

  if (response.status === 202) {
    await response.body?.cancel();
    return buildAccountAvatarPendingResult(address, response.headers.get('retry-after') ?? undefined, 'POINTER', descriptor);
  }
  if (!response.ok) {
    throw new Error(`Account avatar request failed with HTTP ${response.status}.`);
  }

  const contentLength = getContentLength(response);
  if (typeof contentLength === 'number' && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Account avatar exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    throw new Error(`Account avatar exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  return {
    address,
    body: Buffer.from(arrayBuffer).toString('base64'),
    encoding: 'base64' as const,
    contentType: getAvatarImageContentType(response.headers.get('content-type') ?? undefined, new Uint8Array(arrayBuffer)) ?? (() => { throw new Error('Account avatar was not a supported image.'); })(),
    // Always report measured bytes: the Content-Length header is only an
    // oversize preflight and can go stale when a transport decompresses.
    contentLength: arrayBuffer.byteLength,
    source: 'POINTER' as const,
    descriptor,
  };
}

async function setAccountAvatarForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const avatar = getOptionalAvatarPointer(getRequestValue(request, 'avatar'));
  const writeContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'SET_ACCOUNT_AVATAR',
    name: writeContext.profile.name ?? undefined,
    permissionScope: 'single-request',
  });
  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/addresses/avatar',
    JSON.stringify(buildSetAccountAvatarTransactionBody({
      timestamp: Date.now(),
      fee: getTransactionFee(request),
      ownerPublicKey: writeContext.publicKey58,
      avatar,
    })),
    writeContext.apiKey,
    'Set account avatar transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'SET_ACCOUNT_AVATAR',
    address: writeContext.profile.address,
    avatar,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function setGroupAvatarForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getGroupAvatarGroupId(getRequestValue(request, 'groupId') ?? getRequestValue(request, 'txGroupId'));
  const avatar = getOptionalAvatarPointer(getRequestValue(request, 'avatar'));
  const writeContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(writeContext.connection, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'SET_GROUP_AVATAR',
    groupId,
    groupName,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/avatar',
    JSON.stringify(
      buildSetGroupAvatarTransactionBody({
        timestamp: Date.now(),
        txGroupId: getTransactionGroupId(request, getGroupCreationGroupId(groupData)),
        fee: getTransactionFee(request),
        ownerPublicKey: writeContext.publicKey58,
        groupId,
        avatar,
      }),
    ),
    writeContext.apiKey,
    'Set group avatar transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'SET_GROUP_AVATAR',
    groupId,
    groupName,
    avatar,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

const QDN_GROUP_APPROVAL_THRESHOLDS = new Set([
  'NONE',
  'ONE',
  'PCT20',
  'PCT40',
  'PCT60',
  'PCT80',
  'PCT100',
]);

function getGroupApprovalThresholdInput(request: QdnAppRequest) {
  const value = getString(getRequestValue(request, 'approvalThreshold')).toUpperCase();

  if (!value) {
    return 'NONE';
  }

  if (!QDN_GROUP_APPROVAL_THRESHOLDS.has(value)) {
    throw new Error('approvalThreshold must be NONE, ONE, PCT20, PCT40, PCT60, PCT80, or PCT100.');
  }

  return value;
}

function getRequiredIntegerRequestValue(
  request: QdnAppRequest,
  minimumValue: number,
  label: string,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = getInteger(getRequestValue(request, key));

    if (typeof value === 'number') {
      if (value < minimumValue) {
        throw new Error(`${label} must be at least ${minimumValue}.`);
      }

      return value;
    }
  }

  throw new Error(`${label} is required.`);
}

function getRequiredMemberAddress(request: QdnAppRequest, label: string, ...keys: string[]) {
  const address = getOptionalAddressRequestString(request, label, ...keys);

  if (!address) {
    throw new Error(`${label} is required.`);
  }

  return address;
}

function getPollOptionsRequestInput(request: QdnAppRequest, ...keys: string[]) {
  let raw: unknown;

  for (const key of keys) {
    const value = getRequestValue(request, key);

    if (typeof value !== 'undefined' && value !== null) {
      raw = value;
      break;
    }
  }

  return getPollOptionsInput(raw);
}

async function createGroupForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupName = getRequiredRequestString(request, 'groupName', 'Group name');
  const description = getString(getRequestValue(request, 'description'));
  const isOpen = getOptionalBooleanRequestValue(request, 'isOpen', 'open') ?? false;
  const approvalThreshold = getGroupApprovalThresholdInput(request);
  const minimumBlockDelay = getOptionalIntegerRequestValue(request, 0, 'minimumBlockDelay', 'minBlockDelay') ?? 5;
  const maximumBlockDelay =
    getOptionalIntegerRequestValue(request, 0, 'maximumBlockDelay', 'maxBlockDelay') ??
    Math.max(10, minimumBlockDelay);
  const writeContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'CREATE_GROUP',
    name: groupName,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/create',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      creatorPublicKey: writeContext.publicKey58,
      groupName,
      description,
      isOpen,
      approvalThreshold,
      minimumBlockDelay,
      maximumBlockDelay,
    }),
    writeContext.apiKey,
    'Create group transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'CREATE_GROUP',
    groupName,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function addGroupAdminForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const member = getRequiredMemberAddress(request, 'Member address', 'member', 'address', 'memberAddress');
  const writeContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(writeContext.connection, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'ADD_GROUP_ADMIN',
    groupId,
    groupName,
    recipientAddress: member,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/addadmin',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      ownerPublicKey: writeContext.publicKey58,
      groupId,
      member,
    }),
    writeContext.apiKey,
    'Add group admin transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'ADD_GROUP_ADMIN',
    groupId,
    groupName,
    member,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function removeGroupAdminForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const admin = getRequiredMemberAddress(request, 'Admin address', 'admin', 'address', 'memberAddress');
  const writeContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(writeContext.connection, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'REMOVE_GROUP_ADMIN',
    groupId,
    groupName,
    recipientAddress: admin,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/removeadmin',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      ownerPublicKey: writeContext.publicKey58,
      groupId,
      admin,
    }),
    writeContext.apiKey,
    'Remove group admin transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'REMOVE_GROUP_ADMIN',
    groupId,
    groupName,
    admin,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function banFromGroupForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const offender = getRequiredMemberAddress(request, 'Offender address', 'offender', 'member', 'address');
  const reason = getString(getRequestValue(request, 'reason'));
  const timeToLive = getOptionalIntegerRequestValue(request, 0, 'timeToLive', 'ttl', 'banTime') ?? 0;
  const writeContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(writeContext.connection, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'GROUP_BAN',
    groupId,
    groupName,
    recipientAddress: offender,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/ban',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      adminPublicKey: writeContext.publicKey58,
      groupId,
      offender,
      reason,
      timeToLive,
    }),
    writeContext.apiKey,
    'Group ban transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'GROUP_BAN',
    groupId,
    groupName,
    offender,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function cancelGroupBanForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const member = getRequiredMemberAddress(request, 'Member address', 'member', 'offender', 'address');
  const writeContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(writeContext.connection, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'CANCEL_GROUP_BAN',
    groupId,
    groupName,
    recipientAddress: member,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/ban/cancel',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      adminPublicKey: writeContext.publicKey58,
      groupId,
      member,
    }),
    writeContext.apiKey,
    'Cancel group ban transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'CANCEL_GROUP_BAN',
    groupId,
    groupName,
    member,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function kickFromGroupForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const member = getRequiredMemberAddress(request, 'Member address', 'member', 'address');
  const reason = getString(getRequestValue(request, 'reason'));
  const writeContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(writeContext.connection, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'GROUP_KICK',
    groupId,
    groupName,
    recipientAddress: member,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/kick',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      adminPublicKey: writeContext.publicKey58,
      groupId,
      member,
      reason,
    }),
    writeContext.apiKey,
    'Group kick transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'GROUP_KICK',
    groupId,
    groupName,
    member,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function cancelGroupInviteForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const invitee = getRequiredMemberAddress(request, 'Invitee address', 'invitee', 'address', 'recipientAddress');
  const writeContext = await getQdnChatContext(context);
  const groupData = await getGroupDataForChat(writeContext.connection, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'CANCEL_GROUP_INVITE',
    groupId,
    groupName,
    recipientAddress: invitee,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/invite/cancel',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      adminPublicKey: writeContext.publicKey58,
      groupId,
      invitee,
    }),
    writeContext.apiKey,
    'Cancel group invite transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'CANCEL_GROUP_INVITE',
    groupId,
    groupName,
    invitee,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function setDefaultGroupForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const defaultGroupId = getRequiredIntegerRequestValue(
    request,
    0,
    'Default group id',
    'defaultGroupId',
    'groupId',
  );
  const writeContext = await getQdnChatContext(context);
  const groupData = defaultGroupId > 0 ? await getGroupDataForChat(writeContext.connection, defaultGroupId) : null;
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'SET_GROUP',
    groupId: defaultGroupId,
    groupName,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/groups/setdefault',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      creatorPublicKey: writeContext.publicKey58,
      defaultGroupId,
    }),
    writeContext.apiKey,
    'Set default group transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'SET_GROUP',
    defaultGroupId,
    groupName,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function sendCoinForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
  action: 'PAYMENT' | 'SEND_COIN',
) {
  const assetId = getRequestAssetId(request);

  if (typeof assetId === 'number' && assetId !== NATIVE_ASSET_ID) {
    throw new Error('Use TRANSFER_ASSET for non-native asset transfers.');
  }

  if (!isNativeAssetRequest(request, true)) {
    if (action !== 'SEND_COIN') {
      throw new Error('Foreign coin sends must use SEND_COIN.');
    }

    return sendForeignCoinForApp(request, context, sender);
  }

  return sendNativeAssetForApp(request, context, sender, action);
}

async function sendNativeAssetForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
  action: 'PAYMENT' | 'SEND_COIN',
) {
  const recipient = getRequiredMemberAddress(
    request,
    'Recipient address',
    'recipient',
    'recipientAddress',
    'address',
    'destinationAddress',
  );
  const amount = getRequiredAmountValue(request, 'amount', 'Amount');
  const writeContext = await getQdnChatContext(context);
  const nativeAsset = await getNativeAssetInfo(writeContext.connection);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'TRANSFER_ASSET',
    amount,
    name: getAssetApprovalName(NATIVE_ASSET_ID),
    recipientAddress: recipient,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/assets/transfer',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      senderPublicKey: writeContext.publicKey58,
      recipient,
      amount,
      assetId: NATIVE_ASSET_ID,
    }),
    writeContext.apiKey,
    'Native asset transfer transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action,
    recipient,
    amount,
    asset: nativeAsset,
    assetId: NATIVE_ASSET_ID,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function sendForeignCoinForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const coin = normalizeForeignWalletCoin(getRequestValue(request, 'coin') ?? getRequestValue(request, 'blockchain'));
  const recipient =
    getString(getRequestValue(request, 'recipient')) ||
    getString(getRequestValue(request, 'recipientAddress')) ||
    getString(getRequestValue(request, 'receivingAddress')) ||
    getString(getRequestValue(request, 'address')) ||
    getString(getRequestValue(request, 'destinationAddress'));
  const sendMax = getOptionalBooleanRequestValue(request, 'sendMax') === true;
  const amountValue = getRequestValue(request, 'amount');
  const hasAmount = !(typeof amountValue === 'undefined' || amountValue === null ||
    (typeof amountValue === 'string' && amountValue.trim() === ''));
  if (sendMax && hasAmount) {
    throw new Error('Amount must be omitted when sendMax is true.');
  }

  const amount = sendMax ? undefined : getForeignWalletAmountString(amountValue, 'Amount');
  const feePerByteValue = getRequestValue(request, 'feePerByte') ?? getRequestValue(request, 'fee');
  const hasFeePerByte = !(typeof feePerByteValue === 'undefined' || feePerByteValue === null ||
    (typeof feePerByteValue === 'string' && feePerByteValue.trim() === ''));
  const feePerByte = !hasFeePerByte
    ? undefined
    : getForeignWalletAmountString(feePerByteValue, 'Fee per byte');
  const writeContext = await getQdnWriteContext(context, {
    name: `${coin} send`,
    service: 'FOREIGN_CHAIN',
    tags: [],
  });

  if (!recipient || recipient.length > 256) {
    throw new Error('Recipient address is required.');
  }

  if (writeContext.signer.kind !== 'account') {
    throw new Error('Foreign coin sends require an unlocked Home account.');
  }

  const seed = getAccountForeignWalletSeed(writeContext.signer.accountId);
  const wallet = deriveForeignWalletRuntime({
    coin,
    crypto: getForeignWalletCrypto(),
    nonce: seed.addressIndex,
    seed: seed.seed,
    walletVersion: seed.walletVersion,
  });
  const preparedResponse = await postLocalNodeText(
    writeContext.connection,
    `/crosschain/${coin.toLowerCase()}/send/prepare`,
    JSON.stringify({
      ...(sendMax ? { sendMax: true } : { amount }),
      ...(feePerByte ? { feePerByte } : {}),
      receivingAddress: recipient,
      xprv58: wallet.xprv58,
    }),
    writeContext.apiKey,
    'Foreign coin send preparation failed.',
    'application/json',
  );
  const preparedSend = sanitizeForeignPreparedSend(
    parseResponseData(preparedResponse.body, preparedResponse.contentType),
    coin,
    recipient,
  );
  const preparedPreview = getForeignPreparedSendPreview(preparedSend);
  const currencyCode = preparedSend.currencyCode || preparedSend.blockchain || coin;
  const displayAmount = sendMax
    ? `${atomicAmountToCoinString(preparedSend.amount)} ${currencyCode}`
    : `${amount} ${currencyCode}`;

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'SEND_COIN',
    amount: sendMax ? `Max ${displayAmount}` : displayAmount,
    details: getForeignPreparedSendApprovalDetails(preparedSend),
    name: preparedSend.blockchain || coin,
    recipientAddress: preparedSend.receivingAddress,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const result = await postLocalNodeText(
    writeContext.connection,
    `/crosschain/${coin.toLowerCase()}/send/broadcast`,
    JSON.stringify({
      rawTransactionHex: preparedSend.rawTransactionHex,
    }),
    writeContext.apiKey,
    'Foreign coin send broadcast failed.',
    'application/json',
  );

  return {
    accepted: true,
    action: 'SEND_COIN',
    amount: sendMax ? atomicAmountToCoinString(preparedSend.amount) : amount,
    coin,
    prepared: preparedPreview,
    recipient: preparedSend.receivingAddress,
    result: parseResponseData(result.body, result.contentType),
    sendMax: preparedSend.sendMax,
    txHash: result.body,
  };
}

async function transferAssetForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const recipient = getRequiredMemberAddress(
    request,
    'Recipient address',
    'recipient',
    'recipientAddress',
    'address',
    'destinationAddress',
  );
  const amount = getRequiredAmountValue(request, 'amount', 'Amount');
  const assetId = getRequiredIntegerRequestValue(request, 0, 'Asset id', 'assetId');

  const assetInfo = (await fetchNodeApiPayload(`/assets/info?assetId=${assetId}`, request)) as { isDivisible?: boolean } | null;

  if (assetInfo && assetInfo.isDivisible === false && !/^\d+$/.test(String(amount))) {
    throw new Error('This asset is not divisible - amount must be a whole number.');
  }

  const writeContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'TRANSFER_ASSET',
    amount,
    name: getAssetApprovalName(assetId),
    recipientAddress: recipient,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/assets/transfer',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      senderPublicKey: writeContext.publicKey58,
      recipient,
      amount,
      assetId,
    }),
    writeContext.apiKey,
    'Transfer asset transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'TRANSFER_ASSET',
    recipient,
    amount,
    assetId,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function createPollForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const pollName = getRequiredRequestString(request, 'pollName', 'Poll name');
  const description = getString(getRequestValue(request, 'description'));
  const pollOptions = getPollOptionsRequestInput(request, 'pollOptions', 'options');
  const ownerInput = getOptionalAddressRequestString(request, 'Owner address', 'owner');
  const startTime = getOptionalIntegerRequestValue(request, 0, 'startTime', 'pollStartTime');
  const endTime = getOptionalIntegerRequestValue(request, 0, 'endTime', 'pollEndTime');
  const connection = await getNodeConnection();
  const useLocalWrite = isLocalWriteConnection(connection);
  const writeContext = useLocalWrite
    ? await getQdnChatContext(context)
    : await getKeylessChatContext(context);
  const capabilities = useLocalWrite ? null : await getPublicPollCapabilities(connection);
  const fee = getTransactionFee(request);
  const txGroupId = getTransactionGroupId(request);
  if (!useLocalWrite && fee !== 0) throw new Error('Public-node poll writes require a zero fee.');
  const resolvedOwner = ownerInput || writeContext.profile.address;

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'CREATE_POLL',
    name: pollName,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const timestamp = Date.now();
  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    useLocalWrite ? '/polls/create' : '/polls/public/create',
    JSON.stringify({
      timestamp,
      txGroupId,
      fee,
      pollCreatorPublicKey: writeContext.publicKey58,
      owner: resolvedOwner,
      pollName,
      description,
      pollOptions,
      ...(typeof startTime === 'number' ? { startTime } : {}),
      ...(typeof endTime === 'number' ? { endTime } : {}),
    }),
    writeContext.apiKey,
    'Create poll transaction build failed.',
    'application/json',
  );
  const processedTransaction = useLocalWrite
    ? await processQdnAccountTransaction(writeContext as QdnChatContext, unsignedTransaction)
    : await signAndProcessKeylessStandardTransaction(
        writeContext as QdnKeylessWriteContext,
        unsignedTransaction.body,
        capabilities!.mempowFeeAlternativeDifficulty,
        (bytes) => assertPublicCreatePollTransaction(bytes, {
          description,
          endTime,
          owner: base58Decode(resolvedOwner),
          pollName,
          pollOptions: pollOptions.map((option) => option.optionName),
          publicKey: base58Decode(writeContext.publicKey58),
          startTime,
          timestamp,
          txGroupId,
        }),
        () => isKeylessWriteContextFresh(sender, context as QdnViewContext, writeContext as QdnKeylessWriteContext),
      );

  return {
    accepted: true,
    action: 'CREATE_POLL',
    pollName,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function voteOnPollForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const pollId = getRequiredIntegerRequestValue(request, 0, 'Poll id', 'pollId', 'poll');
  const optionIndexes = getOptionalPollVoteOptionIndexes(getRequestValue(request, 'optionIndexes'), getInteger);
  const optionIndex = typeof optionIndexes === 'undefined'
    ? getRequiredIntegerRequestValue(request, 0, 'Option index', 'optionIndex', 'option')
    : getOptionalIntegerRequestValue(request, 0, 'optionIndex', 'option');
  const optionInput = resolvePollVoteOptionInput(optionIndex, optionIndexes);
  const connection = await getNodeConnection();
  const useLocalWrite = isLocalWriteConnection(connection);
  const writeContext = useLocalWrite
    ? await getQdnChatContext(context)
    : await getKeylessChatContext(context);
  const capabilities = useLocalWrite ? null : await getPublicPollCapabilities(connection);
  const fee = getTransactionFee(request);
  const txGroupId = getTransactionGroupId(request);
  if (!useLocalWrite && fee !== 0) throw new Error('Public-node poll writes require a zero fee.');

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'VOTE_ON_POLL',
    name: getPollVoteApprovalName(pollId, optionInput),
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const timestamp = Date.now();
  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    useLocalWrite ? '/polls/vote' : '/polls/public/vote',
    JSON.stringify({
      timestamp,
      txGroupId,
      fee,
      voterPublicKey: writeContext.publicKey58,
      pollId,
      ...(typeof optionInput.optionIndexes === 'undefined'
        ? { optionIndex: optionInput.optionIndex }
        : { optionIndexes: optionInput.optionIndexes }),
    }),
    writeContext.apiKey,
    'Vote on poll transaction build failed.',
    'application/json',
  );
  const approvedOptionIndexes = typeof optionInput.optionIndexes === 'undefined'
    ? typeof optionInput.optionIndex === 'number' && optionInput.optionIndex !== 0 ? [optionInput.optionIndex] : []
    : optionInput.optionIndexes.filter((index) => index !== 0);
  const processedTransaction = useLocalWrite
    ? await processQdnAccountTransaction(writeContext as QdnChatContext, unsignedTransaction)
    : await signAndProcessKeylessStandardTransaction(
        writeContext as QdnKeylessWriteContext,
        unsignedTransaction.body,
        capabilities!.mempowFeeAlternativeDifficulty,
        (bytes) => assertPublicVoteOnPollTransaction(bytes, {
          optionIndexes: approvedOptionIndexes,
          pollId,
          publicKey: base58Decode(writeContext.publicKey58),
          timestamp,
          txGroupId,
        }),
        () => isKeylessWriteContextFresh(sender, context as QdnViewContext, writeContext as QdnKeylessWriteContext),
      );

  return {
    accepted: true,
    action: 'VOTE_ON_POLL',
    pollId,
    ...(typeof optionInput.optionIndexes === 'undefined'
      ? { optionIndex: optionInput.optionIndex }
      : { optionIndexes: optionInput.optionIndexes }),
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

// Rating range is -4..+4 inclusive; 0 means "remove the existing rating" (not a
// neutral score). Core is the final authority on validity (cooldown, self-rating,
// unknown account, no-op) — this only screens out values that can never be valid.
function getRequiredRatingValue(request: QdnAppRequest) {
  const rating = getInteger(getRequestValue(request, 'rating'));

  if (typeof rating !== 'number') {
    throw new Error('Rating is required.');
  }

  if (rating < -4 || rating > 4) {
    throw new Error('Rating must be an integer between -4 and 4 (0 removes the rating).');
  }

  return rating;
}

function describeRating(rating: number) {
  return rating === 0 ? 'remove rating' : `rating ${rating > 0 ? '+' : ''}${rating}`;
}

async function rateAccountForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const targetPublicKey = getRequiredRequestString(request, 'targetPublicKey', 'Target public key');
  const category = getRequiredRequestString(request, 'category', 'Rating category');
  const rating = getRequiredRatingValue(request);
  const writeContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'RATE_ACCOUNT',
    name: `${category} · ${describeRating(rating)}`,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/account-ratings/rate',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      raterPublicKey: writeContext.publicKey58,
      targetPublicKey,
      category,
      rating,
    }),
    writeContext.apiKey,
    'Rate account transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'RATE_ACCOUNT',
    targetPublicKey,
    category,
    rating,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

// Resource rating range is 1..10 inclusive; 0 means "remove the existing rating"
// (not a score). Core is the final authority on validity (unpublished resource,
// non-rateable service, no-op) - this only screens out values that can never be valid.
function getRequiredResourceRatingValue(request: QdnAppRequest) {
  const rating = getInteger(getRequestValue(request, 'rating'));

  if (typeof rating !== 'number') {
    throw new Error('Rating is required.');
  }

  if (rating < 0 || rating > 10) {
    throw new Error('Rating must be an integer between 1 and 10 (0 removes the rating).');
  }

  return rating;
}

function describeResourceRating(rating: number) {
  return rating === 0 ? 'remove rating' : `rating ${rating}/10`;
}

// The RATE_RESOURCE transaction body carries Core's numeric service id, not the
// string name apps use, so the id is resolved from the node's own catalogue
// instead of a second copy of the Service enum that could silently drift.
async function getQdnServiceValue(connection: NodeConnection, service: string) {
  const services = await fetchLocalNodeApiPayload(
    connection,
    '/arbitrary/services',
    'QDN service catalogue lookup failed.',
  );

  if (Array.isArray(services)) {
    for (const entry of services) {
      if (isRecord(entry) && getString(entry.id).toUpperCase() === service && typeof entry.value === 'number') {
        return entry.value;
      }
    }
  }

  throw new Error(`The node does not recognise the ${service} QDN service.`);
}

async function rateResourceForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const service = getService(getRequestValue(request, 'service'));
  const name = getRequiredRequestString(request, 'name', 'QDN resource name');
  const identifier = getString(getRequestValue(request, 'identifier')) || 'default';
  const rating = getRequiredResourceRatingValue(request);

  if (!service) {
    throw new Error('QDN resource service is required.');
  }

  const writeContext = await getQdnChatContext(context);
  const serviceValue = await getQdnServiceValue(writeContext.connection, service);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'RATE_RESOURCE',
    name: describeResourceRating(rating),
    resource: { service, name, identifier, tags: [] },
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/resource-ratings/rate',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      raterPublicKey: writeContext.publicKey58,
      service: serviceValue,
      name,
      identifier,
      rating,
    }),
    writeContext.apiKey,
    'Rate resource transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'RATE_RESOURCE',
    service,
    name,
    identifier,
    rating,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

function normalizeRatingSummary(summary: unknown) {
  if (summary === null || summary === undefined) {
    return null;
  }

  if (Array.isArray(summary) && summary.length === 0) {
    return null;
  }

  if (isRecord(summary) && Object.keys(summary).length === 0) {
    return null;
  }

  return summary;
}

async function fetchOptionalNodeApiPayload(
  apiPath: string,
  request: QdnAppRequest,
  notFoundValue: unknown,
) {
  const result = await fetchConfiguredNodeApi(apiPath, getQdnAppMaxBytes(getRequestValue(request, 'maxBytes')));

  if (result.status === 404) {
    return notFoundValue;
  }

  if (!result.ok) {
    throw getNodeApiResponseError(result, `Qortium node request failed with HTTP ${result.status}.`);
  }

  return result.data;
}

async function getResourceRatingForApp(request: QdnAppRequest, context: QdnViewContext | null) {
  const service = getService(getRequestValue(request, 'service'));
  const name = getRequiredRequestString(request, 'name', 'QDN resource name');
  const identifier = getString(getRequestValue(request, 'identifier')) || 'default';
  const explicitRater = getOptionalAddressRequestString(request, 'Rater address', 'rater');
  const rater = explicitRater || (await getSelectedAccountForQdnApp(context)).address;

  if (!service) {
    throw new Error('QDN resource service is required.');
  }

  const summaryQueryParams = new URLSearchParams({
    service,
    name,
    identifier,
  });
  const ratingQueryParams = new URLSearchParams({
    service,
    name,
    identifier,
    rater,
  });

  const [summaryResult, ratingResult] = await Promise.all([
    fetchOptionalNodeApiPayload(`/resource-ratings/summary?${summaryQueryParams}`, request, null),
    fetchOptionalNodeApiPayload(`/resource-ratings/rating?${ratingQueryParams}`, request, null),
  ]);

  const summary = normalizeRatingSummary(summaryResult);
  const rating = ratingResult ?? null;

  return {
    action: 'GET_RESOURCE_RATING',
    service,
    name,
    identifier,
    rater,
    summary,
    rating,
  };
}

async function getAccountRatingForApp(request: QdnAppRequest, context: QdnViewContext | null) {
  const target = getRequiredAddressRequestString(request, 'target', 'Target address');
  const category = getString(getRequestValue(request, 'category'));
  const explicitRater = getOptionalAddressRequestString(request, 'Rater address', 'rater');
  const rater = explicitRater || (await getSelectedAccountForQdnApp(context)).address;

  const summaryQueryParams = new URLSearchParams({
    target,
    ...(category ? { category } : {}),
  });
  const ratingQueryParams = new URLSearchParams({
    target,
    rater,
    ...(category ? { category } : {}),
  });

  const [summaryResult, ratingsResult] = await Promise.all([
    fetchOptionalNodeApiPayload(`/account-ratings/summary?${summaryQueryParams}`, request, null),
    fetchOptionalNodeApiPayload(`/account-ratings?${ratingQueryParams}`, request, []),
  ]);

  const summary = normalizeRatingSummary(summaryResult);
  const ratings = Array.isArray(ratingsResult) ? ratingsResult : [];

  return {
    action: 'GET_ACCOUNT_RATING',
    target,
    category,
    rater,
    summary,
    ratings,
  };
}

async function updatePollForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const pollId = getRequiredIntegerRequestValue(request, 0, 'Poll id', 'pollId', 'poll');
  const newPollName = getRequiredRequestString(request, 'newPollName', 'New poll name');
  const newDescription = getString(getRequestValue(request, 'newDescription') ?? getRequestValue(request, 'description'));
  const newPollOptions = getPollOptionsRequestInput(request, 'newPollOptions', 'pollOptions', 'options');
  const newStartTime = getOptionalIntegerRequestValue(request, 0, 'newStartTime', 'startTime');
  const newEndTime = getOptionalIntegerRequestValue(request, 0, 'newEndTime', 'endTime');
  const connection = await getNodeConnection();
  const useLocalWrite = isLocalWriteConnection(connection);
  const writeContext = useLocalWrite
    ? await getQdnChatContext(context)
    : await getKeylessChatContext(context);
  const capabilities = useLocalWrite ? null : await getPublicPollCapabilities(connection);
  const fee = getTransactionFee(request);
  const txGroupId = getTransactionGroupId(request);
  if (!useLocalWrite && fee !== 0) throw new Error('Public-node poll writes require a zero fee.');

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'UPDATE_POLL',
    name: newPollName,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const timestamp = Date.now();
  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    useLocalWrite ? '/polls/update' : '/polls/public/update',
    JSON.stringify({
      timestamp,
      txGroupId,
      fee,
      ownerPublicKey: writeContext.publicKey58,
      pollId,
      newPollName,
      newDescription,
      newPollOptions,
      ...(typeof newStartTime === 'number' ? { newStartTime } : {}),
      ...(typeof newEndTime === 'number' ? { newEndTime } : {}),
    }),
    writeContext.apiKey,
    'Update poll transaction build failed.',
    'application/json',
  );
  const processedTransaction = useLocalWrite
    ? await processQdnAccountTransaction(writeContext as QdnChatContext, unsignedTransaction)
    : await signAndProcessKeylessStandardTransaction(
        writeContext as QdnKeylessWriteContext,
        unsignedTransaction.body,
        capabilities!.mempowFeeAlternativeDifficulty,
        (bytes) => assertPublicUpdatePollTransaction(bytes, {
          endTime: newEndTime,
          newDescription,
          newPollName,
          newPollOptions: newPollOptions.map((option) => option.optionName),
          pollId,
          publicKey: base58Decode(writeContext.publicKey58),
          startTime: newStartTime,
          timestamp,
          txGroupId,
        }),
        () => isKeylessWriteContextFresh(sender, context as QdnViewContext, writeContext as QdnKeylessWriteContext),
      );

  return {
    accepted: true,
    action: 'UPDATE_POLL',
    pollId,
    newPollName,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function registerNameForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const name = getRequiredNameRequestString(request);
  const data = getString(getRequestValue(request, 'data')) || getString(getRequestValue(request, 'nameData'));
  const writeContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'REGISTER_NAME',
    name,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/names/register',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      registrantPublicKey: writeContext.publicKey58,
      name,
      data,
    }),
    writeContext.apiKey,
    'Register name transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'REGISTER_NAME',
    name,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function updateNameForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const name = getRequiredNameRequestString(request);
  const writeContext = await getQdnChatContext(context);
  const nameData = await getNameDataForApp(writeContext.connection, name);
  const newName = getString(getRequestValue(request, 'newName'));
  const newData =
    getString(getRequestValue(request, 'newData')) ||
    getString(getRequestValue(request, 'data')) ||
    getString(getRequestValue(request, 'nameData'));
  const primary = getOptionalBooleanRequestValue(request, 'primary', 'isPrimary');

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'UPDATE_NAME',
    name,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/names/update',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request, getNameCreationGroupId(nameData)),
      fee: getTransactionFee(request),
      ownerPublicKey: writeContext.publicKey58,
      name,
      newName,
      newData,
      primary,
    }),
    writeContext.apiKey,
    'Update name transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'UPDATE_NAME',
    name,
    newName: newName || null,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function sellNameForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const name = getRequiredNameRequestString(request);
  const amount = getRequiredAmountValue(request, 'amount', 'Name sale amount');
  const recipient = getOptionalAddressRequestString(request, 'Recipient address', 'recipient', 'recipientAddress');
  const writeContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'SELL_NAME',
    amount,
    name,
    permissionScope: 'single-request',
    recipientAddress: recipient || undefined,
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/names/sell',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      ownerPublicKey: writeContext.publicKey58,
      name,
      amount,
      recipient: recipient || undefined,
    }),
    writeContext.apiKey,
    'Sell name transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'SELL_NAME',
    amount,
    name,
    recipient: recipient || null,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function cancelSellNameForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const name = getRequiredNameRequestString(request);
  const writeContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'CANCEL_SELL_NAME',
    name,
    permissionScope: 'single-request',
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/names/sell/cancel',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      ownerPublicKey: writeContext.publicKey58,
      name,
    }),
    writeContext.apiKey,
    'Cancel name sale transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'CANCEL_SELL_NAME',
    name,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function buyNameForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const name = getRequiredNameRequestString(request);
  const writeContext = await getQdnChatContext(context);
  const nameData = await getNameDataForApp(writeContext.connection, name);
  const seller = getString(getRequestValue(request, 'seller')) || getNameOwnerAddress(nameData);
  const amount =
    typeof getRequestValue(request, 'amount') === 'undefined'
      ? getNameSaleAmount(nameData)
      : getRequiredAmountValue(request, 'amount', 'Name purchase amount');

  if (!seller) {
    throw new Error('Name seller address is required.');
  }

  assertQortiumAddress(seller, 'Seller address');

  if (typeof amount === 'undefined') {
    throw new Error('Name purchase amount is required.');
  }

  await requestQdnWriteApproval(context as QdnViewContext, writeContext.profile, {
    action: 'BUY_NAME',
    amount,
    name,
    permissionScope: 'single-request',
    recipientAddress: seller,
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const unsignedTransaction = await postLocalNodeText(
    writeContext.connection,
    '/names/buy',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      buyerPublicKey: writeContext.publicKey58,
      name,
      amount,
      seller,
    }),
    writeContext.apiKey,
    'Buy name transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'BUY_NAME',
    amount,
    name,
    result: processedTransaction.data,
    seller,
    transactionSignature: processedTransaction.signature,
  };
}

async function sendPublicGroupChatMessage(
  chatContext: QdnChatContext,
  groupId: number,
  message: string,
  chatReference?: string,
) {
  const unsignedTransaction = await postLocalNodeText(
    chatContext.connection,
    '/chat',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: groupId,
      fee: 0,
      senderPublicKey: chatContext.publicKey58,
      chatReference,
      data: encodeChatTextData(message),
      isText: true,
      isEncrypted: false,
    }),
    chatContext.apiKey,
    'Chat transaction build failed.',
    'application/json',
  );
  const processedTransaction = await signAndProcessTransaction(
    chatContext.connection,
    chatContext.apiKey,
    chatContext.privateKey58,
    unsignedTransaction.body,
    '/chat/compute',
  );

  return processedTransaction.data;
}

async function sendPrivateGroupChatMessage(
  chatContext: QdnChatContext,
  groupId: number,
  message: string,
  chatReference?: string,
) {
  const result = await postLocalNodeText(
    chatContext.connection,
    '/chat/private/group/send',
    JSON.stringify({
      senderPrivateKey: chatContext.privateKey58,
      groupId,
      data: encodeChatTextData(message),
      isText: true,
      chatReference,
    }),
    chatContext.apiKey,
    'Private group chat send failed.',
    'application/json',
  );

  return parseLocalPostData(result);
}

async function sendDirectPrivateChatMessage(
  chatContext: QdnChatContext,
  recipientAddress: string,
  message: string,
  chatReference?: string,
) {
  const result = await postLocalNodeText(
    chatContext.connection,
    '/chat/private/direct/send',
    JSON.stringify({
      senderPrivateKey: chatContext.privateKey58,
      recipient: recipientAddress,
      data: encodeChatTextData(message),
      isText: true,
      chatReference,
    }),
    chatContext.apiKey,
    'Direct private chat send failed.',
    'application/json',
  );

  return parseLocalPostData(result);
}

type MemoryPowWorkerResponse =
  | { id: string; nonce: number }
  | { id: string; error: string };

let memoryPowWorker: Worker | null = null;
let memoryPowActive = false;

function getMemoryPowWorker(): Worker {
  if (!memoryPowWorker) {
    // The compiled worker sits next to this module (dist-electron/) in dev and
    // inside app.asar/dist-electron/ when packaged. It is pure JS, so no
    // asarUnpack is required. Mirrors how preload.cjs is resolved in main.ts.
    const worker = new Worker(path.join(__dirname, 'memoryPow.worker.js'));

    // Reset the singleton if the worker dies so the next request re-spawns it.
    worker.on('error', () => {
      if (memoryPowWorker === worker) {
        memoryPowWorker = null;
      }
    });
    worker.on('exit', () => {
      if (memoryPowWorker === worker) {
        memoryPowWorker = null;
      }
    });

    memoryPowWorker = worker;
  }

  return memoryPowWorker;
}

// Runs the CHAT memory-pow off the main process and resolves with the nonce.
// Mirrors src/platform.ts computeChatNonce.
function computeChatNonce(
  data: Uint8Array,
  difficulty: number,
  isStillValid?: () => boolean | Promise<boolean>,
): Promise<number> {
  if (memoryPowActive) {
    return Promise.reject(qdnCodedError('QDN_POW_BUSY', 'Another proof-of-work computation is already running. Please retry.'));
  }

  const worker = getMemoryPowWorker();
  const id = randomUUID();
  memoryPowActive = true;

  return new Promise<number>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, nonce?: number, terminate = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(validityTimer);
      worker.off('message', onMessage);
      worker.off('error', onError);
      memoryPowActive = false;
      if (terminate) {
        if (memoryPowWorker === worker) memoryPowWorker = null;
        void worker.terminate();
      }
      if (error) reject(error);
      else resolve(nonce as number);
    };
    const onMessage = (response: MemoryPowWorkerResponse) => {
      if (response.id !== id) {
        return;
      }

      if ('error' in response) {
        finish(new Error(response.error));
        return;
      }

      finish(undefined, response.nonce);
    };

    const onError = (error: Error) => {
      finish(new Error(error.message || 'Memory-pow computation failed.'), undefined, true);
    };

    const timeout = setTimeout(() => {
      finish(qdnCodedError('QDN_POW_TIMEOUT', 'Proof-of-work did not finish within three minutes.'), undefined, true);
    }, MEMORY_POW_TIMEOUT_MS);
    const validityTimer = setInterval(() => {
      if (!isStillValid) return;
      void Promise.resolve(isStillValid()).then((valid) => {
        if (!valid) finish(qdnCodedError('QDN_POW_CANCELLED', 'Proof-of-work was canceled because the account, node, or app context changed.'), undefined, true);
      }).catch(() => {
        finish(qdnCodedError('QDN_POW_CANCELLED', 'Proof-of-work was canceled because its signing context could not be revalidated.'), undefined, true);
      });
    }, 500);

    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.postMessage({ id, data, difficulty });
  });
}

// Keyless open-group chat send for PUBLIC/network nodes. Builds the unsigned CHAT
// bytes via the keyless /chat/public/build endpoint, computes the memory-pow
// nonce locally in a worker thread, signs locally with the account's ed25519 key,
// then broadcasts the fully signed bytes. The private key is NEVER sent to the
// node. Mirrors src/platform.ts sendKeylessPublicGroupChatMessage.
async function sendKeylessPublicGroupChatMessage(
  keylessContext: QdnKeylessChatContext,
  groupId: number,
  message: string,
  chatReference?: string,
  isStillValid?: () => boolean | Promise<boolean>,
) {
  const timestamp = Date.now();
  const data = encodeChatTextData(message);
  const unsignedTransaction = await postLocalNodeText(
    keylessContext.connection,
    '/chat/public/build',
    JSON.stringify({
      senderPublicKey: keylessContext.publicKey58,
      data,
      isText: true,
      isEncrypted: false,
      txGroupId: groupId,
      timestamp,
      fee: 0,
      chatReference,
    }),
    keylessContext.apiKey,
    'Chat transaction build failed.',
    'application/json',
  );

  const unsignedBytes = base58Decode(unsignedTransaction.body);
  assertPublicChatTransaction(unsignedBytes, {
    chatReference: chatReference ? base58Decode(chatReference) : undefined,
    data: base58Decode(data),
    publicKey: base58Decode(keylessContext.publicKey58),
    timestamp,
    txGroupId: groupId,
  });
  // The build endpoint returns nonce-free bytes (nonce field already zeroed), so
  // we hash the bytes as-is to seed the memory-pow.
  const nonce = await computeChatNonce(unsignedBytes, CHAT_POW_DIFFICULTY, isStillValid);
  const signedBytes = signChatTransaction(unsignedBytes, nonce, keylessContext.secretKey);

  if (isStillValid && !(await isStillValid())) {
    throw qdnCodedError('QDN_POW_CANCELLED', 'The signing context changed before the chat message could be submitted.');
  }

  const processedTransaction = await postLocalNodeText(
    keylessContext.connection,
    '/transactions/process?apiVersion=2',
    base58Encode(signedBytes),
    keylessContext.apiKey,
    'Chat transaction processing failed.',
  );

  return parseLocalPostData(processedTransaction);
}

// Keyless open-group send path for PUBLIC/network nodes. Direct messages and
// closed/private groups are rejected here because they would require sending the
// private key to a public node. Returns null when the node is not in network mode
// so the caller falls back to the existing server-side signing path. Mirrors
// src/platform.ts trySendChatMessageOnNetworkNode.
async function trySendChatMessageOnNetworkNode(
  context: QdnViewContext | null,
  sender: WebContents,
  target: QdnChatMessageTarget,
  message: string,
  chatReference?: string,
) {
  const connection = await getNodeConnection();

  if (connection.mode !== 'network') {
    return null;
  }

  if (target.kind === 'direct') {
    throw new Error(
      'Direct (private) chat requires a local Core or a trusted custom node so Home never sends your private key to a public node.',
    );
  }

  const keylessContext = await getKeylessChatContext(context);
  const groupId = target.groupId;
  const groupData = await getGroupDataForChat(keylessContext.connection, groupId);
  const groupName = getGroupName(groupData);
  // Fail closed on a public node: only send when the group is confirmed open.
  // An unverifiable/missing group lookup is treated as not-open and rejected.
  const isOpenGroup = groupId === 0 || (isRecord(groupData) && groupData.isOpen === true);

  if (!isOpenGroup) {
    throw new Error(
      'Sending to a closed or private group requires a local Core or a trusted custom node so Home never sends your private key to a public node.',
    );
  }

  await requestQdnChatPermissionApproval(
    context as QdnViewContext,
    keylessContext.profile,
    'SEND_CHAT_MESSAGE',
    {
      chatMessagePreview: getChatMessagePreview(message),
      groupId,
      groupName,
    },
  );

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const result = await sendKeylessPublicGroupChatMessage(
    keylessContext,
    groupId,
    message,
    chatReference,
    () => isKeylessWriteContextFresh(sender, context as QdnViewContext, keylessContext),
  );

  return {
    accepted: true,
    action: 'SEND_CHAT_MESSAGE' as const,
    encrypted: false,
    groupId,
    groupName,
    result,
  };
}

async function sendChatMessageForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const target = getChatMessageTarget(request);
  const message = getChatMessageText(request);
  const chatReference = getOptionalBase58RequestString(request, 'chatReference');

  // Network (public) nodes get the keyless local-sign path for open groups; any
  // path that would leak the private key is rejected. Local/custom nodes keep the
  // existing server-side signing behaviour below.
  const networkResult = await trySendChatMessageOnNetworkNode(context, sender, target, message, chatReference);

  if (networkResult) {
    return networkResult;
  }

  const chatContext = await getQdnChatContext(context);

  if (target.kind === 'direct') {
    await requestQdnChatPermissionApproval(
      context as QdnViewContext,
      chatContext.profile,
      'SEND_CHAT_MESSAGE',
      {
        chatMessagePreview: getChatMessagePreview(message),
        recipientAddress: target.recipientAddress,
      },
    );

    assertFreshQdnWriteContext(sender, context as QdnViewContext);

    const result = await sendDirectPrivateChatMessage(
      chatContext,
      target.recipientAddress,
      message,
      chatReference,
    );

    return {
      accepted: true,
      action: 'SEND_CHAT_MESSAGE',
      direct: true,
      encrypted: true,
      recipientAddress: target.recipientAddress,
      result,
    };
  }

  const groupId = target.groupId;
  const groupData = await getGroupDataForChat(chatContext.connection, groupId);
  const groupName = getGroupName(groupData);
  const isOpenGroup = groupId === 0 || isOpenGroupData(groupData);

  await requestQdnChatPermissionApproval(
    context as QdnViewContext,
    chatContext.profile,
    'SEND_CHAT_MESSAGE',
    {
      chatMessagePreview: getChatMessagePreview(message),
      groupId,
      groupName,
    },
  );

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const result = isOpenGroup
    ? await sendPublicGroupChatMessage(chatContext, groupId, message, chatReference)
    : await sendPrivateGroupChatMessage(chatContext, groupId, message, chatReference);

  return {
    accepted: true,
    action: 'SEND_CHAT_MESSAGE',
    encrypted: !isOpenGroup,
    groupId,
    groupName,
    result,
  };
}

// Submit one deliberately constrained chain MESSAGE to an AT. Unlike chat,
// MESSAGE has no public Core builder endpoint and cannot use /transactions/
// mempow/compute: its nonce lives in the transaction bytes. The bytes are
// constructed locally, MemoryPoW is computed locally, and the wallet secret is
// used only for local signing before the final signed bytes are broadcast.
async function sendMessageForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  if (!context) {
    throw new Error('SEND_MESSAGE is only available from a QDN app frame.');
  }

  let messageRequest: ReturnType<typeof getQortiumAtMessageRequest>;

  try {
    // The HARDENED normalizer, the same one the Home 2 paths use. Reading only
    // recipient and message let an app send `amount: 5` alongside them, get
    // accepted:true back, and reasonably conclude it had paid the contract —
    // while the transaction carries no payment at all.
    messageRequest = normalizeHomeV2AtMessageRequest('qdnRequest', request as Record<string, unknown>);
  } catch (error) {
    return {
      accepted: false,
      error: error instanceof Error ? error.message : String(error),
      errorType: 'VALIDATION_FAILED',
    };
  }

  // This intentionally permits a public/network node: Home computes the
  // nonce and signature locally, and an AT MESSAGE has no private payload.
  const keylessContext = await getKeylessChatContext(context);

  try {
    await requestQdnWriteApproval(context, keylessContext.profile, {
      action: 'SEND_MESSAGE',
      chatMessagePreview: messageRequest.message,
      details: [
        { label: 'Transaction', value: 'MESSAGE to an AT (no payment)' },
        { label: 'Fee', value: `0 (local 8 MiB MemoryPoW, difficulty ${QORTIUM_AT_MESSAGE_POW_DIFFICULTY})` },
        { label: 'Network', value: 'Qortium Previewnet' },
      ],
      permissionScope: 'single-request',
      recipientAddress: messageRequest.recipient,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'QDN write request was denied.') {
      return { accepted: false, canceled: true, reason: 'USER_CANCELLED' };
    }

    throw error;
  }

  assertFreshQdnWriteContext(sender, context);

  const messageTimestamp = Date.now();
  const unsignedBytes = buildUnsignedQortiumAtMessageTransactionBytes({
    ...messageRequest,
    senderPublicKey: keylessContext.publicKey58,
    timestamp: messageTimestamp,
  });
  const expectedAtMessageFields = {
    messageBytes: new TextEncoder().encode(messageRequest.message),
    recipientBytes: base58Decode(messageRequest.recipient),
    senderPublicKeyBytes: base58Decode(keylessContext.publicKey58),
    timestamp: messageTimestamp,
  };
  const result = await signAndProcessKeylessStandardTransaction(
    keylessContext,
    base58Encode(unsignedBytes),
    QORTIUM_AT_MESSAGE_POW_DIFFICULTY,
    // Read back field by field. This was a deliberate no-op on the grounds
    // that the bytes come from a fixed-field serializer — but that serializer
    // is then the ONLY thing between the request and a signature, which is
    // why every MESSAGE build site now verifies its own output.
    (bytes) => assertUnsignedQortiumAtMessageTransaction(bytes, { ...expectedAtMessageFields, nonce: 0 }),
    () => isKeylessWriteContextFresh(sender, context, keylessContext),
    // /transactions/process is public; do not disclose a custom-node API key
    // for a transaction that needs no protected Core endpoint.
    '',
    // And the stamped bytes, immediately before signing.
    (stampedBytes, nonce) => assertUnsignedQortiumAtMessageTransaction(stampedBytes, {
      ...expectedAtMessageFields,
      nonce,
    }),
  );

  return {
    accepted: true,
    action: 'SEND_MESSAGE' as const,
    fee: '0',
    recipient: messageRequest.recipient,
    result: result.data,
    signature: result.signature,
  };
}

async function getPrivateGroupActiveChatsForApp(request: QdnAppRequest, context: QdnViewContext | null) {
  const chatContext = await getQdnChatContext(context);

  const result = await postLocalNodeText(
    chatContext.connection,
    '/chat/private/group/active',
    JSON.stringify({
      recipientPrivateKey: chatContext.privateKey58,
      encoding: getString(getRequestValue(request, 'encoding')) || undefined,
    }),
    chatContext.apiKey,
    'Private group active chat lookup failed.',
    'application/json',
  );

  return parseLocalPostData(result);
}

async function searchPrivateGroupChatMessagesForApp(request: QdnAppRequest, context: QdnViewContext | null) {
  const chatContext = await getQdnChatContext(context);
  const groupId = getRequiredGroupId(request, 1);

  const result = await postLocalNodeText(
    chatContext.connection,
    '/chat/private/group/messages',
    JSON.stringify(buildPrivateGroupChatMessagesBody(request, chatContext.privateKey58)),
    chatContext.apiKey,
    'Private group chat message lookup failed.',
    'application/json',
  );

  return parseLocalPostData(result);
}

async function requestPrivateGroupChatKeyForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const chatContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, chatContext.profile, {
    action: 'REQUEST_PRIVATE_GROUP_CHAT_KEY',
    groupId,
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const result = await postLocalNodeText(
    chatContext.connection,
    '/chat/private/group/key-request',
    JSON.stringify(buildPrivateGroupChatKeyRequestBody(request, chatContext.privateKey58)),
    chatContext.apiKey,
    'Private group chat key request failed.',
    'application/json',
  );

  return {
    accepted: true,
    action: 'REQUEST_PRIVATE_GROUP_CHAT_KEY',
    groupId,
    result: parseLocalPostData(result),
  };
}

async function resolvePrivateGroupChatKeyRequestsForApp(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  const groupId = getRequiredGroupId(request, 1);
  const chatContext = await getQdnChatContext(context);

  await requestQdnWriteApproval(context as QdnViewContext, chatContext.profile, {
    action: 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS',
    groupId,
  });

  assertFreshQdnWriteContext(sender, context as QdnViewContext);

  const result = await postLocalNodeText(
    chatContext.connection,
    '/chat/private/group/key-requests/resolve',
    JSON.stringify(buildPrivateGroupChatKeyRequestRecoveryBody(request, chatContext.privateKey58)),
    chatContext.apiKey,
    'Private group chat key request resolution failed.',
    'application/json',
  );

  return {
    accepted: true,
    action: 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS',
    groupId,
    result: parseLocalPostData(result),
  };
}

async function getPrivateDirectActiveChatsForApp(request: QdnAppRequest, context: QdnViewContext | null) {
  const chatContext = await getQdnChatContext(context);

  const result = await postLocalNodeText(
    chatContext.connection,
    '/chat/private/direct/active',
    JSON.stringify({
      accountPrivateKey: chatContext.privateKey58,
      encoding: getString(getRequestValue(request, 'encoding')) || undefined,
      hasChatReference: getBoolean(getRequestValue(request, 'hasChatReference')),
    }),
    chatContext.apiKey,
    'Direct private active chat lookup failed.',
    'application/json',
  );

  return parseLocalPostData(result);
}

async function searchPrivateDirectChatMessagesForApp(request: QdnAppRequest, context: QdnViewContext | null) {
  const chatContext = await getQdnChatContext(context);
  const otherAddress = getDirectChatOtherAddress(request);

  const result = await postLocalNodeText(
    chatContext.connection,
    '/chat/private/direct/messages',
    JSON.stringify(buildPrivateDirectChatMessagesBody(request, chatContext.privateKey58, otherAddress)),
    chatContext.apiKey,
    'Direct private chat message lookup failed.',
    'application/json',
  );

  return parseLocalPostData(result);
}

function getQdnAppResourceRequest(request: QdnAppRequest) {
  const service = getService(getRequestValue(request, 'service'));
  const name = getString(getRequestValue(request, 'name'));
  const identifier = getString(getRequestValue(request, 'identifier'));
  const resourcePath = getString(getRequestValue(request, 'path')) || getString(getRequestValue(request, 'filepath'));

  if (!service) {
    throw new Error('QDN resource service is required.');
  }

  if (!name) {
    throw new Error('QDN resource name is required.');
  }

  return {
    service,
    name,
    identifier: identifier || undefined,
    path: resourcePath,
  };
}

function getEncodedResourcePath(resourcePath: string) {
  return resourcePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildQdnResourceStatusPath(request: QdnAppRequest) {
  const resource = getQdnAppResourceRequest(request);
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  if (typeof getBoolean(getRequestValue(request, 'build')) === 'boolean') {
    queryParams.set('build', String(getBoolean(getRequestValue(request, 'build'))));
  }

  const queryString = queryParams.toString();

  return `/arbitrary/resource/status/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}${
    queryString ? `?${queryString}` : ''
  }`;
}

function buildQdnResourcePropertiesPath(request: QdnAppRequest) {
  const resource = getQdnAppResourceRequest(request);

  return `/arbitrary/resource/properties/${resource.service}/${encodeURIComponent(resource.name)}/${encodeURIComponent(
    resource.identifier ?? 'default',
  )}`;
}

function buildQdnResourceMetadataPath(request: QdnAppRequest) {
  const resource = getQdnAppResourceRequest(request);

  return `/arbitrary/metadata/${resource.service}/${encodeURIComponent(resource.name)}/${encodeURIComponent(
    resource.identifier ?? 'default',
  )}`;
}

function buildFetchQdnResourcePath(request: QdnAppRequest) {
  const resource = getQdnAppResourceRequest(request);
  const queryParams = new URLSearchParams();

  if (resource.path) {
    queryParams.set('filepath', resource.path);
  }

  for (const key of ['encoding', 'rebuild', 'async']) {
    const value = getRequestValue(request, key);

    if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
      queryParams.set(key, String(value));
    }
  }

  const queryString = queryParams.toString();

  return `/arbitrary/${resource.service}/${encodeURIComponent(resource.name)}${
    resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : ''
  }${queryString ? `?${queryString}` : ''}`;
}

function appendQueryValue(queryParams: URLSearchParams, key: string, value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) {
      appendQueryValue(queryParams, key, item);
    }

    return;
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    queryParams.append(key, String(value));
    return;
  }

  const stringValue = getString(value);

  if (stringValue) {
    queryParams.append(key, stringValue);
  }
}

function buildQdnResourcesPath(request: QdnAppRequest, pathBase: string) {
  const queryParams = new URLSearchParams();
  const queryFields: Record<string, string> = {
    default: 'default',
    description: 'description',
    exactMatchNames: 'exactmatchnames',
    excludeBlocked: 'excludeblocked',
    followedOnly: 'followedonly',
    identifier: 'identifier',
    includeMetadata: 'includemetadata',
    includeStatus: 'includestatus',
    keywords: 'keywords',
    limit: 'limit',
    mode: 'mode',
    name: 'name',
    nameListFilter: 'namefilter',
    names: 'name',
    offset: 'offset',
    prefix: 'prefix',
    query: 'query',
    reverse: 'reverse',
    service: 'service',
    title: 'title',
  };

  for (const [requestKey, queryKey] of Object.entries(queryFields)) {
    appendQueryValue(queryParams, queryKey, getRequestValue(request, requestKey));
  }

  const queryString = queryParams.toString();

  return `${pathBase}${queryString ? `?${queryString}` : ''}`;
}

function appendRequestQueryFields(
  queryParams: URLSearchParams,
  request: QdnAppRequest,
  queryFields: Record<string, string>,
) {
  for (const [requestKey, queryKey] of Object.entries(queryFields)) {
    appendQueryValue(queryParams, queryKey, getRequestValue(request, requestKey));
  }
}

function buildGroupsPath(request: QdnAppRequest) {
  const queryParams = new URLSearchParams();

  appendRequestQueryFields(queryParams, request, {
    limit: 'limit',
    offset: 'offset',
    reverse: 'reverse',
  });

  const queryString = queryParams.toString();

  return `/groups${queryString ? `?${queryString}` : ''}`;
}

function buildSearchGroupsPath(request: QdnAppRequest) {
  const queryParams = new URLSearchParams();

  appendRequestQueryFields(queryParams, request, {
    limit: 'limit',
    offset: 'offset',
    prefixOnly: 'prefixOnly',
    query: 'query',
    reverse: 'reverse',
    visibility: 'visibility',
  });

  const queryString = queryParams.toString();

  return `/groups/search${queryString ? `?${queryString}` : ''}`;
}

function buildGroupMembersPath(request: QdnAppRequest) {
  const groupId = getRequiredGroupId(request, 1);
  const queryParams = new URLSearchParams();

  appendRequestQueryFields(queryParams, request, {
    limit: 'limit',
    offset: 'offset',
    onlyAdmins: 'onlyAdmins',
    reverse: 'reverse',
  });

  const queryString = queryParams.toString();

  return `/groups/members/${encodeURIComponent(String(groupId))}${queryString ? `?${queryString}` : ''}`;
}

function buildGroupJoinRequestsPath(request: QdnAppRequest) {
  return `/groups/joinrequests/${encodeURIComponent(String(getRequiredGroupId(request, 1)))}`;
}

function buildGroupKicksPath(request: QdnAppRequest) {
  const groupId = getRequiredGroupId(request, 1);
  const queryParams = new URLSearchParams();

  appendRequestQueryFields(queryParams, request, {
    address: 'address',
    before: 'before',
    after: 'after',
    limit: 'limit',
    offset: 'offset',
    reverse: 'reverse',
  });

  const queryString = queryParams.toString();

  return `/groups/kicks/${encodeURIComponent(String(groupId))}${queryString ? `?${queryString}` : ''}`;
}

function buildGroupBansPath(request: QdnAppRequest) {
  const groupId = getRequiredGroupId(request, 1);

  return `/groups/bans/${encodeURIComponent(String(groupId))}`;
}

async function buildMemberKicksPath(request: QdnAppRequest, context: QdnViewContext | null) {
  const address = await getAddressForQdnRequest(request, context, 'Address');
  const queryParams = new URLSearchParams({ address });

  appendRequestQueryFields(queryParams, request, {
    groupId: 'groupId',
    before: 'before',
    after: 'after',
    limit: 'limit',
    offset: 'offset',
    reverse: 'reverse',
  });

  return `/groups/kicks/member?${queryParams.toString()}`;
}

async function buildMemberBansPath(request: QdnAppRequest, context: QdnViewContext | null) {
  const address = await getAddressForQdnRequest(request, context, 'Address');
  const queryParams = new URLSearchParams({ address });

  appendRequestQueryFields(queryParams, request, {
    limit: 'limit',
    offset: 'offset',
    reverse: 'reverse',
  });

  return `/groups/bans/member?${queryParams.toString()}`;
}

async function buildAccountGroupJoinRequestsPath(request: QdnAppRequest, context: QdnViewContext | null) {
  const address = await getAddressForQdnRequest(request, context, 'Address');

  return `/groups/joinrequests/address/${encodeURIComponent(address)}`;
}

async function buildAdminGroupJoinRequestsPath(request: QdnAppRequest, context: QdnViewContext | null) {
  const address = await getAddressForQdnRequest(request, context, 'Address');

  return `/groups/joinrequests/admin/${encodeURIComponent(address)}`;
}

async function getAddressForQdnRequest(
  request: QdnAppRequest,
  context: QdnViewContext | null,
  label: string,
) {
  const requestedAddress = getString(getRequestValue(request, 'address'));

  if (requestedAddress) {
    return requestedAddress;
  }

  const selectedAccount = await getSelectedAccountForQdnApp(context);

  if (!selectedAccount.address) {
    throw new Error(`${label} is required.`);
  }

  return selectedAccount.address;
}

async function buildAccountGroupsPath(request: QdnAppRequest, context: QdnViewContext | null) {
  const address = await getAddressForQdnRequest(request, context, 'Address');
  const queryParams = new URLSearchParams();

  appendRequestQueryFields(queryParams, request, {
    adminOnly: 'adminOnly',
    ownerOnly: 'ownerOnly',
  });

  const queryString = queryParams.toString();

  return `/groups/member/${encodeURIComponent(address)}${queryString ? `?${queryString}` : ''}`;
}

function buildSearchChatMessagesPath(request: QdnAppRequest) {
  const queryParams = new URLSearchParams();
  const groupId = getInteger(getRequestValue(request, 'groupId') ?? getRequestValue(request, 'txGroupId'));

  if (typeof groupId === 'number') {
    if (groupId < 0) {
      throw new Error('Group id must be a non-negative integer.');
    }

    queryParams.set('txGroupId', String(groupId));
  }

  appendRequestQueryFields(queryParams, request, {
    after: 'after',
    before: 'before',
    chatReference: 'chatreference',
    encoding: 'encoding',
    hasChatReference: 'haschatreference',
    involving: 'involving',
    limit: 'limit',
    offset: 'offset',
    reverse: 'reverse',
    sender: 'sender',
  });

  return `/chat/messages?${queryParams.toString()}`;
}

function buildQortalChatMessagesPath(request: QdnAppRequest) {
  const queryParams = new URLSearchParams({ encoding: 'BASE64' });
  const groupId = getInteger(getRequestValue(request, 'groupId') ?? getRequestValue(request, 'txGroupId'));

  if (typeof groupId === 'number') {
    if (groupId < 0) {
      throw new Error('Group id must be a non-negative integer.');
    }

    queryParams.set('txGroupId', String(groupId));
  }

  appendRequestQueryFields(queryParams, request, {
    after: 'after',
    before: 'before',
    chatReference: 'chatreference',
    chatreference: 'chatreference',
    encoding: 'encoding',
    hasChatReference: 'haschatreference',
    haschatreference: 'haschatreference',
    limit: 'limit',
    offset: 'offset',
    reverse: 'reverse',
    sender: 'sender',
  });

  return `/chat/messages?${queryParams.toString()}`;
}

async function buildQortalTransactionsSearchPath(request: QdnAppRequest, context: QdnViewContext | null) {
  const address = await getAddressForQdnRequest(request, context, 'Address');
  const queryParams = new URLSearchParams({ address });

  appendRequestQueryFields(queryParams, request, {
    blockLimit: 'blockLimit',
    confirmationStatus: 'confirmationStatus',
    limit: 'limit',
    offset: 'offset',
    reverse: 'reverse',
    startBlock: 'startBlock',
    txGroupId: 'txGroupId',
    txType: 'txType',
    txTypes: 'txType',
  });

  if (!queryParams.has('confirmationStatus')) {
    queryParams.set('confirmationStatus', 'CONFIRMED');
  }

  return `/transactions/search?${queryParams.toString()}`;
}

async function buildActiveChatsPath(request: QdnAppRequest, context: QdnViewContext | null) {
  const address = await getAddressForQdnRequest(request, context, 'Address');
  const queryParams = new URLSearchParams();

  appendRequestQueryFields(queryParams, request, {
    encoding: 'encoding',
    hasChatReference: 'haschatreference',
  });

  const queryString = queryParams.toString();

  return `/chat/active/${encodeURIComponent(address)}${queryString ? `?${queryString}` : ''}`;
}

async function buildQortalActiveChatsPath(request: QdnAppRequest, context: QdnViewContext | null) {
  const address = await getAddressForQdnRequest(request, context, 'Address');
  const queryParams = new URLSearchParams({ encoding: 'BASE64' });

  appendRequestQueryFields(queryParams, request, {
    encoding: 'encoding',
    hasChatReference: 'haschatreference',
    haschatreference: 'haschatreference',
  });

  return `/chat/active/${encodeURIComponent(address)}?${queryParams.toString()}`;
}

function buildPrivateGroupChatKeyRequestBody(request: QdnAppRequest, privateKey58: string) {
  return {
    requesterPrivateKey: privateKey58,
    groupId: getRequiredGroupId(request, 1),
    // epochId/keyId are optional base58 byte[]; omitted => Core uses the current epoch.
    epochId: getOptionalBase58RequestString(request, 'epochId'),
    keyId: getOptionalBase58RequestString(request, 'keyId'),
  };
}

function buildPrivateGroupChatKeyRequestRecoveryBody(request: QdnAppRequest, privateKey58: string) {
  return {
    relayerPrivateKey: privateKey58,
    groupId: getRequiredGroupId(request, 1),
    limit: getOptionalIntegerRequestValue(request, 1, 'limit'),
  };
}

function buildPrivateGroupChatMessagesBody(request: QdnAppRequest, privateKey58: string) {
  const chatReference = getOptionalBase58RequestString(request, 'chatReference');

  return {
    recipientPrivateKey: privateKey58,
    groupId: getRequiredGroupId(request, 1),
    before: getInteger(getRequestValue(request, 'before')),
    after: getInteger(getRequestValue(request, 'after')),
    chatReference,
    hasChatReference: getBoolean(getRequestValue(request, 'hasChatReference')),
    sender: getString(getRequestValue(request, 'sender')) || undefined,
    encoding: getString(getRequestValue(request, 'encoding')) || undefined,
    limit: getInteger(getRequestValue(request, 'limit')),
    offset: getInteger(getRequestValue(request, 'offset')),
    reverse: getBoolean(getRequestValue(request, 'reverse')),
  };
}

function buildPrivateDirectChatMessagesBody(
  request: QdnAppRequest,
  privateKey58: string,
  otherAddress: string,
) {
  const chatReference = getOptionalBase58RequestString(request, 'chatReference');

  return {
    accountPrivateKey: privateKey58,
    otherAddress,
    before: getInteger(getRequestValue(request, 'before')),
    after: getInteger(getRequestValue(request, 'after')),
    chatReference,
    hasChatReference: getBoolean(getRequestValue(request, 'hasChatReference')),
    sender: getString(getRequestValue(request, 'sender')) || undefined,
    encoding: getString(getRequestValue(request, 'encoding')) || undefined,
    limit: getInteger(getRequestValue(request, 'limit')),
    offset: getInteger(getRequestValue(request, 'offset')),
    reverse: getBoolean(getRequestValue(request, 'reverse')),
  };
}

function applyQdnDisplaySettings(queryParams: URLSearchParams, context: QdnViewContext | null) {
  if (!context?.displaySettings) {
    return;
  }

  queryParams.set('theme', context.displaySettings.theme);
  queryParams.set('lang', context.displaySettings.language);
  queryParams.set('textSize', context.displaySettings.textSize);
  queryParams.set('accent', context.displaySettings.accent);
  queryParams.set('uiStyle', context.displaySettings.ui);
}

async function getQdnResourceUrl(request: QdnAppRequest, context: QdnViewContext | null) {
  const resource = getQdnAppResourceRequest(request);
  const status = await fetchNodeApiPayload(buildQdnResourceStatusPath(request), request);

  if (
    !isRecord(status) ||
    !status.status ||
    status.status === 'NOT_PUBLISHED'
  ) {
    throw new Error('Resource does not exist.');
  }

  const connection = await getNodeConnection();
  const { pathOnly, queryString } = splitPathAndQuery(resource.path);
  const encodedPath = getEncodedResourcePath(pathOnly);
  const identifierSegment = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams(queryString);

  applyQdnDisplaySettings(queryParams, context);

  const renderQueryString = queryParams.toString();

  return `${connection.nodeApiUrl}/render/${resource.service}/${encodeURIComponent(resource.name)}${identifierSegment}${
    encodedPath ? `/${encodedPath}` : ''
  }${renderQueryString ? `?${renderQueryString}` : ''}`;
}

async function getQdnResourceStreamUrl(request: QdnAppRequest, context: QdnViewContext | null) {
  getQdnResourceStreamRequest(request);

  return getQdnResourceUrl(request, context);
}

function getRequiredListName(request: QdnAppRequest) {
  const listName = getRequiredRequestString(request, 'listName', 'List name');

  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(listName)) {
    throw new Error('List name must start with a letter and contain only letters, numbers, or underscores.');
  }

  return listName;
}

function getRequiredListItems(request: QdnAppRequest) {
  const items = getRequestValue(request, 'items');

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Items must be a non-empty array.');
  }

  const itemStrings = items.map(getString).filter(Boolean);

  if (itemStrings.length === 0) {
    throw new Error('Items must contain at least one non-empty string.');
  }

  return itemStrings;
}

async function getAllListsForApp() {
  const connection = await getNodeConnection();

  assertLocalWriteConnection(connection);

  const apiKey = getNodeApiKey(connection);
  const response = await fetchNode(
    '/lists',
    { headers: { 'X-API-KEY': apiKey } },
    connection.nodeApiUrl,
  );
  const result = await readNodeApiResponse(response, connection, QDN_APP_DEFAULT_MAX_BYTES);

  if (!result.ok) {
    throw getNodeApiResponseError(result, `Failed to get lists with HTTP ${result.status}.`);
  }

  return result.data;
}

async function getListForApp(request: QdnAppRequest) {
  const listName = getRequiredListName(request);
  const connection = await getNodeConnection();

  assertLocalWriteConnection(connection);

  const apiKey = getNodeApiKey(connection);
  const response = await fetchNode(
    `/lists/${encodeURIComponent(listName)}`,
    { headers: { 'X-API-KEY': apiKey } },
    connection.nodeApiUrl,
  );
  const result = await readNodeApiResponse(response, connection, QDN_APP_DEFAULT_MAX_BYTES);

  if (response.status === 404) {
    return [];
  }

  if (!result.ok) {
    throw getNodeApiResponseError(result, `Failed to get list with HTTP ${result.status}.`);
  }

  return result.data;
}

async function handleQdnAppRequest(
  value: unknown,
  context: QdnViewContext | null,
  sender: WebContents,
) {
  if (!isRecord(value)) {
    throw new Error('QDN app requests must be objects.');
  }

  const request: QdnAppRequest = value;
  const action = getString(request.action).toUpperCase();

  if (!action) {
    throw new Error('QDN app request action is required.');
  }

  if (isQdnAccountFreeWriteAction(action)) {
    return handleQdnAccountFreeWriteAction(action, request, context, sender);
  }

  if ((QDN_HOME_SETTINGS_ACTIONS as readonly string[]).includes(action)) {
    return handleQdnHomeSettingsAction(action as QdnHomeSettingsAction, request, context, sender);
  }

  if ((QDN_APP_ASSIGNMENT_ACTIONS as readonly string[]).includes(action)) {
    return handleQdnAppAssignmentAction(action as QdnAppAssignmentAction, request, context, sender);
  }

  if ((QDN_BOOKMARK_MANAGER_ACTIONS as readonly string[]).includes(action)) {
    return handleQdnBookmarkManagerAction(action as QdnBookmarkManagerAction, request, context, sender);
  }

  if ((QDN_NOTIFICATION_MANAGER_ACTIONS as readonly string[]).includes(action)) {
    return handleQdnNotificationManagerAction(action as QdnNotificationManagerAction, request, context, sender);
  }

  switch (action) {
    case 'FETCH_NODE_API': {
      const apiPath = getNodeApiPath(getRequestValue(request, 'path'), 'http://127.0.0.1');
      const method = getReadOnlyMethod(getRequestValue(request, 'method'));

      return fetchConfiguredNodeApi(apiPath, getQdnAppMaxBytes(getRequestValue(request, 'maxBytes')), method);
    }

    case 'FETCH_QORTAL_NODE_API': {
      const apiPath = getNodeApiPath(getRequestValue(request, 'path'), 'http://127.0.0.1');
      const method = getReadOnlyMethod(getRequestValue(request, 'method'));

      return fetchQortalNodeApi(apiPath, getQdnAppMaxBytes(getRequestValue(request, 'maxBytes')), method);
    }

    case 'GET_ASSET_INFO':
      return fetchNodeApiPayload(getAssetInfoPath(request), request);

    case 'GET_ASSET_BALANCES':
      return fetchNodeApiPayload(getAssetBalancesPath(request), request);

    case 'GET_ASSET_TRANSFERS':
      return fetchNodeApiPayload(getAssetTransfersPath(request), request);

    case 'GET_NODE_INFO':
      return fetchNodeApiPayload('/admin/info', request);

    case 'GET_HOST_INFO': {
      const hostVersion = app.getVersion();

      return {
        hostName: 'qortium-home',
        hostVersion,
        platformVersion: getPlatformVersion(hostVersion) ?? hostVersion,
        // Additive: lets apps adapt density/layout to the host form factor.
        platform: 'desktop' as const,
      };
    }

    case 'GET_NODE_SETTINGS_METADATA':
      return fetchNodeApiPayload('/admin/settings/metadata', request);

    case 'GET_NODE_STATUS':
      return fetchNodeApiPayload('/admin/status', request);

    case 'GET_ACCOUNT_DATA':
      return fetchNodeApiPayload(`/addresses/${encodeURIComponent(await getAddressForQdnRequest(request, context, 'Address'))}`, request);

    case 'GET_ACCOUNT_GROUPS':
      return fetchNodeApiPayload(await buildAccountGroupsPath(request, context), request);

    case 'GET_ACCOUNT_GROUP_JOIN_REQUESTS':
      return fetchNodeApiPayload(await buildAccountGroupJoinRequestsPath(request, context), request);

    case 'GET_ACCOUNT_NAMES':
      return fetchNodeApiPayload(`/names/address/${encodeURIComponent(await getAddressForQdnRequest(request, context, 'Address'))}`, request);

    case 'GET_SELECTED_ACCOUNT':
      return getSelectedAccountForQdnApp(context);

    case 'RESOLVE_IDENTITIES':
      return resolveIdentitiesForQdnApp(request);

    case 'UNLOCK_SELECTED_ACCOUNT':
      return unlockSelectedAccountForQdnApp(context);

    case 'GET_BALANCE':
      return fetchNodeApiPayload(
        getAccountBalancePath(await getAddressForQdnRequest(request, context, 'Address'), request),
        request,
      );

    case 'GET_QORT_BALANCE':
      return fetchQortalNodeApiPayload(`/addresses/balance/${encodeURIComponent(await getAddressForQdnRequest(request, context, 'Address'))}`, request);

    case 'GET_QORTAL_PRIMARY_NAME':
      return getQortalPrimaryNameForApp(request, context);

    case 'GET_QORTAL_ACCOUNT_GROUPS':
      return fetchQortalNodeApiPayload(
        buildQortalAccountGroupsPath(await getAddressForQdnRequest(request, context, 'Address')),
        request,
      );

    case 'GET_QORTAL_ACCOUNT_NAMES':
      return fetchQortalNodeApiPayload(`/names/address/${encodeURIComponent(await getAddressForQdnRequest(request, context, 'Address'))}`, request);

    case 'GET_QORTAL_NAME_DATA':
      return getQortalNameDataForApp(request);

    case 'GET_QORTAL_NODE_STATUS':
      return fetchQortalNodeApiPayload('/admin/status', request);

    case 'SEND_QORT':
      return sendQortForApp(request, context, sender);

    case 'SEND_QORTAL_GROUP_CHAT':
      return sendQortalGroupChatForApp(request, context, sender);

    case 'GET_QORTAL_TRANSACTION':
      return getQortalTransactionForApp(request);

    case 'SEARCH_QORTAL_TRANSACTIONS':
      return fetchQortalNodeApiPayload(await buildQortalTransactionsSearchPath(request, context), request);

    case 'GET_QORTAL_ACTIVE_CHATS':
      return fetchQortalNodeApiPayload(await buildQortalActiveChatsPath(request, context), request);

    case 'GET_QORTAL_CHAT_MESSAGE':
      return getQortalChatMessageForApp(request);

    case 'GET_QORTAL_CHAT_MESSAGES':
      return fetchQortalNodeApiPayload(buildQortalChatMessagesPath(request), request);

    case 'GET_CROSSCHAIN_BLOCKCHAINS':
      return getCrosschainBlockchainsForApp(request);

    case 'GET_MARKET_PRICES':
      return getMarketPricesForApp(request);

    case 'GET_CROSSCHAIN_SERVER_INFO':
      return getCrosschainServerInfoForApp(request);

    case 'GET_FOREIGN_FEE':
      return getForeignFeeForApp(request);

    case 'GET_SERVER_CONNECTION_HISTORY':
      return getServerConnectionHistoryForApp(request);

    case 'GET_USER_WALLET':
      return getUserForeignWalletForApp(request, context);

    case 'GET_WALLET_BALANCE':
      return postForeignWalletReadForApp(request, context, 'walletbalance');

    case 'GET_USER_WALLET_INFO':
      return postForeignWalletReadForApp(request, context, 'addressinfos');

    case 'GET_USER_WALLET_TRANSACTIONS':
      return postForeignWalletReadForApp(request, context, 'wallettransactions');

    case 'GET_GROUP':
      return fetchNodeApiPayload(
        `/groups/${encodeURIComponent(String(getRequiredGroupId(request, 1)))}`,
        request,
      );

    case 'GET_ADMIN_GROUP_JOIN_REQUESTS':
      return fetchNodeApiPayload(await buildAdminGroupJoinRequestsPath(request, context), request);

    case 'GET_GROUP_BANS':
      return fetchNodeApiPayload(buildGroupBansPath(request), request);

    case 'GET_GROUP_JOIN_REQUESTS':
      return fetchNodeApiPayload(buildGroupJoinRequestsPath(request), request);

    case 'GET_GROUP_KICKS':
      return fetchNodeApiPayload(buildGroupKicksPath(request), request);

    case 'GET_GROUP_MEMBERS':
      return fetchNodeApiPayload(buildGroupMembersPath(request), request);

    case 'GET_MEMBER_BANS':
      return fetchNodeApiPayload(await buildMemberBansPath(request, context), request);

    case 'GET_MEMBER_KICKS':
      return fetchNodeApiPayload(await buildMemberKicksPath(request, context), request);

    case 'GET_MINTING_STATUS':
      return getMintingStatusForApp(request, context);

    case 'GET_NAME_DATA':
      return fetchNodeApiPayload(
        `/names/${encodeURIComponent(getRequiredRequestString(request, 'name', 'Name'))}`,
        request,
      );

    case 'GET_QDN_RESOURCE_METADATA':
      return fetchNodeApiPayload(buildQdnResourceMetadataPath(request), request);

    case 'GET_QDN_RESOURCE_PROPERTIES':
      return fetchNodeApiPayload(buildQdnResourcePropertiesPath(request), request);

    case 'GET_QDN_RESOURCE_STATUS':
      return fetchNodeApiPayload(buildQdnResourceStatusPath(request), request);

    case 'GET_QDN_RESOURCE_STREAM_URL':
      return getQdnResourceStreamUrl(request, context);

    case 'GET_QDN_RESOURCE_URL':
      return getQdnResourceUrl(request, context);

    case 'FETCH_QDN_RESOURCE':
      return fetchNodeApiPayload(buildFetchQdnResourcePath(request), request);

    case 'FETCH_ACCOUNT_AVATAR':
      return fetchAccountAvatarForApp(request, context);

    case 'FETCH_GROUP_AVATAR':
      return fetchGroupAvatarForApp(request);

    case 'LIST_QDN_RESOURCES':
      return fetchNodeApiPayload(buildQdnResourcesPath(request, '/arbitrary/resources'), request);

    case 'SEARCH_QDN_RESOURCES':
      return fetchNodeApiPayload(buildQdnResourcesPath(request, '/arbitrary/resources/search'), request);

    case 'FETCH_QORTAL_RESOURCE':
      return fetchQortalResourceBinary(request);

    case 'GET_QORTAL_RESOURCE_METADATA':
      return fetchQortalNodeApiPayload(buildQortalMetadataPath(request), request);

    case 'GET_QORTAL_RESOURCE_STATUS':
      return fetchQortalNodeApiPayload(buildQortalStatusPath(request), request);

    case 'GET_QORTAL_RESOURCE_URL':
      return getQortalResourceUrl(request);

    case 'SEARCH_QORTAL_RESOURCES':
      return fetchQortalNodeApiPayload(buildQdnResourcesPath(request, '/arbitrary/resources/search'), request);

    case 'LIST_GROUPS':
      return fetchNodeApiPayload(buildGroupsPath(request), request);

    case 'SEARCH_GROUPS':
      return fetchNodeApiPayload(buildSearchGroupsPath(request), request);

    case 'SEARCH_CHAT_MESSAGES':
      return fetchNodeApiPayload(buildSearchChatMessagesPath(request), request);

    case 'GET_ACTIVE_CHATS':
      return fetchNodeApiPayload(await buildActiveChatsPath(request, context), request);

    case 'GET_PRIVATE_DIRECT_ACTIVE_CHATS':
      return getPrivateDirectActiveChatsForApp(request, context);

    case 'GET_PRIVATE_GROUP_ACTIVE_CHATS':
      return getPrivateGroupActiveChatsForApp(request, context);

    case 'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES':
      return searchPrivateDirectChatMessagesForApp(request, context);

    case 'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES':
      return searchPrivateGroupChatMessagesForApp(request, context);

    case 'REQUEST_PRIVATE_GROUP_CHAT_KEY':
      return requestPrivateGroupChatKeyForApp(request, context, sender);

    case 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS':
      return resolvePrivateGroupChatKeyRequestsForApp(request, context, sender);

    case 'PUBLISH_QDN_RESOURCE':
      return publishQdnResourceForApp(request, context, sender);

    case 'SELECT_QDN_PUBLISH_SOURCE':
      return selectQdnPublishSourceForApp(request, context as QdnViewContext);

    case 'PREVIEW_QDN_PUBLISH_SOURCE':
      return previewQdnPublishSourceForApp(request, context as QdnViewContext);

    case 'PUBLISH_MULTIPLE_QDN_RESOURCES':
      return publishMultipleQdnResourcesForApp(request, context, sender);

    case 'DELETE_QDN_RESOURCE':
      return deleteQdnResourceForApp(request, context, sender);

    case 'JOIN_GROUP':
      return joinGroupForApp(request, context, sender);

    case 'START_MINTING':
      return startMintingForApp(context, sender);

    case 'REMOVE_MINTING_ACCOUNT':
      return removeMintingAccountForApp(request, context, sender);

    case 'APPROVE_GROUP_JOIN_REQUEST':
      return approveGroupJoinRequestForApp(request, context, sender);

    case 'GROUP_APPROVAL':
      return requestGroupApprovalForApp(request, context, sender);

    case 'INVITE_TO_GROUP':
      return inviteToGroupForApp(request, context, sender);

    case 'LEAVE_GROUP':
      return leaveGroupForApp(request, context, sender);

    case 'UPDATE_GROUP':
      return updateGroupForApp(request, context, sender);

    case 'SET_GROUP_AVATAR':
      return setGroupAvatarForApp(request, context, sender);

    case 'SET_ACCOUNT_AVATAR':
      return setAccountAvatarForApp(request, context, sender);

    case 'CREATE_GROUP':
      return createGroupForApp(request, context, sender);

    case 'ADD_GROUP_ADMIN':
      return addGroupAdminForApp(request, context, sender);

    case 'REMOVE_GROUP_ADMIN':
      return removeGroupAdminForApp(request, context, sender);

    case 'GROUP_BAN':
      return banFromGroupForApp(request, context, sender);

    case 'CANCEL_GROUP_BAN':
      return cancelGroupBanForApp(request, context, sender);

    case 'GROUP_KICK':
      return kickFromGroupForApp(request, context, sender);

    case 'CANCEL_GROUP_INVITE':
      return cancelGroupInviteForApp(request, context, sender);

    case 'SET_GROUP':
      return setDefaultGroupForApp(request, context, sender);

    case 'PAYMENT':
      return sendCoinForApp(request, context, sender, 'PAYMENT');

    case 'SEND_COIN':
      return sendCoinForApp(request, context, sender, 'SEND_COIN');

    case 'TRANSFER_ASSET':
      return transferAssetForApp(request, context, sender);

    case 'SET_CURRENT_FOREIGN_SERVER':
      return setCurrentForeignServerForApp(request, context, sender);

    case 'CREATE_POLL':
      return createPollForApp(request, context, sender);

    case 'VOTE_ON_POLL':
      return voteOnPollForApp(request, context, sender);

    case 'UPDATE_POLL':
      return updatePollForApp(request, context, sender);

    case 'RATE_ACCOUNT':
      return rateAccountForApp(request, context, sender);

    case 'RATE_RESOURCE':
      return rateResourceForApp(request, context, sender);

    case 'GET_RESOURCE_RATING':
      return getResourceRatingForApp(request, context);

    case 'GET_ACCOUNT_RATING':
      return getAccountRatingForApp(request, context);

    case 'REGISTER_NAME':
      return registerNameForApp(request, context, sender);

    case 'UPDATE_NAME':
      return updateNameForApp(request, context, sender);

    case 'SELL_NAME':
      return sellNameForApp(request, context, sender);

    case 'CANCEL_SELL_NAME':
      return cancelSellNameForApp(request, context, sender);

    case 'BUY_NAME':
      return buyNameForApp(request, context, sender);

    case 'SEND_CHAT_MESSAGE':
      return sendChatMessageForApp(request, context, sender);

    case 'SEND_MESSAGE':
      return sendMessageForApp(request, context, sender);

    case 'IS_USING_PUBLIC_NODE': {
      const connection = await getNodeConnection();

      return connection.mode === 'network';
    }

    case 'OPEN_NEW_TAB': {
      const address =
        getString(getRequestValue(request, 'address')) || getString(getRequestValue(request, 'qdnUrl'));

      if (!address) {
        throw new Error('Address is required.');
      }

      if (!/^(qdn|home|core):\/\//i.test(address)) {
        throw new Error('OPEN_NEW_TAB only accepts qdn://, home://, and core:// addresses.');
      }

      if (address.length > QDN_OPEN_NEW_TAB_URL_MAX_LENGTH) {
        throw new Error('Address is too long.');
      }

      const hostWindow = context ? getQdnViewHostWindow(context) : null;

      if (!context || !hostWindow) {
        throw new Error('QDN open new tab request does not belong to an active window.');
      }

      hostWindow.webContents.send('qdn-app:open-new-tab', {
        address,
        sourceTabId: context.tabId,
      });

      return true;
    }

    case 'OPEN_CURRENT_TAB': {
      const address =
        getString(getRequestValue(request, 'address')) || getString(getRequestValue(request, 'qdnUrl'));

      if (!address) {
        throw new Error('Address is required.');
      }

      if (!/^(qdn|home|core):\/\//i.test(address)) {
        throw new Error('OPEN_CURRENT_TAB only accepts qdn://, home://, and core:// addresses.');
      }

      if (address.length > QDN_OPEN_NEW_TAB_URL_MAX_LENGTH) {
        throw new Error('Address is too long.');
      }

      const hostWindow = context ? getQdnViewHostWindow(context) : null;

      if (!context || !hostWindow) {
        throw new Error('QDN navigate current tab request does not belong to an active window.');
      }

      hostWindow.webContents.send('qdn-app:open-current-tab', {
        address,
        sourceTabId: context.tabId,
      });

      return true;
    }

    case 'OPEN_QDN_MEDIA_PLAYER': {
      const service = getRequiredRequestString(request, 'service', 'Service').toUpperCase();

      if (!QDN_MEDIA_PLAYER_SERVICES.has(service)) {
        throw new Error('OPEN_QDN_MEDIA_PLAYER only supports AUDIO, VOICE, PODCAST, and VIDEO resources.');
      }

      const name = getRequiredRequestString(request, 'name', 'Name');
      const identifier = getString(getRequestValue(request, 'identifier'));
      const resourcePath = getString(getRequestValue(request, 'path'));

      if (
        name.length > QDN_MEDIA_PLAYER_FIELD_MAX_LENGTH ||
        identifier.length > QDN_MEDIA_PLAYER_FIELD_MAX_LENGTH ||
        resourcePath.length > QDN_MEDIA_PLAYER_FIELD_MAX_LENGTH
      ) {
        throw new Error('QDN media player request fields are too long.');
      }

      const hostWindow = context ? getQdnViewHostWindow(context) : null;

      if (!context || !hostWindow) {
        throw new Error('QDN media player request does not belong to an active window.');
      }

      hostWindow.webContents.send('qdn-app:open-media-player', {
        identifier: identifier || null,
        name,
        path: resourcePath || null,
        service,
      });

      return true;
    }

    case 'OPEN_QDN_DOCUMENT_VIEWER': {
      const service = getRequiredRequestString(request, 'service', 'Service').toUpperCase();

      if (!QDN_DOCUMENT_VIEWER_SERVICES.has(service)) {
        throw new Error('OPEN_QDN_DOCUMENT_VIEWER only supports DOCUMENT, FILE, FILES, and ATTACHMENT resources.');
      }

      const name = getRequiredRequestString(request, 'name', 'Name');
      const identifier = getString(getRequestValue(request, 'identifier'));
      const resourcePath = getString(getRequestValue(request, 'path'));
      const filename = getString(getRequestValue(request, 'filename'));
      const mimeType = getString(getRequestValue(request, 'mimeType'));

      if (
        name.length > QDN_MEDIA_PLAYER_FIELD_MAX_LENGTH ||
        identifier.length > QDN_MEDIA_PLAYER_FIELD_MAX_LENGTH ||
        resourcePath.length > QDN_MEDIA_PLAYER_FIELD_MAX_LENGTH ||
        filename.length > QDN_MEDIA_PLAYER_FIELD_MAX_LENGTH ||
        mimeType.length > QDN_MEDIA_PLAYER_FIELD_MAX_LENGTH
      ) {
        throw new Error('QDN document viewer request fields are too long.');
      }

      const hostWindow = context ? getQdnViewHostWindow(context) : null;

      if (!context || !hostWindow) {
        throw new Error('QDN document viewer request does not belong to an active window.');
      }

      hostWindow.webContents.send('qdn-app:open-document-viewer', {
        identifier: identifier || null,
        name,
        path: resourcePath || null,
        service,
        filename: filename || null,
        mimeType: mimeType || null,
      });

      return true;
    }

    case 'OPEN_QDN_RESOURCE_VIEWER': {
      const resource = getQdnResourceViewerRequest(request);
      const hostWindow = context ? getQdnViewHostWindow(context) : null;

      if (!context || !hostWindow) {
        throw new Error('QDN resource viewer request does not belong to an active window.');
      }

      hostWindow.webContents.send('qdn-app:open-resource-viewer', {
        ...resource,
        sourceTabId: context.tabId,
      });

      return true;
    }

    case 'GET_ALL_LISTS':
      return getAllListsForApp();

    case 'GET_LIST':
      return getListForApp(request);

    case 'SAVE_QDN_RESOURCE': {
      const resource = getQdnAppResourceRequest(request);
      const rawFilename = getString(getRequestValue(request, 'filename')) ||
        `${resource.service}_${resource.name}_${resource.identifier ?? 'default'}`;
      const filename = sanitizeFilename(rawFilename);
      const hostWindow = context ? getQdnViewHostWindow(context) : null;
      const saveDialogOptions = {
        title: 'Save QDN Resource',
        defaultPath: getDefaultDownloadPath(filename),
      };
      const result = hostWindow
        ? await dialog.showSaveDialog(hostWindow, saveDialogOptions)
        : await dialog.showSaveDialog(saveDialogOptions);
      if (result.canceled || !result.filePath) return { canceled: true };
      const response = await fetchConfiguredRawResource(resource, false);
      writeFileSync(result.filePath, Buffer.from(await response.arrayBuffer()));
      return { canceled: false };
    }

    case 'SHOW_NOTIFICATION':
      return showNotificationForApp(request, context);

    case 'NOTIFICATION_HAS_PERMISSION': {
      if (!context) throw new Error('QDN app notification request does not belong to an active window.');
      return { granted: hasNotificationGrant(getQdnNotificationPermissionCacheKey(context)) };
    }

    case 'NOTIFICATION_ADD': {
      if (!context) throw new Error('QDN app notification request does not belong to an active window.');
      const appKey = getQdnNotificationPermissionCacheKey(context);
      const accountAddress = getActiveAccountAddress();
      const subscriptions = sanitizeQdnNotificationSubscriptions(
        getRequestValue(request, 'subscriptions'),
        sanitizeAppTitle,
      );
      await requestQdnNotificationPermissionApproval(context, 'NOTIFICATION_ADD');
      if (getActiveAccountAddress() !== accountAddress) {
        throw new Error('The active account changed while notification permission was being approved. Please try again.');
      }
      return replaceAppNotificationRules(appKey, subscriptions, accountAddress);
    }

    case 'NOTIFICATION_GET': {
      if (!context) throw new Error('QDN app notification request does not belong to an active window.');
      return readNotificationStore().rules[getQdnNotificationPermissionCacheKey(context)] ?? [];
    }

    case 'NOTIFICATION_REMOVE': {
      if (!context) throw new Error('QDN app notification request does not belong to an active window.');
      const notificationIds = sanitizeQdnNotificationIds(getRequestValue(request, 'notificationIds'));
      // This only removes the calling app's own rules, so it is deliberately
      // unprompted: the action reduces an existing app-scoped capability.
      return removeAppNotificationRules(getQdnNotificationPermissionCacheKey(context), notificationIds);
    }

    case 'WHICH_UI':
      return 'QORTIUM_HOME_ELECTRON';

    case 'SHOW_ACTIONS': {
      // On a public/network node, only report actions that can actually succeed
      // there, so apps that gate UI off SHOW_ACTIONS don't show controls (e.g.
      // RATE_ACCOUNT) that would throw for lack of a local write connection.
      const connection = await getNodeConnection();

      if (connection.mode !== 'network') return [...QDN_APP_BRIDGE_ACTIONS];

      try {
        await getPublicPollCapabilities(connection);
        return [...QDN_PUBLIC_NODE_BRIDGE_ACTIONS, ...QDN_POLL_ACTIONS];
      } catch {
        return [...QDN_PUBLIC_NODE_BRIDGE_ACTIONS];
      }
    }

    default:
      throw new Error(`${action || 'This'} QDN app request is not supported yet.`);
  }
}

export function registerQdnIpcHandlers() {
  ipcMain.handle('qdn-app:request', async (event, request: unknown) => {
    try {
      const context = getQdnViewContextForWebContents(event.sender);

      if (!context) {
        throw new Error('QDN app requests are only available to isolated QDN app views.');
      }

      return encodeQdnBridgeResult(await handleQdnAppRequest(request, context, event.sender));
    } catch (error) {
      return encodeQdnBridgeError(error);
    }
  });

  ipcMain.handle('qdn-app:resolveWriteApproval', (event, rawResponse: unknown) => {
    const response = sanitizeQdnWriteApprovalResponse(rawResponse);
    const pendingApproval = pendingQdnWriteApprovals.get(response.requestId);

    if (!pendingApproval) {
      return;
    }

    if (pendingApproval.windowWebContentsId !== event.sender.id) {
      throw new Error('QDN write request response came from the wrong window.');
    }

    pendingApproval.resolve(response.approved);
  });

  ipcMain.handle('qdn-app:resolveHomeSettingsRequest', (event, rawResponse: unknown) => {
    if (!isRecord(rawResponse) || typeof rawResponse.requestId !== 'string' || !rawResponse.requestId) {
      throw new Error('QDN Home settings request response is required.');
    }
    const pendingRequest = pendingQdnHomeSettingsRequests.get(rawResponse.requestId);
    if (!pendingRequest) return;
    if (pendingRequest.windowWebContentsId !== event.sender.id) {
      throw new Error('QDN Home settings response came from the wrong window.');
    }
    try {
      pendingRequest.resolve(validateHomeSettings(rawResponse.settings));
    } catch (error) {
      pendingRequest.reject(error instanceof Error ? error : new Error('Invalid Home settings response.'));
    }
  });

  ipcMain.handle('qdn-app:resolveBookmarkManagerRequest', (event, rawResponse: unknown) => {
    if (!isRecord(rawResponse) || typeof rawResponse.requestId !== 'string' || !rawResponse.requestId) {
      throw new Error('QDN bookmark manager response is required.');
    }
    const pendingRequest = pendingQdnBookmarkManagerRequests.get(rawResponse.requestId);
    if (!pendingRequest) return;
    if (pendingRequest.windowWebContentsId !== event.sender.id) {
      throw new Error('QDN bookmark manager response came from the wrong window.');
    }
    if (typeof rawResponse.error === 'string' && rawResponse.error.trim()) {
      pendingRequest.reject(qdnCodedError(
        typeof rawResponse.code === 'string' && rawResponse.code ? rawResponse.code : 'HOME_DATA_ERROR',
        rawResponse.error.trim(),
      ));
      return;
    }
    try {
      if (pendingRequest.operation === 'get') {
        pendingRequest.resolve(validateBookmarkManagerSnapshot(rawResponse.result));
        return;
      }
      if (!isRecord(rawResponse.result) || typeof rawResponse.result.changed !== 'boolean') {
        throw new Error('Bookmark manager mutation result is invalid.');
      }
      pendingRequest.resolve({
        changed: rawResponse.result.changed,
        snapshot: validateBookmarkManagerSnapshot(rawResponse.result.snapshot),
      });
    } catch (error) {
      pendingRequest.reject(error instanceof Error ? error : new Error('Invalid bookmark manager response.'));
    }
  });

  ipcMain.handle('qdn:setAppNotificationsEnabled', (_event, enabled: unknown) => {
    setQdnAppNotificationsEnabled(enabled === true);
  });

  ipcMain.handle('qdn:authorizeResource', async (_event, request: QdnAuthorizeResourceRequest) => {
    const { service, name, identifier } = getAuthorizeRequest(request);
    let connection = await getNodeConnection();

    if (connection.mode === 'network') {
      return {
        authorized: true,
        nodeApiUrl: connection.nodeApiUrl,
      };
    }

    connection = await authorizeResource(service, name, identifier, connection);

    return {
      authorized: true,
      nodeApiUrl: connection.nodeApiUrl,
    };
  });

  ipcMain.handle('qdn:listResources', async (_event, request: QdnResourcesSearchRequest) => {
    const { connection, response } = await fetchConfiguredNode(buildResourcesSearchPath(request));
    const text = await response.text();

    if (!response.ok) {
      if (response.status === 403 && connection.mode === 'network') {
        throw networkRestrictionError();
      }

      throw new Error(readableNodeErrorMessage(text, `Qortium node request failed with HTTP ${response.status}.`));
    }

    return text ? (JSON.parse(text) as unknown) : null;
  });

  ipcMain.handle('qdn:searchNames', async (_event, request: QdnNamesSearchRequest) => {
    // Guard against an empty query, which would list every registered name.
    if (!getString(request.query)) {
      return [];
    }

    const { connection, response } = await fetchConfiguredNode(buildNamesSearchPath(request));
    const text = await response.text();

    if (!response.ok) {
      if (response.status === 403 && connection.mode === 'network') {
        throw networkRestrictionError();
      }

      throw new Error(readableNodeErrorMessage(text, `Qortium node request failed with HTTP ${response.status}.`));
    }

    return text ? (JSON.parse(text) as unknown) : null;
  });

  ipcMain.handle('qdn:fetchNodeApi', async (_event, request: NodeApiRequest) => {
    const apiPath = getNodeApiPath(request.path, 'http://127.0.0.1');
    const maxBytes = Math.max(0, Math.floor(getNumber(request.maxBytes) ?? 0));
    const method = getReadOnlyMethod(request.method);
    const { connection, response } = await fetchConfiguredNode(apiPath, { method });
    const contentLength = getContentLength(response);
    const contentType = response.headers.get('content-type') ?? '';

    if (maxBytes > 0 && typeof contentLength === 'number' && contentLength > maxBytes) {
      await response.body?.cancel();

      return {
        contentLength,
        contentType,
        status: response.status,
        statusText: response.statusText,
        tooLarge: true,
      };
    }

    const rawBody = method === 'HEAD' ? '' : await response.text();
    const networkRestricted = response.status === 403 && connection.mode === 'network';
    const body = networkRestricted ? getNetworkRestrictionMessage() : rawBody;
    const bodyLength = Buffer.byteLength(body, 'utf8');

    if (maxBytes > 0 && bodyLength > maxBytes) {
      return {
        contentLength: bodyLength,
        contentType,
        status: response.status,
        statusText: response.statusText,
        tooLarge: true,
      };
    }

    return {
      body,
      contentLength: contentLength ?? bodyLength,
      contentType,
      ...(networkRestricted ? { code: 'PUBLIC_NODE_READ_ONLY' } : {}),
      status: response.status,
      statusText: response.statusText,
      tooLarge: false,
    };
  });

  ipcMain.handle('qdn:fetchResourceText', async (_event, request: QdnRawResourceRequest) => {
    const resource = getRawResourceRequest(request);
    const maxBytes = Math.max(0, Math.floor(getNumber(request.maxBytes) ?? 0));
    const response = await fetchConfiguredRawResource(resource);
    const contentLength = getContentLength(response);
    const contentType = response.headers.get('content-type') ?? '';

    if (maxBytes > 0 && typeof contentLength === 'number' && contentLength > maxBytes) {
      await response.body?.cancel();

      return {
        contentLength,
        contentType,
        tooLarge: true,
      };
    }

    const content = await response.text();

    if (maxBytes > 0 && Buffer.byteLength(content, 'utf8') > maxBytes) {
      return {
        contentLength: Buffer.byteLength(content, 'utf8'),
        contentType,
        tooLarge: true,
      };
    }

    return {
      content,
      contentLength,
      contentType,
      tooLarge: false,
    };
  });

  ipcMain.handle('qdn:fetchResourceData', async (_event, request: QdnRawResourceRequest) => {
    const resource = getRawResourceRequest(request);
    const maxBytes = Math.max(0, Math.floor(getNumber(request.maxBytes) ?? 0));
    let response: Response;

    try {
      response = await fetchConfiguredRawResource(resource);
    } catch (error) {
      if (getBoolean(request.allowMissing) === true && error instanceof QdnFileNotFoundError) {
        return {
          data: '',
          contentLength: 0,
          contentType: '',
          missing: true,
          tooLarge: false,
        };
      }

      throw error;
    }

    const contentLength = getContentLength(response);
    const contentType = response.headers.get('content-type') ?? '';

    if (maxBytes > 0 && typeof contentLength === 'number' && contentLength > maxBytes) {
      await response.body?.cancel();

      return {
        data: '',
        contentLength,
        contentType,
        tooLarge: true,
      };
    }

    const arrayBuffer = await response.arrayBuffer();

    if (maxBytes > 0 && arrayBuffer.byteLength > maxBytes) {
      return {
        data: '',
        contentLength: arrayBuffer.byteLength,
        contentType,
        tooLarge: true,
      };
    }

    return {
      data: Buffer.from(arrayBuffer).toString('base64'),
      contentLength: contentLength ?? arrayBuffer.byteLength,
      contentType,
    };
  });

  ipcMain.handle('qdn:prepareArchiveRender', async (_event, request: QdnRawResourceRequest) => {
    const resource = getRawResourceRequest(request);

    if (!isQdnBrowserArchiveService(resource.service)) {
      throw new Error('Only QDN APP, WEBSITE, and browser-deliverable GAME archives can be rendered inline.');
    }

    const response = await fetchConfiguredRawResource(resource);
    const archiveBuffer = Buffer.from(await response.arrayBuffer());
    const entryPoint = await fetchResourceEntryPoint(resource);

    return prepareQdnArchiveRender(resource, archiveBuffer, entryPoint);
  });

  ipcMain.handle('qdn:previewContent', async (event, request: QdnPreviewContentRequest) => {
    const { kind, sourcePath: requestedPath } = getQdnPreviewContentRequest(request);
    let sourcePath = requestedPath;

    if (!sourcePath) {
      const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const dialogOptions = {
        buttonLabel: 'Preview',
        properties: [kind === 'directory' ? ('openDirectory' as const) : ('openFile' as const)],
        title: 'Select Preview Content',
      };
      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);

      if (result.canceled || result.filePaths.length === 0) {
        return {
          canceled: true,
        };
      }

      sourcePath = result.filePaths[0];
    }

    const preview = await renderQdnPreviewSource(sourcePath);

    return {
      canceled: false,
      ...preview,
      sourceName: path.basename(sourcePath),
      sourcePath,
    };
  });

  ipcMain.handle('qdn:downloadResource', async (event, request: QdnRawResourceRequest) => {
    const resource = getRawResourceRequest(request);
    const multiFile = getBoolean(request.multiFile) === true;
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const saveDialogOptions = {
      title: 'Save QDN Resource',
      defaultPath: getDefaultDownloadPath(getSuggestedFilename(request, resource)),
    };
    const result = parentWindow
      ? await dialog.showSaveDialog(parentWindow, saveDialogOptions)
      : await dialog.showSaveDialog(saveDialogOptions);

    if (result.canceled || !result.filePath) {
      return {
        canceled: true,
      };
    }

    // Multi-file resources have no single artifact on the node, so build the zip
    // client-side from the file list; single-file resources are served directly.
    const content = multiFile
      ? await buildResourceZip(resource)
      : Buffer.from(await (await fetchConfiguredRawResource(resource, true)).arrayBuffer());
    writeFileSync(result.filePath, content);

    return {
      canceled: false,
      filePath: result.filePath,
    };
  });
}
