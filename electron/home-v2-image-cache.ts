import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs'
import path from 'node:path'
import { getHomeV2AppIconContentType } from './home-v2-app-icon.js'

// O_NOFOLLOW makes an open() fail rather than follow a symlink at the final
// path component — so a same-user process cannot plant a symlink where a cache
// blob (or the manifest) is expected and redirect the read/write outside the
// store. It does not exist on Windows; there `?? 0` makes it a harmless no-op
// (Windows symlink creation is privileged and the threat model differs).
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0

// Persistent, main-process image cache for QDN app icons and avatars.
//
// R4-7 pass 2. Pass 1 gave the renderer stale-while-revalidate. This is the
// disk store behind it: every renderer, every detached window, and every
// restart now shares one cache instead of each re-fetching the same favicon or
// avatar bytes over IPC.
//
// Invalidation is content-addressed by the resource's `latestSignature`, never
// by wall-clock: a republish is a new signature, so the next signature check
// misses and re-fetches automatically. There is no TTL that could serve a
// genuinely stale image; the only wall-clock element (in the read-through
// orchestrator) is a floor on how OFTEN the signature is re-checked.
//
// TRUST BOUNDARY: the files under the cache directory are treated as untrusted
// input on read-back. A stored `contentType` is never trusted — the bytes are
// re-sniffed with the same magic-byte validator used on the network path, and
// a mismatch (corruption or tampering) degrades to a cache-miss (re-fetch),
// never a crash and never a spoofed type handed to the renderer. A corrupt or
// unreadable `index.json` degrades to an empty cache.

export const HOME_V2_IMAGE_CACHE_DIR_NAME = 'home-v2-image-cache'
export const HOME_V2_IMAGE_CACHE_MAX_TOTAL_BYTES = 32 * 1024 * 1024
export const HOME_V2_IMAGE_CACHE_MAX_ENTRIES = 512
// A negative (`missing`) entry is authoritative only for a bounded window: a
// node-local transient 404 (or an invalid non-image body) must not suppress
// re-fetching for the resource's entire publication lifetime. After this it is
// treated as a miss and re-checked. Positive entries need no TTL — they are
// invalidated content-addressed, by signature.
export const HOME_V2_IMAGE_CACHE_NEGATIVE_TTL_MS = 6 * 60 * 60_000
// Guard rails applied when loading an untrusted index.json from disk. The
// manifest is refused above this size before it is even parsed, and each field
// is bounded so a hostile or corrupt manifest cannot drive unbounded work.
const HOME_V2_IMAGE_CACHE_MAX_INDEX_BYTES = 2 * 1024 * 1024
const HOME_V2_IMAGE_CACHE_MAX_SIGNATURE_LENGTH = 128
const HOME_V2_IMAGE_CACHE_MAX_CACHE_KEY_LENGTH = 1024
const HOME_V2_IMAGE_CACHE_MAX_CONTENT_TYPE_LENGTH = 128

export const HOME_V2_IMAGE_CACHE_KEY_VERSION = 'v2'

// Collision-free cache key. Earlier keys joined fields with '|', but a name or
// identifier may itself contain '|', so ('a|b','c') and ('a','b|c') produced
// the same key and one resource could serve another's cached bytes. JSON array
// encoding is unambiguous — structure, not a delimiter, separates the fields —
// and the version prefix retires the old ambiguous keys on upgrade (they no
// longer match, so they simply miss and are re-fetched, then evicted).
export function buildHomeV2ImageCacheKey(
  kind: 'appicon' | 'avatar',
  network: string,
  service: string,
  name: string,
  identifier: string | null,
): string {
  return `${HOME_V2_IMAGE_CACHE_KEY_VERSION}:${JSON.stringify([
    kind,
    network,
    service,
    name,
    identifier ?? 'default',
  ])}`
}

const INDEX_FILE = 'index.json'
// Base58 (Bitcoin alphabet) — the alphabet Qortal/Qortium signatures use. A
// stored signature that is not plausible Base58 of a sane length is rejected on
// load rather than trusted as an addressable key.
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/

export interface HomeV2ImageCacheEntry {
  cacheKey: string
  contentType: string | null
  byteLength: number
  signature: string
  storedAt: number
  status: 'ready' | 'missing'
}

export type HomeV2ImageCacheReadResult =
  | { kind: 'ready'; bytes: Uint8Array; contentType: string }
  | { kind: 'missing' }
  | null

export interface HomeV2ImageCacheConfig {
  directory: string
  maxTotalBytes?: number
  maxEntries?: number
  now?: () => number
  // Defaults to the shared app-icon/avatar magic-byte sniffer. Injectable for
  // tests. Must return the canonical `image/*` type or null for "not an image".
  sniff?: (bytes: Uint8Array) => string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeEntry(value: unknown): HomeV2ImageCacheEntry | null {
  if (!isRecord(value)) return null
  const cacheKey =
    typeof value.cacheKey === 'string' &&
    value.cacheKey &&
    value.cacheKey.length <= HOME_V2_IMAGE_CACHE_MAX_CACHE_KEY_LENGTH
      ? value.cacheKey
      : null
  // The signature is the addressable key; a stored value that is not plausible
  // Base58 of a bounded length is rejected rather than trusted.
  const signature =
    typeof value.signature === 'string' &&
    value.signature.length > 0 &&
    value.signature.length <= HOME_V2_IMAGE_CACHE_MAX_SIGNATURE_LENGTH &&
    BASE58_RE.test(value.signature)
      ? value.signature
      : null
  const status =
    value.status === 'ready' || value.status === 'missing' ? value.status : null
  const byteLength =
    typeof value.byteLength === 'number' &&
    Number.isInteger(value.byteLength) &&
    value.byteLength >= 0 &&
    value.byteLength <= HOME_V2_IMAGE_CACHE_MAX_TOTAL_BYTES
      ? value.byteLength
      : null
  const storedAt =
    typeof value.storedAt === 'number' &&
    Number.isFinite(value.storedAt) &&
    value.storedAt >= 0 &&
    value.storedAt <= 8.64e15
      ? value.storedAt
      : null
  const contentType =
    value.contentType === null
      ? null
      : typeof value.contentType === 'string' &&
          value.contentType &&
          value.contentType.length <= HOME_V2_IMAGE_CACHE_MAX_CONTENT_TYPE_LENGTH
        ? value.contentType
        : undefined
  if (
    !cacheKey ||
    !signature ||
    !status ||
    byteLength === null ||
    storedAt === null ||
    contentType === undefined
  ) {
    return null
  }
  // Shape must agree with the status: a ready entry has bytes and a type, a
  // missing entry has neither. A row that disagrees is treated as corrupt.
  if (status === 'ready' && (!contentType || byteLength === 0)) return null
  if (status === 'missing' && (contentType !== null || byteLength !== 0)) return null
  return { cacheKey, contentType, byteLength, signature, storedAt, status }
}

export class HomeV2ImageCache {
  private readonly directory: string
  private readonly maxTotalBytes: number
  private readonly maxEntries: number
  private readonly now: () => number
  private readonly sniff: (bytes: Uint8Array) => string | null
  private index: Map<string, HomeV2ImageCacheEntry> | null = null

  constructor(config: HomeV2ImageCacheConfig) {
    this.directory = config.directory
    this.maxTotalBytes = config.maxTotalBytes ?? HOME_V2_IMAGE_CACHE_MAX_TOTAL_BYTES
    this.maxEntries = config.maxEntries ?? HOME_V2_IMAGE_CACHE_MAX_ENTRIES
    this.now = config.now ?? Date.now
    this.sniff = config.sniff ?? getHomeV2AppIconContentType
  }

  private ensureLoaded(): Map<string, HomeV2ImageCacheEntry> {
    if (!this.index) {
      this.index = this.readIndexFromDisk()
      // A manifest can reference more bytes/rows than the cap (hand-edited, or a
      // cap lowered across versions). Bound it immediately on load so the cap is
      // enforced even for a session that only ever reads.
      this.evict()
    }
    return this.index
  }

  // True only when the root is a REAL directory — not a symlink, a file, or
  // missing. The gate for every destructive/enumerating operation: we never
  // reconcile (delete) or read through a symlinked root, which a same-user
  // process could aim at another directory.
  private isRealDirectory(): boolean {
    try {
      return lstatSync(this.directory).isDirectory()
    } catch {
      return false
    }
  }

  private readIndexFromDisk(): Map<string, HomeV2ImageCacheEntry> {
    const map = new Map<string, HomeV2ImageCacheEntry>()
    // If the root is missing or a symlink, touch NOTHING (no read, no
    // reconcile/delete) — a symlinked root must never let us delete or serve a
    // file outside the store.
    if (!this.isRealDirectory()) return map
    const indexPath = path.join(this.directory, INDEX_FILE)
    let fd: number | null = null
    try {
      // O_NOFOLLOW: a symlink planted at index.json is refused, not followed.
      // fstat the open handle (not a pre-open lstat) so there is no size/type
      // TOCTOU between the check and the read.
      fd = openSync(indexPath, fsConstants.O_RDONLY | O_NOFOLLOW)
      const stat = fstatSync(fd)
      if (stat.isFile() && stat.size <= HOME_V2_IMAGE_CACHE_MAX_INDEX_BYTES) {
        const buffer = Buffer.allocUnsafe(stat.size)
        let read = 0
        while (read < stat.size) {
          const chunk = readSync(fd, buffer, read, stat.size - read, read)
          if (chunk === 0) break
          read += chunk
        }
        const parsed: unknown = JSON.parse(buffer.subarray(0, read).toString('utf8'))
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (map.size >= this.maxEntries) break // hard row cap
            const entry = normalizeEntry(item)
            if (entry) map.set(entry.cacheKey, entry) // last writer wins
          }
        }
      }
    } catch {
      // Missing/oversized/corrupt/symlinked index → empty manifest, but still
      // reconcile the real directory below so orphans cannot accumulate.
      map.clear()
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd)
        } catch {
          // nothing to do
        }
      }
    }
    this.reconcileDirectory(map)
    return map
  }

  // Bring the on-disk directory back in line with the loaded manifest: drop any
  // `ready` row whose blob is missing, not a regular file, or the wrong size,
  // and delete every stray file (orphaned blobs from a crash between blob-write
  // and index-write, leftover temp files) that the manifest does not reference.
  // Without this, orphaned blobs are never counted by eviction and the store
  // grows without bound across crashes and recovery.
  private reconcileDirectory(map: Map<string, HomeV2ImageCacheEntry>): void {
    // Never enumerate/delete through a symlinked (or missing) root.
    if (!this.isRealDirectory()) return
    const referenced = new Map<string, { cacheKey: string; byteLength: number }>()
    for (const entry of map.values()) {
      if (entry.status === 'ready') {
        referenced.set(createHash('sha256').update(entry.cacheKey).digest('hex'), {
          cacheKey: entry.cacheKey,
          byteLength: entry.byteLength,
        })
      }
    }
    let names: string[]
    try {
      names = readdirSync(this.directory)
    } catch {
      return
    }
    const present = new Set<string>()
    for (const name of names) {
      if (name === INDEX_FILE) continue
      const ref = referenced.get(name)
      if (ref) {
        // A referenced blob must be a real regular file of exactly the recorded
        // size to count; a symlink, gone, or resized blob drops the row so the
        // entry re-fetches and eviction's byte total tracks the real directory.
        try {
          const stat = lstatSync(path.join(this.directory, name))
          if (stat.isFile() && stat.size === ref.byteLength) {
            present.add(name)
            continue
          }
        } catch {
          // fall through to removal + row drop
        }
        map.delete(ref.cacheKey)
      }
      // Unreferenced file (orphan blob, stray temp, or a now-dropped blob):
      // remove it. The manifest is the single source of truth.
      try {
        rmSync(path.join(this.directory, name), { force: true })
      } catch {
        // Best effort.
      }
    }
    // Drop any ready row whose blob never materialised on disk.
    for (const [name, ref] of referenced) {
      if (!present.has(name)) map.delete(ref.cacheKey)
    }
  }

  private fileFor(cacheKey: string): string {
    return path.join(this.directory, createHash('sha256').update(cacheKey).digest('hex'))
  }

  private removeFile(cacheKey: string): void {
    try {
      rmSync(this.fileFor(cacheKey), { force: true })
    } catch {
      // Best-effort: a leftover byte file is harmless; the index is the truth.
    }
  }

  // Create the cache directory and refuse to operate through a symlinked root:
  // a same-user process could otherwise point the whole store at another
  // directory and have every write land there. Re-verified on EVERY write (not
  // cached) so a root swapped to a symlink after an earlier check cannot make a
  // later write land outside.
  private ensureDirectory(): void {
    mkdirSync(this.directory, { recursive: true })
    const stat = lstatSync(this.directory)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Image cache root is not a real directory.')
    }
  }

  // Atomic, symlink-safe write: a fresh randomly named temp file in the same
  // directory, opened with O_EXCL so a pre-created symlink at that path is
  // refused (never followed), then rename over the target. Defeats the
  // predictable-'.next'-symlink overwrite of an out-of-cache file.
  private atomicWrite(target: string, data: Uint8Array | string): void {
    this.ensureDirectory()
    const staging = path.join(
      this.directory,
      `.tmp-${randomBytes(12).toString('hex')}`,
    )
    // 'wx' = O_CREAT | O_EXCL: fails if `staging` already exists (including as a
    // symlink), so an attacker cannot pre-plant the temp path.
    const fd = openSync(staging, 'wx', 0o600)
    try {
      const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
      // Loop until every byte is written: writeSync can report a SHORT write
      // (e.g. a nearly full disk), and renaming a truncated staging file into
      // place would leave a corrupt blob or manifest.
      let written = 0
      while (written < bytes.byteLength) {
        const chunk = writeSync(fd, bytes, written, bytes.byteLength - written)
        if (chunk <= 0) throw new Error('Image cache write made no progress.')
        written += chunk
      }
    } finally {
      closeSync(fd)
    }
    try {
      renameSync(staging, target)
    } catch (error) {
      try {
        rmSync(staging, { force: true })
      } catch {
        // Best effort — a leftover temp file is swept by reconcile() on load.
      }
      throw error
    }
  }

  private writeIndex(): void {
    const index = this.ensureLoaded()
    this.atomicWrite(path.join(this.directory, INDEX_FILE), JSON.stringify([...index.values()]))
  }

  private dropEntry(cacheKey: string): void {
    const index = this.ensureLoaded()
    if (index.delete(cacheKey)) {
      this.removeFile(cacheKey)
      // dropEntry runs on read paths (get); a failed index rewrite must not
      // throw out of a lookup — the in-memory drop already took effect.
      try {
        this.writeIndex()
      } catch {
        // Best effort; reconcile fixes the disk manifest on the next load.
      }
    }
  }

  // Reads and re-validates the bytes for a ready entry. Returns null (and never
  // trusts the stored type) when the file is missing, the wrong length, or its
  // magic bytes do not re-sniff to exactly the stored contentType.
  private readValidatedBytes(entry: HomeV2ImageCacheEntry): Uint8Array | null {
    if (entry.status !== 'ready' || !entry.contentType) return null
    let fd: number | null = null
    try {
      // O_NOFOLLOW so a blob symlink planted by a same-user process is REFUSED,
      // not followed (a plain 'r' open would follow it and fstat would then
      // report the outside target as a regular file). fstat the open handle and
      // require a regular file of exactly the recorded size.
      fd = openSync(this.fileFor(entry.cacheKey), fsConstants.O_RDONLY | O_NOFOLLOW)
      const stat = fstatSync(fd)
      if (!stat.isFile()) return null
      if (stat.size !== entry.byteLength) return null
      const buffer = Buffer.allocUnsafe(stat.size)
      let read = 0
      while (read < stat.size) {
        const chunk = readSync(fd, buffer, read, stat.size - read, read)
        if (chunk === 0) break
        read += chunk
      }
      if (read !== entry.byteLength) return null
      const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      const sniffed = this.sniff(bytes)
      if (!sniffed || sniffed !== entry.contentType) return null
      return bytes
    } catch {
      return null
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd)
        } catch {
          // Nothing more to do on a close failure.
        }
      }
    }
  }

  // Signature-addressed lookup. `ready` serves validated bytes; `missing` is a
  // negative-cache hit (this signature had no image — do not re-fetch); null is
  // a true miss (unknown or stale signature) and the caller should fetch.
  get(cacheKey: string, signature: string): HomeV2ImageCacheReadResult {
    if (!signature) return null
    const index = this.ensureLoaded()
    const entry = index.get(cacheKey)
    if (!entry || entry.signature !== signature) return null
    if (entry.status === 'missing') {
      // Negative entries are authoritative only for a bounded window: a
      // transient 404 must not suppress re-fetching forever. Past the TTL — OR
      // with a FUTURE storedAt (age < 0), which a hostile manifest could forge
      // to keep the age below the TTL for millennia — drop it and report a true
      // miss so the caller re-checks.
      const age = this.now() - entry.storedAt
      if (age < 0 || age >= HOME_V2_IMAGE_CACHE_NEGATIVE_TTL_MS) {
        this.dropEntry(cacheKey)
        return null
      }
      return { kind: 'missing' }
    }
    const bytes = this.readValidatedBytes(entry)
    if (!bytes) {
      // The file was corrupt/tampered/gone: drop it and force a re-fetch.
      this.dropEntry(cacheKey)
      return null
    }
    return { kind: 'ready', bytes, contentType: entry.contentType as string }
  }

  putReady(
    cacheKey: string,
    signature: string,
    bytes: Uint8Array,
    contentType: string,
    maxEntryBytes: number,
  ): boolean {
    if (!signature || bytes.byteLength === 0) return false
    if (bytes.byteLength > maxEntryBytes || bytes.byteLength > this.maxTotalBytes) return false
    // Trust boundary on write too: never persist bytes whose own magic bytes
    // disagree with the type we are about to record for them.
    const sniffed = this.sniff(bytes)
    if (!sniffed || sniffed !== contentType) return false
    const index = this.ensureLoaded()
    try {
      this.atomicWrite(this.fileFor(cacheKey), bytes)
    } catch {
      // A failed write (symlinked root, disk error) is a cache miss, not a
      // crash: the caller still returns the freshly fetched bytes to the app.
      return false
    }
    index.set(cacheKey, {
      cacheKey,
      contentType,
      byteLength: bytes.byteLength,
      signature,
      storedAt: this.now(),
      status: 'ready',
    })
    // evict()/writeIndex() touch the filesystem and can throw (e.g. index.json
    // is a directory, or the root was swapped to a symlink). A store write must
    // never crash the caller — degrade to "not cached" and keep the blob for
    // reconcile to sweep.
    try {
      this.evict()
      this.writeIndex()
    } catch {
      return false
    }
    return true
  }

  putMissing(cacheKey: string, signature: string): boolean {
    if (!signature) return false
    const index = this.ensureLoaded()
    try {
      this.ensureDirectory()
    } catch {
      return false
    }
    this.removeFile(cacheKey)
    index.set(cacheKey, {
      cacheKey,
      contentType: null,
      byteLength: 0,
      signature,
      storedAt: this.now(),
      status: 'missing',
    })
    // As in putReady: a filesystem failure in the tail degrades to "not
    // cached", never a throw to the caller.
    try {
      this.evict()
      this.writeIndex()
    } catch {
      return false
    }
    return true
  }

  // Bounds the store by both total bytes and entry count, evicting the
  // least-recently-stored entries (lowest storedAt) first.
  private evict(): void {
    const index = this.ensureLoaded()
    let total = 0
    for (const entry of index.values()) total += entry.byteLength
    if (total <= this.maxTotalBytes && index.size <= this.maxEntries) return
    const byOldest = [...index.values()].sort((left, right) => left.storedAt - right.storedAt)
    for (const entry of byOldest) {
      if (total <= this.maxTotalBytes && index.size <= this.maxEntries) break
      if (entry.status === 'ready') this.removeFile(entry.cacheKey)
      index.delete(entry.cacheKey)
      total -= entry.byteLength
    }
  }

  // Test/inspection helper: the entries currently tracked in memory.
  entries(): readonly HomeV2ImageCacheEntry[] {
    return [...this.ensureLoaded().values()]
  }
}

// A small bounded in-memory layer in front of the disk store. It absorbs the
// multi-window refetch storm within a single process and, crucially, gates how
// often the signature is re-checked (the wall-clock floor), so a screenful of
// icons does not run a search per render.

export interface HomeV2ImageMemoEntry {
  signature: string
  revalidateAfter: number
  outcome: HomeV2CachedImageOutcome
}

export interface HomeV2ImageCacheMemo {
  get(cacheKey: string): HomeV2ImageMemoEntry | undefined
  set(cacheKey: string, entry: HomeV2ImageMemoEntry): void
}

export function createHomeV2ImageMemo(maxEntries: number): HomeV2ImageCacheMemo {
  const entries = new Map<string, HomeV2ImageMemoEntry>()
  return {
    get(cacheKey) {
      return entries.get(cacheKey)
    },
    set(cacheKey, entry) {
      entries.delete(cacheKey)
      entries.set(cacheKey, entry)
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value as string | undefined
        if (!oldest) break
        entries.delete(oldest)
      }
    },
  }
}

// The outcome a network fetch reports to the read-through. `ready` carries raw
// bytes so the store can persist them; `pending` (HTTP 202) and `unavailable`
// (error) are never cached.
export type HomeV2ImageFetchOutcome =
  | { kind: 'ready'; bytes: Uint8Array; contentType: string; meta?: Record<string, unknown> }
  | { kind: 'missing' }
  | { kind: 'pending'; meta?: Record<string, unknown> }
  | { kind: 'unavailable'; message: string }

export type HomeV2CachedImageOutcome =
  | { kind: 'ready'; bytes: Uint8Array; contentType: string; meta: Record<string, unknown>; fromCache: boolean }
  | { kind: 'missing' }
  | { kind: 'pending'; meta: Record<string, unknown> }
  | { kind: 'unavailable'; message: string }

function rememberOutcome(
  memo: HomeV2ImageCacheMemo,
  cacheKey: string,
  signature: string,
  revalidateAfter: number,
  outcome: HomeV2CachedImageOutcome,
): void {
  // Only stable outcomes are memoized. A pending resource must be retried
  // promptly, and an unavailable node must not be remembered as an answer.
  if (outcome.kind !== 'ready' && outcome.kind !== 'missing') return
  memo.set(cacheKey, { signature, revalidateAfter, outcome })
}

export interface ReadImageThroughCacheOptions {
  store: HomeV2ImageCache
  memo: HomeV2ImageCacheMemo
  cacheKey: string
  maxEntryBytes: number
  revalidateFloorMs: number
  now?: () => number
  // The cheap `/arbitrary/resources/search` that yields the resource's current
  // latestSignature, or null when it cannot be resolved (then we do not cache).
  resolveSignature: () => Promise<string | null>
  fetchImage: () => Promise<HomeV2ImageFetchOutcome>
}

// Serializes the resolve→disk→fetch→store path per cache key so concurrent
// callers dedupe and, crucially, an older operation can never commit its bytes
// after a newer one. Keyed by the (globally unique) cacheKey.
const imageReadInFlight = new Map<string, Promise<HomeV2CachedImageOutcome>>()

// The persistent read-through. Layered: in-memory memo (within the revalidate
// floor) → signature-addressed disk store → network fetch. Content-addressing
// by signature is the real invalidation; the floor only caps how often the
// signature is re-checked.
export async function readImageThroughCache(
  options: ReadImageThroughCacheOptions,
): Promise<HomeV2CachedImageOutcome> {
  const now = options.now ?? Date.now

  // 1. Hot path: a recently validated answer, no search / disk / fetch. Kept
  // outside the singleflight — it is a synchronous in-memory read.
  const memoed = options.memo.get(options.cacheKey)
  if (memoed && now() < memoed.revalidateAfter) {
    return memoed.outcome
  }

  const existing = imageReadInFlight.get(options.cacheKey)
  if (existing) return existing
  const run = runImageReadThroughCache(options, now)
  imageReadInFlight.set(options.cacheKey, run)
  try {
    return await run
  } finally {
    imageReadInFlight.delete(options.cacheKey)
  }
}

async function runImageReadThroughCache(
  options: ReadImageThroughCacheOptions,
  now: () => number,
): Promise<HomeV2CachedImageOutcome> {
  const at = now()

  // 2. Content-address by the current signature.
  const signature = await options.resolveSignature()
  if (!signature) {
    // No signature to key on → uncached fetch, i.e. today's behavior.
    return toCachedOutcome(await options.fetchImage())
  }

  // 3. Disk store, keyed by signature (positive and negative).
  const hit = options.store.get(options.cacheKey, signature)
  if (hit && hit.kind === 'ready') {
    const outcome: HomeV2CachedImageOutcome = {
      kind: 'ready',
      bytes: hit.bytes,
      contentType: hit.contentType,
      meta: {},
      fromCache: true,
    }
    rememberOutcome(options.memo, options.cacheKey, signature, at + options.revalidateFloorMs, outcome)
    return outcome
  }
  if (hit && hit.kind === 'missing') {
    const outcome: HomeV2CachedImageOutcome = { kind: 'missing' }
    rememberOutcome(options.memo, options.cacheKey, signature, at + options.revalidateFloorMs, outcome)
    return outcome
  }

  // 4. Miss → fetch, validate, store. The node serves the CURRENT latest, so if
  // the resource republished between resolving `signature` and this fetch the
  // bytes belong to the NEW revision. Re-resolve and only persist when the
  // signature still agrees (a bytes↔signature pin); otherwise return the bytes
  // uncached and let the next call store the correct pair.
  const fetched = await options.fetchImage()
  if (fetched.kind === 'ready') {
    const confirmed = await options.resolveSignature()
    const outcome: HomeV2CachedImageOutcome = {
      kind: 'ready',
      bytes: fetched.bytes,
      contentType: fetched.contentType,
      meta: fetched.meta ?? {},
      fromCache: false,
    }
    if (confirmed === signature) {
      options.store.putReady(
        options.cacheKey,
        signature,
        fetched.bytes,
        fetched.contentType,
        options.maxEntryBytes,
      )
      rememberOutcome(options.memo, options.cacheKey, signature, at + options.revalidateFloorMs, outcome)
    }
    return outcome
  }
  if (fetched.kind === 'missing') {
    const confirmed = await options.resolveSignature()
    if (confirmed === signature) {
      options.store.putMissing(options.cacheKey, signature)
      rememberOutcome(
        options.memo,
        options.cacheKey,
        signature,
        at + options.revalidateFloorMs,
        { kind: 'missing' },
      )
    }
    return { kind: 'missing' }
  }
  if (fetched.kind === 'pending') {
    return { kind: 'pending', meta: fetched.meta ?? {} }
  }
  // Fetch failed. We already resolved the CURRENT signature and missed the
  // store for it, so any on-disk bytes are for an OLDER signature. Serving
  // those as a fresh `ready` would report known-stale content as current, so
  // report unavailable instead: the renderer's stale-while-revalidate keeps
  // showing its own last-good image, and a later successful fetch repaints it.
  return { kind: 'unavailable', message: fetched.message }
}

function toCachedOutcome(fetched: HomeV2ImageFetchOutcome): HomeV2CachedImageOutcome {
  switch (fetched.kind) {
    case 'ready':
      return {
        kind: 'ready',
        bytes: fetched.bytes,
        contentType: fetched.contentType,
        meta: fetched.meta ?? {},
        fromCache: false,
      }
    case 'missing':
      return { kind: 'missing' }
    case 'pending':
      return { kind: 'pending', meta: fetched.meta ?? {} }
    case 'unavailable':
      return { kind: 'unavailable', message: fetched.message }
  }
}
