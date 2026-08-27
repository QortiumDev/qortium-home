import assert from 'node:assert/strict'

import { unwrapAndroidNodeRecord } from './android-node-envelope'

assert.deepEqual(
  unwrapAndroidNodeRecord({ body: '{}', data: { name: 'alice', owner: 'Q1' }, ok: true, status: 200 }, 'missing'),
  { name: 'alice', owner: 'Q1' },
  'a successful envelope yields the record the selector needs, not the envelope',
)

assert.throws(
  () => unwrapAndroidNodeRecord({ data: null, ok: false, status: 404 }, 'The name "alice" does not exist.'),
  /The name "alice" does not exist\./,
  'a missing target is reported as missing, not as a transport failure',
)

assert.throws(
  () => unwrapAndroidNodeRecord({ data: null, ok: false, status: 503 }, 'The name "alice" does not exist.'),
  /The node lookup returned HTTP 503\./,
  'an unreachable node is distinguishable from a name that is simply not registered',
)

assert.throws(
  () => unwrapAndroidNodeRecord({ data: null, ok: false }, 'missing'),
  /The node lookup failed\./,
  'a failed envelope with no status still refuses rather than returning null data',
)

// `ok` is the ONLY success signal. An envelope that carries a plausible record
// alongside a failure status must never reach a prompt: that is how an error
// page body would end up displayed as chain state.
assert.throws(
  () => unwrapAndroidNodeRecord({ data: { name: 'alice' }, ok: false, status: 500 }, 'missing'),
  /The node lookup returned HTTP 500\./,
  'record-shaped data does not override a failure status',
)

// The mistake this module exists to prevent is the opposite one — handing the
// envelope on as if it were the record — so a bare value that never came from
// the fetch action is refused with its own message.
for (const value of [null, undefined, 'ok', 42, [{ name: 'alice' }]]) {
  assert.throws(
    () => unwrapAndroidNodeRecord(value, 'missing'),
    /The node answered the lookup with an unrecognized shape\./,
    'only a response envelope can be unwrapped',
  )
}

console.log('Home 2 Android node envelope tests passed.')
