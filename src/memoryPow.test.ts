// Self-test / known-answer check for the independent memory-pow port (0BSD).
//
// Run with: `node --import tsx src/memoryPow.test.ts` (tsx) or any TS runner,
// or compile and run the emitted JS. The repo has no unit-test runner wired up,
// so this is a standalone runnable assertion file (exits non-zero on failure).
//
// Vectors come from Qortium Core's MemoryPoWTests with the production 8 MiB
// work buffer (FULL_WORK_BUFFER_LENGTH). TEST_DATA = {0xAA,0xBB,0xCC} hashed
// with a single round of SHA-256; the resulting 32-byte hash is the seed.

import { createHash } from 'node:crypto';

import { compute2, verify2 } from './memoryPow';

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERT FAILED: ${message}`);
  }
}

const TEST_DATA = new Uint8Array([0xaa, 0xbb, 0xcc]);
const seedHash = sha256(TEST_DATA);

// 1. Compute the difficulty-8 nonce and check it matches the Core known answer.
const computed = compute2(seedHash, 8);
assert(computed === 326, `compute2(difficulty 8) expected 326, got ${computed}`);
assert(verify2(seedHash, 8, computed), 'verify2 should accept the freshly computed nonce');

// 2. Verify-only fixtures from Core (difficulty -> nonce), full work buffer.
const verifyFixtures: Array<[number, number]> = [
  [8, 326],
  [9, 326],
  [10, 643],
  [11, 1671],
  [12, 9059],
  [13, 9059],
  [14, 11032],
];

for (const [difficulty, nonce] of verifyFixtures) {
  assert(
    verify2(seedHash, difficulty, nonce),
    `verify2(difficulty ${difficulty}, nonce ${nonce}) should be true`,
  );
}

// 3. A nonce one below a known answer must NOT satisfy that difficulty (sanity).
assert(!verify2(seedHash, 8, 325), 'verify2(difficulty 8, nonce 325) should be false');

// 4. Round-trip at a low difficulty (cheap independent check).
const lowSeed = sha256(new Uint8Array([1, 2, 3, 4]));
const lowNonce = compute2(lowSeed, 4);
assert(verify2(lowSeed, 4, lowNonce), 'low-difficulty round trip should verify');

// eslint-disable-next-line no-console
console.log('memoryPow self-test passed: compute2/verify2 match Core vectors.');
