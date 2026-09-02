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
 * These are deliberately SANITY ceilings, not a reproduction of each chain's
 * relay policy. They are set roughly an order of magnitude above the highest
 * value each chain has plausibly seen, so a legitimate Core is never refused,
 * and far below a wallet-draining one. Real reference values, for scale:
 * Bitcoin's P2PKH dust is 546 satoshis (dustRelayFee 3000 sat/kvB) and its
 * fee rate has peaked in the hundreds of sat/vB; Litecoin, DigiByte, Dash,
 * Namecoin and Firo use Bitcoin-derived dust rules at their own relay fees;
 * Dogecoin and Ravencoin carry much larger nominal units, with Dogecoin's
 * dust at 0.01 DOGE (1,000,000 koinu) and its relay minimum at 0.01 DOGE/kB.
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
  // 546 dust, peaks in the hundreds of sat/vB.
  BTC: Object.freeze({ maximumDustThreshold: 10_000n, maximumFee: 1_000_000n, maximumFeePerByte: 2_000n }),
  // 5,460 dust at a much lower relay fee than Bitcoin's.
  LTC: Object.freeze({ maximumDustThreshold: 100_000n, maximumFee: 10_000_000n, maximumFeePerByte: 20_000n }),
  // 1,000,000 koinu dust; 1,000 koinu/byte relay minimum.
  DOGE: Object.freeze({ maximumDustThreshold: 10_000_000n, maximumFee: 2_000_000_000n, maximumFeePerByte: 200_000n }),
  DGB: Object.freeze({ maximumDustThreshold: 10_000_000n, maximumFee: 2_000_000_000n, maximumFeePerByte: 200_000n }),
  RVN: Object.freeze({ maximumDustThreshold: 10_000_000n, maximumFee: 2_000_000_000n, maximumFeePerByte: 200_000n }),
  DASH: Object.freeze({ maximumDustThreshold: 100_000n, maximumFee: 10_000_000n, maximumFeePerByte: 20_000n }),
  NMC: Object.freeze({ maximumDustThreshold: 10_000_000n, maximumFee: 200_000_000n, maximumFeePerByte: 200_000n }),
  FIRO: Object.freeze({ maximumDustThreshold: 100_000n, maximumFee: 10_000_000n, maximumFeePerByte: 20_000n }),
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
  // A fee larger than the payment itself, once the payment is large enough for
  // that comparison to mean anything. Below the floor it is noise: sending a
  // chain's own dust minimum legitimately costs several times its value in
  // fee, on every one of these chains. Send-max is exempt by definition — its
  // whole purpose is to pay the fee out of the amount.
  if (!input.sendMax && input.amount > bounds.maximumFee && input.fee > input.amount) {
    throw new Error(
      `This ${input.coin} send would pay more in fee (${input.fee} atomic units) than it sends `
      + `(${input.amount}). The send was refused; use send-max if that is genuinely intended.`,
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
