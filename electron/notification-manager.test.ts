import assert from 'node:assert/strict';
import {
  applyQdnNotificationManagerMutation,
  getQdnNotificationManagerSummary,
  sanitizeQdnNotificationManagerMutation,
} from './notification-manager.js';
import type { QdnNotificationStore, StoredQdnNotificationRule } from './notification-rules.js';

const appOne = 'qdn://APP/Chat/Chat';
const appTwo = 'qdn://APP/Wallet/Wallet';
const appThree = 'qdn://APP/Trust/Trust';
const createdAt = '2026-07-19T12:00:00.000Z';

// A real, checksum-valid Qortal address (and a one-character-mutated invalid
// sibling) so the address-visibility tests exercise actual validation rather
// than a naive shape check.
const validAddress = 'QT4zHex8JEULmBhYmKd5UhpiNA46T5wUko';
const invalidAddress = 'QT4zHex8JEULmBhYmKd5UhpiNA46T5wUkn';

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
    [appThree]: [
      rule('valid-single', 'PAYMENT_RECEIVED', { recipient: validAddress, sender: invalidAddress }),
      rule('mixed-array', 'TRANSACTION_CONFIRMED', { address: [validAddress, invalidAddress] }),
      rule('signature-stays-masked', 'TRANSACTION_CONFIRMED', { signature: validAddress }),
    ],
  },
});

const original = makeStore();
const summary = getQdnNotificationManagerSummary(original);
const summaryApp = (appKey: string) => summary.apps.find((app) => app.appKey === appKey)!;
assert.deepEqual(summary.apps.map((app) => app.appKey), [appOne, appThree, appTwo]);
assert.equal(summary.revision, 7);
assert.equal(summaryApp(appOne).grant?.muted, undefined);
assert.equal(summaryApp(appTwo).grant?.muted, true);
assert.equal(summaryApp(appThree).grant, null);

// Invalid-looking "address" values (not real Qortal addresses) stay masked.
assert.deepEqual(summaryApp(appOne).rules[0].filters, {});
assert.deepEqual(summaryApp(appOne).rules[0].maskedFilterKeys, ['involving']);
assert.deepEqual(summaryApp(appOne).rules[0].partiallyMaskedFilterKeys, []);

// xpub stays masked regardless of address validity handling.
assert.deepEqual(summaryApp(appTwo).rules[0].filters, { coin: 'BTC' });
assert.deepEqual(summaryApp(appTwo).rules[0].maskedFilterKeys, ['xpub']);
assert.equal(JSON.stringify(summary).includes('xpub6RawSensitiveWalletKey'), false);

// A valid Qortal address filter is exposed; an invalid one on the same rule stays masked.
const validSingleRule = summaryApp(appThree).rules.find((r) => r.notificationId === 'valid-single')!;
assert.deepEqual(validSingleRule.filters, { recipient: validAddress });
assert.deepEqual(validSingleRule.maskedFilterKeys, ['sender']);
assert.deepEqual(validSingleRule.partiallyMaskedFilterKeys, []);

// A mixed array keeps only the valid addresses and flags the omission explicitly.
const mixedArrayRule = summaryApp(appThree).rules.find((r) => r.notificationId === 'mixed-array')!;
assert.deepEqual(mixedArrayRule.filters, { address: [validAddress] });
assert.deepEqual(mixedArrayRule.maskedFilterKeys, []);
assert.deepEqual(mixedArrayRule.partiallyMaskedFilterKeys, ['address']);

// signature never gets exposed, even when its value happens to be a valid Qortal address.
const signatureRule = summaryApp(appThree).rules.find((r) => r.notificationId === 'signature-stays-masked')!;
assert.deepEqual(signatureRule.filters, {});
assert.deepEqual(signatureRule.maskedFilterKeys, ['signature']);
assert.equal(JSON.stringify(summary).includes(validAddress), true, 'valid address is exposed somewhere in the summary');

assert.equal(Object.hasOwn(summaryApp(appOne).rules[0], 'accountAddress'), false);

summaryApp(appOne).rules[0].filters.coin = 'changed';
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
