export const QDN_ATTESTATION_FETCH_TIMEOUT_MS = 60_000;

export async function fetchBoundedBytes(
  fetchResponse: (signal: AbortSignal) => Promise<Response>,
  maxBytes: number,
  timeoutMs = QDN_ATTESTATION_FETCH_TIMEOUT_MS,
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('Attestation response limit must be a positive integer.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('QDN content attestation fetch timed out.')), timeoutMs);
  try {
    const response = await fetchResponse(controller.signal);
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      controller.abort();
      throw new Error('QDN content attestation response exceeded its byte limit.');
    }
    if (!response.body || typeof response.body.getReader !== 'function') {
      controller.abort();
      throw new Error('QDN content attestation requires a streaming HTTP response.');
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          controller.abort();
          await reader.cancel().catch(() => undefined);
          throw new Error('QDN content attestation response exceeded its byte limit.');
        }
        chunks.push(value);
      }
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason instanceof Error &&
        controller.signal.reason.message.includes('timed out')) {
        throw controller.signal.reason;
      }
      throw error;
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, response };
  } finally {
    clearTimeout(timeout);
  }
}
