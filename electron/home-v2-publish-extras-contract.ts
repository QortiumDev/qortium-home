import { getQdnWriteResourceRequest, isRecord, type QdnAppRequest } from './qdn-request-values.js'
import {
  normalizeHomeV2PublicPublishRequest,
  type HomeV2PublicPublishNetwork,
  type HomeV2PublicPublishRequest,
} from './home-v2-public-publish-contract.js'

// Prompt legibility bound: every batch item gets its own pinned Resource /
// File / Size / SHA-256 rows, so the batch must stay small enough for a
// person to actually read what they are approving. 1.x had no cap — and no
// per-item disclosure either. Documented tightening.
export const HOME_V2_PUBLISH_MULTIPLE_MAX_ITEMS = 10

export type HomeV2PublishMultipleRequest = Readonly<{
  items: readonly HomeV2PublicPublishRequest[]
}>

/**
 * PUBLISH_MULTIPLE_QDN_RESOURCES: a bounded array of items, each holding the
 * SAME contract as a single Home 2 publish — resource coordinate plus a
 * Home-issued sourceToken, never paths or inline bytes. Every token must be
 * distinct: 1.x resolved tokens per entry and released them only after the
 * loop, so one approved file selection could quietly back several
 * transactions.
 */
export function normalizeHomeV2PublishMultipleRequest(
  network: HomeV2PublicPublishNetwork,
  value: unknown,
): HomeV2PublishMultipleRequest {
  if (!isRecord(value)) throw new Error('PUBLISH_MULTIPLE_QDN_RESOURCES request is required.')
  if (value.network !== undefined && value.network !== network) {
    throw new Error(`PUBLISH_MULTIPLE_QDN_RESOURCES network must match the invoked ${network} bridge.`)
  }
  const payload = isRecord(value.payload) ? value.payload : null
  const resources = payload?.resources ?? value.resources
  if (!Array.isArray(resources) || resources.length < 1) {
    throw new Error('PUBLISH_MULTIPLE_QDN_RESOURCES requires a non-empty resources array.')
  }
  if (resources.length > HOME_V2_PUBLISH_MULTIPLE_MAX_ITEMS) {
    throw new Error(
      `PUBLISH_MULTIPLE_QDN_RESOURCES accepts at most ${HOME_V2_PUBLISH_MULTIPLE_MAX_ITEMS} resources per request.`,
    )
  }
  const items = resources.map((entry, index) => {
    try {
      if (!isRecord(entry)) throw new Error('each resource must be an object.')
      if (entry.network !== undefined && entry.network !== network) {
        throw new Error(`the resource network must match the invoked ${network} bridge.`)
      }
      return normalizeHomeV2PublicPublishRequest(network, entry)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'the resource is invalid.'
      throw new Error(`PUBLISH_MULTIPLE_QDN_RESOURCES resource ${index + 1}: ${reason}`)
    }
  })
  const tokens = new Set(items.map((item) => item.sourceToken))
  if (tokens.size !== items.length) {
    throw new Error('PUBLISH_MULTIPLE_QDN_RESOURCES requires a distinct sourceToken for every resource.')
  }
  return Object.freeze({ items: Object.freeze(items) })
}

// Fields a deletion must not carry: it signs no bytes and no metadata, so a
// request smuggling any of these is refused rather than silently ignored.
const DELETE_DISALLOWED_FIELDS = [
  'base64',
  'category',
  'data',
  'data64',
  'description',
  'file',
  'fileName',
  'filePath',
  'filename',
  'filepath',
  'path',
  'source',
  'sourceToken',
  'tag1',
  'tag2',
  'tag3',
  'tag4',
  'tag5',
  'tags',
  'title',
] as const

export type HomeV2QdnDeleteRequest = Readonly<{
  identifier: string | null
  name: string
  service: string
}>

/**
 * DELETE_QDN_RESOURCE: one resource coordinate, nothing else. The action
 * publishes the on-chain deletion tombstone (ARBITRARY method 2) — it is not
 * a local-copy removal — and is Qortium-only because the keyless delete
 * builder is a Qortium Core addition.
 */
export function normalizeHomeV2QdnDeleteRequest(value: unknown): HomeV2QdnDeleteRequest {
  if (!isRecord(value)) throw new Error('DELETE_QDN_RESOURCE request is required.')
  if (value.network !== undefined && value.network !== 'qortium') {
    throw new Error('DELETE_QDN_RESOURCE is available on the Qortium chain only.')
  }
  for (const field of DELETE_DISALLOWED_FIELDS) {
    const candidate = value[field] ?? (isRecord(value.payload) ? value.payload[field] : undefined)
    if (candidate !== undefined && candidate !== null && candidate !== '' &&
      !(Array.isArray(candidate) && candidate.length === 0)) {
      throw new Error(`DELETE_QDN_RESOURCE does not accept ${field}: a deletion signs no bytes or metadata.`)
    }
  }
  const resource = getQdnWriteResourceRequest(value as QdnAppRequest)
  if (new TextEncoder().encode(resource.name).byteLength > 40) {
    throw new Error('QDN resource name exceeds the 40 byte Qortium limit.')
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
    throw new Error('Home derives the deletion fee from the selected chain and does not accept an app-provided fee.')
  }
  return Object.freeze({
    identifier: resource.identifier && resource.identifier !== 'default' ? resource.identifier : null,
    name: resource.name,
    service: resource.service,
  })
}
