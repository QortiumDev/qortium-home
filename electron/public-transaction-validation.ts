const TYPE_CREATE_POLL = 8;
const TYPE_VOTE_ON_POLL = 9;
const TYPE_ARBITRARY = 10;
const TYPE_CHAT = 18;
const TYPE_UPDATE_POLL = 47;

const PUBLIC_KEY_LENGTH = 32;
const ADDRESS_LENGTH = 25;
const SIGNATURE_LENGTH = 64;
const PAYMENT_LENGTH = ADDRESS_LENGTH + 8 + 8;

const QDN_SERVICE_IDS: Readonly<Record<string, number>> = Object.freeze({
  APP: 1000,
  ATTACHMENT: 130,
  AUDIO: 600,
  BLOG: 700,
  BLOG_COMMENT: 778,
  BLOG_POST: 777,
  CHAIN_COMMENT: 1810,
  CHAIN_DATA: 160,
  CODE: 1400,
  COMMENT: 1800,
  COUPON: 1340,
  DATABASE: 1700,
  DOCUMENT: 800,
  EXTENSION: 1420,
  FILE: 140,
  FILES: 150,
  GAME: 1500,
  GIF_REPOSITORY: 1200,
  GIT_REPOSITORY: 300,
  IMAGE: 400,
  IMAGE_GALLERY: 430,
  ITEM: 1510,
  JSON: 1110,
  LIST: 900,
  MAIL: 1900,
  MESSAGE: 1910,
  METADATA: 1100,
  NFT: 1600,
  OFFER: 1330,
  PLAYLIST: 910,
  PLUGIN: 1410,
  PODCAST: 640,
  PRODUCT: 1310,
  QCHAT_IMAGE: 420,
  SNAPSHOT: 1710,
  STORE: 1300,
  THUMBNAIL: 410,
  VIDEO: 500,
  VOICE: 630,
  WEBSITE: 200,
});

export function getStaticQdnServiceId(service: string) {
  const value = QDN_SERVICE_IDS[service];
  if (!Number.isInteger(value)) throw new Error(`Unknown public QDN service ${service}.`);
  return value;
}

class Reader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array, private readonly label: string) {}

  get remaining() {
    return this.bytes.length - this.offset;
  }

  readBytes(length: number, field: string) {
    if (!Number.isInteger(length) || length < 0 || this.offset + length > this.bytes.length) {
      throw new Error(`Public ${this.label} builder returned malformed bytes (${field}).`);
    }
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readByte(field: string) {
    return this.readBytes(1, field)[0];
  }

  readInt32(field: string) {
    const bytes = this.readBytes(4, field);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(0, false);
  }

  readUint32(field: string) {
    const bytes = this.readBytes(4, field);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
  }

  readInt64(field: string) {
    const bytes = this.readBytes(8, field);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigInt64(0, false);
  }

  readSafeInt64(field: string) {
    const value = this.readInt64(field);
    if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Public ${this.label} builder returned an unsafe ${field}.`);
    }
    return Number(value);
  }

  readString(field: string, maxBytes: number) {
    const length = this.readInt32(`${field} length`);
    if (length < 0 || length > maxBytes) {
      throw new Error(`Public ${this.label} builder returned an invalid ${field} length.`);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(this.readBytes(length, field));
    } catch {
      throw new Error(`Public ${this.label} builder returned invalid UTF-8 in ${field}.`);
    }
  }

  finish() {
    if (this.remaining !== 0) {
      throw new Error(`Public ${this.label} builder returned unexpected trailing bytes.`);
    }
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertEqual(actual: unknown, expected: unknown, label: string, transaction: string) {
  if (actual !== expected) {
    throw new Error(`Public ${transaction} builder changed the approved ${label}.`);
  }
}

function assertBytes(actual: Uint8Array, expected: Uint8Array, label: string, transaction: string) {
  if (!equalBytes(actual, expected)) {
    throw new Error(`Public ${transaction} builder changed the approved ${label}.`);
  }
}

type CommonExpected = {
  publicKey: Uint8Array;
  timestamp: number;
  txGroupId: number;
};

function readCommon(reader: Reader, expectedType: number, expected: CommonExpected, label: string) {
  assertEqual(reader.readInt32('transaction type'), expectedType, 'transaction type', label);
  assertEqual(reader.readSafeInt64('timestamp'), expected.timestamp, 'timestamp', label);
  assertEqual(reader.readInt32('transaction group ID'), expected.txGroupId, 'transaction group ID', label);
  assertBytes(reader.readBytes(PUBLIC_KEY_LENGTH, 'creator public key'), expected.publicKey, 'account public key', label);
  assertEqual(reader.readUint32('nonce'), 0, 'nonce', label);
}

function readPollTimes(reader: Reader, label: string) {
  const timeBytes = reader.remaining - 8;
  if (timeBytes < 0) throw new Error(`Public ${label} builder omitted the fee.`);
  if (timeBytes === 0) return { startTime: undefined, endTime: undefined };
  if (timeBytes === 8) return { startTime: undefined, endTime: reader.readSafeInt64('end time') };

  const flags = reader.readByte('time flags');
  if (flags !== 1 && flags !== 3) {
    throw new Error(`Public ${label} builder returned invalid poll time flags.`);
  }
  const expectedBytes = 1 + 8 + (flags === 3 ? 8 : 0);
  if (timeBytes !== expectedBytes) {
    throw new Error(`Public ${label} builder returned malformed poll times.`);
  }
  return {
    startTime: reader.readSafeInt64('start time'),
    endTime: flags === 3 ? reader.readSafeInt64('end time') : undefined,
  };
}

export type CreatePollExpected = CommonExpected & {
  description: string;
  endTime?: number;
  owner: Uint8Array;
  pollName: string;
  pollOptions: string[];
  startTime?: number;
};

export function assertPublicCreatePollTransaction(bytes: Uint8Array, expected: CreatePollExpected) {
  const label = 'CREATE_POLL';
  const reader = new Reader(bytes, label);
  readCommon(reader, TYPE_CREATE_POLL, expected, label);
  assertBytes(reader.readBytes(ADDRESS_LENGTH, 'owner'), expected.owner, 'owner', label);
  assertEqual(reader.readString('poll name', 400), expected.pollName, 'poll name', label);
  assertEqual(reader.readString('description', 4000), expected.description, 'description', label);
  const count = reader.readInt32('option count');
  assertEqual(count, expected.pollOptions.length, 'poll options', label);
  for (let index = 0; index < count; index += 1) {
    assertEqual(reader.readString(`option ${index + 1}`, 400), expected.pollOptions[index], 'poll options', label);
  }
  const times = readPollTimes(reader, label);
  assertEqual(times.startTime, expected.startTime, 'start time', label);
  assertEqual(times.endTime, expected.endTime, 'end time', label);
  assertEqual(reader.readInt64('fee'), 0n, 'fee', label);
  reader.finish();
}

export type VoteOnPollExpected = CommonExpected & { optionIndexes: number[]; pollId: number };

export function assertPublicVoteOnPollTransaction(bytes: Uint8Array, expected: VoteOnPollExpected) {
  const label = 'VOTE_ON_POLL';
  const reader = new Reader(bytes, label);
  readCommon(reader, TYPE_VOTE_ON_POLL, expected, label);
  assertEqual(reader.readInt32('poll ID'), expected.pollId, 'poll ID', label);
  const optionBytes = reader.remaining - 8;
  if (optionBytes < 4 || optionBytes % 4 !== 0) {
    throw new Error('Public VOTE_ON_POLL builder returned malformed option indexes.');
  }
  const first = reader.readInt32('option index or count');
  if (optionBytes > 4 && (first < 2 || first > 1000 || optionBytes !== 4 + first * 4)) {
    throw new Error('Public VOTE_ON_POLL builder returned a mismatched option count.');
  }
  const actual = optionBytes === 4
    ? first === 0 ? [] : [first]
    : Array.from({ length: first }, (_, index) => reader.readInt32(`option ${index + 1}`));
  assertEqual(JSON.stringify(actual), JSON.stringify(expected.optionIndexes), 'option indexes', label);
  assertEqual(reader.readInt64('fee'), 0n, 'fee', label);
  reader.finish();
}

export type UpdatePollExpected = CommonExpected & {
  endTime?: number;
  newDescription: string;
  newPollName: string;
  newPollOptions: string[];
  startTime?: number;
  pollId: number;
};

export function assertPublicUpdatePollTransaction(bytes: Uint8Array, expected: UpdatePollExpected) {
  const label = 'UPDATE_POLL';
  const reader = new Reader(bytes, label);
  readCommon(reader, TYPE_UPDATE_POLL, expected, label);
  assertEqual(reader.readInt32('poll ID'), expected.pollId, 'poll ID', label);
  assertEqual(reader.readString('poll name', 400), expected.newPollName, 'poll name', label);
  assertEqual(reader.readString('description', 4000), expected.newDescription, 'description', label);
  const count = reader.readInt32('option count');
  assertEqual(count, expected.newPollOptions.length, 'poll options', label);
  for (let index = 0; index < count; index += 1) {
    assertEqual(reader.readString(`option ${index + 1}`, 400), expected.newPollOptions[index], 'poll options', label);
  }
  const times = readPollTimes(reader, label);
  assertEqual(times.startTime, expected.startTime, 'start time', label);
  assertEqual(times.endTime, expected.endTime, 'end time', label);
  assertEqual(reader.readInt64('fee'), 0n, 'fee', label);
  reader.finish();
}

export type ChatExpected = CommonExpected & { chatReference?: Uint8Array; data: Uint8Array };

export function assertPublicChatTransaction(bytes: Uint8Array, expected: ChatExpected) {
  const label = 'CHAT';
  const reader = new Reader(bytes, label);
  readCommon(reader, TYPE_CHAT, expected, label);
  assertEqual(reader.readByte('has recipient'), 0, 'recipient', label);
  const dataLength = reader.readInt32('message length');
  assertBytes(reader.readBytes(dataLength, 'message'), expected.data, 'message', label);
  assertEqual(reader.readByte('encrypted flag'), 0, 'encrypted flag', label);
  assertEqual(reader.readByte('text flag'), 1, 'text flag', label);
  assertEqual(reader.readInt64('fee'), 0n, 'fee', label);
  const hasReference = reader.readByte('has chat reference');
  assertEqual(hasReference, expected.chatReference ? 1 : 0, 'chat reference', label);
  if (hasReference) {
    assertBytes(reader.readBytes(SIGNATURE_LENGTH, 'chat reference'), expected.chatReference!, 'chat reference', label);
  }
  reader.finish();
}

export type ArbitraryExpected = {
  identifier?: string;
  method: 0 | 2;
  name: string;
  publicKey: Uint8Array;
  service: number;
  txGroupId: number;
};

export function assertPublicArbitraryTransaction(bytes: Uint8Array, expected: ArbitraryExpected) {
  const label = 'ARBITRARY';
  const reader = new Reader(bytes, label);
  assertEqual(reader.readInt32('transaction type'), TYPE_ARBITRARY, 'transaction type', label);
  reader.readSafeInt64('timestamp');
  assertEqual(reader.readInt32('transaction group ID'), expected.txGroupId, 'transaction group ID', label);
  assertBytes(reader.readBytes(PUBLIC_KEY_LENGTH, 'creator public key'), expected.publicKey, 'account public key', label);
  assertEqual(reader.readUint32('nonce'), 0, 'nonce', label);
  assertEqual(reader.readString('name', 40), expected.name, 'name', label);
  assertEqual(reader.readString('identifier', 64), expected.identifier ?? '', 'identifier', label);
  assertEqual(reader.readInt32('method'), expected.method, 'method', label);
  const secretLength = reader.readInt32('secret length');
  if (secretLength < 0 || secretLength > 32) throw new Error('Public ARBITRARY builder returned an invalid secret.');
  reader.readBytes(secretLength, 'secret');
  const compression = reader.readInt32('compression');
  if (compression !== 0 && compression !== 1) throw new Error('Public ARBITRARY builder returned invalid compression.');
  const paymentCount = reader.readInt32('payment count');
  assertEqual(paymentCount, 0, 'payments', label);
  reader.readBytes(paymentCount * PAYMENT_LENGTH, 'payments');
  assertEqual(reader.readInt32('service'), expected.service, 'service', label);
  const dataType = reader.readByte('data type');
  if (dataType !== 0 && dataType !== 1) throw new Error('Public ARBITRARY builder returned an invalid data type.');
  const dataLength = reader.readInt32('data length');
  if (dataLength < 0 || dataLength > 256) throw new Error('Public ARBITRARY builder returned invalid transaction data.');
  reader.readBytes(dataLength, 'data');
  const rawSize = reader.readInt32('raw data size');
  if (rawSize < 0) throw new Error('Public ARBITRARY builder returned an invalid raw data size.');
  const metadataLength = reader.readInt32('metadata hash length');
  if (metadataLength < 0 || metadataLength > 32) throw new Error('Public ARBITRARY builder returned invalid metadata.');
  reader.readBytes(metadataLength, 'metadata hash');
  assertEqual(reader.readInt64('fee'), 0n, 'fee', label);
  reader.finish();

  if (expected.method === 2 && (secretLength !== 0 || compression !== 0 || dataType !== 1 || dataLength !== 0 || rawSize !== 0 || metadataLength !== 0)) {
    throw new Error('Public ARBITRARY delete builder returned a non-tombstone transaction.');
  }
}
