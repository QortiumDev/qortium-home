import assert from 'node:assert/strict';
import { appendNotificationTargetQuery, getNotificationTargetQuery } from './notification-target.js';

assert.deepEqual(getNotificationTargetQuery({ sender: 'Qsender' }), { address: 'Qsender' });
assert.deepEqual(getNotificationTargetQuery({ txGroupId: 42 }), { group: '42' });
assert.deepEqual(getNotificationTargetQuery({ groupId: '77', sender: 'Qsender' }), { group: '77' });
assert.deepEqual(getNotificationTargetQuery({ txGroupId: 0, sender: 'Qsender', recipient: 'Qme' }), { address: 'Qsender' });
assert.deepEqual(getNotificationTargetQuery({ txGroupId: 0, sender: 'Qsender' }), { group: '0' });
assert.deepEqual(getNotificationTargetQuery({ sender: ' ', groupId: Number.NaN }), {});
assert.equal(
  appendNotificationTargetQuery('qdn://APP/Chat/Chat', { sender: 'Qsender', recipient: 'Qme' }, 'CHAT_MESSAGE'),
  'qdn://APP/Chat/Chat?address=Qsender',
);
assert.equal(
  appendNotificationTargetQuery('qdn://APP/Chat/Chat?view=unread', { txGroupId: 42 }, 'CHAT_MESSAGE'),
  'qdn://APP/Chat/Chat?view=unread&group=42',
);
assert.equal(
  appendNotificationTargetQuery('qdn://APP/Chat/Chat', { type: 'CHAT' }, 'CHAT_MESSAGE'),
  'qdn://APP/Chat/Chat',
);
assert.equal(
  appendNotificationTargetQuery('home://dashboard', { sender: 'Qsender' }, 'CHAT_MESSAGE'),
  'home://dashboard',
);
assert.equal(
  appendNotificationTargetQuery('core:///admin/status', { sender: 'Qsender' }, 'CHAT_MESSAGE'),
  'core:///admin/status',
);
assert.equal(
  appendNotificationTargetQuery('qdn://APP/Wallet/Wallet?address=Qconfigured', { sender: 'Qsender' }, 'PAYMENT_RECEIVED'),
  'qdn://APP/Wallet/Wallet?address=Qconfigured',
);

console.log('Notification target tests passed.');
