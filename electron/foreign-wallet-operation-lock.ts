import {
  getForeignWalletOperationKey,
  type ForeignWalletPendingTransaction,
} from './foreign-wallet-transaction-journal.js'

type ForeignWalletOperationIdentity = Pick<
  ForeignWalletPendingTransaction,
  'chainId' | 'coin' | 'walletFingerprint'
>

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
      throw new Error('Another foreign wallet operation is already in progress for this wallet and coin.')
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
