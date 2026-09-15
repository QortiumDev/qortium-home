import assert from 'node:assert/strict'

import { createMemoryPowQueue, memoryPowError } from './memory-pow-queue.js'

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5))

// Tasks run one at a time, in arrival order, and every caller gets its own result.
{
  const queue = createMemoryPowQueue(8)
  const order: string[] = []
  let running = 0
  let peak = 0
  const task = (name: string, ms: number) => () => new Promise<string>((resolve) => {
    running += 1
    peak = Math.max(peak, running)
    order.push(`start:${name}`)
    setTimeout(() => {
      running -= 1
      order.push(`end:${name}`)
      resolve(name)
    }, ms)
  })
  const busy = () => new Error('busy')
  const results = await Promise.all([
    queue.run(task('a', 30), busy),
    queue.run(task('b', 5), busy),
    queue.run(task('c', 5), busy),
  ])
  assert.deepEqual(results, ['a', 'b', 'c'])
  assert.equal(peak, 1)
  assert.deepEqual(order, ['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c'])
  assert.equal(queue.pending, 0)
}

// A failed task rejects its own caller only; the next task still runs.
{
  const queue = createMemoryPowQueue(8)
  const first = queue.run(() => Promise.reject(new Error('boom')), () => new Error('busy'))
  const second = queue.run(() => Promise.resolve(7), () => new Error('busy'))
  await assert.rejects(first, /boom/)
  assert.equal(await second, 7)
}

// Past the bound the caller is refused immediately with the busy error, and
// the refusal does not occupy a slot.
{
  const queue = createMemoryPowQueue(2)
  const release: Array<() => void> = []
  const blocked = () => new Promise<number>((resolve) => release.push(() => resolve(1)))
  const busyError = memoryPowError('QDN_POW_BUSY', 'full')
  const p1 = queue.run(blocked, () => busyError)
  const p2 = queue.run(blocked, () => busyError)
  await assert.rejects(queue.run(blocked, () => busyError), (error: Error & { outcome?: string; retryable?: boolean }) =>
    error === busyError && error.outcome === 'rejected' && error.retryable === true && error.message === 'full')
  assert.equal(queue.pending, 2)
  release[0]!()
  await tick()
  release[1]!()
  await Promise.all([p1, p2])
  assert.equal(queue.pending, 0)
  assert.equal(await queue.run(() => Promise.resolve(3), () => busyError), 3)
}

console.log('memory-pow queue tests passed.')
