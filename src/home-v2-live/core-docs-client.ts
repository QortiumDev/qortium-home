import { Capacitor, CapacitorHttp } from '@capacitor/core'
import type { HomeV2CoreDocsNetwork } from '../v2/core-docs-address'

export type HomeV2CoreDocsTransport = 'android' | 'desktop'

export function homeV2CoreDocsTransport(): HomeV2CoreDocsTransport {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
    ? 'android'
    : 'desktop'
}

export async function probeHomeV2CoreDocs(
  network: HomeV2CoreDocsNetwork,
  nodeApiUrl: string,
) {
  if (window.homeV2CoreDocs) return window.homeV2CoreDocs.probe(network)
  if (homeV2CoreDocsTransport() !== 'android') {
    throw new Error('Core documentation transport is unavailable.')
  }
  const response = await CapacitorHttp.request({
    connectTimeout: 5_000,
    method: 'GET',
    readTimeout: 10_000,
    responseType: 'text',
    url: new URL('/api-documentation/', `${nodeApiUrl}/`).toString(),
  })
  return { status: response.status }
}

export async function enableHomeV2CoreDocs(network: HomeV2CoreDocsNetwork) {
  if (!window.homeV2CoreDocs) {
    throw new Error('Core documentation settings can only be changed on desktop.')
  }
  return window.homeV2CoreDocs.enable(network)
}

declare global {
  interface Window {
    homeV2CoreDocs?: {
      enable(network: HomeV2CoreDocsNetwork): Promise<{ accepted: boolean }>
      probe(network: HomeV2CoreDocsNetwork): Promise<{ status: number }>
    }
  }
}
