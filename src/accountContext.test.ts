import assert from 'node:assert/strict';
import { captureSavedAccountContext, getSavedAccountContext, normalizeSavedAccountId } from './accountContext';
import { SAVED_GUEST_ACCOUNT_ID } from './bookmarkManagerContract';

for (const scheme of ['qdn', 'qortal']) {
  const address = `${scheme}://APP/Chat/default`;
  assert.equal(getSavedAccountContext(address, null), null, 'legacy Current stays Current');
  assert.equal(getSavedAccountContext(address, undefined), null);
  assert.equal(captureSavedAccountContext(address, null), SAVED_GUEST_ACCOUNT_ID);
  assert.equal(captureSavedAccountContext(address, 'wallet:example:1'), 'wallet:example:1');
  assert.equal(captureSavedAccountContext(address, SAVED_GUEST_ACCOUNT_ID), SAVED_GUEST_ACCOUNT_ID);
  assert.equal(getSavedAccountContext(address, SAVED_GUEST_ACCOUNT_ID), SAVED_GUEST_ACCOUNT_ID);
}
for (const address of ['home://dashboard', 'core://status', 'qortal-core://status']) {
  assert.equal(captureSavedAccountContext(address, null), null);
  assert.equal(captureSavedAccountContext(address, 'wallet:example'), null);
}
assert.equal(normalizeSavedAccountId(` ${SAVED_GUEST_ACCOUNT_ID} `), SAVED_GUEST_ACCOUNT_ID);
console.log('Saved account context tests passed.');
