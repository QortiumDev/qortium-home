import assert from 'node:assert/strict'

import {
  assertForeignWalletContextWithinPolicy,
  assertForeignWalletPlanWithinPolicy,
  foreignWalletEffectiveFeePerByte,
  getForeignWalletPolicyBounds,
} from './foreign-wallet-policy-bounds.js'
import { getForeignWalletCoins } from './foreign-wallets.js'

// Every supported coin has bounds, and every bound is a positive bigint. A
// coin that reached the send path without one would have no ceiling at all.
for (const coin of getForeignWalletCoins()) {
  const bounds = getForeignWalletPolicyBounds(coin)
  for (const [name, value] of Object.entries(bounds)) {
    assert.equal(typeof value, 'bigint', `${coin}.${name}`)
    assert.ok((value as bigint) > 0n, `${coin}.${name}`)
  }
  // Real values on every one of these chains are orders of magnitude below the
  // ceilings, so an honest node is never refused by them.
  assert.ok(bounds.maximumDustThreshold >= 546n, coin)
  assert.ok(bounds.maximumFeePerByte >= 1_000n, coin)
}

// --- the node-reported half -------------------------------------------------

assert.doesNotThrow(() => assertForeignWalletContextWithinPolicy({
  coin: 'BTC',
  minimumNonDustOutput: 546n,
  recommendedFeePerByte: 12n,
}))
// Exactly at the ceiling is accepted; one above is refused.
assert.doesNotThrow(() => assertForeignWalletContextWithinPolicy({
  coin: 'BTC',
  minimumNonDustOutput: 10_000n,
  recommendedFeePerByte: 2_000n,
}))
assert.throws(() => assertForeignWalletContextWithinPolicy({
  coin: 'BTC',
  minimumNonDustOutput: 546n,
  recommendedFeePerByte: 2_001n,
}), /fee rate of 2001 atomic units per byte/)
// The dust floor is the more dangerous of the two: change below it is absorbed
// into the fee rather than returned, so an inflated floor quietly takes the
// whole remainder of every send.
assert.throws(() => assertForeignWalletContextWithinPolicy({
  coin: 'BTC',
  minimumNonDustOutput: 100_000_000n,
  recommendedFeePerByte: 12n,
}), /minimum output of 100000000 atomic units/)
// The bounds are per coin, not one global number: a value that is absurd on
// Bitcoin is ordinary on Dogecoin.
assert.doesNotThrow(() => assertForeignWalletContextWithinPolicy({
  coin: 'DOGE',
  minimumNonDustOutput: 1_000_000n,
  recommendedFeePerByte: 1_000n,
}))
assert.throws(() => assertForeignWalletContextWithinPolicy({
  coin: 'BTC',
  minimumNonDustOutput: 1_000_000n,
  recommendedFeePerByte: 1_000n,
}), /minimum output/)

// --- the plan half ----------------------------------------------------------

const ordinary = {
  amount: 100_000n,
  coin: 'BTC' as const,
  estimatedMaximumSize: 376,
  fee: 4_512n,
  feePerByte: 12n,
  sendMax: false,
}
assert.doesNotThrow(() => assertForeignWalletPlanWithinPolicy(ordinary))

// The fee finally charged can exceed rate x size, because dust change is
// absorbed into it. That is the number this check sees.
assert.throws(
  () => assertForeignWalletPlanWithinPolicy({ ...ordinary, fee: 1_000_001n }),
  /would pay a fee of 1000001 atomic units/,
)
// A big transaction may pay proportionally more: the ceiling is the larger of
// the size-derived bound and the absolute cap.
assert.doesNotThrow(() => assertForeignWalletPlanWithinPolicy({
  ...ordinary,
  amount: 1_000_000_000n,
  estimatedMaximumSize: 100_000,
  fee: 190_000_000n,
}))
// ...but not without limit: past the size-derived ceiling it refuses.
assert.throws(() => assertForeignWalletPlanWithinPolicy({
  ...ordinary,
  amount: 1_000_000_000n,
  estimatedMaximumSize: 100_000,
  fee: 200_000_001n,
}), /would pay a fee of 200000001 atomic units/)

// A fee larger than the payment, once the payment is large enough for the
// comparison to mean anything.
assert.throws(() => assertForeignWalletPlanWithinPolicy({
  ...ordinary,
  amount: 1_000_001n,
  estimatedMaximumSize: 100_000,
  fee: 1_000_002n,
}), /more in fee/)
// Below that floor the comparison is noise: a dust-minimum payment legitimately
// costs several times its own value in fee.
assert.doesNotThrow(() => assertForeignWalletPlanWithinPolicy({
  ...ordinary,
  amount: 546n,
  fee: 4_512n,
}))
// Send-max is exempt by definition: paying the fee out of the amount is the
// whole point of it.
assert.doesNotThrow(() => assertForeignWalletPlanWithinPolicy({
  ...ordinary,
  amount: 1_000_001n,
  estimatedMaximumSize: 100_000,
  fee: 1_000_002n,
  sendMax: true,
}))

// --- the effective rate -----------------------------------------------------

assert.equal(foreignWalletEffectiveFeePerByte(4_512n, 376), 12n)
// Rounded UP, so absorbed change can never hide behind a rate that reads the
// same as the quoted one.
assert.equal(foreignWalletEffectiveFeePerByte(2_416n, 193), 13n)
assert.equal(foreignWalletEffectiveFeePerByte(0n, 193), 0n)
assert.throws(() => foreignWalletEffectiveFeePerByte(1n, 0), /Invalid foreign wallet transaction size/)

console.log('Foreign wallet policy bound tests passed.')
