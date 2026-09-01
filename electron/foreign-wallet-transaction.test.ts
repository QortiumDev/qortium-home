import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { base58, bech32 } from '@scure/base';
import {
  buildForeignWalletSignedTransaction,
  validateForeignWalletRecipient,
  type ForeignWalletWatchInput,
} from './foreign-wallet-transaction.js';
import {
  deriveForeignWalletLeafPublicData,
  signForeignWalletDigest,
  type ForeignWalletCrypto,
} from './foreign-wallets.js';

const PUBLIC_TEST_SEED = Uint8Array.from({ length: 32 }, (_value, index) => index + 1);
const cryptoAdapter: ForeignWalletCrypto = {
  ripemd160: (data) => Uint8Array.from(createHash('ripemd160').update(data).digest()),
  sha256: (data) => Uint8Array.from(createHash('sha256').update(data).digest()),
  sha512: (data) => Uint8Array.from(createHash('sha512').update(data).digest()),
};

const fundingKey = deriveForeignWalletLeafPublicData({
  chain: 0,
  coin: 'BTC',
  crypto: cryptoAdapter,
  index: 0,
  seed: PUBLIC_TEST_SEED,
  walletVersion: 2,
});
const recipientKey = deriveForeignWalletLeafPublicData({
  chain: 0,
  coin: 'BTC',
  crypto: cryptoAdapter,
  index: 1,
  seed: PUBLIC_TEST_SEED,
  walletVersion: 2,
});
const fundingScript = p2pkhScript(hash160(fundingKey.publicKey));
const previousTransaction = concat(
  le32(1),
  Uint8Array.of(1),
  new Uint8Array(32),
  le32(0xffffffff),
  Uint8Array.of(1, 0),
  le32(0xffffffff),
  Uint8Array.of(1),
  le64(100_000),
  Uint8Array.of(fundingScript.byteLength),
  fundingScript,
  le32(0),
);
const previousTransactionHex = toHex(previousTransaction);
const previousTransactionId = toHex(Uint8Array.from(doubleSha256(previousTransaction)).reverse());
const watchInput: ForeignWalletWatchInput = {
  address: fundingKey.address,
  height: 100,
  path: 'M/0/0',
  previousTransactionHex,
  scriptPubKey: toHex(fundingScript),
  txHash: previousTransactionId,
  txPos: 0,
  value: 100_000n,
};

const signed = buildForeignWalletSignedTransaction({
  coin: 'BTC',
  crypto: cryptoAdapter,
  inputs: [watchInput],
  outputs: [{ address: recipientKey.address, value: 90_000n }],
  seed: PUBLIC_TEST_SEED,
  walletVersion: 2,
});
const repeated = buildForeignWalletSignedTransaction({
  coin: 'BTC',
  crypto: cryptoAdapter,
  inputs: [watchInput],
  outputs: [{ address: recipientKey.address, value: 90_000n }],
  seed: PUBLIC_TEST_SEED,
  walletVersion: 2,
});

assert.deepEqual(repeated, signed, 'RFC6979 signing must be deterministic');
assert.equal(signed.rawTransactionHex, '0100000001117f5b50c48dcfc9deb20a477e476baa4da1ddd6c5b5f5f66585d49f6e16075d000000006b483045022100be4e023338be1cc6a7b072874e37efb8aa5caad65c5d27de2544c736099d321a022036f81759c2efd7b2926fb142b4c4c663581b8d59aa8d6bab131bfc4dba3fdd7f0121028d93e306d698001f979293d68b635e692e74a750178039ebae77a33c03311912ffffffff01905f0100000000001976a914e49c35c89163fafb453ace35d49e9d96ed5386ae88ac00000000');
assert.equal(signed.inputAmount, 100_000n);
assert.equal(signed.outputAmount, 90_000n);
assert.equal(signed.fee, 10_000n);
assert.equal(signed.transactionSize, signed.rawTransactionHex.length / 2);
assert.equal(signed.txId, toHex(Uint8Array.from(doubleSha256(fromHex(signed.rawTransactionHex))).reverse()));
assert.equal(signed.rawTransactionHex.slice(0, 10), '0100000001');
assert.ok(signed.rawTransactionHex.includes(toHex(fundingScript)) === false, 'scriptPubKey must not be copied into scriptSig');

const parsedInput = parseSingleInputTransaction(signed.rawTransactionHex);
assert.equal(parsedInput.previousTransactionId, previousTransactionId);
assert.equal(parsedInput.outputIndex, 0);
assert.equal(parsedInput.sequence, 0xffffffff);
assert.equal(parsedInput.signature.at(-1), 0x01);
assert.deepEqual(parsedInput.publicKey, fundingKey.publicKey);
const sighash = doubleSha256(concat(
  le32(1),
  Uint8Array.of(1),
  Uint8Array.from(fromHex(previousTransactionId)).reverse(),
  le32(0),
  Uint8Array.of(fundingScript.byteLength),
  fundingScript,
  le32(0xffffffff),
  parsedInput.serializedOutputsAndLockTime,
  le32(1),
));
assert.equal(
  secp256k1.verify(parsedInput.signature.subarray(0, -1), sighash, fundingKey.publicKey, {
    lowS: true,
    prehash: false,
    format: 'der',
  }),
  true,
);

const witnessTransactionBody = concat(
  Uint8Array.of(1),
  new Uint8Array(32),
  le32(0xffffffff),
  Uint8Array.of(1, 0),
  le32(0xffffffff),
  Uint8Array.of(1),
  le64(100_000),
  Uint8Array.of(fundingScript.byteLength),
  fundingScript,
);
const witnessPreviousTransaction = concat(
  le32(2),
  Uint8Array.of(0, 1),
  witnessTransactionBody,
  Uint8Array.of(1, 2, 0xaa, 0xbb),
  le32(0),
);
const witnessTransactionId = toHex(Uint8Array.from(doubleSha256(concat(
  le32(2),
  witnessTransactionBody,
  le32(0),
))).reverse());
const witnessWatchInput: ForeignWalletWatchInput = {
  ...watchInput,
  previousTransactionHex: toHex(witnessPreviousTransaction),
  txHash: witnessTransactionId,
};
assert.equal(buildForeignWalletSignedTransaction({
  coin: 'BTC',
  crypto: cryptoAdapter,
  inputs: [witnessWatchInput],
  outputs: [{ address: recipientKey.address, value: 90_000n }],
  seed: PUBLIC_TEST_SEED,
}).inputAmount, 100_000n, 'SegWit funding transactions must attest using their non-witness txid');

const digest = Uint8Array.from({ length: 32 }, (_value, index) => 0xa0 + index);
const digestSignature = signForeignWalletDigest({
  chain: 0,
  coin: 'BTC',
  crypto: cryptoAdapter,
  digest,
  index: 0,
  seed: PUBLIC_TEST_SEED,
  walletVersion: 2,
});
assert.equal(toHex(digestSignature.derSignature), '304402200c445658eb1c5c003a6672b8f161e38634d6590ee4c69e351e895930cfdbbc5b02200c3dd5724f5d55fc64f25f01c0ceaf917d72e5cb9366a073fbff13db8a547969');
assert.equal(secp256k1.verify(digestSignature.derSignature, digest, digestSignature.publicKey, {
  lowS: true,
  prehash: false,
  format: 'der',
}), true);
assert.equal(secp256k1.Signature.fromBytes(digestSignature.derSignature, 'der').hasHighS(), false);

const p2shHash = Uint8Array.from({ length: 20 }, () => 0x22);
const btcP2sh = encodeBase58Check(Uint8Array.of(0x05, ...p2shHash));
assert.deepEqual(validateForeignWalletRecipient({ address: btcP2sh, coin: 'BTC', crypto: cryptoAdapter }), {
  address: btcP2sh,
  outputType: 'P2SH',
  scriptPubKey: Uint8Array.of(0xa9, 0x14, ...p2shHash, 0x87),
});

const btcWitnessProgram = Uint8Array.from({ length: 20 }, () => 0x33);
const btcBech32 = bech32.encode('bc', [0, ...bech32.toWords(btcWitnessProgram)]);
assert.equal(validateForeignWalletRecipient({ address: btcBech32, coin: 'BTC', crypto: cryptoAdapter }).outputType, 'P2WPKH');
const legacyLitecoinP2sh = encodeBase58Check(Uint8Array.of(0x05, ...p2shHash));
const normalizedLitecoinP2sh = validateForeignWalletRecipient({
  address: legacyLitecoinP2sh,
  coin: 'LTC',
  crypto: cryptoAdapter,
});
assert.equal(fromBase58Check(normalizedLitecoinP2sh.address)[0], 0x32);
assert.equal(normalizedLitecoinP2sh.outputType, 'P2SH');

for (const mutation of [
  { ...watchInput, height: 0 },
  { ...watchInput, path: 'M/1/0' },
  { ...watchInput, scriptPubKey: `76a914${'55'.repeat(20)}88ac` },
  { ...watchInput, txHash: '66'.repeat(32) },
  { ...watchInput, value: 99_999n },
]) {
  assert.throws(() => buildForeignWalletSignedTransaction({
    coin: 'BTC',
    crypto: cryptoAdapter,
    inputs: [mutation],
    outputs: [{ address: recipientKey.address, value: 90_000n }],
    seed: PUBLIC_TEST_SEED,
  }), /Foreign wallet input|foreign wallet input/);
}

assert.throws(() => buildForeignWalletSignedTransaction({
  coin: 'BTC',
  crypto: cryptoAdapter,
  inputs: [watchInput, watchInput],
  outputs: [{ address: recipientKey.address, value: 90_000n }],
  seed: PUBLIC_TEST_SEED,
}), /duplicate input/);
assert.throws(() => buildForeignWalletSignedTransaction({
  coin: 'BTC',
  crypto: cryptoAdapter,
  inputs: [watchInput],
  outputs: [{ address: recipientKey.address, value: 100_001n }],
  seed: PUBLIC_TEST_SEED,
}), /outputs exceed inputs/);
assert.throws(() => buildForeignWalletSignedTransaction({
  coin: 'BTC',
  crypto: cryptoAdapter,
  inputs: [{
    ...watchInput,
    previousTransactionHex: `${watchInput.previousTransactionHex}00`,
    txHash: toHex(Uint8Array.from(doubleSha256(concat(previousTransaction, Uint8Array.of(0)))).reverse()),
  }],
  outputs: [{ address: recipientKey.address, value: 90_000n }],
  seed: PUBLIC_TEST_SEED,
}), /trailing data/);
assert.throws(() => buildForeignWalletSignedTransaction({
  coin: 'BTC',
  crypto: cryptoAdapter,
  inputs: Array.from({ length: 1_001 }, () => watchInput),
  outputs: [{ address: recipientKey.address, value: 90_000n }],
  seed: PUBLIC_TEST_SEED,
}), /input count exceeds/);

function parseSingleInputTransaction(rawHex: string) {
  const bytes = fromHex(rawHex);
  let offset = 4;
  assert.equal(bytes[offset++], 1);
  const previousTransactionId = toHex(Uint8Array.from(bytes.subarray(offset, offset + 32)).reverse());
  offset += 32;
  const outputIndex = readLe32(bytes, offset);
  offset += 4;
  const scriptLength = bytes[offset++];
  const script = bytes.subarray(offset, offset + scriptLength);
  offset += scriptLength;
  const sequence = readLe32(bytes, offset);
  offset += 4;
  const serializedOutputsAndLockTime = bytes.subarray(offset);
  const signatureLength = script[0];
  const signature = script.subarray(1, 1 + signatureLength);
  const publicKeyOffset = 1 + signatureLength;
  const publicKeyLength = script[publicKeyOffset];
  const publicKey = script.subarray(publicKeyOffset + 1, publicKeyOffset + 1 + publicKeyLength);
  assert.equal(publicKeyOffset + 1 + publicKeyLength, script.byteLength);
  return { outputIndex, previousTransactionId, publicKey, sequence, serializedOutputsAndLockTime, signature };
}

function p2pkhScript(hash: Uint8Array) {
  return Uint8Array.of(0x76, 0xa9, 0x14, ...hash, 0x88, 0xac);
}

function hash160(bytes: Uint8Array) {
  return cryptoAdapter.ripemd160(cryptoAdapter.sha256(bytes));
}

function doubleSha256(bytes: Uint8Array) {
  return cryptoAdapter.sha256(cryptoAdapter.sha256(bytes));
}

function encodeBase58Check(payload: Uint8Array) {
  return base58.encode(concat(payload, doubleSha256(payload).subarray(0, 4)));
}

function fromBase58Check(value: string) {
  const decoded = base58.decode(value);
  const payload = decoded.subarray(0, -4);
  assert.deepEqual(decoded.subarray(-4), doubleSha256(payload).subarray(0, 4));
  return payload;
}

function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function le32(value: number) {
  return Uint8Array.of(
    value & 0xff,
    Math.floor(value / 0x100) & 0xff,
    Math.floor(value / 0x10000) & 0xff,
    Math.floor(value / 0x1000000) & 0xff,
  );
}

function le64(value: number | bigint) {
  const result = new Uint8Array(8);
  let remaining = BigInt(value);
  for (let index = 0; index < result.byteLength; index += 1) {
    result[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return result;
}

function readLe32(bytes: Uint8Array, offset: number) {
  return bytes[offset]
    + bytes[offset + 1] * 0x100
    + bytes[offset + 2] * 0x10000
    + bytes[offset + 3] * 0x1000000;
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value: string) {
  return Uint8Array.from({ length: value.length / 2 }, (_entry, index) => (
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  ));
}
