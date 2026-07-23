export const PUBLIC_QDN_SERVICES = [
  'APP',
  'WEBSITE',
  'IMAGE',
  'THUMBNAIL',
  'QCHAT_IMAGE',
  'VIDEO',
  'AUDIO',
  'VOICE',
  'PODCAST',
  'DOCUMENT',
  'FILE',
  'FILES',
  'JSON',
  'METADATA',
  'BLOG',
  'BLOG_POST',
  'BLOG_COMMENT',
  'LIST',
  'PLAYLIST',
  'GIT_REPOSITORY',
  'GIF_REPOSITORY',
  'IMAGE_GALLERY',
  'STORE',
  'PRODUCT',
  'OFFER',
  'COUPON',
  'CODE',
  'PLUGIN',
  'EXTENSION',
  'GAME',
  'ITEM',
  'NFT',
  'DATABASE',
  'SNAPSHOT',
  'COMMENT',
  'CHAIN_COMMENT',
  'CHAIN_DATA',
  'ATTACHMENT',
  'MAIL',
  'MESSAGE',
] as const;

export type PublicQdnService = (typeof PUBLIC_QDN_SERVICES)[number];

const PUBLIC_QDN_SERVICE_SET = new Set<string>(PUBLIC_QDN_SERVICES);

export function isPublicQdnService(value: string): value is PublicQdnService {
  return PUBLIC_QDN_SERVICE_SET.has(value);
}

// Core marks its encrypted services with a `_PRIVATE` suffix (APP_PRIVATE,
// IMAGE_GALLERY_PRIVATE, ...). Home cannot decrypt these yet, so it recognizes
// them only to show a clear "not supported" message instead of treating the
// address as an unknown service.
export function isPrivateQdnService(value: string) {
  return /^[A-Z0-9_]+_PRIVATE$/.test(value);
}
