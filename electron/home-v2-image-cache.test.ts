import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  buildHomeV2ImageCacheKey,
  createHomeV2ImageMemo,
  HomeV2ImageCache,
  HOME_V2_IMAGE_CACHE_NEGATIVE_TTL_MS,
  readImageThroughCache,
  type HomeV2ImageFetchOutcome,
} from './home-v2-image-cache.js'

// A valid Base58 signature for fixtures — real Qortal/Qortium signatures are
// Base58, and the store validates that on load.
const SIG = 'z2Ge4h7KcVpQ1nRstUvWxY'

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), 'home-v2-image-cache-'))
}

// Minimal, real magic-byte payloads the shared sniffer recognizes.
function pngBytes(size = 64) {
  const bytes = new Uint8Array(size)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return bytes
}
function gifBytes(size = 64) {
  const bytes = new Uint8Array(size)
  bytes.set([0x47, 0x49, 0x46, 0x38])
  return bytes
}

// --- put/get by signature, and survival across a "restart" (new instance) ---
{
  const dir = tempDir()
  try {
    const cache = new HomeV2ImageCache({ directory: dir })
    assert.equal(cache.get('appicon|Chat', 'sig1'), null, 'cold cache misses')

    const bytes = pngBytes()
    assert.equal(
      cache.putReady('appicon|Chat', 'sig1', bytes, 'image/png', 256 * 1024),
      true,
    )
    const hit = cache.get('appicon|Chat', 'sig1')
    assert.ok(hit && hit.kind === 'ready', 'warm signature hits')
    assert.equal(hit.contentType, 'image/png')
    assert.deepEqual(hit.bytes, bytes)

    // A different signature for the same key is a miss (stale), not a hit.
    assert.equal(cache.get('appicon|Chat', 'sig2'), null, 'changed signature misses')

    // A fresh instance re-reads index.json from disk — survives restart.
    const reopened = new HomeV2ImageCache({ directory: dir })
    const persisted = reopened.get('appicon|Chat', 'sig1')
    assert.ok(persisted && persisted.kind === 'ready', 'survives a restart')
    assert.deepEqual(persisted.bytes, bytes)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- LRU eviction at the byte cap (oldest storedAt evicted first) ---
{
  const dir = tempDir()
  try {
    let clock = 1_000
    const cache = new HomeV2ImageCache({
      directory: dir,
      maxTotalBytes: 200,
      now: () => (clock += 1_000),
    })
    // Three 80-byte entries; the cap holds two, so the oldest is evicted.
    assert.equal(cache.putReady('a', 'sa', pngBytes(80), 'image/png', 256 * 1024), true)
    assert.equal(cache.putReady('b', 'sb', pngBytes(80), 'image/png', 256 * 1024), true)
    assert.equal(cache.putReady('c', 'sc', pngBytes(80), 'image/png', 256 * 1024), true)

    assert.equal(cache.get('a', 'sa'), null, 'oldest entry was evicted')
    assert.ok(cache.get('b', 'sb'), 'newer entries survive')
    assert.ok(cache.get('c', 'sc'), 'newest entry survives')
    // The evicted entry's byte file is gone too, not just its index row.
    const files = readdirSync(dir).filter((name) => name !== 'index.json')
    assert.equal(files.length, 2, 'evicted byte file was deleted')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- negative cache: a signature with no image is a hit, not a miss ---
{
  const dir = tempDir()
  try {
    const cache = new HomeV2ImageCache({ directory: dir })
    assert.equal(cache.putMissing('appicon|NoIcon', 'sigx'), true)
    const hit = cache.get('appicon|NoIcon', 'sigx')
    assert.ok(hit && hit.kind === 'missing', 'negative cache hits for the same signature')
    assert.equal(cache.get('appicon|NoIcon', 'sigy'), null, 'a new signature retries')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- re-sniff on read rejects bytes that do not match the stored type ---
{
  const dir = tempDir()
  try {
    const cache = new HomeV2ImageCache({ directory: dir })
    // Store a genuine PNG, then tamper the file on disk with GIF bytes while the
    // index still claims image/png. A corrupt/tampered file must degrade to a
    // miss (never a spoofed type served back).
    cache.putReady('appicon|Tampered', 'sig1', pngBytes(), 'image/png', 256 * 1024)
    const byteFile = readdirSync(dir).find((name) => name !== 'index.json')
    assert.ok(byteFile)
    writeFileSync(path.join(dir, byteFile), Buffer.from(gifBytes()))

    const reopened = new HomeV2ImageCache({ directory: dir })
    assert.equal(reopened.get('appicon|Tampered', 'sig1'), null, 'mismatched bytes rejected')
    // The poisoned entry is dropped, so a later put can repopulate cleanly.
    assert.equal(reopened.get('appicon|Tampered', 'sig1'), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- a manually injected mismatched index entry is also rejected on read ---
{
  const dir = tempDir()
  try {
    mkdirSync(dir, { recursive: true })
    const cacheKey = 'appicon|Injected'
    const fileName = createHash('sha256').update(cacheKey).digest('hex')
    const bytes = gifBytes() // real GIF bytes...
    writeFileSync(path.join(dir, fileName), Buffer.from(bytes))
    // ...but the index lies and calls them image/png.
    writeFileSync(
      path.join(dir, 'index.json'),
      JSON.stringify([
        {
          cacheKey,
          contentType: 'image/png',
          byteLength: bytes.byteLength,
          signature: 'sig1',
          storedAt: 1,
          status: 'ready',
        },
      ]),
    )
    const cache = new HomeV2ImageCache({ directory: dir })
    assert.equal(cache.get(cacheKey, 'sig1'), null, 'injected type mismatch rejected')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- corrupt index.json is treated as an empty cache ---
{
  const dir = tempDir()
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'index.json'), '{ this is not valid json ]')
    const cache = new HomeV2ImageCache({ directory: dir })
    assert.equal(cache.get('anything', 'sig'), null, 'corrupt index → empty cache')
    // And the cache is still usable afterwards.
    assert.equal(cache.putReady('anything', 'sig', pngBytes(), 'image/png', 256 * 1024), true)
    assert.ok(cache.get('anything', 'sig'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- oversized entry rejected against the per-entry cap ---
{
  const dir = tempDir()
  try {
    const cache = new HomeV2ImageCache({ directory: dir })
    assert.equal(
      cache.putReady('big', 'sig', pngBytes(1024), 'image/png', 512),
      false,
      'entry above the per-entry cap is rejected',
    )
    assert.equal(cache.get('big', 'sig'), null)
    // A write whose declared type disagrees with its bytes is also rejected.
    assert.equal(
      cache.putReady('liar', 'sig', gifBytes(), 'image/png', 256 * 1024),
      false,
      'bytes that do not sniff to the declared type are rejected on write',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- read-through: a second read for the same signature does NOT fetch ---
{
  const dir = tempDir()
  try {
    const store = new HomeV2ImageCache({ directory: dir })
    let fetchCount = 0
    let signatureCount = 0
    const fetchImage = async (): Promise<HomeV2ImageFetchOutcome> => {
      fetchCount += 1
      return { kind: 'ready', bytes: pngBytes(), contentType: 'image/png' }
    }
    const resolveSignature = async () => {
      signatureCount += 1
      return 'sig1'
    }

    // Fresh memo each call proves the DISK store (not the memo) suppresses the
    // second fetch.
    const first = await readImageThroughCache({
      store,
      memo: createHomeV2ImageMemo(8),
      cacheKey: 'appicon|Chat',
      maxEntryBytes: 256 * 1024,
      revalidateFloorMs: 6 * 60 * 60 * 1000,
      resolveSignature,
      fetchImage,
    })
    assert.equal(first.kind, 'ready')
    const second = await readImageThroughCache({
      store,
      memo: createHomeV2ImageMemo(8),
      cacheKey: 'appicon|Chat',
      maxEntryBytes: 256 * 1024,
      revalidateFloorMs: 6 * 60 * 60 * 1000,
      resolveSignature,
      fetchImage,
    })
    assert.equal(second.kind, 'ready')
    assert.equal(fetchCount, 1, 'the warm disk store serves the second read')
    // 3 = first read resolves once, then re-resolves to PIN the fetched bytes to
    // the signature before caching; the second (warm) read resolves once more.
    assert.equal(signatureCount, 3, 'the signature is still checked on a cold memo')

    // The shared memo suppresses even the signature search within the floor.
    const memo = createHomeV2ImageMemo(8)
    const options = {
      store,
      memo,
      cacheKey: 'appicon|Chat',
      maxEntryBytes: 256 * 1024,
      revalidateFloorMs: 6 * 60 * 60 * 1000,
      resolveSignature,
      fetchImage,
    }
    signatureCount = 0
    await readImageThroughCache(options)
    await readImageThroughCache(options)
    assert.equal(signatureCount, 1, 'the memo floor caps how often the signature is checked')
    assert.equal(fetchCount, 1, 'still no extra fetch')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- read-through: a changed signature refetches ---
{
  const dir = tempDir()
  try {
    const store = new HomeV2ImageCache({ directory: dir })
    let fetchCount = 0
    let signature = 'sig1'
    const fetchImage = async (): Promise<HomeV2ImageFetchOutcome> => {
      fetchCount += 1
      return { kind: 'ready', bytes: pngBytes(fetchCount === 1 ? 64 : 96), contentType: 'image/png' }
    }
    const base = {
      store,
      cacheKey: 'avatar|Alice',
      maxEntryBytes: 500 * 1024,
      revalidateFloorMs: 6 * 60 * 60 * 1000,
      fetchImage,
    }
    await readImageThroughCache({ ...base, memo: createHomeV2ImageMemo(8), resolveSignature: async () => signature })
    signature = 'sig2' // a republish
    const after = await readImageThroughCache({
      ...base,
      memo: createHomeV2ImageMemo(8),
      resolveSignature: async () => signature,
    })
    assert.equal(fetchCount, 2, 'a new signature triggers a refetch')
    assert.ok(after.kind === 'ready' && after.bytes.byteLength === 96, 'the fresh bytes are served')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- read-through: a fetch failure after a NEWER signature is unavailable,
//     never the older on-disk bytes relabelled as fresh ---
{
  const dir = tempDir()
  try {
    const store = new HomeV2ImageCache({ directory: dir })
    const warm = pngBytes(48)
    store.putReady('avatar|Bob', 'sig1', warm, 'image/png', 500 * 1024)
    // The signature moved on (sig2), so the exact-signature lookup misses; the
    // fetch then fails. The on-disk bytes are for the OLDER sig1, so serving
    // them as a fresh `ready` would report known-stale content as current.
    // Report unavailable instead — the renderer keeps its own last-good copy.
    const outcome = await readImageThroughCache({
      store,
      memo: createHomeV2ImageMemo(8),
      cacheKey: 'avatar|Bob',
      maxEntryBytes: 500 * 1024,
      revalidateFloorMs: 6 * 60 * 60 * 1000,
      resolveSignature: async () => 'sig2',
      fetchImage: async () => ({ kind: 'unavailable', message: 'node busy' }),
    })
    assert.equal(outcome.kind, 'unavailable', 'known-stale bytes are not served as fresh')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- read-through: a negative-cache hit avoids the fetch entirely ---
{
  const dir = tempDir()
  try {
    const store = new HomeV2ImageCache({ directory: dir })
    store.putMissing('appicon|NoIcon', 'sig1')
    let fetchCount = 0
    const outcome = await readImageThroughCache({
      store,
      memo: createHomeV2ImageMemo(8),
      cacheKey: 'appicon|NoIcon',
      maxEntryBytes: 256 * 1024,
      revalidateFloorMs: 6 * 60 * 60 * 1000,
      resolveSignature: async () => 'sig1',
      fetchImage: async () => {
        fetchCount += 1
        return { kind: 'ready', bytes: pngBytes(), contentType: 'image/png' }
      },
    })
    assert.equal(outcome.kind, 'missing')
    assert.equal(fetchCount, 0, 'the negative cache avoids the round trip')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- read-through: an unresolved signature degrades to an uncached fetch ---
{
  const dir = tempDir()
  try {
    const store = new HomeV2ImageCache({ directory: dir })
    let fetchCount = 0
    const run = () =>
      readImageThroughCache({
        store,
        memo: createHomeV2ImageMemo(8),
        cacheKey: 'appicon|Unknown',
        maxEntryBytes: 256 * 1024,
        revalidateFloorMs: 6 * 60 * 60 * 1000,
        resolveSignature: async () => null,
        fetchImage: async () => {
          fetchCount += 1
          return { kind: 'ready', bytes: pngBytes(), contentType: 'image/png' }
        },
      })
    assert.equal((await run()).kind, 'ready')
    assert.equal((await run()).kind, 'ready')
    assert.equal(fetchCount, 2, 'without a signature nothing is cached')
    assert.equal(store.entries().length, 0, 'and nothing is written to the store')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- cache keys are collision-free across field boundaries ---
{
  // ('a|b','c') and ('a','b|c') must not collide (the old '|'-join bug).
  assert.notEqual(
    buildHomeV2ImageCacheKey('appicon', 'qortium', 'APP', 'a|b', 'c'),
    buildHomeV2ImageCacheKey('appicon', 'qortium', 'APP', 'a', 'b|c'),
    'ambiguous field splits produce different keys',
  )
  // kind and null-vs-"default" identifier are also distinguished.
  assert.notEqual(
    buildHomeV2ImageCacheKey('appicon', 'qortium', 'APP', 'X', null),
    buildHomeV2ImageCacheKey('avatar', 'qortium', 'APP', 'X', null),
    'different kinds do not collide',
  )
  assert.equal(
    buildHomeV2ImageCacheKey('appicon', 'qortium', 'APP', 'X', null),
    buildHomeV2ImageCacheKey('appicon', 'qortium', 'APP', 'X', 'default'),
    'null identifier canonicalizes to default',
  )
}

// --- negative cache entries expire after the TTL and re-fetch ---
{
  const dir = tempDir()
  try {
    let clock = 1_000
    const cache = new HomeV2ImageCache({ directory: dir, now: () => clock })
    assert.equal(cache.putMissing('appiconExpire', SIG), true)
    assert.ok(cache.get('appiconExpire', SIG), 'fresh negative entry is a hit')
    clock += HOME_V2_IMAGE_CACHE_NEGATIVE_TTL_MS + 1
    assert.equal(
      cache.get('appiconExpire', SIG),
      null,
      'a negative entry past its TTL is a true miss (re-fetch)',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- a non-Base58 (or over-long) signature is rejected on load ---
{
  const dir = tempDir()
  try {
    mkdirSync(dir, { recursive: true })
    const cacheKey = 'appiconBadSig'
    const fileName = createHash('sha256').update(cacheKey).digest('hex')
    writeFileSync(path.join(dir, fileName), Buffer.from(pngBytes()))
    writeFileSync(
      path.join(dir, 'index.json'),
      JSON.stringify([
        {
          cacheKey,
          contentType: 'image/png',
          byteLength: pngBytes().byteLength,
          signature: 'not-base58-!!',
          storedAt: 1,
          status: 'ready',
        },
      ]),
    )
    const cache = new HomeV2ImageCache({ directory: dir })
    assert.equal(cache.entries().length, 0, 'a non-Base58 signature row is dropped on load')
    // ...and its now-orphaned blob is reconciled away.
    assert.equal(
      readdirSync(dir).filter((name) => name !== 'index.json').length,
      0,
      'the orphaned blob was swept',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- orphaned blobs (no manifest row) are reconciled away on load ---
{
  const dir = tempDir()
  try {
    const cache = new HomeV2ImageCache({ directory: dir })
    cache.putReady('keep', SIG, pngBytes(), 'image/png', 256 * 1024)
    // A stray blob and a stray temp file with no manifest row.
    writeFileSync(path.join(dir, 'deadbeef'.repeat(8)), Buffer.from(pngBytes()))
    writeFileSync(path.join(dir, '.tmp-orphan'), Buffer.from(pngBytes()))
    const reopened = new HomeV2ImageCache({ directory: dir })
    assert.ok(reopened.get('keep', SIG), 'the referenced entry survives')
    const files = readdirSync(dir).filter((name) => name !== 'index.json')
    assert.equal(files.length, 1, 'only the one referenced blob remains')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- a symlinked cache root is refused (writes fail, never follow the link) ---
{
  const base = tempDir()
  try {
    const real = path.join(base, 'real')
    const link = path.join(base, 'link')
    mkdirSync(real, { recursive: true })
    symlinkSync(real, link, 'dir')
    const cache = new HomeV2ImageCache({ directory: link })
    assert.equal(
      cache.putReady('viaSymlink', SIG, pngBytes(), 'image/png', 256 * 1024),
      false,
      'a write through a symlinked root is refused',
    )
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

// --- read-through: bytes are NOT cached when the signature changes mid-fetch ---
{
  const dir = tempDir()
  try {
    const store = new HomeV2ImageCache({ directory: dir })
    let resolveCount = 0
    // First resolve (pre-fetch) sees sig1; the pin re-resolve (post-fetch) sees
    // sig2 — a republish landed mid-fetch — so the bytes must NOT be cached
    // under sig1.
    const outcome = await readImageThroughCache({
      store,
      memo: createHomeV2ImageMemo(8),
      cacheKey: 'appiconRepublish',
      maxEntryBytes: 256 * 1024,
      revalidateFloorMs: 6 * 60 * 60 * 1000,
      resolveSignature: async () => {
        resolveCount += 1
        return resolveCount === 1 ? SIG : `${SIG}2`
      },
      fetchImage: async () => ({ kind: 'ready', bytes: pngBytes(), contentType: 'image/png' }),
    })
    assert.equal(outcome.kind, 'ready', 'the fetched bytes are still returned to the caller')
    assert.equal(store.entries().length, 0, 'but nothing is cached under the stale signature')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- a FUTURE storedAt cannot keep a forged negative entry alive forever ---
{
  const dir = tempDir()
  try {
    mkdirSync(dir, { recursive: true })
    // A hostile manifest sets storedAt far in the future so `now - storedAt`
    // stays below the TTL for millennia. It must be treated as expired.
    writeFileSync(
      path.join(dir, 'index.json'),
      JSON.stringify([
        { cacheKey: 'k', contentType: null, byteLength: 0, signature: SIG, storedAt: 8.64e15, status: 'missing' },
      ]),
    )
    const cache = new HomeV2ImageCache({ directory: dir, now: () => 1_000 })
    assert.equal(cache.get('k', SIG), null, 'a future-dated negative entry is not a live hit')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- a symlinked cache root never lets reconcile delete OUTSIDE the store ---
{
  const base = tempDir()
  try {
    const outside = path.join(base, 'outside')
    const sentinel = path.join(outside, 'keep.txt')
    mkdirSync(outside, { recursive: true })
    writeFileSync(sentinel, 'precious')
    const link = path.join(base, 'link')
    symlinkSync(outside, link, 'dir')
    // Loading (which reconciles) must touch nothing through the symlinked root.
    const cache = new HomeV2ImageCache({ directory: link })
    assert.equal(cache.entries().length, 0, 'a symlinked root loads empty')
    assert.equal(existsSync(sentinel), true, 'the outside sentinel file was NOT deleted')
    // And a write is still refused.
    assert.equal(cache.putReady('x', SIG, pngBytes(), 'image/png', 256 * 1024), false)
    assert.equal(existsSync(sentinel), true, 'still not deleted after a write attempt')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

// --- a blob replaced by a symlink to an outside file is refused on read ---
{
  const base = tempDir()
  try {
    const dir = path.join(base, 'cache')
    const cache = new HomeV2ImageCache({ directory: dir })
    cache.putReady('sym', SIG, pngBytes(), 'image/png', 256 * 1024)
    const blob = readdirSync(dir).find((name) => name !== 'index.json')
    assert.ok(blob)
    // Replace the blob with a symlink to an outside, same-content PNG.
    const outsidePng = path.join(base, 'outside.png')
    writeFileSync(outsidePng, Buffer.from(pngBytes()))
    rmSync(path.join(dir, blob), { force: true })
    symlinkSync(outsidePng, path.join(dir, blob))
    const reopened = new HomeV2ImageCache({ directory: dir })
    assert.equal(reopened.get('sym', SIG), null, 'a symlinked blob is not followed/served')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

// --- a symlinked index.json is refused on load (O_NOFOLLOW), not followed ---
{
  const base = tempDir()
  try {
    const dir = path.join(base, 'cache')
    mkdirSync(dir, { recursive: true })
    // A real, valid manifest sitting OUTSIDE the cache dir...
    const outsideIndex = path.join(base, 'outside-index.json')
    writeFileSync(
      outsideIndex,
      JSON.stringify([
        { cacheKey: 'k', contentType: null, byteLength: 0, signature: SIG, storedAt: 1, status: 'missing' },
      ]),
    )
    // ...and index.json is a symlink to it. O_NOFOLLOW must refuse to read it.
    symlinkSync(outsideIndex, path.join(dir, 'index.json'))
    const cache = new HomeV2ImageCache({ directory: dir })
    assert.equal(cache.entries().length, 0, 'a symlinked index.json is not followed/read')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

// --- an over-cap manifest is bounded by eviction on load ---
{
  const dir = tempDir()
  try {
    let clock = 1_000
    const cache = new HomeV2ImageCache({
      directory: dir,
      maxTotalBytes: 200,
      now: () => (clock += 1_000),
    })
    // Two 80-byte entries persisted (160 bytes, under the 200 write-time cap).
    cache.putReady('a', SIG, pngBytes(80), 'image/png', 256 * 1024)
    cache.putReady('b', SIG, pngBytes(80), 'image/png', 256 * 1024)
    // Re-open with a LOWER cap: load must evict down to it even though the
    // manifest lists more than the new cap holds.
    const reopened = new HomeV2ImageCache({ directory: dir, maxTotalBytes: 100 })
    let total = 0
    for (const entry of reopened.entries()) total += entry.byteLength
    assert.ok(total <= 100, `load-time eviction bounds the store (was ${total})`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- a filesystem failure in the write tail returns false, never throws ---
{
  const dir = tempDir()
  try {
    mkdirSync(dir, { recursive: true })
    // index.json is a DIRECTORY, so writing the manifest throws EISDIR.
    mkdirSync(path.join(dir, 'index.json'), { recursive: true })
    const cache = new HomeV2ImageCache({ directory: dir })
    assert.equal(
      cache.putReady('k', SIG, pngBytes(), 'image/png', 256 * 1024),
      false,
      'a failing manifest write returns false rather than throwing',
    )
    assert.equal(cache.putMissing('k2', SIG), false, 'putMissing likewise returns false')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- source pins: the two readers route through the cache, and the store
//     never trusts a stored contentType on read-back ---
function readRepoSource(...candidates: string[]) {
  const url = candidates.map((candidate) => new URL(candidate, import.meta.url)).find((each) => existsSync(each))
  assert.ok(url, `source not found: tried ${candidates.join(', ')}`)
  return readFileSync(url, 'utf8')
}

const nodeBridge = readRepoSource('../electron/home-v2-node-bridge.ts', './home-v2-node-bridge.ts')
// Both readers hand their fetch to the persistent read-through.
assert.ok(
  nodeBridge.includes('fetchImage: () => fetchHomeV2AppIconBytes(readable, request)'),
  'the app-icon reader routes through the cache',
)
assert.ok(
  nodeBridge.includes('fetchImage: () => fetchHomeV2AvatarBytes(readable, request.path)'),
  'the avatar reader routes through the cache',
)
assert.equal(
  nodeBridge.split('readImageThroughCache(').length - 1,
  2,
  'exactly the two readers use the read-through',
)

const cacheSource = readRepoSource('../electron/home-v2-image-cache.ts', './home-v2-image-cache.ts')
// The re-sniff trust boundary: the stored type is confirmed against the bytes,
// on both read-back and write, and a mismatch is rejected.
assert.ok(cacheSource.includes('const sniffed = this.sniff(bytes)'), 're-sniff is performed')
assert.ok(
  cacheSource.includes('if (!sniffed || sniffed !== entry.contentType) return null'),
  'read-back rejects a stored type that does not match the bytes',
)
assert.ok(
  cacheSource.includes('if (!sniffed || sniffed !== contentType) return false'),
  'writes reject bytes that do not match the declared type',
)

console.log('Home v2 image cache tests passed.')
