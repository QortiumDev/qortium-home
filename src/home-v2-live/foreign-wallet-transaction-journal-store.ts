import { registerPlugin } from '@capacitor/core'
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
  type ForeignWalletTransactionJournal,
} from '../../electron/foreign-wallet-transaction-journal'

interface HomeV2ForeignWalletJournalPlugin {
  read(): Promise<{ value: string | null }>
  write(request: { value: string }): Promise<void>
}

const HomeV2ForeignWalletJournal = registerPlugin<HomeV2ForeignWalletJournalPlugin>(
  'HomeV2ForeignWalletJournal',
)

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function encodedLength(value: string) {
  return new TextEncoder().encode(value).byteLength
}

/**
 * Android uses a dedicated AtomicFile-backed native plugin for this WAL.
 * Capacitor Preferences is intentionally not used: a broadcast gate needs an
 * atomic, synchronously flushed write, not a best-effort preference update.
 *
 * The desktop store additionally holds a cross-process lockfile around every
 * read-modify-write, because two Home instances can be pointed at one userData
 * directory. Android needs no such lock. The journal lives in the app's
 * private files directory, which is reachable only by this app's uid, and
 * Android runs the app in a single process: a second launch resumes the same
 * process rather than starting another one that could interleave writes. The
 * remaining concurrency is in-process, and it is closed twice over: `mutate`
 * serializes read-then-write through `writeChain`, and the native plugin
 * serializes `read` and `write` on one static monitor, so no two Capacitor
 * calls can be inside the file at the same moment. If this WAL is ever reached
 * from a second Android process (a separate `:remote` service process, or a
 * work-profile clone with a shared data directory), the plugin would need the
 * same lockfile discipline before that is allowed.
 */
export function createAndroidForeignWalletTransactionJournalStore(
  plugin: HomeV2ForeignWalletJournalPlugin = HomeV2ForeignWalletJournal,
) {
  let writeChain = Promise.resolve()

  async function readRaw(): Promise<ForeignWalletTransactionJournal> {
    const raw = (await plugin.read()).value
    if (raw === null) return createEmptyForeignWalletTransactionJournal()
    if (encodedLength(raw) > FOREIGN_WALLET_TRANSACTION_JOURNAL_MAX_BYTES) {
      throw new Error('Pending foreign transaction journal exceeds its size limit.')
    }
    try {
      return sanitizeForeignWalletTransactionJournal(JSON.parse(raw))
    } catch (error) {
      throw new Error(`Pending foreign transaction journal is unreadable: ${errorMessage(error)}`)
    }
  }

  async function writeRaw(value: unknown) {
    const journal = sanitizeForeignWalletTransactionJournal(value)
    const raw = JSON.stringify(journal)
    if (encodedLength(raw) > FOREIGN_WALLET_TRANSACTION_JOURNAL_MAX_BYTES) {
      throw new Error('Pending foreign transaction journal exceeds its size limit.')
    }
    await plugin.write({ value: raw })
    return journal
  }

  function mutate(
    operation: (journal: ForeignWalletTransactionJournal) => ForeignWalletTransactionJournal,
  ) {
    const pending = writeChain.then(async () => writeRaw(operation(await readRaw())))
    writeChain = pending.then(() => undefined, () => undefined)
    return pending
  }

  async function read() {
    await writeChain
    return readRaw()
  }

  function recordSigned(entry: ForeignWalletPendingTransaction) {
    return mutate((journal) => addSignedForeignWalletPendingTransaction(journal, entry))
  }

  function recordBroadcastAttempt(
    input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'txId' | 'walletFingerprint'>,
    now = Date.now(),
  ) {
    return mutate((journal) => markForeignWalletBroadcastAttempted(journal, input, now))
  }

  async function confirmBroadcastSuccess(
    input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'txId' | 'walletFingerprint'>,
    returnedTxId: unknown,
  ) {
    normalizeConfirmedForeignWalletTransactionId(input.txId, returnedTxId)
    try {
      await mutate((journal) => confirmForeignWalletBroadcastSuccess(journal, input, returnedTxId))
      return Object.freeze({ journalCleared: true as const })
    } catch (error) {
      // The exact locally computed txid already came back from Core. A native
      // cleanup failure must retain the WAL without making the send retryable.
      return Object.freeze({
        cleanupError: errorMessage(error),
        journalCleared: false as const,
      })
    }
  }

  async function findConflict(
    input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'outpoints' | 'walletFingerprint'>,
  ) {
    await writeChain
    return findForeignWalletPendingTransactionConflict(await readRaw(), input)
  }

  async function listPending(
    input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'walletFingerprint'>,
  ) {
    await writeChain
    return selectForeignWalletPendingTransactions(await readRaw(), input)
  }

  function clearReconciled(
    input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'txId' | 'walletFingerprint'>,
    observedTxId: string,
  ) {
    return mutate((journal) => clearReconciledForeignWalletPendingTransaction(
      journal,
      input,
      observedTxId,
    ))
  }

  function releaseNeverBroadcast(
    input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'txId' | 'walletFingerprint'>,
    now: number,
    minimumAgeMs: number,
  ) {
    return mutate((journal) => releaseNeverBroadcastForeignWalletPendingTransaction(
      journal,
      input,
      now,
      minimumAgeMs,
    ))
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

const DEFAULT_STORE = createAndroidForeignWalletTransactionJournalStore()

export const readAndroidForeignWalletTransactionJournal = DEFAULT_STORE.read
export const recordAndroidSignedForeignWalletPendingTransaction = DEFAULT_STORE.recordSigned
export const recordAndroidForeignWalletBroadcastAttempt = DEFAULT_STORE.recordBroadcastAttempt
export const confirmAndroidForeignWalletBroadcastSuccess = DEFAULT_STORE.confirmBroadcastSuccess
export const findAndroidForeignWalletPendingTransactionConflict = DEFAULT_STORE.findConflict
export const clearReconciledAndroidForeignWalletPendingTransaction = DEFAULT_STORE.clearReconciled
export const listAndroidForeignWalletPendingTransactions = DEFAULT_STORE.listPending
export const releaseNeverBroadcastAndroidForeignWalletPendingTransaction = DEFAULT_STORE.releaseNeverBroadcast
