import { registerPlugin } from '@capacitor/core'

interface QdnRenderProxyPlugin {
  authorize(options: {
    appIdentifier?: string | null
    appName?: string
    homeV2: boolean
    initialPathname?: string
    origin: string
  }): Promise<{ proxyOrigin: string }>
}

const QdnRenderProxy = registerPlugin<QdnRenderProxyPlugin>('QdnRenderProxy')

// Fix 2 (Sol re-review #2): `appName`/`appIdentifier` register this app tab's
// launch resource as the ONLY resource QdnRenderProxy/QdnBridgeWebViewClient
// will serve APP-service render content for on this origin, until the next
// authorize() call replaces it (see QdnRenderProxy.java's class doc comment
// and AppTabStage.tsx's AndroidAppStage — Android renders at most one app
// tab's iframe at a time, so this is always the currently displayed tab).
// `appIdentifier` is `null` for a default/omitted identifier, matching
// src/v2/resource-location.ts's AppResourceIdentity. `initialPathname` is
// this tab's own first render request's exact path (e.g. from a deep link
// into a default-identity app's specific sub-page) — always allowed
// regardless of the identifier check, since it is computed by THIS trusted
// call, not by the app — see QdnRenderProxy.AppIdentity's doc comment.
export async function authorizeHomeV2AndroidAppOrigin(
  origin: string,
  appName: string,
  appIdentifier: string | null,
  initialPathname: string,
) {
  const result = await QdnRenderProxy.authorize({ appIdentifier, appName, homeV2: true, initialPathname, origin })
  if (!result.proxyOrigin?.startsWith('https://')) {
    throw new Error('Android did not return a secure QDN proxy origin.')
  }
  return result.proxyOrigin
}
