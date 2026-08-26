import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createHomeV2ImageMemo,
  HomeV2ImageCache,
  readImageThroughCache,
  type HomeV2ImageFetchOutcome,
} from './home-v2-image-cache.js'

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
    assert.equal(cache.get('appicon|Chat', 'sig-1'), null, 'cold cache misses')

    const bytes = pngBytes()
    assert.equal(
      cache.putReady('appicon|Chat', 'sig-1', bytes, 'image/png', 256 * 1024),
      true,
    )
    const hit = cache.get('appicon|Chat', 'sig-1')
    assert.ok(hit && hit.kind === 'ready', 'warm signature hits')
    assert.equal(hit.contentType, 'image/png')
    assert.deepEqual(hit.bytes, bytes)

    // A different signature for the same key is a miss (stale), not a hit.
    assert.equal(cache.get('appicon|Chat', 'sig-2'), null, 'changed signature misses')

    // A fresh instance re-reads index.json from disk — survives restart.
    const reopened = new HomeV2ImageCache({ directory: dir })
    const persisted = reopened.get('appicon|Chat', 'sig-1')
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
    assert.equal(cache.putMissing('appicon|NoIcon', 'sig-x'), true)
    const hit = cache.get('appicon|NoIcon', 'sig-x')
    assert.ok(hit && hit.kind === 'missing', 'negative cache hits for the same signature')
    assert.equal(cache.get('appicon|NoIcon', 'sig-y'), null, 'a new signature retries')
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
    cache.putReady('appicon|Tampered', 'sig-1', pngBytes(), 'image/png', 256 * 1024)
    const byteFile = readdirSync(dir).find((name) => name !== 'index.json')
    assert.ok(byteFile)
    writeFileSync(path.join(dir, byteFile), Buffer.from(gifBytes()))

    const reopened = new HomeV2ImageCache({ directory: dir })
    assert.equal(reopened.get('appicon|Tampered', 'sig-1'), null, 'mismatched bytes rejected')
    // The poisoned entry is dropped, so a later put can repopulate cleanly.
    assert.equal(reopened.get('appicon|Tampered', 'sig-1'), null)
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
          signature: 'sig-1',
          storedAt: 1,
          status: 'ready',
        },
      ]),
    )
    const cache = new HomeV2ImageCache({ directory: dir })
    assert.equal(cache.get(cacheKey, 'sig-1'), null, 'injected type mismatch rejected')
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
      return 'sig-1'
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
    assert.equal(signatureCount, 2, 'the signature is still checked on a cold memo')

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
    let signature = 'sig-1'
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
    signature = 'sig-2' // a republish
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

// --- read-through: a fetch failure with a warm cache serves the cached bytes ---
{
  const dir = tempDir()
  try {
    const store = new HomeV2ImageCache({ directory: dir })
    const warm = pngBytes(48)
    store.putReady('avatar|Bob', 'sig-1', warm, 'image/png', 500 * 1024)
    // The signature moved on, so the exact-signature lookup misses; the fetch
    // then fails. The last-known-good bytes must still be served.
    const outcome = await readImageThroughCache({
      store,
      memo: createHomeV2ImageMemo(8),
      cacheKey: 'avatar|Bob',
      maxEntryBytes: 500 * 1024,
      revalidateFloorMs: 6 * 60 * 60 * 1000,
      resolveSignature: async () => 'sig-2',
      fetchImage: async () => ({ kind: 'unavailable', message: 'node busy' }),
    })
    assert.ok(outcome.kind === 'ready', 'a fetch failure falls back to the warm cache')
    assert.deepEqual(outcome.bytes, warm)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- read-through: a negative-cache hit avoids the fetch entirely ---
{
  const dir = tempDir()
  try {
    const store = new HomeV2ImageCache({ directory: dir })
    store.putMissing('appicon|NoIcon', 'sig-1')
    let fetchCount = 0
    const outcome = await readImageThroughCache({
      store,
      memo: createHomeV2ImageMemo(8),
      cacheKey: 'appicon|NoIcon',
      maxEntryBytes: 256 * 1024,
      revalidateFloorMs: 6 * 60 * 60 * 1000,
      resolveSignature: async () => 'sig-1',
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
