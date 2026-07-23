type QdnPublishRouteResource = {
  service: string;
};

type QdnPublishRouteSource = {
  isZip?: boolean;
  path?: string;
};

const QDN_ARCHIVE_RENDER_SERVICES = new Set(['APP', 'WEBSITE']);

/**
 * Core resolves a posted filesystem path against its OWN filesystem, so a node
 * that does not share this machine's disk (SSH tunnel, direct IP) looks for a
 * file that exists only here and fails. Every path-backed source is therefore
 * streamed to Core's upload endpoint instead of being described to it.
 */
export function shouldStreamQdnPublishSource(source: QdnPublishRouteSource) {
  return !!source.path;
}

/**
 * Only the archive-rendering services expect Core to unpack the upload before
 * publishing it. For every other service a ZIP is the resource itself, so it
 * has to be stored exactly as it was selected.
 */
export function shouldUnpackQdnPublishArchive(
  resource: QdnPublishRouteResource,
  source: QdnPublishRouteSource,
) {
  return source.isZip === true && QDN_ARCHIVE_RENDER_SERVICES.has(resource.service);
}
