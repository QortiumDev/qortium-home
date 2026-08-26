import assert from 'node:assert/strict'
import {
  assertUnsignedHomeV2GroupMutationTransaction,
  buildUnsignedQortiumGroupMutationTransactionBytes,
  homeV2GroupMutationOperationLabel,
  isHomeV2GroupMutationAction,
  normalizeHomeV2CreateGroupRequest,
  normalizeHomeV2GroupApprovalRequest,
  normalizeHomeV2SetGroupAvatarRequest,
  normalizeHomeV2SetGroupRequest,
  normalizeHomeV2UpdateGroupRequest,
  selectHomeV2DefaultGroupId,
  selectHomeV2GroupMembership,
  selectHomeV2GroupMetadata,
  selectHomeV2PendingTransactionSummary,
  type HomeV2GroupMutationWirePayload,
} from './home-v2-group-mutation-actions.js'
import { base58Encode } from './base58.js'

const SIGNATURE_58 = base58Encode(Uint8Array.from({ length: 64 }, (_, index) => (index + 3) & 0xff))
const PUBLIC_KEY = Uint8Array.from({ length: 32 }, (_, index) => (index + 1) & 0xff)
const TIMESTAMP = 1_720_000_000_123

// ---- catalogue predicate + captions ----
for (const action of ['CREATE_GROUP', 'UPDATE_GROUP', 'GROUP_APPROVAL', 'SET_GROUP', 'SET_GROUP_AVATAR'] as const) {
  assert.equal(isHomeV2GroupMutationAction(action), true)
}
assert.equal(isHomeV2GroupMutationAction('JOIN_GROUP'), false)
assert.equal(homeV2GroupMutationOperationLabel('GROUP_APPROVAL', false), 'Approve a pending group transaction')
assert.equal(homeV2GroupMutationOperationLabel('GROUP_APPROVAL', true), 'Oppose a pending group transaction')

// ---- CREATE_GROUP normalizer ----
{
  const created = normalizeHomeV2CreateGroupRequest({
    description: ' A place ', groupName: ' droids ', open: true,
  })
  assert.deepEqual(created, {
    approvalThreshold: 'NONE', description: 'A place', groupName: 'droids',
    isOpen: true, maximumBlockDelay: 10, minimumBlockDelay: 5,
  })
  // payload-first precedence, as in every restored family.
  assert.equal(
    normalizeHomeV2CreateGroupRequest({ description: 'd', groupName: 'outer', payload: { groupName: 'inner' } }).groupName,
    'inner',
  )
}
for (const bad of [
  { description: 'd' },                                   // missing name
  { description: 'd', groupName: 'ab' },                  // < 3 bytes
  { description: 'd', groupName: 'x'.repeat(33) },        // > 32 bytes
  { groupName: 'droids' },                                // Core requires a description
  { description: 'y'.repeat(129), groupName: 'droids' },
  { approvalThreshold: 'PCT50', description: 'd', groupName: 'droids' }, // not an enum value
  { description: 'd', groupName: 'droids', isOpen: 'true' },             // strict boolean
  { description: 'd', groupName: 'droids', maximumBlockDelay: 3, minimumBlockDelay: 8 },
  { description: 'd', fee: 1, groupName: 'droids' },
  { description: 'd', groupName: 'droids', txGroupId: 3 },
  { description: 'd', groupName: 'A  B!' },               // repeated whitespace
]) {
  assert.throws(() => normalizeHomeV2CreateGroupRequest(bad))
}

// ---- UPDATE_GROUP normalizer ----
{
  const updated = normalizeHomeV2UpdateGroupRequest({ groupId: '7', isOpen: false, newName: '' })
  assert.deepEqual(updated, { groupId: 7, newIsOpen: false, newName: '' })
  assert.equal(normalizeHomeV2UpdateGroupRequest({ groupId: 7 }).newDescription, undefined)
  assert.equal(normalizeHomeV2UpdateGroupRequest({ description: 'x', groupId: 7 }).newDescription, 'x')
}
assert.throws(() => normalizeHomeV2UpdateGroupRequest({ groupId: 0 }))
assert.throws(() => normalizeHomeV2UpdateGroupRequest({ groupId: 7, newName: 'ab' }))

// ---- GROUP_APPROVAL normalizer ----
{
  const vote = normalizeHomeV2GroupApprovalRequest({ approval: true, pendingSignature: ` ${SIGNATURE_58} ` })
  assert.deepEqual(vote, { approval: true, pendingSignature: SIGNATURE_58 })
  assert.equal(
    normalizeHomeV2GroupApprovalRequest({ approval: false, groupId: 9, pendingSignature: SIGNATURE_58 }).assertedGroupId,
    9,
  )
}
for (const bad of [
  { approval: true },                                     // missing signature
  { approval: true, pendingSignature: 'not-base58!' },
  { approval: true, pendingSignature: base58Encode(new Uint8Array(32)) }, // wrong length
  { pendingSignature: SIGNATURE_58 },                     // missing approval
  { approval: 'yes', pendingSignature: SIGNATURE_58 },    // strict boolean
  { approval: true, fee: 1, pendingSignature: SIGNATURE_58 },
]) {
  assert.throws(() => normalizeHomeV2GroupApprovalRequest(bad))
}

// ---- SET_GROUP normalizer ----
assert.deepEqual(normalizeHomeV2SetGroupRequest({ defaultGroupId: 5 }), { defaultGroupId: 5 })
assert.deepEqual(normalizeHomeV2SetGroupRequest({ groupId: '5' }), { defaultGroupId: 5 })
// 1.x accepted 0; current Core rejects it (no group 0).
assert.throws(() => normalizeHomeV2SetGroupRequest({ defaultGroupId: 0 }))

// ---- SET_GROUP_AVATAR normalizer ----
{
  const cleared = normalizeHomeV2SetGroupAvatarRequest({ avatar: null, groupId: 5 })
  assert.deepEqual(cleared, { avatar: null, groupId: 5 })
  const set = normalizeHomeV2SetGroupAvatarRequest({
    avatar: { identifier: 'group-avatar', name: 'Alice', service: 'thumbnail' }, groupId: 5,
  })
  assert.deepEqual(set.avatar, { identifier: 'group-avatar', name: 'Alice', service: 'THUMBNAIL', serviceId: 410 })
}
for (const bad of [
  { avatar: { name: 'Alice', service: 'NOT_A_SERVICE' }, groupId: 5 },
  { avatar: { service: 'THUMBNAIL' }, groupId: 5 },        // missing name
  { avatar: { name: 'x'.repeat(41), service: 'THUMBNAIL' }, groupId: 5 },
  { avatar: { identifier: 'y'.repeat(65), name: 'Alice', service: 'THUMBNAIL' }, groupId: 5 },
  { avatar: 'clear', groupId: 5 },
]) {
  assert.throws(() => normalizeHomeV2SetGroupAvatarRequest(bad))
}

// ---- wire build + verify, all five types ----
function roundTrip(payload: HomeV2GroupMutationWirePayload) {
  const bytes = buildUnsignedQortiumGroupMutationTransactionBytes({
    payload, senderPublicKey: PUBLIC_KEY, timestamp: TIMESTAMP,
  })
  assert.doesNotThrow(() => assertUnsignedHomeV2GroupMutationTransaction(bytes, {
    payload, senderPublicKey: PUBLIC_KEY, timestamp: TIMESTAMP,
  }))
  return bytes
}

const createPayload: HomeV2GroupMutationWirePayload = {
  action: 'CREATE_GROUP',
  request: {
    approvalThreshold: 'PCT40', description: 'A place', groupName: 'droids',
    isOpen: true, maximumBlockDelay: 12, minimumBlockDelay: 4,
  },
}
const createBytes = roundTrip(createPayload)
// Wire arithmetic from the audit: 78 + nameBytes + descriptionBytes unsigned.
assert.equal(createBytes.byteLength, 78 + 6 + 7)
// Type binding: the same body under another type id fails.
assert.throws(() => assertUnsignedHomeV2GroupMutationTransaction(createBytes, {
  payload: { ...createPayload, action: 'UPDATE_GROUP' } as never, senderPublicKey: PUBLIC_KEY, timestamp: TIMESTAMP,
}))
// Field binding: a changed threshold fails.
assert.throws(() => assertUnsignedHomeV2GroupMutationTransaction(createBytes, {
  payload: { action: 'CREATE_GROUP', request: { ...createPayload.request, approvalThreshold: 'PCT60' } },
  senderPublicKey: PUBLIC_KEY, timestamp: TIMESTAMP,
}))
// Trailing bytes fail.
assert.throws(() => assertUnsignedHomeV2GroupMutationTransaction(
  Uint8Array.from([...createBytes, 0]),
  { payload: createPayload, senderPublicKey: PUBLIC_KEY, timestamp: TIMESTAMP },
))

const updatePayload: HomeV2GroupMutationWirePayload = {
  action: 'UPDATE_GROUP',
  groupId: 7,
  resolved: {
    approvalThreshold: 'ONE', description: 'Renamed place', isOpen: false,
    maximumBlockDelay: 10, minimumBlockDelay: 5, newName: '',
  },
}
const updateBytes = roundTrip(updatePayload)
assert.equal(updateBytes.byteLength, 82 + 0 + 13)

const approvalPayload: HomeV2GroupMutationWirePayload = {
  action: 'GROUP_APPROVAL', approval: false, pendingSignature: SIGNATURE_58,
}
const approvalBytes = roundTrip(approvalPayload)
assert.equal(approvalBytes.byteLength, 125)
assert.throws(() => assertUnsignedHomeV2GroupMutationTransaction(approvalBytes, {
  payload: { ...approvalPayload, approval: true }, senderPublicKey: PUBLIC_KEY, timestamp: TIMESTAMP,
}))

const setGroupBytes = roundTrip({ action: 'SET_GROUP', defaultGroupId: 5 })
assert.equal(setGroupBytes.byteLength, 64)

const clearAvatarBytes = roundTrip({ action: 'SET_GROUP_AVATAR', avatar: null, groupId: 5 })
assert.equal(clearAvatarBytes.byteLength, 65)
const setAvatarBytes = roundTrip({
  action: 'SET_GROUP_AVATAR',
  avatar: { identifier: 'group-avatar', name: 'Alice', service: 'THUMBNAIL', serviceId: 410 },
  groupId: 5,
})
assert.equal(setAvatarBytes.byteLength, 77 + 5 + 12)
// A set-pointer body must not verify against an approved CLEAR.
assert.throws(() => assertUnsignedHomeV2GroupMutationTransaction(setAvatarBytes, {
  payload: { action: 'SET_GROUP_AVATAR', avatar: null, groupId: 5 }, senderPublicKey: PUBLIC_KEY, timestamp: TIMESTAMP,
}))

// Nonce binding: stamped bytes verify only with the exact nonce.
{
  const stamped = new Uint8Array(setGroupBytes)
  new DataView(stamped.buffer).setUint32(48, 1234, false)
  assert.throws(() => assertUnsignedHomeV2GroupMutationTransaction(stamped, {
    payload: { action: 'SET_GROUP', defaultGroupId: 5 }, senderPublicKey: PUBLIC_KEY, timestamp: TIMESTAMP,
  }))
  assert.doesNotThrow(() => assertUnsignedHomeV2GroupMutationTransaction(stamped, {
    nonce: 1234, payload: { action: 'SET_GROUP', defaultGroupId: 5 }, senderPublicKey: PUBLIC_KEY, timestamp: TIMESTAMP,
  }))
}

// ---- live-state selectors ----
{
  const meta = selectHomeV2GroupMetadata({
    approvalThreshold: 'PCT20', avatar: { identifier: '', name: 'Alice', service: 'thumbnail' },
    description: 'd', groupId: 7, groupName: 'droids', isOpen: true,
    maximumBlockDelay: 10, minimumBlockDelay: 5, owner: `Q${'a'.repeat(25)}`,
  }, 7)
  assert.equal(meta.groupName, 'droids')
  assert.deepEqual(meta.avatar, { identifier: '', name: 'Alice', service: 'THUMBNAIL' })
  assert.throws(() => selectHomeV2GroupMetadata({ groupId: 8 }, 7))
}
{
  const pending = selectHomeV2PendingTransactionSummary({
    approvalStatus: 'PENDING', creatorAddress: `Q${'b'.repeat(25)}`, signature: SIGNATURE_58,
    txGroupId: 7, type: 'UPDATE_GROUP',
  }, SIGNATURE_58)
  assert.equal(pending.approvalStatus, 'PENDING')
  assert.equal(pending.txGroupId, 7)
  // An answer about a different transaction is refused, not relabeled.
  assert.throws(() => selectHomeV2PendingTransactionSummary({ signature: 'other', txGroupId: 7, type: 'X' }, SIGNATURE_58))
}
assert.equal(selectHomeV2GroupMembership([{ address: 'Qx', isMember: true }], 'Qx'), true)
assert.equal(selectHomeV2GroupMembership([{ address: 'Qx', isMember: false }], 'Qx'), false)
assert.throws(() => selectHomeV2GroupMembership([{ address: 'Qy', isMember: true }], 'Qx'))
assert.equal(selectHomeV2DefaultGroupId({ defaultGroupId: 3 }), 3)
assert.equal(selectHomeV2DefaultGroupId({}), null)

console.log('Home v2 group mutation contract tests passed.')
