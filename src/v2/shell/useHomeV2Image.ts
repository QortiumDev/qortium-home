import { useEffect, useState } from 'react'
import type { VisibleAvatarReadResult } from '../contracts'

type ImageSnapshot = {
  readonly loading: boolean
  readonly status: 'fallback' | 'loading' | 'ready'
  readonly url: string | null
}

type ImageEntry = {
  active: boolean
  expiresAt: number
  inflight: Promise<void> | null
  loadingTimer: number | null
  maxBytes: number
  snapshot: ImageSnapshot
  subscribers: Set<(snapshot: ImageSnapshot) => void>
}

const MAX_PENDING_ATTEMPTS = 12
const MAX_TRANSIENT_ATTEMPTS = 3
const MAX_CACHE_ENTRIES = 200
const MISSING_CACHE_MS = 5 * 60_000
const READY_CACHE_MS = 5 * 60_000
const UNAVAILABLE_CACHE_MS = 30_000
/** Types that carry no information, so the bytes decide. */
const UNTYPED_CONTENT_TYPES = new Set(['application/octet-stream', 'binary/octet-stream'])

const ALLOWED_CONTENT_TYPES = new Set([
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/vnd.microsoft.icon',
  'image/webp',
])

const FALLBACK: ImageSnapshot = {
  loading: false,
  status: 'fallback',
  url: null,
}
const entries = new Map<string, ImageEntry>()

function emit(entry: ImageEntry, snapshot: ImageSnapshot) {
  entry.snapshot = snapshot
  for (const subscriber of entry.subscribers) subscriber(snapshot)
}

function clearLoadingTimer(entry: ImageEntry) {
  if (entry.loadingTimer !== null) {
    window.clearTimeout(entry.loadingTimer)
    entry.loadingTimer = null
  }
}

function beginLoading(entry: ImageEntry, loadingMs: number) {
  clearLoadingTimer(entry)
  emit(entry, { loading: true, status: 'loading', url: null })
  entry.loadingTimer = window.setTimeout(() => {
    entry.loadingTimer = null
    if (entry.active && entry.snapshot.status === 'loading') {
      emit(entry, { ...entry.snapshot, loading: false })
    }
  }, loadingMs)
}

function finishFallback(entry: ImageEntry, expiresAt: number) {
  clearLoadingTimer(entry)
  if (entry.snapshot.url) URL.revokeObjectURL(entry.snapshot.url)
  entry.expiresAt = expiresAt
  emit(entry, FALLBACK)
}

function finishUnavailable(entry: ImageEntry) {
  if (entry.snapshot.status === 'ready') {
    entry.expiresAt = Date.now() + UNAVAILABLE_CACHE_MS
    return
  }
  finishFallback(entry, Date.now() + UNAVAILABLE_CACHE_MS)
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
}

export function validateHomeV2ImagePayload(
  body: string,
  contentLength: number,
  contentType: string,
  maxBytes: number,
) {
  // An untyped payload is allowed through to the magic-byte sniff in
  // imageObjectUrl; anything else claiming a non-image type is refused here.
  if (!ALLOWED_CONTENT_TYPES.has(contentType) && !UNTYPED_CONTENT_TYPES.has(contentType)) {
    throw new Error('Image content type is not allowed.')
  }
  const binary = globalThis.atob(body)
  if (binary.length !== contentLength || binary.length > maxBytes) {
    throw new Error('Image byte length did not match the bounded response.')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/**
 * Some nodes serve avatars as application/octet-stream because they cannot
 * infer a type from the stored file — real, valid images that were being
 * rejected outright, leaving a monogram in place of the avatar. Sniff the
 * magic bytes and use the SNIFFED type (never the server's claim) so an
 * untyped-but-genuine image renders while anything that is not an image is
 * still refused.
 */
function sniffImageContentType(bytes: Uint8Array): string | null {
  const startsWith = (signature: readonly number[], offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte)
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  if (startsWith([0x42, 0x4d])) return 'image/bmp'
  if (startsWith([0x00, 0x00, 0x01, 0x00])) return 'image/vnd.microsoft.icon'
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp'
  }
  return null
}

function imageObjectUrl(result: Extract<VisibleAvatarReadResult, { status: 'ready' }>, maxBytes: number) {
  const bytes = validateHomeV2ImagePayload(
    result.body,
    result.contentLength,
    result.contentType,
    maxBytes,
  )
  const type = ALLOWED_CONTENT_TYPES.has(result.contentType)
    ? result.contentType
    : sniffImageContentType(bytes)
  if (!type) throw new Error('Image content type is not allowed.')
  return URL.createObjectURL(new Blob([bytes], { type }))
}

function pruneCache() {
  if (entries.size <= MAX_CACHE_ENTRIES) return
  for (const [key, entry] of entries) {
    if (entry.inflight || entry.subscribers.size > 0) continue
    entries.delete(key)
    entry.active = false
    clearLoadingTimer(entry)
    if (entry.snapshot.url) URL.revokeObjectURL(entry.snapshot.url)
    if (entries.size <= MAX_CACHE_ENTRIES) return
  }
}

async function resolveEntry(
  key: string,
  entry: ImageEntry,
  load: () => Promise<VisibleAvatarReadResult>,
) {
  let pendingAttempts = 0
  let transientAttempts = 0
  while (entry.active && entries.get(key) === entry) {
    const result = await load().catch(() => ({
      message: 'Image request failed.',
      status: 'unavailable' as const,
    }))
    if (!entry.active || entries.get(key) !== entry) return
    if (result.status === 'ready') {
      try {
        const url = imageObjectUrl(result, entry.maxBytes)
        const previousUrl = entry.snapshot.url
        clearLoadingTimer(entry)
        entry.expiresAt = Date.now() + READY_CACHE_MS
        emit(entry, { loading: false, status: 'ready', url })
        if (previousUrl && previousUrl !== url) URL.revokeObjectURL(previousUrl)
      } catch {
        finishUnavailable(entry)
      }
      return
    }
    if (result.status === 'missing') {
      finishFallback(entry, Date.now() + MISSING_CACHE_MS)
      return
    }
    if (result.status === 'unavailable') {
      transientAttempts += 1
      finishUnavailable(entry)
      if (transientAttempts >= MAX_TRANSIENT_ATTEMPTS) return
      await wait(2_000)
      continue
    }
    pendingAttempts += 1
    if (pendingAttempts >= MAX_PENDING_ATTEMPTS) {
      finishUnavailable(entry)
      return
    }
    const delaySeconds = Math.max(
      1,
      Math.min(result.retryAfterSeconds ?? 5, 10),
    )
    await wait(delaySeconds * 1_000)
  }
}

function subscribe(
  cacheKey: string,
  loadingMs: number,
  maxBytes: number,
  load: () => Promise<VisibleAvatarReadResult>,
  subscriber: (snapshot: ImageSnapshot) => void,
) {
  let entry = entries.get(cacheKey)
  if (entry) {
    entries.delete(cacheKey)
    entries.set(cacheKey, entry)
  } else {
    entry = {
      active: true,
      expiresAt: 0,
      inflight: null,
      loadingTimer: null,
      maxBytes,
      snapshot: FALLBACK,
      subscribers: new Set(),
    }
    entries.set(cacheKey, entry)
  }
  entry.maxBytes = maxBytes
  entry.subscribers.add(subscriber)
  const expired =
    Date.now() >= entry.expiresAt
  if (expired && entry.snapshot.status === 'fallback' && !entry.inflight) {
    beginLoading(entry, loadingMs)
  }
  subscriber(entry.snapshot)
  if ((expired || entry.snapshot.status === 'loading') && !entry.inflight) {
    entry.inflight = resolveEntry(cacheKey, entry, load).finally(() => {
      entry!.inflight = null
      pruneCache()
    })
  }
  pruneCache()
  return () => {
    entry!.subscribers.delete(subscriber)
  }
}

export function rejectHomeV2Image(cacheKey: string, url: string) {
  const entry = entries.get(cacheKey)
  if (!entry || entry.snapshot.url !== url) return
  finishFallback(entry, Date.now() + MISSING_CACHE_MS)
}

export function clearHomeV2ImageCacheForTests() {
  for (const entry of entries.values()) {
    entry.active = false
    clearLoadingTimer(entry)
    if (entry.snapshot.url) URL.revokeObjectURL(entry.snapshot.url)
  }
  entries.clear()
}

export function useHomeV2Image({
  cacheKey,
  load,
  loadingMs,
  maxBytes,
}: {
  readonly cacheKey: string | null
  readonly load?: () => Promise<VisibleAvatarReadResult>
  readonly loadingMs: number
  readonly maxBytes: number
}) {
  const [state, setState] = useState<{
    readonly cacheKey: string | null
    readonly snapshot: ImageSnapshot
  }>(() => {
    // A remount (a dashboard tab coming back) should paint a still-cached image
    // straight away instead of flashing the fallback until the effect runs.
    const cached = cacheKey ? entries.get(cacheKey) : undefined
    return cached && cached.snapshot.status === 'ready' && Date.now() < cached.expiresAt
      ? { cacheKey, snapshot: cached.snapshot }
      : { cacheKey: null, snapshot: FALLBACK }
  })
  useEffect(() => {
    if (!cacheKey || !load) {
      setState({ cacheKey: null, snapshot: FALLBACK })
      return undefined
    }
    return subscribe(cacheKey, loadingMs, maxBytes, load, (snapshot) => {
      setState({ cacheKey, snapshot })
    })
  }, [cacheKey, load, loadingMs, maxBytes])
  return state.cacheKey === cacheKey ? state.snapshot : FALLBACK
}
