import assert from 'node:assert/strict';
import type { QdnAppRolesStore } from '../electron/qdn-manager-permissions';
import {
  formatQdnManagerPermissionTime,
  getQdnAppRoleSaveState,
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

// Role fields start empty and only become savable for a valid replacement.
assert.deepEqual(getQdnAppRoleSaveState('', 'qdn://APP/Bookmarks/Bookmarks'), {
  changed: false,
  normalized: null,
  valid: false,
});
assert.deepEqual(getQdnAppRoleSaveState('qdn://app/Bookmarks/Bookmarks', 'qdn://APP/Bookmarks/Bookmarks'), {
  changed: false,
  normalized: 'qdn://APP/Bookmarks/Bookmarks',
  valid: true,
});
assert.deepEqual(getQdnAppRoleSaveState('qdn://APP/Other/Manager', 'qdn://APP/Bookmarks/Bookmarks'), {
  changed: true,
  normalized: 'qdn://APP/Other/Manager',
  valid: true,
});
assert.deepEqual(getQdnAppRoleSaveState('not a QDN URL', 'qdn://APP/Bookmarks/Bookmarks'), {
  changed: true,
  normalized: null,
  valid: false,
});

console.log('QDN apps panel model fixtures passed.');
