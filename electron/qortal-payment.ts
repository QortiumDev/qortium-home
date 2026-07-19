import { Sha256 } from 'asmcrypto.js';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_ALPHABET_MAP = new Map<string, number>(
  [...BASE58_ALPHABET].map((character, index) => [character, index]),
);

export const QORT_DECIMALS_ATOMIC = 100_000_000n;
export const QORTAL_ADDRESS_VERSION = 58;

export type PaymentTransactionBytesInput = {
  amountAtomic: bigint;
  feeAtomic: bigint;
  groupId?: number;
  lastReference: string | Uint8Array;
  recipient: string;
  senderPublicKey: string | Uint8Array;
  timestamp: number;
};

export function base58Encode(buffer: Uint8Array) {
  if (buffer.length === 0) {
    return '';
  }

  const digits = [0];

  for (const byte of buffer) {
    for (let index = 0; index < digits.length; index += 1) {
      digits[index] <<= 8;
    }

    digits[0] += byte;

    let carry = 0;

    for (let index = 0; index < digits.length; index += 1) {
      digits[index] += carry;
      carry = (digits[index] / 58) | 0;
      digits[index] %= 58;
    }

    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  for (let index = 0; buffer[index] === 0 && index < buffer.length - 1; index += 1) {
    digits.push(0);
  }

  return digits
    .reverse()
    .map((digit) => BASE58_ALPHABET[digit])
    .join('');
}

export function base58Decode(value: string) {
  if (value.length === 0) {
    return new Uint8Array(0);
  }

  const bytes = [0];

  for (const character of value) {
    const mappedValue = BASE58_ALPHABET_MAP.get(character);

    if (mappedValue === undefined) {
      throw new Error(`Base58 value contains an invalid character: ${character}`);
    }

    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] *= 58;
    }

    bytes[0] += mappedValue;

    let carry = 0;

    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] += carry;
      carry = bytes[index] >> 8;
      bytes[index] &= 0xff;
    }

    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (let index = 0; value[index] === '1' && index < value.length - 1; index += 1) {
    bytes.push(0);
  }

  return new Uint8Array(bytes.reverse());
}

function sha256Sync(data: Uint8Array) {
  const result = new Sha256().process(data).finish().result;

  if (!result) {
    throw new Error('SHA-256 failed.');
  }

  return result;
}

function concatBytes(...chunks: Uint8Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return bytes;
}

function int32ToBytes(value: number) {
  if (!Number.isInteger(value) || value < -2_147_483_648 || value > 2_147_483_647) {
    throw new Error(`Invalid int32 value: ${value}`);
  }

  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, value);
  return bytes;
}

function int64ToBytes(value: bigint, label: string) {
  if (value < 0n || value > 9_223_372_036_854_775_807n) {
    throw new Error(`${label} is outside the signed 64-bit transaction range.`);
  }

  const bytes = new Uint8Array(8);
  let remaining = value;

  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  return bytes;
}

function getBytes(value: string | Uint8Array, label: string, expectedLength: number) {
  const bytes = typeof value === 'string' ? base58Decode(value) : new Uint8Array(value);

  if (bytes.length !== expectedLength) {
    throw new Error(`${label} must decode to ${expectedLength} bytes.`);
  }

  return bytes;
}

function normalizeDecimalInput(value: string | number, label: string) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} must be a finite number.`);
    }

    return value.toLocaleString('en-US', {
      maximumFractionDigits: 8,
      minimumFractionDigits: 0,
      useGrouping: false,
    });
  }

  return value.trim();
}

export function qortDecimalToAtomic(value: string | number, label = 'QORT amount') {
  const normalized = normalizeDecimalInput(value, label);
  const match = normalized.match(/^(\d+)(?:\.(\d{0,8}))?$/);

  if (!match) {
    throw new Error(`${label} must be a decimal QORT amount with no more than 8 decimal places.`);
  }

  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? '').padEnd(8, '0'));

  return whole * QORT_DECIMALS_ATOMIC + fraction;
}

export function atomicLongToBigInt(value: unknown, label = 'Atomic amount') {
  let normalized: string;

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`${label} must be an integer.`);
    }

    normalized = String(value);
  } else if (typeof value === 'bigint') {
    return value;
  } else if (typeof value === 'string') {
    normalized = value.trim();
  } else {
    throw new Error(`${label} must be an integer.`);
  }

  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be an integer.`);
  }

  return BigInt(normalized);
}

export function formatQortAtomic(value: bigint) {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const whole = absolute / QORT_DECIMALS_ATOMIC;
  const fraction = absolute % QORT_DECIMALS_ATOMIC;
  const fractionText = fraction.toString().padStart(8, '0').replace(/0+$/, '');

  return `${sign}${whole.toString()}${fractionText ? `.${fractionText}` : ''}`;
}

export function assertPositiveQortAmount(value: bigint, label = 'QORT amount') {
  if (value <= 0n) {
    throw new Error(`${label} must be greater than 0.`);
  }

  return value;
}

export function assertValidQortalAddress(address: string, label = 'Qortal address') {
  const decoded = base58Decode(address);

  if (decoded.length !== 25) {
    throw new Error(`${label} must decode to 25 bytes.`);
  }

  if (decoded[0] !== QORTAL_ADDRESS_VERSION) {
    throw new Error(`${label} has an invalid version byte.`);
  }

  const payload = decoded.slice(0, 21);
  const checksum = decoded.slice(21);
  const expectedChecksum = sha256Sync(sha256Sync(payload)).slice(0, 4);

  for (let index = 0; index < checksum.length; index += 1) {
    if (checksum[index] !== expectedChecksum[index]) {
      throw new Error(`${label} has an invalid checksum.`);
    }
  }

  return address;
}

export function isValidQortalAddress(value: unknown): value is string {
  if (typeof value !== 'string' || !value) {
    return false;
  }

  try {
    assertValidQortalAddress(value);
    return true;
  } catch {
    return false;
  }
}

export function buildUnsignedPaymentTransactionBytes(input: PaymentTransactionBytesInput) {
  const senderPublicKey = getBytes(input.senderPublicKey, 'Sender public key', 32);
  const lastReference = getBytes(input.lastReference, 'Last reference', 64);
  const recipient = base58Decode(assertValidQortalAddress(input.recipient, 'Recipient address'));

  return concatBytes(
    int32ToBytes(2),
    int64ToBytes(BigInt(input.timestamp), 'Timestamp'),
    int32ToBytes(input.groupId ?? 0),
    lastReference,
    senderPublicKey,
    recipient,
    int64ToBytes(input.amountAtomic, 'Payment amount'),
    int64ToBytes(input.feeAtomic, 'Payment fee'),
  );
}

export function appendSignatureToTransactionBytes(unsignedBytes: Uint8Array, signature: Uint8Array) {
  if (signature.length !== 64) {
    throw new Error('Transaction signature must be 64 bytes.');
  }

  return concatBytes(unsignedBytes, signature);
}

export function getSignatureFromSignedTransactionBytes(signedBytes: Uint8Array) {
  if (signedBytes.length < 64) {
    throw new Error('Signed transaction bytes do not contain a signature.');
  }

  return base58Encode(signedBytes.slice(-64));
}
