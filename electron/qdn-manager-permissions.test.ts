import assert from 'node:assert/strict';
import {
  createEmptyQdnManagerPermissionStore,
  sanitizeQdnManagerAppKey,
  sanitizeQdnManagerPermissionStore,
} from './qdn-manager-permissions.js';

assert.deepEqual(createEmptyQdnManagerPermissionStore(), { version: 1, grants: {} });
assert.equal(sanitizeQdnManagerAppKey(' qdn://APP/Bookmarks/Bookmarks '), 'qdn://APP/Bookmarks/Bookmarks');
assert.equal(sanitizeQdnManagerAppKey('qdn://app/Bookmarks/Bookmarks/folder/item?x=1#part'), 'qdn://APP/Bookmarks/Bookmarks');
assert.throws(() => sanitizeQdnManagerAppKey('https://example.com'), /valid QDN APP or WEBSITE/);
assert.throws(() => sanitizeQdnManagerAppKey('qdn://APP/Bookmarks'), /valid QDN APP or WEBSITE/);

assert.deepEqual(sanitizeQdnManagerPermissionStore({
  version: 1,
  grants: {
    'qdn://APP/Bookmarks/Bookmarks': {
      'bookmarks.manage': { grantedAt: '2026-07-19T00:00:00.000Z' },
      'notifications.manage': { grantedAt: 42 },
      unknown: { grantedAt: '2026-07-19T00:00:00.000Z' },
    },
    'https://invalid.example': {
      'bookmarks.manage': { grantedAt: '2026-07-19T00:00:00.000Z' },
    },
  },
}), {
  version: 1,
  grants: {
    'qdn://APP/Bookmarks/Bookmarks': {
      'bookmarks.manage': { grantedAt: '2026-07-19T00:00:00.000Z' },
    },
  },
});

console.log('QDN manager permission tests passed.');
