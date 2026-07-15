import assert from 'node:assert/strict';
import { appendNotificationTargetQuery, getNotificationTargetQuery } from './notification-target.js';

assert.deepEqual(getNotificationTargetQuery({ sender: 'Qsender' }), { address: 'Qsender' });
assert.deepEqual(getNotificationTargetQuery({ txGroupId: 42 }), { group: '42' });
assert.deepEqual(getNotificationTargetQuery({ groupId: '77', sender: 'Qsender' }), { group: '77' });
assert.deepEqual(getNotificationTargetQuery({ txGroupId: 0, sender: 'Qsender' }), { address: 'Qsender' });
assert.deepEqual(getNotificationTargetQuery({ sender: ' ', groupId: Number.NaN }), {});
assert.equal(
  appendNotificationTargetQuery('qdn://APP/Chat/Chat', { sender: 'Qsender' }),
  'qdn://APP/Chat/Chat?address=Qsender',
);
assert.equal(
  appendNotificationTargetQuery('qdn://APP/Chat/Chat?view=unread', { txGroupId: 42 }),
  'qdn://APP/Chat/Chat?view=unread&group=42',
);
assert.equal(
  appendNotificationTargetQuery('qdn://APP/Chat/Chat', { type: 'CHAT' }),
  'qdn://APP/Chat/Chat',
);

console.log('Notification target tests passed.');
