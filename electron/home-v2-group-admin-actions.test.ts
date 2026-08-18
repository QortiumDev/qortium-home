import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { base58Encode } from './base58.js'
import nacl from 'tweetnacl'
import {
  assertUnsignedHomeV2GroupAdminTransaction,
  buildUnsignedQortalGroupAdminTransactionBytes,
  buildUnsignedQortiumGroupAdminTransactionBytes,
  appendHomeV2GroupAdminSignature,
  createHomeV2UnknownGroupAdminBroadcastResult,
  HOME_V2_GROUP_ADMIN_ACTIONS,
  assertHomeV2GroupAdminAuthority,
  groupAdminIdempotentResult,
  homeV2GroupAdminOperationLabel,
  hasHomeV2GroupJoinRequest,
  homeV2GroupAdminRequiredRole,
  normalizeHomeV2GroupAdminRequest,
  normalizeHomeV2GroupAdminAddresses,
  normalizeHomeV2GroupAdminTarget,
  qortalGroupAdminFeeType,
} from './home-v2-group-admin-actions.js'

const address = 'QT4zHex8JEULmBhYmKd5UhpiNA46T5wUko'
const owner = 'QfETL5P9AdWNJFazqqigXVsu6Hx4iV8EUg'
const publicKey = Uint8Array.from({ length: 32 }, (_, index) => index + 61)
const reference = Uint8Array.from({ length: 64 }, (_, index) => index + 93)
const interopPublicKey = Uint8Array.from(Buffer.from('79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664', 'hex'))
const interopPrivateKey = Uint8Array.from(Buffer.from('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f2079b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664', 'hex'))

assert.equal(HOME_V2_GROUP_ADMIN_ACTIONS.length, 8)
assert.deepEqual(normalizeHomeV2GroupAdminRequest('APPROVE_GROUP_JOIN_REQUEST', {
  groupId: '12',
  joiner: address,
}), {
  action: 'APPROVE_GROUP_JOIN_REQUEST',
  groupId: 12,
  memberAddress: address,
  reason: '',
  timeToLive: 0,
  wireAction: 'GROUP_INVITE',
})
assert.deepEqual(normalizeHomeV2GroupAdminRequest('GROUP_BAN', {
  banTime: '3600',
  groupId: 12,
  offender: address,
  reason: 'spam',
}), {
  action: 'GROUP_BAN',
  groupId: 12,
  memberAddress: address,
  reason: 'spam',
  timeToLive: 3600,
  wireAction: 'GROUP_BAN',
})
assert.equal(normalizeHomeV2GroupAdminRequest('BAN_FROM_GROUP', {
  groupId: 12,
  qortalAddress: address,
}).action, 'GROUP_BAN')
assert.equal(normalizeHomeV2GroupAdminRequest('KICK_FROM_GROUP', {
  groupId: 12,
  qortalAddress: address,
}).wireAction, 'GROUP_KICK')
assert.equal(normalizeHomeV2GroupAdminRequest('INVITE_TO_GROUP', {
  groupId: 12,
  inviteeAddress: address,
  inviteTime: 7200,
}).timeToLive, 7200)
assert.throws(
  () => normalizeHomeV2GroupAdminRequest('GROUP_KICK', { groupId: 12, member: address, reason: 'é'.repeat(65) }),
  /128 UTF-8 bytes/,
)
assert.throws(
  () => normalizeHomeV2GroupAdminRequest('INVITE_TO_GROUP', { groupId: 12, invitee: 'not-an-address' }),
  /Base58|25 bytes/,
)
assert.throws(
  () => normalizeHomeV2GroupAdminRequest('GROUP_BAN', { groupId: 12, member: address, ttl: -1 }),
  /between 0 and 2147483647/,
)

assert.deepEqual(normalizeHomeV2GroupAdminTarget({ groupId: 12, groupName: 'Builders', owner }, 12, 'qortium'), {
  groupId: 12,
  groupName: 'Builders',
  ownerAddress: owner,
})
assert.equal(homeV2GroupAdminRequiredRole('ADD_GROUP_ADMIN'), 'owner')
assert.equal(homeV2GroupAdminRequiredRole('INVITE_TO_GROUP'), 'admin')
assert.equal(homeV2GroupAdminOperationLabel('CANCEL_GROUP_BAN'), 'Cancel group ban')
assert.deepEqual(normalizeHomeV2GroupAdminAddresses({
  groupMembers: [{ member: owner }, { member: address }],
}), [owner, address])
assert.doesNotThrow(() => assertHomeV2GroupAdminAuthority({
  accountAddress: address,
  action: 'INVITE_TO_GROUP',
  adminAddresses: [address],
  target: { groupId: 12, groupName: 'Builders', ownerAddress: owner },
}))
assert.throws(() => assertHomeV2GroupAdminAuthority({
  accountAddress: address,
  action: 'GROUP_BAN',
  adminAddresses: [address],
  target: { groupId: 12, groupName: 'Builders', ownerAddress: owner },
}), /not the current group owner/)
assert.equal(groupAdminIdempotentResult('GROUP_BAN', new Error('Transaction invalid (BAN_EXISTS)')), true)
assert.equal(groupAdminIdempotentResult('GROUP_BAN', new Error('NOT_GROUP_ADMIN')), false)
assert.equal(hasHomeV2GroupJoinRequest([{ groupId: 12, joiner: address }], 12, address), true)
assert.equal(hasHomeV2GroupJoinRequest([{ groupId: 12, joiner: owner }], 12, address), false)

for (const action of HOME_V2_GROUP_ADMIN_ACTIONS) {
  const request = normalizeHomeV2GroupAdminRequest(action, {
    groupId: 12,
    memberAddress: address,
    reason: action === 'GROUP_BAN' || action === 'GROUP_KICK' ? 'reason' : undefined,
    timeToLive: action === 'GROUP_BAN' || action === 'INVITE_TO_GROUP' ? 3600 : undefined,
  })
  assert.equal(qortalGroupAdminFeeType(request), request.wireAction)
  const qortium = buildUnsignedQortiumGroupAdminTransactionBytes({
    request,
    senderPublicKey: publicKey,
    timestamp: 1_786_998_765_432,
  })
  assertUnsignedHomeV2GroupAdminTransaction(qortium, {
    feeAtomic: 0n,
    network: 'qortium',
    request,
    senderPublicKey: publicKey,
    timestamp: 1_786_998_765_432,
  })
  const qortal = buildUnsignedQortalGroupAdminTransactionBytes({
    feeAtomic: 100_000n,
    lastReference: reference,
    request,
    senderPublicKey: publicKey,
    timestamp: 1_786_998_765_432,
  })
  assertUnsignedHomeV2GroupAdminTransaction(qortal, {
    feeAtomic: 100_000n,
    lastReference: reference,
    network: 'qortal',
    request,
    senderPublicKey: publicKey,
    timestamp: 1_786_998_765_432,
  })
  assert.equal(qortal.byteLength - qortium.byteLength, 60)
}

const vectorRequest = normalizeHomeV2GroupAdminRequest('GROUP_BAN', {
  groupId: 12,
  offender: address,
  reason: 'spam',
  timeToLive: 3600,
})
const qortiumVectorBytes = buildUnsignedQortiumGroupAdminTransactionBytes({
  request: vectorRequest,
  senderPublicKey: publicKey,
  timestamp: 1_786_998_765_432,
})
assert.equal(
  Buffer.from(qortiumVectorBytes).toString('hex'),
  '0000001a000001a0116d3778000000003d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c000000000000000c3a46ec227d243ab9ab4a97cbe4142c0c68b3f806056b67bd68000000047370616d00000e100000000000000000',
)
for (const [label, malformed] of [
  ['type', (() => { const value = qortiumVectorBytes.slice(); value[3] = 29; return value })()],
  ['nonce', (() => { const value = qortiumVectorBytes.slice(); value[51] = 1; return value })()],
  ['member', (() => { const value = qortiumVectorBytes.slice(); value[56] ^= 1; return value })()],
  ['trailing', Uint8Array.from([...qortiumVectorBytes, 0])],
] as const) {
  assert.throws(() => assertUnsignedHomeV2GroupAdminTransaction(malformed, {
    feeAtomic: 0n,
    network: 'qortium',
    request: vectorRequest,
    senderPublicKey: publicKey,
    timestamp: 1_786_998_765_432,
  }), new RegExp(label === 'trailing' ? 'trailing bytes' : label, 'i'))
}
const stampedQortiumVector = qortiumVectorBytes.slice()
new DataView(
  stampedQortiumVector.buffer,
  stampedQortiumVector.byteOffset,
  stampedQortiumVector.byteLength,
).setUint32(48, 0x01020304, false)
assert.doesNotThrow(() => assertUnsignedHomeV2GroupAdminTransaction(stampedQortiumVector, {
  feeAtomic: 0n,
  network: 'qortium',
  nonce: 0x01020304,
  request: vectorRequest,
  senderPublicKey: publicKey,
  timestamp: 1_786_998_765_432,
}))
assert.throws(() => assertUnsignedHomeV2GroupAdminTransaction(stampedQortiumVector, {
  feeAtomic: 0n,
  network: 'qortium',
  nonce: 0x01020305,
  request: vectorRequest,
  senderPublicKey: publicKey,
  timestamp: 1_786_998_765_432,
}), /nonce/i)
assert.equal(
  Buffer.from(buildUnsignedQortalGroupAdminTransactionBytes({
    feeAtomic: 100_000n,
    lastReference: reference,
    request: vectorRequest,
    senderPublicKey: publicKey,
    timestamp: 1_786_998_765_432,
  })).toString('hex'),
  '0000001a000001a0116d3778000000005d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c0000000c3a46ec227d243ab9ab4a97cbe4142c0c68b3f806056b67bd68000000047370616d00000e1000000000000186a0',
)

const signedVector = appendHomeV2GroupAdminSignature(
  buildUnsignedQortalGroupAdminTransactionBytes({
    feeAtomic: 100_000n,
    lastReference: reference,
    request: vectorRequest,
    senderPublicKey: publicKey,
    timestamp: 1_786_998_765_432,
  }),
  new Uint8Array(64).fill(7),
)
assert.deepEqual(createHomeV2UnknownGroupAdminBroadcastResult({
  error: new Error('Timed out after submission.'),
  network: 'qortal',
  request: vectorRequest,
  signedBytes: signedVector,
  target: { groupId: 12, groupName: 'Builders', ownerAddress: owner },
  timestamp: 1_786_998_765_432,
}), {
  accepted: false,
  action: 'GROUP_BAN',
  error: 'Timed out after submission.',
  errorType: 'BROADCAST_OUTCOME_UNKNOWN',
  groupId: 12,
  groupName: 'Builders',
  memberAddress: address,
  network: 'qortal',
  outcome: 'unknown',
  retryable: false,
  signature: base58Encode(new Uint8Array(64).fill(7)),
  timestamp: 1_786_998_765_432,
  transactionSignature: base58Encode(new Uint8Array(64).fill(7)),
  wireAction: 'GROUP_BAN',
})

const signedInteropUnsigned = buildUnsignedQortalGroupAdminTransactionBytes({
  feeAtomic: 100_000n,
  lastReference: reference,
  request: vectorRequest,
  senderPublicKey: interopPublicKey,
  timestamp: 1_786_998_765_432,
})
assert.equal(
  Buffer.from(nacl.sign.detached(signedInteropUnsigned, interopPrivateKey)).toString('hex'),
  '0fcd9f5c6d4fe20166c2360b0f3e5c4f700ad56799c1c33f9ef86ad3e2063574b5640a28f727e054e421e46e1b0949edcc1661ccab7f081b86e824e368d6280f',
)

const desktopBridgeSource = readFileSync(new URL('../electron/home-v2-app-bridge.ts', import.meta.url), 'utf8')
const androidLiveSource = readFileSync(new URL('../src/home-v2-live/HomeV2LiveApp.tsx', import.meta.url), 'utf8')
const androidVaultSource = readFileSync(new URL('../src/platform.ts', import.meta.url), 'utf8')
for (const [label, source] of [
  ['desktop bridge', desktopBridgeSource],
  ['Android live bridge', androidLiveSource],
  ['Android vault', androidVaultSource],
] as const) {
  assert.match(source, /[sS]end(?:HomeV2)?GroupAdmin/, `${label} must route group administration through a dedicated primitive.`)
}
for (const source of [desktopBridgeSource, androidVaultSource]) {
  assert.match(source, /createHomeV2UnknownGroupAdminBroadcastResult/)
}
assert.match(desktopBridgeSource, /singleRequestOnly: true/)
assert.match(androidLiveSource, /allowedScopes: \['single-request'\]/)

console.log('Home 2 group administration action tests passed')
