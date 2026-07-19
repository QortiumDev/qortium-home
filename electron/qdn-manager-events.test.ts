import assert from 'node:assert/strict';
import {
  QDN_MANAGER_EVENT_NAMES,
  QDN_MANAGER_MESSAGE_TYPES,
  getQdnManagerRevisionEventDetail,
  validateQdnManagerRevisions,
} from './qdn-manager-events.js';

assert.deepEqual(validateQdnManagerRevisions({ bookmarkManager: 4, notificationManager: 9 }), {
  bookmarkManager: 4,
  notificationManager: 9,
});
assert.deepEqual(getQdnManagerRevisionEventDetail(7), { revision: 7 });
assert.deepEqual(Object.keys(getQdnManagerRevisionEventDetail(7)), ['revision']);

assert.equal(QDN_MANAGER_EVENT_NAMES.bookmarkManager, 'qortiumBookmarkManagerChanged');
assert.equal(QDN_MANAGER_EVENT_NAMES.notificationManager, 'qortiumNotificationManagerChanged');
assert.equal(QDN_MANAGER_MESSAGE_TYPES.bookmarkManager, 'qortium:bookmark-manager-changed');
assert.equal(QDN_MANAGER_MESSAGE_TYPES.notificationManager, 'qortium:notification-manager-changed');
assert.notEqual(QDN_MANAGER_EVENT_NAMES.bookmarkManager, QDN_MANAGER_EVENT_NAMES.notificationManager);

assert.throws(
  () => validateQdnManagerRevisions({ bookmarkManager: -1, notificationManager: 0 }),
  /bookmarkManager must be a non-negative safe integer/,
);
assert.throws(
  () => validateQdnManagerRevisions({ bookmarkManager: 0, notificationManager: 1.5 }),
  /notificationManager must be a non-negative safe integer/,
);
assert.throws(
  () => validateQdnManagerRevisions({ bookmarkManager: 0, notificationManager: 0, bookmarks: [] }),
  /bookmarks is not supported/,
);

console.log('QDN manager event tests passed.');
