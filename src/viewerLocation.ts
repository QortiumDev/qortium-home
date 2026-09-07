// Pure shared contracts; no Electron runtime or platform authority.
export { parseViewerAddress, parseViewerLocation, isViewerAddress, viewerLocationFromResource } from '../electron/home-v2-viewer-location'
export type { ViewerAddress, ViewerLocation, ViewerPositionSeed } from '../electron/home-v2-viewer-location'
export { getQdnResourceStreamProxyMimeType } from '../electron/qdn-resource-viewer-contract'
