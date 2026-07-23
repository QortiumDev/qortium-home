// Guards the base58 codec both QDN bridges now share.
//
// The bridges used to carry a copy each, so a mistake here only ever broke one
// transport. Now a mistake here breaks signing on desktop and Android at once,
// which is worth an independent second opinion: every case below is checked
// against a BigInt reference implementation written a completely different way,
// and then round-tripped back to the original bytes.
import assert from 'node:assert/strict';
import {
  BASE58_ALPHABET,
  base58Decode,
  base58Encode,
  getSignedTransactionSignature,
} from './base58.js';

function referenceEncode(bytes: Uint8Array) {
  let value = 0n;

  for (const byte of bytes) {
    value = value * 256n + BigInt(byte);
  }

  let encoded = '';

  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }

  let leadingZeros = 0;

  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) {
    leadingZeros += 1;
  }

  return '1'.repeat(leadingZeros) + encoded;
}

function referenceDecode(encoded: string) {
  let value = 0n;

  for (const character of encoded) {
    const digit = BASE58_ALPHABET.indexOf(character);

    if (digit < 0) {
      throw new Error(`Base58 value contains an invalid character: ${character}`);
    }

    value = value * 58n + BigInt(digit);
  }

  const bytes: number[] = [];

  while (value > 0n) {
    bytes.unshift(Number(value % 256n));
    value /= 256n;
  }

  let leadingOnes = 0;

  while (leadingOnes < encoded.length && encoded[leadingOnes] === '1') {
    leadingOnes += 1;
  }

  return new Uint8Array([...new Array(leadingOnes).fill(0), ...bytes]);
}

// A fixed sequence, so a failure is reproducible rather than "sometimes red".
let seed = 0x2f6e2b1;

function nextByte() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;

  return (seed >> 16) & 0xff;
}

const buffers: Uint8Array[] = [new Uint8Array(0)];

for (let value = 0; value < 256; value += 1) {
  buffers.push(new Uint8Array([value]));
}

// Leading zero bytes are the part hand-written base58 usually gets wrong.
for (let zeros = 0; zeros <= 8; zeros += 1) {
  for (const tail of [[], [1], [0], [255], [1, 2, 3], [255, 255, 255, 255]]) {
    buffers.push(new Uint8Array([...new Array(zeros).fill(0), ...tail]));
  }
}

for (let length = 1; length <= 40; length += 1) {
  buffers.push(new Uint8Array(length));
  buffers.push(new Uint8Array(length).fill(255));
}

// 32 bytes is a public key, 64 a signature, 155 a payment transaction.
for (const length of [1, 2, 3, 7, 15, 16, 31, 32, 33, 63, 64, 65, 100, 155, 256, 1024]) {
  for (let repeat = 0; repeat < 20; repeat += 1) {
    const buffer = new Uint8Array(length);

    for (let index = 0; index < length; index += 1) {
      buffer[index] = nextByte();
    }

    buffers.push(buffer);

    const withLeadingZeros = new Uint8Array(buffer);

    for (let index = 0; index < Math.min(3, length); index += 1) {
      withLeadingZeros[index] = 0;
    }

    buffers.push(withLeadingZeros);
  }
}

for (const buffer of buffers) {
  const encoded = base58Encode(buffer);

  assert.equal(encoded, referenceEncode(buffer), `encode mismatch for [${buffer.join(',')}]`);
  assert.deepEqual(
    Array.from(base58Decode(encoded)),
    Array.from(buffer),
    `round trip lost bytes for [${buffer.join(',')}]`,
  );
  assert.deepEqual(
    Array.from(base58Decode(encoded)),
    Array.from(referenceDecode(encoded)),
    `decode mismatch for ${encoded}`,
  );
}

assert.equal(base58Encode(new Uint8Array(0)), '');
assert.deepEqual(Array.from(base58Decode('')), []);
assert.equal(base58Encode(new Uint8Array([0])), '1');
assert.deepEqual(Array.from(base58Decode('1')), [0]);
assert.deepEqual(Array.from(base58Decode('111')), [0, 0, 0]);
assert.equal(base58Encode(new Uint8Array([0, 0, 1])), '112');

// Strings that never came out of the encoder still decode the same way.
for (const encoded of ['1', '11', '1111111111', 'z', 'zz', '1z', '11z', '2NEpo7TZRRrLZSi2U']) {
  assert.deepEqual(
    Array.from(base58Decode(encoded)),
    Array.from(referenceDecode(encoded)),
    `decode mismatch for '${encoded}'`,
  );
}

// The characters base58 deliberately leaves out, so a typo'd address is caught
// instead of silently decoding to different bytes.
for (const character of ['0', 'O', 'I', 'l', '+', '/', ' ']) {
  assert.throws(() => base58Decode(`2NEpo7${character}TZRR`), /invalid character/);
}

const signature = new Uint8Array(64);

for (let index = 0; index < signature.length; index += 1) {
  signature[index] = nextByte();
}

const signedTransaction = new Uint8Array([...new Array(91).fill(7), ...signature]);

assert.equal(
  getSignedTransactionSignature(base58Encode(signedTransaction)),
  base58Encode(signature),
  'signature is the trailing 64 bytes',
);
assert.equal(
  getSignedTransactionSignature(base58Encode(signature)),
  base58Encode(signature),
  'a bare signature is its own signature',
);

for (const tooShort of [new Uint8Array(0), new Uint8Array(1), new Uint8Array(63)]) {
  assert.throws(
    () => getSignedTransactionSignature(base58Encode(tooShort)),
    /did not contain a signature/,
  );
}

console.log(`base58 codec checks passed (${buffers.length} buffers round-tripped).`);
