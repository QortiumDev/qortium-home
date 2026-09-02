import {
  FOREIGN_WALLET_SPEND_CONTEXT_RESPONSE_MAX_BYTES,
  buildForeignWalletSpendContextRequest,
  getForeignWalletMainnetChainId,
  normalizeForeignWalletSpendContext,
  type ForeignWalletSpendContext,
} from './foreign-wallet-spend-context.js'
import { normalizeForeignWalletReadError } from './foreign-wallet-read-contract.js'
import {
  assertForeignWalletContextWithinPolicy,
  assertForeignWalletPlanWithinPolicy,
} from './foreign-wallet-policy-bounds.js'
import {
  foreignWalletReconciliationRefusal,
  reconcileForeignWalletPendingTransactions,
  FOREIGN_WALLET_SEND_FRESHNESS_MS,
  HomeV2ForeignSendReconciliationPendingError,
} from './foreign-wallet-reconciliation.js'
import { runForeignWalletOperationExclusive } from './foreign-wallet-operation-lock.js'
import { planForeignWalletSpend, type ForeignWalletSpendPlan } from './foreign-wallet-spend-plan.js'
import {
  buildForeignWalletSignedTransaction,
  createForeignWalletPreviousTransactionCache,
  type ForeignWalletPreviousTransactionCache,
  type ForeignWalletWatchInput,
} from './foreign-wallet-transaction.js'
import type {
  ForeignWalletPendingOutpoint,
  ForeignWalletPendingTransaction,
} from './foreign-wallet-transaction-journal.js'
import { normalizeConfirmedForeignWalletTransactionId } from './foreign-wallet-transaction-journal.js'
import {
  deriveForeignWalletPublicRuntime,
  fingerprintForeignWalletPublicRuntime,
  type ForeignWalletCoin,
  type ForeignWalletCrypto,
  type ForeignWalletPublicRuntime,
} from './foreign-wallets.js'
import {
  buildHomeV2ForeignSendApprovalRows,
  homeV2ForeignAtomicToDecimal,
  homeV2ForeignSendApprovalTarget,
  homeV2ForeignSendOperationLabel,
  normalizeHomeV2ForeignSendRequest,
  resolveHomeV2ForeignSendFeePerByte,
} from './home-v2-foreign-send-actions.js'

/**
 * Foreign-coin sending, end to end, with every dependency injected.
 *
 * Home plans, signs and hashes the transaction here. Core is used for exactly
 * two things: reading the wallet's confirmed spendable state (the spend
 * context) and relaying the finished bytes. It never sees a seed, a private
 * key or an xprv, and it is never asked to build or sign anything.
 *
 * The order below is the whole security argument, and none of it may be
 * reordered:
 *
 *   lock -> read state -> plan -> journal-conflict check -> APPROVE ->
 *   re-read and re-plan and refuse on ANY drift -> sign ->
 *   write-ahead the signed transaction -> mark broadcast attempted ->
 *   exactly ONE broadcast -> clear the journal only on an exact txid match.
 *
 * The write-ahead log is what makes a single broadcast safe: after the entry
 * exists, an ambiguous or failed broadcast is never retried, and the same
 * outpoints cannot be planned again until the retained entry is reconciled.
 *
 * RESULT SHAPE (what the calling QDN app receives). It is deliberately
 * compatible with the qortium-wallet renderer, which reads `prepared` through
 * `PreparedTransactionPreview`:
 *
 *   {
 *     accepted: boolean,
 *     action: 'SEND_COIN', coin, chainId, network: 'qortium',
 *     recipient, txId, transactionHash,          // display (reversed) hex
 *     prepared: {
 *       activeNetwork, blockchain, currencyCode,
 *       amount, fee, feePerByte,                 // 8-place COIN decimals
 *       inputAmount, outputAmount,               // 8-place COIN decimals
 *       inputCount, outputCount, transactionSize,
 *       receivingAddress, sendMax, txHash,
 *     },
 *     journalCleared?: boolean, cleanupError?: string,
 *     foreignOutcome?: 'mismatch' | 'unknown', error?, errorType?, retryable?
 *   }
 *
 * Every money field in `prepared` is an 8-place decimal string, so it always
 * carries a decimal point. The wallet's `formatAtomicAmount` passes such a
 * string through unchanged, while it would divide a bare integer by 1e8.
 *
 * There is NEVER a top-level `outcome` or `transactionSignature`. Those two
 * field names are what `createHomeV2PendingTransactionFromResult` keys the
 * NATIVE Base58 journal on: a foreign result carrying them would be written
 * into that journal as an unknown-outcome payment, which fail-closes every
 * native payment for the account. Foreign ambiguity is reported as
 * `foreignOutcome` and retained in the foreign journal instead.
 */

const BROADCAST_RESPONSE_MAX_BYTES = 8 * 1024
// The same window on purpose. Releasing a never-broadcast entry is only sound
// because a send older than this would have been refused as stale anyway, so
// the two numbers must never drift apart.
const APPROVAL_FRESHNESS_MS = FOREIGN_WALLET_SEND_FRESHNESS_MS

export type HomeV2ForeignSendApprovalMeta = Readonly<{
  chainId: string
  coin: ForeignWalletCoin
  kind: 'foreign-send'
  operationLabel: string
  target: string
}>

export type HomeV2ForeignSendRoute = Readonly<{
  apiKey: string
  nodeApiUrl: string
  revision: string
  routeLabel: string
}>

export type HomeV2ForeignSendJournalKey = Pick<
  ForeignWalletPendingTransaction,
  'chainId' | 'coin' | 'txId' | 'walletFingerprint'
>

export type HomeV2ForeignSendDeps = Readonly<{
  appIdentity: string
  approve(
    rows: readonly { readonly label: string; readonly value: string }[],
    meta: HomeV2ForeignSendApprovalMeta,
  ): Promise<void>
  crypto: ForeignWalletCrypto
  isStillValid(): Promise<boolean>
  journal: Readonly<{
    confirmBroadcastSuccess(
      key: HomeV2ForeignSendJournalKey,
      returnedTxId: unknown,
    ): { readonly cleanupError?: string; readonly journalCleared: boolean }
    clearReconciled(key: HomeV2ForeignSendJournalKey, observedTxId: string): unknown
    releaseNeverBroadcast(key: HomeV2ForeignSendJournalKey, now: number): unknown
    findConflict(input: Pick<
      ForeignWalletPendingTransaction,
      'chainId' | 'coin' | 'outpoints' | 'walletFingerprint'
    >): ForeignWalletPendingTransaction | undefined
    listPending(input: Pick<
      ForeignWalletPendingTransaction,
      'chainId' | 'coin' | 'walletFingerprint'
    >): readonly ForeignWalletPendingTransaction[]
    recordBroadcastAttempt(key: HomeV2ForeignSendJournalKey, now: number): unknown
    recordSigned(entry: ForeignWalletPendingTransaction): unknown
  }>
  now(): number
  // The wallet's own confirmed/unconfirmed history, used ONLY to settle a
  // retained write-ahead entry against the exact transaction id Home signed.
  // The result never reaches the calling app.
  readWalletHistory(wallet: ForeignWalletPublicRuntime): Promise<unknown>
  postTrusted(
    pathname: string,
    body: string,
    contentType: 'application/json' | 'text/plain',
    maxBytes: number,
  ): Promise<unknown>
  resolveRoute(): Promise<HomeV2ForeignSendRoute>
  withWalletSeed<T>(use: (seed: Uint8Array, nonce: number, walletVersion: number) => T): T
}>

/**
 * The live-context guard, with its ordering made explicit and testable.
 *
 * The obvious way to write this guard reads the view, the account and the
 * unlock state, THEN awaits the node resolution and returns. That answer
 * describes the world as it was before the await: an app that navigates, an
 * account that locks, or a view that is replaced while the node is being
 * resolved all slip through, and the caller signs on the strength of a
 * snapshot the guard itself invalidated.
 *
 * So the await comes FIRST, and every mutable input is re-read after it and
 * returned with no further await. The answer then describes the moment it is
 * given, which is the only moment the caller can act on.
 */
export async function evaluateHomeV2ForeignSendValidity(input: Readonly<{
  pinnedRoute: string
  readAccountUnlocked: () => boolean
  readLiveContextMatches: () => boolean
  resolveRoute: () => Promise<string | null>
}>): Promise<boolean> {
  const route = await input.resolveRoute().catch(() => null)
  if (route === null || route !== input.pinnedRoute) return false
  return input.readLiveContextMatches() && input.readAccountUnlocked()
}

export class HomeV2ForeignSendReconciliationError extends Error {
  readonly code = 'FOREIGN_SEND_RECONCILIATION_REQUIRED'
}

export type HomeV2ForeignSendResult = Readonly<Record<string, unknown>>

function outpointsOf(plan: ForeignWalletSpendPlan): readonly ForeignWalletPendingOutpoint[] {
  return plan.inputs.map((input) => Object.freeze({ outputIndex: input.txPos, txHash: input.txHash }))
}

function outpointKey(input: Pick<ForeignWalletWatchInput, 'txHash' | 'txPos'>) {
  return `${input.txHash.toLowerCase()}:${input.txPos}`
}

function hexToBytes(value: string) {
  return Uint8Array.from(
    { length: value.length / 2 },
    (_entry, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  )
}

/**
 * A bytewise scan, deliberately NOT a string comparison.
 *
 * The obvious way to check that a payload does not contain the seed is to hex
 * the seed and look for that substring. That materializes the whole secret as
 * an immutable JS string, which cannot be zeroed and lives until the garbage
 * collector happens to reclaim it — a worse leak than the one it checks for.
 * The haystack (the signed transaction) is public; the needle stays bytes.
 */
function containsByteSequence(haystack: Uint8Array, needle: Uint8Array) {
  if (needle.byteLength === 0 || needle.byteLength > haystack.byteLength) return false
  const limit = haystack.byteLength - needle.byteLength
  for (let start = 0; start <= limit; start += 1) {
    let index = 0
    while (index < needle.byteLength && haystack[start + index] === needle[index]) index += 1
    if (index === needle.byteLength) return true
  }
  return false
}

/**
 * The spend context is the ONLY thing Core is asked for before signing, so it
 * is read through the same 1201 normalization the wallet reads use: a Core
 * that cannot reach a wallet-capable server must say "backend unavailable",
 * never "no funds", which a user could act on by sending again elsewhere.
 */
async function readSpendContext(
  deps: HomeV2ForeignSendDeps,
  coin: ForeignWalletCoin,
  xpub58: string,
): Promise<ForeignWalletSpendContext> {
  try {
    const data = await deps.postTrusted(
      `/crosschain/${coin.toLowerCase()}/wallet/public/spend-context`,
      JSON.stringify(buildForeignWalletSpendContextRequest(xpub58, coin)),
      'application/json',
      FOREIGN_WALLET_SPEND_CONTEXT_RESPONSE_MAX_BYTES,
    )
    const context = normalizeForeignWalletSpendContext(data, coin)
    // Applied on EVERY read, including the post-approval one, so a node cannot
    // pass the check once and then move the numbers underneath the plan.
    assertForeignWalletContextWithinPolicy({
      coin,
      minimumNonDustOutput: context.minimumNonDustOutput,
      recommendedFeePerByte: context.recommendedFeePerByte,
    })
    return context
  } catch (error) {
    throw normalizeForeignWalletReadError(error, coin)
  }
}

function planSpend(input: {
  amountAtomic: bigint | null
  cache: ForeignWalletPreviousTransactionCache
  coin: ForeignWalletCoin
  context: ForeignWalletSpendContext
  deps: HomeV2ForeignSendDeps
  feePerByte: bigint
  recipientAddress: string
  sendMax: boolean
}) {
  const plan = input.deps.withWalletSeed((seed, nonce, walletVersion) => planForeignWalletSpend({
    ...(input.sendMax ? {} : { amount: input.amountAtomic as bigint }),
    cache: input.cache,
    coin: input.coin,
    crypto: input.deps.crypto,
    feePerByte: input.feePerByte,
    minimumNonDustOutput: input.context.minimumNonDustOutput,
    nonce,
    recipientAddress: input.recipientAddress,
    seed,
    sendMax: input.sendMax,
    utxos: input.context.utxos,
    walletVersion,
  }))
  // The fee finally charged can exceed rate x size, because change below the
  // dust floor is absorbed into it. This is the check that sees that number.
  assertForeignWalletPlanWithinPolicy({
    amount: plan.amount,
    coin: input.coin,
    estimatedMaximumSize: plan.estimatedMaximumSize,
    fee: plan.fee,
    feePerByte: plan.feePerByte,
    sendMax: plan.sendMax,
  })
  return plan
}

/**
 * Everything the approved plan was computed from must still be exactly true.
 * A changed dust floor, fee recommendation, transaction version or input
 * value silently changes what the signature commits to, so each is compared
 * rather than merely re-planned against.
 */
function assertSpendContextUnchanged(
  before: ForeignWalletSpendContext,
  after: ForeignWalletSpendContext,
  plan: ForeignWalletSpendPlan,
) {
  if (after.chainId !== before.chainId
    || after.transactionVersion !== before.transactionVersion
    || after.minimumNonDustOutput !== before.minimumNonDustOutput
    || after.recommendedFeePerByte !== before.recommendedFeePerByte) {
    throw new Error('The foreign wallet chain state changed after the send was approved.')
  }
  const current = new Map(after.utxos.map((utxo) => [outpointKey(utxo), utxo]))
  for (const input of plan.inputs) {
    const match = current.get(outpointKey(input))
    if (!match) {
      throw new Error('An approved foreign wallet input is no longer spendable; the send was not signed.')
    }
    if (match.value !== input.value
      || match.scriptPubKey.toLowerCase() !== input.scriptPubKey.toLowerCase()
      || match.path.toUpperCase() !== input.path.toUpperCase()
      || match.address !== input.address
      || match.previousTransactionHex.toLowerCase() !== input.previousTransactionHex.toLowerCase()) {
      throw new Error('An approved foreign wallet input changed after approval; the send was not signed.')
    }
  }
}

function assertPlanUnchanged(before: ForeignWalletSpendPlan, after: ForeignWalletSpendPlan) {
  if (before.amount !== after.amount
    || before.fee !== after.fee
    || before.feePerByte !== after.feePerByte
    || before.change !== after.change
    || before.changeAddress !== after.changeAddress
    || before.recipientAddress !== after.recipientAddress
    || before.sendMax !== after.sendMax
    || before.inputAmount !== after.inputAmount
    || before.outputAmount !== after.outputAmount
    || before.inputs.length !== after.inputs.length
    || before.inputs.some((input, index) => outpointKey(input) !== outpointKey(after.inputs[index]))) {
    throw new Error('The foreign send changed between approval and signing; nothing was signed.')
  }
}

function preparedTransaction(input: {
  chainId: string
  coin: ForeignWalletCoin
  context: ForeignWalletSpendContext
  plan: ForeignWalletSpendPlan
  signed: { fee: bigint; inputAmount: bigint; outputAmount: bigint; transactionSize: number; txId: string }
}) {
  return Object.freeze({
    activeNetwork: input.context.activeNetwork,
    amount: homeV2ForeignAtomicToDecimal(input.plan.amount),
    blockchain: input.context.blockchain,
    chainId: input.chainId,
    currencyCode: input.coin,
    fee: homeV2ForeignAtomicToDecimal(input.signed.fee),
    feePerByte: homeV2ForeignAtomicToDecimal(input.plan.feePerByte),
    inputAmount: homeV2ForeignAtomicToDecimal(input.signed.inputAmount),
    inputCount: input.plan.inputs.length,
    outputAmount: homeV2ForeignAtomicToDecimal(input.signed.outputAmount),
    outputCount: input.plan.outputs.length,
    receivingAddress: input.plan.recipientAddress,
    sendMax: input.plan.sendMax,
    transactionSize: input.signed.transactionSize,
    txHash: input.signed.txId,
  })
}

export async function executeHomeV2ForeignSend(
  request: Record<string, unknown>,
  deps: HomeV2ForeignSendDeps,
): Promise<HomeV2ForeignSendResult> {
  const normalized = normalizeHomeV2ForeignSendRequest(request)
  const coin = normalized.coin
  const chainId = getForeignWalletMainnetChainId(coin)
  const startedAt = deps.now()
  const assertForeignSendFresh = () => {
    if (deps.now() - startedAt > APPROVAL_FRESHNESS_MS) {
      throw new Error('This foreign send approval took too long and was not signed; please start it again.')
    }
  }

  // The wallet identity is derived FIRST so the whole operation — including
  // the journal read that decides whether it may proceed — runs inside the
  // per-wallet lock. Two apps must never plan against the same wallet state.
  const wallet = deps.withWalletSeed((seed, nonce, walletVersion) => deriveForeignWalletPublicRuntime({
    coin,
    crypto: deps.crypto,
    nonce,
    seed,
    walletVersion,
  }))
  const walletFingerprint = fingerprintForeignWalletPublicRuntime({
    coin,
    crypto: deps.crypto,
    xpub58: wallet.xpub58,
  })

  // One parse of each distinct funding transaction, shared across planning,
  // re-planning and signing. A wallet holding a thousand outputs of the same
  // megabyte transaction would otherwise re-parse that megabyte a thousand
  // times per phase.
  const previousTransactions = createForeignWalletPreviousTransactionCache()

  return runForeignWalletOperationExclusive({ chainId, coin, walletFingerprint }, async () => {
    const route = await deps.resolveRoute()

    // Settle anything this wallet already owes an answer for, BEFORE reading
    // state or asking the user. A retained entry means a signed transaction
    // whose fate Home could not prove; the only thing that clears it is
    // finding that exact transaction id in the wallet's own history.
    const pending = deps.journal.listPending({ chainId, coin, walletFingerprint })
    if (pending.length > 0) {
      const outcome = await reconcileForeignWalletPendingTransactions(pending, {
        clear: (entry, observedTxId) => deps.journal.clearReconciled(
          { chainId, coin, txId: entry.txId, walletFingerprint },
          observedTxId,
        ),
        now: deps.now(),
        readHistory: () => deps.readWalletHistory(wallet),
        release: (entry) => deps.journal.releaseNeverBroadcast(
          { chainId, coin, txId: entry.txId, walletFingerprint },
          deps.now(),
        ),
      })
      if (outcome.retained.length > 0) throw foreignWalletReconciliationRefusal(coin, outcome.retained)
    }

    const context = await readSpendContext(deps, coin, wallet.xpub58)
    const feePerByte = resolveHomeV2ForeignSendFeePerByte(
      normalized.feePerByteAtomic,
      context.recommendedFeePerByte,
    )
    const plan = planSpend({
      amountAtomic: normalized.amountAtomic,
      cache: previousTransactions,
      coin,
      context,
      deps,
      feePerByte,
      recipientAddress: normalized.recipientAddress,
      sendMax: normalized.sendMax,
    })

    // Before the user is asked anything: an unreconciled signed transaction
    // already claims one of these outputs. Planning past it would build a
    // double spend of Home's own making.
    const conflict = deps.journal.findConflict({
      chainId,
      coin,
      outpoints: outpointsOf(plan),
      walletFingerprint,
    })
    if (conflict) {
      throw new HomeV2ForeignSendReconciliationError(
        `A previously signed ${coin} transaction already claims one of these outputs. `
        + `Reconcile transaction ${conflict.txId} before sending again.`,
      )
    }

    await deps.approve(
      buildHomeV2ForeignSendApprovalRows(plan, { chainId, coin }),
      {
        chainId,
        coin,
        kind: 'foreign-send',
        operationLabel: homeV2ForeignSendOperationLabel(coin),
        target: homeV2ForeignSendApprovalTarget({
          amountAtomic: normalized.sendMax ? null : normalized.amountAtomic,
          chainId,
          coin,
          recipient: normalized.recipientAddress,
        }),
      },
    )

    if (!(await deps.isStillValid())) {
      throw new Error('The app, account, or node route changed before the foreign send was staged.')
    }
    const routeAfter = await deps.resolveRoute()
    if (routeAfter.revision !== route.revision || routeAfter.nodeApiUrl !== route.nodeApiUrl) {
      throw new Error('The selected Qortium node or its API key changed before the foreign send could be signed.')
    }
    const contextAfter = await readSpendContext(deps, coin, wallet.xpub58)
    assertSpendContextUnchanged(context, contextAfter, plan)
    const planAfter = planSpend({
      amountAtomic: normalized.amountAtomic,
      cache: previousTransactions,
      coin,
      context: contextAfter,
      deps,
      feePerByte: resolveHomeV2ForeignSendFeePerByte(
        normalized.feePerByteAtomic,
        contextAfter.recommendedFeePerByte,
      ),
      recipientAddress: normalized.recipientAddress,
      sendMax: normalized.sendMax,
    })
    assertPlanUnchanged(plan, planAfter)

    // The re-read above is an authenticated round trip that can take twenty
    // seconds, and the checks BEFORE it are stale by the time it returns: the
    // app could have navigated, the account could have locked, the node could
    // have been swapped. These two are therefore repeated as the LAST awaits
    // in the whole function. Everything from here to the broadcast — signing,
    // the write-ahead record and the attempt marker — is synchronous, so no
    // further drift can open between the final check and the signature.
    const routeFinal = await deps.resolveRoute()
    if (routeFinal.revision !== route.revision || routeFinal.nodeApiUrl !== route.nodeApiUrl) {
      throw new Error('The selected Qortium node or its API key changed before the foreign send could be signed.')
    }
    if (!(await deps.isStillValid())) {
      throw new Error('The app, account, or node route changed before the foreign send could be signed.')
    }
    assertForeignSendFresh()

    const signed = deps.withWalletSeed((seed, nonce, walletVersion) => {
      const built = buildForeignWalletSignedTransaction({
        cache: previousTransactions,
        coin,
        crypto: deps.crypto,
        inputs: plan.inputs,
        nonce,
        outputs: plan.outputs,
        seed,
        transactionVersion: context.transactionVersion,
        walletVersion,
      })
      // A last, cheap proof that nothing secret is about to be posted. The
      // payload must be pure lowercase hex, which alone rules out any Base58
      // 'xprv' text, and its BYTES must not contain the seed. The seed is
      // compared as bytes on purpose — see containsByteSequence.
      if (!/^[0-9a-f]+$/.test(built.rawTransactionHex)
        || containsByteSequence(hexToBytes(built.rawTransactionHex), seed)) {
        throw new Error('The signed foreign transaction failed its key-material check and was discarded.')
      }
      return built
    })
    if (signed.fee !== plan.fee
      || signed.inputAmount !== plan.inputAmount
      || signed.outputAmount !== plan.outputAmount) {
      throw new Error('The signed foreign transaction does not match the approved plan.')
    }
    if (signed.transactionSize > plan.estimatedMaximumSize) {
      throw new Error('The signed foreign transaction is larger than the size its fee was approved for.')
    }

    const journalKey: HomeV2ForeignSendJournalKey = {
      chainId,
      coin,
      txId: signed.txId,
      walletFingerprint,
    }
    // WRITE AHEAD. If this throws, nothing has been broadcast and nothing
    // will be: a transaction whose existence cannot be remembered must not
    // be put on a network that will remember it.
    deps.journal.recordSigned({
      appIdentity: deps.appIdentity,
      chainId,
      coin,
      createdAt: deps.now(),
      outpoints: outpointsOf(plan),
      stage: 'signed',
      txId: signed.txId,
      walletFingerprint,
    })

    const prepared = preparedTransaction({ chainId, coin, context, plan, signed })
    const base = {
      action: 'SEND_COIN' as const,
      chainId,
      coin,
      network: 'qortium' as const,
      prepared,
      recipient: plan.recipientAddress,
      transactionHash: signed.txId,
      txId: signed.txId,
    }

    // Marked attempted BEFORE the request leaves, so a crash mid-flight is
    // indistinguishable from a timeout: both leave a retained entry.
    deps.journal.recordBroadcastAttempt(journalKey, deps.now())
    let returned: unknown
    try {
      returned = await deps.postTrusted(
        `/crosschain/${coin.toLowerCase()}/send/broadcast`,
        JSON.stringify({ expectedChainId: chainId, rawTransactionHex: signed.rawTransactionHex }),
        'application/json',
        BROADCAST_RESPONSE_MAX_BYTES,
      )
    } catch (error) {
      // Once signed bytes have left this process, an error is not proof the
      // network never saw them. NEVER retried, and never reported as a
      // retryable failure.
      const normalizedError = normalizeForeignWalletReadError(error, coin)
      return Object.freeze({
        ...base,
        accepted: false as const,
        error: normalizedError.message,
        errorType: 'FOREIGN_BROADCAST_UNKNOWN' as const,
        foreignOutcome: 'unknown' as const,
        retryable: false as const,
      })
    }

    const returnedTxId = typeof returned === 'string' ? returned.trim() : returned
    try {
      normalizeConfirmedForeignWalletTransactionId(signed.txId, returnedTxId)
    } catch {
      // The node acknowledged a DIFFERENT transaction. The signed one may or
      // may not be on the network, so the entry stays and nothing is retried.
      return Object.freeze({
        ...base,
        accepted: false as const,
        error: `The node acknowledged a different ${coin} transaction than the one Home signed.`,
        errorType: 'FOREIGN_BROADCAST_MISMATCH' as const,
        foreignOutcome: 'mismatch' as const,
        retryable: false as const,
      })
    }

    // Core returned the exact locally computed txid: the broadcast is
    // confirmed. A failure to CLEAN UP the journal afterwards must never
    // downgrade that into a failed send.
    const cleanup = deps.journal.confirmBroadcastSuccess(journalKey, returnedTxId)
    return Object.freeze({
      ...base,
      accepted: true as const,
      journalCleared: cleanup.journalCleared,
      ...(cleanup.cleanupError ? { cleanupError: cleanup.cleanupError } : {}),
    })
  })
}
