import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { base58Encode } from './base58.js'
import {
  findStoredHomeV2PendingTransactionConflict,
  forgetHomeV2PendingTransaction,
  listHomeV2PendingTransactions,
  readHomeV2TransactionJournal,
  recordHomeV2PendingTransaction,
} from './home-v2-transaction-journal-store.js'

const userData = mkdtempSync(path.join(os.tmpdir(), 'home-v2-journal-'))
const signature = base58Encode(new Uint8Array(64).fill(9))
const now = 2_000_000_000_000
recordHomeV2PendingTransaction(userData, {
  accountId: 'wallet:one:0',
  action: 'SEND_CHAT_MESSAGE',
  appIdentity: 'qdn://APP/Chat/default',
  createdAt: now,
  network: 'qortium',
  protocol: 'qdnRequest',
  signature,
  target: { kind: 'group', groupId: 12 },
  timestamp: now - 1,
}, now)
assert.equal(listHomeV2PendingTransactions(userData, {
  accountId: 'wallet:one:0',
  appIdentity: 'qdn://APP/Chat/default',
  network: 'qortium',
}, now).length, 1)
assert.equal(findStoredHomeV2PendingTransactionConflict(userData, {
  accountId: 'wallet:one:0',
  action: 'SEND_CHAT_MESSAGE',
  appIdentity: 'qdn://APP/Chat/default',
  network: 'qortium',
  request: { txGroupId: 12 },
}, now)?.signature, signature)
assert.equal(statSync(path.join(userData, 'home-v2-pending-transactions.json')).mode & 0o777, 0o600)
assert.equal(readFileSync(path.join(userData, 'home-v2-pending-transactions.json'), 'utf8').includes('message'), false)
assert.equal(forgetHomeV2PendingTransaction(userData, { network: 'qortium', signature }, now), true)
assert.equal(readHomeV2TransactionJournal(userData, now).entries.length, 0)

writeFileSync(path.join(userData, 'home-v2-pending-transactions.json'), '{bad json', 'utf8')
assert.throws(() => readHomeV2TransactionJournal(userData, now), /unreadable/)

console.log('Home v2 pending transaction journal store tests passed')
