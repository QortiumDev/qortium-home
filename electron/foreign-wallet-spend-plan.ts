import {
  assertForeignWalletSigningWorkBounds,
  assertForeignWalletWatchInputBounds,
  attestForeignWalletWatchInput,
  validateForeignWalletRecipient,
  type ForeignWalletPaymentOutput,
  type ForeignWalletPreviousTransactionCache,
  type ForeignWalletWatchInput,
} from './foreign-wallet-transaction.js';
import type { ForeignWalletCoin, ForeignWalletCrypto } from './foreign-wallets.js';

export type ForeignWalletSpendPlan = {
  amount: bigint;
  change: bigint;
  changeAddress: string | null;
  estimatedMaximumSize: number;
  fee: bigint;
  feePerByte: bigint;
  inputAmount: bigint;
  inputs: ForeignWalletWatchInput[];
  outputAmount: bigint;
  outputs: ForeignWalletPaymentOutput[];
  recipientAddress: string;
  sendMax: boolean;
};

export function planForeignWalletSpend(input: {
  amount?: bigint;
  cache?: ForeignWalletPreviousTransactionCache;
  coin: ForeignWalletCoin;
  crypto: ForeignWalletCrypto;
  feePerByte: bigint;
  minimumNonDustOutput: bigint;
  nonce?: number;
  recipientAddress: string;
  seed: Uint8Array;
  sendMax?: boolean;
  utxos: readonly ForeignWalletWatchInput[];
  walletVersion?: number;
}): ForeignWalletSpendPlan {
  assertForeignWalletWatchInputBounds(input.utxos);
  assertPositiveAtomic(input.feePerByte, 'fee per byte');
  assertPositiveAtomic(input.minimumNonDustOutput, 'minimum non-dust output');

  const sendMax = input.sendMax === true;
  if (sendMax ? input.amount !== undefined : input.amount === undefined) {
    throw new Error('Foreign wallet spend must specify either amount or send-max.');
  }
  if (input.amount !== undefined) {
    assertPositiveAtomic(input.amount, 'amount');
    if (input.amount < input.minimumNonDustOutput) {
      throw new Error('Foreign wallet amount is below the minimum non-dust output.');
    }
  }

  const recipient = validateForeignWalletRecipient({
    address: input.recipientAddress,
    coin: input.coin,
    crypto: input.crypto,
  });
  const seenOutpoints = new Set<string>();
  const candidates = input.utxos.map((utxo) => {
    const outpoint = `${utxo.txHash.trim().toLowerCase()}:${utxo.txPos}`;
    if (seenOutpoints.has(outpoint)) {
      throw new Error('Foreign wallet spend contains a duplicate input.');
    }
    seenOutpoints.add(outpoint);

    attestForeignWalletWatchInput({
      cache: input.cache,
      coin: input.coin,
      crypto: input.crypto,
      nonce: input.nonce,
      seed: input.seed,
      walletVersion: input.walletVersion,
      watchInput: utxo,
    });
    return { ...utxo };
  }).sort(compareInputs);

  if (candidates.length === 0) {
    throw new Error('Foreign wallet has no confirmed spendable inputs.');
  }

  // The worst case this plan could reach: every candidate selected, with a
  // change output. Refused here so an unspendable shape is named before any
  // signing work starts rather than after it.
  assertForeignWalletSigningWorkBounds(candidates.length, [recipient.scriptPubKey.byteLength, 25]);

  if (sendMax) {
    const inputAmount = sumAtomic(candidates.map((entry) => entry.value));
    const estimatedMaximumSize = estimateMaximumSignedSize(candidates.length, [recipient.scriptPubKey.byteLength]);
    const fee = multiplyAtomic(input.feePerByte, estimatedMaximumSize);
    const amount = inputAmount - fee;

    if (amount < input.minimumNonDustOutput) {
      throw new Error('Foreign wallet balance cannot cover the send-max fee.');
    }

    return {
      amount,
      change: 0n,
      changeAddress: null,
      estimatedMaximumSize,
      fee,
      feePerByte: input.feePerByte,
      inputAmount,
      inputs: candidates,
      outputAmount: amount,
      outputs: [{ address: recipient.address, value: amount }],
      recipientAddress: recipient.address,
      sendMax: true,
    };
  }

  const amount = input.amount as bigint;
  const selected: ForeignWalletWatchInput[] = [];
  let inputAmount = 0n;

  for (const candidate of candidates) {
    selected.push(candidate);
    inputAmount = addAtomic(inputAmount, candidate.value);

    const noChangeSize = estimateMaximumSignedSize(selected.length, [recipient.scriptPubKey.byteLength]);
    const noChangeMinimumFee = multiplyAtomic(input.feePerByte, noChangeSize);
    if (inputAmount < amount + noChangeMinimumFee) {
      continue;
    }

    const potentialChange = inputAmount - amount - noChangeMinimumFee;
    if (potentialChange < input.minimumNonDustOutput) {
      const fee = inputAmount - amount;
      return fixedPlan({
        amount,
        estimatedMaximumSize: noChangeSize,
        fee,
        feePerByte: input.feePerByte,
        inputAmount,
        inputs: selected,
        recipientAddress: recipient.address,
      });
    }

    const withChangeSize = estimateMaximumSignedSize(selected.length, [recipient.scriptPubKey.byteLength, 25]);
    const withChangeFee = multiplyAtomic(input.feePerByte, withChangeSize);
    const change = inputAmount - amount - withChangeFee;

    if (change >= input.minimumNonDustOutput) {
      const changeAddress = selected[0].address;
      return {
        amount,
        change,
        changeAddress,
        estimatedMaximumSize: withChangeSize,
        fee: withChangeFee,
        feePerByte: input.feePerByte,
        inputAmount,
        inputs: selected,
        outputAmount: amount + change,
        outputs: [
          { address: recipient.address, value: amount },
          { address: changeAddress, value: change },
        ],
        recipientAddress: recipient.address,
        sendMax: false,
      };
    }

    return fixedPlan({
      amount,
      estimatedMaximumSize: noChangeSize,
      fee: inputAmount - amount,
      feePerByte: input.feePerByte,
      inputAmount,
      inputs: selected,
      recipientAddress: recipient.address,
    });
  }

  throw new Error('Foreign wallet balance cannot cover the amount and fee.');
}

export function estimateMaximumForeignWalletTransactionSize(inputCount: number, outputScriptLengths: readonly number[]) {
  return estimateMaximumSignedSize(inputCount, outputScriptLengths);
}

function fixedPlan(input: {
  amount: bigint;
  estimatedMaximumSize: number;
  fee: bigint;
  feePerByte: bigint;
  inputAmount: bigint;
  inputs: ForeignWalletWatchInput[];
  recipientAddress: string;
}): ForeignWalletSpendPlan {
  return {
    amount: input.amount,
    change: 0n,
    changeAddress: null,
    estimatedMaximumSize: input.estimatedMaximumSize,
    fee: input.fee,
    feePerByte: input.feePerByte,
    inputAmount: input.inputAmount,
    inputs: [...input.inputs],
    outputAmount: input.amount,
    outputs: [{ address: input.recipientAddress, value: input.amount }],
    recipientAddress: input.recipientAddress,
    sendMax: false,
  };
}

function estimateMaximumSignedSize(inputCount: number, outputScriptLengths: readonly number[]) {
  if (!Number.isSafeInteger(inputCount) || inputCount <= 0) {
    throw new Error('Invalid foreign wallet input count.');
  }

  let size = 4 + compactSizeLength(inputCount) + inputCount * 149 + compactSizeLength(outputScriptLengths.length) + 4;
  for (const scriptLength of outputScriptLengths) {
    if (!Number.isSafeInteger(scriptLength) || scriptLength < 0) {
      throw new Error('Invalid foreign wallet output script length.');
    }
    size += 8 + compactSizeLength(scriptLength) + scriptLength;
  }

  if (!Number.isSafeInteger(size)) {
    throw new Error('Foreign wallet transaction size exceeds the safe range.');
  }
  return size;
}

function compactSizeLength(value: number) {
  if (value < 0xfd) return 1;
  if (value <= 0xffff) return 3;
  if (value <= 0xffffffff) return 5;
  return 9;
}

function compareInputs(left: ForeignWalletWatchInput, right: ForeignWalletWatchInput) {
  if (left.height !== right.height) return left.height - right.height;
  const hashComparison = left.txHash.toLowerCase().localeCompare(right.txHash.toLowerCase());
  if (hashComparison !== 0) return hashComparison;
  return left.txPos - right.txPos;
}

function assertPositiveAtomic(value: bigint, label: string) {
  if (typeof value !== 'bigint' || value <= 0n || value > 0xffffffffffffffffn) {
    throw new Error(`Invalid foreign wallet ${label}.`);
  }
}

function addAtomic(left: bigint, right: bigint) {
  const result = left + right;
  if (result > 0xffffffffffffffffn) {
    throw new Error('Foreign wallet atomic amount overflow.');
  }
  return result;
}

function sumAtomic(values: readonly bigint[]) {
  return values.reduce((total, value) => addAtomic(total, value), 0n);
}

function multiplyAtomic(value: bigint, multiplier: number) {
  const result = value * BigInt(multiplier);
  if (result > 0xffffffffffffffffn) {
    throw new Error('Foreign wallet fee overflow.');
  }
  return result;
}
