import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { register } from 'node:module'

const handlers = new Map(), streams = [], requests = [], byteReads = []
let route = { mode: 'custom', nodeApiUrl: 'https://node.example' }
let readNode = async () => route
const mocks = {
  electron: { BrowserWindow: {}, dialog: {}, ipcMain: { handle: (name, fn) => handlers.set(name, fn) } },
  'home-v2-authorized-senders.js': { assertAuthorizedHomeV2Sender: event => { if (!event.authorized) throw new Error('Unauthorized sender') } },
  'home-v2-node-bridge.js': { getHomeV2ReadableNode: () => readNode() },
  'node-tls.js': { nodeFetch: async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify(url.includes('/status/') ? { status: 'READY' } : { filename: 'art.png', mimeType: 'image/png' }))
  } },
  'home-v2-desktop-resource-stream.js': {
    issueHomeV2DesktopResourceStream: options => { streams.push(options); return `qdn-home-stream://resource/${streams.length}` },
    readHomeV2DesktopResourceStreamBytes: options => { byteReads.push(options); return { bytes: new Uint8Array([1]) } },
  },
}
globalThis.__publicViewerMocks = mocks
const exportsByModule = Object.fromEntries(Object.entries(mocks).map(([key, value]) => [key, Object.keys(value)]))
register(`data:text/javascript,${encodeURIComponent(`
  const modules = ${JSON.stringify(exportsByModule)};
  export async function resolve(specifier, context, next) {
    const key = specifier === 'electron' ? specifier : specifier.split('/').at(-1);
    if (modules[key]) return { url: 'viewer-mock:' + key, shortCircuit: true };
    return next(specifier, context);
  }
  export async function load(url, context, next) {
    if (!url.startsWith('viewer-mock:')) return next(url, context);
    const key = url.slice('viewer-mock:'.length);
    return { format: 'module', shortCircuit: true, source: modules[key].map(name =>
      'export const ' + name + ' = globalThis.__publicViewerMocks[' + JSON.stringify(key) + '][' + JSON.stringify(name) + '];').join(';') };
  }
`)}`)
const { registerHomeV2RetainedViewerBridgeIpcHandlers } = await import('../dist-electron/home-v2-retained-viewer-bridge.js')
registerHomeV2RetainedViewerBridgeIpcHandlers()
const sender = Object.assign(new EventEmitter(), { id: 41, session: {}, isDestroyed: () => false })
const event = { sender, authorized: true }
const read = (maxBytes, source = event) => handlers.get('home-v2-retained-viewer:readBytes')(source, { maxBytes, url: 'qdn-home-stream://resource/test' })
await read(1024 * 1024)
assert.equal(byteReads[0].maxBytes, 1024 * 1024)
assert.equal(byteReads[0].targetSession, sender.session)
await read(100 * 1024 * 1024)
for (const limit of [0, -1, NaN, Infinity, 1024 * 1024 + 1, 101 * 1024 * 1024, '1048576']) await assert.rejects(read(limit), /invalid/)
await assert.rejects(read(1024 * 1024, { sender, authorized: false }), /Unauthorized/)
assert.equal(byteReads.length, 2)
const open = (value, source = event) => handlers.get('home-v2-retained-viewer:openPublic')(source, value)
const close = id => handlers.get('home-v2-retained-viewer:closePublic')(event, id)
const request = { viewerId: 'viewer-one', location: 'qdn://IMAGE/Art/default' }
await assert.rejects(open(request, { sender, authorized: false }), /Unauthorized/)
await assert.rejects(open({ ...request, location: 'https://arbitrary.example/private' }))
await assert.rejects(open({ ...request, location: 'qdn://DOCUMENT_PRIVATE/Art/default' }))
assert.equal(requests.length, 0, 'Refused requests make no node calls')
const resource = await open(request)
assert.equal(resource.filename, 'art.png')
assert.equal(streams[0].binding.accountId, null)
assert.equal(streams[0].targetSession, sender.session)
assert.equal(await streams[0].isStillValid(), true)
assert.equal(requests.every(entry => !entry.options.headers && entry.options.redirect === 'error'), true)
close(request.viewerId)
assert.equal(await streams[0].isStillValid(), false)
await open(request)
let finishNode
readNode = () => new Promise(resolve => { finishNode = resolve })
const checking = streams[1].isStillValid()
close(request.viewerId)
finishNode(route)
assert.equal(await checking, false, 'Close during async route validation cannot admit a stream')
readNode = async () => route
await open(request)
route = { mode: 'custom', nodeApiUrl: 'https://other.example' }
assert.equal(await streams[2].isStillValid(), false)
await open(request)
sender.emit('did-start-navigation', {}, 'file:///shell.html', false, true)
assert.equal(await streams[3].isStillValid(), false, 'A replacement shell document cannot reuse old leases')
await open(request)
sender.emit('destroyed')
assert.equal(await streams[4].isStillValid(), false)
console.log('Public viewer IPC sender, upstream, account separation and lease revocation passed')
