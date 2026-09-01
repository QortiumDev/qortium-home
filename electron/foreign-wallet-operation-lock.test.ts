import assert from 'node:assert/strict'

import { createForeignWalletOperationLock } from './foreign-wallet-operation-lock.js'
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

  console.log('Foreign wallet operation lock tests passed.')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
