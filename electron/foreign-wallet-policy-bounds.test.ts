import assert from 'node:assert/strict'

import {
  assertForeignWalletContextWithinPolicy,
  assertForeignWalletPlanWithinPolicy,
  foreignWalletEffectiveFeePerByte,
  getForeignWalletPolicyBounds,
  CORE_FOREIGN_WALLET_CHAIN_VALUES,
} from './foreign-wallet-policy-bounds.js'
import { getForeignWalletCoins } from './foreign-wallets.js'

// Core's OWN declared values for each chain, transcribed from
// qortium-core `src/main/java/org/qortium/crosschain/BitcoinyChainSpecs.java`:
// the per-chain `minNonDustOutput(...)` (defaulting to 546 through
// `StaticBitcoinyParams.DEFAULT_MIN_NON_DUST_OUTPUT` where a chain sets none,
// which is DASH's case) and the `defaultFeePerKb` passed to each `spec(...)`,
// converted per byte the way `Bitcoiny.java` does it: max(1, feePerKb / 1000).
//
// Dogecoin is the one that matters most here: its dust floor is Coin.COIN, a
// WHOLE COIN — 100,000,000 atomic units — so a ceiling chosen from Bitcoin
// intuition sits below Core's honest value and refuses every real send.
const CORE_VALUES = {
  BTC: { defaultFeePerByte: 5n, minimumNonDustOutput: 546n },
  LTC: { defaultFeePerByte: 10n, minimumNonDustOutput: 100_000n },
  DOGE: { defaultFeePerByte: 1_000n, minimumNonDustOutput: 100_000_000n },
  DGB: { defaultFeePerByte: 100n, minimumNonDustOutput: 546n },
  RVN: { defaultFeePerByte: 1_125n, minimumNonDustOutput: 2_730n },
  DASH: { defaultFeePerByte: 10n, minimumNonDustOutput: 546n },
  NMC: { defaultFeePerByte: 100n, minimumNonDustOutput: 546n },
  FIRO: { defaultFeePerByte: 10n, minimumNonDustOutput: 1_000n },
} as const

// The module's own mirror of those values must match this transcription, so a
// future edit to one without the other fails here rather than in production.
assert.deepEqual(
  Object.fromEntries(Object.entries(CORE_FOREIGN_WALLET_CHAIN_VALUES).map(([coin, value]) => [coin, { ...value }])),
  Object.fromEntries(Object.entries(CORE_VALUES).map(([coin, value]) => [coin, { ...value }])),
)

// Every supported coin has bounds, every bound is a positive bigint, and every
// ceiling clears Core's real value by the margin an honest node needs.
for (const coin of getForeignWalletCoins()) {
  const bounds = getForeignWalletPolicyBounds(coin)
  const core = CORE_VALUES[coin]
  assert.ok(core, `${coin} has no transcribed Core value`)
  for (const [name, value] of Object.entries(bounds)) {
    assert.equal(typeof value, 'bigint', `${coin}.${name}`)
    assert.ok((value as bigint) > 0n, `${coin}.${name}`)
  }
  assert.ok(
    bounds.maximumDustThreshold >= core.minimumNonDustOutput * 10n,
    `${coin} dust ceiling ${bounds.maximumDustThreshold} must be at least 10x Core's ${core.minimumNonDustOutput}`,
  )
  assert.ok(
    bounds.maximumFeePerByte >= core.defaultFeePerByte * 100n,
    `${coin} fee-rate ceiling ${bounds.maximumFeePerByte} must be well above Core's default ${core.defaultFeePerByte}`,
  )
  // The absolute fee cap has to leave room for a fee that absorbed dust change
  // right up to the dust ceiling, or the two bounds would contradict.
  assert.ok(
    bounds.maximumFee > bounds.maximumDustThreshold,
    `${coin} fee cap must exceed its own dust ceiling`,
  )
  // Core's honest values are accepted, on every chain.
  assert.doesNotThrow(() => assertForeignWalletContextWithinPolicy({
    coin,
    minimumNonDustOutput: core.minimumNonDustOutput,
    recommendedFeePerByte: core.defaultFeePerByte,
  }), coin)
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
// Bitcoin is Core's OWN honest floor on Dogecoin.
assert.doesNotThrow(() => assertForeignWalletContextWithinPolicy({
  coin: 'DOGE',
  minimumNonDustOutput: 100_000_000n,
  recommendedFeePerByte: 1_000n,
}))
// ...and Litecoin's real floor, which an earlier ceiling sat exactly on.
assert.doesNotThrow(() => assertForeignWalletContextWithinPolicy({
  coin: 'LTC',
  minimumNonDustOutput: 100_000n,
  recommendedFeePerByte: 10n,
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

// A fee larger than the payment is refused at EVERY size (owner decision), and
// the refusal names both ways to express the intent behind it.
for (const [amount, fee] of [[100n, 200n], [546n, 4_512n], [2n, 3n]] as const) {
  assert.throws(
    () => assertForeignWalletPlanWithinPolicy({ ...ordinary, amount, fee }),
    /Send a larger amount, or use send-max to sweep the wallet/,
    `amount ${amount} fee ${fee}`,
  )
}
// Equal is still allowed: it is spending exactly half on fee, not more.
assert.doesNotThrow(() => assertForeignWalletPlanWithinPolicy({
  ...ordinary,
  amount: 4_512n,
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
