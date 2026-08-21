import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { NetworkIdentityLookup, VisibleAvatarReadResult } from '../contracts'
import {
  VISIBLE_AVATAR_LOADING_MS,
  VisibleIdentityAvatar,
} from './VisibleIdentityAvatar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type TimerRecord = {
  readonly callback: () => void
  readonly delay: number
}

const timers = new Map<number, TimerRecord>()
let nextTimerId = 1
const originalSetTimeout = window.setTimeout.bind(window)
const originalClearTimeout = window.clearTimeout.bind(window)
const originalCreateObjectUrl = URL.createObjectURL
const originalRevokeObjectUrl = URL.revokeObjectURL

window.setTimeout = ((callback: TimerHandler, delay = 0) => {
  const id = nextTimerId
  nextTimerId += 1
  timers.set(id, {
    callback: () => {
      if (typeof callback === 'function') callback()
    },
    delay,
  })
  return id
}) as typeof window.setTimeout
window.clearTimeout = ((id: number | undefined) => {
  if (typeof id === 'number') timers.delete(id)
}) as typeof window.clearTimeout
URL.createObjectURL = () => 'blob:qortium-avatar-test'
URL.revokeObjectURL = () => undefined

function timerWithDelay(delay: number) {
  const match = [...timers.entries()].find(([, timer]) => timer.delay === delay)
  assert.ok(match, `Expected an active ${delay}ms timer.`)
  return match
}

function runTimer(id: number, timer: TimerRecord) {
  timers.delete(id)
  timer.callback()
}

const identity: NetworkIdentityLookup = {
  address: 'QH143K2qjVdn864NSY7aNESo88ao1ZnALH',
  avatar: {
    identifier: 'qortal_avatar',
    name: 'Alice',
    service: 'THUMBNAIL',
    source: 'legacy-name',
  },
  detail: '1 registered name',
  matchedQueryName: true,
  names: ['Alice'],
  network: 'qortal',
  primaryName: 'Alice',
  state: 'resolved',
}

const results: VisibleAvatarReadResult[] = [
  { retryAfterSeconds: 10, status: 'pending' },
  {
    body: 'iVBORw0KGgo=',
    contentLength: 8,
    contentType: 'image/png',
    status: 'ready',
  },
]
let loaderCalls = 0
const container = document.createElement('div')
document.body.appendChild(container)
const root = createRoot(container)

try {
  await act(async () => {
    root.render(
      <VisibleIdentityAvatar
        identity={identity}
        loader={async () => {
          const result = results[Math.min(loaderCalls, results.length - 1)]
          loaderCalls += 1
          return result
        }}
        network="qortal"
        query="Alice"
      />,
    )
    await Promise.resolve()
  })

  const initial = container.querySelector('.home-v2-presence__avatar')
  assert.equal(initial?.getAttribute('data-loading'), 'true')
  assert.equal(loaderCalls, 1)

  const [deadlineId, deadline] = timerWithDelay(VISIBLE_AVATAR_LOADING_MS)
  const [retryId, retry] = timerWithDelay(10_000)
  act(() => runTimer(deadlineId, deadline))

  assert.equal(
    container.querySelector('.home-v2-presence__avatar')?.getAttribute('data-loading'),
    'false',
  )
  assert.equal(timers.has(retryId), true, 'the background retry must survive the visual deadline')
  assert.equal(loaderCalls, 1)

  await act(async () => {
    runTimer(retryId, retry)
    await Promise.resolve()
  })

  const image = container.querySelector('img.home-v2-presence__avatar')
  assert.equal(loaderCalls, 2)
  assert.equal(image?.getAttribute('src'), 'blob:qortium-avatar-test')

  let boundedLoaderCalls = 0
  await act(async () => {
    root.render(
      <VisibleIdentityAvatar
        identity={identity}
        loader={async () => {
          boundedLoaderCalls += 1
          return { retryAfterSeconds: 1, status: 'pending' }
        }}
        network="qortal"
        query="Alice"
      />,
    )
    await Promise.resolve()
  })

  const [boundedDeadlineId, boundedDeadline] = timerWithDelay(
    VISIBLE_AVATAR_LOADING_MS,
  )
  act(() => runTimer(boundedDeadlineId, boundedDeadline))
  for (let attempt = 1; attempt < 12; attempt += 1) {
    const [boundedRetryId, boundedRetry] = timerWithDelay(1_000)
    await act(async () => {
      runTimer(boundedRetryId, boundedRetry)
      await Promise.resolve()
    })
  }
  assert.equal(boundedLoaderCalls, 12)
  assert.equal(
    [...timers.values()].some((timer) => timer.delay === 1_000),
    false,
    'pending avatar retries must stop after the bounded attempt limit',
  )
} finally {
  await act(async () => root.unmount())
  container.remove()
  window.setTimeout = originalSetTimeout
  window.clearTimeout = originalClearTimeout
  URL.createObjectURL = originalCreateObjectUrl
  URL.revokeObjectURL = originalRevokeObjectUrl
}

console.log('Home v2 visible identity avatar tests passed.')
