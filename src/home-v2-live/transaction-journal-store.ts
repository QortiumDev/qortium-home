import { Preferences } from '@capacitor/preferences'
import {
  createEmptyHomeV2TransactionJournal,
  findHomeV2PendingTransactionConflict,
  getHomeV2PendingTransactions,
  HOME_V2_TRANSACTION_JOURNAL_MAX_BYTES,
  removeHomeV2PendingTransaction,
  sanitizeHomeV2TransactionJournal,
  upsertHomeV2PendingTransaction,
  type HomeV2PendingTransaction,
  type HomeV2TransactionJournal,
} from '../../electron/home-v2-transaction-journal'

const STORE_KEY = 'qortium-home-v2-pending-transactions'
let writeChain = Promise.resolve()

async function readJournal(now = Date.now()): Promise<HomeV2TransactionJournal> {
  const raw = (await Preferences.get({ key: STORE_KEY })).value
  if (!raw) return createEmptyHomeV2TransactionJournal()
  if (new TextEncoder().encode(raw).byteLength > HOME_V2_TRANSACTION_JOURNAL_MAX_BYTES) {
    throw new Error('Pending transaction journal exceeds its size limit.')
  }
  try {
    return sanitizeHomeV2TransactionJournal(JSON.parse(raw), now)
  } catch (error) {
    throw new Error(`Pending transaction journal is unreadable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function mutateJournal(
  mutate: (journal: HomeV2TransactionJournal) => HomeV2TransactionJournal,
  now = Date.now(),
) {
  const operation = writeChain.then(async () => {
    const next = sanitizeHomeV2TransactionJournal(mutate(await readJournal(now)), now)
    const raw = JSON.stringify(next)
    if (new TextEncoder().encode(raw).byteLength > HOME_V2_TRANSACTION_JOURNAL_MAX_BYTES) {
      throw new Error('Pending transaction journal exceeds its size limit.')
    }
    await Preferences.set({ key: STORE_KEY, value: raw })
    return next
  })
  writeChain = operation.then(() => undefined, () => undefined)
  return operation
}

export function recordAndroidHomeV2PendingTransaction(entry: HomeV2PendingTransaction, now = Date.now()) {
  return mutateJournal((journal) => upsertHomeV2PendingTransaction(journal, entry, now), now)
}

export async function listAndroidHomeV2PendingTransactions(
  input: Parameters<typeof getHomeV2PendingTransactions>[1],
  now = Date.now(),
) {
  await writeChain
  return getHomeV2PendingTransactions(await readJournal(now), input, now)
}

export async function forgetAndroidHomeV2PendingTransaction(
  input: Parameters<typeof removeHomeV2PendingTransaction>[1],
  now = Date.now(),
) {
  let removed = false
  await mutateJournal((journal) => {
    const next = removeHomeV2PendingTransaction(journal, input, now)
    removed = next.entries.length !== journal.entries.length
    return next
  }, now)
  return removed
}

export async function findAndroidHomeV2PendingTransactionConflict(
  input: Parameters<typeof findHomeV2PendingTransactionConflict>[1],
  now = Date.now(),
) {
  await writeChain
  return findHomeV2PendingTransactionConflict(await readJournal(now), input, now)
}
