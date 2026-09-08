// STAGE_QDN_PUBLISH_SOURCE (attachments-matrix B1): lets an app hand Home
// bytes it already legitimately holds — a pasted screenshot, a drag-dropped
// file — and receive an ordinary Home-issued publish sourceToken back. The
// token-only publish contracts keep their inline-bytes denylist. The legacy
// public-publish adapter also uses this same bounded validator and store;
// its temporary tokens flow through the SAME pipeline
// as a picker selection (30-minute TTL, tab/account/route binding, the
// qdn.publish approval prompt, PUBLISH_QDN_RESOURCE / PUBLISH_CHAT_ATTACHMENT
// / PUBLISH_MULTIPLE_QDN_RESOURCES). Staging alone grants nothing: without
// the user approving a publish prompt, a staged blob only occupies bounded
// store memory until its TTL evicts it.
//
// This module is deliberately pure (no electron imports) so its validation
// is unit-testable the same way the token store is.

export const HOME_V2_PUBLISH_BLOB_MAX_BYTES = 25 * 1024 * 1024

const BASE64_SHAPE = /^[A-Za-z0-9+/]*={0,2}$/
const MIME_SHAPE = /^[\w.+-]+\/[\w.+-]+$/

export type HomeV2PublishBlobRequest = Readonly<{
  bytes: Uint8Array
  fileName: string
  mimeType: string | null
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function sanitizeHomeV2BlobFileName(value: unknown) {
  const requested = typeof value === 'string' ? value.trim() : ''
  // Last path segment only (an app-supplied name must never traverse), then
  // the same character policy as the resource-save sanitizer.
  const leaf = requested.split(/[\\/]+/).pop() ?? ''
  const sanitized = leaf
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 180)
  return sanitized || 'qdn-resource'
}

// Validate without decoding: the compatibility adapter uses this to budget a
// whole legacy batch before allocating even its first source.
export function homeV2PublishBlobByteLength(encoded: unknown): number {
  if (typeof encoded !== 'string' || !encoded) {
    throw new Error('STAGE_QDN_PUBLISH_SOURCE requires bytesBase64.')
  }
  if (encoded.length > Math.ceil(HOME_V2_PUBLISH_BLOB_MAX_BYTES / 3) * 4) {
    throw new Error('STAGE_QDN_PUBLISH_SOURCE accepts at most 25 MiB.')
  }
  if (encoded.length % 4 !== 0 || !BASE64_SHAPE.test(encoded)) {
    throw new Error('STAGE_QDN_PUBLISH_SOURCE bytesBase64 must be valid base64.')
  }
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const lastValue = alphabet.indexOf(encoded[encoded.length - padding - 1] ?? '')
  if (padding && (lastValue < 0 || lastValue % (padding === 2 ? 16 : 4) !== 0)) {
    throw new Error('STAGE_QDN_PUBLISH_SOURCE bytesBase64 must be canonical base64.')
  }
  const size = encoded.length / 4 * 3 - padding
  if (size < 1) throw new Error('STAGE_QDN_PUBLISH_SOURCE bytes cannot be empty.')
  if (size > HOME_V2_PUBLISH_BLOB_MAX_BYTES) {
    throw new Error('STAGE_QDN_PUBLISH_SOURCE accepts at most 25 MiB.')
  }
  return size
}

export function normalizeHomeV2PublishBlobRequest(value: unknown): HomeV2PublishBlobRequest {
  if (!isRecord(value)) throw new Error('STAGE_QDN_PUBLISH_SOURCE request is required.')

  const encoded = value.bytesBase64
  homeV2PublishBlobByteLength(encoded)
  const bytes = Uint8Array.from(Buffer.from(encoded as string, 'base64'))

  const mimeValue = value.mimeType
  let mimeType: string | null = null
  if (mimeValue !== undefined && mimeValue !== null && mimeValue !== '') {
    if (typeof mimeValue !== 'string' || mimeValue.length > 100 || !MIME_SHAPE.test(mimeValue)) {
      throw new Error('STAGE_QDN_PUBLISH_SOURCE mimeType is invalid.')
    }
    mimeType = mimeValue
  }

  return Object.freeze({
    bytes,
    fileName: sanitizeHomeV2BlobFileName(value.fileName),
    mimeType,
  })
}
