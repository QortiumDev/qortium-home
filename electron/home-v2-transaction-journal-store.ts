import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  createEmptyHomeV2TransactionJournal,
  findHomeV2PendingTransactionConflict,
  getHomeV2PendingTransactions,
  HOME_V2_TRANSACTION_JOURNAL_MAX_BYTES,
  removeHomeV2PendingTransaction,
  sanitizeHomeV2TransactionJournal,
  upsertHomeV2PendingTransaction,
  type HomeV2PendingTransaction,
} from './home-v2-transaction-journal.js'

const STORE_FILE = 'home-v2-pending-transactions.json'

function storePath(userData: string) {
  return path.join(userData, STORE_FILE)
}

export function readHomeV2TransactionJournal(userData: string, now = Date.now()) {
  const target = storePath(userData)
  if (!existsSync(target)) return createEmptyHomeV2TransactionJournal()
  const raw = readFileSync(target)
  if (raw.byteLength > HOME_V2_TRANSACTION_JOURNAL_MAX_BYTES) {
    throw new Error('Pending transaction journal exceeds its size limit.')
  }
  try {
    return sanitizeHomeV2TransactionJournal(JSON.parse(raw.toString('utf8')), now)
  } catch (error) {
    throw new Error(`Pending transaction journal is unreadable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function writeHomeV2TransactionJournal(userData: string, value: unknown, now = Date.now()) {
  const journal = sanitizeHomeV2TransactionJournal(value, now)
  const raw = `${JSON.stringify(journal, null, 2)}\n`
  if (Buffer.byteLength(raw) > HOME_V2_TRANSACTION_JOURNAL_MAX_BYTES) {
    throw new Error('Pending transaction journal exceeds its size limit.')
  }
  const target = storePath(userData)
  const staging = `${target}.tmp-${process.pid}`
  mkdirSync(path.dirname(target), { recursive: true })
  try {
    writeFileSync(staging, raw, { encoding: 'utf8', mode: 0o600 })
    renameSync(staging, target)
  } finally {
    rmSync(staging, { force: true })
  }
  return journal
}

export function recordHomeV2PendingTransaction(
  userData: string,
  entry: HomeV2PendingTransaction,
  now = Date.now(),
) {
  return writeHomeV2TransactionJournal(
    userData,
    upsertHomeV2PendingTransaction(readHomeV2TransactionJournal(userData, now), entry, now),
    now,
  )
}

export function listHomeV2PendingTransactions(
  userData: string,
  input: Parameters<typeof getHomeV2PendingTransactions>[1],
  now = Date.now(),
) {
  return getHomeV2PendingTransactions(readHomeV2TransactionJournal(userData, now), input, now)
}

export function forgetHomeV2PendingTransaction(
  userData: string,
  input: Parameters<typeof removeHomeV2PendingTransaction>[1],
  now = Date.now(),
) {
  const current = readHomeV2TransactionJournal(userData, now)
  const next = removeHomeV2PendingTransaction(current, input, now)
  const removed = next.entries.length !== current.entries.length
  writeHomeV2TransactionJournal(userData, next, now)
  return removed
}

export function findStoredHomeV2PendingTransactionConflict(
  userData: string,
  input: Parameters<typeof findHomeV2PendingTransactionConflict>[1],
  now = Date.now(),
) {
  return findHomeV2PendingTransactionConflict(readHomeV2TransactionJournal(userData, now), input, now)
}
