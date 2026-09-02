import type { ForeignWalletCoin } from './foreign-wallets.js'

/**
 * Absolute sanity ceilings on the two numbers a foreign send takes from the
 * node on trust.
 *
 * `recommendedFeePerByte` and `minimumNonDustOutput` both come from Core, and
 * both move money without appearing in the amount the user typed:
 *
 *  - an inflated fee rate multiplies straight into the fee;
 *  - an inflated dust floor is worse, because change BELOW the floor is
 *    absorbed into the fee rather than returned (spend-plan.ts). A node
 *    reporting a dust floor of one whole coin turns the entire remainder of
 *    every send into a fee, silently.
 *
 * The relative clamp in home-v2-foreign-send-actions.ts cannot catch either:
 * it measures an app's requested rate against the node's recommendation, so a
 * node that inflates the recommendation moves the clamp with it.
 *
 * These are SANITY ceilings, and they are derived from Core's own numbers
 * rather than guessed. Qortium Core declares each chain's dust floor and
 * default fee rate in
 * `src/main/java/org/qortium/crosschain/BitcoinyChainSpecs.java`
 * (`minNonDustOutput(...)` per chain, defaulting to 546 via
 * `StaticBitcoinyParams.DEFAULT_MIN_NON_DUST_OUTPUT`, and the `defaultFeePerKb`
 * passed to each `spec(...)`; `Bitcoiny.java` derives a per-byte rate from it
 * as `max(1, feePerKb / 1000)`). Every dust ceiling below is at least TEN
 * TIMES Core's declared floor for that chain, and every fee-rate ceiling is at
 * least a hundred times Core's default rate, so an honest Core is never
 * refused — while a node inventing a floor or rate far outside its chain's
 * reality still is. The Core values are pinned as literals in
 * foreign-wallet-policy-bounds.test.ts so this file cannot drift from them
 * silently.
 *
 * A value ABOVE its ceiling is refused rather than clamped: Home cannot tell
 * an unusual chain moment from a lying node, and quietly using a smaller
 * number than the node asked for would produce a transaction the network then
 * refuses to relay.
 */
export type ForeignWalletPolicyBounds = Readonly<{
  // Ceiling on Core's reported minimumNonDustOutput, in atomic units.
  maximumDustThreshold: bigint
  // Ceiling on a plan's TOTAL fee, in atomic units, independent of size.
  maximumFee: bigint
  // Ceiling on Core's reported recommendedFeePerByte, in atomic units.
  maximumFeePerByte: bigint
}>

const BOUNDS: Readonly<Record<ForeignWalletCoin, ForeignWalletPolicyBounds>> = Object.freeze({
  // Core: minNonDustOutput 546, defaultFeePerKb 5,000 (5 per byte).
  BTC: Object.freeze({ maximumDustThreshold: 10_000n, maximumFee: 1_000_000n, maximumFeePerByte: 2_000n }),
  // Core: minNonDustOutput 100,000, defaultFeePerKb 10,000 (10 per byte).
  LTC: Object.freeze({ maximumDustThreshold: 2_000_000n, maximumFee: 20_000_000n, maximumFeePerByte: 20_000n }),
  // Core: minNonDustOutput Coin.COIN = 100,000,000, defaultFeePerKb 1,000,000
  // (1,000 per byte). Dogecoin's dust floor is a WHOLE COIN; a ceiling set
  // from Bitcoin intuition would refuse every honest Dogecoin send.
  DOGE: Object.freeze({
    maximumDustThreshold: 2_000_000_000n,
    maximumFee: 20_000_000_000n,
    maximumFeePerByte: 200_000n,
  }),
  // Core: minNonDustOutput 546, defaultFeePerKb 100,000 (100 per byte).
  DGB: Object.freeze({ maximumDustThreshold: 10_000n, maximumFee: 100_000_000n, maximumFeePerByte: 200_000n }),
  // Core: minNonDustOutput 2,730, defaultFeePerKb 1,125,000 (1,125 per byte).
  RVN: Object.freeze({ maximumDustThreshold: 50_000n, maximumFee: 100_000_000n, maximumFeePerByte: 200_000n }),
  // Core: no per-chain minNonDustOutput, so the 546 default; defaultFeePerKb
  // 10,000 (10 per byte).
  DASH: Object.freeze({ maximumDustThreshold: 10_000n, maximumFee: 10_000_000n, maximumFeePerByte: 20_000n }),
  // Core: minNonDustOutput 546, defaultFeePerKb 100,000 (100 per byte).
  NMC: Object.freeze({ maximumDustThreshold: 10_000n, maximumFee: 100_000_000n, maximumFeePerByte: 200_000n }),
  // Core: minNonDustOutput 1,000, defaultFeePerKb 10,000 (10 per byte).
  FIRO: Object.freeze({ maximumDustThreshold: 20_000n, maximumFee: 10_000_000n, maximumFeePerByte: 20_000n }),
})

/**
 * Core's declared values, mirrored here ONLY so the ceilings above can be
 * checked against them in one place. Source:
 * qortium-core `src/main/java/org/qortium/crosschain/BitcoinyChainSpecs.java`.
 */
export const CORE_FOREIGN_WALLET_CHAIN_VALUES: Readonly<Record<ForeignWalletCoin, Readonly<{
  defaultFeePerByte: bigint
  minimumNonDustOutput: bigint
}>>> = Object.freeze({
  BTC: Object.freeze({ defaultFeePerByte: 5n, minimumNonDustOutput: 546n }),
  LTC: Object.freeze({ defaultFeePerByte: 10n, minimumNonDustOutput: 100_000n }),
  DOGE: Object.freeze({ defaultFeePerByte: 1_000n, minimumNonDustOutput: 100_000_000n }),
  DGB: Object.freeze({ defaultFeePerByte: 100n, minimumNonDustOutput: 546n }),
  RVN: Object.freeze({ defaultFeePerByte: 1_125n, minimumNonDustOutput: 2_730n }),
  DASH: Object.freeze({ defaultFeePerByte: 10n, minimumNonDustOutput: 546n }),
  NMC: Object.freeze({ defaultFeePerByte: 100n, minimumNonDustOutput: 546n }),
  FIRO: Object.freeze({ defaultFeePerByte: 10n, minimumNonDustOutput: 1_000n }),
})

export function getForeignWalletPolicyBounds(coin: ForeignWalletCoin): ForeignWalletPolicyBounds {
  const bounds = BOUNDS[coin]
  if (!bounds) throw new Error('Unsupported foreign wallet coin.')
  return bounds
}

/**
 * The node-reported half. Called on EVERY spend-context read, including the
 * post-approval re-read, so a node cannot pass the check once and then move
 * the numbers.
 */
export function assertForeignWalletContextWithinPolicy(input: Readonly<{
  coin: ForeignWalletCoin
  minimumNonDustOutput: bigint
  recommendedFeePerByte: bigint
}>): void {
  const bounds = getForeignWalletPolicyBounds(input.coin)
  if (input.recommendedFeePerByte > bounds.maximumFeePerByte) {
    throw new Error(
      `The node reported a ${input.coin} fee rate of ${input.recommendedFeePerByte} atomic units per byte, `
      + `above the ${bounds.maximumFeePerByte} this wallet will accept. The send was refused rather than `
      + 'paid at that rate.',
    )
  }
  if (input.minimumNonDustOutput > bounds.maximumDustThreshold) {
    throw new Error(
      `The node reported a ${input.coin} minimum output of ${input.minimumNonDustOutput} atomic units, `
      + `above the ${bounds.maximumDustThreshold} this wallet will accept. Change below that minimum is `
      + 'absorbed into the fee, so the send was refused rather than paid.',
    )
  }
}

/**
 * The plan half, which is what actually protects the money: the fee finally
 * charged can exceed rate x size, because change below the dust floor is
 * absorbed into it instead of being returned.
 */
export function assertForeignWalletPlanWithinPolicy(input: Readonly<{
  amount: bigint
  coin: ForeignWalletCoin
  estimatedMaximumSize: number
  fee: bigint
  feePerByte: bigint
  sendMax: boolean
}>): void {
  const bounds = getForeignWalletPolicyBounds(input.coin)
  const sizeCeiling = bounds.maximumFeePerByte * BigInt(input.estimatedMaximumSize)
  const ceiling = sizeCeiling > bounds.maximumFee ? sizeCeiling : bounds.maximumFee
  if (input.fee > ceiling) {
    throw new Error(
      `This ${input.coin} send would pay a fee of ${input.fee} atomic units, above the ${ceiling} this `
      + 'wallet will pay for a transaction of that size. The send was refused.',
    )
  }
  // OWNER DECISION: a fixed-amount send may never pay more in fee than it
  // sends, at ANY size. A transfer that costs more than it moves is almost
  // always a mistake, and the two legitimate ways to express the intent behind
  // it — sweep the wallet, or send more — are both named in the refusal.
  // Send-max is exempt by definition: paying the fee out of the amount is the
  // whole point of it.
  if (!input.sendMax && input.fee > input.amount) {
    throw new Error(
      `This ${input.coin} send would pay more in fee (${input.fee} atomic units) than it sends `
      + `(${input.amount}). Send a larger amount, or use send-max to sweep the wallet.`,
    )
  }
}

/**
 * The rate the fee actually works out to across the transaction it pays for.
 * It exceeds the quoted rate whenever dust change was absorbed, which is
 * exactly the case a user needs to see on the prompt.
 *
 * Rounded UP: a rate rounded down could equal the quoted rate while real money
 * was absorbed into the fee, which would hide the very thing this exists to
 * show.
 */
export function foreignWalletEffectiveFeePerByte(fee: bigint, estimatedMaximumSize: number): bigint {
  if (!Number.isSafeInteger(estimatedMaximumSize) || estimatedMaximumSize <= 0) {
    throw new Error('Invalid foreign wallet transaction size.')
  }
  const size = BigInt(estimatedMaximumSize)
  return (fee + size - 1n) / size
}
