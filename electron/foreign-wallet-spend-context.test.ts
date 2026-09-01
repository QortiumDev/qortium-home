import assert from 'node:assert/strict'

import {
  buildForeignWalletSpendContextRequest,
  getForeignWalletMainnetChainId,
  normalizeForeignWalletSpendContext,
} from './foreign-wallet-spend-context.js'

const txHash = '11'.repeat(32)
const rawTransaction = '00'
const chainId = getForeignWalletMainnetChainId('BTC')

function context(overrides: Record<string, unknown> = {}) {
  return {
    activeNetwork: 'MAIN',
    blockchain: 'BITCOIN',
    chainId,
    confirmedOnly: true,
    currencyCode: 'BTC',
    lockTime: 0,
    minimumNonDustOutput: '546',
    previousTransactions: { [txHash]: rawTransaction },
    recommendedFeePerByte: '12',
    sequence: 0xffffffff,
    sighashType: 1,
    tipHeight: 100,
    transactionFormat: 'LEGACY',
    transactionVersion: 1,
    utxos: [{
      address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
      height: 90,
      outputIndex: 0,
      path: [0, 7],
      pathAsString: 'M/0/7',
      scriptPubKeyHex: `76a914${'33'.repeat(20)}88ac`,
      txHash,
      value: '100000',
    }],
    version: 1,
    ...overrides,
  }
}

assert.deepEqual(
  buildForeignWalletSpendContextRequest('x'.repeat(111), 'BTC'),
  { expectedChainId: chainId, xpub58: 'x'.repeat(111) },
)
assert.throws(() => buildForeignWalletSpendContextRequest('not-an-xpub', 'BTC'), /extended public key/)

const normalized = normalizeForeignWalletSpendContext(context(), 'BTC')
assert.equal(normalized.coin, 'BTC')
assert.equal(normalized.minimumNonDustOutput, 546n)
assert.equal(normalized.recommendedFeePerByte, 12n)
assert.equal(normalized.utxos[0].path, 'M/0/7')
assert.equal(normalized.utxos[0].previousTransactionHex, rawTransaction)
assert.equal(normalized.utxos[0].value, 100000n)

assert.throws(
  () => normalizeForeignWalletSpendContext(context({ chainId: `bip122:${'44'.repeat(16)}` }), 'BTC'),
  /different chain/,
)
assert.throws(
  () => normalizeForeignWalletSpendContext(context({ currencyCode: 'LTC' }), 'BTC'),
  /different coin/,
)
assert.throws(
  () => normalizeForeignWalletSpendContext(context({ blockchain: 'LITECOIN' }), 'BTC'),
  /different blockchain/,
)
assert.throws(
  () => normalizeForeignWalletSpendContext(context({ activeNetwork: 'TEST3' }), 'BTC'),
  /supported main network/,
)
assert.throws(
  () => normalizeForeignWalletSpendContext(context({ transactionFormat: 'TIMESTAMPED_LEGACY' }), 'BTC'),
  /unsupported transaction rules/,
)
assert.throws(
  () => normalizeForeignWalletSpendContext(context({ previousTransactions: {} }), 'BTC'),
  /missing its previous transaction/,
)
assert.throws(
  () => normalizeForeignWalletSpendContext(context({ previousTransactions: { [txHash]: rawTransaction, ['55'.repeat(32)]: '00' } }), 'BTC'),
  /unreferenced previous transaction/,
)
assert.throws(
  () => normalizeForeignWalletSpendContext(context({ utxos: [{ ...context().utxos[0], pathAsString: 'M/1/7' }] }), 'BTC'),
  /paths do not match/,
)
assert.throws(
  () => normalizeForeignWalletSpendContext(context({ utxos: [{ ...context().utxos[0], height: 101 }] }), 'BTC'),
  /exceeds the reported tip/,
)
assert.throws(
  () => normalizeForeignWalletSpendContext(context({ recommendedFeePerByte: '0' }), 'BTC'),
  /recommended fee/,
)

console.log('Foreign wallet spend-context contract tests passed.')
