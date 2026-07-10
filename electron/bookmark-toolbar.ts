export const BOOKMARK_TOOLBAR_VISIBILITIES = ['always', 'dashboard', 'hidden'] as const;
export const BOOKMARKS_STATE_VERSION = 3;

export type BookmarkToolbarVisibility = (typeof BOOKMARK_TOOLBAR_VISIBILITIES)[number];

export function isBookmarkTreeStateVersion(value: unknown) {
  return value === 2 || value === BOOKMARKS_STATE_VERSION;
}

export function normalizeBookmarkToolbarVisibility(
  value: unknown,
  legacyToolbarVisible?: unknown,
): BookmarkToolbarVisibility {
  if (BOOKMARK_TOOLBAR_VISIBILITIES.includes(value as BookmarkToolbarVisibility)) {
    return value as BookmarkToolbarVisibility;
  }

  return legacyToolbarVisible === true ? 'always' : 'hidden';
}

export function shouldShowBookmarkToolbar(
  visibility: BookmarkToolbarVisibility,
  isDashboardRoute: boolean,
) {
  return visibility === 'always' || (visibility === 'dashboard' && isDashboardRoute);
}
