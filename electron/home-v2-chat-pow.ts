import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { createMemoryPowQueue, memoryPowError } from './memory-pow-queue.js';

// Independent MemoryPoW worker pool for Home v2 public CHAT write paths.
// Mirrors the pool wrapper electron/qdn.ts and src/platform.ts each already
// use for v1 CHAT sends (getMemoryPowWorker/computeChatNonce), but runs as
// its own singleton so a v1 send in flight never contends with a v2 send for
// the same PoW slot. All three share the identical compiled worker script
// (dist-electron/memoryPow.worker.js) and memory-hard algorithm — nothing
// about the PoW computation itself is reimplemented here.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MEMORY_POW_TIMEOUT_MS = 180_000;

type MemoryPowWorkerResponse =
  | { id: string; nonce: number }
  | { id: string; error: string };

let memoryPowWorker: Worker | null = null;
// Requests wait their turn on the single worker instead of being refused
// (memory-pow-queue.ts); PoW refusals are definitive pre-signing rejections.
const memoryPowQueue = createMemoryPowQueue();
const codedError = memoryPowError;

function getMemoryPowWorker(): Worker {
  if (!memoryPowWorker) {
    const worker = new Worker(path.join(__dirname, 'memoryPow.worker.js'));

    // Reset the singleton if the worker dies so the next request re-spawns it.
    worker.on('error', () => {
      if (memoryPowWorker === worker) {
        memoryPowWorker = null;
      }
    });
    worker.on('exit', () => {
      if (memoryPowWorker === worker) {
        memoryPowWorker = null;
      }
    });

    memoryPowWorker = worker;
  }

  return memoryPowWorker;
}

// Runs the CHAT memory-pow off the main process and resolves with the nonce.
// Mirrors electron/qdn.ts computeChatNonce and src/platform.ts computeChatNonce.
export function computeHomeV2ChatNonce(
  data: Uint8Array,
  difficulty: number,
  isStillValid?: () => boolean | Promise<boolean>,
): Promise<number> {
  return memoryPowQueue.run(
    () => computeHomeV2ChatNonceNow(data, difficulty, isStillValid),
    () => codedError('QDN_POW_BUSY', 'Too many proof-of-work computations are waiting. Please retry in a moment.'),
  );
}

async function computeHomeV2ChatNonceNow(
  data: Uint8Array,
  difficulty: number,
  isStillValid?: () => boolean | Promise<boolean>,
): Promise<number> {
  // The request may have waited behind earlier sends: re-check its context
  // before spending three minutes of CPU on it.
  if (isStillValid && !(await isStillValid())) {
    throw codedError('QDN_POW_CANCELLED', 'Proof-of-work was canceled because the account, node, or app context changed.');
  }

  const worker = getMemoryPowWorker();
  const id = randomUUID();

  return new Promise<number>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, nonce?: number, terminate = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(validityTimer);
      worker.off('message', onMessage);
      worker.off('error', onError);
      if (terminate) {
        if (memoryPowWorker === worker) memoryPowWorker = null;
        void worker.terminate();
      }
      if (error) reject(error);
      else resolve(nonce as number);
    };
    const onMessage = (response: MemoryPowWorkerResponse) => {
      if (response.id !== id) {
        return;
      }

      if ('error' in response) {
        finish(new Error(response.error));
        return;
      }

      finish(undefined, response.nonce);
    };

    const onError = (error: Error) => {
      finish(new Error(error.message || 'Memory-pow computation failed.'), undefined, true);
    };

    const timeout = setTimeout(() => {
      finish(codedError('QDN_POW_TIMEOUT', 'Proof-of-work did not finish within three minutes.'), undefined, true);
    }, MEMORY_POW_TIMEOUT_MS);
    const validityTimer = setInterval(() => {
      if (!isStillValid) return;
      void Promise.resolve(isStillValid()).then((valid) => {
        if (!valid) finish(codedError('QDN_POW_CANCELLED', 'Proof-of-work was canceled because the account, node, or app context changed.'), undefined, true);
      }).catch(() => {
        finish(codedError('QDN_POW_CANCELLED', 'Proof-of-work was canceled because its signing context could not be revalidated.'), undefined, true);
      });
    }, 500);

    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.postMessage({ id, data, difficulty });
  });
}
