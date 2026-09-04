import assert from 'node:assert/strict'

import {
  foreignWalletHistoryContainsTransaction,
  foreignWalletReconciliationRefusal,
  reconcileForeignWalletPendingTransactions,
  FOREIGN_WALLET_SEND_FRESHNESS_MS,
  HomeV2ForeignSendReconciliationPendingError,
} from './foreign-wallet-reconciliation.js'
import { getForeignWalletMainnetChainId } from './foreign-wallet-spend-context.js'
import type { ForeignWalletPendingTransaction } from './foreign-wallet-transaction-journal.js'

const CHAIN_ID = getForeignWalletMainnetChainId('BTC')

const NOW = 1_700_000_000_000

function pending(txId: string): ForeignWalletPendingTransaction {
  return Object.freeze({
    appIdentity: 'qortium://APP/Wallet',
    chainId: CHAIN_ID,
    coin: 'BTC' as const,
    createdAt: 1,
    outpoints: Object.freeze([{ outputIndex: 0, txHash: '11'.repeat(32) }]),
    stage: 'broadcast-attempted' as const,
    broadcastAttemptedAt: 2,
    txId,
    walletFingerprint: '22'.repeat(32),
  })
}

function signedPending(txId: string, createdAt: number): ForeignWalletPendingTransaction {
  return Object.freeze({
    appIdentity: 'qortium://APP/Wallet',
    chainId: CHAIN_ID,
    coin: 'BTC' as const,
    createdAt,
    outpoints: Object.freeze([{ outputIndex: 0, txHash: '33'.repeat(32) }]),
    stage: 'signed' as const,
    txId,
    walletFingerprint: '22'.repeat(32),
  })
}

const FIRST = 'ab'.repeat(32)
const SECOND = 'cd'.repeat(32)

// --- the matcher ------------------------------------------------------------

assert.equal(foreignWalletHistoryContainsTransaction([{ txHash: FIRST }], FIRST), true)
// Core answers a bare array; a wrapped shape is accepted too.
assert.equal(foreignWalletHistoryContainsTransaction({ transactions: [{ txHash: FIRST }] }, FIRST), true)
// Case is normalized, because a transaction id is a hex value, not a string.
assert.equal(foreignWalletHistoryContainsTransaction([{ txHash: FIRST.toUpperCase() }], FIRST), true)
assert.equal(foreignWalletHistoryContainsTransaction([{ txHash: SECOND }], FIRST), false)
assert.equal(foreignWalletHistoryContainsTransaction([], FIRST), false)
// Only `txHash`, and only a canonical 32-byte value: no other field settles an
// entry, and no prefix or overlong value does either.
assert.equal(foreignWalletHistoryContainsTransaction([{ txid: FIRST }], FIRST), false)
assert.equal(foreignWalletHistoryContainsTransaction([{ hash: FIRST }], FIRST), false)
assert.equal(foreignWalletHistoryContainsTransaction([{ txHash: FIRST.slice(0, 62) }], FIRST), false)
assert.equal(foreignWalletHistoryContainsTransaction([{ txHash: `${FIRST}ff` }], FIRST), false)
assert.equal(foreignWalletHistoryContainsTransaction([null, 'x', 7, { txHash: FIRST }], FIRST), true)
// An unusable answer is refused, never read as "absent": a broken read must not
// look like a clean wallet.
for (const bad of ['nope', 42, null, { transactions: 'no' }]) {
  assert.throws(() => foreignWalletHistoryContainsTransaction(bad, FIRST), /unusable shape/)
}
assert.throws(() => foreignWalletHistoryContainsTransaction([], 'not-hex'), /transaction ID is invalid/)
assert.throws(
  () => foreignWalletHistoryContainsTransaction(Array.from({ length: 10_001 }, () => ({})), FIRST),
  /more entries than this wallet will scan/,
)

// --- the reconciliation pass ------------------------------------------------

{
  // Nothing retained: the history is never even read.
  let reads = 0
  const outcome = await reconcileForeignWalletPendingTransactions([], {
    clear: () => assert.fail('nothing to clear'),
    now: NOW,
    readHistory: async () => { reads += 1; return [] },
    release: () => assert.fail('nothing to release'),
  })
  assert.deepEqual(outcome, { cleared: [], released: [], retained: [] })
  assert.equal(reads, 0)
}

{
  // Several entries, ONE history read: a wallet with a backlog must not turn
  // one send into several authenticated round trips.
  let reads = 0
  const cleared: string[] = []
  const outcome = await reconcileForeignWalletPendingTransactions(
    [pending(FIRST), pending(SECOND)],
    {
      clear: (entry, observedTxId) => {
        assert.equal(observedTxId, entry.txId)
        cleared.push(entry.txId)
      },
      now: NOW,
      readHistory: async () => { reads += 1; return [{ txHash: FIRST }] },
      release: () => assert.fail('a broadcast-attempted entry is never released'),
    },
  )
  assert.equal(reads, 1)
  assert.deepEqual(cleared, [FIRST])
  assert.deepEqual(outcome.cleared, [FIRST])
  assert.deepEqual(outcome.released, [])
  assert.deepEqual(outcome.retained, [SECOND])
}

{
  // A history read that fails is not "absent": the error propagates, so the
  // send is refused rather than proceeding over unsettled entries.
  await assert.rejects(
    reconcileForeignWalletPendingTransactions([pending(FIRST)], {
      clear: () => assert.fail('must not clear'),
      now: NOW,
      readHistory: async () => { throw new Error('node unreachable') },
      release: () => assert.fail('must not release'),
    }),
    /node unreachable/,
  )
}

// --- releasing a transaction that was never broadcast -----------------------
//
// The broadcast-attempt mark is fsynced BEFORE the single POST, so an entry
// still at 'signed' proves the bytes never left. Only the age guard stands
// between that proof and a concurrent in-flight send in another instance.

{
  // Stale and never attempted: released, and the history is not even read
  // because nothing is left that needs proving.
  let reads = 0
  const released: string[] = []
  const stale = signedPending(FIRST, NOW - FOREIGN_WALLET_SEND_FRESHNESS_MS)
  const outcome = await reconcileForeignWalletPendingTransactions([stale], {
    clear: () => assert.fail('a never-broadcast entry needs no history proof'),
    now: NOW,
    readHistory: async () => { reads += 1; return [] },
    release: (entry) => released.push(entry.txId),
  })
  assert.deepEqual(released, [FIRST])
  assert.deepEqual(outcome.released, [{ reason: 'signed-never-attempted', txId: FIRST }])
  assert.deepEqual(outcome.retained, [])
  assert.equal(reads, 0)
}

{
  // One millisecond inside the window: still blocking. A send in another
  // instance could be holding it right now.
  const fresh = signedPending(FIRST, NOW - FOREIGN_WALLET_SEND_FRESHNESS_MS + 1)
  const outcome = await reconcileForeignWalletPendingTransactions([fresh], {
    clear: () => assert.fail('must not clear'),
    now: NOW,
    readHistory: async () => [],
    release: () => assert.fail('a fresh entry is never released'),
  })
  assert.deepEqual(outcome.released, [])
  assert.deepEqual(outcome.retained, [FIRST])
}

{
  // Age alone never releases a transaction whose bytes DID leave: an old
  // broadcast-attempted entry still needs the exact id in the history.
  const attempted = pending(FIRST)
  assert.ok(NOW - attempted.createdAt > FOREIGN_WALLET_SEND_FRESHNESS_MS)
  const outcome = await reconcileForeignWalletPendingTransactions([attempted], {
    clear: () => assert.fail('must not clear'),
    now: NOW,
    readHistory: async () => [],
    release: () => assert.fail('a broadcast-attempted entry is never released on age'),
  })
  assert.deepEqual(outcome.released, [])
  assert.deepEqual(outcome.retained, [FIRST])
}

{
  // Mixed: the stale signed one goes, the attempted one is proved by history.
  const released: string[] = []
  const cleared: string[] = []
  const outcome = await reconcileForeignWalletPendingTransactions(
    [signedPending(FIRST, NOW - FOREIGN_WALLET_SEND_FRESHNESS_MS), pending(SECOND)],
    {
      clear: (entry) => cleared.push(entry.txId),
      now: NOW,
      readHistory: async () => [{ txHash: SECOND }],
      release: (entry) => released.push(entry.txId),
    },
  )
  assert.deepEqual(released, [FIRST])
  assert.deepEqual(cleared, [SECOND])
  assert.deepEqual(outcome.retained, [])
}

const refusal = foreignWalletReconciliationRefusal('BTC', [FIRST, SECOND])
assert.ok(refusal instanceof HomeV2ForeignSendReconciliationPendingError)
assert.equal(refusal.code, 'FOREIGN_SEND_RECONCILIATION_REQUIRED')
assert.ok(refusal.message.includes(FIRST) && refusal.message.includes(SECOND))
assert.ok(refusal.message.includes('never retried and never discarded on a guess'))

console.log('Foreign wallet reconciliation tests passed.')
