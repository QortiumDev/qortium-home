import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { base58Encode } from './base58.js'
import {
  HOME_JOURNAL_LOCKED_CODE,
  isJournalLockedError,
} from './durable-json-file.js'
import {
  createHomeV2TransactionJournalStore,
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

const entry = {
  accountId: 'wallet:one:0',
  action: 'SEND_CHAT_MESSAGE',
  appIdentity: 'qdn://APP/Chat/default',
  createdAt: now,
  network: 'qortium',
  protocol: 'qdnRequest',
  signature,
  target: { kind: 'group', groupId: 12 },
  timestamp: now - 1,
} as Parameters<typeof recordHomeV2PendingTransaction>[1]

// Durability faults surface as errors and never leave a partial file behind.
for (const operation of ['writeFileSync', 'fsyncSync', 'renameSync'] as const) {
  const faultUserData = mkdtempSync(path.join(os.tmpdir(), `home-v2-journal-${operation}-`))
  const faultStore = createHomeV2TransactionJournalStore({
    ...fs,
    [operation]: () => { throw new Error(`injected ${operation} failure`) },
  } as unknown as typeof fs)
  assert.throws(() => faultStore.record(faultUserData, entry, now), new RegExp(operation))
  assert.deepEqual(readdirSync(faultUserData).filter((name) => name.includes('.tmp-')), [])
  assert.equal(existsSync(path.join(faultUserData, 'home-v2-pending-transactions.json')), false)
}

// A journal held by another live Home instance fails closed after a bounded
// wait rather than overwriting that instance's entries.
const contendedUserData = mkdtempSync(path.join(os.tmpdir(), 'home-v2-journal-contended-'))
const contendedLock = path.join(contendedUserData, 'home-v2-pending-transactions.json.lock')
writeFileSync(contendedLock, `${JSON.stringify({
  acquiredAt: Date.now(),
  host: os.hostname(),
  pid: process.pid,
  token: 'other-instance-token',
})}\n`, { encoding: 'utf8', mode: 0o600 })
let contendedElapsed = 0
const contendedStore = createHomeV2TransactionJournalStore(fs, {
  now: () => Date.now() + contendedElapsed,
  sleep: (milliseconds) => { contendedElapsed += milliseconds },
})
let contendedError: unknown
try {
  contendedStore.record(contendedUserData, entry, now)
} catch (error) {
  contendedError = error
}
assert.equal(isJournalLockedError(contendedError), true)
assert.equal((contendedError as { code: string }).code, HOME_JOURNAL_LOCKED_CODE)
assert.ok(contendedElapsed >= 10_000)
assert.equal(existsSync(path.join(contendedUserData, 'home-v2-pending-transactions.json')), false)
assert.equal(
  (JSON.parse(readFileSync(contendedLock, 'utf8')) as { token: string }).token,
  'other-instance-token',
)

// A lock left behind by an instance that is gone is taken over.
const staleLockUserData = mkdtempSync(path.join(os.tmpdir(), 'home-v2-journal-stale-lock-'))
const staleLock = path.join(staleLockUserData, 'home-v2-pending-transactions.json.lock')
writeFileSync(staleLock, `${JSON.stringify({
  acquiredAt: 1_000,
  host: os.hostname(),
  pid: 2 ** 31 - 1,
  token: 'dead-instance-token',
})}\n`, { encoding: 'utf8', mode: 0o600 })
recordHomeV2PendingTransaction(staleLockUserData, entry, now)
assert.equal(readHomeV2TransactionJournal(staleLockUserData, now).entries.length, 1)
assert.equal(existsSync(staleLock), false)

console.log('Home v2 pending transaction journal store tests passed')
