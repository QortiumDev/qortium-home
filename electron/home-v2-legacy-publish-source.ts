import { isRecord } from './qdn-request-values.js'
import {
  HOME_V2_PUBLISH_BLOB_MAX_BYTES,
  homeV2PublishBlobByteLength,
  sanitizeHomeV2BlobFileName,
} from './home-v2-publish-blob-source.js'
import { normalizeHomeV2PublicPublishRequest, type HomeV2PublicPublishNetwork } from './home-v2-public-publish-contract.js'
import { normalizeHomeV2PublishMultipleRequest, HOME_V2_PUBLISH_MULTIPLE_MAX_ITEMS } from './home-v2-publish-extras-contract.js'
import { normalizeHomeV2PublishSourceToken } from './home-v2-publish-source-tokens.js'

// Only the deployed base64 + filename pair is adapted. All other source
// representations still belong to explicitly named source-selection actions.
const SOURCE_FIELDS = [
  'base64', 'filename', 'sourceToken', 'data', 'data64', 'dataBase64', 'bytes', 'bytesBase64',
  'encrypt', 'encryption', 'publicKeys', 'recipientPublicKey',
  'file', 'fileName', 'filePath', 'filepath', 'mimeType', 'path', 'source', 'sourceBase64', 'uri',
] as const
const owns = (value: Record<string, unknown>, key: string) => Object.hasOwn(value, key)
const hasInline = (value: unknown): boolean => isRecord(value) &&
  (owns(value, 'base64') || owns(value, 'filename') ||
    (isRecord(value.payload) && (owns(value.payload, 'base64') || owns(value.payload, 'filename'))))

export type HomeV2LegacyPublishStageRequest = Readonly<{ bytesBase64: string; fileName: string }>

/**
 * Account/route authorization belongs to the caller and must run first. This
 * adapter never prompts or submits: it leases ordinary bound sources to the
 * unchanged token-only publisher, then releases only the tokens it issued.
 */
export async function withHomeV2LegacyPublishSources<T>(
  network: HomeV2PublicPublishNetwork,
  value: Record<string, unknown>,
  multiple: boolean,
  stage: (request: HomeV2LegacyPublishStageRequest) => { sourceToken: string } | Promise<{ sourceToken: string }>,
  release: (token: string) => void,
  publish: (request: Record<string, unknown>) => Promise<T>,
): Promise<T> {
  const payload = isRecord(value.payload) ? value.payload : null
  if (multiple && [value, payload].some((candidate) => candidate && SOURCE_FIELDS.some((field) => owns(candidate, field)))) {
    throw new Error('Publish batch sources belong only to individual resources, never the batch or its payload.')
  }
  const candidates = multiple ? payload?.resources ?? value.resources : [value]
  const legacy = multiple
    ? [value.resources, payload?.resources].some((items) => Array.isArray(items) && items.some(hasInline))
    : hasInline(value)
  if (!legacy) {
    // Preserve the complete existing token-only contract and token lifetime.
    return publish(value)
  }
  if (multiple && (owns(value, 'payload') || SOURCE_FIELDS.some((field) => owns(value, field)))) {
    throw new Error('Legacy publish batches require only top-level resources, without batch source fields or payload.')
  }
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > HOME_V2_PUBLISH_MULTIPLE_MAX_ITEMS) {
    throw new Error(`Legacy publishing accepts at most ${HOME_V2_PUBLISH_MULTIPLE_MAX_ITEMS} resources.`)
  }
  let total = 0
  const plans = candidates.map((entry, index) => {
    if (!isRecord(entry) || !owns(entry, 'base64') || !owns(entry, 'filename') || owns(entry, 'payload')) {
      throw new Error('Legacy publishing requires a top-level base64 and filename pair for every resource.')
    }
    if (SOURCE_FIELDS.some((field) => field !== 'base64' && field !== 'filename' && owns(entry, field))) {
      throw new Error('Legacy publishing cannot mix inline bytes with tokens, paths or other source fields.')
    }
    const fileName = entry.filename
    if (typeof fileName !== 'string' || !fileName || fileName !== fileName.trim() ||
        fileName !== sanitizeHomeV2BlobFileName(fileName) || /[\\/]/.test(fileName)) {
      throw new Error('Legacy publish filename must be a valid leaf filename, never a path.')
    }
    total += homeV2PublishBlobByteLength(entry.base64)
    if (total > HOME_V2_PUBLISH_BLOB_MAX_BYTES) {
      throw new Error('Legacy publishing accepts at most 25 MiB of inline sources per request.')
    }
    const { base64, filename: _filename, ...resource } = entry
    // Validate all coordinates, chain restrictions and metadata BEFORE staging.
    // These placeholders never enter a token store or reach the publisher.
    const sourceToken = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    const request = { ...resource, sourceToken }
    normalizeHomeV2PublicPublishRequest(network, request)
    return { request, source: { bytesBase64: base64 as string, fileName } }
  })
  if (multiple) normalizeHomeV2PublishMultipleRequest(network, { ...value, resources: plans.map((plan) => plan.request) })
  const issued: string[] = []
  try {
    for (const plan of plans) {
      const selection = await stage(plan.source)
      const token = normalizeHomeV2PublishSourceToken(selection.sourceToken)
      issued.push(token)
      plan.request.sourceToken = token
    }
    const request = multiple ? { ...value, resources: plans.map((plan) => plan.request) } : plans[0].request
    return await publish(request)
  } finally {
    // Includes failed staging, consent denial, invalidation and unknown outcomes.
    // Explicit caller-issued tokens are never part of this lease.
    for (const token of issued) release(token)
  }
}
