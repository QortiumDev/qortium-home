import { Sha256 } from 'asmcrypto.js';
import { unzipSync } from 'fflate';

import { BASE58_ALPHABET } from './base58.js';
import type { PublicArbitraryTransactionDetails } from './public-transaction-validation.js';

const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const ARBITRARY_CHUNK_BYTES = 512 * 1024;
export const PUBLIC_QDN_ATTESTATION_MAX_BYTES = 1024 * 1024 * 1024;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 10_000;
const MAX_ZIP_PATH_BYTES = 1_024;
const BASE58_MAP = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));

export type QdnPublishAttestationSource = {
  bytes: Uint8Array;
  filename: string;
  unpackZip: boolean;
};

export type QdnPublishAttestationMetadata = {
  category?: string;
  description?: string;
  entryPoint?: string;
  tags: string[];
  title?: string;
};

export type FetchQdnAttestationArtifact = (hash: Uint8Array, maxBytes: number) => Promise<Uint8Array>;
export type QdnPublishVerificationInput = {
  ciphertext: Uint8Array;
  details: PublicArbitraryTransactionDetails;
  expectedMetadata: QdnPublishAttestationMetadata;
  metadataBytes?: Uint8Array;
  source: QdnPublishAttestationSource;
};

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sha256(bytes: Uint8Array) {
  const result = new Sha256().process(bytes).finish().result;
  if (!result) throw new Error('QDN content attestation could not compute SHA-256.');
  return new Uint8Array(result);
}

function decodeBase58(value: string) {
  if (!value) return new Uint8Array(0);
  const bytes = [0];
  for (const character of value) {
    const digit = BASE58_MAP.get(character);
    if (typeof digit === 'undefined') throw new Error('QDN metadata contained an invalid chunk hash.');
    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      const next = bytes[index] * 58 + carry;
      bytes[index] = next & 0xff;
      carry = next >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let index = 0; value[index] === '1' && index < value.length - 1; index += 1) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

function assertBounded(bytes: Uint8Array, label: string) {
  if (bytes.byteLength > PUBLIC_QDN_ATTESTATION_MAX_BYTES + AES_GCM_NONCE_BYTES + AES_GCM_TAG_BYTES) {
    throw new Error(`${label} exceeded Home's bounded public QDN attestation limit.`);
  }
}

function normalizeResourcePath(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = normalized.split('/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('\0') ||
    parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('QDN content attestation found an unsafe packaged path.');
  }
  if (new TextEncoder().encode(normalized).byteLength > MAX_ZIP_PATH_BYTES) {
    throw new Error('QDN content attestation found an oversized packaged path.');
  }
  return normalized;
}

function normalizeCoreSourceZipPath(value: string) {
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value)) {
    throw new Error('QDN content attestation found an absolute source ZIP path.');
  }
  return normalizeResourcePath(value.split('/').map((segment) => {
    const sanitized = segment.replace(/[<>:"\\|?*]/g, '').trim();
    return sanitized || '_';
  }).join('/'));
}

function unzipFiles(bytes: Uint8Array, stripDataRoot: boolean) {
  let inflatedBytes = 0;
  let entryCount = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter(file) {
        entryCount += 1;
        if (entryCount > MAX_ZIP_ENTRIES) {
          throw new Error('QDN ZIP content exceeded Home\'s entry-count limit.');
        }
        if (new TextEncoder().encode(file.name).byteLength > MAX_ZIP_PATH_BYTES + (stripDataRoot ? 5 : 0)) {
          throw new Error('QDN ZIP content contained an oversized path.');
        }
        if (file.name.endsWith('/')) return false;
        inflatedBytes += file.originalSize;
        if (inflatedBytes > PUBLIC_QDN_ATTESTATION_MAX_BYTES) {
          throw new Error('QDN ZIP content exceeded Home\'s bounded attestation limit.');
        }
        return true;
      },
    });
  } catch (error) {
    throw error instanceof Error && (error.message.includes('bounded attestation') ||
      error.message.includes('entry-count limit') || error.message.includes('oversized path'))
      ? error
      : new Error('QDN content attestation could not decode the packaged ZIP.');
  }

  const files = new Map<string, Uint8Array>();
  for (const [rawPath, data] of Object.entries(entries)) {
    if (stripDataRoot && !rawPath.startsWith('data/')) {
      throw new Error('QDN content attestation found a packaged file outside the data root.');
    }
    const path = stripDataRoot
      ? normalizeResourcePath(rawPath.slice('data/'.length))
      : normalizeCoreSourceZipPath(rawPath);
    if (files.has(path)) throw new Error('QDN content attestation found a duplicate packaged path.');
    files.set(path, data);
  }
  return files;
}

function expectedFiles(source: QdnPublishAttestationSource) {
  if (source.unpackZip) return unzipFiles(source.bytes, false);
  return new Map([[normalizeResourcePath(source.filename), source.bytes]]);
}

function assertFileMapsEqual(actual: Map<string, Uint8Array>, expected: Map<string, Uint8Array>) {
  if (actual.size !== expected.size) {
    throw new Error('Public QDN builder changed the approved packaged file list.');
  }
  for (const [path, bytes] of expected) {
    const actualBytes = actual.get(path);
    if (!actualBytes || !equalBytes(actualBytes, bytes)) {
      throw new Error(`Public QDN builder changed the approved content at ${path}.`);
    }
  }
}

function limitedUtf8(value: string | undefined, maxBytes: number) {
  if (!value) return undefined;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(value);
  if (bytes.length <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return decoder.decode(bytes.subarray(0, end)) || undefined;
}

function expectedTags(tags: string[]) {
  return tags.filter((tag) => tag.length > 0 && tag.length <= 20).slice(0, 5);
}

function assertStringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Public QDN builder returned invalid ${label} metadata.`);
  }
  return value as string[];
}

function assertOptionalMetadataString(actual: unknown, expected: string | undefined, label: string) {
  if ((typeof actual === 'string' ? actual : undefined) !== expected) {
    throw new Error(`Public QDN builder changed the approved ${label} metadata.`);
  }
}

function assertMetadata(
  bytes: Uint8Array,
  ciphertext: Uint8Array,
  files: Map<string, Uint8Array>,
  expected: QdnPublishAttestationMetadata,
) {
  let metadata: Record<string, unknown>;
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    metadata = parsed as Record<string, unknown>;
  } catch {
    throw new Error('Public QDN builder returned invalid content metadata.');
  }

  const allowedKeys = new Set(['title', 'description', 'tags', 'category', 'chunks', 'files', 'mimeType', 'entryPoint']);
  if (Object.keys(metadata).some((key) => !allowedKeys.has(key))) {
    throw new Error('Public QDN builder returned unexpected content metadata.');
  }

  assertOptionalMetadataString(metadata.title, limitedUtf8(expected.title, 80), 'title');
  assertOptionalMetadataString(metadata.description, limitedUtf8(expected.description, 240), 'description');
  assertOptionalMetadataString(metadata.category, expected.category, 'category');
  assertOptionalMetadataString(metadata.entryPoint, expected.entryPoint, 'entry point');

  const tags = assertStringArray(metadata.tags ?? [], 'tags');
  const wantedTags = expectedTags(expected.tags);
  if (tags.length !== wantedTags.length || tags.some((tag, index) => tag !== wantedTags[index])) {
    throw new Error('Public QDN builder changed the approved tags metadata.');
  }

  const packagedFiles = assertStringArray(metadata.files ?? [], 'files').map((path) => normalizeResourcePath(path)).sort();
  const wantedFiles = [...files.keys()].sort();
  if (packagedFiles.length !== wantedFiles.length || packagedFiles.some((file, index) => file !== wantedFiles[index])) {
    throw new Error('Public QDN builder changed the approved files metadata.');
  }

  const chunks = assertStringArray(metadata.chunks ?? [], 'chunks');
  const expectedChunkCount = ciphertext.byteLength > ARBITRARY_CHUNK_BYTES
    ? Math.ceil(ciphertext.byteLength / ARBITRARY_CHUNK_BYTES)
    : 0;
  if (chunks.length !== expectedChunkCount) {
    throw new Error('Public QDN builder returned inconsistent chunk metadata.');
  }
  for (let index = 0; index < chunks.length; index += 1) {
    const start = index * ARBITRARY_CHUNK_BYTES;
    const expectedHash = sha256(ciphertext.subarray(start, Math.min(ciphertext.length, start + ARBITRARY_CHUNK_BYTES)));
    if (!equalBytes(decodeBase58(chunks[index]), expectedHash)) {
      throw new Error('Public QDN builder returned a mismatched chunk hash.');
    }
  }

  const onlyFile = files.size === 1 ? files.entries().next().value as [string, Uint8Array] : null;
  const derivedMime = onlyFile ? deriveMimeType(onlyFile[0], onlyFile[1]) : undefined;
  if (derivedMime && metadata.mimeType !== derivedMime) {
    throw new Error('Public QDN builder changed the deterministic MIME metadata.');
  }
  if (!onlyFile && typeof metadata.mimeType !== 'undefined') {
    throw new Error('Public QDN builder returned MIME metadata for a multi-file resource.');
  }
  if (typeof metadata.mimeType !== 'undefined') {
    if (files.size !== 1 || typeof metadata.mimeType !== 'string' || metadata.mimeType.length > 255 ||
      !/^[\w.+-]+\/[\w.+-]+$/.test(metadata.mimeType)) {
      throw new Error('Public QDN builder returned invalid MIME metadata.');
    }
    const [filePath, fileBytes] = onlyFile!;
    assertSecuritySensitiveMime(metadata.mimeType.toLowerCase(), filePath);
  }
}

function assertSecuritySensitiveMime(mimeType: string, filePath: string) {
  const extension = filePath.split('/').pop()?.split('.').pop()?.toLowerCase() ?? '';
  const markupMimes = ['application/xml', 'text/xml'];
  const allowedByExtension: Record<string, string[]> = {
    html: ['text/html', 'application/xhtml+xml', ...markupMimes],
    htm: ['text/html', 'application/xhtml+xml', ...markupMimes],
    xhtml: ['text/html', 'application/xhtml+xml', ...markupMimes],
    svg: ['image/svg+xml', ...markupMimes],
    xml: markupMimes,
    xsl: markupMimes,
    xslt: markupMimes,
    js: ['application/javascript', 'text/javascript', 'application/x-javascript', 'application/ecmascript', 'text/ecmascript'],
    mjs: ['application/javascript', 'text/javascript', 'application/x-javascript', 'application/ecmascript', 'text/ecmascript'],
    cjs: ['application/javascript', 'text/javascript', 'application/x-javascript', 'application/ecmascript', 'text/ecmascript'],
    jsx: ['application/javascript', 'text/javascript', 'application/x-javascript', 'application/ecmascript', 'text/ecmascript'],
  };
  const allowedForExtension = allowedByExtension[extension];
  const isSecuritySensitiveMime = Object.values(allowedByExtension).some((allowed) => allowed.includes(mimeType)) ||
    mimeType.includes('javascript') || mimeType.endsWith('+xml');
  if ((allowedForExtension && !allowedForExtension.includes(mimeType)) ||
    (!allowedForExtension && isSecuritySensitiveMime)) {
    throw new Error('Public QDN builder returned MIME metadata inconsistent with the approved file.');
  }
}

function deriveMimeType(filePath: string, bytes: Uint8Array) {
  const extension = filePath.split('/').pop()?.split('.').pop()?.toLowerCase() ?? '';
  const byExtension: Record<string, string> = {
    gif: 'image/gif', htm: 'text/html', html: 'text/html', jpeg: 'image/jpeg', jpg: 'image/jpeg',
    json: 'application/json', pdf: 'application/pdf', png: 'image/png', svg: 'image/svg+xml',
    txt: 'text/plain', xml: 'application/xml', zip: 'application/zip',
  };
  if (bytes.length >= 8 && equalBytes(bytes.subarray(0, 8), Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10))) return 'image/png';
  if (bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-') return 'application/pdf';
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'application/zip';
  const textPrefix = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256))).replace(/^\uFEFF/, '');
  if (/^\s*<\?xml(?:\s|\?>)/i.test(textPrefix)) return 'application/xml';
  if (/^\s*(?:<!doctype\s+html|<html(?:\s|>))/i.test(textPrefix)) return 'text/html';
  return byExtension[extension];
}

async function decryptPayload(ciphertext: Uint8Array, secret: Uint8Array) {
  if (secret.length !== 32 || ciphertext.length < AES_GCM_NONCE_BYTES + AES_GCM_TAG_BYTES) {
    throw new Error('Public QDN builder returned invalid encrypted content.');
  }
  try {
    const keyBytes = Uint8Array.from(secret);
    const iv = Uint8Array.from(ciphertext.subarray(0, AES_GCM_NONCE_BYTES));
    const encrypted = Uint8Array.from(ciphertext.subarray(AES_GCM_NONCE_BYTES));
    const key = await globalThis.crypto.subtle.importKey('raw', keyBytes.buffer, 'AES-GCM', false, ['decrypt']);
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer, tagLength: 128 },
      key,
      encrypted.buffer,
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new Error('Public QDN builder returned content that failed authenticated decryption.');
  }
}

export async function attestPublicQdnPublish({
  details,
  expectedMetadata,
  fetchArtifact,
  source,
  verify = verifyPublicQdnPublishArtifacts,
}: {
  details: PublicArbitraryTransactionDetails;
  expectedMetadata: QdnPublishAttestationMetadata;
  fetchArtifact: FetchQdnAttestationArtifact;
  source: QdnPublishAttestationSource;
  verify?: (input: QdnPublishVerificationInput) => Promise<void>;
}) {
  assertBounded(source.bytes, 'Approved QDN source');
  if (details.dataType === 0 && details.data.length !== 32) {
    throw new Error('Public QDN builder returned an invalid content hash.');
  }

  // details.rawSize is a value the NODE claims about content it hasn't
  // handed over yet - trusting it unconditionally as the download cap
  // would let a hostile node force Home to download/decrypt/inflate up
  // to PUBLIC_QDN_ATTESTATION_MAX_BYTES regardless of how small the
  // approved publish actually was. Bound it against what the approved
  // source can actually justify instead. The margin must account for
  // more than encryption overhead: Core repacks a multi-file publish
  // into its OWN zip (explicit directory entries, extended-timestamp
  // extra fields, data descriptors), measurably larger per entry than
  // the zip Home's own fflate-based zipSync produces as the approved
  // source - so the allowance scales with entry count, not just total
  // size, or ordinary many-small-file publishes (icon sets, locale
  // packs) would be rejected as if the node had tampered.
  const entryCount = source.unpackZip ? unzipFiles(source.bytes, false).size : 1;
  const maxJustifiedCiphertextBytes = Math.ceil(source.bytes.byteLength * 1.1) + 4096 + 256 * entryCount;
  if (details.rawSize > maxJustifiedCiphertextBytes) {
    throw new Error('Public QDN builder claimed a content size inconsistent with the approved publish.');
  }

  const ciphertext = details.dataType === 1 ? details.data : await fetchArtifact(details.data, details.rawSize);
  const metadataBytes = details.metadataHash.length === 32
    ? await fetchArtifact(details.metadataHash, MAX_METADATA_BYTES)
    : undefined;
  await verify({ details, expectedMetadata, source, ciphertext, metadataBytes });
}

export async function verifyPublicQdnPublishArtifacts({
  ciphertext,
  details,
  expectedMetadata,
  metadataBytes,
  source,
}: QdnPublishVerificationInput) {
  assertBounded(ciphertext, 'Public QDN ciphertext');
  if (details.rawSize !== ciphertext.byteLength) {
    throw new Error('Public QDN builder changed the encrypted content size.');
  }
  if (details.dataType === 0 && !equalBytes(sha256(ciphertext), details.data)) {
    throw new Error('Public QDN builder returned ciphertext that does not match the signed content hash.');
  }

  const plaintext = await decryptPayload(ciphertext, details.secret);
  const files = expectedFiles(source);
  const onlyFile = files.size === 1 ? files.values().next().value as Uint8Array : null;
  const expectedCompression = onlyFile && onlyFile.byteLength <= 228 ? 0 : 1;
  if (details.compression !== expectedCompression) {
    throw new Error('Public QDN builder changed the expected content compression.');
  }

  if (details.compression === 0) {
    if (files.size !== 1 || !equalBytes(plaintext, files.values().next().value as Uint8Array)) {
      throw new Error('Public QDN builder changed the approved resource content.');
    }
  } else {
    assertFileMapsEqual(unzipFiles(plaintext, true), files);
  }

  if (details.metadataHash.length === 0) {
    const needsMetadata = files.size > 1 || details.rawSize > ARBITRARY_CHUNK_BYTES ||
      Boolean(expectedMetadata.title || expectedMetadata.description || expectedMetadata.category || expectedMetadata.tags.length);
    if (needsMetadata) throw new Error('Public QDN builder omitted required content metadata.');
  } else {
    if (details.metadataHash.length !== 32) throw new Error('Public QDN builder returned an invalid metadata hash.');
    if (!metadataBytes) throw new Error('Public QDN builder omitted the attestation metadata artifact.');
    if (metadataBytes.byteLength === 0 || metadataBytes.byteLength > MAX_METADATA_BYTES) {
      throw new Error('Public QDN builder returned empty or oversized content metadata.');
    }
    if (!equalBytes(sha256(metadataBytes), details.metadataHash)) {
      throw new Error('Public QDN builder returned metadata that does not match the signed metadata hash.');
    }
    assertMetadata(metadataBytes, ciphertext, files, expectedMetadata);
  }
}
