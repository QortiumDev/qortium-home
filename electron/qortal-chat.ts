import { base58Decode, qortDecimalToAtomic } from './qortal-payment.js';

export const QORTAL_CHAT_TRANSACTION_TYPE = 18;
export const QORTAL_CHAT_REFERENCE_FEATURE_TRIGGER_TIMESTAMP = 1674316800000;
export const QORTAL_CHAT_MAX_DATA_SIZE = 4000;
export const QORTAL_GROUP_CHAT_NONCE_OFFSET = 112;

// Qortal Core sets CHAT proof-of-work difficulty purely from the sender's
// confirmed QORT balance, with no height/timestamp trigger:
// getConfirmedBalance(QORT) >= 4 QORT (raw/atomic) => 8 leading-zero bits,
// else 18. Verified against reticulum/repos/Qortal/qortal
// ChatTransaction.java:104,250 (POW_QORT_THRESHOLD = 400000000).
export const QORTAL_CHAT_POW_QORT_THRESHOLD = 400_000_000n;
export const QORTAL_CHAT_POW_DIFFICULTY_ABOVE = 8;
export const QORTAL_CHAT_POW_DIFFICULTY_BELOW = 18;

// Pure: raw/atomic confirmed QORT balance -> the difficulty Core will expect
// for a CHAT transaction from that sender. Callers are responsible for
// fetching the balance and falling back to QORTAL_CHAT_POW_DIFFICULTY_BELOW
// (the safer, higher difficulty) if the fetch fails — a slower send beats a
// send that Core rejects for insufficient proof-of-work.
export function qortalChatPowDifficultyForBalance(confirmedBalanceRaw: number | bigint): number {
  const balance = typeof confirmedBalanceRaw === 'bigint'
    ? confirmedBalanceRaw
    : BigInt(Math.trunc(confirmedBalanceRaw));
  return balance >= QORTAL_CHAT_POW_QORT_THRESHOLD
    ? QORTAL_CHAT_POW_DIFFICULTY_ABOVE
    : QORTAL_CHAT_POW_DIFFICULTY_BELOW;
}

// Fetch-failure-safe: turns an untrusted /addresses/balance/{address} response
// body (a decimal QORT string or number, NOT raw/atomic) into a difficulty.
// Any parse failure (missing field, non-numeric, malformed decimal) falls
// back to the safer higher difficulty rather than throwing, so a balance
// lookup that returns something unexpected never blocks a send outright —
// it only makes the PoW slower. Network-level fetch failures are the
// caller's responsibility (this only covers response-shape failures).
export function qortalChatPowDifficultyForBalanceResponse(value: unknown): number {
  try {
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new Error('QORT balance response was not a decimal amount.');
    }
    return qortalChatPowDifficultyForBalance(qortDecimalToAtomic(value, 'QORT balance'));
  } catch {
    return QORTAL_CHAT_POW_DIFFICULTY_BELOW;
  }
}

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

export type OpenQortalGroupMetadata = {
  groupLabel: string;
  groupName: string | null;
};

export function buildQortalAccountGroupsPath(address: string) {
  return `/groups/member/${encodeURIComponent(address)}?limit=0&reverse=true`;
}

export function assertOpenQortalGroupMetadata(
  value: unknown,
  txGroupId: number,
): OpenQortalGroupMetadata {
  const metadata = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const rawGroupName = metadata?.groupName ?? metadata?.name;
  const groupName = typeof rawGroupName === 'string' && rawGroupName.trim()
    ? rawGroupName.trim()
    : null;

  if (metadata?.isOpen === false) {
    throw new Error(
      'This Qortal group is private. Private-group encryption is not supported yet, so the message was not sent.',
    );
  }

  if (metadata?.isOpen !== true) {
    throw new Error(
      'Home could not verify that this Qortal group is public, so the message was not sent.',
    );
  }

  // Bind the response to the group we actually asked about. Without this, a
  // misrouted proxy, a stale cache, or a node answering the wrong group could
  // hand back {isOpen:true} for a DIFFERENT, actually-open group and trick
  // Home into treating an unverified (possibly private) target group as
  // public. This does not solve the deeper "a hostile node can simply lie
  // about isOpen for the requested group" trust problem — that is inherent
  // until Phase 2 client-side group encryption lands (docs/CHAT_2_0_PLAN.md)
  // — it only ensures the metadata we trusted was for the requested group.
  const rawGroupId = metadata.groupId;
  const responseGroupId = typeof rawGroupId === 'number' ? rawGroupId : Number(rawGroupId);
  if (!Number.isInteger(responseGroupId) || responseGroupId !== txGroupId) {
    throw new Error(
      'Home could not verify that this Qortal group is public, so the message was not sent.',
    );
  }

  return {
    groupLabel: groupName ? `${groupName} (${txGroupId})` : `Group ${txGroupId}`,
    groupName,
  };
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
