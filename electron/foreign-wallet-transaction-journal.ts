import type { ForeignWalletCoin } from './foreign-wallets.js'
import { getForeignWalletMainnetChainId } from './foreign-wallet-spend-context.js'

export type ForeignWalletPendingStage = 'signed' | 'broadcast-attempted'

export type ForeignWalletPendingOutpoint = Readonly<{
  outputIndex: number
  txHash: string
}>

export type ForeignWalletPendingTransaction = Readonly<{
  appIdentity: string
  broadcastAttemptedAt?: number
  chainId: string
  coin: ForeignWalletCoin
  createdAt: number
  outpoints: readonly ForeignWalletPendingOutpoint[]
  stage: ForeignWalletPendingStage
  txId: string
  walletFingerprint: string
}>

export type ForeignWalletTransactionJournal = Readonly<{
  entries: readonly ForeignWalletPendingTransaction[]
  version: 1
}>

export const FOREIGN_WALLET_TRANSACTION_JOURNAL_MAX_BYTES = 512 * 1024
export const FOREIGN_WALLET_TRANSACTION_JOURNAL_MAX_ENTRIES = 256
export const FOREIGN_WALLET_TRANSACTION_JOURNAL_MAX_OUTPOINTS = 1_000

const COINS = new Set<ForeignWalletCoin>([
  'BTC',
  'DASH',
  'DGB',
  'DOGE',
  'FIRO',
  'LTC',
  'NMC',
  'RVN',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function boundedString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength
    || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value.trim()
}

function canonicalHex(value: unknown, bytes: number, label: string) {
  const hex = boundedString(value, label, bytes * 2).toLowerCase()
  if (hex.length !== bytes * 2 || !/^[0-9a-f]+$/.test(hex)) {
    throw new Error(`${label} is invalid.`)
  }
  return hex
}

function canonicalChainId(value: unknown) {
  const chainId = boundedString(value, 'Pending foreign transaction chain ID', 39).toLowerCase()
  if (!/^bip122:[0-9a-f]{32}$/.test(chainId)) {
    throw new Error('Pending foreign transaction chain ID is invalid.')
  }
  return chainId
}

function safeTimestamp(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} is invalid.`)
  return Number(value)
}

function canonicalCoin(value: unknown): ForeignWalletCoin {
  const coin = typeof value === 'string' ? value.trim().toUpperCase() as ForeignWalletCoin : '' as ForeignWalletCoin
  if (!COINS.has(coin)) throw new Error('Pending foreign transaction coin is invalid.')
  return coin
}

function canonicalOutpoint(value: unknown): ForeignWalletPendingOutpoint {
  if (!isRecord(value) || !Number.isSafeInteger(value.outputIndex)
    || Number(value.outputIndex) < 0 || Number(value.outputIndex) > 0xffffffff) {
    throw new Error('Pending foreign transaction outpoint is invalid.')
  }
  return Object.freeze({
    outputIndex: Number(value.outputIndex),
    txHash: canonicalHex(value.txHash, 32, 'Pending foreign transaction outpoint hash'),
  })
}

function outpointKey(value: ForeignWalletPendingOutpoint) {
  return `${value.txHash}:${value.outputIndex}`
}

function transactionKey(value: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'txId' | 'walletFingerprint'>) {
  return `${value.walletFingerprint}|${value.coin}|${value.chainId}|${value.txId}`
}

function conflictWalletKey(value: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'walletFingerprint'>) {
  return `${value.walletFingerprint}|${value.coin}|${value.chainId}`
}

function canonicalWalletIdentity(
  value: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'walletFingerprint'>,
) {
  const coin = canonicalCoin(value.coin)
  const chainId = canonicalChainId(value.chainId)
  if (chainId !== getForeignWalletMainnetChainId(coin)) {
    throw new Error('Pending foreign transaction chain does not match its coin.')
  }
  return `${canonicalHex(value.walletFingerprint, 32, 'Pending foreign wallet fingerprint')}|${coin}|${chainId}`
}

export function getForeignWalletOperationKey(
  value: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'walletFingerprint'>,
) {
  return canonicalWalletIdentity(value)
}

function transactionKeyFromInput(
  value: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'txId' | 'walletFingerprint'>,
) {
  return `${canonicalWalletIdentity(value)}|${canonicalHex(value.txId, 32, 'Pending foreign transaction ID')}`
}

export function sanitizeForeignWalletPendingTransaction(value: unknown): ForeignWalletPendingTransaction {
  if (!isRecord(value) || (value.stage !== 'signed' && value.stage !== 'broadcast-attempted')
    || !Array.isArray(value.outpoints) || value.outpoints.length < 1
    || value.outpoints.length > FOREIGN_WALLET_TRANSACTION_JOURNAL_MAX_OUTPOINTS) {
    throw new Error('Pending foreign transaction entry is invalid.')
  }
  const outpoints = value.outpoints.map(canonicalOutpoint).sort((left, right) => {
    const hashOrder = left.txHash.localeCompare(right.txHash)
    return hashOrder === 0 ? left.outputIndex - right.outputIndex : hashOrder
  })
  const outpointKeys = new Set(outpoints.map(outpointKey))
  if (outpointKeys.size !== outpoints.length) {
    throw new Error('Pending foreign transaction contains a duplicate outpoint.')
  }
  const createdAt = safeTimestamp(value.createdAt, 'Pending foreign transaction creation time')
  let broadcastAttemptedAt: number | undefined
  if (value.stage === 'signed') {
    if (value.broadcastAttemptedAt !== undefined) {
      throw new Error('Pending foreign transaction broadcast time is invalid.')
    }
  } else {
    broadcastAttemptedAt = safeTimestamp(
      value.broadcastAttemptedAt,
      'Pending foreign transaction broadcast time',
    )
    if (broadcastAttemptedAt < createdAt) {
      throw new Error('Pending foreign transaction broadcast time is invalid.')
    }
  }
  const coin = canonicalCoin(value.coin)
  const chainId = canonicalChainId(value.chainId)
  if (chainId !== getForeignWalletMainnetChainId(coin)) {
    throw new Error('Pending foreign transaction chain does not match its coin.')
  }
  return Object.freeze({
    appIdentity: boundedString(value.appIdentity, 'Pending foreign transaction app identity', 2_048),
    ...(broadcastAttemptedAt === undefined ? {} : { broadcastAttemptedAt }),
    chainId,
    coin,
    createdAt,
    outpoints: Object.freeze(outpoints),
    stage: value.stage,
    txId: canonicalHex(value.txId, 32, 'Pending foreign transaction ID'),
    walletFingerprint: canonicalHex(value.walletFingerprint, 32, 'Pending foreign wallet fingerprint'),
  })
}

export function sanitizeForeignWalletTransactionJournal(value: unknown): ForeignWalletTransactionJournal {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries)
    || value.entries.length > FOREIGN_WALLET_TRANSACTION_JOURNAL_MAX_ENTRIES) {
    throw new Error('Pending foreign transaction journal is invalid.')
  }
  const entries = value.entries.map(sanitizeForeignWalletPendingTransaction)
  const transactionKeys = new Set(entries.map(transactionKey))
  if (transactionKeys.size !== entries.length) {
    throw new Error('Pending foreign transaction journal contains a duplicate transaction.')
  }
  const claimedOutpoints = new Set<string>()
  for (const entry of entries) {
    const walletKey = conflictWalletKey(entry)
    for (const outpoint of entry.outpoints) {
      const claim = `${walletKey}|${outpointKey(outpoint)}`
      if (claimedOutpoints.has(claim)) {
        throw new Error('Pending foreign transaction journal contains a conflicting outpoint.')
      }
      claimedOutpoints.add(claim)
    }
  }
  return Object.freeze({ entries: Object.freeze(entries), version: 1 })
}

export function createEmptyForeignWalletTransactionJournal(): ForeignWalletTransactionJournal {
  return Object.freeze({ entries: Object.freeze([]), version: 1 })
}

export function addSignedForeignWalletPendingTransaction(
  journal: ForeignWalletTransactionJournal,
  value: ForeignWalletPendingTransaction,
): ForeignWalletTransactionJournal {
  const current = sanitizeForeignWalletTransactionJournal(journal)
  const entry = sanitizeForeignWalletPendingTransaction(value)
  if (entry.stage !== 'signed') {
    throw new Error('A pending foreign transaction must be recorded before broadcast.')
  }
  if (current.entries.length >= FOREIGN_WALLET_TRANSACTION_JOURNAL_MAX_ENTRIES) {
    throw new Error('Pending foreign transaction journal is full.')
  }
  const key = transactionKey(entry)
  if (current.entries.some((candidate) => transactionKey(candidate) === key)) {
    throw new Error('Pending foreign transaction is already recorded.')
  }
  if (findForeignWalletPendingTransactionConflict(current, entry)) {
    throw new Error('A pending foreign transaction already claims one or more inputs.')
  }
  return sanitizeForeignWalletTransactionJournal({
    entries: [...current.entries, entry],
    version: 1,
  })
}

export function markForeignWalletBroadcastAttempted(
  journal: ForeignWalletTransactionJournal,
  input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'txId' | 'walletFingerprint'>,
  now = Date.now(),
): ForeignWalletTransactionJournal {
  const current = sanitizeForeignWalletTransactionJournal(journal)
  const wanted = transactionKeyFromInput(input)
  let found = false
  const entries = current.entries.map((entry) => {
    if (transactionKey(entry) !== wanted) return entry
    found = true
    if (entry.stage !== 'signed') {
      throw new Error('Pending foreign transaction broadcast was already attempted.')
    }
    const broadcastAttemptedAt = safeTimestamp(now, 'Pending foreign transaction broadcast time')
    if (broadcastAttemptedAt < entry.createdAt) {
      throw new Error('Pending foreign transaction broadcast time is invalid.')
    }
    return Object.freeze({ ...entry, broadcastAttemptedAt, stage: 'broadcast-attempted' as const })
  })
  if (!found) throw new Error('Pending foreign transaction was not found.')
  return sanitizeForeignWalletTransactionJournal({ entries, version: 1 })
}

export function confirmForeignWalletBroadcastSuccess(
  journal: ForeignWalletTransactionJournal,
  input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'txId' | 'walletFingerprint'>,
  returnedTxId: unknown,
): ForeignWalletTransactionJournal {
  const current = sanitizeForeignWalletTransactionJournal(journal)
  const wanted = transactionKeyFromInput(input)
  normalizeConfirmedForeignWalletTransactionId(input.txId, returnedTxId)
  const entry = current.entries.find((candidate) => transactionKey(candidate) === wanted)
  if (!entry) throw new Error('Pending foreign transaction was not found.')
  if (entry.stage !== 'broadcast-attempted') {
    throw new Error('Pending foreign transaction was not marked as broadcast attempted.')
  }
  return sanitizeForeignWalletTransactionJournal({
    entries: current.entries.filter((entry) => transactionKey(entry) !== wanted),
    version: 1,
  })
}

/**
 * Remove an entry because the wallet's own confirmed/unconfirmed history,
 * read back from the trusted node, contains the EXACT transaction Home
 * signed.
 *
 * This is not a forget: it takes the same proof `confirmForeignWalletBroadcastSuccess`
 * takes — a byte-exact txid match — and differs only in where the proof came
 * from (the wallet history rather than the broadcast reply) and in accepting
 * a 'signed' entry, which is what a crash between the write-ahead record and
 * the broadcast attempt leaves behind. There is deliberately no path that
 * drops an entry without that proof.
 */
export function clearReconciledForeignWalletPendingTransaction(
  journal: ForeignWalletTransactionJournal,
  input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'txId' | 'walletFingerprint'>,
  observedTxId: unknown,
): ForeignWalletTransactionJournal {
  const current = sanitizeForeignWalletTransactionJournal(journal)
  const wanted = transactionKeyFromInput(input)
  normalizeConfirmedForeignWalletTransactionId(input.txId, observedTxId)
  if (!current.entries.some((candidate) => transactionKey(candidate) === wanted)) {
    throw new Error('Pending foreign transaction was not found.')
  }
  return sanitizeForeignWalletTransactionJournal({
    entries: current.entries.filter((entry) => transactionKey(entry) !== wanted),
    version: 1,
  })
}

/**
 * Release an entry that was signed but never broadcast.
 *
 * Stage 'signed' is a proof, not a guess. The broadcast-attempt mark is
 * written and fsynced BEFORE the single broadcast POST is issued, so an entry
 * still at 'signed' means that mark never reached disk, which means the POST
 * was never made and the signed bytes never left the process. They were never
 * persisted either, so there is nothing that could be rebroadcast later.
 *
 * The one ambiguity is timing: another Home instance could be mid-send right
 * now, having recorded 'signed' and not yet marked the attempt. The age guard
 * closes that — an entry younger than the send's own freshness window is never
 * released, and past that window the send it belonged to would have been
 * refused as stale anyway.
 *
 * Both conditions are enforced here rather than at the call site, so no caller
 * can release a broadcast-attempted entry or a fresh one.
 */
export function releaseNeverBroadcastForeignWalletPendingTransaction(
  journal: ForeignWalletTransactionJournal,
  input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'txId' | 'walletFingerprint'>,
  now: number,
  minimumAgeMs: number,
): ForeignWalletTransactionJournal {
  const current = sanitizeForeignWalletTransactionJournal(journal)
  const wanted = transactionKeyFromInput(input)
  const at = safeTimestamp(now, 'Pending foreign transaction release time')
  if (!Number.isSafeInteger(minimumAgeMs) || minimumAgeMs <= 0) {
    throw new Error('Pending foreign transaction release age is invalid.')
  }
  const entry = current.entries.find((candidate) => transactionKey(candidate) === wanted)
  if (!entry) throw new Error('Pending foreign transaction was not found.')
  if (entry.stage !== 'signed') {
    throw new Error('Pending foreign transaction was already attempted and needs its outcome proved.')
  }
  if (at - entry.createdAt < minimumAgeMs) {
    throw new Error('Pending foreign transaction is too recent to release.')
  }
  return sanitizeForeignWalletTransactionJournal({
    entries: current.entries.filter((candidate) => transactionKey(candidate) !== wanted),
    version: 1,
  })
}

/**
 * Every entry retained for one wallet and coin, oldest first. Read-only: the
 * caller decides what to do about them, and nothing here removes anything.
 */
export function selectForeignWalletPendingTransactions(
  journal: ForeignWalletTransactionJournal,
  input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'walletFingerprint'>,
): readonly ForeignWalletPendingTransaction[] {
  const current = sanitizeForeignWalletTransactionJournal(journal)
  const walletKey = canonicalWalletIdentity(input)
  return Object.freeze(current.entries
    .filter((entry) => conflictWalletKey(entry) === walletKey)
    .sort((left, right) => left.createdAt - right.createdAt))
}

export function normalizeConfirmedForeignWalletTransactionId(
  expectedTxId: unknown,
  returnedTxId: unknown,
) {
  const expected = canonicalHex(expectedTxId, 32, 'Pending foreign transaction ID')
  const confirmed = canonicalHex(returnedTxId, 32, 'Broadcast foreign transaction ID')
  if (confirmed !== expected) {
    throw new Error('Broadcast foreign transaction ID did not match the signed transaction.')
  }
  return confirmed
}

export function findForeignWalletPendingTransactionConflict(
  journal: ForeignWalletTransactionJournal,
  input: Pick<ForeignWalletPendingTransaction, 'chainId' | 'coin' | 'outpoints' | 'walletFingerprint'>,
) {
  const current = sanitizeForeignWalletTransactionJournal(journal)
  const walletKey = canonicalWalletIdentity(input)
  if (!Array.isArray(input.outpoints) || input.outpoints.length < 1
    || input.outpoints.length > FOREIGN_WALLET_TRANSACTION_JOURNAL_MAX_OUTPOINTS) {
    throw new Error('Pending foreign transaction outpoints are invalid.')
  }
  const requestedOutpoints = input.outpoints.map(canonicalOutpoint).map(outpointKey)
  const requested = new Set(requestedOutpoints)
  if (requested.size !== requestedOutpoints.length) {
    throw new Error('Pending foreign transaction contains a duplicate outpoint.')
  }
  return current.entries.find((entry) => conflictWalletKey(entry) === walletKey
    && entry.outpoints.some((outpoint) => requested.has(outpointKey(outpoint))))
}
