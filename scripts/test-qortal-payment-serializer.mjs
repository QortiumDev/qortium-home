import assert from 'node:assert/strict';
import {
  assertPositiveQortAmount,
  assertValidQortalAddress,
  base58Encode,
  buildUnsignedPaymentTransactionBytes,
  formatQortAtomic,
  qortDecimalToAtomic,
} from '../dist-electron/qortal-payment.js';

const fixture = {
  amountAtomic: 100000000n,
  expectedUnsignedBase58:
    '111FDmMz7g1NLa833BsqYoZNcDeYo6gCUdDZURSm5BVu9Ho4fHHiCZUVGWmFGGrsR78QSeZ3TXgchjTszbUr8BJHi5uWToaehqXWV5KeZV9oVWUL1BNwsvnsY3aLSh9wpuLKaihbPAUmPN8eu6RmbG6szqu3M4Rh4gQruSaK5gBm39Fx7FWnTuHH1Fjee3d2k5NuQYsTLW8JBbm',
  feeAtomic: 1000000n,
  lastReference: '4Y71jXwWnrCyC8mcEQE5n7o3d65iBf3w6c9MqdfwuGQHzu7XM1mWrJbRvtaoSjaHmKueeEXGwutyLZePwGXuNK2w',
  recipient: 'QT4zHex8JEULmBhYmKd5UhpiNA46T5wUko',
  senderPublicKey: 'FNoQheiUBkwbsTeVYT3A7RCAbFSQq6XdokEGv5JXi7uM',
  timestamp: 1783444426299,
};

assert.equal(formatQortAtomic(1000000n), '0.01');
assert.equal(qortDecimalToAtomic('1.00000000'), fixture.amountAtomic);
assert.equal(assertPositiveQortAmount(fixture.amountAtomic), fixture.amountAtomic);
assert.equal(assertValidQortalAddress(fixture.recipient), fixture.recipient);
assert.throws(
  () => assertValidQortalAddress('QT4zHex8JEULmBhYmKd5UhpiNA46T5wUkn'),
  /invalid checksum/i,
);

const unsignedBytes = buildUnsignedPaymentTransactionBytes(fixture);

assert.equal(unsignedBytes.length, 153);
assert.equal(base58Encode(unsignedBytes), fixture.expectedUnsignedBase58);

console.log('Qortal PAYMENT serializer fixture passed.');
