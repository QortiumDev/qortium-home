import {
  getForeignWalletOperationKey,
  type ForeignWalletPendingTransaction,
} from './foreign-wallet-transaction-journal.js'

type ForeignWalletOperationIdentity = Pick<
  ForeignWalletPendingTransaction,
  'chainId' | 'coin' | 'walletFingerprint'
>

export const FOREIGN_SEND_IN_PROGRESS_CODE = 'FOREIGN_SEND_IN_PROGRESS'

const IN_PROGRESS_MESSAGE =
  'Another foreign wallet operation is already in progress for this wallet and coin.'

/**
 * Raised when a second spend is attempted against a wallet/coin/chain that is
 * already being planned or signed. Callers classify it by type or by `code`,
 * never by its wording: the user-facing message belongs to the copy, not to
 * the control flow.
 */
export class ForeignWalletOperationInProgressError extends Error {
  readonly code = FOREIGN_SEND_IN_PROGRESS_CODE

  constructor(message: string = IN_PROGRESS_MESSAGE) {
    super(message)
    this.name = 'ForeignWalletOperationInProgressError'
  }
}

export function isForeignWalletOperationInProgressError(
  error: unknown,
): error is ForeignWalletOperationInProgressError {
  if (error instanceof ForeignWalletOperationInProgressError) return true
  // A bundled copy of this module can produce a structurally identical error
  // that fails instanceof, so the code is checked too.
  return error instanceof Error
    && (error as { code?: unknown }).code === FOREIGN_SEND_IN_PROGRESS_CODE
}

/**
 * Serializes a wallet/coin/chain spend across every app in one Home process.
 * This is deliberately independent of app identity: two apps must not race to
 * plan and sign against the same wallet state. The durable journal remains the
 * restart/crash authority; this lock only closes the live in-process window.
 */
export function createForeignWalletOperationLock() {
  const active = new Set<string>()

  async function runExclusive<T>(
    identity: ForeignWalletOperationIdentity,
    operation: () => Promise<T> | T,
  ): Promise<T> {
    const key = getForeignWalletOperationKey(identity)
    if (active.has(key)) {
      throw new ForeignWalletOperationInProgressError()
    }
    active.add(key)
    try {
      return await operation()
    } finally {
      active.delete(key)
    }
  }

  function isLocked(identity: ForeignWalletOperationIdentity) {
    return active.has(getForeignWalletOperationKey(identity))
  }

  return Object.freeze({ isLocked, runExclusive })
}

const DEFAULT_LOCK = createForeignWalletOperationLock()

export const isForeignWalletOperationLocked = DEFAULT_LOCK.isLocked
export const runForeignWalletOperationExclusive = DEFAULT_LOCK.runExclusive
