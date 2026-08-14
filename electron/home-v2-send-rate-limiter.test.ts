import assert from 'node:assert/strict'
import {
  createHomeV2SendRateLimiter,
  HOME_V2_CHAT_SEND_MAX_PER_WINDOW,
  HOME_V2_CHAT_SEND_MIN_INTERVAL_MS,
  HOME_V2_CHAT_SEND_WINDOW_MS,
} from './home-v2-send-rate-limiter.js'

// Normal human cadence: one send every MIN_INTERVAL_MS is always allowed and
// never trips the rolling cap as long as it stays under it.
{
  const limiter = createHomeV2SendRateLimiter()
  let now = 0
  for (let i = 0; i < HOME_V2_CHAT_SEND_MAX_PER_WINDOW; i += 1) {
    const decision = limiter.checkAndRecordSend('tab-1|account-1', now)
    assert.equal(decision.allowed, true, `send ${i} at normal cadence should be allowed`)
    now += HOME_V2_CHAT_SEND_MIN_INTERVAL_MS
  }
}

// A burst faster than the minimum interval is rejected starting at the
// second send, without needing to hit the rolling cap.
{
  const limiter = createHomeV2SendRateLimiter()
  const key = 'tab-1|account-1'
  const first = limiter.checkAndRecordSend(key, 1_000)
  assert.equal(first.allowed, true)
  const second = limiter.checkAndRecordSend(key, 1_000 + HOME_V2_CHAT_SEND_MIN_INTERVAL_MS - 1)
  assert.equal(second.allowed, false)
  assert.equal(typeof (second as { message: string }).message, 'string')
  assert.match((second as { message: string }).message, /quick/i)
  // Waiting out the minimum interval allows the next send again.
  const third = limiter.checkAndRecordSend(key, 1_000 + HOME_V2_CHAT_SEND_MIN_INTERVAL_MS)
  assert.equal(third.allowed, true)
}

// The rolling cap rejects a send even when each one individually respects
// the minimum interval, once MAX_PER_WINDOW have landed inside the window.
{
  const limiter = createHomeV2SendRateLimiter()
  const key = 'tab-1|account-1'
  let now = 0
  for (let i = 0; i < HOME_V2_CHAT_SEND_MAX_PER_WINDOW; i += 1) {
    const decision = limiter.checkAndRecordSend(key, now)
    assert.equal(decision.allowed, true)
    now += HOME_V2_CHAT_SEND_MIN_INTERVAL_MS
  }
  const overCap = limiter.checkAndRecordSend(key, now)
  assert.equal(overCap.allowed, false, 'the (MAX_PER_WINDOW + 1)th send within the window is rejected')
}

// A rejected attempt is not itself recorded, so a burst of rejections cannot
// consume rolling-window capacity that a legitimate send would need.
{
  const limiter = createHomeV2SendRateLimiter()
  const key = 'tab-1|account-1'
  limiter.checkAndRecordSend(key, 0)
  for (let i = 0; i < 50; i += 1) {
    const rejected = limiter.checkAndRecordSend(key, 1)
    assert.equal(rejected.allowed, false)
  }
  const allowedAgain = limiter.checkAndRecordSend(key, HOME_V2_CHAT_SEND_MIN_INTERVAL_MS)
  assert.equal(allowedAgain.allowed, true)
}

// The window rolls: once enough time has passed, earlier sends age out of
// the rolling cap even without waiting for the minimum interval to matter.
{
  const limiter = createHomeV2SendRateLimiter()
  const key = 'tab-1|account-1'
  let now = 0
  for (let i = 0; i < HOME_V2_CHAT_SEND_MAX_PER_WINDOW; i += 1) {
    assert.equal(limiter.checkAndRecordSend(key, now).allowed, true)
    now += HOME_V2_CHAT_SEND_MIN_INTERVAL_MS
  }
  assert.equal(limiter.checkAndRecordSend(key, now).allowed, false, 'still within the window: capped')
  const afterWindow = now + HOME_V2_CHAT_SEND_WINDOW_MS + 1
  assert.equal(
    limiter.checkAndRecordSend(key, afterWindow).allowed,
    true,
    'once the full window has elapsed, capacity is available again',
  )
}

// Different keys (different tab/account pairs) never share a limit.
{
  const limiter = createHomeV2SendRateLimiter()
  assert.equal(limiter.checkAndRecordSend('tab-1|account-1', 0).allowed, true)
  assert.equal(limiter.checkAndRecordSend('tab-2|account-1', 0).allowed, true)
  assert.equal(limiter.checkAndRecordSend('tab-1|account-2', 0).allowed, true)
}

// reset() drops all tracked history for every key.
{
  const limiter = createHomeV2SendRateLimiter()
  const key = 'tab-1|account-1'
  limiter.checkAndRecordSend(key, 0)
  const blocked = limiter.checkAndRecordSend(key, 1)
  assert.equal(blocked.allowed, false)
  limiter.reset()
  const afterReset = limiter.checkAndRecordSend(key, 2)
  assert.equal(afterReset.allowed, true)
}

console.log('home-v2-send-rate-limiter.test.ts passed')
