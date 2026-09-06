import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://localhost/', pretendToBeVisual: true })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, Event: dom.window.Event,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
await import('../dist-electron/home-v2-viewer-save.test.js')
dom.window.close()
