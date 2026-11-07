import assert from 'node:assert/strict'
import {
  HOME_V2_RESOURCE_RETAINED_LIMIT_MESSAGE,
  HOME_V2_RESOURCE_STREAM_BODY_LIMIT_MESSAGE,
  readHomeV2ResourceStreamBodyBytes,
  relayHomeV2ResourceStreamBody,
} from './home-v2-resource-stream-body.js'

// A stand-in for a net.fetch body: hands out chunks on demand and records
// whether it was cancelled or fully read.
function upstreamBody(chunks: number[], options: { failAfter?: number } = {}) {
  const state = { cancelled: false, pulls: 0 }
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (options.failAfter !== undefined && state.pulls >= options.failAfter) {
        controller.error(new Error('upstream reset'))
        return
      }
      const size = chunks[state.pulls++]
      if (size === undefined) controller.close()
      else controller.enqueue(new Uint8Array(size).fill(state.pulls))
    },
    cancel() {
      state.cancelled = true
    },
  })
  return { state, stream }
}

async function readAll(stream: ReadableStream<Uint8Array>) {
  let length = 0
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) return length
    length += value.byteLength
  }
}

// A fully read body leaves the upstream request alone.
{
  const upstream = new AbortController()
  const source = upstreamBody([4, 4, 2])
  const relayed = relayHomeV2ResourceStreamBody(source.stream, 100, upstream)!
  assert.equal(await readAll(relayed), 10)
  assert.equal(upstream.signal.aborted, false)
  assert.equal(source.state.cancelled, false)
}

// The renderer dropping a media request (seek, unmount) cancels the body the
// protocol handler returned. That must abort the upstream request, because
// cancelling a net.fetch body alone keeps its Core connection open.
{
  const upstream = new AbortController()
  const source = upstreamBody([4, 4, 4, 4])
  const response = new Response(relayHomeV2ResourceStreamBody(source.stream, 100, upstream))
  const reader = response.body!.getReader()
  await reader.read()
  await reader.cancel('seek')
  assert.equal(upstream.signal.aborted, true)
  assert.equal(source.state.cancelled, true)
}

// Cancelling before anything was read aborts too.
{
  const upstream = new AbortController()
  const source = upstreamBody([4])
  await relayHomeV2ResourceStreamBody(source.stream, 100, upstream)!.cancel()
  assert.equal(upstream.signal.aborted, true)
}

// An over-limit body errors the relayed stream and aborts the upstream request.
{
  const upstream = new AbortController()
  const source = upstreamBody([6, 6, 6])
  const relayed = relayHomeV2ResourceStreamBody(source.stream, 10, upstream)!
  await assert.rejects(readAll(relayed), new RegExp(HOME_V2_RESOURCE_STREAM_BODY_LIMIT_MESSAGE))
  assert.equal(upstream.signal.aborted, true)
  assert.equal(source.state.cancelled, true)
}

// An upstream read failure propagates and aborts.
{
  const upstream = new AbortController()
  const source = upstreamBody([4, 4], { failAfter: 1 })
  const relayed = relayHomeV2ResourceStreamBody(source.stream, 100, upstream)!
  await assert.rejects(readAll(relayed), /upstream reset/)
  assert.equal(upstream.signal.aborted, true)
}

assert.equal(relayHomeV2ResourceStreamBody(null, 100, new AbortController()), null)

// Retained-viewer reads: a full read returns the bytes and leaves the request alone.
{
  const upstream = new AbortController()
  const source = upstreamBody([3, 2])
  const bytes = await readHomeV2ResourceStreamBodyBytes(new Response(source.stream), 10, upstream)
  assert.deepEqual([...bytes], [1, 1, 1, 2, 2])
  assert.equal(upstream.signal.aborted, false)
}

// An over-limit declared length aborts without reading.
{
  const upstream = new AbortController()
  const source = upstreamBody([4])
  const response = new Response(source.stream, { headers: { 'content-length': '11' } })
  await assert.rejects(
    readHomeV2ResourceStreamBodyBytes(response, 10, upstream),
    new RegExp(HOME_V2_RESOURCE_RETAINED_LIMIT_MESSAGE),
  )
  assert.equal(upstream.signal.aborted, true)
  assert.equal(source.state.pulls <= 1, true)
}

// A body that runs past the limit while reading aborts.
{
  const upstream = new AbortController()
  const source = upstreamBody([6, 6, 6])
  await assert.rejects(
    readHomeV2ResourceStreamBodyBytes(new Response(source.stream), 10, upstream),
    new RegExp(HOME_V2_RESOURCE_RETAINED_LIMIT_MESSAGE),
  )
  assert.equal(upstream.signal.aborted, true)
  assert.equal(source.state.cancelled, true)
}

// A read failure aborts and propagates.
{
  const upstream = new AbortController()
  const source = upstreamBody([4, 4], { failAfter: 1 })
  await assert.rejects(readHomeV2ResourceStreamBodyBytes(new Response(source.stream), 100, upstream), /upstream reset/)
  assert.equal(upstream.signal.aborted, true)
}

console.log('Home v2 resource stream body tests passed.')
