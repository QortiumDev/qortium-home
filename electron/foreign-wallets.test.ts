import assert from 'node:assert/strict';
import { createECDH, createHash } from 'node:crypto';
import {
  deriveForeignWalletPublicRuntime,
  deriveForeignWalletRuntime,
  fingerprintForeignWalletPublicRuntime,
  getForeignWalletCoins,
  normalizeForeignWalletCoin,
  type ForeignWalletCoin,
  type ForeignWalletCrypto,
} from './foreign-wallets.js';

// Public synthetic fixture only: the bytes 0x01 through 0x20 are not account
// material. Address/xpub expectations are independently preserved in the
// archived qortal-home HEAD fixture described in the Phase 2A plan.
const PUBLIC_TEST_SEED = Uint8Array.from({ length: 32 }, (_value, index) => index + 1);

const cryptoAdapter: ForeignWalletCrypto = {
  ripemd160: (data) => Uint8Array.from(createHash('ripemd160').update(data).digest()),
  sha256: (data) => Uint8Array.from(createHash('sha256').update(data).digest()),
  sha512: (data) => Uint8Array.from(createHash('sha512').update(data).digest()),
};

type ForeignWalletFixture = {
  address: string;
  addressPrefix: number;
  xprv58: string;
  xprvVersion: number;
  xpub58: string;
  xpubVersion: number;
};

const FIXTURES: Record<ForeignWalletCoin, ForeignWalletFixture> = {
  BTC: {
    address: '187v1EG87d2fwnXuiGb815r1g4kReiPsSf',
    addressPrefix: 0x00,
    xprv58: 'xprv9s21ZrQH143K2qjVdn864NSY7aNESo88ao1ZnALHmYdTLUywN8cMNQwbXDZs6N7YmfTaHoHX2FCTiDtUjsLH22EAqxLtaPQZHe8QMTtJUSm',
    xprvVersion: 0x0488ade4,
    xpub58: 'xpub661MyMwAqRbcFKoxjof6RWPGfcCirFqyx1wAaYjuKtASDHK5ufvbvDG5NUdKigNnDpdhbuimdjPeAUfpVW1mBrpHjp2oX1ahdcbC1VmUWt9',
    xpubVersion: 0x0488b21e,
  },
  LTC: {
    address: 'LZNdy6Wf9p37wqDGkZttE9HnwJCm25byov',
    addressPrefix: 0x30,
    xprv58: 'xprv9s21ZrQH143K3FAiM4CHbm7cbYguCyYCdLMGW5YEXPz5KtPBJwNFa3oMkXBVvUP9UEjNahQS1aJwb3xJpMwa42KdFeJGsVFxotcqB9MYjzy',
    xprvVersion: 0x0488ade4,
    xpub58: 'xpub661MyMwAqRbcFjFBT5jHxu4M9aXPcSG3zZGsJTwr5jX4CgiKrUgW7r7qbpK48YWGaL8MCYX4mngsaiMzg2vKU785nikwiLHZBW1wVz9VEv7',
    xpubVersion: 0x0488b21e,
  },
  DOGE: {
    address: 'D78W6j6FBCCJuwgopkRhkSnU43xZ5wpcfg',
    addressPrefix: 0x1e,
    xprv58: 'dgpv51eADS3spNJhAMcBW9cpeTfBCfxPbN9fp3j8RRnfscuAfTiEKvTkTZcRsRxqpyhpASaWmvg32EAWXfDaPHBakTDsWkvmozaWZS8D3jYEfw3',
    xprvVersion: 0x02fac398,
    xpub58: 'dgub8kXBZ7ymNWy2TDGLYPEnmKCmfEL2RVBP6eWLaYBefjxBDWpvjh1X6s25SfLBtkVEHyJRboeDq8XRNoCkkVURCdZHaiZiuiEiGKUeBbpGZkQ',
    xpubVersion: 0x02facafd,
  },
  DGB: {
    address: 'DKd6VzQ1dzBXF9V6Na9oufjrHYtq1HKvRi',
    addressPrefix: 0x1e,
    xprv58: 'xprv9s21ZrQH143K2f4b8o6Dki6hoQ1HiJpLKXWW3skwyzZhMbyVKTuy37nGEnkUoXZBVAbSnKnjDMyUszgbAdCt1GaNwAB2c2xmmM4YC6P4PrN',
    xprvVersion: 0x0488ade4,
    xpub58: 'xpub661MyMwAqRbcF994EpdE7r3SMRqn7mYBgkS6rGAZYL6gEQJds1EDav6k65RFYbBXz89yR5TW1ku8RG97hwonbtCkscQcJpoBvB7L8NDyiWQ',
    xpubVersion: 0x0488b21e,
  },
  RVN: {
    address: 'RStiQL2PC2VGSiyJbzXtkh11o7wcWf6R2N',
    addressPrefix: 0x3c,
    xprv58: 'xprv9s21ZrQH143K35c59uc1SwUbP7VvFDqU6fBAAaW2yYfBFAr7XeSprASi6U39EtwZgoJUADUCrA3XemKW1fsHyVLrLKkCZKT4WQn6ZZ5THCq',
    xprvVersion: 0x0488ade4,
    xpub58: 'xpub661MyMwAqRbcFZgYFw91p5RKw9LQegZKTt6kxxueXtCA7yBG5Bm5PxmBwiZgFrwaMc6uwnKNS8sodAHoNVNH36hHyQzYPkqAcVF4F2PyV7P',
    xpubVersion: 0x0488b21e,
  },
  DASH: {
    address: 'XwPhDwHqFvJdzSvQN7c6nopqgDYTNrcVau',
    addressPrefix: 0x4c,
    xprv58: 'xprv9s21ZrQH143K2DsjBVfwwDiMQ9J2NLjQ3MPGbKKoLc8qFhSDg3KuRiiyvUc3Yt7nPzBpVXU8mWS81JVEyRGEBxQ4hYzpMPj2SfFpcfzssZk',
    xprvVersion: 0x0488ade4,
    xpub58: 'xpub661MyMwAqRbcEhxCHXCxJMf5xB8WmoTFQaJsPhjQtwfp8VmNDae9yX3Tmkz5pQQ4Dn5aGdg2fx2N4Jf8A9yFHt1wxyUrsRGt7cxwMKGf1g2',
    xpubVersion: 0x0488b21e,
  },
  NMC: {
    address: 'NH9FVHNUW1t3xPC9LkDQrK5r13CaGebXCY',
    addressPrefix: 0x34,
    xprv58: 'xprv9s21ZrQH143K3A757NXKXbQ3tRobgRS7r5nYmHmMrkw6M7Q1bdmox63Pfh8BZLTfr3zhATJxQSenK8odmuKcAR25faYysb718ndff9GifAU',
    xprvVersion: 0x0488ade4,
    xpub58: 'xpub661MyMwAqRbcFeBYDQ4KtjLnSTe65t9yDJi9ZgAyR6U5DujA9B64VtMsWyYASQh4tJ15J41DmCnsZiGH56qs4zpfZqJY3smzmbd1xKJf4ed',
    xpubVersion: 0x0488b21e,
  },
  FIRO: {
    address: 'a1Sn72TRQvjjTbsrRLJXvxTtQLq6NtvnJt',
    addressPrefix: 0x52,
    xprv58: 'xprv9s21ZrQH143K43GBt3XcqzXSwNSkLZjF7xCNNcALHTSmmQ1eX5rjLxqthemB8UMiH5XWWzGsTLynS9fekygwdSswKSZsUF5qAxfQWszaSgE',
    xprvVersion: 0x0488ade4,
    xpub58: 'xpub661MyMwAqRbcGXLez54dD8UBVQHEk2T6VB7yAzZwqnykeCLo4dAytmANYvP9GSFYH9qm4pGh7Pi4QP27ZExjLa3DS9E6E4jWNXDrLv4cD97',
    xpubVersion: 0x0488b21e,
  },
};

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function decodeBase58Independently(value: string) {
  let numeric = 0n;

  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    assert.notEqual(digit, -1, `invalid Base58 character ${character}`);
    numeric = numeric * 58n + BigInt(digit);
  }

  const decoded = [];
  while (numeric > 0n) {
    decoded.push(Number(numeric & 0xffn));
    numeric >>= 8n;
  }
  decoded.reverse();

  let leadingZeroes = 0;
  while (value[leadingZeroes] === '1') {
    leadingZeroes += 1;
  }

  return Uint8Array.from([...new Array<number>(leadingZeroes).fill(0), ...decoded]);
}

function doubleSha256(data: Uint8Array) {
  return createHash('sha256').update(createHash('sha256').update(data).digest()).digest();
}

function decodeBase58Check(value: string, payloadLength: number) {
  const decoded = decodeBase58Independently(value);
  assert.equal(decoded.length, payloadLength + 4);
  const payload = decoded.subarray(0, payloadLength);
  const checksum = decoded.subarray(payloadLength);
  assert.deepEqual(checksum, Uint8Array.from(doubleSha256(payload).subarray(0, 4)));
  return payload;
}

function readUint32(bytes: Uint8Array, offset = 0) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

function assertExtendedKeyPair(fixture: ForeignWalletFixture) {
  const xprv = decodeBase58Check(fixture.xprv58, 78);
  const xpub = decodeBase58Check(fixture.xpub58, 78);

  assert.equal(readUint32(xprv), fixture.xprvVersion);
  assert.equal(readUint32(xpub), fixture.xpubVersion);
  assert.deepEqual(xprv.subarray(4, 45), xpub.subarray(4, 45));
  assert.equal(xprv[45], 0);

  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(xprv.subarray(46, 78));
  assert.deepEqual(Uint8Array.from(ecdh.getPublicKey(undefined, 'compressed')), xpub.subarray(45, 78));
}

assert.deepEqual(getForeignWalletCoins(), ['BTC', 'LTC', 'DOGE', 'DGB', 'RVN', 'DASH', 'NMC', 'FIRO']);

for (const coin of getForeignWalletCoins()) {
  const fixture = FIXTURES[coin];
  const wallet = deriveForeignWalletRuntime({
    coin,
    crypto: cryptoAdapter,
    seed: PUBLIC_TEST_SEED,
    walletVersion: 2,
  });

  assert.equal(wallet.coin, coin);
  assert.equal(wallet.address, fixture.address);
  assert.equal(wallet.publicKey, fixture.xpub58);
  assert.equal(wallet.xpub58, fixture.xpub58);
  assert.equal(wallet.xprv58, fixture.xprv58);

  const addressPayload = decodeBase58Check(wallet.address, 21);
  assert.equal(addressPayload[0], fixture.addressPrefix);
  assertExtendedKeyPair(fixture);

  const publicWallet = deriveForeignWalletPublicRuntime({
    coin,
    crypto: cryptoAdapter,
    seed: PUBLIC_TEST_SEED,
    walletVersion: 2,
  });
  assert.deepEqual(publicWallet, {
    address: fixture.address,
    coin,
    publicKey: fixture.xpub58,
    xpub58: fixture.xpub58,
  });
  assert.equal('xprv58' in publicWallet, false);
  assert.equal(JSON.stringify(publicWallet).includes(fixture.xprv58), false);
  assert.match(fingerprintForeignWalletPublicRuntime({
    coin,
    crypto: cryptoAdapter,
    xpub58: publicWallet.xpub58,
  }), /^[0-9a-f]{64}$/);
  assert.throws(() => fingerprintForeignWalletPublicRuntime({
    coin,
    crypto: cryptoAdapter,
    xpub58: fixture.xprv58,
  }), /extended public key/);
}

for (const [alias, coin] of [
  ['bitcoin', 'BTC'],
  [' litecoin ', 'LTC'],
  ['dogecoin', 'DOGE'],
  ['digibyte', 'DGB'],
  ['ravencoin', 'RVN'],
  ['dash', 'DASH'],
  ['namecoin', 'NMC'],
  ['firo', 'FIRO'],
] as Array<[string, ForeignWalletCoin]>) {
  assert.equal(normalizeForeignWalletCoin(alias), coin);
}
assert.throws(() => normalizeForeignWalletCoin('BCH'), /Unsupported foreign wallet coin\./);
assert.throws(() => normalizeForeignWalletCoin(null), /Unsupported foreign wallet coin\./);

for (const [input, expected] of [
  [
    { nonce: 0, walletVersion: 1 },
    {
      address: '1D145LPGFx1A7SS4o1Kw3FBjyQRnrEsY7a',
      xprv58: 'xprv9s21ZrQH143K2zSC98HWeW2FBHA6AqNi9TqFm8pjy84xW9bP25JBVjUP6zQvXN9mm2Vsb5Bc3w1JvceKFBP6r7v2Q3oScV7UrNKouQyvDoB',
      xpub58: 'xpub661MyMwAqRbcFUWfF9pX1dxyjJzaaJ6ZWgkrZXEMXTbwNwvXZccS3XnrxEw6iArBY4zQrAEouQGjgbqG5uT1qM3ePJsFe8wRQrqWY2YyfL1',
    },
  ],
  [
    { nonce: 7, walletVersion: 2 },
    {
      address: '195UgbQDybCbgjuCEs5sfMncEerH5H6vBA',
      xprv58: 'xprv9s21ZrQH143K3SbuQXLLXC1Cj4BpfdmLMHkdvnnRYEM3WZUfRUsYYXFBSqhnnqmLpMPHEsNBZ7cS3xqi215yovZ34sQKtMoxtQ1wT1h71yT',
      xpub58: 'xpub661MyMwAqRbcFvgNWYsLtKwwH62K56VBiWgEjBC36Zt2PMooy2Bo6KZfJ7GTvScSxr4KJ1tCCDuRZRypJRXaZTKMmUUAhfEYYUk4LsvMRc6',
    },
  ],
] as const) {
  const wallet = deriveForeignWalletRuntime({ coin: 'BTC', crypto: cryptoAdapter, seed: PUBLIC_TEST_SEED, ...input });
  assert.equal(wallet.address, expected.address);
  assert.equal(wallet.xprv58, expected.xprv58);
  assert.equal(wallet.xpub58, expected.xpub58);
  assertExtendedKeyPair({ ...FIXTURES.BTC, ...expected });
}

console.log('Foreign wallet derivation vector tests passed.');
