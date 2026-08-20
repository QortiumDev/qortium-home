import { base58Decode, base58Encode } from './base58.js'
import {
  appendSignatureToTransactionBytes,
  atomicLongToBigInt,
  getSignatureFromSignedTransactionBytes,
} from './qortal-payment.js'
import type { HomeV2AppNetwork } from './home-v2-app-actions.js'

export const HOME_V2_GROUP_MEMBERSHIP_ACTIONS = Object.freeze([
  'JOIN_GROUP',
  'LEAVE_GROUP',
] as const)

export type HomeV2GroupMembershipAction = typeof HOME_V2_GROUP_MEMBERSHIP_ACTIONS[number]

export type HomeV2GroupMembershipRequest = {
  readonly action: HomeV2GroupMembershipAction
  readonly groupId: number
}

export type HomeV2GroupMembershipTarget = {
  readonly groupId: number
  readonly groupName: string
  readonly isMintingGroup: boolean
  readonly isOpen: boolean
}

const QORTAL_GROUP_TRANSACTION_GROUP_ID = 0
const QORTAL_JOIN_GROUP_TYPE = 31
const QORTAL_LEAVE_GROUP_TYPE = 32
const PUBLIC_KEY_LENGTH = 32
const REFERENCE_LENGTH = 64

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function concatBytes(...chunks: Uint8Array[]) {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function int32Bytes(value: number, label: string) {
  if (!Number.isInteger(value) || value < -2_147_483_648 || value > 2_147_483_647) {
    throw new Error(`${label} must be a signed 32-bit integer.`)
  }
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setInt32(0, value, false)
  return bytes
}

function int64Bytes(value: bigint, label: string) {
  if (value < 0n || value > 9_223_372_036_854_775_807n) {
    throw new Error(`${label} is outside the signed 64-bit transaction range.`)
  }
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigInt64(0, value, false)
  return bytes
}

function exactBytes(value: string | Uint8Array, byteLength: number, label: string) {
  const bytes = typeof value === 'string' ? base58Decode(value) : new Uint8Array(value)
  if (bytes.byteLength !== byteLength) throw new Error(`${label} must be ${byteLength} bytes.`)
  return bytes
}

export function isHomeV2GroupMembershipAction(value: string): value is HomeV2GroupMembershipAction {
  return (HOME_V2_GROUP_MEMBERSHIP_ACTIONS as readonly string[]).includes(value)
}

export function normalizeHomeV2GroupMembershipRequest(
  action: HomeV2GroupMembershipAction,
  value: Record<string, unknown>,
): HomeV2GroupMembershipRequest {
  const raw = value.groupId
  const groupId = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && /^\d+$/.test(raw.trim())
      ? Number(raw.trim())
      : Number.NaN
  if (!Number.isSafeInteger(groupId) || groupId <= 0 || groupId > 2_147_483_647) {
    throw new Error('groupId must be a positive safe integer.')
  }
  return Object.freeze({ action, groupId })
}

export function normalizeHomeV2GroupMembershipTarget(
  value: unknown,
  groupId: number,
  network: HomeV2AppNetwork,
): HomeV2GroupMembershipTarget {
  if (!isRecord(value)) throw new Error(`Home could not verify the selected ${network} group.`)
  const rawId = value.groupId
  const actualId = typeof rawId === 'number'
    ? rawId
    : typeof rawId === 'string' && /^\d+$/.test(rawId)
      ? Number(rawId)
      : Number.NaN
  if (actualId !== groupId) throw new Error(`Home could not verify the selected ${network} group.`)
  const groupName = typeof value.groupName === 'string' && value.groupName.trim()
    ? value.groupName.trim()
    : `Group ${groupId}`
  return Object.freeze({
    groupId,
    groupName,
    isMintingGroup: value.isMintingGroup === true,
    isOpen: value.isOpen === true,
  })
}

export function buildUnsignedQortalGroupMembershipTransactionBytes(input: {
  readonly action: HomeV2GroupMembershipAction
  readonly feeAtomic: bigint
  readonly groupId: number
  readonly lastReference: string | Uint8Array
  readonly senderPublicKey: string | Uint8Array
  readonly timestamp: number
}) {
  const type = input.action === 'JOIN_GROUP' ? QORTAL_JOIN_GROUP_TYPE : QORTAL_LEAVE_GROUP_TYPE
  return concatBytes(
    int32Bytes(type, 'Transaction type'),
    int64Bytes(BigInt(input.timestamp), 'Timestamp'),
    int32Bytes(QORTAL_GROUP_TRANSACTION_GROUP_ID, 'Transaction group ID'),
    exactBytes(input.lastReference, REFERENCE_LENGTH, 'Last reference'),
    exactBytes(input.senderPublicKey, PUBLIC_KEY_LENGTH, 'Sender public key'),
    int32Bytes(input.groupId, 'Group ID'),
    int64Bytes(input.feeAtomic, 'Transaction fee'),
  )
}

export function normalizeQortalGroupMembershipFee(value: unknown) {
  const fee = atomicLongToBigInt(value, 'Qortal group transaction fee')
  if (fee < 0n) throw new Error('Qortal group transaction fee cannot be negative.')
  return fee
}

export function qortalGroupMembershipFeeType(action: HomeV2GroupMembershipAction) {
  return action
}

export function createHomeV2GroupMembershipSuccess(input: {
  readonly action: HomeV2GroupMembershipAction
  readonly groupId: number
  readonly groupName: string
  readonly network: HomeV2AppNetwork
  readonly signature?: string
  readonly timestamp?: number
  readonly changed: boolean
  readonly membership?: 'joined' | 'left' | 'requested'
}) {
  return Object.freeze({
    accepted: true as const,
    action: input.action,
    changed: input.changed,
    groupId: input.groupId,
    groupName: input.groupName,
    membership: input.membership ?? (input.action === 'JOIN_GROUP' ? 'joined' as const : 'left' as const),
    network: input.network,
    ...(input.signature ? { signature: input.signature, transactionSignature: input.signature } : {}),
    ...(input.timestamp !== undefined ? { timestamp: input.timestamp } : {}),
  })
}

export function createHomeV2UnknownGroupMembershipBroadcastResult(input: {
  readonly action: HomeV2GroupMembershipAction
  readonly error: unknown
  readonly groupId: number
  readonly groupName: string
  readonly network: HomeV2AppNetwork
  readonly signedBytes: Uint8Array
  readonly timestamp: number
}) {
  const signature = getSignatureFromSignedTransactionBytes(input.signedBytes)
  return Object.freeze({
    accepted: false as const,
    action: input.action,
    error: input.error instanceof Error ? input.error.message : String(input.error),
    errorType: 'BROADCAST_OUTCOME_UNKNOWN' as const,
    groupId: input.groupId,
    groupName: input.groupName,
    network: input.network,
    outcome: 'unknown' as const,
    retryable: false as const,
    signature,
    timestamp: input.timestamp,
    transactionSignature: signature,
  })
}

export function groupMembershipIdempotentState(
  action: HomeV2GroupMembershipAction,
  error: unknown,
): 'joined' | 'left' | 'requested' | null {
  const message = error instanceof Error ? error.message : String(error)
  if (action === 'JOIN_GROUP' && /\bALREADY_GROUP_MEMBER\b/.test(message)) return 'joined'
  if (action === 'JOIN_GROUP' && /\bJOIN_REQUEST_EXISTS\b/.test(message)) return 'requested'
  if (action === 'LEAVE_GROUP' && /\bNOT_GROUP_MEMBER\b/.test(message)) return 'left'
  return null
}

export function appendHomeV2GroupMembershipSignature(
  unsignedBytes: Uint8Array,
  signature: Uint8Array,
) {
  return appendSignatureToTransactionBytes(unsignedBytes, signature)
}

export function encodeHomeV2GroupMembershipTransaction(bytes: Uint8Array) {
  return base58Encode(bytes)
}
