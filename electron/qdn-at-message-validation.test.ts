import assert from 'node:assert/strict'

import { buildUnsignedQortiumAtMessageTransactionBytes } from './qdn-at-message.js'
import { assertUnsignedQortiumAtMessageTransaction } from './qdn-at-message-validation.js'
import { base58Decode } from './base58.js'

// The real Qortium Previewnet AT the shipped caller messages (the SMPL faucet
// V1), and a real 32-byte public key — so the builder and the verifier meet on
// the exact wire form rather than on a synthetic fixture.
const RECIPIENT = 'AG9QWs1tEBTmXoH2rrQXwV4LdMAM99o5WD'
const SENDER_PUBLIC_KEY = '2tiMr5LTpaWCgbRvkPK8TFd7k63DyHJMMFFsz9uBg1ZP'

function expectedFor(message: string, timestamp: number, nonce: number) {
  return {
    messageBytes: new TextEncoder().encode(message),
    nonce,
    recipientBytes: base58Decode(RECIPIENT),
    senderPublicKeyBytes: base58Decode(SENDER_PUBLIC_KEY),
    timestamp,
  }
}

const timestamp = 1_767_225_600_000
const message = 'claim'
const bytes = buildUnsignedQortiumAtMessageTransactionBytes({
  message,
  recipient: RECIPIENT,
  senderPublicKey: SENDER_PUBLIC_KEY,
  timestamp,
})

// The builder's output verifies against the inputs it was given.
assertUnsignedQortiumAtMessageTransaction(bytes, expectedFor(message, timestamp, 0))

// Every field the approval rests on is actually checked. Each of these is a
// transaction the user did not approve.
assert.throws(
  () => assertUnsignedQortiumAtMessageTransaction(bytes, expectedFor('claim!', timestamp, 0)),
  /message length|message/,
  'a changed message is refused',
)
assert.throws(
  () => assertUnsignedQortiumAtMessageTransaction(bytes, expectedFor(message, timestamp + 1, 0)),
  /timestamp/,
  'a changed timestamp is refused',
)
assert.throws(
  () => assertUnsignedQortiumAtMessageTransaction(bytes, expectedFor(message, timestamp, 7)),
  /nonce/,
  'the nonce must be exactly the computed one',
)
assert.throws(
  () => assertUnsignedQortiumAtMessageTransaction(bytes, {
    ...expectedFor(message, timestamp, 0),
    // One byte different from the real AT: the verifier compares the exact
    // 25-byte address, so a near-miss is still a different contract.
    recipientBytes: (() => {
      const bytes = new Uint8Array(base58Decode(RECIPIENT))
      bytes[5] ^= 0x01
      return bytes
    })(),
  }),
  /recipient/,
  'a different contract is refused',
)
assert.throws(
  () => assertUnsignedQortiumAtMessageTransaction(bytes.slice(0, bytes.length - 1), expectedFor(message, timestamp, 0)),
  /truncated/,
  'truncated bytes are refused',
)
assert.throws(
  () => assertUnsignedQortiumAtMessageTransaction(
    new Uint8Array([...bytes, 0]),
    expectedFor(message, timestamp, 0),
  ),
  /trailing bytes/,
  'appended bytes are refused',
)

// The constants the form fixes are asserted, not skipped. A MESSAGE that moved
// funds, or arrived encrypted, would be a different transaction than the one
// the prompt described — mutate each in place and confirm the refusal.
const AMOUNT_OFFSET = 4 + 8 + 4 + 32 + 4 + 1 + 25
const mutations: readonly { readonly at: number; readonly pattern: RegExp; readonly to: number }[] = [
  { at: AMOUNT_OFFSET + 7, pattern: /amount/, to: 1 },
  { at: 3, pattern: /type/, to: 18 },
]
for (const mutation of mutations) {
  const tampered = new Uint8Array(bytes)
  tampered[mutation.at] = mutation.to
  assert.throws(
    () => assertUnsignedQortiumAtMessageTransaction(tampered, expectedFor(message, timestamp, 0)),
    mutation.pattern,
  )
}

// The encrypted and text flags sit immediately after the message body.
const FLAGS_OFFSET = AMOUNT_OFFSET + 8 + 4 + new TextEncoder().encode(message).length
for (const [offset, value, pattern] of [
  [FLAGS_OFFSET, 1, /encrypted flag/],
  [FLAGS_OFFSET + 1, 0, /text flag/],
] as const) {
  const tampered = new Uint8Array(bytes)
  tampered[offset] = value
  assert.throws(
    () => assertUnsignedQortiumAtMessageTransaction(tampered, expectedFor(message, timestamp, 0)),
    pattern,
  )
}

// The remaining asserted fields, each mutated in place. Without these a
// regression that dropped one of these checks would keep the suite green.
{
  const SENDER_OFFSET = 4 + 8 + 4
  const GROUP_OFFSET = 4 + 8
  const RECIPIENT_FLAG_OFFSET = SENDER_OFFSET + 32 + 4
  const FEE_OFFSET = bytes.length - 8
  for (const [offset, pattern] of [
    [SENDER_OFFSET + 3, /sender/],
    [GROUP_OFFSET + 3, /transaction group/],
    [RECIPIENT_FLAG_OFFSET, /recipient flag/],
    [FEE_OFFSET + 7, /fee/],
  ] as const) {
    const tampered = new Uint8Array(bytes)
    tampered[offset] ^= 0x01
    assert.throws(
      () => assertUnsignedQortiumAtMessageTransaction(tampered, expectedFor(message, timestamp, 0)),
      pattern,
      'every field the verifier claims to check is actually checked',
    )
  }
}

console.log('Qortium AT MESSAGE validation tests passed.')
