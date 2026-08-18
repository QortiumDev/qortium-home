import nacl from 'tweetnacl'

import { base58Decode, base58Encode } from './base58.js'
import {
  parseQpgcEnvelope,
  QPGC_MAX_MEMBERS,
  QPGC_MAX_MESSAGE_PLAINTEXT_BYTES,
  validateQpgcControlEnvelope,
  type QpgcEnvelope,
} from './home-v2-private-group-chat-actions.js'
import { normalizeHomeV2PublicChatRequest } from './home-v2-chat-actions.js'
import type { HomeV2AppBridgeProtocol } from './home-v2-app-actions.js'

export const HOME_V2_PRIVATE_GROUP_CHAT_READ_ACTIONS = Object.freeze([
  'GET_PRIVATE_GROUP_ACTIVE_CHATS',
  'GET_PRIVATE_GROUP_CHAT_STATE',
  'SEARCH_PRIVATE_GROUP_CHAT_MESSAGES',
] as const)

export const HOME_V2_PRIVATE_GROUP_CHAT_WRITE_ACTIONS = Object.freeze([
  'REQUEST_PRIVATE_GROUP_CHAT_KEY',
  'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS',
  'ROTATE_PRIVATE_GROUP_CHAT_KEY',
  'SEND_PRIVATE_GROUP_CHAT_MESSAGE',
  'SEND_PRIVATE_GROUP_CHAT_EDIT',
  'SEND_PRIVATE_GROUP_CHAT_DELETE',
  'SEND_PRIVATE_GROUP_CHAT_REACTION',
] as const)

export type HomeV2PrivateGroupChatReadAction = typeof HOME_V2_PRIVATE_GROUP_CHAT_READ_ACTIONS[number]
export type HomeV2PrivateGroupChatWriteAction = typeof HOME_V2_PRIVATE_GROUP_CHAT_WRITE_ACTIONS[number]
export type HomeV2PrivateGroupChatAction = HomeV2PrivateGroupChatReadAction | HomeV2PrivateGroupChatWriteAction

export type HomeV2PrivateGroupChatReadRequest = {
  readonly action: HomeV2PrivateGroupChatReadAction
  readonly before?: number
  readonly encoding: 'BASE58' | 'BASE64'
  readonly groupId?: number
  readonly limit: number
  readonly reverse: boolean
}

export type HomeV2PrivateGroupChatWriteRequest = {
  readonly action: HomeV2PrivateGroupChatWriteAction
  readonly chatReference: string | null
  readonly epochId: string | null
  readonly groupId: number
  readonly keyId: string | null
  readonly limit: number
  readonly message: string | null
}

export type HomeV2QpgcGroupState = {
  readonly allPublicKeysKnown: boolean
  readonly available: boolean
  readonly epochId: Uint8Array
  readonly exists: true
  readonly groupId: number
  readonly isOpen: false
  readonly maxMessagePlaintextBytes: number
  readonly maxV1Members: number
  readonly memberCount: number
  readonly memberPublicKeys: readonly Uint8Array[]
  readonly qpgcVersion: 1
}

export type HomeV2VerifiedQpgcControl = {
  readonly chatReference: Uint8Array | null
  readonly envelope: Exclude<QpgcEnvelope, { type: 'MESSAGE' }>
  readonly outerPublicKey: Uint8Array
  readonly signature: Uint8Array
  readonly signedTransaction: Uint8Array
  readonly timestamp: number
}

type RecordValue = Record<string, unknown>

function isRecord(value: unknown): value is RecordValue {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function assertQortiumProtocol(protocol: HomeV2AppBridgeProtocol, network: unknown) {
  if (protocol !== 'qdnRequest') throw new Error('QPGC private-group actions require the Qortium bridge.')
  if (network !== undefined && network !== null && network !== '' && network !== 'qortium') {
    throw new Error('Request network must match the authoritative Qortium bridge.')
  }
}

function normalizeGroupId(request: RecordValue) {
  const raw = request.groupId ?? request.txGroupId
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > 0x7fff_ffff) {
    throw new Error('Private-group groupId must be a positive signed 32-bit integer.')
  }
  if (request.groupId !== undefined && request.txGroupId !== undefined && request.groupId !== request.txGroupId) {
    throw new Error('groupId and txGroupId must not conflict.')
  }
  return value
}

function normalizeLimit(value: unknown, fallback = 100) {
  if (value === undefined || value === null || value === '') return fallback
  const limit = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Private-group limit must be an integer from 1 through 100.')
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

function normalizeEncoding(value: unknown): 'BASE58' | 'BASE64' {
  const encoding = value === undefined || value === null || value === ''
    ? 'BASE64'
    : typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (encoding !== 'BASE58' && encoding !== 'BASE64') throw new Error('encoding must be BASE58 or BASE64.')
  return encoding
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'boolean') throw new Error('reverse must be true or false.')
  return value
}

function canonicalBase58(value: unknown, length: number, label: string) {
  if (typeof value !== 'string' || !value) throw new Error(`${label} is missing.`)
  let bytes: Uint8Array
  try {
    bytes = base58Decode(value)
  } catch {
    throw new Error(`${label} is not canonical Base58.`)
  }
  if (bytes.length !== length || base58Encode(bytes) !== value) throw new Error(`${label} is not canonical Base58.`)
  return bytes
}

function normalizeOptionalKeyId(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  canonicalBase58(value, 32, 'QPGC keyId')
  return value as string
}

function normalizeOptionalEpochId(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  canonicalBase58(value, 32, 'QPGC epochId')
  return value as string
}

function normalizePrivateGroupMessage(value: unknown) {
  if (typeof value !== 'string' || !value || new TextEncoder().encode(value).length > QPGC_MAX_MESSAGE_PLAINTEXT_BYTES) {
    throw new Error(`Private-group payload must be a non-empty string no larger than ${QPGC_MAX_MESSAGE_PLAINTEXT_BYTES} UTF-8 bytes.`)
  }
  return value
}

export function isHomeV2PrivateGroupChatReadAction(value: string): value is HomeV2PrivateGroupChatReadAction {
  return (HOME_V2_PRIVATE_GROUP_CHAT_READ_ACTIONS as readonly string[]).includes(value)
}

export function isHomeV2PrivateGroupChatWriteAction(value: string): value is HomeV2PrivateGroupChatWriteAction {
  return (HOME_V2_PRIVATE_GROUP_CHAT_WRITE_ACTIONS as readonly string[]).includes(value)
}

export function normalizeHomeV2PrivateGroupChatReadRequest(
  protocol: HomeV2AppBridgeProtocol,
  action: HomeV2PrivateGroupChatReadAction,
  request: RecordValue,
): HomeV2PrivateGroupChatReadRequest {
  assertQortiumProtocol(protocol, request.network)
  const encoding = normalizeEncoding(request.encoding)
  if (action === 'GET_PRIVATE_GROUP_ACTIVE_CHATS') {
    return { action, encoding, limit: normalizeLimit(request.limit), reverse: true }
  }
  const groupId = normalizeGroupId(request)
  if (action === 'GET_PRIVATE_GROUP_CHAT_STATE') {
    return { action, encoding, groupId, limit: 1, reverse: true }
  }
  const before = normalizeBefore(request.before)
  return {
    action,
    ...(before === undefined ? {} : { before }),
    encoding,
    groupId,
    limit: normalizeLimit(request.limit),
    reverse: normalizeBoolean(request.reverse, true),
  }
}

export function normalizeHomeV2PrivateGroupChatWriteRequest(
  protocol: HomeV2AppBridgeProtocol,
  action: HomeV2PrivateGroupChatWriteAction,
  request: RecordValue,
): HomeV2PrivateGroupChatWriteRequest {
  assertQortiumProtocol(protocol, request.network)
  const groupId = normalizeGroupId(request)
  if (action === 'REQUEST_PRIVATE_GROUP_CHAT_KEY') {
    return {
      action,
      chatReference: null,
      epochId: normalizeOptionalEpochId(request.epochId),
      groupId,
      keyId: normalizeOptionalKeyId(request.keyId),
      limit: 1,
      message: null,
    }
  }
  if (action === 'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS') {
    return { action, chatReference: null, epochId: null, groupId, keyId: null, limit: normalizeLimit(request.limit, 20), message: null }
  }
  if (action === 'ROTATE_PRIVATE_GROUP_CHAT_KEY') {
    return { action, chatReference: null, epochId: null, groupId, keyId: null, limit: 1, message: null }
  }
  const message = normalizePrivateGroupMessage(request.message)
  const publicAction = action === 'SEND_PRIVATE_GROUP_CHAT_MESSAGE'
    ? 'SEND_CHAT_MESSAGE'
    : action === 'SEND_PRIVATE_GROUP_CHAT_EDIT'
      ? 'SEND_CHAT_EDIT'
      : action === 'SEND_PRIVATE_GROUP_CHAT_DELETE'
        ? 'SEND_CHAT_DELETE'
        : 'SEND_CHAT_REACTION'
  const validated = normalizeHomeV2PublicChatRequest('qdnRequest', publicAction, {
    chatReference: request.chatReference,
    message,
    network: 'qortium',
    txGroupId: groupId,
  })
  return {
    action,
    chatReference: validated.chatReference,
    epochId: null,
    groupId,
    keyId: null,
    limit: 1,
    message: validated.message,
  }
}

export function normalizeHomeV2QpgcGroupState(value: unknown, expectedGroupId: number): HomeV2QpgcGroupState {
  if (!isRecord(value)) throw new Error('Private-group state response is invalid.')
  if (value.txGroupId !== expectedGroupId) throw new Error('Private-group state changed the requested groupId.')
  if (value.exists !== true) throw new Error('Private group does not exist.')
  if (value.isOpen !== false) throw new Error('Private-group actions require a closed group.')
  if (value.qpgcVersion !== 1) throw new Error('Selected node does not expose QPGC v1 state.')
  if (value.maxV1Members !== QPGC_MAX_MEMBERS || value.maxMessagePlaintextBytes !== QPGC_MAX_MESSAGE_PLAINTEXT_BYTES) {
    throw new Error('Selected node reports incompatible QPGC v1 limits.')
  }
  if (value.available !== true || value.allPublicKeysKnown !== true) {
    const reason = typeof value.unavailableReason === 'string' ? value.unavailableReason : 'UNAVAILABLE'
    throw new Error(`Private-group chat is unavailable: ${reason}.`)
  }
  if (!Number.isSafeInteger(value.memberCount) || (value.memberCount as number) < 1 || (value.memberCount as number) > QPGC_MAX_MEMBERS) {
    throw new Error('Private-group member count is invalid.')
  }
  if (!Array.isArray(value.memberPublicKeys) || value.memberPublicKeys.length !== value.memberCount) {
    throw new Error('Private-group public-key list is inconsistent.')
  }
  const memberPublicKeys = value.memberPublicKeys.map((key) => canonicalBase58(key, 32, 'Private-group member public key'))
  for (let index = 1; index < memberPublicKeys.length; index += 1) {
    let order = 0
    for (let byte = 0; byte < 32 && order === 0; byte += 1) {
      order = memberPublicKeys[index - 1][byte] - memberPublicKeys[index][byte]
    }
    if (order >= 0) {
      throw new Error('Private-group member public keys are not strictly sorted.')
    }
  }
  return {
    allPublicKeysKnown: true,
    available: true,
    epochId: canonicalBase58(value.epochId, 32, 'Private-group epochId'),
    exists: true,
    groupId: expectedGroupId,
    isOpen: false,
    maxMessagePlaintextBytes: QPGC_MAX_MESSAGE_PLAINTEXT_BYTES,
    maxV1Members: QPGC_MAX_MEMBERS,
    memberCount: value.memberCount as number,
    memberPublicKeys,
    qpgcVersion: 1,
  }
}

class Reader {
  private offset = 0
  constructor(private readonly bytes: Uint8Array) {}
  read(length: number, label: string) {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.length) {
      throw new Error(`Signed QPGC CHAT transaction truncates ${label}.`)
    }
    const value = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return value
  }
  byte(label: string) { return this.read(1, label)[0] }
  int32(label: string) {
    const value = this.read(4, label)
    return new DataView(value.buffer, value.byteOffset, 4).getInt32(0, false)
  }
  uint32(label: string) {
    const value = this.read(4, label)
    return new DataView(value.buffer, value.byteOffset, 4).getUint32(0, false)
  }
  int64(label: string) {
    const value = this.read(8, label)
    const result = new DataView(value.buffer, value.byteOffset, 8).getBigInt64(0, false)
    if (result < BigInt(Number.MIN_SAFE_INTEGER) || result > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Signed QPGC CHAT transaction has unsafe ${label}.`)
    }
    return Number(result)
  }
  finish() {
    if (this.offset !== this.bytes.length) throw new Error('Signed QPGC CHAT transaction has trailing data.')
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function canonicalVariableBase58(value: unknown, minimum: number, maximum: number, label: string) {
  if (typeof value !== 'string' || !value) throw new Error(`${label} is missing.`)
  let bytes: Uint8Array
  try { bytes = base58Decode(value) } catch { throw new Error(`${label} is not canonical Base58.`) }
  if (bytes.length < minimum || bytes.length > maximum || base58Encode(bytes) !== value) {
    throw new Error(`${label} is not canonical Base58.`)
  }
  return bytes
}

function parseSignedQpgcChatTransaction(value: unknown) {
  const signedTransaction = canonicalVariableBase58(value, 64 + 4 + 8 + 4 + 32, 4_512, 'Signed QPGC CHAT transaction')
  const signature = signedTransaction.subarray(signedTransaction.length - 64)
  const transaction = signedTransaction.subarray(0, signedTransaction.length - 64)
  const reader = new Reader(transaction)
  if (reader.int32('type') !== 18) throw new Error('QPGC control transaction is not CHAT.')
  const timestamp = reader.int64('timestamp')
  const txGroupId = reader.int32('transaction groupId')
  const publicKey = reader.read(32, 'sender public key')
  reader.uint32('proof-of-work nonce')
  if (reader.byte('recipient marker') !== 0) throw new Error('QPGC control CHAT must not have a recipient.')
  const dataLength = reader.int32('data length')
  if (dataLength < 1 || dataLength > 4_000) throw new Error('QPGC control CHAT data length is invalid.')
  const data = reader.read(dataLength, 'data')
  if (reader.byte('encrypted flag') !== 1 || reader.byte('text flag') !== 1) {
    throw new Error('QPGC control CHAT must be encrypted text.')
  }
  if (reader.int64('fee') !== 0) throw new Error('QPGC control CHAT fee must be zero.')
  const referenceMarker = reader.byte('chatReference marker')
  if (referenceMarker !== 0 && referenceMarker !== 1) throw new Error('QPGC control CHAT reference marker is invalid.')
  const chatReference = referenceMarker ? reader.read(64, 'chatReference') : null
  reader.finish()
  if (!nacl.sign.detached.verify(transaction, signature, publicKey)) {
    throw new Error('QPGC control outer CHAT signature is invalid.')
  }
  return { chatReference, data, publicKey, signature, signedTransaction, timestamp, txGroupId }
}

export function verifyHomeV2QpgcControlRecord(value: unknown, state?: HomeV2QpgcGroupState): HomeV2VerifiedQpgcControl {
  if (!isRecord(value)) throw new Error('QPGC control record is invalid.')
  const parsed = parseSignedQpgcChatTransaction(value.signedTransaction)
  if (parsed.txGroupId !== value.txGroupId || parsed.timestamp !== value.timestamp) {
    throw new Error('QPGC control metadata does not match its signed CHAT transaction.')
  }
  const responseSignature = canonicalBase58(value.signature, 64, 'QPGC control signature')
  if (!equalBytes(responseSignature, parsed.signature)) throw new Error('QPGC control signature metadata changed.')
  const responseReference = value.chatReference === null || value.chatReference === undefined
    ? null
    : canonicalBase58(value.chatReference, 64, 'QPGC control chatReference')
  if ((responseReference === null) !== (parsed.chatReference === null) || (
    responseReference && parsed.chatReference && !equalBytes(responseReference, parsed.chatReference)
  )) throw new Error('QPGC control chatReference metadata changed.')
  const envelope = parseQpgcEnvelope(parsed.data)
  if (envelope.type === 'MESSAGE' || envelope.groupId !== parsed.txGroupId || envelope.type !== value.type) {
    throw new Error('QPGC control envelope metadata changed.')
  }
  const responseEpoch = canonicalBase58(value.epochId, 32, 'QPGC control epochId')
  if (!equalBytes(responseEpoch, envelope.epochId)) throw new Error('QPGC control epochId metadata changed.')
  if (value.keyId === null || value.keyId === undefined) {
    if ('keyId' in envelope && envelope.keyId) throw new Error('QPGC control keyId metadata is missing.')
  } else {
    const responseKey = canonicalBase58(value.keyId, 32, 'QPGC control keyId')
    if (!('keyId' in envelope) || !envelope.keyId || !equalBytes(responseKey, envelope.keyId)) {
      throw new Error('QPGC control keyId metadata changed.')
    }
  }
  validateQpgcControlEnvelope({
    envelope,
    ...(state && equalBytes(state.epochId, envelope.epochId) ? { memberPublicKeys: state.memberPublicKeys } : {}),
  })
  if (
    (envelope.type === 'KEY_REQUEST' || envelope.type === 'ROTATION_REQUEST') &&
    !equalBytes(parsed.publicKey, envelope.requesterPublicKey)
  ) throw new Error('QPGC request outer sender does not match its signed requester.')
  return {
    chatReference: parsed.chatReference,
    envelope,
    outerPublicKey: parsed.publicKey,
    signature: parsed.signature,
    signedTransaction: parsed.signedTransaction,
    timestamp: parsed.timestamp,
  }
}

export function normalizeHomeV2QpgcControlPage(
  value: unknown,
  expectedGroupId: number,
  state?: HomeV2QpgcGroupState,
) {
  if (!isRecord(value) || value.txGroupId !== expectedGroupId || !Array.isArray(value.controls)) {
    throw new Error('QPGC control page is invalid.')
  }
  if (value.controls.length > 100 || typeof value.hasMore !== 'boolean') {
    throw new Error('QPGC control page exceeds its bounds.')
  }
  if (value.nextCursor !== null && value.nextCursor !== undefined && (
    typeof value.nextCursor !== 'string' || value.nextCursor.length > 256
  )) throw new Error('QPGC control page cursor is invalid.')
  return {
    controls: value.controls.map((control) => verifyHomeV2QpgcControlRecord(control, state)),
    hasMore: value.hasMore,
    nextCursor: typeof value.nextCursor === 'string' ? value.nextCursor : null,
    txGroupId: expectedGroupId,
  }
}
