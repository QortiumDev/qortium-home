import assert from 'node:assert/strict'

import { evaluateHomeV2AdminTrust } from './home-v2-admin-trust.js'

// A binding id as the key store would mint it: random, credential-independent.
const BINDING = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'
import {
  HOME_V2_PREVIEW_UPLOAD_MAX_BASE64_LENGTH,
  HOME_V2_PREVIEW_UPLOAD_MAX_BYTES,
  homeV2PreviewUploadPath,
  isHomeV2PreviewRenderPath,
  resolveHomeV2PreviewUploadForFile,
} from './home-v2-preview-upload.js'
import { HOME_V2_PUBLISH_SOURCE_MAX_BYTES } from './home-v2-publish-source-tokens.js'

// --- The GATE: trust, not loopback ----------------------------------------
// The rule PREVIEW_QDN_PUBLISH_SOURCE now answers to (owner decision
// 2026-09-02). The accept case is deliberately a REMOTE HTTPS node: that is
// the user running their own Core on a VPS, which the old `mode === 'local'`
// gate refused outright.
{
  const remote = evaluateHomeV2AdminTrust({
    attached: { apiKey: 'user-key', bindingId: BINDING, origin: 'https://core.example' },
    mode: 'custom',
    network: 'qortium',
    nodeApiUrl: 'https://core.example',
  })
  assert.equal(remote.trusted, true)
  if (!remote.trusted) throw new Error('unreachable')
  assert.equal(remote.origin, 'https://core.example')
  assert.equal(remote.source, 'attached')

  // The managed local Core still qualifies -- it just is not the only thing
  // that does.
  const managed = evaluateHomeV2AdminTrust({
    managedApiKey: 'managed-key',
    managedBindingId: BINDING,
    mode: 'local',
    network: 'qortium',
    nodeApiUrl: 'http://127.0.0.1:24891',
  })
  assert.equal(managed.trusted, true)

  // A discovered public node is somebody else's Core: previewing would show an
  // operator the user's unpublished bytes.
  assert.deepEqual(
    evaluateHomeV2AdminTrust({
      mode: 'network',
      network: 'qortium',
      nodeApiUrl: 'https://public.example',
    }),
    { trusted: false, reason: 'public-node' },
  )
  // A custom node with no attached key administers nothing.
  assert.deepEqual(
    evaluateHomeV2AdminTrust({
      attached: null,
      mode: 'custom',
      network: 'qortium',
      nodeApiUrl: 'https://core.example',
    }),
    { trusted: false, reason: 'key-missing' },
  )
  // Plain HTTP to a remote host would put the key on the wire in the clear.
  assert.deepEqual(
    evaluateHomeV2AdminTrust({
      attached: { apiKey: 'user-key', bindingId: BINDING, origin: 'http://core.example:24891' },
      mode: 'custom',
      network: 'qortium',
      nodeApiUrl: 'http://core.example:24891',
    }),
    { trusted: false, reason: 'transport-unsafe' },
  )
  // ...but an SSH tunnel, which presents as plain HTTP to loopback, does not.
  assert.equal(
    evaluateHomeV2AdminTrust({
      attached: { apiKey: 'user-key', bindingId: BINDING, origin: 'http://127.0.0.1:24891' },
      mode: 'custom',
      network: 'qortium',
      nodeApiUrl: 'http://127.0.0.1:24891',
    }).trusted,
    true,
  )
  // The key is bound to the origin it was attached to; a moved node discards it.
  assert.deepEqual(
    evaluateHomeV2AdminTrust({
      attached: { apiKey: 'user-key', bindingId: BINDING, origin: 'https://old.example' },
      mode: 'custom',
      network: 'qortium',
      nodeApiUrl: 'https://core.example',
    }),
    { trusted: false, reason: 'origin-mismatch' },
  )
}

// --- The upload TARGET ----------------------------------------------------
assert.deepEqual(resolveHomeV2PreviewUploadForFile('site.zip'), {
  archive: true,
  filename: 'site.zip',
  service: 'WEBSITE',
})
// A standalone page is a FILE upload: Core wraps an HTML upload to the WEBSITE
// service as index.html by itself.
for (const name of ['page.html', 'page.HTM']) {
  const target = resolveHomeV2PreviewUploadForFile(name)
  assert.equal(target.archive, false)
  assert.equal(target.service, 'WEBSITE')
}
assert.equal(resolveHomeV2PreviewUploadForFile('clip.MP4').service, 'VIDEO')
assert.equal(resolveHomeV2PreviewUploadForFile('song.flac').service, 'AUDIO')
assert.equal(resolveHomeV2PreviewUploadForFile('photo.png').service, 'IMAGE')
// A directory component never survives into the filename Core is handed.
assert.equal(resolveHomeV2PreviewUploadForFile('/home/user/secret/photo.png').filename, 'photo.png')
assert.equal(resolveHomeV2PreviewUploadForFile('C:\\Users\\me\\photo.png').filename, 'photo.png')
for (const name of ['notes.docx', 'archive.tar.gz', 'noextension', '']) {
  assert.throws(() => resolveHomeV2PreviewUploadForFile(name), /Unsupported preview content/)
}

// --- The request PATH -----------------------------------------------------
assert.equal(
  homeV2PreviewUploadPath({ archive: true, filename: 'preview.zip', service: 'WEBSITE' }),
  '/arbitrary/preview/WEBSITE/upload?archive=true&filename=preview.zip',
)
assert.equal(
  homeV2PreviewUploadPath({ archive: false, filename: 'a b&c.png', service: 'IMAGE' }),
  '/arbitrary/preview/IMAGE/upload?archive=false&filename=a+b%26c.png',
)
assert.throws(
  () => homeV2PreviewUploadPath({ archive: false, filename: 'x.png', service: '../admin/stop' }),
  /Unsupported preview content/,
)

// --- The node's ANSWER ----------------------------------------------------
// It becomes a tab URL, so only a bare same-origin render path is accepted.
assert.equal(isHomeV2PreviewRenderPath('/render/hash/abc123'), true)
for (const value of [
  '',
  '/admin/stop',
  '//evil.example/render/hash/abc',
  'https://evil.example/render/hash/abc',
  '/render/hash/abc"onload=x',
  `/render/hash/${'a'.repeat(600)}`,
  42,
  null,
]) {
  assert.equal(isHomeV2PreviewRenderPath(value), false, `must refuse ${String(value).slice(0, 40)}`)
}

// --- The BOUND ------------------------------------------------------------
// The wire ceiling is the publish-source picker's own cap, not a new number
// invented for this path.
assert.equal(HOME_V2_PREVIEW_UPLOAD_MAX_BYTES, HOME_V2_PUBLISH_SOURCE_MAX_BYTES)
assert.equal(
  HOME_V2_PREVIEW_UPLOAD_MAX_BASE64_LENGTH,
  Math.ceil(HOME_V2_PREVIEW_UPLOAD_MAX_BYTES / 3) * 4 + 16,
)

console.log('Home v2 preview upload contract tests passed.')
