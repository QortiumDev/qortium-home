// Qortal "General Chat" (group 0) over the MESSAGE-wrapper protocol.
//
// Qortal Core stopped accepting group-0 CHAT transactions, so Qortal Hub and
// the Classic UI carry a signed group-0 CHAT inside a fee-less, amount-zero
// MESSAGE transaction that never confirms: it lives in every node's
// unconfirmed pool and readers decode it from there. The wrapper's sender and
// recipient are DERIVED from the inner CHAT signature (sha256 over a domain
// tag + signature, fed to ed25519 as a seed), so anyone can verify that the
// outer MESSAGE was produced for exactly that inner CHAT and nothing else.
//
// This module is the byte-level half of SEND_QORTAL_GENERAL_CHAT: pure
// functions with no I/O, shared by the desktop bridge
// (electron/home-v2-app-bridge.ts) and the Android shell (src/platform.ts) so
// the two transports cannot drift. It is a port of qortium-chat's
// src/qortalGeneralChat.ts (0BSD) — the app used to do this itself through
// Hub's SIGN_TRANSACTION, which Home deliberately does not expose; Home builds,
// proves and signs the wrapper host-side instead so the account key never
// leaves this process and the app only ever hands over its opaque payload.
import { Sha256 } from 'asmcrypto.js';
import nacl from 'tweetnacl';

import { base58Decode, base58Encode } from './base58.js';

export const QORTAL_GENERAL_CHAT_GROUP_ID = 0;
export const QORTAL_GENERAL_CHAT_TRANSACTION_TYPE = 18;
export const QORTAL_GENERAL_MESSAGE_TRANSACTION_TYPE = 17;
// Both CHAT and MESSAGE carry the nonce at the same offset (after the
// type/timestamp/groupId/reference/publicKey header).
export const QORTAL_GENERAL_CHAT_NONCE_OFFSET = 112;
export const QORTAL_GENERAL_CHAT_REFERENCE_FEATURE_TRIGGER_TIMESTAMP = 1674316800000;
export const QORTAL_GENERAL_CHAT_MAX_DATA_BYTES = 4000;
// Core's fee-less MESSAGE difficulty (MessageTransaction.POW_DIFFICULTY_NO_FEE).
export const QORTAL_GENERAL_MESSAGE_POW_DIFFICULTY = 12;
// Qortal mainnet address version.
export const QORTAL_WRAPPER_ADDRESS_VERSION = 58;
// Bound on the unconfirmed MESSAGE feed a reader pulls to find wrappers.
// Same cap as an app-side FETCH_NODE_API read (QDN_APP_MAX_BYTES_LIMIT).
export const QORTAL_GENERAL_CHAT_FEED_MAX_BYTES = 5 * 1024 * 1024;
export const QORTAL_GENERAL_CHAT_FEED_PATH = '/transactions/unconfirmed?txType=MESSAGE&limit=0&reverse=true';

const WRAPPER_SENDER_TAG = new TextEncoder().encode('qchat-wrap-sender');
const WRAPPER_RECIPIENT_TAG = new TextEncoder().encode('qchat-wrap-recipient');

export type QortalGeneralWrappedTransaction = {
  amount?: number | string;
  creatorPublicKey?: string;
  data?: string;
  fee?: number | string;
  isEncrypted?: boolean;
  isText?: boolean;
  recipient?: string | null;
  recipientAddress?: string | null;
  senderPublicKey?: string;
  timestamp?: number;
  txGroupId?: number;
  txGroupID?: number;
};

export type ParsedQortalGeneralChat = {
  chatReference: string | null;
  data: Uint8Array;
  publicKey: Uint8Array;
  signature: Uint8Array;
  signingBytes: Uint8Array;
  timestamp: number;
};

/** A verified General Chat message as read back from the wrapper feed. */
export type QortalGeneralChatMessage = {
  chatReference: string | null;
  /** UTF-8 payload of the inner CHAT (the app's opaque envelope). */
  data: Uint8Array;
  sender: string;
  senderPublicKey: string;
  signature: string;
  timestamp: number;
};

function concatBytes(...chunks: Uint8Array[]) {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
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
  new DataView(bytes.buffer).setInt32(0, value);
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

function getFixedBase58Bytes(value: string, label: string, expectedLength: number) {
  const bytes = base58Decode(value);

  if (bytes.length !== expectedLength) {
    throw new Error(`${label} must decode to ${expectedLength} bytes.`);
  }

  return bytes;
}

function sha256(data: Uint8Array) {
  const result = new Sha256().process(new Uint8Array(data)).finish().result;

  if (!result) {
    throw new Error('SHA-256 failed.');
  }

  return new Uint8Array(result);
}

function rotateLeft32(value: number, bits: number) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function ripemd160Round(index: number, x: number, y: number, z: number) {
  if (index < 16) return (x ^ y ^ z) >>> 0;
  if (index < 32) return ((x & y) | (~x & z)) >>> 0;
  if (index < 48) return ((x | ~y) ^ z) >>> 0;
  if (index < 64) return ((x & z) | (y & ~z)) >>> 0;
  return (x ^ (y | ~z)) >>> 0;
}

function ripemd160LeftConstant(index: number) {
  if (index < 16) return 0x00000000;
  if (index < 32) return 0x5a827999;
  if (index < 48) return 0x6ed9eba1;
  if (index < 64) return 0x8f1bbcdc;
  return 0xa953fd4e;
}

function ripemd160RightConstant(index: number) {
  if (index < 16) return 0x50a28be6;
  if (index < 32) return 0x5c4dd124;
  if (index < 48) return 0x6d703ef3;
  if (index < 64) return 0x7a6d76e9;
  return 0x00000000;
}

// Portable RIPEMD-160 (same implementation as src/platform.ts and
// qortium-chat): this module runs in the Android WebView too, where
// node:crypto is not available.
function ripemd160(data: Uint8Array) {
  const leftOrder = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
    3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
    1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
    4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
  ];
  const rightOrder = [
    5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
    6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
    15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
    8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
    12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11,
  ];
  const leftShifts = [
    11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
    7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
    11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
    11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
    9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
  ];
  const rightShifts = [
    8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
    9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
    9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
    15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
    8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11,
  ];
  let paddedLength = data.length + 1;

  while (paddedLength % 64 !== 56) paddedLength += 1;

  const padded = new Uint8Array(paddedLength + 8);
  const bitLength = BigInt(data.length) * 8n;
  padded.set(data);
  padded[data.length] = 0x80;

  for (let index = 0; index < 8; index += 1) {
    padded[paddedLength + index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  }

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = Array.from({ length: 16 }, (_value, index) => {
      const wordOffset = offset + index * 4;
      return (
        padded[wordOffset] |
        (padded[wordOffset + 1] << 8) |
        (padded[wordOffset + 2] << 16) |
        (padded[wordOffset + 3] << 24)
      ) >>> 0;
    });
    let leftA = h0;
    let leftB = h1;
    let leftC = h2;
    let leftD = h3;
    let leftE = h4;
    let rightA = h0;
    let rightB = h1;
    let rightC = h2;
    let rightD = h3;
    let rightE = h4;

    for (let index = 0; index < 80; index += 1) {
      const leftTemp = (
        rotateLeft32(
          (leftA + ripemd160Round(index, leftB, leftC, leftD) + words[leftOrder[index]] + ripemd160LeftConstant(index)) >>> 0,
          leftShifts[index],
        ) + leftE
      ) >>> 0;
      const rightTemp = (
        rotateLeft32(
          (rightA + ripemd160Round(79 - index, rightB, rightC, rightD) + words[rightOrder[index]] + ripemd160RightConstant(index)) >>> 0,
          rightShifts[index],
        ) + rightE
      ) >>> 0;

      leftA = leftE;
      leftE = leftD;
      leftD = rotateLeft32(leftC, 10);
      leftC = leftB;
      leftB = leftTemp;
      rightA = rightE;
      rightE = rightD;
      rightD = rotateLeft32(rightC, 10);
      rightC = rightB;
      rightB = rightTemp;
    }

    const nextH0 = (h1 + leftC + rightD) >>> 0;
    h1 = (h2 + leftD + rightE) >>> 0;
    h2 = (h3 + leftE + rightA) >>> 0;
    h3 = (h4 + leftA + rightB) >>> 0;
    h4 = (h0 + leftB + rightC) >>> 0;
    h0 = nextH0;
  }

  const result = new Uint8Array(20);
  const words = [h0, h1, h2, h3, h4];

  for (let index = 0; index < words.length; index += 1) {
    result[index * 4] = words[index] & 0xff;
    result[index * 4 + 1] = (words[index] >>> 8) & 0xff;
    result[index * 4 + 2] = (words[index] >>> 16) & 0xff;
    result[index * 4 + 3] = (words[index] >>> 24) & 0xff;
  }

  return result;
}

/** Qortal (version 58) address for an ed25519 public key. */
export function qortalPublicKeyToAddress(publicKey: Uint8Array) {
  if (publicKey.length !== 32) throw new Error('Qortal public key must be 32 bytes.');
  const publicKeyHash = ripemd160(sha256(publicKey));
  const versionedHash = concatBytes(new Uint8Array([QORTAL_WRAPPER_ADDRESS_VERSION]), publicKeyHash);
  const checksum = sha256(sha256(versionedHash)).slice(0, 4);
  return base58Encode(concatBytes(versionedHash, checksum));
}

/**
 * The wrapper keypair and recipient for one inner CHAT signature. Deterministic
 * on purpose: readers re-derive both and refuse a MESSAGE whose sender or
 * recipient does not match, so a wrapper can only ever carry the CHAT it was
 * derived from.
 */
export function deriveQortalGeneralWrapperKeys(chatSignature: Uint8Array) {
  if (chatSignature.length !== 64) throw new Error('CHAT signature must be 64 bytes.');
  const senderSeed = sha256(concatBytes(WRAPPER_SENDER_TAG, chatSignature));
  const recipientSeed = sha256(concatBytes(WRAPPER_RECIPIENT_TAG, chatSignature));
  const senderKeyPair = nacl.sign.keyPair.fromSeed(senderSeed);
  const recipientKeyPair = nacl.sign.keyPair.fromSeed(recipientSeed);

  return {
    recipientAddress: qortalPublicKeyToAddress(recipientKeyPair.publicKey),
    senderKeyPair,
  };
}

export function stampQortalGeneralChatNonce(unsignedBytes: Uint8Array, nonce: number) {
  if (!Number.isInteger(nonce) || nonce < 0 || nonce > 0xffffffff) {
    throw new Error('Transaction nonce must be a uint32.');
  }
  const stamped = new Uint8Array(unsignedBytes);
  stamped.set(int32ToBytes(nonce | 0), QORTAL_GENERAL_CHAT_NONCE_OFFSET);
  return stamped;
}

/** Unsigned group-0 CHAT bytes, nonce slot zeroed. */
export function buildUnsignedQortalGeneralChatBytes(input: {
  chatReference?: string | null;
  lastReference: Uint8Array;
  message: string;
  senderPublicKey: string;
  timestamp: number;
}) {
  const messageBytes = new TextEncoder().encode(input.message);
  const publicKey = getFixedBase58Bytes(input.senderPublicKey, 'Qortal public key', 32);
  const chatReference = input.chatReference
    ? getFixedBase58Bytes(input.chatReference, 'Chat reference', 64)
    : null;

  if (input.lastReference.length !== 64) throw new Error('Last reference must be 64 bytes.');
  if (messageBytes.length < 1 || messageBytes.length > QORTAL_GENERAL_CHAT_MAX_DATA_BYTES) {
    throw new Error(`General Chat message must be between 1 and ${QORTAL_GENERAL_CHAT_MAX_DATA_BYTES} bytes.`);
  }

  const base = concatBytes(
    int32ToBytes(QORTAL_GENERAL_CHAT_TRANSACTION_TYPE),
    int64ToBytes(BigInt(input.timestamp), 'Timestamp'),
    int32ToBytes(QORTAL_GENERAL_CHAT_GROUP_ID),
    input.lastReference,
    publicKey,
    int32ToBytes(0),
    new Uint8Array([0]),
    int32ToBytes(messageBytes.length),
    messageBytes,
    new Uint8Array([0]),
    new Uint8Array([1]),
    int64ToBytes(0n, 'Fee'),
  );
  const unsigned = input.timestamp < QORTAL_GENERAL_CHAT_REFERENCE_FEATURE_TRIGGER_TIMESTAMP
    ? base
    : concatBytes(base, new Uint8Array([chatReference ? 1 : 0]), ...(chatReference ? [chatReference] : []));

  // The signed CHAT (unsigned + 64-byte signature) must fit the MESSAGE data
  // field; refuse here, before any proof-of-work is spent.
  if (unsigned.length + 64 > QORTAL_GENERAL_CHAT_MAX_DATA_BYTES) {
    throw new Error('Message is too large for Qortal General Chat.');
  }

  return unsigned;
}

/** Unsigned fee-less, amount-zero MESSAGE bytes carrying a signed CHAT. */
export function buildUnsignedQortalGeneralWrapperBytes(input: {
  data: Uint8Array;
  lastReference: Uint8Array;
  recipient: string;
  senderPublicKey: Uint8Array;
  timestamp: number;
}) {
  const recipient = getFixedBase58Bytes(input.recipient, 'Wrapper recipient', 25);

  if (input.data.length < 1 || input.data.length > QORTAL_GENERAL_CHAT_MAX_DATA_BYTES) {
    throw new Error('Wrapped General Chat data must be between 1 and 4000 bytes.');
  }
  if (input.lastReference.length !== 64) throw new Error('Last reference must be 64 bytes.');
  if (input.senderPublicKey.length !== 32) throw new Error('Wrapper public key must be 32 bytes.');

  return concatBytes(
    int32ToBytes(QORTAL_GENERAL_MESSAGE_TRANSACTION_TYPE),
    int64ToBytes(BigInt(input.timestamp), 'Timestamp'),
    int32ToBytes(QORTAL_GENERAL_CHAT_GROUP_ID),
    input.lastReference,
    input.senderPublicKey,
    int32ToBytes(0),
    new Uint8Array([1]),
    recipient,
    int64ToBytes(0n, 'Amount'),
    int32ToBytes(input.data.length),
    input.data,
    new Uint8Array([0]),
    new Uint8Array([0]),
    int64ToBytes(0n, 'Fee'),
  );
}

class ByteCursor {
  offset = 0;

  constructor(readonly bytes: Uint8Array) {}

  read(length: number) {
    if (!Number.isInteger(length) || length < 0 || this.offset + length > this.bytes.length) {
      throw new Error('Wrapped General Chat transaction is truncated.');
    }
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readByte() {
    return this.read(1)[0];
  }

  readInt32() {
    const bytes = this.read(4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getInt32(0);
  }

  readInt64() {
    const bytes = this.read(8);
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Transaction timestamp is too large.');
    return Number(value);
  }
}

/** Parses and signature-verifies a signed group-0 CHAT. */
export function parseSignedQortalGeneralChatBytes(bytes: Uint8Array): ParsedQortalGeneralChat {
  const cursor = new ByteCursor(bytes);

  if (cursor.readInt32() !== QORTAL_GENERAL_CHAT_TRANSACTION_TYPE) throw new Error('Wrapped data is not a CHAT transaction.');
  const timestamp = cursor.readInt64();
  if (cursor.readInt32() !== QORTAL_GENERAL_CHAT_GROUP_ID) throw new Error('Wrapped CHAT is not General Chat.');
  cursor.read(64);
  const publicKey = cursor.read(32);
  cursor.readInt32();
  if (cursor.readByte() !== 0) throw new Error('Wrapped General Chat must not have a recipient.');
  const dataLength = cursor.readInt32();
  if (dataLength < 1 || dataLength > QORTAL_GENERAL_CHAT_MAX_DATA_BYTES) throw new Error('Wrapped CHAT data length is invalid.');
  const data = cursor.read(dataLength);
  const isEncrypted = cursor.readByte() !== 0;
  const isText = cursor.readByte() !== 0;
  const fee = cursor.readInt64();
  let chatReference: string | null = null;

  if (timestamp >= QORTAL_GENERAL_CHAT_REFERENCE_FEATURE_TRIGGER_TIMESTAMP) {
    const hasChatReference = cursor.readByte();
    if (hasChatReference !== 0 && hasChatReference !== 1) throw new Error('Wrapped CHAT reference flag is invalid.');
    if (hasChatReference === 1) chatReference = base58Encode(cursor.read(64));
  }

  if (fee !== 0 || isEncrypted || !isText || bytes.length - cursor.offset !== 64) {
    throw new Error('Wrapped CHAT flags or signature length are invalid.');
  }

  const signingBytes = bytes.slice(0, cursor.offset);
  const signature = cursor.read(64);

  if (!nacl.sign.detached.verify(signingBytes, signature, publicKey)) {
    throw new Error('Wrapped CHAT signature is invalid.');
  }

  return { chatReference, data, publicKey, signature, signingBytes, timestamp };
}

/**
 * One unconfirmed MESSAGE row → a verified General Chat message, or null when
 * the row is not a well-formed wrapper (wrong shape, wrapper sender/recipient
 * not derived from the inner signature, inner signature invalid). Never
 * throws: the feed is untrusted node output.
 */
export function decodeQortalGeneralWrappedMessage(
  transaction: QortalGeneralWrappedTransaction,
): QortalGeneralChatMessage | null {
  try {
    const txGroupId = transaction.txGroupId ?? transaction.txGroupID;
    const wrapperPublicKey58 = transaction.senderPublicKey ?? transaction.creatorPublicKey;
    const recipient = transaction.recipient ?? transaction.recipientAddress;

    if (
      Number(txGroupId) !== QORTAL_GENERAL_CHAT_GROUP_ID ||
      typeof transaction.data !== 'string' ||
      !wrapperPublicKey58 ||
      !recipient ||
      Number(transaction.amount) !== 0 ||
      (transaction.fee !== undefined && Number(transaction.fee) !== 0) ||
      (transaction.isText !== undefined && transaction.isText !== false) ||
      (transaction.isEncrypted !== undefined && transaction.isEncrypted !== false)
    ) {
      return null;
    }

    const parsed = parseSignedQortalGeneralChatBytes(base58Decode(transaction.data));
    const { recipientAddress, senderKeyPair } = deriveQortalGeneralWrapperKeys(parsed.signature);

    if (base58Encode(senderKeyPair.publicKey) !== wrapperPublicKey58 || recipientAddress !== recipient) {
      return null;
    }

    return {
      chatReference: parsed.chatReference,
      data: parsed.data,
      sender: qortalPublicKeyToAddress(parsed.publicKey),
      senderPublicKey: base58Encode(parsed.publicKey),
      signature: base58Encode(parsed.signature),
      timestamp: parsed.timestamp,
    };
  } catch {
    return null;
  }
}

/**
 * Finds one General Chat message by inner CHAT signature in an unconfirmed
 * MESSAGE feed. Used to validate a chatReference target (edit / delete /
 * reaction) the way validateHomeV2PublicChatTarget does for confirmed CHATs.
 */
export function findQortalGeneralChatMessage(feed: unknown, signature: string): QortalGeneralChatMessage | null {
  if (!Array.isArray(feed)) return null;
  for (const row of feed) {
    if (!row || typeof row !== 'object') continue;
    const decoded = decodeQortalGeneralWrappedMessage(row as QortalGeneralWrappedTransaction);
    if (decoded && decoded.signature === signature) return decoded;
  }
  return null;
}
