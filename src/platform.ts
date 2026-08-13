import { Capacitor, CapacitorHttp, registerPlugin, type HttpResponse } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { AES_CBC, HmacSha512, Sha256, Sha512, bytes_to_base64 } from 'asmcrypto.js';
import bcrypt from 'bcryptjs';
import { zipSync } from 'fflate';
import nacl from 'tweetnacl';
import packageJson from '../package.json';
import { compareAppVersions } from './appUpdates';
import { sniffMagicMimeType } from './qdnContentType';
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
} from '../electron/qdn-request-values';
import {
  buildHomeBlockchainDiscovery,
  type HomeWalletCapability,
} from '../electron/qdn-wallet-capabilities';
import {
  base58Decode,
  base58Encode,
  BASE58_ALPHABET,
  getSignedTransactionSignature,
} from '../electron/base58';
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
} from '../electron/qdn-group-avatar-input';
import { getLegacyAccountAvatarHint } from '../electron/qdn-identity-avatar';
import {
  buildUnsignedQortiumAtMessageTransactionBytes,
  getQortiumAtMessageRequest,
  QORTIUM_AT_MESSAGE_POW_DIFFICULTY,
} from '../electron/qdn-at-message';
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
} from '../electron/qdn-app-actions';
import {
  getQdnResourceStreamProxyMimeType,
  getQdnResourceStreamRequest,
  getQdnResourceViewerRequest,
} from '../electron/qdn-resource-viewer-contract';
import {
  validateBookmarkManagerMutationRequest,
  validateBookmarksOpenRequest,
  type BookmarkManagerMutationRequest,
  type BookmarkManagerMutationResult,
  type BookmarkManagerSnapshot,
} from '../electron/bookmark-manager-contract';
import {
  applyQdnNotificationManagerMutation,
  getQdnNotificationManagerSummary,
  sanitizeQdnNotificationManagerMutation,
} from '../electron/notification-manager';
import {
  getHomeSettingsApprovalDetails,
  getHomeSettingsMetadata,
  validateHomeSettingsPatch,
  type HomeSettings,
} from '../electron/home-settings-bridge';
import { getPlatformVersion } from '../electron/app-versioning';
import {
  isQdnFileNotFoundResponse,
  QdnFileNotFoundError,
} from '../electron/qdn-file-not-found';
import { readableNodeErrorMessage } from '../electron/node-error-body';
import { isNodeApiKeyTransportSafe, normalizeNodeApiUrl } from '../electron/node-api-url';
import {
  isUsableQortiumPublicNode as isUsableDiscoveryCandidate,
  QORTIUM_PUBLIC_NODE_API_URLS,
  rankQortiumPublicNodes as rankDiscoveryCandidates,
} from '../electron/qortium-public-node-policy';
import {
  getOptionalPollVoteOptionIndexes,
  getPollVoteApprovalName,
  resolvePollVoteOptionInput,
} from '../electron/qdn-poll-vote-input';
import { getPollOptionsInput } from '../electron/qdn-poll-options-input';
import { isSameQdnWriteRoute } from '../electron/qdn-write-route';
import {
  assertPublicArbitraryTransaction,
  assertPublicChatTransaction,
  assertPublicCreatePollTransaction,
  assertPublicUpdatePollTransaction,
  assertPublicVoteOnPollTransaction,
  getStaticQdnServiceId,
} from '../electron/public-transaction-validation';
import { parsePublicPollCapabilities, type PublicPollCapabilities } from '../electron/public-poll-capabilities';
import {
  sanitizeQdnNotificationIds,
  sanitizeQdnNotificationSubscriptions,
} from '../electron/notification-rules';
import { arbitraryRawToSigningBytes } from '../electron/arbitrary-tx';
import { fetchBoundedBytes } from '../electron/bounded-response';
import {
  attestPublicQdnPublish,
  type QdnPublishAttestationSource,
  type QdnPublishVerificationInput,
} from '../electron/qdn-content-attestation';
import {
  deriveForeignWalletRuntime,
  normalizeForeignWalletCoin,
} from '../electron/foreign-wallets';
import {
  executeForeignWalletRead,
  getForeignWalletPublicResponse,
  type ForeignWalletReadEndpoint,
} from '../electron/foreign-wallet-read-contract';
import {
  buildCoinGeckoSimplePricePath,
  buildMarketPriceResponse,
  getMarketPriceCacheKey,
  MARKET_PRICE_CACHE_TTL_MS,
  normalizeMarketPriceCoins,
  normalizeMarketPriceCurrencies,
  type MarketPriceResponse,
} from '../electron/market-prices';
import {
  appendSignatureToTransactionBytes,
  assertPositiveQortAmount,
  assertValidQortalAddress,
  atomicLongToBigInt,
  buildUnsignedPaymentTransactionBytes,
  formatQortAtomic,
  getSignatureFromSignedTransactionBytes,
  qortDecimalToAtomic,
} from '../electron/qortal-payment';
import {
  getNotificationStore,
  grantAppNotifications,
  removeAppNotificationRules,
  updateNotificationStore,
  replaceAppNotificationRules,
} from './notificationStore';
import {
  getQdnAppRolesStore,
  grantQdnAppCapabilityPermission,
  hasQdnAppCapability,
  grantQdnManagerPermission,
  hasQdnManagerPermission,
  setQdnAppAssignmentValue,
} from './qdnManagerPermissions';
import {
  getQdnAppAssignment,
  sanitizeQdnAppAssignmentDescription,
  sanitizeQdnAppAssignmentLabel,
  sanitizeQdnAppAssignmentRole,
  sanitizeQdnAppAssignmentUrl,
  sanitizeQdnManagerAppKey,
} from '../electron/qdn-manager-permissions';
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
} from '../electron/qortal-chat';
import { signChatTransaction } from './chatSign';
import type { CoreTransportStatusSnapshot } from './i2p';
import { t } from './i18n';
import {
  QDN_APP_NOTIFICATION_TEXT_MAX_LENGTH,
  REMOTE_AUTHORIZATION_BLOCKED_MESSAGE,
  sanitizeQdnAppTitle,
  type QdnDisplaySettings,
} from './qdn';
import { loadDisplaySettings } from './displaySettings';
import type { HomeV2VaultClient } from './home-v2-live/vault-client';
import type { HomeV2VaultState } from './v2/contracts';

const NODE_SETTINGS_KEY = 'qortium-home-node-settings';
const NODE_DISCOVERY_CACHE_KEY = 'qortium-home-node-discovery-cache';
const WALLET_STORE_KEY = 'qortium-home-wallet-store';
const HOME_V2_ACCOUNT_SECURITY_KEY = 'qortium-home-v2-account-security';
const MAX_WALLET_IMPORT_BYTES = 1024 * 1024;
const UPDATE_DOWNLOADS_DIR = 'app-updates';
const QDN_DOWNLOADS_DIR = 'qdn-downloads';
const DESKTOP_LOCAL_NODE_API_URL = 'http://127.0.0.1:24891';
const ANDROID_EMULATOR_LOCAL_NODE_API_URL = 'http://10.0.2.2:24891';
const PREVIEWNET_P2P_PORT = '24892';
// Read-only Qortal nodes for cross-chain QDN reads (no account, no API key, no writes).
// Desktop/browser builds prefer a synced local mainnet node, then fall back to remote public nodes.
const QORTAL_LOCAL_NODE_API_URL = 'http://127.0.0.1:12391';
const QORTAL_REMOTE_NODE_API_URLS = [
  'https://ext-node.qortal.link',
  'https://api.qortal.org',
];
const QORTAL_NODE_CACHE_TTL_MS = 5 * 60_000;
const PUBLIC_READ_PROBE_PATH =
  '/arbitrary/resources/search?mode=ALL&limit=1&includestatus=false&includemetadata=false';
const REQUEST_TIMEOUT_MS = 30_000;
const MEMORY_POW_TIMEOUT_MS = 180_000;
const PUBLIC_POLL_CAPABILITIES_TTL_MS = 5 * 60_000;
const DISCOVERY_TIMEOUT_MS = 5_000;
const DISCOVERY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const DISCOVERY_CACHE_MAX_ENTRIES = 24;
const WALLET_STORE_VERSION = 1;
const QORTIUM_WALLET_VERSION = 2;
// Version 3 files encrypt a raw 32-byte private key instead of a 64-byte
// master seed; they cannot derive additional addresses.
const QORTIUM_PRIVATE_KEY_WALLET_VERSION = 3;
const PRIVATE_KEY_BYTES = 32;
const KDF_THREAD_COUNT = 16;
const WALLET_SEED_BYTES = 64;
const QORTIUM_ADDRESS_VERSION = 58;
const STATIC_SALT = '4ghkVQExoneGqZqHTMMhhFfxXsVg2A75QeS1HCM5KAih';
const STATIC_BCRYPT_SALT = '$2a$11$IxVE941tXVUD4cW0TNVm.O';
const QDN_PUBLIC_STREAMED_PUBLISH_MAX_BYTES = 100 * 1024 * 1024;
const QDN_WRITE_SOURCE_MAX_BYTES = 100 * 1024 * 1024;
// Qortal cross-chain resource fetches (e.g. game ROMs) need a much larger ceiling than QDN text reads.
const QDN_APP_QORTAL_DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const QDN_APP_QORTAL_MAX_BYTES_LIMIT = 64 * 1024 * 1024;
const NATIVE_ASSET_LABEL = 'Native Asset';

function getHostInfoPlatform(): 'android' | 'ios' | 'desktop' {
  const platform = Capacitor.getPlatform();
  if (platform === 'android' || platform === 'ios') return platform;
  return 'desktop';
}

export function getQortiumHomeHostInfo() {
  const hostVersion = packageJson.version;

  return {
    hostName: 'qortium-home',
    hostVersion,
    platformVersion: getPlatformVersion(hostVersion) ?? hostVersion,
    // Additive: lets apps adapt density/layout to the host form factor.
    platform: getHostInfoPlatform(),
  };
}
const QDN_WRITE_APPROVAL_TIMEOUT_MS = 120_000;
const QDN_UNLOCK_STATE_WAIT_MS = 1_500;
const QDN_CHAT_MESSAGE_MAX_BYTES = 4000;
// Required leading-zero bits for the CHAT memory-pow. Tracks the chain config
// (Previewnet previewchain.json chatDifficulty); keep in sync with Qortium Core.
const CHAT_POW_DIFFICULTY = 8;
const ARBITRARY_POW_DIFFICULTY = 11;
const TRANSACTION_NONCE_OFFSET = 48;
const QDN_OPEN_NEW_TAB_URL_MAX_LENGTH = 2048;
const QDN_MEDIA_PLAYER_SERVICES = new Set(['AUDIO', 'PODCAST', 'VIDEO', 'VOICE']);
const QDN_MEDIA_PLAYER_FIELD_MAX_LENGTH = 1024;
const QDN_DOCUMENT_VIEWER_SERVICES = new Set(['DOCUMENT', 'FILE', 'FILES', 'ATTACHMENT']);

type StoredNodeSettings = {
  apiKey: string;
  customUrl: string;
  mode: QortiumNodeSettingsMode;
};

type EncryptedWallet = {
  address0: string;
  encryptedSeed: string;
  iv: string;
  kdfThreads: number;
  mac: string;
  salt: string;
  version: number;
  [key: string]: unknown;
};

type DerivedWalletAddress = {
  address: string;
  index: number;
};

type StoredWallet = {
  address: string;
  createdAt: string;
  // Extra addresses derived from the same seed (index >= 1); index 0 is the
  // base `address`. Stored only in Home's store, never in wallet files.
  derivedAddresses: DerivedWalletAddress[];
  encryptedWallet: EncryptedWallet;
  id: string;
  label: string;
  sourceFilename: string;
  updatedAt: string;
};

type WalletStore = {
  activeAccountId: string | null;
  version: typeof WALLET_STORE_VERSION;
  wallets: StoredWallet[];
};

type PendingLoadedWallet = {
  encryptedWallet: EncryptedWallet;
  sourceFilename: string;
};

type PlatformApi = Window['qortiumHome'];

type DiscoveryCache = {
  entries: DiscoveryCacheEntry[];
};

type DiscoveryCacheEntry = {
  failureCount: number;
  firstGoodAt: number;
  height: number;
  isSeed: boolean;
  lastFailedAt: number | null;
  lastGoodAt: number;
  nodeApiUrl: string;
  peerCount: number;
};

type DiscoveryProbeResult = {
  candidate: DiscoveryCandidate | null;
  nodeApiUrl: string;
};

type DiscoveryCandidate = {
  height: number;
  isSeed: boolean;
  isSynced: boolean;
  isSynchronizing: boolean;
  latencyMs: number;
  nodeApiUrl: string;
  peerCount: number;
  status: unknown;
  syncBlocksRemaining: number | null;
  syncPercent: number | null;
  syncPhase: string;
  supportsPublicReads: boolean;
};

let selectedPublicNodeApiUrl: string | null = null;

type QortalNodeCandidate = {
  requiresPublicReadProbe: boolean;
  requiresSyncedStatus: boolean;
  source: 'local' | 'remote';
  url: string;
};

type UpdateInstallerPlugin = {
  installApk: (request: { filePath: string }) => Promise<{ opened?: boolean }>;
};

type QdnFileSaverPlugin = {
  saveFile: (
    request: { path: string; fileName: string; mimeType?: string },
  ) => Promise<{ canceled: true } | { canceled: false; uri: string; name: string; size: number }>;
  openSavedFile: (request: { uri: string; mimeType?: string }) => Promise<{ opened: boolean }>;
  openCacheFile: (request: { path: string; fileName: string; mimeType?: string }) => Promise<{ opened: boolean; uri?: string }>;
};

type WalletBackupPlugin = {
  saveWallet: (request: { content: string; fileName: string }) => Promise<QortiumWalletBackupResult>;
};

type HomeV2SecureStoragePlugin = {
  isAvailable: () => Promise<{ available: boolean }>;
  remove: (request: { accountId: string }) => Promise<void>;
  unwrap: (request: { accountId: string }) => Promise<{ value: string | null }>;
  wrap: (request: { accountId: string; value: string }) => Promise<void>;
};

type HomeV2ProfileRecoveryPlugin = {
  ensureBackup: () => Promise<{ createdAtEpochMs: number; ready: boolean }>;
  requestRestore: () => Promise<void>;
};

type QdnPublishSourcePlugin = {
  selectFile: (request: { maxBytes: number }) => Promise<QdnPublishSourceResult>;
  selectDirectory: (request: { maxBytes: number }) => Promise<QdnPublishSourceResult>;
};

type QdnRenderProxyPlugin = {
  authorize: (request: { origin: string }) => Promise<{ proxyOrigin: string }>;
  release: (request: { origin: string }) => Promise<void>;
};

type QdnPublishSourcePickKind = 'directory' | 'file';

type NativeHttpBlobUrlRequest = {
  contentType?: string;
  readTimeoutMs?: number;
  url: string;
};

type QdnAppResourceRequest = {
  identifier?: string;
  name: string;
  path: string;
  service: string;
};

type QdnAppRequestContext = {
  accountId: string | null;
  displaySettings: QdnDisplaySettings;
  getHomeSettings?: () => HomeSettings;
  applyHomeSettingsPatch?: (patch: Partial<HomeSettings>) => Promise<HomeSettings> | HomeSettings;
  getBookmarkManagerSnapshot?: () => BookmarkManagerSnapshot;
  applyBookmarkManagerMutation?: (
    request: BookmarkManagerMutationRequest,
  ) => Promise<BookmarkManagerMutationResult> | BookmarkManagerMutationResult;
  isCurrent?: () => boolean;
  isViewFocused?: () => boolean;
  onOpenMediaPlayer?: (request: QortiumQdnMediaPlayerRequest) => void;
  onOpenDocumentViewer?: (request: QortiumQdnDocumentViewerRequest) => void;
  onOpenResourceViewer?: (request: QortiumQdnResourceViewerRequest) => void;
  onOpenPublishSourcePreview?: (request: QortiumQdnPublishSourcePreviewRequest) => void;
  onOpenNewTab?: (address: string) => void;
  onOpenInCurrentTab?: (address: string) => void;
  onBookmarksOpen?: (address: string, accountId: string | null) => void;
  resourceUrl: string;
  sessionKey: string;
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

type QdnPublishSourceResult =
  | {
      canceled: true;
    }
  | {
      canceled: false;
      dataBase64: string;
      fileName: string;
      isZip?: boolean;
      kind?: 'data' | 'directory' | 'file';
      mimeType?: string;
      size: number;
      uri?: string;
    };

type QdnPublishSourceTokenEntry = {
  contextKey: string;
  createdAt: number;
  lastUsedAt: number;
  source: QdnPublishSourceResult & { canceled: false };
};

type QdnWriteContext = {
  accountId: string;
  apiKey: string;
  nodeApiUrl: string;
  profile: QortiumAccountProfile;
  privateKey58: string;
  publicKey58: string;
};

type QdnKeylessWriteContext = {
  accountId: string;
  apiKey: string;
  // Kept alongside the URL because the write route is what the freshness check
  // compares, and mode is one of the three fields that decides it.
  mode: StoredNodeSettings['mode'];
  nodeApiUrl: string;
  profile: QortiumAccountProfile;
  publicKey58: string;
  secretKey: Uint8Array;
};

const publicPollCapabilitiesCache = new Map<string, { expiresAt: number; value: PublicPollCapabilities }>();

function qdnCodedError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

async function getPublicPollCapabilities(nodeApiUrl: string) {
  const cached = publicPollCapabilitiesCache.get(nodeApiUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const value = parsePublicPollCapabilities(await fetchLocalNodeApiPayload(
      nodeApiUrl,
      '/polls/public/capabilities',
      'Public poll capability lookup failed.',
    ));
    publicPollCapabilitiesCache.clear();
    publicPollCapabilitiesCache.set(nodeApiUrl, { expiresAt: Date.now() + PUBLIC_POLL_CAPABILITIES_TTL_MS, value });
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
  source?: QdnPublishSourceResult;
};

type PendingQdnApproval = {
  resolve: (approved: boolean) => void;
  timeoutId: number;
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

const UpdateInstaller = registerPlugin<UpdateInstallerPlugin>('UpdateInstaller');
const QdnFileSaver = registerPlugin<QdnFileSaverPlugin>('QdnFileSaver');
const WalletBackup = registerPlugin<WalletBackupPlugin>('WalletBackup');
const HomeV2SecureStorage = registerPlugin<HomeV2SecureStoragePlugin>('HomeV2SecureStorage');
const HomeV2ProfileRecovery = registerPlugin<HomeV2ProfileRecoveryPlugin>('HomeV2ProfileRecovery');
const QdnPublishSource = registerPlugin<QdnPublishSourcePlugin>('QdnPublishSource');
const QdnRenderProxy = registerPlugin<QdnRenderProxyPlugin>('QdnRenderProxy');
const unlockedWalletSeeds = new Map<string, Uint8Array>();
const pendingLoadedWallets = new Map<string, PendingLoadedWallet>();
const qdnUnlockListeners = new Set<(request: QortiumQdnUnlockRequest) => void>();
const qdnWriteListeners = new Set<(request: QortiumQdnWriteApprovalRequest) => void>();
const pendingQdnUnlockApprovals = new Map<string, PendingQdnApproval>();
const pendingQdnWriteApprovals = new Map<string, PendingQdnApproval>();
const qdnPublishSourceTokens = new Map<string, QdnPublishSourceTokenEntry>();
const approvedQdnChatPermissions = new Set<string>();
const lastQdnAppNotificationAt = new Map<string, number>();
const QDN_APP_NOTIFICATION_MIN_INTERVAL_MS = 3_000;
const QDN_PUBLISH_SOURCE_TOKEN_TTL_MS = 30 * 60_000;
const QDN_PUBLISH_SOURCE_TOKEN_MAX_ENTRIES = 8;
let nextLocalNotificationId = 1;

function forgetUnlockedWalletSeed(accountId: string) {
  const seed = unlockedWalletSeeds.get(accountId);

  if (seed) {
    seed.fill(0);
  }

  unlockedWalletSeeds.delete(accountId);
}

function clearUnlockedWalletSeeds() {
  for (const seed of unlockedWalletSeeds.values()) {
    seed.fill(0);
  }

  unlockedWalletSeeds.clear();
}

window.addEventListener('pagehide', () => {
  clearUnlockedWalletSeeds();
});

function isAndroid() {
  return Capacitor.getPlatform() === 'android';
}

/**
 * Resolves the URL an Android QDN iframe should load, authorizing its node origin
 * for the in-app https proxy.
 *
 * Android serves Home from https://localhost, so a QDN page loaded straight from
 * the node over http is mixed content: Chromium autoupgrades its images, audio
 * and video to https, the node has no TLS on its API port, and every one of those
 * requests is blocked — the page renders with no pictures and no sound. The proxy
 * origin removes that, while staying separate from Home's own origin so the page
 * cannot reach the app shell, and stable per node so an app keeps its storage.
 */
export async function authorizeQdnRenderProxyUrl(renderUrl: string, bridgeToken: string) {
  const url = new URL(renderUrl);
  const { proxyOrigin } = await QdnRenderProxy.authorize({ origin: url.origin });
  const proxied = new URL(`${proxyOrigin}${url.pathname}`);

  proxied.search = url.search;
  proxied.searchParams.set('qdnHomeBridge', bridgeToken);
  proxied.hash = url.hash;

  return proxied.toString();
}

export async function authorizeQdnResourceStreamUrl(renderUrl: string, mimeType?: string | null) {
  const url = new URL(renderUrl);
  const { proxyOrigin } = await QdnRenderProxy.authorize({ origin: url.origin });
  const proxied = new URL(`${proxyOrigin}${url.pathname}`);

  proxied.search = url.search;

  if (mimeType) {
    proxied.searchParams.set('qdnHomeMime', mimeType);
  }

  proxied.hash = url.hash;

  return proxied.toString();
}

export function isNativePlatform() {
  return Capacitor.isNativePlatform();
}

export function canPreviewDirectoryContent() {
  return !isNativePlatform() || isAndroid();
}

export function isMacOs() {
  if (isAndroid()) {
    return false;
  }

  return window.navigator.userAgent.toLowerCase().includes('mac os');
}

// Save arbitrary in-memory bytes to a user-chosen file. Used for per-entry archive
// downloads (the bytes are already extracted in the renderer). Desktop/web uses an
// anchor download; Android stages the bytes to a cache temp file and hands them to
// the SAF file saver, mirroring downloadResource's native flow.
export async function saveBytesToFile(
  fileName: string,
  bytes: Uint8Array,
  mimeType?: string,
): Promise<{ canceled: boolean }> {
  if (isAndroid()) {
    const tempPath = `${QDN_DOWNLOADS_DIR}/${Date.now()}-${fileName}`;

    await Filesystem.writeFile({
      path: tempPath,
      data: bytesToBase64(bytes),
      directory: Directory.Cache,
      recursive: true,
    });

    const tempUri = await Filesystem.getUri({ path: tempPath, directory: Directory.Cache });

    try {
      const saved = await QdnFileSaver.saveFile({ path: tempUri.uri, fileName, mimeType });
      return { canceled: saved.canceled };
    } finally {
      await Filesystem.deleteFile({ path: tempPath, directory: Directory.Cache }).catch(() => undefined);
    }
  }

  const url = URL.createObjectURL(new Blob([bytes as BlobPart], mimeType ? { type: mimeType } : undefined));

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }

  // A browser anchor download can't report cancellation.
  return { canceled: false };
}

export async function fetchNativeHttpBlobUrl({
  contentType,
  readTimeoutMs = REQUEST_TIMEOUT_MS,
  url,
}: NativeHttpBlobUrlRequest) {
  const response = await CapacitorHttp.get({
    url,
    responseType: 'arraybuffer',
    connectTimeout: REQUEST_TIMEOUT_MS,
    readTimeout: readTimeoutMs,
  });

  if (response.status < 200 || response.status >= 300 || typeof response.data !== 'string') {
    throw new Error(
      stringifyResponseData(response.data) || `Native HTTP request failed with HTTP ${response.status}.`,
    );
  }

  const bytes = base64ToBytes(response.data);
  const responseContentType = getContentType(response);
  const blobContentType =
    contentType ||
    (!isGenericContentType(responseContentType) ? responseContentType : '') ||
    sniffMagicMimeType(bytes) ||
    responseContentType ||
    'application/octet-stream';
  const blob = new Blob([bytes], {
    type: blobContentType,
  });

  return URL.createObjectURL(blob);
}

function isGenericContentType(contentType: string) {
  const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? '';

  return !normalized || normalized === 'application/octet-stream' || normalized === 'binary/octet-stream';
}

function getFallbackUpdatePlatformOs(): QortiumAppUpdatePlatformOs {
  if (isAndroid()) {
    return 'android';
  }

  const userAgent = window.navigator.userAgent.toLowerCase();
  const platform = window.navigator.platform.toLowerCase();

  if (userAgent.includes('linux') || platform.includes('linux')) {
    return 'linux';
  }

  if (userAgent.includes('mac os') || platform.includes('mac')) {
    return 'macos';
  }

  if (userAgent.includes('windows') || platform.includes('win')) {
    return 'windows';
  }

  return 'unsupported';
}

function getFallbackUpdateArch(os: QortiumAppUpdatePlatformOs) {
  if (os === 'android') {
    return 'universal';
  }

  const userAgent = window.navigator.userAgent.toLowerCase();
  const platform = window.navigator.platform.toLowerCase();
  const source = `${userAgent} ${platform}`;

  if (source.includes('aarch64') || source.includes('arm64')) {
    return 'arm64';
  }

  if (source.includes('x86_64') || source.includes('x64') || source.includes('win64')) {
    return 'x64';
  }

  return 'unknown';
}

function getFallbackUpdatePlatformLabel(os: QortiumAppUpdatePlatformOs, arch: string) {
  if (os === 'android') {
    return 'Android';
  }

  if (os === 'linux') {
    return `Linux ${arch}`;
  }

  if (os === 'macos') {
    return `macOS ${arch}`;
  }

  if (os === 'windows') {
    return `Windows ${arch}`;
  }

  return `Unsupported ${arch}`;
}

function isFallbackUpdatePlatformSupported(os: QortiumAppUpdatePlatformOs, arch: string) {
  if (os === 'android') {
    return true;
  }

  if (os === 'linux' || os === 'macos') {
    return arch === 'x64' || arch === 'arm64';
  }

  if (os === 'windows') {
    return arch === 'x64';
  }

  return false;
}

function getFallbackUpdateEnvironment(): QortiumAppUpdateEnvironment {
  const os = getFallbackUpdatePlatformOs();
  const arch = getFallbackUpdateArch(os);

  return {
    currentVersion: packageJson.version,
    platform: {
      arch,
      label: getFallbackUpdatePlatformLabel(os, arch),
      os,
      supported: isFallbackUpdatePlatformSupported(os, arch),
    },
  };
}

function normalizeExternalUrl(value: string) {
  const rawUrl = value.trim();

  if (!rawUrl) {
    throw new Error('Release URL is required.');
  }

  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Release URL is invalid.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Release URL must use HTTP or HTTPS.');
  }

  return url.toString();
}

function sanitizePathSegment(value: string, fallback: string) {
  return value.replace(/[^a-z0-9._-]/gi, '_') || fallback;
}

function sanitizeFilename(value: string, fallback: string) {
  const sanitized = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();

  return sanitized.slice(0, 180) || fallback;
}

function ensureJsonFilename(fileName: string) {
  return /\.json$/i.test(fileName) ? fileName : `${fileName}.json`;
}

function normalizeUpdateDigest(value: string | null) {
  const digest = getString(value).toLowerCase();

  return /^sha256:[a-f0-9]{64}$/.test(digest) ? digest : null;
}

function normalizeUpdateDownloadRequest(value: QortiumAppUpdateDownloadRequest) {
  if (!value || typeof value !== 'object') {
    throw new Error('Update download request is required.');
  }

  const releaseTag = getString(value.releaseTag);
  const asset = value.asset;

  if (!releaseTag) {
    throw new Error('Update release tag is required.');
  }

  if (!asset || typeof asset !== 'object') {
    throw new Error('Update asset is required.');
  }

  const name = getString(asset.name);
  const downloadUrl = normalizeExternalUrl(asset.downloadUrl);

  if (!name) {
    throw new Error('Update asset name is required.');
  }

  return {
    asset: {
      name,
      downloadUrl,
      digest: normalizeUpdateDigest(asset.digest),
      size: getNumber(asset.size) ?? 0,
    },
    releaseTag,
  };
}

function assertFallbackUpdateIsNewer(releaseTag: string) {
  const currentVersion = packageJson.version;
  const comparison = compareAppVersions(releaseTag, currentVersion);

  if (comparison === null) {
    throw new Error(`Unable to compare update release ${releaseTag} with current version ${currentVersion}.`);
  }

  if (comparison <= 0) {
    throw new Error(`Qortium Home ${currentVersion} is already current.`);
  }
}

function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64ToBytes(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function hasZipMagicBytes(bytes: Uint8Array) {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  );
}

function isQdnPublishZip(fileName: string | undefined, dataBase64?: string) {
  if (fileName && fileName.toLowerCase().endsWith('.zip')) {
    return true;
  }

  if (!dataBase64) {
    return false;
  }

  return hasZipMagicBytes(base64ToBytes(dataBase64.slice(0, 16)));
}

function shouldUseQdnPublishZipEndpoint(resource: QdnWriteResourceRequest, source: QdnPublishSourceResult) {
  return source.canceled === false && source.isZip === true && (resource.service === 'APP' || resource.service === 'WEBSITE');
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return window.btoa(binary);
}

function arrayBufferToBase64(value: ArrayBuffer) {
  return bytesToBase64(new Uint8Array(value));
}

async function sha256(data: Uint8Array) {
  const digestData = new Uint8Array(data);

  return new Uint8Array(await window.crypto.subtle.digest('SHA-256', digestData.buffer));
}

function sha256Sync(data: Uint8Array) {
  const result = new Sha256().process(data).finish().result;

  if (!result) {
    throw new Error('SHA-256 failed.');
  }

  return result;
}

async function hashBase64(value: string) {
  return `sha256:${bytesToHex(await window.crypto.subtle.digest('SHA-256', base64ToBytes(value)))}`;
}

async function fetchAssetAsBase64(asset: QortiumAppUpdateAsset) {
  if (isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url: asset.downloadUrl,
      responseType: 'arraybuffer',
      connectTimeout: 30_000,
      readTimeout: 300_000,
    });

    if (response.status < 200 || response.status >= 300 || typeof response.data !== 'string') {
      throw new Error(`Update download failed with HTTP ${response.status}.`);
    }

    return response.data;
  }

  const response = await fetch(asset.downloadUrl);

  if (!response.ok) {
    throw new Error(`Update download failed with HTTP ${response.status}.`);
  }

  return arrayBufferToBase64(await response.arrayBuffer());
}

async function downloadUpdateAssetInternal(request: QortiumAppUpdateDownloadRequest, { enforceNewer }: { enforceNewer: boolean }) {
  if (!isNativePlatform()) {
    throw new Error('Update downloads are available in the desktop app and Android app.');
  }

  const normalizedRequest = normalizeUpdateDownloadRequest(request);

  if (enforceNewer) {
    assertFallbackUpdateIsNewer(normalizedRequest.releaseTag);
  }

  const base64Asset = await fetchAssetAsBase64(normalizedRequest.asset);
  const digest = await hashBase64(base64Asset);

  if (normalizedRequest.asset.digest && normalizedRequest.asset.digest !== digest) {
    throw new Error('Downloaded update did not match the expected GitHub asset digest.');
  }

  const fileName = sanitizePathSegment(normalizedRequest.asset.name, 'update');
  const relativePath = `${UPDATE_DOWNLOADS_DIR}/${sanitizePathSegment(
    normalizedRequest.releaseTag,
    'release',
  )}/${fileName}`;

  await Filesystem.writeFile({
    path: relativePath,
    data: base64Asset,
    directory: Directory.Data,
    recursive: true,
  });

  const [fileStatus, fileUri] = await Promise.all([
    Filesystem.stat({
      path: relativePath,
      directory: Directory.Data,
    }),
    Filesystem.getUri({
      path: relativePath,
      directory: Directory.Data,
    }),
  ]);

  return {
    canOpen: isAndroid(),
    canReveal: false,
    digest,
    digestVerified: normalizedRequest.asset.digest === digest,
    downloadedAt: new Date().toISOString(),
    fileName,
    filePath: fileUri.uri,
    releaseTag: normalizedRequest.releaseTag,
    size: fileStatus.size || base64ToBytes(base64Asset).byteLength,
  };
}

async function downloadUpdateAsset(request: QortiumAppUpdateDownloadRequest) {
  return downloadUpdateAssetInternal(request, { enforceNewer: true });
}

async function downloadFallbackReleaseAsset(request: QortiumAppUpdateDownloadRequest) {
  return downloadUpdateAssetInternal(request, { enforceNewer: false });
}

function getLocalNodeApiUrl() {
  return isAndroid() ? ANDROID_EMULATOR_LOCAL_NODE_API_URL : DESKTOP_LOCAL_NODE_API_URL;
}

function getDefaultNodeSettings(): StoredNodeSettings {
  return {
    apiKey: '',
    customUrl: '',
    mode: isAndroid() ? 'network' : 'local',
  };
}

function parseStoredNodeSettings(value: unknown): StoredNodeSettings {
  if (!value || typeof value !== 'object') {
    return getDefaultNodeSettings();
  }

  const rawSettings = value as Partial<StoredNodeSettings>;
  const apiKey = getString(rawSettings.apiKey);
  const rawCustomUrl = getString(rawSettings.customUrl);
  let customUrl = '';

  if (rawCustomUrl) {
    try {
      customUrl = normalizeNodeApiUrl(rawCustomUrl);
    } catch {
      customUrl = '';
    }
  }

  const rawMode = (rawSettings as { mode?: unknown }).mode;

  if (rawMode === 'custom' && customUrl) {
    return {
      apiKey,
      customUrl,
      mode: 'custom',
    };
  }

  if (rawMode === 'network') {
    return {
      apiKey: '',
      customUrl,
      mode: 'network',
    };
  }

  if (rawMode === 'local') {
    return {
      apiKey,
      customUrl,
      mode: 'local',
    };
  }

  if (rawMode === 'previewnet') {
    return {
      apiKey: '',
      customUrl,
      mode: isAndroid() ? 'network' : 'local',
    };
  }

  return {
    apiKey,
    customUrl,
    mode: isAndroid() ? 'network' : 'local',
  };
}

function normalizeNodeSettingsRequest(value: QortiumNodeSettingsRequest): StoredNodeSettings {
  if (!value || typeof value !== 'object') {
    throw new Error('Node settings are required.');
  }

  if (value.mode !== 'local' && value.mode !== 'network' && value.mode !== 'custom') {
    throw new Error('Choose the local node, Qortium Public, or a custom node.');
  }

  const rawCustomUrl = getString(value.customUrl);
  const customUrl = rawCustomUrl ? normalizeNodeApiUrl(rawCustomUrl) : '';
  const apiKey = value.mode === 'network' ? '' : getString(value.apiKey);

  if (value.mode === 'custom' && !customUrl) {
    throw new Error('Custom node URL is required.');
  }

  return {
    apiKey,
    customUrl,
    mode: value.mode,
  };
}

function getFallbackNodeApiUrl(settings: StoredNodeSettings) {
  if (settings.mode === 'custom' && settings.customUrl) {
    return settings.customUrl;
  }

  if (settings.mode === 'network') {
    return QORTIUM_PUBLIC_NODE_API_URLS[0];
  }

  return getLocalNodeApiUrl();
}

async function resolveNodeApiUrl(settings: StoredNodeSettings, forceDiscoveryRefresh = false) {
  if (settings.mode === 'custom' && settings.customUrl) {
    return settings.customUrl;
  }

  if (settings.mode === 'network') {
    return (await discoverQortiumPublicNode(forceDiscoveryRefresh)).nodeApiUrl;
  }

  return getLocalNodeApiUrl();
}

async function getNodeSettingsSnapshot(settings: StoredNodeSettings): Promise<QortiumNodeSettings> {
  let nodeApiUrl = getFallbackNodeApiUrl(settings);

  try {
    nodeApiUrl = await resolveNodeApiUrl(settings);
  } catch {
    nodeApiUrl = getFallbackNodeApiUrl(settings);
  }

  return {
    ...settings,
    localUrl: getLocalNodeApiUrl(),
    networkModeAvailable: true,
    networkSeedUrls: [...QORTIUM_PUBLIC_NODE_API_URLS],
    nodeApiUrl,
  };
}

async function getStoredValue(key: string) {
  if (isNativePlatform()) {
    return (await Preferences.get({ key })).value;
  }

  return window.localStorage.getItem(key);
}

async function setStoredValue(key: string, value: string) {
  if (isNativePlatform()) {
    await Preferences.set({ key, value });
    return;
  }

  window.localStorage.setItem(key, value);
}

// True when window.qortiumHome is this module's own web fallback rather than
// the Electron preload API — readNodeSettings must not delegate to the
// fallback's getSettings, which reads back through readNodeSettings itself.
let usingFallbackQortiumHomeApi = false;

// Short-lived cache of the desktop settings snapshot: readNodeSettings runs
// on every renderer-side node request, and each uncached getSettings IPC makes
// the main process resolve the running core's API key — expensive work that
// must not repeat per request. Node setting saves invalidate this explicitly.
const DESKTOP_NODE_SETTINGS_CACHE_TTL_MS = 3_000;
let desktopNodeSettingsCache: { at: number; settings: StoredNodeSettings } | null = null;

export function invalidateDesktopNodeSettingsCache() {
  desktopNodeSettingsCache = null;
}

async function readNodeSettings() {
  // Desktop: the Electron main process owns node settings (the Settings UI
  // saves there, never to this module's browser-storage copy), so mirror its
  // active snapshot. Without this, renderer-side node requests here always
  // target the default local node even when a custom node is configured.
  if (!isNativePlatform() && !usingFallbackQortiumHomeApi && window.qortiumHome?.node?.getSettings) {
    const cached = desktopNodeSettingsCache;

    if (cached && Date.now() - cached.at < DESKTOP_NODE_SETTINGS_CACHE_TTL_MS) {
      return cached.settings;
    }

    try {
      const snapshot = await window.qortiumHome.node.getSettings();
      const settings = parseStoredNodeSettings({
        apiKey: snapshot.apiKey,
        customUrl: snapshot.customUrl,
        mode: snapshot.mode,
      });

      desktopNodeSettingsCache = { at: Date.now(), settings };

      return settings;
    } catch {
      // Fall through to the stored/browser settings below.
    }
  }

  try {
    const rawSettings = await getStoredValue(NODE_SETTINGS_KEY);

    return rawSettings ? parseStoredNodeSettings(JSON.parse(rawSettings) as unknown) : getDefaultNodeSettings();
  } catch {
    return getDefaultNodeSettings();
  }
}

async function writeNodeSettings(settings: StoredNodeSettings) {
  selectedPublicNodeApiUrl = null;

  if (isNativePlatform()) {
    await Preferences.set({ key: NODE_SETTINGS_KEY, value: JSON.stringify(settings) });
    return;
  }

  const browserSettings: StoredNodeSettings = {
    apiKey: '',
    customUrl: settings.customUrl,
    mode: settings.mode,
  };

  window.localStorage.setItem(NODE_SETTINGS_KEY, JSON.stringify(browserSettings));
}

function createEmptyWalletStore(): WalletStore {
  return {
    version: WALLET_STORE_VERSION,
    activeAccountId: null,
    wallets: [],
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isEncryptedWallet(value: unknown): value is EncryptedWallet {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.address0) &&
    isNonEmptyString(value.encryptedSeed) &&
    isNonEmptyString(value.iv) &&
    typeof value.kdfThreads === 'number' &&
    Number.isFinite(value.kdfThreads) &&
    isNonEmptyString(value.mac) &&
    isNonEmptyString(value.salt) &&
    typeof value.version === 'number' &&
    Number.isFinite(value.version)
  );
}

function assertEncryptedWallet(value: unknown): EncryptedWallet {
  if (!isEncryptedWallet(value)) {
    throw new Error(
      'Wallet file must include address0, encryptedSeed, salt, iv, version, mac, and kdfThreads.',
    );
  }

  return value;
}

function isStoredWallet(value: unknown): value is StoredWallet {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.address) &&
    isNonEmptyString(value.createdAt) &&
    isEncryptedWallet(value.encryptedWallet) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.label) &&
    typeof value.sourceFilename === 'string' &&
    isNonEmptyString(value.updatedAt)
  );
}

function sanitizeDerivedAddresses(value: unknown): DerivedWalletAddress[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (entry): entry is DerivedWalletAddress =>
        isRecord(entry) &&
        isNonEmptyString(entry.address) &&
        typeof entry.index === 'number' &&
        Number.isInteger(entry.index) &&
        entry.index > 0,
    )
    .map((entry) => ({ address: entry.address, index: entry.index }))
    .sort((first, second) => first.index - second.index);
}

function getDerivedAccountId(walletId: string, addressIndex: number) {
  return addressIndex === 0 ? walletId : `${walletId}:${addressIndex}`;
}

function getWalletIdForAccountId(accountId: string) {
  return accountId.split(':').slice(0, 2).join(':');
}

type ResolvedWalletAccount = {
  address: string;
  addressIndex: number;
  wallet: StoredWallet;
};

function resolveWalletAccount(wallets: StoredWallet[], accountId: string): ResolvedWalletAccount | null {
  for (const wallet of wallets) {
    if (wallet.id === accountId) {
      return { address: wallet.address, addressIndex: 0, wallet };
    }

    for (const derived of wallet.derivedAddresses) {
      if (getDerivedAccountId(wallet.id, derived.index) === accountId) {
        return { address: derived.address, addressIndex: derived.index, wallet };
      }
    }
  }

  return null;
}

function requireWalletAccount(store: WalletStore, accountId: string): ResolvedWalletAccount {
  const resolved = resolveWalletAccount(store.wallets, accountId);

  if (!resolved) {
    throw new Error('Selected account is not saved.');
  }

  return resolved;
}

function normalizeWalletStore(store: WalletStore): WalletStore {
  const activeAccount = store.activeAccountId
    ? resolveWalletAccount(store.wallets, store.activeAccountId)
    : null;

  return {
    version: WALLET_STORE_VERSION,
    wallets: store.wallets,
    activeAccountId: activeAccount ? store.activeAccountId : null,
  };
}

function parseWalletStore(value: unknown): WalletStore {
  if (!isRecord(value) || !Array.isArray(value.wallets)) {
    throw new Error('The saved account store has an invalid structure.');
  }

  if (value.version !== WALLET_STORE_VERSION) {
    throw new Error('The saved account store version is not supported.');
  }

  if (!value.wallets.every(isStoredWallet)) {
    throw new Error('A saved account is incomplete or invalid.');
  }

  return normalizeWalletStore({
    version: WALLET_STORE_VERSION,
    wallets: value.wallets.map((wallet) => ({
      ...wallet,
      derivedAddresses: sanitizeDerivedAddresses((wallet as Record<string, unknown>).derivedAddresses),
    })),
    activeAccountId: typeof value.activeAccountId === 'string' ? value.activeAccountId : null,
  });
}

async function readWalletStore() {
  const rawStore = await getStoredValue(WALLET_STORE_KEY);
  if (!rawStore) return createEmptyWalletStore();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawStore) as unknown;
  } catch {
    throw new Error('The saved account store is not valid JSON.');
  }
  return parseWalletStore(parsed);
}

async function accountExists(accountId: string) {
  const store = await readWalletStore();
  return resolveWalletAccount(store.wallets, accountId) !== null;
}

async function getActiveAccountAddressForNotifications() {
  const store = await readWalletStore();
  return store.activeAccountId
    ? resolveWalletAccount(store.wallets, store.activeAccountId)?.address ?? ''
    : '';
}

async function writeWalletStore(store: WalletStore) {
  await setStoredValue(WALLET_STORE_KEY, JSON.stringify(normalizeWalletStore(store)));
}

function toAccountsState(store: WalletStore): QortiumAccountsState {
  const nextStore = normalizeWalletStore(store);

  return {
    activeAccountId: nextStore.activeAccountId,
    accounts: nextStore.wallets.flatMap((wallet) => {
      const isUnlocked = unlockedWalletSeeds.has(wallet.id);
      const supportsDerivedAddresses = !isPrivateKeyWallet(wallet.encryptedWallet);

      return [
        {
          id: wallet.id,
          addressIndex: 0,
          label: wallet.label,
          address: wallet.address,
          sourceFilename: wallet.sourceFilename,
          isUnlocked,
          supportsDerivedAddresses,
          walletId: wallet.id,
        },
        ...wallet.derivedAddresses.map((derived) => ({
          id: getDerivedAccountId(wallet.id, derived.index),
          addressIndex: derived.index,
          label: `${wallet.label} · ${derived.index}`,
          address: derived.address,
          sourceFilename: wallet.sourceFilename,
          isUnlocked,
          supportsDerivedAddresses,
          walletId: wallet.id,
        })),
      ];
    }),
  };
}

function stringToUtf8Array(value: string) {
  return new TextEncoder().encode(value);
}

function sha512(data: Uint8Array) {
  const result = new Sha512().process(data).finish().result;

  if (!result) {
    throw new Error('Unable to hash wallet data.');
  }

  return result;
}

function rotateLeft32(value: number, bits: number) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function ripemd160Round(index: number, x: number, y: number, z: number) {
  if (index < 16) {
    return (x ^ y ^ z) >>> 0;
  }

  if (index < 32) {
    return ((x & y) | (~x & z)) >>> 0;
  }

  if (index < 48) {
    return ((x | ~y) ^ z) >>> 0;
  }

  if (index < 64) {
    return ((x & z) | (y & ~z)) >>> 0;
  }

  return (x ^ (y | ~z)) >>> 0;
}

function ripemd160LeftConstant(index: number) {
  if (index < 16) return 0x00000000;
  if (index < 32) return 0x5a827999;
  if (index < 48) return 0x6ed9eba1;
  if (index < 64) return 0x8f1bbcdc;
  return 0xa953fd4e;
}

function ripemd160RightConstant(index: number) {
  if (index < 16) return 0x50a28be6;
  if (index < 32) return 0x5c4dd124;
  if (index < 48) return 0x6d703ef3;
  if (index < 64) return 0x7a6d76e9;
  return 0x00000000;
}

function ripemd160(data: Uint8Array) {
  const leftOrder = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
    3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
    1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
    4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
  ];
  const rightOrder = [
    5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
    6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
    15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
    8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
    12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11,
  ];
  const leftShifts = [
    11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
    7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
    11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
    11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
    9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
  ];
  const rightShifts = [
    8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
    9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
    9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
    15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
    8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11,
  ];
  let paddedLength = data.length + 1;

  while (paddedLength % 64 !== 56) {
    paddedLength += 1;
  }

  const padded = new Uint8Array(paddedLength + 8);
  const bitLength = BigInt(data.length) * 8n;

  padded.set(data);
  padded[data.length] = 0x80;

  for (let index = 0; index < 8; index += 1) {
    padded[paddedLength + index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  }

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = Array.from({ length: 16 }, (_value, index) => {
      const wordOffset = offset + index * 4;

      return (
        padded[wordOffset] |
        (padded[wordOffset + 1] << 8) |
        (padded[wordOffset + 2] << 16) |
        (padded[wordOffset + 3] << 24)
      ) >>> 0;
    });
    let leftA = h0;
    let leftB = h1;
    let leftC = h2;
    let leftD = h3;
    let leftE = h4;
    let rightA = h0;
    let rightB = h1;
    let rightC = h2;
    let rightD = h3;
    let rightE = h4;

    for (let index = 0; index < 80; index += 1) {
      const leftTemp = (
        rotateLeft32(
          (leftA + ripemd160Round(index, leftB, leftC, leftD) + words[leftOrder[index]] + ripemd160LeftConstant(index)) >>> 0,
          leftShifts[index],
        ) + leftE
      ) >>> 0;
      const rightTemp = (
        rotateLeft32(
          (rightA + ripemd160Round(79 - index, rightB, rightC, rightD) + words[rightOrder[index]] + ripemd160RightConstant(index)) >>> 0,
          rightShifts[index],
        ) + rightE
      ) >>> 0;

      leftA = leftE;
      leftE = leftD;
      leftD = rotateLeft32(leftC, 10);
      leftC = leftB;
      leftB = leftTemp;

      rightA = rightE;
      rightE = rightD;
      rightD = rotateLeft32(rightC, 10);
      rightC = rightB;
      rightB = rightTemp;
    }

    const nextH0 = (h1 + leftC + rightD) >>> 0;

    h1 = (h2 + leftD + rightE) >>> 0;
    h2 = (h3 + leftE + rightA) >>> 0;
    h3 = (h4 + leftA + rightB) >>> 0;
    h4 = (h0 + leftB + rightC) >>> 0;
    h0 = nextH0;
  }

  const result = new Uint8Array(20);
  const words = [h0, h1, h2, h3, h4];

  for (let index = 0; index < words.length; index += 1) {
    result[index * 4] = words[index] & 0xff;
    result[index * 4 + 1] = (words[index] >>> 8) & 0xff;
    result[index * 4 + 2] = (words[index] >>> 16) & 0xff;
    result[index * 4 + 3] = (words[index] >>> 24) & 0xff;
  }

  return result;
}

async function computeKdfPart(password: string, nonce: number) {
  const hash = sha512(stringToUtf8Array(`${STATIC_SALT}${password}${nonce}`));
  const hashBase64 = bytes_to_base64(hash);

  return bcrypt.hash(hashBase64.substring(0, 72), STATIC_BCRYPT_SALT);
}

async function deriveWalletKey(password: string) {
  const parts = await Promise.all(
    Array.from({ length: KDF_THREAD_COUNT }, (_value, nonce) => computeKdfPart(password, nonce)),
  );

  return sha512(stringToUtf8Array(`${STATIC_SALT}${parts.reduce((combined, part) => combined + part)}`));
}

function getRandomBytes(length: number) {
  const bytes = new Uint8Array(length);

  window.crypto.getRandomValues(bytes);

  return bytes;
}

function appendBuffer(first: Uint8Array | number[], second: Uint8Array | number[]) {
  const firstBuffer = new Uint8Array(first);
  const secondBuffer = new Uint8Array(second);
  const nextBuffer = new Uint8Array(firstBuffer.byteLength + secondBuffer.byteLength);

  nextBuffer.set(firstBuffer, 0);
  nextBuffer.set(secondBuffer, firstBuffer.byteLength);

  return nextBuffer;
}

function int32ToBytes(value: number) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff);
}

function deriveAddressSeed(seed: Uint8Array, nonce = 0) {
  const nonceBytes = int32ToBytes(nonce);
  const nonceSeed = appendBuffer(appendBuffer(nonceBytes, seed), nonceBytes);
  const firstHash = sha512(nonceSeed);

  return sha512(appendBuffer(firstHash, nonceSeed)).slice(0, 32);
}

async function publicKeyToAddress(publicKey: Uint8Array) {
  const publicKeyHash = ripemd160(await sha256(publicKey));
  const versionedHash = appendBuffer([QORTIUM_ADDRESS_VERSION], publicKeyHash);
  const checksum = (await sha256(await sha256(versionedHash))).slice(0, 4);

  return base58Encode(appendBuffer(versionedHash, checksum));
}

async function deriveAddress(seed: Uint8Array) {
  const addressSeed = deriveAddressSeed(seed);
  const keyPair = nacl.sign.keyPair.fromSeed(addressSeed);

  return publicKeyToAddress(keyPair.publicKey);
}

async function encryptWalletPayload(
  payload: Uint8Array,
  password: string,
  address0: string,
  version: number,
): Promise<EncryptedWallet> {
  const iv = getRandomBytes(16);
  const salt = getRandomBytes(32);
  const key = await deriveWalletKey(password);
  const encryptionKey = key.slice(0, 32);
  const macKey = key.slice(32, 63);
  const encryptedSeedResult = AES_CBC.encrypt(payload, encryptionKey, false, iv);

  if (!encryptedSeedResult) {
    throw new Error('Unable to encrypt wallet seed.');
  }

  const encryptedSeed = new Uint8Array(encryptedSeedResult);
  const mac = new HmacSha512(macKey).process(encryptedSeed).finish().result;

  if (!mac) {
    throw new Error('Unable to authenticate wallet seed.');
  }

  return {
    address0,
    encryptedSeed: base58Encode(encryptedSeed),
    salt: base58Encode(salt),
    iv: base58Encode(iv),
    version,
    mac: base58Encode(mac),
    kdfThreads: KDF_THREAD_COUNT,
  };
}

async function encryptWalletSeed(seed: Uint8Array, password: string): Promise<EncryptedWallet> {
  return encryptWalletPayload(seed, password, await deriveAddress(seed), QORTIUM_WALLET_VERSION);
}

function isPrivateKeyWallet(wallet: EncryptedWallet) {
  return wallet.version === QORTIUM_PRIVATE_KEY_WALLET_VERSION;
}

function decodePrivateKeyInput(privateKey58: string) {
  const input = privateKey58.trim();

  if (!input) {
    throw new Error('Enter the private key.');
  }

  let decoded: Uint8Array;

  try {
    decoded = base58Decode(input);
  } catch {
    throw new Error('Enter a valid base58 private key.');
  }

  // A 64-byte ed25519 secret key embeds the 32-byte key as its first half.
  if (decoded.length === PRIVATE_KEY_BYTES * 2) {
    return decoded.slice(0, PRIVATE_KEY_BYTES);
  }

  if (decoded.length !== PRIVATE_KEY_BYTES) {
    throw new Error('Enter a valid base58 private key.');
  }

  return decoded;
}

async function getAddressFromPrivateKey(privateKey58: string) {
  const privateKey = decodePrivateKeyInput(privateKey58);
  try {
    const keyPair = nacl.sign.keyPair.fromSeed(privateKey);
    return publicKeyToAddress(keyPair.publicKey);
  } finally {
    privateKey.fill(0);
  }
}

function decryptWalletWithKey(key: Uint8Array, wallet: EncryptedWallet) {
  try {
    const encryptedSeed = base58Decode(wallet.encryptedSeed);
    const iv = base58Decode(wallet.iv);

    base58Decode(wallet.salt);

    const encryptionKey = key.slice(0, 32);
    const macKey = key.slice(32, 63);
    const mac = new HmacSha512(macKey).process(encryptedSeed).finish().result;

    if (!mac || base58Encode(mac) !== wallet.mac) {
      throw new Error('Incorrect wallet password.');
    }

    const decryptedSeed = AES_CBC.decrypt(encryptedSeed, encryptionKey, false, iv);

    if (!decryptedSeed) {
      throw new Error('Unable to unlock wallet.');
    }

    return new Uint8Array(decryptedSeed);
  } catch (error) {
    if (error instanceof Error && error.message === 'Incorrect wallet password.') {
      throw error;
    }

    throw new Error('Unable to unlock wallet.');
  }
}

async function decryptWalletSeed(password: string, wallet: EncryptedWallet) {
  if (!password) throw new Error('Enter the wallet password.');
  const key = await deriveWalletKey(password);
  try {
    return decryptWalletWithKey(key, wallet);
  } finally {
    key.fill(0);
  }
}

function getWalletId(wallet: EncryptedWallet) {
  return `wallet:${wallet.address0}`;
}

function getWalletLabel(sourceFilename: string, wallet: EncryptedWallet) {
  const label = sourceFilename.replace(/\.[^.]+$/, '').trim();

  return label || wallet.address0;
}

function walletNameKey(name: string) {
  return name.trim().toLowerCase();
}

function assertValidWalletName(name: string, store: WalletStore, exceptWalletId?: string) {
  const nextName = name.trim();

  if (!nextName) {
    throw new Error('Enter a wallet label.');
  }

  const duplicateWallet = store.wallets.find(
    (wallet) => wallet.id !== exceptWalletId && walletNameKey(wallet.label) === walletNameKey(nextName),
  );

  if (duplicateWallet) {
    throw new Error('Wallet label already exists.');
  }

  return nextName;
}

function createToken() {
  return window.crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function selectJsonFile() {
  return new Promise<{ filename: string; text: string } | null>((resolve, reject) => {
    const input = document.createElement('input');
    let settled = false;

    function cleanup() {
      input.remove();
      window.removeEventListener('focus', handleFocus);
    }

    function settle(value: { filename: string; text: string } | null) {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(value);
    }

    function fail(error: unknown) {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    }

    function handleFocus() {
      window.setTimeout(() => {
        if (!input.files?.length) {
          settle(null);
        }
      }, 500);
    }

    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    input.addEventListener('cancel', () => settle(null));
    input.addEventListener('change', () => {
      const file = input.files?.[0];

      if (!file) {
        settle(null);
        return;
      }

      if (file.size > MAX_WALLET_IMPORT_BYTES) {
        fail(new Error('Wallet files must be 1 MiB or smaller.'));
        return;
      }

      file
        .text()
        .then((text) => settle({ filename: file.name || 'wallet.json', text }))
        .catch(fail);
    });

    document.body.append(input);
    input.click();
    window.setTimeout(() => {
      if (!settled) {
        window.addEventListener('focus', handleFocus);
      }
    }, 500);
  });
}

async function selectWalletFile(): Promise<QortiumSelectWalletResult> {
  const selectedFile = await selectJsonFile();

  if (!selectedFile) {
    return {
      canceled: true,
    };
  }

  let parsedWallet: unknown;

  try {
    parsedWallet = JSON.parse(selectedFile.text);
  } catch {
    throw new Error('Unable to read the selected wallet file.');
  }

  const encryptedWallet = assertEncryptedWallet(
    isRecord(parsedWallet) && 'wallet' in parsedWallet ? parsedWallet.wallet : parsedWallet,
  );
  const id = getWalletId(encryptedWallet);
  const existingWallet = (await readWalletStore()).wallets.find((wallet) => wallet.id === id);
  const token = createToken();

  pendingLoadedWallets.set(token, {
    encryptedWallet,
    sourceFilename: selectedFile.filename,
  });

  return {
    accountId: id,
    address: encryptedWallet.address0,
    canceled: false,
    suggestedName: existingWallet?.label ?? getWalletLabel(selectedFile.filename, encryptedWallet),
    token,
  };
}

function discardLoadedWallet(token: string) {
  pendingLoadedWallets.delete(token);
}

async function saveLoadedWallet(token: string, name: string) {
  const pendingWallet = pendingLoadedWallets.get(token);

  if (!pendingWallet) {
    throw new Error('Selected wallet is no longer available. Load the file again.');
  }

  const store = await readWalletStore();
  const id = getWalletId(pendingWallet.encryptedWallet);
  const walletName = assertValidWalletName(name, store, id);
  const existingWallet = store.wallets.find((wallet) => wallet.id === id);
  const now = new Date().toISOString();
  const nextWallet: StoredWallet = {
    id,
    label: walletName,
    address: pendingWallet.encryptedWallet.address0,
    derivedAddresses: existingWallet?.derivedAddresses ?? [],
    sourceFilename: pendingWallet.sourceFilename,
    encryptedWallet: pendingWallet.encryptedWallet,
    createdAt: existingWallet?.createdAt ?? now,
    updatedAt: now,
  };
  const existingWalletIndex = store.wallets.findIndex((wallet) => wallet.id === id);

  if (existingWalletIndex >= 0) {
    store.wallets[existingWalletIndex] = nextWallet;
  } else {
    store.wallets.push(nextWallet);
  }

  store.activeAccountId = id;
  forgetUnlockedWalletSeed(id);
  pendingLoadedWallets.delete(token);
  await writeWalletStore(store);

  return toAccountsState(store);
}

function formatWalletBackupJson(wallet: EncryptedWallet) {
  return `${JSON.stringify(wallet, null, 2)}\n`;
}

function getWalletBackupFilename(walletName: string, wallet: EncryptedWallet) {
  return ensureJsonFilename(`${sanitizeFilename(walletName, 'wallet')}_${wallet.address0}`);
}

function normalizeWalletBackupResult(value: unknown, fallbackFileName: string): QortiumWalletBackupResult {
  if (!isRecord(value)) {
    throw new Error('Wallet backup did not return a valid result.');
  }

  if (value.canceled === true) {
    return {
      canceled: true,
    };
  }

  const fileName = getString(value.fileName) || fallbackFileName;

  return {
    canceled: false,
    fileName,
    uri: getString(value.uri) || undefined,
  };
}

async function saveWalletBackup(wallet: EncryptedWallet, fileName: string) {
  const backupFileName = ensureJsonFilename(sanitizeFilename(fileName, 'wallet.json'));
  const result = await WalletBackup.saveWallet({
    content: formatWalletBackupJson(wallet),
    fileName: backupFileName,
  });

  return normalizeWalletBackupResult(result, backupFileName);
}

async function createWallet(name: string, password: string): Promise<QortiumCreateWalletResult> {
  const initialStore = await readWalletStore();
  const initialWalletName = assertValidWalletName(name, initialStore);

  if (!password) {
    throw new Error('Enter the wallet password.');
  }

  const seed = getRandomBytes(WALLET_SEED_BYTES);
  let shouldWipeSeed = true;

  try {
    const encryptedWallet = await encryptWalletSeed(seed, password);
    const backupResult = await saveWalletBackup(
      encryptedWallet,
      getWalletBackupFilename(initialWalletName, encryptedWallet),
    );

    if (backupResult.canceled) {
      return {
        canceled: true,
        ...toAccountsState(await readWalletStore()),
      };
    }

    const id = getWalletId(encryptedWallet);
    const store = await readWalletStore();
    const walletName = assertValidWalletName(initialWalletName, store, id);
    const existingWallet = store.wallets.find((wallet) => wallet.id === id);
    const now = new Date().toISOString();
    const nextWallet: StoredWallet = {
      id,
      label: walletName,
      address: encryptedWallet.address0,
      derivedAddresses: existingWallet?.derivedAddresses ?? [],
      sourceFilename: backupResult.fileName,
      encryptedWallet,
      createdAt: existingWallet?.createdAt ?? now,
      updatedAt: now,
    };
    const existingWalletIndex = store.wallets.findIndex((wallet) => wallet.id === id);

    if (existingWalletIndex >= 0) {
      store.wallets[existingWalletIndex] = nextWallet;
    } else {
      store.wallets.push(nextWallet);
    }

    store.activeAccountId = id;
    unlockedWalletSeeds.set(id, seed);
    shouldWipeSeed = false;
    await writeWalletStore(store);

    return {
      canceled: false,
      ...toAccountsState(store),
    };
  } finally {
    if (shouldWipeSeed) {
      seed.fill(0);
    }
  }
}

async function importPrivateKeyWallet(
  name: string,
  privateKey58: string,
  password: string,
): Promise<QortiumCreateWalletResult> {
  const initialStore = await readWalletStore();
  const initialWalletName = assertValidWalletName(name, initialStore);

  if (!password) {
    throw new Error('Enter the wallet password.');
  }

  const privateKey = decodePrivateKeyInput(privateKey58);
  let retainPrivateKey = false;
  try {
  const address0 = await getAddressFromPrivateKey(privateKey58);
  const encryptedWallet = await encryptWalletPayload(
    privateKey,
    password,
    address0,
    QORTIUM_PRIVATE_KEY_WALLET_VERSION,
  );
  const backupResult = await saveWalletBackup(
    encryptedWallet,
    getWalletBackupFilename(initialWalletName, encryptedWallet),
  );

  if (backupResult.canceled) {
    privateKey.fill(0);
    return {
      canceled: true,
      ...toAccountsState(await readWalletStore()),
    };
  }

  const id = getWalletId(encryptedWallet);
  const store = await readWalletStore();
  const walletName = assertValidWalletName(initialWalletName, store, id);
  const existingWallet = store.wallets.find((wallet) => wallet.id === id);
  const now = new Date().toISOString();
  const nextWallet: StoredWallet = {
    id,
    label: walletName,
    address: address0,
    derivedAddresses: [],
    sourceFilename: backupResult.fileName,
    encryptedWallet,
    createdAt: existingWallet?.createdAt ?? now,
    updatedAt: now,
  };
  const existingWalletIndex = store.wallets.findIndex((wallet) => wallet.id === id);

  if (existingWalletIndex >= 0) {
    store.wallets[existingWalletIndex] = nextWallet;
  } else {
    store.wallets.push(nextWallet);
  }

  store.activeAccountId = id;
  unlockedWalletSeeds.set(id, privateKey);
  retainPrivateKey = true;
  await writeWalletStore(store);

  return {
    canceled: false,
    ...toAccountsState(store),
  };
  } finally {
    if (!retainPrivateKey) privateKey.fill(0);
  }
}

async function exportWallet(accountId: string) {
  const store = await readWalletStore();
  const { wallet } = requireWalletAccount(store, accountId);
  const suggestedFilename = wallet.sourceFilename || getWalletBackupFilename(wallet.label, wallet.encryptedWallet);

  return saveWalletBackup(wallet.encryptedWallet, suggestedFilename);
}

async function setActiveAccount(accountId: string) {
  const store = await readWalletStore();

  requireWalletAccount(store, accountId);

  store.activeAccountId = accountId;
  await writeWalletStore(store);

  return toAccountsState(store);
}

async function clearActiveAccount() {
  const store = await readWalletStore();
  store.activeAccountId = null;
  await writeWalletStore(store);
  return toAccountsState(store);
}

async function renameAccount(accountId: string, label: string) {
  const store = await readWalletStore();
  const { wallet } = requireWalletAccount(store, accountId);
  wallet.label = assertValidWalletName(label, store, wallet.id);
  wallet.updatedAt = new Date().toISOString();
  await writeWalletStore(store);
  return toAccountsState(store);
}

async function unlockWallet(accountId: string, password: string) {
  const store = await readWalletStore();
  const { wallet } = requireWalletAccount(store, accountId);
  const seed = await decryptWalletSeed(password, wallet.encryptedWallet);

  unlockedWalletSeeds.set(wallet.id, seed);

  return toAccountsState(store);
}

async function lockWallet(accountId: string) {
  const store = await readWalletStore();
  const { wallet } = requireWalletAccount(store, accountId);

  forgetUnlockedWalletSeed(wallet.id);

  return toAccountsState(store);
}

async function addDerivedAddress(accountId: string) {
  const store = await readWalletStore();
  const { wallet } = requireWalletAccount(store, accountId);

  if (isPrivateKeyWallet(wallet.encryptedWallet)) {
    throw new Error('This wallet was imported from a private key, so additional addresses cannot be derived.');
  }

  const seed = unlockedWalletSeeds.get(wallet.id);

  if (!seed) {
    throw new Error('Unlock the selected wallet to add an address.');
  }

  const nextIndex = (wallet.derivedAddresses[wallet.derivedAddresses.length - 1]?.index ?? 0) + 1;
  const addressSeed = deriveAddressSeed(seed, nextIndex);
  const keyPair = nacl.sign.keyPair.fromSeed(addressSeed);
  const address = await publicKeyToAddress(keyPair.publicKey);

  wallet.derivedAddresses = [...wallet.derivedAddresses, { address, index: nextIndex }];
  wallet.updatedAt = new Date().toISOString();
  store.activeAccountId = getDerivedAccountId(wallet.id, nextIndex);
  await writeWalletStore(store);

  return toAccountsState(store);
}

async function removeWallet(accountId: string, password?: string) {
  const store = await readWalletStore();
  const { addressIndex, wallet } = requireWalletAccount(store, accountId);

  // Removing a derived address only hides it from the list; re-adding derives
  // the same address again, so no password confirmation is needed.
  if (addressIndex > 0) {
    wallet.derivedAddresses = wallet.derivedAddresses.filter((derived) => derived.index !== addressIndex);
    wallet.updatedAt = new Date().toISOString();

    if (store.activeAccountId === accountId) {
      store.activeAccountId = wallet.id;
    }

    await writeWalletStore(store);

    return toAccountsState(store);
  }

  const walletIndex = store.wallets.findIndex((storedWallet) => storedWallet.id === wallet.id);

  if (!unlockedWalletSeeds.has(wallet.id)) {
    await decryptWalletSeed(password ?? '', wallet.encryptedWallet);
  }

  const wasActiveWallet =
    store.activeAccountId !== null &&
    resolveWalletAccount([wallet], store.activeAccountId) !== null;

  store.wallets.splice(walletIndex, 1);
  forgetUnlockedWalletSeed(wallet.id);

  if (wasActiveWallet) {
    store.activeAccountId = store.wallets[walletIndex]?.id ?? store.wallets[walletIndex - 1]?.id ?? null;
  }

  await writeWalletStore(store);

  return toAccountsState(store);
}

function getNameValue(value: unknown) {
  if (!isRecord(value) || !isNonEmptyString(value.name)) {
    return null;
  }

  return value.name.trim();
}

async function fetchNodeJson(pathname: string, nodeApiUrl: string) {
  try {
    const response = await requestNode(nodeApiUrl, pathname, 'json');

    return response.status >= 200 && response.status < 300 ? response.data : null;
  } catch {
    return null;
  }
}

// Reads the node's I2P transport state from its open endpoints (no API key
// required): GET /admin/settings for the transport configuration, and
// /peers + /peers/data for the live per-peer transport. Works in any node mode
// and on both desktop and Android. Returns null when the node is unreachable.
export async function fetchCoreTransportStatus(): Promise<CoreTransportStatusSnapshot | null> {
  const bridgedStatus = await window.qortiumHome.node.getTransportStatus?.();

  if (bridgedStatus) {
    return bridgedStatus;
  }

  const settings = await readNodeSettings();

  let nodeApiUrl: string;

  try {
    nodeApiUrl = await resolveNodeApiUrl(settings);
  } catch {
    return null;
  }

  const rawSettings = await fetchNodeJson('/admin/settings', nodeApiUrl);

  if (!isRecord(rawSettings)) {
    return null;
  }

  const allowedTransportsRaw = rawSettings.allowedTransports;
  const allowedTransports = Array.isArray(allowedTransportsRaw)
    ? allowedTransportsRaw.filter((entry): entry is string => typeof entry === 'string')
    : null;

  const chainPeers = await fetchNodeJson('/peers', nodeApiUrl);
  const dataPeers = await fetchNodeJson('/peers/data', nodeApiUrl);

  return {
    settings: {
      allowedTransports,
      i2pSamHost: getString(rawSettings.i2pSamHost) || '127.0.0.1',
      i2pSamPort: getInteger(rawSettings.i2pSamPort) ?? 7656,
      i2pChainKeyFile: getString(rawSettings.i2pChainKeyFile),
      i2pDataKeyFile: getString(rawSettings.i2pDataKeyFile),
      i2pEmbeddedRouter: getBoolean(rawSettings.i2pEmbeddedRouter) ?? false,
    },
    chainPeers: Array.isArray(chainPeers) ? chainPeers : [],
    dataPeers: Array.isArray(dataPeers) ? dataPeers : [],
  };
}

async function getPrimaryName(address: string, nodeApiUrl: string) {
  const primaryName = await fetchNodeJson(`/names/primary/${encodeURIComponent(address)}`, nodeApiUrl);

  return getNameValue(primaryName);
}

async function getFirstOwnedName(address: string, nodeApiUrl: string) {
  const ownedNames = await fetchNodeJson(
    `/names/address/${encodeURIComponent(address)}?limit=0`,
    nodeApiUrl,
  );

  if (!Array.isArray(ownedNames)) {
    return null;
  }

  for (const ownedName of ownedNames) {
    const name = getNameValue(ownedName);

    if (name) {
      return name;
    }
  }

  return null;
}

async function getAccountProfile(accountId: string): Promise<QortiumAccountProfile> {
  const store = await readWalletStore();
  const { address: accountAddress, addressIndex, wallet } = requireWalletAccount(store, accountId);

  let nodeApiUrl = '';

  try {
    nodeApiUrl = await resolveNodeApiUrl(await readNodeSettings());
  } catch {
    nodeApiUrl = '';
  }

  const name = nodeApiUrl
    ? (await getPrimaryName(accountAddress, nodeApiUrl)) ??
      (await getFirstOwnedName(accountAddress, nodeApiUrl))
    : null;

  return {
    accountId,
    address: accountAddress,
    label: addressIndex === 0 ? wallet.label : `${wallet.label} · ${addressIndex}`,
    name,
  };
}

// Compatibility only: pointer-aware apps use FETCH_ACCOUNT_AVATAR. Keeping this
// URL avoids breaking older apps without making a 500-account identity batch
// download and base64-encode every avatar.
async function getAccountAvatarHint(name: string | null) {
  let nodeApiUrl = '';

  try {
    nodeApiUrl = await resolveNodeApiUrl(await readNodeSettings());
  } catch {
    return getLegacyAccountAvatarHint('', name);
  }

  return getLegacyAccountAvatarHint(nodeApiUrl, name);
}

function isAccountUnlocked(accountId: string) {
  return unlockedWalletSeeds.has(getWalletIdForAccountId(accountId));
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
    nodeApiUrl = await resolveNodeApiUrl(await readNodeSettings());
  } catch {
    nodeApiUrl = '';
  }

  return Promise.all(
    addresses.map(async (address) => {
      let name: string | null = null;

      if (nodeApiUrl) {
        try {
          name =
            (await getPrimaryName(address, nodeApiUrl)) ?? (await getFirstOwnedName(address, nodeApiUrl));
        } catch {
          name = null;
        }
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

async function getSelectedAccountForQdnApp(context: QdnAppRequestContext | undefined) {
  if (!context) {
    throw new Error('GET_SELECTED_ACCOUNT is only available from a QDN app frame.');
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

async function waitForSelectedAccountUnlock(context: QdnAppRequestContext) {
  if (!context.accountId) {
    return false;
  }

  const startedAt = Date.now();

  while (Date.now() - startedAt < QDN_UNLOCK_STATE_WAIT_MS) {
    if (isAccountUnlocked(context.accountId)) {
      return true;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }

  return isAccountUnlocked(context.accountId);
}

async function requestSelectedAccountUnlockForQdnApp(context: QdnAppRequestContext) {
  if (!context.accountId) {
    throw new Error('No account is selected for this tab.');
  }

  if (isAccountUnlocked(context.accountId)) {
    return true;
  }

  if (qdnUnlockListeners.size === 0) {
    throw new Error('QDN account unlock is unavailable.');
  }

  const profile = await getAccountProfile(context.accountId);
  const requestId = createRequestId();

  const approved = await new Promise<boolean>((resolve) => {
    const timeoutId = window.setTimeout(() => {
      pendingQdnUnlockApprovals.delete(requestId);
      resolve(false);
    }, QDN_WRITE_APPROVAL_TIMEOUT_MS);

    pendingQdnUnlockApprovals.set(requestId, {
      resolve,
      timeoutId,
    });

    for (const listener of qdnUnlockListeners) {
      listener({
        accountId: profile.accountId,
        accountLabel: profile.label,
        accountName: profile.name,
        address: profile.address,
        id: requestId,
        resourceUrl: context.resourceUrl || 'QDN app',
      });
    }
  });

  return approved ? waitForSelectedAccountUnlock(context) : false;
}

async function unlockSelectedAccountForQdnApp(context: QdnAppRequestContext | undefined) {
  if (!context) {
    throw new Error('UNLOCK_SELECTED_ACCOUNT is only available from a QDN app frame.');
  }

  if (!context.accountId) {
    throw new Error('No account is selected for this tab.');
  }

  await requestSelectedAccountUnlockForQdnApp(context);

  return getSelectedAccountForQdnApp(context);
}

function getInlinePublishSource(request: QdnAppRequest): QdnPublishSourceResult | null {
  const dataBase64 = getInlinePublishData(request);

  if (!dataBase64) {
    return null;
  }

  let size: number;

  try {
    size = base64ToBytes(dataBase64).byteLength;
  } catch {
    throw new Error('QDN publish data must be valid base64.');
  }

  if (size > QDN_WRITE_SOURCE_MAX_BYTES) {
    throw new Error(
      `QDN publish data exceeds the ${QDN_WRITE_SOURCE_MAX_BYTES.toLocaleString()} byte limit.`,
    );
  }

  const fileName = sanitizeFilename(getString(getRequestValue(request, 'filename')), 'qdn-resource');

  return {
    canceled: false,
    dataBase64,
    fileName,
    isZip: isQdnPublishZip(fileName, dataBase64),
    kind: 'data',
    size,
  };
}

function getRequestedQdnPublishSourceKind(request: QdnAppRequest, fallback: QdnPublishSourcePickKind) {
  const kind = getString(getRequestValue(request, 'kind')).toLowerCase();

  return kind === 'directory' ? 'directory' : kind === 'file' ? 'file' : fallback;
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

function appendQdnWriteQuery(
  queryParams: URLSearchParams,
  resource: QdnWriteResourceRequest,
  source?: QdnPublishSourceResult,
) {
  appendQueryValue(queryParams, 'title', resource.title);
  appendQueryValue(queryParams, 'description', resource.description);
  appendQueryValue(queryParams, 'category', resource.category);
  appendQueryValue(queryParams, 'fee', resource.fee);

  if (source && !source.canceled) {
    appendQueryValue(queryParams, 'filename', source.fileName);
  }

  for (const tag of resource.tags) {
    appendQueryValue(queryParams, 'tags', tag);
  }
}

function buildQdnPublishBase64Path(resource: QdnWriteResourceRequest, source: QdnPublishSourceResult) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQdnWriteQuery(queryParams, resource, source);

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

function buildQdnPublishUploadPath(resource: QdnWriteResourceRequest, source: QdnPublishSourceResult) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQdnWriteQuery(queryParams, resource, source);
  appendQueryValue(queryParams, 'isZip', source.canceled === false && source.isZip === true ? true : undefined);

  const queryString = queryParams.toString();

  return `/arbitrary/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}/upload${
    queryString ? `?${queryString}` : ''
  }`;
}

function buildQdnPublicPublishBase64Path(resource: QdnWriteResourceRequest, source: QdnPublishSourceResult) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQdnWriteQuery(queryParams, resource, source);

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

function buildQdnPublicPublishUploadPath(resource: QdnWriteResourceRequest, source: QdnPublishSourceResult) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQdnWriteQuery(queryParams, resource, source);
  appendQueryValue(queryParams, 'isZip', source.canceled === false && source.isZip === true ? true : undefined);

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

function getNodeApiKey(settings: StoredNodeSettings) {
  if (!settings.apiKey) {
    throw new Error('Qortium node API key was not found.');
  }

  return settings.apiKey;
}

function isPlatformNodeApiKeyTransportSafe(nodeApiUrl: string) {
  if (isNodeApiKeyTransportSafe(nodeApiUrl)) {
    return true;
  }

  // Android emulators expose their host machine at 10.0.2.2. Home's built-in
  // local-node URL uses that explicit address, so it is the one non-loopback
  // HTTP endpoint that remains local to this app runtime.
  try {
    const url = new URL(nodeApiUrl);
    return isAndroid() && url.protocol === 'http:' && url.hostname === '10.0.2.2';
  } catch {
    return false;
  }
}

function getSendablePlatformNodeApiKey(settings: StoredNodeSettings, nodeApiUrl: string) {
  return isPlatformNodeApiKeyTransportSafe(nodeApiUrl) ? settings.apiKey : '';
}

function getProtectedPlatformNodeApiKey(settings: StoredNodeSettings, nodeApiUrl: string) {
  const apiKey = getNodeApiKey(settings);

  if (!isPlatformNodeApiKeyTransportSafe(nodeApiUrl)) {
    throw new Error(
      'Home will not send an API key to a remote node over plaintext HTTP. Use HTTPS, or connect through the local node.',
    );
  }

  return apiKey;
}

function isLocalWriteHostname(hostname: string) {
  const normalizedHostname = hostname.toLowerCase();

  return (
    normalizedHostname === '10.0.2.2' ||
    normalizedHostname === 'localhost' ||
    normalizedHostname === '::1' ||
    normalizedHostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(normalizedHostname)
  );
}

function assertLocalWriteConnection(settings: StoredNodeSettings, nodeApiUrl: string) {
  if (settings.mode === 'network') {
    throw networkRestrictionError();
  }

  let url: URL;

  try {
    url = new URL(nodeApiUrl);
  } catch {
    throw new Error('QDN write requests require a local Core node.');
  }

  if (!isLocalWriteHostname(url.hostname)) {
    throw new Error('QDN write requests require a local Core node so Home never sends private keys to a remote node.');
  }
}

function isLocalWriteConnection(settings: StoredNodeSettings, nodeApiUrl: string) {
  if (settings.mode === 'network') {
    return false;
  }

  try {
    return isLocalWriteHostname(new URL(nodeApiUrl).hostname);
  } catch {
    return false;
  }
}

async function getAccountSigningKey(accountId: string) {
  const store = await readWalletStore();
  const { address: accountAddress, addressIndex, wallet } = requireWalletAccount(store, accountId);
  const seed = unlockedWalletSeeds.get(wallet.id);

  if (!seed) {
    throw new Error('Selected account is locked.');
  }

  // Private-key wallets store the key itself; seed wallets derive it by index.
  const privateKey =
    isPrivateKeyWallet(wallet.encryptedWallet) && addressIndex === 0
      ? seed
      : deriveAddressSeed(seed, addressIndex);
  const keyPair = nacl.sign.keyPair.fromSeed(privateKey);
  const address = await publicKeyToAddress(keyPair.publicKey);

  if (address !== accountAddress) {
    throw new Error('Selected account signing key does not match the saved account address.');
  }

  return {
    address,
    privateKey58: base58Encode(privateKey),
    publicKey58: base58Encode(keyPair.publicKey),
  };
}

async function getAccountForeignWalletSeed(accountId: string) {
  const store = await readWalletStore();
  const { addressIndex, wallet } = requireWalletAccount(store, accountId);
  const seed = unlockedWalletSeeds.get(wallet.id);

  if (!seed) {
    throw new Error('Selected account is locked.');
  }

  return {
    addressIndex,
    seed: Uint8Array.from(seed),
    walletVersion: isPrivateKeyWallet(wallet.encryptedWallet) ? 1 : wallet.encryptedWallet.version || QORTIUM_WALLET_VERSION,
  };
}

// Resolves the 64-byte ed25519 secret key (and base58 public key) for an
// account WITHOUT base58-encoding the private key. Used by the keyless
// open-group chat path so the raw key is signed with locally and never sent to
// any node. Still requires the account to be unlocked.
async function getAccountSecretKey(accountId: string) {
  const store = await readWalletStore();
  const { address: accountAddress, addressIndex, wallet } = requireWalletAccount(store, accountId);
  const seed = unlockedWalletSeeds.get(wallet.id);

  if (!seed) {
    throw new Error('Selected account is locked.');
  }

  const privateKey =
    isPrivateKeyWallet(wallet.encryptedWallet) && addressIndex === 0
      ? seed
      : deriveAddressSeed(seed, addressIndex);
  const keyPair = nacl.sign.keyPair.fromSeed(privateKey);
  const address = await publicKeyToAddress(keyPair.publicKey);

  if (address !== accountAddress) {
    throw new Error('Selected account signing key does not match the saved account address.');
  }

  return {
    address,
    publicKey58: base58Encode(keyPair.publicKey),
    secretKey: keyPair.secretKey,
  };
}

// Like getQdnWriteContext but for the keyless open-group chat path: it allows a
// public/network node because the private key is NEVER sent to it (the message
// is signed locally). It still requires a selected, unlocked account and the
// caller still runs the SEND_CHAT_MESSAGE approval prompt.
async function getKeylessChatContext(context: QdnAppRequestContext | undefined) {
  if (!context) {
    throw new Error('QDN app requests are only available from a QDN app frame.');
  }

  if (!context.accountId) {
    throw new Error('No account is selected for this tab.');
  }

  const settings = await readNodeSettings();
  const nodeApiUrl = await resolveNodeApiUrl(settings);
  const apiKey = getSendablePlatformNodeApiKey(settings, nodeApiUrl);
  const profile = await getAccountProfile(context.accountId);
  const signingKey = await getAccountSecretKey(context.accountId);

  return {
    accountId: context.accountId,
    apiKey,
    mode: settings.mode,
    nodeApiUrl,
    profile,
    publicKey58: signingKey.publicKey58,
    secretKey: signingKey.secretKey,
  };
}

async function getKeylessQdnWriteContext(
  context: QdnAppRequestContext | undefined,
): Promise<QdnKeylessWriteContext> {
  if (!context) {
    throw new Error('QDN app requests are only available from a QDN app frame.');
  }

  if (!context.accountId) {
    throw new Error('No account is selected for this tab.');
  }

  const settings = await readNodeSettings();
  const nodeApiUrl = await resolveNodeApiUrl(settings);
  const apiKey = getSendablePlatformNodeApiKey(settings, nodeApiUrl);
  const profile = await getAccountProfile(context.accountId);
  const signingKey = await getAccountSecretKey(context.accountId);

  return {
    accountId: context.accountId,
    apiKey,
    mode: settings.mode,
    nodeApiUrl,
    profile,
    publicKey58: signingKey.publicKey58,
    secretKey: signingKey.secretKey,
  };
}

async function isKeylessWriteContextFresh(
  context: QdnAppRequestContext,
  keylessContext: QdnKeylessWriteContext,
) {
  if (context.isCurrent && !context.isCurrent()) return false;
  if (context.accountId !== keylessContext.accountId || !isAccountUnlocked(keylessContext.accountId)) return false;
  const settings = await readNodeSettings();
  // This used to demand mode === 'network', which no 'custom' connection could
  // ever satisfy, so every keyless write to a configured remote node failed
  // after proof-of-work with QDN_POW_CANCELLED. The question it was really
  // asking is "is this still the node I built against, reached the same way",
  // which is what the shared route comparison answers - and answers more
  // tightly, because a node whose API key was removed mid-publish drops route
  // and is now caught. Shared with electron/qdn.ts so the two transports cannot
  // drift apart on it again.
  const nodeApiUrl = await resolveNodeApiUrl(settings);

  return isSameQdnWriteRoute(
    {
      apiKey: getSendablePlatformNodeApiKey(settings, nodeApiUrl),
      mode: settings.mode,
      nodeApiUrl: nodeApiUrl,
    },
    { apiKey: keylessContext.apiKey, mode: keylessContext.mode, nodeApiUrl: keylessContext.nodeApiUrl },
  );
}

async function getQdnWriteContext(context: QdnAppRequestContext | undefined): Promise<QdnWriteContext> {
  if (!context) {
    throw new Error('QDN app requests are only available from a QDN app frame.');
  }

  if (!context.accountId) {
    throw new Error('No account is selected for this tab.');
  }

  const settings = await readNodeSettings();
  const nodeApiUrl = await resolveNodeApiUrl(settings);
  const apiKey = getNodeApiKey(settings);

  assertLocalWriteConnection(settings, nodeApiUrl);

  const profile = await getAccountProfile(context.accountId);
  const signingKey = await getAccountSigningKey(context.accountId);

  return {
    accountId: context.accountId,
    apiKey,
    nodeApiUrl,
    profile,
    privateKey58: signingKey.privateKey58,
    publicKey58: signingKey.publicKey58,
  };
}

function normalizeQdnPublishSourceResult(value: unknown): QdnPublishSourceResult {
  if (!isRecord(value)) {
    throw new Error('QDN publish file selection did not return a valid result.');
  }

  if (value.canceled === true) {
    return {
      canceled: true,
    };
  }

  const dataBase64 = getString(value.dataBase64);
  const fileName = sanitizeFilename(getString(value.fileName), 'qdn-resource');
  const size = getNumber(value.size) ?? base64ToBytes(dataBase64).byteLength;

  if (!dataBase64) {
    throw new Error('Selected QDN publish file did not include data.');
  }

  if (size > QDN_WRITE_SOURCE_MAX_BYTES) {
    throw new Error(
      `Selected QDN publish file exceeds the ${QDN_WRITE_SOURCE_MAX_BYTES.toLocaleString()} byte limit.`,
    );
  }

  return {
    canceled: false,
    dataBase64,
    fileName,
    isZip: isQdnPublishZip(fileName, dataBase64),
    kind: getString(value.kind) === 'directory' ? 'directory' : getString(value.kind) === 'data' ? 'data' : 'file',
    mimeType: getString(value.mimeType) || undefined,
    size,
    uri: getString(value.uri) || undefined,
  };
}

function assertPublicQdnStreamedPublishSize(size: number, label: string) {
  if (size > QDN_PUBLIC_STREAMED_PUBLISH_MAX_BYTES) {
    throw new Error(`${label} exceeds the ${QDN_PUBLIC_STREAMED_PUBLISH_MAX_BYTES.toLocaleString()} byte public-node publish limit.`);
  }
}

async function selectQdnPublishSource() {
  const result = await QdnPublishSource.selectFile({
    maxBytes: QDN_WRITE_SOURCE_MAX_BYTES,
  });

  return normalizeQdnPublishSourceResult(result);
}

async function selectQdnPublishDirectorySource() {
  const result = await QdnPublishSource.selectDirectory({
    maxBytes: QDN_WRITE_SOURCE_MAX_BYTES,
  });
  const source = normalizeQdnPublishSourceResult(result);

  return source.canceled ? source : { ...source, kind: 'directory' as const };
}

function getQdnPublishSourceTokenContextKey(context: QdnAppRequestContext | undefined) {
  return [
    context?.sessionKey ?? '',
    context?.resourceUrl ?? '',
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

// On Android the token entries hold the selected file's full bytes, and
// pruning otherwise only runs on token/cache activity — an idle session would
// keep a denied/failed publish's bytes in memory past the TTL indefinitely.
// The timer makes the TTL an upper bound for both stores.
window.setInterval(() => {
  pruneQdnPublishSourceTokens();
  pruneNativePreviewCache();
}, 5 * 60_000);

function cacheQdnPublishSourceToken(context: QdnAppRequestContext | undefined, source: QdnPublishSourceResult & { canceled: false }) {
  const now = Date.now();
  const token = createToken();

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

function getQdnPublishSourceFromTokenString(
  sourceToken: string,
  context: QdnAppRequestContext | undefined,
) {
  if (!sourceToken) {
    return null;
  }

  pruneQdnPublishSourceTokens();
  const entry = qdnPublishSourceTokens.get(sourceToken);

  if (!entry) {
    throw new Error('Selected QDN publish source is no longer available. Select the file again.');
  }

  if (entry.contextKey !== getQdnPublishSourceTokenContextKey(context)) {
    throw new Error('Selected QDN publish source is not available to this app.');
  }

  entry.lastUsedAt = Date.now();

  return entry.source;
}

function getQdnPublishSourceFromToken(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  return getQdnPublishSourceFromTokenString(getQdnPublishSourceToken(request), context);
}

function releaseQdnPublishSourceToken(request: QdnAppRequest) {
  const token = getQdnPublishSourceToken(request);

  releaseQdnPublishSourceTokenFromString(token);
}

function releaseQdnPublishSourceTokenFromString(sourceToken: string) {
  if (!sourceToken) {
    return;
  }

  qdnPublishSourceTokens.delete(sourceToken);
}

async function selectQdnPublishSourceForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const kind = getRequestedQdnPublishSourceKind(request, 'file');
  const source = kind === 'directory' ? await selectQdnPublishDirectorySource() : await selectQdnPublishSource();

  if (source.canceled) {
    return {
      canceled: true,
    };
  }

  return {
    canceled: false,
    fileName: source.fileName,
    kind: source.kind ?? kind,
    mimeType: source.mimeType,
    size: source.size,
    sourceToken: cacheQdnPublishSourceToken(context, source),
  };
}

async function previewQdnPublishSourceForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const source = getQdnPublishSourceFromToken(request, context);

  if (!source) {
    throw new Error('Select a QDN publish source before previewing it.');
  }

  if (!context?.onOpenPublishSourcePreview) {
    throw new Error('Selected source preview is not available in this context.');
  }

  const { archive, service } = source.kind === 'directory'
    ? { archive: true, service: 'WEBSITE' }
    : resolvePreviewServiceForFile(source.fileName);
  const settings = await readNodeSettings();
  const nodeApiUrl = await resolveNodeApiUrl(settings);
  assertLocalWriteConnection(settings, nodeApiUrl);
  const apiKey = getNodeApiKey(settings);
  const query = `archive=${archive ? 'true' : 'false'}&filename=${encodeURIComponent(source.fileName)}`;
  const result = await postLocalNodeText(
    nodeApiUrl,
    `/arbitrary/preview/${service}/upload?${query}`,
    source.dataBase64,
    apiKey,
    'Generating the preview failed.',
  );
  const renderPath = result.body.trim();

  if (!renderPath.startsWith('/render/')) {
    throw new Error('The node returned an unexpected preview URL.');
  }

  // Keep the local Core render URL inside Home. Returning it to the QDN app
  // would let app JavaScript fetch selected bytes before publish approval.
  context.onOpenPublishSourcePreview({
    renderUrl: `${getNodeApiUrlBase(nodeApiUrl)}${renderPath}`,
    service,
    sourceKind: archive ? 'directory' as const : 'file' as const,
    sourceName: source.fileName,
  });

  return true;
}

async function selectNativePreviewDirectorySource(): Promise<Omit<NativePreviewCacheEntry, 'createdAt' | 'lastUsedAt'> | null> {
  const result = normalizeQdnPublishSourceResult(
    await QdnPublishSource.selectDirectory({
      maxBytes: QDN_WRITE_SOURCE_MAX_BYTES,
    }),
  );

  if (result.canceled) {
    return null;
  }

  return {
    archive: true,
    base64: result.dataBase64,
    service: 'WEBSITE',
    sourceKind: 'directory',
    sourceName: result.fileName,
    sourcePath: result.fileName,
  };
}

async function requestQdnWriteApproval(
  context: QdnAppRequestContext,
  profile: QortiumAccountProfile | null,
  details: QdnWriteApprovalDetails,
  denialMessage = 'QDN write request was denied.',
) {
  if (qdnWriteListeners.size === 0) {
    throw new Error('QDN write request approval is unavailable.');
  }

  const requestId = createRequestId();
  const approved = await new Promise<boolean>((resolve) => {
    const timeoutId = window.setTimeout(() => {
      pendingQdnWriteApprovals.delete(requestId);
      resolve(false);
    }, QDN_WRITE_APPROVAL_TIMEOUT_MS);

    pendingQdnWriteApprovals.set(requestId, {
      resolve,
      timeoutId,
    });

    for (const listener of qdnWriteListeners) {
      listener({
        accountName: profile?.name ?? null,
        action: details.action,
        address: profile?.address ?? '',
        amount: typeof details.amount === 'undefined' ? null : String(details.amount),
        approval: typeof details.approval === 'boolean' ? details.approval : null,
        chatMessagePreview: details.chatMessagePreview ?? null,
        details: details.details ?? [],
        groupId: typeof details.groupId === 'number' ? details.groupId : null,
        groupName: details.groupName ?? null,
        id: requestId,
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
        resourceUrl: context.resourceUrl || 'QDN app',
        sourceKind: details.source?.canceled === false ? details.source.kind ?? 'file' : null,
        sourceName: details.source?.canceled === false ? details.source.fileName : null,
      });
    }
  });

  if (!approved) {
    throw new Error(denialMessage);
  }
}

async function requestQdnChatPermissionApproval(
  context: QdnAppRequestContext,
  profile: QortiumAccountProfile,
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

// Notification permission is app-scoped, not account-scoped. The stable
// resource URL is the durable grant and rule-storage identity.
function getQdnNotificationPermissionCacheKey(context: QdnAppRequestContext) {
  if (!context.resourceUrl) throw new Error('QDN app notification request is missing its stable resource URL.');
  return sanitizeQdnManagerAppKey(context.resourceUrl);
}

// "qdn://APP/name/path" → "name"; falls back to the full resource URL so the
// notification always carries some app provenance.
function getQdnAppDisplayName(resourceUrl: string) {
  const match = /^qdn:\/\/[^/]+\/([^/]+)/i.exec(resourceUrl);

  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  return resourceUrl || 'QDN app';
}

// Mirrors electron/qdn.ts requestQdnNotificationPermissionApproval: the same
// durable approval dialog, but with no account context (notifications are not
// an account action).
async function requestQdnNotificationPermissionApproval(
  context: QdnAppRequestContext,
  action: 'SHOW_NOTIFICATION' | 'NOTIFICATION_ADD',
) {
  const cacheKey = getQdnNotificationPermissionCacheKey(context);

  if ((await getNotificationStore()).grants[cacheKey]) {
    return;
  }

  await requestQdnWriteApproval(
    context,
    null,
    { action, permissionScope: 'always' },
    'Notification permission was denied.',
  );

  await grantAppNotifications(cacheKey);
}

async function showNotificationForApp(request: QdnAppRequest, context: QdnAppRequestContext) {
  const title = sanitizeQdnAppTitle(getRequestValue(request, 'title'));

  if (!title) {
    throw new Error('Notification title is required.');
  }

  const text = sanitizeQdnAppTitle(
    getRequestValue(request, 'text'),
    QDN_APP_NOTIFICATION_TEXT_MAX_LENGTH,
  );

  await requestQdnNotificationPermissionApproval(context, 'SHOW_NOTIFICATION');

  const appKey = getQdnNotificationPermissionCacheKey(context);
  if ((await getNotificationStore()).grants[appKey]?.muted) {
    return { shown: false, reason: 'muted' };
  }

  if (!(await loadDisplaySettings()).appNotifications) {
    return { shown: false, reason: 'disabled' };
  }

  // No notification while the user is already looking at the app.
  if (context.isViewFocused?.() ?? false) {
    return { shown: false, reason: 'focused' };
  }

  const rateKey = appKey;
  const now = Date.now();
  const lastShownAt = lastQdnAppNotificationAt.get(rateKey) ?? 0;

  if (now - lastShownAt < QDN_APP_NOTIFICATION_MIN_INTERVAL_MS) {
    return { shown: false, reason: 'rate-limited' };
  }

  lastQdnAppNotificationAt.set(rateKey, now);

  // The app name suffix keeps provenance visible so one app cannot pose as
  // another (or as Home itself) in the notification shade.
  const displayTitle = `${title} — ${getQdnAppDisplayName(context.resourceUrl)}`;

  const getLatestBlockReason = async () => {
    const [latestStore, latestSettings] = await Promise.all([
      getNotificationStore(),
      loadDisplaySettings(),
    ]);
    const latestGrant = latestStore.grants[appKey];
    if (!latestGrant) return 'revoked';
    if (latestGrant.muted) return 'muted';
    if (!latestSettings.appNotifications) return 'disabled';
    return null;
  };

  if (Capacitor.isNativePlatform()) {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const permission = await LocalNotifications.requestPermissions();

    if (permission.display !== 'granted') {
      return { shown: false, reason: 'disabled' };
    }

    const blockReason = await getLatestBlockReason();
    if (blockReason) {
      return { shown: false, reason: blockReason };
    }

    await LocalNotifications.schedule({
      notifications: [
        {
          body: text ?? '',
          id: nextLocalNotificationId++,
          title: displayTitle,
        },
      ],
    });

    return { shown: true };
  }

  // Desktop/browser fallback bridge (no Electron main process): the web
  // Notification API is the only channel available.
  if (typeof window.Notification === 'function') {
    if (window.Notification.permission !== 'granted') {
      const permission = await window.Notification.requestPermission();

      if (permission !== 'granted') {
        return { shown: false, reason: 'disabled' };
      }
    }

    const blockReason = await getLatestBlockReason();
    if (blockReason) {
      return { shown: false, reason: blockReason };
    }

    new window.Notification(displayTitle, { body: text ?? '' });

    return { shown: true };
  }

  return { shown: false, reason: 'unsupported' };
}

async function postLocalNodeText(
  nodeApiUrl: string,
  pathname: string,
  body: string,
  apiKey: string,
  fallbackMessage: string,
  contentType = 'text/plain',
  // Optional post-download size ceiling for signing-path callers (chat
  // build/process). Capacitor's native HTTP bridge has no partial-read/abort
  // API — it always downloads the full response before handing it back — so
  // this cannot bound memory used *during* the download; it only refuses to
  // let an oversized/hostile body be decoded, signed, or trusted further.
  // Existing callers that omit maxBytes keep their prior unbounded behavior.
  maxBytes?: number,
) {
  let response: HttpResponse;

  try {
    response = await CapacitorHttp.request({
      url: `${getNodeApiUrlBase(nodeApiUrl)}${pathname}`,
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'X-API-KEY': apiKey,
      },
      data: body,
      responseType: 'text',
      connectTimeout: REQUEST_TIMEOUT_MS,
      readTimeout: REQUEST_TIMEOUT_MS,
    });
  } catch {
    throw new Error(getNodeUnavailableMessage(nodeApiUrl));
  }

  const responseBody = stringifyResponseData(response.data).trim();

  if (typeof maxBytes === 'number' && new TextEncoder().encode(responseBody).length > maxBytes) {
    throw new Error('Node API response exceeded the requested size limit.');
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(readableNodeErrorMessage(responseBody, fallbackMessage));
  }

  return {
    body: responseBody,
    contentType: getContentType(response),
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

async function postLocalNodeBytes(
  nodeApiUrl: string,
  pathname: string,
  body: Blob,
  apiKey: string,
  fallbackMessage: string,
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await window.fetch(`${getNodeApiUrlBase(nodeApiUrl)}${pathname}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-API-KEY': apiKey,
      },
      body,
      signal: controller.signal,
    });
  } catch {
    throw new Error(getNodeUnavailableMessage(nodeApiUrl));
  } finally {
    window.clearTimeout(timeout);
  }

  const responseBody = (await response.text()).trim();

  if (!response.ok) {
    throw new QdnUploadPostError(response.status, readableNodeErrorMessage(responseBody, fallbackMessage));
  }

  return {
    body: responseBody,
    contentType: response.headers.get('content-type') ?? '',
  };
}

// Maps a file extension to the QDN service used to preview it (mirrors the desktop preview).
const PREVIEW_EXTENSION_SERVICES: Record<string, string> = {
  apng: 'IMAGE', avif: 'IMAGE', bmp: 'IMAGE', gif: 'IMAGE', ico: 'IMAGE',
  jpeg: 'IMAGE', jpg: 'IMAGE', png: 'IMAGE', svg: 'IMAGE', webp: 'IMAGE',
  m4v: 'VIDEO', mkv: 'VIDEO', mov: 'VIDEO', mp4: 'VIDEO', ogv: 'VIDEO', webm: 'VIDEO',
  aac: 'AUDIO', flac: 'AUDIO', m4a: 'AUDIO', mp3: 'AUDIO', oga: 'AUDIO', ogg: 'AUDIO', opus: 'AUDIO', wav: 'AUDIO',
};

const PREVIEW_PICK_ACCEPT = ['.zip', '.html', '.htm', ...Object.keys(PREVIEW_EXTENSION_SERVICES).map((ext) => `.${ext}`)].join(',');
const NATIVE_PREVIEW_CACHE_TTL_MS = 30 * 60_000;
const NATIVE_PREVIEW_CACHE_MAX_ENTRIES = 4;

type NativePreviewCacheEntry = {
  archive: boolean;
  base64: string;
  createdAt: number;
  lastUsedAt: number;
  service: string;
  sourceKind: 'directory' | 'file';
  sourceName: string;
  sourcePath: string;
};

const nativePreviewCache = new Map<string, NativePreviewCacheEntry>();

function resolvePreviewServiceForFile(filename: string): { service: string; archive: boolean } {
  const extension = filename.includes('.') ? filename.slice(filename.lastIndexOf('.') + 1).toLowerCase() : '';

  if (extension === 'zip') {
    // A zipped website folder; the node extracts it.
    return { service: 'WEBSITE', archive: true };
  }
  if (extension === 'html' || extension === 'htm') {
    // A standalone page; the node wraps it as index.html for the website service.
    return { service: 'WEBSITE', archive: false };
  }

  const service = PREVIEW_EXTENSION_SERVICES[extension];
  if (!service) {
    throw new Error(
      'Unsupported preview content. Choose an image, video, or audio file, an HTML file, or a .zip of a website folder.',
    );
  }

  return { service, archive: false };
}

function createNativePreviewToken() {
  return window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function pruneNativePreviewCache(now = Date.now()) {
  for (const [token, entry] of nativePreviewCache) {
    if (now - entry.lastUsedAt > NATIVE_PREVIEW_CACHE_TTL_MS) {
      nativePreviewCache.delete(token);
    }
  }

  while (nativePreviewCache.size > NATIVE_PREVIEW_CACHE_MAX_ENTRIES) {
    let oldestToken = '';
    let oldestLastUsedAt = Number.POSITIVE_INFINITY;

    for (const [token, entry] of nativePreviewCache) {
      if (entry.lastUsedAt < oldestLastUsedAt) {
        oldestToken = token;
        oldestLastUsedAt = entry.lastUsedAt;
      }
    }

    if (!oldestToken) {
      return;
    }

    nativePreviewCache.delete(oldestToken);
  }
}

function cacheNativePreviewEntry(entry: Omit<NativePreviewCacheEntry, 'createdAt' | 'lastUsedAt'>) {
  const now = Date.now();
  const token = createNativePreviewToken();

  nativePreviewCache.set(token, {
    ...entry,
    createdAt: now,
    lastUsedAt: now,
  });
  pruneNativePreviewCache(now);

  return token;
}

function getNativePreviewCacheEntry(token: string) {
  pruneNativePreviewCache();

  const entry = nativePreviewCache.get(token);

  if (!entry) {
    return null;
  }

  entry.lastUsedAt = Date.now();

  return entry;
}

// Opens a file picker in the WebView and resolves with the chosen file, or null if dismissed.
// Cancellation produces no 'change' event, so it is detected when the window regains focus.
function pickPreviewFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = PREVIEW_PICK_ACCEPT;
    input.style.position = 'fixed';
    input.style.left = '-9999px';

    let settled = false;
    const finish = (file: File | null) => {
      if (settled) {
        return;
      }
      settled = true;
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(file);
    };

    const onChange = () => finish(input.files && input.files.length > 0 ? input.files[0] : null);
    const onFocus = () => {
      window.setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) {
          finish(null);
        }
      }, 700);
    };

    input.addEventListener('change', onChange, { once: true });
    window.addEventListener('focus', onFocus);
    document.body.appendChild(input);
    input.click();
  });
}

async function deleteLocalNodeText(
  nodeApiUrl: string,
  pathname: string,
  body: string,
  apiKey: string,
  fallbackMessage: string,
  contentType = 'text/plain',
) {
  let response: HttpResponse;

  try {
    response = await CapacitorHttp.request({
      url: `${getNodeApiUrlBase(nodeApiUrl)}${pathname}`,
      method: 'DELETE',
      headers: {
        'Content-Type': contentType,
        'X-API-KEY': apiKey,
      },
      data: body,
      responseType: 'text',
      connectTimeout: REQUEST_TIMEOUT_MS,
      readTimeout: REQUEST_TIMEOUT_MS,
    });
  } catch {
    throw new Error(getNodeUnavailableMessage(nodeApiUrl));
  }

  const responseBody = stringifyResponseData(response.data).trim();

  if (response.status < 200 || response.status >= 300) {
    throw new Error(readableNodeErrorMessage(responseBody, fallbackMessage));
  }

  return {
    body: responseBody,
    contentType: getContentType(response),
  };
}

async function signAndProcessTransaction(
  writeContext: QdnWriteContext,
  rawUnsignedBytes58: string,
  computePath: string | null = '/arbitrary/compute',
) {
  // A null computePath skips nonce computation for transaction types without a MemoryPoW fee alternative.
  const rawUnsignedWithNonce = computePath
    ? await postLocalNodeText(
        writeContext.nodeApiUrl,
        computePath,
        rawUnsignedBytes58,
        writeContext.apiKey,
        'QDN transaction nonce computation failed.',
      )
    : { body: rawUnsignedBytes58 };
  const signedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/transactions/sign',
    JSON.stringify({
      privateKey: writeContext.privateKey58,
      transactionBytes: rawUnsignedWithNonce.body,
    }),
    writeContext.apiKey,
    'QDN transaction signing failed.',
    'application/json',
  );
  const processedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/transactions/process',
    signedTransaction.body,
    writeContext.apiKey,
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

function stampTransactionNonce(unsignedTransactionBytes: Uint8Array, nonce: number) {
  if (!Number.isInteger(nonce) || nonce < 0 || nonce > 0xffffffff) {
    throw new Error('Transaction nonce must be a uint32.');
  }

  if (unsignedTransactionBytes.length < TRANSACTION_NONCE_OFFSET + 4) {
    throw new Error('Unsigned transaction bytes are too short to contain a nonce field.');
  }

  const bytesWithNonce = unsignedTransactionBytes.slice();
  const view = new DataView(bytesWithNonce.buffer, bytesWithNonce.byteOffset, bytesWithNonce.byteLength);
  view.setUint32(TRANSACTION_NONCE_OFFSET, nonce >>> 0, false);

  return bytesWithNonce;
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
    keylessContext.nodeApiUrl,
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

async function fetchPublicQdnAttestationArtifact(nodeApiUrl: string, hash: Uint8Array, maxBytes: number) {
  if (hash.length !== 32) throw new Error('Public QDN builder returned an invalid attestation hash.');
  let result: Awaited<ReturnType<typeof fetchBoundedBytes>>;
  try {
    result = await fetchBoundedBytes(
      (signal) => window.fetch(
        `${getNodeApiUrlBase(nodeApiUrl)}/arbitrary/public/data/${encodeURIComponent(base58Encode(hash))}`,
        { cache: 'no-store', signal },
      ),
      maxBytes,
    );
  } catch (error) {
    throw new Error(
      `Public QDN content attestation requires a bounded streaming connection to the selected node: ${error instanceof Error ? error.message : 'request failed'}`,
    );
  }
  const { bytes, response } = result;
  if (response.status < 200 || response.status >= 300) {
    throw new Error(readableNodeErrorMessage(
      new TextDecoder().decode(bytes),
      `Public QDN content attestation failed with HTTP ${response.status}.`,
    ));
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
  nodeApiUrl: string,
  resource: QdnWriteResourceRequest,
  source: QdnPublishAttestationSource,
) {
  return (details: ReturnType<typeof assertPublicArbitraryTransaction>) => attestPublicQdnPublish({
    details,
    expectedMetadata: qdnPublishAttestationMetadata(resource),
    fetchArtifact: (hash, maxBytes) => fetchPublicQdnAttestationArtifact(nodeApiUrl, hash, maxBytes),
    source,
    verify: runPublicQdnAttestationWorker,
  });
}

function runPublicQdnAttestationWorker(input: QdnPublishVerificationInput) {
  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL('./qdnAttestation.worker.ts', import.meta.url), { type: 'module' });
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('QDN content attestation worker timed out.'));
    }, MEMORY_POW_TIMEOUT_MS);
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      worker.terminate();
      error ? reject(error) : resolve();
    };
    worker.onerror = () => finish(new Error('QDN content attestation worker failed.'));
    worker.onmessage = (event: MessageEvent<{ error?: string; ok?: boolean }>) => {
      event.data?.ok ? finish() : finish(new Error(event.data?.error || 'QDN content attestation worker failed.'));
    };
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
) {
  const unsignedBytes = base58Decode(rawUnsignedBytes58);
  validate(unsignedBytes);
  const nonce = await computeChatNonce(clearTransactionNonce(unsignedBytes), difficulty, isStillValid);
  const bytesWithNonce = stampTransactionNonce(unsignedBytes, nonce);
  if (keylessContext.secretKey.length !== 64) throw new Error('ed25519 secret key must be 64 bytes.');
  const signature = nacl.sign.detached(bytesWithNonce, keylessContext.secretKey);
  const signedTransactionBytes = base58Encode(appendSignatureToTransactionBytes(bytesWithNonce, signature));
  if (isStillValid && !(await isStillValid())) {
    throw qdnCodedError('QDN_POW_CANCELLED', 'The signing context changed before the transaction could be submitted.');
  }
  const processedTransaction = await postLocalNodeText(
    keylessContext.nodeApiUrl,
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

async function fetchLocalNodeApiPayload(
  nodeApiUrl: string,
  apiPath: string,
  fallbackMessage: string,
  // See postLocalNodeText: Capacitor downloads the full body before we see
  // it, so this only refuses to trust/parse an oversized response, applied
  // only where the caller opts in. Existing callers keep prior behavior.
  maxBytes?: number,
) {
  const response = await requestNode(nodeApiUrl, apiPath, 'text');
  const body = stringifyResponseData(response.data);

  if (typeof maxBytes === 'number' && new TextEncoder().encode(body).length > maxBytes) {
    throw new Error('Node API response exceeded the requested size limit.');
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(readableNodeErrorMessage(body, fallbackMessage));
  }

  return parseResponseData(body, getContentType(response));
}

// A few hundred KB is ample for group metadata. Used explicitly (opt-in) by
// signing-path callers; the many existing getGroupDataForChat call sites
// below that don't pass maxBytes keep their prior unbounded behavior.
const CHAT_SIGNING_RESPONSE_MAX_BYTES = 256 * 1024;

async function getGroupDataForChat(nodeApiUrl: string, groupId: number, maxBytes?: number) {
  if (groupId === 0) {
    return null;
  }

  return fetchLocalNodeApiPayload(
    nodeApiUrl,
    `/groups/${encodeURIComponent(String(groupId))}`,
    'Group lookup failed.',
    maxBytes,
  );
}

async function getNameDataForApp(nodeApiUrl: string, name: string) {
  return fetchLocalNodeApiPayload(
    nodeApiUrl,
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

function getQdnPublishUploadSource(resource: QdnWriteResourceRequest, source: QdnPublishSourceResult & { canceled: false }) {
  const bytes = base64ToBytes(source.dataBase64);
  const shouldUnzip = shouldUseQdnPublishZipEndpoint(resource, source);

  return {
    body: new Blob([bytes as BlobPart], { type: 'application/octet-stream' }),
    source: {
      ...source,
      isZip: shouldUnzip ? true : undefined,
      size: bytes.byteLength,
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

async function publishQdnResourceForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const resource = getQdnWriteResourceRequest(request);
  const settings = await readNodeSettings();
  const nodeApiUrl = await resolveNodeApiUrl(settings);
  const useLocalWrite = isLocalWriteConnection(settings, nodeApiUrl);
  const writeContext = useLocalWrite
    ? await getQdnWriteContext(context)
    : await getKeylessQdnWriteContext(context);
  const source =
    getInlinePublishSource(request) ??
    getQdnPublishSourceFromToken(request, context) ??
    (await selectQdnPublishSource());

  if (source.canceled) {
    throw new Error('QDN publish was canceled.');
  }

  await requestQdnWriteApproval(
    context as QdnAppRequestContext,
    writeContext.profile,
    {
      action: 'PUBLISH_QDN_RESOURCE',
      resource,
      source,
    },
  );

  const uploadSource = getQdnPublishUploadSource(resource, source);

  if (!useLocalWrite) {
    assertPublicQdnStreamedPublishSize(uploadSource.source.size, 'Selected QDN publish source');
    if ((resource.fee ?? 0) !== 0) throw new Error('Public-node QDN writes require a zero fee.');
  }

  let unsignedTransaction: Awaited<ReturnType<typeof postLocalNodeText>>;

  try {
    unsignedTransaction = await postLocalNodeBytes(
      writeContext.nodeApiUrl,
      useLocalWrite
        ? buildQdnPublishUploadPath(resource, uploadSource.source)
        : buildQdnPublicPublishUploadPath(resource, uploadSource.source),
      uploadSource.body,
      writeContext.apiKey,
      'QDN publish transaction build failed.',
    );
  } catch (error) {
    if (!isQdnUploadEndpointUnsupported(error)) {
      throw error;
    }

    assertLegacyQdnPublishFallbackSize(uploadSource.source.size);
    unsignedTransaction = await postLocalNodeText(
      writeContext.nodeApiUrl,
      useLocalWrite
        ? shouldUseQdnPublishZipEndpoint(resource, source)
          ? buildQdnPublishZipPath(resource)
          : buildQdnPublishBase64Path(resource, source)
        : shouldUseQdnPublishZipEndpoint(resource, source)
          ? buildQdnPublicPublishZipPath(resource)
          : buildQdnPublicPublishBase64Path(resource, source),
      source.dataBase64,
      writeContext.apiKey,
      'QDN publish transaction build failed.',
    );
  }

  const processedTransaction = useLocalWrite
    ? await signAndProcessTransaction(writeContext as QdnWriteContext, unsignedTransaction.body)
    : await signAndProcessKeylessQdnTransaction(
        writeContext as QdnKeylessWriteContext,
        unsignedTransaction.body,
        {
          identifier: resource.identifier && resource.identifier !== 'default' ? resource.identifier : undefined,
          method: 0,
          name: resource.name,
          publicKey: base58Decode((writeContext as QdnKeylessWriteContext).publicKey58),
          service: getStaticQdnServiceId(resource.service),
          txGroupId: 0,
        },
        () => isKeylessWriteContextFresh(context as QdnAppRequestContext, writeContext as QdnKeylessWriteContext),
        createPublicQdnPublishAttestation(
          (writeContext as QdnKeylessWriteContext).nodeApiUrl,
          resource,
          {
            bytes: base64ToBytes(source.dataBase64),
            filename: source.fileName,
            unpackZip: uploadSource.source.isZip === true,
          },
        ),
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
  context: QdnAppRequestContext | undefined,
) {
  const resources = getQdnWriteResourceRequests(request);

  if (resources.some((entry) => !entry.source && !entry.sourceToken)) {
    throw new Error('PUBLISH_MULTIPLE_QDN_RESOURCES requires base64 data for each resource.');
  }

  const approvalResource = resources.length === 1 ? resources[0].resource : undefined;
  const settings = await readNodeSettings();
  const nodeApiUrl = await resolveNodeApiUrl(settings);
  const useLocalWrite = isLocalWriteConnection(settings, nodeApiUrl);
  const writeContext = useLocalWrite
    ? await getQdnWriteContext(context)
    : await getKeylessQdnWriteContext(context);

  await requestQdnWriteApproval(
    context as QdnAppRequestContext,
    writeContext.profile,
    {
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      resource: approvalResource,
      resourceCount: resources.length,
      source: {
        canceled: false,
        dataBase64: '',
        fileName: `${resources.length} resources`,
        kind: 'data',
        size: 0,
      },
    },
  );

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
          ? getQdnPublishSourceFromTokenString(sourceToken, context)
          : null);

      if (!source || source.canceled) {
        throw new Error('PUBLISH_MULTIPLE_QDN_RESOURCES requires base64 data for each resource.');
      }

      if (!useLocalWrite && (entry.resource.fee ?? 0) !== 0) {
        throw new Error('Public-node QDN writes require a zero fee.');
      }

      const unsignedTransaction = await postLocalNodeText(
        writeContext.nodeApiUrl,
        useLocalWrite
          ? shouldUseQdnPublishZipEndpoint(entry.resource, source)
            ? buildQdnPublishZipPath(entry.resource)
            : buildQdnPublishBase64Path(entry.resource, source)
          : shouldUseQdnPublishZipEndpoint(entry.resource, source)
            ? buildQdnPublicPublishZipPath(entry.resource)
            : buildQdnPublicPublishBase64Path(entry.resource, source),
        source.dataBase64,
        writeContext.apiKey,
        'QDN publish transaction build failed.',
      );
      const processedTransaction = useLocalWrite
        ? await signAndProcessTransaction(writeContext as QdnWriteContext, unsignedTransaction.body)
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
            () => isKeylessWriteContextFresh(context as QdnAppRequestContext, writeContext as QdnKeylessWriteContext),
            createPublicQdnPublishAttestation(
              (writeContext as QdnKeylessWriteContext).nodeApiUrl,
              entry.resource,
              {
                bytes: base64ToBytes(source.dataBase64),
                filename: source.fileName,
                unpackZip: shouldUseQdnPublishZipEndpoint(entry.resource, source),
              },
            ),
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

async function deleteQdnResourceForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const resource = getQdnWriteResourceRequest(request);
  const settings = await readNodeSettings();
  const nodeApiUrl = await resolveNodeApiUrl(settings);
  const useLocalWrite = isLocalWriteConnection(settings, nodeApiUrl);
  const writeContext = useLocalWrite
    ? await getQdnWriteContext(context)
    : await getKeylessQdnWriteContext(context);

  await requestQdnWriteApproval(
    context as QdnAppRequestContext,
    writeContext.profile,
    {
      action: 'DELETE_QDN_RESOURCE',
      resource,
    },
  );

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
    useLocalWrite ? buildQdnDeletePath(resource) : buildQdnPublicDeletePath(resource),
    '',
    writeContext.apiKey,
    'QDN delete transaction build failed.',
  );
  const processedTransaction = useLocalWrite
    ? await signAndProcessTransaction(writeContext as QdnWriteContext, unsignedTransaction.body)
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
        () => isKeylessWriteContextFresh(context as QdnAppRequestContext, writeContext as QdnKeylessWriteContext),
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

async function joinGroupForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const groupId = getRequiredGroupId(request, 1);
  const writeContext = await getQdnWriteContext(context);
  const groupData = await getGroupDataForChat(writeContext.nodeApiUrl, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'JOIN_GROUP',
    groupId,
    groupName,
    permissionScope: 'single-request',
  });

  // Joining a minting group authorizes a minting key on chain, so include the
  // self-share public key derived from the joiner's own keypair.
  const mintingPublicKey58 =
    isRecord(groupData) && groupData.isMintingGroup === true
      ? (await deriveMintingKeyPair(writeContext)).publicKey58
      : null;

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/groups/join',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: 0,
      fee: 0,
      joinerPublicKey: writeContext.publicKey58,
      groupId,
      ...(mintingPublicKey58 ? { mintingPublicKey: mintingPublicKey58 } : {}),
    }),
    writeContext.apiKey,
    'Join group transaction build failed.',
    'application/json',
  );
  const processedTransaction = await signAndProcessTransaction(
    writeContext,
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

async function getSelfShareRewardShares(nodeApiUrl: string, address: string) {
  const encodedAddress = encodeURIComponent(address);
  const rewardShares = await fetchLocalNodeApiPayload(
    nodeApiUrl,
    `/addresses/rewardshares?minters=${encodedAddress}&recipients=${encodedAddress}`,
    'Reward share lookup failed.',
  );

  if (!Array.isArray(rewardShares)) {
    return [];
  }

  return rewardShares.filter((rewardShare) => isSelfShareRewardShare(rewardShare, address));
}

async function deriveMintingKeyPair(writeContext: QdnWriteContext) {
  const mintingPrivateKey = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/addresses/rewardsharekey',
    JSON.stringify({
      mintingAccountPrivateKey: writeContext.privateKey58,
      recipientAccountPublicKey: writeContext.publicKey58,
    }),
    writeContext.apiKey,
    'Minting key derivation failed.',
    'application/json',
  );
  const mintingPublicKey = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/utils/publickey',
    mintingPrivateKey.body,
    writeContext.apiKey,
    'Minting public key derivation failed.',
  );

  return {
    privateKey58: mintingPrivateKey.body,
    publicKey58: mintingPublicKey.body,
  };
}

async function getMintingStatusForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const address = await getAddressForQdnRequest(request, context, 'Address');
  const settings = await readNodeSettings();
  const nodeApiUrl = await resolveNodeApiUrl(settings);
  const selfShares = await getSelfShareRewardShares(nodeApiUrl, address);
  const hasRewardShare = selfShares.length > 0;

  if (settings.mode === 'network') {
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
    nodeApiUrl,
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
    nodeApiUrl,
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

async function startMintingForApp(context: QdnAppRequestContext | undefined) {
  const writeContext = await getQdnWriteContext(context);
  const address = writeContext.profile.address;

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'START_MINTING',
    permissionScope: 'single-request',
  });

  const selfShares = await getSelfShareRewardShares(writeContext.nodeApiUrl, address);
  const mintingKeyPair = await deriveMintingKeyPair(writeContext);

  if (selfShares.length === 0) {
    // No on-chain authorization yet (the account joined its minting group before joins
    // carried minting keys) — submit a zero-fee self-share REWARD_SHARE transaction.
    // The minting key can be added to the node once this confirms.
    const unsignedTransaction = await postLocalNodeText(
      writeContext.nodeApiUrl,
      '/addresses/rewardshare',
      JSON.stringify({
        timestamp: Date.now(),
        txGroupId: 0,
        fee: 0,
        minterPublicKey: writeContext.publicKey58,
        recipient: address,
        rewardSharePublicKey: mintingKeyPair.publicKey58,
        sharePercent: 0,
      }),
      writeContext.apiKey,
      'Minting authorization transaction build failed.',
      'application/json',
    );
    const processedTransaction = await signAndProcessTransaction(writeContext, unsignedTransaction.body, null);

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
    writeContext.nodeApiUrl,
    '/admin/mintingaccounts',
    mintingKeyPair.privateKey58,
    writeContext.apiKey,
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
  context: QdnAppRequestContext | undefined,
) {
  const publicKey = getRequiredRequestString(request, 'publicKey', 'Public key');

  // Basic shape check; the node fully validates the key and returns "false" if not present.
  if (!new RegExp(`^[${BASE58_ALPHABET}]{32,64}$`).test(publicKey)) {
    throw new Error('Public key must be a base58-encoded key.');
  }

  const writeContext = await getQdnWriteContext(context);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'REMOVE_MINTING_ACCOUNT',
    mintingKey: publicKey,
    permissionScope: 'single-request',
  });

  // DELETE /admin/mintingaccounts takes the public (or private) key as the plain-text body.
  const result = await deleteLocalNodeText(
    writeContext.nodeApiUrl,
    '/admin/mintingaccounts',
    publicKey,
    writeContext.apiKey,
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
  context: QdnAppRequestContext | undefined,
) {
  const groupId = getRequiredGroupId(request, 1);
  const invitee = getRequiredAddressRequestString(request, 'joiner', 'Joiner address');
  const writeContext = await getQdnWriteContext(context);
  const groupData = await getGroupDataForChat(writeContext.nodeApiUrl, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'APPROVE_GROUP_JOIN_REQUEST',
    groupId,
    groupName,
    recipientAddress: invitee,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/groups/invite',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: 0,
      fee: 0,
      adminPublicKey: writeContext.publicKey58,
      groupId,
      invitee,
      timeToLive: 0,
    }),
    writeContext.apiKey,
    'Group invite transaction build failed.',
    'application/json',
  );
  const processedTransaction = await signAndProcessTransaction(
    writeContext,
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
  context: QdnAppRequestContext | undefined,
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

  const writeContext = await getQdnWriteContext(context);

  let groupName: string | null = null;
  if (typeof displayGroupId === 'number' && displayGroupId >= 0) {
    const groupData = await getGroupDataForChat(writeContext.nodeApiUrl, displayGroupId);
    groupName = getGroupName(groupData);
  }

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'GROUP_APPROVAL',
    approval,
    groupId: typeof displayGroupId === 'number' ? displayGroupId : undefined,
    groupName,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/groups/approval',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: 0,
      fee: 0,
      adminPublicKey: writeContext.publicKey58,
      pendingSignature,
      approval,
    }),
    writeContext.apiKey,
    'Group approval transaction build failed.',
    'application/json',
  );
  const processedTransaction = await signAndProcessTransaction(
    writeContext,
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
  writeContext: QdnWriteContext,
  unsignedTransaction: Awaited<ReturnType<typeof postLocalNodeText>>,
) {
  return signAndProcessTransaction(
    writeContext,
    unsignedTransaction.body,
    '/transactions/mempow/compute',
  );
}

async function inviteToGroupForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const groupId = getRequiredGroupId(request, 1);
  const invitee = getOptionalAddressRequestString(
    request,
    'Invitee address',
    'invitee',
    'recipientAddress',
    'recipient',
  );
  const timeToLive = getOptionalIntegerRequestValue(request, 0, 'timeToLive', 'ttl') ?? 0;
  const writeContext = await getQdnWriteContext(context);
  const groupData = await getGroupDataForChat(writeContext.nodeApiUrl, groupId);
  const groupName = getGroupName(groupData);

  if (!invitee) {
    throw new Error('Invitee address is required.');
  }

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'INVITE_TO_GROUP',
    groupId,
    groupName,
    recipientAddress: invitee,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/groups/invite',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
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

async function leaveGroupForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const groupId = getRequiredGroupId(request, 1);
  const writeContext = await getQdnWriteContext(context);
  const groupData = await getGroupDataForChat(writeContext.nodeApiUrl, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'LEAVE_GROUP',
    groupId,
    groupName,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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

async function updateGroupForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const groupId = getRequiredGroupId(request, 1);
  const writeContext = await getQdnWriteContext(context);
  const groupData = await getGroupDataForChat(writeContext.nodeApiUrl, groupId);
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

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'UPDATE_GROUP',
    groupId,
    groupName,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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
  const settings = await readNodeSettings();
  const { nodeApiUrl, response: infoResponse } = await requestConfiguredNode(settings, buildAvatarInfoPath('group', groupId), 'json');
  if (infoResponse.status === 404) {
    const groupData = await getGroupDataForChat(nodeApiUrl, groupId).catch(() => null);
    const ownerPrimaryName = isRecord(groupData) ? getString(groupData.ownerPrimaryName) : '';
    if (ownerPrimaryName) {
      const legacyResponse = await requestNode(nodeApiUrl, buildAvatarResourcePath(buildLegacyGroupAvatarResource(ownerPrimaryName, groupId)), 'arraybuffer');
      if (legacyResponse.status === 202) return buildGroupAvatarPendingResult(groupId, getHeader(legacyResponse, 'retry-after'), 'LEGACY');
      if (legacyResponse.status >= 200 && legacyResponse.status < 300 && typeof legacyResponse.data === 'string') {
        const declaredLength = getContentLength(legacyResponse);
        if (typeof declaredLength === 'number' && declaredLength > maxBytes) {
          throw new Error(`Group avatar exceeded the ${maxBytes.toLocaleString()} byte limit.`);
        }
        const legacyBytes = base64ToBytes(legacyResponse.data);
        if (legacyBytes.byteLength > maxBytes) throw new Error(`Group avatar exceeded the ${maxBytes.toLocaleString()} byte limit.`);
        const contentType = getAvatarImageContentType(getContentType(legacyResponse), legacyBytes);
        if (!contentType) throw new Error('Legacy group avatar was not a supported image.');
        return { groupId, body: legacyResponse.data, encoding: 'base64' as const, contentType, contentLength: legacyBytes.byteLength, source: 'LEGACY' as const, descriptor: null };
      }
    }
    throw new Error('Group avatar is not set.');
  }
  if (infoResponse.status < 200 || infoResponse.status >= 300 || !isRecord(infoResponse.data)) {
    throw new Error(`Group avatar pointer lookup failed with HTTP ${infoResponse.status}.`);
  }
  const pointerDescriptor = getAvatarDescriptor({
    service: getString(infoResponse.data.service), name: getString(infoResponse.data.name), identifier: getString(infoResponse.data.identifier),
  });
  if (!pointerDescriptor) throw new Error('Group avatar pointer metadata was invalid.');
  const response = await requestNode(nodeApiUrl, buildGroupAvatarPath(groupId), 'arraybuffer');
  const descriptor = getAvatarDescriptorFromHeaders((name) => getHeader(response, name)) ?? pointerDescriptor;

  if (response.status === 202) {
    return buildGroupAvatarPendingResult(groupId, getHeader(response, 'retry-after'), 'POINTER', descriptor);
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Group avatar request failed with HTTP ${response.status}.`);
  }
  if (typeof response.data !== 'string') {
    throw new Error('Group avatar response was not binary data.');
  }

  const declaredLength = getContentLength(response);
  if (typeof declaredLength === 'number' && declaredLength > maxBytes) {
    throw new Error(`Group avatar exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }
  const bytes = base64ToBytes(response.data);
  if (bytes.byteLength > maxBytes) {
    throw new Error(`Group avatar exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  return {
    groupId,
    body: response.data,
    encoding: 'base64' as const,
    contentType: getAvatarImageContentType(getContentType(response), bytes) ?? (() => { throw new Error('Group avatar was not a supported image.'); })(),
    // Always report measured bytes: the Content-Length header is only an
    // oversize preflight and can go stale when a transport decompresses.
    contentLength: bytes.byteLength,
    source: 'POINTER' as const,
    descriptor,
  };
}

async function fetchAccountAvatarForApp(
  request: QdnAppRequest,
  context: QdnAppRequestContext | undefined,
): Promise<AccountAvatarFetchResult> {
  const address = await getAddressForQdnRequest(request, context, 'Address');
  const maxBytes = getGroupAvatarMaxBytes(getRequestValue(request, 'maxBytes'));
  const settings = await readNodeSettings();
  const { nodeApiUrl, response: infoResponse } = await requestConfiguredNode(settings, buildAvatarInfoPath('account', address), 'json');
  if (infoResponse.status === 404) {
    const primaryName = await getPrimaryName(address, nodeApiUrl);
    if (primaryName) {
      for (const kind of ['qortium', 'qortal-hub'] as const) {
        const legacyResponse = await requestNode(nodeApiUrl, buildAvatarResourcePath(buildLegacyAccountAvatarResource(primaryName, kind)), 'arraybuffer');
        if (legacyResponse.status === 202) return buildAccountAvatarPendingResult(address, getHeader(legacyResponse, 'retry-after'), 'LEGACY');
        if (legacyResponse.status < 200 || legacyResponse.status >= 300 || typeof legacyResponse.data !== 'string') continue;
        const declaredLength = getContentLength(legacyResponse);
        if (typeof declaredLength === 'number' && declaredLength > maxBytes) continue;
        const legacyBytes = base64ToBytes(legacyResponse.data);
        if (legacyBytes.byteLength > maxBytes) throw new Error(`Account avatar exceeded the ${maxBytes.toLocaleString()} byte limit.`);
        const contentType = getAvatarImageContentType(getContentType(legacyResponse), legacyBytes);
        if (!contentType) continue;
        return { address, body: legacyResponse.data, encoding: 'base64' as const, contentType, contentLength: legacyBytes.byteLength, source: 'LEGACY' as const, descriptor: null };
      }
    }
    throw new Error('Account avatar is not set.');
  }
  if (infoResponse.status < 200 || infoResponse.status >= 300 || !isRecord(infoResponse.data)) {
    throw new Error(`Account avatar pointer lookup failed with HTTP ${infoResponse.status}.`);
  }
  const pointerDescriptor = getAvatarDescriptor({
    service: getString(infoResponse.data.service), name: getString(infoResponse.data.name), identifier: getString(infoResponse.data.identifier),
  });
  if (!pointerDescriptor) throw new Error('Account avatar pointer metadata was invalid.');
  const response = await requestNode(nodeApiUrl, buildAccountAvatarPath(address), 'arraybuffer');
  const descriptor = getAvatarDescriptorFromHeaders((name) => getHeader(response, name)) ?? pointerDescriptor;

  if (response.status === 202) {
    return buildAccountAvatarPendingResult(address, getHeader(response, 'retry-after'), 'POINTER', descriptor);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Account avatar request failed with HTTP ${response.status}.`);
  }
  if (typeof response.data !== 'string') {
    throw new Error('Account avatar response was not binary data.');
  }

  const declaredLength = getContentLength(response);
  if (typeof declaredLength === 'number' && declaredLength > maxBytes) {
    throw new Error(`Account avatar exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }
  const bytes = base64ToBytes(response.data);
  if (bytes.byteLength > maxBytes) {
    throw new Error(`Account avatar exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  return {
    address,
    body: response.data,
    encoding: 'base64' as const,
    contentType: getAvatarImageContentType(getContentType(response), bytes) ?? (() => { throw new Error('Account avatar was not a supported image.'); })(),
    // Always report measured bytes: the Content-Length header is only an
    // oversize preflight and can go stale when a transport decompresses.
    contentLength: bytes.byteLength,
    source: 'POINTER' as const,
    descriptor,
  };
}

async function setAccountAvatarForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const avatar = getOptionalAvatarPointer(getRequestValue(request, 'avatar'));
  const writeContext = await getQdnWriteContext(context);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'SET_ACCOUNT_AVATAR',
    name: writeContext.profile.name ?? undefined,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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

async function setGroupAvatarForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const groupId = getGroupAvatarGroupId(getRequestValue(request, 'groupId') ?? getRequestValue(request, 'txGroupId'));
  const avatar = getOptionalAvatarPointer(getRequestValue(request, 'avatar'));
  const writeContext = await getQdnWriteContext(context);
  const groupData = await getGroupDataForChat(writeContext.nodeApiUrl, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'SET_GROUP_AVATAR',
    groupId,
    groupName,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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

async function createGroupForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const groupName = getRequiredRequestString(request, 'groupName', 'Group name');
  const description = getString(getRequestValue(request, 'description'));
  const isOpen = getOptionalBooleanRequestValue(request, 'isOpen', 'open') ?? false;
  const approvalThreshold = getGroupApprovalThresholdInput(request);
  const minimumBlockDelay = getOptionalIntegerRequestValue(request, 0, 'minimumBlockDelay', 'minBlockDelay') ?? 5;
  const maximumBlockDelay =
    getOptionalIntegerRequestValue(request, 0, 'maximumBlockDelay', 'maxBlockDelay') ??
    Math.max(10, minimumBlockDelay);
  const writeContext = await getQdnWriteContext(context);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'CREATE_GROUP',
    name: groupName,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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

async function addGroupAdminForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const groupId = getRequiredGroupId(request, 1);
  const member = getRequiredMemberAddress(request, 'Member address', 'member', 'address', 'memberAddress');
  const writeContext = await getQdnWriteContext(context);
  const groupData = await getGroupDataForChat(writeContext.nodeApiUrl, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'ADD_GROUP_ADMIN',
    groupId,
    groupName,
    recipientAddress: member,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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

async function removeGroupAdminForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const groupId = getRequiredGroupId(request, 1);
  const admin = getRequiredMemberAddress(request, 'Admin address', 'admin', 'address', 'memberAddress');
  const writeContext = await getQdnWriteContext(context);
  const groupData = await getGroupDataForChat(writeContext.nodeApiUrl, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'REMOVE_GROUP_ADMIN',
    groupId,
    groupName,
    recipientAddress: admin,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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

async function banFromGroupForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const groupId = getRequiredGroupId(request, 1);
  const offender = getRequiredMemberAddress(request, 'Offender address', 'offender', 'member', 'address');
  const reason = getString(getRequestValue(request, 'reason'));
  const timeToLive = getOptionalIntegerRequestValue(request, 0, 'timeToLive', 'ttl', 'banTime') ?? 0;
  const writeContext = await getQdnWriteContext(context);
  const groupData = await getGroupDataForChat(writeContext.nodeApiUrl, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'GROUP_BAN',
    groupId,
    groupName,
    recipientAddress: offender,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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

async function cancelGroupBanForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const groupId = getRequiredGroupId(request, 1);
  const member = getRequiredMemberAddress(request, 'Member address', 'member', 'offender', 'address');
  const writeContext = await getQdnWriteContext(context);
  const groupData = await getGroupDataForChat(writeContext.nodeApiUrl, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'CANCEL_GROUP_BAN',
    groupId,
    groupName,
    recipientAddress: member,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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

async function kickFromGroupForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const groupId = getRequiredGroupId(request, 1);
  const member = getRequiredMemberAddress(request, 'Member address', 'member', 'address');
  const reason = getString(getRequestValue(request, 'reason'));
  const writeContext = await getQdnWriteContext(context);
  const groupData = await getGroupDataForChat(writeContext.nodeApiUrl, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'GROUP_KICK',
    groupId,
    groupName,
    recipientAddress: member,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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

async function cancelGroupInviteForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const groupId = getRequiredGroupId(request, 1);
  const invitee = getRequiredMemberAddress(request, 'Invitee address', 'invitee', 'address', 'recipientAddress');
  const writeContext = await getQdnWriteContext(context);
  const groupData = await getGroupDataForChat(writeContext.nodeApiUrl, groupId);
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'CANCEL_GROUP_INVITE',
    groupId,
    groupName,
    recipientAddress: invitee,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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

async function setDefaultGroupForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const defaultGroupId = getRequiredIntegerRequestValue(
    request,
    0,
    'Default group id',
    'defaultGroupId',
    'groupId',
  );
  const writeContext = await getQdnWriteContext(context);
  const groupData = defaultGroupId > 0 ? await getGroupDataForChat(writeContext.nodeApiUrl, defaultGroupId) : null;
  const groupName = getGroupName(groupData);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'SET_GROUP',
    groupId: defaultGroupId,
    groupName,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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
  context: QdnAppRequestContext | undefined,
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

    return sendForeignCoinForApp(request, context);
  }

  return sendNativeAssetForApp(request, context, action);
}

async function sendNativeAssetForApp(
  request: QdnAppRequest,
  context: QdnAppRequestContext | undefined,
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
  const writeContext = await getQdnWriteContext(context);
  const nativeAsset = await getNativeAssetInfo(writeContext.nodeApiUrl);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'TRANSFER_ASSET',
    amount,
    name: getAssetApprovalName(NATIVE_ASSET_ID),
    recipientAddress: recipient,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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
  context: QdnAppRequestContext | undefined,
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
  const writeContext = await getQdnWriteContext(context);

  if (!recipient || recipient.length > 256) {
    throw new Error('Recipient address is required.');
  }

  const seed = await getAccountForeignWalletSeed(writeContext.accountId);
  const wallet = deriveForeignWalletRuntime({
    coin,
    crypto: getForeignWalletCrypto(),
    nonce: seed.addressIndex,
    seed: seed.seed,
    walletVersion: seed.walletVersion,
  });
  const preparedResponse = await postLocalNodeText(
    writeContext.nodeApiUrl,
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

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'SEND_COIN',
    amount: sendMax ? `Max ${displayAmount}` : displayAmount,
    details: getForeignPreparedSendApprovalDetails(preparedSend),
    name: preparedSend.blockchain || coin,
    recipientAddress: preparedSend.receivingAddress,
    permissionScope: 'single-request',
  });

  const result = await postLocalNodeText(
    writeContext.nodeApiUrl,
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

async function transferAssetForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
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

  const writeContext = await getQdnWriteContext(context);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'TRANSFER_ASSET',
    amount,
    name: getAssetApprovalName(assetId),
    recipientAddress: recipient,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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

async function createPollForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const pollName = getRequiredRequestString(request, 'pollName', 'Poll name');
  const description = getString(getRequestValue(request, 'description'));
  const pollOptions = getPollOptionsRequestInput(request, 'pollOptions', 'options');
  const ownerInput = getOptionalAddressRequestString(request, 'Owner address', 'owner');
  const startTime = getOptionalIntegerRequestValue(request, 0, 'startTime', 'pollStartTime');
  const endTime = getOptionalIntegerRequestValue(request, 0, 'endTime', 'pollEndTime');
  const settings = await readNodeSettings();
  const nodeApiUrl = await resolveNodeApiUrl(settings);
  const useLocalWrite = isLocalWriteConnection(settings, nodeApiUrl);
  const writeContext = useLocalWrite
    ? await getQdnWriteContext(context)
    : await getKeylessQdnWriteContext(context);
  const capabilities = useLocalWrite ? null : await getPublicPollCapabilities(nodeApiUrl);
  const fee = getTransactionFee(request);
  const txGroupId = getTransactionGroupId(request);
  if (!useLocalWrite && fee !== 0) throw new Error('Public-node poll writes require a zero fee.');
  const resolvedOwner = ownerInput || writeContext.profile.address;

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'CREATE_POLL',
    name: pollName,
    permissionScope: 'single-request',
  });

  const timestamp = Date.now();
  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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
    ? await processQdnAccountTransaction(writeContext as QdnWriteContext, unsignedTransaction)
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
        () => isKeylessWriteContextFresh(context as QdnAppRequestContext, writeContext as QdnKeylessWriteContext),
      );

  return {
    accepted: true,
    action: 'CREATE_POLL',
    pollName,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
  };
}

async function voteOnPollForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const pollId = getRequiredIntegerRequestValue(request, 0, 'Poll id', 'pollId', 'poll');
  const optionIndexes = getOptionalPollVoteOptionIndexes(getRequestValue(request, 'optionIndexes'), getInteger);
  const optionIndex = typeof optionIndexes === 'undefined'
    ? getRequiredIntegerRequestValue(request, 0, 'Option index', 'optionIndex', 'option')
    : getOptionalIntegerRequestValue(request, 0, 'optionIndex', 'option');
  const optionInput = resolvePollVoteOptionInput(optionIndex, optionIndexes);
  const settings = await readNodeSettings();
  const nodeApiUrl = await resolveNodeApiUrl(settings);
  const useLocalWrite = isLocalWriteConnection(settings, nodeApiUrl);
  const writeContext = useLocalWrite
    ? await getQdnWriteContext(context)
    : await getKeylessQdnWriteContext(context);
  const capabilities = useLocalWrite ? null : await getPublicPollCapabilities(nodeApiUrl);
  const fee = getTransactionFee(request);
  const txGroupId = getTransactionGroupId(request);
  if (!useLocalWrite && fee !== 0) throw new Error('Public-node poll writes require a zero fee.');

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'VOTE_ON_POLL',
    name: getPollVoteApprovalName(pollId, optionInput),
    permissionScope: 'single-request',
  });

  const timestamp = Date.now();
  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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
    ? await processQdnAccountTransaction(writeContext as QdnWriteContext, unsignedTransaction)
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
        () => isKeylessWriteContextFresh(context as QdnAppRequestContext, writeContext as QdnKeylessWriteContext),
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

async function rateAccountForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const targetPublicKey = getRequiredRequestString(request, 'targetPublicKey', 'Target public key');
  const category = getRequiredRequestString(request, 'category', 'Rating category');
  const rating = getRequiredRatingValue(request);
  const writeContext = await getQdnWriteContext(context);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'RATE_ACCOUNT',
    name: `${category} · ${describeRating(rating)}`,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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
async function getQdnServiceValue(nodeApiUrl: string, service: string) {
  const services = await fetchLocalNodeApiPayload(
    nodeApiUrl,
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

async function rateResourceForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const service = getService(getRequestValue(request, 'service'));
  const name = getRequiredRequestString(request, 'name', 'QDN resource name');
  const identifier = getString(getRequestValue(request, 'identifier')) || 'default';
  const rating = getRequiredResourceRatingValue(request);

  if (!service) {
    throw new Error('QDN resource service is required.');
  }

  const writeContext = await getQdnWriteContext(context);
  const serviceValue = await getQdnServiceValue(writeContext.nodeApiUrl, service);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'RATE_RESOURCE',
    name: describeResourceRating(rating),
    resource: { service, name, identifier, tags: [] },
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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

async function getResourceRatingForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
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
  const rating = ratingResult === null || ratingResult === undefined ? null : ratingResult;

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

async function getAccountRatingForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
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

async function updatePollForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const pollId = getRequiredIntegerRequestValue(request, 0, 'Poll id', 'pollId', 'poll');
  const newPollName = getRequiredRequestString(request, 'newPollName', 'New poll name');
  const newDescription = getString(getRequestValue(request, 'newDescription') ?? getRequestValue(request, 'description'));
  const newPollOptions = getPollOptionsRequestInput(request, 'newPollOptions', 'pollOptions', 'options');
  const newStartTime = getOptionalIntegerRequestValue(request, 0, 'newStartTime', 'startTime');
  const newEndTime = getOptionalIntegerRequestValue(request, 0, 'newEndTime', 'endTime');
  const settings = await readNodeSettings();
  const nodeApiUrl = await resolveNodeApiUrl(settings);
  const useLocalWrite = isLocalWriteConnection(settings, nodeApiUrl);
  const writeContext = useLocalWrite
    ? await getQdnWriteContext(context)
    : await getKeylessQdnWriteContext(context);
  const capabilities = useLocalWrite ? null : await getPublicPollCapabilities(nodeApiUrl);
  const fee = getTransactionFee(request);
  const txGroupId = getTransactionGroupId(request);
  if (!useLocalWrite && fee !== 0) throw new Error('Public-node poll writes require a zero fee.');

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'UPDATE_POLL',
    name: newPollName,
    permissionScope: 'single-request',
  });

  const timestamp = Date.now();
  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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
    ? await processQdnAccountTransaction(writeContext as QdnWriteContext, unsignedTransaction)
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
        () => isKeylessWriteContextFresh(context as QdnAppRequestContext, writeContext as QdnKeylessWriteContext),
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

async function registerNameForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const name = getRequiredNameRequestString(request);
  const data = getString(getRequestValue(request, 'data')) || getString(getRequestValue(request, 'nameData'));
  const writeContext = await getQdnWriteContext(context);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'REGISTER_NAME',
    name,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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

async function updateNameForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const name = getRequiredNameRequestString(request);
  const writeContext = await getQdnWriteContext(context);
  const nameData = await getNameDataForApp(writeContext.nodeApiUrl, name);
  const newName = getString(getRequestValue(request, 'newName'));
  const newData =
    getString(getRequestValue(request, 'newData')) ||
    getString(getRequestValue(request, 'data')) ||
    getString(getRequestValue(request, 'nameData'));
  const primary = getOptionalBooleanRequestValue(request, 'primary', 'isPrimary');

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'UPDATE_NAME',
    name,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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

async function sellNameForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const name = getRequiredNameRequestString(request);
  const amount = getRequiredAmountValue(request, 'amount', 'Name sale amount');
  const recipient = getOptionalAddressRequestString(request, 'Recipient address', 'recipient', 'recipientAddress');
  const writeContext = await getQdnWriteContext(context);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'SELL_NAME',
    amount,
    name,
    permissionScope: 'single-request',
    recipientAddress: recipient || undefined,
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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

async function cancelSellNameForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const name = getRequiredNameRequestString(request);
  const writeContext = await getQdnWriteContext(context);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'CANCEL_SELL_NAME',
    name,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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

async function buyNameForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const name = getRequiredNameRequestString(request);
  const writeContext = await getQdnWriteContext(context);
  const nameData = await getNameDataForApp(writeContext.nodeApiUrl, name);
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

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'BUY_NAME',
    amount,
    name,
    permissionScope: 'single-request',
    recipientAddress: seller,
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
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

type MemoryPowWorkerResponse =
  | { id: string; nonce: number }
  | { id: string; error: string };

let memoryPowWorker: Worker | null = null;
let memoryPowActive = false;

function getMemoryPowWorker(): Worker {
  if (!memoryPowWorker) {
    // Vite statically detects this exact form and emits the worker as a separate
    // chunk referenced relatively (base './'), which works under Electron
    // loadFile and the Capacitor file:// webview.
    const worker = new Worker(new URL('./pow/memoryPow.worker.ts', import.meta.url), {
      type: 'module',
    });
    // Drop the cached instance if the worker dies, so the next send respawns it
    // instead of hanging on a dead worker.
    worker.addEventListener('error', () => {
      if (memoryPowWorker === worker) {
        memoryPowWorker = null;
      }
      worker.terminate();
    });
    memoryPowWorker = worker;
  }

  return memoryPowWorker;
}

// Runs the CHAT memory-pow off the UI thread and resolves with the nonce.
function computeChatNonce(
  data: Uint8Array,
  difficulty: number,
  isStillValid?: () => boolean | Promise<boolean>,
): Promise<number> {
  if (memoryPowActive) {
    return Promise.reject(qdnCodedError('QDN_POW_BUSY', 'Another proof-of-work computation is already running. Please retry.'));
  }

  const worker = getMemoryPowWorker();
  const id = createRequestId();
  memoryPowActive = true;

  return new Promise<number>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, nonce?: number, terminate = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(validityTimer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      memoryPowActive = false;
      if (terminate) {
        if (memoryPowWorker === worker) memoryPowWorker = null;
        worker.terminate();
      }
      if (error) reject(error);
      else resolve(nonce as number);
    };
    const onMessage = (event: MessageEvent<MemoryPowWorkerResponse>) => {
      if (event.data.id !== id) {
        return;
      }

      if ('error' in event.data) {
        finish(new Error(event.data.error));
        return;
      }

      finish(undefined, event.data.nonce);
    };

    const onError = (event: ErrorEvent) => {
      finish(new Error(event.message || 'Memory-pow computation failed.'), undefined, true);
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

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ id, data, difficulty });
  });
}

// Keyless open-group chat send for PUBLIC/network nodes. Builds the unsigned
// CHAT bytes via the keyless /chat/public/build endpoint, computes the
// memory-pow nonce locally, signs locally with the account's ed25519 key, then
// broadcasts the fully signed bytes. The private key is NEVER sent to the node.
async function sendKeylessPublicGroupChatMessage(
  keylessContext: Awaited<ReturnType<typeof getKeylessChatContext>>,
  groupId: number,
  message: string,
  chatReference?: string,
  isStillValid?: () => boolean | Promise<boolean>,
) {
  const timestamp = Date.now();
  const data = encodeChatTextData(message);
  const unsignedTransaction = await postLocalNodeText(
    keylessContext.nodeApiUrl,
    '/chat/public/build',
    JSON.stringify({
      senderPublicKey: keylessContext.publicKey58,
      data,
      isText: true,
      isEncrypted: false,
      txGroupId: groupId,
      timestamp,
      fee: 0,
      // Reactions and edits reference their target message; dropping this
      // would publish them as plain messages that evade every
      // haschatreference filter (sidebar activity, edit threading).
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
    keylessContext.nodeApiUrl,
    '/transactions/process?apiVersion=2',
    base58Encode(signedBytes),
    keylessContext.apiKey,
    'Chat transaction processing failed.',
  );

  return parseLocalPostData(processedTransaction);
}

async function sendPublicGroupChatMessage(
  writeContext: QdnWriteContext,
  groupId: number,
  message: string,
  chatReference?: string,
) {
  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/chat',
    JSON.stringify({
      timestamp: Date.now(),
      txGroupId: groupId,
      fee: 0,
      senderPublicKey: writeContext.publicKey58,
      chatReference,
      data: encodeChatTextData(message),
      isText: true,
      isEncrypted: false,
    }),
    writeContext.apiKey,
    'Chat transaction build failed.',
    'application/json',
  );
  const processedTransaction = await signAndProcessTransaction(
    writeContext,
    unsignedTransaction.body,
    '/chat/compute',
  );

  return processedTransaction.data;
}

async function sendPrivateGroupChatMessage(
  writeContext: QdnWriteContext,
  groupId: number,
  message: string,
  chatReference?: string,
) {
  const result = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/chat/private/group/send',
    JSON.stringify({
      senderPrivateKey: writeContext.privateKey58,
      groupId,
      data: encodeChatTextData(message),
      isText: true,
      chatReference,
    }),
    writeContext.apiKey,
    'Private group chat send failed.',
    'application/json',
  );

  return parseLocalPostData(result);
}

async function sendDirectPrivateChatMessage(
  writeContext: QdnWriteContext,
  recipientAddress: string,
  message: string,
  chatReference?: string,
) {
  const result = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/chat/private/direct/send',
    JSON.stringify({
      senderPrivateKey: writeContext.privateKey58,
      recipient: recipientAddress,
      data: encodeChatTextData(message),
      isText: true,
      chatReference,
    }),
    writeContext.apiKey,
    'Direct private chat send failed.',
    'application/json',
  );

  return parseLocalPostData(result);
}

// Keyless open-group send path for PUBLIC/network nodes. Direct messages and
// closed/private groups are rejected here because they would require sending the
// private key to a public node. Returns null when the node is not in network
// mode so the caller falls back to the existing server-side signing path.
async function trySendChatMessageOnNetworkNode(
  context: QdnAppRequestContext | undefined,
  target: QdnChatMessageTarget,
  message: string,
  chatReference?: string,
) {
  const settings = await readNodeSettings();

  if (settings.mode !== 'network') {
    return null;
  }

  if (target.kind === 'direct') {
    throw new Error(t('chat.error.directRequiresLocalNode'));
  }

  const keylessContext = await getKeylessChatContext(context);
  const groupId = target.groupId;
  const groupData = await getGroupDataForChat(keylessContext.nodeApiUrl, groupId);
  const groupName = getGroupName(groupData);
  // Fail closed on a public node: only send when the group is confirmed open.
  // An unverifiable/missing group lookup is treated as not-open and rejected.
  const isOpenGroup = groupId === 0 || (isRecord(groupData) && groupData.isOpen === true);

  if (!isOpenGroup) {
    throw new Error(t('chat.error.privateGroupRequiresLocalNode'));
  }

  await requestQdnChatPermissionApproval(
    context as QdnAppRequestContext,
    keylessContext.profile,
    'SEND_CHAT_MESSAGE',
    {
      chatMessagePreview: getChatMessagePreview(message),
      groupId,
      groupName,
    },
  );

  const result = await sendKeylessPublicGroupChatMessage(
    keylessContext,
    groupId,
    message,
    chatReference,
    () => isKeylessWriteContextFresh(context as QdnAppRequestContext, keylessContext),
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

async function sendChatMessageForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const target = getChatMessageTarget(request);
  const message = getChatMessageText(request);
  const chatReference = getOptionalBase58RequestString(request, 'chatReference');

  // Network (public) nodes get the keyless local-sign path for open groups; any
  // path that would leak the private key is rejected. Local/custom nodes keep
  // the existing server-side signing behavior below.
  const networkResult = await trySendChatMessageOnNetworkNode(context, target, message, chatReference);

  if (networkResult) {
    return networkResult;
  }

  const writeContext = await getQdnWriteContext(context);

  if (target.kind === 'direct') {
    await requestQdnChatPermissionApproval(
      context as QdnAppRequestContext,
      writeContext.profile,
      'SEND_CHAT_MESSAGE',
      {
        chatMessagePreview: getChatMessagePreview(message),
        recipientAddress: target.recipientAddress,
      },
    );

    const result = await sendDirectPrivateChatMessage(
      writeContext,
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
  const groupData = await getGroupDataForChat(writeContext.nodeApiUrl, groupId);
  const groupName = getGroupName(groupData);
  const isOpenGroup = groupId === 0 || isOpenGroupData(groupData);

  await requestQdnChatPermissionApproval(
    context as QdnAppRequestContext,
    writeContext.profile,
    'SEND_CHAT_MESSAGE',
    {
      chatMessagePreview: getChatMessagePreview(message),
      groupId,
      groupName,
    },
  );

  const result = isOpenGroup
    ? await sendPublicGroupChatMessage(writeContext, groupId, message, chatReference)
    : await sendPrivateGroupChatMessage(writeContext, groupId, message, chatReference);

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
async function sendMessageForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  if (!context) {
    throw new Error('SEND_MESSAGE is only available from a QDN app frame.');
  }

  let messageRequest: ReturnType<typeof getQortiumAtMessageRequest>;

  try {
    messageRequest = getQortiumAtMessageRequest(request);
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

  if (context.isCurrent && !context.isCurrent()) {
    throw new Error('QDN write request is stale because the app view changed before approval.');
  }

  const unsignedBytes = buildUnsignedQortiumAtMessageTransactionBytes({
    ...messageRequest,
    senderPublicKey: keylessContext.publicKey58,
    timestamp: Date.now(),
  });
  const result = await signAndProcessKeylessStandardTransaction(
    keylessContext,
    base58Encode(unsignedBytes),
    QORTIUM_AT_MESSAGE_POW_DIFFICULTY,
    // The bridge never accepts raw transaction bytes from a QDN app. This
    // assertion is intentionally a no-op because the bytes above come only
    // from the fixed-field serializer, not from request data.
    () => undefined,
    () => isKeylessWriteContextFresh(context, keylessContext),
    // /transactions/process is public; do not disclose a custom-node API key
    // for a transaction that needs no protected Core endpoint.
    '',
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

async function getPrivateGroupActiveChatsForApp(
  request: QdnAppRequest,
  context: QdnAppRequestContext | undefined,
) {
  const writeContext = await getQdnWriteContext(context);

  const result = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/chat/private/group/active',
    JSON.stringify({
      recipientPrivateKey: writeContext.privateKey58,
      encoding: getString(getRequestValue(request, 'encoding')) || undefined,
    }),
    writeContext.apiKey,
    'Private group active chat lookup failed.',
    'application/json',
  );

  return parseLocalPostData(result);
}

async function searchPrivateGroupChatMessagesForApp(
  request: QdnAppRequest,
  context: QdnAppRequestContext | undefined,
) {
  const writeContext = await getQdnWriteContext(context);
  const groupId = getRequiredGroupId(request, 1);

  const result = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/chat/private/group/messages',
    JSON.stringify(buildPrivateGroupChatMessagesBody(request, writeContext.privateKey58)),
    writeContext.apiKey,
    'Private group chat message lookup failed.',
    'application/json',
  );

  return parseLocalPostData(result);
}

async function requestPrivateGroupChatKeyForApp(
  request: QdnAppRequest,
  context: QdnAppRequestContext | undefined,
) {
  const groupId = getRequiredGroupId(request, 1);
  const writeContext = await getQdnWriteContext(context);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'REQUEST_PRIVATE_GROUP_CHAT_KEY',
    groupId,
  });

  const result = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/chat/private/group/key-request',
    JSON.stringify(buildPrivateGroupChatKeyRequestBody(request, writeContext.privateKey58)),
    writeContext.apiKey,
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
  context: QdnAppRequestContext | undefined,
) {
  const groupId = getRequiredGroupId(request, 1);
  const writeContext = await getQdnWriteContext(context);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS',
    groupId,
  });

  const result = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/chat/private/group/key-requests/resolve',
    JSON.stringify(buildPrivateGroupChatKeyRequestRecoveryBody(request, writeContext.privateKey58)),
    writeContext.apiKey,
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

async function getPrivateDirectActiveChatsForApp(
  request: QdnAppRequest,
  context: QdnAppRequestContext | undefined,
) {
  const writeContext = await getQdnWriteContext(context);

  const result = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/chat/private/direct/active',
    JSON.stringify({
      accountPrivateKey: writeContext.privateKey58,
      encoding: getString(getRequestValue(request, 'encoding')) || undefined,
      hasChatReference: getBoolean(getRequestValue(request, 'hasChatReference')),
    }),
    writeContext.apiKey,
    'Direct private active chat lookup failed.',
    'application/json',
  );

  return parseLocalPostData(result);
}

async function searchPrivateDirectChatMessagesForApp(
  request: QdnAppRequest,
  context: QdnAppRequestContext | undefined,
) {
  const writeContext = await getQdnWriteContext(context);
  const otherAddress = getDirectChatOtherAddress(request);

  const result = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/chat/private/direct/messages',
    JSON.stringify(buildPrivateDirectChatMessagesBody(request, writeContext.privateKey58, otherAddress)),
    writeContext.apiKey,
    'Direct private chat message lookup failed.',
    'application/json',
  );

  return parseLocalPostData(result);
}

function createStoredAccountsApi(): PlatformApi['accounts'] {
  return {
    list: async () => toAccountsState(await readWalletStore()),
    getCapabilities: async () => ({
      canCreateWallet: true,
      canExportWalletFile: true,
      canLoadWalletFile: true,
    }),
    getProfile: (accountId) => getAccountProfile(accountId),
    selectWalletFile,
    discardLoadedWallet: async (token) => discardLoadedWallet(token),
    saveLoadedWallet,
    createWallet,
    getAddressFromPrivateKey,
    importPrivateKeyWallet,
    exportWallet,
    setActiveAccount,
    clearActiveAccount,
    renameAccount,
    addDerivedAddress,
    unlockWallet,
    lockWallet,
    removeWallet,
  };
}

function createDiscoveryCacheEntry(candidate: DiscoveryCandidate, existing?: DiscoveryCacheEntry): DiscoveryCacheEntry {
  const now = Date.now();

  return {
    failureCount: 0,
    firstGoodAt: existing?.firstGoodAt ?? now,
    height: candidate.height,
    isSeed: candidate.isSeed,
    lastFailedAt: null,
    lastGoodAt: now,
    nodeApiUrl: normalizeCandidateNodeApiUrl(candidate.nodeApiUrl),
    peerCount: candidate.peerCount,
  };
}

function parseDiscoveryCacheEntry(value: unknown): DiscoveryCacheEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const entry = value as Partial<DiscoveryCacheEntry>;

  if (typeof entry.nodeApiUrl !== 'string' || typeof entry.lastGoodAt !== 'number') {
    return null;
  }

  try {
    return {
      failureCount: Math.max(0, getNumber(entry.failureCount) ?? 0),
      firstGoodAt: getNumber(entry.firstGoodAt) ?? entry.lastGoodAt,
      height: getNumber(entry.height) ?? 0,
      isSeed: getBoolean(entry.isSeed) ?? false,
      lastFailedAt: typeof entry.lastFailedAt === 'number' && Number.isFinite(entry.lastFailedAt) ? entry.lastFailedAt : null,
      lastGoodAt: entry.lastGoodAt,
      nodeApiUrl: normalizeCandidateNodeApiUrl(entry.nodeApiUrl),
      peerCount: getNumber(entry.peerCount) ?? 0,
    };
  } catch {
    return null;
  }
}

function parseDiscoveryCache(value: unknown): DiscoveryCache {
  if (!value || typeof value !== 'object') {
    return { entries: [] };
  }

  const cache = value as Partial<DiscoveryCache & { expiresAt: number; nodeApiUrl: string }>;

  if (Array.isArray(cache.entries)) {
    return {
      entries: cache.entries
        .map(parseDiscoveryCacheEntry)
        .filter((entry): entry is DiscoveryCacheEntry => !!entry),
    };
  }

  if (typeof cache.nodeApiUrl === 'string' && typeof cache.expiresAt === 'number' && cache.expiresAt > Date.now()) {
    try {
      return {
        entries: [
          {
            failureCount: 0,
            firstGoodAt: Date.now(),
            height: 0,
            isSeed: isQortiumPublicNodeApiUrl(cache.nodeApiUrl),
            lastFailedAt: null,
            lastGoodAt: Date.now(),
            nodeApiUrl: normalizeCandidateNodeApiUrl(cache.nodeApiUrl),
            peerCount: 0,
          },
        ],
      };
    } catch {
      return { entries: [] };
    }
  }

  return { entries: [] };
}

async function readDiscoveryCache() {
  try {
    const rawCache = await getStoredValue(NODE_DISCOVERY_CACHE_KEY);

    if (!rawCache) {
      return [];
    }

    const cutoff = Date.now() - DISCOVERY_CACHE_MAX_AGE_MS;
    const cache = parseDiscoveryCache(JSON.parse(rawCache) as unknown);

    return cache.entries
      .filter(
        (entry) =>
          entry.lastGoodAt >= cutoff &&
          isQortiumPublicNodeApiUrl(entry.nodeApiUrl),
      )
      .sort((first, second) => second.lastGoodAt - first.lastGoodAt);
  } catch {
    return [];
  }
}

async function writeDiscoveryCache(probeResults: DiscoveryProbeResult[]) {
  const entriesByUrl = new Map((await readDiscoveryCache()).map((entry) => [entry.nodeApiUrl, entry]));

  for (const { candidate, nodeApiUrl } of probeResults) {
    const normalizedUrl = normalizeCandidateNodeApiUrl(nodeApiUrl);
    const existingEntry = entriesByUrl.get(normalizedUrl);

    if (candidate && isUsableDiscoveryCandidate(candidate)) {
      entriesByUrl.set(normalizedUrl, createDiscoveryCacheEntry(candidate, existingEntry));
    } else if (existingEntry) {
      entriesByUrl.set(normalizedUrl, {
        ...existingEntry,
        failureCount: existingEntry.failureCount + 1,
        lastFailedAt: Date.now(),
      });
    }
  }

  const entries = [...entriesByUrl.values()]
    .sort((first, second) => {
      if (first.lastGoodAt !== second.lastGoodAt) {
        return second.lastGoodAt - first.lastGoodAt;
      }

      return first.failureCount - second.failureCount;
    })
    .slice(0, DISCOVERY_CACHE_MAX_ENTRIES);

  await setStoredValue(
    NODE_DISCOVERY_CACHE_KEY,
    JSON.stringify({
      entries,
    }),
  );
}

function normalizeCandidateNodeApiUrl(value: string) {
  return new URL(normalizeNodeApiUrl(value)).origin;
}

function isQortiumPublicNodeApiUrl(nodeApiUrl: string) {
  try {
    const normalizedNodeApiUrl = normalizeCandidateNodeApiUrl(nodeApiUrl);

    return QORTIUM_PUBLIC_NODE_API_URLS.map(normalizeCandidateNodeApiUrl).includes(
      normalizedNodeApiUrl,
    );
  } catch {
    return false;
  }
}

function getStatusHeight(status: unknown) {
  if (!status || typeof status !== 'object') {
    return 0;
  }

  const height = (status as { height?: unknown }).height;

  return typeof height === 'number' && Number.isFinite(height) ? height : 0;
}

function getStatusPeerCount(status: unknown) {
  if (!status || typeof status !== 'object') {
    return 0;
  }

  const statusObject = status as {
    numberOfConnections?: unknown;
    numberOfDataConnections?: unknown;
  };
  const chainPeers =
    typeof statusObject.numberOfConnections === 'number' ? statusObject.numberOfConnections : 0;
  const dataPeers =
    typeof statusObject.numberOfDataConnections === 'number' ? statusObject.numberOfDataConnections : 0;

  return chainPeers + dataPeers;
}

function getStatusIsSynchronizing(status: unknown) {
  if (!status || typeof status !== 'object') {
    return true;
  }

  const isSynchronizing = (status as { isSynchronizing?: unknown }).isSynchronizing;

  return typeof isSynchronizing === 'boolean' ? isSynchronizing : true;
}

function getStatusSyncPhase(status: unknown) {
  if (!status || typeof status !== 'object') {
    return '';
  }

  const syncPhase = (status as { syncPhase?: unknown }).syncPhase;

  return typeof syncPhase === 'string' ? syncPhase.trim().toUpperCase() : '';
}

function getStatusSyncPercent(status: unknown) {
  if (!status || typeof status !== 'object') {
    return null;
  }

  const syncPercent = (status as { syncPercent?: unknown }).syncPercent;

  return typeof syncPercent === 'number' && Number.isFinite(syncPercent) ? syncPercent : null;
}

function getStatusSyncBlocksRemaining(status: unknown) {
  if (!status || typeof status !== 'object') {
    return null;
  }

  const syncBlocksRemaining = (status as { syncBlocksRemaining?: unknown }).syncBlocksRemaining;

  return typeof syncBlocksRemaining === 'number' && Number.isFinite(syncBlocksRemaining)
    ? syncBlocksRemaining
    : null;
}

function isSyncedStatus(status: unknown) {
  return (
    getStatusHeight(status) > 0 &&
    getStatusSyncPhase(status) === 'SYNCED' &&
    getStatusSyncPercent(status) === 100 &&
    getStatusSyncBlocksRemaining(status) === 0 &&
    !getStatusIsSynchronizing(status)
  );
}

async function probePublicReadAccess(nodeApiUrl: string) {
  try {
    const response = await requestNode(nodeApiUrl, PUBLIC_READ_PROBE_PATH, 'json', DISCOVERY_TIMEOUT_MS);

    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
}

async function probeNodeCandidate(nodeApiUrl: string): Promise<DiscoveryCandidate | null> {
  const startedAt = Date.now();

  try {
    const response = await requestNode(nodeApiUrl, '/admin/status', 'json', DISCOVERY_TIMEOUT_MS);

    if (response.status < 200 || response.status >= 300) {
      return null;
    }

    return {
      nodeApiUrl,
      status: response.data,
      height: getStatusHeight(response.data),
      isSeed: isQortiumPublicNodeApiUrl(nodeApiUrl),
      isSynced: isSyncedStatus(response.data),
      isSynchronizing: getStatusIsSynchronizing(response.data),
      latencyMs: Date.now() - startedAt,
      peerCount: getStatusPeerCount(response.data),
      syncBlocksRemaining: getStatusSyncBlocksRemaining(response.data),
      syncPercent: getStatusSyncPercent(response.data),
      syncPhase: getStatusSyncPhase(response.data),
      supportsPublicReads: await probePublicReadAccess(nodeApiUrl),
    };
  } catch {
    return null;
  }
}

async function discoverQortiumPublicNode(forceRefresh = false): Promise<DiscoveryCandidate> {
  if (!forceRefresh && selectedPublicNodeApiUrl) {
    const selectedCandidate = await probeNodeCandidate(selectedPublicNodeApiUrl);
    const selectedProbeResult = {
      nodeApiUrl: selectedPublicNodeApiUrl,
      candidate: selectedCandidate,
    };

    await writeDiscoveryCache([selectedProbeResult]);

    if (selectedCandidate && isUsableDiscoveryCandidate(selectedCandidate)) {
      return selectedCandidate;
    }

    selectedPublicNodeApiUrl = null;
  }

  const candidateUrls = QORTIUM_PUBLIC_NODE_API_URLS.map(normalizeCandidateNodeApiUrl);
  const probeResults = await Promise.all(
    candidateUrls.map(async (nodeApiUrl) => ({
      nodeApiUrl,
      candidate: await probeNodeCandidate(nodeApiUrl),
    })),
  );
  const candidates = probeResults
    .map((result) => result.candidate)
    .filter((candidate): candidate is DiscoveryCandidate => !!candidate);
  const selectedCandidate = rankDiscoveryCandidates(candidates.filter(isUsableDiscoveryCandidate))[0];

  if (!selectedCandidate) {
    await writeDiscoveryCache(probeResults);
    throw new Error('No reachable synchronized Qortium Public node was found.');
  }

  selectedPublicNodeApiUrl = selectedCandidate.nodeApiUrl;
  await writeDiscoveryCache(probeResults);

  return selectedCandidate;
}

function getHeader(response: HttpResponse, headerName: string) {
  const expectedName = headerName.toLowerCase();
  const entry = Object.entries(response.headers).find(([name]) => name.toLowerCase() === expectedName);

  return entry?.[1];
}

function getContentLength(response: HttpResponse) {
  const contentLength = Number(getHeader(response, 'content-length'));

  return Number.isFinite(contentLength) ? contentLength : undefined;
}

function getContentType(response: HttpResponse) {
  return getHeader(response, 'content-type') ?? '';
}

function getStatusText(status: number) {
  if (status >= 200 && status < 300) {
    return 'OK';
  }

  if (status >= 400 && status < 500) {
    return 'Client Error';
  }

  if (status >= 500) {
    return 'Server Error';
  }

  return '';
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

function getNodeApiUrlBase(nodeApiUrl: string) {
  return nodeApiUrl.replace(/\/+$/, '');
}

function getByteLength(value: string) {
  return new Blob([value]).size;
}

function createRequestId() {
  return window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getQdnChatPermissionCacheKey(
  context: QdnAppRequestContext,
  accountId: string,
  action: QdnChatPermissionAction,
) {
  return [
    context.sessionKey,
    context.resourceUrl,
    accountId,
    action,
  ].join('\n');
}

function stringifyResponseData(data: unknown) {
  if (typeof data === 'string') {
    return data;
  }

  if (data === null || typeof data === 'undefined') {
    return '';
  }

  return JSON.stringify(data);
}

async function requestNode(
  nodeApiUrl: string,
  pathname: string,
  responseType: 'arraybuffer' | 'json' | 'text' = 'text',
  timeoutMs = REQUEST_TIMEOUT_MS,
  method: 'GET' | 'HEAD' = 'GET',
  headers?: Record<string, string>,
) {
  try {
    return await CapacitorHttp.request({
      url: `${getNodeApiUrlBase(nodeApiUrl)}${pathname}`,
      method,
      headers,
      responseType,
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    });
  } catch {
    throw new Error(getNodeUnavailableMessage(nodeApiUrl));
  }
}

async function fetchNodeStatus(nodeApiUrl: string) {
  const response = await requestNode(nodeApiUrl, '/admin/status', 'json');

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      stringifyResponseData(response.data) || `Node status request failed with HTTP ${response.status}.`,
    );
  }

  return response.data;
}

async function testNodeSettings(settings: StoredNodeSettings): Promise<QortiumNodeStatusResult> {
  let nodeApiUrl = getFallbackNodeApiUrl(settings);

  try {
    nodeApiUrl = await resolveNodeApiUrl(settings);

    return {
      ok: true,
      nodeApiUrl,
      status: await fetchNodeStatus(nodeApiUrl),
    };
  } catch (error) {
    if (settings.mode === 'network') {
      try {
        nodeApiUrl = await resolveNodeApiUrl(settings, true);

        return {
          ok: true,
          nodeApiUrl,
          status: await fetchNodeStatus(nodeApiUrl),
        };
      } catch (retryError) {
        return {
          ok: false,
          nodeApiUrl,
          message: retryError instanceof Error ? retryError.message : 'Unable to reach the configured node.',
        };
      }
    }

    return {
      ok: false,
      nodeApiUrl,
      message: error instanceof Error ? error.message : 'Unable to reach the configured node.',
    };
  }
}

function normalizeCoreOnChainUpdateStatus(value: unknown): QortiumCoreOnChainUpdateStatus {
  return isRecord(value) ? value : {};
}

async function requestCoreOnChainUpdate(method: 'GET' | 'POST'): Promise<QortiumCoreOnChainUpdateStatus> {
  const settings = await readNodeSettings();

  if (settings.mode === 'network') {
    throw networkRestrictionError();
  }

  const nodeApiUrl = await resolveNodeApiUrl(settings);
  const apiKey = getNodeApiKey(settings);
  let response: HttpResponse;

  try {
    response = await CapacitorHttp.request({
      url: `${getNodeApiUrlBase(nodeApiUrl)}/admin/update`,
      method,
      headers: {
        Accept: 'application/json',
        'X-API-KEY': apiKey,
      },
      responseType: 'text',
      connectTimeout: REQUEST_TIMEOUT_MS,
      readTimeout: REQUEST_TIMEOUT_MS,
    });
  } catch {
    throw new Error(getNodeUnavailableMessage(nodeApiUrl));
  }

  const responseBody = stringifyResponseData(response.data).trim();

  if (response.status < 200 || response.status >= 300) {
    const fallbackMessage =
      method === 'POST'
        ? 'Core on-chain update install request failed.'
        : 'Core on-chain update check failed.';

    throw new Error(
      readableNodeErrorMessage(responseBody, fallbackMessage),
    );
  }

  return normalizeCoreOnChainUpdateStatus(parseResponseData(responseBody, getContentType(response)));
}

async function requestProtectedNodeText(
  nodeApiUrl: string,
  apiKey: string,
  pathname: string,
  method: 'GET' | 'PATCH',
  data: unknown,
  fallbackMessage: string,
) {
  let response: HttpResponse;

  try {
    response = await CapacitorHttp.request({
      url: `${getNodeApiUrlBase(nodeApiUrl)}${pathname}`,
      method,
      headers: {
        Accept: 'application/json',
        'X-API-KEY': apiKey,
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      data,
      responseType: 'text',
      connectTimeout: REQUEST_TIMEOUT_MS,
      readTimeout: REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    throw new Error(
      (error instanceof Error && error.message) || getNodeUnavailableMessage(nodeApiUrl),
    );
  }

  const responseBody = stringifyResponseData(response.data).trim();

  if (response.status < 200 || response.status >= 300) {
    if (/api key/i.test(responseBody)) {
      throw new Error('Node API key was rejected. Reconnect to the active local Core or update the node API key in settings.');
    }

    throw new Error(readableNodeErrorMessage(responseBody, fallbackMessage));
  }

  return responseBody;
}

function isQdnAccountFreeWriteAction(action: string): action is QdnAccountFreeWriteAction {
  return (QDN_ACCOUNT_FREE_WRITE_ACTIONS as readonly string[]).includes(action);
}

async function fetchPinnedNodeApiData(
  settings: StoredNodeSettings,
  nodeApiUrl: string,
  apiPath: string,
) {
  let response: HttpResponse;

  try {
    response = await CapacitorHttp.request({
      url: `${getNodeApiUrlBase(nodeApiUrl)}${apiPath}`,
      method: 'GET',
      responseType: 'text',
      connectTimeout: REQUEST_TIMEOUT_MS,
      readTimeout: REQUEST_TIMEOUT_MS,
    });
  } catch {
    throw new Error(getNodeUnavailableMessage(nodeApiUrl));
  }

  const result = readNodeApiResponse(response, settings, QDN_APP_DEFAULT_MAX_BYTES);

  if (!result.ok) {
    throw new Error(readableNodeErrorMessage(result.body, `Qortium node request failed with HTTP ${result.status}.`));
  }

  return result.data;
}

async function handleQdnAccountFreeWriteAction(
  action: QdnAccountFreeWriteAction,
  request: QdnAppRequest,
  context?: QdnAppRequestContext,
) {
  if (!context) {
    throw new Error('QDN write request does not belong to an active window.');
  }

  const settings = await readNodeSettings();
  const nodeApiUrl = await resolveNodeApiUrl(settings);
  if (settings.mode === 'network') {
    throw networkRestrictionError();
  }

  if (action === 'ADD_TO_LIST' || action === 'REMOVE_FROM_LIST') {
    assertLocalWriteConnection(settings, nodeApiUrl);
  }

  const apiKey = getNodeApiKey(settings);

  let details: Array<{ label: string; value: string }>;
  let settingsPatch: Record<string, unknown> | undefined;
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
      fetchPinnedNodeApiData(settings, nodeApiUrl, '/admin/settings/metadata'),
      fetchPinnedNodeApiData(settings, nodeApiUrl, '/admin/settings'),
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
    settingsPatch = Object.fromEntries(entries);
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

  details.unshift({ label: 'Node', value: getExactQdnApprovalValue(nodeApiUrl, 500) });

  await requestQdnWriteApproval(context, null, { action, details });

  if (context.isCurrent && !context.isCurrent()) {
    throw new Error('QDN write request is stale because the app view changed before approval.');
  }

  if (action === 'UPDATE_NODE_SETTINGS') {
    const responseBody = await requestProtectedNodeText(
      nodeApiUrl,
      apiKey,
      '/admin/settings',
      'PATCH',
      settingsPatch,
      'Node settings update request failed.',
    );
    return parseResponseData(responseBody, 'application/json');
  }

  if (action === 'RESTART_NODE') {
    const responseBody = await requestProtectedNodeText(
      nodeApiUrl,
      apiKey,
      '/admin/restart',
      'GET',
      undefined,
      'Node restart request failed.',
    );
    return parseResponseData(responseBody, 'text/plain');
  }

  const body = JSON.stringify({ items: itemStrings });
  const responseBody = action === 'ADD_TO_LIST'
    ? await postLocalNodeText(
        nodeApiUrl,
        `/lists/${encodeURIComponent(listName as string)}`,
        body,
        apiKey,
        'Failed to add items to list.',
        'application/json',
      )
    : await deleteLocalNodeText(
        nodeApiUrl,
        `/lists/${encodeURIComponent(listName as string)}`,
        body,
        apiKey,
        'Failed to remove items from list.',
        'application/json',
      );

  return parseLocalPostData(responseBody);
}

async function handleQdnHomeSettingsAction(
  action: QdnHomeSettingsAction,
  request: QdnAppRequest,
  context?: QdnAppRequestContext,
) {
  if (!context) {
    throw new Error('QDN Home settings request does not belong to an active app view.');
  }
  if (action === 'GET_HOME_SETTINGS_METADATA') return getHomeSettingsMetadata();

  if (!context.getHomeSettings) {
    throw new Error('Home settings are unavailable in this view.');
  }
  if (action === 'GET_HOME_SETTINGS') return context.getHomeSettings();

  const explicitPatch = getRequestValue(request, 'patch') ?? getRequestValue(request, 'settings');
  const patch = validateHomeSettingsPatch(explicitPatch ?? (isRecord(request.payload) ? request.payload : undefined));
  const current = context.getHomeSettings();
  await requestQdnWriteApproval(context, null, {
    action,
    details: getHomeSettingsApprovalDetails(current, patch),
    permissionScope: 'single-request',
  });
  if (context.isCurrent && !context.isCurrent()) {
    throw new Error('QDN write request is stale because the app view changed before approval.');
  }
  if (!context.applyHomeSettingsPatch) {
    throw new Error('Home settings updates are unavailable in this view.');
  }
  return context.applyHomeSettingsPatch(patch);
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

async function requireQdnAssignmentsReadPermission(context: QdnAppRequestContext) {
  const appKey = sanitizeQdnManagerAppKey(context.resourceUrl);
  if (await hasQdnAppCapability(appKey, 'assignments.read')) return;
  await requestQdnWriteApproval(context, null, {
    action: 'GET_APP_ASSIGNMENTS',
    details: [{ label: 'Capability', value: 'Read app assignments' }],
    permissionScope: 'always',
  }, 'App assignment read permission was denied.');
  if (context.isCurrent && !context.isCurrent()) {
    throw new Error('App assignment request is stale because the app view changed before approval.');
  }
  await grantQdnAppCapabilityPermission(appKey, 'assignments.read');
}

async function handleQdnAppAssignmentAction(
  action: QdnAppAssignmentAction,
  request: QdnAppRequest,
  context?: QdnAppRequestContext,
) {
  if (!context) throw new Error('App assignment request does not belong to an active app view.');
  if (action === 'GET_APP_ASSIGNMENTS') {
    await requireQdnAssignmentsReadPermission(context);
    const store = await getQdnAppRolesStore();
    return { assignments: store.assignments, revision: store.revision, version: store.version };
  }
  const input = getQdnAssignmentRequest(request);
  const currentStore = await getQdnAppRolesStore();
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
  if (context.isCurrent && !context.isCurrent()) {
    throw new Error('App assignment request is stale because the app view changed before approval.');
  }
  if ((await getQdnAppRolesStore()).revision !== currentStore.revision) {
    throw new Error('App assignments changed while approval was open. Refresh and try again.');
  }
  const store = await setQdnAppAssignmentValue(input);
  return { assignments: store.assignments, revision: store.revision, version: store.version };
}

async function requireQdnManagerPermission(
  context: QdnAppRequestContext,
  capability: 'bookmarks.manage' | 'notifications.manage',
  action: QdnWriteApprovalAction,
) {
  const appKey = context.resourceUrl;
  if (await hasQdnManagerPermission(appKey, capability)) return appKey;
  await requestQdnWriteApproval(context, null, {
    action,
    details: [{ label: 'Capability', value: capability }],
    permissionScope: 'always',
  }, 'Home data manager permission was denied.');
  if (context.isCurrent && !context.isCurrent()) {
    throw new Error('QDN manager request is stale because the app view changed before approval.');
  }
  await grantQdnManagerPermission(appKey, capability);
  return appKey;
}

async function handleQdnBookmarkManagerAction(
  action: QdnBookmarkManagerAction,
  request: QdnAppRequest,
  context?: QdnAppRequestContext,
) {
  if (!context) throw new Error('Bookmark manager request does not belong to an active app view.');
  if (action === 'BOOKMARKS_HAS_PERMISSION') {
    return { granted: await hasQdnManagerPermission(context.resourceUrl, 'bookmarks.manage') };
  }

  if (action === 'BOOKMARKS_OPEN') {
    const { accountId, address } = validateBookmarksOpenRequest(
      getRequestValue(request, 'request') ?? {
        accountId: getRequestValue(request, 'accountId') ?? null,
        address: getRequestValue(request, 'address'),
      },
    );

    await requireQdnManagerPermission(context, 'bookmarks.manage', action);
    if (context.isCurrent && !context.isCurrent()) {
      throw new Error('QDN manager request is stale because the app view changed before it could run.');
    }

    if (accountId && !(await accountExists(accountId))) {
      throw new Error('BOOKMARKS_OPEN accountId does not match a saved Home account.');
    }

    if (!context.onBookmarksOpen) {
      throw new Error('Opening bookmarks is not available in this view.');
    }

    context.onBookmarksOpen(address, accountId);
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
  await requireQdnManagerPermission(context, 'bookmarks.manage', action);
  if (context.isCurrent && !context.isCurrent()) {
    throw new Error('QDN manager request is stale because the app view changed before it could run.');
  }
  if (action === 'BOOKMARKS_GET') {
    if (!context.getBookmarkManagerSnapshot) throw new Error('Bookmark manager data is unavailable in this view.');
    return context.getBookmarkManagerSnapshot();
  }
  if (!context.applyBookmarkManagerMutation || !mutationRequest) {
    throw new Error('Bookmark manager updates are unavailable in this view.');
  }
  return context.applyBookmarkManagerMutation(mutationRequest);
}

function getExpectedNotificationManagerRevision(request: QdnAppRequest) {
  const value = getRequestValue(request, 'expectedRevision');
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('Notification manager expectedRevision must be a non-negative safe integer.');
  }
  return value as number;
}

async function handleQdnNotificationManagerAction(
  action: QdnNotificationManagerAction,
  request: QdnAppRequest,
  context?: QdnAppRequestContext,
) {
  if (!context) throw new Error('Notification manager request does not belong to an active app view.');
  if (action === 'NOTIFICATION_MANAGER_HAS_PERMISSION') {
    return { granted: await hasQdnManagerPermission(context.resourceUrl, 'notifications.manage') };
  }
  const mutation = action === 'NOTIFICATION_MANAGER_SET_MUTED'
    ? sanitizeQdnNotificationManagerMutation({
        type: 'SET_APP_MUTED', appKey: getRequestValue(request, 'appKey'), muted: getRequestValue(request, 'muted'),
      })
    : action === 'NOTIFICATION_MANAGER_REMOVE_RULES'
      ? sanitizeQdnNotificationManagerMutation({
          type: 'REMOVE_APP_RULES',
          appKey: getRequestValue(request, 'appKey'),
          notificationIds: getRequestValue(request, 'notificationIds'),
        })
      : action === 'NOTIFICATION_MANAGER_REVOKE'
        ? sanitizeQdnNotificationManagerMutation({ type: 'REVOKE_APP', appKey: getRequestValue(request, 'appKey') })
        : null;
  const expectedRevision = mutation ? getExpectedNotificationManagerRevision(request) : null;
  await requireQdnManagerPermission(context, 'notifications.manage', action);
  if (context.isCurrent && !context.isCurrent()) {
    throw new Error('QDN manager request is stale because the app view changed before it could run.');
  }
  if (!mutation) return getQdnNotificationManagerSummary(await getNotificationStore());
  return getQdnNotificationManagerSummary(await updateNotificationStore(
    (store) => applyQdnNotificationManagerMutation(store, mutation),
    expectedRevision ?? undefined,
  ));
}

async function getProtectedNodeRequestContext() {
  const settings = await readNodeSettings();

  if (settings.mode === 'network') {
    throw networkRestrictionError();
  }

  const nodeApiUrl = await resolveNodeApiUrl(settings);

  return {
    apiKey: getProtectedPlatformNodeApiKey(settings, nodeApiUrl),
    nodeApiUrl,
  };
}

async function enableNodeApiDocumentation() {
  const settingsContext = await getProtectedNodeRequestContext();

  await requestProtectedNodeText(
    settingsContext.nodeApiUrl,
    settingsContext.apiKey,
    '/admin/settings',
    'PATCH',
    { apiDocumentationEnabled: true },
    'Node settings update request failed.',
  );

  const restartContext = await getProtectedNodeRequestContext();

  await requestProtectedNodeText(
    restartContext.nodeApiUrl,
    restartContext.apiKey,
    '/admin/restart',
    'GET',
    undefined,
    'Node restart request failed.',
  );
}

async function setNodeAllowedTransports(transports: string[]) {
  const settingsContext = await getProtectedNodeRequestContext();

  await requestProtectedNodeText(
    settingsContext.nodeApiUrl,
    settingsContext.apiKey,
    '/admin/settings',
    'PATCH',
    { allowedTransports: transports },
    'Node settings update request failed.',
  );

  // allowedTransports is restart-required: persisted now, effective after restart.
  const restartContext = await getProtectedNodeRequestContext();

  await requestProtectedNodeText(
    restartContext.nodeApiUrl,
    restartContext.apiKey,
    '/admin/restart',
    'GET',
    undefined,
    'Node restart request failed.',
  );
}

async function requestConfiguredNode(
  settings: StoredNodeSettings,
  pathname: string,
  responseType: 'arraybuffer' | 'json' | 'text' = 'text',
  method: 'GET' | 'HEAD' = 'GET',
) {
  const nodeApiUrl = await resolveNodeApiUrl(settings);
  const apiKey = getSendablePlatformNodeApiKey(settings, nodeApiUrl);
  const headers = apiKey ? { 'X-API-KEY': apiKey } : undefined;

  try {
    return {
      nodeApiUrl,
      response: await requestNode(nodeApiUrl, pathname, responseType, REQUEST_TIMEOUT_MS, method, headers),
    };
  } catch (error) {
    if (settings.mode !== 'network') {
      throw error;
    }

    const retryNodeApiUrl = await resolveNodeApiUrl(settings, true);

    if (retryNodeApiUrl === nodeApiUrl) {
      throw error;
    }

    return {
      nodeApiUrl: retryNodeApiUrl,
      response: await requestNode(retryNodeApiUrl, pathname, responseType, REQUEST_TIMEOUT_MS, method, headers),
    };
  }
}

function getForeignWalletCrypto() {
  return {
    ripemd160,
    sha256: sha256Sync,
    sha512,
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

async function getForeignWalletSeedForContext(
  context: QdnAppRequestContext | undefined,
  settings: StoredNodeSettings,
  nodeApiUrl: string,
) {
  assertLocalWriteConnection(settings, nodeApiUrl);

  if (!context?.accountId) {
    throw new Error('No account is selected for this tab.');
  }

  if (!isAccountUnlocked(context.accountId)) {
    throw new Error('Selected account is locked.');
  }

  return getAccountForeignWalletSeed(context.accountId);
}

async function deriveForeignWalletForContext(
  request: QdnAppRequest,
  context: QdnAppRequestContext | undefined,
  settings: StoredNodeSettings,
  nodeApiUrl: string,
) {
  const coin = normalizeForeignWalletCoin(getRequestValue(request, 'coin') ?? getRequestValue(request, 'blockchain'));
  const seed = await getForeignWalletSeedForContext(context, settings, nodeApiUrl);

  return deriveForeignWalletRuntime({
    coin,
    crypto: getForeignWalletCrypto(),
    nonce: seed.addressIndex,
    seed: seed.seed,
    walletVersion: seed.walletVersion,
  });
}

async function getUserForeignWalletForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  if (isNativeAssetRequest(request, true)) {
    if (!context?.accountId) {
      throw new Error('No account is selected for this tab.');
    }

    const profile = await getAccountProfile(context.accountId);

    return {
      address: profile.address,
      assetId: NATIVE_ASSET_ID,
      assetName: NATIVE_ASSET_LABEL,
      native: true,
    };
  }

  const settings = await readNodeSettings();
  const nodeApiUrl = await resolveNodeApiUrl(settings);
  const wallet = await deriveForeignWalletForContext(request, context, settings, nodeApiUrl);

  return getForeignWalletPublicResponse(wallet);
}

async function postForeignWalletReadForApp(
  request: QdnAppRequest,
  context: QdnAppRequestContext | undefined,
  endpoint: ForeignWalletReadEndpoint,
) {
  const settings = await readNodeSettings();
  const nodeApiUrl = await resolveNodeApiUrl(settings);
  const wallet = await deriveForeignWalletForContext(request, context, settings, nodeApiUrl);
  const result = await executeForeignWalletRead(
    wallet,
    endpoint,
    ({ body, contentType, pathname }) => postLocalNodeText(
      nodeApiUrl,
      pathname,
      body,
      getNodeApiKey(settings),
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

async function getNativeAssetInfo(nodeApiUrl: string) {
  let response: HttpResponse;

  try {
    response = await CapacitorHttp.request({
      url: `${getNodeApiUrlBase(nodeApiUrl)}/assets/info?assetId=${NATIVE_ASSET_ID}`,
      method: 'GET',
      responseType: 'text',
      connectTimeout: REQUEST_TIMEOUT_MS,
      readTimeout: REQUEST_TIMEOUT_MS,
    });
  } catch {
    throw new Error(getNodeUnavailableMessage(nodeApiUrl));
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error('Native asset is not active on this node yet.');
  }

  return parseResponseData(stringifyResponseData(response.data), getContentType(response));
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
    const response = await CapacitorHttp.request({
      url: `https://api.coingecko.com/api/v3${path}`,
      method: 'GET',
      headers: { Accept: 'application/json' },
      responseType: 'text',
      connectTimeout: 20_000,
      readTimeout: 20_000,
    });
    const body = stringifyResponseData(response.data);

    if (response.status < 200 || response.status >= 300) {
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
  context: QdnAppRequestContext | undefined,
) {
  const coin = normalizeForeignWalletCoin(getRequestValue(request, 'coin') ?? getRequestValue(request, 'blockchain'));
  const server = getForeignServerPayload(request);
  const writeContext = await getQdnWriteContext(context);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
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

  const result = await postLocalNodeText(
    writeContext.nodeApiUrl,
    `/crosschain/${coin.toLowerCase()}/setcurrentserver`,
    JSON.stringify(server),
    writeContext.apiKey,
    'Foreign server selection failed.',
    'application/json',
  );

  return parseResponseData(result.body, result.contentType);
}

function encodeChatTextData(message: string) {
  return base58Encode(stringToUtf8Array(message));
}

function getChatMessageText(request: QdnAppRequest) {
  const message =
    getString(getRequestValue(request, 'message')) || getString(getRequestValue(request, 'data'));

  if (!message) {
    throw new Error('Chat message is required.');
  }

  const byteLength = getByteLength(message);

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

function getResponseHeaders(response: HttpResponse) {
  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(response.headers)) {
    headers[key] = value;
  }

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

function readNodeApiResponse(
  response: HttpResponse,
  settings: StoredNodeSettings,
  maxBytes: number,
  readBody = true,
) {
  const contentLength = getContentLength(response);
  const contentType = getContentType(response);
  const rawBody = readBody ? stringifyResponseData(response.data) : '';
  const networkRestricted = response.status === 403 && settings.mode === 'network';
  const body = networkRestricted ? getNetworkRestrictionMessage() : rawBody;
  const bodyLength = getByteLength(body);

  if (maxBytes > 0 && typeof contentLength === 'number' && contentLength > maxBytes) {
    throw new Error(`Node API response exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  if (maxBytes > 0 && bodyLength > maxBytes) {
    throw new Error(`Node API response exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  return {
    body,
    contentLength: contentLength ?? bodyLength,
    contentType,
    data: parseResponseData(body, contentType),
    headers: getResponseHeaders(response),
    ...(networkRestricted ? { code: 'PUBLIC_NODE_READ_ONLY' } : {}),
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: getStatusText(response.status),
  };
}

function getNodeApiResponseError(
  result: { body: string; code?: string; status: number },
  fallbackMessage: string,
) {
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
  const settings = await readNodeSettings();
  const { response } = await requestConfiguredNode(settings, apiPath, 'text', method);

  return readNodeApiResponse(response, settings, maxBytes, method !== 'HEAD');
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
// Lets QDN apps read Qortal QDN resources (search/status/metadata + binary fetch, e.g. game ROMs).
// Strictly read-only: GET/HEAD against public QDN services only, no account, API key, signing or writes.

let cachedQortalNodeApiUrl: { expiresAt: number; source: QortalNodeCandidate['source']; url: string } | null =
  null;
const marketPriceCache = new Map<string, { expiresAt: number; response: MarketPriceResponse }>();

function getQortalNodeCandidates(): QortalNodeCandidate[] {
  const remoteCandidates = QORTAL_REMOTE_NODE_API_URLS.map(
    (url): QortalNodeCandidate => ({
      requiresPublicReadProbe: false,
      requiresSyncedStatus: false,
      source: 'remote',
      url,
    }),
  );

  if (isNativePlatform()) {
    return remoteCandidates;
  }

  return [
    {
      requiresPublicReadProbe: true,
      requiresSyncedStatus: true,
      source: 'local',
      url: QORTAL_LOCAL_NODE_API_URL,
    },
    ...remoteCandidates,
  ];
}

async function probeQortalNodeCandidate(candidate: QortalNodeCandidate) {
  try {
    const response = await requestNode(candidate.url, '/admin/status', 'json', DISCOVERY_TIMEOUT_MS);

    if (response.status < 200 || response.status >= 300) {
      return false;
    }

    if (candidate.requiresSyncedStatus && !isSyncedStatus(response.data)) {
      return false;
    }

    if (candidate.requiresPublicReadProbe && !(await probePublicReadAccess(candidate.url))) {
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

async function requestQortalNodeWithRetry<T>(operation: (nodeApiUrl: string) => Promise<T>) {
  const nodeApiUrl = await resolveQortalNodeApiUrl(cachedQortalNodeApiUrl?.source === 'local');

  try {
    return await operation(nodeApiUrl);
  } catch (error) {
    invalidateCachedQortalNodeApiUrl(nodeApiUrl);

    const retryNodeApiUrl = await resolveQortalNodeApiUrl(true);
    if (retryNodeApiUrl === nodeApiUrl) {
      throw error;
    }

    return operation(retryNodeApiUrl);
  }
}

// Neutral settings so the shared response reader doesn't apply Qortium network-mode messaging.
const QORTAL_READ_SETTINGS: StoredNodeSettings = { apiKey: '', customUrl: '', mode: 'custom' };

async function fetchQortalNodeApi(apiPath: string, maxBytes: number, method: 'GET' | 'HEAD' = 'GET') {
  const response = await requestQortalNodeWithRetry((nodeApiUrl) =>
    requestNode(nodeApiUrl, apiPath, 'text', REQUEST_TIMEOUT_MS, method),
  );

  return readNodeApiResponse(response, QORTAL_READ_SETTINGS, maxBytes, method !== 'HEAD');
}

async function fetchQortalNodeApiPayload(apiPath: string, request: QdnAppRequest) {
  const result = await fetchQortalNodeApi(apiPath, getQdnAppMaxBytes(getRequestValue(request, 'maxBytes')));

  if (!result.ok) {
    throw new Error(readableNodeErrorMessage(result.body, `Qortal node request failed with HTTP ${result.status}.`));
  }

  return result.data;
}

async function getQortalPrimaryNameForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
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
  const response = await requestQortalNodeWithRetry(async (nodeApiUrl) => {
    try {
      return await CapacitorHttp.request({
        url: `${getNodeApiUrlBase(nodeApiUrl)}${apiPath}`,
        method: 'POST',
        headers: {
          'Content-Type': contentType,
        },
        data: body,
        responseType: 'text',
        connectTimeout: REQUEST_TIMEOUT_MS,
        readTimeout: REQUEST_TIMEOUT_MS,
      });
    } catch {
      throw new Error(getNodeUnavailableMessage(nodeApiUrl));
    }
  });

  const responseBody = stringifyResponseData(response.data).trim();
  const contentTypeHeader = getContentType(response);

  if (response.status < 200 || response.status >= 300) {
    throw new Error(readableNodeErrorMessage(responseBody, fallbackMessage));
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

async function sendQortForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
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

  const specialId = createRequestId();

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

function getRandomQortalReference() {
  const reference = new Uint8Array(64);
  crypto.getRandomValues(reference);
  return reference;
}

async function sendQortalGroupChatForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
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

  const unsignedBytes = buildUnsignedQortalGroupChatTransactionBytes({
    lastReference: getRandomQortalReference(),
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

// Qortal resource requests are validated by shape only (read-only public reads); they are NOT
// limited to the Qortium public-service whitelist, since Qortal resources (ROMs, metadata, etc.)
// are published under many different services.
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

function getQortalResourceRequest(request: QdnAppRequest): QdnAppResourceRequest {
  const service = getQortalService(getRequestValue(request, 'service'));
  const name = getString(getRequestValue(request, 'name'));
  const identifier = getString(getRequestValue(request, 'identifier'));
  const resourcePath = getString(getRequestValue(request, 'path')) || getString(getRequestValue(request, 'filepath'));

  if (!name) {
    throw new Error('Qortal resource name is required.');
  }

  return { service, name, identifier: identifier || undefined, path: resourcePath };
}

function buildQortalResourcePath(resource: QdnAppResourceRequest) {
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

  const response = await requestQortalNodeWithRetry((nodeApiUrl) =>
    requestNode(nodeApiUrl, apiPath, 'arraybuffer'),
  );

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Qortal resource request failed with HTTP ${response.status}.`);
  }
  if (typeof response.data !== 'string') {
    throw new Error('Qortal resource response was not binary data.');
  }

  const contentLength = getContentLength(response) ?? base64ToBytes(response.data).byteLength;
  if (maxBytes > 0 && contentLength > maxBytes) {
    throw new Error(`Qortal resource exceeded the ${maxBytes.toLocaleString()} byte limit.`);
  }

  return {
    body: response.data,
    encoding: 'base64' as const,
    contentType: getContentType(response),
    contentLength,
  };
}

// Returns the direct URL of a Qortal resource on the selected node. The Qortal node serves these with
// CORS and ranged GET, so an in-app player (e.g. EmulatorJS) can stream the file straight from it.
async function getQortalResourceUrl(request: QdnAppRequest) {
  const resource = getQortalResourceRequest(request);
  const nodeApiUrl = await resolveQortalNodeApiUrl(cachedQortalNodeApiUrl?.source === 'local');

  return { url: `${getNodeApiUrlBase(nodeApiUrl)}${buildQortalResourcePath(resource)}` };
}

function normalizeResourceRequest(value: QortiumQdnAuthorizeRequest) {
  const service = getService(value.service);
  const name = getString(value.name);
  const identifier = getString(value.identifier);

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
  };
}

function buildQdnAuthorizePath(resource: QortiumQdnAuthorizeRequest) {
  const normalizedResource = normalizeResourceRequest(resource);
  const identifierPath = normalizedResource.identifier
    ? `/${encodeURIComponent(normalizedResource.identifier)}`
    : '';

  return `/render/authorize/${normalizedResource.service}/${encodeURIComponent(
    normalizedResource.name,
  )}${identifierPath}`;
}

function buildQdnRenderPath(resource: QortiumQdnAuthorizeRequest) {
  const normalizedResource = normalizeResourceRequest(resource);
  const identifierPath = normalizedResource.identifier
    ? `/${encodeURIComponent(normalizedResource.identifier)}`
    : '';

  return `/render/${normalizedResource.service}/${encodeURIComponent(
    normalizedResource.name,
  )}${identifierPath}`;
}

function getAuthorizationFailureMessage(status: number, responseBody: string) {
  return readableNodeErrorMessage(responseBody, `QDN resource authorization failed with HTTP ${status}.`);
}

async function isPublicRenderAvailable(nodeApiUrl: string, resource: QortiumQdnAuthorizeRequest) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await window.fetch(`${getNodeApiUrlBase(nodeApiUrl)}${buildQdnRenderPath(resource)}`, {
      method: 'GET',
      signal: controller.signal,
    });
  } catch {
    throw new Error(getNodeUnavailableMessage(nodeApiUrl));
  } finally {
    window.clearTimeout(timeout);
  }

  response.body?.cancel().catch(() => undefined);

  return response.status !== 401 && response.status !== 403;
}

async function authorizeConfiguredQdnResource(
  settings: StoredNodeSettings,
  resource: QortiumQdnAuthorizeRequest,
) {
  if (!settings.apiKey) {
    return;
  }

  const nodeApiUrl = await resolveNodeApiUrl(settings);
  const apiKey = getSendablePlatformNodeApiKey(settings, nodeApiUrl);

  if (!apiKey) {
    return;
  }

  let response: HttpResponse;

  try {
    response = await CapacitorHttp.request({
      url: `${getNodeApiUrlBase(nodeApiUrl)}${buildQdnAuthorizePath(resource)}`,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-API-KEY': apiKey,
      },
      responseType: 'text',
      connectTimeout: REQUEST_TIMEOUT_MS,
      readTimeout: REQUEST_TIMEOUT_MS,
    });
  } catch {
    throw new Error(getNodeUnavailableMessage(nodeApiUrl));
  }

  const responseBody = stringifyResponseData(response.data).trim();

  if (response.status < 200 || response.status >= 300) {
    if (/api key/i.test(responseBody)) {
      throw new Error('Node API key was rejected. Reconnect to the active local Core or update the node API key in settings.');
    }

    // An access-layer rejection (public API allowlist) is a 403 with a bare
    // HTML error page (or no body); real API errors carry a JSON body.
    if (response.status === 403 && (!responseBody || responseBody.startsWith('<'))) {
      let publicRenderAvailable = false;

      try {
        publicRenderAvailable = await isPublicRenderAvailable(nodeApiUrl, resource);
      } catch {
        publicRenderAvailable = false;
      }

      if (publicRenderAvailable) {
        console.warn('QDN authorization fallback: node blocked remote authorization; using public rendering.');
        return;
      }

      throw new Error(REMOTE_AUTHORIZATION_BLOCKED_MESSAGE);
    }

    throw new Error(getAuthorizationFailureMessage(response.status, responseBody));
  }
}

function buildResourcesSearchPath(request: QortiumQdnResourcesSearchRequest) {
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

function buildNamesSearchPath(request: QortiumQdnNamesSearchRequest) {
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

function buildRawResourcePath(resource: QortiumQdnRawResourceRequest, attachment = false) {
  const normalizedResource = normalizeResourceRequest(resource);
  const identifierPath = normalizedResource.identifier
    ? `/${encodeURIComponent(normalizedResource.identifier)}`
    : '';
  const { pathOnly, queryString } = splitPathAndQuery(getString(resource.path));
  const queryParams = new URLSearchParams(queryString);

  if (pathOnly) {
    queryParams.set('filepath', pathOnly);
  }

  if (attachment) {
    queryParams.set('attachment', 'true');
  }

  const rawQueryString = queryParams.toString();

  return `/arbitrary/${normalizedResource.service}/${encodeURIComponent(
    normalizedResource.name,
  )}${identifierPath}${rawQueryString ? `?${rawQueryString}` : ''}`;
}

function getSuggestedQdnDownloadFilename(request: QortiumQdnRawResourceRequest) {
  const requestedFilename = getString(request.suggestedFilename);

  if (requestedFilename) {
    return sanitizeFilename(requestedFilename, 'qdn-resource');
  }

  const resource = normalizeResourceRequest(request);

  return sanitizeFilename(
    `${resource.service}_${resource.name}_${resource.identifier ?? 'default'}`,
    'qdn-resource',
  );
}

async function fetchConfiguredRawResourceBase64(request: QortiumQdnRawResourceRequest) {
  const settings = await readNodeSettings();
  const { response } = await requestConfiguredNode(settings, buildRawResourcePath(request, true), 'arraybuffer');

  if (response.status < 200 || response.status >= 300) {
    if (response.status === 403 && settings.mode === 'network') {
      throw networkRestrictionError();
    }

    let errorBody = response.data;

    if (typeof errorBody === 'string' && !isQdnFileNotFoundResponse(response.status, errorBody)) {
      try {
        errorBody = new TextDecoder().decode(base64ToBytes(errorBody));
      } catch {
        // Capacitor can return either parsed JSON or base64 for an arraybuffer error body.
      }
    }

    if (isQdnFileNotFoundResponse(response.status, errorBody)) {
      throw new QdnFileNotFoundError(`QDN raw resource request failed with HTTP ${response.status}.`);
    }

    throw new Error(`QDN raw resource request failed with HTTP ${response.status}.`);
  }

  if (typeof response.data !== 'string') {
    throw new Error('QDN raw resource response was not binary data.');
  }

  return {
    content: response.data,
    contentLength: getContentLength(response) ?? base64ToBytes(response.data).byteLength,
    contentType: getContentType(response),
  };
}

// Guards so a pathological multi-file resource can't exhaust memory while we
// build the zip. Mirrors electron/qdn.ts.
const MAX_QDN_ZIP_FILE_COUNT = 5000;
const MAX_QDN_ZIP_TOTAL_BYTES = 512 * 1024 * 1024;

// On Android an 'arraybuffer' response comes back from CapacitorHttp as a base64
// string, so a raw fetch must decode to real bytes here (unlike electron, which
// gets a true ArrayBuffer). Shares the configured-node fetch + error handling
// with both the single-file and per-file (multi-file) download paths.
async function fetchConfiguredRawResourceBytes(
  request: QortiumQdnRawResourceRequest,
): Promise<Uint8Array> {
  const { content } = await fetchConfiguredRawResourceBase64(request);

  return base64ToBytes(content);
}

// Read a multi-file resource's relative file paths from its metadata. Mirrors
// electron/qdn.ts fetchResourceFileList: the metadata endpoint always lists the
// files, and the identifier defaults to the literal 'default'.
async function fetchQdnResourceFileList(
  request: QortiumQdnRawResourceRequest,
): Promise<string[]> {
  const resource = normalizeResourceRequest(request);
  const identifier = resource.identifier ? resource.identifier : 'default';
  const metadataPath = `/arbitrary/metadata/${resource.service}/${encodeURIComponent(
    resource.name,
  )}/${encodeURIComponent(identifier)}`;
  const settings = await readNodeSettings();
  const { response } = await requestConfiguredNode(settings, metadataPath, 'json');

  if (response.status < 200 || response.status >= 300) {
    if (response.status === 403 && settings.mode === 'network') {
      throw networkRestrictionError();
    }

    throw new Error(`Unable to read the resource file list (HTTP ${response.status}).`);
  }

  return isRecord(response.data) && Array.isArray(response.data.files)
    ? response.data.files.map(getString).filter(Boolean)
    : [];
}

// Multi-file resources have no single artifact to download, so assemble the
// archive client-side: list the files, fetch each one by its relative path, and
// zip them in-process. Mirrors electron/qdn.ts buildResourceZip.
async function buildQdnResourceZip(request: QortiumQdnRawResourceRequest): Promise<Uint8Array> {
  const files = await fetchQdnResourceFileList(request);

  if (files.length === 0) {
    throw new Error('This resource has no files to download.');
  }

  if (files.length > MAX_QDN_ZIP_FILE_COUNT) {
    throw new Error(`This resource has too many files to download as a zip (${files.length}).`);
  }

  const entries: Record<string, Uint8Array> = {};
  let totalBytes = 0;

  for (const file of files) {
    const bytes = await fetchConfiguredRawResourceBytes({ ...request, path: file });
    totalBytes += bytes.byteLength;

    if (totalBytes > MAX_QDN_ZIP_TOTAL_BYTES) {
      throw new Error('This resource is too large to download as a zip.');
    }

    entries[file] = bytes;
  }

  return zipSync(entries);
}

function getQdnAppResourceRequest(request: QdnAppRequest): QdnAppResourceRequest {
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

function buildQdnAppResourcesPath(request: QdnAppRequest, pathBase: string) {
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

async function buildMemberKicksPath(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
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

async function buildMemberBansPath(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const address = await getAddressForQdnRequest(request, context, 'Address');
  const queryParams = new URLSearchParams({ address });

  appendRequestQueryFields(queryParams, request, {
    limit: 'limit',
    offset: 'offset',
    reverse: 'reverse',
  });

  return `/groups/bans/member?${queryParams.toString()}`;
}

async function buildAccountGroupJoinRequestsPath(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const address = await getAddressForQdnRequest(request, context, 'Address');

  return `/groups/joinrequests/address/${encodeURIComponent(address)}`;
}

async function buildAdminGroupJoinRequestsPath(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const address = await getAddressForQdnRequest(request, context, 'Address');

  return `/groups/joinrequests/admin/${encodeURIComponent(address)}`;
}

async function getAddressForQdnRequest(
  request: QdnAppRequest,
  context: QdnAppRequestContext | undefined,
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

async function buildAccountGroupsPath(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
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

async function buildQortalTransactionsSearchPath(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
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

async function buildActiveChatsPath(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const address = await getAddressForQdnRequest(request, context, 'Address');
  const queryParams = new URLSearchParams();

  appendRequestQueryFields(queryParams, request, {
    encoding: 'encoding',
    hasChatReference: 'haschatreference',
  });

  const queryString = queryParams.toString();

  return `/chat/active/${encodeURIComponent(address)}${queryString ? `?${queryString}` : ''}`;
}

async function buildQortalActiveChatsPath(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const address = await getAddressForQdnRequest(request, context, 'Address');
  const queryParams = new URLSearchParams({ encoding: 'BASE64' });

  appendRequestQueryFields(queryParams, request, {
    encoding: 'encoding',
    hasChatReference: 'haschatreference',
    haschatreference: 'haschatreference',
  });

  return `/chat/active/${encodeURIComponent(address)}?${queryParams.toString()}`;
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

function applyQdnDisplaySettings(queryParams: URLSearchParams, context: QdnAppRequestContext | undefined) {
  if (!context?.displaySettings) {
    return;
  }

  queryParams.set('theme', context.displaySettings.theme);
  queryParams.set('lang', context.displaySettings.language);
  queryParams.set('textSize', context.displaySettings.textSize);
  queryParams.set('accent', context.displaySettings.accent);
  queryParams.set('uiStyle', context.displaySettings.ui);
}

async function getQdnResourceUrl(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const resource = getQdnAppResourceRequest(request);
  const status = await fetchNodeApiPayload(buildQdnResourceStatusPath(request), request);

  if (
    !isRecord(status) ||
    !status.status ||
    status.status === 'NOT_PUBLISHED'
  ) {
    throw new Error('Resource does not exist.');
  }

  const settings = await readNodeSettings();
  const nodeApiUrl = await resolveNodeApiUrl(settings);
  const { pathOnly, queryString } = splitPathAndQuery(resource.path);
  const encodedPath = getEncodedResourcePath(pathOnly);
  const identifierSegment = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams(queryString);

  applyQdnDisplaySettings(queryParams, context);

  const renderQueryString = queryParams.toString();

  return `${getNodeApiUrlBase(nodeApiUrl)}/render/${resource.service}/${encodeURIComponent(resource.name)}${identifierSegment}${
    encodedPath ? `/${encodedPath}` : ''
  }${renderQueryString ? `?${renderQueryString}` : ''}`;
}

async function getQdnResourceStreamUrl(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const resource = getQdnResourceStreamRequest(request);
  const renderUrl = await getQdnResourceUrl(request, context);
  const mimeType = getQdnResourceStreamProxyMimeType(resource);

  return isAndroid() ? authorizeQdnResourceStreamUrl(renderUrl, mimeType) : renderUrl;
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
  const settings = await readNodeSettings();
  const nodeApiUrl = await resolveNodeApiUrl(settings);

  assertLocalWriteConnection(settings, nodeApiUrl);

  const apiKey = getNodeApiKey(settings);
  let response: HttpResponse;

  try {
    response = await CapacitorHttp.request({
      url: `${getNodeApiUrlBase(nodeApiUrl)}/lists`,
      method: 'GET',
      headers: { 'X-API-KEY': apiKey },
      responseType: 'text',
      connectTimeout: REQUEST_TIMEOUT_MS,
      readTimeout: REQUEST_TIMEOUT_MS,
    });
  } catch {
    throw new Error(getNodeUnavailableMessage(nodeApiUrl));
  }

  const result = readNodeApiResponse(response, settings, QDN_APP_DEFAULT_MAX_BYTES);

  if (!result.ok) {
    throw getNodeApiResponseError(result, `Failed to get lists with HTTP ${result.status}.`);
  }

  return result.data;
}

async function getListForApp(request: QdnAppRequest) {
  const listName = getRequiredListName(request);
  const settings = await readNodeSettings();
  const nodeApiUrl = await resolveNodeApiUrl(settings);

  assertLocalWriteConnection(settings, nodeApiUrl);

  const apiKey = getNodeApiKey(settings);
  let response: HttpResponse;

  try {
    response = await CapacitorHttp.request({
      url: `${getNodeApiUrlBase(nodeApiUrl)}/lists/${encodeURIComponent(listName)}`,
      method: 'GET',
      headers: { 'X-API-KEY': apiKey },
      responseType: 'text',
      connectTimeout: REQUEST_TIMEOUT_MS,
      readTimeout: REQUEST_TIMEOUT_MS,
    });
  } catch {
    throw new Error(getNodeUnavailableMessage(nodeApiUrl));
  }

  const result = readNodeApiResponse(response, settings, QDN_APP_DEFAULT_MAX_BYTES);

  if (response.status === 404) {
    return [];
  }

  if (!result.ok) {
    throw getNodeApiResponseError(result, `Failed to get list with HTTP ${result.status}.`);
  }

  return result.data;
}

export async function handleQdnAppRequest(value: unknown, context?: QdnAppRequestContext) {
  if (!isRecord(value)) {
    throw new Error('QDN app requests must be objects.');
  }

  const request: QdnAppRequest = value;
  const action = getString(request.action).toUpperCase();

  if (!action) {
    throw new Error('QDN app request action is required.');
  }

  if (isQdnAccountFreeWriteAction(action)) {
    return handleQdnAccountFreeWriteAction(action, request, context);
  }

  if ((QDN_HOME_SETTINGS_ACTIONS as readonly string[]).includes(action)) {
    return handleQdnHomeSettingsAction(action as QdnHomeSettingsAction, request, context);
  }

  if ((QDN_APP_ASSIGNMENT_ACTIONS as readonly string[]).includes(action)) {
    return handleQdnAppAssignmentAction(action as QdnAppAssignmentAction, request, context);
  }

  if ((QDN_BOOKMARK_MANAGER_ACTIONS as readonly string[]).includes(action)) {
    return handleQdnBookmarkManagerAction(action as QdnBookmarkManagerAction, request, context);
  }

  if ((QDN_NOTIFICATION_MANAGER_ACTIONS as readonly string[]).includes(action)) {
    return handleQdnNotificationManagerAction(action as QdnNotificationManagerAction, request, context);
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

    case 'GET_HOST_INFO':
      return getQortiumHomeHostInfo();

    case 'GET_NODE_SETTINGS_METADATA':
      return fetchNodeApiPayload('/admin/settings/metadata', request);

    case 'GET_NODE_STATUS':
      return fetchNodeApiPayload('/admin/status', request);

    case 'GET_ACCOUNT_DATA':
      return fetchNodeApiPayload(
        `/addresses/${encodeURIComponent(await getAddressForQdnRequest(request, context, 'Address'))}`,
        request,
      );

    case 'GET_ACCOUNT_GROUPS':
      return fetchNodeApiPayload(await buildAccountGroupsPath(request, context), request);

    case 'GET_ACCOUNT_GROUP_JOIN_REQUESTS':
      return fetchNodeApiPayload(await buildAccountGroupJoinRequestsPath(request, context), request);

    case 'GET_ACCOUNT_NAMES':
      return fetchNodeApiPayload(
        `/names/address/${encodeURIComponent(await getAddressForQdnRequest(request, context, 'Address'))}`,
        request,
      );

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
      return fetchQortalNodeApiPayload(
        `/addresses/balance/${encodeURIComponent(await getAddressForQdnRequest(request, context, 'Address'))}`,
        request,
      );

    case 'GET_QORTAL_PRIMARY_NAME':
      return getQortalPrimaryNameForApp(request, context);

    case 'GET_QORTAL_ACCOUNT_GROUPS':
      return fetchQortalNodeApiPayload(
        buildQortalAccountGroupsPath(await getAddressForQdnRequest(request, context, 'Address')),
        request,
      );

    case 'GET_QORTAL_ACCOUNT_NAMES':
      return fetchQortalNodeApiPayload(
        `/names/address/${encodeURIComponent(await getAddressForQdnRequest(request, context, 'Address'))}`,
        request,
      );

    case 'GET_QORTAL_NAME_DATA':
      return getQortalNameDataForApp(request);

    case 'GET_QORTAL_NODE_STATUS':
      return fetchQortalNodeApiPayload('/admin/status', request);

    case 'SEND_QORT':
      return sendQortForApp(request, context);

    case 'SEND_QORTAL_GROUP_CHAT':
      return sendQortalGroupChatForApp(request, context);

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
      return fetchNodeApiPayload(buildQdnAppResourcesPath(request, '/arbitrary/resources'), request);

    case 'SEARCH_QDN_RESOURCES':
      return fetchNodeApiPayload(buildQdnAppResourcesPath(request, '/arbitrary/resources/search'), request);

    case 'FETCH_QORTAL_RESOURCE':
      return fetchQortalResourceBinary(request);

    case 'GET_QORTAL_RESOURCE_METADATA':
      return fetchQortalNodeApiPayload(buildQortalMetadataPath(request), request);

    case 'GET_QORTAL_RESOURCE_STATUS':
      return fetchQortalNodeApiPayload(buildQortalStatusPath(request), request);

    case 'GET_QORTAL_RESOURCE_URL':
      return getQortalResourceUrl(request);

    case 'SEARCH_QORTAL_RESOURCES':
      return fetchQortalNodeApiPayload(buildQdnAppResourcesPath(request, '/arbitrary/resources/search'), request);

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
      return requestPrivateGroupChatKeyForApp(request, context);

    case 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS':
      return resolvePrivateGroupChatKeyRequestsForApp(request, context);

    case 'PUBLISH_QDN_RESOURCE':
      return publishQdnResourceForApp(request, context);

    case 'SELECT_QDN_PUBLISH_SOURCE':
      return selectQdnPublishSourceForApp(request, context);

    case 'PREVIEW_QDN_PUBLISH_SOURCE':
      return previewQdnPublishSourceForApp(request, context);

    case 'PUBLISH_MULTIPLE_QDN_RESOURCES':
      return publishMultipleQdnResourcesForApp(request, context);

    case 'DELETE_QDN_RESOURCE':
      return deleteQdnResourceForApp(request, context);

    case 'JOIN_GROUP':
      return joinGroupForApp(request, context);

    case 'START_MINTING':
      return startMintingForApp(context);

    case 'REMOVE_MINTING_ACCOUNT':
      return removeMintingAccountForApp(request, context);

    case 'APPROVE_GROUP_JOIN_REQUEST':
      return approveGroupJoinRequestForApp(request, context);

    case 'GROUP_APPROVAL':
      return requestGroupApprovalForApp(request, context);

    case 'INVITE_TO_GROUP':
      return inviteToGroupForApp(request, context);

    case 'LEAVE_GROUP':
      return leaveGroupForApp(request, context);

    case 'UPDATE_GROUP':
      return updateGroupForApp(request, context);

    case 'SET_GROUP_AVATAR':
      return setGroupAvatarForApp(request, context);

    case 'SET_ACCOUNT_AVATAR':
      return setAccountAvatarForApp(request, context);

    case 'CREATE_GROUP':
      return createGroupForApp(request, context);

    case 'ADD_GROUP_ADMIN':
      return addGroupAdminForApp(request, context);

    case 'REMOVE_GROUP_ADMIN':
      return removeGroupAdminForApp(request, context);

    case 'GROUP_BAN':
      return banFromGroupForApp(request, context);

    case 'CANCEL_GROUP_BAN':
      return cancelGroupBanForApp(request, context);

    case 'GROUP_KICK':
      return kickFromGroupForApp(request, context);

    case 'CANCEL_GROUP_INVITE':
      return cancelGroupInviteForApp(request, context);

    case 'SET_GROUP':
      return setDefaultGroupForApp(request, context);

    case 'PAYMENT':
      return sendCoinForApp(request, context, 'PAYMENT');

    case 'SEND_COIN':
      return sendCoinForApp(request, context, 'SEND_COIN');

    case 'TRANSFER_ASSET':
      return transferAssetForApp(request, context);

    case 'SET_CURRENT_FOREIGN_SERVER':
      return setCurrentForeignServerForApp(request, context);

    case 'CREATE_POLL':
      return createPollForApp(request, context);

    case 'VOTE_ON_POLL':
      return voteOnPollForApp(request, context);

    case 'UPDATE_POLL':
      return updatePollForApp(request, context);

    case 'RATE_ACCOUNT':
      return rateAccountForApp(request, context);

    case 'RATE_RESOURCE':
      return rateResourceForApp(request, context);

    case 'GET_RESOURCE_RATING':
      return getResourceRatingForApp(request, context);

    case 'GET_ACCOUNT_RATING':
      return getAccountRatingForApp(request, context);

    case 'GET_ALL_LISTS':
      return getAllListsForApp();

    case 'GET_LIST':
      return getListForApp(request);

    case 'REGISTER_NAME':
      return registerNameForApp(request, context);

    case 'UPDATE_NAME':
      return updateNameForApp(request, context);

    case 'SELL_NAME':
      return sellNameForApp(request, context);

    case 'CANCEL_SELL_NAME':
      return cancelSellNameForApp(request, context);

    case 'BUY_NAME':
      return buyNameForApp(request, context);

    case 'SEND_CHAT_MESSAGE':
      return sendChatMessageForApp(request, context);

    case 'SEND_MESSAGE':
      return sendMessageForApp(request, context);

    case 'IS_USING_PUBLIC_NODE': {
      const settings = await readNodeSettings();

      return settings.mode === 'network';
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

      if (!context?.onOpenNewTab) {
        throw new Error('Opening a new tab is not available in this context.');
      }

      context.onOpenNewTab(address);

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

      if (!context?.onOpenInCurrentTab) {
        throw new Error('Navigating the current tab is not available in this context.');
      }

      context.onOpenInCurrentTab(address);

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

      if (!context?.onOpenMediaPlayer) {
        throw new Error('The media player is not available in this context.');
      }

      context.onOpenMediaPlayer({
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

      if (!context?.onOpenDocumentViewer) {
        throw new Error('The document viewer is not available in this context.');
      }

      context.onOpenDocumentViewer({
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

      if (!context?.onOpenResourceViewer) {
        throw new Error('The QDN resource viewer is not available in this context.');
      }

      context.onOpenResourceViewer(resource);

      return true;
    }

    case 'SAVE_QDN_RESOURCE': {
      // Mirror the desktop handler (electron/qdn.ts): fetch the resource's raw
      // bytes and let the user save them. Desktop shows a native save dialog;
      // here we reuse Home's existing Android SAF / web-anchor download path
      // (saveBytesToFile), so a Q-App's SAVE_QDN_RESOURCE works on mobile too.
      const resource = getQdnAppResourceRequest(request);
      const rawResource: QortiumQdnRawResourceRequest = {
        service: resource.service,
        name: resource.name,
        identifier: resource.identifier,
        path: resource.path || undefined,
        suggestedFilename: getString(getRequestValue(request, 'filename')) || undefined,
      };
      const fileName = getSuggestedQdnDownloadFilename(rawResource);
      const { content, contentType } = await fetchConfiguredRawResourceBase64(rawResource);
      const { canceled } = await saveBytesToFile(fileName, base64ToBytes(content), contentType || undefined);
      return { canceled };
    }

    case 'SHOW_NOTIFICATION': {
      if (!context) {
        throw new Error('QDN app notification request does not belong to an active app view.');
      }

      return showNotificationForApp(request, context);
    }

    case 'NOTIFICATION_HAS_PERMISSION': {
      if (!context) throw new Error('QDN app notification request does not belong to an active app view.');
      return { granted: !!(await getNotificationStore()).grants[getQdnNotificationPermissionCacheKey(context)] };
    }

    case 'NOTIFICATION_ADD': {
      if (!context) throw new Error('QDN app notification request does not belong to an active app view.');
      const appKey = getQdnNotificationPermissionCacheKey(context);
      // Subscription rules follow Home's active account, just like the Android
      // watcher. Rejecting an account switch during approval avoids silently
      // binding the app's request to a different account than the user reviewed.
      const accountAddress = await getActiveAccountAddressForNotifications();
      const subscriptions = sanitizeQdnNotificationSubscriptions(
        getRequestValue(request, 'subscriptions'),
        sanitizeQdnAppTitle,
      );
      await requestQdnNotificationPermissionApproval(context, 'NOTIFICATION_ADD');
      if (await getActiveAccountAddressForNotifications() !== accountAddress) {
        throw new Error('The active account changed while notification permission was being approved. Please try again.');
      }
      return replaceAppNotificationRules(appKey, subscriptions, accountAddress);
    }

    case 'NOTIFICATION_GET': {
      if (!context) throw new Error('QDN app notification request does not belong to an active app view.');
      return (await getNotificationStore()).rules[getQdnNotificationPermissionCacheKey(context)] ?? [];
    }

    case 'NOTIFICATION_REMOVE': {
      if (!context) throw new Error('QDN app notification request does not belong to an active app view.');
      // This only removes the calling app's own rules, so it is deliberately
      // unprompted: the action reduces an existing app-scoped capability.
      return removeAppNotificationRules(
        getQdnNotificationPermissionCacheKey(context),
        sanitizeQdnNotificationIds(getRequestValue(request, 'notificationIds')),
      );
    }

    case 'WHICH_UI':
      return 'QORTIUM_HOME_ANDROID';

    case 'SHOW_ACTIONS': {
      // On a public/network node, only report actions that can actually succeed
      // there, so apps that gate UI off SHOW_ACTIONS don't show controls (e.g.
      // RATE_ACCOUNT) that would throw for lack of a local write connection.
      const settings = await readNodeSettings();

      if (settings.mode !== 'network') return [...QDN_APP_BRIDGE_ACTIONS];

      try {
        const nodeApiUrl = await resolveNodeApiUrl(settings);
        await getPublicPollCapabilities(nodeApiUrl);
        return [...QDN_PUBLIC_NODE_BRIDGE_ACTIONS, ...QDN_POLL_ACTIONS];
      } catch {
        return [...QDN_PUBLIC_NODE_BRIDGE_ACTIONS];
      }
    }

    default:
      throw new Error(`${action} QDN app request is not supported yet.`);
  }
}

function createUnsupportedAccountsApi(): PlatformApi['accounts'] {
  const emptyState = {
    accounts: [],
    activeAccountId: null,
  };
  const unsupported = (): never => {
    throw new Error('Wallet management is only available in the desktop app right now.');
  };

  return {
    list: async () => emptyState,
    getCapabilities: async () => ({
      canCreateWallet: false,
      canExportWalletFile: false,
      canLoadWalletFile: false,
    }),
    getProfile: async (accountId) => ({
      accountId,
      address: '',
      label: '',
      name: null,
    }),
    selectWalletFile: async () => unsupported(),
    discardLoadedWallet: async () => undefined,
    saveLoadedWallet: async () => unsupported(),
    createWallet: async () => unsupported(),
    getAddressFromPrivateKey: async () => unsupported(),
    importPrivateKeyWallet: async () => unsupported(),
    exportWallet: async () => unsupported(),
    setActiveAccount: async () => emptyState,
    addDerivedAddress: async () => unsupported(),
    unlockWallet: async () => emptyState,
    lockWallet: async () => emptyState,
    removeWallet: async () => emptyState,
  };
}

function createFallbackApi(): PlatformApi {
  return {
    appName: 'Qortium Home',
    accounts: isAndroid() ? createStoredAccountsApi() : createUnsupportedAccountsApi(),
    qdnPermissions: {
      onUnlockRequest(callback) {
        qdnUnlockListeners.add(callback);

        return () => {
          qdnUnlockListeners.delete(callback);
        };
      },
      onWriteRequest(callback) {
        qdnWriteListeners.add(callback);

        return () => {
          qdnWriteListeners.delete(callback);
        };
      },
      resolveUnlockRequest: async (requestId, approved) => {
        const pendingApproval = pendingQdnUnlockApprovals.get(requestId);

        if (!pendingApproval) {
          return;
        }

        window.clearTimeout(pendingApproval.timeoutId);
        pendingQdnUnlockApprovals.delete(requestId);
        pendingApproval.resolve(approved);
      },
      resolveWriteRequest: async (requestId, approved) => {
        const pendingApproval = pendingQdnWriteApprovals.get(requestId);

        if (!pendingApproval) {
          return;
        }

        window.clearTimeout(pendingApproval.timeoutId);
        pendingQdnWriteApprovals.delete(requestId);
        pendingApproval.resolve(approved);
      },
    },
    updates: {
      async downloadAsset(request) {
        return downloadUpdateAsset(request);
      },
      async downloadReleaseAsset(request) {
        return downloadFallbackReleaseAsset(request);
      },
      async getEnvironment() {
        return getFallbackUpdateEnvironment();
      },
      onDownloadProgress() {
        return () => {};
      },
      async openDownloadedFile(filePath) {
        if (isAndroid()) {
          const normalizedFilePath = getString(filePath);

          if (!normalizedFilePath) {
            throw new Error('Downloaded update path is required.');
          }

          await UpdateInstaller.installApk({ filePath: normalizedFilePath });
          return;
        }

        throw new Error('Opening downloaded update files is only available in the desktop app right now.');
      },
      async openReleasePage(url) {
        window.open(normalizeExternalUrl(url), '_blank', 'noopener,noreferrer');
      },
      async showDownloadedFile() {
        throw new Error('Showing downloaded update files is only available in the desktop app right now.');
      },
    },
    system: {
      async openPath() {
        throw new Error('Opening local paths is only available in the desktop app right now.');
      },
      async revealPath() {
        throw new Error('Revealing local paths is only available in the desktop app right now.');
      },
    },
    node: {
      async checkCoreUpdate() {
        return requestCoreOnChainUpdate('GET');
      },
      async enableApiDocumentation() {
        return enableNodeApiDocumentation();
      },
      async getSettings() {
        return getNodeSettingsSnapshot(await readNodeSettings());
      },
      async installCoreUpdate() {
        return requestCoreOnChainUpdate('POST');
      },
      async saveSettings(request) {
        const settings = normalizeNodeSettingsRequest(request);

        await writeNodeSettings(settings);

        return getNodeSettingsSnapshot(settings);
      },
      async setAllowedTransports(transports) {
        return setNodeAllowedTransports(transports);
      },
      async testConnection(request) {
        return testNodeSettings(normalizeNodeSettingsRequest(request));
      },
      async getStatus() {
        return testNodeSettings(await readNodeSettings());
      },
    },
    qdn: {
      async authorizeResource(request) {
        const resource = normalizeResourceRequest(request);
        const settings = await readNodeSettings();

        await authorizeConfiguredQdnResource(settings, resource);

        return {
          authorized: true,
          nodeApiUrl: await resolveNodeApiUrl(settings),
        };
      },
      async listResources(request) {
        const settings = await readNodeSettings();
        const { response } = await requestConfiguredNode(
          settings,
          buildResourcesSearchPath(request),
          'json',
        );

        if (response.status < 200 || response.status >= 300) {
          if (response.status === 403 && settings.mode === 'network') {
            throw networkRestrictionError();
          }

          throw new Error(
            stringifyResponseData(response.data) || `QDN resource search failed with HTTP ${response.status}.`,
          );
        }

        return response.data;
      },
      async searchNames(request) {
        // Guard against an empty query, which would list every registered name.
        if (!getString(request.query)) {
          return [];
        }

        const settings = await readNodeSettings();
        const { response } = await requestConfiguredNode(
          settings,
          buildNamesSearchPath(request),
          'json',
        );

        if (response.status < 200 || response.status >= 300) {
          if (response.status === 403 && settings.mode === 'network') {
            throw networkRestrictionError();
          }

          throw new Error(
            stringifyResponseData(response.data) || `QDN name search failed with HTTP ${response.status}.`,
          );
        }

        return response.data;
      },
      async fetchNodeApi(request) {
        const settings = await readNodeSettings();
        const nodeApiUrl = await resolveNodeApiUrl(settings);
        const maxBytes = Math.max(0, Math.floor(getNumber(request.maxBytes) ?? 0));
        const method = getReadOnlyMethod(request.method);
        const { response } = await requestConfiguredNode(
          settings,
          getNodeApiPath(request.path, nodeApiUrl),
          'text',
          method,
        );
        const rawBody = method === 'HEAD' ? '' : stringifyResponseData(response.data);
        const networkRestricted = response.status === 403 && settings.mode === 'network';
        const body = networkRestricted ? getNetworkRestrictionMessage() : rawBody;
        const contentLength = getContentLength(response);
        const contentType = getContentType(response);
        const bodyLength = getByteLength(body);

        if (maxBytes > 0 && typeof contentLength === 'number' && contentLength > maxBytes) {
          return {
            contentLength,
            contentType,
            status: response.status,
            statusText: getStatusText(response.status),
            tooLarge: true,
          };
        }

        if (maxBytes > 0 && bodyLength > maxBytes) {
          return {
            contentLength: bodyLength,
            contentType,
            status: response.status,
            statusText: getStatusText(response.status),
            tooLarge: true,
          };
        }

        return {
          body,
          contentLength: contentLength ?? bodyLength,
          contentType,
          ...(networkRestricted ? { code: 'PUBLIC_NODE_READ_ONLY' } : {}),
          status: response.status,
          statusText: getStatusText(response.status),
          tooLarge: false,
        };
      },
      async fetchResourceText(request) {
        const settings = await readNodeSettings();
        const maxBytes = Math.max(0, Math.floor(getNumber(request.maxBytes) ?? 0));
        const { response } = await requestConfiguredNode(
          settings,
          buildRawResourcePath(request),
          'text',
        );

        if (response.status < 200 || response.status >= 300) {
          if (response.status === 403 && settings.mode === 'network') {
            throw networkRestrictionError();
          }

          throw new Error(
            stringifyResponseData(response.data) || `QDN raw resource request failed with HTTP ${response.status}.`,
          );
        }

        const content = stringifyResponseData(response.data);
        const contentLength = getContentLength(response);
        const contentType = getContentType(response);
        const bodyLength = getByteLength(content);

        if (maxBytes > 0 && typeof contentLength === 'number' && contentLength > maxBytes) {
          return {
            contentLength,
            contentType,
            tooLarge: true,
          };
        }

        if (maxBytes > 0 && bodyLength > maxBytes) {
          return {
            contentLength: bodyLength,
            contentType,
            tooLarge: true,
          };
        }

        return {
          content,
          contentLength: contentLength ?? bodyLength,
          contentType,
          tooLarge: false,
        };
      },
      async fetchResourceData(request) {
        const maxBytes = Math.max(0, Math.floor(getNumber(request.maxBytes) ?? 0));
        let result: Awaited<ReturnType<typeof fetchConfiguredRawResourceBase64>>;

        try {
          result = await fetchConfiguredRawResourceBase64(request);
        } catch (error) {
          if (getBoolean(request.allowMissing) === true && error instanceof QdnFileNotFoundError) {
            return {
              data: '',
              contentType: '',
              contentLength: 0,
              missing: true,
              tooLarge: false,
            };
          }

          throw error;
        }

        if (maxBytes > 0 && result.contentLength > maxBytes) {
          return {
            data: '',
            contentType: result.contentType,
            contentLength: result.contentLength,
            tooLarge: true,
          };
        }

        return {
          data: result.content,
          contentType: result.contentType,
          contentLength: result.contentLength,
        };
      },
      async prepareArchiveRender() {
        throw new Error('Inline archive app rendering is only available in the desktop app right now.');
      },
      async previewContent(request = {}) {
        // Android cannot hand the node a local path, so keep the picked bytes
        // in memory and refresh by token instead of reopening the picker.
        const requestedSourceToken = isRecord(request) ? getString(request.sourceToken) : '';
        let sourceToken = requestedSourceToken;
        let previewEntry = sourceToken ? getNativePreviewCacheEntry(sourceToken) : null;

        if (sourceToken && !previewEntry) {
          throw new Error('Preview source is no longer available. Choose the file again.');
        }

        if (!previewEntry) {
          const requestedKind = isRecord(request) ? getString(request.kind) : '';
          const selectedSource =
            requestedKind === 'directory' && isAndroid()
              ? await selectNativePreviewDirectorySource()
              : await (async () => {
                  const file = await pickPreviewFile();
                  if (!file) {
                    return null;
                  }

                  const { service, archive } = resolvePreviewServiceForFile(file.name);
                  const base64 = arrayBufferToBase64(await file.arrayBuffer());

                  return {
                    archive,
                    base64,
                    service,
                    sourceKind: archive ? 'directory' as const : 'file' as const,
                    sourceName: file.name,
                    sourcePath: file.name,
                  };
                })();

          if (!selectedSource) {
            return { canceled: true };
          }

          sourceToken = cacheNativePreviewEntry(selectedSource);
          previewEntry = getNativePreviewCacheEntry(sourceToken);

          if (!previewEntry) {
            throw new Error('Unable to cache the selected preview source.');
          }
        }

        const settings = await readNodeSettings();
        const apiKey = getNodeApiKey(settings);
        const nodeApiUrl = await resolveNodeApiUrl(settings);
        const query = `archive=${previewEntry.archive ? 'true' : 'false'}&filename=${encodeURIComponent(previewEntry.sourceName)}`;

        const result = await postLocalNodeText(
          nodeApiUrl,
          `/arbitrary/preview/${previewEntry.service}/upload?${query}`,
          previewEntry.base64,
          apiKey,
          'Generating the preview failed.',
        );

        const renderPath = result.body.trim();
        if (!renderPath.startsWith('/render/')) {
          throw new Error('The node returned an unexpected preview URL.');
        }

        return {
          canceled: false,
          renderUrl: `${getNodeApiUrlBase(nodeApiUrl)}${renderPath}`,
          service: previewEntry.service,
          sourceKind: previewEntry.sourceKind,
          sourceName: previewEntry.sourceName,
          sourcePath: previewEntry.sourcePath,
          sourceToken,
        };
      },
      async downloadResource(request) {
        if (!isAndroid()) {
          throw new Error('Saving QDN downloads is only available in the desktop app and Android app.');
        }

        const fileName = getSuggestedQdnDownloadFilename(request);

        // Assemble the bytes the same way the desktop does: single-file fetches
        // the resource directly; multi-file zips the metadata file list
        // client-side with fflate. The bridge can't carry huge base64 payloads,
        // so stage the result in a temp cache file and let the native SAF plugin
        // stream it to the user-chosen content:// URI.
        let bytes: Uint8Array;
        let mimeType: string | undefined;

        if (request.multiFile) {
          bytes = await buildQdnResourceZip(request);
          mimeType = 'application/zip';
        } else {
          const downloadedResource = await fetchConfiguredRawResourceBase64(request);
          bytes = base64ToBytes(downloadedResource.content);
          mimeType = downloadedResource.contentType || undefined;
        }

        const tempPath = `${QDN_DOWNLOADS_DIR}/${Date.now()}-${fileName}`;

        await Filesystem.writeFile({
          path: tempPath,
          data: bytesToBase64(bytes),
          directory: Directory.Cache,
          recursive: true,
        });

        const tempUri = await Filesystem.getUri({
          path: tempPath,
          directory: Directory.Cache,
        });

        try {
          const saved = await QdnFileSaver.saveFile({
            path: tempUri.uri,
            fileName,
            mimeType,
          });

          if (saved.canceled) {
            return { canceled: true };
          }

          return {
            canceled: false,
            fileName: saved.name,
            filePath: saved.uri,
            size: saved.size,
          };
        } finally {
          // The native plugin best-effort deletes the temp file after a
          // successful copy; remove it here too so a cancel or error never
          // leaves staged bytes in the cache.
          await Filesystem.deleteFile({ path: tempPath, directory: Directory.Cache }).catch(() => undefined);
        }
      },
      async openResourceExternally(request) {
        if (!isAndroid()) {
          throw new Error('Opening QDN resources externally is only available in the Android app.');
        }

        if (request.multiFile) {
          throw new Error('Opening multi-file QDN resources externally is not supported.');
        }

        const fileName = getSuggestedQdnDownloadFilename(request);
        const settings = await readNodeSettings();
        const nodeApiUrl = await resolveNodeApiUrl(settings);
        const apiKey = getNodeApiKey(settings);
        const mimeType = request.mimeType || undefined;
        const tempPath = `${QDN_DOWNLOADS_DIR}/${Date.now()}-${fileName}`;

        const headers = apiKey ? { 'X-API-KEY': apiKey } : undefined;

        await Filesystem.downloadFile({
          url: `${getNodeApiUrlBase(nodeApiUrl)}${buildRawResourcePath(request, true)}`,
          path: tempPath,
          directory: Directory.Cache,
          recursive: true,
          ...(headers ? { headers } : {}),
        });

        const tempUri = await Filesystem.getUri({
          path: tempPath,
          directory: Directory.Cache,
        });

        await QdnFileSaver.openCacheFile({
          path: tempUri.uri,
          fileName,
          mimeType,
        });

        return {
          canceled: false,
          fileName,
          filePath: tempUri.uri,
          opened: true,
        };
      },
      async openDownloadedResource(request) {
        if (!isAndroid()) {
          throw new Error('Opening a saved QDN download is only available in the Android app.');
        }

        await QdnFileSaver.openSavedFile({ uri: request.uri, mimeType: request.mimeType });
      },
    },
  };
}

type AndroidHomeV2Security = {
  lockOnExit: boolean;
  manuallyLocked: boolean;
  rememberUnlock: boolean;
};

type AndroidHomeV2SecurityStore = {
  accounts: Record<string, AndroidHomeV2Security>;
  version: 1;
};

const DEFAULT_ANDROID_HOME_V2_SECURITY: AndroidHomeV2Security = {
  lockOnExit: true,
  manuallyLocked: false,
  rememberUnlock: false,
};

async function readAndroidHomeV2SecurityStore(): Promise<AndroidHomeV2SecurityStore> {
  try {
    const raw = await getStoredValue(HOME_V2_ACCOUNT_SECURITY_KEY);
    if (!raw) return { accounts: {}, version: 1 };
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !isRecord(value.accounts)) return { accounts: {}, version: 1 };
    const accounts: Record<string, AndroidHomeV2Security> = {};
    for (const [accountId, candidate] of Object.entries(value.accounts)) {
      if (!isRecord(candidate)) continue;
      accounts[accountId] = {
        lockOnExit: candidate.lockOnExit !== false,
        manuallyLocked: candidate.manuallyLocked === true,
        rememberUnlock: candidate.rememberUnlock === true,
      };
    }
    return { accounts, version: 1 };
  } catch {
    return { accounts: {}, version: 1 };
  }
}

async function writeAndroidHomeV2SecurityStore(store: AndroidHomeV2SecurityStore) {
  await setStoredValue(HOME_V2_ACCOUNT_SECURITY_KEY, JSON.stringify(store));
}

function androidHomeV2Security(store: AndroidHomeV2SecurityStore, accountId: string) {
  return store.accounts[accountId] ?? { ...DEFAULT_ANDROID_HOME_V2_SECURITY };
}

let androidHomeV2RecoveryMessage: string | null = null;

async function buildAndroidHomeV2VaultState(): Promise<HomeV2VaultState> {
  if (androidHomeV2RecoveryMessage) {
    return {
      accounts: [],
      readiness: 'recovery',
      recoveryMessage: androidHomeV2RecoveryMessage,
      secureStorageAvailable: false,
      selectedAccountId: null,
      selectedAddressId: null,
      version: 2,
    };
  }
  try {
    const [store, securityStore, storage] = await Promise.all([
      readWalletStore(),
      readAndroidHomeV2SecurityStore(),
      HomeV2SecureStorage.isAvailable().catch(() => ({ available: false })),
    ]);
    const selected = store.activeAccountId
      ? resolveWalletAccount(store.wallets, store.activeAccountId)
      : null;
    return {
      accounts: store.wallets.map((wallet) => ({
        addresses: [
          { address: wallet.address, id: wallet.id, index: 0, label: 'Primary address' },
          ...wallet.derivedAddresses.map((derived) => ({
            address: derived.address,
            id: getDerivedAccountId(wallet.id, derived.index),
            index: derived.index,
            label: `Address ${derived.index + 1}`,
          })),
        ],
        id: wallet.id,
        isUnlocked: unlockedWalletSeeds.has(wallet.id),
        label: wallet.label,
        security: androidHomeV2Security(securityStore, wallet.id),
        supportsDerivedAddresses: !isPrivateKeyWallet(wallet.encryptedWallet),
      })),
      readiness: 'ready',
      recoveryMessage: null,
      secureStorageAvailable: storage.available === true,
      selectedAccountId: selected?.wallet.id ?? null,
      selectedAddressId: store.activeAccountId,
      version: 2,
    };
  } catch (error) {
    return {
      accounts: [],
      readiness: 'recovery',
      recoveryMessage: error instanceof Error ? error.message : 'Home could not validate the saved account store.',
      secureStorageAvailable: false,
      selectedAccountId: null,
      selectedAddressId: null,
      version: 2,
    };
  }
}

// Home v2 SEND_CHAT_MESSAGE (Chat 2.0 Phase 1, docs/CHAT_2_0_PLAN.md). These
// mirror sendKeylessPublicGroupChatMessage / sendQortalGroupChatForApp above,
// but take an explicit v2-resolved nodeApiUrl (v2's Android node client has
// its own node settings, separate from v1's), send no API key at all (not
// even the empty-when-unsafe fallback those v1 paths use), and return v2's
// {signature, timestamp} contract instead of the raw processed-transaction
// payload. They reuse the same module-level memory-pow worker, CHAT_POW_DIFFICULTY,
// and shared electron/ builders/validators as the v1 functions above.
//
// isStillValid mirrors the desktop bridge's recheck (electron/home-v2-app-bridge.ts
// sendHomeV2ChatMessage's isStillValid closure): same tab/account/resource
// context, account still unlocked, and same node route. It is threaded into
// computeChatNonce (polled every 500ms during the — potentially tens-of-
// seconds — memory-pow) and rechecked once more immediately before signing,
// so a context change mid-PoW cancels the send instead of silently signing
// and broadcasting under a stale account/node/tab.
async function sendHomeV2QortiumChatMessage(
  nodeApiUrl: string,
  txGroupId: number,
  message: string,
  signingKey: { address: string; publicKey58: string; secretKey: Uint8Array },
  isStillValid: () => boolean | Promise<boolean>,
) {
  const timestamp = Date.now();
  const data = encodeChatTextData(message);
  const unsignedTransaction = await postLocalNodeText(
    nodeApiUrl,
    '/chat/public/build',
    JSON.stringify({
      senderPublicKey: signingKey.publicKey58,
      data,
      isText: true,
      isEncrypted: false,
      txGroupId,
      timestamp,
      fee: 0,
    }),
    '',
    'Chat transaction build failed.',
    'application/json',
    CHAT_SIGNING_RESPONSE_MAX_BYTES,
  );

  const unsignedBytes = base58Decode(unsignedTransaction.body);
  // Never sign node-provided bytes without checking they encode exactly the
  // sender/group/message/timestamp we asked for.
  assertPublicChatTransaction(unsignedBytes, {
    data: base58Decode(data),
    publicKey: base58Decode(signingKey.publicKey58),
    timestamp,
    txGroupId,
  });
  const nonce = await computeChatNonce(unsignedBytes, CHAT_POW_DIFFICULTY, isStillValid);
  if (!(await isStillValid())) {
    throw new Error('The signing context changed before the chat message could be submitted.');
  }
  const signedBytes = signChatTransaction(unsignedBytes, nonce, signingKey.secretKey);

  await postLocalNodeText(
    nodeApiUrl,
    '/transactions/process?apiVersion=2',
    base58Encode(signedBytes),
    '',
    'Chat transaction processing failed.',
    'text/plain',
    CHAT_SIGNING_RESPONSE_MAX_BYTES,
  );

  return { signature: getSignatureFromSignedTransactionBytes(signedBytes), timestamp };
}

async function sendHomeV2QortalChatMessage(
  nodeApiUrl: string,
  txGroupId: number,
  message: string,
  signingKey: { address: string; publicKey58: string; secretKey: Uint8Array },
  isStillValid: () => boolean | Promise<boolean>,
) {
  // Home does not implement Qortal private-group encryption yet
  // (docs/CHAT_2_0_PLAN.md); refuse to broadcast plaintext into a group that
  // is not verifiably open, the same guard v1's Qortal group send applies.
  let groupData: unknown = null;
  try {
    groupData = await getGroupDataForChat(nodeApiUrl, txGroupId, CHAT_SIGNING_RESPONSE_MAX_BYTES);
  } catch {
    groupData = null;
  }
  assertOpenQortalGroupMetadata(groupData, txGroupId);

  const timestamp = Date.now();
  const unsignedBytes = buildUnsignedQortalGroupChatTransactionBytes({
    lastReference: getRandomQortalReference(),
    message,
    senderPublicKey: signingKey.publicKey58,
    timestamp,
    txGroupId,
  });
  const difficulty = await resolveQortalChatPowDifficulty(signingKey.address);
  const nonce = await computeChatNonce(unsignedBytes, difficulty, isStillValid);
  if (!(await isStillValid())) {
    throw new Error('The signing context changed before the chat message could be submitted.');
  }
  const stampedBytes = stampQortalGroupChatNonce(unsignedBytes, nonce);
  const signatureBytes = nacl.sign.detached(stampedBytes, signingKey.secretKey);
  const signedBytes = appendSignatureToTransactionBytes(stampedBytes, signatureBytes);

  await postLocalNodeText(
    nodeApiUrl,
    '/transactions/process?apiVersion=2',
    base58Encode(signedBytes),
    '',
    'Qortal chat message broadcast failed.',
    'text/plain',
    CHAT_SIGNING_RESPONSE_MAX_BYTES,
  );

  return { signature: getSignatureFromSignedTransactionBytes(signedBytes), timestamp };
}

let androidHomeV2AutoUnlockAttempted = false;

export function createAndroidHomeV2VaultClient(): HomeV2VaultClient {
  const prepareMutation = async () => {
    try {
      await HomeV2ProfileRecovery.ensureBackup();
      androidHomeV2RecoveryMessage = null;
    } catch (error) {
      androidHomeV2RecoveryMessage = error instanceof Error
        ? error.message
        : 'Home could not create or verify its profile backup.';
      throw error;
    }
    const state = await buildAndroidHomeV2VaultState();
    if (state.readiness !== 'ready') throw new Error('Account changes are unavailable until profile recovery is complete.');
  };
  const unlockWithRequest = async (request: {
    accountId: string;
    password?: string;
    useRememberedUnlock?: boolean;
  }) => {
    await prepareMutation();
    const store = await readWalletStore();
    const { wallet } = requireWalletAccount(store, request.accountId);
    let key: Uint8Array | null = null;
    let seed: Uint8Array | null = null;
    try {
      if (request.password) {
        key = await deriveWalletKey(request.password);
      } else if (request.useRememberedUnlock) {
        const result = await HomeV2SecureStorage.unwrap({ accountId: wallet.id });
        if (result.value) {
          key = base64ToBytes(result.value);
        } else {
          const securityStore = await readAndroidHomeV2SecurityStore();
          const security = androidHomeV2Security(securityStore, wallet.id);
          security.rememberUnlock = false;
          security.lockOnExit = true;
          securityStore.accounts[wallet.id] = security;
          await writeAndroidHomeV2SecurityStore(securityStore);
        }
      }
      if (!key || key.byteLength !== 64) throw new Error('Enter the account password.');
      seed = decryptWalletWithKey(key, wallet.encryptedWallet);
      forgetUnlockedWalletSeed(wallet.id);
      unlockedWalletSeeds.set(wallet.id, seed);
      seed = null;
      const securityStore = await readAndroidHomeV2SecurityStore();
      const security = androidHomeV2Security(securityStore, wallet.id);
      security.manuallyLocked = false;
      securityStore.accounts[wallet.id] = security;
      if (request.password && security.rememberUnlock) {
        await HomeV2SecureStorage.wrap({ accountId: wallet.id, value: bytesToBase64(key) });
      }
      await writeAndroidHomeV2SecurityStore(securityStore);
      return buildAndroidHomeV2VaultState();
    } finally {
      key?.fill(0);
      seed?.fill(0);
    }
  };
  return {
    async getState() {
      if (!androidHomeV2AutoUnlockAttempted) {
        androidHomeV2AutoUnlockAttempted = true;
        try {
          await HomeV2ProfileRecovery.ensureBackup();
          androidHomeV2RecoveryMessage = null;
        } catch (error) {
          androidHomeV2RecoveryMessage = error instanceof Error
            ? error.message
            : 'Home could not create or verify its profile backup.';
        }
        if (!androidHomeV2RecoveryMessage) {
          try {
          const store = await readWalletStore();
          const selected = store.activeAccountId ? resolveWalletAccount(store.wallets, store.activeAccountId) : null;
          if (selected) {
            const securityStore = await readAndroidHomeV2SecurityStore();
            const security = androidHomeV2Security(securityStore, selected.wallet.id);
            if (security.rememberUnlock && !security.lockOnExit && !security.manuallyLocked) {
              await unlockWithRequest({ accountId: selected.wallet.id, useRememberedUnlock: true });
            }
          }
          } catch {
            // A missing or invalid remembered key falls back to password unlock.
          }
        }
      }
      return buildAndroidHomeV2VaultState();
    },
    async select({ accountId, addressId }) {
      await prepareMutation();
      const store = await readWalletStore();
      if (accountId === null) {
        if (addressId !== null) throw new Error('An address cannot be selected without an account.');
        store.activeAccountId = null;
      } else {
        const account = store.wallets.find((wallet) => wallet.id === accountId);
        if (!account) throw new Error('Selected account is not saved.');
        const selectedAddressId = addressId ?? account.id;
        const selected = requireWalletAccount(store, selectedAddressId);
        if (selected.wallet.id !== account.id) throw new Error('Selected address does not belong to the selected account.');
        store.activeAccountId = selectedAddressId;
      }
      await writeWalletStore(store);
      return buildAndroidHomeV2VaultState();
    },
    selectWalletFile,
    discardLoadedWallet: async (token) => discardLoadedWallet(token),
    async saveLoadedWallet({ label, token }) {
      await prepareMutation();
      await saveLoadedWallet(token, label);
      return buildAndroidHomeV2VaultState();
    },
    async create(request) {
      if (!request.password || request.password !== request.passwordConfirmation) throw new Error('Passwords do not match.');
      await prepareMutation();
      const result = await createWallet(request.label, request.password);
      return { canceled: result.canceled, state: await buildAndroidHomeV2VaultState() };
    },
    getPrivateKeyAddress: getAddressFromPrivateKey,
    async importPrivateKey(request) {
      if (!request.password || request.password !== request.passwordConfirmation) throw new Error('Passwords do not match.');
      await prepareMutation();
      const result = await importPrivateKeyWallet(request.label, request.privateKey, request.password);
      return { canceled: result.canceled, state: await buildAndroidHomeV2VaultState() };
    },
    exportAccount: exportWallet,
    async rename({ accountId, label }) {
      await prepareMutation();
      await renameAccount(accountId, label);
      return buildAndroidHomeV2VaultState();
    },
    async addAddress(accountId) {
      await prepareMutation();
      await addDerivedAddress(accountId);
      return buildAndroidHomeV2VaultState();
    },
    async removeAddress(addressId) {
      await prepareMutation();
      await removeWallet(addressId);
      return buildAndroidHomeV2VaultState();
    },
    async removeAccount({ accountId, password }) {
      await prepareMutation();
      await removeWallet(accountId, password);
      await HomeV2SecureStorage.remove({ accountId }).catch(() => undefined);
      const securityStore = await readAndroidHomeV2SecurityStore();
      delete securityStore.accounts[accountId];
      await writeAndroidHomeV2SecurityStore(securityStore);
      return buildAndroidHomeV2VaultState();
    },
    unlock: unlockWithRequest,
    async lock(accountId) {
      await prepareMutation();
      const store = await readWalletStore();
      const { wallet } = requireWalletAccount(store, accountId);
      forgetUnlockedWalletSeed(wallet.id);
      const securityStore = await readAndroidHomeV2SecurityStore();
      const security = androidHomeV2Security(securityStore, wallet.id);
      security.manuallyLocked = true;
      securityStore.accounts[wallet.id] = security;
      await writeAndroidHomeV2SecurityStore(securityStore);
      return buildAndroidHomeV2VaultState();
    },
    async updateSecurity(request) {
      await prepareMutation();
      const store = await readWalletStore();
      const { wallet } = requireWalletAccount(store, request.accountId);
      const securityStore = await readAndroidHomeV2SecurityStore();
      const security = androidHomeV2Security(securityStore, wallet.id);
      let key: Uint8Array | null = null;
      try {
        if (request.rememberUnlock === true) {
          if (!request.password) throw new Error('Enter the account password to enable remembered unlock.');
          key = await deriveWalletKey(request.password);
          const seed = decryptWalletWithKey(key, wallet.encryptedWallet);
          seed.fill(0);
          await HomeV2SecureStorage.wrap({ accountId: wallet.id, value: bytesToBase64(key) });
          security.rememberUnlock = true;
          security.manuallyLocked = false;
        } else if (request.rememberUnlock === false) {
          await HomeV2SecureStorage.remove({ accountId: wallet.id });
          security.rememberUnlock = false;
          security.lockOnExit = true;
        }
        if (typeof request.lockOnExit === 'boolean') security.lockOnExit = request.lockOnExit;
        securityStore.accounts[wallet.id] = security;
        await writeAndroidHomeV2SecurityStore(securityStore);
        return buildAndroidHomeV2VaultState();
      } finally {
        key?.fill(0);
      }
    },
    async requestRestore() {
      await HomeV2ProfileRecovery.requestRestore();
      return { restartRequired: true };
    },
    async sendChatMessage(request) {
      const signingKey = await getAccountSecretKey(request.accountId);
      // isStillValid is optional on the contract (older callers), but Home's
      // own Android dispatcher (HomeV2LiveApp.tsx) always supplies one; treat
      // a missing predicate as "always valid" rather than throwing, since
      // that only ever loosens an already-optional recheck, never weakens a
      // check that was actually being enforced.
      const isStillValid = request.isStillValid ?? (() => true);
      return request.network === 'qortium'
        ? sendHomeV2QortiumChatMessage(request.nodeApiUrl, request.txGroupId, request.message, signingKey, isStillValid)
        : sendHomeV2QortalChatMessage(request.nodeApiUrl, request.txGroupId, request.message, signingKey, isStillValid);
    },
  };
}

export function installQortiumHomeApiFallback() {
  if (window.qortiumHome) {
    return;
  }

  usingFallbackQortiumHomeApi = true;
  window.qortiumHome = createFallbackApi();
}
