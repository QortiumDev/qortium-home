import { sanitizeQdnManagerAppKey } from '../electron/qdn-manager-permissions';

export type PreferredApps = {
  bookmarksManager: string;
  version: 1;
};

export const DEFAULT_PREFERRED_APPS: PreferredApps = {
  bookmarksManager: 'qdn://APP/Bookmarks/Bookmarks',
  version: 1,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Canonical QDN app resource URLs are the only valid preferred app targets. */
export function parsePreferredAppUrl(value: unknown): string {
  return sanitizeQdnManagerAppKey(value);
}

/** Reads an untrusted persisted value, falling back only for invalid entries. */
export function normalizePreferredApps(value: unknown): PreferredApps {
  if (!isRecord(value) || value.version !== 1) return { ...DEFAULT_PREFERRED_APPS };
  try {
    return {
      bookmarksManager: parsePreferredAppUrl(value.bookmarksManager),
      version: 1,
    };
  } catch {
    return { ...DEFAULT_PREFERRED_APPS };
  }
}
