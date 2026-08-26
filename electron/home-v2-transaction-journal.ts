import { base58Decode, base58Encode } from './base58.js'
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
  'SEND_PRIVATE_GROUP_CHAT_DELETE',
  'SEND_PRIVATE_GROUP_CHAT_EDIT',
  'SEND_PRIVATE_GROUP_CHAT_MESSAGE',
  'SEND_PRIVATE_GROUP_CHAT_REACTION',
] as const)

export type HomeV2JournaledMutation = (typeof HOME_V2_JOURNALED_MUTATIONS)[number]

export type HomeV2TransactionTarget =
  | { readonly kind: 'direct'; readonly otherAddress: string }
  | { readonly kind: 'group'; readonly groupId: number }
  | { readonly kind: 'poll'; readonly pollId: number }
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
    if (!Number.isSafeInteger(value.groupId) || Number(value.groupId) < 0) {
      throw new Error('Pending transaction group target is invalid.')
    }
    return Object.freeze({ kind: 'group', groupId: Number(value.groupId) })
  }
  if (value.kind === 'poll') {
    if (!Number.isSafeInteger(value.pollId) || Number(value.pollId) < 1) {
      throw new Error('Pending transaction poll target is invalid.')
    }
    return Object.freeze({ kind: 'poll', pollId: Number(value.pollId) })
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

export function homeV2TransactionTargetFromRequest(value: unknown): HomeV2TransactionTarget {
  if (!isRecord(value)) return Object.freeze({ kind: 'operation' })
  const conversation = isRecord(value.conversation) ? value.conversation : null
  if (conversation?.kind === 'group') return normalizeTarget({ kind: 'group', groupId: conversation.groupId })
  if (conversation?.kind === 'direct') return normalizeTarget({ kind: 'direct', otherAddress: conversation.otherAddress })
  // Poll requests are checked BEFORE the txGroupId fallback: they may carry
  // an explicit txGroupId:0 (a 1.x-parity field pinned to 0), and mapping
  // that to {kind:'group', groupId:0} would give the same logical operation
  // two different conflict keys depending on an optional field. CREATE_POLL
  // carries pollName but no id, so it deliberately falls through to the
  // coarse {kind:'operation'} target.
  if (value.pollId !== undefined || value.poll !== undefined) {
    // Lenient on purpose: this runs BEFORE the action handler validates the
    // request, and 1.x accepts string integers here. A malformed id falls to
    // the coarse operation target and the handler then refuses the request
    // with its own named error — the journal must never be the thing that
    // rejects it first.
    const raw = value.pollId ?? value.poll
    const pollId = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw.trim()) : NaN
    if (Number.isSafeInteger(pollId) && pollId >= 1) {
      return normalizeTarget({ kind: 'poll', pollId })
    }
    return Object.freeze({ kind: 'operation' })
  }
  if (value.pollName !== undefined) return Object.freeze({ kind: 'operation' })
  if (value.txGroupId !== undefined) return normalizeTarget({ kind: 'group', groupId: value.txGroupId })
  if (value.groupId !== undefined) return normalizeTarget({ kind: 'group', groupId: value.groupId })
  if (value.otherAddress !== undefined) return normalizeTarget({ kind: 'direct', otherAddress: value.otherAddress })
  if (isRecord(value.resource)) {
    return normalizeTarget({
      identifier: value.resource.identifier ?? null,
      kind: 'resource',
      name: value.resource.name,
      service: value.resource.service,
    })
  }
  return Object.freeze({ kind: 'operation' })
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
  const target = homeV2TransactionTargetFromRequest(input.request)
  return getHomeV2PendingTransactions(journal, input, now).find((entry) =>
    entry.action === input.action &&
    entry.stage !== 'key-announcement' &&
    JSON.stringify(entry.target) === JSON.stringify(target),
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
    network: input.protocol === 'qortalRequest' ? 'qortal' : 'qortium',
    protocol: input.protocol,
    signature,
    ...(input.result.stage === 'key-announcement' && input.result.messageSubmitted === false
      ? { stage: 'key-announcement' as const }
      : {}),
    target: homeV2TransactionTargetFromRequest(input.request),
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
