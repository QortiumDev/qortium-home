import { JSDOM } from 'jsdom'

const dom = new JSDOM(
  '<!doctype html><html><body></body></html>',
  { url: 'https://qortium-home.invalid/', pretendToBeVisual: true },
)

globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
})
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Event = dom.window.Event
globalThis.Node = dom.window.Node
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)

await import('../dist-electron/visible-identity-avatar.test.js')
