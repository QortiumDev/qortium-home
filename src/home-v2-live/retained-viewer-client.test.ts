import assert from 'node:assert/strict'
import { loadHomeV2RetainedViewerBytes, openHomeV2PublicViewer, closeHomeV2PublicViewer } from './retained-viewer-client'
import type { HomeV2NodeClient } from './node-client'

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

const realFetch = globalThis.fetch
globalThis.fetch = async () => new Response(new Uint8Array(1024 * 1024 + 1))
await assert.rejects(loadHomeV2RetainedViewerBytes(capabilityUrl, 1024 * 1024), /limit/)
globalThis.fetch = async () => new Response(new Uint8Array(1024 * 1024))
assert.equal((await loadHomeV2RetainedViewerBytes(capabilityUrl, 1024 * 1024)).bytes.length, 1024 * 1024)
await assert.rejects(loadHomeV2RetainedViewerBytes(capabilityUrl, Infinity), /invalid/)
globalThis.fetch = realFetch
let requestedLimit = 0
window.homeV2RetainedViewer = { save: async () => ({ canceled: true }), saveBytes: async () => ({ canceled: true }), readBytes: async ({ maxBytes }: { maxBytes: number }) => {
  requestedLimit = maxBytes
  return { bytes: new Uint8Array(1024 * 1024 + 1), contentType: null }
} }
await assert.rejects(loadHomeV2RetainedViewerBytes('qdn-home-stream://resource/test', 1024 * 1024), /limit/)
assert.equal(requestedLimit, 1024 * 1024)
delete window.homeV2RetainedViewer

console.log('Home v2 Android retained viewer client tests passed.')

const released: string[] = []
const issued: { binding: string; shellStream: boolean; mimeType: string }[] = []
Object.assign(globalThis, { __nativeTestPlugins: { QdnRenderProxy: {
  authorizeStream: async (options: { binding: string; shellStream: boolean; mimeType: string }) => {
    issued.push(options)
    return { streamUrl: 'https://localhost/qdn-home-stream?qdnHomeStream=test' }
  },
  releaseStreams: async (options: { binding: string }) => { released.push(options.binding) },
} } })
let host: unknown = { route: 'node-a' }
let hostRead = async () => host
let resourceReads = 0
const client = { requestApp: async (_protocol: string, request: Record<string, unknown>) => {
  if (request.action === 'GET_HOST_INFO') return hostRead()
  if (request.action === 'GET_QDN_RESOURCE_PROPERTIES') {
    assert.equal(request.maxBytes, 65536)
    return { filename: 'book.pdf', mimeType: 'application/pdf' }
  }
  resourceReads++
  return { streamUrl: 'https://node.example/render/DOCUMENT/Library/default?convert=false' }
} } as unknown as HomeV2NodeClient
const opened = await openHomeV2PublicViewer('qdn://DOCUMENT/Library/default', 'public-one', client)
assert.equal(opened.filename, 'book.pdf')
assert.equal(opened.mimeType, 'application/pdf')
assert.equal(issued[0].shellStream, true)
await closeHomeV2PublicViewer('public-one')
assert.equal(released.includes(issued[0].binding), true)

let resolveHost!: (value: unknown) => void
hostRead = () => new Promise(resolve => { resolveHost = resolve })
const before = resourceReads
const pending = openHomeV2PublicViewer('qdn://DOCUMENT/Library/default', 'slow', client)
await closeHomeV2PublicViewer('slow')
resolveHost(host)
await assert.rejects(pending, /Viewer closed/)
assert.equal(resourceReads, before, 'Close during the first await cannot issue any resource request')
assert.equal(issued.length, 1, 'Canceled viewers cannot mint orphan capabilities')

const stale = openHomeV2PublicViewer('qdn://DOCUMENT/Library/default', 'reloaded', client)
const resolveStale = resolveHost
hostRead = async () => host
await openHomeV2PublicViewer('qdn://DOCUMENT/Library/default', 'reloaded', client)
resolveStale(host)
await assert.rejects(stale, /Viewer closed/)
assert.equal(released.includes(issued[1].binding), false, 'Old completion must not revoke a replacement viewer')
await closeHomeV2PublicViewer('reloaded')
assert.equal(released.includes(issued[1].binding), true)
console.log('Android public-viewer metadata, shell origin, early close and overlapping reload passed')
