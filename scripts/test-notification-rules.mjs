import assert from 'node:assert/strict';
import {
  getQdnNotificationDefaultBody,
  matchesQdnNotificationRuleData,
  sanitizeQdnNotificationRuleInput,
  toWireNotificationSubscription,
} from '../dist-electron/notification-rules.js';

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
  /requires a signature or address/,
);

assert.deepEqual(toWireNotificationSubscription('qdn://APP/Test', storeRule(txStringRule)).filters, {
  address: 'Qanchor',
  txType: 'PAYMENT',
});
assert.deepEqual(toWireNotificationSubscription('qdn://APP/Test', storeRule(sanitizeRule(
  'TRANSACTION_CONFIRMED',
  { address: 'Qanchor', txType: ['PAYMENT'] },
))).filters, { address: 'Qanchor', txType: 'PAYMENT' });
assert.deepEqual(toWireNotificationSubscription('qdn://APP/Test', storeRule(txArrayRule)).filters, {
  address: 'Qanchor',
});
assert.deepEqual(toWireNotificationSubscription('qdn://APP/Test', storeRule({
  ...sanitizeRule('CHAT_MESSAGE', { involving: 'Qanchor' }),
  filters: { involving: ['Qone', 'Qtwo'] },
})).filters, { involving: 'Qone,Qtwo' });

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

console.log('QDN notification rule flexibility fixtures passed.');
