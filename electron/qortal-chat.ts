import { base58Decode } from './qortal-payment.js';

export const QORTAL_CHAT_TRANSACTION_TYPE = 18;
export const QORTAL_CHAT_REFERENCE_FEATURE_TRIGGER_TIMESTAMP = 1674316800000;
export const QORTAL_CHAT_MAX_DATA_SIZE = 4000;
export const QORTAL_CHAT_POW_DIFFICULTY = 8;
export const QORTAL_GROUP_CHAT_NONCE_OFFSET = 112;

export type QortalGroupChatPayloadInput = {
  repliedTo?: string | null;
  specialId: string;
  text: string;
};

export type QortalGroupChatBytesInput = {
  chatReference?: string | null;
  lastReference: string | Uint8Array;
  message: string;
  senderPublicKey: string | Uint8Array;
  timestamp: number;
  txGroupId: number;
};

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

function getUtf8Bytes(value: string) {
  return new TextEncoder().encode(value);
}

function buildTiptapDocFromPlainText(text: string) {
  const content: Array<{ text?: string; type: 'hardBreak' | 'text' }> = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  lines.forEach((line, index) => {
    if (index > 0) {
      content.push({ type: 'hardBreak' });
    }

    if (line) {
      content.push({ text: line, type: 'text' });
    }
  });

  return {
    content: [
      {
        ...(content.length > 0 ? { content } : {}),
        type: 'paragraph',
      },
    ],
    type: 'doc',
  };
}

export function assertPositiveQortalGroupId(value: unknown, label = 'txGroupId') {
  const groupId = typeof value === 'number' ? value : Number(value);

  if (!Number.isInteger(groupId) || groupId <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return groupId;
}

export function assertValidQortalChatSignature(signature: string, label = 'Chat reference') {
  const bytes = base58Decode(signature);

  if (bytes.length !== 64) {
    throw new Error(`${label} must decode to a 64-byte signature.`);
  }

  return signature;
}

export function buildQortalGroupChatPayload(input: QortalGroupChatPayloadInput) {
  const trimmed = input.text.trim();

  if (!trimmed) {
    throw new Error('Message text must not be empty.');
  }

  const payload = JSON.stringify({
    images: [],
    isEdited: false,
    messageText: buildTiptapDocFromPlainText(trimmed),
    repliedTo: input.repliedTo || '',
    specialId: input.specialId,
    type: '',
    version: 3,
  });
  const size = getUtf8Bytes(payload).length;

  if (size > QORTAL_CHAT_MAX_DATA_SIZE) {
    throw new Error(`Message is too large. Qortal CHAT messages are limited to ${QORTAL_CHAT_MAX_DATA_SIZE} bytes.`);
  }

  return payload;
}

export function buildUnsignedQortalGroupChatTransactionBytes(input: QortalGroupChatBytesInput) {
  const timestamp = BigInt(input.timestamp);
  const txGroupId = assertPositiveQortalGroupId(input.txGroupId);
  const lastReference = getBytes(input.lastReference, 'Last reference', 64);
  const senderPublicKey = getBytes(input.senderPublicKey, 'Sender public key', 32);
  const messageBytes = getUtf8Bytes(input.message);
  const chatReference = input.chatReference ? getBytes(input.chatReference, 'Chat reference', 64) : null;

  if (messageBytes.length < 1 || messageBytes.length > QORTAL_CHAT_MAX_DATA_SIZE) {
    throw new Error(`Message must be between 1 and ${QORTAL_CHAT_MAX_DATA_SIZE} bytes.`);
  }

  const baseBytes = concatBytes(
    int32ToBytes(QORTAL_CHAT_TRANSACTION_TYPE),
    int64ToBytes(timestamp, 'Timestamp'),
    int32ToBytes(txGroupId),
    lastReference,
    senderPublicKey,
    int32ToBytes(0),
    new Uint8Array([0]),
    int32ToBytes(messageBytes.length),
    messageBytes,
    new Uint8Array([0]),
    new Uint8Array([1]),
    int64ToBytes(0n, 'Fee'),
  );

  if (input.timestamp < QORTAL_CHAT_REFERENCE_FEATURE_TRIGGER_TIMESTAMP) {
    return baseBytes;
  }

  return concatBytes(
    baseBytes,
    new Uint8Array([chatReference ? 1 : 0]),
    ...(chatReference ? [chatReference] : []),
  );
}

export function stampQortalGroupChatNonce(unsignedBytes: Uint8Array, nonce: number) {
  const stampedBytes = new Uint8Array(unsignedBytes);
  stampedBytes.set(int32ToBytes(nonce), QORTAL_GROUP_CHAT_NONCE_OFFSET);
  return stampedBytes;
}
