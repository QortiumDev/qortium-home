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

// Round 7 (Sol round-6 re-review, bug 3): every authorize() call this fake
// receives is recorded here so a test can inspect exactly what AppTabStage
// handed the native layer — in particular, that an initial hash deep link
// never appears in the registered authorizedDocumentUrl (see
// AppTabStage.test.tsx's hash test), which no assertion on the iframe's own
// `src` alone could prove.
export const recordedAuthorizeCalls: { authorizedDocumentUrl?: string | null; homeV2?: boolean; origin?: string }[] = []

export function registerPlugin(_name: string) {
  return {
    async authorize(options: { authorizedDocumentUrl?: string | null; homeV2?: boolean; origin?: string }) {
      recordedAuthorizeCalls.push(options)
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
