import assert from 'node:assert/strict'
import {
  HOME_V2_PUBLISH_BLOB_MAX_BYTES,
  normalizeHomeV2PublishBlobRequest,
  sanitizeHomeV2BlobFileName,
} from './home-v2-publish-blob-source.js'

const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const pngBase64 = Buffer.from(pngBytes).toString('base64')

// Accepts a well-formed request and round-trips the bytes.
{
  const request = normalizeHomeV2PublishBlobRequest({
    bytesBase64: pngBase64,
    fileName: 'shot.png',
    mimeType: 'image/png',
  })
  assert.deepEqual(Array.from(request.bytes), Array.from(pngBytes))
  assert.equal(request.fileName, 'shot.png')
  assert.equal(request.mimeType, 'image/png')
}

// mimeType is optional and empty collapses to null.
assert.equal(
  normalizeHomeV2PublishBlobRequest({ bytesBase64: pngBase64, fileName: 'a.bin', mimeType: '' }).mimeType,
  null,
)

// File names are sanitized like the resource-save path (traversal, control
// characters, trailing dots) and never come back empty.
assert.equal(sanitizeHomeV2BlobFileName('../..\\evil<name>.png.'), 'evil_name_.png')
assert.equal(sanitizeHomeV2BlobFileName('shot 2.png'), 'shot 2.png')
assert.equal(sanitizeHomeV2BlobFileName('   '), 'qdn-resource')
assert.equal(sanitizeHomeV2BlobFileName(undefined), 'qdn-resource')
assert.equal(sanitizeHomeV2BlobFileName('x'.repeat(400)).length, 180)

// Refusals: missing/invalid base64, empty payload, bad mime, oversized —
// and the oversize check must fire on the ENCODED length, before decoding.
assert.throws(() => normalizeHomeV2PublishBlobRequest(null), /request is required/)
assert.throws(() => normalizeHomeV2PublishBlobRequest({ fileName: 'a' }), /requires bytesBase64/)
assert.throws(() => normalizeHomeV2PublishBlobRequest({ bytesBase64: 'not base64!!' }), /valid base64/)
assert.throws(() => normalizeHomeV2PublishBlobRequest({ bytesBase64: 'AA=A' }), /valid base64/)
assert.throws(() => normalizeHomeV2PublishBlobRequest({ bytesBase64: '' }), /requires bytesBase64/)
assert.throws(
  () => normalizeHomeV2PublishBlobRequest({ bytesBase64: pngBase64, mimeType: 'nonsense' }),
  /mimeType is invalid/,
)
{
  const oversizedEncodedLength = (Math.ceil(HOME_V2_PUBLISH_BLOB_MAX_BYTES / 3) + 1) * 4
  const oversized = 'A'.repeat(oversizedEncodedLength)
  assert.throws(() => normalizeHomeV2PublishBlobRequest({ bytesBase64: oversized }), /at most 25 MiB/)
}

console.log('home-v2-publish-blob-source.test: ok')
