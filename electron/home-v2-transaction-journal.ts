import { base58Decode, base58Encode } from './base58.js'
import { canonicalHomeV2GroupAdminAction, type HomeV2GroupAdminAction } from './home-v2-group-admin-actions.js'
import type {
  HomeV2AppBridgeProtocol,
  HomeV2AppNetwork,
} from './home-v2-app-actions.js'

export const HOME_V2_TRANSACTION_JOURNAL_ACTIONS = Object.freeze([
  'GET_PENDING_TRANSACTIONS',
  'FORGET_PENDING_TRANSACTION',
] as const)

export const HOME_V2_JOURNALED_MUTATIONS = Object.freeze([
  'ADD_GROUP_ADMIN',
  'APPROVE_GROUP_JOIN_REQUEST',
  'BAN_FROM_GROUP',
  'CANCEL_GROUP_BAN',
  'CANCEL_GROUP_INVITE',
  'GROUP_BAN',
  'GROUP_KICK',
  'INVITE_TO_GROUP',
  'JOIN_GROUP',
  'KICK_FROM_GROUP',
  'LEAVE_GROUP',
  'PUBLISH_CHAT_ATTACHMENT',
  'PUBLISH_QDN_RESOURCE',
  'REMOVE_GROUP_ADMIN',
  'REQUEST_PRIVATE_GROUP_CHAT_KEY',
  'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS',
  'ROTATE_PRIVATE_GROUP_CHAT_KEY',
  'SEND_CHAT_DELETE',
  'SEND_CHAT_EDIT',
  'SEND_CHAT_MESSAGE',
  'SEND_CHAT_REACTION',
  'SEND_DIRECT_CHAT_DELETE',
  'SEND_DIRECT_CHAT_EDIT',
  'SEND_DIRECT_CHAT_MESSAGE',
  'SEND_DIRECT_CHAT_REACTION',
  // A zero-fee MESSAGE to an AT is signed locally and broadcast to a node that
  // may or may not have accepted it, so it has the same ambiguous-outcome
  // problem as a chat send and gets the same treatment. Its journal target is
  // {kind:'operation'} (homeV2TransactionTargetFromRequest sees only a
  // `recipient` key, which no target kind claims), so the conflict check is
  // deliberately COARSE: one unreconciled SEND_MESSAGE blocks the next one for
  // this app and account regardless of which AT it addressed. Erring toward
  // blocking is right here — the shipped caller is a once-per-account faucet
  // claim, where a duplicate is exactly what reconciliation exists to prevent.
  'SEND_MESSAGE',
  // Poll writes sign and broadcast like a chat send and share its ambiguous-
  // outcome problem. VOTE_ON_POLL and UPDATE_POLL journal against the stable
  // {kind:'poll', pollId} target; CREATE_POLL has no id before it confirms,
  // so it takes the same coarse {kind:'operation'} treatment as SEND_MESSAGE —
  // one unreconciled create blocks this app's next create for the account,
  // which errs toward preventing the duplicate poll reconciliation exists for.
  'CREATE_POLL',
  'UPDATE_POLL',
  'VOTE_ON_POLL',
  // Name writes journal against the coarse operation target ON PURPOSE: an
  // exact-name key is unsafe because UPDATE has both spellings, collisions
  // use REDUCED names, and an unknown UPDATE outcome can affect either — so
  // one unreconciled name write blocks this app's next one for the account.
  'BUY_NAME',
  'CANCEL_SELL_NAME',
  'REGISTER_NAME',
  'SELL_NAME',
  'UPDATE_NAME',
  // Group mutations. UPDATE_GROUP and SET_GROUP_AVATAR key on their group;
  // GROUP_APPROVAL keys on the specific pending transaction it votes on (a
  // group-level key would block votes on unrelated pending transactions);
  // CREATE_GROUP (no id before it confirms) and SET_GROUP (one account-wide
  // default slot) take the coarse operation target.
  'CREATE_GROUP',
  'GROUP_APPROVAL',
  'SET_GROUP',
  'SET_GROUP_AVATAR',
  'UPDATE_GROUP',
  'SEND_PRIVATE_GROUP_CHAT_DELETE',
  'SEND_PRIVATE_GROUP_CHAT_EDIT',
  'SEND_PRIVATE_GROUP_CHAT_MESSAGE',
  'SEND_PRIVATE_GROUP_CHAT_REACTION',
  // The publishing extras. DELETE_QDN_RESOURCE keys on its resource
  // coordinate exactly as PUBLISH_QDN_RESOURCE does (same normalizer fields).
  // PUBLISH_MULTIPLE_QDN_RESOURCES covers N coordinates in one request, so
  // its request-level derivation is the coarse operation target ON PURPOSE —
  // and it shares PUBLISH_QDN_RESOURCE's conflict-action key
  // (journalConflictActionKey), so one unreconciled publish of ANY kind
  // blocks this app's next batch. The batch handler records each
  // signed-but-unknown ITEM as a PUBLISH_QDN_RESOURCE entry with that item's
  // resource target, which is what each item's transaction actually is.
  'DELETE_QDN_RESOURCE',
  'PUBLISH_MULTIPLE_QDN_RESOURCES',
  // Rating writes. RATE_RESOURCE keys on its resource coordinate exactly as
  // the QDN resource writes do (same normalizer fields); RATE_ACCOUNT keys
  // on the exact target-key + category edge it signs.
  'RATE_ACCOUNT',
  'RATE_RESOURCE',
  // One avatar slot per account: the coarse operation target is exactly the
  // right key — one unreconciled avatar write blocks this app's next one for
  // the account (the catch-all derivation arm already answers it).
  'SET_ACCOUNT_AVATAR',
] as const)

export type HomeV2JournaledMutation = (typeof HOME_V2_JOURNALED_MUTATIONS)[number]

export type HomeV2TransactionTarget =
  | { readonly kind: 'account-rating'; readonly category: string; readonly targetPublicKey: string }
  | { readonly kind: 'direct'; readonly otherAddress: string }
  | { readonly kind: 'group'; readonly groupId: number }
  | { readonly kind: 'poll'; readonly pollId: number }
  | { readonly kind: 'transaction'; readonly signature: string }
  | {
      readonly kind: 'resource'
      readonly identifier: string | null
      readonly name: string
      readonly service: string
    }
  | { readonly kind: 'operation' }

export interface HomeV2PendingTransaction {
  readonly accountId: string
  readonly action: HomeV2JournaledMutation
  readonly appIdentity: string
  readonly createdAt: number
  // The target-derivation revision the entry was recorded under. Version 2 is
  // the per-normalizer field-ownership derivation (2026-08-26); an entry
  // WITHOUT the stamp predates it, and its stored target may have been moved
  // by a decoy field the old derivation trusted — so conflict matching treats
  // unstamped entries as coarse for their whole action (see
  // journalTargetsConflict). Absent on legacy entries by definition.
  readonly derivation?: 2
  readonly network: HomeV2AppNetwork
  readonly protocol: HomeV2AppBridgeProtocol
  readonly signature: string
  readonly stage?: 'key-announcement'
  readonly target: HomeV2TransactionTarget
  readonly timestamp: number
}

export interface HomeV2TransactionJournal {
  readonly entries: readonly HomeV2PendingTransaction[]
  readonly version: 1
}

export type HomeV2PendingTransactionResult = Pick<
  HomeV2PendingTransaction,
  'action' | 'createdAt' | 'network' | 'signature' | 'target' | 'timestamp'
>

export const HOME_V2_TRANSACTION_JOURNAL_MAX_ENTRIES = 256
export const HOME_V2_TRANSACTION_JOURNAL_MAX_BYTES = 512 * 1024
export const HOME_V2_TRANSACTION_JOURNAL_MAX_AGE_MS = 30 * 24 * 60 * 60_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function boundedString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value.trim()
}

function canonicalSignature(value: unknown) {
  const signature = boundedString(value, 'Pending transaction signature', 128)
  let bytes: Uint8Array
  try { bytes = base58Decode(signature) } catch { throw new Error('Pending transaction signature is invalid.') }
  if (bytes.byteLength !== 64 || base58Encode(bytes) !== signature) {
    throw new Error('Pending transaction signature is invalid.')
  }
  return signature
}

function safeTimestamp(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} is invalid.`)
  return Number(value)
}

function normalizeTarget(value: unknown): HomeV2TransactionTarget {
  if (!isRecord(value)) throw new Error('Pending transaction target is invalid.')
  if (value.kind === 'operation') return Object.freeze({ kind: 'operation' })
  if (value.kind === 'group') {
    // 0 stays legal (public chat's General chat), and there is deliberately
    // NO int32 upper bound: entries recorded before this revision could
    // legally store any safe integer here, and the journal store fails
    // CLOSED on a single unreadable entry — a new bound would brick every
    // pre-existing journal containing one. An oversized stored key is
    // harmless: it can only ever block, never loosen.
    if (!Number.isSafeInteger(value.groupId) || Number(value.groupId) < 0) {
      throw new Error('Pending transaction group target is invalid.')
    }
    return Object.freeze({ kind: 'group', groupId: Number(value.groupId) })
  }
  if (value.kind === 'poll') {
    if (!Number.isSafeInteger(value.pollId) || Number(value.pollId) < 1 || Number(value.pollId) > 2_147_483_647) {
      throw new Error('Pending transaction poll target is invalid.')
    }
    return Object.freeze({ kind: 'poll', pollId: Number(value.pollId) })
  }
  if (value.kind === 'transaction') {
    // The signature of a pending transaction a GROUP_APPROVAL votes on.
    return Object.freeze({ kind: 'transaction', signature: canonicalSignature(value.signature) })
  }
  if (value.kind === 'direct') {
    const otherAddress = boundedString(value.otherAddress, 'Pending transaction direct target', 128)
    if (!/^Q[1-9A-HJ-NP-Za-km-z]{20,80}$/.test(otherAddress)) {
      throw new Error('Pending transaction direct target is invalid.')
    }
    return Object.freeze({ kind: 'direct', otherAddress })
  }
  if (value.kind === 'resource') {
    return Object.freeze({
      identifier: value.identifier === null ? null : boundedString(value.identifier, 'Pending transaction resource identifier', 256),
      kind: 'resource',
      name: boundedString(value.name, 'Pending transaction resource name', 128),
      service: boundedString(value.service, 'Pending transaction resource service', 64).toUpperCase(),
    })
  }
  if (value.kind === 'account-rating') {
    // The exact rated edge: target public key plus category. Both bounded
    // strings — the journal stays deliberately looser than the handler
    // (an off-enum category can only ever block, never loosen).
    return Object.freeze({
      category: boundedString(value.category, 'Pending transaction rating category', 32).toUpperCase(),
      kind: 'account-rating',
      targetPublicKey: boundedString(value.targetPublicKey, 'Pending transaction rating target', 64),
    })
  }
  throw new Error('Pending transaction target is invalid.')
}

export function isHomeV2JournaledMutation(value: unknown): value is HomeV2JournaledMutation {
  return typeof value === 'string' && (HOME_V2_JOURNALED_MUTATIONS as readonly string[]).includes(value)
}

export function sanitizeHomeV2PendingTransaction(value: unknown): HomeV2PendingTransaction {
  if (!isRecord(value) || !isHomeV2JournaledMutation(value.action)) {
    throw new Error('Pending transaction entry is invalid.')
  }
  if (value.stage !== undefined && value.stage !== 'key-announcement') {
    throw new Error('Pending transaction stage is invalid.')
  }
  const protocol = value.protocol
  if (protocol !== 'qdnRequest' && protocol !== 'qortalRequest') {
    throw new Error('Pending transaction protocol is invalid.')
  }
  const network = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
  if (value.network !== network) throw new Error('Pending transaction network is invalid.')
  return Object.freeze({
    accountId: boundedString(value.accountId, 'Pending transaction account', 256),
    action: value.action,
    appIdentity: boundedString(value.appIdentity, 'Pending transaction app identity', 2_048),
    createdAt: safeTimestamp(value.createdAt, 'Pending transaction creation time'),
    // Anything other than the exact current revision is dropped, so a stored
    // entry can only ever carry a stamp the running code actually issued —
    // a forged higher number cannot pre-claim trust in its target.
    ...(value.derivation === 2 ? { derivation: 2 as const } : {}),
    network,
    protocol,
    signature: canonicalSignature(value.signature),
    ...(value.stage === 'key-announcement' ? { stage: 'key-announcement' as const } : {}),
    target: normalizeTarget(value.target),
    timestamp: safeTimestamp(value.timestamp, 'Pending transaction timestamp'),
  })
}

export function sanitizeHomeV2TransactionJournal(
  value: unknown,
  now = Date.now(),
): HomeV2TransactionJournal {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > HOME_V2_TRANSACTION_JOURNAL_MAX_ENTRIES) {
    throw new Error('Pending transaction journal is invalid.')
  }
  const entries = value.entries
    .map(sanitizeHomeV2PendingTransaction)
    .filter((entry) => now - entry.createdAt <= HOME_V2_TRANSACTION_JOURNAL_MAX_AGE_MS)
  const identities = new Set(entries.map((entry) => `${entry.network}|${entry.signature}`))
  if (identities.size !== entries.length) throw new Error('Pending transaction journal contains duplicate signatures.')
  return Object.freeze({ entries: Object.freeze(entries), version: 1 })
}

export function createEmptyHomeV2TransactionJournal(): HomeV2TransactionJournal {
  return Object.freeze({ entries: Object.freeze([]), version: 1 })
}

export function upsertHomeV2PendingTransaction(
  journal: HomeV2TransactionJournal,
  value: HomeV2PendingTransaction,
  now = Date.now(),
): HomeV2TransactionJournal {
  const entry = sanitizeHomeV2PendingTransaction(value)
  const current = sanitizeHomeV2TransactionJournal(journal, now)
  const entries = [
    ...current.entries.filter((candidate) => candidate.network !== entry.network || candidate.signature !== entry.signature),
    entry,
  ]
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-HOME_V2_TRANSACTION_JOURNAL_MAX_ENTRIES)
  return Object.freeze({ entries: Object.freeze(entries), version: 1 })
}

export function removeHomeV2PendingTransaction(
  journal: HomeV2TransactionJournal,
  input: { readonly network: HomeV2AppNetwork; readonly signature: string },
  now = Date.now(),
): HomeV2TransactionJournal {
  const signature = canonicalSignature(input.signature)
  const current = sanitizeHomeV2TransactionJournal(journal, now)
  return Object.freeze({
    entries: Object.freeze(current.entries.filter((entry) => entry.network !== input.network || entry.signature !== signature)),
    version: 1,
  })
}

export function getHomeV2PendingTransactions(
  journal: HomeV2TransactionJournal,
  input: {
    readonly accountId: string
    readonly appIdentity: string
    readonly network: HomeV2AppNetwork
  },
  now = Date.now(),
) {
  const current = sanitizeHomeV2TransactionJournal(journal, now)
  return current.entries.filter((entry) =>
    entry.accountId === input.accountId &&
    entry.appIdentity === input.appIdentity &&
    entry.network === input.network,
  )
}

export function toHomeV2PendingTransactionResult(
  entry: HomeV2PendingTransaction,
): HomeV2PendingTransactionResult {
  return Object.freeze({
    action: entry.action,
    createdAt: entry.createdAt,
    network: entry.network,
    signature: entry.signature,
    ...(entry.stage ? { stage: entry.stage } : {}),
    target: entry.target,
    timestamp: entry.timestamp,
  })
}

// The action families whose journal keys come from specific request fields.
// Membership here is the FIELD-OWNERSHIP map: an action derives its conflict
// key only from the fields its own normalizer actually consumes, so a field
// it ignores can never move it onto a different key.
const DIRECT_CHAT_JOURNAL_ACTIONS = new Set<string>([
  'SEND_DIRECT_CHAT_DELETE',
  'SEND_DIRECT_CHAT_EDIT',
  'SEND_DIRECT_CHAT_MESSAGE',
  'SEND_DIRECT_CHAT_REACTION',
])
const PUBLIC_CHAT_JOURNAL_ACTIONS = new Set<string>([
  'SEND_CHAT_DELETE',
  'SEND_CHAT_EDIT',
  'SEND_CHAT_MESSAGE',
  'SEND_CHAT_REACTION',
])
const PRIVATE_GROUP_JOURNAL_ACTIONS = new Set<string>([
  'REQUEST_PRIVATE_GROUP_CHAT_KEY',
  'RESOLVE_PRIVATE_GROUP_CHAT_KEY_REQUESTS',
  'ROTATE_PRIVATE_GROUP_CHAT_KEY',
  'SEND_PRIVATE_GROUP_CHAT_DELETE',
  'SEND_PRIVATE_GROUP_CHAT_EDIT',
  'SEND_PRIVATE_GROUP_CHAT_MESSAGE',
  'SEND_PRIVATE_GROUP_CHAT_REACTION',
])
const GROUP_TARGET_JOURNAL_ACTIONS = new Set<string>([
  'ADD_GROUP_ADMIN',
  'APPROVE_GROUP_JOIN_REQUEST',
  'BAN_FROM_GROUP',
  'CANCEL_GROUP_BAN',
  'CANCEL_GROUP_INVITE',
  'GROUP_BAN',
  'GROUP_KICK',
  'INVITE_TO_GROUP',
  'JOIN_GROUP',
  'KICK_FROM_GROUP',
  'LEAVE_GROUP',
  'REMOVE_GROUP_ADMIN',
])
/**
 * The action compared when matching a retained conflict. GROUP_BAN and
 * BAN_FROM_GROUP (and the kick pair) are 1.x aliases of one operation —
 * comparing raw names would let the alias spelling slip past the other
 * spelling's retained unknown-outcome block (security review 2026-08-26,
 * round 2).
 */
function journalConflictActionKey(action: string) {
  // The three QDN resource writes share ONE conflict key: a multi-publish
  // item IS a PUBLISH_QDN_RESOURCE transaction, and a publish and a delete
  // of the same coordinate are order-dependent writes to one resource — an
  // ambiguous delete must be reconciled before the same coordinate is
  // published again (and vice versa), rather than letting a different
  // action spelling slip past the retained block. Targets still match
  // per-coordinate (multi's request-level derivation stays coarse).
  if (
    action === 'PUBLISH_MULTIPLE_QDN_RESOURCES' ||
    action === 'DELETE_QDN_RESOURCE'
  ) return 'PUBLISH_QDN_RESOURCE'
  return GROUP_TARGET_JOURNAL_ACTIONS.has(action)
    ? canonicalHomeV2GroupAdminAction(action as HomeV2GroupAdminAction)
    : action
}

const OPERATION_TARGET = Object.freeze({ kind: 'operation' } as const)

// Lenient wrapper: derivation runs BEFORE the action handler validates the
// request, so a value the journal's own validator rejects falls to the
// coarse operation target and the handler then refuses the request with its
// own named error — the journal must never be the thing that rejects it
// first. (The pre-polls derivation threw instead; falling coarse only ever
// blocks MORE.) The journal validator is deliberately looser than the
// handlers on a few bounds — e.g. a group id of 0 is a valid PUBLIC-chat key
// — so a value it accepts can still be one a handler refuses; the handler
// remains the authority, and a specific-but-doomed key blocks no less than a
// coarse one for that request.
function derivedTarget(candidate: unknown): HomeV2TransactionTarget {
  try {
    return normalizeTarget(candidate)
  } catch {
    return OPERATION_TARGET
  }
}

/**
 * The conflict/recording key for one journaled mutation, derived from
 * EXACTLY the request fields that ACTION's own normalizer consumes, in the
 * same precedence (security review 2026-08-26, finding 3 through round 3):
 * with any looser derivation, an app could vary an IGNORED field — a stray
 * `pollId` or `txGroupId` on a direct send, a stray `conversation` on a chat
 * send, a decoy nested `resource` on a publish — to move the same logical
 * operation onto a different conflict key and slip past its retained
 * unknown-outcome block. The per-family field reads below each cite the
 * normalizer they mirror; keep them in lockstep.
 */
export function homeV2TransactionTargetFromRequest(action: string, value: unknown): HomeV2TransactionTarget {
  if (!isRecord(value)) return OPERATION_TARGET
  if (action === 'VOTE_ON_POLL' || action === 'UPDATE_POLL') {
    // normalizeHomeV2VoteOnPollRequest / UpdatePoll: pollId ?? poll.
    const raw = value.pollId ?? value.poll
    const pollId = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw.trim()) : NaN
    if (Number.isSafeInteger(pollId) && pollId >= 1) {
      return derivedTarget({ kind: 'poll', pollId })
    }
    return OPERATION_TARGET
  }
  if (action === 'UPDATE_GROUP' || action === 'SET_GROUP_AVATAR') {
    // Their normalizers read groupId with payload-first precedence; the
    // journal reads the same field leniently.
    const payload = isRecord(value.payload) ? value.payload : null
    const raw = (payload?.groupId ?? value.groupId)
    const groupId = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw.trim()) : NaN
    if (Number.isSafeInteger(groupId) && groupId >= 1) return derivedTarget({ kind: 'group', groupId })
    return OPERATION_TARGET
  }
  if (action === 'GROUP_APPROVAL') {
    const payload = isRecord(value.payload) ? value.payload : null
    const raw = payload?.pendingSignature ?? value.pendingSignature
    if (typeof raw === 'string' && raw.trim()) return derivedTarget({ kind: 'transaction', signature: raw.trim() })
    return OPERATION_TARGET
  }
  if (action === 'CREATE_GROUP' || action === 'SET_GROUP') return OPERATION_TARGET
  if (DIRECT_CHAT_JOURNAL_ACTIONS.has(action)) {
    // normalizeHomeV2DirectChatWriteRequest: otherAddress ?? recipientAddress.
    const address = value.otherAddress ?? value.recipientAddress
    return address !== undefined ? derivedTarget({ kind: 'direct', otherAddress: address }) : OPERATION_TARGET
  }
  if (PUBLIC_CHAT_JOURNAL_ACTIONS.has(action)) {
    // normalizeHomeV2PublicChatRequest: txGroupId (top-level only).
    return value.txGroupId !== undefined
      ? derivedTarget({ kind: 'group', groupId: value.txGroupId })
      : OPERATION_TARGET
  }
  if (PRIVATE_GROUP_JOURNAL_ACTIONS.has(action)) {
    // home-v2-private-group-chat-contract normalizeGroupId: groupId ?? txGroupId.
    const raw = value.groupId ?? value.txGroupId
    return raw !== undefined ? derivedTarget({ kind: 'group', groupId: raw }) : OPERATION_TARGET
  }
  if (GROUP_TARGET_JOURNAL_ACTIONS.has(action)) {
    // The membership/admin normalizers read groupId.
    return value.groupId !== undefined
      ? derivedTarget({ kind: 'group', groupId: value.groupId })
      : OPERATION_TARGET
  }
  if (action === 'PUBLISH_CHAT_ATTACHMENT') {
    // normalizeHomeV2PrivateAttachmentPublishRequest requires `conversation`.
    const conversation = isRecord(value.conversation) ? value.conversation : null
    if (conversation?.kind === 'group') return derivedTarget({ kind: 'group', groupId: conversation.groupId })
    if (conversation?.kind === 'direct') return derivedTarget({ kind: 'direct', otherAddress: conversation.otherAddress })
    return OPERATION_TARGET
  }
  if (action === 'RATE_ACCOUNT') {
    // normalizeHomeV2RateAccountRequest reads targetPublicKey + category
    // payload-first; the journal reads the same fields leniently.
    const payload = isRecord(value.payload) ? value.payload : null
    const targetPublicKey = payload?.targetPublicKey ?? value.targetPublicKey
    const category = payload?.category ?? value.category
    if (typeof targetPublicKey === 'string' && targetPublicKey.trim() && typeof category === 'string' && category.trim()) {
      return derivedTarget({
        category: category.trim().toUpperCase(),
        kind: 'account-rating',
        targetPublicKey: targetPublicKey.trim(),
      })
    }
    return OPERATION_TARGET
  }
  if (action === 'PUBLISH_QDN_RESOURCE' || action === 'DELETE_QDN_RESOURCE' || action === 'RATE_RESOURCE') {
    // getQdnWriteResourceRequest reads flat service/name/identifier with the
    // payload fallback (qdn-request-values getRequestValue); the delete and
    // resource-rating normalizers consume the same coordinate fields. The literal
    // identifier 'default' and an absent identifier are ONE coordinate on
    // chain (the delete normalizer maps 'default' to null, and the builders
    // treat them alike), so both spellings canonicalize to null here —
    // otherwise resubmitting the same operation with the other spelling
    // would derive a different key and slip the retained block.
    const payload = isRecord(value.payload) ? value.payload : null
    // CANONICAL spelling, matching what every consumer's normalizer signs:
    // all three fields trim (qdn-request-values getString and the rating
    // normalizer both do), service uppercases, and a trimmed ''/'default'
    // identifier is the null coordinate — otherwise a whitespace- or
    // case-wrapped resubmission of the same signed operation would derive a
    // different key and slip the retained block (ratings review round 1).
    const trimmed = (candidate: unknown) => typeof candidate === 'string' ? candidate.trim() : ''
    const service = trimmed(payload?.service ?? value.service).toUpperCase()
    const name = trimmed(payload?.name ?? value.name)
    const identifier = trimmed(payload?.identifier ?? value.identifier)
    if (service && name) {
      return derivedTarget({
        identifier: identifier && identifier !== 'default' ? identifier : null,
        kind: 'resource',
        name,
        service,
      })
    }
    return OPERATION_TARGET
  }
  // SEND_MESSAGE, CREATE_POLL, and anything future land here: the coarse
  // per-app-and-account operation target, which errs toward blocking.
  return OPERATION_TARGET
}

/**
 * Whether a retained entry blocks a request deriving `derived`. An operation
 * target is coarse BY DEFINITION — it blocks every request of its action —
 * and an entry recorded under a PRE-version-2 derivation is treated the same
 * way: its stored target may have been moved by a decoy field the old
 * derivation trusted, so its true subject is unknowable and the whole action
 * blocks until it is reconciled or expires. Blocking more is the safe
 * direction; reconciliation (GET_PENDING_TRANSACTIONS +
 * FORGET_PENDING_TRANSACTION by signature) and the 30-day expiry clear such
 * entries exactly as before. (Security review 2026-08-26, round 4.)
 */
function journalTargetsConflict(entry: HomeV2PendingTransaction, derived: HomeV2TransactionTarget) {
  if (entry.derivation !== 2) return true
  if (entry.target.kind === 'operation' || derived.kind === 'operation') return true
  return JSON.stringify(entry.target) === JSON.stringify(derived)
}

export function findHomeV2PendingTransactionConflict(
  journal: HomeV2TransactionJournal,
  input: {
    readonly accountId: string
    readonly action: string
    readonly appIdentity: string
    readonly network: HomeV2AppNetwork
    readonly request: unknown
  },
  now = Date.now(),
): HomeV2PendingTransaction | null {
  if (!isHomeV2JournaledMutation(input.action)) return null
  const target = homeV2TransactionTargetFromRequest(input.action, input.request)
  return getHomeV2PendingTransactions(journal, input, now).find((entry) =>
    journalConflictActionKey(entry.action) === journalConflictActionKey(input.action) &&
    entry.stage !== 'key-announcement' &&
    journalTargetsConflict(entry, target),
  ) ?? null
}

export function createHomeV2PendingTransactionFromResult(input: {
  readonly accountId: string
  readonly action: string
  readonly appIdentity: string
  readonly now?: number
  readonly protocol: HomeV2AppBridgeProtocol
  readonly request: unknown
  readonly result: unknown
}): HomeV2PendingTransaction | null {
  if (!isHomeV2JournaledMutation(input.action) || !isRecord(input.result) || input.result.outcome !== 'unknown') {
    return null
  }
  const signature = typeof input.result.signature === 'string'
    ? input.result.signature
    : input.result.transactionSignature
  if (typeof signature !== 'string' || !Number.isSafeInteger(input.result.timestamp)) {
    throw new Error('Unknown transaction result is missing its signed identity.')
  }
  return sanitizeHomeV2PendingTransaction({
    accountId: input.accountId,
    action: input.action,
    appIdentity: input.appIdentity,
    createdAt: input.now ?? Date.now(),
    derivation: 2,
    network: input.protocol === 'qortalRequest' ? 'qortal' : 'qortium',
    protocol: input.protocol,
    signature,
    ...(input.result.stage === 'key-announcement' && input.result.messageSubmitted === false
      ? { stage: 'key-announcement' as const }
      : {}),
    target: homeV2TransactionTargetFromRequest(input.action, input.request),
    timestamp: input.result.timestamp,
  })
}

export function normalizeHomeV2ForgetPendingTransactionRequest(
  protocol: HomeV2AppBridgeProtocol,
  value: unknown,
) {
  if (!isRecord(value)) throw new Error('Pending transaction request must be an object.')
  const network = protocol === 'qortalRequest' ? 'qortal' : 'qortium'
  if (value.network !== undefined && value.network !== network) {
    throw new Error(`Pending transaction network must match ${protocol}.`)
  }
  return Object.freeze({ network, signature: canonicalSignature(value.signature) })
}
