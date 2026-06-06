import { Capacitor, CapacitorHttp, registerPlugin, type HttpResponse } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { AES_CBC, HmacSha512, Sha512, bytes_to_base64 } from 'asmcrypto.js';
import bcrypt from 'bcryptjs';
import nacl from 'tweetnacl';
import packageJson from '../package.json';
import { PUBLIC_QDN_SERVICES } from './qdn';

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
const PUBLIC_READ_PROBE_PATH =
  '/arbitrary/resources/search?mode=ALL&limit=1&includestatus=false&includemetadata=false';
const REQUEST_TIMEOUT_MS = 30_000;
const DISCOVERY_TIMEOUT_MS = 5_000;
const DISCOVERY_CACHE_TTL_MS = 5 * 60_000;
const WALLET_STORE_VERSION = 1;
const QORTIUM_WALLET_VERSION = 2;
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
const QDN_WRITE_APPROVAL_TIMEOUT_MS = 120_000;
const QDN_WRITE_ACTIONS = ['PUBLISH_QDN_RESOURCE', 'DELETE_QDN_RESOURCE'] as const;
const QDN_CHAT_ACTIONS = ['JOIN_GROUP', 'SEND_CHAT_MESSAGE'] as const;
const QDN_PRIVATE_GROUP_CHAT_READ_ACTIONS = [
  'GET_PRIVATE_GROUP_ACTIVE_CHATS',
  'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES',
] as const;
const QDN_PRIVATE_DIRECT_CHAT_READ_ACTIONS = [
  'GET_PRIVATE_DIRECT_ACTIVE_CHATS',
  'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
] as const;
const QDN_APP_BRIDGE_ACTIONS = [
  'FETCH_NODE_API',
  'FETCH_QDN_RESOURCE',
  'GET_ACCOUNT_DATA',
  'GET_ACCOUNT_GROUPS',
  'GET_ACCOUNT_NAMES',
  'GET_ACTIVE_CHATS',
  'GET_BALANCE',
  'GET_GROUP',
  'GET_GROUP_MEMBERS',
  'GET_NAME_DATA',
  'GET_NODE_INFO',
  'GET_NODE_STATUS',
  'GET_SELECTED_ACCOUNT',
  'GET_QDN_RESOURCE_METADATA',
  'GET_QDN_RESOURCE_PROPERTIES',
  'GET_QDN_RESOURCE_STATUS',
  'GET_QDN_RESOURCE_URL',
  'IS_USING_PUBLIC_NODE',
  'LIST_GROUPS',
  'LIST_QDN_RESOURCES',
  ...QDN_WRITE_ACTIONS,
  ...QDN_CHAT_ACTIONS,
  ...QDN_PRIVATE_DIRECT_CHAT_READ_ACTIONS,
  ...QDN_PRIVATE_GROUP_CHAT_READ_ACTIONS,
  'SEARCH_CHAT_MESSAGES',
  'SEARCH_GROUPS',
  'SEARCH_QDN_RESOURCES',
  'WHICH_UI',
  'SHOW_ACTIONS',
] as const;
const QDN_CHAT_MESSAGE_MAX_BYTES = 4000;

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

type StoredWallet = {
  address: string;
  createdAt: string;
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

type QdnFileOpenerPlugin = {
  openFile: (request: { filePath: string; mimeType?: string }) => Promise<{ opened?: boolean }>;
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
  resourceUrl: string;
  sessionKey: string;
};

type QdnWriteAction = (typeof QDN_WRITE_ACTIONS)[number];
type QdnChatAction = (typeof QDN_CHAT_ACTIONS)[number];
type QdnWriteApprovalAction =
  | QdnWriteAction
  | QdnChatAction
  | 'READ_PRIVATE_GROUP_CHAT'
  | 'READ_PRIVATE_DIRECT_CHAT';
type QdnChatPermissionAction =
  | 'SEND_CHAT_MESSAGE'
  | 'READ_PRIVATE_GROUP_CHAT'
  | 'READ_PRIVATE_DIRECT_CHAT';

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
  chatMessagePreview?: string;
  groupId?: number;
  groupName?: string | null;
  permissionScope?: 'single-request' | 'session';
  recipientAddress?: string;
  resource?: QdnWriteResourceRequest;
  source?: QdnPublishSourceResult;
};

type PendingAccountReadApproval = {
  resolve: (approved: boolean) => void;
  timeoutId: number;
};

const UpdateInstaller = registerPlugin<UpdateInstallerPlugin>('UpdateInstaller');
const QdnFileOpener = registerPlugin<QdnFileOpenerPlugin>('QdnFileOpener');
const WalletBackup = registerPlugin<WalletBackupPlugin>('WalletBackup');
const QdnPublishSource = registerPlugin<QdnPublishSourcePlugin>('QdnPublishSource');
const unlockedWalletSeeds = new Map<string, Uint8Array>();
const pendingLoadedWallets = new Map<string, PendingLoadedWallet>();
const qdnAccountReadListeners = new Set<(request: QortiumQdnAccountReadApprovalRequest) => void>();
const qdnWriteListeners = new Set<(request: QortiumQdnWriteApprovalRequest) => void>();
const pendingAccountReadApprovals = new Map<string, PendingAccountReadApproval>();
const pendingQdnWriteApprovals = new Map<string, PendingAccountReadApproval>();
const approvedAccountReadRequests = new Set<string>();
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

function arrayBufferToBase64(value: ArrayBuffer) {
  const bytes = new Uint8Array(value);
  let binary = '';

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return window.btoa(binary);
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

function normalizeWalletStore(store: WalletStore): WalletStore {
  const activeWallet = store.wallets.find((wallet) => wallet.id === store.activeAccountId);

  return {
    version: WALLET_STORE_VERSION,
    wallets: store.wallets,
    activeAccountId: activeWallet?.id ?? store.wallets[0]?.id ?? null,
  };
}

function parseWalletStore(value: unknown): WalletStore {
  if (!isRecord(value) || !Array.isArray(value.wallets)) {
    return createEmptyWalletStore();
  }

  return normalizeWalletStore({
    version: WALLET_STORE_VERSION,
    wallets: value.wallets.filter(isStoredWallet),
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
    accounts: nextStore.wallets.map((wallet) => ({
      id: wallet.id,
      label: wallet.label,
      address: wallet.address,
      sourceFilename: wallet.sourceFilename,
      isUnlocked: unlockedWalletSeeds.has(wallet.id),
    })),
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

async function encryptWalletSeed(seed: Uint8Array, password: string): Promise<EncryptedWallet> {
  const address = await deriveAddress(seed);
  const iv = getRandomBytes(16);
  const salt = getRandomBytes(32);
  const key = await deriveWalletKey(password);
  const encryptionKey = key.slice(0, 32);
  const macKey = key.slice(32, 63);
  const encryptedSeedResult = AES_CBC.encrypt(seed, encryptionKey, false, iv);

  if (!encryptedSeedResult) {
    throw new Error('Unable to encrypt wallet seed.');
  }

  const encryptedSeed = new Uint8Array(encryptedSeedResult);
  const mac = new HmacSha512(macKey).process(encryptedSeed).finish().result;

  if (!mac) {
    throw new Error('Unable to authenticate wallet seed.');
  }

  return {
    address0: address,
    encryptedSeed: base58Encode(encryptedSeed),
    salt: base58Encode(salt),
    iv: base58Encode(iv),
    version: QORTIUM_WALLET_VERSION,
    mac: base58Encode(mac),
    kdfThreads: KDF_THREAD_COUNT,
  };
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
    throw new Error('Enter the wallet name.');
  }

  const duplicateWallet = store.wallets.find(
    (wallet) => wallet.id !== exceptWalletId && walletNameKey(wallet.label) === walletNameKey(nextName),
  );

  if (duplicateWallet) {
    throw new Error('Wallet name already exists.');
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

async function exportWallet(accountId: string) {
  const store = await readWalletStore();
  const wallet = store.wallets.find((storedWallet) => storedWallet.id === accountId);

  if (!wallet) {
    throw new Error('Selected account is not saved.');
  }

  const suggestedFilename = wallet.sourceFilename || getWalletBackupFilename(wallet.label, wallet.encryptedWallet);

  return saveWalletBackup(wallet.encryptedWallet, suggestedFilename);
}

async function setActiveAccount(accountId: string) {
  const store = await readWalletStore();

  if (!store.wallets.some((wallet) => wallet.id === accountId)) {
    throw new Error('Selected account is not saved.');
  }

  store.activeAccountId = accountId;
  await writeWalletStore(store);

  return toAccountsState(store);
}

async function unlockWallet(accountId: string, password: string) {
  const store = await readWalletStore();
  const wallet = store.wallets.find((storedWallet) => storedWallet.id === accountId);

  if (!wallet) {
    throw new Error('Selected account is not saved.');
  }

  const seed = await decryptWalletSeed(password, wallet.encryptedWallet);

  unlockedWalletSeeds.set(accountId, seed);

  return toAccountsState(store);
}

async function lockWallet(accountId: string) {
  const store = await readWalletStore();

  if (!store.wallets.some((wallet) => wallet.id === accountId)) {
    throw new Error('Selected account is not saved.');
  }

  forgetUnlockedWalletSeed(accountId);

  return toAccountsState(store);
}

async function removeWallet(accountId: string, password?: string) {
  const store = await readWalletStore();
  const walletIndex = store.wallets.findIndex((wallet) => wallet.id === accountId);
  const wallet = store.wallets[walletIndex];

  if (!wallet) {
    throw new Error('Selected account is not saved.');
  }

  if (!unlockedWalletSeeds.has(accountId)) {
    await decryptWalletSeed(password ?? '', wallet.encryptedWallet);
  }

  const wasActiveWallet = store.activeAccountId === accountId;

  store.wallets.splice(walletIndex, 1);
  forgetUnlockedWalletSeed(accountId);

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
  const wallet = store.wallets.find((storedWallet) => storedWallet.id === accountId);

  if (!wallet) {
    throw new Error('Selected account is not saved.');
  }

  let nodeApiUrl = '';

  try {
    nodeApiUrl = await resolveNodeApiUrl(await readNodeSettings());
  } catch {
    nodeApiUrl = '';
  }

  const name = nodeApiUrl
    ? (await getPrimaryName(wallet.address, nodeApiUrl)) ??
      (await getFirstOwnedName(wallet.address, nodeApiUrl))
    : null;
  const avatarUrl = name
    ? `${nodeApiUrl}/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/qortium_avatar?async=true`
    : null;

  return {
    accountId: wallet.id,
    address: wallet.address,
    avatarUrl,
    label: wallet.label,
    name,
  };
}

async function requestAccountReadApproval(
  context: QdnAppRequestContext,
  profile: QortiumAccountProfile,
) {
  const cacheKey = getQdnAccountReadApprovalCacheKey(context, profile.accountId);

  if (approvedAccountReadRequests.has(cacheKey)) {
    return;
  }

  if (qdnAccountReadListeners.size === 0) {
    throw new Error('QDN account request approval is unavailable.');
  }

  const requestId = createRequestId();
  const approved = await new Promise<boolean>((resolve) => {
    const timeoutId = window.setTimeout(() => {
      pendingAccountReadApprovals.delete(requestId);
      resolve(false);
    }, 120_000);

    pendingAccountReadApprovals.set(requestId, {
      resolve,
      timeoutId,
    });

    for (const listener of qdnAccountReadListeners) {
      listener({
        action: 'GET_SELECTED_ACCOUNT',
        address: profile.address,
        avatarUrl: profile.avatarUrl,
        id: requestId,
        name: profile.name,
        resourceUrl: context.resourceUrl || 'QDN app',
      });
    }
  });

  if (!approved) {
    throw new Error('Account request was denied.');
  }

  approvedAccountReadRequests.add(cacheKey);
}

async function getSelectedAccountForQdnApp(context: QdnAppRequestContext | undefined) {
  if (!context) {
    throw new Error('GET_SELECTED_ACCOUNT is only available from a QDN app frame.');
  }

  if (!context.accountId) {
    throw new Error('No account is selected for this tab.');
  }

  const profile = await getAccountProfile(context.accountId);

  await requestAccountReadApproval(context, profile);

  return {
    address: profile.address,
    avatarUrl: profile.avatarUrl,
    name: profile.name,
  };
}

function getRequestTags(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(getString).filter(Boolean);
  }

  const tag = getString(value);

  return tag ? [tag] : [];
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
    tags: getRequestTags(getRequestValue(request, 'tags')),
    category: category || undefined,
    fee: getRequestFee(getRequestValue(request, 'fee')),
  };
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
  const wallet = store.wallets.find((storedWallet) => storedWallet.id === accountId);

  if (!wallet) {
    throw new Error('Selected account is not saved.');
  }

  const seed = unlockedWalletSeeds.get(accountId);

  if (!seed) {
    throw new Error('Selected account is locked.');
  }

  const privateKey = deriveAddressSeed(seed, 0);
  const keyPair = nacl.sign.keyPair.fromSeed(privateKey);
  const address = await publicKeyToAddress(keyPair.publicKey);

  if (address !== wallet.address) {
    throw new Error('Selected account signing key does not match the saved account address.');
  }

  return {
    address,
    privateKey58: base58Encode(privateKey),
    publicKey58: base58Encode(keyPair.publicKey),
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
        chatMessagePreview: details.chatMessagePreview ?? null,
        groupId: typeof details.groupId === 'number' ? details.groupId : null,
        groupName: details.groupName ?? null,
        id: requestId,
        permissionScope: details.permissionScope ?? 'single-request',
        recipientAddress: details.recipientAddress ?? null,
        resource: details.resource
          ? {
              identifier: details.resource.identifier ?? null,
              name: details.resource.name,
              service: details.resource.service,
            }
          : null,
        resourceUrl: context.resourceUrl || 'QDN app',
        sourceKind: details.source?.canceled === false ? 'file' : null,
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

async function signAndProcessTransaction(
  writeContext: QdnWriteContext,
  rawUnsignedBytes58: string,
  computePath = '/arbitrary/compute',
) {
  const rawUnsignedWithNonce = await postLocalNodeText(
    writeContext.nodeApiUrl,
    computePath,
    rawUnsignedBytes58,
    writeContext.apiKey,
    'QDN transaction nonce computation failed.',
  );
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

function getGroupName(groupData: unknown) {
  if (!isRecord(groupData)) {
    return null;
  }

  return getString(groupData.groupName) || getString(groupData.name) || null;
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
  const source = await selectQdnPublishSource();

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
  };
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

async function sendChatMessageForApp(request: QdnAppRequest, context: QdnAppRequestContext | undefined) {
  const target = getChatMessageTarget(request);
  const message = getChatMessageText(request);
  const chatReference = getOptionalBase58RequestString(request, 'chatReference');
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

  await requestQdnChatPermissionApproval(
    context as QdnAppRequestContext,
    writeContext.profile,
    'READ_PRIVATE_GROUP_CHAT',
    {
      groupName: 'All closed groups',
    },
  );

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
  const groupData = await getGroupDataForChat(writeContext.nodeApiUrl, groupId);

  await requestQdnChatPermissionApproval(
    context as QdnAppRequestContext,
    writeContext.profile,
    'READ_PRIVATE_GROUP_CHAT',
    {
      groupId,
      groupName: getGroupName(groupData),
    },
  );

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

async function getPrivateDirectActiveChatsForApp(
  request: QdnAppRequest,
  context: QdnAppRequestContext | undefined,
) {
  const writeContext = await getQdnWriteContext(context);

  await requestQdnChatPermissionApproval(
    context as QdnAppRequestContext,
    writeContext.profile,
    'READ_PRIVATE_DIRECT_CHAT',
    {},
  );

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

  await requestQdnChatPermissionApproval(
    context as QdnAppRequestContext,
    writeContext.profile,
    'READ_PRIVATE_DIRECT_CHAT',
    {
      recipientAddress: otherAddress,
    },
  );

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
    exportWallet,
    setActiveAccount,
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

function getQdnAccountReadApprovalCacheKey(context: QdnAppRequestContext, accountId: string) {
  return [
    context.sessionKey,
    context.resourceUrl,
    accountId,
    'GET_SELECTED_ACCOUNT',
  ].join('\n');
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

  return result.data;
}

function getService(value: unknown) {
  const service = getString(value).toUpperCase();

  if (!service) {
    return '';
  }

  if (!PUBLIC_QDN_SERVICES.includes(service as (typeof PUBLIC_QDN_SERVICES)[number])) {
    throw new Error('Only public QDN services can be browsed right now.');
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
    queryParams.set('exactmatchnames', String(getBoolean(request.exactMatchNames) ?? true));
  }

  return `/arbitrary/resources/search?${queryParams.toString()}`;
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

async function getQdnResourceUrl(request: QdnAppRequest) {
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
  const queryParams = new URLSearchParams(queryString);

  if (resource.identifier) {
    queryParams.set('identifier', resource.identifier);
  }

  const renderQueryString = queryParams.toString();

  return `${getNodeApiUrlBase(nodeApiUrl)}/render/${resource.service}/${encodeURIComponent(resource.name)}${
    encodedPath ? `/${encodedPath}` : ''
  }${renderQueryString ? `?${renderQueryString}` : ''}`;
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
        `/addresses/${encodeURIComponent(getRequiredRequestString(request, 'address', 'Address'))}`,
        request,
      );

    case 'GET_ACCOUNT_GROUPS':
      return fetchNodeApiPayload(await buildAccountGroupsPath(request, context), request);

    case 'GET_ACCOUNT_NAMES':
      return fetchNodeApiPayload(
        `/names/address/${encodeURIComponent(getRequiredRequestString(request, 'address', 'Address'))}`,
        request,
      );

    case 'GET_SELECTED_ACCOUNT':
      return getSelectedAccountForQdnApp(context);

    case 'GET_BALANCE':
      return fetchNodeApiPayload(
        `/addresses/balance/${encodeURIComponent(getRequiredRequestString(request, 'address', 'Address'))}`,
        request,
      );

    case 'GET_GROUP':
      return fetchNodeApiPayload(
        `/groups/${encodeURIComponent(String(getRequiredGroupId(request, 1)))}`,
        request,
      );

    case 'GET_GROUP_MEMBERS':
      return fetchNodeApiPayload(buildGroupMembersPath(request), request);

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
      return getQdnResourceUrl(request);

    case 'FETCH_QDN_RESOURCE':
      return fetchNodeApiPayload(buildFetchQdnResourcePath(request), request);

    case 'LIST_QDN_RESOURCES':
      return fetchNodeApiPayload(buildQdnAppResourcesPath(request, '/arbitrary/resources'), request);

    case 'SEARCH_QDN_RESOURCES':
      return fetchNodeApiPayload(buildQdnAppResourcesPath(request, '/arbitrary/resources/search'), request);

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

    case 'PUBLISH_QDN_RESOURCE':
      return publishQdnResourceForApp(request, context);

    case 'DELETE_QDN_RESOURCE':
      return deleteQdnResourceForApp(request, context);

    case 'JOIN_GROUP':
      return joinGroupForApp(request, context);

    case 'SEND_CHAT_MESSAGE':
      return sendChatMessageForApp(request, context);

    case 'IS_USING_PUBLIC_NODE': {
      const settings = await readNodeSettings();

      return settings.mode === 'network';
    }

    case 'WHICH_UI':
      return 'QORTIUM_HOME_ANDROID';

    case 'SHOW_ACTIONS':
      return [...QDN_APP_BRIDGE_ACTIONS];

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
      avatarUrl: null,
      label: '',
      name: null,
    }),
    selectWalletFile: async () => unsupported(),
    discardLoadedWallet: async () => undefined,
    saveLoadedWallet: async () => unsupported(),
    createWallet: async () => unsupported(),
    exportWallet: async () => unsupported(),
    setActiveAccount: async () => emptyState,
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
      onAccountReadRequest(callback) {
        qdnAccountReadListeners.add(callback);

        return () => {
          qdnAccountReadListeners.delete(callback);
        };
      },
      onWriteRequest(callback) {
        qdnWriteListeners.add(callback);

        return () => {
          qdnWriteListeners.delete(callback);
        };
      },
      resolveAccountReadRequest: async (requestId, approved) => {
        const pendingApproval = pendingAccountReadApprovals.get(requestId);

        if (!pendingApproval) {
          return;
        }

        window.clearTimeout(pendingApproval.timeoutId);
        pendingAccountReadApprovals.delete(requestId);
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
    },
    node: {
      async checkCoreUpdate() {
        return requestCoreOnChainUpdate('GET');
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
      async prepareArchiveRender() {
        throw new Error('Inline archive app rendering is only available in the desktop app right now.');
      },
      async downloadResource(request) {
        if (!isAndroid()) {
          throw new Error('Saving QDN downloads is only available in the desktop app and Android app.');
        }

        const fileName = getSuggestedQdnDownloadFilename(request);
        const downloadPath = `${QDN_DOWNLOADS_DIR}/${Date.now()}-${fileName}`;
        const downloadedResource = await fetchConfiguredRawResourceBase64(request);

        await Filesystem.writeFile({
          path: downloadPath,
          data: downloadedResource.content,
          directory: Directory.Data,
          recursive: true,
        });

        const fileUri = await Filesystem.getUri({
          path: downloadPath,
          directory: Directory.Data,
        });

        await QdnFileOpener.openFile({
          filePath: fileUri.uri,
          mimeType: downloadedResource.contentType || undefined,
        });

        return {
          canceled: false,
          fileName,
          filePath: fileUri.uri,
          opened: true,
          size: downloadedResource.contentLength,
        };
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
