import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { NetworkIdentityLookup, VisibleAvatarReadResult } from '../contracts'
import {
  VISIBLE_AVATAR_LOADING_MS,
  VisibleIdentityAvatar,
} from './VisibleIdentityAvatar'
import { clearHomeV2ImageCacheForTests, useHomeV2Image } from './useHomeV2Image'

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
  clearHomeV2ImageCacheForTests()
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

  const missingIdentity: NetworkIdentityLookup = {
    ...identity,
    avatar: { ...identity.avatar!, name: 'Missing' },
    primaryName: 'Missing',
  }
  let missingLoaderCalls = 0
  const missingLoader = async () => {
    missingLoaderCalls += 1
    return { status: 'missing' as const }
  }
  await act(async () => {
    root.render(
      <VisibleIdentityAvatar
        identity={missingIdentity}
        loader={missingLoader}
        network="qortal"
        query="Missing"
      />,
    )
    await Promise.resolve()
  })
  assert.equal(missingLoaderCalls, 1)
  assert.equal(
    container.querySelector('.home-v2-presence__avatar')?.getAttribute('data-loading'),
    'false',
  )
  await act(async () => {
    root.render(
      <VisibleIdentityAvatar
        identity={{ ...missingIdentity }}
        loader={missingLoader}
        network="qortal"
        query="Missing"
      />,
    )
    await Promise.resolve()
  })
  assert.equal(
    missingLoaderCalls,
    1,
    'a terminal missing avatar must remain cached across a Home-owned remount',
  )
  assert.equal(
    container.querySelector('.home-v2-presence__avatar')?.getAttribute('data-loading'),
    'false',
  )

  let boundedLoaderCalls = 0
  const pendingIdentity: NetworkIdentityLookup = {
    ...identity,
    avatar: { ...identity.avatar!, name: 'Pending' },
    primaryName: 'Pending',
  }
  await act(async () => {
    root.render(
      <VisibleIdentityAvatar
        identity={pendingIdentity}
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
  clearHomeV2ImageCacheForTests()
  container.remove()
  window.setTimeout = originalSetTimeout
  window.clearTimeout = originalClearTimeout
  URL.createObjectURL = originalCreateObjectUrl
  URL.revokeObjectURL = originalRevokeObjectUrl
}

// Some nodes serve avatars as application/octet-stream because they cannot
// infer a type. Those are real images and must render, decided by their magic
// bytes rather than the server's claim — this is why several publishers'
// avatars showed a monogram. Anything whose bytes are not an image is still
// refused.
{
  const octetContainer = document.createElement('div')
  document.body.appendChild(octetContainer)
  const octetRoot = createRoot(octetContainer)
  const createdTypes: string[] = []
  const originalCreate = URL.createObjectURL
  URL.createObjectURL = ((blob: Blob) => {
    createdTypes.push(blob.type)
    return 'blob:octet-test'
  }) as typeof URL.createObjectURL
  try {
    clearHomeV2ImageCacheForTests()
    await act(async () => {
      octetRoot.render(
        <VisibleIdentityAvatar
          identity={identity}
          loader={async () => ({
            // A real PNG served without a usable content type.
            body: 'iVBORw0KGgo=',
            contentLength: 8,
            contentType: 'application/octet-stream',
            status: 'ready' as const,
          })}
          network="qortal"
          query="Alice"
        />,
      )
      await Promise.resolve()
    })
    await act(async () => { await Promise.resolve() })
    assert.deepEqual(
      createdTypes,
      ['image/png'],
      'an untyped PNG must render as image/png, sniffed from its bytes',
    )
  } finally {
    URL.createObjectURL = originalCreate
    act(() => octetRoot.unmount())
    octetContainer.remove()
  }
}

// Stale-while-revalidate. A decoded image that is past its ready TTL is still
// the right picture, so a remount must paint it on its FIRST render and refresh
// behind it. Gating the seed on expiry meant every remount past the TTL showed a
// monogram for a frame with the bytes already in hand.
{
  const staleContainer = document.createElement('div')
  document.body.appendChild(staleContainer)
  const originalDateNow = Date.now
  const originalStaleCreate = URL.createObjectURL
  const originalStaleRevoke = URL.revokeObjectURL
  let clockOffset = 0
  Date.now = () => originalDateNow() + clockOffset
  URL.createObjectURL = (() => 'blob:stale-while-revalidate') as typeof URL.createObjectURL
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL

  const observed: string[] = []
  let staleLoaderCalls = 0
  const staleLoad = async () => {
    staleLoaderCalls += 1
    return {
      body: 'iVBORw0KGgo=',
      contentLength: 8,
      contentType: 'image/png',
      status: 'ready' as const,
    }
  }
  function StaleProbe() {
    // Reading the hook directly is the only way to see the frame the fallback
    // used to occupy: by the time the effects flush, the subscription has
    // already delivered the cached snapshot.
    const snapshot = useHomeV2Image({
      cacheKey: 'qortal:stale-while-revalidate',
      load: staleLoad,
      loadingMs: 1,
      maxBytes: 64_000,
    })
    observed.push(snapshot.status)
    return null
  }

  try {
    clearHomeV2ImageCacheForTests()
    const firstRoot = createRoot(staleContainer)
    await act(async () => {
      firstRoot.render(<StaleProbe />)
      await Promise.resolve()
    })
    assert.equal(staleLoaderCalls, 1)
    assert.equal(observed.at(-1), 'ready', 'the first mount must resolve to a ready image')
    await act(async () => firstRoot.unmount())

    // A day later: past even the raised ready TTL.
    clockOffset = 25 * 60 * 60_000
    observed.length = 0
    const secondRoot = createRoot(staleContainer)
    await act(async () => {
      secondRoot.render(<StaleProbe />)
      await Promise.resolve()
    })
    assert.equal(
      observed[0],
      'ready',
      'a remount past the ready TTL must paint the cached image on its first render',
    )
    assert.ok(
      observed.every((status) => status === 'ready'),
      'a stale-but-ready image must never drop to a placeholder while it revalidates',
    )
    assert.equal(staleLoaderCalls, 2, 'a stale entry must still be revalidated')
    await act(async () => secondRoot.unmount())
  } finally {
    clearHomeV2ImageCacheForTests()
    staleContainer.remove()
    Date.now = originalDateNow
    URL.createObjectURL = originalStaleCreate
    URL.revokeObjectURL = originalStaleRevoke
  }
}

console.log('Home v2 visible identity avatar tests passed.')
