import { base58Decode, base58Encode } from './base58.js'
import { normalizeHomeV2Address, type HomeV2AppBridgeProtocol } from './home-v2-app-actions.js'
import { normalizeHomeV2PublishSourceToken } from './home-v2-publish-source-tokens.js'

export const HOME_V2_PRIVATE_ATTACHMENT_ACTIONS = Object.freeze([
  'PUBLISH_CHAT_ATTACHMENT',
  'GET_CHAT_ATTACHMENT_STREAM_URL',
  'OPEN_CHAT_ATTACHMENT_VIEWER',
  'SAVE_CHAT_ATTACHMENT',
] as const)

export type HomeV2PrivateAttachmentAction = typeof HOME_V2_PRIVATE_ATTACHMENT_ACTIONS[number]
export type HomeV2PrivateAttachmentNetwork = 'qortal' | 'qortium'
export type HomeV2PrivateAttachmentConversation =
  | Readonly<{ kind: 'direct'; otherAddress: string }>
  | Readonly<{ groupId: number; kind: 'group' }>
export type HomeV2PrivateAttachmentCodec =
  | 'qenc-v2-direct'
  | 'qenc-v2-group'
  | 'qortal-hub-group-image-v1'
  | 'qortal-qatt-direct-v1'
  | 'qortal-qatt-group-v1'

export type HomeV2PrivateAttachmentDescriptor = Readonly<{
  ciphertext: Readonly<{
    algorithm: 'SHA-256'
    hash: string
    size: number
    transactionSignature: string
  }>
  codec: HomeV2PrivateAttachmentCodec
  conversation: HomeV2PrivateAttachmentConversation
  encrypted: true
  network: HomeV2PrivateAttachmentNetwork
  resource: Readonly<{
    identifier: string
    name: string
    service: 'IMAGE' | 'QCHAT_ATTACHMENT_PRIVATE'
  }>
  version: 1
}>

export type HomeV2PrivateAttachmentPublishRequest = Readonly<{
  conversation: HomeV2PrivateAttachmentConversation
  sourceToken: string
}>

const DISALLOWED_SOURCE_FIELDS = Object.freeze([
  'base64',
  'bytes',
  'bytesBase64',
  'data',
  'data64',
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
] as const)

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function authoritativeNetwork(protocol: HomeV2AppBridgeProtocol): HomeV2PrivateAttachmentNetwork {
  return protocol === 'qdnRequest' ? 'qortium' : 'qortal'
}

function assertNetwork(protocol: HomeV2AppBridgeProtocol, value: unknown) {
  const expected = authoritativeNetwork(protocol)
  if (value !== undefined && value !== null && value !== '' && value !== expected) {
    throw new Error(`Private attachment network must match the authoritative ${expected} bridge.`)
  }
  return expected
}

function normalizeGroupId(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 0x7fff_ffff) {
    throw new Error('Private attachment groupId must be a positive signed 32-bit integer.')
  }
  return parsed
}

export function normalizeHomeV2PrivateAttachmentConversation(value: unknown): HomeV2PrivateAttachmentConversation {
  if (!isRecord(value)) throw new Error('Private attachment conversation is required.')
  if (value.kind === 'direct') {
    if (value.groupId !== undefined) throw new Error('Direct attachment conversation cannot include groupId.')
    return Object.freeze({ kind: 'direct' as const, otherAddress: normalizeHomeV2Address(value.otherAddress) })
  }
  if (value.kind === 'group') {
    if (value.otherAddress !== undefined) throw new Error('Group attachment conversation cannot include otherAddress.')
    return Object.freeze({ groupId: normalizeGroupId(value.groupId), kind: 'group' as const })
  }
  throw new Error('Private attachment conversation kind must be direct or group.')
}

function canonicalSignature(value: unknown) {
  if (typeof value !== 'string' || !value) throw new Error('Private attachment transaction signature is missing.')
  let bytes: Uint8Array
  try {
    bytes = base58Decode(value)
  } catch {
    throw new Error('Private attachment transaction signature is not canonical Base58.')
  }
  if (bytes.length !== 64 || base58Encode(bytes) !== value) {
    throw new Error('Private attachment transaction signature is not canonical Base58.')
  }
  return value
}

function boundedString(value: unknown, label: string, maximumBytes: number) {
  if (typeof value !== 'string' || !value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Private attachment ${label} is invalid.`)
  }
  if (new TextEncoder().encode(value).length > maximumBytes) {
    throw new Error(`Private attachment ${label} is too long.`)
  }
  return value
}

export function isHomeV2PrivateAttachmentAction(value: string): value is HomeV2PrivateAttachmentAction {
  return (HOME_V2_PRIVATE_ATTACHMENT_ACTIONS as readonly string[]).includes(value)
}

export function normalizeHomeV2PrivateAttachmentPublishRequest(
  protocol: HomeV2AppBridgeProtocol,
  value: unknown,
): HomeV2PrivateAttachmentPublishRequest {
  if (!isRecord(value)) throw new Error('PUBLISH_CHAT_ATTACHMENT request is required.')
  assertNetwork(protocol, value.network)
  for (const field of DISALLOWED_SOURCE_FIELDS) {
    if (value[field] !== undefined && value[field] !== null && value[field] !== '') {
      throw new Error('Private attachments accept only a Home-issued sourceToken, never paths or inline bytes.')
    }
  }
  return Object.freeze({
    conversation: normalizeHomeV2PrivateAttachmentConversation(value.conversation),
    sourceToken: normalizeHomeV2PublishSourceToken(value.sourceToken),
  })
}

export function createHomeV2PrivateAttachmentDescriptor(input: {
  ciphertextHash: string
  ciphertextSize: number
  codec: HomeV2PrivateAttachmentCodec
  conversation: HomeV2PrivateAttachmentConversation
  identifier: string
  name: string
  network: HomeV2PrivateAttachmentNetwork
  service: 'IMAGE' | 'QCHAT_ATTACHMENT_PRIVATE'
  transactionSignature: string
}): HomeV2PrivateAttachmentDescriptor {
  return normalizeHomeV2PrivateAttachmentDescriptor(input.network === 'qortium' ? 'qdnRequest' : 'qortalRequest', {
    ciphertext: {
      algorithm: 'SHA-256',
      hash: input.ciphertextHash,
      size: input.ciphertextSize,
      transactionSignature: input.transactionSignature,
    },
    codec: input.codec,
    conversation: input.conversation,
    encrypted: true,
    network: input.network,
    resource: { identifier: input.identifier, name: input.name, service: input.service },
    version: 1,
  })
}

export function normalizeHomeV2PrivateAttachmentDescriptor(
  protocol: HomeV2AppBridgeProtocol,
  value: unknown,
): HomeV2PrivateAttachmentDescriptor {
  if (!isRecord(value) || value.version !== 1 || value.encrypted !== true) {
    throw new Error('Private attachment descriptor has an unsupported version or encryption state.')
  }
  const network = assertNetwork(protocol, value.network)
  const conversation = normalizeHomeV2PrivateAttachmentConversation(value.conversation)
  const codecs = new Set<HomeV2PrivateAttachmentCodec>([
    'qenc-v2-direct',
    'qenc-v2-group',
    'qortal-hub-group-image-v1',
    'qortal-qatt-direct-v1',
    'qortal-qatt-group-v1',
  ])
  const codec = typeof value.codec === 'string' && codecs.has(value.codec as HomeV2PrivateAttachmentCodec)
    ? value.codec as HomeV2PrivateAttachmentCodec
    : null
  if (!codec) throw new Error('Private attachment descriptor codec is unsupported.')
  if (network === 'qortium' && codec !== (conversation.kind === 'direct' ? 'qenc-v2-direct' : 'qenc-v2-group')) {
    throw new Error('Private attachment codec does not match the Qortium conversation.')
  }
  if (network === 'qortal' && conversation.kind === 'direct' && codec !== 'qortal-qatt-direct-v1') {
    throw new Error('Private attachment codec does not match the Qortal direct conversation.')
  }
  if (
    network === 'qortal' &&
    conversation.kind === 'group' &&
    codec !== 'qortal-hub-group-image-v1' &&
    codec !== 'qortal-qatt-group-v1'
  ) throw new Error('Private attachment codec does not match the Qortal group conversation.')
  if (!isRecord(value.resource)) throw new Error('Private attachment resource coordinate is missing.')
  const service = value.resource.service === 'IMAGE' || value.resource.service === 'QCHAT_ATTACHMENT_PRIVATE'
    ? value.resource.service
    : null
  if (!service) throw new Error('Private attachment service does not match the codec.')
  if (
    (codec === 'qortal-hub-group-image-v1' && service !== 'IMAGE') ||
    (codec !== 'qortal-hub-group-image-v1' && service !== 'QCHAT_ATTACHMENT_PRIVATE')
  ) throw new Error('Private attachment service does not match the codec.')
  const name = boundedString(value.resource.name, 'resource name', network === 'qortal' ? 400 : 40)
  const identifier = boundedString(value.resource.identifier, 'resource identifier', 64)
  if (name === '.' || name === '..' || identifier === '.' || identifier === '..') {
    throw new Error('Private attachment resource coordinate cannot contain dot segments.')
  }
  if (!isRecord(value.ciphertext) || value.ciphertext.algorithm !== 'SHA-256') {
    throw new Error('Private attachment ciphertext commitment is missing.')
  }
  const hash = typeof value.ciphertext.hash === 'string' && /^[0-9a-f]{64}$/.test(value.ciphertext.hash)
    ? value.ciphertext.hash
    : null
  if (!hash) throw new Error('Private attachment ciphertext hash is invalid.')
  const size = Number(value.ciphertext.size)
  if (!Number.isSafeInteger(size) || size < 1 || size > 1024 * 1024) {
    throw new Error('Private attachment ciphertext size must be 1 byte through 1 MiB.')
  }
  const transactionSignature = canonicalSignature(value.ciphertext.transactionSignature)
  return Object.freeze({
    ciphertext: Object.freeze({ algorithm: 'SHA-256' as const, hash, size, transactionSignature }),
    codec,
    conversation,
    encrypted: true as const,
    network,
    resource: Object.freeze({ identifier, name, service }),
    version: 1 as const,
  })
}

export function normalizeHomeV2PrivateAttachmentAccessRequest(
  protocol: HomeV2AppBridgeProtocol,
  value: unknown,
) {
  if (!isRecord(value)) throw new Error('Private attachment descriptor is required.')
  const descriptorValue = value.descriptor ?? value.attachment
  return Object.freeze({ descriptor: normalizeHomeV2PrivateAttachmentDescriptor(protocol, descriptorValue) })
}
