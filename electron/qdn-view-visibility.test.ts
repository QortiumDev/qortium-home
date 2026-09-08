import assert from 'node:assert/strict';
import { isQdnNativeViewVisible } from './qdn-view-visibility.js';

assert.equal(isQdnNativeViewVisible({}, false), false, 'An unshown or hidden legacy view must stay ineligible');
assert.equal(isQdnNativeViewVisible({}, true), true, 'Only a trusted show permits the legacy fallback');
assert.equal(isQdnNativeViewVisible({ getVisible: () => false }, true), false, 'Native hidden state overrides an earlier show');
assert.equal(isQdnNativeViewVisible({ getVisible: () => true }, false), true);
const view = { shown: false, getVisible() { return this.shown; } };
assert.equal(isQdnNativeViewVisible(view, true), false, 'Preserve the native receiver');
assert.throws(() => isQdnNativeViewVisible({getVisible() { throw new Error('destroyed'); }}, true));
console.log('QDN native visibility compatibility checks passed.');
