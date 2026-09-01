import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import {
  addSignedForeignWalletPendingTransaction,
  confirmForeignWalletBroadcastSuccess,
  createEmptyForeignWalletTransactionJournal,
  findForeignWalletPendingTransactionConflict,
  FOREIGN_WALLET_TRANSACTION_JOURNAL_MAX_ENTRIES,
  markForeignWalletBroadcastAttempted,
  sanitizeForeignWalletPendingTransaction,
  sanitizeForeignWalletTransactionJournal,
  type ForeignWalletPendingTransaction,
} from './foreign-wallet-transaction-journal.js'
import { getForeignWalletMainnetChainId } from './foreign-wallet-spend-context.js'
import {
  fingerprintForeignWalletPublicRuntime,
  type ForeignWalletCoin,
  type ForeignWalletCrypto,
} from './foreign-wallets.js'

const cryptoAdapter: ForeignWalletCrypto = {
  ripemd160: (data) => Uint8Array.from(createHash('ripemd160').update(data).digest()),
  sha256: (data) => Uint8Array.from(createHash('sha256').update(data).digest()),
  sha512: (data) => Uint8Array.from(createHash('sha512').update(data).digest()),
}
const btcXpub = 'xpub661MyMwAqRbcFKoxjof6RWPGfcCirFqyx1wAaYjuKtASDHK5ufvbvDG5NUdKigNnDpdhbuimdjPeAUfpVW1mBrpHjp2oX1ahdcbC1VmUWt9'
const walletFingerprint = fingerprintForeignWalletPublicRuntime({
  coin: 'BTC',
  crypto: cryptoAdapter,
  xpub58: btcXpub,
})
const now = 1_800_000_000_000

function entry(overrides: Partial<ForeignWalletPendingTransaction> = {}): ForeignWalletPendingTransaction {
  return {
    appIdentity: 'qdn://APP/Wallet/Wallet',
    chainId: getForeignWalletMainnetChainId('BTC'),
    coin: 'BTC',
    createdAt: now,
    outpoints: [{ outputIndex: 1, txHash: '11'.repeat(32) }],
    stage: 'signed',
    txId: '22'.repeat(32),
    walletFingerprint,
    ...overrides,
  }
}

assert.match(walletFingerprint, /^[0-9a-f]{64}$/)
assert.equal(
  fingerprintForeignWalletPublicRuntime({ coin: 'BTC', crypto: cryptoAdapter, xpub58: btcXpub }),
  walletFingerprint,
)
assert.throws(
  () => fingerprintForeignWalletPublicRuntime({ coin: 'BTC', crypto: cryptoAdapter, xpub58: `${btcXpub.slice(0, -1)}x` }),
  /extended public key/,
)

const coins: ForeignWalletCoin[] = ['BTC', 'LTC', 'DOGE', 'DGB', 'RVN', 'DASH', 'NMC', 'FIRO']
for (const coin of coins) {
  const sanitized = sanitizeForeignWalletPendingTransaction(entry({
    chainId: getForeignWalletMainnetChainId(coin),
    coin,
  }))
  assert.equal(sanitized.chainId, getForeignWalletMainnetChainId(coin))
  for (const other of coins.filter((candidate) => candidate !== coin)) {
    assert.throws(
      () => sanitizeForeignWalletPendingTransaction(entry({
        chainId: getForeignWalletMainnetChainId(other),
        coin,
      })),
      /does not match its coin/,
    )
  }
}

const projected = sanitizeForeignWalletPendingTransaction({
  ...entry({
    outpoints: [
      { outputIndex: 2, txHash: '44'.repeat(32) },
      { outputIndex: 1, txHash: '33'.repeat(32) },
    ],
  }),
  rawTransactionHex: 'secret-raw-sentinel',
  xpub58: 'secret-xpub-sentinel',
})
assert.deepEqual(projected.outpoints.map((outpoint) => outpoint.txHash), ['33'.repeat(32), '44'.repeat(32)])
assert.equal(JSON.stringify(projected).includes('secret-'), false)
assert.throws(
  () => sanitizeForeignWalletPendingTransaction(entry({
    outpoints: [
      { outputIndex: 1, txHash: '11'.repeat(32) },
      { outputIndex: 1, txHash: '11'.repeat(32) },
    ],
  })),
  /duplicate outpoint/,
)
assert.throws(
  () => sanitizeForeignWalletPendingTransaction({ ...entry(), broadcastAttemptedAt: now + 1 }),
  /broadcast time/,
)
assert.throws(
  () => sanitizeForeignWalletPendingTransaction(entry({ stage: 'broadcast-attempted' })),
  /broadcast time/,
)

const signed = addSignedForeignWalletPendingTransaction(
  createEmptyForeignWalletTransactionJournal(),
  entry(),
)
assert.equal(signed.entries.length, 1)
assert.equal(signed.entries[0].stage, 'signed')
assert.throws(() => addSignedForeignWalletPendingTransaction(signed, entry()), /already recorded/)

const crossAppConflict = findForeignWalletPendingTransactionConflict(signed, entry({
  appIdentity: 'qortal://APP/Another/Wallet',
  txId: '55'.repeat(32),
}))
assert.equal(crossAppConflict?.txId, entry().txId)
assert.equal(findForeignWalletPendingTransactionConflict(signed, entry({
  outpoints: [{ outputIndex: 9, txHash: '66'.repeat(32) }],
  txId: '77'.repeat(32),
})), undefined)
assert.equal(findForeignWalletPendingTransactionConflict(signed, entry({
  txId: '88'.repeat(32),
  walletFingerprint: '99'.repeat(32),
})), undefined)
assert.throws(() => findForeignWalletPendingTransactionConflict(signed, entry({
  outpoints: [
    { outputIndex: 1, txHash: '11'.repeat(32) },
    { outputIndex: 1, txHash: '11'.repeat(32) },
  ],
})), /duplicate outpoint/)
assert.throws(() => findForeignWalletPendingTransactionConflict(signed, entry({
  chainId: getForeignWalletMainnetChainId('LTC'),
})), /does not match its coin/)

assert.throws(
  () => confirmForeignWalletBroadcastSuccess(signed, entry(), entry().txId),
  /not marked as broadcast attempted/,
)
const attempted = markForeignWalletBroadcastAttempted(signed, entry(), now + 1)
assert.equal(attempted.entries[0].stage, 'broadcast-attempted')
assert.equal(attempted.entries[0].broadcastAttemptedAt, now + 1)
assert.throws(() => markForeignWalletBroadcastAttempted(attempted, entry(), now + 2), /already attempted/)
assert.throws(
  () => confirmForeignWalletBroadcastSuccess(attempted, entry(), 'aa'.repeat(32)),
  /did not match/,
)
assert.equal(attempted.entries.length, 1)
assert.equal(confirmForeignWalletBroadcastSuccess(attempted, entry(), entry().txId).entries.length, 0)

const ancient = sanitizeForeignWalletTransactionJournal({
  entries: [{ ...entry({ createdAt: 1 }), createdAt: 1 }],
  version: 1,
})
assert.equal(ancient.entries.length, 1)

const full = sanitizeForeignWalletTransactionJournal({
  entries: Array.from({ length: FOREIGN_WALLET_TRANSACTION_JOURNAL_MAX_ENTRIES }, (_value, index) => entry({
    outpoints: [{ outputIndex: index, txHash: index.toString(16).padStart(64, '0') }],
    txId: (index + 1).toString(16).padStart(64, '0'),
  })),
  version: 1,
})
assert.throws(() => addSignedForeignWalletPendingTransaction(full, entry({
  outpoints: [{ outputIndex: 0, txHash: 'fe'.repeat(32) }],
  txId: 'ff'.repeat(32),
})), /journal is full/)

assert.throws(() => sanitizeForeignWalletTransactionJournal({
  entries: [entry(), entry({ appIdentity: 'other' })],
  version: 1,
}), /duplicate transaction/)
assert.throws(() => sanitizeForeignWalletTransactionJournal({
  entries: [entry(), entry({ txId: 'aa'.repeat(32) })],
  version: 1,
}), /conflicting outpoint/)

console.log('Foreign wallet transaction journal contract tests passed.')
