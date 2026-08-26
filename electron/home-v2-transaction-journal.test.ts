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
  derivation: 2 as const,
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
// ...nor a stray txGroupId, which the direct-chat normalizer ignores — the
// round-2 residual: with the old field-priority derivation, txGroupId:1 then
// txGroupId:2 gave the same direct message two different group conflict keys.
assert.deepEqual(
  homeV2TransactionTargetFromRequest('SEND_DIRECT_CHAT_MESSAGE', { otherAddress: 'QdemoAddr111111111111111111111111', txGroupId: 2 }),
  { kind: 'direct', otherAddress: 'QdemoAddr111111111111111111111111' },
)
// Group admin actions own only groupId; a stray otherAddress/resource is inert.
assert.deepEqual(
  homeV2TransactionTargetFromRequest('GROUP_BAN', { groupId: 9, otherAddress: 'QdemoAddr111111111111111111111111' }),
  { kind: 'group', groupId: 9 },
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
// Publishes derive from the FLAT fields their normalizer actually reads
// (getQdnWriteResourceRequest, payload-aware) — a nested decoy `resource`
// object is a field no publish normalizer consumes and is inert.
assert.deepEqual(homeV2TransactionTargetFromRequest('PUBLISH_QDN_RESOURCE', {
  identifier: 'chat-image', name: 'Alice', service: 'IMAGE',
}), { kind: 'resource', service: 'IMAGE', name: 'Alice', identifier: 'chat-image' })
assert.deepEqual(homeV2TransactionTargetFromRequest('PUBLISH_QDN_RESOURCE', {
  payload: { identifier: 'chat-image', name: 'Alice', service: 'IMAGE' },
}), { kind: 'resource', service: 'IMAGE', name: 'Alice', identifier: 'chat-image' })
assert.deepEqual(homeV2TransactionTargetFromRequest('PUBLISH_QDN_RESOURCE', {
  name: 'Alice',
  resource: { identifier: 'decoy', name: 'Decoy', service: 'IMAGE' },
  service: 'IMAGE',
}), { kind: 'resource', service: 'IMAGE', name: 'Alice', identifier: null })
// Attachment publishes own `conversation` (their normalizer requires it).
assert.deepEqual(homeV2TransactionTargetFromRequest('PUBLISH_CHAT_ATTACHMENT', {
  conversation: { groupId: 5, kind: 'group' },
  resource: { identifier: 'decoy', name: 'Decoy', service: 'IMAGE' },
}), { kind: 'group', groupId: 5 })
// Private-group sends accept groupId ?? txGroupId, exactly as their
// normalizer does — a txGroupId-shaped request keeps its group key.
assert.deepEqual(homeV2TransactionTargetFromRequest('SEND_PRIVATE_GROUP_CHAT_MESSAGE', { txGroupId: 12 }),
  { kind: 'group', groupId: 12 })
// A decoy conversation on a PUBLIC chat send is inert: its normalizer reads
// only txGroupId.
assert.deepEqual(homeV2TransactionTargetFromRequest('SEND_CHAT_MESSAGE', {
  conversation: { groupId: 99, kind: 'group' }, txGroupId: 12,
}), { kind: 'group', groupId: 12 })
// Direct sends accept the recipientAddress alias their normalizer accepts.
assert.deepEqual(homeV2TransactionTargetFromRequest('SEND_DIRECT_CHAT_MESSAGE', {
  recipientAddress: 'QdemoAddr111111111111111111111111',
}), { kind: 'direct', otherAddress: 'QdemoAddr111111111111111111111111' })
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
// A stray ignored field must not move the SAME send off its retained key
// (round-2 residual): the conflict still matches with txGroupId attached.
assert.equal(findHomeV2PendingTransactionConflict(journal, {
  accountId: entry.accountId,
  action: entry.action,
  appIdentity: entry.appIdentity,
  network: entry.network,
  request: { otherAddress: entry.target.otherAddress, txGroupId: 2 },
}, now)?.signature, signature)

// GROUP_BAN and BAN_FROM_GROUP are 1.x aliases of one operation: a retained
// entry under either spelling blocks the other (round-2 residual).
const banEntry = createHomeV2PendingTransactionFromResult({
  accountId: entry.accountId,
  action: 'BAN_FROM_GROUP',
  appIdentity: entry.appIdentity,
  now,
  protocol: entry.protocol,
  request: { groupId: 9 },
  result: { outcome: 'unknown', signature, timestamp: now },
})
if (!banEntry) throw new Error('ban entry must journal')
const banJournal = { entries: [banEntry], version: 1 as const }
assert.equal(findHomeV2PendingTransactionConflict(banJournal, {
  accountId: entry.accountId,
  action: 'GROUP_BAN',
  appIdentity: entry.appIdentity,
  network: entry.network,
  request: { groupId: 9 },
}, now)?.signature, signature)

// A LEGACY entry (no derivation stamp — recorded before the version-2
// field-ownership derivation) is coarse whatever specific target it stored:
// the old derivation could be moved by decoy fields, so its true subject is
// unknowable, and the whole action blocks until reconciled or expired.
{
  const legacy = {
    accountId: entry.accountId,
    action: 'SEND_CHAT_MESSAGE',
    appIdentity: entry.appIdentity,
    createdAt: now,
    network: entry.network,
    protocol: entry.protocol,
    signature,
    // A decoy-moved specific target from the pre-fix derivation.
    target: { groupId: 99, kind: 'group' },
    timestamp: now,
  }
  const legacyJournal = sanitizeHomeV2TransactionJournal({ entries: [legacy], version: 1 }, now)
  assert.equal(legacyJournal.entries[0].derivation, undefined)
  assert.equal(findHomeV2PendingTransactionConflict(legacyJournal, {
    accountId: entry.accountId,
    action: 'SEND_CHAT_MESSAGE',
    appIdentity: entry.appIdentity,
    network: entry.network,
    request: { txGroupId: 12 },
  }, now)?.signature, signature)
  // A forged FUTURE stamp is dropped on load, so it cannot pre-claim trust.
  const forged = sanitizeHomeV2TransactionJournal({ entries: [{ ...legacy, derivation: 3 }], version: 1 }, now)
  assert.equal(forged.entries[0].derivation, undefined)
}

// A version-2 entry with a SPECIFIC target matches specifically: same key
// conflicts, a different key does not.
{
  const voteEntry = createHomeV2PendingTransactionFromResult({
    accountId: entry.accountId,
    action: 'VOTE_ON_POLL',
    appIdentity: entry.appIdentity,
    now,
    protocol: entry.protocol,
    request: { optionIndex: 1, pollId: 7 },
    result: { outcome: 'unknown', signature, timestamp: now },
  })
  if (!voteEntry) throw new Error('vote entry must journal')
  assert.equal(voteEntry.derivation, 2)
  const voteJournal = { entries: [voteEntry], version: 1 as const }
  assert.equal(findHomeV2PendingTransactionConflict(voteJournal, {
    accountId: entry.accountId,
    action: 'VOTE_ON_POLL',
    appIdentity: entry.appIdentity,
    network: entry.network,
    request: { optionIndex: 2, pollId: 7 },
  }, now)?.signature, signature)
  assert.equal(findHomeV2PendingTransactionConflict(voteJournal, {
    accountId: entry.accountId,
    action: 'VOTE_ON_POLL',
    appIdentity: entry.appIdentity,
    network: entry.network,
    request: { optionIndex: 1, pollId: 8 },
  }, now), null)
}

// An operation-target entry is coarse BY DEFINITION: it blocks every request
// of its action until reconciled — which also heals entries recorded under
// the older, looser derivations in the safe (more-blocking) direction.
const coarseEntry = createHomeV2PendingTransactionFromResult({
  accountId: entry.accountId,
  action: 'SEND_CHAT_MESSAGE',
  appIdentity: entry.appIdentity,
  now,
  protocol: entry.protocol,
  request: {},
  result: { outcome: 'unknown', signature, timestamp: now },
})
if (!coarseEntry) throw new Error('coarse entry must journal')
assert.deepEqual(coarseEntry.target, { kind: 'operation' })
assert.equal(findHomeV2PendingTransactionConflict({ entries: [coarseEntry], version: 1 }, {
  accountId: entry.accountId,
  action: 'SEND_CHAT_MESSAGE',
  appIdentity: entry.appIdentity,
  network: entry.network,
  request: { txGroupId: 12 },
}, now)?.signature, signature)

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
