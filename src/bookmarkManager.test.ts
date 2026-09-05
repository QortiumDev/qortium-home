import assert from 'node:assert/strict';
import { DEFAULT_BOOKMARKS_STATE } from './bookmarks';
import {
  applyBookmarkManagerMutation,
  locateBookmarkManagerLink,
  createBookmarkManagerSnapshot,
  type BookmarkManagerCollections,
} from './bookmarkManager';
import { buildTabBookmarkToggle, buildTabDashboardPin, buildTabToolbarSave } from './v2/shell/saved-tab-bookmarks';

const initial: BookmarkManagerCollections = {
  accounts: {
    activeAccountId: 'account-1',
    availableAccounts: [{ id: 'account-1', label: 'Main' }],
  },
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
assert.equal(noChange.snapshot.activeAccountId, 'account-1');
assert.deepEqual(noChange.snapshot.availableAccounts, [{ id: 'account-1', label: 'Main' }]);

const visibility = applyBookmarkManagerMutation(initial, {
  type: 'setToolbarVisibility',
  toolbarVisibility: 'always',
});
assert.equal(visibility.changed, true);
assert.equal(visibility.snapshot.revision, 5);
assert.equal(visibility.snapshot.toolbarVisibility, 'always');
assert.equal(initial.bookmarksState.toolbarVisibility, 'hidden');
// BOOKMARKS_APPLY results carry the same account choices as BOOKMARKS_GET, not just the initial read.
assert.equal(visibility.snapshot.activeAccountId, 'account-1');
assert.deepEqual(visibility.snapshot.availableAccounts, [{ id: 'account-1', label: 'Main' }]);

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

// The bridge apply path surfaces the contract's INVALID_ADDRESS code, so
// manager apps can distinguish a bad address from other failures.
assert.throws(
  () => applyBookmarkManagerMutation(initial, {
    type: 'addTreeLink',
    rootId: 'bookmarks',
    link: { displayUrl: 'https://example.com', title: 'Nope' },
  }),
  (error: unknown) => (error as { code?: string }).code === 'INVALID_ADDRESS',
  'apply rejects unsupported addresses with INVALID_ADDRESS',
);

// A link saved with no title stores an EMPTY title rather than its own address.
// Baking the URL into `title` made "no title" indistinguishable from a real
// one, so display code could never fall back to a derived short label.
const untitledAdd = applyBookmarkManagerMutation(initial, {
  type: 'addTreeLink',
  rootId: 'bookmarks',
  link: { displayUrl: 'qdn://APP/Untitled/Untitled', title: '' },
});
assert.equal(untitledAdd.changed, true);
const untitledLink = locateBookmarkManagerLink(
  untitledAdd.snapshot,
  'qdn://APP/Untitled/Untitled',
);
assert.equal(untitledLink?.link.title, '');

// A real title is still stored verbatim.
const titledAdd = applyBookmarkManagerMutation(initial, {
  type: 'addTreeLink',
  rootId: 'bookmarks',
  link: { displayUrl: 'qdn://APP/Titled/Titled', title: 'Titled app' },
});
assert.equal(
  locateBookmarkManagerLink(titledAdd.snapshot, 'qdn://APP/Titled/Titled')?.link.title,
  'Titled app',
);

// The toolbar star has to find a saved page by address, because ids are minted
// per-add rather than derived from the URL, and removal needs the root too.
const lookupSnapshot = {
  bookmarks: [
    {
      children: [
        { createdAt: 1, displayUrl: 'qdn://APP/Deep/Deep', id: 'nested-1', title: 'Deep', type: 'bookmark' as const },
      ],
      createdAt: 1,
      id: 'folder-1',
      title: 'Folder',
      type: 'folder' as const,
    },
    { createdAt: 2, displayUrl: 'qdn://APP/Both/Both', id: 'saved-1', title: 'Both', type: 'bookmark' as const },
  ],
  toolbar: [
    { createdAt: 3, displayUrl: 'qdn://APP/Both/Both', id: 'toolbar-1', title: 'Both', type: 'bookmark' as const },
  ],
};
assert.equal(locateBookmarkManagerLink(lookupSnapshot, 'qdn://APP/Missing/Missing'), null);
assert.deepEqual(
  locateBookmarkManagerLink(lookupSnapshot, 'qdn://APP/Deep/Deep'),
  {
    link: (lookupSnapshot.bookmarks[0] as { children: unknown[] }).children[0],
    rootId: 'bookmarks',
  },
  'finds a link nested inside a folder',
);
assert.equal(
  locateBookmarkManagerLink(lookupSnapshot, 'qdn://APP/Both/Both')?.rootId,
  'toolbar',
  'prefers the toolbar copy, so un-starring removes what the user can see',
);

// Exercise the tab-save builders through the real contract and persistence
// reducer on both networks. In particular qortal:// must retain the binding.
for (const scheme of ['qdn', 'qortal']) {
  const empty: BookmarkManagerCollections = {
    bookmarksState: { ...DEFAULT_BOOKMARKS_STATE, bookmarks: [], toolbar: [] },
    dashboardPins: [], startPages: [], revision: 0,
  };
  const draft = { accountId: 'wallet-b:1', displayUrl: `${scheme}://APP/Chat/default`, title: 'Chat' };
  const snapshot = createBookmarkManagerSnapshot(empty);
  const saved = applyBookmarkManagerMutation(empty, buildTabBookmarkToggle(snapshot, draft));
  assert.equal(locateBookmarkManagerLink(saved.snapshot, draft.displayUrl)?.link.accountId, 'wallet-b:1');
  const beforeConflict = JSON.stringify(saved.collections);
  assert.throws(() => buildTabBookmarkToggle(saved.snapshot, { ...draft, accountId: 'wallet-a' }), /another account/);
  assert.equal(JSON.stringify(saved.collections), beforeConflict, 'a star cannot remove another account’s same-address bookmark');
  const removed = applyBookmarkManagerMutation(saved.collections, buildTabBookmarkToggle(saved.snapshot, draft));
  assert.equal(removed.snapshot.bookmarks.length, 0, 'the matching account can still unstar its save');

  const toolbarMutation = buildTabToolbarSave(snapshot, draft)!;
  const toolbar = applyBookmarkManagerMutation(empty, toolbarMutation);
  assert.equal(locateBookmarkManagerLink(toolbar.snapshot, draft.displayUrl)?.link.accountId, 'wallet-b:1');
  assert.equal(buildTabToolbarSave(toolbar.snapshot, draft), null, 'same-account drag is idempotent');
  assert.throws(() => buildTabToolbarSave(toolbar.snapshot, { ...draft, accountId: 'wallet-a' }), /another account/);

  const pin = applyBookmarkManagerMutation(empty, buildTabDashboardPin(snapshot, draft));
  assert.equal(pin.snapshot.dashboardPins[0].accountId, 'wallet-b:1');
  assert.throws(() => buildTabDashboardPin(pin.snapshot, { ...draft, accountId: 'wallet-a' }), /another account/);
  const labelledPin = applyBookmarkManagerMutation(pin.collections, buildTabDashboardPin(pin.snapshot, draft));
  assert.equal(labelledPin.snapshot.dashboardPins[0].customLabel, 'Chat');
  assert.equal(labelledPin.snapshot.dashboardPins[0].accountId, 'wallet-b:1');

  // Existing contract: null is Current/inherit, not an explicit guest identity.
  const current = applyBookmarkManagerMutation(empty, buildTabBookmarkToggle(snapshot, { ...draft, accountId: null }));
  assert.equal(locateBookmarkManagerLink(current.snapshot, draft.displayUrl)?.link.accountId ?? null, null);
  assert.throws(() => buildTabBookmarkToggle(current.snapshot, draft), /another account/, 'an explicit binding cannot silently replace Current');
  const start = applyBookmarkManagerMutation(empty, { type: 'addStartPage', page: draft });
  assert.equal(start.snapshot.startPages[0].accountId, 'wallet-b:1');
}

console.log('Bookmark manager reducer tests passed.');
