import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { getSavedAccountContext } from './accountContext';

const BOOKMARKS_STORAGE_KEY = 'qortium-home-bookmarks';
const BOOKMARKS_STATE_VERSION = 2;
const MAX_BOOKMARKS_PER_FOLDER = 128;

export type BookmarkFolderId = 'bookmarks' | 'toolbar';
export type BookmarkSpecialRootId = 'pins' | 'startPages';
export type BookmarkRootId = BookmarkSpecialRootId | BookmarkFolderId;
export type BookmarkDropPosition = 'after' | 'before' | 'inside';

export type BookmarkLink = {
  accountId?: string | null;
  createdAt: number;
  displayUrl: string;
  id: string;
  title: string;
  type: 'bookmark';
};

export type BookmarkFolder = {
  children: BookmarkTreeItem[];
  createdAt: number;
  id: string;
  title: string;
  type: 'folder';
};

export type BookmarkTreeItem = BookmarkFolder | BookmarkLink;

export type BookmarksState = {
  bookmarks: BookmarkTreeItem[];
  toolbar: BookmarkTreeItem[];
  toolbarVisible: boolean;
  version: typeof BOOKMARKS_STATE_VERSION;
};

export type BookmarkUpdateRequest = {
  accountId?: string | null;
  displayUrl: string;
  title: string;
};

export type BookmarkFolderRequest = {
  title: string;
};

export type BookmarkMoveRequest = {
  itemId: string;
  sourceRootId: BookmarkFolderId;
  targetFolderId?: string | null;
  targetItemId?: string | null;
  targetRootId: BookmarkFolderId;
  targetPosition?: BookmarkDropPosition;
};

export type BookmarkRootMoveRequest = {
  accountId?: string | null;
  displayUrl?: string;
  itemId: string;
  sourceRootId: BookmarkRootId;
  targetFolderId?: string | null;
  targetItemId?: string | null;
  targetRootId: BookmarkRootId;
  targetPosition?: BookmarkDropPosition;
  title?: string;
};

export const DEFAULT_BOOKMARKS_STATE: BookmarksState = {
  bookmarks: [],
  toolbar: [],
  toolbarVisible: false,
  version: BOOKMARKS_STATE_VERSION,
};

function createBookmarkId(seed: string, type: 'bookmark' | 'folder' = 'bookmark') {
  return `${type}-${Date.now().toString(36)}-${seed.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)}`;
}

function normalizeTitle(title: unknown, fallback: string) {
  const normalized = typeof title === 'string' ? title.trim() : '';
  return normalized || fallback;
}

function normalizeBookmark(value: unknown): BookmarkLink | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const bookmark = value as Partial<BookmarkLink>;
  const displayUrl = typeof bookmark.displayUrl === 'string' ? bookmark.displayUrl.trim() : '';

  if (!displayUrl) {
    return null;
  }

  const normalized: BookmarkLink = {
    createdAt: typeof bookmark.createdAt === 'number' && Number.isFinite(bookmark.createdAt) ? bookmark.createdAt : Date.now(),
    displayUrl,
    id: typeof bookmark.id === 'string' && bookmark.id.trim() ? bookmark.id.trim() : createBookmarkId(displayUrl),
    title: normalizeTitle(bookmark.title, displayUrl),
    type: 'bookmark',
  };

  const accountId = getSavedAccountContext(displayUrl, 'accountId' in bookmark ? bookmark.accountId : null);

  if (accountId) {
    normalized.accountId = accountId;
  }

  return normalized;
}

function normalizeTreeItem(value: unknown): BookmarkTreeItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const item = value as Partial<BookmarkTreeItem>;

  if (item.type === 'folder') {
    const title = normalizeTitle(item.title, 'Folder');
    return {
      children: normalizeTreeFolderItems((item as Partial<BookmarkFolder>).children),
      createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : createBookmarkId(title, 'folder'),
      title,
      type: 'folder',
    };
  }

  return normalizeBookmark(value);
}

function normalizeTreeFolderItems(value: unknown): BookmarkTreeItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids = new Set<string>();
  const items: BookmarkTreeItem[] = [];

  for (const valueItem of value) {
    const item = normalizeTreeItem(valueItem);

    if (!item || ids.has(item.id)) {
      continue;
    }

    ids.add(item.id);
    items.push(item);

    if (items.length >= MAX_BOOKMARKS_PER_FOLDER) {
      break;
    }
  }

  return items;
}

function normalizeLegacyFolder(value: unknown): BookmarkTreeItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenDisplayUrls = new Set<string>();
  const items: BookmarkTreeItem[] = [];

  for (const valueItem of value) {
    const bookmark = normalizeBookmark(valueItem);

    if (!bookmark || seenDisplayUrls.has(bookmark.displayUrl)) {
      continue;
    }

    seenDisplayUrls.add(bookmark.displayUrl);
    items.push(bookmark);

    if (items.length >= MAX_BOOKMARKS_PER_FOLDER) {
      break;
    }
  }

  return items;
}

function normalizeBookmarksState(value: unknown): BookmarksState {
  if (!value || typeof value !== 'object') {
    return DEFAULT_BOOKMARKS_STATE;
  }

  const state = value as Partial<BookmarksState>;
  const isVersionedTree = state.version === BOOKMARKS_STATE_VERSION;

  return {
    bookmarks: isVersionedTree ? normalizeTreeFolderItems(state.bookmarks) : normalizeLegacyFolder(state.bookmarks),
    toolbar: isVersionedTree ? normalizeTreeFolderItems(state.toolbar) : normalizeLegacyFolder(state.toolbar),
    toolbarVisible: state.toolbarVisible === true,
    version: BOOKMARKS_STATE_VERSION,
  };
}

export async function loadBookmarksState(): Promise<BookmarksState> {
  const raw = Capacitor.isNativePlatform()
    ? (await Preferences.get({ key: BOOKMARKS_STORAGE_KEY })).value
    : window.localStorage.getItem(BOOKMARKS_STORAGE_KEY);

  if (!raw) {
    return DEFAULT_BOOKMARKS_STATE;
  }

  try {
    return normalizeBookmarksState(JSON.parse(raw));
  } catch {
    return DEFAULT_BOOKMARKS_STATE;
  }
}

export async function saveBookmarksState(state: BookmarksState): Promise<void> {
  const value = JSON.stringify(normalizeBookmarksState(state));

  if (Capacitor.isNativePlatform()) {
    await Preferences.set({ key: BOOKMARKS_STORAGE_KEY, value });
    return;
  }

  window.localStorage.setItem(BOOKMARKS_STORAGE_KEY, value);
}

export function getBookmarksInFolder(state: BookmarksState, folderId: BookmarkFolderId) {
  return state[folderId];
}

function mapItems(items: BookmarkTreeItem[], mapItem: (item: BookmarkTreeItem) => BookmarkTreeItem): BookmarkTreeItem[] {
  return items.map((item) => (item.type === 'folder' ? mapItem({ ...item, children: mapItems(item.children, mapItem) }) : mapItem(item)));
}

function filterItems(items: BookmarkTreeItem[], predicate: (item: BookmarkTreeItem) => boolean): BookmarkTreeItem[] {
  const nextItems: BookmarkTreeItem[] = [];

  for (const item of items) {
    if (!predicate(item)) {
      continue;
    }

    nextItems.push(item.type === 'folder' ? { ...item, children: filterItems(item.children, predicate) } : item);
  }

  return nextItems;
}

export function flattenBookmarkItems(items: BookmarkTreeItem[]): BookmarkTreeItem[] {
  return items.flatMap((item) => (item.type === 'folder' ? [item, ...flattenBookmarkItems(item.children)] : [item]));
}

export function findBookmarkItem(items: BookmarkTreeItem[], itemId: string): BookmarkTreeItem | null {
  for (const item of items) {
    if (item.id === itemId) {
      return item;
    }

    if (item.type === 'folder') {
      const found = findBookmarkItem(item.children, itemId);

      if (found) {
        return found;
      }
    }
  }

  return null;
}

export function findBookmarkFolder(items: BookmarkTreeItem[], folderId: string): BookmarkFolder | null {
  const item = findBookmarkItem(items, folderId);
  return item?.type === 'folder' ? item : null;
}

export function hasBookmarkedUrl(state: BookmarksState, displayUrl: string) {
  const normalized = displayUrl.trim();

  if (!normalized) {
    return false;
  }

  return [...flattenBookmarkItems(state.bookmarks), ...flattenBookmarkItems(state.toolbar)].some(
    (item) => item.type === 'bookmark' && item.displayUrl === normalized,
  );
}

export function isBookmarked(state: BookmarksState, folderId: BookmarkFolderId, displayUrl: string) {
  const normalized = displayUrl.trim();
  return !!normalized && flattenBookmarkItems(getBookmarksInFolder(state, folderId)).some(
    (item) => item.type === 'bookmark' && item.displayUrl === normalized,
  );
}

function getItemsForTarget(state: BookmarksState, rootId: BookmarkFolderId, folderId?: string | null) {
  if (!folderId) {
    return getBookmarksInFolder(state, rootId);
  }

  return findBookmarkFolder(getBookmarksInFolder(state, rootId), folderId)?.children ?? null;
}

function setItemsForTarget(
  state: BookmarksState,
  rootId: BookmarkFolderId,
  folderId: string | null | undefined,
  nextItems: BookmarkTreeItem[],
): BookmarksState {
  if (!folderId) {
    return { ...state, [rootId]: nextItems.slice(0, MAX_BOOKMARKS_PER_FOLDER) };
  }

  return {
    ...state,
    [rootId]: mapItems(getBookmarksInFolder(state, rootId), (item) =>
      item.type === 'folder' && item.id === folderId ? { ...item, children: nextItems.slice(0, MAX_BOOKMARKS_PER_FOLDER) } : item,
    ),
  };
}

export function addBookmark(
  state: BookmarksState,
  folderId: BookmarkFolderId,
  request: BookmarkUpdateRequest,
  parentFolderId?: string | null,
): BookmarksState {
  const displayUrl = request.displayUrl.trim();
  const folder = getItemsForTarget(state, folderId, parentFolderId);

  if (!displayUrl || !folder || folder.some((item) => item.type === 'bookmark' && item.displayUrl === displayUrl)) {
    return state;
  }

  const nextBookmark: BookmarkLink = {
    createdAt: Date.now(),
    displayUrl,
    id: createBookmarkId(displayUrl),
    title: normalizeTitle(request.title, displayUrl),
    type: 'bookmark',
  };
  const accountId = getSavedAccountContext(displayUrl, request.accountId);

  if (accountId) {
    nextBookmark.accountId = accountId;
  }

  return setItemsForTarget(state, folderId, parentFolderId, [...folder, nextBookmark]);
}

export function addBookmarkFolder(
  state: BookmarksState,
  folderId: BookmarkFolderId,
  request: BookmarkFolderRequest,
  parentFolderId?: string | null,
): BookmarksState {
  const title = request.title.trim();
  const folder = getItemsForTarget(state, folderId, parentFolderId);

  if (!title || !folder) {
    return state;
  }

  const nextFolder: BookmarkFolder = {
    children: [],
    createdAt: Date.now(),
    id: createBookmarkId(title, 'folder'),
    title,
    type: 'folder',
  };

  return setItemsForTarget(state, folderId, parentFolderId, [...folder, nextFolder]);
}

export function removeBookmark(state: BookmarksState, folderId: BookmarkFolderId, bookmarkId: string): BookmarksState {
  if (!findBookmarkItem(getBookmarksInFolder(state, folderId), bookmarkId)) {
    return state;
  }

  const nextRoot = filterItems(getBookmarksInFolder(state, folderId), (item) => item.id !== bookmarkId);

  return {
    ...state,
    [folderId]: nextRoot,
  };
}

export function updateBookmark(
  state: BookmarksState,
  folderId: BookmarkFolderId,
  bookmarkId: string,
  request: BookmarkUpdateRequest,
): BookmarksState {
  const displayUrl = request.displayUrl.trim();

  if (!displayUrl) {
    return state;
  }

  let didUpdate = false;
  const nextRoot = mapItems(getBookmarksInFolder(state, folderId), (item) => {
    if (item.id !== bookmarkId || item.type !== 'bookmark') {
      return item;
    }

    didUpdate = true;
    const nextBookmark: BookmarkLink = {
      ...item,
      displayUrl,
      title: normalizeTitle(request.title, displayUrl),
    };

    const accountId = getSavedAccountContext(displayUrl, request.accountId);

    if (accountId) {
      nextBookmark.accountId = accountId;
    } else {
      delete nextBookmark.accountId;
    }

    return nextBookmark;
  });

  return didUpdate ? { ...state, [folderId]: nextRoot } : state;
}

export function updateBookmarkFolder(
  state: BookmarksState,
  folderId: BookmarkFolderId,
  bookmarkFolderId: string,
  request: BookmarkFolderRequest,
): BookmarksState {
  const title = request.title.trim();

  if (!title) {
    return state;
  }

  let didUpdate = false;
  const nextRoot = mapItems(getBookmarksInFolder(state, folderId), (item) => {
    if (item.id !== bookmarkFolderId || item.type !== 'folder') {
      return item;
    }

    didUpdate = true;
    return { ...item, title };
  });

  return didUpdate ? { ...state, [folderId]: nextRoot } : state;
}

function removeItemFromItems(items: BookmarkTreeItem[], itemId: string): { item: BookmarkTreeItem | null; items: BookmarkTreeItem[] } {
  let removedItem: BookmarkTreeItem | null = null;
  const nextItems: BookmarkTreeItem[] = [];

  for (const item of items) {
    if (item.id === itemId) {
      removedItem = item;
      continue;
    }

    if (item.type === 'folder') {
      const result = removeItemFromItems(item.children, itemId);
      if (result.item) {
        removedItem = result.item;
        nextItems.push({ ...item, children: result.items });
      } else {
        nextItems.push(item);
      }
      continue;
    }

    nextItems.push(item);
  }

  return { item: removedItem, items: nextItems };
}

function containsItem(folder: BookmarkFolder, itemId: string): boolean {
  return folder.children.some((item) => item.id === itemId || (item.type === 'folder' && containsItem(item, itemId)));
}

function insertItem(
  items: BookmarkTreeItem[],
  item: BookmarkTreeItem,
  targetItemId?: string | null,
  targetPosition: BookmarkDropPosition = 'after',
): BookmarkTreeItem[] {
  if (!targetItemId || targetPosition === 'inside') {
    return [...items, item].slice(0, MAX_BOOKMARKS_PER_FOLDER);
  }

  const targetIndex = items.findIndex((candidate) => candidate.id === targetItemId);

  if (targetIndex === -1) {
    return [...items, item].slice(0, MAX_BOOKMARKS_PER_FOLDER);
  }

  const insertIndex = targetPosition === 'before' ? targetIndex : targetIndex + 1;
  return [...items.slice(0, insertIndex), item, ...items.slice(insertIndex)].slice(0, MAX_BOOKMARKS_PER_FOLDER);
}

export function moveBookmarkItem(state: BookmarksState, request: BookmarkMoveRequest): BookmarksState {
  if (request.sourceRootId === request.targetRootId && request.itemId === request.targetItemId) {
    return state;
  }

  const sourceRoot = getBookmarksInFolder(state, request.sourceRootId);
  const removal = removeItemFromItems(sourceRoot, request.itemId);

  if (!removal.item) {
    return state;
  }

  if (request.targetFolderId && removal.item.type === 'folder' && containsItem(removal.item, request.targetFolderId)) {
    return state;
  }

  let nextState: BookmarksState = { ...state, [request.sourceRootId]: removal.items };
  const targetItems = getItemsForTarget(nextState, request.targetRootId, request.targetFolderId);

  if (!targetItems) {
    return state;
  }

  return setItemsForTarget(
    nextState,
    request.targetRootId,
    request.targetFolderId,
    insertItem(targetItems, removal.item, request.targetItemId, request.targetPosition),
  );
}

export function setBookmarkToolbarVisible(state: BookmarksState, toolbarVisible: boolean): BookmarksState {
  return state.toolbarVisible === toolbarVisible ? state : { ...state, toolbarVisible };
}
