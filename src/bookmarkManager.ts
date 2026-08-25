import {
  BOOKMARK_MANAGER_SCHEMA_VERSION,
  validateBookmarkManagerMutation,
  validateBookmarkManagerSnapshot,
  type BookmarkManagerAccountChoice,
  type BookmarkManagerLink,
  type BookmarkManagerMutation,
  type BookmarkManagerMutationResult,
  type BookmarkManagerSnapshot,
  type BookmarkManagerTreeItem,
} from '../electron/bookmark-manager-contract';
import {
  addBookmark,
  addBookmarkFolder,
  findBookmarkItem,
  moveBookmarkItem,
  removeBookmark,
  setBookmarkToolbarVisibility,
  updateBookmark,
  updateBookmarkFolder,
  type BookmarksState,
} from './bookmarks';
import {
  createDashboardPin,
  removeDashboardPin,
  reorderDashboardPins,
  updateDashboardPin,
  upsertDashboardPin,
  type DashboardPin,
} from './dashboardPins';
import { addStartPage, removeStartPage, updateStartPage, type StartPage } from './startPages';

// Permission-scoped account choices for the calling manager app. Omitted for
// callers (disk persistence, legacy migration) that don't need them; when
// present, `activeAccountId: null` means Home's built-in "Current" account.
export type BookmarkManagerCollectionsAccounts = {
  activeAccountId: string | null;
  availableAccounts: BookmarkManagerAccountChoice[];
};

export type BookmarkManagerCollections = {
  accounts?: BookmarkManagerCollectionsAccounts;
  bookmarksState: BookmarksState;
  dashboardPins: DashboardPin[];
  revision: number;
  startPages: StartPage[];
};

export type BookmarkManagerApplyResult = BookmarkManagerMutationResult & {
  collections: BookmarkManagerCollections;
};

export function createBookmarkManagerSnapshot(collections: BookmarkManagerCollections): BookmarkManagerSnapshot {
  return validateBookmarkManagerSnapshot({
    schemaVersion: BOOKMARK_MANAGER_SCHEMA_VERSION,
    revision: collections.revision,
    bookmarks: collections.bookmarksState.bookmarks,
    toolbar: collections.bookmarksState.toolbar,
    toolbarVisibility: collections.bookmarksState.toolbarVisibility,
    dashboardPins: collections.dashboardPins,
    startPages: collections.startPages,
    ...(collections.accounts ? {
      activeAccountId: collections.accounts.activeAccountId,
      availableAccounts: collections.accounts.availableAccounts,
    } : {}),
  });
}

function reorderStartPages(current: StartPage[], itemId: string, targetItemId: string, position: 'after' | 'before') {
  if (itemId === targetItemId) return current;
  const item = current.find((candidate) => candidate.displayUrl === itemId);
  if (!item) return current;
  const remaining = current.filter((candidate) => candidate.displayUrl !== itemId);
  const targetIndex = remaining.findIndex((candidate) => candidate.displayUrl === targetItemId);
  if (targetIndex < 0) return current;
  const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
  return [...remaining.slice(0, insertIndex), item, ...remaining.slice(insertIndex)];
}

function getMovePayload(collections: BookmarkManagerCollections, mutation: Extract<BookmarkManagerMutation, { type: 'moveItem' }>) {
  if (mutation.sourceRootId === 'pins') {
    const pin = collections.dashboardPins.find((candidate) => candidate.id === mutation.itemId);
    return pin ? { accountId: pin.accountId ?? null, displayUrl: pin.displayUrl, title: pin.customLabel || pin.label } : null;
  }
  if (mutation.sourceRootId === 'startPages') {
    const page = collections.startPages.find((candidate) => candidate.displayUrl === mutation.itemId);
    return page ? { accountId: page.accountId, displayUrl: page.displayUrl, title: page.title || page.displayUrl } : null;
  }
  const item = findBookmarkItem(collections.bookmarksState[mutation.sourceRootId], mutation.itemId);
  return item?.type === 'bookmark'
    ? { accountId: item.accountId ?? null, displayUrl: item.displayUrl, title: item.title }
    : null;
}

function removeMoveSource(collections: BookmarkManagerCollections, mutation: Extract<BookmarkManagerMutation, { type: 'moveItem' }>) {
  if (mutation.sourceRootId === 'pins') {
    return { ...collections, dashboardPins: removeDashboardPin(collections.dashboardPins, mutation.itemId) };
  }
  if (mutation.sourceRootId === 'startPages') {
    return { ...collections, startPages: removeStartPage(collections.startPages, mutation.itemId) };
  }
  return {
    ...collections,
    bookmarksState: removeBookmark(collections.bookmarksState, mutation.sourceRootId, mutation.itemId),
  };
}

function applyMove(collections: BookmarkManagerCollections, mutation: Extract<BookmarkManagerMutation, { type: 'moveItem' }>) {
  if (
    (mutation.sourceRootId === 'bookmarks' || mutation.sourceRootId === 'toolbar') &&
    (mutation.targetRootId === 'bookmarks' || mutation.targetRootId === 'toolbar')
  ) {
    return {
      ...collections,
      bookmarksState: moveBookmarkItem(collections.bookmarksState, {
        itemId: mutation.itemId,
        sourceRootId: mutation.sourceRootId,
        targetFolderId: mutation.targetFolderId,
        targetItemId: mutation.targetItemId,
        targetPosition: mutation.targetPosition,
        targetRootId: mutation.targetRootId,
      }),
    };
  }

  if (mutation.sourceRootId === mutation.targetRootId) {
    if (mutation.sourceRootId === 'pins' && mutation.targetItemId) {
      return {
        ...collections,
        dashboardPins: reorderDashboardPins(
          collections.dashboardPins,
          mutation.itemId,
          mutation.targetItemId,
          mutation.targetPosition === 'before' ? 'before' : 'after',
        ),
      };
    }
    if (mutation.sourceRootId === 'startPages' && mutation.targetItemId) {
      return {
        ...collections,
        startPages: reorderStartPages(
          collections.startPages,
          mutation.itemId,
          mutation.targetItemId,
          mutation.targetPosition === 'before' ? 'before' : 'after',
        ),
      };
    }
    return collections;
  }

  const payload = getMovePayload(collections, mutation);
  if (!payload) return collections;

  let next = collections;
  if (mutation.targetRootId === 'pins') {
    const pin = createDashboardPin(payload.displayUrl, payload.title, payload.accountId);
    if (!pin) return collections;
    const dashboardPins = upsertDashboardPin(collections.dashboardPins, pin);
    if (dashboardPins === collections.dashboardPins) return collections;
    next = { ...collections, dashboardPins };
  } else if (mutation.targetRootId === 'startPages') {
    const startPages = addStartPage(collections.startPages, payload.displayUrl, payload.accountId, payload.title);
    if (startPages === collections.startPages) return collections;
    next = { ...collections, startPages };
  } else {
    const bookmarksState = addBookmark(
      collections.bookmarksState,
      mutation.targetRootId,
      payload,
      mutation.targetFolderId,
    );
    if (bookmarksState === collections.bookmarksState) return collections;
    next = { ...collections, bookmarksState };
  }
  return removeMoveSource(next, mutation);
}

function applyValidatedMutation(collections: BookmarkManagerCollections, mutation: BookmarkManagerMutation) {
  switch (mutation.type) {
    case 'addTreeLink':
      return { ...collections, bookmarksState: addBookmark(collections.bookmarksState, mutation.rootId, mutation.link, mutation.parentFolderId) };
    case 'addTreeFolder':
      return { ...collections, bookmarksState: addBookmarkFolder(collections.bookmarksState, mutation.rootId, { title: mutation.title }, mutation.parentFolderId) };
    case 'updateTreeLink':
      return { ...collections, bookmarksState: updateBookmark(collections.bookmarksState, mutation.rootId, mutation.itemId, mutation.link) };
    case 'updateTreeFolder':
      return { ...collections, bookmarksState: updateBookmarkFolder(collections.bookmarksState, mutation.rootId, mutation.itemId, { title: mutation.title }) };
    case 'removeTreeItem':
      return { ...collections, bookmarksState: removeBookmark(collections.bookmarksState, mutation.rootId, mutation.itemId) };
    case 'addDashboardPin': {
      const pin = createDashboardPin(mutation.pin.displayUrl, mutation.pin.title, mutation.pin.accountId);
      return pin ? { ...collections, dashboardPins: upsertDashboardPin(collections.dashboardPins, pin) } : collections;
    }
    case 'updateDashboardPin':
      return { ...collections, dashboardPins: updateDashboardPin(collections.dashboardPins, mutation.pinId, mutation.pin) };
    case 'removeDashboardPin':
      return { ...collections, dashboardPins: removeDashboardPin(collections.dashboardPins, mutation.pinId) };
    case 'addStartPage':
      return { ...collections, startPages: addStartPage(collections.startPages, mutation.page.displayUrl, mutation.page.accountId ?? null, mutation.page.title) };
    case 'updateStartPage':
      return { ...collections, startPages: updateStartPage(collections.startPages, mutation.displayUrl, mutation.page) };
    case 'removeStartPage':
      return { ...collections, startPages: removeStartPage(collections.startPages, mutation.displayUrl) };
    case 'moveItem':
      return applyMove(collections, mutation);
    case 'setToolbarVisibility':
      return { ...collections, bookmarksState: setBookmarkToolbarVisibility(collections.bookmarksState, mutation.toolbarVisibility) };
  }
}

export function applyBookmarkManagerMutation(
  collections: BookmarkManagerCollections,
  requestedMutation: unknown,
): BookmarkManagerApplyResult {
  const mutation = validateBookmarkManagerMutation(requestedMutation);
  const next = applyValidatedMutation(collections, mutation);
  const changed = JSON.stringify({
    bookmarksState: next.bookmarksState,
    dashboardPins: next.dashboardPins,
    startPages: next.startPages,
  }) !== JSON.stringify({
    bookmarksState: collections.bookmarksState,
    dashboardPins: collections.dashboardPins,
    startPages: collections.startPages,
  });
  const finalCollections = changed ? { ...next, revision: collections.revision + 1 } : collections;
  return {
    changed,
    collections: finalCollections,
    snapshot: createBookmarkManagerSnapshot(finalCollections),
  };
}

/**
 * Finds a saved bookmark for `displayUrl` in the toolbar or the bookmarks
 * tree, reporting which root holds it. `removeTreeItem` needs the root as
 * well as the item id, and ids are minted per-add rather than derived from
 * the address, so a star toggle has to look the item up by address first.
 *
 * The toolbar is searched before the bookmarks tree so that un-starring a
 * page that sits on the toolbar removes it from where the user can see it.
 */
export function locateBookmarkManagerLink(
  snapshot: Pick<BookmarkManagerSnapshot, 'bookmarks' | 'toolbar'>,
  displayUrl: string,
): { readonly link: BookmarkManagerLink; readonly rootId: 'bookmarks' | 'toolbar' } | null {
  const search = (
    items: readonly BookmarkManagerTreeItem[],
  ): BookmarkManagerLink | null => {
    for (const item of items) {
      if (item.type === 'folder') {
        const nested = search(item.children);
        if (nested) return nested;
        continue;
      }
      if (item.displayUrl === displayUrl) return item;
    }
    return null;
  };

  const onToolbar = search(snapshot.toolbar);
  if (onToolbar) return { link: onToolbar, rootId: 'toolbar' };
  const saved = search(snapshot.bookmarks);
  return saved ? { link: saved, rootId: 'bookmarks' } : null;
}
