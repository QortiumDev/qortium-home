import { secp256k1 } from '@noble/curves/secp256k1.js';
import { base58Decode, base58Encode } from './base58.js';

export type ForeignWalletCoin = 'BTC' | 'LTC' | 'DOGE' | 'DGB' | 'RVN' | 'DASH' | 'NMC' | 'FIRO';

export type ForeignWalletCrypto = {
  ripemd160: (data: Uint8Array) => Uint8Array;
  sha256: (data: Uint8Array) => Uint8Array;
  sha512: (data: Uint8Array) => Uint8Array;
};

export type ForeignWalletRuntime = {
  address: string;
  coin: ForeignWalletCoin;
  publicKey: string;
  xprv58: string;
  xpub58: string;
};

export type ForeignWalletPublicRuntime = Omit<ForeignWalletRuntime, 'xprv58'>;

type ForeignWalletLeafKey = {
  address: string;
  path: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
};

export type ForeignWalletLeafPublicData = Omit<ForeignWalletLeafKey, 'privateKey'>;

export type ForeignWalletDigestSignature = ForeignWalletLeafPublicData & {
  derSignature: Uint8Array;
};

type ForeignWalletSpec = {
  addressPrefix: number[];
  coin: ForeignWalletCoin;
  indicator?: string;
  xprvVersion: number;
  xpubVersion: number;
};

const SECP256K1_FIELD = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP256K1_GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const SECP256K1_GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
const HMAC_SHA512_BLOCK_BYTES = 128;

const FOREIGN_WALLET_SPECS: readonly ForeignWalletSpec[] = [
  { addressPrefix: [0x00], coin: 'BTC', xprvVersion: 0x0488ade4, xpubVersion: 0x0488b21e },
  { addressPrefix: [0x30], coin: 'LTC', indicator: 'LTC', xprvVersion: 0x0488ade4, xpubVersion: 0x0488b21e },
  { addressPrefix: [0x1e], coin: 'DOGE', indicator: 'DOGE', xprvVersion: 0x02fac398, xpubVersion: 0x02facafd },
  { addressPrefix: [0x1e], coin: 'DGB', indicator: 'DGB', xprvVersion: 0x0488ade4, xpubVersion: 0x0488b21e },
  { addressPrefix: [0x3c], coin: 'RVN', indicator: 'RVN', xprvVersion: 0x0488ade4, xpubVersion: 0x0488b21e },
  { addressPrefix: [0x4c], coin: 'DASH', indicator: 'DASH', xprvVersion: 0x0488ade4, xpubVersion: 0x0488b21e },
  { addressPrefix: [0x34], coin: 'NMC', indicator: 'NMC', xprvVersion: 0x0488ade4, xpubVersion: 0x0488b21e },
  { addressPrefix: [0x52], coin: 'FIRO', indicator: 'FIRO', xprvVersion: 0x0488ade4, xpubVersion: 0x0488b21e },
] as const;

type ForeignWalletNode = {
  chainCode: Uint8Array;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
};

type SecpPoint = {
  x: bigint;
  y: bigint;
} | null;

export function normalizeForeignWalletCoin(value: unknown): ForeignWalletCoin {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  const aliases: Record<string, ForeignWalletCoin> = {
    BITCOIN: 'BTC',
    BTC: 'BTC',
    DASH: 'DASH',
    DGB: 'DGB',
    DIGIBYTE: 'DGB',
    DOGE: 'DOGE',
    DOGECOIN: 'DOGE',
    FIRO: 'FIRO',
    LTC: 'LTC',
    LITECOIN: 'LTC',
    NAMECOIN: 'NMC',
    NMC: 'NMC',
    RAVENCOIN: 'RVN',
    RVN: 'RVN',
  };
  const coin = aliases[normalized];

  if (!coin) {
    throw new Error('Unsupported foreign wallet coin.');
  }

  return coin;
}

export function getForeignWalletCoins() {
  return FOREIGN_WALLET_SPECS.map((spec) => spec.coin);
}

/**
 * Return a domain-separated, non-secret identity for one canonical root xpub.
 * The journal stores only this digest, never the xpub or any key material.
 */
export function fingerprintForeignWalletPublicRuntime(input: {
  coin: ForeignWalletCoin;
  crypto: ForeignWalletCrypto;
  xpub58: string;
}) {
  const xpub58 = typeof input.xpub58 === 'string' ? input.xpub58.trim() : '';
  let encoded: Uint8Array;
  try {
    encoded = base58Decode(xpub58);
  } catch {
    throw new Error('Invalid foreign wallet extended public key.');
  }
  if (encoded.byteLength !== 82 || base58Encode(encoded) !== xpub58) {
    throw new Error('Invalid foreign wallet extended public key.');
  }
  const payload = encoded.subarray(0, 78);
  const checksum = encoded.subarray(78);
  const expectedChecksum = doubleSha256(payload, input.crypto).subarray(0, 4);
  if (!equalBytes(checksum, expectedChecksum)) {
    throw new Error('Invalid foreign wallet extended public key.');
  }
  const spec = getForeignWalletSpec(input.coin);
  if (!equalBytes(payload.subarray(0, 4), Uint8Array.from(int32ToBytes(spec.xpubVersion)))
    || payload[4] !== 0
    || payload.subarray(5, 13).some((byte) => byte !== 0)
    || (payload[45] !== 0x02 && payload[45] !== 0x03)) {
    throw new Error('Invalid foreign wallet root extended public key.');
  }
  try {
    secp256k1.Point.fromBytes(payload.subarray(45));
  } catch {
    throw new Error('Invalid foreign wallet root extended public key.');
  }
  const domain = stringToUtf8Array(`qortium-home:foreign-wallet-journal:v1\0${input.coin}\0`);
  return bytesToHex(input.crypto.sha256(appendBuffer(domain, payload)));
}

export function deriveForeignWalletRuntime(input: {
  coin: ForeignWalletCoin;
  crypto: ForeignWalletCrypto;
  nonce?: number;
  seed: Uint8Array;
  walletVersion?: number;
}): ForeignWalletRuntime {
  const spec = getForeignWalletSpec(input.coin);
  const addressSeed = deriveAddressSeed(input.seed, input.walletVersion ?? 2, input.nonce ?? 0, input.crypto);
  const root = deriveForeignWalletRootNode(addressSeed, spec.indicator, input.crypto);
  const receive = deriveForeignWalletChildNode(root, 0, input.crypto);
  const firstAddress = deriveForeignWalletChildNode(receive, 0, input.crypto);
  const publicKeyHash = input.crypto.ripemd160(input.crypto.sha256(firstAddress.publicKey));
  const addressPayload = appendBuffer(spec.addressPrefix, publicKeyHash);

  return {
    address: base58CheckEncode(addressPayload, input.crypto),
    coin: spec.coin,
    publicKey: serializeExtendedPublicKey({
      chainCode: root.chainCode,
      childIndex: 0,
      depth: 0,
      parentFingerprint: Uint8Array.from([0, 0, 0, 0]),
      publicKey: root.publicKey,
      version: spec.xpubVersion,
    }, input.crypto),
    xprv58: serializeExtendedPrivateKey({
      chainCode: root.chainCode,
      childIndex: 0,
      depth: 0,
      parentFingerprint: Uint8Array.from([0, 0, 0, 0]),
      privateKey: root.privateKey,
      version: spec.xprvVersion,
    }, input.crypto),
    xpub58: serializeExtendedPublicKey({
      chainCode: root.chainCode,
      childIndex: 0,
      depth: 0,
      parentFingerprint: Uint8Array.from([0, 0, 0, 0]),
      publicKey: root.publicKey,
      version: spec.xpubVersion,
    }, input.crypto),
  };
}

/**
 * Derive only the public/watch material Home 2 may expose or send to Core.
 * Temporary private nodes and copied seed material are erased before return;
 * unlike the maintained Home 1.x compatibility helper above, no xprv is ever
 * serialized into a JavaScript string.
 */
export function deriveForeignWalletPublicRuntime(input: {
  coin: ForeignWalletCoin;
  crypto: ForeignWalletCrypto;
  nonce?: number;
  seed: Uint8Array;
  walletVersion?: number;
}): ForeignWalletPublicRuntime {
  let seed: Uint8Array | undefined;
  let addressSeed: Uint8Array | undefined;
  let root: ForeignWalletNode | undefined;
  let receive: ForeignWalletNode | undefined;
  let firstAddress: ForeignWalletNode | undefined;

  try {
    const spec = getForeignWalletSpec(input.coin);
    seed = Uint8Array.from(input.seed);
    addressSeed = deriveAddressSeed(
      seed,
      input.walletVersion ?? 2,
      input.nonce ?? 0,
      input.crypto,
    );
    root = deriveForeignWalletRootNode(addressSeed, spec.indicator, input.crypto);
    receive = deriveForeignWalletChildNode(root, 0, input.crypto);
    firstAddress = deriveForeignWalletChildNode(receive, 0, input.crypto);
    const publicKeyHash = input.crypto.ripemd160(
      input.crypto.sha256(firstAddress.publicKey),
    );
    const xpub58 = serializeExtendedPublicKey(
      {
        chainCode: root.chainCode,
        childIndex: 0,
        depth: 0,
        parentFingerprint: Uint8Array.from([0, 0, 0, 0]),
        publicKey: root.publicKey,
        version: spec.xpubVersion,
      },
      input.crypto,
    );

    return {
      address: base58CheckEncode(
        appendBuffer(spec.addressPrefix, publicKeyHash),
        input.crypto,
      ),
      coin: spec.coin,
      publicKey: xpub58,
      xpub58,
    };
  } finally {
    seed?.fill(0);
    addressSeed?.fill(0);
    root?.privateKey.fill(0);
    root?.chainCode.fill(0);
    receive?.privateKey.fill(0);
    receive?.chainCode.fill(0);
    firstAddress?.privateKey.fill(0);
    firstAddress?.chainCode.fill(0);
  }
}

/**
 * Derive one non-hardened receive/change key and erase the temporary private
 * nodes as soon as the synchronous callback returns. Callers must not retain
 * the supplied private-key view.
 */
function withForeignWalletLeafKey<T>(input: {
  chain: 0 | 1;
  coin: ForeignWalletCoin;
  crypto: ForeignWalletCrypto;
  index: number;
  nonce?: number;
  seed: Uint8Array;
  walletVersion?: number;
}, useKey: (key: ForeignWalletLeafKey) => T): T {
  if ((input.chain !== 0 && input.chain !== 1)
    || !Number.isSafeInteger(input.index)
    || input.index < 0
    || input.index > 0x7fffffff) {
    throw new Error('Invalid foreign wallet derivation path.');
  }

  let addressSeed: Uint8Array | undefined;
  let root: ForeignWalletNode | undefined;
  let branch: ForeignWalletNode | undefined;
  let leaf: ForeignWalletNode | undefined;

  try {
    const spec = getForeignWalletSpec(input.coin);
    addressSeed = deriveAddressSeed(input.seed, input.walletVersion ?? 2, input.nonce ?? 0, input.crypto);
    root = deriveForeignWalletRootNode(addressSeed, spec.indicator, input.crypto);
    branch = deriveForeignWalletChildNode(root, input.chain, input.crypto);
    leaf = deriveForeignWalletChildNode(branch, input.index, input.crypto);
    const publicKeyHash = input.crypto.ripemd160(input.crypto.sha256(leaf.publicKey));
    const address = base58CheckEncode(appendBuffer(spec.addressPrefix, publicKeyHash), input.crypto);

    return useKey({
      address,
      path: `m/${input.chain}/${input.index}`,
      privateKey: leaf.privateKey,
      publicKey: leaf.publicKey,
    });
  } finally {
    addressSeed?.fill(0);
    root?.privateKey.fill(0);
    root?.chainCode.fill(0);
    branch?.privateKey.fill(0);
    branch?.chainCode.fill(0);
    leaf?.privateKey.fill(0);
    leaf?.chainCode.fill(0);
  }
}

export function deriveForeignWalletLeafPublicData(input: {
  chain: 0 | 1;
  coin: ForeignWalletCoin;
  crypto: ForeignWalletCrypto;
  index: number;
  nonce?: number;
  seed: Uint8Array;
  walletVersion?: number;
}): ForeignWalletLeafPublicData {
  return withForeignWalletLeafKey(input, (leaf) => ({
    address: leaf.address,
    path: leaf.path,
    publicKey: Uint8Array.from(leaf.publicKey),
  }));
}

export function signForeignWalletDigest(input: {
  chain: 0 | 1;
  coin: ForeignWalletCoin;
  crypto: ForeignWalletCrypto;
  digest: Uint8Array;
  index: number;
  nonce?: number;
  seed: Uint8Array;
  walletVersion?: number;
}): ForeignWalletDigestSignature {
  if (input.digest.byteLength !== 32) {
    throw new Error('Foreign wallet signature digest must be 32 bytes.');
  }

  return withForeignWalletLeafKey(input, (leaf) => {
    const signature = secp256k1.sign(input.digest, leaf.privateKey, {
      extraEntropy: false,
      format: 'der',
      lowS: true,
      prehash: false,
    });
    const derSignature = signature.toBytes('der');

    if (!secp256k1.verify(derSignature, input.digest, leaf.publicKey, {
      format: 'der',
      lowS: true,
      prehash: false,
    })) {
      throw new Error('Foreign wallet signature verification failed.');
    }

    return {
      address: leaf.address,
      derSignature,
      path: leaf.path,
      publicKey: Uint8Array.from(leaf.publicKey),
    };
  });
}

function getForeignWalletSpec(coin: ForeignWalletCoin) {
  const spec = FOREIGN_WALLET_SPECS.find((entry) => entry.coin === coin);

  if (!spec) {
    throw new Error('Unsupported foreign wallet coin.');
  }

  return spec;
}

function stringToUtf8Array(value: string) {
  return new TextEncoder().encode(value);
}

function appendBuffer(first: Uint8Array | number[], second: Uint8Array | number[]) {
  const firstBuffer = new Uint8Array(first);
  const secondBuffer = new Uint8Array(second);
  const nextBuffer = new Uint8Array(firstBuffer.byteLength + secondBuffer.byteLength);

  nextBuffer.set(firstBuffer, 0);
  nextBuffer.set(secondBuffer, firstBuffer.byteLength);

  return nextBuffer;
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function int32ToBytes(value: number) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff);
}

function deriveAddressSeed(seed: Uint8Array, walletVersion: number, nonce: number, crypto: ForeignWalletCrypto) {
  if (walletVersion === 1) {
    return Uint8Array.from(seed).slice(0, 32);
  }

  const nonceBytes = Uint8Array.from(int32ToBytes(nonce));
  const nonceSeed = new Uint8Array(nonceBytes.byteLength + seed.byteLength + nonceBytes.byteLength);
  nonceSeed.set(nonceBytes, 0);
  nonceSeed.set(seed, nonceBytes.byteLength);
  nonceSeed.set(nonceBytes, nonceBytes.byteLength + seed.byteLength);
  let firstHash: Uint8Array | undefined;
  let finalMaterial: Uint8Array | undefined;

  try {
    firstHash = crypto.sha512(nonceSeed);
    finalMaterial = appendBuffer(firstHash, nonceSeed);
    return crypto.sha512(finalMaterial).slice(0, 32);
  } finally {
    nonceBytes.fill(0);
    nonceSeed.fill(0);
    firstHash?.fill(0);
    finalMaterial?.fill(0);
  }
}

function buildForeignWalletSeedHash(addressSeed: Uint8Array, indicator: string | undefined, crypto: ForeignWalletCrypto) {
  const reversedSeed = Uint8Array.from(addressSeed).reverse();
  const seedMaterial = indicator ? appendBuffer(reversedSeed, stringToUtf8Array(indicator)) : reversedSeed;
  let reverseSeedHash: Uint8Array | undefined;
  let finalMaterial: Uint8Array | undefined;

  try {
    reverseSeedHash = crypto.sha256(seedMaterial);
    finalMaterial = appendBuffer(reversedSeed, reverseSeedHash);
    return crypto.sha512(finalMaterial);
  } finally {
    reversedSeed.fill(0);
    if (seedMaterial !== reversedSeed) seedMaterial.fill(0);
    reverseSeedHash?.fill(0);
    finalMaterial?.fill(0);
  }
}

function deriveForeignWalletRootNode(
  addressSeed: Uint8Array,
  indicator: string | undefined,
  crypto: ForeignWalletCrypto,
): ForeignWalletNode {
  const seedHash = buildForeignWalletSeedHash(addressSeed, indicator, crypto);
  try {
    const privateKey = secp256k1NormalizePrivateKey(seedHash.subarray(0, 32));
    const chainCode = crypto.sha256(seedHash.subarray(32, 64));

    return {
      chainCode,
      privateKey,
      publicKey: secp256k1CompressedPublicKeyFromPrivate(privateKey),
    };
  } finally {
    seedHash.fill(0);
  }
}

function deriveForeignWalletChildNode(parent: ForeignWalletNode, childIndex: number, crypto: ForeignWalletCrypto): ForeignWalletNode {
  const childMaterial = appendBuffer(parent.publicKey, int32ToBytes(childIndex));
  let childHmac: Uint8Array | undefined;
  try {
    childHmac = hmacSha512(parent.chainCode, childMaterial, crypto);
    const privateKey = secp256k1AddPrivateKeys(childHmac.subarray(0, 32), parent.privateKey);

    return {
      chainCode: Uint8Array.from(childHmac.subarray(32, 64)),
      privateKey,
      publicKey: secp256k1CompressedPublicKeyFromPrivate(privateKey),
    };
  } finally {
    childMaterial.fill(0);
    childHmac?.fill(0);
  }
}

function hmacSha512(key: Uint8Array, data: Uint8Array, crypto: ForeignWalletCrypto) {
  const copiedKey = Uint8Array.from(key);
  let normalizedKey: Uint8Array<ArrayBufferLike> = copiedKey;
  const keyBlock = new Uint8Array(HMAC_SHA512_BLOCK_BYTES);
  const outerKey = new Uint8Array(HMAC_SHA512_BLOCK_BYTES);
  const innerKey = new Uint8Array(HMAC_SHA512_BLOCK_BYTES);
  let innerMaterial: Uint8Array | undefined;
  let innerHash: Uint8Array | undefined;
  let outerMaterial: Uint8Array | undefined;

  try {
    if (normalizedKey.length > HMAC_SHA512_BLOCK_BYTES) {
      normalizedKey = crypto.sha512(normalizedKey);
    }
    keyBlock.set(normalizedKey);

    for (let index = 0; index < HMAC_SHA512_BLOCK_BYTES; index += 1) {
      outerKey[index] = keyBlock[index] ^ 0x5c;
      innerKey[index] = keyBlock[index] ^ 0x36;
    }

    innerMaterial = appendBuffer(innerKey, data);
    innerHash = crypto.sha512(innerMaterial);
    outerMaterial = appendBuffer(outerKey, innerHash);
    return crypto.sha512(outerMaterial);
  } finally {
    copiedKey.fill(0);
    if (normalizedKey !== copiedKey) normalizedKey.fill(0);
    keyBlock.fill(0);
    outerKey.fill(0);
    innerKey.fill(0);
    innerMaterial?.fill(0);
    innerHash?.fill(0);
    outerMaterial?.fill(0);
  }
}

function base58CheckEncode(payload: Uint8Array, crypto: ForeignWalletCrypto) {
  return base58Encode(appendBuffer(payload, doubleSha256(payload, crypto).subarray(0, 4)));
}

function doubleSha256(bytes: Uint8Array, crypto: ForeignWalletCrypto) {
  return crypto.sha256(crypto.sha256(bytes));
}

function serializeExtendedPublicKey(input: {
  chainCode: Uint8Array;
  childIndex: number;
  depth: number;
  parentFingerprint: Uint8Array;
  publicKey: Uint8Array;
  version: number;
}, crypto: ForeignWalletCrypto) {
  const payload = new Uint8Array(78);

  payload.set(int32ToBytes(input.version), 0);
  payload[4] = input.depth;
  payload.set(input.parentFingerprint, 5);
  payload.set(int32ToBytes(input.childIndex), 9);
  payload.set(input.chainCode, 13);
  payload.set(input.publicKey, 45);

  return base58CheckEncode(payload, crypto);
}

function serializeExtendedPrivateKey(input: {
  chainCode: Uint8Array;
  childIndex: number;
  depth: number;
  parentFingerprint: Uint8Array;
  privateKey: Uint8Array;
  version: number;
}, crypto: ForeignWalletCrypto) {
  const payload = new Uint8Array(78);

  payload.set(int32ToBytes(input.version), 0);
  payload[4] = input.depth;
  payload.set(input.parentFingerprint, 5);
  payload.set(int32ToBytes(input.childIndex), 9);
  payload.set(input.chainCode, 13);
  payload.set(appendBuffer([0x00], input.privateKey), 45);

  return base58CheckEncode(payload, crypto);
}

function bytesToBigInt(bytes: Uint8Array) {
  let value = 0n;

  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }

  return value;
}

function bigIntTo32Bytes(value: bigint) {
  const next = new Uint8Array(32);
  let remaining = value;

  for (let index = 31; index >= 0; index -= 1) {
    next[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  return next;
}

function positiveMod(value: bigint, modulo: bigint) {
  const result = value % modulo;

  return result >= 0n ? result : result + modulo;
}

function invertModulo(value: bigint, modulo: bigint) {
  if (value === 0n) {
    throw new Error('Cannot invert zero.');
  }

  let oldR = modulo;
  let r = positiveMod(value, modulo);
  let oldS = 0n;
  let s = 1n;

  while (r !== 0n) {
    const quotient = oldR / r;
    const nextR = oldR - quotient * r;
    const nextS = oldS - quotient * s;

    oldR = r;
    r = nextR;
    oldS = s;
    s = nextS;
  }

  if (oldR !== 1n) {
    throw new Error('Value is not invertible.');
  }

  return positiveMod(oldS, modulo);
}

function secp256k1NormalizePrivateKey(bytes: Uint8Array) {
  return bigIntTo32Bytes((bytesToBigInt(bytes) % (SECP256K1_ORDER - 1n)) + 1n);
}

function secp256k1AddPrivateKeys(left: Uint8Array, right: Uint8Array) {
  const value = positiveMod(bytesToBigInt(left) + bytesToBigInt(right), SECP256K1_ORDER);

  if (value === 0n) {
    throw new Error('Invalid secp256k1 child key.');
  }

  return bigIntTo32Bytes(value);
}

function secp256k1CompressedPublicKeyFromPrivate(privateKey: Uint8Array) {
  const point = multiplyPoint({ x: SECP256K1_GX, y: SECP256K1_GY }, bytesToBigInt(privateKey));

  if (!point) {
    throw new Error('Invalid secp256k1 private key.');
  }

  const prefix = point.y % 2n === 0n ? 0x02 : 0x03;

  return appendBuffer([prefix], bigIntTo32Bytes(point.x));
}

function addPoints(left: SecpPoint, right: SecpPoint): SecpPoint {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  if (left.x === right.x && positiveMod(left.y + right.y, SECP256K1_FIELD) === 0n) {
    return null;
  }

  const slope = left.x === right.x && left.y === right.y
    ? positiveMod((3n * left.x * left.x) * invertModulo(2n * left.y, SECP256K1_FIELD), SECP256K1_FIELD)
    : positiveMod((right.y - left.y) * invertModulo(right.x - left.x, SECP256K1_FIELD), SECP256K1_FIELD);
  const x = positiveMod(slope * slope - left.x - right.x, SECP256K1_FIELD);
  const y = positiveMod(slope * (left.x - x) - left.y, SECP256K1_FIELD);

  return { x, y };
}

function multiplyPoint(point: SecpPoint, scalar: bigint): SecpPoint {
  let remaining = scalar;
  let addend = point;
  let result: SecpPoint = null;

  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) {
      result = addPoints(result, addend);
    }

    addend = addPoints(addend, addend);
    remaining >>= 1n;
  }

  return result;
}
