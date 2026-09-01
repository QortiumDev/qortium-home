import { registerPlugin } from '@capacitor/core'
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

  return Object.freeze({
    confirmBroadcastSuccess,
    findConflict,
    read,
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
