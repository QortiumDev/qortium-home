// Response-body helpers for the desktop resource-stream relay.
//
// Cancelling a net.fetch response body does not release its connection, and
// the request.signal that protocol.handle passes in never fires when the
// renderer drops a media request. A relayed body that stops being read early
// (a <video> seeking or unmounting, an over-limit body) would otherwise hold
// one of Chromium's six per-host connections to Core forever; six of those and
// every Home-to-Core request hangs. These helpers abort the upstream request
// whenever its body is abandoned, which is what actually frees the socket.

export const HOME_V2_RESOURCE_STREAM_BODY_LIMIT_MESSAGE =
  'Resource stream response exceeds the per-request byte limit.'
export const HOME_V2_RESOURCE_RETAINED_LIMIT_MESSAGE =
  'Resource exceeds the retained viewer byte limit.'

function abandon(reader: ReadableStreamDefaultReader<Uint8Array>, upstream: AbortController, reason?: unknown) {
  upstream.abort()
  return reader.cancel(reason).catch(() => {})
}

export function relayHomeV2ResourceStreamBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  upstream: AbortController,
) {
  if (!body) return null
  const reader = body.getReader()
  let total = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await reader.read()
      } catch (error) {
        upstream.abort()
        controller.error(error)
        return
      }
      if (result.done) {
        controller.close()
        return
      }
      total += result.value.byteLength
      if (total > maxBytes) {
        const error = new Error(HOME_V2_RESOURCE_STREAM_BODY_LIMIT_MESSAGE)
        await abandon(reader, upstream, error)
        controller.error(error)
        return
      }
      controller.enqueue(result.value)
    },
    cancel(reason) {
      return abandon(reader, upstream, reason)
    },
  })
}

export async function readHomeV2ResourceStreamBodyBytes(
  response: Response,
  maxBytes: number,
  upstream: AbortController,
) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    if (response.body) await abandon(response.body.getReader(), upstream)
    else upstream.abort()
    throw new Error(HOME_V2_RESOURCE_RETAINED_LIMIT_MESSAGE)
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) {
        await abandon(reader, upstream)
        throw new Error(HOME_V2_RESOURCE_RETAINED_LIMIT_MESSAGE)
      }
      chunks.push(value)
    }
  } catch (error) {
    upstream.abort()
    throw error
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
