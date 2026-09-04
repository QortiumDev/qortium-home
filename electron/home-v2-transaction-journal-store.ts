import * as fs from 'node:fs'
import path from 'node:path'
import {
  HOME_JOURNAL_LOCKED_CODE,
  withFileLock,
  writeDurableFile,
  type DurableFileOps,
  type JournalLockOptions,
} from './durable-json-file.js'
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

type HomeV2JournalFileOps = DurableFileOps & Pick<typeof fs, 'mkdirSync'>

/**
 * The native (Qortal-family) pending transaction journal. It is the same shape
 * of write-ahead log as the foreign wallet one: a read-modify-write whose
 * result decides whether a later payment is treated as a duplicate. It gets
 * the same durable write and the same cross-process lockfile, so two Home
 * instances on one userData directory cannot drop each other's entries.
 *
 * The one deliberate difference is the parent directory flush. The foreign
 * journal fails closed when a platform cannot flush directory metadata,
 * because nothing there may proceed toward a broadcast without proof. Here the
 * journal records an already-signed transaction for duplicate detection rather
 * than authorizing the spend, so a platform that cannot open a directory
 * handle (Windows) keeps working on the atomic rename alone instead of losing
 * native sends entirely.
 */
export function createHomeV2TransactionJournalStore(
  fileOps: HomeV2JournalFileOps = fs,
  lockOptions: Omit<JournalLockOptions, 'code' | 'fileOps'> = {},
) {
  function storePath(userData: string) {
    return path.join(userData, STORE_FILE)
  }

  function withLock<T>(userData: string, run: () => T) {
    return withFileLock(storePath(userData), run, {
      ...lockOptions,
      code: HOME_JOURNAL_LOCKED_CODE,
      fileOps,
    })
  }

  function readUnlocked(userData: string, now: number) {
    const target = storePath(userData)
    if (!fileOps.existsSync(target)) return createEmptyHomeV2TransactionJournal()
    const raw = fileOps.readFileSync(target)
    if (raw.byteLength > HOME_V2_TRANSACTION_JOURNAL_MAX_BYTES) {
      throw new Error('Pending transaction journal exceeds its size limit.')
    }
    try {
      return sanitizeHomeV2TransactionJournal(JSON.parse(raw.toString('utf8')), now)
    } catch (error) {
      throw new Error(`Pending transaction journal is unreadable: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function read(userData: string, now = Date.now()) {
    return withLock(userData, () => readUnlocked(userData, now))
  }

  function write(userData: string, value: unknown, now: number) {
    const journal = sanitizeHomeV2TransactionJournal(value, now)
    const raw = `${JSON.stringify(journal, null, 2)}\n`
    if (Buffer.byteLength(raw) > HOME_V2_TRANSACTION_JOURNAL_MAX_BYTES) {
      throw new Error('Pending transaction journal exceeds its size limit.')
    }
    const target = storePath(userData)
    fileOps.mkdirSync(path.dirname(target), { recursive: true })
    writeDurableFile(target, raw, { directorySync: 'best-effort', fileOps, mode: 0o600 })
    return journal
  }

  function record(userData: string, entry: HomeV2PendingTransaction, now = Date.now()) {
    return withLock(userData, () => write(
      userData,
      upsertHomeV2PendingTransaction(readUnlocked(userData, now), entry, now),
      now,
    ))
  }

  function listPending(
    userData: string,
    input: Parameters<typeof getHomeV2PendingTransactions>[1],
    now = Date.now(),
  ) {
    return withLock(userData, () => getHomeV2PendingTransactions(readUnlocked(userData, now), input, now))
  }

  function forget(
    userData: string,
    input: Parameters<typeof removeHomeV2PendingTransaction>[1],
    now = Date.now(),
  ) {
    return withLock(userData, () => {
      const current = readUnlocked(userData, now)
      const next = removeHomeV2PendingTransaction(current, input, now)
      const removed = next.entries.length !== current.entries.length
      write(userData, next, now)
      return removed
    })
  }

  function findConflict(
    userData: string,
    input: Parameters<typeof findHomeV2PendingTransactionConflict>[1],
    now = Date.now(),
  ) {
    return withLock(
      userData,
      () => findHomeV2PendingTransactionConflict(readUnlocked(userData, now), input, now),
    )
  }

  return Object.freeze({ findConflict, forget, listPending, read, record })
}

const DEFAULT_STORE = createHomeV2TransactionJournalStore()

export const readHomeV2TransactionJournal = DEFAULT_STORE.read
export const recordHomeV2PendingTransaction = DEFAULT_STORE.record
export const listHomeV2PendingTransactions = DEFAULT_STORE.listPending
export const forgetHomeV2PendingTransaction = DEFAULT_STORE.forget
export const findStoredHomeV2PendingTransactionConflict = DEFAULT_STORE.findConflict
