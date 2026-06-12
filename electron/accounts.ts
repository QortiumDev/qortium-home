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

type AccountSummary = {
  address: string;
  addressIndex: number;
  id: string;
  isUnlocked: boolean;
  label: string;
  sourceFilename: string;
  supportsDerivedAddresses: boolean;
  walletId: string;
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

function sanitizeDerivedAddresses(value: unknown): DerivedWalletAddress[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (entry): entry is DerivedWalletAddress =>
        isRecord(entry) &&
        isNonEmptyString(entry.address) &&
        isFiniteNumber(entry.index) &&
        Number.isInteger(entry.index) &&
        entry.index > 0,
    )
    .map((entry) => ({ address: entry.address, index: entry.index }))
    .sort((first, second) => first.index - second.index);
}

function getDerivedAccountId(walletId: string, addressIndex: number) {
  return addressIndex === 0 ? walletId : `${walletId}:${addressIndex}`;
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
      wallets: parsedStore.wallets.filter(isStoredWallet).map((wallet) => ({
        ...wallet,
        derivedAddresses: sanitizeDerivedAddresses((wallet as Record<string, unknown>).derivedAddresses),
      })),
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
  const versionedHash = appendBuffer([QORTIUM_ADDRESS_VERSION], publicKeyHash);
  const checksum = sha256(sha256(versionedHash)).slice(0, 4);

  return base58Encode(appendBuffer(versionedHash, checksum));
}

function deriveAddress(seed: Uint8Array) {
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
  const iv = new Uint8Array(randomBytes(16));
  const salt = new Uint8Array(randomBytes(32));
  const key = await deriveWalletKey(password);
  const encryptionKey = key.slice(0, 32);
  const macKey = key.slice(32, 63);
  const encryptedSeed = new Uint8Array(asmCrypto.AES_CBC.encrypt(payload, encryptionKey, false, iv));
  const mac = new asmCrypto.HmacSha512(macKey).process(encryptedSeed).finish().result;

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
  return encryptWalletPayload(seed, password, deriveAddress(seed), QORTIUM_WALLET_VERSION);
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

function getAddressFromPrivateKey(privateKey58: string) {
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

export async function getAccountProfile(accountId: string): Promise<AccountProfile> {
  const store = readWalletStore();
  const { address: accountAddress, addressIndex, wallet } = requireWalletAccount(store, accountId);

  let nodeApiUrl = '';

  try {
    nodeApiUrl = await getNodeApiUrl();
  } catch {
    nodeApiUrl = '';
  }

  const name = nodeApiUrl
    ? (await getPrimaryName(accountAddress, nodeApiUrl)) ??
      (await getFirstOwnedName(accountAddress, nodeApiUrl))
    : null;
  const avatarUrl = name
    ? `${nodeApiUrl}/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/avatar?async=true`
    : null;

  return {
    accountId,
    address: accountAddress,
    avatarUrl,
    label: addressIndex === 0 ? wallet.label : `${wallet.label} · ${addressIndex}`,
    name,
  };
}

export function isAccountUnlocked(accountId: string) {
  const resolved = resolveWalletAccount(readWalletStore().wallets, accountId);

  return !!resolved && unlockedWalletSeeds.has(resolved.wallet.id);
}

export function assertAccountUnlocked(accountId: string) {
  const store = readWalletStore();
  const { wallet } = requireWalletAccount(store, accountId);

  if (!unlockedWalletSeeds.has(wallet.id)) {
    throw new Error('Selected account is locked.');
  }
}

export function getAccountSigningKey(accountId: string) {
  const store = readWalletStore();
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
  const address = publicKeyToAddress(keyPair.publicKey);

  if (address !== accountAddress) {
    throw new Error('Selected account signing key does not match the saved account address.');
  }

  return {
    address,
    privateKey58: base58Encode(privateKey),
    publicKey58: base58Encode(keyPair.publicKey),
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
    derivedAddresses: existingWallet?.derivedAddresses ?? [],
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
    derivedAddresses: existingWallet?.derivedAddresses ?? [],
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

async function importPrivateKeyWallet(
  event: IpcMainInvokeEvent,
  name: string,
  privateKey58: string,
  password: string,
): Promise<CreateWalletResult> {
  const initialStore = readWalletStore();
  const initialWalletName = assertValidWalletName(name, initialStore);

  if (!password) {
    throw new Error('Enter the wallet password.');
  }

  const privateKey = decodePrivateKeyInput(privateKey58);
  const address0 = getAddressFromPrivateKey(privateKey58);
  const encryptedWallet = await encryptWalletPayload(
    privateKey,
    password,
    address0,
    QORTIUM_PRIVATE_KEY_WALLET_VERSION,
  );
  const suggestedFilename = `${sanitizeFilenamePart(initialWalletName)}_${address0}.json`;
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
    address: address0,
    derivedAddresses: [],
    sourceFilename,
    encryptedWallet,
    createdAt: existingWallet?.createdAt ?? now,
    updatedAt: now,
  };

  upsertWallet(store, nextWallet);
  unlockedWalletSeeds.set(id, privateKey);
  writeWalletStore(store);

  return {
    canceled: false,
    ...toAccountsState(store),
  };
}

function setActiveAccount(accountId: string) {
  const store = readWalletStore();

  requireWalletAccount(store, accountId);

  store.activeAccountId = accountId;
  writeWalletStore(store);

  return toAccountsState(store);
}

async function unlockWallet(accountId: string, password: string) {
  const store = readWalletStore();
  const { wallet } = requireWalletAccount(store, accountId);
  const seed = await decryptWalletSeed(password, wallet.encryptedWallet);

  unlockedWalletSeeds.set(wallet.id, seed);

  return toAccountsState(store);
}

function lockWallet(accountId: string) {
  const store = readWalletStore();
  const { wallet } = requireWalletAccount(store, accountId);

  unlockedWalletSeeds.delete(wallet.id);

  return toAccountsState(store);
}

function addDerivedAddress(accountId: string) {
  const store = readWalletStore();
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
  const address = publicKeyToAddress(keyPair.publicKey);

  wallet.derivedAddresses = [...wallet.derivedAddresses, { address, index: nextIndex }];
  wallet.updatedAt = new Date().toISOString();
  store.activeAccountId = getDerivedAccountId(wallet.id, nextIndex);
  writeWalletStore(store);

  return toAccountsState(store);
}

async function removeWallet(accountId: string, password?: string) {
  const store = readWalletStore();
  const { addressIndex, wallet } = requireWalletAccount(store, accountId);

  // Removing a derived address only hides it from the list; re-adding derives
  // the same address again, so no password confirmation is needed.
  if (addressIndex > 0) {
    wallet.derivedAddresses = wallet.derivedAddresses.filter((derived) => derived.index !== addressIndex);
    wallet.updatedAt = new Date().toISOString();

    if (store.activeAccountId === accountId) {
      store.activeAccountId = wallet.id;
    }

    writeWalletStore(store);

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
  unlockedWalletSeeds.delete(wallet.id);

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
  ipcMain.handle('accounts:getAddressFromPrivateKey', (_event, privateKey: string) =>
    getAddressFromPrivateKey(privateKey),
  );
  ipcMain.handle('accounts:importPrivateKeyWallet', (event, name: string, privateKey: string, password: string) =>
    importPrivateKeyWallet(event, name, privateKey, password),
  );
  ipcMain.handle('accounts:setActiveAccount', (_event, accountId: string) => setActiveAccount(accountId));
  ipcMain.handle('accounts:addDerivedAddress', (_event, accountId: string) => addDerivedAddress(accountId));
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
