export const HOME_V2_CORE_DOCS_SCHEME = 'qortium-home-core-docs'
export const HOME_V2_CORE_DOCS_PATH = '/api-documentation/'

export type HomeV2CoreDocsNetwork = 'qortal' | 'qortium'

export function buildHomeV2CoreDocsFrameUrl(network: HomeV2CoreDocsNetwork) {
  return `${HOME_V2_CORE_DOCS_SCHEME}://${network}${HOME_V2_CORE_DOCS_PATH}`
}

export function isAllowedHomeV2CoreDocsPath(pathname: string) {
  return pathname === '/openapi.json' ||
    pathname === '/api-documentation' ||
    pathname.startsWith(HOME_V2_CORE_DOCS_PATH)
}

export function parseHomeV2CoreDocsProtocolUrl(value: string) {
  const url = new URL(value)
  if (
    url.protocol !== `${HOME_V2_CORE_DOCS_SCHEME}:` ||
    (url.hostname !== 'qortal' && url.hostname !== 'qortium') ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    value.length > 4_096
  ) {
    throw new Error('Core documentation URL is invalid.')
  }
  const pathname = url.pathname
  if (
    pathname.includes('%') ||
    pathname.includes('\\') ||
    pathname.includes('\0') ||
    pathname.split('/').includes('..') ||
    !isAllowedHomeV2CoreDocsPath(pathname)
  ) {
    throw new Error('Core documentation path is outside the documentation root.')
  }
  return Object.freeze({
    network: url.hostname as HomeV2CoreDocsNetwork,
    path: `${pathname}${url.search}`,
  })
}
