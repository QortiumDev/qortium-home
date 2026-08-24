// Renderer-facing bookmark-toolbar value contract. The underlying module is
// deliberately pure (no Electron imports); keeping this adapter outside v2
// prevents shell components from reaching directly into the Electron tree.
export {
  BOOKMARKS_STATE_VERSION,
  BOOKMARK_TOOLBAR_VISIBILITIES,
  isBookmarkTreeStateVersion,
  normalizeBookmarkToolbarVisibility,
  shouldShowBookmarkToolbar,
  type BookmarkToolbarVisibility,
} from '../electron/bookmark-toolbar'
