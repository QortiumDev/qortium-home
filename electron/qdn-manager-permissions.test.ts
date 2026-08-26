import assert from 'node:assert/strict';
import {
  createDefaultQdnAppRolesStore,
  grantQdnAppCapability,
  revokeQdnAppCapability,
  sanitizeQdnAppAssignmentUrl,
  sanitizeQdnAppRolesStore,
  setQdnAppAssignment,
  storeHoldsQdnAppCapability,
} from './qdn-manager-permissions.js';

assert.equal(
  sanitizeQdnAppAssignmentUrl(' qdn://app/Explore/Explore#/service/VIDEO '),
  'qdn://APP/Explore/Explore#/service/VIDEO',
);
assert.equal(
  sanitizeQdnAppAssignmentUrl('qdn://WEBSITE/Media/Home/path?tab=1#video'),
  'qdn://WEBSITE/Media/Home/path?tab=1#video',
);
assert.equal(sanitizeQdnAppAssignmentUrl('qdn://APP/Chat#/rooms'), 'qdn://APP/Chat#/rooms');
assert.throws(() => sanitizeQdnAppAssignmentUrl('https://example.com'), /valid QDN APP or WEBSITE/);
assert.throws(() => sanitizeQdnAppAssignmentUrl('qdn://APP'), /valid QDN APP or WEBSITE/);

const defaults = createDefaultQdnAppRolesStore();
assert.equal(defaults.version, 2);
assert.equal(defaults.assignments.bookmarks.url, 'qdn://APP/Bookmarks/Bookmarks');
assert.equal(defaults.assignments.explore.url, 'qdn://APP/Explore/Explore');
// Both segments: a bare qdn://APP/Apps would normalize to identifier `default`,
// which is not published.
assert.equal(defaults.assignments.apps.url, 'qdn://APP/Apps/Apps');

// An existing v2 store written before the `apps` role gains it on read, because
// sanitizeQdnAppRolesStore starts from the shipped defaults and overlays the
// persisted assignments on top. No migration step is needed.
const withoutApps = sanitizeQdnAppRolesStore({
  accountCapabilityGrants: {},
  assignments: {
    bookmarks: { description: null, label: 'Bookmarks', url: 'qdn://APP/Mine/Bookmarks' },
    explore: { description: null, label: 'Explore', url: 'qdn://APP/Explore/Explore' },
    notifications: { description: null, label: 'Notifications', url: 'qdn://APP/Notify/Notify' },
  },
  capabilityGrants: {},
  legacyMigrated: true,
  revision: 4,
  version: 2,
});
assert.equal(withoutApps.assignments.apps.url, 'qdn://APP/Apps/Apps');
assert.equal(withoutApps.assignments.apps.label, 'Apps');
// The user's own choices are untouched by the added default.
assert.equal(withoutApps.assignments.bookmarks.url, 'qdn://APP/Mine/Bookmarks');
assert.equal(withoutApps.revision, 4);

const assigned = setQdnAppAssignment(defaults, {
  description: 'Play videos from any QDN app.',
  label: 'Video player',
  role: 'media.video-player',
  url: 'qdn://APP/Explore/Explore#/service/VIDEO',
});
assert.deepEqual(assigned.assignments['media.video-player'], {
  description: 'Play videos from any QDN app.',
  label: 'Video player',
  url: 'qdn://APP/Explore/Explore#/service/VIDEO',
});
assert.equal(assigned.revision, 1);

// A capability is independent from the selected target and survives an
// assignment change only when the user explicitly granted it to that app.
const granted = grantQdnAppCapability(assigned, 'qdn://APP/Bookmarks/Bookmarks#/list/all', 'bookmarks.manage');
assert.equal(storeHoldsQdnAppCapability(granted, 'qdn://APP/Bookmarks/Bookmarks', 'bookmarks.manage'), true);
const moved = setQdnAppAssignment(granted, { role: 'bookmarks', url: 'qdn://APP/Other/Bookmarks#/saved' });
assert.equal(storeHoldsQdnAppCapability(moved, 'qdn://APP/Bookmarks/Bookmarks', 'bookmarks.manage'), true);
assert.equal(storeHoldsQdnAppCapability(moved, 'qdn://APP/Other/Bookmarks', 'bookmarks.manage'), false);
const revokedGrant = revokeQdnAppCapability(moved, 'qdn://APP/Bookmarks/Bookmarks', 'bookmarks.manage');
assert.equal(storeHoldsQdnAppCapability(revokedGrant, 'qdn://APP/Bookmarks/Bookmarks', 'bookmarks.manage'), false);
assert.equal(revokedGrant.revision, moved.revision + 1);
assert.equal(revokeQdnAppCapability(revokedGrant, 'qdn://APP/Bookmarks/Bookmarks', 'bookmarks.manage'), revokedGrant);

// The old fixed-role v1 shape migrates its selected URL but deliberately drops
// its role-bound grant rather than widening it into an independent permission.
const migrated = sanitizeQdnAppRolesStore({
  version: 1,
  roles: {
    bookmarksManager: { url: 'qdn://APP/Old/Bookmarks', grantedAt: '2026-07-01T00:00:00.000Z' },
    notificationsManager: { url: null, grantedAt: null },
  },
});
assert.equal(migrated.version, 2);
assert.equal(migrated.assignments.bookmarks.url, 'qdn://APP/Old/Bookmarks');
assert.equal(migrated.assignments.notifications.url, null);
assert.equal(storeHoldsQdnAppCapability(migrated, 'qdn://APP/Old/Bookmarks', 'bookmarks.manage'), false);

assert.throws(() => setQdnAppAssignment(defaults, { role: 'constructor', url: 'qdn://APP/Bad/App' }), /stable lowercase/);
assert.throws(() => setQdnAppAssignment(defaults, { role: 'video player', url: 'qdn://APP/Bad/App' }), /stable lowercase/);

console.log('QDN app assignment store tests passed.');
