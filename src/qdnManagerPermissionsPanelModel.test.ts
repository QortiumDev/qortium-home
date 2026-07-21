import assert from 'node:assert/strict';
import type { QdnAppRolesStore } from '../electron/qdn-manager-permissions';
import {
  formatQdnManagerPermissionTime,
  getQdnAppRoleRows,
  getQdnManagerPermissionAppName,
} from './qdnManagerPermissionsPanelModel';

const store: QdnAppRolesStore = {
  version: 1,
  legacyMigrated: true,
  roles: {
    bookmarksManager: { url: 'qdn://APP/Bookmarks/Bookmarks', grantedAt: '2026-07-19T13:00:00.000Z' },
    notificationsManager: { url: null, grantedAt: null },
  },
};

assert.deepEqual(getQdnAppRoleRows(null), []);
// One row per role, in fixed role order; unassigned roles still get a row.
assert.deepEqual(getQdnAppRoleRows(store), [
  {
    role: 'bookmarksManager',
    url: 'qdn://APP/Bookmarks/Bookmarks',
    grantedAt: '2026-07-19T13:00:00.000Z',
  },
  {
    role: 'notificationsManager',
    url: null,
    grantedAt: null,
  },
]);
assert.equal(getQdnManagerPermissionAppName('qdn://APP/My%20Bookmarks/Bookmarks'), 'My Bookmarks');
assert.equal(getQdnManagerPermissionAppName('not-a-qdn-url'), 'not-a-qdn-url');
assert.equal(formatQdnManagerPermissionTime('invalid'), 'invalid');
assert.match(formatQdnManagerPermissionTime('2026-07-19T15:30:00.000Z', 'en-US'), /2026/);

console.log('QDN apps panel model fixtures passed.');
