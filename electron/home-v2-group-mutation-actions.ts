import {
  ByteReader,
  concatBytes,
  equalBytes,
  exactBytes,
  int32Bytes,
  int64Bytes,
  nonNegativeInt32,
  positiveGroupId,
  sizedUtf8,
} from './home-v2-group-admin-actions.js'
import { homeV2FlattenPayloadRequest } from './home-v2-app-actions.js'
import { base58Decode, base58Encode } from './base58.js'
import { getStaticQdnServiceId,
  getAvatarQdnServiceId,
} from './public-transaction-validation.js'

/**
 * The deferred group mutation family (Home 2.1 restoration): CREATE_GROUP,
 * UPDATE_GROUP, GROUP_APPROVAL, SET_GROUP, SET_GROUP_AVATAR — Qortium
 * qdnRequest only, each one fee-free signed transaction built LOCALLY on the
 * group-admin transformer pattern (types 24-30 already ship this way): no
 * Core builder is involved, the unsigned bytes are constructed here,
 * byte-verified, MemoryPoW-stamped, verified again, and signed locally.
 *
 * Wire facts (audited against Core's transformers, 2026-08-26): every type
 * uses the 52-byte no-reference prefix `type i32 | timestamp i64 |
 * txGroupId i32 | publicKey 32 | nonce i32`, then the type body, then
 * `fee i64`. There is NO last reference. UPDATE_GROUP (23) has NO owner
 * field — Qortal Hub's newOwner contract is a different transaction and must
 * never be transplanted. SET_GROUP_AVATAR (49) carries only a QDN pointer
 * `{service, name, identifier}` — never bytes, hashes, or signatures.
 *
 * txGroupId policy: GROUP_APPROVAL and SET_GROUP require 0 on-chain. CREATE,
 * UPDATE, and SET_GROUP_AVATAR are pinned to 0 by Home as well: an ordinary
 * group's update/avatar must carry its creationGroupId, but Core keeps that
 * field @XmlTransient (never exposed via the API), so only the common
 * no-group case (creationGroupId 0) is derivable — a group created inside a
 * transaction group surfaces Core's TX_GROUP_ID_MISMATCH at processing,
 * which the bridge reports through the unknown-outcome path for
 * reconciliation. Documented in BRIDGE_ACTIONS.md.
 */
export const HOME_V2_GROUP_MUTATION_ACTIONS = Object.freeze([
  'CREATE_GROUP',
  'GROUP_APPROVAL',
  'SET_GROUP',
  'SET_GROUP_AVATAR',
  'UPDATE_GROUP',
] as const)

export type HomeV2GroupMutationAction = (typeof HOME_V2_GROUP_MUTATION_ACTIONS)[number]

const GROUP_MUTATION_ACTIONS = new Set<string>(HOME_V2_GROUP_MUTATION_ACTIONS)

export function isHomeV2GroupMutationAction(value: string): value is HomeV2GroupMutationAction {
  return GROUP_MUTATION_ACTIONS.has(value)
}

const MUTATION_TYPES: Readonly<Record<HomeV2GroupMutationAction, number>> = Object.freeze({
  CREATE_GROUP: 22,
  GROUP_APPROVAL: 33,
  SET_GROUP: 34,
  SET_GROUP_AVATAR: 49,
  UPDATE_GROUP: 23,
})

// Shared between the bridge (which stamps it on the prompt) and the shell
// (which refuses a prompt whose caption does not match its action).
export function homeV2GroupMutationOperationLabel(action: HomeV2GroupMutationAction, opposition = false) {
  if (action === 'CREATE_GROUP') return 'Create a group'
  if (action === 'UPDATE_GROUP') return 'Update a group'
  if (action === 'SET_GROUP') return 'Set the default group'
  if (action === 'SET_GROUP_AVATAR') return 'Change a group avatar'
  return opposition ? 'Oppose a pending group transaction' : 'Approve a pending group transaction'
}

// Wire values for the seven approval-threshold names (Core's enum).
export const HOME_V2_APPROVAL_THRESHOLDS: Readonly<Record<string, number>> = Object.freeze({
  NONE: 0,
  ONE: 1,
  PCT20: 20,
  PCT40: 40,
  PCT60: 60,
  PCT80: 80,
  PCT100: 100,
})

const TEXT_ENCODER = new TextEncoder()

function utf8Length(value: string) {
  return TEXT_ENCODER.encode(value).byteLength
}

// Core: 3-32 UTF-8 bytes and already in Core's Unicode normalized form.
// The NFKC/invisible/whitespace approximation gives the common cases a named
// local refusal; Core stays authoritative (an exotic name can still answer
// its normalization error from processing).
function groupNameValue(value: string, label: string) {
  const byteLength = utf8Length(value)
  if (byteLength < 3 || byteLength > 32) {
    throw new Error(`${label} must be 3 to 32 UTF-8 bytes.`)
  }
  if (
    value !== value.normalize('NFKC') ||
    /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/.test(value) ||
    /\s{2,}/.test(value) ||
    /[^\S ]/.test(value)
  ) {
    throw new Error(`${label} must be in Unicode normalized form (no compatibility characters, controls, invisible characters, or repeated whitespace).`)
  }
  return value
}

// Core: a group description is REQUIRED, 1-128 UTF-8 bytes. 1.x defaulted it
// to '' and let Core reject; Home 2 refuses the empty form with the rule.
function groupDescriptionValue(value: unknown, label: string) {
  const description = typeof value === 'string' ? value.trim() : ''
  const byteLength = utf8Length(description)
  if (byteLength < 1 || byteLength > 128) {
    throw new Error(`${label} must be 1 to 128 UTF-8 bytes.`)
  }
  return description
}

function strictOptionalBoolean(value: unknown, label: string) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`)
  return value
}

function approvalThresholdValue(value: unknown, fallback: string | undefined, label: string) {
  const raw = typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : fallback
  if (raw === undefined) return undefined
  if (!(raw in HOME_V2_APPROVAL_THRESHOLDS)) {
    throw new Error(`${label} must be one of ${Object.keys(HOME_V2_APPROVAL_THRESHOLDS).join(', ')}.`)
  }
  return raw
}

// The fee-less MemoryPoW path is the only signing path Home 2 carries, and
// every type in this family is pinned to transaction group 0 (see the module
// comment). Any other value is refused, never silently replaced.
function assertGroupMutationFeeAndGroup(request: Record<string, unknown>) {
  const fee = request.fee
  if (fee !== undefined && fee !== null && fee !== 0) {
    throw new Error('Home 2 signs group transactions fee-free; fee, when present, must be 0.')
  }
  for (const key of ['txGroupId', 'feeGroupId'] as const) {
    const value = request[key]
    if (value === undefined || value === null) continue
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
    if (parsed !== 0) {
      throw new Error('Home 2 group transactions use transaction group 0; txGroupId, when present, must be 0.')
    }
  }
}

export type HomeV2CreateGroupRequest = {
  readonly approvalThreshold: string
  readonly description: string
  readonly groupName: string
  readonly isOpen: boolean
  readonly maximumBlockDelay: number
  readonly minimumBlockDelay: number
}

export function normalizeHomeV2CreateGroupRequest(request: Record<string, unknown>): HomeV2CreateGroupRequest {
  request = homeV2FlattenPayloadRequest(request)
  assertGroupMutationFeeAndGroup(request)
  const nameRaw = typeof request.groupName === 'string' ? request.groupName.trim() : ''
  if (!nameRaw) throw new Error('Group name is required.')
  const groupName = groupNameValue(nameRaw, 'Group name')
  const description = groupDescriptionValue(request.description, 'Group description')
  const isOpen = strictOptionalBoolean(request.isOpen ?? request.open, 'isOpen') ?? false
  const approvalThreshold = approvalThresholdValue(request.approvalThreshold, 'NONE', 'Approval threshold')!
  const minimumBlockDelay = nonNegativeInt32(request.minimumBlockDelay ?? request.minBlockDelay, 'Minimum block delay', 5)
  const maximumBlockDelay = nonNegativeInt32(
    request.maximumBlockDelay ?? request.maxBlockDelay,
    'Maximum block delay',
    Math.max(10, minimumBlockDelay),
  )
  if (maximumBlockDelay < 1) throw new Error('Maximum block delay must be at least 1.')
  if (maximumBlockDelay < minimumBlockDelay) {
    throw new Error('Maximum block delay must be at least the minimum block delay.')
  }
  return Object.freeze({ approvalThreshold, description, groupName, isOpen, maximumBlockDelay, minimumBlockDelay })
}

export type HomeV2UpdateGroupRequest = {
  readonly groupId: number
  // Each undefined field means "keep the current value"; the bridge resolves
  // them against the live group before anything is shown or signed. newName
  // '' is the wire's own no-rename convention.
  readonly newApprovalThreshold?: string
  readonly newDescription?: string
  readonly newIsOpen?: boolean
  readonly newMaximumBlockDelay?: number
  readonly newMinimumBlockDelay?: number
  readonly newName: string
}

export function normalizeHomeV2UpdateGroupRequest(request: Record<string, unknown>): HomeV2UpdateGroupRequest {
  request = homeV2FlattenPayloadRequest(request)
  assertGroupMutationFeeAndGroup(request)
  const groupId = positiveGroupId(request.groupId)
  const newNameSource = request.newName ?? request.groupName
  const newNameRaw = typeof newNameSource === 'string' ? newNameSource.trim() : ''
  const newName = newNameRaw === '' ? '' : groupNameValue(newNameRaw, 'New group name')
  const newDescriptionRaw = request.newDescription ?? request.description
  const newDescription = newDescriptionRaw === undefined || newDescriptionRaw === null
    ? undefined
    : groupDescriptionValue(newDescriptionRaw, 'New group description')
  const newIsOpen = strictOptionalBoolean(request.newIsOpen ?? request.isOpen, 'newIsOpen')
  const newApprovalThreshold = approvalThresholdValue(
    request.newApprovalThreshold ?? request.approvalThreshold,
    undefined,
    'New approval threshold',
  )
  const newMinimumBlockDelay = request.newMinimumBlockDelay === undefined && request.minimumBlockDelay === undefined
    ? undefined
    : nonNegativeInt32(request.newMinimumBlockDelay ?? request.minimumBlockDelay, 'New minimum block delay')
  const newMaximumBlockDelay = request.newMaximumBlockDelay === undefined && request.maximumBlockDelay === undefined
    ? undefined
    : nonNegativeInt32(request.newMaximumBlockDelay ?? request.maximumBlockDelay, 'New maximum block delay')
  return Object.freeze({
    groupId,
    newName,
    ...(newDescription === undefined ? {} : { newDescription }),
    ...(newIsOpen === undefined ? {} : { newIsOpen }),
    ...(newApprovalThreshold === undefined ? {} : { newApprovalThreshold }),
    ...(newMinimumBlockDelay === undefined ? {} : { newMinimumBlockDelay }),
    ...(newMaximumBlockDelay === undefined ? {} : { newMaximumBlockDelay }),
  })
}

export type HomeV2GroupApprovalRequest = {
  readonly approval: boolean
  // Optional app-supplied assertion; the live pending transaction's own
  // txGroupId is authoritative and a mismatch refuses.
  readonly assertedGroupId?: number
  readonly pendingSignature: string
}

export function normalizeHomeV2GroupApprovalRequest(request: Record<string, unknown>): HomeV2GroupApprovalRequest {
  request = homeV2FlattenPayloadRequest(request)
  assertGroupMutationFeeAndGroup(request)
  const raw = typeof request.pendingSignature === 'string' ? request.pendingSignature.trim() : ''
  if (!raw) throw new Error('Pending transaction signature is required.')
  let decoded: Uint8Array
  try {
    decoded = base58Decode(raw)
  } catch {
    throw new Error('Pending transaction signature must be Base58.')
  }
  if (decoded.byteLength !== 64 || base58Encode(decoded) !== raw) {
    throw new Error('Pending transaction signature must be a canonical 64-byte Base58 signature.')
  }
  const approval = strictOptionalBoolean(request.approval, 'approval')
  if (approval === undefined) throw new Error('approval is required and must be a boolean.')
  const assertedGroupId = request.groupId === undefined || request.groupId === null
    ? undefined
    : positiveGroupId(request.groupId)
  return Object.freeze({
    approval,
    pendingSignature: raw,
    ...(assertedGroupId === undefined ? {} : { assertedGroupId }),
  })
}

export type HomeV2SetGroupRequest = { readonly defaultGroupId: number }

export function normalizeHomeV2SetGroupRequest(request: Record<string, unknown>): HomeV2SetGroupRequest {
  request = homeV2FlattenPayloadRequest(request)
  assertGroupMutationFeeAndGroup(request)
  // 1.x accepted 0; current Core rejects it (there is no group 0), so a
  // positive existing group is required with the real rule named.
  return Object.freeze({ defaultGroupId: positiveGroupId(request.defaultGroupId ?? request.groupId) })
}

export type HomeV2GroupAvatarPointer = {
  readonly identifier: string
  readonly name: string
  readonly service: string
  readonly serviceId: number
}

export type HomeV2SetGroupAvatarRequest = {
  // null clears the group's avatar pointer.
  readonly avatar: HomeV2GroupAvatarPointer | null
  readonly groupId: number
}

export function normalizeHomeV2SetGroupAvatarRequest(request: Record<string, unknown>): HomeV2SetGroupAvatarRequest {
  request = homeV2FlattenPayloadRequest(request)
  assertGroupMutationFeeAndGroup(request)
  const groupId = positiveGroupId(request.groupId)
  const avatarRaw = request.avatar
  if (avatarRaw === undefined || avatarRaw === null) {
    return Object.freeze({ avatar: null, groupId })
  }
  if (typeof avatarRaw !== 'object' || Array.isArray(avatarRaw)) {
    throw new Error('avatar must be null (to clear) or an object with service and name.')
  }
  const record = avatarRaw as Record<string, unknown>
  const service = typeof record.service === 'string' ? record.service.trim().toUpperCase() : ''
  if (!service) throw new Error('avatar.service is required.')
  // Core's avatar rule exactly: public single-file services only (a
  // WEBSITE or other multi-file pointer would sign a transaction Core
  // deterministically rejects, journaled as an ambiguous outcome). The
  // raster/500 KiB bounds are enforced when the avatar is SERVED, not
  // here — the transaction is a pointer.
  const serviceId = getAvatarQdnServiceId(service)
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (!name) throw new Error('avatar.name is required.')
  if (utf8Length(name) > 40) throw new Error('avatar.name must be at most 40 UTF-8 bytes.')
  const identifierRaw = typeof record.identifier === 'string' ? record.identifier.trim() : ''
  // 'default' and absent are ONE served avatar but would sign different
  // bytes and display identically — sign the canonical empty form for both
  // (avatar review round 2; same rule as SET_ACCOUNT_AVATAR).
  const identifier = identifierRaw === 'default' ? '' : identifierRaw
  if (utf8Length(identifier) > 64) throw new Error('avatar.identifier must be at most 64 UTF-8 bytes.')
  return Object.freeze({ avatar: Object.freeze({ identifier, name, service, serviceId }), groupId })
}

export type HomeV2GroupMutationWirePayload =
  | { readonly action: 'CREATE_GROUP'; readonly request: HomeV2CreateGroupRequest }
  | {
      readonly action: 'UPDATE_GROUP'
      readonly groupId: number
      // The COMPLETE replacement values after merging with the live group.
      readonly resolved: {
        readonly approvalThreshold: string
        readonly description: string
        readonly isOpen: boolean
        readonly maximumBlockDelay: number
        readonly minimumBlockDelay: number
        readonly newName: string
      }
    }
  | { readonly action: 'GROUP_APPROVAL'; readonly approval: boolean; readonly pendingSignature: string }
  | { readonly action: 'SET_GROUP'; readonly defaultGroupId: number }
  | { readonly action: 'SET_GROUP_AVATAR'; readonly avatar: HomeV2GroupAvatarPointer | null; readonly groupId: number }

function mutationBody(payload: HomeV2GroupMutationWirePayload): Uint8Array {
  if (payload.action === 'CREATE_GROUP') {
    return concatBytes(
      sizedUtf8(payload.request.groupName, 'Group name', 32),
      sizedUtf8(payload.request.description, 'Group description', 128),
      new Uint8Array([payload.request.isOpen ? 1 : 0]),
      new Uint8Array([HOME_V2_APPROVAL_THRESHOLDS[payload.request.approvalThreshold]]),
      int32Bytes(payload.request.minimumBlockDelay, 'Minimum block delay'),
      int32Bytes(payload.request.maximumBlockDelay, 'Maximum block delay'),
    )
  }
  if (payload.action === 'UPDATE_GROUP') {
    return concatBytes(
      int32Bytes(payload.groupId, 'Group ID'),
      sizedUtf8(payload.resolved.newName, 'New group name', 32),
      sizedUtf8(payload.resolved.description, 'Group description', 128),
      new Uint8Array([payload.resolved.isOpen ? 1 : 0]),
      new Uint8Array([HOME_V2_APPROVAL_THRESHOLDS[payload.resolved.approvalThreshold]]),
      int32Bytes(payload.resolved.minimumBlockDelay, 'Minimum block delay'),
      int32Bytes(payload.resolved.maximumBlockDelay, 'Maximum block delay'),
    )
  }
  if (payload.action === 'GROUP_APPROVAL') {
    return concatBytes(
      exactBytes(payload.pendingSignature, 64, 'Pending transaction signature'),
      new Uint8Array([payload.approval ? 1 : 0]),
    )
  }
  if (payload.action === 'SET_GROUP') {
    return int32Bytes(payload.defaultGroupId, 'Default group ID')
  }
  if (payload.avatar === null) {
    return concatBytes(int32Bytes(payload.groupId, 'Group ID'), new Uint8Array([0]))
  }
  return concatBytes(
    int32Bytes(payload.groupId, 'Group ID'),
    new Uint8Array([1]),
    int32Bytes(payload.avatar.serviceId, 'Avatar service'),
    sizedUtf8(payload.avatar.name, 'Avatar name', 40),
    sizedUtf8(payload.avatar.identifier, 'Avatar identifier', 64),
  )
}

export function buildUnsignedQortiumGroupMutationTransactionBytes(input: {
  readonly payload: HomeV2GroupMutationWirePayload
  readonly senderPublicKey: string | Uint8Array
  readonly timestamp: number
}) {
  return concatBytes(
    int32Bytes(MUTATION_TYPES[input.payload.action], 'Transaction type'),
    int64Bytes(BigInt(input.timestamp), 'Timestamp'),
    int32Bytes(0, 'Transaction group ID'),
    exactBytes(input.senderPublicKey, 32, 'Sender public key'),
    int32Bytes(0, 'MemoryPoW nonce'),
    mutationBody(input.payload),
    int64Bytes(0n, 'Transaction fee'),
  )
}

export function assertUnsignedHomeV2GroupMutationTransaction(
  bytes: Uint8Array,
  expected: {
    readonly nonce?: number
    readonly payload: HomeV2GroupMutationWirePayload
    readonly senderPublicKey: string | Uint8Array
    readonly timestamp: number
  },
) {
  const label = `qortium ${expected.payload.action} transaction`
  const reader = new ByteReader(bytes)
  if (reader.int32('Transaction type') !== MUTATION_TYPES[expected.payload.action]) {
    throw new Error(`${label} changed the approved transaction type.`)
  }
  if (reader.int64('Timestamp') !== BigInt(expected.timestamp)) throw new Error(`${label} changed the approved timestamp.`)
  if (reader.int32('Transaction group ID') !== 0) throw new Error(`${label} changed the approved transaction group.`)
  const publicKey = exactBytes(expected.senderPublicKey, 32, 'Sender public key')
  if (!equalBytes(reader.exact(32, 'Sender public key'), publicKey)) {
    throw new Error(`${label} changed the approved sender.`)
  }
  const actualNonce = reader.int32('MemoryPoW nonce') >>> 0
  const expectedNonce = expected.nonce ?? 0
  if (!Number.isInteger(expectedNonce) || expectedNonce < 0 || expectedNonce > 0xffff_ffff || actualNonce !== expectedNonce) {
    throw new Error(`${label} changed the MemoryPoW nonce.`)
  }
  // INDEPENDENT field-by-field reading — deliberately NOT a comparison
  // against mutationBody()'s re-serialization, which would let one shared
  // builder/verifier bug pass both sides (security review 2026-08-26).
  const payload = expected.payload
  const fail = (field: string) => new Error(`${label} changed the approved ${field}.`)
  const readBoolean = (field: string) => {
    const value = reader.exact(1, field)[0]
    if (value !== 0 && value !== 1) throw new Error(`${label} carried an invalid ${field} byte.`)
    return value === 1
  }
  if (payload.action === 'CREATE_GROUP' || payload.action === 'UPDATE_GROUP') {
    const resolved = payload.action === 'CREATE_GROUP'
      ? {
          approvalThreshold: payload.request.approvalThreshold,
          description: payload.request.description,
          isOpen: payload.request.isOpen,
          maximumBlockDelay: payload.request.maximumBlockDelay,
          minimumBlockDelay: payload.request.minimumBlockDelay,
          name: payload.request.groupName,
        }
      : {
          approvalThreshold: payload.resolved.approvalThreshold,
          description: payload.resolved.description,
          isOpen: payload.resolved.isOpen,
          maximumBlockDelay: payload.resolved.maximumBlockDelay,
          minimumBlockDelay: payload.resolved.minimumBlockDelay,
          name: payload.resolved.newName,
        }
    if (payload.action === 'UPDATE_GROUP' && reader.int32('Group ID') !== payload.groupId) throw fail('group')
    if (reader.sizedUtf8('Group name', 32) !== resolved.name) throw fail('group name')
    if (reader.sizedUtf8('Group description', 128) !== resolved.description) throw fail('group description')
    if (readBoolean('open flag') !== resolved.isOpen) throw fail('membership openness')
    const threshold = reader.exact(1, 'approval threshold')[0]
    if (threshold !== HOME_V2_APPROVAL_THRESHOLDS[resolved.approvalThreshold]) throw fail('approval threshold')
    if (reader.int32('Minimum block delay') !== resolved.minimumBlockDelay) throw fail('minimum block delay')
    if (reader.int32('Maximum block delay') !== resolved.maximumBlockDelay) throw fail('maximum block delay')
  } else if (payload.action === 'GROUP_APPROVAL') {
    if (!equalBytes(reader.exact(64, 'Pending transaction signature'), exactBytes(payload.pendingSignature, 64, 'Pending transaction signature'))) {
      throw fail('pending transaction signature')
    }
    if (readBoolean('approval decision') !== payload.approval) throw fail('approval decision')
  } else if (payload.action === 'SET_GROUP') {
    if (reader.int32('Default group ID') !== payload.defaultGroupId) throw fail('default group')
  } else {
    if (reader.int32('Group ID') !== payload.groupId) throw fail('group')
    const present = readBoolean('avatar presence flag')
    if (present !== (payload.avatar !== null)) throw fail('avatar presence')
    if (payload.avatar !== null) {
      if (reader.int32('Avatar service') !== payload.avatar.serviceId) throw fail('avatar service')
      if (reader.sizedUtf8('Avatar name', 40) !== payload.avatar.name) throw fail('avatar name')
      if (reader.sizedUtf8('Avatar identifier', 64) !== payload.avatar.identifier) throw fail('avatar identifier')
    }
  }
  if (reader.int64('Transaction fee') !== 0n) throw new Error(`${label} changed the approved fee.`)
  reader.done(label)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export type HomeV2GroupMetadata = {
  readonly approvalThreshold: string
  readonly avatar: { readonly identifier: string; readonly name: string; readonly service: string } | null
  readonly description: string
  readonly groupId: number
  readonly groupName: string
  readonly isOpen: boolean
  readonly maximumBlockDelay: number
  readonly minimumBlockDelay: number
  readonly owner: string
}

/**
 * The subject group as the mutation prompts and revalidation need it,
 * selected from Core's GET /groups/{groupId} answer. The avatar pointer
 * rides along on the same read.
 */
export function selectHomeV2GroupMetadata(value: unknown, groupId: number): HomeV2GroupMetadata {
  if (
    !isRecord(value) ||
    typeof value.groupName !== 'string' ||
    typeof value.owner !== 'string' ||
    typeof value.description !== 'string' ||
    typeof value.isOpen !== 'boolean' ||
    typeof value.approvalThreshold !== 'string' ||
    !Number.isInteger(value.minimumBlockDelay) ||
    !Number.isInteger(value.maximumBlockDelay)
  ) {
    throw new Error('The group lookup answered with an unrecognized shape.')
  }
  if (value.groupId !== groupId) {
    throw new Error('The group lookup answered about a different group.')
  }
  if (!(value.approvalThreshold in HOME_V2_APPROVAL_THRESHOLDS)) {
    throw new Error('The group lookup returned an unrecognized approval threshold.')
  }
  // Only ABSENCE or an explicit null means "no avatar". A malformed non-null
  // pointer used to collapse to null here, which let a hostile node turn a
  // real "clear the avatar" request into a changed:false no-op — no prompt, no
  // signature, and the avatar still set (group family review, 2026-08-27).
  const avatarRaw = value.avatar
  const avatarAbsent = avatarRaw === undefined || avatarRaw === null
  const avatar = avatarAbsent
    ? null
    : isRecord(avatarRaw) &&
      typeof avatarRaw.service === 'string' && avatarRaw.service &&
      typeof avatarRaw.name === 'string' && avatarRaw.name
      ? Object.freeze({
          identifier: typeof avatarRaw.identifier === 'string' ? avatarRaw.identifier : '',
          name: avatarRaw.name,
          service: avatarRaw.service.toUpperCase(),
        })
      : (() => { throw new Error('The group lookup returned an unrecognized avatar pointer.') })()
  return Object.freeze({
    approvalThreshold: value.approvalThreshold,
    avatar,
    description: value.description,
    groupId,
    groupName: value.groupName,
    isOpen: value.isOpen,
    maximumBlockDelay: value.maximumBlockDelay as number,
    minimumBlockDelay: value.minimumBlockDelay as number,
    owner: value.owner,
  })
}

export type HomeV2PendingTransactionSummary = {
  readonly approvalStatus: string
  readonly creatorAddress: string
  readonly signature: string
  readonly txGroupId: number
  readonly type: string
}

/**
 * The pending transaction a GROUP_APPROVAL votes on, selected from Core's
 * GET /transactions/signature/{signature} answer. The caller requires
 * approvalStatus PENDING and derives the approval group from txGroupId —
 * an app-supplied groupId is only ever an assertion against this.
 */
export function selectHomeV2PendingTransactionSummary(value: unknown, signature: string): HomeV2PendingTransactionSummary {
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    typeof value.signature !== 'string' ||
    !Number.isInteger(value.txGroupId)
  ) {
    throw new Error('The pending-transaction lookup answered with an unrecognized shape.')
  }
  if (value.signature !== signature) {
    throw new Error('The pending-transaction lookup answered about a different transaction.')
  }
  // Shown on the vote prompt: only an address-SHAPED value renders; a lying
  // node's arbitrary text is dropped rather than painted into the dialog.
  const creatorRaw = typeof value.creatorAddress === 'string' ? value.creatorAddress.trim() : ''
  const creatorAddress = /^Q[1-9A-HJ-NP-Za-km-z]{20,40}$/.test(creatorRaw) ? creatorRaw : ''
  return Object.freeze({
    approvalStatus: typeof value.approvalStatus === 'string' ? value.approvalStatus : '',
    creatorAddress,
    signature,
    txGroupId: value.txGroupId as number,
    type: value.type,
  })
}

/** True when the validation answer says ADDRESS is a member of the group. */
export function selectHomeV2GroupMembership(value: unknown, address: string): boolean {
  if (!Array.isArray(value)) throw new Error('The membership lookup answered with an unrecognized shape.')
  for (const entry of value) {
    if (isRecord(entry) && entry.address === address) return entry.isMember === true
  }
  throw new Error('The membership lookup did not answer for the requested address.')
}

/** The account's current default group id from GET /addresses/{address}. */
/**
 * Whether the account belongs to `groupId`, answered from Core's
 * GET /groups/member/{address} list.
 *
 * The desktop bridge asks POST /groups/members/{groupId}/validate instead.
 * Android's app-facing node fetch is GET/HEAD only, so it asks the same
 * question from the other direction: the groups this account is in. Both
 * callers FAIL CLOSED — an unrecognized answer throws rather than being read
 * as "not a member" or, worse, as "member" — because a default group the
 * account has not joined is rejected by Core only AFTER signing, which would
 * journal a phantom unknown outcome.
 */
export function selectHomeV2GroupMembershipFromGroups(value: unknown, groupId: number): boolean {
  if (!Array.isArray(value)) {
    throw new Error('The group membership lookup answered with an unrecognized shape.')
  }
  // Core answers this route with GroupData records. A bare {"groupId": n} is
  // NOT one, and accepting it would let a node manufacture membership for an
  // account that has not joined — Home would then prompt and sign a SET_GROUP
  // that Core rejects only after a signature exists (group family review,
  // 2026-08-27). Every entry must be a plausible record, and the matching one
  // must carry the fields a real group record has.
  let member = false
  for (const entry of value) {
    if (!isRecord(entry) || !Number.isInteger(entry.groupId)) {
      throw new Error('The group membership lookup answered with an unrecognized shape.')
    }
    if (entry.groupId !== groupId) continue
    if (typeof entry.groupName !== 'string' || !entry.groupName || typeof entry.owner !== 'string' || !entry.owner) {
      throw new Error('The group membership lookup returned an incomplete group record.')
    }
    member = true
  }
  return member
}

/**
 * Whether the account ADMINISTERS `groupId`, from the same
 * GET /groups/member/{address} answer.
 *
 * A GROUP_APPROVAL vote from a non-admin is rejected by Core only AFTER the
 * signature exists, which journals an unknown outcome and blocks the account
 * from voting on that transaction until it is manually reconciled. Checking
 * first costs one read the caller is already making. Fails closed on an
 * unrecognized answer, like the membership check it sits beside.
 */
export function selectHomeV2GroupAdminshipFromGroups(value: unknown, groupId: number): boolean {
  if (!selectHomeV2GroupMembershipFromGroups(value, groupId)) return false
  const entry = (value as readonly unknown[]).find(
    (candidate) => isRecord(candidate) && candidate.groupId === groupId,
  )
  if (!isRecord(entry) || typeof entry.isAdmin !== 'boolean') {
    throw new Error('The group membership lookup did not say whether this account is an admin.')
  }
  return entry.isAdmin
}

export function selectHomeV2DefaultGroupId(value: unknown): number | null {
  if (!isRecord(value)) return null
  return Number.isInteger(value.defaultGroupId) ? value.defaultGroupId as number : null
}
