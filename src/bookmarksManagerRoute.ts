import { DEFAULT_BOOKMARKS_MANAGER_URL } from '../electron/qdn-manager-permissions';
import { parseAppAddress, type AppRoute } from './routes';

export type BookmarksManagerRoute = Extract<AppRoute, { kind: 'resource' }>;

/**
 * Resolves Home's locally chosen bookmarks manager to an embeddable QDN app.
 * A malformed persisted preference must not turn the legacy home://bookmarks
 * address into an arbitrary Home route. Fall back to the official manager so
 * the compatibility route never revives Home's retired native page.
 */
export function resolveBookmarksManagerRoute(url: string | null | undefined): BookmarksManagerRoute {
  const parsed = parseAppAddress(url ?? DEFAULT_BOOKMARKS_MANAGER_URL);

  if (parsed.success && parsed.route.kind === 'resource') {
    return parsed.route;
  }

  const fallback = parseAppAddress(DEFAULT_BOOKMARKS_MANAGER_URL);

  if (!fallback.success || fallback.route.kind !== 'resource') {
    throw new Error('The default Bookmarks manager route must be a QDN resource.');
  }

  return fallback.route;
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
