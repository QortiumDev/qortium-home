export const GROUP_AVATAR_MAX_BYTES = 500 * 1024;

export type AvatarSource = 'POINTER' | 'LEGACY';
export type AvatarDescriptor = {
  identifier: string;
  name: string;
  service: string;
};

export type GroupAvatarPendingResult = {
  descriptor: AvatarDescriptor | null;
  groupId: number;
  retryAfterSeconds: number | null;
  source: AvatarSource;
  status: 'PENDING';
};

export type GroupAvatarFetchResult = GroupAvatarPendingResult | {
  body: string;
  contentLength: number;
  contentType: string;
  descriptor: AvatarDescriptor | null;
  encoding: 'base64';
  groupId: number;
  source: AvatarSource;
};

export type AccountAvatarPendingResult = Omit<GroupAvatarPendingResult, 'groupId'> & { address: string };
export type AccountAvatarFetchResult = AccountAvatarPendingResult | {
  address: string;
  body: string;
  contentLength: number;
  contentType: string;
  descriptor: AvatarDescriptor | null;
  encoding: 'base64';
  source: AvatarSource;
};

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function getSafeInteger(value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;

  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }

  return undefined;
}

export function getGroupAvatarGroupId(value: unknown) {
  const groupId = getSafeInteger(value);

  if (typeof groupId !== 'number' || groupId < 1) {
    throw new Error('Group id must be a positive integer.');
  }

  return groupId;
}

export function getOptionalAvatarPointer(value: unknown): AvatarDescriptor | null {
  if (value === null || typeof value === 'undefined') return null;

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Avatar must be null or an object containing service, name, and optional identifier.');
  }

  const pointer = value as Record<string, unknown>;
  if (
    typeof pointer.service !== 'string'
    || typeof pointer.name !== 'string'
    || (
      typeof pointer.identifier !== 'undefined'
      && pointer.identifier !== null
      && typeof pointer.identifier !== 'string'
    )
  ) {
    throw new Error('Avatar must be null or an object containing service, name, and optional identifier.');
  }

  const descriptor = getAvatarDescriptor({
    service: pointer.service,
    name: pointer.name,
    identifier: pointer.identifier as string | null | undefined,
  });
  if (!descriptor) {
    throw new Error('Avatar service and name must be non-empty strings.');
  }

  return descriptor;
}

export function buildGroupAvatarPath(groupId: number) {
  return `/groups/${encodeURIComponent(String(groupId))}/avatar`;
}

export function buildAccountAvatarPath(address: string) {
  return `/addresses/${encodeURIComponent(address)}/avatar`;
}

export function buildAvatarInfoPath(target: 'account' | 'group', value: string | number) {
  const prefix = target === 'account' ? '/addresses' : '/groups';
  return `${prefix}/${encodeURIComponent(String(value))}/avatar/info`;
}

export function buildAccountAvatarPublishResource(name: string) {
  return { service: 'THUMBNAIL', name, identifier: 'avatar' };
}

export function buildGroupAvatarPublishResource(ownerName: string, groupId: number) {
  return { service: 'THUMBNAIL', name: ownerName, identifier: `qortium-group-avatar-v1-${groupId}` };
}

export function buildLegacyAccountAvatarResource(name: string, kind: 'qortium' | 'qortal-hub') {
  return { service: 'THUMBNAIL', name, identifier: kind === 'qortium' ? 'avatar' : 'qortal_avatar' };
}

export function buildLegacyGroupAvatarResource(ownerName: string, groupId: number) {
  return { service: 'THUMBNAIL', name: ownerName, identifier: `qortal_group_avatar_${groupId}` };
}

export function buildAvatarResourcePath(resource: { service: string; name: string; identifier: string | null }) {
  return `/arbitrary/${encodeURIComponent(resource.service)}/${encodeURIComponent(resource.name)}${
    resource.identifier ? `/${encodeURIComponent(resource.identifier)}` : ''
  }?async=true`;
}

export function getGroupAvatarMaxBytes(value: unknown) {
  const requested = typeof value === 'number' && Number.isFinite(value)
    ? Math.floor(value)
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : GROUP_AVATAR_MAX_BYTES;

  return Math.max(1, Math.min(requested, GROUP_AVATAR_MAX_BYTES));
}

// Mirrors the hardened magic-byte approach used by Home's avatar/resource
// rendering. A Core response may conservatively say application/octet-stream,
// but apps need the actual image MIME to build a Blob safely.
export function getGroupAvatarContentType(contentType: string | undefined, bytes: Uint8Array) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith(bytes, [0x42, 0x4d])) return 'image/bmp';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }

  return contentType?.trim() || 'application/octet-stream';
}

export function getAvatarImageContentType(contentType: string | undefined, bytes: Uint8Array) {
  // Avatar bytes must prove their image type. Never accept a server-declared
  // image/* type alone: legacy resources are mutable and a mislabeled PDF/HTML
  // must not become an inline avatar.
  const resolved = getGroupAvatarContentType(undefined, bytes);
  return resolved.toLowerCase().startsWith('image/') ? resolved : null;
}

export function getGroupAvatarRetryAfterSeconds(value: string | undefined, now = Date.now()) {
  if (!value) return null;

  if (/^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }

  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return null;

  return Math.max(0, Math.ceil((retryAt - now) / 1000));
}

export function getAvatarDescriptor(values: {
  identifier?: string | null;
  name?: string | null;
  service?: string | null;
}): AvatarDescriptor | null {
  const service = values.service?.trim();
  const name = values.name?.trim();
  if (!service || !name) return null;

  // Identifier is part of the exact QDN resource key. Empty selects the
  // default resource, while whitespace can identify a different resource.
  const identifier = values.identifier ?? '';

  return { service, name, identifier };
}

export function getAvatarDescriptorFromHeaders(getHeader: (name: string) => string | undefined) {
  return getAvatarDescriptor({
    service: getHeader('x-qortium-avatar-service'),
    name: getHeader('x-qortium-avatar-name'),
    identifier: getHeader('x-qortium-avatar-identifier'),
  });
}

export function buildGroupAvatarPendingResult(
  groupId: number,
  retryAfter: string | undefined,
  source: AvatarSource = 'POINTER',
  descriptor: AvatarDescriptor | null = null,
): GroupAvatarPendingResult {
  return {
    groupId,
    status: 'PENDING',
    retryAfterSeconds: getGroupAvatarRetryAfterSeconds(retryAfter),
    source,
    descriptor,
  };
}

export function buildAccountAvatarPendingResult(
  address: string,
  retryAfter: string | undefined,
  source: AvatarSource = 'POINTER',
  descriptor: AvatarDescriptor | null = null,
): AccountAvatarPendingResult {
  return { address, status: 'PENDING', retryAfterSeconds: getGroupAvatarRetryAfterSeconds(retryAfter), source, descriptor };
}

export function buildSetGroupAvatarTransactionBody(input: {
  avatar: AvatarDescriptor | null;
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
    avatar: input.avatar,
  };
}

export function buildSetAccountAvatarTransactionBody(input: {
  avatar: AvatarDescriptor | null;
  fee: number;
  ownerPublicKey: string;
  timestamp: number;
}) {
  return {
    type: 'SET_ACCOUNT_AVATAR' as const,
    timestamp: input.timestamp,
    txGroupId: 0,
    fee: input.fee,
    ownerPublicKey: input.ownerPublicKey,
    avatar: input.avatar,
  };
}
