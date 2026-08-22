import assert from 'node:assert/strict'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import {
  assertAuthorizedHomeV2Sender,
  authorizeHomeV2Sender,
} from './home-v2-authorized-senders.js'

type Listener = (...args: unknown[]) => void

function senderFixture(id: number, initialUrl: string) {
  let currentUrl = initialUrl
  let destroyed = false
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
    sender,
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

console.log('Home v2 authorized-sender tests passed.')

