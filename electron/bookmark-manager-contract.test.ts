import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BOOKMARK_MANAGER_SCHEMA_VERSION,
  validateBookmarkManagerMutation,
  validateBookmarkManagerMutationRequest,
  validateBookmarkManagerSnapshot,
  validateBookmarksOpenRequest,
  type BookmarkManagerMutation,
  type BookmarkManagerSnapshot,
} from './bookmark-manager-contract.js';

const snapshot: BookmarkManagerSnapshot = {
  bookmarks: [
    {
      children: [
        {
          accountId: 'account-1',
          createdAt: 2,
          displayUrl: 'qdn://APP/Boards/Boards',
          id: 'bookmark-1',
          title: 'Boards',
          type: 'bookmark',
        },
      ],
      createdAt: 1,
      id: 'folder-1',
      title: 'Community',
      type: 'folder',
    },
  ],
  dashboardPins: [
    {
      createdAt: 3,
      customLabel: 'My Help',
      displayUrl: 'qdn://APP/Help/Help',
      id: 'qdn://APP/Help/Help',
      label: 'Help',
    },
  ],
  revision: 7,
  schemaVersion: BOOKMARK_MANAGER_SCHEMA_VERSION,
  startPages: [
    {
      accountId: null,
      displayUrl: 'home://dashboard',
      title: 'Dashboard',
    },
  ],
  toolbar: [],
  toolbarVisibility: 'dashboard',
};

assert.deepEqual(validateBookmarkManagerSnapshot(snapshot), snapshot);
assert.notEqual(validateBookmarkManagerSnapshot(snapshot), snapshot, 'snapshot validation returns a transport-safe copy');

assert.throws(
  () => validateBookmarkManagerSnapshot({ ...snapshot, revision: -1 }),
  /revision must be a non-negative safe integer/,
);

const homeV2Preload = readFileSync(new URL('../electron/home-v2-live-preload.cts', import.meta.url), 'utf8');
const homeV2Live = readFileSync(new URL('../src/home-v2-live/HomeV2LiveApp.tsx', import.meta.url), 'utf8');
const homeV2Collections = readFileSync(new URL('../src/home-v2-live/collections-client.ts', import.meta.url), 'utf8');
const homeV2Actions = readFileSync(new URL('../electron/home-v2-app-actions.ts', import.meta.url), 'utf8');
const homeV2Bridge = readFileSync(new URL('../electron/home-v2-app-bridge.ts', import.meta.url), 'utf8');
for (const marker of [
  'qdn-app:bookmark-manager-request',
  'qdn-app:resolveBookmarkManagerRequest',
  'qdn-app:bookmarks-open',
]) {
  assert.match(homeV2Preload, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
for (const action of ['BOOKMARKS_HAS_PERMISSION', 'BOOKMARKS_GET', 'BOOKMARKS_APPLY', 'BOOKMARKS_OPEN']) {
  assert.match(homeV2Live, new RegExp(`action === '${action}'`), `${action} is handled by the Android Home 2 host`);
}
assert.match(homeV2Collections, /validateBookmarkManagerMutationRequest/);
assert.match(homeV2Collections, /HOME_DATA_STALE/);
for (const action of ['BOOKMARKS_HAS_PERMISSION', 'BOOKMARKS_GET', 'BOOKMARKS_APPLY', 'BOOKMARKS_OPEN']) {
  assert.match(homeV2Actions, new RegExp(`'${action}'`), `${action} is advertised by Home 2 qdnRequest`);
}
assert.match(homeV2Bridge, /requireHomeV2BookmarkManagerPermission/);
assert.match(homeV2Bridge, /requestHomeV2Collections/);
assert.match(homeV2Bridge, /platformVersion: '2\.1'/);
assert.match(readFileSync(new URL('../src/home-v2-live/node-client.ts', import.meta.url), 'utf8'), /platformVersion: '2\.1'/);
assert.match(homeV2Live, /isAndroidHost && protocol === 'qdnRequest' && \(/,
  'Android must not intercept QDN-only bookmark actions for qortalRequest');
assert.match(homeV2Live, /activeAccountId: context\.selectedAccountId/,
  'Android bookmark snapshots must use the calling tab account');
assert.throws(
  () => validateBookmarkManagerSnapshot({ ...snapshot, schemaVersion: 2 }),
  /schemaVersion must be 1/,
);
assert.throws(
  () => validateBookmarkManagerSnapshot({ ...snapshot, extra: true }),
  /snapshot.extra is not supported/,
);
assert.throws(
  () => validateBookmarkManagerSnapshot({
    ...snapshot,
    bookmarks: [{ ...snapshot.bookmarks[0], children: [{ type: 'script' }] }],
  }),
  /type must be bookmark or folder/,
);

// availableAccounts/activeAccountId are optional and safe-fields-only.
const snapshotWithAccounts = {
  ...snapshot,
  activeAccountId: 'account-1',
  availableAccounts: [{ id: 'account-1', label: 'Main' }, { id: 'account-2', label: 'Trading' }],
};
assert.deepEqual(validateBookmarkManagerSnapshot(snapshotWithAccounts), snapshotWithAccounts);
assert.deepEqual(
  validateBookmarkManagerSnapshot({ ...snapshot, activeAccountId: null, availableAccounts: [] }),
  { ...snapshot, activeAccountId: null, availableAccounts: [] },
);
assert.equal(Object.hasOwn(validateBookmarkManagerSnapshot(snapshot), 'activeAccountId'), false);
assert.equal(Object.hasOwn(validateBookmarkManagerSnapshot(snapshot), 'availableAccounts'), false);
assert.throws(
  () => validateBookmarkManagerSnapshot({
    ...snapshot,
    availableAccounts: [{ id: 'account-1', label: 'Main', walletFilename: 'wallet.json' }],
  }),
  /availableAccounts\[0\]\.walletFilename is not supported/,
);
assert.throws(
  () => validateBookmarkManagerSnapshot({ ...snapshot, availableAccounts: [{ id: 'account-1' }] }),
  /availableAccounts\[0\]\.label must be a string/,
);

const mutations: BookmarkManagerMutation[] = [
  { type: 'addTreeLink', rootId: 'bookmarks', parentFolderId: 'folder-1', link: { displayUrl: 'qdn://APP/Polls/Polls', title: 'Polls' } },
  { type: 'addTreeLink', rootId: 'bookmarks', link: { displayUrl: 'qdn://*/Alice', title: 'Alice resources' } },
  { type: 'addTreeFolder', rootId: 'toolbar', title: 'Tools' },
  { type: 'updateTreeLink', rootId: 'bookmarks', itemId: 'bookmark-1', link: { accountId: null, displayUrl: 'qdn://APP/Boards/Boards', title: 'Boards app' } },
  { type: 'updateTreeFolder', rootId: 'bookmarks', itemId: 'folder-1', title: 'Qortium' },
  { type: 'removeTreeItem', rootId: 'toolbar', itemId: 'bookmark-2' },
  { type: 'addDashboardPin', pin: { displayUrl: 'qdn://APP/Chat/Chat', title: 'Chat' } },
  { type: 'updateDashboardPin', pinId: 'qdn://APP/Help/Help', pin: { displayUrl: 'qdn://APP/Help/Help', title: 'Help app' } },
  { type: 'removeDashboardPin', pinId: 'qdn://APP/Help/Help' },
  { type: 'addStartPage', page: { displayUrl: 'qdn://APP/Trust/Trust', title: 'Trust' } },
  { type: 'updateStartPage', displayUrl: 'home://dashboard', page: { displayUrl: 'qdn://APP/Boards/Boards', title: 'Boards' } },
  { type: 'removeStartPage', displayUrl: 'qdn://APP/Trust/Trust' },
  { type: 'moveItem', itemId: 'bookmark-1', sourceRootId: 'bookmarks', targetRootId: 'toolbar', targetFolderId: 'folder-2', targetPosition: 'inside' },
  { type: 'moveItem', itemId: 'qdn://APP/Help/Help', sourceRootId: 'pins', targetRootId: 'startPages', targetItemId: 'qdn://APP/Trust/Trust', targetPosition: 'before' },
  { type: 'setToolbarVisibility', toolbarVisibility: 'always' },
];

for (const mutation of mutations) {
  assert.deepEqual(validateBookmarkManagerMutation(mutation), mutation, mutation.type);
}

assert.deepEqual(validateBookmarkManagerMutationRequest({ expectedRevision: 7, mutation: mutations[0] }), {
  expectedRevision: 7,
  mutation: mutations[0],
});

assert.throws(
  () => validateBookmarkManagerMutationRequest({ expectedRevision: 7.5, mutation: mutations[0] }),
  /expectedRevision must be a non-negative safe integer/,
);
assert.throws(
  () => validateBookmarkManagerMutation({ type: 'addTreeFolder', rootId: 'pins', title: 'Nope' }),
  /rootId must be bookmarks or toolbar/,
);
assert.throws(
  () => validateBookmarkManagerMutation({ type: 'moveItem', itemId: 'one', sourceRootId: 'bookmarks', targetRootId: 'pins', targetFolderId: 'folder-1' }),
  /targetFolderId is only supported/,
);
assert.throws(
  () => validateBookmarkManagerMutation({ type: 'moveItem', itemId: 'one', sourceRootId: 'bookmarks', targetRootId: 'pins', targetPosition: 'inside' }),
  /targetPosition cannot be inside/,
);
assert.throws(
  () => validateBookmarkManagerMutation({ type: 'setToolbarVisibility', toolbarVisibility: 'sometimes' }),
  /not a supported toolbar visibility/,
);
assert.throws(
  () => validateBookmarkManagerMutation({ ...mutations[0], unexpected: true }),
  /mutation.unexpected is not supported/,
);
assert.throws(
  () => validateBookmarkManagerMutation({ type: 'addTreeLink', rootId: 'bookmarks', link: { displayUrl: 'https://example.com', title: 'Nope' } }),
  /must be a supported qdn:\/\//,
);
assert.throws(
  () => validateBookmarkManagerMutation({ type: 'addTreeLink', rootId: 'bookmarks', link: { displayUrl: 'qdn://NOT_A_REAL_SERVICE/Alice/item', title: 'Nope' } }),
  /must be a supported qdn:\/\//,
);
// Unsupported addresses reject with a stable code so manager apps can show a
// specific localized error instead of relaying the raw message.
const hasInvalidAddressCode = (error: unknown) => (error as { code?: string }).code === 'INVALID_ADDRESS';
const invalidAddressMutations = [
  { type: 'addTreeLink', rootId: 'bookmarks', link: { displayUrl: 'https://example.com', title: 'Nope' } },
  { type: 'updateTreeLink', rootId: 'bookmarks', itemId: 'bookmark-1', link: { displayUrl: 'not an address', title: 'Nope' } },
  { type: 'addDashboardPin', pin: { displayUrl: 'qdn://NOT_A_REAL_SERVICE/Alice', title: 'Nope' } },
  { type: 'updateDashboardPin', pinId: 'pin-1', pin: { displayUrl: 'ftp://example.com', title: 'Nope' } },
  { type: 'addStartPage', page: { displayUrl: 'home://not-a-page', title: 'Nope' } },
  { type: 'updateStartPage', displayUrl: 'qdn://APP/Trust/Trust', page: { displayUrl: 'garbage', title: 'Nope' } },
];
for (const invalidMutation of invalidAddressMutations) {
  assert.throws(
    () => validateBookmarkManagerMutation(invalidMutation),
    hasInvalidAddressCode,
    `${invalidMutation.type} rejects with INVALID_ADDRESS`,
  );
}
assert.throws(
  () => validateBookmarksOpenRequest({ address: 'https://example.com' }),
  hasInvalidAddressCode,
  'BOOKMARKS_OPEN rejects with INVALID_ADDRESS',
);

// A Qortal-network app tab produces a qortal:// address (and qortal-core://
// for its Core docs). Rejecting those made every Qortal tab unbookmarkable
// while the same page on Qortium saved fine.
for (const displayUrl of [
  'qortal://APP/Q-Mail/Q-Mail',
  'qortal://APP/Q-Mail/Q-Mail/inbox?filter=all#top',
  'qortal://*/Q-Mail',
  'qortal-core://',
  'qortal-core://api-documentation',
]) {
  assert.deepEqual(
    validateBookmarkManagerMutation({ type: 'addTreeLink', rootId: 'toolbar', link: { displayUrl, title: 'Qortal app' } }),
    { type: 'addTreeLink', rootId: 'toolbar', link: { displayUrl, title: 'Qortal app' } },
    `${displayUrl} is a saveable address`,
  );
  assert.deepEqual(
    validateBookmarksOpenRequest({ address: displayUrl }),
    { accountId: null, address: displayUrl },
    `${displayUrl} is an openable address`,
  );
}
// The scheme widening must not have opened the service allowlist.
assert.throws(
  () => validateBookmarkManagerMutation({ type: 'addTreeLink', rootId: 'bookmarks', link: { displayUrl: 'qortal://NOT_A_REAL_SERVICE/Alice/item', title: 'Nope' } }),
  hasInvalidAddressCode,
  'qortal:// still honours the public-service allowlist',
);
assert.throws(
  () => validateBookmarkManagerMutation({ type: 'addTreeLink', rootId: 'bookmarks', link: { displayUrl: 'qortalish://APP/Foo/Foo', title: 'Nope' } }),
  hasInvalidAddressCode,
  'a scheme that merely starts with qortal is still rejected',
);
assert.throws(
  () => validateBookmarkManagerMutation({ type: 'moveItem', itemId: 'one', sourceRootId: 'bookmarks', targetRootId: 'toolbar', targetPosition: 'inside' }),
  /inside requires mutation.targetFolderId/,
);

// BOOKMARKS_OPEN request shape.
assert.deepEqual(
  validateBookmarksOpenRequest({ address: 'qdn://APP/Boards/Boards', accountId: 'account-1' }),
  { accountId: 'account-1', address: 'qdn://APP/Boards/Boards' },
);
// Missing accountId means "Current" (null), matching the built-in accountId semantics elsewhere.
assert.deepEqual(
  validateBookmarksOpenRequest({ address: 'home://dashboard' }),
  { accountId: null, address: 'home://dashboard' },
);
assert.deepEqual(
  validateBookmarksOpenRequest({ address: 'core://', accountId: null }),
  { accountId: null, address: 'core://' },
);
assert.throws(
  () => validateBookmarksOpenRequest({ address: 'https://example.com' }),
  /must be a supported qdn:\/\//,
);
assert.throws(
  () => validateBookmarksOpenRequest({ address: '' }),
  /must not be empty/,
);
assert.throws(
  () => validateBookmarksOpenRequest({ address: 'qdn://APP/Boards/Boards', accountId: 42 }),
  /request\.accountId must be a string/,
);
assert.throws(
  () => validateBookmarksOpenRequest({ address: 'qdn://APP/Boards/Boards', accountId: 'a', extra: true }),
  /request\.extra is not supported/,
);
assert.throws(
  () => validateBookmarksOpenRequest({ address: `qdn://APP/${'a'.repeat(2048)}` }),
  /request\.address must be at most/,
);

console.log('Bookmark manager contract tests passed.');
