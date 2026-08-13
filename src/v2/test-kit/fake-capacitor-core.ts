// Test-only stand-in for @capacitor/core's registerPlugin, used ONLY via an
// esbuild --alias substitution in AppTabStage.test.tsx's build command (see
// package.json's test:app-tab-stage-android script) — nothing in the real
// app graph imports this file, so it ships in no production bundle.
//
// android-app-host.ts's authorizeHomeV2AndroidAppOrigin calls
// QdnRenderProxy.authorize(...) via this plugin; the real implementation
// requires a native Capacitor/Android bridge that does not exist under
// Node+jsdom. This fake resolves deterministically instead, so
// AppTabStage.test.tsx can exercise AndroidAppStage's REAL mount/unmount
// behavior (Round 4, Defect A) — including its iframe actually appearing —
// without needing a real device. It does not simulate
// QdnRenderProxy/QdnBridgeWebViewClient's native identity enforcement at
// all (see QdnRenderProxyTest.java for that); it only unblocks the JS/React
// side under test.

export function registerPlugin(_name: string) {
  return {
    async authorize(_options: unknown) {
      // A single fixed origin: production also authorizes ONE proxy origin
      // per node regardless of which app tab is active (see
      // QdnRenderProxy.java's class doc comment on why the proxy host label
      // is derived from the node origin, not a per-tab token) — the fake
      // mirrors that shared-origin shape so the test observes the SAME
      // real-world property (only the path distinguishes apps, not the
      // origin).
      return { proxyOrigin: 'https://fixture-proxy.qdn.androidplatform.net' }
    },
    async release(_options: unknown) {},
  }
}
