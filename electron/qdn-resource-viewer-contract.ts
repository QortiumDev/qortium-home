import { isQdnBrowserArchiveService } from './qdn-browser-archive-services.js';
import {
  getRequestValue,
  getRequiredRequestString,
  getService,
  getString,
  type QdnAppRequest,
} from './qdn-request-values.js';

export const QDN_RESOURCE_VIEWER_ACTIONS = [
  'GET_QDN_RESOURCE_STREAM_URL',
  'OPEN_QDN_RESOURCE_VIEWER',
] as const;

export const QDN_STREAMABLE_SERVICES = [
  'IMAGE',
  'THUMBNAIL',
  'QCHAT_IMAGE',
  'AUDIO',
  'VOICE',
  'PODCAST',
  'VIDEO',
  // A publisher may put media under one of the generic file services. Content
  // detection remains the app's responsibility when it requests a stream URL.
  'DOCUMENT',
  'FILE',
  'FILES',
  'ATTACHMENT',
] as const;

export type QdnStreamableService = (typeof QDN_STREAMABLE_SERVICES)[number];

export type QdnResourceViewerRequest = {
  filename: string | null;
  identifier: string | null;
  mimeType: string | null;
  name: string;
  path: string | null;
  service: string;
};

const QDN_STREAMABLE_SERVICE_SET = new Set<string>(QDN_STREAMABLE_SERVICES);
const QDN_RESOURCE_VIEWER_FIELD_MAX_LENGTH = 1024;
const QDN_SAFE_RASTER_IMAGE_MIME_TYPES = new Set([
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const QDN_STREAM_MIME_TYPES_BY_EXTENSION = new Map([
  ['.aac', 'audio/aac'],
  ['.avif', 'image/avif'],
  ['.bmp', 'image/bmp'],
  ['.flac', 'audio/flac'],
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.m4a', 'audio/mp4'],
  ['.mp3', 'audio/mpeg'],
  ['.mp4', 'video/mp4'],
  ['.oga', 'audio/ogg'],
  ['.ogg', 'audio/ogg'],
  ['.ogv', 'video/ogg'],
  ['.opus', 'audio/ogg'],
  ['.png', 'image/png'],
  ['.wav', 'audio/wav'],
  ['.webm', 'video/webm'],
  ['.webp', 'image/webp'],
]);

export function isQdnStreamableService(service: string): service is QdnStreamableService {
  return QDN_STREAMABLE_SERVICE_SET.has(service);
}

export function getQdnResourceViewerRequest(request: QdnAppRequest): QdnResourceViewerRequest {
  const service = getService(getRequestValue(request, 'service'));

  if (!service) {
    throw new Error('QDN resource service is required.');
  }

  if (isQdnBrowserArchiveService(service)) {
    throw new Error(
      'APP, WEBSITE, and GAME resources must use OPEN_NEW_TAB or OPEN_CURRENT_TAB instead of the embedded resource viewer.',
    );
  }

  const name = getRequiredRequestString(request, 'name', 'Name');
  const identifier = getString(getRequestValue(request, 'identifier'));
  const resourcePath =
    getString(getRequestValue(request, 'path')) ||
    getString(getRequestValue(request, 'filepath'));
  const filename = getString(getRequestValue(request, 'filename'));
  const mimeType = getString(getRequestValue(request, 'mimeType'));

  for (const [label, value] of [
    ['name', name],
    ['identifier', identifier],
    ['path', resourcePath],
    ['filename', filename],
    ['mimeType', mimeType],
  ] as const) {
    if (value.length > QDN_RESOURCE_VIEWER_FIELD_MAX_LENGTH) {
      throw new Error(`QDN resource viewer ${label} is too long.`);
    }
  }

  return {
    filename: filename || null,
    identifier: identifier || null,
    mimeType: mimeType || null,
    name,
    path: resourcePath || null,
    service,
  };
}

export function getQdnResourceStreamRequest(request: QdnAppRequest): QdnResourceViewerRequest {
  const resource = getQdnResourceViewerRequest(request);

  if (!isQdnStreamableService(resource.service)) {
    throw new Error(
      'GET_QDN_RESOURCE_STREAM_URL only supports image, audio, video, document, file, and attachment services.',
    );
  }

  return resource;
}

/**
 * Returns a non-scriptable MIME hint for Android's secure QDN stream proxy.
 *
 * Core's render endpoint does not always send Content-Type for binary resources.
 * Android WebView then treats the intercepted response as HTML and its media
 * pipeline stalls. Keep the hint narrow: a QDN app must not be able to label a
 * generic FILE as HTML or SVG and execute it in the stable proxy origin.
 */
export function getQdnResourceStreamProxyMimeType(resource: QdnResourceViewerRequest): string | null {
  const service = resource.service.toUpperCase();
  const requestedMimeType = resource.mimeType?.split(';', 1)[0].trim().toLowerCase() || '';
  const filename = resource.filename || resource.path || '';
  const filenameLower = filename.toLowerCase();
  const extensionMimeType = [...QDN_STREAM_MIME_TYPES_BY_EXTENSION.entries()]
    .find(([extension]) => filenameLower.endsWith(extension))?.[1] || '';
  const mimeType = requestedMimeType || extensionMimeType;
  const isAudio = mimeType.startsWith('audio/');
  const isVideo = mimeType.startsWith('video/');
  const isRasterImage = QDN_SAFE_RASTER_IMAGE_MIME_TYPES.has(mimeType);

  if (['AUDIO', 'VOICE', 'PODCAST'].includes(service)) {
    return isAudio ? mimeType : null;
  }

  if (service === 'VIDEO') {
    return isVideo ? mimeType : null;
  }

  if (['IMAGE', 'THUMBNAIL', 'QCHAT_IMAGE'].includes(service)) {
    return isRasterImage ? mimeType : null;
  }

  return isAudio || isVideo || isRasterImage ? mimeType : null;
}
