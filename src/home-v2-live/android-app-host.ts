import { registerPlugin } from '@capacitor/core'

interface QdnRenderProxyPlugin {
  authorize(options: { homeV2: boolean; origin: string }): Promise<{ proxyOrigin: string }>
}

const QdnRenderProxy = registerPlugin<QdnRenderProxyPlugin>('QdnRenderProxy')

export async function authorizeHomeV2AndroidAppOrigin(origin: string) {
  const result = await QdnRenderProxy.authorize({ homeV2: true, origin })
  if (!result.proxyOrigin?.startsWith('https://')) {
    throw new Error('Android did not return a secure QDN proxy origin.')
  }
  return result.proxyOrigin
}
