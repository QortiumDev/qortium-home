import type { ForeignWalletPendingTransaction } from './foreign-wallet-transaction-journal.js'

/**
 * Reading a retained foreign transaction's real fate back from the wallet's
 * own history.
 *
 * A retained entry means Home signed a transaction and could not prove what
 * happened to it: the broadcast timed out, the connection dropped, or the
 * node acknowledged something else. The entry then blocks that wallet's
 * outputs, which is correct and also a dead end unless something can settle
 * it. The only settlement Home accepts is the same one it accepts everywhere
 * else — the EXACT transaction id it computed itself, appearing in the
 * wallet's own transaction history as read from the trusted node.
 *
 * There is deliberately no "forget" that works without that proof. An entry
 * whose transaction cannot be found stays, and the send that found it refuses
 * and names it, because absence from a history read is not evidence the
 * transaction does not exist — the node may simply not have seen it yet.
 */

const MAX_HISTORY_ENTRIES = 10_000

/**
 * How old a never-broadcast entry must be before it is released, and the same
 * window a send's own approval must stay inside. Defined once so the two can
 * never drift: the release rule is only sound because a send older than this
 * would have been refused as stale anyway.
 */
export const FOREIGN_WALLET_SEND_FRESHNESS_MS = 10 * 60_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function canonicalTxId(value: unknown) {
  if (typeof value !== 'string') return ''
  const hex = value.trim().toLowerCase()
  return /^[0-9a-f]{64}$/.test(hex) ? hex : ''
}

/**
 * Core answers `/crosschain/<coin>/wallettransactions` with an array of
 * SimpleTransaction records whose identity field is `txHash`. Only that field,
 * only a canonical 32-byte hex value, and only an exact match counts: no
 * prefix matching, no other field, no coercion.
 */
export function foreignWalletHistoryContainsTransaction(history: unknown, txId: unknown): boolean {
  const wanted = canonicalTxId(txId)
  if (!wanted) throw new Error('Pending foreign transaction ID is invalid.')
  const rows = Array.isArray(history)
    ? history
    : isRecord(history) && Array.isArray(history.transactions)
      ? history.transactions
      : null
  if (!rows) throw new Error('The node answered the wallet history with an unusable shape.')
  if (rows.length > MAX_HISTORY_ENTRIES) {
    throw new Error('The node answered the wallet history with more entries than this wallet will scan.')
  }
  return rows.some((row) => isRecord(row) && canonicalTxId(row.txHash) === wanted)
}

export type ForeignWalletReleasedPendingTransaction = Readonly<{
  reason: 'signed-never-attempted'
  txId: string
}>

export type ForeignWalletReconciliationOutcome = Readonly<{
  cleared: readonly string[]
  released: readonly ForeignWalletReleasedPendingTransaction[]
  retained: readonly string[]
}>

export type ForeignWalletReconciliationDeps = Readonly<{
  clear(entry: ForeignWalletPendingTransaction, observedTxId: string): void
  now: number
  readHistory(): Promise<unknown>
  release(entry: ForeignWalletPendingTransaction): void
}>

/**
 * An entry still at stage 'signed' is one the broadcast-attempt mark never
 * reached disk for, and that mark is fsynced BEFORE the single broadcast POST
 * is issued. So the bytes were never sent, and they were never persisted
 * either — there is nothing that could turn up on the network later.
 *
 * The age guard is the whole safety of it: a second Home instance could be
 * mid-send right now, having recorded 'signed' and not yet marked the attempt.
 * Past the freshness window that send would have been refused as stale anyway,
 * so nothing live can be released out from under it.
 *
 * A 'broadcast-attempted' entry gets none of this. Its bytes DID leave, so the
 * only thing that settles it is finding that exact transaction in the wallet's
 * history.
 */
function isNeverBroadcast(entry: ForeignWalletPendingTransaction, now: number) {
  return entry.stage === 'signed' && now - entry.createdAt >= FOREIGN_WALLET_SEND_FRESHNESS_MS
}

export class HomeV2ForeignSendReconciliationPendingError extends Error {
  readonly code = 'FOREIGN_SEND_RECONCILIATION_REQUIRED'
}

/**
 * Settle what can be settled, then refuse if anything is left.
 *
 * The history is read ONCE for the whole set, not once per entry: a wallet
 * with several retained transactions must not turn one send into several
 * authenticated round trips.
 */
export async function reconcileForeignWalletPendingTransactions(
  pending: readonly ForeignWalletPendingTransaction[],
  deps: ForeignWalletReconciliationDeps,
): Promise<ForeignWalletReconciliationOutcome> {
  const released: ForeignWalletReleasedPendingTransaction[] = []
  const needsProof: ForeignWalletPendingTransaction[] = []
  for (const entry of pending) {
    if (isNeverBroadcast(entry, deps.now)) {
      deps.release(entry)
      released.push(Object.freeze({ reason: 'signed-never-attempted' as const, txId: entry.txId }))
    } else {
      needsProof.push(entry)
    }
  }
  // The history is read ONCE for the whole set, and only when something
  // actually needs proving: a wallet whose only entries were never broadcast
  // must not pay for an authenticated round trip to learn nothing.
  if (needsProof.length === 0) {
    return Object.freeze({
      cleared: Object.freeze([]),
      released: Object.freeze(released),
      retained: Object.freeze([]),
    })
  }
  const history = await deps.readHistory()
  const cleared: string[] = []
  const retained: string[] = []
  for (const entry of needsProof) {
    if (foreignWalletHistoryContainsTransaction(history, entry.txId)) {
      deps.clear(entry, entry.txId)
      cleared.push(entry.txId)
    } else {
      retained.push(entry.txId)
    }
  }
  return Object.freeze({
    cleared: Object.freeze(cleared),
    released: Object.freeze(released),
    retained: Object.freeze(retained),
  })
}

export function foreignWalletReconciliationRefusal(coin: string, retained: readonly string[]) {
  const list = retained.join(', ')
  return new HomeV2ForeignSendReconciliationPendingError(
    `A previously signed ${coin} transaction has an outcome Home cannot prove: `
    + `${list} ${retained.length === 1 ? 'is' : 'are'} not in this wallet's history on the connected node. `
    + 'Home will not sign another send for this wallet until that transaction appears (or the node catches '
    + 'up); it is never retried and never discarded on a guess.',
  )
}
