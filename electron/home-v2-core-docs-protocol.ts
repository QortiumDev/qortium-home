import type { Session } from 'electron'
import { nodeFetch } from './node-tls.js'
import { getHomeV2ReadableNode } from './home-v2-node-bridge.js'
import {
  HOME_V2_CORE_DOCS_SCHEME,
  isAllowedHomeV2CoreDocsPath,
  parseHomeV2CoreDocsProtocolUrl,
} from './home-v2-core-docs-contract.js'

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const registeredSessions = new WeakSet<Session>()

function boundedBody(body: ReadableStream<Uint8Array> | null) {
  if (!body) return null
  let total = 0
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        controller.error(new Error('Core documentation response exceeded 16 MiB.'))
        return
      }
      controller.enqueue(chunk)
    },
  }))
}

function responseHeaders(upstream: Headers) {
  const headers = new Headers()
  const contentType = upstream.get('content-type')?.slice(0, 256)
  if (contentType) headers.set('content-type', contentType)
  headers.set('access-control-allow-origin', '*')
  headers.set(
    'content-security-policy',
    "default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; frame-src 'none'; object-src 'none'",
  )
  headers.set('cross-origin-resource-policy', 'cross-origin')
  headers.set('referrer-policy', 'no-referrer')
  headers.set('x-content-type-options', 'nosniff')
  return headers
}

export function registerHomeV2CoreDocsProtocol(targetSession: Session) {
  if (registeredSessions.has(targetSession)) return
  registeredSessions.add(targetSession)
  targetSession.protocol.handle(HOME_V2_CORE_DOCS_SCHEME, async (request) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed.', { status: 405 })
      }
      const parsed = parseHomeV2CoreDocsProtocolUrl(request.url)
      const node = await getHomeV2ReadableNode(parsed.network)
      const upstreamUrl = new URL(parsed.path, `${node.nodeApiUrl}/`).toString()
      const expectedOrigin = new URL(node.nodeApiUrl).origin
      const normalizedUpstream = new URL(upstreamUrl)
      if (
        normalizedUpstream.origin !== expectedOrigin ||
        !isAllowedHomeV2CoreDocsPath(normalizedUpstream.pathname)
      ) {
        throw new Error('Core documentation request changed node origin.')
      }
      const upstream = await nodeFetch(upstreamUrl, {
        headers: { 'accept-encoding': 'identity' },
        method: request.method,
        redirect: 'error',
        signal: request.signal,
      })
      const declaredLength = Number(upstream.headers.get('content-length'))
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        throw new Error('Core documentation response exceeded 16 MiB.')
      }
      return new Response(
        request.method === 'HEAD' ? null : boundedBody(upstream.body),
        {
          headers: responseHeaders(upstream.headers),
          status: upstream.status,
          statusText: upstream.statusText,
        },
      )
    } catch (error) {
      return new Response(
        error instanceof Error ? error.message : 'Core documentation request failed.',
        { status: 502 },
      )
    }
  })
}
