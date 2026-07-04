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

type ForeignWalletSpec = {
  addressPrefix: number[];
  coin: ForeignWalletCoin;
  indicator?: string;
  xprvVersion: number;
  xpubVersion: number;
};

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
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

function int32ToBytes(value: number) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff);
}

function deriveAddressSeed(seed: Uint8Array, walletVersion: number, nonce: number, crypto: ForeignWalletCrypto) {
  if (walletVersion === 1) {
    return Uint8Array.from(seed).slice(0, 32);
  }

  const nonceBytes = int32ToBytes(nonce);
  const nonceSeed = appendBuffer(appendBuffer(nonceBytes, seed), nonceBytes);
  const firstHash = crypto.sha512(nonceSeed);

  return crypto.sha512(appendBuffer(firstHash, nonceSeed)).slice(0, 32);
}

function buildForeignWalletSeedHash(addressSeed: Uint8Array, indicator: string | undefined, crypto: ForeignWalletCrypto) {
  const reversedSeed = Uint8Array.from(addressSeed).reverse();
  const seedMaterial = indicator ? appendBuffer(reversedSeed, stringToUtf8Array(indicator)) : reversedSeed;
  const reverseSeedHash = crypto.sha256(seedMaterial);

  return crypto.sha512(appendBuffer(reversedSeed, reverseSeedHash));
}

function deriveForeignWalletRootNode(
  addressSeed: Uint8Array,
  indicator: string | undefined,
  crypto: ForeignWalletCrypto,
): ForeignWalletNode {
  const seedHash = buildForeignWalletSeedHash(addressSeed, indicator, crypto);
  const privateKey = secp256k1NormalizePrivateKey(seedHash.subarray(0, 32));
  const chainCode = crypto.sha256(seedHash.subarray(32, 64));

  return {
    chainCode,
    privateKey,
    publicKey: secp256k1CompressedPublicKeyFromPrivate(privateKey),
  };
}

function deriveForeignWalletChildNode(parent: ForeignWalletNode, childIndex: number, crypto: ForeignWalletCrypto): ForeignWalletNode {
  const childHmac = hmacSha512(parent.chainCode, appendBuffer(parent.publicKey, int32ToBytes(childIndex)), crypto);
  const privateKey = secp256k1AddPrivateKeys(childHmac.subarray(0, 32), parent.privateKey);

  return {
    chainCode: childHmac.subarray(32, 64),
    privateKey,
    publicKey: secp256k1CompressedPublicKeyFromPrivate(privateKey),
  };
}

function hmacSha512(key: Uint8Array, data: Uint8Array, crypto: ForeignWalletCrypto) {
  let normalizedKey: Uint8Array<ArrayBufferLike> = Uint8Array.from(key);

  if (normalizedKey.length > HMAC_SHA512_BLOCK_BYTES) {
    normalizedKey = crypto.sha512(normalizedKey);
  }

  const keyBlock = new Uint8Array(HMAC_SHA512_BLOCK_BYTES);
  keyBlock.set(normalizedKey);

  const outerKey = new Uint8Array(HMAC_SHA512_BLOCK_BYTES);
  const innerKey = new Uint8Array(HMAC_SHA512_BLOCK_BYTES);

  for (let index = 0; index < HMAC_SHA512_BLOCK_BYTES; index += 1) {
    outerKey[index] = keyBlock[index] ^ 0x5c;
    innerKey[index] = keyBlock[index] ^ 0x36;
  }

  return crypto.sha512(appendBuffer(outerKey, crypto.sha512(appendBuffer(innerKey, data))));
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
