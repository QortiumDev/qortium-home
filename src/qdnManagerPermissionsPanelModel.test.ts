import assert from 'node:assert/strict';
import type { QdnManagerPermissionStore } from '../electron/qdn-manager-permissions';
import {
  formatQdnManagerPermissionTime,
  getQdnManagerPermissionAppName,
  getQdnManagerPermissionRows,
} from './qdnManagerPermissionsPanelModel';

const store: QdnManagerPermissionStore = {
  version: 1,
  grants: {
    'qdn://WEBSITE/Zed/Home': {
      'notifications.manage': { grantedAt: '2026-07-19T15:30:00.000Z' },
    },
    'qdn://APP/Bookmarks/Bookmarks': {
      'notifications.manage': { grantedAt: '2026-07-19T14:00:00.000Z' },
      'bookmarks.manage': { grantedAt: '2026-07-19T13:00:00.000Z' },
    },
  },
};

assert.deepEqual(getQdnManagerPermissionRows(null), []);
assert.deepEqual(getQdnManagerPermissionRows(store), [
  {
    appKey: 'qdn://APP/Bookmarks/Bookmarks',
    capability: 'bookmarks.manage',
    grantedAt: '2026-07-19T13:00:00.000Z',
  },
  {
    appKey: 'qdn://APP/Bookmarks/Bookmarks',
    capability: 'notifications.manage',
    grantedAt: '2026-07-19T14:00:00.000Z',
  },
  {
    appKey: 'qdn://WEBSITE/Zed/Home',
    capability: 'notifications.manage',
    grantedAt: '2026-07-19T15:30:00.000Z',
  },
]);
assert.equal(getQdnManagerPermissionAppName('qdn://APP/My%20Bookmarks/Bookmarks'), 'My Bookmarks');
assert.equal(getQdnManagerPermissionAppName('not-a-qdn-url'), 'not-a-qdn-url');
assert.equal(formatQdnManagerPermissionTime('invalid'), 'invalid');
assert.match(formatQdnManagerPermissionTime('2026-07-19T15:30:00.000Z', 'en-US'), /2026/);

console.log('QDN manager permission panel model fixtures passed.');
