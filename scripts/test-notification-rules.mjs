import assert from 'node:assert/strict';
import {
  capForeignPaymentWireSubscriptions,
  coreSupportsArrayFilters,
  coreSupportsV15Notifications,
  ForeignPaymentReplayDeduper,
  getQdnNotificationDefaultBody,
  matchesQdnNotificationRuleData,
  sanitizeQdnNotificationRuleInput,
  sanitizeQdnNotificationStore,
  sanitizeQdnNotificationSubscriptions,
  stripWireNotificationIdSuffix,
  toWireNotificationSubscription,
  toWireNotificationSubscriptions,
} from '../dist-electron/notification-rules.js';

assert.equal(coreSupportsArrayFilters(undefined), false);
assert.equal(coreSupportsArrayFilters('not-a-version'), false);
assert.equal(coreSupportsArrayFilters('qortium-1.3.5-abcdef0'), false);
assert.equal(coreSupportsArrayFilters('qortium-1.4.0-abcdef0'), true);
assert.equal(coreSupportsArrayFilters('qortium-1.4.1-abcdef0'), true);
assert.equal(coreSupportsArrayFilters('qortium-1.5.0-abcdef0'), true);
assert.equal(coreSupportsArrayFilters('qortium-2.0.0-abcdef0'), true);
assert.equal(coreSupportsArrayFilters('qortium-1.4.0-prerelease.0-abcdef0'), true);
assert.equal(coreSupportsV15Notifications(undefined), false);
assert.equal(coreSupportsV15Notifications('qortium-1.4.9-abcdef0'), false);
assert.equal(coreSupportsV15Notifications('qortium-1.5.0-abcdef0'), true);
assert.equal(coreSupportsV15Notifications('qortium-2.0.0-abcdef0'), true);

const sanitizeText = (value, maxLength) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : null;

const sanitizeRule = (event, filters, notificationId = 'fixture') =>
  sanitizeQdnNotificationRuleInput({ event, filters, notificationId }, sanitizeText);

const storeRule = (rule) => ({
  ...rule,
  accountAddress: 'QfixtureAccountAddress1234567890',
  createdAt: '2026-07-10T00:00:00.000Z',
});

const txStringRule = sanitizeRule('TRANSACTION_CONFIRMED', {
  address: 'Qanchor',
  txType: ' payment ',
});
assert.equal(txStringRule.filters.txType, 'PAYMENT');

const txArrayRule = sanitizeRule('TRANSACTION_CONFIRMED', {
  address: 'Qanchor',
  txType: [' payment ', 'RATE_ACCOUNT', 'PAYMENT'],
});
assert.deepEqual(txArrayRule.filters.txType, ['PAYMENT', 'RATE_ACCOUNT']);
assert.throws(
  () => sanitizeRule('TRANSACTION_CONFIRMED', { address: 'Qanchor', txType: [] }),
  /txType must be a non-empty string or array of non-empty strings/,
);
assert.throws(
  () => sanitizeRule('TRANSACTION_CONFIRMED', { address: 'Qanchor', txType: ['PAYMENT', 2] }),
  /txType must be a non-empty string or array of non-empty strings/,
);
assert.throws(
  () => sanitizeRule('TRANSACTION_CONFIRMED', { address: 'Qanchor', txType: ['PAYMENT', ' '] }),
  /txType must be a non-empty string or array of non-empty strings/,
);
assert.throws(
  () => sanitizeRule('TRANSACTION_CONFIRMED', { txType: ['PAYMENT', 'RATE_ACCOUNT'] }),
  /requires a signature, address, or groupId/,
);

const groupOnlyRule = sanitizeRule('TRANSACTION_CONFIRMED', { groupId: ' 123 ' }, 'group-only');
assert.deepEqual(groupOnlyRule.filters, { groupId: '123' });
const groupArrayRule = sanitizeRule('TRANSACTION_CONFIRMED', { groupId: [' 123 ', '456', '123'] }, 'group-array');
assert.deepEqual(groupArrayRule.filters, { groupId: ['123', '456'] });
assert.throws(
  () => sanitizeRule('TRANSACTION_CONFIRMED', { groupId: [] }, 'empty-group-array'),
  /groupId must be a non-empty string or array of non-empty strings/,
);

assert.deepEqual(toWireNotificationSubscription('qdn://APP/Test', storeRule(txStringRule)).filters, {
  address: 'Qanchor',
  txType: 'PAYMENT',
});
assert.deepEqual(toWireNotificationSubscription('qdn://APP/Test', storeRule(sanitizeRule(
  'TRANSACTION_CONFIRMED',
  { address: 'Qanchor', txType: ['PAYMENT'] },
)), { serverSupportsArrayFilters: true }).filters, { address: 'Qanchor', txType: 'PAYMENT' });
assert.deepEqual(toWireNotificationSubscription('qdn://APP/Test', storeRule(txArrayRule), {
  serverSupportsArrayFilters: false,
}).filters, {
  address: 'Qanchor',
});
assert.deepEqual(toWireNotificationSubscriptions('qdn://APP/Test', storeRule(groupOnlyRule), {
  serverSupportsArrayFilters: false,
  serverSupportsV15Notifications: false,
}), []);
assert.deepEqual(toWireNotificationSubscription('qdn://APP/Test', storeRule(groupArrayRule), {
  serverSupportsArrayFilters: true,
  serverSupportsV15Notifications: true,
}).filters, { groupId: ['123', '456'] });
assert.deepEqual(toWireNotificationSubscription('qdn://APP/Test', storeRule(sanitizeRule(
  'TRANSACTION_CONFIRMED', { address: 'Qanchor', groupId: '123' }, 'group-and-address',
)), {
  serverSupportsArrayFilters: false,
  serverSupportsV15Notifications: false,
}).filters, { address: 'Qanchor' });
assert.deepEqual(toWireNotificationSubscription('qdn://APP/Test', storeRule(txArrayRule), {
  serverSupportsArrayFilters: true,
}).filters, {
  address: 'Qanchor',
  txType: ['PAYMENT', 'RATE_ACCOUNT'],
});
for (const [event, key] of [
  ['PAYMENT_RECEIVED', 'sender'],
  ['PAYMENT_RECEIVED', 'recipient'],
  ['TRANSACTION_CONFIRMED', 'address'],
  ['TRANSACTION_CONFIRMED', 'signature'],
  ['CHAT_MESSAGE', 'involving'],
]) {
  const rule = sanitizeRule(event, { [key]: [' ValueOne ', 'ValueTwo', 'ValueOne'] }, `array-${key}`);
  assert.deepEqual(rule.filters[key], ['ValueOne', 'ValueTwo']);
  assert.throws(
    () => sanitizeRule(event, { [key]: [] }, `empty-${key}`),
    new RegExp(`${key} must be a non-empty string or array of non-empty strings`),
  );
  assert.throws(
    () => sanitizeRule(event, { [key]: ['ValueOne', 2] }, `non-string-${key}`),
    new RegExp(`${key} must be a non-empty string or array of non-empty strings`),
  );
  assert.throws(
    () => sanitizeRule(event, { [key]: ['ValueOne', ' '] }, `blank-${key}`),
    new RegExp(`${key} must be a non-empty string or array of non-empty strings`),
  );
}

const involvingArrayRule = storeRule(sanitizeRule('CHAT_MESSAGE', {
  involving: ['Qone', 'Qtwo'],
}, 'involving-array'));
assert.deepEqual(toWireNotificationSubscription('qdn://APP/Test', involvingArrayRule, {
  serverSupportsArrayFilters: true,
}).filters, { involving: ['Qone', 'Qtwo'] });
assert.deepEqual(toWireNotificationSubscriptions('qdn://APP/Test', involvingArrayRule, {
  serverSupportsArrayFilters: false,
}).map((subscription) => ({ filters: subscription.filters, notificationId: subscription.notificationId })), [
  { filters: { involving: 'Qone' }, notificationId: 'involving-array~0' },
  { filters: { involving: 'Qtwo' }, notificationId: 'involving-array~1' },
]);
assert.equal(stripWireNotificationIdSuffix('involving-array~1'), 'involving-array');
assert.equal(stripWireNotificationIdSuffix('plain-id'), 'plain-id');
assert.throws(
  () => sanitizeRule('PAYMENT_RECEIVED', {
    recipient: ['Qone', 'Qtwo', 'Qthree', 'Qfour', 'Qfive'],
    sender: ['Qa', 'Qb', 'Qc', 'Qd', 'Qe'],
  }, 'too-many-combinations'),
  /expand to more than 20 value combinations/,
);

const foreignPaymentRule = sanitizeRule('FOREIGN_PAYMENT_RECEIVED', {
  coin: ' btc ',
  xpub: ' xpub6Example ',
}, 'btc-receipts');
assert.deepEqual(foreignPaymentRule.filters, { coin: 'BTC', xpub: 'xpub6Example' });
assert.throws(
  () => sanitizeRule('FOREIGN_PAYMENT_RECEIVED', { xpub: 'xpub6Example' }, 'missing-coin'),
  /requires coin and xpub/,
);
assert.throws(
  () => sanitizeRule('FOREIGN_PAYMENT_RECEIVED', { coin: 'BTC' }, 'missing-xpub'),
  /requires coin and xpub/,
);
assert.throws(
  () => sanitizeRule('FOREIGN_PAYMENT_RECEIVED', { coin: ' ', xpub: 'xpub6Example' }, 'empty-coin'),
  /coin must be a non-empty string/,
);
assert.deepEqual(toWireNotificationSubscriptions('qdn://APP/Wallet', storeRule(foreignPaymentRule), {
  serverSupportsArrayFilters: true,
  serverSupportsV15Notifications: false,
}), []);
assert.deepEqual(toWireNotificationSubscription('qdn://APP/Wallet', storeRule(foreignPaymentRule), {
  serverSupportsArrayFilters: true,
  serverSupportsV15Notifications: true,
}).filters, { coin: 'BTC', xpub: 'xpub6Example' });
assert.throws(
  () => sanitizeQdnNotificationSubscriptions(Array.from({ length: 21 }, (_, index) => ({
    notificationId: `foreign-${index}`,
    event: 'FOREIGN_PAYMENT_RECEIVED',
    filters: { coin: 'BTC', xpub: `xpub${index}` },
  })), sanitizeText),
  /at most 20 notification rules/,
);
assert.deepEqual(sanitizeQdnNotificationStore({
  version: 1,
  grants: { 'qdn://APP/Wallet': { grantedAt: '2026-07-15T00:00:00.000Z' } },
  rules: { 'qdn://APP/Wallet': [storeRule(foreignPaymentRule)] },
}).rules['qdn://APP/Wallet']?.[0].filters, { coin: 'BTC', xpub: 'xpub6Example' });
assert.deepEqual(toWireNotificationSubscriptions('qdn://APP/Test', storeRule(sanitizeRule(
  'PAYMENT_RECEIVED', { sender: ['Qsender'] }, 'sender-one',
)), { serverSupportsArrayFilters: false }).map((subscription) => subscription.filters), [{ sender: 'Qsender' }]);
assert.doesNotThrow(() => sanitizeRule('PAYMENT_RECEIVED', { recipient: ['Qrecipient'] }, 'payment-array'));
assert.doesNotThrow(() => sanitizeRule('TRANSACTION_CONFIRMED', { address: ['Qanchor'] }, 'tx-array'));
assert.deepEqual(toWireNotificationSubscription('qdn://APP/Test', storeRule(sanitizeRule(
  'RESOURCE_PUBLISHED',
  { service: 'APP', names: ['Qone', 'Qtwo'] },
)), { serverSupportsArrayFilters: true }).resourceFilter, {
  service: 'APP',
  names: ['Qone', 'Qtwo'],
});

const paymentRule = sanitizeRule('PAYMENT_RECEIVED', {
  sender: 'Qsender',
  amount: '1.25000000',
  created: 1783632000000,
  signature: 'signature',
});
assert.deepEqual(paymentRule.filters, {
  sender: 'Qsender',
  amount: '1.25000000',
  created: 1783632000000,
  signature: 'signature',
});
assert.doesNotThrow(() => sanitizeRule('PAYMENT_RECEIVED', { recipient: 'Qrecipient' }));
assert.throws(
  () => sanitizeRule('PAYMENT_RECEIVED', { signature: 'signature' }),
  /requires a recipient or sender/,
);
assert.throws(
  () => sanitizeRule('PAYMENT_RECEIVED', { sender: 'Qsender', created: Number.NaN }),
  /created must be a finite number/,
);

const storedTxArrayRule = storeRule(txArrayRule);
assert.equal(matchesQdnNotificationRuleData(storedTxArrayRule, { type: 'payment' }), true);
assert.equal(matchesQdnNotificationRuleData(storedTxArrayRule, { type: 'ARBITRARY' }), false);
assert.equal(matchesQdnNotificationRuleData(storedTxArrayRule, undefined), false);

const sender = 'Qabc1234567890123456789012345xyz9';
assert.equal(
  getQdnNotificationDefaultBody(storedTxArrayRule, { type: 'PAYMENT', sender }),
  'PAYMENT from Qabc12…xyz9',
);
assert.equal(
  getQdnNotificationDefaultBody(storeRule(paymentRule), { amount: '1.25', sender }),
  '1.25 from Qabc12…xyz9',
);
assert.equal(
  getQdnNotificationDefaultBody(storeRule(paymentRule), { sender }),
  'From Qabc12…xyz9',
);
const chatRule = storeRule(sanitizeRule('CHAT_MESSAGE', { involving: 'Qanchor' }));
assert.equal(getQdnNotificationDefaultBody(chatRule, { sender, txGroupId: 0 }), 'From Qabc12…xyz9');
assert.equal(getQdnNotificationDefaultBody(chatRule, { sender, txGroupId: 42 }), 'In group 42');
const hostileBody = getQdnNotificationDefaultBody(
  storedTxArrayRule,
  { type: `PAY\u202eMENT\n${'x'.repeat(10_000)}` },
);
assert.equal(hostileBody?.length, 240);
assert.match(hostileBody ?? '', /^PAYMENTx+$/);
assert.doesNotMatch(hostileBody ?? '', /[\u0000-\u001f\u202a-\u202e]/);
assert.equal(
  getQdnNotificationDefaultBody(storeRule(sanitizeRule('RESOURCE_PUBLISHED', { service: 'APP' })), { name: 'Test' }),
  undefined,
);
assert.equal(
  getQdnNotificationDefaultBody(storeRule(foreignPaymentRule), { amount: '0.12345678', coin: 'btc' }),
  'Received 0.12345678 BTC',
);
const replayDeduper = new ForeignPaymentReplayDeduper();
const foreignPush = { coin: 'BTC', txHash: 'abc123', address: 'bc1fixture', checkpoint: 'checkpoint-a' };
assert.equal(replayDeduper.hasDelivered(foreignPush), false);
replayDeduper.markDelivered(foreignPush);
assert.equal(replayDeduper.hasDelivered(foreignPush), true);
assert.equal(replayDeduper.hasDelivered({ ...foreignPush, checkpoint: 'checkpoint-b' }), true);
assert.equal(replayDeduper.hasDelivered({ ...foreignPush, txHash: 'different' }), false);

const foreignWireSub = (index) => ({
  event: 'FOREIGN_PAYMENT_RECEIVED',
  notificationId: `foreign-${index}`,
});
const otherWireSub = { event: 'TRANSACTION_CONFIRMED', notificationId: 'confirmed-keep' };
const cappedWire = capForeignPaymentWireSubscriptions([
  otherWireSub,
  ...Array.from({ length: 25 }, (_, index) => foreignWireSub(index)),
]);
assert.equal(cappedWire.filter((sub) => sub.event === 'FOREIGN_PAYMENT_RECEIVED').length, 20);
assert.equal(cappedWire[0], otherWireSub);
assert.equal(cappedWire.some((sub) => sub.notificationId === 'foreign-19'), true);
assert.equal(cappedWire.some((sub) => sub.notificationId === 'foreign-20'), false);
assert.equal(capForeignPaymentWireSubscriptions([otherWireSub, foreignWireSub(0)]).length, 2);

console.log('QDN notification rule flexibility fixtures passed.');
