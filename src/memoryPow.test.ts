// Self-test for the independent memory-pow port (0BSD).
//
// Run with: `npx tsx src/memoryPow.test.ts` (tsx) or any TS runner, or compile
// and run the emitted JS. The repo has no unit-test runner wired up, so this is a
// standalone runnable assertion file (exits non-zero on failure).
//
// This file does three things:
//   1. DIFFERENTIAL: runs the new optimized 32-bit implementation against a
//      verbatim copy of the previous BigInt reference (recovered from git) over
//      many random 32-byte seeds at several difficulties, using a small work
//      buffer so the sweep is fast, asserting bit-identical results.
//   2. KNOWN-ANSWER: asserts the Qortium Core MemoryPoWTests vectors at the
//      production 8 MiB buffer (TEST_DATA -> nonce 326 at difficulty 8, the
//      verify2 fixtures, and the diff-8 nonce-325 negative).
//   3. BENCHMARK: times finding nonce 326 (TEST_DATA, diff 8, 8 MiB) for both the
//      reference and the optimized impl and prints the speedup.
//
// Vectors come from Qortium Core's MemoryPoWTests. TEST_DATA = {0xAA,0xBB,0xCC}
// hashed with a single round of SHA-256; the resulting 32-byte hash is the seed.

import { createHash } from 'node:crypto';

import { compute2, verify2, POW_BUFFER_WORDS } from './memoryPow';

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERT FAILED: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Reference implementation: a verbatim copy of the previous BigInt memoryPow.ts
// (`git show HEAD:src/memoryPow.ts`). Kept here ONLY as a differential oracle.
// It is parameterized by buffer-word count so the differential sweep can use a
// tiny buffer; the production path uses the 8 MiB default.
// ---------------------------------------------------------------------------

const REF_BOUNCE_ITERATIONS = 1024;
const REF_SEED_INITIAL = 8682522807148012n;
const REF_SEED_MULTIPLIER = 1181783497276652981n;
const REF_MASK_64 = 0xffffffffffffffffn;
const REF_LOW_31_MASK = 0x7fffffffn;

function refMask64(value: bigint): bigint {
  return value & REF_MASK_64;
}

function refRotl64(value: bigint, bits: bigint): bigint {
  const v = value & REF_MASK_64;
  return refMask64((v << bits) | (v >> (64n - bits)));
}

function refHashToLanes(seedHash32: Uint8Array): [bigint, bigint, bigint, bigint] {
  if (seedHash32.length !== 32) {
    throw new Error('memory-pow seed hash must be exactly 32 bytes.');
  }

  const lanes: bigint[] = [];

  for (let lane = 0; lane < 4; lane += 1) {
    let value = 0n;

    for (let byteIndex = 0; byteIndex < 8; byteIndex += 1) {
      value = (value << 8n) | BigInt(seedHash32[lane * 8 + byteIndex]);
    }

    lanes.push(value & REF_MASK_64);
  }

  return [lanes[0], lanes[1], lanes[2], lanes[3]];
}

function refXoshiro256p(state: BigUint64Array): bigint {
  const result = refMask64(state[0] + state[3]);

  const temp = refMask64(state[1] << 17n);

  state[2] = refMask64(state[2] ^ state[0]);
  state[3] = refMask64(state[3] ^ state[1]);
  state[1] = refMask64(state[1] ^ state[2]);
  state[0] = refMask64(state[0] ^ state[3]);
  state[2] = refMask64(state[2] ^ temp);
  state[3] = refRotl64(state[3], 45n);

  return result;
}

function refCountLeadingZeros64(value: bigint): number {
  if (value === 0n) {
    return 64;
  }

  let bitLength = 0;
  let remaining = value & REF_MASK_64;

  while (remaining > 0n) {
    remaining >>= 1n;
    bitLength += 1;
  }

  return 64 - bitLength;
}

function refRunForNonce(
  lanes: readonly [bigint, bigint, bigint, bigint],
  nonceSeed: bigint,
  workBuffer: BigUint64Array,
  state: BigUint64Array,
  bufferWords: number,
): bigint {
  state[0] = refMask64(lanes[0] ^ nonceSeed);
  state[1] = refMask64(lanes[1] ^ nonceSeed);
  state[2] = refMask64(lanes[2] ^ nonceSeed);
  state[3] = refMask64(lanes[3] ^ nonceSeed);

  for (let index = 0; index < bufferWords; index += 1) {
    workBuffer[index] = refXoshiro256p(state);
  }

  let result = workBuffer[0];

  for (let bounce = 0; bounce < REF_BOUNCE_ITERATIONS; bounce += 1) {
    const random = refXoshiro256p(state);
    const index = Number((random & REF_LOW_31_MASK) % BigInt(bufferWords));
    result = refMask64(result ^ workBuffer[index]);
  }

  return result;
}

function refAdvanceSeed(seed: bigint): bigint {
  return refMask64(seed * REF_SEED_MULTIPLIER);
}

function refSeedForNonce(nonce: number): bigint {
  let seed = REF_SEED_INITIAL;

  for (let i = 0; i <= nonce; i += 1) {
    seed = refAdvanceSeed(seed);
  }

  return seed;
}

function refCompute2(seedHash32: Uint8Array, difficulty: number, bufferWords: number): number {
  const lanes = refHashToLanes(seedHash32);
  const workBuffer = new BigUint64Array(bufferWords);
  const state = new BigUint64Array(4);

  let seed = REF_SEED_INITIAL;
  let nonce = 0;

  for (;;) {
    seed = refAdvanceSeed(seed);
    const result = refRunForNonce(lanes, seed, workBuffer, state, bufferWords);

    if (refCountLeadingZeros64(result) >= difficulty) {
      return nonce;
    }

    nonce += 1;
  }
}

function refVerify2(
  seedHash32: Uint8Array,
  difficulty: number,
  nonce: number,
  bufferWords: number,
): boolean {
  const lanes = refHashToLanes(seedHash32);
  const workBuffer = new BigUint64Array(bufferWords);
  const state = new BigUint64Array(4);

  const seed = refSeedForNonce(nonce);
  const result = refRunForNonce(lanes, seed, workBuffer, state, bufferWords);

  return refCountLeadingZeros64(result) >= difficulty;
}

// ---------------------------------------------------------------------------
// 1. DIFFERENTIAL sweep: new vs reference over random seeds, small buffer.
// ---------------------------------------------------------------------------

// Tiny deterministic PRNG (xorshift32) so the sweep is reproducible.
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

function randomSeedHash(rng: () => number): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = rng() & 0xff;
  }
  return out;
}

const DIFF_BUFFER_WORDS = 8192; // 64 KiB fast buffer for the differential sweep.
const rng = makeRng(0x1234abcd);

let diffChecks = 0;

for (let trial = 0; trial < 64; trial += 1) {
  const seed = randomSeedHash(rng);

  // compute2 agreement across a few low difficulties (cheap to find a nonce).
  for (const difficulty of [0, 1, 2, 4, 6]) {
    const got = compute2(seed, difficulty, DIFF_BUFFER_WORDS);
    const want = refCompute2(seed, difficulty, DIFF_BUFFER_WORDS);
    assert(
      got === want,
      `differential compute2 mismatch (trial ${trial}, diff ${difficulty}): new ${got} vs ref ${want}`,
    );
    diffChecks += 1;

    // verify2 must agree at the found nonce, the nonce-1 (if any), and a higher
    // difficulty for the same nonce.
    const nonces = got > 0 ? [got - 1, got, got + 3] : [got, got + 3];
    for (const nonce of nonces) {
      for (const checkDiff of [difficulty, difficulty + 2, difficulty + 8]) {
        const gv = verify2(seed, checkDiff, nonce, DIFF_BUFFER_WORDS);
        const rv = refVerify2(seed, checkDiff, nonce, DIFF_BUFFER_WORDS);
        assert(
          gv === rv,
          `differential verify2 mismatch (trial ${trial}, diff ${checkDiff}, nonce ${nonce}): new ${gv} vs ref ${rv}`,
        );
        diffChecks += 1;
      }
    }
  }
}

console.log(`differential sweep: ${diffChecks} new-vs-reference checks all matched.`);

// ---------------------------------------------------------------------------
// 2. KNOWN-ANSWER vectors at the production 8 MiB work buffer.
// ---------------------------------------------------------------------------

assert(POW_BUFFER_WORDS === 1048576, `POW_BUFFER_WORDS expected 1048576, got ${POW_BUFFER_WORDS}`);

const TEST_DATA = new Uint8Array([0xaa, 0xbb, 0xcc]);
const seedHash = sha256(TEST_DATA);

const computed = compute2(seedHash, 8);
assert(computed === 326, `compute2(difficulty 8) expected 326, got ${computed}`);
assert(verify2(seedHash, 8, computed), 'verify2 should accept the freshly computed nonce');

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

assert(!verify2(seedHash, 8, 325), 'verify2(difficulty 8, nonce 325) should be false');

console.log('known-answer (8 MiB): compute2/verify2 match Core vectors.');

// ---------------------------------------------------------------------------
// 3. BENCHMARK: time finding nonce 326 (TEST_DATA, diff 8, 8 MiB) for both impls.
// ---------------------------------------------------------------------------

const optStart = process.hrtime.bigint();
const optNonce = compute2(seedHash, 8);
const optEnd = process.hrtime.bigint();
const optMs = Number(optEnd - optStart) / 1e6;
assert(optNonce === 326, `benchmark optimized compute2 expected 326, got ${optNonce}`);

const refBuf = POW_BUFFER_WORDS;
const refStart = process.hrtime.bigint();
const refNonce = refCompute2(seedHash, 8, refBuf);
const refEnd = process.hrtime.bigint();
const refMs = Number(refEnd - refStart) / 1e6;
assert(refNonce === 326, `benchmark reference compute2 expected 326, got ${refNonce}`);

const speedup = refMs / optMs;
console.log(
  `benchmark (find nonce 326, diff 8, 8 MiB): reference BigInt ${refMs.toFixed(0)} ms, ` +
    `optimized ${optMs.toFixed(0)} ms, speedup ${speedup.toFixed(1)}x.`,
);

// eslint-disable-next-line no-console
console.log('memoryPow self-test passed: differential + Core known-answer vectors.');
