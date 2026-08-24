import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'https://qortium-home.invalid/',
})

globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
})
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.HTMLButtonElement = dom.window.HTMLButtonElement
globalThis.HTMLSelectElement = dom.window.HTMLSelectElement
globalThis.Event = dom.window.Event
globalThis.MouseEvent = dom.window.MouseEvent
globalThis.PointerEvent = dom.window.PointerEvent ?? dom.window.MouseEvent
globalThis.Node = dom.window.Node
globalThis.URL.createObjectURL = () => 'blob:qortium-home-test'
globalThis.URL.revokeObjectURL = () => undefined
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)

await import('../dist-electron/home-v2-bookmark-toolbar.test.js')
