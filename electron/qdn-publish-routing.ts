type QdnPublishRouteResource = {
  service: string;
};

type QdnPublishRouteSource = {
  isZip?: boolean;
  path?: string;
};

const QDN_ARCHIVE_RENDER_SERVICES = new Set(['APP', 'WEBSITE']);

/**
 * Path-backed sources bypass Home's inline base64 ZIP detection. Route archive
 * sources through Core's streamed upload endpoint so Core receives isZip=true
 * and unpacks them before validating the service content.
 */
export function shouldUseQdnLocalArchiveUpload(
  resource: QdnPublishRouteResource,
  source: QdnPublishRouteSource,
) {
  return !!source.path && source.isZip === true && QDN_ARCHIVE_RENDER_SERVICES.has(resource.service);
}
