// Request parsing and coercion shared by both QDN bridges.
//
// The desktop bridge (electron/qdn.ts) and the renderer/Android bridge
// (src/platform.ts) answer the same QDN app actions over different transports,
// so they read the same request shapes: the same key fallbacks, the same
// numeric and boolean coercions, the same validation messages. Those helpers
// were copied into both files and then drifted apart three separate times.
// They live here now so a fix to how a request field is read reaches both
// transports at once.
//
// Only stateless helpers belong here. Anything that closes over per-transport
// state (staged publish sources, node connections, windows) stays in the bridge
// that owns it.

type QdnAppRequest = {
  action?: unknown;
  maxBytes?: unknown;
  method?: unknown;
  path?: unknown;
  payload?: unknown;
  [key: string]: unknown;
};

const NATIVE_ASSET_ID = 0;
const QDN_APP_DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const QDN_APP_MAX_BYTES_LIMIT = 5 * 1024 * 1024;

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getInteger(value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }

  const stringValue = getString(value);

  if (/^-?\d+$/.test(stringValue)) {
    const parsedValue = Number(stringValue);

    return Number.isSafeInteger(parsedValue) ? parsedValue : undefined;
  }

  return undefined;
}

function getBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getRequestPayload(request: QdnAppRequest) {
  return isRecord(request.payload) ? request.payload : request;
}

function getRequestValue(request: QdnAppRequest, key: string) {
  const payload = getRequestPayload(request);

  return payload[key] ?? request[key];
}

function hasRequestValue(request: QdnAppRequest, key: string) {
  const value = getRequestValue(request, key);

  return typeof value !== 'undefined' && value !== null;
}

function getRequiredRequestString(request: QdnAppRequest, key: string, label: string) {
  const value = getString(getRequestValue(request, key));

  if (!value) {
    throw new Error(`${label} is required.`);
  }

  return value;
}

function getRequiredGroupId(request: QdnAppRequest, minimumValue = 0) {
  const groupId = getInteger(getRequestValue(request, 'groupId') ?? getRequestValue(request, 'txGroupId'));

  if (typeof groupId !== 'number' || groupId < minimumValue) {
    throw new Error(
      minimumValue > 0
        ? 'Group id must be a positive integer.'
        : 'Group id must be a non-negative integer.',
    );
  }

  return groupId;
}

function getOptionalBase58RequestString(request: QdnAppRequest, key: string) {
  const value = getString(getRequestValue(request, key));

  return value || undefined;
}

function isNativeAssetAlias(value: unknown) {
  const normalized = getString(value).toUpperCase().replace(/[\s-]+/g, '_');

  return normalized === 'NATIVE' || normalized === 'NATIVE_ASSET' || normalized === 'ASSET_0' || normalized === 'ASSET0';
}

function getRequestAssetId(request: QdnAppRequest) {
  const value = getRequestValue(request, 'assetId');

  return typeof value === 'undefined' || value === null || getString(value) === '' ? undefined : getInteger(value);
}

function isNativeAssetRequest(request: QdnAppRequest, defaultToNative = false) {
  const assetId = getRequestAssetId(request);

  if (typeof assetId === 'number') {
    return assetId === NATIVE_ASSET_ID;
  }

  const coin = getString(getRequestValue(request, 'coin') ?? getRequestValue(request, 'blockchain'));

  return coin ? isNativeAssetAlias(coin) : defaultToNative;
}

function assertQortiumAddress(address: string, label: string) {
  if (!/^Q[1-9A-HJ-NP-Za-km-z]{20,}$/.test(address)) {
    throw new Error(`${label} must be a Qortium address.`);
  }

  return address;
}

function getRequiredAddressRequestString(request: QdnAppRequest, key: string, label: string) {
  const address = getRequiredRequestString(request, key, label);

  return assertQortiumAddress(address, label);
}

function getOptionalAddressRequestString(request: QdnAppRequest, label: string, ...keys: string[]) {
  const address = getOptionalStringRequestValue(request, ...keys);

  return address ? assertQortiumAddress(address, label) : '';
}

function getRequestTags(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(getString).filter(Boolean);
  }

  const tag = getString(value);

  return tag ? [tag] : [];
}

function getQdnWriteTags(request: QdnAppRequest) {
  const tags = getRequestTags(getRequestValue(request, 'tags'));

  for (let index = 1; index <= 5; index += 1) {
    const tag = getString(getRequestValue(request, `tag${index}`));

    if (tag) {
      tags.push(tag);
    }
  }

  return [...new Set(tags)].slice(0, 5);
}

function getRequestFee(value: unknown) {
  const fee = getNumber(value);

  if (typeof fee === 'undefined') {
    return undefined;
  }

  if (!Number.isSafeInteger(fee) || fee < 0) {
    throw new Error('QDN write fee must be a non-negative integer.');
  }

  return fee;
}

function getTransactionFee(request: QdnAppRequest) {
  return getRequestFee(getRequestValue(request, 'fee')) ?? 0;
}

function getTransactionGroupId(request: QdnAppRequest, fallback = 0) {
  const txGroupId = getInteger(getRequestValue(request, 'txGroupId') ?? getRequestValue(request, 'feeGroupId'));

  if (typeof txGroupId === 'undefined') {
    return fallback;
  }

  if (txGroupId < 0) {
    throw new Error('Transaction group id must be a non-negative integer.');
  }

  return txGroupId;
}

function getRequiredAmountValue(request: QdnAppRequest, key: string, label: string) {
  const value = getRequestValue(request, key);

  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }

  const stringValue = getString(value);

  if (/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(stringValue)) {
    return stringValue;
  }

  throw new Error(`${label} must be a non-negative amount with up to 8 decimal places.`);
}

function getOptionalBooleanRequestValue(request: QdnAppRequest, ...keys: string[]) {
  for (const key of keys) {
    const value = getBoolean(getRequestValue(request, key));

    if (typeof value === 'boolean') {
      return value;
    }
  }

  return undefined;
}

function getOptionalIntegerRequestValue(request: QdnAppRequest, minimumValue: number, ...keys: string[]) {
  for (const key of keys) {
    const value = getInteger(getRequestValue(request, key));

    if (typeof value === 'undefined') {
      continue;
    }

    if (value < minimumValue) {
      throw new Error(`${key} must be at least ${minimumValue}.`);
    }

    return value;
  }

  return undefined;
}

function getOptionalStringRequestValue(request: QdnAppRequest, ...keys: string[]) {
  for (const key of keys) {
    const value = getString(getRequestValue(request, key));

    if (value) {
      return value;
    }
  }

  return '';
}

function getRequiredNameRequestString(request: QdnAppRequest) {
  return getRequiredRequestString(request, 'name', 'Name');
}

function getInlinePublishData(request: QdnAppRequest) {
  return getString(getRequestValue(request, 'data64')) || getString(getRequestValue(request, 'base64'));
}

function getNodeApiPath(value: unknown, nodeApiUrl: string) {
  const apiPath = getString(value);

  if (!apiPath.startsWith('/') || apiPath.startsWith('//')) {
    throw new Error('Node API paths must start with /.');
  }

  if (/[\x00-\x1F]/.test(apiPath)) {
    throw new Error('Node API path contains invalid control characters.');
  }

  const url = new URL(apiPath, nodeApiUrl);

  return `${url.pathname}${url.search}`;
}

function getQdnAppMaxBytes(value: unknown) {
  const maxBytes = Math.floor(getNumber(value) ?? QDN_APP_DEFAULT_MAX_BYTES);

  return Math.max(0, Math.min(maxBytes, QDN_APP_MAX_BYTES_LIMIT));
}

function getReadOnlyMethod(value: unknown) {
  const method = getString(value).toUpperCase() || 'GET';

  if (method !== 'GET' && method !== 'HEAD') {
    throw new Error('QDN app node API requests only support GET and HEAD right now.');
  }

  return method;
}

function getNodeSettingsPatch(request: QdnAppRequest) {
  const explicitPatch = getRequestValue(request, 'patch') ?? getRequestValue(request, 'settings');
  const patch = explicitPatch ?? (isRecord(request.payload) ? request.payload : undefined);

  if (!isRecord(patch)) {
    throw new Error('Node settings update requests must include a settings patch object.');
  }

  return patch;
}

function getExactQdnApprovalValue(value: unknown, maxLength: number) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const displayValue = serialized ?? String(value);

  if (displayValue.length > maxLength) {
    throw new Error(`QDN write request data is too large to display safely for approval (${maxLength} characters maximum).`);
  }

  return displayValue;
}

function getWritableSettingKeys(metadata: unknown) {
  const keys = new Set<string>();

  if (!isRecord(metadata) || !isRecord(metadata.writable)) {
    return keys;
  }

  if (Array.isArray(metadata.writable.entry)) {
    for (const entry of metadata.writable.entry) {
      if (isRecord(entry) && typeof entry.key === 'string') {
        keys.add(entry.key);
      }
    }
    return keys;
  }

  for (const key of Object.keys(metadata.writable)) {
    keys.add(key);
  }

  return keys;
}

export type { QdnAppRequest };
export { NATIVE_ASSET_ID, QDN_APP_DEFAULT_MAX_BYTES, QDN_APP_MAX_BYTES_LIMIT };
export {
  getString,
  getNumber,
  getInteger,
  getBoolean,
  isRecord,
  getRequestPayload,
  getRequestValue,
  hasRequestValue,
  getRequiredRequestString,
  getRequiredGroupId,
  getOptionalBase58RequestString,
  isNativeAssetAlias,
  getRequestAssetId,
  isNativeAssetRequest,
  assertQortiumAddress,
  getRequiredAddressRequestString,
  getOptionalAddressRequestString,
  getRequestTags,
  getQdnWriteTags,
  getRequestFee,
  getTransactionFee,
  getTransactionGroupId,
  getRequiredAmountValue,
  getOptionalBooleanRequestValue,
  getOptionalIntegerRequestValue,
  getOptionalStringRequestValue,
  getRequiredNameRequestString,
  getInlinePublishData,
  getNodeApiPath,
  getQdnAppMaxBytes,
  getReadOnlyMethod,
  getNodeSettingsPatch,
  getExactQdnApprovalValue,
  getWritableSettingKeys,
};
