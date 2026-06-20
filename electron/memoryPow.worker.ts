// Electron worker_threads worker that runs the memory-hard CHAT memory-pow off
// the main process. It receives the nonce-zeroed CHAT signing bytes, hashes them
// with node:crypto (single SHA-256), then runs the pure compute2 core (the same
// algorithm the renderer worker uses via SubtleCrypto). Independent 0BSD
// implementation.
//
// This is a flat file under electron/ so the existing tsconfig include glob
// ("*.ts") emits dist-electron/memoryPow.worker.js (ESM, matching the rest of
// dist-electron). worker_threads loads the ESM entry natively in this runtime.
//
// Message in:  { id: string; data: Uint8Array; difficulty: number }
// Message out: { id: string; nonce: number } | { id: string; error: string }

import { createHash } from 'node:crypto';
import { parentPort } from 'node:worker_threads';
import { compute2 } from './memoryPow.js';

type PowRequest = {
  id: string;
  data: Uint8Array;
  difficulty: number;
};

type PowResponse =
  | { id: string; nonce: number }
  | { id: string; error: string };

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

if (!parentPort) {
  throw new Error('memoryPow worker must be run as a worker_thread.');
}

const port = parentPort;

port.on('message', (request: PowRequest) => {
  const { id, data, difficulty } = request;

  try {
    const seedHash = sha256(data);
    const nonce = compute2(seedHash, difficulty);
    const response: PowResponse = { id, nonce };
    port.postMessage(response);
  } catch (error) {
    const response: PowResponse = {
      id,
      error: error instanceof Error ? error.message : String(error),
    };
    port.postMessage(response);
  }
});
