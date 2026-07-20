import { buildQdnRenderUrl, getQdnResourceKey } from './qdn';
import type { QdnDisplaySettings, QdnResource } from './qdn';
import type { QdnImageResource } from './useQdnImageResource';

export const QDN_GALLERY_IMAGE_MAX_BYTES = 100 * 1024 * 1024;

export type QdnGalleryImageSource =
  | { kind: 'pending' }
  | { kind: 'direct'; url: string }
  | { kind: 'bridge'; resource: QdnImageResource };

// Native Home is served from https://localhost even when its selected public
// Core uses HTTP. Chromium blocks those direct image URLs as mixed content, so
// native galleries resolve image bytes through Home's trusted bridge instead.
export function getQdnGalleryImageSource(
  resource: QdnResource,
  nodeApiUrl: string,
  displaySettings: QdnDisplaySettings,
  isNative: boolean,
  shouldLoad: boolean,
): QdnGalleryImageSource {
  if (!isNative) {
    return {
      kind: 'direct',
      url: buildQdnRenderUrl(resource, nodeApiUrl, displaySettings),
    };
  }

  if (!shouldLoad) {
    return { kind: 'pending' };
  }

  return {
    kind: 'bridge',
    resource: {
      cacheKey: `gallery:${getQdnResourceKey(resource)}`,
      identifier: resource.identifier,
      maxBytes: QDN_GALLERY_IMAGE_MAX_BYTES,
      name: resource.name,
      path: resource.path || undefined,
      service: resource.service,
    },
  };
}
