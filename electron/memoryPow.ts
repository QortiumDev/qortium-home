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
//
// Performance: the memory-hard fill + bounce hot loop is implemented entirely in
// 32-bit integer arithmetic over an interleaved Uint32Array (each 64-bit word is
// stored as two 32-bit halves, hi then lo). No BigInt is used in the hot path;
// BigInt is used only for the once-per-candidate 64x64 mod-2^64 seed multiply,
// whose cost is negligible against the 1,048,576-word fill. This is bit-identical
// to the previous BigInt port (see memoryPow.test.ts differential vectors).

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
const MASK_32 = 0xffffffffn;

// Persistent interleaved work buffers, keyed by word count, reused across calls
// to avoid reallocating 8 MiB per attempt. Layout: buf[2*i] = word i high half,
// buf[2*i + 1] = word i low half. Indexing logical hi/lo slots ourselves means
// the typed-array byte endianness is irrelevant.
const workBuffers = new Map<number, Uint32Array>();

function getWorkBuffer(bufferWords: number): Uint32Array {
  let buffer = workBuffers.get(bufferWords);

  if (buffer === undefined) {
    buffer = new Uint32Array(bufferWords * 2);
    workBuffers.set(bufferWords, buffer);
  }

  return buffer;
}

// Reads the four big-endian 64-bit lanes from the 32-byte hash into hi/lo halves.
// lane_i.hi = bytes[8i + 0..3] (MSB first); lane_i.lo = bytes[8i + 4..7]. Output
// is an 8-slot array [l0hi, l0lo, l1hi, l1lo, l2hi, l2lo, l3hi, l3lo], unsigned.
function hashToLanes(seedHash32: Uint8Array): number[] {
  if (seedHash32.length !== 32) {
    throw new Error('memory-pow seed hash must be exactly 32 bytes.');
  }

  const lanes: number[] = new Array<number>(8);

  for (let lane = 0; lane < 4; lane += 1) {
    const base = lane * 8;

    const hi =
      ((seedHash32[base] << 24) |
        (seedHash32[base + 1] << 16) |
        (seedHash32[base + 2] << 8) |
        seedHash32[base + 3]) >>>
      0;
    const lo =
      ((seedHash32[base + 4] << 24) |
        (seedHash32[base + 5] << 16) |
        (seedHash32[base + 6] << 8) |
        seedHash32[base + 7]) >>>
      0;

    lanes[lane * 2] = hi;
    lanes[lane * 2 + 1] = lo;
  }

  return lanes;
}

function countLeadingZeros64(hi: number, lo: number): number {
  if (hi !== 0) {
    return Math.clz32(hi);
  }

  if (lo !== 0) {
    return 32 + Math.clz32(lo);
  }

  return 64;
}

// Runs the buffer-fill + bounce-accumulate for a single nonce candidate and
// returns the resulting 64-bit value as [hi, lo] (unsigned). The xoshiro state
// is kept in 8 plain-number locals so V8 can keep it in registers; no allocation
// and no BigInt occur in this hot path.
function runForNonce(
  lanes: readonly number[],
  seedHi: number,
  seedLo: number,
  buf: Uint32Array,
  bufferWords: number,
): { hi: number; lo: number } {
  // XOR the same per-nonce seed into all four lanes (non-standard seeding,
  // reproduced verbatim from Core).
  let s0h = (lanes[0] ^ seedHi) >>> 0;
  let s0l = (lanes[1] ^ seedLo) >>> 0;
  let s1h = (lanes[2] ^ seedHi) >>> 0;
  let s1l = (lanes[3] ^ seedLo) >>> 0;
  let s2h = (lanes[4] ^ seedHi) >>> 0;
  let s2l = (lanes[5] ^ seedLo) >>> 0;
  let s3h = (lanes[6] ^ seedHi) >>> 0;
  let s3l = (lanes[7] ^ seedLo) >>> 0;

  // Fill loop: store each xoshiro256+ output into the interleaved buffer.
  for (let i = 0; i < bufferWords; i += 1) {
    // 1) output = s0 + s3 (captured BEFORE the state update).
    const outLo = (s0l + s3l) >>> 0;
    const carry = outLo < s0l ? 1 : 0;
    const outHi = (s0h + s3h + carry) >>> 0;

    const base = i * 2;
    buf[base] = outHi;
    buf[base + 1] = outLo;

    // 2) temp = s1 << 17 (17 < 32, no half swap).
    const tHi = ((s1h << 17) | (s1l >>> 15)) >>> 0;
    const tLo = (s1l << 17) >>> 0;

    // 3..8) state update in Core's exact order.
    s2h = (s2h ^ s0h) >>> 0;
    s2l = (s2l ^ s0l) >>> 0;
    s3h = (s3h ^ s1h) >>> 0;
    s3l = (s3l ^ s1l) >>> 0;
    s1h = (s1h ^ s2h) >>> 0;
    s1l = (s1l ^ s2l) >>> 0;
    s0h = (s0h ^ s3h) >>> 0;
    s0l = (s0l ^ s3l) >>> 0;
    s2h = (s2h ^ tHi) >>> 0;
    s2l = (s2l ^ tLo) >>> 0;

    // s3 = rotl64(s3, 45) = rotl13 of the half-swapped value (45 = 32 + 13).
    const newS3h = ((s3l << 13) | (s3h >>> 19)) >>> 0;
    const newS3l = ((s3h << 13) | (s3l >>> 19)) >>> 0;
    s3h = newS3h;
    s3l = newS3l;
  }

  let resHi = buf[0];
  let resLo = buf[1];

  // Bounce loop: only the low word of each output feeds the index; the index
  // result word is XORed into the accumulator.
  for (let bounce = 0; bounce < BOUNCE_ITERATIONS; bounce += 1) {
    const rLo = (s0l + s3l) >>> 0;

    // Advance the state (output hi is unused here, so we skip its add-carry).
    const tHi = ((s1h << 17) | (s1l >>> 15)) >>> 0;
    const tLo = (s1l << 17) >>> 0;

    s2h = (s2h ^ s0h) >>> 0;
    s2l = (s2l ^ s0l) >>> 0;
    s3h = (s3h ^ s1h) >>> 0;
    s3l = (s3l ^ s1l) >>> 0;
    s1h = (s1h ^ s2h) >>> 0;
    s1l = (s1l ^ s2l) >>> 0;
    s0h = (s0h ^ s3h) >>> 0;
    s0l = (s0l ^ s3l) >>> 0;
    s2h = (s2h ^ tHi) >>> 0;
    s2l = (s2l ^ tLo) >>> 0;

    const newS3h = ((s3l << 13) | (s3h >>> 19)) >>> 0;
    const newS3l = ((s3h << 13) | (s3l >>> 19)) >>> 0;
    s3h = newS3h;
    s3l = newS3l;

    const index = (rLo & 0x7fffffff) % bufferWords;
    const base = index * 2;
    resHi = (resHi ^ buf[base]) >>> 0;
    resLo = (resLo ^ buf[base + 1]) >>> 0;
  }

  return { hi: resHi, lo: resLo };
}

// Advances the closed-form per-nonce seed: seed_N = SEED_INITIAL * MULTIPLIER^(N+1).
// compute2 advances once before testing each candidate (so nonce 0 is multiplied
// once); verify2 multiplies nonce+1 times. We model the same incremental walk.
// BigInt guarantees a bit-exact mod-2^64 multiply; it runs once per ~1M-op
// candidate, so its cost is invisible.
function advanceSeed(seed: bigint): bigint {
  return (seed * SEED_MULTIPLIER) & MASK_64;
}

function seedForNonce(nonce: number): bigint {
  let seed = SEED_INITIAL;

  for (let i = 0; i <= nonce; i += 1) {
    seed = advanceSeed(seed);
  }

  return seed;
}

function seedHalves(seed: bigint): { hi: number; lo: number } {
  return {
    hi: Number((seed >> 32n) & MASK_32) >>> 0,
    lo: Number(seed & MASK_32) >>> 0,
  };
}

/**
 * Searches for the first nonce whose memory-pow result has at least `difficulty`
 * leading zero bits. Mirrors Core's compute2: nonce starts at 0 and the seed is
 * advanced once per candidate (including nonce 0).
 *
 * `bufferWords` overrides the work-buffer size and is intended ONLY for fast
 * differential/known-answer testing; production callers omit it (8 MiB default).
 */
export function compute2(
  seedHash32: Uint8Array,
  difficulty: number,
  bufferWords: number = WORK_BUFFER_WORDS,
): number {
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 64) {
    throw new Error('memory-pow difficulty must be an integer in [0, 64].');
  }

  const lanes = hashToLanes(seedHash32);
  const buf = getWorkBuffer(bufferWords);

  let seed = SEED_INITIAL;
  let nonce = 0;

  for (;;) {
    seed = advanceSeed(seed);
    const { hi: seedHi, lo: seedLo } = seedHalves(seed);
    const { hi, lo } = runForNonce(lanes, seedHi, seedLo, buf, bufferWords);

    if (countLeadingZeros64(hi, lo) >= difficulty) {
      return nonce;
    }

    nonce += 1;
  }
}

/**
 * Verifies that `nonce` satisfies `difficulty` for the given seed hash. Mirrors
 * Core's verify2 (seed advanced nonce+1 times).
 *
 * `bufferWords` overrides the work-buffer size and is intended ONLY for fast
 * differential/known-answer testing; production callers omit it (8 MiB default).
 */
export function verify2(
  seedHash32: Uint8Array,
  difficulty: number,
  nonce: number,
  bufferWords: number = WORK_BUFFER_WORDS,
): boolean {
  if (!Number.isInteger(nonce) || nonce < 0) {
    throw new Error('memory-pow nonce must be a non-negative integer.');
  }

  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 64) {
    throw new Error('memory-pow difficulty must be an integer in [0, 64].');
  }

  const lanes = hashToLanes(seedHash32);
  const buf = getWorkBuffer(bufferWords);

  const seed = seedForNonce(nonce);
  const { hi: seedHi, lo: seedLo } = seedHalves(seed);
  const { hi, lo } = runForNonce(lanes, seedHi, seedLo, buf, bufferWords);

  return countLeadingZeros64(hi, lo) >= difficulty;
}

// Exposed for callers that need the production CHAT difficulty default; the
// authoritative value lives in chain config (previewchain.json chatDifficulty).
export const POW_BUFFER_WORDS = WORK_BUFFER_WORDS;
