import { createHash } from 'node:crypto';
import { sanitizeQdnCapabilityPrincipal } from './qdn-manager-permissions.js';

/**
 * The identity a partition is derived from, as an unambiguous string.
 *
 * Built from the canonical app PRINCIPAL rather than the raw resource URL, so
 * two URLs naming the same app (differing only by an in-app route, a hash, or
 * a query the principal drops) keep one storage partition — exactly as they
 * already share one durable grant.
 *
 * When a principal cannot be derived — no resource URL at all, or one that is
 * not a parseable APP/WEBSITE resource — the RAW value is used instead, tagged
 * so it can never equal a canonical principal. That is fail-closed: two
 * different unparseable URLs still get different partitions rather than
 * collapsing onto a shared one.
 *
 * JSON-encoded rather than joined with a delimiter, because that is
 * unambiguous for free: no origin or principal can be crafted so that one pair
 * of inputs serializes identically to a different pair.
 */
function qdnViewPartitionIdentity(nodeOrigin: string, resourceUrl: string | null): string {
  const principal = qdnViewPrincipal(resourceUrl);
  const resource: readonly [string, string] = principal !== null
    ? ['principal', principal]
    : resourceUrl === null
      ? ['none', '']
      : ['raw', resourceUrl];
  return JSON.stringify([nodeOrigin, ...resource]);
}

/**
 * The Chromium partition a QDN app view runs in.
 *
 * This is the real browser-storage boundary: cookies, localStorage,
 * sessionStorage and IndexedDB all belong to the partition, not to the tab or
 * the window. Two views sharing a partition can read each other's storage
 * under the same origin, so two different apps must never be handed the same
 * partition name.
 *
 * The name is a SHA-256 digest of the identity above. It used to be that
 * identity run through a character replacement and truncated to 60 characters,
 * which is not injective: two different apps could land on one partition name
 * either by agreeing on their first 60 characters, or by differing only in
 * characters the replacement folded onto the same '_'. Either collision puts
 * two apps in one storage jar. A digest cannot collide by construction, and
 * nothing here needs the name to be readable.
 *
 * The full 256-bit hex digest is used. Do not truncate it below 128 bits, and
 * do not move any part of the identity into the readable `persist:qdn-`
 * prefix: the prefix names the scheme, the digest carries all the uniqueness.
 *
 * CONSEQUENCE, accepted deliberately: this changes every existing partition
 * name once, so apps lose their site storage (localStorage, cookies,
 * IndexedDB) a single time when a user moves onto this build. Home 2.1 is
 * pre-release, and a correct isolation boundary outranks storage continuity;
 * one reset is the whole cost.
 */
export function getQdnViewPartition(nodeOrigin: string, resourceUrl: string | null): string {
  const digest = createHash('sha256')
    .update(qdnViewPartitionIdentity(nodeOrigin, resourceUrl), 'utf8')
    .digest('hex');
  return `persist:qdn-${digest}`;
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
 * - the same provable canonical app principal (the PRIMARY check: it is the
 *   identity permissions are keyed by, so a view is never reused across a
 *   boundary the permission system treats as two different apps), and
 * - the same partition a freshly created view would be given.
 *
 * The partition check is now implied by the principal check, since the
 * partition is derived from that principal — it is kept as a standing
 * assertion that the two never drift apart, and it is only sound BECAUSE the
 * partition name is a digest. While partition names were truncated strings it
 * could pass for two genuinely different apps, so it must never be relied on
 * as the primary test.
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
  const existingPrincipal = qdnViewPrincipal(existing.resourceUrl);
  if (existingPrincipal === null || existingPrincipal !== qdnViewPrincipal(request.resourceUrl)) {
    return false;
  }
  return (
    getQdnViewPartition(existing.nodeOrigin, existing.resourceUrl) ===
    getQdnViewPartition(request.nodeOrigin, request.resourceUrl)
  );
}
