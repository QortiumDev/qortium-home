import assert from 'node:assert/strict'
import { createCipheriv, createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { zipSync } from 'fflate'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'

import { base58Encode } from './base58.js'
import {
  maximumJustifiedQdnFileArtifactBytes,
  streamQdnAttestationArtifact,
  verifyStreamedQdnFileAttestation,
} from './qdn-streaming-attestation.js'

const hash = (bytes: Uint8Array) => new Uint8Array(createHash('sha256').update(bytes).digest())
const encrypt = (plaintext: Uint8Array) => {
  const key = Buffer.alloc(32, 0x33)
  const iv = Buffer.alloc(12, 0x44)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  return {
    ciphertext: new Uint8Array(Buffer.concat([iv, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])),
    key: new Uint8Array(key),
  }
}
const chunks = (bytes: Uint8Array) => {
  if (bytes.byteLength <= 512 * 1024) return []
  const values: string[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += 512 * 1024) {
    values.push(base58Encode(hash(bytes.subarray(offset, Math.min(bytes.byteLength, offset + 512 * 1024)))))
  }
  return values
}

const root = await mkdtemp(nodePath.join(tmpdir(), 'qdn-stream-attestation-test-'))
try {
  const source = new Uint8Array(600 * 1024 + 31)
  for (let index = 0; index < source.length; index += 1) source[index] = (index * 131 + 17) & 0xff
  const sourcePath = nodePath.join(root, 'source.bin')
  await writeFile(sourcePath, source)
  const packaged = zipSync({ data: { 'video.bin': source } }, { level: 0 })
  const encrypted = encrypt(packaged)
  const metadataBytes = new TextEncoder().encode(JSON.stringify({
    chunks: chunks(encrypted.ciphertext),
    files: ['video.bin'],
    tags: [],
  }))
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < encrypted.ciphertext.length; offset += 73_001) {
        controller.enqueue(encrypted.ciphertext.subarray(offset, Math.min(encrypted.ciphertext.length, offset + 73_001)))
      }
      controller.close()
    },
  }), { headers: { 'content-length': String(encrypted.ciphertext.length) } })
  const artifact = await streamQdnAttestationArtifact({
    destinationPath: nodePath.join(root, 'artifact.bin'),
    expectedHash: hash(encrypted.ciphertext),
    maximumBytes: maximumJustifiedQdnFileArtifactBytes(source.length),
    response,
  })
  assert.deepEqual(artifact.chunkHashes, chunks(encrypted.ciphertext))
  await assert.doesNotReject(verifyStreamedQdnFileAttestation({
    artifact,
    details: {
      compression: 1,
      data: hash(encrypted.ciphertext),
      dataType: 0,
      metadataHash: hash(metadataBytes),
      rawSize: encrypted.ciphertext.length,
      secret: encrypted.key,
    },
    expectedMetadata: { tags: [] },
    fileName: 'video.bin',
    metadataBytes,
    sourceHash: Buffer.from(hash(source)).toString('hex'),
    sourcePath,
    sourceSize: source.length,
  }))

  const withoutLength = await streamQdnAttestationArtifact({
    destinationPath: nodePath.join(root, 'artifact-without-length.bin'),
    expectedHash: hash(encrypted.ciphertext),
    maximumBytes: maximumJustifiedQdnFileArtifactBytes(source.length),
    response: new Response(encrypted.ciphertext),
  })
  assert.equal(withoutLength.size, encrypted.ciphertext.length)

  await assert.rejects(streamQdnAttestationArtifact({
    destinationPath: nodePath.join(root, 'too-large.bin'),
    expectedHash: hash(encrypted.ciphertext),
    maximumBytes: encrypted.ciphertext.length - 1,
    response: new Response(encrypted.ciphertext),
  }), /exceeded the approved size/)

  // Real Fetch reproduces Core's gzip response: the decoded body and retained
  // wire Content-Length differ, even though the signed artifact is intact.
  const encoded = gzipSync(metadataBytes)
  assert.notEqual(encoded.length, metadataBytes.length)
  const server = createServer((_request, reply) => {
    reply.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Length': encoded.length })
    reply.end(encoded)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert(address && typeof address !== 'string')
    const url = `http://127.0.0.1:${address.port}/metadata`
    const decoded = await streamQdnAttestationArtifact({
      destinationPath: nodePath.join(root, 'gzip-metadata.bin'),
      expectedHash: hash(metadataBytes), maximumBytes: metadataBytes.length,
      response: await fetch(url),
    })
    assert.equal(decoded.size, metadataBytes.length)
    await assert.rejects(streamQdnAttestationArtifact({
      destinationPath: nodePath.join(root, 'gzip-too-large.bin'),
      expectedHash: hash(metadataBytes), maximumBytes: metadataBytes.length - 1,
      response: await fetch(url),
    }), /exceeded the approved size/)
    await assert.rejects(streamQdnAttestationArtifact({
      destinationPath: nodePath.join(root, 'gzip-wrong-hash.bin'),
      expectedHash: hash(new Uint8Array([1, 2, 3])), maximumBytes: metadataBytes.length,
      response: await fetch(url),
    }), /did not match its signed content hash/)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
  await assert.rejects(streamQdnAttestationArtifact({
    destinationPath: nodePath.join(root, 'identity-length-mismatch.bin'),
    expectedHash: hash(metadataBytes), maximumBytes: metadataBytes.length + 1,
    response: new Response(metadataBytes, {headers:{'Content-Encoding':'identity','Content-Length':String(metadataBytes.length + 1)}}),
  }), /invalid size/)
  await assert.rejects(streamQdnAttestationArtifact({
    destinationPath: nodePath.join(root, 'empty-gzip-body.bin'),
    expectedHash: hash(metadataBytes), maximumBytes: metadataBytes.length,
    response: new Response(new Uint8Array(), {headers:{'Content-Encoding':'gzip','Content-Length':'20'}}),
  }), /invalid size/)

} finally {
  await rm(root, { force: true, recursive: true })
}

console.log('QDN streaming attestation tests passed.')
