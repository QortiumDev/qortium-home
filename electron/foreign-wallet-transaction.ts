import { base58, bech32 } from '@scure/base';
import {
  deriveForeignWalletLeafPublicData,
  signForeignWalletDigest,
  type ForeignWalletCoin,
  type ForeignWalletCrypto,
} from './foreign-wallets.js';

export type ForeignWalletOutputType = 'P2PKH' | 'P2SH' | 'P2WPKH' | 'P2WSH';

export type ForeignWalletRecipient = {
  address: string;
  outputType: ForeignWalletOutputType;
  scriptPubKey: Uint8Array;
};

export type ForeignWalletWatchInput = {
  address: string;
  height: number;
  path: string;
  previousTransactionHex: string;
  scriptPubKey: string;
  txHash: string;
  txPos: number;
  value: bigint;
};

export type ForeignWalletPaymentOutput = {
  address: string;
  value: bigint;
};

export type ForeignWalletSignedTransaction = {
  fee: bigint;
  inputAmount: bigint;
  outputAmount: bigint;
  rawTransactionHex: string;
  transactionSize: number;
  txId: string;
};

type AddressFormat = {
  bech32Hrp?: string;
  legacyP2shPrefixes?: readonly number[];
  p2pkhPrefix: number;
  p2shPrefix?: number;
  supportedSegwit?: readonly ForeignWalletOutputType[];
};

type PreparedInput = {
  path: { chain: 0 | 1; index: number };
  publicKey: Uint8Array;
  scriptPubKey: Uint8Array;
  txHash: Uint8Array;
  txPos: number;
  value: bigint;
};

type PreparedOutput = {
  scriptPubKey: Uint8Array;
  value: bigint;
};

const SIGHASH_ALL = 0x01;
const NO_LOCKTIME_SEQUENCE = 0xffffffff;
const MAX_UINT32 = 0xffffffff;
const MAX_WATCH_INPUTS = 1_000;
const MAX_PREVIOUS_TRANSACTION_BYTES = 1_000_000;
const MAX_TOTAL_PREVIOUS_TRANSACTION_BYTES = 8_000_000;

const ADDRESS_FORMATS: Record<ForeignWalletCoin, AddressFormat> = {
  BTC: {
    bech32Hrp: 'bc',
    p2pkhPrefix: 0x00,
    p2shPrefix: 0x05,
    supportedSegwit: ['P2WPKH', 'P2WSH'],
  },
  LTC: {
    bech32Hrp: 'ltc',
    legacyP2shPrefixes: [0x05],
    p2pkhPrefix: 0x30,
    p2shPrefix: 0x32,
    supportedSegwit: ['P2WPKH', 'P2WSH'],
  },
  DOGE: { p2pkhPrefix: 0x1e, p2shPrefix: 0x16 },
  DGB: {
    bech32Hrp: 'dgb',
    p2pkhPrefix: 0x1e,
    p2shPrefix: 0x3f,
    supportedSegwit: ['P2WPKH', 'P2WSH'],
  },
  RVN: { p2pkhPrefix: 0x3c, p2shPrefix: 0x7a },
  DASH: { p2pkhPrefix: 0x4c, p2shPrefix: 0x10 },
  NMC: {
    bech32Hrp: 'nc',
    p2pkhPrefix: 0x34,
    p2shPrefix: 0x0d,
    supportedSegwit: ['P2WPKH', 'P2WSH'],
  },
  FIRO: { p2pkhPrefix: 0x52, p2shPrefix: 0x07 },
};

export function validateForeignWalletRecipient(input: {
  address: string;
  coin: ForeignWalletCoin;
  crypto: ForeignWalletCrypto;
}): ForeignWalletRecipient {
  const address = input.address.trim();

  if (!address) {
    throw new Error('Missing foreign wallet recipient.');
  }

  const format = ADDRESS_FORMATS[input.coin];
  const base58Recipient = decodeBase58Recipient(address, format, input.crypto);

  if (base58Recipient) {
    return base58Recipient;
  }

  const segwitRecipient = decodeSegwitRecipient(address, format);

  if (segwitRecipient) {
    return segwitRecipient;
  }

  throw new Error('Invalid foreign wallet recipient.');
}

export function buildForeignWalletSignedTransaction(input: {
  coin: ForeignWalletCoin;
  crypto: ForeignWalletCrypto;
  inputs: readonly ForeignWalletWatchInput[];
  nonce?: number;
  outputs: readonly ForeignWalletPaymentOutput[];
  seed: Uint8Array;
  transactionVersion?: number;
  walletVersion?: number;
}): ForeignWalletSignedTransaction {
  assertForeignWalletWatchInputBounds(input.inputs);

  if (input.inputs.length === 0) {
    throw new Error('Foreign wallet transaction has no inputs.');
  }

  if (input.outputs.length === 0) {
    throw new Error('Foreign wallet transaction has no outputs.');
  }

  const transactionVersion = input.transactionVersion ?? 1;
  assertUint32(transactionVersion, 'transaction version');

  const seenOutpoints = new Set<string>();
  const preparedInputs = input.inputs.map((watchInput) => {
    const prepared = attestWatchInput({
      coin: input.coin,
      crypto: input.crypto,
      nonce: input.nonce,
      seed: input.seed,
      walletVersion: input.walletVersion,
      watchInput,
    });
    const outpoint = `${bytesToHex(prepared.txHash)}:${prepared.txPos}`;

    if (seenOutpoints.has(outpoint)) {
      throw new Error('Foreign wallet transaction contains a duplicate input.');
    }

    seenOutpoints.add(outpoint);
    return prepared;
  });

  const preparedOutputs = input.outputs.map((output) => {
    assertPositiveAtomic(output.value, 'output value');
    const recipient = validateForeignWalletRecipient({
      address: output.address,
      coin: input.coin,
      crypto: input.crypto,
    });

    return {
      scriptPubKey: recipient.scriptPubKey,
      value: output.value,
    };
  });

  const inputAmount = sumAtomic(preparedInputs.map((entry) => entry.value), 'input amount');
  const outputAmount = sumAtomic(preparedOutputs.map((entry) => entry.value), 'output amount');

  if (outputAmount > inputAmount) {
    throw new Error('Foreign wallet outputs exceed inputs.');
  }

  const scripts = preparedInputs.map((preparedInput, inputIndex) => {
    const signaturePreimage = serializeTransaction({
      inputs: preparedInputs,
      outputs: preparedOutputs,
      signatureInputIndex: inputIndex,
      transactionVersion,
    });
    const signatureHash = doubleSha256(
      appendBytes(signaturePreimage, uint32ToLittleEndian(SIGHASH_ALL)),
      input.crypto,
    );

    const signature = signForeignWalletDigest({
      chain: preparedInput.path.chain,
      coin: input.coin,
      crypto: input.crypto,
      digest: signatureHash,
      index: preparedInput.path.index,
      nonce: input.nonce,
      seed: input.seed,
      walletVersion: input.walletVersion,
    });

    if (!bytesEqual(signature.publicKey, preparedInput.publicKey)) {
      throw new Error('Foreign wallet signing key changed after approval.');
    }

    return appendBytes(
      pushData(appendBytes(signature.derSignature, Uint8Array.of(SIGHASH_ALL))),
      pushData(signature.publicKey),
    );
  });

  const rawTransaction = serializeTransaction({
    inputs: preparedInputs,
    outputs: preparedOutputs,
    scripts,
    transactionVersion,
  });
  const transactionHash = Uint8Array.from(doubleSha256(rawTransaction, input.crypto)).reverse();

  return {
    fee: inputAmount - outputAmount,
    inputAmount,
    outputAmount,
    rawTransactionHex: bytesToHex(rawTransaction),
    transactionSize: rawTransaction.byteLength,
    txId: bytesToHex(transactionHash),
  };
}

export function attestForeignWalletWatchInput(input: {
  coin: ForeignWalletCoin;
  crypto: ForeignWalletCrypto;
  nonce?: number;
  seed: Uint8Array;
  walletVersion?: number;
  watchInput: ForeignWalletWatchInput;
}): void {
  attestWatchInput(input);
}

export function assertForeignWalletWatchInputBounds(inputs: readonly ForeignWalletWatchInput[]): void {
  if (inputs.length > MAX_WATCH_INPUTS) {
    throw new Error('Foreign wallet input count exceeds the safe limit.');
  }

  const previousTransactions = new Map<string, number>();
  let totalBytes = 0;

  for (const input of inputs) {
    const normalizedHash = input.txHash.trim().toLowerCase();
    const normalizedRaw = input.previousTransactionHex.trim();
    if (normalizedRaw.length > MAX_PREVIOUS_TRANSACTION_BYTES * 2) {
      throw new Error('Foreign wallet previous transaction exceeds the safe limit.');
    }

    if (!previousTransactions.has(normalizedHash)) {
      const byteLength = Math.ceil(normalizedRaw.length / 2);
      previousTransactions.set(normalizedHash, byteLength);
      totalBytes += byteLength;
      if (totalBytes > MAX_TOTAL_PREVIOUS_TRANSACTION_BYTES) {
        throw new Error('Foreign wallet previous transactions exceed the safe limit.');
      }
    }
  }
}

function attestWatchInput(input: {
  coin: ForeignWalletCoin;
  crypto: ForeignWalletCrypto;
  nonce?: number;
  seed: Uint8Array;
  walletVersion?: number;
  watchInput: ForeignWalletWatchInput;
}): PreparedInput {
  const { watchInput } = input;
  assertPositiveAtomic(watchInput.value, 'input value');
  assertUint32(watchInput.txPos, 'input position');

  if (!Number.isSafeInteger(watchInput.height) || watchInput.height <= 0) {
    throw new Error('Foreign wallet input is not confirmed.');
  }

  const txHash = hexToBytes(watchInput.txHash, 32, 'input transaction hash');
  const scriptPubKey = hexToBytes(watchInput.scriptPubKey, 25, 'input script');
  const path = parseWalletPath(watchInput.path);
  const previousTransaction = parsePreviousTransaction(watchInput.previousTransactionHex, input.crypto);

  if (previousTransaction.txId !== watchInput.txHash.trim().toLowerCase()) {
    throw new Error('Foreign wallet input transaction hash does not match its raw transaction.');
  }

  const previousOutput = previousTransaction.outputs[watchInput.txPos];

  if (!previousOutput
    || previousOutput.value !== watchInput.value
    || !bytesEqual(previousOutput.scriptPubKey, scriptPubKey)) {
    throw new Error('Foreign wallet input does not match its previous transaction output.');
  }

  const leaf = deriveForeignWalletLeafPublicData({
    chain: path.chain,
    coin: input.coin,
    crypto: input.crypto,
    index: path.index,
    nonce: input.nonce,
    seed: input.seed,
    walletVersion: input.walletVersion,
  });
  const expectedScript = p2pkhScript(input.crypto.ripemd160(input.crypto.sha256(leaf.publicKey)));

  if (leaf.address !== watchInput.address.trim()
    || leaf.path.toLowerCase() !== watchInput.path.trim().toLowerCase()
    || !bytesEqual(expectedScript, scriptPubKey)) {
    throw new Error('Foreign wallet input does not match its derivation path.');
  }

  return {
    path,
    publicKey: leaf.publicKey,
    scriptPubKey,
    txHash,
    txPos: watchInput.txPos,
    value: watchInput.value,
  };
}

function decodeBase58Recipient(
  address: string,
  format: AddressFormat,
  crypto: ForeignWalletCrypto,
): ForeignWalletRecipient | null {
  let decoded: Uint8Array;

  try {
    decoded = base58.decode(address);
  } catch {
    return null;
  }

  if (decoded.byteLength !== 25) {
    return null;
  }

  const payload = decoded.subarray(0, 21);
  const checksum = decoded.subarray(21);

  if (!bytesEqual(checksum, doubleSha256(payload, crypto).subarray(0, 4))) {
    return null;
  }

  const prefix = payload[0];
  const hash = payload.subarray(1);

  if (prefix === format.p2pkhPrefix) {
    return { address, outputType: 'P2PKH', scriptPubKey: p2pkhScript(hash) };
  }

  if (format.p2shPrefix !== undefined
    && (prefix === format.p2shPrefix || format.legacyP2shPrefixes?.includes(prefix))) {
    const normalizedAddress = prefix === format.p2shPrefix
      ? address
      : encodeBase58Check(Uint8Array.of(format.p2shPrefix, ...hash), crypto);

    return { address: normalizedAddress, outputType: 'P2SH', scriptPubKey: p2shScript(hash) };
  }

  return null;
}

function decodeSegwitRecipient(address: string, format: AddressFormat): ForeignWalletRecipient | null {
  if (!format.bech32Hrp || !format.supportedSegwit || !isSingleCase(address)) {
    return null;
  }

  const normalizedAddress = address.toLowerCase();

  for (const candidate of [
    { coder: bech32, expectedVersion: 0 },
  ] as const) {
    try {
      const decoded = candidate.coder.decode(normalizedAddress as `${string}1${string}`);

      if (decoded.prefix !== format.bech32Hrp || decoded.words.length < 2) {
        continue;
      }

      const witnessVersion = decoded.words[0];
      const witnessProgram = candidate.coder.fromWords(decoded.words.slice(1));

      if (witnessVersion !== candidate.expectedVersion) {
        continue;
      }

      const outputType = witnessVersion === 0
        ? (witnessProgram.byteLength === 20 ? 'P2WPKH' : witnessProgram.byteLength === 32 ? 'P2WSH' : null)
        : null;

      if (!outputType || !format.supportedSegwit.includes(outputType)) {
        continue;
      }

      const versionOpcode = witnessVersion === 0 ? 0x00 : 0x50 + witnessVersion;
      return {
        address: normalizedAddress,
        outputType,
        scriptPubKey: Uint8Array.of(versionOpcode, witnessProgram.byteLength, ...witnessProgram),
      };
    } catch {
      // Try the other checksum encoding before rejecting the address.
    }
  }

  return null;
}

function serializeTransaction(input: {
  inputs: readonly PreparedInput[];
  outputs: readonly PreparedOutput[];
  scripts?: readonly Uint8Array[];
  signatureInputIndex?: number;
  transactionVersion: number;
}) {
  const bytes: number[] = [];
  writeBytes(bytes, uint32ToLittleEndian(input.transactionVersion));
  writeBytes(bytes, encodeCompactSize(input.inputs.length));

  for (let index = 0; index < input.inputs.length; index += 1) {
    const transactionInput = input.inputs[index];
    writeBytes(bytes, Uint8Array.from(transactionInput.txHash).reverse());
    writeBytes(bytes, uint32ToLittleEndian(transactionInput.txPos));

    const script = input.signatureInputIndex === undefined
      ? input.scripts?.[index] ?? new Uint8Array()
      : index === input.signatureInputIndex ? transactionInput.scriptPubKey : new Uint8Array();
    writeBytes(bytes, encodeCompactSize(script.byteLength));
    writeBytes(bytes, script);
    writeBytes(bytes, uint32ToLittleEndian(NO_LOCKTIME_SEQUENCE));
  }

  writeBytes(bytes, encodeCompactSize(input.outputs.length));
  for (const output of input.outputs) {
    writeBytes(bytes, uint64ToLittleEndian(output.value));
    writeBytes(bytes, encodeCompactSize(output.scriptPubKey.byteLength));
    writeBytes(bytes, output.scriptPubKey);
  }

  writeBytes(bytes, uint32ToLittleEndian(0));
  return Uint8Array.from(bytes);
}

function parsePreviousTransaction(rawHex: string, crypto: ForeignWalletCrypto) {
  const normalized = rawHex.trim().toLowerCase();

  if (normalized.length > MAX_PREVIOUS_TRANSACTION_BYTES * 2
    || !/^[0-9a-f]+$/.test(normalized)
    || normalized.length % 2 !== 0) {
    throw new Error('Invalid foreign wallet previous transaction.');
  }

  const raw = hexToBytes(normalized, normalized.length / 2, 'previous transaction');

  if (raw.byteLength < 10) {
    throw new Error('Invalid foreign wallet previous transaction size.');
  }

  const cursor = { offset: 4 };
  const hasWitness = raw[cursor.offset] === 0 && raw[cursor.offset + 1] === 1;

  if (raw[cursor.offset] === 0 && raw[cursor.offset + 1] !== 1) {
    throw new Error('Invalid foreign wallet previous transaction witness marker.');
  }
  const bodyStart = hasWitness ? 6 : 4;

  if (hasWitness) {
    cursor.offset = bodyStart;
  }

  const inputCount = readCompactSize(raw, cursor);
  if (inputCount <= 0 || inputCount > 100_000) {
    throw new Error('Invalid foreign wallet previous transaction inputs.');
  }

  for (let index = 0; index < inputCount; index += 1) {
    requireRemaining(raw, cursor, 36);
    cursor.offset += 36;
    const scriptLength = readCompactSize(raw, cursor);
    requireRemaining(raw, cursor, scriptLength + 4);
    cursor.offset += scriptLength + 4;
  }

  const outputCount = readCompactSize(raw, cursor);
  if (outputCount <= 0 || outputCount > 100_000) {
    throw new Error('Invalid foreign wallet previous transaction outputs.');
  }

  const outputs: Array<{ scriptPubKey: Uint8Array; value: bigint }> = [];
  for (let index = 0; index < outputCount; index += 1) {
    const value = readUint64(raw, cursor);
    const scriptLength = readCompactSize(raw, cursor);
    requireRemaining(raw, cursor, scriptLength);
    outputs.push({
      scriptPubKey: raw.slice(cursor.offset, cursor.offset + scriptLength),
      value,
    });
    cursor.offset += scriptLength;
  }

  const witnessStart = cursor.offset;
  let hasWitnessData = false;
  if (hasWitness) {
    for (let inputIndex = 0; inputIndex < inputCount; inputIndex += 1) {
      const itemCount = readCompactSize(raw, cursor);
      if (itemCount > 100_000) {
        throw new Error('Invalid foreign wallet previous transaction witness.');
      }
      hasWitnessData ||= itemCount > 0;

      for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
        const itemLength = readCompactSize(raw, cursor);
        requireRemaining(raw, cursor, itemLength);
        cursor.offset += itemLength;
      }
    }

    if (!hasWitnessData) {
      throw new Error('Foreign wallet previous transaction has superfluous witness framing.');
    }
  }

  requireRemaining(raw, cursor, 4);
  const tailStart = cursor.offset;
  cursor.offset += 4;
  if (cursor.offset !== raw.byteLength) {
    throw new Error('Foreign wallet previous transaction has trailing data.');
  }
  const transactionIdBytes = hasWitness
    ? appendBytes(raw.subarray(0, 4), raw.subarray(bodyStart, witnessStart), raw.subarray(tailStart, cursor.offset))
    : raw;
  const txId = bytesToHex(Uint8Array.from(doubleSha256(transactionIdBytes, crypto)).reverse());

  return { outputs, txId };
}

function readCompactSize(bytes: Uint8Array, cursor: { offset: number }) {
  requireRemaining(bytes, cursor, 1);
  const prefix = bytes[cursor.offset++];

  if (prefix < 0xfd) {
    return prefix;
  }

  if (prefix === 0xfd) {
    requireRemaining(bytes, cursor, 2);
    const value = bytes[cursor.offset] | (bytes[cursor.offset + 1] << 8);
    cursor.offset += 2;
    if (value < 0xfd) throw new Error('Non-canonical foreign wallet CompactSize.');
    return value;
  }

  if (prefix === 0xfe) {
    const value = readUint32(bytes, cursor);
    if (value <= 0xffff) throw new Error('Non-canonical foreign wallet CompactSize.');
    return value;
  }

  const value = readUint64(bytes, cursor);
  if (value <= BigInt(MAX_UINT32)) throw new Error('Non-canonical foreign wallet CompactSize.');
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Foreign wallet CompactSize is too large.');
  return Number(value);
}

function readUint32(bytes: Uint8Array, cursor: { offset: number }) {
  requireRemaining(bytes, cursor, 4);
  const value = bytes[cursor.offset]
    + bytes[cursor.offset + 1] * 0x100
    + bytes[cursor.offset + 2] * 0x10000
    + bytes[cursor.offset + 3] * 0x1000000;
  cursor.offset += 4;
  return value;
}

function readUint64(bytes: Uint8Array, cursor: { offset: number }) {
  requireRemaining(bytes, cursor, 8);
  let value = 0n;

  for (let index = 7; index >= 0; index -= 1) {
    value = (value << 8n) + BigInt(bytes[cursor.offset + index]);
  }
  cursor.offset += 8;

  return value;
}

function requireRemaining(bytes: Uint8Array, cursor: { offset: number }, length: number) {
  if (!Number.isSafeInteger(length) || length < 0 || cursor.offset + length > bytes.byteLength) {
    throw new Error('Truncated foreign wallet previous transaction.');
  }
}

function parseWalletPath(path: string) {
  const match = /^[mM]\/(0|1)\/(0|[1-9][0-9]{0,9})$/.exec(path.trim());

  if (!match) {
    throw new Error('Invalid foreign wallet derivation path.');
  }

  const chain = Number(match[1]) as 0 | 1;
  const index = Number(match[2]);

  if (!Number.isSafeInteger(index) || index > 0x7fffffff) {
    throw new Error('Invalid foreign wallet derivation path.');
  }

  return { chain, index };
}

function p2pkhScript(publicKeyHash: Uint8Array) {
  if (publicKeyHash.byteLength !== 20) {
    throw new Error('Invalid P2PKH hash.');
  }

  return Uint8Array.of(0x76, 0xa9, 0x14, ...publicKeyHash, 0x88, 0xac);
}

function p2shScript(scriptHash: Uint8Array) {
  if (scriptHash.byteLength !== 20) {
    throw new Error('Invalid P2SH hash.');
  }

  return Uint8Array.of(0xa9, 0x14, ...scriptHash, 0x87);
}

function pushData(data: Uint8Array) {
  if (data.byteLength > 75) {
    throw new Error('Foreign wallet script item is too large.');
  }

  return Uint8Array.of(data.byteLength, ...data);
}

function encodeBase58Check(payload: Uint8Array, crypto: ForeignWalletCrypto) {
  return base58.encode(appendBytes(payload, doubleSha256(payload, crypto).subarray(0, 4)));
}

function encodeCompactSize(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid CompactSize value.');
  }

  if (value < 0xfd) {
    return Uint8Array.of(value);
  }

  if (value <= 0xffff) {
    return Uint8Array.of(0xfd, value & 0xff, (value >>> 8) & 0xff);
  }

  if (value <= MAX_UINT32) {
    return appendBytes(Uint8Array.of(0xfe), uint32ToLittleEndian(value));
  }

  return appendBytes(Uint8Array.of(0xff), uint64ToLittleEndian(BigInt(value)));
}

function uint32ToLittleEndian(value: number) {
  assertUint32(value, 'uint32');
  return Uint8Array.of(
    value & 0xff,
    Math.floor(value / 0x100) & 0xff,
    Math.floor(value / 0x10000) & 0xff,
    Math.floor(value / 0x1000000) & 0xff,
  );
}

function uint64ToLittleEndian(value: bigint) {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error('Invalid uint64 value.');
  }

  const result = new Uint8Array(8);
  let remaining = value;

  for (let index = 0; index < result.byteLength; index += 1) {
    result[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  return result;
}

function hexToBytes(value: string, expectedLength: number, label: string) {
  const normalized = value.trim().toLowerCase();

  if (!new RegExp(`^[0-9a-f]{${expectedLength * 2}}$`).test(normalized)) {
    throw new Error(`Invalid foreign wallet ${label}.`);
  }

  return Uint8Array.from({ length: expectedLength }, (_entry, index) => (
    Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16)
  ));
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function appendBytes(...parts: readonly Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }

  return result;
}

function doubleSha256(bytes: Uint8Array, crypto: ForeignWalletCrypto) {
  return crypto.sha256(crypto.sha256(bytes));
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }

  return difference === 0;
}

function writeBytes(target: number[], bytes: Uint8Array) {
  for (const byte of bytes) {
    target.push(byte);
  }
}

function assertPositiveAtomic(value: bigint, label: string) {
  if (typeof value !== 'bigint' || value <= 0n || value > 0xffffffffffffffffn) {
    throw new Error(`Invalid foreign wallet ${label}.`);
  }
}

function assertUint32(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_UINT32) {
    throw new Error(`Invalid foreign wallet ${label}.`);
  }
}

function sumAtomic(values: readonly bigint[], label: string) {
  let total = 0n;

  for (const value of values) {
    total += value;
    if (total > 0xffffffffffffffffn) {
      throw new Error(`Invalid foreign wallet ${label}.`);
    }
  }

  return total;
}

function isSingleCase(value: string) {
  return value === value.toLowerCase() || value === value.toUpperCase();
}
