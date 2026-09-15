// A tiny FIFO for the memory-hard CHAT proof-of-work. Each host keeps ONE
// PoW worker (electron/qdn.ts for the Home 1 bridge, electron/home-v2-chat-pow.ts
// for Home 2, src/platform.ts for Android), and until 2026-09-15 a request that
// arrived while that worker was busy was refused with QDN_POW_BUSY. Two chat
// messages sent back to back therefore lost the second one — and because the
// refusal carried no outcome, apps could not even tell it was safe to retry.
//
// Requests now wait their turn. A caller that would exceed MEMORY_POW_MAX_WAITING
// queued requests is still refused, but with outcome 'rejected' (nothing was
// signed or sent). The queue is host-neutral: no worker, timer or Node import.

export const MEMORY_POW_MAX_WAITING = 8

export type MemoryPowQueue = {
  /** Requests currently computing or waiting. */
  readonly pending: number
  /**
   * Runs `task` after every previously queued task has settled. `onBusy`
   * builds the rejection when the queue is full; it is called at most once.
   */
  run<T>(task: () => Promise<T>, onBusy: () => Error): Promise<T>
}

export function createMemoryPowQueue(maxWaiting = MEMORY_POW_MAX_WAITING): MemoryPowQueue {
  let tail: Promise<unknown> = Promise.resolve()
  let pending = 0
  return {
    get pending() {
      return pending
    },
    run<T>(task: () => Promise<T>, onBusy: () => Error): Promise<T> {
      if (pending >= maxWaiting) return Promise.reject(onBusy())
      pending += 1
      // A failed predecessor must not poison the queue: run regardless.
      const result = tail.then(task, task)
      tail = result.then(
        () => undefined,
        () => undefined,
      )
      return result.finally(() => {
        pending -= 1
      })
    },
  }
}

/** Pre-signing PoW refusals are definitive: nothing was signed or sent, retry is safe. */
export function memoryPowError(code: 'QDN_POW_BUSY' | 'QDN_POW_TIMEOUT' | 'QDN_POW_CANCELLED', message: string) {
  return Object.assign(new Error(message), { code, outcome: 'rejected' as const, retryable: true })
}
