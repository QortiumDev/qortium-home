import { base58Decode, base58Encode } from './base58.js'
import {
  normalizeHomeV2ChatMessageText,
  normalizeHomeV2SendTxGroupId,
  type HomeV2AppBridgeProtocol,
  type HomeV2AppNetwork,
} from './home-v2-app-actions.js'

export const HOME_V2_PUBLIC_CHAT_ACTIONS = Object.freeze([
  'SEND_CHAT_MESSAGE',
  'SEND_CHAT_EDIT',
  'SEND_CHAT_DELETE',
  'SEND_CHAT_REACTION',
] as const)

export type HomeV2PublicChatAction = typeof HOME_V2_PUBLIC_CHAT_ACTIONS[number]

export type HomeV2PublicChatRequest = {
  readonly action: HomeV2PublicChatAction
  readonly chatReference: string | null
  readonly message: string
  readonly txGroupId: number
}

export function createHomeV2UnknownChatBroadcastResult(
  error: unknown,
  signature: string,
  timestamp: number,
) {
  return {
    accepted: false as const,
    error: error instanceof Error ? error.message : String(error),
    errorType: 'BROADCAST_OUTCOME_UNKNOWN' as const,
    outcome: 'unknown' as const,
    retryable: false as const,
    signature: normalizeCanonicalSignature(signature, 'Signed chat signature'),
    timestamp,
  }
}

export type HomeV2PublicChatReferenceTarget = {
  readonly chatReference: string | null
  readonly isEncrypted: false
  readonly isText: true
  readonly recipient: null
  readonly sender: string
  readonly senderPublicKey: string
  readonly signature: string
  readonly txGroupId: number
}

export function buildHomeV2QortiumPublicChatBuildBody(input: {
  readonly request: HomeV2PublicChatRequest
  readonly senderPublicKey: string
  readonly timestamp: number
}) {
  return {
    data: base58Encode(new TextEncoder().encode(input.request.message)),
    fee: 0,
    isEncrypted: false,
    isText: true,
    senderPublicKey: input.senderPublicKey,
    timestamp: input.timestamp,
    txGroupId: input.request.txGroupId,
    ...(input.request.chatReference
      ? { chatReference: input.request.chatReference }
      : {}),
  }
}

export function assertHomeV2OpenPublicGroup(
  value: unknown,
  txGroupId: number,
  network: HomeV2AppNetwork,
) {
  if (network === 'qortium' && txGroupId === 0) return
  const metadata = isRecord(value) ? value : null
  const rawGroupId = metadata?.groupId
  const groupId = typeof rawGroupId === 'number'
    ? rawGroupId
    : typeof rawGroupId === 'string' && /^\d+$/.test(rawGroupId)
      ? Number(rawGroupId)
      : Number.NaN
  if (!metadata || !Number.isSafeInteger(groupId) || groupId !== txGroupId) {
    throw new Error(`Home could not verify the selected ${network} group.`)
  }
  if (metadata.isOpen === false) {
    throw new Error('This action is for public group chat; use the private-group chat actions instead.')
  }
  if (metadata.isOpen !== true) {
    throw new Error(`Home could not verify that this ${network} group is public.`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeCanonicalBase58(value: unknown, byteLength: number, label: string) {
  if (typeof value !== 'string' || !value) {
    throw new Error(`${label} is required.`)
  }
  let bytes: Uint8Array
  try {
    bytes = base58Decode(value)
  } catch {
    throw new Error(`${label} must be valid Base58.`)
  }
  if (bytes.byteLength !== byteLength || base58Encode(bytes) !== value) {
    throw new Error(`${label} must be canonical Base58 encoding of ${byteLength} bytes.`)
  }
  return value
}

function normalizeCanonicalSignature(value: unknown, label: string) {
  return normalizeCanonicalBase58(value, 64, label)
}

export function normalizeHomeV2ChatReference(value: unknown) {
  return normalizeCanonicalSignature(value, 'chatReference')
}

export function isHomeV2PublicChatAction(value: string): value is HomeV2PublicChatAction {
  return (HOME_V2_PUBLIC_CHAT_ACTIONS as readonly string[]).includes(value)
}

export function getHomeV2PublicChatActions(_protocol: HomeV2AppBridgeProtocol) {
  return HOME_V2_PUBLIC_CHAT_ACTIONS
}

function parseJsonRecord(message: string, label: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(message)
  } catch {
    throw new Error(`${label} must be a JSON object.`)
  }
  if (!isRecord(parsed)) throw new Error(`${label} must be a JSON object.`)
  return parsed
}

function assertReactionEnvelope(message: string, label: string) {
  const payload = parseJsonRecord(message, label)
  if (
    payload.type !== 'reaction' ||
    payload.message !== '' ||
    typeof payload.content !== 'string' ||
    !payload.content.trim() ||
    payload.content.length > 32 ||
    typeof payload.contentState !== 'boolean'
  ) {
    throw new Error(`${label} must be a valid reaction envelope.`)
  }
  return payload
}

function inferLegacyQortiumRevisionAction(message: string): HomeV2PublicChatAction {
  try {
    const payload = JSON.parse(message) as unknown
    if (isRecord(payload) && payload.type === 'reaction') return 'SEND_CHAT_REACTION'
    if (isRecord(payload) && payload.message === '') return 'SEND_CHAT_DELETE'
  } catch {
    // Plain text and JSON-looking user text are edits when a reference exists.
  }
  return 'SEND_CHAT_EDIT'
}

function assertQortiumEditPayload(message: string) {
  try {
    const payload = JSON.parse(message) as unknown
    if (!isRecord(payload)) return
    if (payload.type === 'reaction') {
      throw new Error('Qortium edit payload cannot be a reaction envelope.')
    }
    if (typeof payload.message === 'string' && payload.message.length === 0) {
      throw new Error('Qortium edit payload cannot be a delete envelope.')
    }
  } catch (error) {
    if (error instanceof SyntaxError) return
    throw error
  }
}

function assertQortiumDeletePayload(message: string) {
  const payload = parseJsonRecord(message, 'Qortium delete payload')
  if (payload.message !== '' || payload.type !== undefined) {
    throw new Error('Qortium delete payload must be an empty-message revision envelope.')
  }
  if (payload.repliedTo !== undefined) {
    normalizeCanonicalSignature(payload.repliedTo, 'Qortium delete repliedTo')
  }
  const allowedKeys = new Set(['message', 'repliedTo'])
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw new Error('Qortium delete payload contains unsupported fields.')
  }
}

function assertQortalEditPayload(message: string) {
  const payload = parseJsonRecord(message, 'Qortal edit payload')
  if (
    payload.version !== 3 ||
    payload.type !== 'edit' ||
    payload.isEdited !== true ||
    (typeof payload.messageText !== 'string' && !isRecord(payload.messageText)) ||
    payload.messageText === '' ||
    payload.messageText === '<p></p>' ||
    typeof payload.specialId !== 'string' ||
    !payload.specialId ||
    payload.specialId.length > 128 ||
    typeof payload.repliedTo !== 'string' ||
    !Array.isArray(payload.images) ||
    payload.images.length > 12
  ) {
    throw new Error('Qortal edit payload must be a non-empty Hub v3 edit envelope.')
  }
}

function assertQortalDeletePayload(message: string) {
  const payload = parseJsonRecord(message, 'Qortal delete payload')
  if (
    payload.version !== 3 ||
    payload.type !== 'edit' ||
    payload.isEdited !== true ||
    payload.messageText !== '<p></p>' ||
    typeof payload.specialId !== 'string' ||
    !payload.specialId ||
    payload.specialId.length > 128 ||
    payload.repliedTo !== '' ||
    !Array.isArray(payload.images) ||
    payload.images.length !== 0
  ) {
    throw new Error("Qortal delete payload must be Home's canonical empty Hub v3 edit envelope.")
  }
  const allowedKeys = new Set([
    'images',
    'isEdited',
    'messageText',
    'repliedTo',
    'specialId',
    'type',
    'version',
  ])
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw new Error('Qortal delete payload contains unsupported fields.')
  }
}

function assertNetworkHint(protocol: HomeV2AppBridgeProtocol, value: unknown) {
  if (value === undefined || value === null || value === '') return
  const network: HomeV2AppNetwork = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
  if (value !== network) {
    throw new Error(`Request network must match the authoritative ${network} bridge.`)
  }
}

export function normalizeHomeV2PublicChatRequest(
  protocol: HomeV2AppBridgeProtocol,
  action: HomeV2PublicChatAction,
  request: Record<string, unknown>,
): HomeV2PublicChatRequest {
  if (!(getHomeV2PublicChatActions(protocol) as readonly string[]).includes(action)) {
    throw new Error(`${action} is not implemented for ${protocol}.`)
  }
  assertNetworkHint(protocol, request.network)
  const txGroupId = normalizeHomeV2SendTxGroupId(protocol, request.txGroupId)
  const message = normalizeHomeV2ChatMessageText(request.message)

  if (action === 'SEND_CHAT_MESSAGE') {
    if (request.chatReference !== undefined && request.chatReference !== null && request.chatReference !== '') {
      if (protocol === 'qortalRequest') {
        throw new Error('Qortal SEND_CHAT_MESSAGE cannot carry chatReference; use an explicit revision action.')
      }
      const legacyAction = inferLegacyQortiumRevisionAction(message)
      return normalizeHomeV2PublicChatRequest(protocol, legacyAction, request)
    }
    return { action, chatReference: null, message, txGroupId }
  }

  const chatReference = normalizeHomeV2ChatReference(request.chatReference)
  if (action === 'SEND_CHAT_REACTION') {
    const payload = assertReactionEnvelope(
      message,
      protocol === 'qortalRequest' ? 'Qortal reaction payload' : 'Qortium reaction payload',
    )
    if (
      protocol === 'qortalRequest' &&
      (typeof payload.specialId !== 'string' || !payload.specialId || payload.specialId.length > 128)
    ) {
      throw new Error('Qortal reaction payload must include a valid Hub specialId.')
    }
  } else if (protocol === 'qortalRequest' && action === 'SEND_CHAT_DELETE') {
    assertQortalDeletePayload(message)
  } else if (protocol === 'qortalRequest') {
    assertQortalEditPayload(message)
  } else if (action === 'SEND_CHAT_DELETE') {
    assertQortiumDeletePayload(message)
  } else {
    assertQortiumEditPayload(message)
  }

  return { action, chatReference, message, txGroupId }
}

export function normalizeHomeV2PublicChatReferenceTarget(
  value: unknown,
  expected: {
    readonly chatReference: string
    readonly requireOriginal?: boolean
    readonly requireSenderOwnership: boolean
    readonly senderPublicKey: string
    readonly txGroupId: number
  },
): HomeV2PublicChatReferenceTarget {
  if (!isRecord(value)) throw new Error('Referenced chat message was not found.')
  const signature = normalizeCanonicalSignature(value.signature, 'Referenced chat signature')
  const senderPublicKey = normalizeCanonicalBase58(
    value.senderPublicKey,
    32,
    'Referenced chat sender public key',
  )
  const sender = typeof value.sender === 'string' ? value.sender : ''
  const rawGroupId = value.txGroupId
  const txGroupId = typeof rawGroupId === 'number'
    ? rawGroupId
    : typeof rawGroupId === 'string' && /^\d+$/.test(rawGroupId)
      ? Number(rawGroupId)
      : Number.NaN
  const recipient = value.recipient === undefined || value.recipient === null || value.recipient === ''
    ? null
    : value.recipient
  const chatReference = value.chatReference === undefined || value.chatReference === null || value.chatReference === ''
    ? null
    : normalizeCanonicalSignature(value.chatReference, 'Referenced message chatReference')

  if (signature !== expected.chatReference) {
    throw new Error('Referenced chat response did not match the requested signature.')
  }
  if (!Number.isSafeInteger(txGroupId) || txGroupId !== expected.txGroupId) {
    throw new Error('Referenced chat message belongs to a different group.')
  }
  if (recipient !== null || value.isEncrypted !== false || value.isText !== true) {
    throw new Error('Referenced chat message is not a public text group message.')
  }
  if (!sender || !senderPublicKey) {
    throw new Error('Referenced chat message is missing its sender identity.')
  }
  if (expected.requireOriginal && chatReference) {
    throw new Error('Chat revisions and reactions must reference the original message.')
  }
  if (expected.requireSenderOwnership && senderPublicKey !== expected.senderPublicKey) {
    throw new Error('Only the original sender can edit or delete this chat message.')
  }

  return {
    chatReference,
    isEncrypted: false,
    isText: true,
    recipient: null,
    sender,
    senderPublicKey,
    signature,
    txGroupId,
  }
}
