import assert from 'node:assert/strict'
import { loadHomeV2RetainedViewerBytes } from './retained-viewer-client'

const capabilityUrl = 'https://node-qdn.qdn.androidplatform.net/arbitrary/DOCUMENT/Library?convert=false&qdnHomeStream=token'
let requestedUrl = ''
Object.assign(globalThis, {
  window: {},
  fetch: async (url: string) => {
    requestedUrl = url
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'application/epub+zip' },
      status: 200,
    })
  },
})

const loaded = await loadHomeV2RetainedViewerBytes(capabilityUrl)
assert.equal(requestedUrl, capabilityUrl)
assert.deepEqual([...loaded.bytes], [1, 2, 3])
assert.equal(loaded.contentType, 'application/epub+zip')

console.log('Home v2 Android retained viewer client tests passed.')
