export const QDN_BRIDGE_ERROR_KEY = '__qdnBridgeError_9f5f01d1';
export const QDN_BRIDGE_RESULT_KEY = '__qdnBridgeResult_9f5f01d1';

type QdnBridgeErrorPayload = {
  action?: string;
  code?: string;
  message: string;
  network?: 'qortal' | 'qortium';
  outcome?: 'rejected' | 'unknown';
  retryable?: boolean;
  routeRevision?: string;
  target?:
    | { groupId: number; kind: 'group' }
    | { kind: 'direct'; otherAddress: string };
};

type QdnBridgeErrorEnvelope = {
  [QDN_BRIDGE_ERROR_KEY]: QdnBridgeErrorPayload;
};

type QdnBridgeResultEnvelope = {
  [QDN_BRIDGE_RESULT_KEY]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function encodeQdnBridgeError(error: unknown): QdnBridgeErrorEnvelope {
  const message = error instanceof Error ? error.message : String(error);
  const record = isRecord(error) ? error : {};
  const code = typeof record.code === 'string' ? record.code : undefined;
  const target = isRecord(record.target) &&
    ((record.target.kind === 'group' &&
      typeof record.target.groupId === 'number' &&
      Number.isSafeInteger(record.target.groupId) &&
      record.target.groupId >= 0) ||
      (record.target.kind === 'direct' &&
        typeof record.target.otherAddress === 'string' &&
        record.target.otherAddress.length > 0 &&
        record.target.otherAddress.length <= 128))
    ? record.target as QdnBridgeErrorPayload['target']
    : undefined;

  return {
    [QDN_BRIDGE_ERROR_KEY]: {
      message,
      ...(code ? { code } : {}),
      ...(typeof record.action === 'string' ? { action: record.action } : {}),
      ...(record.network === 'qortal' || record.network === 'qortium'
        ? { network: record.network }
        : {}),
      ...(record.outcome === 'rejected' || record.outcome === 'unknown'
        ? { outcome: record.outcome }
        : {}),
      ...(typeof record.retryable === 'boolean' ? { retryable: record.retryable } : {}),
      ...(typeof record.routeRevision === 'string'
        ? { routeRevision: record.routeRevision }
        : {}),
      ...(target ? { target } : {}),
    },
  };
}

export function encodeQdnBridgeResult(value: unknown): QdnBridgeResultEnvelope {
  return { [QDN_BRIDGE_RESULT_KEY]: value };
}

export function decodeQdnBridgeError(value: unknown): Error | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !isRecord(value[QDN_BRIDGE_ERROR_KEY])) {
    return undefined;
  }

  const payload = value[QDN_BRIDGE_ERROR_KEY];

  if (typeof payload.message !== 'string') {
    return undefined;
  }

  return Object.assign(new Error(payload.message), {
    ...(typeof payload.action === 'string' ? { action: payload.action } : {}),
    ...(typeof payload.code === 'string' ? { code: payload.code } : {}),
    ...(payload.network === 'qortal' || payload.network === 'qortium'
      ? { network: payload.network }
      : {}),
    ...(payload.outcome === 'rejected' || payload.outcome === 'unknown'
      ? { outcome: payload.outcome }
      : {}),
    ...(typeof payload.retryable === 'boolean' ? { retryable: payload.retryable } : {}),
    ...(typeof payload.routeRevision === 'string'
      ? { routeRevision: payload.routeRevision }
      : {}),
    ...(isRecord(payload.target) ? { target: payload.target } : {}),
  });
}

export function decodeQdnBridgeResponse(value: unknown) {
  const error = decodeQdnBridgeError(value);

  if (error) {
    throw error;
  }

  if (!isRecord(value) || Object.keys(value).length !== 1 || !(QDN_BRIDGE_RESULT_KEY in value)) {
    throw new Error('Malformed QDN bridge response.');
  }

  return value[QDN_BRIDGE_RESULT_KEY];
}
