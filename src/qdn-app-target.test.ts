import assert from 'node:assert/strict';
import { getQdnAppTargetQuery, isSameQdnAppRoute } from './qdn-app-target.js';
import { parseAppAddress } from './routes.js';

const chat = parseAppAddress('qdn://APP/Chat/Chat?address=Qsender');
const sameChat = parseAppAddress('qdn://APP/Chat/Chat?group=42');
const differentApp = parseAppAddress('qdn://APP/Names/Names');
const settings = parseAppAddress('home://settings');

assert.ok(chat.success && sameChat.success && differentApp.success && settings.success);

if (!chat.success || !sameChat.success || !differentApp.success || !settings.success) {
  throw new Error('Test routes failed to parse.');
}

assert.equal(isSameQdnAppRoute(chat.route, sameChat.route), true);
assert.equal(isSameQdnAppRoute(chat.route, differentApp.route), false);
assert.equal(isSameQdnAppRoute(chat.route, settings.route), false);
assert.deepEqual(getQdnAppTargetQuery(chat.route), { address: 'Qsender' });
assert.deepEqual(getQdnAppTargetQuery(sameChat.route), { group: '42' });
assert.equal(getQdnAppTargetQuery(differentApp.route), null);

console.log('QDN app target tests passed.');
