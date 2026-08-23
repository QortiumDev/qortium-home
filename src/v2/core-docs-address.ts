export type HomeV2CoreDocsNetwork = 'qortal' | 'qortium'

export function buildHomeV2CoreDocsFrameUrl(network: HomeV2CoreDocsNetwork) {
  return `qortium-home-core-docs://${network}/api-documentation/`
}
