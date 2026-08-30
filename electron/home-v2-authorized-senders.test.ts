import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import {
  assertAuthorizedHomeV2Sender,
  authorizeHomeV2Sender,
  broadcastToHomeV2Windows,
  sendToHomeV2Window,
} from './home-v2-authorized-senders.js'

type Listener = (...args: unknown[]) => void

function senderFixture(id: number, initialUrl: string) {
  let currentUrl = initialUrl
  let destroyed = false
  let sendFailure = false
  const sent: Array<{ channel: string; value: unknown }> = []
  const mainFrame = { url: initialUrl }
  const listeners = new Map<string, Listener[]>()
  const sender = {
    getURL: () => currentUrl,
    id,
    isDestroyed: () => destroyed,
    mainFrame,
    on: (name: string, listener: Listener) => {
      listeners.set(name, [...(listeners.get(name) ?? []), listener])
      return sender
    },
    once: (name: string, listener: Listener) => {
      listeners.set(name, [...(listeners.get(name) ?? []), listener])
      return sender
    },
    send: (channel: string, value: unknown) => {
      if (sendFailure) throw new Error('send failed')
      sent.push({ channel, value })
    },
  } as unknown as WebContents
  return {
    destroy() {
      destroyed = true
      for (const listener of listeners.get('destroyed') ?? []) listener()
    },
    event(frame: unknown = mainFrame) {
      return { sender, senderFrame: frame } as IpcMainInvokeEvent
    },
    navigate(url: string) {
      currentUrl = url
      mainFrame.url = url
      for (const listener of listeners.get('did-start-navigation') ?? []) {
        listener({}, url, false, true)
      }
    },
    failSend() {
      sendFailure = true
    },
    sender,
    sent,
  }
}

const trustedUrl = 'file:///opt/qortium-home/dist/v2-live.html'

{
  const widget = senderFixture(100, trustedUrl)
  assert.throws(() => assertAuthorizedHomeV2Sender(widget.event()), /authorized top-level/)
}

{
  const home = senderFixture(101, trustedUrl)
  authorizeHomeV2Sender(home.sender, trustedUrl)
  assert.doesNotThrow(() => assertAuthorizedHomeV2Sender(home.event()))
  assert.throws(
    () => assertAuthorizedHomeV2Sender(home.event({ url: trustedUrl })),
    /authorized top-level/,
  )
  home.navigate('file:///tmp/untrusted.html')
  assert.throws(() => assertAuthorizedHomeV2Sender(home.event()), /authorized top-level/)
}

{
  const home = senderFixture(102, trustedUrl)
  authorizeHomeV2Sender(home.sender, trustedUrl)
  home.destroy()
  assert.throws(() => assertAuthorizedHomeV2Sender(home.event()), /authorized top-level/)
}

{
  const home = senderFixture(103, trustedUrl)
  const replacement = senderFixture(103, trustedUrl)
  authorizeHomeV2Sender(home.sender, trustedUrl)
  assert.throws(
    () => assertAuthorizedHomeV2Sender(replacement.event()),
    /authorized top-level/,
  )
}

{
  const home = senderFixture(104, trustedUrl)
  const widget = senderFixture(105, trustedUrl)
  authorizeHomeV2Sender(home.sender, trustedUrl)
  broadcastToHomeV2Windows('home-v2-qdn-settings:changed', { revision: 1 })
  assert.deepEqual(home.sent, [{
    channel: 'home-v2-qdn-settings:changed',
    value: { revision: 1 },
  }])
  assert.deepEqual(widget.sent, [], 'an unregistered widget must not receive Home events')
}

{
  const navigated = senderFixture(106, trustedUrl)
  authorizeHomeV2Sender(navigated.sender, trustedUrl)
  navigated.navigate('file:///tmp/untrusted.html')
  broadcastToHomeV2Windows('home-v2-qdn-settings:changed', null)
  assert.deepEqual(navigated.sent, [], 'a navigated Home sender must be revoked before broadcast')
}

{
  const failed = senderFixture(107, trustedUrl)
  authorizeHomeV2Sender(failed.sender, trustedUrl)
  failed.failSend()
  assert.doesNotThrow(() =>
    broadcastToHomeV2Windows('home-v2-qdn-settings:changed', null))
  assert.throws(() => assertAuthorizedHomeV2Sender(failed.event()), /authorized top-level/)
}

// A targeted send exists so that window-specific events do not have to reach
// for the broadcast. Home 2 can have several windows open since tabs became
// detachable, so "send to the window that asked" must be the easy path.
{
  const first = senderFixture(108, trustedUrl)
  const second = senderFixture(109, trustedUrl)
  authorizeHomeV2Sender(first.sender, trustedUrl)
  authorizeHomeV2Sender(second.sender, trustedUrl)

  assert.equal(sendToHomeV2Window(108, 'home-v2-window:example', { n: 1 }), true)
  assert.deepEqual(first.sent, [{ channel: 'home-v2-window:example', value: { n: 1 } }])
  assert.deepEqual(second.sent, [], 'the other window must not receive it')

  // And the broadcast still reaches both, so the two are genuinely different.
  broadcastToHomeV2Windows('home-v2-qdn-settings:changed', null)
  assert.equal(first.sent.length, 2)
  assert.equal(second.sent.length, 1)
}

// The targeted send applies the same revocation rules as the broadcast; a
// weaker check here would be a way around them.
{
  const unknown = sendToHomeV2Window(9999, 'home-v2-window:example', null)
  assert.equal(unknown, false, 'an unregistered window id is refused')
}

{
  const navigated = senderFixture(110, trustedUrl)
  authorizeHomeV2Sender(navigated.sender, trustedUrl)
  navigated.navigate('file:///tmp/untrusted.html')
  assert.equal(
    sendToHomeV2Window(110, 'home-v2-window:example', null),
    false,
    'a window that navigated away from its trusted document is refused',
  )
  assert.deepEqual(navigated.sent, [])
}

{
  const destroyed = senderFixture(111, trustedUrl)
  authorizeHomeV2Sender(destroyed.sender, trustedUrl)
  destroyed.destroy()
  assert.equal(sendToHomeV2Window(111, 'home-v2-window:example', null), false)
  assert.deepEqual(destroyed.sent, [])
}

{
  const failed = senderFixture(112, trustedUrl)
  authorizeHomeV2Sender(failed.sender, trustedUrl)
  failed.failSend()
  assert.equal(
    sendToHomeV2Window(112, 'home-v2-window:example', null),
    false,
    'a failed send reports failure rather than throwing',
  )
  assert.throws(() => assertAuthorizedHomeV2Sender(failed.event()), /authorized top-level/)
}

// The broadcast is for genuinely global state only. Both callers today are
// settings-shaped; this pins that so a window-specific channel added here is a
// deliberate decision rather than an accident.
{
  const broadcastChannels = [
    'home-v2-qdn-settings:changed',
    'home-v2-notification-policy:changed',
  ]
  const settingsSource = readFileSync('electron/home-v2-qdn-settings-bridge.ts', 'utf8')
  const policySource = readFileSync('electron/home-v2-notification-policy-bridge.ts', 'utf8')
  assert.match(settingsSource, /broadcastToHomeV2Windows\(/)
  assert.match(policySource, /broadcast: broadcastToHomeV2Windows/)
  for (const source of [settingsSource, policySource]) {
    for (const channel of source.match(/'home-v2-[a-z0-9:-]+'/g) ?? []) {
      const name = channel.slice(1, -1)
      if (!name.endsWith(':changed')) continue
      assert.ok(
        broadcastChannels.includes(name),
        `${name} is broadcast to every window; confirm that is intended`,
      )
    }
  }
}

{
  // A broadcast that lands BEFORE the window has committed its document must not
  // revoke it. This is the bug that made a normally-launched AppImage unusable:
  // during startup getURL() has not committed, so any global broadcast --
  // settings, policy -- deleted the grant for a window that went on to load
  // correctly, and its bridge stayed dead for the life of the process. The
  // renderer showed "Home v2 data is only available to an authorized top-level
  // Home v2 document" with no way back.
  //
  // It only showed up on a FUSE-mounted AppImage because that starts slower, so
  // the broadcast fell inside the loading window; the same build under
  // APPIMAGE_EXTRACT_AND_RUN started fast enough to miss it.
  const starting = senderFixture(140, '')
  authorizeHomeV2Sender(starting.sender, trustedUrl)
  broadcastToHomeV2Windows('home-v2:settings', { any: 'payload' })
  assert.equal(starting.sent.length, 0, 'a window that is still loading receives nothing')
  // ...and is STILL authorized once it finishes loading.
  starting.navigate(trustedUrl)
  assert.doesNotThrow(
    () => assertAuthorizedHomeV2Sender(starting.event()),
    'a broadcast during startup must not permanently revoke the window',
  )
  broadcastToHomeV2Windows('home-v2:settings', { any: 'payload' })
  assert.equal(starting.sent.length, 1, 'and it receives broadcasts once loaded')
}

console.log('Home v2 authorized-sender tests passed.')
