// Independent 0BSD implementation of the Qortium CHAT memory-pow algorithm for
// interoperability. It reproduces the behaviour of Qortium Core's MemoryPoW
// (compute2 / verify2) so a fully signed CHAT transaction built and stamped on
// the client is accepted by the network. Written from a functional spec; the
// xoshiro256+ generator is public domain. No GPL source was consulted.
//
// This file is an intentional DUPLICATE of src/memoryPow.ts. The Electron build
// (electron/tsconfig.json) sets rootDir "." and cannot import from ../src
// without breaking the rootDir/outDir contract, so the tiny pure core is copied
// here per the wiring plan. Keep the two copies in sync; both are validated
// against Core's known-answer vectors.
//
// The function is pure: it takes the 32-byte SHA-256 seed hash (the caller is
// responsible for hashing the nonce-zeroed signing bytes) and a difficulty, so
// it runs unchanged in any JS runtime (browser worker, Node worker_thread).

// Work buffer is 8 MiB = 1,048,576 64-bit words. This is the memory-hard step
// and matches Qortium Core's POW_BUFFER_SIZE.
const WORK_BUFFER_BYTES = 8 * 1024 * 1024;
const WORK_BUFFER_WORDS = WORK_BUFFER_BYTES / 8; // 1048576

// Number of random "bounce" reads accumulated after the buffer is filled.
const BOUNCE_ITERATIONS = 1024;

// Fixed seeding constants (not copyrightable). The multiplier is the
// SplitMix/xoshiro mixing constant 0x106689D45497FDB5.
const SEED_INITIAL = 8682522807148012n;
const SEED_MULTIPLIER = 1181783497276652981n;

const MASK_64 = 0xffffffffffffffffn;
const LOW_31_MASK = 0x7fffffffn;

function mask64(value: bigint): bigint {
  return value & MASK_64;
}

function rotl64(value: bigint, bits: bigint): bigint {
  const v = value & MASK_64;
  return mask64((v << bits) | (v >> (64n - bits)));
}

// Reads the four big-endian 64-bit lanes from the 32-byte hash. We keep them as
// unsigned 64-bit BigInts; all arithmetic is mod 2^64 so the signed/unsigned
// distinction does not affect results.
function hashToLanes(seedHash32: Uint8Array): [bigint, bigint, bigint, bigint] {
  if (seedHash32.length !== 32) {
    throw new Error('memory-pow seed hash must be exactly 32 bytes.');
  }

  const lanes: bigint[] = [];

  for (let lane = 0; lane < 4; lane += 1) {
    let value = 0n;

    for (let byteIndex = 0; byteIndex < 8; byteIndex += 1) {
      value = (value << 8n) | BigInt(seedHash32[lane * 8 + byteIndex]);
    }

    lanes.push(value & MASK_64);
  }

  return [lanes[0], lanes[1], lanes[2], lanes[3]];
}

// xoshiro256+ next output. Mutates the 4-lane state in place and returns the
// 64-bit (s0 + s3) sum.
function xoshiro256p(state: BigUint64Array): bigint {
  const result = mask64(state[0] + state[3]);

  const temp = mask64(state[1] << 17n);

  state[2] = mask64(state[2] ^ state[0]);
  state[3] = mask64(state[3] ^ state[1]);
  state[1] = mask64(state[1] ^ state[2]);
  state[0] = mask64(state[0] ^ state[3]);
  state[2] = mask64(state[2] ^ temp);
  state[3] = rotl64(state[3], 45n);

  return result;
}

function countLeadingZeros64(value: bigint): number {
  if (value === 0n) {
    return 64;
  }

  let bitLength = 0;
  let remaining = value & MASK_64;

  while (remaining > 0n) {
    remaining >>= 1n;
    bitLength += 1;
  }

  return 64 - bitLength;
}

// Runs the buffer-fill + bounce-accumulate for a single nonce candidate and
// returns the resulting 64-bit value (unsigned). The work buffer is reused
// across calls to avoid reallocating 8 MiB per attempt.
function runForNonce(
  lanes: readonly [bigint, bigint, bigint, bigint],
  nonceSeed: bigint,
  workBuffer: BigUint64Array,
  state: BigUint64Array,
): bigint {
  // XOR the same per-nonce seed into all four lanes (non-standard seeding,
  // reproduced verbatim from Core).
  state[0] = mask64(lanes[0] ^ nonceSeed);
  state[1] = mask64(lanes[1] ^ nonceSeed);
  state[2] = mask64(lanes[2] ^ nonceSeed);
  state[3] = mask64(lanes[3] ^ nonceSeed);

  for (let index = 0; index < WORK_BUFFER_WORDS; index += 1) {
    workBuffer[index] = xoshiro256p(state);
  }

  let result = workBuffer[0];

  for (let bounce = 0; bounce < BOUNCE_ITERATIONS; bounce += 1) {
    const random = xoshiro256p(state);
    const index = Number((random & LOW_31_MASK) % BigInt(WORK_BUFFER_WORDS));
    result = mask64(result ^ workBuffer[index]);
  }

  return result;
}

// Advances the closed-form per-nonce seed: seed_N = SEED_INITIAL * MULTIPLIER^(N+1).
// compute2 advances once before testing each candidate (so nonce 0 is multiplied
// once); verify2 multiplies nonce+1 times. We model the same incremental walk.
function advanceSeed(seed: bigint): bigint {
  return mask64(seed * SEED_MULTIPLIER);
}

function seedForNonce(nonce: number): bigint {
  let seed = SEED_INITIAL;

  for (let i = 0; i <= nonce; i += 1) {
    seed = advanceSeed(seed);
  }

  return seed;
}

/**
 * Searches for the first nonce whose memory-pow result has at least `difficulty`
 * leading zero bits. Mirrors Core's compute2: nonce starts at 0 and the seed is
 * advanced once per candidate (including nonce 0).
 */
export function compute2(seedHash32: Uint8Array, difficulty: number): number {
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 64) {
    throw new Error('memory-pow difficulty must be an integer in [0, 64].');
  }

  const lanes = hashToLanes(seedHash32);
  const workBuffer = new BigUint64Array(WORK_BUFFER_WORDS);
  const state = new BigUint64Array(4);

  let seed = SEED_INITIAL;
  let nonce = 0;

  for (;;) {
    seed = advanceSeed(seed);
    const result = runForNonce(lanes, seed, workBuffer, state);

    if (countLeadingZeros64(result) >= difficulty) {
      return nonce;
    }

    nonce += 1;
  }
}

/**
 * Verifies that `nonce` satisfies `difficulty` for the given seed hash. Mirrors
 * Core's verify2 (seed advanced nonce+1 times).
 */
export function verify2(seedHash32: Uint8Array, difficulty: number, nonce: number): boolean {
  if (!Number.isInteger(nonce) || nonce < 0) {
    throw new Error('memory-pow nonce must be a non-negative integer.');
  }

  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 64) {
    throw new Error('memory-pow difficulty must be an integer in [0, 64].');
  }

  const lanes = hashToLanes(seedHash32);
  const workBuffer = new BigUint64Array(WORK_BUFFER_WORDS);
  const state = new BigUint64Array(4);

  const seed = seedForNonce(nonce);
  const result = runForNonce(lanes, seed, workBuffer, state);

  return countLeadingZeros64(result) >= difficulty;
}

// Exposed for callers that need the production CHAT difficulty default; the
// authoritative value lives in chain config (previewchain.json chatDifficulty).
export const POW_BUFFER_WORDS = WORK_BUFFER_WORDS;
