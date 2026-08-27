import assert from 'node:assert/strict'

import { base58Encode } from './base58.js'
import {
  assertUnsignedHomeV2SetAccountAvatarTransaction,
  buildUnsignedQortiumSetAccountAvatarTransactionBytes,
  homeV2AccountAvatarOperationLabel,
  normalizeHomeV2SetAccountAvatarRequest,
  selectHomeV2AccountAvatarPointer,
} from './home-v2-account-avatar-actions.js'

const senderKey = base58Encode(new Uint8Array(32).fill(7))
const timestamp = 1_766_100_000_000

assert.equal(homeV2AccountAvatarOperationLabel(false), 'Set your account avatar')
assert.equal(homeV2AccountAvatarOperationLabel(true), 'Remove your account avatar')

// --- normalizer ---
{
  const request = normalizeHomeV2SetAccountAvatarRequest({
    avatar: { identifier: ' pic-1 ', name: ' Alice ', service: 'thumbnail' },
  })
  assert.deepEqual(request.avatar, { identifier: 'pic-1', name: 'Alice', service: 'THUMBNAIL', serviceId: 410 })
}
// null / absent avatar clears.
assert.equal(normalizeHomeV2SetAccountAvatarRequest({ avatar: null }).avatar, null)
assert.equal(normalizeHomeV2SetAccountAvatarRequest({}).avatar, null)
// payload precedence follows the family's ?? rule: a payload OBJECT wins
// over a top-level decoy, and a payload null falls through (exactly the
// same read the journal derivation performs).
assert.equal(
  normalizeHomeV2SetAccountAvatarRequest({
    avatar: { name: 'Decoy', service: 'THUMBNAIL' },
    payload: { avatar: { name: 'Real', service: 'THUMBNAIL' } },
  }).avatar?.name,
  'Real',
)
assert.throws(() => normalizeHomeV2SetAccountAvatarRequest({ avatar: 'THUMBNAIL/Alice' }), /must be null .* or an object/)
assert.throws(() => normalizeHomeV2SetAccountAvatarRequest({ avatar: { name: 'Alice' } }), /service is required/)
assert.throws(() => normalizeHomeV2SetAccountAvatarRequest({ avatar: { service: 'THUMBNAIL' } }), /name is required/)
assert.throws(() => normalizeHomeV2SetAccountAvatarRequest({ avatar: { name: 'A'.repeat(41), service: 'THUMBNAIL' } }), /40 UTF-8/)
assert.throws(
  () => normalizeHomeV2SetAccountAvatarRequest({ avatar: { identifier: 'i'.repeat(65), name: 'Alice', service: 'THUMBNAIL' } }),
  /64 UTF-8/,
)
assert.throws(() => normalizeHomeV2SetAccountAvatarRequest({ avatar: { name: 'Alice', service: 'NOT_A_SERVICE' } }), /Unknown public QDN service/)
assert.throws(() => normalizeHomeV2SetAccountAvatarRequest({ avatar: null, fee: 1 }), /app-provided fee/)
assert.throws(() => normalizeHomeV2SetAccountAvatarRequest({ avatar: null, txGroupId: 3 }), /txGroupId must be 0/)

// --- builder → independent verifier ---
const pointer = normalizeHomeV2SetAccountAvatarRequest({
  avatar: { identifier: 'pic-1', name: 'Alice', service: 'THUMBNAIL' },
}).avatar
const setBytes = buildUnsignedQortiumSetAccountAvatarTransactionBytes({
  avatar: pointer,
  senderPublicKey: senderKey,
  timestamp,
})
// 52 prefix + 1 presence + 4 service + 4+5 name + 4+5 identifier + 8 fee.
assert.equal(setBytes.byteLength, 83)
assert.doesNotThrow(() => assertUnsignedHomeV2SetAccountAvatarTransaction(setBytes, {
  avatar: pointer,
  senderPublicKey: senderKey,
  timestamp,
}))
const clearBytes = buildUnsignedQortiumSetAccountAvatarTransactionBytes({
  avatar: null,
  senderPublicKey: senderKey,
  timestamp,
})
// 52 prefix + 1 presence + 8 fee.
assert.equal(clearBytes.byteLength, 61)
assert.doesNotThrow(() => assertUnsignedHomeV2SetAccountAvatarTransaction(clearBytes, {
  avatar: null,
  senderPublicKey: senderKey,
  timestamp,
}))
// Presence/pointer cross-checks refuse.
assert.throws(() => assertUnsignedHomeV2SetAccountAvatarTransaction(setBytes, { avatar: null, senderPublicKey: senderKey, timestamp }), /presence/)
assert.throws(() => assertUnsignedHomeV2SetAccountAvatarTransaction(clearBytes, { avatar: pointer, senderPublicKey: senderKey, timestamp }), /presence/)
// Every mutated byte refuses (both shapes).
const mutate = (bytes: Uint8Array, offset: number) => {
  const copy = Uint8Array.from(bytes)
  copy[offset] = copy[offset] === 0xff ? 0 : copy[offset] + 1
  return copy
}
for (let offset = 0; offset < setBytes.byteLength; offset += 1) {
  assert.throws(
    () => assertUnsignedHomeV2SetAccountAvatarTransaction(mutate(setBytes, offset), { avatar: pointer, senderPublicKey: senderKey, timestamp }),
    Error,
    `pointer byte ${offset} mutation must refuse`,
  )
}
for (let offset = 0; offset < clearBytes.byteLength; offset += 1) {
  assert.throws(
    () => assertUnsignedHomeV2SetAccountAvatarTransaction(mutate(clearBytes, offset), { avatar: null, senderPublicKey: senderKey, timestamp }),
    Error,
    `clear byte ${offset} mutation must refuse`,
  )
}
// Trailing bytes refuse; the stamped form verifies only with the nonce.
assert.throws(() => assertUnsignedHomeV2SetAccountAvatarTransaction(
  Uint8Array.from([...clearBytes, 0]),
  { avatar: null, senderPublicKey: senderKey, timestamp },
))
{
  const stamped = Uint8Array.from(setBytes)
  new DataView(stamped.buffer).setUint32(48, 99)
  assert.throws(() => assertUnsignedHomeV2SetAccountAvatarTransaction(stamped, { avatar: pointer, senderPublicKey: senderKey, timestamp }), /nonce/)
  assert.doesNotThrow(() => assertUnsignedHomeV2SetAccountAvatarTransaction(stamped, { avatar: pointer, nonce: 99, senderPublicKey: senderKey, timestamp }))
}

// --- selector ---
assert.deepEqual(
  selectHomeV2AccountAvatarPointer({ identifier: 'pic-1', name: 'Alice', service: 'thumbnail' }),
  { identifier: 'pic-1', name: 'Alice', service: 'THUMBNAIL' },
)
assert.deepEqual(
  selectHomeV2AccountAvatarPointer({ name: 'Alice', service: 'THUMBNAIL' }).identifier,
  '',
)
for (const bad of [null, [], {}, { name: 'Alice' }, { name: 'Alice', service: 7 }, { identifier: 5, name: 'Alice', service: 'THUMBNAIL' }]) {
  assert.throws(() => selectHomeV2AccountAvatarPointer(bad), /invalid shape/, JSON.stringify(bad))
}

console.log('Home v2 account avatar contract tests passed.')
