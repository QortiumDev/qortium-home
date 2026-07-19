import assert from 'node:assert/strict';
import {
  isQdnRequestContextCurrent,
  resolveQdnRequestContextActive,
} from './qdnRequestContext';

const requestFrame = {};

// An approval dialog may suspend the frame visually, but the active tab and
// frame identity remain current for the request that opened that dialog.
const activeDuringApproval = resolveQdnRequestContextActive(true, true);
assert.equal(activeDuringApproval, true);
assert.equal(isQdnRequestContextCurrent(true, activeDuringApproval, requestFrame, requestFrame), true);
assert.equal(resolveQdnRequestContextActive(undefined, true), false);
assert.equal(isQdnRequestContextCurrent(true, false, requestFrame, requestFrame), false);
assert.equal(isQdnRequestContextCurrent(true, true, requestFrame, {}), false);
assert.equal(isQdnRequestContextCurrent(false, true, requestFrame, requestFrame), false);

console.log('QDN request context tests passed.');
