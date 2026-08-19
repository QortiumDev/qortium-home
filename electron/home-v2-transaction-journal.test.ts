import assert from 'node:assert/strict'
import { base58Encode } from './base58.js'
import {
  createEmptyHomeV2TransactionJournal,
  createHomeV2PendingTransactionFromResult,
  findHomeV2PendingTransactionConflict,
  getHomeV2PendingTransactions,
  homeV2TransactionTargetFromRequest,
  normalizeHomeV2ForgetPendingTransactionRequest,
  removeHomeV2PendingTransaction,
  sanitizeHomeV2TransactionJournal,
  toHomeV2PendingTransactionResult,
  upsertHomeV2PendingTransaction,
} from './home-v2-transaction-journal.js'

const signature = base58Encode(new Uint8Array(64).fill(7))
const now = 2_000_000_000_000
const entry = {
  accountId: 'wallet:one:0',
  action: 'SEND_DIRECT_CHAT_MESSAGE' as const,
  appIdentity: 'qdn://APP/Chat/default',
  createdAt: now,
  network: 'qortium' as const,
  protocol: 'qdnRequest' as const,
  signature,
  target: { kind: 'direct' as const, otherAddress: `Q${'a'.repeat(20)}` },
  timestamp: now - 100,
}

const journal = upsertHomeV2PendingTransaction(createEmptyHomeV2TransactionJournal(), entry, now)
assert.deepEqual(getHomeV2PendingTransactions(journal, {
  accountId: entry.accountId,
  appIdentity: entry.appIdentity,
  network: 'qortium',
}, now), [entry])
assert.deepEqual(toHomeV2PendingTransactionResult(entry), {
  action: entry.action,
  createdAt: entry.createdAt,
  network: entry.network,
  signature,
  target: entry.target,
  timestamp: entry.timestamp,
})
assert.deepEqual(getHomeV2PendingTransactions(journal, {
  accountId: 'wallet:two:0',
  appIdentity: entry.appIdentity,
  network: 'qortium',
}, now), [])
assert.equal(removeHomeV2PendingTransaction(journal, { network: 'qortium', signature }, now).entries.length, 0)
assert.deepEqual(normalizeHomeV2ForgetPendingTransactionRequest('qdnRequest', { signature }), {
  network: 'qortium',
  signature,
})
assert.throws(
  () => normalizeHomeV2ForgetPendingTransactionRequest('qdnRequest', { network: 'qortal', signature }),
  /must match qdnRequest/,
)
assert.deepEqual(homeV2TransactionTargetFromRequest({ txGroupId: 12 }), { kind: 'group', groupId: 12 })
assert.deepEqual(homeV2TransactionTargetFromRequest({
  resource: { service: 'IMAGE', name: 'Alice', identifier: 'chat-image' },
}), { kind: 'resource', service: 'IMAGE', name: 'Alice', identifier: 'chat-image' })
assert.deepEqual(createHomeV2PendingTransactionFromResult({
  accountId: entry.accountId,
  action: entry.action,
  appIdentity: entry.appIdentity,
  now,
  protocol: entry.protocol,
  request: { otherAddress: entry.target.otherAddress },
  result: { outcome: 'unknown', signature, timestamp: entry.timestamp },
}), entry)
assert.equal(createHomeV2PendingTransactionFromResult({
  accountId: entry.accountId,
  action: entry.action,
  appIdentity: entry.appIdentity,
  protocol: entry.protocol,
  request: {},
  result: { accepted: true, signature, timestamp: now },
}), null)
assert.equal(findHomeV2PendingTransactionConflict(journal, {
  accountId: entry.accountId,
  action: entry.action,
  appIdentity: entry.appIdentity,
  network: entry.network,
  request: { otherAddress: entry.target.otherAddress },
}, now)?.signature, signature)
assert.equal(findHomeV2PendingTransactionConflict(journal, {
  accountId: entry.accountId,
  action: entry.action,
  appIdentity: entry.appIdentity,
  network: entry.network,
  request: { otherAddress: `Q${'b'.repeat(20)}` },
}, now), null)

const expired = sanitizeHomeV2TransactionJournal({
  entries: [{ ...entry, createdAt: now - 31 * 24 * 60 * 60_000 }],
  version: 1,
}, now)
assert.equal(expired.entries.length, 0)
assert.throws(() => sanitizeHomeV2TransactionJournal({
  entries: [entry, entry],
  version: 1,
}, now), /duplicate signatures/)
assert.throws(() => sanitizeHomeV2TransactionJournal({
  entries: [{ ...entry, signature: 'not-base58' }],
  version: 1,
}, now), /signature is invalid/)

console.log('Home v2 pending transaction journal tests passed')
