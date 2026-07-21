import assert from 'node:assert/strict';
import {
  applyLegacyPreferredBookmarksUrl,
  createDefaultQdnAppRolesStore,
  DEFAULT_BOOKMARKS_MANAGER_URL,
  getQdnAppRoleReplacedHolder,
  isTrustedQdnAppRolesSender,
  migrateLegacyQdnAppStores,
  sanitizeQdnAppRolesStore,
  sanitizeQdnManagerAppKey,
  storeHoldsQdnManagerPermission,
} from './qdn-manager-permissions.js';

assert.equal(sanitizeQdnManagerAppKey(' qdn://APP/Bookmarks/Bookmarks '), 'qdn://APP/Bookmarks/Bookmarks');
assert.equal(sanitizeQdnManagerAppKey('qdn://app/Bookmarks/Bookmarks/folder/item?x=1#part'), 'qdn://APP/Bookmarks/Bookmarks');
assert.throws(() => sanitizeQdnManagerAppKey('https://example.com'), /valid QDN APP or WEBSITE/);
assert.throws(() => sanitizeQdnManagerAppKey('qdn://APP/Bookmarks'), /valid QDN APP or WEBSITE/);

// Defaults: bookmarks routing URL is always set, nothing is granted, and a
// fresh install never has migration pending.
assert.deepEqual(createDefaultQdnAppRolesStore(), {
  version: 1,
  legacyMigrated: true,
  roles: {
    bookmarksManager: { url: DEFAULT_BOOKMARKS_MANAGER_URL, grantedAt: null },
    notificationsManager: { url: null, grantedAt: null },
  },
});

// Sanitizer: valid persisted roles pass through with canonical URLs.
assert.deepEqual(sanitizeQdnAppRolesStore({
  version: 1,
  roles: {
    bookmarksManager: { url: 'qdn://app/Other/Manager', grantedAt: '2026-07-19T00:00:00.000Z' },
    notificationsManager: { url: 'qdn://WEBSITE/Notify/Home', grantedAt: null },
  },
}), {
  version: 1,
  legacyMigrated: true,
  roles: {
    bookmarksManager: { url: 'qdn://APP/Other/Manager', grantedAt: '2026-07-19T00:00:00.000Z' },
    notificationsManager: { url: 'qdn://WEBSITE/Notify/Home', grantedAt: null },
  },
});

// Sanitizer: the migration marker survives only as an explicit false; a store
// persisted before the marker existed (or with a corrupt marker) counts as
// completed so the legacy overlay endpoint fails closed.
assert.equal(sanitizeQdnAppRolesStore({ version: 1, legacyMigrated: false, roles: {} }).legacyMigrated, false);
assert.equal(sanitizeQdnAppRolesStore({ version: 1, roles: {} }).legacyMigrated, true);
assert.equal(sanitizeQdnAppRolesStore({ version: 1, legacyMigrated: 'no', roles: {} }).legacyMigrated, true);

// Sanitizer: unreadable data fails toward defaults and fewer permissions —
// invalid URLs drop the role (and its grant), a grant never survives without a
// valid holder URL, and unknown role keys are ignored. The single-URL shape
// means stale or hand-edited data can never resurrect a second holder per role.
assert.deepEqual(sanitizeQdnAppRolesStore({
  version: 1,
  roles: {
    bookmarksManager: { url: 'https://invalid.example', grantedAt: '2026-07-19T00:00:00.000Z' },
    notificationsManager: { url: null, grantedAt: '2026-07-19T00:00:00.000Z' },
    extraRole: { url: 'qdn://APP/Sneaky/App', grantedAt: '2026-07-19T00:00:00.000Z' },
  },
}), createDefaultQdnAppRolesStore());
assert.deepEqual(sanitizeQdnAppRolesStore({ version: 2, roles: {} }), createDefaultQdnAppRolesStore());
assert.deepEqual(sanitizeQdnAppRolesStore('nonsense'), createDefaultQdnAppRolesStore());
// Corrupt grant timestamps (non-string or unparseable) clear the grant.
for (const grantedAt of [42, 'corrupt', '']) {
  assert.deepEqual(
    sanitizeQdnAppRolesStore({
      version: 1,
      roles: { bookmarksManager: { url: 'qdn://APP/Other/Manager', grantedAt } },
    }),
    {
      version: 1,
      legacyMigrated: true,
      roles: {
        bookmarksManager: { url: 'qdn://APP/Other/Manager', grantedAt: null },
        notificationsManager: { url: null, grantedAt: null },
      },
    },
  );
}

// Capability checks: an app holds a capability iff it is the granted role
// holder, compared via the canonical app key.
const heldStore = sanitizeQdnAppRolesStore({
  version: 1,
  roles: {
    bookmarksManager: { url: 'qdn://APP/Other/Manager', grantedAt: '2026-07-19T00:00:00.000Z' },
    notificationsManager: { url: 'qdn://APP/Notify/Notify', grantedAt: null },
  },
});
assert.equal(storeHoldsQdnManagerPermission(heldStore, 'qdn://app/Other/Manager?tab=1', 'bookmarks.manage'), true);
assert.equal(storeHoldsQdnManagerPermission(heldStore, 'qdn://APP/Else/Else', 'bookmarks.manage'), false);
assert.equal(storeHoldsQdnManagerPermission(heldStore, 'not-a-url', 'bookmarks.manage'), false);
// A role URL without a grant confers no capability.
assert.equal(storeHoldsQdnManagerPermission(heldStore, 'qdn://APP/Notify/Notify', 'notifications.manage'), false);

// Replacement disclosure: only a granted, different holder is replaced.
assert.equal(getQdnAppRoleReplacedHolder(heldStore, 'qdn://APP/Else/Else', 'bookmarks.manage'), 'qdn://APP/Other/Manager');
assert.equal(getQdnAppRoleReplacedHolder(heldStore, 'qdn://app/Other/Manager', 'bookmarks.manage'), null);
assert.equal(getQdnAppRoleReplacedHolder(heldStore, 'qdn://APP/Else/Else', 'notifications.manage'), null);

// Migration: both legacy stores collapse into roles. The preferred bookmarks
// app keeps its grant only when it was the legacy bookmarks.manage holder.
assert.deepEqual(migrateLegacyQdnAppStores(
  {
    version: 1,
    grants: {
      'qdn://APP/Other/Manager': { 'bookmarks.manage': { grantedAt: '2026-07-01T00:00:00.000Z' } },
    },
  },
  { version: 1, bookmarksManager: 'qdn://app/Other/Manager' },
), {
  version: 1,
  legacyMigrated: true,
  roles: {
    bookmarksManager: { url: 'qdn://APP/Other/Manager', grantedAt: '2026-07-01T00:00:00.000Z' },
    notificationsManager: { url: null, grantedAt: null },
  },
});

// Migration: a bookmarks.manage grant held by a different app than the
// preferred bookmarks app is dropped — fewer permissions, never more.
assert.deepEqual(migrateLegacyQdnAppStores(
  {
    version: 1,
    grants: {
      'qdn://APP/Else/Else': { 'bookmarks.manage': { grantedAt: '2026-07-01T00:00:00.000Z' } },
    },
  },
  { version: 1, bookmarksManager: 'qdn://APP/Other/Manager' },
).roles.bookmarksManager, { url: 'qdn://APP/Other/Manager', grantedAt: null });

// Migration: multiple legacy notifications.manage holders collapse to the most
// recently granted one; the rest are dropped.
assert.deepEqual(migrateLegacyQdnAppStores(
  {
    version: 1,
    grants: {
      'qdn://APP/OldNotify/Old': { 'notifications.manage': { grantedAt: '2026-06-01T00:00:00.000Z' } },
      'qdn://APP/NewNotify/New': { 'notifications.manage': { grantedAt: '2026-07-01T00:00:00.000Z' } },
    },
  },
  null,
).roles.notificationsManager, { url: 'qdn://APP/NewNotify/New', grantedAt: '2026-07-01T00:00:00.000Z' });

// Migration: garbage legacy data lands on the defaults, and corrupt legacy
// grant timestamps are never imported as grants.
assert.deepEqual(migrateLegacyQdnAppStores('nonsense', 17), createDefaultQdnAppRolesStore());
assert.deepEqual(
  migrateLegacyQdnAppStores(
    { version: 1, grants: { 'https://bad.example': { 'bookmarks.manage': { grantedAt: 'x' } } } },
    { version: 1, bookmarksManager: 'not an app' },
  ),
  createDefaultQdnAppRolesStore(),
);
assert.deepEqual(
  migrateLegacyQdnAppStores(
    {
      version: 1,
      grants: {
        'qdn://APP/Bookmarks/Bookmarks': { 'bookmarks.manage': { grantedAt: 'corrupt' } },
        'qdn://APP/Notify/Notify': { 'notifications.manage': { grantedAt: 'also corrupt' } },
      },
    },
    null,
  ),
  createDefaultQdnAppRolesStore(),
);

// Late preferred-apps reconciliation (desktop): moves the bookmarks routing URL
// off the default with the grant dropped, and never overwrites a non-default
// URL chosen in the meantime. Desktop persists the store with
// legacyMigrated: false until the renderer reports the legacy preferred apps.
const migratedDefault = {
  ...migrateLegacyQdnAppStores(
    {
      version: 1,
      grants: { 'qdn://APP/Bookmarks/Bookmarks': { 'bookmarks.manage': { grantedAt: '2026-07-01T00:00:00.000Z' } } },
    },
    null,
  ),
  legacyMigrated: false,
};
assert.deepEqual(
  applyLegacyPreferredBookmarksUrl(migratedDefault, { version: 1, bookmarksManager: 'qdn://APP/Other/Manager' })
    .roles.bookmarksManager,
  { url: 'qdn://APP/Other/Manager', grantedAt: null },
);
assert.equal(
  applyLegacyPreferredBookmarksUrl(migratedDefault, { version: 1, bookmarksManager: DEFAULT_BOOKMARKS_MANAGER_URL }),
  migratedDefault,
);
assert.equal(applyLegacyPreferredBookmarksUrl(migratedDefault, null), migratedDefault);
const customStore = sanitizeQdnAppRolesStore({
  version: 1,
  legacyMigrated: false,
  roles: { bookmarksManager: { url: 'qdn://APP/Chosen/Manager', grantedAt: null } },
});
assert.equal(
  applyLegacyPreferredBookmarksUrl(customStore, { version: 1, bookmarksManager: 'qdn://APP/Other/Manager' }),
  customStore,
);

// Once migration is complete the overlay is a durable no-op — a replayed
// legacy value can no longer move the routing URL.
const completedStore = { ...migratedDefault, legacyMigrated: true };
assert.equal(
  applyLegacyPreferredBookmarksUrl(completedStore, { version: 1, bookmarksManager: 'qdn://APP/Other/Manager' }),
  completedStore,
);

// IPC sender policy: only a Home shell window's own webContents may use the
// role-store surface; QDN app views and unknown senders are rejected.
assert.equal(isTrustedQdnAppRolesSender({ senderId: 7, isQdnView: false, shellWindowWebContentsIds: [3, 7] }), true);
assert.equal(isTrustedQdnAppRolesSender({ senderId: 7, isQdnView: true, shellWindowWebContentsIds: [3, 7] }), false);
assert.equal(isTrustedQdnAppRolesSender({ senderId: 9, isQdnView: false, shellWindowWebContentsIds: [3, 7] }), false);
assert.equal(isTrustedQdnAppRolesSender({ senderId: 9, isQdnView: false, shellWindowWebContentsIds: [] }), false);

console.log('QDN app role store tests passed.');
