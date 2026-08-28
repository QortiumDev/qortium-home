import assert from 'node:assert/strict'

import {
  assertApprovedEncryptRecipients,
  normalizeHomeV2EncryptDataRequest,
} from './home-v2-encryption-actions.js'

const ALICE = 'HbQGgWa5tQwXFdBmg1zjjcTrKaSw6UfKTeBqXtnHZLpb'
const BOB = '2M6PLpYUZ1yV9qbYAiPFEAcHnrsUMWQ1fUJUyztDBXCz'

// --- Qortal compatibility -----------------------------------------------
// The field aliases are not a style choice: real Qortal apps send `base64`,
// and an app that works on Qortal must work here unchanged.
assert.equal(normalizeHomeV2EncryptDataRequest({ base64: 'aGk=' }).data64, 'aGk=')
assert.equal(normalizeHomeV2EncryptDataRequest({ data64: 'aGk=' }).data64, 'aGk=')
assert.equal(
  normalizeHomeV2EncryptDataRequest({ base64: 'Ynll', data64: 'aGk=' }).data64,
  'aGk=',
  'data64 wins when both are sent, matching Hub',
)
// Qortal reads fields either at the top level or nested under payload.
assert.equal(normalizeHomeV2EncryptDataRequest({ payload: { data64: 'aGk=' } }).data64, 'aGk=')

// ABSENT publicKeys means "encrypt to myself only" — Qortal defaults to [] and
// appends the user's own key. This must not become an error, or every
// encrypt-to-self app breaks.
assert.deepEqual(normalizeHomeV2EncryptDataRequest({ data64: 'aGk=' }).publicKeys, [])
assert.deepEqual(normalizeHomeV2EncryptDataRequest({ data64: 'aGk=', publicKeys: [] }).publicKeys, [])
// ...but a non-array that was actually sent is a mistake worth reporting.
assert.throws(
  () => normalizeHomeV2EncryptDataRequest({ data64: 'aGk=', publicKeys: ALICE }),
  /publicKeys must be an array/,
)

// --- The sender is NOT added here ---------------------------------------
// The envelope appends it. Adding it here too would make the prompt disclose a
// recipient the app never asked for.
assert.deepEqual(
  normalizeHomeV2EncryptDataRequest({ data64: 'aGk=', publicKeys: [ALICE] }).publicKeys,
  [ALICE],
  'the normalized list is exactly what the app asked for',
)

// --- Recipients are canonical and de-duplicated -------------------------
assert.deepEqual(
  normalizeHomeV2EncryptDataRequest({ data64: 'aGk=', publicKeys: [ALICE, BOB, ALICE] }).publicKeys,
  [ALICE, BOB],
  'a repeated recipient is disclosed once, in request order',
)
assert.deepEqual(
  normalizeHomeV2EncryptDataRequest({ data64: 'aGk=', publicKeys: [` ${ALICE} `] }).publicKeys,
  [ALICE],
  'surrounding whitespace is not a different recipient',
)
for (const bad of ['', '   ', 'not base58!!', ALICE.slice(0, 20), 42, null, {}]) {
  assert.throws(
    () => normalizeHomeV2EncryptDataRequest({ data64: 'aGk=', publicKeys: [bad] }),
    /Recipient public key 1/,
    `rejects ${JSON.stringify(bad)}`,
  )
}
// A key that decodes but does not round-trip is a non-canonical spelling: two
// different texts naming one recipient would make the prompt ambiguous.
assert.throws(
  () => normalizeHomeV2EncryptDataRequest({ data64: 'aGk=', publicKeys: [`1${ALICE}`] }),
  /exact 32-byte Base58 key/,
)
assert.throws(
  () => normalizeHomeV2EncryptDataRequest({
    data64: 'aGk=',
    publicKeys: Array.from({ length: 257 }, () => ALICE),
  }),
  /at most 256 recipient/,
  'the recipient cap is checked before any key is decoded',
)

// --- The blob form is refused BY NAME -----------------------------------
// The bridge is structured-clone only, so a File arrives as an empty object.
// Encrypting that would produce a perfectly valid envelope over no data.
for (const field of ['file', 'blob']) {
  assert.throws(
    () => normalizeHomeV2EncryptDataRequest({ [field]: {}, data64: 'aGk=' }),
    new RegExp(`does not accept a ${field}`),
    `${field} is refused even when data64 is also present`,
  )
}

// --- Missing data refuses rather than encrypting nothing ----------------
for (const request of [{}, { data64: '' }, { data64: null }, { data64: 42 }]) {
  assert.throws(
    () => normalizeHomeV2EncryptDataRequest(request as Record<string, unknown>),
    /requires the data to encrypt/,
  )
}

// The result is frozen: a later handler cannot mutate what the prompt showed.
const normalized = normalizeHomeV2EncryptDataRequest({ data64: 'aGk=', publicKeys: [ALICE] })
assert.equal(Object.isFrozen(normalized), true)
assert.equal(Object.isFrozen(normalized.publicKeys), true)

// --- The approved-state binding -----------------------------------------
// On Android the shell describes and the VAULT encrypts. This is what stops an
// app having one recipient set approved and a different one encrypted to.
assertApprovedEncryptRecipients([ALICE, BOB], [ALICE, BOB])
assertApprovedEncryptRecipients([], [])
assert.throws(
  () => assertApprovedEncryptRecipients([ALICE, BOB], [ALICE]),
  /recipients changed after approval/,
  'an added recipient is refused',
)
assert.throws(
  () => assertApprovedEncryptRecipients([ALICE], [ALICE, BOB]),
  /recipients changed after approval/,
  'a dropped recipient is refused',
)
assert.throws(
  () => assertApprovedEncryptRecipients([BOB], [ALICE]),
  /recipients changed after approval/,
  'a substituted recipient is refused',
)
// Order is part of the contract: the prompt numbers its rows, so reordering
// would make the approved rows describe different keys than those used.
assert.throws(
  () => assertApprovedEncryptRecipients([BOB, ALICE], [ALICE, BOB]),
  /recipients changed after approval/,
  'reordering is refused even though the membership matches',
)
assert.throws(
  () => assertApprovedEncryptRecipients([ALICE], []),
  /recipients changed after approval/,
  'encrypting to someone when none were approved is refused',
)

console.log('Home 2 encryption action tests passed.')
