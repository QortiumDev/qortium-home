export const QDN_BRIDGE_ERROR_KEY = '__qdnBridgeError_9f5f01d1';
export const QDN_BRIDGE_RESULT_KEY = '__qdnBridgeResult_9f5f01d1';

type QdnBridgeErrorPayload = {
  code?: string;
  message: string;
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
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;

  return {
    [QDN_BRIDGE_ERROR_KEY]: {
      message,
      ...(code ? { code } : {}),
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

  return Object.assign(
    new Error(payload.message),
    typeof payload.code === 'string' ? { code: payload.code } : {},
  );
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
