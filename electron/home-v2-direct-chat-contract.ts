import { base58Decode, base58Encode } from './base58.js'
import {
  decryptQdm1Message,
  decryptQortalDirectMessage,
  parseQdm1Envelope,
  QDM1_MAX_PLAINTEXT_SIZE,
} from './home-v2-direct-chat-actions.js'
import { normalizeHomeV2Address, type HomeV2AppBridgeProtocol } from './home-v2-app-actions.js'
import { normalizeHomeV2ChatReference } from './home-v2-chat-actions.js'

export const HOME_V2_DIRECT_CHAT_READ_ACTIONS = Object.freeze([
  'GET_PRIVATE_DIRECT_ACTIVE_CHATS',
  'SEARCH_PRIVATE_DIRECT_CHAT_MESSAGES',
] as const)

export const HOME_V2_DIRECT_CHAT_WRITE_ACTIONS = Object.freeze([
  'SEND_DIRECT_CHAT_MESSAGE',
  'SEND_DIRECT_CHAT_EDIT',
  'SEND_DIRECT_CHAT_DELETE',
  'SEND_DIRECT_CHAT_REACTION',
] as const)

export type HomeV2DirectChatReadAction = typeof HOME_V2_DIRECT_CHAT_READ_ACTIONS[number]
export type HomeV2DirectChatWriteAction = typeof HOME_V2_DIRECT_CHAT_WRITE_ACTIONS[number]
export type HomeV2DirectChatAction = HomeV2DirectChatReadAction | HomeV2DirectChatWriteAction

export type HomeV2DirectChatWriteRequest = {
  readonly action: HomeV2DirectChatWriteAction
  readonly chatReference: string | null
  readonly message: string
  readonly otherAddress: string
}

export type HomeV2DirectChatReadRequest = {
  readonly action: HomeV2DirectChatReadAction
  readonly before?: number
  readonly encoding: 'BASE58' | 'BASE64'
  readonly hasChatReference?: boolean
  readonly limit: number
  readonly otherAddress?: string
  readonly reverse: boolean
}

type DirectChatRow = Record<string, unknown> & {
  data?: unknown
  isEncrypted?: unknown
  isText?: unknown
  recipient?: unknown
  reference?: unknown
  sender?: unknown
  senderPublicKey?: unknown
  txGroupId?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function assertNetworkHint(protocol: HomeV2AppBridgeProtocol, value: unknown) {
  if (value === undefined || value === null || value === '') return
  const expected = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
  if (value !== expected) throw new Error(`Request network must match the authoritative ${expected} bridge.`)
}

function normalizeEncoding(value: unknown): 'BASE58' | 'BASE64' {
  const encoding = value === undefined || value === null || value === ''
    ? 'BASE64'
    : typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (encoding !== 'BASE58' && encoding !== 'BASE64') throw new Error('encoding must be BASE58 or BASE64.')
  return encoding
}

function normalizeLimit(value: unknown) {
  if (value === undefined || value === null || value === '') return 100
  const limit = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Direct chat limit must be an integer from 1 through 100.')
  }
  return limit
}

function normalizeBefore(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  const before = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(before) || before < 1_500_000_000_000) {
    throw new Error('before must be a retained-window millisecond timestamp no earlier than 1500000000000.')
  }
  return before
}

function normalizeBoolean(value: unknown, label: string, fallback: boolean) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false.`)
  return value
}

function normalizeDirectMessage(value: unknown) {
  if (typeof value !== 'string' || !value || new TextEncoder().encode(value).length > 3_984) {
    throw new Error('Direct-message payload must be a non-empty string no larger than 3984 UTF-8 bytes.')
  }
  return value
}

function parseJsonPayload(message: string, label: string) {
  let payload: unknown
  try {
    payload = JSON.parse(message)
  } catch {
    throw new Error(`${label} must be a JSON object.`)
  }
  if (!isRecord(payload)) throw new Error(`${label} must be a JSON object.`)
  return payload
}

function validateQortiumDirectPayload(action: HomeV2DirectChatWriteAction, message: string) {
  if (action === 'SEND_DIRECT_CHAT_MESSAGE') return
  const payload = parseJsonPayload(message, 'Qortium direct revision payload')
  if (action === 'SEND_DIRECT_CHAT_REACTION') {
    if (
      payload.type !== 'reaction' ||
      payload.message !== '' ||
      typeof payload.content !== 'string' ||
      !payload.content ||
      payload.content.length > 32 ||
      typeof payload.contentState !== 'boolean'
    ) throw new Error('Qortium direct reaction payload is invalid.')
    return
  }
  if (action === 'SEND_DIRECT_CHAT_DELETE') {
    if (payload.message !== '' || payload.type !== undefined) {
      throw new Error('Qortium direct delete must be an empty-message revision envelope.')
    }
    return
  }
  if (
    payload.type !== undefined ||
    typeof payload.message !== 'string' ||
    !payload.message
  ) {
    throw new Error('Qortium direct edit must contain non-delete, non-reaction content.')
  }
}

function validateQortalDirectPayload(action: HomeV2DirectChatWriteAction, message: string) {
  const payload = parseJsonPayload(message, 'Qortal direct payload')
  if (payload.version !== 2 || typeof payload.specialId !== 'string' || !payload.specialId || payload.specialId.length > 128) {
    throw new Error('Qortal direct payload must be a Hub-compatible version-2 envelope with specialId.')
  }
  if (action === 'SEND_DIRECT_CHAT_REACTION') {
    if (
      payload.type !== 'reaction' ||
      payload.message !== '' ||
      typeof payload.content !== 'string' ||
      !payload.content ||
      payload.content.length > 32 ||
      typeof payload.contentState !== 'boolean'
    ) throw new Error('Qortal direct reaction payload is invalid.')
    return
  }
  if (action === 'SEND_DIRECT_CHAT_DELETE') {
    const allowedKeys = new Set(['isEdited', 'message', 'repliedTo', 'specialId', 'type', 'version'])
    if (
      payload.isEdited !== true ||
      payload.message !== '<p></p>' ||
      payload.repliedTo !== '' ||
      payload.type !== 'edit' ||
      Object.keys(payload).some((key) => !allowedKeys.has(key))
    ) throw new Error("Qortal direct delete must be Home's canonical content-clearing edit envelope.")
    return
  }
  if (typeof payload.message !== 'string' || !payload.message || payload.message === '<p></p>') {
    throw new Error('Qortal direct message/edit payload must contain message content.')
  }
  if (action === 'SEND_DIRECT_CHAT_EDIT') {
    if (payload.type !== 'edit' || payload.isEdited !== true) throw new Error('Qortal direct edit payload is invalid.')
  } else if (payload.type !== '' && payload.type !== undefined) {
    throw new Error('Qortal initial direct message cannot be a revision or reaction.')
  }
}

export function isHomeV2DirectChatReadAction(value: string): value is HomeV2DirectChatReadAction {
  return (HOME_V2_DIRECT_CHAT_READ_ACTIONS as readonly string[]).includes(value)
}

export function isHomeV2DirectChatWriteAction(value: string): value is HomeV2DirectChatWriteAction {
  return (HOME_V2_DIRECT_CHAT_WRITE_ACTIONS as readonly string[]).includes(value)
}

export function normalizeHomeV2DirectChatReadRequest(
  protocol: HomeV2AppBridgeProtocol,
  action: HomeV2DirectChatReadAction,
  request: Record<string, unknown>,
): HomeV2DirectChatReadRequest {
  assertNetworkHint(protocol, request.network)
  const encoding = normalizeEncoding(request.encoding)
  const reverse = normalizeBoolean(request.reverse, 'reverse', true)
  const hasChatReference = request.hasChatReference === undefined && request.haschatreference === undefined
    ? undefined
    : normalizeBoolean(request.hasChatReference ?? request.haschatreference, 'hasChatReference', false)
  if (action === 'GET_PRIVATE_DIRECT_ACTIVE_CHATS') {
    if (request.otherAddress !== undefined && request.otherAddress !== null && request.otherAddress !== '') {
      throw new Error('Active direct chats do not accept an otherAddress selector.')
    }
    return { action, encoding, ...(hasChatReference === undefined ? {} : { hasChatReference }), limit: 100, reverse }
  }
  const before = normalizeBefore(request.before)
  return {
    action,
    ...(before === undefined ? {} : { before }),
    encoding,
    ...(hasChatReference === undefined ? {} : { hasChatReference }),
    limit: normalizeLimit(request.limit),
    otherAddress: normalizeHomeV2Address(request.otherAddress),
    reverse,
  }
}

export function normalizeHomeV2DirectChatWriteRequest(
  protocol: HomeV2AppBridgeProtocol,
  action: HomeV2DirectChatWriteAction,
  request: Record<string, unknown>,
): HomeV2DirectChatWriteRequest {
  assertNetworkHint(protocol, request.network)
  const otherAddress = normalizeHomeV2Address(request.otherAddress ?? request.recipientAddress)
  const message = normalizeDirectMessage(request.message)
  if (protocol === 'qdnRequest' && new TextEncoder().encode(message).length > QDM1_MAX_PLAINTEXT_SIZE) {
    throw new Error(`Qortium direct-message payload must be no larger than ${QDM1_MAX_PLAINTEXT_SIZE} UTF-8 bytes.`)
  }
  const chatReference = action === 'SEND_DIRECT_CHAT_MESSAGE'
    ? null
    : normalizeHomeV2ChatReference(request.chatReference)
  if (action === 'SEND_DIRECT_CHAT_MESSAGE' && request.chatReference) {
    throw new Error('Initial direct messages cannot carry chatReference; use an explicit direct revision action.')
  }
  if (protocol === 'qortalRequest') validateQortalDirectPayload(action, message)
  else validateQortiumDirectPayload(action, message)
  return { action, chatReference, message, otherAddress }
}

function decodeBase64(value: string) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Encrypted direct-message data is not canonical Base64.')
  }
  let decoded: string
  try {
    decoded = globalThis.atob(value)
  } catch {
    throw new Error('Encrypted direct-message data is not canonical Base64.')
  }
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0))
  if (encodeBase64(bytes) !== value) {
    throw new Error('Encrypted direct-message data is not canonical Base64.')
  }
  return bytes
}

function encodeBase64(value: Uint8Array) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return globalThis.btoa(binary)
}

function encodeData(value: Uint8Array, encoding: 'BASE58' | 'BASE64') {
  return encoding === 'BASE58' ? base58Encode(value) : encodeBase64(value)
}

function canonicalPublicKey(value: unknown, label: string) {
  if (typeof value !== 'string' || !value) throw new Error(`${label} is missing.`)
  const bytes = base58Decode(value)
  if (bytes.length !== 32 || base58Encode(bytes) !== value) throw new Error(`${label} is invalid.`)
  return bytes
}

export async function decryptHomeV2DirectChatRow(input: {
  readonly encoding: 'BASE58' | 'BASE64'
  readonly localAddress: string
  readonly localPublicKey: Uint8Array
  readonly network: 'qortal' | 'qortium'
  readonly peerAddress: string
  readonly peerPublicKey: Uint8Array
  readonly row: DirectChatRow
  readonly selectedAccountSecretKey: Uint8Array
}) {
  const { row } = input
  if (row.txGroupId !== 0 || row.isEncrypted !== true || row.isText !== true) {
    throw new Error('Direct chat row is not encrypted text in transaction group 0.')
  }
  const sender = normalizeHomeV2Address(row.sender)
  const recipient = normalizeHomeV2Address(row.recipient)
  const correctParticipants =
    (sender === input.localAddress && recipient === input.peerAddress) ||
    (sender === input.peerAddress && recipient === input.localAddress)
  if (!correctParticipants) throw new Error('Direct chat row does not match the selected account and peer.')
  const expectedSenderKey = sender === input.localAddress ? input.localPublicKey : input.peerPublicKey
  const senderPublicKey = canonicalPublicKey(row.senderPublicKey, 'Direct-message sender public key')
  if (!senderPublicKey.every((value, index) => value === expectedSenderKey[index])) {
    throw new Error('Direct-message sender public key does not match its participant address.')
  }
  if (typeof row.data !== 'string') throw new Error('Encrypted direct-message data is missing.')
  const ciphertext = decodeBase64(row.data)
  if (input.network === 'qortium') {
    const envelope = parseQdm1Envelope(ciphertext)
    const expectedRecipientKey = recipient === input.localAddress
      ? input.localPublicKey
      : input.peerPublicKey
    if (
      !envelope.senderPublicKey.every((value, index) => value === expectedSenderKey[index]) ||
      !envelope.recipientPublicKey.every((value, index) => value === expectedRecipientKey[index])
    ) throw new Error('QDM1 envelope keys do not match the direct-message participants.')
  }
  const plaintext = input.network === 'qortium'
    ? await decryptQdm1Message({
        envelope: ciphertext,
        localPublicKey: input.localPublicKey,
        selectedAccountSecretKey: input.selectedAccountSecretKey,
      })
    : await decryptQortalDirectMessage({
        ciphertext,
        lastReference: canonicalReference(row.reference, 'Qortal transaction reference'),
        peerPublicKey: input.peerPublicKey,
        selectedAccountSecretKey: input.selectedAccountSecretKey,
      })
  return {
    ...row,
    data: encodeData(plaintext, input.encoding),
    decryptionStatus: 'DECRYPTED' as const,
    encoding: input.encoding,
  }
}

function canonicalReference(value: unknown, label: string) {
  if (typeof value !== 'string' || !value) throw new Error(`${label} is missing.`)
  const bytes = base58Decode(value)
  if (bytes.length !== 64 || base58Encode(bytes) !== value) throw new Error(`${label} is invalid.`)
  return bytes
}

export function directDecryptFailure(row: DirectChatRow, error: unknown) {
  return {
    ...row,
    data: null,
    decryptionError: error instanceof Error ? error.message : String(error),
    decryptionStatus: 'FAILED' as const,
  }
}

export function assertHomeV2DirectReferenceTarget(
  value: unknown,
  expected: {
    action: HomeV2DirectChatWriteAction
    localAddress: string
    localPublicKey: string
    otherAddress: string
    otherPublicKey: string
    signature: string
  },
) {
  if (!isRecord(value)) throw new Error('Referenced direct message was not found.')
  const txGroupId = typeof value.txGroupId === 'number' ? value.txGroupId : Number(value.txGroupId)
  if (value.signature !== expected.signature || txGroupId !== 0) {
    throw new Error('Referenced direct message does not match the approved conversation.')
  }
  if (value.chatReference !== null && value.chatReference !== undefined && value.chatReference !== '') {
    throw new Error('Direct revisions and reactions must reference the original message.')
  }
  if (value.isEncrypted !== true || value.isText !== true) {
    throw new Error('Referenced direct message is not encrypted text.')
  }
  const sender = normalizeHomeV2Address(value.sender)
  const recipient = normalizeHomeV2Address(value.recipient)
  const participantsMatch =
    (sender === expected.localAddress && recipient === expected.otherAddress) ||
    (sender === expected.otherAddress && recipient === expected.localAddress)
  if (!participantsMatch) throw new Error('Referenced direct message belongs to different participants.')
  const expectedSenderPublicKey = sender === expected.localAddress
    ? expected.localPublicKey
    : expected.otherPublicKey
  if (value.senderPublicKey !== expectedSenderPublicKey) {
    throw new Error('Referenced direct message sender identity is inconsistent.')
  }
  if (
    (expected.action === 'SEND_DIRECT_CHAT_EDIT' || expected.action === 'SEND_DIRECT_CHAT_DELETE') &&
    sender !== expected.localAddress
  ) {
    throw new Error('Only the original sender can edit or clear a direct message.')
  }
}
