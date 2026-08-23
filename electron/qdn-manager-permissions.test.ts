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
