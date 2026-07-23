import { isLoopbackHostname } from './node-ca-bootstrap.js';

type QdnWriteRouteConnection = {
  apiKey?: string;
  mode: string;
  nodeApiUrl: string;
};

/**
 * How a QDN write reaches the node it was built on.
 *
 * - `local`: the node is on this machine, so Home may post the private key to
 *   /transactions/sign. Loopback is what makes that safe, and nothing else.
 * - `remote-authenticated`: a node the user configured, gave an API key to, and
 *   reaches over https. Home uses the authenticated build endpoints (Core's full
 *   publish limit, and every service) but signs on this machine, so the key
 *   stays here. Requires TLS - see below.
 * - `public`: an untrusted node. Only the keyless /arbitrary/public builders
 *   are used, and what they staged is verified before anything is signed.
 */
export type QdnWriteRoute = 'local' | 'public' | 'remote-authenticated';

export function resolveQdnWriteRoute(connection: QdnWriteRouteConnection): QdnWriteRoute {
  if (connection.mode === 'network') {
    return 'public';
  }

  let url: URL;

  try {
    url = new URL(connection.nodeApiUrl);
  } catch {
    return 'public';
  }

  if (isLoopbackHostname(url.hostname)) {
    return 'local';
  }

  // A remote node without a saved API key cannot answer the authenticated
  // endpoints at all, so it is treated as any other untrusted node.
  if (!connection.apiKey?.trim()) {
    return 'public';
  }

  // The authenticated route trades content attestation for Core's full publish
  // limit: only the /arbitrary/public builders register artifacts, so afterwards
  // nothing re-verifies that the node staged the bytes we actually sent. Over TLS
  // the only party who could substitute content is the node operator, who already
  // holds our API key - the same trust a local node gets. Over plaintext it is
  // also anyone on the path, which is a different and much weaker proposition, so
  // a plaintext remote node stays on the attested public route instead.
  return url.protocol === 'https:' ? 'remote-authenticated' : 'public';
}

/**
 * Whether a write may still be submitted to the node it was built against.
 *
 * A locally signed write computes proof-of-work first, which takes long enough
 * for the user to change nodes underneath it. The transaction is bound to the
 * node that built it, so both the address and the route have to be unchanged —
 * a route change means a different set of endpoints and a different amount of
 * trust, even when the address is the same.
 */
export function isSameQdnWriteRoute(
  connection: QdnWriteRouteConnection,
  expected: QdnWriteRouteConnection,
) {
  return (
    connection.nodeApiUrl === expected.nodeApiUrl &&
    resolveQdnWriteRoute(connection) === resolveQdnWriteRoute(expected)
  );
}
