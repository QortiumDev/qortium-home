import type { ArrrWalletSessionRequest } from './arrr-wallet-session.js'
// Home 2 desktop ARRR custody read — the privileged orchestration, with its
// dependencies injected so the boundary can be EXECUTED under test:
// denial before any seed access, trust revoked while queued → no dispatch,
// account locked while the HTTP request is in flight → no delivery.
//
// home-v2-app-bridge.ts is the only production caller; it wires the real
// resolver (resolveHomeV2AdminNode), permission gate, session-grant epoch,
// account seed access, node transport and per-route queue into `deps`.
//
// No Electron import here. node:crypto is used only by the digest wrapper
// exported at the bottom, so the wrapper the bridge really runs is the one
// the tests instrument.

import { createHash } from 'node:crypto'

import {
  HOME_V2_ARRR_SYNC_STATUS_ACTION,
  executeArrrCustodyRead,
  homeV2ArrrBalanceVerified,
  homeV2ArrrCustodyConsentBinding,
  type ArrrCustodyCrypto,
  type ArrrCustodyError,
  type ArrrCustodyQueueMeta,
  type ArrrCustodyReadQueue,
  type ArrrCustodyReadRequest,
  type ArrrCustodyReadResult,
  type ArrrCustodyResponse,
  type HomeV2ArrrCustodyConsentBinding,
  type HomeV2ArrrCustodyReadAction,
} from './arrr-custody.js'

/**
 * What the orchestrator needs to know about the resolved admin route. The
 * API key is the only secret and it never leaves `post`. `revision` is the
 * main-process-only credential digest (home-v2-admin-trust.ts) — compared
 * here, never exported; `bindingId` is the random attachment id.
 */
export type ArrrCustodyRoute = Readonly<{
  apiKey: string
  bindingId: string
  nodeApiUrl: string
  nodeRoute: string
  /** The trust refusal reason when `trusted` is false (home-v2-admin-trust.ts), else null. */
  reason: string | null
  revision: string
  trusted: boolean
}>

export type ArrrCustodyReadDeps<Context> = Readonly<{
  action: HomeV2ArrrCustodyReadAction
  sessionRequest?: ArrrWalletSessionRequest
  /** Throws the bridge's NODE_CAPABILITY_MISSING error for an untrusted route. */
  assertTrusted: (route: ArrrCustodyRoute) => void
  /** A checker captured AFTER consent that turns false on any lifecycle invalidation. */
  captureConsent: () => () => boolean
  context: Context
  contextAccountId: (context: Context) => string | null
  crypto: ArrrCustodyCrypto
  /** The live view context for the requesting sender, or null if it is gone. */
  freshContext: () => Context | null
  /** The unlocked account's seed material (copied; zeroed here in finally). */
  getSeed: (accountId: string) => Readonly<{ addressIndex: number; seed: Uint8Array; walletVersion: number }>
  isAccountUnlocked: (accountId: string) => boolean
  liveResourceMatchesGrant: (context: Context) => boolean
  /** The bridge's ACCOUNT_LOCKED error. */
  lockedError: () => Error
  post: (route: ArrrCustodyRoute, request: ArrrCustodyReadRequest) => Promise<ArrrCustodyResponse>
  /** Identifies the requesting app tab for backlog bounds and cancellation. */
  principalKey: string
  queue: ArrrCustodyReadQueue
  /** Extra facts stored on the queued task for lifecycle cancellation. */
  queueTags?: Readonly<Record<string, string | number>>
  requestValue: Record<string, unknown>
  /** The permission gate (requireAccountReadPermission) for the custody kind. */
  requireConsent: (binding: HomeV2ArrrCustodyConsentBinding) => Promise<void>
  resolveRoute: () => Promise<ArrrCustodyRoute>
  sameViewContext: (before: Context, after: Context) => boolean
}>

export const ARRR_CUSTODY_CONTEXT_CHANGED_MESSAGE = 'Account access context changed before the ARRR wallet read completed.'
export const ARRR_CUSTODY_ROUTE_CHANGED_MESSAGE = 'The selected Qortium node or its API key changed before the ARRR wallet read completed.'

function sameRouteBinding(before: ArrrCustodyRoute, after: ArrrCustodyRoute) {
  return after.trusted &&
    before.trusted &&
    after.nodeRoute === before.nodeRoute &&
    after.nodeApiUrl === before.nodeApiUrl &&
    after.bindingId === before.bindingId &&
    after.revision === before.revision
}

/**
 * One ARRR custody read, start to finish. The sequence, and where each
 * recheck sits, is the whole point:
 *
 *   1. request shape (before any prompt)
 *   2. admin-trusted route + unlocked account (before any prompt)
 *   3. consent (prompt / session grant), pinned to that route
 *   4. post-approval: the COMPLETE validation (below)
 *   5. queued per Core route
 *   6. inside the queue, after the wait: the complete validation — THEN the
 *      seed is read, the entropy derived and the request posted
 *   7. after the HTTP await: the complete validation again, and the result
 *      is returned synchronously from the same snapshot that passed it
 *
 * "Complete validation" is `validate → await resolveRoute → validate again →
 * compare route`: every await inside it is followed by the FULL set of cheap
 * checks (consent epoch, fresh view context = same tab and same account,
 * unlock, live resource), never a partial one, so a switch that lands during
 * the route resolution is caught before any seed read, post or delivery.
 */
export async function runHomeV2ArrrCustodyRead<Context>(
  deps: ArrrCustodyReadDeps<Context>,
): Promise<ArrrCustodyReadResult['result']> {
  const { action, context } = deps
  const verified = action === 'GET_WALLET_BALANCE' ? homeV2ArrrBalanceVerified(deps.requestValue) : undefined
  const initial = await deps.resolveRoute()
  deps.assertTrusted(initial)
  const accountId = deps.contextAccountId(context)
  if (!accountId || !deps.isAccountUnlocked(accountId)) throw deps.lockedError()
  const consent = homeV2ArrrCustodyConsentBinding({
    adminNode: { nodeApiUrl: initial.nodeApiUrl, nodeRoute: initial.nodeRoute },
  })
  await deps.requireConsent(consent)
  const consentCurrent = deps.captureConsent()

  // The synchronous part: no await inside, so what it observed is what holds
  // at the moment it returns.
  const validateNow = () => {
    if (!consentCurrent()) throw new Error(ARRR_CUSTODY_CONTEXT_CHANGED_MESSAGE)
    const fresh = deps.freshContext()
    if (!fresh || !deps.sameViewContext(context, fresh) || deps.contextAccountId(fresh) !== accountId) {
      throw new Error(ARRR_CUSTODY_CONTEXT_CHANGED_MESSAGE)
    }
    if (!deps.isAccountUnlocked(accountId) || !deps.liveResourceMatchesGrant(fresh)) {
      throw new Error(ARRR_CUSTODY_CONTEXT_CHANGED_MESSAGE)
    }
  }

  const assertStillValid = async (): Promise<ArrrCustodyRoute> => {
    validateNow()
    const route = await deps.resolveRoute()
    // The resolver was an await: repeat the COMPLETE validation, then compare
    // the route, with nothing awaited in between.
    validateNow()
    deps.assertTrusted(route)
    if (!sameRouteBinding(initial, route)) throw new Error(ARRR_CUSTODY_ROUTE_CHANGED_MESSAGE)
    return route
  }

  // Post-approval, pre-queue.
  await assertStillValid()

  const coalesceKey = action === HOME_V2_ARRR_SYNC_STATUS_ACTION
    ? `${deps.principalKey}|${accountId}|${action}`
    : undefined

  return deps.queue.run(initial.nodeRoute, async () => {
    // After the queue wait: nothing captured before it is trusted. The seed
    // is read synchronously after the validation that passed.
    const route = await assertStillValid()
    const seed = deps.getSeed(accountId)
    let result: ArrrCustodyReadResult['result']
    try {
      result = await executeArrrCustodyRead({
        action,
        sessionRequest: deps.sessionRequest,
        crypto: deps.crypto,
        nonce: seed.addressIndex,
        post: (request) => deps.post(route, request),
        seed: seed.seed,
        verified,
        walletVersion: seed.walletVersion,
      })
    } finally {
      seed.seed.fill(0)
    }
    // After the HTTP await: deliver only into the context that asked, and
    // return synchronously from the snapshot that just passed.
    await assertStillValid()
    return result
  }, { coalesceKey, principalKey: deps.principalKey, tags: deps.queueTags })
}

// ---------------------------------------------------------------------------
// Pure seams the bridge wires in (each executed under test)

/** The shape resolveHomeV2AdminNode returns, reduced to what the route projection reads. */
export type ArrrCustodyAdminResolution = Readonly<{
  apiKey: string
  node: Readonly<{ nodeApiUrl: string }>
  nodeRoute: string
  trust: Readonly<{ trusted: true; apiKey: string; bindingId: string; revision: string }>
    | Readonly<{ trusted: false; reason: string }>
}>

/**
 * Project an admin resolution into the orchestrator's route. An untrusted
 * resolution carries NO key, binding or credential digest — only the reason.
 */
export function projectArrrCustodyRoute(resolved: ArrrCustodyAdminResolution): ArrrCustodyRoute {
  if (!resolved.trust.trusted) {
    return Object.freeze({
      apiKey: '',
      bindingId: '',
      nodeApiUrl: resolved.node.nodeApiUrl,
      nodeRoute: resolved.nodeRoute,
      reason: resolved.trust.reason,
      revision: '',
      trusted: false,
    })
  }
  return Object.freeze({
    apiKey: resolved.apiKey,
    bindingId: resolved.trust.bindingId,
    nodeApiUrl: resolved.node.nodeApiUrl,
    nodeRoute: resolved.nodeRoute,
    reason: null,
    // Main-process-only credential digest: compared by the orchestrator,
    // never copied into an error or a result (review finding 3).
    revision: resolved.trust.revision,
    trusted: true,
  })
}

export type ArrrCustodyBridgeErrorDetails = Readonly<{
  action: string
  code: string
  network: 'qortium'
  retryable: boolean
  routeRevision: string
}>

/**
 * The details an ARRR custody error is re-thrown with. `routeRevision` is the
 * PUBLIC runtime revision the caller passes (home-v2-app-runtime); the route's
 * credential digest is not an input here at all, so it cannot leak.
 */
export function arrrCustodyBridgeErrorDetails(
  error: ArrrCustodyError,
  action: string,
  publicRouteRevision: string,
): ArrrCustodyBridgeErrorDetails {
  return Object.freeze({
    action,
    code: error.code,
    network: 'qortium',
    retryable: error.retryable,
    routeRevision: publicRouteRevision,
  })
}

export type ArrrCustodyInvalidation = Readonly<{
  kind: string
  tabId: string | null
}>

/**
 * Which queued ARRR reads a runtime invalidation cancels: account, lock and
 * node changes end every queued read for that host window; tab-scoped
 * changes (tab closed, app replaced, navigation) end that tab's.
 */
export function arrrCustodyCancelsQueuedRead(
  hostWebContentsId: number,
  invalidation: ArrrCustodyInvalidation,
  meta: ArrrCustodyQueueMeta,
): boolean {
  if (meta.tags?.hostWebContentsId !== hostWebContentsId) return false
  if (invalidation.kind === 'account-changed' || invalidation.kind === 'locked' || invalidation.kind === 'node-changed') return true
  return invalidation.tabId !== null && meta.tags?.tabId === invalidation.tabId
}

/**
 * Whether an admin-trust answer taken BEFORE an await still stands AFTER it:
 * same route and same credential revision, and still trusted.
 */
export function adminTrustUnchangedAcrossAwait(
  before: Readonly<{ nodeRoute: string; trust: Readonly<{ trusted: boolean; revision?: string }> }>,
  after: Readonly<{ nodeRoute: string; trust: Readonly<{ trusted: boolean; revision?: string }> }>,
): boolean {
  return before.trust.trusted &&
    after.trust.trusted &&
    after.nodeRoute === before.nodeRoute &&
    after.trust.revision === before.trust.revision
}

/**
 * The digest wrapper the bridge hands to the derivation. It returns the
 * OWNED Buffer node:crypto produced — no `Uint8Array.from` copy that would
 * leave the original digest (the last one holds the raw entropy) unzeroed —
 * so withArrrEntropy58's `finally` wipes the only copy.
 */
export function createArrrCustodyNodeCrypto(): ArrrCustodyCrypto {
  return Object.freeze({
    sha256: (data: Uint8Array) => createHash('sha256').update(data).digest(),
    sha512: (data: Uint8Array) => createHash('sha512').update(data).digest(),
  })
}
