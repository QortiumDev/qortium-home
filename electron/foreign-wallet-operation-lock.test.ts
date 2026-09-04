import assert from 'node:assert/strict'

import {
  createForeignWalletOperationLock,
  ForeignWalletOperationInProgressError,
  FOREIGN_SEND_IN_PROGRESS_CODE,
  isForeignWalletOperationInProgressError,
} from './foreign-wallet-operation-lock.js'
import { getForeignWalletMainnetChainId } from './foreign-wallet-spend-context.js'

const btc = {
  chainId: getForeignWalletMainnetChainId('BTC'),
  coin: 'BTC' as const,
  walletFingerprint: '11'.repeat(32),
}
const otherWallet = { ...btc, walletFingerprint: '22'.repeat(32) }

async function main() {
  const lock = createForeignWalletOperationLock()
  let releaseFirst!: () => void
  const firstCanFinish = new Promise<void>((resolve) => { releaseFirst = resolve })
  let firstStarted!: () => void
  const firstDidStart = new Promise<void>((resolve) => { firstStarted = resolve })

  const first = lock.runExclusive(btc, async () => {
    firstStarted()
    await firstCanFinish
    return 'first'
  })
  await firstDidStart
  assert.equal(lock.isLocked(btc), true)
  await assert.rejects(
    lock.runExclusive(btc, () => 'overlap'),
    /already in progress/,
  )
  assert.equal(await lock.runExclusive(otherWallet, () => 'other-wallet'), 'other-wallet')
  releaseFirst()
  assert.equal(await first, 'first')
  assert.equal(lock.isLocked(btc), false)

  await assert.rejects(
    lock.runExclusive(btc, () => { throw new Error('operation failed') }),
    /operation failed/,
  )
  assert.equal(lock.isLocked(btc), false)
  assert.equal(await lock.runExclusive(btc, () => 'released'), 'released')

  assert.throws(
    () => lock.isLocked({ ...btc, chainId: getForeignWalletMainnetChainId('LTC') }),
    /does not match its coin/,
  )

  // Contention is classified by type and code, never by wording. Rewording the
  // user-facing message must not change how the bridge classifies it, and a
  // plain error that merely repeats the old wording must not be mistaken for
  // lock contention.
  let contention: unknown
  try {
    await lock.runExclusive(btc, async () => {
      await lock.runExclusive(btc, () => 'overlap')
    })
  } catch (error) {
    contention = error
  }
  assert.equal(contention instanceof ForeignWalletOperationInProgressError, true)
  assert.equal((contention as ForeignWalletOperationInProgressError).code, FOREIGN_SEND_IN_PROGRESS_CODE)
  assert.equal(isForeignWalletOperationInProgressError(contention), true)
  assert.equal(
    isForeignWalletOperationInProgressError(
      new ForeignWalletOperationInProgressError('Please wait for the current send to finish.'),
    ),
    true,
  )
  assert.equal(
    isForeignWalletOperationInProgressError(
      Object.assign(new Error('reworded by a bundler'), { code: FOREIGN_SEND_IN_PROGRESS_CODE }),
    ),
    true,
  )
  assert.equal(
    isForeignWalletOperationInProgressError(
      new Error('Another foreign wallet operation is already in progress for this wallet and coin.'),
    ),
    false,
  )
  assert.equal(isForeignWalletOperationInProgressError(undefined), false)

  console.log('Foreign wallet operation lock tests passed.')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
