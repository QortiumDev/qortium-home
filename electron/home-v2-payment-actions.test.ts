import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { base58Encode, base58Decode } from './base58.js'
import {
  assertUnsignedHomeV2QortalPaymentTransaction,
  assertUnsignedHomeV2QortiumPaymentTransaction,
  assertUnsignedHomeV2QortiumTransferAssetTransaction,
  buildUnsignedQortiumPaymentTransactionBytes,
  buildUnsignedQortiumTransferAssetTransactionBytes,
  canonicalHomeV2PaymentAction,
  homeV2CheckedTotalDebit,
  homeV2FeeForLength,
  homeV2PaymentOperationLabel,
  HomeV2ForeignSendError,
  isHomeV2PaymentAction,
  normalizeHomeV2NativeSendRequest,
  normalizeHomeV2PaymentRecipient,
  normalizeHomeV2SendQortRequest,
  normalizeHomeV2TransferAssetRequest,
  parseHomeV2UnitFee,
  selectHomeV2AssetInfo,
  selectHomeV2AtomicBalance,
} from './home-v2-payment-actions.js'

const sha256 = (data: Uint8Array) => new Uint8Array(createHash('sha256').update(data).digest())

function makeAddress(version: number, seed: number) {
  const payload = new Uint8Array(21)
  payload[0] = version
  payload.fill(seed, 1)
  const checksum = sha256(sha256(payload)).slice(0, 4)
  return base58Encode(new Uint8Array([...payload, ...checksum]))
}

const accountAddress = makeAddress(58, 7)
const atAddress = makeAddress(23, 9)
const otherAddress = makeAddress(58, 11)
const senderKey = base58Encode(new Uint8Array(32).fill(5))
const timestamp = 1_766_200_000_000

// --- predicates, aliases, labels ---
assert.ok(isHomeV2PaymentAction('PAYMENT') && isHomeV2PaymentAction('SEND_COIN') &&
  isHomeV2PaymentAction('SEND_QORT') && isHomeV2PaymentAction('TRANSFER_ASSET'))
assert.equal(canonicalHomeV2PaymentAction('SEND_COIN'), 'PAYMENT')
assert.equal(canonicalHomeV2PaymentAction('PAYMENT'), 'PAYMENT')
assert.equal(canonicalHomeV2PaymentAction('SEND_QORT'), 'SEND_QORT')
assert.equal(homeV2PaymentOperationLabel('PAYMENT'), 'Send the native Qortium coin')
assert.equal(homeV2PaymentOperationLabel('SEND_COIN'), 'Send the native Qortium coin')
assert.equal(homeV2PaymentOperationLabel('SEND_QORT'), 'Send QORT')
assert.equal(homeV2PaymentOperationLabel('TRANSFER_ASSET'), 'Transfer an asset')

// --- recipient validation ---
{
  const account = normalizeHomeV2PaymentRecipient(accountAddress, 'The recipient address')
  assert.equal(account.isAt, false)
  assert.equal(account.bytes.length, 25)
  const at = normalizeHomeV2PaymentRecipient(atAddress, 'The recipient address')
  assert.equal(at.isAt, true)
}
assert.throws(() => normalizeHomeV2PaymentRecipient('not!base58', 'X'), /not valid Base58/)
assert.throws(() => normalizeHomeV2PaymentRecipient(base58Encode(new Uint8Array(24)), 'X'), /25 bytes/)
assert.throws(() => normalizeHomeV2PaymentRecipient(makeAddress(53, 7), 'X'), /unsupported address version/)
{
  const broken = base58Decode(accountAddress)
  broken[24] ^= 1
  assert.throws(() => normalizeHomeV2PaymentRecipient(base58Encode(broken), 'X'), /invalid checksum/)
}

// --- native send normalizer ---
{
  const request = normalizeHomeV2NativeSendRequest('PAYMENT', { amount: '1.5', recipient: accountAddress })
  assert.equal(request.amount.atomic, 150_000_000n)
  assert.equal(request.recipient.address, accountAddress)
}
// native aliases accepted; foreign selectors refuse LOUDLY with the coded error.
assert.equal(
  normalizeHomeV2NativeSendRequest('SEND_COIN', { amount: 1, coin: 'native', recipient: accountAddress }).amount.atomic,
  100_000_000n,
)
for (const foreign of [{ coin: 'BTC' }, { blockchain: 'LITECOIN' }, { sendMax: true }, { receivingAddress: 'x' }]) {
  assert.throws(
    () => normalizeHomeV2NativeSendRequest('SEND_COIN', { amount: 1, recipient: accountAddress, ...foreign }),
    HomeV2ForeignSendError,
    JSON.stringify(foreign),
  )
}
// nonzero assetId routes to TRANSFER_ASSET; app fee/group refuse.
assert.throws(
  () => normalizeHomeV2NativeSendRequest('PAYMENT', { amount: 1, assetId: 3, recipient: accountAddress }),
  /Use TRANSFER_ASSET/,
)
assert.throws(
  () => normalizeHomeV2NativeSendRequest('PAYMENT', { amount: 1, fee: 100, recipient: accountAddress }),
  /does not accept an app-provided fee/,
)
assert.throws(
  () => normalizeHomeV2NativeSendRequest('PAYMENT', { amount: 1, recipient: accountAddress, txGroupId: 5 }),
  /txGroupId must be 0/,
)
assert.throws(
  () => normalizeHomeV2NativeSendRequest('PAYMENT', { amount: 1, feePerByte: '0.1', recipient: accountAddress }),
  /does not accept an app-provided fee/,
)
// Divergent duplicate money fields REFUSE (no precedence for money).
assert.throws(
  () => normalizeHomeV2NativeSendRequest('PAYMENT', {
    amount: 1,
    payload: { recipient: accountAddress },
    recipient: otherAddress,
  }),
  /more than once with different values/,
)
assert.throws(
  () => normalizeHomeV2NativeSendRequest('PAYMENT', {
    address: otherAddress,
    amount: 1,
    recipient: accountAddress,
  }),
  /more than once with different values/,
)
// Equal duplicates are fine.
assert.equal(
  normalizeHomeV2NativeSendRequest('PAYMENT', {
    amount: 1,
    payload: { recipient: accountAddress },
    recipient: accountAddress,
  }).recipient.address,
  accountAddress,
)
// Amount grammar: positivity, over-precision refusal, no floats.
for (const amount of [0, '0', -1, '1.123456789', 'NaN', '1e2', undefined]) {
  assert.throws(
    () => normalizeHomeV2NativeSendRequest('PAYMENT', { amount, recipient: accountAddress }),
    Error,
    `amount ${String(amount)}`,
  )
}

// --- TRANSFER_ASSET normalizer ---
{
  const request = normalizeHomeV2TransferAssetRequest({ amount: '2.25', assetId: 7, recipient: accountAddress })
  assert.equal(request.assetId, 7)
  assert.equal(request.amount.atomic, 225_000_000n)
}
assert.throws(() => normalizeHomeV2TransferAssetRequest({ amount: 1, recipient: accountAddress }), /non-negative numeric assetId/)
assert.throws(() => normalizeHomeV2TransferAssetRequest({ amount: 1, assetId: -1, recipient: accountAddress }), /non-negative numeric assetId/)

// --- SEND_QORT normalizer ---
{
  const byAddress = normalizeHomeV2SendQortRequest({ amount: '3', recipient: accountAddress })
  assert.equal(byAddress.recipientAddress, accountAddress)
  assert.equal(byAddress.recipientName, null)
  const byName = normalizeHomeV2SendQortRequest({ amount: '3', recipient: 'Alice' })
  assert.equal(byName.recipientAddress, null)
  assert.equal(byName.recipientName, 'Alice')
}
assert.throws(() => normalizeHomeV2SendQortRequest({ amount: 1, recipient: 'ab' }), /3 to 40 bytes/)

// --- wire builders + independent verifiers ---
const recipient = normalizeHomeV2PaymentRecipient(accountAddress, 'The recipient address')
const paymentBytes = buildUnsignedQortiumPaymentTransactionBytes({
  amountAtomic: 150_000_000n,
  feeAtomic: 1_000_000n,
  recipientBytes: recipient.bytes,
  senderPublicKey: senderKey,
  timestamp,
})
assert.equal(paymentBytes.byteLength, 89)
assert.doesNotThrow(() => assertUnsignedHomeV2QortiumPaymentTransaction(paymentBytes, {
  amountAtomic: 150_000_000n,
  feeAtomic: 1_000_000n,
  recipientBytes: recipient.bytes,
  senderPublicKey: senderKey,
  timestamp,
}))
const transferBytes = buildUnsignedQortiumTransferAssetTransactionBytes({
  amountAtomic: 225_000_000n,
  assetId: 7,
  feeAtomic: 1_000_000n,
  recipientBytes: recipient.bytes,
  senderPublicKey: senderKey,
  timestamp,
})
assert.equal(transferBytes.byteLength, 97)
assert.doesNotThrow(() => assertUnsignedHomeV2QortiumTransferAssetTransaction(transferBytes, {
  amountAtomic: 225_000_000n,
  assetId: 7,
  feeAtomic: 1_000_000n,
  recipientBytes: recipient.bytes,
  senderPublicKey: senderKey,
  timestamp,
}))
const mutate = (bytes: Uint8Array, offset: number) => {
  const copy = Uint8Array.from(bytes)
  copy[offset] = copy[offset] === 0xff ? 0 : copy[offset] + 1
  return copy
}
for (let offset = 0; offset < paymentBytes.byteLength; offset += 1) {
  assert.throws(
    () => assertUnsignedHomeV2QortiumPaymentTransaction(mutate(paymentBytes, offset), {
      amountAtomic: 150_000_000n,
      feeAtomic: 1_000_000n,
      recipientBytes: recipient.bytes,
      senderPublicKey: senderKey,
      timestamp,
    }),
    Error,
    `payment byte ${offset} mutation must refuse`,
  )
}
for (let offset = 0; offset < transferBytes.byteLength; offset += 1) {
  assert.throws(
    () => assertUnsignedHomeV2QortiumTransferAssetTransaction(mutate(transferBytes, offset), {
      amountAtomic: 225_000_000n,
      assetId: 7,
      feeAtomic: 1_000_000n,
      recipientBytes: recipient.bytes,
      senderPublicKey: senderKey,
      timestamp,
    }),
    Error,
    `transfer byte ${offset} mutation must refuse`,
  )
}
assert.throws(() => assertUnsignedHomeV2QortiumPaymentTransaction(
  Uint8Array.from([...paymentBytes, 0]),
  { amountAtomic: 150_000_000n, feeAtomic: 1_000_000n, recipientBytes: recipient.bytes, senderPublicKey: senderKey, timestamp },
))
// Qortal form verifier (against the existing serializer's layout).
{
  const lastReference = new Uint8Array(64).fill(3)
  const qortalBytes = Uint8Array.from([
    0, 0, 0, 2,
    ...new Uint8Array(new BigInt64Array([BigInt(timestamp)]).buffer).reverse(),
    0, 0, 0, 0,
    ...lastReference,
    ...base58Decode(senderKey),
    ...recipient.bytes,
    ...new Uint8Array(new BigInt64Array([150_000_000n]).buffer).reverse(),
    ...new Uint8Array(new BigInt64Array([1_000_000n]).buffer).reverse(),
  ])
  assert.equal(qortalBytes.byteLength, 153)
  assert.doesNotThrow(() => assertUnsignedHomeV2QortalPaymentTransaction(qortalBytes, {
    amountAtomic: 150_000_000n,
    feeAtomic: 1_000_000n,
    lastReference,
    recipientBytes: recipient.bytes,
    senderPublicKey: senderKey,
    timestamp,
  }))
  assert.throws(() => assertUnsignedHomeV2QortalPaymentTransaction(qortalBytes, {
    amountAtomic: 150_000_001n,
    feeAtomic: 1_000_000n,
    lastReference,
    recipientBytes: recipient.bytes,
    senderPublicKey: senderKey,
    timestamp,
  }), /amount/)
}

// --- fee helpers ---
assert.equal(parseHomeV2UnitFee('1000000'), 1_000_000n)
assert.equal(parseHomeV2UnitFee(1000000), 1_000_000n)
for (const bad of ['0.01', '-5', '', 'abc', null]) {
  assert.throws(() => parseHomeV2UnitFee(bad), /fee quote/, String(bad))
}
assert.equal(homeV2FeeForLength(1_000_000n, 153), 1_000_000n)
assert.equal(homeV2FeeForLength(1_000_000n, 1024), 1_000_000n)
assert.equal(homeV2FeeForLength(1_000_000n, 1025), 2_000_000n)
assert.equal(homeV2CheckedTotalDebit(1n, 2n), 3n)
assert.throws(() => homeV2CheckedTotalDebit(9_223_372_036_854_775_807n, 1n), /out of range/)

// --- selectors ---
assert.deepEqual(
  selectHomeV2AssetInfo({ assetId: 7, isDivisible: true, name: 'GOLD' }, 7),
  { isDivisible: true, isUnspendable: false, name: 'GOLD' },
)
assert.throws(() => selectHomeV2AssetInfo({ assetId: 8, isDivisible: true, name: 'GOLD' }, 7), /different asset/)
assert.throws(() => selectHomeV2AssetInfo({ name: 'GOLD' }, 7), /invalid shape/)
assert.equal(selectHomeV2AtomicBalance('12.5'), 1_250_000_000n)
assert.equal(selectHomeV2AtomicBalance(3), 300_000_000n)
assert.equal(selectHomeV2AtomicBalance({ balance: '0.00000001' }), 1n)
assert.throws(() => selectHomeV2AtomicBalance({}), /invalid shape/)
assert.throws(() => selectHomeV2AtomicBalance('1.123456789'), Error)

console.log('Home v2 payment contract tests passed.')
