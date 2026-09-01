import * as fs from 'node:fs'
import path from 'node:path'
import {
  addSignedForeignWalletPendingTransaction,
  confirmForeignWalletBroadcastSuccess,
  createEmptyForeignWalletTransactionJournal,
  findForeignWalletPendingTransactionConflict,
  FOREIGN_WALLET_TRANSACTION_JOURNAL_MAX_BYTES,
  markForeignWalletBroadcastAttempted,
  normalizeConfirmedForeignWalletTransactionId,
  sanitizeForeignWalletTransactionJournal,
  type ForeignWalletPendingTransaction,
} from './foreign-wallet-transaction-journal.js'

const STORE_FILE = 'home-v2-pending-foreign-transactions.json'

type ForeignWalletJournalFileOps = Pick<typeof fs,
  | 'closeSync'
  | 'existsSync'
  | 'fsyncSync'
  | 'openSync'
  | 'readFileSync'
  | 'renameSync'
  | 'rmSync'
  | 'writeFileSync'
>

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A synchronous store keeps each read/check/write transition indivisible in
 * Electron's main process. The injected operations exist for deterministic
 * durability fault tests; production uses Node's real filesystem operations.
 */
export function createForeignWalletTransactionJournalStore(
  fileOps: ForeignWalletJournalFileOps = fs,
) {
  function storePath(userData: string) {
    return path.join(userData, STORE_FILE)
  }

  function read(userData: string) {
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

  function syncDirectory(directory: string) {
    const descriptor = fileOps.openSync(directory, 'r')
    try {
      fileOps.fsyncSync(descriptor)
    } finally {
      fileOps.closeSync(descriptor)
    }
  }

  function write(userData: string, value: unknown) {
    const journal = sanitizeForeignWalletTransactionJournal(value)
    const raw = `${JSON.stringify(journal, null, 2)}\n`
    if (Buffer.byteLength(raw) > FOREIGN_WALLET_TRANSACTION_JOURNAL_MAX_BYTES) {
      throw new Error('Pending foreign transaction journal exceeds its size limit.')
    }
    const target = storePath(userData)
    const directory = path.dirname(target)
    const staging = `${target}.tmp-${process.pid}-${process.hrtime.bigint()}`
    if (!fileOps.existsSync(directory)) {
      throw new Error('Pending foreign transaction journal directory is unavailable.')
    }
    let descriptor: number | undefined
    try {
      descriptor = fileOps.openSync(staging, 'wx', 0o600)
      fileOps.writeFileSync(descriptor, raw, { encoding: 'utf8' })
      fileOps.fsyncSync(descriptor)
      const writtenDescriptor = descriptor
      descriptor = undefined
      fileOps.closeSync(writtenDescriptor)
      fileOps.renameSync(staging, target)
      // Fail closed if this platform/filesystem cannot prove durable rename
      // metadata. Foreign send remains disabled there until a native durable
      // store is supplied; silently weakening a financial WAL is not allowed.
      syncDirectory(directory)
    } finally {
      if (descriptor !== undefined) fileOps.closeSync(descriptor)
      fileOps.rmSync(staging, { force: true })
    }
    return journal
  }

  function recordSigned(userData: string, entry: ForeignWalletPendingTransaction) {
    return write(
      userData,
      addSignedForeignWalletPendingTransaction(read(userData), entry),
    )
  }

  function recordBroadcastAttempt(
    userData: string,
    input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'txId' | 'walletFingerprint'>,
    now = Date.now(),
  ) {
    return write(
      userData,
      markForeignWalletBroadcastAttempted(read(userData), input, now),
    )
  }

  function confirmBroadcastSuccess(
    userData: string,
    input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'txId' | 'walletFingerprint'>,
    returnedTxId: unknown,
  ) {
    normalizeConfirmedForeignWalletTransactionId(input.txId, returnedTxId)
    try {
      const next = confirmForeignWalletBroadcastSuccess(read(userData), input, returnedTxId)
      write(userData, next)
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

  function findConflict(
    userData: string,
    input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'outpoints' | 'walletFingerprint'>,
  ) {
    return findForeignWalletPendingTransactionConflict(read(userData), input)
  }

  return Object.freeze({
    confirmBroadcastSuccess,
    findConflict,
    read,
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
