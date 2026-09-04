import { createDecipheriv, createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { open, readFile, rm, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import yauzl, { type Entry, type ZipFile } from 'yauzl'

import { base58Encode } from './base58.js'
import type { QdnPublishAttestationMetadata } from './qdn-content-attestation.js'
import type { PublicArbitraryTransactionDetails } from './public-transaction-validation.js'

const AES_GCM_NONCE_BYTES = 12
const AES_GCM_TAG_BYTES = 16
const ARBITRARY_CHUNK_BYTES = 512 * 1024
export const QDN_STREAMING_ATTESTATION_METADATA_MAX_BYTES = 4 * 1024 * 1024
const MAX_ZIP_ENTRIES = 10_000
const MAX_ZIP_PATH_BYTES = 1_024

export type QdnStreamedArtifact = Readonly<{
  chunkHashes: readonly string[]
  path: string
  size: number
}>

function normalizeResourcePath(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '')
  const parts = normalized.split('/')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('\0') ||
    parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('QDN content attestation found an unsafe packaged path.')
  }
  if (new TextEncoder().encode(normalized).byteLength > MAX_ZIP_PATH_BYTES) {
    throw new Error('QDN content attestation found an oversized packaged path.')
  }
  return normalized
}

function equalHash(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
}

export function maximumJustifiedQdnFileArtifactBytes(sourceBytes: number) {
  if (!Number.isSafeInteger(sourceBytes) || sourceBytes < 1) {
    throw new Error('QDN streaming attestation requires a positive safe source size.')
  }
  return Math.ceil(sourceBytes * 1.1) + 64 * 1024 + AES_GCM_NONCE_BYTES + AES_GCM_TAG_BYTES
}

export async function streamQdnAttestationArtifact(input: {
  readonly destinationPath: string
  readonly expectedHash: Uint8Array
  readonly maximumBytes: number
  readonly response: Response
}): Promise<QdnStreamedArtifact> {
  if (input.expectedHash.byteLength !== 32) throw new Error('QDN builder returned an invalid artifact hash.')
  const declaredHeader = input.response.headers.get('content-length')
  const declared = declaredHeader === null ? null : Number(declaredHeader)
  if (declared !== null && Number.isFinite(declared) && declared > input.maximumBytes) {
    await input.response.body?.cancel()
    throw new Error('QDN attestation artifact exceeded the approved size.')
  }
  if (!input.response.ok || !input.response.body) {
    await input.response.body?.cancel()
    throw Object.assign(
      new Error(`QDN content attestation returned HTTP ${input.response.status}.`),
      { status: input.response.status },
    )
  }

  const output = await open(input.destinationPath, 'wx', 0o600)
  const reader = input.response.body.getReader()
  const fullHash = createHash('sha256')
  let chunkHash = createHash('sha256')
  let chunkBytes = 0
  let total = 0
  const chunkHashes: string[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      total += value.byteLength
      if (total > input.maximumBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error('QDN attestation artifact exceeded the approved size.')
      }
      fullHash.update(value)
      let offset = 0
      while (offset < value.byteLength) {
        const take = Math.min(ARBITRARY_CHUNK_BYTES - chunkBytes, value.byteLength - offset)
        chunkHash.update(value.subarray(offset, offset + take))
        chunkBytes += take
        offset += take
        if (chunkBytes === ARBITRARY_CHUNK_BYTES) {
          chunkHashes.push(base58Encode(new Uint8Array(chunkHash.digest())))
          chunkHash = createHash('sha256')
          chunkBytes = 0
        }
      }
      let written = 0
      while (written < value.byteLength) {
        const result = await output.write(value, written, value.byteLength - written)
        written += result.bytesWritten
      }
    }
    if (chunkBytes > 0) chunkHashes.push(base58Encode(new Uint8Array(chunkHash.digest())))
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    await output.close().catch(() => undefined)
    await rm(input.destinationPath, { force: true }).catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
    await output.close().catch(() => undefined)
  }
  if (!total || (declared !== null && Number.isFinite(declared) && declared !== total)) {
    await rm(input.destinationPath, { force: true }).catch(() => undefined)
    throw new Error('QDN attestation artifact has an invalid size.')
  }
  const actualHash = new Uint8Array(fullHash.digest())
  if (!equalHash(actualHash, input.expectedHash)) {
    await rm(input.destinationPath, { force: true }).catch(() => undefined)
    throw new Error('QDN attestation artifact did not match its signed content hash.')
  }
  return Object.freeze({
    chunkHashes: Object.freeze(total > ARBITRARY_CHUNK_BYTES ? chunkHashes : []),
    path: input.destinationPath,
    size: total,
  })
}

async function decryptArtifact(ciphertext: QdnStreamedArtifact, secret: Uint8Array) {
  if (secret.byteLength !== 32 || ciphertext.size <= AES_GCM_NONCE_BYTES + AES_GCM_TAG_BYTES) {
    throw new Error('QDN builder returned invalid encrypted content.')
  }
  const input = await open(ciphertext.path, 'r')
  const iv = Buffer.alloc(AES_GCM_NONCE_BYTES)
  const tag = Buffer.alloc(AES_GCM_TAG_BYTES)
  try {
    const ivRead = await input.read(iv, 0, iv.byteLength, 0)
    const tagRead = await input.read(tag, 0, tag.byteLength, ciphertext.size - tag.byteLength)
    if (ivRead.bytesRead !== iv.byteLength || tagRead.bytesRead !== tag.byteLength) {
      throw new Error('QDN builder returned truncated encrypted content.')
    }
  } finally {
    await input.close()
  }
  const plaintextPath = `${ciphertext.path}.plaintext`
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(secret), iv)
  decipher.setAuthTag(tag)
  try {
    await pipeline(
      createReadStream(ciphertext.path, {
        start: AES_GCM_NONCE_BYTES,
        end: ciphertext.size - AES_GCM_TAG_BYTES - 1,
      }),
      decipher,
      createWriteStream(plaintextPath, { flags: 'wx', mode: 0o600 }),
    )
    return plaintextPath
  } catch {
    await rm(plaintextPath, { force: true }).catch(() => undefined)
    throw new Error('QDN builder returned content that failed authenticated decryption.')
  }
}

function hashFile(path: string) {
  return new Promise<{ hash: string; size: number }>((resolve, reject) => {
    const hash = createHash('sha256')
    let size = 0
    const stream = createReadStream(path)
    stream.on('data', (value: Buffer | string) => {
      const chunk = typeof value === 'string' ? Buffer.from(value) : value
      hash.update(chunk)
      size += chunk.byteLength
    })
    stream.once('error', reject)
    stream.once('end', () => resolve({ hash: hash.digest('hex'), size }))
  })
}

function openZip(path: string) {
  return new Promise<ZipFile>((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error('QDN content attestation could not open the packaged ZIP.'))
      else resolve(zip)
    })
  })
}

function hashZipEntry(zip: ZipFile, entry: Entry, maximumBytes: number) {
  return new Promise<{ hash: string; size: number }>((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error('QDN content attestation could not read the packaged file.'))
        return
      }
      const hash = createHash('sha256')
      let size = 0
      stream.on('data', (chunk: Buffer) => {
        size += chunk.byteLength
        if (size > maximumBytes) {
          stream.destroy(new Error('QDN ZIP content exceeded the approved source size.'))
          return
        }
        hash.update(chunk)
      })
      stream.once('error', reject)
      stream.once('end', () => resolve({ hash: hash.digest('hex'), size }))
    })
  })
}

async function assertSingleFileZip(
  zipPath: string,
  expectedFileName: string,
  expectedHash: string,
  expectedSize: number,
) {
  const zip = await openZip(zipPath)
  const expectedPath = `data/${normalizeResourcePath(expectedFileName)}`
  let entries = 0
  let matched = false
  try {
    await new Promise<void>((resolve, reject) => {
      zip.once('error', reject)
      zip.once('end', resolve)
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          entries += 1
          if (entries > MAX_ZIP_ENTRIES) throw new Error('QDN ZIP content exceeded Home\'s entry-count limit.')
          const path = normalizeResourcePath(entry.fileName.replace(/\/$/, ''))
          if (entry.fileName.endsWith('/')) {
            if (path !== 'data') throw new Error('QDN builder added an unexpected packaged directory.')
            zip.readEntry()
            return
          }
          if (entry.generalPurposeBitFlag & 1) throw new Error('QDN builder returned an encrypted ZIP entry.')
          if (matched || entry.fileName !== expectedPath) {
            throw new Error('QDN builder changed the approved packaged file list.')
          }
          if (entry.uncompressedSize !== expectedSize) {
            throw new Error(`QDN builder changed the approved content at ${expectedFileName}.`)
          }
          const actual = await hashZipEntry(zip, entry, expectedSize)
          if (actual.size !== expectedSize || actual.hash !== expectedHash) {
            throw new Error(`QDN builder changed the approved content at ${expectedFileName}.`)
          }
          matched = true
          zip.readEntry()
        })().catch(reject)
      })
      zip.readEntry()
    })
  } finally {
    zip.close()
  }
  if (!matched) throw new Error('QDN builder changed the approved packaged file list.')
}

function limitedUtf8(value: string | undefined, maxBytes: number) {
  if (!value) return undefined
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const bytes = encoder.encode(value)
  if (bytes.length <= maxBytes) return value
  let end = maxBytes
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1
  return decoder.decode(bytes.subarray(0, end)) || undefined
}

function deriveMimeType(filePath: string, bytes: Uint8Array) {
  const extension = filePath.split('/').pop()?.split('.').pop()?.toLowerCase() ?? ''
  const byExtension: Record<string, string> = {
    gif: 'image/gif', htm: 'text/html', html: 'text/html', jpeg: 'image/jpeg', jpg: 'image/jpeg',
    json: 'application/json', pdf: 'application/pdf', png: 'image/png', svg: 'image/svg+xml',
    txt: 'text/plain', xml: 'application/xml', zip: 'application/zip',
  }
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-') return 'application/pdf'
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'application/zip'
  const textPrefix = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '')
  if (/^\s*<\?xml(?:\s|\?>)/i.test(textPrefix)) return 'application/xml'
  if (/^\s*(?:<!doctype\s+html|<html(?:\s|>))/i.test(textPrefix)) return 'text/html'
  return byExtension[extension]
}

function assertSecuritySensitiveMime(mimeType: string, filePath: string) {
  const extension = filePath.split('/').pop()?.split('.').pop()?.toLowerCase() ?? ''
  const markupMimes = ['application/xml', 'text/xml']
  const allowedByExtension: Record<string, string[]> = {
    html: ['text/html', 'application/xhtml+xml', ...markupMimes],
    htm: ['text/html', 'application/xhtml+xml', ...markupMimes],
    xhtml: ['text/html', 'application/xhtml+xml', ...markupMimes],
    svg: ['image/svg+xml', ...markupMimes], xml: markupMimes, xsl: markupMimes, xslt: markupMimes,
    js: ['application/javascript', 'text/javascript', 'application/x-javascript', 'application/ecmascript', 'text/ecmascript'],
    mjs: ['application/javascript', 'text/javascript', 'application/x-javascript', 'application/ecmascript', 'text/ecmascript'],
    cjs: ['application/javascript', 'text/javascript', 'application/x-javascript', 'application/ecmascript', 'text/ecmascript'],
    jsx: ['application/javascript', 'text/javascript', 'application/x-javascript', 'application/ecmascript', 'text/ecmascript'],
  }
  const allowed = allowedByExtension[extension]
  const sensitive = Object.values(allowedByExtension).some((values) => values.includes(mimeType)) ||
    mimeType.includes('javascript') || mimeType.endsWith('+xml')
  if ((allowed && !allowed.includes(mimeType)) || (!allowed && sensitive)) {
    throw new Error('QDN builder returned MIME metadata inconsistent with the approved file.')
  }
}

async function assertMetadata(input: {
  readonly bytes?: Uint8Array
  readonly chunkHashes: readonly string[]
  readonly expected: QdnPublishAttestationMetadata
  readonly fileName: string
  readonly rawSize: number
  readonly sourcePath: string
}) {
  const needsMetadata = input.rawSize > ARBITRARY_CHUNK_BYTES || Boolean(
    input.expected.title || input.expected.description || input.expected.category || input.expected.tags.length,
  )
  if (!input.bytes) {
    if (needsMetadata) throw new Error('QDN builder omitted required content metadata.')
    return
  }
  let metadata: Record<string, unknown>
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input.bytes))
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error()
    metadata = parsed as Record<string, unknown>
  } catch {
    throw new Error('QDN builder returned invalid content metadata.')
  }
  const allowedKeys = new Set(['title', 'description', 'tags', 'category', 'chunks', 'files', 'mimeType', 'entryPoint'])
  if (Object.keys(metadata).some((key) => !allowedKeys.has(key))) {
    throw new Error('QDN builder returned unexpected content metadata.')
  }
  const expectedStrings = [
    ['title', limitedUtf8(input.expected.title, 80)],
    ['description', limitedUtf8(input.expected.description, 240)],
    ['category', input.expected.category],
    ['entryPoint', input.expected.entryPoint],
  ] as const
  for (const [field, expected] of expectedStrings) {
    if ((typeof metadata[field] === 'string' ? metadata[field] : undefined) !== expected) {
      throw new Error(`QDN builder changed the approved ${field} metadata.`)
    }
  }
  const tags = input.expected.tags.filter((tag) => tag.length > 0 && tag.length <= 20).slice(0, 5)
  const actualTags = metadata.tags ?? []
  if (!Array.isArray(actualTags) || actualTags.some((tag) => typeof tag !== 'string') ||
      actualTags.length !== tags.length || actualTags.some((tag, index) => tag !== tags[index])) {
    throw new Error('QDN builder changed the approved tags metadata.')
  }
  const files = metadata.files ?? []
  if (!Array.isArray(files) || files.length !== 1 || files[0] !== normalizeResourcePath(input.fileName)) {
    throw new Error('QDN builder changed the approved packaged file list.')
  }
  const chunks = metadata.chunks ?? []
  if (!Array.isArray(chunks) || chunks.some((chunk) => typeof chunk !== 'string') || chunks.length !== input.chunkHashes.length) {
    throw new Error('QDN builder returned inconsistent chunk metadata.')
  }
  for (let index = 0; index < chunks.length; index += 1) {
    if (chunks[index] !== input.chunkHashes[index]) {
      throw new Error('QDN builder returned a mismatched chunk hash.')
    }
  }
  const source = await open(input.sourcePath, 'r')
  const prefix = Buffer.alloc(256)
  let prefixBytes = 0
  try {
    prefixBytes = (await source.read(prefix, 0, prefix.byteLength, 0)).bytesRead
  } finally {
    await source.close()
  }
  const derivedMime = deriveMimeType(input.fileName, prefix.subarray(0, prefixBytes))
  if (derivedMime && metadata.mimeType !== derivedMime) {
    throw new Error('QDN builder changed the deterministic MIME metadata.')
  }
  if (typeof metadata.mimeType !== 'undefined') {
    if (typeof metadata.mimeType !== 'string' || metadata.mimeType.length > 255 || !/^[\w.+-]+\/[\w.+-]+$/.test(metadata.mimeType)) {
      throw new Error('QDN builder returned invalid MIME metadata.')
    }
    assertSecuritySensitiveMime(metadata.mimeType.toLowerCase(), input.fileName)
  }
}

export async function verifyStreamedQdnFileAttestation(input: {
  readonly artifact: QdnStreamedArtifact
  readonly details: PublicArbitraryTransactionDetails
  readonly expectedMetadata: QdnPublishAttestationMetadata
  readonly fileName: string
  readonly metadataBytes?: Uint8Array
  readonly sourceHash: string
  readonly sourcePath: string
  readonly sourceSize: number
}) {
  await assertQdnArtifactFileSize(input.artifact)
  if (input.details.rawSize !== input.artifact.size) {
    throw new Error('QDN builder changed the encrypted content size.')
  }
  const plaintextPath = await decryptArtifact(input.artifact, input.details.secret)
  try {
    const expectedCompression = input.sourceSize <= 228 ? 0 : 1
    if (input.details.compression !== expectedCompression) {
      throw new Error('QDN builder changed the expected content compression.')
    }
    if (expectedCompression === 0) {
      const actual = await hashFile(plaintextPath)
      if (actual.size !== input.sourceSize || actual.hash !== input.sourceHash) {
        throw new Error('QDN builder changed the approved resource content.')
      }
    } else {
      await assertSingleFileZip(
        plaintextPath,
        input.fileName,
        input.sourceHash,
        input.sourceSize,
      )
    }
    await assertMetadata({
      bytes: input.metadataBytes,
      chunkHashes: input.artifact.chunkHashes,
      expected: input.expectedMetadata,
      fileName: input.fileName,
      rawSize: input.details.rawSize,
      sourcePath: input.sourcePath,
    })
  } finally {
    await rm(plaintextPath, { force: true }).catch(() => undefined)
  }
}

export async function readQdnStreamingMetadataArtifact(artifact: QdnStreamedArtifact) {
  if (artifact.size > QDN_STREAMING_ATTESTATION_METADATA_MAX_BYTES) {
    throw new Error('QDN builder returned oversized content metadata.')
  }
  return new Uint8Array(await readFile(artifact.path))
}

export async function assertQdnArtifactFileSize(artifact: QdnStreamedArtifact) {
  const actual = await stat(artifact.path)
  if (!actual.isFile() || actual.size !== artifact.size) {
    throw new Error('QDN attestation artifact changed while it was being verified.')
  }
}
