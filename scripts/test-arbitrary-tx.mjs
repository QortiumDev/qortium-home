import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { arbitraryRawToSigningBytes } from '../dist-electron/arbitrary-tx.js';
import { base58Decode, base58Encode } from '../dist-electron/qortal-payment.js';

const textEncoder = new TextEncoder();
const fixtureUrl = new URL('../tests/fixtures/arbitrary-signing-vectors.json', import.meta.url);

function concatBytes(...chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return bytes;
}

function int32(value) {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, value, false);

  return bytes;
}

function int64(value) {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setBigInt64(0, value, false);

  return bytes;
}

function sizedString(value) {
  if (!value) {
    return int32(0);
  }

  const stringBytes = textEncoder.encode(value);

  return concatBytes(int32(stringBytes.length), stringBytes);
}

function lengthPrefixed(data) {
  const bytes = data ?? new Uint8Array(0);

  return concatBytes(int32(bytes.length), bytes);
}

function sequence(length, start) {
  const bytes = new Uint8Array(length);

  for (let index = 0; index < length; index += 1) {
    bytes[index] = (start + index) & 0xff;
  }

  return bytes;
}

function sha256(data) {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

function paymentBytes() {
  return concatBytes(
    sequence(25, 0x30),
    int64(7n),
    int64(123456789n),
  );
}

function commonChunks(input) {
  const payments = input.payments ?? [];

  return [
    int32(input.transactionType ?? 10),
    int64(input.timestamp ?? 1700000000123n),
    int32(input.groupId ?? 0),
    sequence(32, 0x01),
    int32(input.nonce ?? 0),
    sizedString(input.name ?? 'test-name'),
    sizedString(input.identifier),
    int32(input.method ?? 0),
    lengthPrefixed(input.secret),
    int32(input.compression ?? 0),
    int32(payments.length),
    ...payments,
    int32(input.service ?? 1),
  ];
}

function rawArbitraryBytes(input) {
  return concatBytes(
    ...commonChunks(input),
    new Uint8Array([input.dataType === 'rawData' ? 1 : 0]),
    int32(input.data.length),
    input.data,
    int32(input.size ?? input.data.length),
    lengthPrefixed(input.metadataHash),
    int64(input.fee ?? 0n),
  );
}

function signingArbitraryBytes(input) {
  return concatBytes(
    ...commonChunks(input),
    int32(input.data.length),
    input.dataType === 'rawData' ? sha256(input.data) : input.data,
    int32(input.size ?? input.data.length),
    lengthPrefixed(input.metadataHash),
    int64(input.fee ?? 0n),
  );
}

function assertBytesEqual(actual, expected, message) {
  assert.equal(base58Encode(actual), base58Encode(expected), message);
  assert.deepEqual(actual, expected, message);
}

const dataHashInput = {
  data: sequence(32, 0x70),
  dataType: 'dataHash',
  identifier: null,
  metadataHash: undefined,
  name: 'hash-name',
  payments: [],
  secret: undefined,
  size: 4096,
};

assertBytesEqual(
  arbitraryRawToSigningBytes(rawArbitraryBytes(dataHashInput)),
  signingArbitraryBytes(dataHashInput),
  'DATA_HASH ARBITRARY signing bytes should drop only the raw dataType flag.',
);

const rawDataInput = {
  compression: 1,
  data: new Uint8Array([1, 2, 3, 4, 5, 6]),
  dataType: 'rawData',
  fee: 0n,
  identifier: 'site-index',
  metadataHash: sequence(32, 0xc0),
  method: 1,
  name: 'raw-name',
  payments: [paymentBytes()],
  secret: sequence(32, 0x80),
  service: 20,
  size: 12345,
};
const rawDataRawBytes = rawArbitraryBytes(rawDataInput);
const rawDataSigningBytes = arbitraryRawToSigningBytes(rawDataRawBytes);

assertBytesEqual(
  rawDataSigningBytes,
  signingArbitraryBytes(rawDataInput),
  'RAW_DATA ARBITRARY signing bytes should replace data with SHA-256 digest.',
);
assert.equal(
  rawDataSigningBytes.length,
  rawDataRawBytes.length - 1 - rawDataInput.data.length + 32,
  'RAW_DATA signing length should preserve dataLength but replace payload bytes with a 32-byte digest.',
);

assert.throws(
  () => arbitraryRawToSigningBytes(rawArbitraryBytes({
    data: sequence(32, 0x20),
    dataType: 'dataHash',
    transactionType: 2,
  })),
  /Expected ARBITRARY transaction type 10/,
);

const truncatedRawBytes = rawArbitraryBytes({
  data: sequence(32, 0x20),
  dataType: 'dataHash',
});

assert.throws(
  () => arbitraryRawToSigningBytes(truncatedRawBytes.slice(0, -1)),
  /truncated/,
);

const fixtures = JSON.parse(readFileSync(fixtureUrl, 'utf8'));
let checkedFixtures = 0;
let skippedFixtures = 0;

for (const fixture of fixtures) {
  const name = typeof fixture.name === 'string' && fixture.name ? fixture.name : 'unnamed ARBITRARY fixture';

  if (fixture.placeholder) {
    skippedFixtures += 1;
    console.log(`Skipping placeholder ARBITRARY fixture: ${name}`);
    continue;
  }

  assert.equal(typeof fixture.rawUnsignedBase58, 'string', `${name}: rawUnsignedBase58 is required.`);
  assert.equal(typeof fixture.expectedSigningBase58, 'string', `${name}: expectedSigningBase58 is required.`);

  const signingBytes = arbitraryRawToSigningBytes(base58Decode(fixture.rawUnsignedBase58));

  assert.equal(
    base58Encode(signingBytes),
    fixture.expectedSigningBase58,
    `${name}: transformed signing bytes should match Core.`,
  );
  checkedFixtures += 1;
}

console.log(
  `ARBITRARY transaction signing transform tests passed. Structural cases passed; Core fixtures checked: ${checkedFixtures}; skipped placeholders: ${skippedFixtures}.`,
);
