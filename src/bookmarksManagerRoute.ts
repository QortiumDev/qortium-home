import { DEFAULT_BOOKMARKS_MANAGER_URL } from '../electron/qdn-manager-permissions';
import { parseAppAddress, type AppRoute } from './routes';

export type BookmarksManagerRoute = Extract<AppRoute, { kind: 'resource' }>;

/**
 * Resolves Home's locally chosen bookmarks manager to an embeddable QDN app.
 * A malformed persisted preference must not turn the legacy home://bookmarks
 * address into an arbitrary Home route, so callers retain their native
 * compatibility fallback when this returns null.
 */
export function resolveBookmarksManagerRoute(url: string | null | undefined): BookmarksManagerRoute | null {
  const parsed = parseAppAddress(url ?? DEFAULT_BOOKMARKS_MANAGER_URL);

  return parsed.success && parsed.route.kind === 'resource' ? parsed.route : null;
}

export function replaceLegacyBookmarksRoutes(entries: AppRoute[], managerRoute: BookmarksManagerRoute): AppRoute[] {
  let changed = false;
  const nextEntries = entries.map((entry) => {
    if (entry.kind !== 'bookmarks') return entry;
    changed = true;
    return managerRoute;
  });

  return changed ? nextEntries : entries;
}
