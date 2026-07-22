const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_ALPHABET_MAP = new Map<string, number>(
  [...BASE58_ALPHABET].map((character, index) => [character, index]),
);

export const GROUP_AVATAR_MAX_BYTES = 500 * 1024;

function getSafeInteger(value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;

  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }

  return undefined;
}

function getBase58ByteLength(value: string) {
  if (!value) return 0;

  const bytes = [0];

  for (const character of value) {
    const mappedValue = BASE58_ALPHABET_MAP.get(character);

    if (mappedValue === undefined) {
      throw new Error('Avatar signature must be a base58-encoded transaction signature.');
    }

    let carry = mappedValue;
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = bytes[index] * 58 + carry;
      carry = bytes[index] >> 8;
      bytes[index] &= 0xff;
    }

    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingZeroes = 0;
  while (leadingZeroes < value.length - 1 && value[leadingZeroes] === '1') {
    leadingZeroes += 1;
  }

  return bytes.length + leadingZeroes;
}

export function getGroupAvatarGroupId(value: unknown) {
  const groupId = getSafeInteger(value);

  if (typeof groupId !== 'number' || groupId < 1) {
    throw new Error('Group id must be a positive integer.');
  }

  return groupId;
}

export function getOptionalGroupAvatarSignature(value: unknown): string | null {
  if (value === null || typeof value === 'undefined') return null;

  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Avatar signature must be null or a base58-encoded transaction signature.');
  }

  const signature = value.trim();
  if (getBase58ByteLength(signature) !== 64) {
    throw new Error('Avatar signature must be a base58-encoded 64-byte transaction signature.');
  }

  return signature;
}

export function buildGroupAvatarPath(groupId: number) {
  return `/groups/${encodeURIComponent(String(groupId))}/avatar`;
}

export function getGroupAvatarMaxBytes(value: unknown) {
  const requested = typeof value === 'number' && Number.isFinite(value)
    ? Math.floor(value)
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : GROUP_AVATAR_MAX_BYTES;

  return Math.max(1, Math.min(requested, GROUP_AVATAR_MAX_BYTES));
}

export function buildSetGroupAvatarTransactionBody(input: {
  avatarSignature: string | null;
  fee: number;
  groupId: number;
  ownerPublicKey: string;
  timestamp: number;
  txGroupId: number;
}) {
  return {
    type: 'SET_GROUP_AVATAR' as const,
    timestamp: input.timestamp,
    txGroupId: input.txGroupId,
    fee: input.fee,
    ownerPublicKey: input.ownerPublicKey,
    groupId: input.groupId,
    avatarSignature: input.avatarSignature,
  };
}
