import { Sha256 } from 'asmcrypto.js';

const ARBITRARY_TRANSACTION_TYPE = 10;
const TRANSACTION_NONCE_OFFSET = 48;

const PUBLIC_KEY_LENGTH = 32;
const ADDRESS_LENGTH = 25;
const LONG_LENGTH = 8;
const INT_LENGTH = 4;
const PAYMENT_LENGTH = ADDRESS_LENGTH + LONG_LENGTH + LONG_LENGTH;
const PRIVATE_KEY_LENGTH = 32;
const SHA256_LENGTH = 32;

const MAX_NAME_SIZE = 40;
const MAX_IDENTIFIER_LENGTH = 64;
const MAX_DATA_SIZE = 256;

const VALID_METHODS = new Set([0, 1, 2]);
const VALID_COMPRESSIONS = new Set([0, 1]);

class ArbitraryTxReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get position() {
    return this.offset;
  }

  get remaining() {
    return this.bytes.length - this.offset;
  }

  readByte(label: string) {
    return this.readBytes(1, label)[0];
  }

  readInt32(label: string) {
    const bytes = this.readBytes(INT_LENGTH, label);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    return view.getInt32(0, false);
  }

  readBytes(length: number, label: string) {
    if (!Number.isInteger(length) || length < 0) {
      throw new Error(`Malformed ARBITRARY transaction: invalid ${label} length.`);
    }

    if (this.offset + length > this.bytes.length) {
      throw new Error(`Malformed ARBITRARY transaction: truncated ${label}.`);
    }

    const start = this.offset;
    this.offset += length;

    return this.bytes.subarray(start, this.offset);
  }

  spanFrom(start: number) {
    return this.bytes.subarray(start, this.offset);
  }

  readSizedBytes(label: string, maxLength: number) {
    const start = this.offset;
    const length = this.readInt32(`${label} length`);

    if (length < 0) {
      throw new Error(`Malformed ARBITRARY transaction: negative ${label} length.`);
    }

    if (length > maxLength) {
      throw new Error(`Malformed ARBITRARY transaction: ${label} length exceeds ${maxLength} bytes.`);
    }

    this.readBytes(length, label);

    return this.bytes.subarray(start, this.offset);
  }

  readLengthPrefixedBytes(label: string, maxLength: number) {
    const lengthBytes = this.readBytes(INT_LENGTH, `${label} length`);
    const view = new DataView(lengthBytes.buffer, lengthBytes.byteOffset, lengthBytes.byteLength);
    const length = view.getInt32(0, false);

    if (length < 0) {
      throw new Error(`Malformed ARBITRARY transaction: negative ${label} length.`);
    }

    if (length > maxLength) {
      throw new Error(`Malformed ARBITRARY transaction: ${label} length exceeds ${maxLength} bytes.`);
    }

    return {
      bytes: this.readBytes(length, label),
      length,
      lengthBytes,
    };
  }
}

function sha256(data: Uint8Array) {
  const result = new Sha256().process(data).finish().result;

  if (!result) {
    throw new Error('SHA-256 failed.');
  }

  return new Uint8Array(result);
}

function concatBytes(chunks: Uint8Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return bytes;
}

function assertValidInt(value: number, validValues: Set<number>, label: string) {
  if (!validValues.has(value)) {
    throw new Error(`Malformed ARBITRARY transaction: invalid ${label} value ${value}.`);
  }
}

function readAndAppendInt32(
  reader: ArbitraryTxReader,
  chunks: Uint8Array[],
  label: string,
  validValues?: Set<number>,
) {
  const start = reader.position;
  const value = reader.readInt32(label);

  if (validValues) {
    assertValidInt(value, validValues, label);
  }

  chunks.push(reader.spanFrom(start));

  return value;
}

function readAndAppendBytes(reader: ArbitraryTxReader, chunks: Uint8Array[], length: number, label: string) {
  chunks.push(reader.readBytes(length, label));
}

function readAndAppendSizedBytes(
  reader: ArbitraryTxReader,
  chunks: Uint8Array[],
  label: string,
  maxLength: number,
) {
  chunks.push(reader.readSizedBytes(label, maxLength));
}

function readAndAppendSecret(reader: ArbitraryTxReader, chunks: Uint8Array[]) {
  const start = reader.position;
  const secretLength = reader.readInt32('secret length');

  if (secretLength < 0) {
    throw new Error('Malformed ARBITRARY transaction: negative secret length.');
  }

  if (secretLength > PRIVATE_KEY_LENGTH) {
    throw new Error(`Malformed ARBITRARY transaction: secret length exceeds ${PRIVATE_KEY_LENGTH} bytes.`);
  }

  reader.readBytes(secretLength, 'secret');
  chunks.push(reader.spanFrom(start));
}

function readAndAppendPayments(reader: ArbitraryTxReader, chunks: Uint8Array[]) {
  const start = reader.position;
  const paymentsCount = reader.readInt32('payments count');

  if (paymentsCount < 0) {
    throw new Error('Malformed ARBITRARY transaction: negative payments count.');
  }

  reader.readBytes(paymentsCount * PAYMENT_LENGTH, 'payments');
  chunks.push(reader.spanFrom(start));
}

/**
 * Convert Core's raw unsigned ARBITRARY transaction bytes to
 * ArbitraryTransactionTransformer.toBytesForSigning() layout.
 */
export function arbitraryRawToSigningBytes(rawUnsignedBytes: Uint8Array): Uint8Array {
  const reader = new ArbitraryTxReader(rawUnsignedBytes);
  const chunks: Uint8Array[] = [];
  const transactionType = readAndAppendInt32(reader, chunks, 'transaction type');

  if (transactionType !== ARBITRARY_TRANSACTION_TYPE) {
    throw new Error(
      `Expected ARBITRARY transaction type ${ARBITRARY_TRANSACTION_TYPE}, received ${transactionType}.`,
    );
  }

  readAndAppendBytes(reader, chunks, LONG_LENGTH, 'timestamp');
  readAndAppendBytes(reader, chunks, INT_LENGTH, 'transaction group ID');
  readAndAppendBytes(reader, chunks, PUBLIC_KEY_LENGTH, 'creator public key');
  readAndAppendBytes(reader, chunks, INT_LENGTH, 'nonce');

  if (reader.position !== TRANSACTION_NONCE_OFFSET + INT_LENGTH) {
    throw new Error('Malformed ARBITRARY transaction: unexpected nonce offset.');
  }

  readAndAppendSizedBytes(reader, chunks, 'name', MAX_NAME_SIZE);
  readAndAppendSizedBytes(reader, chunks, 'identifier', MAX_IDENTIFIER_LENGTH);
  readAndAppendInt32(reader, chunks, 'method', VALID_METHODS);
  readAndAppendSecret(reader, chunks);
  readAndAppendInt32(reader, chunks, 'compression', VALID_COMPRESSIONS);
  readAndAppendPayments(reader, chunks);
  readAndAppendBytes(reader, chunks, INT_LENGTH, 'service');

  const dataType = reader.readByte('data type');
  const data = reader.readLengthPrefixedBytes('data', MAX_DATA_SIZE);

  chunks.push(data.lengthBytes);
  chunks.push(dataType === 0 ? data.bytes : sha256(data.bytes));

  readAndAppendBytes(reader, chunks, INT_LENGTH, 'size');
  readAndAppendSizedBytes(reader, chunks, 'metadata hash', SHA256_LENGTH);
  readAndAppendBytes(reader, chunks, LONG_LENGTH, 'fee');

  if (reader.remaining !== 0) {
    throw new Error('Malformed ARBITRARY transaction: unexpected trailing bytes.');
  }

  return concatBytes(chunks);
}
