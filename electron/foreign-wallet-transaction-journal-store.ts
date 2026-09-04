import * as fs from 'node:fs'
import path from 'node:path'
import {
  FOREIGN_JOURNAL_LOCKED_CODE,
  withFileLock,
  writeDurableFile,
  type DurableFileOps,
  type JournalLockOptions,
} from './durable-json-file.js'
import {
  addSignedForeignWalletPendingTransaction,
  clearReconciledForeignWalletPendingTransaction,
  confirmForeignWalletBroadcastSuccess,
  createEmptyForeignWalletTransactionJournal,
  findForeignWalletPendingTransactionConflict,
  FOREIGN_WALLET_TRANSACTION_JOURNAL_MAX_BYTES,
  markForeignWalletBroadcastAttempted,
  normalizeConfirmedForeignWalletTransactionId,
  releaseNeverBroadcastForeignWalletPendingTransaction,
  sanitizeForeignWalletTransactionJournal,
  selectForeignWalletPendingTransactions,
  type ForeignWalletPendingTransaction,
} from './foreign-wallet-transaction-journal.js'

const STORE_FILE = 'home-v2-pending-foreign-transactions.json'

type ForeignWalletJournalFileOps = DurableFileOps

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A synchronous store keeps each read/check/write transition indivisible in
 * Electron's main process. Every transition additionally runs under a
 * cross-process lockfile, because two Home instances sharing one userData
 * directory would otherwise interleave read and write and let the later write
 * drop the earlier instance's entry, defeating the conflict check that gates a
 * broadcast. The injected operations exist for deterministic durability fault
 * tests; production uses Node's real filesystem operations.
 */
export function createForeignWalletTransactionJournalStore(
  fileOps: ForeignWalletJournalFileOps = fs,
  lockOptions: Omit<JournalLockOptions, 'code' | 'fileOps'> = {},
) {
  function storePath(userData: string) {
    return path.join(userData, STORE_FILE)
  }

  function withLock<T>(userData: string, run: () => T) {
    return withFileLock(storePath(userData), run, {
      ...lockOptions,
      code: FOREIGN_JOURNAL_LOCKED_CODE,
      fileOps,
    })
  }

  function readUnlocked(userData: string) {
    const target = storePath(userData)
    if (!fileOps.existsSync(target)) return createEmptyForeignWalletTransactionJournal()
    const raw = fileOps.readFileSync(target)
    if (raw.byteLength > FOREIGN_WALLET_TRANSACTION_JOURNAL_MAX_BYTES) {
      throw new Error('Pending foreign transaction journal exceeds its size limit.')
    }
    try {
      return sanitizeForeignWalletTransactionJournal(JSON.parse(raw.toString('utf8')))
    } catch (error) {
      throw new Error(`Pending foreign transaction journal is unreadable: ${errorMessage(error)}`)
    }
  }

  function read(userData: string) {
    // Reads feed conflict and reconciliation decisions that authorize a later
    // write, so they are taken under the same lock as the writes.
    return withLock(userData, () => readUnlocked(userData))
  }

  function write(userData: string, value: unknown) {
    const journal = sanitizeForeignWalletTransactionJournal(value)
    const raw = `${JSON.stringify(journal, null, 2)}\n`
    if (Buffer.byteLength(raw) > FOREIGN_WALLET_TRANSACTION_JOURNAL_MAX_BYTES) {
      throw new Error('Pending foreign transaction journal exceeds its size limit.')
    }
    const target = storePath(userData)
    if (!fileOps.existsSync(path.dirname(target))) {
      throw new Error('Pending foreign transaction journal directory is unavailable.')
    }
    // Fail closed if this platform/filesystem cannot prove durable rename
    // metadata. Foreign send remains disabled there until a native durable
    // store is supplied; silently weakening a financial WAL is not allowed.
    writeDurableFile(target, raw, { directorySync: 'required', fileOps, mode: 0o600 })
    return journal
  }

  function recordSigned(userData: string, entry: ForeignWalletPendingTransaction) {
    return withLock(userData, () => write(
      userData,
      addSignedForeignWalletPendingTransaction(readUnlocked(userData), entry),
    ))
  }

  function recordBroadcastAttempt(
    userData: string,
    input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'txId' | 'walletFingerprint'>,
    now = Date.now(),
  ) {
    return withLock(userData, () => write(
      userData,
      markForeignWalletBroadcastAttempted(readUnlocked(userData), input, now),
    ))
  }

  function confirmBroadcastSuccess(
    userData: string,
    input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'txId' | 'walletFingerprint'>,
    returnedTxId: unknown,
  ) {
    normalizeConfirmedForeignWalletTransactionId(input.txId, returnedTxId)
    try {
      withLock(userData, () => write(
        userData,
        confirmForeignWalletBroadcastSuccess(readUnlocked(userData), input, returnedTxId),
      ))
      return Object.freeze({ journalCleared: true as const })
    } catch (error) {
      // Core already returned the exact locally computed txid. Cleanup failure
      // must never turn that confirmed broadcast into a retryable send error.
      return Object.freeze({
        cleanupError: errorMessage(error),
        journalCleared: false as const,
      })
    }
  }

  function clearReconciled(
    userData: string,
    input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'txId' | 'walletFingerprint'>,
    observedTxId: unknown,
  ) {
    return withLock(userData, () => write(
      userData,
      clearReconciledForeignWalletPendingTransaction(readUnlocked(userData), input, observedTxId),
    ))
  }

  function releaseNeverBroadcast(
    userData: string,
    input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'txId' | 'walletFingerprint'>,
    now: number,
    minimumAgeMs: number,
  ) {
    return withLock(userData, () => write(
      userData,
      releaseNeverBroadcastForeignWalletPendingTransaction(readUnlocked(userData), input, now, minimumAgeMs),
    ))
  }

  function listPending(
    userData: string,
    input?: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'walletFingerprint'>,
  ) {
    return withLock(userData, () => {
      const journal = readUnlocked(userData)
      return input ? selectForeignWalletPendingTransactions(journal, input) : journal.entries
    })
  }

  function findConflict(
    userData: string,
    input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'outpoints' | 'walletFingerprint'>,
  ) {
    return withLock(userData, () => findForeignWalletPendingTransactionConflict(readUnlocked(userData), input))
  }

  return Object.freeze({
    clearReconciled,
    confirmBroadcastSuccess,
    findConflict,
    listPending,
    read,
    releaseNeverBroadcast,
    recordBroadcastAttempt,
    recordSigned,
  })
}

const DEFAULT_STORE = createForeignWalletTransactionJournalStore()

export const readForeignWalletTransactionJournal = DEFAULT_STORE.read
export const recordSignedForeignWalletPendingTransaction = DEFAULT_STORE.recordSigned
export const recordForeignWalletBroadcastAttempt = DEFAULT_STORE.recordBroadcastAttempt
export const confirmStoredForeignWalletBroadcastSuccess = DEFAULT_STORE.confirmBroadcastSuccess
export const findStoredForeignWalletPendingTransactionConflict = DEFAULT_STORE.findConflict
export const clearReconciledStoredForeignWalletPendingTransaction = DEFAULT_STORE.clearReconciled
export const listStoredForeignWalletPendingTransactions = DEFAULT_STORE.listPending
export const releaseNeverBroadcastStoredForeignWalletPendingTransaction = DEFAULT_STORE.releaseNeverBroadcast
