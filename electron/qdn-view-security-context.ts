import { sanitizeQdnCapabilityPrincipal } from './qdn-manager-permissions.js';

/**
 * The Chromium partition a QDN app view runs in.
 *
 * This is the real browser-storage boundary: cookies, localStorage,
 * sessionStorage and IndexedDB all belong to the partition, not to the tab or
 * the window. Two views in the same partition can read each other's storage
 * under the same origin.
 *
 * Keyed by the node origin AND the app's stable QDN resource URL (e.g.
 * "qdn://APP/walletium/default"), so one app keeps its storage across tabs,
 * windows and restarts while a different app never sees it.
 */
export function getQdnViewPartition(nodeOrigin: string, resourceUrl: string | null): string {
  const safeOrigin = nodeOrigin.replace(/[^a-z0-9:.-]/gi, '_').slice(0, 40);
  if (resourceUrl) {
    // resourceUrl is a stable QDN URL (e.g. "qdn://APP/walletium/default")
    // that identifies the app regardless of which tab or window opened it.
    const safeResource = resourceUrl.replace(/[^a-z0-9:/._-]/gi, '_').slice(0, 60);
    return `persist:qortium-home-${safeOrigin}-${safeResource}`;
  }
  return `persist:qortium-home-${safeOrigin}`;
}

/**
 * The canonical app principal of a view, or null when it cannot be proven.
 *
 * Deliberately the SAME identity durable capability grants are keyed by
 * (sanitizeQdnCapabilityPrincipal), so a view is never reused across a
 * boundary the permission system already treats as two different apps. That
 * function resolves the effective `?identifier=` the runtime would serve and
 * throws on anything unparseable; throwing is mapped to null here, which the
 * caller treats as "cannot prove sameness" and therefore rebuilds.
 */
function qdnViewPrincipal(resourceUrl: string | null): string | null {
  if (!resourceUrl) return null;
  try {
    return sanitizeQdnCapabilityPrincipal(resourceUrl);
  } catch {
    return null;
  }
}

/**
 * Whether an existing app view may be REUSED for a show request, or must be
 * torn down and rebuilt the way opening a fresh tab would build it.
 *
 * A QDN app view is a security context, not a container. Until OPEN_CURRENT_TAB
 * a tab's `resourceUrl` never changed after the tab was created, so comparing
 * the node origin alone was a sufficient reuse test. It is not any more:
 * replacing a tab's app while keeping its view would hand the incoming app the
 * outgoing app's cookies, localStorage and IndexedDB, because the view keeps
 * the partition it was CREATED with (see getQdnViewPartition) no matter what
 * `resourceUrl` is later set to on the entry.
 *
 * Reuse therefore requires all of:
 * - the same node origin,
 * - the same partition a freshly created view would be given, and
 * - the same provable canonical app principal.
 *
 * Fails closed: anything it cannot prove identical — an absent, unparseable, or
 * merely different resource URL — is treated as a new security context, so the
 * caller destroys the old view and builds a new one. A byte-identical
 * resourceUrl short-circuits to reuse, which is the ordinary case (every
 * resize, zoom, re-show and suspend/restore of an unchanged tab).
 */
export function canReuseQdnViewEntry(
  existing: { readonly nodeOrigin: string; readonly resourceUrl: string | null },
  request: { readonly nodeOrigin: string; readonly resourceUrl: string | null },
): boolean {
  if (existing.nodeOrigin !== request.nodeOrigin) return false;
  if (existing.resourceUrl === request.resourceUrl) return true;
  if (
    getQdnViewPartition(existing.nodeOrigin, existing.resourceUrl) !==
    getQdnViewPartition(request.nodeOrigin, request.resourceUrl)
  ) {
    return false;
  }
  const existingPrincipal = qdnViewPrincipal(existing.resourceUrl);
  return existingPrincipal !== null && existingPrincipal === qdnViewPrincipal(request.resourceUrl);
}
