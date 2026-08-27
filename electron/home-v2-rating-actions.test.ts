import assert from 'node:assert/strict'

import { base58Encode } from './base58.js'
import {
  assertUnsignedHomeV2RatingTransaction,
  buildUnsignedQortiumRatingTransactionBytes,
  homeV2RatingOperationLabel,
  isHomeV2RatingAction,
  normalizeHomeV2RateAccountRequest,
  normalizeHomeV2RateResourceRequest,
  selectHomeV2AccountRatingEdge,
  selectHomeV2CurrentResourceRating,
} from './home-v2-rating-actions.js'

const targetKey = base58Encode(new Uint8Array(32).fill(9))
const senderKey = base58Encode(new Uint8Array(32).fill(5))
const timestamp = 1_766_000_000_000

// --- predicates + labels ---
assert.ok(isHomeV2RatingAction('RATE_ACCOUNT') && isHomeV2RatingAction('RATE_RESOURCE'))
assert.ok(!isHomeV2RatingAction('GET_ACCOUNT_RATING'))
assert.equal(homeV2RatingOperationLabel('RATE_ACCOUNT', false), 'Rate an account')
assert.equal(homeV2RatingOperationLabel('RATE_ACCOUNT', true), 'Remove an account rating')
assert.equal(homeV2RatingOperationLabel('RATE_RESOURCE', false), 'Rate a QDN resource')
assert.equal(homeV2RatingOperationLabel('RATE_RESOURCE', true), 'Remove a QDN resource rating')

// --- RATE_ACCOUNT normalizer ---
{
  const request = normalizeHomeV2RateAccountRequest({
    category: 'player',
    rating: '-3',
    targetPublicKey: targetKey,
  })
  assert.deepEqual(request, {
    action: 'RATE_ACCOUNT',
    category: 'PLAYER',
    categoryValue: 1,
    rating: -3,
    targetPublicKey: targetKey,
  })
}
// payload-first precedence over top-level decoys.
assert.equal(
  normalizeHomeV2RateAccountRequest({
    category: 'MANAGER',
    payload: { category: 'subject', rating: 2, targetPublicKey: targetKey },
    rating: -4,
  }).category,
  'SUBJECT',
)
assert.throws(() => normalizeHomeV2RateAccountRequest({ category: 'SUBJECT', rating: 1 }), /Target public key is required/)
assert.throws(
  () => normalizeHomeV2RateAccountRequest({ category: 'SUBJECT', rating: 1, targetPublicKey: 'not!base58' }),
  /not valid Base58/,
)
assert.throws(
  () => normalizeHomeV2RateAccountRequest({ category: 'SUBJECT', rating: 1, targetPublicKey: base58Encode(new Uint8Array(31)) }),
  /32-byte/,
)
assert.throws(() => normalizeHomeV2RateAccountRequest({ rating: 1, targetPublicKey: targetKey }), /category is required/)
assert.throws(
  () => normalizeHomeV2RateAccountRequest({ category: 'OVERLORD', rating: 1, targetPublicKey: targetKey }),
  /SUBJECT, PLAYER, TRAINER, MANAGER/,
)
for (const rating of [-5, 5, 1.5, 'x', undefined]) {
  assert.throws(
    () => normalizeHomeV2RateAccountRequest({ category: 'SUBJECT', rating, targetPublicKey: targetKey }),
    /Rating must be an integer|The rating must be an integer/,
    `rating ${String(rating)}`,
  )
}
// 0 is legal (removal).
assert.equal(normalizeHomeV2RateAccountRequest({ category: 'SUBJECT', rating: 0, targetPublicKey: targetKey }).rating, 0)
// fee/txGroupId must be 0 when present.
assert.throws(
  () => normalizeHomeV2RateAccountRequest({ category: 'SUBJECT', fee: 1, rating: 1, targetPublicKey: targetKey }),
  /does not accept an app-provided fee/,
)
assert.throws(
  () => normalizeHomeV2RateAccountRequest({ category: 'SUBJECT', rating: 1, targetPublicKey: targetKey, txGroupId: 5 }),
  /txGroupId must be 0/,
)

// --- RATE_RESOURCE normalizer ---
{
  const request = normalizeHomeV2RateResourceRequest({
    identifier: 'doc-1',
    name: 'Alice',
    rating: 7,
    service: 'document',
  })
  assert.deepEqual(request, {
    action: 'RATE_RESOURCE',
    identifier: 'doc-1',
    name: 'Alice',
    rating: 7,
    service: 'DOCUMENT',
  })
}
// ''/'default' identifiers canonicalize to null (the wire form Core signs).
for (const identifier of ['', 'default', undefined, null]) {
  assert.equal(
    normalizeHomeV2RateResourceRequest({ identifier, name: 'Alice', rating: 3, service: 'DOCUMENT' }).identifier,
    null,
    `identifier ${String(identifier)}`,
  )
}
assert.throws(
  () => normalizeHomeV2RateResourceRequest({ name: 'Alice', rating: 1, service: 'QCHAT_ATTACHMENT_PRIVATE' }),
  /Private/,
)
for (const service of ['AUTO_UPDATE_BINARY']) {
  assert.throws(
    () => normalizeHomeV2RateResourceRequest({ name: 'Alice', rating: 1, service }),
    /internal and cannot be rated|Only public/,
    service,
  )
}
assert.throws(() => normalizeHomeV2RateResourceRequest({ name: 'Al', rating: 1, service: 'DOCUMENT' }), /3 to 40 bytes/)
assert.throws(() => normalizeHomeV2RateResourceRequest({ name: 'A'.repeat(41), rating: 1, service: 'DOCUMENT' }), /3 to 40 bytes/)
assert.throws(
  () => normalizeHomeV2RateResourceRequest({ identifier: 'i'.repeat(65), name: 'Alice', rating: 1, service: 'DOCUMENT' }),
  /64 byte/,
)
for (const rating of [-1, 11]) {
  assert.throws(
    () => normalizeHomeV2RateResourceRequest({ name: 'Alice', rating, service: 'DOCUMENT' }),
    /between 1 and 10/,
  )
}
assert.equal(normalizeHomeV2RateResourceRequest({ name: 'Alice', rating: 0, service: 'DOCUMENT' }).rating, 0)
// Core's normalization rule, local subset: decomposed Unicode, zero-width
// padding, and interior control/double whitespace refuse before any prompt.
assert.throws(
  () => normalizeHomeV2RateResourceRequest({ name: 'Ame\u0301lie', rating: 5, service: 'DOCUMENT' }),
  /normalized form/,
)
assert.throws(
  () => normalizeHomeV2RateResourceRequest({ name: 'Ali\u200bce', rating: 5, service: 'DOCUMENT' }),
  /normalized form/,
)
assert.throws(
  () => normalizeHomeV2RateResourceRequest({ identifier: 'a  b', name: 'Alice', rating: 5, service: 'DOCUMENT' }),
  /normalized form/,
)
// The composed form passes.
assert.equal(normalizeHomeV2RateResourceRequest({ name: 'Am\u00e9lie', rating: 5, service: 'DOCUMENT' }).name, 'Am\u00e9lie')

// --- builder → independent verifier round-trips ---
const accountPayload = normalizeHomeV2RateAccountRequest({ category: 'TRAINER', rating: -2, targetPublicKey: targetKey })
const accountBytes = buildUnsignedQortiumRatingTransactionBytes({
  payload: accountPayload,
  senderPublicKey: senderKey,
  timestamp,
})
// RATE_ACCOUNT signing bytes are exactly 100: 52-byte prefix + 32 key + two
// i32 fields + i64 fee.
assert.equal(accountBytes.byteLength, 100)
assert.doesNotThrow(() => assertUnsignedHomeV2RatingTransaction(accountBytes, {
  payload: accountPayload,
  senderPublicKey: senderKey,
  timestamp,
}))

const resourcePayload = {
  ...normalizeHomeV2RateResourceRequest({ identifier: 'doc-1', name: 'Alice', rating: 9, service: 'DOCUMENT' }),
  serviceId: 800,
}
const resourceBytes = buildUnsignedQortiumRatingTransactionBytes({
  payload: resourcePayload,
  senderPublicKey: senderKey,
  timestamp,
})
// 52 prefix + 4 service + 4+5 name + 4+5 identifier + 4 rating + 8 fee.
assert.equal(resourceBytes.byteLength, 76 + 5 + 5)
assert.doesNotThrow(() => assertUnsignedHomeV2RatingTransaction(resourceBytes, {
  payload: resourcePayload,
  senderPublicKey: senderKey,
  timestamp,
}))
// The default identifier serializes as length 0.
const defaultIdentifierBytes = buildUnsignedQortiumRatingTransactionBytes({
  payload: { ...resourcePayload, identifier: null },
  senderPublicKey: senderKey,
  timestamp,
})
assert.equal(defaultIdentifierBytes.byteLength, 76 + 5)

// Every mutated field refuses.
const mutate = (bytes: Uint8Array, offset: number) => {
  const copy = Uint8Array.from(bytes)
  copy[offset] = copy[offset] === 0xff ? 0 : copy[offset] + 1
  return copy
}
for (let offset = 0; offset < accountBytes.byteLength; offset += 1) {
  assert.throws(
    () => assertUnsignedHomeV2RatingTransaction(mutate(accountBytes, offset), {
      payload: accountPayload,
      senderPublicKey: senderKey,
      timestamp,
    }),
    Error,
    `account byte ${offset} mutation must refuse`,
  )
}
for (let offset = 0; offset < resourceBytes.byteLength; offset += 1) {
  assert.throws(
    () => assertUnsignedHomeV2RatingTransaction(mutate(resourceBytes, offset), {
      payload: resourcePayload,
      senderPublicKey: senderKey,
      timestamp,
    }),
    Error,
    `resource byte ${offset} mutation must refuse`,
  )
}
// Trailing bytes refuse; the stamped-nonce form verifies with the nonce.
assert.throws(() => assertUnsignedHomeV2RatingTransaction(
  Uint8Array.from([...accountBytes, 0]),
  { payload: accountPayload, senderPublicKey: senderKey, timestamp },
))
{
  const stamped = Uint8Array.from(accountBytes)
  new DataView(stamped.buffer).setUint32(48, 12345)
  assert.doesNotThrow(() => assertUnsignedHomeV2RatingTransaction(stamped, {
    nonce: 12345,
    payload: accountPayload,
    senderPublicKey: senderKey,
    timestamp,
  }))
  assert.throws(() => assertUnsignedHomeV2RatingTransaction(stamped, {
    payload: accountPayload,
    senderPublicKey: senderKey,
    timestamp,
  }), /nonce/)
}

// --- selectors ---
assert.deepEqual(
  selectHomeV2AccountRatingEdge({ activeRating: 3, blocksRemaining: 0, canChangeNow: true, extra: 'x' }),
  { activeRating: 3, blocksRemaining: 0, canChangeNow: true },
)
assert.deepEqual(
  selectHomeV2AccountRatingEdge({ activeRating: null, blocksRemaining: 12, canChangeNow: false }),
  { activeRating: null, blocksRemaining: 12, canChangeNow: false },
)
for (const bad of [null, [], { canChangeNow: 'yes', blocksRemaining: 0 }, { canChangeNow: true, blocksRemaining: -1 },
  { activeRating: 0, blocksRemaining: 0, canChangeNow: true }, { activeRating: 9, blocksRemaining: 0, canChangeNow: true }]) {
  assert.throws(() => selectHomeV2AccountRatingEdge(bad), /invalid shape/, JSON.stringify(bad))
}
assert.equal(selectHomeV2CurrentResourceRating(null), null)
assert.equal(selectHomeV2CurrentResourceRating({ rating: 6 }), 6)
assert.equal(selectHomeV2CurrentResourceRating({ rating: null }), null)
assert.throws(() => selectHomeV2CurrentResourceRating({ rating: 0 }), /invalid shape/)
assert.throws(() => selectHomeV2CurrentResourceRating({ rating: 11 }), /invalid shape/)
assert.throws(() => selectHomeV2CurrentResourceRating('six'), /invalid shape/)

console.log('Home v2 rating contract tests passed.')
