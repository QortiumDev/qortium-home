import { base58Decode, base58Encode } from './base58.js'
import {
  appendSignatureToTransactionBytes,
  assertValidQortalAddress,
  atomicLongToBigInt,
  getSignatureFromSignedTransactionBytes,
} from './qortal-payment.js'
import type { HomeV2AppNetwork } from './home-v2-app-actions.js'

export const HOME_V2_GROUP_ADMIN_ACTIONS = Object.freeze([
  'APPROVE_GROUP_JOIN_REQUEST',
  'INVITE_TO_GROUP',
  'CANCEL_GROUP_INVITE',
  'ADD_GROUP_ADMIN',
  'REMOVE_GROUP_ADMIN',
  'GROUP_BAN',
  'CANCEL_GROUP_BAN',
  'GROUP_KICK',
] as const)

export const HOME_V2_GROUP_ADMIN_ALIASES = Object.freeze([
  'BAN_FROM_GROUP',
  'KICK_FROM_GROUP',
] as const)

export type HomeV2CanonicalGroupAdminAction = typeof HOME_V2_GROUP_ADMIN_ACTIONS[number]
export type HomeV2GroupAdminAction =
  | HomeV2CanonicalGroupAdminAction
  | typeof HOME_V2_GROUP_ADMIN_ALIASES[number]
export type HomeV2GroupAdminWireAction =
  | 'ADD_GROUP_ADMIN'
  | 'REMOVE_GROUP_ADMIN'
  | 'GROUP_BAN'
  | 'CANCEL_GROUP_BAN'
  | 'GROUP_KICK'
  | 'GROUP_INVITE'
  | 'CANCEL_GROUP_INVITE'

export type HomeV2GroupAdminRequest = {
  readonly action: HomeV2CanonicalGroupAdminAction
  readonly groupId: number
  readonly memberAddress: string
  readonly reason: string
  readonly timeToLive: number
  readonly wireAction: HomeV2GroupAdminWireAction
}

export type HomeV2GroupAdminTarget = {
  readonly groupId: number
  readonly groupName: string
  readonly ownerAddress: string
}

const ACTION_TYPES: Readonly<Record<HomeV2GroupAdminWireAction, number>> = Object.freeze({
  ADD_GROUP_ADMIN: 24,
  REMOVE_GROUP_ADMIN: 25,
  GROUP_BAN: 26,
  CANCEL_GROUP_BAN: 27,
  GROUP_KICK: 28,
  GROUP_INVITE: 29,
  CANCEL_GROUP_INVITE: 30,
})

const PUBLIC_KEY_LENGTH = 32
const ADDRESS_LENGTH = 25
const REFERENCE_LENGTH = 64
const SIGNATURE_LENGTH = 64
const MAX_REASON_BYTES = 128
const TRANSACTION_GROUP_ID = 0

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function concatBytes(...chunks: Uint8Array[]) {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

export function int32Bytes(value: number, label: string) {
  if (!Number.isInteger(value) || value < -2_147_483_648 || value > 2_147_483_647) {
    throw new Error(`${label} must be a signed 32-bit integer.`)
  }
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setInt32(0, value, false)
  return bytes
}

export function int64Bytes(value: bigint, label: string) {
  if (value < 0n || value > 9_223_372_036_854_775_807n) {
    throw new Error(`${label} is outside the signed 64-bit transaction range.`)
  }
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigInt64(0, value, false)
  return bytes
}

export function exactBytes(value: string | Uint8Array, byteLength: number, label: string) {
  const bytes = typeof value === 'string' ? base58Decode(value) : new Uint8Array(value)
  if (bytes.byteLength !== byteLength) throw new Error(`${label} must be ${byteLength} bytes.`)
  return bytes
}

export function sizedUtf8(value: string, label: string, maxBytes: number) {
  const bytes = new TextEncoder().encode(value)
  if (bytes.byteLength > maxBytes) throw new Error(`${label} must be at most ${maxBytes} UTF-8 bytes.`)
  return concatBytes(int32Bytes(bytes.byteLength, `${label} length`), bytes)
}

export class ByteReader {
  private offset = 0

  constructor(private readonly bytes: Uint8Array) {}

  int32(label: string) {
    if (this.offset + 4 > this.bytes.byteLength) throw new Error(`${label} was truncated.`)
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4).getInt32(0, false)
    this.offset += 4
    return value
  }

  int64(label: string) {
    if (this.offset + 8 > this.bytes.byteLength) throw new Error(`${label} was truncated.`)
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 8).getBigInt64(0, false)
    this.offset += 8
    return value
  }

  exact(length: number, label: string) {
    if (this.offset + length > this.bytes.byteLength) throw new Error(`${label} was truncated.`)
    const value = this.bytes.slice(this.offset, this.offset + length)
    this.offset += length
    return value
  }

  sizedUtf8(label: string, maxBytes: number) {
    const length = this.int32(`${label} length`)
    if (length < 0 || length > maxBytes) throw new Error(`${label} length was invalid.`)
    return new TextDecoder('utf-8', { fatal: true }).decode(this.exact(length, label))
  }

  done(label: string) {
    if (this.offset !== this.bytes.byteLength) throw new Error(`${label} contained unapproved trailing bytes.`)
  }
}

export function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
}

export function positiveGroupId(value: unknown) {
  const groupId = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN
  if (!Number.isSafeInteger(groupId) || groupId <= 0 || groupId > 2_147_483_647) {
    throw new Error('groupId must be a positive safe integer.')
  }
  return groupId
}

export function nonNegativeInt32(value: unknown, label: string, fallback = 0) {
  const candidate = value === undefined || value === null || value === '' ? fallback : value
  const parsed = typeof candidate === 'number'
    ? candidate
    : typeof candidate === 'string' && /^\d+$/.test(candidate.trim())
      ? Number(candidate.trim())
      : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 2_147_483_647) {
    throw new Error(`${label} must be an integer between 0 and 2147483647.`)
  }
  return parsed
}

function requestString(value: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return ''
}

export function canonicalHomeV2GroupAdminAction(action: HomeV2GroupAdminAction): HomeV2CanonicalGroupAdminAction {
  if (action === 'BAN_FROM_GROUP') return 'GROUP_BAN'
  if (action === 'KICK_FROM_GROUP') return 'GROUP_KICK'
  return action
}

function memberKeys(action: HomeV2CanonicalGroupAdminAction) {
  switch (action) {
    case 'APPROVE_GROUP_JOIN_REQUEST': return ['joiner', 'qortalAddress', 'memberAddress', 'member', 'address'] as const
    case 'INVITE_TO_GROUP': return ['invitee', 'inviteeAddress', 'qortalAddress', 'recipientAddress', 'recipient', 'memberAddress', 'address'] as const
    case 'CANCEL_GROUP_INVITE': return ['invitee', 'qortalAddress', 'recipientAddress', 'memberAddress', 'address'] as const
    case 'ADD_GROUP_ADMIN': return ['member', 'qortalAddress', 'memberAddress', 'address'] as const
    case 'REMOVE_GROUP_ADMIN': return ['admin', 'qortalAddress', 'memberAddress', 'address'] as const
    case 'GROUP_BAN': return ['offender', 'qortalAddress', 'member', 'memberAddress', 'address'] as const
    case 'CANCEL_GROUP_BAN': return ['member', 'qortalAddress', 'offender', 'memberAddress', 'address'] as const
    case 'GROUP_KICK': return ['member', 'qortalAddress', 'memberAddress', 'address'] as const
  }
}

function wireAction(action: HomeV2CanonicalGroupAdminAction): HomeV2GroupAdminWireAction {
  return action === 'APPROVE_GROUP_JOIN_REQUEST' || action === 'INVITE_TO_GROUP'
    ? 'GROUP_INVITE'
    : action
}

function transactionPayload(request: HomeV2GroupAdminRequest) {
  const address = exactBytes(request.memberAddress, ADDRESS_LENGTH, 'Member address')
  const groupId = int32Bytes(request.groupId, 'Group ID')
  switch (request.wireAction) {
    case 'GROUP_BAN':
      return concatBytes(
        groupId,
        address,
        sizedUtf8(request.reason, 'reason', MAX_REASON_BYTES),
        int32Bytes(request.timeToLive, 'timeToLive'),
      )
    case 'GROUP_KICK':
      return concatBytes(groupId, address, sizedUtf8(request.reason, 'reason', MAX_REASON_BYTES))
    case 'GROUP_INVITE':
      return concatBytes(groupId, address, int32Bytes(request.timeToLive, 'timeToLive'))
    default:
      return concatBytes(groupId, address)
  }
}

export function isHomeV2GroupAdminAction(value: string): value is HomeV2GroupAdminAction {
  return (HOME_V2_GROUP_ADMIN_ACTIONS as readonly string[]).includes(value) ||
    (HOME_V2_GROUP_ADMIN_ALIASES as readonly string[]).includes(value)
}

export function normalizeHomeV2GroupAdminRequest(
  action: HomeV2GroupAdminAction,
  value: Record<string, unknown>,
): HomeV2GroupAdminRequest {
  const canonicalAction = canonicalHomeV2GroupAdminAction(action)
  const memberAddress = requestString(value, memberKeys(canonicalAction))
  if (!memberAddress) throw new Error('A group member address is required.')
  assertValidQortalAddress(memberAddress, 'Member address')
  exactBytes(memberAddress, ADDRESS_LENGTH, 'Member address')
  const reason = canonicalAction === 'GROUP_BAN' || canonicalAction === 'GROUP_KICK'
    ? (typeof value.reason === 'string' ? value.reason : '')
    : ''
  sizedUtf8(reason, 'reason', MAX_REASON_BYTES)
  const timeToLive = canonicalAction === 'APPROVE_GROUP_JOIN_REQUEST' || canonicalAction === 'INVITE_TO_GROUP' || canonicalAction === 'GROUP_BAN'
    ? nonNegativeInt32(value.timeToLive ?? value.ttl ?? value.banTime ?? value.inviteTime, 'timeToLive')
    : 0
  return Object.freeze({
    action: canonicalAction,
    groupId: positiveGroupId(value.groupId),
    memberAddress,
    reason,
    timeToLive,
    wireAction: wireAction(canonicalAction),
  })
}

export function normalizeHomeV2GroupAdminTarget(
  value: unknown,
  groupId: number,
  network: HomeV2AppNetwork,
): HomeV2GroupAdminTarget {
  if (!isRecord(value)) throw new Error(`Home could not verify the selected ${network} group.`)
  const actualId = positiveGroupId(value.groupId)
  const ownerAddress = typeof value.owner === 'string' && value.owner.trim()
    ? value.owner.trim()
    : typeof value.ownerAddress === 'string' && value.ownerAddress.trim()
      ? value.ownerAddress.trim()
      : ''
  if (actualId !== groupId || !ownerAddress) {
    throw new Error(`Home could not verify the selected ${network} group.`)
  }
  assertValidQortalAddress(ownerAddress, 'Group owner address')
  exactBytes(ownerAddress, ADDRESS_LENGTH, 'Group owner address')
  return Object.freeze({
    groupId,
    groupName: typeof value.groupName === 'string' && value.groupName.trim()
      ? value.groupName.trim()
      : `Group ${groupId}`,
    ownerAddress,
  })
}

export function homeV2GroupAdminRequiredRole(action: HomeV2GroupAdminAction) {
  const canonicalAction = canonicalHomeV2GroupAdminAction(action)
  return canonicalAction === 'ADD_GROUP_ADMIN' ||
    canonicalAction === 'REMOVE_GROUP_ADMIN' ||
    canonicalAction === 'GROUP_BAN' ||
    canonicalAction === 'CANCEL_GROUP_BAN' ||
    canonicalAction === 'GROUP_KICK'
    ? 'owner' as const
    : 'admin' as const
}

export function normalizeHomeV2GroupAdminAddresses(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.groupMembers)) {
    throw new Error('Home could not verify the selected group administrators.')
  }
  const addresses: string[] = []
  for (const entry of value.groupMembers) {
    if (!isRecord(entry) || typeof entry.member !== 'string' || !entry.member.trim()) {
      throw new Error('Home received malformed group administrator data.')
    }
    const address = entry.member.trim()
    assertValidQortalAddress(address, 'Group administrator address')
    exactBytes(address, ADDRESS_LENGTH, 'Group administrator address')
    addresses.push(address)
  }
  return Object.freeze(addresses)
}

export function hasHomeV2GroupJoinRequest(value: unknown, groupId: number, memberAddress: string) {
  if (!Array.isArray(value)) throw new Error('Home could not verify the selected group join requests.')
  return value.some((entry) => isRecord(entry) &&
    positiveGroupId(entry.groupId) === groupId &&
    typeof entry.joiner === 'string' &&
    entry.joiner.trim() === memberAddress)
}

export function assertHomeV2GroupAdminAuthority(input: {
  readonly accountAddress: string
  readonly action: HomeV2GroupAdminAction
  readonly adminAddresses: readonly string[]
  readonly target: HomeV2GroupAdminTarget
}) {
  const requiredRole = homeV2GroupAdminRequiredRole(input.action)
  const isOwner = input.accountAddress === input.target.ownerAddress
  const isAdmin = isOwner || input.adminAddresses.includes(input.accountAddress)
  if ((requiredRole === 'owner' && !isOwner) || (requiredRole === 'admin' && !isAdmin)) {
    throw new Error(
      requiredRole === 'owner'
        ? 'The selected account is not the current group owner.'
        : 'The selected account is not a current group administrator.',
    )
  }
}

export function homeV2GroupAdminOperationLabel(action: HomeV2GroupAdminAction) {
  switch (canonicalHomeV2GroupAdminAction(action)) {
    case 'APPROVE_GROUP_JOIN_REQUEST': return 'Approve join request'
    case 'INVITE_TO_GROUP': return 'Invite member'
    case 'CANCEL_GROUP_INVITE': return 'Cancel group invite'
    case 'ADD_GROUP_ADMIN': return 'Add group admin'
    case 'REMOVE_GROUP_ADMIN': return 'Remove group admin'
    case 'GROUP_BAN': return 'Ban member'
    case 'CANCEL_GROUP_BAN': return 'Cancel group ban'
    case 'GROUP_KICK': return 'Kick member'
  }
}

export function buildUnsignedQortiumGroupAdminTransactionBytes(input: {
  readonly feeAtomic?: bigint
  readonly request: HomeV2GroupAdminRequest
  readonly senderPublicKey: string | Uint8Array
  readonly timestamp: number
  readonly txGroupId?: number
}) {
  return concatBytes(
    int32Bytes(ACTION_TYPES[input.request.wireAction], 'Transaction type'),
    int64Bytes(BigInt(input.timestamp), 'Timestamp'),
    int32Bytes(input.txGroupId ?? TRANSACTION_GROUP_ID, 'Transaction group ID'),
    exactBytes(input.senderPublicKey, PUBLIC_KEY_LENGTH, 'Sender public key'),
    int32Bytes(0, 'MemoryPoW nonce'),
    transactionPayload(input.request),
    int64Bytes(input.feeAtomic ?? 0n, 'Transaction fee'),
  )
}

export function buildUnsignedQortalGroupAdminTransactionBytes(input: {
  readonly feeAtomic: bigint
  readonly lastReference: string | Uint8Array
  readonly request: HomeV2GroupAdminRequest
  readonly senderPublicKey: string | Uint8Array
  readonly timestamp: number
  readonly txGroupId?: number
}) {
  return concatBytes(
    int32Bytes(ACTION_TYPES[input.request.wireAction], 'Transaction type'),
    int64Bytes(BigInt(input.timestamp), 'Timestamp'),
    int32Bytes(input.txGroupId ?? TRANSACTION_GROUP_ID, 'Transaction group ID'),
    exactBytes(input.lastReference, REFERENCE_LENGTH, 'Last reference'),
    exactBytes(input.senderPublicKey, PUBLIC_KEY_LENGTH, 'Sender public key'),
    transactionPayload(input.request),
    int64Bytes(input.feeAtomic, 'Transaction fee'),
  )
}

export function assertUnsignedHomeV2GroupAdminTransaction(
  bytes: Uint8Array,
  expected: {
    readonly feeAtomic: bigint
    readonly lastReference?: string | Uint8Array
    readonly network: HomeV2AppNetwork
    readonly nonce?: number
    readonly request: HomeV2GroupAdminRequest
    readonly senderPublicKey: string | Uint8Array
    readonly timestamp: number
    readonly txGroupId?: number
  },
) {
  const label = `${expected.network} ${expected.request.wireAction} transaction`
  const reader = new ByteReader(bytes)
  if (reader.int32('Transaction type') !== ACTION_TYPES[expected.request.wireAction]) {
    throw new Error(`${label} changed the approved transaction type.`)
  }
  if (reader.int64('Timestamp') !== BigInt(expected.timestamp)) throw new Error(`${label} changed the approved timestamp.`)
  if (reader.int32('Transaction group ID') !== (expected.txGroupId ?? TRANSACTION_GROUP_ID)) {
    throw new Error(`${label} changed the approved transaction group.`)
  }
  if (expected.network === 'qortal') {
    const reference = exactBytes(expected.lastReference ?? new Uint8Array(0), REFERENCE_LENGTH, 'Last reference')
    if (!equalBytes(reader.exact(REFERENCE_LENGTH, 'Last reference'), reference)) {
      throw new Error(`${label} changed the approved last reference.`)
    }
  }
  const publicKey = exactBytes(expected.senderPublicKey, PUBLIC_KEY_LENGTH, 'Sender public key')
  if (!equalBytes(reader.exact(PUBLIC_KEY_LENGTH, 'Sender public key'), publicKey)) {
    throw new Error(`${label} changed the approved sender.`)
  }
  if (expected.network === 'qortium') {
    const actualNonce = reader.int32('MemoryPoW nonce') >>> 0
    const expectedNonce = expected.nonce ?? 0
    if (!Number.isInteger(expectedNonce) || expectedNonce < 0 || expectedNonce > 0xffffffff) {
      throw new Error('Expected MemoryPoW nonce must be a uint32.')
    }
    if (actualNonce !== expectedNonce) {
      throw new Error(`${label} changed the approved MemoryPoW nonce.`)
    }
  }
  if (reader.int32('Group ID') !== expected.request.groupId) throw new Error(`${label} changed the approved group.`)
  const memberAddress = exactBytes(expected.request.memberAddress, ADDRESS_LENGTH, 'Member address')
  if (!equalBytes(reader.exact(ADDRESS_LENGTH, 'Member address'), memberAddress)) {
    throw new Error(`${label} changed the approved member.`)
  }
  if (expected.request.wireAction === 'GROUP_BAN' || expected.request.wireAction === 'GROUP_KICK') {
    if (reader.sizedUtf8('reason', MAX_REASON_BYTES) !== expected.request.reason) {
      throw new Error(`${label} changed the approved reason.`)
    }
  }
  if (expected.request.wireAction === 'GROUP_BAN' || expected.request.wireAction === 'GROUP_INVITE') {
    if (reader.int32('timeToLive') !== expected.request.timeToLive) {
      throw new Error(`${label} changed the approved lifetime.`)
    }
  }
  if (reader.int64('Transaction fee') !== expected.feeAtomic) throw new Error(`${label} changed the approved fee.`)
  reader.done(label)
}

export function normalizeHomeV2GroupAdminFee(value: unknown) {
  const fee = atomicLongToBigInt(value, 'Qortal group administration transaction fee')
  if (fee < 0n) throw new Error('Qortal group administration transaction fee cannot be negative.')
  return fee
}

export function qortalGroupAdminFeeType(request: HomeV2GroupAdminRequest) {
  return request.wireAction
}

export function groupAdminIdempotentResult(action: HomeV2CanonicalGroupAdminAction, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if ((action === 'APPROVE_GROUP_JOIN_REQUEST' || action === 'INVITE_TO_GROUP') && /\bALREADY_GROUP_MEMBER\b/.test(message)) return true
  if (action === 'ADD_GROUP_ADMIN' && /\bALREADY_GROUP_ADMIN\b/.test(message)) return true
  if (action === 'REMOVE_GROUP_ADMIN' && /\bNOT_GROUP_ADMIN\b/.test(message)) return true
  if (action === 'GROUP_BAN' && /\bBAN_EXISTS\b/.test(message)) return true
  if (action === 'CANCEL_GROUP_BAN' && /\bBAN_UNKNOWN\b/.test(message)) return true
  if (action === 'GROUP_KICK' && /\bNOT_GROUP_MEMBER\b/.test(message)) return true
  if (action === 'CANCEL_GROUP_INVITE' && /\bINVITE_UNKNOWN\b/.test(message)) return true
  return false
}

export function createHomeV2GroupAdminSuccess(input: {
  readonly changed: boolean
  readonly network: HomeV2AppNetwork
  readonly request: HomeV2GroupAdminRequest
  readonly target: HomeV2GroupAdminTarget
  readonly signature?: string
  readonly timestamp?: number
}) {
  return Object.freeze({
    accepted: true as const,
    action: input.request.action,
    changed: input.changed,
    groupId: input.request.groupId,
    groupName: input.target.groupName,
    memberAddress: input.request.memberAddress,
    network: input.network,
    wireAction: input.request.wireAction,
    ...(input.signature ? { signature: input.signature, transactionSignature: input.signature } : {}),
    ...(input.timestamp !== undefined ? { timestamp: input.timestamp } : {}),
  })
}

export function createHomeV2UnknownGroupAdminBroadcastResult(input: {
  readonly error: unknown
  readonly network: HomeV2AppNetwork
  readonly request: HomeV2GroupAdminRequest
  readonly signedBytes: Uint8Array
  readonly target: HomeV2GroupAdminTarget
  readonly timestamp: number
}) {
  const signature = getSignatureFromSignedTransactionBytes(input.signedBytes)
  return Object.freeze({
    accepted: false as const,
    action: input.request.action,
    error: input.error instanceof Error ? input.error.message : String(input.error),
    errorType: 'BROADCAST_OUTCOME_UNKNOWN' as const,
    groupId: input.request.groupId,
    groupName: input.target.groupName,
    memberAddress: input.request.memberAddress,
    network: input.network,
    outcome: 'unknown' as const,
    retryable: false as const,
    signature,
    timestamp: input.timestamp,
    transactionSignature: signature,
    wireAction: input.request.wireAction,
  })
}

export function appendHomeV2GroupAdminSignature(unsignedBytes: Uint8Array, signature: Uint8Array) {
  if (signature.byteLength !== SIGNATURE_LENGTH) throw new Error('Transaction signature must be 64 bytes.')
  return appendSignatureToTransactionBytes(unsignedBytes, signature)
}

export function encodeHomeV2GroupAdminTransaction(bytes: Uint8Array) {
  return base58Encode(bytes)
}
