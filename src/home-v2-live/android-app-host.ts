import { registerPlugin } from '@capacitor/core'

interface QdnRenderProxyPlugin {
  authorize(options: {
    authorizedDocumentUrl?: string | null
    homeV2: boolean
    origin: string
  }): Promise<{ proxyOrigin: string }>
  authorizeStream(options: {
    binding: string
    mimeType?: string | null
    origin: string
    resourceUrl: string
  }): Promise<{ streamUrl: string }>
  authorizePrivateBytes(options: {
    binding: string
    dataBase64: string
    mimeType?: string | null
  }): Promise<{ streamUrl: string }>
  releaseStreams(options?: { binding?: string | null }): Promise<void>
}

const QdnRenderProxy = registerPlugin<QdnRenderProxyPlugin>('QdnRenderProxy')

// Round 6 (owner-directed redesign, ending the round-2/4/5 identifier-
// confusion class): `authorizedDocumentUrl` registers this app tab's EXACT
// shell-computed render document URL (AppTabStage.tsx's `resolved.url`,
// never anything the app itself reports) as the ONLY document
// QdnRenderProxy/QdnBridgeWebViewClient will ever carry the live bridge
// token / inject / strip CSP for on this origin, until the next authorize()
// call replaces it (see QdnRenderProxy.java's class doc comment and
// AppTabStage.tsx's AndroidAppStage — Android renders at most one app tab's
// iframe at a time, so this is always the currently displayed tab's own
// document). QdnRenderProxy derives the app's name/identifier for its
// (separate, coarser) data-read containment from this SAME URL server-side,
// rather than the caller computing and passing them independently — closing
// the drift risk a caller-computed identifier always carried.
export async function authorizeHomeV2AndroidAppOrigin(origin: string, authorizedDocumentUrl: string) {
  const result = await QdnRenderProxy.authorize({ authorizedDocumentUrl, homeV2: true, origin })
  if (!result.proxyOrigin?.startsWith('https://')) {
    throw new Error('Android did not return a secure QDN proxy origin.')
  }
  return result.proxyOrigin
}

export async function authorizeHomeV2AndroidResourceStream(
  resourceUrl: string,
  mimeType: string | null,
  binding: string,
) {
  const upstream = new URL(resourceUrl)
  if ((upstream.protocol !== 'http:' && upstream.protocol !== 'https:') || upstream.username || upstream.password || upstream.hash) {
    throw new Error('Home requires an exact public QDN render URL for Android streaming.')
  }
  const result = await QdnRenderProxy.authorizeStream({
    binding,
    mimeType,
    origin: upstream.origin,
    resourceUrl: upstream.toString(),
  })
  const capability = new URL(result.streamUrl)
  if (capability.protocol !== 'https:' || !capability.hostname.endsWith('.qdn.androidplatform.net')) {
    throw new Error('Android did not return a secure QDN stream capability.')
  }
  return capability.toString()
}

export async function authorizeHomeV2AndroidPrivateBytesStream(
  dataBase64: string,
  mimeType: string | null,
  binding: string,
) {
  if (typeof dataBase64 !== 'string' || !dataBase64 || dataBase64.length > 1_500_000) {
    throw new Error('Home requires bounded private attachment bytes for Android streaming.')
  }
  const result = await QdnRenderProxy.authorizePrivateBytes({ binding, dataBase64, mimeType })
  const capability = new URL(result.streamUrl)
  if (capability.protocol !== 'https:' || !capability.hostname.endsWith('.qdn.androidplatform.net')) {
    throw new Error('Android did not return a secure private attachment capability.')
  }
  return capability.toString()
}

export async function releaseHomeV2AndroidResourceStreams(binding?: string | null) {
  await QdnRenderProxy.releaseStreams({ binding: binding ?? null })
}
