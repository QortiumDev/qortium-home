import assert from 'node:assert/strict';
import { DEFAULT_BOOKMARKS_STATE } from './bookmarks';
import { applyBookmarkManagerMutation, type BookmarkManagerCollections } from './bookmarkManager';

const initial: BookmarkManagerCollections = {
  bookmarksState: {
    ...DEFAULT_BOOKMARKS_STATE,
    bookmarks: [{
      createdAt: 1,
      displayUrl: 'qdn://APP/Boards/Boards',
      id: 'boards-link',
      title: 'Boards',
      type: 'bookmark',
    }],
  },
  dashboardPins: [{
    createdAt: 2,
    displayUrl: 'qdn://APP/Help/Help',
    id: 'qdn://APP/Help/Help',
    label: 'Help',
  }],
  revision: 4,
  startPages: [{ accountId: null, displayUrl: 'qdn://APP/Polls/Polls', title: 'Polls' }],
};

const noChange = applyBookmarkManagerMutation(initial, {
  type: 'removeTreeItem',
  rootId: 'bookmarks',
  itemId: 'missing',
});
assert.equal(noChange.changed, false);
assert.equal(noChange.collections, initial);
assert.equal(noChange.snapshot.revision, 4);

const visibility = applyBookmarkManagerMutation(initial, {
  type: 'setToolbarVisibility',
  toolbarVisibility: 'always',
});
assert.equal(visibility.changed, true);
assert.equal(visibility.snapshot.revision, 5);
assert.equal(visibility.snapshot.toolbarVisibility, 'always');
assert.equal(initial.bookmarksState.toolbarVisibility, 'hidden');

const toStartPages = applyBookmarkManagerMutation(initial, {
  type: 'moveItem',
  itemId: 'boards-link',
  sourceRootId: 'bookmarks',
  targetRootId: 'startPages',
});
assert.equal(toStartPages.changed, true);
assert.equal(toStartPages.snapshot.revision, 5);
assert.equal(toStartPages.snapshot.bookmarks.length, 0);
assert.equal(toStartPages.snapshot.startPages.at(-1)?.displayUrl, 'qdn://APP/Boards/Boards');

const pinToToolbar = applyBookmarkManagerMutation(initial, {
  type: 'moveItem',
  itemId: 'qdn://APP/Help/Help',
  sourceRootId: 'pins',
  targetRootId: 'toolbar',
});
assert.equal(pinToToolbar.changed, true);
assert.equal(pinToToolbar.snapshot.dashboardPins.length, 0);
assert.equal(pinToToolbar.snapshot.toolbar[0]?.type, 'bookmark');
assert.equal(pinToToolbar.snapshot.toolbar[0]?.type === 'bookmark' && pinToToolbar.snapshot.toolbar[0].displayUrl, 'qdn://APP/Help/Help');

const reordered = applyBookmarkManagerMutation({
  ...initial,
  startPages: [
    { accountId: null, displayUrl: 'qdn://APP/One/One' },
    { accountId: null, displayUrl: 'qdn://APP/Two/Two' },
  ],
}, {
  type: 'moveItem',
  itemId: 'qdn://APP/Two/Two',
  sourceRootId: 'startPages',
  targetItemId: 'qdn://APP/One/One',
  targetPosition: 'before',
  targetRootId: 'startPages',
});
assert.deepEqual(reordered.snapshot.startPages.map((page) => page.displayUrl), [
  'qdn://APP/Two/Two',
  'qdn://APP/One/One',
]);

const fullBookmarks = Array.from({ length: 128 }, (_, index) => ({
  createdAt: index,
  displayUrl: `qdn://APP/Test/Test/${index}`,
  id: `test-${index}`,
  title: `Test ${index}`,
  type: 'bookmark' as const,
}));
const rejectedFullMove = applyBookmarkManagerMutation({
  ...initial,
  bookmarksState: { ...initial.bookmarksState, bookmarks: fullBookmarks },
}, {
  type: 'moveItem',
  itemId: 'qdn://APP/Help/Help',
  sourceRootId: 'pins',
  targetRootId: 'bookmarks',
});
assert.equal(rejectedFullMove.changed, false);
assert.equal(rejectedFullMove.snapshot.dashboardPins.length, 1);
assert.equal(rejectedFullMove.snapshot.bookmarks.length, 128);

console.log('Bookmark manager reducer tests passed.');
