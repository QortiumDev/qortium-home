// Decides whether Home may learn a node's certificate authority over plaintext
// http.
//
// Core only serves /admin/http/getca and /admin/http/createca over http, so the
// very first contact with an https node cannot itself be authenticated:
// whoever answers that request decides which authority Home pins from then on,
// and /admin/http/createca carries the API key. Over loopback that is fine -
// there is no network path to intercept. Anywhere else it hands an on-path
// attacker both a permanently trusted authority and the API key, so this
// module is the single place allowed to produce those plaintext URLs, and it
// refuses to produce them for a remote host.

const GET_CA_PATH = '/admin/http/getca';
const CREATE_CA_PATH = '/admin/http/createca';

export type NodeCaBootstrapPlan =
  | { kind: 'not-required' }
  | { createCaUrl: string; getCaUrl: string; kind: 'plaintext' }
  | { kind: 'refused'; reason: string };

export function normalizeHostname(hostname: string) {
  const host = hostname.trim().toLowerCase();

  if (host.startsWith('[') && host.endsWith(']')) {
    return host.slice(1, -1);
  }

  return host;
}

// Shared with the QDN write guard: one notion of "this machine" decides both
// which nodes may receive local-only requests and which may be bootstrapped
// over plaintext.
export function isLoopbackHostname(hostname: string) {
  const host = normalizeHostname(hostname);

  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

export function canReplayNodeFetchAfterCaRefresh(
  requestMethod?: string,
  overrideMethod?: string,
) {
  const method = (overrideMethod || requestMethod || 'GET').trim().toUpperCase();

  return method === 'GET' || method === 'HEAD';
}

export function isExactNodeCaResponseUrl(requestUrl: string, responseUrl: string) {
  // Electron's net.fetch currently leaves Response.url empty even for a direct
  // successful response. Callers must also set redirect:'error'; with redirects
  // forbidden, an empty URL means there is no contradictory final URL to reject.
  if (!responseUrl) {
    return true;
  }

  try {
    return new URL(requestUrl).toString() === new URL(responseUrl).toString();
  } catch {
    return false;
  }
}

function buildHttpCaUrl(url: URL, pathname: string) {
  const caUrl = new URL(url.toString());
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');

  caUrl.protocol = 'http:';
  caUrl.port = port;
  caUrl.pathname = pathname;
  caUrl.search = '';
  caUrl.hash = '';

  return caUrl.toString();
}

export function planNodeCaBootstrap(url: URL): NodeCaBootstrapPlan {
  // A plain http node is not verified against a pinned authority at all, so
  // there is nothing to bootstrap.
  if (url.protocol !== 'https:') {
    return { kind: 'not-required' };
  }

  if (!isLoopbackHostname(url.hostname)) {
    return {
      kind: 'refused',
      reason:
        `Home will not fetch a certificate authority from ${url.host} over plaintext http: ` +
        'anyone between this machine and the node could supply their own authority, which Home ' +
        'would then trust permanently, and could read the API key. A remote https node must ' +
        'present a certificate this machine already trusts.',
    };
  }

  return {
    createCaUrl: buildHttpCaUrl(url, CREATE_CA_PATH),
    getCaUrl: buildHttpCaUrl(url, GET_CA_PATH),
    kind: 'plaintext',
  };
}
