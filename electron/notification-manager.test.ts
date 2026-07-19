import assert from 'node:assert/strict';
import {
  applyQdnNotificationManagerMutation,
  getQdnNotificationManagerSummary,
  sanitizeQdnNotificationManagerMutation,
} from './notification-manager.js';
import type { QdnNotificationStore, StoredQdnNotificationRule } from './notification-rules.js';

const appOne = 'qdn://APP/Chat/Chat';
const appTwo = 'qdn://APP/Wallet/Wallet';
const createdAt = '2026-07-19T12:00:00.000Z';

const rule = (
  notificationId: string,
  event: StoredQdnNotificationRule['event'],
  filters: StoredQdnNotificationRule['filters'],
): StoredQdnNotificationRule => ({
  notificationId,
  event,
  filters,
  accountAddress: 'QprivateAccountBinding123456789',
  createdAt,
  title: `Title for ${notificationId}`,
  text: `Text for ${notificationId}`,
  link: 'qdn://APP/Chat/Chat/thread/1',
});

const makeStore = (): QdnNotificationStore => ({
  version: 1,
  revision: 7,
  grants: {
    [appTwo]: { grantedAt: '2026-07-18T12:00:00.000Z', muted: true },
    [appOne]: { grantedAt: '2026-07-17T12:00:00.000Z' },
  },
  rules: {
    [appOne]: [rule('mentions', 'CHAT_MESSAGE', { involving: 'QchatAccount' })],
    [appTwo]: [rule('btc-received', 'FOREIGN_PAYMENT_RECEIVED', {
      coin: 'BTC',
      xpub: 'xpub6RawSensitiveWalletKey',
    })],
  },
});

const original = makeStore();
const summary = getQdnNotificationManagerSummary(original);
assert.deepEqual(summary.apps.map((app) => app.appKey), [appOne, appTwo]);
assert.equal(summary.revision, 7);
assert.equal(summary.apps[0].grant?.muted, undefined);
assert.equal(summary.apps[1].grant?.muted, true);
assert.deepEqual(summary.apps[0].rules[0].filters, {});
assert.deepEqual(summary.apps[0].rules[0].maskedFilterKeys, ['involving']);
assert.deepEqual(summary.apps[1].rules[0].filters, { coin: 'BTC' });
assert.deepEqual(summary.apps[1].rules[0].maskedFilterKeys, ['xpub']);
assert.equal(JSON.stringify(summary).includes('xpub6RawSensitiveWalletKey'), false);
assert.equal(Object.hasOwn(summary.apps[0].rules[0], 'accountAddress'), false);

summary.apps[0].rules[0].filters.coin = 'changed';
assert.equal(original.rules[appOne][0].filters.involving, 'QchatAccount');

const withOrphanRule = makeStore();
delete withOrphanRule.grants[appOne];
const orphanSummary = getQdnNotificationManagerSummary(withOrphanRule);
assert.equal(orphanSummary.apps.find((app) => app.appKey === appOne)?.grant, null);

const malformedSummary = getQdnNotificationManagerSummary({
  ...makeStore(),
  rules: { [appOne]: [{ bad: true }] },
});
assert.deepEqual(malformedSummary.apps.find((app) => app.appKey === appOne)?.rules, []);

const muteSource = makeStore();
const muted = applyQdnNotificationManagerMutation(muteSource, {
  type: 'SET_APP_MUTED',
  appKey: appOne,
  muted: true,
});
assert.equal(muted.grants[appOne].muted, true);
assert.equal(muteSource.grants[appOne].muted, undefined);
const unmuted = applyQdnNotificationManagerMutation(muted, {
  type: 'SET_APP_MUTED',
  appKey: appOne,
  muted: false,
});
assert.equal(Object.hasOwn(unmuted.grants[appOne], 'muted'), false);
assert.throws(
  () => applyQdnNotificationManagerMutation(makeStore(), {
    type: 'SET_APP_MUTED', appKey: 'qdn://APP/Missing/Missing', muted: true,
  }),
  /permission is not granted/,
);

const removed = applyQdnNotificationManagerMutation(makeStore(), {
  type: 'REMOVE_APP_RULES',
  appKey: appOne,
  notificationIds: ['mentions', 'mentions'],
});
assert.equal(Object.hasOwn(removed.rules, appOne), false);
assert.equal(removed.rules[appTwo][0].notificationId, 'btc-received');
assert.equal(removed.grants[appOne].grantedAt, '2026-07-17T12:00:00.000Z');

const revoked = applyQdnNotificationManagerMutation(makeStore(), {
  type: 'REVOKE_APP',
  appKey: appTwo,
});
assert.equal(Object.hasOwn(revoked.grants, appTwo), false);
assert.equal(Object.hasOwn(revoked.rules, appTwo), false);
assert.equal(revoked.rules[appOne][0].notificationId, 'mentions');

assert.throws(
  () => sanitizeQdnNotificationManagerMutation({
    type: 'REPLACE_APP_RULES', appKey: appOne, rules: [],
  }),
  /type is not supported/,
);
assert.throws(
  () => sanitizeQdnNotificationManagerMutation({
    type: 'SET_APP_MUTED', appKey: appOne, muted: true, rules: [],
  }),
  /field rules is not supported/,
);
assert.throws(
  () => sanitizeQdnNotificationManagerMutation({
    type: 'REMOVE_APP_RULES', appKey: appOne, notificationIds: [],
  }),
  /requires at least one notification id/,
);
assert.throws(
  () => sanitizeQdnNotificationManagerMutation({
    type: 'REMOVE_APP_RULES', appKey: appOne, notificationIds: ['invalid id'],
  }),
  /Notification id is invalid/,
);
assert.throws(
  () => sanitizeQdnNotificationManagerMutation({ type: 'REVOKE_APP', appKey: '__proto__' }),
  /app key is invalid/,
);
assert.throws(
  () => sanitizeQdnNotificationManagerMutation({ type: 'REVOKE_APP', appKey: 'https://example.com' }),
  /app key is invalid/,
);

console.log('QDN notification manager contract fixtures passed.');
