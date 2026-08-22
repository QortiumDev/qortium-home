import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'https://qortium-home.invalid/',
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
})
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.HTMLButtonElement = dom.window.HTMLButtonElement
globalThis.Event = dom.window.Event
globalThis.Node = dom.window.Node
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)

await import('../dist-electron/home-v2-update-settings.test.js')
