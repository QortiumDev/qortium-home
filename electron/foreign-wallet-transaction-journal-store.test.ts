import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  FOREIGN_JOURNAL_LOCKED_CODE,
  isJournalLockedError,
} from './durable-json-file.js'
import { getForeignWalletMainnetChainId } from './foreign-wallet-spend-context.js'
import {
  confirmStoredForeignWalletBroadcastSuccess,
  createForeignWalletTransactionJournalStore,
  findStoredForeignWalletPendingTransactionConflict,
  readForeignWalletTransactionJournal,
  recordForeignWalletBroadcastAttempt,
  recordSignedForeignWalletPendingTransaction,
} from './foreign-wallet-transaction-journal-store.js'
import {
  FOREIGN_WALLET_TRANSACTION_JOURNAL_MAX_BYTES,
  type ForeignWalletPendingTransaction,
} from './foreign-wallet-transaction-journal.js'

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'home-v2-foreign-journal-'))
const store = path.join(userData, 'home-v2-pending-foreign-transactions.json')
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

assert.equal(readForeignWalletTransactionJournal(userData).entries.length, 0)
recordSignedForeignWalletPendingTransaction(userData, {
  ...entry,
  address: 'address-secret-sentinel',
  derivationPath: 'path-secret-sentinel',
  previousTransactionHex: 'previous-secret-sentinel',
  privateKey: 'private-secret-sentinel',
  rawTransactionHex: 'raw-secret-sentinel',
  seed: 'seed-secret-sentinel',
  xpub58: 'xpub-secret-sentinel',
} as ForeignWalletPendingTransaction)
assert.equal(fs.statSync(store).mode & 0o777, 0o600)
const stored = fs.readFileSync(store, 'utf8')
assert.equal(stored.includes('raw-secret-sentinel'), false)
assert.equal(stored.includes('xpub-secret-sentinel'), false)
assert.equal(stored.includes('secret-sentinel'), false)
assert.equal(readForeignWalletTransactionJournal(userData).entries[0].stage, 'signed')
assert.equal(findStoredForeignWalletPendingTransactionConflict(userData, {
  chainId: entry.chainId,
  coin: entry.coin,
  outpoints: entry.outpoints,
  walletFingerprint: entry.walletFingerprint,
})?.txId, entry.txId)

recordForeignWalletBroadcastAttempt(userData, entry, now + 1)
assert.equal(readForeignWalletTransactionJournal(userData).entries[0].stage, 'broadcast-attempted')
assert.throws(
  () => confirmStoredForeignWalletBroadcastSuccess(userData, entry, '55'.repeat(32)),
  /did not match/,
)
assert.equal(readForeignWalletTransactionJournal(userData).entries.length, 1)
confirmStoredForeignWalletBroadcastSuccess(userData, entry, entry.txId)
assert.equal(readForeignWalletTransactionJournal(userData).entries.length, 0)

fs.writeFileSync(store, '{not-json', 'utf8')
assert.throws(() => readForeignWalletTransactionJournal(userData), /unreadable/)

const invalidUserData = path.join(userData, 'not-a-directory')
fs.writeFileSync(invalidUserData, 'occupied', 'utf8')
assert.throws(
  () => recordSignedForeignWalletPendingTransaction(invalidUserData, entry),
)

const renameFailureUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'home-v2-foreign-journal-rename-'))
fs.mkdirSync(path.join(renameFailureUserData, 'home-v2-pending-foreign-transactions.json'))
assert.throws(() => recordSignedForeignWalletPendingTransaction(renameFailureUserData, entry))
assert.deepEqual(
  fs.readdirSync(renameFailureUserData).filter((name) => name.includes('.tmp-')),
  [],
)

const ancientUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'home-v2-foreign-journal-ancient-'))
const ancientEntry = { ...entry, createdAt: 1, txId: '66'.repeat(32) }
recordSignedForeignWalletPendingTransaction(ancientUserData, ancientEntry)
recordForeignWalletBroadcastAttempt(ancientUserData, ancientEntry, now)
assert.equal(readForeignWalletTransactionJournal(ancientUserData).entries[0].createdAt, 1)
assert.equal(readForeignWalletTransactionJournal(ancientUserData).entries[0].stage, 'broadcast-attempted')
assert.throws(
  () => recordForeignWalletBroadcastAttempt(ancientUserData, ancientEntry, now + 1),
  /already attempted/,
)

for (const operation of ['writeFileSync', 'fsyncSync', 'renameSync'] as const) {
  const faultUserData = fs.mkdtempSync(path.join(os.tmpdir(), `home-v2-foreign-journal-${operation}-`))
  const faultOps = {
    ...fs,
    [operation]: (..._arguments: unknown[]) => {
      throw new Error(`injected ${operation} failure`)
    },
  }
  const faultStore = createForeignWalletTransactionJournalStore(faultOps as typeof fs)
  assert.throws(() => faultStore.recordSigned(faultUserData, entry), new RegExp(operation))
  assert.deepEqual(fs.readdirSync(faultUserData).filter((name) => name.includes('.tmp-')), [])
}

const directorySyncUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'home-v2-foreign-journal-dir-fsync-'))
let syncCount = 0
const directorySyncFaultStore = createForeignWalletTransactionJournalStore({
  ...fs,
  fsyncSync: (descriptor) => {
    syncCount += 1
    if (syncCount === 2) throw new Error('injected directory fsync failure')
    fs.fsyncSync(descriptor)
  },
})
assert.throws(
  () => directorySyncFaultStore.recordSigned(directorySyncUserData, entry),
  /directory fsync/,
)
// Rename happened before the directory flush failed, so the conservative entry
// may exist. Crucially, the call did not authorize a later broadcast.
assert.equal(readForeignWalletTransactionJournal(directorySyncUserData).entries.length, 1)

const cleanupUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'home-v2-foreign-journal-cleanup-'))
recordSignedForeignWalletPendingTransaction(cleanupUserData, entry)
recordForeignWalletBroadcastAttempt(cleanupUserData, entry, now + 1)
const cleanupFaultStore = createForeignWalletTransactionJournalStore({
  ...fs,
  renameSync: () => { throw new Error('injected cleanup rename failure') },
})
assert.deepEqual(cleanupFaultStore.confirmBroadcastSuccess(cleanupUserData, entry, entry.txId), {
  cleanupError: 'injected cleanup rename failure',
  journalCleared: false,
})
assert.equal(readForeignWalletTransactionJournal(cleanupUserData).entries.length, 1)

const missingAfterConfirmUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'home-v2-foreign-journal-missing-'))
assert.deepEqual(
  confirmStoredForeignWalletBroadcastSuccess(missingAfterConfirmUserData, entry, entry.txId),
  { cleanupError: 'Pending foreign transaction was not found.', journalCleared: false },
)
const corruptAfterConfirmUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'home-v2-foreign-journal-corrupt-'))
fs.writeFileSync(
  path.join(corruptAfterConfirmUserData, 'home-v2-pending-foreign-transactions.json'),
  '{not-json',
  'utf8',
)
const corruptCleanup = confirmStoredForeignWalletBroadcastSuccess(corruptAfterConfirmUserData, entry, entry.txId)
assert.equal(corruptCleanup.journalCleared, false)
assert.match('cleanupError' in corruptCleanup ? corruptCleanup.cleanupError : '', /unreadable/)
assert.throws(
  () => confirmStoredForeignWalletBroadcastSuccess(corruptAfterConfirmUserData, entry, '55'.repeat(32)),
  /did not match/,
)
const oversizedAfterConfirmUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'home-v2-foreign-journal-oversized-'))
fs.writeFileSync(
  path.join(oversizedAfterConfirmUserData, 'home-v2-pending-foreign-transactions.json'),
  Buffer.alloc(FOREIGN_WALLET_TRANSACTION_JOURNAL_MAX_BYTES + 1),
)
const oversizedCleanup = confirmStoredForeignWalletBroadcastSuccess(oversizedAfterConfirmUserData, entry, entry.txId)
assert.equal(oversizedCleanup.journalCleared, false)
assert.match('cleanupError' in oversizedCleanup ? oversizedCleanup.cleanupError : '', /size limit/)

const byteLimitUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'home-v2-foreign-journal-bytes-'))
const byteLimitStore = path.join(byteLimitUserData, 'home-v2-pending-foreign-transactions.json')
const entries: ForeignWalletPendingTransaction[] = []
let priorRaw = ''
let overflowEntry: ForeignWalletPendingTransaction | undefined
for (let index = 0; index < 200; index += 1) {
  const candidate = {
    ...entry,
    appIdentity: `app-${index}-${'x'.repeat(2_000)}`,
    outpoints: Array.from({ length: 100 }, (_value, outputIndex) => ({
      outputIndex,
      txHash: (index * 100 + outputIndex + 1).toString(16).padStart(64, '0'),
    })),
    txId: (index + 1).toString(16).padStart(64, '0'),
  }
  const candidateRaw = `${JSON.stringify({ entries: [...entries, candidate], version: 1 }, null, 2)}\n`
  if (Buffer.byteLength(candidateRaw) > FOREIGN_WALLET_TRANSACTION_JOURNAL_MAX_BYTES) {
    overflowEntry = candidate
    break
  }
  entries.push(candidate)
  priorRaw = candidateRaw
}
assert.ok(priorRaw)
assert.ok(overflowEntry)
fs.writeFileSync(byteLimitStore, priorRaw, { encoding: 'utf8', mode: 0o600 })
assert.equal(readForeignWalletTransactionJournal(byteLimitUserData).entries.length, entries.length)
assert.throws(
  () => recordSignedForeignWalletPendingTransaction(byteLimitUserData, overflowEntry as ForeignWalletPendingTransaction),
  /size limit/,
)
assert.equal(fs.readFileSync(byteLimitStore, 'utf8'), priorRaw)

// A journal held by another live Home instance fails closed with the coded
// error after a bounded wait, and never records a signed transaction.
const contendedUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'home-v2-foreign-journal-contended-'))
const contendedLock = path.join(contendedUserData, 'home-v2-pending-foreign-transactions.json.lock')
fs.writeFileSync(contendedLock, `${JSON.stringify({
  acquiredAt: Date.now(),
  host: os.hostname(),
  pid: process.pid,
  token: 'other-instance-token',
})}\n`, { encoding: 'utf8', mode: 0o600 })
let contendedElapsed = 0
const contendedStore = createForeignWalletTransactionJournalStore(fs, {
  now: () => Date.now() + contendedElapsed,
  sleep: (milliseconds) => { contendedElapsed += milliseconds },
})
let contendedError: unknown
try {
  contendedStore.recordSigned(contendedUserData, entry)
} catch (error) {
  contendedError = error
}
assert.equal(isJournalLockedError(contendedError), true)
assert.equal((contendedError as { code: string }).code, FOREIGN_JOURNAL_LOCKED_CODE)
assert.ok(contendedElapsed >= 10_000)
assert.equal(
  fs.existsSync(path.join(contendedUserData, 'home-v2-pending-foreign-transactions.json')),
  false,
)
// The other instance still holds its lock.
assert.equal(
  (JSON.parse(fs.readFileSync(contendedLock, 'utf8')) as { token: string }).token,
  'other-instance-token',
)

// A lock left behind by a Home instance that is gone is taken over, so a
// crashed instance cannot wedge sending forever.
const staleLockUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'home-v2-foreign-journal-stale-lock-'))
const staleLock = path.join(staleLockUserData, 'home-v2-pending-foreign-transactions.json.lock')
fs.writeFileSync(staleLock, `${JSON.stringify({
  acquiredAt: 1_000,
  host: os.hostname(),
  pid: 2 ** 31 - 1,
  token: 'dead-instance-token',
})}\n`, { encoding: 'utf8', mode: 0o600 })
recordSignedForeignWalletPendingTransaction(staleLockUserData, entry)
assert.equal(readForeignWalletTransactionJournal(staleLockUserData).entries.length, 1)
assert.equal(fs.existsSync(staleLock), false)

console.log('Foreign wallet transaction journal store tests passed.')
