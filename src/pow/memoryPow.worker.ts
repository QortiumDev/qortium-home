// Renderer Web Worker that runs the memory-hard CHAT memory-pow off the UI
// thread. It receives the nonce-zeroed CHAT signing bytes, hashes them with
// SubtleCrypto (single SHA-256), then runs the pure compute2 core. Independent
// 0BSD implementation.
//
// Message in:  { id: string; data: Uint8Array; difficulty: number }
// Message out: { id: string; nonce: number } | { id: string; error: string }

import { compute2 } from '../memoryPow';

type PowRequest = {
  id: string;
  data: Uint8Array;
  difficulty: number;
};

type PowResponse =
  | { id: string; nonce: number }
  | { id: string; error: string };

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  // SubtleCrypto is available in WorkerGlobalScope on localhost, file://, and
  // Android System WebView (all secure contexts for digest purposes). Copy into
  // a fresh ArrayBuffer-backed view so the type is a concrete BufferSource.
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(digest);
}

self.onmessage = async (event: MessageEvent<PowRequest>) => {
  const { id, data, difficulty } = event.data;

  try {
    const seedHash = await sha256(data);
    const nonce = compute2(seedHash, difficulty);
    const response: PowResponse = { id, nonce };
    self.postMessage(response);
  } catch (error) {
    const response: PowResponse = {
      id,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
