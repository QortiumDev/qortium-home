import assert from 'node:assert/strict';
import { getQdnGalleryImageSource, QDN_GALLERY_IMAGE_MAX_BYTES } from './qdnGalleryImage';
import type { QdnDisplaySettings, QdnResource } from './qdn';

const resource: QdnResource = {
  displayUrl: 'qdn://IMAGE_GALLERY/QortiumHomeTest/wallet-minted-coin-preview/aave-minted.png',
  identifier: 'wallet-minted-coin-preview',
  name: 'QortiumHomeTest',
  path: 'aave-minted.png',
  service: 'IMAGE_GALLERY',
};
const displaySettings: QdnDisplaySettings = {
  accent: 'blue',
  language: 'en',
  textSize: 'medium',
  theme: 'dark',
  ui: 'classic',
};
const nodeApiUrl = 'http://80.241.221.139:24891';

const desktop = getQdnGalleryImageSource(resource, nodeApiUrl, displaySettings, false, false);
assert.equal(desktop.kind, 'direct');
assert.match(desktop.kind === 'direct' ? desktop.url : '', /^http:\/\/80\.241\.221\.139:24891\/render\//);

assert.deepEqual(
  getQdnGalleryImageSource(resource, nodeApiUrl, displaySettings, true, false),
  { kind: 'pending' },
);

const native = getQdnGalleryImageSource(resource, nodeApiUrl, displaySettings, true, true);
assert.equal(native.kind, 'bridge');
if (native.kind === 'bridge') {
  assert.equal(native.resource.cacheKey, 'gallery:IMAGE_GALLERY:QortiumHomeTest:wallet-minted-coin-preview:aave-minted.png');
  assert.equal(native.resource.maxBytes, QDN_GALLERY_IMAGE_MAX_BYTES);
  assert.equal(native.resource.path, 'aave-minted.png');
}

console.log('QDN gallery image source tests passed.');
