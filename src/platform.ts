import { Capacitor, CapacitorHttp, registerPlugin, type HttpResponse } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { AES_CBC, HmacSha512, Sha512, bytes_to_base64 } from 'asmcrypto.js';
import bcrypt from 'bcryptjs';
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
const KDF_THREAD_COUNT = 16;
const STATIC_SALT = '4ghkVQExoneGqZqHTMMhhFfxXsVg2A75QeS1HCM5KAih';
const STATIC_BCRYPT_SALT = '$2a$11$IxVE941tXVUD4cW0TNVm.O';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_ALPHABET_MAP = new Map<string, number>(
  [...BASE58_ALPHABET].map((character, index) => [character, index]),
);
const QDN_APP_DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const QDN_APP_MAX_BYTES_LIMIT = 5 * 1024 * 1024;
const QDN_APP_BRIDGE_ACTIONS = [
  'FETCH_NODE_API',
  'FETCH_QDN_RESOURCE',
  'GET_ACCOUNT_DATA',
  'GET_ACCOUNT_NAMES',
  'GET_BALANCE',
  'GET_NAME_DATA',
  'GET_NODE_INFO',
  'GET_NODE_STATUS',
  'GET_QDN_RESOURCE_METADATA',
  'GET_QDN_RESOURCE_PROPERTIES',
  'GET_QDN_RESOURCE_STATUS',
  'GET_QDN_RESOURCE_URL',
  'IS_USING_PUBLIC_NODE',
  'LIST_QDN_RESOURCES',
  'SEARCH_QDN_RESOURCES',
  'WHICH_UI',
  'SHOW_ACTIONS',
] as const;

type StoredNodeSettings = {
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

const UpdateInstaller = registerPlugin<UpdateInstallerPlugin>('UpdateInstaller');
const QdnFileOpener = registerPlugin<QdnFileOpenerPlugin>('QdnFileOpener');
const unlockedWalletSeeds = new Map<string, Uint8Array>();
const pendingLoadedWallets = new Map<string, PendingLoadedWallet>();

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
    customUrl: '',
    mode: isAndroid() ? 'network' : 'local',
  };
}

function parseStoredNodeSettings(value: unknown): StoredNodeSettings {
  if (!value || typeof value !== 'object') {
    return getDefaultNodeSettings();
  }

  const rawSettings = value as Partial<StoredNodeSettings>;
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
      customUrl,
      mode: 'custom',
    };
  }

  if (rawMode === 'network') {
    return {
      customUrl,
      mode: 'network',
    };
  }

  if (rawMode === 'local') {
    return {
      customUrl,
      mode: 'local',
    };
  }

  if (rawMode === 'previewnet') {
    return {
      customUrl,
      mode: isAndroid() ? 'network' : 'local',
    };
  }

  return {
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

  if (value.mode === 'custom' && !customUrl) {
    throw new Error('Custom node URL is required.');
  }

  return {
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
  await setStoredValue(NODE_SETTINGS_KEY, JSON.stringify(settings));
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

function createStoredAccountsApi(): PlatformApi['accounts'] {
  return {
    list: async () => toAccountsState(await readWalletStore()),
    getCapabilities: async () => ({
      canCreateWallet: false,
      canLoadWalletFile: true,
    }),
    getProfile: (accountId) => getAccountProfile(accountId),
    selectWalletFile,
    discardLoadedWallet: async (token) => discardLoadedWallet(token),
    saveLoadedWallet,
    createWallet: async () => {
      throw new Error('Creating wallets on Android will be added after the mobile backup flow is ready.');
    },
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

export async function handleQdnAppRequest(value: unknown) {
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

    case 'GET_ACCOUNT_NAMES':
      return fetchNodeApiPayload(
        `/names/address/${encodeURIComponent(getRequiredRequestString(request, 'address', 'Address'))}`,
        request,
      );

    case 'GET_BALANCE':
      return fetchNodeApiPayload(
        `/addresses/balance/${encodeURIComponent(getRequiredRequestString(request, 'address', 'Address'))}`,
        request,
      );

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
    node: {
      async getSettings() {
        return getNodeSettingsSnapshot(await readNodeSettings());
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
