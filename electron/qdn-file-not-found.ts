export const QDN_FILE_NOT_FOUND_ERROR = 1401;

function getQdnErrorCode(body: unknown): number | undefined {
  if (typeof body === 'string') {
    try {
      return getQdnErrorCode(JSON.parse(body));
    } catch {
      return undefined;
    }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return undefined;
  }

  const error = (body as Record<string, unknown>).error;

  if (typeof error === 'number' && Number.isInteger(error)) {
    return error;
  }

  if (typeof error === 'string' && /^\d+$/.test(error.trim())) {
    return Number(error);
  }

  return undefined;
}

export function isQdnFileNotFoundResponse(status: number, body: unknown): boolean {
  return status === 404 && getQdnErrorCode(body) === QDN_FILE_NOT_FOUND_ERROR;
}

export class QdnFileNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QdnFileNotFoundError';
  }
}
