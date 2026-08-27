import {
  getQdnWriteResourceRequest,
  isRecord,
  type QdnAppRequest,
  type QdnWriteResourceRequest,
} from './qdn-request-values.js'
import { normalizeHomeV2PublishSourceToken } from './home-v2-publish-source-tokens.js'

export type HomeV2PublicPublishNetwork = 'qortal' | 'qortium'

export type HomeV2PublicPublishRequest = Readonly<{
  resource: QdnWriteResourceRequest
  sourceToken: string
}>

const DISALLOWED_SOURCE_FIELDS = [
  'base64',
  'data',
  'data64',
  'bytes',
  'bytesBase64',
  'file',
  'fileName',
  'filePath',
  'filename',
  'filepath',
  'mimeType',
  'path',
  'source',
  'sourceBase64',
  'uri',
] as const

export function normalizeHomeV2PublicPublishRequest(
  network: HomeV2PublicPublishNetwork,
  value: unknown,
): HomeV2PublicPublishRequest {
  if (!isRecord(value)) throw new Error('PUBLISH_QDN_RESOURCE request is required.')
  // Checked at the top level AND inside `payload`: the resource parser reads
  // payload-first, so a byte or path field nested there must get the same
  // named refusal instead of being silently ignored.
  const payload = isRecord(value.payload) ? value.payload : null
  for (const field of DISALLOWED_SOURCE_FIELDS) {
    for (const candidate of [value[field], payload?.[field]]) {
      if (candidate !== undefined && candidate !== null && candidate !== '') {
        throw new Error('Home 2 public publishing accepts only a Home-issued sourceToken, never paths or inline bytes.')
      }
    }
  }
  if (value.network !== undefined && value.network !== network) {
    throw new Error(`PUBLISH_QDN_RESOURCE network must match the invoked ${network} bridge.`)
  }
  const resource = getQdnWriteResourceRequest(value as QdnAppRequest)
  const maximumNameBytes = network === 'qortal' ? 400 : 40
  if (new TextEncoder().encode(resource.name).byteLength > maximumNameBytes) {
    throw new Error(`QDN resource name exceeds the ${maximumNameBytes} byte ${network} limit.`)
  }
  if (resource.name === '.' || resource.name === '..') {
    throw new Error('QDN resource name cannot be a dot segment.')
  }
  if (resource.identifier === '.' || resource.identifier === '..') {
    throw new Error('QDN resource identifier cannot be a dot segment.')
  }
  if (resource.identifier && new TextEncoder().encode(resource.identifier).byteLength > 64) {
    throw new Error('QDN resource identifier exceeds the 64 byte limit.')
  }
  if ((resource.fee ?? 0) !== 0) {
    throw new Error('Home derives the public-publish fee from the selected chain and does not accept an app-provided fee.')
  }
  const metadataLimits = [
    ['title', resource.title, 80],
    ['description', resource.description, 500],
    ['category', resource.category, 40],
  ] as const
  for (const [label, field, maximumBytes] of metadataLimits) {
    if (field && new TextEncoder().encode(field).byteLength > maximumBytes) {
      throw new Error(`QDN resource ${label} exceeds the ${maximumBytes} byte limit.`)
    }
  }
  if (resource.tags.length > 5 || resource.tags.some((tag) => new TextEncoder().encode(tag).byteLength > 20)) {
    throw new Error('QDN resource tags accept at most five values of 20 bytes each.')
  }
  if (
    network === 'qortal' &&
    (resource.title || resource.description || resource.category || resource.tags.length)
  ) {
    throw new Error('Qortal public publishing does not yet accept mutable resource metadata.')
  }
  return Object.freeze({
    resource: Object.freeze({ ...resource, tags: Object.freeze([...resource.tags]) as unknown as string[] }),
    sourceToken: normalizeHomeV2PublishSourceToken(value.sourceToken),
  })
}

export async function sha256Hex(bytes: Uint8Array) {
  const copy = Uint8Array.from(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

export function createHomeV2PublicPublishDescriptor(input: {
  readonly contentHash: string
  readonly fileName: string
  readonly network: HomeV2PublicPublishNetwork
  readonly resource: QdnWriteResourceRequest
  readonly size: number
  readonly transactionSignature: string
}) {
  return Object.freeze({
    accepted: true as const,
    immutable: Object.freeze({
      algorithm: 'SHA-256' as const,
      contentHash: input.contentHash,
      transactionSignature: input.transactionSignature,
    }),
    network: input.network,
    resource: Object.freeze({
      identifier: input.resource.identifier ?? null,
      name: input.resource.name,
      service: input.resource.service,
    }),
    source: Object.freeze({ fileName: input.fileName, size: input.size }),
    transactionSignature: input.transactionSignature,
  })
}
