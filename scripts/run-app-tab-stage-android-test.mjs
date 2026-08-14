// Round 4, Defect A (Sol round-3 re-review): AppTabStage.test.tsx needs a
// real DOM (react-dom/client mounts/unmounts/effects, not just
// renderToStaticMarkup) to prove the tab-switch race is closed. jsdom's
// globals MUST be installed before `react`/`react-dom/client` are imported —
// those packages inspect `document`/`window` as soon as their own module
// code runs, not lazily. package.json's test:app-tab-stage-android script
// bundles the test with react/react-dom left external (see its esbuild
// invocation), so THIS file's own static imports (this script itself is
// plain Node ESM, not esbuild-bundled) resolve those packages — and this
// script's dynamic `import()` of the bundled test file below is what defers
// evaluation of ITS imports (including react/react-dom) until after the
// globals below are already installed. A single esbuild bundle cannot
// provide this ordering on its own: esbuild inlines a same-bundle dynamic
// import's module code at bundle-evaluation time regardless of static vs.
// dynamic import syntax in the source, so only a genuinely separate Node
// import() call (this file) defers evaluation for real.
import { JSDOM } from 'jsdom'

const dom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div></body></html>',
  { url: 'https://qortium-home.invalid/', pretendToBeVisual: true },
)

globalThis.window = dom.window
globalThis.document = dom.window.document
// Node 24 already defines a read-only global `navigator` getter (its own
// NavigatorImpl) — overwrite it with jsdom's instead of a plain assignment,
// which throws against a getter-only property.
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
})
globalThis.HTMLIFrameElement = dom.window.HTMLIFrameElement
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.MessageEvent = dom.window.MessageEvent
globalThis.Event = dom.window.Event
globalThis.CustomEvent = dom.window.CustomEvent
globalThis.Node = dom.window.Node
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame
  ? dom.window.requestAnimationFrame.bind(dom.window)
  : (callback) => setTimeout(() => callback(Date.now()), 0)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame
  ? dom.window.cancelAnimationFrame.bind(dom.window)
  : (handle) => clearTimeout(handle)

await import('../dist-electron/app-tab-stage-android.test.js')
