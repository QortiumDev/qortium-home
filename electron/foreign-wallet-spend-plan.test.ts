import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  estimateMaximumForeignWalletTransactionSize,
  planForeignWalletSpend,
} from './foreign-wallet-spend-plan.js';
import type { ForeignWalletWatchInput } from './foreign-wallet-transaction.js';
import {
  deriveForeignWalletLeafPublicData,
  type ForeignWalletCrypto,
} from './foreign-wallets.js';

const PUBLIC_TEST_SEED = Uint8Array.from({ length: 32 }, (_value, index) => index + 1);
const cryptoAdapter: ForeignWalletCrypto = {
  ripemd160: (data) => Uint8Array.from(createHash('ripemd160').update(data).digest()),
  sha256: (data) => Uint8Array.from(createHash('sha256').update(data).digest()),
  sha512: (data) => Uint8Array.from(createHash('sha512').update(data).digest()),
};
const recipient = deriveForeignWalletLeafPublicData({
  chain: 0,
  coin: 'BTC',
  crypto: cryptoAdapter,
  index: 9,
  seed: PUBLIC_TEST_SEED,
});
const candidates = [
  createWatchInput(0, 50_000n, 30),
  createWatchInput(1, 60_000n, 10),
  createWatchInput(2, 70_000n, 20),
];

const fixed = planForeignWalletSpend({
  amount: 100_000n,
  coin: 'BTC',
  crypto: cryptoAdapter,
  feePerByte: 10n,
  minimumNonDustOutput: 546n,
  recipientAddress: recipient.address,
  seed: PUBLIC_TEST_SEED,
  utxos: candidates,
});
assert.deepEqual(fixed.inputs.map((entry) => entry.height), [10, 20]);
assert.equal(fixed.inputAmount, 130_000n);
assert.equal(fixed.amount, 100_000n);
assert.equal(fixed.estimatedMaximumSize, 376);
assert.equal(fixed.fee, 3_760n);
assert.equal(fixed.change, 26_240n);
assert.equal(fixed.outputAmount, 126_240n);
assert.equal(fixed.changeAddress, fixed.inputs[0].address);
assert.deepEqual(fixed.outputs, [
  { address: recipient.address, value: 100_000n },
  { address: fixed.inputs[0].address, value: 26_240n },
]);

const sendMax = planForeignWalletSpend({
  coin: 'BTC',
  crypto: cryptoAdapter,
  feePerByte: 10n,
  minimumNonDustOutput: 546n,
  recipientAddress: recipient.address,
  seed: PUBLIC_TEST_SEED,
  sendMax: true,
  utxos: candidates,
});
assert.equal(sendMax.inputAmount, 180_000n);
assert.equal(sendMax.estimatedMaximumSize, 491);
assert.equal(sendMax.fee, 4_910n);
assert.equal(sendMax.amount, 175_090n);
assert.equal(sendMax.change, 0n);
assert.equal(sendMax.outputs.length, 1);

const dustRemainder = planForeignWalletSpend({
  amount: 126_500n,
  coin: 'BTC',
  crypto: cryptoAdapter,
  feePerByte: 10n,
  minimumNonDustOutput: 546n,
  recipientAddress: recipient.address,
  seed: PUBLIC_TEST_SEED,
  utxos: candidates,
});
assert.equal(dustRemainder.inputs.length, 2);
assert.equal(dustRemainder.change, 0n);
assert.equal(dustRemainder.fee, 3_500n, 'dust remainder must be included in the approved miner fee');

assert.equal(estimateMaximumForeignWalletTransactionSize(1, [25]), 193);
assert.equal(estimateMaximumForeignWalletTransactionSize(1, [34]), 202, 'P2WSH must not use the old fixed 34-byte output estimate');

const largeValue = 10_000_000_000_000_000n;
const largePlan = planForeignWalletSpend({
  amount: largeValue - 10_000n,
  coin: 'BTC',
  crypto: cryptoAdapter,
  feePerByte: 1n,
  minimumNonDustOutput: 546n,
  recipientAddress: recipient.address,
  seed: PUBLIC_TEST_SEED,
  utxos: [createWatchInput(3, largeValue, 1)],
});
assert.equal(largePlan.inputAmount, largeValue);
assert.equal(largePlan.amount, largeValue - 10_000n);

assert.throws(() => planForeignWalletSpend({
  amount: 200_000n,
  coin: 'BTC',
  crypto: cryptoAdapter,
  feePerByte: 10n,
  minimumNonDustOutput: 546n,
  recipientAddress: recipient.address,
  seed: PUBLIC_TEST_SEED,
  utxos: candidates,
}), /cannot cover/);
assert.throws(() => planForeignWalletSpend({
  amount: 1n,
  coin: 'BTC',
  crypto: cryptoAdapter,
  feePerByte: 10n,
  minimumNonDustOutput: 546n,
  recipientAddress: recipient.address,
  seed: PUBLIC_TEST_SEED,
  sendMax: true,
  utxos: candidates,
}), /either amount or send-max/);
assert.throws(() => planForeignWalletSpend({
  amount: 545n,
  coin: 'BTC',
  crypto: cryptoAdapter,
  feePerByte: 10n,
  minimumNonDustOutput: 546n,
  recipientAddress: recipient.address,
  seed: PUBLIC_TEST_SEED,
  utxos: candidates,
}), /minimum non-dust/);
assert.throws(() => planForeignWalletSpend({
  amount: 50_000n,
  coin: 'BTC',
  crypto: cryptoAdapter,
  feePerByte: 10n,
  minimumNonDustOutput: 546n,
  recipientAddress: recipient.address,
  seed: PUBLIC_TEST_SEED,
  utxos: [candidates[0], candidates[0]],
}), /duplicate input/);

function createWatchInput(index: number, value: bigint, height: number): ForeignWalletWatchInput {
  const key = deriveForeignWalletLeafPublicData({
    chain: 0,
    coin: 'BTC',
    crypto: cryptoAdapter,
    index,
    seed: PUBLIC_TEST_SEED,
  });
  const script = Uint8Array.of(0x76, 0xa9, 0x14, ...hash160(key.publicKey), 0x88, 0xac);
  const previousTransaction = concat(
    le32(1),
    Uint8Array.of(1),
    new Uint8Array(32),
    le32(index),
    Uint8Array.of(1, index),
    le32(0xffffffff),
    Uint8Array.of(1),
    le64(value),
    Uint8Array.of(script.byteLength),
    script,
    le32(0),
  );

  return {
    address: key.address,
    height,
    path: `M/0/${index}`,
    previousTransactionHex: toHex(previousTransaction),
    scriptPubKey: toHex(script),
    txHash: toHex(Uint8Array.from(doubleSha256(previousTransaction)).reverse()),
    txPos: 0,
    value,
  };
}

function hash160(bytes: Uint8Array) {
  return cryptoAdapter.ripemd160(cryptoAdapter.sha256(bytes));
}

function doubleSha256(bytes: Uint8Array) {
  return cryptoAdapter.sha256(cryptoAdapter.sha256(bytes));
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

function le64(value: bigint) {
  const result = new Uint8Array(8);
  let remaining = value;
  for (let index = 0; index < result.byteLength; index += 1) {
    result[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return result;
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
