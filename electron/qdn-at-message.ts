// Purpose-built QDN bridge support for a zero-fee MESSAGE sent to an AT.
//
// This intentionally is not a general raw-transaction surface. The bridge
// accepts only a UTF-8 text message for a checksummed Qortium AT address and
// fixes every other MESSAGE field: no payment, no asset, no encryption, no
// transaction group, and fee zero. MESSAGE has its own nonce field, so callers
// must run MemoryPoW over these bytes locally before signing.

import { Sha256 } from 'asmcrypto.js';
import { base58Decode } from './base58.js';
import { getRequestValue, getString, type QdnAppRequest } from './qdn-request-values.js';

export const QORTIUM_MESSAGE_TRANSACTION_TYPE = 17;
export const QORTIUM_AT_ADDRESS_VERSION = 23;
export const QORTIUM_AT_MESSAGE_MAX_BYTES = 4_000;
// Previewnet's messageConfirmableDifficulty. An AT recipient is confirmable,
// so messageUnconfirmableDifficulty must never be used here.
export const QORTIUM_AT_MESSAGE_POW_DIFFICULTY = 12;

export type QortiumAtMessageRequest = {
  message: string;
  recipient: string;
};

export type QortiumAtMessageBytesInput = QortiumAtMessageRequest & {
  senderPublicKey: string | Uint8Array;
  timestamp: number;
};

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
  new DataView(bytes.buffer).setInt32(0, value, false);
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

function getUtf8Bytes(value: string) {
  return new TextEncoder().encode(value);
}

export function assertValidQortiumAtAddress(address: string, label = 'AT recipient address') {
  const decoded = base58Decode(address);

  if (decoded.length !== 25) {
    throw new Error(`${label} must decode to 25 bytes.`);
  }

  if (decoded[0] !== QORTIUM_AT_ADDRESS_VERSION) {
    throw new Error(`${label} must be a Qortium AT address.`);
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

export function getQortiumAtMessageRequest(request: QdnAppRequest): QortiumAtMessageRequest {
  const recipient =
    getString(getRequestValue(request, 'recipient')) ||
    getString(getRequestValue(request, 'recipientAddress'));
  const message = getString(getRequestValue(request, 'message'));

  if (!recipient) {
    throw new Error('SEND_MESSAGE requires an AT recipient address.');
  }

  if (!message) {
    throw new Error('SEND_MESSAGE requires non-empty message text.');
  }

  assertValidQortiumAtAddress(recipient);

  if (getUtf8Bytes(message).length > QORTIUM_AT_MESSAGE_MAX_BYTES) {
    throw new Error(
      `MESSAGE text exceeds the ${QORTIUM_AT_MESSAGE_MAX_BYTES.toLocaleString()} byte limit.`,
    );
  }

  return { message, recipient };
}

// Mirrors Core's MessageTransactionTransformer for a zero-fee, no-payment,
// plaintext message. In particular, this has no last-reference field because
// Qortium's current BaseTransactionData serialization does not chain one.
export function buildUnsignedQortiumAtMessageTransactionBytes(input: QortiumAtMessageBytesInput) {
  const senderPublicKey = getBytes(input.senderPublicKey, 'Sender public key', 32);
  const recipient = base58Decode(assertValidQortiumAtAddress(input.recipient));
  const messageBytes = getUtf8Bytes(input.message);

  if (messageBytes.length < 1 || messageBytes.length > QORTIUM_AT_MESSAGE_MAX_BYTES) {
    throw new Error(`MESSAGE text must be between 1 and ${QORTIUM_AT_MESSAGE_MAX_BYTES.toLocaleString()} bytes.`);
  }

  return concatBytes(
    int32ToBytes(QORTIUM_MESSAGE_TRANSACTION_TYPE),
    int64ToBytes(BigInt(input.timestamp), 'Timestamp'),
    int32ToBytes(0),
    senderPublicKey,
    int32ToBytes(0),
    new Uint8Array([1]),
    recipient,
    int64ToBytes(0n, 'MESSAGE amount'),
    int32ToBytes(messageBytes.length),
    messageBytes,
    new Uint8Array([0]),
    new Uint8Array([1]),
    int64ToBytes(0n, 'MESSAGE fee'),
  );
}
