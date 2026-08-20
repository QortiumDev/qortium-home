import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import nacl from 'tweetnacl'
import { base58Encode } from './base58.js'
import {
  appendHomeV2GroupMembershipSignature,
  buildUnsignedQortalGroupMembershipTransactionBytes,
  createHomeV2GroupMembershipSuccess,
  createHomeV2UnknownGroupMembershipBroadcastResult,
  groupMembershipIdempotentState,
  normalizeHomeV2GroupMembershipRequest,
  normalizeHomeV2GroupMembershipTarget,
  normalizeQortalGroupMembershipFee,
  qortalGroupMembershipFeeType,
} from './home-v2-group-actions.js'

const fixture = JSON.parse(readFileSync(
  new URL('../scripts/fixtures/qortal-chat-interop-v1.json', import.meta.url),
  'utf8',
)) as {
  accounts: { alice: { privateKey: string; publicKey: string } }
  common: { groupId: number; lastReference: string; timestamp: number }
  groupTransactions: {
    join: { signature: string; signed: string; unsigned: string }
    leave: { signature: string; signed: string; unsigned: string }
  }
}

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'))

for (const [action, fixtureKey] of [
  ['JOIN_GROUP', 'join'],
  ['LEAVE_GROUP', 'leave'],
] as const) {
  const unsigned = buildUnsignedQortalGroupMembershipTransactionBytes({
      action,
      feeAtomic: 100_000n,
      groupId: fixture.common.groupId,
      lastReference: bytes(fixture.common.lastReference),
      senderPublicKey: bytes(fixture.accounts.alice.publicKey),
      timestamp: fixture.common.timestamp,
    })
  assert.deepEqual(unsigned, bytes(fixture.groupTransactions[fixtureKey].unsigned))
  const signature = nacl.sign.detached(unsigned, bytes(fixture.accounts.alice.privateKey))
  assert.deepEqual(signature, bytes(fixture.groupTransactions[fixtureKey].signature))
  assert.deepEqual(
    appendHomeV2GroupMembershipSignature(unsigned, signature),
    bytes(fixture.groupTransactions[fixtureKey].signed),
  )
}

assert.deepEqual(normalizeHomeV2GroupMembershipRequest('JOIN_GROUP', { groupId: '12' }), {
  action: 'JOIN_GROUP',
  groupId: 12,
})
for (const groupId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1.0', '']) {
  assert.throws(
    () => normalizeHomeV2GroupMembershipRequest('LEAVE_GROUP', { groupId }),
    /positive safe integer/,
  )
}

assert.deepEqual(normalizeHomeV2GroupMembershipTarget({
  groupId: '12',
  groupName: ' Test group ',
  isMintingGroup: true,
  isOpen: false,
}, 12, 'qortium'), {
  groupId: 12,
  groupName: 'Test group',
  isMintingGroup: true,
  isOpen: false,
})
assert.throws(
  () => normalizeHomeV2GroupMembershipTarget({ groupId: 13 }, 12, 'qortal'),
  /could not verify/,
)

assert.equal(normalizeQortalGroupMembershipFee('100000'), 100_000n)
assert.equal(qortalGroupMembershipFeeType('JOIN_GROUP'), 'JOIN_GROUP')
assert.equal(qortalGroupMembershipFeeType('LEAVE_GROUP'), 'LEAVE_GROUP')
assert.equal(groupMembershipIdempotentState('JOIN_GROUP', new Error('Transaction invalid (ALREADY_GROUP_MEMBER)')), 'joined')
assert.equal(groupMembershipIdempotentState('JOIN_GROUP', new Error('Transaction invalid (JOIN_REQUEST_EXISTS)')), 'requested')
assert.equal(groupMembershipIdempotentState('LEAVE_GROUP', 'NOT_GROUP_MEMBER'), 'left')
assert.equal(groupMembershipIdempotentState('JOIN_GROUP', 'NOT_GROUP_MEMBER'), null)

assert.deepEqual(createHomeV2GroupMembershipSuccess({
  action: 'JOIN_GROUP',
  changed: false,
  groupId: 12,
  groupName: 'Test group',
  network: 'qortal',
}), {
  accepted: true,
  action: 'JOIN_GROUP',
  changed: false,
  groupId: 12,
  groupName: 'Test group',
  membership: 'joined',
  network: 'qortal',
})

assert.deepEqual(createHomeV2UnknownGroupMembershipBroadcastResult({
  action: 'LEAVE_GROUP',
  error: new Error('The node response timed out.'),
  groupId: fixture.common.groupId,
  groupName: 'Test group',
  network: 'qortal',
  signedBytes: bytes(fixture.groupTransactions.leave.signed),
  timestamp: fixture.common.timestamp,
}), {
  accepted: false,
  action: 'LEAVE_GROUP',
  error: 'The node response timed out.',
  errorType: 'BROADCAST_OUTCOME_UNKNOWN',
  groupId: fixture.common.groupId,
  groupName: 'Test group',
  network: 'qortal',
  outcome: 'unknown',
  retryable: false,
  signature: base58Encode(bytes(fixture.groupTransactions.leave.signature)),
  timestamp: fixture.common.timestamp,
  transactionSignature: base58Encode(bytes(fixture.groupTransactions.leave.signature)),
})

console.log('Home v2 group action tests passed')
