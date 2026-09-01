import assert from 'node:assert/strict'

import { getForeignWalletMainnetChainId } from '../../electron/foreign-wallet-spend-context'
import type { ForeignWalletPendingTransaction } from '../../electron/foreign-wallet-transaction-journal'
import { createAndroidForeignWalletTransactionJournalStore } from './foreign-wallet-transaction-journal-store'

const now = 1_800_000_000_000
const entry: ForeignWalletPendingTransaction = {
  appIdentity: 'qdn://APP/Wallet/Wallet',
  chainId: getForeignWalletMainnetChainId('BTC'),
  coin: 'BTC',
  createdAt: now,
  outpoints: [{ outputIndex: 1, txHash: '11'.repeat(32) }],
  stage: 'signed',
  txId: '22'.repeat(32),
  walletFingerprint: '33'.repeat(32),
}

async function main() {
  let stored: string | null = null
  let failNextWrite = false
  const plugin = {
    async read() { return { value: stored } },
    async write(request: { value: string }) {
      if (failNextWrite) {
        failNextWrite = false
        throw new Error('injected native atomic write failure')
      }
      stored = request.value
    },
  }
  const store = createAndroidForeignWalletTransactionJournalStore(plugin)

  assert.equal((await store.read()).entries.length, 0)
  await store.recordSigned({
    ...entry,
    privateKey: 'private-secret-sentinel',
    rawTransactionHex: 'raw-secret-sentinel',
    seed: 'seed-secret-sentinel',
    xpub58: 'xpub-secret-sentinel',
  } as ForeignWalletPendingTransaction)
  assert.equal(stored?.includes('secret-sentinel'), false)
  assert.equal((await store.read()).entries[0].stage, 'signed')
  assert.equal((await store.findConflict(entry))?.txId, entry.txId)

  failNextWrite = true
  await assert.rejects(store.recordBroadcastAttempt(entry, now + 1), /atomic write failure/)
  assert.equal((await store.read()).entries[0].stage, 'signed')
  await store.recordBroadcastAttempt(entry, now + 1)
  assert.equal((await store.read()).entries[0].stage, 'broadcast-attempted')
  await assert.rejects(store.recordBroadcastAttempt(entry, now + 2), /already attempted/)
  await assert.rejects(store.confirmBroadcastSuccess(entry, '44'.repeat(32)), /did not match/)
  assert.equal((await store.read()).entries.length, 1)

  failNextWrite = true
  assert.deepEqual(await store.confirmBroadcastSuccess(entry, entry.txId), {
    cleanupError: 'injected native atomic write failure',
    journalCleared: false,
  })
  assert.equal((await store.read()).entries.length, 1)
  assert.deepEqual(await store.confirmBroadcastSuccess(entry, entry.txId), { journalCleared: true })
  assert.equal((await store.read()).entries.length, 0)

  await store.recordSigned({ ...entry, createdAt: 1, txId: '55'.repeat(32) })
  assert.equal((await store.read()).entries[0].createdAt, 1)
  stored = '{not-json'
  await assert.rejects(store.read(), /unreadable/)

  console.log('Android foreign wallet transaction journal store tests passed.')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
