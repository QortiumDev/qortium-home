const QDN_RENDER_PREFIX = 'render';
const HOST_ONLY_QUERY_PARAMETERS = new Set([
  'accent',
  'lang',
  'qdnHomeBridge',
  'textSize',
  'theme',
  'uiStyle',
]);

type QdnAppIdentity = {
  baseDisplayUrl: string;
  identifier: string | null;
  name: string;
  service: string;
};

function decodeSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseQdnAppIdentity(displayUrl: string): QdnAppIdentity | null {
  let url: URL;

  try {
    url = new URL(displayUrl);
  } catch {
    return null;
  }

  if (url.protocol !== 'qdn:') {
    return null;
  }

  const service = decodeSegment(url.hostname).toUpperCase();
  const segments = url.pathname.split('/').filter(Boolean);
  const name = decodeSegment(segments[0] ?? '');
  const rawIdentifier = decodeSegment(segments[1] ?? '');
  const identifier = rawIdentifier && rawIdentifier.toLowerCase() !== 'default' ? rawIdentifier : null;

  if (!service || !name || segments.length < 2) {
    return null;
  }

  return {
    baseDisplayUrl: `qdn://${service}/${encodeURIComponent(name)}/${encodeURIComponent(identifier ?? 'default')}`,
    identifier,
    name,
    service,
  };
}

/**
 * Convert a node render location into a copyable qdn:// address for the same
 * app that Home originally opened. The stable QDN identity comes from Home's
 * route, never from app-controlled location data.
 */
export function getLiveQdnDisplayUrl(resourceDisplayUrl: string, renderLocation: string): string | null {
  const identity = parseQdnAppIdentity(resourceDisplayUrl);

  if (!identity) {
    return null;
  }

  let renderUrl: URL;

  try {
    renderUrl = new URL(renderLocation);
  } catch {
    return null;
  }

  if (renderUrl.protocol !== 'http:' && renderUrl.protocol !== 'https:') {
    return null;
  }

  const segments = renderUrl.pathname.split('/').filter(Boolean);
  const renderPrefix = decodeSegment(segments.shift() ?? '').toLowerCase();
  const service = decodeSegment(segments.shift() ?? '').toUpperCase();
  const name = decodeSegment(segments.shift() ?? '');

  if (renderPrefix !== QDN_RENDER_PREFIX || service !== identity.service || name !== identity.name) {
    return null;
  }

  if (identity.identifier) {
    const identifier = decodeSegment(segments.shift() ?? '');

    if (identifier !== identity.identifier) {
      return null;
    }
  }

  const query = new URLSearchParams(renderUrl.search);

  for (const parameter of HOST_ONLY_QUERY_PARAMETERS) {
    query.delete(parameter);
  }

  const path = segments.join('/');
  const queryString = query.toString();
  // Home's qdn:// route parser does not currently model URL fragments, so a
  // render-only hash is deliberately omitted. Query-only app routes retain the
  // established no-slash form: qdn://APP/Name/Identifier?key=value.
  const suffix = path
    ? `/${path}${queryString ? `?${queryString}` : ''}`
    : queryString
      ? `?${queryString}`
      : '/';

  return `${identity.baseDisplayUrl}${suffix}`;
}
