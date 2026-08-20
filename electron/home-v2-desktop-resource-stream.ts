import type { Session } from 'electron'
import { randomUUID } from 'node:crypto'
import { nodeFetch } from './node-tls.js'
import {
  assertHomeV2ResourceStreamResponseBounds,
  buildHomeV2ResourceStreamCapabilityUrl,
  HOME_V2_RESOURCE_STREAM_RESPONSE_MAX_BYTES,
  HOME_V2_RESOURCE_STREAM_SCHEME,
  HOME_V2_RESOURCE_STREAM_MAX_ENTRIES,
  HOME_V2_RESOURCE_STREAM_TTL_MS,
  HomeV2ResourceStreamCapabilityStore,
  normalizeHomeV2ResourceRange,
  parseHomeV2ResourceStreamCapabilityUrl,
  type HomeV2ResourceStreamBinding,
} from './home-v2-resource-stream-capability.js'

const capabilityStore = new HomeV2ResourceStreamCapabilityStore()
const validators = new Map<string, Readonly<{
  isStillValid: () => boolean | Promise<boolean>
  targetSession: Session
}>>()
const registeredSessions = new WeakSet<Session>()
const privateByteStreams = new Map<string, Readonly<{
  bytes: Uint8Array
  expiresAt: number
  mimeType: string | null
}>>()

function releasePrivateByteStream(token: string) {
  const entry = privateByteStreams.get(token)
  if (entry) entry.bytes.fill(0)
  privateByteStreams.delete(token)
}

function sweepPrivateByteStreams() {
  const now = Date.now()
  for (const [token, entry] of privateByteStreams) {
    if (entry.expiresAt <= now) {
      releasePrivateByteStream(token)
      validators.delete(token)
    }
  }
}

function privateByteStreamResponse(
  entry: Readonly<{ bytes: Uint8Array; mimeType: string | null }>,
  method: string,
  rangeValue: string | null,
) {
  const normalized = normalizeHomeV2ResourceRange(rangeValue)
  let start = 0
  let end = entry.bytes.length - 1
  let status = 200
  if (normalized) {
    const [startValue, endValue] = normalized.slice('bytes='.length).split('-')
    start = Number(startValue)
    end = endValue ? Math.min(Number(endValue), entry.bytes.length - 1) : entry.bytes.length - 1
    if (start >= entry.bytes.length || end < start) {
      return new Response(null, {
        headers: { 'Content-Range': `bytes */${entry.bytes.length}` },
        status: 416,
      })
    }
    status = 206
  }
  const body = entry.bytes.subarray(start, end + 1)
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': String(body.byteLength),
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Type': entry.mimeType || 'application/octet-stream',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
  })
  if (status === 206) headers.set('Content-Range', `bytes ${start}-${end}/${entry.bytes.length}`)
  return new Response(method === 'HEAD' ? null : new Uint8Array(body).buffer, { headers, status })
}

function boundedStream(body: ReadableStream<Uint8Array> | null) {
  if (!body) return null
  let total = 0
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength
      if (total > HOME_V2_RESOURCE_STREAM_RESPONSE_MAX_BYTES) {
        controller.error(new Error('Resource stream response exceeds the per-request byte limit.'))
        return
      }
      controller.enqueue(chunk)
    },
  }))
}

function safeResponseContentType(upstream: Headers, mimeType: string | null) {
  if (mimeType) return mimeType
  const value = upstream.get('content-type')?.split(';', 1)[0].trim().toLowerCase() || ''
  if (
    value === 'application/pdf' ||
    value.startsWith('audio/') ||
    value.startsWith('video/') ||
    ['image/avif', 'image/bmp', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(value)
  ) return value
  return 'application/octet-stream'
}

function responseHeaders(upstream: Headers, mimeType: string | null) {
  const headers = new Headers()
  for (const name of ['accept-ranges', 'cache-control', 'content-length', 'content-range', 'etag', 'last-modified']) {
    const value = upstream.get(name)
    if (value) headers.set(name, value)
  }
  headers.set('access-control-allow-origin', '*')
  headers.set('content-security-policy', "default-src 'none'; sandbox")
  headers.set('content-type', safeResponseContentType(upstream, mimeType))
  headers.set('cross-origin-resource-policy', 'cross-origin')
  headers.set('x-content-type-options', 'nosniff')
  return headers
}

export function registerHomeV2DesktopResourceStreamProtocol(targetSession: Session) {
  if (registeredSessions.has(targetSession)) return
  registeredSessions.add(targetSession)
  targetSession.protocol.handle(HOME_V2_RESOURCE_STREAM_SCHEME, async (request) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed.', { status: 405 })
      }
      const token = parseHomeV2ResourceStreamCapabilityUrl(request.url)
      const authorization = validators.get(token)
      if (!authorization || authorization.targetSession !== targetSession) {
        return new Response('Resource stream capability does not belong to this session.', { status: 403 })
      }
      if (!(await authorization.isStillValid())) {
        capabilityStore.release(token)
        releasePrivateByteStream(token)
        validators.delete(token)
        return new Response('Resource stream capability is no longer valid.', { status: 403 })
      }
      sweepPrivateByteStreams()
      const privateBytes = privateByteStreams.get(token)
      if (privateBytes) {
        return privateByteStreamResponse(privateBytes, request.method, request.headers.get('range'))
      }
      const entry = capabilityStore.resolve(token)
      const range = normalizeHomeV2ResourceRange(request.headers.get('range'))
      const headers = new Headers()
      headers.set('accept-encoding', 'identity')
      const accept = request.headers.get('accept')
      if (accept) headers.set('accept', accept.slice(0, 1024))
      if (range) headers.set('range', range)
      const upstream = await nodeFetch(entry.upstreamUrl, {
        headers,
        method: request.method,
        redirect: 'error',
        signal: request.signal,
      })
      if (upstream.url && new URL(upstream.url).toString() !== entry.upstreamUrl) {
        throw new Error('Resource stream response changed the approved upstream URL.')
      }
      assertHomeV2ResourceStreamResponseBounds(upstream.headers)
      return new Response(request.method === 'HEAD' ? null : boundedStream(upstream.body), {
        headers: responseHeaders(upstream.headers, entry.mimeType),
        status: upstream.status,
        statusText: upstream.statusText,
      })
    } catch (error) {
      return new Response(error instanceof Error ? error.message : 'Resource stream request failed.', { status: 502 })
    }
  })
}

export function issueHomeV2DesktopResourceStream(input: {
  binding: HomeV2ResourceStreamBinding
  isStillValid: () => boolean | Promise<boolean>
  mimeType?: string | null
  targetSession: Session
  upstreamUrl: string
}) {
  const issued = capabilityStore.issue(input)
  for (const token of validators.keys()) {
    if (!capabilityStore.has(token)) validators.delete(token)
  }
  validators.set(issued.entry.token, Object.freeze({
    isStillValid: input.isStillValid,
    targetSession: input.targetSession,
  }))
  return issued.url
}

export function issueHomeV2DesktopPrivateBytesStream(input: {
  binding: HomeV2ResourceStreamBinding
  bytes: Uint8Array
  isStillValid: () => boolean | Promise<boolean>
  mimeType?: string | null
  targetSession: Session
}) {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.length < 1 || input.bytes.length > 1024 * 1024) {
    throw new Error('Private attachment stream bytes must be 1 byte through 1 MiB.')
  }
  sweepPrivateByteStreams()
  while (privateByteStreams.size >= HOME_V2_RESOURCE_STREAM_MAX_ENTRIES) {
    const oldest = privateByteStreams.keys().next().value
    if (!oldest) break
    releasePrivateByteStream(oldest)
    validators.delete(oldest)
  }
  const token = randomUUID()
  privateByteStreams.set(token, Object.freeze({
    bytes: new Uint8Array(input.bytes),
    expiresAt: Date.now() + HOME_V2_RESOURCE_STREAM_TTL_MS,
    mimeType: input.mimeType?.trim().toLowerCase() || null,
  }))
  validators.set(token, Object.freeze({ isStillValid: input.isStillValid, targetSession: input.targetSession }))
  return buildHomeV2ResourceStreamCapabilityUrl(token)
}

export function clearHomeV2DesktopResourceStreams() {
  capabilityStore.clear()
  for (const token of privateByteStreams.keys()) releasePrivateByteStream(token)
  privateByteStreams.clear()
  validators.clear()
}
