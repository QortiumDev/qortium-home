// The pure half of foreign sending: what an app may ask for, and exactly
// what the user is shown. Everything here is reachable without Electron.
import assert from 'node:assert/strict'

import {
  buildHomeV2ForeignSendApprovalRows,
  homeV2ForeignAmountText,
  homeV2ForeignAtomicToDecimal,
  homeV2ForeignSendApprovalTarget,
  homeV2ForeignSendChainId,
  homeV2ForeignSendOperationLabel,
  isHomeV2ForeignSendRequest,
  normalizeHomeV2ForeignSendRequest,
  resolveHomeV2ForeignSendFeePerByte,
  FOREIGN_SEND_DETAIL_SEQUENCE,
} from './home-v2-foreign-send-actions.js'
import { getForeignWalletMainnetChainId } from './foreign-wallet-spend-context.js'
import { HomeV2ForeignSendError, homeV2PaymentOperationLabel } from './home-v2-payment-actions.js'

const RECIPIENT = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'
const CHANGE_ADDRESS = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'

// ---------------------------------------------------------------------------
// 1. The foreign/native split

assert.equal(isHomeV2ForeignSendRequest('PAYMENT', { coin: 'BTC' }), false)
assert.equal(isHomeV2ForeignSendRequest('SEND_COIN', { amount: '1', recipient: 'Q1' }), false)
assert.equal(isHomeV2ForeignSendRequest('SEND_COIN', { coin: 'NATIVE' }), false)
assert.equal(isHomeV2ForeignSendRequest('SEND_COIN', { coin: 'QORTIUM' }), false)
assert.equal(isHomeV2ForeignSendRequest('SEND_COIN', null), false)
for (const coin of ['BTC', 'btc', 'Bitcoin', 'LTC', 'DOGE', 'DGB', 'RVN', 'DASH', 'NMC', 'FIRO']) {
  assert.equal(isHomeV2ForeignSendRequest('SEND_COIN', { coin }), true, coin)
}
assert.equal(isHomeV2ForeignSendRequest('SEND_COIN', { payload: { blockchain: 'LITECOIN' } }), true)
// ARRR is not one of the eight supported chains, so a bare `coin: 'ARRR'`
// does NOT claim the foreign arm: it falls through to the native normalizer,
// which keeps refusing it with the existing coded foreign-send error.
assert.equal(isHomeV2ForeignSendRequest('SEND_COIN', { coin: 'ARRR' }), false)
for (const field of ['sendMax', 'feePerByte', 'receivingAddress', 'xprv58']) {
  assert.equal(isHomeV2ForeignSendRequest('SEND_COIN', { [field]: 'x' }), true, field)
}
// A money field disagreeing with itself routes to the foreign arm, which
// re-reads it and refuses; it must never fall through to a native payment.
assert.equal(isHomeV2ForeignSendRequest('SEND_COIN', { coin: 'BTC', payload: { coin: 'LTC' } }), true)

// ---------------------------------------------------------------------------
// 2. Request normalization

const basic = normalizeHomeV2ForeignSendRequest({ amount: '0.5', coin: 'BTC', recipient: RECIPIENT })
assert.equal(basic.coin, 'BTC')
assert.equal(basic.amountAtomic, 50_000_000n)
assert.equal(basic.feePerByteAtomic, null)
assert.equal(basic.recipientAddress, RECIPIENT)
assert.equal(basic.sendMax, false)

assert.equal(
  normalizeHomeV2ForeignSendRequest({ coin: 'LTC', receivingAddress: RECIPIENT, sendMax: true }).sendMax,
  true,
)
assert.equal(
  normalizeHomeV2ForeignSendRequest({ coin: 'LTC', recipient: RECIPIENT, sendMax: 'true' }).sendMax,
  true,
)
assert.equal(
  normalizeHomeV2ForeignSendRequest({ amount: '1', coin: 'LTC', recipient: RECIPIENT, sendMax: false }).sendMax,
  false,
)

// An extended PRIVATE key is the 1.x custody model. Always refused, by name.
assert.throws(
  () => normalizeHomeV2ForeignSendRequest({ amount: '1', coin: 'BTC', recipient: RECIPIENT, xprv58: 'xprv9s21' }),
  /never accepts an extended private key/,
)
// Amount ambiguity, in both directions.
assert.throws(
  () => normalizeHomeV2ForeignSendRequest({ coin: 'BTC', recipient: RECIPIENT }),
  /amount is required, or set sendMax/,
)
assert.throws(
  () => normalizeHomeV2ForeignSendRequest({ amount: '1', coin: 'BTC', recipient: RECIPIENT, sendMax: true }),
  /do not also give an amount/,
)
assert.throws(
  () => normalizeHomeV2ForeignSendRequest({ amount: '1', coin: 'BTC', payload: { amount: '2' }, recipient: RECIPIENT }),
  /appears more than once with different values/,
)
assert.throws(
  () => normalizeHomeV2ForeignSendRequest({ amount: '0', coin: 'BTC', recipient: RECIPIENT }),
  /must be greater than zero/,
)
assert.throws(
  () => normalizeHomeV2ForeignSendRequest({ amount: '0.000000001', coin: 'BTC', recipient: RECIPIENT }),
  /up to 8 decimal places/,
)
assert.throws(
  () => normalizeHomeV2ForeignSendRequest({ amount: '1', coin: 'ARRR', recipient: RECIPIENT }),
  HomeV2ForeignSendError,
)
assert.throws(
  () => normalizeHomeV2ForeignSendRequest({ amount: '1', recipient: RECIPIENT }),
  HomeV2ForeignSendError,
)
assert.throws(
  () => normalizeHomeV2ForeignSendRequest({ amount: '1', coin: 'BTC' }),
  /Recipient address is required/,
)
assert.throws(
  () => normalizeHomeV2ForeignSendRequest({ amount: '1', coin: 'BTC', fee: '0.01', recipient: RECIPIENT }),
  /does not accept an app-provided fee/,
)
assert.throws(
  () => normalizeHomeV2ForeignSendRequest({ amount: '1', coin: 'BTC', recipient: RECIPIENT, txGroupId: 1 }),
  /txGroupId must be 0/,
)
assert.throws(
  () => normalizeHomeV2ForeignSendRequest({ coin: 'BTC', recipient: RECIPIENT, sendMax: 'maybe' }),
  /Send max must be true or false/,
)
assert.throws(
  () => normalizeHomeV2ForeignSendRequest({ amount: '1', coin: 'BTC', recipient: `${RECIPIENT}\u0000` }),
  /recipient address is invalid/,
)

// Fee rate: both live spellings, and everything else refused.
assert.equal(
  normalizeHomeV2ForeignSendRequest({ amount: '1', coin: 'BTC', feePerByte: '12', recipient: RECIPIENT }).feePerByteAtomic,
  12n,
)
assert.equal(
  normalizeHomeV2ForeignSendRequest({ amount: '1', coin: 'BTC', feePerByte: '0.00000012', recipient: RECIPIENT }).feePerByteAtomic,
  12n,
)
assert.equal(
  normalizeHomeV2ForeignSendRequest({ amount: '1', coin: 'BTC', feePerByte: 12, recipient: RECIPIENT }).feePerByteAtomic,
  12n,
)
assert.throws(
  () => normalizeHomeV2ForeignSendRequest({ amount: '1', coin: 'BTC', feePerByte: '0', recipient: RECIPIENT }),
  /must be greater than zero/,
)
assert.throws(
  () => normalizeHomeV2ForeignSendRequest({ amount: '1', coin: 'BTC', feePerByte: '-3', recipient: RECIPIENT }),
  /atomic units per byte/,
)
assert.throws(
  () => normalizeHomeV2ForeignSendRequest({ amount: '1', coin: 'BTC', feePerByte: '1e3', recipient: RECIPIENT }),
  /atomic units per byte/,
)

// The band. Under the recommendation the network will not relay it; more than
// ten times it is a way to burn the wallet through a fee.
assert.equal(resolveHomeV2ForeignSendFeePerByte(null, 12n), 12n)
assert.equal(resolveHomeV2ForeignSendFeePerByte(12n, 12n), 12n)
assert.equal(resolveHomeV2ForeignSendFeePerByte(120n, 12n), 120n)
assert.throws(() => resolveHomeV2ForeignSendFeePerByte(11n, 12n), /outside the accepted range/)
assert.throws(() => resolveHomeV2ForeignSendFeePerByte(121n, 12n), /outside the accepted range/)
// A coin-decimal rate misread as atomic (or the reverse) is 1e8 out of band,
// so a misread can only ever refuse.
assert.throws(() => resolveHomeV2ForeignSendFeePerByte(1_200_000_000n, 12n), /outside the accepted range/)
assert.throws(() => resolveHomeV2ForeignSendFeePerByte(12n, 0n), /usable recommended fee rate/)

// ---------------------------------------------------------------------------
// 3. Amount text and approval rows

assert.equal(homeV2ForeignAtomicToDecimal(0n), '0.00000000')
assert.equal(homeV2ForeignAtomicToDecimal(1n), '0.00000001')
assert.equal(homeV2ForeignAtomicToDecimal(100_000_000n), '1.00000000')
assert.equal(homeV2ForeignAtomicToDecimal(123_456_789n), '1.23456789')
assert.equal(homeV2ForeignAmountText(50_000n, 'BTC'), '0.00050000 BTC (50000 satoshis)')
// Every money string carries a decimal point, so a downstream renderer can
// never mistake it for a bare atomic integer and divide it again.
for (const atomic of [0n, 1n, 546n, 100_000_000n]) {
  assert.ok(homeV2ForeignAtomicToDecimal(atomic).includes('.'))
}

assert.equal(homeV2ForeignSendOperationLabel('BTC'), 'Send BTC')
// A foreign send is a different user-visible operation from a native one.
assert.notEqual(homeV2ForeignSendOperationLabel('BTC'), homeV2PaymentOperationLabel('SEND_COIN'))

assert.equal(homeV2ForeignSendChainId('BTC'), getForeignWalletMainnetChainId('BTC'))

const chainId = getForeignWalletMainnetChainId('BTC')
assert.equal(
  homeV2ForeignSendApprovalTarget({ amountAtomic: 50_000n, chainId, coin: 'BTC', recipient: RECIPIENT }),
  `foreign-send:BTC:${chainId}:${RECIPIENT}:50000`,
)
assert.equal(
  homeV2ForeignSendApprovalTarget({ amountAtomic: null, chainId, coin: 'BTC', recipient: RECIPIENT }),
  `foreign-send:BTC:${chainId}:${RECIPIENT}:max`,
)
// The target namespace is its own: a foreign approval can never be satisfied
// by, or dedupe against, a native payment target.
assert.ok(!homeV2ForeignSendApprovalTarget({
  amountAtomic: 50_000n,
  chainId,
  coin: 'BTC',
  recipient: RECIPIENT,
}).startsWith('payment:'))

// The shell's own copy of the sequence validator, so this test proves the
// rows satisfy exactly what the renderer will demand of them.
function isSequencedDetailRows(
  sequence: readonly { label: string; optional?: true }[],
  value: unknown,
): boolean {
  if (!Array.isArray(value) || value.length < 1) return false
  let position = 0
  for (const expected of sequence) {
    const candidate = value[position] as unknown
    const matches = !!candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      && Object.keys(candidate).length === 2
      && (candidate as Record<string, unknown>).label === expected.label
      && typeof (candidate as Record<string, unknown>).value === 'string'
      && ((candidate as Record<string, unknown>).value as string).length >= 1
    if (matches) position += 1
    else if (!expected.optional) return false
  }
  return position === value.length
}

const withChange = buildHomeV2ForeignSendApprovalRows({
  amount: 100_000n,
  change: 195_488n,
  changeAddress: CHANGE_ADDRESS,
  fee: 4_512n,
  feePerByte: 12n,
  inputAmount: 300_000n,
  inputs: [{}, {}],
  recipientAddress: RECIPIENT,
  sendMax: false,
}, { chainId, coin: 'BTC' })
assert.ok(isSequencedDetailRows(FOREIGN_SEND_DETAIL_SEQUENCE, withChange))
assert.deepEqual(withChange.map((row) => row.label), [
  'You send',
  'Paid to',
  'Coin',
  'Chain',
  'Network fee',
  'Fee rate',
  'Change back to you',
  'Inputs spent',
  'Total debited',
])
assert.equal(withChange[0].value, '0.00100000 BTC (100000 satoshis)')
assert.equal(withChange[1].value, RECIPIENT)
assert.equal(withChange[3].value, chainId)
assert.ok(withChange[6].value.includes(CHANGE_ADDRESS))
// Change goes back to an address the wallet already spends from, and the
// prompt says so rather than leaving the user to infer it.
assert.ok(withChange[6].value.includes('already spending from'))
assert.ok(withChange[7].value.startsWith('2 confirmed outputs'))
assert.equal(withChange[8].value, '0.00104512 BTC (104512 satoshis)')

const maxRows = buildHomeV2ForeignSendApprovalRows({
  amount: 344_108n,
  change: 0n,
  changeAddress: null,
  fee: 5_892n,
  feePerByte: 12n,
  inputAmount: 350_000n,
  inputs: [{}, {}, {}],
  recipientAddress: RECIPIENT,
  sendMax: true,
}, { chainId, coin: 'BTC' })
assert.ok(isSequencedDetailRows(FOREIGN_SEND_DETAIL_SEQUENCE, maxRows))
assert.deepEqual(maxRows.map((row) => row.label), [
  'You send',
  'Paid to',
  'Coin',
  'Chain',
  'Send max',
  'Network fee',
  'Fee rate',
  'Inputs spent',
  'Total debited',
])
assert.equal(maxRows[8].value, '0.00350000 BTC (350000 satoshis)')

// Every row carries both the decimal AND the atomic count for money values.
for (const row of [...withChange, ...maxRows]) {
  if (['You send', 'Network fee', 'Total debited'].includes(row.label)) {
    assert.match(row.value, /^\d+\.\d{8} BTC \(\d+ satoshis\)$/, row.label)
  }
}

console.log('home-v2-foreign-send-actions tests passed.')
