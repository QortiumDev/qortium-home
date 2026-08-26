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
assert.deepEqual(homeV2TransactionTargetFromRequest('SEND_CHAT_MESSAGE', { txGroupId: 12 }), { kind: 'group', groupId: 12 })
// The derivation is ACTION-AWARE (security review 2026-08-26, finding 3):
// poll actions key only on their own poll fields, and no other action keys on
// them — so an ignored extra field can never move a logical operation onto a
// different conflict key and slip past its retained unknown-outcome block.
assert.deepEqual(homeV2TransactionTargetFromRequest('VOTE_ON_POLL', { pollId: 7, txGroupId: 0 }), { kind: 'poll', pollId: 7 })
assert.deepEqual(homeV2TransactionTargetFromRequest('UPDATE_POLL', { poll: '7' }), { kind: 'poll', pollId: 7 })
// A stray pollId on a chat send must NOT change its conflict key...
assert.deepEqual(
  homeV2TransactionTargetFromRequest('SEND_DIRECT_CHAT_MESSAGE', { otherAddress: 'QdemoAddr111111111111111111111111', pollId: 7 }),
  { kind: 'direct', otherAddress: 'QdemoAddr111111111111111111111111' },
)
// ...and a stray conversation/txGroupId on a vote must not either.
assert.deepEqual(
  homeV2TransactionTargetFromRequest('VOTE_ON_POLL', { conversation: { groupId: 9, kind: 'group' }, pollId: 7 }),
  { kind: 'poll', pollId: 7 },
)
// Lenient before validation: a malformed id falls to the coarse operation
// target; the action handler refuses the request with its own error later.
assert.deepEqual(homeV2TransactionTargetFromRequest('VOTE_ON_POLL', { pollId: 'abc' }), { kind: 'operation' })
assert.deepEqual(homeV2TransactionTargetFromRequest('VOTE_ON_POLL', { pollId: 0 }), { kind: 'operation' })
// CREATE_POLL has no id before it confirms: always the coarse operation
// target, whatever extra fields the request carries.
assert.deepEqual(homeV2TransactionTargetFromRequest('CREATE_POLL', { pollName: 'Snacks', txGroupId: 0 }), { kind: 'operation' })
assert.deepEqual(homeV2TransactionTargetFromRequest('CREATE_POLL', { pollId: 7, pollName: 'Snacks' }), { kind: 'operation' })
assert.deepEqual(homeV2TransactionTargetFromRequest('PUBLISH_QDN_RESOURCE', {
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

const keyAnnouncementEntry = createHomeV2PendingTransactionFromResult({
  accountId: entry.accountId,
  action: 'SEND_PRIVATE_GROUP_CHAT_MESSAGE',
  appIdentity: entry.appIdentity,
  now,
  protocol: entry.protocol,
  request: { groupId: 12 },
  result: {
    messageSubmitted: false,
    outcome: 'unknown',
    signature,
    stage: 'key-announcement',
    timestamp: entry.timestamp,
  },
})
assert.deepEqual(keyAnnouncementEntry, {
  ...entry,
  action: 'SEND_PRIVATE_GROUP_CHAT_MESSAGE',
  stage: 'key-announcement',
  target: { kind: 'group', groupId: 12 },
})
assert.equal(findHomeV2PendingTransactionConflict(
  upsertHomeV2PendingTransaction(createEmptyHomeV2TransactionJournal(), keyAnnouncementEntry!, now),
  {
    accountId: entry.accountId,
    action: 'SEND_PRIVATE_GROUP_CHAT_MESSAGE',
    appIdentity: entry.appIdentity,
    network: entry.network,
    request: { groupId: 12 },
  },
  now,
), null, 'a key-only uncertainty must not block retrying a message that was never submitted')
assert.throws(() => sanitizeHomeV2TransactionJournal({
  entries: [{ ...entry, stage: 'message' }],
  version: 1,
}, now), /stage is invalid/)

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
