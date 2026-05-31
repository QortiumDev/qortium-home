import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { getNodeApiUrl } from './node-settings.js';

const requireFromElectron = createRequire(import.meta.url);
const asmCrypto = requireFromElectron('asmcrypto.js') as {
  AES_CBC: {
    decrypt: (
      encryptedData: Uint8Array,
      key: Uint8Array,
      padding: boolean,
      iv: Uint8Array,
    ) => Uint8Array;
    encrypt: (
      data: Uint8Array,
      key: Uint8Array,
      padding: boolean,
      iv: Uint8Array,
    ) => Uint8Array;
  };
  HmacSha512: new (key: Uint8Array) => {
    process: (data: Uint8Array) => {
      finish: () => {
        result: Uint8Array;
      };
    };
  };
  Sha512: new () => {
    process: (data: Uint8Array) => {
      finish: () => {
        result: Uint8Array;
      };
    };
  };
  bytes_to_base64: (data: Uint8Array) => string;
};
const bcrypt = requireFromElectron('bcryptjs') as {
  hash: (data: string, salt: string) => Promise<string>;
};
const nacl = requireFromElectron('tweetnacl') as {
  sign: {
    keyPair: {
      fromSeed: (seed: Uint8Array) => {
        publicKey: Uint8Array;
        secretKey: Uint8Array;
      };
    };
  };
};

const WALLETS_FILE = 'wallets.json';
const WALLET_STORE_VERSION = 1;
const QORTAL_WALLET_VERSION = 2;
const KDF_THREAD_COUNT = 16;
const WALLET_SEED_BYTES = 64;
const QORTAL_ADDRESS_VERSION = 58;
const STATIC_SALT = '4ghkVQExoneGqZqHTMMhhFfxXsVg2A75QeS1HCM5KAih';
const STATIC_BCRYPT_SALT = '$2a$11$IxVE941tXVUD4cW0TNVm.O';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_ALPHABET_MAP = new Map<string, number>(
  [...BASE58_ALPHABET].map((character, index) => [character, index]),
);

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

type AccountSummary = {
  address: string;
  id: string;
  isUnlocked: boolean;
  label: string;
  sourceFilename: string;
};

type AccountsState = {
  accounts: AccountSummary[];
  activeAccountId: string | null;
};

type AccountProfile = {
  accountId: string;
  address: string;
  avatarUrl: string | null;
  label: string;
  name: string | null;
};

type CreateWalletResult = AccountsState & {
  canceled: boolean;
};

type PendingLoadedWallet = {
  encryptedWallet: EncryptedWallet;
  sourceFilename: string;
};

type SelectWalletResult =
  | {
      canceled: true;
    }
  | {
      accountId: string;
      address: string;
      canceled: false;
      suggestedName: string;
      token: string;
    };

const unlockedWalletSeeds = new Map<string, Uint8Array>();
const pendingLoadedWallets = new Map<string, PendingLoadedWallet>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getWalletsPath() {
  return path.join(app.getPath('userData'), WALLETS_FILE);
}

function createEmptyWalletStore(): WalletStore {
  return {
    version: WALLET_STORE_VERSION,
    activeAccountId: null,
    wallets: [],
  };
}

function isEncryptedWallet(value: unknown): value is EncryptedWallet {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.address0) &&
    isNonEmptyString(value.encryptedSeed) &&
    isNonEmptyString(value.iv) &&
    isFiniteNumber(value.kdfThreads) &&
    isNonEmptyString(value.mac) &&
    isNonEmptyString(value.salt) &&
    isFiniteNumber(value.version)
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

function readWalletStore(): WalletStore {
  const walletsPath = getWalletsPath();

  if (!existsSync(walletsPath)) {
    return createEmptyWalletStore();
  }

  try {
    const parsedStore: unknown = JSON.parse(readFileSync(walletsPath, 'utf8'));

    if (!isRecord(parsedStore) || !Array.isArray(parsedStore.wallets)) {
      return createEmptyWalletStore();
    }

    const store: WalletStore = {
      version: WALLET_STORE_VERSION,
      wallets: parsedStore.wallets.filter(isStoredWallet),
      activeAccountId:
        typeof parsedStore.activeAccountId === 'string' ? parsedStore.activeAccountId : null,
    };

    return normalizeWalletStore(store);
  } catch (error) {
    console.warn('Unable to read wallet store.', error);
    return createEmptyWalletStore();
  }
}

function writeWalletStore(store: WalletStore) {
  const nextStore = normalizeWalletStore(store);
  const walletsPath = getWalletsPath();

  mkdirSync(path.dirname(walletsPath), { recursive: true });
  writeFileSync(walletsPath, `${JSON.stringify(nextStore, null, 2)}\n`, 'utf8');
}

function toAccountsState(store = readWalletStore()): AccountsState {
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
  return new asmCrypto.Sha512().process(data).finish().result;
}

function sha256(data: Uint8Array) {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

function ripemd160(data: Uint8Array) {
  return new Uint8Array(createHash('ripemd160').update(data).digest());
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

async function computeKdfPart(password: string, nonce: number) {
  const hash = sha512(stringToUtf8Array(`${STATIC_SALT}${password}${nonce}`));
  const hashBase64 = asmCrypto.bytes_to_base64(hash);

  return bcrypt.hash(hashBase64.substring(0, 72), STATIC_BCRYPT_SALT);
}

async function deriveWalletKey(password: string) {
  const parts = await Promise.all(
    Array.from({ length: KDF_THREAD_COUNT }, (_value, nonce) => computeKdfPart(password, nonce)),
  );

  return sha512(stringToUtf8Array(`${STATIC_SALT}${parts.reduce((combined, part) => combined + part)}`));
}

function deriveAddressSeed(seed: Uint8Array, nonce = 0) {
  const nonceBytes = int32ToBytes(nonce);
  const nonceSeed = appendBuffer(appendBuffer(nonceBytes, seed), nonceBytes);
  const firstHash = sha512(nonceSeed);

  return sha512(appendBuffer(firstHash, nonceSeed)).slice(0, 32);
}

function publicKeyToAddress(publicKey: Uint8Array) {
  const publicKeyHash = ripemd160(sha256(publicKey));
  const versionedHash = appendBuffer([QORTAL_ADDRESS_VERSION], publicKeyHash);
  const checksum = sha256(sha256(versionedHash)).slice(0, 4);

  return base58Encode(appendBuffer(versionedHash, checksum));
}

function deriveAddress(seed: Uint8Array) {
  const addressSeed = deriveAddressSeed(seed);
  const keyPair = nacl.sign.keyPair.fromSeed(addressSeed);

  return publicKeyToAddress(keyPair.publicKey);
}

async function encryptWalletSeed(seed: Uint8Array, password: string): Promise<EncryptedWallet> {
  const address = deriveAddress(seed);
  const iv = new Uint8Array(randomBytes(16));
  const salt = new Uint8Array(randomBytes(32));
  const key = await deriveWalletKey(password);
  const encryptionKey = key.slice(0, 32);
  const macKey = key.slice(32, 63);
  const encryptedSeed = new Uint8Array(asmCrypto.AES_CBC.encrypt(seed, encryptionKey, false, iv));
  const mac = new asmCrypto.HmacSha512(macKey).process(encryptedSeed).finish().result;

  return {
    address0: address,
    encryptedSeed: base58Encode(encryptedSeed),
    salt: base58Encode(salt),
    iv: base58Encode(iv),
    version: QORTAL_WALLET_VERSION,
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
    const mac = new asmCrypto.HmacSha512(macKey).process(encryptedSeed).finish().result;

    if (base58Encode(mac) !== wallet.mac) {
      throw new Error('Incorrect wallet password.');
    }

    return new Uint8Array(asmCrypto.AES_CBC.decrypt(encryptedSeed, encryptionKey, false, iv));
  } catch (error) {
    if (error instanceof Error && error.message === 'Incorrect wallet password.') {
      throw error;
    }

    throw new Error('Unable to unlock wallet.');
  }
}

function readWalletFile(filePath: string) {
  try {
    return assertEncryptedWallet(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Wallet file must include')) {
      throw error;
    }

    throw new Error('Unable to read the selected wallet file.');
  }
}

function getWalletId(wallet: EncryptedWallet) {
  return `wallet:${wallet.address0}`;
}

function getWalletLabel(sourceFilename: string, wallet: EncryptedWallet) {
  return path.parse(sourceFilename).name || wallet.address0;
}

function normalizeWalletName(name: string) {
  return name.trim();
}

function walletNameKey(name: string) {
  return normalizeWalletName(name).toLowerCase();
}

function assertValidWalletName(name: string, store: WalletStore, exceptWalletId?: string) {
  const nextName = normalizeWalletName(name);

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

function sanitizeFilenamePart(value: string) {
  const safeValue = value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');

  return safeValue || 'wallet';
}

function ensureJsonFilePath(filePath: string) {
  if (path.extname(filePath).toLowerCase() === '.json') {
    return filePath;
  }

  return `${filePath}.json`;
}

function getAppPath(name: Parameters<typeof app.getPath>[0]) {
  try {
    return app.getPath(name);
  } catch {
    return '';
  }
}

function getDefaultWalletBackupPath(filename: string) {
  const documentsPath = getAppPath('documents');
  const homePath = getAppPath('home');
  const basePath = documentsPath && existsSync(documentsPath) ? documentsPath : homePath;

  return path.join(basePath || process.cwd(), filename);
}

function getNameValue(value: unknown) {
  if (!isRecord(value) || !isNonEmptyString(value.name)) {
    return null;
  }

  return value.name.trim();
}

async function fetchNodeJson(pathname: string, nodeApiUrl: string) {
  let response: Response;

  try {
    response = await fetch(`${nodeApiUrl}${pathname}`);
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  try {
    return (await response.json()) as unknown;
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

async function getAccountProfile(accountId: string): Promise<AccountProfile> {
  const store = readWalletStore();
  const wallet = store.wallets.find((storedWallet) => storedWallet.id === accountId);

  if (!wallet) {
    throw new Error('Selected account is not saved.');
  }

  let nodeApiUrl = '';

  try {
    nodeApiUrl = await getNodeApiUrl();
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

function upsertWallet(store: WalletStore, wallet: StoredWallet) {
  const existingWalletIndex = store.wallets.findIndex((storedWallet) => storedWallet.id === wallet.id);

  if (existingWalletIndex >= 0) {
    store.wallets[existingWalletIndex] = wallet;
  } else {
    store.wallets.push(wallet);
  }

  store.activeAccountId = wallet.id;
}

async function selectWalletFile(event: IpcMainInvokeEvent): Promise<SelectWalletResult> {
  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const dialogOptions: OpenDialogOptions = {
    title: 'Load Wallet',
    properties: ['openFile'],
    filters: [
      { name: 'Wallet JSON', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  };
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return {
      canceled: true,
    };
  }

  const filePath = result.filePaths[0];
  const encryptedWallet = readWalletFile(filePath);
  const id = getWalletId(encryptedWallet);
  const sourceFilename = path.basename(filePath);
  const existingWallet = readWalletStore().wallets.find((wallet) => wallet.id === id);
  const token = randomUUID();

  pendingLoadedWallets.set(token, {
    encryptedWallet,
    sourceFilename,
  });

  return {
    accountId: id,
    address: encryptedWallet.address0,
    canceled: false,
    suggestedName: existingWallet?.label ?? getWalletLabel(sourceFilename, encryptedWallet),
    token,
  };
}

function discardLoadedWallet(token: string) {
  pendingLoadedWallets.delete(token);
}

function saveLoadedWallet(token: string, name: string) {
  const pendingWallet = pendingLoadedWallets.get(token);

  if (!pendingWallet) {
    throw new Error('Selected wallet is no longer available. Load the file again.');
  }

  const { encryptedWallet, sourceFilename } = pendingWallet;
  const store = readWalletStore();
  const id = getWalletId(encryptedWallet);
  const walletName = assertValidWalletName(name, store, id);
  const existingWallet = store.wallets.find((wallet) => wallet.id === id);
  const now = new Date().toISOString();
  const nextWallet: StoredWallet = {
    id,
    label: walletName,
    address: encryptedWallet.address0,
    sourceFilename,
    encryptedWallet,
    createdAt: existingWallet?.createdAt ?? now,
    updatedAt: now,
  };

  unlockedWalletSeeds.delete(id);
  upsertWallet(store, nextWallet);
  writeWalletStore(store);
  pendingLoadedWallets.delete(token);

  return toAccountsState(store);
}

async function createWallet(event: IpcMainInvokeEvent, name: string, password: string): Promise<CreateWalletResult> {
  const initialStore = readWalletStore();
  const initialWalletName = assertValidWalletName(name, initialStore);

  if (!password) {
    throw new Error('Enter the wallet password.');
  }

  const seed = new Uint8Array(randomBytes(WALLET_SEED_BYTES));
  const encryptedWallet = await encryptWalletSeed(seed, password);
  const suggestedFilename = `${sanitizeFilenamePart(initialWalletName)}_${encryptedWallet.address0}.json`;
  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const dialogOptions: SaveDialogOptions = {
    title: 'Save Wallet Backup',
    defaultPath: getDefaultWalletBackupPath(suggestedFilename),
    filters: [{ name: 'JSON wallet file', extensions: ['json'] }],
  };
  const result = parentWindow
    ? await dialog.showSaveDialog(parentWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);

  if (result.canceled || !result.filePath) {
    return {
      canceled: true,
      ...toAccountsState(readWalletStore()),
    };
  }

  const savedFilePath = ensureJsonFilePath(result.filePath);

  writeFileSync(savedFilePath, `${JSON.stringify(encryptedWallet, null, 2)}\n`, 'utf8');

  const id = getWalletId(encryptedWallet);
  const sourceFilename = path.basename(savedFilePath);
  const store = readWalletStore();
  const walletName = assertValidWalletName(initialWalletName, store, id);
  const existingWallet = store.wallets.find((wallet) => wallet.id === id);
  const now = new Date().toISOString();
  const nextWallet: StoredWallet = {
    id,
    label: walletName,
    address: encryptedWallet.address0,
    sourceFilename,
    encryptedWallet,
    createdAt: existingWallet?.createdAt ?? now,
    updatedAt: now,
  };

  upsertWallet(store, nextWallet);
  unlockedWalletSeeds.set(id, seed);
  writeWalletStore(store);

  return {
    canceled: false,
    ...toAccountsState(store),
  };
}

function setActiveAccount(accountId: string) {
  const store = readWalletStore();

  if (!store.wallets.some((wallet) => wallet.id === accountId)) {
    throw new Error('Selected account is not saved.');
  }

  store.activeAccountId = accountId;
  writeWalletStore(store);

  return toAccountsState(store);
}

async function unlockWallet(accountId: string, password: string) {
  const store = readWalletStore();
  const wallet = store.wallets.find((storedWallet) => storedWallet.id === accountId);

  if (!wallet) {
    throw new Error('Selected account is not saved.');
  }

  const seed = await decryptWalletSeed(password, wallet.encryptedWallet);

  unlockedWalletSeeds.set(accountId, seed);

  return toAccountsState(store);
}

function lockWallet(accountId: string) {
  const store = readWalletStore();

  if (!store.wallets.some((wallet) => wallet.id === accountId)) {
    throw new Error('Selected account is not saved.');
  }

  unlockedWalletSeeds.delete(accountId);

  return toAccountsState(store);
}

async function removeWallet(accountId: string, password?: string) {
  const store = readWalletStore();
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
  unlockedWalletSeeds.delete(accountId);

  if (wasActiveWallet) {
    store.activeAccountId = store.wallets[walletIndex]?.id ?? store.wallets[walletIndex - 1]?.id ?? null;
  }

  writeWalletStore(store);

  return toAccountsState(store);
}

export function registerAccountIpcHandlers() {
  ipcMain.handle('accounts:list', () => toAccountsState());
  ipcMain.handle('accounts:getProfile', (_event, accountId: string) => getAccountProfile(accountId));
  ipcMain.handle('accounts:selectWalletFile', (event) => selectWalletFile(event));
  ipcMain.handle('accounts:discardLoadedWallet', (_event, token: string) => discardLoadedWallet(token));
  ipcMain.handle('accounts:saveLoadedWallet', (_event, token: string, name: string) =>
    saveLoadedWallet(token, name),
  );
  ipcMain.handle('accounts:createWallet', (event, name: string, password: string) =>
    createWallet(event, name, password),
  );
  ipcMain.handle('accounts:setActiveAccount', (_event, accountId: string) => setActiveAccount(accountId));
  ipcMain.handle('accounts:unlockWallet', (_event, accountId: string, password: string) =>
    unlockWallet(accountId, password),
  );
  ipcMain.handle('accounts:lockWallet', (_event, accountId: string) => lockWallet(accountId));
  ipcMain.handle('accounts:removeWallet', (_event, accountId: string, password?: string) =>
    removeWallet(accountId, password),
  );

  app.on('before-quit', () => {
    unlockedWalletSeeds.clear();
  });
  app.on('window-all-closed', () => {
    unlockedWalletSeeds.clear();
  });
}
