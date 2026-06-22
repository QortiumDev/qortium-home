import { Capacitor, CapacitorHttp, registerPlugin, type HttpResponse } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { AES_CBC, HmacSha512, Sha512, bytes_to_base64 } from 'asmcrypto.js';
import bcrypt from 'bcryptjs';
import { zipSync } from 'fflate';
import nacl from 'tweetnacl';
import packageJson from '../package.json';
import { compareAppVersions } from './appUpdates';
import {
  QDN_APP_BRIDGE_ACTIONS,
  QDN_PUBLIC_NODE_BRIDGE_ACTIONS,
  QDN_CHAT_ACTIONS,
  QDN_GROUP_ACTIONS,
  QDN_NAME_ACTIONS,
  QDN_PAYMENT_ACTIONS,
  QDN_POLL_ACTIONS,
  QDN_PRIVATE_GROUP_CHAT_WRITE_ACTIONS,
  QDN_TRUST_ACTIONS,
  QDN_WRITE_ACTIONS,
} from '../electron/qdn-app-actions';
import { signChatTransaction } from './chatSign';
import type { CoreTransportStatusSnapshot } from './i2p';
import { t } from './i18n';
import { PUBLIC_QDN_SERVICES, isPrivateQdnService, type QdnDisplaySettings } from './qdn';

const NODE_SETTINGS_KEY = 'qortium-home-node-settings';
const NODE_DISCOVERY_CACHE_KEY = 'qortium-home-node-discovery-cache';
const WALLET_STORE_KEY = 'qortium-home-wallet-store';
const UPDATE_DOWNLOADS_DIR = 'app-updates';
const QDN_DOWNLOADS_DIR = 'qdn-downloads';
const DESKTOP_LOCAL_NODE_API_URL = 'http://127.0.0.1:24891';
const ANDROID_EMULATOR_LOCAL_NODE_API_URL = 'http://10.0.2.2:24891';
const PREVIEWNET_API_PORT = '24891';
const PREVIEWNET_P2P_PORT = '24892';
const PREVIEWNET_SEED_NODE_API_URLS = [
  'http://146.103.42.59:24891',
  'http://185.207.104.78:24891',
];
// Public, read-only Qortal nodes for cross-chain QDN reads (no account, no API key, no writes).
// More public nodes can be appended; the first reachable one is used and cached.
const QORTAL_PUBLIC_NODE_API_URLS = [
  'https://ext-node.qortal.link',
];
const QORTAL_NODE_CACHE_TTL_MS = 5 * 60_000;
const PUBLIC_READ_PROBE_PATH =
  '/arbitrary/resources/search?mode=ALL&limit=1&includestatus=false&includemetadata=false';
const REQUEST_TIMEOUT_MS = 30_000;
const DISCOVERY_TIMEOUT_MS = 5_000;
const DISCOVERY_CACHE_TTL_MS = 5 * 60_000;
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
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_ALPHABET_MAP = new Map<string, number>(
  [...BASE58_ALPHABET].map((character, index) => [character, index]),
);
const QDN_APP_DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const QDN_APP_MAX_BYTES_LIMIT = 5 * 1024 * 1024;
const QDN_WRITE_SOURCE_MAX_BYTES = 5 * 1024 * 1024;
// Qortal cross-chain resource fetches (e.g. game ROMs) need a much larger ceiling than QDN text reads.
const QDN_APP_QORTAL_DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const QDN_APP_QORTAL_MAX_BYTES_LIMIT = 64 * 1024 * 1024;
const QDN_WRITE_APPROVAL_TIMEOUT_MS = 120_000;
const QDN_CHAT_MESSAGE_MAX_BYTES = 4000;
// Required leading-zero bits for the CHAT memory-pow. Tracks the chain config
// (Previewnet previewchain.json chatDifficulty); keep in sync with Qortium Core.
const CHAT_POW_DIFFICULTY = 8;
const QDN_OPEN_NEW_TAB_URL_MAX_LENGTH = 2048;
const QDN_MEDIA_PLAYER_SERVICES = new Set(['AUDIO', 'PODCAST', 'VIDEO', 'VOICE']);
const QDN_MEDIA_PLAYER_FIELD_MAX_LENGTH = 1024;

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
  expiresAt: number;
  nodeApiUrl: string;
};

type DiscoveryCandidate = {
  height: number;
  isSeed: boolean;
  isSynchronizing: boolean;
  nodeApiUrl: string;
  peerCount: number;
  status: unknown;
  supportsPublicReads: boolean;
};

type UpdateInstallerPlugin = {
  installApk: (request: { filePath: string }) => Promise<{ opened?: boolean }>;
};

type QdnFileSaverPlugin = {
  saveFile: (
    request: { path: string; fileName: string; mimeType?: string },
  ) => Promise<{ canceled: true } | { canceled: false; uri: string; name: string; size: number }>;
  openSavedFile: (request: { uri: string; mimeType?: string }) => Promise<{ opened: boolean }>;
};

type WalletBackupPlugin = {
  saveWallet: (request: { content: string; fileName: string }) => Promise<QortiumWalletBackupResult>;
};

type QdnPublishSourcePlugin = {
  selectFile: (request: { maxBytes: number }) => Promise<QdnPublishSourceResult>;
};

type NativeHttpBlobUrlRequest = {
  contentType?: string;
  readTimeoutMs?: number;
  url: string;
};

type QdnAppRequest = {
  action?: unknown;
  maxBytes?: unknown;
  method?: unknown;
  path?: unknown;
  payload?: unknown;
  [key: string]: unknown;
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
  onOpenMediaPlayer?: (request: QortiumQdnMediaPlayerRequest) => void;
  onOpenNewTab?: (address: string) => void;
  onOpenInCurrentTab?: (address: string) => void;
  resourceUrl: string;
  sessionKey: string;
};

type QdnWriteAction = (typeof QDN_WRITE_ACTIONS)[number];
type QdnGroupAction = (typeof QDN_GROUP_ACTIONS)[number];
type QdnNameAction = (typeof QDN_NAME_ACTIONS)[number];
type QdnPaymentAction = (typeof QDN_PAYMENT_ACTIONS)[number];
type QdnPollAction = (typeof QDN_POLL_ACTIONS)[number];
type QdnTrustAction = (typeof QDN_TRUST_ACTIONS)[number];
type QdnChatAction = (typeof QDN_CHAT_ACTIONS)[number];
type QdnPrivateGroupChatWriteAction = (typeof QDN_PRIVATE_GROUP_CHAT_WRITE_ACTIONS)[number];
type QdnWriteApprovalAction =
  | QdnWriteAction
  | QdnGroupAction
  | QdnNameAction
  | QdnPaymentAction
  | QdnPollAction
  | QdnTrustAction
  | QdnChatAction
  | QdnPrivateGroupChatWriteAction
  | 'START_MINTING'
  | 'REMOVE_MINTING_ACCOUNT';
type QdnChatPermissionAction = 'SEND_CHAT_MESSAGE';

type QdnWriteResourceRequest = {
  category?: string;
  description?: string;
  fee?: number;
  identifier?: string;
  name: string;
  service: string;
  tags: string[];
  title?: string;
};

type QdnPublishSourceResult =
  | {
      canceled: true;
    }
  | {
      canceled: false;
      dataBase64: string;
      fileName: string;
      kind?: 'data' | 'file';
      mimeType?: string;
      size: number;
      uri?: string;
    };

type QdnWriteContext = {
  accountId: string;
  apiKey: string;
  nodeApiUrl: string;
  profile: QortiumAccountProfile;
  privateKey58: string;
  publicKey58: string;
};

type QdnWriteApprovalDetails = {
  action: QdnWriteApprovalAction;
  amount?: number | string;
  approval?: boolean;
  chatMessagePreview?: string;
  groupId?: number;
  groupName?: string | null;
  mintingKey?: string | null;
  name?: string;
  permissionScope?: 'single-request' | 'session';
  recipientAddress?: string;
  resource?: QdnWriteResourceRequest;
  resourceCount?: number;
  source?: QdnPublishSourceResult;
};

type PendingQdnApproval = {
  resolve: (approved: boolean) => void;
  timeoutId: number;
};

const UpdateInstaller = registerPlugin<UpdateInstallerPlugin>('UpdateInstaller');
const QdnFileSaver = registerPlugin<QdnFileSaverPlugin>('QdnFileSaver');
const WalletBackup = registerPlugin<WalletBackupPlugin>('WalletBackup');
const QdnPublishSource = registerPlugin<QdnPublishSourcePlugin>('QdnPublishSource');
const unlockedWalletSeeds = new Map<string, Uint8Array>();
const pendingLoadedWallets = new Map<string, PendingLoadedWallet>();
const qdnUnlockListeners = new Set<(request: QortiumQdnUnlockRequest) => void>();
const qdnWriteListeners = new Set<(request: QortiumQdnWriteApprovalRequest) => void>();
const pendingQdnUnlockApprovals = new Map<string, PendingQdnApproval>();
const pendingQdnWriteApprovals = new Map<string, PendingQdnApproval>();
const approvedQdnChatPermissions = new Set<string>();

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

export function isNativePlatform() {
  return Capacitor.isNativePlatform();
}

export function isMacOs() {
  if (isAndroid()) {
    return false;
  }

  return window.navigator.userAgent.toLowerCase().includes('mac os');
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
  const blob = new Blob([bytes], {
    type: contentType || getContentType(response) || 'application/octet-stream',
  });

  return URL.createObjectURL(blob);
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

async function downloadUpdateAsset(request: QortiumAppUpdateDownloadRequest) {
  if (!isNativePlatform()) {
    throw new Error('Update downloads are available in the desktop app and Android app.');
  }

  const normalizedRequest = normalizeUpdateDownloadRequest(request);

  assertFallbackUpdateIsNewer(normalizedRequest.releaseTag);

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

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getInteger(value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }

  const stringValue = getString(value);

  if (/^-?\d+$/.test(stringValue)) {
    const parsedValue = Number(stringValue);

    return Number.isSafeInteger(parsedValue) ? parsedValue : undefined;
  }

  return undefined;
}

function getBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getLocalNodeApiUrl() {
  return isAndroid() ? ANDROID_EMULATOR_LOCAL_NODE_API_URL : DESKTOP_LOCAL_NODE_API_URL;
}

function normalizeNodeApiUrl(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    throw new Error('Node URL is required.');
  }

  const candidate = /^https?:\/\//i.test(trimmedValue) ? trimmedValue : `http://${trimmedValue}`;
  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    throw new Error('Enter a valid node URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Node URL must use HTTP or HTTPS.');
  }

  if (url.username || url.password) {
    throw new Error('Node URL cannot include a username or password.');
  }

  if (!url.hostname) {
    throw new Error('Node URL must include a host.');
  }

  return url.origin;
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
    throw new Error('Choose the local node, Previewnet network, or a custom node.');
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
    return PREVIEWNET_SEED_NODE_API_URLS[0];
  }

  return getLocalNodeApiUrl();
}

async function resolveNodeApiUrl(settings: StoredNodeSettings, forceDiscoveryRefresh = false) {
  if (settings.mode === 'custom' && settings.customUrl) {
    return settings.customUrl;
  }

  if (settings.mode === 'network') {
    return (await discoverPreviewnetNode(forceDiscoveryRefresh)).nodeApiUrl;
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
    networkSeedUrls: PREVIEWNET_SEED_NODE_API_URLS,
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

async function readNodeSettings() {
  try {
    const rawSettings = await getStoredValue(NODE_SETTINGS_KEY);

    return rawSettings ? parseStoredNodeSettings(JSON.parse(rawSettings) as unknown) : getDefaultNodeSettings();
  } catch {
    return getDefaultNodeSettings();
  }
}

async function writeNodeSettings(settings: StoredNodeSettings) {
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
    activeAccountId: activeAccount ? store.activeAccountId : store.wallets[0]?.id ?? null,
  };
}

function parseWalletStore(value: unknown): WalletStore {
  if (!isRecord(value) || !Array.isArray(value.wallets)) {
    return createEmptyWalletStore();
  }

  return normalizeWalletStore({
    version: WALLET_STORE_VERSION,
    wallets: value.wallets.filter(isStoredWallet).map((wallet) => ({
      ...wallet,
      derivedAddresses: sanitizeDerivedAddresses((wallet as Record<string, unknown>).derivedAddresses),
    })),
    activeAccountId: typeof value.activeAccountId === 'string' ? value.activeAccountId : null,
  });
}

async function readWalletStore() {
  try {
    const rawStore = await getStoredValue(WALLET_STORE_KEY);

    return rawStore ? parseWalletStore(JSON.parse(rawStore) as unknown) : createEmptyWalletStore();
  } catch {
    return createEmptyWalletStore();
  }
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

function base58Encode(buffer: Uint8Array) {
  if (buffer.length === 0) {
    return '';
  }

  const digits = [0];

  for (const byte of buffer) {
    for (let index = 0; index < digits.length; index += 1) {
      digits[index] <<= 8;
    }

    digits[0] += byte;

    let carry = 0;

    for (let index = 0; index < digits.length; index += 1) {
      digits[index] += carry;
      carry = (digits[index] / 58) | 0;
      digits[index] %= 58;
    }

    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  for (let index = 0; buffer[index] === 0 && index < buffer.length - 1; index += 1) {
    digits.push(0);
  }

  return digits
    .reverse()
    .map((digit) => BASE58_ALPHABET[digit])
    .join('');
}

function base58Decode(value: string) {
  if (value.length === 0) {
    return new Uint8Array(0);
  }

  const bytes = [0];

  for (const character of value) {
    const mappedValue = BASE58_ALPHABET_MAP.get(character);

    if (mappedValue === undefined) {
      throw new Error(`Base58 value contains an invalid character: ${character}`);
    }

    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] *= 58;
    }

    bytes[0] += mappedValue;

    let carry = 0;

    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] += carry;
      carry = bytes[index] >> 8;
      bytes[index] &= 0xff;
    }

    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (let index = 0; value[index] === '1' && index < value.length - 1; index += 1) {
    bytes.push(0);
  }

  return new Uint8Array(bytes.reverse());
}

function getSignedTransactionSignature(signedTransactionBytes58: string) {
  const signedTransactionBytes = base58Decode(signedTransactionBytes58);

  if (signedTransactionBytes.length < 64) {
    throw new Error('Signed transaction did not contain a signature.');
  }

  return base58Encode(signedTransactionBytes.slice(-64));
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
  const keyPair = nacl.sign.keyPair.fromSeed(privateKey);

  return publicKeyToAddress(keyPair.publicKey);
}

async function decryptWalletSeed(password: string, wallet: EncryptedWallet) {
  if (!password) {
    throw new Error('Enter the wallet password.');
  }

  try {
    const encryptedSeed = base58Decode(wallet.encryptedSeed);
    const iv = base58Decode(wallet.iv);

    base58Decode(wallet.salt);

    const key = await deriveWalletKey(password);
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

  const encryptedWallet = assertEncryptedWallet(parsedWallet);
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
  await writeWalletStore(store);

  return {
    canceled: false,
    ...toAccountsState(store),
  };
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

// Home's own UI resolves account avatars itself now (see src/accountAvatar.ts), but
// QDN apps still receive the selected account's avatar URL through the account bridge.
async function getAccountAvatarUrl(name: string | null) {
  if (!name) {
    return null;
  }

  let nodeApiUrl = '';

  try {
    nodeApiUrl = await resolveNodeApiUrl(await readNodeSettings());
  } catch {
    return null;
  }

  return nodeApiUrl
    ? `${nodeApiUrl}/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/avatar?async=true`
    : null;
}

function isAccountUnlocked(accountId: string) {
  return unlockedWalletSeeds.has(getWalletIdForAccountId(accountId));
}

const MAX_RESOLVE_IDENTITIES = 500;

// Batch-resolves display identities (registered name + avatar URL) for arbitrary
// addresses so a QDN app that shows many accounts makes one bridge call instead
// of several node round-trips per address. Read-only — works on public nodes.
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

      const avatarSrc =
        name && nodeApiUrl
          ? `${nodeApiUrl}/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/avatar?async=true`
          : null;

      return { address, name, avatarSrc };
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

  return {
    address: profile.address,
    avatarUrl: await getAccountAvatarUrl(profile.name),
    isUnlocked: isAccountUnlocked(context.accountId),
    name: profile.name,
  };
}

async function unlockSelectedAccountForQdnApp(context: QdnAppRequestContext | undefined) {
  if (!context) {
    throw new Error('UNLOCK_SELECTED_ACCOUNT is only available from a QDN app frame.');
  }

  if (!context.accountId) {
    throw new Error('No account is selected for this tab.');
  }

  if (!isAccountUnlocked(context.accountId)) {
    if (qdnUnlockListeners.size === 0) {
      throw new Error('QDN account unlock is unavailable.');
    }

    const profile = await getAccountProfile(context.accountId);
    const requestId = createRequestId();

    await new Promise<boolean>((resolve) => {
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
  }

  return getSelectedAccountForQdnApp(context);
}

function getRequestTags(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(getString).filter(Boolean);
  }

  const tag = getString(value);

  return tag ? [tag] : [];
}

function getQdnWriteTags(request: QdnAppRequest) {
  const tags = getRequestTags(getRequestValue(request, 'tags'));

  for (let index = 1; index <= 5; index += 1) {
    const tag = getString(getRequestValue(request, `tag${index}`));

    if (tag) {
      tags.push(tag);
    }
  }

  return [...new Set(tags)].slice(0, 5);
}

function getRequestFee(value: unknown) {
  const fee = getNumber(value);

  if (typeof fee === 'undefined') {
    return undefined;
  }

  if (!Number.isSafeInteger(fee) || fee < 0) {
    throw new Error('QDN write fee must be a non-negative integer.');
  }

  return fee;
}

function getTransactionFee(request: QdnAppRequest) {
  return getRequestFee(getRequestValue(request, 'fee')) ?? 0;
}

function getTransactionGroupId(request: QdnAppRequest, fallback = 0) {
  const txGroupId = getInteger(getRequestValue(request, 'txGroupId') ?? getRequestValue(request, 'feeGroupId'));

  if (typeof txGroupId === 'undefined') {
    return fallback;
  }

  if (txGroupId < 0) {
    throw new Error('Transaction group id must be a non-negative integer.');
  }

  return txGroupId;
}

function getRequiredAmountValue(request: QdnAppRequest, key: string, label: string) {
  const value = getRequestValue(request, key);

  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }

  const stringValue = getString(value);

  if (/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(stringValue)) {
    return stringValue;
  }

  throw new Error(`${label} must be a non-negative amount with up to 8 decimal places.`);
}

function getOptionalBooleanRequestValue(request: QdnAppRequest, ...keys: string[]) {
  for (const key of keys) {
    const value = getBoolean(getRequestValue(request, key));

    if (typeof value === 'boolean') {
      return value;
    }
  }

  return undefined;
}

function getOptionalIntegerRequestValue(request: QdnAppRequest, minimumValue: number, ...keys: string[]) {
  for (const key of keys) {
    const value = getInteger(getRequestValue(request, key));

    if (typeof value === 'undefined') {
      continue;
    }

    if (value < minimumValue) {
      throw new Error(`${key} must be at least ${minimumValue}.`);
    }

    return value;
  }

  return undefined;
}

function getOptionalStringRequestValue(request: QdnAppRequest, ...keys: string[]) {
  for (const key of keys) {
    const value = getString(getRequestValue(request, key));

    if (value) {
      return value;
    }
  }

  return '';
}

function getRequiredNameRequestString(request: QdnAppRequest) {
  return getRequiredRequestString(request, 'name', 'Name');
}

function getInlinePublishData(request: QdnAppRequest) {
  return getString(getRequestValue(request, 'data64')) || getString(getRequestValue(request, 'base64'));
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

  return {
    canceled: false,
    dataBase64,
    fileName: sanitizeFilename(getString(getRequestValue(request, 'filename')), 'qdn-resource'),
    kind: 'data',
    size,
  };
}

function getQdnWriteResourceRequest(request: QdnAppRequest): QdnWriteResourceRequest {
  const service = getService(getRequestValue(request, 'service'));
  const name = getString(getRequestValue(request, 'name'));
  const identifier = getString(getRequestValue(request, 'identifier'));
  const title = getString(getRequestValue(request, 'title'));
  const description = getString(getRequestValue(request, 'description'));
  const category = getString(getRequestValue(request, 'category')).toUpperCase();

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
    title: title || undefined,
    description: description || undefined,
    tags: getQdnWriteTags(request),
    category: category || undefined,
    fee: getRequestFee(getRequestValue(request, 'fee')),
  };
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

function buildQdnDeletePath(resource: QdnWriteResourceRequest) {
  const identifierPath = resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : '';
  const queryParams = new URLSearchParams();

  appendQueryValue(queryParams, 'fee', resource.fee);

  const queryString = queryParams.toString();

  return `/arbitrary/resource/${resource.service}/${encodeURIComponent(resource.name)}${identifierPath}/delete${
    queryString ? `?${queryString}` : ''
  }`;
}

function getNodeApiKey(settings: StoredNodeSettings) {
  if (!settings.apiKey) {
    throw new Error('Qortium node API key was not found.');
  }

  return settings.apiKey;
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
    throw new Error(getNetworkRestrictionMessage());
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
  const apiKey = settings.apiKey;
  const profile = await getAccountProfile(context.accountId);
  const signingKey = await getAccountSecretKey(context.accountId);

  return {
    accountId: context.accountId,
    apiKey,
    nodeApiUrl,
    profile,
    publicKey58: signingKey.publicKey58,
    secretKey: signingKey.secretKey,
  };
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
    mimeType: getString(value.mimeType) || undefined,
    size,
    uri: getString(value.uri) || undefined,
  };
}

async function selectQdnPublishSource() {
  const result = await QdnPublishSource.selectFile({
    maxBytes: QDN_WRITE_SOURCE_MAX_BYTES,
  });

  return normalizeQdnPublishSourceResult(result);
}

async function requestQdnWriteApproval(
  context: QdnAppRequestContext,
  profile: QortiumAccountProfile,
  details: QdnWriteApprovalDetails,
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
        accountName: profile.name,
        action: details.action,
        address: profile.address,
        amount: typeof details.amount === 'undefined' ? null : String(details.amount),
        approval: typeof details.approval === 'boolean' ? details.approval : null,
        chatMessagePreview: details.chatMessagePreview ?? null,
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
    throw new Error('QDN write request was denied.');
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

async function postLocalNodeText(
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

  if (response.status < 200 || response.status >= 300) {
    throw new Error(responseBody || fallbackMessage);
  }

  return {
    body: responseBody,
    contentType: getContentType(response),
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
    throw new Error(responseBody || fallbackMessage);
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

async function fetchLocalNodeApiPayload(nodeApiUrl: string, apiPath: string, fallbackMessage: string) {
  const response = await requestNode(nodeApiUrl, apiPath, 'text');
  const body = stringifyResponseData(response.data);

  if (response.status < 200 || response.status >= 300) {
    throw new Error(body || fallbackMessage);
  }

  return parseResponseData(body, getContentType(response));
}

async function getGroupDataForChat(nodeApiUrl: string, groupId: number) {
  if (groupId === 0) {
    return null;
  }

  return fetchLocalNodeApiPayload(
    nodeApiUrl,
    `/groups/${encodeURIComponent(String(groupId))}`,
    'Group lookup failed.',
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

async function publishQdnResourceForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const resource = getQdnWriteResourceRequest(request);
  const writeContext = await getQdnWriteContext(context);
  const source = getInlinePublishSource(request) ?? (await selectQdnPublishSource());

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

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
    buildQdnPublishBase64Path(resource, source),
    source.dataBase64,
    writeContext.apiKey,
    'QDN publish transaction build failed.',
  );
  const processedTransaction = await signAndProcessTransaction(writeContext, unsignedTransaction.body);

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

  if (resources.some((entry) => !entry.source || entry.source.canceled)) {
    throw new Error('PUBLISH_MULTIPLE_QDN_RESOURCES requires base64 data for each resource.');
  }

  const approvalResource = resources.length === 1 ? resources[0].resource : undefined;
  const writeContext = await getQdnWriteContext(context);

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

  for (const entry of resources) {
    const source = entry.source as QdnPublishSourceResult & { canceled: false };

    try {
      const unsignedTransaction = await postLocalNodeText(
        writeContext.nodeApiUrl,
        buildQdnPublishBase64Path(entry.resource, source),
        source.dataBase64,
        writeContext.apiKey,
        'QDN publish transaction build failed.',
      );
      const processedTransaction = await signAndProcessTransaction(writeContext, unsignedTransaction.body);

      published.push({
        result: processedTransaction.data,
        resource: {
          identifier: entry.resource.identifier ?? null,
          name: entry.resource.name,
          service: entry.resource.service,
        },
        transactionSignature: processedTransaction.signature,
      });
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

  return {
    accepted: true,
    action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
    failures,
    published,
  };
}

async function deleteQdnResourceForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const resource = getQdnWriteResourceRequest(request);
  const writeContext = await getQdnWriteContext(context);

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
    buildQdnDeletePath(resource),
    '',
    writeContext.apiKey,
    'QDN delete transaction build failed.',
  );
  const processedTransaction = await signAndProcessTransaction(writeContext, unsignedTransaction.body);

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
      type: 'JOIN_GROUP',
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
        type: 'REWARD_SHARE',
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
      type: 'GROUP_INVITE',
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
      type: 'GROUP_APPROVAL',
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
      type: 'GROUP_INVITE',
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
      type: 'LEAVE_GROUP',
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
      type: 'UPDATE_GROUP',
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

function getPollOptionsInput(request: QdnAppRequest, ...keys: string[]) {
  let raw: unknown;

  for (const key of keys) {
    const value = getRequestValue(request, key);

    if (typeof value !== 'undefined' && value !== null) {
      raw = value;
      break;
    }
  }

  const names: string[] = [];

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const name = isRecord(entry)
        ? getString(entry.optionName) || getString(entry.name) || getString(entry.value)
        : getString(entry);

      if (name) {
        names.push(name);
      }
    }
  } else {
    const text = getString(raw);

    if (text) {
      for (const part of text.split(',')) {
        const name = part.trim();

        if (name) {
          names.push(name);
        }
      }
    }
  }

  if (names.length < 2) {
    throw new Error('A poll requires at least two options.');
  }

  if (new Set(names).size !== names.length) {
    throw new Error('Poll options must be unique.');
  }

  return names.map((optionName) => ({ optionName }));
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
      type: 'CREATE_GROUP',
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
      type: 'ADD_GROUP_ADMIN',
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
      type: 'REMOVE_GROUP_ADMIN',
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
      type: 'GROUP_BAN',
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
      type: 'CANCEL_GROUP_BAN',
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
      type: 'GROUP_KICK',
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
      type: 'CANCEL_GROUP_INVITE',
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
      type: 'SET_GROUP',
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

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action,
    amount,
    recipientAddress: recipient,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/payments/pay',
    JSON.stringify({
      type: 'PAYMENT',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      senderPublicKey: writeContext.publicKey58,
      recipient,
      amount,
    }),
    writeContext.apiKey,
    'Payment transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action,
    recipient,
    amount,
    result: processedTransaction.data,
    transactionSignature: processedTransaction.signature,
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
  const writeContext = await getQdnWriteContext(context);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'TRANSFER_ASSET',
    amount,
    name: `Asset #${assetId}`,
    recipientAddress: recipient,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/assets/transfer',
    JSON.stringify({
      type: 'TRANSFER_ASSET',
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
  const pollOptions = getPollOptionsInput(request, 'pollOptions', 'options');
  const ownerInput = getOptionalAddressRequestString(request, 'Owner address', 'owner');
  const endTime = getOptionalIntegerRequestValue(request, 0, 'endTime', 'pollEndTime');
  const writeContext = await getQdnWriteContext(context);
  const resolvedOwner = ownerInput || writeContext.profile.address;

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'CREATE_POLL',
    name: pollName,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/polls/create',
    JSON.stringify({
      type: 'CREATE_POLL',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      pollCreatorPublicKey: writeContext.publicKey58,
      owner: resolvedOwner,
      pollName,
      description,
      pollOptions,
      ...(typeof endTime === 'number' ? { endTime } : {}),
    }),
    writeContext.apiKey,
    'Create poll transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

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
  const optionIndex = getRequiredIntegerRequestValue(request, 0, 'Option index', 'optionIndex', 'option');
  const writeContext = await getQdnWriteContext(context);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'VOTE_ON_POLL',
    name: `Poll #${pollId} · option ${optionIndex}`,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/polls/vote',
    JSON.stringify({
      type: 'VOTE_ON_POLL',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      voterPublicKey: writeContext.publicKey58,
      pollId,
      optionIndex,
    }),
    writeContext.apiKey,
    'Vote on poll transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

  return {
    accepted: true,
    action: 'VOTE_ON_POLL',
    pollId,
    optionIndex,
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
      type: 'RATE_ACCOUNT',
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

async function updatePollForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const pollId = getRequiredIntegerRequestValue(request, 0, 'Poll id', 'pollId', 'poll');
  const newPollName = getRequiredRequestString(request, 'newPollName', 'New poll name');
  const newDescription = getString(getRequestValue(request, 'newDescription') ?? getRequestValue(request, 'description'));
  const newPollOptions = getPollOptionsInput(request, 'newPollOptions', 'pollOptions', 'options');
  const newEndTime = getOptionalIntegerRequestValue(request, 0, 'newEndTime', 'endTime');
  const writeContext = await getQdnWriteContext(context);

  await requestQdnWriteApproval(context as QdnAppRequestContext, writeContext.profile, {
    action: 'UPDATE_POLL',
    name: newPollName,
    permissionScope: 'single-request',
  });

  const unsignedTransaction = await postLocalNodeText(
    writeContext.nodeApiUrl,
    '/polls/update',
    JSON.stringify({
      type: 'UPDATE_POLL',
      timestamp: Date.now(),
      txGroupId: getTransactionGroupId(request),
      fee: getTransactionFee(request),
      ownerPublicKey: writeContext.publicKey58,
      pollId,
      newPollName,
      newDescription,
      newPollOptions,
      ...(typeof newEndTime === 'number' ? { newEndTime } : {}),
    }),
    writeContext.apiKey,
    'Update poll transaction build failed.',
    'application/json',
  );
  const processedTransaction = await processQdnAccountTransaction(writeContext, unsignedTransaction);

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
      type: 'REGISTER_NAME',
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
      type: 'UPDATE_NAME',
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
      type: 'SELL_NAME',
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
      type: 'CANCEL_SELL_NAME',
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
      type: 'BUY_NAME',
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
function computeChatNonce(data: Uint8Array, difficulty: number): Promise<number> {
  const worker = getMemoryPowWorker();
  const id = createRequestId();

  return new Promise<number>((resolve, reject) => {
    const onMessage = (event: MessageEvent<MemoryPowWorkerResponse>) => {
      if (event.data.id !== id) {
        return;
      }

      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);

      if ('error' in event.data) {
        reject(new Error(event.data.error));
        return;
      }

      resolve(event.data.nonce);
    };

    const onError = (event: ErrorEvent) => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      reject(new Error(event.message || 'Memory-pow computation failed.'));
    };

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
) {
  const unsignedTransaction = await postLocalNodeText(
    keylessContext.nodeApiUrl,
    '/chat/public/build',
    JSON.stringify({
      senderPublicKey: keylessContext.publicKey58,
      data: encodeChatTextData(message),
      isText: true,
      isEncrypted: false,
      txGroupId: groupId,
      timestamp: Date.now(),
      fee: 0,
    }),
    keylessContext.apiKey,
    'Chat transaction build failed.',
    'application/json',
  );

  const unsignedBytes = base58Decode(unsignedTransaction.body);
  // The build endpoint returns nonce-free bytes (nonce field already zeroed), so
  // we hash the bytes as-is to seed the memory-pow.
  const nonce = await computeChatNonce(unsignedBytes, CHAT_POW_DIFFICULTY);
  const signedBytes = signChatTransaction(unsignedBytes, nonce, keylessContext.secretKey);

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
      type: 'CHAT',
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

  const result = await sendKeylessPublicGroupChatMessage(keylessContext, groupId, message);

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
  const networkResult = await trySendChatMessageOnNetworkNode(context, target, message);

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
    addDerivedAddress,
    unlockWallet,
    lockWallet,
    removeWallet,
  };
}

function parseDiscoveryCache(value: unknown): DiscoveryCache | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const cache = value as Partial<DiscoveryCache>;

  if (typeof cache.nodeApiUrl !== 'string' || typeof cache.expiresAt !== 'number') {
    return null;
  }

  try {
    return {
      nodeApiUrl: normalizeNodeApiUrl(cache.nodeApiUrl),
      expiresAt: cache.expiresAt,
    };
  } catch {
    return null;
  }
}

async function readDiscoveryCache() {
  try {
    const rawCache = await getStoredValue(NODE_DISCOVERY_CACHE_KEY);

    if (!rawCache) {
      return null;
    }

    const cache = parseDiscoveryCache(JSON.parse(rawCache) as unknown);

    return cache && cache.expiresAt > Date.now() ? cache : null;
  } catch {
    return null;
  }
}

async function writeDiscoveryCache(nodeApiUrl: string) {
  await setStoredValue(
    NODE_DISCOVERY_CACHE_KEY,
    JSON.stringify({
      nodeApiUrl,
      expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
    }),
  );
}

function normalizeCandidateNodeApiUrl(value: string) {
  const normalizedUrl = new URL(normalizeNodeApiUrl(value));

  normalizedUrl.port = PREVIEWNET_API_PORT;

  return normalizedUrl.origin;
}

function isPreviewnetSeedNodeApiUrl(nodeApiUrl: string) {
  try {
    const normalizedNodeApiUrl = normalizeCandidateNodeApiUrl(nodeApiUrl);

    return PREVIEWNET_SEED_NODE_API_URLS.map(normalizeCandidateNodeApiUrl).includes(
      normalizedNodeApiUrl,
    );
  } catch {
    return false;
  }
}

function peerAddressToNodeApiUrl(value: unknown) {
  const address = getString(value);

  if (!address) {
    return null;
  }

  try {
    const candidate = /^https?:\/\//i.test(address) ? address : `http://${address}`;
    const url = new URL(candidate);

    if (!url.hostname) {
      return null;
    }

    url.protocol = 'http:';
    url.username = '';
    url.password = '';
    url.port = PREVIEWNET_API_PORT;
    url.pathname = '';
    url.search = '';
    url.hash = '';

    return url.origin;
  } catch {
    return null;
  }
}

function getKnownPeerAddress(value: unknown) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const peer = value as { address?: unknown };

  return getString(peer.address);
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

async function fetchKnownPeerNodeApiUrls(seedNodeApiUrl: string) {
  try {
    const response = await requestNode(seedNodeApiUrl, '/peers/known', 'json', DISCOVERY_TIMEOUT_MS);

    if (response.status < 200 || response.status >= 300 || !Array.isArray(response.data)) {
      return [];
    }

    return response.data
      .map(getKnownPeerAddress)
      .map(peerAddressToNodeApiUrl)
      .filter((nodeApiUrl): nodeApiUrl is string => !!nodeApiUrl);
  } catch {
    return [];
  }
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
  try {
    const response = await requestNode(nodeApiUrl, '/admin/status', 'json', DISCOVERY_TIMEOUT_MS);

    if (response.status < 200 || response.status >= 300) {
      return null;
    }

    return {
      nodeApiUrl,
      status: response.data,
      height: getStatusHeight(response.data),
      isSeed: isPreviewnetSeedNodeApiUrl(nodeApiUrl),
      isSynchronizing: getStatusIsSynchronizing(response.data),
      peerCount: getStatusPeerCount(response.data),
      supportsPublicReads: await probePublicReadAccess(nodeApiUrl),
    };
  } catch {
    return null;
  }
}

function rankDiscoveryCandidates(candidates: DiscoveryCandidate[]) {
  return [...candidates].sort((first, second) => {
    if (first.supportsPublicReads !== second.supportsPublicReads) {
      return first.supportsPublicReads ? -1 : 1;
    }

    if (first.isSeed !== second.isSeed) {
      return first.isSeed ? 1 : -1;
    }

    if (first.isSynchronizing !== second.isSynchronizing) {
      return first.isSynchronizing ? 1 : -1;
    }

    if (first.height !== second.height) {
      return second.height - first.height;
    }

    return second.peerCount - first.peerCount;
  });
}

async function discoverPreviewnetNode(forceRefresh = false): Promise<DiscoveryCandidate> {
  if (!forceRefresh) {
    const cache = await readDiscoveryCache();

    if (cache) {
      const cachedCandidate = await probeNodeCandidate(cache.nodeApiUrl);

      if (cachedCandidate?.supportsPublicReads) {
        return cachedCandidate;
      }
    }
  }

  const candidateUrls = new Set(PREVIEWNET_SEED_NODE_API_URLS.map(normalizeCandidateNodeApiUrl));
  const knownPeerResults = await Promise.all(
    PREVIEWNET_SEED_NODE_API_URLS.map(fetchKnownPeerNodeApiUrls),
  );

  for (const peerNodeApiUrls of knownPeerResults) {
    for (const peerNodeApiUrl of peerNodeApiUrls) {
      candidateUrls.add(peerNodeApiUrl);
    }
  }

  const candidates = (
    await Promise.all([...candidateUrls].map((nodeApiUrl) => probeNodeCandidate(nodeApiUrl)))
  ).filter((candidate): candidate is DiscoveryCandidate => !!candidate);
  const selectedCandidate = rankDiscoveryCandidates(candidates)[0];

  if (!selectedCandidate) {
    throw new Error('No reachable Previewnet node was found.');
  }

  await writeDiscoveryCache(selectedCandidate.nodeApiUrl);

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
  return 'The selected Previewnet network node is public read-only and does not expose that endpoint. Use a local Core or trusted custom node for write, admin, or private API workflows.';
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
) {
  try {
    return await CapacitorHttp.request({
      url: `${getNodeApiUrlBase(nodeApiUrl)}${pathname}`,
      method,
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
    throw new Error(getNetworkRestrictionMessage());
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
    throw new Error(
      responseBody ||
        (method === 'POST'
          ? 'Core on-chain update install request failed.'
          : 'Core on-chain update check failed.'),
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

    throw new Error(responseBody || fallbackMessage);
  }

  return responseBody;
}

async function getProtectedNodeRequestContext() {
  const settings = await readNodeSettings();

  if (settings.mode === 'network') {
    throw new Error(getNetworkRestrictionMessage());
  }

  return {
    apiKey: getNodeApiKey(settings),
    nodeApiUrl: await resolveNodeApiUrl(settings),
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

  try {
    return {
      nodeApiUrl,
      response: await requestNode(nodeApiUrl, pathname, responseType, REQUEST_TIMEOUT_MS, method),
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
      response: await requestNode(retryNodeApiUrl, pathname, responseType, REQUEST_TIMEOUT_MS, method),
    };
  }
}

function getNodeApiPath(value: unknown, nodeApiUrl: string) {
  const apiPath = getString(value);

  if (!apiPath.startsWith('/') || apiPath.startsWith('//')) {
    throw new Error('Node API paths must start with /.');
  }

  if (/[\x00-\x1F]/.test(apiPath)) {
    throw new Error('Node API path contains invalid control characters.');
  }

  const url = new URL(apiPath, nodeApiUrl);

  return `${url.pathname}${url.search}`;
}

function getRequestPayload(request: QdnAppRequest) {
  return isRecord(request.payload) ? request.payload : request;
}

function getRequestValue(request: QdnAppRequest, key: string) {
  const payload = getRequestPayload(request);

  return payload[key] ?? request[key];
}

function getRequiredRequestString(request: QdnAppRequest, key: string, label: string) {
  const value = getString(getRequestValue(request, key));

  if (!value) {
    throw new Error(`${label} is required.`);
  }

  return value;
}

function getRequiredGroupId(request: QdnAppRequest, minimumValue = 0) {
  const groupId = getInteger(getRequestValue(request, 'groupId') ?? getRequestValue(request, 'txGroupId'));

  if (typeof groupId !== 'number' || groupId < minimumValue) {
    throw new Error(
      minimumValue > 0
        ? 'Group id must be a positive integer.'
        : 'Group id must be a non-negative integer.',
    );
  }

  return groupId;
}

function getOptionalBase58RequestString(request: QdnAppRequest, key: string) {
  const value = getString(getRequestValue(request, key));

  return value || undefined;
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

function getRequiredAddressRequestString(request: QdnAppRequest, key: string, label: string) {
  const address = getRequiredRequestString(request, key, label);

  return assertQortiumAddress(address, label);
}

function assertQortiumAddress(address: string, label: string) {
  if (!/^Q[1-9A-HJ-NP-Za-km-z]{20,}$/.test(address)) {
    throw new Error(`${label} must be a Qortium address.`);
  }

  return address;
}

function getOptionalAddressRequestString(request: QdnAppRequest, label: string, ...keys: string[]) {
  const address = getOptionalStringRequestValue(request, ...keys);

  return address ? assertQortiumAddress(address, label) : '';
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

function hasRequestValue(request: QdnAppRequest, key: string) {
  const value = getRequestValue(request, key);

  return typeof value !== 'undefined' && value !== null;
}

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

function getQdnAppMaxBytes(value: unknown) {
  const maxBytes = Math.floor(getNumber(value) ?? QDN_APP_DEFAULT_MAX_BYTES);

  return Math.max(0, Math.min(maxBytes, QDN_APP_MAX_BYTES_LIMIT));
}

function getReadOnlyMethod(value: unknown) {
  const method = getString(value).toUpperCase() || 'GET';

  if (method !== 'GET' && method !== 'HEAD') {
    throw new Error('QDN app node API requests only support GET and HEAD right now.');
  }

  return method;
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
  const body =
    response.status === 403 && settings.mode === 'network'
      ? getNetworkRestrictionMessage()
      : rawBody;
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
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: getStatusText(response.status),
  };
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
    throw new Error(result.body || `Qortium node request failed with HTTP ${result.status}.`);
  }

  // Opt-in: return the status + response headers alongside the body, so apps can
  // read headers such as X-Total-Count (used by the paginated trust-derivation
  // listing). Default stays the bare body for backward compatibility.
  if (getBoolean(getRequestValue(request, 'includeHeaders')) ?? false) {
    return { status: result.status, headers: result.headers, data: result.data };
  }

  return result.data;
}

// --- Read-only cross-chain reads from a public Qortal node ---
// Lets QDN apps read Qortal QDN resources (search/status/metadata + binary fetch, e.g. game ROMs).
// Strictly read-only: GET/HEAD against public QDN services only, no account, API key, signing or writes.

let cachedQortalNodeApiUrl: { url: string; expiresAt: number } | null = null;

async function resolveQortalNodeApiUrl(): Promise<string> {
  if (cachedQortalNodeApiUrl && cachedQortalNodeApiUrl.expiresAt > Date.now()) {
    return cachedQortalNodeApiUrl.url;
  }

  for (const candidate of QORTAL_PUBLIC_NODE_API_URLS) {
    try {
      const response = await requestNode(candidate, '/admin/status', 'json', DISCOVERY_TIMEOUT_MS);
      if (response.status >= 200 && response.status < 300) {
        cachedQortalNodeApiUrl = { url: candidate, expiresAt: Date.now() + QORTAL_NODE_CACHE_TTL_MS };
        return candidate;
      }
    } catch {
      // Try the next public Qortal node.
    }
  }

  throw new Error('No public Qortal node is reachable right now.');
}

// Neutral settings so the shared response reader doesn't apply Qortium network-mode messaging.
const QORTAL_READ_SETTINGS: StoredNodeSettings = { apiKey: '', customUrl: '', mode: 'custom' };

async function fetchQortalNodeApi(apiPath: string, maxBytes: number, method: 'GET' | 'HEAD' = 'GET') {
  const nodeApiUrl = await resolveQortalNodeApiUrl();
  const response = await requestNode(nodeApiUrl, apiPath, 'text', REQUEST_TIMEOUT_MS, method);

  return readNodeApiResponse(response, QORTAL_READ_SETTINGS, maxBytes, method !== 'HEAD');
}

async function fetchQortalNodeApiPayload(apiPath: string, request: QdnAppRequest) {
  const result = await fetchQortalNodeApi(apiPath, getQdnAppMaxBytes(getRequestValue(request, 'maxBytes')));

  if (!result.ok) {
    throw new Error(result.body || `Qortal node request failed with HTTP ${result.status}.`);
  }

  return result.data;
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

  const nodeApiUrl = await resolveQortalNodeApiUrl();
  const response = await requestNode(nodeApiUrl, apiPath, 'arraybuffer');

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

// Returns the direct URL of a Qortal resource on the public node. The Qortal node serves these with
// CORS and ranged GET, so an in-app player (e.g. EmulatorJS) can stream the file straight from it.
async function getQortalResourceUrl(request: QdnAppRequest) {
  const resource = getQortalResourceRequest(request);
  const nodeApiUrl = await resolveQortalNodeApiUrl();

  return { url: `${getNodeApiUrlBase(nodeApiUrl)}${buildQortalResourcePath(resource)}` };
}

function getService(value: unknown) {
  const service = getString(value).toUpperCase();

  if (!service) {
    return '';
  }

  if (!PUBLIC_QDN_SERVICES.includes(service as (typeof PUBLIC_QDN_SERVICES)[number])) {
    throw new Error(
      isPrivateQdnService(service)
        ? 'Private (encrypted) QDN resources cannot be opened in Home yet.'
        : 'Only public QDN services can be browsed right now.',
    );
  }

  return service;
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
    throw new Error(
      response.status === 403 && settings.mode === 'network'
        ? getNetworkRestrictionMessage()
        : `QDN raw resource request failed with HTTP ${response.status}.`,
    );
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
    throw new Error(
      response.status === 403 && settings.mode === 'network'
        ? getNetworkRestrictionMessage()
        : `Unable to read the resource file list (HTTP ${response.status}).`,
    );
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
    throw new Error(result.body || `Failed to get lists with HTTP ${result.status}.`);
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
    throw new Error(result.body || `Failed to get list with HTTP ${result.status}.`);
  }

  return result.data;
}

async function addToListForApp(request: QdnAppRequest) {
  const listName = getRequiredListName(request);
  const itemStrings = getRequiredListItems(request);
  const settings = await readNodeSettings();
  const nodeApiUrl = await resolveNodeApiUrl(settings);

  assertLocalWriteConnection(settings, nodeApiUrl);

  const apiKey = getNodeApiKey(settings);
  const result = await postLocalNodeText(
    nodeApiUrl,
    `/lists/${encodeURIComponent(listName)}`,
    JSON.stringify({ items: itemStrings }),
    apiKey,
    'Failed to add items to list.',
    'application/json',
  );

  return parseLocalPostData(result);
}

async function removeFromListForApp(request: QdnAppRequest) {
  const listName = getRequiredListName(request);
  const itemStrings = getRequiredListItems(request);
  const settings = await readNodeSettings();
  const nodeApiUrl = await resolveNodeApiUrl(settings);

  assertLocalWriteConnection(settings, nodeApiUrl);

  const apiKey = getNodeApiKey(settings);
  const result = await deleteLocalNodeText(
    nodeApiUrl,
    `/lists/${encodeURIComponent(listName)}`,
    JSON.stringify({ items: itemStrings }),
    apiKey,
    'Failed to remove items from list.',
    'application/json',
  );

  return parseLocalPostData(result);
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

  switch (action) {
    case 'FETCH_NODE_API': {
      const apiPath = getNodeApiPath(getRequestValue(request, 'path'), 'http://127.0.0.1');
      const method = getReadOnlyMethod(getRequestValue(request, 'method'));

      return fetchConfiguredNodeApi(apiPath, getQdnAppMaxBytes(getRequestValue(request, 'maxBytes')), method);
    }

    case 'GET_NODE_INFO':
      return fetchNodeApiPayload('/admin/info', request);

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
        `/addresses/balance/${encodeURIComponent(await getAddressForQdnRequest(request, context, 'Address'))}`,
        request,
      );

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

    case 'GET_QDN_RESOURCE_URL':
      return getQdnResourceUrl(request, context);

    case 'FETCH_QDN_RESOURCE':
      return fetchNodeApiPayload(buildFetchQdnResourcePath(request), request);

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

    case 'CREATE_POLL':
      return createPollForApp(request, context);

    case 'VOTE_ON_POLL':
      return voteOnPollForApp(request, context);

    case 'UPDATE_POLL':
      return updatePollForApp(request, context);

    case 'RATE_ACCOUNT':
      return rateAccountForApp(request, context);

    case 'GET_ALL_LISTS':
      return getAllListsForApp();

    case 'GET_LIST':
      return getListForApp(request);

    case 'ADD_TO_LIST':
      return addToListForApp(request);

    case 'REMOVE_FROM_LIST':
      return removeFromListForApp(request);

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

    case 'WHICH_UI':
      return 'QORTIUM_HOME_ANDROID';

    case 'SHOW_ACTIONS': {
      // On a public/network node, only report actions that can actually succeed
      // there, so apps that gate UI off SHOW_ACTIONS don't show controls (e.g.
      // RATE_ACCOUNT) that would throw for lack of a local write connection.
      const settings = await readNodeSettings();

      return settings.mode === 'network'
        ? [...QDN_PUBLIC_NODE_BRIDGE_ACTIONS]
        : [...QDN_APP_BRIDGE_ACTIONS];
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
        normalizeResourceRequest(request);
        const settings = await readNodeSettings();

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
          throw new Error(
            response.status === 403 && settings.mode === 'network'
              ? getNetworkRestrictionMessage()
              : stringifyResponseData(response.data) ||
              `QDN resource search failed with HTTP ${response.status}.`,
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
          throw new Error(
            response.status === 403 && settings.mode === 'network'
              ? getNetworkRestrictionMessage()
              : stringifyResponseData(response.data) ||
              `QDN name search failed with HTTP ${response.status}.`,
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
        const body =
          response.status === 403 && settings.mode === 'network'
            ? getNetworkRestrictionMessage()
            : rawBody;
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
          throw new Error(
            response.status === 403 && settings.mode === 'network'
              ? getNetworkRestrictionMessage()
              : stringifyResponseData(response.data) ||
              `QDN raw resource request failed with HTTP ${response.status}.`,
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
        const result = await fetchConfiguredRawResourceBase64(request);

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
      async previewContent() {
        // Pick a file in the WebView, then upload it to the configured node's preview endpoint as
        // base64 (the node can be on another device, so the desktop's local-path flow can't be used).
        // Refresh re-opens the picker, since the chosen file isn't re-readable by path on mobile.
        const file = await pickPreviewFile();
        if (!file) {
          return { canceled: true };
        }

        const { service, archive } = resolvePreviewServiceForFile(file.name);

        const settings = await readNodeSettings();
        const apiKey = getNodeApiKey(settings);
        const nodeApiUrl = await resolveNodeApiUrl(settings);

        const base64 = arrayBufferToBase64(await file.arrayBuffer());
        const query = `archive=${archive ? 'true' : 'false'}&filename=${encodeURIComponent(file.name)}`;

        const result = await postLocalNodeText(
          nodeApiUrl,
          `/arbitrary/preview/${service}/upload?${query}`,
          base64,
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
          service,
          sourceKind: archive ? 'directory' : 'file',
          sourceName: file.name,
          sourcePath: file.name,
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
      async openDownloadedResource(request) {
        if (!isAndroid()) {
          throw new Error('Opening a saved QDN download is only available in the Android app.');
        }

        await QdnFileSaver.openSavedFile({ uri: request.uri, mimeType: request.mimeType });
      },
    },
  };
}

export function installQortiumHomeApiFallback() {
  if (window.qortiumHome) {
    return;
  }

  window.qortiumHome = createFallbackApi();
}
