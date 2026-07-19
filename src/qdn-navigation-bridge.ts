import type { QdnAppNavigationSnapshot } from './qdn-app-history.js';

/**
 * Canonicalize an Android iframe bridge snapshot while keeping it confined to
 * the QDN render origin. URL() deliberately preserves path, query, and fragment.
 */
export function normalizeQdnBridgeNavigationSnapshot(
  snapshot: QdnAppNavigationSnapshot,
  renderUrl: string,
): QdnAppNavigationSnapshot | null {
  const allowedOrigin = new URL(renderUrl).origin;
  const entries = snapshot.entries.map((entry) => {
    try {
      const url = new URL(entry.url, renderUrl);

      return url.origin === allowedOrigin
        ? { index: entry.index, url: url.toString() }
        : null;
    } catch {
      return null;
    }
  });

  if (entries.some((entry) => !entry)) {
    return null;
  }

  return {
    activeIndex: snapshot.activeIndex,
    entries: entries.filter((entry): entry is QdnAppNavigationSnapshot['entries'][number] => !!entry),
  };
}
