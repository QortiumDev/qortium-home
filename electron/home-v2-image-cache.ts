import { createHash } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { getHomeV2AppIconContentType } from './home-v2-app-icon.js'

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

const INDEX_FILE = 'index.json'

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
  const cacheKey = typeof value.cacheKey === 'string' && value.cacheKey ? value.cacheKey : null
  const signature = typeof value.signature === 'string' && value.signature ? value.signature : null
  const status =
    value.status === 'ready' || value.status === 'missing' ? value.status : null
  const byteLength =
    typeof value.byteLength === 'number' &&
    Number.isInteger(value.byteLength) &&
    value.byteLength >= 0
      ? value.byteLength
      : null
  const storedAt =
    typeof value.storedAt === 'number' && Number.isFinite(value.storedAt)
      ? value.storedAt
      : null
  const contentType =
    value.contentType === null
      ? null
      : typeof value.contentType === 'string' && value.contentType
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
    if (!this.index) this.index = this.readIndexFromDisk()
    return this.index
  }

  private readIndexFromDisk(): Map<string, HomeV2ImageCacheEntry> {
    const map = new Map<string, HomeV2ImageCacheEntry>()
    try {
      const raw = readFileSync(path.join(this.directory, INDEX_FILE), 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return map
      for (const item of parsed) {
        const entry = normalizeEntry(item)
        // Last writer wins on a duplicate key, matching the persisted order.
        if (entry) map.set(entry.cacheKey, entry)
      }
    } catch {
      // Corrupt or unreadable index → behave as an empty cache (re-fetch).
      return new Map<string, HomeV2ImageCacheEntry>()
    }
    return map
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

  private writeIndex(): void {
    const index = this.ensureLoaded()
    mkdirSync(this.directory, { recursive: true })
    const target = path.join(this.directory, INDEX_FILE)
    const staging = `${target}.next`
    writeFileSync(staging, JSON.stringify([...index.values()]), {
      encoding: 'utf8',
      mode: 0o600,
    })
    renameSync(staging, target)
  }

  private dropEntry(cacheKey: string): void {
    const index = this.ensureLoaded()
    if (index.delete(cacheKey)) {
      this.removeFile(cacheKey)
      this.writeIndex()
    }
  }

  // Reads and re-validates the bytes for a ready entry. Returns null (and never
  // trusts the stored type) when the file is missing, the wrong length, or its
  // magic bytes do not re-sniff to exactly the stored contentType.
  private readValidatedBytes(entry: HomeV2ImageCacheEntry): Uint8Array | null {
    if (entry.status !== 'ready' || !entry.contentType) return null
    try {
      const buffer = readFileSync(this.fileFor(entry.cacheKey))
      const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      if (bytes.byteLength !== entry.byteLength) return null
      const sniffed = this.sniff(bytes)
      if (!sniffed || sniffed !== entry.contentType) return null
      return bytes
    } catch {
      return null
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
    if (entry.status === 'missing') return { kind: 'missing' }
    const bytes = this.readValidatedBytes(entry)
    if (!bytes) {
      // The file was corrupt/tampered/gone: drop it and force a re-fetch.
      this.dropEntry(cacheKey)
      return null
    }
    return { kind: 'ready', bytes, contentType: entry.contentType as string }
  }

  // Serves any valid ready bytes for the key regardless of signature. Used only
  // to keep showing a last-known-good image when a fresh fetch fails.
  getStale(cacheKey: string): { bytes: Uint8Array; contentType: string } | null {
    const index = this.ensureLoaded()
    const entry = index.get(cacheKey)
    if (!entry || entry.status !== 'ready') return null
    const bytes = this.readValidatedBytes(entry)
    if (!bytes) {
      this.dropEntry(cacheKey)
      return null
    }
    return { bytes, contentType: entry.contentType as string }
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
    mkdirSync(this.directory, { recursive: true })
    const target = this.fileFor(cacheKey)
    const staging = `${target}.next`
    writeFileSync(staging, bytes, { mode: 0o600 })
    renameSync(staging, target)
    index.set(cacheKey, {
      cacheKey,
      contentType,
      byteLength: bytes.byteLength,
      signature,
      storedAt: this.now(),
      status: 'ready',
    })
    this.evict()
    this.writeIndex()
    return true
  }

  putMissing(cacheKey: string, signature: string): boolean {
    if (!signature) return false
    const index = this.ensureLoaded()
    mkdirSync(this.directory, { recursive: true })
    this.removeFile(cacheKey)
    index.set(cacheKey, {
      cacheKey,
      contentType: null,
      byteLength: 0,
      signature,
      storedAt: this.now(),
      status: 'missing',
    })
    this.evict()
    this.writeIndex()
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

// The persistent read-through. Layered: in-memory memo (within the revalidate
// floor) → signature-addressed disk store → network fetch. Content-addressing
// by signature is the real invalidation; the floor only caps how often the
// signature is re-checked.
export async function readImageThroughCache(
  options: ReadImageThroughCacheOptions,
): Promise<HomeV2CachedImageOutcome> {
  const now = options.now ?? Date.now
  const at = now()

  // 1. Hot path: a recently validated answer, no search / disk / fetch.
  const memoed = options.memo.get(options.cacheKey)
  if (memoed && at < memoed.revalidateAfter) {
    return memoed.outcome
  }

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

  // 4. Miss → fetch, validate, store.
  const fetched = await options.fetchImage()
  if (fetched.kind === 'ready') {
    options.store.putReady(
      options.cacheKey,
      signature,
      fetched.bytes,
      fetched.contentType,
      options.maxEntryBytes,
    )
    const outcome: HomeV2CachedImageOutcome = {
      kind: 'ready',
      bytes: fetched.bytes,
      contentType: fetched.contentType,
      meta: fetched.meta ?? {},
      fromCache: false,
    }
    rememberOutcome(options.memo, options.cacheKey, signature, at + options.revalidateFloorMs, outcome)
    return outcome
  }
  if (fetched.kind === 'missing') {
    options.store.putMissing(options.cacheKey, signature)
    const outcome: HomeV2CachedImageOutcome = { kind: 'missing' }
    rememberOutcome(options.memo, options.cacheKey, signature, at + options.revalidateFloorMs, outcome)
    return outcome
  }
  if (fetched.kind === 'pending') {
    return { kind: 'pending', meta: fetched.meta ?? {} }
  }
  // Fetch failed. Keep showing a last-known-good copy if one is on disk;
  // otherwise report unavailable (the renderer's SWR keeps its own last good).
  const stale = options.store.getStale(options.cacheKey)
  if (stale) {
    return { kind: 'ready', bytes: stale.bytes, contentType: stale.contentType, meta: {}, fromCache: true }
  }
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
